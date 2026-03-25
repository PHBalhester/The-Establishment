---
task_id: db-phase1-chain-04
provides: [chain-04-findings, chain-04-invariants]
focus_area: chain-04
files_analyzed:
  - app/lib/ws-subscriber.ts
  - app/lib/protocol-store.ts
  - app/lib/protocol-config.ts
  - app/lib/connection.ts
  - app/lib/bigint-json.ts
  - app/lib/confirm-transaction.ts
  - app/lib/sse-manager.ts
  - app/lib/swap/swap-builders.ts
  - app/lib/swap/hook-resolver.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/staking/staking-builders.ts
  - app/hooks/useSwap.ts
  - app/hooks/useStaking.ts
  - app/hooks/useProtocolState.ts
  - app/hooks/useEpochState.ts
  - app/hooks/usePoolPrices.ts
  - app/hooks/useCurveState.ts
  - app/hooks/useCarnageData.ts
  - app/hooks/useCurrentSlot.ts
  - app/hooks/useTokenBalances.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/sse/protocol/route.ts
  - app/instrumentation.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# CHAIN-04: On-Chain/Off-Chain State Synchronization -- Condensed Summary

## Key Findings (Top 10)

1. **CarnageSolVault uses `nativeBalanceChange` instead of absolute lamports**: Webhook handler stores a *delta* value (nativeBalanceChange) as if it were the current balance. After an initial batch-seed sets the correct absolute lamports, each webhook update overwrites it with a relative change value, desynchronizing the displayed Carnage vault balance. -- `app/app/api/webhooks/helius/route.ts:554`

2. **Quote-to-execution TOCTOU gap on pool reserves**: Quote computation reads pool reserves from SSE state (which can be seconds stale), then uses those reserves to compute `minimumOutput`. Between quote and on-chain execution, reserves can change materially -- the slippage parameter is the only safety net, and it protects against the *displayed* quote, not the *actual* on-chain state. -- `app/hooks/useSwap.ts:390-460`

3. **BN.toNumber() used for staked balance summation without overflow check**: `ws-subscriber.ts` uses `decoded.stakedBalance.toNumber()` and plain `number` addition for PROFIT stake totals. PROFIT has 20M supply * 10^6 = 2e13 base units -- within Number.MAX_SAFE_INTEGER (9e15) today, but protocol growth or token supply changes could push this near the boundary. The `+= balance` accumulation is also lossy for large sums. -- `app/lib/ws-subscriber.ts:219,401`

4. **No commitment level specified for batch-seed getMultipleAccountsInfo**: `batchSeed()` calls `connection.getMultipleAccountsInfo(pubkeys)` without explicit commitment. The connection defaults to `"confirmed"` (set in connection.ts:69), which is acceptable, but the intent is not documented. If the connection default ever changes, seed data could use `"processed"` commitment. -- `app/lib/ws-subscriber.ts:115`

5. **Multi-hop v0 TX uses `skipPreflight: true` permanently**: The comment says this is for devnet, but the code has no conditional -- it will also skip preflight on mainnet. Without preflight simulation, broken transactions are broadcast to validators (wasting priority fees and delaying user feedback). -- `app/lib/swap/multi-hop-builder.ts:381`

6. **SSE initial-state snapshot has no freshness indicator**: New SSE clients receive the full protocol store dump, but there is no timestamp or slot number in the envelope. A client connecting after prolonged server inactivity receives arbitrarily stale data with no way to detect it. -- `app/app/api/sse/protocol/route.ts:71-76`

7. **Polling fallback does not decode account data**: `useProtocolState.pollViaRpc()` calls `getMultipleAccountsInfo` but stores raw metadata (`lamports`, `dataLength`, `owner`) instead of Anchor-decoded fields. This means the polling fallback produces structurally different data from the SSE path, causing downstream hooks to receive null or incorrect state. -- `app/hooks/useProtocolState.ts:196-212`

8. **WebSocket reconnection loses intermediate slot updates**: When the WS connection goes stale and the fallback HTTP poll activates, any slot updates between the last WS delivery and the first HTTP poll are silently lost. The staleness monitor checks at 10s intervals with a 15s threshold, meaning up to 25s of slot data can be missed. -- `app/lib/ws-subscriber.ts:299-323`

9. **Client-side slot estimation can diverge significantly**: `useCurrentSlot` estimates slots by linear extrapolation from the last SSE value. Solana's actual slot rate varies (skipped slots, leader schedule). Over 5s estimation intervals, the displayed slot can be wrong by 10+ slots during congestion. -- `app/hooks/useCurrentSlot.ts:53-61`

10. **Token balance polling uses no dedup or staleness detection**: `useTokenBalances` polls every 30s with `getBalance` and `getParsedTokenAccountsByOwner` using default commitment. There is no mechanism to detect or handle RPC responses that return older state than what the client already has (e.g., after RPC failover to a behind node). -- `app/hooks/useTokenBalances.ts:72-112`

## Critical Mechanisms

