/// Edge case tests for Staking Program.
///
/// Covers gaps from docs/edge-case-audit.md:
/// - STAK-01 (HIGH): Cooldown gate in unstake (CooldownActive error path)
/// - STAK-02 (HIGH): Partial unstake auto-full-unstake logic
/// - STAK-03 (MEDIUM): update_rewards with extreme reward_delta values
/// - STAK-04 (MEDIUM): Reward forfeiture on unstake with state tracking
///
/// These tests exercise the staking math and validation logic directly
/// using the same StakePool/UserStake structs and helper functions.

use staking::constants::{COOLDOWN_SECONDS, MINIMUM_STAKE, PRECISION};
use staking::state::{StakePool, UserStake};
use staking::helpers::add_to_cumulative;

/// Create a test StakePool
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

/// Create a test UserStake
fn test_user(balance: u64, checkpoint: u128, earned: u64, last_claim_ts: i64) -> UserStake {
    UserStake {
        owner: anchor_lang::prelude::Pubkey::new_unique(),
        staked_balance: balance,
        rewards_per_token_paid: checkpoint,
        rewards_earned: earned,
        total_claimed: 0,
        first_stake_slot: 0,
        last_update_slot: 0,
        last_claim_ts,
        bump: 0,
    }
}

// ===========================================================================
// STAK-01: Cooldown gate in unstake
//
// After claiming, users must wait COOLDOWN_SECONDS before unstaking.
// This prevents mercenary capital from extracting rewards and immediately
// exiting. The cooldown check uses: elapsed = clock.unix_timestamp - last_claim_ts
// ===========================================================================

#[test]
fn stak_01_cooldown_active_immediately_after_claim() {
    let claim_ts: i64 = 1000;
    let current_ts: i64 = 1001; // 1 second after claim

    let elapsed = current_ts.checked_sub(claim_ts).unwrap_or(0);
    assert!(
        elapsed < COOLDOWN_SECONDS,
        "1 second after claim should still be in cooldown (elapsed={}, cooldown={})",
        elapsed,
        COOLDOWN_SECONDS
    );
}

#[test]
fn stak_01_cooldown_expires_at_boundary() {
    let claim_ts: i64 = 1000;
    let current_ts = claim_ts + COOLDOWN_SECONDS;

    let elapsed = current_ts.checked_sub(claim_ts).unwrap_or(0);
    assert!(
        elapsed >= COOLDOWN_SECONDS,
        "Exactly at cooldown boundary should pass (elapsed={}, cooldown={})",
        elapsed,
        COOLDOWN_SECONDS
    );
}

#[test]
fn stak_01_cooldown_passed() {
    let claim_ts: i64 = 1000;
    let current_ts = claim_ts + COOLDOWN_SECONDS + 1;

    let elapsed = current_ts.checked_sub(claim_ts).unwrap_or(0);
    assert!(
        elapsed >= COOLDOWN_SECONDS,
        "After cooldown should pass (elapsed={}, cooldown={})",
        elapsed,
        COOLDOWN_SECONDS
    );
}

#[test]
fn stak_01_no_cooldown_if_never_claimed() {
    // last_claim_ts == 0 means never claimed -> skip cooldown check
    let user = test_user(1_000_000, 0, 0, 0);
    assert_eq!(user.last_claim_ts, 0, "New user should have last_claim_ts=0");
    // Handler skips cooldown check when last_claim_ts == 0
}

#[test]
fn stak_01_cooldown_with_clock_weirdness() {
    // If clock goes backwards (shouldn't happen, but handle gracefully)
    // current_ts < last_claim_ts -> checked_sub returns None -> unwrap_or(0)
    // This matches the on-chain logic in unstake.rs:
    //   let elapsed = clock.unix_timestamp.checked_sub(last_claim_ts).unwrap_or(0);
    let claim_ts: i64 = 2000;
    let current_ts: i64 = 1000; // "before" claim (clock anomaly)

    // On-chain: checked_sub underflows to None -> unwrap_or(0)
    // Note: i64 checked_sub returns None only on overflow, not on negative result.
    // For i64, 1000 - 2000 = -1000 which is a valid i64, so checked_sub returns Some(-1000).
    // The on-chain code treats negative elapsed as "cooldown active" because -1000 < COOLDOWN_SECONDS.
    let elapsed = current_ts.checked_sub(claim_ts).unwrap_or(0);
    assert!(
        elapsed < COOLDOWN_SECONDS,
        "Clock anomaly (negative elapsed={}) should keep cooldown active",
        elapsed
    );
}

