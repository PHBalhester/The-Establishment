/**
 * @deprecated Replaced by Railway crank runner (scripts/crank/).
 * Kept for reference only. Not updated for vault conversion.
 * See: https://dr-fraudsworth-production.up.railway.app
 */

/**
 * Overnight E2E Runner -- 100-Epoch Sustained Devnet Validation
 *
 * A single long-lived TypeScript process that cycles 100 epochs on devnet
 * with real VRF, swaps, staking, and Carnage detection. This validates
 * Phase 37 fixes under sustained operation and captures natural Carnage
 * triggers.
 *
 * Architecture:
 * 1. Load provider, programs, manifest (same pattern as carnage-hunter.ts)
 * 2. Create E2E user with WSOL budget for 100 swaps
 * 3. Stake 10 PROFIT (so staking yield accrues across all epochs)
 * 4. Main loop: FOR each epoch:
 *    a. checkAndAirdrop (safety net if wallet drops below 5 SOL)
 *    b. Wait 760 slots between epochs (750 minimum + 10 buffer)
 *    c. advanceEpochWithVRF (with gateway rotation from Task 1)
 *    d. executeSolBuySwap (alternating CRIME/SOL and FRAUD/SOL)
 *    e. If Carnage triggered: attempt execute_carnage_atomic
 *    f. Read post-epoch state and log EpochRecord to JSONL
 * 5. Claim staking yield
 * 6. Generate Docs/Overnight_Report.md via OvernightReporter
 *
 * Error handling: Each epoch is wrapped in try/catch. Errors are logged
 * to the EpochRecord.errors array and JSONL, then execution continues.
 *
 * Graceful shutdown: SIGINT/SIGTERM sets shutdownRequested flag. The
 * current epoch finishes, then the runner claims yield and generates
 * the report before exiting.
 *
 * Run:
 *   set -a && source .env && set +a && npx tsx scripts/e2e/overnight-runner.ts
 *
 * Prerequisites:
 * - All 5 programs deployed on devnet with Phase 37 fixes
 * - Funded devnet wallet with >= 20 SOL
 * - CLUSTER_URL env var pointing to Helius devnet RPC
 * - EpochState initialized (Phase 38-01 completes this)
 */

import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import { createE2EUser } from "./lib/user-setup";
import { executeSolBuySwap } from "./lib/swap-flow";
import { stakePROFIT, claimYield } from "./lib/staking-flow";
import { testForcedCarnage } from "./lib/carnage-flow";
import { getOrCreateProtocolALT } from "./lib/alt-helper";
import { loadDeployment } from "./lib/load-deployment";
import {
  advanceEpochWithVRF,
  VRFAccounts,
  EpochTransitionResult,
  waitForSlotAdvance,
} from "../vrf/lib/vrf-flow";
import { readEpochState } from "../vrf/lib/epoch-reader";
import { E2ELogger } from "./lib/e2e-logger";
import { PDAManifest } from "./devnet-e2e-validation";
import { EpochRecord, OvernightReporter } from "./lib/overnight-reporter";
import { AnchorProvider } from "@coral-xyz/anchor";

// ---- Constants ----

/** Number of epochs to run (configurable via OVERNIGHT_EPOCHS env var) */
const TARGET_EPOCHS = parseInt(process.env.OVERNIGHT_EPOCHS || "100", 10);

/** Request airdrop when wallet drops below this threshold */
const AIRDROP_THRESHOLD = 2 * LAMPORTS_PER_SOL;

/** Airdrop amount (devnet caps at 2 SOL per request) */
const AIRDROP_AMOUNT = 2 * LAMPORTS_PER_SOL;

/**
 * Number of slots to wait between epoch transitions.
 * On-chain SLOTS_PER_EPOCH = 750; we add 10-slot buffer.
 * At ~400ms/slot on devnet, 760 slots = ~5 min.
 */
const SLOT_WAIT_BETWEEN_EPOCHS = 760;

/**
 * WSOL budget for the test user.
 * ~10 swaps at 0.003 SOL + buffer (swapping every 10th epoch to conserve SOL).
 * Kept minimal to conserve devnet SOL (faucet rate-limited).
 */
const WSOL_BUDGET = 100_000_000; // 0.1 SOL

