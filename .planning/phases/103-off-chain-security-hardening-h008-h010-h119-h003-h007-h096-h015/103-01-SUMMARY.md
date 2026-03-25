---
phase: 103
plan: 01
status: complete
started: 2026-03-23
completed: 2026-03-23
---

## Summary

Hardened the RPC proxy against 4 attack vectors (H008, H010, H015) and added rate limits to 2 unprotected database-hitting endpoints.

## What Changed

### Task 1: Fix IP extraction and add rate limit configs
- Fixed `getClientIp()` in `app/lib/rate-limit.ts` to use rightmost x-forwarded-for IP (not leftmost) — leftmost is attacker-controlled, rightmost is set by the nearest trusted proxy
- Added CANDLES_RATE_LIMIT (120 req/min) and CARNAGE_EVENTS_RATE_LIMIT (60 req/min) config constants

### Task 2: Harden RPC proxy with 4 defense layers
- Batch rejection: JSON array payloads return 400 (prevents batch amplification, H008)
- Body size limit: 64KB max before JSON parsing (prevents memory exhaustion)
- Fetch timeout: 10s AbortController on upstream RPC calls (prevents timeout exhaustion, H010)
- Concurrent cap: 20 in-flight requests per IP, 503 when exceeded

### Task 3: Rate limit candles and carnage-events endpoints
- `/api/candles`: 120 req/min per IP with Retry-After header
- `/api/carnage-events`: 60 req/min per IP with Retry-After header
- Both endpoints previously had zero rate limiting (H015)

## Key Files

### key-files.modified
- `app/app/api/rpc/route.ts` — 4 defense layers
- `app/lib/rate-limit.ts` — Rightmost IP extraction, 2 new rate limit configs
- `app/app/api/candles/route.ts` — Rate limit guard
- `app/app/api/carnage-events/route.ts` — Rate limit guard

## Commits
- `7600366` — feat(103-01): fix IP extraction to rightmost and add candle/carnage rate limits
- `45df61f` — feat(103-01): harden RPC proxy with batch rejection, body limit, timeout, concurrent cap
- `b445d97` — fix(103-01): add rate limits to candles and carnage-events endpoints

## Deviations
None.

## Self-Check: PASSED
- [x] RPC proxy rejects JSON array (batch) requests with 400
- [x] RPC proxy enforces 64KB body size limit
- [x] RPC proxy times out upstream fetch after 10s
- [x] RPC proxy caps 20 concurrent requests per IP
- [x] Rate limiter uses rightmost x-forwarded-for IP
- [x] /api/candles rate limited at 120/min
- [x] /api/carnage-events rate limited at 60/min
- [x] Build passes with zero TypeScript errors
