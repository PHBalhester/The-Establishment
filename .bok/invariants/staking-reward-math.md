# Staking Reward Math -- Verification Invariants

**Source Files:**
- `programs/staking/src/helpers/math.rs` (617 lines)
- `programs/staking/src/constants.rs` (190 lines)
- `programs/staking/src/instructions/update_cumulative.rs` (257 lines)
- `programs/staking/src/instructions/stake.rs` (165 lines)
- `programs/staking/src/instructions/unstake.rs` (253 lines)
- `programs/staking/src/instructions/claim.rs` (169 lines)
- `programs/staking/src/instructions/deposit_rewards.rs` (119 lines)
- `programs/staking/src/instructions/initialize_stake_pool.rs` (156 lines)
- `programs/staking/src/state/stake_pool.rs` (82 lines)
- `programs/staking/src/state/user_stake.rs` (81 lines)

**Pattern (Synthetix/Quarry Cumulative Reward-Per-Token):**
The system uses a global accumulator `rewards_per_token_stored` (u128) that monotonically increases. Each user stores a `rewards_per_token_paid` checkpoint (u128). Pending rewards = `staked_balance * (global_cumulative - user_checkpoint) / PRECISION`.

**Related Economic Docs:**
- `Docs/token-economics-model.md` -- Sections on Yield Model, Economic Invariants 4 and 5


---

### INV-STAKE-001: Cumulative Monotonicity

**Function:** `add_to_cumulative` at `math.rs:91-127`, `handler` at `update_cumulative.rs:72-130`
**Pattern:** VP-019, GL INV-4
**Tool:** Proptest (Kani not installed -- degrades to probabilistic)
**Confidence:** high

**Plain English:** The global `rewards_per_token_stored` accumulator can only increase or stay the same -- it must never decrease. Every call to `add_to_cumulative` or the `update_cumulative` instruction handler adds a non-negative delta.

**Why It Matters:** If the accumulator decreases, the subtraction at `math.rs:39-41` (`pool.rewards_per_token_stored.checked_sub(user.rewards_per_token_paid)`) would underflow for any user who checkpointed between the two distributions. The checked_sub returns `Err(Underflow)`, which would permanently lock that user out of claiming rewards. In the worst case, if unchecked math were ever introduced, a wrap-around underflow would produce a massive `reward_delta`, allowing the user to drain the entire escrow vault.

**Formal Property:**
```
forall pool_states s1, s2 where s2 = add_to_cumulative(s1):
  s2.rewards_per_token_stored >= s1.rewards_per_token_stored
```

**Verification Approach:**
Proptest with 10,000+ iterations generating arbitrary `(total_staked > 0, pending_rewards, existing_cumulative)` triples. After calling `add_to_cumulative`, assert `new_cumulative >= old_cumulative`. This is already partially covered by existing proptest Property 4 (math.rs:589-615), but should be extended to include the `update_cumulative` handler's inline math (update_cumulative.rs:89-98) which duplicates the formula outside of `add_to_cumulative`.


---

### INV-STAKE-002: Reward Conservation (No Over-Extraction)

**Function:** `update_rewards` at `math.rs:36-67`, `add_to_cumulative` at `math.rs:91-127`
**Pattern:** VP-026, GL INV-5
**Tool:** Proptest
**Confidence:** high

**Plain English:** The sum of all individual user reward claims must never exceed the total SOL deposited into the escrow vault. Integer division truncation ensures the protocol keeps dust rather than over-paying.

**Why It Matters:** If a rounding error or overflow causes any single user's computed `pending` to exceed their pro-rata share, the escrow vault would become insolvent. Earlier claimers would drain it, and later claimers would face `InsufficientEscrowBalance` errors (claim.rs:103). This is the most critical invariant -- a violation is a direct fund drain.

**Formal Property:**
```
forall users U_1..U_n with staked_balance_i and checkpoint_i:
  SUM(floor(staked_balance_i * (global_cumulative - checkpoint_i) / PRECISION)) <= total_deposited_rewards

Stronger per-user form:
  forall user with balance <= total_staked:
    floor(balance * (pending * PRECISION / total_staked) / PRECISION) <= pending
```

**Verification Approach:**
Proptest with N=2..10 synthetic users whose balances sum to `total_staked`. Distribute rewards via `add_to_cumulative`, then compute each user's pending via the `update_rewards` formula. Assert `sum(all_pending) <= total_deposited`. This extends existing Property 2 (math.rs:493-527) from single-user to multi-user scenarios. Critical edge: users with dust balances (1 token) vs users with near-total-staked balances.


---

### INV-STAKE-003: Late Staker Gets Zero Past Rewards

**Function:** `handler` at `stake.rs:108-113` (new user initialization)
**Pattern:** VP-020, VP-022
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** When a new user stakes for the first time, their `rewards_per_token_paid` checkpoint is set to the current `rewards_per_token_stored`. This means their reward delta is zero for all previously distributed rewards -- they earn nothing from before they staked.

