//! BOK Proptest Suite — Tax Distribution & Output Floor Invariants
//!
//! 100K-case property-based tests verifying tax math invariants.
//! Run with:
//!   cargo test -p tax-program --test bok_proptest -- --nocapture
//!
//! Invariants covered:
//!   INV-TAX-3  through INV-TAX-6  : calculate_tax properties
//!   INV-TAX-7  through INV-TAX-11 : split_distribution properties
//!   INV-TAX-13 through INV-TAX-17 : calculate_output_floor properties
//!   INV-TAX-19                     : Rounding dust accumulation bound
//!   INV-TAX-20                     : 71/24/5 split exact verification

use proptest::prelude::*;
use tax_program::helpers::tax_math::{calculate_output_floor, calculate_tax, split_distribution};

// =============================================================================
// Configuration: 100K cases per property
// =============================================================================

const CASES: u32 = 100_000;

// =============================================================================
// INV-TAX-7: Split Conservation
// =============================================================================
//
// staking + carnage + treasury == total_tax (exact, no lamport leakage)
// This is THE critical invariant — if violated, the protocol silently
// destroys or creates lamports on every swap.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_7_split_conservation(total in 0u64..=u64::MAX) {
        let (staking, carnage, treasury) = split_distribution(total)
            .expect("split_distribution must never return None");

        let sum = staking
            .checked_add(carnage)
            .and_then(|s| s.checked_add(treasury))
            .expect("sum overflow — impossible if conservation holds");

        prop_assert_eq!(
            sum, total,
            "INV-TAX-7: {} + {} + {} = {} != {}",
            staking, carnage, treasury, sum, total
        );
    }
}

// =============================================================================
// INV-TAX-8: Staking Exact 71%
// =============================================================================
//
// For total >= 4 (non-micro-tax), staking == floor(total * 7100 / 10000).
// Any deviation means the BPS constant was changed without updating tax_math.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_8_staking_exact_71_pct(total in 4u64..=u64::MAX) {
        let (staking, _, _) = split_distribution(total).unwrap();
        let expected = (total as u128 * 7_100 / 10_000) as u64;
        prop_assert_eq!(
            staking, expected,
            "INV-TAX-8: staking {} != floor({}*7100/10000) = {}",
            staking, total, expected
        );
    }
}

// =============================================================================
// INV-TAX-9: Carnage Exact 24%
// =============================================================================
//
// For total >= 4, carnage == floor(total * 2400 / 10000).
// Note: for total=4, carnage = floor(0.96) = 0, which is correct.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_9_carnage_exact_24_pct(total in 4u64..=u64::MAX) {
        let (_, carnage, _) = split_distribution(total).unwrap();
        let expected = (total as u128 * 2_400 / 10_000) as u64;
        prop_assert_eq!(
            carnage, expected,
            "INV-TAX-9: carnage {} != floor({}*2400/10000) = {}",
            carnage, total, expected
        );
    }
}

// =============================================================================
// INV-TAX-10: Treasury Dust Bounded
// =============================================================================
//
// Treasury = total - staking - carnage absorbs rounding dust.
// The ideal treasury is total * 500 / 10000 = 5%.
// Due to two floor() operations (staking + carnage), treasury can exceed
// ideal by at most 2 lamports (one from each floor).

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_10_treasury_dust_bounded(total in 4u64..=u64::MAX) {
        let (_, _, treasury) = split_distribution(total).unwrap();
        let ideal_treasury = (total as u128 * 500 / 10_000) as u64;
        let dust = treasury.saturating_sub(ideal_treasury);
        prop_assert!(
            dust <= 2,
            "INV-TAX-10: treasury dust {} exceeds 2 lamports (treasury={}, ideal={})",
            dust, treasury, ideal_treasury
        );
    }
}

// =============================================================================
// INV-TAX-3: Tax Monotonic with BPS
// =============================================================================
//
// For fixed amount, increasing bps must not decrease tax.
// Violation would allow gaming the tax rate ordering.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_3_monotonic_with_bps(
        amount in 1u64..=u64::MAX,
        bps_low in 0u16..=9999u16,
        bps_delta in 1u16..=500u16,
    ) {
        let bps_high = bps_low.saturating_add(bps_delta).min(10_000);

        let tax_low = calculate_tax(amount, bps_low).unwrap();
        let tax_high = calculate_tax(amount, bps_high).unwrap();

        prop_assert!(
            tax_low <= tax_high,
            "INV-TAX-3: tax({},{})={} > tax({},{})={}",
            amount, bps_low, tax_low, amount, bps_high, tax_high
        );
    }
}

