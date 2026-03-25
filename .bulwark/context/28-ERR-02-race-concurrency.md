---
task_id: db-phase1-err-02-race-concurrency
provides: [err-02-race-concurrency-findings, err-02-race-concurrency-invariants]
focus_area: err-02-race-concurrency
files_analyzed: [app/hooks/useSwap.ts, app/hooks/useStaking.ts, app/hooks/useEpochState.ts, app/hooks/useProtocolState.ts, app/hooks/useTokenBalances.ts, app/hooks/usePoolPrices.ts, app/hooks/useCurveState.ts, app/lib/ws-subscriber.ts, app/lib/protocol-store.ts, app/lib/sse-manager.ts, app/lib/sse-connections.ts, app/lib/credit-counter.ts, app/lib/rate-limit.ts, app/lib/confirm-transaction.ts, app/lib/swap/route-engine.ts, app/lib/swap/error-map.ts, app/lib/staking/error-map.ts, app/app/api/rpc/route.ts, app/app/api/webhooks/helius/route.ts, app/app/api/sse/protocol/route.ts, app/db/candle-aggregator.ts, app/instrumentation.ts, app/components/station/SwapStation.tsx, app/components/station/BigRedButton.tsx, app/components/staking/StakingForm.tsx, app/components/swap/SwapForm.tsx]
finding_count: 12
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 5, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Race Conditions & Concurrency -- Condensed Summary

## Key Findings (Top 10)
- **ws-subscriber init() TOCTOU on `state.initialized`**: Check-then-set gap allows concurrent callers to double-init, creating duplicate WS subscriptions and poll timers -- `app/lib/ws-subscriber.ts:456-474`
- **RPC proxy mutable `lastSuccessfulEndpoint` without synchronization**: Module-level `let` variable updated concurrently by parallel POST handlers; stale reads cause sticky routing to wrong endpoint -- `app/app/api/rpc/route.ts:69`
- **SSE connection tracker non-atomic acquire**: `acquireConnection()` reads ipCount, checks, then writes -- concurrent requests from same IP can both pass the limit check -- `app/lib/sse-connections.ts:49-57`
- **credit-counter `recordCall()` non-atomic increment**: `this.totalCalls++` and `this.methodCounts[method] = ... + 1` are read-modify-write operations, can lose counts under concurrent webhook + polling calls -- `app/lib/credit-counter.ts:35-38`
- **rate-limiter check-then-push window**: `checkRateLimit()` filters timestamps, checks count, then pushes -- two concurrent requests can both pass the limit -- `app/lib/rate-limit.ts:90-111`
- **useSwap debounce-then-setState race**: Quote timer fires and calls `setQuoteLoading(false)` unconditionally, even if a newer timer was started -- `app/hooks/useSwap.ts:563-566`
- **useTokenBalances cross-instance refresh dispatch not guarded by async boundary**: `isDispatchingRef` set/unset synchronously around `dispatchEvent`, but `fetchBalances()` is async so the guard only covers dispatch, not the actual fetch -- `app/hooks/useTokenBalances.ts:166-174`
- **protocolStore.setAccountState() serialization race**: JSON.stringify + dedup comparison + Map.set + SSE broadcast are a multi-step non-atomic sequence; concurrent calls for the same key can broadcast stale serialization as "new" -- `app/lib/protocol-store.ts:53-64`
- **Candle upsert close price ordering**: Concurrent webhook deliveries for the same pool/resolution/openTime can set `close` to a non-latest trade's price (close = last writer wins, not latest timestamp) -- `app/db/candle-aggregator.ts:118-128`
- **useStaking `pendingRewards` captured at TX build time**: `lastResult.forfeitedAmount` and `lastResult.claimedAmount` use the reward snapshot from the moment the button was clicked, not the on-chain value at TX confirmation -- `app/hooks/useStaking.ts:553-554,565-566`

## Critical Mechanisms
- **ws-subscriber init + polling pipeline**: Server boot calls `init()` which batch-seeds the protocol store, then starts 4 concurrent poll timers (slot WS, supply poll, staker poll, staleness monitor). All timers write to the same `protocolStore` singleton without coordination. Under normal load this is safe (Node.js single-threaded), but the initialization guard has a TOCTOU gap -- `app/lib/ws-subscriber.ts:450-476`
- **SSE broadcast pipeline**: Webhook POST -> `protocolStore.setAccountState()` -> `sseManager.broadcast()` -> N subscriber callbacks. The broadcast iterates a Set while callbacks may add/remove themselves (via disconnect cleanup). The `try/catch` + `delete` pattern handles this, but deletion during iteration is implementation-dependent -- `app/lib/sse-manager.ts:60-69`
- **Swap TX lifecycle state machine**: `useSwap` manages status transitions (idle->building->signing->sending->confirming->confirmed/failed). The `executeSwap` and `executeRoute` callbacks close over stale `quote` and `inputAmount` state via React's stale closure problem. Multiple rapid clicks could invoke the callback with old state. UI guard (BigRedButton disabled during transacting) mitigates -- `app/hooks/useSwap.ts:690-808`
- **RPC proxy failover with sticky routing**: Module-level `lastSuccessfulEndpoint` persists across requests. Two concurrent requests hitting different endpoints can stomp each other's sticky state. Benign in practice (retry loop recovers) -- `app/app/api/rpc/route.ts:69,159`

