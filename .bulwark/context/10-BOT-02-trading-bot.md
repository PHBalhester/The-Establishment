---
task_id: db-phase1-bot-02
provides: [bot-02-findings, bot-02-invariants]
focus_area: bot-02
files_analyzed:
  - app/hooks/useSwap.ts
  - app/hooks/useRoutes.ts
  - app/hooks/usePoolPrices.ts
  - app/lib/swap/route-engine.ts
  - app/lib/swap/swap-builders.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/swap/hook-resolver.ts
  - app/lib/swap/quote-engine.ts
  - app/lib/confirm-transaction.ts
  - app/app/api/sol-price/route.ts
  - app/providers/SettingsProvider.tsx
  - scripts/crank/crank-runner.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Trading & DeFi Bot Security (BOT-02) -- Condensed Summary

## Key Findings (Top 10)

1. **No MEV protection for user swaps on mainnet**: Zero Jito/Nozomi integration anywhere in the swap pipeline. All swaps submitted via standard RPC are visible in the mempool and sandwichable. -- `app/hooks/useSwap.ts:763-766`, `app/lib/swap/multi-hop-builder.ts:378-381`
2. **Default slippage 500 BPS (5%) is a sandwich attack magnet**: SettingsProvider defaults to 500 bps. Most users never change defaults. Combined with no MEV protection, every default swap donates up to 5% to sandwich bots. -- `app/providers/SettingsProvider.tsx:39,170`
3. **skipPreflight=true on multi-hop atomic routes**: Multi-hop v0 transactions bypass simulation entirely (needed for devnet blockhash bug). On mainnet, this removes a safety net -- malformed or manipulated instructions land without preflight rejection. -- `app/lib/swap/multi-hop-builder.ts:381`
4. **No maximum trade size enforcement**: User can enter any amount up to their full wallet balance. No per-swap cap, no price-impact-based rejection threshold, no warning for large swaps relative to pool liquidity. -- `app/hooks/useSwap.ts:301-309`
5. **SOL price feed staleness: 60s cache with stale fallback**: `/api/sol-price` caches for 60s and returns arbitrarily stale data if both providers fail. No staleness age limit on the fallback. -- `app/app/api/sol-price/route.ts:96,115-123`
6. **Quote-to-execution race (stale quotes used at execution time)**: Quotes are computed when user types, but pool reserves can change before the user clicks "Swap". The `minimumOutput` from the stale quote is sent on-chain, which protects against total loss but may be significantly below current-market fair price. -- `app/hooks/useSwap.ts:690-808`
7. **Crank Carnage swap has no user-accessible MEV protection**: Crank runner bundles VRF atomically (CARN-002 fix) but uses standard sendTransaction. An adversary monitoring the crank wallet could sandwich the Carnage buyback. -- `scripts/crank/crank-runner.ts:16-17`
8. **No price-impact warning or rejection in UI**: Route engine computes `priceImpactBps` but the UI has no threshold that warns users or blocks swaps with extreme impact (>5%). Users can silently execute 50%+ impact swaps. -- `app/lib/swap/route-engine.ts:351-354`
9. **toBaseUnits uses Math.floor(parseFloat * 10^decimals) -- potential rounding drift**: For amounts near the representable boundary, `parseFloat` then multiply then floor can lose sub-unit precision. BigInt conversion happens later but the initial parseFloat is lossy. -- `app/hooks/useSwap.ts:301-309`
10. **Reserve data from SSE has no freshness indicator**: usePoolPrices reads from the SSE protocol state stream but exposes no timestamp or slot number. Quotes computed against these reserves have no way to detect if the data is seconds or minutes old. -- `app/hooks/usePoolPrices.ts:55-104`

## Critical Mechanisms

