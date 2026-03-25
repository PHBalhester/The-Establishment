---
phase: 19-profit-swaps
plan: 02
subsystem: api
tags: [rust, anchor, swap, cpi, profit-pool, token-2022]

# Dependency graph
requires:
  - phase: 19-01
    provides: UntaxedSwap event and CrimeProfit/FraudProfit PoolType variants
  - phase: 18-tax-core
    provides: Tax Program foundation with CPI pattern and swap_authority PDA
provides:
  - swap_profit_buy instruction for CRIME/FRAUD -> PROFIT swaps
  - swap_profit_sell instruction for PROFIT -> CRIME/FRAUD swaps
  - Untaxed CPI routing to AMM swap_profit_pool
affects: [19-03, epoch-program, client]

# Tech tracking
tech-stack:
  added: []
  patterns: [Untaxed CPI routing pattern, Dual Token-2022 hook passthrough]

key-files:
  created:
    - programs/tax-program/src/instructions/swap_profit_buy.rs
    - programs/tax-program/src/instructions/swap_profit_sell.rs
  modified:
    - programs/tax-program/src/instructions/mod.rs
    - programs/tax-program/src/lib.rs

key-decisions:
  - "PROFIT swap instructions use same discriminator for both directions"
  - "output_amount and lp_fee set to 0 in UntaxedSwap event (CPI return data not accessible)"
  - "Single token_2022_program passed for both token_program_a and token_program_b"

patterns-established:
  - "Untaxed CPI: No tax calculation, no distribution accounts, direct AMM passthrough"
  - "Dual T22 hook passthrough: remaining_accounts forwarded for AMM to split at midpoint"

# Metrics
duration: 4min
completed: 2026-02-06
---

# Phase 19 Plan 02: PROFIT Pool Swap Instructions Summary

**Untaxed swap_profit_buy and swap_profit_sell instructions routing CRIME/FRAUD <-> PROFIT via CPI to AMM**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-06T11:20:00Z
- **Completed:** 2026-02-06T11:24:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Implemented swap_profit_buy instruction (CRIME/FRAUD -> PROFIT, direction=0)
- Implemented swap_profit_sell instruction (PROFIT -> CRIME/FRAUD, direction=1)
- Tax Program now has complete swap coverage: 4 instructions (sol_buy, sol_sell, profit_buy, profit_sell)
- Simplified account structure (no tax distribution accounts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create swap_profit_buy instruction** - `4fa5960` (feat)
2. **Task 2: Create swap_profit_sell instruction** - `80a6842` (feat)
3. **Task 3: Export instructions in mod.rs and lib.rs** - `9baabad` (feat)

## Files Created/Modified
- `programs/tax-program/src/instructions/swap_profit_buy.rs` - CRIME/FRAUD -> PROFIT CPI routing
- `programs/tax-program/src/instructions/swap_profit_sell.rs` - PROFIT -> CRIME/FRAUD CPI routing
- `programs/tax-program/src/instructions/mod.rs` - Module declarations and re-exports
- `programs/tax-program/src/lib.rs` - Entry points for both instructions

## Decisions Made
- Used same AMM discriminator for both directions: `[0xce, 0xa3, 0x0b, 0x22, 0xf1, 0x6c, 0x24, 0xa6]`
- Pass token_2022_program for both token_program_a and token_program_b (both sides are T22)
- Set output_amount and lp_fee to 0 in UntaxedSwap events (matches Phase 18 pattern - CPI return data not easily accessible)

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PROFIT swap instructions complete and ready for integration tests
- Plan 03 can test both swap directions with CRIME/PROFIT and FRAUD/PROFIT pools
- All 4 swap instructions (sol_buy, sol_sell, profit_buy, profit_sell) available

---
*Phase: 19-profit-swaps*
*Completed: 2026-02-06*
