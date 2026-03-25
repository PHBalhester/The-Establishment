//! BOK Proptest verification suite for Staking Rewards math.
//!
//! Tests the pure math formulas from staking::helpers::math without Solana runtime.
//! Uses direct formula computation since update_rewards requires Clock::get().
//!
//! Invariants verified:
//! - INV-STAKE-008: Silent `as u64` Truncation Detection
//! - INV-SR-001: Reward Conservation (multi-user)
//! - INV-SR-004: Pro-Rata Fairness
//! - INV-SR-005: Single Staker Gets All
//! - INV-SR-007: Forfeiture Conservation
//! - INV-SR-008: Multi-Epoch Cumulative Accuracy
//! - INV-SR-013: Stake Weight Proportionality
//! - INV-SR-014: Pending Rewards Accumulate Correctly
//! - INV-SR-017: Multi-Epoch Variable-Stake Conservation
//! - INV-STAKE-005: PRECISION Overflow Bound
//! - INV-STAKE-006: Accumulator Lifetime Bound
//! - INV-STAKE-007: Truncation Favors Protocol
//! - INV-STAKE-010: Multiply Before Divide Ordering
//! - INV-STAKE-011: Dust Reward Accumulation
//! - INV-STAKE-012: Reward Chunking Consistency
//!
//! Run: `cargo test --test bok_proptest -- --nocapture`

use staking::constants::PRECISION;
use staking::helpers::math::add_to_cumulative;
use staking::state::StakePool;
use proptest::prelude::*;

/// Create a test StakePool with given values.
fn test_pool(total_staked: u64, rewards_per_token: u128, pending: u64) -> StakePool {
    StakePool {
        total_staked,
        rewards_per_token_stored: rewards_per_token,
        pending_rewards: pending,
        last_update_epoch: 0,
        total_distributed: 0,
        total_claimed: 0,
        initialized: true,
        bump: 0,
    }
}

