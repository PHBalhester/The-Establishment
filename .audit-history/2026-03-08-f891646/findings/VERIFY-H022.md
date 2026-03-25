# Verification: H022 - PoolState byte offsets / INIT_SPACE comment

**Original Severity:** INFO
**Verification Status:** FIXED
**Last Verified:** 2026-03-12

## Changes Found

The comment in `programs/amm/src/state/pool.rs` (line 34) has been updated to:

```
= 8 + 216 = 224 bytes total (216 INIT_SPACE).
```

This now correctly reflects the actual struct size (216 bytes INIT_SPACE + 8-byte discriminator = 224 bytes total).

## Verification Analysis

The comment now matches the actual struct layout. `#[derive(InitSpace)]` continues to auto-compute the correct space, and the comment is now consistent with the derived value.

## Regression Check

- No regression. Comment-only change with no functional impact.
