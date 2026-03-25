---
task_id: db-phase1-api-04
provides: [api-04-findings, api-04-invariants]
focus_area: api-04
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/lib/rate-limit.ts, app/lib/sse-manager.ts, app/lib/sse-connections.ts, app/lib/protocol-store.ts, app/lib/event-parser.ts, app/lib/bigint-json.ts, app/lib/ws-subscriber.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/app/api/rpc/route.ts, app/instrumentation.ts, app/hooks/useProtocolState.ts, app/hooks/useChartSSE.ts, app/lib/swap/hook-resolver.ts, app/lib/curve/hook-accounts.ts, app/lib/swap/multi-hop-builder.ts, app/db/candle-aggregator.ts, app/db/connection.ts, app/db/schema.ts, scripts/webhook-manage.ts, app/lib/protocol-config.ts, app/lib/connection.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 6}
---
<!-- CONDENSED_SUMMARY_START -->
# API-04: Webhook & Callback Security -- Condensed Summary

## Key Findings (Top 10)
- **Webhook auth uses simple Authorization header equality, not HMAC-SHA256**: The webhook handler compares `req.headers.get("authorization")` against `HELIUS_WEBHOOK_SECRET` using `timingSafeEqual`. Helius sends the secret directly as `Authorization: <secret>` (plain bearer comparison), NOT as an HMAC signature over the body. This means the secret is sent in cleartext over HTTPS in every request. The webhook body is NOT signed and NOT verifiable for integrity. -- `app/app/api/webhooks/helius/route.ts:286-301`
- **No replay protection for Enhanced Account Change webhooks**: The H049 replay guard (MAX_TX_AGE_SECONDS=300) only applies to the raw transaction path. Enhanced Account Change webhook payloads skip this check entirely -- any replayed enhanced webhook payload would be accepted and overwrite in-memory state. -- `app/app/api/webhooks/helius/route.ts:340-341`
- **Content-Length check is bypassable**: Body size enforcement relies on the `Content-Length` header (`req.headers.get("content-length")`), which is set by the client. An attacker can send a small Content-Length header with a large body via chunked transfer encoding. `req.json()` will still parse the full body. -- `app/app/api/webhooks/helius/route.ts:308-315`
- **Rate limit key uses IP:endpoint, shared across webhook types**: Both raw TX webhooks and enhanced account change webhooks share the same `webhook` rate limit bucket (120 req/min). A flood of enhanced account change payloads could exhaust the rate limit, blocking legitimate raw TX webhooks from being processed. -- `app/app/api/webhooks/helius/route.ts:257-264`
- **Webhook response leaks processing counts**: The 200 response includes `{ ok: true, processed: { transactions, swaps, epochs, carnages } }`. This confirms webhook is active and reveals internal event processing metrics. -- `app/app/api/webhooks/helius/route.ts:490-498`
- **SSE candle route forwards ALL events, not just candles**: The `/api/sse/candles` route subscribes to sseManager without filtering. It receives both `candle-update` and `protocol-update` events. While the client-side EventSource listener only registers for `candle-update`, the raw SSE stream contains protocol state updates. -- `app/app/api/sse/candles/route.ts:71-75`
- **Protocol store accepts arbitrary keys (no validation)**: `setAccountState(pubkey, data)` accepts any string as key and any object as data. The webhook handler validates against `KNOWN_PROTOCOL_ACCOUNTS` before calling it, but if other code paths call `setAccountState` with attacker-influenced keys, the entire SSE broadcast pipeline is affected. -- `app/lib/protocol-store.ts:53-65`
- **BigInt JSON reviver creates BigInt from untrusted strings**: `bigintReviver` calls `BigInt(value.__bigint)` where `value.__bigint` comes from SSE data. If an attacker can inject SSE events, they could send extremely large BigInt strings causing CPU exhaustion. The `__bigint` tag format could collide with legitimate data. -- `app/lib/bigint-json.ts:46-51`
- **Webhook manage script logs API key in URL**: `heliusRequest` constructs URL as `${HELIUS_API_BASE}${path}?api-key=${HELIUS_API_KEY}`. The full URL (including API key) is visible in error output via `JSON.stringify(data)`. -- `scripts/webhook-manage.ts:87`
- **SSE connection tracker uses globalThis state without mutex**: `acquireConnection` reads and writes `state.globalCount` and `state.connections` non-atomically. In theory, Node.js is single-threaded so this is safe, but Next.js Edge runtime or Worker threads could create race conditions. -- `app/lib/sse-connections.ts:49-57`