**Why It Matters:** If the checkpoint is initialized to 0 instead of the current accumulator, the new staker would retroactively claim all rewards ever distributed. With a large cumulative (e.g., 1e20 after many epochs), a user staking 1 PROFIT would instantly claim `1_000_000 * 1e20 / 1e18 = 100_000_000` lamports (0.1 SOL) that belongs to other stakers. This drains the escrow at the expense of legitimate long-term stakers.

**Formal Property:**
```
forall new_user staking at time T:
  user.rewards_per_token_paid = pool.rewards_per_token_stored (at time T)
  => reward_delta = 0
  => pending = 0 immediately after staking
```

**Verification Approach:**
LiteSVM integration test: (1) Initialize pool with dead stake. (2) Deposit 1 SOL rewards, call update_cumulative. (3) New user stakes 1 PROFIT. (4) Immediately call claim -- should get `NothingToClaim` error. (5) Deposit another 1 SOL, call update_cumulative again. (6) Claim -- should get only the second epoch's pro-rata share, not both.


---

### INV-STAKE-004: Flash-Loan Resistance (Same-Epoch Stake/Unstake = 0 Rewards)

**Function:** `handler` at `update_cumulative.rs:78-81` (epoch guard), `update_rewards` at `math.rs:36-67`
**Pattern:** GL flash-loan resistance
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** A user who stakes and unstakes within the same epoch (between two `update_cumulative` calls) earns zero rewards. The accumulator only changes at epoch boundaries, so the reward delta within an epoch is always zero.

**Why It Matters:** Without epoch-gated accumulator updates, an attacker could flash-loan a large amount of PROFIT, stake it, trigger a reward distribution, claim, unstake, and repay the loan -- capturing a disproportionate share of rewards in a single transaction. The epoch guard at `update_cumulative.rs:78-81` (`epoch > pool.last_update_epoch`) prevents the accumulator from being updated more than once per epoch.

**Formal Property:**
```
forall user who stakes at slot S and unstakes at slot S' where no update_cumulative occurs between S and S':
  rewards_earned = 0
  (because rewards_per_token_stored is unchanged between S and S')
```

**Verification Approach:**
LiteSVM integration test: (1) Initialize pool, deposit rewards. (2) Call update_cumulative for epoch N. (3) User stakes large amount. (4) Attempt update_cumulative for epoch N again -- should fail with `AlreadyUpdated`. (5) User unstakes immediately. (6) Verify rewards_earned = 0. Also test: stake, wait for epoch N+1 update_cumulative, then unstake -- should earn rewards for that one epoch.


---

### INV-STAKE-005: PRECISION Overflow Bound (u64 * u128 fits u128)

**Function:** `update_rewards` at `math.rs:46-50`, `add_to_cumulative` at `math.rs:107-111`
**Pattern:** VP-082, VP-086
**Tool:** Proptest (Kani not installed -- degrades to probabilistic)
**Confidence:** high

**Plain English:** The intermediate multiplication `(balance as u128) * reward_delta` at math.rs:47 and `(pending as u128) * PRECISION` at math.rs:108 must fit within u128. The tightest bound is `u64::MAX * PRECISION = 1.844e19 * 1e18 = 1.844e37`, which is below `u128::MAX = 3.402e38` but only by a factor of ~18.4x.

**Why It Matters:** If `reward_delta` (a u128) grows beyond `u128::MAX / u64::MAX = 18.446e18` (approximately 18.4 * PRECISION), then a user with `staked_balance = u64::MAX` would overflow the multiplication at math.rs:47. The checked_mul catches this and returns `Err(Overflow)`, but this permanently blocks the user from claiming or unstaking because `update_rewards` is called before every balance change. Effectively, their funds are locked.

**Formal Property:**
```
-- In add_to_cumulative (math.rs:107-108):
(pending_rewards as u128) * PRECISION <= u128::MAX
Since pending_rewards: u64, PRECISION = 1e18:
  u64::MAX * 1e18 = 1.844e37 < 3.402e38 = u128::MAX  [SAFE: 18.4x headroom]

-- In update_rewards (math.rs:46-48):
(staked_balance as u128) * reward_delta <= u128::MAX
Since staked_balance: u64:
  reward_delta must be <= u128::MAX / u64::MAX = 18,446,744,073 (approx 18.4e9)
  In PRECISION-scaled terms: reward_delta <= ~18.4 * PRECISION

-- Accumulator growth per epoch:
reward_per_token_increment = pending * PRECISION / total_staked
Worst case (MINIMUM_STAKE = 1e6 denominator, u64::MAX pending):
  u64::MAX * 1e18 / 1e6 = 1.844e31 per epoch
  Epochs to overflow 18.4 * PRECISION = 1.844e19:
  IMPOSSIBLE IN ONE EPOCH (1.844e31 >> 1.844e19)
  => A SINGLE massive deposit to MINIMUM_STAKE can already push delta past safe bound
```

