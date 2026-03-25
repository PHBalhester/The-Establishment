---
phase: 52-smart-swap-routing
plan: 01
subsystem: swap
tags: [routing, pure-functions, quote-engine, multi-hop, vitest, tdd]

# Dependency graph
requires:
  - phase: 42-swap-interface
    provides: quote-engine.ts primitives (quoteSolBuy, quoteSolSell, quoteProfitBuy, quoteProfitSell)
  - phase: 51-program-rebuild
    provides: deployed programs, stable on-chain math
provides:
  - Route type definitions (Route, RouteStep, PoolReserves, EpochTaxState, TokenSymbol)
  - Pure routing engine (computeRoutes, buildRouteGraph, ROUTE_GRAPH)
  - Route graph adjacency list for 4-pool diamond topology
  - Path enumeration (1-hop and 2-hop) for all token pairs
  - Route quoting via existing quote-engine primitives
  - Route ranking by output amount
affects:
  - 52-02 (multi-hop builder uses Route types)
  - 52-03 (split router uses computeRoutes and route types)
  - 52-04 (useRoutes hook wraps computeRoutes)
  - 52-05 (UI components consume Route objects)

# Tech tracking
tech-stack:
  added: [vitest@4.0.18]
  patterns: [pure-function routing, graph-based path enumeration, StepQuoteResult pattern]

key-files:
  created:
    - app/lib/swap/route-types.ts
    - app/lib/swap/route-engine.ts
    - app/lib/swap/__tests__/route-engine.test.ts
  modified:
    - app/package.json

key-decisions:
  - "StepQuoteResult pattern: quoteStep returns fee/tax amounts from quote-engine result, eliminating redundant re-invocation"
  - "Sum-based price impact aggregation for multi-hop routes (additive across hops)"
  - "vitest as test framework for app workspace (not mocha/chai used by root for integration tests)"

patterns-established:
  - "Pure routing module: no RPC, no React, no DOM -- all state passed as parameters for testability and reuse in scripts"
  - "Route graph adjacency list: static ROUTE_GRAPH with buildRouteGraph() wrapper for future dynamic pool support"
  - "TDD for client-side swap logic: RED (failing tests) -> GREEN (implementation) -> REFACTOR (StepQuoteResult extraction)"

# Metrics
duration: 6min
completed: 2026-02-20
---

# Phase 52 Plan 01: Route Engine Summary

**Pure-function routing engine with graph-based path enumeration, quoting via quote-engine primitives, and ranking by output amount across all 16 token pair routes**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T18:34:25Z
- **Completed:** 2026-02-20T18:40:29Z
- **Tasks:** 3 (TDD: RED + GREEN + REFACTOR)
- **Files modified:** 4

## Accomplishments
- Route type system covering all route concepts (Route, RouteStep, PoolReserves, EpochTaxState, RouteGraph)
- Diamond graph adjacency list (SOL-CRIME-PROFIT-FRAUD) with bidirectional edges and swap direction indicators
- Path enumeration: 1-hop direct routes + 2-hop multi-hop routes for all token pairs
- Quoting pipeline: chains quote-engine primitives step-by-step with fee/tax accumulation
- 19 unit tests covering all specified test cases + additional edge cases (520 lines)
- All outputs match quote-engine primitives exactly (verified by test assertions)

## Task Commits

Each task was committed atomically (TDD cycle):

1. **RED: Failing tests** - `0464627` (test)
2. **GREEN: Implementation** - `1159d8f` (feat)
3. **REFACTOR: StepQuoteResult extraction** - `2f6d047` (refactor)

_TDD cycle: test -> feat -> refactor_

## Files Created/Modified
- `app/lib/swap/route-types.ts` - Route, RouteStep, PoolReserves, EpochTaxState, RouteGraph, RouteGraphEdge type definitions
- `app/lib/swap/route-engine.ts` - ROUTE_GRAPH, buildRouteGraph, enumeratePaths, quoteStep, quoteRoute, computeRoutes
- `app/lib/swap/__tests__/route-engine.test.ts` - 19 unit tests (520 lines) covering all token pair combinations
- `app/package.json` - Added vitest@4.0.18 as dev dependency

## Decisions Made
- **vitest over mocha/chai:** App workspace uses ES modules and bundler resolution (Next.js). Vitest natively supports this without ts-mocha configuration. Root workspace keeps mocha for Anchor integration tests.
- **StepQuoteResult pattern:** quoteStep returns lpFeeAmount and taxAmount alongside the RouteStep, eliminating a redundant quoteSolSell call in the route builder for sell-tax calculation.
- **Additive price impact:** For multi-hop routes, price impacts are summed across hops. This is a simplified heuristic (compound impact would be slightly higher) but informative for users without overstating.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed vitest as dev dependency**
- **Found during:** RED phase (test infrastructure check)
- **Issue:** Vitest not installed in app workspace -- tests cannot run
- **Fix:** `npm install --save-dev vitest -w app`
- **Files modified:** app/package.json
- **Verification:** `npx vitest --version` returns 4.0.18
- **Committed in:** 0464627 (RED phase commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test framework installation was essential for TDD execution. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Route types and engine are ready for consumption by:
  - multi-hop-builder.ts (Plan 02) -- will use Route/RouteStep to build TX sequences
  - split-router.ts (Plan 03) -- will use computeRoutes + grid search optimization
  - useRoutes.ts hook (Plan 04) -- will wrap computeRoutes with pool reserve data from RPC
  - RouteSelector/RouteCard components (Plan 05) -- will render Route objects
- No blockers or concerns

---
*Phase: 52-smart-swap-routing*
*Completed: 2026-02-20*
