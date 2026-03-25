---
phase: 22-epochstate-core-tax-integration
plan: 02
subsystem: cross-program
tags: [anchor, pda, cross-program-read, epoch-state, carnage-signer]

# Dependency graph
requires:
  - phase: 21-amm-access-control-verification
    provides: "Tax Program structure with swap_exempt instruction"
provides:
  - "EpochState reader struct for cross-program deserialization"
  - "get_tax_bps() helper for tax rate lookup"
  - "EPOCH_STATE_SEED constant and get_epoch_state_pda() helper"
  - "get_carnage_signer_pda() helper for Carnage validation"
  - "carnage_signer PDA validation tests"
affects: [23-vrf-integration, 24-epoch-instructions, 25-carnage-execution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-program struct mirroring for AccountDeserialize"
    - "seeds::program constraint for cross-program PDA validation"

key-files:
  created:
    - "programs/tax-program/src/state/epoch_state_reader.rs"
    - "programs/tax-program/src/state/mod.rs"
    - "programs/tax-program/tests/test_carnage_signer_pda.rs"
  modified:
    - "programs/tax-program/src/lib.rs"
    - "programs/tax-program/src/constants.rs"
    - "programs/tax-program/src/instructions/swap_exempt.rs"

key-decisions:
  - "EpochState struct name must match exactly for Anchor discriminator compatibility"
  - "Field order matches Epoch_State_Machine_Spec.md Section 4.1 for Borsh deserialization"
  - "Placeholder epoch_program_id() requires update post-deploy (deployment checklist documented)"

patterns-established:
  - "Cross-program read: Mirror struct with identical name and field order"
  - "Cross-program PDA validation: seeds::program = foreign_program_id()"
  - "PDA helper functions: get_X_pda() returns (Pubkey, u8)"

# Metrics
duration: 12min
completed: 2026-02-06
---

# Phase 22 Plan 02: Tax Program EpochState Reader Summary

**Read-only EpochState mirror for cross-program deserialization with get_tax_bps() helper and verified carnage_signer PDA validation via seeds::program constraint**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-06T16:04:26Z
- **Completed:** 2026-02-06T16:16:26Z
- **Tasks:** 3/3
- **Files modified:** 6

## Accomplishments

- Created state module with EpochState reader struct matching Epoch Program layout exactly (101 bytes)
- Implemented get_tax_bps() helper for 4-way tax rate lookup (token x direction)
- Added EPOCH_STATE_SEED constant and get_epoch_state_pda() / get_carnage_signer_pda() helpers
- Enhanced swap_exempt.rs with CROSS-PROGRAM DEPENDENCY documentation
- Created 4 unit tests validating carnage_signer PDA derivation compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Create EpochState Reader Module** - `81467a7` (feat)
2. **Task 2: Update Constants with Epoch Program Helpers** - `712223c` (feat)
3. **Task 3: Verify and Test carnage_signer PDA Validation** - `11557f4` (test)

## Files Created/Modified

- `programs/tax-program/src/state/epoch_state_reader.rs` - Read-only EpochState mirror with get_tax_bps()
- `programs/tax-program/src/state/mod.rs` - Module exports
- `programs/tax-program/src/lib.rs` - Added `pub mod state;` export
- `programs/tax-program/src/constants.rs` - Added EPOCH_STATE_SEED, get_epoch_state_pda(), get_carnage_signer_pda()
- `programs/tax-program/src/instructions/swap_exempt.rs` - Enhanced carnage_authority documentation
- `programs/tax-program/tests/test_carnage_signer_pda.rs` - 4 unit tests for PDA validation

## Decisions Made

1. **Struct name "EpochState" preserved exactly** - Anchor discriminator is sha256("account:EpochState")[0..8], changing name would break deserialization
2. **Field types use u8 for enums** - carnage_target/carnage_action are u8 (not Token/CarnageAction enums) for simpler cross-program compatibility
3. **LEN constant = 101 bytes** - Matches Epoch_State_Machine_Spec.md Section 4.1 exactly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- EpochState reader ready for Tax Program to read dynamic tax rates from Epoch Program
- carnage_signer PDA validation confirmed working via seeds::program constraint
- Deployment checklist documented in epoch_program_id() for post-deploy program ID update
- Ready for Phase 23 (VRF Integration) which will use EpochState for randomness handling

---
*Phase: 22-epochstate-core-tax-integration*
*Plan: 02*
*Completed: 2026-02-06*
