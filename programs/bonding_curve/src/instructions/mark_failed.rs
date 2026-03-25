use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CurveError;
use crate::events::CurveFailed;
use crate::state::{CurveState, CurveStatus};

/// Accounts for the `mark_failed` instruction.
///
/// Transitions an Active curve to Failed after deadline + grace buffer.
/// Permissionless: anyone can call once the deadline + grace period has passed.
///
/// No status constraint in the derive -- the handler checks status explicitly
/// so we can return a specific error (InvalidStatus vs DeadlineNotPassed).
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.7, modified by 73-CONTEXT.md
/// (150-slot grace buffer additive safety measure).
#[derive(Accounts)]
pub struct MarkFailed<'info> {
    /// CurveState PDA. Seeds: ["curve", token_mint].
    /// Status check is in handler (not constraint) for specific error messages.
    #[account(
        mut,
        seeds = [CURVE_SEED, curve_state.token_mint.as_ref()],
        bump = curve_state.bump,
    )]
    pub curve_state: Account<'info, CurveState>,
}

/// Handler for `mark_failed`.
///
/// Transitions a curve from Active to Failed after the deadline + grace buffer.
///
/// Steps:
/// 1. Require curve is Active (only Active curves can fail).
/// 2. Compute failure-eligible slot: deadline_slot + FAILURE_GRACE_SLOTS.
/// 3. Require current slot > failure-eligible slot (strictly after grace period).
/// 4. Set status to Failed.
/// 5. Emit CurveFailed event.
///
/// The 150-slot grace buffer (~60 seconds) gives in-flight purchase TXs time
/// to finalize on-chain before failure becomes lockable. Purchases are already
/// blocked at deadline_slot (hard cutoff), so the buffer only delays when
/// failure can be marked -- it does not extend the purchase window.
pub fn handler(ctx: Context<MarkFailed>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    // Step 1: Only Active curves can be marked failed.
    require!(
        curve.status == CurveStatus::Active,
        CurveError::InvalidStatus
    );

    // Step 2-3: Deadline + grace buffer must have passed.
    let clock = Clock::get()?;
    let failure_eligible_slot = curve
        .deadline_slot
        .checked_add(FAILURE_GRACE_SLOTS)
        .ok_or(CurveError::Overflow)?;
    require!(
        clock.slot > failure_eligible_slot,
        CurveError::DeadlineNotPassed
    );

    // Step 4: Transition to Failed (terminal state).
    curve.status = CurveStatus::Failed;

    // Step 5: Emit event.
    emit!(CurveFailed {
        token: curve.token,
        tokens_sold: curve.tokens_sold,
        sol_raised: curve.sol_raised,
        deadline_slot: curve.deadline_slot,
        current_slot: clock.slot,
    });

    Ok(())
}
