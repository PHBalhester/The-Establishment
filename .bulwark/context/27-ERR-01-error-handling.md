---
task_id: db-phase1-err-01
provides: [err-01-findings, err-01-invariants]
focus_area: err-01
files_analyzed: [app/lib/ws-subscriber.ts, app/hooks/useCurveState.ts, app/hooks/useEpochState.ts, app/app/api/sse/protocol/route.ts, app/app/api/health/route.ts, app/instrumentation.ts, app/app/api/webhooks/helius/route.ts, app/hooks/useProtocolState.ts, app/app/api/rpc/route.ts, app/lib/protocol-store.ts, app/lib/sse-manager.ts, app/lib/connection.ts, app/lib/swap/error-map.ts, app/lib/credit-counter.ts, app/lib/sentry.ts, app/lib/sse-connections.ts, app/lib/rate-limit.ts, app/app/api/sol-price/route.ts, app/hooks/useSwap.ts, app/hooks/useStaking.ts, app/components/station/SwapStation.tsx, app/hooks/useChartSSE.ts, app/lib/event-parser.ts]
finding_count: 14
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 7}
---
<!-- CONDENSED_SUMMARY_START -->
# Error Handling & Fail Modes -- Condensed Summary

## Key Findings (Top 10)

1. **batchSeed unprotected RPC calls abort entire server init**: Token supply, getSlot, and gPA calls in `batchSeed()` have NO try/catch -- a single RPC failure throws up to `init()` which is caught by instrumentation.ts, leaving protocolStore completely empty (not partially seeded). -- `app/lib/ws-subscriber.ts:168-207`

2. **RPC proxy fetch has no timeout**: The `fetch()` call to upstream Helius in the RPC proxy route has no `AbortSignal.timeout()`. A hanging upstream will hold the request open indefinitely, exhausting Next.js worker threads. -- `app/app/api/rpc/route.ts:144-148`

3. **No unhandledRejection/uncaughtException handlers in the Next.js server process**: The application has no process-level error handlers. The only `process.on` handlers are in `scripts/crank/crank-runner.ts` (SIGINT/SIGTERM) and `scripts/e2e/overnight-runner.ts`. An unhandled promise rejection in any server-side code could crash the Railway container. -- Project-wide observation

4. **ws-subscriber setInterval callbacks lack Sentry reporting**: All four poll error handlers (slot fallback, supply poll, staker poll, staleness monitor) only `console.error` -- none call `captureException()`. Silent failures in the data pipeline are invisible to monitoring. -- `app/lib/ws-subscriber.ts:289,354,424`

5. **SwapStation sol-price fetch swallows all errors silently**: `.catch(() => {})` discards errors without any logging. If the sol-price API is broken, MCAP display will silently show undefined with no diagnostic trail. -- `app/components/station/SwapStation.tsx:104`

6. **sse-manager broadcast modifies subscriber Set during iteration**: When a subscriber throws, `this.subscribers.delete(callback)` is called inside a `for...of` loop over the same Set. This is technically safe in ES2015+ (Set iteration handles concurrent deletion) but is fragile -- any future refactor to Array could introduce skipped subscribers. -- `app/lib/sse-manager.ts:62-69`

7. **Empty catch blocks in ws-subscriber staker decode**: Both `batchSeed` and `pollStakers` have `catch { }` blocks with comment "Skip malformed accounts" but no logging. If the staking IDL changes or decode regresses, all staker accounts silently fail with zero error trail. -- `app/lib/ws-subscriber.ts:230,414`

8. **useProtocolState ignores malformed SSE data silently**: Both `initial-state` and `protocol-update` event handlers wrap `JSON.parse` in try/catch with empty catch blocks. A serialization bug in the SSE pipeline would produce invisible data loss on all connected clients. -- `app/hooks/useProtocolState.ts:260,278`

9. **Webhook content-length check is bypassable**: The body size guard at line 310 only checks the `Content-Length` header, which can be omitted or spoofed. The actual body (`req.json()`) is read without size enforcement. -- `app/app/api/webhooks/helius/route.ts:309-315`

10. **Client-side fetch calls lack timeouts**: `fetchPriorityFee` (`SettingsProvider.tsx:125`), `useCarnageEvents` (`useCarnageEvents.ts:102`), `fetchSolPrice` (`jupiter.ts:19`) -- all use `await fetch()` with no `AbortSignal.timeout()`. A hanging API route will block the React component indefinitely. -- Multiple hooks

## Critical Mechanisms

- **Instrumentation boot sequence**: `instrumentation.ts:register()` wraps `ws-subscriber.init()` in try/catch. A failure means the server runs degraded (SSE clients get partial state from webhooks only, no batch-seeded data). This is CORRECT fail-degraded behavior. -- `app/instrumentation.ts:17-28`

