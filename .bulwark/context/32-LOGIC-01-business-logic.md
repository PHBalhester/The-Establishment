---
task_id: db-phase1-business-logic
provides: [business-logic-findings, business-logic-invariants]
focus_area: business-logic
files_analyzed: [app/hooks/useSwap.ts, app/hooks/useRoutes.ts, app/hooks/useStaking.ts, app/hooks/useCurveState.ts, app/hooks/useEpochState.ts, app/hooks/useProtocolState.ts, app/hooks/usePoolPrices.ts, app/hooks/useCarnageData.ts, app/hooks/useTokenSupply.ts, app/lib/swap/route-engine.ts, app/lib/swap/quote-engine.ts, app/lib/swap/swap-builders.ts, app/lib/swap/multi-hop-builder.ts, app/lib/swap/split-router.ts, app/lib/staking/rewards.ts, app/lib/protocol-store.ts, app/lib/protocol-config.ts, app/lib/sse-manager.ts, app/lib/bigint-json.ts, app/providers/SettingsProvider.tsx, app/providers/ClusterConfigProvider.tsx, scripts/e2e/lib/carnage-flow.ts]
finding_count: 14
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 6}
---
<!-- CONDENSED_SUMMARY_START -->
# Business Logic & Workflow Security -- Condensed Summary

## Key Findings (Top 10)

