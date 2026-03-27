# LiteSVM Results

Execution date: 2026-03-08
Worktree: `.bok/worktree` (branch: bok/verify-1772901528)

## Summary: 8 passed, 1 failed (9 total across 2 programs)

---

## amm — bok_litesvm (2/2 PASSED)

| Test | Status | Notes |
|------|--------|-------|
| inv_amm_litesvm_1_k_check_before_transfers | PASSED | Structural verification: k-invariant check ordering confirmed by code inspection |
| inv_amm_litesvm_2_slippage_check_before_cpi | PASSED | Structural verification: slippage check ordering confirmed by code inspection |

Note: These are structural/ordering checks verified by code inspection within the test harness. Full LiteSVM runtime tests require program binary loading setup.

## bonding-curve — bok_litesvm (6/7, 1 FAILURE)

| Test | Status | Notes |
|------|--------|-------|
| inv_bc_014a_solvency_formula_after_normal_buy | PASSED | Vault solvent after standard buy |
| inv_bc_014a_solvency_formula_after_partial_drain | PASSED | Vault solvent after partial drain |
| inv_bc_014a_solvency_at_zero_tokens_sold | PASSED | Vault solvent at curve start |
| inv_bc_014a_solvency_formula_after_buy_and_sell | PASSED | Vault solvent after buy+sell cycle |
| inv_bc_014a_solvency_at_full_curve | PASSED | Vault solvent at curve completion |
| inv_bc_014b_assertion_catches_insolvency_before_transfer | PASSED | Insolvency assertion fires correctly |
| inv_bc_014b_sequential_sells_maintain_solvency | **FAILED** | vault=890,875 rent=890,880 (off by 5 lamports) |

**inv_bc_014b_sequential_sells_maintain_solvency analysis:**

After a sequence of sells, the vault balance (890,875 lamports) falls 5 lamports below the rent-exempt minimum (890,880 lamports). This is a **real finding**:

- **Root cause:** Accumulated rounding dust from multiple sell operations. Each sell's SOL payout is computed via `calculate_sol_for_tokens()` which floors the result, but the cumulative effect over many operations can erode the vault below rent-exempt minimum.
- **Severity:** MEDIUM — If vault drops below rent-exempt minimum, the account could be garbage-collected by the Solana runtime, destroying all remaining funds.
- **Mitigation:** The on-chain code should check `vault_balance - payout >= rent_exempt_minimum` before executing any sell transfer. This is the same class of issue found in the proptest `inv_bc_007_vault_solvency` failure.
