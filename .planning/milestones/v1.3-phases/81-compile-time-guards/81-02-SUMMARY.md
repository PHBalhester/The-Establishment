---
phase: 81-compile-time-guards
plan: 02
subsystem: programs
tags: [rust, const-assert, compile-time, bonding-curve, epoch, idl, devnet-guard]

# Dependency graph
requires:
  - phase: 70-bonding-curve-scaffold
    provides: bonding curve constants (P_START, P_END, TOTAL_FOR_SALE, TARGET_TOKENS)
  - phase: 25-epoch-vrf
    provides: epoch program with cfg-gated force_carnage instruction
provides:
  - Compile-time validation of bonding curve math invariants
  - IDL regression test for force_carnage devnet exclusion
affects: [mainnet-deploy, bonding-curve-constants]

# Tech tracking
tech-stack:
  added: []
  patterns: ["const _: () = assert!() for zero-cost compile-time validation"]

key-files:
  created: []
  modified:
    - programs/bonding_curve/src/constants.rs
    - programs/epoch-program/src/lib.rs

key-decisions:
  - "Round-trip cast (u128->u64->u128 == original) validates no truncation, more robust than comparing TARGET_TOKENS directly"
  - "IDL test gracefully skips if IDL file not yet generated (anchor build not run)"

patterns-established:
  - "const _: () = assert!(): zero-cost compile-time invariant validation for Rust constants"

# Metrics
duration: 4min
completed: 2026-03-08
---

# Phase 81 Plan 02: Compile-Time Guards Summary

**Const assertions for bonding curve parameters (P_END > P_START, non-zero supply, u128/u64 truncation) and IDL regression test proving force_carnage excluded from non-devnet builds**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T11:08:41Z
- **Completed:** 2026-03-08T11:12:41Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Three compile-time const assertions in bonding_curve/constants.rs catch invalid curve parameters at build time (not runtime)
- IDL verification test in epoch-program confirms force_carnage instruction is excluded from non-devnet builds
- All verifications pass: devnet build, localnet build, and force_carnage exclusion test

## Task Commits

Each task was committed atomically:

1. **Task 1: Bonding curve const assertions + force_carnage IDL test** - `e1d166f` (feat)

## Files Created/Modified
- `programs/bonding_curve/src/constants.rs` - Added three const assertions: P_END > P_START, TOTAL_FOR_SALE > 0, round-trip truncation check
- `programs/epoch-program/src/lib.rs` - Added #[cfg(test)] module with IDL verification test for force_carnage exclusion

## Decisions Made
- Used round-trip cast (TOTAL_FOR_SALE as u64 as u128 == TOTAL_FOR_SALE) instead of comparing TARGET_TOKENS directly -- validates the cast itself is lossless
- IDL test reads target/idl/epoch_program.json and gracefully skips if file doesn't exist (not built yet)
- Checks both camelCase (forceCarnage) and snake_case (force_carnage) in IDL content for completeness

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both CTG-02 and CTG-03 requirements satisfied
- Ready for remaining Phase 81 plans (if any) or Phase 82

---
*Phase: 81-compile-time-guards*
*Completed: 2026-03-08*
