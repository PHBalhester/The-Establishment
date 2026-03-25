use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::CurveStarted;
use crate::state::{BcAdminConfig, CurveState, CurveStatus};

/// Accounts for the `start_curve` instruction.
///
/// Activates the curve: sets status to Active, records start_slot and deadline_slot.
/// Validates that the token vault holds at least TARGET_TOKENS before starting.
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.3.
#[derive(Accounts)]
pub struct StartCurve<'info> {
    /// Protocol authority. Must match BcAdminConfig.authority.
    pub authority: Signer<'info>,

    /// BcAdminConfig PDA -- gates admin operations.
    #[account(
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// CurveState PDA -- must be in Initialized status. Mutated to Active.
    #[account(
        mut,
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Initialized @ CurveError::InvalidStatus,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// Token vault PDA -- read-only to check balance >= TARGET_TOKENS.
    #[account(
        token::mint = token_mint,
        token::authority = curve_state,
        token::token_program = token_program,
        seeds = [CURVE_TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// Token mint for vault validation.
    #[account(
        mint::token_program = token_program,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Handler for `start_curve`.
///
/// 1. Verifies status == Initialized (enforced by account constraint).
/// 2. Verifies token_vault.amount >= TARGET_TOKENS (rejects unfunded curves).
/// 3. Sets status = Active, start_slot = current slot, deadline_slot = start + 432,000 slots (~48h).
/// 4. Emits CurveStarted event.
pub fn handler(ctx: Context<StartCurve>) -> Result<()> {
    // Verify the vault has been funded with the required tokens.
    require!(
        ctx.accounts.token_vault.amount >= TARGET_TOKENS,
        CurveError::CurveNotFunded
    );

    let clock = Clock::get()?;
    let curve = &mut ctx.accounts.curve_state;

    curve.status = CurveStatus::Active;
    curve.start_slot = clock.slot;
    curve.deadline_slot = clock.slot + DEADLINE_SLOTS;

    emit!(CurveStarted {
        token: curve.token,
        start_slot: curve.start_slot,
        deadline_slot: curve.deadline_slot,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
