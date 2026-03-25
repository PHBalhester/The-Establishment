---
phase: 32-cpi-chain-validation
plan: 03
subsystem: testing
tags: [access-control, negative-tests, authorization, pda, seeds-program, compute-budget, cu-profile, cpi]

# Dependency graph
requires:
  - phase: 32-01
    provides: CPI chain integration tests, CU measurements for 6 swap paths
  - phase: 32-02
    provides: Carnage CPI chain tests, CU measurement for depth-4 path
  - phase: 31-03
    provides: Integration test framework with upgradeable program deployment
provides:
  - Negative authorization matrix for all 5 CPI-gated entry points (10 tests)
  - Compute Budget Profile document (Docs/Compute_Budget_Profile.md)
  - SDK/frontend CU limit recommendations with 20% padding
  - CPI depth map and access control matrix documentation
affects:
  - 33 (devnet deployment -- CU limits documented for SDK integration)
  - 35 (devnet testing -- remeasure CU with production liquidity)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Negative authorization testing: random keypair + wrong-program PDA attack vectors"
    - "assertConstraintSeedsError helper for multi-format Anchor error assertion"

key-files:
  created:
    - tests/integration/access-control.test.ts
    - Docs/Compute_Budget_Profile.md
  modified:
    - scripts/run-integration-tests.sh

key-decisions:
  - "Direction enum uses lowercase 't' (atoB not aToB) matching Anchor IDL camelCase convention"
  - "swap_profit_pool uses tokenProgramA/B (not token2022Program) same as swap_sol_pool"
  - "CU padding of 20% for SDK recommendations (conservative for production variance)"

patterns-established:
  - "Negative auth test pattern: 2 vectors per entry point (random keypair + wrong-program PDA)"
  - "Multi-format error assertion: check errorCode, message string, and logs for ConstraintSeeds"

# Metrics
duration: 23min
completed: 2026-02-10
---

# Phase 32 Plan 03: Access Control & Compute Budget Profile Summary

**10 negative authorization tests covering all 5 CPI entry points (2 attack vectors each) plus compute budget profile document with SDK recommendations for all 7 CPI paths**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-02-10T23:01:01Z
- **Completed:** 2026-02-10T23:24:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- All 5 CPI-gated entry points reject unauthorized callers with ConstraintSeeds (error 2006)
- 10 negative tests (2 per entry point) validate both random keypair and wrong-program PDA attack vectors
- Full integration suite expanded to 22 tests across 4 phases, all passing
- Compute Budget Profile document created with measured CU values, SDK recommendations, CPI depth map, and access control matrix
- All CPI paths confirmed below 62% of 200k default CU limit (OK status, no optimization needed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CPI access control negative tests** - `c818dba` (feat)
2. **Task 2: Create compute budget profile documentation** - `8093d17` (docs)

## Files Created/Modified

- `tests/integration/access-control.test.ts` - 10 negative authorization tests for all 5 CPI entry points (AMM swap_sol_pool, AMM swap_profit_pool, Staking deposit_rewards, Staking update_cumulative, Tax swap_exempt)
- `Docs/Compute_Budget_Profile.md` - Consolidated CU measurements, threshold assessments, SDK/frontend recommendations, CPI depth map, access control matrix
- `scripts/run-integration-tests.sh` - Added Phase 4 for access control test suite with fresh validator

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Direction enum `atoB` (lowercase 't') | Anchor IDL generates camelCase variant names; `aToB` is invalid and causes "unable to infer src variant" |
| swap_profit_pool uses tokenProgramA/B | Same account naming as swap_sol_pool in IDL; the `token2022Program` name is not used by AMM |
| 20% CU padding for SDK recommendations | Conservative buffer for production variance in pool liquidity, account sizes, and runtime conditions |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong SwapDirection enum variant casing**
- **Found during:** Task 1 (access control test execution)
- **Issue:** Used `{ aToB: {} }` but Anchor IDL defines variant as `atoB` (lowercase 't'). Error: "unable to infer src variant"
- **Fix:** Changed to `{ atoB: {} }` in all 4 AMM test calls
- **Files modified:** `tests/integration/access-control.test.ts`
- **Verification:** AMM swap instructions now reach the seeds constraint check (rejecting correctly)
- **Committed in:** `c818dba`

**2. [Rule 1 - Bug] Wrong account name for swap_profit_pool token programs**
- **Found during:** Task 1 (access control test execution)
- **Issue:** Used `token2022Program: TOKEN_2022_PROGRAM_ID` but IDL expects `tokenProgramA` and `tokenProgramB` as separate accounts. Error: "Account `tokenProgramA` not provided"
- **Fix:** Changed to `tokenProgramA: TOKEN_2022_PROGRAM_ID, tokenProgramB: TOKEN_2022_PROGRAM_ID`
- **Files modified:** `tests/integration/access-control.test.ts`
- **Verification:** swap_profit_pool tests now reach seeds constraint check (rejecting correctly)
- **Committed in:** `c818dba`

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were trivial naming issues caught immediately during test execution. No scope creep.

## Issues Encountered

- Anchor IDL variant naming follows a specific camelCase convention that strips uppercase from consecutive capitals (e.g., `AToB` -> `atoB`, not `aToB`). This is a subtle gotcha when constructing instruction arguments from TypeScript.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 32 (CPI Chain Validation) is now COMPLETE:
  - Plan 01: 7 swap path tests with CU profiling
  - Plan 02: 3 Carnage depth-4 chain tests + 2 smoke tests
  - Plan 03: 10 access control negative tests + CU profile document
  - Total: 22 integration tests, all passing
- All CPI paths validated for correctness, performance, and security
- Compute budget documented with SDK recommendations for integrators
- Ready for Phase 33+ (devnet deployment and beyond)

---
*Phase: 32-cpi-chain-validation*
*Completed: 2026-02-10*