- **Swap execution flow**: User enters amount -> `computeQuote()` (300ms debounced) -> `executeSwap()`/`executeRoute()` -> build TX -> sign -> send -> confirm. Quote is computed using SSE-fed reserves; execution uses the same quote's `minimumOutput`. On-chain enforces `minimumOutput` via the Tax Program. -- `app/hooks/useSwap.ts`
- **Route engine**: Pure-function path enumeration across 2 AMM pools + 2 vault conversions. All arithmetic in BigInt. Returns routes ranked by output. Split routing for SOL<->PROFIT paths. -- `app/lib/swap/route-engine.ts`
- **Multi-hop atomic builder**: Combines N step transactions into single v0 VersionedTransaction with ALT. Strips duplicate compute budget and ATA creation. Uses `skipPreflight:true`. -- `app/lib/swap/multi-hop-builder.ts`
- **Slippage model**: User-configurable via SettingsProvider (default 500 bps). Applied as `minimumOutput = floor(output * (10000 - slippageBps) / 10000)`. On-chain 50% floor is a backstop. -- `app/hooks/useSwap.ts:418`, `app/providers/SettingsProvider.tsx:170`
- **Crank circuit breaker**: 5 consecutive errors -> halt. 0.5 SOL hourly spending cap. Vault top-up capped at 0.1 SOL. SIGINT graceful shutdown. -- `scripts/crank/crank-runner.ts:84-150`

## Invariants & Assumptions

- INVARIANT: On-chain enforces `minimumOutput >= 50% of gross output` (50% slippage floor) -- enforced on-chain in Tax Program, NOT enforced in off-chain quote engine
- INVARIANT: Quote engine BigInt arithmetic mirrors on-chain Rust integer division -- enforced at `app/lib/swap/quote-engine.ts:42-80` via BigInt truncation matching Rust floor
- INVARIANT: Slippage BPS is bounded 0-10000 in SettingsProvider -- enforced at `app/providers/SettingsProvider.tsx:196-198` via localStorage validation
- ASSUMPTION: Pool reserves from SSE are fresh enough for accurate quoting -- UNVALIDATED: no staleness timestamp exposed by `usePoolPrices`
- ASSUMPTION: User swaps will not be sandwiched because slippage is "reasonable" -- UNVALIDATED: no MEV protection implemented
- ASSUMPTION: `parseFloat` is precise enough for amount entry -- PARTIALLY VALIDATED: BigInt used in quote-engine, but `toBaseUnits` in useSwap still uses `Math.floor(parseFloat(x) * 10^d)` which can drift for large amounts

## Risk Observations (Prioritized)

1. **H015 (NOT_FIXED): No MEV protection for mainnet swaps**: `app/hooks/useSwap.ts:763`, `app/lib/swap/multi-hop-builder.ts:381` -- All user swaps submitted via standard RPC. Sandwich attackers extract up to the full slippage tolerance on every swap. On mainnet with real money, this is the single highest-impact trading security issue. Previous audit flagged this as HIGH (H015) and it remains unfixed.
2. **Default 500 BPS slippage**: `app/providers/SettingsProvider.tsx:170` -- 5% default is higher than industry standard for a protocol with its own pools (not aggregator routing). Most comparable protocols default to 50-100 bps. Combined with no MEV protection, this makes every default swap a profitable sandwich target.
3. **skipPreflight on v0 multi-hop routes**: `app/lib/swap/multi-hop-builder.ts:381` -- Comment says this is for devnet blockhash bug. If carried to mainnet, removes the simulation safety net. Mainnet should use `skipPreflight: false`.
4. **No trade size cap or price impact rejection**: `app/hooks/useSwap.ts:301-309`, `app/lib/swap/route-engine.ts` -- A user (or malicious script injecting into the swap hook) could execute a swap consuming the entire pool's liquidity. No off-chain guard exists; on-chain 50% floor is the only backstop.
5. **SOL price stale fallback with no max age**: `app/app/api/sol-price/route.ts:115-123` -- If both CoinGecko and Binance fail, the API returns the last cached price regardless of age. A price cached 24h ago would be served. This data is used for MCAP display (display-only, not trading decisions), so impact is limited.

## Novel Attack Surface

- **Cross-epoch tax rate sniping via SSE timing**: The SSE pipeline broadcasts epoch state changes (including new tax rates after VRF) to all connected browsers. An attacker running a local SSE client could detect a favorable tax rate change (e.g., tax dropping from 14% to 1%) milliseconds before other users see it in the UI, and submit a swap at the old (or new, whichever is favorable) rate. The off-chain quote engine reads epoch state from SSE -- there is no on-chain slot binding between the quote's tax rate and the execution's tax rate. The on-chain program reads the current EpochState at execution time, so the quote's tax rate is advisory only, but the `minimumOutput` computed with the wrong tax rate could be too generous.

## Cross-Focus Handoffs

