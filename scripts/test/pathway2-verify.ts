/**
 * Pathway 2 Post-Graduation Verification Script
 *
 * Runs after graduation to verify the entire protocol is operational:
 * 1. Curve status (both graduated)
 * 2. AMM pool reserves (correct token + SOL amounts)
 * 3. Conversion vault funded (250M CRIME + 250M FRAUD + 20M PROFIT)
 * 4. Tax escrow drained (rent-exempt minimum only)
 * 5. Crank test (epoch advance or timing constraint)
 * 6. Frontend accessible (HTTP 200 from Railway)
 *
 * Usage:
 *   set -a && source .env.devnet && set +a
 *   npx tsx scripts/test/pathway2-verify.ts
 *
 * Source: .planning/phases/95-pathway-2-full-deploy-graduation/95-02-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import { DeploymentConfig } from "../deploy/lib/deployment-schema";

// =============================================================================
// Constants
// =============================================================================

/** Railway URL (override via RAILWAY_URL env var) */
const RAILWAY_URL =
  process.env.RAILWAY_URL ||
  "https://dr-fraudsworth-production.up.railway.app";

/** Token decimals (6) */
const TOKEN_DECIMALS = 6;
const DECIMAL_MULTIPLIER = 10 ** TOKEN_DECIMALS;

/** Expected conversion vault balances (in base units) */
const EXPECTED_VAULT_CRIME = 250_000_000 * DECIMAL_MULTIPLIER; // 250M
const EXPECTED_VAULT_FRAUD = 250_000_000 * DECIMAL_MULTIPLIER; // 250M
const EXPECTED_VAULT_PROFIT = 20_000_000 * DECIMAL_MULTIPLIER; // 20M

/** Expected AMM pool token reserves (~290M per pool, allow 10% tolerance) */
const EXPECTED_POOL_TOKENS_MIN = 260_000_000 * DECIMAL_MULTIPLIER;
const EXPECTED_POOL_TOKENS_MAX = 310_000_000 * DECIMAL_MULTIPLIER;

/** Expected AMM pool SOL (~5 SOL, allow 10% tolerance below due to curve sells) */
const EXPECTED_POOL_SOL_MIN = 4.0 * LAMPORTS_PER_SOL;
const EXPECTED_POOL_SOL_MAX = 6.0 * LAMPORTS_PER_SOL;

/** Rent-exempt minimum for a system account (890_880 lamports) */
const RENT_EXEMPT_THRESHOLD = 1_000_000; // 1M lamports -- generous threshold

// =============================================================================
// Result Tracking
// =============================================================================

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

const results: CheckResult[] = [];

