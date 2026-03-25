---
task_id: db-phase1-chain-02
provides: [chain-02-findings, chain-02-invariants]
focus_area: chain-02
files_analyzed:
  - app/lib/connection.ts
  - app/lib/anchor.ts
  - app/lib/ws-subscriber.ts
  - app/lib/protocol-store.ts
  - app/lib/protocol-config.ts
  - app/lib/credit-counter.ts
  - app/lib/rate-limit.ts
  - app/lib/confirm-transaction.ts
  - app/app/api/rpc/route.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/health/route.ts
  - app/app/api/sse/protocol/route.ts
  - app/hooks/useProtocolState.ts
  - app/hooks/useRoutes.ts
  - app/hooks/useCurveState.ts
  - app/hooks/useEpochState.ts
  - app/hooks/usePoolPrices.ts
  - app/hooks/useTokenBalances.ts
  - app/hooks/useSwap.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/swap/swap-builders.ts
  - app/instrumentation.ts
finding_count: 14
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 7}
---
<!-- CONDENSED_SUMMARY_START -->
# CHAIN-02: RPC Client & Node Trust -- Condensed Summary

## Key Findings (Top 10)

1. **RPC proxy allows batch requests without per-batch size limits**: An attacker can send a single HTTP request to `/api/rpc` containing an arbitrarily large JSON-RPC batch array. The rate limiter counts this as 1 request but every method in the batch is forwarded upstream, amplifying Helius credit consumption. -- `app/app/api/rpc/route.ts:102-105`

2. **RPC proxy method allowlist includes `sendTransaction`**: Browser clients can submit arbitrary transaction bytes through the proxy using the `sendTransaction` method. Combined with batch mode, an attacker can spam the Solana network via the project's Helius endpoint. -- `app/app/api/rpc/route.ts:43`

3. **Polling fallback in useProtocolState stores raw AccountInfo, not decoded Anchor data**: When SSE is down >30s, the browser fallback polls `getMultipleAccountsInfo` but stores `{lamports, owner, dataLength}` -- not decoded account fields. Downstream hooks (useEpochState, usePoolPrices, useCurveState) expect decoded fields like `crimeBuyTaxBps`, `reserveA`, etc. The fallback provides structurally incompatible data. -- `app/hooks/useProtocolState.ts:196-211`

4. **No RPC response validation on Anchor account decoding in webhook handler**: The webhook handler decodes raw Base64 account data from Helius Enhanced Webhooks using `program.coder.accounts.decode()`. If Helius delivers corrupted or truncated data, the decode could produce silently wrong values that propagate to all SSE clients. No schema validation or bounds checking on decoded fields. -- `app/app/api/webhooks/helius/route.ts:589-593`

5. **ws-subscriber staker poll uses `stakedBalance.toNumber()` on BN**: The `toNumber()` call on BN values can lose precision for balances exceeding `Number.MAX_SAFE_INTEGER` (2^53). PROFIT has 9 decimals and 20M supply, so max raw value = 20_000_000 * 10^9 = 2e16, which is within safe range. Low concern for current token supply but could break with larger supplies. -- `app/lib/ws-subscriber.ts:219`

6. **Health endpoint exposes internal RPC credit stats and ws-subscriber state publicly**: `/api/health` returns `wsSubscriber` state (latestSlot, lastSlotReceivedAt, fallbackActive) and `credits` (totalCalls, per-method breakdowns). This is information disclosure about infrastructure internals. -- `app/app/api/health/route.ts:63-70` (H028 recheck)

7. **Connection singleton uses module-level `let` cache, not globalThis**: Unlike protocol-store, sse-manager, and credit-counter (all globalThis), the Connection singleton uses a plain module-level `let`. In Turbopack/HMR scenarios, module re-evaluation creates a new Connection object and WS channel, orphaning the old one. Production builds are unaffected. -- `app/lib/connection.ts:21-22`

8. **No request body size limit on RPC proxy POST**: The `/api/rpc` route parses `await request.json()` without checking Content-Length. An attacker could send a multi-MB JSON body to exhaust server memory. The webhook route has a 1MB check (H050), but the RPC proxy does not. -- `app/app/api/rpc/route.ts:92-100`

9. **SLOT_BROADCAST_INTERVAL_MS parsed from env var without bounds validation**: An attacker with env var access (or misconfiguration) setting `SLOT_BROADCAST_INTERVAL_MS=0` would cause every slot change (~400ms) to trigger a protocolStore broadcast + SSE push, creating a firehose of events. -- `app/lib/ws-subscriber.ts:251-253`

10. **Commitment level is globally "confirmed" with no override mechanism**: The Connection singleton hardcodes `commitment: "confirmed"` for all reads. This is appropriate for display data but any future code path making financial decisions (e.g., payment verification) inherits this default. Currently safe because on-chain slippage enforcement is the safety net. -- `app/lib/connection.ts:69`

## Critical Mechanisms

- **RPC Proxy (`/api/rpc`)**: Browser -> Next.js API route -> Helius. Method allowlist (17 methods), sticky failover across up to 3 endpoints, rate-limited at 300 req/min per IP. Proxies `sendTransaction` meaning the browser can submit TXs through the server's Helius key. -- `app/app/api/rpc/route.ts:31-59,80-188`

- **Connection Singleton**: Server-side creates a single `Connection` with `commitment: "confirmed"` and WS endpoint derived from HELIUS_RPC_URL. Browser-side routes through `/api/rpc` proxy with WS disabled. No cross-cluster fallback (H009 fix). Memoized by URL identity. -- `app/lib/connection.ts:54-87`

- **ws-subscriber Server Pipeline**: On server boot: batchSeed (getMultipleAccountsInfo + getTokenSupply x2 + getSlot + gPA), then starts: WS onSlotChange (throttled 5s broadcasts), supply poll (60s), staker gPA poll (30s), staleness monitor (15s threshold, HTTP getSlot fallback). All data flows into protocolStore -> SSE -> browser. -- `app/lib/ws-subscriber.ts:450-476`

