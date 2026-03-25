---
phase: 80-defense-in-depth
plan: 03
subsystem: on-chain
tags: [epoch-state, padding, repr-c, transfer-hook, bonding-curve, defense-in-depth]

requires:
  - phase: 47
    provides: "EpochState with carnage_lock_slot, HOOK_ACCOUNTS_PER_MINT=4"
  - phase: 70-77
    provides: "Bonding curve purchase/sell with Transfer Hook CPI"
provides:
  - "EpochState with 64-byte reserved padding for future schema evolution"
  - "Compile-time DATA_LEN assertions ensuring epoch-program and tax-program mirror stay in sync"
  - "Bonding curve remaining_accounts count validation (InvalidHookAccounts error)"
affects: [v1.4-deploy, epoch-program, tax-program, bonding-curve]

tech-stack:
  added: []
  patterns:
    - "#[repr(C)] on cross-program mirrored structs for layout stability"
    - "Compile-time const assertions for struct size parity"
    - "remaining_accounts.len() == N guard before Transfer Hook CPI"

key-files:
  created: []
  modified:
    - programs/epoch-program/src/state/epoch_state.rs
    - programs/epoch-program/src/instructions/initialize_epoch_state.rs
    - programs/tax-program/src/state/epoch_state_reader.rs
    - programs/bonding_curve/src/instructions/purchase.rs
    - programs/bonding_curve/src/instructions/sell.rs
    - programs/bonding_curve/src/error.rs

key-decisions:
  - "reserved field placed BEFORE initialized/bump to maintain their position as last fields"
  - "#[repr(C)] used for documentation intent even though Borsh serialization is packed (no alignment padding on disk)"

patterns-established:
  - "Cross-program struct mirrors: both must have #[repr(C)] + matching compile-time DATA_LEN assertion"
  - "Transfer Hook CPI: always validate remaining_accounts count before invoke"

requirements-completed: [DEF-03, DEF-05, DEF-08]

duration: 5min
completed: 2026-03-08
---

# Phase 80 Plan 03: EpochState Padding & Hook Account Validation Summary

**64-byte reserved padding on EpochState with compile-time layout assertions, plus bonding curve remaining_accounts count validation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T10:56:11Z
- **Completed:** 2026-03-08T11:01:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- EpochState now has 64-byte reserved padding for future schema evolution without account migration
- Both EpochState (epoch-program) and its Tax Program mirror have #[repr(C)] and compile-time DATA_LEN == 164 assertions
- Bonding curve purchase and sell instructions reject remaining_accounts count != 4 with InvalidHookAccounts error

## Task Commits

Each task was committed atomically:

1. **Task 1: EpochState reserved padding and layout stability** - `5344657` (feat)
2. **Task 2: Bonding Curve remaining_accounts count validation** - `2a5d9d1` (feat)

## Files Created/Modified
- `programs/epoch-program/src/state/epoch_state.rs` - Added reserved: [u8; 64], #[repr(C)], updated DATA_LEN to 164
- `programs/epoch-program/src/instructions/initialize_epoch_state.rs` - Initialize reserved to [0u8; 64]
- `programs/tax-program/src/state/epoch_state_reader.rs` - Mirror struct with matching reserved, #[repr(C)], DATA_LEN assertion
- `programs/bonding_curve/src/instructions/purchase.rs` - remaining_accounts.len() == 4 check before Transfer Hook CPI
- `programs/bonding_curve/src/instructions/sell.rs` - remaining_accounts.len() == 4 check before Transfer Hook CPI
- `programs/bonding_curve/src/error.rs` - Added InvalidHookAccounts error variant

## Decisions Made
- Reserved field placed before initialized/bump to maintain their position as the last two fields in the struct
- #[repr(C)] used for layout stability intent; Borsh serialization remains packed (no alignment padding on disk), so DATA_LEN is the sum of raw field sizes
- Used literal `4` for remaining_accounts check (matches HOOK_ACCOUNTS_PER_MINT constant established in Phase 47)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Note: devnet redeploy required for EpochState size change (v1.4 does fresh deploy).

## Next Phase Readiness
- All three programs compile cleanly
- Compile-time assertions will catch any future layout drift between epoch-program and tax-program
- Bonding curve now rejects malformed Transfer Hook invocations

---
*Phase: 80-defense-in-depth*
*Completed: 2026-03-08*