- **DBS Data Pipeline (Server)**: `instrumentation.ts` -> `ws-subscriber.init()` -> `batchSeed()` seeds protocol store, then `onSlotChange` WS + HTTP polling intervals maintain it. Helius Enhanced Webhooks deliver account changes that get Anchor-decoded and stored in `protocolStore`. -- `app/instrumentation.ts:9-29`, `app/lib/ws-subscriber.ts:450-476`

- **DBS Data Pipeline (Client)**: `useProtocolState` opens an `EventSource` to `/api/sse/protocol`. The SSE route sends an `initial-state` snapshot then forwards `protocol-update` events from `sseManager`. Client hooks (useEpochState, usePoolPrices, useCurveState, useCarnageData, useCurrentSlot) extract typed data from the raw SSE map. -- `app/hooks/useProtocolState.ts:152-365`, `app/app/api/sse/protocol/route.ts:41-136`

- **Quote -> TX Execution Flow**: useSwap reads pool reserves from `usePoolPrices` (SSE-delivered), computes quotes using `quoteSolBuy`/`quoteSolSell` with those reserves + `epochState` tax rates, derives `minimumOutput` with user's slippage BPS, then builds TX via `swap-builders.ts` passing that `minimumOutput` to the on-chain program. On-chain program enforces `minimumOutput` independently. -- `app/hooks/useSwap.ts:329-538`, `app/lib/swap/swap-builders.ts:195-289`

- **Transaction Confirmation**: Polling-based via `pollTransactionConfirmation` -- checks `getSignatureStatuses` every 2s, accepts `"confirmed"` or `"finalized"`, checks block height expiry. Max 90s timeout. Direct swaps use `skipPreflight: false`; multi-hop v0 uses `skipPreflight: true`. -- `app/lib/confirm-transaction.ts:29-67`

- **BigInt Serialization Roundtrip**: Anchor decode -> `anchorToJson()` converts BN to number or `{__bigint: "..."}` tag -> `JSON.stringify(data, bigintReplacer)` -> SSE transport -> `JSON.parse(event.data, bigintReviver)` -> BigInt. Fields that need BigInt preservation must be listed in `CURVE_BIGINT_FIELDS` or `STAKING_BIGINT_FIELDS`. Unlisted BN fields use `.toNumber()` which silently truncates if >2^53. -- `app/lib/bigint-json.ts:1-117`

## Invariants & Assumptions

- INVARIANT: On-chain `minimumOutput` enforcement prevents fund loss from stale quotes -- enforced at on-chain Tax Program swap instructions / NOT directly verifiable from off-chain code, but off-chain always passes minimumOutput derived from quote + slippage
- INVARIANT: Connection commitment level is `"confirmed"` for all RPC calls -- enforced at `app/lib/connection.ts:69` / Implicitly inherited by all consumers via `getConnection()`
- INVARIANT: Protocol store dedup prevents redundant SSE broadcasts -- enforced at `app/lib/protocol-store.ts:57-59` via serialized string comparison
- INVARIANT: SSE connection cap prevents amplification DoS -- enforced at `app/app/api/sse/protocol/route.ts:44` via `acquireConnection()`
- INVARIANT: Webhook auth is fail-closed in production -- enforced at `app/app/api/webhooks/helius/route.ts:273-284`
- ASSUMPTION: PROFIT supply * 10^6 remains within Number.MAX_SAFE_INTEGER for staker balance summation -- UNVALIDATED (currently safe at 2e13, limit is 9e15)
- ASSUMPTION: `nativeBalanceChange` in Helius Enhanced Webhook represents the absolute balance -- LIKELY INCORRECT (field name suggests delta)
- ASSUMPTION: SSE initial-state snapshot is reasonably fresh -- UNVALIDATED (no staleness check at client connection time)
- ASSUMPTION: Helius Enhanced Webhook delivers all account changes reliably -- UNVALIDATED (no gap detection or reconciliation mechanism)
- ASSUMPTION: `anchorToJson` correctly identifies all BN fields via duck-typing (`"toNumber" in val`) -- enforced at `app/lib/bigint-json.ts:103` / Could break if non-BN objects have a toNumber method

## Risk Observations (Prioritized)

1. **CarnageSolVault balance desync (HIGH)**: `app/app/api/webhooks/helius/route.ts:554` -- `nativeBalanceChange` is likely a delta, not an absolute balance. This means after the first webhook update, the displayed Carnage vault balance is wrong. Impact: users see incorrect Carnage fund size. Potential for misinformed trading decisions.

2. **Polling fallback produces incompatible data (HIGH)**: `app/hooks/useProtocolState.ts:196-212` -- When SSE is down for >30s, the polling fallback stores raw account metadata instead of Anchor-decoded fields. All downstream hooks (useEpochState, usePoolPrices, etc.) that check for specific field types (e.g., `typeof data.reserveA === "number"`) will get null/zero state. Impact: UI shows stale or empty data during SSE outage instead of degraded-but-functional data.

