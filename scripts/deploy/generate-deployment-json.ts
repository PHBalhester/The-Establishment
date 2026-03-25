/**
 * Generate Deployment JSON
 *
 * Standalone script that reads program IDs from Anchor.toml, mint addresses
 * from mint-keypairs/ or pda-manifest.json, ALT address from alt-address.json,
 * and generates `deployments/{cluster}.json`.
 *
 * Usage: npx tsx scripts/deploy/generate-deployment-json.ts devnet
 *        npx tsx scripts/deploy/generate-deployment-json.ts mainnet
 *
 * Source: .planning/phases/91-deploy-config-foundation/91-01-PLAN.md
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { generateDeploymentConfig, ProgramIds, MintKeys } from "./lib/pda-manifest";
import { validateDeploymentConfig } from "./lib/deployment-schema";

// =============================================================================
// Helpers
// =============================================================================

const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * Parse program IDs from Anchor.toml [programs.{cluster}] section.
 *
 * Anchor.toml uses snake_case program names in the TOML section. We map them
 * to the ProgramIds interface's camelCase keys.
 */
function readProgramIdsFromAnchorToml(cluster: string): ProgramIds {
  const anchorTomlPath = path.join(PROJECT_ROOT, "Anchor.toml");
  const content = fs.readFileSync(anchorTomlPath, "utf8");

  // Parse the [programs.{cluster}] section
  const sectionRegex = new RegExp(`\\[programs\\.${cluster}\\]([\\s\\S]*?)(?=\\n\\[|$)`);
  const match = content.match(sectionRegex);
  if (!match) {
    throw new Error(`No [programs.${cluster}] section found in Anchor.toml`);
  }

  const section = match[1];
  const programs: Record<string, string> = {};
  const lineRegex = /(\w+)\s*=\s*"([^"]+)"/g;
  let lineMatch;
  while ((lineMatch = lineRegex.exec(section)) !== null) {
    programs[lineMatch[1]] = lineMatch[2];
  }

  // Map Anchor.toml snake_case names to ProgramIds interface keys
  const nameMap: Record<string, keyof ProgramIds> = {
    amm: "amm",
    transfer_hook: "transferHook",
    tax_program: "taxProgram",
    epoch_program: "epochProgram",
    staking: "staking",
    conversion_vault: "conversionVault",
    bonding_curve: "bondingCurve",
  };

  const result: Partial<Record<keyof ProgramIds, PublicKey>> = {};
  for (const [tomlName, interfaceKey] of Object.entries(nameMap)) {
    if (!programs[tomlName]) {
      throw new Error(`Missing program '${tomlName}' in Anchor.toml [programs.${cluster}]`);
    }
    result[interfaceKey] = new PublicKey(programs[tomlName]);
  }

  return result as ProgramIds;
}

/**
 * Read mint addresses from mint-keypairs/ directory.
 * Falls back to pda-manifest.json if keypair files don't exist.
 */
function readMintAddresses(): MintKeys {
  const keypairsDir = path.join(__dirname, "mint-keypairs");
  const mintNames = ["crime", "fraud", "profit"] as const;

  // Try loading from keypair files first
  const fromKeypairs: Partial<Record<string, PublicKey>> = {};
  let allFound = true;

  for (const name of mintNames) {
    const filePath = path.join(keypairsDir, `${name}-mint.json`);
    if (fs.existsSync(filePath)) {
      const secretKey = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      fromKeypairs[name] = keypair.publicKey;
    } else {
      allFound = false;
    }
  }

  if (allFound) {
    return {
      crime: fromKeypairs.crime!,
      fraud: fromKeypairs.fraud!,
      profit: fromKeypairs.profit!,
    };
  }

  // Fallback: read from pda-manifest.json
  const manifestPath = path.join(__dirname, "pda-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      "Cannot determine mint addresses: no mint-keypairs/ directory and no pda-manifest.json. " +
      "Run initialize.ts first or ensure mint keypair files exist."
    );
  }

  console.log("  Using mint addresses from pda-manifest.json (no mint-keypairs/ found)");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    crime: new PublicKey(manifest.mints.CRIME),
    fraud: new PublicKey(manifest.mints.FRAUD),
    profit: new PublicKey(manifest.mints.PROFIT),
  };
}

