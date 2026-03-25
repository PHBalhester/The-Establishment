---
task_id: db-phase1-rpc-node-trust
provides: [rpc-node-trust-findings, rpc-node-trust-invariants]
focus_area: rpc-node-trust
files_analyzed:
  - app/lib/connection.ts
  - shared/programs.ts
  - shared/constants.ts
  - scripts/deploy/lib/connection.ts
  - scripts/crank/crank-provider.ts
  - scripts/crank/crank-runner.ts
  - scripts/graduation/graduate.ts
  - scripts/backfill-candles.ts
  - app/lib/confirm-transaction.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/hooks/useProtocolWallet.ts
  - app/hooks/useSwap.ts
  - app/hooks/usePoolPrices.ts
  - app/hooks/useTokenBalances.ts
  - app/hooks/useEpochState.ts
  - app/hooks/useCurveState.ts
  - app/providers/providers.tsx
  - app/app/api/health/route.ts
  - app/components/launch/BuyForm.tsx
  - app/components/launch/SellForm.tsx
  - scripts/vrf/lib/vrf-flow.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# RPC Client & Node Trust -- Condensed Summary

## Key Findings (Top 10)

1. **Single RPC provider (Helius) with no failover**: All frontend, crank, and deployment code routes through a single Helius RPC endpoint. If Helius experiences downtime, the entire protocol halts -- `app/lib/connection.ts:33`, `scripts/crank/crank-provider.ts:35`, `shared/programs.ts:22`
2. **Helius API key hardcoded in source code**: The Helius API key `[REDACTED-DEVNET-KEY]-...` is committed to the repo in `shared/programs.ts:22`, `shared/constants.ts:474`, and `scripts/backfill-candles.ts:47`. While labeled "free-tier, not a secret," rate limiting is tied to this key -- revocation or abuse affects everyone.
3. **skipPreflight=true on user-facing bonding curve TXs**: `BuyForm.tsx:189` and `SellForm.tsx:198` use `skipPreflight: true` for user-initiated bonding curve purchases and sells. Failed TXs consume fees without prior simulation feedback. This bypasses the RPC's pre-submission safety check.
4. **skipPreflight=true on multi-hop swaps (atomic routes)**: `multi-hop-builder.ts:381` uses `skipPreflight: true` for v0 VersionedTransactions. Comment says devnet simulation rejects v0 TX -- but this pattern will carry to mainnet unless explicitly changed.
5. **No RPC response validation on pool reserve reads**: `usePoolPrices.ts:118-121` reads pool reserves via `getMultipleAccountsInfo` and directly uses values for swap quoting. A malicious/compromised RPC could return manipulated reserve data, causing users to accept bad quotes.
6. **Balance check uses default commitment (no explicit finalized)**: `useTokenBalances.ts:86` calls `getBalance` and `getParsedTokenAccountsByOwner` without explicit commitment. Inherits `confirmed` from the singleton Connection, which is acceptable for display but would be insufficient for payment verification.
7. **No WebSocket reconnection logic**: `usePoolPrices.ts:204-261` subscribes via `onAccountChange` but has no reconnect-on-disconnect handler. WebSocket drops are silent -- the hook unsubscribes on visibility change but has no explicit reconnect timer or health check for the WS connection.
8. **Crank runner has no RPC failover or health monitoring**: `crank-runner.ts` catches errors and retries after 30s (`ERROR_RETRY_DELAY_MS`), but doesn't distinguish between transient RPC errors and permanent failures. No alternate RPC endpoint is configured.
9. **RPC URL fallback chain exposes API key to client bundle**: `app/lib/connection.ts:33` falls back from `NEXT_PUBLIC_RPC_URL` to `DEVNET_RPC_URL` (from `shared/programs.ts`). The `DEVNET_RPC_URL` contains the Helius API key and is imported into client-side code via the shared package.
10. **Health endpoint always returns 200 even when RPC is down**: `health/route.ts:49` returns HTTP 200 with `status: "degraded"` when Solana RPC fails. Railway's healthcheck sees 200 and keeps the container alive even when the app cannot function.

