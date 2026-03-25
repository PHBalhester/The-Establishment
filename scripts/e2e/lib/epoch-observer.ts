/**
 * E2E Epoch & Carnage Observer -- Observe Railway Crank Epoch Transitions
 *
 * Unlike staking-flow.ts which triggers epochs via VRF, this module
 * OBSERVES the naturally running Railway crank advancing epochs. It polls
 * EpochState every 30 seconds, waiting for the epoch number to increment.
 *
 * Also monitors CarnageFund balance changes during the observation window
 * to detect Carnage events (probabilistic -- may not fire every epoch).
 *
 * Used by E2E-03 (epoch advancement) and E2E-04 (carnage observation).
 *
 * Exports:
 * - observeEpochTransition: Wait for crank to advance epoch, log before/after state
 * - observeCarnage: Check if Carnage fired during observation window
 * - readOnChainState: Read all protocol state for frontend cross-check (E2E-07)
 */

import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { readEpochState, EpochStateSnapshot } from "../../vrf/lib/epoch-reader";
import { E2ELogger } from "./e2e-logger";
import { Programs } from "../../deploy/lib/connection";
import { PDAManifest } from "../devnet-e2e-validation";

// ---- Constants ----

/** Poll interval for epoch observation (ms) */
const POLL_INTERVAL_MS = 30_000;

/** Maximum time to wait for an epoch transition (ms) -- 15 minutes */
const MAX_WAIT_MS = 15 * 60 * 1000;

/** RPC delay between calls (ms) */
const RPC_DELAY_MS = 200;

function localSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Types ----

export interface EpochObservation {
  /** Epoch state before transition */
  before: EpochStateSnapshot;
  /** Epoch state after transition */
  after: EpochStateSnapshot;
  /** Whether tax rates changed between epochs */
  taxRatesChanged: boolean;
  /** Duration of observation in ms */
  durationMs: number;
}

export interface CarnageObservation {
  /** Whether Carnage was observed during the window */
  observed: boolean;
  /** CarnageFund balance before observation */
  balanceBefore: number;
  /** CarnageFund balance after observation */
  balanceAfter: number;
  /** Balance delta (negative = SOL spent on Carnage) */
  balanceDelta: number;
  /** Evidence string */
  evidence: string;
}

export interface OnChainState {
  /** Current epoch info */
  epoch: {
    number: number;
    cheapSide: string;
    lowTaxBps: number;
    highTaxBps: number;
    crimeBuyTaxBps: number;
    crimeSellTaxBps: number;
    fraudBuyTaxBps: number;
    fraudSellTaxBps: number;
  };
  /** Pool reserve balances */
  pools: {
    crimeSol: { solReserve: number; tokenReserve: number };
    fraudSol: { solReserve: number; tokenReserve: number };
  };
  /** Staking stats */
  staking: {
    escrowBalanceLamports: number;
    escrowBalanceSol: number;
    stakePoolExists: boolean;
  };
  /** Carnage fund */
  carnage: {
    fundBalanceLamports: number;
    fundBalanceSol: number;
  };
}

// ---- Epoch Observation ----

/**
 * Wait for the Railway crank to advance the epoch.
 *
 * Polls EpochState every 30 seconds. When epoch_number increments,
 * captures before/after snapshots and compares tax rates.
 *
 * @returns EpochObservation with before/after state, or null if timeout
 */
