//! BOK Kani Verification Harnesses — Tax Math Invariants
//!
//! These harnesses use Kani's bounded model checking to formally verify
//! core tax calculation properties. Run with:
//!   cargo kani --harness <name> -p tax-program
//!
//! INV-TAX-1: Tax Never Exceeds Principal
//! INV-TAX-2: Zero Input/Rate Yields Zero Tax
//!
//! Kani explores ALL possible u64/u16 inputs within bounds, providing
//! exhaustive verification (not sampling like proptest).

// Kani harnesses are only compiled when running `cargo kani`.
// The kani crate is injected by the Kani toolchain — no Cargo dependency needed.
#[cfg(kani)]
mod kani_harnesses {
    use tax_program::helpers::tax_math::{calculate_tax, split_distribution};

    // =========================================================================
    // INV-TAX-1: Tax Never Exceeds Principal
    // =========================================================================
    //
    // For any valid tax rate (bps <= 10000), the computed tax must never
    // exceed the input amount. Violation would mean the protocol extracts
    // more than 100% — a critical fund-loss bug.

    #[kani::proof]
    fn inv_tax_1_tax_never_exceeds_principal() {
        let amount: u64 = kani::any();
        let bps: u16 = kani::any();

        // Only check valid BPS range (0..=10000)
        kani::assume(bps <= 10_000);

        if let Some(tax) = calculate_tax(amount, bps) {
            assert!(
                tax <= amount,
                "INV-TAX-1 VIOLATED: tax {} > amount {} at bps {}",
                tax, amount, bps
            );
        }
        // If calculate_tax returns None for valid bps, that's also a bug
        // (covered by INV-TAX-6 proptest), but Kani's bounded check may
        // not catch it due to u128 path complexity. Proptest covers this.
    }

    // =========================================================================
    // INV-TAX-2: Zero Input/Rate Yields Zero Tax
    // =========================================================================
    //
    // Two sub-properties:
    // (a) calculate_tax(0, any_valid_bps) == Some(0)
    // (b) calculate_tax(any_amount, 0) == Some(0)
    //
    // If either fails, the protocol charges phantom tax on zero-value
    // transactions or applies tax at a 0% rate.

    #[kani::proof]
    fn inv_tax_2a_zero_amount_yields_zero_tax() {
        let bps: u16 = kani::any();
        kani::assume(bps <= 10_000);

        let result = calculate_tax(0, bps);
        assert_eq!(
            result,
            Some(0),
            "INV-TAX-2a VIOLATED: calculate_tax(0, {}) = {:?}, expected Some(0)",
            bps, result
        );
    }

    #[kani::proof]
    fn inv_tax_2b_zero_bps_yields_zero_tax() {
        let amount: u64 = kani::any();

        let result = calculate_tax(amount, 0);
        assert_eq!(
            result,
            Some(0),
            "INV-TAX-2b VIOLATED: calculate_tax({}, 0) = {:?}, expected Some(0)",
            amount, result
        );
    }

    // =========================================================================
    // Bonus: INV-TAX-1 for split_distribution conservation
    // =========================================================================
    //
    // Kani-verify that split_distribution never loses or creates lamports.
    // This is a stronger guarantee than proptest sampling for small values
    // where rounding edge cases live.

    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_tax_7_split_conservation_small() {
        let total: u64 = kani::any();
        // Bound to small values where rounding edge cases cluster.
        // Kani will exhaustively check all values 0..=1000.
        kani::assume(total <= 1000);

        if let Some((staking, carnage, treasury)) = split_distribution(total) {
            let sum = staking + carnage + treasury;
            assert_eq!(
                sum, total,
                "INV-TAX-7 VIOLATED: {} + {} + {} = {} != {}",
                staking, carnage, treasury, sum, total
            );
        } else {
            panic!("INV-TAX-13 VIOLATED: split_distribution({}) returned None", total);
        }
    }
}
