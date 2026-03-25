---
phase: 25-carnage-fund-execution
plan: 02
subsystem: epoch
tags: [vrf, carnage, solana, anchor, token-2022]

# Dependency graph
requires:
  - phase: 25-01
    provides: "CarnageFundState, constants, events, errors for Carnage Fund"
  - phase: 23
    provides: "Token and CarnageAction enums from state/enums.rs"
provides:
  - "is_carnage_triggered, get_carnage_action, get_carnage_target VRF helpers"
  - "initialize_carnage_fund instruction with PDA vault creation"
affects: [25-03, 25-04, 25-05]

# Tech tracking
tech-stack:
  added: []
  patterns: ["VRF byte interpretation via modulo/threshold logic", "Token-2022 vault PDA initialization"]

key-files:
  created:
    - "programs/epoch-program/src/helpers/carnage.rs"
    - "programs/epoch-program/src/instructions/initialize_carnage_fund.rs"
  modified:
    - "programs/epoch-program/src/helpers/mod.rs"
    - "programs/epoch-program/src/instructions/mod.rs"
    - "programs/epoch-program/src/lib.rs"

key-decisions:
  - "VRF bytes 3-5 used for Carnage logic (bytes 0-2 reserved for tax derivation)"
  - "Carnage trigger threshold = 11 (~4.3% probability)"
  - "Carnage sell threshold = 5 (~2% when has holdings)"

patterns-established:
  - "VRF helper pattern: use constants for thresholds, return typed enums"
  - "Carnage vault authority = CarnageFundState PDA (enables PDA signing for token transfers)"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 25 Plan 02: Carnage VRF Helpers and Initialization Summary

**VRF byte 3-5 interpretation helpers for Carnage trigger/action/target and initialize_carnage_fund instruction creating state + vault PDAs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T20:11:43Z
- **Completed:** 2026-02-06T20:14:44Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Created 3 Carnage VRF helper functions with 10 unit tests
- Created initialize_carnage_fund instruction with CarnageFundState PDA
- Token vaults created as Token-2022 accounts with carnage_state as authority
- SOL vault is SystemAccount PDA for native lamport storage

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Carnage helper module with VRF byte logic** - `bbeb6c6` (feat)
2. **Task 2: Create initialize_carnage_fund instruction** - `f99ac05` (feat)

## Files Created/Modified

- `programs/epoch-program/src/helpers/carnage.rs` - VRF byte interpretation helpers (is_carnage_triggered, get_carnage_action, get_carnage_target)
- `programs/epoch-program/src/helpers/mod.rs` - Export carnage module
- `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` - One-time initialization instruction
- `programs/epoch-program/src/instructions/mod.rs` - Export initialize_carnage_fund
- `programs/epoch-program/src/lib.rs` - Add initialize_carnage_fund to program module

## Decisions Made

1. **VRF byte allocation**: Bytes 3-5 for Carnage, bytes 0-2 for tax derivation (per spec)
2. **Token authority**: CarnageFundState PDA is authority for both token vaults (enables PDA signing)
3. **SOL vault type**: SystemAccount rather than Token account (native lamports, simpler)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - CarnageFundInitialized event and CarnageAlreadyInitialized error were already added by 25-01 (Task 3 of that plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Carnage helper functions ready for consume_randomness integration (25-03)
- initialize_carnage_fund instruction ready for deployment
- Token vaults use Token-2022 via InterfaceAccount for CRIME/FRAUD compatibility

---
*Phase: 25-carnage-fund-execution*
*Completed: 2026-02-06*
