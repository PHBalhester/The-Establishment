---
phase: 26-core-staking-program
plan: 04
subsystem: staking
tags: [anchor, rust, solana, staking, checkpoint-pattern, cpi]

# Dependency graph
requires:
  - phase: 26-01
    provides: StakePool and UserStake state accounts
  - phase: 26-02
    provides: update_rewards helper function (checkpoint math)
  - phase: 26-03
    provides: initialize_stake_pool instruction (creates vaults)
provides:
  - stake instruction - users deposit PROFIT tokens
  - unstake instruction - users withdraw PROFIT with auto-claim SOL
  - CEI pattern enforcement in both instructions
  - Partial unstake minimum enforcement (dust prevention)
affects: [27-claim-instruction, 28-cpi-operations, 29-integration-testing]

# Tech tracking
tech-stack:
  added: []
  patterns: [checkpoint-pattern, CEI-pattern, init_if_needed]

key-files:
  created:
    - programs/staking/src/instructions/stake.rs
    - programs/staking/src/instructions/unstake.rs
  modified:
    - programs/staking/src/instructions/mod.rs
    - programs/staking/src/lib.rs

key-decisions:
  - "Scope block pattern for mutable borrows before CPI"
  - "Capture values from scope before external interactions"
  - "Auto-full-unstake when remaining < MINIMUM_STAKE"

patterns-established:
  - "Checkpoint pattern: update_rewards called BEFORE any balance change"
  - "CEI pattern: state updates complete before transfer CPIs"
  - "Scope isolation: mutable borrows in inner scope, values captured for outer use"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 26 Plan 04: Stake and Unstake Instructions Summary

**Stake and unstake instructions with checkpoint pattern for flash loan protection and CEI for reentrancy safety**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T22:49:59Z
- **Completed:** 2026-02-06T22:53:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- stake instruction: transfers PROFIT from user to stake_vault, initializes UserStake on first stake
- unstake instruction: transfers PROFIT from vault to user with auto-claim of pending SOL rewards
- update_rewards called BEFORE balance change in both instructions (checkpoint pattern)
- Partial unstake dust prevention: if remaining < MINIMUM_STAKE, auto-full-unstake
- CEI pattern enforced: all state updates complete before any transfer CPI

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement stake instruction** - `cad1592` (feat)
2. **Task 2: Implement unstake instruction with auto-claim** - `509212e` (feat)

## Files Created/Modified

- `programs/staking/src/instructions/stake.rs` - Stake accounts struct and handler with checkpoint pattern
- `programs/staking/src/instructions/unstake.rs` - Unstake accounts struct and handler with auto-claim
- `programs/staking/src/instructions/mod.rs` - Module exports for stake and unstake
- `programs/staking/src/lib.rs` - Program entry points for stake and unstake instructions

## Decisions Made

1. **Scope block pattern for borrow checker**: In unstake, mutable borrows of pool/user are confined to an inner scope block. Values needed for later use (rewards_to_claim, new_balance, new_total_staked) are captured and returned from the scope. This allows the CPI transfer to access ctx.accounts without borrow conflicts.

2. **Pre-capture pool bump**: The pool bump is captured before the mutable borrow scope, then used to build signer seeds for the CPI outside the scope.

3. **Auto-full-unstake enforcement**: When remaining balance after partial unstake would be < MINIMUM_STAKE (1 PROFIT), the instruction automatically unstakes the full balance. This prevents dust positions that can't be further unstaked.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed borrow checker conflict in unstake**
- **Found during:** Task 2 (unstake compilation)
- **Issue:** Rust borrow checker error - mutable borrow of stake_pool conflicted with immutable borrow for CPI authority
- **Fix:** Used scope block pattern to isolate mutable borrows, capture needed values, then use them for CPI outside the scope
- **Files modified:** programs/staking/src/instructions/unstake.rs
- **Verification:** anchor build -p staking succeeds
- **Committed in:** 509212e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Standard Rust borrow checker pattern. No scope creep.

## Issues Encountered

None - both instructions implemented as specified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- stake and unstake instructions complete
- claim instruction needed next (standalone reward claim without unstaking)
- deposit_rewards and update_cumulative CPI instructions pending
- All staking program user operations will be complete after claim

---
*Phase: 26-core-staking-program*
*Completed: 2026-02-06*
