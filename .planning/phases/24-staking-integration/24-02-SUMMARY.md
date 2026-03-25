---
phase: 24-staking-integration
plan: 02
subsystem: epoch
tags: [cpi, pda, staking, invoke_signed, discriminator]

# Dependency graph
requires:
  - phase: 24-01
    provides: stub-staking program with update_cumulative instruction
  - phase: 23
    provides: consume_randomness instruction with VRF processing
provides:
  - STAKING_AUTHORITY_SEED constant for CPI signing
  - UPDATE_CUMULATIVE_DISCRIMINATOR for instruction data
  - consume_randomness CPI to staking after tax derivation
  - Cross-program PDA signing pattern
affects: [24-03, 24-04, 25-carnage]

# Tech tracking
tech-stack:
  added: [sha2 (dev-dependency for tests)]
  patterns: [invoke_signed with PDA signer, Anchor discriminator computation]

key-files:
  created: []
  modified:
    - programs/epoch-program/src/constants.rs
    - programs/epoch-program/src/instructions/consume_randomness.rs
    - programs/epoch-program/Cargo.toml

key-decisions:
  - "Discriminator pre-computed and hardcoded for CPI efficiency"
  - "CPI happens after tax derivation, before TaxesUpdated event (per CONTEXT.md timing)"
  - "Use ? propagation for CPI errors (atomic revert on staking failure)"

patterns-established:
  - "Cross-program CPI with invoke_signed: build Instruction, derive seeds with bump, invoke_signed"
  - "Anchor discriminator: sha256(global:instruction_name)[0..8]"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 24 Plan 02: Epoch Program CPI Integration Summary

**invoke_signed CPI from consume_randomness to staking update_cumulative with PDA signer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T18:57:22Z
- **Completed:** 2026-02-06T19:00:42Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added STAKING_AUTHORITY_SEED and UPDATE_CUMULATIVE_DISCRIMINATOR constants
- Integrated staking CPI into consume_randomness handler
- CPI timing: after tax derivation (step 6), before TaxesUpdated event (step 8)
- Added unit tests verifying discriminator matches sha256 computation
- Seeds verified matching between epoch-program and stub-staking

## Task Commits

Each task was committed atomically:

1. **Task 1: Add staking authority PDA and constants** - `71427b4` (feat)
2. **Task 2: Add staking CPI to consume_randomness** - `3ef15e4` (feat)
3. **Task 3: Add unit tests for staking CPI constants** - `77614f5` (test)

## Files Created/Modified

- `programs/epoch-program/src/constants.rs` - Added STAKING_AUTHORITY_SEED and UPDATE_CUMULATIVE_DISCRIMINATOR
- `programs/epoch-program/src/instructions/consume_randomness.rs` - Added staking_authority, stake_pool, staking_program accounts and CPI logic
- `programs/epoch-program/Cargo.toml` - Added sha2 dev-dependency for tests

## Decisions Made

1. **Discriminator hardcoded:** Pre-computed sha256("global:update_cumulative")[0..8] and stored as constant for runtime efficiency
2. **CPI timing:** Placed after VRF pending cleared (step 7), before TaxesUpdated event (step 8), per CONTEXT.md specification
3. **Error handling:** Used `?` propagation - if staking CPI fails, entire consume_randomness reverts atomically

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CPI integration complete, ready for devnet integration testing (Plan 24-03)
- Both epoch-program and stub-staking build and pass tests
- Seed matching verified: both use `b"staking_authority"`
- Cross-program PDA pattern established for future integrations

---
*Phase: 24-staking-integration*
*Completed: 2026-02-06*