/** Only execute a swap every N epochs to conserve devnet SOL */
const SWAP_EVERY_N_EPOCHS = 10;

/** Swap amount per epoch: 0.003 SOL (conserve devnet SOL) */
const SWAP_AMOUNT = 3_000_000;

/** Path to the JSONL log file for this run */
const LOG_PATH = path.resolve(__dirname, "overnight-run.jsonl");

/** Path to the final Markdown report */
const REPORT_PATH = path.resolve(__dirname, "../../Docs/Overnight_Report.md");

/** E2E logger for staking/swap flow functions that expect it */
const DUMMY_LOG_PATH = path.resolve(__dirname, "overnight-dummy.jsonl");

/** Rate limit delay between RPC calls (ms) */
const RPC_DELAY_MS = 200;

/** Stake amount: 10 PROFIT in raw units (6 decimals) */
const STAKE_AMOUNT = 10_000_000;

// ---- Utilities ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Graceful Shutdown ----

let shutdownRequested = false;

process.on("SIGINT", () => {
  shutdownRequested = true;
  console.log("\nShutdown requested (SIGINT). Finishing current epoch...");
});

process.on("SIGTERM", () => {
  shutdownRequested = true;
  console.log("\nShutdown requested (SIGTERM). Finishing current epoch...");
});

// ---- Auto-Airdrop Safety Net ----

/**
 * Check wallet balance and request airdrop if below threshold.
 * Only works on devnet/localnet. Silently catches airdrop failures
 * (devnet faucet rate limits).
 */
