---
phase: 61-chart-overhaul
plan: 02
subsystem: chart
tags: [lightweight-charts, volume-histogram, ohlc-legend, resize-observer, sse, responsive]
dependency-graph:
  requires: [61-01]
  provides: [themed-candlestick-chart, volume-histogram, ohlc-legend, gapfill-disabled, raf-resize]
  affects: [61-03]
tech-stack:
  added: []
  patterns: [crosshair-event-subscription, raf-debounced-resize, media-query-responsive, incremental-series-update]
key-files:
  created:
    - app/components/chart/OhlcLegend.tsx
  modified:
    - app/components/chart/CandlestickChart.tsx
    - app/hooks/useChartData.ts
decisions:
  - OhlcLegend has no 'use client' directive (imported by CandlestickChart which is 'use client')
  - Volume visibility toggled via applyOptions (not remove/re-add series) per RESEARCH.md Pitfall 6
  - Crosshair handler unsubscribed BEFORE chart.remove() to prevent use-after-free
  - Mobile breakpoint at 640px matches Tailwind 'sm' for compact legend layout
  - Adaptive price formatting: 4dp for >1, 6dp for >0.001, 9dp for tiny memecoin prices
metrics:
  duration: 4m
  completed: 2026-02-27
---

# Phase 61 Plan 02: Chart Component Refactor Summary

Refactored CandlestickChart to use centralized theme, added volume histogram overlay + OHLC legend, fixed ResizeObserver loop warning, added gapfill=false for real trade candles only.

## What Was Done

### Task 1: OHLC Legend Component + CandlestickChart Refactor

**OhlcLegend.tsx** (153 lines) -- New positioned overlay component:
- Displays Open, High, Low, Close, Volume values with brass-gauge monospace readout
- Adaptive decimal formatting for SOL memecoin prices (4/6/9 decimals based on magnitude)
- Change% indicator (green/red) comparing current close to previous candle's close
- Compact mode for mobile: shows only close price + change% to save screen space
- Labels styled with FACTORY_LEGEND_COLORS.label (#daa520 gold accent)
- Values styled with FACTORY_LEGEND_COLORS.text (#ecdcc4 parchment)
- Semi-transparent background from FACTORY_LEGEND_COLORS.bg, pointer-events-none

**CandlestickChart.tsx** (282 lines) -- Major refactor replacing all inline configuration:
- Replaced ~30 lines of inline chart config with `createThemedChart()` call (~5 lines)
- Eliminated all hardcoded hex color strings (zero matches on grep)
- Added volume histogram overlay via `toVolumeData()` in both full-load and incremental paths
- Added crosshair move handler that updates OHLC legend state on hover, shows latest candle when idle
- Fixed ResizeObserver with RAF debounce to prevent "loop completed" console warnings
- Added cleanup: `unsubscribeCrosshairMove` before `chart.remove()` to prevent memory leaks
- New optional props: `showVolume` (default true), `logScale` (default false), `poolLabel` (default '')
- Volume visibility toggled via `applyOptions({ visible })` -- never remove/re-add the series
- Log scale toggled via `applyOptions({ rightPriceScale: { mode } })` for runtime switching
- Mobile detection via `matchMedia('(max-width: 640px)')` with proper cleanup
- Memory hygiene: both candle and volume series cleared via `setData([])` when candles is empty
- Loading overlay updated to use logo-icon.png with gear-spin animation
- Added aria-label with poolLabel for accessibility

### Task 2: useChartData Hook Updates

**useChartData.ts** -- Three targeted changes:
- Added `gapfill=false` parameter to the `/api/candles` fetch URL. This tells the API (modified in Plan 01) to return only real trade candles, eliminating misleading flat-line synthetic candles during idle periods.
- Added `setCandles([])` at the start of the fetch effect (after the pool guard). This clears stale data immediately on pool/resolution/range change, triggering `seriesRef.current.setData([])` in CandlestickChart before the new fetch completes. Prevents stale data flash.
- Verified SSE volume path: `handleSSEUpdate` already accumulates volume with `volume: lastCandle.volume + update.volume`, and CandlestickChart's incremental update path now picks up volume for the volume series update.

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| OhlcLegend has no 'use client' | Imported by CandlestickChart which is 'use client', so it inherits client context |
| Volume toggled via applyOptions, not remove/re-add | RESEARCH.md Pitfall 6: removing and re-adding series causes data loss |
| unsubscribeCrosshairMove BEFORE chart.remove() | Prevents calling handlers on a destroyed chart instance (memory leak + crash) |
| Mobile breakpoint at 640px | Matches Tailwind 'sm' breakpoint for consistency with rest of UI |
| Adaptive price decimals (4/6/9) | SOL memecoin prices can range from 0.000000001 to 100+; fixed decimals would truncate or over-display |

## Verification Results

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` passes (app/ files) | PASS |
| CandlestickChart.tsx has zero hardcoded hex colors | PASS |
| subscribeCrosshairMove + unsubscribeCrosshairMove both present | PASS |
| ResizeObserver wrapped in requestAnimationFrame | PASS |
| OhlcLegend.tsx exports OhlcLegend component (153 lines) | PASS |
| Volume series uses priceScaleId '' with scaleMargins top 0.8 | PASS (in create-chart.ts) |
| useChartData fetches with gapfill=false | PASS |
| Data cleared on pool/timeframe switch before new fetch | PASS |

## Commits

| Hash | Message |
|------|---------|
| b462ce9 | feat(61-02): OHLC legend component + CandlestickChart refactor |
| 7d097fb | feat(61-02): useChartData gapfill=false + memory hygiene on switch |

## Next Plan Readiness

Plan 03 (Chart Controls + Polish) can now:
- All chart visual features are complete (themed candles, volume histogram, OHLC legend)
- Chart correctly handles resize, crosshair events, and data transitions
- Volume and logScale are controllable via props (ready for control toggles)
- Data quality improved with gapfill=false (only real trade candles)
- Loading overlay uses the logo-icon.png with gear-spin animation

No blockers for Plan 03.