- **Webhook fail-closed auth**: In production, missing `HELIUS_WEBHOOK_SECRET` returns 500 (rejects all requests). This is a textbook fail-closed pattern (SP-028). When secret IS set, timing-safe comparison with length-leak protection is implemented correctly. -- `app/app/api/webhooks/helius/route.ts:273-301`

- **SSE connection lifecycle**: Triple-release protection: abort signal handler + stream cancel callback + 30-min auto-release timer. The `released` boolean prevents double-release of connection slots. Clean pattern. -- `app/app/api/sse/protocol/route.ts:55-62,110-124`

- **RPC proxy failover**: Iterates through ordered endpoints (sticky routing to last-successful). HTTP 5xx from upstream triggers next endpoint. Network errors (DNS, timeout) also trigger next. All endpoints fail -> 502 with Sentry capture. HOWEVER: no per-fetch timeout means the failover loop can hang on a single slow endpoint. -- `app/app/api/rpc/route.ts:142-187`

- **Staleness monitor + fallback poll**: Detects WS subscription death after 15s of silence. Activates HTTP slot polling at 5s intervals. Deactivates fallback when WS recovers. Correct resilience pattern. -- `app/lib/ws-subscriber.ts:299-323`

- **SSE reconnect with exponential backoff**: Browser-side `useProtocolState` implements 1s-30s exponential backoff on SSE errors, with 30s downtime threshold triggering RPC polling fallback. Visibility-aware pause/resume prevents background tab waste. -- `app/hooks/useProtocolState.ts:285-306`

## Invariants & Assumptions

- INVARIANT: Webhook auth is fail-closed in production (missing secret = reject all) -- enforced at `app/app/api/webhooks/helius/route.ts:273-284`
- INVARIANT: SSE connections are bounded (10/IP, 5000 global) -- enforced at `app/lib/sse-connections.ts:49-56`
- INVARIANT: Rate limiting exists on all public API endpoints -- enforced at each route handler (webhook:120/min, rpc:300/min, sol-price:30/min)
- INVARIANT: Per-transaction webhook errors do not crash the batch -- enforced at `app/app/api/webhooks/helius/route.ts:475-485`
- INVARIANT: Candle upsert failures do not prevent swap event storage -- enforced at `app/app/api/webhooks/helius/route.ts:451-458`
- ASSUMPTION: batchSeed completes successfully on server boot -- PARTIALLY UNVALIDATED (individual account decode errors handled, but RPC-level failures in token supply/slot/gPA fetch are NOT caught, causing total init failure)
- ASSUMPTION: Helius RPC responds within reasonable time -- UNVALIDATED (no timeout on RPC proxy fetch, no timeout on ws-subscriber RPC calls via @solana/web3.js Connection)
- ASSUMPTION: Next.js handles uncaught async exceptions gracefully -- UNVALIDATED (no process-level handlers, relies on Next.js internal error handling which varies by version)
- ASSUMPTION: sse-manager Set iteration is safe during concurrent deletion -- Validated by ES2015+ spec, but fragile to refactoring

## Risk Observations (Prioritized)

1. **batchSeed partial failure mode** (HIGH): If `getTokenSupply`, `getSlot`, or `getProgramAccounts` fails in `batchSeed()`, the entire init throws. The try/catch in `instrumentation.ts` catches it, but ALL previously-seeded account data (which DID succeed) is lost because `protocolStore` was populated via `setAccountStateQuiet` calls BEFORE the failing call. The data IS retained in memory. However, the `state.initialized` flag is never set to `true`, and subsequent calls to `init()` will try again. The real risk: if RPC is intermittently failing, init may succeed on account fetch but fail on supply fetch, leaving supply/slot/staker data empty until the next poll cycle (60s/30s/5s respectively). `app/lib/ws-subscriber.ts:168-207`

2. **RPC proxy hang** (HIGH): No fetch timeout in the RPC proxy. A slow/hanging Helius endpoint will hold the request open. With 300 req/min rate limit and Next.js default worker pool, 10+ concurrent hanging requests could exhaust all workers, causing a cascade failure across all API routes (health check, SSE, webhook, etc.). `app/app/api/rpc/route.ts:144`

3. **Silent ws-subscriber poll failures** (MEDIUM): Supply poll, staker poll, and slot fallback poll all catch errors with `console.error` only. No Sentry reporting means production failures are invisible unless someone monitors Railway logs. A sustained RPC outage would produce thousands of console errors with no alerting. `app/lib/ws-subscriber.ts:289,354,424`

