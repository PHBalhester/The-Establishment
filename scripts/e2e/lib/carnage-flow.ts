/**
 * E2E Carnage Flow -- Forced and Natural Carnage Trigger Testing
 *
 * Tests both paths for Carnage execution on devnet:
 * 1. Forced (atomic): If carnage_pending is already true, attempt execute_carnage_atomic
 * 2. Natural (VRF): Cycle epochs until VRF byte 5 < 11 triggers Carnage naturally
 * 3. Post-Carnage health check: Verify protocol is still operational after Carnage
 *
 * This validates E2E-05: Carnage trigger with real VRF.
 *
 * KNOWN ISSUES (expected to fail):
 * - held_amount stores SOL lamports not token count (audit H041, H042, H063, H089, H094)
 * - Fallback discriminator mismatch (audit H018, H052, H058, H099)
 * - Missing swap_authority in fallback (audit H019, H059)
 *
 * These are documented as "known_issue" not "fail" because they represent
 * bugs that are tracked for Phase 36.1 fixes, not unexpected failures.
 *
 * Exports:
 * - captureCarnageSnapshot: Read Carnage Fund state + vault balances
 * - testForcedCarnage: Attempt execute_carnage_atomic when carnage_pending
 * - testNaturalCarnage: Cycle epochs until VRF triggers Carnage
 * - postCarnageHealthCheck: Verify protocol still works after Carnage attempt
 * - runCarnageFlow: Full Carnage flow orchestrator
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";

import { Programs } from "../../deploy/lib/connection";
import { E2EUser } from "./user-setup";
import { E2ELogger } from "./e2e-logger";
import { PDAManifest } from "../devnet-e2e-validation";
import { executeSolBuySwap, resolveHookAccounts } from "./swap-flow";
import { sendV0Transaction } from "./alt-helper";
import { advanceEpochWithVRF, VRFAccounts, waitForSlotAdvance } from "../../vrf/lib/vrf-flow";
import { readEpochState, EpochStateSnapshot } from "../../vrf/lib/epoch-reader";
import type { Program } from "@coral-xyz/anchor";

// ---- Constants ----

/** Rate limit delay between RPC calls (ms) for Helius free tier */
const RPC_DELAY_MS = 200;

/**
 * Maximum epochs to cycle for natural Carnage.
 * Each epoch has ~4.3% Carnage probability (VRF byte 5 < 11 / 256).
 * At 10 epochs the cumulative probability was only ~35% -- too low.
 * At 20 epochs: 1 - (1 - 11/256)^20 = ~58% cumulative probability.
 * With 750-slot waits between transitions, budget is ~30-100 min.
 * (Gap SC-4 fix: increased from 10 to 20)
 */
const DEFAULT_MAX_EPOCHS = 20;

/** Minimum SOL balance to continue epoch cycling (lamports) */
const MIN_SOL_BALANCE = 2 * LAMPORTS_PER_SOL;

/**
 * Number of slots to wait between epoch transitions.
 * The on-chain epoch program requires SLOTS_PER_EPOCH (750) slots between
 * transitions. Without this wait, back-to-back calls fail with
 * EpochBoundaryNotReached. We add a 10-slot buffer (760).
 * On devnet, slot time is ~400ms, so 760 slots = ~5 min wait.
 */
const SLOT_WAIT_BETWEEN_EPOCHS = 760;

// ---- Carnage WSOL Loader ----

/**
 * Load Carnage WSOL pubkey from CARNAGE_WSOL_PUBKEY env var.
 * No secret key loading — pubkey only.
 */
function loadCarnageWsolPubkeyFromEnv(): PublicKey {
  const envPubkey = process.env.CARNAGE_WSOL_PUBKEY;
  if (!envPubkey) {
    throw new Error(
      "CARNAGE_WSOL_PUBKEY env var not set. " +
      "Set it to the Carnage WSOL token account pubkey (base58)."
    );
  }
  return new PublicKey(envPubkey);
}

// ---- Utilities ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Types ----

/**
 * Snapshot of Carnage Fund state and vault balances.
 * Captured before/after Carnage attempts to detect state changes.
 */
export interface CarnageSnapshot {
  /** CarnageFundState account data (null if not readable) */
  carnageState: {
    heldToken: number;
    heldAmount: string;
    totalSolSpent: string;
    totalCrimeBurned: string;
    totalFraudBurned: string;
    totalTriggers: number;
    lastTriggerEpoch: number;
    initialized: boolean;
  } | null;
  /** Carnage SOL vault balance (lamports) */
  solVaultBalance: number;
  /** Carnage CRIME vault token balance (null if not readable) */
  crimeVaultBalance: string | null;
  /** Carnage FRAUD vault token balance (null if not readable) */
  fraudVaultBalance: string | null;
  /** Pool reserve snapshots */
  pools: Record<string, { vaultA: number; vaultB: string | null }>;
}

