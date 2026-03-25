---
phase: 56-station-content
plan: 02
subsystem: ui
tags: [react, swap, chart, css, 3d-button, render-prop, toast]

# Dependency graph
requires:
  - phase: 56-station-content-01
    provides: ModalContent lazy switch, Big Red Button CSS (.big-red-button 7 states), ToastProvider + useToast hook, .station-content dark wrapper
  - phase: 55-scene-layout-interactive-objects
    provides: SceneStation buttons that open modals via useModal
provides:
  - SwapStation layout compositor (stats bar + chart + form + BigRedButton)
  - SwapStatsBar with USD token prices from pool reserves + SOL price
  - BigRedButton with data-state CSS state machine and auto-reset timers
  - SwapForm renderAction + className props for re-parenting into modal
affects: [56-03 carnage/staking/wallet stations, 56-04 docs/settings stations, 57 visual polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "renderAction prop pattern: inject custom action element into existing form without rewriting hooks"
    - "data-state attribute auto-reset: useEffect timer clears CSS state after animation duration"
    - "prevStatusRef transition detection: fire side effects only on status change, not re-renders"
    - "Price derivation from pool reserves: SOL pools direct, PROFIT pools via paired token's USD price"

key-files:
  created:
    - app/components/station/SwapStation.tsx
    - app/components/station/SwapStatsBar.tsx
    - app/components/station/BigRedButton.tsx
  modified:
    - app/components/swap/SwapForm.tsx

key-decisions:
  - "renderAction prop pattern for BigRedButton injection: cleaner than extracting SwapForm action area because SwapForm stays self-contained"
  - "SwapForm default params ({ renderAction, className }: SwapFormProps = {}): backward compatible with zero-arg call sites"
  - "BigRedButton auto-reset timers match CSS animation durations exactly (1.5s success, 0.4s error)"
  - "prevStatusRef for toast dedup: prevents duplicate toasts on React strict-mode double-renders"
  - "Chart default pool is CRIME/SOL (most actively traded), user can switch via ChartControls dropdown"

patterns-established:
  - "renderAction prop: any form component can accept custom action renderers without hook changes"
  - "data-state auto-reset: set CSS state, setTimeout to clear, return cleanup from useEffect"
  - "Station composition: stats bar + chart + form stacked in flex-col with gap-4"

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 56 Plan 02: Swap Station Panel Summary

**SwapStation compositor with BigRedButton 3D button, SwapStatsBar price display, chart wiring, and SwapForm renderAction prop for modal re-parenting**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T21:24:57Z
- **Completed:** 2026-02-23T21:29:32Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- SwapStatsBar computes USD token prices from pool reserves (SOL pools direct, PROFIT pools derived via paired token) and displays current epoch tax rates
- BigRedButton provides a 3D CSS button with data-state management, auto-reset timers (1.5s success green flash, 0.4s error shake), and toast notifications on status transitions
- SwapForm accepts renderAction and className props for re-parenting into the swap station modal without modifying any hook logic
- SwapStation composes all pieces (stats bar, chart controls + candlestick chart at 300px, swap form with BigRedButton) as a default export for React.lazy

## Task Commits

Each task was committed atomically:

1. **Task 1: SwapStatsBar component** - `33298ef` (feat)
2. **Task 2: BigRedButton + SwapForm renderAction prop** - `5c6b32e` (feat)
3. **Task 3: SwapStation layout compositor** - `515722b` (feat)

## Files Created/Modified
- `app/components/station/SwapStatsBar.tsx` - Display-only stats bar with token prices (USD) and epoch tax rates, loading skeletons
- `app/components/station/BigRedButton.tsx` - 3D CSS button with data-state management, auto-reset timers, toast integration via useToast
- `app/components/station/SwapStation.tsx` - Layout compositor: SwapStatsBar + ChartControls + CandlestickChart + SwapForm with BigRedButton via renderAction
- `app/components/swap/SwapForm.tsx` - Added renderAction and className props (backward compatible, default `= {}`)

## Decisions Made
- **renderAction prop injection (not extraction):** Adding an optional render prop to SwapForm is cleaner than extracting the action area. SwapForm remains self-contained; callers that don't provide renderAction get SwapStatus as before.
- **Default params for backward compatibility:** `SwapForm({ renderAction, className }: SwapFormProps = {})` means existing call sites (`<SwapForm />`) work without changes.
- **BigRedButton auto-reset timers match CSS:** 1.5s for success (matches big-red-success keyframe duration), 0.4s for error (matches big-red-shake keyframe duration). Clearing data-state resets to idle appearance.
- **prevStatusRef for toast dedup:** React strict mode can double-render effects. Comparing prev vs current status ensures toasts fire exactly once per transition.
- **Chart 300px height in modal:** Reduced from CandlestickChart's default 400px to fit modal context without excessive scrolling.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- SwapStation is ready for React.lazy mounting via ModalContent switch (station === 'swap')
- The `renderAction` prop pattern is reusable for any future form component that needs custom action rendering
- Plans 03-04 can follow the same station composition pattern (stats + content + form)
- BigRedButton + toast integration is live and will work as soon as a user opens the swap modal and executes a swap

---
*Phase: 56-station-content*
*Completed: 2026-02-23*
