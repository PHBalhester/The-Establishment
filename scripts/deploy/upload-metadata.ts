/**
 * Upload Token Metadata to Arweave via Irys
 *
 * Standalone script that uploads three token logos (PNG) and three metadata JSON
 * files to permanent Arweave storage via the Irys upload SDK. After all 6 uploads
 * succeed, writes the resulting URIs to deployments/{cluster}.json and .env.{cluster}.
 *
 * Upload order:
 *   1. Upload 3 logo PNGs -> get image URIs
 *   2. Build 3 metadata JSON files (referencing image URIs) -> upload -> get metadata URIs
 *   3. Write all URIs to deployment.json + .env.{cluster}
 *
 * Idempotent: Checks deployment.json for existing metadata URIs. If found, exits
 * successfully. Use --force to re-upload.
 *
 * Always uses Irys mainnet for permanent Arweave storage (even for devnet tokens).
 * Cost is negligible (< 0.01 SOL for all 6 files).
 *
 * Usage:
 *   npx tsx scripts/deploy/upload-metadata.ts --cluster devnet --keypair keypairs/devnet-wallet.json
 *   npx tsx scripts/deploy/upload-metadata.ts --cluster mainnet --keypair ~/mainnet-keys/deployer.json --force
 *
 * Source: .planning/phases/93-arweave-token-metadata/93-01-PLAN.md
 */

import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import { TOKENS, buildMetadataJson } from "./lib/metadata-templates";

// =============================================================================
// Constants
// =============================================================================

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEPLOYMENTS_DIR = path.join(PROJECT_ROOT, "deployments");
const TOKEN_KEYS = ["crime", "fraud", "profit"] as const;

// Always permanent Arweave storage -- same URIs for devnet and mainnet tokens.
const ARWEAVE_GATEWAY = "https://gateway.irys.xyz";

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  cluster: "devnet" | "mainnet";
  keypair: string;
  force: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let cluster: string | undefined;
  let keypair: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cluster":
        cluster = args[++i];
        break;
      case "--keypair":
        keypair = args[++i];
        break;
      case "--force":
        force = true;
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

  // Resolve keypair path relative to cwd
  const resolvedKeypair = path.isAbsolute(keypair)
    ? keypair
    : path.resolve(process.cwd(), keypair);

  if (!fs.existsSync(resolvedKeypair)) {
    console.error(`Error: Keypair file not found: ${resolvedKeypair}`);
    process.exit(1);
  }

  return { cluster: cluster as "devnet" | "mainnet", keypair: resolvedKeypair, force };
}

function printUsage(): void {
  console.error("");
  console.error("Usage: npx tsx scripts/deploy/upload-metadata.ts --cluster <devnet|mainnet> --keypair <path> [--force]");
  console.error("");
  console.error("Options:");
  console.error("  --cluster   Target cluster (devnet or mainnet)");
  console.error("  --keypair   Path to deployer wallet keypair JSON file");
  console.error("  --force     Re-upload even if URIs already exist in deployment.json");
}

// =============================================================================
// Irys Uploader Initialization
// =============================================================================

async function createIrysUploader(keypairPath: string) {
  // Always use Irys mainnet for permanent Arweave storage, regardless of Solana cluster.
  // Arweave URIs are chain-agnostic -- same permanent URIs work for devnet and mainnet tokens.
  // Requires mainnet SOL for funding (tiny cost: < 0.01 SOL for all 6 files).
  console.log("Initializing Irys uploader -- mainnet (permanent Arweave)...");

  try {
    // Load keypair file (Solana JSON format: array of bytes)
    const keypairBytes = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const privateKeyBase58 = bs58.encode(Uint8Array.from(keypairBytes));

    const irys = await Uploader(Solana).withWallet(privateKeyBase58);

    console.log(`Irys uploader initialized. Address: ${irys.address}`);
    return irys;
  } catch (err: any) {
    console.error("Failed to initialize Irys uploader.");
    console.error("Troubleshooting:");
    console.error("  - Ensure the keypair file is a valid Solana JSON keypair (array of 64 bytes)");
    console.error("  - Ensure the wallet has mainnet SOL for Irys upload fees");
    console.error(`  - Error: ${err.message}`);
    process.exit(1);
  }
}

// =============================================================================
// Upload Functions
// =============================================================================

/**
 * Upload a single file to Arweave via Irys with proper Content-Type tagging.
 * Funds the exact upload price before uploading.
 */
async function uploadFile(
  irys: any,
  filePath: string,
  contentType: string,
  label: string,
  gatewayBase: string,
): Promise<string> {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const { size } = fs.statSync(absolutePath);
  console.log(`  ${label}: ${size} bytes`);

  const receipt = await irys.uploadFile(absolutePath, {
    tags: [{ name: "Content-Type", value: contentType }],
  });

  const uri = `${gatewayBase}/${receipt.id}`;
  console.log(`  ${label} uploaded: ${uri}`);
  return uri;
}

