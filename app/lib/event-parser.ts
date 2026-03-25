/**
 * Anchor Event Parser for Tax Program and Epoch Program
 *
 * Parses Anchor `emit!()` events from raw transaction log messages.
 * Used by the Helius webhook handler to decode on-chain events.
 *
 * How it works:
 * 1. Each `emit!()` call produces a log line: `Program data: <base64-encoded-event>`
 * 2. The first 8 bytes are the event discriminator (sha256("event:EventName")[0..8])
 * 3. The remaining bytes are Borsh-serialized event fields
 * 4. Anchor's EventParser walks logMessages, identifies program invocations,
 *    and decodes events using the IDL layout
 *
 * Why we need this:
 * Helius enhanced webhooks do NOT parse custom Anchor program events (they
 * appear as "UNKNOWN"). We use raw webhooks and decode events ourselves.
 */

import { BorshCoder, EventParser, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import taxProgramIdl from "@/idl/tax_program.json";
import epochProgramIdl from "@/idl/epoch_program.json";

// Type-cast IDL JSON imports to Anchor Idl type
const taxIdl = taxProgramIdl as unknown as Idl;
const epochIdl = epochProgramIdl as unknown as Idl;

// Program IDs extracted from IDL address field (auto-synced during deployment)
const TAX_PROGRAM_ID = new PublicKey(taxProgramIdl.address);
const EPOCH_PROGRAM_ID = new PublicKey(epochProgramIdl.address);

// =============================================================================
// Parsed Event Interfaces
//
// These mirror the on-chain Rust event structs but with JS-native types.
// Anchor BN values are converted to number (safe for lamport amounts < 2^53).
// Anchor enum variants are converted to string labels.
// =============================================================================

/** Emitted by Tax Program on SOL pool swaps (taxed) */
export interface ParsedTaxedSwap {
  type: "TaxedSwap";
  user: string; // pubkey as base58
  poolType: string; // "solCrime" | "solFraud" | "crimeProfit" | "fraudProfit"
  direction: string; // "buy" | "sell"
  inputAmount: number; // lamports or base units
  outputAmount: number;
  taxAmount: number; // lamports of tax paid
  taxRateBps: number; // u16
  stakingPortion: number;
  carnagePortion: number;
  treasuryPortion: number;
  epoch: number; // u32
  slot: number; // u64
}

/**
 * DEAD CODE — UntaxedSwap events were emitted by PROFIT pool swaps via the
 * Tax Program. PROFIT pools have been replaced by the conversion vault (Phase 4 DBS).
 * Retained for historical event backfill/replay compatibility. Vault events
 * will be added in Phase 7.
 */
export interface ParsedUntaxedSwap {
  type: "UntaxedSwap";
  user: string;
  poolType: string;
  direction: string;
  inputAmount: number;
  outputAmount: number;
  lpFee: number;
  slot: number;
}

/** Emitted by Tax Program on Carnage swaps (exempt) */
export interface ParsedExemptSwap {
  type: "ExemptSwap";
  authority: string;
  pool: string;
  amountA: number;
  direction: number; // 0=buy, 1=sell
  slot: number;
}

/** Emitted by Epoch Program when epoch transition is triggered */
export interface ParsedEpochTransition {
  type: "EpochTransitionTriggered";
  epoch: number;
  triggeredBy: string;
  slot: number;
  bountyPaid: number;
}

/** Emitted by Epoch Program when taxes are updated after VRF consumption */
export interface ParsedTaxesUpdated {
  type: "TaxesUpdated";
  epoch: number;
  cheapSide: number; // 0=CRIME, 1=FRAUD
  lowTaxBps: number;
  highTaxBps: number;
  flipped: boolean;
}

/** Emitted by Epoch Program when Carnage executes */
export interface ParsedCarnageExecuted {
  type: "CarnageExecuted";
  epoch: number;
  action: number; // 0=None(BuyOnly), 1=Burn, 2=Sell
  target: number; // 0=CRIME, 1=FRAUD
  solSpent: number;
  tokensBought: number;
  tokensBurned: number;
  solFromSale: number;
  atomic: boolean;
}

export type ParsedSwapEvent =
  | ParsedTaxedSwap
  | ParsedUntaxedSwap
  | ParsedExemptSwap;
export type ParsedEpochEvent = ParsedEpochTransition | ParsedTaxesUpdated;
export type ParsedCarnageEvent = ParsedCarnageExecuted;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract Anchor enum variant name from deserialized data.
 *
 * Anchor BorshCoder deserializes Rust enums as objects with PascalCase keys:
 *   `{ SolCrime: {} }`, `{ Buy: {} }`
 *
 * We lowercase the first character to match our camelCase convention:
 *   `SolCrime` -> `solCrime`, `Buy` -> `buy`
 *
 * Also handles numeric representation (0/1) for fields like cheap_side
 * which can be either format.
 *
 * Known pattern: see MEMORY.md "Handle cheapSide as both numeric (0/1) and
 * object ({crime:{}}) enum."
 */
function enumVariant(value: unknown): string {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object" && value !== null) {
    const key = Object.keys(value)[0] ?? "unknown";
    // Lowercase first char: SolCrime -> solCrime, Buy -> buy
    return key.charAt(0).toLowerCase() + key.slice(1);
  }
  return String(value);
}

