---
phase: 16-extra-account-meta-list
plan: 01
subsystem: transfer-hook
tags: [token-2022, transfer-hook, extra-account-meta, spl-discriminator, anchor]

# Dependency graph
requires:
  - phase: 15-administrative-instructions
    provides: WhitelistAuthority state and authority management instructions
provides:
  - initialize_extra_account_meta_list instruction with SPL discriminator
  - ExtraAccountMetaList PDA creation with dynamic seed resolution
  - Token-2022 mint validation (ownership + hook extension)
  - ExtraAccountMetaListInitialized event
affects:
  - phase: 16-02 (if exists - testing)
  - phase: 17-execute-transfer-hook (transfer_hook instruction needs this initialized first)

# Tech tracking
tech-stack:
  added:
    - spl-discriminator = "0.4.1"
    - spl-token-2022 = "8.0.1"
    - spl-transfer-hook-interface = "0.10.0"
    - spl-tlv-account-resolution = "0.10.0"
  patterns:
    - "#[instruction(discriminator = ...)]" for SPL interface compatibility (Anchor 0.32.1)
    - ExtraAccountMeta::new_with_seeds for dynamic PDA resolution
    - Seed::AccountKey { index: N } for transfer instruction account references

key-files:
  created:
    - programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs
  modified:
    - programs/transfer-hook/Cargo.toml
    - programs/transfer-hook/src/errors.rs
    - programs/transfer-hook/src/events.rs
    - programs/transfer-hook/src/instructions/mod.rs
    - programs/transfer-hook/src/lib.rs

key-decisions:
  - "Use #[instruction(discriminator = ...)] instead of deprecated #[interface] macro for SPL discriminator"
  - "Validate mint is Token-2022 AND has transfer hook extension pointing to our program before creating ExtraAccountMetaList"
  - "Seed::AccountKey { index: 0 } for source whitelist, { index: 2 } for destination whitelist per SPL Transfer Hook spec"

patterns-established:
  - "#[instruction(discriminator = TYPE::SPL_DISCRIMINATOR_SLICE)]: Pattern for SPL interface-compatible instructions in Anchor 0.32.1"
  - "Mint validation pattern: Check owner == token_2022::ID, then check transfer_hook::get_program_id matches"
  - "ExtraAccountMeta seeds pattern: Seed::Literal for constant prefix, Seed::AccountKey for dynamic account references"

# Metrics
duration: 8min
completed: 2026-02-05
---

# Phase 16 Plan 01: initialize_extra_account_meta_list Summary

**ExtraAccountMetaList initialization instruction with SPL discriminator, dynamic PDA resolution seeds (source/destination whitelist), and Token-2022 mint validation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-05
- **Completed:** 2026-02-05
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created initialize_extra_account_meta_list instruction with SPL-compatible discriminator
- Configured ExtraAccountMetaList with Seed::AccountKey { index: 0 } for source whitelist PDA resolution
- Configured ExtraAccountMetaList with Seed::AccountKey { index: 2 } for destination whitelist PDA resolution
- Implemented Token-2022 mint validation (NotToken2022Mint and InvalidTransferHook errors)
- Added ExtraAccountMetaListInitialized event emission
- IDL generation verified with correct discriminator [43, 34, 13, 49, 167, 88, 235, 235]

## Task Commits

Each task was committed atomically:

1. **Task 1: Add dependencies, errors, and event** - `b09deb3` (feat)
2. **Task 2: Create instruction and wire into program** - `a873f4d` (feat)

## Files Created/Modified
- `programs/transfer-hook/Cargo.toml` - Added spl-discriminator, spl-token-2022, spl-transfer-hook-interface, spl-tlv-account-resolution dependencies
- `programs/transfer-hook/src/errors.rs` - Added InvalidTransferHook and NotToken2022Mint error variants
- `programs/transfer-hook/src/events.rs` - Added ExtraAccountMetaListInitialized event
- `programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs` - New instruction handler with accounts struct and mint validation
- `programs/transfer-hook/src/instructions/mod.rs` - Exported new instruction module
- `programs/transfer-hook/src/lib.rs` - Added instruction entry point with SPL discriminator

## Decisions Made

1. **Used `#[instruction(discriminator = ...)]` instead of `#[interface]` macro**
   - The `#[interface]` macro is not available in scope in Anchor 0.32.1
   - The `#[instruction(discriminator = TYPE::SPL_DISCRIMINATOR_SLICE)]` pattern achieves the same result
   - Verified discriminator in IDL matches expected SPL interface discriminator

2. **Added spl-token-2022 as explicit dependency**
   - Required for `StateWithExtensions` and `transfer_hook::get_program_id` APIs
   - Version 8.0.1 matches existing Cargo.lock transitive dependency

3. **Removed unused `BaseStateWithExtensions` import**
   - Originally included per research doc, but not needed for our validation pattern
   - `StateWithExtensions` alone is sufficient

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] #[interface] macro not in scope**
- **Found during:** Task 2 (instruction implementation)
- **Issue:** `#[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]` failed with "cannot find attribute `interface` in this scope"
- **Fix:** Used `#[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]` pattern instead
- **Files modified:** programs/transfer-hook/src/lib.rs, programs/transfer-hook/Cargo.toml (added spl-discriminator)
- **Verification:** `anchor build -p transfer_hook` succeeds, IDL has correct discriminator
- **Committed in:** a873f4d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The discriminator pattern change achieves identical functionality. The plan's `#[interface]` approach was based on research that predated full verification. No scope creep.

## Issues Encountered
- Plan referenced `#[interface]` macro which is not available in Anchor 0.32.1 - resolved by using `#[instruction(discriminator = ...)]` pattern which achieves the same result

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ExtraAccountMetaList initialization instruction complete and building
- Ready for Phase 16-02 testing or Phase 17 transfer_hook execute instruction
- Token-2022 can now resolve whitelist PDAs at transfer time once ExtraAccountMetaList is initialized for a mint

---
*Phase: 16-extra-account-meta-list*
*Completed: 2026-02-05*
