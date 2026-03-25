---
phase: 51-program-rebuild-devnet-deploy
plan: 03
subsystem: testing
tags: [regression, litesvm, sec-10, minimum-output-floor, workspace-tests]

# Dependency graph
requires:
  - phase: 51-01
    provides: Fixed 19 AMM swap tests (Mock Tax CPI routing)
  - phase: 51-02
    provides: Fixed 14 Tax SOL swap tests (missing accounts + wsol_intermediary)
  - phase: 49-protocol-safety-events
    provides: SEC-10 minimum output floor (50% of expected)
provides:
  - Full workspace regression green (299 tests, 0 failures)
  - Epoch tests confirmed 81/81 (MAINT-02 Epoch failures were already fixed in Phase 50)
  - PROFIT pool tests updated for SEC-10 floor compliance
affects: [51-04, 51-05, 51-06, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "protocol_output_floor() test helper for SEC-10 floor-compliant minimum_output calculation"

key-files:
  created: []
  modified:
    - "programs/tax-program/tests/test_swap_profit_buy.rs"
    - "programs/tax-program/tests/test_swap_profit_sell.rs"

key-decisions:
  - "On-chain floor uses RAW expected output (no LP fee), so test minimum_output must account for this difference"

patterns-established:
  - "protocol_output_floor(reserve_in, reserve_out, amount_in) helper mirrors on-chain calculate_output_floor for test SEC-10 compliance"

# Metrics
duration: 7min
completed: 2026-02-20
---

# Phase 51 Plan 03: Full Regression Sweep Summary

**299 workspace tests green (0 failures) after fixing 6 PROFIT pool tests for SEC-10 minimum output floor compliance**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-20T14:08:10Z
- **Completed:** 2026-02-20T14:14:58Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Confirmed Epoch Program 81/81 tests pass (MAINT-02 8 failures were already resolved in Phase 50)
- Fixed 6 PROFIT pool tests (3 buy + 3 sell) that passed minimum_output=0 violating SEC-10 floor
- Full workspace regression: 299 tests passed, 0 failures, 2 intentionally ignored
- MAINT-02 requirement satisfied: all 37 previously-failing tests (19 AMM + 10 Tax SOL + 8 Epoch) now pass, plus 6 additional PROFIT pool tests fixed

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify Epoch tests and run full Rust regression** - `dd11e57` (test)

## Test Counts by Program

| Program | Unit/Lib | Integration | Total |
|---------|----------|-------------|-------|
| AMM | 26 (3 proptests) | 59 | 85 |
| Epoch | 81 | 0 | 81 |
| Tax Program | 44 (5 proptests) | 30 | 74 |
| Staking | 38 | 0 | 38 |
| Transfer Hook | 1 | 10 | 11 |
| Test helpers | 6 (fake/mock/stub) | 0 | 6 |
| Doc-tests | 0 | 0 | 0 (2 ignored) |
| **Total** | **196** | **99** | **299** |

Note: 2 tests intentionally ignored (1 swap_exempt deferred to v0.5+, 1 epoch doc-test).

## Files Created/Modified
- `programs/tax-program/tests/test_swap_profit_buy.rs` - Added protocol_output_floor() helper; updated test_profit_buy_no_tax, test_profit_buy_consecutive, test_profit_buy_lp_fee_rate to pass floor-compliant minimum_output
- `programs/tax-program/tests/test_swap_profit_sell.rs` - Added protocol_output_floor() helper; updated test_profit_sell_no_tax, test_profit_sell_consecutive, test_profit_sell_lp_fee_rate to pass floor-compliant minimum_output

## Decisions Made
- On-chain floor uses RAW expected output (no LP fee adjustment) at 50% threshold. Test helpers must mirror this exact formula, not the LP-fee-adjusted output. Passing `expected_output / 2` (where expected_output includes LP fee deduction) can still be below the on-chain floor for large swaps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 6 PROFIT pool tests failing with MinimumOutputFloorViolation (Error 6017)**
- **Found during:** Task 1 (Full regression sweep)
- **Issue:** 6 tests in test_swap_profit_buy.rs and test_swap_profit_sell.rs passed minimum_output=0, which violates the Phase 49 SEC-10 protocol floor (50% of expected output). Tests were written before the floor was added.
- **Fix:** Added `protocol_output_floor()` helper that mirrors the on-chain `calculate_output_floor()` formula (raw expected output without LP fee, at 5000 BPS). Updated all 6 failing tests to pass floor-compliant minimum_output values.
- **Files modified:** programs/tax-program/tests/test_swap_profit_buy.rs, programs/tax-program/tests/test_swap_profit_sell.rs
- **Verification:** All 5 profit_buy + 5 profit_sell tests pass. Full workspace: 299 passed, 0 failed.
- **Committed in:** dd11e57

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Plan was verification-only but discovered 6 pre-existing PROFIT pool test failures missed by MAINT-02. Fixed inline. Effective MAINT-02 total was 43 (not 37): 19 AMM + 10 Tax SOL + 8 Epoch + 6 Tax PROFIT.

## Issues Encountered
None beyond the 6 test failures documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 299 workspace tests green -- safe to proceed with deployment plans (51-04 keypair generation, 51-05 build, 51-06 deploy)
- No blockers or concerns
- Code is verified stable across all 5 programs plus test helpers

---
*Phase: 51-program-rebuild-devnet-deploy*
*Completed: 2026-02-20*