- **Helius Enhanced Webhook -> protocolStore**: Webhook receives raw account data (Base64), Anchor-decodes it, normalizes via `anchorToJson`, stores in in-memory Map, broadcasts via SSE. Fail-closed auth, 1MB body limit, rate-limited. Decoding errors stored with `decodeError` flag rather than dropped. -- `app/app/api/webhooks/helius/route.ts:525-633`

- **SSE Protocol Route**: Long-lived connection delivering initial snapshot + incremental protocol-update events from protocolStore. Connection-capped (H008), heartbeat every 15s, auto-release after 30min. -- `app/app/api/sse/protocol/route.ts:41-136`

- **Browser RPC Polling Fallback**: When SSE is down >30s, useProtocolState falls back to `getMultipleAccountsInfo` every 60s. However, stores raw AccountInfo metadata rather than decoded state, creating a data shape mismatch. -- `app/hooks/useProtocolState.ts:187-216`

## Invariants & Assumptions

- INVARIANT: Connection commitment level is always "confirmed" -- enforced at `app/lib/connection.ts:69`
- INVARIANT: Browser RPC requests go through `/api/rpc` proxy, never direct to Helius -- enforced at `app/lib/connection.ts:36-37`
- INVARIANT: HELIUS_RPC_URL env var is required for server-side RPC -- enforced at `app/lib/connection.ts:42-44` (throws on missing)
- INVARIANT: RPC proxy method allowlist rejects non-listed methods -- enforced at `app/app/api/rpc/route.ts:116-122`
- INVARIANT: Webhook auth is fail-closed in production -- enforced at `app/app/api/webhooks/helius/route.ts:273-284`
- INVARIANT: ws-subscriber is double-init guarded -- enforced at `app/lib/ws-subscriber.ts:456-458` (state.initialized flag)
- ASSUMPTION: Helius RPC endpoint is trustworthy and returns correct data -- UNVALIDATED (no cross-provider verification)
- ASSUMPTION: Helius Enhanced Webhook delivers correct account data matching on-chain state -- UNVALIDATED (no independent verification)
- ASSUMPTION: WS slot subscription stays healthy indefinitely or staleness monitor catches it within 15s -- validated at `app/lib/ws-subscriber.ts:299-323` (15s threshold + HTTP fallback)
- ASSUMPTION: All Anchor-decoded fields from webhook data are within expected ranges (tax BPS 0-10000, reserves >= 0) -- UNVALIDATED (no bounds checking post-decode)

## Risk Observations (Prioritized)

1. **RPC proxy batch amplification**: `app/app/api/rpc/route.ts:102-105` -- Rate limiter counts 1 request, but N methods execute upstream. Attacker sends batch of 100 `getProgramAccounts` calls in a single request, consuming 100 Helius credits per rate-limit slot. Could burn through daily credit budget rapidly.

2. **Browser polling fallback data shape mismatch**: `app/hooks/useProtocolState.ts:196-211` -- When SSE goes down, the fallback stores `{lamports, owner, dataLength}`. Consumer hooks check `typeof data.reserveA === "number"` or `typeof data.currentEpoch === "number"` and fall through to loading/null state. The UI shows "loading" indefinitely during SSE outages rather than stale but structured data. Functional degradation, not a security vulnerability.

3. **No Anchor decode output validation**: `app/app/api/webhooks/helius/route.ts:589-593` and `app/lib/ws-subscriber.ts:144` -- Decoded account data is trusted directly. A malicious/buggy Helius response with out-of-range tax rates (e.g., 50000 BPS) would propagate to the route engine, producing misleading quotes. On-chain slippage is the safety net but user experience degrades.

4. **RPC proxy body size unlimited**: `app/app/api/rpc/route.ts:92-100` -- No Content-Length check before `request.json()`. A 50MB JSON payload would be fully parsed into memory before method validation. Next.js may have its own limits but they are not explicit.

5. **Health endpoint information disclosure**: `app/app/api/health/route.ts:63-70` -- Internal state (slot numbers, RPC call counts, WS connection status) exposed publicly. Useful for attackers to determine infrastructure state and timing.

## Novel Attack Surface

- **Credit exhaustion via batch RPC amplification**: The RPC proxy is the only path for browser-to-Helius RPC. Its rate limiter operates per-HTTP-request, not per-JSON-RPC-method. An attacker can construct a single POST with hundreds of valid JSON-RPC calls (e.g., `getAccountInfo` repeated 500 times). Each individual call consumes a Helius credit but costs only 1 rate-limit token. At 300 requests/min/IP with 500 calls/request, that is 150,000 Helius credits/minute from a single IP. With IP rotation, this scales linearly. The project's Helius plan likely has a daily credit cap; exhausting it would deny RPC to all legitimate users and take down the entire frontend + ws-subscriber + crank.

- **Stale data window during ws-subscriber batchSeed -> webhook handoff**: Between server boot (batchSeed completes) and Helius webhook delivery of the first real account change, there is a time window where the protocolStore contains seed data that may be seconds to minutes stale. If an epoch transition or large trade occurs during this window, SSE clients display stale prices/rates. The batchSeed uses "confirmed" commitment which mitigates finality risk but not real-time staleness.

## Cross-Focus Handoffs

