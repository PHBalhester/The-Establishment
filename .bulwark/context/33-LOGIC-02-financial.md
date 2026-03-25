---
task_id: db-phase1-logic-02-financial
provides: [logic-02-financial-findings, logic-02-financial-invariants]
focus_area: logic-02-financial
files_analyzed:
  - app/lib/swap/quote-engine.ts
  - app/lib/swap/route-engine.ts
  - app/lib/swap/split-router.ts
  - app/lib/staking/rewards.ts
  - app/lib/bigint-json.ts
  - app/lib/curve/curve-math.ts
  - app/lib/curve/curve-constants.ts
  - app/hooks/useSwap.ts
  - app/hooks/useStaking.ts
  - app/hooks/useRoutes.ts
  - app/hooks/usePoolPrices.ts
  - app/hooks/useCurveState.ts
  - app/hooks/useCarnageData.ts
  - app/components/launch/BuyForm.tsx
  - app/components/launch/SellForm.tsx
  - app/components/launch/BuySellPanel.tsx
  - app/components/swap/SwapForm.tsx
  - app/db/candle-aggregator.ts
  - app/lib/event-parser.ts
  - app/lib/protocol-store.ts
  - shared/constants.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 6}
---
<!-- CONDENSED_SUMMARY_START -->
# Financial & Economic Logic -- Condensed Summary

## Key Findings (Top 10)

1. **toBaseUnits uses parseFloat -> Math.floor, losing sub-unit precision for large values**: The `toBaseUnits` helper in `useSwap.ts:302-307` converts user-entered amounts via `parseFloat(amount) * 10 ** decimals` which operates in IEEE 754 Number space. For SOL amounts above ~9,007,199 SOL (2^53 / 10^9), precision loss occurs before the BigInt conversion boundary. Not exploitable at current protocol scale but violates the stated "all arithmetic in BigInt" invariant. -- `app/hooks/useSwap.ts:302-307`

2. **Sell path totalFeePct mixes denominations in single-hop direct quote**: In `useSwap.ts:448-449`, the sell tax percentage is computed as `(taxAmount / grossSolOutput) * 100 + (lpFee / baseUnits) * 100`. The first term is SOL/SOL (correct), the second is tokens/tokens (correct individually), but their sum adds percentages of different-denomination amounts. This produces an inaccurate but conservative fee display. -- `app/hooks/useSwap.ts:448-449`

3. **Reverse sell quote totalFeePct also mixes denominations**: Similar to finding #2, `useSwap.ts:521-522` computes `(taxAmount / (desiredOutput + taxAmount)) * 100 + (lpFee / inputTokensNeeded) * 100`. The denominators reference different token types. -- `app/hooks/useSwap.ts:521-522`

4. **calculateRewardRate uses floating-point arithmetic for display stats**: `rewards.ts:145-158` computes totalStakedProfit, userSharePct, annualizedPct, and EPOCHS_PER_YEAR using native Number division. This is display-only code (dead APR code path), but the userSharePct calculation at line 147 can produce imprecise fractional percentages for very small stakers. -- `app/lib/staking/rewards.ts:145-158`

5. **Candle aggregator price derivation uses Number division**: `candle-aggregator.ts:171-175` computes `netInput / swap.outputAmount` using JavaScript Number division. For swap events with very large token amounts (~290T base units at mainnet scale), the denominator could exceed MAX_SAFE_INTEGER. -- `app/db/candle-aggregator.ts:171-175`

6. **Pool reserves stored as Number in PoolData interface**: `usePoolPrices.ts:29-31` stores `reserveA` and `reserveB` as `number`. At mainnet scale (290B token base units initial seed), these values fit within Number.MAX_SAFE_INTEGER but have no runtime guard if reserves grow past 2^53. -- `app/hooks/usePoolPrices.ts:29-31`

7. **BigInt serialization uses tagged-object pattern susceptible to crafted payloads**: `bigint-json.ts:18-25` reconstitutes BigInt from `{ __bigint: "value" }` tags via `BigInt(value.__bigint)`. If an attacker could inject data into the SSE stream, they could produce arbitrary BigInt values. However, the SSE pipeline is server-controlled (fail-closed webhook auth). -- `app/lib/bigint-json.ts:46-50`

8. **Split router operates entirely in Number space**: `split-router.ts:76-146` passes `totalInput` as `number` to quoter callbacks. The quoters internally convert to BigInt for the actual AMM math, but the grid search and output comparison use Number arithmetic. -- `app/lib/swap/split-router.ts:104-115`

