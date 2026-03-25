//! BOK Proptest verification suite for AMM swap math.
//!
//! 100,000 cases per property (10x upgrade from the 10K in-crate tests).
//!
//! Invariants verified:
//! - INV-AMM-001: k-Invariant Preservation (k_after >= k_before)
//! - INV-AMM-004: Fee Monotonicity (higher fee_bps -> less effective input)
//! - INV-AMM-005: Swap Output Monotonic (input_a <= input_b => output_a <= output_b)
//! - INV-AMM-008: k-Check Symmetry (verify_k_invariant same regardless of A/B designation)
//! - INV-AMM-009: Zero-Fee Precision Loss (small amounts with fee round to 0)
//! - INV-AMM-009b: Zero-Output Rejection (effective_input > 0 AND output == 0 caught)
//! - INV-AMM-010: Fee Rounding Favors Protocol (floor division -> fee rounds UP)
//! - INV-AMM-011: Swap Output Rounding Favors Protocol (floor on output)
//!
//! Run: `cargo test --test bok_proptest -- --nocapture`

use amm::helpers::math::*;
use proptest::prelude::*;

// =============================================================================
// Strategies
// =============================================================================

/// Pool reserve values: 90% realistic, 10% edge cases.
fn reserve_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        9 => 1u64..=1_000_000_000_000_000_000u64,
        1 => prop::sample::select(vec![0u64, 1, u64::MAX, u64::MAX / 2]),
    ]
}

/// Swap input amounts: 90% realistic, 10% edges.
fn swap_amount_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        9 => 1u64..=100_000_000_000_000_000u64,
        1 => prop::sample::select(vec![0u64, 1, u64::MAX, u64::MAX / 2]),
    ]
}

/// Fee basis points: 70% valid range, 20% protocol fee (50 bps), 10% protocol fee (100 bps).
fn fee_bps_strategy() -> impl Strategy<Value = u16> {
    prop_oneof![
        7 => 0u16..=9999u16,
        2 => Just(50u16),
        1 => Just(100u16),
    ]
}

/// Non-zero reserve strategy for tests that need valid pool state.
fn nonzero_reserve_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        9 => 1u64..=1_000_000_000_000_000_000u64,
        1 => prop::sample::select(vec![1u64, u64::MAX, u64::MAX / 2]),
    ]
}

