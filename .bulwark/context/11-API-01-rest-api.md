---
task_id: db-phase1-api-01
provides: [api-01-findings, api-01-invariants]
focus_area: api-01
files_analyzed:
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/sse/protocol/route.ts
  - app/app/api/sse/candles/route.ts
  - app/app/api/rpc/route.ts
  - app/app/api/health/route.ts
  - app/app/api/candles/route.ts
  - app/app/api/sol-price/route.ts
  - app/app/api/carnage-events/route.ts
  - app/lib/rate-limit.ts
  - app/lib/sse-manager.ts
  - app/lib/sse-connections.ts
  - app/lib/protocol-store.ts
  - app/lib/ws-subscriber.ts
  - app/lib/credit-counter.ts
  - app/lib/bigint-json.ts
  - app/lib/connection.ts
  - app/lib/anchor.ts
  - app/lib/protocol-config.ts
  - app/instrumentation.ts
  - app/hooks/useProtocolState.ts
  - app/hooks/useTokenBalances.ts
  - app/next.config.ts
finding_count: 14
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 7}
---
<!-- CONDENSED_SUMMARY_START -->
# REST API Security (API-01) -- Condensed Summary

## Key Findings (Top 10)

1. **Content-Length bypass on webhook body size limit**: The 1MB body size check relies on the `content-length` header, which an attacker can omit or falsify. The actual body is still fully read by `req.json()` before the check has any effect. -- `app/app/api/webhooks/helius/route.ts:309-315`
2. **Health endpoint exposes internal operational state**: /api/health returns wsSubscriber status (initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive), credit counter stats (totalCalls, per-method breakdown), and protocol-store internal slot data -- all without authentication. -- `app/app/api/health/route.ts:66-72`
3. **RPC proxy batch amplification**: The /api/rpc proxy accepts JSON-RPC batch requests (arrays) with no upper bound on batch size. A single HTTP request could contain thousands of RPC calls, all forwarded to upstream Helius, burning credits and potentially causing upstream rate-limiting. -- `app/app/api/rpc/route.ts:103-106`
4. **Rate limiter IP extraction trusts x-forwarded-for first hop**: getClientIp takes the first entry from x-forwarded-for. If Railway's proxy appends (not prepends) or the header is attacker-controlled, the rate limit can be bypassed by spoofing arbitrary IPs. -- `app/lib/rate-limit.ts:129-135`
5. **SSE candles route broadcasts ALL events**: The candles SSE subscriber receives ALL sseManager broadcasts (candle-update AND protocol-update), not just candle events. While the data is not sensitive, this wastes bandwidth and could be used for enumeration. -- `app/app/api/sse/candles/route.ts:71-78`
6. **RPC proxy method allowlist includes sendTransaction**: The allowlist includes `sendTransaction`, meaning any browser client can submit arbitrary pre-signed transactions through the proxy. While the proxy cannot sign, it acts as an open relay. -- `app/app/api/rpc/route.ts:44`
7. **No rate limiting on /api/candles, /api/carnage-events**: These two database-querying endpoints have no rate limiting. An attacker can issue rapid GET requests to load the database. -- `app/app/api/candles/route.ts:186`, `app/app/api/carnage-events/route.ts:32`
8. **Protocol store serves unfiltered synthetic keys via SSE**: The initial-state snapshot sent to new SSE clients includes ALL keys from protocolStore, including synthetic `__` keys like `__slot`, `__supply:CRIME`, `__staking:globalStats`. These expose server-side polling data to any browser client. -- `app/app/api/sse/protocol/route.ts:71`
9. **Webhook auth uses plain Authorization header comparison, not HMAC**: The webhook verifies `Authorization === HELIUS_WEBHOOK_SECRET` (exact match). This means the secret is sent in cleartext in every request header. Helius's actual authentication model for this project sends the authHeader value as-is in the Authorization header. This is correct for the Helius pattern, but the secret itself must remain high-entropy. -- `app/app/api/webhooks/helius/route.ts:286-301`
10. **SSE connection auto-release shares release logic with abort handler**: Both the 30-min auto-release timer and the abort signal handler call release(). The double-release guard (`released` boolean) prevents underflow, but the pattern means zombie connections hold a slot for up to 30 minutes even after client disconnect if the abort signal does not fire. -- `app/app/api/sse/protocol/route.ts:54-62`

## Critical Mechanisms

- **Webhook Authentication Chain**: Request enters POST handler -> rate limit check (IP + sliding window, 120/min) -> production fail-closed guard (500 if no secret) -> timingSafeEqual comparison (length-leak-protected) -> body size check (content-length only) -> JSON parse -> payload type discrimination -> processing. -- `app/app/api/webhooks/helius/route.ts:255-509`
- **RPC Proxy Pipeline**: POST handler -> rate limit check (300/min) -> JSON parse -> per-request method allowlist check -> sticky failover across 3 endpoints -> credit recording on success -> forwarded response. -- `app/app/api/rpc/route.ts:80-188`
- **SSE Connection Lifecycle**: GET handler -> per-IP cap check (10/IP, 5000 global) -> auto-release timer (30 min) -> ReadableStream with subscriber callback -> heartbeat (15s) -> abort signal cleanup -> release. -- `app/app/api/sse/protocol/route.ts:41-136`
- **Protocol Store Broadcast Dedup**: setAccountState() serializes data -> compares with lastSerialized -> skips broadcast if identical -> calls sseManager.broadcast() which iterates all subscribers. -- `app/lib/protocol-store.ts:53-64`

## Invariants & Assumptions