- -> **CHAIN-05 (Transaction Signing/Submission)**: `skipPreflight: true` on multi-hop v0 transactions needs mainnet review. The devnet workaround (blockhash simulation failure) should not carry to mainnet.
- -> **ERR-02 (Race Conditions)**: Quote-to-execution timing gap in `useSwap.ts` -- reserves can change between quote and execution. The `minimumOutput` is the only protection, and it is computed against potentially stale reserves.
- -> **BOT-01 (Crank/Keeper Security)**: Crank runner's Carnage buyback swap is submitted via standard RPC without Jito bundling. The atomic VRF+Carnage bundle (CARN-002) prevents front-running the Carnage trigger, but the resulting swap is still potentially sandwichable if the block producer is malicious.
- -> **LOGIC-01 (Business Logic)**: The 50% on-chain slippage floor is the ultimate backstop for all trading operations. Verify this floor is correctly implemented and cannot be bypassed.

## Trust Boundaries

The trading pipeline has three trust zones. The browser client (untrusted) controls swap parameters -- input amount, token pair, slippage tolerance -- but the on-chain programs enforce structural limits (50% output floor, minimumOutput). The off-chain quote engine is trusted to produce accurate quotes matching on-chain math, but quotes are advisory since on-chain execution uses live state. The RPC layer (Helius) is a trusted intermediary for transaction submission -- it sees all transaction content before broadcasting, making it theoretically capable of front-running, though this is mitigated by Helius's reputation. The gap between "user sees quote" and "transaction lands" is the primary attack surface: anyone who can observe or predict a user's pending swap can sandwich it through the public mempool.
<!-- CONDENSED_SUMMARY_END -->

---

# Trading & DeFi Bot Security (BOT-02) -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements a custom DeFi trading system with 2 AMM pools (CRIME/SOL, FRAUD/SOL), a vault-based conversion mechanism (faction tokens <-> PROFIT at 100:1), and a multi-hop route engine that combines these into arbitrary swap paths. The off-chain trading infrastructure is well-architected with proper BigInt arithmetic (fixing H014), atomic multi-hop execution (single v0 transaction), and a pure-function route engine with comprehensive path enumeration.

However, the system has significant trading security gaps: no MEV protection for any swap path, a high default slippage (500 bps), no maximum trade size enforcement, no price impact rejection threshold, and `skipPreflight:true` carried from devnet to what will be the mainnet multi-hop path. The crank runner has good circuit breaker and spending cap protections but its Carnage buyback swap lacks MEV protection.

The on-chain 50% output floor provides a critical backstop that prevents catastrophic losses, but the gap between the user's configured slippage (5%) and this floor represents extractable value on every swap.

## Scope

**Files analyzed in full (Layer 3):**
- `app/hooks/useSwap.ts` (954 LOC) -- Swap lifecycle orchestrator
- `app/lib/swap/route-engine.ts` (445 LOC) -- Pure-function route enumeration and quoting
- `app/lib/swap/swap-builders.ts` (507 LOC) -- Transaction construction
- `app/lib/swap/multi-hop-builder.ts` (416 LOC) -- Atomic v0 multi-hop assembly
- `app/lib/swap/quote-engine.ts` (403 LOC) -- BigInt AMM math
- `app/lib/swap/hook-resolver.ts` (79 LOC) -- Transfer hook account resolution
- `app/hooks/useRoutes.ts` (626 LOC) -- Route computation + split routing
- `app/hooks/usePoolPrices.ts` (105 LOC) -- Pool reserve data from SSE
- `app/app/api/sol-price/route.ts` (138 LOC) -- SOL/USD price proxy
- `app/providers/SettingsProvider.tsx` (324 LOC) -- Slippage/priority fee settings
- `app/lib/confirm-transaction.ts` (68 LOC) -- Polling-based TX confirmation
- `scripts/crank/crank-runner.ts` (first 200 LOC) -- Crank circuit breaker + spending cap

**Files analyzed at signature level (Layer 2):**
- `app/hooks/useCurveState.ts` -- Bonding curve state (not swap-relevant post-graduation)
- `scripts/e2e/lib/carnage-flow.ts` -- E2E carnage testing
- `app/lib/staking/rewards.ts` -- Reward calculations (not trading)

## Key Mechanisms

### 1. Swap Execution Pipeline

The swap flow is a state machine: `idle -> quoting -> building -> signing -> sending -> confirming -> confirmed/failed`.

