/**
 * Sync Program IDs from Keypairs
 *
 * Reads all program keypairs from keypairs/ directory, derives their public keys,
 * and patches EVERY location in the codebase that references a program ID:
 *
 *   1. declare_id!() macros in each program's lib.rs
 *   2. Anchor.toml [programs.devnet] and [programs.localnet] sections
 *   3. Cross-program references in constants.rs files:
 *      - staking → tax_program_id(), epoch_program_id()
 *      - epoch → tax_program_id(), amm_program_id(), staking_program_id()
 *      - amm → TAX_PROGRAM_ID const
 *   4. Test assertions in constants.rs that verify program IDs
 *   5. target/deploy/ keypair copies (anchor build reads these)
 *
 * Why this script?
 * Before this existed, regenerating keypairs required manually updating 20+
 * locations across Rust source, TOML config, and deploy artifacts. Missing
 * any single one caused build failures, deploy mismatches, or silent runtime
 * bugs (wrong program constraint = rejected transactions). Phase 95 devnet
 * rehearsal proved this kills deploys. This script makes keypair regeneration
 * a one-command operation.
 *
 * Usage: npx tsx scripts/deploy/sync-program-ids.ts
 * Called by: scripts/deploy/build.sh (step [0a/3], before patch-mint-addresses)
 */

import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Program Registry
//
// Maps program names to their keypair paths and the locations that reference them.
// This is the SINGLE SOURCE OF TRUTH for program-to-keypair mapping.
// deploy.sh, build.sh, and this script all use the same keypair files.
// ---------------------------------------------------------------------------

interface ProgramEntry {
  /** Anchor program name (matches Anchor.toml key and target/deploy/ filename) */
  anchorName: string;
  /** Path to canonical keypair (relative to project root) */
  keypairPath: string;
  /** Path to lib.rs containing declare_id! (relative to project root) */
  libRsPath: string;
  /** target/deploy/ keypair filename (anchor build reads these) */
  targetDeployFilename: string;
  /** Whether this program appears in Anchor.toml [programs.devnet] */
  inDevnet: boolean;
}

const PROGRAMS: ProgramEntry[] = [
  {
    anchorName: "amm",
    keypairPath: "keypairs/amm-keypair.json",
    libRsPath: "programs/amm/src/lib.rs",
    targetDeployFilename: "amm-keypair.json",
    inDevnet: true,
  },
  {
    anchorName: "transfer_hook",
    keypairPath: "keypairs/transfer-hook-keypair.json",
    libRsPath: "programs/transfer-hook/src/lib.rs",
    targetDeployFilename: "transfer_hook-keypair.json",
    inDevnet: true,
  },
  {
    anchorName: "tax_program",
    keypairPath: "keypairs/tax-program-keypair.json",
    libRsPath: "programs/tax-program/src/lib.rs",
    targetDeployFilename: "tax_program-keypair.json",
    inDevnet: true,
  },
  {
    anchorName: "epoch_program",
    keypairPath: "keypairs/epoch-program.json",
    libRsPath: "programs/epoch-program/src/lib.rs",
    targetDeployFilename: "epoch_program-keypair.json",
    inDevnet: true,
  },
  {
    anchorName: "staking",
    keypairPath: "keypairs/staking-keypair.json",
    libRsPath: "programs/staking/src/lib.rs",
    targetDeployFilename: "staking-keypair.json",
    inDevnet: true,
  },
  {
    anchorName: "conversion_vault",
    keypairPath: "keypairs/vault-keypair.json",
    libRsPath: "programs/conversion-vault/src/lib.rs",
    targetDeployFilename: "conversion_vault-keypair.json",
    inDevnet: true,
  },
  {
    anchorName: "bonding_curve",
    keypairPath: "keypairs/bonding-curve-keypair.json",
    libRsPath: "programs/bonding_curve/src/lib.rs",
    targetDeployFilename: "bonding_curve-keypair.json",
    inDevnet: true,
  },
];

// Test fixture programs are NOT synced.
// - mock_tax_program: Intentionally mirrors tax_program's declare_id! for local tests
// - fake_tax_program: Has its own stable keypair for AMM access control testing
// - stub_staking: Has its own stable keypair for staking integration tests
// These never change between deploys and have non-standard ID relationships.
const FIXTURE_PROGRAMS: ProgramEntry[] = [];