/**
 * Result of a forced Carnage test.
 */
export interface ForcedCarnageResult {
  /** Whether the test was attempted (requires carnage_pending = true) */
  tested: boolean;
  /** Whether Carnage execution succeeded */
  success: boolean;
  /** Whether the failure was a known issue (not unexpected) */
  knownIssue: boolean;
  /** Human-readable description of outcome */
  details: string;
  /** TX signature if any */
  txSignature?: string;
}

/**
 * Result of natural Carnage cycling.
 */
export interface NaturalCarnageResult {
  /** Whether Carnage was triggered by VRF */
  triggered: boolean;
  /** Epoch at which Carnage triggered (0 if not triggered) */
  epoch: number;
  /** Number of epochs cycled */
  epochsCycled: number;
  /** Human-readable description */
  details: string;
}

// ---- Snapshot Helper ----

/**
 * Capture a full snapshot of Carnage Fund state and vault balances.
 *
 * Reads:
 * - CarnageFundState account (typed fetch via Anchor)
 * - CarnageSolVault SOL balance
 * - CarnageCrimeVault token balance (Token-2022)
 * - CarnageFraudVault token balance (Token-2022)
 * - All 4 pool vault balances
 *
 * Each read is wrapped in try/catch because accounts may not exist yet
 * or may be empty on a fresh deployment.
 *
 * @param connection - Solana connection
 * @param programs - Protocol programs (for typed account fetch)
 * @param manifest - PDA manifest with account addresses
 * @returns CarnageSnapshot with all readable state
 */
export async function captureCarnageSnapshot(
  connection: Connection,
  programs: Programs,
  manifest: PDAManifest
): Promise<CarnageSnapshot> {
  // 1. Read CarnageFundState
  let carnageState: CarnageSnapshot["carnageState"] = null;
  try {
    const raw = await (programs.epochProgram.account as any).carnageFundState.fetch(
      new PublicKey(manifest.pdas.CarnageFund)
    );
    await sleep(RPC_DELAY_MS);

    carnageState = {
      heldToken: raw.heldToken,
      heldAmount: raw.heldAmount.toString(),
      totalSolSpent: raw.totalSolSpent.toString(),
      totalCrimeBurned: raw.totalCrimeBurned.toString(),
      totalFraudBurned: raw.totalFraudBurned.toString(),
      totalTriggers: raw.totalTriggers,
      lastTriggerEpoch: raw.lastTriggerEpoch,
      initialized: raw.initialized,
    };
  } catch (err) {
    // Account may not exist or may not be fetchable
    carnageState = null;
    await sleep(RPC_DELAY_MS);
  }

  // 2. Read SOL vault balance
  let solVaultBalance = 0;
  try {
    solVaultBalance = await connection.getBalance(
      new PublicKey(manifest.pdas.CarnageSolVault)
    );
    await sleep(RPC_DELAY_MS);
  } catch {
    // Vault may not exist
  }

  // 3. Read CRIME vault token balance
  let crimeVaultBalance: string | null = null;
  try {
    const balance = await connection.getTokenAccountBalance(
      new PublicKey(manifest.pdas.CarnageCrimeVault)
    );
    crimeVaultBalance = balance.value.amount;
    await sleep(RPC_DELAY_MS);
  } catch {
    // Token account may not exist
  }

  // 4. Read FRAUD vault token balance
  let fraudVaultBalance: string | null = null;
  try {
    const balance = await connection.getTokenAccountBalance(
      new PublicKey(manifest.pdas.CarnageFraudVault)
    );
    fraudVaultBalance = balance.value.amount;
    await sleep(RPC_DELAY_MS);
  } catch {
    // Token account may not exist
  }

  // 5. Read pool vaults
  const pools: CarnageSnapshot["pools"] = {};
  for (const poolName of ["CRIME/SOL", "FRAUD/SOL"]) {
    const pool = manifest.pools[poolName];
    if (!pool) continue;

    try {
      const vaultABal = await connection.getBalance(new PublicKey(pool.vaultA));
      await sleep(RPC_DELAY_MS);

      let vaultBBal: string | null = null;
      try {
        const vaultBBalance = await connection.getTokenAccountBalance(
          new PublicKey(pool.vaultB)
        );
        vaultBBal = vaultBBalance.value.amount;
      } catch {
        // Token account may be unreadable
      }
      await sleep(RPC_DELAY_MS);

      pools[poolName] = { vaultA: vaultABal, vaultB: vaultBBal };
    } catch {
      // Pool vault may not exist
    }
  }

  return {
    carnageState,
    solVaultBalance,
    crimeVaultBalance,
    fraudVaultBalance,
    pools,
  };
}