**Verification Approach:**
Proptest: Generate `(total_staked in [MINIMUM_STAKE..u64::MAX], pending in [1..u64::MAX])`. Compute `reward_per_token`. Then for a second user with `balance = u64::MAX`, compute `balance * reward_per_token`. Assert checked_mul succeeds. **CRITICAL NOTE**: This invariant is expected to FAIL for extreme inputs -- specifically when `total_staked = MINIMUM_STAKE` and `pending = u64::MAX`, the reward_per_token = 1.844e31, and `u64::MAX * 1.844e31 >> u128::MAX`. The checked_mul will return Err, which is safe (no panic/exploit), but means a user with max balance would be unable to claim. The existing proptest Property 3 (math.rs:545-573) bounds `reward_delta <= u128::MAX / u64::MAX`, which is the safe range but not the realistic accumulator range. **Need to verify the accumulator cannot realistically reach the overflow threshold.**


---

### INV-STAKE-006: Accumulator Overflow Lifetime Bound

**Function:** `add_to_cumulative` at `math.rs:114-116`, `handler` at `update_cumulative.rs:95-98`
**Pattern:** VP-021
**Tool:** Proptest (analytical + probabilistic)
**Confidence:** medium

**Plain English:** The cumulative `rewards_per_token_stored` (u128) must not overflow within the protocol's realistic lifetime. Each epoch adds `pending * PRECISION / total_staked`. Over many epochs, this sum must stay below the overflow threshold identified in INV-STAKE-005.

**Why It Matters:** If the accumulator overflows u128, `checked_add` at math.rs:115 returns `Err(Overflow)`, and no further epoch transitions can succeed. All pending rewards would be permanently stuck, and no user could stake, unstake, or claim (since `update_rewards` reads the accumulator). The entire staking system would be bricked.

**Formal Property:**
```
-- Realistic worst case (token-economics-model.md):
  Daily volume: 10,000 SOL, avg tax: 7.5%, staking share: 75%
  Daily staking rewards: 10,000 * 0.075 * 0.75 = 562.5 SOL = 562_500_000_000 lamports
  Minimum stakers: MINIMUM_STAKE = 1,000,000 (dead stake only, no users)

  Per-epoch increment (48 epochs/day):
    562_500_000_000 / 48 * PRECISION / 1_000_000
    = 11_718_750_000 * 1e18 / 1e6
    = 1.172e22 per epoch

  u128::MAX / 1.172e22 = 2.9e16 epochs
  At 48 epochs/day: 2.9e16 / 48 / 365 = ~1.66 trillion years [SAFE]

-- Adversarial minimum stake (dead stake only, massive rewards):
  If somehow total_staked = MINIMUM_STAKE = 1e6 AND pending_rewards = u64::MAX per epoch:
    increment = u64::MAX * 1e18 / 1e6 = 1.844e31 per epoch
    u128::MAX / 1.844e31 = 1.844e7 epochs
    At 48 epochs/day: ~1,052 years [SAFE but much closer]

  However: for user with balance approaching u64::MAX, overflow in
  update_rewards happens much sooner (see INV-STAKE-005).
```

**Verification Approach:**
Analytical proof (above) combined with proptest simulation: run 10,000 epochs with realistic reward rates (100-1000 SOL/epoch) and realistic stake sizes (1M-50M PROFIT). Assert accumulator stays within the bound `u128::MAX / u64::MAX` (the user-safety bound from INV-STAKE-005). For the adversarial bound, simulate with MINIMUM_STAKE and maximum deposits to find the epoch count at which a max-balance user would be blocked.


---

### INV-STAKE-007: Truncation Favors Protocol (Floor Division)

**Function:** `update_rewards` at `math.rs:49-50`, `add_to_cumulative` at `math.rs:107-111`
**Pattern:** VP-085, MATH-05
**Tool:** Proptest
**Confidence:** high

**Plain English:** All reward calculations use integer division, which truncates (floors) toward zero. This means the protocol always keeps the dust. No user can extract more than their mathematical share, and the sum of all claims is always less than or equal to the total deposited.

**Why It Matters:** If any code path rounds up instead of truncating, the sum of user claims could exceed escrow balance. For example, 3 users each owed 0.333... SOL: if rounded up, total claims = 1.0+ SOL from a 1.0 SOL deposit, causing the last claimer to face `InsufficientEscrowBalance`. The floor-division pattern is the standard DeFi defense against this class of insolvency.