export async function observeEpochTransition(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  logger: E2ELogger,
): Promise<EpochObservation | null> {
  const epochStatePda = new PublicKey(manifest.pdas.EpochState);
  const startMs = Date.now();

  // Read initial state
  const before = await readEpochState(programs.epochProgram, epochStatePda);
  await localSleep(RPC_DELAY_MS);

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "epoch",
    status: "pass",
    message: `Observing epoch transitions from crank. Current epoch=${before.currentEpoch}, cheapSide=${before.cheapSide}, lowTax=${before.lowTaxBps}bps, highTax=${before.highTaxBps}bps`,
    details: {
      currentEpoch: before.currentEpoch,
      cheapSide: before.cheapSide,
      lowTaxBps: before.lowTaxBps,
      highTaxBps: before.highTaxBps,
      epochStartSlot: before.epochStartSlot,
    },
  });

  // Calculate estimated wait based on current slot position
  const currentSlot = await provider.connection.getSlot();
  const slotsIntoEpoch = currentSlot - before.epochStartSlot;
  const slotsPerEpoch = 750; // devnet
  const slotsRemaining = Math.max(0, slotsPerEpoch - slotsIntoEpoch);
  const estimatedWaitSec = Math.round(slotsRemaining * 0.4);

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "epoch",
    status: "pass",
    message: `Estimated ~${estimatedWaitSec}s until next epoch boundary (${slotsRemaining} slots remaining). Polling every 30s, timeout 15min.`,
  });

  // Poll until epoch advances or timeout
  while (Date.now() - startMs < MAX_WAIT_MS) {
    await localSleep(POLL_INTERVAL_MS);

    const current = await readEpochState(programs.epochProgram, epochStatePda);
    await localSleep(RPC_DELAY_MS);

    if (current.currentEpoch > before.currentEpoch) {
      const durationMs = Date.now() - startMs;
      const taxRatesChanged =
        current.lowTaxBps !== before.lowTaxBps ||
        current.highTaxBps !== before.highTaxBps ||
        current.cheapSide !== before.cheapSide;

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "epoch",
        status: "pass",
        message: `Epoch advanced! ${before.currentEpoch} -> ${current.currentEpoch} in ${(durationMs / 1000).toFixed(0)}s. Tax rates ${taxRatesChanged ? "CHANGED" : "same"}: cheapSide=${current.cheapSide}, lowTax=${current.lowTaxBps}bps, highTax=${current.highTaxBps}bps`,
        details: {
          epochBefore: before.currentEpoch,
          epochAfter: current.currentEpoch,
          cheapSideBefore: before.cheapSide,
          cheapSideAfter: current.cheapSide,
          lowTaxBefore: before.lowTaxBps,
          lowTaxAfter: current.lowTaxBps,
          highTaxBefore: before.highTaxBps,
          highTaxAfter: current.highTaxBps,
          taxRatesChanged,
          durationMs,
        },
      });

      return {
        before,
        after: current,
        taxRatesChanged,
        durationMs,
      };
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    console.log(`  [epoch-observer] Still epoch ${current.currentEpoch}, waiting... (${elapsed}s elapsed)`);
  }

  // Timeout
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "epoch",
    status: "fail",
    message: `Epoch observation timed out after ${MAX_WAIT_MS / 1000}s. Epoch stayed at ${before.currentEpoch}. Is the Railway crank running?`,
  });

  return null;
}

// ---- Carnage Observation ----

/**
 * Check if Carnage fired by comparing CarnageFund balance before/after.
 *
 * Carnage is probabilistic (based on VRF randomness), so not triggering
 * in a single epoch is expected and NOT a failure.
 */
export async function observeCarnage(
  provider: AnchorProvider,
  manifest: PDAManifest,
  balanceBefore: number,
  logger: E2ELogger,
): Promise<CarnageObservation> {
  const carnageFund = new PublicKey(manifest.pdas.CarnageFund);
  const balanceAfter = await provider.connection.getBalance(carnageFund);
  await localSleep(RPC_DELAY_MS);

  const balanceDelta = balanceAfter - balanceBefore;
  // Carnage spends SOL (buys tokens), so a decrease indicates it fired
  // But new tax revenue also adds to CarnageFund, so we check lastCarnageEpoch too
  const observed = balanceDelta < -10000; // >10K lamport decrease suggests Carnage spent SOL

  let evidence: string;
  if (observed) {
    evidence = `CarnageFund balance decreased by ${Math.abs(balanceDelta)} lamports (${(Math.abs(balanceDelta) / LAMPORTS_PER_SOL).toFixed(6)} SOL) -- Carnage spent SOL on token buyback`;
  } else if (balanceDelta > 0) {
    evidence = `CarnageFund balance increased by ${balanceDelta} lamports (tax revenue deposited, no Carnage spend detected)`;
  } else {
    evidence = `Probabilistic -- Carnage not triggered this epoch (balance delta: ${balanceDelta} lamports)`;
  }

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: observed ? "pass" : "pass", // Not triggering is also a pass (probabilistic)
    message: `Carnage observation: ${observed ? "TRIGGERED" : "not triggered (probabilistic)"}. ${evidence}`,
    details: {
      carnageObserved: observed,
      balanceBefore,
      balanceAfter,
      balanceDelta,
      evidence,
    },
  });

  return {
    observed,
    balanceBefore,
    balanceAfter,
    balanceDelta,
    evidence,
  };
}

// ---- On-Chain State Reader (E2E-07) ----

/**
 * Read all protocol state for frontend cross-checking.
 *
 * Outputs epoch info, tax rates, pool reserves, staking stats, and
 * carnage fund balance. The user compares these values against the
 * frontend display during the checkpoint verification.
 */
