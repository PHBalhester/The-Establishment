---
phase: 44-helius-indexer-charts
plan: 03
subsystem: ui, charts
tags: [tradingview, lightweight-charts, sse, candlestick, react, hooks]

# Dependency graph
requires:
  - phase: 44-helius-indexer-charts (plan 01)
    provides: "Helius webhook receiver, event parser, Postgres storage"
  - phase: 44-helius-indexer-charts (plan 02)
    provides: "OHLCV candle aggregation, REST API, SSE streaming"
provides:
  - "TradingView Lightweight Charts v5 candlestick component with dark theme"
  - "Chart hooks (useChartSSE, useChartData) for REST + SSE data pipeline"
  - "Chart controls (pool selector, time range, resolution picker, connection status)"
  - "Integrated /swap page layout with chart above swap+staking forms"
affects: [45-railway-deployment]

# Tech tracking
tech-stack:
  added: [lightweight-charts@5.1.0]
  patterns: [EventSource auto-reconnect with exponential backoff, ResizeObserver for responsive charts, incremental series.update vs full setData optimization]

key-files:
  created:
    - app/hooks/useChartSSE.ts
    - app/hooks/useChartData.ts
    - app/components/chart/CandlestickChart.tsx
    - app/components/chart/ChartControls.tsx
  modified:
    - app/app/swap/page.tsx
    - app/package.json

key-decisions:
  - "Chart pool selection independent from SwapForm pair (simpler, can wire auto-follow later)"
  - "Fixed 400px chart height (TradingView requires explicit height, not flex-grow)"
  - "Auto-resolution selection when time range changes (1H->1m, 4H->5m, 1D->15m, 1W->1h)"

patterns-established:
  - "EventSource hook with onUpdateRef pattern for stable callback references"
  - "Functional setState in SSE callback to avoid stale closure issues"
  - "ResizeObserver on chart container for responsive width"

# Metrics
duration: 7min
completed: 2026-02-16
---

# Phase 44 Plan 03: TradingView Chart Frontend Summary

**TradingView Lightweight Charts v5 candlestick chart with pool switching, time range selection, SSE live updates, and /swap page integration**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-16T18:30:00Z
- **Completed:** 2026-02-16T18:37:00Z
- **Tasks:** 2 auto + 1 checkpoint (human-verify)
- **Files modified:** 6

## Accomplishments
- TradingView Lightweight Charts v5 candlestick chart with dark theme matching gray-950 app background
- Chart hooks: useChartSSE (EventSource with auto-reconnect + exponential backoff) and useChartData (REST + SSE combined, filtered by pool+resolution)
- ChartControls: pool selector (4 pools), time range buttons (1H/4H/1D/1W), resolution picker (1m-1d), connection status indicator (green/amber/red dot)
- /swap page layout updated: chart full-width above swap + staking forms
- Incremental candle update optimization (series.update for single candle changes, setData for full refetch)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install lightweight-charts, create chart hooks** - `40e75e4` (feat)
2. **Task 2: Create chart components, integrate into /swap page** - `d247ede` (feat)
3. **Task 3: Human verification checkpoint** - approved (no commit needed)

## Files Created/Modified
- `app/hooks/useChartSSE.ts` - EventSource hook with auto-reconnect, exponential backoff (1s-30s), connection status tracking
- `app/hooks/useChartData.ts` - Combines REST fetch with SSE updates, auto-resolution on range change, functional setState for SSE
- `app/components/chart/CandlestickChart.tsx` - TradingView v5 wrapper with dark theme, ResizeObserver, loading overlay, incremental update
- `app/components/chart/ChartControls.tsx` - Pool selector, time range buttons, resolution picker, connection dot
- `app/app/swap/page.tsx` - Chart added full-width above swap+staking forms, chartPool state management
- `app/package.json` - Added lightweight-charts@5.1.0

## Decisions Made
- Chart pool selection is independent from SwapForm pair selection (simpler implementation, auto-follow can be wired later)
- Fixed 400px chart height (TradingView requires explicit dimensions)
- Auto-resolution selection when time range changes (1H->1m, 4H->5m, 1D->15m, 1W->1h)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `next build` shows 500 error on `/api/candles` without DATABASE_URL — expected behavior, not a bug. Chart renders correctly with empty data state.

## User Setup Required

See [44-USER-SETUP.md](./44-USER-SETUP.md) for Postgres and Helius webhook configuration (from Plan 01).

## Next Phase Readiness
- Phase 44 complete, all 3 plans executed
- Chart UI renders correctly (human verified)
- Full data pipeline wired: Helius webhook -> event parser -> Postgres -> candle aggregation -> SSE -> TradingView chart
- DATABASE_URL and HELIUS_WEBHOOK_SECRET env vars needed before live data flows

---
*Phase: 44-helius-indexer-charts*
*Completed: 2026-02-16*