4. **Missing process-level error handlers** (MEDIUM): No `process.on("unhandledRejection")` or `process.on("uncaughtException")` in the Next.js application. An unhandled rejection in any async code path (e.g., a forgotten await in a newly added feature) could crash the process silently. Railway may restart the container, but the error would be unlogged. Project-wide.

5. **Client fetch calls without timeouts** (MEDIUM): Multiple browser-side `fetch()` calls (to /api/rpc, /api/sol-price, /api/carnage-events) have no `AbortSignal.timeout()`. If the server is slow, React components will hang in loading state indefinitely. This is a UX/availability issue, not a security vulnerability per se. Multiple files.

6. **Webhook body size check header-only** (MEDIUM): `Content-Length` header check at line 310 is advisory -- it can be omitted by the sender, or the sender can stream a large body with a small declared Content-Length. The real body is parsed by `req.json()` without size enforcement. Next.js has its own body size limits (~4MB default), so this is partially mitigated. `app/app/api/webhooks/helius/route.ts:309-315`

7. **Empty catch swallowing SSE parse errors** (MEDIUM): `useProtocolState` silently ignores malformed SSE data. If the server sends corrupted JSON (e.g., BigInt serialization bug), all clients would silently stop receiving updates with no error indicator. `app/hooks/useProtocolState.ts:260,278`

## Novel Attack Surface

- **RPC proxy as amplified DoS vector**: An attacker can send 300 requests/minute to `/api/rpc`, each targeting a method like `getProgramAccounts` with broad filters. Since there's no per-fetch timeout, each request could hang for minutes, exhausting the Node.js event loop. The rate limiter counts requests at arrival, not at completion -- so 300 concurrent hanging requests are all "allowed." Combined with the method allowlist including `getProgramAccounts` (which can be expensive), this creates an asymmetric amplification where a small number of crafted requests can degrade the entire application.

- **Stale state injection via batchSeed race**: If `batchSeed` partially completes (accounts seeded, supply fetch fails), clients receive SSE initial-state with account data but no supply data. When supply poll starts 60s later, there's a window where clients display incorrect MCAP (supply=undefined -> NaN or 0 in calculations).

## Cross-Focus Handoffs

- -> **ERR-02 (Race Conditions)**: The `sse-manager.ts` broadcast loop modifies the subscriber Set during iteration. Investigate if concurrent broadcasts from webhook + ws-subscriber could create race conditions. Also: `protocolStore.setAccountState` and `setAccountStateQuiet` have no synchronization -- concurrent webhook + ws-subscriber writes could interleave.
- -> **API-01 (REST API)**: RPC proxy missing fetch timeout is also an API availability concern. The `/api/health` always returns 200 (even when degraded) which masks failures from monitoring that checks HTTP status codes.
- -> **INFRA-03 (Infrastructure)**: No process-level error handlers is an infrastructure resilience concern. Railway health check only sees HTTP 200 from `/api/health`, it cannot detect internal data pipeline failures.
- -> **DATA-04 (Logging)**: ws-subscriber poll errors log to console.error without Sentry. Health endpoint exposes internal state (wsSubscriber status, credit stats) -- overlap with H028 finding.

## Trust Boundaries

The error handling trust model centers on three boundaries: (1) External services (Helius RPC, CoinGecko, Binance) -- treated as unreliable with fallback chains and catch blocks, but lacking timeouts which undermines the resilience. (2) Helius webhook payloads -- treated as untrusted with auth verification, body size limits, and per-transaction error isolation, though body size enforcement is header-only. (3) Browser SSE clients -- treated as potentially malicious with connection caps and rate limits, and disconnection handling is robust with triple-release protection. The weakest boundary is between the application and external RPC services where hanging connections can cascade into total service degradation.
<!-- CONDENSED_SUMMARY_END -->

---

# Error Handling & Fail Modes -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase demonstrates a generally mature approach to error handling, with several well-implemented patterns (fail-closed webhook auth, SSE connection lifecycle management, exponential backoff reconnection, staleness detection with fallback polling). The codebase was clearly developed with security awareness -- many error handling patterns directly reference specific finding IDs (H001, H008, H024, H047, H049, H050) from a previous audit.

However, the analysis reveals two HIGH-severity observations, five MEDIUM observations, and seven LOW observations centered around three themes: (1) missing timeouts on network calls creating hang/DoS vectors, (2) silent error swallowing in the data pipeline preventing operational visibility, and (3) missing process-level safety nets for unhandled exceptions.

## Scope

