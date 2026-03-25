/**
 * BigInt-safe JSON Serialization
 *
 * JSON.stringify() throws on BigInt values, and converting to Number first
 * silently loses precision for values > 2^53. This module provides a
 * replacer/reviver pair that round-trips BigInt values through a tagged
 * object format: { __bigint: "12345" }.
 *
 * Used by protocol-store (server-side serialization) and useProtocolState
 * (client-side deserialization) to safely transmit u64/u128 Solana account
 * fields over SSE.
 */

// =============================================================================
// Internal Type Guard
// =============================================================================

function isBigIntTag(v: unknown): v is { __bigint: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "__bigint" in v &&
    typeof (v as Record<string, unknown>).__bigint === "string"
  );
}

// =============================================================================
// Public API
// =============================================================================

/**
 * JSON.stringify replacer that encodes BigInt values as { __bigint: "value" }.
 * Non-BigInt values pass through unchanged.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return { __bigint: String(value) };
  }
  return value;
}

/**
 * JSON.parse reviver that decodes { __bigint: "value" } back to BigInt.
 * Non-tagged values pass through unchanged.
 */
export function bigintReviver(_key: string, value: unknown): unknown {
  if (isBigIntTag(value)) {
    return BigInt(value.__bigint);
  }
  return value;
}

// =============================================================================
// Anchor Object Normalization
// =============================================================================

/** Options for anchorToJson conversion */
interface AnchorToJsonOptions {
  /** BN fields that should serialize as { __bigint: "..." } instead of .toNumber() */
  bigintFields?: string[];
}

/** CurveState u64 fields that can exceed Number.MAX_SAFE_INTEGER for a 1B-supply 9-decimal token */
export const CURVE_BIGINT_FIELDS = [
  "tokensSold",
  "solRaised",
  "tokensReturned",
  "solReturned",
  "taxCollected",
];

/** StakePool u128 field that grows monotonically and WILL exceed 2^53 */
export const STAKING_BIGINT_FIELDS = ["rewardsPerTokenStored"];

/**
 * Convert an Anchor-decoded account object to a JSON-safe plain object.
 *
 * Anchor's coder.accounts.decode() returns objects with BN instances (for
 * u64/u128 fields) and PublicKey instances (for Pubkey fields). These types
 * don't survive JSON.stringify correctly:
 *   - BN.toJSON() returns hex strings ("0x2540be400")
 *   - PublicKey serializes as {"_bn": "..."}
 *
 * This function performs a shallow conversion:
 *   - BN → number (via .toNumber()) — safe for values within 2^53
 *   - BN → { __bigint: "..." } tag if field is listed in bigintFields
 *   - PublicKey → base58 string (via .toBase58())
 *   - Everything else passes through unchanged
 *
 * Uses duck-typing ("toNumber" in val, "toBase58" in val) to avoid importing
 * @coral-xyz/anchor or @solana/web3.js, keeping this module dependency-free.
 */
export function anchorToJson(
  decoded: Record<string, unknown>,
  options?: AnchorToJsonOptions,
): Record<string, unknown> {
  const bigintSet = options?.bigintFields
    ? new Set(options.bigintFields)
    : null;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(decoded)) {
    if (val && typeof val === "object" && "toNumber" in val) {
      if (bigintSet?.has(key)) {
        // BigInt-safe path: serialize as tagged string
        result[key] = { __bigint: (val as { toString(): string }).toString() };
      } else {
        result[key] = (val as { toNumber(): number }).toNumber();
      }
    } else if (val && typeof val === "object" && "toBase58" in val) {
      result[key] = (val as { toBase58(): string }).toBase58();
    } else {
      result[key] = val;
    }
  }
  return result;
}