- -> **ERR-01 (Error Handling)**: ws-subscriber silently swallows staker poll `catch {}` errors (`app/lib/ws-subscriber.ts:414`). When decode fails for a malformed UserStake account, it's silently skipped with no logging. This could mask data corruption.
- -> **SEC-02 (Signature Verification)**: Webhook auth header comparison uses `timingSafeEqual` correctly but the secret is a plain string, not HMAC-SHA256. Verify Helius actually sends the `authHeader` value as-is in the `Authorization` header (not as an HMAC signature). If Helius sends a derived HMAC, the current comparison would always fail.
- -> **DATA-01 (Data Persistence)**: protocolStore is in-memory only. Server restart = full data loss until batchSeed runs. There is no persistence layer for protocol state between restarts.
- -> **INFRA-03 (Infrastructure)**: The RPC proxy's sticky failover state (`lastSuccessfulEndpoint`) is process-level. If Railway runs multiple instances, each has independent failover state.

## Trust Boundaries

The RPC trust model has three distinct layers. First, the browser is untrusted -- all browser RPC calls are proxied through `/api/rpc` with a method allowlist and rate limiting; the Helius API key never reaches the client. Second, server-to-Helius communication is implicitly trusted -- the Connection singleton, ws-subscriber, and webhook handler all treat Helius responses as authoritative data. There is no cross-provider verification or schema validation on decoded account data. Third, the Helius webhook-to-server path uses a shared secret for authentication (fail-closed in production) but the webhook payload itself is trusted after auth passes -- no independent on-chain verification of the delivered account state. The critical assumption is that Helius faithfully relays correct Solana state. If Helius were compromised or returned stale/wrong data, the entire frontend state (prices, tax rates, curve status, staking stats) would be corrupted, though on-chain slippage enforcement prevents direct financial loss from stale quotes.
<!-- CONDENSED_SUMMARY_END -->

---

# CHAIN-02: RPC Client & Node Trust -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase implements a layered RPC architecture with the Helius RPC provider as the single source of truth. Browser clients never communicate directly with Helius; all RPC traffic flows through the `/api/rpc` proxy, which hides the API key and enforces a method allowlist. Server-side code uses a singleton Connection instance backed by the HELIUS_RPC_URL env var. A real-time data pipeline (ws-subscriber -> protocolStore -> SSE -> browser) replaces individual browser WebSocket subscriptions.

The architecture is well-designed for a single-process deployment (Railway). Key strengths include: fail-closed webhook auth, method allowlist on the RPC proxy, commitment level consistency ("confirmed" everywhere), proper API key isolation, and robust staleness monitoring with HTTP fallback. Key weaknesses include: no batch-level rate limiting on the RPC proxy, no validation of Anchor-decoded data from Helius, and a data shape mismatch in the browser polling fallback path.

No critical vulnerabilities were found. Two high-severity observations relate to Helius credit exhaustion via batch amplification and the lack of Anchor decode output validation.

## Scope

All off-chain code making RPC calls, receiving RPC responses, or processing Helius webhook data. Specifically:

- Connection factory and configuration: `connection.ts`, `protocol-config.ts`, `anchor.ts`
- RPC proxy: `app/api/rpc/route.ts`
- WebSocket subscriber pipeline: `ws-subscriber.ts`, `protocol-store.ts`, `credit-counter.ts`
- Helius webhook handler (account changes path): `webhooks/helius/route.ts`
- SSE delivery: `sse/protocol/route.ts`, `sse-manager.ts`, `sse-connections.ts`
- Browser state hooks: `useProtocolState.ts`, `usePoolPrices.ts`, `useEpochState.ts`, `useCurveState.ts`, `useTokenBalances.ts`, `useCurrentSlot.ts`
- Transaction confirmation: `confirm-transaction.ts`, `useSwap.ts`, `multi-hop-builder.ts`
- Health endpoint: `health/route.ts`

Out of scope: on-chain Anchor programs, crank runner, deployment scripts (except where they set RPC configuration).

## Key Mechanisms

### 1. Connection Factory (`app/lib/connection.ts`)

**Purpose**: Creates and caches a singleton Solana `Connection` instance.

**Data flow**:
- Browser: resolves to `${window.location.origin}/api/rpc` (proxy URL)
- Server: resolves to `process.env.HELIUS_RPC_URL` (primary) or `process.env.NEXT_PUBLIC_RPC_URL` (fallback)
- If neither is set on server, throws immediately (fail-closed)

**Commitment**: Hardcoded to `"confirmed"`. This is the global default for all reads.

**WebSocket handling**:
- Proxy URL: WS disabled (`wsEndpoint: undefined`) -- HTTP-only proxy cannot support WS
- Direct URL on server: WS enabled with `wss://` derived from `https://`

**Singleton pattern**: Module-level `let cachedConnection`, compared by URL identity. Not using globalThis (unlike other singletons in the codebase). This means HMR in development creates orphaned connections. Production is unaffected (no HMR).

**Observations**:
- The `override` parameter on `getConnection(rpcUrl?)` bypasses the singleton. Any caller passing a different URL gets a NEW Connection that is not cached. Only the latest is cached. If code alternates between two URLs, connections are created and abandoned each call.
- No explicit connection timeout. The underlying `@solana/web3.js` Connection uses `fetch()` defaults.
- The function is synchronous but creates a Connection that makes async requests. No "healthcheck on creation" pattern.

### 2. RPC Proxy (`app/app/api/rpc/route.ts`)

**Purpose**: Proxy browser RPC requests to Helius, hiding the API key.

**Security controls**:
- Rate limiting: 300 req/min per IP (via `app/lib/rate-limit.ts`)
- Method allowlist: 17 methods explicitly enumerated
- API key: stays in HELIUS_RPC_URL env var, never exposed to client
- Endpoint masking: `maskEndpoint()` strips the URL to hostname-only for logs

**Failover (H047)**:
- Ordered endpoint list from env vars: HELIUS_RPC_URL, HELIUS_RPC_URL_FALLBACK, NEXT_PUBLIC_RPC_URL
- Sticky routing: last successful endpoint tried first
- Retry on HTTP 5xx from upstream; any other response (including RPC-level errors) is returned as-is
- Network errors (DNS, timeout) trigger next endpoint
- All endpoints fail: returns 502 with generic error message

