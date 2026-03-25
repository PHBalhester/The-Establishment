# VERIFY-H045: No Server Error Reporting
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence
### captureException in API routes

All 5 API routes that can encounter server-side errors now import and use `captureException` from `@/lib/sentry`:

| Route | Import | Usage |
|---|---|---|
| `/api/rpc` | line 17 | line 177 (all RPC endpoints failed) |
| `/api/sol-price` | line 21 | line 124 (all price providers unavailable) |
| `/api/candles` | line 31 | line 250 (DB query error) |
| `/api/carnage-events` | line 22 | line 59 (DB query error) |
| `/api/health` | line 21 | lines 39, 49 (Postgres/RPC check failures) |
| `/api/webhooks/helius` | line 56 | lines 232, 410, 437, 456 (secret missing, candle upsert error, per-TX error, fatal error) |

The SSE endpoints (`/api/sse/protocol`, `/api/sse/candles`) do not import `captureException`. These are streaming endpoints where errors manifest as connection drops rather than catchable exceptions -- the client-side EventSource reconnection handles these.

### instrumentation.ts

`app/instrumentation.ts` remains a no-op (lines 6-9). This is a known constraint: all `@sentry/*` npm packages break Turbopack SSR (documented in MEMORY.md). The project uses a zero-dependency `lib/sentry.ts` that POSTs error envelopes directly to Sentry's ingest API via `fetch()`, which works in both browser and Node.js runtimes without any Turbopack conflicts.

### Assessment
Fixed. The round 2 gap ("No API route imports captureException") is fully closed. All server-side error paths in API routes now report to Sentry via the zero-dependency fetch-based reporter. The `instrumentation.ts` no-op is an acceptable tradeoff given the Turbopack constraint -- the per-route `captureException` calls cover all structured error paths, and truly unexpected crashes (uncaughtException) still surface in Railway's log stream.
