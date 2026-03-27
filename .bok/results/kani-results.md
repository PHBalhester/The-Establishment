# Kani Formal Verification Results

Execution date: 2026-03-09 (individual harness runs with 5-min timeout, after initial 35-hour batch)
Worktree: `.bok/worktree` (branch: bok/verify-1772901528)
Kani version: 0.67.0, CBMC 6.8.0, SAT solver: CaDiCaL 2.0.0

## Summary: 18 PROVEN, 6 INCONCLUSIVE (SAT solver timeout), 0 failures

Note: All harnesses use `kani::any::<u32>() as u64` symbolic inputs (exhaustive over 4+ billion values per variable). Original u64 harnesses exceeded SAT solver capacity entirely.

---

## tax-program — bok_kani (4/4 PROVEN)

| Harness | Status | Time | Notes |
|---------|--------|------|-------|
| inv_tax_001_floor_lte_input | PROVEN | <1s | Floor division never exceeds input |
| inv_tax_002_u128_no_overflow | PROVEN | <1s | u128 intermediate arithmetic safe |
| inv_tax_012_split_conservation | PROVEN | 2s | Tax split components sum correctly |
| inv_tax_018_zero_input_safe | PROVEN | <1s | Zero-amount inputs handled safely |

## amm — bok_kani (4/5 PROVEN, 1 INCONCLUSIVE)

| Harness | Status | Time | Notes |
|---------|--------|------|-------|
| inv_amm_002_output_bounded_by_reserve | **INCONCLUSIVE** | >35 hrs | Full CPMM formula with chained u128 mul→div exceeds solver capacity |
| inv_amm_003_fee_never_exceeds_principal | PROVEN | <60s | Fee deduction always ≤ input amount |
| inv_amm_006_zero_input_zero_output | PROVEN | <10s | Zero input produces zero output |
| inv_amm_007_u128_no_overflow_fee_calc | PROVEN | <60s | Fee calculation u128 intermediates safe |
| inv_amm_007_u128_no_overflow_swap_calc | PROVEN | <60s | Swap calculation u128 intermediates safe |

## staking — bok_kani (6/8 PROVEN, 2 INCONCLUSIVE)

| Harness | Status | Time | Notes |
|---------|--------|------|-------|
| inv_sr_002_cumulative_monotonicity | PROVEN | <60s | Cumulative reward index never decreases |
| inv_sr_003_no_panic_add_to_cumulative | PROVEN | <10s | add_to_cumulative never panics |
| inv_sr_003_no_panic_update_rewards | PROVEN | <10s | update_rewards never panics |
| inv_sr_006_zero_reward_epoch | PROVEN | <10s | Zero pending → zero reward_per_token |
| inv_sr_009_precision_delta_non_negative | **INCONCLUSIVE** | >5 min | Accumulator precision math exceeds solver capacity |
| inv_sr_012_u128_no_overflow_add_to_cumulative | PROVEN | <60s | pending * PRECISION safe in u128 |
| inv_sr_012_u128_no_overflow_update_rewards | PROVEN | <60s | balance * reward_delta safe in u128 |
| inv_sr_018_precision_loss_bounded | **INCONCLUSIVE** | >5 min | Double-floor precision bounding (≤2 lamports) involves 3 chained u128 divisions |

## bonding-curve — bok_kani (4/7 PROVEN, 3 INCONCLUSIVE)

| Harness | Status | Time | Notes |
|---------|--------|------|-------|
| inv_bc_001_round_trip_value_non_creation | **INCONCLUSIVE** | >5 min | Round-trip buy→sell involves two full integral evaluations |
| inv_bc_002_price_monotonicity | PROVEN | <60s | Price increases monotonically along curve |
| inv_bc_003_input_monotonicity | **INCONCLUSIVE** | >35 hrs | Two integral evaluations for monotonicity (8.2GB peak RAM) |
| inv_bc_005_sell_tax_ceil_gte_floor | **INCONCLUSIVE** | >5 min | Ceil vs floor comparison with full curve arithmetic |
| inv_bc_006_sell_tax_no_overflow | PROVEN | <60s | Sell tax u128 intermediates safe |
| inv_bc_012_precision_no_overflow | PROVEN | <60s | Precision constant arithmetic safe |
| inv_bc_013_wallet_cap_not_bypassed_partial_fill | PROVEN | <60s | Partial fill respects wallet cap |

---

## Inconclusive Analysis

All 6 INCONCLUSIVE harnesses share the same root cause: **chained u128 arithmetic creates SAT formulas that exceed CaDiCaL's solving capacity**, even with u32 symbolic inputs (~4 billion values per variable).

Pattern:
- **Simple properties** (single multiply, overflow check, zero-input) → prove in seconds to minutes
- **Chained u128 operations** (mul→div→mul, two integral evaluations) → solver cannot converge

All 6 properties are validated by **proptest (10,000 random iterations each, all passing)**. The INCONCLUSIVE status means "we could not formally prove this for ALL inputs" — it does NOT mean the properties are false.

### Improvement Options (Future)
1. **Tighter variable bounds** — restrict to realistic protocol ranges (e.g., max 20M tokens, max 1000 SOL)
2. **Decomposed proofs** — prove sub-steps independently rather than full pipeline
3. **Alternative solver** — Bitwuzla or Z3 may handle u128 bit-vector arithmetic better than CaDiCaL
4. **Reduced precision** — prove at u16 (65K values) for the complex formulas
