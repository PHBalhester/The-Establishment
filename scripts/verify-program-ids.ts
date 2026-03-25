/**
 * Dr. Fraudsworth Program ID Verification Script
 *
 * Verifies all program ID references are consistent across the codebase:
 * - Keypair files -> derived pubkeys (source of truth)
 * - declare_id! macros in lib.rs
 * - Anchor.toml [programs.localnet] and [programs.devnet]
 * - Cross-program references in constants.rs files
 * - Placeholder ID detection
 *
 * Usage:
 *   npx tsx scripts/verify-program-ids.ts          # Human-readable output
 *   npx tsx scripts/verify-program-ids.ts --json   # JSON output
 *
 * Exit codes:
 *   0 = All checks pass
 *   1 = One or more checks fail
 */

import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// ANSI color codes
// ---------------------------------------------------------------------------
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Program Registry
// ---------------------------------------------------------------------------
// Each entry maps a logical program name to its keypair file, lib.rs path,
// and Anchor.toml name. The keypair-derived pubkey is the source of truth.
// ---------------------------------------------------------------------------

interface ProgramEntry {
  keypairPath: string;
  libPath: string;
  anchorName: string;
  isProduction: boolean;
  /**
   * If set, the declare_id! is expected to differ from the keypair.
   * This is used for test-only programs that must be deployed at a production
   * program's address (e.g., mock_tax_program deploys at TAX_PROGRAM_ID
   * so AMM's seeds::program constraint is satisfied in LiteSVM tests).
   */
  expectedDeclareId?: string;
}

const PROGRAMS: Record<string, ProgramEntry> = {
  // Production programs
  amm: {
    keypairPath: "keypairs/amm-keypair.json",
    libPath: "programs/amm/src/lib.rs",
    anchorName: "amm",
    isProduction: true,
  },
  transfer_hook: {
    keypairPath: "keypairs/transfer-hook-keypair.json",
    libPath: "programs/transfer-hook/src/lib.rs",
    anchorName: "transfer_hook",
    isProduction: true,
  },
  tax_program: {
    keypairPath: "keypairs/tax-program-keypair.json",
    libPath: "programs/tax-program/src/lib.rs",
    anchorName: "tax_program",
    isProduction: true,
  },
  epoch_program: {
    keypairPath: "keypairs/epoch-program.json",
    libPath: "programs/epoch-program/src/lib.rs",
    anchorName: "epoch_program",
    isProduction: true,
  },
  staking: {
    keypairPath: "keypairs/staking-keypair.json",
    libPath: "programs/staking/src/lib.rs",
    anchorName: "staking",
    isProduction: true,
  },
  conversion_vault: {
    keypairPath: "keypairs/vault-keypair.json",
    libPath: "programs/conversion-vault/src/lib.rs",
    anchorName: "conversion_vault",
    isProduction: true,
  },
  // Test/helper programs
  mock_tax_program: {
    keypairPath: "keypairs/mock-tax-keypair.json",
    libPath: "programs/mock-tax-program/src/lib.rs",
    anchorName: "mock_tax_program",
    isProduction: false,
    // Mock Tax must declare_id! = TAX_PROGRAM_ID so Anchor's runtime check passes
    // when deployed at the Tax Program address in LiteSVM integration tests.
    expectedDeclareId: "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj",
  },
  fake_tax_program: {
    keypairPath: "keypairs/fake-tax-keypair.json",
    libPath: "programs/fake-tax-program/src/lib.rs",
    anchorName: "fake_tax_program",
    isProduction: false,
  },
  stub_staking: {
    keypairPath: "keypairs/StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU.json",
    libPath: "programs/stub-staking/src/lib.rs",
    anchorName: "stub_staking",
    isProduction: false,
  },
};

// ---------------------------------------------------------------------------
// Cross-program Reference Registry
// ---------------------------------------------------------------------------
// Each entry describes a place where one program hard-codes another program's
// ID. The script verifies these cross-references match the expected program's
// keypair-derived pubkey (or its declare_id! if no keypair exists).
// ---------------------------------------------------------------------------

interface CrossRef {
  sourceFile: string;
  referenceName: string;
  expectedProgram: string;
  // Pattern to extract the ID from the source file. Applied per-line.
  pattern: RegExp;
}

