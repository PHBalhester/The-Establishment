# Verification: H011 - EpochState cross-program layout corruption

**Original Severity:** MEDIUM
**Verification Status:** FIXED

## Changes Found

1. **Reserved padding added** (commit 5344657): `programs/epoch-program/src/state/epoch_state.rs` now includes `pub reserved: [u8; 64]` at line 152, clearly marked as "DEF-03" for future schema evolution.

2. **DATA_LEN static assertion** (DEF-08): Both files enforce `DATA_LEN == 164` via compile-time `const _: () = assert!(...)`:
   - `programs/epoch-program/src/state/epoch_state.rs` line 187
   - `programs/tax-program/src/state/epoch_state_reader.rs` line 64

3. **Mirror struct updated** (commit fca96b1): `epoch_state_reader.rs` now includes identical `reserved: [u8; 64]` field and matching `DATA_LEN` constant (164 bytes). Both structs use `#[repr(C)]`.

4. **Serialization layout test**: `programs/epoch-program/src/constants.rs` (line ~360-420) contains a comprehensive test that serializes a known EpochState, asserts `buf.len() == DATA_LEN`, and spot-checks byte offsets for every field group.

## Verification Analysis

The fix is complete and robust:

- **Compile-time parity**: Both structs independently compute `DATA_LEN` as the same arithmetic expression (`8 + 4 + 8 + 1 + 2 + 2 + ... + 64 + 1 + 1`). The static assertion `const _: () = assert!(EpochState::DATA_LEN == 164)` in both files guarantees any field addition/removal triggers a compile error.
- **Field-by-field match**: The mirror struct in `epoch_state_reader.rs` has identical fields in identical order with identical types, including the 64-byte reserved padding.
- **`#[repr(C)]`**: Both structs use `#[repr(C)]` to prevent Rust from reordering fields, ensuring byte-level layout compatibility.
- **Runtime verification**: The serialization test in epoch-program constants.rs verifies actual byte offsets at runtime (cargo test), catching any drift that the static assertion might miss.

**Limitation**: The compile-time assertion verifies total size parity, not field-by-field layout. If a field were replaced with another of the same size but different type, the assertion would pass. The runtime serialization test partially addresses this, but it only exists in the epoch-program, not as a cross-crate workspace test.

## Regression Check

- No regressions introduced. The 64-byte reserved padding is zeroed on initialization and ignored during deserialization.
- Future schema changes should consume reserved bytes rather than appending, preserving account compatibility.