## Critical Mechanisms
- **Webhook Authentication Chain**: Helius sends `Authorization: <secret>` header. Server compares with `timingSafeEqual` after ensuring length-safe comparison. Fail-closed in production (missing secret = 500). Non-production skips auth if secret unset. -- `app/app/api/webhooks/helius/route.ts:266-302`
- **Webhook->DB->SSE Pipeline**: Webhook receives Helius payload -> parses events (event-parser.ts) -> stores in Postgres (swap_events/epoch_events/carnage_events via Drizzle ORM onConflictDoNothing) -> upserts candles -> broadcasts to SSE subscribers. Each stage has error isolation (try/catch per transaction). -- `app/app/api/webhooks/helius/route.ts:358-486`
- **Enhanced Account Change Pipeline**: Webhook receives account data -> identifies known PDAs by address -> Anchor-decodes raw account data -> stores in protocol-store (in-memory) -> dedup check -> SSE broadcast to all subscribers. -- `app/app/api/webhooks/helius/route.ts:525-633`
- **SSE Connection Lifecycle**: Client opens EventSource -> server acquires connection slot (per-IP limit 10, global limit 5000) -> sends initial state snapshot -> subscribes to sseManager -> heartbeat every 15s -> auto-release after 30min -> cleanup on abort signal. -- `app/app/api/sse/protocol/route.ts:41-136`
- **Transfer Hook Account Resolution**: Deterministic PDA derivation (no RPC calls). 4 accounts per mint: ExtraAccountMetaList, source whitelist, dest whitelist, hook program ID. Used by both AMM swap builders and bonding curve builders. -- `app/lib/swap/hook-resolver.ts:46-78` and `app/lib/curve/hook-accounts.ts:36-68`

## Invariants & Assumptions
- INVARIANT: Webhook secret MUST be set in production (NODE_ENV=production) -- enforced at `app/app/api/webhooks/helius/route.ts:273-284` (fail-closed 500)
- INVARIANT: Swap events are idempotent via TX signature primary key + onConflictDoNothing -- enforced at `app/app/api/webhooks/helius/route.ts:664-681`
- INVARIANT: Epoch events are idempotent via unique index on epoch_number + onConflictDoNothing -- enforced at `app/app/api/webhooks/helius/route.ts:783-797`
- INVARIANT: SSE connections are capped per-IP (10) and globally (5000) -- enforced at `app/lib/sse-connections.ts:49-57`
- INVARIANT: Transfer hook accounts are exactly 4 per Token-2022 mint -- enforced by deterministic PDA derivation at `app/lib/swap/hook-resolver.ts:54-77`
- ASSUMPTION: Helius webhooks are delivered over HTTPS (TLS-protected) -- UNVALIDATED (depends on Helius infrastructure)
- ASSUMPTION: `x-forwarded-for` header from Railway proxy is trustworthy -- UNVALIDATED (rate limiting depends on this) `app/lib/rate-limit.ts:129-151`
- ASSUMPTION: Helius delivers webhooks within 5 minutes of block time -- UNVALIDATED (staleness check assumes this) `app/app/api/webhooks/helius/route.ts:361`
- ASSUMPTION: In-memory protocol store survives across requests (single process) -- validated for Railway single-instance deployment but NOT for horizontal scaling

## Risk Observations (Prioritized)
1. **Content-Length bypass for body size limit (H050)**: `app/app/api/webhooks/helius/route.ts:308-315` -- Content-Length header is client-controlled. Chunked transfer encoding bypasses this check. Could allow memory exhaustion. The actual body is read by `req.json()` regardless of the Content-Length header value.
2. **Enhanced webhooks have no replay protection**: `app/app/api/webhooks/helius/route.ts:340-341` -- An attacker who captures a valid enhanced webhook payload could replay it to overwrite in-memory protocol state with stale data. Unlike raw TX webhooks which have the 5-minute blockTime check, enhanced webhooks bypass this entirely.
3. **Candle SSE route leaks protocol state**: `app/app/api/sse/candles/route.ts:71-75` -- The subscriber receives ALL sseManager events. Although the browser EventSource listener only processes `candle-update` events, the full SSE stream is visible in browser dev tools. Protocol state updates (EpochState, PoolState, etc.) flow through this route.
4. **Rate limit bucket collision between webhook types**: `app/app/api/webhooks/helius/route.ts:257-264` -- Helius sends both raw TX and enhanced account change webhooks to the same endpoint. A burst of one type could rate-limit the other. This is especially concerning since Helius cannot control its delivery rate.
5. **No maximum array length on webhook payload**: `app/app/api/webhooks/helius/route.ts:329-334` -- After parsing JSON, the code checks `Array.isArray(payload)` but does not limit array length. A payload with millions of elements (each small) could cause CPU exhaustion in the processing loop.
6. **Webhook manage script exposes API key in error messages**: `scripts/webhook-manage.ts:87-103` -- The Helius API key is included in the URL query string and could be logged in error output. This is a deployment-time script, not production runtime, reducing severity.

## Novel Attack Surface
- **Webhook type confusion**: An attacker could send a payload that straddles both raw TX and enhanced account change formats (e.g., first element has both `accountData` and `signature` fields). The type discrimination logic (`"accountData" in firstItem`) would route it to the enhanced handler, potentially bypassing raw TX validation. Since enhanced webhooks skip replay protection and have less validation, this could be used to inject crafted data.
- **SSE broadcast amplification via protocol store dedup bypass**: The protocol store dedup compares serialized JSON. If an attacker can cause Helius to deliver account data that serializes differently (e.g., field ordering changes) but represents the same state, each delivery triggers a broadcast to all SSE clients. With many subscribers, this amplifies minimal webhook traffic into significant outbound bandwidth.
- **Candle price manipulation via crafted webhook payloads**: If an attacker obtains the webhook secret, they can send crafted TaxedSwap events with extreme prices. These update the OHLCV candles (via upsertCandlesForSwap) and broadcast to all chart clients. The candle upsert uses `GREATEST`/`LEAST` for high/low, so a single extreme-price event permanently corrupts the candle high/low for that bucket.