3. **skipPreflight on mainnet for multi-hop (HIGH)**: `app/lib/swap/multi-hop-builder.ts:381` -- The `skipPreflight: true` flag is unconditional. On mainnet, this means broken multi-hop transactions will be broadcast without simulation, consuming priority fees and providing no pre-flight error feedback. The code comments indicate this is a devnet workaround.

4. **Quote staleness window (MEDIUM)**: `app/hooks/useSwap.ts:390-460` -- Quotes use SSE-delivered pool reserves which can be 5-60s stale (5s SSE throttle + up to 60s polling fallback). Combined with 300ms debounce, the effective staleness at execution time can exceed the user's intended slippage protection. On-chain minimumOutput is the backstop.

5. **No SSE gap detection or reconciliation (MEDIUM)**: `app/hooks/useProtocolState.ts` / `app/lib/ws-subscriber.ts` -- Neither the server-side WS subscriber nor the client-side SSE consumer has a mechanism to detect missed updates. If a Helius webhook delivery fails or SSE drops events, the protocol store remains stale indefinitely until the next webhook or poll cycle.

6. **BN.toNumber() accumulation for staking stats (MEDIUM)**: `app/lib/ws-subscriber.ts:219,401` -- Using `Number` for summing staked balances across all users. While currently safe, this has no explicit bounds check. A coding error elsewhere (e.g., wrong token decimal) could silently corrupt staking stats display.

7. **SSE snapshot freshness unknown to client (MEDIUM)**: `app/app/api/sse/protocol/route.ts:71-76` -- New SSE connections receive protocol store state without any staleness indicator. If the server hasn't received a webhook in hours, clients get stale data without knowing.

8. **Slot estimation drift (MEDIUM)**: `app/hooks/useCurrentSlot.ts:53-61` -- Linear extrapolation from SSE slot values. During network congestion or leader skips, displayed slot diverges from reality. Used for epoch countdown UI -- not for financial decisions.

9. **WebSocket stale-to-fallback gap (LOW)**: `app/lib/ws-subscriber.ts:299-323` -- Up to 25s of slot data can be lost in the transition from WS to HTTP fallback. Slot data is display-only, so financial impact is zero.

10. **Token balance polling has no staleness detection (LOW)**: `app/hooks/useTokenBalances.ts:72-112` -- RPC responses from behind-nodes could show older balances. No monotonic check.

## Novel Attack Surface

- **Helius webhook field semantics mismatch**: The CarnageSolVault handling uses `nativeBalanceChange` as an absolute balance. If this field is indeed a delta (as the name suggests), an attacker who triggers many small deposits/withdrawals to the vault could cause the displayed balance to diverge wildly from reality, potentially manipulating user behavior around Carnage events. This is a **semantic desync** -- the off-chain code's model of the data doesn't match the data source's model.

- **SSE replay as state corruption vector**: The protocol store uses last-write-wins with string dedup. If an attacker could replay an old webhook payload (mitigated by H001 auth + H049 replay protection on raw TXs), the enhanced account changes path has no age/slot check. Old account state could overwrite newer state in the protocol store.

## Cross-Focus Handoffs

- **-> CHAIN-01 (RPC Trust)**: The `getMultipleAccountsInfo` calls in batchSeed and the polling fallback rely on RPC response integrity. Investigate whether a compromised or stale RPC could inject false protocol state into the entire data pipeline.

- **-> CHAIN-02 (Account State Decoding)**: The Anchor decode path in webhook handler and ws-subscriber uses raw buffer data from Helius. Investigate whether malformed rawAccountData could cause decode failures that leave protocol store entries in an inconsistent state.

- **-> CHAIN-05 (MEV/Submission)**: The skipPreflight:true on multi-hop and the TOCTOU gap between quote and execution are MEV-relevant. Investigate whether the slippage parameters provide adequate sandwich protection given the observed staleness windows.

- **-> ERR-01 (Error Handling)**: The instrumentation.ts try/catch catches ws-subscriber failures but the server continues with an empty protocol store. Investigate cascading effects of empty protocol store on all downstream consumers.

- **-> LOGIC-01 (Business Logic)**: The quote computation in useSwap uses SSE-delivered tax rates. If EpochState delivery is delayed (stale epoch), the user could execute with wrong tax expectations. On-chain enforces actual rates, so the discrepancy is in UX, not security.

## Trust Boundaries

The state synchronization pipeline has three trust boundaries. (1) **Helius -> Server**: Webhook payloads are authenticated (fail-closed HMAC in production), but enhanced account change data is trusted without slot-level freshness validation. The rawAccountData is decoded by Anchor, which validates discriminators, but field values are accepted as-is. (2) **Server -> Client**: SSE transport is unauthenticated (any browser can connect), but data flows are read-only (no writes from client). The protocol store is the single source of truth. Rate limiting and connection caps prevent abuse. (3) **Client -> On-Chain**: Quote data from SSE state drives the `minimumOutput` parameter in transactions. On-chain programs enforce this parameter independently, so stale quotes result in worse UX (higher slippage or failed TXs) but not fund loss. The critical safety net is that `minimumOutput` is enforced on-chain regardless of off-chain state.
<!-- CONDENSED_SUMMARY_END -->

