use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::RefundClaimed;
use crate::state::CurveState;

/// Accounts for the `claim_refund` instruction.
///
/// Burns the user's entire token balance and transfers proportional SOL
/// from the SOL vault back to the user.
///
/// All-or-nothing: the user's entire ATA balance is burned in a single
/// claim. No partial refunds -- prevents rounding exploitation via many
/// small claims.
///
/// Requires escrow_consolidated = true (consolidate_for_refund must be
/// called first so the vault contains the full refund pool).
///
/// Token-2022 burn does NOT trigger Transfer Hooks, so no remaining_accounts
/// are needed. The user signs as token authority for the burn CPI.
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.8.
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    /// The user claiming the refund. Receives SOL.
    #[account(mut)]
    pub user: Signer<'info>,

    /// CurveState PDA. Seeds: ["curve", token_mint].
    #[account(
        mut,
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump = curve_state.bump,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// Partner CurveState PDA (read-only).
    /// Required for is_refund_eligible() compound state check.
    /// Must be a different curve than curve_state.
    #[account(
        seeds = [CURVE_SEED, partner_curve_state.token_mint.as_ref()],
        bump = partner_curve_state.bump,
        constraint = partner_curve_state.key() != curve_state.key()
            @ CurveError::InvalidStatus,
    )]
    pub partner_curve_state: Account<'info, CurveState>,

    /// User's ATA for this token. Must already exist (user holds tokens).
    /// Marked mut because burn deducts from this account.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token mint (CRIME or FRAUD).
    /// Marked mut because burn reduces the mint's total_supply.
    #[account(mut)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// SOL vault PDA -- sends SOL refund to user.
    /// Seeds: ["curve_sol_vault", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds constraint.
    #[account(
        mut,
        seeds = [CURVE_SOL_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Handler for `claim_refund`.
///
/// Burns all of the user's tokens and transfers proportional SOL refund.
///
/// Steps:
/// 1. Require curve is refund-eligible (checks partner curve status).
/// 2. Require escrow has been consolidated.
/// 3. Read user balance (must be > 0).
/// 4. Read total outstanding tokens_sold (must be > 0, division guard).
/// 5. Compute refund pool = sol_vault.lamports() - rent_exempt.
/// 6. Compute proportional refund with floor rounding (protocol-favored).
/// 7. Burn ALL user tokens (Token-2022, user signs, no Transfer Hook).
/// 8. Transfer refund SOL via direct lamport manipulation.
/// 9. Update tokens_sold (denominator shrinks for next claimer).
/// 10. Emit RefundClaimed event (reads vault balance AFTER transfer).
///
/// Refund math: floor(user_balance * refund_pool / tokens_sold)
/// Uses u128 intermediates to prevent overflow.
/// Maximum: 460e12 * ~1000e9 = ~4.6e23 (well within u128 max ~3.4e38).
pub fn handler(ctx: Context<ClaimRefund>) -> Result<()> {
    let curve = &ctx.accounts.curve_state;

    // =========================================================================
    // Step 1: Refund eligibility check (requires partner curve)
    // =========================================================================
    require!(
        curve.is_refund_eligible(ctx.accounts.partner_curve_state.status),
        CurveError::NotRefundEligible
    );

    // =========================================================================
    // Step 1b: Validate partner curve identity
    //
    // The partner_curve_state.key() != curve_state.key() constraint prevents
    // self-referencing, but does NOT prevent passing an arbitrary third curve.
    // This check ensures the partner is the actual CRIME/FRAUD counterpart
    // by verifying its token_mint matches this curve's stored partner_mint.
    // =========================================================================
    require!(
        ctx.accounts.partner_curve_state.token_mint == curve.partner_mint,
        CurveError::InvalidPartnerCurve
    );

    // =========================================================================
    // Step 2: Escrow must be consolidated before any claims
    // =========================================================================
    require!(
        curve.escrow_consolidated,
        CurveError::EscrowNotConsolidated
    );

    // =========================================================================
    // Step 3: User must hold tokens
    // =========================================================================
    let user_balance = ctx.accounts.user_token_account.amount;
    require!(user_balance > 0, CurveError::NothingToBurn);

    // =========================================================================
    // Step 4: Total outstanding tokens (denominator for proportional refund)
    // =========================================================================
    let total_outstanding = curve.tokens_sold;
    require!(total_outstanding > 0, CurveError::NoTokensOutstanding);

    // =========================================================================
    // Step 5: Compute refund pool (vault balance minus rent-exempt minimum)
    // =========================================================================
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let refund_pool = ctx
        .accounts
        .sol_vault
        .lamports()
        .checked_sub(rent_exempt)
        .ok_or(CurveError::Overflow)?;

    // =========================================================================
    // Step 6: Proportional refund with floor rounding (protocol-favored)
    //
    // floor(user_balance * refund_pool / total_outstanding)
    // u128 intermediates prevent overflow.
    // =========================================================================
    let refund_amount_u128 = (user_balance as u128)
        .checked_mul(refund_pool as u128)
        .ok_or(CurveError::Overflow)?
        / (total_outstanding as u128);
    let refund_amount = u64::try_from(refund_amount_u128)
        .map_err(|_| error!(CurveError::Overflow))?;

    // =========================================================================
    // Step 7: Burn ALL tokens (Token-2022, user signs, no Transfer Hook)
    //
    // Burn does NOT trigger Transfer Hooks (confirmed).
    // Burn DOES reduce the mint's total_supply (token_mint is Mut).
    // User signs as token authority (not PDA -- no invoke_signed needed).
    // =========================================================================
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::Burn {
                mint: ctx.accounts.token_mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        user_balance,
    )?;

    // =========================================================================
    // Step 8: Transfer refund SOL (direct lamport manipulation)
    //
    // sol_vault is owned by the bonding curve program -- we can subtract.
    // user is owned by system program -- any program can credit lamports.
    // =========================================================================
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= refund_amount;
    **ctx.accounts.user.try_borrow_mut_lamports()? += refund_amount;

    // =========================================================================
    // Step 9: Update tokens_sold (denominator shrinks for next claimer)
    // =========================================================================
    let curve = &mut ctx.accounts.curve_state;
    curve.tokens_sold = curve
        .tokens_sold
        .checked_sub(user_balance)
        .ok_or(CurveError::Overflow)?;

    // =========================================================================
    // Step 10: Emit RefundClaimed event
    //
    // CRITICAL: remaining_vault_balance is read AFTER the SOL transfer.
    // Direct lamport reads reflect post-mutation state within the same
    // instruction.
    // =========================================================================
    emit!(RefundClaimed {
        user: ctx.accounts.user.key(),
        token: curve.token,
        tokens_burned: user_balance,
        refund_amount,
        remaining_tokens_sold: curve.tokens_sold,
        remaining_vault_balance: ctx.accounts.sol_vault.lamports(),
        slot: Clock::get()?.slot,
    });

    Ok(())
}
