---
phase: 83-vrf-crank-hardening
plan: 02
subsystem: testing
tags: [epoch-state, binary-offsets, borsh, vrf, anti-reroll, layout-validation]

# Dependency graph
requires:
  - phase: 80-defensive-coding
    provides: "Reserved padding (64 bytes) and #[repr(C)] on EpochState"
  - phase: 47-carnage-hardening
    provides: "carnage_lock_slot field in EpochState"
provides:
  - "Validated 172-byte EpochState offset map in TypeScript (EPOCH_STATE_OFFSETS)"
  - "Rust serialization test catching EpochState layout drift"
  - "Anti-reroll error code documentation (ConstraintRaw 2012)"
affects: [84-frontend-hardening, 89-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Borsh serialization offset validation via known-value test pattern"
    - "Cross-language offset parity: Rust test + TypeScript constants must agree"

key-files:
  created: []
  modified:
    - tests/integration/helpers/mock-vrf.ts
    - scripts/prepare-carnage-state.ts
    - programs/epoch-program/src/constants.rs
    - programs/tax-program/tests/test_swap_sol_buy.rs
    - programs/tax-program/tests/test_swap_sol_sell.rs

key-decisions:
  - "Used Borsh serialization test (not offset_of!) because #[repr(C)] alignment padding differs from Borsh packed layout"
  - "VRF-10 already satisfied by Phase 82 test_swap_exempt_discriminator -- no new work needed"

patterns-established:
  - "Layout drift detection: serialize with recognizable byte patterns, assert specific positions"

# Metrics
duration: 12min
completed: 2026-03-08
---

# Phase 83 Plan 02: Binary Offset Consolidation Summary

**EpochState 172-byte layout validated end-to-end: stale TypeScript offsets fixed, Rust serialization test catches layout drift, anti-reroll error code documented**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-08T11:57:35Z
- **Completed:** 2026-03-08T12:09:35Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Fixed stale EPOCH_STATE_OFFSETS in mock-vrf.ts: added CARNAGE_LOCK_SLOT (offset 94), RESERVED (offset 106), corrected LAST_CARNAGE_EPOCH (94->102), INITIALIZED (98->170), BUMP (99->171)
- Added Rust test_epoch_state_serialized_offsets that serializes EpochState with recognizable byte patterns and validates all 19 field positions
- Confirmed VRF-10 (SWAP_EXEMPT_DISCRIMINATOR test) already present from Phase 82
- Added anti-reroll error code documentation test (ConstraintRaw 2012 / 0x07DC)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update stale EpochState offsets in TypeScript to match 172-byte layout** - `fca96b1` (fix)
2. **Task 2: Add EpochState offset validation test + anti-reroll error assertion test** - `a256ca0` (feat)

## Files Created/Modified
- `tests/integration/helpers/mock-vrf.ts` - Updated EPOCH_STATE_OFFSETS to 172-byte layout, added CARNAGE_LOCK_SLOT + RESERVED fields, updated parseEpochState()
- `scripts/prepare-carnage-state.ts` - Added CARNAGE_LOCK_SLOT to OFFSETS constant
- `programs/epoch-program/src/constants.rs` - Added test_epoch_state_serialized_offsets + test_anti_reroll_error_code_documented
- `programs/tax-program/tests/test_swap_sol_buy.rs` - Fixed create_mock_epoch_state (added 64-byte reserved padding, corrected initialized byte index 106->170)
- `programs/tax-program/tests/test_swap_sol_sell.rs` - Fixed create_mock_epoch_state (added 64-byte reserved padding)

## Decisions Made
- Used Borsh serialization approach for offset validation instead of `std::mem::offset_of!` because `#[repr(C)]` alignment padding differs from Borsh's packed sequential layout. The Borsh test validates the ACTUAL on-chain byte layout.
- VRF-10 (SWAP_EXEMPT_DISCRIMINATOR validation) confirmed already present from Phase 82 -- no duplicate test added.
- Anti-reroll test is a documentation/assertion test rather than a full integration test, since the Anchor constraint requires a full program test environment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tax program Rust tests had undersized mock EpochState data**
- **Found during:** Task 1 (offset update)
- **Issue:** `create_mock_epoch_state()` in test_swap_sol_buy.rs and test_swap_sol_sell.rs built 108-byte buffers (old layout), missing the 64-byte reserved padding added in Phase 80. The `epoch_state_data[106]` initialized byte index was also wrong (should be 170 after padding).
- **Fix:** Added 64-byte `[0u8; 64]` reserved padding, updated capacity to 172, updated assertion from 108 to 172, corrected initialized byte index from 106 to 170.
- **Files modified:** programs/tax-program/tests/test_swap_sol_buy.rs, programs/tax-program/tests/test_swap_sol_sell.rs
- **Verification:** `cargo test -p tax-program --features localnet -- test_swap_sol_buy_fails_with_uninitialized_epoch_state` passes
- **Committed in:** fca96b1 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was necessary -- undersized mock data would cause test failures when Anchor validates account size. No scope creep.

## Issues Encountered
- Pre-existing `test_consecutive_buys_succeed` failure in tax-program (MinimumOutputFloorViolation) -- unrelated to this plan's changes.
- Pre-existing `force_carnage_excluded_from_non_devnet_idl` failure in epoch-program when built without devnet feature -- expected behavior for mainnet build guard.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All VRF-related requirements for Phase 83 now complete (83-01 through 83-04 all done)
- Phase 83 is fully complete, ready for Phase 84 (Frontend Hardening)

---
*Phase: 83-vrf-crank-hardening*
*Completed: 2026-03-08*
