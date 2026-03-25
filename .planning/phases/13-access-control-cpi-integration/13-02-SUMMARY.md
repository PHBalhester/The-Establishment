---
phase: 13-access-control-cpi-integration
plan: 02
subsystem: amm
tags: [anchor, cpi, pda, access-control, litesvm, integration-tests, invoke_signed]

# Dependency graph
requires:
  - phase: 13-access-control-cpi-integration
    plan: 01
    provides: swap_authority constraint and Mock/Fake Tax Programs
provides:
  - CPI access control integration tests (12 tests)
  - Mock Tax Program CPI success verification
  - Direct call rejection verification
  - Fake Tax Program rejection verification
  - Full CPI chain testing with Token-2022
affects: [tax-program, devnet-testing, production-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: [multi-program litesvm deployment, CPI chain testing, invoke_signed verification]

key-files:
  created:
    - programs/amm/tests/test_cpi_access_control.rs
  modified: []

key-decisions:
  - "Multi-program deployment to litesvm verifies CPI behavior end-to-end"
  - "Direct call tests use signer=false to test Anchor Signer type rejection"
  - "Full CPI chain tests verify Mock Tax -> AMM -> Token Program depth limits"

patterns-established:
  - "CPI access control testing: deploy caller + callee, verify signed PDA passthrough"
  - "Negative testing for CPI: wrong program PDAs rejected by seeds::program constraint"

# Metrics
duration: 7min
completed: 2026-02-04
---

# Phase 13 Plan 02: CPI Access Control Tests Summary

**12 integration tests verify AMM swap_authority CPI access control with Mock Tax, Fake Tax, and direct call scenarios**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-04T22:40:36Z
- **Completed:** 2026-02-04T22:47:08Z
- **Tasks:** 3
- **Files created:** 1 (1669 lines)
- **New tests:** 12

## Accomplishments

- Created comprehensive CPI access control test suite
- 4 Mock Tax Program CPI success tests (both swap instructions, both directions)
- 4 Direct call rejection tests (unsigned PDA, wrong signer, user PDA)
- 2 Fake Tax Program rejection tests (wrong program's PDA)
- 2 Full CPI chain tests (Mock Tax -> AMM -> Token Program)
- Total AMM tests: 85 (73 existing + 12 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test infrastructure for multi-program CPI testing** - `dc9e234` (feat)
2. **Task 2: Add Mock Tax CPI success and direct call rejection tests** - `c5a725b` (feat)
3. **Task 3: Add Fake Tax rejection and full CPI chain tests** - `e0c653d` (feat)

## Files Created

**programs/amm/tests/test_cpi_access_control.rs** (1669 lines)

Test infrastructure:
- Deploy 3 programs (AMM, Mock Tax, Fake Tax) to litesvm
- CpiTestContext with setup_sol_pool() and setup_profit_pool()
- Helper to derive swap_authority PDA from any program ID
- Instruction builders for Mock Tax execute_swap and direct AMM swaps

Tests:
- `test_mock_tax_cpi_swap_sol_pool_a_to_b` - AUTH-04 verification
- `test_mock_tax_cpi_swap_sol_pool_b_to_a` - reverse direction
- `test_mock_tax_cpi_swap_profit_pool_a_to_b` - PROFIT pool
- `test_mock_tax_cpi_swap_profit_pool_b_to_a` - reverse direction
- `test_direct_call_swap_sol_pool_fails` - AUTH-01, AUTH-03
- `test_direct_call_swap_profit_pool_fails` - same for PROFIT
- `test_direct_call_with_wrong_signer_fails` - random signer rejected
- `test_direct_call_with_user_pda_fails` - user PDA rejected
- `test_fake_tax_cpi_swap_sol_pool_rejected` - AUTH-02, AUTH-05
- `test_fake_tax_cpi_swap_profit_pool_rejected` - same for PROFIT
- `test_full_cpi_chain_sol_pool_with_hooks` - TEST-08
- `test_full_cpi_chain_profit_pool_dual_hooks` - T22 chain

## Requirements Satisfied

| Requirement | Description | Test |
|-------------|-------------|------|
| AUTH-01 | swap_authority must be valid PDA signer | test_direct_call_* |
| AUTH-02 | seeds::program = TAX_PROGRAM_ID enforced | test_fake_tax_* |
| AUTH-03 | Direct calls without swap_authority fail | test_direct_call_* |
| AUTH-04 | Mock Tax CPI produces valid signatures | test_mock_tax_cpi_* |
| AUTH-05 | PDAs from wrong programs rejected | test_fake_tax_* |
| TEST-05 | Access control integration testing | all 12 tests |
| TEST-08 | Full CPI chain completes | test_full_cpi_chain_* |

## Decisions Made

1. **Multi-program litesvm deployment** - All 3 programs deployed to same litesvm instance for realistic CPI testing

2. **Direct call tests use signer=false** - Instead of trying to sign a PDA (impossible), we pass the correct PDA but mark it as non-signer. Anchor's Signer type rejects unsigned accounts.

3. **Full CPI chain tests verify k-invariant and pool state** - Beyond just "it works", tests confirm swap math is correct through the entire CPI chain

## Deviations from Plan

None - plan executed exactly as written.

## Test Results

All 85 AMM tests pass:
- 26 unit tests (math, helpers)
- 13 pool initialization tests
- 8 SOL pool swap tests
- 18 PROFIT pool swap tests
- 8 transfer routing tests
- 12 CPI access control tests (NEW)

## Next Phase Readiness

Phase 13 (Access Control & CPI Integration) is now COMPLETE.

**What's proven:**
- AMM rejects direct user swaps (swap_authority required)
- AMM rejects swaps from unauthorized programs (wrong PDA)
- AMM accepts swaps from Tax Program (Mock Tax = TAX_PROGRAM_ID)
- Full CPI chain works within Solana's 4-level depth limit

**For production:**
- Update TAX_PROGRAM_ID from Mock Tax to real Tax Program ID
- Tax Program implements execute_swap exactly like Mock Tax (invoke_signed pattern)

**Blockers:** None

---
*Phase: 13-access-control-cpi-integration*
*Plan: 02*
*Completed: 2026-02-04*
