# Verification: H048 - taxes_confirmed unchecked by Tax Program

**Original Severity:** LOW
**Verification Status:** NOT_FIXED (By Design - Intentional)

## Changes Found

The Tax Program's `swap_sol_buy.rs` and `swap_sol_sell.rs` do not check the `taxes_confirmed` field from EpochState. They read EpochState for tax rates (`epoch_state.get_tax_bps()`) but do not gate on `taxes_confirmed`.

The `taxes_confirmed` field continues to exist in:
- `programs/epoch-program/src/state/epoch_state.rs` (line 113)
- `programs/tax-program/src/state/epoch_state_reader.rs` (line 41)

It is set to `true` by `consume_randomness` (line 220) and `false` by `trigger_epoch_transition` (line 192).

## Verification Analysis

This was marked as intentional design in the original finding. The rationale:
- VRF window is 1-2 slots (~0.8s), extremely narrow
- Stale tax rates are bounded between 1-14% (not zero or 100%)
- Adding a `taxes_confirmed` gate would block all swaps during VRF resolution, hurting UX more than the bounded staleness risk

The Tax Program reads the current tax_bps from EpochState regardless of confirmation status. This is the correct behavior per the design decision.

## Regression Check

No regression. The EpochState lifecycle (trigger_epoch_transition sets `taxes_confirmed=false`, consume_randomness sets it `true`) remains unchanged. Tax rate bounds have not been altered.