1. **Swap state machine has no mutex/lock**: Concurrent `executeSwap()` / `executeRoute()` calls are possible if the user double-clicks or if React re-renders rapidly. Only UI-level status checks (`if (status !== 'idle')`) protect against this, but the check is not atomic with the state transition. -- `app/hooks/useSwap.ts:690-698`
2. **Default slippage is 500 BPS (5%)**: The SettingsProvider defaults to 500 bps slippage (H015 NOT_FIXED from Audit #1). For a DeFi protocol this is unusually high; a sandwich attacker can extract up to 5% of every swap by default. -- `app/providers/SettingsProvider.tsx:170`
3. **Quote-to-execution staleness gap**: The quote computed by the route engine uses pool reserves from the last SSE push. By the time the user reviews and signs, reserves may have shifted. The `minimumOutput` (slippage floor) is the sole protection. The 30-second auto-refresh mitigates but does not eliminate this. -- `app/hooks/useRoutes.ts:582-592` / `app/hooks/useSwap.ts:640-658`
4. **Number conversion at BigInt boundary**: Route engine converts BigInt quote results to `Number()` at step output boundaries (route-engine.ts:251, 284). Individual amounts should be safe, but intermediate `splitOutput` values in split routes flow through `number` arithmetic in `buildSplitRoute`. If total split output exceeds 2^53, precision is silently lost. -- `app/hooks/useRoutes.ts:140-172`
5. **Additive price impact across multi-hop**: Price impact is accumulated by simple addition across hops (`sum + s.priceImpactBps`). In reality, multi-hop price impact compounds multiplicatively. The current additive approach under-reports true impact for large multi-hop swaps. -- `app/lib/swap/route-engine.ts:351-354` (H072 NOT_FIXED from Audit #1, display-only)
6. **Sell fee percentage calculation mixes denominations**: In useSwap's sell-path fee display, `taxAmount/grossSolOutput` (SOL units) is added to `lpFee/baseUnits` (token units). These are different denominations. The display percentage is inaccurate for sell quotes. -- `app/hooks/useSwap.ts:448-449`
7. **Protocol store dedup uses JSON string equality**: `protocol-store.ts:58` compares full JSON serializations to detect changes. This is functionally correct but means object key ordering differences between Anchor decode paths and SSE would bypass dedup and cause redundant broadcasts. -- `app/lib/protocol-store.ts:54-59`
8. **toBaseUnits uses `parseFloat` + `Math.floor`**: User input conversion uses `parseFloat(amount) * 10^decimals`, which is subject to IEEE 754 precision. For 9-decimal SOL amounts, `parseFloat("0.123456789") * 1e9` can produce off-by-one results. -- `app/hooks/useSwap.ts:301-307`
9. **CarnageData uses BN.toNumber() for lifetime aggregates**: `useCarnageData.ts` casts `totalSolSpent`, `totalCrimeBurned`, `totalFraudBurned` via `as number`. These are protocol-lifetime sums. If protocol processes >9 quadrillion lamports (~9000 SOL), the values overflow Number precision. Unlikely but unguarded. -- `app/hooks/useCarnageData.ts:51-55`
10. **Token supply uses INITIAL_SUPPLY fallback**: Before SSE data arrives, `useTokenSupply` returns hardcoded 1B for both CRIME and FRAUD. Any MCAP or price calculation using this stale value will be incorrect on first render. -- `app/hooks/useTokenSupply.ts:19-22`

## Critical Mechanisms

- **Swap Routing Engine** (`route-engine.ts`): Pure-function path enumeration over a static 4-token graph (SOL, CRIME, FRAUD, PROFIT). Enumerates single-hop and 2-hop paths, quotes each via BigInt quote-engine, ranks by output. No cycle detection needed (topology is acyclic given the static graph). Split routing via `split-router.ts` uses 1% granularity grid search.
- **Quote Engine** (`quote-engine.ts`): Mirrors on-chain AMM math using BigInt. Buy path: tax -> LP fee -> AMM. Sell path: LP fee -> AMM -> tax. Vault conversion: fixed 100:1 rate. Forward + reverse quote functions. All internal arithmetic is BigInt; conversion to Number happens only at output boundary.
- **Atomic Multi-Hop Builder** (`multi-hop-builder.ts`): Combines all route steps into a single v0 VersionedTransaction with ALT. Strips per-step ComputeBudget, makes ATA creation idempotent, removes intermediate WSOL unwraps. Single signature prompt, atomic execution.
- **Staking Reward Calculation** (`rewards.ts`): Synthetix-style cumulative reward-per-token using BigInt. Mirrors on-chain `update_rewards()`. `calculatePendingRewards()` returns Number (individual rewards safely within MAX_SAFE_INTEGER per documented reasoning).
- **Protocol State Pipeline**: SSE-based push from server (ws-subscriber -> protocolStore -> sseManager -> browser). Dedup via JSON serialization comparison. Polling fallback after 30s of SSE downtime. All downstream hooks (useEpochState, usePoolPrices, useCurveState, useCarnageData) derive from useProtocolState.

## Invariants & Assumptions

- INVARIANT: All financial arithmetic in quote-engine uses BigInt (no Number intermediates for core math) -- enforced at `app/lib/swap/quote-engine.ts:26` (BPS_DENOMINATOR = 10_000n)
- INVARIANT: Token pair validation uses VALID_PAIRS allowlist before any swap -- enforced at `app/hooks/useSwap.ts:256-257` and `app/hooks/useSwap.ts:273-274`
- INVARIANT: minimumOutput is always set before on-chain submission -- enforced at `app/lib/swap/route-engine.ts:368-369` (BigInt floor), `app/hooks/useSwap.ts:418`, `app/hooks/useSwap.ts:447`
- INVARIANT: Vault conversion is deterministic 100:1 with zero fee/slippage -- enforced at `app/lib/swap/quote-engine.ts:261-264`
- INVARIANT: Slippage setting is bounded 0-10000 BPS by SettingsProvider validation -- enforced at `app/providers/SettingsProvider.tsx:194-198`
- ASSUMPTION: Pool reserves from SSE are fresh enough for accurate quoting -- PARTIALLY VALIDATED (30s auto-refresh + SSE push, but gap exists between quote and execution)
- ASSUMPTION: Individual staking rewards fit within Number.MAX_SAFE_INTEGER -- VALIDATED (documented reasoning: single staker cannot accumulate total SOL supply) at `app/lib/staking/rewards.ts:80-83`
- ASSUMPTION: CarnageFundState lifetime aggregates fit within Number -- NOT VALIDATED (protocol could theoretically exceed 2^53 lamports in lifetime)
- ASSUMPTION: Route graph is acyclic and complete -- VALIDATED (static 4-node graph at `app/lib/swap/route-engine.ts:72-89`, manually inspected)

## Risk Observations (Prioritized)

1. **Default 500 BPS slippage (H015)**: `app/providers/SettingsProvider.tsx:170` -- 5% default leaves significant MEV extraction window. Users who don't change settings lose up to 5% per swap. Impact: financial loss for uninformed users. RECHECK from Audit #1, still NOT_FIXED.
2. **Quote-to-execution gap**: `app/hooks/useSwap.ts` -- Between quote display and transaction signing/landing, pool reserves can change. The minimumOutput floor is the sole protection. With 5% default slippage, the gap is wide. Impact: compounding with #1 above.
3. **Swap double-execution risk**: `app/hooks/useSwap.ts:690` -- No atomic lock prevents concurrent execution. Race between status check and status set. Impact: user could accidentally submit two identical swap TXs.
4. **parseFloat precision in toBaseUnits**: `app/hooks/useSwap.ts:303-304` -- `parseFloat(amount) * 10^decimals` can produce off-by-one in lamports. Impact: 1 lamport difference, low severity, but violates first-principles correctness.
5. **Mixed-denomination fee display**: `app/hooks/useSwap.ts:448-449` -- Sell path fee percentage adds SOL-denominated tax rate to token-denominated LP fee rate. Impact: incorrect UI display, user confusion, no fund loss.

## Novel Attack Surface

- **Split route output manipulation via asymmetric pool imbalancing**: An attacker could deliberately imbalance one pool (e.g., CRIME/SOL) to force the split-router to route disproportionately through the other pool (FRAUD/SOL), then sandwich that concentrated flow. The 1% granularity grid search in split-router responds predictably to reserve ratios.
- **SSE event injection via dedup bypass**: If an attacker could cause the protocol store to receive the same account data with different JSON key ordering (e.g., by manipulating the Anchor decode output path), the string-equality dedup would fail and redundant SSE broadcasts would be sent, potentially causing UI flicker or resource exhaustion.

## Cross-Focus Handoffs

- **-> LOGIC-02 (Financial & Economic Logic)**: The `calculateRewardRate` function in `rewards.ts:145` uses `Number` division for APR calculation with floating-point intermediate values. The `totalStakedProfit = totalStakedBaseUnits / 10 ** PROFIT_DECIMALS` at line 145 can lose precision for large staked amounts. Needs LOGIC-02 financial arithmetic review.
- **-> CHAIN-05 (MEV & Ordering)**: Default 500 BPS slippage (H015) directly impacts MEV extraction viability. Combined with `skipPreflight: true` on v0 transactions, sandwich attack surface is wide. Needs MEV-specific analysis.
- **-> ERR-02 (Race Conditions)**: Swap state machine transitions in useSwap and useStaking lack atomic guards. `setStatus` calls in execute functions can race with React state batching. Needs concurrency analysis.
- **-> FE-01 (Client State)**: SettingsProvider persists slippage to localStorage without integrity checking. A malicious browser extension could set slippage to 10000 BPS (100%), effectively making the user's minimumOutput = 0 on every swap.

## Trust Boundaries

The business logic layer sits between user input (untrusted) and on-chain program enforcement (trusted). The critical trust boundary is the `minimumOutput` value passed to on-chain programs -- this is the user's sole protection against unfavorable execution. The off-chain quote engine computes this value from potentially stale pool reserves, user-configurable slippage (0-10000 BPS), and BigInt arithmetic that matches on-chain math. On-chain programs enforce minimumOutput regardless of the off-chain quote, providing the security backstop. The protocol store and SSE pipeline form an internal trust boundary between server-side data (Helius webhook, RPC polling) and client-side display. Data corruption in this pipeline affects user perception (incorrect quotes, stale reserves) but cannot directly cause fund loss because on-chain enforcement is independent.
<!-- CONDENSED_SUMMARY_END -->

---

# Business Logic & Workflow Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain business logic is architecturally sound: a pure-function routing engine, BigInt arithmetic matching on-chain math, atomic multi-hop transaction building, and an SSE-based real-time state pipeline. The most significant business logic concern is the 500 BPS (5%) default slippage setting (H015 from Audit #1, still not fixed), which creates a wide MEV extraction window for uninformed users. The second concern is the absence of an atomic execution lock on the swap/staking hooks, creating a theoretical double-submission risk. Financial arithmetic uses BigInt throughout the critical path (quote-engine), though Number conversions at display boundaries introduce minor precision concerns.

## Scope

**Analyzed:** 22 files covering the complete swap lifecycle (quote -> route -> build -> sign -> send -> confirm), staking lifecycle (stake/unstake/claim), protocol state pipeline (SSE -> hooks), settings management, and cluster configuration. All files are off-chain TypeScript (React hooks, pure libraries, providers, E2E scripts).

**Out of scope:** On-chain Anchor/Rust programs in `programs/`. Noted that the SOS architecture doc covers on-chain invariants.

## Key Mechanisms

### 1. Swap Routing Engine

**Files:** `app/lib/swap/route-engine.ts`, `app/lib/swap/quote-engine.ts`, `app/lib/swap/split-router.ts`, `app/hooks/useRoutes.ts`

The routing engine is a pure-function module with no side effects:

1. **Path Enumeration** (`route-engine.ts:121-152`): Uses a static adjacency list (`ROUTE_GRAPH`) representing 4 tokens and their connections. Enumerates all single-hop (direct edge) and 2-hop (intermediate node) paths. The graph has no cycles by construction (SOL connects to CRIME/FRAUD; they connect to PROFIT via vault; PROFIT connects back to CRIME/FRAUD). No 3+ hop paths are enumerated (topology constraint).

2. **Step Quoting** (`route-engine.ts:189-298`): Each path edge is quoted via the appropriate quote-engine function. BigInt arithmetic is used internally; conversion to Number happens at the RouteStep boundary. Each step result carries `outputAmountBigInt` for lossless chaining to the next step.

3. **Route Assembly** (`route-engine.ts:318-386`): Steps are chained with BigInt intermediates. Final minimumOutput is computed as `finalOutputBI * (10_000 - slippageBps) / 10_000n`. Total fee percentage uses BPS summation (denomination-independent) -- correct for cross-token routes.

4. **Split Router** (`split-router.ts:76-146`): Grid search at 1% granularity (99 iterations). Recommends split only if improvement >= 50 BPS over best single path. Pure function taking quoter callbacks. The grid search is deterministic and O(n) where n=99, completing in microseconds.

5. **useRoutes Hook** (`useRoutes.ts:385-626`): Wraps the pure engine with React state management. 300ms debounce, 30s auto-refresh, anti-flicker selection (keeps current route if new best is within 10 BPS). Constructs quoter callbacks for split routes by chaining quote-engine primitives.

**Observations:**
- The route graph at `route-engine.ts:72-89` is **hardcoded**. Adding a new pool requires code changes. This is a design choice documented in the `buildRouteGraph()` function.
- Price impact accumulation is additive (`sum + s.priceImpactBps`), not multiplicative. This underreports impact for large multi-hop swaps (H072 from Audit #1, documented as display-only, conservative).
- The `totalFeePct` uses BPS summation across steps. For multi-hop routes, this sums LP fee BPS and tax BPS from each step. This is a reasonable approximation but slightly overstates total fee for routes where fees compound (e.g., 1% + 1% = 2% displayed, but actual is ~1.99%).

### 2. Quote Engine

**File:** `app/lib/swap/quote-engine.ts`

Pure BigInt arithmetic mirroring on-chain math:

- **SOL Buy**: tax(input) -> LP fee -> AMM constant-product
- **SOL Sell**: LP fee(token input) -> AMM -> tax(SOL output)
- **Vault Convert**: deterministic multiply or divide by 100

All operations use `bigint` type. Division truncates by default (matching Rust integer division). Reverse quote functions use ceiling division pattern `(a + b - 1n) / b` for safe rounding.

**Observations:**
- `calculateTax` at line 78 uses floor division (`amount * taxBps / 10000n`). The on-chain version in `tax_math.rs` should match (verified per Architecture doc). If on-chain uses ceiling, off-chain quotes would be optimistic by up to 1 lamport.
- `quoteVaultConvert` at line 261 checks `inputAmount <= 0n` and returns zero, preventing negative amount processing. Good.
- `reverseQuoteSolBuy` at line 308 checks `desiredOutputTokens >= reserveToken` and returns null. This prevents impossible quotes.

### 3. Transaction Builders

**Files:** `app/lib/swap/swap-builders.ts`, `app/lib/swap/multi-hop-builder.ts`

**swap-builders.ts**: Three builder functions (SolBuy, SolSell, VaultConvert). Each:
1. Sets compute budget
2. Creates/checks required ATAs
3. Resolves Transfer Hook remaining_accounts via deterministic PDA derivation
4. Builds the Anchor instruction with `.accountsStrict()` (all accounts explicitly named)

**multi-hop-builder.ts**: Combines multiple step transactions into one atomic v0 transaction:
1. Builds each step as a legacy Transaction (reuses swap-builders)
2. Strips per-step ComputeBudget, sums CU limits
3. Makes ATA creation idempotent (Create -> CreateIdempotent)
4. Removes intermediate WSOL closeAccount instructions (keeps only last)
5. Compiles to v0 MessageV0 with protocol ALT for account compression

**Observations:**
- The `buildStepTransaction` function at `multi-hop-builder.ts:98-149` determines swap type by checking pool label suffixes (`endsWith("/SOL")`, `includes("Vault")`). This is string-based dispatch. If pool labels change or a new pool type is added, this logic silently fails to match and throws "Unknown pool type".
- ALT is module-level cached (`cachedALT` at line 261). No cache invalidation mechanism. If the ALT is extended with new addresses after initial fetch, the stale cache would miss them. Per Audit #1 H064, this is self-healing (rebuild recreates).
- The `processInstructionsForAtomic` function at line 177 correctly handles the intermediate WSOL closeAccount removal for split sell routes. This prevents the first leg from destroying the WSOL ATA needed by the second leg.

### 4. useSwap Hook (Main Orchestrator)

**File:** `app/hooks/useSwap.ts` (954 LOC)

State machine: idle -> building -> signing -> confirming -> confirmed/failed

**Critical observations:**

1. **No execution lock** (line 690-698): The `executeSwap` callback checks `!wallet.publicKey || !wallet.connected || !quote` but not `status !== 'idle'`. A rapid double-click could trigger two executions. The `clearTerminalStatus` callback (line 219) clears confirmed/failed but doesn't prevent concurrent building/signing. The `executeRoute` callback at line 839 has the same issue.

2. **toBaseUnits precision** (line 301-307): Uses `parseFloat(amount) * 10^decimals` then `Math.floor()`. For SOL (9 decimals), `parseFloat("0.123456789") * 1e9` may not produce exactly 123456789 due to IEEE 754. The floor operation compensates for most cases but could be off by 1 lamport.

3. **Sell fee percentage** (line 448-449): `(taxAmount / grossSolOutput) * 100 + (lpFee / baseUnits) * 100` mixes SOL-denominated and token-denominated rates. For route-engine computed routes (smart routing ON), this path is bypassed in favor of BPS-based totalFeePct.

4. **Static priority fee map** (line 101-107): `PRIORITY_FEE_MAP` uses static values (1K/10K/100K/1M micro-lamports) but `SettingsProvider` has a dynamic `getRecommendedFee()` that calls Helius. The useSwap hook uses the static map, not the dynamic fetcher. This means the priority fee tiers displayed to users may not match actual network conditions.

### 5. Staking Lifecycle

**Files:** `app/hooks/useStaking.ts`, `app/lib/staking/rewards.ts`

State machine: idle -> building -> signing -> confirming -> confirmed/failed (same pattern as swap)

**Reward calculation** (`rewards.ts:64-84`): Uses BigInt throughout. Converts final result to Number with documented safety reasoning (individual staker rewards << MAX_SAFE_INTEGER). The `PRECISION = 1e18` BigInt constant matches on-chain.

**Minimum stake warning** (`useStaking.ts:448-461`): Correctly warns when partial unstake would leave balance between 0 and MINIMUM_STAKE. Logic is sound.

**Observations:**
- `calculateRewardRate` at `rewards.ts:145` uses `Number` division: `totalStakedBaseUnits / 10 ** PROFIT_DECIMALS`. For 20M PROFIT supply with 6 decimals, max base units = 20_000_000_000_000 which is well within Number range. However, this is marked as dead code (APR not displayed, legal reasons).
- Same execution lock concern as useSwap -- no mutex on the `execute` callback.

### 6. Protocol State Pipeline

**Files:** `app/lib/protocol-store.ts`, `app/lib/sse-manager.ts`, `app/hooks/useProtocolState.ts`, `app/lib/bigint-json.ts`

**Data flow:** ws-subscriber -> protocolStore.setAccountState() -> sseManager.broadcast() -> EventSource -> useProtocolState hook -> downstream hooks

**Key patterns:**
- **Dedup guard** (`protocol-store.ts:54-59`): Compares JSON.stringify output to last broadcast. Prevents redundant SSE pushes.
- **BigInt serialization** (`bigint-json.ts`): Tagged object format `{ __bigint: "value" }` for round-tripping BigInt through JSON.
- **SSE with reconnect** (`useProtocolState.ts:243-306`): Exponential backoff (1s -> 30s max). Polling fallback after 30s of SSE downtime.
- **Visibility gating** (`useProtocolState.ts:349-362`): Closes SSE when tab is hidden, reconnects on return.

**Observations:**
- `anchorToJson` (`bigint-json.ts:93-117`) is a shallow conversion. Nested objects (like enum variants `{ active: {} }`) pass through unchanged. This is correct for current Anchor account structures but could break if a nested field contains a BN.
- The polling fallback in `useProtocolState.ts:187-216` fetches raw account info (`getMultipleAccountsInfo`) but stores only metadata (`lamports`, `owner`, `dataLength`), not decoded account data. This means the polling fallback provides degraded data (no reserves, no tax rates) compared to SSE. Downstream hooks that check for specific fields (e.g., `typeof sseData.currentEpoch !== "number"`) will see `null` during polling fallback.

### 7. Cluster Configuration

**Files:** `app/lib/protocol-config.ts`, `app/providers/ClusterConfigProvider.tsx`

Both resolve cluster from `NEXT_PUBLIC_CLUSTER` env var with devnet default. The `protocol-config.ts` is used by server-side code and libraries; `ClusterConfigProvider.tsx` provides React context.

**Observation:** Two parallel resolution paths (module-level `protocol-config.ts` and React context `ClusterConfigProvider.tsx`) could theoretically diverge if the env var changes between SSR and CSR, but this is prevented by Next.js's build-time inlining of `NEXT_PUBLIC_*` vars.

### 8. Settings Management

**File:** `app/providers/SettingsProvider.tsx`

- Slippage: 0-10000 BPS, default 500 BPS (5%)
- Priority fee: none/low/medium/high/turbo, default medium
- Persists to localStorage synchronously in state setter callback

**Critical observation:** Default slippage of 500 BPS (H015). This was flagged as HIGH in Audit #1 and remains NOT_FIXED. A 5% slippage tolerance is the primary MEV extraction surface for this protocol.

## Trust Model

| Trust Zone | Components | Trust Level |
|---|---|---|
| User input | Amount strings, token selection, slippage setting | **Untrusted** -- validated via parseFloat, VALID_PAIRS, BPS range check |
| Quote engine | BigInt math, pool reserves, tax rates | **Trusted** -- pure functions, no external deps |
| SSE pipeline | protocolStore, sseManager, useProtocolState | **Semi-trusted** -- data from Helius webhooks (authenticated) or RPC (trusted connection) |
| On-chain enforcement | minimumOutput, account constraints, PDA verification | **Trusted** -- cryptographically enforced |

The key trust boundary is the `minimumOutput` value. Off-chain code computes it from:
1. Quote engine output (trusted math on potentially stale reserves)
2. User slippage setting (user-controlled, 0-10000 BPS)
3. BigInt floor division (deterministic)

If the off-chain quote overestimates output (stale/manipulated reserves), the user still gets the on-chain minimumOutput guarantee. If slippage is too high, the user loses the difference to MEV.

## State Analysis

### In-Memory State (Server)
- **protocolStore** (`protocol-store.ts`): `Map<string, AccountState>` + `Map<string, string>` (dedup). Survives HMR via globalThis. No persistence -- lost on process restart. Re-seeded on boot by ws-subscriber.
- **sseManager** (`sse-manager.ts`): `Set<SSECallback>`. Survives HMR via globalThis.

### Client-Side State (Browser)
- **localStorage** (`SettingsProvider`): Settings JSON (slippage, priority, mute, volume). Validated on load. No integrity protection.
- **React state**: All hooks manage their state via useState/useRef. No cross-tab synchronization.
- **Module cache**: `cachedALT` in multi-hop-builder.ts persists across renders.

### Database
- Not directly accessed by business logic layer. Candle data written by webhook handler (separate concern).

## Dependencies

| Dependency | Purpose | Trust |
|---|---|---|
| `@solana/web3.js` | Transaction construction, RPC, PublicKey | High (official SDK) |
| `@coral-xyz/anchor` | IDL-based instruction building | High (official framework) |
| `@solana/spl-token` | Token account operations | High (official SDK) |
| `@dr-fraudsworth/shared` | Cluster configs, seeds, constants | Internal (workspace package) |
| `Helius RPC/Webhooks` | Data source for pool reserves, epoch state | Medium (trusted provider, but external) |

## Focus-Specific Analysis

### State Machine Analysis

**useSwap lifecycle:**
```
idle -> [user clicks Swap]
  -> building (construct TX)
  -> signing (wallet prompt)
  -> confirming (poll confirmation)
  -> confirmed / failed
  -> [10s auto-reset] -> idle
```

**Gap:** No explicit transition validation. The `executeSwap` function does not check `status === 'idle'` before proceeding. It checks wallet connection and quote existence, but a concurrent call while status is "building" would create a second transaction build attempt. The status is set to "building" via `setStatus("building")` which is a React state update (async/batched), not a synchronous lock.

**useStaking lifecycle:** Same pattern, same gap.

**useCurveState:** No state machine per se -- read-only data hook. SSE data arrives and is extracted; refresh() provides one-shot RPC override. The `rpcCrime`/`rpcFraud` override state clears when SSE delivers newer data (lines 211-215), which is correct.

### Business Rule Enforcement

1. **VALID_PAIRS validation** (`useSwap.ts:256-284`): Enforced client-side. On-chain programs also validate accounts (e.g., pool PDA seeds include mint addresses), so an invalid pair would fail on-chain even if the client check were bypassed.

2. **Slippage bounds** (`SettingsProvider.tsx:194-198`): Range 0-10000 BPS. Invalid localStorage values fall back to default. Not enforced on-chain (the program accepts any minimumOutput, including 0).

3. **Amount validation** (`useSwap.ts:400-401, useStaking.ts:510-515`): `baseUnits <= 0` returns early. On-chain programs also check for zero amounts.

4. **Minimum stake** (`useStaking.ts:448-461`): Client-side warning only. On-chain staking program enforces MINIMUM_STAKE.

### Order of Operations Analysis

**SOL Buy**: tax -> LP fee -> AMM (quote-engine.ts:164-178)
**SOL Sell**: LP fee -> AMM -> tax (quote-engine.ts:217-231)

These match the on-chain order as documented in the SOS Architecture doc (Section 3, Tax Program instructions). The off-chain quote engine mirrors these exactly.

**Vault conversion**: Single-step multiply or divide. No ordering concerns.

**Multi-hop atomic**: All steps in one transaction. On-chain execution order is guaranteed by Solana's sequential instruction processing within a transaction. The multi-hop builder correctly chains step outputs as inputs to the next step.

## Cross-Focus Intersections

- **CHAIN-05 (MEV)**: The 500 BPS default slippage directly impacts sandwich attack profitability. Combined with `skipPreflight: true` on v0 transactions (multi-hop-builder.ts:381), transactions enter the mempool visible to MEV bots.
- **ERR-02 (Race Conditions)**: Swap/staking execution lacks atomic locks. React state batching may interleave status checks and updates.
- **DATA-01 (Data Persistence)**: Protocol store is in-memory only. Process restart loses all cached state until ws-subscriber re-seeds. During this window, quotes may be stale or unavailable.
- **LOGIC-02 (Financial Logic)**: Rewards calculation, fee display, and price impact computations overlap. The `calculateRewardRate` uses Number arithmetic for display.
- **CHAIN-04 (State Sync)**: Pool reserve staleness directly affects quote accuracy. SSE pipeline latency determines how stale quotes can be.

## Cross-Reference Handoffs

1. **-> LOGIC-02**: Review `rewards.ts:145` floating-point division for precision concerns. Review `useCarnageData.ts:51-55` Number casting for overflow risk on large lifetime aggregates.
2. **-> CHAIN-05**: Analyze MEV extraction surface given 500 BPS default slippage + v0 TX + skipPreflight.
3. **-> ERR-02**: Analyze race conditions in useSwap/useStaking execute callbacks. Check React state batching behavior under concurrent calls.
4. **-> FE-01**: Review localStorage integrity for slippage settings. A browser extension could set adversarial values.
5. **-> CHAIN-04**: Verify SSE pipeline latency bounds and their impact on quote freshness.

## Risk Observations

### HIGH

1. **H015 Default Slippage 500 BPS (RECHECK: STILL NOT FIXED)**
   - File: `app/providers/SettingsProvider.tsx:170`
   - Impact: Every user who doesn't customize slippage loses up to 5% per swap to MEV
   - Recommendation: Lower default to 100-200 BPS. Add slippage warning UI for values above 300 BPS.

2. **Quote-to-Execution Staleness Window**
   - Files: `app/hooks/useRoutes.ts`, `app/hooks/useSwap.ts`
   - Impact: Reserves can change between quote display and transaction landing. Combined with high default slippage, this creates predictable MEV extraction.
   - Recommendation: Refresh quote immediately before building transaction (not just on 30s timer). Consider just-in-time quote refresh in executeSwap/executeRoute.

3. **No Execution Mutex on Swap/Staking**
   - Files: `app/hooks/useSwap.ts:690`, `app/hooks/useStaking.ts:492`
   - Impact: Double-click or rapid re-render could submit duplicate transactions
   - Recommendation: Add `if (status !== 'idle') return` guard at top of execute callbacks. Consider useRef-based lock.

### MEDIUM

4. **Number Conversion at Split Route Boundary**
   - File: `app/hooks/useRoutes.ts:140-172`
   - Impact: If total split output exceeds 2^53, silent precision loss. Unlikely at current token supplies but not explicitly bounded.

5. **Sell Fee Display Mixes Denominations**
   - File: `app/hooks/useSwap.ts:448-449`
   - Impact: Incorrect fee percentage shown to users on sell transactions (display-only, no fund loss)

6. **Polling Fallback Provides Degraded Data**
   - File: `app/hooks/useProtocolState.ts:187-216`
   - Impact: During SSE downtime, downstream hooks receive metadata instead of decoded account data. Quotes and displays will be stale/empty.

7. **Static Priority Fee Map vs Dynamic Fetcher**
   - File: `app/hooks/useSwap.ts:101-107`
   - Impact: Users see "medium = 10K micro-lamports" regardless of actual network conditions. SettingsProvider has dynamic Helius integration that isn't used by useSwap.

8. **parseFloat Precision in toBaseUnits**
   - File: `app/hooks/useSwap.ts:301-307`
   - Impact: Off-by-one lamport in rare cases. No fund loss (on-chain enforces minimumOutput) but violates correctness.

### LOW

9. **Additive Price Impact (H072)**
   - File: `app/lib/swap/route-engine.ts:351-354`
   - Impact: Underreports multi-hop price impact. Display-only, conservative direction.

10. **Token Supply Fallback**
    - File: `app/hooks/useTokenSupply.ts:19-22`
    - Impact: MCAP calculations incorrect on first render before SSE snapshot arrives.

11. **Protocol Store Dedup Key Ordering Sensitivity**
    - File: `app/lib/protocol-store.ts:54-59`
    - Impact: Different key ordering in Anchor decode output could bypass dedup. Theoretical concern.

12. **anchorToJson Shallow Conversion**
    - File: `app/lib/bigint-json.ts:93-117`
    - Impact: Nested BN objects would not be converted. Not currently exploitable with current account structures.

13. **CarnageData Number Overflow for Lifetime Aggregates**
    - File: `app/hooks/useCarnageData.ts:51-55`
    - Impact: Display corruption if protocol processes >2^53 lamports lifetime. Extremely unlikely.

14. **ALT Cache No Invalidation**
    - File: `app/lib/swap/multi-hop-builder.ts:261-277`
    - Impact: Stale ALT after extension. Self-healing on page reload.

## Novel Attack Surface Observations

1. **Asymmetric Pool Imbalancing for Split Route Manipulation**: The split router's grid search at 1% granularity means an attacker can predict the split ratio from known reserves. By temporarily imbalancing one pool (e.g., large sell on CRIME/SOL), the attacker forces the split router to concentrate a victim's PROFIT->SOL trade through FRAUD/SOL, then sandwiches that concentrated flow. The 50 BPS threshold for split recommendation means the attacker only needs to create a ~0.5% imbalance to eliminate the split recommendation entirely, concentrating all flow through one pool.

2. **Settings Injection via localStorage**: An adversarial browser extension or XSS (if CSP is bypassed) could set `dr-fraudsworth-settings` in localStorage to `{"slippageBps": 10000}`, making every subsequent swap use 100% slippage (minimumOutput = 0). The SettingsProvider validates bounds (0-10000) but 10000 is within the valid range. Combined with the current 10000 BPS upper bound, this is a complete MEV extraction vector.

## Questions for Other Focus Areas

- **For LOGIC-02**: Does the on-chain tax calculation use ceiling or floor division? The off-chain mirror uses floor (`amount * taxBps / 10_000n`). If on-chain uses ceiling, the off-chain quote is optimistic by up to 1 unit.
- **For CHAIN-05**: Is there any transaction ordering protection (e.g., Jito bundle support) planned? The codebase mentions H015 (MEV protection) as NOT_FIXED.
- **For ERR-02**: What is the actual behavior of React 18's batched state updates when `setStatus("building")` is called inside a `useCallback` that is triggered by a button click? Can two clicks in rapid succession both see `status === "idle"`?
- **For FE-01**: Is there any Content Security Policy or integrity checking on localStorage values? Could a malicious extension modify slippage?

## Raw Notes

- `VALID_PAIRS` imported from `@dr-fraudsworth/shared` -- need to verify this allowlist matches the protocol's actual supported pairs. Not checked in this audit (out of scope for off-chain).
- The `buildSplitRoute` function at `useRoutes.ts:133-193` uses `number` arithmetic for split amounts (`Math.floor(totalInput * splitRatioA / 100)`). This is safe for current reserves (token amounts < 1B * 1e6 = 1e15 < 2^53) but would need BigInt if token supplies or decimals increase.
- `ComputeBudgetProgram.setComputeUnitLimit` in `multi-hop-builder.ts:245` sums CU limits from all steps. For a 4-step split route with 200K + 250K + 200K + 200K = 850K CU, this exceeds the Solana per-TX limit of 1.4M CU. Safe for current routes, but should be capped.
- The `SettingsProvider.tsx:287-305` dynamic priority fee fetcher calls `/api/rpc` which proxies to Helius. But `useSwap.ts:101-107` uses a static map. This disconnection means the dynamic fee infrastructure built in SettingsProvider is unused by the actual swap execution.
- The `quote-engine.ts` reverse functions all use ceiling division for conservative input estimates. This means the user will never be asked for less than needed -- good pattern.
