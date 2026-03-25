# BOK Phase 0: Scan Report

**Date:** 2026-03-07 (re-scan)
**Previous scan:** 2026-02-22 (5 programs, 13 regions)
**Codebase:** Dr. Fraudsworth's Finance Factory (7 programs, ~35K LOC)
**Kani:** v0.67.0 (full formal verification available)
**GL Docs:** not found
**SOS Audit:** not found

---

## What Changed Since Last Scan

The v1.2 milestone added the **bonding_curve** program (7th on-chain program) with:
- Linear bonding curve math (`math.rs`) -- quadratic formula with u128 PRECISION scaling, `pow()` usage
- Purchase/sell instructions with partial fills, slippage, ceil-rounded tax, solvency assertion
- 13.5M proptest iterations already run during v1.2

The **conversion-vault** program was also not covered in the previous scan.

---

## Prerequisites

| Tool | Status | Version |
|------|--------|---------|
| **Kani** | INSTALLED | v0.67.0 |
| **LiteSVM** | Available | Used in existing tests |
| **Proptest** | Available | Already in use across all programs |

---

## Math Regions Indexed

### NEW -- Priority 1: CRITICAL (Bonding Curve Math)
**File:** `programs/bonding_curve/src/math.rs` (~400 lines)
**Functions:**
- `calculate_tokens_out(sol_amount, tokens_sold) -> Result<u64>` -- Quadratic formula with u128 PRECISION=1e12 scaling
- `calculate_sol_for_tokens(start_position, token_count) -> Result<u64>` -- Reverse integral (sell pricing). Must be exact inverse
- `get_current_price(tokens_sold) -> u64` -- Spot price at position

**Signal density:** 32 checked, 16 saturating, 95 casts, 44 unwrap, 5 pow -- **highest in codebase**
**Existing tests:** Extensive proptest suite (13.5M iterations during v1.2)
**Constants:** P_START=450, P_END=1725, TARGET_SOL=500, TOTAL_FOR_SALE=460T, PRECISION=1e12 (updated Phase 94.1)

**Invariants to verify:**
- `calculate_sol_for_tokens(x, calculate_tokens_out(sol, x))` round-trips correctly (no value creation)
- `calculate_tokens_out` is monotonically increasing with SOL input
- `calculate_sol_for_tokens` is monotonically increasing with token count
- Integral never exceeds TARGET_SOL (500 SOL) for full curve
- No overflow for any valid input combination within curve bounds
- Sell solvency: vault always holds enough SOL to cover reverse integral

**Why critical:** Direct financial impact -- incorrect curve pricing means wrong token amounts or wrong SOL charges. The quadratic solve and u128 intermediate math are the most complex arithmetic in the codebase.

---

### NEW -- Priority 1b: HIGH (Bonding Curve Instructions)
**Files:**
- `programs/bonding_curve/src/instructions/purchase.rs` (310 lines)
- `programs/bonding_curve/src/instructions/sell.rs` (320 lines)

**Key math regions:**
- **Purchase:** Wallet cap check, partial fill logic (min(tokens_out, remaining)), SOL recalculation for partial
- **Sell:** Reverse integral pricing, ceil-rounded 15% tax (`(sol_gross * 1500 + 9999) / 10000`), solvency assertion (vault >= integral(0, tokens_sold))

**Invariants to verify:**
- Ceil tax rounding: tax always >= floor, favors protocol
- Solvency: after sell, vault_balance >= expected_from_integral - rent_exempt
- Partial fill: actual_sol < original sol_amount when tokens_out > remaining
- No value creation: sol_raised tracks correctly across buy/sell sequences

---

### Priority 2: CRITICAL (AMM Swap Math) -- from previous scan
**File:** `programs/amm/src/helpers/math.rs` (497 lines)
**Functions:**
- `calculate_effective_input` -- LP fee via BPS
- `calculate_swap_output` -- Constant-product xy=k
- `verify_k_invariant` -- k_after >= k_before

**Existing:** 22 unit + 3 proptest (10K each)
**Previous BOK run:** 5 Kani proofs passed, 8 timeouts

---

### Priority 3: CRITICAL (Tax Distribution Math) -- from previous scan
**File:** `programs/tax-program/src/helpers/tax_math.rs` (515 lines)
**Functions:**
- `calculate_tax` -- BPS tax computation
- `split_distribution` -- 71/24/5 split (UPDATED from 75/24/1 since last scan)
- `calculate_output_floor` -- Slippage floor

**Existing:** 20 unit + 6 proptest (10K each)
**Note:** Split percentages changed since last BOK run (was 75/24/1, now 71/24/5)

---

### Priority 4: HIGH (Staking Reward Math) -- from previous scan
**File:** `programs/staking/src/helpers/math.rs` (735 lines)
**Functions:**
- `update_rewards` -- Synthetix cumulative pattern, u128 PRECISION=1e18
- `add_to_cumulative` -- Pro-rata reward distribution

