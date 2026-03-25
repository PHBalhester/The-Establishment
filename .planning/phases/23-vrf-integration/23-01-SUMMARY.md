---
phase: 23-vrf-integration
plan: 01
subsystem: epoch
tags: [vrf, switchboard, randomness, tax-derivation, solana]

# Dependency graph
requires:
  - phase: 22-epochstate-core
    provides: EpochState PDA structure, Token enum, initialize_epoch_state
provides:
  - switchboard-on-demand dependency for VRF parsing
  - derive_taxes() helper for VRF byte to tax rate conversion
  - TaxConfig struct with all 4 derived tax rates
  - VRF events (EpochTransitionTriggered, TaxesUpdated, VrfRetryRequested)
affects: [23-02 trigger_epoch_transition, 23-03 consume_randomness, 23-04 retry_epoch_vrf]

# Tech tracking
tech-stack:
  added: [switchboard-on-demand = "=0.11.3"]
  patterns: [discrete tax bands via modulo selection, 75% flip threshold at byte < 192]

key-files:
  created:
    - programs/epoch-program/src/helpers/mod.rs
    - programs/epoch-program/src/helpers/tax_derivation.rs
  modified:
    - programs/epoch-program/Cargo.toml
    - programs/epoch-program/src/lib.rs
    - programs/epoch-program/src/events.rs

key-decisions:
  - "Exact version pin for switchboard-on-demand (=0.11.3) - on-chain code frozen at deploy"
  - "Use u8 for cheap_side in events to avoid Anchor enum serialization complexity"

patterns-established:
  - "VRF byte 0 < 192 = 75% flip probability"
  - "VRF byte % 4 selects from 4-element rate arrays"
  - "8 discrete tax rates: 100,200,300,400 bps (low) and 1100,1200,1300,1400 bps (high)"

# Metrics
duration: 8min
completed: 2026-02-06
---

# Phase 23 Plan 01: VRF Foundation Summary

**Switchboard On-Demand dependency + derive_taxes() helper for VRF byte-to-discrete-tax-rate conversion**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-06
- **Completed:** 2026-02-06
- **Tasks:** 3/3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- Added switchboard-on-demand v0.11.3 with exact version pin for on-chain stability
- Created derive_taxes() function implementing spec Section 7.3 VRF byte parsing
- Defined TaxConfig struct with cheap_side and all 4 derived rates
- Added 5 unit tests verifying boundary conditions and rate assignments
- Added 3 VRF events per spec Section 12

## Task Commits

Each task was committed atomically:

1. **Task 1: Add switchboard-on-demand dependency** - `33080da` (feat)
2. **Task 2: Create tax derivation helper module** - `e7d1ecf` (feat)
3. **Task 3: Add VRF events to events.rs** - `acea6d1` (feat)

## Files Created/Modified
- `programs/epoch-program/Cargo.toml` - Added switchboard-on-demand = "=0.11.3"
- `programs/epoch-program/src/lib.rs` - Added helpers module export
- `programs/epoch-program/src/helpers/mod.rs` - Module exports for tax_derivation
- `programs/epoch-program/src/helpers/tax_derivation.rs` - derive_taxes() + TaxConfig + 5 tests
- `programs/epoch-program/src/events.rs` - Added 3 VRF events

## Decisions Made
- **Exact version pin:** Used `=0.11.3` not `^0.11.3` because on-chain code is frozen at deploy and must match tested version
- **u8 for cheap_side in events:** Avoids Anchor enum serialization complexity while maintaining clarity (0 = CRIME, 1 = FRAUD)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed as specified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- derive_taxes() ready for use in consume_randomness instruction (23-03)
- Events ready for emission in VRF instructions (23-02, 23-03, 23-04)
- switchboard-on-demand available for RandomnessAccountData parsing in VRF instructions

---
*Phase: 23-vrf-integration*
*Plan: 01*
*Completed: 2026-02-06*
