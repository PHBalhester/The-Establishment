# Confirmed Invariants: Staking Rewards
**Priority Rank: 4** (critical-path: yield distribution to all stakers)
**Source:** `programs/staking/src/helpers/math.rs`, `instructions/*.rs`
**Confirmed:** 28 invariants | Skipped: 0
**Findings:** 2 (FINDING-1: silent as u64 truncation, FINDING-2: handler/helper discrepancy)

---

## P0: No Existing Coverage + Findings

### INV-STAKE-008: Silent `as u64` Truncation Detection
- **Tool:** Proptest
- **Property:** Verify `(balance * reward_delta) / PRECISION <= u64::MAX` for realistic inputs
- **Finding:** math.rs:50 uses `as u64` — should be `u64::try_from().map_err()`

### INV-STAKE-009: Zero-Staker Pending Loss (Handler Discrepancy)
- **Tool:** LiteSVM
- **Property:** When total_staked == 0, pending_rewards must NOT be cleared
- **Finding:** update_cumulative.rs:108 unconditionally clears; helper preserves correctly

### INV-SR-017: Multi-Epoch Variable-Stake Conservation
- **Tool:** Proptest
- **Property:** With dynamic stake changes between epochs, total claimed <= total deposited
- **Why:** Static-stake tests miss bugs with changing denominators.

### INV-SR-018: Per-Operation Precision Loss Bounded
- **Tool:** Kani
- **Property:** Double-floor chain loses at most 2 lamports per user per epoch
- **Why:** Unbounded precision loss = exploitable.

---

## P1: Critical Staking Properties

### INV-SR-001 / STAKE-002: Reward Conservation
- **Tool:** Proptest (multi-user, 2-10 users)
- **Property:** `sum(all_user_claims) <= total_deposited_rewards`

### INV-SR-002 / STAKE-001: Cumulative Index Monotonicity
- **Tool:** Kani + Proptest
- **Property:** `new_index >= old_index` after any distribution

### INV-STAKE-003: Late Staker Gets Zero Past Rewards
- **Tool:** LiteSVM
- **Property:** New staker's checkpoint = current global index -> delta = 0

### INV-STAKE-004: Flash-Loan Resistance
- **Tool:** LiteSVM
- **Property:** Stake+unstake within same epoch = 0 rewards

### INV-STAKE-013: Checkpoint Prevents Double-Claiming
- **Tool:** LiteSVM
- **Property:** After claim, checkpoint = global index -> second claim = 0

### INV-STAKE-014: Dead Stake Prevents Division by Zero
- **Tool:** LiteSVM
- **Property:** total_staked >= MINIMUM_STAKE at all times

### INV-STAKE-015: Escrow Solvency Check
- **Tool:** LiteSVM
- **Property:** `escrow.lamports() >= rewards_to_claim` before every transfer

### INV-STAKE-016: Deposit Rewards Reconciliation
- **Tool:** LiteSVM
- **Property:** `escrow.lamports() >= pool.pending_rewards` after deposit

---

## P2: Mathematical Properties

### INV-SR-003: No-Panic for Valid Inputs
- **Tool:** Kani
- **Property:** update_rewards and add_to_cumulative never panic

### INV-SR-004: Pro-Rata Fairness
- **Tool:** Proptest
- **Property:** Equal stakes -> equal rewards (±1). 2x stake -> 2x rewards (±1)

### INV-SR-005: Single Staker Gets All
- **Tool:** Proptest
- **Property:** Sole staker receives total reward (±1 rounding)

### INV-SR-006: Zero Reward Epoch Safety
- **Tool:** Kani
- **Property:** reward=0 -> index unchanged, no corruption

### INV-SR-007: Forfeiture Conservation
- **Tool:** Proptest
- **Property:** Forfeited rewards remain in pool, claimable by others

### INV-SR-008: Multi-Epoch Cumulative Accuracy
- **Tool:** Proptest
- **Property:** After N epochs, `total_deposited - total_claimed <= N * num_users`

### INV-SR-009: Precision Delta Non-Negative
- **Tool:** Kani
- **Property:** `stored >= paid` (enforced by initialization and monotonicity)

### INV-SR-012: u128 Intermediate No Overflow
- **Tool:** Kani
- **Property:** `balance * delta` stays within u128 for realistic inputs

### INV-SR-013: Stake Weight Proportionality
- **Tool:** Proptest
- **Property:** `reward_i / total ~ stake_i / total_stake` within rounding

### INV-SR-014: Pending Rewards Accumulate Correctly
- **Tool:** Proptest
- **Property:** Multi-epoch without claim = sum of individual epochs

---

## P3: Edge Cases and Design Properties

### INV-STAKE-005: PRECISION Overflow Bound
- **Tool:** Proptest
- **Property:** `u64::MAX * reward_delta` fits u128 for realistic delta range

### INV-STAKE-006: Accumulator Lifetime Bound
- **Tool:** Proptest (analytical + simulation)
- **Property:** Accumulator won't overflow u128 within protocol lifetime

### INV-STAKE-007: Truncation Favors Protocol
- **Tool:** Proptest
- **Property:** Floor division in both stages -> sum(claims) <= deposited

### INV-STAKE-010: Multiply Before Divide Ordering
- **Tool:** Proptest
- **Property:** `pending * PRECISION / total > pending / total * PRECISION` for small pending

### INV-STAKE-011: Dust Reward Accumulation (Min Stakers)
- **Tool:** Proptest
- **Property:** MINIMUM_STAKE user earns nonzero after 1 epoch

### INV-STAKE-012: Reward Chunking Consistency
- **Tool:** Proptest
- **Property:** `|single_epoch(R) - two_halves(R/2, R-R/2)| <= 1`
