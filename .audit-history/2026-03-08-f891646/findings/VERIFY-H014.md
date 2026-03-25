# Verification: H014 - Buy path 50% output floor

**Original Severity:** LOW
**Verification Status:** NOT_FIXED (Unchanged - Monitoring for Mainnet)

## Changes Found

`MINIMUM_OUTPUT_FLOOR_BPS` remains at `5000` (50%) in `programs/tax-program/src/constants.rs` (line 40). The constant is used identically in both:
- `swap_sol_buy.rs` (line 106): `calculate_output_floor(sol_reserve, token_reserve, sol_to_swap, MINIMUM_OUTPUT_FLOOR_BPS)`
- `swap_sol_sell.rs` (line 113): `calculate_output_floor(token_reserve, sol_reserve, amount_in, MINIMUM_OUTPUT_FLOOR_BPS)`

The accompanying comment (lines 32-39) explains the rationale: "Only bots/sandwich attackers set slippage below 50% of expected output."

## Verification Analysis

The 50% floor has not been tightened. The original finding recommended considering tightening for mainnet, and the comment at the constant definition references Phase 49 CONTEXT.md (SEC-10) as the source decision.

The floor is symmetric between buy and sell paths, both using the same `MINIMUM_OUTPUT_FLOOR_BPS` constant. Frontend default slippage (1-3%) is a client-side concern and was not verified here.

## Regression Check

No regression. The floor calculation logic in `tax_math::calculate_output_floor` is unchanged. Both swap paths apply the floor consistently.
