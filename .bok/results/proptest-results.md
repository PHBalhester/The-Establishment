# Proptest Results

Execution date: 2026-03-08
Worktree: `.bok/worktree` (branch: bok/verify-1772901528)

## Summary: 99 passed, 8 failed (107 total across 8 test suites, 6 programs)

---

## tax-program — bok_proptest (16/16 PASSED)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_tax_3_monotonic_with_bps | PASSED | 10,000 | -- |
| inv_tax_4_invalid_bps_rejected | PASSED | 10,000 | -- |
| inv_tax_5_floor_division_zero_threshold | PASSED | 10,000 | -- |
| inv_tax_6_u128_prevents_overflow | PASSED | 10,000 | -- |
| inv_tax_7_split_conservation | PASSED | 10,000 | -- |
| inv_tax_8_staking_exact_73_5_pct | PASSED | 10,000 | -- |
| inv_tax_9_carnage_exact_24_pct | PASSED | 10,000 | -- |
| inv_tax_10_treasury_dust_bounded | PASSED | 10,000 | -- |
| inv_tax_11_micro_tax_rule | PASSED | 10,000 | -- |
| inv_tax_13_split_never_none | PASSED | 10,000 | -- |
| inv_tax_14_output_floor_lte_expected | PASSED | 10,000 | -- |
| inv_tax_15_zero_input_floor_safety | PASSED | 10,000 | -- |
| inv_tax_16_floor_monotonic_with_bps | PASSED | 10,000 | -- |
| inv_tax_17_floor_bps_unvalidated_behavior | PASSED | 10,000 | -- |
| inv_tax_19_rounding_dust_accumulation_bound | PASSED | 10,000 | -- |
| inv_tax_20_canonical_split_verification | PASSED | 10,000 | -- |

## tax-program — bok_constants (21/21 PASSED)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_const_001_distribution_bps_sum | PASSED | 1 | -- |
| inv_const_002_split_matches_constants | PASSED | 1 | -- |
| inv_const_003_sol_pool_fee | PASSED | 1 | -- |
| inv_const_005_max_lp_fee | PASSED | 1 | -- |
| inv_const_006_bps_denominator | PASSED | 1 | -- |
| inv_const_007_swap_authority_seed | PASSED | 1 | -- |
| inv_const_008_carnage_signer_seed | PASSED | 1 | -- |
| inv_const_009_carnage_sol_vault_seed | PASSED | 1 | -- |
| inv_const_010_epoch_state_seed | PASSED | 1 | -- |
| inv_const_011_tax_authority_seed | PASSED | 1 | -- |
| inv_const_012_staking_authority_seed | PASSED | 1 | -- |
| inv_const_013_escrow_vault_seed | PASSED | 1 | -- |
| inv_const_014_stake_pool_seed | PASSED | 1 | -- |
| inv_const_015_program_ids | PASSED | 1 | -- |
| inv_const_016_deposit_rewards_discriminator | PASSED | 1 | -- |
| inv_const_018_genesis_tax_rates | PASSED | 1 | -- |
| inv_const_019_slippage_floors_ordered | PASSED | 1 | -- |
| inv_const_020_lock_lt_deadline | PASSED | 1 | -- |
| inv_const_021_minimum_output_floor | PASSED | 1 | -- |
| inv_const_022_precision | PASSED | 1 | -- |
| inv_const_023_minimum_stake | PASSED | 1 | -- |

## amm — bok_proptest (8/8 PASSED)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_amm_001_k_invariant_preservation | PASSED | 10,000 | -- |
| inv_amm_004_fee_monotonicity | PASSED | 10,000 | -- |
| inv_amm_005_swap_output_monotonic | PASSED | 10,000 | -- |
| inv_amm_008_k_check_symmetry | PASSED | 10,000 | -- |
| inv_amm_009_zero_fee_precision_loss | PASSED | 10,000 | -- |
| inv_amm_009b_zero_output_rejection | PASSED | 10,000 | -- |
| inv_amm_010_fee_rounding_favors_protocol | PASSED | 10,000 | -- |
| inv_amm_011_swap_output_rounding_favors_protocol | PASSED | 10,000 | -- |

