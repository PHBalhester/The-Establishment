# VERIFY-H014: Quote-Engine Number Overflow
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
In `app/lib/swap/quote-engine.ts`:

1. **All arithmetic uses BigInt.** The file header explicitly states: "All functions are pure (no RPC calls, no React). Uses BigInt arithmetic to match Rust's integer division behavior."

2. **BPS_DENOMINATOR is `10_000n`** (line 26) -- BigInt literal.

3. **All function signatures accept and return `bigint`:**
   - `calculateEffectiveInput(amountIn: bigint, feeBps: bigint): bigint`
   - `calculateSwapOutput(reserveIn: bigint, reserveOut: bigint, effectiveInput: bigint): bigint`
   - `calculateTax(amountLamports: bigint, taxBps: bigint): bigint`
   - `quoteSolBuy(...)`: All params and return fields are `bigint`
   - `quoteSolSell(...)`: All params and return fields are `bigint`
   - `quoteVaultConvert(...)`: All params and return fields are `bigint`
   - All reverse quote functions: All `bigint`

4. **Callers updated in `useSwap.ts`:**
   - `SOL_POOL_FEE_BPS_BI = BigInt(SOL_POOL_FEE_BPS)` and `VAULT_CONVERSION_RATE_BI = BigInt(VAULT_CONVERSION_RATE)` (lines 63-64)
   - All quote function calls wrap numeric reserves with `BigInt()`: e.g., `quoteSolBuy(BigInt(baseUnits), BigInt(reserveWsol), BigInt(reserveToken), BigInt(buyTaxBps), SOL_POOL_FEE_BPS_BI)` (line 414)
   - Results are converted back to `number` only for display: `Number(result.outputTokens)` (line 415)

5. **Price impact uses BigInt** (lines 108-122): Cross-multiplied formula avoids intermediate floating-point division.

## Assessment
The fix is complete. At mainnet-scale reserves (290T token base units x 10B SOL lamports), intermediate products reach ~2.9e24, far exceeding `Number.MAX_SAFE_INTEGER` (9e15). BigInt handles these values with exact precision. Division truncates by default, matching Rust's floor division semantics.
