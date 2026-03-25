---
phase: 71-curve-foundation
plan: 01
subsystem: on-chain-program
tags: [anchor, rust, bonding-curve, token-2022, state-accounts, type-definitions]

# Dependency graph
requires:
  - phase: 70-specification-update
    provides: "Bonding_Curve_Spec.md with v1.2 state accounts, sell-back mechanics, and security model"
provides:
  - "Compiling bonding_curve Anchor program scaffold with all type definitions"
  - "CurveState struct (199 bytes) with serialization test"
  - "CurveStatus and Token enums matching spec exactly"
  - "All curve constants (P_START, P_END, TOTAL_FOR_SALE, etc.)"
  - "Feature-gated devnet/mainnet mint addresses"
  - "CurveError enum with 15 error variants for Phases 71-73"
  - "Stub instruction dispatch (initialize_curve, fund_curve, start_curve, purchase)"
  - "Empty math.rs and instructions/mod.rs for subsequent plans"
affects: [71-02-curve-math, 71-03-instructions, 71-04-purchase, 72-sell, 73-graduation]

# Tech tracking
tech-stack:
  added: ["bonding-curve crate (anchor-lang 0.32.1, anchor-spl 0.32.1 with token_2022)"]
  patterns: ["CurveState::LEN with serialization size test", "Feature-gated mint addresses (devnet/mainnet)"]

key-files:
  created:
    - programs/bonding_curve/Cargo.toml
    - programs/bonding_curve/src/lib.rs
    - programs/bonding_curve/src/constants.rs
    - programs/bonding_curve/src/state.rs
    - programs/bonding_curve/src/error.rs
    - programs/bonding_curve/src/math.rs
    - programs/bonding_curve/src/instructions/mod.rs
  modified: []

key-decisions:
  - "CurveState::LEN = 199 bytes (8 discriminator + 191 data) verified by Borsh serialization test"
  - "Feature-gated mints use cfg(not(any(devnet, localnet))) for mainnet fallback (matches conversion-vault pattern)"
  - "All 15 CurveError variants defined upfront for Phases 71-73 to avoid file modifications later"
  - "Placeholder program ID in declare_id! -- will be replaced after first anchor build"

patterns-established:
  - "CurveState size validation: Borsh serialize test asserting exact byte count"
  - "Stub instruction dispatch: empty account structs + Ok(()) handlers for incremental development"

# Metrics
duration: 8min
completed: 2026-03-03
---

# Phase 71 Plan 01: Program Scaffold Summary

**Anchor bonding curve program skeleton with 199-byte CurveState, spec-exact constants (P_START=900, P_END=3450, 460M tokens), 15 error variants, and feature-gated mint addresses**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-03T21:52:01Z
- **Completed:** 2026-03-03T22:00:00Z
- **Tasks:** 2
- **Files created:** 7

## Accomplishments

- Created compiling bonding_curve Anchor program with all module declarations
- CurveState struct serializes to exactly 191 bytes (199 with discriminator) -- confirmed by test
- All curve constants match Bonding_Curve_Spec.md Sections 3.2, 4.1, 6.1, 6.2, 7.1 exactly
- Feature-gated mint addresses compile under both default and --features devnet
- CurveError enum covers all error cases for Phases 71-73 (buy, sell, graduation, refund)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create program directory with Cargo.toml and lib.rs** - `623b1b4` (feat)
2. **Task 2: Create constants.rs, state.rs, and error.rs with spec-exact types** - `5cf8e68` (feat)

## Files Created

- `programs/bonding_curve/Cargo.toml` - Anchor 0.32.1 + Token-2022 dependencies, proptest/litesvm dev-deps, feature flags
- `programs/bonding_curve/src/lib.rs` - Program entrypoint with declare_id!, module declarations, stub instruction dispatch
- `programs/bonding_curve/src/constants.rs` - All curve constants, PDA seeds, feature-gated mint addresses
- `programs/bonding_curve/src/state.rs` - CurveState (199 bytes), CurveStatus, Token enums, is_refund_eligible(), size test
- `programs/bonding_curve/src/error.rs` - CurveError enum with 15 error variants for Phases 71-73
- `programs/bonding_curve/src/math.rs` - Empty module stub for Plan 02 (curve math)
- `programs/bonding_curve/src/instructions/mod.rs` - Empty module stub for Plans 03/04 (instruction handlers)

## Decisions Made

- **Feature gate pattern**: Used `cfg(not(any(feature = "devnet", feature = "localnet")))` for mainnet default, matching conversion-vault pattern but accounting for the localnet feature flag
- **All error variants defined upfront**: 15 variants covering Phases 71-73 to avoid modifying the error file in future plans (prevents merge conflicts and ensures stable error codes)
- **Placeholder program ID**: Using `BondCURVE1111111111111111111111111111111111` -- will be replaced after first `anchor build` generates the real keypair

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- All types, constants, and errors are in place for Plan 02 (curve math module)
- Plan 02 can immediately import from `crate::constants::*` and `crate::error::CurveError`
- Instruction handlers (Plans 03/04) can reference `CurveState`, `CurveStatus`, `Token` from `crate::state`
- No blockers or concerns

---
*Phase: 71-curve-foundation*
*Completed: 2026-03-03*