// ---------------------------------------------------------------------------
// Cross-Program Reference Registry
//
// Every place a program's ID appears in ANOTHER program's source code.
// These are the references that silently break when keypairs change.
// ---------------------------------------------------------------------------

interface CrossRef {
  /** Human-readable label */
  label: string;
  /** File containing the reference (relative to project root) */
  file: string;
  /** Program whose ID this references */
  referencesProgram: string;
  /** Pattern type: how the address appears in source */
  pattern: "pubkey_macro_fn" | "pubkey_macro_const" | "assert_eq_string";
  /** Function or const name containing the reference */
  identifier: string;
}

const CROSS_REFS: CrossRef[] = [
  // staking/constants.rs references tax + epoch
  {
    label: "Staking → Tax Program",
    file: "programs/staking/src/constants.rs",
    referencesProgram: "tax_program",
    pattern: "pubkey_macro_fn",
    identifier: "tax_program_id",
  },
  {
    label: "Staking → Epoch Program",
    file: "programs/staking/src/constants.rs",
    referencesProgram: "epoch_program",
    pattern: "pubkey_macro_fn",
    identifier: "epoch_program_id",
  },
  // epoch/constants.rs references tax + amm + staking
  {
    label: "Epoch → Tax Program",
    file: "programs/epoch-program/src/constants.rs",
    referencesProgram: "tax_program",
    pattern: "pubkey_macro_fn",
    identifier: "tax_program_id",
  },
  {
    label: "Epoch → AMM Program",
    file: "programs/epoch-program/src/constants.rs",
    referencesProgram: "amm",
    pattern: "pubkey_macro_fn",
    identifier: "amm_program_id",
  },
  {
    label: "Epoch → Staking Program",
    file: "programs/epoch-program/src/constants.rs",
    referencesProgram: "staking",
    pattern: "pubkey_macro_fn",
    identifier: "staking_program_id",
  },
  // amm/constants.rs references tax
  {
    label: "AMM → Tax Program",
    file: "programs/amm/src/constants.rs",
    referencesProgram: "tax_program",
    pattern: "pubkey_macro_const",
    identifier: "TAX_PROGRAM_ID",
  },
  // epoch/constants.rs test assertions
  {
    label: "Epoch test → Tax Program",
    file: "programs/epoch-program/src/constants.rs",
    referencesProgram: "tax_program",
    pattern: "assert_eq_string",
    identifier: "test_tax_program_id",
  },
  {
    label: "Epoch test → AMM Program",
    file: "programs/epoch-program/src/constants.rs",
    referencesProgram: "amm",
    pattern: "assert_eq_string",
    identifier: "test_amm_program_id",
  },
  {
    label: "Epoch test → Staking Program",
    file: "programs/epoch-program/src/constants.rs",
    referencesProgram: "staking",
    pattern: "assert_eq_string",
    identifier: "test_staking_program_id",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypair(relativePath: string): Keypair {
  const resolved = path.resolve(PROJECT_ROOT, relativePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair not found: ${resolved}`);
  }
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Patchers
// ---------------------------------------------------------------------------

/** Patch declare_id!("OLD_ADDRESS") → declare_id!("NEW_ADDRESS") */
function patchDeclareId(content: string, newAddress: string): { content: string; patched: boolean } {
  const regex = /declare_id!\("([A-Za-z0-9]+)"\)/;
  const match = content.match(regex);
  if (!match) {
    return { content, patched: false };
  }
  if (match[1] === newAddress) {
    return { content, patched: false };
  }
  return {
    content: content.replace(regex, `declare_id!("${newAddress}")`),
    patched: true,
  };
}

/**
 * Patch pubkey!("OLD") inside a function body:
 *   pub fn name() -> Pubkey { pubkey!("OLD") }
 */
function patchPubkeyMacroFn(
  content: string,
  fnName: string,
  newAddress: string
): { content: string; patched: boolean } {
  const regex = new RegExp(
    `(pub\\s+fn\\s+${escapeRegex(fnName)}\\s*\\(\\)\\s*->\\s*Pubkey\\s*\\{[^}]*?)` +
      `pubkey!\\("([A-Za-z0-9]+)"\\)`,
    "s"
  );
  const match = content.match(regex);
  if (!match) return { content, patched: false };
  if (match[2] === newAddress) return { content, patched: false };
  return {
    content: content.replace(regex, `$1pubkey!("${newAddress}")`),
    patched: true,
  };
}

/**
 * Patch pubkey!("OLD") in a const declaration:
 *   pub const NAME: Pubkey = pubkey!("OLD");
 */
function patchPubkeyMacroConst(
  content: string,
  constName: string,
  newAddress: string
): { content: string; patched: boolean } {
  const regex = new RegExp(
    `(pub\\s+const\\s+${escapeRegex(constName)}\\s*:\\s*Pubkey\\s*=\\s*)` +
      `pubkey!\\("([A-Za-z0-9]+)"\\)`,
    "s"
  );
  const match = content.match(regex);
  if (!match) return { content, patched: false };
  if (match[2] === newAddress) return { content, patched: false };
  return {
    content: content.replace(regex, `$1pubkey!("${newAddress}")`),
    patched: true,
  };
}

/**
 * Patch test assertion strings like:
 *   assert_eq!(id.to_string(), "OLD_ADDRESS");
 *
 * Finds the test function by name, then patches the string literal inside it.
 */
function patchAssertEqString(
  content: string,
  testFnName: string,
  oldAddress: string,
  newAddress: string
): { content: string; patched: boolean } {
  if (oldAddress === newAddress) return { content, patched: false };
  // Find the test function and replace the old address string within it
  const fnRegex = new RegExp(
    `(fn\\s+${escapeRegex(testFnName)}\\s*\\(\\)[^{]*\\{[\\s\\S]*?)` +
      `"${escapeRegex(oldAddress)}"`,
    ""
  );
  const match = content.match(fnRegex);
  if (!match) return { content, patched: false };
  return {
    content: content.replace(fnRegex, `$1"${newAddress}"`),
    patched: true,
  };
}

/**
 * Patch Anchor.toml program ID entries.
 * Handles both [programs.devnet] and [programs.localnet] sections.
 */
function patchAnchorToml(
  content: string,
  programName: string,
  newAddress: string
): { content: string; patched: boolean } {
  // Match: program_name = "OLD_ADDRESS" at start of line
  // The (?:^|\n) anchor prevents "tax_program" from matching inside "mock_tax_program"
  const regex = new RegExp(
    `((?:^|\\n)(${escapeRegex(programName)})\\s*=\\s*)"([A-Za-z0-9]+)"`,
    "g"
  );
  let patched = false;
  const updated = content.replace(regex, (fullMatch, prefix, name, oldAddress) => {
    if (oldAddress === newAddress) return fullMatch;
    patched = true;
    return `${prefix}"${newAddress}"`;
  });
  return { content: updated, patched };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("Sync Program IDs");
  console.log("=================\n");

  // Load all program keypairs and derive addresses
  const allPrograms = [...PROGRAMS, ...FIXTURE_PROGRAMS];
  const addressMap = new Map<string, string>();

  for (const prog of allPrograms) {
    const resolved = path.resolve(PROJECT_ROOT, prog.keypairPath);
    if (!fs.existsSync(resolved)) {
      // Fixture programs may not exist — skip silently
      if (FIXTURE_PROGRAMS.includes(prog)) {
        console.log(`  SKIP: ${prog.anchorName} keypair not found (fixture)`);
        continue;
      }
      console.error(`ERROR: Keypair not found: ${prog.keypairPath}`);
      process.exit(1);
    }
    const kp = loadKeypair(prog.keypairPath);
    const addr = kp.publicKey.toBase58();
    addressMap.set(prog.anchorName, addr);
    console.log(`  ${prog.anchorName}: ${addr}`);
  }
  console.log("");

  let totalPatched = 0;
  let totalSkipped = 0;

  // File content cache to avoid re-reading
  const fileCache = new Map<string, string>();
  function getFile(relPath: string): string {
    if (!fileCache.has(relPath)) {
      const abs = path.resolve(PROJECT_ROOT, relPath);
      fileCache.set(relPath, fs.readFileSync(abs, "utf8"));
    }
    return fileCache.get(relPath)!;
  }
  function setFile(relPath: string, content: string) {
    fileCache.set(relPath, content);
  }

  // --- Step 1: Patch declare_id! macros ---
  console.log("Step 1: declare_id! macros");
  for (const prog of allPrograms) {
    const addr = addressMap.get(prog.anchorName);
    if (!addr) continue;

    const absPath = path.resolve(PROJECT_ROOT, prog.libRsPath);
    if (!fs.existsSync(absPath)) continue;

    let content = getFile(prog.libRsPath);
    const { content: updated, patched } = patchDeclareId(content, addr);
    setFile(prog.libRsPath, updated);

    if (patched) {
      console.log(`  PATCHED: ${prog.anchorName} → ${addr}`);
      totalPatched++;
    } else {
      console.log(`  SKIP:    ${prog.anchorName} (already correct)`);
      totalSkipped++;
    }
  }
  console.log("");

  // --- Step 2: Patch Anchor.toml ---
  console.log("Step 2: Anchor.toml");
  let tomlContent = getFile("Anchor.toml");
  for (const prog of allPrograms) {
    const addr = addressMap.get(prog.anchorName);
    if (!addr) continue;

    const { content: updated, patched } = patchAnchorToml(tomlContent, prog.anchorName, addr);
    tomlContent = updated;

    if (patched) {
      console.log(`  PATCHED: ${prog.anchorName} → ${addr}`);
      totalPatched++;
    } else {
      console.log(`  SKIP:    ${prog.anchorName} (already correct)`);
      totalSkipped++;
    }
  }
  setFile("Anchor.toml", tomlContent);
  console.log("");

  // --- Step 3: Cross-program references ---
  console.log("Step 3: Cross-program references");

  // First pass: collect old addresses for assert_eq patches
  const oldAddresses = new Map<string, Map<string, string>>();

  for (const ref of CROSS_REFS) {
    const addr = addressMap.get(ref.referencesProgram);
    if (!addr) continue;

    let content = getFile(ref.file);
    let patched = false;
    let result: { content: string; patched: boolean };

    switch (ref.pattern) {
      case "pubkey_macro_fn":
        result = patchPubkeyMacroFn(content, ref.identifier, addr);
        break;
      case "pubkey_macro_const":
        result = patchPubkeyMacroConst(content, ref.identifier, addr);
        break;
      case "assert_eq_string": {
        // For test assertions, we need to find the OLD address first
        // by scanning the test function for a base58 string
        const testFnRegex = new RegExp(
          `fn\\s+${escapeRegex(ref.identifier)}\\s*\\(\\)[^{]*\\{[\\s\\S]*?"([A-Za-z0-9]{32,44})"`,
          ""
        );
        const testMatch = content.match(testFnRegex);
        if (testMatch && testMatch[1] !== addr) {
          result = patchAssertEqString(content, ref.identifier, testMatch[1], addr);
        } else {
          result = { content, patched: false };
        }
        break;
      }
      default:
        result = { content, patched: false };
    }

    setFile(ref.file, result.content);

    if (result.patched) {
      console.log(`  PATCHED: ${ref.label}`);
      totalPatched++;
    } else {
      console.log(`  SKIP:    ${ref.label} (already correct)`);
      totalSkipped++;
    }
  }
  console.log("");

  // --- Step 4: Copy keypairs to target/deploy/ ---
  console.log("Step 4: Copy keypairs to target/deploy/");
  const targetDir = path.resolve(PROJECT_ROOT, "target/deploy");
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const prog of allPrograms) {
    const srcPath = path.resolve(PROJECT_ROOT, prog.keypairPath);
    if (!fs.existsSync(srcPath)) continue;

    const destPath = path.resolve(targetDir, prog.targetDeployFilename);
    const srcBytes = fs.readFileSync(srcPath);
    const destExists = fs.existsSync(destPath);
    const destBytes = destExists ? fs.readFileSync(destPath) : null;

    if (destBytes && srcBytes.equals(destBytes)) {
      console.log(`  SKIP:    ${prog.targetDeployFilename} (already matches)`);
      totalSkipped++;
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  COPIED:  ${prog.keypairPath} → target/deploy/${prog.targetDeployFilename}`);
      totalPatched++;
    }
  }
  console.log("");

  // --- Write all modified files ---
  console.log("Writing files...");
  let filesWritten = 0;
  for (const [relPath, content] of fileCache) {
    const absPath = path.resolve(PROJECT_ROOT, relPath);
    const original = fs.readFileSync(absPath, "utf8");
    if (content !== original) {
      fs.writeFileSync(absPath, content);
      console.log(`  WROTE: ${relPath}`);
      filesWritten++;
    }
  }
  if (filesWritten === 0) {
    console.log("  No files needed writing (all already correct)");
  }

  console.log(`\nSummary: ${totalPatched} patched, ${totalSkipped} skipped`);
  console.log("Done.\n");
}

main();
