---
phase: 79-financial-safety
plan: 01
subsystem: financial-safety
tags: [solana, anchor, rent-exempt, slippage, staking, epoch, tax]

# Dependency graph
requires:
  - phase: 78-authority-hardening
    provides: Authority map and admin PDA verification
provides:
  - Rent-exempt guards on staking escrow and epoch vault
  - Computed AMM floor for sell path slippage protection
affects: [devnet-deploy, mainnet-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rent::get()?.minimum_balance(0) pattern for PDA drain protection"
    - "Ceil-division gross floor for pre-tax AMM minimum"

key-files:
  created: []
  modified:
    - programs/staking/src/instructions/claim.rs
    - programs/epoch-program/src/instructions/trigger_epoch_transition.rs
    - programs/tax-program/src/instructions/swap_sol_sell.rs

key-decisions:
  - "Hard error on staking claim insufficient balance (no partial claims)"
  - "Epoch bounty skips silently when vault balance insufficient (transition still advances)"
  - "Sell path gross_floor derived only from user minimum_output (no double-layer with protocol floor)"

patterns-established:
  - "Rent-exempt reservation: always subtract rent_exempt_min before checking available balance on PDA accounts"
  - "AMM floor derivation: ceil(minimum_output * BPS_DENOM / (BPS_DENOM - tax_bps)) using u128 intermediates"

# Metrics
duration: 8min
completed: 2026-03-08
---

# Phase 79 Plan 01: Financial Safety Summary

**Rent-exempt drain protection on staking/epoch PDAs and computed AMM sell-floor replacing hardcoded zero minimum**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-08T10:32:50Z
- **Completed:** 2026-03-08T10:41:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Staking claim now reserves rent-exempt minimum before allowing reward transfers, preventing escrow PDA garbage collection
- Epoch bounty threshold includes rent-exempt minimum so vault PDA survives bounty payments
- Tax sell path computes a gross floor from user's minimum_output and tax_bps, passing it to AMM CPI instead of 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Rent-exempt guards for staking claim and epoch bounty** - `5cbdd3d` (fix)
2. **Task 2: Tax sell path computed AMM floor** - `9ef1072` (fix)

## Files Created/Modified
- `programs/staking/src/instructions/claim.rs` - Added Rent::get() guard, available = escrow_balance - rent_exempt_min
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` - Bounty threshold now includes rent_exempt_min
- `programs/tax-program/src/instructions/swap_sol_sell.rs` - Replaced amm_minimum=0 with ceil-division gross_floor

## Decisions Made
- Hard error on staking claim when escrow has insufficient balance after rent reservation (no partial claims per CONTEXT.md)
- Epoch bounty skips when vault balance < bounty + rent-exempt (transition still advances, crank just gets no bounty)
- Sell path uses only user's minimum_output for floor derivation, not double-layered with protocol MINIMUM_OUTPUT_FLOOR_BPS
- Used cast `(tax_bps as u64)` for type comparison since tax_bps is u16

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed type mismatch: tax_bps is u16 not u64**
- **Found during:** Task 2 (Tax sell path)
- **Issue:** Plan template used `tax_bps < bps_denom` but tax_bps is u16 and bps_denom is u64
- **Fix:** Changed comparison to `(tax_bps as u64) < bps_denom`
- **Files modified:** programs/tax-program/src/instructions/swap_sol_sell.rs
- **Verification:** cargo build -p tax-program succeeds
- **Committed in:** 9ef1072 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial type cast fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three financial safety fixes compiled and tested
- FIN-01, FIN-02, FIN-03 requirements satisfied
- Programs ready for next phase of v1.3 hardening

---
*Phase: 79-financial-safety*
*Completed: 2026-03-08*