**Formal Property:**
```
-- In add_to_cumulative:
  reward_per_token = floor(pending * PRECISION / total_staked)
  (Rust integer division truncates toward zero for non-negative operands)

-- In update_rewards:
  pending = floor(balance * reward_delta / PRECISION)
  (Same: Rust u128 / u128 truncates)

-- Double truncation bound:
  actual_user_reward = floor(balance * floor(pending * PRECISION / total_staked) / PRECISION)
  <= balance * pending / total_staked  (the true pro-rata share)

-- Multi-user conservation:
  SUM_i(floor(balance_i * rpt / PRECISION)) <= SUM_i(balance_i) * rpt / PRECISION
                                              = total_staked * rpt / PRECISION
                                              <= pending  (by floor in rpt computation)
```

**Verification Approach:**
Proptest with N users (2..20), random balances summing to total_staked, single epoch reward distribution. Compute each user's pending via the floor-division chain. Assert `sum(all_pending) <= deposited_rewards`. Edge cases: all users have balance=1 (maximum dust loss), one user has balance=total_staked-1 (minimum dust loss).


---

### INV-STAKE-008: Silent u128-to-u64 Truncation in update_rewards

**Function:** `update_rewards` at `math.rs:50` -- `as u64` cast
**Pattern:** VP-084, VP-085
**Tool:** Proptest
**Confidence:** high

**Plain English:** At math.rs:50, the result of `(balance * reward_delta) / PRECISION` (a u128) is cast to u64 via `as u64`. If this intermediate u128 value exceeds `u64::MAX`, Rust's `as` cast silently truncates the high bits, returning a wrong (smaller) value. This is NOT caught by checked arithmetic.

**Why It Matters:** If a user's pending reward computation produces a u128 result > u64::MAX (approximately 18.4 SOL in lamports = 18,446,744,073 lamports), the `as u64` cast wraps and they receive dramatically fewer rewards than earned. The user loses funds permanently -- the rewards are computed, but the truncated value is added to `rewards_earned`, and the checkpoint is advanced past those rewards. They can never reclaim the difference. This is a **silent data loss bug**, not an explicit error.

**Formal Property:**
```
-- At math.rs:50:
  let pending = (... intermediate u128 ...) as u64;

-- Safe iff:
  (balance as u128) * reward_delta / PRECISION <= u64::MAX

-- When can this fail?
  balance = u64::MAX = 1.844e19
  reward_delta = 1e18 (1 PRECISION unit = 1 token-worth of rewards per token)
  pending_u128 = 1.844e19 * 1e18 / 1e18 = 1.844e19 = u64::MAX [BOUNDARY]

  reward_delta = 2e18 (2 PRECISION units)
  pending_u128 = 1.844e19 * 2e18 / 1e18 = 3.688e19 > u64::MAX [OVERFLOW!]
  as u64 -> truncated to low 64 bits = garbage value

-- Realistic scenario:
  User stakes 18B PROFIT (impossible -- supply is 50M = 5e13 base units)
  => u64::MAX balance is unreachable with PROFIT's supply cap.

  But: reward_delta can grow unbounded (see INV-STAKE-006).
  If reward_delta > u64::MAX (1.844e19), even balance=1 produces:
    1 * 1.844e19 / 1e18 = 18.44 > u64::MAX? No: 18.44 fits u64.

  More precisely: pending_u128 > u64::MAX requires:
    balance * reward_delta > u64::MAX * PRECISION = 1.844e37
  With max realistic balance (5e13) and PRECISION = 1e18:
    reward_delta > 1.844e37 / 5e13 = 3.688e23
  That is ~3.688e5 * PRECISION, or 368,800 full reward units per token.
  At 562.5 SOL/day to MINIMUM_STAKE: delta grows ~1.172e22/epoch.
  After 31 epochs: 31 * 1.172e22 = 3.63e23 -- close to threshold.
  31 epochs = ~15 hours of dead-stake-only operation.
```

**Verification Approach:**
Proptest: Generate `(balance in [1..PROFIT_TOTAL_SUPPLY_UNITS], reward_delta in [0..1e30])`. Compute `pending_u128 = balance * reward_delta / PRECISION`. Assert `pending_u128 <= u64::MAX`. The test should identify the boundary conditions. **RECOMMENDATION**: Replace `as u64` with `u64::try_from(...).ok_or(StakingError::Overflow)?` to make this an explicit error rather than silent truncation.


---

### INV-STAKE-009: Zero Stakers -- Pending Rewards Handling Discrepancy

**Function:** `add_to_cumulative` at `math.rs:97-101`, `handler` at `update_cumulative.rs:88-108`
**Pattern:** GL "Zero stakers -> rewards stay pending"
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** When `total_staked == 0`, the `add_to_cumulative` helper in math.rs correctly preserves `pending_rewards` (returns early without clearing). However, the actual on-chain `update_cumulative` instruction handler at `update_cumulative.rs:108` unconditionally clears `pending_rewards = 0` even when `total_staked == 0` and rewards were not distributed. This means pending rewards are DESTROYED if an epoch transition occurs with no stakers.

