# VERIFY-H105: Pubkey::default() Placeholders
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** FIXED

## Evidence
Seven `compile_error!` guards confirmed across three programs:
- `bonding_curve/src/constants.rs`: 3 guards (CRIME mint, FRAUD mint, Epoch Program ID)
- `conversion-vault/src/constants.rs`: 3 guards (CRIME mint, FRAUD mint, PROFIT mint)
- `tax-program/src/constants.rs`: 1 guard (treasury address)

All mainnet-only constants use `Pubkey::default()` as placeholder with `compile_error!` on the `#[cfg(not(feature = "devnet"))]` branch, preventing a mainnet build with placeholder addresses.

Remaining `Pubkey::default()` uses are legitimate: test fixtures (`math.rs`, `state.rs` test helpers), admin burn instructions (setting authority to default = irrevocable), whitelist validation (rejecting default as invalid), and staking new-user detection.

## Assessment
Fix confirmed and stable. All placeholder mint/program addresses are guarded by compile-time errors.
