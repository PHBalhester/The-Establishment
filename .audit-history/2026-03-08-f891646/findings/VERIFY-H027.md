# Verification: H027 - No padding on state accounts

**Original Severity:** INFO (RECURRENT)
**Verification Status:** PARTIALLY FIXED
**Last Verified:** 2026-03-09

## Changes Found

1. **EpochState**: 64-byte `reserved` padding added at `programs/epoch-program/src/state/epoch_state.rs` and mirrored in `programs/tax-program/src/state/epoch_state_reader.rs`. This is the uniquely impacted account due to cross-program deserialization.

2. **Other state accounts checked** — no padding added since last verification:
   - `CarnageFundState`: No reserved padding.
   - `PoolState` (AMM): No reserved padding.
   - `StakePool` / `UserStake` (Staking): No reserved padding.
   - `CurveState` (Bonding Curve): No reserved padding.
   - `VaultConfig` (Conversion Vault): No reserved padding.

## Verification Analysis

No changes since last verification. Status remains PARTIALLY FIXED.

The original finding flagged EpochState as "uniquely impacted" because it is the only state account deserialized cross-program (Tax Program reads Epoch Program's EpochState). This specific case has been fully addressed with 64 bytes of reserved padding.

Other state accounts do not have reserved padding, but this is acceptable because:
- Single-program state accounts can be migrated via realloc if needed
- Cross-program mirrors are the dangerous case (silent corruption on layout change)
- Only EpochState has a cross-program mirror

The fix correctly prioritized the high-risk case. Adding padding to all state accounts would be defense-in-depth but is not strictly necessary for accounts only read by their own program.

## Regression Check

- No regressions. The reserved padding is properly zeroed and accounted for in all size calculations.
