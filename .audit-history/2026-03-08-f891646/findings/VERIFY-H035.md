# Verification: H035 - Tax split comments stale

**Original Severity:** INFO
**Verification Status:** FIXED
**Last Verified:** 2026-03-12

## Changes Found

**Code constants are correct** -- `STAKING_BPS = 7_100` (71%), `CARNAGE_BPS = 2_400` (24%), `TREASURY_BPS = 500` (5%) in `programs/tax-program/src/constants.rs`.

**All stale comments have been fixed:**
- `lib.rs` lines 5-7: Updated to "71% to staking escrow" and "5% to treasury"
- `swap_sol_buy.rs` line 3: Updated to "71% staking, 24% carnage, 5% treasury"
- `swap_sol_buy.rs` line 125: Updated to "Transfer staking portion (71%)"
- `swap_sol_buy.rs` line 195: Updated to "Transfer treasury portion (5% / remainder)"
- `swap_sol_buy.rs` line 429: Updated to "receives 71% of tax"
- `swap_sol_buy.rs` line 451: Updated to "receives 5% of tax"
- `swap_sol_sell.rs` account docs: Updated to 71%/5%
- `staking/src/events.rs`: Updated to "71% yield portion"
- `tax-program/src/events.rs`: Updated to "71%" and "5%"

All Rust source comments now consistently reflect the correct 71/24/5 split.

## Verification Analysis

All stale comment references to the old 75/24/1 split across `lib.rs`, `swap_sol_buy.rs`, `swap_sol_sell.rs`, and event structs have been corrected. The TypeScript side (`swap-flow.ts`) was previously fixed. Documentation now matches code constants throughout.

## Regression Check

No regression. Comment-only changes with no functional impact. Constants and math remain correct.
