# VERIFY-H092: In-Memory SSE Connection Exhaustion
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12
**Previous:** PARTIALLY_FIXED

## Finding Summary
H092 flagged that the in-memory SSE pub/sub (`sse-manager.ts`) had no connection limits, allowing a single client or coordinated attack to exhaust server resources by opening unbounded SSE connections.

## Evidence

### Connection caps implemented in `app/lib/sse-connections.ts`

The file implements a complete connection tracking system with three layers of protection:

1. **Per-IP limit** (line 23): `MAX_PER_IP = 3` -- prevents a single client from monopolizing connections.
2. **Global limit** (line 24): `MAX_GLOBAL = 100` -- prevents total server connection exhaustion.
3. **Zombie timeout** (line 27): `MAX_CONNECTION_MS = 30 * 60_000` (30 minutes) -- auto-releases connections that never properly disconnect.

### Enforcement verified in SSE routes

Both SSE routes enforce the caps at entry:

- `app/api/sse/candles/route.ts` lines 43-48: Calls `acquireConnection(clientIp)`, returns HTTP 429 "Too Many Connections" with `Retry-After: 30` header if capped.
- `app/api/sse/protocol/route.ts` lines 43-48: Same pattern.

Both routes also implement proper cleanup:
- `releaseConnection(ip)` called on disconnect (lines 55-61 in candles route).
- `scheduleAutoRelease(ip)` called immediately after acquisition (line 51) as a safety net for zombie connections.
- Double-release prevention via `released` boolean flag.

### Implementation quality

- `acquireConnection()` checks global cap first, then per-IP cap, then atomically increments both counters.
- `releaseConnection()` uses `Math.max(0, globalCount - 1)` to prevent underflow from double-release edge cases.
- `scheduleAutoRelease()` uses `timeout.unref()` to avoid preventing Node.js process exit.
- Zero external dependencies.

## Assessment

The SSE connection exhaustion vector is fully mitigated. Per-IP caps (3), global caps (100), and zombie timeouts (30 min) are implemented and enforced at both SSE route entry points. The blast radius from connection flooding is now bounded. Upgrading from PARTIALLY_FIXED to **FIXED**.
