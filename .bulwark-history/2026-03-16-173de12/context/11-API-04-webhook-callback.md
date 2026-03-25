---
task_id: db-phase1-webhook-callback
provides: [webhook-callback-findings, webhook-callback-invariants]
focus_area: webhook-callback
files_analyzed: [app/app/api/webhooks/helius/route.ts, scripts/webhook-manage.ts, app/lib/sse-manager.ts, app/app/api/sse/candles/route.ts, app/app/api/candles/route.ts, app/app/api/sol-price/route.ts, app/app/api/carnage-events/route.ts, app/app/api/health/route.ts, app/lib/event-parser.ts, app/db/candle-aggregator.ts, app/db/connection.ts, app/hooks/useChartSSE.ts, app/hooks/useCarnageEvents.ts]
finding_count: 8
severity_breakdown: {critical: 0, high: 2, medium: 3, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# Webhook & Callback Security -- Condensed Summary

## Key Findings (Top 8)

1. **Webhook auth is OPTIONAL -- skipped when HELIUS_WEBHOOK_SECRET is unset**: If the env var is not configured in production, any internet user can POST forged transaction batches to `/api/webhooks/helius`, injecting arbitrary swap/epoch/carnage events into Postgres and broadcasting fake price data via SSE. -- `app/app/api/webhooks/helius/route.ts:135-141`
2. **Webhook auth uses non-constant-time string comparison (`!==`)**: The authorization header is compared to the secret via JavaScript `!==` (line 138), which is vulnerable to timing attacks that can leak the secret byte-by-byte. Should use `crypto.timingSafeEqual`. -- `app/app/api/webhooks/helius/route.ts:138`
3. **SSE endpoint has no authentication or rate limiting**: Any client can open unlimited EventSource connections to `/api/sse/candles`. Each connection holds a long-lived HTTP stream with a 15-second heartbeat interval. An attacker opening thousands of connections can exhaust server memory and file descriptors. -- `app/app/api/sse/candles/route.ts:38`
4. **No request body size limit on webhook endpoint**: The Helius webhook handler calls `req.json()` on the raw body without enforcing a maximum size. A malicious sender could POST a multi-gigabyte JSON array to exhaust server memory (OOM kill). -- `app/app/api/webhooks/helius/route.ts:146`
5. **Hardcoded Helius API key in source code**: `webhook-manage.ts:28` and `shared/constants.ts:474` contain the Helius API key `[REDACTED-DEVNET-KEY]-...` as a fallback default. While documented as "free-tier," this key controls webhook CRUD operations (create/update/delete) and RPC access. If the repo is public, anyone can manage webhooks for this account. -- `scripts/webhook-manage.ts:28`
6. **No replay protection on webhook deliveries**: The webhook handler has no timestamp validation or nonce checking. An attacker who captures a legitimate Helius webhook delivery can replay it indefinitely. While the DB uses `onConflictDoNothing` for exact duplicates, modified payloads (same signature, different amounts) would create false price data. -- `app/app/api/webhooks/helius/route.ts:131`
7. **SSE broadcasts unvalidated price data from webhook**: If a forged webhook injects fake swap events, the SSE manager immediately broadcasts fake `candle-update` events to all connected chart clients, causing real-time price manipulation in the UI. -- `app/app/api/webhooks/helius/route.ts:222-234`
8. **No rate limiting on any API route**: All 6 API routes (`/api/webhooks/helius`, `/api/sse/candles`, `/api/candles`, `/api/sol-price`, `/api/carnage-events`, `/api/health`) have zero rate limiting. No Next.js middleware.ts exists. -- All route files

## Critical Mechanisms

- **Webhook Ingestion Pipeline**: Helius POST -> auth check (optional) -> JSON parse -> Anchor EventParser decode -> Postgres upsert (onConflictDoNothing) -> candle aggregation -> SSE broadcast. The entire pipeline trusts the incoming data if auth passes (or is skipped). -- `app/app/api/webhooks/helius/route.ts:131-289`
- **SSE Pub/Sub**: In-memory singleton `SSEManager` with a Set of subscriber callbacks. Webhook handler calls `sseManager.broadcast()` which fans out to all connected SSE clients. No filtering, no auth, no backpressure. -- `app/lib/sse-manager.ts:29-74`
- **Webhook CRUD Management**: `scripts/webhook-manage.ts` creates/updates/deletes Helius webhooks via their REST API. Uses Helius API key from env or hardcoded default. Sets `authHeader` on webhook creation only if `HELIUS_WEBHOOK_SECRET` is in env. -- `scripts/webhook-manage.ts:102-133`
- **External Price Proxy**: `/api/sol-price` proxies CoinGecko/Binance price feeds with 60-second in-memory cache. No auth, no rate limit. Cache is process-global (module-level variable). -- `app/app/api/sol-price/route.ts:33-38`

## Invariants & Assumptions

- INVARIANT: Webhook deliveries should only be processed if they originate from Helius -- enforced at `app/app/api/webhooks/helius/route.ts:136-141` ONLY when HELIUS_WEBHOOK_SECRET is set / NOT enforced when unset
- INVARIANT: Each swap event should only be stored once (idempotency) -- enforced at `app/app/api/webhooks/helius/route.ts:337` via `onConflictDoNothing` on txSignature PK
- INVARIANT: Each epoch event should only be stored once -- enforced at `app/app/api/webhooks/helius/route.ts:454` via `onConflictDoNothing` on epoch_number unique index
- INVARIANT: Candle OHLCV data should reflect actual on-chain swap prices -- NOT enforced if forged webhooks can inject arbitrary data
- ASSUMPTION: HELIUS_WEBHOOK_SECRET is set in production Railway env vars -- UNVALIDATED (no startup check, no fail-closed behavior)
- ASSUMPTION: Only Helius sends POST requests to the webhook endpoint -- UNVALIDATED (URL is discoverable: hardcoded in `webhook-manage.ts:43`)
- ASSUMPTION: SSE connections are from legitimate frontend clients -- UNVALIDATED (no auth on SSE endpoint)
- ASSUMPTION: The Helius API key is low-value (free tier) -- needs verification; it controls webhook management and RPC access

## Risk Observations (Prioritized)

1. **Forged webhook injection (HIGH)**: `app/app/api/webhooks/helius/route.ts:135` -- If HELIUS_WEBHOOK_SECRET is unset in production, anyone can inject fake swap events, corrupt price charts, and broadcast fake prices via SSE. The webhook URL is discoverable from source code. Impact: manipulated UI price data for all connected users.
2. **Timing attack on webhook secret (MEDIUM)**: `app/app/api/webhooks/helius/route.ts:138` -- `!==` comparison leaks secret length and content timing side-channel. Over many requests, an attacker can reconstruct the secret. Impact: webhook auth bypass.
3. **SSE connection flooding (MEDIUM)**: `app/app/api/sse/candles/route.ts:38` -- No connection limit, no auth. Each SSE connection holds open a Node.js response stream indefinitely. Impact: denial of service via resource exhaustion on Railway.
4. **No body size limit on webhook (MEDIUM)**: `app/app/api/webhooks/helius/route.ts:146` -- Large POST body can OOM the Next.js process. Impact: denial of service.
5. **Hardcoded API key (LOW)**: `scripts/webhook-manage.ts:28` -- Helius API key in source. If repo goes public, anyone can manage webhooks (create, delete, redirect). Impact: webhook takeover.
6. **No rate limiting on read APIs (LOW)**: All GET endpoints lack rate limits. `/api/candles` accepts limit up to 2000 rows. Impact: database load amplification.
7. **Sol-price proxy as amplifier (LOW)**: `/api/sol-price` makes upstream requests to CoinGecko/Binance on cache miss. Attackers can trigger many misses in quick succession. Impact: upstream rate-limit bans.

## Novel Attack Surface

- **Webhook-to-SSE price manipulation chain**: An attacker who can POST to the webhook endpoint (bypassing or absent auth) can inject a TaxedSwap event with an extreme price. This immediately propagates through candle aggregation to SSE broadcast. All connected chart clients display the fake price in real-time. The idempotency guard (`onConflictDoNothing`) only prevents exact duplicates by txSignature -- a forged event with a novel signature passes through. This is a data integrity attack that doesn't require key compromise.
- **SSE subscriber memory leak potential**: The SSEManager `broadcast()` method catches errors from callbacks and removes them, but if a subscriber callback hangs (doesn't throw, doesn't complete), it remains in the Set indefinitely. Combined with no connection limit, this could be exploited.

## Cross-Focus Handoffs

- -> **SEC-02 (Secrets Management)**: Hardcoded Helius API key in `scripts/webhook-manage.ts:28` and `shared/constants.ts:474`. Investigate whether this key has elevated permissions beyond free-tier RPC.
- -> **INJ-03 (Injection)**: The candle aggregator uses Drizzle's `sql` template tag with interpolated values (`${update.price}`, `${update.volume}`) in `app/db/candle-aggregator.ts:121-125`. Verify Drizzle's `sql` template properly parameterizes these (it should, but worth confirming for the `GREATEST`/`LEAST` pattern).
- -> **ERR-01/ERR-02 (Error Handling)**: Webhook handler's per-transaction try/catch (line 258) logs errors to console.error but continues. If the DB connection fails mid-batch, some events are stored and others are not, creating partial state. Investigate recovery mechanisms.
- -> **DATA-01 (Database Security)**: Webhook handler writes directly to Postgres without any validation that the parsed event data is within expected ranges (e.g., price > 0, amounts > 0). Negative or extreme values from forged webhooks would corrupt OHLCV data.

## Trust Boundaries

The primary trust boundary is between Helius (external webhook sender) and the Next.js API route. This boundary is protected by an OPTIONAL shared secret in the Authorization header -- if the env var is unset, the boundary is completely open. Once data crosses this boundary, it is fully trusted: parsed, stored in Postgres, aggregated into candles, and broadcast to all SSE clients without further validation. A secondary trust boundary exists between SSE clients (browsers) and the SSE endpoint, which has no authentication at all -- any HTTP client can subscribe to the real-time price stream. The external price APIs (CoinGecko, Binance) are also trust boundaries where the server accepts and caches their responses with only basic sanity checks (isFinite).
<!-- CONDENSED_SUMMARY_END -->

---

# Webhook & Callback Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain architecture centers on a single Helius webhook endpoint that receives raw Solana transaction data, parses Anchor events, stores them in Postgres, and broadcasts real-time price updates via Server-Sent Events. The webhook authentication is opt-in (skipped when `HELIUS_WEBHOOK_SECRET` is unset), and when present, uses non-constant-time string comparison. There is no rate limiting, no request body size enforcement, no replay protection, and no SSE authentication across the entire API surface. The SSE broadcast path creates a direct pipeline from webhook input to all connected browsers, meaning any webhook forgery immediately corrupts the real-time price display for all users.

## Scope

All off-chain API routes, webhook handlers, SSE infrastructure, and related client hooks. On-chain Anchor programs (`programs/`) are out of scope.

**Files analyzed in detail:**
- `app/app/api/webhooks/helius/route.ts` (509 lines) -- Primary webhook handler
- `scripts/webhook-manage.ts` (223 lines) -- Helius webhook CRUD management
- `app/lib/sse-manager.ts` (93 lines) -- In-memory pub/sub singleton
- `app/app/api/sse/candles/route.ts` (95 lines) -- SSE streaming endpoint
- `app/app/api/candles/route.ts` (255 lines) -- REST candle data API
- `app/app/api/sol-price/route.ts` (125 lines) -- SOL/USD price proxy
- `app/app/api/carnage-events/route.ts` (64 lines) -- Carnage events API
- `app/app/api/health/route.ts` (57 lines) -- Health check endpoint
- `app/lib/event-parser.ts` (383 lines) -- Anchor event decoder
- `app/db/candle-aggregator.ts` (210 lines) -- OHLCV candle upsert logic
- `app/db/connection.ts` (80 lines) -- Postgres connection singleton
- `app/hooks/useChartSSE.ts` (109 lines) -- Client-side SSE consumer
- `app/hooks/useCarnageEvents.ts` (148 lines) -- Client-side carnage events poller

## Key Mechanisms

### 1. Webhook Ingestion Pipeline

**Entry point:** `POST /api/webhooks/helius` (`app/app/api/webhooks/helius/route.ts:131`)

**Flow:**
1. **Auth check (optional):** Reads `HELIUS_WEBHOOK_SECRET` from env. If set, compares to `Authorization` header via `!==`. If unset, auth is entirely skipped.
2. **Body parse:** `await req.json()` -- no size limit, no raw body preservation.
3. **Array validation:** Checks `Array.isArray(transactions)` -- returns 400 if not.
4. **Per-transaction processing:** For each transaction in the batch:
   - Extracts signature from `tx.signature` or `tx.transaction.signatures[0]`
   - Skips transactions with `meta.err` or no log messages
   - Derives timestamp from `blockTime` (unix seconds) or falls back to `new Date()`
   - Passes logMessages to `parseSwapEvents()`, `parseEpochEvents()`, `parseCarnageEvents()`
   - Stores parsed events in Postgres with `onConflictDoNothing`
   - Upserts OHLCV candles at 6 resolutions
   - Broadcasts price updates to SSE subscribers
5. **Error isolation:** Per-transaction try/catch -- one bad TX doesn't fail the batch
6. **Response:** Returns 200 with counts. Returns 500 on fatal errors (triggers Helius retry).

**Security observations:**
- The auth check on line 136 is the ONLY defense against forged webhooks. It is opt-in.
- The `authHeader !== webhookSecret` comparison on line 138 is timing-vulnerable.
- Once past auth, the entire payload is trusted and processed into the database and SSE.
- No validation that parsed event data makes physical/economic sense (e.g., negative prices, impossibly large amounts).

### 2. SSE Broadcasting

**Publisher:** `sseManager.broadcast("candle-update", {...})` called from webhook handler (`route.ts:222`).

**Subscriber endpoint:** `GET /api/sse/candles` (`app/app/api/sse/candles/route.ts:38`)
- Returns a `ReadableStream` with `Content-Type: text/event-stream`
- Sends initial `event: connected` message
- Subscribes a callback to `sseManager`
- Heartbeat every 15 seconds (`: heartbeat\n\n`)
- Cleanup on `req.signal` abort event

**SSEManager implementation:** (`app/lib/sse-manager.ts:29`)
- In-memory `Set<SSECallback>` -- no persistence, no Redis, single-process only
- `broadcast()` iterates Set, calls each callback, removes erroring callbacks
- `globalThis` singleton pattern for HMR survival

**Security observations:**
- No authentication on SSE connections (anyone can connect)
- No connection limit (no max subscriber count)
- No backpressure mechanism (fast producer, slow consumer)
- No CORS restrictions on SSE endpoint beyond Next.js defaults
- Data broadcast is unvalidated relay of whatever the webhook stored

### 3. Webhook CRUD Management

**Script:** `scripts/webhook-manage.ts`

- CLI tool for managing Helius webhooks (list, create, update, delete)
- Uses Helius REST API at `https://api.helius.xyz/v0`
- API key: env `HELIUS_API_KEY` or hardcoded fallback `[REDACTED-DEVNET-HELIUS-KEY]`
- Default webhook URL: `https://dr-fraudsworth-production.up.railway.app/api/webhooks/helius` (line 43)
- Sets `authHeader` on webhook creation only if `HELIUS_WEBHOOK_SECRET` is in env

**Security observations:**
- API key in URL query string (`?api-key=...`) -- visible in logs, referer headers, etc.
- Hardcoded fallback API key means anyone with source access can manage webhooks
- No confirmation prompt before destructive operations (delete)
- Webhook URL is hardcoded, making the endpoint discoverable

### 4. REST API Endpoints

**`GET /api/candles`** (`app/app/api/candles/route.ts:185`)
- Query params: pool, resolution, from, to, limit, gapfill
- Validates resolution against allowlist
- Caps limit at 2000
- Uses Drizzle ORM parameterized queries (safe from SQL injection)
- No authentication
- No rate limiting

**`GET /api/sol-price`** (`app/app/api/sol-price/route.ts:80`)
- Proxies CoinGecko (primary) and Binance (fallback)
- 60-second in-memory cache (`cachedPrice`, `cachedAt` module-level variables)
- 5-second timeout on upstream requests
- No auth, no rate limiting
- Returns `source` field (information disclosure of backend architecture)

**`GET /api/carnage-events`** (`app/app/api/carnage-events/route.ts:31`)
- Returns last 5 carnage events from Postgres
- `select()` returns all columns, then maps to exclude `id`
- No auth, no rate limiting, no pagination

**`GET /api/health`** (`app/app/api/health/route.ts:28`)
- Always returns 200 (liveness check for Railway)
- Reports Postgres and Solana RPC connectivity in body
- No auth -- exposes dependency health to public

## Trust Model

| Boundary | Direction | Auth | Validation |
|----------|-----------|------|------------|
| Helius -> Webhook | Inbound | Optional shared secret | Array.isArray check only |
| Webhook -> Postgres | Internal | N/A (same process) | onConflictDoNothing for idempotency |
| Webhook -> SSE | Internal | N/A (same process) | None -- raw relay |
| Browser -> SSE | Inbound | None | N/A (read-only stream) |
| Browser -> REST APIs | Inbound | None | Query param validation |
| Server -> CoinGecko/Binance | Outbound | None | Type checks on response |
| webhook-manage -> Helius API | Outbound | API key in URL | Response status check |

## State Analysis

### Postgres (persistent state)
- `swap_events`: PK on `txSignature` (idempotent)
- `epoch_events`: Unique index on `epoch_number` (idempotent)
- `carnage_events`: Unique index on `epoch_number` (idempotent)
- `candles`: Composite unique on `(pool, resolution, open_time)` (upsert with GREATEST/LEAST)

### In-memory state
- `SSEManager.subscribers`: Set of callbacks -- lost on process restart
- `cachedPrice` / `cachedAt` / `cachedSource`: SOL price cache in `/api/sol-price` -- lost on process restart
- `globalForDb`: Postgres connection pool singleton

## Dependencies (External APIs, Packages, Services)

| Dependency | Used By | Risk |
|------------|---------|------|
| Helius webhook delivery | `route.ts` | If Helius is compromised, forged events could bypass even valid auth |
| CoinGecko API | `sol-price/route.ts` | Rate limiting, availability |
| Binance API | `sol-price/route.ts` | Geo-blocking, availability |
| Helius REST API | `webhook-manage.ts` | API key in URL, webhook management |
| postgres.js | `connection.ts` | Connection pool limits (max 10) |
| Anchor BorshCoder | `event-parser.ts` | Borsh deserialization of untrusted log data |

## Focus-Specific Analysis

### Webhook Signature Verification

**Status: PARTIALLY IMPLEMENTED, TIMING-VULNERABLE**

The webhook handler checks for `HELIUS_WEBHOOK_SECRET` in the environment (line 135). If present, it compares the value to the `Authorization` header using `!==` (line 138). This has three issues:

1. **Opt-in, not opt-out**: If the env var is missing, auth is silently skipped. A production deployment that forgets to set this variable is completely open. There is no startup warning, no fail-closed behavior, and no health check that validates the secret is configured.

2. **Non-constant-time comparison**: JavaScript `!==` for strings is a byte-by-byte comparison that short-circuits on the first differing byte. An attacker can time responses to determine the correct secret character by character. Per OC-148 and SP-005, `crypto.timingSafeEqual` should be used.

3. **No HMAC signature scheme**: Helius supports setting an `authHeader` value that is sent with each delivery. This is a static shared secret, not an HMAC signature of the payload. There is no way to verify that the payload content matches what Helius sent -- only that the sender knows the secret. A compromised intermediary could modify the payload after receiving a valid delivery.

### Webhook Replay Protection

**Status: NOT IMPLEMENTED**

There is no timestamp validation on incoming webhook deliveries. An attacker who captures a valid webhook delivery (via network sniffing, log access, or Helius dashboard) can replay it. The `onConflictDoNothing` on `txSignature` prevents exact duplicates, but:
- Modified payloads with the same general structure but different amounts or a different signature would be accepted
- The `blockTime` field from the payload is trusted without checking against current time

### Webhook Idempotency

**Status: IMPLEMENTED (PARTIAL)**

- `swap_events`: Uses `txSignature` as PK with `onConflictDoNothing` -- idempotent for exact duplicates
- `epoch_events`: Unique index on `epoch_number` with `onConflictDoNothing` -- first write wins
- `carnage_events`: Unique index on `epoch_number` with `onConflictDoNothing` -- first write wins
- `candles`: Uses `onConflictDoUpdate` -- NOT idempotent. Re-processing the same swap event would add volume and trade count again (double-counting). The swap event's `onConflictDoNothing` prevents the candle update from running twice for the same signature, but if a forged event with a different signature has the same price/volume, the candle data is corrupted.

### SSE Connection Security

**Status: NO AUTHENTICATION, NO LIMITS**

The SSE endpoint (`/api/sse/candles`) accepts any HTTP connection without authentication, API key, or session validation. Observations:

- No `max_connections` check in SSEManager
- No IP-based rate limiting
- No origin validation
- 15-second heartbeat keeps connections alive indefinitely
- ReadableStream cleanup relies on `req.signal.abort` -- if the abort event doesn't fire (edge cases in proxy chains), the subscriber remains in the Set

### Request Body Size

**Status: NOT ENFORCED**

Next.js App Router does not enforce a default body size limit on API routes. The webhook handler calls `req.json()` which reads the entire body into memory. A POST with a 100MB+ body would consume equivalent server memory. For Railway's container environment, this could trigger OOM kills.

### Rate Limiting

**Status: NOT IMPLEMENTED**

No Next.js middleware.ts exists. No per-route rate limiting. No IP throttling. All 6 API routes are unprotected against request flooding.

## Cross-Focus Intersections

### Webhook -> Database (DATA-01)
The webhook handler writes untrusted data to Postgres. While Drizzle ORM parameterizes queries (preventing SQL injection), there is no validation of the data values themselves. Forged events with extreme prices, negative amounts, or impossibly large values would be stored and aggregated into candles.

### Webhook -> SSE -> Frontend (FE-01)
The `candle-update` SSE events are consumed by `useChartSSE.ts` on the client side. The client hook does `JSON.parse(event.data)` in a try/catch (line 80) but performs no schema validation on the parsed data. If the SSE data is corrupted (from a forged webhook), the chart component receives and displays invalid data.

### Webhook Management -> Secrets (SEC-02)
The `webhook-manage.ts` script puts the Helius API key in the URL query string. This key also appears hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22` (as part of the RPC URL). If the repository is or becomes public, this key is compromised.

## Cross-Reference Handoffs

| Target Auditor | Item | Reference |
|---------------|------|-----------|
| SEC-02 | Hardcoded Helius API key in source | `scripts/webhook-manage.ts:28`, `shared/constants.ts:474` |
| INJ-03 | Drizzle `sql` template tag parameterization verification | `app/db/candle-aggregator.ts:121-125` |
| ERR-01 | Partial batch processing on DB failure | `app/app/api/webhooks/helius/route.ts:258-267` |
| DATA-01 | No data range validation on webhook-ingested values | `app/app/api/webhooks/helius/route.ts:180-243` |
| INFRA-03 | Railway container memory limits vs unbounded body size | `app/app/api/webhooks/helius/route.ts:146` |

## Risk Observations

### R1: Optional Webhook Authentication (HIGH)

**File:** `app/app/api/webhooks/helius/route.ts:135-141`
**Mechanism:** `HELIUS_WEBHOOK_SECRET` env var gates auth. If unset, auth is skipped entirely.
**Impact:** Complete data integrity compromise. Attacker can inject arbitrary swap events, corrupt price charts, and broadcast fake prices to all connected SSE clients.
**Likelihood:** Possible -- depends on production env var configuration. The code explicitly documents this as intentional for "local testing" but provides no safeguard against production misconfiguration.
**Recommendation:** Fail closed -- require the secret in production (check `NODE_ENV`). Add a startup log warning if unset.

### R2: Timing-Vulnerable Secret Comparison (MEDIUM)

**File:** `app/app/api/webhooks/helius/route.ts:138`
**Mechanism:** `authHeader !== webhookSecret` uses JavaScript's non-constant-time string comparison.
**Impact:** Over many requests (thousands), an attacker can determine the secret value through response timing analysis.
**Likelihood:** Possible but requires sustained access and timing precision.
**Recommendation:** Use `crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(webhookSecret))` with length check.

### R3: SSE Connection Flooding (MEDIUM)

**File:** `app/app/api/sse/candles/route.ts:38`
**Mechanism:** No authentication, no connection limit on SSE endpoint.
**Impact:** Resource exhaustion on Railway container. Each connection holds a ReadableStream, a setInterval timer, and an SSE subscriber callback.
**Likelihood:** Possible -- trivial to script.
**Recommendation:** Add connection limit in SSEManager (e.g., max 1000 subscribers). Consider origin-based limits.

### R4: Unbounded Webhook Body Size (MEDIUM)

**File:** `app/app/api/webhooks/helius/route.ts:146`
**Mechanism:** `req.json()` reads entire body without size limit.
**Impact:** OOM kill on Railway container.
**Likelihood:** Possible -- requires sending large POST body.
**Recommendation:** Use Next.js route segment config `export const maxDuration` or manually check Content-Length header before parsing.

### R5: Hardcoded API Key (LOW)

**File:** `scripts/webhook-manage.ts:28`, `shared/constants.ts:474`
**Mechanism:** Helius API key `[REDACTED-DEVNET-KEY]-...` hardcoded as fallback.
**Impact:** If repo is public, anyone can manage Helius webhooks (create, redirect, delete).
**Likelihood:** Depends on repo visibility.
**Recommendation:** Remove hardcoded key. Require env var.

### R6: No Rate Limiting on Any Endpoint (LOW)

**Files:** All 6 API route files
**Mechanism:** No middleware.ts, no per-route throttling.
**Impact:** Database load amplification, upstream API abuse via sol-price proxy.
**Recommendation:** Add Next.js middleware with IP-based rate limiting.

### R7: Health Endpoint Information Disclosure (LOW)

**File:** `app/app/api/health/route.ts:28`
**Mechanism:** Reports Postgres and Solana RPC connectivity status to any caller.
**Impact:** Attacker can determine backend infrastructure state.
**Recommendation:** Consider restricting to internal networks or Railway health check IPs only.

## Novel Attack Surface Observations

### Webhook-to-SSE Price Manipulation Pipeline

The most interesting attack surface is the direct pipeline from webhook POST to SSE broadcast. A forged webhook with a single TaxedSwap event containing an extreme price (e.g., 100x the real price) would:

1. Pass auth (if secret is missing or leaked via timing attack)
2. Get stored in `swap_events` (with a novel txSignature, it passes `onConflictDoNothing`)
3. Trigger `upsertCandlesForSwap` which writes the extreme price into candles (GREATEST/LEAST)
4. Trigger `sseManager.broadcast("candle-update", { price: EXTREME_VALUE })` to all connected clients
5. Client charts immediately display the fake price spike

This would be visible to all users simultaneously, potentially causing panic selling or buying decisions. The candle data corruption persists in Postgres even after the SSE broadcast -- it would require manual database cleanup.

### Webhook URL Discoverability

The default webhook URL is hardcoded: `https://dr-fraudsworth-production.up.railway.app/api/webhooks/helius` (line 43 of `webhook-manage.ts`). Combined with optional auth, this makes the attack surface trivially discoverable.

