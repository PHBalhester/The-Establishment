/**
 * Patch Mint Addresses in Rust Constants
 *
 * Reads keypairs from mint-keypairs/ and keypairs/ directories, derives their
 * public keys, and patches the hardcoded Pubkey::from_str("...") values in
 * Rust constants.rs files.
 *
 * Three categories of patches:
 *   1. Vault mint addresses:  programs/conversion-vault/src/constants.rs
 *      - crime_mint(), fraud_mint(), profit_mint()
 *   2. Tax program cross-refs: programs/tax-program/src/constants.rs
 *      - epoch_program_id(), staking_program_id(), amm_program_id()
 *   3. Treasury wallet:        programs/tax-program/src/constants.rs
 *      - treasury_pubkey() (from TREASURY_PUBKEY env var or devnet wallet default)
 *   4. Bonding curve refs:     programs/bonding_curve/src/constants.rs
 *      - crime_mint(), fraud_mint(), epoch_program_id()
 *
 * This script supports both devnet (auto-generated keypairs) and mainnet
 * (pre-placed vanity keypairs) workflows with the same logic.
 *
 * Usage: npx tsx scripts/deploy/patch-mint-addresses.ts
 * Called by: scripts/deploy/build.sh (before anchor build)
 */

import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Keypair Loading
// ---------------------------------------------------------------------------