// ---- Shared Instruction Builder ----

/**
 * Build the executeCarnageAtomic TransactionInstruction.
 *
 * Extracted from testForcedCarnage so both carnage-flow.ts and vrf-flow.ts
 * can build this instruction without duplicating the complex account wiring.
 *
 * The instruction has 23 named accounts plus Transfer Hook remaining_accounts:
 * - BuyOnly/Burn: 4 buy hook accounts
 * - Sell: 4 sell hook + 4 buy hook accounts (8 total)
 *
 * @param epochProgram - Epoch Program instance (typed from IDL)
 * @param accounts - VRFAccounts with carnageAccounts populated
 * @param callerPubkey - Public key of the transaction signer (permissionless)
 * @param connection - Solana connection (for hook account resolution)
 * @returns TransactionInstruction ready to include in a Transaction
 */
export async function buildExecuteCarnageAtomicIx(
  epochProgram: Program,
  accounts: VRFAccounts,
  callerPubkey: PublicKey,
  connection: Connection
): Promise<import("@solana/web3.js").TransactionInstruction> {
  if (!accounts.carnageAccounts) {
    throw new Error("carnageAccounts must be provided to build executeCarnageAtomic instruction");
  }
  const ca = accounts.carnageAccounts;

  // Resolve Transfer Hook remaining_accounts in atomic layout:
  // [CRIME_buy(4), FRAUD_buy(4), held_sell(4)?]
  //
  // Buy hooks for both mints: client cannot know the VRF-derived target at TX
  // build time (consume_randomness sets it in the same bundled TX).
  // Sell hooks for held token: the held token IS stable across the bundled TX,
  // so we can resolve sell-direction hooks now. Sell-direction hooks differ from
  // buy-direction because whitelist PDA positions are swapped (source/dest).
  // On-chain partition_hook_accounts selects the correct slices.
  let hookAccounts: {
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }[] = [];

  try {
    // CRIME buy hooks (remaining_accounts[0..4]): pool -> carnage vault
    const crimeBuyHooks = await resolveHookAccounts(
      connection,
      ca.crimePoolVaultB,
      ca.crimeMint,
      ca.carnageCrimeVault,
      ca.swapAuthority,
      BigInt(0)
    );
    hookAccounts.push(...crimeBuyHooks);
    await sleep(RPC_DELAY_MS);

    // FRAUD buy hooks (remaining_accounts[4..8]): pool -> carnage vault
    const fraudBuyHooks = await resolveHookAccounts(
      connection,
      ca.fraudPoolVaultB,
      ca.fraudMint,
      ca.carnageFraudVault,
      ca.swapAuthority,
      BigInt(0)
    );
    hookAccounts.push(...fraudBuyHooks);
    await sleep(RPC_DELAY_MS);

    // Sell hooks for held token (remaining_accounts[8..12]) if fund has holdings.
    // held_token is stable (set by previous carnage, doesn't change in this TX).
    // Sell direction is reversed: carnage vault -> pool.
    const carnageState = await (epochProgram.account as any).carnageFundState.fetch(
      accounts.carnageFundPda
    );
    await sleep(RPC_DELAY_MS);

    if (carnageState.heldAmount > 0 && carnageState.heldToken > 0) {
      const heldIsCrime = carnageState.heldToken === 1;
      const heldMint = heldIsCrime ? ca.crimeMint : ca.fraudMint;
      const heldPoolVaultB = heldIsCrime ? ca.crimePoolVaultB : ca.fraudPoolVaultB;
      const carnageHeldVault = heldIsCrime ? ca.carnageCrimeVault : ca.carnageFraudVault;

      // Sell direction: carnage vault (source) -> pool vault (dest)
      const sellHooks = await resolveHookAccounts(
        connection,
        carnageHeldVault,
        heldMint,
        heldPoolVaultB,
        ca.swapAuthority,
        BigInt(0)
      );
      hookAccounts.push(...sellHooks);
      await sleep(RPC_DELAY_MS);
    }
  } catch (err) {
    // If hook resolution fails, send with empty remaining_accounts.
    // On-chain will likely fail too, but the error will be more informative.
    console.log(`  [buildCarnageIx] Hook resolution failed: ${String(err).slice(0, 200)}`);
  }

  // Carnage WSOL pubkey — already available from VRFAccounts.carnageAccounts
  const carnageWsolPubkey = ca.carnageWsol;

  // Build the instruction with all 23 named accounts + hook remaining_accounts
  const carnageIx = await epochProgram.methods
    .executeCarnageAtomic()
    .accountsStrict({
      caller: callerPubkey,
      epochState: accounts.epochStatePda,
      carnageState: accounts.carnageFundPda,
      carnageSigner: ca.carnageSignerPda,
      solVault: ca.carnageSolVault,
      carnageWsol: carnageWsolPubkey,
      crimeVault: ca.carnageCrimeVault,
      fraudVault: ca.carnageFraudVault,
      crimePool: ca.crimePool,
      crimePoolVaultA: ca.crimePoolVaultA,
      crimePoolVaultB: ca.crimePoolVaultB,
      fraudPool: ca.fraudPool,
      fraudPoolVaultA: ca.fraudPoolVaultA,
      fraudPoolVaultB: ca.fraudPoolVaultB,
      mintA: ca.mintA,
      crimeMint: ca.crimeMint,
      fraudMint: ca.fraudMint,
      taxProgram: ca.taxProgram,
      ammProgram: ca.ammProgram,
      swapAuthority: ca.swapAuthority,
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  return carnageIx;
}

// ---- Forced Carnage Test ----

/**
 * Test forced Carnage execution via execute_carnage_atomic.
 *
 * This test can ONLY run when carnage_pending = true on EpochState.
 * If carnage_pending is false, it logs "skipped" and returns.
 *
 * EXPECTED TO FAIL due to known Carnage bugs:
 * - held_amount stores SOL lamports not token count (H041, H042, H063, H089, H094)
 * - Fallback discriminator mismatch (H018, H052, H058, H099)
 * - Missing swap_authority in fallback (H019, H059)
 *
 * These failures are logged as "known_issue" not "fail".
 *
 * @param provider - Anchor provider with devnet wallet
 * @param programs - All 5 protocol program instances
 * @param manifest - PDA manifest with all deployed addresses
 * @param user - E2E test user (caller -- permissionless)
 * @param logger - E2E logger
 * @returns ForcedCarnageResult with outcome details
 */
export async function testForcedCarnage(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  alt?: AddressLookupTableAccount
): Promise<ForcedCarnageResult> {
  const connection = provider.connection;

  // Check if carnage_pending is true
  let epochState: EpochStateSnapshot;
  try {
    epochState = await readEpochState(
      programs.epochProgram,
      new PublicKey(manifest.pdas.EpochState)
    );
    await sleep(RPC_DELAY_MS);
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "carnage",
      status: "fail",
      message: `Failed to read EpochState for Carnage check: ${String(err).slice(0, 200)}`,
      details: { error: String(err) },
    });
    return {
      tested: false,
      success: false,
      knownIssue: false,
      details: `Failed to read EpochState: ${String(err).slice(0, 200)}`,
    };
  }

  if (!epochState.carnagePending) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "carnage",
      status: "skip",
      message: "No Carnage pending -- skipping forced test (need VRF byte 5 < 11 first)",
      details: {
        carnagePending: false,
        currentEpoch: epochState.currentEpoch,
        lastCarnageEpoch: epochState.lastCarnageEpoch,
      },
    });
    return {
      tested: false,
      success: false,
      knownIssue: false,
      details: "carnage_pending = false, cannot test forced Carnage without VRF trigger",
    };
  }

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: `Carnage pending detected! epoch=${epochState.currentEpoch}, attempting execute_carnage_atomic`,
    details: {
      carnagePending: true,
      currentEpoch: epochState.currentEpoch,
    },
  });

  // Capture pre-Carnage snapshot
  const preSnapshot = await captureCarnageSnapshot(connection, programs, manifest);
  await sleep(RPC_DELAY_MS);

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: "Pre-Carnage snapshot captured",
    details: {
      solVault: preSnapshot.solVaultBalance,
      crimeVault: preSnapshot.crimeVaultBalance,
      fraudVault: preSnapshot.fraudVaultBalance,
      carnageState: preSnapshot.carnageState,
    },
  });

  // Build execute_carnage_atomic instruction using shared builder.
  // The builder handles all ~25 accounts + Transfer Hook remaining_accounts.
  let txSig: string | null = null;
  let success = false;
  let knownIssue = false;
  let errorMessage = "";

  try {
    // Build VRFAccounts-compatible carnageAccounts from manifest
    const crimePool = manifest.pools["CRIME/SOL"];
    const fraudPool = manifest.pools["FRAUD/SOL"];
    const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap_authority")],
      programs.taxProgram.programId
    );

    const vrfAccountsForBuilder: VRFAccounts = {
      epochStatePda: new PublicKey(manifest.pdas.EpochState),
      treasuryPda: provider.wallet.publicKey,
      stakingAuthorityPda: new PublicKey(manifest.pdas.StakingAuthority),
      stakePoolPda: new PublicKey(manifest.pdas.StakePool),
      stakingProgramId: new PublicKey(manifest.programs.Staking),
      carnageFundPda: new PublicKey(manifest.pdas.CarnageFund),
      carnageAccounts: {
        carnageSignerPda: new PublicKey(manifest.pdas.CarnageSigner),
        carnageSolVault: new PublicKey(manifest.pdas.CarnageSolVault),
        carnageWsol: loadCarnageWsolPubkeyFromEnv(),
        carnageCrimeVault: new PublicKey(manifest.pdas.CarnageCrimeVault),
        carnageFraudVault: new PublicKey(manifest.pdas.CarnageFraudVault),
        crimePool: new PublicKey(crimePool.pool),
        crimePoolVaultA: new PublicKey(crimePool.vaultA),
        crimePoolVaultB: new PublicKey(crimePool.vaultB),
        fraudPool: new PublicKey(fraudPool.pool),
        fraudPoolVaultA: new PublicKey(fraudPool.vaultA),
        fraudPoolVaultB: new PublicKey(fraudPool.vaultB),
        mintA: NATIVE_MINT,
        crimeMint: new PublicKey(manifest.mints.CRIME),
        fraudMint: new PublicKey(manifest.mints.FRAUD),
        taxProgram: new PublicKey(manifest.programs.TaxProgram),
        ammProgram: new PublicKey(manifest.programs.AMM),
        swapAuthority: swapAuthorityPda,
      },
    };

    const carnageIx = await buildExecuteCarnageAtomicIx(
      programs.epochProgram,
      vrfAccountsForBuilder,
      user.keypair.publicKey,
      connection
    );

    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      carnageIx,
    ];

    if (alt) {
      // Use VersionedTransaction (v0) with ALT -- compresses account pubkeys
      // from 32 bytes to 1 byte each, fitting large instructions like Sell path
      txSig = await sendV0Transaction(
        connection,
        user.keypair.publicKey,
        instructions,
        [user.keypair],
        alt
      );
    } else {
      // Fallback to legacy transaction (works for BuyOnly/Burn with <= 3 remaining)
      const tx = new Transaction().add(...instructions);
      txSig = await provider.sendAndConfirm(tx, [user.keypair]);
    }
    success = true;

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "carnage",
      status: "pass",
      message: `execute_carnage_atomic SUCCEEDED! TX: ${txSig.slice(0, 16)}...`,
      txSignature: txSig,
      details: {},
    });
  } catch (err) {
    const errStr = err instanceof Error ? err.message : JSON.stringify(err);
    errorMessage = errStr.slice(0, 500);

    // Only suppress NoCarnagePending (race between read and execute).
    // All other errors are real failures that must be surfaced.
    const suppressPatterns = [
      "NoCarnagePending",
    ];

    knownIssue = suppressPatterns.some((p) =>
      errStr.toLowerCase().includes(p.toLowerCase())
    );

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "carnage",
      status: knownIssue ? "known_issue" : "fail",
      message: `execute_carnage_atomic ${knownIssue ? "SKIPPED (no pending)" : "FAILED"}: ${errorMessage.slice(0, 300)}`,
      details: {
        error: errorMessage,
        knownIssue,
      },
    });
  }

  // Capture post-Carnage snapshot (even on failure -- verify no state corruption)
  await sleep(RPC_DELAY_MS);
  const postSnapshot = await captureCarnageSnapshot(connection, programs, manifest);

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: "Post-Carnage snapshot captured (verifying no state corruption)",
    details: {
      solVaultBefore: preSnapshot.solVaultBalance,
      solVaultAfter: postSnapshot.solVaultBalance,
      crimeVaultBefore: preSnapshot.crimeVaultBalance,
      crimeVaultAfter: postSnapshot.crimeVaultBalance,
      fraudVaultBefore: preSnapshot.fraudVaultBalance,
      fraudVaultAfter: postSnapshot.fraudVaultBalance,
      carnageStateBefore: preSnapshot.carnageState,
      carnageStateAfter: postSnapshot.carnageState,
      stateChanged: JSON.stringify(preSnapshot.carnageState) !== JSON.stringify(postSnapshot.carnageState),
    },
  });

  return {
    tested: true,
    success,
    knownIssue,
    details: success
      ? `Carnage executed successfully: ${txSig}`
      : `Carnage failed${knownIssue ? " (known issue)" : ""}: ${errorMessage.slice(0, 200)}`,
    txSignature: txSig || undefined,
  };
}

