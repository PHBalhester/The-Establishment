---
task_id: db-phase1-financial-economic-logic
provides: [financial-economic-logic-findings, financial-economic-logic-invariants]
focus_area: financial-economic-logic
files_analyzed:
  - app/lib/swap/quote-engine.ts
  - app/lib/swap/route-engine.ts
  - app/lib/swap/split-router.ts
  - app/lib/swap/swap-builders.ts
  - app/lib/curve/curve-math.ts
  - app/lib/curve/curve-constants.ts
  - app/lib/staking/rewards.ts
  - app/hooks/useSwap.ts
  - app/hooks/useStaking.ts
  - app/hooks/useCurveState.ts
  - app/components/launch/BuyForm.tsx
  - app/components/launch/SellForm.tsx
  - app/components/launch/BuySellPanel.tsx
  - shared/constants.ts
  - scripts/graduation/graduate.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Financial & Economic Logic -- Condensed Summary

## Key Findings (Top 10)

1. **quote-engine.ts uses JavaScript `number` for all AMM math**: All reserve values, swap amounts, tax/fee calculations use `Math.floor(amountIn * (BPS_DENOMINATOR - feeBps) / BPS_DENOMINATOR)` with `number` type. For large pool reserves (>9e15 lamports = ~9000 SOL), `reserveOut * effectiveInput` can exceed `Number.MAX_SAFE_INTEGER`, causing silent precision loss. -- `app/lib/swap/quote-engine.ts:37-62`

2. **Bonding curve math correctly uses BigInt throughout**: `curve-math.ts` and `curve-constants.ts` use BigInt for all calculations, properly mirroring on-chain Rust u128 arithmetic. Intermediates reaching ~2.5e36 are handled safely. -- `app/lib/curve/curve-math.ts:84-118`

3. **Staking reward calculation mixes BigInt and Number**: `calculatePendingRewards()` correctly uses BigInt for the delta/multiply/divide pipeline, then converts final result to Number. The comment claims max SOL supply is ~5e17 which is BELOW `Number.MAX_SAFE_INTEGER` (~9e15) -- this claim is incorrect; 5e17 > 9e15. However, practical reward accumulation per user will never approach 500M SOL, so this is safe in practice. -- `app/lib/staking/rewards.ts:64-83`

4. **`calculateRewardRate()` uses floating-point division for display-only values**: `totalStakedProfit = totalStakedBaseUnits / 10 ** PROFIT_DECIMALS` and `userSharePct` use native Number division. Since these are display-only (not used in transaction construction), this is acceptable but worth noting. -- `app/lib/staking/rewards.ts:138-166`

5. **Fee percentage display in useSwap uses mixed-denomination arithmetic**: In the SOL sell path, `totalFeePct` is computed as `(taxAmount / grossSolOutput) * 100 + (lpFee / baseUnits) * 100`. The LP fee is in token base units and baseUnits is also in tokens, so this is dimensionally correct but adds percentages from different fee stages. -- `app/hooks/useSwap.ts:433-436`

6. **route-engine.ts totalLpFee and totalTax sum across different denominations**: For multi-hop routes, `totalLpFee` and `totalTax` accumulate amounts from different token denominations (lamports + token base units). The code recognized this and switched fee display to BPS-based `totalFeeBps` summation, but the absolute `totalLpFee`/`totalTax` fields remain in the Route object and could mislead consumers. -- `app/lib/swap/route-engine.ts:300-332`

7. **BuyForm converts float balance to BigInt with potential precision loss**: `currentHoldings = BigInt(Math.floor(crimeBalance * Number(TOKEN_DECIMAL_FACTOR)))`. Since `crimeBalance` is a `number` from `useTokenBalances` and `TOKEN_DECIMAL_FACTOR` is `1_000_000n`, the multiplication `crimeBalance * 1000000` could lose precision for balances > ~9 billion tokens (unlikely but worth noting). -- `app/components/launch/BuyForm.tsx:84-86`

8. **Curve constants match on-chain Rust exactly**: Verified `P_START=900`, `P_END=3450`, `TOTAL_FOR_SALE=460_000_000_000_000`, `SELL_TAX_BPS=1500`, `BPS_DENOMINATOR=10000`, `PRECISION=1e12` all match `programs/bonding_curve/src/constants.rs`. -- `app/lib/curve/curve-constants.ts` vs `programs/bonding_curve/src/constants.rs`

