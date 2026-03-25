---
phase: 103-off-chain-security-hardening
verified: 2026-03-23T18:44:07Z
status: passed
score: 14/14 must-haves verified
---

# Phase 103: Off-Chain Security Hardening Verification Report

**Phase Goal:** Close 7 confirmed Bulwark off-chain audit findings across 4 fix groups: RPC proxy hardening (batch rejection, fetch timeout, concurrent cap, body size limit), webhook decode safety (fail-closed on error, per-account-type bounds validation), supply chain integrity (npm ci enforcement, workspace:* protocol), and rate limiter IP extraction (rightmost x-forwarded-for, new endpoint rate limits)
**Verified:** 2026-03-23T18:44:07Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                      | Status     | Evidence                                                                    |
|----|----------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------|
| 1  | RPC proxy rejects JSON array (batch) requests with 400                    | VERIFIED   | `Array.isArray(body)` guard at line 140 of rpc/route.ts returns 400 JSON-RPC error |
| 2  | RPC proxy enforces 64KB body size limit before JSON parsing               | VERIFIED   | `content-length > 65_536` check at line 122, returns 413 before `request.json()` |
| 3  | RPC proxy times out upstream fetch after 10 seconds                       | VERIFIED   | `signal: AbortSignal.timeout(10_000)` at line 191 of rpc/route.ts          |
| 4  | RPC proxy caps 20 concurrent in-flight requests per IP                    | VERIFIED   | `inFlight` Map + `MAX_CONCURRENT = 20` at lines 88–89; try/finally decrements at lines 232–239 |
| 5  | Rate limiter extracts rightmost IP from x-forwarded-for                   | VERIFIED   | `ips[ips.length - 1]` pattern at line 149 of rate-limit.ts; leftmost `split(",")[0]` pattern absent |
| 6  | /api/candles has per-IP rate limiting (120 req/min)                       | VERIFIED   | `checkRateLimit(clientIp, CANDLES_RATE_LIMIT, "candles")` at line 190 of candles/route.ts |
| 7  | /api/carnage-events has per-IP rate limiting (60 req/min)                 | VERIFIED   | `checkRateLimit(clientIp, CARNAGE_EVENTS_RATE_LIMIT, "carnage-events")` at line 36 of carnage-events/route.ts |
| 8  | Anchor decode failure does NOT call setAccountState                       | VERIFIED   | Catch block (lines 609–618) only calls `console.error` + `captureException` + falls through. `setAccountState` is absent from all error paths. |
| 9  | Sentry fires on decode failure and bounds validation rejection            | VERIFIED   | `captureException` at line 617 (decode fail) and line 601 (bounds fail)    |
| 10 | Decoded accounts validated against bounds before storage                 | VERIFIED   | `validateDecodedAccount(label, normalized)` gate at lines 599–603, before `protocolStore.setAccountState` at line 605 |
| 11 | Accounts failing validation are NOT stored in protocolStore              | VERIFIED   | `continue` at line 602 skips `setAccountState`; `decodeError` field completely absent |
| 12 | Railway builds use npm ci (not npm install)                              | VERIFIED   | railway-crank.toml: `buildCommand = "npm ci"`. railway.toml: `buildCommand = "npm ci && npm run --workspace app build"` |
| 13 | @dr-fraudsworth/shared resolves via local path (not registry)            | VERIFIED   | app/package.json: `"@dr-fraudsworth/shared": "file:../shared"` (note: plan specified `workspace:*` but `file:` is npm-compatible equivalent — see deviation note) |
| 14 | Tests cover all 5 validators + IP extraction edge cases                  | VERIFIED   | webhook-validators.test.ts: 183 lines, 19 tests covering all 5 types + unknown labels. rate-limit.test.ts: 67 lines, 7 tests including anti-regression for leftmost spoofing |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact                                           | Expected                                              | Status     | Details                                                                       |
|----------------------------------------------------|-------------------------------------------------------|------------|-------------------------------------------------------------------------------|
| `app/app/api/rpc/route.ts`                        | Hardened proxy: batch rejection, body limit, timeout, concurrent cap | VERIFIED | 241 lines; all 4 guards present and wired into the POST handler with try/finally |
| `app/lib/rate-limit.ts`                           | Fixed IP extraction (rightmost) + 2 new rate limit configs | VERIFIED | 197 lines; `ips[ips.length - 1]` present; `CANDLES_RATE_LIMIT` + `CARNAGE_EVENTS_RATE_LIMIT` exported |
| `app/app/api/candles/route.ts`                    | Rate-limited candle endpoint                         | VERIFIED   | Imports `checkRateLimit, getClientIp, CANDLES_RATE_LIMIT`; guard at handler start (line 188–196) |
| `app/app/api/carnage-events/route.ts`             | Rate-limited carnage events endpoint                 | VERIFIED   | Imports `checkRateLimit, getClientIp, CARNAGE_EVENTS_RATE_LIMIT`; guard at handler start (line 35–42) |
| `app/lib/webhook-validators.ts`                   | Per-account-type bounds validators                   | VERIFIED   | 159 lines; exports `validateDecodedAccount`; 5 type validators + `numericValue` helper |
| `app/app/api/webhooks/helius/route.ts`            | Fail-closed decode handling + bounds validation gate | VERIFIED   | `validateDecodedAccount` imported and called; catch block has no `setAccountState`; `decodeError` absent |
| `railway-crank.toml`                              | npm ci for crank builds                              | VERIFIED   | `buildCommand = "npm ci"` confirmed                                           |
| `railway.toml`                                    | npm ci for app builds                                | VERIFIED   | `buildCommand = "npm ci && npm run --workspace app build"` confirmed          |
| `app/package.json`                                | Local path dependency for shared package             | VERIFIED   | `"@dr-fraudsworth/shared": "file:../shared"` (registry fallback impossible)  |
| `app/lib/__tests__/webhook-validators.test.ts`    | Unit tests for bounds validators                     | VERIFIED   | 183 lines; imports `validateDecodedAccount`; covers all 5 types + edge cases |
| `app/lib/__tests__/rate-limit.test.ts`            | Unit tests for IP extraction                         | VERIFIED   | 67 lines; imports `getClientIp`; covers rightmost extraction + regression    |