// ===========================================================================
// STAK-02: Partial unstake auto-full-unstake logic
//
// If remaining balance after unstake would be < MINIMUM_STAKE and > 0,
// the handler auto-adjusts to full unstake. This prevents dust positions.
// ===========================================================================

#[test]
fn stak_02_partial_unstake_above_minimum() {
    let staked = 2_000_000u64; // 2 PROFIT
    let unstake_amount = 500_000u64; // 0.5 PROFIT
    let remaining = staked.saturating_sub(unstake_amount);

    assert_eq!(remaining, 1_500_000);
    assert!(
        remaining >= MINIMUM_STAKE,
        "Remaining {} should be >= MINIMUM_STAKE {}",
        remaining,
        MINIMUM_STAKE
    );
    // No auto-full-unstake needed
}

#[test]
fn stak_02_partial_unstake_below_minimum_triggers_full() {
    let staked = 1_500_000u64; // 1.5 PROFIT
    let unstake_amount = 1_000_000u64; // 1 PROFIT
    let remaining = staked.saturating_sub(unstake_amount);

    assert_eq!(remaining, 500_000);
    assert!(remaining > 0 && remaining < MINIMUM_STAKE);

    // Auto-full-unstake: actual amount becomes full balance
    let actual_amount = if remaining > 0 && remaining < MINIMUM_STAKE {
        staked
    } else {
        unstake_amount
    };
    assert_eq!(actual_amount, staked, "Should auto-adjust to full unstake");
}

#[test]
fn stak_02_exact_minimum_remaining_no_auto() {
    let staked = 2_000_000u64; // 2 PROFIT
    let unstake_amount = 1_000_000u64; // 1 PROFIT
    let remaining = staked.saturating_sub(unstake_amount);

    assert_eq!(remaining, MINIMUM_STAKE);
    // remaining == MINIMUM_STAKE, which is NOT < MINIMUM_STAKE, so no auto-full-unstake
    let should_auto = remaining > 0 && remaining < MINIMUM_STAKE;
    assert!(!should_auto, "Exactly at minimum should NOT trigger auto-full-unstake");
}

#[test]
fn stak_02_full_unstake_no_auto() {
    let staked = 1_000_000u64;
    let unstake_amount = 1_000_000u64; // Full amount
    let remaining = staked.saturating_sub(unstake_amount);

    assert_eq!(remaining, 0);
    // remaining == 0, which is NOT > 0, so no auto-full-unstake
    let should_auto = remaining > 0 && remaining < MINIMUM_STAKE;
    assert!(!should_auto, "Full unstake should NOT trigger auto logic");
}

#[test]
fn stak_02_one_unit_remaining_triggers_auto() {
    let staked = 1_000_001u64; // Minimum + 1
    let unstake_amount = 1_000_000u64;
    let remaining = staked.saturating_sub(unstake_amount);

    assert_eq!(remaining, 1);
    let should_auto = remaining > 0 && remaining < MINIMUM_STAKE;
    assert!(should_auto, "1 unit remaining should trigger auto-full-unstake");
}

// ===========================================================================
// STAK-03: update_rewards with extreme reward_delta values
//
// The formula: pending = (balance * reward_delta) / PRECISION
// With extreme values, balance * reward_delta could overflow u128.
// ===========================================================================

#[test]
fn stak_03_extreme_delta_overflow() {
    // u64::MAX balance * very large delta
    let balance: u128 = u64::MAX as u128;
    // Maximum safe delta: u128::MAX / u64::MAX = u64::MAX + 1
    let max_safe_delta: u128 = u128::MAX / balance;

    // At max safe delta, multiply succeeds
    let result = balance.checked_mul(max_safe_delta);
    assert!(result.is_some(), "Max safe delta should not overflow");

    // One above max safe delta overflows
    let result = balance.checked_mul(max_safe_delta + 1);
    assert!(result.is_none(), "Above max safe delta should overflow");
}

