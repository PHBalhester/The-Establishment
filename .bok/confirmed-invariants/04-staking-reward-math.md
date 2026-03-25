# Staking Reward Math -- Confirmed Invariants
# Priority Rank: 4 (Critical staking system -- 2 findings)

Source: `programs/staking/src/helpers/math.rs`, instruction handlers

---

## INV-STAKE-002: Reward Conservation (No Over-Extraction) [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 1 (Critical -- fund drain if violated)
- **Property:** `SUM(all user claims) <= total_deposited_rewards`
- **Code:** `update_rewards` at `math.rs:36-67`, `add_to_cumulative` at `math.rs:91-127`
- **Existing:** Partial (single-user) -- extend to multi-user

## INV-STAKE-003: Late Staker Gets Zero Past Rewards [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 2 (Critical -- fund drain if violated)
- **Property:** New user's checkpoint = current accumulator => zero retroactive rewards
- **Code:** `stake.rs:108-113`
- **Existing:** None

## INV-STAKE-013: Checkpoint Double-Claim Prevention [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 3 (Critical -- fund drain if violated)
- **Property:** After update_rewards, calling again adds 0 to rewards_earned
- **Code:** `update_rewards` at `math.rs:58-59`
- **Existing:** None

## INV-STAKE-004: Flash-Loan Resistance [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 4 (Critical -- fund drain if violated)
- **Property:** Stake+unstake within same epoch earns 0 rewards
- **Code:** `update_cumulative.rs:78-81` (epoch guard)
- **Existing:** None

## INV-STAKE-001: Cumulative Monotonicity [CONFIRMED]
- **Tool:** Kani (formal proof over bounded inputs)
- **Priority:** 5 (Critical -- fund lock if violated)
- **Property:** `rewards_per_token_stored` only increases or stays same
- **Code:** `add_to_cumulative` at `math.rs:91-127`
- **Existing:** Partial proptest (Property 4, math.rs:589) -- Kani upgrades to exhaustive proof

## INV-STAKE-007: Truncation Favors Protocol (Floor Division) [CONFIRMED]
- **Tool:** Kani (formal proof -- per-user floor property) + Proptest (multi-user sum)
- **Priority:** 6 (Critical -- insolvency if violated)
- **Property:** Per-user: `floor(balance * rpt / PRECISION) <= balance * rpt / PRECISION`. Multi-user sum: Proptest with N users.
- **Code:** `update_rewards` at `math.rs:49-50`, `add_to_cumulative` at `math.rs:107-111`
- **Existing:** Partial -- Kani proves per-user bound; Proptest validates aggregate

## INV-STAKE-008: Silent `as u64` Truncation [CONFIRMED] -- FINDING-1
- **Tool:** Kani (formal proof -- prove exact safe boundary for the cast)
- **Priority:** 7 (High -- silent fund loss)
- **Property:** Prove: `balance * reward_delta / PRECISION <= u64::MAX` iff `reward_delta <= u64::MAX * PRECISION / balance`. Kani identifies the exact inputs where truncation occurs.
- **Code:** `math.rs:50`
- **Recommendation:** Replace `as u64` with `u64::try_from(...).map_err(|_| StakingError::Overflow)?`
- **Existing:** None -- Kani will formally characterize the safe domain

## INV-STAKE-014: Dead Stake Prevents Division by Zero [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 8 (Critical -- system brick if violated)
- **Property:** `total_staked >= MINIMUM_STAKE` at all times
- **Code:** `initialize_stake_pool.rs:138`
- **Existing:** None

## INV-STAKE-015: Escrow Solvency Check [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 9 (Critical -- last defense)
- **Property:** `escrow_vault.lamports() >= rewards_to_claim` before transfer
- **Code:** `claim.rs:102-111`, `unstake.rs:162-166`
- **Existing:** None

## INV-STAKE-009: Zero-Staker Pending Loss Discrepancy [CONFIRMED] -- FINDING-2
- **Tool:** LiteSVM
- **Priority:** 10 (Medium -- mitigated by dead stake)
- **Property:** Handler clears pending_rewards unconditionally; helper preserves when total_staked=0
- **Code:** `update_cumulative.rs:108` vs `math.rs:97-101`
- **Recommendation:** Move clear inside `if rewards_added > 0 && pool.total_staked > 0` block
- **Existing:** None

## INV-STAKE-005: PRECISION Overflow Bound [CONFIRMED]
- **Tool:** Kani (formal proof over bounded inputs)
- **Priority:** 11
- **Property:** `balance * reward_delta` fits u128 for realistic inputs
- **Code:** `update_rewards` at `math.rs:46-50`
- **Existing:** Proptest Property 3 (bounded range) -- Kani upgrades to exhaustive proof

## INV-STAKE-010: Multiply Before Divide [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 12
- **Property:** `pending * PRECISION / total_staked` not `pending / total_staked * PRECISION`
- **Code:** `add_to_cumulative` at `math.rs:107-111`
- **Existing:** Partial (math.rs:231)

## INV-STAKE-016: Deposit Rewards Reconciliation [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 13
- **Property:** `escrow_vault.lamports() >= pool.pending_rewards` after deposit
- **Code:** `deposit_rewards.rs:99-102`
- **Existing:** None

## INV-STAKE-006: Accumulator Lifetime Bound [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 14
- **Property:** Accumulator does not overflow u128 within protocol lifetime
- **Code:** `add_to_cumulative` at `math.rs:114-116`
- **Existing:** None (analytical proof provided)

## INV-STAKE-012: Reward Chunking Consistency [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 15
- **Property:** Single R vs two R/2 distributions differ by <= 1 lamport per user
- **Code:** `add_to_cumulative`, `update_rewards`
- **Existing:** None

## INV-STAKE-011: Dust Reward Accumulation for Small Stakers [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 16 (design property)
- **Property:** MINIMUM_STAKE users earn from epoch 1; sub-minimum users need many epochs
- **Code:** `update_rewards` at `math.rs:46-50`
- **Existing:** None
