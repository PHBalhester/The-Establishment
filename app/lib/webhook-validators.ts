/**
 * Per-account-type bounds validators for decoded protocol account data.
 *
 * Validates decoded protocol account data against known bounds. Runs AFTER
 * anchorToJson normalization. Returns false if any field violates bounds
 * (caller should reject storage and fire Sentry alert).
 *
 * After anchorToJson() normalization:
 * - BN fields are converted to JavaScript `number` (or `{ __bigint: "..." }` for bigintFields)
 * - PublicKey fields are converted to base58 strings
 * - Field names are camelCase (Anchor 0.32's `convertIdlToCamelCase()`)
 *
 * Closes: H096 (bounds validation before storage)
 */

// =============================================================================
// Numeric Value Helper
// =============================================================================

/**
 * Extract a numeric value from a normalized account field.
 *
 * Handles both plain numbers (from BN.toNumber()) and bigint-tagged values
 * (from anchorToJson's bigintFields path: `{ __bigint: "12345" }`).
 *
 * Returns null for non-numeric fields (strings, objects, undefined) so the
 * caller can skip them without rejecting the account.
 */
function numericValue(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (
    typeof v === "object" &&
    v !== null &&
    "__bigint" in v &&
    typeof (v as Record<string, unknown>).__bigint === "string"
  ) {
    return Number((v as { __bigint: string }).__bigint);
  }
  return null;
}

// =============================================================================
// Per-Account-Type Validators
// =============================================================================

/**
 * EpochState: All BPS fields must be in [0, 10000].
 */
function validateEpochState(data: Record<string, unknown>): boolean {
  const bpsFields = [
    "crimeBuyTaxBps",
    "crimeSellTaxBps",
    "fraudBuyTaxBps",
    "fraudSellTaxBps",
    "lowTaxBps",
    "highTaxBps",
  ];
  for (const field of bpsFields) {
    if (!(field in data)) continue; // Skip missing fields (version flexibility)
    const val = numericValue(data[field]);
    if (val === null) continue; // Skip non-numeric (e.g., not yet decoded)
    if (val < 0 || val > 10_000) return false;
  }
  return true;
}

/**
 * PoolState: reserves >= 0, feeDenominator > 0.
 */
function validatePoolState(data: Record<string, unknown>): boolean {
  // Reserve checks: must be non-negative (can be zero during pool init)
  for (const field of ["reserveA", "reserveB"]) {
    if (!(field in data)) continue;
    const val = numericValue(data[field]);
    if (val === null) continue;
    if (val < 0) return false;
  }

  // Fee numerator: non-negative
  if ("feeNumerator" in data) {
    const val = numericValue(data.feeNumerator);
    if (val !== null && val < 0) return false;
  }

  // Fee denominator: must be positive (division by zero guard)
  if ("feeDenominator" in data) {
    const val = numericValue(data.feeDenominator);
    if (val !== null && val <= 0) return false;
  }

  return true;
}

/**
 * CarnageFundState: all present numeric fields >= 0.
 */
function validateCarnageFundState(data: Record<string, unknown>): boolean {
  for (const field of ["solBalance", "tokenBalance"]) {
    if (!(field in data)) continue;
    const val = numericValue(data[field]);
    if (val === null) continue;
    if (val < 0) return false;
  }
  return true;
}

/**
 * StakePool: totalStaked >= 0, rewardsPerTokenStored >= 0.
 * rewardsPerTokenStored may be a `{ __bigint }` tag (STAKING_BIGINT_FIELDS).
 */
function validateStakePool(data: Record<string, unknown>): boolean {
  for (const field of ["totalStaked", "rewardsPerTokenStored"]) {
    if (!(field in data)) continue;
    const val = numericValue(data[field]);
    if (val === null) continue;
    if (val < 0) return false;
  }
  return true;
}

/**
 * CurveState: currentPrice >= 0, tokensSold >= 0, solRaised >= 0.
 * tokensSold and solRaised may be `{ __bigint }` tags (CURVE_BIGINT_FIELDS).
 */
function validateCurveState(data: Record<string, unknown>): boolean {
  for (const field of ["currentPrice", "tokensSold", "solRaised"]) {
    if (!(field in data)) continue;
    const val = numericValue(data[field]);
    if (val === null) continue;
    if (val < 0) return false;
  }
  return true;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Validate a decoded and anchorToJson-normalized protocol account against
 * known field bounds.
 *
 * @param label - Account label from KNOWN_PROTOCOL_ACCOUNTS (e.g., "EpochState", "PoolState:CRIME_SOL")
 * @param normalized - The anchorToJson-normalized account data object
 * @returns true if all fields are within bounds, false if any field violates bounds
 */
export function validateDecodedAccount(
  label: string,
  normalized: Record<string, unknown>,
): boolean {
  if (label === "EpochState") return validateEpochState(normalized);
  if (label.startsWith("PoolState:")) return validatePoolState(normalized);
  if (label === "CarnageFundState") return validateCarnageFundState(normalized);
  if (label === "StakePool") return validateStakePool(normalized);
  if (label.startsWith("CurveState:")) return validateCurveState(normalized);

  // Unknown labels (e.g., "CarnageSolVault") -- don't reject
  return true;
}
