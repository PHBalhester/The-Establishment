---
phase: 18-tax-program-core
plan: 03
subsystem: tax
tags: [swap, cpi, tax-distribution, invoke_signed, anchor]

# Dependency graph
requires:
  - phase: 18-01
    provides: Tax Program scaffold, constants, errors, events
  - phase: 18-02
    provides: calculate_tax and split_distribution functions
provides:
  - swap_sol_buy instruction for SOL -> CRIME/FRAUD swaps
  - Tax calculation and 3-way distribution (75/24/1)
  - AMM CPI pattern with swap_authority PDA signature
  - TaxedSwap event emission
affects: [18-04, 19, 20, 21]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - invoke_signed for CPI with PDA signature
    - Precomputed Anchor instruction discriminator
    - remaining_accounts forwarding for transfer hooks

key-files:
  created:
    - programs/tax-program/src/instructions/mod.rs
    - programs/tax-program/src/instructions/swap_sol_buy.rs
  modified:
    - programs/tax-program/src/lib.rs
    - programs/tax-program/Cargo.toml

key-decisions:
  - "Precomputed AMM discriminator (sha256 global:swap_sol_pool) instead of runtime hash"
  - "Tax rate hardcoded at 4% until Epoch Program integration"
  - "output_amount=0 and epoch=0 in event until integration complete"

patterns-established:
  - "AMM CPI: build AccountMetas + ix_data manually, invoke_signed with swap_authority"
  - "Tax distribution: invoke system_instruction::transfer for each portion"
  - "Hook support: forward remaining_accounts to AMM for Token-2022 transfers"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 18 Plan 03: swap_sol_buy Instruction Summary

**swap_sol_buy instruction implementing SOL->CRIME/FRAUD swaps with buy tax deduction and atomic 3-way distribution via CPI**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T10:31:22Z
- **Completed:** 2026-02-06T10:36:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Implemented swap_sol_buy instruction with full tax calculation and distribution
- Built AMM CPI pattern using invoke_signed with swap_authority PDA signature
- Integrated tax math helpers from Plan 18-02 (calculate_tax, split_distribution)
- Forward remaining_accounts for Token-2022 transfer hook support

## Task Commits

Each task was committed atomically:

1. **Task 1: Create instructions module and SwapSolBuy accounts struct** - `daf9110` (feat)
2. **Task 2: Implement swap_sol_buy handler logic** - `d806be0` (feat)

## Files Created/Modified

- `programs/tax-program/src/instructions/mod.rs` - Instructions module exports
- `programs/tax-program/src/instructions/swap_sol_buy.rs` - Full swap_sol_buy implementation (330 lines)
- `programs/tax-program/src/lib.rs` - Added instructions module and swap_sol_buy entry point
- `programs/tax-program/Cargo.toml` - Added AMM dependency with cpi feature

## Decisions Made

1. **Precomputed discriminator** - Used precomputed SHA256 hash bytes `[0xde, 0x80, 0x1e, 0x7b, 0x55, 0x27, 0x91, 0x8a]` for AMM swap_sol_pool discriminator instead of runtime hash (solana_program::hash not exported via anchor_lang)

2. **Tax rate hardcoded** - Using 400 bps (4%) until Epoch Program provides dynamic rates via epoch_state account

3. **Event TODOs** - `output_amount` and `epoch` fields set to 0 with TODO comments for future integration when Epoch Program exists

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **Linter interference** - Environment linter repeatedly added swap_sol_sell files and references (intended for Plan 18-04). Resolved by removing generated files and cleaning up mod.rs/lib.rs.

2. **Hash module unavailable** - `anchor_lang::solana_program::hash` not exported. Resolved by precomputing the discriminator bytes.

## Next Phase Readiness

- swap_sol_buy instruction ready for integration testing
- swap_sol_sell (Plan 18-04) will follow same pattern with output-side tax deduction
- Epoch Program integration (Plan 19-20) will replace hardcoded tax rate

---
*Phase: 18-tax-program-core*
*Completed: 2026-02-06*
