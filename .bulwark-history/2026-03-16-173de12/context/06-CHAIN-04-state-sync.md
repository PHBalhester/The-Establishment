---
task_id: db-phase1-state-sync
provides: [state-sync-findings, state-sync-invariants]
focus_area: state-sync
files_analyzed: [app/lib/connection.ts, app/lib/swap/hook-resolver.ts, app/lib/swap/swap-builders.ts, app/lib/staking/staking-builders.ts, app/lib/curve/curve-tx-builder.ts, app/lib/curve/hook-accounts.ts, app/hooks/usePoolPrices.ts, app/hooks/useEpochState.ts, app/hooks/useCurveState.ts, app/hooks/useTokenBalances.ts, app/hooks/useCarnageData.ts, app/hooks/useSwap.ts, app/hooks/useStaking.ts, app/lib/confirm-transaction.ts, app/app/api/webhooks/helius/route.ts, app/lib/sse-manager.ts, app/app/api/sse/candles/route.ts, app/db/schema.ts, app/lib/event-parser.ts, scripts/crank/crank-runner.ts, scripts/crank/crank-provider.ts, scripts/deploy/lib/connection.ts, shared/constants.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 3, informational: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# On-Chain/Off-Chain State Synchronization -- Condensed Summary

## Key Findings (Top 10)
- **Webhook auth is optional**: `HELIUS_WEBHOOK_SECRET` check is skipped if env var is unset, allowing unauthenticated webhook POSTs to insert arbitrary data into the database -- `app/app/api/webhooks/helius/route.ts:135-141`
- **No WebSocket reconnection logic**: All 5 frontend hooks using `onAccountChange` rely on the underlying `@solana/web3.js` Connection WS transport with zero reconnection or gap-fill logic. If the WS drops, events are silently lost until the next tab-visibility burst-refresh -- `app/hooks/usePoolPrices.ts:217`, `app/hooks/useEpochState.ts:140`, `app/hooks/useCurveState.ts:294`
- **Consistent "confirmed" commitment level across all data paths**: The singleton Connection (`app/lib/connection.ts:46`) uses `"confirmed"`, all WS subscriptions pass `"confirmed"`, and all `getMultipleAccountsInfo` calls use `"confirmed"`. No commitment mismatch found.
- **Quote-to-execute TOCTOU window**: `useSwap` computes quotes using client-side pool reserves from WebSocket state, then constructs/sends the TX against potentially-changed on-chain reserves. The on-chain `minimumOutput` slippage guard mitigates fund loss, but the user may get a worse-than-quoted deal -- `app/hooks/useSwap.ts:398-446, 673-791`
- **Helius webhook idempotency is robust**: `swap_events` PK on `tx_signature`, `epoch_events` unique index on `epoch_number`, `carnage_events` unique index on `epoch_number`, all with `onConflictDoNothing` -- `app/app/api/webhooks/helius/route.ts:337, 454, 507`
- **No reorg handling in webhook indexer**: Helius delivers at whatever commitment level the webhook is configured for. The webhook handler does not verify commitment level or handle rollbacks for non-finalized data -- `app/app/api/webhooks/helius/route.ts:160-268`
- **SSE broadcast is in-memory singleton (no persistence)**: If the Next.js process restarts, all SSE connections are lost and no event replay mechanism exists -- `app/lib/sse-manager.ts:29-93`
- **ATA existence check uses default "confirmed" commitment**: `getAccountInfo` calls in swap/staking builders inherit the Connection's "confirmed" commitment, which is appropriate -- `app/lib/swap/swap-builders.ts:229, 339, 463`
- **Transfer Hook accounts are fully deterministic (no RPC needed)**: PDA derivation in `hook-resolver.ts` and `hook-accounts.ts` uses `findProgramAddressSync` with no on-chain lookups, eliminating state-sync concerns for hook resolution -- `app/lib/swap/hook-resolver.ts:46-78`, `app/lib/curve/hook-accounts.ts:35-67`
- **Crank commitment level is configurable via env var, defaults to "confirmed"**: The crank-provider reads `process.env.COMMITMENT` with "confirmed" fallback. For mainnet, this should be "finalized" for financial operations -- `scripts/crank/crank-provider.ts:36-37`

## Critical Mechanisms
- **WebSocket State Subscriptions (4 hooks)**: `usePoolPrices` subscribes to 4 pool accounts, `useEpochState` subscribes to 1 EpochState PDA, `useCurveState` subscribes to 2 CurveState PDAs, `useCarnageData` subscribes to 1 CarnageSolVault. All use `"confirmed"` commitment. All implement visibility-aware subscribe/unsubscribe and burst-refresh on tab return. No reconnection logic beyond the burst-refresh fallback. -- `app/hooks/usePoolPrices.ts`, `app/hooks/useEpochState.ts`, `app/hooks/useCurveState.ts`, `app/hooks/useCarnageData.ts`
- **Helius Webhook -> DB -> SSE Pipeline**: Helius delivers raw TX batches via POST. The handler parses Anchor events (BorshCoder/EventParser), stores to Postgres with idempotency keys, upserts OHLCV candles, and broadcasts updates to SSE subscribers. Single-process architecture (no Redis pub/sub needed). -- `app/app/api/webhooks/helius/route.ts`, `app/lib/sse-manager.ts`
- **Polling-based Transaction Confirmation**: `pollTransactionConfirmation` polls `getSignatureStatuses` over HTTP every 2s with a 90s timeout. Considers only "confirmed" or "finalized" as success. Checks `getBlockHeight("confirmed")` against `lastValidBlockHeight` for expiry detection. This is more reliable than WS-based confirmation. -- `app/lib/confirm-transaction.ts`
- **Token Balance Polling**: `useTokenBalances` polls every 30s via `getParsedTokenAccountsByOwner` + `getBalance`. Uses cross-instance coordination via `CustomEvent` to sync balances across SwapForm and StakingForm. No WebSocket subscription for balances. -- `app/hooks/useTokenBalances.ts`

## Invariants & Assumptions
- INVARIANT: All frontend WebSocket subscriptions use "confirmed" commitment -- enforced at `app/hooks/usePoolPrices.ts:256`, `app/hooks/useEpochState.ts:178`, `app/hooks/useCurveState.ts:324,358`, `app/hooks/useCarnageData.ts:150`
- INVARIANT: Webhook event storage is idempotent (duplicate-safe) -- enforced at `app/db/schema.ts:33` (PK on tx_signature), `app/db/schema.ts:106` (unique on epoch_number), `app/db/schema.ts:133` (unique on epoch_number)
- INVARIANT: All on-chain state reads in swap builders inherit Connection default "confirmed" -- enforced at `app/lib/connection.ts:46` (singleton Connection with "confirmed")
- INVARIANT: Transfer Hook PDA derivation is deterministic and requires zero RPC calls -- enforced at `app/lib/swap/hook-resolver.ts:54-68` and `app/lib/curve/hook-accounts.ts:43-58`
- ASSUMPTION: Helius delivers webhooks at "confirmed" commitment level -- UNVALIDATED (depends on webhook configuration, not enforced in code)
- ASSUMPTION: WebSocket connections to Helius are stable enough that burst-refresh on tab return covers any gaps -- PARTIALLY VALIDATED (mitigated by burst-refresh, but no gap detection for background crank/bot scenarios)
- ASSUMPTION: The SSE broadcast pathway (webhook -> sseManager -> chart) always runs in the same Node.js process -- enforced at `app/lib/sse-manager.ts:84-92` (globalThis singleton), would break if horizontally scaled
- ASSUMPTION: `@solana/web3.js` Connection manages WS reconnection internally -- UNVALIDATED (web3.js v1 has basic reconnection but it is unreliable under load; no external monitoring)

## Risk Observations (Prioritized)
1. **Webhook auth bypass (optional secret)**: `app/app/api/webhooks/helius/route.ts:135-141` -- If `HELIUS_WEBHOOK_SECRET` is not set in production, anyone can POST fabricated swap/epoch/carnage events, poisoning the database and chart data. Medium severity (data integrity impact, mitigated by idempotency keys preventing duplicate real signatures, but fabricated signatures with fake prices would corrupt candle data).
2. **No WebSocket reconnection or gap-fill**: `app/hooks/usePoolPrices.ts:204-261`, `app/hooks/useEpochState.ts:136-183` -- If the WS connection drops (common on Helius under load), pool reserves and epoch state become stale until the user switches tabs and triggers burst-refresh. During this window, the swap quote engine operates on stale reserves, potentially quoting prices that differ significantly from the on-chain AMM state. Medium severity (mitigated by on-chain slippage check, but UX impact).
3. **Quote-to-execute staleness window**: `app/hooks/useSwap.ts:398-446 (quote), 673-791 (execute)` -- The user sees a quote computed from WebSocket-delivered reserves, but the TX is built and submitted moments later when on-chain state may have changed. On-chain `minimumOutput` slippage guard prevents fund loss, but does not prevent failed transactions or worse-than-expected prices. Low severity (defense in depth via on-chain check).
4. **Helius webhook commitment level not enforced in code**: `app/app/api/webhooks/helius/route.ts` -- The handler stores events without verifying the Helius-reported commitment level. If the webhook is configured for "processed" on Helius's side, rolled-back transactions could be indexed. Medium severity (depends on external configuration).
5. **SSE manager has no persistence or replay**: `app/lib/sse-manager.ts` -- Clients that disconnect and reconnect miss all events during the gap. The chart component must poll the `/api/candles` REST endpoint on reconnect to fill gaps. Low severity (chart data, not financial).

## Novel Attack Surface
- **Fabricated webhook injection**: An attacker who discovers the webhook URL (it is a predictable Next.js route at `/api/webhooks/helius`) can inject fabricated transaction events with fake prices if `HELIUS_WEBHOOK_SECRET` is unset. This would corrupt OHLCV candle data displayed to users, potentially influencing trading decisions. The idempotency key (tx_signature) provides partial protection -- if the attacker uses real-looking but non-existent signatures, those entries persist. If the attacker uses a real signature, `onConflictDoNothing` prevents overwrite.
- **Tab-hidden state drift exploitation**: When a user's tab is hidden, WS subscriptions are deliberately paused (visibility optimization). If the user returns after a large price movement and immediately executes a swap before burst-refresh completes, they may submit a TX with a stale quote. The on-chain `minimumOutput` check provides the safety net, but a user who manually overrides slippage to a high value (settings allow custom BPS) could be caught by this window.

## Cross-Focus Handoffs
- -> **API-04 (Webhook Security)**: The optional `HELIUS_WEBHOOK_SECRET` auth bypass needs deep investigation. Is the secret set in Railway production? Is the webhook URL publicly discoverable?
- -> **SEC-02 (Secrets Management)**: `HELIUS_WEBHOOK_SECRET` is loaded from `process.env` with no validation that it is actually set. This should be a hard failure in production mode.
- -> **BOT-01 (Crank/Keeper)**: The crank's commitment level (`COMMITMENT` env var defaulting to `"confirmed"`) should be verified for mainnet deployment. For financial operations like vault top-up and epoch transitions, `"finalized"` is safer.
- -> **ERR-01 (Error Handling)**: WebSocket disconnection in frontend hooks is handled silently (no user notification). If all 4 pool price subscriptions fail simultaneously, the user has no indication that prices are stale.
- -> **LOGIC-02 (Financial Math)**: Confirm that the 300ms quote debounce combined with WS-pushed reserves provides sufficiently fresh data for accurate quoting.

## Trust Boundaries
The off-chain system maintains a clear trust model: on-chain state is the source of truth, off-chain state is a convenience cache. Financial safety relies on on-chain enforcement (slippage checks, PDA ownership, Transfer Hook whitelist), not off-chain state freshness. The Helius webhook is the primary trust boundary for off-chain data integrity -- it receives raw transaction data and stores it in Postgres. The webhook endpoint is the most sensitive entry point because it can inject data that influences user-facing charts and statistics. The WebSocket subscriptions from Helius RPC are trusted for display-only purposes (pool reserves, epoch state, vault balances) but never used for authorization or financial decisions without on-chain verification. The SSE pipeline from webhook to chart is in-process (no network boundary) but lacks persistence, making it susceptible to process restarts.
<!-- CONDENSED_SUMMARY_END -->

---

# On-Chain/Off-Chain State Synchronization -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase demonstrates a well-architected state synchronization strategy: on-chain state is the authoritative source, off-chain state serves display and quoting purposes only, and all financial safety is enforced on-chain via slippage guards and PDA constraints. The system uses a dual-path approach: (1) WebSocket subscriptions for real-time display updates and (2) Helius webhooks for persistent event indexing.

The architecture has several strengths: consistent "confirmed" commitment level everywhere, robust idempotency in the webhook handler, deterministic Transfer Hook PDA derivation that eliminates state-sync concerns, and visibility-aware WS lifecycle management that reduces RPC costs.

However, there are notable gaps: no WebSocket reconnection logic in frontend hooks, optional webhook authentication that could allow data injection, no commitment-level enforcement in the webhook pipeline, and a single-process SSE architecture that would not survive horizontal scaling.

## Scope

**In scope:** All off-chain TypeScript code that reads, caches, or synchronizes on-chain Solana state. This includes:
- Frontend hooks that subscribe to on-chain accounts (`usePoolPrices`, `useEpochState`, `useCurveState`, `useCarnageData`, `useTokenBalances`)
- Transaction builders that read on-chain state for ATA existence checks (`swap-builders.ts`, `staking-builders.ts`, `curve-tx-builder.ts`)
- Transfer Hook PDA resolvers (`hook-resolver.ts`, `hook-accounts.ts`)
- Webhook event ingestion pipeline (`helius/route.ts`, `event-parser.ts`, `candle-aggregator.ts`)
- SSE broadcast system (`sse-manager.ts`, `sse/candles/route.ts`)
- Transaction confirmation (`confirm-transaction.ts`)
- Connection factory (`connection.ts`)
- Crank runner state reading (`crank-runner.ts`, `crank-provider.ts`)

**Out of scope:** Anchor/Rust on-chain programs in `programs/`.

## Key Mechanisms

### 1. RPC Connection Factory (Singleton)
**File:** `app/lib/connection.ts`

The singleton `Connection` instance uses:
- Default commitment: `"confirmed"`
- Explicit `wsEndpoint` derived from the HTTP URL (https -> wss replacement)
- Memoization by URL to prevent duplicate WS connections

This is the foundational piece -- every hook and builder in the frontend shares this Connection. The "confirmed" default is appropriate for display purposes (FP-018 -- "processed" would be the concern; "confirmed" is not flagged).

### 2. WebSocket State Subscriptions

Five hooks subscribe to on-chain account changes:

| Hook | Accounts | Commitment | Polling Fallback | Gap-Fill |
|------|----------|------------|-----------------|----------|
| `usePoolPrices` | 4 pool PDAs | confirmed | Batch fetch on mount + burst-refresh | No |
| `useEpochState` | 1 EpochState PDA | confirmed | Anchor fetch on mount + burst-refresh | No |
| `useCurveState` | 2 CurveState PDAs | confirmed | Anchor fetch on mount + burst-refresh | No |
| `useCarnageData` | 1 CarnageSolVault | confirmed | 30s polling + burst-refresh | No |
| `useTokenBalances` | (no WS, polling only) | default | 30s polling + cross-instance CustomEvent | N/A |

**Pattern:** All WS-based hooks follow the same structure:
1. Initial RPC fetch for immediate data
2. WebSocket `onAccountChange` subscription for real-time push
3. Visibility-aware lifecycle (pause when tab hidden, burst-refresh on return)
4. Proper cleanup on unmount (`removeAccountChangeListener`)

**Gap:** None of these hooks implement:
- WebSocket health monitoring (detecting dropped connections)
- Automatic reconnection after WS drop
- Gap detection (comparing last-processed slot to current slot)
- Event replay after reconnection

The burst-refresh-on-tab-return partially mitigates this for interactive users, but if a WS drops while the tab is visible, stale data persists until the next polling cycle or tab transition.

### 3. Transfer Hook PDA Resolution

**Files:** `app/lib/swap/hook-resolver.ts`, `app/lib/curve/hook-accounts.ts`

Both resolvers use `PublicKey.findProgramAddressSync` to derive all 4 hook accounts deterministically from seeds:
- `["extra-account-metas", mint]` -> ExtraAccountMetaList PDA
- `["whitelist", source]` -> Source whitelist entry
- `["whitelist", dest]` -> Destination whitelist entry
- Hook program ID as trailing account

This is a **secure pattern** (no RPC dependency, no state-sync concern). The PDAs are derived from constants (`PROGRAM_IDS.TRANSFER_HOOK`) and passed account pubkeys. No on-chain state is read.

Direction sensitivity is correctly handled:
- Buy: source=poolVault, dest=userATA
- Sell: source=userATA, dest=poolVault
- Stake: source=userATA, dest=StakeVault
- Unstake: source=StakeVault, dest=userATA (reversed)
- Purchase (curve): source=tokenVault, dest=userATA
- Sell (curve): source=userATA, dest=tokenVault

### 4. Transaction Builders and State Reads

**Files:** `app/lib/swap/swap-builders.ts`, `app/lib/staking/staking-builders.ts`, `app/lib/curve/curve-tx-builder.ts`

State reads in builders:
- `getAccountInfo(ata)` -- checks if user's ATA exists (to decide whether to add create-ATA instruction)
- These inherit the Connection's "confirmed" commitment -- appropriate for this purpose

No financial decisions are made from these reads. If the ATA check is wrong (race condition where ATA is created between check and TX submission), the TX will either:
- Include a redundant create-ATA instruction (which fails gracefully because ATA already exists and `createAssociatedTokenAccountInstruction` is idempotent)
- Miss the create-ATA instruction (which causes the program to fail with AccountNotInitialized, requiring the user to retry)

Neither case results in fund loss.

### 5. Helius Webhook Event Pipeline

**File:** `app/app/api/webhooks/helius/route.ts`

Data flow: Helius -> POST /api/webhooks/helius -> parse Anchor events -> store in Postgres -> upsert candles -> broadcast SSE

**Idempotency:**
- `swap_events`: Primary key on `tx_signature` with `onConflictDoNothing` (line 337)
- `epoch_events`: Unique index on `epoch_number` with `onConflictDoNothing` (line 454)
- `carnage_events`: Unique index on `epoch_number` with `onConflictDoNothing` (line 507)
- `candles`: Composite unique index on `(pool, resolution, open_time)` with upsert logic

This is a robust anti-double-processing pattern (OC-123 mitigated).

**Authentication:**
```typescript
const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
if (webhookSecret) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```
If `HELIUS_WEBHOOK_SECRET` is unset, auth is skipped entirely. This is explicitly documented as "allows local testing" but is a risk in production.

**Commitment level:** The handler does not check or validate the commitment level of the transactions delivered by Helius. If the Helius webhook is configured for "processed" commitment, rolled-back transactions would be indexed. This is an external configuration dependency.

**Error handling:** Per-transaction errors are caught and logged but do not fail the batch. This is correct -- Helius expects a 200 response to acknowledge delivery.

### 6. Transaction Confirmation

**File:** `app/lib/confirm-transaction.ts`

Uses HTTP polling (`getSignatureStatuses`) instead of WebSocket-based `confirmTransaction`. This is explicitly noted as more reliable than WS-based confirmation. The implementation:
- Polls every 2 seconds
- 90-second safety timeout
- Only considers "confirmed" or "finalized" as success
- Checks block height for blockhash expiry
- Returns `{ err }` for the caller to check

This avoids OC-125 (WebSocket reconnection event loss) and AIP-061 (no error handling on confirmation) by using HTTP polling.

### 7. SSE Broadcast

**Files:** `app/lib/sse-manager.ts`, `app/app/api/sse/candles/route.ts`

The SSE system is an in-memory singleton (no persistence):
- Subscribers stored in `Set<SSECallback>`
- `globalThis` pattern survives Next.js HMR in dev
- 15-second heartbeat prevents proxy timeouts
- Proper cleanup on client disconnect via `req.signal.addEventListener("abort")`

Limitations:
- No event replay on reconnect (clients must poll REST API to fill gaps)
- Single-process only (no Redis pub/sub for horizontal scaling)
- No backpressure or subscriber limit

## Trust Model

| Source | Trust Level | Used For |
|--------|------------|----------|
| On-chain program state | Authoritative | Financial safety (slippage, whitelist) |
| Helius RPC (WebSocket) | High | Display-only pool reserves, epoch state |
| Helius RPC (HTTP) | High | ATA existence checks, balance queries |
| Helius webhook POST | Medium | Event indexing, candle aggregation |
| Client-side quote engine | Convenience | Price estimates (not enforced) |
| SSE broadcast | Low | Chart updates (cosmetic) |

The key insight is that **no off-chain state read is used for financial authorization**. All financial safety is enforced on-chain:
- `minimumOutput` enforces slippage protection
- Transfer Hook whitelist enforces authorized transfers
- PDA ownership enforces account authority
- Epoch state is read on-chain by the Tax Program for tax rate enforcement

Off-chain reads are used only for:
1. Display (pool prices, epoch state, curve progress, balances)
2. Quote estimation (client-side AMM math for UX)
3. ATA existence checks (create if needed -- idempotent)
4. Event indexing (historical data for charts and statistics)

## State Analysis

### Frontend State Cache (React `useState`)
- Pool reserves: Updated via WS or burst-refresh. Can be stale for seconds to minutes.
- Epoch state: Updated via WS or burst-refresh. Changes only on epoch transitions (~every 5 minutes).
- Curve state: Updated via WS or burst-refresh. Changes on every bonding curve buy/sell.
- Token balances: Polled every 30s. Cross-instance sync via CustomEvent.
- Carnage data: Polled every 30s (fund state) + WS (vault balance).

### Backend State (Postgres)
- `swap_events`: Append-only, idempotent on tx_signature
- `epoch_events`: Append-only, idempotent on epoch_number
- `carnage_events`: Append-only, idempotent on epoch_number
- `candles`: Upserted on (pool, resolution, open_time)

### Crank State
- Reads epoch state from on-chain via Anchor fetch
- Reads vault balance for top-up decision
- Commitment level: configurable via `COMMITMENT` env var, defaults to "confirmed"

## Dependencies

### Helius RPC
- HTTP: Account info, balances, signature statuses, blockhash
- WebSocket: Account change subscriptions
- Webhook: Raw transaction delivery for event indexing
- Single provider -- no RPC failover configured (see OC-115)

### @solana/web3.js (v1)
- Connection class manages WebSocket lifecycle
- Basic auto-reconnection exists but is unreliable under load
- No event gap-fill or replay capability

### Anchor Framework
- BorshCoder/EventParser for webhook event decoding
- Account fetching via `program.account.*.fetch()`
- Account decoding via `program.coder.accounts.decode()`

## Focus-Specific Analysis

### Commitment Level Consistency (OC-126)
All data paths use "confirmed" commitment consistently:
- `app/lib/connection.ts:46` -- singleton Connection default
- `app/hooks/usePoolPrices.ts:120,256` -- batch fetch + WS
- `app/hooks/useEpochState.ts:178` -- WS subscription
- `app/hooks/useCurveState.ts:324,358` -- WS subscriptions
- `app/hooks/useCarnageData.ts:150` -- WS subscription
- `app/lib/confirm-transaction.ts:53` -- block height check
- `scripts/crank/crank-provider.ts:37` -- configurable, defaults "confirmed"

No commitment mismatch found between read and act. This is a secure pattern (SP-015).

**One caveat:** The Helius webhook's commitment level is an external configuration that is not enforced in code. If misconfigured to "processed", the indexer could store rolled-back events.

### WebSocket Reconnection (OC-125)
No custom reconnection logic exists in any hook. All hooks rely on:
1. `@solana/web3.js` Connection's internal WS management (basic, unreliable)
2. Visibility-aware unsubscribe/resubscribe (covers tab-hidden scenarios)
3. Burst-refresh on tab return (covers post-gap data staleness)

Missing: health monitoring, explicit reconnection, gap detection, slot tracking.

### Double-Processing Prevention (OC-123)
Robustly handled via database idempotency keys:
- TX signature as PK for swap events
- Unique indexes on epoch_number for epoch/carnage events
- `onConflictDoNothing` on all inserts

### Reorg Handling (OC-124)
Not implemented. The webhook handler stores events without checking finality. If a shallow reorg (1-2 slots) occurs and Helius delivers conflicting data, the idempotency key prevents duplicate inserts but does not roll back the orphaned event.

For this project's use case (display charts, not financial ledger), this is acceptable -- chart data from a 1-slot reorg would show a brief phantom price point that would be overwritten by subsequent real trades. However, if the system ever evolved to use indexed data for financial decisions, reorg handling would become critical.

### State Desync (OC-122)
The architecture explicitly avoids state desync as a security concern by:
1. Never using off-chain state for authorization
2. Enforcing all financial invariants on-chain
3. Treating off-chain state as a convenience cache

The only risk is UX degradation: users seeing stale prices and getting worse-than-expected trades (mitigated by on-chain slippage check).

## Cross-Focus Intersections

### CHAIN-04 x API-04 (Webhook Security)
The optional webhook authentication is the most significant cross-cutting concern. If the webhook endpoint is exposed without authentication, an attacker could inject fabricated swap events with manipulated prices, corrupting OHLCV candle data that users rely on for trading decisions.

### CHAIN-04 x CHAIN-06 (PDA Derivation)
Transfer Hook PDA resolution is fully deterministic (no RPC). The seeds used in `hook-resolver.ts` and `hook-accounts.ts` must match the on-chain `initialize_extra_account_meta_list` instruction. If seeds drift, Transfer Hook calls would fail (hard failure, not a silent state desync).

### CHAIN-04 x BOT-01 (Crank)
The crank runner reads epoch state and vault balance to make operational decisions (when to advance epochs, when to top up vault). These reads use the Connection's commitment level (configurable, defaults "confirmed"). For mainnet, "finalized" would be safer for the vault balance check (to avoid topping up based on a rolled-back deposit).

### CHAIN-04 x ERR-01 (Error Handling)
WebSocket subscription failures in frontend hooks produce error states (string messages in React state) but no user notification mechanism exists for "stale data" conditions. If all WS subscriptions fail simultaneously, the UI shows the last-known state with no staleness indicator.

### CHAIN-04 x LOGIC-01 (Financial Math)
The quote engine (`useSwap` -> `computeQuote`) reads pool reserves from WS-delivered state. If WS is lagging, the quote may diverge significantly from on-chain reality. The 300ms debounce adds further latency. On-chain slippage check is the safety net.

## Cross-Reference Handoffs

| Target Auditor | Item | Priority |
|---------------|------|----------|
| API-04 | Verify `HELIUS_WEBHOOK_SECRET` is set in Railway production environment | High |
| SEC-02 | Assess whether webhook URL `/api/webhooks/helius` is publicly discoverable | High |
| BOT-01 | Verify crank COMMITMENT env var is set to "finalized" for mainnet | Medium |
| ERR-01 | Assess impact of silent WS disconnection on user experience | Medium |
| LOGIC-02 | Validate quote freshness given WS latency + 300ms debounce | Low |
| INFRA-03 | Confirm single-process deployment assumption (SSE manager breaks with scaling) | Low |

## Risk Observations

### R1: Optional Webhook Authentication (Medium)
**File:** `app/app/api/webhooks/helius/route.ts:135-141`
**Impact:** Data integrity -- fabricated events corrupt chart data
**Likelihood:** Possible (webhook URL is predictable)
**Mitigation:** Set `HELIUS_WEBHOOK_SECRET` in production; consider making it a hard requirement

### R2: No WebSocket Reconnection (Medium)
**Files:** All 4 WS-subscribing hooks
**Impact:** Stale display data -> misleading quotes -> user surprise
**Likelihood:** Probable (Helius WS drops are common under load)
**Mitigation:** Burst-refresh on tab return partially covers; consider adding slot-based staleness detection

### R3: Helius Webhook Commitment Level (Medium)
**File:** `app/app/api/webhooks/helius/route.ts`
**Impact:** Rolled-back transactions indexed as permanent
**Likelihood:** Unlikely (Helius defaults to "confirmed" for enhanced/raw webhooks)
**Mitigation:** Verify Helius webhook configuration; optionally re-fetch TX at "finalized" before indexing

### R4: Quote-to-Execute Staleness (Low)
**File:** `app/hooks/useSwap.ts:398-791`
**Impact:** Worse-than-expected trade (but not fund loss)
**Likelihood:** Possible (during high-volatility periods)
**Mitigation:** On-chain `minimumOutput` slippage guard prevents catastrophic outcomes

### R5: SSE Manager Single-Process (Low)
**File:** `app/lib/sse-manager.ts`
**Impact:** SSE breaks if horizontally scaled (Railway single-process for now)
**Likelihood:** Unlikely (currently single-process by design)
**Mitigation:** Documented limitation; add Redis pub/sub when scaling

### R6: Crank Commitment Level for Mainnet (Medium)
**File:** `scripts/crank/crank-provider.ts:36-37`
**Impact:** Crank could act on rolled-back state for vault top-up
**Likelihood:** Possible (if COMMITMENT env var is not explicitly set to "finalized")
**Mitigation:** Set COMMITMENT=finalized in mainnet deployment

## Novel Attack Surface Observations

### Webhook URL Discovery + Data Injection
The webhook endpoint at `/api/webhooks/helius` follows a predictable Next.js App Router convention. An attacker who discovers this URL (e.g., from public GitHub if the route file is committed, or by probing common webhook paths) could inject fabricated events if `HELIUS_WEBHOOK_SECRET` is not set. The fabricated data would corrupt OHLCV candle charts, potentially:
- Creating fake price spikes to lure buyers
- Creating fake price drops to trigger panic selling
- Injecting fake Carnage events to misrepresent protocol activity

The `onConflictDoNothing` on tx_signature provides partial protection -- the attacker must use unique (likely non-existent) signatures. But since the handler does not verify signatures against Solana RPC, any 88-character base58 string is accepted as a valid signature.

### Visibility-Optimized State Drift
The visibility-aware WS lifecycle creates an interesting attack surface: when a user's tab is hidden, WS subscriptions are deliberately paused to save RPC credits. If an attacker front-runs a large trade during this window, the user returns to see stale prices and might execute a trade at a disadvantageous price. The burst-refresh on tab return mitigates this, but there is a brief window (time for RPC fetch to complete) where the old state is displayed.

## Questions for Other Focus Areas

1. **API-04:** Is `HELIUS_WEBHOOK_SECRET` set in the Railway production environment? What is the actual Helius webhook configuration (commitment level, retry policy)?
2. **SEC-02:** Is the `/api/webhooks/helius` route discoverable from the public codebase or network probing?
3. **BOT-01:** What is the crank's `COMMITMENT` env var set to on Railway? Is there a plan to change it for mainnet?
4. **FE-01:** Is there any user-facing indicator when WebSocket subscriptions are disconnected or data is stale?
5. **INFRA-03:** Is there any plan for horizontal scaling that would break the in-memory SSE singleton?

## Raw Notes

- `usePoolPrices` uses `getMultipleAccountsInfo` for batched initial fetch (1 RPC credit instead of 4) -- good optimization
- `useTokenBalances` uses `getParsedTokenAccountsByOwner` with `TOKEN_2022_PROGRAM_ID` -- correctly scoped to Token-2022
- `useCarnageData` combines polling (30s for CarnageFundState) with WS (real-time for vault balance) -- hybrid approach appropriate for different update frequencies
- `pollTransactionConfirmation` explicitly chooses HTTP polling over WS-based confirmation (documented rationale: reliability)
- `confirm-transaction.ts` has a hardcoded 90s timeout -- sufficient for Solana (blockhash expires after ~60s)
- Event parser uses BorshCoder from Anchor -- trusted deserialization (no raw buffer parsing)
- The `toNum` helper used in multiple hooks converts BN to number safely for display values
- `useCurveState` has a DEMO_MODE path that returns mock data -- should be disabled in production
- Candle SSE broadcast sends to ALL resolutions (6) for every swap -- could be optimized but not a security concern
- The `derivePrice` function in the webhook handler correctly excludes tax from price calculation to avoid fake price jumps on epoch transitions