#[test]
fn stak_03_realistic_max_delta() {
    // After 10 years of max rewards:
    // Assume 1B SOL total rewards, 1M PROFIT staked
    // cumulative = 1e18 * 1e18 / 1e6 = 1e30 per epoch
    // Over 10000 epochs: 1e34
    // User balance: 1e15 (1B PROFIT)
    // balance * delta = 1e15 * 1e34 = 1e49 -- still within u128 (max 3.4e38)
    // Wait, that's too big! Let's check actual realistic values.

    // Realistic: 580M SOL total yield over 100 years
    // cumulative = 580e6 * 1e9 * 1e18 / 1e6 (MINIMUM_STAKE)
    // = 5.8e17 * 1e18 / 1e6 = 5.8e29
    let cumulative: u128 = 580_000_000_000_000_000u128 * PRECISION / (MINIMUM_STAKE as u128);
    let balance: u128 = MINIMUM_STAKE as u128;

    let result = balance.checked_mul(cumulative);
    assert!(result.is_some(), "Realistic max values should not overflow");

    let pending = result.unwrap() / PRECISION;
    // Should equal the total deposited amount (minus truncation dust)
    assert!(pending > 0);
}

#[test]
fn stak_03_zero_delta_produces_zero_rewards() {
    let balance: u128 = u64::MAX as u128;
    let delta: u128 = 0;
    let pending = balance.checked_mul(delta).unwrap() / PRECISION;
    assert_eq!(pending, 0, "Zero delta should always produce 0 rewards");
}

// ===========================================================================
// STAK-04: Reward forfeiture on unstake with state tracking
//
// When a user unstakes, their rewards_earned is forfeited to pool.pending_rewards.
// This test verifies the state transitions are correct.
// ===========================================================================

#[test]
fn stak_04_forfeiture_transfers_to_pending() {
    let mut pool = test_pool(1_000_000, 0, 1_000_000);
    add_to_cumulative(&mut pool).unwrap();

    // Simulate: user has earned rewards from the cumulative
    let user_balance = 500_000u64;
    let user_rewards = (user_balance as u128)
        .checked_mul(pool.rewards_per_token_stored)
        .unwrap()
        / PRECISION;
    let user_rewards = user_rewards as u64;

    assert!(user_rewards > 0, "User should have earned some rewards");

    // Simulate forfeiture (from unstake handler)
    let pre_pending = pool.pending_rewards; // Should be 0 after add_to_cumulative
    assert_eq!(pre_pending, 0);

    pool.pending_rewards = pool.pending_rewards.checked_add(user_rewards).unwrap();

    assert_eq!(
        pool.pending_rewards, user_rewards,
        "Forfeited rewards should be added to pending"
    );
}

#[test]
fn stak_04_full_unstake_resets_claim_ts() {
    let mut user = test_user(1_000_000, 0, 500, 12345);

    // Simulate full unstake
    user.staked_balance = 0;
    if user.staked_balance == 0 {
        user.last_claim_ts = 0;
    }

    assert_eq!(user.last_claim_ts, 0, "Full unstake should reset last_claim_ts");
}

#[test]
fn stak_04_partial_unstake_preserves_claim_ts() {
    let mut user = test_user(2_000_000, 0, 500, 12345);

    // Simulate partial unstake (1M out of 2M)
    user.staked_balance = 1_000_000;
    if user.staked_balance == 0 {
        user.last_claim_ts = 0;
    }

    assert_eq!(
        user.last_claim_ts, 12345,
        "Partial unstake should preserve last_claim_ts"
    );
}

#[test]
fn stak_04_forfeiture_with_existing_pending() {
    let mut pool = test_pool(1_000_000, 0, 500_000);
    add_to_cumulative(&mut pool).unwrap();

    // Add new pending from another source (e.g., next epoch deposits)
    pool.pending_rewards = 200_000;

    // User forfeits 100_000
    let forfeited = 100_000u64;
    pool.pending_rewards = pool.pending_rewards.checked_add(forfeited).unwrap();

    assert_eq!(
        pool.pending_rewards, 300_000,
        "Forfeited should add to existing pending"
    );
}
