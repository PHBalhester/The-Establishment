---
phase: 13-access-control-cpi-integration
verified: 2026-02-04T22:50:41Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 13: Access Control & CPI Integration Verification Report

**Phase Goal:** AMM is CPI-only — all swaps require Tax Program authorization via swap_authority PDA, verified through mock Tax Program and negative tests

**Verified:** 2026-02-04T22:50:41Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | Swap instructions require a swap_authority PDA signed by the Tax Program — direct user calls without valid swap_authority are rejected | ✓ VERIFIED | Both swap_sol_pool.rs and swap_profit_pool.rs contain swap_authority account with seeds::program = TAX_PROGRAM_ID constraint. Tests test_direct_call_swap_sol_pool_fails and test_direct_call_swap_profit_pool_fails confirm rejection. |
| 2   | swap_authority is validated with seeds::program = TAX_PROGRAM_ID (cross-program PDA from Tax Program, not AMM) | ✓ VERIFIED | Lines 291-295 in swap_profit_pool.rs and 367-371 in swap_sol_pool.rs show seeds::program = TAX_PROGRAM_ID constraint. TAX_PROGRAM_ID constant points to Mock Tax Program ID (J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W). |
| 3   | Mock Tax Program successfully produces valid swap_authority CPI signatures and executes swaps through the AMM | ✓ VERIFIED | mock-tax-program/src/lib.rs implements execute_swap with invoke_signed (line 90). Tests test_mock_tax_cpi_swap_sol_pool_a_to_b, test_mock_tax_cpi_swap_sol_pool_b_to_a, test_mock_tax_cpi_swap_profit_pool_a_to_b, test_mock_tax_cpi_swap_profit_pool_b_to_a all pass. |
| 4   | Fake swap_authority (PDA from wrong program) is rejected with an explicit error | ✓ VERIFIED | fake-tax-program/src/lib.rs has different program ID (EbN9johTcjch29b4kBU5N5Ked2skJnahKGViMWg5Y7GP). Tests test_fake_tax_cpi_swap_sol_pool_rejected and test_fake_tax_cpi_swap_profit_pool_rejected confirm rejection due to seeds::program mismatch. |
| 5   | Full CPI chain (Mock Tax Program -> AMM -> Token-2022 transfer_checked) completes successfully within CPI depth limits | ✓ VERIFIED | Tests test_full_cpi_chain_sol_pool_with_hooks and test_full_cpi_chain_profit_pool_dual_hooks pass, demonstrating complete CPI chain with T22 transfer hooks. No CPI depth exceeded errors. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `programs/amm/src/constants.rs` | TAX_PROGRAM_ID constant | ✓ VERIFIED | Line 11: TAX_PROGRAM_ID = J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W (42 lines total) |
| `programs/amm/src/constants.rs` | SWAP_AUTHORITY_SEED constant | ✓ VERIFIED | Line 5: SWAP_AUTHORITY_SEED = b"swap_authority" |
| `programs/amm/src/errors.rs` | InvalidSwapAuthority error variant | ✓ VERIFIED | Lines 94-99: InvalidSwapAuthority error with message "Swaps must go through Tax Program - direct calls not allowed" (101 lines total) |
| `programs/amm/src/instructions/swap_sol_pool.rs` | swap_authority account with seeds::program constraint | ✓ VERIFIED | Lines 359-372: swap_authority: Signer<'info> with seeds = [SWAP_AUTHORITY_SEED], seeds::program = TAX_PROGRAM_ID (430 lines total, substantive) |
| `programs/amm/src/instructions/swap_profit_pool.rs` | swap_authority account with seeds::program constraint | ✓ VERIFIED | Lines 283-296: swap_authority: Signer<'info> with seeds = [SWAP_AUTHORITY_SEED], seeds::program = TAX_PROGRAM_ID (352 lines total, substantive) |
| `programs/mock-tax-program/src/lib.rs` | execute_swap instruction with invoke_signed | ✓ VERIFIED | Lines 42-93: execute_swap handler with invoke_signed at line 90 (113 lines total, substantive) |
| `programs/fake-tax-program/src/lib.rs` | execute_swap instruction (same interface, different program ID) | ✓ VERIFIED | Lines 32-80: execute_swap with invoke_signed, declare_id! shows different program ID (101 lines total, substantive) |
| `programs/amm/tests/test_cpi_access_control.rs` | CPI access control integration tests | ✓ VERIFIED | 1669 lines, 12 test functions covering all requirements (highly substantive) |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| swap_sol_pool.rs | constants.rs | TAX_PROGRAM_ID import | ✓ WIRED | Line 4: `use crate::constants::{..., TAX_PROGRAM_ID};` Line 370: `seeds::program = TAX_PROGRAM_ID` |
| swap_profit_pool.rs | constants.rs | TAX_PROGRAM_ID import | ✓ WIRED | Line 4: `use crate::constants::{..., TAX_PROGRAM_ID};` Line 294: `seeds::program = TAX_PROGRAM_ID` |
| mock-tax-program/lib.rs | AMM swap instructions | invoke_signed CPI with PDA signer | ✓ WIRED | Line 16: `use solana_program::program::invoke_signed;` Line 90: `invoke_signed(&ix, &account_infos, signer_seeds)?;` |
| fake-tax-program/lib.rs | AMM swap instructions | invoke_signed CPI with wrong PDA | ✓ WIRED | Line 11: `use solana_program::program::invoke_signed;` Line 79: `invoke_signed(&ix, &account_infos, signer_seeds)?;` |
| test_cpi_access_control.rs | mock-tax-program | Multi-program litesvm deployment | ✓ WIRED | Tests deploy all 3 programs to same litesvm instance, execute CPI calls, verify results |