/**
 * Read ALT address from alt-address.json.
 * Returns null if the file doesn't exist.
 */
function readAltAddress(): string | null {
  const altPath = path.join(__dirname, "alt-address.json");
  if (!fs.existsSync(altPath)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(altPath, "utf8"));
  return data.altAddress || null;
}

/**
 * Determine treasury address.
 * Reads from TREASURY_PUBKEY env var, or falls back to deployer wallet.
 */
function readTreasury(defaultDeployer: string): string {
  return process.env.TREASURY_PUBKEY || defaultDeployer;
}

/**
 * Determine deployer address.
 * Reads from the Anchor wallet keypair or ANCHOR_WALLET env var.
 */
function readDeployerAddress(): string {
  // Prefer project's devnet-wallet.json (the actual deployer) over system default
  const devnetWalletPath = path.join(PROJECT_ROOT, "keypairs", "devnet-wallet.json");

  // Fall back to ANCHOR_WALLET env var or default Solana CLI keypair
  const walletPath = process.env.ANCHOR_WALLET || path.join(
    process.env.HOME || "~",
    ".config/solana/id.json"
  );

  const pathToUse = fs.existsSync(devnetWalletPath)
    ? devnetWalletPath
    : fs.existsSync(walletPath)
      ? walletPath
      : null;

  if (pathToUse) {
    const secretKey = JSON.parse(fs.readFileSync(pathToUse, "utf8"));
    const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    return keypair.publicKey.toBase58();
  }

  // Hardcoded devnet deployer as ultimate fallback
  return "8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4";
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const cluster = process.argv[2];
  if (!cluster || !["devnet", "mainnet"].includes(cluster)) {
    console.error("Usage: npx tsx scripts/deploy/generate-deployment-json.ts <devnet|mainnet>");
    console.error("");
    console.error("  Generates deployments/{cluster}.json from Anchor.toml + mint keypairs.");
    process.exit(1);
  }

  console.log(`Generating deployments/${cluster}.json...`);

  // Anchor.toml uses "devnet" for both devnet and localnet sections
  const anchorCluster = cluster === "mainnet" ? "devnet" : "devnet"; // TODO: Add [programs.mainnet] to Anchor.toml for mainnet

  console.log("  Reading program IDs from Anchor.toml...");
  const programIds = readProgramIdsFromAnchorToml(anchorCluster);

  console.log("  Reading mint addresses...");
  const mints = readMintAddresses();

  console.log("  Reading ALT address...");
  const altAddress = readAltAddress();

  const deployer = readDeployerAddress();
  const treasury = readTreasury(deployer);

  console.log(`  Deployer: ${deployer}`);
  console.log(`  Treasury: ${treasury}`);
  console.log(`  ALT: ${altAddress || "(none)"}`);

  console.log("  Generating deployment config...");
  const config = generateDeploymentConfig(
    cluster,
    programIds,
    mints,
    altAddress,
    treasury,
    deployer,
  );

  // Validate before writing
  const errors = validateDeploymentConfig(config);
  if (errors.length > 0) {
    console.error("\nValidation errors in generated config:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Write to deployments/{cluster}.json
  const deploymentsDir = path.join(PROJECT_ROOT, "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const outputPath = path.join(deploymentsDir, `${cluster}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n");

  console.log(`\nWrote ${outputPath}`);
  console.log(`  Schema version: ${config.schemaVersion}`);
  console.log(`  Programs: ${Object.keys(config.programs).length}`);
  console.log(`  Mints: ${Object.keys(config.mints).length}`);
  console.log(`  PDAs: ${Object.keys(config.pdas).length}`);
  console.log(`  Pools: ${Object.keys(config.pools).length}`);
  console.log(`  Curve PDAs: ${Object.keys(config.curvePdas).length}`);
  console.log(`  Hook accounts: ${Object.keys(config.hookAccounts).length}`);
}

main();
