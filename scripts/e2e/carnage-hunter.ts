/**
 * Carnage Hunter -- Forced path testing for all Carnage execution flows.
 *
 * Uses the devnet-only `force_carnage` instruction to set carnage_pending
 * on EpochState, then immediately calls execute_carnage_atomic to test
 * the actual execution path. No VRF cycling needed.
 *
 * Tests are CHAINED so each test's output provides holdings for the next:
 * 1. BuyOnly CRIME        → establishes CRIME holdings
 * 2. Burn + Buy FRAUD     → burns CRIME, buys FRAUD (cross-token burn)
 * 3. Sell + Buy CRIME     → sells FRAUD, buys CRIME (sell path)
 * 4. Burn + Buy CRIME     → burns CRIME, buys CRIME (SAME-token burn = Bug 1 fix!)
 * 5. Sell + Buy FRAUD     → sells CRIME, buys FRAUD (sell cross-token)
 * 6. BuyOnly FRAUD        → no disposal, buys FRAUD (overwrite test)
 *
 * Before each test, 0.05 SOL is transferred from the wallet to the Carnage
 * SOL vault so there's always SOL to swap with.
 *
 * Run:
 *   set -a && source .env && set +a && npx tsx scripts/e2e/carnage-hunter.ts
 */

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import { createE2EUser } from "./lib/user-setup";
import { testForcedCarnage, captureCarnageSnapshot } from "./lib/carnage-flow";
import { getOrCreateProtocolALT } from "./lib/alt-helper";
import { E2ELogger } from "./lib/e2e-logger";
import { PDAManifest } from "./devnet-e2e-validation";
import { loadDeployment } from "./lib/load-deployment";

// ---- Constants ----

const LOG_PATH = path.resolve(__dirname, "carnage-hunter.jsonl");
const RPC_DELAY_MS = 300;
const FUND_AMOUNT = 0.05 * LAMPORTS_PER_SOL; // 0.05 SOL per test

// Carnage action codes (must match on-chain CarnageAction enum)
const ACTION_NONE = 0; // BuyOnly (no prior holdings)
const ACTION_BURN = 1; // 98% path
const ACTION_SELL = 2; // 2% path

// Carnage target codes (must match on-chain Token enum)
const TARGET_CRIME = 0;
const TARGET_FRAUD = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Types ----

interface TestCase {
  name: string;
  action: number;
  actionName: string;
  target: number;
  targetName: string;
}

interface TestResult {
  testCase: TestCase;
  success: boolean;
  error: string | null;
  txSignature: string | null;
  preSnapshot: {
    solVault: number;
    crimeVault: string | null;
    fraudVault: string | null;
    heldToken: number;
    heldAmount: string;
  } | null;
  postSnapshot: {
    solVault: number;
    crimeVault: string | null;
    fraudVault: string | null;
    heldToken: number;
    heldAmount: string;
  } | null;
}

// ---- Test Chain ----
// Order is critical: each test's result provides holdings for the next.
// This tests all 3 action types × 2 targets, including the critical
// same-token burn path (test 4) that triggered Bug 1.

const TEST_CASES: TestCase[] = [
  {
    name: "BuyOnly CRIME",
    action: ACTION_NONE,
    actionName: "BuyOnly",
    target: TARGET_CRIME,
    targetName: "CRIME",
  },
  {
    name: "Burn + Buy FRAUD (cross-token)",
    action: ACTION_BURN,
    actionName: "Burn",
    target: TARGET_FRAUD,
    targetName: "FRAUD",
  },
  {
    name: "Sell + Buy CRIME",
    action: ACTION_SELL,
    actionName: "Sell",
    target: TARGET_CRIME,
    targetName: "CRIME",
  },
  {
    name: "Burn + Buy CRIME (same-token = Bug1 fix)",
    action: ACTION_BURN,
    actionName: "Burn",
    target: TARGET_CRIME,
    targetName: "CRIME",
  },
  {
    name: "Sell + Buy FRAUD (cross-token)",
    action: ACTION_SELL,
    actionName: "Sell",
    target: TARGET_FRAUD,
    targetName: "FRAUD",
  },
  {
    name: "BuyOnly FRAUD",
    action: ACTION_NONE,
    actionName: "BuyOnly",
    target: TARGET_FRAUD,
    targetName: "FRAUD",
  },
];