9. **SellForm BigInt conversion via Math.floor(parseFloat * factor)**: `SellForm.tsx:122` computes `BigInt(Math.floor(parsed * Number(TOKEN_DECIMAL_FACTOR)))`. The intermediate `parsed * 1_000_000` is a Number multiplication. For token amounts up to 1B tokens (1B * 1e6 = 1e15), this is within safe integer range. Marginal. -- `app/components/launch/SellForm.tsx:122`

10. **Curve progress percentage uses BigInt-to-Number division**: `BuySellPanel.tsx:89` computes `Number((netSol * 100n) / TARGET_SOL)`. The BigInt division produces a floored integer result, then Number conversion. For devnet TARGET_SOL=5 SOL, this gives integer percentages (0-100). For mainnet TARGET_SOL=500 SOL, the same granularity applies. Display-only, conservative rounding. -- `app/components/launch/BuySellPanel.tsx:89`

## Critical Mechanisms

- **Quote Engine (BigInt core)**: All AMM and vault conversion math in `quote-engine.ts` uses BigInt arithmetic exclusively. Forward quotes (`quoteSolBuy`, `quoteSolSell`, `quoteVaultConvert`) and reverse quotes all operate in BigInt. Rounding direction: floor for user output (protocol-favored), ceil for user input in reverse quotes (protocol-favored). This is the secure pattern. -- `app/lib/swap/quote-engine.ts:1-403`

- **Route Engine (BigInt chaining)**: Multi-hop chaining in `route-engine.ts:328-343` passes `outputAmountBigInt` between steps to avoid Number precision loss at intermediate hops. Final `Number()` conversion happens only at the route output boundary. -- `app/lib/swap/route-engine.ts:328-384`

- **Bonding Curve Math (BigInt throughout)**: `curve-math.ts` is a faithful BigInt port of the on-chain Rust math. Quadratic formula, Newton's sqrt, and sell tax all use BigInt. The `calculateSellTax` uses ceil-division `(gross * 1500n + 9999n) / 10000n` -- protocol-favored. -- `app/lib/curve/curve-math.ts:1-229`

- **Staking Reward Calculation (BigInt core)**: `calculatePendingRewards` in `rewards.ts:64-83` uses BigInt for the delta * balance / PRECISION calculation, matching on-chain math.rs. The final `Number()` conversion is safe per the documented argument (individual rewards << MAX_SAFE_INTEGER). -- `app/lib/staking/rewards.ts:64-83`

- **Slippage Floor**: `route-engine.ts:368-369` computes `minimumOutputBI = finalOutputBI * BigInt(10_000 - slippageBps) / 10_000n` in BigInt. BuyForm and SellForm compute slippage in BigInt as well (lines 171, 180 respectively). This is the secure pattern. -- `app/lib/swap/route-engine.ts:368-369`

## Invariants & Assumptions

- INVARIANT: All AMM quote math uses BigInt (no Number intermediates) -- enforced at `app/lib/swap/quote-engine.ts:26-266`. The BPS_DENOMINATOR is `10_000n` bigint constant.
- INVARIANT: Rounding direction favors protocol (floor for output, ceil for input) -- enforced at `app/lib/swap/quote-engine.ts:43,65,79` (floor division) and `app/lib/swap/quote-engine.ts:314,318,323` (ceil division via `(a + b - 1n) / b`)
- INVARIANT: Bonding curve math uses BigInt with quadratic formula matching on-chain -- enforced at `app/lib/curve/curve-math.ts:84-118` and `app/lib/curve/curve-math.ts:146-183`
- INVARIANT: Slippage protection computed in BigInt before Number conversion -- enforced at `app/lib/swap/route-engine.ts:368-369`, `app/components/launch/BuyForm.tsx:170-171`, `app/components/launch/SellForm.tsx:179-180`
- INVARIANT: Token input validation rejects zero and negative amounts -- enforced at `app/lib/swap/route-engine.ts:416` (`inputAmount <= 0`), `app/hooks/useSwap.ts:400` (`baseUnits <= 0`), `app/components/launch/BuyForm.tsx:107` (`parsed <= 0`)
- ASSUMPTION: Individual token amounts fit within Number.MAX_SAFE_INTEGER -- validated by documentation comment at `app/lib/staking/rewards.ts:79-83` but NOT enforced with runtime guard. Pool reserves at mainnet seed (290B base units = 2.9e14) are within safe range.
- ASSUMPTION: Pool reserves stored as Number in usePoolPrices remain below 2^53 -- UNVALIDATED. No runtime check. Current reserves (~2.9e14 max) are safe but there is no guard if the protocol scales.
- ASSUMPTION: Candle aggregator swap amounts fit in Number -- UNVALIDATED at `app/db/candle-aggregator.ts:171`. Event parser uses `.toNumber()` on BN objects at `app/lib/event-parser.ts:37`.
- ASSUMPTION: Shared constants (TOKEN_DECIMALS=6, SOL_POOL_FEE_BPS=100, VAULT_CONVERSION_RATE=100) match on-chain -- enforced at build time by sync-program-ids.ts but drift is possible if manual edits occur to `shared/constants.ts`.