**In scope (23 files):**
- Server-side data pipeline: `ws-subscriber.ts`, `protocol-store.ts`, `sse-manager.ts`, `credit-counter.ts`
- API routes: `webhooks/helius/route.ts`, `sse/protocol/route.ts`, `health/route.ts`, `rpc/route.ts`, `sol-price/route.ts`
- Client hooks: `useProtocolState.ts`, `useCurveState.ts`, `useEpochState.ts`, `useSwap.ts`, `useStaking.ts`
- Infrastructure: `instrumentation.ts`, `connection.ts`, `sse-connections.ts`, `rate-limit.ts`, `sentry.ts`
- Error utilities: `swap/error-map.ts`
- Components: `SwapStation.tsx`, `useChartSSE.ts`
- Shared: `event-parser.ts`

**Out of scope:** Anchor/Rust on-chain programs (programs/). Run SOS for on-chain audit.

## Key Mechanisms

### 1. Server Boot Error Handling (instrumentation.ts -> ws-subscriber.ts)

The server boot sequence is:

```
Next.js process start
  -> instrumentation.ts register()
    -> Edge runtime guard (return early)
    -> window guard (return early)
    -> dynamic import ws-subscriber
    -> await init()
      -> batchSeed(connection)       <-- Can throw on RPC failure
      -> startSlotSubscription()     <-- Cannot throw (no async)
      -> startSupplyPoll()           <-- Cannot throw (setInterval)
      -> startStakerPoll()           <-- Cannot throw (setInterval)
      -> startStalenessMonitor()     <-- Cannot throw (setInterval)
      -> state.initialized = true
```

**Analysis:**

The `register()` function wraps `init()` in try/catch -- this is correct. If init fails, the server continues degraded. The risk comment "Risk 3 mitigation" at line 24 shows this was intentionally designed.

However, within `batchSeed()`:
- Lines 115: `getMultipleAccountsInfo` -- unprotected, throws on RPC failure
- Lines 168-171: `Promise.all([getTokenSupply(CRIME), getTokenSupply(FRAUD)])` -- unprotected
- Line 187: `getSlot()` -- unprotected
- Lines 195-207: `getProgramAccounts()` -- unprotected

If any of these RPC calls fail, the entire `batchSeed` throws. The individual account decode loop (lines 127-164) IS protected with per-account try/catch, but the RPC-level calls are not. This means:

- If `getMultipleAccountsInfo` fails: zero accounts seeded, init fails, server starts degraded
- If token supply fetch fails: accounts ARE seeded (already written), but supply/slot/staker data missing
- If `getSlot` fails: accounts + supply seeded, but slot/staker data missing

In all failure cases, `state.initialized` is never set to `true`, so subsequent `init()` calls will retry (good). But the seeded-but-not-completed state means clients get partial data from the initial SSE snapshot.

**Recommendation:** Wrap the four post-decode RPC sections in individual try/catch blocks so partial seeding is preserved. Log + captureException on each failure.

### 2. Webhook Error Handling (webhooks/helius/route.ts)

The webhook handler has a well-structured error hierarchy:

```
POST handler
  -> Rate limit check (early return 429)
  -> Auth check (early return 401/500)
  -> Body size check (early return 413)     <-- Header-only check (weakness)
  -> JSON parse (early return 400)
  -> Array validation (early return 400)
  -> Payload type detection
  -> Per-transaction loop:
      try {
        -> Parse swap/epoch/carnage events
        -> Store in Postgres (onConflictDoNothing)
        -> Candle upsert (inner try/catch -- failure doesn't block swap storage)
      } catch {
        -> Log + captureException, continue loop
      }
  -> Return 200 with counts

  Outer catch:
    -> Return 500 (triggers Helius retry)
```

**Observations:**

1. **Fail-closed auth**: Lines 273-284 implement the correct production fail-closed pattern. Missing secret in production = 500.

2. **Timing-safe comparison**: Lines 293-300 handle the length-mismatch case correctly (compare secret against itself to avoid leaking length info).

3. **Per-transaction isolation**: Lines 363-485 process each transaction independently. One bad transaction doesn't crash the batch.

4. **Candle isolation**: Lines 426-458 wrap candle upsert in its own try/catch. Candle failure logs + Sentry but doesn't affect swap event storage.

5. **Body size weakness**: Line 309-315 only checks `Content-Length` header. This is bypassable (omit header, or lie). However, Next.js has internal limits (~4MB default for body parsing), so this is defense-in-depth, not the only gate.

6. **Enhanced account change handler**: Lines 525-633 handle decode failures gracefully -- stores raw data with `decodeError` flag so no data is lost. This is good observability.

### 3. SSE Connection Lifecycle (sse/protocol/route.ts + sse-connections.ts)

