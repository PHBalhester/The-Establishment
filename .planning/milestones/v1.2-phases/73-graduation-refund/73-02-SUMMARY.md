---
phase: 73-graduation-refund
plan: 02
subsystem: on-chain
tags: [anchor, rust, bonding-curve, refund, token-burn, token-2022, escrow-consolidation]

# Dependency graph
requires:
  - phase: 73-graduation-refund (plan 01)
    provides: "CurveState with escrow_consolidated bool, 8 error variants, is_refund_eligible helper"
  - phase: 72-sell-back-tax-escrow
    provides: "Sell instruction, tax escrow PDA, lamport manipulation patterns, Token-2022 CPI patterns"
provides:
  - "consolidate_for_refund instruction (merge escrow into vault, set flag)"
  - "claim_refund instruction (burn tokens, proportional SOL refund)"
  - "10 total instruction modules wired in mod.rs and lib.rs"
affects:
  - 73-graduation-refund (plan 03: property tests for refund math)
  - 74-graduation-orchestration (client-side refund flow, vault withdrawals)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Token-2022 burn via anchor_spl::token_interface::burn (no Transfer Hook)"
    - "Proportional refund math with u128 intermediates and floor rounding"
    - "All-or-nothing burn-and-claim (no partial refunds)"
    - "Shrinking denominator pattern (tokens_sold decreases after each claim)"

key-files:
  created:
    - "programs/bonding_curve/src/instructions/consolidate_for_refund.rs"
    - "programs/bonding_curve/src/instructions/claim_refund.rs"
  modified:
    - "programs/bonding_curve/src/instructions/mod.rs"
    - "programs/bonding_curve/src/lib.rs"

key-decisions:
  - "claim_refund reads remaining_vault_balance AFTER SOL transfer for accurate event emission"
  - "consolidate_for_refund sets flag true even when transferable is 0 (no sells happened)"

patterns-established:
  - "Token-2022 burn: user signs as authority, token_mint is Mut (supply decreases), no remaining_accounts needed"
  - "Shrinking denominator refund: tokens_sold updated after each claim, next claimer gets proportional share of remaining pool"
  - "Partner curve constraint: key() != prevents same-curve-as-partner bypass in refund instructions"

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 73 Plan 02: Refund Instructions Summary

**Escrow consolidation + burn-and-claim proportional SOL refund via Token-2022 burn CPI with u128 floor-rounded proportional math**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T20:16:57Z
- **Completed:** 2026-03-04T20:20:42Z
- **Tasks:** 2/2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- consolidate_for_refund moves escrow lamports to sol_vault and sets escrow_consolidated flag
- claim_refund burns user's entire token balance and transfers proportional SOL refund with floor rounding
- Both instructions require partner curve account for is_refund_eligible compound state check
- All 10 instructions wired in mod.rs (10 pub mod + 10 pub use) and lib.rs (10 dispatches)
- `anchor build -p bonding_curve` succeeds, 36/37 tests pass (1 pre-existing proptest regression)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement consolidate_for_refund instruction** - `631bd80` (feat)
2. **Task 2: Implement claim_refund and wire both instructions** - `eae4804` (feat)

## Files Created/Modified

### Created
- `programs/bonding_curve/src/instructions/consolidate_for_refund.rs` - Escrow -> vault consolidation: permissionless, moves escrow lamports to sol_vault, sets escrow_consolidated flag, partner curve validation
- `programs/bonding_curve/src/instructions/claim_refund.rs` - Burn-and-claim: burns entire user token balance via Token-2022, transfers proportional SOL refund with floor rounding, shrinks tokens_sold denominator

### Modified
- `programs/bonding_curve/src/instructions/mod.rs` - 10 modules (2 new: claim_refund, consolidate_for_refund), updated header comments
- `programs/bonding_curve/src/lib.rs` - 10 instruction dispatches (2 new: consolidate_for_refund, claim_refund)

## Decisions Made

1. **claim_refund reads remaining_vault_balance AFTER SOL transfer** -- Direct lamport reads reflect post-mutation state within the same instruction. This gives accurate data in the RefundClaimed event for indexers/UIs.
2. **consolidate_for_refund sets flag true even when transferable is 0** -- Per plan spec: the point is that consolidation has been performed, not that there were funds to move. A curve with zero sells still needs the flag set for claim_refund to proceed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing proptest regression: `vault_solvency_mixed_buy_sell` (1-lamport rounding edge case). Known issue from Phase 72, not related to Phase 73 changes. 36/37 tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 10 bonding curve instructions compile and are wired
- consolidate_for_refund and claim_refund complete the failure-path user experience (CURVE-08)
- Ready for Plan 03: property tests for refund math (order independence, full vault exhaustion, no profitable exploits)
- The shrinking denominator pattern (tokens_sold decreases after each claim) needs thorough property testing to confirm correctness

---
*Phase: 73-graduation-refund*
*Completed: 2026-03-04*