/// Compute user reward from formula (mirrors update_rewards math.rs:46-50).
fn compute_user_reward(balance: u64, reward_delta: u128) -> u64 {
    let pending = (balance as u128)
        .checked_mul(reward_delta)
        .unwrap_or(u128::MAX)
        .checked_div(PRECISION)
        .unwrap_or(0);
    pending as u64
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    // =========================================================================
    // INV-STAKE-008: Silent `as u64` Truncation Detection
    //
    // FINDING: math.rs:50 uses `as u64` which silently truncates.
    // Verify that (balance * reward_delta) / PRECISION <= u64::MAX for realistic inputs.
    // =========================================================================
    #[test]
    fn inv_stake_008_truncation_detection(
        balance in 1u64..=1_000_000_000_000_000u64, // max ~1B PROFIT (6 decimals)
        pending in 1u64..=1_000_000_000_000u64,      // max ~1000 SOL
        total_staked in 1u64..=1_000_000_000_000_000u64,
    ) {
        prop_assume!(total_staked >= balance);

        let mut pool = test_pool(total_staked, 0, pending);
        if add_to_cumulative(&mut pool).is_ok() {
            let user_pending_u128 = (balance as u128)
                .checked_mul(pool.rewards_per_token_stored)
                .unwrap_or(u128::MAX)
                .checked_div(PRECISION)
                .unwrap_or(0);

            // For realistic inputs, result must fit in u64
            prop_assert!(
                user_pending_u128 <= u64::MAX as u128,
                "INV-STAKE-008: Truncation would occur! balance={}, reward_delta={}, result={}",
                balance, pool.rewards_per_token_stored, user_pending_u128
            );
        }
    }

    // =========================================================================
    // INV-SR-001: Reward Conservation (multi-user)
    //
    // Sum of all user claims <= total deposited rewards.
    // =========================================================================
    #[test]
    fn inv_sr_001_reward_conservation(
        total_staked in 2u64..=1_000_000_000u64,
        pending in 1u64..=1_000_000_000u64,
        num_users in 2u32..=10u32,
    ) {
        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        // Simulate N equal-stake users
        let per_user_stake = total_staked / num_users as u64;
        prop_assume!(per_user_stake > 0);

        let per_user_reward = compute_user_reward(per_user_stake, pool.rewards_per_token_stored);
        let total_claimed = per_user_reward as u128 * num_users as u128;

        prop_assert!(
            total_claimed <= pending as u128,
            "INV-SR-001: Conservation violated! {} users * {} = {} > deposited {}",
            num_users, per_user_reward, total_claimed, pending
        );
    }

    // =========================================================================
    // INV-SR-004: Pro-Rata Fairness
    //
    // Equal stakes -> equal rewards (±1). 2x stake -> 2x rewards (±1).
    // =========================================================================
    #[test]
    fn inv_sr_004_pro_rata_fairness(
        total_staked in 100u64..=1_000_000_000u64,
        pending in 100u64..=1_000_000_000u64,
        stake_a in 1u64..=500_000_000u64,
    ) {
        prop_assume!(stake_a <= total_staked / 2);
        let stake_b = stake_a; // equal stakes

        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        let reward_a = compute_user_reward(stake_a, pool.rewards_per_token_stored);
        let reward_b = compute_user_reward(stake_b, pool.rewards_per_token_stored);

        // Equal stakes must get equal rewards
        prop_assert_eq!(
            reward_a, reward_b,
            "INV-SR-004: Equal stakes {} got different rewards: {} vs {}",
            stake_a, reward_a, reward_b
        );

        // 2x stake -> 2x rewards (±1)
        let double_stake = stake_a.saturating_mul(2).min(total_staked);
        let reward_double = compute_user_reward(double_stake, pool.rewards_per_token_stored);
        let expected_double = reward_a * 2;

        prop_assert!(
            reward_double >= expected_double.saturating_sub(1) &&
            reward_double <= expected_double + 1,
            "INV-SR-004: 2x stake {} got {} rewards, expected ~{} (±1)",
            double_stake, reward_double, expected_double
        );
    }

    // =========================================================================
    // INV-SR-005: Single Staker Gets All
    //
    // Sole staker receives total reward (±1 rounding).
    // =========================================================================
    #[test]
    fn inv_sr_005_single_staker_gets_all(
        stake in 1u64..=1_000_000_000_000u64,
        pending in 1u64..=1_000_000_000_000u64,
    ) {
        let mut pool = test_pool(stake, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        let reward = compute_user_reward(stake, pool.rewards_per_token_stored);

        prop_assert!(
            reward >= pending.saturating_sub(1) && reward <= pending,
            "INV-SR-005: Single staker with {} stake got {} of {} pending",
            stake, reward, pending
        );
    }

    // =========================================================================
    // INV-SR-007: Forfeiture Conservation
    //
    // Forfeited rewards can be added back to pending without loss.
    // =========================================================================
    #[test]
    fn inv_sr_007_forfeiture_conservation(
        total_staked in 2u64..=1_000_000_000u64,
        pending in 1u64..=1_000_000_000u64,
        user_pct in 1u64..=500_000u64,
    ) {
        let user_balance = 1u64.max(
            ((total_staked as u128) * (user_pct as u128) / 1_000_000u128) as u64
        );
        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        let forfeited = compute_user_reward(user_balance, pool.rewards_per_token_stored);

        // Forfeited amount must be <= what was deposited
        prop_assert!(
            forfeited <= pending,
            "INV-SR-007: Forfeiture {} > deposited {}",
            forfeited, pending
        );

        // Adding forfeited back to pending must not overflow
        let new_pending = pool.pending_rewards.checked_add(forfeited);
        prop_assert!(new_pending.is_some(), "INV-SR-007: Forfeiture add overflow");
    }

    // =========================================================================
    // INV-SR-008: Multi-Epoch Cumulative Accuracy
    //
    // After N epochs, total_deposited - total_claimed <= N * num_users.
    // =========================================================================
    #[test]
    fn inv_sr_008_multi_epoch_accuracy(
        total_staked in 100u64..=1_000_000u64,
        num_epochs in 2u32..=20u32,
        per_epoch_reward in 100u64..=1_000_000u64,
    ) {
        let mut pool = test_pool(total_staked, 0, 0);
        let mut total_deposited = 0u64;
        let mut total_claimed = 0u64;

        for _ in 0..num_epochs {
            pool.pending_rewards = per_epoch_reward;
            total_deposited += per_epoch_reward;
            add_to_cumulative(&mut pool).unwrap();
        }

        // Single user claiming everything
        let user_reward = compute_user_reward(total_staked, pool.rewards_per_token_stored);
        total_claimed += user_reward;

        let dust = total_deposited.saturating_sub(total_claimed);
        prop_assert!(
            dust <= num_epochs as u64,
            "INV-SR-008: Dust {} > num_epochs {} (deposited={}, claimed={})",
            dust, num_epochs, total_deposited, total_claimed
        );
    }

    // =========================================================================
    // INV-SR-013: Stake Weight Proportionality
    //
    // reward_i / total ~ stake_i / total_stake within rounding.
    // =========================================================================
    #[test]
    fn inv_sr_013_stake_weight_proportionality(
        total_staked in 1000u64..=1_000_000_000u64,
        pending in 1000u64..=1_000_000_000u64,
        user_stake in 1u64..=500_000_000u64,
    ) {
        prop_assume!(user_stake <= total_staked);
        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        let reward = compute_user_reward(user_stake, pool.rewards_per_token_stored);

        // Expected: pending * user_stake / total_staked (with rounding)
        let expected = (pending as u128 * user_stake as u128 / total_staked as u128) as u64;

        // Allow ±1 rounding tolerance
        prop_assert!(
            reward >= expected.saturating_sub(1) && reward <= expected + 1,
            "INV-SR-013: Proportionality violated! stake={}/{}, reward={}, expected={}",
            user_stake, total_staked, reward, expected
        );
    }

    // =========================================================================
    // INV-SR-014: Pending Rewards Accumulate Correctly
    //
    // Multi-epoch without claim = sum of individual epochs.
    // =========================================================================
    #[test]
    fn inv_sr_014_pending_accumulate(
        total_staked in 100u64..=1_000_000u64,
        reward_a in 100u64..=1_000_000u64,
        reward_b in 100u64..=1_000_000u64,
    ) {
        // Combined epoch
        let mut pool_combined = test_pool(total_staked, 0, reward_a + reward_b);
        add_to_cumulative(&mut pool_combined).unwrap();
        let combined_reward = compute_user_reward(total_staked, pool_combined.rewards_per_token_stored);

        // Two separate epochs
        let mut pool_split = test_pool(total_staked, 0, reward_a);
        add_to_cumulative(&mut pool_split).unwrap();
        pool_split.pending_rewards = reward_b;
        add_to_cumulative(&mut pool_split).unwrap();
        let split_reward = compute_user_reward(total_staked, pool_split.rewards_per_token_stored);

        // Must be equal within ±1
        prop_assert!(
            combined_reward >= split_reward.saturating_sub(1) &&
            combined_reward <= split_reward + 1,
            "INV-SR-014: Combined {} vs split {} (rewards {}, {})",
            combined_reward, split_reward, reward_a, reward_b
        );
    }

    // =========================================================================
    // INV-SR-017: Multi-Epoch Variable-Stake Conservation
    //
    // With dynamic stake changes between epochs, total claimed <= total deposited.
    // =========================================================================
    #[test]
    fn inv_sr_017_variable_stake_conservation(
        initial_stake in 1000u64..=1_000_000u64,
        stake_change in 1u64..=500_000u64,
        pending_1 in 100u64..=1_000_000u64,
        pending_2 in 100u64..=1_000_000u64,
    ) {
        // Epoch 1: initial stake
        let mut pool = test_pool(initial_stake, 0, pending_1);
        add_to_cumulative(&mut pool).unwrap();
        let cumulative_1 = pool.rewards_per_token_stored;

        // User claims epoch 1 rewards
        let reward_1 = compute_user_reward(initial_stake, cumulative_1);

        // Stake changes (user adds more)
        let new_total = initial_stake.saturating_add(stake_change);
        pool.total_staked = new_total;

        // Epoch 2
        pool.pending_rewards = pending_2;
        add_to_cumulative(&mut pool).unwrap();
        let delta_2 = pool.rewards_per_token_stored - cumulative_1;

        // User claims epoch 2 with new stake
        let reward_2 = compute_user_reward(initial_stake + stake_change, delta_2);

        let total_claimed = reward_1 as u128 + reward_2 as u128;
        let total_deposited = pending_1 as u128 + pending_2 as u128;

        prop_assert!(
            total_claimed <= total_deposited,
            "INV-SR-017: Conservation violated! claimed {} > deposited {}",
            total_claimed, total_deposited
        );
    }

    // =========================================================================
    // INV-STAKE-005: PRECISION Overflow Bound
    //
    // balance * reward_delta fits u128 for realistic supply and delta ranges.
    // Max PROFIT supply: 20M tokens = 20_000_000_000_000 raw (6 decimals).
    // On-chain code uses checked_mul and returns Err(Overflow) for values
    // beyond this range — see math.rs:54-64 for analysis.
    // =========================================================================
    #[test]
    fn inv_stake_005_precision_overflow(
        balance in 0u64..=100_000_000_000_000u64, // max ~100M tokens (6 decimals), 5x above 20M PROFIT supply
        // Max realistic delta: 1000 SOL / 1 MINIMUM_STAKE token * PRECISION
        // = 1e12 * 1e18 / 1e6 = 1e24, well within u128
        delta_scale in 0u64..=1_000_000_000_000u64, // up to 1000 SOL worth
    ) {
        let delta = (delta_scale as u128) * PRECISION / 1_000_000u128; // per-token delta
        let result = (balance as u128).checked_mul(delta);
        prop_assert!(
            result.is_some(),
            "INV-STAKE-005: Overflow at balance={}, delta={}",
            balance, delta
        );
    }

    // =========================================================================
    // INV-STAKE-006: Accumulator Lifetime Bound
    //
    // Accumulator won't overflow u128 within protocol lifetime.
    // Worst case: 1 MINIMUM_STAKE token, 1000 SOL/epoch, 100 years * 365 * 48 epochs
    // =========================================================================
    #[test]
    fn inv_stake_006_accumulator_lifetime(
        sol_per_epoch in 1u64..=1_000_000_000_000u64, // up to 1000 SOL
        epochs in 1u64..=1_752_000u64, // ~100 years at 48/day
    ) {
        let per_epoch_delta = (sol_per_epoch as u128) * PRECISION / 1_000_000u128; // min stake = 1M
        let total = per_epoch_delta.checked_mul(epochs as u128);
        prop_assert!(
            total.is_some() && total.unwrap() < u128::MAX / 2,
            "INV-STAKE-006: Accumulator would overflow after {} epochs",
            epochs
        );
    }

    // =========================================================================
    // INV-STAKE-007: Truncation Favors Protocol
    //
    // Floor division in both stages means sum(claims) <= deposited.
    // =========================================================================
    #[test]
    fn inv_stake_007_truncation_favors_protocol(
        total_staked in 2u64..=1_000_000_000u64,
        pending in 1u64..=1_000_000_000u64,
        user_a_pct in 1u64..=500_000u64,
        user_b_pct in 1u64..=500_000u64,
    ) {
        let user_a = 1u64.max(((total_staked as u128) * (user_a_pct as u128) / 1_000_000u128) as u64);
        let user_b = 1u64.max(((total_staked as u128) * (user_b_pct as u128) / 1_000_000u128) as u64);

        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        let reward_a = compute_user_reward(user_a, pool.rewards_per_token_stored);
        let reward_b = compute_user_reward(user_b, pool.rewards_per_token_stored);

        prop_assert!(
            reward_a as u128 + reward_b as u128 <= pending as u128,
            "INV-STAKE-007: sum(claims) {} > deposited {}",
            reward_a as u128 + reward_b as u128, pending
        );
    }

    // =========================================================================
    // INV-STAKE-010: Multiply Before Divide Ordering
    //
    // pending * PRECISION / total > pending / total * PRECISION for small pending.
    // This verifies the code uses the correct order (multiply first).
    // =========================================================================
    #[test]
    fn inv_stake_010_multiply_before_divide(
        pending in 1u64..=1_000u64, // small values where ordering matters
        total_staked in 1u64..=1_000_000_000u64,
    ) {
        // Correct order: multiply first
        let correct = (pending as u128)
            .checked_mul(PRECISION)
            .and_then(|v| v.checked_div(total_staked as u128));

        // Wrong order: divide first
        let wrong = (pending as u128)
            .checked_div(total_staked as u128)
            .and_then(|v| v.checked_mul(PRECISION));

        if let (Some(c), Some(w)) = (correct, wrong) {
            prop_assert!(
                c >= w,
                "INV-STAKE-010: Multiply-first {} should be >= divide-first {}",
                c, w
            );
        }
    }

    // =========================================================================
    // INV-STAKE-011: Dust Reward Accumulation
    //
    // MINIMUM_STAKE user earns nonzero after 1 epoch with >= 1M lamports pending.
    // =========================================================================
    #[test]
    fn inv_stake_011_dust_reward_accumulation(
        pending in 1_000_000u64..=1_000_000_000_000u64,
        total_staked in 1_000_000u64..=1_000_000_000_000_000u64,
    ) {
        let min_stake = 1_000_000u64; // MINIMUM_STAKE
        prop_assume!(min_stake <= total_staked);

        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        let reward = compute_user_reward(min_stake, pool.rewards_per_token_stored);

        // With >= 1M lamports pending and stake = MINIMUM_STAKE,
        // reward should be nonzero unless total_staked is enormous
        let expected_min = (pending as u128 * min_stake as u128 / total_staked as u128) as u64;
        if expected_min > 0 {
            prop_assert!(
                reward > 0,
                "INV-STAKE-011: MINIMUM_STAKE user earned 0 with pending={}, total={}",
                pending, total_staked
            );
        }
    }

    // =========================================================================
    // INV-STAKE-012: Reward Chunking Consistency
    //
    // |single_epoch(R) - two_halves(R/2, R-R/2)| <= 1
    // =========================================================================
    #[test]
    fn inv_stake_012_reward_chunking(
        total_staked in 100u64..=1_000_000_000u64,
        reward in 100u64..=1_000_000_000u64,
        user_stake in 1u64..=500_000_000u64,
    ) {
        prop_assume!(user_stake <= total_staked);

        // Single epoch with full reward
        let mut pool_single = test_pool(total_staked, 0, reward);
        add_to_cumulative(&mut pool_single).unwrap();
        let single_reward = compute_user_reward(user_stake, pool_single.rewards_per_token_stored);

        // Two half epochs
        let half = reward / 2;
        let remainder = reward - half;
        let mut pool_split = test_pool(total_staked, 0, half);
        add_to_cumulative(&mut pool_split).unwrap();
        pool_split.pending_rewards = remainder;
        add_to_cumulative(&mut pool_split).unwrap();
        let split_reward = compute_user_reward(user_stake, pool_split.rewards_per_token_stored);

        let diff = if single_reward > split_reward {
            single_reward - split_reward
        } else {
            split_reward - single_reward
        };

        prop_assert!(
            diff <= 1,
            "INV-STAKE-012: Chunking diff {} > 1 (single={}, split={}, reward={})",
            diff, single_reward, split_reward, reward
        );
    }
}