---

# CHAIN-04: On-Chain/Off-Chain State Synchronization -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements a sophisticated state synchronization pipeline connecting on-chain Solana program state to the browser UI through three layers: Helius webhooks/RPC, an in-memory protocol store, and SSE streaming. The architecture is well-designed for its single-process Railway deployment, with proper deduplication, staleness monitoring, and fallback mechanisms.

The most significant finding is a likely semantic mismatch in the CarnageSolVault balance handling where `nativeBalanceChange` (a delta) is stored as an absolute balance. The polling fallback producing incompatible data structures is the second most impactful issue, as it means SSE outages result in complete UI data loss rather than degraded-but-functional display. The unconditional `skipPreflight: true` on multi-hop transactions is a devnet artifact that needs conditional logic before mainnet.

No critical severity findings were identified. All financial operations are backstopped by on-chain enforcement of `minimumOutput`, making stale off-chain state a UX concern rather than a fund-loss vector.

## Scope

**In-scope files analyzed (23):**
All off-chain code involved in reading on-chain state, caching it, transporting it to clients, and using it in transaction construction. Specifically: the DBS infrastructure (ws-subscriber, protocol-store, sse-manager, SSE routes), all React hooks that consume protocol state, all transaction builders that use cached state, and the Helius webhook handler that ingests state updates.

**Out of scope:** Anchor programs in `programs/` directory. On-chain enforcement of minimumOutput and other parameters is noted but not analyzed.

## Key Mechanisms

### 1. Server-Side Data Pipeline (DBS)

**Entry point**: `instrumentation.ts` calls `ws-subscriber.init()` during Next.js server boot.

**Batch seed** (`ws-subscriber.ts:113-244`):
- Calls `getMultipleAccountsInfo()` for 8 protocol PDAs (EpochState, CarnageFund, CarnageSolVault, 2 pools, 2 curves, StakePool)
- Anchor-decodes each using the appropriate program coder
- Normalizes BN/PublicKey values via `anchorToJson()`
- Stores in `protocolStore` using `setAccountStateQuiet()` (no broadcast -- pre-connection)
- Also fetches token supply (2 getTokenSupply calls), current slot, and staker stats via gPA

**Ongoing subscriptions:**
- `onSlotChange` WebSocket subscription (throttled to broadcast every 5s via SLOT_BROADCAST_INTERVAL_MS)
- Token supply HTTP poll (60s default, configurable)
- Staker count gPA poll (30s default, configurable)
- Staleness monitor (10s check interval, 15s threshold, activates HTTP slot fallback)

**Helius Enhanced Webhook** (`webhooks/helius/route.ts:525-633`):
- Identifies accounts by pubkey -> label mapping
- Anchor-decodes rawAccountData from base64
- Stores decoded state in protocolStore via `setAccountState()` (with broadcast)
- CarnageSolVault (SystemAccount) uses nativeBalanceChange from accountData

### 2. Protocol Store (In-Memory Cache)

**Location**: `app/lib/protocol-store.ts`

Single `Map<string, AccountState>` with string-based dedup for broadcasts. Two write methods:
- `setAccountState()`: updates map + broadcasts via SSE if data changed
- `setAccountStateQuiet()`: updates map + dedup baseline without broadcast

**Dedup mechanism**: `JSON.stringify(data, bigintReplacer)` compared against `lastSerialized` map. Prevents redundant SSE events when data hasn't changed.

**Singleton pattern**: globalThis assignment (unconditional, per Turbopack requirement from MEMORY.md).

### 3. SSE Transport

**Server route**: `app/api/sse/protocol/route.ts`
- Connection cap via `acquireConnection()` (per-IP + global limits from sse-connections.ts)
- Initial state snapshot sent as `initial-state` event
- Subscribes to sseManager for `protocol-update` events
- 15s heartbeat to prevent proxy timeout
- Auto-release after 30 minutes

**Client consumer**: `app/hooks/useProtocolState.ts`
- EventSource with exponential backoff reconnection (1s -> 30s)
- Visibility-aware (pauses SSE when tab hidden)
- Polling fallback after 30s SSE downtime (60s interval)
- 10s periodic check for SSE downtime threshold

### 4. Quote Computation and Transaction Building

**Quote path**: useSwap reads from usePoolPrices (SSE data) and useEpochState (SSE data), computes quotes using BigInt math in quote-engine, derives minimumOutput with user's slippage BPS.

**TX build path**: swap-builders.ts constructs transactions with:
- Compute budget instructions
- WSOL wrap/unwrap (for SOL pools)
- ATA creation (idempotent checks)
- Transfer Hook remaining_accounts (deterministic PDA derivation)
- minimumOutput passed as BN argument to on-chain program

**Confirmation**: HTTP polling via `pollTransactionConfirmation()` (2s interval, 90s max, checks `confirmed`/`finalized`).

### 5. BigInt Serialization

**Server side**: `anchorToJson()` converts BN fields to either `.toNumber()` (default) or `{__bigint: "..."}` tag (for fields listed in CURVE_BIGINT_FIELDS or STAKING_BIGINT_FIELDS).

