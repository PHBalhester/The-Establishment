---
task_id: db-phase1-err-03-rate-limiting
provides: [err-03-rate-limiting-findings, err-03-rate-limiting-invariants]
focus_area: err-03-rate-limiting
files_analyzed: [app/lib/rate-limit.ts, app/lib/sse-connections.ts, app/lib/credit-counter.ts, app/lib/ws-subscriber.ts, app/lib/protocol-store.ts, app/lib/sse-manager.ts, app/lib/connection.ts, app/lib/confirm-transaction.ts, app/app/api/webhooks/helius/route.ts, app/app/api/rpc/route.ts, app/app/api/sol-price/route.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/app/api/health/route.ts, app/hooks/useSwap.ts, app/hooks/useProtocolState.ts, app/hooks/useTokenBalances.ts, app/lib/swap/error-map.ts, app/lib/curve/error-map.ts, app/next.config.ts, app/instrumentation.ts, app/db/connection.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# ERR-03: Rate Limiting & Resource Exhaustion -- Condensed Summary

## Key Findings (Top 10)
- **RPC proxy fetch() has no timeout**: Upstream calls can hang indefinitely if Helius stalls without closing the socket -- `app/app/api/rpc/route.ts:144`
- **Candles and carnage-events API routes lack rate limiting**: `/api/candles` and `/api/carnage-events` have no `checkRateLimit` calls, allowing unbounded DB queries -- `app/app/api/candles/route.ts:186`, `app/app/api/carnage-events/route.ts:32`
- **Health endpoint lacks rate limiting**: `/api/health` triggers a Postgres `SELECT 1` and potentially an RPC `getSlot()` per request with no rate cap -- `app/app/api/health/route.ts:32`
- **gapFillCandles can generate unbounded synthetic candles**: A crafted `from`/`to` range at 1-minute resolution (e.g., 1 year) creates ~525,600 synthetic objects in memory before the DB limit applies -- `app/app/api/candles/route.ts:94-167`
- **Rate limiter timestamps array grows linearly per key**: Under sustained traffic at max rate, each key stores 300 timestamps (RPC profile), consuming memory proportional to unique IP count -- `app/lib/rate-limit.ts:97-111`
- **SSE subscriber set has no bounded size**: `SSEManager.subscribers` grows unbounded (only removed on error/disconnect); a client that connects but never disconnects and never reads keeps the callback alive -- `app/lib/sse-manager.ts:32`
- **Webhook body size check uses Content-Length only**: Chunked transfer encoding omits Content-Length, bypassing the 1MB guard entirely -- `app/app/api/webhooks/helius/route.ts:309-315`
- **Rate limit IP extraction trusts x-forwarded-for blindly**: An attacker can set `x-forwarded-for: <random-ip>` to bypass per-IP rate limits, getting a fresh bucket on each request -- `app/lib/rate-limit.ts:129-151`
- **ws-subscriber getProgramAccounts has no dataSlice**: Each gPA poll (30s interval) fetches full account data for all UserStake accounts; at scale (1000+ stakers) this is a large RPC response -- `app/lib/ws-subscriber.ts:377-390`
- **protocolStore.lastSerialized Map grows monotonically**: Every unique key ever set persists in the dedup map; keys are never deleted -- `app/lib/protocol-store.ts:38`

## Critical Mechanisms
- **Sliding Window Rate Limiter** (`app/lib/rate-limit.ts`): In-memory per-IP+endpoint sliding window with timestamp array. Three profiles configured (RPC=300/min, webhook=120/min, sol-price=30/min). Cleanup sweeps stale entries every 60s. Keyed by `${ip}:${endpoint}`.
- **SSE Connection Tracker** (`app/lib/sse-connections.ts`): Per-IP cap (10) and global cap (5000). Zombie protection via 30-minute auto-release timeout. State is globalThis singleton.
- **Webhook Pipeline** (`app/app/api/webhooks/helius/route.ts`): Rate limit -> auth -> body size check -> JSON parse -> payload discrimination -> per-transaction processing loop with individual try/catch. Enhanced account changes bypass the transaction age guard.
- **RPC Proxy** (`app/app/api/rpc/route.ts`): Method allowlist -> rate limit -> failover across up to 3 endpoints with sticky routing. No per-request timeout on upstream fetch.
- **Transaction Confirmation Poller** (`app/lib/confirm-transaction.ts`): 2s polling interval with 90s hard timeout. Block height check prevents infinite polling on dropped transactions.

## Invariants & Assumptions
- INVARIANT: Rate limiting applied to webhook, RPC proxy, and sol-price routes -- enforced at `app/app/api/webhooks/helius/route.ts:258`, `app/app/api/rpc/route.ts:83`, `app/app/api/sol-price/route.ts:85`
- INVARIANT: SSE connections capped at 10/IP and 5000 global -- enforced at `app/lib/sse-connections.ts:50-52`
- INVARIANT: Webhook body size capped at 1MB -- PARTIALLY enforced at `app/app/api/webhooks/helius/route.ts:309-315` (Content-Length only, chunked encoding bypasses)
- INVARIANT: Candle query result set capped at 2000 rows -- enforced at `app/app/api/candles/route.ts:210-213`
- INVARIANT: RPC proxy only forwards allowlisted methods -- enforced at `app/app/api/rpc/route.ts:31-59`
- ASSUMPTION: Railway reverse proxy sets x-forwarded-for correctly -- UNVALIDATED (attacker can spoof, see IP extraction issue)
- ASSUMPTION: Single Railway process means in-memory rate limiting is sufficient -- validated for current architecture, breaks on horizontal scaling
- ASSUMPTION: Helius sends well-formed JSON arrays of bounded size -- NOT enforced (no element count limit on webhook payload arrays)

## Risk Observations (Prioritized)
1. **RPC proxy no upstream timeout**: `app/app/api/rpc/route.ts:144` -- fetch() without AbortSignal.timeout() means a stalled upstream holds the Next.js worker thread indefinitely. Under load, all workers could be blocked, causing full service DoS.
2. **Candles/carnage-events/health routes unprotected**: `app/app/api/candles/route.ts:186`, `app/app/api/carnage-events/route.ts:32`, `app/app/api/health/route.ts:32` -- Attacker can spam these endpoints to exhaust DB connections or CPU.
3. **gapFillCandles CPU/memory amplification**: `app/app/api/candles/route.ts:139` -- The gap-fill loop iterates from `from` to `to` at resolution granularity. A request with `resolution=1m&from=0&to=<now>` creates millions of objects.
4. **Webhook Content-Length bypass**: `app/app/api/webhooks/helius/route.ts:309-315` -- Chunked encoding omits Content-Length header. `req.json()` will buffer the entire body regardless.
5. **IP spoofing bypasses rate limiter**: `app/lib/rate-limit.ts:130-134` -- x-forwarded-for is trusted without validation against known proxy IPs.

## Novel Attack Surface
- **Candle gap-fill amplification**: Unique to this codebase. The `/api/candles?gapfill=true` endpoint generates synthetic candles between `from` and `to` at the requested resolution. With `resolution=1m`, a range spanning 1 year generates ~525K objects. This is computed after the DB query returns (so the 2000-row limit doesn't help), and the entire response must be serialized and sent. This could exhaust server memory or at minimum cause long response times blocking a worker.
- **Rate limit per-endpoint isolation as bypass vector**: The rate limiter keys by `${ip}:${endpoint}`. An attacker can combine traffic across unprotected endpoints (candles, carnage-events, health) to generate substantial server load while staying under the per-IP limits on protected endpoints.

## Cross-Focus Handoffs
- -> **CHAIN-01 (RPC)**: ws-subscriber's 30s gPA poll fetches full UserStake accounts without dataSlice. At scale, this consumes significant RPC credits and bandwidth. Investigate whether a dataSlice or count-only approach suffices.
- -> **CHAIN-02 (Accounts)**: protocolStore lastSerialized map and accounts map never evict entries. If account keys become stale (e.g., old curve PDAs after graduation), they persist forever. Investigate memory growth implications.
- -> **DATA-01 (Database)**: Candles and carnage-events endpoints query Postgres without rate limiting. Under sustained load, this could exhaust the 10-connection pool, affecting all DB-dependent routes.
- -> **INFRA-03 (Infrastructure)**: The in-memory rate limiter, SSE tracker, and protocol store all use globalThis singletons. They are single-process only. Horizontal scaling (multiple Railway instances) would break all rate limiting and SSE delivery.

## Trust Boundaries
The rate limiting and resource exhaustion trust model has three layers. The outermost layer is Railway's reverse proxy, which is trusted to set x-forwarded-for correctly (unvalidated). The middle layer is the in-memory rate limiter, which enforces per-IP request caps on 3 of 8 API routes. The innermost layer is per-endpoint resource guards (SSE connection caps, webhook body size limits, candle query row limits). The gap is that 5 of 8 API routes have no rate limiting at all, and the body size check on the webhook route is bypassable via chunked encoding. External API calls (CoinGecko, Binance, Helius RPC) have timeouts only on sol-price; the RPC proxy has no timeout. The overall posture is "good foundation with coverage gaps."
<!-- CONDENSED_SUMMARY_END -->

---

# ERR-03: Rate Limiting & Resource Exhaustion -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase has a well-designed rate limiting foundation (sliding window algorithm, SSE connection caps, webhook body size limits) but has significant coverage gaps. Three of eight API routes lack rate limiting entirely, the RPC proxy has no upstream timeout, the candle gap-fill algorithm has a CPU/memory amplification vulnerability, and the webhook body size check can be bypassed via chunked transfer encoding. The IP extraction for rate limiting trusts x-forwarded-for headers without proxy validation, meaning all per-IP rate limits can be bypassed by header spoofing. These issues range from medium to high severity depending on the ease of exploitation and blast radius.

## Scope

All off-chain files related to rate limiting, timeouts, resource caps, connection pooling, request size limits, algorithmic complexity, and ReDoS patterns. On-chain programs/ directory excluded per audit scope.

**Files fully analyzed (24):**
- Rate limiting infrastructure: `app/lib/rate-limit.ts`, `app/lib/sse-connections.ts`, `app/lib/credit-counter.ts`
- API routes (all 8): webhooks/helius, rpc, sol-price, sse/protocol, sse/candles, candles, carnage-events, health
- State infrastructure: `app/lib/ws-subscriber.ts`, `app/lib/protocol-store.ts`, `app/lib/sse-manager.ts`
- Connection/config: `app/lib/connection.ts`, `app/db/connection.ts`, `app/next.config.ts`, `app/instrumentation.ts`
- Client hooks (3): `app/hooks/useSwap.ts`, `app/hooks/useProtocolState.ts`, `app/hooks/useTokenBalances.ts`
- Error handling: `app/lib/swap/error-map.ts`, `app/lib/curve/error-map.ts`, `app/lib/confirm-transaction.ts`

## Key Mechanisms

### 1. Sliding Window Rate Limiter (`app/lib/rate-limit.ts`)

**How it works:**
- Per-IP+endpoint keying: `${ip}:${endpoint}`
- Stores array of request timestamps per key
- On each request: filter timestamps to window, check count >= max, push new timestamp
- Three preconfigured profiles: RPC (300/60s), Webhook (120/60s), Sol-price (30/60s)
- Cleanup interval (60s) removes entries where all timestamps are older than 5 minutes
- globalThis singleton prevents duplicate cleanup intervals on HMR

**Concerns:**
1. **Memory growth** (line 66-67, 110): Each key stores up to `maxRequests` timestamps. Under sustained traffic from 10,000 unique IPs on the RPC endpoint, that's 10,000 * 300 timestamps * 8 bytes = ~24MB. Not critical but unbounded.
2. **IP extraction** (lines 129-151): `getClientIp()` takes the first IP from `x-forwarded-for`. This is spoofable unless Railway's reverse proxy strips/overwrites the header. The code warns in production if no proxy headers are present, but does not validate the header's trustworthiness.
3. **No global rate limit**: Each endpoint has its own limit. An attacker can simultaneously hit all endpoints at their individual maximums.

### 2. SSE Connection Tracker (`app/lib/sse-connections.ts`)

**How it works:**
- Per-IP limit: 10 connections (5 tabs x 2 SSE routes)
- Global limit: 5000 connections
- Zombie protection: 30-minute auto-release timeout per connection
- State: globalThis singleton Map<string, number> + globalCount counter
- `acquireConnection()` / `releaseConnection()` are the gate functions
- `scheduleAutoRelease()` returns a cleanup function that cancels the timeout

**Concerns:**
1. **Double-release safety** (lines 65-73): `releaseConnection` is safe to call multiple times (floors at 0 per IP, Math.max(0) for global). Good defensive pattern.
2. **globalCount desync risk**: If `releaseConnection` is called without a prior `acquireConnection` (e.g., error path), `globalCount` could go below zero. The `Math.max(0)` prevents negative numbers but doesn't prevent the count from being inaccurate if there's an acquire/release mismatch. The SSE route code correctly guards against double-release with a `released` boolean.

### 3. RPC Proxy (`app/app/api/rpc/route.ts`)

**How it works:**
- Rate limited: Yes (300/min via RPC_RATE_LIMIT)
- Method allowlist: 16 methods explicitly listed
- Failover: Up to 3 endpoints with sticky routing
- Batch support: Array of JSON-RPC requests forwarded as-is

**Concerns:**
1. **No upstream timeout** (line 144): `fetch(endpoint, ...)` has no `signal: AbortSignal.timeout()`. If Helius accepts the connection but stalls (e.g., rate limiting, overload), the Next.js worker thread is blocked indefinitely. With enough concurrent slow-responding requests, all workers are consumed.
2. **No batch size limit** (lines 103-105): The client can send an array of 1000 JSON-RPC requests in a single POST. Each is validated against the allowlist, but the entire batch is forwarded as one upstream request. This amplifies resource consumption.
3. **Credit recording on success** (lines 163-165): Credits are only recorded after successful upstream response. If the upstream returns a JSON-RPC error (but HTTP 200), credits are still recorded for all methods in the batch. Not a security issue but an accuracy concern.

### 4. Webhook Handler (`app/app/api/webhooks/helius/route.ts`)

**How it works:**
- Rate limited: Yes (120/min via WEBHOOK_RATE_LIMIT)
- Auth: timingSafeEqual on Authorization header vs HELIUS_WEBHOOK_SECRET
- Body size: Content-Length checked against 1MB limit
- Processing: Iterates over transactions/accounts, per-item try/catch

**Concerns:**
1. **Content-Length bypass** (lines 309-315): The body size check only reads the `content-length` header. HTTP chunked transfer encoding omits Content-Length. `req.json()` (Next.js NextRequest) will buffer the full body regardless. An attacker who bypasses auth (or in non-production where auth may be skipped) could send multi-MB payloads.
2. **Unbounded transaction loop** (line 363): The `for (const tx of transactions)` loop has no cap on array length. A single webhook call with 10,000 transaction objects would process all of them sequentially, making DB inserts and SSE broadcasts for each.
3. **No element count limit on account changes** (line 538): The `handleAccountChanges` function iterates over all items with no cap.

### 5. Candle API (`app/app/api/candles/route.ts`)

**How it works:**
- No rate limiting
- DB query capped at 2000 rows via `.limit(limit)`
- Gap-fill: Synthetic candles generated between `from` and `to` at resolution granularity

**Concerns:**
1. **No rate limiting**: Any client can spam this endpoint. Each request executes a Postgres query.
2. **Gap-fill amplification** (lines 94-167): The `gapFillCandles` function iterates from `alignedStart` to `rangeEnd` at `step` intervals. For `resolution=1m` with a 1-year range: ~525,600 iterations, each creating an object. The DB returns at most 2000 rows, but the gap-fill loop operates on the `from`/`to` parameters, not the row count.
   - Mitigation: The gap-fill loop only runs when `gapfill !== 'false'`, and the `from`/`to` defaults to the first/last row's time if not provided. But if `from` and `to` are explicitly provided, the range is unbounded.
   - **Impact**: Memory allocation of ~525K objects (each ~100 bytes) = ~50MB per request. JSON serialization adds more. At 10 concurrent requests, that's 500MB.

### 6. Carnage Events API (`app/app/api/carnage-events/route.ts`)

**How it works:**
- No rate limiting
- Always returns the last 5 events (hardcoded `limit(5)`)
- No user input beyond the URL itself

**Concern:** No rate limiting allows amplification of DB queries. Each request opens a Postgres query. With 300 concurrent requests (trivially achievable), the 10-connection pool is saturated.

### 7. Health Endpoint (`app/app/api/health/route.ts`)

**How it works:**
- No rate limiting
- Executes `SELECT 1` on Postgres and optionally `getSlot()` on RPC
- Always returns 200 (by design -- container liveness)

**Concern:** No rate limiting allows DB pool exhaustion. An attacker can spam `/api/health` to consume DB connections, degrading all other endpoints.

### 8. SSE Protocol/Candle Routes

**How it works:**
- Connection-level rate limiting via `acquireConnection(ip)` (SSE connection tracker)
- No request-level rate limiting (GET requests that keep a long-lived connection)
- Heartbeat every 15s keeps connection alive
- Zombie auto-release after 30 minutes

**Concern:** The connection cap (10/IP, 5000 global) provides adequate protection against connection flooding. The heartbeat and auto-release patterns are well-implemented.

## Trust Model

```
Internet
  |
  v
Railway Reverse Proxy  <-- TRUST: Sets x-forwarded-for (UNVALIDATED)
  |
  v
Next.js API Routes     <-- RATE LIMITS: Applied on 3/8 routes
  |                        BODY LIMITS: 1MB on webhook (Content-Length only)
  |                        SSE CAPS: 10/IP, 5000 global
  v
Upstream Services      <-- NO TIMEOUT on RPC proxy fetch
  - Helius RPC            SOL price has 5s timeout (good)
  - CoinGecko
  - Binance
  - Postgres (10-conn pool, no per-query timeout)
```

## State Analysis

### In-Memory State (globalThis singletons)
| Singleton | File | Growth Model | Cleanup |
|-----------|------|-------------|---------|
| Rate limit entries | `rate-limit.ts` | Grows with unique IPs x endpoints | 60s sweep removes entries >5min stale |
| SSE connection counts | `sse-connections.ts` | Grows with unique IPs (Map<string, number>) | Entries deleted when count reaches 0 |
| Credit counter | `credit-counter.ts` | Grows with unique RPC methods (fixed set) | Never cleaned (by design -- monitoring) |
| Protocol store | `protocol-store.ts` | Grows with unique account keys | Never cleaned -- keys persist forever |
| Protocol store dedup | `protocol-store.ts` | Grows with unique account keys | Never cleaned |
| SSE subscribers | `sse-manager.ts` | Grows with SSE connections, shrinks on disconnect | Removed on error or explicit unsubscribe |
| ws-subscriber state | `ws-subscriber.ts` | Fixed size (8 fields) | N/A |

**Observation:** The protocol store Maps grow monotonically. For the current set of known protocol accounts (~10-15 keys), this is negligible. But if the webhook handler receives account changes for unknown accounts (which it logs as warnings but doesn't store), the growth is bounded. The concern is theoretical at current scale.

### Database (Postgres)
- Connection pool: max 10 (Railway free tier)
- No `connectionTimeoutMillis`, `statement_timeout`, or `idleTimeoutMillis` configured on the postgres.js client (see `app/db/connection.ts:56-57`)
- This means: queries can run indefinitely, connections are never recycled, and acquiring a new connection blocks forever if pool is full.

## Dependencies (External APIs)

| Dependency | Timeout | Rate Limited | Failover |
|-----------|---------|-------------|----------|
| Helius RPC (via proxy) | **NONE** | 300/min per IP | Yes (3 endpoints) |
| CoinGecko | 5s (AbortSignal.timeout) | 30/min per IP (on our side) | Falls back to Binance |
| Binance | 5s (AbortSignal.timeout) | 30/min per IP (shared with CoinGecko route) | Returns stale cache |
| Helius WebSocket | No explicit timeout | Staleness detection at 15s | Falls back to HTTP polling |
| Postgres | **NONE** (no statement_timeout) | No (pool max 10) | None |
| Helius Webhook (inbound) | N/A | 120/min per IP | N/A |

## Focus-Specific Analysis

### Rate Limiting Coverage Matrix

| Route | Method | Rate Limited? | Profile | Body Limit? |
|-------|--------|---------------|---------|-------------|
| `/api/webhooks/helius` | POST | Yes | 120/min | 1MB (Content-Length only) |
| `/api/rpc` | POST | Yes | 300/min | No explicit limit |
| `/api/sol-price` | GET | Yes | 30/min | N/A (GET) |
| `/api/sse/protocol` | GET | Connection cap only | 10/IP, 5000 global | N/A (SSE) |
| `/api/sse/candles` | GET | Connection cap only | 10/IP, 5000 global | N/A (SSE) |
| `/api/candles` | GET | **NO** | - | N/A (GET) |
| `/api/carnage-events` | GET | **NO** | - | N/A (GET) |
| `/api/health` | GET | **NO** | - | N/A (GET) |

### Timeout Coverage Matrix

| External Call | File:Line | Timeout | Risk |
|--------------|-----------|---------|------|
| Helius RPC (proxy upstream) | `rpc/route.ts:144` | **NONE** | HIGH -- worker thread blocked |
| CoinGecko | `sol-price/route.ts:48` | 5s | OK |
| Binance | `sol-price/route.ts:66` | 5s | OK |
| Helius WS (slot) | `ws-subscriber.ts:256` | Staleness monitor (15s) | OK |
| Helius HTTP (batch seed) | `ws-subscriber.ts:115` | **NONE** | Medium -- blocks server boot |
| Helius gPA (staker poll) | `ws-subscriber.ts:377` | **NONE** | Medium -- blocks server thread |
| Postgres SELECT 1 | `health/route.ts:38` | **NONE** | Medium -- holds connection |
| TX confirmation poll | `confirm-transaction.ts:36` | 90s hard cap | OK |

### Regex Analysis (ReDoS)

All regex patterns in the codebase were reviewed:
- Error map matchers: `/Error Number:\s*(\d+)/`, `/custom program error:\s*0x([0-9a-fA-F]+)/` -- linear, safe
- Input validation: `/^\d*\.?\d*$/` -- linear, no backtracking risk
- Mobile detection: `/Android|iPhone|iPad.../i` -- alternation but no nested quantifiers, safe
- CSP formatting: `/\s{2,}/g` -- linear, safe
- String formatting: `/\.?0+$/` -- linear, safe

**Verdict:** No ReDoS vulnerability found. All regex patterns are simple with no nested quantifiers or overlapping groups.

### Algorithmic Complexity

| Function | File:Line | Complexity | Concern |
|----------|-----------|------------|---------|
| `gapFillCandles` | `candles/route.ts:94` | O(range/resolution) | Unbounded with crafted from/to |
| Rate limit `filter` | `rate-limit.ts:97` | O(timestamps per key) | Max 300 per key |
| `handleAccountChanges` loop | `webhook/route.ts:538` | O(accounts in payload) | No element count cap |
| Raw TX processing loop | `webhook/route.ts:363` | O(transactions in payload) | No element count cap |
| `SSEManager.broadcast` | `sse-manager.ts:62` | O(subscribers) | Bounded by connection cap (5000) |
| `protocolStore.getAllAccountStates` | `protocol-store.ts:102` | O(accounts) | Small set (~15 keys) |

## Cross-Focus Intersections

### ERR-01 (Fail-Open)
The webhook body size check uses Content-Length only. If missing (chunked encoding), the check is effectively skipped -- this is a fail-open pattern on the body size guard.

### ERR-02 (Race/Concurrency)
The SSE connection tracker (`sse-connections.ts`) uses synchronous Map operations. In Node.js's single-threaded event loop, this is safe. But if Next.js ever moves to worker threads, the globalCount could desync.

### CHAIN-01 (RPC)
The ws-subscriber's `getProgramAccounts` call (line 377) fetches full account data for all UserStake accounts every 30 seconds. As the protocol grows (1000+ stakers), this becomes a significant credit consumer. A `dataSlice` or aggregate approach would reduce load.

### INFRA-03 (Infrastructure)
All rate limiting and connection tracking is in-memory (single-process). If Railway scales to multiple instances, rate limits are per-instance (not shared), making them trivially bypassable.

### API-01 (RPC Client)
The RPC proxy's lack of upstream timeout is the most significant resource exhaustion risk. A stalled Helius endpoint could consume all Next.js worker threads.

## Cross-Reference Handoffs

| Target | Item | Why |
|--------|------|-----|
| CHAIN-01 | ws-subscriber gPA without dataSlice | Credit consumption at scale |
| CHAIN-02 | protocolStore never evicts keys | Memory growth if keys change over time |
| DATA-01 | Candles/carnage/health routes no rate limit | DB pool exhaustion risk |
| INFRA-03 | In-memory rate limiting is single-process only | Breaks on horizontal scaling |
| SEC-01 | x-forwarded-for spoofing | All per-IP rate limits bypassable |
| API-01 | RPC proxy no upstream timeout | Worker thread exhaustion |
| WEB-02 | No Next.js body size limit in config | Framework-level request size not configured |

## Risk Observations

### HIGH

**H-ERR03-01: RPC proxy fetch without timeout**
- File: `app/app/api/rpc/route.ts:144`
- The `fetch(endpoint, ...)` call has no `signal: AbortSignal.timeout()`. If the upstream Helius endpoint stalls (accepts connection, sends headers, stops responding), the Next.js worker thread is blocked indefinitely. Under concurrent load (e.g., 50 users with active swap pages polling at 1s), all available workers could be consumed within minutes.
- Impact: Full service denial. All API routes become unresponsive.
- Likelihood: Possible -- RPC providers occasionally experience slowdowns under load.
- Severity: HIGH (Availability impact: full service outage)

**H-ERR03-02: Gap-fill candle amplification**
- File: `app/app/api/candles/route.ts:94-167`
- The `gapFillCandles` function iterates from `from` to `to` at resolution granularity. With `resolution=1m&from=0&to=<current-unix>`, the loop runs ~29 million iterations (from epoch to now). Even with a more conservative range (1 year), it generates ~525K objects.
- The DB query limit (2000 rows) only limits the database result set, not the gap-fill output. Gap-fill operates on the `from`/`to` parameters.
- Impact: Server memory exhaustion or prolonged CPU block. At 10 concurrent crafted requests, ~500MB allocation.
- Likelihood: Possible -- endpoint has no rate limiting, parameters are user-controlled.
- Severity: HIGH (combined with no rate limiting on this endpoint)

### MEDIUM

**M-ERR03-03: Candles, carnage-events, and health routes lack rate limiting**
- Files: `app/app/api/candles/route.ts:186`, `app/app/api/carnage-events/route.ts:32`, `app/app/api/health/route.ts:32`
- These three routes execute Postgres queries (and optionally RPC calls for health) without any rate limiting. An attacker can send hundreds of concurrent requests to exhaust the 10-connection Postgres pool, degrading all DB-dependent functionality.
- Impact: DB pool exhaustion, affecting webhook processing, candle queries, and event storage.
- Severity: MEDIUM (Availability: partial degradation)

**M-ERR03-04: Webhook body size bypass via chunked encoding**
- File: `app/app/api/webhooks/helius/route.ts:309-315`
- The 1MB body size check reads `content-length` header. HTTP chunked transfer encoding does not include Content-Length. The `req.json()` call from NextRequest buffers the entire body into memory regardless.
- Impact: Memory exhaustion via large webhook payloads. Requires bypassing auth (or non-production environment).
- Severity: MEDIUM (requires auth bypass to exploit in production; in production, Helius sends the webhooks so payload size is trusted)

**M-ERR03-05: IP spoofing bypasses all per-IP rate limits**
- File: `app/lib/rate-limit.ts:129-134`
- `getClientIp()` trusts the first IP in `x-forwarded-for`. If Railway's reverse proxy does not strip/overwrite this header, an attacker can set `x-forwarded-for: <random>` on each request to get a fresh rate-limit bucket, bypassing all per-IP limits.
- Impact: All per-IP rate limits become ineffective.
- Severity: MEDIUM (depends on Railway proxy behavior; if Railway overwrites x-forwarded-for, this is not exploitable)

**M-ERR03-06: RPC proxy no batch size limit**
- File: `app/app/api/rpc/route.ts:103-105`
- A JSON-RPC batch request with 1000 items is forwarded as-is to Helius. Each method is validated individually, but there is no limit on the number of items in the batch. This amplifies upstream resource consumption.
- Impact: Credit exhaustion and potential Helius rate limiting.
- Severity: MEDIUM (financial impact -- Helius credit consumption)

**M-ERR03-07: Webhook no element count limit**
- File: `app/app/api/webhooks/helius/route.ts:363, 538`
- The webhook handler iterates over all transactions/accounts in the payload array without limiting element count. A single webhook call with 10,000 elements processes all of them.
- Impact: Long request processing time, DB write amplification.
- Severity: MEDIUM (requires auth to send webhooks in production)

### LOW

**L-ERR03-08: ws-subscriber gPA without dataSlice**
- File: `app/lib/ws-subscriber.ts:377-390`
- Every 30s, `getProgramAccounts` fetches full UserStake account data for all stakers. At scale (1000+ stakers), each response could be 100KB+. A dataSlice approach (only fetching `stakedBalance` and `lastClaimTs` bytes) would reduce RPC credit consumption and response size significantly.
- Severity: LOW (operational efficiency, not exploitable)

**L-ERR03-09: ws-subscriber batch seed has no timeout**
- File: `app/lib/ws-subscriber.ts:113-243`
- `batchSeed()` makes multiple RPC calls (getMultipleAccountsInfo, getTokenSupply x2, getSlot, getProgramAccounts) without timeouts. If Helius is slow during server boot, `register()` blocks for an extended period, delaying the entire Next.js startup.
- Severity: LOW (affects startup latency, not ongoing availability)

**L-ERR03-10: Postgres pool has no timeout configuration**
- File: `app/db/connection.ts:56-57`
- The postgres.js client is configured with only `max: 10` and optional `ssl`. Missing: `connectionTimeoutMillis`, `statement_timeout`, `idleTimeoutMillis`, `maxUses`. Queries can run indefinitely and connections are never recycled.
- Severity: LOW (postgres.js has reasonable internal defaults, but explicit configuration is best practice -- see AIP-146)

**L-ERR03-11: protocolStore maps grow monotonically**
- File: `app/lib/protocol-store.ts:37-38`
- Both `accounts` and `lastSerialized` Maps grow with every unique key and are never pruned. With the current ~15 protocol accounts, this is negligible. But the design does not account for key rotation (e.g., pool migration, curve graduation creating new PDAs).
- Severity: LOW (theoretical concern at current scale)

**L-ERR03-12: Rate limiter cleanup uses fixed stale threshold**
- File: `app/lib/rate-limit.ts:161`
- `STALE_THRESHOLD_MS` is 5 minutes regardless of the rate limit window. For the 60-second windows currently configured, entries become stale 4 minutes after their last request. This means IP entries persist 5x longer than the actual rate-limit window, consuming slightly more memory than necessary.
- Severity: LOW (minor memory inefficiency)

## Novel Attack Surface Observations

### Candle Gap-Fill Amplification Attack
This is the most novel observation. The `/api/candles` endpoint is the only unprotected route with unbounded computational cost. An attacker can:
1. Send a request: `GET /api/candles?pool=<valid>&resolution=1m&from=1704067200&to=1735689600` (1 year range)
2. The DB query returns at most 2000 rows (capped)
3. But `gapFillCandles` iterates over 525,600 time slots, creating one object per slot
4. Each object is ~100 bytes, totaling ~50MB per request
5. JSON.stringify on the response adds another ~50MB of string allocation
6. At 10 concurrent requests: ~1GB memory allocation

This is particularly dangerous because it combines with the lack of rate limiting: the attacker can send 100 concurrent requests cheaply.

**Mitigation:** Cap the gap-fill output size (e.g., max 10,000 synthetic candles), add rate limiting to the candles endpoint, and/or reject ranges where `(to - from) / resolution_seconds > MAX_GAP_FILL_CANDLES`.

### Combined Rate Limit Bypass + Amplification
An attacker who spoofs `x-forwarded-for` can:
1. Bypass per-IP rate limits on all 3 protected routes
2. Simultaneously spam all 5 unprotected routes
3. Combine with gap-fill amplification and batch RPC requests
4. Exhaust DB pool, memory, and CPU simultaneously

This creates a multi-vector DoS that is difficult to mitigate with any single fix.

## Questions for Other Focus Areas

1. **INFRA-03**: Does Railway's reverse proxy strip/overwrite `x-forwarded-for`, or can clients set it arbitrarily?
2. **CHAIN-01**: What is the expected staker count at mainnet scale? This affects the gPA payload size in ws-subscriber.
3. **DATA-01**: Is the postgres.js connection pool monitored? Can we detect pool exhaustion before it cascades?
4. **WEB-02**: Does Next.js App Router enforce any default request body size limit, or is `req.json()` unbounded?

## Raw Notes

- The rate-limit.ts module is clean, well-documented code. The sliding window algorithm is correctly implemented. The main gap is coverage (3/8 routes) rather than implementation quality.
- The SSE connection tracker is one of the better-implemented components: proper double-release protection, zombie timeout, globalThis singleton, and diagnostic functions.
- The credit-counter is purely observational (no enforcement) -- it counts RPC calls but does not limit them. This is appropriate for monitoring but means there is no protection against runaway RPC credit consumption from the ws-subscriber.
- Error maps use simple, safe regex patterns. No ReDoS risk.
- The confirm-transaction poller has a proper 90s hard timeout and block height check -- good pattern.
- useProtocolState has exponential backoff (1s -> 30s max) with a visibility-aware disconnect. This prevents reconnect storms. Good pattern.
- useTokenBalances polls every 30s with visibility gating. Reasonable resource consumption.
- The instrumentation.ts try/catch around ws-subscriber.init() is critical -- an unhandled exception here would kill the entire Next.js process (noted in comments).