### Requirements Coverage

| Requirement | Description | Status | Supporting Evidence |
| ----------- | ----------- | ------ | ------------------- |
| AUTH-01 | All swap instructions require swap_authority PDA signed by Tax Program | ✓ SATISFIED | Both swap instructions have swap_authority: Signer<'info> with seeds::program constraint. Direct call tests confirm rejection. |
| AUTH-02 | swap_authority validated with seeds::program = TAX_PROGRAM_ID | ✓ SATISFIED | Lines swap_sol_pool.rs:370 and swap_profit_pool.rs:294 show explicit seeds::program = TAX_PROGRAM_ID |
| AUTH-03 | Direct user calls to swap instructions fail | ✓ SATISFIED | Tests test_direct_call_swap_sol_pool_fails, test_direct_call_swap_profit_pool_fails, test_direct_call_with_wrong_signer_fails, test_direct_call_with_user_pda_fails all pass |
| AUTH-04 | Mock Tax Program created for testing that produces valid swap_authority CPI signatures | ✓ SATISFIED | mock-tax-program compiles, implements execute_swap with invoke_signed, all 4 Mock Tax CPI tests pass |
| AUTH-05 | Negative test: swap with fake swap_authority is rejected | ✓ SATISFIED | fake-tax-program exists with different ID, tests test_fake_tax_cpi_swap_sol_pool_rejected and test_fake_tax_cpi_swap_profit_pool_rejected confirm rejection |
| TEST-05 | Access control tests — mock Tax Program CPI succeeds, direct calls fail, fake PDA fails | ✓ SATISFIED | 12 tests in test_cpi_access_control.rs cover all scenarios, all pass |
| TEST-08 | CPI chain test — Mock Tax Program -> AMM -> Token-2022 transfer_checked | ✓ SATISFIED | Tests test_full_cpi_chain_sol_pool_with_hooks and test_full_cpi_chain_profit_pool_dual_hooks pass |

### Build Verification

```
Programs in Anchor.toml:
- amm = "BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx"
- mock_tax_program = "J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W"
- fake_tax_program = "EbN9johTcjch29b4kBU5N5Ked2skJnahKGViMWg5Y7GP"

IDL files generated:
- target/idl/amm.json
- target/idl/mock_tax_program.json
- target/idl/fake_tax_program.json

Build: anchor build succeeds
Tests: cargo test -p amm --test test_cpi_access_control
Result: ok. 12 passed; 0 failed; 0 ignored; 0 measured
```

### Test Results Detail

All 12 CPI access control tests pass:

**Mock Tax Program CPI Success (4 tests):**
- test_mock_tax_cpi_swap_sol_pool_a_to_b ... ok
- test_mock_tax_cpi_swap_sol_pool_b_to_a ... ok
- test_mock_tax_cpi_swap_profit_pool_a_to_b ... ok
- test_mock_tax_cpi_swap_profit_pool_b_to_a ... ok

**Direct Call Rejection (4 tests):**
- test_direct_call_swap_sol_pool_fails ... ok
- test_direct_call_swap_profit_pool_fails ... ok
- test_direct_call_with_wrong_signer_fails ... ok
- test_direct_call_with_user_pda_fails ... ok

**Fake Tax Program Rejection (2 tests):**
- test_fake_tax_cpi_swap_sol_pool_rejected ... ok
- test_fake_tax_cpi_swap_profit_pool_rejected ... ok

**Full CPI Chain (2 tests):**
- test_full_cpi_chain_sol_pool_with_hooks ... ok
- test_full_cpi_chain_profit_pool_dual_hooks ... ok

### Anti-Patterns Found

None identified. No TODO comments, placeholder content, or empty implementations in Phase 13 artifacts.

## Summary

Phase 13 successfully implements CPI-only access control for the AMM:

1. **Structural Changes Complete:**
   - swap_authority account added to both swap instructions
   - seeds::program = TAX_PROGRAM_ID constraint enforces cross-program PDA validation
   - TAX_PROGRAM_ID constant points to Mock Tax Program for testing

2. **Mock Tax Program Working:**
   - Implements execute_swap with proper invoke_signed pattern
   - Successfully derives and signs swap_authority PDA
   - All CPI calls through Mock Tax Program succeed

3. **Access Control Enforced:**
   - Direct user calls to swap instructions fail (no valid swap_authority)
   - Fake Tax Program calls fail (wrong program's PDA)
   - Only Mock Tax Program (matching TAX_PROGRAM_ID) can execute swaps

4. **Full CPI Chain Verified:**
   - Mock Tax -> AMM -> Token-2022 transfer chain completes
   - Transfer hooks work correctly through nested CPI
   - No CPI depth limit violations

**Production readiness:** The AMM is now CPI-only. For production deployment, update TAX_PROGRAM_ID in constants.rs from Mock Tax Program ID to the real Tax Program ID. The real Tax Program should implement execute_swap exactly like Mock Tax (same invoke_signed pattern).

**Next steps:** Phase 13 complete. AMM v0.2 core functionality is complete. All 7 Phase 13 requirements satisfied.

---
*Verified: 2026-02-04T22:50:41Z*
*Verifier: Claude (gsd-verifier)*