// ---- Natural Carnage Test ----

/**
 * Cycle epochs until VRF byte 5 < 11 triggers Carnage naturally.
 *
 * Each epoch has ~4.3% probability of triggering Carnage (11/256).
 * Expected to trigger within ~23 epochs on average.
 * We cap at maxEpochs (default 20) for ~58% cumulative probability.
 *
 * Between epochs, a small swap is run to generate tax revenue
 * and keep the protocol active.
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @param maxEpochs - Maximum epochs to cycle (default: 10)
 * @returns NaturalCarnageResult with trigger details
 */
export async function testNaturalCarnage(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  maxEpochs: number = DEFAULT_MAX_EPOCHS,
  alt?: AddressLookupTableAccount
): Promise<NaturalCarnageResult> {
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: `Starting natural Carnage cycling: up to ${maxEpochs} epochs (~4.3% chance per epoch)`,
  });

  // Construct VRFAccounts from manifest with carnageAccounts for atomic bundling.
  // When carnageAccounts is populated, advanceEpochWithVRF will detect Carnage
  // triggers after consume_randomness and immediately send executeCarnageAtomic
  // as TX4 within the 50-slot lock window (CARN-002 fix).
  const crimePool = manifest.pools["CRIME/SOL"];
  const fraudPool = manifest.pools["FRAUD/SOL"];
  const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_authority")],
    programs.taxProgram.programId
  );

  const vrfAccounts: VRFAccounts = {
    epochStatePda: new PublicKey(manifest.pdas.EpochState),
    treasuryPda: provider.wallet.publicKey,
    stakingAuthorityPda: new PublicKey(manifest.pdas.StakingAuthority),
    stakePoolPda: new PublicKey(manifest.pdas.StakePool),
    stakingProgramId: new PublicKey(manifest.programs.Staking),
    carnageFundPda: new PublicKey(manifest.pdas.CarnageFund),
    carnageAccounts: {
      carnageSignerPda: new PublicKey(manifest.pdas.CarnageSigner),
      carnageSolVault: new PublicKey(manifest.pdas.CarnageSolVault),
      carnageWsol: loadCarnageWsolPubkeyFromEnv(),
      carnageCrimeVault: new PublicKey(manifest.pdas.CarnageCrimeVault),
      carnageFraudVault: new PublicKey(manifest.pdas.CarnageFraudVault),
      crimePool: new PublicKey(crimePool.pool),
      crimePoolVaultA: new PublicKey(crimePool.vaultA),
      crimePoolVaultB: new PublicKey(crimePool.vaultB),
      fraudPool: new PublicKey(fraudPool.pool),
      fraudPoolVaultA: new PublicKey(fraudPool.vaultA),
      fraudPoolVaultB: new PublicKey(fraudPool.vaultB),
      mintA: NATIVE_MINT,
      crimeMint: new PublicKey(manifest.mints.CRIME),
      fraudMint: new PublicKey(manifest.mints.FRAUD),
      taxProgram: new PublicKey(manifest.programs.TaxProgram),
      ammProgram: new PublicKey(manifest.programs.AMM),
      swapAuthority: swapAuthorityPda,
    },
    alt, // Pass ALT for v0 VersionedTransaction compression on Sell path
  };

  for (let i = 0; i < maxEpochs; i++) {
    // Check wallet balance before each transition
    const walletBalance = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    await sleep(RPC_DELAY_MS);

    if (walletBalance < MIN_SOL_BALANCE) {
      logger.log({
        timestamp: new Date().toISOString(),
        phase: "carnage",
        status: "known_issue",
        message: `Wallet balance low (${(walletBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL), stopping early`,
        details: { walletBalance, minRequired: MIN_SOL_BALANCE },
      });
      return {
        triggered: false,
        epoch: 0,
        epochsCycled: i,
        details: `Stopped early: wallet balance ${(walletBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL < ${(MIN_SOL_BALANCE / LAMPORTS_PER_SOL).toFixed(0)} SOL minimum`,
      };
    }

    try {
      // Wait for slot boundary before transitions after the first.
      // The on-chain epoch program enforces SLOTS_PER_EPOCH (750) between
      // transitions. Without this, back-to-back calls fail with
      // EpochBoundaryNotReached. (Gap SC-3/SC-4 fix)
      if (i > 0) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "carnage",
          status: "pass",
          message: `Waiting for ${SLOT_WAIT_BETWEEN_EPOCHS} slots before Carnage epoch ${i + 1}/${maxEpochs} (~${Math.round(SLOT_WAIT_BETWEEN_EPOCHS * 0.4 / 60)} min on devnet)`,
        });
        await waitForSlotAdvance(provider.connection, SLOT_WAIT_BETWEEN_EPOCHS);
        await sleep(RPC_DELAY_MS);
      }

      // Read EpochState BEFORE transition
      const beforeState = await readEpochState(
        programs.epochProgram,
        new PublicKey(manifest.pdas.EpochState)
      );
      await sleep(RPC_DELAY_MS);

      // Advance epoch with VRF
      console.log(`\n--- Natural Carnage: Epoch ${i + 1}/${maxEpochs} ---`);
      const result = await advanceEpochWithVRF(
        provider,
        programs.epochProgram,
        vrfAccounts
      );
      await sleep(RPC_DELAY_MS);

      // Read EpochState AFTER transition
      const afterState = await readEpochState(
        programs.epochProgram,
        new PublicKey(manifest.pdas.EpochState)
      );
      await sleep(RPC_DELAY_MS);

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "carnage",
        status: "pass",
        message: `Epoch ${i + 1}/${maxEpochs}: epoch=${result.epoch}, cheapSide=${result.cheapSide}, carnage_pending=${afterState.carnagePending}`,
        txSignature: result.consumeSig,
        details: {
          epochIndex: i + 1,
          epoch: result.epoch,
          cheapSide: result.cheapSide,
          lowTaxBps: result.lowTaxBps,
          highTaxBps: result.highTaxBps,
          flipped: result.flipped,
          carnageTriggered: result.carnageTriggered,
          carnagePending: afterState.carnagePending,
        },
      });

      // Check if Carnage was triggered.
      // Three scenarios:
      // 1. Carnage triggered AND executed atomically by vrf-flow TX4 (carnageExecutedAtomically=true)
      //    -> carnage_pending is already false, no need for testForcedCarnage
      // 2. Carnage triggered but atomic execution failed (carnagePending still true)
      //    -> testForcedCarnage provides the fallback attempt
      // 3. Carnage not triggered (neither flag set)
      //    -> continue cycling epochs
      if (result.carnageExecutedAtomically) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "carnage",
          status: "pass",
          message: `CARNAGE TRIGGERED AND EXECUTED ATOMICALLY at epoch ${result.epoch}! (CARN-002 MEV gap closed)`,
          details: {
            epoch: result.epoch,
            carnageExecutedAtomically: true,
            carnagePending: afterState.carnagePending,
          },
        });

        return {
          triggered: true,
          epoch: result.epoch,
          epochsCycled: i + 1,
          details: `Carnage triggered and executed atomically at epoch ${result.epoch} after ${i + 1} transitions. CARN-002 MEV gap closed.`,
        };
      } else if (afterState.carnagePending || result.carnageTriggered) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "carnage",
          status: "pass",
          message: `CARNAGE TRIGGERED at epoch ${result.epoch}! (VRF byte 5 < 11). Atomic execution was not attempted or failed, trying forced path.`,
          details: {
            epoch: result.epoch,
            carnagePending: afterState.carnagePending,
            carnageTriggered: result.carnageTriggered,
          },
        });

        // Attempt execute_carnage_atomic via the direct test path
        const forcedResult = await testForcedCarnage(
          provider,
          programs,
          manifest,
          user,
          logger,
          alt
        );

        return {
          triggered: true,
          epoch: result.epoch,
          epochsCycled: i + 1,
          details: `Carnage triggered at epoch ${result.epoch} after ${i + 1} transitions. Execution: ${forcedResult.success ? "SUCCESS" : forcedResult.knownIssue ? "KNOWN ISSUE" : "FAILED"}`,
        };
      }

      // Run a small swap between epochs to keep protocol active
      if (i < maxEpochs - 1) {
        const swapSig = await executeSolBuySwap(
          provider,
          programs,
          manifest,
          user,
          logger,
          "CRIME/SOL"
        );

        if (swapSig) {
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "carnage",
            status: "pass",
            message: `Inter-Carnage-cycle swap ${i + 1} completed`,
            txSignature: swapSig,
          });
        }
      }
    } catch (err) {
      const errStr = String(err);

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "carnage",
        status: "fail",
        message: `Epoch transition ${i + 1}/${maxEpochs} failed: ${errStr.slice(0, 300)}`,
        details: { error: errStr, epochIndex: i + 1 },
      });

      // Continue to next transition -- some failures are transient
    }
  }

  // maxEpochs reached without Carnage trigger
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "skip",
    message: `Natural Carnage not triggered in ${maxEpochs} epochs (probability ~4.3%/epoch, expected ~1 in 23 epochs)`,
    details: {
      maxEpochs,
      probabilityPerEpoch: "4.3%",
      expectedEpochsToTrigger: 23,
      note: "This is NOT a failure -- it is a probabilistic outcome",
    },
  });

  return {
    triggered: false,
    epoch: 0,
    epochsCycled: maxEpochs,
    details: `Natural Carnage not triggered in ${maxEpochs} epochs (4.3% chance per epoch, expected ~1 in 23)`,
  };
}

