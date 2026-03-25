---
phase: 90-gap-closure-launch-verification
plan: 02
subsystem: api
tags: [rate-limiting, sentry, rpc-failover, webhook-security, nextjs]

requires:
  - phase: 84-frontend-hardening
    provides: rate-limit infrastructure (lib/rate-limit.ts), sentry module (lib/sentry.ts)
provides:
  - Rate-limited /api/sol-price endpoint (30 req/min)
  - RPC proxy failover across primary/fallback/devnet endpoints with sticky routing
  - Webhook replay protection (blockTime staleness check, 5 min max)
  - Sentry captureException in all 6 API route files
affects: []

tech-stack:
  added: []
  patterns:
    - "RPC failover with sticky routing (lastSuccessfulEndpoint)"
    - "Webhook blockTime staleness guard (MAX_TX_AGE_SECONDS = 300)"

key-files:
  created: []
  modified:
    - app/app/api/sol-price/route.ts
    - app/app/api/rpc/route.ts
    - app/app/api/webhooks/helius/route.ts
    - app/app/api/candles/route.ts
    - app/app/api/carnage-events/route.ts
    - app/app/api/health/route.ts
    - app/lib/rate-limit.ts

key-decisions:
  - "RPC failover uses sticky routing (try last-successful endpoint first) to minimize latency"
  - "Webhook skips individual stale transactions, not entire payload (Helius may batch mixed ages)"
  - "Endpoint masking via URL.hostname in logs to prevent API key leakage"

patterns-established:
  - "SOL_PRICE_RATE_LIMIT config: 30 req/min (matches 60s cache + page load pattern)"

requirements-completed: []

duration: 8min
completed: 2026-03-09
---

# Phase 90 Plan 02: API Route Hardening Summary

**Rate-limited sol-price, RPC failover with sticky routing, webhook replay protection, and Sentry captureException across all 6 API routes**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-09T22:03:29Z
- **Completed:** 2026-03-09T22:11:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- H024: /api/sol-price rate-limited at 30 req/min using existing checkRateLimit infrastructure
- H047: RPC proxy now tries primary Helius, fallback Helius (HELIUS_RPC_URL_FALLBACK), and devnet endpoints with sticky routing to last-successful endpoint
- H049: Webhook handler skips raw transactions with blockTime older than 5 minutes (replay protection)
- H045: All 6 API route files import and call captureException from lib/sentry.ts alongside console.error

## Task Commits

Each task was committed atomically:

1. **Task 1: Rate limit sol-price + RPC failover + webhook replay protection** - `339175e` (feat)
2. **Task 2: Replace console.error with captureException in API routes** - `407bc20` (feat)

## Files Created/Modified
- `app/lib/rate-limit.ts` - Added SOL_PRICE_RATE_LIMIT config (30 req/min)
- `app/app/api/sol-price/route.ts` - Rate limiting + captureException
- `app/app/api/rpc/route.ts` - Failover with sticky routing + captureException
- `app/app/api/webhooks/helius/route.ts` - blockTime staleness check + captureException (4 catch blocks)
- `app/app/api/candles/route.ts` - captureException
- `app/app/api/carnage-events/route.ts` - captureException
- `app/app/api/health/route.ts` - captureException (2 catch blocks)

## Decisions Made
- RPC failover uses sticky routing (module-level lastSuccessfulEndpoint) to minimize latency on subsequent requests
- Webhook skips individual stale transactions, not entire payloads -- Helius may batch recent and slightly-old transactions together
- Endpoint URLs masked to hostname-only in logs (new URL(endpoint).hostname) to prevent API key leakage
- Enhanced account change webhooks skip blockTime check (they're account state snapshots, not transactions)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. HELIUS_RPC_URL_FALLBACK env var is optional.

## Next Phase Readiness
- All 4 audit findings (H024, H045, H047, H049) closed
- API routes are now rate-limited, error-reported to Sentry, failover-capable, and replay-protected
- Ready for remaining Phase 90 plans

---
*Phase: 90-gap-closure-launch-verification*
*Completed: 2026-03-09*
