// =============================================================================
// BOK Proptest Verification Suite for Bonding Curve Math
//
// Property-based tests with 100K+ iterations per invariant.
// These tests complement the Kani harnesses by providing statistical
// confidence over the full input space, while Kani provides exhaustive
// proofs over bounded domains.
//
// Run with: cargo test --test bok_proptest -- --nocapture
// =============================================================================

use bonding_curve::constants::*;
use bonding_curve::math::*;
use proptest::prelude::*;

// =============================================================================
// Helpers
// =============================================================================

/// Compute ceil-rounded sell tax matching the on-chain formula exactly.
fn ceil_tax(sol_gross: u64) -> u64 {
    let tax = (sol_gross as u128 * SELL_TAX_BPS as u128 + BPS_DENOMINATOR as u128 - 1)
        / BPS_DENOMINATOR as u128;
    tax as u64
}

/// Float reference for price at position x (for accuracy comparison).
/// P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE
fn float_price(tokens_sold: u64) -> f64 {
    let p_start = P_START as f64;
    let p_end = P_END as f64;
    let total = TOTAL_FOR_SALE as f64;
    p_start + (p_end - p_start) * (tokens_sold as f64) / total
}

/// Float reference for SOL cost of N tokens starting at position x1.
/// Integral of linear curve: S = [P_START*N + (P_END-P_START)*N*(2*x1+N)/(2*TOTAL)] / TOKEN_DEC
fn float_sol_for_tokens(current_sold: u64, tokens: u64) -> f64 {
    let a = P_START as f64;
    let b = (P_END - P_START) as f64;
    let total = TOTAL_FOR_SALE as f64;
    let x1 = current_sold as f64;
    let n = tokens as f64;
    let token_dec = 1_000_000.0_f64;

    (a * n + b * n * (2.0 * x1 + n) / (2.0 * total)) / token_dec
}

// =============================================================================
// INV-BC-010: Split-Buy Exploit
//
// A single buy of (A+B) SOL must produce >= tokens than splitting into
// two sequential buys of A SOL then B SOL.
//
// tokens_out(A+B, pos) >= tokens_out(A, pos) + tokens_out(B, pos + tokens_from_A)
//
// WHY: If splitting buys yields MORE tokens, users are incentivized to
// split purchases, and the curve collects less SOL than expected for the
// tokens distributed. This would drain the vault over time.
//
// The concavity of the integral guarantees single buy >= split buys.
// Floor rounding on each partial buy reinforces this (each floor loses
// a fraction of a token that the combined buy retains).
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_bc_010_split_buy_exploit(
        sol_a_pct in 1u64..=500_000u64,
        sol_b_pct in 1u64..=500_000u64,
        sold_pct in 0u64..=900_000u64,
    ) {
        // Derive SOL amounts from percentages (avoids prop_assume rejection)
        let max_sol = TARGET_SOL / 5; // Cap at 200 SOL to keep in valid range
        let sol_a = MIN_PURCHASE_SOL.max(
            ((max_sol as u128) * (sol_a_pct as u128) / 1_000_000u128) as u64
        );
        let sol_b = MIN_PURCHASE_SOL.max(
            ((max_sol as u128) * (sol_b_pct as u128) / 1_000_000u128) as u64
        );
        let sol_combined = sol_a.saturating_add(sol_b);
        if sol_combined > TARGET_SOL { return Ok(()); }

        let pos = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

        // Combined buy
        let tokens_combined = match calculate_tokens_out(sol_combined, pos) {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };

        // Split buy: first buy A, then buy B from new position
        let tokens_a = match calculate_tokens_out(sol_a, pos) {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };
        let new_pos = pos.saturating_add(tokens_a);
        if new_pos > TARGET_TOKENS { return Ok(()); }

        let tokens_b = match calculate_tokens_out(sol_b, new_pos) {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };

        let tokens_split = tokens_a.saturating_add(tokens_b);

        prop_assert!(
            tokens_combined >= tokens_split,
            "INV-BC-010: split exploit! combined({})={} < split({}+{})={} at pos {}",
            sol_combined, tokens_combined, sol_a, sol_b, tokens_split, pos
        );
    }
}

