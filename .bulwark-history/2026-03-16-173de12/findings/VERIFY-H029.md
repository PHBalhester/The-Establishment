# VERIFY-H029: Crank Infinite Retry
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
`scripts/crank/crank-runner.ts` implements a circuit breaker at lines 84-95:

- `CIRCUIT_BREAKER_THRESHOLD = 5` -- after 5 consecutive errors, the crank halts
- `consecutiveErrors` counter incremented on each catch (line 528), reset to 0 on success (line 505)
- When threshold is reached (line 535-539), the crank logs a CRITICAL message and breaks out of the main loop
- Additionally, `ERROR_RETRY_DELAY_MS = 30_000` (30s) provides backoff between retries

The circuit breaker is complemented by the hourly spending cap (`MAX_HOURLY_SPEND_LAMPORTS = 0.5 SOL`), which provides a financial circuit breaker independent of the error counter.

## Assessment
Fix is complete. The consecutive error counter with threshold=5 directly addresses infinite retry. After 5 failures without any successful cycle, the crank exits cleanly. The 30s delay between retries provides backoff, and the spending cap adds a secondary financial safety net. The `/health` endpoint (H086) exposes the circuit breaker state for monitoring.