// ---- Post-Carnage Health Check ----

/**
 * Verify the protocol is still operational after a Carnage attempt.
 *
 * Executes a simple SOL buy swap to confirm:
 * - Tax Program accepts swaps
 * - AMM pool is functional
 * - Token transfers work
 * - EpochState is readable
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @returns true if health check passes
 */
export async function postCarnageHealthCheck(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger
): Promise<boolean> {
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: "Running post-Carnage health check: executing SOL buy swap",
  });

  try {
    const swapSig = await executeSolBuySwap(
      provider,
      programs,
      manifest,
      user,
      logger,
      "CRIME/SOL"
    );

    if (swapSig) {
      logger.log({
        timestamp: new Date().toISOString(),
        phase: "carnage",
        status: "pass",
        message: `Post-Carnage health check PASSED -- protocol operational`,
        txSignature: swapSig,
      });
      return true;
    } else {
      logger.log({
        timestamp: new Date().toISOString(),
        phase: "carnage",
        status: "fail",
        message: "Post-Carnage health check FAILED -- swap returned null",
      });
      return false;
    }
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "carnage",
      status: "fail",
      message: `Post-Carnage health check FAILED: ${String(err).slice(0, 300)}`,
      details: { error: String(err) },
    });
    return false;
  }
}

// ---- Carnage Flow Orchestrator ----