**Why It Matters:** If all users unstake (leaving only dead stake at MINIMUM_STAKE -- which cannot be zero due to initialization), this discrepancy is mitigated. But if a bug or edge case allows `total_staked` to reach 0 (e.g., dead stake withdrawal or account corruption), any SOL rewards accumulated during that epoch would be permanently lost. The SOL remains in the escrow vault but the accounting (`pending_rewards`) is zeroed, creating a discrepancy between escrow balance and tracked rewards. Over time this leaks value from the protocol.

**Formal Property:**
```
-- math.rs add_to_cumulative (correct):
  if total_staked == 0: return Ok(0)  // pending_rewards unchanged

-- update_cumulative.rs handler (DISCREPANCY):
  if rewards_added > 0 && pool.total_staked > 0:
    // distribute
  pool.pending_rewards = 0;  // UNCONDITIONAL at line 108

-- Expected: pool.pending_rewards should only be cleared when distribution succeeds
-- Actual: pool.pending_rewards is always cleared

-- Note: Dead stake (MINIMUM_STAKE = 1e6) prevents total_staked == 0 in normal
   operation. The dead stake has no owner and cannot be unstaked. This makes
   the bug unreachable under normal conditions, but it remains a code-level
   discrepancy between the helper and the instruction handler.
```

**Verification Approach:**
LiteSVM test: (1) Initialize pool (total_staked = MINIMUM_STAKE). (2) Deposit 1 SOL rewards. (3) Somehow set total_staked = 0 (may require direct account manipulation in test). (4) Call update_cumulative. (5) Verify pending_rewards is preserved (currently it would be zeroed). Also: unit test comparing `add_to_cumulative` behavior vs `update_cumulative` handler behavior with total_staked = 0. The helper preserves; the handler destroys.


---

### INV-STAKE-010: Multiply Before Divide (Precision Ordering)

**Function:** `update_rewards` at `math.rs:46-50`, `add_to_cumulative` at `math.rs:107-111`
**Pattern:** VP-084
**Tool:** Proptest
**Confidence:** high

**Plain English:** Both reward formulas multiply before dividing to maximize intermediate precision. In `add_to_cumulative`: `pending * PRECISION / total_staked` (multiply by 1e18 first, then divide). In `update_rewards`: `balance * reward_delta / PRECISION` (multiply first, then divide by 1e18). If the operations were reversed (divide first), small values would truncate to zero prematurely.

**Why It Matters:** If `add_to_cumulative` computed `pending / total_staked * PRECISION` instead, any epoch where `pending < total_staked` would produce `reward_per_token = 0`, and those rewards would be silently lost (pending is cleared to 0 regardless). For example, 100 lamports of rewards across 1,000,000 staked tokens: correct = `100 * 1e18 / 1e6 = 1e14`; incorrect = `100 / 1e6 * 1e18 = 0 * 1e18 = 0`. The rewards vanish.

**Formal Property:**
```
-- add_to_cumulative (math.rs:107-111):
  CORRECT:   floor(pending * PRECISION / total_staked)
  INCORRECT: floor(pending / total_staked) * PRECISION  [LOSES PRECISION]

  Difference when pending < total_staked:
    Correct: nonzero (PRECISION amplifies before division)
    Incorrect: 0 (integer division kills small numerator)

-- update_rewards (math.rs:46-50):
  CORRECT:   floor(balance * reward_delta / PRECISION)
  INCORRECT: floor(balance / PRECISION) * reward_delta  [LOSES PRECISION]

  Difference when balance < PRECISION (always true since balance is u64 < 1e18):
    Correct: nonzero for large reward_delta
    Incorrect: always 0
```

**Verification Approach:**
Proptest: For each generated `(pending, total_staked)` pair where `pending < total_staked`, verify that `pending * PRECISION / total_staked > 0`. Similarly for `(balance, reward_delta)` where `balance < PRECISION`, verify the correct ordering produces nonzero when `reward_delta` is large enough. Existing test at math.rs:231-239 partially covers this (1 lamport, 1B staked -> rpt = 1e9), but does not test the negative case.


---

### INV-STAKE-011: Dust Reward Accumulation for Small Stakers

**Function:** `update_rewards` at `math.rs:46-50`
**Pattern:** VP-025
**Tool:** Proptest
**Confidence:** medium

**Plain English:** A user staking the minimum amount (1 PROFIT = 1,000,000 base units) must eventually earn rewards if the accumulator grows sufficiently. The PRECISION multiplier (1e18) prevents permanent zero rewards for small stakers across multiple epochs.