## Cross-Focus Handoffs
- -> **SEC-01**: Webhook secret rotation -- there is no support for multiple secrets or graceful rotation. Rotating the secret requires simultaneous Helius webhook update + Railway env var update with zero downtime window.
- -> **SEC-02**: `HELIUS_WEBHOOK_SECRET` is stored as a plain environment variable. If Railway environment is compromised (H132 accepted risk), the webhook is fully controllable.
- -> **ERR-01**: Webhook handler error isolation -- a DB connection failure during swap storage (`storeTaxedSwap`) throws through the per-TX try/catch but processing continues. Need to verify DB reconnection behavior after transient failures.
- -> **CHAIN-02**: Enhanced webhook account decoding -- the Anchor coder decodes raw base64 account data. If account layout changes between program upgrades, the decode could produce incorrect field values that propagate through SSE to all clients.
- -> **DATA-01**: Database write idempotency relies on Drizzle ORM `onConflictDoNothing`. Verify the underlying Postgres constraint (TX signature PK, epoch_number unique index) is correctly applied.
- -> **INFRA-03**: SSE connection limits (10/IP, 5000 global) -- verify Railway's nginx proxy doesn't have its own connection limits that conflict.

## Trust Boundaries
The webhook endpoint is the primary external data ingestion point for the entire off-chain system. Helius is a semi-trusted third party: the system trusts Helius to deliver valid Solana transaction and account data, but authenticates Helius via a shared secret. The webhook secret provides identity verification (is this Helius?) but not payload integrity (was this data tampered with?). This is acceptable because Helius delivers over HTTPS, but introduces a single-secret trust model with no rotation mechanism. The SSE pipeline is an internal boundary: data flows from webhook -> protocol store -> SSE manager -> browser clients. The protocol store acts as a trust gate: it only accepts updates from server-side code paths (webhook handler, ws-subscriber). SSE clients are read-only consumers. The transfer hook account resolution is a client-side trust boundary: PDA derivation is deterministic and does not depend on external data, making it immune to webhook-based manipulation.
<!-- CONDENSED_SUMMARY_END -->

---

# API-04: Webhook & Callback Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth codebase has a single webhook endpoint (`/api/webhooks/helius`) that serves as the primary external data ingestion point for all off-chain systems. This endpoint handles two distinct Helius webhook types (raw transactions and enhanced account changes) through a single route with type discrimination. The authentication model uses a shared plaintext secret (not HMAC signing), which provides identity verification over HTTPS but not cryptographic payload integrity. The webhook feeds three downstream systems: PostgreSQL (swap/epoch/carnage events and OHLCV candles), an in-memory protocol state store, and real-time SSE broadcasts to browser clients.

The implementation shows strong security awareness (fail-closed auth in production, timing-safe comparison, idempotent DB writes, rate limiting, per-TX error isolation). However, there are meaningful gaps: the body size limit is bypassable via Content-Length manipulation, enhanced account change webhooks lack replay protection, the SSE candle route leaks protocol state updates, and there is no webhook secret rotation mechanism.

The transfer hook account resolution code (`hook-resolver.ts`, `hook-accounts.ts`) uses deterministic PDA derivation with no external data dependencies, making it structurally secure from a webhook/callback perspective. The `multi-hop-builder.ts` fetches the Address Lookup Table but this is a read operation from on-chain data, not a callback pattern.

## Scope

### Files Analyzed (Full Source Read - Layer 3)
1. `app/app/api/webhooks/helius/route.ts` (851 LOC) -- Primary webhook handler, two data paths
2. `app/lib/rate-limit.ts` (182 LOC) -- Rate limiting infrastructure
3. `app/lib/sse-manager.ts` (93 LOC) -- SSE pub/sub singleton
4. `app/lib/sse-connections.ts` (119 LOC) -- SSE connection tracking
5. `app/lib/protocol-store.ts` (126 LOC) -- In-memory protocol state cache
6. `app/lib/event-parser.ts` (383 LOC) -- Anchor event parsing
7. `app/lib/bigint-json.ts` (118 LOC) -- BigInt serialization
8. `app/lib/ws-subscriber.ts` (496 LOC) -- Server-side WS data pipeline
9. `app/app/api/sse/protocol/route.ts` (137 LOC) -- SSE protocol streaming
10. `app/app/api/sse/candles/route.ts` (125 LOC) -- SSE candle streaming
11. `scripts/webhook-manage.ts` (256 LOC) -- Webhook management script

