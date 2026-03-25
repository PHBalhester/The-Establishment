/**
 * Mock VRF & Epoch State Manipulation Helpers
 *
 * Provides utilities to trigger Carnage execution in local integration tests
 * WITHOUT requiring a real Switchboard VRF oracle.
 *
 * Strategy: Since consume_randomness (which sets carnage_pending = true) requires
 * a real Switchboard oracle that doesn't exist on the local test validator, we
 * manipulate the EpochState account binary directly via the validator's
 * `--account` override mechanism.
 *
 * Two-phase test approach:
 *   Phase 1: Start validator, run protocol init + smoke tests, dump EpochState binary
 *   Phase 2: Restart validator with modified EpochState (carnage_pending = true),
 *            run Carnage-specific tests
 *
 * Source: .planning/phases/32-cpi-chain-validation/32-02-PLAN.md
 */

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { EPOCH_STATE_SEED, CARNAGE_SIGNER_SEED } from "./constants";

// =============================================================================
// EpochState Binary Layout (Anchor-serialized)
//
// Anchor adds an 8-byte discriminator prefix. All fields are packed
// sequentially with NO alignment padding (Borsh serialization).
//
// Source: programs/epoch-program/src/state/epoch_state.rs
// =============================================================================

/** Byte offsets within EpochState account data (including 8-byte discriminator) */
export const EPOCH_STATE_OFFSETS = {
  DISCRIMINATOR: 0,        // 8 bytes
  GENESIS_SLOT: 8,         // u64 (8 bytes)
  CURRENT_EPOCH: 16,       // u32 (4 bytes)
  EPOCH_START_SLOT: 20,    // u64 (8 bytes)
  CHEAP_SIDE: 28,          // u8 (1 byte)
  LOW_TAX_BPS: 29,         // u16 (2 bytes)
  HIGH_TAX_BPS: 31,        // u16 (2 bytes)
  CRIME_BUY_TAX_BPS: 33,  // u16 (2 bytes)
  CRIME_SELL_TAX_BPS: 35,  // u16 (2 bytes)
  FRAUD_BUY_TAX_BPS: 37,  // u16 (2 bytes)
  FRAUD_SELL_TAX_BPS: 39,  // u16 (2 bytes)
  VRF_REQUEST_SLOT: 41,    // u64 (8 bytes)
  VRF_PENDING: 49,         // bool (1 byte)
  TAXES_CONFIRMED: 50,     // bool (1 byte)
  PENDING_RANDOMNESS: 51,  // Pubkey (32 bytes)
  CARNAGE_PENDING: 83,     // bool (1 byte)  <-- KEY FIELD
  CARNAGE_TARGET: 84,      // u8 (1 byte)    <-- 0=CRIME, 1=FRAUD
  CARNAGE_ACTION: 85,      // u8 (1 byte)    <-- 0=None, 1=Burn, 2=Sell
  CARNAGE_DEADLINE: 86,    // u64 (8 bytes)
  CARNAGE_LOCK_SLOT: 94,   // u64 (8 bytes) -- Phase 47
  LAST_CARNAGE_EPOCH: 102, // u32 (4 bytes)
  RESERVED: 106,           // [u8; 64] (64 bytes) -- Phase 80 padding
  INITIALIZED: 170,        // bool (1 byte)
  BUMP: 171,               // u8 (1 byte)
} as const;

/** EpochState data size without discriminator: 164 bytes */
export const EPOCH_STATE_DATA_SIZE = 164;

/** Total EpochState account data size: 8-byte discriminator + 164 bytes data */
export const EPOCH_STATE_TOTAL_SIZE = 172;

// =============================================================================
// EpochState Dump & Modification
// =============================================================================

/**
 * Read the raw EpochState account data from the running validator.
 *
 * Returns the full binary data (172 bytes) as a Buffer.
 * This is the basis for modification and re-injection via --account override.
 *
 * @param connection - RPC connection to the running validator
 * @param epochProgramId - The Epoch Program's public key
 * @returns Buffer containing the raw account data, or null if account doesn't exist
 */
