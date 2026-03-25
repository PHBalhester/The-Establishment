---
phase: 27-cross-program-integration
plan: 01
subsystem: staking
tags: [solana, anchor, cpi, staking, tax-program, pda-validation]

# Dependency graph
requires:
  - phase: 26-core-staking-program
    provides: Staking program with stake/unstake/claim and StakePool state
provides:
  - deposit_rewards instruction for Tax Program CPI
  - TAX_AUTHORITY_SEED constant for cross-program PDA gating
  - tax_program_id() function for seeds::program constraint
  - DEPOSIT_REWARDS_DISCRIMINATOR for CPI instruction building
affects:
  - 27-02-PLAN (needs Tax Program to export staking_program_id)
  - tax-program (needs to call deposit_rewards via CPI)

# Tech tracking
tech-stack:
  added: [sha2 (dev-dependency)]
  patterns: [seeds::program CPI gating, discriminator verification testing]

key-files:
  created:
    - programs/staking/src/instructions/deposit_rewards.rs
  modified:
    - programs/staking/src/constants.rs
    - programs/staking/src/instructions/mod.rs
    - programs/staking/src/lib.rs
    - programs/staking/Cargo.toml

key-decisions:
  - "TAX_AUTHORITY_SEED = b\"tax_authority\" matches Tax Program derivation"
  - "Discriminator computed as sha256(\"global:deposit_rewards\")[0..8]"

patterns-established:
  - "Cross-program CPI gating: seeds::program = foreign_program_id() constraint"
  - "Discriminator constants verified by test computing hash at compile time"

# Metrics
duration: 8min
completed: 2026-02-07
---

# Phase 27 Plan 01: deposit_rewards Instruction Summary

**deposit_rewards instruction with Tax Program CPI gating via seeds::program constraint on tax_authority PDA**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-07
- **Completed:** 2026-02-07
- **Tasks:** 3/3
- **Files modified:** 5

## Accomplishments

- Added deposit_rewards instruction to Staking Program accepting Tax Program CPI calls
- Implemented seeds::program constraint pattern for cross-program PDA validation
- Created TAX_AUTHORITY_SEED and tax_program_id() constants for CPI gating
- Added DEPOSIT_REWARDS_DISCRIMINATOR constant with verification test

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Tax Program constants to Staking Program** - `8d6fd44` (feat)
2. **Task 2: Implement deposit_rewards instruction** - `10d4dcd` (feat)
3. **Task 3: Add deposit_rewards discriminator test** - `c5a59e6` (feat)

## Files Created/Modified

- `programs/staking/src/instructions/deposit_rewards.rs` - New CPI-gated instruction handler
- `programs/staking/src/constants.rs` - Added TAX_AUTHORITY_SEED, tax_program_id(), DEPOSIT_REWARDS_DISCRIMINATOR
- `programs/staking/src/instructions/mod.rs` - Export deposit_rewards module
- `programs/staking/src/lib.rs` - Register deposit_rewards instruction
- `programs/staking/Cargo.toml` - Add sha2 dev-dependency for discriminator test

## Decisions Made

1. **TAX_AUTHORITY_SEED value:** Used `b"tax_authority"` (13 bytes) to match Tax Program's expected PDA derivation.

2. **Tax Program ID source:** Retrieved from `programs/tax-program/src/lib.rs` declare_id! macro: `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu`

3. **Discriminator format:** Computed as `sha256("global:deposit_rewards")[0..8]` following Anchor convention, stored as `[52, 249, 112, 72, 206, 161, 196, 1]`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - the RewardsDeposited event already existed in events.rs from Phase 26-01, so no prerequisite check action was needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- deposit_rewards instruction ready for Tax Program to call via CPI
- Tax Program needs to add staking_program_id() constant and TAX_AUTHORITY_SEED export
- Plan 27-02 will add update_cumulative instruction for Epoch Program CPI

---
*Phase: 27-cross-program-integration*
*Completed: 2026-02-07*