### Files Analyzed (Signature Scan - Layer 2)
12. `app/app/api/rpc/route.ts` (188 LOC) -- RPC proxy (rate limited, method allowlist)
13. `app/hooks/useProtocolState.ts` (365 LOC) -- SSE client hook
14. `app/hooks/useChartSSE.ts` (109 LOC) -- SSE candle client hook
15. `app/lib/swap/hook-resolver.ts` (79 LOC) -- Transfer hook PDA resolution
16. `app/lib/curve/hook-accounts.ts` (69 LOC) -- Curve hook PDA resolution
17. `app/lib/swap/multi-hop-builder.ts` (417 LOC) -- Atomic multi-hop builder
18. `app/db/candle-aggregator.ts` (210 LOC) -- OHLCV candle upserts
19. `app/db/connection.ts` (103 LOC) -- Database connection singleton
20. `app/db/schema.ts` (80+ LOC) -- Database schema
21. `app/instrumentation.ts` (30 LOC) -- Server boot hook
22. `app/lib/protocol-config.ts` (74 LOC) -- Cluster-aware address resolution
23. `app/lib/connection.ts` (not read, noted as dependency)

## Key Mechanisms

### 1. Webhook Authentication (route.ts:266-302)

The authentication chain:
1. Read `HELIUS_WEBHOOK_SECRET` from env
2. In production, if secret is unset, return 500 (fail-closed)
3. If secret is set, compare `Authorization` header with `timingSafeEqual`
4. Length mismatch: compare secret against itself to avoid timing leak, then reject

**5 Whys:**
1. Why does the auth check exist? To prevent unauthorized data injection into the DB and SSE pipeline (H001 fix).
2. Why timingSafeEqual instead of `===`? Prevents byte-by-byte timing side-channel (an attacker measuring response times could guess the secret character by character with `===`).
3. Why compare secret against itself on length mismatch? To ensure the timing of the comparison is identical regardless of whether lengths match (prevents length oracle attack).
4. Why use Authorization header instead of HMAC body signature? Helius' webhook API supports `authHeader` field which sets a custom Authorization header. This is Helius' standard mechanism.
5. Why would this fail? If the HELIUS_WEBHOOK_SECRET env var is deleted in Railway without simultaneously unregistering the webhook, production would return 500 on all webhooks (fail-closed, correct behavior).

**5 Hows:**
1. How does this work? Plain secret comparison -- Helius includes the secret as Authorization header, server compares.
2. How could this be exploited? Secret theft (env var access, H132) gives full control. No payload integrity -- MITM between Helius and Railway could modify body while keeping valid header.
3. How does this interact with other components? Auth is the first gate. Everything downstream (DB writes, SSE broadcasts, candle aggregation) trusts data that passes this check.
4. How could this fail? Railway deploys sometimes restart without env vars being loaded immediately. A transient window could see production running without the secret.
5. How would an attacker approach this? Obtain the secret (social engineering Railway access, leaked logs, env dump) then send crafted payloads to manipulate chart data, protocol state, or flood the DB.

### 2. Webhook Payload Discrimination (route.ts:336-351)

The handler discriminates between two Helius webhook types:
- Enhanced Account Change: first element has `accountData` property
- Raw Transaction: everything else

```
const firstItem = payload[0] as Record<string, unknown> | undefined;
if (firstItem && "accountData" in firstItem) {
  return handleAccountChanges(payload as HeliusAccountChange[]);
}
```

**Concern:** This uses duck-typing on untrusted input. An attacker who passes auth could craft a payload that satisfies the `accountData` check but contains unexpected data structures, potentially bypassing validation specific to raw transactions.

### 3. Raw Transaction Processing (route.ts:358-486)

For each transaction in the batch:
1. Extract signature from `tx.signature` or `tx.transaction.signatures[0]`
2. Skip if error, no logs, or no signature
3. H049 replay check: skip if `blockTime` > 300s old
4. Parse swap events via `parseSwapEvents(logMessages)`
5. Store taxed/untaxed swaps in DB (onConflictDoNothing)
6. Upsert candles at all 6 resolutions
7. Broadcast candle updates to SSE
8. Parse and store epoch/carnage events similarly

**Key observations:**
- Error isolation per transaction: one bad TX doesn't block the batch
- Candle errors don't block swap storage (separate try/catch)
- blockTime null check: if blockTime is undefined, replay check is skipped (line 380-388). Attacker with auth could craft TX payload without blockTime to bypass replay protection.
- Anchor EventParser creates fresh instances per call (stateless, correct)

### 4. Enhanced Account Change Processing (route.ts:525-633)

For each account in the batch:
1. Look up pubkey in `KNOWN_PROTOCOL_ACCOUNTS` -- unknown accounts logged and skipped
2. Look up decode config in `ANCHOR_DECODE_MAP`
3. SystemAccounts (CarnageSolVault): store lamports directly
4. Anchor accounts: decode from base64 raw data using appropriate program coder
5. Normalize with `anchorToJson` (BN->number, PublicKey->base58)
6. Store in protocolStore (triggers SSE broadcast)

**Key observations:**
- NO replay protection (no timestamp check on enhanced webhooks)
- No staleness detection -- stale account data overwrites current
- Anchor decode could throw on corrupted/unexpected data -- caught and stored as raw with error flag (good)
- Programs are lazy-initialized once per batch (good for performance)
- Unknown accounts are warned but not rate-limited

### 5. SSE Broadcast Pipeline

