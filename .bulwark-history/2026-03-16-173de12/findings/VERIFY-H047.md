# VERIFY-H047: Single RPC No Failover
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

File: `app/app/api/rpc/route.ts`

1. **Multiple RPC endpoints** (lines 128-132): Endpoint list built from `HELIUS_RPC_URL`, `HELIUS_RPC_URL_FALLBACK`, and `DEVNET_RPC_URL` (imported from shared). Falsy values filtered out via `.filter(Boolean)`.

2. **Failover logic** (lines 142-173): Iterates `orderedEndpoints` in a for-loop. On HTTP 5xx (line 152) or network error/timeout (catch block, line 166), logs a warning with masked hostname and `continue`s to the next endpoint. Only returns the upstream response on non-5xx status. If all endpoints exhaust, returns 502 with a generic error message (line 178) and reports to Sentry.

3. **Sticky routing** (lines 69, 134-137): Module-level `lastSuccessfulEndpoint` variable updated on each successful response (line 160). On the next request, the last-successful endpoint is placed first in `orderedEndpoints`, with remaining endpoints as fallbacks. This avoids repeatedly hitting a known-down endpoint.

4. **API key masking** (lines 72-78): `maskEndpoint()` extracts only the hostname from URLs before logging, preventing API key leakage in console output.

## Assessment

All three requirements satisfied: multi-endpoint failover (primary + fallback + devnet), retry on 5xx/network errors, and sticky routing to the last successful endpoint. The previous round's finding (single `HELIUS_RPC_URL` with no fallback) is fully addressed.