**Quoting phase** (lines 329-537 in useSwap.ts):
- User types amount -> 300ms debounce -> `computeQuote()` runs
- For direct SOL pool swaps: reads reserves from `usePoolPrices` (SSE-fed), calls `quoteSolBuy`/`quoteSolSell` from quote-engine
- For vault conversions: deterministic 100:1 math
- For multi-hop: delegated to route-engine via `useRoutes`
- `minimumOutput = floor(output * (10000 - slippageBps) / 10000)`

**Execution phase** (lines 690-808 in useSwap.ts):
- Builds transaction via swap-builders (buy/sell/vault)
- Sets blockhash and fee payer
- Signs via wallet adapter `sendTransaction`
- Confirms via polling-based HTTP (not WebSocket)

**Critical observation:** The quote is computed at debounce time, but execution happens when the user clicks "Swap" -- potentially seconds or minutes later. Pool reserves may have changed. The `minimumOutput` protects against total loss, but may be significantly below fair market value if reserves moved unfavorably.

### 2. Quote Engine Arithmetic

All arithmetic in `quote-engine.ts` uses BigInt to match Rust integer math:
- `calculateEffectiveInput`: `amountIn * (10000 - feeBps) / 10000` (BigInt floor)
- `calculateSwapOutput`: `reserveOut * effectiveInput / (reserveIn + effectiveInput)` (constant product)
- `calculateTax`: `amountLamports * taxBps / 10000` (BigInt floor)

Order of operations:
- Buy: tax first -> LP fee -> AMM output
- Sell: LP fee first -> AMM output -> tax on output

This matches on-chain and was verified as the H014 fix.

### 3. Route Engine

Pure-function routing with static topology:
```
    SOL
   /   \
 CRIME  FRAUD    (2 AMM pools)
   \   /
   PROFIT        (2 vault conversions)
```

Path enumeration: single-hop (direct edge) + two-hop (via intermediate). No cycles possible by construction (topology constraint). Split routing for SOL<->PROFIT optimizes across both paths.

Anti-flicker: keeps current route selection if new best is within 10 bps.

### 4. Multi-Hop Atomic Assembly

`buildAtomicRoute()` combines N step transactions into one v0 VersionedTransaction:
1. Builds legacy Transaction per step (reuses swap-builders)
2. Strips per-step ComputeBudget, replaces with combined total
3. Makes ATA creation idempotent (Create -> CreateIdempotent)
4. Removes intermediate WSOL closeAccount (accumulates across legs)
5. Compiles to v0 message with protocol ALT

Uses `skipPreflight: true` with `maxRetries: 3`.

### 5. Slippage Model

- Default: 500 bps (5%) from `SettingsProvider.tsx:170`
- Validated range: 0-10000 bps (0-100%)
- On-chain backstop: 50% output floor (Tax Program rejects any swap where output < 50% of gross)
- No per-pair or dynamic slippage adjustment

### 6. Crank Trading Security

The crank runner has:
- Circuit breaker: 5 consecutive errors -> halt (`CIRCUIT_BREAKER_THRESHOLD = 5`)
- Hourly spending cap: 0.5 SOL (`MAX_HOURLY_SPEND_LAMPORTS = 500_000_000`)
- Per-top-up cap: 0.1 SOL (`MAX_TOPUP_LAMPORTS = 100_000_000`)
- Graceful shutdown on SIGINT
- Health endpoint for Railway probes

Carnage buyback is atomically bundled (VRF reveal + consume + execute in one v0 TX), closing the CARN-002 MEV gap for the trigger detection. However, the resulting swap instruction within the atomic bundle is still executed via standard `sendTransaction`.

## Trust Model

| Component | Trust Level | What It Controls | Protection |
|-----------|------------|------------------|------------|
| User input (amount, slippage) | Untrusted | Swap parameters | On-chain validation + BigInt math |
| Pool reserves (SSE) | Semi-trusted | Quote accuracy | On-chain enforces minimumOutput |
| Epoch tax state (SSE) | Semi-trusted | Tax rate in quote | On-chain reads live EpochState |
| RPC endpoint (Helius) | Trusted | TX broadcast | Reputation; no technical protection |
| Quote engine | Trusted | minimumOutput calc | Must match on-chain math exactly |
| Wallet adapter | Trusted | TX signing | User confirmation prompt |

## State Analysis

### Off-Chain State

