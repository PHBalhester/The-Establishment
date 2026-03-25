# Verification: S004 - compile_error! guard implementation

**Original Severity:** INFO
**Verification Status:** FIXED (same fix as H018)

## Changes Found

All mainnet placeholder functions that previously returned `Pubkey::default()` in the bare (no-feature) build path now use `compile_error!()`. See VERIFY-H018.md for the complete list of 8 guarded functions across 3 programs.

The `compile_error!` macro fires at compile time, not runtime, meaning:
- A mainnet build attempt without configuring addresses will fail immediately during `cargo build`
- No runtime check needed; the binary cannot be produced with zero addresses
- Error messages are descriptive and point to the exact file and constant to update

## Verification Analysis

The implementation matches the recommended fix exactly. The `compile_error!` approach is superior to runtime panics because:
1. Fails at compile time, not after deployment
2. Cannot be bypassed by code paths that don't call the function
3. Error message is visible in build output, not hidden in logs

Devnet builds are unaffected because `--features devnet` activates the `#[cfg(feature = "devnet")]` path which returns real addresses.

## Regression Check

- No regressions. The `#[cfg(not(any(feature = "devnet", feature = "localnet")))]` guard only activates on bare builds (no features), which is the mainnet compilation path. All current build scripts use `--features devnet` or `--features localnet`.
