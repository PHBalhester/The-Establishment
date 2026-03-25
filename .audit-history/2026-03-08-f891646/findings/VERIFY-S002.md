# Verification: S002 - Sell path gross minimum computation edge cases

**Original Severity:** INFO
**Verification Status:** CONFIRMED_CLEAR (No Regression)

## Changes Found

The sell path in `swap_sol_sell.rs` applies the `MINIMUM_OUTPUT_FLOOR_BPS` (5000 = 50%) check at line 113, using `calculate_output_floor(token_reserve, sol_reserve, amount_in, MINIMUM_OUTPUT_FLOOR_BPS)`. This validates the user's `minimum_output` against a protocol-enforced floor before the swap executes.

The `split_distribution` function in `tax_math.rs` handles edge cases:
- Amounts below `MICRO_TAX_THRESHOLD` (4 lamports): all tax goes to staking
- Treasury receives remainder (`total - staking - carnage`), ensuring exact sum conservation
- Proptest coverage (lines 475-510) validates the sum invariant across the full u64 range

The sell flow computes `net_output = gross_output - tax` and checks `net_output >= minimum_output` AFTER tax deduction, which is the correct ordering.

## Verification Analysis

The original finding was already cleared: "No edge cases with rounding at max tax rates." The `split_distribution` function's remainder-to-treasury pattern eliminates rounding loss. The proptest suite provides strong confidence across edge cases.

No new edge cases have been introduced. The sell path flow (AMM swap -> measure gross output -> calculate tax -> distribute -> check slippage on net) remains structurally sound.

## Regression Check

No regression. The sell path computation order is unchanged. The `calculate_output_floor` and `split_distribution` functions remain the same implementations verified in the original finding.
