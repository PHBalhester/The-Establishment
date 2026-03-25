---
phase: 20-carnage-support
plan: 01
subsystem: tax
tags: [carnage, swap-exempt, cpi, pda-verification, epoch-program]

# Dependency graph
requires:
  - phase: 18-tax-buy-sell
    provides: Tax Program foundation with swap_sol_buy/sell patterns
  - phase: 11-amm-sol-swaps
    provides: AMM swap_sol_pool instruction for CPI target
provides:
  - swap_exempt instruction for Carnage Fund tax-exempt swaps
  - Bidirectional swap support (buy SOL->Token, sell Token->SOL)
  - Carnage PDA verification via seeds::program constraint
  - epoch_program_id() and CARNAGE_SIGNER_SEED constants
affects:
  - 20-02 (Carnage swap_exempt integration tests)
  - epoch-program (will call swap_exempt during Carnage rebalancing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "seeds::program constraint for cross-program PDA verification"
    - "Bidirectional swap via direction parameter (0=buy, 1=sell)"

key-files:
  created:
    - programs/tax-program/src/instructions/swap_exempt.rs
  modified:
    - programs/tax-program/src/constants.rs
    - programs/tax-program/src/instructions/mod.rs
    - programs/tax-program/src/lib.rs

key-decisions:
  - "Use function epoch_program_id() instead of const EPOCH_PROGRAM_ID for Pubkey (const fn limitations)"
  - "CARNAGE_SIGNER_SEED = b\"carnage_signer\" per Tax_Pool_Logic_Spec.md Section 13.3"
  - "No minimum_output parameter per Carnage_Fund_Spec.md Section 9.3 (market execution)"
  - "direction: u8 parameter (0=AtoB/buy, 1=BtoA/sell) matches AMM SwapDirection"

patterns-established:
  - "Cross-program PDA verification: seeds::program = external_program_id()"
  - "Bidirectional swap routing via single direction byte"

# Metrics
duration: 8min
completed: 2026-02-06
---

# Phase 20 Plan 01: Carnage swap_exempt Instruction Summary

**Tax-exempt bidirectional swap instruction for Carnage Fund with cross-program PDA verification via seeds::program constraint**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-06T12:00:00Z
- **Completed:** 2026-02-06T12:08:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created swap_exempt instruction supporting both buy (SOL->Token) and sell (Token->SOL) directions
- Implemented Carnage PDA verification using seeds::program = epoch_program_id() constraint
- CPI to AMM swap_sol_pool with no tax calculation and minimum_output=0 (market execution)
- Added EPOCH_PROGRAM_ID and CARNAGE_SIGNER_SEED constants for Epoch Program integration

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Carnage constants** - `a38a274` (feat)
2. **Task 2: Create bidirectional swap_exempt instruction** - `db2c472` (feat)

## Files Created/Modified

- `programs/tax-program/src/constants.rs` - Added epoch_program_id() and CARNAGE_SIGNER_SEED
- `programs/tax-program/src/instructions/swap_exempt.rs` - New instruction with SwapExempt accounts and handler (241 lines)
- `programs/tax-program/src/instructions/mod.rs` - Export swap_exempt module
- `programs/tax-program/src/lib.rs` - Add swap_exempt entry point

## Decisions Made

1. **epoch_program_id() function vs const** - Rust const fn limitations with Pubkey::from_str require runtime function. Placeholder value used with TODO comment.

2. **CARNAGE_SIGNER_SEED = b"carnage_signer"** - Per Tax_Pool_Logic_Spec.md Section 13.3. Must match Epoch Program's derivation.

3. **No minimum_output parameter** - Carnage accepts market execution per Carnage_Fund_Spec.md Section 9.3. Slippage protection unnecessary for internal rebalancing.

4. **direction: u8 (0=buy, 1=sell)** - Directly maps to AMM SwapDirection enum. Simpler than enum for cross-program interface.

5. **carnage_authority as "user" in AMM CPI** - Carnage PDA acts as the swap initiator, owning the token accounts being swapped.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - build succeeded on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- swap_exempt instruction ready for integration testing (20-02)
- Epoch Program ID placeholder needs update when Epoch Program deployed
- Transfer hook accounts forwarded via remaining_accounts for Token-2022 compatibility

---
*Phase: 20-carnage-support*
*Completed: 2026-02-06*