export async function dumpEpochState(
  connection: Connection,
  epochProgramId: PublicKey,
): Promise<{ data: Buffer; address: PublicKey; lamports: number; owner: PublicKey } | null> {
  const [epochStatePDA] = PublicKey.findProgramAddressSync(
    [EPOCH_STATE_SEED],
    epochProgramId,
  );

  const accountInfo = await connection.getAccountInfo(epochStatePDA);
  if (!accountInfo) return null;

  return {
    data: Buffer.from(accountInfo.data),
    address: epochStatePDA,
    lamports: accountInfo.lamports,
    owner: accountInfo.owner,
  };
}

/**
 * Modify EpochState binary data to set Carnage as pending.
 *
 * Mutates the buffer in-place, setting:
 * - carnage_pending = true (byte 83)
 * - carnage_target = target (byte 84): 0 = CRIME, 1 = FRAUD
 * - carnage_action = action (byte 85): 0 = None (BuyOnly), 1 = Burn, 2 = Sell
 * - carnage_deadline_slot = large value (bytes 86-93) so it doesn't expire
 * - vrf_pending = false (byte 49) so trigger_epoch_transition isn't blocked
 * - taxes_confirmed = true (byte 50) so swaps work with current rates
 *
 * @param data - EpochState account data buffer (mutated in place)
 * @param target - Carnage target: 0 = CRIME, 1 = FRAUD
 * @param action - Carnage action: 0 = None/BuyOnly, 1 = Burn, 2 = Sell
 * @param deadlineSlot - Deadline slot (defaults to very large value)
 * @returns The same buffer (mutated)
 */
export function setCarnagePending(
  data: Buffer,
  target: number = 0,  // CRIME
  action: number = 0,  // None/BuyOnly
  deadlineSlot: bigint = BigInt(99_999_999),
): Buffer {
  // Validate data length
  if (data.length !== EPOCH_STATE_TOTAL_SIZE) {
    throw new Error(
      `EpochState data must be ${EPOCH_STATE_TOTAL_SIZE} bytes, got ${data.length}`
    );
  }

  // Set carnage_pending = true
  data.writeUInt8(1, EPOCH_STATE_OFFSETS.CARNAGE_PENDING);

  // Set carnage_target (0 = CRIME, 1 = FRAUD)
  data.writeUInt8(target, EPOCH_STATE_OFFSETS.CARNAGE_TARGET);

  // Set carnage_action (0 = None/BuyOnly, 1 = Burn, 2 = Sell)
  data.writeUInt8(action, EPOCH_STATE_OFFSETS.CARNAGE_ACTION);

  // Set carnage_deadline_slot to a large value so it doesn't expire
  data.writeBigUInt64LE(deadlineSlot, EPOCH_STATE_OFFSETS.CARNAGE_DEADLINE);

  // Ensure vrf_pending = false (so system isn't waiting for VRF)
  data.writeUInt8(0, EPOCH_STATE_OFFSETS.VRF_PENDING);

  // Ensure taxes_confirmed = true (so swaps work with current rates)
  data.writeUInt8(1, EPOCH_STATE_OFFSETS.TAXES_CONFIRMED);

  return data;
}

/**
 * Convert account data to the JSON format expected by
 * `solana-test-validator --account <address> <file.json>`.
 *
 * The format is:
 * {
 *   "pubkey": "<base58>",
 *   "account": {
 *     "lamports": <number>,
 *     "data": ["<base64>", "base64"],
 *     "owner": "<base58>",
 *     "executable": false,
 *     "rentEpoch": 18446744073709551615,
 *     "space": <number>
 *   }
 * }
 *
 * @param address - Account public key
 * @param data - Raw account data buffer
 * @param owner - Account owner program
 * @param lamports - Account lamport balance
 * @returns JSON string ready to write to file
 */