- INVARIANT: Production webhook requires HELIUS_WEBHOOK_SECRET set (fail-closed 500) -- enforced at `app/app/api/webhooks/helius/route.ts:273-283`
- INVARIANT: RPC proxy only forwards methods in ALLOWED_METHODS set -- enforced at `app/app/api/rpc/route.ts:116`
- INVARIANT: SSE connections capped at 10 per IP and 5000 globally -- enforced at `app/lib/sse-connections.ts:49-56`
- INVARIANT: Webhook swap events are idempotent (TX signature PK, onConflictDoNothing) -- enforced at `app/app/api/webhooks/helius/route.ts:680`
- INVARIANT: Stale transactions (>5 min) rejected from webhook -- enforced at `app/app/api/webhooks/helius/route.ts:381-388`
- ASSUMPTION: Railway's reverse proxy always sets x-forwarded-for with the real client IP as the first entry -- VALIDATED by production warning log at `app/lib/rate-limit.ts:142-147` / NOT structurally enforced
- ASSUMPTION: Helius webhook sends Authorization header exactly matching the secret string -- validated at `app/app/api/webhooks/helius/route.ts:287`
- ASSUMPTION: Single Next.js process (no horizontal scaling) makes in-memory rate limiting, SSE pub/sub, and protocol store effective -- documented at `app/lib/sse-manager.ts:8-11`, `app/lib/rate-limit.ts:9` / NOT enforced (no guard against multi-process)
- ASSUMPTION: No authentication needed for SSE, candle, carnage-events, health, or sol-price endpoints because they serve public protocol data -- UNVALIDATED (no discussion of whether internal operational metrics in /api/health should be public)

## Risk Observations (Prioritized)

1. **H050 Regression -- Body size limit is content-length-only**: `app/app/api/webhooks/helius/route.ts:309-315` -- Attacker can omit content-length header and send a multi-MB body. Next.js default body limit is the only remaining guard. If Next.js reads the full body, memory can be exhausted. Impact: DoS against the server process.
2. **RPC batch amplification**: `app/app/api/rpc/route.ts:103-106` -- No limit on batch array size. A single request with 10,000 RPC calls would be forwarded to Helius. Impact: Helius credit burn-down, potential upstream ban, service degradation.
3. **Health endpoint information disclosure**: `app/app/api/health/route.ts:66-72` -- Internal wsSubscriber status, credit counter, and timing data exposed without auth. Helps attacker fingerprint infrastructure state and find timing windows.
4. **Missing rate limits on DB endpoints**: `app/app/api/candles/route.ts`, `app/app/api/carnage-events/route.ts` -- No rate limiting on these GET endpoints. Rapid requests could load the PostgreSQL instance.
5. **SSE candles receives all broadcasts**: `app/app/api/sse/candles/route.ts:71` -- Subscriber callback receives all SSE events, not just candle-update. Protocol-update events also forwarded to candle-only clients. Minor bandwidth waste but worth noting.

## Novel Attack Surface

- **Webhook-triggered SSE broadcast storm**: An attacker who compromises or replays Helius webhook payloads could inject rapid account change events, each triggering a protocol-store update and SSE broadcast to all connected clients. The dedup guard only catches byte-identical payloads; changing a single field (e.g., `updatedAt` which is set server-side) always bypasses dedup. Combined with the 120/min rate limit, this allows up to 120 broadcast storms per minute from a single IP. If Helius itself sends bursts (which it does during active trading), the actual broadcast rate can be much higher since legitimate Helius traffic is not rate-limited by IP. Each broadcast iterates all subscribers -- with 5000 clients this is 600,000 callback invocations per minute.
- **RPC proxy as sendTransaction relay**: The proxy allows `sendTransaction`, which means any browser can submit arbitrary signed transactions. While the proxy cannot sign, this makes the backend an open relay. If Helius imposes per-API-key rate limits, this burns the project's allocation. More critically, the proxy's server IP becomes the apparent origin of all transactions, which could lead to IP-based bans.

## Cross-Focus Handoffs

- --> **ERR-02 (Error Handling)**: Webhook handler uses per-transaction try/catch but does not track error rates. A flood of malformed transactions could silently fill error logs without triggering alerts.
- --> **INFRA-03 (Infrastructure)**: The single-process assumption means all rate limiting, SSE connection tracking, and protocol store state live in process memory. Railway restart = all state lost. Need to verify Railway's restart behavior under load.
- --> **DATA-01 (Data Persistence)**: Webhook handler writes to three Postgres tables. The Drizzle ORM queries use parameterized values (safe from injection), but the candle-aggregator upsert logic in `app/db/candle-aggregator.ts` was not deeply analyzed and could have race conditions under concurrent webhook deliveries.
- --> **SEC-02 (Signature Verification)**: The webhook secret comparison is timing-safe but the secret value itself has no rotation mechanism. If compromised, there's no way to invalidate it without redeploying the webhook configuration.
- --> **CHAIN-02 (RPC Node Trust)**: The RPC proxy blindly forwards upstream responses. If Helius returns manipulated data, the frontend trusts it implicitly.

## Trust Boundaries

The API layer has four distinct trust boundaries. (1) **Helius -> Webhook**: Authenticated via shared secret in Authorization header with timing-safe comparison. Production fail-closed. Rate-limited. This is the strongest API trust boundary. (2) **Browser -> SSE/REST**: Unauthenticated public endpoints. SSE is connection-capped but not auth-gated. REST endpoints (/api/candles, /api/carnage-events, /api/sol-price, /api/health) serve public data without authentication -- most have rate limiting but candles and carnage-events do not. (3) **Browser -> RPC Proxy**: Unauthenticated but method-allowlisted. Any browser can call any allowed method including sendTransaction. Rate-limited at 300/min per IP. (4) **Server -> Upstream RPC (Helius)**: Server-side RPC calls carry the Helius API key. The connection factory hides this from browsers by routing through /api/rpc. The ws-subscriber also opens a WebSocket to Helius carrying the API key in the URL. These are trusted but the trust is in Helius's data integrity, not authentication.
<!-- CONDENSED_SUMMARY_END -->

