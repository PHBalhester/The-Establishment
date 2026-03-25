---
phase: 62-swap-station-polish
plan: 02
subsystem: ui
tags: [react, tailwind, pool-selector, stats-bar, chart-controls, accessibility]

# Dependency graph
requires:
  - phase: 62-01
    provides: "SwapStation layout with useSwap lifted, ChartControls with pool dropdown"
provides:
  - "SwapStatsBar dual-panel interactive pool selector with riveted brass panels"
  - "ChartControls simplified (pool selector removed)"
  - "Stats bar as sole pool selector for chart"
affects: [62-03, 62-04, 62-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Interactive panel selector pattern: button with aria-pressed for tab-like selection"
    - "kit-panel-riveted class for brass interior panels"
    - "Factory-glow ring treatment for active state (ring-2 + shadow)"

key-files:
  created: []
  modified:
    - "app/components/station/SwapStatsBar.tsx"
    - "app/components/chart/ChartControls.tsx"
    - "app/components/station/SwapStation.tsx"

key-decisions:
  - "POOL_OPTIONS removed entirely from ChartControls (SwapStatsBar defines pool addresses locally via DEVNET_POOLS)"
  - "FactionPanel uses button elements (not div+onClick) for native keyboard accessibility"
  - "Active panel glow: ring-2 ring-factory-glow + box-shadow blur, inactive: opacity-70 with hover:opacity-90"

patterns-established:
  - "Dual-panel selector: side-by-side buttons with aria-pressed for mutually exclusive selection"
  - "kit-panel-riveted as interactive surface: works as button background via CSS border-image"

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 62 Plan 02: Stats Bar Dual-Panel Pool Selector Summary

**Dual-panel CRIME/FRAUD pool selector in SwapStatsBar with riveted brass panels, factory-glow active state, and pool dropdown removed from ChartControls**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T14:19:10Z
- **Completed:** 2026-02-27T14:23:31Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- SwapStatsBar rewritten as interactive dual-panel pool selector (CRIME left, FRAUD right)
- Each panel shows faction name, USD market cap, and buy/sell tax rates on riveted brass background
- Active panel highlighted with factory-glow ring + shadow; inactive panel dimmed at opacity-70
- Pool dropdown and spacer removed from ChartControls (stats bar is sole pool selector)
- Full keyboard accessibility: Tab + Enter to switch pools, aria-pressed + aria-label on panels
- POOL_OPTIONS constant eliminated; pool label derived locally in SwapStation

## Task Commits

Each task was committed atomically:

1. **Task 1: SwapStatsBar dual-panel pool selector** - `6689d62` (feat)
2. **Task 2: Remove pool dropdown from ChartControls** - `9eb45c8` (feat)

## Files Created/Modified
- `app/components/station/SwapStatsBar.tsx` - Rewritten: interactive dual-panel pool selector with FactionPanel sub-component (212 lines)
- `app/components/chart/ChartControls.tsx` - Simplified: pool selector + spacer + POOL_OPTIONS removed (227 lines)
- `app/components/station/SwapStation.tsx` - Wire activePool/onPoolChange to SwapStatsBar, remove pool props from ChartControls, local poolLabel derivation

## Decisions Made
- POOL_OPTIONS removed entirely from ChartControls rather than kept as export -- SwapStatsBar uses DEVNET_POOLS directly, and no other consumers remain
- FactionPanel renders as `<button type="button">` (not div with onClick) for native keyboard support and screen reader compatibility
- Active glow uses `ring-2 ring-factory-glow shadow-[0_0_12px_rgba(240,192,80,0.3)]` matching the factory design system's glow color token
- Inactive panels at opacity-70 (not fully dimmed) with hover:opacity-90 for discoverability

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Stats bar dual-panel pool selector complete and functional
- ChartControls simplified to chart-specific controls only
- Ready for 62-03 (next plan in phase)

---
*Phase: 62-swap-station-polish*
*Completed: 2026-02-27*
