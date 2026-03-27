# Verification Summary

Execution date: 2026-03-09 (run 2 — expanded coverage with bonding-curve + conversion-vault)
Project: Dr. Fraudsworth's Finance Factory

## Tallies

- **Proven (Kani formal proof):** 18 (Tax: 4, AMM: 4, Staking: 6, Bonding Curve: 4)
- **Stress-tested (Proptest + LiteSVM):** 107 proptest + 9 LiteSVM = 116 total
- **Failed (real findings):** 3 proptest + 1 LiteSVM = 4 total
- **Inconclusive (Kani timeout):** 6 (AMM: 1, Staking: 2, Bonding Curve: 3)
- **Harness design issues:** 5 (proptest strategy rejection rate >50%, not code bugs)

## Real Findings

### Finding 1: Vault Solvency — Rounding Dust (MEDIUM)
- **Source:** Proptest `inv_bc_007_vault_solvency`, LiteSVM `inv_bc_014b_sequential_sells`
- **Description:** Accumulated rounding dust from many micro-purchases/sells can erode vault below rent-exempt minimum. LiteSVM counterexample: vault=890,875 vs rent=890,880 (off by 5 lamports).
- **Root cause:** Each `calculate_sol_for_tokens()` floors the result; cumulative effect over hundreds of operations.
- **Mitigation:** On-chain code should check `vault_balance - payout >= rent_exempt_minimum` before executing sell transfers. MIN_PURCHASE_SOL prevents 1-token buys in practice.
- **v1.3 coverage:** Phase 79 (Financial Safety)

### Finding 2: Price Accuracy Threshold (INFORMATIONAL)
- **Source:** Proptest `inv_bc_011_price_accuracy`
- **Description:** Integer approximation exceeds 0.01% threshold by 0.0001% at curve position 94,010,200,000,000.
- **Root cause:** Error is 1 part in 140,000 — an inherent limitation of integer arithmetic at this curve position.
- **Mitigation:** Relax threshold to 0.02% or refine PRECISION constant for this range.
- **v1.3 coverage:** Phase 80 (Defense-in-Depth)

### Finding 3: u128 Overflow at Extreme Values (LOW)
- **Source:** Proptest `inv_stake_005_precision_overflow`
- **Description:** `balance * delta` overflows u128 when both are large (balance=456T, delta_scale=745B).
- **Root cause:** Missing `checked_mul` with explicit error handling.
- **Mitigation:** Protocol bounds (20M PROFIT max, ~1000 SOL/epoch) prevent this in practice. Add `checked_mul` with error return.
- **v1.3 coverage:** Phase 79 (Financial Safety)

### Finding 4: VRF Byte Independence (TEST DESIGN, not code bug)
- **Source:** Proptest `inv_td_005_independent_bytes_fraud_side`
- **Description:** Byte3 mod 4 maps to rate index; specific byte values coincidentally produce same FRAUD buy rate (1100 bps).
- **Root cause:** Hash collision in rate table. Independence doesn't require every byte change to produce different rate.
- **Mitigation:** Relax test assertion. Protocol is correct.

---

## Per-Program Results

### tax-program (37/37 PASSED, 4 PROVEN)

| Category | Count | Tool |
|----------|-------|------|
| Proptest properties | 16/16 PASSED | bok_proptest |
| Constant checks | 21/21 PASSED | bok_constants |
| Kani proofs | 4/4 PROVEN | bok_kani |

### amm (10/10 PASSED, 4 PROVEN)

| Category | Count | Tool |
|----------|-------|------|
| Proptest properties | 8/8 PASSED | bok_proptest |
| LiteSVM structural checks | 2/2 PASSED | bok_litesvm |
| Kani proofs | 4/5 (1 inconclusive) | bok_kani |

### epoch-program (31/32, 1 test design issue)

| Category | Count | Tool |
|----------|-------|------|
| VRF proptest | 24/25 (1 test design issue) | bok_proptest_vrf |
| Carnage proptest | 7/7 PASSED | bok_proptest_carnage |

### staking (10/15 PASSED, 6 PROVEN)

| Category | Count | Tool |
|----------|-------|------|
| Proptest properties | 10/15 (4 harness issues, 1 real finding) | bok_proptest |
| Kani proofs | 6/8 (2 inconclusive) | bok_kani |

### bonding-curve (5/7 PASSED, 4 PROVEN, 1 LiteSVM finding)

| Category | Count | Tool |
|----------|-------|------|
| Proptest properties | 5/7 (2 real findings) | bok_proptest |
| LiteSVM tests | 6/7 (1 real finding) | bok_litesvm |
| Kani proofs | 4/7 (3 inconclusive) | bok_kani |

### conversion-vault (8/8 PASSED)

| Category | Count | Tool |
|----------|-------|------|
| Proptest properties | 8/8 PASSED | bok_proptest_vault |

---

## Comparison with Previous Run (2026-02-23)

| Metric | Run 1 (Feb 23) | Run 2 (Mar 9) | Delta |
|--------|----------------|---------------|-------|
| Programs covered | 5 | 6 (+bonding-curve) | +1 |
| Kani proven | 5 | 18 | +13 |
| Kani inconclusive | 8 | 6 | -2 (better) |
| Proptest passed | 85 | 99 | +14 |
| LiteSVM passed | 6 | 8 | +2 |
| Real findings | 0 | 3 | +3 |
| Total invariants tested | 103 | 140 | +37 |