**Why It Matters:** If small stakers permanently earn 0 due to truncation, they have no incentive to participate. More critically, their stake dilutes the pool (reducing per-token rewards for others) without them claiming anything -- the rewards that "should" go to them are effectively lost as protocol dust. Over time this could create a significant discrepancy between escrow balance and total claimable rewards.

**Formal Property:**
```
-- Minimum stake = MINIMUM_STAKE = 1,000,000 (1 PROFIT, 6 decimals)
-- Per-epoch reward_delta at minimum practical levels:
  If pool distributes 1 lamport to MINIMUM_STAKE total stakers:
    rpt_increment = 1 * 1e18 / 1_000_000 = 1e12

  User with balance=1 (sub-minimum, but testing the math):
    pending = 1 * 1e12 / 1e18 = 0 (truncated)
    => Single dust-amount user earns 0 from 1 lamport distribution.

  User with balance=1,000,000 (MINIMUM_STAKE):
    pending = 1_000_000 * 1e12 / 1e18 = 1
    => Minimum staker earns 1 lamport. [CORRECT]

-- Across N epochs:
  After N epochs, rpt grows by N * 1e12.
  User with balance=1: pending = 1 * N * 1e12 / 1e18 = floor(N / 1e6)
  Needs N >= 1,000,000 epochs (~57 years at 48/day) to earn 1 lamport.
  => Dust users (sub-MINIMUM_STAKE) effectively earn nothing.
  => MINIMUM_STAKE users earn from epoch 1. [BY DESIGN]
```

**Verification Approach:**
Proptest: Simulate 100 epochs with realistic rewards (1 SOL each). For users with balance=MINIMUM_STAKE, verify `pending > 0` after at least 1 epoch. For users with balance=1, verify that pending eventually becomes nonzero after sufficient epochs. The threshold should be documented as a protocol property.


---

### INV-STAKE-012: Reward Chunking Consistency (Time Additivity)

**Function:** `add_to_cumulative` at `math.rs:91-127`, `update_rewards` at `math.rs:36-67`
**Pattern:** VP-019
**Tool:** Proptest
**Confidence:** medium

**Plain English:** Distributing R rewards in one epoch should produce the same (within +/- 1 rounding) total user payout as distributing R/2 rewards in two consecutive epochs. Chunking time should not change total rewards beyond truncation error.

**Why It Matters:** If chunking produces materially different results, an attacker could manipulate epoch timing (by controlling when `update_cumulative` is called) to maximize or minimize rewards for specific stakers. For instance, an attacker who controls the crank could split a large reward into many tiny epochs, each of which truncates to 0 for small stakers, effectively stealing their share.

**Formal Property:**
```
-- Single distribution:
  rpt_single = floor(R * PRECISION / total_staked)
  user_reward_single = floor(balance * rpt_single / PRECISION)

-- Split distribution (two halves):
  rpt_half1 = floor((R/2) * PRECISION / total_staked)
  rpt_half2 = floor((R - R/2) * PRECISION / total_staked)
  rpt_split = rpt_half1 + rpt_half2
  user_reward_split = floor(balance * rpt_split / PRECISION)

-- Property:
  |user_reward_single - user_reward_split| <= 1 (one lamport rounding tolerance)
```

**Verification Approach:**
Proptest: Generate `(R, total_staked, balance)` triples. Compute rewards via single-shot and two-half distributions. Assert the difference is at most 1 lamport per truncation step (at most 2 lamports for the double-truncation chain). Particular attention to cases where `R` is odd (R/2 truncates) and `total_staked` does not evenly divide `R * PRECISION`.


---

### INV-STAKE-013: Checkpoint Update Prevents Double-Claiming

**Function:** `update_rewards` at `math.rs:58-59`
**Pattern:** VP-020
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** After `update_rewards` runs, the user's `rewards_per_token_paid` is set to the current global `rewards_per_token_stored`. Calling `update_rewards` again without any new epoch distribution produces `reward_delta = 0` and adds 0 to `rewards_earned`. A user cannot claim the same rewards twice.

**Why It Matters:** If the checkpoint is not updated (or is updated to the wrong value), each call to stake/unstake/claim would re-compute the same pending rewards and add them again. An attacker could repeatedly call claim to drain the escrow. This is the core re-entrancy/double-claim defense in the Synthetix pattern.

**Formal Property:**
```
-- After update_rewards(pool, user):
  user.rewards_per_token_paid == pool.rewards_per_token_stored

-- Therefore, immediately calling update_rewards again:
  reward_delta = pool.rewards_per_token_stored - user.rewards_per_token_paid = 0
  pending = balance * 0 / PRECISION = 0
  rewards_earned unchanged (0 added)
```

