---
phase: 79-financial-safety
plan: 02
subsystem: on-chain
tags: [bonding-curve, defense-in-depth, partial-fill, partner-identity, anchor, rust]

# Dependency graph
requires:
  - phase: 70-77 (v1.2 Bonding Curves)
    provides: bonding curve program with purchase, sell, claim_refund, consolidate_for_refund
  - phase: 78 (Authority Hardening)
    provides: BcAdminConfig PDA pattern
provides:
  - Partial fill overcharge assertion in purchase.rs (FIN-04)
  - Pre-transfer vault solvency guard in sell.rs (FIN-04)
  - CurveState.partner_mint field for cryptographic partner curve identity binding (FIN-05)
  - Partner curve identity validation in claim_refund and consolidate_for_refund (FIN-05)
affects: [deployment scripts (initialize_curve now takes partner_mint), IDL regeneration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defense-in-depth: pre-transfer guards alongside post-state assertions"
    - "Cryptographic identity binding via stored mint pubkey cross-reference"

key-files:
  created: []
  modified:
    - programs/bonding_curve/src/state.rs
    - programs/bonding_curve/src/error.rs
    - programs/bonding_curve/src/instructions/initialize_curve.rs
    - programs/bonding_curve/src/instructions/purchase.rs
    - programs/bonding_curve/src/instructions/sell.rs
    - programs/bonding_curve/src/instructions/claim_refund.rs
    - programs/bonding_curve/src/instructions/consolidate_for_refund.rs
    - programs/bonding_curve/src/lib.rs
    - programs/bonding_curve/src/math.rs

key-decisions:
  - "partner_mint stored as raw Pubkey (32 bytes) rather than PDA derivation to avoid extra compute"
  - "Pre-transfer vault solvency in sell.rs uses existing VaultInsolvency error (same invariant class)"

patterns-established:
  - "Belt-and-suspenders: pre-transfer guard (step 7b) + post-state assertion (step 16) for vault solvency"

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 79 Plan 02: Bonding Curve Financial Safety Summary

**Partial fill overcharge assertion + cryptographic partner curve identity binding via partner_mint field**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T10:32:54Z
- **Completed:** 2026-03-08T10:37:39Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- FIN-04: Added `require!(actual_sol <= sol_amount, PartialFillOvercharge)` in purchase.rs after partial fill recalculation
- FIN-04: Added pre-transfer vault solvency guard in sell.rs checking sol_gross against available vault balance
- FIN-05: Added `partner_mint: Pubkey` field to CurveState (LEN 200 -> 232 bytes)
- FIN-05: initialize_curve now accepts and stores partner_mint parameter
- FIN-05: claim_refund and consolidate_for_refund validate partner curve identity via `partner_curve_state.token_mint == curve.partner_mint`

## Task Commits

Each task was committed atomically:

1. **Task 1: CurveState schema change and error variants** - `467b539` (feat)
2. **Task 2: Partial fill assertion and partner curve validation** - `f6b713a` (feat)

## Files Created/Modified
- `programs/bonding_curve/src/state.rs` - Added partner_mint field (32 bytes), updated LEN to 232, updated tests
- `programs/bonding_curve/src/error.rs` - Added PartialFillOvercharge and InvalidPartnerCurve error variants
- `programs/bonding_curve/src/instructions/initialize_curve.rs` - Accepts and stores partner_mint parameter
- `programs/bonding_curve/src/instructions/purchase.rs` - Partial fill overcharge assertion (step 7b)
- `programs/bonding_curve/src/instructions/sell.rs` - Pre-transfer vault solvency guard (step 7b)
- `programs/bonding_curve/src/instructions/claim_refund.rs` - Partner curve identity validation (step 1b)
- `programs/bonding_curve/src/instructions/consolidate_for_refund.rs` - Partner curve identity validation (step 1b)
- `programs/bonding_curve/src/lib.rs` - Updated initialize_curve signature with partner_mint parameter
- `programs/bonding_curve/src/math.rs` - Updated test helpers with partner_mint field

## Decisions Made
- Used existing `VaultInsolvency` error for sell.rs pre-transfer guard (same invariant class as post-state check)
- partner_mint stored as raw Pubkey rather than PDA derivation (simpler, cheaper compute, admin sets at init)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added partner_mint to math.rs test helpers**
- **Found during:** Task 1 (CurveState schema change)
- **Issue:** Two CurveState constructors in math.rs tests missing new partner_mint field
- **Fix:** Added `partner_mint: Pubkey::default()` to both test helpers
- **Files modified:** programs/bonding_curve/src/math.rs
- **Verification:** All 51 passing tests continue to pass
- **Committed in:** 467b539 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for compilation. No scope creep.

## Issues Encountered
- Two pre-existing proptest failures (vault_solvency_mixed_buy_sell, multi_user_solvency) tracked as TEST-07. Unrelated to our changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bonding curve program now has defense-in-depth for partial fill overcharging and partner curve identity spoofing
- Deployment scripts (initialize.ts) will need updating to pass partner_mint when calling initialize_curve (covered by deployment phase)
- IDL will need regeneration after anchor build to reflect new parameter

---
*Phase: 79-financial-safety*
*Completed: 2026-03-08*