9. **Slippage protection properly applied in both BuyForm and SellForm**: BuyForm applies slippage to token output (`tokensOut * (10000n - slippageBps) / 10000n`). SellForm applies slippage to net SOL after tax. Both use BigInt arithmetic. -- `app/components/launch/BuyForm.tsx:168-169`, `app/components/launch/SellForm.tsx:177-178`

10. **SellForm correctly computes sell position**: `startPosition = curve.tokensSold - baseUnits` before calling `calculateSolForTokens(startPosition, baseUnits)`. This matches the on-chain integration logic (area under curve from post-sell position). -- `app/components/launch/SellForm.tsx:139-141`

## Critical Mechanisms

- **AMM Quote Engine (quote-engine.ts)**: All forward/reverse quotes for SOL pools use JavaScript `number` with Math.floor/Math.ceil. Order of operations matches on-chain: Buy = tax -> LP fee -> AMM; Sell = LP fee -> AMM -> tax. Reverse quotes use ceiling division to ensure the user always provides enough input. Concern: `number` type limits safe precision to ~9e15, which could be exceeded by `reserveOut * effectiveInput` for pools with > ~9000 SOL in reserves. -- `app/lib/swap/quote-engine.ts:1-382`

- **Bonding Curve Math (curve-math.ts)**: BigInt port of quadratic formula for buy, linear integral for sell, Newton's method isqrt. All intermediates stay in BigInt. Ceil-rounded sell tax (protocol-favored). Floor-rounded buy output (protocol-favored). Supply cap enforced. -- `app/lib/curve/curve-math.ts:1-229`

- **Staking Rewards (rewards.ts)**: Synthetix pattern with PRECISION=1e18 scaling. BigInt for u128 reward-per-token fields. Number conversion only at final output. Display-only reward rate stats use floating-point (acceptable). -- `app/lib/staking/rewards.ts:1-166`

- **Split Router (split-router.ts)**: 1% granularity grid search (99 iterations) to find optimal split across two parallel paths. Threshold of 50 BPS before recommending split. Pure function, no side effects. -- `app/lib/swap/split-router.ts:1-147`

## Invariants & Assumptions

- INVARIANT: All bonding curve math uses BigInt (no Number for intermediates) -- enforced at `app/lib/curve/curve-math.ts` (all functions use bigint params/returns)
- INVARIANT: Sell tax is ceil-rounded (protocol-favored) -- enforced at `app/lib/curve/curve-math.ts:202-204` via `(solGross * SELL_TAX_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR`
- INVARIANT: AMM buy output is floor-rounded (protocol-favored) -- enforced at `app/lib/swap/quote-engine.ts:61` via `Math.floor()`
- INVARIANT: Reverse quotes use ceiling division (user always provides enough) -- enforced at `app/lib/swap/quote-engine.ts:288-300`
- INVARIANT: Minimum purchase enforced at 0.05 SOL -- enforced at `app/components/launch/BuyForm.tsx:116-119`
- INVARIANT: Per-wallet token cap enforced at 20M tokens -- enforced at `app/components/launch/BuyForm.tsx:140-144` (client-side) + on-chain
- ASSUMPTION: Pool reserves will not exceed ~9e15 lamports (~9000 SOL) for `number` arithmetic safety in quote-engine.ts -- UNVALIDATED (no guard exists)
- ASSUMPTION: `totalPending` reward value fits in Number when converted from BigInt -- validated by comment but incorrectly states 5e17 < 9e15 (`app/lib/staking/rewards.ts:79-82`)
- ASSUMPTION: Token balances from `useTokenBalances` fit in JavaScript Number without precision loss -- validated (max supply is 1B tokens * 1e6 decimals = 1e15, within safe range)
- ASSUMPTION: Curve constants in client-side code stay in sync with on-chain constants.rs -- currently validated (manual verification shows exact match)

## Risk Observations (Prioritized)

1. **HIGH -- quote-engine.ts Number overflow for large reserves**: If either AMM pool grows to hold >~9000 SOL in reserves, `reserveOut * effectiveInput` will exceed `Number.MAX_SAFE_INTEGER` and produce silently wrong quotes. This could cause users to receive worse execution than expected, or the on-chain slippage check could reject the TX (safer outcome). The on-chain Rust code uses u64 which handles up to ~18.4e18. `app/lib/swap/quote-engine.ts:54-62`

