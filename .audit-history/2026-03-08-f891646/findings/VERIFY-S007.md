# Verification: S007 (HIGH-005) - No Cross-Program Layout Tests

**Original Severity:** HIGH
**Verification Status:** FIXED

## Changes Found

1. **New cross-crate test crate** (`tests/cross-crate/`): Commit `e72d097` adds a dedicated Rust test crate with `Cargo.toml` depending on both `epoch-program` (with `no-entrypoint`) and `tax-program` (with `no-entrypoint`, `localnet`). This is the workspace-level Rust test that was previously missing.

2. **Three complementary tests** in `tests/cross-crate/src/lib.rs` (167 lines):
   - `epoch_to_tax_round_trip`: Serializes epoch-program's `EpochState`, deserializes as tax-program's mirror, asserts all 22 fields match.
   - `tax_to_epoch_round_trip`: Serializes tax-program's mirror, deserializes as epoch-program's canonical struct, asserts key fields match (bidirectional proof).
   - `byte_length_parity`: Serializes both structs with identical inputs and asserts `epoch_buf == tax_buf` (exact byte-level equality).

3. **Pre-existing protections remain intact**:
   - Compile-time `assert!(EpochState::DATA_LEN == 164)` in both crates.
   - `#[repr(C)]` on both structs prevents compiler field reordering.
   - Runtime serialization offset test in `epoch-program/src/constants.rs`.

## Verification Analysis

The previous verification identified two unprotected scenarios:

- **Field reordering within the same total size**: Now caught by `byte_length_parity` which asserts exact byte equality across both serializations. Any field swap produces different byte sequences.
- **Type substitution with same-size type**: Now caught by the round-trip tests, which deserialize one crate's bytes through the other crate's struct and compare field values. A type mismatch (e.g., `u32` vs `[u8; 4]`) would produce incorrect field values.

All three tests compile and pass (`cargo test -p cross-crate-tests` -- 3 passed, 0 failed). The test crate correctly imports from both program crates, confirming genuine cross-crate validation.

This fully closes the gap identified in the original finding and the previous PARTIALLY_FIXED assessment.

## Regression Check

- No regressions. The new test crate is additive (test-only, `dev-dependencies` only).
- The `no-entrypoint` feature flag ensures no BPF entrypoint conflicts during native test compilation.
- Pre-existing compile-time assertions and `#[repr(C)]` annotations remain unchanged.
