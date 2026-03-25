---
phase: 24-staking-integration
plan: 01
subsystem: staking
tags: [anchor, pda, cpi, staking, epoch]

# Dependency graph
requires:
  - phase: 23-vrf-integration
    provides: Epoch Program with VRF-driven epoch transitions
provides:
  - Stub Staking Program for Epoch Program CPI testing
  - StubStakePool PDA with cumulative epoch tracking
  - CPI-gated update_cumulative instruction
  - Double-finalization protection via last_epoch check
affects: [24-02, 25-carnage-execution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "seeds::program = epoch_program_id() for cross-program CPI gating"
    - "Static compile-time LEN assertions for account size verification"

key-files:
  created:
    - programs/stub-staking/src/lib.rs
    - programs/stub-staking/src/state.rs
    - programs/stub-staking/src/errors.rs
    - programs/stub-staking/Cargo.toml
  modified:
    - Anchor.toml

key-decisions:
  - "Use anchor-lang 0.32.1 to match workspace (not 0.30.1 from mock-tax-program pattern)"
  - "STAKING_AUTHORITY_SEED = b\"staking_authority\" - must match Epoch Program derivation"

patterns-established:
  - "Cross-program PDA gating pattern: seeds::program = epoch_program_id() for CPI access control"
  - "Stub program pattern for testing CPI integrations before full implementation"

# Metrics
duration: 15min
completed: 2026-02-06
---

# Phase 24 Plan 01: Stub Staking Program Summary

**Minimal Staking Program stub with CPI-gated update_cumulative for Epoch Program integration testing**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-06T18:50:00Z
- **Completed:** 2026-02-06T19:05:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created stub-staking program with initialize and update_cumulative instructions
- Implemented CPI access control via seeds::program = epoch_program_id() constraint
- Added double-finalization protection requiring epoch > last_epoch
- Added unit tests verifying StubStakePool LEN constant correctness

## Task Commits

Each task was committed atomically:

1. **Task 1: Create stub-staking program structure** - `a445df5` (feat)
2. **Task 2: Add unit tests for StubStakePool** - `8178b32` (test)

## Files Created/Modified
- `programs/stub-staking/Cargo.toml` - Package configuration with anchor-lang 0.32.1
- `programs/stub-staking/src/lib.rs` - Main program with initialize and update_cumulative instructions
- `programs/stub-staking/src/state.rs` - StubStakePool account struct with LEN constants
- `programs/stub-staking/src/errors.rs` - AlreadyUpdated, Overflow, NotInitialized errors
- `Anchor.toml` - Added stub_staking program ID
- `keypairs/StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU.json` - Program keypair

## Decisions Made
- **anchor-lang version**: Used 0.32.1 instead of 0.30.1 (plan referenced mock-tax-program pattern which uses older version, but workspace requires 0.32.1 for compatibility)
- **Vanity program ID**: Generated StUb prefix for recognizable program ID: StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated anchor-lang from 0.30.1 to 0.32.1**
- **Found during:** Task 1 (initial build)
- **Issue:** Plan specified anchor-lang 0.30.1 (from mock-tax-program pattern), but workspace uses 0.32.1 causing solana-account version conflict
- **Fix:** Updated Cargo.toml to use anchor-lang 0.32.1
- **Files modified:** programs/stub-staking/Cargo.toml
- **Verification:** anchor build -p stub-staking succeeds
- **Committed in:** a445df5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for workspace compatibility. No scope creep.

## Issues Encountered
None - plan executed smoothly after dependency fix.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Stub Staking Program ready for Epoch Program CPI integration
- STAKING_AUTHORITY_SEED defined and documented for Epoch Program to derive matching PDA
- Ready for 24-02 to add CPI call from Epoch Program's consume_randomness

---
*Phase: 24-staking-integration*
*Completed: 2026-02-06*