**Transport**: `JSON.stringify(data, bigintReplacer)` encodes native BigInt as `{__bigint: "..."}`.

**Client side**: `JSON.parse(event.data, bigintReviver)` reconstitutes `{__bigint: "..."}` back to native BigInt.

**Risk**: Fields not in bigintFields lists use `.toNumber()` which silently truncates values >2^53. Currently, only CURVE_BIGINT_FIELDS and STAKING_BIGINT_FIELDS are tagged. If other programs produce large u64/u128 values in fields not listed, they will be silently corrupted.

## Trust Model

### Data Source Trust

| Source | Trust Level | Validation |
|--------|-------------|------------|
| Helius WebSocket (onSlotChange) | High | No validation needed (slot numbers are simple integers) |
| Helius HTTP (getMultipleAccountsInfo) | High | Anchor discriminator check during decode |
| Helius Enhanced Webhook | High (authenticated) | HMAC auth + Anchor decode validates structure |
| Helius Raw Webhook | High (authenticated) | HMAC auth + event parser validates log format |
| Solana RPC (polling fallback) | High | Direct connection, "confirmed" commitment |

### Data Consumer Trust

| Consumer | Trust Requirement | Safety Net |
|----------|-------------------|------------|
| useSwap quote computation | Pool reserves + tax rates must be reasonably fresh | On-chain minimumOutput enforcement |
| useStaking reward display | StakePool.rewardsPerTokenStored must be current | Display-only, claim uses on-chain value |
| useCurveState (bonding curve UI) | Curve status, tokensSold, solRaised | Buy/sell instructions read on-chain state |
| useCarnageData (Carnage display) | Vault balance, burn totals | Display-only |
| useCurrentSlot (countdown) | Approximate slot for epoch countdown | Display-only, not used in TX construction |

## State Analysis

### In-Memory State (Protocol Store)

The protocol store is the central state cache. It holds:
- 8 protocol PDA states (Anchor-decoded)
- 2 synthetic supply keys (`__supply:CRIME`, `__supply:FRAUD`)
- 1 synthetic slot key (`__slot`)
- 1 synthetic staking stats key (`__staking:globalStats`)
- CarnageSolVault lamports

**State consistency**: Last-write-wins. No versioning or slot-number tracking. This means a slow webhook delivery could overwrite a more recent batch-seed value.

**State lifecycle**: Populated on server boot (batchSeed), updated by webhooks and polling, never expired. If a webhook stops delivering, state goes stale indefinitely.

### Client-Side State

Each hook maintains its own derived state from `useProtocolState`. State is React state (useState/useMemo), updated on SSE events. No cross-hook synchronization -- each hook independently extracts its fields from the shared `accounts` map.

**Token balances**: Separate from the SSE pipeline. `useTokenBalances` does its own RPC polling every 30s.

## Focus-Specific Analysis

### Finding 1: CarnageSolVault nativeBalanceChange Semantic Mismatch

**File**: `app/app/api/webhooks/helius/route.ts:554`

```typescript
const lamports = item.accountData?.[0]?.nativeBalanceChange;
protocolStore.setAccountState(pubkey, {
  lamports: typeof lamports === "number" ? lamports : 0,
  updatedAt: Date.now(),
});
```

**Analysis**: The Helius Enhanced Webhook `nativeBalanceChange` field name strongly implies it is a *change* (delta), not an absolute balance. The batch-seed path (`ws-subscriber.ts:135-138`) correctly stores `info.lamports` (the absolute balance). After the first webhook update, the store overwrites the correct absolute balance with a delta value.

**5 Whys**:
1. Why does this exist? To update CarnageSolVault balance in real-time via webhooks.
2. Why `nativeBalanceChange`? Because CarnageSolVault is a SystemAccount (no Anchor data), so the webhook handler uses the Helius-parsed field.
3. Why this specific field? Likely because it was the most obviously available number in the accountData structure.
4. Why not the raw account data? SystemAccounts don't have program-owned data -- only lamports matter.
5. Why would this fail? If nativeBalanceChange is a delta (positive or negative), storing it as absolute lamports produces incorrect values.

**Impact**: CarnageSolVault balance displayed to users in useCarnageData will be wrong after the first webhook-delivered update. Since Carnage events are relatively rare (~4.3% per epoch), the batch-seed value will be correct initially, but will become wrong when any transaction touches the vault.

**Recommendation**: Use the raw account lamports from the enhanced webhook payload, or fetch the current balance via an RPC call when a SystemAccount change is detected.

### Finding 2: Polling Fallback Produces Incompatible Data

**File**: `app/hooks/useProtocolState.ts:196-212`

```typescript
const pollViaRpc = useCallback(async () => {
  const infos = await connection.getMultipleAccountsInfo(ALL_MONITORED_PUBKEYS);
  setAccounts((prev) => {
    const next = { ...prev };
    for (let i = 0; i < ALL_MONITORED_PUBKEYS.length; i++) {
      const info = infos[i];
      if (info) {
        next[pubkey] = {
          label: `rpc-poll`,
          lamports: info.lamports,
          owner: info.owner.toBase58(),
          dataLength: info.data.length,
          updatedAt: Date.now(),
        };
      }
    }
    return next;
  });
}, []);
```