## Critical Mechanisms

- **Singleton Connection factory** (`app/lib/connection.ts:31-52`): Creates one `Connection` with `"confirmed"` commitment and explicit `wsEndpoint`. Cached by URL. No failover, no retry wrapping, no circuit breaker. Every frontend component and API route shares this single connection.
- **Deploy/crank provider factory** (`scripts/deploy/lib/connection.ts:64-101`, `scripts/crank/crank-provider.ts:34-87`): Creates `AnchorProvider` with configurable commitment via `COMMITMENT` env var (default: `"confirmed"`). No connection pooling or failover. Both fall back to `localhost:8899` if `CLUSTER_URL` is unset.
- **Polling confirmation** (`app/lib/confirm-transaction.ts:29-67`): Custom HTTP-polling confirmation replaces unreliable WebSocket. Polls `getSignatureStatuses` every 2s with 90s timeout. Checks block height expiry. Properly handles `confirmed`/`finalized` distinction.
- **sign-then-send wallet pattern** (`useProtocolWallet.ts:87-121`): Signs via wallet adapter, then submits through the app's own Helius RPC via `sendRawTransaction`. This ensures TX goes through the controlled RPC endpoint rather than the wallet's built-in RPC.

## Invariants & Assumptions

- INVARIANT: All RPC calls from the frontend use `"confirmed"` commitment -- enforced at `app/lib/connection.ts:46`
- INVARIANT: Transaction confirmation requires `"confirmed"` or `"finalized"` status -- enforced at `app/lib/confirm-transaction.ts:44-45`
- INVARIANT: VRF TX1 (create randomness) must use `"finalized"` commitment -- enforced at `scripts/vrf/lib/vrf-flow.ts:22` (documented anti-pattern)
- ASSUMPTION: Helius RPC is available and returns correct data -- UNVALIDATED. No response integrity checks, no multi-provider cross-validation.
- ASSUMPTION: WebSocket subscriptions remain connected and deliver all events -- UNVALIDATED. No reconnection logic, no gap-fill on reconnect.
- ASSUMPTION: `NEXT_PUBLIC_RPC_URL` env var is set in production, avoiding the hardcoded Helius devnet URL fallback -- NOT ENFORCED. No startup validation.
- ASSUMPTION: `skipPreflight: true` is a devnet workaround that will be changed for mainnet -- documented in code comments but NOT tracked in mainnet checklist.

## Risk Observations (Prioritized)

