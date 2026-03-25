/**
 * Soak Test Verification Script
 *
 * Operates in two modes:
 *   --start   Record baseline epoch state and crank health (run before soak)
 *   --verify  Check epoch progression after 24h and determine PASS/FAIL
 *
 * Usage:
 *   set -a && source .env && set +a && npx tsx scripts/e2e/soak-verify.ts --start
 *   ... wait 24 hours ...
 *   set -a && source .env && set +a && npx tsx scripts/e2e/soak-verify.ts --verify
 *
 * Requirements covered:
 *   E2E-08: Crank runs 24+ hours without crashes or missed epochs
 *   E2E-09: Priority fee economics -- crank TXs land reliably
 */

import * as fs from "fs";
import * as path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

// ---- Constants ----

const BASELINE_PATH = path.resolve(__dirname, "soak-baseline.json");
const JSONL_PATH = path.resolve(__dirname, "e2e-run.jsonl");

/**
 * Railway crank health endpoint.
 * NOTE: The crank binds to 0.0.0.0:8080 inside Railway's internal network.
 * This is NOT publicly accessible via the Railway domain (which serves Next.js).
 * The health check is best-effort; epoch advancement on-chain is the primary signal.
 */
const CRANK_HEALTH_URL =
  process.env.CRANK_HEALTH_URL ||
  "https://dr-fraudsworth-production.up.railway.app/health";

/** Expected seconds per epoch: 750 slots * 0.4 sec/slot = 300 seconds */
const SECONDS_PER_EPOCH = 300;

/** Minimum soak duration in seconds (24 hours) */
const MIN_SOAK_SECONDS = 86_400;

/** Tolerance for epoch count: actual >= expected * this factor */
const EPOCH_TOLERANCE = 0.9;

// ---- Interfaces ----

interface SoakBaseline {
  startTime: string;
  startEpoch: number;
  startSlot: number;
  healthOk: boolean;
  crankUrl: string;
  healthResponse: Record<string, unknown> | null;
}

interface SoakVerifyResult {
  pass: boolean;
  elapsedSeconds: number;
  elapsedHours: number;
  startEpoch: number;
  endEpoch: number;
  actualEpochs: number;
  expectedEpochs: number;
  epochRatio: number;
  averageIntervalSeconds: number;
  healthOk: boolean;
  checks: {
    durationOk: boolean;
    epochCountOk: boolean;
    healthOk: boolean;
  };
}

// ---- Helpers ----

/**
 * Read EpochState directly from raw account data.
 * This avoids needing Anchor program setup -- we just need epoch_number
 * and epoch_start_slot from the account bytes.
 *
 * EpochState layout (Anchor borsh serialization, packed):
 *   offset 0:   [u8; 8]  discriminator
 *   offset 8:   u64      genesis_slot
 *   offset 16:  u32      current_epoch
 *   offset 20:  u64      epoch_start_slot
 *   offset 28:  u8       cheap_side
 *   ... (remaining fields not needed for soak test)
 */
async function readEpochNumber(
  connection: Connection,
  epochStatePda: PublicKey
): Promise<{ currentEpoch: number; epochStartSlot: number }> {
  const accountInfo = await connection.getAccountInfo(epochStatePda);
  if (!accountInfo || !accountInfo.data) {
    throw new Error(`EpochState account not found: ${epochStatePda.toBase58()}`);
  }

  const data = accountInfo.data;

  // current_epoch: u32 at offset 16 (after 8-byte discriminator + 8-byte genesis_slot)
  const currentEpoch = data.readUInt32LE(16);

  // epoch_start_slot: u64 at offset 20 (after current_epoch)
  const epochStartSlot = Number(data.readBigUInt64LE(20));

  return { currentEpoch, epochStartSlot };
}

/**
 * Check crank health endpoint.
 * Returns the JSON response if healthy, null if unreachable.
 */
async function checkCrankHealth(): Promise<{
  ok: boolean;
  response: Record<string, unknown> | null;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(CRANK_HEALTH_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const body = await res.json();
      return { ok: true, response: body as Record<string, unknown> };
    }
    console.log(`  Health endpoint returned status ${res.status}`);
    return { ok: false, response: null };
  } catch (err) {
    console.log(`  Health endpoint unreachable: ${String(err).slice(0, 100)}`);
    return { ok: false, response: null };
  }
}