**Verification Approach:**
LiteSVM integration test: (1) Stake, deposit rewards, update_cumulative. (2) Call claim (triggers update_rewards internally). (3) Call claim again -- should get `NothingToClaim`. (4) Inspect on-chain state: `user.rewards_per_token_paid == pool.rewards_per_token_stored`. Also proptest: for arbitrary `(pool_state, user_state)`, call update_rewards twice in sequence and verify second call adds 0 to rewards_earned.


---

### INV-STAKE-014: Dead Stake Prevents Division by Zero

**Function:** `handler` at `initialize_stake_pool.rs:138`, `handler` at `update_cumulative.rs:88-93`
**Pattern:** VP-025 (related)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The pool is initialized with `total_staked = MINIMUM_STAKE = 1,000,000` via a dead stake that cannot be unstaked (no UserStake account is created for it). This guarantees `total_staked > 0` at all times, preventing division by zero in `reward_per_token = pending * PRECISION / total_staked`.

**Why It Matters:** If `total_staked` reaches 0, the division at update_cumulative.rs:92 would produce `DivisionByZero` error, bricking all epoch transitions. No rewards could ever be distributed again. The guard at update_cumulative.rs:88 (`if rewards_added > 0 && pool.total_staked > 0`) skips division when total_staked is 0, but this causes rewards to be lost (see INV-STAKE-009). The dead stake ensures neither path is taken in normal operation.

**Formal Property:**
```
-- Post-initialization:
  pool.total_staked = MINIMUM_STAKE = 1_000_000

-- Dead stake has no owner (no UserStake account with owner = authority):
  The authority's tokens are transferred to stake_vault but no UserStake
  PDA is created. Nobody can call unstake for these tokens.

-- Therefore:
  pool.total_staked >= MINIMUM_STAKE at all times
  (assuming no bug in unstake that allows total_staked to go below dead stake)

-- Unstake safety:
  unstake.rs:187 uses checked_sub, which would underflow if amount > total_staked.
  But user.staked_balance <= total_staked - MINIMUM_STAKE (since dead stake is
  not in any UserStake account), so pool.total_staked - amount >= MINIMUM_STAKE.
```

**Verification Approach:**
LiteSVM: (1) Initialize pool. (2) Verify total_staked = MINIMUM_STAKE. (3) User stakes 1000 PROFIT. (4) User unstakes 1000 PROFIT. (5) Verify total_staked = MINIMUM_STAKE (dead stake remains). (6) Attempt to unstake MINIMUM_STAKE more -- should fail (no UserStake with that balance). Also: verify that sum of all UserStake.staked_balance + MINIMUM_STAKE == pool.total_staked.


---

### INV-STAKE-015: Escrow Solvency (Claims <= Escrow Balance)

**Function:** `handler` at `claim.rs:102-111`, `handler` at `unstake.rs:162-166`
**Pattern:** VP-026 (runtime enforcement)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Both claim and unstake verify `escrow_vault.lamports() >= rewards_to_claim` before transferring SOL. This runtime check prevents the escrow from going below zero even if accounting has a bug.

**Why It Matters:** This is the last line of defense. Even if the math invariants (INV-STAKE-002, INV-STAKE-007) are violated and a user computes a reward larger than their share, the escrow balance check prevents actual over-extraction. However, it shifts the impact from "user drains vault" to "later users cannot claim" -- the escrow becomes insolvent from an accounting perspective even if it doesn't actually go negative.

**Formal Property:**
```
-- Pre-condition for claim (claim.rs:102-103):
  escrow_vault.lamports() >= user.rewards_earned

-- Pre-condition for unstake (unstake.rs:162-166):
  escrow_vault.lamports() >= rewards_to_claim (= user.rewards_earned)

-- Stronger accounting invariant:
  escrow_vault.lamports() >= SUM(all users' rewards_earned) + pool.pending_rewards
  (This is NOT checked on-chain -- only individual claims are bounded)
```

**Verification Approach:**
LiteSVM multi-user scenario: (1) Initialize pool, 3 users stake equal amounts. (2) Deposit 3 SOL rewards, update_cumulative. (3) Each user claims 1 SOL. (4) Verify escrow balance is approximately 0 (dust from truncation may remain). (5) Fourth claim attempt should fail with `NothingToClaim` or `InsufficientEscrowBalance`. Also: adversarial test where rewards_earned is manually inflated (direct account modification) to verify the escrow check catches it.


---

### INV-STAKE-016: Deposit Rewards Reconciliation

**Function:** `handler` at `deposit_rewards.rs:99-102`
**Pattern:** VP-026 (related)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** After incrementing `pending_rewards`, the deposit_rewards handler verifies `escrow_vault.lamports() >= pool.pending_rewards`. This catches cases where the Tax Program's SOL transfer was short-changed or failed silently.

**Why It Matters:** If `pending_rewards` can be inflated beyond the actual escrow balance, then when rewards are distributed and claimed, the escrow check in claim.rs would fail for some users. The reconciliation at deposit time catches this at the earliest possible point, before the inflated accounting propagates through the system.