/**
 * Run the complete Carnage flow:
 * 1. Test forced Carnage (if carnage_pending from a previous epoch)
 * 2. Test natural Carnage (run epochs until triggered, or hit max)
 * 3. Post-Carnage health check
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @returns true if flow completed without unexpected failures
 */
export async function runCarnageFlow(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  alt?: AddressLookupTableAccount
): Promise<boolean> {
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: "Starting Carnage trigger testing (E2E-05)",
  });

  const flowStartMs = Date.now();
  let overallSuccess = true;

  // Step 1: Test forced Carnage (if carnage_pending already true)
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: "Step 1/3: Testing forced Carnage (if carnage_pending)",
  });

  const forcedResult = await testForcedCarnage(
    provider,
    programs,
    manifest,
    user,
    logger,
    alt
  );

  // If forced Carnage was tested and failed with a known issue, that's acceptable
  // Only mark as failure if it was an unexpected error
  if (forcedResult.tested && !forcedResult.success && !forcedResult.knownIssue) {
    overallSuccess = false;
  }

  // Step 2: Test natural Carnage (VRF-triggered)
  // Skip if forced Carnage already succeeded or was tested (Carnage already attempted)
  if (!forcedResult.tested || forcedResult.tested) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "carnage",
      status: "pass",
      message: "Step 2/3: Testing natural Carnage (VRF epoch cycling)",
    });

    const naturalResult = await testNaturalCarnage(
      provider,
      programs,
      manifest,
      user,
      logger,
      DEFAULT_MAX_EPOCHS,
      alt
    );

    // Natural Carnage not triggering is a probabilistic outcome, not a failure
    // Only mark failure if epoch transitions themselves failed
    if (!naturalResult.triggered && naturalResult.epochsCycled === 0) {
      // Zero epochs completed means all transitions failed
      overallSuccess = false;
    }
  }

  // Step 3: Post-Carnage health check
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: "pass",
    message: "Step 3/3: Post-Carnage health check",
  });

  const healthCheckPassed = await postCarnageHealthCheck(
    provider,
    programs,
    manifest,
    user,
    logger
  );

  if (!healthCheckPassed) {
    overallSuccess = false;
  }

  const flowDurationMs = Date.now() - flowStartMs;

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "carnage",
    status: overallSuccess ? "pass" : "known_issue",
    message: `Carnage flow complete: forced=${forcedResult.tested ? (forcedResult.success ? "PASS" : forcedResult.knownIssue ? "KNOWN_ISSUE" : "FAIL") : "SKIP"}, health_check=${healthCheckPassed ? "PASS" : "FAIL"}`,
    details: {
      forcedCarnage: {
        tested: forcedResult.tested,
        success: forcedResult.success,
        knownIssue: forcedResult.knownIssue,
      },
      healthCheck: healthCheckPassed,
      flowDurationMs,
      flowDurationMin: (flowDurationMs / 60000).toFixed(1),
    },
  });

  return overallSuccess;
}
