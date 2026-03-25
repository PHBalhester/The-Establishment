/**
 * Bonding Curve Math (Client-Side BigInt Port)
 *
 * Exact BigInt port of programs/bonding_curve/src/math.rs.
 * Uses identical variable names and formulas to the on-chain Rust code.
 *
 * Three core functions mirror the on-chain public API:
 * - calculateTokensOut: SOL -> tokens via quadratic formula
 * - calculateSolForTokens: tokens -> SOL via linear integral
 * - getCurrentPrice: price at a given tokens_sold position
 *
 * Plus helper:
 * - calculateSellTax: ceil-rounded 15% tax on gross SOL
 *
 * CRITICAL: All intermediates use BigInt. The quadratic formula intermediate
 * values reach ~2.5e36, far beyond Number.MAX_SAFE_INTEGER (~9e15).
 * Never convert to Number until final display formatting.
 *
 * Source: programs/bonding_curve/src/math.rs
 */

import {
  P_START,
  P_END,
  TOTAL_FOR_SALE,
  TOKEN_DECIMAL_FACTOR,
  PRECISION,
  SELL_TAX_BPS,
  BPS_DENOMINATOR,
} from "./curve-constants";

// ---------------------------------------------------------------------------
// BigInt Square Root (Newton's Method)
// ---------------------------------------------------------------------------

/**
 * Integer square root using Newton's method.
 * Returns floor(sqrt(n)).
 *
 * On-chain Rust uses u128::isqrt() (stdlib). JavaScript has no built-in
 * BigInt sqrt, so we implement Newton's method which converges in ~60
 * iterations for 128-bit values.
 */
export function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("bigintSqrt: negative input");
  if (n === 0n) return 0n;
  if (n < 4n) return 1n;

  // Initial guess: bit-length based approximation
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// ---------------------------------------------------------------------------
// calculateTokensOut: SOL -> Tokens (Quadratic Formula)
// ---------------------------------------------------------------------------

/**
 * Calculate tokens received (in base units) for a given SOL input.
 *
 * Mirrors on-chain calculate_tokens_out() exactly:
 *
 * For linear curve P(x) = a + (b_num/b_den)*x where:
 *   a = P_START (lamports per human token)
 *   b_num = P_END - P_START = 2550
 *   b_den = TOTAL_FOR_SALE = 460e12
 *
 * Quadratic solution (positive root):
 *   coef = a * b_den + b_num * x1
 *   discriminant = coef^2 + 2 * b_num * S * D * b_den
 *   dx = (sqrt(discriminant) - coef) / b_num
 *
 * Rounding: floor (protocol-favored -- user gets slightly fewer tokens).
 *
 * @param solLamports - SOL input in lamports (bigint)
 * @param currentSold - Tokens already sold in base units (bigint)
 * @returns Tokens out in base units (bigint)
 */
export function calculateTokensOut(
  solLamports: bigint,
  currentSold: bigint
): bigint {
  if (solLamports === 0n) return 0n;

  const a = P_START;
  const b_num = P_END - P_START; // 2550n
  const b_den = TOTAL_FOR_SALE;
  const x1 = currentSold;
  const s = solLamports;
  const d = TOKEN_DECIMAL_FACTOR;

  // Remaining supply check
  const remaining = b_den - x1;
  if (remaining <= 0n) return 0n;

  // Linear coefficient: a * b_den + b_num * x1
  const coef = a * b_den + b_num * x1;

  // Discriminant: coef^2 + 2 * b_num * S * D * b_den
  const coef_sq = coef * coef;
  const disc_rhs = 2n * b_num * s * d * b_den;
  const discriminant = coef_sq + disc_rhs;

  // Integer square root
  const sqrt_disc = bigintSqrt(discriminant);

  // dx = (sqrt_disc - coef) / b_num  (floor division, protocol-favored)
  const numerator = sqrt_disc - coef;
  const delta_x = numerator / b_num;

  // Cap at remaining supply
  return delta_x < remaining ? delta_x : remaining;
}

// ---------------------------------------------------------------------------
// calculateSolForTokens: Tokens -> SOL (Linear Integral)
// ---------------------------------------------------------------------------

