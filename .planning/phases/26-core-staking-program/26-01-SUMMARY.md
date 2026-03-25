---
phase: 26-core-staking-program
plan: 01
subsystem: staking
tags: [anchor, rust, solana, staking, synthetix, cumulative-rewards, token-2022]

# Dependency graph
requires:
  - phase: 24-staking-integration
    provides: stub-staking CPI pattern and STAKING_AUTHORITY_SEED constant
provides:
  - Staking program crate with Cargo.toml and module structure
  - StakePool account (62 bytes) for global staking state
  - UserStake account (97 bytes) for per-user stake positions
  - PRECISION (1e18) and MINIMUM_STAKE (1e6) constants
  - 11 error variants (ERR-01 through ERR-05 plus arithmetic and state errors)
  - 6 event structs for all staking operations
  - PDA seed constants for stake_pool, user_stake, escrow_vault, stake_vault
affects:
  - 26-02-initialize-stake-pool
  - 26-03-stake-unstake
  - 26-04-claim
  - 27-cpi-integration

# Tech tracking
tech-stack:
  added: []  # No new dependencies, uses existing anchor-lang 0.32.1, anchor-spl
  patterns:
    - "StakePool account pattern: global singleton with cumulative reward tracking"
    - "UserStake account pattern: per-user PDA with checkpoint and balance"
    - "PRECISION constant (1e18) for DeFi-standard cumulative math"
    - "MINIMUM_STAKE dead stake for first-depositor attack mitigation"

key-files:
  created:
    - programs/staking/Cargo.toml
    - programs/staking/src/lib.rs
    - programs/staking/src/state/mod.rs
    - programs/staking/src/state/stake_pool.rs
    - programs/staking/src/state/user_stake.rs
    - programs/staking/src/constants.rs
    - programs/staking/src/errors.rs
    - programs/staking/src/events.rs
  modified: []

key-decisions:
  - "StakePool LEN = 62 bytes (discriminator + 8 fields)"
  - "UserStake LEN = 97 bytes (discriminator + 8 fields)"
  - "Added RewardsDeposited and CumulativeUpdated events for CPI operations"
  - "All events include slot field for indexer timeline reconstruction"
  - "Constants module includes STAKING_AUTHORITY_SEED for CPI verification"

patterns-established:
  - "Staking account sizing: discriminator (8) + field bytes"
  - "Event naming: past-tense action (Staked, Unstaked, Claimed)"
  - "Error organization: validation, authorization, arithmetic, state categories"

# Metrics
duration: 8min
completed: 2026-02-06
---

# Phase 26 Plan 01: Program Scaffold Summary

**Staking program scaffold with StakePool (62 bytes) and UserStake (97 bytes) accounts, PRECISION 1e18 for cumulative math, and 11 error variants covering all staking operations**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-06T22:34:34Z
- **Completed:** 2026-02-06T22:42:XX
- **Tasks:** 2
- **Files created:** 8

## Accomplishments

- Created staking program crate with full module structure (lib, state, constants, errors, events)
- Implemented StakePool account with 8 fields for global cumulative reward tracking
- Implemented UserStake account with 8 fields for per-user stake positions and checkpoints
- Defined PRECISION (1e18) for DeFi-standard cumulative reward math
- Defined MINIMUM_STAKE (1e6 = 1 PROFIT) for first-depositor attack mitigation
- Created 11 error variants covering validation, authorization, arithmetic, and state errors
- Created 6 event structs for all staking operations including CPI events

## Task Commits

Each task was committed atomically:

1. **Task 1: Create staking program crate structure** - `910814a` (feat)
   - Cargo.toml, lib.rs, state module with StakePool and UserStake accounts
   - Placeholder constants/errors/events for compilation

2. **Task 2: Create constants, errors, and events modules** - `aa4befd` (feat)
   - Full constants.rs with PRECISION, MINIMUM_STAKE, PDA seeds
   - Full errors.rs with 11 variants (ZeroAmount through AlreadyInitialized)
   - Full events.rs with 6 event structs

## Files Created

- `programs/staking/Cargo.toml` - Staking program crate config (anchor-lang 0.32.1, anchor-spl with token-2022)
- `programs/staking/src/lib.rs` - Program entry with declare_id! and module structure
- `programs/staking/src/state/mod.rs` - State module exports
- `programs/staking/src/state/stake_pool.rs` - StakePool global singleton (62 bytes)
- `programs/staking/src/state/user_stake.rs` - UserStake per-user account (97 bytes)
- `programs/staking/src/constants.rs` - PRECISION, MINIMUM_STAKE, PDA seeds
- `programs/staking/src/errors.rs` - 11 StakingError variants
- `programs/staking/src/events.rs` - 6 event structs for all operations

## Decisions Made

1. **StakePool fields:** Followed spec exactly - total_staked, rewards_per_token_stored (u128), pending_rewards, last_update_epoch (u32), total_distributed, total_claimed, initialized, bump
2. **UserStake fields:** Followed spec exactly - owner, staked_balance, rewards_per_token_paid (u128), rewards_earned, total_claimed, first_stake_slot, last_update_slot, bump
3. **Additional events:** Added RewardsDeposited and CumulativeUpdated events for CPI operations (Tax Program deposit, Epoch Program update)
4. **Slot in events:** All events include slot field for indexer timeline reconstruction (consistent with spec)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - straightforward scaffold creation following established AMM patterns.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Staking program scaffold complete and compiling
- Ready for Plan 26-02: initialize_stake_pool instruction
- All account structures, constants, errors, and events defined
- Instructions module placeholder exists for subsequent plans

---
*Phase: 26-core-staking-program*
*Completed: 2026-02-06*
