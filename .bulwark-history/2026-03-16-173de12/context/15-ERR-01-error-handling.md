---
task_id: db-phase1-error-handling
provides: [error-handling-findings, error-handling-invariants]
focus_area: error-handling
files_analyzed: [scripts/crank/crank-runner.ts, scripts/vrf/lib/vrf-flow.ts, app/lib/confirm-transaction.ts, app/lib/swap/multi-hop-builder.ts, app/hooks/useSwap.ts, app/hooks/useProtocolWallet.ts, app/lib/swap/error-map.ts, app/app/api/webhooks/helius/route.ts, app/app/api/sol-price/route.ts, scripts/deploy/verify.ts, scripts/deploy/lib/account-check.ts, scripts/vrf/devnet-vrf-validation.ts, scripts/e2e/overnight-runner.ts, app/lib/sentry.ts, app/lib/jupiter.ts, app/hooks/useChartData.ts, app/hooks/useCarnageEvents.ts, app/hooks/useChartSSE.ts, app/app/api/sse/candles/route.ts, app/providers/SettingsProvider.tsx]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 4, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Error Handling & Fail Modes -- Condensed Summary

## Key Findings (Top 10)
- **Crank runner lacks process-level unhandledRejection/uncaughtException handlers**: An unhandled rejection from a deeply-nested async path (e.g. inside `advanceEpochWithVRF`'s dynamic imports) could crash the 24/7 crank without logging -- `scripts/crank/crank-runner.ts:81-89`
- **Crank runner catch block truncates errors to 300 chars with no structured logging**: Error context (stack trace, transaction logs) is lost, making incident diagnosis difficult in production -- `scripts/crank/crank-runner.ts:302-315`
- **VRF flow `waitForSlotAdvance` infinite loop has no escape hatch**: If slot advancement stalls (RPC permanently returns stale slots), the while(true) loop at `scripts/vrf/lib/vrf-flow.ts:182` runs forever, blocking the crank
- **`fetchSolPrice()` in client has no timeout**: `app/lib/jupiter.ts:19` calls `fetch("/api/sol-price")` without an AbortSignal, potentially hanging indefinitely if the API route stalls
- **`useChartData` fetch has no timeout**: `app/hooks/useChartData.ts:140` calls `fetch(url)` to the candles API without AbortSignal -- can hang on slow/stalled API responses
- **`useCarnageEvents` fetch has no timeout**: `app/hooks/useCarnageEvents.ts:102` calls `fetch("/api/carnage-events")` without timeout signal
- **Webhook auth is optional by design**: `app/app/api/webhooks/helius/route.ts:136` skips auth when `HELIUS_WEBHOOK_SECRET` is unset. Production deployment without this env var leaves the webhook open to forged transaction data injection
- **Multi-hop builder ALT cache never invalidates**: `app/lib/swap/multi-hop-builder.ts:261` caches the ALT at module level forever. If the ALT is extended/replaced, stale cache causes all swaps to fail until page refresh
- **`pollTransactionConfirmation` calls `getBlockHeight` per poll iteration**: `app/lib/confirm-transaction.ts:53` makes an extra RPC call every 2s during confirmation polling -- could contribute to rate limit pressure under high swap volume
- **Overnight runner has 5+ catch-and-swallow blocks for "Non-critical" operations**: `scripts/e2e/overnight-runner.ts:412-435` swallows balance/vault reads silently -- if these consistently fail, diagnostic data is lost with no alerting

## Critical Mechanisms
- **Crank error recovery loop**: The main `while (!shutdownRequested)` loop in `crank-runner.ts:197-316` catches ALL errors from `advanceEpochWithVRF`, logs truncated error, waits 30s, retries. This is fail-open for availability (keeps running) but means ANY error -- including wallet drained, program upgraded, RPC decommissioned -- results in the same 30s-retry behavior with no escalation.
- **VRF stale-VRF recovery path**: `vrf-flow.ts:400-535` handles `vrfPending=true` from failed previous runs. Two recovery strategies (try reveal, then timeout+retry). Both paths have proper error propagation. The timeout path correctly waits 300 slots. The recovery path does NOT attempt atomic Carnage bundling (line 533), which means a Carnage trigger during recovery has an MEV gap.
- **Transaction confirmation polling**: `confirm-transaction.ts` polls via HTTP with a 90s hard timeout and blockhash expiry check. Returns `{ err }` for on-chain failures rather than throwing, which the callers (multi-hop-builder, useSwap) correctly check.
- **Error-map parser**: `error-map.ts:140-189` converts raw Solana/Anchor errors to user-friendly strings. Falls back to generic message. Does not leak internal state (program IDs, account addresses) to the UI.

## Invariants & Assumptions
- INVARIANT: Crank runner never exits on transient errors -- enforced at `crank-runner.ts:302-315` via catch-and-retry loop
- INVARIANT: Swap execution is atomic (all-or-nothing) -- enforced at `multi-hop-builder.ts:63` via single VersionedTransaction
- INVARIANT: pollTransactionConfirmation terminates within 90s -- enforced at `confirm-transaction.ts:15-16` via MAX_POLL_DURATION_MS
- ASSUMPTION: RPC endpoint remains responsive during crank operation -- UNVALIDATED (no circuit breaker or RPC health check)
- ASSUMPTION: `waitForSlotAdvance` will eventually receive an updated slot from RPC -- UNVALIDATED (infinite loop at `vrf-flow.ts:182`)
- ASSUMPTION: ALT on-chain account remains unchanged during browser session -- UNVALIDATED (stale ALT cache at `multi-hop-builder.ts:261`)
- ASSUMPTION: Helius webhook endpoint is protected by `HELIUS_WEBHOOK_SECRET` in production -- PARTIALLY ENFORCED (auth is conditional on env var being set, `route.ts:136`)

## Risk Observations (Prioritized)
1. **Crank runner silent crash risk**: No `process.on("unhandledRejection")` handler. Dynamic imports in VRF flow (`vrf-flow.ts:299,312`) + Switchboard SDK internals could produce unhandled rejections that bypass the main try/catch. Impact: Crank stops advancing epochs, protocol halts. -- `scripts/crank/crank-runner.ts` (entire file)
2. **VRF infinite wait on slot stall**: `waitForSlotAdvance` at `vrf-flow.ts:182` has no max iteration count or wall-clock timeout. A permanently stale RPC (returns same slot) blocks the crank forever. The transient-error catch at line 190 only handles thrown errors, not "RPC returns but slot never advances." -- `scripts/vrf/lib/vrf-flow.ts:182-194`
3. **Webhook auth bypass in production**: If `HELIUS_WEBHOOK_SECRET` is not set, ANY POST to `/api/webhooks/helius` is processed. An attacker could inject fake swap events, corrupt candle data, and manipulate displayed prices. -- `app/app/api/webhooks/helius/route.ts:135-141`
4. **Client-side fetch calls without timeout**: Three frontend hooks (`jupiter.ts:19`, `useChartData.ts:140`, `useCarnageEvents.ts:102`) use bare `fetch()` without `AbortSignal.timeout()`. On slow networks this can leave loading spinners indefinitely.

## Novel Attack Surface
- **Candle data injection via unauthenticated webhook**: If the webhook is unauthenticated in production, an attacker can POST fabricated transaction payloads with arbitrary swap amounts and prices. These flow through the event parser, into the candle aggregator, and out via SSE to all connected chart clients -- displaying false price data to all users simultaneously. The `onConflictDoNothing` idempotency guard does NOT help here because the attacker uses unique signatures for each fake transaction.

## Cross-Focus Handoffs
- **SEC-01**: Crank runner reads keypair from env/disk (`crank-provider.ts`) -- error in keypair loading could log sensitive bytes
- **CHAIN-01**: `multi-hop-builder.ts` uses `skipPreflight: true` for v0 transactions -- error detection relies entirely on `pollTransactionConfirmation` post-submission
- **BOT-01**: Crank runner's retry-forever pattern means a misconfigured crank drains SOL on vault top-ups (line 230-241) without any budget limit
- **API-04**: Webhook auth bypass is an authentication concern that intersects with error handling (optional auth is a fail-open pattern)

## Trust Boundaries
The crank runner trusts the Solana RPC to provide accurate slot data and transaction confirmation. The webhook handler trusts that Helius delivers authentic transaction payloads (enforced only when the secret is configured). The frontend trusts the `/api/sol-price` and `/api/candles` endpoints to return well-formed data -- malformed responses are caught but silently swallowed rather than reported. The swap execution path trusts `pollTransactionConfirmation` to correctly detect both on-chain success and failure, with a 90-second hard timeout as the safety net.
<!-- CONDENSED_SUMMARY_END -->

---

# Error Handling & Fail Modes -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase demonstrates generally competent error handling patterns: critical financial operations (swap execution) are atomic with proper error reporting to the UI, the crank runner uses a catch-and-retry pattern for availability, and the transaction confirmation system has both timeout and blockhash-expiry safeguards. The error-map module provides user-friendly error messages without leaking internal state.

However, several gaps exist: the production crank runner lacks process-level crash handlers (`unhandledRejection`/`uncaughtException`), the VRF slot-waiting loop has no escape hatch, multiple frontend fetch calls lack timeouts, and the webhook authentication is conditionally disabled. These patterns create risks ranging from crank silent death to potential data injection.

## Scope

All off-chain TypeScript code was analyzed. The `programs/` directory (Anchor/Rust on-chain code) was excluded per audit scope rules.

**Files analyzed in depth (Layer 3):**
- `scripts/crank/crank-runner.ts` (332 LOC) -- production crank bot
- `scripts/vrf/lib/vrf-flow.ts` (791 LOC) -- VRF epoch transition flow
- `app/lib/confirm-transaction.ts` (67 LOC) -- TX confirmation polling
- `app/lib/swap/multi-hop-builder.ts` (416 LOC) -- atomic swap builder
- `app/hooks/useSwap.ts` (937 LOC) -- swap lifecycle hook
- `app/hooks/useProtocolWallet.ts` (131 LOC) -- wallet abstraction
- `app/lib/swap/error-map.ts` (191 LOC) -- error code mapping
- `app/app/api/webhooks/helius/route.ts` (508 LOC) -- webhook handler
- `app/app/api/sol-price/route.ts` (124 LOC) -- SOL price proxy

**Files analyzed at Layer 2 (signatures/patterns):**
- `scripts/deploy/verify.ts`, `scripts/deploy/lib/account-check.ts`
- `scripts/vrf/devnet-vrf-validation.ts`, `scripts/e2e/overnight-runner.ts`
- `app/lib/sentry.ts`, `app/lib/jupiter.ts`
- `app/hooks/useChartData.ts`, `app/hooks/useCarnageEvents.ts`, `app/hooks/useChartSSE.ts`
- `app/app/api/sse/candles/route.ts`, `app/providers/SettingsProvider.tsx`

## Key Mechanisms

### 1. Crank Runner Error Loop (`scripts/crank/crank-runner.ts:197-316`)

The main loop wraps the entire epoch cycle in try/catch:

```typescript
while (!shutdownRequested) {
  try {
    // ... read state, check balances, advance epoch ...
  } catch (err) {
    const errStr = String(err).slice(0, 300);
    console.error(`[crank] ERROR cycle ${cycleCount}: ${errStr}`);
    if (!shutdownRequested) {
      await sleep(ERROR_RETRY_DELAY_MS); // 30s
    }
  }
}
```

**Analysis:**
- **Fail-open for availability**: Any error results in a 30s sleep then retry. This is correct for transient RPC errors but dangerous for persistent issues (wallet drained, program upgraded, key revoked).
- **No error classification**: All errors get the same treatment. A `0x1770` (on-chain constraint violation) and a network timeout both result in 30s retry.
- **Error truncation**: `String(err).slice(0, 300)` loses stack traces and Anchor program logs (`err.logs`). Diagnosis from Railway logs would be difficult.
- **No escalation**: After N consecutive failures, there is no alerting, no exponential backoff, no circuit breaker. The crank will retry forever at 30s intervals.

**Process-level handlers:**
- SIGINT/SIGTERM: Handled correctly (lines 81-89), sets `shutdownRequested` flag for graceful shutdown
- `unhandledRejection`: **MISSING** -- critical gap
- `uncaughtException`: **MISSING** -- critical gap
- The `main().catch()` at line 328 catches top-level errors and exits with code 1, but unhandled rejections from detached promises (e.g., inside dynamic imports at `vrf-flow.ts:299`) bypass this.

### 2. VRF Flow Error Handling (`scripts/vrf/lib/vrf-flow.ts`)

**`tryReveal` (lines 229-254):**
- Retries with exponential backoff (3s, 6s, 9s...)
- Returns `null` on failure instead of throwing -- caller decides recovery strategy
- Error messages truncated to 100 chars for logging

**`waitForSlotAdvance` (lines 159-195):**
- `while (true)` loop with no exit condition other than slot reaching target
- RPC errors caught and retried after 2s delay (line 190-193)
- **No max iteration or wall-clock timeout** -- if RPC returns but slot never advances, loops forever
- For long waits (>30 slots), sleeps most of the estimated time first then polls (RPC credit optimization)

**Stale VRF recovery (lines 388-535):**
- Detects `vrfPending=true` from previous failed runs
- Attempt 1: Try to reveal stale randomness (oracle may have responded late)
- On-chain reveal failure caught and falls through (lines 418-427) -- good pattern
- Attempt 2: Wait for VRF timeout (300 slots), create fresh randomness, retry
- Recovery path does NOT attempt atomic Carnage bundling (line 533) -- documented

**Dynamic imports (lines 299, 312):**
- `await import("../../e2e/lib/carnage-flow")` and `await import("../../e2e/lib/alt-helper")`
- These are inside `sendRevealAndConsume` which is called from both the happy path and recovery path
- If these imports fail (missing file, circular dependency), the error propagates up through the `sendRevealAndConsume` call, which is inside the main try/catch in the crank runner -- correctly handled

### 3. Transaction Confirmation (`app/lib/confirm-transaction.ts`)

**Polling design:**
- 2s poll interval, 90s max duration
- Checks both signature status AND block height expiry
- Returns `{ err: null }` on success, `{ err: <value> }` on on-chain failure
- Throws on timeout or block height exceeded

**Callers check `confirmation.err` correctly:**
- `multi-hop-builder.ts:397`: checks `confirmation.err` and returns failed status
- `useSwap.ts:761`: checks `confirmation.err` and sets failed state with parsed error

**Observation:** Each poll iteration makes TWO RPC calls: `getSignatureStatuses` + `getBlockHeight`. At 2s intervals over 90s max, that is up to 90 RPC calls per confirmation. Under high swap volume, this could contribute to rate limiting. The block height check is safety-critical (prevents waiting after blockhash expired) so removing it is not advisable, but it could be done less frequently (e.g., every 3rd iteration).

### 4. Swap Error Reporting (`app/lib/swap/error-map.ts`)

**Pattern analysis:**
- Maps Anchor error codes (6000-6017) from Tax and AMM programs to user-friendly messages
- Distinguishes Tax vs AMM errors by checking for AMM program ID in error string
- Falls back to the other error map if primary lookup misses
- Handles common Solana errors (blockhash expired, insufficient funds, user rejection)
- Final fallback: generic "Swap failed" message

**Security observation:** Error messages are safe -- no program IDs, account addresses, or internal state leaked to users. Internal errors (6006-6016) say "Please report this issue" which is appropriate.

### 5. Webhook Error Handling (`app/app/api/webhooks/helius/route.ts`)

**Error architecture:**
- Outer try/catch (lines 143-289): catches JSON parse failure or DB connection error, returns 500 (Helius retries)
- Per-transaction try/catch (lines 161-267): catches individual TX processing errors, logs and continues batch
- Per-candle try/catch (lines 210-242): candle upsert failure does not block swap event storage

**Authentication pattern:**
```typescript
const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
if (webhookSecret) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```

This is a **conditional fail-open**: if the env var is unset, auth is completely bypassed. The code comment says "allows local testing" but there is no mechanism to ensure it IS set in production. Note: the comparison is not timing-safe (`!==` instead of `crypto.timingSafeEqual`), though for a webhook secret this is lower risk than for session tokens since the secret is not user-facing.

### 6. Frontend Error Patterns

**useSwap (`app/hooks/useSwap.ts`):**
- State machine: idle -> building -> signing -> confirming -> confirmed/failed
- All errors set status to "failed" and call `parseSwapError()` for user display
- Outer catch at lines 777-781 and 870-873 catches any unexpected error
- Auto-reset timer after confirmed state (10s) -- cleanup on unmount

**useProtocolWallet (`app/hooks/useProtocolWallet.ts`):**
- Throws if no wallet connected (line 93) or wallet doesn't support signTransaction (lines 94-98)
- No catch block -- errors propagate to useSwap's catch handlers
- This is correct: the wallet abstraction should not swallow errors

**Sentry reporter (`app/lib/sentry.ts`):**
- Fire-and-forget pattern for error reporting
- fetch errors caught and swallowed (line 90-92)
- Outer catch swallows parsing errors (lines 93-95)
- **No timeout on the Sentry fetch call** (line 86) -- could theoretically hang, but since it's fire-and-forget, this only affects garbage collection

## Trust Model

| Boundary | Trust Level | Validation |
|----------|-------------|------------|
| RPC responses | High trust | No independent verification of slot numbers, balances, or account state |
| Helius webhook payloads | Conditional trust | Auth only when env var set |
| User wallet input | Low trust | Amounts validated via quoting engine; slippage enforced on-chain |
| Switchboard oracle | Medium trust | SDK handles oracle signature verification; timeout recovery on failure |
| External price APIs | Low trust | Response validation (type checks, isFinite), dual-provider fallback |

## State Analysis

**Module-level caches:**
- `multi-hop-builder.ts:261`: `cachedALT` -- never invalidated, persists for lifetime of browser tab
- `sol-price/route.ts:36-38`: `cachedPrice`/`cachedAt`/`cachedSource` -- 60s TTL, stale fallback if both providers fail

**React state machines:**
- `useSwap.ts`: SwapStatus state machine with proper terminal state handling (auto-reset, clearTerminalStatus)
- Timer refs cleaned up on unmount (lines 644-649)

## Dependencies (External APIs, Packages, Services)

| Dependency | Error Handling | Timeout |
|------------|----------------|---------|
| Solana RPC (Helius) | Catch + retry (crank), catch + user error (frontend) | None explicit (relies on connection defaults) |
| Switchboard SDK | tryReveal with exponential backoff | 10 attempts * 3-30s = up to 165s |
| CoinGecko API | catch returns null | 5s AbortSignal.timeout |
| Binance API | catch returns null | 5s AbortSignal.timeout |
| Sentry ingest | fire-and-forget, catch swallowed | None |
| Internal API routes (/api/sol-price, /api/candles) | catch returns null or empty array | None |

## Focus-Specific Analysis

### Empty/Silent Catch Blocks

The codebase has numerous `catch { }` blocks. Classification by criticality:

**Acceptable (non-critical, properly documented):**
- `overnight-runner.ts:252,412,421,433`: Balance/vault reads in E2E test runner. Comments explain "Non-critical" or "Escrow may not exist yet"
- `carnage-flow.ts:201,213,225,245,251`: Account existence checks in E2E test helper. Expected to fail when accounts don't exist
- `app/hooks/useChartSSE.ts:82`: Malformed SSE data. Comment: "don't crash the SSE connection"
- `app/hooks/useStaking.ts:270`: UserStake account not found = never staked. Sets state to null
- `app/providers/SettingsProvider.tsx:126`: Corrupted localStorage JSON. Falls back to defaults

**Concerning (could mask important failures):**
- `scripts/e2e/lib/swap-flow.ts:423,672`: Sets `minimumOutput = 1` on reserve read failure. In production swap paths this would result in accepting any slippage. However, this is in the E2E test helper, not the frontend swap path
- `app/lib/sentry.ts:93`: Silently swallows Sentry reporting errors. Acceptable for an error reporter, but means misconfigurations (wrong DSN) are invisible

### Fail-Open vs Fail-Closed Patterns

| Location | Pattern | Assessment |
|----------|---------|------------|
| Crank main loop | Fail-open (catch, wait 30s, retry) | Correct for availability-critical bot |
| Webhook auth | Fail-open (no secret = no auth) | Dangerous if secret not set in prod |
| Swap execution | Fail-closed (error -> "failed" state, no funds moved) | Correct |
| VRF recovery | Fail-closed (final throw if oracle unresponsive after retry) | Correct |
| SOL price API | Fail-open (returns stale cache, then 502) | Appropriate for display-only data |
| TX confirmation | Fail-closed (throws on timeout/expiry) | Correct |

### Missing Timeouts

| Location | Call | Timeout Present? |
|----------|------|-----------------|
| `app/lib/jupiter.ts:19` | `fetch("/api/sol-price")` | NO |
| `app/hooks/useChartData.ts:140` | `fetch(url)` to candles API | NO |
| `app/hooks/useCarnageEvents.ts:102` | `fetch("/api/carnage-events")` | NO |
| `app/lib/sentry.ts:86` | `fetch(ingestUrl)` | NO (fire-and-forget) |
| `app/app/api/sol-price/route.ts:45,63` | `fetch(COINGECKO_URL)`, `fetch(BINANCE_URL)` | YES (5s) |
| `vrf-flow.ts:182` | `waitForSlotAdvance` inner loop | NO (infinite loop) |

## Cross-Focus Intersections

### With SEC-01 (Secrets)
- `crank-runner.ts` error logging at line 303 truncates errors to 300 chars. If a keypair-related error occurs, could the error message include key bytes? The `loadCarnageWsolPubkey()` function at line 110 reads a secret key file. If this fails, the error from `Keypair.fromSecretKey()` should not contain key bytes (Solana SDK throws generic errors), but this should be verified.

### With CHAIN-01 (Transaction Construction)
- `multi-hop-builder.ts` uses `skipPreflight: true` for v0 transactions (line 381). All error detection relies on post-submission polling. If `pollTransactionConfirmation` has a bug, failed transactions could be reported as successful.

### With BOT-01/BOT-02 (Bot Operations)
- The crank runner's vault top-up at lines 225-241 transfers SOL on every cycle where vault is low. If the vault has a drain vulnerability (on-chain concern), the crank would continuously top it up. There is no per-cycle or per-day budget limit on top-ups.

### With LOGIC-01 (Financial Logic)
- `useSwap.ts` computes `totalFeePct` with mixed denomination sums (lines 409, 434-435, 504-505). While this is display-only (not used for on-chain calculations), incorrect fee display could mislead users about transaction costs.

## Cross-Reference Handoffs

- **SEC-01**: Verify that error messages from keypair operations never include raw key bytes
- **CHAIN-01**: Verify that `skipPreflight: true` combined with `pollTransactionConfirmation` never produces false-positive confirmation
- **BOT-01**: Assess crank runner SOL drain rate if vault has a persistent leak -- no budget cap on `VAULT_TOP_UP_LAMPORTS`
- **API-04**: Webhook auth bypass when `HELIUS_WEBHOOK_SECRET` is not set -- needs production deployment verification
- **INFRA-03**: Crank runner needs process-level crash handlers for Railway production deployment

## Risk Observations

### R-01: Crank Silent Crash (HIGH)
**Location:** `scripts/crank/crank-runner.ts` (entire file)
**Observation:** No `process.on("unhandledRejection")` or `process.on("uncaughtException")` handlers. The crank uses dynamic imports (`vrf-flow.ts:299,312`) and the Switchboard SDK which has complex async internals. An unhandled rejection from a detached promise chain would crash the Node.js process without the main try/catch catching it.
**Impact:** Crank stops, epoch advancement halts, protocol stalls. On Railway, the process restart policy may help, but the error would not be logged.
**Likelihood:** Possible -- dynamic imports + third-party SDK create async paths outside the main try/catch.

### R-02: VRF Slot Wait Infinite Loop (HIGH)
**Location:** `scripts/vrf/lib/vrf-flow.ts:182-194`
**Observation:** The `waitForSlotAdvance` function uses `while (true)` with no maximum iteration count or wall-clock timeout. If the RPC consistently returns the same slot number (stale data, network partition, or RPC misconfiguration), the loop runs forever, blocking the crank.
**Impact:** Crank permanently stuck, no epoch advancement.
**Likelihood:** Possible -- RPC staleness has been observed in Solana devnet.

### R-03: Webhook Data Injection (MEDIUM)
**Location:** `app/app/api/webhooks/helius/route.ts:135-141`
**Observation:** Authentication is conditional on `HELIUS_WEBHOOK_SECRET` being set. If production deployment omits this env var, the webhook accepts any POST payload. An attacker could inject fake swap events with arbitrary prices, which flow into candle aggregation and SSE broadcast.
**Impact:** Corrupted price charts for all connected users. Could be used to manipulate user trading decisions.
**Likelihood:** Unlikely (env var likely set in prod), but no runtime warning if missing.

### R-04: Client Fetch Without Timeout (MEDIUM)
**Location:** `app/lib/jupiter.ts:19`, `app/hooks/useChartData.ts:140`, `app/hooks/useCarnageEvents.ts:102`
**Observation:** Three client-side fetch calls lack `AbortSignal.timeout()`. If the API route hangs (e.g., database connection timeout on the server), these fetches wait indefinitely.
**Impact:** Loading spinners stuck forever, degraded UX.
**Likelihood:** Possible -- server-side stalls happen.

### R-05: ALT Cache Never Invalidates (MEDIUM)
**Location:** `app/lib/swap/multi-hop-builder.ts:261`
**Observation:** `cachedALT` is set once and never cleared. If the protocol's Address Lookup Table is extended (new addresses added) or replaced, all multi-hop swaps fail until the user refreshes the page.
**Impact:** Multi-hop swaps fail silently for users with stale cache.
**Likelihood:** Low in normal operation, but possible during protocol upgrades.

### R-06: Error Truncation in Crank (MEDIUM)
**Location:** `scripts/crank/crank-runner.ts:303`
**Observation:** `String(err).slice(0, 300)` loses critical diagnostic information. Anchor errors include `.logs` arrays with program-level debug messages. These are not logged.
**Impact:** Difficult incident diagnosis in production.
**Likelihood:** Probable -- errors will occur in production.

### R-07: No Exponential Backoff in Crank (LOW)
**Location:** `scripts/crank/crank-runner.ts:311-313`
**Observation:** Fixed 30s retry delay regardless of error type or count. RPC rate limiting, which returns 429 errors, would be hammered every 30s instead of backing off.
**Impact:** Possible RPC ban or credit exhaustion.
**Likelihood:** Low -- current 30s is relatively gentle.

### R-08: Confirmation Polling RPC Overhead (LOW)
**Location:** `app/lib/confirm-transaction.ts:38,53`
**Observation:** Two RPC calls per poll iteration (getSignatureStatuses + getBlockHeight). At 2s intervals, a 60s confirmation takes 60 RPC calls.
**Impact:** Could contribute to rate limiting under high swap volume. Not a direct security issue.
**Likelihood:** Low -- individual users don't swap frequently enough.

### R-09: Webhook Auth Not Timing-Safe (LOW)
**Location:** `app/app/api/webhooks/helius/route.ts:138`
**Observation:** Uses `!==` instead of `crypto.timingSafeEqual` for webhook secret comparison.
**Impact:** Theoretical timing side-channel to guess the webhook secret. Very low practical risk for webhook auth (not user-facing, not high-frequency).
**Likelihood:** Rare.

### R-10: Sentry Reporter Misconfig Invisible (LOW)
**Location:** `app/lib/sentry.ts:93`
**Observation:** If the Sentry DSN is malformed, the outer catch silently swallows the parsing error. All subsequent `captureException` calls silently fail.
**Impact:** Error monitoring appears to work but no errors reach Sentry.
**Likelihood:** Low -- DSN is typically validated during setup.

## Novel Attack Surface Observations

1. **Candle data poisoning via unauthenticated webhook**: If `HELIUS_WEBHOOK_SECRET` is not set, an attacker can inject fabricated swap events. The `onConflictDoNothing` idempotency guard only prevents duplicate TX signatures -- fabricated TXs with unique signatures pass through. Injected events flow through `upsertCandlesForSwap` into the candle database and are broadcast via SSE to all chart clients. This would allow real-time manipulation of displayed prices across all connected users.

2. **Crank SOL drain via persistent vault leak**: The crank automatically tops up the Carnage SOL vault when it drops below ~2M lamports (lines 225-241). If an on-chain vulnerability drains the vault, the crank would continuously transfer 0.005 SOL per cycle (every ~5 minutes), slowly draining the crank wallet. There is no budget limit or anomaly detection on this top-up behavior.

## Questions for Other Focus Areas

- **SEC-01**: Is `HELIUS_WEBHOOK_SECRET` guaranteed to be set in the Railway production deployment? What is the deployment checklist?
- **CHAIN-01**: Does the 90-second confirmation timeout in `pollTransactionConfirmation` align with Solana's actual blockhash lifetime? Could a transaction be confirmed after our timeout?
- **BOT-01**: Should the crank runner have a maximum SOL-per-day budget for vault top-ups to prevent drain attacks?
- **INFRA-03**: Is Railway configured to auto-restart the crank process on crash? What is the restart delay?

## Raw Notes

- `scripts/deploy/verify.ts:653`: Has proper `main().catch()` with `process.exit(1)`. Also logs `err.logs` if present (Anchor program logs). Better error handling than the crank runner.
- `scripts/vrf/devnet-vrf-validation.ts:252-265`: Epoch transition failures call `process.exit(1)` -- appropriate for a validation script, not for a production bot.
- `scripts/e2e/overnight-runner.ts:559-594`: Fatal error handler writes a crash record to JSONL before exiting. Good pattern for crash forensics. The crank runner could benefit from similar crash logging.
- `app/hooks/useProtocolWallet.ts:110`: `sendOptions.skipPreflight` could be undefined. The spread `const { signers: _signers, ...sendOptions } = opts ?? {};` preserves undefined values, which is fine for `sendRawTransaction` defaults.
- The `parseSwapError` function at `error-map.ts:184` matches `/rejected/i` which would match any error containing "rejected" (e.g., "Transaction rejected by validator"). This could incorrectly classify validator rejections as user cancellations. However, the user would still see a "cancelled" message which is a reasonable UX even for validator rejections.
