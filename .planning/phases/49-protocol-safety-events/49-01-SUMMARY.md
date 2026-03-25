---
phase: 49-protocol-safety-events
plan: 01
subsystem: security
tags: [slippage-floor, constant-product, balance-diff, events, sandwich-protection]

# Dependency graph
requires:
  - phase: 48-sell-tax-wsol-intermediary
    provides: "WSOL intermediary pattern, sell-side balance-diff event emission"
  - phase: 47-carnage-hardening
    provides: "read_pool_reserves raw byte pattern, BPS floor calculation with u128 intermediates"
provides:
  - "pool_reader.rs helper for reading AMM pool reserves from raw bytes"
  - "calculate_output_floor helper with u128 safe math"
  - "MINIMUM_OUTPUT_FLOOR_BPS constant (5000 = 50%)"
  - "MinimumOutputFloorViolation error variant"
  - "SEC-10 floor enforcement on swap_sol_buy and swap_sol_sell"
  - "FIX-06 buy-side TaxedSwap event with actual output_amount"
affects:
  - "49-02 (PROFIT pool floor + event fixes)"
  - "51 (test fixes -- integration tests need minimum_output >= floor)"
  - "Client-side swap builders (must pass minimum_output >= 50% of expected)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Protocol-enforced minimum output floor via constant-product pre-check"
    - "Balance-diff pattern for buy-side CPI output measurement (FIX-06)"
    - "Hard reject (not silent upgrade) for floor violations"

key-files:
  created:
    - "programs/tax-program/src/helpers/pool_reader.rs"
  modified:
    - "programs/tax-program/src/helpers/mod.rs"
    - "programs/tax-program/src/helpers/tax_math.rs"
    - "programs/tax-program/src/constants.rs"
    - "programs/tax-program/src/errors.rs"
    - "programs/tax-program/src/instructions/swap_sol_buy.rs"
    - "programs/tax-program/src/instructions/swap_sol_sell.rs"

key-decisions:
  - "Hard reject (not silent upgrade) for floor violations -- educates users/bots, matches Carnage approach"
  - "50% floor uses raw constant-product without LP fee adjustment -- at 50% threshold, ~1% LP fee is negligible"
  - "Floor uses sol_to_swap (post-tax) on buy side, not amount_in -- avoids inflated expected output"
  - "Floor checks minimum_output (pre-CPI) on sell side, not gross_output (post-CPI) -- catches zero-slippage bots before spending compute"

patterns-established:
  - "Balance-diff for buy-side: snapshot user_token_b.amount before CPI, reload after, compute tokens_received"
  - "Floor enforcement position: after tax calculation, before AMM CPI invoke_signed"
  - "Reserve direction: buy (AtoB) uses (reserve_a, reserve_b), sell (BtoA) uses (reserve_b, reserve_a)"

# Metrics
duration: 5min
completed: 2026-02-20
---

# Phase 49 Plan 01: Floor Helpers & SOL Pool Enforcement Summary

**50% constant-product output floor on SOL buy/sell swaps (SEC-10) with buy-side balance-diff event fix (FIX-06)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-20T10:23:39Z
- **Completed:** 2026-02-20T10:28:20Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Protocol-enforced 50% output floor prevents zero-slippage sandwich attacks on both buy and sell SOL swaps
- Buy-side TaxedSwap event now emits actual tokens_received instead of hardcoded 0
- 8 new unit tests for calculate_output_floor covering edge cases and overflow safety
- 44/44 unit tests pass, clean cargo check compilation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add floor calculation helpers, constant, and error variant** - `903a9b5` (feat)
2. **Task 2: Apply floor enforcement and balance-diff event fix to SOL pool swap instructions** - `de979ba` (feat)

## Files Created/Modified

- `programs/tax-program/src/helpers/pool_reader.rs` - New: reads AMM pool reserves from raw AccountInfo bytes at known offsets (137-153)
- `programs/tax-program/src/helpers/mod.rs` - Added pool_reader module export
- `programs/tax-program/src/helpers/tax_math.rs` - Added calculate_output_floor with u128 safe math and 8 unit tests
- `programs/tax-program/src/constants.rs` - Added MINIMUM_OUTPUT_FLOOR_BPS = 5000 constant
- `programs/tax-program/src/errors.rs` - Added MinimumOutputFloorViolation error variant
- `programs/tax-program/src/instructions/swap_sol_buy.rs` - Floor check before CPI, balance-diff for output_amount in event
- `programs/tax-program/src/instructions/swap_sol_sell.rs` - Floor check before CPI (existing event unchanged)

## Decisions Made

- **Hard reject over silent upgrade:** MinimumOutputFloorViolation error is returned when minimum_output < floor, rather than silently upgrading the minimum. This educates users/bots and matches the Carnage approach. Silent upgrade would mask broken frontends sending minimum_amount_out=0.
- **No LP fee adjustment in floor calculation:** At 50% floor, the ~1% LP fee is absorbed naturally. Raw constant-product is simpler and the 50% threshold provides massive tolerance per 49-RESEARCH.md Pitfall 4.
- **Post-tax input for buy-side floor:** Uses sol_to_swap (after tax deduction), not amount_in, because that is the actual effective input to the AMM. Using amount_in would compute inflated expected output.
- **Pre-CPI minimum_output check for sell-side:** The floor checks the user's stated minimum_output before CPI, not the actual gross_output after CPI. This catches bots/frontends sending minimum_output=0 before spending any compute on the swap.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all existing unit tests passed, compilation clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SEC-10 floor enforcement is active for SOL pool swaps (swap_sol_buy, swap_sol_sell)
- FIX-06 is resolved for swap_sol_buy (output_amount in TaxedSwap event)
- Ready for Plan 49-02 to apply same floor + event fixes to PROFIT pool swaps
- Client-side swap builders will need to pass minimum_output >= 50% of expected output (or transactions will be rejected)
- Pre-existing integration test failures (5 in test_swap_sol_buy) are tracked for Phase 51

---
*Phase: 49-protocol-safety-events*
*Completed: 2026-02-20*
