# VERIFY-H008: SSE Amplification DoS
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
In `app/lib/sse-connections.ts`:

1. **Per-IP connection cap:** `MAX_PER_IP = 3` -- each IP address can open at most 3 concurrent SSE connections. `acquireConnection(ip)` returns false when exceeded.

2. **Global connection cap:** `MAX_GLOBAL = 100` -- total SSE connections across all clients capped at 100. Prevents server resource exhaustion.

3. **Zombie connection cleanup:** `scheduleAutoRelease(ip)` sets a 30-minute timeout (`MAX_CONNECTION_MS = 30 * 60_000`) that automatically releases connection slots for clients that disconnect without sending FIN.

4. **Both SSE endpoints protected:**
   - `app/app/api/sse/candles/route.ts` (lines 42-48): Calls `acquireConnection(clientIp)`, returns 429 with `Retry-After: 30` if denied.
   - `app/app/api/sse/protocol/route.ts` (lines 42-48): Same pattern.

5. **Proper cleanup on disconnect:** Both endpoints call `releaseConnection(clientIp)` on abort signal and stream cancellation, with double-release prevention via `released` flag.

## Assessment
The fix is complete. Per-IP limiting (3), global cap (100), and zombie cleanup (30 min timeout) fully address the SSE amplification DoS vector. The 429 response with Retry-After header follows HTTP best practices for rate limiting.