**Connection acquisition:**
```
GET /api/sse/protocol
  -> acquireConnection(ip)    <-- Returns false if cap hit (429)
  -> scheduleAutoRelease(ip)  <-- 30-min safety timeout
  -> Create ReadableStream
    -> Send initial-state snapshot
    -> Subscribe to sse-manager
    -> Start 15s heartbeat
    -> On abort signal: cleanup all
    -> On stream cancel: release()
```

**Analysis:**

Triple-release protection via `released` boolean (line 55-62) prevents connection slot leak from double-release. This is important because both the abort signal handler AND the cancel callback could fire.

The heartbeat and subscriber enqueue operations both use empty catch blocks (lines 88, 102, 116). These are CORRECT -- the only reason they'd throw is if the ReadableStream controller is already closed (client disconnected). Logging would just spam.

Auto-release after 30 minutes (via `scheduleAutoRelease`) prevents zombie connections from clients that crash without sending FIN. The `timeout.unref()` call at line 96 prevents the timeout from keeping Node.js alive during shutdown.

### 4. SSE Manager Broadcast (sse-manager.ts)

The broadcast loop (lines 62-69) iterates over a `Set<SSECallback>` and deletes erroring subscribers during iteration. This is safe per ES2015+ spec -- `Set.prototype.delete()` during `for...of` iteration is explicitly supported. However, this is a subtle invariant that could break if someone refactors to Array.

The broadcast is synchronous -- it calls each subscriber callback in sequence. If one subscriber's `controller.enqueue()` is slow (shouldn't be, but worth noting), it delays delivery to all subsequent subscribers. For the current scale (single process, <5000 connections), this is acceptable.

### 5. RPC Proxy Failover (rpc/route.ts)

The failover implementation has good structure but a critical gap:

**Good:**
- Method allowlist (lines 31-59) prevents abuse of arbitrary RPC methods
- Sticky routing (line 135-137) avoids unnecessary failover attempts
- HTTP 5xx triggers next endpoint (line 152-157)
- Network errors trigger next endpoint (line 172-178)
- All-fail produces 502 with Sentry capture (line 183)
- Error responses mask endpoint URLs to prevent API key leakage (line 72-78)

**Gap:** No `AbortSignal.timeout()` on the `fetch()` at line 144. If Helius is experiencing network issues that cause TCP connections to hang (not timeout, not error -- just hang), the request will block indefinitely. The failover loop will never reach the next endpoint because the current fetch never completes.

The `@solana/web3.js` Connection object used in ws-subscriber also has no configurable timeout on its HTTP calls. This is a framework-level limitation.

### 6. Client-Side Error Recovery (useProtocolState.ts)

The hook implements a multi-layer resilience strategy:

1. **SSE primary**: EventSource with auto-reconnect (exponential backoff 1s-30s)
2. **Polling fallback**: Activated after 30s of SSE downtime (60s interval RPC polling)
3. **Visibility gating**: Pauses SSE when tab hidden, resumes when visible
4. **Periodic downtime check**: Every 10s, checks if polling fallback should activate

**Observations:**

- `reconnectAttemptsRef` is reset to 0 on successful data receipt (line 256) -- correct
- `stopPolling()` is called on successful SSE data -- prevents polling + SSE race
- `mountedRef` guard prevents state updates after unmount -- correct React pattern
- Empty catch blocks on `JSON.parse` (lines 260, 278) -- these SHOULD at minimum log a warning because a serialization bug would be completely invisible

### 7. Sentry Error Reporting (sentry.ts)

The zero-dependency Sentry client is well-implemented:

- Fire-and-forget pattern (line 225) -- never blocks the application
- Double-catch: inner `catch` on fetch + outer `catch` on serialization (lines 229, 232)
- Both catch blocks are empty -- correct for an error reporter (cannot fail)
- DSN validation (line 146) -- no-ops silently when DSN not configured
- Breadcrumb ring buffer (20 entries) -- provides context without unbounded growth

**One concern:** Stack frame extraction (line 183-184) uses naive string splitting. Malformed stack traces could produce misleading frames, but this is not a security issue.

## Trust Model

| Boundary | Trust Level | Error Handling |
|----------|-------------|----------------|
| Helius RPC responses | Untrusted data, trusted availability | Decode errors caught per-account; RPC availability NOT timeout-protected |
| Helius webhook payloads | Untrusted (auth-gated in prod) | Fail-closed auth, per-TX isolation, body size check (header-only) |
| Browser SSE clients | Untrusted | Connection caps, rate limits, triple-release lifecycle |
| CoinGecko/Binance APIs | Untrusted | 5s timeout, fallback chain, stale cache |
| @solana/web3.js Connection | Trusted library | No timeout configuration available; relies on underlying transport |
| Anchor IDL coder | Trusted library | Decode errors caught but may produce corrupted data silently |

