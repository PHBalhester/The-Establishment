---
phase: 73-graduation-refund
plan: 01
subsystem: on-chain
tags: [anchor, rust, bonding-curve, state-machine, graduation, failure, escrow, carnage]

# Dependency graph
requires:
  - phase: 71-curve-foundation
    provides: "CurveState struct, error variants, constants, events, math module"
  - phase: 72-sell-back-tax-escrow
    provides: "Sell instruction, tax escrow PDA, lamport manipulation patterns"
provides:
  - "CurveState with escrow_consolidated bool (LEN=200)"
  - "8 Phase 73 error variants (DeadlineNotPassed, CurveNotGraduated, etc.)"
  - "FAILURE_GRACE_SLOTS constant (150 slots)"
  - "epoch_program_id() feature-gated function"
  - "CARNAGE_SOL_VAULT_SEED constant"
  - "mark_failed instruction (Active -> Failed)"
  - "prepare_transition instruction (both Filled -> Graduated)"
  - "distribute_tax_escrow instruction (escrow SOL -> carnage fund)"
affects:
  - 73-graduation-refund (plan 02: consolidate_for_refund, claim_refund)
  - 73-graduation-refund (plan 03: property tests)
  - 74-graduation-orchestration (vault withdrawals, finalize_transition)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Permissionless state transition with slot-based grace buffer"
    - "Feature-gated epoch_program_id() for cross-program PDA validation"
    - "Direct lamport manipulation for cross-program crediting (epoch-owned PDA)"

key-files:
  created:
    - "programs/bonding_curve/src/instructions/mark_failed.rs"
    - "programs/bonding_curve/src/instructions/prepare_transition.rs"
    - "programs/bonding_curve/src/instructions/distribute_tax_escrow.rs"
  modified:
    - "programs/bonding_curve/src/state.rs"
    - "programs/bonding_curve/src/error.rs"
    - "programs/bonding_curve/src/constants.rs"
    - "programs/bonding_curve/src/instructions/mod.rs"
    - "programs/bonding_curve/src/instructions/initialize_curve.rs"
    - "programs/bonding_curve/src/lib.rs"

key-decisions:
  - "epoch_program_id() feature-gated with devnet/localnet/mainnet variants (matches crime_mint/fraud_mint pattern)"
  - "localnet variant added for epoch_program_id() to prevent compilation failure when localnet feature is active"
  - "No status constraint in MarkFailed derive -- handler checks explicitly for specific error messages"

patterns-established:
  - "Permissionless slot-based transition: require clock.slot > deadline + grace (strictly greater)"
  - "Cross-program lamport credit: subtract from program-owned PDA, add to any account"
  - "PDA validation via find_program_address against feature-gated program ID"

# Metrics
duration: 7min
completed: 2026-03-04
---

# Phase 73 Plan 01: State Machine + Escrow Distribution Summary

**Graduation/failure state machine with 3 instructions: mark_failed (permissionless Active->Failed with 150-slot grace), prepare_transition (admin-only both Filled->Graduated), distribute_tax_escrow (escrow SOL -> carnage fund)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-04T20:06:15Z
- **Completed:** 2026-03-04T20:13:25Z
- **Tasks:** 2/2
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments
- CurveState extended with `escrow_consolidated: bool` field (LEN 199 -> 200), all 3 state tests updated and passing
- 8 new error variants for Phase 73 graduation/refund path
- 3 new instructions fully wired: mark_failed, prepare_transition, distribute_tax_escrow
- `anchor build -p bonding_curve` succeeds, 36/37 tests pass (1 pre-existing proptest regression)

## Task Commits

Each task was committed atomically:

1. **Task 1: Foundation state changes (CurveState, errors, constants)** - `7d86379` (feat)
2. **Task 2: Implement mark_failed, prepare_transition, distribute_tax_escrow** - `9dc08b5` (feat)

## Files Created/Modified

### Created
- `programs/bonding_curve/src/instructions/mark_failed.rs` - Permissionless failure trigger with 150-slot grace buffer after deadline
- `programs/bonding_curve/src/instructions/prepare_transition.rs` - Admin-only graduation for both CRIME and FRAUD curves simultaneously
- `programs/bonding_curve/src/instructions/distribute_tax_escrow.rs` - Route tax escrow SOL to carnage fund (cross-program lamport credit)

### Modified
- `programs/bonding_curve/src/state.rs` - Added `escrow_consolidated: bool`, updated LEN to 200, updated 3 tests
- `programs/bonding_curve/src/error.rs` - Added 8 Phase 73 error variants
- `programs/bonding_curve/src/constants.rs` - Added FAILURE_GRACE_SLOTS, epoch_program_id(), CARNAGE_SOL_VAULT_SEED
- `programs/bonding_curve/src/instructions/initialize_curve.rs` - Set `escrow_consolidated = false` on init
- `programs/bonding_curve/src/instructions/mod.rs` - 8 modules (3 new), updated header comments
- `programs/bonding_curve/src/lib.rs` - 8 instruction dispatches (3 new)

## Decisions Made

1. **epoch_program_id() uses 3-variant feature gating** (devnet/localnet/mainnet) -- matching crime_mint/fraud_mint pattern but with localnet variant added to prevent compilation failure when localnet feature is active (localnet returns Pubkey::default for testing flexibility)
2. **No status constraint in MarkFailed derive macro** -- handler checks status explicitly to return specific error (InvalidStatus if not Active, DeadlineNotPassed if too early) rather than a generic ConstraintViolation
3. **distribute_tax_escrow curve_state is read-only** -- no state mutations needed; only reads status and tax_escrow pubkey for validation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added localnet variant for epoch_program_id()**
- **Found during:** Task 1 (constants.rs changes)
- **Issue:** Plan specified only devnet and mainnet variants for epoch_program_id(). Without a localnet variant, the function would be missing when the localnet feature is active, causing compilation failure for any instruction that references it.
- **Fix:** Added `#[cfg(feature = "localnet")]` variant returning `Pubkey::default()`, matching the implicit pattern of crime_mint/fraud_mint which also have no localnet variant but are guarded by `cfg!(feature = "localnet")` at the call site.
- **Files modified:** programs/bonding_curve/src/constants.rs
- **Verification:** `anchor build -p bonding_curve` succeeds
- **Committed in:** 7d86379 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for correctness. Without localnet variant, localnet builds would fail. No scope creep.

## Issues Encountered

- Pre-existing proptest regression: `vault_solvency_mixed_buy_sell` fails with 1-lamport rounding edge case at specific random seed. Not related to Phase 73 changes. 36/37 tests pass; the failing test is a known issue from Phase 72.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- State machine foundation complete: curves can transition to Failed (via mark_failed) and Graduated (via prepare_transition)
- Tax escrow SOL can be distributed to carnage fund on graduation
- Ready for Plan 02: consolidate_for_refund and claim_refund instructions (the refund path)
- The `escrow_consolidated` flag is in place for consolidate_for_refund to set
- All error variants needed by Plan 02 (EscrowNotConsolidated, NotRefundEligible, NothingToBurn, NoTokensOutstanding) already exist

---
*Phase: 73-graduation-refund*
*Completed: 2026-03-04*
