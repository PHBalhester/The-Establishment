use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::CurveFunded;
use crate::state::{BcAdminConfig, CurveState, CurveStatus};

/// Accounts for the `fund_curve` instruction.
///
/// Transfers TARGET_TOKENS (460M) from the authority's token account
/// to the curve's token vault. The authority signs directly (not a PDA signer).
///
/// Must be called after `initialize_curve` and before `start_curve`.
/// Accepts `remaining_accounts` for Transfer Hook support (CRIME/FRAUD use Token-2022 hooks).
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.2.
#[derive(Accounts)]
pub struct FundCurve<'info> {
    /// Protocol authority. Must match BcAdminConfig.authority. Signs the token transfer.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// BcAdminConfig PDA -- gates admin operations.
    #[account(
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// CurveState PDA -- must be in Initialized status.
    /// Not mutated (status doesn't change on fund, only on start).
    #[account(
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Initialized @ CurveError::InvalidStatus,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// Authority's token account (source of 460M tokens).
    /// This is typically the admin's ATA for this token.
    #[account(
        mut,
        token::mint = token_mint,
        token::token_program = token_program,
    )]
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Curve's token vault PDA (destination).
    /// Authority is curve_state PDA (set during initialize_curve).
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = curve_state,
        token::token_program = token_program,
        seeds = [CURVE_TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// Token mint for transfer_checked decimals validation.
    #[account(
        mint::token_program = token_program,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Handler for `fund_curve`.
///
/// Transfers exactly TARGET_TOKENS (460M with 6 decimals) from the authority's
/// token account to the curve's token vault using Token-2022 transfer_checked.
///
/// The authority signs directly -- this is an admin operation where the deployer
/// holds the tokens and funds the curve vault.
///
/// CRITICAL: We use manual invoke instead of Anchor's CPI helper because
/// anchor_spl::token_2022::transfer_checked does NOT properly forward
/// remaining_accounts through the Transfer Hook CPI chain.
/// (Same pattern as purchase.rs.)
///
/// Transfer Hook accounts are passed via `remaining_accounts` since CRIME/FRAUD
/// tokens use Token-2022 Transfer Hooks.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, FundCurve<'info>>) -> Result<()> {
    let transfer_amount = TARGET_TOKENS;

    // Build the base transfer_checked instruction
    let mut ix = spl_token_2022::instruction::transfer_checked(
        ctx.accounts.token_program.key,
        &ctx.accounts.authority_token_account.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_vault.key(),
        &ctx.accounts.authority.key(),
        &[], // no multisig signers
        transfer_amount,
        TOKEN_DECIMALS,
    )?;

    // Append Transfer Hook accounts from remaining_accounts to instruction keys
    for account_info in ctx.remaining_accounts {
        ix.accounts.push(AccountMeta {
            pubkey: *account_info.key,
            is_signer: account_info.is_signer,
            is_writable: account_info.is_writable,
        });
    }

    // Build complete account_infos: standard 4 (from, mint, to, authority) + hook accounts
    let mut account_infos = vec![
        ctx.accounts.authority_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.token_vault.to_account_info(),
        ctx.accounts.authority.to_account_info(),
    ];
    for account_info in ctx.remaining_accounts {
        account_infos.push(account_info.clone());
    }

    // Authority signs directly (not a PDA signer)
    anchor_lang::solana_program::program::invoke(
        &ix,
        &account_infos,
    )?;

    emit!(CurveFunded {
        token: ctx.accounts.curve_state.token,
        amount: transfer_amount,
    });

    Ok(())
}