**Batch request handling**:
- Detects `Array.isArray(body)` and iterates over each item for method validation
- ALL methods in the batch must be in the allowlist; first disallowed method rejects the entire batch
- The batch is forwarded as-is to Helius (single upstream HTTP request)
- Credit counter records per-method counts, but ONLY after successful upstream response

**Risk: Batch amplification**:
The rate limiter at `app/lib/rate-limit.ts:81-112` increments once per `POST /api/rpc` call. A batch containing 500 valid JSON-RPC requests counts as 1 rate-limit token but executes 500 Helius calls. The rate limit of 300 req/min per IP becomes 300 * N methods/request per minute in Helius credits.

This is the most significant CHAIN-02 finding. The fix would be to count batch requests as N tokens or cap batch size (e.g., max 10 per request).

**Risk: No body size limit**:
Unlike the webhook route (which checks Content-Length against 1MB), the RPC proxy parses `request.json()` without any size check. A large JSON body (many MB) would be fully parsed into memory. Next.js may impose a default body limit, but it's not explicitly enforced here.

### 3. ws-subscriber Pipeline (`app/lib/ws-subscriber.ts`)

**Purpose**: Server-side data pipeline feeding the protocol store with real-time data.

**Initialization sequence** (`init()`):
1. Feature-flagged via `WS_SUBSCRIBER_ENABLED !== "true"` (disabled returns immediately)
2. Double-init guard via `state.initialized` flag
3. `batchSeed(connection)`:
   - `getMultipleAccountsInfo` for 8 protocol PDAs (1 credit)
   - Anchor decode each account, normalize via `anchorToJson`
   - `getTokenSupply` x2 (CRIME, FRAUD) (2 credits)
   - `getSlot` (1 credit)
   - `getProgramAccounts` with memcmp filter for UserStake discriminator (1 credit)
   - Total: ~5 Helius credits per boot
4. Start ongoing subscriptions:
   - `onSlotChange` WS subscription, throttled to broadcast every `SLOT_BROADCAST_INTERVAL_MS` (default 5s)
   - Supply poll: `getTokenSupply` x2 every 60s (2 credits/min)
   - Staker poll: `getProgramAccounts` every 30s (2 credits/min)
   - Staleness monitor: checks every 10s if WS slot data is >15s stale; activates HTTP fallback (5s interval)

**globalThis singleton**: Correctly uses `globalForWsSub.wsSubscriber` pattern. Unconditional assignment (matching Turbopack guidance from MEMORY.md).

**Data flow**: All data goes into `protocolStore.setAccountStateQuiet()` (seed) or `protocolStore.setAccountState()` (ongoing). The "quiet" variant stores without broadcasting; the regular variant broadcasts via SSE.

**Observations**:
- `stakedBalance.toNumber()` at line 219: BN.toNumber() loses precision above 2^53. With PROFIT's 20M supply * 10^9 decimals = 2e16, this is within safe range. But if token supply ever increases, this becomes a precision bug.
- `SLOT_BROADCAST_INTERVAL_MS` parsed from env var with no bounds check. Setting to 0 creates a firehose.
- `STAKER_COUNT_POLL_INTERVAL_MS` and `TOKEN_SUPPLY_POLL_INTERVAL_MS` similarly parsed without bounds.
- The staker poll decodes all UserStake accounts in a loop. If thousands of stakers exist, this is O(N) decoding per poll cycle (every 30s). Currently manageable but could become expensive.
- Error handling in staker poll: inner `catch {}` silently skips malformed accounts. No logging. If Anchor decode fails on a valid account due to a schema change, it's silently dropped.

### 4. Helius Enhanced Webhook -> protocolStore (`app/app/api/webhooks/helius/route.ts`)

**Purpose**: Receive account change notifications from Helius and update the in-memory protocol store.

**Account change flow** (`handleAccountChanges()`):
1. For each account in the payload, look up its pubkey in `KNOWN_PROTOCOL_ACCOUNTS`
2. Unknown accounts: log warning, skip
3. SystemAccount (CarnageSolVault): store `{lamports, updatedAt}`
4. Anchor-decodable accounts: decode raw Base64 data using the corresponding program's coder
5. Normalize via `anchorToJson` (converts BN to number, PublicKey to base58, BigInt fields preserved)
6. Store in protocolStore (triggers SSE broadcast)
7. On decode error: store raw data with `decodeError` flag (fail-soft -- data is preserved but not decoded)

**Observations**:
- The `CarnageSolVault` handling at line 554 reads `nativeBalanceChange` not `lamports`. This is a balance CHANGE (delta), not absolute balance. If the initial seed had the correct absolute lamports and the webhook delivers only the change, the stored value could be wrong. Need to verify Helius Enhanced Webhook payload format.
- No validation of decoded field values. A Helius bug delivering wrong bytes would produce silently wrong decoded data.
- The lazy program initialization (`if (!programs)`) creates new Program instances per webhook call. These are lightweight (just IDL + connection reference) so this is fine.

### 5. Protocol Store (`app/lib/protocol-store.ts`)

**Purpose**: In-memory cache for protocol PDA states, with SSE broadcast on changes.

**Dedup mechanism**: `lastSerialized` map tracks JSON-serialized representation per key. If the new serialized value matches the last, broadcast is skipped (but data is still stored). This prevents redundant SSE pushes when Helius delivers duplicate webhooks.

**globalThis singleton**: Correctly implemented.

**Observations**:
- The dedup uses `JSON.stringify(data, bigintReplacer)`. If bigintReplacer has inconsistent output for equivalent values, dedup could fail (always broadcast). This would increase SSE traffic but not cause data issues.
- No maximum cache size. If the set of monitored accounts grows, memory grows linearly. Currently 8+ accounts, well within bounds.

