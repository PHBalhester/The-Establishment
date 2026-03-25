# Verification: H077 - Unchecked as u64 Casts

**Original Severity:** LOW
**Verification Status:** FIXED

## Changes Found

### Production code: `programs/bonding_curve/src/math.rs`, line 236

The `calculate_refund()` function now uses `u64::try_from(result).ok()` instead of `as u64`:

```rust
let result = (user_balance as u128)
    .checked_mul(refund_pool as u128)?
    / (total_outstanding as u128);
u64::try_from(result).ok()
```

The function returns `Option<u64>`, so `.ok()` converts a `TryFromIntError` into `None`, which propagates as a safe failure to callers.

### On-chain instruction: `programs/bonding_curve/src/instructions/claim_refund.rs`, line 163

The on-chain `claim_refund` instruction also uses checked conversion:

```rust
let refund_amount = u64::try_from(refund_amount_u128)
    .map_err(|_| error!(CurveError::Overflow))?;
```

This returns a proper Anchor error instead of silently truncating.

### Test code

The `as u64` casts remaining in `math.rs` (lines 590, 615, 617, 641, 642, 673, 701, 703, etc.) are all within `#[cfg(test)] mod tests` -- proptest strategies and test assertions. These are not production code and pose no risk. The test values are derived from percentages of known constants (e.g., `TARGET_TOKENS * pct / 1_000_000`) which are mathematically guaranteed to fit in u64.

## Verification Analysis

The fix is correct and complete:

1. **Production `calculate_refund()`:** Returns `None` on overflow instead of truncating. Callers handle `None` as an error condition.
2. **On-chain `claim_refund`:** Returns `CurveError::Overflow` on conversion failure, preventing any truncated refund amount from being paid out.
3. **`get_current_price()` (line 211):** Uses `u64::try_from(price).unwrap_or(u64::MAX)` -- this is a display/query function where saturating to MAX is acceptable behavior (price would be astronomically high, > 18 quintillion lamports per token).
4. **No remaining unchecked `as u64` in production paths.** All production code paths use either `try_from` or operate on values mathematically bounded to fit in u64 (e.g., `as u128` upcasts followed by division that reduces the result).

## Regression Check

- No regressions identified.
- The `try_from` check adds negligible overhead (single comparison).
- Callers of `calculate_refund()` already handle `None` returns (the function signature was always `Option<u64>`), so no call-site changes were needed.