async function checkAndAirdrop(provider: AnchorProvider): Promise<void> {
  try {
    const balance = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    if (balance < AIRDROP_THRESHOLD) {
      console.log(
        `  [airdrop] Balance ${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL < ${(AIRDROP_THRESHOLD / LAMPORTS_PER_SOL).toFixed(0)} SOL threshold. Requesting airdrop...`
      );
      const sig = await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        AIRDROP_AMOUNT
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
      const newBalance = await provider.connection.getBalance(
        provider.wallet.publicKey
      );
      console.log(
        `  [airdrop] New balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`
      );
    }
  } catch (err) {
    console.log(
      `  [airdrop] Failed (devnet faucet rate limit?): ${String(err).slice(0, 100)}`
    );
    // Non-fatal -- continue running
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const runStartTime = new Date().toISOString();
  const runStartMs = Date.now();

  console.log("=".repeat(60));
  console.log("  OVERNIGHT E2E RUNNER");
  console.log(`  Target: ${TARGET_EPOCHS} epochs on Solana Devnet`);
  console.log(`  Started: ${runStartTime}`);
  console.log("=".repeat(60));
  console.log();

  // Truncate JSONL log for fresh run
  fs.writeFileSync(LOG_PATH, "", "utf-8");

  // E2ELogger for staking/swap functions that require it
  const logger = new E2ELogger(DUMMY_LOG_PATH);

  // Load provider + programs
  const provider = loadProvider();
  const programs = loadPrograms(provider);

  // Load deployment addresses from deployments/devnet.json (Phase 95)
  const manifest: PDAManifest = loadDeployment();

  // Check wallet balance
  const walletBalance = await provider.connection.getBalance(
    provider.wallet.publicKey
  );
  console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${(walletBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  console.log();

  // Create fresh user with large WSOL balance for 100 swaps
  console.log(
    `Creating test user with ${(WSOL_BUDGET / LAMPORTS_PER_SOL).toFixed(0)} SOL WSOL...`
  );
  const user = await createE2EUser(provider, manifest.mints, WSOL_BUDGET);
  console.log(`User: ${user.keypair.publicKey.toBase58()}`);

  // Stake 10 PROFIT so staking yield accrues across all epochs
  console.log("Staking 10 PROFIT tokens...");
  const stakeSig = await stakePROFIT(
    provider,
    programs,
    manifest,
    user,
    STAKE_AMOUNT,
    logger
  );
  if (stakeSig) {
    console.log(`Staked: ${stakeSig.slice(0, 16)}...`);
  } else {
    console.log("WARNING: Stake failed. Staking yield will be 0.");
  }
  console.log();

  // Load protocol-wide Address Lookup Table (required for Carnage Sell path v0 TX)
  console.log("Setting up Address Lookup Table...");
  const alt = await getOrCreateProtocolALT(provider, manifest);
  console.log();

  // Build VRF accounts from manifest (same pattern as staking-flow.ts)
  const vrfAccounts: VRFAccounts = {
    epochStatePda: new PublicKey(manifest.pdas.EpochState),
    treasuryPda: provider.wallet.publicKey,
    stakingAuthorityPda: new PublicKey(manifest.pdas.StakingAuthority),
    stakePoolPda: new PublicKey(manifest.pdas.StakePool),
    stakingProgramId: new PublicKey(manifest.programs.Staking),
    carnageFundPda: new PublicKey(manifest.pdas.CarnageFund),
  };

  // Read initial escrow balance for staking yield delta tracking
  let previousEscrowBalance = 0;
  try {
    previousEscrowBalance = await provider.connection.getBalance(
      new PublicKey(manifest.pdas.EscrowVault)
    );
  } catch {
    // Escrow may not exist yet
  }

  // ============================================================
  // MAIN LOOP: Cycle epochs
  // ============================================================

  const epochRecords: EpochRecord[] = [];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  STARTING OVERNIGHT RUN: ${TARGET_EPOCHS} epochs`);
  console.log(`${"=".repeat(60)}\n`);

  for (let i = 0; i < TARGET_EPOCHS; i++) {
    // Check for graceful shutdown
    if (shutdownRequested) {
      console.log(`\nShutdown at epoch ${i}/${TARGET_EPOCHS}. Generating report...`);
      break;
    }

    const epochStartMs = Date.now();
    const errors: string[] = [];
    const txSignatures: string[] = [];

    let epochNumber = 0;
    let cheapSide = "UNKNOWN";
    let crimeBuyTaxBps = 0;
    let crimeSellTaxBps = 0;
    let fraudBuyTaxBps = 0;
    let fraudSellTaxBps = 0;
    let vrfBytes: number[] = [];
    let carnageTriggered = false;
    let carnageExecuted = false;
    let swapPerformed = false;
    let swapPool = "";
    let swapSig: string | null = null;
    let vrfDurationMs = 0;
    let walletBal = 0;
    let carnageVaultBal = 0;
    let stakingYieldDelta = 0;

    try {
      // a. Auto-airdrop safety net
      await checkAndAirdrop(provider);

      // b. Wait for slot boundary (skip for first epoch)
      if (i > 0) {
        console.log(
          `  Waiting ${SLOT_WAIT_BETWEEN_EPOCHS} slots (~${Math.round((SLOT_WAIT_BETWEEN_EPOCHS * 0.4) / 60)} min)...`
        );
        await waitForSlotAdvance(
          provider.connection,
          SLOT_WAIT_BETWEEN_EPOCHS
        );
        await sleep(RPC_DELAY_MS);
      }

      // c. Advance epoch with VRF (gateway rotation handles oracle failures)
      const vrfStartMs = Date.now();
      let vrfResult: EpochTransitionResult;
      try {
        vrfResult = await advanceEpochWithVRF(
          provider,
          programs.epochProgram,
          vrfAccounts
        );
        vrfDurationMs = Date.now() - vrfStartMs;

        epochNumber = vrfResult.epoch;
        cheapSide = vrfResult.cheapSide;
        crimeBuyTaxBps = vrfResult.crimeBuyTaxBps;
        crimeSellTaxBps = vrfResult.crimeSellTaxBps;
        fraudBuyTaxBps = vrfResult.fraudBuyTaxBps;
        fraudSellTaxBps = vrfResult.fraudSellTaxBps;
        vrfBytes = vrfResult.vrfBytes;
        carnageTriggered = vrfResult.carnageTriggered;

        // Collect TX signatures from VRF flow
        if (vrfResult.createSig && vrfResult.createSig !== "recovery") {
          txSignatures.push(vrfResult.createSig);
        }
        if (vrfResult.commitSig && vrfResult.commitSig !== "recovery") {
          txSignatures.push(vrfResult.commitSig);
        }
        txSignatures.push(vrfResult.consumeSig);
      } catch (err) {
        vrfDurationMs = Date.now() - vrfStartMs;
        const errStr = String(err).slice(0, 200);
        errors.push(`VRF failed: ${errStr}`);
        console.log(`  VRF FAILED: ${errStr}`);
        // Try to read epoch state anyway to get current values
        try {
          const state = await readEpochState(
            programs.epochProgram,
            new PublicKey(manifest.pdas.EpochState)
          );
          epochNumber = state.currentEpoch;
          cheapSide = state.cheapSide;
          crimeBuyTaxBps = state.crimeBuyTaxBps;
          crimeSellTaxBps = state.crimeSellTaxBps;
          fraudBuyTaxBps = state.fraudBuyTaxBps;
          fraudSellTaxBps = state.fraudSellTaxBps;
        } catch {
          // Double failure -- leave defaults
        }
      }

      // d. Execute swap every Nth epoch (alternating CRIME/SOL and FRAUD/SOL)
      if (i % SWAP_EVERY_N_EPOCHS === 0) {
        swapPool = i % 2 === 0 ? "CRIME/SOL" : "FRAUD/SOL";
        try {
          swapSig = await executeSolBuySwap(
            provider,
            programs,
            manifest,
            user,
            logger,
            swapPool,
            SWAP_AMOUNT
          );
          swapPerformed = swapSig !== null;
          if (swapSig) {
            txSignatures.push(swapSig);
          }
        } catch (err) {
          const errStr = String(err).slice(0, 200);
          errors.push(`Swap failed: ${errStr}`);
        }
      }

      // e. If Carnage triggered, attempt execution
      if (carnageTriggered) {
        try {
          const forcedResult = await testForcedCarnage(
            provider,
            programs,
            manifest,
            user,
            logger,
            alt
          );
          carnageExecuted = forcedResult.success;
          if (forcedResult.txSignature) {
            txSignatures.push(forcedResult.txSignature);
          }
          if (!forcedResult.success && !forcedResult.knownIssue) {
            errors.push(`Carnage execution failed: ${forcedResult.details.slice(0, 200)}`);
          }
        } catch (err) {
          errors.push(`Carnage execution error: ${String(err).slice(0, 200)}`);
        }
      }

      // f. Read post-epoch state
      try {
        walletBal = await provider.connection.getBalance(
          provider.wallet.publicKey
        );
        await sleep(RPC_DELAY_MS);
      } catch {
        // Non-critical
      }

      try {
        carnageVaultBal = await provider.connection.getBalance(
          new PublicKey(manifest.pdas.CarnageSolVault)
        );
        await sleep(RPC_DELAY_MS);
      } catch {
        // Non-critical
      }

      // Track staking yield delta (escrow balance change since last epoch)
      try {
        const currentEscrowBalance = await provider.connection.getBalance(
          new PublicKey(manifest.pdas.EscrowVault)
        );
        stakingYieldDelta = currentEscrowBalance - previousEscrowBalance;
        previousEscrowBalance = currentEscrowBalance;
        await sleep(RPC_DELAY_MS);
      } catch {
        // Non-critical
      }
    } catch (err) {
      // Catch-all for unexpected errors in the epoch
      const errStr = String(err).slice(0, 200);
      errors.push(`Epoch error: ${errStr}`);
      console.log(`  EPOCH ERROR: ${errStr}`);
    }

    // Build and log EpochRecord
    const totalDurationMs = Date.now() - epochStartMs;
    const record: EpochRecord = {
      timestamp: new Date().toISOString(),
      epochIndex: i,
      epochNumber,
      cheapSide,
      crimeBuyTaxBps,
      crimeSellTaxBps,
      fraudBuyTaxBps,
      fraudSellTaxBps,
      vrfBytes,
      carnageTriggered,
      carnageExecuted,
      swapPerformed,
      swapPool,
      swapSig,
      taxDistribution: null, // TODO: extract from swap verification if needed
      stakingYieldDelta,
      errors,
      txSignatures,
      vrfDurationMs,
      totalDurationMs,
      walletBalance: walletBal,
      carnageVaultBalance: carnageVaultBal,
    };

    epochRecords.push(record);

    // Append to JSONL (crash-safe)
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf-8");

    // Console summary line
    const swapStatus = swapPerformed ? "swap OK" : "swap FAIL";
    const carnageStatus = carnageTriggered
      ? carnageExecuted
        ? "CARNAGE EXEC"
        : "CARNAGE TRIG"
      : "no carnage";
    const errorStatus = errors.length > 0 ? ` | ${errors.length} errors` : "";
    const lowTax = Math.min(crimeBuyTaxBps, fraudBuyTaxBps);
    const highTax = Math.max(crimeBuyTaxBps, fraudBuyTaxBps);

    console.log(
      `[${i + 1}/${TARGET_EPOCHS}] Epoch ${epochNumber} | ${cheapSide} cheap | ${lowTax}/${highTax} bps | ${swapStatus} | ${(totalDurationMs / 1000).toFixed(1)}s | ${carnageStatus}${errorStatus}`
    );
  }

  // ============================================================
  // POST-RUN: Claim yield and generate report
  // ============================================================

  console.log(`\n${"=".repeat(60)}`);
  console.log("  POST-RUN: Claiming staking yield...");
  console.log(`${"=".repeat(60)}\n`);

  let claimResult: { txSig: string; yieldLamports: number } | null = null;
  try {
    claimResult = await claimYield(provider, programs, manifest, user, logger);
    if (claimResult) {
      console.log(
        `Claimed ${(claimResult.yieldLamports / 1e9).toFixed(9)} SOL yield (TX: ${claimResult.txSig.slice(0, 16)}...)`
      );
    } else {
      console.log("Claim returned null (NothingToClaim or InsufficientEscrow).");
    }
  } catch (err) {
    console.log(`Claim failed: ${String(err).slice(0, 200)}`);
  }

  // Generate morning report
  const runEndTime = new Date().toISOString();
  const totalRunDurationMs = Date.now() - runStartMs;

  console.log("\nGenerating Docs/Overnight_Report.md...");
  const reporter = new OvernightReporter(
    epochRecords,
    runStartTime,
    runEndTime,
    TARGET_EPOCHS,
    totalRunDurationMs
  );
  const reportContent = reporter.generate();
  fs.writeFileSync(REPORT_PATH, reportContent, "utf-8");
  console.log(`Report written to: ${REPORT_PATH}`);

  // Final summary
  const totalEpochs = epochRecords.length;
  const totalCarnage = epochRecords.filter((r) => r.carnageTriggered).length;
  const totalSwaps = epochRecords.filter((r) => r.swapPerformed).length;
  const totalErrors = epochRecords.reduce(
    (sum, r) => sum + r.errors.length,
    0
  );
  const finalWallet = walletBalance / LAMPORTS_PER_SOL;

  console.log(`\n${"=".repeat(60)}`);
  console.log("  OVERNIGHT RUN COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log(
    `  Duration:     ${(totalRunDurationMs / 3_600_000).toFixed(1)} hours`
  );
  console.log(`  Epochs:       ${totalEpochs}/${TARGET_EPOCHS}`);
  console.log(`  Swaps:        ${totalSwaps}`);
  console.log(`  Carnage:      ${totalCarnage} triggers`);
  console.log(`  Errors:       ${totalErrors}`);
  console.log(
    `  Yield:        ${claimResult ? (claimResult.yieldLamports / 1e9).toFixed(9) + " SOL" : "N/A"}`
  );
  console.log(`  Log:          ${LOG_PATH}`);
  console.log(`  Report:       ${REPORT_PATH}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ---- Entry Point ----

main().catch((err) => {
  console.error("\nFatal error:", err);
  try {
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        epochIndex: -1,
        epochNumber: 0,
        cheapSide: "UNKNOWN",
        crimeBuyTaxBps: 0,
        crimeSellTaxBps: 0,
        fraudBuyTaxBps: 0,
        fraudSellTaxBps: 0,
        vrfBytes: [],
        carnageTriggered: false,
        carnageExecuted: false,
        swapPerformed: false,
        swapPool: "",
        swapSig: null,
        taxDistribution: null,
        stakingYieldDelta: 0,
        errors: [`Fatal: ${String(err)}`],
        txSignatures: [],
        vrfDurationMs: 0,
        totalDurationMs: 0,
        walletBalance: 0,
        carnageVaultBalance: 0,
      } satisfies EpochRecord) + "\n",
      "utf-8"
    );
  } catch {
    // Nothing we can do
  }
  process.exit(1);
});
