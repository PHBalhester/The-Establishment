---
phase: 18-tax-program-core
plan: 02
subsystem: tax
tags: [rust, anchor, math, u128, basis-points, tdd, proptest]

# Dependency graph
requires:
  - phase: 18-01
    provides: Tax Program scaffold with constants, errors, events modules
provides:
  - calculate_tax function for basis point tax calculation
  - split_distribution function for 75/24/1 staking/carnage/treasury split
  - Micro-tax edge case handling (< 4 lamports all to staking)
  - u128 intermediate arithmetic pattern for overflow safety
  - 27 tests including 10,000-iteration proptest coverage
affects:
  - 18-03 (swap instructions will import these math functions)
  - 18-04 (integration tests will verify math behavior)

# Tech tracking
tech-stack:
  added: [proptest]
  patterns:
    - u128 intermediates for all tax multiplication
    - checked_* operations throughout (never panic)
    - Option<T> return for overflow safety
    - Treasury absorbs rounding remainder (invariant preservation)

key-files:
  created:
    - programs/tax-program/src/helpers/tax_math.rs
  modified: []

key-decisions:
  - "Micro-tax threshold: 4 lamports (below this, all goes to staking)"
  - "Distribution order: staking (75% floor) -> carnage (24% floor) -> treasury (remainder)"
  - "Invalid bps (>10000) returns None rather than panic"

patterns-established:
  - "Tax math uses u128 intermediates like AMM math.rs"
  - "Proptest with 10,000 iterations for overflow safety"
  - "Invariant test: staking + carnage + treasury == total_tax"

# Metrics
duration: 12min
completed: 2026-02-06
---

# Phase 18 Plan 02: Tax Math Functions Summary

**TDD implementation of calculate_tax and split_distribution with u128 overflow protection, micro-tax edge case handling, and 10,000-iteration proptest coverage**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-06T10:23:20Z
- **Completed:** 2026-02-06T10:35:00Z
- **Tasks:** 1 (TDD: RED -> GREEN -> REFACTOR)
- **Files modified:** 1

## Accomplishments

- Implemented calculate_tax with u128 intermediates and bps validation
- Implemented split_distribution with micro-tax rule and remainder absorption
- 27 tests passing including 6 proptest properties with 10,000 iterations each
- Established tax math patterns matching AMM's math.rs style

## Task Commits

This was a TDD plan with RED -> GREEN cycle:

1. **RED: Failing tests** - `0fec026` (test)
   - 21 unit tests for calculate_tax and split_distribution
   - 6 proptest properties for overflow safety, monotonicity, invariants
   - Stub implementations returning None

2. **GREEN: Implementation** - `973c0f5` (feat)
   - calculate_tax with u128 intermediates and bps <= 10000 validation
   - split_distribution with micro-tax rule and remainder to treasury
   - All 27 tests pass

**Note:** Scaffold was created via Rule 3 blocker fix in `4dd9c95` (chore) because plan 18-01 was not fully executed.

## Files Created/Modified

- `programs/tax-program/src/helpers/tax_math.rs` - 359 lines
  - calculate_tax(amount_lamports, tax_bps) -> Option<u64>
  - split_distribution(total_tax) -> Option<(u64, u64, u64)>
  - Full test suite with proptest

## Decisions Made

1. **Micro-tax threshold = 4 lamports:** Per CONTEXT.md discretion, amounts below 4 lamports send all tax to staking. Rationale: minimum for meaningful 3-way split (floor(4 * 0.24) = 0 anyway).

2. **Invalid bps returns None:** Tax rates > 10000 (100%) return None rather than panic. Caller maps to TaxError::TaxOverflow.

3. **No REFACTOR phase needed:** Implementation was already minimal and clean following GREEN phase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created tax-program scaffold**
- **Found during:** Plan startup
- **Issue:** Plan 18-02 depends on tax-program/helpers/tax_math.rs but 18-01 wasn't executed
- **Fix:** Created minimal scaffold (Cargo.toml, lib.rs, constants.rs, errors.rs, events.rs, helpers/mod.rs, tax_math.rs placeholder)
- **Files created:** 7 files in programs/tax-program/
- **Verification:** anchor build -p tax-program compiles
- **Committed in:** 4dd9c95

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Scaffold was necessary infrastructure. No scope creep - all files were specified in 18-01 plan.

## Issues Encountered

None - TDD cycle executed smoothly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- tax_math module ready for import by swap instructions
- calculate_tax and split_distribution are pure functions, no dependencies
- Plan 18-03 (swap instructions) can now implement tax flow

---
*Phase: 18-tax-program-core*
*Completed: 2026-02-06*
