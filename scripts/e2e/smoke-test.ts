/**
 * Smoke Test: SOL Buy Swap on Devnet
 *
 * Verifies the full CPI chain (Tax->AMM->Token-2022->Hook) works end-to-end
 * with the newly deployed Phase 37 program code.
 *
 * Steps:
 * 1. Load provider and programs from deployment config
 * 2. Load PDA manifest for pool/mint addresses
 * 3. Create a fresh E2E user with 0.5 SOL
 * 4. Execute a 0.1 SOL buy swap on the CRIME/SOL pool
 * 5. Print PASS with TX signature or FAIL with error
 *
 * Usage: set -a && source .env && set +a && npx tsx scripts/e2e/smoke-test.ts
 */

import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import { createE2EUser } from "./lib/user-setup";
import { executeSolBuySwap } from "./lib/swap-flow";
import { E2ELogger } from "./lib/e2e-logger";
import { PDAManifest } from "./devnet-e2e-validation";
import { loadDeployment } from "./lib/load-deployment";

async function smoke(): Promise<void> {
  // Load provider (reads CLUSTER_URL, keypairs/devnet-wallet.json)
  const provider = loadProvider();
  const programs = loadPrograms(provider);

  // Load deployment addresses from deployments/devnet.json (Phase 95)
  const manifest: PDAManifest = loadDeployment();

  // Create logger (writes to /tmp for smoke tests)
  const logger = new E2ELogger("/tmp/smoke-test.jsonl");

  console.log("Smoke Test: SOL Buy Swap on CRIME/SOL pool");
  console.log(`Cluster: ${process.env.CLUSTER_URL}`);
  console.log("");

  // Create fresh E2E user with 0.5 SOL
  console.log("Creating test user...");
  const user = await createE2EUser(provider, manifest.mints, 500_000_000);
  console.log(`  User: ${user.keypair.publicKey.toBase58()}`);
  console.log("");

  // Execute 0.1 SOL buy swap on CRIME/SOL
  console.log("Executing 0.1 SOL buy swap on CRIME/SOL...");
  const sig = await executeSolBuySwap(
    provider,
    programs,
    manifest,
    user,
    logger,
    "CRIME/SOL",
    100_000_000
  );

  if (sig) {
    console.log("");
    console.log(`SMOKE TEST PASS: ${sig}`);
    console.log(
      `Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`
    );
    process.exit(0);
  } else {
    console.log("");
    console.log("SMOKE TEST FAIL: No TX signature returned");
    process.exit(1);
  }
}

smoke().catch((err) => {
  console.error("");
  console.error("SMOKE TEST FAIL:", err.message || err);
  if (err.logs) {
    for (const log of err.logs) {
      console.error("  ", log);
    }
  }
  process.exit(1);
});
