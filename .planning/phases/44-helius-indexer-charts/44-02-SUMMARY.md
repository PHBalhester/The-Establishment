---
phase: 44-helius-indexer-charts
plan: 02
subsystem: data-pipeline, api
tags: [candles, ohlcv, sse, real-time, drizzle, upsert, gap-fill, tradingview]

# Dependency graph
requires:
  - phase: 44-01-webhook-ingestion
    provides: "Drizzle DB connection, Anchor event parser, Helius webhook handler, swap_events storage"
provides:
  - "OHLCV candle aggregator with 6-resolution upsert (app/db/candle-aggregator.ts)"
  - "REST API for historical candle data with gap-fill (app/app/api/candles/route.ts)"
  - "SSE streaming endpoint for real-time candle updates (app/app/api/sse/candles/route.ts)"
  - "In-memory pub/sub SSE manager singleton (app/lib/sse-manager.ts)"
  - "Complete webhook-to-browser data pipeline"
affects: [44-03-chart-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Drizzle onConflictDoUpdate with GREATEST/LEAST SQL", "SSE via ReadableStream in Next.js App Router", "globalThis SSE singleton for HMR", "gap-fill on read with carry-forward last price"]

key-files:
  created:
    - app/db/candle-aggregator.ts
    - app/lib/sse-manager.ts
    - app/app/api/candles/route.ts
    - app/app/api/sse/candles/route.ts
  modified:
    - app/app/api/webhooks/helius/route.ts

key-decisions:
  - "Candle upsert runs in parallel across 6 resolutions (Promise.all, no conflicts)"
  - "Gap-fill on read, not write -- avoids millions of empty candle rows during low activity"
  - "SSE heartbeat every 15 seconds -- prevents Railway/nginx proxy timeout"
  - "Candle errors wrapped in try/catch -- swap storage continues even if candle upsert fails"
  - "SSE broadcast sends all 6 resolutions per swap -- chart component filters client-side"
  - "In-memory SSE manager (not Redis) -- single Railway process, no horizontal scaling needed for devnet"

patterns-established:
  - "OHLCV upsert: INSERT with GREATEST(high)/LEAST(low), accumulate volume+tradeCount, never overwrite open"
  - "Time truncation: Math.floor(unixSeconds / bucketSize) * bucketSize for resolution alignment"
  - "Gap-fill: walk time range at resolution step, insert flat candle (O=H=L=C=lastPrice, vol=0) for gaps"
  - "SSE endpoint: ReadableStream + TextEncoder + abort signal cleanup"
  - "SSE manager: globalThis singleton with subscribe/broadcast/unsubscribe lifecycle"

# Metrics
duration: 5min
completed: 2026-02-16
---

# Phase 44 Plan 02: Candle Aggregation + SSE Summary

**OHLCV candle aggregation at 6 resolutions (1m/5m/15m/1h/4h/1d) using Drizzle onConflictDoUpdate with GREATEST/LEAST SQL, REST API with gap-fill for historical data, SSE streaming for real-time browser updates, and full webhook pipeline wiring**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-16T22:31:38Z
- **Completed:** 2026-02-16T22:36:05Z
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 1

## Accomplishments
- Candle aggregator upserts OHLCV data at all 6 resolutions using Drizzle onConflictDoUpdate with SQL GREATEST/LEAST for atomic high/low tracking
- REST API at GET /api/candles returns historical candle data with gap-fill (carry-forward last price, volume=0) in TradingView-compatible format
- SSE endpoint at GET /api/sse/candles streams real-time candle updates with 15-second heartbeat and cleanup on disconnect
- Webhook handler fully wired: swap events parsed -> stored in Postgres -> candles upserted -> SSE broadcast to browsers
- All TypeScript files compile clean with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create candle aggregator and SSE manager modules** - `40a83ff` (feat)
2. **Task 2: Create candle REST API and SSE streaming endpoint** - `adee562` (feat)
3. **Task 3: Wire webhook handler to candle aggregator and SSE broadcaster** - `6c2d847` (feat)

## Files Created/Modified
- `app/db/candle-aggregator.ts` - OHLCV upsert at 6 resolutions with GREATEST/LEAST SQL, convenience wrapper for swap events
- `app/lib/sse-manager.ts` - In-memory pub/sub SSE manager with globalThis singleton for HMR
- `app/app/api/candles/route.ts` - REST API with pool/resolution/time-range params, gap-fill, TradingView format
- `app/app/api/sse/candles/route.ts` - SSE stream with heartbeat, abort cleanup, X-Accel-Buffering header
- `app/app/api/webhooks/helius/route.ts` - Wired to candle aggregator and SSE broadcaster with error isolation

## Decisions Made
- **Parallel 6-resolution upsert**: Promise.all across resolutions since they target different rows (no DB conflicts)
- **Gap-fill on read**: API fills missing time slots at query time rather than writing empty candle rows to DB
- **SSE heartbeat at 15 seconds**: Prevents Railway nginx proxy from timing out idle connections (60-120s default)
- **Candle error isolation**: try/catch around candle upsert + SSE broadcast so swap event storage is never blocked
- **Broadcast all 6 resolutions**: Client-side filtering is simpler than server-side resolution tracking per SSE connection
- **In-memory SSE manager**: Single Railway process for devnet makes Redis unnecessary; globalThis survives HMR

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness
- Complete data pipeline operational: Helius webhook -> event parsing -> swap storage -> candle upsert -> SSE push
- Plan 03 (chart frontend) can consume the REST API for historical data and SSE stream for real-time updates
- GET /api/candles returns TradingView Lightweight Charts compatible format ({ time: UTCTimestamp, open, high, low, close, volume })
- No blockers: all code compiles, no DB required at build time

---
*Phase: 44-helius-indexer-charts*
*Completed: 2026-02-16*
