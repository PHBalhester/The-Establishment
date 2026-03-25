---
phase: 49-protocol-safety-events
plan: 02
subsystem: security
tags: [slippage-floor, balance-diff, events, profit-pool, staking-events, escrow-monitoring]

# Dependency graph
requires:
  - phase: 49-protocol-safety-events
    provides: "pool_reader.rs, calculate_output_floor, MINIMUM_OUTPUT_FLOOR_BPS, MinimumOutputFloorViolation"
provides:
  - "SEC-10 floor enforcement on swap_profit_buy and swap_profit_sell"
  - "FIX-06 UntaxedSwap events with actual output_amount and lp_fee"
  - "Enriched RewardsDeposited event with escrow_vault and escrow_balance"
affects:
  - "51 (test fixes -- integration tests need minimum_output >= floor for PROFIT pool swaps)"
  - "Client-side profit swap builders (must pass minimum_output >= 50% of expected)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Balance-diff pattern for PROFIT pool CPI output measurement"
    - "LP fee read from PoolState byte offset 153-155 for event enrichment"
    - "Event enrichment with existing account data (zero new accounts)"

key-files:
  created: []
  modified:
    - "programs/tax-program/src/instructions/swap_profit_buy.rs"
    - "programs/tax-program/src/instructions/swap_profit_sell.rs"
    - "programs/staking/src/events.rs"
    - "programs/staking/src/instructions/deposit_rewards.rs"

key-decisions:
  - "PROFIT pool floor uses same 50% threshold as SOL pool -- no special treatment for untaxed swaps"
  - "LP fee read from raw pool bytes at offset 153-155 (same no-import pattern as reserve reads)"
  - "RewardsDeposited enrichment adds escrow_vault and escrow_balance from existing AccountInfo (zero new accounts, zero new constraints)"
  - "New event fields appended at end for backward compatibility (old parsers can ignore them)"

patterns-established:
  - "LP fee BPS extraction: pool_data[153..155] as u16, lp_fee = amount_in * lp_fee_bps / 10_000"
  - "Sell direction reserves: reserve_in = reserve_b (PROFIT), reserve_out = reserve_a (CRIME/FRAUD)"
  - "Event enrichment pattern: read .key() and .lamports() from existing accounts in emit! block"

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 49 Plan 02: PROFIT Pool Floor & Staking Event Enrichment Summary

**50% output floor on PROFIT buy/sell swaps (SEC-10), balance-diff UntaxedSwap events (FIX-06), and RewardsDeposited enrichment with escrow monitoring fields (SEC-08/SEC-09)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T10:30:58Z
- **Completed:** 2026-02-20T10:33:19Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- All 4 user-facing swap instructions now enforce 50% minimum output floor (SEC-10 complete)
- Zero remaining instances of `output_amount: 0` or `lp_fee: 0` in any swap instruction (FIX-06 complete)
- RewardsDeposited event enriched with escrow_vault pubkey and escrow_balance for dashboard monitoring
- Clean compilation of both tax-program and staking crates

## Task Commits

Each task was committed atomically:

1. **Task 1: Apply floor enforcement and balance-diff event fix to PROFIT pool swap instructions** - `7f80cb2` (feat)
2. **Task 2: Enrich RewardsDeposited event with escrow monitoring fields** - `c706efa` (feat)

## Files Created/Modified

- `programs/tax-program/src/instructions/swap_profit_buy.rs` - Floor check before CPI, balance-diff for output_amount, LP fee from pool bytes in event
- `programs/tax-program/src/instructions/swap_profit_sell.rs` - Same pattern as buy but with reversed reserve direction (reserve_b -> reserve_a)
- `programs/staking/src/events.rs` - Added escrow_vault (Pubkey) and escrow_balance (u64) fields to RewardsDeposited struct
- `programs/staking/src/instructions/deposit_rewards.rs` - Populated new event fields from existing escrow_vault AccountInfo

## Decisions Made

- **Same 50% floor for PROFIT pools:** No special treatment for untaxed swaps. Consistency across all user-facing swap instructions prevents confusion and closes all zero-slippage sandwich vectors uniformly.
- **LP fee from raw bytes:** Reading lp_fee_bps at byte offset 153-155 follows the same proven pattern as read_pool_reserves. Avoids cross-crate dependency on AMM PoolState type.
- **Event enrichment, not reconciliation changes:** RewardsDeposited enrichment adds monitoring observability (escrow_vault, escrow_balance) without modifying the existing reconciliation require! logic, which is already correct.
- **Backward-compatible event fields:** New fields appended at end of struct. Old parsers that don't know about escrow_vault/escrow_balance can still parse amount/new_pending/slot.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all compilation clean, all verifications passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 49 is now COMPLETE: SEC-10 (all 4 swap floors), FIX-06 (all event fields populated), SEC-08 (escrow reconciliation verified + enriched), SEC-09 (event coverage enriched)
- Client-side PROFIT pool swap builders will need to pass minimum_output >= 50% of expected output
- Pre-existing integration test failures for PROFIT pool swaps are tracked for Phase 51
- Ready for Phase 50 (Program Maintenance)

---
*Phase: 49-protocol-safety-events*
*Completed: 2026-02-20*