### 6. Browser SSE + Polling Fallback (`app/hooks/useProtocolState.ts`)

**Purpose**: Browser-side hook consuming SSE for real-time protocol state.

**SSE connection**:
- Opens `EventSource("/api/sse/protocol")`
- Receives `initial-state` event (full snapshot from protocolStore) and `protocol-update` events (incremental)
- Parses with `bigintReviver` to reconstitute BigInt fields
- Exponential backoff on error: 1s, 2s, 4s, ... up to 30s max
- Visibility-aware: closes SSE when tab is hidden, reconnects on return

**Polling fallback**:
- After 30s of SSE downtime, starts polling `getMultipleAccountsInfo` every 60s
- Stores `{label: "rpc-poll", lamports, owner, dataLength, updatedAt}` per account
- **PROBLEM**: This is raw AccountInfo metadata, NOT Anchor-decoded data. Consumer hooks (useEpochState, usePoolPrices) check for decoded fields like `currentEpoch` or `reserveA`. With raw data, these checks fail and consumers fall back to null/loading state.
- The fallback is functionally a "keep-alive" signal showing accounts exist, but doesn't provide usable structured data.
- Stops polling when SSE reconnects (stops on successful `initial-state` or `protocol-update` event).

### 7. Transaction Confirmation (`app/lib/confirm-transaction.ts`)

**Purpose**: HTTP polling-based transaction confirmation (replaces unreliable WebSocket confirmations).

**Mechanism**:
- Polls `getSignatureStatuses` every 2s
- Waits for `confirmed` or `finalized` status
- Checks block height against `lastValidBlockHeight` to detect expired transactions
- 90s safety timeout

**Observations**:
- Uses `connection.getBlockHeight("confirmed")` for block height check -- correct commitment level.
- Returns `err` from the signature status, properly detecting on-chain failures.
- The caller (useSwap, multi-hop-builder) correctly checks `confirmation.err` after confirmation.
- `getSignatureStatuses` uses default commitment. In `@solana/web3.js` v1, this inherits from the Connection default ("confirmed"). Correct behavior.

## Trust Model

### Trust Hierarchy

```
Tier 1 (Untrusted): Browser clients
  - All RPC through proxy
  - Method-allowlisted
  - Rate-limited (300/min/IP)
  - No API key exposure

Tier 2 (Implicitly Trusted): Helius RPC Provider
  - All server-side RPC (ws-subscriber, webhook handler, health check)
  - No cross-provider verification
  - No schema validation on responses
  - Single point of failure for data integrity

Tier 3 (Authenticated External): Helius Webhooks
  - Fail-closed auth in production
  - Timing-safe secret comparison
  - 1MB body limit, rate-limited
  - Payload data trusted after auth

Tier 4 (Internal): protocolStore -> SSE -> Browser
  - In-memory, no persistence
  - Broadcast dedup by serialization
  - Connection-capped SSE (H008)
```

### Trust Boundaries

1. **Browser <-> RPC Proxy**: The proxy is the primary trust boundary. It prevents API key leakage and limits RPC methods. The batch amplification weakness means the boundary is porous for credit consumption.

2. **Helius <-> Server**: Implicitly trusted. The server trusts all data from Helius (account data, slot numbers, token supply). No independent verification. If Helius were compromised, all frontend state would be corrupted.

3. **Webhook <-> Server**: Auth boundary with timing-safe comparison. After auth passes, the raw account bytes are decoded and propagated without further validation.

4. **protocolStore <-> Browser**: The SSE broadcast is a delivery mechanism, not a trust boundary. The browser receives whatever the server stores. The bigintReviver on the browser side reconstitutes data types but does not validate values.

## State Analysis

### In-Memory State

| Store | Location | Persistence | Invalidation |
|-------|----------|-------------|-------------|
| Connection singleton | `connection.ts` module-level `let` | Process lifetime | URL change |
| protocolStore | `protocol-store.ts` globalThis | Process lifetime | Never (append-only) |
| ws-subscriber state | `ws-subscriber.ts` globalThis | Process lifetime | Never |
| creditCounter | `credit-counter.ts` globalThis | Process lifetime | Manual reset only |
| Rate limit entries | `rate-limit.ts` module-level Map | Process lifetime | 60s cleanup sweep |
| RPC failover state | `rpc/route.ts` module-level `let` | Process lifetime | Updated on success |

### Staleness Characteristics

| Data | Source | Update Frequency | Staleness Detection |
|------|--------|-----------------|---------------------|
| Slot number | WS onSlotChange | ~400ms | 15s staleness monitor |
| Pool reserves | Helius Enhanced Webhook | Per-transaction | None (event-driven) |
| Epoch state | Helius Enhanced Webhook | Per-epoch (~5min) | None (event-driven) |
| Token supply | HTTP poll | 60s | None |
| Staker count | gPA poll | 30s | None |
| User balances | Browser HTTP poll | 30s | None |

## Dependencies (External APIs, Packages, Services)

### Helius (Primary RPC + Webhook Provider)
- **RPC**: `HELIUS_RPC_URL` for all server-side calls, `HELIUS_RPC_URL_FALLBACK` for failover
- **WebSocket**: Server-only, derived from HELIUS_RPC_URL by replacing `https://` with `wss://`
- **Enhanced Webhooks**: Delivers account data changes to `/api/webhooks/helius`
- **Raw Webhooks**: Delivers transaction logs to the same endpoint
- **Credit consumption**: Monitored by `credit-counter.ts` but not enforced

### @solana/web3.js (v1)
- Connection class for all RPC communication
- PublicKey for address handling
- No direct WebSocket management (delegated to Connection internals)

### @coral-xyz/anchor
- Program instances for account deserialization (IDL-based coders)
- BN type for numeric fields (converted to BigInt/number at boundaries)

