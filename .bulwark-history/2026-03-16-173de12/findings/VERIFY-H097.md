# VERIFY-H097: Graduation Irreversibility
**Status:** ACCEPTED_RISK
**Round:** 3
**Date:** 2026-03-12

## Evidence

The `CurveStatus` enum in `programs/bonding_curve/src/state.rs` defines five states with a one-way state machine:

```
Initialized -> Active -> Filled -> Graduated (terminal)
                      -> Failed (terminal)
```

`Graduated` and `Failed` are documented as terminal states (line 52). There is no instruction, no `ungraduate` or `reverse_graduation` handler anywhere in the bonding_curve program. The only instruction that sets `Graduated` is `prepare_transition` (admin-only, line 92 of `lib.rs`), which transitions both curves from `Filled` to `Graduated`.

Grepping for `ungraduate`, `revert.*graduat`, `reverse.*graduat` across the entire bonding_curve program returns zero matches — no reversal path exists in code.

## Assessment

This is a deliberate, documented design decision. Graduation is an irreversible admin-only action that transitions bonding curves into AMM pools. Reversing graduation would require unwinding pool liquidity, which would break all existing pool positions and create an inconsistent protocol state. The `Failed` state with refund eligibility already provides the safety valve for curves that should not graduate.

**Verdict:** Accepted risk — irreversibility is the correct design for bonding curve graduation. No code change needed.