### SSE Subscriber Accumulation

If an attacker opens SSE connections faster than they are cleaned up (e.g., by not properly closing them, or by connecting from many IPs), the `Set<SSECallback>` in SSEManager grows unboundedly. Each `broadcast()` call then iterates the entire Set, making broadcast time O(n) where n is subscriber count. At large n, broadcast latency degrades, and the webhook handler (which calls broadcast synchronously within its request lifecycle) takes longer to respond, potentially causing Helius to timeout and retry, creating a feedback loop.

## Questions for Other Focus Areas

1. **SEC-02**: Is `HELIUS_WEBHOOK_SECRET` confirmed set in Railway production environment? What is the secret's entropy?
2. **INFRA-03**: What are Railway's container memory limits? Does Railway enforce body size limits at the proxy level?
3. **DATA-01**: Are there any database constraints (CHECK constraints, triggers) that would reject absurd values from forged webhooks?
4. **ERR-01**: What monitoring exists for webhook handler errors? Would a spike in error rate trigger alerts?
5. **FE-01**: Does the chart component validate SSE data before rendering (e.g., reject prices that differ > 100x from the last known price)?

## Raw Notes

- The `event-parser.ts` uses Anchor's `BorshCoder` and `EventParser` to decode events from log messages. This is a deserialization of untrusted data (the log messages come from the webhook payload). While BorshCoder is a well-tested library, malformed data could potentially cause unexpected behavior. The parser functions create fresh `EventParser` instances per call (line 221-229), avoiding stateful contamination.

- The `candle-aggregator.ts` uses Drizzle's `sql` template tag for GREATEST/LEAST expressions (lines 121-125). Drizzle's tagged template parameterizes values correctly -- `sql\`GREATEST(${candles.high}, ${update.price})\`` generates `GREATEST("candles"."high", $1)` with `update.price` as a bound parameter. This is safe from SQL injection.

- The `sol-price/route.ts` does basic type validation on upstream responses (`typeof price === "number" && Number.isFinite(price)` for CoinGecko, `Number.isFinite(price)` for Binance). This prevents NaN/Infinity but not manipulated prices from a compromised upstream.

- Next.js App Router has no built-in body size limit configuration per-route. The `next.config.js` `api.bodyParser.sizeLimit` only applies to Pages Router API routes, not App Router. Body size enforcement would need to be done manually (check Content-Length header) or via reverse proxy configuration.

- The webhook handler uses `new Date(blockTime * 1000)` for timestamp with a fallback to `new Date()`. An attacker could set `blockTime` to a future date, causing candles to be created in future time buckets, which would be confusing but not directly exploitable.
