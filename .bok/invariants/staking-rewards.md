---
task_id: bok-analyze-staking-rewards
provides: [invariant-proposals]
subsystem: staking-rewards
confidence: high
invariant_count: 18
findings: 2
---

# Invariant Proposals -- Staking Rewards (staking/helpers/math.rs)

## Source Files
- `programs/staking/src/helpers/math.rs` (735 lines) -- update_rewards, add_to_cumulative
- Category: Staking Rewards (Synthetix cumulative pattern, u128 PRECISION=1e18)
- Existing: 16 unit + 7 proptest (10K each) -- no-panic, conservation, monotonicity, forfeiture, totals
- Previous BOK run: Conservation and monotonicity stress-tested (passed)

---

## Findings

### FINDING-1 (High): Silent `as u64` Truncation

**Location:** `math.rs:50` (approximate)
**Issue:** The `as u64` cast bypasses all checked arithmetic. If `(balance * reward_delta / PRECISION)` exceeds u64::MAX, the user silently loses rewards.
**Recommendation:** Replace with `u64::try_from(...).map_err(|_| StakingError::Overflow)?`

### FINDING-2 (Medium): Handler/Helper Discrepancy

**Location:** `update_cumulative.rs:108` (approximate)
**Issue:** Unconditionally clears `pending_rewards = 0` even when `total_staked == 0`, unlike the helper which preserves it. Mitigated by dead stake but should be fixed defensively.

---

## Proposed Invariants

### INV-SR-001: Reward Conservation (Single Epoch)

**What it checks:**
The sum of all users' claimable rewards after a single epoch distribution never exceeds the total rewards deposited into the pool for that epoch.

**Why it matters:**
If the cumulative index calculation overestimates per-user rewards, the pool pays out more than it received. An attacker could stake a precise amount to trigger favorable rounding and drain the reward pool.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-019 (reward conservation)

**Formal Property:**
```
For all users U[], total_deposited R, stakes S[]:
  sum(claimable(u) for u in U) <= R
```

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_single_epoch_conservation(
        stakes in prop::collection::vec(1..1_000_000_000u64, 2..10),
        reward in 1..1_000_000_000u64
    ) {
        let total_staked: u64 = stakes.iter().sum();
        let cumulative_delta = (reward as u128 * PRECISION) / total_staked as u128;
        let total_claimed: u64 = stakes.iter().map(|s| {
            ((*s as u128 * cumulative_delta) / PRECISION) as u64
        }).sum();
        prop_assert!(total_claimed <= reward);
    }
}
```

---

### INV-SR-002: Cumulative Index Monotonicity

**What it checks:**
The cumulative reward index (reward_per_token_stored) only ever increases. It never decreases, even across multiple epoch distributions.

**Why it matters:**
If the index decreases, users who staked before the decrease would see their pending rewards shrink or become negative. This would cause underflows in the claim calculation.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-020 (index monotonicity)

**Formal Property:**
```
For all reward > 0, total_staked > 0:
  new_index = old_index + (reward * PRECISION / total_staked)
  assert!(new_index >= old_index)
```

**Kani sketch:**
```rust
#[kani::proof]
fn proof_cumulative_index_monotonic() {
    let old_index: u128 = kani::any();
    let reward: u64 = kani::any();
    let total_staked: u64 = kani::any();
    kani::assume!(total_staked > 0);
    kani::assume!(reward > 0);
    kani::assume!(old_index <= u128::MAX / 2); // realistic bound
    let delta = (reward as u128 * PRECISION) / total_staked as u128;
    let new_index = old_index + delta;
    kani::assert!(new_index >= old_index);
}
```

---

### INV-SR-003: No-Panic for All Valid Inputs

**What it checks:**
update_rewards and add_to_cumulative never panic for any combination of valid input values (non-zero stake, non-zero total, rewards within u64 range).

**Why it matters:**
A panic in on-chain code causes the transaction to fail, but more critically, if a specific input combination always panics, it could permanently lock funds in the staking pool (denial of service).

**Tool:** Kani
**Confidence:** high
**Based on:** VP-019 (no-panic guarantee)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_update_rewards_no_panic() {
    let user_balance: u64 = kani::any();
    let reward_per_token_stored: u128 = kani::any();
    let user_reward_per_token_paid: u128 = kani::any();
    let pending_rewards: u64 = kani::any();
    kani::assume!(reward_per_token_stored >= user_reward_per_token_paid);
    kani::assume!(reward_per_token_stored <= u128::MAX / 2);
    let delta = reward_per_token_stored - user_reward_per_token_paid;
    let earned = (user_balance as u128 * delta) / PRECISION;
    // Should not panic
    let _ = u64::try_from(earned);
}
```

