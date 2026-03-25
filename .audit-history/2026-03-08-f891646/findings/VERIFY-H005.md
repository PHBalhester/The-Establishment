# Verification: H005 - BC close_token_vault rent extraction

**Original Severity:** LOW
**Verification Status:** FIXED

## Changes Found

`close_token_vault.rs` now includes the `BcAdminConfig` PDA with `has_one = authority @ CurveError::Unauthorized` (lines 31-36). The `authority` signer must match the stored admin pubkey in `BcAdminConfig`.

Previously, any signer could call `close_token_vault` on a graduated curve with an empty vault and extract the rent (~0.004 SOL) to their own wallet. Now, only the authorized admin can call this instruction.

## Verification Analysis

The fix is correct. The rent extraction vector required:
1. A graduated curve (status check was already present)
2. An empty token vault (amount == 0 check was already present)
3. Any signer (this was the vulnerability)

With the `has_one = authority` constraint on `BcAdminConfig`, condition (3) is now restricted to the admin only. The rent SOL is sent to the `authority` account (line 28: `#[account(mut)] pub authority: Signer<'info>`), which must match `admin_config.authority`.

## Regression Check

No regressions. The fix is part of the same BcAdminConfig pattern applied to all 6 admin instructions (CRITICAL-001). The close CPI signer seeds are unchanged (`["curve", token_mint, bump]`), and the vault authority validation (`token_vault.key() == curve_state.token_vault`) remains intact.
