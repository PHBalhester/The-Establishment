---
phase: 18-tax-program-core
plan: 04
subsystem: tax
tags: [rust, anchor, cpi, invoke_signed, solana, wsol, sell-tax]

# Dependency graph
requires:
  - phase: 18-01
    provides: Tax Program scaffold with constants, errors, events modules
  - phase: 18-02
    provides: calculate_tax and split_distribution functions
provides:
  - swap_sol_sell instruction for CRIME/FRAUD -> SOL taxed swaps
  - SwapSolSell accounts struct
  - Output-based tax pattern (tax on SOL received, not tokens sent)
  - Slippage check AFTER tax deduction
affects:
  - 18-05 (integration tests will verify sell flow)
  - Phase 19 (PROFIT pool swaps will follow similar CPI pattern)
  - Phase 20 (swap_exempt uses same distribution but no tax)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - invoke_signed for raw AMM CPI (no generated stubs)
    - Balance diff method to capture gross output
    - Post-tax slippage check (net_output >= minimum_output)
    - Native SOL transfers for tax distribution

key-files:
  created:
    - programs/tax-program/src/instructions/swap_sol_sell.rs
  modified:
    - programs/tax-program/src/instructions/mod.rs
    - programs/tax-program/src/lib.rs

key-decisions:
  - "Tax calculated on gross output, deducted from user's native SOL balance"
  - "Slippage check happens AFTER tax deduction (net_output >= minimum_output)"
  - "AMM minimum_amount_out = 0 (we check slippage ourselves)"
  - "Placeholder tax rate 1400 bps (14%) until EpochState integration"

patterns-established:
  - "Sell tax pattern: execute swap first, tax output, check slippage, distribute"
  - "Raw CPI with invoke_signed for AMM calls (portable, no stub dependency)"
  - "Balance diff method: record before, execute CPI, reload, calculate diff"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 18 Plan 04: swap_sol_sell Instruction Summary

**CRIME/FRAUD -> SOL swap with sell tax on output using invoke_signed CPI, balance diff output capture, and post-tax slippage protection**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T10:31:44Z
- **Completed:** 2026-02-06T10:37:11Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- Created SwapSolSell accounts struct matching SwapSolBuy layout
- Implemented complete handler with AMM CPI, tax calculation, slippage check
- Tax applied to OUTPUT (key difference from buy which applies to input)
- Distribution identical to buy: 75% staking, 24% carnage, 1% treasury
- TaxedSwap event emission with Sell direction

## Task Commits

1. **Task 1: Create swap_sol_sell accounts struct** - `6170d66` (feat)
   - SwapSolSell accounts matching SwapSolBuy layout
   - Module exports in mod.rs and lib.rs
   - Stub handler for Task 2

2. **Task 2: Implement swap_sol_sell handler logic** - `7ef7d30` (feat)
   - invoke_signed CPI to AMM with BtoA direction
   - Balance diff to capture gross output
   - Tax on output, slippage on net
   - Native SOL distribution transfers
   - TaxedSwap event emission

## Files Created/Modified

- `programs/tax-program/src/instructions/swap_sol_sell.rs` - 260 lines (created)
  - SwapSolSell accounts struct
  - handler() with complete sell flow
  
- `programs/tax-program/src/instructions/mod.rs` - Added swap_sol_sell export
- `programs/tax-program/src/lib.rs` - Added swap_sol_sell instruction

## Decisions Made

1. **Tax on output, not input:** For sell, user sends full tokens to AMM, tax is calculated on WSOL received. This matches Tax_Pool_Logic_Spec.md Section 14.3.

2. **User pays tax from native SOL:** The AMM gives user WSOL but tax distribution is native SOL. User must have SOL balance to pay tax.

3. **Slippage after tax:** minimum_output means net SOL user receives, not gross from AMM. This is the intuitive user expectation.

4. **AMM minimum = 0:** We pass 0 to AMM's slippage check because we handle it ourselves after tax deduction.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Minor file coordination issue with parallel Plan 18-03:
- swap_sol_sell.rs was deleted from working directory after git commit (suspected file system race)
- Restored from git commit using `git checkout 6170d66 -- swap_sol_sell.rs`
- No impact on final result

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- swap_sol_sell instruction complete and compiles
- Ready for Plan 18-05 integration testing
- Placeholder tax_bps = 1400 (14%) needs EpochState integration in future phase
- swap_sol_buy (Plan 18-03) also implementing in parallel with same patterns

---
*Phase: 18-tax-program-core*
*Completed: 2026-02-06*
