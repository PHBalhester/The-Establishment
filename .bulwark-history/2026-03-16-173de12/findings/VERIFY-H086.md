# VERIFY-H086: No Crank Health Check
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** PARTIALLY_FIXED

## Evidence
`scripts/crank/crank-runner.ts` lines 152-190 implement a full HTTP health server:

- Binds to `0.0.0.0:${HEALTH_PORT}` (default 8080, configurable via `HEALTH_PORT` env var)
- Responds to `GET /health` with JSON status including:
  - `status`: "running" or "halted" (based on circuit breaker state)
  - `consecutiveErrors`: current error count
  - `circuitBreakerThreshold`: the halt threshold (5)
  - `hourlySpendLamports`: current spending within the rolling window
  - `maxHourlySpendLamports`: the spending cap
  - `uptime`: process uptime in seconds
  - `lastSuccessAt`: ISO timestamp of last successful epoch cycle
- Returns 404 for all other paths
- Server is started at line 385 before the main loop begins
- Graceful shutdown via SIGINT/SIGTERM closes the health server (lines 199, 205)

## Assessment
Fix is complete. The `/health` endpoint provides comprehensive crank observability for Railway's internal health checks. It exposes circuit breaker state, spending metrics, and last success time -- sufficient for monitoring and alerting. The endpoint is internal-only (Railway internal probe, no public domain assigned).