// ---- Main ----

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  CARNAGE HUNTER -- FORCED PATH TESTING");
  console.log(`  Tests: ${TEST_CASES.length} chained path combinations`);
  console.log(`  SOL per test: ${FUND_AMOUNT / LAMPORTS_PER_SOL} SOL`);
  console.log(
    `  Total SOL budget: ${(TEST_CASES.length * FUND_AMOUNT) / LAMPORTS_PER_SOL} SOL`
  );
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
  console.log();

  // Clear log
  fs.writeFileSync(LOG_PATH, "", "utf-8");

  const provider = loadProvider();
  const programs = loadPrograms(provider);
  // Load deployment addresses from deployments/devnet.json (Phase 95)
  const manifest: PDAManifest = loadDeployment();

  const logger = new E2ELogger(
    path.resolve(__dirname, "carnage-hunter-dummy.jsonl")
  );

  const solVaultPda = new PublicKey(manifest.pdas.CarnageSolVault);
  const epochStatePda = new PublicKey(manifest.pdas.EpochState);

  // Check wallet
  const balance = await provider.connection.getBalance(
    provider.wallet.publicKey
  );
  console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  console.log();

  // Create or load protocol-wide Address Lookup Table
  console.log("Setting up Address Lookup Table...");
  const alt = await getOrCreateProtocolALT(provider, manifest);
  console.log();

  // Create user
  console.log("Creating test user...");
  const user = await createE2EUser(provider, manifest.mints, 0);
  console.log(`User: ${user.keypair.publicKey.toBase58()}`);
  console.log();

  // Initial vault state
  const initialSnap = await captureCarnageSnapshot(
    provider.connection,
    programs,
    manifest
  );
  console.log("=== INITIAL VAULT STATE ===");
  console.log(
    `  SOL vault: ${(initialSnap.solVaultBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`
  );
  console.log(`  CRIME vault: ${initialSnap.crimeVaultBalance ?? "N/A"}`);
  console.log(`  FRAUD vault: ${initialSnap.fraudVaultBalance ?? "N/A"}`);
  if (initialSnap.carnageState) {
    const held = initialSnap.carnageState.heldToken;
    const heldName = held === 0 ? "None" : held === 1 ? "CRIME" : "FRAUD";
    console.log(
      `  Held: ${heldName} (${initialSnap.carnageState.heldAmount})`
    );
    console.log(
      `  Total triggers so far: ${initialSnap.carnageState.totalTriggers}`
    );
  }
  console.log();

  // Run each test case
  const results: TestResult[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`--- [${i + 1}/${TEST_CASES.length}] ${tc.name} ---`);

    // 0. Fund SOL vault before each test
    console.log(
      `  Funding SOL vault with ${FUND_AMOUNT / LAMPORTS_PER_SOL} SOL...`
    );
    try {
      const fundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: solVaultPda,
          lamports: FUND_AMOUNT,
        })
      );
      await provider.sendAndConfirm(fundTx);
      console.log("  Funded.");
    } catch (err) {
      console.log(`  FAILED to fund: ${String(err).slice(0, 200)}`);
      results.push({
        testCase: tc,
        success: false,
        error: `Funding failed: ${String(err).slice(0, 200)}`,
        txSignature: null,
        preSnapshot: null,
        postSnapshot: null,
      });
      console.log();
      continue;
    }

    await sleep(RPC_DELAY_MS);

    // 1. Capture pre-snapshot
    const preSnap = await captureCarnageSnapshot(
      provider.connection,
      programs,
      manifest
    );

    if (preSnap.carnageState) {
      const heldName =
        preSnap.carnageState.heldToken === 0
          ? "None"
          : preSnap.carnageState.heldToken === 1
            ? "CRIME"
            : "FRAUD";
      console.log(
        `  Pre: Held=${heldName} (${preSnap.carnageState.heldAmount})`
      );
    }
    console.log(
      `  Pre: SOL vault=${(preSnap.solVaultBalance / LAMPORTS_PER_SOL).toFixed(6)}`
    );

    // 2. Call force_carnage to set pending state
    console.log(
      `  Forcing: target=${tc.targetName}(${tc.target}), action=${tc.actionName}(${tc.action})`
    );
    try {
      const forceTx = await programs.epochProgram.methods
        .forceCarnage(tc.target, tc.action)
        .accounts({
          authority: provider.wallet.publicKey,
          epochState: epochStatePda,
        })
        .rpc();
      console.log(`  force_carnage TX: ${forceTx.slice(0, 20)}...`);
    } catch (err) {
      const errStr = String(err).slice(0, 400);
      console.log(`  FAILED to force Carnage: ${errStr}`);
      results.push({
        testCase: tc,
        success: false,
        error: `force_carnage failed: ${errStr}`,
        txSignature: null,
        preSnapshot: null,
        postSnapshot: null,
      });
      console.log();
      continue;
    }

    await sleep(RPC_DELAY_MS);

    // 3. Execute Carnage (using ALT for v0 transaction compression)
    console.log("  Executing carnage...");
    const forcedResult = await testForcedCarnage(
      provider,
      programs,
      manifest,
      user,
      logger,
      alt
    );

    // 4. Post-snapshot (extra delay for v0 TX state propagation with skipPreflight)
    await sleep(2000);
    const postSnap = await captureCarnageSnapshot(
      provider.connection,
      programs,
      manifest
    );

    const result: TestResult = {
      testCase: tc,
      success: forcedResult.success,
      error: forcedResult.success ? null : forcedResult.details,
      txSignature: forcedResult.txSignature || null,
      preSnapshot: preSnap.carnageState
        ? {
            solVault: preSnap.solVaultBalance,
            crimeVault: preSnap.crimeVaultBalance,
            fraudVault: preSnap.fraudVaultBalance,
            heldToken: preSnap.carnageState.heldToken,
            heldAmount: preSnap.carnageState.heldAmount,
          }
        : null,
      postSnapshot: postSnap.carnageState
        ? {
            solVault: postSnap.solVaultBalance,
            crimeVault: postSnap.crimeVaultBalance,
            fraudVault: postSnap.fraudVaultBalance,
            heldToken: postSnap.carnageState.heldToken,
            heldAmount: postSnap.carnageState.heldAmount,
          }
        : null,
    };

    results.push(result);
    fs.appendFileSync(LOG_PATH, JSON.stringify(result) + "\n", "utf-8");

    // Print result
    if (forcedResult.success) {
      console.log("  >>> SUCCESS");
      console.log(
        `  SOL: ${(preSnap.solVaultBalance / LAMPORTS_PER_SOL).toFixed(6)} -> ${(postSnap.solVaultBalance / LAMPORTS_PER_SOL).toFixed(6)}`
      );
      console.log(
        `  CRIME: ${preSnap.crimeVaultBalance} -> ${postSnap.crimeVaultBalance}`
      );
      console.log(
        `  FRAUD: ${preSnap.fraudVaultBalance} -> ${postSnap.fraudVaultBalance}`
      );
      if (postSnap.carnageState) {
        const newHeld =
          postSnap.carnageState.heldToken === 1 ? "CRIME" : "FRAUD";
        console.log(
          `  Now holding: ${postSnap.carnageState.heldAmount} ${newHeld}`
        );
      }
    } else {
      console.log(`  >>> FAILED: ${forcedResult.details.slice(0, 400)}`);
    }
    console.log();

    // Brief pause between tests
    await sleep(500);
  }

  // ---- Summary ----
  console.log();
  console.log("=".repeat(60));
  console.log("  CARNAGE HUNTER RESULTS");
  console.log("=".repeat(60));
  console.log();

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter(
    (r) => !r.success && !r.error?.startsWith("Skipped")
  ).length;
  const skipped = results.filter((r) =>
    r.error?.startsWith("Skipped")
  ).length;

  console.log(
    `Total: ${results.length} | Pass: ${passed} | Fail: ${failed} | Skip: ${skipped}`
  );
  console.log();

  for (const r of results) {
    const status = r.success
      ? "PASS"
      : r.error?.startsWith("Skipped")
        ? "SKIP"
        : "FAIL";
    console.log(`  [${status}] ${r.testCase.name}`);
    if (r.error) {
      console.log(`    ${r.error.slice(0, 300)}`);
    }
    if (r.preSnapshot && r.postSnapshot) {
      console.log(
        `    CRIME: ${r.preSnapshot.crimeVault} -> ${r.postSnapshot.crimeVault}`
      );
      console.log(
        `    FRAUD: ${r.preSnapshot.fraudVault} -> ${r.postSnapshot.fraudVault}`
      );
      console.log(
        `    Held: ${r.preSnapshot.heldToken}->${r.postSnapshot.heldToken}, ` +
          `amount: ${r.preSnapshot.heldAmount}->${r.postSnapshot.heldAmount}`
      );
    }
    console.log();
  }

  // Path coverage
  const pathsCovered = new Map<string, string>();
  for (const r of results) {
    const key = `${r.testCase.actionName}+${r.testCase.targetName}`;
    if (r.success) {
      pathsCovered.set(key, "PASS");
    } else if (!pathsCovered.has(key)) {
      pathsCovered.set(
        key,
        r.error?.startsWith("Skipped") ? "SKIP" : "FAIL"
      );
    }
  }
  console.log("Path coverage (action + target):");
  for (const [key, status] of pathsCovered) {
    console.log(`  ${key}: ${status}`);
  }
  console.log();
  console.log(`Log: ${LOG_PATH}`);

  // Exit with error if any real failures
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", String(err).slice(0, 500));
  process.exit(1);
});
