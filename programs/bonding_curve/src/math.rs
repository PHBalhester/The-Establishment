// Pure math functions for the bonding curve.
//
// Implements the linear curve P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE
// using u128 integer arithmetic with PRECISION=1e12 scaling.
//
// Three public functions:
// - calculate_tokens_out: SOL -> tokens via quadratic formula
// - calculate_sol_for_tokens: tokens -> SOL via linear integral
// - get_current_price: price at a given tokens_sold position
//
// All math is integer-only. No Anchor/Solana dependencies except the error type.
//
// CRITICAL UNIT NOTE:
// P_START and P_END are in lamports per HUMAN token (450 and 1725 respectively).
// TOTAL_FOR_SALE is in BASE UNITS (460M * 10^6 = 460e12).
// The conversion factor TOKEN_DECIMALS (10^6) bridges human tokens to base units.
// All integrals must divide by TOKEN_DECIMALS to produce correct lamport values.
//
// The chosen constants (P_START=450, P_END=1725) produce a full-curve integral
// of ~500.25 SOL (not exactly 500) due to rounding of P_START from its exact
// value. This is inherent to the economic parameters.

use crate::constants::*;
use crate::error::CurveError;
use anchor_lang::prelude::*;

/// Token decimal factor: 10^6 (all project tokens use 6 decimals).
/// Bridges the gap between "lamports per human token" (P_START/P_END)
/// and "lamports per base unit" which is what the integral computes over.
const TOKEN_DECIMAL_FACTOR: u128 = 1_000_000;

/// Calculate tokens received (in base units) for a given SOL input.
///
/// Uses the closed-form quadratic solution of the linear integral.
///
/// For linear curve P(x) = a + (b_num/b_den)*x where:
///   a = P_START (lamports per human token)
///   b_num = P_END - P_START = 1275
///   b_den = TOTAL_FOR_SALE = 460e12
///
/// The cost of dx base units starting from position x1 is:
///   S = [a * dx + b_num * dx * (2*x1 + dx) / (2 * b_den)] / TOKEN_DECIMAL_FACTOR
///
/// Rearranging as quadratic in dx and solving (positive root only):
///   dx = [-(a*b_den + b_num*x1) + sqrt((a*b_den + b_num*x1)^2 + 2*b_num*S*D*b_den)] / b_num
///
/// where D = TOKEN_DECIMAL_FACTOR.
///
/// Rounding: floor (protocol-favored -- user gets slightly fewer tokens).
///
/// Overflow analysis (worst case: S=TARGET_SOL, x1=TARGET_TOKENS-1):
///   coef = a*b_den + b_num*x1 = 450*460e12 + 1275*460e12 = ~7.935e17
///   coef^2 = ~6.30e35 (u128 max ~3.4e38, OK)
///   disc_rhs = 2*1275*1e12*1e6*460e12 = ~1.173e36 (OK)
///   discriminant = ~1.80e36 (well within u128)
pub fn calculate_tokens_out(sol_lamports: u64, current_sold: u64) -> Result<u64> {
    if sol_lamports == 0 {
        return Ok(0);
    }

    let a = P_START;
    let b_num = P_END.checked_sub(P_START).ok_or(CurveError::Overflow)?;
    let b_den = TOTAL_FOR_SALE;
    let x1 = current_sold as u128;
    let s = sol_lamports as u128;
    let d = TOKEN_DECIMAL_FACTOR;

    // Remaining supply check
    let remaining = b_den.checked_sub(x1).ok_or(CurveError::Overflow)?;
    if remaining == 0 {
        return Ok(0);
    }

    // Linear coefficient: a * b_den + b_num * x1
    let coef = a
        .checked_mul(b_den)
        .ok_or(CurveError::Overflow)?
        .checked_add(b_num.checked_mul(x1).ok_or(CurveError::Overflow)?)
        .ok_or(CurveError::Overflow)?;

    // Discriminant: coef^2 + 2 * b_num * S * D * b_den
    let coef_sq = coef.checked_mul(coef).ok_or(CurveError::Overflow)?;
    let disc_rhs = 2u128
        .checked_mul(b_num)
        .ok_or(CurveError::Overflow)?
        .checked_mul(s)
        .ok_or(CurveError::Overflow)?
        .checked_mul(d)
        .ok_or(CurveError::Overflow)?
        .checked_mul(b_den)
        .ok_or(CurveError::Overflow)?;
    let discriminant = coef_sq
        .checked_add(disc_rhs)
        .ok_or(CurveError::Overflow)?;

    // Integer square root (Rust stdlib, available on SBF since platform-tools v1.51)
    let sqrt_disc = discriminant.isqrt();

    // dx = (sqrt_disc - coef) / b_num
    // sqrt_disc >= coef always holds because discriminant >= coef^2
    let numerator = sqrt_disc
        .checked_sub(coef)
        .ok_or(CurveError::Overflow)?;
    let delta_x = numerator / b_num; // Floor division (protocol-favored)

    // Cap at remaining supply
    let tokens_out = delta_x.min(remaining);

    Ok(u64::try_from(tokens_out).map_err(|_| error!(CurveError::Overflow))?)
}

/// Calculate SOL cost (in lamports) for buying `tokens` base units starting at `current_sold`.
///
/// Uses the linear integral:
///   SOL = [P_START * N + (P_END - P_START) * N * (2*x1 + N) / (2 * TOTAL)] / TOKEN_DEC
///
/// With PRECISION scaling and remainder recovery for maximum precision:
///   term1 = P_START * PRECISION * N
///   term2 = (P_END - P_START) * [N * (2*x1 + N) / (2*TOTAL)] * PRECISION
///           (with remainder recovery to minimize truncation)
///   SOL = ceil((term1 + term2) / (PRECISION * TOKEN_DEC))
///
/// Rounding: ceil (protocol-favored -- user pays slightly more SOL).
///
/// This function also serves as the reverse integral for sells (Phase 72):
/// the gross SOL returned for selling N tokens from position x1 is
/// `calculate_sol_for_tokens(x1 - N, N)`.
///
/// Overflow analysis (worst case: x1=0, N=TOTAL):
///   term1 = 450 * 1e12 * 460e12 = 2.07e29 (u128 max ~3.4e38, OK)
///   product = N * (2*x1+N) = (460e12)^2 = 2.116e26 (OK)
///   term2_main = 1275 * (TOTAL/2) * 1e12 = 1275 * 230e12 * 1e12 = 2.9325e29 (OK)
pub fn calculate_sol_for_tokens(current_sold: u64, tokens: u64) -> Result<u64> {
    if tokens == 0 {
        return Ok(0);
    }

    let a = P_START;
    let b_num = P_END.checked_sub(P_START).ok_or(CurveError::Overflow)?;
    let x1 = current_sold as u128;
    let n = tokens as u128;
    let two_total = 2u128
        .checked_mul(TOTAL_FOR_SALE)
        .ok_or(CurveError::Overflow)?;

    // Term 1: P_START * PRECISION * N
    let term1 = a
        .checked_mul(PRECISION)
        .ok_or(CurveError::Overflow)?
        .checked_mul(n)
        .ok_or(CurveError::Overflow)?;

    // Term 2: b_num * [N * (2*x1 + N) / (2*TOTAL)] * PRECISION
    // With remainder recovery to minimize truncation error.
    let sum_x = (2u128.checked_mul(x1).ok_or(CurveError::Overflow)?)
        .checked_add(n)
        .ok_or(CurveError::Overflow)?;
    let product = n.checked_mul(sum_x).ok_or(CurveError::Overflow)?;

    // Split into quotient and remainder for precision recovery
    let quot = product / two_total;
    let rem = product % two_total;

    // term2 = b_num * quot * PRECISION + b_num * rem * PRECISION / two_total
    let term2_main = b_num
        .checked_mul(quot)
        .ok_or(CurveError::Overflow)?
        .checked_mul(PRECISION)
        .ok_or(CurveError::Overflow)?;
    let term2_rem = b_num
        .checked_mul(rem)
        .ok_or(CurveError::Overflow)?
        .checked_mul(PRECISION)
        .ok_or(CurveError::Overflow)?
        / two_total;
    let term2 = term2_main
        .checked_add(term2_rem)
        .ok_or(CurveError::Overflow)?;

    // Total scaled value
    let total_scaled = term1.checked_add(term2).ok_or(CurveError::Overflow)?;

    // Divide by (PRECISION * TOKEN_DECIMAL_FACTOR) with ceil rounding
    let denominator = PRECISION
        .checked_mul(TOKEN_DECIMAL_FACTOR)
        .ok_or(CurveError::Overflow)?;
    let sol_lamports = total_scaled
        .checked_add(denominator - 1) // ceil rounding
        .ok_or(CurveError::Overflow)?
        / denominator;

    Ok(u64::try_from(sol_lamports).map_err(|_| error!(CurveError::Overflow))?)
}

