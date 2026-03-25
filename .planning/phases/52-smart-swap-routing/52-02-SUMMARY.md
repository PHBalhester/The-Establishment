---
phase: 52-smart-swap-routing
plan: 02
subsystem: swap
tags: [routing, split-optimization, multi-hop, grid-search, transaction-builder, vitest, tdd]

# Dependency graph
requires:
  - phase: 52-smart-swap-routing (plan 01)
    provides: Route types (Route, RouteStep, PoolReserves), computeRoutes, quote-engine primitives
  - phase: 42-swap-interface
    provides: swap-builders (buildSolBuyTransaction, buildSolSellTransaction, buildProfitBuyTransaction, buildProfitSellTransaction)
provides:
  - Split routing optimizer (computeOptimalSplit, SPLIT_THRESHOLD_BPS)
  - Multi-hop transaction builder (buildMultiHopTransactions)
  - Multi-hop transaction executor (executeMultiHopRoute) with partial failure handling
  - MultiHopResult type for execution status tracking
affects:
  - 52-03 (swap-page may use split router for parallel path optimization)
  - 52-04 (useRoutes hook may incorporate split optimization)
  - 52-05 (UI shows split route indicator)
  - 52-06 (integration tests exercise multi-hop execution)

# Tech tracking
tech-stack:
  added: []
  patterns: [generic-quoter-callback for split optimization, batch-sign-then-sequential-send for multi-hop]

key-files:
  created:
    - app/lib/swap/split-router.ts
    - app/lib/swap/multi-hop-builder.ts
    - app/lib/swap/__tests__/split-router.test.ts
  modified: []

key-decisions:
  - "Generic quoter callbacks: computeOptimalSplit takes (input) => output lambdas, decoupled from specific pool topology"
  - "1% grid search granularity (99 iterations): microsecond execution, sufficient precision for AMM split optimization"
  - "2x slippage for hop 2+: accounts for reserve changes between hop 1 confirmation and hop 2 execution"
  - "Batch signAllTransactions with sequential signTransaction fallback: single wallet prompt for multi-hop when supported"

patterns-established:
  - "Generic quoter callback pattern: split-router accepts (input: number) => number callbacks, caller composes from quote-engine primitives"
  - "Partial failure tracking: MultiHopResult.intermediateToken tells user which token they hold after a failed hop"
  - "sendRawTransaction with skipPreflight=false and maxRetries=2 for production safety"

# Metrics
duration: 4min
completed: 2026-02-20
---

# Phase 52 Plan 02: Split Router + Multi-Hop Builder Summary

**Grid-search split optimizer with 0.5% threshold for 2-path parallel routing, plus multi-hop TX builder/executor with batch-sign and partial failure handling**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-20T18:44:05Z
- **Completed:** 2026-02-20T18:48:46Z
- **Tasks:** 3 (TDD: RED + GREEN + REFACTOR)
- **Files created:** 3

## Accomplishments
- Split router: 1% granularity grid search finds optimal split across two parallel paths
- Only recommends split when improvement >= 50 bps (0.5%) over best single path
- Multi-hop builder: builds unsigned TX arrays from Route steps using existing swap-builders
- Multi-hop executor: batch signAllTransactions with sequential fallback, sends sequentially
- Partial failure handling: intermediateToken field tells user which token they hold if hop 2 fails
- 7 unit tests covering all specified test cases (equal pools, asymmetric pools, zero input, zero reserves)

## Task Commits

Each task was committed atomically (TDD cycle):

1. **RED: Failing tests** - `93b2290` (test)
2. **GREEN: Implementation** - `b81294e` (feat)
3. **REFACTOR: Docs and import cleanup** - `90d8c9a` (refactor)

_TDD cycle: test -> feat -> refactor_

## Files Created/Modified
- `app/lib/swap/split-router.ts` - computeOptimalSplit, SPLIT_THRESHOLD_BPS, SplitResult interface
- `app/lib/swap/multi-hop-builder.ts` - buildMultiHopTransactions, executeMultiHopRoute, MultiHopResult interface
- `app/lib/swap/__tests__/split-router.test.ts` - 7 unit tests with mock constant-product AMM quoters (172 lines)

## Decisions Made
- **Generic quoter callbacks:** computeOptimalSplit takes `(input: number) => number` functions rather than pool addresses or reserve data directly. Callers compose quoters from quote-engine primitives (e.g., chaining quoteSolBuy + quoteProfitBuy). This keeps the split optimizer completely decoupled from pool topology.
- **Test calibration:** Asymmetric pool test uses 2M input against 5M/500K pools (not 500K against 10M/1M) to ensure the improvement clearly exceeds the 50 bps threshold. Smaller inputs against larger asymmetric pools produce sub-threshold improvements because price impact on the deep pool is negligible.
- **1-hop route support:** multi-hop-builder handles 1-hop routes naturally (single TX, no slippage doubling) despite the "multi-hop" name. Documented explicitly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Calibrated asymmetric pool test parameters**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Original test used 500K input against 10M/1M pools, producing only 43.5 bps improvement (below 50 bps threshold). The test expected shouldSplit=true but got false.
- **Fix:** Changed to 2M input against 5M/500K pools, producing 266 bps improvement -- clearly above threshold. Updated skew expectation from >=60 to >=80 to match the 91/9 optimal ratio.
- **Files modified:** app/lib/swap/__tests__/split-router.test.ts
- **Verification:** All 7 tests pass
- **Committed in:** b81294e (GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 bug -- test calibration)
**Impact on plan:** Test parameters needed calibration to produce mathematically valid expectations. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Split router and multi-hop builder are ready for consumption by:
  - useRoutes hook (Plan 03/04) -- will use computeOptimalSplit with quote-engine-composed callbacks
  - Swap UI components (Plan 05) -- will display split route indicators and multi-hop progress
  - Integration tests (Plan 06) -- will exercise executeMultiHopRoute against devnet
- multi-hop-builder.ts is integration-tested only (needs RPC) -- scheduled for Plan 05/06
- No blockers or concerns

---
*Phase: 52-smart-swap-routing*
*Completed: 2026-02-20*
