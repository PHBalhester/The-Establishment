---
phase: 23-vrf-integration
plan: 03
subsystem: epoch
tags: [vrf, randomness, switchboard, tax-derivation, anti-reroll]

# Dependency graph
requires:
  - phase: 23-01
    provides: derive_taxes() helper, TaxConfig struct, VRF events
provides:
  - consume_randomness instruction handler
  - Anti-reroll protection (verifies randomness account matches bound account)
  - VRF byte consumption and tax derivation
  - Token::from_u8_unchecked() for fallback conversion
affects: [23-04, 24, 25]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VRF byte consumption: RandomnessAccountData::parse() + get_value(clock.slot)"
    - "Anti-reroll: Store pubkey at commit, verify at consume"

key-files:
  created:
    - programs/epoch-program/src/instructions/consume_randomness.rs
  modified:
    - programs/epoch-program/src/instructions/mod.rs
    - programs/epoch-program/src/lib.rs
    - programs/epoch-program/src/state/enums.rs

key-decisions:
  - "Use from_u8_unchecked() for cheap_side conversion (fallback to Fraud for invalid values)"

patterns-established:
  - "VRF consumption pattern: parse + get_value + validate + derive_taxes + update state + emit event"
  - "MIN_VRF_BYTES = 6 constant for validation (flip + magnitudes + carnage bytes)"

# Metrics
duration: 4min
completed: 2026-02-06
---

# Phase 23-03: Consume Randomness Summary

**Consume revealed VRF bytes to update EpochState taxes with anti-reroll protection via bound randomness account verification**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-06T17:28:59Z
- **Completed:** 2026-02-06T17:32:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Implemented consume_randomness instruction that reads Switchboard VRF bytes
- Anti-reroll protection verifies randomness account matches pending_randomness_account
- VRF bytes 0-2 passed to derive_taxes() to calculate new tax rates
- All 7 EpochState tax fields updated (cheap_side, low/high bps, all 4 derived rates)
- vrf_pending cleared, taxes_confirmed set after successful consumption
- TaxesUpdated event emitted with flip indicator
- Added Token::from_u8_unchecked() for guaranteed conversion without Option handling
- Comprehensive unit tests for MIN_VRF_BYTES constant and Token enum

## Task Commits

Each task was committed atomically:

1. **Task 1: Create consume_randomness instruction** - `54a5c7c` (feat)
2. **Task 2: Add unit tests for consume_randomness** - `2fecdff` (test)

## Files Created/Modified

- `programs/epoch-program/src/instructions/consume_randomness.rs` - Main instruction handler with anti-reroll, VRF reading, tax derivation
- `programs/epoch-program/src/instructions/mod.rs` - Export consume_randomness module
- `programs/epoch-program/src/lib.rs` - Add consume_randomness entry point with documentation
- `programs/epoch-program/src/state/enums.rs` - Add from_u8_unchecked() and comprehensive tests

## Decisions Made

- **DISC-23-03-01:** Use `from_u8_unchecked()` for cheap_side conversion instead of `from_u8().unwrap()`. Rationale: EpochState stores cheap_side as u8, and while valid values are 0/1, a corrupted state shouldn't panic - falling back to Fraud is safe.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - Switchboard API worked as documented (parse(data) not &data, get_value(clock.slot) not &clock).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- consume_randomness completes the VRF three-transaction flow
- Ready for Phase 23-04: retry_epoch_vrf (timeout recovery)
- Ready for Phase 25: Carnage integration (bytes 3-5 parsing)

## Success Criteria Verification

- [x] VRF-06: Anti-reroll protection rejects mismatched randomness accounts
- [x] VRF-07: VRF bytes are read via get_value() and passed to derive_taxes()
- [x] VRF-08: EpochState updated with new epoch configuration (cheap_side, all tax rates)
- [x] TaxesUpdated event emitted with epoch, cheap_side, low/high bps, flipped
- [x] vrf_pending cleared, taxes_confirmed set after successful consume

---
*Phase: 23-vrf-integration*
*Completed: 2026-02-06*
