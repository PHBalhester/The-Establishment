---
phase: 81-compile-time-guards
plan: 01
subsystem: infra
tags: [rust, cfg, compile-error, feature-gating, mainnet-safety]

requires:
  - phase: 80-defense-in-depth
    provides: "3-tier feature gating pattern established in bonding_curve"
provides:
  - "compile_error!() guards on all 7 mainnet placeholder pubkey functions"
  - "localnet feature flag in Tax Program Cargo.toml"
  - "3-tier feature gating (devnet/localnet/mainnet) across Tax, Vault, and BC"
affects: [mainnet-deployment, build-pipeline]

tech-stack:
  added: []
  patterns: ["compile_error!() macro for mainnet address guards", "3-tier cfg feature gating (devnet/localnet/compile_error)"]

key-files:
  created: []
  modified:
    - programs/tax-program/Cargo.toml
    - programs/tax-program/src/constants.rs
    - programs/conversion-vault/src/constants.rs
    - programs/bonding_curve/src/constants.rs

key-decisions:
  - "compile_error!() inside function body (not module-level) -- preserves function signature for IDE/tooling while preventing compilation"

patterns-established:
  - "3-tier feature gating: devnet (real addresses), localnet (Pubkey::default), mainnet (compile_error)"

duration: 5min
completed: 2026-03-08
---

# Phase 81 Plan 01: Compile-Time Guards Summary

**compile_error!() guards on 7 mainnet placeholder pubkey functions across Tax Program (1), Conversion Vault (3), and Bonding Curve (3) -- mainnet builds without real addresses now fail at compile time**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T11:08:38Z
- **Completed:** 2026-03-08T11:13:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Tax Program: Added `localnet` feature flag and replaced 2-tier treasury_pubkey() with 3-tier compile_error guard
- Conversion Vault: Replaced 2-tier crime_mint/fraud_mint/profit_mint with 3-tier compile_error guards
- Bonding Curve: Replaced Pubkey::default() with compile_error!() on all 3 mainnet placeholder functions (crime_mint, fraud_mint, epoch_program_id)
- All devnet builds verified passing; all mainnet builds verified failing with descriptive error messages

## Task Commits

Each task was committed atomically:

1. **Task 1: Align Tax Program and Conversion Vault to 3-tier feature gating** - `53b277a` (feat)
2. **Task 2: Add compile_error!() to Bonding Curve mainnet paths** - `cc9b38d` (feat)

## Files Created/Modified
- `programs/tax-program/Cargo.toml` - Added localnet feature flag
- `programs/tax-program/src/constants.rs` - 3-tier treasury_pubkey() with compile_error on mainnet
- `programs/conversion-vault/src/constants.rs` - 3-tier crime_mint/fraud_mint/profit_mint with compile_error on mainnet
- `programs/bonding_curve/src/constants.rs` - compile_error on crime_mint/fraud_mint/epoch_program_id mainnet paths

## Decisions Made
None - followed plan as specified.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 7 mainnet placeholder pubkey functions now have compile-time guards
- Ready for remaining phase 81 plans or next phase
- Mainnet deployment pipeline will require setting real addresses before build

---
*Phase: 81-compile-time-guards*
*Completed: 2026-03-08*