1. **Pool reserves**: In-memory via SSE stream from `protocol-store`. No persistence. Refreshed by WebSocket slot subscription or Helius webhook.
2. **Epoch state**: Same SSE pipeline. Contains tax rates (4 values: crime/fraud buy/sell).
3. **Slippage/settings**: localStorage with per-field validation. Survives page refresh.
4. **Cached ALT**: Module-level variable in `multi-hop-builder.ts:261`. Never invalidated. If ALT is extended after caching, new addresses won't be available until page reload.
5. **SOL price cache**: Module-level in `sol-price/route.ts`. 60s TTL. Falls back to stale cache indefinitely.

### Race Conditions

- **Quote-to-execution gap**: Pool reserves can change between quote computation and TX landing. `minimumOutput` is the only protection. Time window: user reaction time (seconds) + TX confirmation time (seconds).
- **Auto-refresh every 30s**: `useRoutes` recomputes every 30 seconds. If user clicks "Swap" at second 29, the quote is 29s old.
- **Anti-flicker suppresses route switch within 10 bps**: If a new route is 9 bps better, the old (slightly worse) route stays selected. This is a UX decision, not a security issue -- the difference is negligible.

## Dependencies

### External APIs
- **CoinGecko** (SOL price): Free tier, no auth, 5s timeout
- **Binance** (SOL price fallback): Public ticker, no auth, 5s timeout
- **Helius RPC** (priority fee estimate): Via `/api/rpc` proxy

### NPM Packages (Trading-Critical)
- `@solana/web3.js`: Transaction construction, signing, sending
- `@solana/spl-token`: Token-2022 ATA resolution
- `@coral-xyz/anchor`: Program instruction building (BN type)

## Focus-Specific Analysis: Trading & DeFi Bot Security

### OC-253: Hardcoded Slippage

**Finding: Default slippage of 500 bps (5%) without per-pair differentiation.**

Location: `app/providers/SettingsProvider.tsx:170`
```typescript
slippageBps: 500,
```

The slippage is configurable by the user but defaults to 500 bps. The protocol has a fixed topology (2 AMM pools + vault), not aggregator routing. For a controlled-liquidity protocol with known pool depths, 500 bps is generous:

- CRIME/SOL and FRAUD/SOL pools seeded with 2.5 SOL + 290M tokens
- At these reserves, a 0.1 SOL swap has ~4% price impact
- 500 bps default allows MEV bots to extract up to 5% per swap

The on-chain 50% floor prevents catastrophic extraction, but the gap between 5% (user default) and 50% (on-chain floor) is exploitable.

**Previous audit status:** H015 flagged as HIGH, NOT_FIXED.

**Severity:** HIGH -- Probable exploitation on mainnet (MEV bots are automated).

### OC-258: Bot Sandwichable Transaction

**Finding: Zero MEV protection across entire swap pipeline.**

Searched for: `jito`, `Jito`, `nozomi`, `Nozomi`, `sendBundle`, `tipInstruction` -- zero results in app/ code. The only mention of MEV in the codebase is in comments about the CARN-002 fix (which bundles VRF+Carnage atomically to prevent *trigger* front-running, not swap sandwiching).

Transaction submission paths:
1. **Direct swaps**: `useSwap.ts:763` -- `wallet.sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 2 })` -- standard RPC
2. **Multi-hop**: `multi-hop-builder.ts:381` -- `wallet.sendTransaction(build.transaction, connection, { skipPreflight: true, maxRetries: 3 })` -- standard RPC, no preflight
3. **Crank Carnage**: Standard `sendAndConfirmTransaction` via crank runner

All three paths submit through the standard Helius RPC endpoint. Transactions are visible to any mempool observer.

**Impact on mainnet:** Every user swap is a sandwich target. With 5% default slippage, an MEV bot can extract up to 5% of every swap's value. For a protocol with active trading, this translates to cumulative losses equal to `5% * total_swap_volume * sandwich_success_rate`.

**Mitigation options (for project team to decide):**
- Jito bundle submission for user swaps (requires backend signing service or Jito SDK in browser)
- MEV-protected RPC endpoint (Nozomi, Helius private TX)
- Lower default slippage (50-100 bps) to reduce extractable value
- Dynamic slippage based on pool depth

**Previous audit status:** H015 flagged as HIGH, NOT_FIXED.

**Severity:** HIGH -- Systematic value extraction on mainnet.

### OC-255: No Maximum Trade Size Limit

**Finding: No per-swap size cap or price-impact rejection.**

