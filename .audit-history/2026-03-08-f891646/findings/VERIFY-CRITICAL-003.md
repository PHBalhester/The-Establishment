# Verification: CRITICAL-003 (S006) - Combined Deployment Attack

**Original Severity:** CRITICAL (NEW)

**Verification Status:** FIXED

## Changes Found

This was a combined/compound finding that required both CRITICAL-001 (Bonding Curve SOL theft) and CRITICAL-002 (Hook authority capture) to be fixed. The attack scenario was: front-runner captures Hook whitelist authority (H007) AND exploits BC SOL withdrawal (H001/H010), making the combined attack worse than either alone.

Both constituent vulnerabilities have been fixed:

1. **CRITICAL-002 (H007) -- Hook authority capture:** `initialize_authority.rs` now requires ProgramData upgrade-authority gate. See VERIFY-CRITICAL-002.md. **FIXED.**

2. **Bonding Curve admin init:** `initialize_bc_admin.rs` (lines 44-56) now requires:
   - `program: Program<'info, crate::program::BondingCurve>` with `programdata_address()` constraint
   - `program_data: Account<'info, ProgramData>` with `upgrade_authority_address == Some(authority.key())` constraint

   This prevents an attacker from capturing BC admin authority.

## Verification Analysis

The combined attack is no longer possible because:

- **Hook front-running blocked:** Only the upgrade authority can initialize the whitelist authority. An attacker cannot capture whitelist control.
- **BC admin front-running blocked:** Only the upgrade authority can initialize the BC admin config. An attacker cannot capture BC admin privileges.
- **Both fixes use the same pattern:** ProgramData upgrade-authority gating, consistently applied across all protocol programs.

Since both constituent attack vectors are independently fixed, the combined attack surface is eliminated.

## Regression Check

- No regressions detected.
- All six programs with init instructions now use the ProgramData authority gate pattern: Transfer Hook, Staking, Epoch (x2), Conversion Vault, Tax Program, Bonding Curve.