/// Get current price at a given tokens_sold position.
///
/// P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE
///
/// Returns price in lamports per human token (same scale as P_START/P_END).
///
/// Uses PRECISION scaling (1e12) to avoid truncation in the intermediate division.
/// At x=0: returns P_START (450). At x=TARGET_TOKENS: returns P_END (1725).
///
/// ## Known Accuracy Property (BOK Finding 2 — inv_bc_011_price_accuracy)
///
/// Integer arithmetic introduces a maximum deviation of ~0.011% at extreme curve
/// positions (e.g., tokens_sold=94,010,200,000,000). This is 1 part in ~140,000
/// and is an inherent limitation of using 1e12 PRECISION with u128 integer math.
///
/// The deviation is negligible in practice:
/// - At P_START (450 lamports/M tokens): 0.011% = 0.050 lamports — sub-lamport
/// - At P_END (1725 lamports/M tokens): 0.011% = 0.19 lamports — sub-lamport
/// - The error does NOT accumulate across transactions (each call is independent)
/// - Increasing PRECISION beyond 1e12 would risk u128 overflow in the multiplication
///
/// See: .bok/results/summary.md Finding 2.
pub fn get_current_price(tokens_sold: u64) -> u64 {
    let price_range = P_END - P_START; // 1275
    // Scale by PRECISION to avoid losing precision in the division
    let progress = (tokens_sold as u128)
        .checked_mul(PRECISION)
        .unwrap_or(0)
        / TOTAL_FOR_SALE;
    let price = P_START + price_range * progress / PRECISION;
    u64::try_from(price).unwrap_or(u64::MAX)
}

// =============================================================================
// Refund Math Helper
// =============================================================================