**Analysis**: The polling fallback stores raw account metadata (`lamports`, `dataLength`, `owner`) instead of Anchor-decoded fields. This is structurally incompatible with the SSE path which stores decoded fields (`reserveA`, `reserveB`, `mintA`, etc.).

**5 Whys**:
1. Why does this exist? As a degraded-mode fallback when SSE is unavailable.
2. Why raw metadata instead of decoded data? The browser doesn't have Anchor program instances to decode raw account data.
3. Why not decode on the server? Because the polling fallback runs in the browser (client-side hook).
4. Why this specific set of fields? They're the only universally available fields from `getAccountInfo`.
5. Why would this fail? Downstream hooks check for specific field names/types and will get null for SSE-specific fields.

**Downstream impact**: When this fallback data is consumed by:
- `usePoolPrices`: `typeof data.reserveA === "number"` check fails -> pools show as loading/zero
- `useEpochState`: `typeof sseData.currentEpoch !== "number"` check fails -> null epochState
- `useCurveState`: `typeof data.participantCount !== "number"` check fails -> null curve data
- `useCarnageData`: `typeof carnageFund.totalTriggers !== "number"` check fails -> null

**Impact**: During SSE outages >30s, the entire UI goes to loading/empty state instead of showing degraded data. The polling fallback exists but provides no useful data to any consuming hook.

### Finding 3: skipPreflight on Mainnet for Multi-Hop

**File**: `app/lib/swap/multi-hop-builder.ts:381`

```typescript
signature = await wallet.sendTransaction(
  build.transaction,
  connection,
  { skipPreflight: true, maxRetries: 3 },
);
```

**Analysis**: This is documented as a devnet workaround ("devnet simulation rejects v0 TX with Blockhash not found errors"). The code has no cluster-awareness -- it will also skip preflight on mainnet.

**5 Hows**:
1. How does this work? Bypasses the RPC node's automatic simulation before broadcasting.
2. How could this be exploited? Not directly exploitable, but reduces error feedback quality.
3. How does this interact with other components? `pollTransactionConfirmation` checks `confirmation.err` after the fact.
4. How could this fail? Broken transactions are broadcast, consuming priority fees. User sees "failed" after waiting for confirmation instead of immediate simulation error.
5. How would an attacker approach this? Not applicable -- this is a quality/UX issue, not a security issue.

**Comparison**: Direct swaps in useSwap.ts use `skipPreflight: false` (line 764). Staking uses `skipPreflight: false` (line 581). Only multi-hop uses true.

### Finding 4: Quote TOCTOU Window

**File**: `app/hooks/useSwap.ts:329-538`

**Analysis**: The quote computation path:
1. User enters amount -> 300ms debounce -> `computeQuote()`
2. `computeQuote` reads `pools[poolConfig.label]` (from SSE, up to 5s stale)
3. `computeQuote` reads `epochState.{crime,fraud}{Buy,Sell}TaxBps` (from SSE)
4. Quote produces `minimumOutput = floor(output * (10000 - slippageBps) / 10000)`
5. User clicks swap -> `executeSwap()` builds TX with that `minimumOutput`
6. Between step 4 and step 6, pool reserves and tax rates can change

**Staleness budget**:
- SSE slot throttle: 5s (configurable via SLOT_BROADCAST_INTERVAL_MS)
- Helius webhook delivery latency: typically 1-5s
- Debounce: 300ms
- User think time: variable (seconds to minutes)
- **Total**: 6-300s+ between quote data and TX execution

**Safety net**: On-chain program enforces `minimumOutput`. If reserves changed enough to violate the minimum, the TX fails. This is correct behavior -- the user gets a "slippage exceeded" error rather than a bad trade.

**However**: The *displayed* quote can be significantly different from the actual execution. The user sees one number, and the actual result is different (within slippage tolerance). This is a UX issue, not a security issue, because on-chain enforcement prevents fund loss.

### Finding 5: No Enhanced Account Webhook Age Check

**File**: `app/app/api/webhooks/helius/route.ts:525-633`

The raw transaction path has a 5-minute age check (H049, line 381-388):
```typescript
if (blockTime != null) {
  const age = Math.floor(Date.now() / 1000) - blockTime;
  if (age > MAX_TX_AGE_SECONDS) { ... skip ... }
}
```

But the enhanced account change path has NO age check. Account changes are accepted at any age:
```typescript
async function handleAccountChanges(accounts: HeliusAccountChange[]): Promise<NextResponse> {
  // No age/freshness validation
  for (const item of accounts) { ... }
}
```

**Impact**: If Helius replays old enhanced webhook payloads (e.g., during their system recovery), old account state could overwrite newer state in the protocol store. This is mitigated by the fact that Helius HMAC auth prevents external replay, but does not protect against Helius-originated replays.

### Finding 6: No Slot/Version Tracking in Protocol Store