---

# REST API Security (API-01) -- Full Analysis

## Executive Summary

The Dr. Fraudsworth frontend is a Next.js 16 application with 8 API routes serving as the interface between browsers, the Helius webhook pipeline, and the Solana blockchain. The API layer has been significantly hardened since Audit #1: webhook authentication is fail-closed in production (H001), timing-safe comparison prevents side-channel attacks (H006), rate limiting is applied to sensitive endpoints (H024), SSE connections are capped (H008), and the RPC proxy hides the Helius API key from browsers.

However, several medium-severity observations remain. The body size check on the webhook route only inspects the content-length header (bypassable). The RPC proxy accepts unbounded batch requests. The health endpoint exposes operational telemetry without authentication. Two database-querying endpoints lack rate limiting. The SSE candles route receives more broadcast events than it needs.

No critical vulnerabilities were found in the API layer. The most significant risks are the RPC batch amplification (potential Helius credit exhaustion) and the webhook body size bypass (potential memory exhaustion).

## Scope

All 8 Next.js API routes under `app/app/api/`:
1. `POST /api/webhooks/helius` -- Helius webhook handler (raw TX + enhanced account changes)
2. `GET /api/sse/protocol` -- SSE protocol state streaming
3. `GET /api/sse/candles` -- SSE candle update streaming
4. `POST /api/rpc` -- JSON-RPC proxy to Helius
5. `GET /api/health` -- Liveness + dependency health check
6. `GET /api/candles` -- Historical OHLCV candle data
7. `GET /api/sol-price` -- SOL/USD price proxy with fallback chain
8. `GET /api/carnage-events` -- Recent carnage rebalancing events

Plus supporting libraries:
- `app/lib/rate-limit.ts` -- Sliding window rate limiter
- `app/lib/sse-manager.ts` -- In-memory pub/sub for SSE broadcasts
- `app/lib/sse-connections.ts` -- SSE connection tracking and limiting
- `app/lib/protocol-store.ts` -- In-memory protocol state cache
- `app/lib/ws-subscriber.ts` -- Server-side WebSocket data pipeline
- `app/lib/credit-counter.ts` -- RPC call tracking
- `app/lib/bigint-json.ts` -- BigInt serialization for SSE
- `app/lib/connection.ts` -- RPC connection factory
- `app/lib/anchor.ts` -- Anchor program instances
- `app/lib/protocol-config.ts` -- Cluster-aware address resolution
- `app/instrumentation.ts` -- Server boot hook
- `app/hooks/useProtocolState.ts` -- Browser SSE client
- `app/hooks/useTokenBalances.ts` -- Balance polling
- `app/next.config.ts` -- CSP and security headers

## Key Mechanisms

### 1. Webhook Authentication (H001 Fix Verification)

**File:** `app/app/api/webhooks/helius/route.ts:255-301`

The webhook authentication chain:

1. **Rate limiting** (line 258): `checkRateLimit(clientIp, WEBHOOK_RATE_LIMIT, "webhook")` -- 120 requests per 60-second window per IP. Applied before any authentication to prevent brute-force secret guessing.

2. **Production fail-closed** (line 273): If `NODE_ENV === "production"` and `HELIUS_WEBHOOK_SECRET` is not set, ALL requests are rejected with HTTP 500. This prevents accidental deployment without webhook authentication. Sentry capture alerts on this condition.

3. **Timing-safe comparison** (lines 286-301): When the secret is set, the Authorization header is compared using `timingSafeEqual`. The implementation correctly handles the length-leak issue: if lengths differ, the secret is compared against itself (constant-time regardless of input) and the request is still rejected (`!lengthMatch`). This is textbook correct.

**Assessment:** H001 fix is intact and robust. The fail-closed + timing-safe pattern is the gold standard.

### 2. RPC Proxy Method Allowlist

**File:** `app/app/api/rpc/route.ts:31-59`

The proxy maintains a Set of 15 allowed RPC methods. Every method in the incoming request (single or batch) is validated against this allowlist before forwarding. Disallowed methods are logged and rejected with 400.

**Assessment:** The allowlist is well-curated. However, `sendTransaction` is included, which means browsers can use the proxy as a transaction relay. This is likely intentional (the browser constructs and signs transactions, then needs to submit them), but it means the server's Helius API key absorbs the cost of ALL transaction submissions from ALL users.

### 3. SSE Connection Management

**Files:** `app/lib/sse-connections.ts`, `app/app/api/sse/protocol/route.ts`, `app/app/api/sse/candles/route.ts`

Connection lifecycle:
1. `acquireConnection(ip)` checks per-IP (10) and global (5000) limits
2. `scheduleAutoRelease(ip)` sets a 30-minute timeout for zombie cleanup
3. ReadableStream opens with initial state snapshot (protocol) or "connected" event (candles)
4. Subscriber callback forwards SSE events
5. 15-second heartbeat keeps connection alive through proxies
6. Abort signal triggers cleanup: clearInterval(heartbeat), unsubscribe(), release()
7. Stream cancel() also calls release() as a safety net

**Assessment:** The double-release guard (boolean `released`) is correctly implemented. The 30-minute auto-release is appropriate for zombie prevention. The heartbeat interval (15s) is well-chosen for Railway's ~60-120s proxy timeout.

