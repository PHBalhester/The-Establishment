# VERIFY-H104: EpochState Layout Coupling Between Programs
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

Commit `e72d097` ("test(89-01): cross-crate EpochState serialization round-trip (S007)") added a dedicated cross-crate test at `tests/cross-crate/src/lib.rs` (167 lines) with three test functions:

1. **`epoch_to_tax_round_trip`** — Serializes an `epoch_program::EpochState`, deserializes it as `tax_program::EpochState`, and asserts all 21 fields match.
2. **`tax_to_epoch_round_trip`** — Serializes a `tax_program::EpochState`, deserializes it as `epoch_program::EpochState`, and asserts key fields match.
3. **`byte_length_parity`** — Asserts both structs serialize to identical byte lengths AND identical bytes.

The test imports both `epoch_program` and `tax_program` crates directly (via `Cargo.toml` workspace dependencies), so any field reordering, type change, or added/removed field in either struct will cause a compile error or assertion failure.

## Assessment

The cross-crate round-trip test fully addresses the layout coupling concern. If either program's `EpochState` struct diverges from the other, CI will catch it before deployment. The byte-level parity check (test 3) is particularly strong — it detects not just field-level mismatches but also padding or serialization order differences.

**Verdict:** Fixed. Cross-crate serialization round-trip tests provide compile-time and runtime detection of layout drift between epoch-program and tax-program EpochState definitions.
