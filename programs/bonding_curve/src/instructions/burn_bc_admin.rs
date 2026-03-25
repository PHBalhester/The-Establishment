use anchor_lang::prelude::*;

use crate::constants::BC_ADMIN_SEED;
use crate::error::CurveError;
use crate::state::BcAdminConfig;

/// Burns the admin key by setting it to Pubkey::default().
/// After this call, the `has_one = authority` constraint on all admin
/// instructions will always fail since no one can sign as Pubkey::default().
///
/// This is irreversible. Only the current authority can call this.
///
/// # Accounts
/// * `authority` - Current admin signer (must match admin_config.authority)
/// * `admin_config` - The BcAdminConfig PDA to modify
pub fn handler(ctx: Context<BurnBcAdmin>) -> Result<()> {
    let admin_config = &mut ctx.accounts.admin_config;
    let burned_by = admin_config.authority;

    // Permanently revoke admin privileges
    admin_config.authority = Pubkey::default();

    msg!(
        "BcAdmin burned by {}. Admin operations permanently disabled.",
        burned_by
    );

    Ok(())
}

#[derive(Accounts)]
pub struct BurnBcAdmin<'info> {
    /// The current authority. Must match admin_config.authority.
    pub authority: Signer<'info>,

    /// The BcAdminConfig PDA. After this instruction, authority will be Pubkey::default().
    #[account(
        mut,
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,
}
