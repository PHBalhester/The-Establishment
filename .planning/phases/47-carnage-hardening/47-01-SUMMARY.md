# Phase 47 Plan 01: Shared Definitions + Atomic Slippage Hardening Summary

**One-liner:** Added carnage_lock_slot field, 85% slippage floor via u128, lock window constants, CarnageFailed event, CarnageLockActive error, and fixed Tax mirror LEN (FIX-05)

---

## Metadata

- **Phase:** 47 (Carnage Hardening)
- **Plan:** 01
- **Subsystem:** epoch-program, tax-program
- **Tags:** carnage, slippage, security, state-layout, constants
- **Duration:** ~5 min
- **Completed:** 2026-02-19

## Dependency Graph

- **Requires:** Phase 46 (account validation security)
- **Provides:** Shared constants (CARNAGE_SLIPPAGE_BPS_ATOMIC/FALLBACK, CARNAGE_LOCK_SLOTS), CarnageLockActive error, CarnageFailed event, EpochState.carnage_lock_slot field, 85% atomic slippage floor
- **Affects:** Phase 47 Plan 02 (fallback Carnage path uses CARNAGE_SLIPPAGE_BPS_FALLBACK and CarnageLockActive), Phase 47 Plan 03 (integration tests)

## Tech Stack

- **Added:** None (no new dependencies)
- **Patterns:** u128 intermediate arithmetic for BPS slippage calculations, lock window state field for multi-path coordination

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add shared constants, errors, events, and EpochState field | a683ae7 | constants.rs, errors.rs, events.rs, epoch_state.rs, epoch_state_reader.rs, REQUIREMENTS.md |
| 2 | Upgrade atomic path slippage and wire lock window | 0e535f4 | execute_carnage_atomic.rs, consume_randomness.rs |

## Key Files

### Created
None

### Modified
- `programs/epoch-program/src/constants.rs` -- Added CARNAGE_SLIPPAGE_BPS_ATOMIC (8500), CARNAGE_SLIPPAGE_BPS_FALLBACK (7500), CARNAGE_LOCK_SLOTS (50); updated CARNAGE_DEADLINE_SLOTS from 100 to 300
- `programs/epoch-program/src/errors.rs` -- Added CarnageLockActive error variant; updated CarnageSlippageExceeded message
- `programs/epoch-program/src/events.rs` -- Added CarnageFailed event struct (7 fields); updated CarnageExpired doc comment
- `programs/epoch-program/src/state/epoch_state.rs` -- Added carnage_lock_slot u64 field; LEN updated from 100 to 108; DATA_LEN updated from 92 to 100
- `programs/tax-program/src/state/epoch_state_reader.rs` -- Added carnage_lock_slot u64 field; LEN corrected from 101 to 108
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` -- Replaced 50% slippage with 85% floor using u128 BPS calculation
- `programs/epoch-program/src/instructions/consume_randomness.rs` -- Writes carnage_lock_slot on Carnage trigger; updated deadline test to expect 300
- `.planning/REQUIREMENTS.md` -- Marked FIX-05 complete (Phase 47)

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| 85% atomic slippage floor | 15% tolerance covers normal deviations while catching manipulation; primary MEV defense is atomicity + VRF unpredictability | 90% (too tight for AMM fee + rounding), 50% (too lenient, original value) |
| 50 slot lock window | ~20 seconds at 400ms/slot gives atomic TX ample time to confirm before fallback becomes callable | 25 slots (too aggressive), 100 slots (too conservative) |
| 300 slot deadline | ~2 minutes total window provides 0-50 atomic-only, 50-300 fallback-allowed, >300 expired | 100 slots (original, too short for recovery) |
| u128 intermediate arithmetic for BPS | Prevents overflow when multiplying u64 expected output by u64 BPS constant | f64 (imprecise), separate overflow checks (less readable) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tax Program mirror LEN was wrong (101 instead of 100)**

- **Found during:** Task 1
- **Issue:** epoch_state_reader.rs had `LEN: usize = 8 + 93` (=101) but actual data was 92 bytes (should have been 8+92=100). With the new field it should be 8+100=108. This was a pre-existing bug (FIX-05).
- **Fix:** Corrected LEN to `8 + 100` (=108) matching the new layout exactly
- **Files modified:** programs/tax-program/src/state/epoch_state_reader.rs
- **Commit:** a683ae7

## Verification Results

- `cargo check -p epoch-program` -- 0 errors, 20 pre-existing warnings
- `cargo check -p tax-program` -- 0 errors, 17 pre-existing warnings
- `cargo test -p epoch-program` -- 59 passed, 8 failed (pre-existing trigger_epoch_transition failures, tracked for Phase 51)
- `test_deadline_calculation` -- passes with expected value 1300
- CARNAGE_SLIPPAGE_BPS_ATOMIC found in constants.rs and execute_carnage_atomic.rs
- carnage_lock_slot found in epoch_state.rs, epoch_state_reader.rs, consume_randomness.rs
- CarnageFailed found in events.rs
- CarnageLockActive found in errors.rs

## Next Phase Readiness

Plan 02 (Fallback Carnage Path) can proceed immediately. It will:
- Use CARNAGE_SLIPPAGE_BPS_FALLBACK (7500) for its slippage floor
- Check CarnageLockActive error when lock window is still active
- Read carnage_lock_slot from EpochState to enforce the lock window
- Reference CarnageFailed event for expire_carnage emission

---
*Generated: 2026-02-19 | Plan execution: 47-01*