1. **[HIGH] Single point of failure -- no RPC failover**: Helius downtime = protocol-wide halt. The crank stops advancing epochs, the frontend can't build transactions, WebSocket subscriptions die. No secondary RPC is configured anywhere. Impact: complete service outage. -- `app/lib/connection.ts`, `scripts/crank/crank-provider.ts`
2. **[HIGH] skipPreflight on user-facing bonding curve TXs carries mainnet risk**: Unlike the multi-hop builder (which has a documented devnet-only reason), `BuyForm.tsx:189` and `SellForm.tsx:198` use `skipPreflight: true` without documented rationale. Users pay fees for TXs that would have been caught by simulation. -- `app/components/launch/BuyForm.tsx:189`, `app/components/launch/SellForm.tsx:198`
3. **[HIGH] No RPC response validation for financial data**: Pool reserves from `getMultipleAccountsInfo` are used directly in quote calculations without sanity checks. A compromised RPC returning zero reserves or manipulated values would produce wildly wrong quotes. -- `app/hooks/usePoolPrices.ts:118-160`
4. **[MEDIUM] API key in source code (shared package, client bundle)**: `shared/programs.ts:22` hardcodes the Helius API key. This module is imported by `app/lib/connection.ts` which runs in the browser. The key is extractable from the client JS bundle. If someone abuses it, the rate limit affects all users. -- `shared/programs.ts:22`, `shared/constants.ts:474`
5. **[MEDIUM] WebSocket gap on tab return**: When the user returns to the tab, `usePoolPrices` does a batch RPC fetch and resubscribes WebSocket. But between the WS unsubscribe (tab hidden) and the batch fetch (tab return), any pool state changes are missed. Stale reserves used for quoting during the gap. -- `app/hooks/usePoolPrices.ts:278-297`
6. **[MEDIUM] Crank uses balance for vault top-up decisions based on single RPC read**: `crank-runner.ts:222` reads vault balance once and decides to top up. If the RPC returns a stale or incorrect balance, the top-up may be unnecessary or insufficient. -- `scripts/crank/crank-runner.ts:222-241`
7. **[MEDIUM] Health check doesn't distinguish crank-critical vs frontend-critical**: A degraded RPC (slow but responding) passes the health check (`getSlot()` succeeds) but may fail time-sensitive crank operations. No latency check. -- `app/app/api/health/route.ts:41-46`
8. **[MEDIUM] No rate limiting protection in frontend RPC calls**: Multiple hooks fire RPC calls in parallel on mount (`usePoolPrices`, `useTokenBalances`, `useEpochState`, `useCurveState`). A page refresh triggers ~10+ simultaneous RPC calls. Could hit Helius rate limits. -- multiple hooks
9. **[LOW] localhost:8899 default in crank/deploy providers**: Both `crank-provider.ts:35` and `deploy/lib/connection.ts:68` default to `http://localhost:8899` if `CLUSTER_URL` is unset. On Railway, if the env var is misconfigured, the crank silently tries to connect to localhost (non-existent). -- `scripts/crank/crank-provider.ts:35`
10. **[LOW] Connection singleton can go stale**: `app/lib/connection.ts` caches the Connection indefinitely if the URL doesn't change. Long-running processes (Railway) may hold stale TCP connections. No periodic health check or reconnect. -- `app/lib/connection.ts:21-22`

## Novel Attack Surface

- **RPC-based quote manipulation**: If an attacker can MITM or compromise the user's RPC connection (e.g., via browser extension injecting a custom RPC URL into `NEXT_PUBLIC_RPC_URL`), they can feed manipulated pool reserves to the quote engine, causing the user to accept a swap at a disadvantageous rate. The on-chain program's slippage check is the only defense.
- **Helius API key exhaustion**: The hardcoded API key in the client bundle means anyone can extract it and burn through rate limits, potentially degrading service for all legitimate users during high-activity periods.

## Cross-Focus Handoffs

- --> **SEC-02**: Helius API key hardcoded in `shared/programs.ts:22` and `shared/constants.ts:474`. Assess whether this constitutes a credential leak given it's in the client bundle.
- --> **CHAIN-04**: WebSocket subscription reliability in `usePoolPrices.ts`, `useEpochState.ts`, `useCurveState.ts` -- no reconnection logic, no event replay on gap. Assess state sync implications.
- --> **BOT-01/BOT-02**: Crank runner at `scripts/crank/crank-runner.ts` has no RPC failover. Assess impact of crank downtime on epoch transitions and carnage execution.
- --> **CHAIN-05**: `skipPreflight: true` in `multi-hop-builder.ts:381` and `BuyForm.tsx:189` -- assess MEV exposure from skipping simulation (failed TXs still confirmed, visible on-chain).

## Trust Boundaries