## State Analysis

### In-Memory State (No Persistence)

| State | Location | Failure Mode |
|-------|----------|-------------|
| Protocol account cache | `protocol-store.ts` Map | Lost on process restart; re-seeded by batchSeed + webhooks |
| SSE subscriber set | `sse-manager.ts` Set | Lost on restart; clients reconnect via EventSource |
| Connection slot counters | `sse-connections.ts` Map | Lost on restart; resets to 0 (safe -- clients reconnect) |
| Rate limit windows | `rate-limit.ts` Map | Lost on restart; resets (brief window of no rate limiting) |
| RPC credit counts | `credit-counter.ts` counters | Lost on restart; informational only |
| WS subscriber state | `ws-subscriber.ts` globalThis | Lost on restart; re-initialized by instrumentation.ts |

All in-memory state is designed to be reconstructible after restart. The brief window after restart where rate limits are reset could be exploited to send a burst of requests, but Railway's container restart time (~10s) limits this window.

### Persistent State (Postgres)

| State | Table | Error Handling |
|-------|-------|----------------|
| Swap events | `swap_events` | onConflictDoNothing -- idempotent |
| Epoch events | `epoch_events` | onConflictDoNothing -- idempotent |
| Carnage events | `carnage_events` | onConflictDoNothing -- idempotent |
| Candle OHLCV | `candles` | Upsert with composite key -- idempotent |

Database error handling: DB failures in the webhook handler are caught by the outer try/catch (line 499) which returns 500, triggering Helius retry. This is correct -- Helius has exponential backoff with a 24h retry window.

## Dependencies

| Dependency | Error Handling | Timeout |
|------------|---------------|---------|
| Helius RPC (HTTP) | Catch + fallback chain | **NONE** |
| Helius RPC (WebSocket) | Staleness monitor + fallback poll | Implicit (15s staleness threshold) |
| Helius Webhook (inbound) | Fail-closed auth + error isolation | N/A (inbound) |
| CoinGecko API | Catch + return null | 5s AbortSignal.timeout |
| Binance API | Catch + return null | 5s AbortSignal.timeout |
| PostgreSQL | Catch + Sentry | Connection pool defaults (no explicit timeout) |
| Sentry ingest | Fire-and-forget + catch | No timeout (acceptable -- fire-and-forget) |

## Focus-Specific Analysis

### Pattern: Empty Catch Blocks (AIP-139)

Found 30 empty or comment-only catch blocks across the codebase. Categorized by severity:

**Intentionally empty (SAFE):**
- SSE enqueue catches (sse/protocol/route.ts:88,102,116; sse/candles/route.ts:74,88,102) -- only throw when controller is closed
- Audio play catches (audio-manager.ts:329,418,459) -- autoplay policy, non-critical
- Sentry fetch catch (sentry.ts:229) -- error reporter must not throw
- Sentry serialization catch (sentry.ts:232) -- error reporter must not throw
- connection.ts:71 -- URL parse fallback for WS endpoint
- Settings localStorage catches (SettingsProvider.tsx:153,219) -- read/write localStorage

**Potentially problematic (NEEDS ATTENTION):**
- ws-subscriber.ts:230,414 -- staker decode silently skipped (should log at minimum)
- useProtocolState.ts:260,278 -- SSE data parse errors invisible to debugging
- SwapStation.tsx:104 -- sol-price fetch failure completely invisible
- useChartSSE.ts:82 -- candle update parse error invisible

**Acceptable with comment:**
- webhooks/helius/route.ts:322 -- JSON parse failure returns 400 (correct)
- useStaking.ts:299 -- cancelled transaction (correct pattern)
- rpc/route.ts:75,95 -- URL parse and JSON parse return error responses

### Pattern: Fail-Open vs Fail-Closed (AIP-140)

**Fail-closed (CORRECT):**
- Webhook auth in production: missing secret = 500 (reject all)
- SSE connection cap: exceeded = 429
- Rate limit exceeded: 429
- RPC method not in allowlist: 400
- All RPC endpoints fail: 502

**Fail-degraded (CORRECT by design):**
- ws-subscriber init failure: server continues without batch-seeded data
- SSE disconnection: client reconnects with backoff + polling fallback
- Supply/staker poll errors: next poll attempt in 60s/30s

**Fail-open (CONCERNING):**
- None found in security-critical paths. The codebase consistently fails closed for auth-related operations.

### Pattern: Missing Timeouts (AIP-141)

