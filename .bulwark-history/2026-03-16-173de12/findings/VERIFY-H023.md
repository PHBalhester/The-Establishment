# VERIFY-H023: SSE Connection Exhaustion
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
`app/lib/sse-connections.ts` implements a connection tracker with two caps:

- **Per-IP limit**: `MAX_PER_IP = 3` -- prevents a single client from monopolizing connections
- **Global limit**: `MAX_GLOBAL = 100` -- prevents total server exhaustion
- **Zombie cleanup**: `MAX_CONNECTION_MS = 30 * 60_000` (30 min) auto-releases connections that never properly disconnect

Both SSE endpoints enforce this:
- `app/app/api/sse/candles/route.ts` line 43: `acquireConnection(clientIp)` with 429 rejection
- `app/app/api/sse/protocol/route.ts` line 43: same pattern

On disconnect (abort signal) or stream cancel, `releaseConnection()` is called. The `scheduleAutoRelease()` timeout handles crashed clients that don't send FIN.

## Assessment
Fix is complete. Both SSE endpoints enforce per-IP and global connection caps with proper lifecycle management (acquire on connect, release on disconnect, auto-release after 30 min). A malicious client opening many connections from one IP is capped at 3; global cap prevents distributed attacks from exhausting server resources.
