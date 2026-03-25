---
phase: 29
plan: 01
subsystem: staking-math-security
tags: [proptest, property-based-testing, overflow-fuzzing, reward-conservation]
requires: [26-02]
provides: [proptest-math-fuzzing, overflow-boundary-validation, conservation-proof]
affects: [29-02, 29-03, 29-04]
tech-stack:
  added: [proptest-1.9]
  patterns: [property-based-testing, random-input-fuzzing, strategy-composition]
key-files:
  created: []
  modified: [programs/staking/Cargo.toml, programs/staking/src/helpers/math.rs, Cargo.lock]
decisions: []
metrics:
  duration: 3m 7s
  completed: 2026-02-09
---

# Phase 29 Plan 01: Proptest Property-Based Tests for Staking Math Summary

Proptest 1.9 added as dev-dependency with 4 property-based tests running 10,000 iterations each, fuzzing overflow boundaries, reward conservation, formula safety, and cumulative monotonicity.

## What Was Done

### Task 1: Add proptest dev-dependency and write property-based tests

**Cargo.toml change:**
Added `proptest = "1.9"` to `[dev-dependencies]` alongside existing `sha2 = "0.10"`.

**Property tests added to `math.rs` test module:**

1. **`add_to_cumulative_no_panic`** (10,000 iterations)
   - Inputs: `total_staked in 1..=u64::MAX`, `pending in 0..=u64::MAX`, `existing_cumulative in 0..=u128::MAX/2`
   - Validates: Function never panics; on Ok: cumulative >= existing and pending == 0; on Err: acceptable overflow for extreme values
   - Security property: Checked arithmetic prevents panic for any valid input combination

2. **`reward_conservation`** (10,000 iterations)
   - Inputs: `total_staked in 1..=1T`, `pending in 1..=1T`, `user_pct in 1..=1M` (scaled to user_balance <= total_staked)
   - Validates: `user_reward <= pending` for any single user (no user can claim more than was deposited)
   - Security property: Floor division means protocol keeps dust, never overpays

3. **`update_rewards_formula_no_panic`** (10,000 iterations)
   - Inputs: `balance in 0..=u64::MAX`, `reward_delta in 0..=u128::MAX/(u64::MAX)`
   - Validates: `checked_mul` and `checked_div(PRECISION)` always return Some within bounded range
   - Security property: The core reward calculation formula stays within u128 for any balance * bounded delta

4. **`cumulative_monotonically_increasing`** (10,000 iterations)
   - Inputs: `total_staked in 1..=1B`, `pending1 in 0..=1B`, `pending2 in 0..=1B`
   - Validates: After two sequential `add_to_cumulative` calls, `second_cumulative >= first_cumulative`
   - Security property: Cumulative never decreases, preventing underflow in `update_rewards` delta calculation

Each property test includes a doc comment explaining the attack scenario, mitigation, and security property validated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed proptest strategy for reward_conservation**
- **Found during:** Task 1 initial test run
- **Issue:** The plan specified `user_balance in 1u64..=1_000_000_000_000u64` with `prop_assume!(user_balance <= total_staked)`, but when both `total_staked` and `user_balance` are drawn independently from the same range, the rejection rate exceeds proptest's default 50% limit (1024 rejections out of 2057 attempts). Proptest aborted with "Too many global rejects."
- **Fix:** Replaced the `user_balance` strategy with a `user_pct in 1u64..=1_000_000u64` percentage strategy, then derived `user_balance = max(1, total_staked * user_pct / 1_000_000)`. This guarantees `user_balance <= total_staked` without any rejections, achieving full 10,000 iterations.
- **Files modified:** `programs/staking/src/helpers/math.rs`
- **Commit:** 559961a

## Test Results

```
running 38 tests
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
```

- 34 existing unit tests: all pass (no regressions)
- 4 new proptest properties: all pass (10,000 iterations each = 40,000 total fuzzing iterations)

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 559961a | test | Add proptest property-based tests for staking math |

## Decisions Made

None -- plan executed as written with one strategy fix (documented above).

## Next Phase Readiness

Plan 29-02 (Attack Simulation Tests - TypeScript) can proceed. The proptest math validation is complete and independent of the TypeScript integration tests. No blockers.