The codebase places full trust in a single RPC provider (Helius) for all operations: reading on-chain state, submitting transactions, confirming transaction status, and WebSocket subscriptions. There is no validation of RPC response integrity, no cross-provider verification, and no failover path. The RPC endpoint is the single most critical infrastructure dependency. For the frontend, the trust boundary is the `confirmed` commitment level -- processed data is never used for financial decisions. For the crank, the trust boundary is the same Helius RPC, with no independent verification that the RPC is returning correct state. The sign-then-send pattern in `useProtocolWallet.ts` correctly routes all user transactions through the app's controlled RPC rather than the wallet's potentially different RPC, which is a positive trust decision.
<!-- CONDENSED_SUMMARY_END -->

---

# RPC Client & Node Trust -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol relies entirely on a single Helius RPC endpoint for all blockchain interactions across three deployment contexts: the Next.js frontend (browser), the crank runner (Railway server), and deployment scripts (local admin). There is zero RPC failover, zero response validation, and zero cross-provider verification. The commitment level usage is consistently `"confirmed"` for all operations, which is appropriate for the current devnet deployment but needs review for mainnet financial operations.

The most significant risks are: (1) single point of failure with no failover, (2) unvalidated RPC responses used in financial quote calculations, and (3) `skipPreflight: true` on user-facing transactions that will carry to mainnet unless explicitly addressed.

## Scope

All off-chain TypeScript code that creates `Connection` objects, makes RPC calls, or uses RPC responses for decision-making. On-chain Anchor programs (`programs/`) excluded.

## Key Mechanisms

### 1. RPC Connection Creation

There are exactly **4 places** where `new Connection()` is created in production code:

| Location | Default URL | Commitment | Context |
|----------|------------|------------|---------|
| `app/lib/connection.ts:45` | `NEXT_PUBLIC_RPC_URL` > `DEVNET_RPC_URL` | `"confirmed"` | Frontend singleton |
| `scripts/deploy/lib/connection.ts:93` | `CLUSTER_URL` > `localhost:8899` | `COMMITMENT` env > `"confirmed"` | Deploy scripts |
| `scripts/crank/crank-provider.ts:82` | `CLUSTER_URL` > `localhost:8899` | `COMMITMENT` env > `"confirmed"` | Crank runner |
| `scripts/backfill-candles.ts:258` | Hardcoded Helius devnet URL | `"confirmed"` | Backfill script |

All four use the same Helius devnet endpoint (same API key). No connection has failover, retry wrapping, circuit breaking, or health monitoring.

### 2. Frontend Connection Singleton

```
app/lib/connection.ts:31-52
```

- Memoized by URL string comparison
- Creates Connection with `{ commitment: "confirmed", wsEndpoint }` where wsEndpoint is derived by replacing `https://` with `wss://`
- No TTL on cache -- connection lives forever in browser memory
- No periodic health check
- Shared by: all hooks (usePoolPrices, useEpochState, useCurveState, useTokenBalances), all transaction builders, all API routes

### 3. Transaction Submission Patterns

Three distinct patterns exist:

**Pattern A: Direct swap (legacy TX, preflight ON)**
- `useSwap.ts:746-747`: `skipPreflight: false`
- `useStaking.ts:564`: `skipPreflight: false`
- Good: RPC simulates before submitting

**Pattern B: Atomic route (v0 TX, preflight OFF)**
- `multi-hop-builder.ts:381`: `skipPreflight: true, maxRetries: 3`
- Documented reason: devnet simulation rejects v0 TX with "Blockhash not found"
- Compensated by: checking `confirmation.err` after polling

**Pattern C: Bonding curve (legacy TX, preflight OFF)**
- `BuyForm.tsx:189`: `skipPreflight: true`
- `SellForm.tsx:198`: `skipPreflight: true`
- No documented reason -- appears to be copy-paste from Pattern B
- Compensated by: checking `result.err` after polling

Pattern C is the most concerning because legacy transactions DO NOT have the v0 simulation issue and CAN use preflight. The `skipPreflight: true` here appears unnecessary.

### 4. Commitment Level Usage

