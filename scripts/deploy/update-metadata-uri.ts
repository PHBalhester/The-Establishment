/**
 * Update On-Chain Token Metadata URIs
 *
 * Updates the URI field in Token-2022 metadata for existing mints to point to
 * Arweave metadata JSON. This is needed when mints already exist on-chain with
 * placeholder URIs (e.g., Railway URLs from initial deploy).
 *
 * For FRESH deploys, initialize.ts reads the Arweave URIs automatically via
 * resolveMetadataUri(). This script is only needed for EXISTING mints.
 *
 * Uses `tokenMetadataUpdateField` from @solana/spl-token which:
 *   - Updates a single metadata field (name, symbol, or uri)
 *   - Handles rent reallocation if the new value is longer
 *   - Requires the update authority to sign
 *
 * Usage:
 *   export PATH="/opt/homebrew/bin:$PATH"
 *   set -a && source .env.devnet && set +a
 *   npx tsx scripts/deploy/update-metadata-uri.ts --cluster devnet --keypair keypairs/devnet-wallet.json
 *
 * Source: .planning/phases/93-arweave-token-metadata/93-02-PLAN.md
 */

import {
  tokenMetadataUpdateField,
  TOKEN_2022_PROGRAM_ID,
  getTokenMetadata,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Constants
// =============================================================================

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEPLOYMENTS_DIR = path.join(PROJECT_ROOT, "deployments");
const TOKEN_KEYS = ["crime", "fraud", "profit"] as const;

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  cluster: "devnet" | "mainnet";
  keypair: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let cluster: string | undefined;
  let keypair: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cluster":
        cluster = args[++i];
        break;
      case "--keypair":
        keypair = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!cluster || !["devnet", "mainnet"].includes(cluster)) {
    console.error("Error: --cluster must be 'devnet' or 'mainnet'");
    printUsage();
    process.exit(1);
  }

  if (!keypair) {
    console.error("Error: --keypair is required (path to deployer wallet JSON)");
    printUsage();
    process.exit(1);
  }

  const resolvedKeypair = path.isAbsolute(keypair)
    ? keypair
    : path.resolve(process.cwd(), keypair);

  if (!fs.existsSync(resolvedKeypair)) {
    console.error(`Error: Keypair file not found: ${resolvedKeypair}`);
    process.exit(1);
  }

  return { cluster: cluster as "devnet" | "mainnet", keypair: resolvedKeypair, dryRun };
}

