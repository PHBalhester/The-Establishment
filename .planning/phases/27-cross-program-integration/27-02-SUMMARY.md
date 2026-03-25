---
phase: 27-cross-program-integration
plan: 02
subsystem: staking
tags: [anchor, cpi, pda, rewards, precision-math]

# Dependency graph
requires:
  - phase: 26-core-staking-program
    provides: StakePool state with rewards_per_token_stored, pending_rewards, PRECISION
  - phase: 22-25-epoch-vrf-program
    provides: Epoch Program ID, STAKING_AUTHORITY_SEED pattern
provides:
  - update_cumulative instruction in Staking Program
  - Epoch Program CPI gating via seeds::program constraint
  - Double-update prevention via epoch comparison
  - Cumulative rewards distribution math
affects: [28-integration-testing, 29-yield-system-testing, devnet-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "seeds::program constraint for CPI caller verification"
    - "pending * PRECISION / total_staked for reward distribution"
    - "AlreadyUpdated error for double-update prevention"

key-files:
  created:
    - programs/staking/src/instructions/update_cumulative.rs
  modified:
    - programs/staking/src/constants.rs
    - programs/staking/src/instructions/mod.rs
    - programs/staking/src/lib.rs

key-decisions:
  - "epoch_program_id() function matches Epoch Program declare_id!"
  - "seeds::program = epoch_program_id() for CPI authority gating"
  - "epoch > last_update_epoch check prevents double-update"
  - "Clear pending_rewards even when zero to maintain clean state"

patterns-established:
  - "Epoch CPI gating: UpdateCumulative uses seeds::program constraint"
  - "Cumulative math: pending * PRECISION / total_staked"
  - "Epoch tracking: last_update_epoch prevents double distribution"

# Metrics
duration: 15min
completed: 2026-02-07
---

# Phase 27 Plan 02: Update Cumulative Instruction Summary

**CPI-gated update_cumulative instruction enabling Epoch Program to finalize rewards into cumulative tracker using seeds::program constraint**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-07T08:28:37Z
- **Completed:** 2026-02-07T08:43:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added epoch_program_id() constant returning correct Epoch Program pubkey
- Implemented update_cumulative instruction with seeds::program CPI gating
- Added comprehensive unit tests for reward distribution math and edge cases
- Verified AlreadyUpdated protection prevents double-update same epoch

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Epoch Program constants to Staking Program** - `4662807` (feat)
2. **Task 2: Implement update_cumulative instruction** - `6ba9940` (feat)
3. **Task 3: Add unit tests for update_cumulative math** - `9b2da6b` (test)

## Files Created/Modified
- `programs/staking/src/constants.rs` - Added epoch_program_id() function
- `programs/staking/src/instructions/update_cumulative.rs` - New instruction with CPI gating
- `programs/staking/src/instructions/mod.rs` - Export update_cumulative module
- `programs/staking/src/lib.rs` - Register update_cumulative in #[program] block

## Decisions Made
- epoch_program_id() returns "AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod" matching Epoch Program declare_id!
- UpdateCumulative uses Signer<'info> for epoch_authority with seeds::program constraint
- Handler clears pending_rewards to 0 regardless of distribution (maintains clean state)
- CumulativeUpdated event emitted even when rewards_added = 0 (audit trail)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- update_cumulative ready for Epoch Program consume_randomness CPI
- Both CPI targets (deposit_rewards, update_cumulative) now complete in Staking Program
- Next: Implement corresponding CPI calls in Tax and Epoch Programs (Phase 27-03, 27-04)

---
*Phase: 27-cross-program-integration*
*Completed: 2026-02-07*