| Context | Commitment | Appropriate? |
|---------|-----------|-------------|
| Pool reserve reads (quotes) | `"confirmed"` | Yes -- display only |
| Balance reads | Default (`"confirmed"`) | Yes -- display only |
| Transaction confirmation | `"confirmed"` or `"finalized"` accepted | Yes |
| Block height expiry check | `"confirmed"` | Yes |
| Crank vault balance check | Default (`"confirmed"`) | Acceptable -- topped up with margin |
| VRF TX1 create randomness | `"finalized"` (documented) | Yes -- required by Switchboard |
| Blockhash fetch for signing | `"confirmed"` | Yes |

No `"processed"` commitment is used anywhere in the codebase. This is a positive finding.

### 5. WebSocket Subscriptions

Four hooks use WebSocket subscriptions:
- `usePoolPrices.ts`: `onAccountChange` for 2 pool accounts
- `useEpochState.ts`: `onAccountChange` for EpochState PDA
- `useCurveState.ts`: `onAccountChange` for 2 CurveState PDAs
- `useCurrentSlot.ts`: slot subscription

All share these characteristics:
- Subscribe on mount/visibility-active
- Unsubscribe on unmount/visibility-inactive
- No explicit reconnect-on-disconnect handler
- No gap-fill polling after reconnect (except burst-refresh on tab return in usePoolPrices)
- Rely on the Connection's internal WebSocket management

## Trust Model

```
User Browser <---> Helius RPC Node <---> Solana Validators
                   ^
                   |
        Single point of trust
        No response validation
        No cross-verification
```

The codebase implicitly trusts that Helius:
1. Returns accurate account data (used for quoting, balance display)
2. Faithfully relays transactions to validators
3. Correctly reports transaction confirmation status
4. Maintains WebSocket connections and delivers all account change notifications
5. Does not reorder, delay, or drop transactions

None of these trust assumptions are validated or verified.

## State Analysis

### Module-level singletons (potential staleness)

| Singleton | Location | Staleness Risk |
|-----------|----------|---------------|
| `cachedConnection` | `app/lib/connection.ts:21` | Low -- Connection objects handle reconnection internally |
| `cachedALT` | `app/lib/swap/multi-hop-builder.ts:261` | Medium -- ALT could be deactivated or updated |

### Environment-dependent state

| Env Var | Used By | Default | Risk if Unset |
|---------|---------|---------|---------------|
| `NEXT_PUBLIC_RPC_URL` | Frontend connection | Falls back to hardcoded Helius devnet URL | Medium -- wrong network for mainnet |
| `CLUSTER_URL` | Crank, deploy | `localhost:8899` | High -- silent failure on Railway |
| `COMMITMENT` | Crank, deploy | `"confirmed"` | Low -- acceptable default |

## Dependencies

| Dependency | Type | Risk |
|-----------|------|------|
| Helius RPC | Third-party hosted RPC | Single provider, no failover |
| `@solana/web3.js` Connection class | NPM package | Handles TCP/WS lifecycle internally |
| `@coral-xyz/anchor` AnchorProvider | NPM package | Wraps Connection for program interaction |

## Focus-Specific Analysis

### RPC Endpoint Trust

**Finding 1: All code paths lead to Helius**

Every single RPC call in the codebase -- frontend reads, crank transactions, deployment operations -- goes through the same Helius infrastructure. The Helius API key (`[REDACTED-DEVNET-KEY]-...`) appears in:
- `shared/programs.ts:22` (imported by frontend)
- `shared/constants.ts:474` (imported by frontend)
- `scripts/backfill-candles.ts:47` (deploy-time only)

For mainnet, the `NEXT_PUBLIC_RPC_URL` env var would point to a paid Helius endpoint, but the fallback still references the free-tier devnet URL.

**Finding 2: No response sanity checks**

Pool reserves read from RPC are fed directly into quote calculations:
```
// usePoolPrices.ts:153-154
reserveA: toNum(decoded.reserveA),
reserveB: toNum(decoded.reserveB),
```

