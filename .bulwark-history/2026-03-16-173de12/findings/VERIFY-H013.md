# VERIFY-H013: Vault Top-Up Without Limit
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
`scripts/crank/crank-runner.ts` implements a multi-layer ceiling on vault top-ups:

1. **Per-top-up ceiling** (line 82): `MAX_TOPUP_LAMPORTS = 100_000_000` (0.1 SOL). Every top-up is capped via `Math.min(requestedTopUp, MAX_TOPUP_LAMPORTS)` at line 421.

2. **Hourly spending cap** (line 104): `MAX_HOURLY_SPEND_LAMPORTS = 500_000_000` (0.5 SOL). The `recordSpend()` function (line 139) checks cumulative spend within a 60-minute sliding window before allowing any top-up or transaction. If exceeded, the crank halts.

3. **Circuit breaker** (line 91): After 5 consecutive errors, the crank exits entirely, preventing repeated failed top-up attempts.

The top-up logic at lines 418-448 applies the cap, checks the spending limit, and only then executes the transfer.

## Assessment
Fix is complete. Three independent safety layers prevent unbounded vault top-ups: per-transaction ceiling, rolling hourly spending cap, and circuit breaker halt. A bug causing repeated top-ups would hit the 0.5 SOL/hour cap after 5 iterations and halt.
