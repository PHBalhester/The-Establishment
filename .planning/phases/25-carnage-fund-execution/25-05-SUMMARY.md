---
phase: 25-carnage-fund-execution
plan: 05
subsystem: epoch
tags: [carnage, vrf, consume-randomness, trigger, epoch-program]

# Dependency graph
requires:
  - phase: 25-02
    provides: VRF helpers (is_carnage_triggered, get_carnage_action, get_carnage_target)
  - phase: 25-01
    provides: CarnageFundState account, Carnage events, CARNAGE_FUND_SEED constant
  - phase: 23-03
    provides: consume_randomness instruction with tax derivation
provides:
  - Carnage trigger integration in consume_randomness
  - Auto-expire stale pending Carnage at handler start
  - Carnage pending state setup for execute_carnage_atomic
  - CarnagePending and CarnageNotTriggered event emission
affects: [devnet-testing, integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Optional account pattern for backward compatibility
    - Auto-expire stale pending state at handler start

key-files:
  modified:
    - programs/epoch-program/src/instructions/consume_randomness.rs

key-decisions:
  - "CarnageFundState is optional account for gradual rollout"
  - "Auto-expire happens at START before VRF validation"
  - "Carnage check happens AFTER staking CPI and TaxesUpdated event"

patterns-established:
  - "Optional account pattern: #[account(...)] pub carnage_state: Option<Account<...>>"
  - "Auto-expire on entry: check and clear stale pending before main logic"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 25 Plan 05: VRF Carnage Integration Summary

**Carnage trigger check integrated into consume_randomness with VRF byte 3 threshold (<11), optional account pattern for backward compatibility, and auto-expire for stale pending state**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T20:28:25Z
- **Completed:** 2026-02-06T20:30:42Z
- **Tasks:** 2/2
- **Files modified:** 1
- **Tests:** 59 (52 existing + 7 new)

## Accomplishments

- Integrated Carnage trigger check into consume_randomness (VRF byte 3 < 11 = trigger)
- Added auto-expire logic for stale pending Carnage at handler start
- Added CarnageFundState as optional account for backward compatibility
- Added 7 new unit tests covering Carnage integration logic

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Carnage trigger logic to consume_randomness** - `e97a84c` (feat)
2. **Task 2: Add unit tests for Carnage integration** - `62b3fc1` (test)

## Files Modified

- `programs/epoch-program/src/instructions/consume_randomness.rs` - Added Carnage trigger integration with auto-expire, optional CarnageFundState account, pending state setup, and 7 new tests

## Decisions Made

1. **Optional CarnageFundState account** - Allows backward compatibility during gradual rollout. If not provided, Carnage trigger check is skipped.

2. **Auto-expire at START** - Stale pending Carnage is cleared at the very start of the handler, before VRF validation. This ensures the system can always proceed even if previous Carnage wasn't executed.

3. **Carnage check after step 8** - The trigger check happens after staking CPI and TaxesUpdated event, as step 9 per spec.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation followed plan precisely.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 25 Complete!** This is the final plan (25-05) of Phase 25. All Carnage Fund components are now implemented:

1. CarnageFundState account and events (25-01)
2. VRF helpers and initialize_carnage_fund (25-02)
3. execute_carnage_atomic instruction (25-03)
4. execute_carnage fallback and expire_carnage (25-04)
5. Carnage trigger integration in consume_randomness (25-05)

**Ready for:**
- Integration testing on devnet
- Full epoch lifecycle testing with Carnage triggers
- Compute budget profiling for atomic execution

**Full Carnage flow now complete:**
1. consume_randomness checks VRF byte 3
2. If triggered, sets pending state (action, target, deadline)
3. execute_carnage_atomic can process immediately
4. If atomic fails, execute_carnage fallback within 100 slots
5. expire_carnage clears stale pending after deadline

---
*Phase: 25-carnage-fund-execution*
*Completed: 2026-02-06*