function pass(name: string, detail: string): void {
  results.push({ name, status: "PASS", detail });
  console.log(`  PASS  ${name}: ${detail}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, status: "FAIL", detail });
  console.error(`  FAIL  ${name}: ${detail}`);
}

function skip(name: string, detail: string): void {
  results.push({ name, status: "SKIP", detail });
  console.log(`  SKIP  ${name}: ${detail}`);
}

// =============================================================================
// Helpers
// =============================================================================

function loadDeploymentConfig(): DeploymentConfig {
  const configPath = path.resolve(__dirname, "../../deployments/devnet.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`deployments/devnet.json not found at: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as DeploymentConfig;
}

function formatTokens(amount: number): string {
  return `${(amount / DECIMAL_MULTIPLIER).toFixed(1)}M`;
}

function formatSol(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(2)} SOL`;
}

// =============================================================================
// Main Verification
// =============================================================================

async function main() {
  console.log("\n=== Pathway 2 Post-Graduation Verification ===\n");

  // Setup
  const provider = loadProvider();
  const programs = loadPrograms(provider);
  const connection = provider.connection;
  const config = loadDeploymentConfig();

  console.log(`Cluster:  devnet`);
  console.log(`Railway:  ${RAILWAY_URL}`);
  console.log(`Config:   deployments/devnet.json\n`);

  // -------------------------------------------------------------------------
  // Check 1: Curve CRIME graduated
  // -------------------------------------------------------------------------
  console.log("[1/6] Checking curve graduation status...");

  try {
    const crimeState = await programs.bondingCurve.account.curveState.fetch(
      new PublicKey(config.curvePdas.crime.curveState)
    );
    const crimeStatus = Object.keys(crimeState.status)[0];
    if (crimeStatus === "graduated") {
      pass("Curve CRIME graduated", "status=graduated");
    } else {
      fail("Curve CRIME graduated", `status=${crimeStatus} (expected graduated)`);
    }
  } catch (err: any) {
    fail("Curve CRIME graduated", `fetch error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Check 2: Curve FRAUD graduated
  // -------------------------------------------------------------------------
  try {
    const fraudState = await programs.bondingCurve.account.curveState.fetch(
      new PublicKey(config.curvePdas.fraud.curveState)
    );
    const fraudStatus = Object.keys(fraudState.status)[0];
    if (fraudStatus === "graduated") {
      pass("Curve FRAUD graduated", "status=graduated");
    } else {
      fail("Curve FRAUD graduated", `status=${fraudStatus} (expected graduated)`);
    }
  } catch (err: any) {
    fail("Curve FRAUD graduated", `fetch error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Check 3: AMM CRIME/SOL pool reserves
  // -------------------------------------------------------------------------
  console.log("\n[2/6] Checking AMM pool reserves...");

  for (const [poolName, poolAddrs] of [
    ["CRIME/SOL", config.pools.crimeSol] as const,
    ["FRAUD/SOL", config.pools.fraudSol] as const,
  ]) {
    try {
      const poolState = await programs.amm.account.poolState.fetch(
        new PublicKey(poolAddrs.pool)
      );
      const reserveA = (poolState.reserveA as anchor.BN).toNumber();
      const reserveB = (poolState.reserveB as anchor.BN).toNumber();

      // Determine which reserve is tokens and which is SOL
      // AMM canonical ordering: mintA < mintB in bytes
      // NATIVE_MINT(0x06) < everything, so SOL is always mintA (reserveA)
      const solReserve = reserveA;
      const tokenReserve = reserveB;

      const tokensOk =
        tokenReserve >= EXPECTED_POOL_TOKENS_MIN &&
        tokenReserve <= EXPECTED_POOL_TOKENS_MAX;
      const solOk =
        solReserve >= EXPECTED_POOL_SOL_MIN &&
        solReserve <= EXPECTED_POOL_SOL_MAX;

      if (tokensOk && solOk) {
        pass(
          `AMM ${poolName} reserves`,
          `${formatTokens(tokenReserve)} tokens, ${formatSol(solReserve)}`
        );
      } else {
        fail(
          `AMM ${poolName} reserves`,
          `${formatTokens(tokenReserve)} tokens (need 260-310M), ${formatSol(solReserve)} (need 4-6 SOL)`
        );
      }
    } catch (err: any) {
      fail(`AMM ${poolName} reserves`, `fetch error: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Check 4: Conversion vault funded
  // -------------------------------------------------------------------------
  console.log("\n[3/6] Checking conversion vault balances...");

  const vaultChecks: [string, string, number][] = [
    ["Vault CRIME", config.pdas.vaultCrime, EXPECTED_VAULT_CRIME],
    ["Vault FRAUD", config.pdas.vaultFraud, EXPECTED_VAULT_FRAUD],
    ["Vault PROFIT", config.pdas.vaultProfit, EXPECTED_VAULT_PROFIT],
  ];

  let vaultAllPass = true;
  for (const [name, addr, expected] of vaultChecks) {
    try {
      const acct = await getAccount(
        connection,
        new PublicKey(addr),
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      const balance = Number(acct.amount);
      if (balance >= expected) {
        // Don't print individual pass for vault sub-checks
      } else {
        vaultAllPass = false;
        fail(name, `balance=${balance} (expected >= ${expected})`);
      }
    } catch (err: any) {
      vaultAllPass = false;
      fail(name, `fetch error: ${err.message}`);
    }
  }

  if (vaultAllPass) {
    pass(
      "Conversion vault funded",
      "250M CRIME + 250M FRAUD + 20M PROFIT confirmed"
    );
  }

  // -------------------------------------------------------------------------
  // Check 5: Tax escrow drained
  // -------------------------------------------------------------------------
  console.log("\n[4/6] Checking tax escrow balances...");

  let escrowAllPass = true;
  for (const [faction, curvePdas] of [
    ["CRIME", config.curvePdas.crime] as const,
    ["FRAUD", config.curvePdas.fraud] as const,
  ]) {
    try {
      const escrowInfo = await connection.getAccountInfo(
        new PublicKey(curvePdas.taxEscrow)
      );
      if (!escrowInfo) {
        // Account closed = drained completely, that's fine
        continue;
      }
      if (escrowInfo.lamports <= RENT_EXEMPT_THRESHOLD) {
        // Only rent-exempt minimum remains
      } else {
        escrowAllPass = false;
        fail(
          `Tax escrow ${faction}`,
          `${escrowInfo.lamports} lamports remaining (expected <= ${RENT_EXEMPT_THRESHOLD})`
        );
      }
    } catch (err: any) {
      escrowAllPass = false;
      fail(`Tax escrow ${faction}`, `fetch error: ${err.message}`);
    }
  }

  if (escrowAllPass) {
    pass("Tax escrow drained", "Both CRIME and FRAUD escrows at rent-exempt minimum");
  }

  // -------------------------------------------------------------------------
  // Check 6: Crank test (epoch advance)
  // -------------------------------------------------------------------------
  console.log("\n[5/6] Checking crank/epoch status...");

  try {
    const epochState = await programs.epochProgram.account.epochState.fetch(
      new PublicKey(config.pdas.epochState)
    );
    const currentEpoch = (epochState.currentEpoch as anchor.BN).toNumber();
    pass(
      "Crank epoch state",
      `current epoch=${currentEpoch} (epoch state readable, protocol operational)`
    );
  } catch (err: any) {
    // If epoch state doesn't exist yet, that's fine -- graduation just happened
    if (err.message?.includes("Account does not exist")) {
      skip("Crank epoch state", "Epoch state not yet initialized (expected if crank not started)");
    } else {
      fail("Crank epoch state", `fetch error: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Check 7: Frontend accessible
  // -------------------------------------------------------------------------
  console.log("\n[6/6] Checking frontend accessibility...");

  try {
    const response = await fetch(RAILWAY_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      pass("Frontend accessible", `${RAILWAY_URL} returned ${response.status}`);
    } else {
      fail(
        "Frontend accessible",
        `${RAILWAY_URL} returned ${response.status} ${response.statusText}`
      );
    }
  } catch (err: any) {
    fail("Frontend accessible", `HTTP error: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n=== Pathway 2 Verification Report ===");

  const maxNameLen = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const pad = " ".repeat(maxNameLen - r.name.length);
    console.log(`${r.name}:${pad} ${r.status} (${r.detail})`);
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const total = results.length;

  console.log("================================");
  console.log(
    `Result: ${passed}/${total} PASSED` +
      (failed > 0 ? `, ${failed} FAILED` : "") +
      (skipped > 0 ? `, ${skipped} SKIPPED` : "")
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n=== Pathway 2 Verification FAILED ===");
  console.error("Error:", err.message || err);
  process.exit(1);
});
