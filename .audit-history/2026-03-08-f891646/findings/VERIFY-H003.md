# Verification: H003 - BC initialize_curve front-running

**Original Severity:** MEDIUM (POTENTIAL)
**Verification Status:** FIXED

## Changes Found

`initialize_curve.rs` now includes the `BcAdminConfig` PDA with `has_one = authority @ CurveError::Unauthorized` (lines 22-27). Previously, any signer could call `initialize_curve` -- the mitigations were:
1. Mint allowlist (feature-gated constraint checking `crime_mint()` or `fraud_mint()`)
2. PDA uniqueness (seeds `["curve", token_mint]` means only one curve per mint)

With the admin authority check, an attacker can no longer front-run `initialize_curve` even if they somehow had a valid mint address.

## Verification Analysis

The original finding noted this was "POTENTIAL" severity because the mint allowlist + PDA uniqueness already made exploitation difficult. The admin authority gate now makes it impossible:

1. **Mint allowlist** (lines 82-88): Non-localnet builds require `token_mint.key() == crime_mint() || token_mint.key() == fraud_mint()`. Still present.
2. **PDA uniqueness**: `seeds = [CURVE_SEED, token_mint.key().as_ref()]` with `init` ensures one curve per mint. Still present.
3. **Admin authority** (NEW): `has_one = authority @ CurveError::Unauthorized` on `BcAdminConfig`. Only the authorized admin can call `initialize_curve`.

All three layers are now in place. The front-running vector is fully closed.

## Regression Check

No regressions. The `localnet` feature gate on the mint allowlist is preserved (line 84: `cfg!(feature = "localnet")`), allowing test flexibility without weakening production security. The `partner_mint` parameter is still accepted as an argument (not validated against the allowlist), but this is correct -- `partner_mint` is stored as metadata in `CurveState` for cross-curve reference and does not control any security-critical behavior.