## Focus-Specific Analysis

### RPC Endpoint Configuration

The codebase uses environment variables for RPC configuration, never hardcoded URLs in production code:

| Env Var | Used By | Cluster Safety |
|---------|---------|----------------|
| `HELIUS_RPC_URL` | connection.ts, rpc/route.ts | Per-Railway-service |
| `HELIUS_RPC_URL_FALLBACK` | rpc/route.ts | Per-Railway-service |
| `NEXT_PUBLIC_RPC_URL` | connection.ts (server fallback), rpc/route.ts | Per-Railway-service |
| `NEXT_PUBLIC_CLUSTER` | protocol-config.ts | Drives address resolution |

H009 (devnet fallback in production) is addressed: no `clusterApiUrl` calls, no hardcoded devnet URLs, and `protocol-config.ts` resolves addresses based on `NEXT_PUBLIC_CLUSTER` env var.

### RPC Response Usage in Security Decisions

| RPC Call | Used For | Security Impact |
|----------|----------|----------------|
| `getMultipleAccountsInfo` (ws-subscriber) | Seed protocolStore | Display only (not financial) |
| `getTokenSupply` | Display token supply | Display only |
| `getProgramAccounts` | Count stakers | Display only |
| `getSlot` | Staleness detection, display | Staleness is operational, not security |
| Pool reserves (from protocolStore) | Quote engine calculations | Quotes drive `minimumOutput` but on-chain enforces |
| Epoch tax rates (from protocolStore) | Route display | Display only; on-chain tax calculation is authoritative |
| `getBalance` (useTokenBalances) | Display user balance | Display only |
| `getSignatureStatuses` (confirm-tx) | TX confirmation | Financial -- but checks `err` field correctly |
| `getBlockHeight` (confirm-tx) | Blockhash expiry | Financial -- correct "confirmed" commitment |

**Key insight**: No RPC response is used as the sole basis for a financial decision. The on-chain programs enforce slippage, tax rates, and balances independently. RPC data drives UI display and transaction construction (blockhash, account addresses), but the on-chain enforcement is the actual security boundary.

### Failover Behavior

**Server-side (ws-subscriber)**: No explicit failover. Uses a single Connection instance. If Helius WS goes down, the staleness monitor activates HTTP polling as a fallback. If HTTP also fails, slot data goes stale but no crash occurs (errors are caught and logged).

**Browser-side (useProtocolState)**: SSE with exponential backoff reconnect. After 30s of SSE downtime, activates HTTP polling via `getMultipleAccountsInfo`. However, this polling returns raw data, not decoded data (see findings).

**RPC Proxy**: Three-endpoint failover with sticky routing. Network errors and HTTP 5xx trigger next endpoint. RPC-level errors (e.g., invalid params) are passed through to the client.

### Rate Limiting and Request Batching

**Rate limits**:
- RPC proxy: 300 req/min per IP
- Webhook: 120 req/min per IP
- SOL price: 30 req/min per IP

**Batch handling**: The RPC proxy forwards JSON-RPC batches as-is. Each method in the batch is validated against the allowlist, but the rate limiter counts the entire batch as 1 request.

**Credit tracking**: `credit-counter.ts` records per-method counts. This is informational only (exposed via `/api/health`). No enforcement based on credit consumption.

### WebSocket Subscription Reliability

The ws-subscriber uses `connection.onSlotChange()` for real-time slot data. This is the only WS subscription in the codebase. Key reliability features:

1. **Staleness detection**: Checks every 10s if the last slot was received >15s ago
2. **Fallback activation**: Starts HTTP `getSlot` polling every 5s when stale
3. **Recovery detection**: Stops fallback when WS data resumes (slot received within 15s)
4. **Throttling**: Only broadcasts slot changes every 5s (default) to avoid SSE firehose

**Gap in WS reliability**: No explicit reconnection logic for the WS subscription itself. The `@solana/web3.js` Connection class has internal WS reconnection, but its behavior varies by version. If the underlying WS connection dies and Connection's internal reconnect fails, the staleness monitor will catch it within 15s and switch to HTTP fallback.

### Account Data Freshness

The protocolStore acts as a cache with "last-write-wins" semantics. Data freshness depends on the update source:

- **batchSeed (boot)**: One-time snapshot at "confirmed" commitment. Stale until first webhook delivery.
- **Helius Enhanced Webhook**: Near-real-time. Helius delivers account changes within seconds of on-chain finalization. No explicit commitment level in the webhook (Helius determines this).
- **HTTP polls**: 30-60s intervals. Adequate for non-time-critical data (token supply, staker count).
- **WS slot subscription**: Near-real-time (~400ms per slot). Throttled to 5s broadcasts.

## Cross-Focus Intersections

### CHAIN-01 (Transaction Construction)
- Transaction builders (`swap-builders.ts`, `multi-hop-builder.ts`) use `getConnection()` to fetch `getLatestBlockhash("confirmed")`. The commitment level is correct for transaction construction.
- `skipPreflight: true` is used for v0 transactions (multi-hop) due to devnet simulation issues. This is a known, documented trade-off (MEMORY.md). For non-v0 single-pool swaps, `skipPreflight: false` is used.

### CHAIN-04 (State Synchronization)
- The protocolStore is the central state synchronization mechanism. Its correctness depends on both ws-subscriber (seed + polls) and Helius webhooks (real-time updates).
- The SSE protocol route sends initial state snapshots on connect, preventing new clients from starting with empty data.

### SEC-02 (Signature Verification)
- Webhook auth uses `timingSafeEqual` with direct string comparison against `HELIUS_WEBHOOK_SECRET`. This appears to be Helius's "authHeader" webhook authentication (the configured value is sent as-is in the Authorization header). If Helius ever changes to HMAC-based auth, this comparison would break.

