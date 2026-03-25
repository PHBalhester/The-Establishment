---
phase: 08-foundation-scaffolding
plan: 02
subsystem: math
tags: [rust, amm, constant-product, swap, proptest, u128, checked-arithmetic, tdd]

# Dependency graph
requires:
  - phase: 08-01
    provides: Compiling AMM workspace with helpers/math.rs placeholder, proptest dev-dependency, error types, fee constants
provides:
  - Three pure math functions (calculate_effective_input, calculate_swap_output, verify_k_invariant) with u128 checked arithmetic
  - Comprehensive test suite (22 hand-picked unit tests + 3 proptest property tests at 10,000 iterations each)
  - Proven k-invariant preservation across randomized inputs
  - Proven output-bounds safety (output never exceeds reserve_out)
  - Proven fee monotonicity (higher fee = lower effective input)
affects:
  - Phase 9 (pool initialization may reference math for initial k calculation)
  - Phase 11-12 (swap instructions call calculate_effective_input, calculate_swap_output, verify_k_invariant)
  - Phase 13 (CPI wrapper forwards to swap instructions which use math)

# Tech tracking
tech-stack:
  added: []
  patterns: [tdd-red-green-refactor, proptest-property-testing, pure-math-module, checked-arithmetic-chain]

key-files:
  created: []
  modified:
    - programs/amm/src/helpers/math.rs

key-decisions:
  - "No refactor phase needed: implementation matched research examples exactly, code already minimal and well-documented"
  - "Proptest strategies use 90/10 split: 90% realistic values, 10% edge cases (0, 1, u64::MAX) to ensure both normal and boundary coverage"
  - "Fee monotonicity test uses delta-based strategy (fee_bps_low + delta) to guarantee fee_low <= fee_high without rejection sampling"

patterns-established:
  - "TDD for math: RED (stub + tests) -> GREEN (implement) -> REFACTOR (skip if clean)"
  - "Proptest strategies: weighted prop_oneof! for realistic + edge case distribution"
  - "Option chaining: checked_sub -> checked_mul -> checked_div in single expression for fee calc"
  - "u64::try_from(output).ok() for safe u128-to-u64 narrowing instead of manual range check"

# Metrics
duration: 3min
completed: 2026-02-03
---

# Phase 8 Plan 02: AMM Swap Math Module Summary

**Three pure constant-product swap math functions with u128 checked arithmetic, verified by 22 unit tests and 30,000 proptest iterations proving k-invariant preservation, output bounds, and fee monotonicity**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-03T23:13:59Z
- **Completed:** 2026-02-03T23:17:13Z
- **Tasks:** 2 (TDD RED + GREEN; REFACTOR skipped -- no changes needed)
- **Files modified:** 1

## Accomplishments
- Implemented `calculate_effective_input`: LP fee deduction using u128 checked arithmetic chain (`checked_sub -> checked_mul -> checked_div`)
- Implemented `calculate_swap_output`: constant-product formula with division-by-zero guard and `u64::try_from` narrowing
- Implemented `verify_k_invariant`: k_after >= k_before comparison in u128 with checked multiplication
- All 22 hand-picked unit tests pass covering normal cases, edge cases (0, 1, u64::MAX), and overflow scenarios
- All 3 proptest property tests pass with 10,000 iterations each (30,000 total randomized verifications)
- Zero Anchor/Solana imports -- module is pure Rust, tests run in <0.5 seconds
- `anchor build` succeeds with math implementation

## Task Commits

Each TDD phase was committed atomically:

1. **RED: Failing test suite** - `fc62bb8` (test)
   - 22 hand-picked unit tests + 3 proptest property tests
   - All fail against `todo!()` stubs
2. **GREEN: Implementation** - `27ee8c5` (feat)
   - Three functions implemented with checked arithmetic
   - All 26 tests pass (22 unit + 3 proptest + 1 program ID)

_REFACTOR phase skipped: code already minimal and matches research examples exactly._

## Files Created/Modified
- `programs/amm/src/helpers/math.rs` - Three public functions + comprehensive test suite (455 lines)

## Test Coverage

### Hand-picked Unit Tests (22 tests)

**Fee calculation (8 tests):**
- `fee_100bps_on_1000` -- 1% fee: 1000 -> 990
- `fee_50bps_on_1000` -- 0.5% fee: 1000 -> 995
- `fee_zero_bps` -- 0% fee: passthrough
- `fee_10000_bps` -- 100% fee: zero output
- `fee_over_10000_bps` -- Invalid fee: None (underflow)
- `fee_on_zero_amount` -- Zero input: zero output
- `fee_on_one` -- Dust truncation: 1 -> 0
- `fee_on_u64_max` -- Max input: no overflow

**Swap output (8 tests):**
- `swap_equal_reserves_1m` -- 1M/1M reserves: 999 output
- `swap_zero_effective_input` -- Zero in: zero out
- `swap_zero_reserve_out` -- Empty output: zero out
- `swap_zero_reserve_in_zero_effective` -- 0/0 denominator: None
- `swap_zero_reserve_in_nonzero_effective` -- Gets all reserves
- `swap_large_input_relative_to_reserve` -- Output < reserve_out always
- `swap_u64_max_reserves_small_input` -- Max reserves: no overflow
- `swap_output_cannot_exceed_u64` -- u64::try_from guard works

**k-invariant (6 tests):**
- `k_valid_swap` -- Correct swap: Some(true)
- `k_invalid_swap` -- Drained pool: Some(false)
- `k_equal_reserves` -- Unchanged: Some(true)
- `k_u64_max_both_sides` -- Max values fit in u128: Some(true)
- `k_zero_before_nonzero_after` -- Growth: Some(true)
- `k_nonzero_before_zero_after` -- Drain: Some(false)

### Proptest Property Tests (3 tests, 10,000 iterations each)

1. **k_invariant_holds_for_valid_swaps** -- For any random valid swap, k_after >= k_before
2. **output_never_exceeds_reserve_out** -- Swap output is always <= reserve_out
3. **fee_calculation_is_monotonic** -- Higher fee_bps always produces <= effective input

## Decisions Made
- **No refactor needed:** Implementation is 3 functions, each 3-5 lines of logic, matching the research examples exactly. No dead code, no redundant checks.
- **Proptest strategy design:** Used `prop_oneof!` with 90/10 weight split (realistic ranges vs edge cases) to ensure both normal operation coverage and boundary testing. Edge cases (0, 1, u64::MAX, u64::MAX/2) hit approximately 1,000 times per 10,000 iterations.
- **Fee monotonicity test strategy:** Used `fee_bps_low + delta` approach instead of generating two independent values and sorting, avoiding rejection sampling overhead.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Math module is complete and proven, ready for swap instruction handlers (Phase 11-12) to call these functions
- Error mapping pattern established: math returns `Option<T>`, instruction layer maps `None` to `AmmError::Overflow`
- Phase 9 (pool initialization) can proceed -- it needs state/pool.rs and initialization instruction, not math
- All proptest regression seeds cleaned up (were artifacts from RED phase stubs)

---
*Phase: 08-foundation-scaffolding*
*Completed: 2026-02-03*