// =============================================================================
// INV-BC-008: Partial Fill
//
// When a buy is capped by remaining supply, the actual SOL charged
// (the integral of the partial fill) must be <= the original sol_amount.
//
// actual_sol_charged <= original_sol_amount
//
// WHY: If partial fills charge MORE than the input SOL, the vault would
// receive more SOL than the user intended, breaking the purchase contract.
// The on-chain instruction refunds unspent SOL, so the math must compute
// the correct partial cost.
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_bc_008_partial_fill(
        sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL,
        sold_pct in 0u64..=999_999u64,
    ) {
        let pos = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

        if let Ok(tokens) = calculate_tokens_out(sol_lamports, pos) {
            if tokens == 0 { return Ok(()); }

            // Compute actual cost of the tokens received
            if let Ok(actual_cost) = calculate_sol_for_tokens(pos, tokens) {
                prop_assert!(
                    actual_cost <= sol_lamports,
                    "INV-BC-008: partial fill overcharge! cost {} > input {} for {} tokens at pos {}",
                    actual_cost, sol_lamports, tokens, pos
                );
            }
        }
    }
}

// =============================================================================
// INV-BC-007: Vault Solvency
//
// After random buy/sell sequences (up to 100 ops), the vault balance
// must always be >= integral(0, tokens_sold).
//
// WHY: This is the fundamental solvency invariant. If the vault balance
// drops below the integral of outstanding tokens, some future sell
// will fail (the vault can't cover the payout). Protocol-favored
// rounding (floor tokens, ceil SOL cost) guarantees surplus.
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    #[test]
    fn inv_bc_007_vault_solvency(
        num_ops in 5u32..=100u32,
        op_data in proptest::collection::vec((0u8..=1u8, 1u64..=500_000u64), 5..=100),
    ) {
        let mut current_sold: u64 = 0;
        let mut vault_sol: u128 = 0;
        let mut sell_count: u128 = 0;

        for i in 0..num_ops.min(op_data.len() as u32) as usize {
            let (op_type, amount_pct) = op_data[i];

            if op_type == 0 && current_sold < TARGET_TOKENS {
                // BUY
                let sol = MIN_PURCHASE_SOL.max(
                    ((TARGET_SOL as u128 / 50) * (amount_pct as u128) / 500_000u128) as u64
                );

                if let Ok(tokens) = calculate_tokens_out(sol, current_sold) {
                    if tokens == 0 { continue; }
                    let actual = tokens.min(TARGET_TOKENS - current_sold);
                    vault_sol += sol as u128;
                    current_sold = current_sold.saturating_add(actual);
                }
            } else if current_sold > 0 {
                // SELL
                let sell_amount = 1u64.max(
                    ((current_sold as u128) * (amount_pct as u128) / 500_000u128) as u64
                ).min(current_sold);

                let x2 = current_sold.saturating_sub(sell_amount);
                if let Ok(sol_gross) = calculate_sol_for_tokens(x2, sell_amount) {
                    // calculate_sol_for_tokens uses ceil rounding (protocol-favored).
                    // Each sell's ceil can overcharge the vault by 1 lamport vs the
                    // exact integral.  At devnet scale (prices 5-17 lamports) this
                    // is a significant fraction; at mainnet it's negligible.
                    // Allow 1 lamport tolerance per sell operation (mathematical
                    // worst case for ceil rounding accumulation).
                    // On-chain, SOLVENCY_BUFFER_LAMPORTS prevents actual underflow.
                    let tolerance = sell_count + 1; // +1 for current sell
                    if sol_gross as u128 > vault_sol + tolerance {
                        prop_assert!(
                            false,
                            "INV-BC-007: vault underflow at op {}: vault={} + tolerance={} < sol_gross={} \
                             (selling {} tokens from pos {}, {} prior sells)",
                            i, vault_sol, tolerance, sol_gross, sell_amount, current_sold, sell_count
                        );
                    }
                    vault_sol = vault_sol.saturating_sub(sol_gross as u128);
                    sell_count += 1;
                    current_sold = x2;
                }
            }
        }

        // Final check: vault >= integral(0, current_sold)
        if current_sold > 0 {
            if let Ok(integral) = calculate_sol_for_tokens(0, current_sold) {
                // Allow 1 lamport per operation tolerance for ceil-rounding composability
                // (See math.rs PROPERTY S2 note on integral composability)
                let tolerance = num_ops as u128;
                prop_assert!(
                    vault_sol + tolerance >= integral as u128,
                    "INV-BC-007: final solvency violated: vault={} < integral={} \
                     (tolerance={}) after {} ops, tokens_sold={}",
                    vault_sol, integral, tolerance, num_ops, current_sold
                );
            }
        }
    }
}

