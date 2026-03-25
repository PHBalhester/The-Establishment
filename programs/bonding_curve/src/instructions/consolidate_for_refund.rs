use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CurveError;
use crate::events::EscrowConsolidated;
use crate::state::CurveState;

/// Accounts for the `consolidate_for_refund` instruction.
///
/// Moves all available SOL from the tax escrow PDA into the SOL vault PDA,
/// then sets the `escrow_consolidated` flag on CurveState.
///
/// Permissionless: anyone can call once the curve is refund-eligible.
/// Must be called before any `claim_refund` calls.
///
/// Both the tax_escrow and sol_vault are owned by the bonding curve program,
/// so direct lamport manipulation works for both sides of the transfer.
///
/// The partner_curve_state is required for the `is_refund_eligible()` check,
/// which determines refund eligibility based on the compound state of both curves.
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.9.
#[derive(Accounts)]
pub struct ConsolidateForRefund<'info> {
    /// CurveState PDA for the curve being consolidated.
    /// Seeds: ["curve", token_mint].
    #[account(
        mut,
        seeds = [CURVE_SEED, curve_state.token_mint.as_ref()],
        bump = curve_state.bump,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// Partner CurveState PDA (read-only).
    /// Required for is_refund_eligible() compound state check.
    /// Must be a different curve than curve_state (prevents passing same curve
    /// as its own partner, which would bypass the partner status check).
    #[account(
        seeds = [CURVE_SEED, partner_curve_state.token_mint.as_ref()],
        bump = partner_curve_state.bump,
        constraint = partner_curve_state.key() != curve_state.key()
            @ CurveError::InvalidStatus,
    )]
    pub partner_curve_state: Account<'info, CurveState>,

    /// Tax escrow PDA -- SOL-only, owned by bonding curve program.
    /// Seeds: ["tax_escrow", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds + stored key constraint.
    #[account(
        mut,
        seeds = [TAX_ESCROW_SEED, curve_state.token_mint.as_ref()],
        bump,
        constraint = tax_escrow.key() == curve_state.tax_escrow
            @ CurveError::InvalidStatus,
    )]
    pub tax_escrow: UncheckedAccount<'info>,

    /// SOL vault PDA -- receives consolidated escrow lamports.
    /// Seeds: ["curve_sol_vault", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds constraint.
    #[account(
        mut,
        seeds = [CURVE_SOL_VAULT_SEED, curve_state.token_mint.as_ref()],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,
}

/// Handler for `consolidate_for_refund`.
///
/// Merges tax escrow SOL into the SOL vault for a single refund pool,
/// then sets the escrow_consolidated flag.
///
/// Steps:
/// 1. Require curve is refund-eligible (checks partner curve status).
/// 2. Require escrow not already consolidated.
/// 3. Compute transferable = escrow lamports - rent-exempt minimum.
/// 4. If transferable > 0, move lamports from escrow to vault.
/// 5. Set escrow_consolidated = true (even if transferable was 0).
/// 6. Emit EscrowConsolidated event.
///
/// The flag is set to true even when transferable is 0 -- the point is that
/// consolidation has been performed, not that there were funds to move.
/// (A curve with no sells would have an escrow at rent-exempt minimum only.)
pub fn handler(ctx: Context<ConsolidateForRefund>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    // Step 1: Must be refund-eligible (Failed, or Filled with partner Failed).
    require!(
        curve.is_refund_eligible(ctx.accounts.partner_curve_state.status),
        CurveError::NotRefundEligible
    );

    // Step 1b: Validate partner curve identity.
    // partner_curve_state.key() != curve_state.key() prevents self-referencing,
    // but an arbitrary third curve could bypass the partner status check.
    // This ensures the partner is the actual CRIME/FRAUD counterpart.
    require!(
        ctx.accounts.partner_curve_state.token_mint == curve.partner_mint,
        CurveError::InvalidPartnerCurve
    );

    // Step 2: Must not already be consolidated (idempotency guard).
    require!(
        !curve.escrow_consolidated,
        CurveError::EscrowAlreadyConsolidated
    );

    // Step 3: Compute transferable (escrow balance minus rent-exempt minimum).
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let escrow_lamports = ctx.accounts.tax_escrow.lamports();
    let transferable = escrow_lamports.saturating_sub(rent_exempt);

    // Step 4: Transfer lamports from escrow to vault (both program-owned PDAs).
    if transferable > 0 {
        **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? -= transferable;
        **ctx.accounts.sol_vault.try_borrow_mut_lamports()? += transferable;
    }

    // Step 5: Set consolidated flag (true even if nothing was transferred).
    curve.escrow_consolidated = true;

    // Step 6: Emit event.
    emit!(EscrowConsolidated {
        token: curve.token,
        escrow_amount: transferable,
        new_vault_balance: ctx.accounts.sol_vault.lamports(),
    });

    Ok(())
}
