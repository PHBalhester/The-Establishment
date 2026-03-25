---
phase: 56-station-content
plan: 03
subsystem: ui
tags: [react, modal, hooks, carnage, staking, lazy-loading]

# Dependency graph
requires:
  - phase: 56-station-content
    provides: ModalContent lazy station switch, dark inner card CSS
  - phase: 55-scene-layout-interactive-objects
    provides: SceneStation buttons that open modals via useModal
provides:
  - CarnageStation panel wrapping CarnageCard with live on-chain data
  - StakingStation panel wrapping StakingForm with stake/unstake/claim tabs
affects: [56-04 docs/settings stations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Orchestrator pattern for CarnageStation: wrapper calls hooks, passes props to display component"
    - "Pass-through pattern for StakingStation: wrapper renders self-contained hook consumer directly"

key-files:
  created:
    - app/components/station/CarnageStation.tsx
    - app/components/station/StakingStation.tsx
  modified: []

key-decisions:
  - "CarnageStation follows DashboardGrid orchestrator pattern (calls 3 hooks, passes props to CarnageCard)"
  - "StakingStation is pure pass-through (StakingForm calls useStaking internally, no orchestration needed)"

patterns-established:
  - "Two station wrapper flavors: orchestrator (hooks + props) vs pass-through (self-contained child)"

# Metrics
duration: 1min
completed: 2026-02-23
---

# Phase 56 Plan 03: Carnage and Staking Station Panels Summary

**CarnageStation orchestrates useCarnageData/useCarnageEvents/useEpochState into CarnageCard; StakingStation pass-through renders self-contained StakingForm**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-23T21:32:18Z
- **Completed:** 2026-02-23T21:33:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- CarnageStation.tsx re-parents CarnageCard into the modal context with live on-chain data (vault balance, lifetime burn stats, last 5 events)
- StakingStation.tsx re-parents StakingForm (Stake/Unstake/Claim tabs + StakingStats) into the modal context
- Both components use default exports for React.lazy loading in ModalContent.tsx
- Zero modifications to existing CarnageCard or StakingForm component logic

## Task Commits

Each task was committed atomically:

1. **Task 1: CarnageStation panel** - `d47cd2d` (feat)
2. **Task 2: StakingStation panel** - `a36c700` (feat)

## Files Created/Modified
- `app/components/station/CarnageStation.tsx` - Orchestrator wrapper calling useCarnageData, useCarnageEvents, useEpochState and passing data as props to CarnageCard
- `app/components/station/StakingStation.tsx` - Pass-through wrapper rendering self-contained StakingForm directly

## Decisions Made
- **CarnageStation as orchestrator:** Follows the DashboardGrid pattern where the wrapper calls hooks and passes data as props to the pure display component (CarnageCard). This keeps CarnageCard testable and reusable.
- **StakingStation as pass-through:** StakingForm already calls useStaking() internally and manages its own tabs, state, and execution. No orchestration needed -- the wrapper simply renders StakingForm.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- 4 of 6 station panels now complete (SwapStation, CarnageStation, StakingStation from plans 02-03, plus infrastructure from plan 01)
- Remaining: WalletStation, DocsStation, SettingsStation in Plan 04
- ModalContent.tsx lazy imports already reference all 6 station components (created in Plan 01)

---
*Phase: 56-station-content*
*Completed: 2026-02-23*
