---
phase: 25-carnage-fund-execution
plan: 06
subsystem: epoch
tags: [carnage, fallback, cpi, swap-exempt, token-2022, burn]

# Dependency graph
requires:
  - phase: 25-05
    provides: VRF Carnage Integration (trigger logic in consume_randomness)
provides:
  - Complete fallback execute_carnage instruction with swap/burn execution
  - Token-2022 burn via invoke_signed
  - Tax::swap_exempt CPI for buy/sell operations
affects: [devnet-testing, integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fallback execution mirroring atomic path for resilience"
    - "Token-2022 burn via manual instruction building (discriminator 8)"
    - "Tax::swap_exempt CPI with carnage_signer PDA validation"

key-files:
  created: []
  modified:
    - programs/epoch-program/src/instructions/execute_carnage.rs
    - programs/epoch-program/src/lib.rs

key-decisions:
  - "Handler signature requires explicit lifetimes for remaining_accounts support"
  - "Deadline validation happens FIRST before any execution (fail-fast security)"
  - "CarnageExecuted event uses atomic=false to distinguish from atomic path"

patterns-established:
  - "Fallback handlers mirror atomic logic for consistent behavior"
  - "CPI helper functions shared between atomic and fallback paths"

# Metrics
duration: 12min
completed: 2026-02-06
---

# Phase 25 Plan 06: execute_carnage Fallback Implementation Summary

**Complete fallback Carnage execution with Token-2022 burn, Tax::swap_exempt CPI for sell/buy operations, and real event values**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-06T21:00:00Z
- **Completed:** 2026-02-06T21:12:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- ExecuteCarnage struct now matches ExecuteCarnageAtomic with all accounts for swap/burn execution
- Added burn_held_tokens helper using Token-2022 burn instruction (discriminator 8) via invoke_signed
- Added execute_sell_swap and execute_buy_swap helpers calling Tax::swap_exempt CPI
- CarnageExecuted event now emits real values (sol_spent, tokens_bought, tokens_burned, sol_from_sale)
- Removed all TODO/NOTE placeholder comments from execute_carnage.rs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add missing accounts to ExecuteCarnage struct** - `471cfea` (feat)
2. **Task 2: Add helper functions and update handler with execution logic** - `a9089bb` (feat)

## Files Created/Modified
- `programs/epoch-program/src/instructions/execute_carnage.rs` - Complete fallback Carnage execution (543 lines)
- `programs/epoch-program/src/lib.rs` - Updated handler signature for remaining_accounts lifetime

## Decisions Made
- **Handler signature:** Required explicit lifetimes `Context<'_, '_, 'info, 'info, ExecuteCarnage<'info>>` for remaining_accounts support in CPI
- **Deadline validation order:** Validate deadline FIRST before reading action/target to fail-fast on expired state
- **Event atomic field:** Uses `atomic: false` to distinguish fallback execution from atomic path for monitoring

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **Lifetime error in lib.rs:** The handler signature required explicit lifetime annotations to match the `Context<'_, '_, 'info, 'info, ExecuteCarnage<'info>>` pattern. Added lifetime parameters to `execute_carnage` function in lib.rs matching `execute_carnage_atomic`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Gap closure complete.** The verification gap identified in 25-VERIFICATION.md is now closed:
- execute_carnage is no longer a stub
- Full burn/sell/buy execution logic implemented
- CarnageExecuted event has real values
- All 59 epoch-program tests pass

**Ready for:**
- Devnet integration testing of fallback path
- End-to-end Carnage flow testing (atomic and fallback)

---
*Phase: 25-carnage-fund-execution*
*Plan: 06 (gap closure)*
*Completed: 2026-02-06*
