# VERIFY-H024: No Rate Limiting
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence
`app/lib/rate-limit.ts` implements a sliding-window in-memory rate limiter with per-IP tracking, periodic cleanup (60s sweep, 5-min stale threshold), and IP extraction from `x-forwarded-for` / `x-real-ip` headers.

Rate limiting is now applied to all non-SSE API routes:

| Route | Config | Limit |
|---|---|---|
| `/api/rpc` (POST) | `RPC_RATE_LIMIT` | 60 req/min |
| `/api/sol-price` (GET) | `SOL_PRICE_RATE_LIMIT` | 30 req/min |
| `/api/webhooks/helius` (POST) | `WEBHOOK_RATE_LIMIT` | 120 req/min |

Verified imports and `checkRateLimit` calls:
- `app/app/api/rpc/route.ts` line 16 (import), lines 82-89 (check + 429 response)
- `app/app/api/sol-price/route.ts` line 20 (import), lines 84-91 (check + 429 response with Retry-After header)
- `app/app/api/webhooks/helius/route.ts` line 57 (import), lines 210-217 (check + 429 response)

SSE endpoints (`/api/sse/protocol`, `/api/sse/candles`) use connection caps via `acquireConnection()` from `@/lib/sse-connections` (H008) rather than request rate limiting -- appropriate since SSE connections are long-lived.

Read-only endpoints `/api/candles` and `/api/health` do not have per-IP rate limiting. These are lower risk: candles queries Postgres with a max 2000-row limit, and health is a lightweight liveness check. Neither proxies external APIs or accepts write operations.

## Assessment
Fixed. The previously missing `/api/sol-price` rate limit has been added (30 req/min, `SOL_PRICE_RATE_LIMIT`). All API routes that proxy external services or accept write payloads now have rate limiting. The round 2 gap is closed.