2. **HIGH -- Staking rewards comment claims safe range incorrectly**: Comment says "max SOL supply is ~5e17 lamports, well below Number.MAX_SAFE_INTEGER (2^53 - 1 = ~9e15)". But 5e17 > 9e15. The actual `Number.MAX_SAFE_INTEGER` is ~9.007e15. In practice, individual user rewards will be far below this threshold, but the safety claim in the comment is mathematically wrong. `app/lib/staking/rewards.ts:79-82`

3. **MEDIUM -- Mixed-denomination fee totals in Route objects**: `totalLpFee` and `totalTax` in multi-hop routes sum amounts across different token denominations. The display code uses BPS-based `totalFeePct` which is correct, but the absolute amounts remain in the Route interface. Any future consumer using these absolute values for financial decisions would get wrong results. `app/lib/swap/route-engine.ts:300-315`

4. **MEDIUM -- No negative amount guard on quote-engine inputs**: `quoteSolBuy`, `quoteSolSell`, etc. do not validate that amounts and reserves are positive. Negative values would produce mathematically valid but semantically wrong results. The route-engine guards `inputAmount <= 0` but individual quote functions are public exports. `app/lib/swap/quote-engine.ts:37-76`

5. **MEDIUM -- Fee percentage display uses different calculation paths**: The SOL buy path in useSwap computes fee% as `(totalFeeAmount / baseUnits) * 100`, while the route-engine computes it as BPS summation `totalFeeBps / 100`. These two paths can show different percentages for the same trade depending on whether smart routing is on/off. `app/hooks/useSwap.ts:408-411` vs `app/lib/swap/route-engine.ts:331-332`

6. **MEDIUM -- BuyForm skips preflight**: `skipPreflight: true` on the purchase TX means simulation errors won't be caught before submission. The on-chain program enforces all constraints, but failed TXs waste user SOL on fees. `app/components/launch/BuyForm.tsx:188-189`

7. **MEDIUM -- Graduation script reads pool seed from env with Number()**: `Number(process.env.SOL_POOL_SEED_SOL_OVERRIDE)` converts string to Number for a lamport value. For 1000 SOL = 1e12 lamports, this is safe (well under 9e15). But the pattern is fragile. `scripts/graduation/graduate.ts:102-107`

8. **LOW -- calculateRewardRate EPOCH_DURATION_SECONDS hardcoded to devnet**: `EPOCH_DURATION_SECONDS = 40` is hardcoded for devnet (~100 slots * 0.4s). Production epochs will be ~30 minutes. This will produce wildly wrong annualized APR estimates on mainnet if not updated. The field is currently dead code (legal reasons), but worth tracking. `app/lib/staking/rewards.ts:108-114`

9. **LOW -- Demo mode hardcodes Number conversion of BigInt**: `getDemoCurveState` does `BigInt(Math.floor(Number(TOTAL_FOR_SALE) * progress))` where `TOTAL_FOR_SALE` is 460e12. `Number(460e12) = 460000000000000` which is within safe integer range (4.6e14 < 9e15). Harmless for demo but poor pattern. `app/hooks/useCurveState.ts:191-192`

10. **LOW -- Sell form does not enforce minimum sell amount**: BuyForm enforces `MIN_PURCHASE_SOL` (0.05 SOL minimum). SellForm has no minimum token sell amount. On-chain may enforce this, but client-side lacks the guard, allowing users to attempt dust sells that could fail on-chain. `app/components/launch/SellForm.tsx:100-158`

## Novel Attack Surface

- **Quote-engine / on-chain divergence for edge-case amounts**: The off-chain quote-engine uses JavaScript `number` (IEEE 754 double) while on-chain uses Rust `u64`/`u128`. For amounts near `Number.MAX_SAFE_INTEGER`, the off-chain quote could differ from the on-chain result by several units. An attacker could exploit this divergence to craft trades where the client-side slippage check passes but the actual on-chain output is different. The on-chain slippage check is the safety net, but users could be shown misleading preview amounts.

- **Split router grid search granularity**: The 1% granularity grid search tests only 99 splits. For very large trades where the optimal split might be at e.g., 33.7%, the grid would test 33% and 34% but miss the optimum. An MEV bot observing the split ratio could position liquidity to extract value from the suboptimal split.

## Cross-Focus Handoffs