## Invariants & Assumptions
- INVARIANT: ws-subscriber initializes at most once per process lifetime -- enforced at `app/lib/ws-subscriber.ts:456-458` via `state.initialized` flag / PARTIALLY ENFORCED (TOCTOU gap)
- INVARIANT: SSE connection count per IP never exceeds MAX_PER_IP (10) -- enforced at `app/lib/sse-connections.ts:52` via counter check / NOT ENFORCED under concurrent requests (non-atomic read-check-write)
- INVARIANT: SSE connection count globally never exceeds MAX_GLOBAL (5000) -- enforced at `app/lib/sse-connections.ts:50` / NOT ENFORCED under concurrent requests
- INVARIANT: Rate limiter rejects requests beyond maxRequests per window -- enforced at `app/lib/rate-limit.ts:99` / PARTIALLY ENFORCED (non-atomic check-then-push)
- INVARIANT: Protocol store dedup prevents redundant SSE broadcasts -- enforced at `app/lib/protocol-store.ts:58` / PARTIALLY ENFORCED (serialization-then-compare is non-atomic)
- INVARIANT: Candle `open` is set by the first trade in a time bucket -- enforced at `app/db/candle-aggregator.ts:111` (INSERT only, not in UPDATE set) / ENFORCED (SQL INSERT handles first-write)
- ASSUMPTION: Node.js single-threaded event loop makes all JavaScript execution sequential within a single tick -- VALID for synchronous code paths
- ASSUMPTION: Concurrent webhook deliveries for the same epoch/signature are handled by DB `onConflictDoNothing` -- VALIDATED at `app/app/api/webhooks/helius/route.ts:680,797,850`
- ASSUMPTION: React state updates are batched within the same synchronous tick -- VALID (React 18 auto-batching)

## Risk Observations (Prioritized)
1. **ws-subscriber double-init**: If `instrumentation.ts register()` is called twice before the first `await batchSeed()` resolves (possible under Next.js hot-reload or crash-restart), the second call passes the `state.initialized` check and creates duplicate subscriptions/timers. This doubles RPC credit consumption and creates duplicate SSE broadcasts. `app/lib/ws-subscriber.ts:456-474` -- Impact: medium (doubled costs, duplicate broadcasts)
2. **SSE connection limit bypass**: Two simultaneous connections from the same IP can both read `ipCount=9`, both pass `< MAX_PER_IP`, and both increment to 10+11. The actual count tracking becomes inconsistent. `app/lib/sse-connections.ts:49-57` -- Impact: medium (DoS mitigation weakened, H008 regression)
3. **Rate limiter bypass under concurrent requests**: Same pattern as SSE connections. Two concurrent requests read the same timestamp array, both pass, both push. The window overflows by 1-2 requests. `app/lib/rate-limit.ts:90-111` -- Impact: low (off-by-few, not bypassed entirely)
4. **Candle close price ordering under concurrent webhooks**: Two swaps in the same candle bucket, processed concurrently, race to set `close`. The SQL `SET close = $new_price` always applies the last-executed UPDATE, not the chronologically latest swap. `app/db/candle-aggregator.ts:123` -- Impact: low (display-only, corrects on next swap)
5. **protocolStore dedup race**: Two concurrent `setAccountState()` calls for the same key can both see the old serialization, both consider their data "new", and both broadcast. `app/lib/protocol-store.ts:53-64` -- Impact: low (duplicate SSE event, no data loss)

## Novel Attack Surface
- **Forced double-init via instrumentation timing**: If an attacker can trigger server restarts rapidly (e.g., via repeated 5xx responses causing Railway auto-restart), they could exploit the TOCTOU in ws-subscriber init to accumulate uncleaned timers, leaking memory and consuming RPC credits until the process OOMs.
- **SSE connection slot leak via abort race**: If a client disconnects during the gap between `acquireConnection()` and the `req.signal.addEventListener("abort", ...)` registration in the SSE route, the connection slot is acquired but the abort handler (which calls `releaseConnection`) is never registered. The auto-release timer (30 min) is the only safety net.