## Risk Observations (Prioritized)

1. **Pool reserve Number overflow at extreme scale** (MEDIUM): `usePoolPrices.ts` stores reserves as `number`. If a pool's reserves ever exceeded 2^53 base units (~9e15 lamports = 9M SOL or ~9T tokens at 6 decimals), downstream quote computations would silently lose precision. Current max reserves (~2.9e14) give ~30x headroom. Mitigated by the fact that on-chain enforces correct math regardless.

2. **Candle price derivation uses floating-point** (MEDIUM): `candle-aggregator.ts:171-175` computes prices using Number division. For swaps involving very large token amounts, this could produce slightly wrong candle prices. Display-only (no financial impact), but could mislead traders.

3. **toBaseUnits parseFloat precision boundary** (LOW): `useSwap.ts:303` uses `parseFloat()` before `Math.floor()`. The `parseFloat("0.123456789")` produces exactly `0.123456789` in IEEE 754, but `parseFloat("0.123456789") * 1e9` may not equal exactly `123456789`. This affects the last lamport of precision. On-chain slippage is the safety net.

4. **Mixed-denomination fee percentage display** (LOW): `useSwap.ts:448-449` and `useSwap.ts:521-522` produce a fee percentage by adding SOL-denominated tax percentage with token-denominated LP fee percentage. The route engine correctly uses BPS summation (`route-engine.ts:360`). The direct-quote path in useSwap does not.

5. **calculateRewardRate dead code with floating-point** (LOW): The APR calculation at `rewards.ts:153-158` uses Number multiplication chains. Dead code (APR never displayed due to legal reasons), but if re-enabled, the floating-point arithmetic could produce inaccurate APR figures for large pools.

6. **No minimum sell amount enforcement in SellForm** (LOW): `SellForm.tsx` validates `parsed <= 0` but has no minimum sell amount (like BuyForm has MIN_PURCHASE_SOL). A user could attempt a dust sell. On-chain likely enforces a minimum, but the frontend doesn't warn. Prior finding H069.

## Novel Attack Surface

- **Quote-to-execution staleness window**: Between quote computation (debounced 300ms) and transaction submission (user signing delay), pool reserves and tax rates can change. The route engine quotes at one point in time, but the on-chain swap executes against potentially different reserves. The minimumOutput slippage parameter is the only protection. A MEV attacker observing the user's pending TX could sandwich it within the gap between the quoted price and the actual execution price. The maximum extractable value is bounded by the slippage tolerance (default 100 BPS = 1%). The split router's Number-space grid search adds no additional vulnerability since the BigInt quoters inside produce correct results.

- **BigInt tag injection via SSE manipulation**: If an attacker compromised the SSE pipeline (e.g., via webhook auth bypass, which is fail-closed), they could inject `{ __bigint: "99999999999999999999999" }` values for pool reserves or staking rewards. The bigintReviver would faithfully reconstruct these as BigInt. However, this requires server-side compromise (H001 webhook auth bypass is FIXED with timingSafeEqual).

## Cross-Focus Handoffs

- **CHAIN-04 (State Sync)**: The staleness of pool reserves delivered via SSE affects quote accuracy. Verify that ws-subscriber polls reserves at adequate frequency and that webhook-delivered account updates propagate within acceptable latency.
- **ERR-01 (Error Handling)**: If quote-engine receives zero reserves (before pools are loaded), it returns 0n output. Verify that the UI properly gates execution when reserves are missing rather than allowing a swap with stale/zero quotes.
- **LOGIC-01 (Business Logic)**: The route engine's anti-flicker threshold (10 BPS) and split router's recommendation threshold (50 BPS) are business logic parameters that could hide a better route from the user. Verify these thresholds are documented and acceptable.
- **DATA-01 (Database)**: Candle aggregator writes Number-typed prices and volumes to PostgreSQL. Verify the database schema can handle the precision range (double precision column vs decimal).

## Trust Boundaries

