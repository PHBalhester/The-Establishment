---
phase: 25-carnage-fund-execution
plan: 04
subsystem: epoch-program
tags: [carnage, fallback, deadline, permissionless, solana, anchor]

# Dependency graph
requires:
  - phase: 25-01
    provides: CarnageFundState, errors, events, constants
  - phase: 25-02
    provides: VRF helpers, initialize_carnage_fund
provides:
  - execute_carnage fallback instruction with deadline validation
  - expire_carnage instruction for clearing expired pending state
  - Permissionless fallback mechanism for Carnage execution
affects: [25-05-devnet-testing, integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deadline validation pattern: slot <= deadline for execute, slot > deadline for expire"
    - "Permissionless instruction pattern: any caller via `pub caller: Signer`"
    - "State clearing pattern: set carnage_action to CarnageAction::None.to_u8()"

key-files:
  created:
    - programs/epoch-program/src/instructions/execute_carnage.rs
    - programs/epoch-program/src/instructions/expire_carnage.rs
  modified:
    - programs/epoch-program/src/instructions/mod.rs
    - programs/epoch-program/src/lib.rs
    - programs/epoch-program/src/instructions/execute_carnage_atomic.rs

key-decisions:
  - "execute_carnage updates last_carnage_epoch since execution succeeded (unlike expire_carnage)"
  - "expire_carnage does NOT update last_carnage_epoch since Carnage didn't execute"
  - "Both instructions emit events with full context for off-chain tracking"

patterns-established:
  - "Deadline boundary: execute uses <=, expire uses > for clear separation"
  - "SOL vault balance read via .lamports() on AccountInfo for event data"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 25 Plan 04: Carnage Fallback and Expiry Summary

**Permissionless execute_carnage (fallback) and expire_carnage instructions with deadline-based validation for Carnage Fund lifecycle management**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T20:18:51Z
- **Completed:** 2026-02-06T20:23:46Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- execute_carnage fallback instruction validates deadline and clears pending state
- expire_carnage instruction clears expired pending state with SOL retained in vault
- Both instructions are permissionless (anyone can call)
- Fixed blocking borrow checker issues in execute_carnage_atomic from parallel plan

## Task Commits

Each task was committed atomically:

1. **Task 1: Create execute_carnage fallback instruction** - `761f88e` (feat)
2. **Task 2: Create expire_carnage instruction** - `834c20f` (feat)

## Files Created/Modified
- `programs/epoch-program/src/instructions/execute_carnage.rs` - Fallback execution within deadline
- `programs/epoch-program/src/instructions/expire_carnage.rs` - Clear expired pending state
- `programs/epoch-program/src/instructions/mod.rs` - Added module exports
- `programs/epoch-program/src/lib.rs` - Added instruction entry points
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` - Fixed borrow checker issues

## Decisions Made
- execute_carnage updates last_carnage_epoch since execution succeeded
- expire_carnage does NOT update last_carnage_epoch since Carnage didn't execute
- Deadline validation: execute uses `<=`, expire uses `>` for clear boundary separation
- CarnageExecuted event has atomic=false for fallback execution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed execute_carnage_atomic borrow checker errors**
- **Found during:** Task 1 (cargo check)
- **Issue:** execute_carnage_atomic.rs from parallel 25-03 plan had compilation errors (borrow checker, missing import)
- **Fix:** Restructured handler to avoid conflicting mutable/immutable borrows, removed unused import
- **Files modified:** programs/epoch-program/src/instructions/execute_carnage_atomic.rs
- **Verification:** cargo check -p epoch-program passes
- **Committed in:** 761f88e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Blocking issue from parallel plan required fix to proceed. No scope creep.

## Issues Encountered
None - parallel plan's execute_carnage_atomic.rs had issues but were fixed as a blocking deviation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Fallback and expiry mechanisms complete for Carnage lifecycle
- execute_carnage validates `slot <= deadline`, emits `atomic: false`
- expire_carnage validates `slot > deadline`, emits `sol_retained` balance
- Ready for devnet integration testing in 25-05
- Both instructions require carnage_pending = true (NoCarnagePending error otherwise)

---
*Phase: 25-carnage-fund-execution*
*Completed: 2026-02-06*
