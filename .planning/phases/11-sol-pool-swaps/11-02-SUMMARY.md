---
phase: 11-sol-pool-swaps
plan: 02
subsystem: amm
tags: [anchor, litesvm, integration-test, swap, constant-product, slippage, k-invariant, fee-compounding, reentrancy]

# Dependency graph
requires:
  - phase: 11-sol-pool-swaps
    provides: "swap_sol_pool instruction with SwapDirection, SlippageExceeded, k-invariant enforcement, reentrancy guard"
  - phase: 09-pool-initialization
    provides: "initialize_pool instruction, PoolState struct, pool PDA seeds"
  - phase: 10-token-transfer-routing
    provides: "Integration test patterns: litesvm setup, type bridge, token account helpers"
provides:
  - "8 integration tests proving swap_sol_pool correctness for mixed T22/SPL pools"
  - "Test-side constant-product math verification independent of program crate"
  - "Proof that LP fees compound into reserves (reserve_in grows by pre-fee amount_in)"
  - "Proof that reentrancy guard clears after each swap (consecutive swaps succeed)"
affects:
  - 12-profit-pool-swaps (test patterns reusable for swap_profit_pool tests)
  - 13-cpi-access-control (CPI tests will build on these swap test helpers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SwapTestContext struct with t22_is_mint_a flag for direction-aware testing"
    - "send_swap() helper for ergonomic swap execution in tests"
    - "Replicated swap math in test code for independent expected-value calculation"

key-files:
  created:
    - "programs/amm/tests/test_swap_sol_pool.rs"
  modified: []

key-decisions:
  - "Both tasks (infrastructure + tests) implemented in single commit since test file is standalone and helpers are test-private"
  - "Test-side math helpers replicate program math.rs formulas independently (no import from program crate)"
  - "SwapEvent verified via 'Program data:' log presence (direct event parsing impractical in litesvm)"

patterns-established:
  - "setup_initialized_pool() pattern: complete pool lifecycle from deploy to funded user in one helper"
  - "send_swap() pattern: single helper for swap execution returning TransactionResult"
  - "Direction-aware testing: t22_is_mint_a flag tracks which canonical position holds which token type"

# Metrics
duration: 4min
completed: 2026-02-04
---

# Phase 11 Plan 02: SOL Pool Swap Integration Tests Summary

**8 integration tests proving bidirectional swap correctness with constant-product output verification, fee compounding proof, slippage rejection, k-invariant enforcement, and reentrancy guard clearance**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-04T19:56:53Z
- **Completed:** 2026-02-04T20:01:41Z
- **Tasks:** 2 (implemented atomically in single commit)
- **Files created:** 1

## Accomplishments
- All 8 swap integration tests pass, exercising both AtoB and BtoA directions through a mixed T22/SPL pool
- Constant-product formula output verified with hand-calculated expected values using test-side math (independent of program crate)
- LP fee compounding proven: reserve_in grows by full amount_in (pre-fee), confirming fee revenue stays in pool
- Consecutive swaps succeed, proving reentrancy guard (locked: bool) clears correctly after each swap

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Create test infrastructure and all 8 integration tests** - `11a3a88` (test)

## Test Coverage

| Test | Requirement | What It Proves |
|------|------------|----------------|
| test_swap_a_to_b_correct_output | SWAP-01, SWAP-03 | AtoB output matches constant-product formula |
| test_swap_b_to_a_correct_output | SWAP-01, SWAP-03 | BtoA output matches constant-product formula |
| test_swap_fee_compounds_into_reserves | SWAP-04 | Fee stays in pool (reserve_in = old + amount_in) |
| test_swap_slippage_protection | SWAP-05, TEST-04 | minimum_amount_out enforcement works both ways |
| test_swap_k_invariant_holds | SWAP-07 | k_after >= k_before after swap |
| test_swap_zero_amount_rejected | SWAP-08 | Zero-amount swap rejected |
| test_swap_event_emitted | SWAP-09 | SwapEvent emitted (Program data: in logs) |
| test_consecutive_swaps_succeed | Reentrancy | Pool swappable again after first swap completes |

## Files Created/Modified
- `programs/amm/tests/test_swap_sol_pool.rs` - 8 integration tests with full test infrastructure: litesvm deployment, pool initialization, user funding, swap execution, and state verification

## Decisions Made
- **Single commit for both tasks:** The test file is standalone (no imports from other test files) and both infrastructure and tests are naturally intertwined. Splitting into two commits would create an incomplete first commit (infrastructure with zero tests).
- **Independent math verification:** Test-side `expected_effective_input()` and `expected_swap_output()` replicate the constant-product formula independently of `helpers/math.rs`. This ensures tests are truly independent -- a bug in math.rs would be caught by test-side expected values.
- **SwapEvent verification via logs:** Direct event deserialization from litesvm logs is impractical (would require base64 decode + Anchor event discriminator parsing). The test verifies `Program data:` appears in logs (confirming emit! executed) and relies on compile-time type checking (emit! with wrong fields would not compile).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 55 tests pass (26 unit + 13 pool init + 8 transfer routing + 8 swap) with zero regressions
- swap_sol_pool is fully tested for correctness, ready for Phase 12 (swap_profit_pool) which follows the same patterns
- Phase 13 (CPI access control) can build on these test helpers to test Tax Program -> AMM swap CPI flow

---
*Phase: 11-sol-pool-swaps*
*Completed: 2026-02-04*
