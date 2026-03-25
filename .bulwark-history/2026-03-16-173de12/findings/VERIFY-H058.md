# VERIFY-H058: Unredacted RPC URL
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** FIXED

## Evidence
No regression. `scripts/crank/crank-runner.ts` still has `maskRpcUrl()` function that masks API keys in both path segments and query parameters. Additionally, Phase 89 commit `82fafe0` (fix(89-01): timing-safe webhook auth + body size limit + remove HELIUS_API_KEY) removed the HELIUS_API_KEY from the webhook route, further reducing key exposure.

## Assessment
Fix confirmed and strengthened by additional key removal in Phase 89.