### ERR-01 (Error Handling)
- ws-subscriber wraps all async operations in try/catch blocks. Errors in individual account decoding don't crash the batch seed.
- The staker poll's inner catch block is empty (silent skip). This could mask systematic decoding failures.
- The instrumentation.ts try/catch ensures a failed ws-subscriber init doesn't crash the Next.js server.

### DATA-04 (Logging/Disclosure)
- The health endpoint exposes `wsSubscriber` status (including `latestSlot`, `lastSlotReceivedAt`) and `creditCounter` stats. This provides attackers with information about RPC usage patterns and infrastructure state.
- The RPC proxy logs blocked method names (`console.warn`). This is appropriate.

## Cross-Reference Handoffs

1. **-> ERR-01**: Silent catch in staker poll (`ws-subscriber.ts:414`) -- systematic decode failures masked
2. **-> SEC-02**: Verify Helius authHeader format matches plain string comparison (not HMAC)
3. **-> DATA-01**: protocolStore has no persistence -- server restart = data loss until re-seed
4. **-> INFRA-03**: RPC proxy failover state is process-local, not shared across instances
5. **-> LOGIC-01**: useRoutes depends on pool reserves from protocolStore -- validate that reserve data is always present and in expected ranges before quote computation
6. **-> API-01**: The SSE protocol route serves the initial state snapshot from protocolStore. If protocolStore is empty (boot race condition), the initial snapshot is empty, and hooks show loading state until the first webhook arrives.

## Risk Observations

### HIGH

1. **RPC Proxy Batch Amplification (H-NEW-01)**
   - File: `app/app/api/rpc/route.ts:102-105`
   - Impact: Helius credit exhaustion, denial of service to all users
   - Likelihood: Probable (trivial to exploit, requires only HTTP requests)
   - Mitigation: Cap batch size (e.g., max 10 requests per batch) or count each method against the rate limit

2. **No Anchor Decode Output Validation (H-NEW-02)**
   - Files: `app/app/api/webhooks/helius/route.ts:589-593`, `app/lib/ws-subscriber.ts:144`
   - Impact: Corrupted protocol state propagated to all SSE clients. Quote engine computes with wrong reserves/rates. Users see wrong prices.
   - Likelihood: Possible (requires Helius bug or man-in-the-middle between Helius infra and Solana validators)
   - Mitigation: Add bounds validation on decoded fields (tax BPS 0-10000, reserves > 0, epoch number non-decreasing)

### MEDIUM

3. **Browser Polling Fallback Data Shape Mismatch (M-NEW-01)**
   - File: `app/hooks/useProtocolState.ts:196-211`
   - Impact: During SSE outages, protocol state hooks return null/loading. UI degrades to "loading" state indefinitely.
   - Mitigation: Either decode accounts in the browser fallback path or display explicit "connection lost" UI

4. **RPC Proxy No Body Size Limit (M-NEW-02)**
   - File: `app/app/api/rpc/route.ts:92-100`
   - Impact: Memory exhaustion via large POST body
   - Mitigation: Add Content-Length check before parsing (same pattern as webhook route)

5. **Health Endpoint Information Disclosure (M-NEW-03, H028 recheck)**
   - File: `app/app/api/health/route.ts:63-70`
   - Impact: Attacker learns internal state (slot numbers, RPC credit usage, WS health)
   - Mitigation: Strip internal details from public response; expose full details only to authenticated monitoring

6. **CarnageSolVault Stores Balance Change Not Absolute Balance (M-NEW-04)**
   - File: `app/app/api/webhooks/helius/route.ts:554`
   - Impact: CarnageSolVault lamports in protocolStore could be incorrect (delta vs absolute)
   - Mitigation: Verify Helius Enhanced Webhook payload format for `nativeBalanceChange`

7. **Env Var Interval Parsing Without Bounds (M-NEW-05)**
   - Files: `app/lib/ws-subscriber.ts:251-253, 331-333, 369-371`
   - Impact: Misconfigured env vars (e.g., `SLOT_BROADCAST_INTERVAL_MS=0`) create a firehose
   - Mitigation: Add `Math.max(minValue, parseInt(...))` bounds on parsed intervals

### LOW

8. **Connection Singleton Not on globalThis (L-NEW-01)**
   - File: `app/lib/connection.ts:21-22`
   - Impact: HMR in development creates orphaned WS connections. Production unaffected.
   - Mitigation: Migrate to globalThis pattern (matches other singletons)

9. **stakedBalance.toNumber() Precision Ceiling (L-NEW-02)**
   - File: `app/lib/ws-subscriber.ts:219`
   - Impact: Precision loss if PROFIT supply exceeds 2^53 in raw base units. Currently safe.
   - Mitigation: Use BigInt arithmetic for staker balance aggregation

10. **Credit Counter Is Informational Only (L-NEW-03)**
    - File: `app/lib/credit-counter.ts`
    - Impact: No enforcement based on credit consumption. Exhaustion not prevented.
    - Mitigation: Add alerting threshold (e.g., log warning at 80% of expected daily credits)

11. **Staker Poll Silent Catch (L-NEW-04)**
    - File: `app/lib/ws-subscriber.ts:414`
    - Impact: Systematic decode failures in UserStake accounts are silently skipped
    - Mitigation: Add `console.warn` for decode failures to aid debugging

12. **useTokenBalances Polls Every 30s Without Visibility Check in Interval (L-NEW-05)**
    - File: `app/hooks/useTokenBalances.ts:127-131`
    - Impact: The interval is cleaned up on isActive change via the effect dependency, but between visibility checks, polls continue. Minor credit waste.
    - Mitigation: Already mitigated by the effect cleanup on isActive change.