/**
 * Upload a JSON string to Arweave via Irys with application/json Content-Type.
 */
async function uploadJson(
  irys: any,
  jsonString: string,
  label: string,
  gatewayBase: string,
): Promise<string> {
  const size = Buffer.byteLength(jsonString, "utf-8");
  console.log(`  ${label}: ${size} bytes`);

  const receipt = await irys.upload(jsonString, {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });

  const uri = `${gatewayBase}/${receipt.id}`;
  console.log(`  ${label} uploaded: ${uri}`);
  return uri;
}

// =============================================================================
// Deployment Config Helpers
// =============================================================================

function loadDeploymentConfig(cluster: string): Record<string, any> | null {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function writeDeploymentConfig(cluster: string, config: Record<string, any>): void {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Written: ${configPath}`);
}

/**
 * Append or update metadata URI env vars in .env.{cluster}.
 *
 * Reads existing content, replaces lines if present, appends if not.
 * Creates the file if it doesn't exist.
 */
function writeEnvFile(
  cluster: string,
  metadataUris: Record<string, string>,
): void {
  const envPath = path.join(PROJECT_ROOT, `.env.${cluster}`);
  let content = "";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  const envVars: Record<string, string> = {
    CRIME_METADATA_URI: metadataUris.crime,
    FRAUD_METADATA_URI: metadataUris.fraud,
    PROFIT_METADATA_URI: metadataUris.profit,
  };

  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      // Replace existing line
      content = content.replace(regex, `${key}=${value}`);
    } else {
      // Append (with newline separator if content doesn't end with one)
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      content += `${key}=${value}\n`;
    }
  }

  fs.writeFileSync(envPath, content);
  console.log(`Written: ${envPath}`);
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Fetch each metadata URI and validate the JSON contains the correct image field.
 */
async function verifyUploads(
  imageUris: Record<string, string>,
  metadataUris: Record<string, string>,
): Promise<void> {
  // Verify via Irys gateway first (instant), then arweave.net (may take minutes to propagate).
  console.log("\nVerifying uploads via Irys gateway...");

  for (const key of TOKEN_KEYS) {
    const metaUri = metadataUris[key];
    // Extract txId from arweave.net URI and verify via Irys gateway (faster propagation)
    const txId = metaUri.split("/").pop()!;
    const irysUri = `https://gateway.irys.xyz/${txId}`;
    console.log(`  Fetching ${key} metadata: ${irysUri}`);

    let json: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(irysUri, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`Verification failed: ${key} metadata fetch returned ${response.status}`);
      }
      const text = await response.text();
      try {
        json = JSON.parse(text);
        break;
      } catch {
        if (attempt < 3) {
          const delay = attempt * 10;
          console.log(`  Not ready yet (attempt ${attempt}/3), waiting ${delay}s...`);
          await new Promise((r) => setTimeout(r, delay * 1000));
        } else {
          throw new Error(`Verification failed: ${key} metadata not JSON after 3 attempts. Got: ${text.slice(0, 100)}`);
        }
      }
    }

    // Validate image field points to the correct image URI
    if (json.image !== imageUris[key]) {
      throw new Error(
        `Verification failed: ${key} metadata image field mismatch.\n` +
        `  Expected: ${imageUris[key]}\n` +
        `  Got: ${json.image}`,
      );
    }

    // Validate required Metaplex fields
    for (const field of ["name", "symbol", "description", "image", "external_url"]) {
      if (!json[field]) {
        throw new Error(`Verification failed: ${key} metadata missing field: ${field}`);
      }
    }

    console.log(`  ${key} metadata verified OK`);
  }

  console.log("All uploads verified successfully.");
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = parseArgs();
  console.log(`\nUpload Token Metadata to Arweave`);
  console.log(`Cluster: ${args.cluster}`);
  console.log(`Keypair: ${args.keypair}`);
  console.log(`Force: ${args.force}\n`);

  // ----------------------------------------------------------
  // Idempotency check: skip if metadata already in deployment.json
  // ----------------------------------------------------------
  const existingConfig = loadDeploymentConfig(args.cluster);
  if (existingConfig?.metadata?.crime && !args.force) {
    console.log("Metadata already uploaded (found in deployment.json).");
    console.log("Use --force to re-upload.");
    console.log(`  CRIME:  ${existingConfig.metadata.crime}`);
    console.log(`  FRAUD:  ${existingConfig.metadata.fraud}`);
    console.log(`  PROFIT: ${existingConfig.metadata.profit}`);
    process.exit(0);
  }

  // ----------------------------------------------------------
  // Validate logo files exist before any uploads
  // ----------------------------------------------------------
  console.log("Checking logo files...");
  for (const key of TOKEN_KEYS) {
    const logoPath = path.join(PROJECT_ROOT, TOKENS[key].imagePath);
    if (!fs.existsSync(logoPath)) {
      console.error(`Error: Logo file not found: ${logoPath}`);
      console.error(`Place 512x512 PNG logos at assets/logos/{crime,fraud,profit}.png`);
      process.exit(1);
    }
    console.log(`  Found: ${TOKENS[key].imagePath}`);
  }

  // ----------------------------------------------------------
  // Initialize Irys uploader
  // ----------------------------------------------------------
  const irys = await createIrysUploader(args.keypair);
  const gatewayBase = ARWEAVE_GATEWAY;

  // ----------------------------------------------------------
  // Pre-fund Irys node with enough for all uploads
  // ----------------------------------------------------------
  console.log("\nCalculating total upload cost...");
  let totalSize = 0;
  for (const key of TOKEN_KEYS) {
    const logoPath = path.join(PROJECT_ROOT, TOKENS[key].imagePath);
    totalSize += fs.statSync(logoPath).size;
    // Estimate ~500 bytes per metadata JSON
    totalSize += 500;
  }
  const totalPrice = await irys.getPrice(totalSize);
  // Fund 3x the estimated cost to cover any rounding / per-upload overhead
  const fundAmount = BigInt(totalPrice.toString()) * 3n;
  console.log(`Total estimated size: ${totalSize} bytes`);
  console.log(`Estimated cost: ${irys.utils.fromAtomic(totalPrice)} SOL`);
  console.log(`Funding Irys node with: ${irys.utils.fromAtomic(fundAmount)} SOL (3x buffer)`);
  await irys.fund(fundAmount);
  console.log("Irys node funded. Proceeding with uploads...");

  // ----------------------------------------------------------
  // Step 1: Upload logo PNGs
  // ----------------------------------------------------------
  console.log("\n--- Step 1: Upload Logo PNGs ---");
  const imageUris: Record<string, string> = {};

  for (const key of TOKEN_KEYS) {
    try {
      imageUris[key] = await uploadFile(
        irys,
        TOKENS[key].imagePath,
        "image/png",
        `${key.toUpperCase()} logo`,
        gatewayBase,
      );
    } catch (err: any) {
      console.error(`\nFailed to upload ${key.toUpperCase()} logo: ${err.message}`);
      console.error("Aborting. No partial URIs written.");
      process.exit(1);
    }
  }

  // ----------------------------------------------------------
  // Step 2: Build and upload metadata JSON
  // ----------------------------------------------------------
  console.log("\n--- Step 2: Upload Metadata JSON ---");
  const metadataUris: Record<string, string> = {};

  for (const key of TOKEN_KEYS) {
    try {
      const metadataObj = buildMetadataJson(key, imageUris[key]);
      const jsonString = JSON.stringify(metadataObj, null, 2);

      metadataUris[key] = await uploadJson(
        irys,
        jsonString,
        `${key.toUpperCase()} metadata`,
        gatewayBase,
      );
    } catch (err: any) {
      console.error(`\nFailed to upload ${key.toUpperCase()} metadata: ${err.message}`);
      console.error("Aborting. No partial URIs written.");
      process.exit(1);
    }
  }

  // ----------------------------------------------------------
  // Step 3: Verify uploads
  // ----------------------------------------------------------
  try {
    await verifyUploads(imageUris, metadataUris);
  } catch (err: any) {
    console.error(`\nVerification failed: ${err.message}`);
    console.error("Aborting. No URIs written -- uploads may still be valid on Arweave.");
    process.exit(1);
  }

  // ----------------------------------------------------------
  // Step 4: Write URIs to deployment.json
  // ----------------------------------------------------------
  console.log("\n--- Step 4: Write URIs to Config Files ---");

  const config = existingConfig || {};
  config.metadata = {
    crime: metadataUris.crime,
    fraud: metadataUris.fraud,
    profit: metadataUris.profit,
  };
  writeDeploymentConfig(args.cluster, config);

  // ----------------------------------------------------------
  // Step 5: Write URIs to .env.{cluster}
  // ----------------------------------------------------------
  writeEnvFile(args.cluster, metadataUris);

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------
  console.log("\n=== Upload Complete ===");
  console.log("Image URIs:");
  for (const key of TOKEN_KEYS) {
    console.log(`  ${key.toUpperCase()}: ${imageUris[key]}`);
  }
  console.log("Metadata URIs:");
  for (const key of TOKEN_KEYS) {
    console.log(`  ${key.toUpperCase()}: ${metadataUris[key]}`);
  }
  console.log(`\nURIs written to: deployments/${args.cluster}.json`);
  console.log(`Env vars written to: .env.${args.cluster}`);
  console.log("\nNext: Run initialize.ts (or update-metadata-uri.ts for existing mints)");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
