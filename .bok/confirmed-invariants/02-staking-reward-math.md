# Confirmed: Staking Reward Math
# Priority Rank: 2 (critical-path -- fund drain/lock risk, two findings)
# Invariants: 16 confirmed, 0 skipped

Source: `programs/staking/src/helpers/math.rs`, instruction handlers

## FINDINGS (require code fixes)

### FINDING-1: Silent `as u64` Truncation (INV-STAKE-008) [SEVERITY: HIGH]
- **Location:** `math.rs:50`
- **Fix:** Replace `as u64` with `u64::try_from(...).map_err(|_| StakingError::Overflow)?`

### FINDING-2: update_cumulative Handler vs Helper Discrepancy (INV-STAKE-009) [SEVERITY: MEDIUM]
- **Location:** `update_cumulative.rs:108`
- **Fix:** Move `pool.pending_rewards = 0` inside the `if rewards_added > 0 && pool.total_staked > 0` block

---

## Proptest Invariants (9)

### INV-STAKE-001: Cumulative Monotonicity [PRIORITY: P1]
- **Tool:** Proptest
- **Property:** `new_rewards_per_token_stored >= old_rewards_per_token_stored`
- **Code ref:** `math.rs:91-127`, `update_cumulative.rs:72-130`

### INV-STAKE-002: Reward Conservation (No Over-Extraction) [PRIORITY: P1]
- **Tool:** Proptest
- **Property:** `SUM(all user rewards) <= total_deposited_rewards`
- **Code ref:** `math.rs:36-67`, `math.rs:91-127`

### INV-STAKE-005: PRECISION Overflow Bound [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** `balance * reward_delta` fits u128 for realistic inputs
- **Code ref:** `math.rs:46-50`, `math.rs:107-111`

### INV-STAKE-006: Accumulator Lifetime Bound [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** Accumulator stays within safe range for protocol's realistic lifetime
- **Code ref:** `math.rs:114-116`

### INV-STAKE-007: Truncation Favors Protocol [PRIORITY: P1]
- **Tool:** Proptest
- **Property:** Floor division everywhere; `SUM(claims) <= deposited`
- **Code ref:** `math.rs:49-50`, `math.rs:107-111`

### INV-STAKE-008: Silent u64 Truncation [PRIORITY: P1]
- **Tool:** Proptest
- **Property:** `(balance * reward_delta) / PRECISION <= u64::MAX` for realistic inputs
- **Code ref:** `math.rs:50`

### INV-STAKE-010: Multiply Before Divide [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** Correct ordering prevents premature zero truncation
- **Code ref:** `math.rs:46-50`, `math.rs:107-111`

### INV-STAKE-011: Dust Reward Accumulation [PRIORITY: P4]
- **Tool:** Proptest
- **Property:** MINIMUM_STAKE users earn > 0 after 1 epoch with realistic rewards
- **Code ref:** `math.rs:46-50`

### INV-STAKE-012: Reward Chunking Consistency [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** Single vs split distribution differs by at most 2 lamports
- **Code ref:** `math.rs:91-127`, `math.rs:36-67`

---

## LiteSVM Invariants (7)

### INV-STAKE-003: Late Staker Gets Zero Past Rewards [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** New staker's checkpoint = current accumulator; immediate claim = 0
- **Code ref:** `stake.rs:108-113`

### INV-STAKE-004: Flash-Loan Resistance [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** Stake + unstake within same epoch earns 0 rewards
- **Code ref:** `update_cumulative.rs:78-81`

### INV-STAKE-009: Zero-Staker Pending Loss [PRIORITY: P3]
- **Tool:** LiteSVM
- **Property:** Verify handler clears pending_rewards unconditionally (document discrepancy)
- **Code ref:** `update_cumulative.rs:108`

### INV-STAKE-013: Checkpoint Double-Claim Prevention [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** After claim, second claim = 0 (checkpoint updated)
- **Code ref:** `math.rs:58-59`

### INV-STAKE-014: Dead Stake Prevents Division by Zero [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** `total_staked >= MINIMUM_STAKE` at all times
- **Code ref:** `initialize_stake_pool.rs:138`

### INV-STAKE-015: Escrow Solvency Check [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** `escrow_vault.lamports() >= rewards_to_claim` enforced at claim/unstake
- **Code ref:** `claim.rs:102-111`, `unstake.rs:162-166`

### INV-STAKE-016: Deposit Reconciliation [PRIORITY: P2]
- **Tool:** LiteSVM
- **Property:** `escrow_vault.lamports() >= pool.pending_rewards` after deposit
- **Code ref:** `deposit_rewards.rs:99-102`