- **CHAIN-06 (On-Chain/Off-Chain Parity)**: The fundamental risk in this codebase is quote-engine.ts using JavaScript `number` while on-chain uses Rust u64/u128. Need verification that pool reserves will stay within safe Number range at mainnet scale, or migration to BigInt for quote-engine.
- **BOT-01 (Crank/Keeper Security)**: Staking reward accumulation and epoch transition timing affect reward calculation accuracy. If the crank fails to call `update_cumulative()` at epoch boundaries, `pendingRewards` accumulates and the client-side reward display diverges from reality.
- **CHAIN-01 (Transaction Construction)**: swap-builders.ts constructs transactions using BN (Anchor's BigNumber) for on-chain instruction arguments, but receives amounts as JavaScript `number` from useSwap. The `new BN(amountInLamports)` conversion at `swap-builders.ts:256-258` is safe only if `amountInLamports` is within safe integer range.
- **ERR-01 (Error Handling)**: BuyForm and SellForm catch errors broadly but display them as strings via `parseCurveError()`. Financial errors (slippage exceeded, insufficient balance) should be distinguished from infrastructure errors (RPC timeout) for proper user guidance.

## Trust Boundaries

The financial calculation stack has a clear trust boundary: client-side math (quote-engine, curve-math, rewards) is used for DISPLAY ONLY. All actual financial enforcement happens on-chain via slippage checks, balance validations, and program constraints. The client trusts RPC responses for pool reserve data and epoch state, which feeds into quote calculations. A malicious/stale RPC could provide wrong reserves, causing the client to show misleading quotes, but on-chain slippage protection would reject unfavorable executions. The most sensitive trust boundary is between the JavaScript `number`-based quote engine and the Rust `u64`-based on-chain program -- divergence between these two systems could mislead users about expected trade outcomes.
<!-- CONDENSED_SUMMARY_END -->

---

# Financial & Economic Logic -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements three distinct financial subsystems off-chain: (1) AMM constant-product swap quoting for SOL/token pools, (2) bonding curve quadratic math for initial token sale/buyback, and (3) Synthetix-pattern staking reward calculation. Each subsystem mirrors on-chain Rust code for client-side preview purposes.

The bonding curve math (`curve-math.ts`) is the strongest implementation -- it uses BigInt throughout, correctly handles the quadratic formula with intermediates reaching 2.5e36, and matches on-chain constants exactly. The staking reward calculation (`rewards.ts`) appropriately uses BigInt for u128 fields and only converts to Number at the final output step.

The primary concern is the AMM quote engine (`quote-engine.ts`), which uses JavaScript `number` for all calculations. While this works for current pool sizes (devnet pools seeded with ~2.5 SOL), mainnet pools could grow to sizes where `reserveOut * effectiveInput` exceeds `Number.MAX_SAFE_INTEGER`, producing silently incorrect quotes. The on-chain slippage check provides a safety net, but users would see misleading preview amounts.

## Scope

All off-chain TypeScript files tagged LOGIC-02 in the INDEX, plus supplementary files discovered via signature scan. On-chain Anchor/Rust programs were consulted only for constant verification (parity check), not for vulnerability analysis.

Files analyzed in full (Layer 3):
- `app/lib/swap/quote-engine.ts` (382 lines)
- `app/lib/swap/route-engine.ts` (417 lines)
- `app/lib/swap/split-router.ts` (147 lines)
- `app/lib/swap/swap-builders.ts` (508 lines)
- `app/lib/curve/curve-math.ts` (229 lines)
- `app/lib/curve/curve-constants.ts` (75 lines)
- `app/lib/staking/rewards.ts` (166 lines)
- `app/hooks/useSwap.ts` (937 lines)
- `app/hooks/useStaking.ts` (691 lines)
- `app/hooks/useCurveState.ts` (419 lines)
- `app/components/launch/BuyForm.tsx` (345 lines)
- `app/components/launch/SellForm.tsx` (369 lines)
- `shared/constants.ts` (475 lines)

Files analyzed at Layer 2 (signature scan):
- `app/components/launch/BuySellPanel.tsx`
- `scripts/graduation/graduate.ts`
- `scripts/deploy/lib/pda-manifest.ts`

## Key Mechanisms

### 1. AMM Quote Engine (quote-engine.ts)

Three primitive functions mirror on-chain math.rs:
- `calculateEffectiveInput(amountIn, feeBps)`: `Math.floor(amountIn * (10000 - feeBps) / 10000)`
- `calculateSwapOutput(reserveIn, reserveOut, effectiveInput)`: `Math.floor(reserveOut * effectiveInput / (reserveIn + effectiveInput))`
- `calculateTax(amountLamports, taxBps)`: `Math.floor(amountLamports * taxBps / 10000)`

**Order of operations:**
- SOL Buy: tax(input) -> LP fee -> AMM
- SOL Sell: LP fee(input) -> AMM -> tax(output)
- Vault Convert: fixed 100:1, no fees

**Reverse quotes** use ceiling division throughout: `Math.ceil(numerator / denominator)`. This ensures the computed input always covers the desired output.

**Concern:** All parameters are JavaScript `number`. The intermediate `reserveOut * effectiveInput` in `calculateSwapOutput` could exceed `Number.MAX_SAFE_INTEGER` (9.007e15) when reserves grow large. For example, if `reserveOut = 1e13` (10M tokens) and `effectiveInput = 1e9` (1 SOL in lamports), the product is `1e22`, which loses precision as a Number.

### 2. Bonding Curve Math (curve-math.ts)

Pure BigInt implementation of:
- `calculateTokensOut(solLamports, currentSold)`: Quadratic formula with discriminant, Newton's method isqrt
- `calculateSolForTokens(currentSold, tokens)`: Linear integral with remainder recovery for precision
- `calculateSellTax(solGross)`: Ceil-rounded 15% via `(solGross * 1500n + 9999n) / 10000n`
- `getCurrentPrice(tokensSold)`: Linear interpolation P_START to P_END
- `bigintSqrt(n)`: Newton's method integer square root

All functions use BigInt parameters and return BigInt. The `calculateSolForTokens` function uses a remainder recovery technique (`product % two_total`) to minimize truncation error in the division step, which is a notable precision safeguard.

### 3. Staking Rewards (rewards.ts)

Synthetix/Quarry cumulative reward-per-token pattern:
```
delta = pool.rewardsPerTokenStored - user.rewardsPerTokenPaid
newPending = (userStakedBalance * delta) / PRECISION
totalPending = userRewardsEarned + newPending
```

PRECISION = 1e18 (BigInt). All intermediate calculations use BigInt. Only the final `Number(totalPending)` conversion uses JavaScript Number.

### 4. Route Engine (route-engine.ts)

Static topology graph: SOL <-> CRIME, SOL <-> FRAUD, CRIME <-> PROFIT, FRAUD <-> PROFIT. Enumerates single-hop and 2-hop paths. Quotes each path by chaining step outputs as next step inputs. Ranks routes by output amount descending.

Fee display uses BPS summation (`sum of lpFeeBps + taxBps per step`) rather than amount-based calculation, which is correct for cross-denomination hops.

### 5. Split Router (split-router.ts)

Grid search from 1% to 99% in 1% increments. Compares split output vs best single-path output. Recommends split only if improvement >= 50 BPS. Pure function with generic quoter callbacks.

## Trust Model

- **RPC responses for pool reserves**: Trusted for display quoting. Stale/malicious reserves would produce wrong quotes, but on-chain slippage checks protect against execution at bad rates.
- **RPC responses for epoch state**: Tax rates come from EpochState account. Wrong rates would show incorrect tax previews but on-chain enforces actual rates.
- **RPC responses for curve state**: tokensSold, solRaised from CurveState. Stale data would show wrong bonding curve position. WebSocket subscription provides push updates at "confirmed" commitment level.
- **User input**: parseFloat for amounts, regex-filtered to digits and decimal point. No negative amounts possible via UI input pattern, but the underlying quote functions accept negative values without guard.

## State Analysis

- **No databases used** in financial calculation code. All state is in-memory React state or fetched from Solana RPC.
- **Polling intervals**: Pool reserves polled at configurable intervals via usePoolPrices. Staking data polled every 30 seconds. Curve state via WebSocket with burst-refresh on tab visibility change.
- **Caching**: No explicit caching of financial state beyond React state. Each re-render could trigger re-computation.

## Dependencies

- `@solana/web3.js`: Connection, PublicKey, Transaction construction
- `@solana/spl-token`: Token program IDs, ATA derivation
- `@coral-xyz/anchor`: BN type for on-chain instruction arguments, program account fetching
- `@dr-fraudsworth/shared`: Constants (exported from shared/constants.ts within the monorepo)

No external financial math libraries (BigNumber.js, Decimal.js, big.js) are used. The codebase relies on native BigInt for bonding curve/staking math and native Number for AMM math.

## Focus-Specific Analysis

### Floating-Point Arithmetic Assessment (AIP-159)

**Quote-engine.ts**: Uses JavaScript `number` for AMM constant-product math. This is the primary floating-point concern in the codebase. The formula `Math.floor(reserveOut * effectiveInput / denominator)` uses native Number arithmetic, which is IEEE 754 double-precision with 53 bits of mantissa (~15.9 decimal digits).

For the current devnet setup (pools seeded with ~2.5 SOL = 2.5e9 lamports, ~290M tokens = 290e12 base units), the worst-case intermediate is `290e12 * 2.5e9 = 7.25e23`, which far exceeds Number.MAX_SAFE_INTEGER. **This is already a concern at current pool sizes for the token-side reserve multiplication.**

Wait -- let me reconsider. The pool is seeded with 290M tokens at 6 decimals = 290,000,000,000,000 base units = 2.9e14. And WSOL reserve of 2.5 SOL = 2.5e9 lamports. So `reserveOut * effectiveInput` = `2.9e14 * 2.5e9` = `7.25e23`. This exceeds Number.MAX_SAFE_INTEGER by a factor of ~80,000.

**This means quote-engine.ts is ALREADY producing imprecise results at current devnet pool sizes.** The precision loss for a typical swap would be small (a few base units), and the on-chain slippage check would catch any significant divergence. But for large swaps relative to pool size, the divergence between client-side quote and on-chain execution could be noticeable.

**Curve-math.ts**: Correctly uses BigInt throughout. No floating-point concerns.

**Rewards.ts**: Correctly uses BigInt for the core calculation. The final `Number(totalPending)` is documented as safe for the value range.

### Negative Amount Handling (AIP-160)

- `computeRoutes()` guards `inputAmount <= 0` -- returning empty array.
- `quoteVaultConvert()` guards `inputAmount <= 0` -- returning zero output.
- `quoteSolBuy()` and `quoteSolSell()` do NOT guard against negative inputs. Negative `solAmountLamports` would produce negative `taxAmount`, which could result in `netInput > solAmountLamports` (getting more input than provided). This is mitigated by the UI's regex filter preventing negative input, but the functions are public exports.
- `BuyForm.tsx` validates `parsed > 0` and `SellForm.tsx` validates `parsed > 0`.

### Integer Overflow Assessment (AIP-166, AIP-168)

- **curve-math.ts**: Safe -- uses BigInt which has arbitrary precision.
- **rewards.ts**: Safe for core calculation (BigInt). The `Number(totalPending)` conversion is safe for practical values but the comment's safety claim is mathematically wrong (5e17 > 9e15, not "well below").
- **quote-engine.ts**: UNSAFE -- as analyzed above, intermediate multiplications already exceed Number.MAX_SAFE_INTEGER at current pool sizes.

### Fee Calculation Assessment (AIP-164)

- `calculateTax(amountLamports, taxBps)`: Uses `Math.floor`, so for small amounts, tax can round to zero. Example: `calculateTax(1, 400)` = `Math.floor(1 * 400 / 10000)` = `Math.floor(0.04)` = 0. The minimum purchase of 0.05 SOL (50,000,000 lamports) produces `Math.floor(50000000 * 400 / 10000)` = 2,000,000 lamports, which is non-zero. So the minimum purchase guard effectively prevents zero-tax dust attacks on the buy path. No minimum exists for the sell path in the AMM (only the bonding curve sell has no minimum).
- `calculateSellTax` in curve-math.ts uses ceiling division: `(solGross * 1500n + 9999n) / 10000n`. This ensures the protocol always collects at least 1 lamport of tax for any non-zero gross. This is a correct and secure pattern.

### On-Chain/Off-Chain Constant Parity

| Constant | Client-Side | On-Chain (Rust) | Match |
|----------|------------|-----------------|-------|
| P_START | 900n | 900 u128 | Yes |
| P_END | 3,450n | 3,450 u128 | Yes |
| TOTAL_FOR_SALE | 460,000,000,000,000n | 460,000,000,000,000 u128 | Yes |
| PRECISION (curve) | 1,000,000,000,000n | 1,000,000,000,000 u128 | Yes |
| SELL_TAX_BPS | 1,500n | 1,500 u64 | Yes |
| BPS_DENOMINATOR | 10,000n | 10,000 u64 | Yes |
| MAX_TOKENS_PER_WALLET | 20,000,000,000,000n | 20,000,000,000,000 u64 | Yes |
| MIN_PURCHASE_SOL | 50,000,000n | 50,000,000 u64 | Yes |
| SOL_POOL_FEE_BPS (shared) | 100 | 100 (amm constants.rs) | Yes (per INDEX annotation) |
| VAULT_CONVERSION_RATE | 100 | 100 (vault constants.rs) | Yes (per INDEX annotation) |

All verified constants match. No drift detected.

## Cross-Focus Intersections

### With CHAIN-06 (On-Chain/Off-Chain Parity)
The most critical intersection: quote-engine.ts uses JavaScript Number while on-chain uses Rust u64/u128. For the constant-product AMM formula, intermediate values already exceed Number.MAX_SAFE_INTEGER at current pool sizes. This means client-side quotes are ALREADY slightly imprecise (by a few base units for typical trades). On-chain slippage checks provide the safety net.

### With CHAIN-01 (Transaction Construction)
swap-builders.ts converts JavaScript `number` amounts to Anchor `BN` via `new BN(amountInLamports)`. BN handles arbitrary precision, so the conversion is safe as long as the input Number is within safe integer range. This is guaranteed by the input parsing (`parseFloat` of user input strings, which are small decimal values).

### With BOT-01 (Crank/Keeper)
The staking reward calculation assumes `update_cumulative()` is called at epoch boundaries. If the crank fails, `pendingRewards` accumulates without being distributed, and the client-side reward display could diverge from what users can actually claim.

### With LOGIC-01 (Business Logic)
The route-engine state machine (path enumeration -> step quoting -> route ranking) is deterministic and pure. No state transitions to bypass. The split router's grid search is a brute-force optimization with no exploitable shortcuts.

## Cross-Reference Handoffs

| Target Agent | Handoff Item |
|-------------|-------------|
| CHAIN-06 | Verify AMM program's Rust code matches quote-engine.ts formula order-of-operations |
| CHAIN-01 | Verify BN conversion from Number preserves precision in swap-builders.ts |
| BOT-01 | Verify crank timing assumptions for staking reward accumulation |
| ERR-01 | Review error recovery in BuyForm/SellForm (5s timeout clear of error messages) |
| SEC-01 | BuyForm/SellForm use `skipPreflight: true` -- verify this doesn't expose users |

## Risk Observations

### HIGH

**R-01: quote-engine.ts arithmetic overflow with Number type**
- File: `app/lib/swap/quote-engine.ts:54-62`
- Impact: Client-side quotes diverge from on-chain results for large pool reserves
- Likelihood: Probable at mainnet scale (pools will grow beyond devnet seed amounts)
- Mitigation: On-chain slippage check rejects unfavorable executions
- Recommendation: Migrate quote-engine.ts to BigInt arithmetic (matching curve-math.ts pattern)

**R-02: Staking rewards comment incorrectly claims Number safety**
- File: `app/lib/staking/rewards.ts:79-82`
- Impact: If a future developer relies on this comment and removes the BigInt pipeline, precision loss could occur for large reward values
- Likelihood: Unlikely in the short term (comment is wrong but code is correct)
- Recommendation: Fix comment: `Number.MAX_SAFE_INTEGER` is ~9e15, not ~5e17. The actual safety argument is that individual user rewards will never approach 9e15 lamports (~9 million SOL).

### MEDIUM

**R-03: Mixed-denomination fee totals in Route objects**
- File: `app/lib/swap/route-engine.ts:300-315`
- Impact: Future consumers of `totalLpFee`/`totalTax` fields could make incorrect financial decisions
- Recommendation: Document the fields as display-only, or remove them in favor of BPS-only fee representation

**R-04: No negative amount guard on public quote functions**
- File: `app/lib/swap/quote-engine.ts:37-76`
- Impact: Programmatic callers could pass negative amounts and get reversed calculations
- Recommendation: Add `if (amountIn < 0) return 0` guards to all public quote functions

**R-05: Fee percentage calculation inconsistency between direct swap and smart routing paths**
- Files: `app/hooks/useSwap.ts:408-411`, `app/lib/swap/route-engine.ts:331-332`
- Impact: Users see different fee percentages for the same trade depending on smart routing toggle
- Recommendation: Unify fee percentage calculation to always use BPS-based approach

**R-06: BuyForm skipPreflight on bonding curve purchases**
- File: `app/components/launch/BuyForm.tsx:188-189`
- Impact: Users pay TX fees for transactions that could have been caught by simulation
- Recommendation: Consider using `skipPreflight: false` for BuyForm (unlike the AMM path which uses v0 transactions requiring skipPreflight)

**R-07: Graduation script uses Number() for lamport values from env**
- File: `scripts/graduation/graduate.ts:102-107`
- Impact: Low for current values (1000 SOL = 1e12 < 9e15) but fragile pattern
- Recommendation: Use BigInt for all lamport-scale values in deployment scripts

### LOW

**R-08: EPOCH_DURATION_SECONDS hardcoded to devnet**
- File: `app/lib/staking/rewards.ts:108`
- Impact: Wrong APR display on mainnet (currently dead code)
- Recommendation: Make configurable or derive from SLOTS_PER_EPOCH constant

**R-09: Demo mode BigInt conversion via Number intermediate**
- File: `app/hooks/useCurveState.ts:191-192`
- Impact: None (demo only, values within safe range)
- Recommendation: Use direct BigInt arithmetic for consistency

**R-10: No minimum sell amount in SellForm**
- File: `app/components/launch/SellForm.tsx`
- Impact: Users could attempt dust sells that fail on-chain, wasting TX fees
- Recommendation: Add minimum sell amount validation

**R-11: Price impact as additive sum across multi-hop steps**
- File: `app/lib/swap/route-engine.ts:322-325`
- Impact: Overestimates price impact for multi-hop routes (impact compounds, doesn't add linearly)
- Recommendation: Use multiplicative compounding or note "maximum estimated impact"

**R-12: SellForm passes netSol for slippage, not grossSol**
- File: `app/components/launch/SellForm.tsx:177-178`
- Impact: None -- this is correct behavior. On-chain sell checks `sol_after_tax >= minimum_sol_out`. The slippage is applied to the amount the user actually receives (net of tax), which is the correct user-facing guarantee.
- Note: Documented as correct pattern, not a finding.

## Novel Attack Surface Observations

### Quote-engine divergence as an information leak
An MEV operator could observe a user's on-chain transaction amount and compare it to the expected on-chain output. If the user relied on the off-chain quote to set their slippage tolerance, and the quote was slightly wrong due to Number precision loss, the slippage window is wider than the user intended. The MEV operator could sandwich within this wider window. The magnitude of this effect is small (sub-basis-point for typical trades) but grows with trade size and pool depth.

### Split ratio observation by MEV bots
When a user executes a split route (e.g., 60% via CRIME, 40% via FRAUD), the two legs are separate on-chain instructions in one atomic transaction. An MEV bot could observe the ratio and front-run one leg preferentially, knowing the user is committed to the split ratio. The 50 BPS minimum improvement threshold means splits are only used for large trades where MEV extraction is also more profitable.

## Questions for Other Focus Areas

- **CHAIN-06**: Does the on-chain AMM program use `u64` or `u128` for the constant-product intermediate multiplication? If u64, the on-chain code has the same overflow risk. If u128, the off-chain quote-engine should migrate to BigInt.
- **BOT-01**: How does the crank handle partial failures in epoch transitions? If `update_cumulative()` fails, does `pendingRewards` continue to accumulate unboundedly?
- **CHAIN-01**: Is there a maximum slippage BPS enforced anywhere? If a user sets 100% slippage (10000 BPS), the minimumOutput would be 0, effectively disabling slippage protection.
- **ERR-01**: BuyForm/SellForm clear error messages after 5 seconds via setTimeout. If the user rapidly retries during this window, could they submit with stale state?

## Raw Notes

- quote-engine.ts is pure functions, no side effects, deterministic. Good for testing.
- The `isProfitInput` logic in quoteStep (route-engine.ts:179) is inverted: `isProfitInput = edge.neighborToken !== "PROFIT"`. This reads counter-intuitively but is correct: if the neighbor is NOT PROFIT, then we're converting PROFIT -> faction (so PROFIT is the input). If neighbor IS PROFIT, we're converting faction -> PROFIT.
- The vault conversion rate of 100:1 means 1 PROFIT = 100 CRIME (or FRAUD). This is a fixed rate with no market mechanism, making vault conversion a deterministic operation with zero risk of precision issues.
- `reverseQuoteVaultConvert` has an asymmetry: when `isProfitInput = true` (want faction, give PROFIT), `inputNeeded = ceil(desiredOutput / conversionRate)`. When `isProfitInput = false` (want PROFIT, give faction), `inputNeeded = desiredOutput * conversionRate`. The forward direction floors (faction -> PROFIT: `floor(input / 100)`), so the reverse must ceil. The reverse for PROFIT -> faction just multiplies, which is exact. This is correct.
- The `PRECISION` constant differs between curve-math (1e12) and rewards (1e18). This is intentional -- they're from different on-chain programs with different scaling requirements.