---

### Key Link Verification

| From                                           | To                                    | Via                                          | Status   | Details                                                             |
|------------------------------------------------|---------------------------------------|----------------------------------------------|----------|---------------------------------------------------------------------|
| `app/app/api/rpc/route.ts`                    | `app/lib/rate-limit.ts`              | `import getClientIp, checkRateLimit`         | WIRED    | Imported at line 15; used at lines 103–104                         |
| `app/app/api/candles/route.ts`                | `app/lib/rate-limit.ts`              | `import checkRateLimit, CANDLES_RATE_LIMIT`  | WIRED    | Imported at line 31; used at lines 189–195                         |
| `app/app/api/carnage-events/route.ts`         | `app/lib/rate-limit.ts`              | `import checkRateLimit, CARNAGE_EVENTS_RATE_LIMIT` | WIRED | Imported at line 22; used at lines 35–42                          |
| `app/app/api/webhooks/helius/route.ts`        | `app/lib/webhook-validators.ts`      | `import validateDecodedAccount`              | WIRED    | Imported at line 103; called at line 599                           |
| `app/app/api/webhooks/helius/route.ts`        | `app/lib/sentry.ts`                  | `captureException` on decode/validation fail | WIRED    | `captureException` at lines 601 and 617                            |
| `app/lib/__tests__/webhook-validators.test.ts` | `app/lib/webhook-validators.ts`     | `import validateDecodedAccount`              | WIRED    | Line 2 import; 19 test cases exercise the function                 |
| `app/lib/__tests__/rate-limit.test.ts`        | `app/lib/rate-limit.ts`              | `import getClientIp`                         | WIRED    | Line 2 import; 7 test cases exercise the function                  |
| `app/package.json`                            | `../shared` (local package)           | `file:../shared` protocol                   | WIRED    | Hard-fails at install time if path missing; never resolves from registry |

---

### Requirements Coverage

This is an audit-driven phase with no REQUIREMENTS.md IDs. Coverage maps to Bulwark findings:

| Finding | Truth(s) Closed | Status       |
|---------|-----------------|--------------|
| H008    | Truths 1 + 2 (batch rejection + body size limit) | SATISFIED |
| H010    | Truths 3 + 4 (fetch timeout + concurrent cap)    | SATISFIED |
| H015    | Truths 5 + 6 + 7 (rightmost IP + candles RL + carnage-events RL) | SATISFIED |
| H119    | Truth 8 (fail-closed on decode error)            | SATISFIED |
| H096    | Truths 9 + 10 + 11 (bounds validation + sentry + no storage on reject) | SATISFIED |
| H003    | Truth 12 (npm ci in both Railway configs)        | SATISFIED |
| H007    | Truth 13 (file: protocol, scope registered)      | SATISFIED |

---

### Anti-Patterns Found

No blockers or warnings found. Verification checks:

- No `TODO`/`FIXME`/`placeholder` in any modified file.
- No `return null` / empty handlers in security guard code.
- No `console.log` debug logging (only `console.warn` and `console.error`).
- All 4 RPC proxy guards are in the real handler path, not behind dead-code branches.
- `updatedCount++` at line 620 of webhook handler executes after the catch block (minor: counter increments even on decode failure), but this is cosmetic — the critical behavior (no `setAccountState` in error path) is correct.

---

### Deviation Note: `file:` vs `workspace:*`

Plan 103-03 specified `workspace:*` protocol for `@dr-fraudsworth/shared`. The executor used `file:../shared` instead because npm v11 does not support `workspace:` (that is a pnpm/Yarn feature). The `file:` protocol provides an identical security guarantee: it resolves the dependency from an explicit local filesystem path and hard-fails at `npm install`/`npm ci` time if that path is missing. It cannot fall back to the npm registry. The security goal of H007 is fully satisfied.

---

### Human Verification Required

None required for automated goal verification. The following items are documented in 103-04-SUMMARY.md for manual confirmation at devnet deployment:

1. **Batch rejection smoke test**
   - Command: `curl -X POST https://<host>/api/rpc -H "Content-Type: application/json" -d '[{"jsonrpc":"2.0","method":"getHealth","id":1}]'`
   - Expected: HTTP 400 with `"Batch requests not supported"`

2. **Body size limit smoke test**
   - Command: POST a payload larger than 64KB to `/api/rpc`
   - Expected: HTTP 413

3. **Normal request smoke test**
   - Command: `curl -X POST https://<host>/api/rpc -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"getHealth","id":1}'`
   - Expected: HTTP 200 with valid JSON-RPC response

These are integration-level checks that require a running server; structural verification confirms the guards exist and are wired correctly.

---

## Summary

All 7 Bulwark findings (H008, H010, H015, H119, H096, H003, H007) have been structurally closed. Every security guard exists in the actual codebase (not placeholders), is substantive, and is wired into the live request paths. The implementation deviates from the plan on one point (H007 uses `file:` instead of `workspace:*`) but achieves the same security guarantee. Unit tests cover the new validators and the IP extraction fix, including an explicit anti-regression test for the leftmost-IP spoofing vector.

---

_Verified: 2026-03-23T18:44:07Z_
_Verifier: Claude (gsd-verifier)_