Data flow: webhook -> protocolStore.setAccountState() -> dedup check -> sseManager.broadcast() -> subscriber callbacks -> ReadableStream controller.enqueue()

**Dedup mechanism** (protocol-store.ts:57-58): JSON.stringify comparison against last broadcast. This prevents redundant broadcasts but is sensitive to serialization ordering -- objects with different key ordering but identical values would bypass dedup.

**SSE manager** (sse-manager.ts:60-70): Iterates subscriber Set, calls each callback. Failed callbacks (disconnected clients) are silently removed. No batching -- each webhook event triggers immediate iteration over all subscribers.

**Connection management** (sse-connections.ts): Per-IP limit (10), global limit (5000), auto-release after 30 minutes. State is globalThis singleton. `acquireConnection`/`releaseConnection` are not atomic but safe due to Node.js single-thread.

### 6. Rate Limiting (rate-limit.ts)

Sliding window algorithm per `IP:endpoint` key. Webhook config: 120 req/min. Periodic cleanup every 60s removes entries older than 5 minutes.

**IP extraction** (rate-limit.ts:129-151): Uses `x-forwarded-for` (first IP) or `x-real-ip`. Falls back to "unknown" with production warning.

**Concern:** All "unknown" IPs share a single bucket. In a misconfigured reverse proxy scenario, all Helius webhooks would share one bucket, making the rate limit effectively meaningless.

### 7. Transfer Hook Account Resolution

`hook-resolver.ts` and `hook-accounts.ts` use `PublicKey.findProgramAddressSync` with deterministic seeds. No external data dependencies, no RPC calls, no callback patterns. These are structurally secure for the API-04 focus area.

## Trust Model

### External Trust Boundaries
1. **Helius -> Webhook endpoint**: Semi-trusted. Helius is a commercial RPC provider. The system trusts Helius to deliver valid Solana data. Authentication is shared-secret based (not cryptographic payload signing). The trust model is: "If you know the secret, you are Helius."

2. **Browser -> SSE endpoints**: Untrusted read-only. Browsers connect to SSE streams and receive protocol state. No authentication required for SSE (public data). Connection-limited to prevent resource exhaustion.

3. **Browser -> RPC proxy**: Untrusted with method allowlist. Browser sends JSON-RPC requests, server validates method against allowlist before forwarding to Helius.

### Internal Trust Boundaries
4. **Webhook handler -> Protocol Store**: Trusted. Webhook handler is the only write path for enhanced account changes. ws-subscriber also writes (via batch seed and polling).

5. **Protocol Store -> SSE Manager -> Browsers**: One-way data flow. Store broadcasts via manager, clients receive. No back-channel.

6. **Webhook handler -> Database**: Trusted. All DB writes use parameterized Drizzle ORM queries (no SQL injection). Idempotency via conflict resolution.

## State Analysis

### Persistent State (PostgreSQL)
- `swap_events`: Keyed on TX signature (natural idempotency). Stores parsed swap data.
- `epoch_events`: Unique index on epoch_number. Stores tax rate snapshots.
- `carnage_events`: Unique index on epoch_number. Stores Carnage execution traces.
- `candles`: Composite unique on (pool, resolution, open_time). OHLCV aggregation.

### In-Memory State
- `protocolStore`: Map<string, AccountState>. Stores latest account data for all protocol PDAs. Volatile -- lost on process restart, re-seeded by ws-subscriber batch seed.
- `sseManager`: Set<SSECallback>. Active subscriber callbacks. Volatile.
- `sseConnState`: { connections: Map<string, number>, globalCount: number }. Connection tracking. Volatile.
- `rate-limit entries`: Map<string, RateLimitEntry>. IP-based rate counters. Volatile.
- `ws-subscriber state`: WsSubscriberState. Slot tracking, poll timers. Volatile.
- `cachedALT`: AddressLookupTableAccount. ALT cache for multi-hop builder. Volatile.

### State Corruption Scenarios
1. Protocol store data corruption via replayed enhanced webhooks (stale account data overwrites current)
2. Rate limit state lost on process restart (brief window of unlimited requests)
3. SSE connection count drift if release is called without matching acquire (mitigated by `Math.max(0, ...)`)

## Dependencies

### External Service Dependencies
- **Helius API**: Webhook delivery (raw + enhanced), RPC proxy upstream, WebSocket slot subscription
- **PostgreSQL (Railway)**: Event storage, candle aggregation
- **Solana RPC**: Account data, token supply, program accounts

### Package Dependencies (Security-Relevant)
- `@coral-xyz/anchor`: BorshCoder for event parsing and account decoding
- `postgres`: PostgreSQL driver (postgres.js)
- `drizzle-orm`: ORM with parameterized queries (prevents SQL injection)

## Focus-Specific Analysis

### Webhook Signature Verification

**Current implementation**: Plain secret comparison (not HMAC).

Helius' webhook system sends the configured `authHeader` value directly as the `Authorization` header in each webhook delivery. The server compares this against `HELIUS_WEBHOOK_SECRET`.

