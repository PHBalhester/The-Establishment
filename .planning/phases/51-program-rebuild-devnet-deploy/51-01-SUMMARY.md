---
phase: 51-program-rebuild-devnet-deploy
plan: 01
subsystem: testing
tags: [litesvm, mock-tax-program, swap-authority, cpi, pda-signing, anchor]

# Dependency graph
requires:
  - phase: 46-account-validation
    provides: swap_authority PDA requirement on AMM swap instructions
  - phase: 51-program-rebuild-devnet-deploy
    provides: test_cpi_access_control.rs reference pattern for Mock Tax CPI
provides:
  - All 19 AMM swap integration tests passing with swap_authority PDA via Mock Tax CPI
  - Reusable mock_tax_execute_swap_data() builder pattern for future AMM swap tests
affects: [51-02, 51-03, 51-04, 51-05, 51-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mock Tax Program CPI routing for AMM swap tests in LiteSVM"
    - "Dual-program LiteSVM deployment (AMM + Mock Tax) via read_program_bytes + deploy_upgradeable_program"

key-files:
  created: []
  modified:
    - programs/amm/tests/test_swap_sol_pool.rs
    - programs/amm/tests/test_swap_profit_pool.rs

key-decisions:
  - "Route all AMM swap tests through Mock Tax Program CPI (Option B/C) rather than LiteSVM arbitrary signer (not supported)"
  - "Deploy both AMM and Mock Tax Program in LiteSVM using setup_svm_with_programs (replaces single-program setup)"

patterns-established:
  - "Mock Tax CPI routing: All AMM swap test helpers build instructions targeting mock_tax_program_id execute_swap, not AMM directly"
  - "swap_authority PDA included in all test context structs (SwapTestContext, ProfitPoolTestContext, SolPoolTestContext)"

# Metrics
duration: 12min
completed: 2026-02-20
---

# Phase 51 Plan 01: Fix AMM Swap Tests Summary

**19 AMM swap tests fixed by routing through Mock Tax Program CPI for swap_authority PDA signing**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-02-20
- **Completed:** 2026-02-20
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments
- Fixed all 7 test_swap_sol_pool tests (AccountNotSigner error 3010 -> passing)
- Fixed all 12 test_swap_profit_pool tests (same root cause -> passing)
- Full AMM test suite passes: 85 tests (26 unit + 12 CPI + 13 pool init + 18 profit + 8 sol + 8 transfer)
- Zero on-chain code modifications -- only test harness files changed

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix test_swap_sol_pool.rs (7 failures)** - `14d7940` (fix)
2. **Task 2: Fix test_swap_profit_pool.rs (12 failures)** - `846058e` (fix)

## Files Created/Modified
- `programs/amm/tests/test_swap_sol_pool.rs` - Added Mock Tax CPI routing, swap_authority PDA, dual-program LiteSVM setup
- `programs/amm/tests/test_swap_profit_pool.rs` - Same pattern applied to both PROFIT pool and SOL pool test contexts within file

## Decisions Made

1. **Mock Tax CPI routing over LiteSVM arbitrary signer** - LiteSVM does not support marking arbitrary PDAs as signers. The swap_authority PDA must be signed by the Tax Program via invoke_signed. Loading the Mock Tax Program alongside AMM in LiteSVM and routing swap instructions through its `execute_swap` entry matches production CPI flow and validates the full signing chain.

2. **Dual-program deployment via setup_svm_with_programs** - Replaced `setup_svm_with_upgradeable_program` (single program) with `read_program_bytes` + `deploy_upgradeable_program` + `setup_svm_with_programs` to deploy both AMM and Mock Tax Program. This ensures the swap_authority PDA derived from TAX_PROGRAM_ID is valid and the Mock Tax Program can invoke_signed with it.

3. **Instruction wrapping via mock_tax_execute_swap_data** - AMM swap instruction data is wrapped in Mock Tax's `execute_swap` format: `sha256("global:execute_swap")[..8] + u32_le(amm_data.len()) + amm_data`. This lets the Mock Tax Program deserialize the inner AMM instruction and forward it via CPI.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Shell environment**: `source "$HOME/.cargo/env"` failed because the shell didn't resolve `$HOME` in this context. Resolved by using explicit PATH: `export PATH="/Users/mlbob/.cargo/bin:/Users/mlbob/.local/share/solana/install/active_release/bin:/opt/homebrew/bin:/usr/bin:/usr/local/bin:/bin:$PATH"`.
- **Edit uniqueness**: One Edit call in test_swap_profit_pool.rs failed because the replacement string matched in two places (both `build_swap_profit_instruction` and `build_swap_sol_instruction` had similar patterns). Resolved by including more surrounding context in the Edit to make each occurrence unique.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All AMM swap tests passing -- ready for Plan 51-02 (Tax Program test fixes) and remaining 51-0x plans
- Mock Tax CPI pattern is established and can be referenced for any future AMM swap test additions
- No blockers

---
*Phase: 51-program-rebuild-devnet-deploy*
*Completed: 2026-02-20*
