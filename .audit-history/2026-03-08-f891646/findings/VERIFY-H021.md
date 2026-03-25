# Verification: H021 - Epoch Init Front-Running

**Original Severity:** LOW

**Verification Status:** FIXED

## Changes Found

File: `programs/epoch-program/src/instructions/initialize_epoch_state.rs` (lines 119-129)

ProgramData upgrade-authority gate added:

- `program: Program<'info, crate::program::EpochProgram>` with `programdata_address()` constraint (lines 119-123)
- `program_data: Account<'info, ProgramData>` with `upgrade_authority_address == Some(payer.key())` constraint (lines 125-129)

## Verification Analysis

The original finding noted this as LOW severity because all epoch state parameters are hardcoded (genesis config values in constants), so a front-runner could not capture any meaningful privilege. The ProgramData gate was described as "optional" hardening.

Despite the low severity, the fix has been applied -- the deployer-only gate is now enforced. This is consistent with the protocol-wide pattern applied to all init instructions.

Key observations:

- **All parameters remain hardcoded:** `cheap_side`, `low_tax_bps`, `high_tax_bps`, `vrf_pending`, etc. are all set from constants or fixed values in the handler. No user-supplied parameters exist.
- **Defense-in-depth achieved:** Even though front-running this instruction alone causes no privilege capture, the gate prevents an attacker from wasting the deployer's PDA slot (forcing a redeploy).
- **Consistent pattern:** All seven init instructions across all six programs now use the same ProgramData authority gate.

## Regression Check

- No regressions detected.
- Two additional accounts required by client code (expected).
- The existing `!epoch_state.initialized` check (line 37) provides a secondary defense-in-depth guard against re-initialization, which is redundant with `init` but harmless.