This is NOT the same as HMAC-SHA256 body signing (used by Stripe, GitHub, etc.). The security implications:
- **Identity verification**: YES -- only someone with the secret can trigger the webhook handler
- **Payload integrity**: NO -- a MITM or attacker with the secret can modify the body
- **Replay protection (raw TX)**: PARTIAL -- blockTime check provides a 5-minute window
- **Replay protection (enhanced)**: NONE -- no timestamp or sequence check

**Assessment**: This matches Helius' documented webhook authentication mechanism. The project correctly implements what Helius provides. The lack of HMAC signing is a Helius design limitation, not a project bug. However, the project should be aware that payload integrity is not guaranteed.

### Replay Attack Surface

**Raw transactions** (route.ts:377-388):
```
if (blockTime != null) {
  const age = Math.floor(Date.now() / 1000) - blockTime;
  if (age > MAX_TX_AGE_SECONDS) { ... continue; }
}
```
- Window: 5 minutes (300 seconds)
- Bypass: omit `blockTime` from payload -- check skips when `blockTime == null`
- DB protection: `onConflictDoNothing` means replayed TX signatures are ignored
- Candle impact: replayed candles are idempotent (same upsert logic)

**Enhanced account changes** (route.ts:340-341):
- No replay protection at all
- Impact: stale account data overwrites current in protocolStore
- Downstream: SSE clients receive stale data
- Severity: MEDIUM -- data is display-only, on-chain enforcement prevents financial harm

### Idempotency Analysis

**swap_events**: TX signature as PK + `onConflictDoNothing`. Fully idempotent. Same TX processed twice = no-op on second insert.

**epoch_events**: unique index on `epoch_number` + `onConflictDoNothing`. Fully idempotent per epoch. If two TXs in the same epoch produce different events, first-write-wins (acceptable -- both are valid).

**carnage_events**: unique index on `epoch_number` + `onConflictDoNothing`. Same as epoch_events.

**candles**: Composite unique on (pool, resolution, open_time) + `onConflictDoUpdate`. NOT fully idempotent -- replayed events increment `tradeCount` and `volume`. However, `open` is never overwritten and `close` is last-write-wins. Replay attack on candles would inflate volume and trade count but not corrupt prices (OHLC).

**protocol store**: Last-write-wins. NOT idempotent for replay -- stale data overwrites current. Dedup prevents duplicate broadcasts of identical data, but doesn't prevent stale overwrites.

### SSRF Analysis

There are NO user-configurable webhook URLs in the production codebase. The webhook URL is:
1. Set in Helius via `scripts/webhook-manage.ts` using the `WEBHOOK_URL` env var
2. Hardcoded in the registration API call
3. Not configurable from any user-facing endpoint

The RPC proxy (`/api/rpc`) does forward requests to upstream RPC endpoints, but:
- Endpoint URLs are from env vars (not user input)
- Method allowlist prevents abuse
- No URL parameter from the client request

**SSRF verdict**: Not applicable to this codebase. No user-controllable outbound HTTP requests.

### Webhook URL Discoverability (H131)

The webhook URL structure is predictable: `{deployment_url}/api/webhooks/helius`. The Helius documentation pattern and common Next.js API route conventions make this discoverable. However, H131 was fixed in Audit #1 by removing the webhook URL from client-visible code. The URL itself being guessable is a minor concern because the auth secret protects the endpoint.

## Cross-Focus Intersections

### With SEC-02 (Signature Verification)
The webhook uses a shared secret (not a signing key). There is no mechanism for secret rotation without downtime. Both Helius registration and Railway env var must be updated simultaneously. During rotation, either old or new secret is temporarily invalid.

### With DATA-01 (Database Security)
All DB writes use Drizzle ORM parameterized queries. No raw SQL. The webhook handler does not construct queries from webhook payload data directly -- it extracts typed fields from Anchor-parsed events and passes them as parameters. SQL injection risk is negligible.

### With ERR-01 (Error Handling)
The webhook handler has three-tier error isolation:
1. Outer try/catch (route.ts:499-508): catches JSON parse failures, returns 500
2. Per-transaction try/catch (route.ts:475-485): continues processing on per-TX errors
3. Per-candle try/catch (route.ts:451-458): candle failures don't block swap storage

This is well-structured. One concern: if the DB connection drops mid-batch, every subsequent transaction in the batch will fail individually, generating many error logs and Sentry reports.

### With INFRA-03 (Infrastructure)
SSE connections are long-lived HTTP connections held open by the Next.js process. Railway's infrastructure must support this pattern (nginx proxy must not timeout). The `X-Accel-Buffering: no` header is correctly set. The 15-second heartbeat prevents proxy idle timeouts (typically 60-120s).

### With CHAIN-02 (Account State)
The enhanced webhook handler decodes raw account data using Anchor coders. If program versions change (upgrade), the IDL used for decoding may not match the on-chain account layout. The handler catches decode errors and stores raw data with an error flag -- but until the IDL is updated, the protocol store will contain `decodeError` entries instead of parsed data.

## Risk Observations

