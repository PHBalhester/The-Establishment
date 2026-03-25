---
phase: 26-core-staking-program
plan: 02
subsystem: staking
tags: [rust, anchor, math, synthetix, quarry, cumulative-rewards, defi]

# Dependency graph
requires:
  - phase: 26-01
    provides: StakePool and UserStake account structures with fields for cumulative math
provides:
  - update_rewards function for user reward calculation
  - add_to_cumulative function for epoch reward distribution
  - Comprehensive unit tests for math correctness
affects: [26-03-stake-unstake, 26-04-claim, 27-staking-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synthetix/Quarry cumulative reward-per-token pattern"
    - "1e18 PRECISION constant for DeFi math"
    - "All arithmetic uses checked_* methods"
    - "Division truncates (floors) per MATH-05"

key-files:
  created:
    - programs/staking/src/helpers/mod.rs
    - programs/staking/src/helpers/math.rs
  modified:
    - programs/staking/src/lib.rs

key-decisions:
  - "update_rewards uses immutable pool reference (read-only during calculation)"
  - "Clock::get() called in update_rewards - requires Solana runtime (integration tests for full function)"
  - "add_to_cumulative returns u64 rewards_distributed (useful for CPI callers)"

patterns-established:
  - "Reward formula: pending = (global - checkpoint) * balance / PRECISION"
  - "Distribution formula: reward_per_token = pending * PRECISION / total_staked"
  - "Pure math tests verify formulas without Solana runtime"

# Metrics
duration: 4min
completed: 2026-02-06
---

# Phase 26 Plan 02: Core Math Module Summary

**Synthetix/Quarry cumulative reward-per-token pattern implemented with update_rewards and add_to_cumulative functions, 17 unit tests verifying math correctness**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-06T22:41:04Z
- **Completed:** 2026-02-06T22:45:10Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- Created helpers/math.rs with core staking math functions
- update_rewards: calculates user's pending rewards before any balance change
- add_to_cumulative: distributes pending_rewards to cumulative at epoch end
- 17 unit tests covering edge cases, overflow boundaries, and truncation behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Create math module with update_rewards and add_to_cumulative** - `c82c170` (feat)
2. **Task 2: Add comprehensive math unit tests** - `94372d2` (test)

## Files Created/Modified

- `programs/staking/src/helpers/mod.rs` - Helper module exports
- `programs/staking/src/helpers/math.rs` - Core math functions (419 lines)
- `programs/staking/src/lib.rs` - Added helpers module declaration

## Decisions Made

- **update_rewards signature:** Takes immutable `&StakePool` reference since it only reads cumulative state
- **Clock::get() in update_rewards:** Requires Solana runtime, so full function testing deferred to integration tests
- **add_to_cumulative returns u64:** Returns rewards_distributed amount for CPI callers (Epoch Program) to verify

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **solana_program import in tests:** Plan used `solana_program::pubkey::Pubkey` but Anchor re-exports Pubkey via `anchor_lang::prelude::*` - fixed by using `super::*` import
- **Aggressive linter:** IDE/linter kept adding instructions module - repeatedly cleaned up before commits

## Next Phase Readiness

- Math module ready for use by instruction handlers
- Next plan (26-03) can now implement initialize_stake_pool, stake, unstake
- Pattern established: call update_rewards before any staked_balance mutation

---
*Phase: 26-core-staking-program*
*Completed: 2026-02-06*
