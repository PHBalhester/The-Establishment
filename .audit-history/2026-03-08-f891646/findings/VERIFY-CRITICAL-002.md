# Verification: CRITICAL-002 (H007) - Transfer Hook Init Front-Running

**Original Severity:** CRITICAL (RECURRENT -- surviving 2 audits)

**Verification Status:** FIXED

## Changes Found

File: `programs/transfer-hook/src/instructions/initialize_authority.rs` (lines 45-55)

The `InitializeAuthority` struct now requires two additional accounts:

1. `program: Program<'info, crate::program::TransferHook>` -- constrained so that `program.programdata_address()? == Some(program_data.key())`, linking it to the correct ProgramData account.
2. `program_data: Account<'info, ProgramData>` -- constrained so that `program_data.upgrade_authority_address == Some(signer.key())`.

These two constraints together enforce that **only the program's current upgrade authority** can call `initialize_authority`. A front-runner cannot satisfy the `program_data.upgrade_authority_address == Some(signer.key())` constraint because they are not the upgrade authority.

## Verification Analysis

The fix is correctly implemented using the standard Anchor ProgramData upgrade-authority gate pattern:

- **Chain of trust is sound:** `program.programdata_address()` returns the canonical ProgramData address for the deployed program binary. The constraint verifies that the passed `program_data` account matches this address. Then `program_data.upgrade_authority_address` is checked against the signer. An attacker cannot forge either account.
- **`init` provides idempotency:** The `#[account(init, ...)]` constraint on `whitelist_authority` ensures this can only be called once (PDA collision prevents re-init). Combined with the authority gate, only the deployer can claim authority, and only once.
- **No regressions:** The handler logic (lines 15-25) is unchanged -- it still sets `auth.authority = Some(signer.key())` and `auth.initialized = true`.

## Regression Check

- No regressions detected.
- The fix adds two new required accounts to the instruction, which is a breaking change for any existing client code. This is expected and correct -- deploy scripts must pass `program` and `program_data` accounts.
- The fix matches the pattern used consistently across all other init instructions in the protocol (Staking, Epoch, Conversion Vault, Tax Program, Bonding Curve).