### 1. Content-Length Body Size Limit Bypass
**File**: `app/app/api/webhooks/helius/route.ts:308-315`
**Severity**: MEDIUM (resource exhaustion, not data compromise)
**Details**: The code checks `req.headers.get("content-length")` before parsing. However, Next.js' `req.json()` reads the entire body regardless of Content-Length. With chunked transfer encoding, Content-Length may be absent. An authenticated attacker (or compromised Helius delivery) could send a body much larger than 1MB.
**Recommendation**: Read the raw body stream with a byte counter and abort at the limit. Or configure Next.js body parser limits via `next.config.ts`.

### 2. Missing Replay Protection for Enhanced Webhooks
**File**: `app/app/api/webhooks/helius/route.ts:340-341`
**Severity**: MEDIUM (data freshness, not financial)
**Details**: Enhanced account change webhooks bypass the H049 blockTime replay check. An attacker with the webhook secret could replay old account states, causing all SSE clients to display stale data.
**Recommendation**: Add an `updatedAt` comparison -- only accept account updates if the new `updatedAt` is more recent than the stored one.

### 3. blockTime Null Allows Replay Bypass
**File**: `app/app/api/webhooks/helius/route.ts:380-388`
**Severity**: LOW (mitigated by DB idempotency)
**Details**: If `blockTime` is null/undefined, the replay check is skipped entirely. An attacker could craft webhook payloads without blockTime to bypass the 5-minute window. However, DB idempotency (onConflictDoNothing) prevents duplicate event storage. Candle volume/tradeCount would inflate.
**Recommendation**: Reject transactions without blockTime in production.

### 4. SSE Candle Route Leaks Protocol Updates
**File**: `app/app/api/sse/candles/route.ts:71-75`
**Severity**: LOW (information disclosure, public data)
**Details**: The candle SSE route subscribes to all sseManager events without filtering by event type. Protocol state updates (EpochState, PoolState, etc.) are included in the stream alongside candle updates. The browser's EventSource listener only processes `candle-update` events, but the full stream is visible in browser dev tools.
**Recommendation**: Filter events in the SSE subscriber callback: `if (!payload.startsWith("event: candle-update\n")) return;` (same pattern used in protocol SSE route).

### 5. Webhook Response Information Disclosure
**File**: `app/app/api/webhooks/helius/route.ts:490-498`
**Severity**: LOW
**Details**: The 200 response includes processing counts. An attacker probing the endpoint could confirm it's active and learn about event processing rates. Helius only requires a 200 status -- the body content is not checked.
**Recommendation**: Return `{ ok: true }` without processing details. Move counts to server-side logging only.

### 6. No Array Length Limit on Webhook Payload
**File**: `app/app/api/webhooks/helius/route.ts:329-334`
**Severity**: LOW (CPU exhaustion, requires auth)
**Details**: After JSON parsing, no limit on array length. A payload with millions of small elements would be processed sequentially, blocking the Node.js event loop.
**Recommendation**: Add `if (payload.length > MAX_BATCH_SIZE) return 400;` with a reasonable limit (e.g., 1000).

### 7. Candle Volume/TradeCount Not Idempotent
**File**: `app/db/candle-aggregator.ts:118-129`
**Severity**: LOW (display data only)
**Details**: The candle upsert uses `volume = volume + ${update.volume}` and `tradeCount = tradeCount + 1`. Replayed events would inflate these values. The OHLC prices are correct (GREATEST/LEAST/last-write), but volume and trade count would be overstated.
**Recommendation**: Track processed TX signatures in candle aggregation, or accept this as a known limitation for display-only data.

### 8. Rate Limit Bucket Starvation Between Webhook Types
**File**: `app/app/api/webhooks/helius/route.ts:257-264`, `app/lib/rate-limit.ts:57-60`
**Severity**: LOW (operational, not security)
**Details**: Both Helius webhook types (raw TX and enhanced account changes) share the same rate limit bucket (120/min for the webhook endpoint per IP). During high trading activity, a burst of raw TX webhooks could exhaust the limit, causing enhanced account change webhooks to be rate-limited (or vice versa). Helius may retry rate-limited requests, but this introduces unnecessary latency.
**Recommendation**: Use separate rate limit endpoints for discrimination, or increase the webhook rate limit.

### 9. Helius API Key in Webhook Manage Script URL
**File**: `scripts/webhook-manage.ts:87`
**Severity**: LOW (deployment-time script, not production)
**Details**: The API key is embedded in the URL query string. Error output (line 99) may include this URL.
**Recommendation**: Use a separate header for the API key, or redact the URL in error output.

### 10. anchorToJson Shallow Conversion
**File**: `app/lib/bigint-json.ts:93-117`
**Severity**: LOW (data fidelity)
**Details**: `anchorToJson` does a shallow (one-level) conversion of BN/PublicKey fields. Nested objects (e.g., if an Anchor account has a struct field containing another BN) would not be converted. Currently, all protocol accounts have flat structures, but future account layout changes could introduce nesting.
**Recommendation**: Document the shallow-only limitation. Consider recursive conversion if account structures become nested.

### 11. Protocol Store Accepts Arbitrary Keys
**File**: `app/lib/protocol-store.ts:53`
**Severity**: LOW (theoretical, code path controlled)
**Details**: `setAccountState(pubkey: string, data: AccountState)` performs no key validation. The webhook handler validates against `KNOWN_PROTOCOL_ACCOUNTS` before calling it, and ws-subscriber uses hardcoded keys. But if future code paths pass attacker-influenced keys, the SSE pipeline would broadcast attacker-controlled data.
**Recommendation**: Add a key validation layer (allowlist of valid pubkeys + synthetic key patterns).