// ---- Mode: Start ----

async function runStart(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  SOAK TEST -- Recording Baseline");
  console.log("=".repeat(60));
  console.log();

  // 1. Connect to cluster
  const clusterUrl = process.env.CLUSTER_URL;
  if (!clusterUrl) {
    throw new Error("CLUSTER_URL env var not set. Source .env first.");
  }
  const connection = new Connection(clusterUrl, "confirmed");

  // 2. Load epochState PDA from deployment
  const deployPath = path.resolve(__dirname, "../../deployments/devnet.json");
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const epochStatePda = new PublicKey(deployment.pdas.epochState);
  console.log(`  EpochState PDA: ${epochStatePda.toBase58()}`);

  // 3. Read current epoch state
  const { currentEpoch, epochStartSlot } = await readEpochNumber(
    connection,
    epochStatePda
  );
  console.log(`  Current epoch: ${currentEpoch}`);
  console.log(`  Epoch start slot: ${epochStartSlot}`);

  // 4. Get current slot
  const currentSlot = await connection.getSlot();
  console.log(`  Current slot: ${currentSlot}`);

  // 5. Check crank health
  console.log();
  console.log("  Checking crank health...");
  const health = await checkCrankHealth();
  console.log(`  Health OK: ${health.ok}`);
  if (health.response) {
    console.log(`  Crank status: ${(health.response as any).status}`);
    console.log(
      `  Crank uptime: ${((health.response as any).uptime / 3600).toFixed(1)}h`
    );
    console.log(
      `  Consecutive errors: ${(health.response as any).consecutiveErrors}`
    );
  }

  // 6. Save baseline
  const baseline: SoakBaseline = {
    startTime: new Date().toISOString(),
    startEpoch: currentEpoch,
    startSlot: currentSlot,
    healthOk: health.ok,
    crankUrl: CRANK_HEALTH_URL,
    healthResponse: health.response,
  };

  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log();
  console.log(`  Baseline saved to: ${BASELINE_PATH}`);
  console.log();
  console.log("=".repeat(60));
  console.log(
    '  Soak baseline recorded. Run `--verify` after 24 hours.'
  );
  console.log("=".repeat(60));
}

// ---- Mode: Verify ----