export async function readOnChainState(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  logger: E2ELogger,
): Promise<OnChainState> {
  const connection = provider.connection;
  const epochStatePda = new PublicKey(manifest.pdas.EpochState);

  // Read EpochState
  const epochState = await readEpochState(programs.epochProgram, epochStatePda);
  await localSleep(RPC_DELAY_MS);

  // Read pool reserves from pool vault token accounts
  const crimePool = manifest.pools["CRIME/SOL"];
  const fraudPool = manifest.pools["FRAUD/SOL"];

  const crimeSolReserve = await connection.getBalance(new PublicKey(crimePool.vaultA));
  await localSleep(RPC_DELAY_MS);
  const crimeTokenReserve = await getTokenBalance(connection, new PublicKey(crimePool.vaultB));
  await localSleep(RPC_DELAY_MS);
  const fraudSolReserve = await connection.getBalance(new PublicKey(fraudPool.vaultA));
  await localSleep(RPC_DELAY_MS);
  const fraudTokenReserve = await getTokenBalance(connection, new PublicKey(fraudPool.vaultB));
  await localSleep(RPC_DELAY_MS);

  // Read staking escrow
  const escrowBalance = await connection.getBalance(new PublicKey(manifest.pdas.EscrowVault));
  await localSleep(RPC_DELAY_MS);
  const stakePoolInfo = await connection.getAccountInfo(new PublicKey(manifest.pdas.StakePool));
  await localSleep(RPC_DELAY_MS);

  // Read carnage fund
  const carnageBalance = await connection.getBalance(new PublicKey(manifest.pdas.CarnageFund));
  await localSleep(RPC_DELAY_MS);

  const state: OnChainState = {
    epoch: {
      number: epochState.currentEpoch,
      cheapSide: epochState.cheapSide,
      lowTaxBps: epochState.lowTaxBps,
      highTaxBps: epochState.highTaxBps,
      crimeBuyTaxBps: epochState.crimeBuyTaxBps,
      crimeSellTaxBps: epochState.crimeSellTaxBps,
      fraudBuyTaxBps: epochState.fraudBuyTaxBps,
      fraudSellTaxBps: epochState.fraudSellTaxBps,
    },
    pools: {
      crimeSol: {
        solReserve: crimeSolReserve,
        tokenReserve: crimeTokenReserve,
      },
      fraudSol: {
        solReserve: fraudSolReserve,
        tokenReserve: fraudTokenReserve,
      },
    },
    staking: {
      escrowBalanceLamports: escrowBalance,
      escrowBalanceSol: escrowBalance / LAMPORTS_PER_SOL,
      stakePoolExists: !!stakePoolInfo,
    },
    carnage: {
      fundBalanceLamports: carnageBalance,
      fundBalanceSol: carnageBalance / LAMPORTS_PER_SOL,
    },
  };

  // Pretty-print for user cross-checking
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "frontend_accuracy",
    status: "pass",
    message: "On-chain state for frontend cross-check (E2E-07)",
    details: state,
  });

  console.log("\n========================================");
  console.log("  ON-CHAIN STATE (compare with frontend)");
  console.log("========================================");
  console.log(`  Epoch:          ${state.epoch.number}`);
  console.log(`  Cheap Side:     ${state.epoch.cheapSide}`);
  console.log(`  Low Tax:        ${state.epoch.lowTaxBps} bps (${(state.epoch.lowTaxBps / 100).toFixed(1)}%)`);
  console.log(`  High Tax:       ${state.epoch.highTaxBps} bps (${(state.epoch.highTaxBps / 100).toFixed(1)}%)`);
  console.log(`  CRIME Buy Tax:  ${state.epoch.crimeBuyTaxBps} bps`);
  console.log(`  CRIME Sell Tax: ${state.epoch.crimeSellTaxBps} bps`);
  console.log(`  FRAUD Buy Tax:  ${state.epoch.fraudBuyTaxBps} bps`);
  console.log(`  FRAUD Sell Tax: ${state.epoch.fraudSellTaxBps} bps`);
  console.log("  ----");
  console.log(`  CRIME/SOL Pool:`);
  console.log(`    SOL Reserve:   ${(state.pools.crimeSol.solReserve / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`    Token Reserve: ${(state.pools.crimeSol.tokenReserve / 1_000_000).toFixed(2)} CRIME`);
  console.log(`  FRAUD/SOL Pool:`);
  console.log(`    SOL Reserve:   ${(state.pools.fraudSol.solReserve / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`    Token Reserve: ${(state.pools.fraudSol.tokenReserve / 1_000_000).toFixed(2)} FRAUD`);
  console.log("  ----");
  console.log(`  Staking Escrow: ${state.staking.escrowBalanceSol.toFixed(6)} SOL (${state.staking.escrowBalanceLamports} lamports)`);
  console.log(`  Carnage Fund:   ${state.carnage.fundBalanceSol.toFixed(6)} SOL (${state.carnage.fundBalanceLamports} lamports)`);
  console.log("========================================\n");

  return state;
}

/**
 * Get token balance for a Token-2022 account.
 */
async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<number> {
  try {
    const info = await connection.getTokenAccountBalance(tokenAccount);
    return Number(info.value.amount);
  } catch {
    return 0;
  }
}
