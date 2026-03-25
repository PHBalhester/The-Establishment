# Verification: S008 - Pool AccountInfo Missing Owner Check

**Original Severity:** INFO (Supplemental)
**Verification Status:** FIXED

## Changes Found

File: `programs/tax-program/src/helpers/pool_reader.rs`, lines 57-64

The `read_pool_reserves()` function now performs an explicit owner verification (labeled DEF-01):

```rust
require!(
    *pool_info.owner == amm_program_id(),
    TaxError::InvalidPoolOwner
);
```

This check runs before any byte reads from the account data, ensuring only accounts owned by the AMM program can supply reserve data.

Additionally, the function includes `is_reversed` detection (DEF-02, lines 72-96):
- Reads `mint_a` from bytes [9..41]
- Compares against `NATIVE_MINT` to determine canonical ordering
- Returns `(sol_reserve, token_reserve)` in normalized order regardless of AMM storage layout

## Verification Analysis

The fix is correct and complete:

1. **Owner check placement:** Runs before `data.borrow()`, preventing any reads from untrusted account data.
2. **Uses `amm_program_id()`:** The same constant used throughout the Tax Program for AMM program validation, ensuring consistency.
3. **Error type:** `TaxError::InvalidPoolOwner` is a distinct error variant, providing clear diagnostics.
4. **Defense-in-depth value:** While the same pool AccountInfo is passed to the AMM CPI (which would reject a fake pool), the owner check prevents the Tax Program's slippage floor calculation from being manipulated by a spoofed pool account with fake reserves. An attacker could theoretically craft a fake pool that passes the AMM CPI (if the AMM has a vulnerability) but would now be blocked here.

## Regression Check

- No regressions identified.
- The owner check is a single comparison, negligible compute cost.
- Both `swap_sol_buy.rs` and `swap_sol_sell.rs` call `read_pool_reserves()`, so both paths benefit from this fix.