// =============================================================================
// INV-TAX-4: Invalid BPS Rejected
// =============================================================================
//
// bps > 10000 must return None. Accepting >100% tax would drain users.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_4_invalid_bps_rejected(
        amount in 0u64..=u64::MAX,
        bps in 10001u16..=u16::MAX,
    ) {
        let result = calculate_tax(amount, bps);
        prop_assert!(
            result.is_none(),
            "INV-TAX-4: calculate_tax({}, {}) = {:?}, expected None",
            amount, bps, result
        );
    }
}

// =============================================================================
// INV-TAX-5: Floor Division Zero-Tax Threshold
// =============================================================================
//
// When amount * bps < 10000, floor division produces 0 tax.
// This verifies the threshold behavior is consistent.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_5_floor_division_zero_threshold(
        amount in 1u64..=9999u64,
        bps in 1u16..=9999u16,
    ) {
        let product = amount as u128 * bps as u128;
        let tax = calculate_tax(amount, bps).unwrap();
        if product < 10_000 {
            prop_assert_eq!(
                tax, 0,
                "INV-TAX-5: amount*bps={} < 10000 but tax={} (should be 0)",
                product, tax
            );
        } else {
            prop_assert!(
                tax >= 1,
                "INV-TAX-5: amount*bps={} >= 10000 but tax=0",
                product
            );
        }
    }
}

// =============================================================================
// INV-TAX-6: u128 Prevents Overflow
// =============================================================================
//
// calculate_tax must return Some for ALL valid inputs (bps <= 10000).
// None would mean overflow in u128 math — which is impossible since
// max intermediate = u64::MAX * 10000 < u128::MAX.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_6_u128_prevents_overflow(
        amount in 0u64..=u64::MAX,
        bps in 0u16..=10000u16,
    ) {
        let result = calculate_tax(amount, bps);
        prop_assert!(
            result.is_some(),
            "INV-TAX-6: calculate_tax({}, {}) returned None for valid bps",
            amount, bps
        );
    }
}

// =============================================================================
// INV-TAX-11: Micro-Tax Rule
// =============================================================================
//
// total < 4 => split = (total, 0, 0). All micro-tax goes to staking
// to avoid splitting dust across three accounts (rent overhead).

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_11_micro_tax_rule(total in 0u64..4u64) {
        let (staking, carnage, treasury) = split_distribution(total).unwrap();
        prop_assert_eq!(staking, total, "INV-TAX-11: micro-tax staking != total");
        prop_assert_eq!(carnage, 0, "INV-TAX-11: micro-tax carnage != 0");
        prop_assert_eq!(treasury, 0, "INV-TAX-11: micro-tax treasury != 0");
    }
}

// =============================================================================
// INV-TAX-13: split_distribution Never Returns None
// =============================================================================
//
// For ALL u64 inputs, split_distribution must return Some.
// None would mean checked arithmetic failed — which should be impossible
// since treasury = total - staking - carnage and both are <= total.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_13_split_never_none(total in 0u64..=u64::MAX) {
        let result = split_distribution(total);
        prop_assert!(
            result.is_some(),
            "INV-TAX-13: split_distribution({}) returned None",
            total
        );
    }
}

// =============================================================================
// INV-TAX-14: Output Floor <= Expected
// =============================================================================
//
// The floor must never exceed the expected constant-product output.
// If it did, the "minimum acceptable" would be unreachable, blocking swaps.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_14_output_floor_lte_expected(
        reserve_in in 1u64..=1_000_000_000_000u64,
        reserve_out in 1u64..=1_000_000_000_000u64,
        amount_in in 1u64..=1_000_000_000u64,
        floor_bps in 0u64..=10000u64,
    ) {
        let floor = calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps)
            .expect("calculate_output_floor should not overflow");

        // Recompute expected output
        let expected = {
            let num = reserve_out as u128 * amount_in as u128;
            let den = reserve_in as u128 + amount_in as u128;
            (num / den) as u64
        };

        prop_assert!(
            floor <= expected,
            "INV-TAX-14: floor {} > expected {} (bps={})",
            floor, expected, floor_bps
        );
    }
}

// =============================================================================
// INV-TAX-15: Zero-Input Floor Safety
// =============================================================================
//
// If any of reserve_in, reserve_out, amount_in is 0, floor must be 0.
// Prevents division by zero and nonsensical floors on empty pools.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_15_zero_input_floor_safety(
        reserve_in in 0u64..=1_000_000_000u64,
        reserve_out in 0u64..=1_000_000_000u64,
        amount_in in 0u64..=1_000_000_000u64,
        floor_bps in 0u64..=10000u64,
    ) {
        if reserve_in == 0 || reserve_out == 0 || amount_in == 0 {
            let floor = calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps)
                .expect("should not overflow on zero inputs");
            prop_assert_eq!(
                floor, 0,
                "INV-TAX-15: floor={} but an input is 0 (ri={}, ro={}, ai={})",
                floor, reserve_in, reserve_out, amount_in
            );
        }
    }
}

