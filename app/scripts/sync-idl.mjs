/**
 * IDL Sync Script
 *
 * Copies Anchor IDL JSON files and TypeScript type definitions from the
 * build output (target/idl/ and target/types/) into app/idl/ so that the
 * Next.js app can import them as local modules.
 *
 * Only syncs the 6 production programs -- excludes test/mock programs
 * (fake_tax_program, mock_tax_program, stub_staking, epoch_program.json.bak).
 *
 * Hooked into npm lifecycle via "predev" and "prebuild" scripts in package.json,
 * so IDLs are always fresh before the dev server or production build starts.
 */

import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths relative to this script's location (app/scripts/)
const ROOT = join(__dirname, "..", "..");           // monorepo root
const IDL_SOURCE = join(ROOT, "target", "idl");    // Anchor build output
const TYPES_SOURCE = join(ROOT, "target", "types"); // Anchor-generated TS types
const IDL_DEST = join(__dirname, "..", "idl");      // app/idl/
const TYPES_DEST = join(IDL_DEST, "types");         // app/idl/types/

// Only production programs -- no mocks, stubs, or backups
const PROGRAMS = [
  "amm",
  "bonding_curve",
  "conversion_vault",
  "epoch_program",
  "staking",
  "tax_program",
  "transfer_hook",
];

// Check that source directory exists (requires `anchor build` to have run)
if (!existsSync(IDL_SOURCE)) {
  console.warn(
    "target/idl/ not found -- run 'anchor build' first"
  );
  process.exit(0); // Don't fail dev server for missing IDLs
}

// Create destination directories
mkdirSync(IDL_DEST, { recursive: true });
mkdirSync(TYPES_DEST, { recursive: true });

// Sync IDL JSON files
let synced = 0;
for (const name of PROGRAMS) {
  const srcJson = join(IDL_SOURCE, `${name}.json`);
  const destJson = join(IDL_DEST, `${name}.json`);

  if (!existsSync(srcJson)) {
    console.warn(`  WARN: ${name}.json not found in target/idl/ -- skipping`);
    continue;
  }

  cpSync(srcJson, destJson);
  console.log(`  Synced ${name}.json`);
  synced++;
}

// Sync TypeScript type files (optional -- skip missing with warning)
let typesSynced = 0;
if (existsSync(TYPES_SOURCE)) {
  for (const name of PROGRAMS) {
    const srcTs = join(TYPES_SOURCE, `${name}.ts`);
    const destTs = join(TYPES_DEST, `${name}.ts`);

    if (!existsSync(srcTs)) {
      console.warn(`  WARN: ${name}.ts not found in target/types/ -- skipping`);
      continue;
    }

    cpSync(srcTs, destTs);
    console.log(`  Synced types/${name}.ts`);
    typesSynced++;
  }
} else {
  console.warn("  WARN: target/types/ not found -- skipping type sync");
}

console.log(
  `\nIDL sync complete: ${synced} IDLs, ${typesSynced} type files`
);