function loadKeypair(filePath: string): Keypair {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair not found: ${resolved}`);
  }
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

// ---------------------------------------------------------------------------
// Patching Logic
// ---------------------------------------------------------------------------

interface PatchSpec {
  /** Human-readable label for logging */
  label: string;
  /** Path to the Rust file (relative to project root) */
  file: string;
  /** The function name to find (e.g. "crime_mint") */
  functionName: string;
  /** The new address string to insert */
  newAddress: string;
}

/**
 * Patch a single Pubkey::from_str("...") call for the given function name.
 *
 * Strategy: Patches ALL cfg variants (devnet, mainnet, non-gated) of the function.
 * The devnet block gets patched first (primary target), then the mainnet block
 * (which may contain compile_error!() placeholders that need replacing).
 */
function patchFile(content: string, spec: PatchSpec): { content: string; patched: boolean } {
  // Patch all cfg variants: devnet-gated, mainnet-gated (not devnet/localnet), and non-gated
  const prefixes = [
    `#\\[cfg\\(feature\\s*=\\s*"devnet"\\)\\]\\s*`,                          // devnet-gated
    `#\\[cfg\\(not\\(any\\(feature\\s*=\\s*"devnet",\\s*feature\\s*=\\s*"localnet"\\)\\)\\)\\]\\s*`, // mainnet-gated
    ``,                                                                        // non-gated
  ];

  let anyPatched = false;
  let result = content;

  for (const prefix of prefixes) {
    // Try Pubkey::from_str("...") pattern
    const fnRegex = new RegExp(
      `(${prefix}pub\\s+fn\\s+${escapeRegex(spec.functionName)}\\s*\\(\\)\\s*->\\s*Pubkey\\s*\\{[^}]*?)` +
      `Pubkey::from_str\\("([A-Za-z0-9]+)"\\)`,
      "s"
    );

    const match = result.match(fnRegex);
    if (match) {
      const oldAddress = match[2];
      if (oldAddress !== spec.newAddress) {
        result = result.replace(fnRegex, `$1Pubkey::from_str("${spec.newAddress}")`);
        anyPatched = true;
      }
      continue;
    }

    // Try compile_error!(...) placeholder (mainnet cfg blocks before first mainnet build)
    const compileErrorRegex = new RegExp(
      `(${prefix}pub\\s+fn\\s+${escapeRegex(spec.functionName)}\\s*\\(\\)\\s*->\\s*Pubkey\\s*\\{\\s*)` +
      `compile_error!\\([^)]*\\);?\\s*`,
      "s"
    );

    const compileErrorMatch = result.match(compileErrorRegex);
    if (compileErrorMatch) {
      result = result.replace(compileErrorRegex, `$1Pubkey::from_str("${spec.newAddress}").unwrap()\n`);
      anyPatched = true;
      continue;
    }

    // Try Pubkey::default() placeholder
    const defaultRegex = new RegExp(
      `(${prefix}pub\\s+fn\\s+${escapeRegex(spec.functionName)}\\s*\\(\\)\\s*->\\s*Pubkey\\s*\\{[^}]*?)` +
      `Pubkey::default\\(\\)`,
      "s"
    );

    const defaultMatch = result.match(defaultRegex);
    if (defaultMatch) {
      result = result.replace(defaultRegex, `$1Pubkey::from_str("${spec.newAddress}").unwrap()`);
      anyPatched = true;
    }
  }

  if (!anyPatched) {
    // Check if already correct in all variants
    const alreadyCorrect = new RegExp(
      `pub\\s+fn\\s+${escapeRegex(spec.functionName)}\\s*\\(\\)\\s*->\\s*Pubkey\\s*\\{[^}]*?` +
      `Pubkey::from_str\\("${escapeRegex(spec.newAddress)}"\\)`,
      "s"
    );
    if (result.match(alreadyCorrect)) {
      return { content: result, patched: false }; // Already correct
    }
    console.warn(`  WARNING: Could not find ${spec.functionName}() in ${spec.file}`);
  }

  return { content: result, patched: anyPatched };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const isDevnet = process.argv.includes("--devnet");

  console.log("Patch Mint Addresses");
  console.log(`====================  [${isDevnet ? "DEVNET" : "MAINNET"}]\n`);

  let crimeMintAddress: string;
  let fraudMintAddress: string;
  let profitMintAddress: string;
  let epochProgramAddress: string;
  let stakingProgramAddress: string;
  let ammProgramAddress: string;
  let treasuryAddress: string;

  if (isDevnet) {
    // Devnet: read addresses from deployments/devnet.json (source of truth for devnet).
    // keypairs/ contains mainnet keypairs — cannot be used for devnet builds.
    const devnetJsonPath = path.resolve(PROJECT_ROOT, "deployments/devnet.json");
    if (!fs.existsSync(devnetJsonPath)) {
      console.error("ERROR: deployments/devnet.json not found.");
      console.error("This file is required for devnet builds to resolve correct program IDs.");
      process.exit(1);
    }
    const devnet = JSON.parse(fs.readFileSync(devnetJsonPath, "utf8"));
    crimeMintAddress = devnet.mints.crime;
    fraudMintAddress = devnet.mints.fraud;
    profitMintAddress = devnet.mints.profit;
    epochProgramAddress = devnet.programs.epochProgram;
    stakingProgramAddress = devnet.programs.staking;
    ammProgramAddress = devnet.programs.amm;
    treasuryAddress = devnet.treasury;
    console.log("  Source: deployments/devnet.json\n");
  } else {
    // Mainnet: derive addresses from keypairs (existing behavior, unchanged).
    const mintKeypairsDir = path.resolve(PROJECT_ROOT, "scripts/deploy/mint-keypairs");
    if (!fs.existsSync(mintKeypairsDir)) {
      console.error("ERROR: scripts/deploy/mint-keypairs/ directory not found.");
      console.error("This directory must contain crime-mint.json, fraud-mint.json, profit-mint.json.");
      process.exit(1);
    }

    const crimeMint = loadKeypair("scripts/deploy/mint-keypairs/crime-mint.json");
    const fraudMint = loadKeypair("scripts/deploy/mint-keypairs/fraud-mint.json");
    const profitMint = loadKeypair("scripts/deploy/mint-keypairs/profit-mint.json");
    const epochProgram = loadKeypair("keypairs/epoch-program.json");
    const stakingProgram = loadKeypair("keypairs/staking-keypair.json");
    const ammProgram = loadKeypair("keypairs/amm-keypair.json");

    crimeMintAddress = crimeMint.publicKey.toBase58();
    fraudMintAddress = fraudMint.publicKey.toBase58();
    profitMintAddress = profitMint.publicKey.toBase58();
    epochProgramAddress = epochProgram.publicKey.toBase58();
    stakingProgramAddress = stakingProgram.publicKey.toBase58();
    ammProgramAddress = ammProgram.publicKey.toBase58();
    treasuryAddress = process.env.TREASURY_PUBKEY || "8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4";
    console.log("  Source: keypairs/\n");
  }

  // Build patch specs
  const patches: PatchSpec[] = [
    // Category 1: Vault mint addresses
    {
      label: "Vault CRIME mint",
      file: "programs/conversion-vault/src/constants.rs",
      functionName: "crime_mint",
      newAddress: crimeMintAddress,
    },
    {
      label: "Vault FRAUD mint",
      file: "programs/conversion-vault/src/constants.rs",
      functionName: "fraud_mint",
      newAddress: fraudMintAddress,
    },
    {
      label: "Vault PROFIT mint",
      file: "programs/conversion-vault/src/constants.rs",
      functionName: "profit_mint",
      newAddress: profitMintAddress,
    },
    // Category 2: Tax program cross-refs
    {
      label: "Tax epoch_program_id",
      file: "programs/tax-program/src/constants.rs",
      functionName: "epoch_program_id",
      newAddress: epochProgramAddress,
    },
    {
      label: "Tax staking_program_id",
      file: "programs/tax-program/src/constants.rs",
      functionName: "staking_program_id",
      newAddress: stakingProgramAddress,
    },
    {
      label: "Tax amm_program_id",
      file: "programs/tax-program/src/constants.rs",
      functionName: "amm_program_id",
      newAddress: ammProgramAddress,
    },
    // Category 3: Treasury wallet
    {
      label: "Tax treasury_pubkey",
      file: "programs/tax-program/src/constants.rs",
      functionName: "treasury_pubkey",
      newAddress: treasuryAddress,
    },
    // Category 4: Bonding curve mint addresses + cross-program ref
    {
      label: "Curve CRIME mint",
      file: "programs/bonding_curve/src/constants.rs",
      functionName: "crime_mint",
      newAddress: crimeMintAddress,
    },
    {
      label: "Curve FRAUD mint",
      file: "programs/bonding_curve/src/constants.rs",
      functionName: "fraud_mint",
      newAddress: fraudMintAddress,
    },
    {
      label: "Curve epoch_program_id",
      file: "programs/bonding_curve/src/constants.rs",
      functionName: "epoch_program_id",
      newAddress: epochProgramAddress,
    },
  ];

  // Apply patches grouped by file
  const fileContents = new Map<string, string>();
  let totalPatched = 0;
  let totalSkipped = 0;

  for (const spec of patches) {
    const filePath = path.resolve(PROJECT_ROOT, spec.file);

    // Load file content (cache across patches to same file)
    if (!fileContents.has(spec.file)) {
      if (!fs.existsSync(filePath)) {
        console.error(`ERROR: File not found: ${spec.file}`);
        process.exit(1);
      }
      fileContents.set(spec.file, fs.readFileSync(filePath, "utf8"));
    }

    const content = fileContents.get(spec.file)!;
    const { content: updated, patched } = patchFile(content, spec);
    fileContents.set(spec.file, updated);

    if (patched) {
      console.log(`  PATCHED: ${spec.label} -> ${spec.newAddress}`);
      totalPatched++;
    } else {
      console.log(`  SKIP:    ${spec.label} (already correct)`);
      totalSkipped++;
    }
  }

  // Write modified files back
  for (const [relPath, content] of fileContents) {
    const filePath = path.resolve(PROJECT_ROOT, relPath);
    fs.writeFileSync(filePath, content, { mode: 0o600 });
  }

  console.log(`\nSummary: ${totalPatched} patched, ${totalSkipped} skipped`);
  console.log("Done.\n");
}

main();