| Call Site | Has Timeout | Risk |
|-----------|-------------|------|
| sol-price/route.ts fetchFromCoinGecko | YES (5s) | None |
| sol-price/route.ts fetchFromBinance | YES (5s) | None |
| rpc/route.ts upstream fetch | **NO** | HIGH -- can hang indefinitely |
| jupiter.ts fetchSolPrice (browser) | **NO** | LOW -- hits local /api/sol-price |
| SettingsProvider.tsx fetchPriorityFee | **NO** | LOW -- hits local /api/rpc |
| useCarnageEvents.ts fetch | **NO** | LOW -- hits local /api/carnage-events |
| ws-subscriber.ts all Connection calls | **NO** (library) | MEDIUM -- @solana/web3.js limitation |

### Pattern: Process-Level Handlers (AIP-148)

The Next.js application has **NO** `process.on("unhandledRejection")` or `process.on("uncaughtException")` handlers. The only process-level handlers are:

- `scripts/crank/crank-runner.ts:196-204` -- SIGINT/SIGTERM (graceful shutdown)
- `scripts/e2e/overnight-runner.ts:125-132` -- SIGINT/SIGTERM (graceful shutdown)
- `.next/build/chunks/...` -- Next.js internal uncaughtException handler (line 342 in build output)

The Next.js internal handler (from the build output) exists but only for the specific chunk execution context. Route-level async errors in App Router are handled by Next.js per-request error boundaries, which return 500 to the client. However, non-route async operations (like setInterval callbacks in ws-subscriber or sse-manager) that throw unhandled rejections have no safety net.

### Pattern: Error Recovery Paths

| Component | Recovery Mechanism | Gap |
|-----------|--------------------|-----|
| SSE (browser) | Exponential backoff reconnect | None -- well-implemented |
| SSE (server) | Client disconnect cleanup | None -- triple-release |
| Webhook | Helius retry on 500 | None -- correct |
| RPC proxy | Multi-endpoint failover | No timeout on individual fetch |
| WS subscription | Staleness monitor + fallback | No reconnect logic for WS itself (relies on @solana/web3.js) |
| Supply/staker poll | setInterval auto-retry | No Sentry reporting |
| batchSeed | instrumentation.ts retry on next deploy | No partial recovery |

## Cross-Focus Intersections

1. **ERR-01 x API-01**: The RPC proxy timeout issue is both an error handling gap and an API availability issue.
2. **ERR-01 x CHAIN-01**: The ws-subscriber's reliance on @solana/web3.js Connection without timeout config is a chain interaction concern.
3. **ERR-01 x DATA-04**: Multiple console.error calls without Sentry reporting create a logging disclosure gap (important errors only visible in Railway logs, not in Sentry dashboard).
4. **ERR-01 x INFRA-03**: Missing process-level handlers + health check always returning 200 = infrastructure monitoring blindspot.

## Cross-Reference Handoffs

| Target Agent | Item | Priority |
|-------------|------|----------|
| ERR-02 (Race Conditions) | sse-manager Set modification during iteration; concurrent protocolStore writes from webhook + ws-subscriber | MEDIUM |
| API-01 (REST API) | RPC proxy missing fetch timeout; health check always 200 masking degraded state | HIGH |
| INFRA-03 (Infrastructure) | No process-level error handlers; rate limit state lost on restart | MEDIUM |
| DATA-04 (Logging) | ws-subscriber poll errors not in Sentry; health endpoint leaking internal state | MEDIUM |
| CHAIN-02 (RPC Trust) | @solana/web3.js Connection has no configurable HTTP timeout | MEDIUM |

## Risk Observations

### HIGH

1. **batchSeed unprotected RPC calls**: The four sequential RPC calls after the account decode loop (getTokenSupply x2, getSlot, getProgramAccounts) have no try/catch. A single failure aborts the entire batch seed. Given that this runs at server boot (when RPC may be cold/slow), this is a likely failure mode that would leave the protocol store partially seeded.

2. **RPC proxy missing fetch timeout**: An attacker or failing upstream can hold all Next.js worker threads busy by sending requests to `/api/rpc` that trigger hanging upstream fetches. This is amplified by the 300 req/min rate limit being checked on request arrival (not completion).

### MEDIUM

3. **Silent ws-subscriber poll failures**: Errors in poll callbacks go to console.error only. No Sentry. Production monitoring requires Railway log access, which may not be watched continuously.

4. **Missing process-level error handlers**: No unhandledRejection handler. An unhandled promise rejection in any server-side async code could crash the process.

5. **Client fetch calls without timeouts**: Multiple browser-side fetches can hang indefinitely if the server is slow.