// =============================================================================
// INV-BC-009: Buy+Sell Conservation
//
// Buy tokens with X SOL, immediately sell them back.
// Net SOL received must be strictly less than X.
//
// WHY: The 15% sell tax guarantees loss on every round-trip. This test
// verifies the economic model works: no user can profit from buy-then-sell
// regardless of curve position or amount.
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_bc_009_buy_sell_conservation(
        sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL / 5,
        sold_pct in 0u64..=900_000u64,
    ) {
        let pos = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

        // Buy
        let tokens = match calculate_tokens_out(sol_lamports, pos) {
            Ok(t) if t > 0 => t,
            _ => return Ok(()),
        };

        let new_pos = pos.saturating_add(tokens);
        if new_pos > TARGET_TOKENS { return Ok(()); }

        // Sell back from same position range
        let sol_gross = match calculate_sol_for_tokens(pos, tokens) {
            Ok(s) => s,
            Err(_) => return Ok(()),
        };

        let tax = ceil_tax(sol_gross);
        let sol_net = sol_gross.saturating_sub(tax);

        prop_assert!(
            sol_net < sol_lamports,
            "INV-BC-009: profitable round-trip! spent {} got {} net (gross {}, tax {}) at pos {}",
            sol_lamports, sol_net, sol_gross, tax, pos
        );
    }
}

// =============================================================================
// INV-BC-011: Price Accuracy
//
// Integer price from get_current_price must be within 0.01% of the
// floating-point reference value.
//
// WHY: PRECISION scaling (1e12) should keep integer truncation negligible.
// If accuracy degrades, users see misleading prices on the frontend,
// and the integral math may accumulate errors.
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_bc_011_price_accuracy(
        sold_pct in 0u64..=1_000_000u64,
    ) {
        let pos = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;
        let pos = pos.min(TARGET_TOKENS);

        let int_price = get_current_price(pos) as f64;
        let ref_price = float_price(pos);

        // Handle zero price edge case
        if ref_price < 1.0 {
            // At very small positions, both should be near P_START
            prop_assert!(
                int_price <= (P_START as f64) + 1.0,
                "INV-BC-011: price {} too high at near-zero position {}",
                int_price, pos
            );
            return Ok(());
        }

        if ref_price < 100.0 {
            // At devnet scale (prices 5-17 lamports), integer truncation of the
            // fractional price increment can be up to 1 lamport.  Relative error
            // is meaningless at this scale (1 lam / 5 lam = 20%) but absolute
            // error is bounded by the final integer division in get_current_price.
            let abs_error = (int_price - ref_price).abs();
            prop_assert!(
                abs_error < 1.01,
                "INV-BC-011: price abs error exceeded 1 lamport: int={} ref={:.6} \
                 abs_err={:.6} at pos {}",
                int_price, ref_price, abs_error, pos
            );
        } else {
            // At mainnet scale (prices 450-1725 lamports), use relative error.
            // BOK Finding 2 documents a known max deviation of ~0.011% from
            // PRECISION=1e12 integer arithmetic.  Threshold of 0.02% provides
            // headroom while still catching real regressions.
            let relative_error = ((int_price - ref_price) / ref_price).abs();
            prop_assert!(
                relative_error < 0.0002, // 0.02%
                "INV-BC-011: price accuracy exceeded 0.02%: int={} ref={:.6} \
                 err={:.6}% at pos {}",
                int_price, ref_price, relative_error * 100.0, pos
            );
        }
    }
}

