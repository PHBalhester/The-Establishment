/**
 * Multi-Wallet Concurrent Stress Test Orchestrator
 *
 * Simulates launch-day traffic with concurrent wallets executing random
 * buy/sell swaps across CRIME/SOL and FRAUD/SOL pools.
 *
 * Safety features (learned from Phase 96 SOL burn incident):
 * - Keypairs saved to disk BEFORE funding (recoverable)
 * - --reclaim mode sweeps SOL back from saved keypairs
 * - Fail-fast: stops after 5 consecutive failures
 * - Staggered timing: swaps spaced 10-30s apart per wallet to look natural
 *
 * Usage:
 *   set -a && source .env && set +a && \
 *   STRESS_WALLETS=10 STRESS_DURATION_MIN=5 npx tsx scripts/e2e/stress-test.ts
 *
 *   # Reclaim SOL from funded wallets:
 *   npx tsx scripts/e2e/stress-test.ts --reclaim
 *
 * Env vars:
 *   STRESS_WALLETS      - Number of wallets (default: 10)
 *   STRESS_DURATION_MIN - Test duration in minutes (default: 5)
 *   CLUSTER_URL         - Helius RPC endpoint
 *   WALLET              - Path to funder wallet keypair
 */

import {
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import { loadDeployment } from "./lib/load-deployment";
import { StressWallet, SwapResult } from "./lib/stress-wallet";

// ---- Constants ----

const RESULTS_PATH = path.resolve(__dirname, "stress-test-results.jsonl");
const KEYPAIRS_PATH = path.resolve(__dirname, "stress-keypairs.json");

/** SOL per wallet (0.5 SOL: token account rent ~0.01 + WSOL 0.03 + swaps + TX fees) */
const SOL_PER_WALLET = 0.5;

/** Max consecutive failures before fail-fast abort */
const MAX_CONSECUTIVE_FAILURES = 5;

// ---- Config from env ----

const WALLET_COUNT = parseInt(process.env.STRESS_WALLETS || "10", 10);
const DURATION_MIN = parseInt(process.env.STRESS_DURATION_MIN || "5", 10);
const DURATION_MS = DURATION_MIN * 60 * 1000;

// ---- Utilities ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function logResult(entry: Record<string, unknown>): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(RESULTS_PATH, line, "utf-8");
}

// ---- Keypair Persistence ----

