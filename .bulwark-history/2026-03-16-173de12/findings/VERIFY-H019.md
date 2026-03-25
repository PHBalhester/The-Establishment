# VERIFY-H019: Crank No Kill Switch
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** PARTIALLY_FIXED

## Evidence
In `scripts/crank/crank-runner.ts` (commits b2b3d12 + 547fe02):

**1. Circuit breaker (consecutive error halt) -- FIXED.**
- `CIRCUIT_BREAKER_THRESHOLD = 5` (line 91)
- `consecutiveErrors` counter incremented on each catch (line 528), reset to 0 on success (line 505)
- When threshold reached, logs CRITICAL and breaks out of the main loop (lines 535-540)
- `/health` endpoint reports `"halted"` status when breaker is tripped (line 167)

**2. Per-hour spending cap -- FIXED.**
- `MAX_HOURLY_SPEND_LAMPORTS = 500_000_000` (0.5 SOL, line 104)
- `spendingLog` array tracks every spend entry with timestamp (lines 117, 148)
- `getCurrentHourlySpend()` sums entries within the last hour (lines 120-125)
- `recordSpend()` returns false (halt) if adding new spend would exceed cap (lines 139-150)
- Called before vault top-up (line 429) and after each VRF cycle (line 500)
- `pruneSpendingLog()` evicts entries older than 1 hour (lines 128-133)
- Vault top-up is also capped per-transaction at `MAX_TOPUP_LAMPORTS = 0.1 SOL` (line 82, H013 fix)

**3. /health endpoint -- FIXED.**
- HTTP server on configurable `HEALTH_PORT` (default 8080), bound to 0.0.0.0 (lines 163-190)
- GET /health returns JSON with: status (running/halted), consecutiveErrors, circuitBreakerThreshold, hourlySpendLamports, maxHourlySpendLamports, uptime, lastSuccessAt (lines 166-177)
- Server started before main loop (line 385), closed on SIGINT/SIGTERM (lines 199, 205)
- No public domain assigned -- internal Railway probes only (zero public attack surface)

## Assessment
All three gaps from the previous verification are now addressed. The crank has a proper circuit breaker that halts after 5 consecutive errors, a rolling-hour spending cap with 50x headroom over normal usage, and a /health endpoint for Railway health checks. The implementation is clean and well-documented.