The `useSwap.ts:301-309` `toBaseUnits` function converts any positive amount to base units without maximum:
```typescript
const toBaseUnits = useCallback(
  (amount: string, token: TokenSymbol): number => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    const decimals = getDecimals(token);
    return Math.floor(parsed * 10 ** decimals);
  },
  [getDecimals],
);
```

The route engine computes `priceImpactBps` but nothing in the execution path checks it:
- `route-engine.ts:351-354` computes aggregate price impact
- `useSwap.ts` never reads `priceImpactBps` as a gate
- `useRoutes.ts` passes it through to the UI but doesn't reject routes

A user could swap their entire SOL balance against a thin pool, suffering 40%+ price impact, with the only protection being the 50% on-chain floor.

**Impact:** User self-harm from large swaps. Also creates MEV opportunity -- a large swap with 50% impact is maximally sandwichable.

**Severity:** MEDIUM -- Requires user to enter a large amount intentionally, but no warning is shown.

### OC-254: Oracle Price Staleness

**Finding: SOL/USD price has no maximum staleness limit on fallback.**

`app/api/sol-price/route.ts:115-123`:
```typescript
if (price === null) {
  if (cachedPrice !== null) {
    return NextResponse.json({
      price: cachedPrice,
      source: cachedSource,
      cached: true,
      stale: true,
    });
  }
```

If both CoinGecko and Binance are down, the API returns whatever was last cached, even if it was hours or days ago. The `stale: true` flag is set but the consumer may not check it.

**Mitigating context:** This price is used only for MCAP display calculation (per MEMORY.md: `candle_price * (supply / 10^TOKEN_DECIMALS) * SOL_USD`). It is NOT used for any trading decision, slippage calculation, or minimumOutput computation. Those all use on-chain pool reserves directly.

**Severity:** LOW -- Display-only impact.

### skipPreflight on Multi-Hop Routes

**Finding: Multi-hop routes use `skipPreflight: true` on mainnet.**

`app/lib/swap/multi-hop-builder.ts:374-381`:
```typescript
// Uses skipPreflight because devnet simulation rejects v0 TX
// with "Blockhash not found" errors. (Per MEMORY.md v0 TX pattern.)
signature = await wallet.sendTransaction(
  build.transaction,
  connection,
  { skipPreflight: true, maxRetries: 3 },
);
```

The comment explains this is for a devnet-specific bug. On mainnet, v0 transactions should simulate correctly. `skipPreflight: true` means:
1. The RPC node does not simulate the transaction before broadcasting
2. Malformed instructions are not caught before spending gas
3. The confirmation check (`confirmation.err`) catches failures, but the user has already paid the base fee

**Direct swap path** correctly uses `skipPreflight: false` (`useSwap.ts:764`).

The risk is moderate: the TX will still fail on-chain if invalid (atomicity is preserved), but the user loses the base TX fee (~5000 lamports) and the error message may be less informative.

**Severity:** MEDIUM -- Defense-in-depth gap for mainnet. The team should add a mainnet-aware flag that switches to `skipPreflight: false`.

### Cached ALT Never Invalidated

**Finding: Protocol ALT is cached at module level and never refreshed.**

`app/lib/swap/multi-hop-builder.ts:261`:
```typescript
let cachedALT: AddressLookupTableAccount | null = null;
```

Once fetched, the ALT is never refreshed. If the protocol extends the ALT (adds new addresses), the browser client will use the stale version until page reload. This could cause transaction failures if a new address is required by a swap path.

**Severity:** LOW -- Self-healing (user refreshes page). Not a security issue, but a reliability concern.

### toBaseUnits Float Precision

**Finding: Amount conversion uses parseFloat intermediary.**

`app/hooks/useSwap.ts:301-309`:
```typescript
const parsed = parseFloat(amount);
if (isNaN(parsed) || parsed <= 0) return 0;
const decimals = getDecimals(token);
return Math.floor(parsed * 10 ** decimals);
```

For large amounts, `parseFloat("999999999.999999")` may not represent the exact value. Then `* 10 ** 6` compounds the error. The result is `Math.floor`'d, so the user gets slightly fewer base units than intended.

**Mitigating context:** The error is at most 1 base unit (1/1,000,000 of a token), and always rounds against the user (less input -> less output -> safer). The quote-engine and route-engine use BigInt once they receive the base unit value.

**Severity:** LOW -- Precision loss is sub-unit and conservative (rounds down).

### Reserve Freshness from SSE

**Finding: usePoolPrices exposes no timestamp or slot for reserve data.**

