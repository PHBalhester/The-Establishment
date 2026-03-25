---
phase: 27-cross-program-integration
plan: 03
subsystem: staking
tags: [anchor, cpi, solana, tax-program, staking-program, pda]

# Dependency graph
requires:
  - phase: 27-01
    provides: deposit_rewards instruction in Staking Program with TAX_AUTHORITY_SEED constraint
provides:
  - Tax Program CPIs deposit_rewards after SOL transfer to staking escrow
  - TAX_AUTHORITY_SEED, STAKE_POOL_SEED constants in Tax Program
  - staking_program_id() function for CPI
  - DEPOSIT_REWARDS_DISCRIMINATOR for instruction data
affects: [27-04, 28-integration, 29-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CPI with PDA signing using invoke_signed
    - Cross-program discriminator verification via sha256 test

key-files:
  created: []
  modified:
    - programs/tax-program/src/constants.rs
    - programs/tax-program/src/instructions/swap_sol_buy.rs
    - programs/tax-program/src/instructions/swap_sol_sell.rs

key-decisions:
  - "TAX_AUTHORITY_SEED = b'tax_authority' matches Staking Program exactly"
  - "staking_program_id = StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF"
  - "DEPOSIT_REWARDS_DISCRIMINATOR = [52, 249, 112, 72, 206, 161, 196, 1] verified by test"
  - "CPI added immediately after SOL transfer to escrow in both swap instructions"

patterns-established:
  - "CPI flow: SOL transfer -> deposit_rewards CPI (SOL first, state update second)"
  - "Instruction data format: 8-byte discriminator + 8-byte amount"
  - "Account order for CPI: tax_authority (signer), stake_pool (writable)"

# Metrics
duration: 12min
completed: 2026-02-07
---

# Phase 27 Plan 03: Tax CPI Caller Summary

**Tax Program CPIs deposit_rewards to Staking Program after SOL tax distribution, completing the yield accounting flow**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-07
- **Completed:** 2026-02-07
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments

- Added Staking Program constants to Tax Program (TAX_AUTHORITY_SEED, STAKE_POOL_SEED, staking_program_id, DEPOSIT_REWARDS_DISCRIMINATOR)
- Modified swap_sol_buy to CPI deposit_rewards after staking SOL transfer
- Modified swap_sol_sell to CPI deposit_rewards after staking SOL transfer
- Added discriminator verification test to ensure cross-program compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Staking Program constants** - `f29bc85` (feat)
2. **Task 2: Add deposit_rewards CPI to swap_sol_buy** - `f7f42d2` (feat)
3. **Task 3: Add deposit_rewards CPI to swap_sol_sell** - `03aa78d` (feat)

## Files Created/Modified

- `programs/tax-program/src/constants.rs` - Added TAX_AUTHORITY_SEED, STAKE_POOL_SEED, staking_program_id(), DEPOSIT_REWARDS_DISCRIMINATOR, and helper functions
- `programs/tax-program/src/instructions/swap_sol_buy.rs` - Added tax_authority, stake_pool, staking_program accounts; CPI deposit_rewards after staking transfer
- `programs/tax-program/src/instructions/swap_sol_sell.rs` - Same pattern as swap_sol_buy for consistency

## Decisions Made

1. **CPI placement:** Immediately after SOL transfer to escrow. SOL is already in escrow when deposit_rewards is called - it only updates the pending_rewards counter.
2. **Account validation:** stake_pool uses `seeds::program = staking_program_id()` for cross-program PDA validation.
3. **Staking program address:** Using `address = staking_program_id()` constraint for static verification.
4. **Same pattern in both swaps:** swap_sol_sell mirrors swap_sol_buy exactly for maintainability.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Integration tests (test_swap_sol_buy, test_swap_sol_sell) fail because test fixtures don't include the new staking accounts (tax_authority, stake_pool, staking_program). This is expected - test updates will be addressed in Phase 29 (Full Integration Testing). All 31 library unit tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Tax Program now CPIs to Staking Program when distributing staking portion
- Ready for 27-04: Epoch Program CPI to update_cumulative
- Integration testing (Phase 29) will verify full CPI flow

---
*Phase: 27-cross-program-integration*
*Completed: 2026-02-07*
