use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CurveError;
use crate::events::TransitionPrepared;
use crate::state::{BcAdminConfig, CurveState, CurveStatus};

/// Accounts for the `prepare_transition` instruction.
///
/// Transitions both CRIME and FRAUD curves from Filled to Graduated.
/// Admin-only: only the protocol authority (deployer) can call.
///
/// CONTEXT.md decision: admin-only, not permissionless.
/// We trust the admin (we are the deployer). No on-chain timeout fallback.
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.11, modified by 73-CONTEXT.md.
#[derive(Accounts)]
pub struct PrepareTransition<'info> {
    /// Protocol authority (deployer). Must match BcAdminConfig.authority.
    pub authority: Signer<'info>,

    /// BcAdminConfig PDA -- gates admin operations.
    #[account(
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// CRIME CurveState PDA. Seeds: ["curve", crime_token_mint].
    #[account(
        mut,
        seeds = [CURVE_SEED, crime_curve_state.token_mint.as_ref()],
        bump = crime_curve_state.bump,
    )]
    pub crime_curve_state: Account<'info, CurveState>,

    /// FRAUD CurveState PDA. Seeds: ["curve", fraud_token_mint].
    #[account(
        mut,
        seeds = [CURVE_SEED, fraud_curve_state.token_mint.as_ref()],
        bump = fraud_curve_state.bump,
    )]
    pub fraud_curve_state: Account<'info, CurveState>,
}

/// Handler for `prepare_transition`.
///
/// Transitions both curves from Filled to Graduated (terminal state).
///
/// Steps:
/// 1. Require CRIME curve is Filled.
/// 2. Require FRAUD curve is Filled.
/// 3. Set both to Graduated.
/// 4. Emit TransitionPrepared event.
///
/// Both curves must be Filled simultaneously. This is the critical gate
/// that makes graduation irreversible. The actual asset movement (vault
/// withdrawals, pool seeding) happens in Phase 74 via separate instructions.
pub fn handler(ctx: Context<PrepareTransition>) -> Result<()> {
    // Step 1: CRIME must be Filled.
    require!(
        ctx.accounts.crime_curve_state.status == CurveStatus::Filled,
        CurveError::CRIMECurveNotFilled
    );

    // Step 2: FRAUD must be Filled.
    require!(
        ctx.accounts.fraud_curve_state.status == CurveStatus::Filled,
        CurveError::FRAUDCurveNotFilled
    );

    // Step 3: Transition both to Graduated (terminal state).
    ctx.accounts.crime_curve_state.status = CurveStatus::Graduated;
    ctx.accounts.fraud_curve_state.status = CurveStatus::Graduated;

    // Step 4: Emit event.
    emit!(TransitionPrepared {
        crime_sol_raised: ctx.accounts.crime_curve_state.sol_raised,
        fraud_sol_raised: ctx.accounts.fraud_curve_state.sol_raised,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
