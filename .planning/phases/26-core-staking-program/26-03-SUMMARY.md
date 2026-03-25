---
phase: 26-core-staking-program
plan: 03
subsystem: staking
tags: [anchor, rust, pda, token-2022, dead-stake, first-depositor-attack]

# Dependency graph
requires:
  - phase: 26-01
    provides: StakePool and UserStake state structs with LEN constants
provides:
  - InitializeStakePool accounts struct with 3 PDAs
  - initialize_stake_pool instruction handler
  - Dead stake transfer for first-depositor attack mitigation
  - StakePoolInitialized event emission
affects: [26-04-stake-unstake, 27-cpi-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dead stake pattern: MINIMUM_STAKE transferred at init for first-depositor attack mitigation"
    - "remaining_accounts passthrough for Token-2022 transfer hook compatibility"

key-files:
  created:
    - programs/staking/src/instructions/mod.rs
    - programs/staking/src/instructions/initialize_stake_pool.rs
  modified:
    - programs/staking/src/lib.rs

key-decisions:
  - "EscrowVault is system account (space=0) not token account - holds native SOL"
  - "StakeVault authority is stake_pool PDA for transfer-out on unstake"
  - "total_staked initialized to 0 then set to MINIMUM_STAKE after transfer for clarity"

patterns-established:
  - "PDA vault authority: stake_pool PDA owns stake_vault for authorized transfers"
  - "Dead stake: 1 PROFIT (1_000_000 units) transferred at init, never claimable"

# Metrics
duration: 4min
completed: 2026-02-06
---

# Phase 26 Plan 03: Initialize Stake Pool Summary

**InitializeStakePool instruction with 3 PDAs and MINIMUM_STAKE dead stake to prevent first-depositor attack**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-06T22:41:59Z
- **Completed:** 2026-02-06T22:46:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created instructions module structure following AMM pattern
- Implemented InitializeStakePool accounts struct with 3 PDAs:
  - StakePool (global state, seeds=["stake_pool"])
  - EscrowVault (native SOL, seeds=["escrow_vault"])
  - StakeVault (Token-2022 PROFIT, seeds=["stake_vault"])
- Transfers MINIMUM_STAKE (1 PROFIT = 1,000,000 units) as dead stake
- Emits StakePoolInitialized event with vault addresses per EVNT-01
- Passes remaining_accounts for transfer hook compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Create instructions module structure** - `e8466ab` (feat)
2. **Task 2: Implement initialize_stake_pool instruction** - `1acec45` (feat)

## Files Created/Modified
- `programs/staking/src/instructions/mod.rs` - Instructions module export structure
- `programs/staking/src/instructions/initialize_stake_pool.rs` - InitializeStakePool accounts + handler (149 lines)
- `programs/staking/src/lib.rs` - Added instructions module and initialize_stake_pool entry point

## Decisions Made
- EscrowVault uses `space = 0` as system account (not token account) for native SOL
- StakeVault authority set to stake_pool PDA so pool can transfer out on unstake
- Pool state initialized to 0 first, then set to MINIMUM_STAKE after transfer for code clarity
- Uses Token-2022 interface (InterfaceAccount) for PROFIT token compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - build succeeded on first attempt after files were created.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- InitializeStakePool instruction ready for testing
- Foundation in place for stake/unstake instructions (26-04)
- StakePool PDA authority established for vault transfers

---
*Phase: 26-core-staking-program*
*Completed: 2026-02-06*
