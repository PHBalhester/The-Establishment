---
phase: 12-profit-pool-swaps-and-swap-validation
plan: 01
subsystem: amm
tags: [anchor, solana, token-2022, transfer-hooks, constant-product-amm, swap]

# Dependency graph
requires:
  - phase: 11-sol-pool-swaps
    provides: swap_sol_pool instruction pattern, SwapDirection enum, SwapEvent
  - phase: 10-token-transfer-routing
    provides: transfer_t22_checked helper with hook account forwarding
provides:
  - swap_profit_pool instruction for pure T22 pools (CRIME/PROFIT, FRAUD/PROFIT)
  - Zero-output check functions in math.rs (check_effective_input_nonzero, check_swap_output_nonzero)
  - ZeroEffectiveInput and ZeroSwapOutput error variants
  - Dual-hook remaining_accounts splitting pattern
affects: [12-02 (profit pool tests), 13-cpi-gating]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-hook remaining_accounts split at midpoint for pure T22 pools"
    - "Zero-output protection via separate check functions (non-breaking pattern)"

key-files:
  created:
    - programs/amm/src/instructions/swap_profit_pool.rs
  modified:
    - programs/amm/src/helpers/math.rs
    - programs/amm/src/errors.rs
    - programs/amm/src/instructions/swap_sol_pool.rs
    - programs/amm/src/instructions/mod.rs
    - programs/amm/src/lib.rs

key-decisions:
  - "Zero-output checks as separate functions (not modifying existing math function signatures) to avoid breaking Phase 8 proptests"
  - "Midpoint split for dual-hook remaining_accounts (both mints use same hook program with identical ExtraAccountMetaList structure)"
  - "Re-export SwapDirection from swap_sol_pool (one definition, two consumers)"

patterns-established:
  - "Zero-output protection pattern: check after fee deduction + check after swap math, distinct errors for each"
  - "Dual-hook pattern: split remaining_accounts at midpoint, first half for input transfer, second half for output transfer"

# Metrics
duration: 5min
completed: 2026-02-04
---

# Phase 12 Plan 01: PROFIT Pool Swaps Summary

**swap_profit_pool instruction with dual-hook remaining_accounts split and zero-output protection backported to both swap instructions**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-04T00:00:00Z
- **Completed:** 2026-02-04T00:05:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added zero-output check functions to math.rs that prevent users from burning tokens for nothing
- Backported zero-output checks to swap_sol_pool for consistent behavior across all pool types
- Created swap_profit_pool instruction with dual-hook remaining_accounts splitting for pure T22 pools
- Both swap instructions now share SwapDirection enum and emit the same SwapEvent

## Task Commits

Each task was committed atomically:

1. **Task 1: Add zero-output check functions and error variants** - `0d0aa3e` (feat)
2. **Task 2: Backport zero-output checks to swap_sol_pool** - `be4cad8` (fix)
3. **Task 3: Create swap_profit_pool instruction with dual-hook support** - `8605ae1` (feat)

## Files Created/Modified

- `programs/amm/src/instructions/swap_profit_pool.rs` - New swap handler for pure T22 pools with dual-hook split (336 lines)
- `programs/amm/src/helpers/math.rs` - Added check_effective_input_nonzero and check_swap_output_nonzero functions
- `programs/amm/src/errors.rs` - Added ZeroEffectiveInput and ZeroSwapOutput error variants
- `programs/amm/src/instructions/swap_sol_pool.rs` - Imported and called zero-output check functions
- `programs/amm/src/instructions/mod.rs` - Added swap_profit_pool module
- `programs/amm/src/lib.rs` - Added swap_profit_pool entry point

## Decisions Made

- **Zero-output checks as separate functions:** Adding checks inside existing math functions would require changing their return types (Option to Result), breaking Phase 8 proptest compatibility. Separate check functions are non-breaking and called by handlers.
- **Midpoint remaining_accounts split:** Both CRIME and FRAUD mints use the same hook program with identical ExtraAccountMetaList structure, so each transfer needs the same number of hook accounts. Splitting at the midpoint is correct and simple.
- **SwapDirection re-export:** Used `pub use super::swap_sol_pool::SwapDirection` instead of duplicating the enum definition, ensuring both instructions share exactly the same type.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- swap_profit_pool instruction is compiled and exposed in IDL
- Zero-output protection is in place for both swap instructions
- Ready for Phase 12-02 (comprehensive test suite for PROFIT pools)
- All 55 existing tests pass with zero regressions

---
*Phase: 12-profit-pool-swaps-and-swap-validation*
*Completed: 2026-02-04*
