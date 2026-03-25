---
phase: 89-final-cleanup
plan: 03
subsystem: infra
tags: [crank, circuit-breaker, health-endpoint, spending-cap, railway]

# Dependency graph
requires:
  - phase: 30-38
    provides: "Crank runner with epoch advancement and vault top-up"
provides:
  - "Circuit breaker (5 consecutive errors -> halt)"
  - "Rolling-hour SOL spending cap (0.5 SOL/hour)"
  - "Vault top-up ceiling (0.1 SOL max per operation)"
  - "Internal /health endpoint for Railway monitoring"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Circuit breaker pattern for crank operational safety"
    - "Rolling-window spending tracker with per-entry timestamping"

key-files:
  created: []
  modified:
    - "scripts/crank/crank-runner.ts"

key-decisions:
  - "Circuit breaker threshold at 5 consecutive errors (sufficient for transient RPC issues)"
  - "Conservative 10k lamports per-TX cost estimate (50x headroom in spending cap)"
  - "Health endpoint on port 8080 with full status JSON (not just 200 OK)"
  - "Vault top-up ceiling at 0.1 SOL (20x the normal 0.005 SOL top-up)"

patterns-established:
  - "Circuit breaker: consecutiveErrors counter, reset on success, halt on threshold"
  - "Spending cap: rolling-window array with prune-on-cycle"

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 89 Plan 03: Crank Hardening Summary

**Circuit breaker (5 errors -> halt), 0.5 SOL/hour spending cap, 0.1 SOL top-up ceiling, and /health endpoint for Railway monitoring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T20:47:48Z
- **Completed:** 2026-03-09T20:51:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- H019 closed: Circuit breaker halts crank after 5 consecutive errors, preventing infinite error loops
- H019 closed: Rolling-hour SOL spending cap (0.5 SOL) prevents runaway transaction costs
- H013 closed: Vault top-up capped at 0.1 SOL per operation, preventing crank wallet drain
- H019 closed: Internal /health endpoint returns JSON status for Railway health checks

## Task Commits

Each task was committed atomically:

1. **Task 1: Circuit breaker + spending cap + vault top-up ceiling** - `b2b3d12` (feat)
2. **Task 2: Internal /health endpoint** - `547fe02` (feat)

## Files Created/Modified
- `scripts/crank/crank-runner.ts` - Added circuit breaker, spending cap, top-up ceiling, and /health endpoint

## Decisions Made
- Circuit breaker threshold: 5 consecutive errors (balances transient RPC issues vs. genuine failures)
- Per-TX cost estimate: 10,000 lamports (conservative; actual base fee is 5,000 + priority fee)
- Health endpoint port: 8080 (configurable via HEALTH_PORT env var), bound to 0.0.0.0
- Health response includes: status, consecutiveErrors, hourlySpendLamports, uptime, lastSuccessAt
- Vault top-up spending also tracked in the hourly spending cap (prevents top-up loops from draining wallet)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Railway health check will automatically reach :8080/health if configured.

## Next Phase Readiness
- H019 and H013 audit findings fully closed
- Crank has three independent safety mechanisms (circuit breaker, spending cap, top-up ceiling)
- Health endpoint ready for Railway health check configuration

---
*Phase: 89-final-cleanup*
*Completed: 2026-03-09*
