/**
 * Prepare Modified EpochState for Carnage Tests
 *
 * This script connects to a running test validator, reads the EpochState
 * account (initialized by protocol-init), modifies it to set
 * carnage_pending = true, and writes the modified account to a JSON file.
 *
 * The JSON file is then used by solana-test-validator's --account flag
 * when the validator restarts for Phase 2 (Carnage tests).
 *
 * Usage: npx ts-node --esm scripts/prepare-carnage-state.ts
 *
 * Output: .anchor/carnage-epoch-state.json
 *
 * Source: .planning/phases/32-cpi-chain-validation/32-02-PLAN.md
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __pcs_dirname = dirname(fileURLToPath(import.meta.url));

// We import from the integration test helpers using relative paths
// since this script runs from the project root
const EPOCH_STATE_SEED = Buffer.from("epoch_state");

// EpochState byte offsets (matching mock-vrf.ts EPOCH_STATE_OFFSETS)
// Total account size: 172 bytes (8 discriminator + 164 data)
const OFFSETS = {
  VRF_PENDING: 49,
  TAXES_CONFIRMED: 50,
  CARNAGE_PENDING: 83,
  CARNAGE_TARGET: 84,
  CARNAGE_ACTION: 85,
  CARNAGE_DEADLINE: 86,
  CARNAGE_LOCK_SLOT: 94,  // Phase 47: u64 (8 bytes)
} as const;

// Epoch Program ID loaded from IDL (auto-synced during deployment)
const epochIdl = JSON.parse(readFileSync(join(__pcs_dirname, "..", "app", "idl", "epoch_program.json"), "utf-8"));
const EPOCH_PROGRAM_ID = new PublicKey(epochIdl.address);

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");

  // Derive EpochState PDA
  const [epochStatePDA] = PublicKey.findProgramAddressSync(
    [EPOCH_STATE_SEED],
    EPOCH_PROGRAM_ID,
  );

  console.log(`Reading EpochState from ${epochStatePDA.toBase58()}...`);

  const accountInfo = await connection.getAccountInfo(epochStatePDA);
  if (!accountInfo) {
    console.error("ERROR: EpochState account not found. Is protocol initialized?");
    process.exit(1);
  }

  console.log(`  Account size: ${accountInfo.data.length} bytes`);
  console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
  console.log(`  Lamports: ${accountInfo.lamports}`);

  // Modify the binary data
  const data = Buffer.from(accountInfo.data);

  // Set carnage_pending = true
  data.writeUInt8(1, OFFSETS.CARNAGE_PENDING);

  // Set carnage_target = 0 (CRIME)
  data.writeUInt8(0, OFFSETS.CARNAGE_TARGET);

  // Set carnage_action = 0 (None/BuyOnly -- no existing holdings)
  data.writeUInt8(0, OFFSETS.CARNAGE_ACTION);

  // Set carnage_deadline_slot to a very large value
  data.writeBigUInt64LE(BigInt(99_999_999), OFFSETS.CARNAGE_DEADLINE);

  // Ensure vrf_pending = false
  data.writeUInt8(0, OFFSETS.VRF_PENDING);

  // Ensure taxes_confirmed = true
  data.writeUInt8(1, OFFSETS.TAXES_CONFIRMED);

  // Write to JSON in the format expected by --account flag.
  // NOTE: rentEpoch must be a valid u64. JavaScript can't represent u64::MAX
  // (18446744073709551615) as a number without loss of precision. Using 0
  // is safe because the test validator doesn't enforce rent on preloaded accounts.
  const json = JSON.stringify({
    pubkey: epochStatePDA.toBase58(),
    account: {
      lamports: accountInfo.lamports,
      data: [data.toString("base64"), "base64"],
      owner: accountInfo.owner.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  }, null, 2);

  const fs = await import("fs");
  const outputPath = ".anchor/carnage-epoch-state.json";
  fs.writeFileSync(outputPath, json);

  console.log(`\nModified EpochState written to ${outputPath}`);
  console.log("  carnage_pending = true");
  console.log("  carnage_target = 0 (CRIME)");
  console.log("  carnage_action = 0 (BuyOnly)");
  console.log("  carnage_deadline_slot = 99999999");
  console.log("  vrf_pending = false");
  console.log("  taxes_confirmed = true");
}

main().catch((err) => {
  console.error("Failed to prepare carnage state:", err);
  process.exit(1);
});
