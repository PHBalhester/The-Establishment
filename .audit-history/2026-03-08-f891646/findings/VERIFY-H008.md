# Verification: H008 - Sell Path AMM minimum_amount_out=0

**Original Severity:** HIGH (RECURRENT)
**Verification Status:** NOT_FIXED (partially mitigated; residual sandwich risk remains within documented bounds)

## Changes Found

### Carnage hotfix (carnage_execution.rs, carnage-flow.ts)
The recent hotfix exclusively modifies `partition_hook_accounts` — the logic that selects which slice of `remaining_accounts` is forwarded to each Transfer Hook CPI for the atomic vs. fallback execution paths. It touches no slippage logic, no `minimum_amount_out` fields, and no output floor computation. It is entirely orthogonal to this finding.

### swap_sol_sell.rs — prior partial mitigation (not the hotfix)
The original `minimum_amount_out = 0` hardcode was replaced at some prior point with a computed `gross_floor` (lines 151–167):

```rust
let gross_floor = if minimum_output > 0 && (tax_bps as u64) < bps_denom {
    // ceil( minimum_output * 10000 / (10000 - tax_bps) )
    ...
} else {
    0  // <-- falls through to zero when minimum_output == 0
};
let amm_minimum: u64 = gross_floor;
```

A pre-CPI protocol floor also exists (lines 112–118):

```rust
let output_floor = calculate_output_floor(
    token_reserve, sol_reserve, amount_in, MINIMUM_OUTPUT_FLOOR_BPS
).ok_or(...)?;
require!(minimum_output >= output_floor, TaxError::MinimumOutputFloorViolation);
```

`MINIMUM_OUTPUT_FLOOR_BPS = 5000` (`constants.rs:40`) — 50% of AMM-expected output.

## Verification Analysis

The original hardcoded `minimum_amount_out = 0` no longer exists for the common path. However the finding is **not fully remediated**:

1. **50% floor is the stated residual.** The original finding explicitly flagged the 50% floor as insufficient, noting it allows up to ~50% value extraction via sandwich. That assessment is unchanged. `MINIMUM_OUTPUT_FLOOR_BPS = 5000` means any sandwich extracting less than half the expected output passes the guard.

2. **`minimum_output = 0` edge case survives.** When a caller passes `minimum_output = 0`, the `if minimum_output > 0` guard short-circuits and `gross_floor = 0`, so `amm_minimum = 0`. The pre-CPI floor check (`require!(minimum_output >= output_floor)`) then requires `0 >= output_floor`. This only saves the transaction if `output_floor > 0`, which requires non-zero reserves and a non-trivial `amount_in`. With an empty or near-empty pool, `output_floor` may be 0 and the check passes with zero protection. The prior verification marked this as "acceptable (user explicitly accepting any output)" — but this is not acceptable for protocol-owned paths (Carnage's `swap_exempt` CPI).

3. **Carnage's swap path bypasses this file entirely.** `execute_swap_exempt_cpi` in `carnage_execution.rs` calls Tax's `swap_exempt` instruction, not `swap_sol_sell`. The floor logic in `swap_sol_sell.rs` does not apply to Carnage's internal swaps. Carnage's only slippage protection is the `slippage_bps` guard in `execute_carnage_core` (lines 331–349): 7500 BPS fallback, 8500 BPS atomic — also 25% and 15% sandwich windows respectively.

## Regression Check

The carnage hotfix (`partition_hook_accounts`, `carnage-flow.ts`) introduces **no regression** for this finding. Hook account partitioning is unrelated to output floors or `minimum_amount_out` values. The hotfix neither improves nor worsens the slippage protection on any swap path.
