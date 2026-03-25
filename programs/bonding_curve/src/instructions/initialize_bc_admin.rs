use anchor_lang::prelude::*;

use crate::constants::BC_ADMIN_SEED;
use crate::state::BcAdminConfig;

/// Initializes the global BcAdminConfig PDA.
///
/// This instruction can only be called by the program's upgrade authority,
/// verified via the ProgramData account constraint. It stores the admin
/// pubkey that will gate all admin-only instructions -- the admin can be
/// a different key from the upgrade authority (e.g., a multisig).
///
/// This instruction can only be called once because `init` will fail if
/// the BcAdminConfig PDA already exists.
///
/// # Arguments
/// * `admin` - The pubkey to set as the bonding curve admin (can be multisig).
pub fn handler(ctx: Context<InitializeBcAdmin>, admin: Pubkey) -> Result<()> {
    let admin_config = &mut ctx.accounts.admin_config;
    admin_config.authority = admin;
    admin_config.bump = ctx.bumps.admin_config;

    msg!("BcAdminConfig initialized. Authority: {}", admin);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeBcAdmin<'info> {
    /// The program's upgrade authority. Must sign to prove deployer identity.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The BcAdminConfig PDA. Initialized once; stores the authority pubkey and bump.
    /// Seeds: [b"bc_admin"]
    #[account(
        init,
        payer = authority,
        space = 8 + BcAdminConfig::INIT_SPACE,
        seeds = [BC_ADMIN_SEED],
        bump
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// The BondingCurve program itself -- used to look up its programdata address.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
    )]
    pub program: Program<'info, crate::program::BondingCurve>,

    /// The program's ProgramData account (created by the BPF loader on deploy).
    /// Constraint: its upgrade_authority_address must equal the signing authority.
    /// This is how we verify the caller is the deployer.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}
