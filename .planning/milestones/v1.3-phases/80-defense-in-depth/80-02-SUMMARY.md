---
phase: 80-defense-in-depth
plan: 02
subsystem: security
tags: [overflow, checked-cast, u128, u64, try_from, defense-in-depth, enum-validation]

requires:
  - phase: 79-financial-safety
    provides: "Existing overflow error variants in all programs"
provides:
  - "Zero truncating u128-to-u64 casts in production math code"
  - "Checked Token::from_u8 conversion with InvalidCheapSide error"
  - "Defense-in-depth against silent data truncation regressions"
affects: [81-input-validation, 82-state-machine]

tech-stack:
  added: []
  patterns: ["u64::try_from() for all u128->u64 conversions in production code"]

key-files:
  created: []
  modified:
    - "programs/staking/src/helpers/math.rs"
    - "programs/tax-program/src/helpers/tax_math.rs"
    - "programs/bonding_curve/src/math.rs"
    - "programs/bonding_curve/src/instructions/claim_refund.rs"
    - "programs/epoch-program/src/instructions/execute_carnage.rs"
    - "programs/epoch-program/src/instructions/execute_carnage_atomic.rs"
    - "programs/epoch-program/src/instructions/consume_randomness.rs"
    - "programs/epoch-program/src/errors.rs"

key-decisions:
  - "get_current_price uses unwrap_or(u64::MAX) instead of Result since function returns u64 not Result"
  - "calculate_refund uses try_from().ok() since function returns Option<u64>"
  - "from_u8_unchecked retained in enums.rs for test coverage -- no production callers remain"

patterns-established:
  - "u128->u64 defense-in-depth: always use u64::try_from() even when mathematically bounded"

duration: 12min
completed: 2026-03-08
---

# Phase 80 Plan 02: Checked Arithmetic Casts Summary

**Replaced all truncating u128-to-u64 casts with u64::try_from() and added checked Token::from_u8 conversion with InvalidCheapSide error**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-08T10:56:00Z
- **Completed:** 2026-03-08T11:08:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Eliminated 11 truncating `as u64` casts from u128 intermediates across 4 programs (staking, tax, bonding curve, epoch)
- Added InvalidCheapSide error variant for corrupt epoch state detection
- consume_randomness now uses checked Token::from_u8 instead of unchecked fallback
- All four programs compile cleanly after changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace truncating u128-to-u64 casts (DEF-04)** - `4cad6a2` (fix)
2. **Task 2: Checked Token::from_u8 conversion (DEF-07)** - `1684fc9` (fix)

## Files Created/Modified
- `programs/staking/src/helpers/math.rs` - Pending reward cast: try_from with StakingError::Overflow
- `programs/tax-program/src/helpers/tax_math.rs` - Output floor cast: try_from().ok() (Option pattern)
- `programs/bonding_curve/src/math.rs` - tokens_out, sol_lamports, price, refund all checked
- `programs/bonding_curve/src/instructions/claim_refund.rs` - Refund proportion: try_from with CurveError::Overflow
- `programs/epoch-program/src/instructions/execute_carnage.rs` - Slippage expected/min_output checked
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` - Same slippage pattern
- `programs/epoch-program/src/instructions/consume_randomness.rs` - from_u8_unchecked -> from_u8 + error
- `programs/epoch-program/src/errors.rs` - Added InvalidCheapSide error variant

## Decisions Made
- get_current_price returns u64 (not Result), so used unwrap_or(u64::MAX) -- price can never overflow u64 since P_END=3450 fits trivially, but defense-in-depth pattern applied
- calculate_refund returns Option<u64>, so used try_from().ok() to maintain the Option signature
- from_u8_unchecked method retained in enums.rs for test coverage of fallback behavior; no production code calls it after this change

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All checked-cast patterns established; future math code should follow try_from pattern
- Ready for 80-03 (remaining defense-in-depth tasks)

---
*Phase: 80-defense-in-depth*
*Completed: 2026-03-08*
