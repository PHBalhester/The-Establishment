---
task_id: db-phase1-race-concurrency
provides: [race-concurrency-findings, race-concurrency-invariants]
focus_area: race-concurrency
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/lib/sse-manager.ts, app/app/api/sse/candles/route.ts, app/db/candle-aggregator.ts, app/db/connection.ts, app/db/schema.ts, app/lib/event-parser.ts, app/lib/confirm-transaction.ts, app/hooks/useSwap.ts, app/hooks/useTokenBalances.ts, app/hooks/useStaking.ts, app/hooks/useCurveState.ts, app/components/station/BigRedButton.tsx, app/lib/swap/error-map.ts, app/lib/staking/error-map.ts, app/lib/curve/error-map.ts, scripts/crank/crank-runner.ts, scripts/vrf/lib/vrf-flow.ts]
finding_count: 8
severity_breakdown: {critical: 0, high: 1, medium: 3, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Race Conditions & Concurrency -- Condensed Summary

## Key Findings (Top 8)

1. **No double-submit guard in useSwap executeSwap/executeRoute**: The swap execution functions have no mutex or ref-guard preventing a second invocation while the first is in-flight. The UI button disables via `status !== 'idle'`, but programmatic callers or rapid clicks during the `idle -> building` transition window could trigger concurrent execution. -- `app/hooks/useSwap.ts:673-791`
2. **SSE broadcast Set mutation during iteration**: `SSEManager.broadcast()` deletes from `this.subscribers` inside the `for...of` loop over that same Set. JavaScript Sets tolerate this (deleted items are still visited if already passed, not-yet-visited deleted items are skipped), but adding a subscriber during broadcast could cause non-deterministic delivery. -- `app/lib/sse-manager.ts:60-67`
3. **Webhook handler sequential DB writes without transaction wrapping**: Each swap event insert + candle upsert pair is not wrapped in a DB transaction. If the candle upsert fails, the swap event is committed but candles are stale. The try/catch around candles (line 235) explicitly tolerates this, but concurrent webhook deliveries for the same pool could interleave candle upserts with non-monotonic close prices. -- `app/app/api/webhooks/helius/route.ts:198-242`
4. **Candle close price is last-write-wins**: `onConflictDoUpdate` sets `close = new_price` unconditionally. If two webhook deliveries for the same candle bucket arrive concurrently and are processed out of blockTime order, the candle's close price will reflect whichever DB statement commits last, not the chronologically latest trade. -- `app/db/candle-aggregator.ts:118-127`
5. **DB connection singleton race on cold start**: `getDb()` checks `globalForDb.drizzleDb` then creates a new client if absent. Two concurrent requests hitting the API on cold start could each create a separate postgres.js client. The second overwrites the first in `globalForDb`, orphaning the first client's connection pool. -- `app/db/connection.ts:37-59`
6. **Balance fetch / swap execution TOCTOU**: `useSwap` reads balances via `useTokenBalances` (polled every 30s), user sees balance X, clicks swap. Between quote computation and on-chain TX landing, the balance may have changed (another browser tab, external wallet). On-chain slippage checks mitigate financial loss, but the user sees a stale quote. -- `app/hooks/useSwap.ts:200-204` + `app/hooks/useTokenBalances.ts:85-91`
7. **Crank runner has no lock preventing duplicate instances**: If Railway restarts overlap or a dev runs a second instance, two crank processes compete for the same VRF epoch transitions. The on-chain program's epoch boundary check prevents double-advance, but the competing processes waste SOL on failed transactions. -- `scripts/crank/crank-runner.ts:197-316`
8. **EventParser stateful but correctly fresh-per-call**: The code comment at line 218 notes EventParser is stateful and a fresh instance is created per call. This is correct and avoids cross-call state leakage. Noted as a positive pattern. -- `app/lib/event-parser.ts:218-229`

## Critical Mechanisms

- **Webhook -> DB -> SSE pipeline**: Helius webhook delivers batches of transactions. Each TX is processed sequentially within the batch, but multiple webhook POST requests can arrive concurrently from Helius (batch retries, parallel delivery). DB writes use `onConflictDoNothing` for idempotency on swap/epoch/carnage events, and `onConflictDoUpdate` with GREATEST/LEAST for candle aggregation. SSE broadcast happens inline after DB write. -- `app/app/api/webhooks/helius/route.ts:131-289`
- **Swap execution state machine**: `useSwap` uses a string status (`idle` -> `building` -> `signing` -> etc.) to track lifecycle. The BigRedButton disables itself when `status !== 'idle'`. No programmatic lock exists beyond this UI state. -- `app/hooks/useSwap.ts:192`, `app/components/station/BigRedButton.tsx:83-105`
- **Crank runner single-threaded loop**: The crank runs as a single `while(!shutdownRequested)` loop with `await` at each step. No concurrency within a single instance. Graceful shutdown via SIGINT/SIGTERM sets a flag checked at loop top. -- `scripts/crank/crank-runner.ts:197-316`

## Invariants & Assumptions

- INVARIANT: Each swap event can only be stored once per TX signature -- enforced at `app/db/schema.ts:33` (PK on tx_signature) + `route.ts:337` (onConflictDoNothing)
- INVARIANT: Each epoch has at most one epoch_events row -- enforced at `app/db/schema.ts:106` (uniqueIndex on epoch_number) + `route.ts:454` (onConflictDoNothing)
- INVARIANT: Candle data for a (pool, resolution, open_time) triple is upserted atomically via SQL -- enforced at `app/db/candle-aggregator.ts:118-127` (onConflictDoUpdate with GREATEST/LEAST)
- INVARIANT: EventParser instances are not shared across calls -- enforced at `app/lib/event-parser.ts:221-229` (fresh per call)
- ASSUMPTION: Only one crank-runner instance runs at a time -- NOT enforced off-chain (no distributed lock). On-chain program prevents double-advance, but SOL is wasted on failed attempts.
- ASSUMPTION: Webhook deliveries for the same candle bucket arrive in blockTime order -- UNVALIDATED. Helius does not guarantee ordering. Out-of-order delivery could set wrong close price.
- ASSUMPTION: `getDb()` is only called once at startup or hot-reload boundary -- PARTIALLY enforced by globalThis cache. Cold-start race possible if two requests arrive simultaneously before `globalForDb.drizzleDb` is set.

## Risk Observations (Prioritized)

1. **Candle close price ordering** (MEDIUM): Concurrent out-of-order webhook deliveries can corrupt candle close prices. The `close` field uses last-write-wins semantics. Mitigated by typical single-process deployment, but still a data integrity risk. -- `app/db/candle-aggregator.ts:123`
2. **Double-submit in useSwap** (MEDIUM): No mutex prevents concurrent `executeSwap()` calls. UI guard exists but is not synchronization-safe. In practice, the wallet signing popup blocks interaction, but programmatic callers or keyboard shortcuts could bypass. -- `app/hooks/useSwap.ts:673`
3. **DB connection pool exhaustion on cold start** (MEDIUM): Two concurrent requests on cold start could create two postgres.js clients (20 connections total vs. expected 10). In production non-dev mode, the pgClient is NOT cached on globalThis (line 53-55 only caches in dev mode), so every cold start request creates a fresh client. -- `app/db/connection.ts:50-55`
4. **Crank duplicate instance** (LOW): No distributed lock. Second instance wastes SOL on failed TXs but cannot cause double-advance. -- `scripts/crank/crank-runner.ts`

## Novel Attack Surface

- **Webhook replay as data poisoning**: Since `HELIUS_WEBHOOK_SECRET` is optional, an attacker could replay or craft webhook payloads to inject false swap events. While `onConflictDoNothing` prevents duplicating existing TX signatures, an attacker could use fabricated signatures to insert fake swap data, corrupting candle prices. This is an injection concern (API-04/INJ-03 territory) but has concurrency implications: the attacker's fake events race with real events for candle close price.
- **SSE subscriber accumulation**: If SSE clients connect but the abort signal never fires (proxy keeps connection alive but browser is gone), subscribers accumulate in the in-memory Set without cleanup. The heartbeat catch block removes errored subscribers, but a zombie connection that silently accepts data would persist. At scale, this becomes a memory leak rather than a race condition.

## Cross-Focus Handoffs

- -> **API-04 (Webhook Security)**: The optional webhook auth (`HELIUS_WEBHOOK_SECRET`) is the primary enabler for the data poisoning attack surface. Verify whether this is hardened for production.
- -> **DATA-01 (Database Integrity)**: The candle close price ordering issue and cold-start connection pool race are database integrity concerns that need DATA-01 analysis.
- -> **BOT-01 (Crank Automation)**: Verify whether Railway's deployment strategy (rolling vs. recreate) could cause overlapping crank instances during deploys.
- -> **ERR-01 (Error Handling)**: The webhook's per-transaction try/catch (line 258-267) swallows errors to continue batch processing. Verify that swallowed errors don't hide concurrency failures.

## Trust Boundaries

The primary concurrency trust boundary is between the Helius webhook delivery and the internal DB/SSE pipeline. Helius can deliver batches concurrently, out-of-order, and with retries, yet the handler assumes roughly sequential processing within a single Next.js process. The DB's unique constraints and upsert semantics provide the real idempotency guarantee, not application-level locking. On the frontend, the user's browser is single-threaded so React hooks avoid true concurrency, but the gap between quote computation and on-chain execution creates a TOCTOU window that is standard for all DEX frontends and mitigated by on-chain slippage checks.
<!-- CONDENSED_SUMMARY_END -->

---

# Race Conditions & Concurrency -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase is a single-process Next.js application with a companion crank-runner bot. True multi-threaded concurrency (worker_threads, cluster) is absent entirely -- all async operations run on the Node.js event loop. This significantly reduces the race condition attack surface compared to multi-process architectures.

The primary concurrency risks arise from:
1. **Concurrent webhook deliveries** from Helius that can interleave DB writes
2. **Missing double-submit guards** in frontend swap/staking execution
3. **Candle data ordering** assuming sequential event processing
4. **Cold-start DB connection races** in the singleton pattern

All financial operations are ultimately guarded by on-chain program checks (slippage, balance validation, PDA ownership), which limits the severity of off-chain race conditions to data integrity rather than fund loss.

## Scope

All off-chain TypeScript/TSX code, excluding `programs/` (Anchor on-chain code). Focus on:
- Webhook handler (data pipeline entry point)
- SSE pub/sub system
- Database connection and aggregation
- Frontend hooks (swap, staking, balances)
- Crank runner bot
- VRF flow orchestration

## Key Mechanisms

### 1. Webhook -> DB -> SSE Pipeline

**File:** `app/app/api/webhooks/helius/route.ts`

The webhook handler is the central data ingestion point. Helius delivers batches of raw transactions via POST. The handler:
1. Validates optional auth header (line 136-141)
2. Parses JSON body as array of transactions (line 146)
3. Iterates each transaction sequentially within the batch (line 160)
4. For each TX: parses events, stores in DB, upserts candles, broadcasts SSE

**Concurrency concern:** Multiple webhook POST requests can arrive concurrently. Next.js handles each request in a separate async context on the same event loop. Two requests processing swaps for the same candle bucket can interleave their `upsertCandles` calls.

**Mitigations in place:**
- `onConflictDoNothing` on swap_events (TX signature PK) -- idempotent
- `onConflictDoUpdate` with `GREATEST`/`LEAST` on candles -- atomic at SQL level
- Per-TX try/catch isolation (line 258-267)

**Remaining risk:** The `close` price in candle upsert is unconditionally set to the new price (`close: sql\`${update.price}\``). If two swaps in the same candle bucket are processed out of blockTime order (e.g., swap at T=5 processed before swap at T=3), the close price reflects T=3 instead of T=5. This is a data integrity issue, not a financial one.

### 2. SSE Manager Singleton

**File:** `app/lib/sse-manager.ts`

The SSEManager uses a `Set<SSECallback>` for subscribers. Key concurrency observations:

- `broadcast()` iterates the Set with `for...of` and calls `subscribers.delete(callback)` in the catch block (line 65). JavaScript's Set specification allows deletion during iteration: already-visited elements are unaffected, not-yet-visited deleted elements are skipped. This is safe.
- However, if `subscribe()` is called during a `broadcast()` iteration (e.g., a new SSE client connects while a webhook is broadcasting), the new subscriber may or may not receive the current broadcast depending on Set insertion order relative to iteration position. This is non-deterministic but benign -- the new client will receive subsequent broadcasts.
- The globalThis singleton pattern (line 84-92) correctly survives HMR in dev mode. In production, the singleton is established on first module load and shared across all request handlers within the same Node.js process.

### 3. Database Connection Singleton

**File:** `app/db/connection.ts`

The `getDb()` function uses a check-then-act pattern:
```
if (globalForDb.drizzleDb) return globalForDb.drizzleDb;
// ... create client
globalForDb.drizzleDb = instance;
```

In Node.js single-threaded execution, this is safe IF all callers `await` before the next caller enters. However, on cold start, two concurrent HTTP requests could both enter `getDb()` before either sets `globalForDb.drizzleDb`. Each creates a separate postgres.js client.

**Production-specific issue (line 53-55):** The `pgClient` is only cached on globalThis in non-production mode. In production, each call to `getDb()` that passes the `drizzleDb` check creates a fresh postgres.js client. However, since `drizzleDb` IS cached (line 58), subsequent calls return the cached drizzle instance. The race is only on the very first two concurrent calls.

**Impact:** Orphaned connection pool (up to 10 extra connections). postgres.js handles this gracefully (idle connections close after timeout), so the impact is transient resource waste, not a crash.

### 4. Frontend Swap Execution

**File:** `app/hooks/useSwap.ts`

The `executeSwap` callback (line 673) follows this flow:
1. Check `wallet.publicKey && wallet.connected && quote` (line 674)
2. Set status to "building" (line 683)
3. Build transaction
4. Sign and send
5. Confirm
6. Update status

**Double-submit analysis:**
- The status state transition from "idle" to "building" is an asynchronous React state update. Between the time `executeSwap()` is called and `setStatus("building")` takes effect, a second call could pass the guard check.
- The BigRedButton component (line 83, 105) disables itself when `status !== 'idle'` AND sets `disabled` on the HTML button. This prevents click-driven double-submit.
- The `handleClick` function (line 67-73) checks `status === 'idle'` synchronously before calling `onSwap()`. Combined with the button's `disabled` attribute, this provides adequate UI-level protection.
- **Risk:** If `executeSwap` is called programmatically (not through the button), or if a keyboard shortcut fires before React re-renders the disabled state, a double-submit is possible. However, the wallet signing popup (Phantom, etc.) serializes user interaction, making this extremely unlikely in practice.

### 5. Crank Runner Loop

**File:** `scripts/crank/crank-runner.ts`

The crank is a simple `while (!shutdownRequested)` loop with sequential `await` calls. No internal concurrency exists. Key observations:

- **Single-instance assumption:** No distributed lock (Redis, file lock, etc.) prevents multiple crank instances. Railway's deployment model (single container) naturally prevents this, but rolling deploys could briefly overlap two instances.
- **On-chain safety net:** The epoch program's `trigger_epoch_transition` instruction checks `current_slot >= epoch_start_slot + SLOTS_PER_EPOCH`. If two crank instances race, the first succeeds and the second gets `EpochBoundaryNotReached` or the epoch number advances past the second's stale state read.
- **Graceful shutdown:** SIGINT/SIGTERM set `shutdownRequested = true` (line 79-89). The flag is checked at the loop top (line 197). If a signal arrives mid-cycle, the current cycle completes before shutdown. This is correct -- partial epoch transitions would be worse than completing the current one.

### 6. Token Balance Polling

**File:** `app/hooks/useTokenBalances.ts`

The hook polls every 30 seconds and also responds to cross-instance `CustomEvent` dispatches. Key concurrency observations:

- **Double-fetch guard (line 142-154):** `isDispatchingRef.current` prevents the dispatching instance from also handling its own event. This is a correct synchronization pattern using a synchronous ref (no async gap between set and check).
- **Stale balance TOCTOU:** Balances are fetched every 30s. A user sees a balance, enters a swap amount, and submits. Between the last fetch and TX landing, the balance may have changed. This is inherent to all DEX frontends and mitigated by on-chain slippage checks. Not a bug -- standard architecture.

## Trust Model

| Boundary | Trust Level | Concurrency Risk |
|----------|-------------|------------------|
| Helius -> Webhook Handler | Low (optional auth) | Concurrent/out-of-order delivery |
| Webhook -> Postgres | Medium (SQL constraints) | Upsert atomicity provides safety |
| Webhook -> SSE | High (in-process) | Set mutation during iteration |
| User -> useSwap | Medium (UI guards) | Double-submit window |
| Crank -> On-chain | High (program validates) | Duplicate instance wastes SOL |
| Browser -> RPC | Medium (RPC is trusted) | Stale reads (30s polling) |

## State Analysis

### Shared Mutable State
1. **`globalForDb.drizzleDb`** -- Singleton DB instance, written once on cold start. Race window: ~1ms on first concurrent requests.
2. **`sseManager.subscribers`** -- Set of SSE callbacks, mutated by subscribe/unsubscribe/broadcast. All mutations are synchronous (no `await` between check and modify), so Node.js event loop guarantees atomicity within each operation.
3. **React state in useSwap** -- `status`, `quote`, `txSignature` etc. React batches state updates, so rapid calls to setters are coallesced. No cross-component shared mutable state (each hook instance has its own state).

### Database Concurrency
- **Postgres default isolation:** READ COMMITTED. Two concurrent webhook handlers upserting the same candle row will serialize at the row level (Postgres row-level locking). The `GREATEST`/`LEAST` SQL functions execute within the row lock, so high/low are always correct. Only `close` is at risk from ordering.
- **No explicit transactions:** The webhook handler does not wrap swap_event insert + candle upsert in a transaction. If the candle upsert fails (caught at line 235), the swap event is committed but candles are stale. This is documented as intentional ("candle failure must NOT block swap storage").

## Dependencies

- **postgres.js** -- Connection pooling, automatic reconnection, no explicit locking primitives used.
- **Drizzle ORM** -- Generates parameterized SQL. `onConflictDoNothing` and `onConflictDoUpdate` map to Postgres `ON CONFLICT` clauses, which are atomic at the SQL level.
- **Next.js App Router** -- Each API route handler runs in a separate async context. Route handlers can execute concurrently on the same event loop.
- **Switchboard SDK** -- VRF flow uses sequential transactions (TX1 -> TX2 -> TX3). No concurrency within a single VRF cycle.

## Focus-Specific Analysis

### TOCTOU Patterns

1. **Quote -> Execute TOCTOU (EXPECTED):** `useSwap` quotes using current pool reserves, then builds a transaction with those reserves. By the time the TX lands on-chain, reserves may have changed. The on-chain `minimum_output` parameter (slippage check) prevents execution at a worse price. This is standard DEX architecture, not a bug.

2. **Balance check -> Execute TOCTOU (EXPECTED):** Similar to above. User sees balance X, submits swap for amount Y <= X. If balance drops between display and execution, the on-chain instruction fails with InsufficientBalance. No off-chain double-spend is possible because the user doesn't have a server-side balance -- all balances are on-chain.

3. **DB singleton check-then-create (MINOR):** Described above. Two concurrent requests on cold start could create duplicate postgres.js clients. Impact: transient connection waste.

### Double-Spend via Concurrent Requests

Not applicable in the traditional sense. This project has no server-side balance management. All token balances are on-chain. The "double-spend" scenario would require:
- Two browser tabs submitting the same swap simultaneously
- Both transactions landing before either is confirmed
- On-chain: The second TX would fail because the first TX already moved the user's tokens

The off-chain code has no responsibility for preventing this -- it's an on-chain guarantee.

### Worker Thread / Cluster Analysis

No `worker_threads`, `cluster`, `child_process`, or `SharedArrayBuffer` usage found. The entire application runs on a single Node.js event loop. This eliminates an entire class of race conditions.

## Cross-Focus Intersections

- **API-04 (Webhook Security):** The optional webhook auth is the primary enabler for data injection. If an attacker can send fake webhooks, they can race with real events for candle close prices, creating misleading chart data.
- **ERR-01 (Error Handling):** The per-TX try/catch in the webhook handler (line 258) swallows errors and continues processing. If a concurrency-related error (e.g., deadlock) is swallowed, the operator has no visibility into the issue.
- **DATA-01 (Database Integrity):** Candle close price ordering and cold-start connection duplication are database integrity concerns.
- **BOT-01 (Crank Automation):** Duplicate crank instances waste SOL. Railway's deployment strategy determines whether this is possible.

## Cross-Reference Handoffs

1. **-> DATA-01:** Verify whether Postgres row-level locking on candle upserts guarantees correct `close` price ordering when two concurrent requests process events out of blockTime order.
2. **-> API-04:** Verify production webhook auth configuration. If `HELIUS_WEBHOOK_SECRET` is unset in production, the data pipeline is fully open.
3. **-> BOT-01:** Verify Railway container lifecycle -- does a rolling deploy create a window where two crank instances run simultaneously?
4. **-> ERR-01:** Audit the swallowed errors in the webhook per-TX catch block for concurrency failure modes (deadlocks, connection timeouts under load).

## Risk Observations

1. **(MEDIUM) Candle close price data corruption from concurrent out-of-order webhook delivery:** Two Helius webhooks arriving concurrently with events in different blockTime order will race for the candle `close` price. The last SQL statement to commit wins, regardless of chronological order. Impact: incorrect chart data. Mitigation: store blockTime in candle row, use `CASE WHEN new_blocktime > existing_blocktime THEN new_price ELSE existing_close` in the upsert.

2. **(MEDIUM) No programmatic double-submit guard in useSwap:** The `executeSwap` and `executeRoute` callbacks rely on React state (`status`) for re-entrancy prevention. React state updates are asynchronous, creating a theoretical window for double-invocation. Impact: two identical transactions submitted, one succeeds, one fails (SOL wasted on TX fees for the failed one). Mitigation: add a synchronous ref guard (`if (executingRef.current) return; executingRef.current = true;`).

3. **(MEDIUM) DB connection pool race on cold start:** Two concurrent requests before globalForDb is populated create duplicate postgres.js clients. The second client's connections are orphaned. Impact: transient connection count spike. Mitigation: use synchronous module-level initialization or a promise-based singleton.

4. **(LOW) Crank duplicate instance:** No distributed lock. Impact: wasted SOL on failed transactions. Mitigation: file lock, Redis lock, or Railway health check that prevents new instance until old is terminated.

5. **(LOW) SSE subscriber zombie accumulation:** If proxy keeps connection alive but browser is gone, subscriber callbacks accumulate. The heartbeat catch block (SSE route line 62-68) handles errors, but a silent consumer (proxy buffering indefinitely) would persist. Impact: memory leak over time. Mitigation: TTL-based subscriber eviction.

6. **(LOW) useTokenBalances cross-instance refresh stampede:** When any instance calls `refresh()`, all instances re-fetch simultaneously via CustomEvent. If 5 components use this hook, one swap completion triggers 5 concurrent RPC calls. Impact: RPC rate limiting. Mitigation: debounce the event listener, or use a shared fetch with cache.

7. **(LOW) Staking hook same pattern as swap -- no execute guard:** `useStaking` follows the same status-based guard pattern as `useSwap`. Same theoretical double-submit window exists. Same low practical risk due to wallet popup serialization.

## Novel Attack Surface Observations

**Webhook replay with crafted timestamps:** An attacker who can send webhook payloads (no auth configured) could craft events with specific blockTimes to manipulate candle data. By sending a fabricated swap event with a future blockTime, the attacker sets the candle's close price to an arbitrary value. If the chart is used for trading decisions (showing fake pump/dump), this could influence user behavior. The attack is rate-limited only by the webhook endpoint's request processing speed (no rate limiting observed).

## Questions for Other Focus Areas

1. **For DATA-01:** Does Postgres's `ON CONFLICT DO UPDATE` guarantee that concurrent upserts to the same row serialize correctly? Specifically, if two concurrent `INSERT ... ON CONFLICT DO UPDATE SET close = $1` statements target the same row, does the second see the first's update?
2. **For API-04:** Is `HELIUS_WEBHOOK_SECRET` set in the Railway production environment? The code explicitly skips auth if unset (line 136).
3. **For BOT-01:** What is Railway's container lifecycle during deploys? Is there overlap between old and new container?
4. **For INFRA-03:** What is the postgres.js connection pool size in production? The code sets `max: 10` (line 51). Is this adequate for concurrent webhook + API route load?

## Raw Notes

- No `Promise.race` usage in production code (only in tests).
- `Promise.all` is used safely: candle upserts target different resolution rows (no conflict), token balance fetch parallelizes independent RPC calls.
- The `pollTransactionConfirmation` helper (confirm-transaction.ts) has a 90s timeout and polls every 2s. No concurrency concern -- it's a simple sequential poll loop.
- The error-map files (swap, staking, curve) are pure functions with no state. No concurrency concern.
- EventParser correctly creates fresh instances per call (line 221-229). Reusing a stateful parser across calls would cause cross-contamination of program invocation depth tracking.
- The `useCurveState` hook uses WebSocket subscriptions (`connection.onAccountChange`). These fire callbacks on the event loop -- no concurrent state mutation risk within React's rendering model.
