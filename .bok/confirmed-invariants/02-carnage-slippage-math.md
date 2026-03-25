# Carnage Slippage Math -- Confirmed Invariants
# Priority Rank: 2 (Critical-path Carnage execution)

Source: `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`, `execute_carnage.rs`, `tax_math.rs`

---

## INV-CARN-005: Sell Proceeds Combined (Not Stranded) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 1 (REGRESSION: past bug, zero coverage)
- **Property:** `total_buy_amount = wrap_amount + sol_from_sale` (no SOL stranded)
- **Code:** `execute_carnage_atomic.rs:358-366`
- **Existing:** None -- past bug fix with no regression test

## INV-CARN-012: Vault Balance Delta (Step 1.5 Reload) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 2 (REGRESSION: past bug, zero coverage)
- **Property:** `tokens_bought = post_buy_balance - post_burn_balance` (not stale pre-burn)
- **Code:** `execute_carnage_atomic.rs:388-414`
- **Existing:** None -- past bug fix with no regression test

## INV-CARN-001: Atomic Slippage Floor (85%) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 3
- **Property:** `bought >= expected * 8500 / 10000 OR revert`
- **Code:** `execute_carnage_atomic.rs:422-438`
- **Existing:** Unit test (line 966)

## INV-CARN-002: Fallback Slippage Floor (75%) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 4
- **Property:** `bought >= expected * 7500 / 10000 OR revert`
- **Code:** `execute_carnage.rs:429-446`
- **Existing:** Unit test (line 960)

## INV-CARN-004: MAX_CARNAGE_SWAP_LAMPORTS Cap [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 5 (GAP: no test)
- **Property:** `total_buy_amount <= 1_000_000_000_000`
- **Code:** `execute_carnage_atomic.rs:356,361-364`
- **Existing:** None

## INV-CARN-013: Rent-Exempt Minimum Preserved [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 6 (GAP: no test)
- **Property:** `sol_vault.lamports() >= rent_exempt_min` after wrap
- **Code:** `execute_carnage_atomic.rs:352-355`
- **Existing:** None

## INV-CARN-008: Slippage Floor Uses Pre-Swap Reserves [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 7 (GAP: structural, no test)
- **Property:** Expected output computed from reserves read BEFORE swap CPI
- **Code:** `execute_carnage_atomic.rs:369-379`
- **Existing:** None

## INV-CARN-003: Fallback Floor Strictly Weaker Than Atomic [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 8
- **Property:** `CARNAGE_SLIPPAGE_BPS_FALLBACK < CARNAGE_SLIPPAGE_BPS_ATOMIC`
- **Code:** `constants.rs:127,132`
- **Existing:** Unit test (line 972)

## INV-CARN-009: User Swap 50% Floor (Tax Program) [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 9
- **Property:** `minimum_amount_out >= expected * 5000 / 10000 OR revert`
- **Code:** `tax_math.rs:135`
- **Existing:** Unit tests

## INV-CARN-010: Slippage BPS Overflow Safety [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 10
- **Property:** No overflow in u128 intermediates for slippage computation
- **Code:** `execute_carnage_atomic.rs:423-433`
- **Existing:** Unit test (line 983)

## INV-CARN-006: Pool Reserve Reader Correctness [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 11 (GAP: 3 independent copies, no shared code)
- **Property:** Correctly reads bytes [137-145] and [145-153], swaps for canonical ordering
- **Code:** `execute_carnage_atomic.rs:930`, `execute_carnage.rs:863`, `pool_reader.rs:39`
- **Existing:** None

## INV-CARN-011: Carnage Expected Output Excludes LP Fee [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 12 (documents design choice)
- **Property:** Expected is raw constant-product (no LP fee deduction), effective tolerance ~16%
- **Code:** `execute_carnage_atomic.rs:423-428`
- **Existing:** None

## INV-CARN-007: Slippage Floor Skipped for Empty Pools [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 13
- **Property:** If reserve_sol == 0 OR reserve_token == 0, skip slippage check
- **Code:** `execute_carnage_atomic.rs:422`
- **Existing:** None

## INV-CARN-014: Sell Path Has No Slippage Floor [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 14 (design gap -- DoS not theft)
- **Property:** Sell step relies on AMM-level floor only; manipulation causes rejection not extraction
- **Code:** `execute_carnage_atomic.rs:289-331`
- **Existing:** None -- document as accepted risk