**Observation:** Both SSE routes share the same connection pool in `sse-connections.ts`. A user with 5 tabs open gets 10 SSE connections (5 protocol + 5 candles), exactly hitting the per-IP limit. If they open a 6th tab, both SSE routes fail for that IP. This is acceptable behavior for DoS prevention but could frustrate power users.

### 4. Rate Limiting Implementation

**File:** `app/lib/rate-limit.ts`

Sliding window algorithm: timestamps stored per `${ip}:${endpoint}` key, filtered to current window, compared against maxRequests.

**Rate limit profiles:**
- RPC proxy: 300/min (accommodates 1s launch page polling)
- SOL price: 30/min
- Webhook: 120/min (Helius sends bursts during active trading)

**Periodic cleanup:** Every 60s, entries with all timestamps older than 5 minutes are deleted. Uses globalThis Symbol to prevent duplicate intervals across HMR.

**Assessment:** Clean implementation. The per-endpoint keying prevents cross-endpoint interference. The cleanup prevents unbounded memory growth.

**Gap:** IP extraction trusts x-forwarded-for first entry. Railway appends IPs to this header (attacker IP is first), which is the correct proxy behavior. However, if Railway ever changes this behavior or if the app is deployed behind a different proxy, the IP extraction could be spoofed. The production warning for missing proxy headers is a good defense-in-depth signal.

### 5. Protocol Store + SSE Broadcast Flow

**Files:** `app/lib/protocol-store.ts`, `app/lib/sse-manager.ts`

Data flow:
1. Webhook handler or ws-subscriber calls `protocolStore.setAccountState(pubkey, data)`
2. protocolStore serializes with `bigintReplacer`, compares to `lastSerialized`
3. If different, calls `sseManager.broadcast("protocol-update", {account, data})`
4. sseManager formats as SSE string: `event: protocol-update\ndata: {...}\n\n`
5. All subscriber callbacks are invoked with the formatted string
6. SSE route's subscriber callback enqueues the string to the ReadableStream controller

**Dedup guard:** The `lastSerialized` map stores the JSON.stringify'd value for each pubkey. Identical data is stored but not broadcast. This prevents redundant broadcasts when Helius sends duplicate account change notifications.

**Assessment:** The dedup guard is effective for truly identical data. However, since the webhook handler adds `updatedAt: Date.now()` to each account state (line 603-606), the serialized form will always differ even if the account data is unchanged. This means the dedup is partially defeated by the timestamp injection. The `setAccountStateQuiet` method (used during batch seed) does not add timestamps, so the initial seed establishes a proper dedup baseline.

## Trust Model

### External Trust Boundaries

| Boundary | Authentication | Rate Limit | Input Validation |
|----------|---------------|------------|------------------|
| Helius -> Webhook | timingSafeEqual (Authorization header) | 120/min | Array check, type discrimination, stale TX check (5 min) |
| Browser -> SSE | None (public) | Connection cap (10/IP, 5000 global) | None needed (read-only stream) |
| Browser -> RPC Proxy | None (public) | 300/min | Method allowlist (15 methods) |
| Browser -> REST | None (public) | 30/min (sol-price only) | Query param validation (candles), none (carnage-events, health) |
| Server -> Helius RPC | API key in URL | N/A (server-side) | N/A |
| Server -> CoinGecko/Binance | None | 5s timeout | Response shape validation |

### Internal Trust Boundaries

| Boundary | Mechanism | Assessment |
|----------|-----------|------------|
| Webhook -> Protocol Store | Function call (same process) | Trusted, no validation needed |
| Protocol Store -> SSE Manager | Function call (same process) | Trusted, dedup guard prevents spam |
| ws-subscriber -> Protocol Store | Function call (same process) | Trusted, uses `setAccountStateQuiet` for seed |
| Anchor decode -> Protocol Store | try/catch around decode | Graceful degradation on decode failure |

## State Analysis

### In-Memory State (lost on restart)

| State | Location | Risk |
|-------|----------|------|
| Rate limit entries | `app/lib/rate-limit.ts` (Map) | Low -- resets mean brief window of no rate limiting |
| SSE connection counts | `app/lib/sse-connections.ts` (Map) | Low -- resets mean brief connection over-accept |
| Protocol account cache | `app/lib/protocol-store.ts` (Map) | Medium -- SSE clients get empty initial state until next webhook |
| Credit counter stats | `app/lib/credit-counter.ts` (class) | Low -- monitoring only |
| SSE subscriber set | `app/lib/sse-manager.ts` (Set) | Low -- clients reconnect via EventSource |
| ws-subscriber state | `app/lib/ws-subscriber.ts` (globalThis) | Medium -- slot subscription restarts on init |
| RPC connection cache | `app/lib/connection.ts` | Low -- auto-recreated on first call |

### Persistent State (PostgreSQL)

| Table | Written By | Read By |
|-------|-----------|---------|
| swap_events | Webhook handler | /api/candles (indirectly via candle-aggregator) |
| epoch_events | Webhook handler | Not exposed via REST (only DB direct) |
| carnage_events | Webhook handler | /api/carnage-events |
| candles | candle-aggregator (called by webhook) | /api/candles |

All DB writes use Drizzle ORM's parameterized queries (safe from SQL injection). Idempotency is enforced via `onConflictDoNothing` on unique keys.

## Dependencies

### External API Dependencies

