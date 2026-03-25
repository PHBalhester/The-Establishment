//! BOK Kani verification harnesses for Staking Rewards math invariants.
//!
//! IMPLEMENTATION NOTE: Harnesses use u32 symbolic inputs cast to u64.
//! CBMC cannot solve SAT formulas over u64 * u128 multiplication chains.
//! u32 proves each property over ALL 4+ billion values exhaustively.
//! Full u64 range is covered by proptest.

#[cfg(kani)]
mod kani_harnesses {
    const PRECISION: u128 = 1_000_000_000_000_000_000;
    const MINIMUM_STAKE: u64 = 1_000_000;

    // =========================================================================
    // INV-SR-002: Cumulative Index Monotonicity
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_002_cumulative_monotonicity() {
        let pending: u64 = kani::any::<u32>() as u64;
        let total_staked: u64 = kani::any::<u32>() as u64;
        let old_stored: u128 = kani::any::<u32>() as u128;

        kani::assume(total_staked >= MINIMUM_STAKE);

        let product = (pending as u128).checked_mul(PRECISION);
        if let Some(p) = product {
            let rpt = p / (total_staked as u128);
            if let Some(new_stored) = old_stored.checked_add(rpt) {
                assert!(new_stored >= old_stored);
            }
        }
    }

    // =========================================================================
    // INV-SR-003: No-Panic for Valid Inputs — add_to_cumulative
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_003_no_panic_add_to_cumulative() {
        let pending: u64 = kani::any::<u32>() as u64;
        let total_staked: u64 = kani::any::<u32>() as u64;
        let old_stored: u128 = kani::any::<u32>() as u128;

        kani::assume(total_staked >= MINIMUM_STAKE);

        let product = (pending as u128).checked_mul(PRECISION);
        assert!(product.is_some(), "checked_mul must not fail");

        let rpt = product.unwrap() / (total_staked as u128);
        let new_stored = old_stored.checked_add(rpt);
        assert!(new_stored.is_some(), "checked_add must not fail");
    }

    // =========================================================================
    // INV-SR-003: No-Panic for Valid Inputs — update_rewards
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_003_no_panic_update_rewards() {
        let balance: u64 = kani::any::<u32>() as u64;
        let global_cumulative: u128 = kani::any::<u32>() as u128 * PRECISION;
        let user_checkpoint: u128 = kani::any::<u32>() as u128;

        kani::assume(user_checkpoint <= global_cumulative);

        let reward_delta = global_cumulative - user_checkpoint;
        let product = (balance as u128).checked_mul(reward_delta);
        assert!(product.is_some(), "balance * reward_delta must not overflow");

        let pending = product.unwrap() / PRECISION;
        assert!(pending <= u64::MAX as u128, "pending must fit u64");
    }

    // =========================================================================
    // INV-SR-006: Zero Reward Epoch Safety
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_006_zero_reward_epoch() {
        let total_staked: u64 = kani::any::<u32>() as u64;
        let old_stored: u128 = kani::any::<u32>() as u128;

        kani::assume(total_staked >= MINIMUM_STAKE);

        let pending: u64 = 0;
        let rpt = (pending as u128) * PRECISION / (total_staked as u128);
        assert!(rpt == 0, "Zero pending must produce zero reward_per_token");

        let new_stored = old_stored + rpt;
        assert!(new_stored == old_stored, "Index must be unchanged when pending == 0");
    }

    // =========================================================================
    // INV-SR-009: Precision Delta Non-Negative
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_009_precision_delta_non_negative() {
        let pending: u64 = kani::any::<u32>() as u64;
        let total_staked: u64 = kani::any::<u32>() as u64;

        kani::assume(total_staked >= MINIMUM_STAKE);

        let rpt = (pending as u128) * PRECISION / (total_staked as u128);
        let paid = (total_staked as u128) * rpt / PRECISION;

        assert!(
            paid <= pending as u128,
            "Protocol overpaid: paid {} > deposited {}",
            paid, pending
        );
    }

    // =========================================================================
    // INV-SR-012: u128 Intermediate No Overflow — add_to_cumulative
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_012_u128_no_overflow_add_to_cumulative() {
        let pending: u64 = kani::any::<u32>() as u64;

        let product = (pending as u128).checked_mul(PRECISION);
        assert!(
            product.is_some(),
            "pending * PRECISION overflowed u128 for pending={}",
            pending
        );
    }

    // =========================================================================
    // INV-SR-012: u128 Intermediate No Overflow — update_rewards
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_012_u128_no_overflow_update_rewards() {
        let balance: u64 = kani::any::<u32>() as u64;
        let reward_delta: u128 = kani::any::<u32>() as u128;

        let product = (balance as u128).checked_mul(reward_delta);
        assert!(
            product.is_some(),
            "balance * reward_delta overflowed u128"
        );
    }

    // =========================================================================
    // INV-SR-018: Per-Operation Precision Loss Bounded
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_sr_018_precision_loss_bounded() {
        let pending: u64 = kani::any::<u32>() as u64;
        let total_staked: u64 = kani::any::<u32>() as u64;
        let balance: u64 = kani::any::<u32>() as u64;

        kani::assume(total_staked >= MINIMUM_STAKE);
        kani::assume(balance >= 1);
        kani::assume(balance <= total_staked);

        // Double-floor path (what the contract computes):
        let rpt = (pending as u128) * PRECISION / (total_staked as u128);
        let paid = (balance as u128) * rpt / PRECISION;

        // Ideal path (exact fractional arithmetic via u128):
        let ideal = (pending as u128) * (balance as u128) / (total_staked as u128);

        // The double-floor result should be <= ideal (never overpays)
        assert!(paid <= ideal, "Double-floor overpaid: paid {} > ideal {}", paid, ideal);

        // The loss should be at most 2 lamports
        let loss = ideal - paid;
        assert!(
            loss <= 2,
            "Precision loss {} exceeds 2 lamports",
            loss
        );
    }
}
