---
phase: 06-vrf-documentation
plan: 02
subsystem: documentation
tags: [vrf, switchboard, spec-discrepancy, migration-lessons, carnage]

# Dependency graph
requires:
  - phase: 06-vrf-documentation
    provides: VRF Implementation Reference (06-01) for technical details
  - phase: 05-convergence
    provides: Converged spec set with all 24 gaps filled
provides:
  - VRF migration lessons with 6 pitfalls catalogued
  - Spec discrepancy register with all 7 items resolved
  - Two-instruction atomic bundle approach documented in Carnage spec
affects: [07-validation, implementation-planning]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spec discrepancy register pattern (DISC-XX numbering with neutral analysis)"
    - "Two-instruction atomic bundle for compute-heavy VRF + Carnage execution"

key-files:
  created:
    - Docs/VRF_Migration_Lessons.md
  modified:
    - Docs/Carnage_Fund_Spec.md

key-decisions:
  - "DISC-01: Slot-based timing (4,500 slots, ~30 min) -- spec version adopted"
  - "DISC-02: Cheap side discrete bands -- spec version adopted"
  - "DISC-03: 6-byte VRF allocation (with Carnage) -- spec version adopted"
  - "DISC-04: Spec VRF intent adopted, but implementation must use On-Demand pattern"
  - "DISC-05: Fixed 0.01 SOL bounty -- spec version adopted"
  - "DISC-06: Discrete 1-4%/11-14% bands -- spec version adopted"
  - "DISC-07: Atomic Carnage in VRF callback, two-instruction bundle preferred"

patterns-established:
  - "Discrepancy register: structured comparison for spec-vs-implementation divergence"
  - "Two-instruction atomic bundle: split compute-heavy operations across instructions in same transaction"

# Metrics
duration: 8min
completed: 2026-02-03
---

# Phase 6 Plan 02: VRF Migration Lessons & Spec Discrepancy Register Summary

**VRF migration pitfalls catalogued, 7 spec discrepancies resolved as SPEC, two-instruction atomic bundle approach added to Carnage spec**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-03T19:43:43Z
- **Completed:** 2026-02-03T19:51:00Z
- **Tasks:** 2 (1 auto + 1 checkpoint)
- **Files modified:** 2

## Accomplishments

- Created `Docs/VRF_Migration_Lessons.md` documenting the v3 VRF migration journey with 6 concrete pitfalls
- Catalogued 7 spec discrepancies (DISC-01 through DISC-07) between Epoch spec and v3 implementation
- All 7 discrepancies resolved as SPEC (keep spec version) per user review at checkpoint
- Updated open questions with user decisions (upgrade authority nuance, devnet cost testing, two-instruction bundle)
- Added Section 9.5 (Two-Instruction Atomic Bundle) to `Docs/Carnage_Fund_Spec.md`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create VRF Migration Lessons Document** - `5dea844` (docs)
2. **Task 2 (checkpoint resolved): Resolve discrepancies + update open questions** - `e33f79b` (docs)
3. **Update Carnage spec with two-instruction bundle** - `8c72bbe` (docs)

## Files Created/Modified

- `Docs/VRF_Migration_Lessons.md` - Created: Migration timeline, 6 pitfalls, deprecated approaches table, 7-item spec discrepancy register (all resolved), open questions with actions
- `Docs/Carnage_Fund_Spec.md` - Modified: Added Section 9.5 (Two-Instruction Atomic Bundle approach for VRF + Carnage execution)

## Decisions Made

All 7 discrepancies resolved as SPEC:

| ID | Aspect | Decision |
|----|--------|----------|
| DISC-01 | Timing | Slot-based (4,500 slots, ~30 min) -- not timestamp-based |
| DISC-02 | Tax Model | "Cheap side" discrete bands -- not continuous rates |
| DISC-03 | VRF Bytes | 6-byte allocation (with Carnage) -- not 4-byte tax-only |
| DISC-04 | VRF Pattern | Spec intent adopted, but implementation uses On-Demand pattern |
| DISC-05 | Bounty | Fixed 0.01 SOL -- not dynamic 0.1% of treasury |
| DISC-06 | Tax Range | Discrete 1-4%/11-14% bands -- not continuous 0.75-14.75% |
| DISC-07 | Carnage | Atomic in VRF callback, two-instruction bundle preferred |

Additional decisions from open questions:
- Pin to Switchboard SDK v0.11.3; burning upgrade authority locks code not SDK dependency
- Test VRF cost on devnet during implementation
- Two-instruction atomic bundle is preferred approach for VRF + Carnage

## Deviations from Plan

None -- plan executed as designed with checkpoint resolution.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 6 (VRF Documentation) is complete with both plans finished
- All VRF knowledge from v3 has been captured and decisions recorded
- Ready for Phase 7 (Validation) -- final verification pass
- Epoch_State_Machine_Spec.md will need updates during implementation planning to reflect On-Demand VRF pattern (per DISC-04 resolution)

---
*Phase: 06-vrf-documentation*
*Completed: 2026-02-03*