---

### INV-SR-004: Pro-Rata Fairness

**What it checks:**
Two users with equal stakes receive equal rewards (within 1 unit due to rounding). Users with 2x stake receive 2x rewards (within 1 unit).

**Why it matters:**
If the cumulative pattern breaks proportionality, a whale could receive disproportionately more rewards than their stake warrants, or vice versa -- extracting value from smaller stakers.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-021 (pro-rata distribution)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_pro_rata_fairness(
        stake in 1..1_000_000_000u64,
        reward in 1..1_000_000_000u64
    ) {
        let total_staked = stake * 2;
        let delta = (reward as u128 * PRECISION) / total_staked as u128;
        let user_a = (stake as u128 * delta) / PRECISION;
        let user_b = (stake as u128 * delta) / PRECISION;
        prop_assert_eq!(user_a, user_b); // Equal stakes -> equal rewards
        let double_user = ((stake * 2) as u128 * delta) / PRECISION;
        prop_assert!(double_user >= user_a * 2 - 1 && double_user <= user_a * 2 + 1);
    }
}
```

---

### INV-SR-005: First Staker Gets Full Rewards

**What it checks:**
When there is only one staker, they receive all rewards (minus at most 1 unit of rounding).

**Why it matters:**
A common Synthetix pattern bug is losing rewards when total_staked = user_stake (division by self). The first staker should get everything.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-022 (single staker edge case)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_single_staker_gets_all(
        stake in 1..1_000_000_000u64,
        reward in 1..1_000_000_000u64
    ) {
        let delta = (reward as u128 * PRECISION) / stake as u128;
        let claimed = (stake as u128 * delta) / PRECISION;
        prop_assert!(claimed >= reward as u128 - 1);
    }
}
```

---

### INV-SR-006: Zero Reward Epoch Safety

**What it checks:**
When reward = 0 is distributed, the cumulative index does not change and no user's pending rewards are affected.

**Why it matters:**
If a zero-reward update incorrectly modifies the index (e.g., through integer arithmetic artifacts), it could corrupt the reward accounting for all subsequent epochs.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-023 (zero-input safety)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_zero_reward_no_change() {
    let old_index: u128 = kani::any();
    let total_staked: u64 = kani::any();
    kani::assume!(total_staked > 0);
    let delta = (0u128 * PRECISION) / total_staked as u128;
    kani::assert!(delta == 0);
    kani::assert!(old_index + delta == old_index);
}
```

---

### INV-SR-007: Forfeiture Conservation

**What it checks:**
When a user unstakes early and forfeits rewards, the forfeited amount remains in the pool and becomes claimable by remaining stakers. Total rewards in = total rewards out + remaining in pool.

**Why it matters:**
If forfeited rewards disappear (neither claimed nor redistributed), value is permanently destroyed. If they double-count, the pool becomes insolvent.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-024 (forfeiture accounting)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_forfeiture_conserved(
        stake_a in 1..1_000_000_000u64,
        stake_b in 1..1_000_000_000u64,
        reward in 1..1_000_000_000u64
    ) {
        // User A stakes, epoch distributes, User A unstakes (forfeits)
        // User B claims -> should get their share + A's forfeited share
        // Total claimed <= total deposited
    }
}
```

---

### INV-SR-008: Cumulative Total Accuracy