6. **Webhook body size header-only**: The Content-Length check is advisory. Mitigated by Next.js internal limits but not ideal defense-in-depth.

7. **Silent SSE parse errors**: Malformed SSE data is silently discarded by `useProtocolState`, making serialization bugs invisible.

### LOW

8. **SwapStation sol-price silent catch**: `.catch(() => {})` on sol-price fetch.
9. **Empty catch in staker decode**: Two locations silently skip malformed staker accounts.
10. **Credit counter unbounded growth**: `methodCounts` record grows indefinitely (one entry per unique RPC method). Bounded by the small set of allowed methods (~20), so practical risk is negligible.
11. **Rate limit state lost on restart**: Brief window of no rate limiting after container restart.
12. **Health check always 200**: H085 (ACCEPTED_RISK from Audit #1) -- masks degraded state from HTTP status code monitoring.
13. **parseSwapError generic fallback**: The final fallback message "Swap failed. Please try again..." may not give users enough info to diagnose issues, but security-wise this is correct (generic errors prevent info leakage).
14. **Sentry stack frame parsing**: Naive string splitting on `\n` could produce misleading frames from minified/bundled code.

## Novel Attack Surface Observations

1. **RPC proxy worker exhaustion**: An attacker sends 300 requests/minute to `/api/rpc` with method `getProgramAccounts` and a broad filter. Each request triggers a fetch to Helius with no timeout. If Helius is slow (e.g., due to the expensive gPA query), these requests accumulate in the Node.js event loop. After enough requests accumulate, the Next.js process cannot serve any other requests -- health checks, SSE connections, webhook handling all fail. The attacker has essentially DoS'd the entire application through a "legitimate" API call.

2. **Partial state injection via batchSeed timing**: If batchSeed fails after account seeding but before supply/slot seeding, the initial SSE snapshot sent to new clients contains account data but no supply/slot data. Components that derive MCAP (which requires `supply * price * candle_price`) will compute NaN or 0, potentially displayed to users as misleading financial data. Not exploitable for fund theft, but could manipulate user perception during the boot window.

3. **Rate limit bypass via restart storm**: If an attacker can trigger Railway container restarts (e.g., by causing the process to crash via unhandled rejection), they get a brief window (~10s) where no rate limits are enforced. Combined with the missing process-level handlers, this could be chained: craft a request that triggers an unhandled rejection (edge case in any async handler) -> container crashes -> restart -> burst of unauthenticated/unratelimited requests before limits restore. The webhook auth is still enforced (checked from env var on each request, not in-memory state), so this mainly affects RPC proxy and SSE amplification.

## Questions for Other Focus Areas

1. **For ERR-02 (Race Conditions)**: Are there scenarios where `protocolStore.setAccountState()` is called concurrently from both the webhook handler and ws-subscriber? The Map operations are atomic in single-threaded Node.js, but the JSON serialization + SSE broadcast is not. Could two concurrent calls produce interleaved SSE messages?

2. **For CHAIN-02 (RPC Trust)**: Does @solana/web3.js `Connection` have any configurable timeout for HTTP requests? The `fetchMiddleware` option might allow injecting timeout logic.

3. **For INFRA-03 (Infrastructure)**: Does Railway's health check probe only look at HTTP status, or does it inspect the response body? If status-only, the always-200 health endpoint is effectively useless for detecting degraded state.

4. **For API-01 (REST API)**: Is there a Next.js configuration for maximum request timeout (similar to Express's `server.requestTimeout`)? This would provide a backstop for the missing fetch timeouts.

## Raw Notes

- The codebase uses a consistent pattern of `captureException(err instanceof Error ? err : new Error(...))` for Sentry reporting. This is good -- ensures Sentry always receives an Error object with a stack trace.
- The `bigintReplacer`/`bigintReviver` pair in `bigint-json.ts` is critical for SSE serialization. If this pair has a bug, it would manifest as silent data corruption in useProtocolState's empty catch blocks. Should be verified by ERR-02 or LOGIC-02 auditor.
- The `parseSwapError` function has a potential false positive: line 194 matches any string containing "rejected" (case-insensitive). A legitimate error message containing "rejected" (e.g., "transaction rejected by validator") would be displayed as "Transaction was cancelled" which could confuse users.
- `sse-connections.ts` scheduleAutoRelease uses `timeout.unref()` which prevents the timer from keeping Node.js alive. This is good for graceful shutdown but means zombie connection cleanup may not fire during shutdown.
- The `getClientIp` function in `rate-limit.ts` logs a warning in production when no proxy headers are found. This is a good operational signal but could itself become noisy if the warning fires on every request.
