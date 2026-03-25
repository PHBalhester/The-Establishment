# Stacked Audit #2 -- API & Data Findings Verification

Auditor: Claude Opus 4.6 (verification pass)
Date: 2026-03-21
Scope: 8 findings from Audit #1 targeting API/data layer files

---

## 1. H014 (HIGH, claimed FIXED) -- Quote-engine Number overflow fixed with BigInt

**Target file:** `app/lib/swap/quote-engine.ts`
**File changed since Audit #1?** YES -- commit `2cf66c9 feat(89-04): convert quote-engine.ts to BigInt arithmetic`
**Verdict: FIXED -- CONFIRMED**

The entire quote-engine.ts has been rewritten to use BigInt throughout. All function signatures accept `bigint` parameters and return `bigint`. The `BPS_DENOMINATOR` constant is `10_000n`. No `Math.floor` or JavaScript `number` arithmetic remains in any calculation path. The `calculateSwapOutput` function (the critical overflow site cited in Audit #1) now computes `(reserveOut * effectiveInput) / denominator` with native BigInt division (which truncates, matching Rust floor division).

**Import/dependency check:** `route-engine.ts` (the primary consumer) was also updated in commit `9378168 feat(89-04): update all callers to BigInt quote-engine pipeline`. It converts reserves to BigInt at the call site (`BigInt(reserves.reserveA)`) and chains BigInt outputs between hops via `outputAmountBigInt`. The `shared/constants.ts` exports `SOL_POOL_FEE_BPS = 100` (number), which route-engine converts to BigInt once at module scope (`BigInt(SOL_POOL_FEE_BPS)`).

**Residual concern (useSwap.ts direct path):** The direct swap path in `useSwap.ts:441` also correctly passes BigInt to `quoteSolSell(BigInt(baseUnits), BigInt(reserveWsol), ...)`. The fix is propagated to all call sites.

---

## 2. H030 (MED, claimed FIXED) -- VRF wait loop fixed

**Target file:** `scripts/vrf/lib/vrf-flow.ts`
**File changed since Audit #1?** YES -- commit `0113402 feat(90-03): add maxWaitMs wall-clock timeout to waitForSlotAdvance (H030)`
**Verdict: FIXED -- CONFIRMED**

The `waitForSlotAdvance` function (lines 164-215) now has a wall-clock timeout:
- `effectiveTimeout = maxWaitMs ?? Math.max(30_000, targetSlots * 400 * 3)` (default: 3x expected time, floor 30s)
- Timeout check at line 195: `if (Date.now() - startTime > effectiveTimeout)` throws an `Error` with diagnostic info
- The timeout check runs BEFORE the sleep on each iteration, preventing unnecessary delay

The `while (true)` loop now has two exit paths: (1) slot reaches target, (2) wall-clock timeout exceeded. This prevents the infinite-loop scenario described in Audit #1.

**Import/dependency check:** No changed dependencies affect this function. It uses only `Connection.getSlot()` from `@solana/web3.js` and the local `sleep` helper.

---

## 3. H011 (MED, claimed FIXED) -- DB connection TLS enforced in production

**Target file:** `app/db/connection.ts`
**File changed since Audit #1?** YES -- commit `807ba9e fix(89-01): .npmrc lockdown + HSTS header + DB TLS + stale comment fix`
**Verdict: FIXED -- CONFIRMED**

Lines 48-57 now enforce TLS in production:
```typescript
const isProductionDb = process.env.NODE_ENV === "production";
const sslConfig = isProductionDb ? { ssl: "require" as const } : {};
const client = globalForDb.pgClient ?? postgres(connectionString, { max: 10, ...sslConfig });
```

Additionally, lines 60-73 add a non-production warning for remote DB hosts without TLS (VH-L002 defense-in-depth).

**Import/dependency check:** No import changes. Uses `postgres` and `drizzle-orm/postgres-js` -- neither has changed. The `schema` import points to `./schema` which is unchanged in the relevant fields.

---

## 4. H033 (LOW, claimed NOT_FIXED) -- Candle close price ordering on concurrent webhooks

**Target file:** `app/db/candle-aggregator.ts`
**File changed since Audit #1?** NO -- last commit `8ce2942 dbs(phase-4): wave 4 -- test rewrite + dead code documentation` (pre-audit)
**Verdict: NOT FIXED -- CONFIRMED (still applies)**

The upsert at line 123 still sets `close: sql'${update.price}'` unconditionally with no timestamp comparison. Two concurrent webhook POSTs processing transactions from the same candle bucket can race, and whichever SQL UPDATE executes last determines the close price -- regardless of chronological ordering.

**Import/dependency check:** The `db` import from `./connection` has the TLS fix (H011) but that does not affect query semantics. The `candles` schema import from `./schema` has not changed structurally. The `ParsedTaxedSwap`/`ParsedUntaxedSwap` types from `@/lib/event-parser` are unchanged.

**Fix would require:** Adding a `lastTradeTimestamp` column to the candles table and using `CASE WHEN new_timestamp > existing_timestamp THEN new_price ELSE existing_close END` in the upsert's `close` assignment. The severity remains LOW because high/low are order-independent (GREATEST/LEAST), and open is preserved from first insert.

---

## 5. H036 (LOW, claimed FIXED) -- Staking rewards comment misleading

**Target file:** `app/lib/staking/rewards.ts`
**File changed since Audit #1?** YES -- commit `f0c630e fix(90.1-04): add DB TLS warning (VH-L002) + fix staking comment (VH-L003)`
**Verdict: FIXED -- CONFIRMED**

The comment at lines 79-82 now correctly states:
```
// Convert to lamports -- safe for Number because individual staker rewards
// are bounded well below Number.MAX_SAFE_INTEGER (2^53 - 1 = ~9e15 lamports).
// Note: total SOL supply (~5e17 lamports) exceeds MAX_SAFE_INTEGER, but a single
// staker's accumulated rewards will never approach total supply.
```

This correctly acknowledges that 5e17 > 9e15 (the original error) and explains why the conversion is still safe in practice (individual rewards are bounded).

**Import/dependency check:** No relevant changes. The `PRECISION` constant and `calculatePendingRewards` function signature are unchanged.

---

## 6. H037 (LOW, claimed FIXED) -- Mixed-denomination fee display

**Target file:** Route engine (`app/lib/swap/route-engine.ts`)
**File changed since Audit #1?** YES -- commit `9378168 feat(89-04): update all callers to BigInt quote-engine pipeline`
**Verdict: PARTIALLY FIXED -- route-engine fixed, useSwap.ts direct path NOT fixed**

**Route engine (FIXED):** Lines 356-361 compute `totalFeePct` using BPS summation from step-level rates, which is denomination-independent:
```typescript
const totalFeeBps = steps.reduce((sum, s) => sum + s.lpFeeBps + s.taxBps, 0);
const totalFeePct = `${(totalFeeBps / 100).toFixed(1)}%`;
```

**useSwap.ts direct sell path (NOT FIXED):** Lines 448-450 still mix denominations:
```typescript
const totalFeePct = grossSolOutput > 0
  ? ((taxAmount / grossSolOutput) * 100 + (lpFee / baseUnits) * 100).toFixed(1) + "%"
  : "0%";
```
Here `taxAmount / grossSolOutput` is a SOL-denominated percentage and `lpFee / baseUnits` is a token-denominated percentage. Adding them is mathematically incorrect.

**Note:** The Audit #1 finding specifically named "route engine" as the target. The route-engine.ts fix IS correct. The useSwap.ts direct path is a separate (pre-existing) code path that was not the audit target. If only the route-engine is in scope, the fix holds. If the finding is interpreted broadly as "all fee display," the useSwap.ts direct sell path remains unfixed.

---

## 7. H038 (LOW, claimed FIXED) -- Split route zero fee

**Target file:** Route engine / useRoutes.ts
**File changed since Audit #1?** The `buildSplitRoute` function in `useRoutes.ts` was examined.
**Verdict: PARTIALLY FIXED -- totalFeePct is correct, absolute amounts still zero**

Lines 183-184 of `useRoutes.ts` still hardcode `totalLpFee: 0` and `totalTax: 0`. However, line 167-168 correctly computes `totalFeePct` from BPS summation:
```typescript
const totalFeeBps = steps.reduce((sum, s) => sum + s.lpFeeBps + s.taxBps, 0);
const totalFeePct = `${(totalFeeBps / 100).toFixed(1)}%`;
```

The `useSwap.ts` line 825-826 maps `route.totalLpFee` and `route.totalTax` to `quote.lpFee` and `quote.taxAmount`, which would show 0 for split routes. The percentage display via `totalFeePct` (line 829) IS correct.

**Assessment:** Whether this is "fixed" depends on interpretation. The percentage display (the primary user-facing metric) is correct. The absolute fee amounts remain zero, which could mislead any UI component displaying "LP Fee: X SOL". Given that the Audit #1 finding noted this as a display concern and the percentage is now correct, the fix is substantially in place. The `totalLpFee: 0` and `totalTax: 0` values are documented with comments explaining why they are intentionally zero.

---

## 8. H072 (LOW, claimed NOT_FIXED) -- Price impact additive not multiplicative

**Target file:** `app/lib/swap/route-engine.ts`
**File changed since Audit #1?** The relevant code has not changed in this area.
**Verdict: NOT FIXED -- CONFIRMED (still applies, conservative direction)**

Lines 351-354 still use additive summation:
```typescript
const totalPriceImpactBps = steps.reduce(
  (sum, s) => sum + s.priceImpactBps,
  0,
);
```

The comment at lines 348-350 says "Use max as a simple heuristic" but the code uses `sum` (additive). True compounding would be `1 - (1-a)(1-b)`. The additive approach overstates impact (conservative/user-protective direction). Also note the `buildSplitRoute` in `useRoutes.ts` line 158-161 uses the same additive approach.

This remains a display-only cosmetic issue. On-chain slippage protection uses `minimumOutput` computed from actual chained quote outputs, not from the price impact display value.

---

## Summary Table

| ID | Severity | Claimed Status | Verified Status | Notes |
|----|----------|---------------|----------------|-------|
| H014 | HIGH | FIXED | **FIXED** | Full BigInt migration in quote-engine + all callers |
| H030 | MED | FIXED | **FIXED** | Wall-clock timeout added to waitForSlotAdvance |
| H011 | MED | FIXED | **FIXED** | TLS enforced in production via ssl:"require" |
| H033 | LOW | NOT_FIXED | **NOT FIXED** | Close price still set unconditionally, no timestamp ordering |
| H036 | LOW | FIXED | **FIXED** | Comment corrected to accurately describe MAX_SAFE_INTEGER relationship |
| H037 | LOW | FIXED | **PARTIALLY FIXED** | route-engine.ts fixed (BPS summation); useSwap.ts direct sell path still mixes denominations |
| H038 | LOW | FIXED | **PARTIALLY FIXED** | totalFeePct correct (BPS); absolute totalLpFee/totalTax still 0 for split routes (documented intentional) |
| H072 | LOW | NOT_FIXED | **NOT FIXED** | Still additive, conservative direction, display-only |

## Cross-File Dependency Changes

The most significant change affecting these files since Audit #1 was the Phase 102 clean-room devnet redeploy (commits `55254dd` and `dc063ec`), which regenerated `shared/constants.ts` with new program IDs, mint addresses, pool addresses, and PDA addresses. This changes the runtime values used by the route engine and quote engine but does NOT affect the correctness of the arithmetic or the fix status of any finding. The BigInt conversion logic, TLS enforcement, and timeout mechanism are all address-independent.

No new vulnerabilities were introduced by the dependency changes.
