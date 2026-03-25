---
phase: 12-profit-pool-swaps-and-swap-validation
plan: 02
subsystem: testing
tags: [anchor, solana, token-2022, litesvm, constant-product-amm, swap, integration-tests]

# Dependency graph
requires:
  - phase: 12-01
    provides: swap_profit_pool instruction, zero-output check functions, dual-hook remaining_accounts split
  - phase: 11-sol-pool-swaps
    provides: swap_sol_pool instruction pattern, SwapDirection enum, SwapEvent
provides:
  - Comprehensive test suite for PROFIT pool swaps (18 tests)
  - Zero-output protection verification for both pool types
  - Cross-pool consistency tests (50 bps vs 100 bps fee comparison)
  - Edge case tests (minimum viable swap, imbalanced reserves, near-empty pools)
affects: [13-cpi-gating]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ProfitPoolTestContext for pure T22 pool testing (both tokens are T22)"
    - "SolPoolTestContext duplication for zero-output backport verification"
    - "Math-only tests for cross-pool fee consistency (no on-chain required)"

key-files:
  created:
    - programs/amm/tests/test_swap_profit_pool.rs
  modified: []

key-decisions:
  - "Duplicate SOL pool infrastructure for zero-output backport verification rather than importing from test_swap_sol_pool.rs (keeps test files independent)"
  - "Use math-only tests for cross-pool consistency (avoids redundant on-chain setup)"
  - "Test minimum viable swap at amount_in=201 (produces effective_input=199 with 50 bps, which gives non-zero output)"

patterns-established:
  - "ProfitPoolTestContext: setup_initialized_profit_pool() creates pure T22 pool with 50 bps fee"
  - "send_profit_swap(): helper to execute swap_profit_pool instruction"
  - "Imbalanced pool setup: create custom pool with extreme reserve ratios for edge case testing"

# Metrics
duration: 5min
completed: 2026-02-04
---

# Phase 12 Plan 02: PROFIT Pool Swap Tests Summary

**Comprehensive 18-test suite verifying PROFIT pool swaps (50 bps), zero-output protection, slippage, edge cases, and cross-pool fee consistency**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-04T21:44:23Z
- **Completed:** 2026-02-04T21:52:00Z
- **Tasks:** 3
- **Files created:** 1 (2494 lines)

## Accomplishments

- Created ProfitPoolTestContext infrastructure for pure T22 pool testing
- Added 18 tests covering PROFIT pool swap correctness, zero-output protection, slippage, edge cases, and cross-pool consistency
- Verified 12-01 zero-output backport works for SOL pools (ZeroEffectiveInput, ZeroSwapOutput)
- Total AMM test count now 73 tests (26 unit + 13 pool init + 18 PROFIT swap + 8 SOL swap + 8 transfer routing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PROFIT pool test infrastructure** - `8176983` (feat)
2. **Task 2: Add PROFIT pool swap tests and zero-output tests** - `467de98` (test)
3. **Task 3: Add edge case and cross-pool consistency tests** - `a8b3522` (test)

## Files Created/Modified

- `programs/amm/tests/test_swap_profit_pool.rs` (2494 lines) - Comprehensive PROFIT pool swap test suite

## Test Coverage

### PROFIT Pool Swap Tests (6 tests)
- `test_profit_pool_swap_a_to_b_correct_output` - AtoB swap with 50 bps fee
- `test_profit_pool_swap_b_to_a_correct_output` - BtoA swap with 50 bps fee
- `test_profit_pool_fee_50bps_compounds_into_reserves` - Fee retention verification
- `test_profit_pool_k_invariant_holds` - k_after >= k_before
- `test_profit_pool_event_emitted` - SwapEvent presence in logs
- `test_profit_pool_consecutive_swaps_succeed` - Reentrancy guard clears

### Zero-Output Tests (4 tests)
- `test_zero_effective_input_reverts_profit_pool` - amount_in=1 rejected (PROFIT pool)
- `test_zero_swap_output_reverts_profit_pool` - Imbalanced pool zero output (PROFIT pool)
- `test_zero_effective_input_reverts_sol_pool` - Verifies 12-01 backport (SOL pool)
- `test_zero_swap_output_reverts_sol_pool` - Verifies 12-01 backport (SOL pool)

### Dual-Hook Test (1 test)
- `test_profit_pool_swap_with_empty_remaining_accounts_succeeds` - Split logic handles empty case

### Slippage Tests (2 tests)
- `test_profit_pool_slippage_exact_boundary` - Exact boundary behavior
- `test_slippage_protection_profit_pool` - Unrealistic vs realistic constraints

### Edge Case Tests (3 tests)
- `test_minimum_viable_swap_profit_pool` - Boundary between zero and valid
- `test_heavily_imbalanced_reserves` - 1000:1 reserve ratio
- `test_near_empty_pool` - 1000 base units each side

### Cross-Pool Consistency Tests (2 tests)
- `test_profit_pool_produces_more_output_than_sol_pool` - Fee difference verification
- `test_fee_calculation_consistency` - 50 bps = half of 100 bps

## Decisions Made

- **Duplicate SOL pool infrastructure:** Rather than importing from test_swap_sol_pool.rs, duplicated the SolPoolTestContext and setup_initialized_sol_pool() helper. This keeps test files independent and self-contained, making maintenance easier.
- **Math-only cross-pool tests:** Tests 17 and 18 verify cross-pool consistency using math helpers only (no on-chain execution). This is sufficient since the math is already validated in other tests.
- **Minimum viable swap at 201:** For 50 bps fee, amount_in=201 produces effective_input=199 (integer division), which gives non-zero output from the constant-product formula.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All PROFIT pool swap requirements verified (SWAP-02, TEST-03, TEST-04, TEST-06)
- Zero-output protection proven functional for both pool types
- 73 total tests passing with zero regressions
- Ready for Phase 13: CPI Gating & Self-CPI

---
*Phase: 12-profit-pool-swaps-and-swap-validation*
*Completed: 2026-02-04*
