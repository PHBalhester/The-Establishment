---
phase: 73-graduation-refund
plan: 03
subsystem: testing
tags: [rust, proptest, bonding-curve, refund-math, property-testing, floor-rounding]

# Dependency graph
requires:
  - phase: 73-graduation-refund (plan 02)
    provides: "claim_refund instruction with proportional floor-rounded refund formula"
  - phase: 72-sell-back-tax-escrow
    provides: "Existing 1M sell proptest block, sell math patterns"
provides:
  - "calculate_refund() public helper function (mirrors on-chain formula)"
  - "5 refund property tests at 1M iterations each (R1-R5)"
  - "7 deterministic refund math tests"
  - "4 deterministic instruction logic tests (mark_failed, prepare_transition, consolidate, denominator)"
  - "9.5M+ total proptest iterations across buy/sell/refund"
affects:
  - 74-graduation-orchestration (refund math proven correct, client can trust formula)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Percentage-based proptest derivation for multi-user balance generation"
    - "simulate_claims helper for sequential refund claim simulation"
    - "Order near-independence bound: max N-1 lamport deviation per user for N claimers"

key-files:
  created: []
  modified:
    - "programs/bonding_curve/src/math.rs"

key-decisions:
  - "R1 tests order near-independence (max 2 lamport deviation) not exact equality -- floor rounding in shrinking denominator is inherently order-dependent by small amounts"
  - "5M refund proptest iterations (5 properties x 1M each) brings total program iterations to ~9.5M"

patterns-established:
  - "Multi-user refund simulation: normalize percentages to sum-to-total, adjust last user for rounding"
  - "Dust bound: max N lamports for N users (1 lamport per floor division)"
  - "Fair share deviation bound: max N-1 lamports from floor(balance * pool / total)"

# Metrics
duration: 8min
completed: 2026-03-04
---

# Phase 73 Plan 03: Refund Property Tests Summary

**1M-iteration proptest proof of refund formula correctness: order near-independence, per-claim solvency, vault exhaustion bounds, floor-rounding protocol-favored, plus deterministic instruction logic tests for all 5 Phase 73 instructions**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-04T20:24:23Z
- **Completed:** 2026-03-04T20:32:35Z
- **Tasks:** 1/1
- **Files modified:** 1

## Accomplishments
- Proved refund formula floor(user_balance * refund_pool / total_outstanding) is correct at 5M iterations across 5 independent properties
- calculate_refund() public helper function available for reuse in future client-side or test code
- Deterministic tests confirm slot-boundary logic (mark_failed grace buffer), status gates (prepare_transition), consolidation flag idempotency, and denominator shrinkage pattern
- Total bonding curve program test iterations: ~9.5M (500K buy + 1M sell + 5x1M refund + deterministic)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refund property tests and deterministic instruction tests** - `7f7cb90` (test)

## Files Created/Modified

### Modified
- `programs/bonding_curve/src/math.rs` - Added calculate_refund() helper, simulate_claims() test helper, 7 deterministic refund tests, 5 proptest refund properties (1M iterations each), 4 deterministic instruction logic tests (+699 lines)

## Decisions Made

1. **R1 tests order near-independence not exact equality** -- The shrinking-denominator formula `floor(balance * pool / total)` where pool and total both decrease after each claim is inherently order-dependent by small amounts due to floor rounding. For 3 users, the max per-user deviation between orderings is 2 lamports (N-1). The plan specified exact order independence, but mathematical analysis during implementation revealed this is not achievable with integer floor division. The near-independence bound of N-1 lamports is the correct mathematical property and is still extremely strong (2 lamports on refunds of billions of lamports).

2. **5M total refund iterations (5 properties x 1M)** -- Each of the 5 properties runs independently at 1M iterations, providing 5M total refund test iterations. Combined with existing 500K buy and 1M sell iterations, the bonding curve has ~9.5M total proptest iterations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected R1 order-independence assertion bounds**
- **Found during:** Task 1 (proptest property R1 initial run)
- **Issue:** Plan specified exact order independence (`refund_a_abc == refund_a_cba`) but the shrinking-denominator formula with floor rounding is mathematically NOT exactly order-independent. With vault_sol=1000001, pct_a=1, pct_b=1, user A's refund differed by 1 lamport between orderings. With larger values, diffs up to N-1=2 were observed.
- **Fix:** Changed assertion from exact equality to bounded difference: `diff <= N-1` (2 for 3 users). Added fair-share deviation assertion (each refund within N-1 of `floor(balance * vault / total)`). Also proved total dust identical between orderings within 2 lamports.
- **Files modified:** programs/bonding_curve/src/math.rs
- **Verification:** 1M iterations pass with the corrected bounds
- **Committed in:** 7f7cb90

---

**Total deviations:** 1 auto-fixed (1 bug in plan specification)
**Impact on plan:** The corrected property is mathematically stronger than it appears -- it proves the formula is fair to within 2 lamports on refunds of up to 1000 SOL. No scope creep. The underlying formula is unchanged; only the test assertion was corrected.

## Issues Encountered

- Pre-existing proptest regression: `vault_solvency_mixed_buy_sell` fails with 1-lamport rounding edge case. Known issue from Phase 72. Not related to Phase 73. 52/53 tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All Phase 73 property tests pass: refund math is proven correct at 1M+ iterations
- All 10 bonding curve instructions compile, are wired, and have tests
- Phase 73 (Graduation + Refund) is fully complete: state machine, instructions, and property tests
- Ready for Phase 74: graduation orchestration (client-side scripts, vault withdrawals, finalize_transition)

---
*Phase: 73-graduation-refund*
*Completed: 2026-03-04*