/// Non-zero swap amount strategy (excludes 0 to avoid prop_assume rejection).
fn nonzero_swap_amount_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        9 => 1u64..=100_000_000_000_000_000u64,
        1 => prop::sample::select(vec![1u64, u64::MAX, u64::MAX / 2]),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    // =========================================================================
    // INV-AMM-001: k-Invariant Preservation
    //
    // For any valid swap through calculate_effective_input + calculate_swap_output,
    // the constant product k = reserve_in * reserve_out must not decrease.
    // k_after >= k_before because:
    //   1. Fee deduction reduces effective_input below amount_in
    //   2. Integer truncation on output means pool keeps dust
    //   3. Both effects strictly increase k (or keep it equal at zero-fee edge)
    //
    // Upgraded from 10K to 100K cases.
    // =========================================================================
    #[test]
    fn inv_amm_001_k_invariant_preservation(
        reserve_in in nonzero_reserve_strategy(),
        reserve_out in nonzero_reserve_strategy(),
        amount_in in nonzero_swap_amount_strategy(),
        fee_bps in fee_bps_strategy(),
    ) {

        let effective = match calculate_effective_input(amount_in, fee_bps) {
            Some(e) => e,
            None => return Ok(()),
        };

        let output = match calculate_swap_output(reserve_in, reserve_out, effective) {
            Some(o) => o,
            None => return Ok(()),
        };

        // Output must not drain the pool
        prop_assume!(output < reserve_out);

        // New reserves after swap: amount_in (pre-fee) added to input side
        let new_reserve_in = match reserve_in.checked_add(amount_in) {
            Some(r) => r,
            None => return Ok(()),
        };
        let new_reserve_out = reserve_out - output;

        let k_ok = verify_k_invariant(
            reserve_in, reserve_out,
            new_reserve_in, new_reserve_out,
        );

        prop_assert_eq!(
            k_ok,
            Some(true),
            "INV-AMM-001: k-invariant violated! \
             reserve_in={}, reserve_out={}, amount_in={}, fee_bps={}, \
             effective={}, output={}, new_in={}, new_out={}",
            reserve_in, reserve_out, amount_in, fee_bps,
            effective, output, new_reserve_in, new_reserve_out
        );
    }

    // =========================================================================
    // INV-AMM-004: Fee Monotonicity
    //
    // For the same amount_in, a higher fee_bps must produce a lower-or-equal
    // effective input. This prevents fee-tier gaming.
    //
    // Proof sketch: effective = amount * (10000 - fee) / 10000.
    // If fee_high > fee_low, then (10000 - fee_high) < (10000 - fee_low),
    // so effective_high <= effective_low. QED.
    //
    // Upgraded from 10K to 100K cases.
    // =========================================================================
    #[test]
    fn inv_amm_004_fee_monotonicity(
        amount_in in swap_amount_strategy(),
        fee_bps_low in 0u16..=9999u16,
        fee_bps_delta in 0u16..=500u16,
    ) {
        let fee_bps_high = fee_bps_low.saturating_add(fee_bps_delta).min(10000);

        if let (Some(effective_low), Some(effective_high)) = (
            calculate_effective_input(amount_in, fee_bps_low),
            calculate_effective_input(amount_in, fee_bps_high),
        ) {
            prop_assert!(
                effective_low >= effective_high,
                "INV-AMM-004: Fee monotonicity violated! \
                 amount_in={}, fee_low={} -> {}, fee_high={} -> {}",
                amount_in, fee_bps_low, effective_low, fee_bps_high, effective_high
            );
        }
    }

    // =========================================================================
    // INV-AMM-005: Swap Output Monotonic
    //
    // For fixed reserves and fee, a larger input must produce a larger-or-equal
    // output. This prevents the perverse case where swapping MORE tokens gives
    // you LESS output.
    //
    // Proof sketch: output = R_out * eff / (R_in + eff). As eff increases,
    // the fraction eff / (R_in + eff) increases monotonically (derivative > 0
    // for R_in > 0). Integer truncation preserves weak monotonicity (<=).
    // =========================================================================
    #[test]
    fn inv_amm_005_swap_output_monotonic(
        reserve_in in nonzero_reserve_strategy(),
        reserve_out in nonzero_reserve_strategy(),
        amount_a in nonzero_swap_amount_strategy(),
        amount_delta in 0u64..=1_000_000_000u64,
        fee_bps in fee_bps_strategy(),
    ) {
        let amount_b = amount_a.saturating_add(amount_delta);

        let eff_a = match calculate_effective_input(amount_a, fee_bps) {
            Some(e) => e,
            None => return Ok(()),
        };
        let eff_b = match calculate_effective_input(amount_b, fee_bps) {
            Some(e) => e,
            None => return Ok(()),
        };

        let out_a = match calculate_swap_output(reserve_in, reserve_out, eff_a) {
            Some(o) => o,
            None => return Ok(()),
        };
        let out_b = match calculate_swap_output(reserve_in, reserve_out, eff_b) {
            Some(o) => o,
            None => return Ok(()),
        };

        prop_assert!(
            out_b >= out_a,
            "INV-AMM-005: Swap output monotonicity violated! \
             amount_a={} -> out_a={}, amount_b={} -> out_b={}, \
             reserve_in={}, reserve_out={}, fee_bps={}",
            amount_a, out_a, amount_b, out_b,
            reserve_in, reserve_out, fee_bps
        );
    }

    // =========================================================================
    // INV-AMM-008: k-Check Symmetry
    //
    // verify_k_invariant(a, b, c, d) must produce the same result as
    // verify_k_invariant(b, a, d, c) -- swapping which token is "in" vs "out"
    // must not change the k-invariant verdict.
    //
    // This holds because k = a*b = b*a (multiplication is commutative).
    // =========================================================================
    #[test]
    fn inv_amm_008_k_check_symmetry(
        r_in_before in reserve_strategy(),
        r_out_before in reserve_strategy(),
        r_in_after in reserve_strategy(),
        r_out_after in reserve_strategy(),
    ) {
        let result_ab = verify_k_invariant(
            r_in_before, r_out_before,
            r_in_after, r_out_after,
        );
        let result_ba = verify_k_invariant(
            r_out_before, r_in_before,
            r_out_after, r_in_after,
        );

        prop_assert_eq!(
            result_ab, result_ba,
            "INV-AMM-008: k-check symmetry violated! \
             ({},{} -> {},{}) gave {:?} vs ({},{} -> {},{}) gave {:?}",
            r_in_before, r_out_before, r_in_after, r_out_after, result_ab,
            r_out_before, r_in_before, r_out_after, r_in_after, result_ba
        );
    }

    // =========================================================================
    // INV-AMM-009: Zero-Fee Precision Loss
    //
    // When amount_in * (10000 - fee_bps) < 10000, integer division truncates
    // effective_input to 0. This is the "fee ate everything" case.
    //
    // Specifically: for fee_bps in [1, 9999], effective == 0 iff
    //   amount_in < ceil(10000 / (10000 - fee_bps))
    //
    // We verify that check_effective_input_nonzero correctly detects this.
    // =========================================================================
    #[test]
    fn inv_amm_009_zero_fee_precision_loss(
        fee_bps in 1u16..=9999u16,
    ) {
        // For a given fee_bps, find the threshold amount where effective becomes 0.
        // effective = amount * (10000 - fee_bps) / 10000
        // effective == 0 when amount * (10000 - fee_bps) < 10000
        // i.e., amount < 10000 / (10000 - fee_bps)
        // For fee_bps=100: amount < 10000/9900 = 1.0101... -> amount=1 gives 0
        // For fee_bps=9999: amount < 10000/1 = 10000 -> amount < 10000 gives 0
        let fee_factor = 10000u64 - fee_bps as u64;

        // The smallest amount that produces nonzero effective input
        // is ceil(10000 / fee_factor).
        let threshold = (10000u64 + fee_factor - 1) / fee_factor;

        // Below threshold: effective must be 0
        if threshold > 1 {
            let small_amount = threshold - 1;
            let effective = calculate_effective_input(small_amount, fee_bps).unwrap();
            prop_assert_eq!(
                effective, 0u128,
                "INV-AMM-009: Expected effective=0 for amount={}, fee_bps={}, got {}",
                small_amount, fee_bps, effective
            );

            // check_effective_input_nonzero must return false (fee ate everything)
            let safe = check_effective_input_nonzero(small_amount, effective);
            prop_assert!(
                !safe,
                "INV-AMM-009: check_effective_input_nonzero should return false \
                 for amount={}, effective=0",
                small_amount
            );
        }

        // At threshold: effective must be > 0
        if threshold <= u64::MAX {
            let effective = calculate_effective_input(threshold, fee_bps).unwrap();
            prop_assert!(
                effective > 0,
                "INV-AMM-009: Expected effective>0 at threshold={}, fee_bps={}, got 0",
                threshold, fee_bps
            );
        }
    }

    // =========================================================================
    // INV-AMM-009b: Zero-Output Rejection
    //
    // When effective_input > 0 but calculate_swap_output returns 0 (because
    // reserves are enormous relative to input), check_swap_output_nonzero
    // must return false to prevent the user from burning tokens for nothing.
    // =========================================================================
    #[test]
    fn inv_amm_009b_zero_output_rejection(
        reserve_in in nonzero_reserve_strategy(),
        reserve_out in nonzero_reserve_strategy(),
        amount_in in 1u64..=100u64, // tiny amounts
        fee_bps in fee_bps_strategy(),
    ) {
        let effective = match calculate_effective_input(amount_in, fee_bps) {
            Some(e) if e > 0 => e,
            _ => return Ok(()), // skip if fee ate everything
        };

        let output = match calculate_swap_output(reserve_in, reserve_out, effective) {
            Some(o) => o,
            None => return Ok(()),
        };

        if output == 0 {
            // effective > 0 but output == 0: check_swap_output_nonzero must catch this
            let safe = check_swap_output_nonzero(effective, output);
            prop_assert!(
                !safe,
                "INV-AMM-009b: check_swap_output_nonzero should return false \
                 when effective={} > 0 but output=0",
                effective
            );
        } else {
            // output > 0: check should pass
            let safe = check_swap_output_nonzero(effective, output);
            prop_assert!(
                safe,
                "INV-AMM-009b: check_swap_output_nonzero should return true \
                 when effective={} and output={}",
                effective, output
            );
        }
    }

    // =========================================================================
    // INV-AMM-010: Fee Rounding Favors Protocol
    //
    // The fee is computed via floor division: effective = amount * factor / 10000.
    // Floor division means the user gets LESS effective input (rounded down),
    // which means the FEE is rounded UP. The protocol always keeps the dust.
    //
    // Formally: actual_fee = amount_in - effective >= ideal_fee
    // where ideal_fee = amount_in * fee_bps / 10000 (exact rational).
    //
    // We verify: effective <= amount_in * (10000 - fee_bps) / 10000 (exact rational)
    // Since we can't do exact rational in Rust, we check:
    //   effective * 10000 <= amount_in * (10000 - fee_bps)
    // This must always hold (floor division property).
    // =========================================================================
    #[test]
    fn inv_amm_010_fee_rounding_favors_protocol(
        amount_in in swap_amount_strategy(),
        fee_bps in 0u16..=10000u16,
    ) {
        if let Some(effective) = calculate_effective_input(amount_in, fee_bps) {
            let amount = amount_in as u128;
            let fee_factor = 10000u128.saturating_sub(fee_bps as u128);

            // effective * 10000 <= amount_in * (10000 - fee_bps)
            // This is the floor division property: floor(a*b/c) * c <= a*b
            let lhs = effective.checked_mul(10000u128);
            let rhs = amount.checked_mul(fee_factor);

            if let (Some(lhs_val), Some(rhs_val)) = (lhs, rhs) {
                prop_assert!(
                    lhs_val <= rhs_val,
                    "INV-AMM-010: Fee rounding does NOT favor protocol! \
                     amount_in={}, fee_bps={}, effective={}, \
                     effective*10000={} > amount*(10000-fee)={}",
                    amount_in, fee_bps, effective, lhs_val, rhs_val
                );
            }
        }
    }

    // =========================================================================
    // INV-AMM-011: Swap Output Rounding Favors Protocol
    //
    // calculate_swap_output uses floor division: output = num / denom.
    // Floor means the user gets LESS output, protocol keeps the dust.
    //
    // Formally: output * denominator <= numerator
    // i.e., output * (reserve_in + effective) <= reserve_out * effective
    // =========================================================================
    #[test]
    fn inv_amm_011_swap_output_rounding_favors_protocol(
        reserve_in in nonzero_reserve_strategy(),
        reserve_out in nonzero_reserve_strategy(),
        effective_input_raw in 1u64..=1_000_000_000_000_000_000u64,
    ) {
        let effective = effective_input_raw as u128;

        if let Some(output) = calculate_swap_output(reserve_in, reserve_out, effective) {
            let r_in = reserve_in as u128;
            let r_out = reserve_out as u128;
            let out = output as u128;

            let denominator = r_in.checked_add(effective);
            let numerator = r_out.checked_mul(effective);

            if let (Some(denom), Some(numer)) = (denominator, numerator) {
                // Floor division property: output * denom <= numer
                if let Some(lhs) = out.checked_mul(denom) {
                    prop_assert!(
                        lhs <= numer,
                        "INV-AMM-011: Swap output rounding does NOT favor protocol! \
                         reserve_in={}, reserve_out={}, effective={}, output={}, \
                         output*denom={} > numer={}",
                        reserve_in, reserve_out, effective, output, lhs, numer
                    );
                }
            }
        }
    }
}