**Formal Property:**
```
-- After deposit_rewards:
  escrow_vault.lamports() >= pool.pending_rewards

-- Note: This checks cumulative pending, not just the current deposit.
  If previous deposits were reconciled correctly, this holds by induction.

-- Edge case: escrow receives lamports outside of deposit_rewards
  (e.g., someone sends SOL directly to the PDA). This would make
  escrow_vault.lamports() > pool.pending_rewards, which is safe
  (protocol has more SOL than tracked -- dust accumulation).
```

**Verification Approach:**
LiteSVM: (1) Initialize pool. (2) Call deposit_rewards with amount=1000 but only transfer 500 SOL to escrow beforehand. (3) Verify deposit_rewards fails with `InsufficientEscrowBalance`. (4) Transfer remaining 500 SOL. (5) Call deposit_rewards again -- should succeed. Also: verify that repeated deposits correctly sum in pending_rewards and reconciliation holds cumulatively.


---

## Summary Table

| ID | Name | Pattern | Tool | Confidence | Severity if Violated |
|----|------|---------|------|------------|---------------------|
| INV-STAKE-001 | Cumulative Monotonicity | VP-019, INV-4 | Proptest | high | Critical (fund lock) |
| INV-STAKE-002 | Reward Conservation | VP-026, INV-5 | Proptest | high | Critical (fund drain) |
| INV-STAKE-003 | Late Staker Zero Past Rewards | VP-020, VP-022 | LiteSVM | high | Critical (fund drain) |
| INV-STAKE-004 | Flash-Loan Resistance | GL flash-loan | LiteSVM | high | Critical (fund drain) |
| INV-STAKE-005 | PRECISION Overflow Bound | VP-082, VP-086 | Proptest | high | High (fund lock) |
| INV-STAKE-006 | Accumulator Lifetime Bound | VP-021 | Proptest | medium | High (system brick) |
| INV-STAKE-007 | Truncation Favors Protocol | VP-085, MATH-05 | Proptest | high | Critical (insolvency) |
| INV-STAKE-008 | Silent u64 Truncation | VP-084, VP-085 | Proptest | high | High (silent fund loss) |
| INV-STAKE-009 | Zero-Staker Pending Loss | GL zero-staker | LiteSVM | high | Medium (fund leak) |
| INV-STAKE-010 | Multiply Before Divide | VP-084 | Proptest | high | High (permanent zero rewards) |
| INV-STAKE-011 | Dust Reward Accumulation | VP-025 | Proptest | medium | Low (design property) |
| INV-STAKE-012 | Chunking Consistency | VP-019 | Proptest | medium | Medium (crank manipulation) |
| INV-STAKE-013 | Checkpoint Double-Claim | VP-020 | LiteSVM | high | Critical (fund drain) |
| INV-STAKE-014 | Dead Stake Division Safety | VP-025 | LiteSVM | high | Critical (system brick) |
| INV-STAKE-015 | Escrow Solvency Check | VP-026 | LiteSVM | high | Critical (last defense) |
| INV-STAKE-016 | Deposit Reconciliation | VP-026 | LiteSVM | high | High (inflated accounting) |


## Findings Requiring Attention

### FINDING-1: Silent `as u64` Truncation (INV-STAKE-008)

**Severity:** High
**Location:** `math.rs:50`
**Current code:** `... .checked_div(PRECISION).ok_or(StakingError::DivisionByZero)? as u64;`
**Issue:** The `as u64` cast silently truncates if the u128 result exceeds `u64::MAX`. All other arithmetic uses checked methods, but this single cast is unchecked.
**Recommendation:** Replace with `u64::try_from(...).map_err(|_| StakingError::Overflow)?`
**Risk assessment:** Unreachable with current PROFIT supply (50M = 5e13 base units), but becomes reachable if the accumulator grows beyond ~3.688e23 (see analysis in INV-STAKE-008). With dead-stake-only operation and maximum deposits, this threshold is approximately 31 epochs (~15 hours) away.

### FINDING-2: update_cumulative Handler vs Helper Discrepancy (INV-STAKE-009)

**Severity:** Medium (mitigated by dead stake)
**Location:** `update_cumulative.rs:108` vs `math.rs:97-101`
**Issue:** The on-chain handler clears `pending_rewards = 0` unconditionally, even when `total_staked == 0` and rewards were not distributed. The helper function `add_to_cumulative` correctly preserves pending in this case.
**Current mitigation:** Dead stake ensures `total_staked >= MINIMUM_STAKE` at all times.
**Risk:** If dead stake invariant is ever violated (account corruption, future code change), pending rewards are silently destroyed.
**Recommendation:** Move `pool.pending_rewards = 0` inside the `if rewards_added > 0 && pool.total_staked > 0` block, matching the helper's behavior.
