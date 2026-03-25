---
phase: 61-chart-overhaul
plan: 03
subsystem: ui
tags: [lightweight-charts, accessibility, frame, keyboard-nav, aria-live, volume-toggle, log-scale]

# Dependency graph
requires:
  - phase: 61-chart-overhaul (plan 01)
    provides: chart-theme.ts, create-chart.ts, OhlcLegend.tsx, useChartData gapfill=false
  - phase: 61-chart-overhaul (plan 02)
    provides: CandlestickChart with volume histogram, crosshair legend, RAF resize
  - phase: 60-component-kit
    provides: Frame component with CSS/asset modes
provides:
  - ChartWrapper component with Frame border, loading/empty states, keyboard nav, aria-live
  - ChartControls with unified 7-button timeframe bar (1m-1W), volume toggle, log/linear toggle
  - SwapStation integration wiring all chart components together
  - onChartReady callback pattern on CandlestickChart for external chart access
affects: [swap-station, chart-components, accessibility-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ChartWrapper composition: Frame > keyboard container > chart children"
    - "onChartReady ref pattern: avoids chart re-creation on callback identity change"
    - "Unified timeframe buttons: single click sets both range and resolution"
    - "Dual loading states: full overlay (initial) vs corner indicator (refetch)"

key-files:
  created:
    - app/components/chart/ChartWrapper.tsx
  modified:
    - app/components/chart/ChartControls.tsx
    - app/components/chart/CandlestickChart.tsx
    - app/components/station/SwapStation.tsx

key-decisions:
  - "ChartWrapper owns Frame, a11y, loading/empty states; CandlestickChart is pure chart rendering"
  - "Unified timeframe bar replaces separate range buttons + resolution dropdown as primary control"
  - "Resolution dropdown kept as secondary fine-grained override"
  - "Log scale defaults to true (memecoin prices span orders of magnitude)"
  - "Volume defaults to true (show histogram by default)"
  - "Keyboard nav on container div inside Frame (not on Frame itself) for clean separation"
  - "Loading overlay removed from CandlestickChart (moved to ChartWrapper for single responsibility)"

patterns-established:
  - "onChartReady callback: ref pattern to expose chart instance without re-creation"
  - "Dual loading state: full overlay for initial load, subtle corner for refetch"
  - "POOL_OPTIONS exported from ChartControls for consumer label lookups"

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 61 Plan 03: Chart Controls + Polish Summary

**Frame-wrapped chart with keyboard navigation, aria-live announcements, unified 1m-1W timeframe bar, volume/log toggles, and dual loading states**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T11:48:38Z
- **Completed:** 2026-02-27T11:53:19Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- ChartWrapper wraps chart in steampunk Frame border with loading spinner (initial) and corner indicator (refetch)
- Empty state shows themed "No trades recorded" message inside Frame (no crash, no blank space)
- Keyboard navigation: arrow keys scroll chart, +/- zoom via IChartApi ref from CandlestickChart
- Screen reader support: aria-live polite region announces pool price changes
- Unified 7-button timeframe bar (1m 5m 15m 1H 4H 1D 1W) replaces 4-button range group
- Volume toggle checkbox and log/linear scale toggle button in ChartControls
- SwapStation wires all components: ChartWrapper > ChartControls + CandlestickChart

## Task Commits

Each task was committed atomically:

1. **Task 1: ChartWrapper component (Frame + loading/empty states + a11y)** - `a4be203` (feat)
2. **Task 2: ChartControls toggles + SwapStation integration** - `870724b` (feat)

## Files Created/Modified
- `app/components/chart/ChartWrapper.tsx` - Frame-wrapped container with loading/empty states, keyboard nav, aria-live
- `app/components/chart/ChartControls.tsx` - Unified timeframes, volume toggle, log/linear toggle, exported POOL_OPTIONS
- `app/components/chart/CandlestickChart.tsx` - Added onChartReady callback, removed loading overlay and a11y attrs (moved to wrapper)
- `app/components/station/SwapStation.tsx` - Wires ChartWrapper with volume/logScale state, chartRef, poolLabel

## Decisions Made
- Unified timeframe bar: Each button sets both range AND resolution (e.g., "5m" = 4H range + 5m resolution for ~48 candles). This is simpler than requiring users to understand the range/resolution distinction.
- Resolution dropdown retained as secondary override for power users who want non-standard combos (e.g., 1m candles over 1D range).
- Log scale default true: Memecoin prices span orders of magnitude. Linear scale compresses early price action to an invisible flat line.
- Volume default true: Volume histogram aids trading decisions. Users can toggle off to reduce visual noise.
- Keyboard nav container inside Frame: Frame uses forwardRef and spreads ...rest, but keeping keyboard handler on a separate div provides cleaner separation of concerns.
- Loading overlay moved from CandlestickChart to ChartWrapper: Single responsibility -- CandlestickChart is pure chart rendering, ChartWrapper owns all state-dependent overlays.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TypeScript error in CandlestickChart crosshair handler**
- **Found during:** Task 1 (tsc --noEmit verification)
- **Issue:** `prev.close` typed as `unknown` because lightweight-charts SeriesDataItemTypeMap returns union type. tsc reported error TS2345.
- **Fix:** Added type assertion `(prev as { close: number }).close` after the `"close" in prev` type guard
- **Files modified:** app/components/chart/CandlestickChart.tsx
- **Verification:** tsc --noEmit passes cleanly
- **Committed in:** a4be203 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for clean compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 61 (Chart Overhaul) is now COMPLETE across all 3 plans
- Chart pipeline: theme -> creation helper -> OHLC legend -> chart component -> wrapper -> controls -> SwapStation
- All REQ-002 acceptance criteria met (except watermark, explicitly skipped per user decision)
- Ready for subsequent phases in v1.1 Modal Mastercraft

---
*Phase: 61-chart-overhaul*
*Completed: 2026-02-27*
