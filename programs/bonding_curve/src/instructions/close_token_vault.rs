use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::TokenVaultClosed;
use crate::state::{BcAdminConfig, CurveState, CurveStatus};

/// Accounts for the `close_token_vault` instruction.
///
/// Admin-only instruction to close an empty token vault from a graduated
/// curve, recovering rent SOL to the admin wallet.
///
/// Used during graduation orchestration (Phase 74) after all tokens have
/// been withdrawn from the vault for AMM pool seeding.
///
/// The token vault authority is the CurveState PDA (set during init in
/// initialize_curve.rs: `token::authority = curve_state`). The close CPI
/// uses PDA signer seeds: ["curve", token_mint, bump].
///
/// Security: Only callable on Graduated curves (terminal state) with an
/// empty vault (0 token balance). Both conditions are enforced via
/// Anchor constraints.
#[derive(Accounts)]
pub struct CloseTokenVault<'info> {
    /// Protocol authority (deployer). Must match BcAdminConfig.authority. Receives rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// BcAdminConfig PDA -- gates admin operations.
    #[account(
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// CurveState PDA -- must be Graduated.
    /// Seeds: ["curve", token_mint]. Acts as token vault authority for close CPI.
    #[account(
        seeds = [CURVE_SEED, curve_state.token_mint.as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Graduated @ CurveError::CurveNotGraduated,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// Token vault PDA to close. Must be empty (0 token balance).
    /// Seeds: ["curve_token_vault", token_mint]. Validated against curve_state.
    #[account(
        mut,
        seeds = [CURVE_TOKEN_VAULT_SEED, curve_state.token_mint.as_ref()],
        bump,
        constraint = token_vault.key() == curve_state.token_vault @ CurveError::InvalidStatus,
        constraint = token_vault.amount == 0 @ CurveError::InvalidStatus,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token mint (for close_account CPI context).
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token-2022 program (CRIME/FRAUD use Token-2022).
    pub token_program: Interface<'info, TokenInterface>,
}

/// Handler for `close_token_vault`.
///
/// Closes the graduated curve's empty token vault, recovering rent SOL
/// to the admin's wallet.
///
/// Steps:
/// 1. Capture rent balance before closing (for event data).
/// 2. Close the token account via Token-2022 CPI with CurveState PDA as authority.
/// 3. Emit TokenVaultClosed event.
///
/// The `amount == 0` constraint in the Accounts struct guarantees the vault
/// is empty before we reach this handler. No additional balance check needed.
pub fn handler(ctx: Context<CloseTokenVault>) -> Result<()> {
    // Step 1: Capture rent for event.
    let rent_recovered = ctx.accounts.token_vault.to_account_info().lamports();

    // Step 2: Close via Token-2022 CPI.
    // CurveState PDA is the vault authority (set in initialize_curve.rs).
    // Seeds: ["curve", token_mint, bump].
    let token_mint_key = ctx.accounts.curve_state.token_mint;
    let bump = ctx.accounts.curve_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[CURVE_SEED, token_mint_key.as_ref(), &[bump]]];

    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::CloseAccount {
            account: ctx.accounts.token_vault.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.curve_state.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Step 3: Emit event for indexers/monitoring.
    emit!(TokenVaultClosed {
        token_mint: token_mint_key,
        rent_recovered,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
