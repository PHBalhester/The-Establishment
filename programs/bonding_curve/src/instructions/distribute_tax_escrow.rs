use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CurveError;
use crate::events::EscrowDistributed;
use crate::state::{CurveState, CurveStatus};

/// Accounts for the `distribute_tax_escrow` instruction.
///
/// Routes tax escrow SOL to the carnage fund after graduation.
/// Permissionless: anyone can call once the curve has graduated.
///
/// The tax escrow PDA is owned by the bonding curve program (created with
/// `init, space = 0`). The carnage_sol_vault is owned by the epoch program.
/// Direct lamport manipulation works because:
///   1. The bonding curve program can SUBTRACT lamports from its own PDA (tax_escrow).
///   2. ANY program can ADD lamports to ANY account (Solana runtime rule).
///
/// This is the same pattern as sell.rs adding lamports to the user's wallet
/// (which is owned by the system program).
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.10.
#[derive(Accounts)]
pub struct DistributeTaxEscrow<'info> {
    /// CurveState PDA (read-only -- no state mutations).
    /// Seeds: ["curve", token_mint].
    #[account(
        seeds = [CURVE_SEED, curve_state.token_mint.as_ref()],
        bump = curve_state.bump,
    )]
    pub curve_state: Account<'info, CurveState>,

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

    /// Carnage fund SOL vault PDA (owned by epoch program).
    /// CHECK: Validated by PDA derivation against known epoch program + seed.
    #[account(
        mut,
        constraint = carnage_fund.key()
            == Pubkey::find_program_address(
                &[CARNAGE_SOL_VAULT_SEED],
                &epoch_program_id(),
            ).0
            @ CurveError::InvalidStatus,
    )]
    pub carnage_fund: UncheckedAccount<'info>,
}

/// Handler for `distribute_tax_escrow`.
///
/// Transfers available lamports from tax escrow to the carnage fund.
///
/// Steps:
/// 1. Require curve is Graduated.
/// 2. Compute transferable = escrow lamports - rent-exempt minimum.
/// 3. Require transferable > 0 (not already distributed).
/// 4. Direct lamport manipulation: escrow -= transferable, carnage += transferable.
/// 5. Emit EscrowDistributed event.
///
/// The rent-exempt minimum (~890,880 lamports for a 0-byte account) stays
/// in the escrow PDA to keep it alive. On graduation, this dust is acceptable.
pub fn handler(ctx: Context<DistributeTaxEscrow>) -> Result<()> {
    // Step 1: Only graduated curves can distribute escrow.
    require!(
        ctx.accounts.curve_state.status == CurveStatus::Graduated,
        CurveError::CurveNotGraduated
    );

    // Step 2: Compute transferable (escrow balance minus rent-exempt minimum).
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let escrow_lamports = ctx.accounts.tax_escrow.lamports();
    let transferable = escrow_lamports.saturating_sub(rent_exempt);

    // Step 3: Must have something to distribute.
    require!(transferable > 0, CurveError::EscrowAlreadyDistributed);

    // Step 4: Direct lamport manipulation.
    // Subtract from tax_escrow (owned by bonding curve program -- allowed).
    // Add to carnage_fund (owned by epoch program -- any program can credit).
    **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? -= transferable;
    **ctx.accounts.carnage_fund.try_borrow_mut_lamports()? += transferable;

    // Step 5: Emit event.
    emit!(EscrowDistributed {
        token: ctx.accounts.curve_state.token,
        amount: transferable,
        destination: ctx.accounts.carnage_fund.key(),
        slot: Clock::get()?.slot,
    });

    Ok(())
}