const CROSS_REFS: CrossRef[] = [
  {
    sourceFile: "programs/tax-program/src/constants.rs",
    referenceName: "epoch_program_id()",
    expectedProgram: "epoch_program",
    pattern: /Pubkey::from_str\("([A-Za-z0-9]+)"\)/,
  },
  {
    sourceFile: "programs/tax-program/src/constants.rs",
    referenceName: "staking_program_id()",
    expectedProgram: "staking",
    pattern: /Pubkey::from_str\("([A-Za-z0-9]+)"\)/,
  },
  {
    sourceFile: "programs/staking/src/constants.rs",
    referenceName: "tax_program_id()",
    expectedProgram: "tax_program",
    pattern: /pubkey!\("([A-Za-z0-9]+)"\)/,
  },
  {
    sourceFile: "programs/staking/src/constants.rs",
    referenceName: "epoch_program_id()",
    expectedProgram: "epoch_program",
    pattern: /pubkey!\("([A-Za-z0-9]+)"\)/,
  },
  {
    sourceFile: "programs/amm/src/constants.rs",
    referenceName: "TAX_PROGRAM_ID",
    expectedProgram: "tax_program",
    pattern: /pubkey!\("([A-Za-z0-9]+)"\)/,
  },
];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface ProgramResult {
  keypairExists: boolean;
  keypairId: string | null;
  declareId: string | null;
  declareIdMatch: boolean | null;
  anchorLocalnet: string | null;
  anchorLocalnetMatch: boolean | null;
  anchorDevnet: string | null;
  anchorDevnetMatch: boolean | null;
  allMatch: boolean;
  errors: string[];
}

interface CrossRefResult {
  source: string;
  ref: string;
  expected: string;
  actual: string | null;
  match: boolean;
}

interface PlaceholderResult {
  file: string;
  line: number;
  content: string;
}