`app/hooks/usePoolPrices.ts:55-104`: The hook reads from `useProtocolState` and returns `reserveA`, `reserveB`, `loading`, and `error`. No `lastUpdateSlot` or `timestamp` field is exposed.

The quote engine and route engine use these reserves as if they are current. If the SSE connection drops and the data becomes stale, quotes will be inaccurate. The `loading` flag only indicates initial load, not staleness.

**Mitigating context:** On-chain `minimumOutput` enforcement means stale quotes cannot cause the user to receive less than their configured slippage allows. But inaccurate quotes mislead users about expected output.

**Severity:** LOW -- Display accuracy issue, not fund loss.

### Quote Race with Epoch Tax Transition

**Finding: Tax rates in quotes may not match on-chain at execution time.**

The route engine reads `epochState.crimeBuyTaxBps` etc. from the SSE feed. If VRF reveals new tax rates between quoting and execution:
- Quote computed with old tax rate (e.g., 10%)
- On-chain applies new tax rate (e.g., 2%)
- `minimumOutput` was computed with 10% tax, so the user might get MORE than expected (favorable)
- Or: quote with 2% tax, execution with 10% tax, user gets LESS but `minimumOutput` protects

This is by design (per MEMORY.md: "swaps use stale rates during VRF window" is A-10, an accepted risk). The `minimumOutput` provides protection in both directions.

**Severity:** INFORMATIONAL -- Documented design choice.

## Cross-Focus Intersections

### With CHAIN-05 (Transaction Signing/Submission)
- Multi-hop `skipPreflight: true` should be reviewed for mainnet
- Standard RPC submission (no Jito/Nozomi) is the root cause of MEV exposure
- `maxRetries: 3` on multi-hop means the same TX could be submitted multiple times (harmless due to dedup, but wastes resources)

### With ERR-02 (Race Conditions)
- Quote-to-execution timing gap is a structural race condition
- `computeQuote` and `executeSwap` are not atomic -- reserves can change between them
- 30-second route auto-refresh partially mitigates staleness but the 0-29s window remains

### With BOT-01 (Keeper/Crank)
- Crank's Carnage swap has same MEV exposure as user swaps
- Crank circuit breaker (5 errors) and spending cap (0.5 SOL/hr) are solid for the crank itself
- Crank does NOT execute user swaps -- it only manages epoch transitions and Carnage

### With LOGIC-01 (Business Logic)
- The 50% on-chain floor is the ultimate safety net for all trading
- Quote engine must match on-chain math exactly -- any divergence widens the slippage window
- Split router optimizes across two paths but adds complexity to minimumOutput calculation

## Cross-Reference Handoffs

1. **-> ERR-02**: Investigate whether `useSwap.ts` re-quotes if pools change between quote and execution click. Currently it does NOT -- the stale quote's `minimumOutput` is used directly.
2. **-> CHAIN-05**: Verify that `skipPreflight: true` on multi-hop routes is only applied on devnet and switched off for mainnet. Check if `NEXT_PUBLIC_CLUSTER` could drive this decision.
3. **-> LOGIC-01**: Verify the on-chain 50% output floor implementation. This is the single most important safety mechanism for trading security. Any bypass would be critical.
4. **-> SEC-01**: The `SettingsProvider` reads slippage from localStorage. An XSS or extension could modify localStorage to set `slippageBps: 10000` (100%), making every swap maximally sandwichable.
5. **-> INFRA-03**: The SOL price API returns stale prices indefinitely when providers are down. Add a maximum stale age (e.g., 5 minutes) after which it returns 502 instead.

## Risk Observations (Full)

