# Verification: H010
**Status:** FIXED
**Evidence:**

1. **BcAdminConfig has authority field** -- CONFIRMED. `programs/bonding_curve/src/state.rs` defines `BcAdminConfig` with `pub authority: Pubkey` and `pub bump: u8`. PDA seeds: `[b"bc_admin"]`.

2. **prepare_transition checks authority** -- CONFIRMED. `programs/bonding_curve/src/instructions/prepare_transition.rs` lines 18-28:
   - `authority: Signer<'info>` (line 20)
   - `admin_config: Account<'info, BcAdminConfig>` with constraints:
     - `seeds = [BC_ADMIN_SEED]` (PDA derivation)
     - `bump = admin_config.bump`
     - `has_one = authority @ CurveError::Unauthorized` (line 26)
   - This ensures only the authority stored in BcAdminConfig can call the instruction.

3. **withdraw_graduated_sol checks authority** -- CONFIRMED. `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs` lines 25-36:
   - `authority: Signer<'info>` (line 28, also `#[account(mut)]` since it receives SOL)
   - `admin_config: Account<'info, BcAdminConfig>` with identical constraints:
     - `seeds = [BC_ADMIN_SEED]`
     - `bump = admin_config.bump`
     - `has_one = authority @ CurveError::Unauthorized` (line 34)
   - Additional protection: `curve_state.status == CurveStatus::Graduated` constraint (line 43).

4. **Authority check is proper has_one** -- CONFIRMED. Both instructions use Anchor's `has_one` constraint with custom error, which is the canonical Anchor pattern for authority validation.

**Completeness:**
- Fully addressed. The BcAdminConfig PDA pattern with `has_one = authority` prevents any unauthorized wallet from calling admin instructions. The authority is set during `initialize_bc_admin` (gated by ProgramData upgrade authority) and can be burned via `burn_bc_admin`.