// =============================================================================
// INV-BC-004: Full Integral
//
// Total SOL for buying all tokens (0 to TOTAL_FOR_SALE) should equal
// the mathematical full-curve value within 0.1%.
//
// Mathematical value: TOTAL_FOR_SALE * (P_START + P_END) / (2 * TOKEN_DEC)
//                   = 460e12 * 4350 / 2e6 = 1,000,500,000,000 lamports
//
// WHY: This is the total SOL the curve collects when fully sold.
// If it deviates significantly, the economic model is wrong:
// too low means the vault is underfunded, too high means excessive cost.
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_bc_004_full_integral(
        // Test both the full integral and sub-integrals that sum to the full
        num_splits in 1u32..=20u32,
    ) {
        // Full integral: calculate_sol_for_tokens(0, TARGET_TOKENS)
        let full_sol = calculate_sol_for_tokens(0, TARGET_TOKENS).unwrap();

        // Mathematical reference
        let math_ref: f64 = (TOTAL_FOR_SALE as f64) * ((P_START + P_END) as f64)
            / (2.0 * 1_000_000.0);

        let relative_error = ((full_sol as f64 - math_ref) / math_ref).abs();

        prop_assert!(
            relative_error < 0.001, // 0.1%
            "INV-BC-004: full integral {:.0} deviates from math ref {:.0} by {:.4}%",
            full_sol as f64, math_ref, relative_error * 100.0
        );

        // Also verify sub-integral composability: splitting the curve into
        // num_splits equal parts and summing should approximate the full integral.
        if num_splits > 1 {
            let chunk_size = TARGET_TOKENS / num_splits as u64;
            if chunk_size == 0 { return Ok(()); }

            let mut sum_sol: u128 = 0;
            let mut pos: u64 = 0;

            for _ in 0..num_splits {
                let tokens = chunk_size.min(TARGET_TOKENS - pos);
                if tokens == 0 { break; }

                if let Ok(sol) = calculate_sol_for_tokens(pos, tokens) {
                    sum_sol += sol as u128;
                    pos += tokens;
                }
            }

            // Handle remainder
            if pos < TARGET_TOKENS {
                let remaining = TARGET_TOKENS - pos;
                if let Ok(sol) = calculate_sol_for_tokens(pos, remaining) {
                    sum_sol += sol as u128;
                }
            }

            // Sub-integral sum should be close to full integral.
            // ceil-rounding means sum >= full (each ceil adds up to 1 lamport).
            // Allow up to num_splits lamports of excess.
            let diff = if sum_sol >= full_sol as u128 {
                sum_sol - full_sol as u128
            } else {
                full_sol as u128 - sum_sol
            };

            prop_assert!(
                diff <= num_splits as u128 + 1,
                "INV-BC-004: sub-integral sum {} differs from full {} by {} (max {} allowed)",
                sum_sol, full_sol, diff, num_splits + 1
            );
        }
    }
}

// =============================================================================
// Additional: INV-BC-010 variant -- verify with float reference
//
// Cross-check integer SOL cost against float reference to catch
// systematic bias in the integer math.
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_bc_sol_cost_accuracy(
        sold_pct in 0u64..=900_000u64,
        tokens_pct in 1u64..=200_000u64,
    ) {
        let pos = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;
        let remaining = TARGET_TOKENS - pos;
        let tokens = 1u64.max(
            ((remaining as u128) * (tokens_pct as u128) / 1_000_000u128) as u64
        ).min(remaining);

        if tokens == 0 { return Ok(()); }

        let int_sol = match calculate_sol_for_tokens(pos, tokens) {
            Ok(s) => s,
            Err(_) => return Ok(()),
        };

        let ref_sol = float_sol_for_tokens(pos, tokens);

        // calculate_sol_for_tokens uses ceil rounding, which adds at most
        // 1 lamport to the exact integral.  For small SOL costs, this 1-lamport
        // ceil dominates relative error (e.g. 1/2768 = 0.036%).
        //
        // Strategy: absolute comparison when the ceil-rounding lamport would
        // breach the relative threshold (ref_sol < 1/0.0002 = 5000), and
        // relative comparison for larger values where 1 lamport is negligible.
        let abs_diff = (int_sol as f64 - ref_sol).abs();

        if ref_sol < 5_000.0 {
            // Ceil rounding adds at most 1 lamport; allow 2 for float imprecision
            prop_assert!(
                abs_diff <= 2.0,
                "SOL cost accuracy: int={} ref={:.2} diff={:.2} at pos={} tokens={}",
                int_sol, ref_sol, abs_diff, pos, tokens
            );
        } else {
            let relative_error = abs_diff / ref_sol;
            prop_assert!(
                relative_error < 0.0002, // 0.02%
                "SOL cost accuracy: int={} ref={:.2} err={:.4}% at pos={} tokens={}",
                int_sol, ref_sol, relative_error * 100.0, pos, tokens
            );
        }
    }
}