interface VerificationResult {
  timestamp: string;
  programs: Record<string, ProgramResult>;
  crossRefs: CrossRefResult[];
  placeholders: PlaceholderResult[];
  summary: { total: number; passed: number; failed: number };
  success: boolean;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");

function resolveRoot(relPath: string): string {
  return path.join(ROOT, relPath);
}

/**
 * Derive the base58 public key from a Solana keypair JSON file.
 */
function deriveKeypairPubkey(keypairPath: string): string | null {
  const fullPath = resolveRoot(keypairPath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    const kp = Keypair.fromSecretKey(Uint8Array.from(data));
    return kp.publicKey.toBase58();
  } catch {
    return null;
  }
}

/**
 * Extract the declare_id!("...") value from a Rust lib.rs file.
 */
function extractDeclareId(libPath: string): string | null {
  const fullPath = resolveRoot(libPath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const match = content.match(/declare_id!\("([A-Za-z0-9]+)"\)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Parse Anchor.toml and extract program IDs from a given section.
 * Returns a map of anchor_name -> program_id.
 *
 * Uses simple line-by-line parsing since Anchor.toml has a predictable format.
 */
function parseAnchorTomlSection(
  section: string
): Record<string, string> | null {
  const tomlPath = resolveRoot("Anchor.toml");
  if (!fs.existsSync(tomlPath)) return null;

  const content = fs.readFileSync(tomlPath, "utf-8");
  const lines = content.split("\n");

  const result: Record<string, string> = {};
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if we're entering the target section
    if (trimmed === `[${section}]`) {
      inSection = true;
      continue;
    }

    // If we hit another section header, stop
    if (inSection && trimmed.startsWith("[")) {
      break;
    }

    // Parse key = "value" lines within the section
    if (inSection) {
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*"([^"]+)"/);
      if (kvMatch) {
        result[kvMatch[1]] = kvMatch[2];
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract a cross-program ID reference from a Rust source file.
 *
 * Strategy: Find the function containing referenceName, then scan forward
 * for the pattern match within the next ~15 lines.
 */
function extractCrossRef(
  sourceFile: string,
  referenceName: string,
  pattern: RegExp
): string | null {
  const fullPath = resolveRoot(sourceFile);
  if (!fs.existsSync(fullPath)) return null;

  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");

    // For constant references (e.g., TAX_PROGRAM_ID), search the whole file
    const isConstant =
      !referenceName.endsWith("()") && referenceName === referenceName.toUpperCase();

    if (isConstant) {
      // Search for the constant definition line directly
      for (const line of lines) {
        if (line.includes(referenceName)) {
          const match = line.match(pattern);
          if (match) return match[1];
        }
      }
      return null;
    }

    // For function references, find the function and scan forward
    const funcName = referenceName.replace("()", "");
    let foundFunc = false;
    let scanLines = 0;

    for (const line of lines) {
      if (line.includes(`fn ${funcName}`)) {
        foundFunc = true;
        scanLines = 0;
        continue;
      }

      if (foundFunc) {
        scanLines++;
        const match = line.match(pattern);
        if (match) return match[1];
        // Stop scanning after 15 lines
        if (scanLines > 15) {
          foundFunc = false;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Scan all Rust files under programs/ for placeholder IDs.
 *
 * Placeholder patterns:
 * - Any pubkey that is all 1s after a prefix (e.g., EpochProgram1111111...)
 * - Known placeholder strings
 */
function scanPlaceholders(): PlaceholderResult[] {
  const results: PlaceholderResult[] = [];
  const programsDir = resolveRoot("programs");

  // Placeholder pattern: a word-like prefix followed by many 1s,
  // typical of placeholder pubkeys like "EpochProgram1111111111111111111111111111111"
  // Base58 pubkeys are 32-44 chars. Placeholder = prefix + enough 1s to fill.
  const placeholderPattern = /["(]([A-Za-z][A-Za-z0-9]*1{10,})[")]/;

  // Known Solana sysvar/system addresses that legitimately contain runs of 1s.
  // These are NOT placeholders -- they're real on-chain program addresses.
  const KNOWN_SYSVAR_PREFIXES = [
    "Sysvar",         // SysvarC1ock1111..., SysvarRent1111..., Sysvar1111...
    "11111111111",     // System program (all 1s)
  ];

  function isKnownSysvar(matched: string): boolean {
    return KNOWN_SYSVAR_PREFIXES.some((prefix) => matched.startsWith(prefix));
  }

  function scanDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip target directories
        if (entry.name === "target") continue;
        scanDir(fullPath);
      } else if (entry.name.endsWith(".rs")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comments-only lines
            if (line.trim().startsWith("//")) continue;

            const match = line.match(placeholderPattern);
            if (match && !isKnownSysvar(match[1])) {
              results.push({
                file: path.relative(ROOT, fullPath),
                line: i + 1,
                content: line.trim(),
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  scanDir(programsDir);
  return results;
}

// ---------------------------------------------------------------------------
// Main verification logic
// ---------------------------------------------------------------------------

function verify(): VerificationResult {
  const result: VerificationResult = {
    timestamp: new Date().toISOString(),
    programs: {},
    crossRefs: [],
    placeholders: [],
    summary: { total: 0, passed: 0, failed: 0 },
    success: true,
  };

  // Parse Anchor.toml sections once
  const anchorLocalnet = parseAnchorTomlSection("programs.localnet");
  const anchorDevnet = parseAnchorTomlSection("programs.devnet");

  // -----------------------------------------------------------------------
  // 1. Verify each program's ID consistency
  // -----------------------------------------------------------------------
  for (const [name, prog] of Object.entries(PROGRAMS)) {
    const progResult: ProgramResult = {
      keypairExists: false,
      keypairId: null,
      declareId: null,
      declareIdMatch: null,
      anchorLocalnet: null,
      anchorLocalnetMatch: null,
      anchorDevnet: null,
      anchorDevnetMatch: null,
      allMatch: true,
      errors: [],
    };

    // Step 1: Check keypair existence and derive pubkey
    const keypairId = deriveKeypairPubkey(prog.keypairPath);
    if (keypairId) {
      progResult.keypairExists = true;
      progResult.keypairId = keypairId;
    } else {
      progResult.keypairExists = false;
      progResult.errors.push(`Keypair missing: ${prog.keypairPath}`);
      progResult.allMatch = false;
      result.summary.total++;
      result.summary.failed++;
    }

    // Step 2: Extract declare_id!
    const declareId = extractDeclareId(prog.libPath);
    progResult.declareId = declareId;
    if (!declareId) {
      progResult.errors.push(`Could not extract declare_id! from ${prog.libPath}`);
      progResult.allMatch = false;
    }

    // Step 3: Check declare_id! vs keypair (or expectedDeclareId if set)
    if (keypairId && declareId) {
      // If expectedDeclareId is set, the program intentionally uses a different
      // declare_id! than its keypair (e.g., mock deployed at production address)
      const expectedId = prog.expectedDeclareId || keypairId;
      progResult.declareIdMatch = expectedId === declareId;
      result.summary.total++;
      if (progResult.declareIdMatch) {
        result.summary.passed++;
      } else {
        result.summary.failed++;
        progResult.allMatch = false;
        progResult.errors.push(
          `declare_id! mismatch: expected=${expectedId}, declare_id=${declareId}`
        );
      }
    } else if (!keypairId && declareId) {
      // No keypair to compare -- declare_id! exists but can't verify
      progResult.declareIdMatch = null;
    }

    // Step 4: Check Anchor.toml [programs.localnet]
    if (anchorLocalnet) {
      const anchorId = anchorLocalnet[prog.anchorName] || null;
      progResult.anchorLocalnet = anchorId;

      if (anchorId) {
        const sourceId = keypairId || declareId;
        if (sourceId) {
          progResult.anchorLocalnetMatch = sourceId === anchorId;
          result.summary.total++;
          if (progResult.anchorLocalnetMatch) {
            result.summary.passed++;
          } else {
            result.summary.failed++;
            progResult.allMatch = false;
            progResult.errors.push(
              `Anchor.toml localnet mismatch: expected=${sourceId}, got=${anchorId}`
            );
          }
        }
      } else {
        progResult.errors.push(
          `Missing from Anchor.toml [programs.localnet]: ${prog.anchorName}`
        );
        progResult.allMatch = false;
        result.summary.total++;
        result.summary.failed++;
      }
    }

    // Step 5: Check Anchor.toml [programs.devnet] (production programs only)
    if (prog.isProduction) {
      if (anchorDevnet) {
        const devnetId = anchorDevnet[prog.anchorName] || null;
        progResult.anchorDevnet = devnetId;

        if (devnetId) {
          const sourceId = keypairId || declareId;
          if (sourceId) {
            progResult.anchorDevnetMatch = sourceId === devnetId;
            result.summary.total++;
            if (progResult.anchorDevnetMatch) {
              result.summary.passed++;
            } else {
              result.summary.failed++;
              progResult.allMatch = false;
            }
          }
        } else {
          progResult.anchorDevnetMatch = null;
          progResult.errors.push(
            `Missing from Anchor.toml [programs.devnet]: ${prog.anchorName}`
          );
          result.summary.total++;
          result.summary.failed++;
        }
      } else {
        progResult.anchorDevnet = null;
        progResult.anchorDevnetMatch = null;
        // Not an error -- devnet section may not exist yet
      }
    }

    result.programs[name] = progResult;
  }

  // -----------------------------------------------------------------------
  // 2. Verify cross-program references
  // -----------------------------------------------------------------------
  for (const ref of CROSS_REFS) {
    const actualId = extractCrossRef(ref.sourceFile, ref.referenceName, ref.pattern);
    const expectedProg = result.programs[ref.expectedProgram];

    // Use keypair ID as source of truth; fall back to declare_id!
    const expectedId = expectedProg?.keypairId || expectedProg?.declareId || null;

    const crossResult: CrossRefResult = {
      source: ref.sourceFile,
      ref: ref.referenceName,
      expected: expectedId || "UNKNOWN",
      actual: actualId,
      match: false,
    };

    result.summary.total++;

    if (actualId && expectedId) {
      crossResult.match = actualId === expectedId;
      if (crossResult.match) {
        result.summary.passed++;
      } else {
        result.summary.failed++;
      }
    } else if (!actualId) {
      crossResult.actual = null;
      result.summary.failed++;
    } else {
      // No expected ID to compare against
      result.summary.failed++;
    }

    result.crossRefs.push(crossResult);
  }

  // -----------------------------------------------------------------------
  // 3. Placeholder scan
  // -----------------------------------------------------------------------
  result.placeholders = scanPlaceholders();
  if (result.placeholders.length > 0) {
    result.summary.total += result.placeholders.length;
    result.summary.failed += result.placeholders.length;
  }

  // -----------------------------------------------------------------------
  // Final summary
  // -----------------------------------------------------------------------
  result.success = result.summary.failed === 0;

  return result;
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function truncateId(id: string | null, len: number = 16): string {
  if (!id) return "N/A";
  if (id.length <= len) return id;
  return id.substring(0, len) + "...";
}

function padRight(str: string, len: number): string {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, len - stripped.length);
  return str + " ".repeat(pad);
}

function statusTag(pass: boolean | null, trueLabel = "MATCH", falseLabel = "MISMATCH"): string {
  if (pass === null) return `${YELLOW}N/A${RESET}`;
  return pass ? `${GREEN}${trueLabel}${RESET}` : `${RED}${falseLabel}${RESET}`;
}

function printHumanReadable(result: VerificationResult): void {
  console.log();
  console.log(
    `${BOLD}=== Dr. Fraudsworth Program ID Verification ===${RESET}`
  );
  console.log(`${DIM}Timestamp: ${result.timestamp}${RESET}`);
  console.log();

  // -----------------------------------------------------------------------
  // Keypair Consistency Table
  // -----------------------------------------------------------------------
  console.log(`${BOLD}KEYPAIR CONSISTENCY${RESET}`);
  console.log();

  const nameW = 18;
  const idW = 48;
  const colW = 14;

  // Header
  console.log(
    `${padRight("Program", nameW)} | ${padRight("Source ID", idW)} | ${padRight("declare_id!", colW)} | ${padRight("Anchor Local", colW)} | ${padRight("Anchor Dev", colW)} | Status`
  );
  console.log(
    `${"-".repeat(nameW)}-|-${"-".repeat(idW)}-|-${"-".repeat(colW)}-|-${"-".repeat(colW)}-|-${"-".repeat(colW)}-|-------`
  );

  for (const [name, prog] of Object.entries(result.programs)) {
    const sourceId = prog.keypairId || prog.declareId || "MISSING";
    const sourceLabel = prog.keypairExists
      ? sourceId
      : `${YELLOW}${sourceId}${RESET} ${DIM}(no keypair)${RESET}`;

    const declStatus = statusTag(prog.declareIdMatch);
    const localStatus = statusTag(prog.anchorLocalnetMatch);
    const devStatus = PROGRAMS[name].isProduction
      ? statusTag(prog.anchorDevnetMatch)
      : `${DIM}skip${RESET}`;

    const overall = prog.allMatch
      ? `${GREEN}PASS${RESET}`
      : `${RED}FAIL${RESET}`;

    console.log(
      `${padRight(name, nameW)} | ${padRight(sourceLabel, idW)} | ${padRight(declStatus, colW)} | ${padRight(localStatus, colW)} | ${padRight(devStatus, colW)} | ${overall}`
    );

    // Print errors indented below
    for (const err of prog.errors) {
      console.log(`${" ".repeat(nameW)}   ${RED}^ ${err}${RESET}`);
    }
  }

  console.log();

  // -----------------------------------------------------------------------
  // Cross-program References Table
  // -----------------------------------------------------------------------
  console.log(`${BOLD}CROSS-PROGRAM REFERENCES${RESET}`);
  console.log();

  const srcW = 40;
  const refW = 22;
  const expW = 20;
  const actW = 20;

  console.log(
    `${padRight("Source File", srcW)} | ${padRight("Reference", refW)} | ${padRight("Expected", expW)} | ${padRight("Actual", actW)} | Status`
  );
  console.log(
    `${"-".repeat(srcW)}-|-${"-".repeat(refW)}-|-${"-".repeat(expW)}-|-${"-".repeat(actW)}-|-------`
  );

  for (const cr of result.crossRefs) {
    const status = cr.match
      ? `${GREEN}PASS${RESET}`
      : `${RED}FAIL${RESET}`;

    console.log(
      `${padRight(cr.source, srcW)} | ${padRight(cr.ref, refW)} | ${padRight(truncateId(cr.expected, expW - 2), expW)} | ${padRight(truncateId(cr.actual, actW - 2), actW)} | ${status}`
    );
  }

  console.log();

  // -----------------------------------------------------------------------
  // Placeholder Scan
  // -----------------------------------------------------------------------
  console.log(`${BOLD}PLACEHOLDER SCAN${RESET}`);
  console.log();

  if (result.placeholders.length === 0) {
    console.log(`${GREEN}No placeholders found.${RESET}`);
  } else {
    for (const p of result.placeholders) {
      console.log(
        `${RED}ERROR${RESET} ${p.file}:${p.line} -- ${DIM}${p.content}${RESET}`
      );
    }
  }

  console.log();

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const summaryColor = result.success ? GREEN : RED;
  console.log(
    `${BOLD}SUMMARY:${RESET} ${summaryColor}${result.summary.passed}/${result.summary.total} checks passed${RESET}`
  );

  if (!result.success) {
    console.log(
      `${RED}${result.summary.failed} check(s) FAILED${RESET}`
    );
  }

  console.log();
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

function printJson(result: VerificationResult): void {
  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");

  const result = verify();

  if (jsonMode) {
    printJson(result);
  } else {
    printHumanReadable(result);
  }

  process.exit(result.success ? 0 : 1);
}

main();