async function runVerify(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  SOAK TEST -- Verification (24h check)");
  console.log("=".repeat(60));
  console.log();

  // 1. Load baseline
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(
      `Baseline not found at ${BASELINE_PATH}. Run --start first.`
    );
  }
  const baseline: SoakBaseline = JSON.parse(
    fs.readFileSync(BASELINE_PATH, "utf-8")
  );
  console.log(`  Baseline start time: ${baseline.startTime}`);
  console.log(`  Baseline start epoch: ${baseline.startEpoch}`);

  // 2. Connect to cluster
  const clusterUrl = process.env.CLUSTER_URL;
  if (!clusterUrl) {
    throw new Error("CLUSTER_URL env var not set. Source .env first.");
  }
  const connection = new Connection(clusterUrl, "confirmed");

  // 3. Load epochState PDA
  const deployPath = path.resolve(__dirname, "../../deployments/devnet.json");
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const epochStatePda = new PublicKey(deployment.pdas.epochState);

  // 4. Read current epoch state
  const { currentEpoch } = await readEpochNumber(connection, epochStatePda);
  console.log(`  Current epoch: ${currentEpoch}`);

  // 5. Calculate elapsed time
  const startMs = new Date(baseline.startTime).getTime();
  const nowMs = Date.now();
  const elapsedSeconds = (nowMs - startMs) / 1000;
  const elapsedHours = elapsedSeconds / 3600;
  console.log(`  Elapsed: ${elapsedHours.toFixed(2)} hours (${elapsedSeconds.toFixed(0)}s)`);

  // 6. Calculate expected vs actual epochs
  const expectedEpochs = elapsedSeconds / SECONDS_PER_EPOCH;
  const actualEpochs = currentEpoch - baseline.startEpoch;
  const epochRatio = actualEpochs / expectedEpochs;
  const averageInterval =
    actualEpochs > 0 ? elapsedSeconds / actualEpochs : 0;

  console.log(`  Expected epochs: ${expectedEpochs.toFixed(1)}`);
  console.log(`  Actual epochs: ${actualEpochs}`);
  console.log(`  Epoch ratio: ${(epochRatio * 100).toFixed(1)}%`);
  console.log(
    `  Average epoch interval: ${averageInterval.toFixed(1)}s (expected ~${SECONDS_PER_EPOCH}s)`
  );

  // 7. Check crank health
  console.log();
  console.log("  Checking crank health...");
  const health = await checkCrankHealth();
  console.log(`  Health OK: ${health.ok}`);
  if (health.response) {
    console.log(`  Crank status: ${(health.response as any).status}`);
    console.log(
      `  Crank uptime: ${((health.response as any).uptime / 3600).toFixed(1)}h`
    );
  }

  // 8. Run pass/fail checks
  const checks = {
    durationOk: elapsedSeconds >= MIN_SOAK_SECONDS,
    epochCountOk: actualEpochs >= expectedEpochs * EPOCH_TOLERANCE,
    healthOk: health.ok,
  };

  // Health endpoint is internal to Railway -- not publicly reachable.
  // Epoch advancement is the authoritative liveness signal.
  const pass = checks.durationOk && checks.epochCountOk;

  const result: SoakVerifyResult = {
    pass,
    elapsedSeconds,
    elapsedHours,
    startEpoch: baseline.startEpoch,
    endEpoch: currentEpoch,
    actualEpochs,
    expectedEpochs,
    epochRatio,
    averageIntervalSeconds: averageInterval,
    healthOk: health.ok,
    checks,
  };

  // 9. Print results
  console.log();
  console.log("=".repeat(60));
  console.log(`  SOAK TEST RESULT: ${pass ? "PASS" : "FAIL"}`);
  console.log("=".repeat(60));
  console.log();
  console.log("  Checks:");
  console.log(
    `    Duration >= 24h:      ${checks.durationOk ? "PASS" : "FAIL"} (${elapsedHours.toFixed(2)}h)`
  );
  console.log(
    `    Epoch count >= 90%:   ${checks.epochCountOk ? "PASS" : "FAIL"} (${actualEpochs}/${expectedEpochs.toFixed(0)} = ${(epochRatio * 100).toFixed(1)}%)`
  );
  console.log(
    `    Health endpoint OK:   ${checks.healthOk ? "PASS" : "N/A (internal Railway endpoint, epoch count is authoritative)"}`
  );
  console.log();
  console.log(
    `  E2E-08 (24h stability): ${checks.durationOk && checks.epochCountOk ? "PASS" : "FAIL"}`
  );
  console.log(
    `  E2E-09 (priority fees): ${checks.epochCountOk ? "PASS" : "FAIL"} (avg interval ${averageInterval.toFixed(1)}s)`
  );
  console.log();

  // 10. Append to JSONL
  const jsonlEntry = {
    test: "soak-verify",
    timestamp: new Date().toISOString(),
    requirements: ["E2E-08", "E2E-09"],
    result: pass ? "PASS" : "FAIL",
    details: result,
  };
  fs.appendFileSync(JSONL_PATH, JSON.stringify(jsonlEntry) + "\n");
  console.log(`  Results appended to: ${JSONL_PATH}`);
}

// ---- CLI ----

const args = process.argv.slice(2);
const mode = args[0];

if (mode === "--start") {
  runStart().catch((err) => {
    console.error(`FATAL: ${err}`);
    process.exit(1);
  });
} else if (mode === "--verify") {
  runVerify().catch((err) => {
    console.error(`FATAL: ${err}`);
    process.exit(1);
  });
} else {
  console.log("Usage: npx tsx scripts/e2e/soak-verify.ts [--start | --verify]");
  console.log();
  console.log("  --start   Record baseline epoch state (run before soak)");
  console.log("  --verify  Check epoch progression after 24h");
  process.exit(1);
}