These values drive the `quoteSolBuy` / `quoteSolSell` functions in `quote-engine.ts`, which determine the minimum output the user accepts. If reserves are wrong:
- Zero reserves = division by zero (guarded in quote engine)
- Inflated/deflated reserves = bad price = user accepts unfavorable swap

The on-chain program's own slippage check is the ultimate defense, but the user is shown misleading information.

### RPC Failover

**Finding 3: No failover exists anywhere**

There is no secondary RPC URL configured, no retry-with-different-endpoint logic, no health-check-based URL switching. The `getConnection()` factory accepts one URL. The crank runner's error handler (`crank-runner.ts:302-314`) catches all errors uniformly and retries after 30s -- it does not distinguish between a transient RPC timeout and a permanent RPC outage.

### Rate Limiting

**Finding 4: Frontend fires multiple simultaneous RPC calls on page load**

On page load with a connected wallet, these hooks fire simultaneously:
1. `usePoolPrices` -- `getMultipleAccountsInfo` (1 call) + 2 WS subscriptions
2. `useTokenBalances` -- `getBalance` + `getParsedTokenAccountsByOwner` (2 calls)
3. `useEpochState` -- `getAccountInfo` (1 call) + 1 WS subscription
4. `useCurveState` -- `getAccountInfo` x2 (2 calls) + 2 WS subscriptions

Total: ~6 HTTP RPC calls + ~5 WebSocket subscriptions on page load. This is within typical Helius free-tier limits (25 req/s) but leaves little headroom during high-activity periods.

The crank runner addresses this with `RPC_DELAY_MS = 200` between calls (`crank-runner.ts:59`), which is good practice.

### Stale Data

**Finding 5: WebSocket gap between tab hide and tab return**

`usePoolPrices.ts` unsubscribes WebSocket on tab hide (`unsubscribeAll()`) and does a batch fetch + resubscribe on tab return. The batch fetch provides fresh data, but there's a brief window where the data could be stale. Given that quotes are recalculated when the user interacts (debounced input), the practical risk is low.

### skipPreflight Analysis

**Finding 6: Inconsistent skipPreflight across transaction types**

| Transaction Type | skipPreflight | Rationale | Risk |
|-----------------|---------------|-----------|------|
| Direct SOL swap (legacy) | false | N/A | Safe |
| Staking operations (legacy) | false | N/A | Safe |
| Atomic multi-hop (v0) | true | Devnet simulation rejects v0 TX | Medium -- compensated by err check |
| Bonding curve buy (legacy) | true | None documented | Medium -- unnecessary |
| Bonding curve sell (legacy) | true | None documented | Medium -- unnecessary |
| VRF TX1 create randomness | true | Switchboard SDK LUT staleness | Low -- admin-only operation |
| VRF TX3 reveal+consume | true | v0 TX same as multi-hop | Low -- admin-only operation |

The bonding curve forms (`BuyForm.tsx`, `SellForm.tsx`) use `skipPreflight: true` on legacy transactions with no documented reason. These are user-facing and should use preflight simulation.

## Cross-Focus Intersections

### CHAIN-04 (State Sync)
WebSocket subscription reliability directly impacts state freshness. The lack of reconnection logic means silent data staleness after WS drops. This affects pool reserves (quote accuracy), epoch state (tax rate display), and curve state (progress tracking).

### SEC-02 (Secrets)
The Helius API key in `shared/programs.ts` is bundled into the client-side JavaScript. While labeled "free-tier," it's the same key used by the crank runner on Railway. If the mainnet deployment uses a paid Helius key in `NEXT_PUBLIC_RPC_URL`, the devnet key in the fallback path is still in the bundle.

### BOT-01 (Crank Automation)
The crank runner's resilience depends entirely on RPC availability. No failover means any Helius outage stops epoch advancement, which freezes tax rate changes and carnage execution. The 30s retry is a blunt instrument that doesn't escalate or alert.