function printUsage(): void {
  console.error("");
  console.error("Usage: npx tsx scripts/deploy/update-metadata-uri.ts --cluster <devnet|mainnet> --keypair <path> [--dry-run]");
  console.error("");
  console.error("Options:");
  console.error("  --cluster   Target cluster (devnet or mainnet)");
  console.error("  --keypair   Path to deployer wallet keypair JSON file");
  console.error("  --dry-run   Show what would be updated without sending transactions");
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = parseArgs();
  console.log(`\nUpdate On-Chain Token Metadata URIs`);
  console.log(`Cluster: ${args.cluster}`);
  console.log(`Keypair: ${args.keypair}`);
  console.log(`Dry run: ${args.dryRun}\n`);

  // ----------------------------------------------------------
  // Load deployment config
  // ----------------------------------------------------------
  const configPath = path.join(DEPLOYMENTS_DIR, `${args.cluster}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Deployment config not found: ${configPath}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Validate we have mint addresses and metadata URIs
  if (!config.mints) {
    console.error("Error: No mints found in deployment config");
    process.exit(1);
  }
  if (!config.metadata) {
    console.error("Error: No metadata URIs found in deployment config. Run upload-metadata.ts first.");
    process.exit(1);
  }

  for (const key of TOKEN_KEYS) {
    if (!config.mints[key]) {
      console.error(`Error: Missing mint address for ${key} in deployment config`);
      process.exit(1);
    }
    if (!config.metadata[key]) {
      console.error(`Error: Missing metadata URI for ${key} in deployment config`);
      process.exit(1);
    }
  }

  // ----------------------------------------------------------
  // Set up connection and payer
  // ----------------------------------------------------------
  const clusterUrl = process.env.CLUSTER_URL;
  if (!clusterUrl) {
    console.error("Error: CLUSTER_URL environment variable not set.");
    console.error("Run: set -a && source .env.devnet && set +a");
    process.exit(1);
  }

  const connection = new Connection(clusterUrl, "confirmed");
  const keypairBytes = JSON.parse(fs.readFileSync(args.keypair, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairBytes));

  console.log(`RPC: ${clusterUrl}`);
  console.log(`Payer: ${payer.publicKey.toBase58()}\n`);

  // ----------------------------------------------------------
  // Update each mint's URI
  // ----------------------------------------------------------
  let updated = 0;
  let skipped = 0;

  for (const key of TOKEN_KEYS) {
    const mintAddress = new PublicKey(config.mints[key]);
    const newUri = config.metadata[key];
    const tokenName = key.toUpperCase();

    console.log(`--- ${tokenName} ---`);
    console.log(`  Mint: ${mintAddress.toBase58()}`);
    console.log(`  New URI: ${newUri}`);

    // Read current on-chain metadata to check if update is needed
    try {
      const currentMetadata = await getTokenMetadata(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);

      if (!currentMetadata) {
        console.error(`  ERROR: No metadata found on mint ${mintAddress.toBase58()}`);
        console.error(`  This mint may not have MetadataPointer extension initialized.`);
        process.exit(1);
      }

      console.log(`  Current URI: ${currentMetadata.uri}`);

      if (currentMetadata.uri === newUri) {
        console.log(`  SKIPPED: URI already up to date`);
        skipped++;
        continue;
      }

      // Verify the update authority matches our payer
      if (!currentMetadata.updateAuthority?.equals(payer.publicKey)) {
        console.error(`  ERROR: Update authority mismatch`);
        console.error(`  Expected: ${payer.publicKey.toBase58()}`);
        console.error(`  Actual: ${currentMetadata.updateAuthority?.toBase58() ?? "null"}`);
        process.exit(1);
      }

    } catch (err: any) {
      console.error(`  ERROR reading metadata: ${err.message}`);
      process.exit(1);
    }

    if (args.dryRun) {
      console.log(`  DRY RUN: Would update URI`);
      continue;
    }

    // Send the update transaction
    try {
      const sig = await tokenMetadataUpdateField(
        connection,
        payer,           // payer for TX fees
        mintAddress,     // the mint account (metadata lives here)
        payer,           // update authority signer
        "uri",           // field to update
        newUri,          // new Arweave URI
      );
      console.log(`  UPDATED: TX ${sig}`);
      updated++;
    } catch (err: any) {
      console.error(`  ERROR updating ${tokenName}: ${err.message}`);
      process.exit(1);
    }
  }

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------
  console.log(`\n=== Update Complete ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (already current): ${skipped}`);

  if (args.dryRun) {
    console.log(`\nDry run -- no transactions sent. Remove --dry-run to execute.`);
  }

  // ----------------------------------------------------------
  // Verify the updates by re-reading on-chain metadata
  // ----------------------------------------------------------
  if (updated > 0) {
    console.log(`\n--- Verification ---`);
    for (const key of TOKEN_KEYS) {
      const mintAddress = new PublicKey(config.mints[key]);
      const expectedUri = config.metadata[key];

      const metadata = await getTokenMetadata(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);
      const onChainUri = metadata?.uri ?? "(not found)";
      const match = onChainUri === expectedUri;

      console.log(`  ${key.toUpperCase()}: ${match ? "OK" : "MISMATCH"} -- ${onChainUri}`);

      if (!match) {
        console.error(`  Expected: ${expectedUri}`);
        process.exit(1);
      }
    }
    console.log(`All on-chain URIs verified.`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
