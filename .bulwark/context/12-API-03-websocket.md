---
task_id: db-phase1-api-03
provides: [api-03-findings, api-03-invariants]
focus_area: api-03
files_analyzed:
  - app/lib/ws-subscriber.ts
  - app/lib/sse-manager.ts
  - app/lib/sse-connections.ts
  - app/lib/protocol-store.ts
  - app/lib/bigint-json.ts
  - app/lib/credit-counter.ts
  - app/lib/connection.ts
  - app/lib/rate-limit.ts
  - app/lib/protocol-config.ts
  - app/app/api/sse/protocol/route.ts
  - app/app/api/sse/candles/route.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/health/route.ts
  - app/app/api/rpc/route.ts
  - app/app/api/sol-price/route.ts
  - app/app/api/candles/route.ts
  - app/app/api/carnage-events/route.ts
  - app/hooks/useProtocolState.ts
  - app/hooks/useChartSSE.ts
  - app/hooks/useCurrentSlot.ts
  - app/hooks/useEpochState.ts
  - app/hooks/usePoolPrices.ts
  - app/instrumentation.ts
  - scripts/load-test/k6-sse.js
finding_count: 12
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 5, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# API-03: WebSocket & Real-Time Security — Condensed Summary

## Key Findings (Top 10)

1. **CarnageSolVault lamport extraction from Enhanced Webhook is incorrect**: Uses `nativeBalanceChange` (a delta) rather than absolute lamports, causing stale/wrong vault balance displayed to all SSE clients — `app/app/api/webhooks/helius/route.ts:554-558`
2. **SSE candle route forwards ALL sseManager events, not just candle-update**: The candle SSE subscriber does not filter by event type like the protocol route does, meaning protocol-update events also leak to candle-only clients — `app/app/api/sse/candles/route.ts:71-76`
3. **No authentication on SSE endpoints**: Both `/api/sse/protocol` and `/api/sse/candles` accept unauthenticated GET requests from any origin. Connection cap mitigates DoS but not data exfiltration — `app/app/api/sse/protocol/route.ts:41`, `app/app/api/sse/candles/route.ts:40`
4. **Slot broadcast interval controllable via env var without bounds**: `SLOT_BROADCAST_INTERVAL_MS` parsed from env with no min/max validation; setting to 0 or 1 would broadcast every slot (~400ms) to all SSE clients — `app/lib/ws-subscriber.ts:251-254`
5. **SSE connection tracker double-release race**: If both `abort` signal handler and `cancel()` fire, `release()` runs twice. The `released` flag protects against double-release of the connection counter, but there is no protection against `cancel()` firing first and the `abort` handler running `unsubscribe()` again — `app/app/api/sse/protocol/route.ts:110-124`
6. **Protocol store uses JSON string equality for dedup — fragile with object key ordering**: `setAccountState` compares `JSON.stringify(data)` to detect duplicates. Object key order can vary between Anchor decode paths, causing identical data to bypass dedup and trigger redundant broadcasts — `app/lib/protocol-store.ts:54-58`
7. **Health endpoint exposes internal state including credit counter method breakdown**: `getStats()` returns full per-method RPC call counts and ws-subscriber internal state to unauthenticated clients — `app/app/api/health/route.ts:66-72`
8. **BigInt reviver accepts arbitrary `__bigint` tags from SSE — potential for prototype-like injection**: Client-side `bigintReviver` converts any `{__bigint: "..."}` object to `BigInt()` without validating the string content. A malicious SSE payload could inject values that cause `BigInt()` to throw — `app/lib/bigint-json.ts:46-51`
9. **useProtocolState RPC polling fallback reads raw accountInfo without Anchor decoding**: When SSE is down for >30s, `pollViaRpc` returns raw `{lamports, owner, dataLength}` instead of decoded account data, causing downstream hooks to receive structurally different data — `app/hooks/useProtocolState.ts:196-211`
10. **No CORS restriction on SSE endpoints**: SSE routes do not set `Access-Control-Allow-Origin` headers. Browser same-origin policy applies by default in Next.js App Router, but explicit CORS headers are absent — `app/app/api/sse/protocol/route.ts:127-135`

## Critical Mechanisms

- **DBS Pipeline (ws-subscriber -> protocolStore -> sseManager -> SSE routes -> browser hooks)**: The entire real-time data path. Server-side WS from Helius feeds the protocol store, which broadcasts via SSE manager to all connected browser EventSource clients. Single point of failure: the single Next.js process — `app/lib/ws-subscriber.ts`, `app/lib/protocol-store.ts`, `app/lib/sse-manager.ts`
- **SSE Connection Rate Limiting (H008 fix)**: Per-IP (10) and global (5000) connection caps with 30-min auto-release for zombie connections. Enforced at SSE route entry before ReadableStream creation — `app/lib/sse-connections.ts:49-57`
- **Webhook -> SSE broadcast chain**: Helius webhook POSTs trigger protocolStore.setAccountState() which triggers sseManager.broadcast() which pushes to all subscribed SSE route handlers. Single broadcast = N client pushes (fan-out) — `app/app/api/webhooks/helius/route.ts:525-633`
- **Staleness monitor + fallback**: When WS slot updates stop for >15s, ws-subscriber activates HTTP polling fallback at 5s intervals. When WS recovers, fallback is stopped — `app/lib/ws-subscriber.ts:299-323`
- **Client-side reconnect with exponential backoff**: Both useProtocolState and useChartSSE implement 1s->30s max exponential backoff on SSE disconnection — `app/hooks/useProtocolState.ts:285-306`, `app/hooks/useChartSSE.ts:89-95`

## Invariants & Assumptions