### 12. SSE Connection Count Underflow Protection
**File**: `app/lib/sse-connections.ts:65-73`
**Severity**: INFORMATIONAL
**Details**: `releaseConnection` uses `Math.max(0, state.globalCount - 1)` to prevent negative counts. This is correct defensive coding. However, the `released` boolean guard in the SSE routes prevents double-release. Both protections are present -- good defense-in-depth.

## Novel Attack Surface Observations

### 1. Webhook Type Confusion Attack
An attacker who obtains the webhook secret could send a payload where the first element has both `accountData` (triggering enhanced path) and carefully crafted nested data. The enhanced path has weaker validation (no replay protection, no blockTime check). By routing a crafted payload through the enhanced handler, the attacker could inject arbitrary data into the protocol store, which is then broadcast to all SSE clients.

The protocol store's `setAccountState` accepts any object. If the attacker crafts data that looks like a decoded EpochState (with `taxRateBps`, `cheapSide`, etc.), the frontend's `useProtocolState` hook would treat it as real epoch data. This could show false tax rates, fake carnage events, or incorrect pool reserves to all connected users -- potentially influencing trading decisions.

### 2. Candle Price Oracle Manipulation
With webhook access, an attacker can inject swap events with extreme prices. The candle aggregator's `GREATEST`/`LEAST` logic means a single event with price=999999 permanently sets the candle high for that bucket. A single event with price=0.000001 permanently sets the candle low. This corrupts the visual chart for all users. The `close` price (last trade) and `open` price (first trade) are less vulnerable, but the high/low corruption is permanent for the affected time bucket.

### 3. SSE Subscriber Enumeration via Broadcast Timing
An attacker with webhook access could measure the response time of webhook requests. When there are many SSE subscribers, the synchronous broadcast loop takes longer. By measuring webhook response latency over time, the attacker could estimate the number of connected users. This is a minor information leak but is unique to the architecture.

## Questions for Other Focus Areas

1. **SEC-01**: Is there a plan for HELIUS_WEBHOOK_SECRET rotation? How would this be coordinated with Helius webhook registration?
2. **CHAIN-02**: What happens when program IDLs are updated but the deployed webhook handler still uses the old IDL? Is there a deployment ordering constraint?
3. **ERR-02**: The webhook handler creates fresh EventParser instances per call (good). But the SSE manager's subscriber Set grows and shrinks -- is there a risk of callback leak if unsubscribe is never called?
4. **DATA-01**: The `onConflictDoNothing` for swap_events means if Helius delivers the same TX signature twice with different data (e.g., log parsing changes between versions), the first write wins. Is this the desired behavior?
5. **INFRA-03**: What is Railway's maximum request body size? Does it enforce limits before the Next.js handler runs? This would affect the Content-Length bypass concern.

## Raw Notes

### Helius Webhook Contract Analysis
- Helius raw webhooks: array of transaction objects with `signature`, `meta.logMessages`, `blockTime`
- Helius enhanced webhooks: array of account objects with `account`, `accountData`, `rawAccountData`
- Auth: Helius sends `authHeader` as-is in the Authorization header
- Delivery: HTTPS, retries on non-200 with exponential backoff up to 24 hours
- No ordering guarantee -- events may arrive out of order within a batch

### Event Parser Security
- Uses `BorshCoder` from `@coral-xyz/anchor` -- standard library, well-tested
- Creates fresh parser per call (prevents state leakage between requests)
- Snake_case field names from IDL (not camelCase) -- correct for BorshCoder
- `bnToNumber` uses `.toNumber()` which throws on values > MAX_SAFE_INTEGER
- `pubkeyToString` has multiple fallback paths (BN bytes, direct construction, toString)

### Database Schema Observations
- `swap_events.tx_signature` is varchar(128) -- Solana TX signatures are 88 base58 chars, so this is adequate
- `candles` uses `real` type for prices -- 6-7 significant digits, adequate for display
- `bigint` mode "number" in Drizzle means JavaScript number (not BigInt) -- safe for lamport amounts < 2^53
- Indexes on pool, epoch, timestamp, user_wallet -- good query performance for chart and history views

### SSE Connection Security
- No authentication on SSE endpoints (public data)
- Per-IP limit of 10 connections -- 5 tabs x 2 SSE routes = 10 (tight but correct)
- Global limit of 5000 -- allows ~500 concurrent users with 2 SSE routes each and 5x headroom
- 30-minute auto-release prevents zombie connections from crashed clients
- Double-release protection via `released` boolean flag in SSE route handlers

### Webhook Manage Script
- Requires `HELIUS_API_KEY` and `WEBHOOK_URL` env vars (no defaults)
- Supports list/create/update/delete operations
- Cluster-aware: mainnet vs devnet API URLs and webhook types
- Reads program IDs from IDL files (auto-synced during deployment)
- Logs auth header presence but not value (good)
- API key in URL query string is a Helius API convention, not a project choice
