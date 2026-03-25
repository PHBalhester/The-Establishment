# Verification: CRITICAL-001 (H001/H002/H010/S001) - BC Authority Gap

**Original Severity:** CRITICAL
**Verification Status:** FIXED

## Changes Found

Two new instructions added:
- `initialize_bc_admin.rs` -- Creates `BcAdminConfig` PDA (seeds: `[b"bc_admin"]`). Only callable by the program's upgrade authority, verified via `ProgramData.upgrade_authority_address == authority.key()`. Uses `init` so it can only be called once.
- `burn_bc_admin.rs` -- Sets `BcAdminConfig.authority` to `Pubkey::default()`, permanently disabling all admin ops. Gated by `has_one = authority`.

New state account:
- `BcAdminConfig` in `state.rs` -- Stores `authority: Pubkey` and `bump: u8`. Derives via `InitSpace`.

All 6 previously-vulnerable admin instructions now include the `BcAdminConfig` PDA with `has_one = authority @ CurveError::Unauthorized`:

| Instruction | `admin_config` present | `has_one = authority` | Seeds verified |
|---|---|---|---|
| `initialize_curve.rs` | Yes (L22-27) | Yes (`@ CurveError::Unauthorized`) | `[BC_ADMIN_SEED]` + bump |
| `fund_curve.rs` | Yes (L26-31) | Yes (`@ CurveError::Unauthorized`) | `[BC_ADMIN_SEED]` + bump |
| `start_curve.rs` | Yes (L21-26) | Yes (`@ CurveError::Unauthorized`) | `[BC_ADMIN_SEED]` + bump |
| `prepare_transition.rs` | Yes (L23-28) | Yes (`@ CurveError::Unauthorized`) | `[BC_ADMIN_SEED]` + bump |
| `withdraw_graduated_sol.rs` | Yes (L31-36) | Yes (`@ CurveError::Unauthorized`) | `[BC_ADMIN_SEED]` + bump |
| `close_token_vault.rs` | Yes (L31-36) | Yes (`@ CurveError::Unauthorized`) | `[BC_ADMIN_SEED]` + bump |

## Verification Analysis

The fix is comprehensive and correct:

1. **ProgramData gate on init**: `initialize_bc_admin` verifies `program.programdata_address()? == Some(program_data.key())` AND `program_data.upgrade_authority_address == Some(authority.key())`. This is the standard Anchor pattern for proving deployer identity. Only the upgrade authority can create the admin config.

2. **has_one enforcement**: All 6 admin instructions use `has_one = authority @ CurveError::Unauthorized` on the `BcAdminConfig` account. Anchor's `has_one` checks that `admin_config.authority == authority.key()`, meaning the signer must match the stored admin pubkey. An arbitrary signer will be rejected at account validation time before any handler code executes.

3. **PDA seeds are deterministic**: `seeds = [BC_ADMIN_SEED]` with `BC_ADMIN_SEED = b"bc_admin"` (constants.rs:10). Single global PDA, no ambiguity.

4. **Burn mechanism**: Setting authority to `Pubkey::default()` is a clean permanent disable since `Pubkey::default()` (all zeros) cannot produce a valid signature. The `has_one` check will always fail after burn.

5. **Error type**: `CurveError::Unauthorized` is defined in `error.rs:12-13` with message "Unauthorized: caller is not the admin".

The atomic ~2000 SOL theft vector described in the original finding is no longer possible. An attacker cannot call any of the 6 admin instructions without matching the `BcAdminConfig.authority` pubkey.

## Regression Check

- No regressions found. The `admin_config` account is read-only (no `mut`) in all 6 downstream instructions, so it adds no write-lock contention.
- The `authority` field on each instruction's Accounts struct still requires `Signer`, maintaining the existing signature requirement on top of the new identity check.
- `initialize_bc_admin` uses `init` (not `init_if_needed`), preventing re-initialization attacks.
- The `BcAdminConfig` PDA space is `8 + InitSpace` which for `Pubkey(32) + u8(1)` = 41 bytes. Correct.