/**
 * Convert Anchor BN to JavaScript number.
 *
 * Anchor event data fields typed as u64 are deserialized as BN objects.
 * We convert to number which is safe for our use case (lamport amounts
 * under 2^53 = ~9 billion SOL, well above any realistic amount).
 */
function bnToNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  // Anchor BN objects have .toNumber() method
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

/**
 * Convert an Anchor-deserialized PublicKey to a base58 string.
 *
 * Anchor BorshCoder deserializes Pubkey fields as objects with a `_bn` property
 * (a BN instance holding the 32-byte key). We reconstruct the PublicKey from
 * the BN's byte array and call toBase58().
 *
 * Falls back to String() for any other format.
 */
function pubkeyToString(value: unknown): string {
  if (typeof value === "string") return value;
  // Anchor PublicKey: object with _bn property
  if (
    typeof value === "object" &&
    value !== null &&
    "_bn" in value
  ) {
    try {
      const bn = (value as { _bn: { toArrayLike: (type: unknown, endian: string, length: number) => Uint8Array } })._bn;
      const bytes = bn.toArrayLike(Buffer, "le", 32);
      return new PublicKey(bytes).toBase58();
    } catch {
      // Fallback: try constructing PublicKey directly
      try {
        return new PublicKey(value as { _bn: unknown }).toBase58();
      } catch {
        return String(value);
      }
    }
  }
  // Maybe already a PublicKey instance
  if (typeof value === "object" && value !== null && "toBase58" in value) {
    return (value as { toBase58: () => string }).toBase58();
  }
  return String(value);
}

// =============================================================================
// Parser Factories
//
// Create fresh EventParser instances for each call. EventParser is stateful
// (tracks program invocation depth), so reusing across calls could cause issues.
// =============================================================================

function createTaxParser(): EventParser {
  const coder = new BorshCoder(taxIdl);
  return new EventParser(TAX_PROGRAM_ID, coder);
}

function createEpochParser(): EventParser {
  const coder = new BorshCoder(epochIdl);
  return new EventParser(EPOCH_PROGRAM_ID, coder);
}

// =============================================================================
// Public Parse Functions
// =============================================================================

/**
 * Parse swap events (TaxedSwap, UntaxedSwap, ExemptSwap) from transaction logs.
 *
 * Uses the Tax Program's EventParser to decode base64 event data from
 * `Program data:` log lines.
 *
 * @param logMessages - Array of log strings from transaction meta
 * @returns Array of parsed swap events with JS-native types
 */