- INVARIANT: SSE connection count must never exceed MAX_GLOBAL (5000) — enforced at `app/lib/sse-connections.ts:50`
- INVARIANT: Per-IP SSE connection count must never exceed MAX_PER_IP (10) — enforced at `app/lib/sse-connections.ts:52`
- INVARIANT: Zombie SSE connections are auto-released after 30 minutes — enforced at `app/lib/sse-connections.ts:88-93`
- INVARIANT: Protocol store dedup prevents identical data from being broadcast — enforced at `app/lib/protocol-store.ts:58` (fragile — depends on JSON key ordering)
- INVARIANT: ws-subscriber initializes only once (double-init guard) — enforced at `app/lib/ws-subscriber.ts:456`
- ASSUMPTION: Helius WS connection will stay alive (staleness monitor activates fallback if not) — validated at `app/lib/ws-subscriber.ts:306-307`
- ASSUMPTION: SSE heartbeat every 15s is sufficient to keep Railway/nginx proxy connections alive (60-120s timeout) — validated at `app/app/api/sse/protocol/route.ts:99`
- ASSUMPTION: Single Next.js process means in-memory SSE pub/sub is sufficient (no Redis needed) — validated at `app/lib/sse-manager.ts:8-11` / NOT validated for horizontal scaling
- ASSUMPTION: x-forwarded-for header accurately reflects client IP (trusts Railway proxy) — validated at `app/lib/rate-limit.ts:130-134`
- ASSUMPTION: JSON.stringify key order is deterministic for same input — UNVALIDATED for objects from different code paths (Anchor decode vs raw webhook data)

## Risk Observations (Prioritized)

1. **CarnageSolVault lamport extraction incorrect**: `app/app/api/webhooks/helius/route.ts:554` — Uses `nativeBalanceChange` (delta) instead of absolute balance. SSE clients receive wrong vault balance after every tx touching the vault. Impact: misleading UI, potentially incorrect Carnage decisions by users.
2. **SSE candle route leaks protocol events**: `app/app/api/sse/candles/route.ts:71-76` — No event type filter means protocol-update payloads (containing account states) are forwarded to candle-only consumers. Impact: unnecessary bandwidth, data exposure to chart-only clients.
3. **useProtocolState polling fallback returns raw accountInfo**: `app/hooks/useProtocolState.ts:196-211` — During SSE outage, downstream hooks (useEpochState, usePoolPrices) receive `{lamports, owner, dataLength}` instead of decoded fields like `{currentEpoch, crimeBuyTaxBps}`. Impact: hooks return null during fallback, breaking UI state.
4. **Protocol store dedup fragility**: `app/lib/protocol-store.ts:54-58` — JSON key ordering is not guaranteed across V8 versions or Anchor decode implementations. False negatives on dedup = redundant SSE broadcasts to all clients.
5. **Health endpoint information disclosure (H028)**: `app/app/api/health/route.ts:66-72` — Exposes ws-subscriber internal state (slot, connection status) and RPC credit breakdown. Useful for reconnaissance.
6. **SSE broadcast fan-out amplification**: `app/lib/sse-manager.ts:60-69` — A single protocolStore update triggers N subscriber callbacks. With 5000 clients, each webhook delivery creates 5000 outbound writes. No backpressure mechanism.
7. **BigInt parsing from untrusted SSE data**: `app/lib/bigint-json.ts:46-51` — `BigInt(value.__bigint)` throws on non-numeric strings. Malformed SSE data could crash the client-side reviver (caught by outer try-catch in `useProtocolState.ts:268-280`).

## Novel Attack Surface

- **Stale-data-during-fallback UI confusion**: When SSE goes down for >30s, the client activates RPC polling that returns structurally different data (raw accountInfo vs decoded). Downstream hooks silently return null. An attacker who can cause SSE downtime (e.g., by exhausting the 5000 global connection cap) forces all legitimate users into a degraded state where epoch tax rates, pool reserves, and staking data disappear from the UI, potentially causing users to make uninformed trading decisions.
- **Webhook-to-SSE amplification as a cost attack**: Each Helius webhook delivery triggers SSE broadcasts to all connected clients. An attacker who triggers many on-chain events (cheap SOL transfers touching monitored PDAs) can amplify into O(N) outbound SSE writes per webhook, potentially exhausting server CPU or Railway bandwidth.

## Cross-Focus Handoffs

- → **SEC-01 (Access Control)**: SSE endpoints have no authentication — verify if this is acceptable for public protocol data or if any private data leaks through the SSE stream.
- → **ERR-01 (Error Handling)**: ws-subscriber silently swallows decode errors for individual accounts but continues processing. Verify that persistent decode failures don't result in permanently stale data for specific accounts.
- → **DATA-01 (Data Persistence)**: Protocol store is purely in-memory. On process restart, all state is lost until ws-subscriber re-seeds. Verify that the re-seeding is fast enough that SSE clients don't display stale data for extended periods.
- → **INFRA-03 (Deployment/Config)**: SSE connection limits and all poll intervals are configurable via env vars (some without bounds validation). Verify Railway env vars are set correctly for production.
- → **CHAIN-02 (RPC Trust)**: ws-subscriber trusts all RPC responses without validation. If Helius returns corrupted data, it flows directly into protocolStore and SSE broadcasts. Anchor decode provides some structural validation but not semantic validation.

## Trust Boundaries