## Cross-Focus Handoffs
- -> **ERR-03 (Rate Limiting)**: The non-atomic rate limiter check is also a resource exhaustion concern. ERR-03 should evaluate whether the off-by-N window is exploitable under high concurrency.
- -> **CHAIN-01 (Slot/RPC)**: The ws-subscriber double-init finding directly impacts RPC credit consumption. CHAIN-01 should assess whether doubled polling timers create observable data inconsistencies.
- -> **DATA-01 (Data Persistence)**: The candle close-price ordering issue (H033 from Audit #1, NOT_FIXED) is a concurrency problem manifesting as data integrity. DATA-01 should assess user-facing impact.
- -> **INFRA-03 (Cloud/Env Config)**: The SSE connection limit bypass weakens H008's DoS mitigation. INFRA-03 should assess whether Railway's infrastructure provides additional limits.

## Trust Boundaries
The concurrency concerns in this codebase are bounded by Node.js's single-threaded event loop model. Within a single synchronous tick, all JavaScript execution is serialized -- no true data races are possible. The race conditions identified here are all **async interleaving** races: multiple `await` points create windows where other async operations can observe intermediate state. The most sensitive trust boundary is between the webhook handler (external input, concurrent calls from Helius) and the in-memory stores (protocol-store, credit-counter, rate-limiter, SSE connections). These stores assume single-writer semantics that hold within a tick but break across `await` boundaries. The on-chain program enforcement (slippage floors, balance checks) provides a hard safety net that makes off-chain race conditions non-exploitable for financial loss -- the worst outcomes are duplicate broadcasts, slightly exceeded rate limits, or cosmetic data inconsistencies.
<!-- CONDENSED_SUMMARY_END -->

---

# Race Conditions & Concurrency -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase manages concurrency through Node.js's single-threaded event loop model, which eliminates true data races but introduces async interleaving vulnerabilities at every `await` boundary. The most significant findings center on the server-side data pipeline (ws-subscriber, protocol-store, SSE manager, rate limiter, connection tracker) where concurrent webhook deliveries and timer callbacks interleave in ways that can bypass resource limits, duplicate broadcasts, or corrupt display-only data.

No race condition identified leads to financial loss. On-chain enforcement (slippage floors, balance checks, PDA ownership validation) acts as a hard safety net independent of off-chain state consistency. The risk profile is predominantly operational (doubled RPC costs, weakened DoS protection) rather than exploitable.

The client-side (React hooks) concurrency patterns are generally well-managed through React 18 auto-batching, debounce timers, visibility gating, and `mountedRef` guards. The primary concern is stale closures in swap execution callbacks, mitigated by UI-level double-submit prevention.

## Scope

**Files deeply analyzed (Layer 3):**
1. `app/lib/ws-subscriber.ts` (495 LOC) -- Server-side WS + polling pipeline
2. `app/lib/protocol-store.ts` (126 LOC) -- In-memory PDA cache with SSE broadcast
3. `app/lib/sse-manager.ts` (93 LOC) -- Pub/sub SSE broadcast mechanism
4. `app/lib/sse-connections.ts` (119 LOC) -- Connection rate limiting
5. `app/lib/credit-counter.ts` (69 LOC) -- RPC call tracking
6. `app/lib/rate-limit.ts` (182 LOC) -- Sliding window rate limiter
7. `app/hooks/useSwap.ts` (954 LOC) -- Swap lifecycle orchestration
8. `app/hooks/useStaking.ts` (715 LOC) -- Staking lifecycle orchestration
9. `app/hooks/useTokenBalances.ts` (183 LOC) -- Token balance polling + cross-instance sync
10. `app/app/api/rpc/route.ts` (189 LOC) -- RPC proxy with failover
11. `app/app/api/webhooks/helius/route.ts` (852 LOC) -- Webhook handler
12. `app/app/api/sse/protocol/route.ts` (137 LOC) -- SSE streaming endpoint
13. `app/db/candle-aggregator.ts` (210 LOC) -- OHLCV candle upsert

**Files signature-scanned (Layer 2):**
- `app/hooks/useEpochState.ts`, `app/hooks/usePoolPrices.ts`, `app/hooks/useCurveState.ts` -- SSE consumers, thin wrappers
- `app/lib/confirm-transaction.ts` -- Polling-based TX confirmation
- `app/lib/swap/error-map.ts`, `app/lib/staking/error-map.ts` -- Static maps, no concurrency
- `app/lib/swap/route-engine.ts` -- Pure function, no state
- `app/instrumentation.ts` -- Server boot hook
- `app/components/station/BigRedButton.tsx`, `app/components/swap/SwapForm.tsx`, `app/components/staking/StakingForm.tsx` -- UI double-submit guards

**Out of scope:** All Anchor/Rust programs in `programs/`.

## Key Mechanisms

### 1. Server-Side Data Pipeline (ws-subscriber -> protocol-store -> SSE)

**How it works:**
- `instrumentation.ts register()` calls `ws-subscriber.init()` on server boot
- `init()` calls `batchSeed()` to fetch all protocol PDAs via `getMultipleAccountsInfo`, then starts 4 timer-based pipelines
- Each pipeline writes to `protocolStore.setAccountState()` or `setAccountStateQuiet()`
- `setAccountState()` serializes data, checks dedup, stores in Map, and calls `sseManager.broadcast()`
- `broadcast()` iterates all subscriber callbacks (SSE streams)
- Separately, Helius webhook POSTs also call `protocolStore.setAccountState()` for enhanced account changes

**Concurrency model:**
All pipelines run in the same Node.js process. Within a synchronous tick, execution is serialized. Between `await` points (e.g., RPC fetch, DB write), other callbacks can interleave.

**Concerns:**
- `init()` double-init TOCTOU (detailed below)
- Concurrent `setAccountState()` calls from webhook + polling timer interleave at the serialization step
- `sseManager.broadcast()` iterates `Set` while callbacks may call `unsubscribe()` (Set delete during iteration)

### 2. Client-Side Swap Lifecycle (useSwap)

**How it works:**
- State machine: idle -> quoting -> building -> signing -> sending -> confirming -> confirmed/failed
- `executeSwap`/`executeRoute` are `useCallback` closures that capture state at creation time
- Debounced quoting uses `setTimeout` with `quoteTimerRef`
- Double-submit prevented by UI: `BigRedButton` disables during transacting states

**Concurrency model:**
React 18 batches all `setState` calls within the same synchronous tick. Stale closures are the primary concern.

**Concerns:**
- Rapid token flips + quote debounce can fire callbacks with outdated token pair
- `computeQuote` uses `poolData.reserveA/B` which may update between the user clicking swap and the TX building (mitigated by on-chain slippage check)

### 3. SSE Connection Tracking

**How it works:**
- `acquireConnection(ip)` checks per-IP and global counts, increments if below threshold
- `releaseConnection(ip)` decrements counts
- `scheduleAutoRelease(ip)` sets a 30-minute timeout for zombie cleanup
- SSE route registers abort handler + cancel callback for cleanup

**Concurrency model:**
Two simultaneous HTTP connections from the same IP can race through `acquireConnection()`. Since the read-check-write is not atomic, both can pass.

### 4. Rate Limiter

**How it works:**
- `checkRateLimit(ip, config, endpoint)` maintains a per-key sliding window of timestamps
- Filters old timestamps, checks count, pushes new timestamp if allowed
- Periodic cleanup sweeps stale entries

**Concurrency model:**
Same non-atomic read-check-write pattern as SSE connections. Two concurrent requests can both read the same count and both pass.

## Trust Model

The off-chain concurrency trust model relies on three layers:

1. **Node.js event loop**: Guarantees no true parallel execution of JavaScript. All race conditions are async interleaving, not parallel data races.
2. **Database-level atomicity**: PostgreSQL (via Drizzle ORM) provides transactional guarantees. `onConflictDoNothing` and `onConflictDoUpdate` with SQL functions (GREATEST, LEAST) ensure database-level correctness even under concurrent webhook deliveries.
3. **On-chain enforcement**: Solana program instructions validate slippage, balances, and authority independently of any off-chain state. This is the hard safety net.

The trust boundary gap is in-memory state (protocol-store, rate-limiter, SSE connections, credit-counter) that has no database-level atomicity and relies solely on synchronous JavaScript execution for consistency.

## State Analysis

### In-Memory Shared State

| State | Location | Writers | Readers | Synchronization |
|-------|----------|---------|---------|-----------------|
| Protocol account cache | `protocol-store.ts` Map | Webhook handler, ws-subscriber polls (4 timers) | SSE route (getAllAccountStates), webhook handler (via broadcast) | None (single-threaded assumption) |
| SSE subscriber set | `sse-manager.ts` Set | SSE route (subscribe/unsubscribe), broadcast (delete on error) | broadcast() iteration | None |
| Connection counts | `sse-connections.ts` Map + number | SSE route (acquire/release), auto-release timer | SSE route (acquire check) | None (non-atomic read-check-write) |
| Rate limit entries | `rate-limit.ts` Map | API route handlers (checkRateLimit), cleanup timer | checkRateLimit() | None (non-atomic read-check-push) |
| Credit stats | `credit-counter.ts` class fields | ws-subscriber polls, webhook handler, RPC proxy | Health route | None (non-atomic increment) |
| RPC sticky endpoint | `rpc/route.ts` let variable | RPC proxy POST handler | RPC proxy POST handler | None (concurrent request writes) |
| WS subscriber state | `ws-subscriber.ts` state object | init(), slot subscription, poll timers | getStatus(), init() guard | `initialized` flag (TOCTOU gap) |

### Database State (Postgres via Drizzle)

| Table | Concurrency Pattern | Protection |
|-------|-------------------|------------|
| swap_events | Concurrent webhook inserts | `onConflictDoNothing` on TX signature PK |
| epoch_events | Concurrent webhook inserts | `onConflictDoNothing` on epoch_number unique |
| carnage_events | Concurrent webhook inserts | `onConflictDoNothing` on epoch_number unique |
| candles | Concurrent upserts per pool/resolution/openTime | `onConflictDoUpdate` with GREATEST/LEAST (except close) |

### React State (Browser)

| Hook | State | Concurrency Pattern | Protection |
|------|-------|-------------------|------------|
| useSwap | status, quote, txSignature | Sequential state machine | UI disable during transacting |
| useStaking | status, userStakeRaw, stakePoolRaw | Sequential state machine + interval polling | `mountedRef` guard, visibility gating |
| useProtocolState | accounts Map | SSE push + polling fallback | React 18 batching, `mountedRef` |
| useTokenBalances | balances | Interval polling + cross-instance CustomEvent | `isDispatchingRef` guard (sync-only) |
| useCurveState | crime/fraud state | SSE + RPC refresh override | `mountedRef`, SSE clears RPC override |

## Dependencies

### External APIs Called Concurrently

| API | Concurrency Pattern | Timeout | Error Handling |
|-----|-------------------|---------|----------------|
| Helius RPC (getMultipleAccountsInfo) | ws-subscriber batchSeed, poll timers | No explicit timeout | try/catch per poll, log + continue |
| Helius RPC (getTokenSupply) | Promise.all for CRIME+FRAUD | No explicit timeout | try/catch, log + continue |
| Helius RPC (getProgramAccounts) | staker poll timer | No explicit timeout | try/catch, log + continue |
| Helius WS (onSlotChange) | Single subscription | Staleness monitor (15s threshold) | Fallback to HTTP polling |
| PostgreSQL (Drizzle) | Concurrent INSERT/UPSERT from webhook | Connection pool (Drizzle defaults) | try/catch per swap/epoch/carnage |

**AIP-141 check (missing timeouts on fetch):** The ws-subscriber poll functions (`pollSupply`, `pollStakers`, `batchSeed`) and the RPC proxy's upstream `fetch()` calls have **no explicit timeout**. The RPC proxy at `app/app/api/rpc/route.ts:144` uses raw `fetch()` without `AbortSignal.timeout()`. A hung upstream could block the proxy indefinitely.

## Focus-Specific Analysis

### Finding ERR02-001: ws-subscriber init() TOCTOU (Medium)

**Location:** `app/lib/ws-subscriber.ts:450-474`

**Code pattern:**
```typescript
export async function init(): Promise<void> {
  if (state.initialized) return;  // CHECK
  // ...
  await batchSeed(connection);    // ASYNC GAP
  // ...
  state.initialized = true;       // SET
}
```

**Race scenario:** If `init()` is called twice before the first invocation's `await batchSeed()` resolves (e.g., Next.js calling `register()` from multiple entry points during startup, or a hot-reload race in dev), both calls pass the `state.initialized` check and proceed to create duplicate subscriptions and poll timers.

**Impact:** Doubled RPC credit consumption, duplicate SSE broadcasts, potential inconsistent slot data (two slot subscriptions writing different values).

**Mitigation options:** Set `state.initialized = true` immediately after the guard check (before `await`), or use a promise-based init lock.

### Finding ERR02-002: SSE Connection Limit Non-Atomic Acquire (Medium)

**Location:** `app/lib/sse-connections.ts:49-57`

**Code pattern:**
```typescript
export function acquireConnection(ip: string): boolean {
  if (state.globalCount >= MAX_GLOBAL) return false;
  const ipCount = state.connections.get(ip) ?? 0;
  if (ipCount >= MAX_PER_IP) return false;
  state.connections.set(ip, ipCount + 1);
  state.globalCount++;
  return true;
}
```

**Race scenario:** Two simultaneous GET requests to `/api/sse/protocol` from the same IP. Both read `ipCount=9`, both pass `< 10`, both increment. Result: `ipCount=11` (exceeds limit by 1). Under high concurrency, the gap widens.

**Impact:** Weakens the H008 (SSE amplification DoS) mitigation. An attacker sending concurrent connection requests can exceed the per-IP limit.

**Note:** This is an async interleaving race, not a true parallel race. It requires two requests to arrive and be processed in the same event loop microtask window (before either's write completes). In practice, this requires carefully timed requests but is achievable.

### Finding ERR02-003: Rate Limiter Non-Atomic Check (Medium)

**Location:** `app/lib/rate-limit.ts:90-111`

**Same pattern as ERR02-002:** `checkRateLimit()` reads the timestamp array, filters, checks count, then pushes. Two concurrent requests can both pass the limit.

**Impact:** Low -- off-by-few (1-2 extra requests) under concurrent load. The rate limiter is defense-in-depth, not a sole security control.

### Finding ERR02-004: protocolStore Dedup Race (Low)

**Location:** `app/lib/protocol-store.ts:53-64`

**Code pattern:**
```typescript
setAccountState(pubkey: string, data: AccountState): void {
  const serialized = JSON.stringify(data, bigintReplacer);
  this.accounts.set(pubkey, data);
  if (serialized === this.lastSerialized.get(pubkey)) return;
  this.lastSerialized.set(pubkey, serialized);
  sseManager.broadcast("protocol-update", { account: pubkey, data });
}
```

**Race scenario:** Two concurrent calls for the same pubkey (e.g., webhook + poll timer). Both serialize. Both compare against the same old `lastSerialized` value. Both see "new data". Both broadcast. Result: duplicate SSE event.

**Impact:** Low -- extra SSE event, no data loss or corruption. Client-side React handles duplicate updates gracefully (same data, no re-render).

### Finding ERR02-005: Candle Close Price Ordering (Low)

**Location:** `app/db/candle-aggregator.ts:118-128`

**The SQL:**
```sql
SET close = $new_price
```

**Race scenario:** Two swaps S1 (timestamp T1) and S2 (timestamp T2 > T1) arrive in the same candle bucket. If S2's webhook is processed first (SQL UPDATE sets close=P2), then S1's webhook processes (SQL UPDATE sets close=P1), the candle's close price is P1 (the older swap), not P2 (the latest).

**Impact:** Low -- display-only (candle chart shows wrong close price until the next swap corrects it). This is the existing H033 finding from Audit #1 (NOT_FIXED).

**Note:** This is inherent to the webhook delivery model. Helius does not guarantee in-order delivery.

### Finding ERR02-006: credit-counter Non-Atomic Increment (Informational)

**Location:** `app/lib/credit-counter.ts:35-38`

**Code:** `this.totalCalls++` is a synchronous read-modify-write that is atomic within a single tick but can lose counts if called from concurrent async paths (e.g., webhook handler + ws-subscriber poll completing in overlapping ticks).

**Impact:** Informational -- monitoring data only, no security implications.

### Finding ERR02-007: RPC Proxy Sticky Endpoint Race (Low)

**Location:** `app/app/api/rpc/route.ts:69,159`

**Code:**
```typescript
let lastSuccessfulEndpoint: string | null = null;
// ... in handler:
lastSuccessfulEndpoint = endpoint; // Write on success
```

**Race scenario:** Two concurrent POST requests. Request A hits endpoint 1 (success, updates sticky). Request B hits endpoint 2 (because endpoint 1 was 5xx for B's request, but A already recovered it). B updates sticky to endpoint 2. Now sticky points to a potentially less reliable endpoint.

**Impact:** Low -- the retry loop in each individual request recovers from any endpoint being down. The worst case is one extra retry per request.

### Finding ERR02-008: useSwap Debounce Quote Loading Race (Low)

**Location:** `app/hooks/useSwap.ts:562-566`

**Code pattern:**
```typescript
quoteTimerRef.current = setTimeout(() => {
  computeQuote("input", amount);
  setQuoteLoading(false);  // Always clears, even if newer timer exists
}, QUOTE_DEBOUNCE_MS);
```

**Race scenario:** User types "1", timer A starts. User types "12", timer A is cleared, timer B starts. But if timer A already fired (300ms elapsed), it sets `quoteLoading(false)` -- then timer B fires and also sets `quoteLoading(false)`. The "false" from timer A may briefly show the old quote as "loaded" before timer B overwrites it.

**Impact:** Low -- cosmetic flicker, no incorrect data used for TX construction.

### Finding ERR02-009: useStaking pendingRewards Snapshot Staleness (Medium)

**Location:** `app/hooks/useStaking.ts:553-554, 565-566`

**Code:**
```typescript
case "unstake": {
  // ...
  setLastResult({
    action: "unstake",
    forfeitedAmount: pendingRewards,  // Captured at button click time
  });
  break;
}
```

**The concern:** `pendingRewards` is a `useMemo` value computed from `stakePoolRaw.rewardsPerTokenStored` (SSE data) and `userStakeRaw` (30s polled data). Between the user clicking "Unstake" and the TX confirming, the actual on-chain rewards may have changed (new deposits arrived, other users claimed). The displayed "forfeited" amount in the success message may differ from what was actually forfeited on-chain.

**Impact:** Medium -- incorrect success message displayed to user. No financial loss (on-chain is source of truth), but misleading UX.

### Finding ERR02-010: SSE Manager Set Iteration During Deletion (Low)

**Location:** `app/lib/sse-manager.ts:62-69`

**Code:**
```typescript
for (const callback of this.subscribers) {
  try {
    callback(payload);
  } catch {
    this.subscribers.delete(callback);
  }
}
```

**The concern:** Deleting from a `Set` while iterating with `for...of` is spec-compliant in JavaScript (the iteration reflects deletions). However, if a `callback` synchronously calls `sseManager.subscribe()` (adding a new callback), the iteration may or may not visit the new callback depending on timing. In this codebase, callbacks are created asynchronously in SSE route handlers, so synchronous re-subscription during broadcast is not expected.

**Impact:** Low -- theoretical, no observed path triggers this.

### Finding ERR02-011: useTokenBalances isDispatchingRef Sync Guard Limitation (Informational)

**Location:** `app/hooks/useTokenBalances.ts:166-174`

**Code:**
```typescript
const refresh = useCallback(() => {
  fetchBalances();
  isDispatchingRef.current = true;
  window.dispatchEvent(new CustomEvent(BALANCE_REFRESH_EVENT));
  isDispatchingRef.current = false;
}, [fetchBalances]);
```

**The concern:** The `isDispatchingRef` guard prevents the dispatching instance from handling its own event (since `dispatchEvent` is synchronous and fires handlers inline). This works correctly. However, `fetchBalances()` is async and is called BEFORE the dispatch. If the event fires before the async fetch resolves (which it does, since dispatch is sync), other instances start their own fetch in parallel. This is by design -- not a bug, just an observation that multiple parallel RPC calls happen.

**Impact:** Informational -- correct behavior, extra parallel RPC calls are expected and intentional.

### Finding ERR02-012: RPC Proxy Missing Fetch Timeout (Medium -- AIP-141)

**Location:** `app/app/api/rpc/route.ts:144`

**Code:**
```typescript
const upstream = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: bodyStr,
  // No signal/timeout
});
```

**The concern:** If the upstream Helius RPC endpoint hangs (accepts the TCP connection but never responds), this `fetch()` will block indefinitely. The Next.js request handler has no external timeout, so the connection to the browser also hangs. Under sustained load with a hung upstream, all proxy request handler slots could be consumed, causing a full proxy outage.

**Impact:** Medium -- a hung upstream causes cascading proxy exhaustion. The failover loop only retries on HTTP 5xx or network errors (DNS/TCP failure), not on hangs.

**Mitigation:** Add `signal: AbortSignal.timeout(10_000)` to the fetch call.

## Cross-Focus Intersections

| This Focus | Other Focus | Intersection |
|-----------|-------------|--------------|
| ERR02-001 (double-init) | CHAIN-01 (RPC) | Doubled WS subscriptions + poll timers = doubled RPC credit burn |
| ERR02-002 (SSE limit bypass) | INFRA-03 (DoS) | Weakens H008 fix; INFRA-03 should assess Railway-level connection limits |
| ERR02-003 (rate limit bypass) | ERR-03 (Rate Limiting) | Same finding, different lens. ERR-03 should quantify the concurrent bypass window |
| ERR02-005 (candle close ordering) | DATA-01 (Data Persistence) | This is H033 from Audit #1 (NOT_FIXED). DATA-01 should assess impact |
| ERR02-009 (reward snapshot) | LOGIC-02 (Financial) | Displayed forfeited/claimed amounts may be inaccurate. LOGIC-02 should verify |
| ERR02-012 (fetch timeout) | CHAIN-01 (RPC), ERR-03 (Rate Limiting) | Hung upstream creates resource exhaustion, not just a timeout issue |

## Cross-Reference Handoffs

- **To ERR-03**: ERR02-003 (rate limiter non-atomic check) should be analyzed for maximum bypass window under realistic concurrent load.
- **To CHAIN-01**: ERR02-001 (ws-subscriber double-init) should be assessed for RPC credit consumption impact and whether doubled poll timers create data inconsistency.
- **To DATA-01**: ERR02-005 (candle close ordering) is H033 carried forward. Determine if adding a `WHERE timestamp <= $new_timestamp` guard on the close UPDATE is warranted.
- **To INFRA-03**: ERR02-002 (SSE connection limit bypass) -- assess whether Railway's reverse proxy imposes its own per-IP connection limits that mitigate this.
- **To LOGIC-02**: ERR02-009 (staking reward snapshot) -- assess whether displaying a stale reward amount as "forfeited" or "claimed" is misleading enough to warrant a post-TX RPC refresh.

## Risk Observations

### Priority 1: ws-subscriber double-init (ERR02-001)
- **Likelihood**: Possible (depends on Next.js startup behavior, more likely in dev/hot-reload)
- **Impact**: Medium (doubled RPC costs, duplicate broadcasts)
- **Recommendation**: Set `state.initialized = true` before the first `await`, or use a promise-based lock pattern

### Priority 2: SSE connection limit bypass (ERR02-002)
- **Likelihood**: Possible (requires concurrent connections, achievable by attacker)
- **Impact**: Medium (weakens H008 DoS mitigation)
- **Recommendation**: Make acquire/release operations check-and-set in a single synchronous step. Since Node.js is single-threaded, wrapping the read-check-write in a synchronous function (no `await` in between) is sufficient.

### Priority 3: RPC proxy missing fetch timeout (ERR02-012)
- **Likelihood**: Possible (upstream RPC hangs do occur)
- **Impact**: Medium (cascading proxy outage)
- **Recommendation**: Add `signal: AbortSignal.timeout(10_000)` to the upstream fetch

### Priority 4: Staking reward snapshot staleness (ERR02-009)
- **Likelihood**: Probable (rewards change between click and confirmation)
- **Impact**: Low-Medium (misleading UX, no fund loss)
- **Recommendation**: Either re-fetch rewards after TX confirmation and update the result, or display "approximately X SOL" instead of exact amount

### Priority 5: Rate limiter non-atomic check (ERR02-003)
- **Likelihood**: Possible (under high concurrency)
- **Impact**: Low (off-by-few, defense-in-depth)
- **Recommendation**: Acceptable risk. The rate limiter is already synchronous within a tick -- the "race" requires two requests to interleave at the exact right async boundary, which is narrow.

## Novel Attack Surface Observations

1. **Timer accumulation via forced restart**: If an attacker can trigger Next.js process restarts rapidly (e.g., by sending payloads that cause uncaught exceptions in non-guarded code paths), the TOCTOU in ws-subscriber init could accumulate timers that survive across restarts via the globalThis singleton. Each restart adds 4 more timers without clearing old ones (since `state.initialized` is reset when the module re-evaluates, but the timers from the previous init are still running on globalThis). This would geometrically increase RPC credit consumption.

2. **SSE connection slot exhaustion via half-open connections**: By rapidly opening SSE connections and aborting them before the `req.signal.addEventListener("abort")` handler is registered (in the gap between `acquireConnection()` at line 44 and the abort handler at line 110 of the SSE route), an attacker could acquire connection slots that are never released. The 30-minute auto-release timer is the only cleanup mechanism. At 10 connections per IP, an attacker with 500 IPs could exhaust the global 5000 limit, denying SSE to all users.

3. **Debounce timing manipulation**: The 300ms quote debounce in useSwap can be "raced" by a user rapidly typing amounts, causing the displayed quote to lag behind the actual amounts. If the user clicks swap during this window, `inputAmount` (from state) may not match `quote.minimumOutput` (from the debounced computation). However, the TX builder reads `inputAmount` at build time (same tick as executeSwap), and on-chain slippage checks prevent loss.

## Questions for Other Focus Areas

1. **For CHAIN-01**: Does the ws-subscriber create a new `Connection` instance per `getConnection()` call, or is it a singleton? If singleton, are there Connection-level timeouts configured?
2. **For INFRA-03**: Does Railway's nginx proxy impose its own connection limits per IP? If so, ERR02-002 (SSE limit bypass) may be mitigated at the infrastructure level.
3. **For DATA-01**: Is the candle close-price ordering (ERR02-005 / H033) causing visible chart artifacts in production? If so, a SQL `WHERE` guard on the UPDATE could fix it.
4. **For ERR-03**: What is the maximum realistic concurrent request rate to a single Next.js API route handler? This determines the practical exploitability of ERR02-003.
5. **For LOGIC-02**: For the staking reward snapshot (ERR02-009), does the on-chain `claim` instruction emit an event with the actual claimed amount? If so, the webhook could provide the accurate amount post-confirmation.

## Raw Notes

### Double-submit protection assessment
- `SwapForm.tsx:195`: `isTransacting = status !== "idle" && status !== "confirmed" && status !== "failed"` -- correctly blocks during all transacting states
- `BigRedButton.tsx:105`: `disabled={(disabled && status === 'idle') || isTransacting` -- UI-level prevention
- `StakingForm.tsx:48`: Same pattern for staking
- **Verdict**: Double-submit is adequately protected at the UI level. The hooks themselves don't have guards (they rely on the UI), but since hooks are consumed by a single UI component each, this is acceptable.

### globalThis singleton pattern assessment
All 5 server-side singletons (ws-subscriber, protocol-store, sse-manager, credit-counter, sse-connections) use the same `globalThis` pattern. In production (single module load), globalThis is unnecessary but harmless. In dev mode (HMR), globalThis correctly preserves state across hot reloads. The pattern is consistent and correctly implemented per the project's Turbopack memory note (unconditional assignment, no NODE_ENV guard).

### Promise.all usage assessment
- `ws-subscriber.ts:168`: `Promise.all([getTokenSupply(CRIME), getTokenSupply(FRAUD)])` -- parallel supply fetch. If one fails, both results are lost. This is acceptable because the catch handler at the call site (pollSupply, batchSeed) logs and continues.
- `candle-aggregator.ts:102`: `Promise.all(RESOLUTIONS.map(...))` -- parallel upserts across 6 resolutions. These target different rows, so no conflict.
- `useCurveState.ts:220`: `Promise.all([fetch(crime), fetch(fraud)])` -- parallel curve fetch in refresh(). If one fails, the error handler catches all.
- `useTokenBalances.ts:85`: `Promise.all([getBalance, getParsedTokenAccountsByOwner])` -- parallel balance fetch. Clean error handling.
- **Verdict**: All `Promise.all` usages are appropriate. No `Promise.allSettled` is needed because all grouped operations are fail-together (log and retry on next interval).

### Candle aggregation atomicity
The candle upsert uses `onConflictDoUpdate` with SQL `GREATEST`/`LEAST` for high/low, which is atomic at the SQL level. The only non-atomic column is `close` (always overwritten with the new price). The `open` column is safe because it's only set on INSERT (not in the UPDATE set), so the first trade's price is preserved. The `tradeCount` increment is atomic via SQL (`tradeCount + 1`). Volume addition is also atomic (`volume + $new_volume`).

### Webhook idempotency assessment
All three event types (swap, epoch, carnage) use `onConflictDoNothing`:
- `swap_events`: PK = `txSignature` -- duplicate webhook deliveries are silently ignored
- `epoch_events`: Unique on `epochNumber` -- first epoch event wins
- `carnage_events`: Unique on `epochNumber` -- first carnage event wins
**Verdict**: Database-level idempotency is correct and race-proof.
