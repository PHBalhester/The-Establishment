use anchor_lang::prelude::*;

use crate::constants::BC_ADMIN_SEED;
use crate::error::CurveError;
use crate::state::BcAdminConfig;

/// Transfers the bonding curve admin authority to a new pubkey
/// (e.g., a Squads multisig vault).
///
/// Only the current authority can call this. The new_authority must not be
/// Pubkey::default() -- use burn_bc_admin for permanent revocation.
///
/// # Arguments
/// * `new_authority` - The pubkey to set as the new bonding curve admin.
///
/// # Accounts
/// * `authority` - Current admin signer (must match admin_config.authority)
/// * `admin_config` - The BcAdminConfig PDA to modify
pub fn handler(ctx: Context<TransferBcAdmin>, new_authority: Pubkey) -> Result<()> {
    // Prevent accidental burn -- burn_bc_admin exists for that purpose
    require!(
        new_authority != Pubkey::default(),
        CurveError::InvalidAuthority
    );

    let admin_config = &mut ctx.accounts.admin_config;
    let old_authority = admin_config.authority;

    admin_config.authority = new_authority;

    msg!(
        "BcAdmin transferred from {} to {}",
        old_authority,
        new_authority
    );

    Ok(())
}

#[derive(Accounts)]
pub struct TransferBcAdmin<'info> {
    /// The current authority. Must match admin_config.authority.
    pub authority: Signer<'info>,

    /// The BcAdminConfig PDA. After this instruction, authority will be new_authority.
    #[account(
        mut,
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,
}