| # | Risk | Severity | Location | Impact |
|---|------|----------|----------|--------|
| 1 | No MEV protection (H015 recheck) | HIGH | `useSwap.ts:763`, `multi-hop-builder.ts:381` | Up to 5% value extraction per swap on mainnet |
| 2 | Default 500 bps slippage | HIGH | `SettingsProvider.tsx:170` | Amplifies MEV extraction; most users never change defaults |
| 3 | skipPreflight on multi-hop | MEDIUM | `multi-hop-builder.ts:381` | Removes simulation safety net on mainnet |
| 4 | No trade size cap | MEDIUM | `useSwap.ts:301-309` | User can execute pool-draining swaps with extreme impact |
| 5 | No price impact warning/gate | MEDIUM | `route-engine.ts:351-354` | No UI guard against self-harmful large swaps |
| 6 | Crank Carnage swap not MEV-protected | MEDIUM | `crank-runner.ts:16` | Carnage buyback can be sandwiched |
| 7 | Quote-to-execution race | MEDIUM | `useSwap.ts:690-808` | Stale reserves -> inaccurate minimumOutput |
| 8 | SOL price stale fallback no max age | LOW | `sol-price/route.ts:115-123` | Display-only, but misleading |
| 9 | Reserve freshness not exposed | LOW | `usePoolPrices.ts:55-104` | Quotes may use stale data without indication |
| 10 | toBaseUnits float precision | LOW | `useSwap.ts:301-309` | Sub-unit rounding (conservative) |
| 11 | Cached ALT never invalidated | LOW | `multi-hop-builder.ts:261` | Stale ALT causes TX failures until page reload |
| 12 | Tax rate quote-execution mismatch | INFO | Design (A-10) | Documented accepted risk |

## Novel Attack Surface Observations

### 1. SSE-Timed Tax Rate Sniping

The SSE pipeline broadcasts epoch state changes to all connected clients. An attacker with a custom SSE client could:
1. Monitor the SSE stream for epoch transitions (new tax rates from VRF)
2. Detect when tax rates change favorably (e.g., buy tax drops from 14% to 1%)
3. Immediately submit a buy swap with the old `minimumOutput` (computed at 14% tax)
4. On-chain applies the new 1% tax, giving the attacker 13% more output than the `minimumOutput` expected

This is not a "loss" for the user (they get more than minimum), but it creates an information asymmetry where fast SSE consumers have an advantage. In DeFi, this is equivalent to a "latency arbitrage" pattern.

### 2. localStorage Slippage Manipulation via Browser Extension

The `SettingsProvider` persists slippage to `localStorage['dr-fraudsworth-settings']`. A malicious browser extension (or XSS) could set `slippageBps: 9999` silently. The user would see their normal swap UI but with 99.99% slippage tolerance, making their transaction a gift to sandwich bots. The on-chain 50% floor limits damage to 50%, but that is still catastrophic.

### 3. Route Engine Label Collision in Anti-Flicker

`useRoutes.ts:491` uses `r.label === prev.label` for route identity in anti-flicker logic. Route labels are constructed as `"SOL -> CRIME -> PROFIT"`. If the route topology changes (unlikely with static graph) such that two different routes have the same label, anti-flicker could suppress a genuinely better route.

## Questions for Other Focus Areas

1. **For CHAIN-01**: What is the expected latency between an on-chain pool state change and the SSE broadcast reaching the browser? Is there a measurable window where quotes are computed against old reserves?
2. **For LOGIC-01**: Is the 50% on-chain output floor applied to gross output or net output (after tax)? The answer determines the effective minimum a user can receive.
3. **For SEC-01**: Is localStorage sanitized on wallet disconnect? An attacker who sets malicious slippage in localStorage would affect the next wallet connection.
4. **For INFRA-03**: Is there a plan to switch `skipPreflight` based on `NEXT_PUBLIC_CLUSTER`? The devnet workaround should not propagate to mainnet.

## Raw Notes

- The quote engine (`quote-engine.ts`) is exceptionally well-implemented. BigInt arithmetic, correct order of operations for buy vs sell, ceiling division in reverse quotes. This matches on-chain math precisely and was the fix for H014.
- The route engine (`route-engine.ts`) is pure functional with no side effects -- excellent for testing and reasoning about correctness. The topology is hardcoded (static graph), which eliminates dynamic routing bugs.
- The multi-hop builder's instruction processing (`processInstructionsForAtomic`) is clever: stripping per-step compute budgets, making ATAs idempotent, removing intermediate WSOL closes. This correctly handles edge cases in split routes.
- The crank runner's circuit breaker and spending cap are textbook implementations that address H019 and H013 from the previous audit.
- The `resolveHookAccounts` function is deterministic PDA derivation with no RPC calls -- excellent performance and eliminates a class of race conditions.
- The `toPoolReserves` function in `useRoutes.ts:86-104` correctly remaps pool data to the route engine's expected format. The canonical mint ordering issue (Phase 52.1) is handled upstream in `useProtocolState`.
- `confirm-transaction.ts` uses HTTP polling (not WebSocket) for confirmation -- this is more reliable and aligns with MEMORY.md's guidance about WebSocket unreliability.
