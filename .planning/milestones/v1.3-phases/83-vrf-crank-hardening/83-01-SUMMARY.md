---
phase: 83-vrf-crank-hardening
plan: 01
subsystem: epoch
tags: [vrf, carnage, epoch, state-machine, tax-rates]

# Dependency graph
requires:
  - phase: 82-carnage-refactor
    provides: Carnage execution refactor with carnage_execution.rs
provides:
  - force_carnage carnage_lock_slot parity with consume_randomness
  - Legacy tax summary fields populated with min/max of per-token rates
  - Epoch skip behavior documentation in code and spec
affects: [84-testing, 89-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Legacy field population: compute min/max summary from independent per-token rates"

key-files:
  created: []
  modified:
    - programs/epoch-program/src/instructions/force_carnage.rs
    - programs/epoch-program/src/instructions/consume_randomness.rs
    - programs/epoch-program/src/instructions/trigger_epoch_transition.rs
    - Docs/archive/Epoch_State_Machine_Spec.md

key-decisions:
  - "VRF-03: low_tax_bps/high_tax_bps populated as explicit min/max of 4 per-token rates (derive_taxes returns 0 for legacy fields)"
  - "VRF-02: Epoch skip documented as by-design behavior, not a bug"

patterns-established:
  - "Legacy summary fields: always compute from authoritative per-token rates, never trust derive_taxes legacy output"

requirements-completed: [VRF-01, VRF-02, VRF-03]

# Metrics
duration: 3min
completed: 2026-03-08
---

# Phase 83 Plan 01: VRF/Crank State Machine Fixes Summary

**force_carnage carnage_lock_slot parity, legacy tax min/max population, and epoch skip documentation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-08T11:57:46Z
- **Completed:** 2026-03-08T12:00:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- force_carnage now sets carnage_lock_slot identically to consume_randomness (VRF-01)
- low_tax_bps/high_tax_bps populated as min/max of all 4 per-token rates instead of 0 (VRF-03)
- Epoch skip behavior documented in trigger_epoch_transition.rs code comment and Epoch_State_Machine_Spec.md (VRF-02)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add carnage_lock_slot to force_carnage + populate legacy tax fields** - `bc609f6` (feat)
2. **Task 2: Document epoch skip behavior in code and spec** - `3003335` (docs)

## Files Created/Modified
- `programs/epoch-program/src/instructions/force_carnage.rs` - Added CARNAGE_LOCK_SLOTS import and carnage_lock_slot assignment
- `programs/epoch-program/src/instructions/consume_randomness.rs` - Replaced legacy 0-value tax fields with explicit min/max computation
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` - Added epoch skip safety documentation comment
- `Docs/archive/Epoch_State_Machine_Spec.md` - Added "Epoch Skip Behavior" section with 4 safety properties

## Decisions Made
- VRF-03: derive_taxes() returns 0 for low_tax_bps/high_tax_bps (legacy fields deprecated in Phase 37). Rather than modify derive_taxes, we compute min/max explicitly in consume_randomness after assigning per-token rates. This keeps derive_taxes clean and makes the semantics visible at the assignment site.
- VRF-02: Epoch skip documented as by-design, not a defect. The 4 safety properties (tax persistence, no staking double-count, no implicit Carnage, direct epoch number) make skips harmless.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failures noted (not caused by this plan):
- `force_carnage_excluded_from_non_devnet_idl` fails when IDL was built with devnet feature (reads devnet IDL, asserts no force_carnage in non-devnet mode)
- 8 `trigger_epoch_transition` timing tests fail with `--features devnet` (hardcoded mainnet SLOTS_PER_EPOCH=4500 values)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Epoch program state machine is now consistent between force_carnage and consume_randomness
- Legacy tax fields provide meaningful summary data for events and UI
- Ready for remaining 83-xx plans (crank hardening, VRF recovery)

---
*Phase: 83-vrf-crank-hardening*
*Completed: 2026-03-08*
