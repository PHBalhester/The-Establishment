---
phase: 86-test-coverage-sweep
plan: 01
subsystem: testing
tags: [litesvm, bonding-curve, integration-test, dual-curve, anchor, token-2022]

requires:
  - phase: 74-protocol-integration
    provides: "refund_clock_test.rs LiteSVM patterns and bonding curve .so binary"
  - phase: 79-financial-safety
    provides: "partner_mint field in CurveState, VaultInsolvency guard in sell.rs"
provides:
  - "4 LiteSVM integration tests covering dual-curve edge cases (TEST-01..TEST-04)"
  - "Reusable setup_dual_curves() helper with partner_mint cross-linking"
  - "Updated CurveState serializer (232 bytes with partner_mint)"
affects: [86-02, 86-03, bonding-curve-tests]

tech-stack:
  added: []
  patterns:
    - "BcAdminConfig PDA injection for admin-gated instruction tests"
    - "partner_mint cross-linking in dual-curve test setup"
    - "svm.expire_blockhash() between sequential transactions to avoid AlreadyProcessed"

key-files:
  created:
    - "programs/bonding_curve/tests/dual_curve_test.rs"
  modified: []

key-decisions:
  - "Used --features devnet for cargo test (compile_error! on mainnet build without feature flag)"
  - "Updated CurveState serializer from 200 to 232 bytes to include partner_mint field added in Phase 79"
  - "Used svm.expire_blockhash() pattern from AMM tests to prevent duplicate TX signatures"

patterns-established:
  - "setup_dual_curves(): reusable helper that creates paired CRIME/FRAUD curves with partner_mint cross-references, SOL vaults, and tax escrows"
  - "inject_admin_config(): BcAdminConfig PDA serialization for testing admin-gated instructions"

requirements-completed: [TEST-01, TEST-02, TEST-03, TEST-04]

duration: 6min
completed: 2026-03-08
---

# Phase 86 Plan 01: Dual-Curve LiteSVM Integration Tests Summary

**4 LiteSVM integration tests covering dual-curve bonding curve edge cases: one-sided fill rejection, grace period purchase blocking, multi-claimant refund lifecycle, and vault insolvency guard**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-08T17:41:29Z
- **Completed:** 2026-03-08T17:47:26Z
- **Tasks:** 1
- **Files created:** 1 (1585 lines)

## Accomplishments
- TEST-01: prepare_transition correctly rejects when only CRIME is Filled (FRAUDCurveNotFilled) and vice versa (CRIMECurveNotFilled)
- TEST-02: Purchase during grace period (past deadline) returns DeadlinePassed, including at deadline_slot+1 boundary
- TEST-03: Full multi-user refund lifecycle -- 3 users buy, mark_failed, consolidate_for_refund, each claims proportional SOL, double-claim fails with NothingToBurn
- TEST-04: VaultInsolvency guard fires when SOL vault is artificially drained below sell coverage
- Reusable setup_dual_curves() helper with CurveConfig for flexible pre-filling

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dual-curve LiteSVM integration tests** - `48cd448` (test)

## Files Created/Modified
- `programs/bonding_curve/tests/dual_curve_test.rs` - 4 LiteSVM integration tests with shared dual-curve setup helper, BcAdminConfig injection, Token-2022 mint/ATA creation

## Decisions Made
- Updated CurveState serializer to 232 bytes (was 200 in refund_clock_test.rs, missing partner_mint added in Phase 79)
- Used `svm.expire_blockhash()` between sequential transactions to prevent AlreadyProcessed errors (same pattern as AMM tests)
- Used `--features devnet` for cargo test since bonding_curve has compile_error! guards on mainnet build without feature flags

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CurveState serializer missing partner_mint field**
- **Found during:** Task 1 (initial design review)
- **Issue:** Existing refund_clock_test.rs serialize_curve_state() produces 200 bytes but CurveState is 232 bytes (partner_mint added in Phase 79). New tests using partner_curve_state validation would fail.
- **Fix:** Created updated serialize_curve_state() with partner_mint parameter (232 bytes)
- **Files modified:** programs/bonding_curve/tests/dual_curve_test.rs (new file)
- **Verification:** All 4 tests pass, partner_mint cross-linking works correctly
- **Committed in:** 48cd448

**2. [Rule 1 - Bug] AlreadyProcessed error on sequential same-account transactions**
- **Found during:** Task 1 (test_multiple_refund_claimants_lifecycle)
- **Issue:** Double-claim attempt reused same blockhash, producing identical TX signature as first claim (same accounts + data = same hash)
- **Fix:** Added svm.expire_blockhash() between sequential transactions
- **Files modified:** programs/bonding_curve/tests/dual_curve_test.rs
- **Verification:** All 4 tests pass, double-claim correctly returns NothingToBurn
- **Committed in:** 48cd448

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes essential for correct test execution. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dual-curve test patterns established for remaining Phase 86 plans
- setup_dual_curves() and BcAdminConfig injection available for reuse
- Note: existing refund_clock_test.rs still uses old 200-byte serializer (works because those tests don't validate partner_mint)

---
*Phase: 86-test-coverage-sweep*
*Completed: 2026-03-08*