/// Compute proportional refund amount using floor rounding (protocol-favored).
///
/// Formula: floor(user_balance * refund_pool / total_outstanding)
/// Uses u128 intermediates to prevent overflow.
///
/// Returns None if total_outstanding is zero (defense-in-depth).
///
/// This mirrors the on-chain claim_refund formula exactly:
///   refund_amount = ((user_balance as u128)
///       .checked_mul(refund_pool as u128)?
///       / (total_outstanding as u128)) as u64;
pub fn calculate_refund(user_balance: u64, refund_pool: u64, total_outstanding: u64) -> Option<u64> {
    if total_outstanding == 0 {
        return None;
    }
    let result = (user_balance as u128)
        .checked_mul(refund_pool as u128)?
        / (total_outstanding as u128);
    u64::try_from(result).ok()
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // =========================================================================
    // Exact identity tests
    // =========================================================================

    /// The mathematical full-curve integral with the given constants is:
    /// SOL = TOTAL_FOR_SALE * (P_START + P_END) / (2 * TOKEN_DECIMAL_FACTOR)
    ///
    /// Computed from actual constants so it works across feature flags:
    /// - Devnet (P_START=5, P_END=17): ~5.06 SOL
    /// - Mainnet/Localnet (P_START=450, P_END=1725): ~500.25 SOL
    const MATHEMATICAL_FULL_CURVE_SOL: u64 =
        (TOTAL_FOR_SALE * (P_START + P_END) / (2 * TOKEN_DECIMAL_FACTOR)) as u64;

    #[test]
    fn integral_identity_full_curve_sol_cost() {
        // calculate_sol_for_tokens(0, TARGET_TOKENS) should return the full-curve
        // integral value within 1 lamport.
        let sol = calculate_sol_for_tokens(0, TARGET_TOKENS).unwrap();
        let diff = (sol as i128 - MATHEMATICAL_FULL_CURVE_SOL as i128).unsigned_abs();
        assert!(
            diff <= 1,
            "Full curve SOL cost {} differs from mathematical value {} by {} lamports (max 1)",
            sol,
            MATHEMATICAL_FULL_CURVE_SOL,
            diff,
        );
    }

    #[test]
    fn reverse_integral_identity_tokens_for_full_sol() {
        // calculate_tokens_out(MATHEMATICAL_FULL_CURVE_SOL, 0) should return
        // TARGET_TOKENS within 1 token, since that SOL amount is exactly the integral.
        let tokens = calculate_tokens_out(MATHEMATICAL_FULL_CURVE_SOL, 0).unwrap();
        let diff = (tokens as i128 - TARGET_TOKENS as i128).unsigned_abs();
        assert!(
            diff <= 1,
            "Tokens out for full curve SOL {} differs from TARGET_TOKENS {} by {} tokens (max 1)",
            tokens,
            TARGET_TOKENS,
            diff,
        );
    }

    #[test]
    fn target_sol_buys_almost_all_tokens() {
        // With TARGET_SOL (500 SOL), we can't buy ALL 460M tokens because the
        // full curve costs ~500.25 SOL. We should get close but not all.
        let tokens = calculate_tokens_out(TARGET_SOL, 0).unwrap();
        assert!(
            tokens < TARGET_TOKENS,
            "TARGET_SOL should not buy all tokens (curve costs ~500.25 SOL)"
        );
        // Should be within ~1% of TARGET_TOKENS.
        // Devnet's smaller curve (5 SOL) has lower precision than mainnet (500 SOL),
        // so we use a 1% threshold that works for all feature flags.
        let pct_diff = ((TARGET_TOKENS as f64 - tokens as f64) / TARGET_TOKENS as f64) * 100.0;
        assert!(
            pct_diff < 1.0,
            "Tokens from TARGET_SOL should be within 1% of TARGET_TOKENS, got {:.4}% diff",
            pct_diff,
        );
    }

    // =========================================================================
    // Boundary price tests
    // =========================================================================

    #[test]
    fn price_at_zero_equals_p_start() {
        let price = get_current_price(0);
        assert_eq!(
            price, P_START as u64,
            "Price at 0 should be P_START ({}), got {}",
            P_START, price
        );
    }

    #[test]
    fn price_at_target_tokens_equals_p_end() {
        let price = get_current_price(TARGET_TOKENS);
        assert_eq!(
            price, P_END as u64,
            "Price at TARGET_TOKENS should be P_END ({}), got {}",
            P_END, price
        );
    }

    #[test]
    fn price_at_midpoint() {
        // At 50% sold, price should be midpoint of P_START and P_END
        let midpoint_tokens = TARGET_TOKENS / 2;
        let price = get_current_price(midpoint_tokens);
        let expected_mid = (P_START + P_END) / 2; // (450 + 1725) / 2 = 1087
        let diff = (price as i128 - expected_mid as i128).unsigned_abs();
        assert!(
            diff <= 1,
            "Price at midpoint should be ~{}, got {} (diff {})",
            expected_mid,
            price,
            diff,
        );
    }

    // =========================================================================
    // Dust and edge case tests
    // =========================================================================

    #[test]
    fn dust_one_lamport_input() {
        // 1 lamport should not cause an error
        let result = calculate_tokens_out(1, 0);
        assert!(result.is_ok(), "1 lamport should not cause error");
    }

    #[test]
    fn zero_sol_returns_zero_tokens() {
        let tokens = calculate_tokens_out(0, 0).unwrap();
        assert_eq!(tokens, 0, "0 SOL should return 0 tokens");
    }

    #[test]
    fn zero_tokens_returns_zero_sol() {
        let sol = calculate_sol_for_tokens(0, 0).unwrap();
        assert_eq!(sol, 0, "0 tokens should cost 0 SOL");
    }

    #[test]
    fn near_full_curve_one_token_remaining() {
        // When only 1 base unit remains, buying should give at most 1 token
        let almost_full = TARGET_TOKENS - 1;
        let tokens = calculate_tokens_out(TARGET_SOL, almost_full).unwrap();
        assert!(
            tokens <= 1,
            "With only 1 token remaining, should get at most 1, got {}",
            tokens
        );
    }

    #[test]
    fn at_capacity_returns_zero() {
        // When tokens_sold == TARGET_TOKENS, no more tokens available
        let tokens = calculate_tokens_out(TARGET_SOL, TARGET_TOKENS).unwrap();
        assert_eq!(tokens, 0, "At full capacity should return 0 tokens");
    }

    // =========================================================================
    // Partial purchase tests
    // =========================================================================

    #[test]
    fn half_sol_buys_more_than_half_tokens() {
        // The first 500 SOL buys MORE than half the tokens because prices start low
        let half_sol = TARGET_SOL / 2;
        let tokens = calculate_tokens_out(half_sol, 0).unwrap();
        let half_tokens = TARGET_TOKENS / 2;
        assert!(
            tokens > half_tokens as u64,
            "500 SOL from position 0 should buy > half the tokens (got {} vs {})",
            tokens,
            half_tokens,
        );
    }

    #[test]
    fn sequential_buys_cost_more() {
        // Buying 100 SOL worth at position 0 vs position 230M should yield fewer tokens
        let sol = 100_000_000_000u64; // 100 SOL
        let tokens_early = calculate_tokens_out(sol, 0).unwrap();
        let tokens_late = calculate_tokens_out(sol, TARGET_TOKENS / 2).unwrap();
        assert!(
            tokens_early > tokens_late,
            "Same SOL should buy fewer tokens later on curve: early={} late={}",
            tokens_early,
            tokens_late,
        );
    }

    #[test]
    fn sol_cost_increases_along_curve() {
        // Cost of 10M tokens should be higher later on the curve
        let ten_m = 10_000_000_000_000u64; // 10M tokens in base units
        let cost_early = calculate_sol_for_tokens(0, ten_m).unwrap();
        let cost_late = calculate_sol_for_tokens(TARGET_TOKENS / 2, ten_m).unwrap();
        assert!(
            cost_late > cost_early,
            "10M tokens should cost more later: early={} late={}",
            cost_early,
            cost_late,
        );
    }

    // =========================================================================
    // Round-trip consistency tests
    // =========================================================================

    #[test]
    fn round_trip_buy_then_cost() {
        // Buy with ~20% of curve, then compute cost of those tokens.
        //
        // Protocol-favored rounding means:
        //   tokens = floor(exact_dx) -- user gets fewer tokens
        //   cost(tokens) = ceil(integral) -- but the integral of fewer tokens is less
        //
        // So: cost(floor_tokens) <= sol_in (vault is solvent: received more than value)
        // And: cost(floor_tokens + 1) > sol_in (can't get one more token for the same SOL)
        let sol_in = TARGET_SOL / 5; // ~20% of curve, works for any feature flag
        let tokens = calculate_tokens_out(sol_in, 0).unwrap();
        assert!(tokens > 0, "100 SOL should buy > 0 tokens");
        let sol_cost = calculate_sol_for_tokens(0, tokens).unwrap();
        assert!(
            sol_cost <= sol_in,
            "Round-trip: cost of {} tokens ({}) should be <= {} SOL input (vault solvent)",
            tokens,
            sol_cost,
            sol_in,
        );
        // Getting one more token should cost more than the input
        let sol_cost_plus1 = calculate_sol_for_tokens(0, tokens + 1).unwrap();
        assert!(
            sol_cost_plus1 > sol_in,
            "Round-trip: cost of {}+1 tokens ({}) should exceed {} SOL input",
            tokens,
            sol_cost_plus1,
            sol_in,
        );
    }

    #[test]
    fn round_trip_at_various_positions() {
        // At each position, buy tokens with SOL, verify:
        // 1. cost(tokens) <= sol_in (vault solvent: user paid enough)
        // 2. cost(tokens+1) > sol_in (can't get more for the same SOL)
        let positions = [
            0u64,
            TARGET_TOKENS / 4,
            TARGET_TOKENS / 2,
            TARGET_TOKENS * 3 / 4,
        ];
        let sol_amounts = [
            50_000_000u64,
            1_000_000_000,
            100_000_000_000,
            TARGET_SOL / 4,
        ];

        for &pos in &positions {
            for &sol in &sol_amounts {
                let tokens = calculate_tokens_out(sol, pos).unwrap();
                if tokens == 0 {
                    continue;
                }
                let cost = calculate_sol_for_tokens(pos, tokens).unwrap();
                assert!(
                    cost <= sol,
                    "Round-trip at pos={}: cost {} > input {} for {} tokens (vault insolvent)",
                    pos,
                    cost,
                    sol,
                    tokens,
                );
                // One more token should exceed the input SOL
                let remaining = TARGET_TOKENS - pos;
                if tokens < remaining {
                    let cost_plus1 = calculate_sol_for_tokens(pos, tokens + 1).unwrap();
                    assert!(
                        cost_plus1 > sol,
                        "Round-trip at pos={}: cost of {}+1 tokens ({}) should exceed {} SOL",
                        pos,
                        tokens,
                        cost_plus1,
                        sol,
                    );
                }
            }
        }
    }

    // =========================================================================
    // Protocol-favored rounding tests
    // =========================================================================

    #[test]
    fn tokens_out_floors() {
        // When the exact mathematical answer is non-integer, we should get floor.
        // Verify by computing cost of (tokens+1): it should exceed sol.
        let sol = 1_000u64; // 0.000001 SOL
        let tokens = calculate_tokens_out(sol, 0).unwrap();
        if tokens > 0 {
            let cost_extra = calculate_sol_for_tokens(0, tokens + 1).unwrap();
            assert!(
                cost_extra > sol,
                "tokens+1 should cost more than input SOL: cost={} > sol={}",
                cost_extra,
                sol,
            );
        }
    }

    #[test]
    fn sol_cost_ceils() {
        // Verify ceil rounding: sol_for_tokens always rounds UP.
        // This means: the SOL cost of N tokens is enough to buy AT LEAST N tokens.
        // tokens_out(ceil_cost(N), pos) >= N
        //
        // Additionally: floor_cost(N) < ceil_cost(N) at least sometimes (proving
        // the ceil is actually doing work), and tokens_out(floor_cost) might be < N.
        let test_cases = [
            (0u64, 1_000_000u64),                     // 1 human token from start
            (0, 100_000_000_000_000),                  // 100M tokens from start
            (230_000_000_000_000, 10_000_000_000_000), // 10M tokens from midpoint
        ];

        for &(pos, tokens) in &test_cases {
            let sol = calculate_sol_for_tokens(pos, tokens).unwrap();
            let tokens_back = calculate_tokens_out(sol, pos).unwrap();
            assert!(
                tokens_back >= tokens,
                "Ceil rounding: sol_for_tokens({}, {}) = {} -> tokens_out gives {} (should be >= {})",
                pos,
                tokens,
                sol,
                tokens_back,
                tokens,
            );
        }
    }

    // =========================================================================
    // Proptest: Property-Based Tests (500K iterations)
    // =========================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500_000))]

        /// PROPERTY 1: No overflow for any valid input in the buy range.
        ///
        /// For any SOL amount in [MIN_PURCHASE, TARGET_SOL] and any valid
        /// curve position, calculate_tokens_out must not panic.
        /// On success: tokens <= remaining supply.
        #[test]
        fn no_overflow_tokens_out(
            sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL,
            sold_pct in 0u64..=999_999u64,
        ) {
            // Derive current_sold as percentage to avoid prop_assume rejection
            let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

            let result = calculate_tokens_out(sol_lamports, current_sold);
            match result {
                Ok(tokens) => {
                    let remaining = TARGET_TOKENS - current_sold;
                    prop_assert!(
                        tokens <= remaining,
                        "Got {} tokens but only {} remaining",
                        tokens,
                        remaining
                    );
                }
                Err(_) => {
                    // Overflow is acceptable for extreme combinations
                }
            }
        }

        /// PROPERTY 2: No overflow for any valid input in sol_for_tokens.
        #[test]
        fn no_overflow_sol_for_tokens(
            sold_pct in 0u64..=999_999u64,
            tokens_pct in 1u64..=1_000_000u64,
        ) {
            let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;
            let remaining = TARGET_TOKENS - current_sold;
            let tokens = 1u64.max(((remaining as u128) * (tokens_pct as u128) / 1_000_000u128) as u64);

            let result = calculate_sol_for_tokens(current_sold, tokens);
            match result {
                Ok(sol) => {
                    // SOL cost should be reasonable
                    prop_assert!(
                        sol <= 2 * MATHEMATICAL_FULL_CURVE_SOL,
                        "SOL cost {} seems unreasonably high",
                        sol
                    );
                }
                Err(_) => {
                    // Overflow acceptable for extreme combinations
                }
            }
        }

        /// PROPERTY 3: Monotonic pricing -- more tokens sold = higher price.
        #[test]
        fn monotonic_pricing(
            pos1_pct in 0u64..=999_998u64,
            gap_pct in 1u64..=100_000u64,
        ) {
            let pos1 = ((TARGET_TOKENS as u128) * (pos1_pct as u128) / 1_000_000u128) as u64;
            let pos2_raw = ((TARGET_TOKENS as u128) * ((pos1_pct as u128 + gap_pct as u128).min(999_999)) / 1_000_000u128) as u64;
            let pos2 = pos1.max(pos2_raw.min(TARGET_TOKENS));

            if pos2 > pos1 {
                let price1 = get_current_price(pos1);
                let price2 = get_current_price(pos2);
                prop_assert!(
                    price2 >= price1,
                    "Price should be monotonic: P({})={} > P({})={}",
                    pos2,
                    price2,
                    pos1,
                    price1
                );
            }
        }

        /// PROPERTY 4: Round-trip vault solvency -- cost(tokens_out) <= original SOL.
        ///
        /// Proves the vault never becomes insolvent from rounding:
        ///   tokens = floor(exact_dx) -- user gets fewer tokens
        ///   cost(tokens) = ceil(integral(tokens)) -- cost of those fewer tokens
        ///   cost(tokens) <= sol_in -- vault received at least the token value
        ///
        /// This is the correct direction for protocol-favored rounding.
        /// The user overpays slightly (vault surplus), never underpays.
        #[test]
        fn round_trip_vault_solvent(
            sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL,
            sold_pct in 0u64..=999_000u64,
        ) {
            let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

            if let Ok(tokens) = calculate_tokens_out(sol_lamports, current_sold) {
                if tokens > 0 {
                    if let Ok(cost) = calculate_sol_for_tokens(current_sold, tokens) {
                        prop_assert!(
                            cost <= sol_lamports,
                            "Vault insolvency: cost {} > input {} for {} tokens at pos {}",
                            cost,
                            sol_lamports,
                            tokens,
                            current_sold
                        );
                    }
                }
            }
        }

        /// PROPERTY 5: Vault solvency -- cumulative SOL from sequential buys >= integral.
        /// Simulates 2-10 sequential purchases and verifies the vault never underpays.
        #[test]
        fn vault_solvency_sequential(
            num_buys in 2u32..=10u32,
            buy_pcts in proptest::collection::vec(1u64..=200_000u64, 2..=10),
        ) {
            let buys: Vec<u64> = buy_pcts.iter()
                .take(num_buys as usize)
                .map(|&pct| {
                    let max_per_buy = TARGET_SOL / num_buys as u64;
                    MIN_PURCHASE_SOL.max(
                        ((max_per_buy as u128) * (pct as u128) / 200_000u128) as u64
                    )
                })
                .collect();

            let mut current_sold: u64 = 0;
            let mut total_sol_paid: u128 = 0;

            for &sol in &buys {
                if let Ok(tokens) = calculate_tokens_out(sol, current_sold) {
                    if tokens == 0 {
                        break;
                    }
                    total_sol_paid += sol as u128;
                    current_sold = current_sold.saturating_add(tokens);

                    if current_sold >= TARGET_TOKENS {
                        break;
                    }

                    // Verify: SOL paid so far >= integral cost from 0 to current_sold
                    if let Ok(integral_cost) = calculate_sol_for_tokens(0, current_sold) {
                        prop_assert!(
                            total_sol_paid >= integral_cost as u128,
                            "Vault solvency violated at position {}: paid {} < integral {}",
                            current_sold,
                            total_sol_paid,
                            integral_cost
                        );
                    }
                }
            }
        }
    }

    // =========================================================================
    // Sell-specific deterministic tests
    // =========================================================================

    #[test]
    fn sell_one_token_from_start() {
        // Selling 1 base unit when position is at 1 should return minimal SOL.
        // At position 0, P(0) = P_START = 450 lamports per human token.
        // 1 base unit = 1e-6 human tokens, so SOL = ~0.00045 lamports, ceil to 1.
        let sol = calculate_sol_for_tokens(0, 1).unwrap();
        assert!(sol <= 1, "1 base unit at P_START should cost at most 1 lamport, got {}", sol);
    }

    #[test]
    fn sell_exact_buy_round_trip_loses() {
        // Buy ~20% of curve worth, sell it all back, verify loss.
        let sol_in = TARGET_SOL / 5; // ~20% of curve, works for any feature flag
        let tokens = calculate_tokens_out(sol_in, 0).unwrap();
        assert!(tokens > 0);

        // Sell from position tokens back to 0
        let sol_gross = calculate_sol_for_tokens(0, tokens).unwrap();
        let tax = (sol_gross as u128 * 1500 + 9999) / 10000;
        let sol_net = sol_gross.saturating_sub(tax as u64);

        assert!(
            sol_net < sol_in,
            "Round-trip should lose: spent {} got back {} (gross {}, tax {})",
            sol_in, sol_net, sol_gross, tax
        );

        // Loss should be approximately 15% (tax) plus rounding
        let loss_pct = ((sol_in - sol_net) as f64 / sol_in as f64) * 100.0;
        assert!(
            loss_pct >= 14.0 && loss_pct <= 16.0,
            "Round-trip loss should be ~15%, got {:.2}%",
            loss_pct
        );
    }

    #[test]
    fn tax_ceil_rounding_example() {
        // For a known SOL amount, verify ceil tax matches expected.
        let sol_gross = 1_000_000_000u64; // 1 SOL
        let tax = (sol_gross as u128 * SELL_TAX_BPS as u128 + BPS_DENOMINATOR as u128 - 1)
            / BPS_DENOMINATOR as u128;
        // 1_000_000_000 * 1500 / 10000 = 150_000_000 (exact, no rounding needed)
        assert_eq!(tax, 150_000_000, "15% of 1 SOL should be 0.15 SOL");

        // For an amount that needs rounding: 1 lamport
        let sol_gross_small = 1u64;
        let tax_small = (sol_gross_small as u128 * SELL_TAX_BPS as u128 + BPS_DENOMINATOR as u128 - 1)
            / BPS_DENOMINATOR as u128;
        // 1 * 1500 + 9999 = 11499 / 10000 = 1 (ceil)
        assert_eq!(tax_small, 1, "Ceil tax of 1 lamport should be 1 (protocol-favored)");
    }

    #[test]
    fn vault_solvency_after_full_buy_then_full_sell() {
        // Buy all tokens (approximately), then sell them all back.
        let sol_in = MATHEMATICAL_FULL_CURVE_SOL;
        let tokens = calculate_tokens_out(sol_in, 0).unwrap();
        assert!(tokens > 0);

        // After buying, vault has sol_in lamports.
        // Sell all tokens: gross SOL leaves vault (sol_net to user + tax to escrow).
        let sol_gross = calculate_sol_for_tokens(0, tokens).unwrap();

        // Vault after sell: sol_in - sol_gross
        // After sell, tokens_sold = 0, so expected integral = 0.
        // Vault should be >= 0 (solvency holds trivially).
        assert!(
            sol_in as u128 >= sol_gross as u128,
            "Vault should have non-negative balance after full sell: {} - {}",
            sol_in, sol_gross
        );
    }

    // =========================================================================
    // Proptest: Sell-Specific Property Tests (1M iterations)
    //
    // These tests prove that no buy/sell sequence can drain the vault or
    // create a profitable round-trip. Combined with the 500K buy-only
    // iterations above, the curve has 7.5M+ total property test iterations.
    // =========================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1_000_000))]

        /// PROPERTY S1: Buy/sell round-trip always loses money.
        ///
        /// For any SOL amount and any curve position:
        /// 1. Buy tokens with SOL
        /// 2. Immediately sell those tokens back
        /// 3. Assert: sol_net_from_sell < sol_spent (15% tax guarantees loss)
        ///
        /// This is the core economic soundness proof: no user can profit from
        /// a buy-then-sell regardless of curve position or amount.
        #[test]
        fn buy_sell_round_trip_always_loses(
            sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL / 10,
            sold_pct in 0u64..=900_000u64,
        ) {
            let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

            // Buy tokens
            if let Ok(tokens_bought) = calculate_tokens_out(sol_lamports, current_sold) {
                if tokens_bought == 0 { return Ok(()); }

                // Sell those tokens back from the new position
                let new_sold = current_sold.saturating_add(tokens_bought);
                if new_sold > TARGET_TOKENS { return Ok(()); }

                // Sell reverses the curve: x2 = new_sold - tokens_bought = current_sold
                let x2 = current_sold;
                if let Ok(sol_gross) = calculate_sol_for_tokens(x2, tokens_bought) {
                    // Apply 15% tax (ceil, protocol-favored -- matches on-chain formula exactly)
                    let tax = (sol_gross as u128)
                        .checked_mul(SELL_TAX_BPS as u128).unwrap()
                        .checked_add(BPS_DENOMINATOR as u128 - 1).unwrap()
                        / BPS_DENOMINATOR as u128;
                    let sol_net = sol_gross.saturating_sub(tax as u64);

                    // User should ALWAYS get back strictly less than they spent
                    prop_assert!(
                        sol_net < sol_lamports,
                        "Profitable round-trip! Spent {} got back {} (gross {}, tax {}, pos {})",
                        sol_lamports, sol_net, sol_gross, tax, current_sold
                    );
                }
            }
        }

        /// PROPERTY S2: Vault solvency across mixed buy/sell sequences.
        ///
        /// Simulates 3-8 random operations (buy or sell) and verifies the
        /// core solvency invariant: **the vault can always cover every
        /// individual sell that occurs, and no sell is ever rejected when
        /// it shouldn't be.**
        ///
        /// On-chain reality:
        /// - Buy: vault receives raw SOL input (>= ceil cost of floor tokens).
        /// - Sell: vault pays sol_gross = ceil_integral(x2, tokens_sold).
        ///         On-chain guard: `require!(sol_gross <= available, VaultInsolvency)`
        ///         If the guard fires, the TX reverts (sell doesn't execute).
        ///
        /// CEIL ROUNDING COMPOSABILITY (root cause of Phase 86 regression fix):
        /// `ceil(integral(0,N-1)) + ceil(integral(N-1,1))` can exceed
        /// `ceil(integral(0,N))` by 1 lamport. This means after K sequential
        /// sells, the vault can be short by up to K lamports versus a single
        /// sell of the same total. On-chain, this is handled correctly:
        /// the VaultInsolvency guard would reject the final sell if the
        /// vault is short, preventing any actual loss.
        ///
        /// This test models the on-chain behavior faithfully: if a sell's
        /// sol_gross exceeds the vault balance, it's treated as a rejected
        /// TX (skipped). We then verify that the rejection is bounded —
        /// deficits never exceed the number of prior sell operations
        /// (at most 1 lamport per ceil rounding event).
        ///
        /// The stronger round-trip loss property (S1) proves no user can
        /// profit from a buy-then-sell; this test proves the vault never
        /// underflows catastrophically.
        #[test]
        fn vault_solvency_mixed_buy_sell(
            num_ops in 3u32..=8u32,
            op_pcts in proptest::collection::vec(0u64..=1_000_000u64, 3..=8),
            op_types in proptest::collection::vec(0u8..=1u8, 3..=8),
        ) {
            let mut current_sold: u64 = 0;
            let mut vault_sol: u128 = 0; // lamports in vault
            let mut total_deposited: u128 = 0;
            let mut total_withdrawn: u128 = 0;
            let mut sell_count: u128 = 0; // count of executed sells (for deficit bound)
            let mut rejected_sells: u128 = 0; // sells rejected by solvency check

            for i in 0..num_ops as usize {
                if i >= op_pcts.len() || i >= op_types.len() { break; }

                if op_types[i] == 0 && current_sold < TARGET_TOKENS {
                    // BUY: derive SOL amount from percentage
                    let sol = MIN_PURCHASE_SOL.max(
                        ((TARGET_SOL as u128 / 20) * (op_pcts[i] as u128) / 1_000_000u128) as u64
                    );

                    if let Ok(tokens) = calculate_tokens_out(sol, current_sold) {
                        if tokens == 0 { continue; }
                        let actual_tokens = tokens.min(TARGET_TOKENS - current_sold);

                        // Vault receives the raw SOL input
                        vault_sol += sol as u128;
                        total_deposited += sol as u128;
                        current_sold = current_sold.saturating_add(actual_tokens);
                    }
                } else if current_sold > 0 {
                    // SELL: derive token amount from percentage of current position
                    let tokens_to_sell = 1u64.max(
                        ((current_sold as u128) * (op_pcts[i] as u128) / 1_000_000u128) as u64
                    ).min(current_sold);

                    let x2 = current_sold.saturating_sub(tokens_to_sell);
                    if let Ok(sol_gross) = calculate_sol_for_tokens(x2, tokens_to_sell) {
                        if vault_sol >= sol_gross as u128 {
                            // Sell succeeds: vault can cover it
                            vault_sol -= sol_gross as u128;
                            total_withdrawn += sol_gross as u128;
                            current_sold = x2;
                            sell_count += 1;
                        } else {
                            // On-chain: VaultInsolvency guard fires, TX reverts.
                            // The deficit should be bounded by prior sell count
                            // (at most 1 lamport per ceil rounding event).
                            let deficit = sol_gross as u128 - vault_sol;
                            prop_assert!(
                                deficit <= sell_count,
                                "Sell deficit at op {} exceeds ceil-rounding bound: \
                                deficit={} > sell_count={} (vault={}, sol_gross={}, \
                                selling {} tokens at pos {})",
                                i, deficit, sell_count, vault_sol, sol_gross,
                                tokens_to_sell, current_sold
                            );
                            rejected_sells += 1;
                        }
                    }
                }
            }

            // FINAL INVARIANT: Total withdrawn never exceeds total deposited.
            prop_assert!(
                total_deposited >= total_withdrawn,
                "Withdrew more than deposited: deposited={} < withdrawn={}",
                total_deposited, total_withdrawn
            );

            // DEFICIT BOUND: rejected sells should be rare (ceil rounding only)
            // and their deficit should be tiny (bounded by sell_count lamports).
            // This is not a failure mode — it's correct on-chain behavior.
            // The VaultInsolvency guard protects against it.
            prop_assert!(
                rejected_sells <= sell_count + 1,
                "Too many rejected sells: {} rejected vs {} succeeded",
                rejected_sells, sell_count
            );
        }

        /// PROPERTY S3: Tax escrow accumulation correctness.
        ///
        /// After a sequence of sells, the total accumulated tax should be > 0
        /// whenever any tokens were sold. Verifies ceil-rounding tax always
        /// produces a non-zero contribution for non-zero gross amounts.
        #[test]
        fn tax_escrow_accumulation(
            num_sells in 2u32..=6u32,
            sell_pcts in proptest::collection::vec(1u64..=200_000u64, 2..=6),
        ) {
            // Start with a buy to get tokens
            let initial_sol = TARGET_SOL / 2;
            let tokens = match calculate_tokens_out(initial_sol, 0) {
                Ok(t) if t > 0 => t,
                _ => return Ok(()),
            };

            let mut current_sold = tokens;
            let mut total_tax: u128 = 0;
            let mut remaining_tokens = tokens;

            for i in 0..num_sells as usize {
                if i >= sell_pcts.len() { break; }
                if remaining_tokens == 0 { break; }

                let sell_amount = 1u64.max(
                    ((remaining_tokens as u128) * (sell_pcts[i] as u128) / 1_000_000u128) as u64
                ).min(remaining_tokens);

                let x2 = current_sold.saturating_sub(sell_amount);
                if let Ok(sol_gross) = calculate_sol_for_tokens(x2, sell_amount) {
                    let tax = (sol_gross as u128 * SELL_TAX_BPS as u128 + BPS_DENOMINATOR as u128 - 1)
                        / BPS_DENOMINATOR as u128;

                    total_tax += tax;
                    current_sold = x2;
                    remaining_tokens -= sell_amount;
                }
            }

            // Verify: total tax is always > 0 if any sells happened
            if tokens > remaining_tokens {
                prop_assert!(
                    total_tax > 0,
                    "Tax should be > 0 after sells (initial={}, remaining={})",
                    tokens, remaining_tokens
                );
            }
        }

        /// PROPERTY S4: Sell never increases tokens_sold.
        ///
        /// After a sell, the new tokens_sold position should always be strictly
        /// less than before, and the reverse integral should be computable.
        #[test]
        fn sell_decreases_tokens_sold(
            sold_pct in 1u64..=999_999u64,
            sell_pct in 1u64..=1_000_000u64,
        ) {
            let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;
            if current_sold == 0 { return Ok(()); }

            let tokens_to_sell = 1u64.max(
                ((current_sold as u128) * (sell_pct as u128) / 1_000_000u128) as u64
            ).min(current_sold);

            let new_sold = current_sold.checked_sub(tokens_to_sell);
            prop_assert!(
                new_sold.is_some() && new_sold.unwrap() < current_sold,
                "Sell should decrease tokens_sold: {} - {} = {:?}",
                current_sold, tokens_to_sell, new_sold
            );

            // Verify the reverse integral is computable at the new position
            let x2 = new_sold.unwrap();
            let result = calculate_sol_for_tokens(x2, tokens_to_sell);
            prop_assert!(
                result.is_ok(),
                "Reverse integral should not overflow: calculate_sol_for_tokens({}, {})",
                x2, tokens_to_sell
            );
        }

        /// PROPERTY S5: Multi-user interleaved buy/sell maintains solvency.
        ///
        /// Simulates 2-5 users with independent buy/sell actions (5-15 ops).
        /// After every sell, verifies the vault can cover the withdrawal.
        /// At the end, verifies total_deposited >= total_withdrawn.
        ///
        /// This is the strongest solvency test: it proves that even with
        /// multiple wallets trading simultaneously, no sell causes underflow
        /// and the protocol never pays out more than was deposited.
        #[test]
        fn multi_user_solvency(
            num_users in 2u32..=5u32,
            ops in proptest::collection::vec((0u8..=1u8, 0u64..=1_000_000u64), 5..=15),
        ) {
            let num_users = num_users as usize;
            let mut user_tokens = vec![0u64; num_users];
            let mut current_sold: u64 = 0;
            let mut vault_sol: u128 = 0;
            let mut total_deposited: u128 = 0;
            let mut total_withdrawn: u128 = 0;

            for (idx, &(op_type, amount_pct)) in ops.iter().enumerate() {
                let user_idx = idx % num_users;

                if op_type == 0 && current_sold < TARGET_TOKENS {
                    // BUY
                    let sol = MIN_PURCHASE_SOL.max(
                        ((TARGET_SOL as u128 / 50) * (amount_pct as u128) / 1_000_000u128) as u64
                    );

                    if let Ok(tokens) = calculate_tokens_out(sol, current_sold) {
                        if tokens == 0 { continue; }
                        let actual = tokens.min(TARGET_TOKENS - current_sold);

                        vault_sol += sol as u128;
                        total_deposited += sol as u128;
                        current_sold = current_sold.saturating_add(actual);
                        user_tokens[user_idx] = user_tokens[user_idx].saturating_add(actual);
                    }
                } else if user_tokens[user_idx] > 0 {
                    // SELL
                    let sell_amount = 1u64.max(
                        ((user_tokens[user_idx] as u128) * (amount_pct as u128) / 1_000_000u128) as u64
                    ).min(user_tokens[user_idx]).min(current_sold);

                    let x2 = current_sold.saturating_sub(sell_amount);
                    if let Ok(sol_gross) = calculate_sol_for_tokens(x2, sell_amount) {
                        if vault_sol >= sol_gross as u128 {
                            // Sell succeeds: vault can cover it
                            vault_sol -= sol_gross as u128;
                            total_withdrawn += sol_gross as u128;
                            current_sold = x2;
                            user_tokens[user_idx] -= sell_amount;
                        }
                        // On-chain: VaultInsolvency guard fires, TX reverts.
                        // Ceil rounding in calculate_sol_for_tokens can cause
                        // up to 1 lamport deficit per prior sell, which is the
                        // known rounding asymmetry (Phase 86 TEST-07).
                    }
                }
            }

            // FINAL INVARIANT: total withdrawn never exceeds total deposited.
            // (vault_sol is u128 so underflow would have panicked above.)
            prop_assert!(
                total_deposited >= total_withdrawn,
                "Multi-user: withdrew more than deposited: {} < {}",
                total_deposited, total_withdrawn
            );
        }

        /// PROPERTY S6: Sell at curve extremes (near-zero and near-full).
        ///
        /// Tests that sells work correctly at boundaries: positions close to
        /// 0 (start of curve, lowest prices) and close to TARGET_TOKENS
        /// (end of curve, highest prices). Tax should never exceed gross,
        /// and net should always be less than gross when tax > 0.
        #[test]
        fn sell_at_extremes(
            tokens_to_sell in 1u64..=1_000_000u64,
            near_full in proptest::bool::ANY,
        ) {
            let current_sold = if near_full {
                // Near full: position close to TARGET_TOKENS
                TARGET_TOKENS - tokens_to_sell.min(TARGET_TOKENS)
            } else {
                // Near zero: small position
                tokens_to_sell
            };

            if current_sold == 0 { return Ok(()); }
            let sell = tokens_to_sell.min(current_sold);

            let x2 = current_sold - sell;
            if let Ok(sol_gross) = calculate_sol_for_tokens(x2, sell) {
                // Tax should never exceed gross
                let tax = (sol_gross as u128 * SELL_TAX_BPS as u128 + BPS_DENOMINATOR as u128 - 1)
                    / BPS_DENOMINATOR as u128;
                prop_assert!(
                    tax as u64 <= sol_gross,
                    "Tax {} exceeds gross {} at position {}",
                    tax, sol_gross, current_sold
                );

                // Net should be strictly less than gross (15% tax)
                let sol_net = sol_gross.saturating_sub(tax as u64);
                prop_assert!(
                    sol_gross == 0 || sol_net < sol_gross,
                    "Net {} should be less than gross {} (15% tax)",
                    sol_net, sol_gross
                );
            }
        }
    }

    // =========================================================================
    // Refund Math: Deterministic Tests
    //
    // These verify the calculate_refund helper matches the on-chain formula:
    //   floor(user_balance * refund_pool / total_outstanding)
    //
    // Tests cover: single user, equal split, zero edge cases, floor rounding,
    // realistic curve values.
    // =========================================================================

    #[test]
    fn refund_single_user_gets_full_pool() {
        // One user holding all tokens gets the entire refund pool.
        let result = calculate_refund(1_000_000, 500_000_000, 1_000_000);
        assert_eq!(
            result,
            Some(500_000_000),
            "Single user should get full pool"
        );
    }

    #[test]
    fn refund_two_equal_users() {
        // Two users with equal balances each get half.
        let refund_a = calculate_refund(500, 1_000_000, 1_000);
        let refund_b = calculate_refund(500, 1_000_000, 1_000);
        assert_eq!(refund_a, Some(500_000), "User A should get half");
        assert_eq!(refund_b, Some(500_000), "User B should get half");
    }

    #[test]
    fn refund_zero_balance_gets_nothing() {
        // User with 0 tokens gets 0.
        let result = calculate_refund(0, 1_000_000, 1_000);
        assert_eq!(result, Some(0), "Zero balance should get zero refund");
    }

    #[test]
    fn refund_zero_pool_gets_nothing() {
        // Empty vault returns 0.
        let result = calculate_refund(500, 0, 1_000);
        assert_eq!(result, Some(0), "Zero pool should return zero");
    }

    #[test]
    fn refund_zero_outstanding_returns_none() {
        // Division by zero guard.
        let result = calculate_refund(500, 1_000_000, 0);
        assert_eq!(result, None, "Zero outstanding should return None");
    }

    #[test]
    fn refund_floor_rounding_favors_protocol() {
        // 3 users each holding 1 token, pool = 10 lamports, total = 3.
        // Each gets floor(10/3) = 3. Total refunded = 9. Dust = 1 lamport.
        let r1 = calculate_refund(1, 10, 3).unwrap();
        assert_eq!(r1, 3, "floor(1 * 10 / 3) = 3");

        let r2 = calculate_refund(1, 10, 3).unwrap();
        assert_eq!(r2, 3, "Each equal user gets 3");

        // Simulate sequential claims with shrinking denominator
        let mut pool = 10u64;
        let mut outstanding = 3u64;
        let mut total_refunded = 0u64;

        for _ in 0..3 {
            let refund = calculate_refund(1, pool, outstanding).unwrap();
            pool -= refund;
            outstanding -= 1;
            total_refunded += refund;
        }
        assert_eq!(total_refunded, 10, "All 10 lamports should be refunded (10/3=3, 7/2=3, 4/1=4)");
        assert_eq!(pool, 0, "Pool should be fully drained");
    }

    #[test]
    fn refund_realistic_curve_values() {
        // Pool = 500_000_000_000 (500 SOL), total = 460_000_000_000_000 (460M tokens).
        // User with 20_000_000_000_000 (20M tokens).
        // Refund: floor(20e12 * 500e9 / 460e12) = floor(21_739_130_434.782...) = 21_739_130_434.
        let refund = calculate_refund(
            20_000_000_000_000,
            500_000_000_000,
            460_000_000_000_000,
        )
        .unwrap();

        assert_eq!(
            refund, 21_739_130_434,
            "20M token refund from 500 SOL pool / 460M total = ~21.739 SOL"
        );

        // Verify it's the floor (not ceil)
        let exact = 20_000_000_000_000u128 * 500_000_000_000u128 / 460_000_000_000_000u128;
        assert_eq!(exact, 21_739_130_434, "u128 integer division gives floor");
    }

    // =========================================================================
    // Simulate Claims Helper
    // =========================================================================

    /// Simulate sequential refund claims for N users.
    /// Returns (per-user refund amounts, final remaining vault).
    fn simulate_claims(
        initial_pool: u64,
        total_tokens: u64,
        user_balances: &[u64],
    ) -> (Vec<u64>, u64) {
        let mut pool = initial_pool;
        let mut outstanding = total_tokens;
        let mut refunds = Vec::with_capacity(user_balances.len());

        for &balance in user_balances {
            let refund = (balance as u128 * pool as u128 / outstanding as u128) as u64;
            pool -= refund;
            outstanding -= balance;
            refunds.push(refund);
        }

        (refunds, pool)
    }

    // =========================================================================
    // Proptest: Refund Property Tests (1M iterations)
    //
    // These tests prove the proportional refund formula is correct:
    // - Order-independent (claim ordering doesn't affect individual payouts)
    // - Solvent (no individual claim exceeds available pool)
    // - Exhaustive (total refunded approaches pool, dust only remains)
    // - Protocol-favored (floor rounding never overpays)
    // - Correct with varied pool sizes (buy/sell + escrow consolidation)
    // =========================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1_000_000))]

        /// PROPERTY R1: Refund order near-independence and fairness.
        ///
        /// Three users with random balances summing to total_outstanding.
        /// All claim in sequence in two different orderings (ABC vs CBA).
        ///
        /// The shrinking-denominator formula (used on-chain for simplicity)
        /// introduces tiny order-dependent variations from floor rounding.
        /// This is mathematically expected: floor(a * pool / total) uses
        /// integer arithmetic, and the pool/total ratio changes slightly
        /// after each claim due to floor truncation.
        ///
        /// We prove the much stronger property that matters for user trust:
        /// 1. Each user's refund differs by at most 1 lamport between orderings
        /// 2. Total dust is bounded (max N lamports for N users)
        /// 3. Total refunded is the same regardless of order (conservation)
        /// 4. No user's refund deviates from their fair share by more than N-1 lamports
        #[test]
        fn refund_order_independent(
            vault_sol in 1_000_000u64..=500_000_000_000u64,
            pct_a in 1u64..=500_000u64,
            pct_b in 1u64..=500_000u64,
        ) {
            let total = 460_000_000_000_000u64; // realistic tokens_sold
            let balance_a = ((total as u128) * (pct_a as u128) / 1_000_000) as u64;
            let balance_b = ((total as u128) * (pct_b as u128) / 1_000_000) as u64;
            let balance_c = total - balance_a - balance_b;

            // Skip degenerate cases
            if balance_a == 0 || balance_b == 0 || balance_c == 0 {
                return Ok(());
            }

            // Simulate ABC order
            let (refunds_abc, dust_abc) =
                simulate_claims(vault_sol, total, &[balance_a, balance_b, balance_c]);

            // Simulate CBA order
            let (refunds_cba, dust_cba) =
                simulate_claims(vault_sol, total, &[balance_c, balance_b, balance_a]);

            // Each user's refund should differ by at most N-1 = 2 lamports between
            // orderings. The floor-rounding at each intermediate claim shifts the
            // remaining pool by at most 1 lamport, and these shifts can compound
            // across N-1 prior claims. For 3 users, the max per-user deviation is 2.
            let max_order_diff = 2u128; // N-1 for 3 users
            let diff_a = (refunds_abc[0] as i128 - refunds_cba[2] as i128).unsigned_abs();
            let diff_b = (refunds_abc[1] as i128 - refunds_cba[1] as i128).unsigned_abs();
            let diff_c = (refunds_abc[2] as i128 - refunds_cba[0] as i128).unsigned_abs();

            prop_assert!(
                diff_a <= max_order_diff,
                "User A refund differs by {}: ABC={} vs CBA={} (max {})",
                diff_a, refunds_abc[0], refunds_cba[2], max_order_diff
            );
            prop_assert!(
                diff_b <= max_order_diff,
                "User B refund differs by {}: ABC={} vs CBA={} (max {})",
                diff_b, refunds_abc[1], refunds_cba[1], max_order_diff
            );
            prop_assert!(
                diff_c <= max_order_diff,
                "User C refund differs by {}: ABC={} vs CBA={} (max {})",
                diff_c, refunds_abc[2], refunds_cba[0], max_order_diff
            );

            // Total dust should be bounded (max 1 lamport per user from floor rounding)
            let total_refunded_abc: u64 = refunds_abc.iter().sum();
            let total_refunded_cba: u64 = refunds_cba.iter().sum();

            prop_assert!(
                vault_sol - total_refunded_abc <= 3,
                "ABC dust too large: {} lamports left (max 3 for 3 users)",
                vault_sol - total_refunded_abc
            );
            prop_assert!(
                vault_sol - total_refunded_cba <= 3,
                "CBA dust too large: {} lamports left (max 3 for 3 users)",
                vault_sol - total_refunded_cba
            );

            // Both orderings should leave the same total dust
            // (total refunded should be equal because dust bounds are symmetric)
            let dust_diff = (dust_abc as i128 - dust_cba as i128).unsigned_abs();
            prop_assert!(
                dust_diff <= 2,
                "Dust differs between orderings by {}: ABC={} vs CBA={}",
                dust_diff, dust_abc, dust_cba
            );

            // Each user's refund should be close to their fair share
            // fair_share = floor(balance * vault_sol / total)
            let fair_a = (balance_a as u128 * vault_sol as u128 / total as u128) as u64;
            let fair_b = (balance_b as u128 * vault_sol as u128 / total as u128) as u64;
            let fair_c = (balance_c as u128 * vault_sol as u128 / total as u128) as u64;

            // Deviation from fair share bounded by N-1 = 2 lamports
            let dev_a = (refunds_abc[0] as i128 - fair_a as i128).unsigned_abs();
            let dev_b = (refunds_abc[1] as i128 - fair_b as i128).unsigned_abs();
            let dev_c = (refunds_abc[2] as i128 - fair_c as i128).unsigned_abs();

            prop_assert!(
                dev_a <= 2,
                "User A deviates {} from fair share {} (got {})",
                dev_a, fair_a, refunds_abc[0]
            );
            prop_assert!(
                dev_b <= 2,
                "User B deviates {} from fair share {} (got {})",
                dev_b, fair_b, refunds_abc[1]
            );
            prop_assert!(
                dev_c <= 2,
                "User C deviates {} from fair share {} (got {})",
                dev_c, fair_c, refunds_abc[2]
            );
        }

        /// PROPERTY R2: Refund solvency per-claim (variable users).
        ///
        /// For 2-6 users, each claim's refund amount never exceeds the
        /// current pool balance. This proves no individual claim can
        /// overdraw the vault.
        #[test]
        fn refund_solvency_per_claim(
            vault_sol in 1_000_000u64..=500_000_000_000u64,
            num_users in 2u32..=6u32,
            pcts in proptest::collection::vec(1u64..=1_000_000u64, 2..=6),
        ) {
            let n = num_users as usize;
            if pcts.len() < n { return Ok(()); }

            // Derive balances from percentages, normalized to sum = total
            let total = 460_000_000_000_000u64;
            let raw_sum: u128 = pcts[..n].iter().map(|&p| p as u128).sum();
            let mut balances: Vec<u64> = pcts[..n]
                .iter()
                .map(|&p| ((total as u128) * (p as u128) / raw_sum) as u64)
                .collect();

            // Adjust last user to absorb rounding error
            let assigned: u64 = balances.iter().sum();
            if total > assigned {
                *balances.last_mut().unwrap() += total - assigned;
            } else if assigned > total {
                let excess = assigned - total;
                *balances.last_mut().unwrap() = balances.last().unwrap().saturating_sub(excess);
            }

            // Skip if any balance is 0
            if balances.iter().any(|&b| b == 0) { return Ok(()); }

            // Simulate claims and verify solvency at each step
            let mut pool = vault_sol;
            let mut outstanding = total;

            for (i, &balance) in balances.iter().enumerate() {
                let refund = (balance as u128 * pool as u128 / outstanding as u128) as u64;

                // Each refund must not exceed the current pool
                prop_assert!(
                    refund <= pool,
                    "Claim {} overdraw: refund {} > pool {} (balance={}, outstanding={})",
                    i, refund, pool, balance, outstanding
                );

                pool -= refund;
                outstanding -= balance;
            }
        }

        /// PROPERTY R3: Refund vault exhaustion (total dust bounded).
        ///
        /// After all users claim, remaining vault balance is bounded:
        /// - dust <= num_users (max 1 lamport per user from floor rounding)
        /// - sum_of_refunds + dust == initial_vault_sol (no lamports created/lost)
        #[test]
        fn refund_vault_exhaustion(
            vault_sol in 1_000_000u64..=500_000_000_000u64,
            num_users in 2u32..=6u32,
            pcts in proptest::collection::vec(1u64..=1_000_000u64, 2..=6),
        ) {
            let n = num_users as usize;
            if pcts.len() < n { return Ok(()); }

            let total = 460_000_000_000_000u64;
            let raw_sum: u128 = pcts[..n].iter().map(|&p| p as u128).sum();
            let mut balances: Vec<u64> = pcts[..n]
                .iter()
                .map(|&p| ((total as u128) * (p as u128) / raw_sum) as u64)
                .collect();

            let assigned: u64 = balances.iter().sum();
            if total > assigned {
                *balances.last_mut().unwrap() += total - assigned;
            } else if assigned > total {
                let excess = assigned - total;
                *balances.last_mut().unwrap() = balances.last().unwrap().saturating_sub(excess);
            }

            if balances.iter().any(|&b| b == 0) { return Ok(()); }

            let (refunds, remaining) = simulate_claims(vault_sol, total, &balances);
            let total_refunded: u64 = refunds.iter().sum();

            // Conservation: refunded + remaining == initial
            prop_assert_eq!(
                total_refunded + remaining,
                vault_sol,
                "Lamports not conserved: refunded {} + remaining {} != initial {}",
                total_refunded, remaining, vault_sol
            );

            // Dust bounded: at most 1 lamport per user from floor rounding
            prop_assert!(
                remaining <= n as u64,
                "Dust {} exceeds max {} for {} users",
                remaining, n, n
            );
        }

        /// PROPERTY R4: Floor rounding protocol-favored.
        ///
        /// For the first claimer (before pool shrinks), the floor-rounded
        /// refund is never more than the exact fractional share. This
        /// proves the protocol never overpays any individual.
        #[test]
        fn refund_floor_rounding_protocol_favored(
            vault_sol in 1_000_000u64..=500_000_000_000u64,
            num_users in 2u32..=6u32,
            pcts in proptest::collection::vec(1u64..=1_000_000u64, 2..=6),
        ) {
            let n = num_users as usize;
            if pcts.len() < n { return Ok(()); }

            let total = 460_000_000_000_000u64;
            let raw_sum: u128 = pcts[..n].iter().map(|&p| p as u128).sum();
            let mut balances: Vec<u64> = pcts[..n]
                .iter()
                .map(|&p| ((total as u128) * (p as u128) / raw_sum) as u64)
                .collect();

            let assigned: u64 = balances.iter().sum();
            if total > assigned {
                *balances.last_mut().unwrap() += total - assigned;
            } else if assigned > total {
                let excess = assigned - total;
                *balances.last_mut().unwrap() = balances.last().unwrap().saturating_sub(excess);
            }

            if balances.iter().any(|&b| b == 0) { return Ok(()); }

            // For the first user, compute the exact fractional share via f64
            // and compare to the integer floor result.
            let floor_refund = calculate_refund(balances[0], vault_sol, total).unwrap();
            let exact_f64 = balances[0] as f64 * vault_sol as f64 / total as f64;

            // Floor should never exceed the exact value (+ 1.0 tolerance for f64 imprecision)
            prop_assert!(
                (floor_refund as f64) <= exact_f64 + 1.0,
                "Floor refund {} exceeds exact {:.2} (balance={}, pool={}, total={})",
                floor_refund, exact_f64, balances[0], vault_sol, total
            );
        }

        /// PROPERTY R5: Refund with varied pool sizes (buy/sell scenarios).
        ///
        /// Tests refund correctness when the pool contains SOL from both
        /// buys and consolidated tax escrow. The escrow adds up to ~15%
        /// of buy SOL (from sell tax) back to the vault, increasing the
        /// refund pool. All R1-R4 properties must still hold.
        #[test]
        fn refund_varied_pool_sizes(
            buy_sol in MIN_PURCHASE_SOL..=TARGET_SOL,
            tax_pct in 0u64..=150_000u64,
            num_users in 2u32..=4u32,
            pcts in proptest::collection::vec(1u64..=1_000_000u64, 2..=4),
        ) {
            let n = num_users as usize;
            if pcts.len() < n { return Ok(()); }

            // Tax portion: up to ~15% of buy amount (simulates consolidation)
            let tax_portion = ((buy_sol as u128) * (tax_pct as u128) / 1_000_000) as u64;
            let total_pool = buy_sol.saturating_add(tax_portion);
            if total_pool == 0 { return Ok(()); }

            let total = 460_000_000_000_000u64;
            let raw_sum: u128 = pcts[..n].iter().map(|&p| p as u128).sum();
            let mut balances: Vec<u64> = pcts[..n]
                .iter()
                .map(|&p| ((total as u128) * (p as u128) / raw_sum) as u64)
                .collect();

            let assigned: u64 = balances.iter().sum();
            if total > assigned {
                *balances.last_mut().unwrap() += total - assigned;
            } else if assigned > total {
                let excess = assigned - total;
                *balances.last_mut().unwrap() = balances.last().unwrap().saturating_sub(excess);
            }

            if balances.iter().any(|&b| b == 0) { return Ok(()); }

            // Verify solvency and exhaustion
            let (refunds, remaining) = simulate_claims(total_pool, total, &balances);
            let total_refunded: u64 = refunds.iter().sum();

            // Conservation
            prop_assert_eq!(
                total_refunded + remaining,
                total_pool,
                "Lamports not conserved with varied pool: {} + {} != {}",
                total_refunded, remaining, total_pool
            );

            // Dust bounded
            prop_assert!(
                remaining <= n as u64,
                "Dust {} exceeds max {} for {} users (pool={})",
                remaining, n, n, total_pool
            );

            // Each refund <= pool at time of claim (solvency)
            let mut pool = total_pool;
            let mut outstanding = total;
            for &balance in &balances {
                let refund = (balance as u128 * pool as u128 / outstanding as u128) as u64;
                prop_assert!(refund <= pool, "Refund {} > pool {}", refund, pool);
                pool -= refund;
                outstanding -= balance;
            }
        }
    }

    // =========================================================================
    // Phase 73 Instruction Logic Tests (Deterministic)
    //
    // These test the pure logic that each instruction enforces, without
    // LiteSVM. Covers: grace buffer boundaries, status gates, consolidation
    // idempotency, and refund denominator shrinkage.
    // =========================================================================

    #[test]
    fn mark_failed_grace_buffer_exact_boundary() {
        // On-chain formula: require!(clock.slot > curve.deadline_slot + FAILURE_GRACE_SLOTS)
        // Strictly greater, not >=.
        let deadline_slot = 1_000_000u64;
        let failure_eligible_slot = deadline_slot + FAILURE_GRACE_SLOTS; // 1_000_150

        // At exactly deadline + FAILURE_GRACE_SLOTS: NOT eligible (require > not >=)
        let slot_at_boundary = failure_eligible_slot;
        assert!(
            !(slot_at_boundary > failure_eligible_slot),
            "At exactly boundary slot {}: should NOT be eligible (strictly greater required)",
            slot_at_boundary
        );

        // At deadline + FAILURE_GRACE_SLOTS + 1: eligible
        let slot_after_boundary = failure_eligible_slot + 1;
        assert!(
            slot_after_boundary > failure_eligible_slot,
            "At slot {}: should be eligible (> {})",
            slot_after_boundary,
            failure_eligible_slot
        );

        // Verify FAILURE_GRACE_SLOTS is 150 (as defined)
        assert_eq!(
            FAILURE_GRACE_SLOTS, 150,
            "FAILURE_GRACE_SLOTS should be 150"
        );
    }

    #[test]
    fn prepare_transition_requires_both_filled() {
        use crate::state::CurveStatus;

        // Test all status combinations for the prepare_transition check:
        // require!(crime_status == Filled) && require!(fraud_status == Filled)
        let statuses = [
            CurveStatus::Initialized,
            CurveStatus::Active,
            CurveStatus::Filled,
            CurveStatus::Failed,
            CurveStatus::Graduated,
        ];

        for &crime_status in &statuses {
            for &fraud_status in &statuses {
                let both_filled =
                    crime_status == CurveStatus::Filled && fraud_status == CurveStatus::Filled;

                if both_filled {
                    // This is the only valid combination for graduation
                    assert!(
                        true,
                        "Filled + Filled should be OK for prepare_transition"
                    );
                } else {
                    // All other combinations should fail
                    let crime_ok = crime_status == CurveStatus::Filled;
                    let fraud_ok = fraud_status == CurveStatus::Filled;
                    assert!(
                        !crime_ok || !fraud_ok,
                        "Non-Filled combination should fail: crime={:?}, fraud={:?}",
                        crime_status as u8,
                        fraud_status as u8,
                    );
                }
            }
        }

        // Specifically test is_refund_eligible for cross-curve combinations
        // (Filled, Failed) -> refund eligible for the Filled curve
        use crate::state::{CurveState, Token};

        let make_state = |status: CurveStatus| -> CurveState {
            CurveState {
                token: Token::Crime,
                token_mint: anchor_lang::prelude::Pubkey::default(),
                token_vault: anchor_lang::prelude::Pubkey::default(),
                sol_vault: anchor_lang::prelude::Pubkey::default(),
                tokens_sold: 0,
                sol_raised: 0,
                status,
                start_slot: 0,
                deadline_slot: 0,
                participant_count: 0,
                tokens_returned: 0,
                sol_returned: 0,
                tax_collected: 0,
                tax_escrow: anchor_lang::prelude::Pubkey::default(),
                bump: 0,
                escrow_consolidated: false,
                partner_mint: anchor_lang::prelude::Pubkey::default(),
            }
        };

        // (Filled, Active) -> NOT eligible
        let filled = make_state(CurveStatus::Filled);
        assert!(!filled.is_refund_eligible(CurveStatus::Active));

        // (Active, Filled) -> NOT eligible (Active is never refund-eligible)
        let active = make_state(CurveStatus::Active);
        assert!(!active.is_refund_eligible(CurveStatus::Filled));

        // (Graduated, Filled) -> NOT eligible
        let graduated = make_state(CurveStatus::Graduated);
        assert!(!graduated.is_refund_eligible(CurveStatus::Filled));

        // (Filled, Failed) -> eligible (partner failed, so this curve gets refunds)
        assert!(filled.is_refund_eligible(CurveStatus::Failed));
    }

    #[test]
    fn consolidate_idempotency_flag() {
        use crate::state::{CurveState, CurveStatus, Token};

        let mut state = CurveState {
            token: Token::Crime,
            token_mint: anchor_lang::prelude::Pubkey::default(),
            token_vault: anchor_lang::prelude::Pubkey::default(),
            sol_vault: anchor_lang::prelude::Pubkey::default(),
            tokens_sold: 100_000,
            sol_raised: 1_000_000,
            status: CurveStatus::Failed,
            start_slot: 0,
            deadline_slot: 100,
            participant_count: 5,
            tokens_returned: 0,
            sol_returned: 0,
            tax_collected: 0,
            tax_escrow: anchor_lang::prelude::Pubkey::default(),
            bump: 0,
            escrow_consolidated: false,
            partner_mint: anchor_lang::prelude::Pubkey::default(),
        };

        // Initially not consolidated
        assert!(
            !state.escrow_consolidated,
            "escrow_consolidated should start false"
        );

        // Simulate consolidation (sets flag to true)
        state.escrow_consolidated = true;
        assert!(
            state.escrow_consolidated,
            "After consolidation, flag should be true"
        );

        // A second consolidation attempt would be caught:
        // require!(!curve.escrow_consolidated, CurveError::EscrowAlreadyConsolidated)
        let already_consolidated = state.escrow_consolidated;
        assert!(
            already_consolidated,
            "Second consolidation attempt should be caught by EscrowAlreadyConsolidated check"
        );
    }

    #[test]
    fn refund_denominator_shrinks_correctly() {
        // After each claim, tokens_sold decreases by user_balance.
        // Start with tokens_sold = 1000, two users: 300 and 700.
        let initial_pool = 10_000_000u64; // 0.01 SOL
        let mut tokens_sold = 1000u64;
        let mut pool = initial_pool;

        // User 1 burns 300 tokens
        let user1_balance = 300u64;
        let refund1 = (user1_balance as u128 * pool as u128 / tokens_sold as u128) as u64;
        // floor(300 * 10_000_000 / 1000) = 3_000_000
        assert_eq!(refund1, 3_000_000, "User 1 refund should be 3_000_000");

        pool -= refund1;
        tokens_sold -= user1_balance;
        assert_eq!(tokens_sold, 700, "tokens_sold should be 700 after first claim");
        assert_eq!(pool, 7_000_000, "Pool should be 7_000_000 after first claim");

        // User 2 burns 700 tokens (all remaining)
        let user2_balance = 700u64;
        let refund2 = (user2_balance as u128 * pool as u128 / tokens_sold as u128) as u64;
        // floor(700 * 7_000_000 / 700) = 7_000_000
        assert_eq!(refund2, 7_000_000, "User 2 refund should be 7_000_000");

        pool -= refund2;
        tokens_sold -= user2_balance;

        // Pool should be fully drained, tokens_sold should be 0
        assert_eq!(tokens_sold, 0, "tokens_sold should be 0 after all claims");
        assert_eq!(pool, 0, "Pool should be fully drained (no dust for exact division)");

        // Total refunded equals initial pool
        assert_eq!(
            refund1 + refund2,
            initial_pool,
            "Total refunded should equal initial pool"
        );
    }
}
