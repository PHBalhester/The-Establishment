/**
 * Standalone ALT creation script.
 *
 * Creates (or verifies) the protocol-wide Address Lookup Table and prints
 * the address. Run after initialize.ts has populated pda-manifest.json.
 *
 * Usage:
 *   set -a && source .env && set +a && npx tsx scripts/deploy/create-alt.ts
 */

import * as path from "path";
import * as fs from "fs";
import { loadProvider } from "./lib/connection";
import { getOrCreateProtocolALT } from "../e2e/lib/alt-helper";
import type { PDAManifest } from "../e2e/devnet-e2e-validation";

const MANIFEST_PATH = path.resolve(__dirname, "pda-manifest.json");

async function main(): Promise<void> {
  console.log("=== Create Protocol ALT ===\n");

  // Load manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`pda-manifest.json not found at ${MANIFEST_PATH}`);
  }
  const manifest: PDAManifest = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, "utf-8")
  );

  // Load provider
  const provider = loadProvider();
  console.log(`  Wallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`  RPC: ${provider.connection.rpcEndpoint}\n`);

  // Create or load ALT
  const alt = await getOrCreateProtocolALT(provider, manifest);
  const altAddress = alt.key.toBase58();

  console.log(`\n  ALT address: ${altAddress}`);
  console.log(`  Addresses in ALT: ${alt.state.addresses.length}`);
  console.log("\nDone. Update shared/programs.ts DEVNET_ALT with the address above.");
}

main().catch((err) => {
  console.error("ALT creation failed:", err);
  process.exit(1);
});
