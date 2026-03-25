---
phase: 61-chart-overhaul
plan: 01
subsystem: chart
tags: [lightweight-charts, theming, api, foundation]
dependency-graph:
  requires: []
  provides: [chart-theme-constants, chart-creation-helper, gapfill-opt-out, logo-icon-asset]
  affects: [61-02, 61-03]
tech-stack:
  added: []
  patterns: [centralized-theme-constants, factory-function-pattern]
key-files:
  created:
    - app/components/chart/chart-theme.ts
    - app/components/chart/create-chart.ts
    - app/public/logo-icon.png
  modified:
    - app/app/api/candles/route.ts
decisions:
  - chart-theme.ts is pure data (no lightweight-charts imports, SSR-safe)
  - create-chart.ts has no 'use client' directive (relies on consumer files being client components)
  - gapfill defaults to true for backward compatibility
  - Logo icon renamed from logo:icon.png to logo-icon.png (colon is URL-unsafe)
metrics:
  duration: 3m
  completed: 2026-02-27
---

# Phase 61 Plan 01: Chart Foundation Modules Summary

JWT-free chart theming with centralized constants, factory creation helper, API gapfill opt-out, and logo asset for loading spinner.

## What Was Done

### Task 1: Chart Theme Constants + Creation Helper
Created two new TypeScript modules in `app/components/chart/`:

**chart-theme.ts** -- Pure constants module exporting four `as const` objects:
- `FACTORY_CHART_THEME`: layout background, text, grid, scale borders, crosshair colors
- `FACTORY_CANDLE_COLORS`: up/down/border/wick colors matching factory-success/error
- `FACTORY_VOLUME_COLORS`: semi-transparent green/red for volume histogram overlay
- `FACTORY_LEGEND_COLORS`: text, label, background colors for OHLC legend overlay

Each hex value has a comment mapping to its CSS token name from globals.css @theme.

**create-chart.ts** -- Factory function that creates a fully themed chart:
- `createThemedChart(container, opts)` returns `{ chart, candleSeries, volumeSeries }`
- Applies FACTORY_CHART_THEME to layout, grid, timeScale, rightPriceScale, crosshair
- Supports `logScale` option for logarithmic price scale (essential for memecoin pools)
- Supports `priceFormatter` option for custom Y-axis labels
- Volume histogram overlaid at bottom 20% via `priceScaleId: ''` + `scaleMargins`
- `toVolumeData(candles)` converts CandleData[] to per-bar colored HistogramData[]

### Task 2: API Gap-Fill Opt-Out + Logo Asset
**API route** (`app/app/api/candles/route.ts`):
- Added `gapfill` query parameter (defaults to `true` for backward compatibility)
- When `gapfill=false`, skips synthetic flat candle generation and returns only real trade candles
- This fixes the misleading long flat lines from gap-fill that confused users about price behavior

**Logo asset**:
- Copied `WebsiteAssets/logo:icon.png` to `app/public/logo-icon.png`
- Renamed to remove colon (URL-unsafe character)
- 232KB PNG for chart loading spinner in Plan 03

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| chart-theme.ts has no 'use client' and no lightweight-charts imports | SSR-safe: can be imported from any context (server legend rendering, client chart setup) |
| create-chart.ts has no 'use client' directive | It doesn't render JSX; it relies on consumer files being 'use client' components. Adding 'use client' would be misleading. |
| gapfill param defaults to true | Backward compatible: existing consumers (if any) continue to get gap-filled data |
| Logo renamed from logo:icon.png to logo-icon.png | Colon in filenames breaks URL references and some filesystems |

## Verification Results

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` passes | PASS |
| chart-theme.ts has zero lightweight-charts imports | PASS |
| create-chart.ts imports from chart-theme.ts and lightweight-charts | PASS |
| API route compiles with gapfill handling | PASS |
| logo-icon.png exists in app/public/ | PASS |

## Commits

| Hash | Message |
|------|---------|
| c693485 | feat(61-01): chart theme constants and creation helper |
| c770a72 | feat(61-01): API gapfill opt-out and logo icon asset |

## Next Plan Readiness

Plan 02 (Chart Component Refactor) can now:
- Import `FACTORY_CHART_THEME`, `FACTORY_CANDLE_COLORS`, `FACTORY_VOLUME_COLORS` from chart-theme.ts
- Import `FACTORY_LEGEND_COLORS` from chart-theme.ts for the OHLC legend
- Use `createThemedChart()` to replace the ~30 lines of inline chart config in CandlestickChart.tsx
- Use `toVolumeData()` to convert candle data for the volume histogram
- Pass `gapfill=false` to the API for real trade candles only
- Reference `/logo-icon.png` for the loading spinner

No blockers for Plan 02 or Plan 03.