The real-time data pipeline has four distinct trust boundaries: (1) Helius WS and HTTP RPC responses are trusted as-is by ws-subscriber — there is no response validation beyond Anchor decode success/failure. (2) Helius Enhanced Webhook payloads are authenticated via timingSafeEqual on the Authorization header, with fail-closed behavior in production. (3) The in-memory protocolStore is trusted by all SSE consumers; any write to the store triggers a broadcast to all connected clients with no per-field validation. (4) Browser-side SSE data is parsed with JSON.parse and a BigInt reviver but no schema validation — malformed or unexpected fields are silently consumed or cause nulls in downstream hooks.
<!-- CONDENSED_SUMMARY_END -->

---

# API-03: WebSocket & Real-Time Security — Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements a server-push architecture (Dinh's Bulwark Streaming / DBS) using Server-Sent Events (SSE) for real-time protocol state delivery from server to browser. The architecture is well-designed for its single-process Railway deployment: WebSocket connections to Helius feed an in-memory protocol store, which broadcasts via an SSE pub/sub manager to connected browser clients.

The overall security posture is **good** with several notable safeguards already in place (connection rate limiting, webhook authentication, exponential backoff reconnection, staleness monitoring). However, there are functional correctness issues in the data pipeline (CarnageSolVault lamport extraction, candle route event leaking, polling fallback data shape mismatch) and a few defensive gaps (no SSE endpoint authentication, environment variable validation, dedup fragility).

No critical vulnerabilities were identified. One high-severity observation (CarnageSolVault data incorrectness) could cause misleading UI state for users making financial decisions.

## Scope

All off-chain code related to WebSocket, SSE, and real-time data flows:
- Server-side WebSocket subscriber (ws-subscriber.ts)
- SSE infrastructure (sse-manager.ts, sse-connections.ts, protocol-store.ts)
- SSE API routes (/api/sse/protocol, /api/sse/candles)
- Webhook -> SSE broadcast path (/api/webhooks/helius)
- Client-side SSE hooks (useProtocolState, useChartSSE, useCurrentSlot, useEpochState, usePoolPrices)
- Supporting infrastructure (connection.ts, bigint-json.ts, credit-counter.ts, rate-limit.ts, instrumentation.ts)
- Load testing infrastructure (k6-sse.js)
- Related API routes that consume or serve real-time data (/api/health, /api/rpc, /api/sol-price, /api/candles, /api/carnage-events)

**Out of scope:** Anchor/Rust on-chain programs in `programs/` directory.

## Key Mechanisms

### 1. DBS Data Pipeline Architecture

```
[Helius WS] ─onSlotChange──▸ [ws-subscriber]
                                     │
                                     ├──batchSeed──▸ [protocolStore] (setAccountStateQuiet)
                                     ├──slotPoll────▸ [protocolStore] (setAccountState → SSE broadcast)
                                     ├──supplyPoll──▸ [protocolStore] (setAccountState → SSE broadcast)
                                     └──stakerPoll──▸ [protocolStore] (setAccountState → SSE broadcast)

[Helius Webhook] ─POST──▸ [webhook handler]
                                     │
                                     ├──rawTX──▸ [DB insert + candle upsert + sseManager.broadcast("candle-update")]
                                     └──accountChange──▸ [Anchor decode → protocolStore.setAccountState → SSE broadcast]

[protocolStore.setAccountState]
     │
     ├──dedup check (JSON string equality)
     └──sseManager.broadcast("protocol-update", {account, data})
            │
            └──for each subscriber callback:
                 ├──/api/sse/protocol route → client.enqueue()
                 └──/api/sse/candles route → client.enqueue() (NO filter!)

[Browser] ─EventSource──▸ /api/sse/protocol
                              │
                              ├──initial-state event (full snapshot)
                              ├──protocol-update events (incremental)
                              └──heartbeat comments (: heartbeat)
                                     │
                                     └──useProtocolState hook → useEpochState, usePoolPrices, useCurrentSlot, etc.
```

**5 Whys — Why SSE instead of WebSocket?**
1. SSE is unidirectional (server→client) — protocol state is read-only for browsers
2. SSE works natively with Next.js route handlers via ReadableStream — no extra server needed
3. SSE requires zero client-side libraries (native EventSource API)
4. SSE auto-reconnects natively (EventSource reconnects on error)
5. The use case (pushing account state updates) doesn't need bidirectional communication

**5 Hows — How could the pipeline fail?**
1. Helius WS disconnects → staleness monitor detects after 15s → HTTP fallback activates
2. Helius webhook stops delivering → protocol state goes stale (no staleness detection for webhook data)
3. Node.js process restarts → globalThis state lost → ws-subscriber re-initializes on next boot → SSE clients reconnect with backoff
4. Memory pressure from 5000 SSE connections → each connection holds a ReadableStream → no backpressure on broadcast
5. A single slow subscriber callback blocks the sseManager broadcast loop (synchronous iteration)

### 2. Connection Rate Limiting (H008 Fix)

`sse-connections.ts` implements per-IP and global connection caps:

- **MAX_PER_IP = 10**: 5 browser tabs × 2 SSE routes per user
- **MAX_GLOBAL = 5000**: 500 users × 2 SSE routes × 5x headroom
- **Auto-release timeout = 30 minutes**: Prevents zombie connections from exhausting the cap
- **Double-release guard**: `released` flag prevents counter underflow

**Analysis:**
The implementation is solid. The `acquireConnection` check runs before any ReadableStream is created, ensuring rejected connections don't consume resources. The `scheduleAutoRelease` function properly unrefs the timeout to avoid preventing Node.js exit. The `released` flag in each SSE route prevents double-release from both `abort` and `cancel`.

**Potential gap:** The global counter (`state.globalCount`) is a simple integer that relies on balanced acquire/release calls. If a code path acquires but never releases (e.g., an exception thrown between `acquireConnection` and stream setup), the counter leaks. The 30-minute auto-release eventually reclaims it, but during that window the slot is wasted. Current code structure makes this unlikely but not impossible.

