---
phase: 25-carnage-fund-execution
plan: 01
subsystem: state
tags: [anchor, carnage, vrf, account-structure, token-2022]

# Dependency graph
requires:
  - phase: 23-vrf-integration
    provides: Token and CarnageAction enums for type-safe operations
provides:
  - CarnageFundState account (147 bytes) for tracking vault holdings
  - HeldToken enum (None/Crime/Fraud) for type-safe held_token access
  - VRF byte constants (trigger threshold 11, sell threshold 5)
  - PDA seeds (carnage_fund, carnage_sol_vault, carnage_crime_vault, carnage_fraud_vault)
  - 5 Carnage events (Initialized, Executed, Pending, Expired, NotTriggered)
  - 5 new Carnage errors for fund operations
affects: [25-02, 25-03, 25-04, carnage-initialization, carnage-execution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HeldToken enum with u8 storage like Token/CarnageAction"
    - "Static assertions for account size verification"

key-files:
  created:
    - programs/epoch-program/src/state/carnage_fund_state.rs
  modified:
    - programs/epoch-program/src/state/mod.rs
    - programs/epoch-program/src/constants.rs
    - programs/epoch-program/src/events.rs
    - programs/epoch-program/src/errors.rs

key-decisions:
  - "CarnageFundState::LEN = 147 (8 discriminator + 139 data)"
  - "HeldToken uses u8 storage (0=None, 1=Crime, 2=Fraud) to avoid Borsh complexity"

patterns-established:
  - "Carnage account follows EpochState pattern: LEN/DATA_LEN constants with static assertions"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 25 Plan 01: Carnage Fund Foundation Summary

**CarnageFundState account (147 bytes) with vault PDAs, VRF threshold constants, and Carnage-specific events/errors**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T20:09:51Z
- **Completed:** 2026-02-06T20:15:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Created CarnageFundState account with vault references, holdings tracking, and lifetime statistics
- Added HeldToken enum following established u8 pattern from Token/CarnageAction
- Defined VRF byte constants: trigger threshold (11) for 4.3% probability, sell threshold (5) for 2% probability
- Added 5 Carnage events for complete execution lifecycle tracking
- Added 5 Carnage-specific errors for fund operation failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CarnageFundState account and update state module** - `9b79640` (feat)
2. **Task 2: Add Carnage constants to constants.rs** - `9732f86` (feat)
3. **Task 3: Add Carnage events and errors** - `d524d55` (feat)

## Files Created/Modified
- `programs/epoch-program/src/state/carnage_fund_state.rs` - CarnageFundState account struct with HeldToken enum and LEN constants
- `programs/epoch-program/src/state/mod.rs` - Added carnage_fund_state module export
- `programs/epoch-program/src/constants.rs` - VRF thresholds and PDA seeds for Carnage Fund
- `programs/epoch-program/src/events.rs` - 5 new Carnage events (Initialized, Executed, Pending, Expired, NotTriggered)
- `programs/epoch-program/src/errors.rs` - 5 new Carnage errors for fund operations

## Decisions Made
- CarnageFundState size = 147 bytes (8 discriminator + 139 data) following EpochState pattern
- HeldToken uses u8 storage (0=None, 1=Crime, 2=Fraud) consistent with Token/CarnageAction enum patterns
- Static assertions verify size calculations at compile time

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CarnageFundState account structure ready for initialization instruction (25-02)
- All constants defined for VRF byte interpretation in consume_randomness
- Events ready for emission during Carnage lifecycle
- Errors ready for validation in instructions

---
*Phase: 25-carnage-fund-execution*
*Completed: 2026-02-06*
