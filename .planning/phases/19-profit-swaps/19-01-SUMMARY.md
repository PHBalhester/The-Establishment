---
phase: 19-profit-swaps
plan: 01
subsystem: api
tags: [rust, anchor, events, swap, profit-pool]

# Dependency graph
requires:
  - phase: 18-tax-core
    provides: Tax Program foundation with TaxedSwap event and PoolType enum
provides:
  - UntaxedSwap event for PROFIT pool swap analytics
  - CrimeProfit and FraudProfit PoolType variants
affects: [19-02, 19-03, epoch-program]

# Tech tracking
tech-stack:
  added: []
  patterns: [UntaxedSwap event pattern for fee-only swaps]

key-files:
  created: []
  modified: [programs/tax-program/src/events.rs]

key-decisions:
  - "UntaxedSwap mirrors TaxedSwap structure sans tax fields per spec Section 20.3"

patterns-established:
  - "PROFIT pool events use UntaxedSwap (no tax_amount, no distribution portions)"

# Metrics
duration: 1min
completed: 2026-02-06
---

# Phase 19 Plan 01: PROFIT Pool Events Summary

**UntaxedSwap event and CrimeProfit/FraudProfit PoolType variants for PROFIT pool swap analytics**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-06T11:12:25Z
- **Completed:** 2026-02-06T11:13:33Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added CrimeProfit and FraudProfit variants to PoolType enum
- Added UntaxedSwap event struct matching Tax_Pool_Logic_Spec.md Section 20.3
- Enhanced doc comments with taxed/untaxed distinction

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PoolType variants and UntaxedSwap event** - `ab35f81` (feat)

## Files Created/Modified
- `programs/tax-program/src/events.rs` - Added CrimeProfit, FraudProfit variants; added UntaxedSwap event

## Decisions Made
- UntaxedSwap fields match spec Section 20.3 exactly: user, pool_type, direction, input_amount, output_amount, lp_fee, slot
- output_amount and lp_fee will be set to 0 initially (same pattern as TaxedSwap.output_amount) since CPI return data is not easily accessible

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- events.rs ready for Plan 02 to import and emit UntaxedSwap in swap_profit_buy/sell handlers
- PoolType has all 4 variants needed for complete pool coverage

---
*Phase: 19-profit-swaps*
*Completed: 2026-02-06*