**Existing:** 16 unit + 7 proptest (10K each)
**Previous BOK run:** Conservation and monotonicity stress-tested

---

### Priority 5: HIGH (Carnage Slippage) -- from previous scan
**File:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
**Key math:** 85% slippage floor, combined SOL capping, raw pool reserve reading

**Existing:** 4 unit tests

---

### Priority 6: MEDIUM (VRF Tax Derivation) -- from previous scan
**File:** `programs/epoch-program/src/helpers/tax_derivation.rs` (333 lines)
**Function:** `derive_taxes` -- VRF byte parsing to discrete rates
**Existing:** 12 exhaustive boundary tests

---

### Priority 7: MEDIUM (VRF Carnage Decisions) -- from previous scan
**File:** `programs/epoch-program/src/helpers/carnage.rs`
**Functions:** `is_carnage_triggered`, `get_carnage_action`, `get_carnage_target`
**Existing:** 10 exhaustive boundary tests

---

### NEW -- Priority 8: LOW (Conversion Vault)
**File:** `programs/conversion-vault/src/instructions/convert.rs` (174 lines)
**Functions:**
- `compute_output` / `compute_output_with_mints` -- Fixed 100:1 CRIME/FRAUD<->PROFIT rate

**Signal density:** 1 checked_mul
**Invariants:** PROFIT->IP multiply won't overflow u64 for realistic amounts. IP->PROFIT division produces 0 for amounts < 100.

---

### Priority 9: LOW (Constants Cross-Verification) -- from previous scan
**Files:** All `constants.rs` across 7 programs
**Check:** Cross-program seed matches, BPS sums, feature-gated program IDs

---

## NOT IN SCOPE (No Math)
- `programs/transfer-hook/` -- Whitelist check only
- `programs/stub-staking/` -- Test stub
- `programs/fake-tax-program/` -- Test stub
- `programs/mock-tax-program/` -- Test stub

---

## Existing Test Coverage

| Module | Proptest Cases | Properties |
|--------|---------------|------------|
| bonding_curve/math.rs | 13.5M iterations (v1.2) | Curve integral properties |
| staking/helpers/math.rs | 10K/prop x 7 props | No-panic, conservation, monotonicity, forfeiture, totals |
| amm/helpers/math.rs | 10K/prop x 3 props | k-invariant, output bounds, fee monotonicity |
| tax-program/helpers/tax_math.rs | 10K/prop x 6 props | No-overflow, invalid-bps, monotonicity, sum, staking %, micro-tax |
| epoch-program/execute_carnage_atomic.rs | 4 unit tests | Slippage floor arithmetic |

---

## New Verification Gaps (Delta from Previous Scan)

### Tier 1: Formal Proofs (Kani)
1. **Bonding curve round-trip:** `sol_for_tokens(x, tokens_out(sol, x)) <= sol` (no value creation)
2. **Bonding curve monotonicity:** More SOL in -> more tokens out (for fixed position)
3. **Bonding curve bounds:** Full integral from 0 to TOTAL_FOR_SALE produces ~500 SOL
4. **Bonding curve sell tax ceil:** ceil-rounded tax >= floor-rounded tax (always)
5. **Conversion vault overflow:** PROFIT->IP multiply stays within u64 for amount <= 20M PROFIT

### Tier 2: LiteSVM Runtime Tests
6. **Buy+sell solvency:** After N buy/sell sequences, vault always holds >= integral(0, tokens_sold)
7. **Partial fill SOL recalculation:** actual_sol <= original sol_amount (never overpay)
8. **Tax split change:** 71/24/5 invariant holds (updated from 75/24/1 in previous run)

### Tier 3: Proptest Gap-Fill
9. **Bonding curve buy+sell conservation:** buy then sell same tokens returns <= original SOL (after tax)
10. **Bonding curve partial fill boundary:** When remaining = 1 token, math still works
11. **Sell solvency with accumulated rounding:** After 10K random buy/sell, vault is solvent
12. **Updated AMM gaps from previous run:** fee+swap composition, extreme reserves

### From Previous Run (still open)
13-19. Carry forward 6 gaps from previous BOK run that were inconclusive/timed-out

---

## Summary Statistics

| Metric | Previous (Feb 22) | Current (Mar 7) |
|--------|-------------------|-----------------|
| Programs with math | 4 of 5 | 6 of 7 |
| Math regions | 13 | 21 |
| Existing unit tests | ~74 | ~96 |
| Existing proptest properties | 13 | 20 |
| Verification gaps | 13 | 19 |

**Previous BOK results:** 5 proven, 91 stress-tested, 1 failed, 8 inconclusive
**This run focus:** Bonding curve formal verification + re-verify updated tax split

**Next step:** Run `/BOK:analyze` to propose invariants for the new bonding curve regions and carry forward relevant invariants from the previous run.