The financial calculation trust model has two layers. The first layer is the off-chain quote engine, which produces advisory amounts (expected output, minimum output, fee breakdown) for display to users. This layer uses BigInt arithmetic matching on-chain math, but operates on potentially stale reserve data delivered via SSE. The second layer is the on-chain program enforcement: regardless of what the client quotes, the on-chain AMM verifies k-invariant and minimum output constraints. The critical trust boundary is the `minimumOutput` parameter sent to the program -- this is the only client-computed value that has financial consequence. It is computed in BigInt at `route-engine.ts:369` and in the bonding curve forms. The remaining calculations (fee display, price impact, APR) are advisory and have no on-chain effect.
<!-- CONDENSED_SUMMARY_END -->

---

# Financial & Economic Logic -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase demonstrates a well-architected approach to financial calculations, with a clear BigInt-first strategy for all core AMM math (`quote-engine.ts`, `curve-math.ts`, `rewards.ts`). The H014 fix (Number overflow in quote engine) was comprehensively applied. The primary remaining concerns are at the boundary between user input (parseFloat) and the BigInt computation layer, in display-only calculations that still use Number arithmetic, and in the candle aggregator which operates entirely in Number space.

No critical financial logic vulnerabilities were found. The on-chain enforcement of k-invariant, minimum output, and slippage floor provides a robust safety net that renders most off-chain precision concerns display-only rather than exploitable.

## Scope

**Analyzed through LOGIC-02 lens (Financial & Economic Logic):**
- All fee, tax, reward, and price calculations in the off-chain codebase
- Precision of numeric types (BigInt vs Number) at every calculation boundary
- Rounding direction (protocol-favored vs user-favored)
- Integer overflow/underflow potential
- Negative amount and zero amount handling
- Financial data flow from on-chain -> SSE -> browser -> display

**Out of scope:** On-chain Rust programs (programs/ directory). Referenced only for verifying that off-chain math mirrors on-chain behavior.

## Key Mechanisms

### 1. AMM Quote Engine (`app/lib/swap/quote-engine.ts`, 403 LOC)

The quote engine is the financial heart of the off-chain swap system. It provides:

**Forward quotes:**
- `quoteSolBuy(solLamports, reserveWsol, reserveToken, buyTaxBps, lpFeeBps)` -- SOL -> Token
  - Order: Tax first (deducted from SOL input), then LP fee, then AMM output
  - All BigInt. Floor division (protocol-favored: user gets fewer tokens).
- `quoteSolSell(tokenAmount, reserveWsol, reserveToken, sellTaxBps, lpFeeBps)` -- Token -> SOL
  - Order: LP fee first (deducted from token input), then AMM output, then tax on SOL output
  - All BigInt. Floor division.
- `quoteVaultConvert(inputAmount, conversionRate, isProfitInput)` -- Vault 100:1
  - Deterministic fixed-rate. Floor division for faction->PROFIT, multiplication for PROFIT->faction.

**Reverse quotes (given desired output, compute required input):**
- `reverseQuoteSolBuy`, `reverseQuoteSolSell`, `reverseQuoteVaultConvert`
  - Use ceil division pattern: `(a + b - 1n) / b` -- protocol-favored (user pays more).
  - Feasibility checks: output must be less than reserve. Returns null if impossible.

**Price impact:**
- `calculatePriceImpactBps` -- cross-multiplied BigInt formula avoiding intermediate division. Returns 0 for non-negative impact.

**Analysis:** This module is exemplary. All arithmetic is BigInt. Rounding consistently favors the protocol (floor for output, ceil for input). Zero-denominator guards are present. The only concern is that it mirrors on-chain math by documentation reference rather than compile-time verification (Assumption A-4 from ARCHITECTURE.md).

### 2. Route Engine (`app/lib/swap/route-engine.ts`, 445 LOC)

Enumerates all paths through the protocol's topology (SOL <-> CRIME/FRAUD <-> PROFIT), quotes each via the quote engine, and ranks by output.

**BigInt chaining:** Steps are chained using `outputAmountBigInt` to avoid precision loss at intermediate hops. Only the final route amounts are converted to Number.

**Fee calculation:** Uses BPS summation (step-level `lpFeeBps + taxBps`) rather than amount-based fee computation. This correctly handles cross-denomination routes (where the fee amounts are in different tokens).

**Slippage:** `minimumOutputBI = finalOutputBI * BigInt(10_000 - slippageBps) / 10_000n` -- BigInt floor division. Safe.

