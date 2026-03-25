---
task_id: db-phase1-business-logic
provides: [business-logic-findings, business-logic-invariants]
focus_area: business-logic
files_analyzed: [app/lib/swap/quote-engine.ts, app/lib/swap/route-engine.ts, app/lib/swap/split-router.ts, app/lib/curve/curve-math.ts, app/lib/curve/curve-constants.ts, app/lib/staking/rewards.ts, app/hooks/useSwap.ts, app/hooks/useStaking.ts, app/hooks/useRoutes.ts, app/db/candle-aggregator.ts, app/components/launch/BuyForm.tsx, app/components/launch/SellForm.tsx, scripts/graduation/graduate.ts, scripts/deploy/initialize.ts, scripts/e2e/lib/swap-flow.ts, scripts/e2e/lib/staking-flow.ts, scripts/e2e/carnage-hunter.ts, scripts/vrf/lib/swap-verifier.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Business Logic & Workflow Security -- Condensed Summary

## Key Findings (Top 10)

1. **quote-engine uses JavaScript Number for AMM math**: All AMM quote functions (`quoteSolBuy`, `quoteSolSell`, `calculateSwapOutput`, etc.) operate on `number` type. For pool reserves approaching ~9e15 lamports (~9M SOL), intermediate products like `reserveOut * effectiveInput` exceed `Number.MAX_SAFE_INTEGER` (2^53), causing silent precision loss. This is the client-side quoting engine, not on-chain code, but it drives slippage calculations and minimumOutput sent to the on-chain program. -- `app/lib/swap/quote-engine.ts:54-62`

2. **toBaseUnits float->int conversion uses `parseFloat * 10^decimals`**: The pattern `Math.floor(parseFloat(amount) * 10 ** decimals)` in `useSwap.ts:299` and `useStaking.ts:499` is a known floating-point hazard. For example, `parseFloat("0.1") * 1e9 = 99999999.99999999`, which floors to `99999999` instead of `100000000`. This means users may submit amounts that are 1 lamport less than intended. -- `app/hooks/useSwap.ts:297-300`

3. **Bonding curve math correctly uses BigInt throughout**: `curve-math.ts` and `curve-constants.ts` use BigInt for all intermediate calculations, correctly handling values up to ~2.5e36. This is the secure pattern (matches AIP-166/AIP-168 guidance). -- `app/lib/curve/curve-math.ts:84-118`

4. **Staking rewards use BigInt for u128 fields but convert to Number at output**: `calculatePendingRewards` in `rewards.ts:82` converts the final BigInt to `Number()`. The comment claims this is safe because max SOL supply is ~5e17, which is below 2^53. This is correct for total SOL supply but should be monitored if staking rewards ever accumulate to very high levels. -- `app/lib/staking/rewards.ts:82`

5. **Sell fee percentage calculation in useSwap has cross-denomination math**: In `useSwap.ts:434-435`, the sell fee percentage combines `taxAmount/grossSolOutput * 100` (SOL-denominated) with `lpFee/baseUnits * 100` (token-denominated). These are different units being summed, producing an incorrect percentage. This is display-only (does not affect on-chain execution) but misleads users about actual costs. -- `app/hooks/useSwap.ts:434-435`

6. **Graduation script has checkpoint+resume but no rollback**: The `graduate.ts` script performs irreversible operations (Filled -> Graduated state transition at step 2) before the pool creation steps (steps 7-8). If pool creation fails after graduation, the protocol is in a partially graduated state that cannot be rolled back. The checkpoint+resume mechanism handles re-running from failure, but the ordering means graduation is committed before pools exist. -- `scripts/graduation/graduate.ts:320-366`

7. **GRADUATION_POOL_SEED_SOL allows env override without validation**: `Number(process.env.SOL_POOL_SEED_SOL_OVERRIDE)` at `graduate.ts:106` converts env var to Number with no bounds checking. A typo like `SOL_POOL_SEED_SOL_OVERRIDE=1` (1 lamport) would create a pool with virtually zero SOL liquidity. The hardcoded fallback (1000 SOL) is correct; the override exists for testing but lacks guard rails. -- `scripts/graduation/graduate.ts:102-107`

8. **candle-aggregator price derivation uses floating-point division**: `upsertCandlesForSwap` at `candle-aggregator.ts:172` computes price as `netInput / swap.outputAmount` using JavaScript Number division. For large token amounts, this could lose precision. Since candles are display-only (not used for financial decisions), this is low severity. -- `app/db/candle-aggregator.ts:170-175`

9. **No negative input validation on quote-engine public functions**: `quoteSolBuy`, `quoteSolSell`, etc. do not explicitly reject negative inputs. While `computeRoutes` guards `inputAmount <= 0` and `useSwap` parses via `parseFloat` + `> 0` check, a direct caller of the quote functions could pass negative values, producing nonsensical results. -- `app/lib/swap/quote-engine.ts:132-156`

10. **Split route totalLpFee and totalTax set to 0**: In `useRoutes.ts:176-177`, split routes hardcode `totalLpFee: 0` and `totalTax: 0` with a comment that these are "not meaningful" for mixed-denomination legs. The `totalFeePct` is correctly computed from BPS, but downstream consumers checking `totalLpFee` or `totalTax` for zero might incorrectly assume a fee-free route. -- `app/hooks/useRoutes.ts:176-177`

## Critical Mechanisms

- **AMM Quote Engine** (`app/lib/swap/quote-engine.ts`): Pure-function JavaScript port of on-chain constant-product AMM math. Uses `number` type with `Math.floor` for integer truncation. Drives minimumOutput for slippage protection. The on-chain program enforces slippage independently, so quote-engine errors cause failed TXs (user protection) rather than fund loss.

- **Bonding Curve Math** (`app/lib/curve/curve-math.ts`): BigInt-based quadratic formula implementation. Correctly handles large intermediates. Newton's method integer square root. Drives preview calculations and slippage bounds for curve purchases and sells.

- **Route Engine** (`app/lib/swap/route-engine.ts` + `app/lib/swap/split-router.ts`): Enumerates all paths in a 4-token topology (SOL, CRIME, FRAUD, PROFIT), chains quote-engine calls for multi-hop paths, and optionally splits across parallel paths. Grid search at 1% granularity for optimal split.

- **Staking Rewards** (`app/lib/staking/rewards.ts`): Client-side Synthetix cumulative reward-per-token calculation. BigInt throughout except final Number conversion. Used for display only -- on-chain enforces actual claim amounts.

- **Graduation Workflow** (`scripts/graduation/graduate.ts`): 11-step checkpoint+resume state machine for bonding curve -> AMM transition. Irreversible at step 2. Manual admin operation with on-disk state file.

## Invariants & Assumptions

- INVARIANT: On-chain program enforces minimumOutput regardless of client-side quote accuracy -- enforced at on-chain `swap_sol_buy`/`swap_sol_sell` constraints / NOT enforced in quote-engine itself (client-side only)
- INVARIANT: Bonding curve math uses BigInt for all intermediates to prevent overflow -- enforced at `app/lib/curve/curve-math.ts:84-118`
- INVARIANT: Graduation state machine transitions are strictly ordered (steps 1-11 sequential) -- enforced at `scripts/graduation/graduate.ts:885-977` via checkpoint loop
- INVARIANT: Token pair validation prevents invalid swap directions -- enforced at `app/hooks/useSwap.ts:249` via `VALID_PAIRS`
- INVARIANT: Sell tax is ceil-rounded (protocol-favored) -- enforced at `app/lib/curve/curve-math.ts:203`
- ASSUMPTION: `Number.MAX_SAFE_INTEGER` is sufficient for AMM pool reserves -- UNVALIDATED. Current devnet pools are small, but mainnet pools with >9M SOL would overflow.
- ASSUMPTION: `parseFloat(amount) * 10 ** decimals` produces accurate base units -- PARTIALLY INVALID. Known float precision issue (finding #2).
- ASSUMPTION: SOL price from CoinGecko/Binance proxy is fresh enough for display -- validated at `app/app/api/sol-price/route.ts` with 60s cache
- ASSUMPTION: Staking rewards in lamports never exceed 2^53 -- validated by comment at `rewards.ts:79` (max SOL supply ~5e17 < 2^53)

## Risk Observations (Prioritized)

1. **HIGH -- quote-engine Number overflow on large pools**: `reserveOut * effectiveInput` in `calculateSwapOutput` can exceed `Number.MAX_SAFE_INTEGER` when pool reserves are large. This would produce incorrect minimumOutput, potentially causing the on-chain TX to fail (safe outcome) or, in edge cases, passing a lower minimumOutput than intended (user gets less than expected). -- `app/lib/swap/quote-engine.ts:61`

2. **HIGH -- float-to-int conversion precision loss**: `Math.floor(parseFloat("0.1") * 1e9)` = 99999999 instead of 100000000. Affects all swap and staking amount inputs. Impact: user may submit 1 unit less than intended. -- `app/hooks/useSwap.ts:299`, `app/hooks/useStaking.ts:499`

3. **MEDIUM -- sell fee display cross-denomination arithmetic**: Summing SOL-denominated and token-denominated percentages produces misleading fee display. -- `app/hooks/useSwap.ts:434-435`

4. **MEDIUM -- graduation env override lacks bounds checking**: `Number(process.env.SOL_POOL_SEED_SOL_OVERRIDE)` accepts any value including 0 or NaN. -- `scripts/graduation/graduate.ts:106`

5. **MEDIUM -- split route zero totalLpFee/totalTax**: Downstream code checking these values may incorrectly assume fee-free routes. -- `app/hooks/useRoutes.ts:176-177`

6. **MEDIUM -- BuyForm cap check doesn't block submission**: In `BuyForm.tsx:140-144`, the per-wallet cap check sets a validation error string but the `canSubmit` guard at line 235 only checks `!validationError`, which IS set. However, the cap check runs in the debounce effect and may be overwritten by the balance check clearing `validationError` at line 127. Race: user enters amount exceeding cap, balance check clears error, cap check runs after, re-sets error. This timing is correct (cap check runs AFTER balance check in the same setTimeout), but the flow is fragile. -- `app/components/launch/BuyForm.tsx:122-144`

7. **MEDIUM -- candle aggregator uses float for price**: Display-only, but accumulates rounding errors over time for charts. -- `app/db/candle-aggregator.ts:170-175`

## Novel Attack Surface

- **Quote-engine as slippage manipulation surface**: If an attacker can cause the client-side quote engine to compute a higher output than actual (e.g., by manipulating pool state between quote and execution), the minimumOutput would be set too high and the TX would fail. Conversely, if the quote engine underestimates output (Number precision loss), the minimumOutput would be lower than optimal, and the user would accept a worse rate than they should. The on-chain slippage check prevents fund loss but does not prevent suboptimal execution.

- **Graduation script state file as attack vector**: The `graduation-state.json` file on disk controls which steps are skipped on resume. If an attacker could modify this file before the admin re-runs the script, they could cause steps to be skipped (e.g., marking `create_crime_sol_pool` as completed when it hasn't been). This requires filesystem access to the admin's machine.

## Cross-Focus Handoffs

- **LOGIC-02 (Financial/Economic Logic)**: The Number-type arithmetic in quote-engine.ts needs deep analysis for precision boundaries. What's the maximum pool reserve size where Number arithmetic remains safe? Calculate the exact threshold.
- **CHAIN-06 (On-Chain State Reading)**: The `usePoolPrices` hook feeds reserve data to the route engine. If pool state is stale (processed commitment), quotes will be wrong. Verify commitment levels used for pool reserve reads.
- **CHAIN-01 (Transaction Construction)**: The `minimumOutput` computed by quote-engine flows into TX instructions. Verify that the on-chain slippage check is indeed enforced for ALL swap paths (AMM, vault convert, bonding curve).
- **SEC-01 (Key Handling)**: Graduation script reads admin keypair and mint keypairs from disk. Verify these are properly secured.

## Trust Boundaries

The business logic trust model has a clear layered architecture: client-side quote engines produce estimated outputs that are used ONLY for display and minimumOutput computation. The on-chain programs are the source of truth for all financial operations. This means client-side math errors degrade UX (failed TXs, suboptimal slippage) but cannot directly cause fund loss. The critical trust boundary is at the minimumOutput parameter -- if the client computes this too low (due to Number precision loss or stale data), users accept worse execution rates. The graduation script is the most sensitive business logic workflow because it operates directly with admin keypairs and performs irreversible state transitions with real SOL at stake.
<!-- CONDENSED_SUMMARY_END -->

---

# Business Logic & Workflow Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase implements a multi-component DeFi protocol with bonding curves, AMM pools, staking, and a "Carnage" mechanism. Business logic spans three major areas: (1) financial math engines that mirror on-chain code for client-side quoting, (2) multi-step workflow orchestration for protocol lifecycle events (graduation, initialization), and (3) React hooks that compose these primitives into user-facing swap and staking experiences.

The bonding curve math module (`curve-math.ts`) is exemplary -- all BigInt, all matching on-chain formulas, with proper ceiling/floor rounding. The AMM quote engine (`quote-engine.ts`) is well-structured but uses JavaScript `number` type, creating a precision ceiling that mainnet pool sizes could breach. The graduation workflow has appropriate checkpoint+resume patterns but operates on an irreversible step before dependent steps complete. Staking reward calculation correctly uses BigInt for u128 intermediate values.

Overall, the business logic is mature and defensive. The primary concerns are Number-type precision limits in the AMM quote engine and float-to-int conversion imprecision in user input handling.

## Scope

**Files analyzed (18):**

| File | Layer | Risk Level | Notes |
|------|-------|-----------|-------|
| `app/lib/swap/quote-engine.ts` | Core math | High | Number-type AMM math |
| `app/lib/swap/route-engine.ts` | Core math | Medium | Path enumeration + quoting |
| `app/lib/swap/split-router.ts` | Core math | Medium | Grid search optimization |
| `app/lib/curve/curve-math.ts` | Core math | Low | BigInt, well-implemented |
| `app/lib/curve/curve-constants.ts` | Constants | Low | Must match on-chain |
| `app/lib/staking/rewards.ts` | Core math | Low | BigInt with Number output |
| `app/hooks/useSwap.ts` | Orchestrator | High | Swap lifecycle, input conversion |
| `app/hooks/useStaking.ts` | Orchestrator | Medium | Staking lifecycle |
| `app/hooks/useRoutes.ts` | Orchestrator | Medium | Route computation + split |
| `app/db/candle-aggregator.ts` | Data | Low | Display-only price data |
| `app/components/launch/BuyForm.tsx` | UI | Medium | Curve buy with validation |
| `app/components/launch/SellForm.tsx` | UI | Medium | Curve sell with tax calc |
| `scripts/graduation/graduate.ts` | Workflow | High | Irreversible state machine |
| `scripts/deploy/initialize.ts` | Workflow | Medium | Protocol bootstrap |
| `scripts/e2e/lib/swap-flow.ts` | Test | Low | E2E swap verification |
| `scripts/e2e/lib/staking-flow.ts` | Test | Low | E2E staking verification |
| `scripts/e2e/carnage-hunter.ts` | Test | Low | E2E carnage paths |
| `scripts/vrf/lib/swap-verifier.ts` | Test | Low | Swap math verification |

## Key Mechanisms

### 1. AMM Quote Engine (`app/lib/swap/quote-engine.ts`)

**Purpose:** Client-side replica of on-chain constant-product AMM math. Provides forward quotes (input -> output) and reverse quotes (desired output -> required input).

**Architecture:**
- Primitive functions: `calculateEffectiveInput`, `calculateSwapOutput`, `calculateTax`
- Composed quote functions: `quoteSolBuy`, `quoteSolSell`, `quoteVaultConvert`
- Reverse functions: `reverseQuoteSolBuy`, `reverseQuoteSolSell`, `reverseQuoteVaultConvert`

**Math correctness:**
- Uses `Math.floor` for forward (protocol-favored) and `Math.ceil` for reverse (user-pays-more)
- `BPS_DENOMINATOR = 10_000` matches on-chain constant
- Division-by-zero guard in `calculateSwapOutput` (returns 0 if denominator is 0)
- Feasibility checks in reverse functions (output < reserve)

**Concern -- Number type precision:**
Line 61: `Math.floor((reserveOut * effectiveInput) / denominator)`

If `reserveOut = 5_000_000_000_000` (5T lamports = 5000 SOL) and `effectiveInput = 2_000_000_000_000` (2000 SOL), the product is 1e25, far exceeding `Number.MAX_SAFE_INTEGER` (9.007e15). Current devnet pools are small, but mainnet pools could reach these sizes.

**Concern -- No explicit negative input guards:**
The public functions don't validate `amountIn >= 0`. The composed functions (`quoteSolBuy`, etc.) will produce positive-looking but incorrect results for negative inputs. The calling code (`computeRoutes`, `useSwap`) does guard against this, but the primitives themselves are unprotected.

### 2. Bonding Curve Math (`app/lib/curve/curve-math.ts`)

**Purpose:** BigInt port of on-chain quadratic bonding curve formula. Calculates tokens received for SOL input and SOL cost for token amounts.

**Architecture:**
- `bigintSqrt`: Newton's method integer square root
- `calculateTokensOut`: Quadratic formula with discriminant
- `calculateSolForTokens`: Linear integral with remainder recovery
- `calculateSellTax`: Ceil-rounded 15% BPS tax
- `getCurrentPrice`: Linear interpolation

**Correctness assessment:**
- All arithmetic uses BigInt -- no precision loss possible
- Floor rounding on buy (protocol-favored: user gets fewer tokens)
- Ceil rounding on sell cost and sell tax (protocol-favored: user pays more)
- Remainder recovery in `calculateSolForTokens` minimizes truncation error
- Cap at remaining supply in `calculateTokensOut`

This is the most security-conscious math module in the codebase. It follows SP-033 (BigNumber for financial math) from the secure patterns guide.

### 3. Route Engine (`app/lib/swap/route-engine.ts`)

**Purpose:** Enumerates all viable paths between any token pair, quotes each path, ranks by output.

**Architecture:**
- Static route graph (4 tokens, 8 directed edges)
- `enumeratePaths`: BFS-like 1-hop and 2-hop path discovery
- `quoteStep`: Maps graph edges to quote-engine calls
- `quoteRoute`: Chains step outputs as next step's input
- `computeRoutes`: Main entry point, returns sorted routes

**Observations:**
- Fee aggregation uses BPS summation (denomination-independent) -- correctly avoids the mixed-denomination trap
- Price impact summed across hops (additive, not compounded) -- slightly underestimates for multi-hop, but acceptable for display
- `quoteStep` vault conversion direction logic is correct: `isProfitInput = edge.neighborToken !== "PROFIT"` (if neighbor is PROFIT, we're going TO profit, so faction is input, not PROFIT)

### 4. Split Router (`app/lib/swap/split-router.ts`)

**Purpose:** Grid search for optimal 2-path split ratio.

**Architecture:**
- 99-iteration grid search (1% steps)
- `SPLIT_THRESHOLD_BPS = 50` (0.5% improvement required)
- Returns `SplitResult` with ratio, output, and comparison metrics

**Observations:**
- Input conservation: `inputB = totalInput - inputA` ensures no dust loss
- Guard against zero sides: `if (inputA <= 0 || inputB <= 0) continue`
- `improvementBps` correctly uses relative comparison (not absolute)

### 5. Staking Rewards (`app/lib/staking/rewards.ts`)

**Purpose:** Client-side Synthetix cumulative reward-per-token calculation.

**Architecture:**
- `PRECISION = 1e18` (BigInt)
- `calculatePendingRewards`: delta * staked / PRECISION + earned
- `calculateRewardRate`: Statistics for display (dead APR code retained for API stability)

**Observations:**
- All intermediate math is BigInt -- correct
- Final `Number(totalPending)` conversion is safe for lamport-range values (comment explains why)
- `calculateRewardRate` uses `number` type for display stats, with floating-point divisions for percentage calculations -- acceptable for display-only use
- `EPOCH_DURATION_SECONDS = 40` is devnet-specific. Mainnet will need updating.

### 6. Graduation Workflow (`scripts/graduation/graduate.ts`)

**Purpose:** Transitions protocol from bonding curve phase to AMM trading.

**Architecture:**
- 11 named steps with checkpoint+resume via JSON state file
- Steps: verify -> transition -> withdraw SOL -> close vaults -> create pools -> seed vault -> distribute escrow

**State machine analysis:**
- Step 2 (`prepareTransition`) is IRREVERSIBLE: sets both curves to Graduated
- Steps 7-8 (pool creation) depend on step 2 having succeeded
- Steps 3-4 (SOL withdrawal) provide the SOL for pool creation
- Steps 5-6 (vault closure) are optional (skip if non-empty)
- Steps 10-11 (escrow distribution) are permissionless (anyone can call)

**Concern -- Irreversibility ordering:**
Step 2 commits to graduation before pools exist. If steps 7-8 fail repeatedly (e.g., admin runs out of SOL for fees), the curves are permanently graduated but no AMM pools exist. Users cannot buy or sell. The checkpoint+resume pattern mitigates this (re-run to complete), but the gap between step 2 and steps 7-8 is a risk window.

**Concern -- Env override without validation:**
Lines 102-107 accept `SOL_POOL_SEED_SOL_OVERRIDE` and `SOL_POOL_SEED_TOKEN_OVERRIDE` via `Number()` conversion. NaN from invalid strings results in fallback to the hardcoded value (because `Number("invalid")` is NaN, which is falsy). This is accidentally safe but not intentionally validated.

### 7. useSwap Orchestrator (`app/hooks/useSwap.ts`)

**Purpose:** React hook managing the full swap lifecycle.

**State machine:** idle -> quoting -> building -> signing -> sending -> confirming -> confirmed/failed

**Key observations:**

1. **toBaseUnits conversion** (line 299): `Math.floor(parsed * 10 ** decimals)` -- this is the float precision issue. For `parsed = 0.1` and `decimals = 9`, the product is `0.09999999999999999...` which floors to `99999999` instead of `100000000`.

2. **Slippage enforcement** (line 407): `Math.floor(result.outputTokens * (10_000 - slippageBps) / 10_000)` -- this is correct: floor ensures user doesn't get more than they should expect.

3. **Cross-denomination fee display** (line 434-435): The sell fee percentage calculation adds tax percentage (SOL/SOL) and LP fee percentage (token/token) -- different units. This produces a misleading display number.

4. **executeRoute fallback** (line 824-826): If smart routing is off or no route selected, falls back to `executeSwap()`. If the selected route is single-hop non-split, also falls back. Only multi-hop/split routes use the atomic v0 path.

5. **Auto-reset timer** (line 774-776): 10-second auto-reset after confirmed state. The `resetForm` callback clears the auto-reset timer, preventing double-fire.

### 8. useStaking Orchestrator (`app/hooks/useStaking.ts`)

**Purpose:** React hook for stake/unstake/claim lifecycle.

**Key observations:**

1. **BigInt conversion from Anchor BN** (lines 249, 265): `BigInt(bn.toString())` for u128 fields -- this is the correct pattern. `bn.toNumber()` would silently lose precision for u128 values.

2. **Cooldown enforcement** (lines 338-379): Client-side countdown timer based on `lastClaimTs + COOLDOWN_SECONDS`. On-chain enforces the actual cooldown -- client-side is display-only.

3. **Minimum stake warning** (lines 431-443): Correctly detects partial unstake that would leave remaining below `MINIMUM_STAKE`. The warning is display-only -- on-chain enforces the minimum.

4. **toNumber safety** (line 248): `stakePoolAccount.totalStaked.toNumber()` for u64 fields. Max PROFIT supply is 20M * 10^6 = 2e13, well within safe integer range. Max SOL for pending/distributed is ~5e17, also within range.

### 9. BuyForm / SellForm Components

**BuyForm** (`app/components/launch/BuyForm.tsx`):
- Uses `BigInt(Math.floor(parsed * LAMPORTS_PER_SOL))` for SOL input -- same float precision issue as useSwap
- Per-wallet cap check (20M tokens) runs in debounce, correctly sets validationError
- Slippage: `minimumTokensOut = tokensOut * (10000n - slippageBps) / 10000n` -- BigInt, correct

**SellForm** (`app/components/launch/SellForm.tsx`):
- Sell position calculation: `startPosition = curve.tokensSold - baseUnits` -- correct (integrates from lower position)
- Tax: `calculateSellTax(gross)` -- correctly uses ceil-rounded BigInt function
- Slippage on NET amount (after tax): `minimumSolOut = netSol * (10000n - slippageBps) / 10000n` -- correct, matches on-chain check
- `skipPreflight: true` on both BuyForm and SellForm TX submission -- forces confirmation polling to catch errors

### 10. Candle Aggregator (`app/db/candle-aggregator.ts`)

**Purpose:** OHLCV upsert from swap events.

**Observations:**
- Price derivation excludes tax for buy direction: `netInput / swap.outputAmount` -- correct, prevents fake price jumps on tax rate changes
- SQL `GREATEST`/`LEAST` for atomic high/low tracking -- correct
- `open` column never overwritten (not in `set` clause) -- correct OHLCV semantics
- Division-by-zero guard: `if (price <= 0) return` -- correct
- All 6 resolutions run in parallel (no cross-contamination risk)

## Trust Model

The off-chain business logic operates in a trust hierarchy:

1. **On-chain programs** (out of scope): Source of truth for all financial state. Enforce slippage, caps, cooldowns, and state transitions.

2. **Client-side math engines** (`quote-engine.ts`, `curve-math.ts`, `rewards.ts`): Must match on-chain math for accurate previews. Errors here cause UX degradation (failed TXs, misleading displays) but not fund loss, because the on-chain program independently validates.

3. **Orchestrator hooks** (`useSwap.ts`, `useStaking.ts`): Compose math engines with wallet signing and TX submission. Trust boundary is at `minimumOutput` -- this is the user's protection parameter. If computed incorrectly low, users accept worse rates.

4. **Admin scripts** (`graduate.ts`, `initialize.ts`): Operate with full admin authority. No external input validation needed (admin controls the machine), but internal validation of env vars and on-chain state is important.

5. **Display components** (`BuyForm.tsx`, `SellForm.tsx`, `candle-aggregator.ts`): Lowest trust requirement. Errors are purely visual.

## State Analysis

**Client-side state:**
- React state in hooks (transient, per-session)
- `graduation-state.json` on disk (persistent checkpoint file)
- `alt-address.json` on disk (cached ALT address)
- `mint-keypairs/` directory (persistent mint keys)
- PostgreSQL candles/events tables (persistent, append-only)

**Shared state concerns:**
- Graduation state file has no integrity protection (no HMAC, no encryption). An attacker with filesystem access could mark steps as completed when they haven't been.
- No database transactions wrapping the 6 parallel candle upserts. If 3 of 6 succeed and 3 fail, candle data is partially updated. This is acceptable because each resolution is independent.

## Dependencies

- `@dr-fraudsworth/shared`: Constants package providing `PROGRAM_IDS`, `MINTS`, `VALID_PAIRS`, `SOL_POOL_FEE_BPS`, `VAULT_CONVERSION_RATE`, `TOKEN_DECIMALS`, etc. This is the single source of truth for protocol constants. If these drift from on-chain values, all client-side math diverges.
- `@coral-xyz/anchor`: Anchor framework for program interaction. Used for IDL-based account deserialization.
- `@solana/web3.js`: Transaction construction, RPC calls, keypair management.
- `@solana/spl-token`: Token-2022 operations, Transfer Hook account resolution.
- `drizzle-orm`: Database ORM for candle aggregation.

## Focus-Specific Analysis

### State Machine Analysis

**Swap state machine** (useSwap.ts):
States: idle -> quoting -> building -> signing -> sending -> confirming -> confirmed/failed
- No explicit transition validation (state is set directly with `setStatus`)
- The hook is single-threaded (React state updates are batched), so concurrent state transitions are not possible
- `clearTerminalStatus` resets from confirmed/failed to idle when user starts editing
- Auto-reset timer fires after 10s in confirmed state

**Staking state machine** (useStaking.ts):
States: idle -> building -> signing -> sending -> confirming -> confirmed/failed
- Same pattern as swap, no explicit transition validation
- Cooldown is enforced on-chain, client-side timer is display-only

**Graduation state machine** (graduate.ts):
Steps: strictly sequential with checkpoint+resume
- Steps cannot be skipped (loop iterates in order)
- Steps cannot run out of order (single-threaded script)
- Partial completion is safely resumable
- No explicit "rollback" capability for the irreversible step 2

### Negative Value Analysis

Per AIP-160 (no negative value validation), I checked all input paths:

| Entry Point | Guard | Location |
|------------|-------|----------|
| `computeRoutes` | `inputAmount <= 0` early return | route-engine.ts:388 |
| `quoteVaultConvert` | `inputAmount <= 0` early return | quote-engine.ts:240 |
| `useSwap.setInputAmount` | `parseFloat(amount) <= 0` clears output | useSwap.ts:538 |
| `useSwap.setOutputAmount` | `parseFloat(amount) <= 0` clears input | useSwap.ts:564 |
| `useStaking.execute` | `parsedAmount <= 0` sets error | useStaking.ts:494 |
| `BuyForm` | `parsed <= 0` sets error | BuyForm.tsx:105 |
| `SellForm` | `parsed <= 0` sets error | SellForm.tsx:114 |
| `quoteSolBuy` | **NO guard** | quote-engine.ts:132 |
| `quoteSolSell` | **NO guard** | quote-engine.ts:187 |
| `calculateTokensOut` | `solLamports === 0n` returns 0 | curve-math.ts:88 |
| `calculateSolForTokens` | `tokens === 0n` returns 0 | curve-math.ts:150 |

The quote-engine primitives lack negative guards, but all calling paths validate first. This is defense-in-depth gap, not an exploitable vulnerability.

### Fee Calculation Analysis

Per AIP-164 (fee rounds to zero for small amounts):

| Function | Fee Formula | Minimum Fee? |
|---------|-------------|-------------|
| `calculateTax` | `Math.floor(amount * taxBps / 10000)` | No minimum |
| `calculateEffectiveInput` | `Math.floor(amountIn * (10000 - feeBps) / 10000)` | No minimum |
| `calculateSellTax` (curve) | `ceil(sol * 1500 / 10000)` via BigInt | Implicitly 1 for any non-zero input |

The AMM tax calculation (`calculateTax`) can produce zero tax for small amounts. Example: `calculateTax(24, 400)` = `Math.floor(24 * 400 / 10000)` = `Math.floor(0.96)` = 0. On a 4% buy tax, any SOL input below 25 lamports pays zero tax. This is matched by the on-chain behavior (same formula), so it's consistent but worth noting for dust-amount fee avoidance.

## Cross-Focus Intersections

1. **LOGIC-01 x LOGIC-02**: The Number-type arithmetic in quote-engine.ts overlaps with financial precision concerns. LOGIC-02 should verify exact precision boundaries.

2. **LOGIC-01 x CHAIN-06**: Pool reserves read by `usePoolPrices` feed into route-engine quotes. Stale reserves produce stale quotes. The commitment level and refresh interval matter.

3. **LOGIC-01 x CHAIN-01**: The `minimumOutput` parameter flows from client-side math into on-chain TX instructions. This is the bridge between client-side logic and on-chain enforcement.

4. **LOGIC-01 x SEC-01**: Graduation script handles admin keypairs and performs irreversible operations. Key security matters here.

5. **LOGIC-01 x FE-01**: Display issues (cross-denomination fee percentage, split route zero fees) affect user understanding but not fund safety.

## Cross-Reference Handoffs

| Target Agent | Handoff Item | Context |
|-------------|-------------|---------|
| LOGIC-02 | Verify Number arithmetic precision boundary for quote-engine.ts | At what pool reserve size does `reserveOut * effectiveInput` exceed MAX_SAFE_INTEGER? |
| CHAIN-06 | Verify commitment level for pool reserve reads in usePoolPrices | Stale reserves -> stale quotes -> suboptimal minimumOutput |
| CHAIN-01 | Verify on-chain slippage enforcement for all swap paths | Does on-chain check minimumOutput for vault converts? |
| SEC-01 | Verify graduation script key handling and state file integrity | No HMAC on graduation-state.json |
| CHAIN-02 | Verify graduation irreversibility implications | What happens if admin abandons graduation between step 2 and step 7? |

## Risk Observations

### HIGH

1. **quote-engine Number overflow** (`app/lib/swap/quote-engine.ts:61`): `reserveOut * effectiveInput` exceeds MAX_SAFE_INTEGER for large pool reserves. Impact: incorrect minimumOutput, potential suboptimal swap execution. Likelihood: Possible on mainnet. Mitigation: Convert quote-engine to BigInt.

2. **float-to-int conversion precision loss** (`app/hooks/useSwap.ts:299`, `app/hooks/useStaking.ts:499`): `Math.floor(parseFloat(amount) * 10 ** decimals)` loses 1 unit for certain decimal values. Impact: user submits 1 lamport/unit less than intended. Likelihood: Probable (occurs for common amounts like 0.1 SOL). Mitigation: Use string-based decimal parsing (split on ".", pad, combine as integer).

### MEDIUM

3. **Cross-denomination fee display** (`app/hooks/useSwap.ts:434-435`): Misleading fee percentage for sell quotes. Impact: UX only. Mitigation: Use BPS summation (already done in route-engine).

4. **Graduation env override lacks bounds** (`scripts/graduation/graduate.ts:106`): Invalid override values could create misconfigured pools. Impact: Operational risk. Mitigation: Add explicit validation with minimum/maximum bounds.

5. **Split route zero fees** (`app/hooks/useRoutes.ts:176-177`): `totalLpFee: 0` and `totalTax: 0` may confuse downstream code. Impact: Display. Mitigation: Use `null` or compute aggregated display values.

6. **BuyForm validation timing** (`app/components/launch/BuyForm.tsx:122-144`): Balance check may clear error before cap check runs. Impact: The current code is actually correct (both checks run in the same setTimeout), but the sequence is fragile. Mitigation: Run all validation checks before setting/clearing error.

7. **Candle float price** (`app/db/candle-aggregator.ts:170-175`): Float division for price derivation accumulates rounding errors. Impact: Chart display only. Mitigation: Accept as known limitation for display data.

### LOW

8. **No negative guards on quote primitives** (`app/lib/swap/quote-engine.ts:37-76`): Direct callers could produce nonsensical results. Impact: Low (all current callers validate). Mitigation: Add `if (amountIn < 0) return 0` guards.

9. **Devnet-specific constants** (`app/lib/staking/rewards.ts:108`): `EPOCH_DURATION_SECONDS = 40` is devnet-specific. Impact: Incorrect APR/APY display on mainnet (dead code currently). Mitigation: Make configurable.

10. **Graduation state file unprotected** (`scripts/graduation/graduate.ts:147`): JSON file on disk with no integrity verification. Impact: Requires filesystem access. Mitigation: Accept (admin machine security is prerequisite).

11. **bnToNumber for event amounts** (`app/lib/event-parser.ts:161-174`): Converts Anchor BN to Number for swap event amounts. Safe for current token supplies but lacks explicit bounds check. Impact: Display data for candle aggregation.

12. **Dead code in rewards.ts** (`app/lib/staking/rewards.ts:96-115`): `calculateRewardRate` APR calculation is documented as dead code (legal reasons). The `EPOCH_DURATION_SECONDS` and `EPOCHS_PER_YEAR` constants are still computed. Impact: None currently. Mitigation: Consider removing dead code paths.

## Novel Attack Surface Observations

1. **Quote-engine as a sandwiching amplifier**: If an attacker sandwiches a large swap, the client's quote engine pre-computes minimumOutput based on the pre-sandwich pool state. The on-chain slippage check should reject the sandwiched TX, but if the sandwich is small enough to stay within slippage tolerance, the attacker profits. The quote engine's Number precision loss could make the slippage bounds slightly wider than intended, giving the sandwich attacker slightly more room.

2. **Split route as MEV opportunity**: The split router recommends splitting across two pools. If both legs are submitted atomically (v0 TX), this is safe. But the split ratio is computed client-side with stale pool state. An attacker who sees the split TX in the mempool knows which pools will be affected and by how much, enabling targeted sandwich attacks on the leg with more impact.

3. **Graduation timing window**: Between step 2 (curves graduated) and steps 7-8 (pools created), the protocol is in a state where bonding curves are closed but AMM pools don't exist. If this window is long (hours due to admin being away), users cannot trade. This is a denial-of-service risk, not a fund loss risk.

## Questions for Other Focus Areas

1. **For CHAIN-06**: What commitment level does `usePoolPrices` use for pool reserve reads? If `processed`, quotes could be based on state that gets rolled back.

2. **For CHAIN-01**: Does `buildSolBuyTransaction` set compute budget limits? If the quote engine calculates a route that requires more CUs than budgeted, the TX fails silently.

3. **For SEC-02**: The `VAULT_CONVERSION_RATE` constant (100) is hardcoded in `@dr-fraudsworth/shared`. Is this value identical to what's on-chain? A mismatch would cause vault convert quotes to diverge from execution.

4. **For LOGIC-02**: What is the exact Number.MAX_SAFE_INTEGER threshold for pool reserves in the constant-product formula? Calculate: at what `reserveOut` value does `reserveOut * effectiveInput > 2^53` for a typical swap size of 100 SOL?

## Raw Notes

- quote-engine.ts has excellent documentation -- every function documents its on-chain mirror, rounding behavior, and parameter semantics
- The vault conversion functions handle both directions (faction->PROFIT and PROFIT->faction) via a boolean flag, which is clean but could be confusing to future developers
- The route graph is static (hardcoded adjacency list) with a `buildRouteGraph()` function that currently just returns the constant -- suggests future plans for dynamic pool support
- The anti-flicker mechanism in useRoutes.ts (FLICKER_THRESHOLD_BPS = 10) prevents route selection from jumping when price changes are small -- good UX pattern
- The graduation script's `loadMintKeypair` function reads keypair bytes from disk, which is standard for admin scripts but should be noted for SEC-01
- BuyForm and SellForm both use `skipPreflight: true` for TX submission -- this is a deliberate choice documented in MEMORY.md (Phantom devnet RPC workaround)
- The carnage-hunter E2E test uses hardcoded action codes (`ACTION_NONE = 0`, `ACTION_BURN = 1`, `ACTION_SELL = 2`) that must match on-chain enum ordering -- fragile coupling but acceptable for test code
