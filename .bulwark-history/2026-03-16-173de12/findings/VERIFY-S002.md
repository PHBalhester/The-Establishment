# VERIFY-S002: Chained Supply Chain Attack
**Status:** PARTIALLY_FIXED
**Verified:** 2026-03-09
**Previous:** PARTIALLY_FIXED

## Evidence
S001 chains H003 + H002 + H001. All three must be fully closed for S001 to be FIXED.

**H003 (Lockfile Not Committed):** PARTIALLY_FIXED. package-lock.json is now committed and tracked. Railway/Nixpacks uses `npm ci` by default. However, no `.npmrc` with `ignore-scripts=true` exists -- postinstall script attack vector remains open.

**H002 (API Key in Client Bundle):** PARTIALLY_FIXED. RPC proxy correctly keeps the RPC URL server-side. However, `HELIUS_API_KEY` is still exported from `shared/constants.ts` (line 474), which is importable by client code. The webhook-capable key should be in a server-only module.

**H001 (Webhook Auth Fail-Open):** PARTIALLY_FIXED. Fail-open replaced with fail-closed in production. However, auth comparison uses `!==` string equality instead of `crypto.timingSafeEqual` -- timing side-channel remains.

## Assessment
The chain remains viable. While each individual finding has been partially addressed (fail-closed webhook, lockfile committed, RPC proxy), residual gaps in all three links mean the combined attack surface is reduced but not eliminated. Key remaining gaps: (1) no `ignore-scripts` in `.npmrc`, (2) API key in shared module, (3) no timing-safe comparison.