**File**: `app/lib/protocol-store.ts`

The store has no concept of slot numbers or versions. It's purely last-write-wins with string-based dedup. This means:
1. A webhook delivering state from slot N could overwrite state from slot N+10 (if the N+10 delivery arrived first via batchSeed or polling)
2. There is no way for consumers to know how fresh the data is
3. The `updatedAt: Date.now()` timestamp reflects *server processing time*, not on-chain state time

**5 Whys**:
1. Why no slot tracking? Simplicity -- the current architecture assumes webhooks deliver in order.
2. Why last-write-wins? In-memory store for single-process deployment -- no need for complex conflict resolution.
3. Why this pattern? The dedup prevents redundant broadcasts, which is the main optimization goal.
4. Why is this acceptable? Because all downstream consumers use the data for display, not for financial decisions.
5. Why would this fail? Out-of-order webhook deliveries or replay scenarios.

## Dependencies

### External APIs

| Dependency | Usage | Failure Mode |
|------------|-------|-------------|
| Helius RPC (HTTP) | batchSeed, polling, TX confirmation | Connection timeout -> degraded (empty store) |
| Helius RPC (WebSocket) | onSlotChange subscription | Disconnect -> staleness monitor activates fallback |
| Helius Enhanced Webhook | Account change notifications | Missed webhook -> stale protocol store |
| Helius Raw Webhook | Transaction event parsing | Missed webhook -> missing swap/epoch/carnage events in DB |

### Internal Dependencies

| Module | Depends On | Provides To |
|--------|-----------|-------------|
| ws-subscriber | connection, protocol-store, anchor, protocol-config | All SSE consumers |
| protocol-store | sse-manager, bigint-json | SSE route, webhook handler, health check |
| useProtocolState | protocol-config, connection, sentry, bigint-json | All downstream hooks |
| useSwap | usePoolPrices, useEpochState, swap-builders, connection | SwapForm component |
| swap-builders | anchor, protocol-config, hook-resolver | useSwap, multi-hop-builder |

## Cross-Focus Intersections

### CHAIN-01 (RPC Trust)
The entire data pipeline trusts RPC responses. If the Helius RPC returns stale or incorrect data during batchSeed or polling, the protocol store and all downstream consumers inherit that incorrectness. The "confirmed" commitment level provides reasonable safety, but there's no multi-RPC validation.

### CHAIN-02 (Account State)
The Anchor decode path validates discriminators but not individual field ranges. If on-chain data is corrupted (e.g., by a bug in a program upgrade), the webhook handler would faithfully store and broadcast corrupt data.

### CHAIN-05 (MEV/Ordering)
The TOCTOU gap between quote and execution creates MEV exposure. The `minimumOutput` computed from stale reserves may be more permissive than intended, widening the sandwich window. However, this is bounded by the user's configured slippage.

### DATA-01 (Data Persistence)
The swap_events, epoch_events, and carnage_events tables in Postgres are populated by the webhook handler in parallel with protocol store updates. These two paths are not transactional -- a DB failure doesn't prevent protocol store update, and vice versa.

### ERR-01 (Availability)
If ws-subscriber.init() fails (caught by instrumentation.ts), the server continues with an empty protocol store. New SSE clients receive an empty initial-state snapshot. Polling fallback produces incompatible data. The combined failure mode is: UI shows loading states indefinitely.

## Cross-Reference Handoffs

| Target Agent | Item | Priority |
|-------------|------|----------|
| CHAIN-01 | Verify that Helius RPC responses are validated at "confirmed" commitment in all paths | Medium |
| CHAIN-02 | Analyze Anchor decode failure modes in webhook handler -- can malformed rawAccountData crash the handler? | Medium |
| CHAIN-05 | Assess MEV exposure from TOCTOU gap given observed staleness windows (5-60s) | High |
| ERR-01 | Analyze cascading failure from empty protocol store (ws-subscriber init failure) | Medium |
| ERR-02 | Check for race conditions between SSE events and RPC polling fallback writes | Low |
| LOGIC-01 | Verify that stale epoch state (wrong tax rates in UI) doesn't mislead users into unprofitable trades | Medium |
| DATA-01 | Check if webhook handler DB writes can block protocol store updates (async error propagation) | Low |

## Risk Observations

### HIGH

1. **CarnageSolVault nativeBalanceChange as absolute**: Likely semantic mismatch producing incorrect vault balance display after first webhook update.

2. **Polling fallback produces incompatible data**: SSE outage >30s results in complete UI data loss rather than degraded display.

3. **skipPreflight unconditional on mainnet**: Multi-hop transactions will bypass simulation on mainnet, degrading UX quality.

### MEDIUM

4. **No enhanced webhook age/freshness check**: Old account state could overwrite newer state during Helius replay scenarios.

5. **No protocol store version/slot tracking**: Last-write-wins without ordering guarantees on state updates.

6. **BN.toNumber() for staker stats summation**: No explicit overflow check on accumulated values.

7. **SSE initial-state has no staleness indicator**: Clients cannot detect stale data on connection.