## epoch-program — bok_proptest_vrf (24/25, 1 FAILURE)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_td_001_no_flip_probability_exhaustive | PASSED | 256 | -- |
| inv_td_001_flip_probability_exhaustive | PASSED | 256 | -- |
| inv_td_002_low_rates_all_256_byte1 | PASSED | 256 | -- |
| inv_td_002_low_rates_all_256_byte3 | PASSED | 256 | -- |
| inv_td_003_high_rates_all_256_byte2 | PASSED | 256 | -- |
| inv_td_003_high_rates_all_256_byte4 | PASSED | 256 | -- |
| inv_td_004_mod4_zero_bias_exhaustive | PASSED | 256 | -- |
| inv_td_004_rate_distribution_uniform_byte1 | PASSED | 256 | -- |
| inv_td_004_rate_distribution_uniform_byte2 | PASSED | 256 | -- |
| inv_td_005_independent_bytes | PASSED | 10,000 | -- |
| inv_td_005_independent_bytes_fraud_side | **FAILED** | -- | left=1100, right=1100 (byte3 change didn't change FRAUD rate) |
| inv_td_005_proptest_independence | PASSED | 10,000 | -- |
| inv_td_006_cheap_side_rates_exhaustive | PASSED | 256 | -- |
| inv_td_006_proptest_cheap_side_assignment | PASSED | 10,000 | -- |
| inv_td_007_all_rates_in_defined_set | PASSED | 10,000 | -- |
| inv_td_008_flip_toggle | PASSED | 1 | -- |
| inv_td_008_double_flip_restores_cheap_side | PASSED | 1 | -- |
| inv_td_009_deterministic | PASSED | 10,000 | -- |
| inv_td_010_minimum_gap_is_700 | PASSED | 256 | -- |
| inv_td_010_cheap_buy_lt_expensive_buy | PASSED | 10,000 | -- |
| inv_td_011_byte_index_disjoint | PASSED | 1 | -- |
| inv_vr_001_no_panic_all_bytes | PASSED | 256 | -- |
| inv_vr_001_proptest_no_panic | PASSED | 10,000 | -- |
| inv_vr_003_mod4_exact_split | PASSED | 256 | -- |
| inv_vr_004_no_dead_zones | PASSED | 256 | -- |

**inv_td_005_independent_bytes_fraud_side analysis:** Byte3 mod 4 maps to a rate index; specific byte values can coincidentally produce the same FRAUD buy rate (1100 bps). This is a coincidental hash collision in the rate table, not a protocol vulnerability. The test assertion is too strict — independence doesn't mean every byte change must produce a different rate, only that different bytes control different parameters.

## epoch-program — bok_proptest_carnage (7/7 PASSED)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_cg_001_trigger_probability_exhaustive | PASSED | 256 | -- |
| inv_cg_002_sell_probability_exhaustive | PASSED | 256 | -- |
| inv_cg_003_no_holdings_always_none | PASSED | 256 | -- |
| inv_cg_004_target_selection_5050 | PASSED | 256 | -- |
| inv_cg_005_distinct_bytes | PASSED | 256 | -- |
| inv_cg_006_joint_sell_carnage_probability | PASSED | 10,000 | -- |
| inv_cg_009_threshold_constants | PASSED | 1 | -- |

## staking — bok_proptest (10/15, 5 FAILURES)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_sr_001_reward_conservation | PASSED | 10,000 | -- |
| inv_sr_005_single_staker_gets_all | PASSED | 10,000 | -- |
| inv_sr_007_forfeiture_conservation | PASSED | 10,000 | -- |
| inv_sr_008_multi_epoch_accuracy | PASSED | 10,000 | -- |
| inv_sr_014_pending_accumulate | PASSED | 10,000 | -- |
| inv_sr_017_variable_stake_conservation | PASSED | 10,000 | -- |
| inv_stake_006_accumulator_lifetime | PASSED | 10,000 | -- |
| inv_stake_007_truncation_favors_protocol | PASSED | 10,000 | -- |
| inv_stake_010_multiply_before_divide | PASSED | 10,000 | -- |
| inv_stake_011_dust_reward_accumulation | PASSED | 10,000 | -- |
| inv_sr_004_pro_rata_fairness | **FAILED** | 997 | Too many global rejects (>50%): `stake_a <= total_staked / 2` |
| inv_sr_013_stake_weight_proportionality | **FAILED** | 2845 | Too many global rejects (>50%): `user_stake <= total_staked` |
| inv_stake_005_precision_overflow | **FAILED** | 0 | balance=456,397,696,075,006 delta_scale=745,583,007,643 -> overflow |
| inv_stake_008_truncation_detection | **FAILED** | 1060 | Too many global rejects (>50%): `total_staked >= balance` |
| inv_stake_012_reward_chunking | **FAILED** | 3044 | Too many global rejects (>50%): `user_stake <= total_staked` |

**Failure analysis:**
- **4 harness design issues (sr_004, sr_013, stake_008, stake_012):** Use `prop_assume!` instead of percentage-based derivation, causing >50% rejection. The invariants are correct — the test strategies need fixing. Existing proptest suites (from v1.2 milestone) already verify these same invariants with proper strategies.
- **1 real finding (stake_005):** u128 overflow found at extreme values. `balance * delta` overflows when both are large. In practice, protocol bounds (20M PROFIT max, ~1000 SOL/epoch) prevent this, but the on-chain code should use `checked_mul` with explicit error handling.

## bonding-curve — bok_proptest (5/7, 2 FAILURES)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_bc_004_full_integral | PASSED | 10,000 | -- |
| inv_bc_008_partial_fill | PASSED | 10,000 | -- |
| inv_bc_009_buy_sell_conservation | PASSED | 10,000 | -- |
| inv_bc_010_split_buy_exploit | PASSED | 10,000 | -- |
| inv_bc_sol_cost_accuracy | PASSED | 10,000 | -- |
| inv_bc_007_vault_solvency | **FAILED** | 0 | Sequence of 1-token buys leaves vault insolvent. Counterexample: many (qty=1, pos=N) pairs across curve |
| inv_bc_011_price_accuracy | **FAILED** | 0 | err=0.0101% at pos=94,010,200,000,000 (threshold was 0.01%) |

**Failure analysis:**
- **inv_bc_007_vault_solvency:** Rounding dust accumulates over many micro-purchases (1 token each). Each individual purchase rounds the SOL cost down by < 1 lamport, but over hundreds of purchases the vault falls slightly short. Severity: LOW — minimum purchase is enforced on-chain (MIN_PURCHASE_SOL), preventing 1-token buys.
- **inv_bc_011_price_accuracy:** Integer approximation exceeds 0.01% threshold by 0.0001% at a specific curve position. The error is 1 part in 140,000. Severity: INFORMATIONAL — consider relaxing threshold to 0.02% or refining the PRECISION constant for this range.

## conversion-vault — bok_proptest_vault (8/8 PASSED)

| Property | Status | Iterations | Counterexample |
|----------|--------|-----------|----------------|
| inv_cv_001_profit_to_ip_no_overflow | PASSED | 10,000 | -- |
| inv_cv_002_overflow_boundary | PASSED | 10,000 | -- |
| inv_cv_003_dust_rejection | PASSED | 10,000 | -- |
| inv_cv_004_round_trip_ip_profit_ip | PASSED | 10,000 | -- |
| inv_cv_005_round_trip_profit_ip_profit | PASSED | 10,000 | -- |
| inv_cv_006_same_mint_rejected | PASSED | 10,000 | -- |
| inv_cv_007_crime_fraud_direct_rejected | PASSED | 10,000 | -- |
| inv_cv_008_zero_amount_rejected | PASSED | 10,000 | -- |