| Service | Used By | Auth | Timeout | Fallback |
|---------|---------|------|---------|----------|
| Helius RPC (HTTPS) | RPC proxy, ws-subscriber, health check | API key in URL | None specified | 3-endpoint failover (HELIUS_RPC_URL, FALLBACK, NEXT_PUBLIC) |
| Helius WS | ws-subscriber (onSlotChange) | API key in URL | Staleness monitor (15s) | HTTP polling (5s interval) |
| Helius Enhanced Webhook | Inbound to /api/webhooks/helius | Authorization header | N/A | N/A (Helius retries on 5xx) |
| CoinGecko | /api/sol-price | None | 5s (AbortSignal.timeout) | Fallback to Binance |
| Binance | /api/sol-price (fallback) | None | 5s (AbortSignal.timeout) | Return stale cache or 502 |

### Internal Dependencies

| Module | Depends On | Used By |
|--------|-----------|---------|
| protocol-store | sse-manager, bigint-json | webhook handler, ws-subscriber, SSE protocol route, health |
| sse-manager | bigint-json | protocol-store, webhook handler (candle broadcast) |
| sse-connections | None | SSE protocol route, SSE candles route |
| rate-limit | None | webhook, rpc, sol-price |
| connection | @solana/web3.js | anchor, ws-subscriber, health, useTokenBalances, useProtocolState |
| anchor | connection, protocol-config, IDL JSONs | webhook handler, ws-subscriber |

## Focus-Specific Analysis

### API Endpoint Inventory

| Endpoint | Method | Auth | Rate Limit | Body Limit | Input Validation | Response Format |
|----------|--------|------|------------|------------|------------------|-----------------|
| /api/webhooks/helius | POST | timingSafeEqual | 120/min | 1MB (content-length only) | Array check, type discrimination, stale TX filter | JSON {ok, processed} |
| /api/sse/protocol | GET | None | Connection cap (10/IP) | N/A | None | SSE stream |
| /api/sse/candles | GET | None | Connection cap (10/IP) | N/A | None | SSE stream |
| /api/rpc | POST | None | 300/min | None | Method allowlist | JSON-RPC response |
| /api/health | GET | None | None | N/A | None | JSON {status, checks, wsSubscriber, credits} |
| /api/candles | GET | None | None | N/A | pool + resolution required, limit clamped 1-2000 | JSON array |
| /api/sol-price | GET | None | 30/min | N/A | None | JSON {price, source, cached} |
| /api/carnage-events | GET | None | None | N/A | None | JSON array (limit 5) |

### Per-Endpoint Deep Analysis

#### /api/webhooks/helius (Risk 7 -- CRITICAL PATH)