**What it checks:**
After N epochs, the sum of all claimed rewards across all users equals the total deposited rewards minus rounding dust (bounded by N * num_users).

**Why it matters:**
Rounding dust accumulates over many epochs. If the bound is violated, there's a systematic leak (either the pool is overpaying or underpaying).

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-025 (cumulative accuracy)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_cumulative_total_accuracy(
        rewards in prop::collection::vec(1..1_000_000u64, 1..20),
        num_users in 2..10usize
    ) {
        let total_deposited: u64 = rewards.iter().sum();
        // Simulate N epochs, compute total claimed
        // prop_assert!(total_deposited - total_claimed <= (rewards.len() * num_users) as u64);
    }
}
```

---

### INV-SR-009: Precision Delta Non-Negative

**What it checks:**
The reward delta `reward_per_token_stored - user_reward_per_token_paid` is always >= 0. No underflow in the pending reward calculation.

**Why it matters:**
If a user's paid index somehow exceeds the global stored index (e.g., due to a state update ordering bug), the subtraction underflows, granting the user an astronomically large reward.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-020 (index ordering guarantee)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_delta_non_negative() {
    let stored: u128 = kani::any();
    let paid: u128 = kani::any();
    // This should always hold after proper initialization
    kani::assume!(stored >= paid);
    kani::assert!(stored - paid >= 0); // trivially true if assume holds
    // Real check: verify the code enforces stored >= paid
}
```

---

### INV-SR-010: Late Staker Gets No Past Rewards

**What it checks:**
A user who stakes after epoch N does not receive rewards from epochs 1..N. Their user_reward_per_token_paid is set to the current cumulative index on stake.

**Why it matters:**
If the paid index is initialized to 0 instead of the current global index, a new staker would claim all historical rewards -- draining the pool.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** VP-026 (late entry correctness)

**LiteSVM sketch:**
```rust
#[test]
fn test_late_staker_no_retroactive_rewards() {
    // Epoch 1: User A stakes, distribute rewards
    // User B stakes (late)
    // Epoch 2: distribute rewards
    // Assert: User B only gets epoch 2 share, not epoch 1
}
```

---

### INV-SR-011: Unstake-Restake No Double Claim

**What it checks:**
A user who unstakes, claims rewards, then restakes cannot claim the same rewards again. The pending_rewards field is zeroed on claim.

**Why it matters:**
If pending_rewards isn't cleared after claim, a user could repeatedly unstake/claim/restake to drain the reward pool.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** VP-019 (claim accounting)

---

### INV-SR-012: u128 Intermediate No Overflow

**What it checks:**
The computation `balance * (reward_per_token_stored - user_reward_per_token_paid)` never overflows u128 for realistic values.