// =============================================================================
// INV-TAX-16: Floor Monotonicity with BPS
// =============================================================================
//
// For fixed pool state and amount, increasing floor_bps must not decrease
// the floor. Otherwise higher "slippage tolerance" gives worse protection.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_16_floor_monotonic_with_bps(
        reserve_in in 1u64..=1_000_000_000_000u64,
        reserve_out in 1u64..=1_000_000_000_000u64,
        amount_in in 1u64..=1_000_000_000u64,
        bps_low in 0u64..=9999u64,
        bps_delta in 1u64..=500u64,
    ) {
        let bps_high = (bps_low + bps_delta).min(10_000);

        let floor_low = calculate_output_floor(reserve_in, reserve_out, amount_in, bps_low)
            .expect("should not overflow");
        let floor_high = calculate_output_floor(reserve_in, reserve_out, amount_in, bps_high)
            .expect("should not overflow");

        prop_assert!(
            floor_low <= floor_high,
            "INV-TAX-16: floor({})={} > floor({})={}",
            bps_low, floor_low, bps_high, floor_high
        );
    }
}

// =============================================================================
// INV-TAX-17: floor_bps Unvalidated (Document Behavior)
// =============================================================================
//
// calculate_output_floor does NOT reject floor_bps > 10000.
// This is by design — the function is internal, and callers
// (swap_sol_buy/sell) enforce MINIMUM_OUTPUT_FLOOR_BPS.
//
// This test documents that floor_bps > 10000 produces a value > expected
// output (mathematically: floor = expected * bps / 10000, so bps > 10000
// gives floor > expected). It's NOT a vulnerability because callers
// never pass >10000.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn inv_tax_17_floor_bps_unvalidated_behavior(
        reserve_in in 1u64..=1_000_000_000u64,
        reserve_out in 1u64..=1_000_000_000u64,
        amount_in in 1u64..=100_000_000u64,
        floor_bps in 10001u64..=20000u64,
    ) {
        // Should not panic or return None — just produces a value > expected
        let result = calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps);
        prop_assert!(
            result.is_some(),
            "INV-TAX-17: calculate_output_floor returned None for bps={} (not a validation error, just overflow)",
            floor_bps
        );
        // The result may exceed expected output — that's documented behavior,
        // not a bug. The function trusts its caller.
    }
}

// =============================================================================
// INV-TAX-19: Rounding Dust Accumulation Bound
// =============================================================================
//
// Over N consecutive split_distribution calls, cumulative treasury dust
// (above ideal 5%) is bounded by N * 2 lamports. This ensures long-term
// treasury doesn't receive significantly more than its share.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]  // Fewer cases since inner loop is 100

    #[test]
    fn inv_tax_19_rounding_dust_accumulation_bound(
        base_total in 4u64..=10_000_000u64,
        delta_seed in prop::array::uniform10(0u64..1000u64),
    ) {
        let mut cumulative_dust: u64 = 0;
        let n: u64 = 10; // 10 consecutive calls per test case

        for i in 0..n as usize {
            let total = base_total.saturating_add(delta_seed[i]);
            if total < 4 { continue; } // skip micro-tax

            let (_, _, treasury) = split_distribution(total).unwrap();
            let ideal = (total as u128 * 500 / 10_000) as u64;
            cumulative_dust += treasury.saturating_sub(ideal);
        }

        prop_assert!(
            cumulative_dust <= n * 2,
            "INV-TAX-19: cumulative dust {} exceeds N*2={} bound",
            cumulative_dust, n * 2
        );
    }
}

// =============================================================================
// INV-TAX-20: 71/24/5 Split Verification (Deterministic)
// =============================================================================
//
// For total=10000, split must produce exactly (7100, 2400, 500).
// This is the canonical test that the BPS constants are correct.

#[test]
fn inv_tax_20_canonical_split_verification() {
    let result = split_distribution(10_000);
    assert_eq!(
        result,
        Some((7_100, 2_400, 500)),
        "INV-TAX-20: split_distribution(10000) must produce (7100, 2400, 500)"
    );

    // Also verify at 100 (scaling test)
    // floor(100*7100/10000) = 71, floor(100*2400/10000) = 24, remainder = 5
    let result_100 = split_distribution(100);
    assert_eq!(
        result_100,
        Some((71, 24, 5)),
        "INV-TAX-20: split_distribution(100) must produce (71, 24, 5)"
    );

    // And at 1_000_000 (realistic tax amount)
    // floor(1M*7100/10000) = 710000, floor(1M*2400/10000) = 240000, remainder = 50000
    let result_1m = split_distribution(1_000_000);
    assert_eq!(
        result_1m,
        Some((710_000, 240_000, 50_000)),
        "INV-TAX-20: split_distribution(1M) must produce (710000, 240000, 50000)"
    );
}
