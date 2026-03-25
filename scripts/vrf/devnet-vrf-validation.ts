/**
 * VRF Devnet Validation Orchestrator
 *
 * Executes the complete Switchboard VRF validation suite on Solana devnet.
 * Runs 5 consecutive epoch transitions with real oracle randomness, verifies
 * tax rates are within spec bands, runs security tests (anti-reroll, double-commit,
 * timeout recovery), and generates a structured validation report.
 *
 * This is the core deliverable of Phase 35.
 *
 * Run modes:
 *   Full suite:     set -a && source .env && set +a && npx tsx scripts/vrf/devnet-vrf-validation.ts
 *   Security only:  set -a && source .env && set +a && npx tsx scripts/vrf/devnet-vrf-validation.ts --security-only
 *
 * Prerequisites:
 * - Epoch Program deployed to devnet (4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2)
 * - EpochState initialized
 * - Funded wallet (keypairs/devnet-wallet.json) with >= 3 SOL
 * - CLUSTER_URL env var pointing to Helius devnet RPC
 *
 * Timing:
 * - Epoch transitions: ~25-35 minutes for 5 transitions
 * - Security tests: ~5-10 minutes (anti-reroll, double-commit, timeout recovery)
 * - Total: ~35-45 minutes for full suite
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import * as fs from "fs";
import * as path from "path";

import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import {
  advanceEpochWithVRF,
  EpochTransitionResult,
  VRFAccounts,
  sleep,
  waitForSlotAdvance,
} from "./lib/vrf-flow";
import {
  readEpochState,
  verifyTaxRates,
  formatSnapshot,
  EpochStateSnapshot,
} from "./lib/epoch-reader";
import { ValidationReporter } from "./lib/reporter";
import { runSecurityTests } from "./lib/security-tests";
import { verifyTaxRateAppliedToSwap } from "./lib/swap-verifier";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Number of consecutive epoch transitions to run (0 to skip, use with --security-only) */
const NUM_TRANSITIONS = process.argv.includes("--security-only") ? 0 : 5;

/** Whether to run security tests */
const RUN_SECURITY = true;

/** Minimum wallet balance in SOL to proceed */
const MIN_BALANCE_SOL = 3;

/** Slots per epoch (must match the deployed program constant) */
const SLOTS_PER_EPOCH = 750;

/** Milliseconds per slot estimate (conservative for wait calculations) */
const MS_PER_SLOT = 420;

