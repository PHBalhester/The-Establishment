---
phase: 78-authority-hardening
plan: 02
subsystem: auth
tags: [anchor, programdata, upgrade-authority, solana, access-control]

# Dependency graph
requires:
  - phase: 78-authority-hardening/01
    provides: "BcAdminConfig PDA pattern (bonding curve authority hardening)"
provides:
  - "ProgramData upgrade authority checks on all 6 init instructions across 5 programs"
  - "AUTH-02 through AUTH-06 requirements satisfied"
affects: [deploy-scripts, integration-tests, initialize.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ProgramData upgrade authority constraint pattern for init instructions"
    - "program.programdata_address()? == Some(program_data.key()) + program_data.upgrade_authority_address == Some(signer.key())"

key-files:
  created: []
  modified:
    - programs/transfer-hook/src/instructions/initialize_authority.rs
    - programs/staking/src/instructions/initialize_stake_pool.rs
    - programs/epoch-program/src/instructions/initialize_epoch_state.rs
    - programs/epoch-program/src/instructions/initialize_carnage_fund.rs
    - programs/conversion-vault/src/instructions/initialize.rs
    - programs/tax-program/src/instructions/initialize_wsol_intermediary.rs

key-decisions:
  - "Followed exact AMM initialize_admin.rs pattern for consistency across all programs"

patterns-established:
  - "All init instructions require ProgramData upgrade authority verification via two-account constraint pattern"

# Metrics
duration: 4min
completed: 2026-03-08
---

# Phase 78 Plan 02: ProgramData Upgrade Authority Checks Summary

**ProgramData upgrade authority constraint added to all 6 init instructions across Transfer Hook, Staking, Epoch, Conversion Vault, and Tax programs**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T09:42:16Z
- **Completed:** 2026-03-08T09:46:24Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Transfer Hook initialize_authority now gated by ProgramData upgrade authority check (AUTH-02)
- Staking initialize_stake_pool now gated by ProgramData upgrade authority check (AUTH-03)
- Epoch initialize_epoch_state and initialize_carnage_fund now gated (AUTH-04, AUTH-05)
- Conversion Vault initialize now gated by ProgramData upgrade authority check (AUTH-06)
- Tax Program initialize_wsol_intermediary also gated for consistency
- All 5 programs compile cleanly, no test regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ProgramData checks to Transfer Hook, Staking, and Epoch programs** - `c0d71be` (feat)
2. **Task 2: Add ProgramData checks to Conversion Vault and Tax Program** - `0b84b97` (feat)

## Files Created/Modified
- `programs/transfer-hook/src/instructions/initialize_authority.rs` - Added program + program_data accounts with upgrade authority constraint
- `programs/staking/src/instructions/initialize_stake_pool.rs` - Added program + program_data accounts with upgrade authority constraint
- `programs/epoch-program/src/instructions/initialize_epoch_state.rs` - Added program + program_data accounts with upgrade authority constraint
- `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` - Added program + program_data accounts with upgrade authority constraint
- `programs/conversion-vault/src/instructions/initialize.rs` - Added program + program_data accounts with upgrade authority constraint
- `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs` - Added program + program_data accounts with upgrade authority constraint

## Decisions Made
- Followed exact AMM initialize_admin.rs pattern for consistency across all programs
- Each init instruction gets two new accounts: `program: Program<...>` and `program_data: Account<ProgramData>`
- Constraint pattern: `programdata_address()? == Some(program_data.key())` and `upgrade_authority_address == Some(signer.key())`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Tax-program has 5 pre-existing test failures in test_swap_sol_buy (InvalidTreasury error, unrelated to ProgramData changes). Verified identical behavior before and after changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 6 init instructions hardened with ProgramData checks
- Deploy scripts (initialize.ts) will need to pass ProgramData accounts when calling these instructions on next redeploy
- Ready for 78-03 (remaining authority hardening tasks)

---
*Phase: 78-authority-hardening*
*Completed: 2026-03-08*
