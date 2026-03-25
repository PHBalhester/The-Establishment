# VERIFY-H001: Webhook Auth Bypass
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** PARTIALLY_FIXED

## Evidence
In `app/app/api/webhooks/helius/route.ts`:

1. **timingSafeEqual is used** (line 54): `import { timingSafeEqual } from "node:crypto";`
2. **Constant-time comparison** (lines 244-252): The auth header is compared using `timingSafeEqual(secretBuf, compareBuf)`. When lengths differ, the secret is compared against itself to avoid leaking length info through timing, then the request is rejected.
3. **Body size limit** (lines 259-266): A 1MB `MAX_BODY_BYTES` cap is enforced via Content-Length header check, returning 413 if exceeded.
4. **Fail-closed in production** (lines 225-235): If `HELIUS_WEBHOOK_SECRET` is unset in production (`NODE_ENV=production`), ALL requests are rejected with 500.
5. **Rate limiting** (lines 209-216): Per-IP rate limiting via `checkRateLimit()` with `WEBHOOK_RATE_LIMIT` config.

## Assessment
The fix is complete. The timing oracle vulnerability is fully addressed with proper `timingSafeEqual` usage, including the length-mismatch edge case (comparing secret against itself to avoid timing leaks). Body size limiting and rate limiting are also in place.