### CHAIN-05 (MEV)
`skipPreflight: true` means failed transactions are broadcast to the network and visible to validators/searchers even though they fail. This leaks information about user intent (token pair, direction, rough amount) without any financial risk from the failed TX itself.

## Cross-Reference Handoffs

| To Agent | Item | File | Reason |
|----------|------|------|--------|
| SEC-02 | Helius API key in client bundle | `shared/programs.ts:22` | Credential exposure assessment |
| CHAIN-04 | WS reconnection gap | `usePoolPrices.ts:204-261` | State sync gap assessment |
| BOT-01 | Crank RPC resilience | `crank-runner.ts:302-314` | Availability impact assessment |
| CHAIN-05 | skipPreflight info leak | `multi-hop-builder.ts:381` | MEV exposure from failed TX visibility |
| FE-01 | Stale quote from tab return gap | `usePoolPrices.ts:278-297` | User-facing impact assessment |

## Risk Observations

See prioritized list in Condensed Summary above. Additional observations:

- The `wsEndpoint` derivation (`url.replace("https://", "wss://")`) in `app/lib/connection.ts:43` works for Helius but would break for RPC providers using non-standard WS URLs (e.g., different port or path). Low risk for current setup.
- `pollTransactionConfirmation` has a 90-second hard timeout (`MAX_POLL_DURATION_MS`). On a congested network, legitimate transactions can take longer. The block height check provides proper expiry detection, but the 90s wall-clock timeout could prematurely kill confirmation polling for slow but valid transactions.

## Novel Attack Surface Observations

1. **Browser extension RPC hijacking**: A malicious browser extension could intercept the `NEXT_PUBLIC_RPC_URL` environment variable (or patch the `getConnection()` function) to point to an attacker-controlled RPC. This would allow feeding manipulated pool reserves and account data to the quote engine, potentially tricking users into accepting bad swaps. The on-chain slippage check is the sole defense.

2. **Helius rate limit as a denial vector**: The hardcoded API key in the client bundle means anyone can extract it and issue thousands of requests, burning through the rate limit. This would degrade service for all legitimate users -- RPC calls would start failing with 429 errors, WebSocket subscriptions would drop, and the health endpoint would report "degraded" while Railway keeps the container alive (always-200 pattern).

## Questions for Other Focus Areas

1. **To CHAIN-04**: Do the WebSocket hooks (`useEpochState`, `useCurveState`) have the same gap problem as `usePoolPrices` on tab return? Is there a burst-refresh pattern like `usePoolPrices` uses?
2. **To BOT-01**: Has the crank runner been observed failing due to RPC issues on Railway? What's the longest observed downtime?
3. **To SEC-02**: Is the `NEXT_PUBLIC_RPC_URL` env var set on Railway/production, or does it fall back to the hardcoded devnet URL?
4. **To CHAIN-05**: For the bonding curve TXs with `skipPreflight: true`, could the leaked intent be exploited for sandwich attacks on curve operations?

## Raw Notes

- The `Connection` constructor in `@solana/web3.js` handles TCP keepalive and reconnection internally. The singleton pattern is appropriate for browser contexts where creating multiple connections wastes resources.
- The `pollTransactionConfirmation` helper is a good pattern -- it avoids the known unreliability of WebSocket-based confirmation and provides proper block height expiry checking.
- The sign-then-send pattern in `useProtocolWallet.ts` is a deliberate and well-documented decision to route TXs through the app's controlled RPC rather than the wallet's. This is a positive trust decision.
- Commitment levels are consistently `"confirmed"` throughout. No code uses `"processed"` for financial decisions. This aligns with secure patterns (SP-015 from the KB).
- The crank runner's `RPC_DELAY_MS = 200` rate limiting between RPC calls is good practice for Helius rate limits. The frontend hooks do NOT have equivalent rate limiting.