/** Buffer slots to add when waiting for next epoch boundary */
const EPOCH_BOUNDARY_BUFFER_SLOTS = 5;

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Dr Fraudsworth -- VRF Devnet Validation Suite");
  console.log("=".repeat(60));
  console.log();

  // ─── 1. Setup ────────────────────────────────────────────────────────
  console.log("[1/6] Setting up provider and programs...");

  const provider = loadProvider();
  const programs = loadPrograms(provider);
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  console.log(`  Cluster: ${connection.rpcEndpoint.replace(/api-key=[^&]+/, "api-key=***")}`);
  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  Epoch Program: ${programs.epochProgram.programId.toBase58()}`);
  console.log(`  Staking Program: ${programs.staking.programId.toBase58()}`);

  // Load PDA addresses from manifest
  const manifestPath = path.resolve(__dirname, "../deploy/pda-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`PDA manifest not found at: ${manifestPath}`);
    console.error("Run deployment scripts first (Phase 34).");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const accounts: VRFAccounts = {
    epochStatePda: new PublicKey(manifest.pdas.EpochState),
    treasuryPda: wallet.publicKey, // Treasury placeholder (bounty transfer deferred)
    stakingAuthorityPda: new PublicKey(manifest.pdas.StakingAuthority),
    stakePoolPda: new PublicKey(manifest.pdas.StakePool),
    stakingProgramId: new PublicKey(manifest.programs.Staking),
    carnageFundPda: new PublicKey(manifest.pdas.CarnageFund),
  };

  console.log(`  EpochState: ${accounts.epochStatePda.toBase58()}`);
  console.log(`  StakePool: ${accounts.stakePoolPda.toBase58()}`);
  console.log(`  CarnageFund: ${accounts.carnageFundPda.toBase58()}`);
  console.log();

  // ─── 2. Pre-flight Checks ────────────────────────────────────────────
  console.log("[2/6] Running pre-flight checks...");

  // Check wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`  Wallet balance: ${balanceSol.toFixed(4)} SOL`);
  if (balanceSol < MIN_BALANCE_SOL) {
    console.error(
      `  FAIL: Wallet balance ${balanceSol.toFixed(4)} SOL < minimum ${MIN_BALANCE_SOL} SOL`
    );
    process.exit(1);
  }
  console.log(`  OK: Balance >= ${MIN_BALANCE_SOL} SOL`);

  await sleep(200); // Rate limit

  // Check EpochState is initialized and readable
  let initialState: EpochStateSnapshot;
  try {
    initialState = await readEpochState(
      programs.epochProgram as any,
      accounts.epochStatePda
    );
  } catch (e) {
    console.error(
      "  FAIL: Cannot read EpochState. Is it initialized?"
    );
    console.error(`  Error: ${e}`);
    process.exit(1);
  }

  console.log("  EpochState current state:");
  console.log(formatSnapshot(initialState));

  // Check VRF pending state and recover if needed
  if (initialState.vrfPending) {
    console.log(
      "\n  WARNING: VRF is currently pending from a previous request."
    );
    console.log(
      `  Pending since slot: ${initialState.vrfRequestSlot}`
    );
    console.log(
      `  Bound account: ${initialState.pendingRandomnessAccount}`
    );
    console.log(
      "  Recovering: waiting for VRF timeout then retrying with fresh randomness..."
    );

    await recoverPendingVrf(
      provider,
      programs.epochProgram as any,
      accounts,
      initialState.vrfRequestSlot
    );

    // Re-read state after recovery
    initialState = await readEpochState(
      programs.epochProgram as any,
      accounts.epochStatePda
    );
    console.log("  Recovery complete! New state:");
    console.log(formatSnapshot(initialState));
  }

  console.log("  Pre-flight checks passed!");
  console.log();

  // ─── 3. Initialize Reporter ──────────────────────────────────────────
  const reporter = new ValidationReporter(
    connection.rpcEndpoint,
    wallet.publicKey.toBase58(),
    SLOTS_PER_EPOCH
  );

  // ─── 4. Run Epoch Transitions ────────────────────────────────────────
  console.log(`[3/6] Running ${NUM_TRANSITIONS} consecutive VRF epoch transitions...`);
  console.log(`  SLOTS_PER_EPOCH: ${SLOTS_PER_EPOCH} (~${((SLOTS_PER_EPOCH * MS_PER_SLOT) / 60000).toFixed(1)} min)`);
  console.log();

  const results: EpochTransitionResult[] = [];
  let allValid = true;

  for (let i = 0; i < NUM_TRANSITIONS; i++) {
    console.log("-".repeat(60));
    console.log(`  TRANSITION ${i + 1}/${NUM_TRANSITIONS}`);
    console.log("-".repeat(60));

    // Wait for epoch boundary if not the first transition
    if (i > 0) {
      await waitForEpochBoundary(
        connection,
        accounts.epochStatePda,
        programs.epochProgram as any
      );
    } else {
      // For the first transition, check if we need to wait
      const currentSlot = await connection.getSlot();
      const currentState = await readEpochState(
        programs.epochProgram as any,
        accounts.epochStatePda
      );
      const genesisSlot = currentState.genesisSlot;
      const currentEpochNum = Math.floor(
        (currentSlot - genesisSlot) / SLOTS_PER_EPOCH
      );
      const stateEpoch = currentState.currentEpoch;

      if (currentEpochNum <= stateEpoch && !currentState.vrfPending) {
        // Haven't crossed an epoch boundary yet -- need to wait
        console.log(
          `  Current epoch calc: ${currentEpochNum}, state epoch: ${stateEpoch}`
        );
        console.log("  Waiting for next epoch boundary...");
        await waitForEpochBoundary(
          connection,
          accounts.epochStatePda,
          programs.epochProgram as any
        );
      } else {
        console.log(
          `  Epoch boundary already passed (calc: ${currentEpochNum} > state: ${stateEpoch}). Proceeding immediately.`
        );
      }
    }

    // Execute the 3-TX VRF flow
    console.log("  Starting VRF flow...");
    let result: EpochTransitionResult;
    try {
      result = await advanceEpochWithVRF(
        provider,
        programs.epochProgram as any,
        accounts
      );
    } catch (e: any) {
      console.error(`  FAIL: Epoch transition ${i + 1} failed: ${e.message}`);
      if (e.logs) {
        console.error("  Transaction logs:");
        e.logs.forEach((log: string) => console.error(`    ${log}`));
      }
      process.exit(1);
    }

    results.push(result);
    reporter.addEpochTransition(result);

    // Verify tax rates
    await sleep(200);
    const snapshot = await readEpochState(
      programs.epochProgram as any,
      accounts.epochStatePda
    );
    const verification = verifyTaxRates(snapshot);

    // Log progress
    const flipStr = result.flipped ? "FLIPPED" : "no flip";
    console.log(
      `  Epoch ${i + 1}/5: epoch=${result.epoch}, cheapSide=${result.cheapSide}, ` +
        `low=${result.lowTaxBps}bps, high=${result.highTaxBps}bps, ${flipStr}`
    );

    if (result.carnageTriggered) {
      console.log(
        `  ** CARNAGE TRIGGERED this epoch! (VRF byte 5 < 11)`
      );
    }

    if (!verification.valid) {
      console.error(
        `  TAX VERIFICATION FAILED for epoch ${result.epoch}:`
      );
      verification.errors.forEach((err) => console.error(`    - ${err}`));
      allValid = false;
    } else {
      console.log("  Tax rates verified OK");
    }

    console.log(
      `  Duration: ${(result.durationMs / 1000).toFixed(1)}s`
    );
    console.log();
  }

  // ─── 5. Security Tests ──────────────────────────────────────────────
  if (RUN_SECURITY) {
    console.log("[4/6] Running VRF security tests...");
    console.log();

    try {
      const { securityResults, timeoutResult } = await runSecurityTests(
        provider,
        programs.epochProgram as any,
        accounts,
        waitForEpochBoundary
      );

      // Add results to reporter
      for (const sr of securityResults) {
        reporter.addSecurityTest(sr);
        const icon = sr.passed ? "PASS" : "FAIL";
        console.log(`  [${icon}] ${sr.name}: ${sr.details.slice(0, 100)}`);
        if (!sr.passed) allValid = false;
      }

      if (timeoutResult) {
        reporter.addTimeoutRecovery(timeoutResult);
        const icon = timeoutResult.passed ? "PASS" : "FAIL";
        console.log(`  [${icon}] Timeout Recovery: ${timeoutResult.details.slice(0, 100)}`);
        if (!timeoutResult.passed) allValid = false;
      }
    } catch (e: any) {
      console.error(`  Security tests failed with error: ${e.message}`);
      reporter.addSecurityTest({
        name: "Security Test Suite",
        passed: false,
        details: `Suite failed: ${e.message}`,
      });
      // Security test failure doesn't block report generation
    }

    console.log();
  }

  // ─── 6. Swap Verification ─────────────────────────────────────────────
  console.log("[5/6] Verifying tax rate application (swap verification)...");

  try {
    const swapResult = await verifyTaxRateAppliedToSwap(
      programs.epochProgram as any,
      accounts.epochStatePda
    );
    reporter.addSwapVerification(swapResult);
    const icon = swapResult.passed ? "PASS" : "FAIL";
    console.log(`  [${icon}] Swap Verification: ${swapResult.details.slice(0, 100)}`);
    if (!swapResult.passed) allValid = false;
  } catch (e: any) {
    console.error(`  Swap verification failed: ${e.message}`);
  }

  console.log();

  // ─── 7. Generate Report ──────────────────────────────────────────────
  console.log("[6/6] Generating validation report...");

  // Write to both scripts/vrf/ (working copy) and Docs/ (permanent record)
  const reportPath = path.resolve(__dirname, "vrf-validation-report.md");
  reporter.writeToFile(reportPath);

  const docsReportPath = path.resolve(__dirname, "../../Docs/VRF_Devnet_Validation_Report.md");
  reporter.writeToFile(docsReportPath);

  // ─── 8. Summary ──────────────────────────────────────────────────────
  console.log();
  console.log("=".repeat(60));
  console.log("  VRF DEVNET VALIDATION COMPLETE");
  console.log("=".repeat(60));
  console.log();
  console.log(`  Transitions: ${results.length}/${NUM_TRANSITIONS || "skipped"}`);

  // Check for variety (at least one flip expected with 75% flip probability)
  const flipCount = results.filter((r) => r.flipped).length;
  console.log(`  Flips observed: ${flipCount}/${results.length}`);

  // Check for unique cheap sides
  const uniqueCheapSides = new Set(results.map((r) => r.cheapSide));
  console.log(
    `  Unique cheap sides: ${Array.from(uniqueCheapSides).join(", ")}`
  );

  // Check for carnage triggers
  const carnageCount = results.filter((r) => r.carnageTriggered).length;
  console.log(`  Carnage triggers: ${carnageCount}/${results.length}`);

  // Tax rate variety
  const uniqueLow = new Set(results.map((r) => r.lowTaxBps));
  const uniqueHigh = new Set(results.map((r) => r.highTaxBps));
  console.log(
    `  Unique low rates: ${Array.from(uniqueLow).sort().join(", ")} bps`
  );
  console.log(
    `  Unique high rates: ${Array.from(uniqueHigh).sort().join(", ")} bps`
  );

  console.log();
  console.log(
    `  All tax verifications: ${allValid ? "PASSED" : "FAILED"}`
  );
  console.log(`  Report: ${reportPath}`);
  console.log(`  Docs report: ${docsReportPath}`);

  // Final balance check
  await sleep(200);
  const finalBalance = await connection.getBalance(wallet.publicKey);
  const finalSol = finalBalance / LAMPORTS_PER_SOL;
  const costSol = balanceSol - finalSol;
  console.log(
    `  SOL spent: ${costSol.toFixed(4)} SOL (${balanceSol.toFixed(4)} -> ${finalSol.toFixed(4)})`
  );
  console.log();

  if (!allValid) {
    console.error("VALIDATION FAILED: Some tax verifications did not pass.");
    process.exit(1);
  }

  console.log("All validations passed!");
  process.exit(0);
}

// ─── Pending VRF Recovery ───────────────────────────────────────────────────

/**
 * Recover from a pending VRF state left by a previous failed run.
 *
 * If VRF is pending, the script cannot call trigger_epoch_transition (it will
 * fail with VrfAlreadyPending). We need to either complete the pending VRF
 * or wait for VRF timeout and use retry_epoch_vrf.
 *
 * Strategy: Wait for VRF timeout (300 slots ~2 min), then create fresh
 * randomness, call retry_epoch_vrf + commit, wait for oracle, reveal + consume.
 */
async function recoverPendingVrf(
  provider: AnchorProvider,
  epochProgram: anchor.Program,
  accounts: VRFAccounts,
  vrfRequestSlot: number
): Promise<void> {
  const connection = provider.connection;
  const wallet = provider.wallet as Wallet;

  // Calculate how many slots until VRF timeout
  const VRF_TIMEOUT_SLOTS = 300;
  const currentSlot = await connection.getSlot();
  const timeoutSlot = vrfRequestSlot + VRF_TIMEOUT_SLOTS;
  const slotsToWait = timeoutSlot - currentSlot;

  if (slotsToWait > 0) {
    const waitMin = ((slotsToWait * 420) / 60000).toFixed(1);
    console.log(
      `  Waiting for VRF timeout: ~${slotsToWait} slots (~${waitMin} min)`
    );
    await waitForSlotAdvance(connection, slotsToWait + 5); // Extra buffer
  } else {
    console.log("  VRF timeout already elapsed. Proceeding with retry.");
  }

  await sleep(500);

  // Setup Switchboard
  console.log("  [recovery] Setting up Switchboard for retry...");
  const sbProgramId = await sb.getProgramId(connection);
  await sleep(200);
  const sbIdl = await Program.fetchIdl(sbProgramId, provider);
  if (!sbIdl) throw new Error("Failed to fetch Switchboard IDL");
  const sbProgram = new Program(sbIdl, provider);
  await sleep(200);
  const queueAccount = await sb.getDefaultQueue(connection.rpcEndpoint);

  // Create fresh randomness account
  console.log("  [recovery] Creating fresh randomness account...");
  const retryRngKp = Keypair.generate();
  const [retryRandomness, retryCreateIx] = await sb.Randomness.create(
    sbProgram as any,
    retryRngKp,
    queueAccount.pubkey
  );

  const retryCreateTx = new Transaction().add(retryCreateIx);
  retryCreateTx.feePayer = wallet.publicKey;
  retryCreateTx.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  retryCreateTx.sign(wallet.payer, retryRngKp);

  const retryCreateSig = await connection.sendRawTransaction(
    retryCreateTx.serialize(),
    { skipPreflight: true, maxRetries: 3 }
  );
  console.log("  [recovery] Waiting for finalization...");
  await connection.confirmTransaction(retryCreateSig, "finalized");

  await sleep(200);

  // Retry commit using retry_epoch_vrf
  console.log("  [recovery] Sending retry_epoch_vrf + commit...");
  const retryCommitIx = await retryRandomness.commitIx(queueAccount.pubkey);
  const retryIx = await epochProgram.methods
    .retryEpochVrf()
    .accounts({
      payer: wallet.publicKey,
      epochState: accounts.epochStatePda,
      randomnessAccount: retryRngKp.publicKey,
    })
    .instruction();

  const retryCommitTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    retryCommitIx,
    retryIx
  );
  await provider.sendAndConfirm(retryCommitTx, [wallet.payer]);
  console.log("  [recovery] Retry commit succeeded");

  // Wait for oracle
  await waitForSlotAdvance(connection, 3);

  // Try reveal
  console.log("  [recovery] Getting reveal instruction...");
  let revealIx;
  for (let i = 0; i < 20; i++) {
    try {
      revealIx = await retryRandomness.revealIx();
      console.log(`  [recovery] Got reveal (attempt ${i + 1})`);
      break;
    } catch (e) {
      if (i === 19) throw new Error(`Recovery reveal failed after 20 retries: ${e}`);
      console.log(`  [recovery] Reveal not ready (${i + 1}/20), waiting 3s...`);
      await sleep(3000);
    }
  }

  // Consume randomness
  const consumeIx = await epochProgram.methods
    .consumeRandomness()
    .accounts({
      caller: wallet.publicKey,
      epochState: accounts.epochStatePda,
      randomnessAccount: retryRngKp.publicKey,
      stakingAuthority: accounts.stakingAuthorityPda,
      stakePool: accounts.stakePoolPda,
      stakingProgram: accounts.stakingProgramId,
      carnageState: accounts.carnageFundPda,
    })
    .instruction();

  const consumeTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    revealIx!,
    consumeIx
  );
  await provider.sendAndConfirm(consumeTx, [wallet.payer]);
  console.log("  [recovery] VRF recovery complete -- pending state cleared");
}

// ─── Epoch Boundary Waiting ────────────────────────────────────────────────

/**
 * Wait for the next epoch boundary by polling slot advancement.
 *
 * Calculates how many slots remain until the next epoch starts, then
 * sleeps for the estimated time with periodic slot checks.
 *
 * @param connection Solana connection
 * @param epochStatePda EpochState PDA address
 * @param epochProgram Epoch Program instance
 */
async function waitForEpochBoundary(
  connection: anchor.web3.Connection,
  epochStatePda: PublicKey,
  epochProgram: anchor.Program
): Promise<void> {
  const state = await (epochProgram.account as any).epochState.fetch(epochStatePda);
  const genesisSlot =
    typeof state.genesisSlot === "number"
      ? state.genesisSlot
      : state.genesisSlot.toNumber();
  const stateEpoch = state.currentEpoch;

  const currentSlot = await connection.getSlot();
  const currentEpochCalc = Math.floor(
    (currentSlot - genesisSlot) / SLOTS_PER_EPOCH
  );

  // If we're already past the next epoch boundary, return immediately
  if (currentEpochCalc > stateEpoch) {
    console.log(
      `  Epoch boundary already crossed (calc: ${currentEpochCalc} > state: ${stateEpoch})`
    );
    return;
  }

  // Calculate how many slots until next epoch boundary
  const nextEpochStart = genesisSlot + (stateEpoch + 1) * SLOTS_PER_EPOCH;
  const slotsRemaining = nextEpochStart - currentSlot + EPOCH_BOUNDARY_BUFFER_SLOTS;

  if (slotsRemaining <= 0) {
    console.log("  Already past epoch boundary with buffer.");
    return;
  }

  const estimatedMs = slotsRemaining * MS_PER_SLOT;
  const estimatedMin = (estimatedMs / 60000).toFixed(1);

  console.log(
    `  Waiting for epoch boundary: ~${slotsRemaining} slots (~${estimatedMin} min)`
  );
  console.log(
    `  Next epoch ${stateEpoch + 1} starts at slot ${nextEpochStart}`
  );

  // Poll every 15 seconds (increased from 10s to respect Helius rate limits)
  const pollIntervalMs = 15000;
  let lastLogTime = Date.now();

  while (true) {
    await sleep(pollIntervalMs);

    // Wrap getSlot in retry logic to handle transient network errors
    let nowSlot: number;
    try {
      nowSlot = await connection.getSlot();
    } catch (e) {
      console.log(`  ... RPC error during slot poll (retrying): ${(e as Error).message?.slice(0, 80)}`);
      await sleep(5000); // Extra wait on error
      continue;
    }

    const nowEpoch = Math.floor((nowSlot - genesisSlot) / SLOTS_PER_EPOCH);

    if (nowEpoch > stateEpoch) {
      console.log(
        `  Epoch boundary reached at slot ${nowSlot} (epoch ${nowEpoch})`
      );
      return;
    }

    // Log progress every 60 seconds
    const now = Date.now();
    if (now - lastLogTime > 60000) {
      const remaining = nextEpochStart - nowSlot;
      const remMin = ((remaining * MS_PER_SLOT) / 60000).toFixed(1);
      console.log(
        `  ... waiting: slot ${nowSlot}, ~${remaining} slots (~${remMin} min) remaining`
      );
      lastLogTime = now;
    }
  }
}

// ─── Entry Point ───────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