13. **RPC Proxy Sticky Failover State Process-Local (L-NEW-06)**
    - File: `app/app/api/rpc/route.ts:69`
    - Impact: In multi-instance deployment, each instance has independent failover state
    - Mitigation: Not needed for single-instance Railway deployment. Document for future scaling.

14. **No Explicit Timeout on Helius Upstream Fetch (L-NEW-07)**
    - File: `app/app/api/rpc/route.ts:144-148`
    - Impact: If Helius hangs, the proxy request hangs (Node.js fetch default timeout is very long)
    - Mitigation: Add `AbortController` with 30s timeout on upstream fetch

## Novel Attack Surface Observations

### 1. Credit Exhaustion via Batch Amplification
(Detailed in Key Findings #1 and Risk Observation #1)

### 2. Stale-Data-Driven UX Manipulation
An attacker who can delay or prevent Helius webhook delivery (e.g., by DDoS-ing the webhook endpoint at the rate limit boundary) would cause the protocolStore to contain increasingly stale data. Other users would see old prices and old tax rates. While on-chain slippage enforcement prevents direct financial loss, users might make trading decisions based on stale displayed prices (e.g., appearing to get a better deal than reality).

The webhook rate limit of 120 req/min from Helius's IP means if Helius needs to send more than 120 updates per minute (heavy trading period), some would be rate-limited. However, Helius batches multiple account changes per webhook call, so 120 calls/min should cover heavy trading.

### 3. Boot Race: Empty protocolStore Before First Data
Between server boot and `batchSeed()` completion, the protocolStore is empty. If an SSE client connects during this window (e.g., the server restarts and a browser reconnects immediately), the client receives an empty initial-state snapshot. All protocol hooks return null/loading until batchSeed completes and subsequent webhook deliveries arrive.

This is mitigated by the `await batchSeed(connection)` in `init()` being called from `instrumentation.ts register()` which completes before the server starts accepting requests. However, if `init()` fails (caught by the try/catch in instrumentation.ts), the server starts with an empty protocolStore.

## Questions for Other Focus Areas

1. **SEC-02**: Does Helius send the configured `authHeader` value directly in the HTTP `Authorization` header, or does it derive an HMAC? The current code compares the raw header against the raw secret.

2. **INFRA-03**: Is Railway configured to run a single instance? The in-memory state model (protocolStore, rate-limit, credit-counter, SSE connections) is correct only for single-instance deployments.

3. **DATA-01**: Is there a risk of protocolStore data growing unbounded? Currently it stores ~15 entries (8 PDAs + 2 supplies + 1 slot + 1 staking stats + potential raw fallbacks). This is bounded by the set of monitored accounts.

4. **LOGIC-01**: When the route engine reads pool reserves from protocolStore (via usePoolPrices), does it validate that reserves are positive before computing quotes? Division by zero or negative reserves would produce invalid routes.

5. **ERR-02**: What happens to the SSE connection if the server runs out of memory? Does Railway restart the container? If so, all SSE clients would reconnect simultaneously (thundering herd).

## Raw Notes

### Commitment Level Inventory

Every RPC call's commitment level:

| Location | Call | Commitment | Notes |
|----------|------|-----------|-------|
| connection.ts:69 | Connection default | "confirmed" | Global default |
| ws-subscriber batchSeed | getMultipleAccountsInfo | confirmed (default) | |
| ws-subscriber batchSeed | getTokenSupply | confirmed (default) | |
| ws-subscriber batchSeed | getSlot | confirmed (default) | |
| ws-subscriber batchSeed | getProgramAccounts | confirmed (default) | |
| ws-subscriber fallback | getSlot | confirmed (default) | |
| ws-subscriber supply poll | getTokenSupply | confirmed (default) | |
| ws-subscriber staker poll | getProgramAccounts | confirmed (default) | |
| useProtocolState fallback | getMultipleAccountsInfo | confirmed (default) | |
| useTokenBalances | getBalance, getParsedTokenAccountsByOwner | confirmed (default) | |
| confirm-transaction | getSignatureStatuses | confirmed (default) | |
| confirm-transaction:53 | getBlockHeight | "confirmed" (explicit) | |
| multi-hop-builder:335 | getLatestBlockhash | "confirmed" (explicit) | |
| useSwap:757 | getLatestBlockhash | "confirmed" (explicit) | |
| health/route | getSlot | confirmed (default) | |

All are "confirmed" -- consistent across the codebase. No "processed" commitment used for financial operations (FP-018 -- false positive check passed).

### RPC Proxy Method Allowlist

```
getAccountInfo, getBalance, getMultipleAccounts, getTokenAccountsByOwner,
getTokenAccountBalance, getProgramAccounts, getLatestBlockhash, sendTransaction,
simulateTransaction, getSignatureStatuses, confirmTransaction, getBlockHeight,
getSlot, getAddressLookupTable, getPriorityFeeEstimate, getMinimumBalanceForRentExemption
```

`sendTransaction` is the most sensitive -- it allows browsers to submit arbitrary (already-signed) transactions through the proxy. This is necessary for the wallet adapter sign-then-send flow but means the proxy is a transaction relay, not just a read proxy.

### Helius Credit Consumption Estimate (per minute, steady state)

| Source | Credits/min |
|--------|-------------|
| ws-subscriber supply poll | 2 (getTokenSupply x2 every 60s) |
| ws-subscriber staker poll | 2 (gPA every 30s) |
| ws-subscriber slot fallback (if active) | 12 (getSlot every 5s) |
| Browser RPC via proxy (per user) | ~6 (balance refresh every 30s = 2 calls, misc) |
| Health check (internal) | ~0 (uses cached slot) |

Total server-side: ~4 credits/min steady state (no fallback), ~16 credits/min with slot fallback active.
Per-user browser: ~6 credits/min.
10 active users: ~64 credits/min.
100 active users: ~604 credits/min.

The batch amplification attack could consume 300 * N credits/min per IP (N = batch size).