export function parseSwapEvents(logMessages: string[]): ParsedSwapEvent[] {
  const parser = createTaxParser();
  const events: ParsedSwapEvent[] = [];

  for (const event of parser.parseLogs(logMessages)) {
    const data = event.data as Record<string, unknown>;

    // NOTE: Anchor BorshCoder preserves the IDL field names (snake_case),
    // NOT camelCase. So we access data.pool_type, data.input_amount, etc.
    switch (event.name) {
      case "TaxedSwap":
        events.push({
          type: "TaxedSwap",
          user: pubkeyToString(data.user),
          poolType: enumVariant(data.pool_type),
          direction: enumVariant(data.direction),
          inputAmount: bnToNumber(data.input_amount),
          outputAmount: bnToNumber(data.output_amount),
          taxAmount: bnToNumber(data.tax_amount),
          taxRateBps: bnToNumber(data.tax_rate_bps),
          stakingPortion: bnToNumber(data.staking_portion),
          carnagePortion: bnToNumber(data.carnage_portion),
          treasuryPortion: bnToNumber(data.treasury_portion),
          epoch: bnToNumber(data.epoch),
          slot: bnToNumber(data.slot),
        });
        break;

      // DEAD CODE — UntaxedSwap events no longer emitted (PROFIT pools removed).
      // Retained for historical event replay. See ParsedUntaxedSwap comment.
      case "UntaxedSwap":
        events.push({
          type: "UntaxedSwap",
          user: pubkeyToString(data.user),
          poolType: enumVariant(data.pool_type),
          direction: enumVariant(data.direction),
          inputAmount: bnToNumber(data.input_amount),
          outputAmount: bnToNumber(data.output_amount),
          lpFee: bnToNumber(data.lp_fee),
          slot: bnToNumber(data.slot),
        });
        break;

      case "ExemptSwap":
        events.push({
          type: "ExemptSwap",
          authority: pubkeyToString(data.authority),
          pool: pubkeyToString(data.pool),
          amountA: bnToNumber(data.amount_a),
          direction: bnToNumber(data.direction),
          slot: bnToNumber(data.slot),
        });
        break;
    }
  }

  return events;
}

/**
 * Parse epoch events (EpochTransitionTriggered, TaxesUpdated) from transaction logs.
 *
 * Uses the Epoch Program's EventParser. Both events are emitted during the
 * consume_randomness instruction.
 *
 * @param logMessages - Array of log strings from transaction meta
 * @returns Array of parsed epoch events with JS-native types
 */
export function parseEpochEvents(logMessages: string[]): ParsedEpochEvent[] {
  const parser = createEpochParser();
  const events: ParsedEpochEvent[] = [];

  for (const event of parser.parseLogs(logMessages)) {
    const data = event.data as Record<string, unknown>;

    // NOTE: Anchor BorshCoder preserves the IDL field names (snake_case)
    switch (event.name) {
      case "EpochTransitionTriggered":
        events.push({
          type: "EpochTransitionTriggered",
          epoch: bnToNumber(data.epoch),
          triggeredBy: pubkeyToString(data.triggered_by),
          slot: bnToNumber(data.slot),
          bountyPaid: bnToNumber(data.bounty_paid),
        });
        break;

      case "TaxesUpdated":
        events.push({
          type: "TaxesUpdated",
          epoch: bnToNumber(data.epoch),
          cheapSide: bnToNumber(data.cheap_side),
          lowTaxBps: bnToNumber(data.low_tax_bps),
          highTaxBps: bnToNumber(data.high_tax_bps),
          flipped: Boolean(data.flipped),
        });
        break;
    }
  }

  return events;
}

/**
 * Parse Carnage events (CarnageExecuted) from transaction logs.
 *
 * Carnage events are emitted by the Epoch Program during execute_carnage_atomic
 * or execute_carnage (fallback) instructions.
 *
 * @param logMessages - Array of log strings from transaction meta
 * @returns Array of parsed Carnage events with JS-native types
 */
export function parseCarnageEvents(
  logMessages: string[],
): ParsedCarnageEvent[] {
  const parser = createEpochParser();
  const events: ParsedCarnageEvent[] = [];

  for (const event of parser.parseLogs(logMessages)) {
    const data = event.data as Record<string, unknown>;

    // NOTE: Anchor BorshCoder preserves the IDL field names (snake_case)
    if (event.name === "CarnageExecuted") {
      events.push({
        type: "CarnageExecuted",
        epoch: bnToNumber(data.epoch),
        action: bnToNumber(data.action),
        target: bnToNumber(data.target),
        solSpent: bnToNumber(data.sol_spent),
        tokensBought: bnToNumber(data.tokens_bought),
        tokensBurned: bnToNumber(data.tokens_burned),
        solFromSale: bnToNumber(data.sol_from_sale),
        atomic: Boolean(data.atomic),
      });
    }
  }

  return events;
}
