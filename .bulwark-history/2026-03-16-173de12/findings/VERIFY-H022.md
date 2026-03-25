# Verification: H022
**Status:** FIXED
**Evidence:** The sell path in `programs/tax-program/src/instructions/swap_sol_sell.rs` now computes a proper AMM minimum output instead of hardcoding 0. Specifically:

1. **Output floor enforcement** (lines 112-118): Before the AMM CPI, the handler reads pool reserves via `read_pool_reserves()`, computes `output_floor` using `calculate_output_floor(token_reserve, sol_reserve, amount_in, MINIMUM_OUTPUT_FLOOR_BPS)` where `MINIMUM_OUTPUT_FLOOR_BPS = 5000` (50%), and requires `minimum_output >= output_floor`. This rejects any sell where the user's stated minimum is unreasonably low.

2. **Computed gross floor for AMM CPI** (lines 150-167): The handler computes `gross_floor = ceil(minimum_output * 10000 / (10000 - tax_bps))` which accounts for tax deduction. This value is passed as `amm_minimum` in the AMM CPI instruction data (line 174), replacing the previous hardcoded `0`.

3. **Post-CPI slippage check** (line 265): After the AMM executes, `net_output >= minimum_output` is enforced, where `net_output = gross_output - tax_amount`.

The buy path (`swap_sol_buy.rs:106`) has the same floor enforcement pattern.

**Completeness:** Fully addressed. Both pre-CPI floor validation and computed AMM minimum output are implemented. The 50% floor prevents extreme sandwich extraction, and the gross_floor calculation ensures the AMM enforces a meaningful minimum.