**Concern -- `inputAmount` parameter is `number`:** The entry point `computeRoutes` accepts `inputAmount: number`, which is then converted to BigInt at line 328 (`BigInt(inputAmount)`). If `inputAmount` exceeds 2^53, the Number would already have lost precision before reaching BigInt. In practice, this is mitigated because `inputAmount` comes from `useSwap.ts:237-239` where it's computed as `Math.floor(parsed * 10 ** decimals)`. For SOL (9 decimals), amounts up to ~9M SOL are safe. For tokens (6 decimals), amounts up to ~9B tokens are safe. Protocol token supply is 1B, so this is adequate.

### 3. Split Router (`app/lib/swap/split-router.ts`, 147 LOC)

Grid search over 1% increments to find optimal split across two parallel paths (e.g., SOL -> CRIME -> PROFIT vs SOL -> FRAUD -> PROFIT).

**All Number space:** The `totalInput`, `pathAQuoter`, `pathBQuoter`, and output comparison are all `number`. The quoter callbacks internally convert to BigInt (verified in `useRoutes.ts:344-357`), so the actual AMM math is precise. The grid search comparison and `improvementBps` calculation use Number arithmetic, which is adequate for the scale of values involved (output amounts in lamport/token base units well within 2^53).

**50 BPS threshold:** Split is only recommended if it produces >= 0.5% more output. This is a reasonable threshold to avoid unnecessary transaction complexity.

### 4. Bonding Curve Math (`app/lib/curve/curve-math.ts`, 229 LOC)

Faithful BigInt port of on-chain Rust math:

- `calculateTokensOut`: Quadratic formula with BigInt square root (Newton's method). Intermediate products reach ~2.5e36. Cap at remaining supply.
- `calculateSolForTokens`: Linear integral with PRECISION scaling and remainder recovery. Ceil-rounded (protocol-favored).
- `calculateSellTax`: `(solGross * 1500n + 9999n) / 10000n` -- ceil division. Matches on-chain.
- `getCurrentPrice`: Linear interpolation with PRECISION scaling.

**Analysis:** This is clean and correct. The bigintSqrt implementation has proper guards (negative check, small-value fast paths). The curve constants are cluster-aware via `isDevnet` flag from `NEXT_PUBLIC_CLUSTER`.

### 5. Staking Rewards (`app/lib/staking/rewards.ts`, 167 LOC)

**`calculatePendingRewards`:** BigInt throughout. Mirrors on-chain Synthetix pattern: `delta * balance / PRECISION`. Final `Number()` conversion is justified by the documented argument that individual staker rewards are bounded well below 2^53.

**`calculateRewardRate`:** Number arithmetic for display statistics. The `totalStakedProfit = totalStakedBaseUnits / 10 ** PROFIT_DECIMALS` division and `userSharePct = (userStakedBaseUnits / totalStakedBaseUnits) * 100` use Number. This is display-only. The APR calculation is explicitly marked as dead code (legal reasons).

**`EPOCHS_PER_YEAR` constant:** Uses devnet epoch duration (40 seconds), which would give wildly wrong APR on mainnet (~30 minutes per epoch). This is dead code, but if re-enabled, the constant must be cluster-aware.

### 6. BigInt JSON Serialization (`app/lib/bigint-json.ts`, 117 LOC)

**replacer/reviver pair:** Tags BigInt as `{ __bigint: "string_value" }` for JSON transport. Used by protocol-store (server) and useProtocolState (client).

**`anchorToJson`:** Converts Anchor-decoded BN objects to either `number` (via `.toNumber()`) or `{ __bigint: ... }` tag based on a field whitelist. The whitelist includes:
- `CURVE_BIGINT_FIELDS`: tokensSold, solRaised, tokensReturned, solReturned, taxCollected
- `STAKING_BIGINT_FIELDS`: rewardsPerTokenStored

**Concern:** Fields NOT in the bigint list are converted via `.toNumber()`, which silently truncates values above 2^53. This is intentional and documented as safe for the specific field values involved, but any new u64/u128 fields added to protocol PDAs would need to be added to the bigint list.

### 7. User Input -> Base Units Conversion

Three distinct conversion patterns exist:

**Pattern A (useSwap.ts:302-307):** `parseFloat(amount) * 10 ** decimals -> Math.floor -> number`. Used for AMM swap amounts. The Number intermediate limits precision to 2^53.

**Pattern B (BuyForm.tsx:114, SellForm.tsx:122):** `parseFloat(tokenInput) -> BigInt(Math.floor(parsed * LAMPORTS_PER_SOL))`. Similar pattern but the BigInt conversion happens immediately after Math.floor. For SOL amounts under ~9M SOL and token amounts under ~9B tokens, the intermediate Number multiplication is exact.

**Pattern C (useStaking.ts:516, 540):** `parseFloat(amount) -> Math.floor(parsed * 10 ** PROFIT_DECIMALS)`. Same as Pattern A but for PROFIT (6 decimals). Up to 9B PROFIT tokens are safe.

All three patterns share the same fundamental approach: `parseFloat` -> Number multiplication -> `Math.floor` -> integer. This is adequate for the protocol's token supplies (1B CRIME, 1B FRAUD, 20M PROFIT) but is not future-proof for tokens with larger supplies.

## Trust Model

### Data Sources Trusted for Financial Calculations

1. **Pool reserves (SSE -> usePoolPrices):** Stored as Number. Trusted because they originate from Anchor-decoded on-chain PoolState. Could be stale by the SSE delivery latency (~200ms typical).

2. **Tax rates (SSE -> useEpochState):** Stored as Number (0-1400 BPS range). Well within Number precision.

3. **Curve state (SSE -> useCurveState):** BigInt fields (tokensSold, solRaised, etc.) properly preserved through the bigint-json pipeline.

4. **User input amounts:** Entered as strings, parsed via parseFloat. Validated for > 0 and balance checks, but no maximum amount validation against Number.MAX_SAFE_INTEGER.

### Financial Safety Net

The on-chain program is the ultimate authority:
- AMM enforces `k_after >= k_before` (INV-1)
- Tax Program enforces `minimum_amount_out` (passed from client as `minimumOutput`)
- Bonding curve enforces `minimum_tokens_out` / `minimum_sol_out`
- Staking program enforces `rewards <= deposited` (INV-4)

Off-chain calculation errors can only cause:
1. **Worse user experience** (wrong quotes, confusing fee display)
2. **Wider slippage window** (if minimumOutput is too low due to precision loss)
3. **Failed transactions** (if minimumOutput is too high due to stale data)

They cannot cause direct fund loss because on-chain enforcement is independent of client-computed values.

## State Analysis

### In-Memory Cache (protocol-store.ts)

Financial data flows through the ProtocolStore singleton:
- Pool reserves (PoolState accounts)
- Epoch tax rates (EpochState)
- Staking pool data (StakePool)
- Curve states (CurveState x2)
- Carnage fund state

All data is stored as `Record<string, unknown>` and serialized via bigintReplacer for SSE transport. The dedup guard (`lastSerialized` comparison) prevents redundant broadcasts but could mask rapid updates if two different states serialize to the same string (extremely unlikely due to slot numbers changing).

### Database (candle-aggregator.ts)

Candle data (OHLCV) is persisted to PostgreSQL via Drizzle ORM. Prices and volumes are stored as `number` (JavaScript Number). The SQL upsert uses `GREATEST`/`LEAST` for high/low tracking, which is correct. Volumes accumulate via `volume + new_volume`, which could overflow if JavaScript Number values are too large (but candle volumes are per-resolution-bucket, bounded by swap frequency).

## Dependencies

### Internal
- `@dr-fraudsworth/shared` (constants: TOKEN_DECIMALS, SOL_POOL_FEE_BPS, VAULT_CONVERSION_RATE, MINIMUM_STAKE, COOLDOWN_SECONDS, VALID_PAIRS)
- `@coral-xyz/anchor` (BorshCoder for event parsing, Program for account fetching)
- `@solana/web3.js` (PublicKey, Transaction, Connection)

### External (none for financial logic)
No external financial libraries (BigNumber.js, Decimal.js, etc.) are used. All financial math is native BigInt. This is a strength -- no dependency surface for financial calculations.

## Focus-Specific Analysis

### AIP-159 (Floating-Point for Money): MOSTLY MITIGATED

The H014 fix comprehensively addressed this. Quote engine, route engine, curve math, and staking rewards all use BigInt. Remaining floating-point arithmetic is in:
- `calculateRewardRate` (dead code APR + display-only userSharePct)
- `candle-aggregator.ts` price derivation (display-only)
- `useSwap.ts` totalFeePct computation (display-only)

### AIP-160 (No Negative Value Validation): MITIGATED

- `computeRoutes` guards `inputAmount <= 0` at line 416
- `quoteVaultConvert` guards `inputAmount <= 0n` at line 261
- `useSwap.ts` guards `baseUnits <= 0` at line 400
- BuyForm/SellForm validate `parsed <= 0` and `isNaN`

No path allows negative amounts to reach financial calculations.

### AIP-161 (Non-Atomic Balance Check and Deduction): NOT APPLICABLE

This protocol has no server-side balance management. All balance operations are on-chain (Solana programs enforce atomicity). The off-chain code only reads balances for display.

### AIP-164 (Fee Rounding to Zero for Dust): MITIGATED

- On-chain: BigInt floor division means `amount * fee_bps / 10000` CAN produce 0 for dust amounts. Example: 50 lamports * 100 bps / 10000 = 0.
- Off-chain: The quote engine mirrors this behavior. A zero fee on a dust swap is correct on-chain behavior (the protocol loses the fee on dust amounts, which is acceptable).
- Prior finding H119 (fee calculation zero for dust) was FIXED at the frontend display level.

### AIP-166 (Token Amount Converted to Number): PARTIALLY APPLICABLE

The `anchorToJson` function converts BN fields to Number via `.toNumber()` for fields NOT in the bigint whitelist. This is by design -- fields like `participantCount`, `totalTriggers`, `lastTriggerEpoch` are small integers. The u64 fields that could grow large (tokensSold, solRaised, etc.) ARE in the bigint whitelist.

However, the `event-parser.ts` comment at line 37 states: "Anchor BN values are converted to number (safe for lamport amounts < 2^53)." This is true for individual swap amounts but could be violated for cumulative protocol-lifetime fields in future event types.

### AIP-168 (Yield/Reward Overflow): MITIGATED

`calculatePendingRewards` at `rewards.ts:71-77` uses BigInt throughout:
```
delta = poolRewardsPerTokenStored - userRewardsPerTokenPaid  // bigint
newPending = (userStakedBalance * delta) / PRECISION          // bigint
totalPending = userRewardsEarned + newPending                 // bigint
```
The PRECISION denominator is 1e18 (BigInt). The intermediate product `userStakedBalance * delta` can reach ~2^128, which BigInt handles correctly.

## Cross-Focus Intersections

### With CHAIN-04 (State Sync)
Pool reserves arrive via SSE with potential staleness. The route engine computes quotes against these reserves, producing `minimumOutput` that may not match current on-chain state. The slippage tolerance parameter is the safety margin. If SSE delivery is delayed by seconds during high-volume trading, quotes could be significantly stale.

### With ERR-02 (Race/Concurrency)
The 300ms debounce timer in useSwap and useRoutes creates a window where the user sees old quotes while new ones are computing. If the user clicks "Swap" during this window, they execute with the displayed (potentially stale) quote. The `minimumOutput` from the stale quote may be lower than what a fresh quote would produce, giving the user slightly worse protection.

### With DATA-01 (Database)
Candle data persisted via Number arithmetic. If swap event amounts exceed Number.MAX_SAFE_INTEGER (unlikely at current scale), candle prices would be wrong. This affects charting accuracy, not financial safety.

### With LOGIC-01 (Business Logic)
The route engine's anti-flicker threshold (10 BPS) means a route that's up to 0.1% better than the current selection will NOT cause a switch. This is a UX optimization that could hide a marginally better route.

## Cross-Reference Handoffs

1. **-> CHAIN-04**: Verify SSE delivery latency for pool reserves. If > 1 second under load, quote staleness becomes material.
2. **-> ERR-01**: Verify that useSwap prevents execution when `quote === null` or when pool data is in `loading` state.
3. **-> DATA-01**: Verify candle schema column type supports the precision range of Number-typed prices.
4. **-> ERR-02**: Verify that the debounce timer in useSwap prevents execution with a stale quote that doesn't match the displayed output.
5. **-> CHAIN-02**: Verify that the bigint whitelist in `bigint-json.ts` covers ALL u64/u128 fields across all protocol PDAs. Missing a field would silently truncate it to Number.

## Risk Observations

### HIGH
1. **Pool reserve Number overflow headroom** (H): Pool reserves stored as `number` in `usePoolPrices.ts:29-31`. Current max (~2.9e14 base units) has ~30x headroom to MAX_SAFE_INTEGER. If the protocol grows significantly or if a whale deposits a very large amount, precision could be lost in quote calculations. On-chain enforcement prevents fund loss, but quotes would diverge from reality. Recommend adding a runtime warning/guard when reserves approach 2^52.

2. **bigint-json whitelist completeness** (H): The `CURVE_BIGINT_FIELDS` and `STAKING_BIGINT_FIELDS` lists in `bigint-json.ts:64-73` must be updated when new u64/u128 fields are added to protocol accounts. If a new large field is not whitelisted, it will be truncated via `.toNumber()` and produce incorrect client-side calculations. No automated check ensures this stays in sync.

### MEDIUM
3. **Candle price floating-point** (M): `candle-aggregator.ts:171-175` divides swap amounts using Number. For large swaps, candle prices could be imprecise. Display-only.

4. **toBaseUnits precision at boundary** (M): `useSwap.ts:303` uses `parseFloat * 10^decimals` in Number space. The last 1-2 lamports of precision can be lost for large amounts. Mitigated by on-chain slippage enforcement.

5. **Split router all-Number grid search** (M): `split-router.ts` operates entirely in Number. The quoter callbacks use BigInt internally, but the comparison of outputs uses Number subtraction. For very large swaps where outputs are close in magnitude, the comparison could produce wrong ordering due to precision loss.

6. **EPOCHS_PER_YEAR devnet constant in dead code** (M): If the APR display is re-enabled, the 40-second epoch duration would produce absurdly high APR figures on mainnet. Must be cluster-aware before re-activation.

### LOW
7. **Sell totalFeePct mixed denominations** (L): `useSwap.ts:448-449` display inaccuracy.
8. **Reverse sell totalFeePct mixed denominations** (L): `useSwap.ts:521-522` display inaccuracy.
9. **No minimum sell amount in SellForm** (L): Prior finding H069, still not fixed.
10. **calculateRewardRate floating-point** (L): Dead code, but would be buggy if re-enabled.
11. **BuySellPanel integer percentage** (L): `Number((netSol * 100n) / TARGET_SOL)` gives integer percentages only.
12. **Event parser BN.toNumber()** (L): Safe for current event field magnitudes but not future-proof.

## Novel Attack Surface Observations

1. **Stale-quote slippage extraction**: An attacker monitoring the mempool could observe a user's swap TX, note that the `minimumOutput` was computed against stale reserves (due to SSE latency), and sandwich the user's TX to extract the gap between the stale quote and current market price. The maximum extractable value equals `(current_price - quoted_price) * amount`, bounded by the user's slippage tolerance. This is a standard MEV concern but is amplified by the SSE delivery model (vs direct RPC polling which would have fresher data).

2. **BigInt tag pollution in development**: If the globalThis singleton pattern allows a stale protocol store instance (from HMR in development), BigInt values could be inconsistent between components. Production builds don't use HMR, so this is dev-only. But a developer debugging financial calculations could see inconsistent values.

## Questions for Other Focus Areas

- **CHAIN-04**: What is the measured p99 latency from on-chain state change to SSE client delivery? This determines the maximum staleness of quotes.
- **ERR-01**: Can a user click "Swap" while `quoteLoading === true`? The UI should prevent this.
- **DATA-01**: What is the PostgreSQL column type for `candles.price`? If it's `double precision`, the Number-derived values are stored at ~15 significant digits, which matches JavaScript Number precision.
- **INFRA-03**: Is there any load balancer or CDN between the SSE endpoint and the client that could add latency to financial data delivery?

## Raw Notes

### Constants verification (shared/constants.ts)
- TOKEN_DECIMALS = 6 (matches on-chain)
- SOL_POOL_FEE_BPS = 100 (1% LP fee, matches on-chain)
- VAULT_CONVERSION_RATE = 100 (100:1 faction:PROFIT, matches on-chain)
- MINIMUM_STAKE = 1_000_000 (1 PROFIT in base units)
- COOLDOWN_SECONDS = 43_200 (12 hours)

### BigInt conversion boundary map
```
User input (string)
  -> parseFloat (Number)
  -> * 10^decimals (Number multiplication)
  -> Math.floor (Number)
  -> BigInt() (safe if < 2^53)
  -> quote-engine (all BigInt)
  -> Number() (output boundary, safe if individual amounts)
  -> Display string
```

The weakest link is step 3 (Number multiplication). For SOL amounts: `parseFloat("9007199.254740991") * 1e9` = `9007199254740991` = 2^53 - 1. Any SOL amount above ~9,007,199.254740991 SOL would lose precision. For 6-decimal tokens: amounts above ~9,007,199,254 tokens (9B+) would lose precision. Protocol max supply is 1B, so this is safe.

### Rounding direction audit
| Location | Direction | Favor |
|----------|-----------|-------|
| quote-engine forward | floor (BigInt default) | Protocol |
| quote-engine reverse | ceil ((a+b-1)/b) | Protocol |
| curve-math calculateTokensOut | floor | Protocol |
| curve-math calculateSolForTokens | ceil | Protocol |
| curve-math calculateSellTax | ceil | Protocol |
| route-engine minimumOutput | floor (10_000 - slip) / 10_000 | User-conservative |
| split-router minimumOutput | Math.floor | User-conservative |

All financial rounding favors the protocol, which is the correct pattern for a DeFi application.