8. **Quote TOCTOU window**: Staleness budget of 6-300s+ between quote data and TX execution. Bounded by on-chain minimumOutput enforcement.

### LOW

9. **Client-side slot estimation drift**: Linear extrapolation diverges from actual slot rate during congestion.

10. **Token balance polling has no staleness detection**: Behind-node RPC could return older balances.

11. **WebSocket stale-to-fallback gap**: Up to 25s of slot data lost in transition.

12. **anchorToJson duck-typing fragility**: `"toNumber" in val` check could match non-BN objects.

## Novel Attack Surface Observations

1. **Selective webhook delivery manipulation**: If an attacker could influence which Helius webhook deliveries succeed or fail (e.g., by causing intermittent network issues to the Railway instance), they could create a scenario where pool state updates arrive but epoch state updates don't. This would cause the UI to display current prices with stale tax rates, potentially misleading users about the effective tax on their trades. The on-chain enforcement prevents fund loss, but the user's decision to trade is based on misleading information.

2. **Protocol store pollution via decode error fallback**: When Anchor decode fails for an enhanced webhook, the handler stores raw data with a `decodeError` flag (`route.ts:608-619`). This raw data has different field names than the successfully decoded data. If a subsequent SSE consumer caches the error-flagged data and a later successful decode arrives, the dedup mechanism (`JSON.stringify` comparison) will always see a difference (because the structures differ), causing unnecessary broadcasts. More importantly, if the error-flagged data is consumed by a hook that doesn't check for `decodeError`, it could produce unexpected behavior.

3. **Time-based oracle for staker classification**: The `ws-subscriber.ts` staker poll uses `Date.now() / 1000` compared against `lastClaimTs` to classify stakers as locked/unlocked. Server clock drift or NTP issues could shift the locked/unlocked boundary, affecting the displayed staking stats. This is display-only but could create confusion about available liquidity.

## Questions for Other Focus Areas

1. **For CHAIN-02**: Can the Helius Enhanced Webhook deliver rawAccountData for accounts that have been closed? What happens when `Buffer.from(null, "base64")` is passed to Anchor decode?

2. **For CHAIN-05**: Given that quotes can be 5-60s stale and slippage is user-configurable (up to 50% floor), what is the realistic MEV extraction opportunity on mainnet? Does the 50% floor provide adequate protection?

3. **For ERR-02**: Is there a race condition where the SSE initial-state snapshot is sent mid-update (between two protocolStore writes), producing a partially-consistent view?

4. **For API-01**: Can the SSE protocol route's heartbeat mechanism keep connections alive past the sse-connections auto-release (30min)? What happens to the connection count tracking?

5. **For INFRA-03**: If Railway restarts the Next.js process, the protocol store is lost. How long until batchSeed + webhooks repopulate it? Is there a cold-start data gap visible to users?

## Raw Notes

### Commitment Level Audit

All RPC calls through `getConnection()` inherit `"confirmed"` commitment from `connection.ts:69`. Verified:
- `ws-subscriber.ts`: All calls use default connection -> confirmed
- `confirm-transaction.ts`: getSignatureStatuses uses default -> confirmed; getBlockHeight explicitly uses "confirmed"
- `useSwap.ts`: getLatestBlockhash explicitly uses "confirmed"
- `useStaking.ts`: getLatestBlockhash explicitly uses "confirmed"
- `useTokenBalances.ts`: getBalance and getParsedTokenAccountsByOwner use default -> confirmed

No instances of `"processed"` commitment for financial operations found. This aligns with SP-015 (Secure Pattern) and avoids AIP-051 (AI Pitfall).

### skipPreflight Audit

- `useSwap.ts:764`: `skipPreflight: false` -- correct for legacy TX
- `useStaking.ts:581`: `skipPreflight: false` -- correct for legacy TX
- `multi-hop-builder.ts:381`: `skipPreflight: true` -- devnet workaround, needs mainnet conditional

### BigInt Safety Audit

Fields using `{__bigint}` tag (safe for u64+):
- curveState: tokensSold, solRaised, tokensReturned, solReturned, taxCollected
- stakePool: rewardsPerTokenStored

Fields using `.toNumber()` (must be within 2^53):
- poolState: reserveA, reserveB (SOL pool: max ~18B lamports for SOL side, well within 2^53)
- epochState: tax rates (BPS, max 1400), epoch number, slot numbers (all small)
- userStake: stakedBalance (max 20M * 10^6 = 2e13, within 2^53 but approaching)
- carnageFundState: totalCrimeBurned, totalFraudBurned, totalSolSpent, totalTriggers (lifetime aggregates, likely within bounds)

### Protocol Store Key Inventory

Real accounts (Base58 pubkeys): EpochState, CarnageFund, CarnageSolVault, CRIME_SOL pool, FRAUD_SOL pool, CRIME curveState, FRAUD curveState, StakePool

Synthetic keys (__ prefix): `__supply:CRIME`, `__supply:FRAUD`, `__slot`, `__staking:globalStats`

Total: 12 entries in protocol store