### 3. WebSocket Subscriber (ws-subscriber.ts)

**Initialization:**
- Feature-flagged via `WS_SUBSCRIBER_ENABLED` env var
- Called from `instrumentation.ts` `register()` hook on server boot
- Double-init guard via `state.initialized` flag
- globalThis singleton survives HMR in development

**Data sources (4 parallel pipelines):**
1. **Slot subscription (WS)**: `onSlotChange` via Helius WebSocket. Throttled to broadcast every `SLOT_BROADCAST_INTERVAL_MS` (default 5s).
2. **Supply poll (HTTP)**: `getTokenSupply` for CRIME and FRAUD every 60s.
3. **Staker poll (HTTP)**: `getProgramAccounts` for UserStake accounts every 30s.
4. **Staleness monitor**: Checks every 10s if slot data is >15s old; activates HTTP fallback if stale.

**Observations:**

**ENV VAR WITHOUT BOUNDS (Finding #4):**
`SLOT_BROADCAST_INTERVAL_MS` is parsed via `parseInt` with no min/max bounds:
```typescript
const BROADCAST_INTERVAL = parseInt(
  process.env.SLOT_BROADCAST_INTERVAL_MS ?? "5000", 10,
);
```
Setting this to `0` or `1` would broadcast every slot change (~2.5 per second) to all SSE clients. Setting it to a very large value would effectively disable slot updates. Similar unbounded parsing exists for `TOKEN_SUPPLY_POLL_INTERVAL_MS` and `STAKER_COUNT_POLL_INTERVAL_MS`.

**BN.toNumber() precision risk:**
In staker poll, `decoded.stakedBalance.toNumber()` and `decoded.lastClaimTs.toNumber()` use BN.toNumber() which silently loses precision for values > 2^53. For a 20M PROFIT supply with 9 decimals, individual stake balances are unlikely to exceed this, but `unlockedProfit` and `lockedProfit` (running sums) could if many stakers have large balances. These are accumulated using `+=` on JavaScript numbers.

**Error isolation is good:** Each account decode in batchSeed is wrapped in its own try-catch. A failure decoding one account doesn't prevent others from being seeded. Same pattern in staker poll.

### 4. Protocol Store (protocol-store.ts)

**Dedup mechanism (Finding #6):**
```typescript
const serialized = JSON.stringify(data, bigintReplacer);
if (serialized === this.lastSerialized.get(pubkey)) return;
```
This compares the full JSON string of the new data to the last broadcast. The concern is that `JSON.stringify` does not guarantee key ordering across different source objects. If the same logical data arrives from two different code paths (e.g., ws-subscriber batchSeed vs webhook handler) with keys in different order, the dedup will fail and broadcast duplicates.

In practice, both paths use `anchorToJson()` which iterates `Object.entries(decoded)` — key order depends on Anchor decode output. This is likely deterministic for the same program/account type, so the risk is theoretical but worth noting.

**Memory growth:** The store accumulates entries but never removes them. For the current protocol (8 known accounts + 5 synthetic keys), this is bounded at ~13 entries. No memory leak concern.

### 5. SSE Manager (sse-manager.ts)

**Broadcast implementation:**
```typescript
broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data, bigintReplacer)}\n\n`;
  for (const callback of this.subscribers) {
    try { callback(payload); } catch { this.subscribers.delete(callback); }
  }
}
```

**SSE injection observation:** The `event` parameter is interpolated directly into the SSE payload string. If `event` contained a newline, it could inject additional SSE fields. However, all callers pass string literals ("protocol-update", "candle-update") — no user input reaches this path.

**Synchronous fan-out:** The broadcast loop iterates all subscribers synchronously. With 5000 subscribers, each broadcast triggers 5000 `controller.enqueue()` calls in the same event loop tick. This blocks the event loop until all writes complete. For small payloads (~500 bytes), this should be manageable, but for large initial-state snapshots, it could cause a brief freeze.

### 6. SSE Routes

**Protocol route (`/api/sse/protocol`):**
- Sends `initial-state` event with ALL cached account states on connect
- Filters sseManager events to only forward `protocol-update` events
- 15s heartbeat interval
- Proper cleanup on abort signal

**Candle route (`/api/sse/candles`) — Finding #2:**
- Does NOT filter by event type: `sseManager.subscribe((payload: string) => { controller.enqueue(encoder.encode(payload)); })`
- This means ALL broadcasts (including `protocol-update` events) leak to candle-only clients
- Compare to protocol route which checks: `if (!payload.startsWith("event: protocol-update\n")) return;`

**Both routes:**
- Set `runtime = "nodejs"` and `dynamic = "force-dynamic"` — correct for long-lived connections
- Set `X-Accel-Buffering: no` to disable nginx proxy buffering
- No CORS headers set (relies on Next.js App Router same-origin default)
- No authentication required

### 7. Webhook -> SSE Account Change Handler

**Account change processing (Finding #1):**
For CarnageSolVault (SystemAccount), the handler extracts:
```typescript
const lamports = item.accountData?.[0]?.nativeBalanceChange;
protocolStore.setAccountState(pubkey, {
  lamports: typeof lamports === "number" ? lamports : 0,
  updatedAt: Date.now(),
});
```

The field `nativeBalanceChange` from Helius Enhanced Webhooks represents the **change** in lamports (delta), not the absolute balance. This means the protocol store receives a delta value and stores it as if it were the absolute balance. On ws-subscriber batchSeed, the correct absolute `info.lamports` is stored. But subsequent webhook updates overwrite it with delta values.

**Impact:** CarnageSolVault balance displayed to SSE clients would be wrong after each webhook update. This affects the Carnage Fund display in the UI.

**Anchor decode path is correct:** For non-SystemAccount PDAs, the handler decodes `rawAccountData.data` via Anchor's coder, producing correctly structured account data. The bigintFields handling for curveState and stakePool matches ws-subscriber's approach.

### 8. Client-Side SSE Hooks

**useProtocolState — Polling fallback (Finding #9):**
When SSE is down for >30s, `pollViaRpc` fetches raw account info:
```typescript
next[pubkey] = {
  label: `rpc-poll`,
  lamports: info.lamports,
  owner: info.owner.toBase58(),
  dataLength: info.data.length,
  updatedAt: Date.now(),
};
```
This is structurally different from the normal SSE data which contains decoded fields like `currentEpoch`, `crimeBuyTaxBps`, `reserveA`, etc. Downstream hooks (useEpochState, usePoolPrices) check for specific field existence (e.g., `typeof sseData.currentEpoch !== "number"`) and will return `null` when receiving this raw format.

**Impact:** During SSE outage, all protocol state hooks degrade to null, causing UI components to show loading/empty states rather than stale-but-available data.

**useChartSSE:**
Clean implementation with exponential backoff. No filtering — relies on SSE candle route to send only candle-relevant events. However, due to Finding #2, it also receives protocol-update events which are silently ignored by the `JSON.parse` + type assertion (`as CandleSSEUpdate`).

**useCurrentSlot:**
Client-side slot estimation between SSE updates (5s intervals). Uses `MS_PER_SLOT` constant for linear extrapolation. Simple and correct.

### 9. BigInt JSON Serialization

**Replacer (`bigintReplacer`):**
Converts `BigInt` values to `{ __bigint: "value" }` tags. Clean implementation.

**Reviver (`bigintReviver`) — Finding #8:**
```typescript
if (isBigIntTag(value)) {
  return BigInt(value.__bigint);
}
```
`BigInt()` throws `SyntaxError` on non-numeric strings (e.g., `BigInt("abc")`). If a malicious or corrupted SSE payload contains `{ __bigint: "not-a-number" }`, the reviver would throw. However, the calling code in `useProtocolState.ts` wraps `JSON.parse(event.data, bigintReviver)` in a try-catch (lines 252-262, 268-280), so the exception is caught and the malformed event is silently discarded.

**anchorToJson:**
Shallow conversion (one level deep). Uses duck-typing (`"toNumber" in val`, `"toBase58" in val`) to detect BN and PublicKey objects. This is a reasonable approach that avoids importing heavy dependencies. The `bigintFields` parameter allows specific fields to use the `{ __bigint: "..." }` tag instead of `.toNumber()`.

**Potential gap:** `anchorToJson` is shallow — it only converts top-level fields. If Anchor decoded objects contain nested BN values (e.g., an enum variant wrapping a BN), those nested values would serialize incorrectly. For the current protocol's account types, this appears safe (EpochState, PoolState, etc. are flat structs), but future account type changes could introduce nested BN values.

### 10. External API Security (sol-price, candles, carnage-events)

**sol-price route:**
- Server-side price proxy with CoinGecko (primary) and Binance (fallback)
- 60s in-memory cache shared across all requests
- 5s timeout on external fetches (`AbortSignal.timeout(5_000)`)
- Rate limited (30 req/min per IP)
- Returns stale cache on provider failure — graceful degradation
- **No user input flows to external API URLs** — hardcoded provider URLs

**Candles route:**
- Database query endpoint with parameterized ORM queries (Drizzle)
- Input validation: pool address (base58 check), resolution (Set membership), limit (capped at 2000)
- Gap-fill logic applied at query time
- **Limit capping is correct**: `Math.min(parseInt(limitParam, 10), 2000)` — matches AIP-078 guidance

**Carnage events route:**
- Hardcoded `LIMIT 5` — no user-controlled pagination
- No input parameters — zero injection surface
- Uses parameterized Drizzle ORM query

### 11. RPC Proxy

- Method allowlist prevents abuse (only whitelisted Solana RPC methods)
- API key stays server-side (HELIUS_RPC_URL, no NEXT_PUBLIC_ prefix)
- Failover with sticky routing (H047 fix)
- Rate limited (300 req/min per IP)
- Disallowed methods logged and rejected
- **Observation:** `sendTransaction` is in the allowlist, meaning any browser client can submit transactions through the proxy. This is expected for a DeFi frontend but worth noting — the proxy does not validate transaction content.

## Trust Model

### Trust Zones for Real-Time Data

1. **Helius (Trusted Provider)**: Both WS responses and webhook payloads are trusted. WS slot data flows directly into protocolStore. Webhook authentication (timingSafeEqual) gates data writes from Helius.

2. **Protocol Store (Trusted Cache)**: In-memory cache written by two sources (ws-subscriber and webhook handler). Any data in the store is broadcast to all SSE clients without per-field validation. The dedup check is the only gate between writes and broadcasts.

3. **SSE Broadcast (Semi-Trusted Channel)**: Data flows from store to connected clients over HTTP. No encryption beyond TLS. No per-client authorization. Any client that opens an EventSource to the SSE endpoint receives all protocol updates.

4. **Browser Client (Untrusted Consumer)**: Receives SSE data and uses bigintReviver for deserialization. No schema validation on received data. Structural mismatches silently produce null values in downstream hooks.

## State Analysis

### In-Memory State (server-side)

| Component | State Type | Persistence | Size Bound |
|-----------|-----------|-------------|------------|
| protocolStore | `Map<string, AccountState>` | None (lost on restart) | ~13 entries |
| protocolStore.lastSerialized | `Map<string, string>` | None | ~13 entries |
| sseManager.subscribers | `Set<SSECallback>` | None | MAX_GLOBAL (5000) |
| sseConnections state | `Map<string, number>` + globalCount | None | Bounded by unique IPs |
| creditCounter | totalCalls + methodCounts | None | Unbounded (monotonic counters) |
| ws-subscriber state | WsSubscriberState object | globalThis (survives HMR) | Fixed size |
| rate-limit entries | `Map<string, {timestamps[]}>` | None | Bounded by cleanup sweep |

**Memory concern:** creditCounter's `methodCounts` object grows by one key per unique method name. Since methods are from the allowlist (16 entries), this is bounded. `totalCalls` is a monotonically increasing integer — will overflow Number.MAX_SAFE_INTEGER after ~9 quadrillion calls, which is not a practical concern.

### Client-Side State

| Component | State Type | Persistence |
|-----------|-----------|-------------|
| useProtocolState.accounts | `Record<string, AccountStateData>` (React state) | None (lost on unmount) |
| useProtocolState.lastSseDataRef | timestamp number | None |
| useChartSSE.reconnectAttempts | number (closure) | None |
| useCurrentSlot.baseSlotRef | number (ref) | None |

## Dependencies (External APIs, Packages, Services)

| Dependency | Purpose | Failure Impact |
|-----------|---------|---------------|
| Helius WebSocket | Slot subscription | Staleness monitor activates HTTP fallback after 15s |
| Helius HTTP RPC | Token supply, staker data, slot fallback | Supply/staker data goes stale (60s/30s intervals) |
| Helius Enhanced Webhook | Account change notifications | Protocol state goes stale until next ws-subscriber poll |
| CoinGecko API | SOL/USD price (primary) | Falls back to Binance, then stale cache |
| Binance API | SOL/USD price (fallback) | Returns 502 if both providers fail |
| PostgreSQL (Railway) | Candle/event storage | Health check reports degraded; chart data unavailable |

## Focus-Specific Analysis

### OC-140: WebSocket Without Authentication

**Status: NOT APPLICABLE (SSE, not WebSocket)**

The system uses SSE (HTTP-based, unidirectional) not WebSocket. SSE endpoints (`/api/sse/protocol`, `/api/sse/candles`) do not require authentication. Since the data served is public protocol state (on-chain account data that anyone can read via RPC), authentication is arguably unnecessary.

However, the SSE endpoints provide a curated, decoded, and structured view of protocol data that could be more valuable to competitors or data scrapers than raw RPC access. The connection rate limiting (10 per IP) provides some protection against mass scraping.

### OC-141: WebSocket Message Validation Missing

**Status: NOT APPLICABLE (SSE is unidirectional server→client)**

SSE is server-to-client only. There are no incoming messages from clients to validate. The server-side data source (Helius webhook) is authenticated.

### OC-142: WebSocket Broadcast Channel Authorization

**Status: PARTIAL CONCERN**

All SSE clients receive all protocol-update events. There is no channel-based authorization (e.g., filtering by account type). This is by design — all protocol state is public. However, Finding #2 (candle route forwards all event types) means candle-only clients receive protocol state they don't need.

### OC-143: WebSocket Connection Flooding

**Status: MITIGATED via H008 fix**

`sse-connections.ts` implements per-IP (10) and global (5000) caps. The 30-minute auto-release prevents zombie connections from permanently consuming slots. The implementation is correct and well-tested (k6 load test confirms behavior).

**Residual risk:** An attacker with many IPs (botnet) could still exhaust the 5000 global cap. With 500 IPs each opening 10 connections, all slots are consumed. Legitimate users would receive 429 responses. The 30-minute auto-release means the attacker must maintain connections to sustain the attack.

### OC-144: Webhook Signature Not Verified

**Status: VERIFIED FIXED (H001)**

The webhook handler uses `timingSafeEqual` with a carefully implemented comparison:
- Equal-length comparison to avoid timing leaks
- When lengths differ, compares secret against itself (constant time) then rejects
- Fail-closed in production: missing `HELIUS_WEBHOOK_SECRET` returns 500
- Non-production: auth skipped for local development

This is a textbook implementation matching SP-005 (Secure Pattern) and SP-021 (Webhook Signature Verification).

### OC-145: Webhook Replay Attack

**Status: MITIGATED (H049)**

Raw transaction webhooks check `blockTime` age: transactions older than 300 seconds (5 minutes) are skipped. This prevents replaying old webhook payloads.

**Gap for Enhanced webhooks:** Account change webhooks (the `handleAccountChanges` path) do NOT have timestamp/age checking. Since these represent current account state (not transactions), replaying an old account state webhook would overwrite the current state with stale data. However, the next legitimate webhook or ws-subscriber poll would restore the correct data. The risk is brief display of stale data.

### OC-146: Webhook Handler Not Idempotent

**Status: VERIFIED (correct)**

- swap_events: `onConflictDoNothing` on TX signature (unique key)
- epoch_events: `onConflictDoNothing` on epoch_number (unique index)
- carnage_events: `onConflictDoNothing` on epoch_number (unique index)
- account changes: last-write-wins in-memory store (inherently idempotent)

## Cross-Focus Intersections

### With SEC-01 (Access Control)
- SSE endpoints have no authentication but serve public protocol data
- The RPC proxy's method allowlist includes `sendTransaction`, allowing any browser client to submit transactions

### With CHAIN-02 (RPC Trust)
- ws-subscriber trusts all RPC responses without validation beyond Anchor decode
- Corrupted RPC data would flow into protocolStore and SSE broadcasts

### With DATA-01 (Data Persistence)
- Protocol store is purely in-memory — process restart loses all state
- ws-subscriber re-seeds on boot, but there's a window where SSE clients may receive empty/stale data

### With LOGIC-01 (Business Logic)
- usePoolPrices and useEpochState derive financial data (prices, tax rates) from SSE data
- Incorrect data in protocolStore (e.g., Finding #1 CarnageSolVault) propagates to user-facing financial displays

### With ERR-02 (Error Handling)
- ws-subscriber silently continues on individual account decode failures
- Client-side hooks silently return null on unexpected data shapes (Finding #9)

## Cross-Reference Handoffs

| Finding | Handoff To | Item |
|---------|-----------|------|
| Finding #1 (CarnageSolVault) | **DATA-01** | Verify whether Helius Enhanced Webhook `nativeBalanceChange` is delta or absolute |
| Finding #2 (candle route leak) | **LOGIC-01** | Verify no business logic depends on candle SSE route only receiving candle events |
| Finding #7 (health disclosure) | **SEC-01** | Assess whether ws-subscriber state and credit counts are sensitive for the threat model |
| Finding #9 (polling fallback) | **CHAIN-02** | Verify if raw accountInfo can be Anchor-decoded on the client side during fallback |
| SSE no-auth | **SEC-01** | Determine if unauthenticated SSE access to decoded protocol data requires mitigation |
| RPC proxy sendTransaction | **SEC-01** | Assess whether sendTransaction should be in the method allowlist |

## Risk Observations

### HIGH

**1. CarnageSolVault lamport extraction incorrect (Finding #1)**
- **File:** `app/app/api/webhooks/helius/route.ts:554-558`
- **Issue:** `nativeBalanceChange` is a delta, not absolute balance. After batchSeed provides the correct absolute value, subsequent webhook updates overwrite it with delta values.
- **Impact:** Carnage Fund SOL balance shown to all SSE clients is wrong. Users making trading decisions based on Carnage Fund balance could be misled.
- **Likelihood:** Probable — Enhanced webhooks fire on every transaction touching the vault.
- **Fix:** Fetch the actual account balance via `item.rawAccountData` or make a separate `getAccountInfo` call for SystemAccount PDAs.

### MEDIUM

**2. SSE candle route leaks protocol events (Finding #2)**
- **File:** `app/app/api/sse/candles/route.ts:71-76`
- **Issue:** No event type filter — all sseManager broadcasts forwarded to clients.
- **Impact:** Unnecessary bandwidth consumption; protocol account states leaked to chart-only clients.
- **Likelihood:** Certain — design gap.
- **Fix:** Add `if (!payload.startsWith("event: candle-update\n")) return;` filter matching the protocol route's pattern.

**3. useProtocolState polling fallback returns raw accountInfo (Finding #9)**
- **File:** `app/hooks/useProtocolState.ts:196-211`
- **Issue:** During SSE outage >30s, polling returns `{lamports, owner, dataLength}` instead of decoded fields.
- **Impact:** All downstream hooks return null during extended SSE outages, breaking UI.
- **Likelihood:** Possible — requires sustained SSE failure.
- **Fix:** Add Anchor decoding to the RPC polling fallback, matching the server-side ws-subscriber approach. Alternatively, accept the degradation and display a "data unavailable" indicator.

**4. No replay protection on Enhanced Account Change webhooks**
- **File:** `app/app/api/webhooks/helius/route.ts:340-341`
- **Issue:** Raw TX webhooks check blockTime age (H049), but Enhanced webhooks skip this check entirely. A replayed old webhook could overwrite current state with stale data.
- **Impact:** Brief display of stale account data until next legitimate update.
- **Likelihood:** Unlikely — requires authenticated replay (attacker needs HELIUS_WEBHOOK_SECRET).

### LOW

**5. Slot broadcast interval controllable without bounds (Finding #4)**
- **File:** `app/lib/ws-subscriber.ts:251-254`
- **Issue:** `SLOT_BROADCAST_INTERVAL_MS=0` would broadcast every slot change.
- **Impact:** Excessive SSE broadcasts (~2.5/sec) consuming server CPU and client bandwidth.
- **Likelihood:** Rare — requires misconfigured env var.

**6. Protocol store dedup fragility (Finding #6)**
- **File:** `app/lib/protocol-store.ts:54-58`
- **Issue:** JSON string equality depends on key ordering.
- **Impact:** Redundant SSE broadcasts consuming bandwidth.
- **Likelihood:** Unlikely — same Anchor decode path typically produces same key order.

**7. Health endpoint information disclosure (Finding #7, relates to H028)**
- **File:** `app/app/api/health/route.ts:66-72`
- **Issue:** Exposes ws-subscriber internal state and RPC credit breakdown publicly.
- **Impact:** Reconnaissance value for attackers (knowing which RPCs are used, current slot, connection status).
- **Likelihood:** Probable — endpoint is public.

**8. BigInt parsing from untrusted SSE data (Finding #8)**
- **File:** `app/lib/bigint-json.ts:46-51`
- **Issue:** `BigInt(value.__bigint)` throws on non-numeric strings.
- **Impact:** Caught by outer try-catch in useProtocolState; event is silently discarded.
- **Likelihood:** Rare — SSE data originates from trusted server-side code.

**9. SSE broadcast fan-out has no backpressure**
- **File:** `app/lib/sse-manager.ts:62-69`
- **Issue:** Synchronous iteration over all subscribers per broadcast.
- **Impact:** Event loop blocked during broadcast to 5000 clients; latency spike for concurrent HTTP requests.
- **Likelihood:** Possible at scale — depends on concurrent SSE connection count.

### INFORMATIONAL

**10. No distributed SSE support (H092 noted as FIXED)**
- **File:** `app/lib/sse-manager.ts:8-11`
- **Observation:** In-memory pub/sub only works for single-process deployment. Comment correctly documents this limitation and notes Redis as future option.

**11. Credit counter monotonically increasing**
- **File:** `app/lib/credit-counter.ts:36-38`
- **Observation:** `totalCalls` increments forever with no periodic reset or rollover. Not a security issue but could be confusing for long-running processes.

## Novel Attack Surface Observations

### 1. SSE Exhaustion → Degraded UI → User Harm
An attacker who exhausts the 5000 global SSE connection cap forces all legitimate users into the polling fallback path. The polling fallback returns raw accountInfo (Finding #9) which causes all protocol state hooks to return null. Users see empty/loading states for tax rates, pool reserves, and staking data, potentially making uninformed trading decisions. The attacker needs ~500 IPs with 10 connections each. The 30-minute auto-release means the attacker must maintain connections, but this is trivially achievable with a small botnet or cloud VM fleet.

### 2. Webhook-to-SSE Amplification Cost Attack
Each Helius webhook delivery triggers protocolStore.setAccountState() which broadcasts to all SSE subscribers. An attacker who triggers many on-chain transactions touching monitored PDAs (e.g., dust transfers to the Carnage SOL vault) can amplify webhook deliveries into O(N) SSE writes where N is the connected client count. With 5000 clients and 120 webhook deliveries/min (rate limit), this could generate 600,000 SSE writes/minute. This isn't a vulnerability per se (the data is real), but could be used as a targeted cost/resource exhaustion attack.

### 3. CarnageSolVault Stale-Then-Wrong Data Oscillation
Due to Finding #1, the Carnage SOL vault balance oscillates between correct (from ws-subscriber poll every 30s) and incorrect (from webhook-delivered delta values). This creates a confusing user experience where the vault balance appears to jump erratically. If the UI displays "vault is empty" (from a negative delta), users might incorrectly conclude the protocol is failing.

## Questions for Other Focus Areas

1. **For SEC-01:** Is the protocol data served via SSE considered public or should there be any access control? The data is derivable from RPC but SSE provides a curated, decoded view.
2. **For CHAIN-02:** Does the Helius Enhanced Webhook `nativeBalanceChange` field represent an absolute balance or a delta? This determines the severity of Finding #1.
3. **For DATA-01:** What is the expected time for ws-subscriber to re-seed protocolStore after a process restart? SSE clients will receive empty initial-state during this window.
4. **For ERR-01:** If the Helius WS connection enters a permanent failure state (Helius outage), the staleness monitor will keep the HTTP fallback running indefinitely. Is there any alerting or escalation for this scenario?
5. **For INFRA-03:** Are `WS_SUBSCRIBER_ENABLED`, `SLOT_BROADCAST_INTERVAL_MS`, `TOKEN_SUPPLY_POLL_INTERVAL_MS`, and `STAKER_COUNT_POLL_INTERVAL_MS` correctly configured on Railway for production?

## Raw Notes

### Files analyzed in detail (Layer 3)
1. `app/lib/ws-subscriber.ts` (495 LOC) — Full read, line-by-line
2. `app/lib/sse-manager.ts` (93 LOC) — Full read
3. `app/lib/sse-connections.ts` (119 LOC) — Full read
4. `app/lib/protocol-store.ts` (126 LOC) — Full read
5. `app/lib/bigint-json.ts` (118 LOC) — Full read
6. `app/lib/credit-counter.ts` (69 LOC) — Full read
7. `app/app/api/sse/protocol/route.ts` (137 LOC) — Full read
8. `app/app/api/sse/candles/route.ts` (125 LOC) — Full read
9. `app/app/api/webhooks/helius/route.ts` (852 LOC) — Full read
10. `app/hooks/useProtocolState.ts` (366 LOC) — Full read
11. `app/hooks/useChartSSE.ts` (109 LOC) — Full read

### Files analyzed at signature level (Layer 2)
- `app/lib/connection.ts` — RPC URL resolution, singleton pattern
- `app/lib/rate-limit.ts` — Sliding window algorithm, IP extraction
- `app/lib/protocol-config.ts` — Cluster-aware address resolution
- `app/app/api/health/route.ts` — Dependency checks, ws-subscriber status exposure
- `app/app/api/rpc/route.ts` — Method allowlist, failover, credit tracking
- `app/app/api/sol-price/route.ts` — Price proxy with cache and fallback
- `app/app/api/candles/route.ts` — DB query with validation and gap-fill
- `app/app/api/carnage-events/route.ts` — Simple DB query, no inputs
- `app/hooks/useCurrentSlot.ts` — Client-side slot estimation
- `app/hooks/useEpochState.ts` — SSE-powered epoch data extraction
- `app/hooks/usePoolPrices.ts` — SSE-powered pool reserve extraction
- `app/instrumentation.ts` — Server boot hook, ws-subscriber init
- `scripts/load-test/k6-sse.js` — Load test for SSE endpoints

### Previous findings rechecked
- **H008 (SSE Amplification DoS)**: VERIFIED FIXED — connection caps in sse-connections.ts
- **H023 (SSE Connection Exhaustion)**: VERIFIED FIXED — MAX_GLOBAL=5000, MAX_PER_IP=10, auto-release
- **H092 (SSE Single-Process Only)**: VERIFIED FIXED — documented limitation, in-memory pub/sub correct for current deployment
- **H028 (Health Info Disclosure)**: STILL PRESENT — now exposes even more internal state (ws-subscriber status, credit counts)