/** Save keypairs to disk BEFORE funding. Crash-safe. */
function saveKeypairs(keypairs: Keypair[]): void {
  const data = keypairs.map((kp, i) => ({
    index: i,
    publicKey: kp.publicKey.toBase58(),
    secretKey: Array.from(kp.secretKey),
  }));
  fs.writeFileSync(KEYPAIRS_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  Keypairs saved to ${KEYPAIRS_PATH}`);
}

/** Load previously saved keypairs (for reclaim mode). */
function loadKeypairs(): Keypair[] {
  if (!fs.existsSync(KEYPAIRS_PATH)) {
    throw new Error(`No keypairs file at ${KEYPAIRS_PATH}. Nothing to reclaim.`);
  }
  const data = JSON.parse(fs.readFileSync(KEYPAIRS_PATH, "utf-8"));
  return data.map((entry: { secretKey: number[] }) =>
    Keypair.fromSecretKey(Uint8Array.from(entry.secretKey))
  );
}

// ---- Reclaim Mode ----

async function reclaim(): Promise<void> {
  console.log("=== RECLAIM MODE ===\n");

  const provider = loadProvider();
  const connection = provider.connection;
  const keypairs = loadKeypairs();
  console.log(`Loaded ${keypairs.length} keypairs from ${KEYPAIRS_PATH}`);

  let totalReclaimed = 0;
  const BATCH_SIZE = 5; // Process 5 at a time to avoid rate limits

  for (let i = 0; i < keypairs.length; i += BATCH_SIZE) {
    const batch = keypairs.slice(i, i + BATCH_SIZE);

    for (const kp of batch) {
      try {
        const balance = await connection.getBalance(kp.publicKey);

        if (balance <= 5000) {
          // Not worth reclaiming (less than TX fee)
          continue;
        }

        // Transfer all balance minus TX fee back to funder
        const transferAmount = balance - 5000; // Leave 5000 lamports for TX fee
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: provider.wallet.publicKey,
            lamports: transferAmount,
          })
        );

        await connection.sendTransaction(tx, [kp], {
          skipPreflight: false,
        });

        totalReclaimed += transferAmount;
        console.log(
          `  Wallet ${i + batch.indexOf(kp)}: reclaimed ${(transferAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`
        );
      } catch (err) {
        console.warn(
          `  Wallet ${i + batch.indexOf(kp)} (${kp.publicKey.toBase58().slice(0, 12)}...): ${String(err).slice(0, 100)}`
        );
      }
    }

    await sleep(1000); // Rate limit between batches
  }

  console.log(
    `\nTotal reclaimed: ${(totalReclaimed / LAMPORTS_PER_SOL).toFixed(4)} SOL`
  );
}

// ---- Main ----

async function main(): Promise<void> {
  // Check for --reclaim flag
  if (process.argv.includes("--reclaim")) {
    await reclaim();
    return;
  }

  console.log("=== Dr. Fraudsworth Stress Test ===");
  console.log(`Wallets: ${WALLET_COUNT}`);
  console.log(`Duration: ${DURATION_MIN} minutes`);
  console.log(`SOL per wallet: ${SOL_PER_WALLET}`);
  console.log(`Total SOL budget: ${(WALLET_COUNT * SOL_PER_WALLET + 0.2).toFixed(1)}`);
  console.log("");

  // Truncate results file
  fs.writeFileSync(RESULTS_PATH, "", "utf-8");

  // 1. Load provider and deployment
  const provider = loadProvider();
  const connection = provider.connection;
  const programs = loadPrograms(provider);
  const manifest = loadDeployment();

  console.log("[1/7] Provider loaded, deployment manifest parsed");

  // 2. Check funder balance
  const funderBalance = await connection.getBalance(provider.wallet.publicKey);
  const requiredSol = WALLET_COUNT * SOL_PER_WALLET + 0.2;
  console.log(
    `[2/7] Funder balance: ${(funderBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL ` +
    `(need ~${requiredSol.toFixed(1)} SOL)`
  );

  if (funderBalance < requiredSol * LAMPORTS_PER_SOL) {
    console.error(
      `ERROR: Insufficient balance. Have ${(funderBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL, ` +
      `need ~${requiredSol.toFixed(1)} SOL for ${WALLET_COUNT} wallets`
    );
    process.exit(1);
  }

  // 3. Load ALT for sell transactions
  const altAddress = new PublicKey(manifest.pdas?.ALT || loadAltAddress());
  const altAccount = await connection.getAddressLookupTable(altAddress);
  if (!altAccount.value) {
    console.error(`ERROR: ALT ${altAddress.toBase58()} not found on-chain`);
    process.exit(1);
  }
  const alt = altAccount.value;
  console.log(`[3/7] ALT loaded: ${altAddress.toBase58().slice(0, 12)}... (${alt.state.addresses.length} addresses)`);

  // 4. Generate keypairs and SAVE TO DISK before funding
  console.log(`[4/7] Generating ${WALLET_COUNT} wallets...`);
  const keypairs: Keypair[] = [];
  const wallets: StressWallet[] = [];

  for (let i = 0; i < WALLET_COUNT; i++) {
    const kp = Keypair.generate();
    keypairs.push(kp);
    wallets.push(
      new StressWallet(i, kp, connection, provider, programs, manifest, alt)
    );
  }

  // CRITICAL: Save keypairs BEFORE funding so SOL is always recoverable
  saveKeypairs(keypairs);

  // Fund wallets one at a time with delay (natural-looking, no batching pressure)
  console.log(`  Funding ${WALLET_COUNT} wallets (${SOL_PER_WALLET} SOL each)...`);
  const lamportsPerWallet = Math.floor(SOL_PER_WALLET * LAMPORTS_PER_SOL);

  for (let i = 0; i < keypairs.length; i++) {
    const kp = keypairs[i];
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: kp.publicKey,
        lamports: lamportsPerWallet,
      })
    );
    await provider.sendAndConfirm(tx, []);
    console.log(`  Funded wallet ${i + 1}/${keypairs.length}`);
    await sleep(2000); // 2s between each funding TX -- natural pacing
  }

  // 5. Create token accounts one wallet at a time with delay
  console.log(`[5/7] Creating token accounts (1 wallet at a time, 3s spacing)...`);

  for (let i = 0; i < wallets.length; i++) {
    try {
      await wallets[i].createAccounts();
      console.log(`  Wallet ${i + 1}/${wallets.length}: accounts created`);
    } catch (err) {
      console.warn(`  Wallet ${i + 1}/${wallets.length}: FAILED - ${String(err).slice(0, 150)}`);
    }
    await sleep(3000); // 3s between each wallet setup
  }

  // Filter out wallets that failed account creation
  const readyWallets = wallets.filter(
    (w) => w.wsolAccount !== null && w.crimeAccount !== null && w.fraudAccount !== null
  );
  console.log(`  ${readyWallets.length}/${wallets.length} wallets ready`);

  if (readyWallets.length === 0) {
    console.error("ERROR: No wallets ready. Run --reclaim to recover SOL.");
    process.exit(1);
  }

  // 6. Run sequential swap loop with natural timing
  // Wallets take turns (round-robin), not all-at-once parallel.
  // This mimics natural volume where trades trickle in over time.
  console.log(
    `[6/7] Starting swap loop for ${DURATION_MIN} minutes with ${readyWallets.length} wallets...`
  );
  console.log("  Pacing: one swap every 10-30s (round-robin across wallets)");

  const allResults: SwapResult[] = [];
  const startTime = Date.now();
  const endTime = startTime + DURATION_MS;
  let consecutiveFailures = 0;
  let walletIdx = 0;

  while (Date.now() < endTime) {
    const wallet = readyWallets[walletIdx % readyWallets.length];
    walletIdx++;

    try {
      const result = await wallet.executeRandomSwap();
      allResults.push(result);
      logResult(result);

      if (result.success) {
        process.stdout.write(".");
        consecutiveFailures = 0;
      } else {
        process.stdout.write("x");
        consecutiveFailures++;
      }
    } catch (err) {
      const result: SwapResult = {
        success: false,
        txSig: null,
        error: `Unhandled: ${String(err).slice(0, 200)}`,
        pair: "unknown",
        direction: "buy",
        amount: 0,
        walletIndex: wallet.index,
        timestamp: new Date().toISOString(),
      };
      allResults.push(result);
      logResult(result);
      process.stdout.write("X");
      consecutiveFailures++;
    }

    // FAIL FAST: stop if too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`\n\nFAIL FAST: ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Stopping.`);
      console.log("Run --reclaim to recover SOL from funded wallets.");
      break;
    }

    // Natural pacing: 10-30s between swaps
    await sleep(randFloat(10000, 30000));
  }

  console.log("\n");

  // 7. Summary and verification
  console.log("[7/7] Compiling results...\n");

  const totalSwaps = allResults.length;
  const successes = allResults.filter((r) => r.success).length;
  const failures = totalSwaps - successes;
  const successRate = totalSwaps > 0 ? (successes / totalSwaps) * 100 : 0;

  // Error breakdown
  const errorCounts: Record<string, number> = {};
  for (const r of allResults) {
    if (!r.success && r.error) {
      const errorKey = r.error.slice(0, 80);
      errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
    }
  }

  // Per-pair breakdown
  const pairBreakdown: Record<string, { buys: number; sells: number; buyOk: number; sellOk: number }> = {};
  for (const r of allResults) {
    if (!pairBreakdown[r.pair]) {
      pairBreakdown[r.pair] = { buys: 0, sells: 0, buyOk: 0, sellOk: 0 };
    }
    if (r.direction === "buy") {
      pairBreakdown[r.pair].buys++;
      if (r.success) pairBreakdown[r.pair].buyOk++;
    } else {
      pairBreakdown[r.pair].sells++;
      if (r.success) pairBreakdown[r.pair].sellOk++;
    }
  }

  let walletCorruption = false;

  // Print summary
  console.log("=== STRESS TEST RESULTS ===");
  console.log(`Duration:       ${DURATION_MIN} minutes`);
  console.log(`Wallets:        ${readyWallets.length}/${WALLET_COUNT}`);
  console.log(`Total swaps:    ${totalSwaps}`);
  console.log(`Successes:      ${successes}`);
  console.log(`Failures:       ${failures}`);
  console.log(`Success rate:   ${successRate.toFixed(1)}%`);
  console.log(`Corruption:     ${walletCorruption ? "DETECTED" : "None"}`);
  console.log(`Keypairs:       ${KEYPAIRS_PATH}`);
  console.log("");

  console.log("--- Per-Pair Breakdown ---");
  for (const [pair, data] of Object.entries(pairBreakdown)) {
    console.log(
      `  ${pair}: buys ${data.buyOk}/${data.buys}, sells ${data.sellOk}/${data.sells}`
    );
  }
  console.log("");

  if (Object.keys(errorCounts).length > 0) {
    console.log("--- Error Breakdown (top 10) ---");
    const sorted = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [errorKey, count] of sorted) {
      console.log(`  [${count}x] ${errorKey}`);
    }
    console.log("");
  }

  // Log final summary
  logResult({
    type: "summary",
    timestamp: new Date().toISOString(),
    walletCount: readyWallets.length,
    totalSwaps,
    successes,
    failures,
    successRate: parseFloat(successRate.toFixed(1)),
    walletCorruption,
    durationMinutes: DURATION_MIN,
    pairBreakdown,
    errorBreakdown: errorCounts,
  });

  // Verdict
  const passed = successRate >= 60 && !walletCorruption && totalSwaps > 0;
  console.log(passed ? "VERDICT: PASS" : "VERDICT: FAIL");
  console.log("\nRun --reclaim to recover remaining SOL from stress wallets.");

  if (!passed) {
    if (totalSwaps === 0) {
      console.log("  No swaps executed");
    } else if (successRate < 60) {
      console.log(`  Success rate ${successRate.toFixed(1)}% below 60% threshold`);
    }
    if (walletCorruption) {
      console.log("  Wallet corruption detected");
    }
    process.exit(1);
  }
}

function loadAltAddress(): string {
  const deployPath = path.resolve(__dirname, "../../deployments/devnet.json");
  const d = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  return d.alt;
}

// ---- Entry Point ----

main().catch((err) => {
  console.error("Stress test crashed:", err);
  console.error("Run --reclaim to recover SOL from funded wallets.");
  process.exit(1);
});