**Positive security patterns:**
- Fail-closed in production (H001)
- Timing-safe comparison with length-leak protection
- Per-transaction error isolation (one bad TX doesn't fail the batch)
- Idempotent writes (onConflictDoNothing on all tables)
- Stale TX rejection (5-minute max age, H049)
- Rate limiting before auth check
- Error reporting via Sentry

**Observations:**
1. **Body size check bypass (H050 regression):** Lines 309-315 check `content-length` header. If the header is missing (e.g., chunked transfer encoding), the check is skipped entirely. `req.json()` on line 321 reads the full body regardless. Next.js default body limit for App Router route handlers is implementation-specific (varies by version). Need to verify what Next.js 16 defaults are.

2. **Response leaks processing counts:** The 200 response includes `{ok: true, processed: {transactions: N, swaps: N, epochs: N, carnages: N}}`. While this is helpful for debugging, it tells an attacker whether their forged payloads were accepted as valid transactions.

3. **Enhanced account change handler does not rate-limit broadcast volume:** Each account change in a batch triggers a `protocolStore.setAccountState()` call which broadcasts via SSE. A Helius burst of 100 account changes = 100 SSE broadcasts. The protocol store dedup is partially defeated by `updatedAt: Date.now()` injection.

4. **Error in Anchor decode stores raw data with error message:** Lines 609-619 store the error message in the protocol store (`decodeError: err.message`). Error messages from Anchor could contain internal details about the account data or program structure. These are broadcast via SSE to all connected clients.

#### /api/rpc (Risk 5 -- RPC PROXY)

**Positive security patterns:**
- Method allowlist (ALLOWED_METHODS Set)
- API key stays server-side (HELIUS_RPC_URL not exposed)
- Rate limiting (300/min)
- Sticky routing with failover (H047)
- Masked endpoint URLs in logs (hides API key)
- Credit recording per method

**Observations:**
1. **Batch amplification:** The proxy checks each method in a batch individually but places no upper bound on the array length. A request like `[{method:"getBalance",...}, ...(x10000)]` would be serialized and sent to Helius as-is. This could:
   - Burn Helius credits rapidly
   - Trigger Helius rate limits, blocking legitimate traffic
   - Exhaust server memory serializing the large response

2. **sendTransaction in allowlist:** This is intentional for the frontend to submit signed transactions, but it means the proxy is an open relay for any signed transaction. The proxy's IP address is the apparent origin to Helius.

3. **No body size limit:** The proxy reads `request.json()` with no size constraint. A multi-MB JSON-RPC payload would be fully parsed, consuming memory.

4. **Sticky routing leaks state across requests:** `lastSuccessfulEndpoint` is module-level state. If one user's request causes a failover, all subsequent users route to the new endpoint. This is generally desired but could be exploited: an attacker could force failover to a less-reliable endpoint by triggering 5xx responses on the primary (if they can influence the upstream).

#### /api/health (Risk 2 -- INFORMATION DISCLOSURE)

**Observations:**
1. **Always returns 200:** Even when Postgres is down or Solana RPC is unreachable, the HTTP status is 200. The body's `status` field is "degraded" but monitoring systems that only check HTTP status would miss failures. This is a documented design choice (H085 -- ACCEPTED_RISK) for Railway's container liveness check.

2. **Exposes internal details:** The response includes:
   - `wsSubscriber: {initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive}` -- reveals whether WS is connected, the last slot received, and whether fallback polling is active
   - `credits: {totalCalls, methodCounts: {getAccountInfo: N, ...}, startedAt}` -- reveals RPC usage patterns and server uptime
   - `checks: {postgres, solanaRpc}` -- reveals dependency status

   This gives an attacker a live view of the server's internal state. They can determine: when the server started, how many RPC calls have been made, whether the WS connection is healthy, what the current Solana slot is, and whether Postgres is up.

3. **No authentication:** The endpoint is completely public. Any browser or script can poll it.

#### /api/candles (Risk 2 -- DATABASE QUERY)

**Positive security patterns:**
- Parameterized Drizzle ORM queries
- Resolution validation against fixed Set
- Limit clamped to 1-2000 (prevents full table dump, AIP-078 pattern)
- Error responses are generic ("Internal server error")

**Observations:**
1. **No rate limiting:** Missing from this endpoint despite being a database-querying route. An attacker can rapidly request large time ranges at high resolution, potentially loading the database.

2. **Pool parameter not validated against known pools:** The `pool` query parameter accepts any string and passes it directly to the Drizzle `eq(candles.pool, pool)` filter. While this is injection-safe (parameterized), it means an attacker can query for non-existent pools, causing unnecessary database work. The cost is minimal but this is a defense-in-depth gap.

3. **Gap-fill can generate large responses:** When `gapfill=true` (default), the response can contain many synthetic candles for time ranges with no trades. For a 1-minute resolution over a 24-hour range with only 1 trade, the response would contain ~1440 candles. The 2000-candle limit on DB rows doesn't apply to gap-fill output.

#### /api/sol-price (Risk 1 -- EXTERNAL API PROXY)

**Positive security patterns:**
- Rate limiting (30/min)
- 60-second cache (shared across all clients)
- Fallback chain (CoinGecko -> Binance -> stale cache -> 502)
- 5-second timeouts on external calls (AbortSignal.timeout)
- Response shape validation (typeof price === "number" && Number.isFinite)

**Observations:**
1. Response includes `source` field revealing which provider was used. Minor information disclosure.
2. The `cached: true/false` and `stale: true/false` fields reveal server cache state. An attacker could use `cached: false` responses to determine when the 60-second cache expires and time their requests to force upstream calls.

#### /api/carnage-events (Risk 1 -- DATABASE QUERY)

**Positive security patterns:**
- Fixed limit (5 events, not configurable)
- Drizzle ORM parameterized query
- Generic error responses
- Excludes auto-increment `id` from response

**Observations:**
1. **No rate limiting:** An attacker can rapidly poll this endpoint. Impact is limited since the query is simple (LIMIT 5, ORDER BY DESC) and would hit the database's query cache.

### Security Header Analysis

**File:** `app/next.config.ts`

Headers applied to all routes:
- **CSP:** Strict with `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `object-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`. The `connect-src` allowlists Helius (cluster-appropriate), WalletConnect, and Sentry. `unsafe-inline` in script-src is needed for Next.js style injection -- this is a known tradeoff.
- **X-Frame-Options:** DENY (redundant with frame-ancestors 'none', but good defense-in-depth)
- **X-Content-Type-Options:** nosniff
- **Referrer-Policy:** strict-origin-when-cross-origin
- **Permissions-Policy:** Disables camera, microphone, geolocation
- **HSTS:** 2 years, includeSubDomains, preload (H026 fix confirmed intact)

**Assessment:** Strong header configuration. The `unsafe-inline` for scripts is the main weakness but is a known Next.js requirement.

**Gap:** No explicit CORS configuration. Next.js App Router defaults to same-origin for API routes, which is correct for this application. The H115 clearance from Audit #1 is still valid.

## Cross-Focus Intersections

### API-01 x CHAIN-02 (RPC Node Trust)
The RPC proxy forwards Helius responses to the browser without validation. If Helius returns manipulated account data (e.g., wrong balances), the frontend trusts it. The ws-subscriber also relies on Helius data for the protocol store. There is no cross-validation between the webhook pipeline and the RPC pipeline -- if they diverge, the frontend shows inconsistent state.

### API-01 x ERR-01 (Slot Availability)
The ws-subscriber's staleness monitor (15-second threshold) triggers HTTP fallback polling when the WS connection drops. This fallback increases HTTP RPC calls (1 getSlot every 5 seconds = 12/minute). The credit counter tracks these calls. If the WS connection is flaky (repeatedly connecting/disconnecting), the staleness monitor creates alternating poll/WS cycles, potentially doubling RPC credit consumption.

### API-01 x DATA-01 (Data Persistence)
The webhook handler writes to Postgres via Drizzle ORM. All queries are parameterized (OC-049 not applicable). The candle-aggregator upsert is called within the webhook handler's try/catch -- a candle aggregation failure is isolated and does not prevent the swap event from being stored. This is good error isolation.

### API-01 x INFRA-03 (Infrastructure)
The entire API layer assumes a single Next.js process. Rate limiting, SSE connection tracking, protocol store, and SSE manager all use in-memory state. If Railway scales to multiple instances, all of these break:
- Rate limits become per-instance (effectively multiplied by instance count)
- SSE connections are per-instance (one subscriber may miss events broadcast by another instance's webhook)
- Protocol store diverges between instances
- SSE manager has different subscriber sets per instance

The code documents this assumption but does not enforce it (no guard against multi-process operation).

## Cross-Reference Handoffs

| Handoff To | Item | Why |
|-----------|------|-----|
| ERR-02 | Webhook per-transaction error handling + logging | Error rates not tracked; flood of malformed TXs could fill logs silently |
| INFRA-03 | Single-process assumption for all in-memory state | Need verification that Railway won't auto-scale to multiple instances |
| DATA-01 | candle-aggregator upsert race conditions under concurrent webhooks | Multiple webhook deliveries for same time bucket could race |
| SEC-02 | Webhook secret rotation mechanism | No rotation support; compromise requires full re-registration |
| CHAIN-02 | RPC proxy blindly forwards upstream responses | No validation of Helius response integrity |
| ERR-03 | Rate limit effectiveness under load | Need load testing to verify 300/min RPC limit handles launch-day traffic |
| WEB-02 | CSP unsafe-inline for scripts | Known Next.js requirement but still a XSS vector reduction |
| LOGIC-01 | Protocol store dedup defeated by updatedAt timestamp | Business logic question: should updatedAt be injected server-side or use Helius timestamps? |

## Risk Observations

### HIGH

1. **RPC Proxy Batch Amplification** -- `app/app/api/rpc/route.ts:103-106`
   - **What:** No upper limit on JSON-RPC batch array size
   - **Impact:** Helius credit exhaustion, upstream rate limiting, server memory exhaustion
   - **Likelihood:** Possible (attacker needs to know the endpoint exists and accepts batches)
   - **Recommendation:** Add `MAX_BATCH_SIZE` constant (e.g., 20) and reject batches exceeding it

2. **Webhook Body Size Bypass** -- `app/app/api/webhooks/helius/route.ts:309-315`
   - **What:** Content-length check bypassed by omitting the header or using chunked encoding
   - **Impact:** Memory exhaustion from oversized payloads if Next.js doesn't enforce its own limit
   - **Likelihood:** Possible (requires authentication to exploit, reducing attacker pool to Helius secret holders)
   - **Recommendation:** Read body into buffer with explicit size cap before parsing, OR implement streaming body size check

### MEDIUM

3. **Health Endpoint Information Disclosure** -- `app/app/api/health/route.ts:66-72`
   - **What:** Internal wsSubscriber status, credit stats, timing data exposed publicly
   - **Impact:** Attacker can fingerprint infrastructure state, determine uptime, monitor RPC usage
   - **Likelihood:** Probable (endpoint is public, easy to discover)
   - **Recommendation:** Split into two endpoints: public liveness (status only) and internal diagnostics (with basic auth or IP allowlist)

4. **Missing Rate Limiting on DB Endpoints** -- `app/app/api/candles/route.ts`, `app/app/api/carnage-events/route.ts`
   - **What:** No rate limiting on GET /api/candles and GET /api/carnage-events
   - **Impact:** Database load from rapid querying. /api/candles is higher risk due to configurable parameters
   - **Likelihood:** Possible (endpoints are public)
   - **Recommendation:** Add rate limiting (e.g., 60/min for candles, 30/min for carnage-events)

5. **Protocol Store Dedup Partially Defeated** -- `app/app/api/webhooks/helius/route.ts:603-606`
   - **What:** `updatedAt: Date.now()` injected into account state ensures every write is unique, bypassing dedup
   - **Impact:** Every webhook delivery triggers SSE broadcast even if account data hasn't changed
   - **Likelihood:** Probable (normal Helius behavior sends duplicate notifications)
   - **Recommendation:** Move updatedAt to a separate metadata field that's excluded from dedup comparison

6. **SSE Candles Route Receives All Broadcasts** -- `app/app/api/sse/candles/route.ts:71-78`
   - **What:** The subscriber callback receives all SSE events, including protocol-update events
   - **Impact:** Unnecessary bandwidth to candle-only clients. Protocol data (account states) leaked to chart consumers
   - **Likelihood:** Probable (architectural, happens on every protocol-update broadcast)
   - **Recommendation:** Add event-type filter to candles route subscriber (like protocol route does at line 84)

7. **Anchor Decode Error Messages in SSE Broadcast** -- `app/app/api/webhooks/helius/route.ts:617`
   - **What:** `decodeError: err.message` stored in protocol store and broadcast via SSE
   - **Impact:** Internal error details (potentially program layout info) exposed to all SSE clients
   - **Likelihood:** Unlikely (requires Anchor decode failure, which is rare for valid protocol accounts)
   - **Recommendation:** Replace err.message with a generic "decode_failed" string in the broadcast

### LOW

8. **Webhook Response Leaks Processing Counts** -- `app/app/api/webhooks/helius/route.ts:490-498`
   - **What:** Response includes transaction/swap/epoch/carnage counts
   - **Impact:** Helps attacker verify whether forged payloads are being processed
   - **Likelihood:** Low (attacker must have webhook secret to see the response)

9. **RPC Proxy sendTransaction as Open Relay** -- `app/app/api/rpc/route.ts:44`
   - **What:** Any browser can submit pre-signed transactions through the proxy
   - **Impact:** Server IP is apparent origin of all submitted transactions; Helius credits consumed
   - **Likelihood:** Low (transactions must be validly signed; proxy cannot create new signatures)

10. **SOL Price Response Reveals Cache State** -- `app/app/api/sol-price/route.ts:97-101, 117-122`
    - **What:** `cached: true/false` and `stale: true/false` fields in response
    - **Impact:** Minor information disclosure about server cache timing
    - **Likelihood:** Low (minimal attacker value)

11. **Protocol Store getAllAccountStates Includes Synthetic Keys** -- `app/app/api/sse/protocol/route.ts:71`
    - **What:** Initial SSE snapshot includes `__slot`, `__supply:*`, `__staking:globalStats`
    - **Impact:** Server-side polling data exposed to browsers. Data is non-sensitive (public chain data) but reveals server's polling infrastructure
    - **Likelihood:** Probable (happens on every SSE connection)

12. **Candle Gap-Fill Can Inflate Response Size** -- `app/app/api/candles/route.ts:94-167`
    - **What:** Gap-fill logic generates synthetic candles between real data points, potentially multiplying response size beyond the DB row limit
    - **Impact:** Large responses for sparse data ranges
    - **Likelihood:** Possible (1-minute resolution over 24 hours with few trades)

13. **RPC Proxy No Body Size Limit** -- `app/app/api/rpc/route.ts:93-94`
    - **What:** `request.json()` called without body size constraint
    - **Impact:** Multi-MB JSON-RPC payloads could be parsed, consuming server memory
    - **Likelihood:** Low (rate limiting provides partial protection)

14. **Credit Counter Has No Reset Protection** -- `app/lib/credit-counter.ts:49-54`
    - **What:** `resetStats()` method exists and could be called from imported code
    - **Impact:** If accidentally called, monitoring data is lost
    - **Likelihood:** Very low (method is public but not exposed to any route)

## Novel Attack Surface Observations

1. **Webhook-to-SSE amplification attack:** An attacker who obtains the webhook secret (or if the secret is weak/leaked) could send crafted payloads that trigger maximum SSE broadcast volume. Each "account change" payload with a known protocol address (public information) would be Anchor-decoded, stored, and broadcast to all 5000 potential SSE clients. With 120 requests/min (rate limit), each containing 8 known protocol accounts, that's 960 protocol store writes and SSE broadcasts per minute. Each broadcast iterates up to 5000 subscribers. This creates 4.8 million callback invocations per minute from a single attacker. The in-memory nature of the subscriber set means this is pure CPU load with no I/O bottleneck to slow it down.

2. **RPC batch + sendTransaction credit drain:** An attacker could construct a single HTTP POST to /api/rpc containing a batch array of 1000 `sendTransaction` calls, each with a different (invalid) signed transaction. The proxy forwards the entire batch to Helius, consuming 1000 RPC credits per HTTP request. At 300 requests/min rate limit, this allows 300,000 RPC credit burns per minute. Even with only 10 requests/min (conservative attacker), this is 10,000 credits per minute. Helius credits are limited; this could exhaust the project's allocation.

3. **SSE connection + webhook payload timing attack:** An attacker could correlate the timing of SSE events received on their browser with the timing of on-chain transactions they observe on the Solana explorer. By comparing the SSE event `updatedAt` timestamps with on-chain slot timing, they could estimate the server-side processing latency. This information could be used to time competitive transactions (e.g., front-running Carnage fund operations by detecting the Carnage event in the SSE stream before it appears in public mempool explorers).

## Questions for Other Focus Areas

1. **DATA-01:** What is the maximum candle table size? Are there any retention/cleanup policies for old candle data? Could the gap-fill query become expensive as the table grows?
2. **INFRA-03:** Does Railway auto-scale the Next.js instance? If so, all in-memory state becomes unreliable.
3. **ERR-02:** What happens if the Postgres connection pool is exhausted during a webhook burst? The webhook handler catches errors per-transaction but does not track error rates or implement circuit breaker logic.
4. **CHAIN-01:** The ws-subscriber opens a WebSocket to Helius at boot time. What happens if the WebSocket connection is established to a different Helius node than the HTTP RPC endpoint? Could this cause state inconsistency?
5. **SEC-02:** Is the HELIUS_WEBHOOK_SECRET sufficiently high-entropy? The timing-safe comparison is meaningless if the secret is short or predictable.

## Raw Notes

### Audit #1 Finding Recheck Status

| Finding | Status | Notes |
|---------|--------|-------|
| H001 (Webhook Auth Bypass) | **FIX INTACT** | Fail-closed + timingSafeEqual still in place. Rate limiting added. |
| H008 (SSE Amplification DoS) | **FIX INTACT** | Connection caps at 10/IP, 5000 global. Auto-release at 30 min. |
| H009 (Devnet Fallback in Production) | **FIX INTACT** | `resolveRpcUrl()` throws on missing server env vars. No hardcoded fallback. |
| H023 (SSE Connection Exhaustion) | **FIX INTACT** | Same as H008 -- connection limits enforced before stream creation. |
| H024 (No Rate Limiting) | **FIX INTACT** | Rate limiting on webhook (120/min), rpc (300/min), sol-price (30/min). Candles and carnage-events still unprotected. |
| H026 (Missing HSTS) | **FIX INTACT** | HSTS header with 2-year max-age, includeSubDomains, preload. |
| H047 (Single RPC No Failover) | **FIX INTACT** | 3-endpoint failover with sticky routing in rpc/route.ts. |
| H049 (Webhook No Replay Protection) | **FIX INTACT** | 5-minute stale TX filter. Enhanced account changes not time-gated (by design). |
| H050 (Webhook No Body Size Limit) | **PARTIAL REGRESSION** | Content-length check exists but bypassable by omitting header. |
| H085 (Health Always 200) | **ACCEPTED_RISK UNCHANGED** | Still returns 200 regardless of dependency state. |
| H092 (SSE Single-Process Only) | **FIX INTACT** | Documented as single-process. No multi-process guard added. |
| H028 (Health Info Disclosure) | **NOT FIXED** | Now exposes MORE info (wsSubscriber, creditCounter). |