export function accountToJson(
  address: PublicKey,
  data: Buffer,
  owner: PublicKey,
  lamports: number,
): string {
  return JSON.stringify({
    pubkey: address.toBase58(),
    account: {
      lamports,
      data: [data.toString("base64"), "base64"],
      owner: owner.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  }, null, 2);
}

/**
 * Parse key fields from raw EpochState data for diagnostics.
 *
 * Useful for logging/debugging what state the validator is running with.
 *
 * @param data - Raw EpochState account data (172 bytes)
 * @returns Object with parsed field values
 */
export function parseEpochState(data: Buffer): {
  genesisSlot: bigint;
  currentEpoch: number;
  epochStartSlot: bigint;
  cheapSide: number;
  lowTaxBps: number;
  highTaxBps: number;
  vrfPending: boolean;
  taxesConfirmed: boolean;
  carnagePending: boolean;
  carnageTarget: number;
  carnageAction: number;
  carnageDeadlineSlot: bigint;
  carnageLockSlot: bigint;
  lastCarnageEpoch: number;
  initialized: boolean;
  bump: number;
} {
  return {
    genesisSlot: data.readBigUInt64LE(EPOCH_STATE_OFFSETS.GENESIS_SLOT),
    currentEpoch: data.readUInt32LE(EPOCH_STATE_OFFSETS.CURRENT_EPOCH),
    epochStartSlot: data.readBigUInt64LE(EPOCH_STATE_OFFSETS.EPOCH_START_SLOT),
    cheapSide: data.readUInt8(EPOCH_STATE_OFFSETS.CHEAP_SIDE),
    lowTaxBps: data.readUInt16LE(EPOCH_STATE_OFFSETS.LOW_TAX_BPS),
    highTaxBps: data.readUInt16LE(EPOCH_STATE_OFFSETS.HIGH_TAX_BPS),
    vrfPending: data.readUInt8(EPOCH_STATE_OFFSETS.VRF_PENDING) !== 0,
    taxesConfirmed: data.readUInt8(EPOCH_STATE_OFFSETS.TAXES_CONFIRMED) !== 0,
    carnagePending: data.readUInt8(EPOCH_STATE_OFFSETS.CARNAGE_PENDING) !== 0,
    carnageTarget: data.readUInt8(EPOCH_STATE_OFFSETS.CARNAGE_TARGET),
    carnageAction: data.readUInt8(EPOCH_STATE_OFFSETS.CARNAGE_ACTION),
    carnageDeadlineSlot: data.readBigUInt64LE(EPOCH_STATE_OFFSETS.CARNAGE_DEADLINE),
    carnageLockSlot: data.readBigUInt64LE(EPOCH_STATE_OFFSETS.CARNAGE_LOCK_SLOT),
    lastCarnageEpoch: data.readUInt32LE(EPOCH_STATE_OFFSETS.LAST_CARNAGE_EPOCH),
    initialized: data.readUInt8(EPOCH_STATE_OFFSETS.INITIALIZED) !== 0,
    bump: data.readUInt8(EPOCH_STATE_OFFSETS.BUMP),
  };
}

// =============================================================================
// Carnage WSOL Account Creation
// =============================================================================

/**
 * Derive the Carnage signer PDA.
 *
 * This PDA signs Tax::swap_exempt calls. The WSOL account for Carnage
 * must be owned by this PDA (token account authority) so the PDA can
 * authorize token transfers during swap_exempt.
 *
 * @param epochProgramId - Epoch Program public key
 * @returns [publicKey, bump]
 */
export function deriveCarnageSignerPDA(
  epochProgramId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CARNAGE_SIGNER_SEED],
    epochProgramId,
  );
}

// =============================================================================
// VRF Byte Encoding Constants
// =============================================================================

/**
 * VRF bytes encoding reference for Carnage.
 *
 * These document the byte->behavior mapping used by consume_randomness:
 * - value[0]: flip byte (< 192 = flip cheap side)
 * - value[1]: low magnitude (100 + (byte % 4) * 100 = 100-400 bps)
 * - value[2]: high magnitude (1100 + (byte % 4) * 100 = 1100-1400 bps)
 * - value[3]: Carnage trigger (< 11 = trigger, >= 11 = no trigger)
 * - value[4]: Carnage action (< 5 = Sell if holdings, >= 5 = Burn if holdings)
 * - value[5]: Carnage target (< 128 = CRIME, >= 128 = FRAUD)
 */
export const VRF_BYTES = {
  CARNAGE_TRIGGER_THRESHOLD: 11,
  CARNAGE_SELL_THRESHOLD: 5,
  CARNAGE_TARGET_THRESHOLD: 128,
} as const;

/**
 * Carnage target token enum values (matching on-chain Token enum).
 */
export const CarnageTarget = {
  CRIME: 0,
  FRAUD: 1,
} as const;

/**
 * Carnage action enum values (matching on-chain CarnageAction enum).
 */
export const CarnageAction = {
  NONE: 0,   // BuyOnly (no existing holdings)
  BURN: 1,   // Burn existing, then buy new
  SELL: 2,   // Sell existing to SOL, then buy new
} as const;