**Why it matters:**
With PRECISION=1e18, the cumulative index can grow large. If balance * delta overflows u128, the earned calculation wraps and produces incorrect rewards.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-082 (precision overflow)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_u128_no_overflow() {
    let balance: u64 = kani::any();
    let delta: u128 = kani::any();
    kani::assume!(delta <= 1_000_000u128 * PRECISION); // realistic: 1M epochs worth
    let product = balance as u128 * delta;
    // u128 max = 3.4e38, max product = 1.8e19 * 1e24 = 1.8e43 -- overflows!
    // This proof will FAIL if delta is unbounded, proving the need for a cap
    kani::assert!(product / PRECISION <= u64::MAX as u128);
}
```

---

### INV-SR-013: Stake Weight Proportionality

**What it checks:**
A user's reward share is proportional to their stake fraction: `reward_i / total_reward ~= stake_i / total_stake` (within rounding tolerance).

**Why it matters:**
This is the fundamental fairness property. If broken, larger stakers could be subsidizing smaller ones (or vice versa), creating an exploitable incentive misalignment.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-021 (proportional distribution)

---

### INV-SR-014: Pending Rewards Accumulate Correctly

**What it checks:**
Across multiple epochs without claiming, a user's pending rewards equal the sum of what they would have received from each individual epoch.

**Why it matters:**
The Synthetix pattern accumulates via the delta between current and paid index. If the accumulation formula drops terms, users who claim infrequently lose rewards.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-025 (multi-epoch accumulation)

---

### INV-SR-015: Total Staked Accounting

**What it checks:**
The pool's total_staked field always equals the sum of all individual user stake balances. No accounting drift.

**Why it matters:**
If total_staked diverges from reality, the cumulative index calculation produces incorrect per-user rewards. A lower total_staked means each staker gets a bigger share than intended.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** VP-019 (global accounting consistency)

---

### INV-SR-016: Minimum Stake Dust Prevention

**What it checks:**
Very small stakes (1-10 lamports) don't cause division to produce a cumulative delta of 0, effectively losing the rewards for that epoch.

**Why it matters:**
If a whale stakes alongside a dust staker, the dust stake could cause total_staked to be just right for the delta to round down, losing a non-trivial portion of rewards.

**Tool:** Proptest
**Confidence:** medium
**Based on:** VP-023 (edge case handling)

---

### INV-SR-017: Multi-Epoch Variable-Stake Conservation (NEW)

**What it checks:**
When users stake and unstake between epoch distributions (changing the total_staked each epoch), total rewards claimed across all users and all epochs never exceeds total rewards deposited.

**Why it matters:**
Previous conservation tests use static stakes. Dynamic staking between epochs creates different cumulative deltas per epoch. If the Synthetix pattern has a bug with changing denominators, it could overpay during transition epochs.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-019 + VP-024 (novel composition)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_variable_stake_conservation(
        initial_stakes in prop::collection::vec(1_000..1_000_000u64, 3..6),
        rewards in prop::collection::vec(1_000..1_000_000u64, 3..10),
        unstake_epochs in prop::collection::vec(0..10usize, 1..3)
    ) {
        // Simulate: distribute rewards, some users unstake between epochs
        // Assert: total claimed <= total deposited
    }
}
```

---

### INV-SR-018: Per-Operation Precision Loss Bounded (NEW)

**What it checks:**
Each floor-division operation in the reward calculation loses at most 1 unit. The double-floor chain (index calculation + per-user calculation) loses at most 2 lamports per user per epoch.

**Why it matters:**
If precision loss exceeds the expected bound, it indicates a bug in the intermediate math (e.g., dividing before multiplying, or using the wrong precision constant). Bounded loss is acceptable; unbounded loss is exploitable.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-083 (precision loss quantification)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_precision_loss_bounded() {
    let reward: u64 = kani::any();
    let total_staked: u64 = kani::any();
    let user_stake: u64 = kani::any();
    kani::assume!(total_staked > 0);
    kani::assume!(user_stake <= total_staked);
    kani::assume!(reward <= 1_000_000_000);
    // Exact: user_stake * reward / total_staked
    let exact = (user_stake as u128 * reward as u128);
    let exact_div = exact / total_staked as u128;
    // Double-floor: (user_stake * (reward * PRECISION / total_staked)) / PRECISION
    let delta = (reward as u128 * PRECISION) / total_staked as u128;
    let earned = (user_stake as u128 * delta) / PRECISION;
    // Loss should be at most 2 (one per floor division)
    kani::assert!(exact_div >= earned);
    kani::assert!(exact_div - earned <= 2);
}
```

---

## Coverage Gap Analysis

**Covered by existing tests (16 unit + 7 proptest):**
- No-panic, conservation (single epoch), monotonicity, forfeiture basics, totals

**Strengthened from previous BOK run:**
- INV-SR-001 through INV-SR-016 carry forward with expanded input ranges
- Added u128 overflow proof (INV-SR-012) which was inconclusive in previous run

**NEW gaps filled:**
1. **INV-SR-017 (Variable-Stake Conservation)** -- Dynamic stake changes between epochs untested
2. **INV-SR-018 (Precision Loss Bound)** -- No quantitative bound on rounding loss

**Actionable findings:**
1. FINDING-1: Silent `as u64` truncation -- should be `try_from` with error handling
2. FINDING-2: Handler/helper discrepancy on pending_rewards clearing