/**
 * Calculate SOL cost (in lamports) for buying `tokens` base units starting
 * at `currentSold`.
 *
 * Mirrors on-chain calculate_sol_for_tokens() exactly, including
 * PRECISION scaling and remainder recovery for maximum precision.
 *
 * Formula:
 *   term1 = P_START * PRECISION * N
 *   term2 = (P_END - P_START) * [N * (2*x1 + N) / (2*TOTAL)] * PRECISION
 *   SOL = ceil((term1 + term2) / (PRECISION * TOKEN_DEC))
 *
 * For sell preview: pass currentSold = curve.tokensSold, tokens = amount to sell.
 * The gross SOL returned for selling N tokens from position currentSold is:
 * calculateSolForTokens(currentSold - N, N).
 *
 * Rounding: ceil (protocol-favored -- user pays slightly more SOL).
 *
 * @param currentSold - Position (tokens already sold) in base units
 * @param tokens - Number of tokens in base units
 * @returns SOL in lamports (bigint)
 */
export function calculateSolForTokens(
  currentSold: bigint,
  tokens: bigint
): bigint {
  if (tokens === 0n) return 0n;

  const a = P_START;
  const b_num = P_END - P_START; // 2550n
  const x1 = currentSold;
  const n = tokens;
  const two_total = 2n * TOTAL_FOR_SALE;

  // Term 1: P_START * PRECISION * N
  const term1 = a * PRECISION * n;

  // Term 2: b_num * [N * (2*x1 + N) / (2*TOTAL)] * PRECISION
  // With remainder recovery to minimize truncation error.
  const sum_x = 2n * x1 + n;
  const product = n * sum_x;

  // Split into quotient and remainder for precision recovery
  const quot = product / two_total;
  const rem = product % two_total;

  // term2 = b_num * quot * PRECISION + b_num * rem * PRECISION / two_total
  const term2_main = b_num * quot * PRECISION;
  const term2_rem = (b_num * rem * PRECISION) / two_total;
  const term2 = term2_main + term2_rem;

  // Total scaled value
  const total_scaled = term1 + term2;

  // Divide by (PRECISION * TOKEN_DECIMAL_FACTOR) with ceil rounding
  const denominator = PRECISION * TOKEN_DECIMAL_FACTOR;
  const sol_lamports = (total_scaled + denominator - 1n) / denominator;

  return sol_lamports;
}

// ---------------------------------------------------------------------------
// calculateSellTax: Ceil-Rounded 15% Tax
// ---------------------------------------------------------------------------

/**
 * Calculate the sell tax on gross SOL proceeds.
 *
 * Matches on-chain ceil-rounded BPS formula exactly:
 *   tax = ceil(sol_gross * 1500 / 10000)
 *      = (sol_gross * 1500 + 9999) / 10000
 *
 * Protocol-favored: ceil rounding means the protocol collects at least
 * the full 15% (never rounds down in the user's favor).
 *
 * @param solGross - Gross SOL proceeds in lamports
 * @returns Tax amount in lamports (bigint)
 */
export function calculateSellTax(solGross: bigint): bigint {
  return (solGross * SELL_TAX_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

// ---------------------------------------------------------------------------
// getCurrentPrice: Spot Price at Position
// ---------------------------------------------------------------------------

/**
 * Get current price at a given tokens_sold position.
 *
 * P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE
 *
 * Returns price in lamports per human token (same scale as P_START/P_END).
 * Uses PRECISION scaling to avoid truncation in the intermediate division.
 *
 * At x=0: returns P_START (900n). At x=TOTAL_FOR_SALE: returns P_END (3450n).
 *
 * @param tokensSold - Tokens already sold in base units
 * @returns Price in lamports per human token (bigint)
 */
export function getCurrentPrice(tokensSold: bigint): bigint {
  const price_range = P_END - P_START; // 2550n
  // Scale by PRECISION to avoid losing precision in the division
  const progress = (tokensSold * PRECISION) / TOTAL_FOR_SALE;
  const price = P_START + (price_range * progress) / PRECISION;
  return price;
}
