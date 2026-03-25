# VERIFY-H002: Helius API Key in Bundle
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** PARTIALLY_FIXED

## Evidence
1. **`shared/constants.ts` has no `HELIUS_API_KEY` export.** Grep confirms zero matches in the shared constants file.
2. **`HELIUS_API_KEY` only exists in server-side scripts** (`scripts/webhook-manage.ts`, `scripts/backfill-candles.ts`) where it is read from `process.env.HELIUS_API_KEY` at runtime. These are CLI scripts that never enter the browser bundle.
3. The shared constants file exports only program IDs, mint addresses, PDA seeds, pool configs, and protocol constants -- no API keys or secrets.
4. RPC access uses `HELIUS_RPC_URL` as a server-only env var (comment at line 477: "Server-side code reads HELIUS_RPC_URL env var directly").

## Assessment
The fix is complete. `HELIUS_API_KEY` has been removed from the shared constants module. It only exists in server-side scripts that read it from environment variables at runtime, never in code that could be bundled for the browser.
