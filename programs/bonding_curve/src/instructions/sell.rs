use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::{TaxCollected, TokensSold};
use crate::math::{calculate_sol_for_tokens, get_current_price};
use crate::state::{CurveState, CurveStatus};

/// Accounts for the `sell` instruction.
///
/// Sells tokens back to the curve, receiving SOL minus 15% tax.
/// The tax is routed to a separate escrow PDA.
///
/// Key differences from Purchase:
/// - `user_token_account` is NOT init_if_needed (seller must already hold tokens).
/// - No `associated_token_program` (we never create an ATA here).
/// - `tax_escrow` added for tax routing.
///
/// Token transfer uses manual invoke with remaining_accounts for the
/// Transfer Hook CPI chain, matching the purchase.rs pattern for consistency.
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.6.
#[derive(Accounts)]
pub struct Sell<'info> {
    /// The seller. Receives SOL minus tax.
    #[account(mut)]
    pub user: Signer<'info>,

    /// CurveState PDA -- must be Active. Seeds: ["curve", token_mint].
    #[account(
        mut,
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Active @ CurveError::CurveNotActiveForSell,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// User's ATA for this token. Must already exist (seller owns tokens).
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Curve's token vault PDA. Receives tokens back from seller.
    /// Seeds: ["curve_token_vault", token_mint].
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = curve_state,
        token::token_program = token_program,
        seeds = [CURVE_TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SOL vault PDA -- sends SOL to user and tax to escrow.
    /// Seeds: ["curve_sol_vault", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds constraint. No data stored.
    #[account(
        mut,
        seeds = [CURVE_SOL_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// Tax escrow PDA -- receives 15% sell tax.
    /// Seeds: ["tax_escrow", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds and stored tax_escrow pubkey.
    #[account(
        mut,
        seeds = [TAX_ESCROW_SEED, token_mint.key().as_ref()],
        bump,
        constraint = tax_escrow.key() == curve_state.tax_escrow @ CurveError::InvalidStatus,
    )]
    pub tax_escrow: UncheckedAccount<'info>,

    /// Token mint (CRIME or FRAUD).
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Handler for `sell`.
///
/// Implements spec Section 8.6 step by step:
///
/// 1. Status check (Active only -- also enforced by Anchor constraint)
/// 2. Balance check (user has enough tokens)
/// 3. Non-zero check
/// 4. Deadline check
/// 5. Current position (x1 = tokens_sold)
/// 6. New position (x2 = x1 - tokens_to_sell)
/// 7. Reverse integral (sol_gross = integral from x2 to x1)
/// 8. Tax computation (ceil rounding, protocol-favored)
/// 9. Net payout (sol_gross - tax)
/// 10. Slippage check (sol_net >= minimum_sol_out)
/// 11. Token transfer: user -> vault (Token-2022 with Transfer Hook)
/// 12. SOL transfer: sol_vault -> user (direct lamport manipulation)
/// 13. Tax transfer: sol_vault -> tax_escrow (direct lamport manipulation)
/// 14. Update tokens_sold
/// 15. Update cumulative counters
/// 16. Solvency assertion (defense-in-depth)
/// 17. Emit TokensSold
/// 18. Emit TaxCollected
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Sell<'info>>,
    tokens_to_sell: u64,
    minimum_sol_out: u64,
) -> Result<()> {
    let curve = &ctx.accounts.curve_state;

    // =========================================================================
    // Step 1: Status check (double-check -- Anchor constraint also enforces this)
    // =========================================================================
    require!(
        curve.status == CurveStatus::Active,
        CurveError::CurveNotActiveForSell
    );

    // =========================================================================
    // Step 2: Balance check -- seller must hold enough tokens
    // =========================================================================
    require!(
        ctx.accounts.user_token_account.amount >= tokens_to_sell,
        CurveError::InsufficientTokenBalance
    );

    // =========================================================================
    // Step 3: Non-zero check
    // =========================================================================
    require!(tokens_to_sell > 0, CurveError::ZeroAmount);

    // =========================================================================
    // Step 4: Deadline check
    // =========================================================================
    require!(
        Clock::get()?.slot <= curve.deadline_slot,
        CurveError::DeadlinePassed
    );

    // =========================================================================
    // Step 5: Current position on curve
    // =========================================================================
    let x1 = curve.tokens_sold;

    // =========================================================================
    // Step 6: New position after sell
    // =========================================================================
    let x2 = x1
        .checked_sub(tokens_to_sell)
        .ok_or(CurveError::Overflow)?;

    // =========================================================================
    // Step 7: Reverse integral -- gross SOL returned
    //
    // calculate_sol_for_tokens(x2, tokens_to_sell) computes integral from x2
    // to x2+tokens_to_sell = x1. This is the area under the price curve
    // that the seller is giving back.
    // =========================================================================
    let sol_gross = calculate_sol_for_tokens(x2, tokens_to_sell)?;

    // =========================================================================
    // Step 7b: Defense-in-depth -- gross payout must not exceed available vault balance
    //
    // Pre-transfer guard: if the reverse integral computes more SOL than the
    // vault actually holds (minus rent-exempt and solvency buffer), something
    // is wrong with the math. The buffer absorbs cumulative rounding dust from
    // calculate_sol_for_tokens() flooring (BOK Finding 1: 5-lamport gap after
    // hundreds of micro-transactions).
    // This is belt-AND-suspenders with the post-state check at step 16.
    // =========================================================================
    let vault_lamports = ctx.accounts.sol_vault.lamports();
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let reserved = rent_exempt.checked_add(SOLVENCY_BUFFER_LAMPORTS)
        .ok_or(CurveError::Overflow)?;
    let available = vault_lamports.saturating_sub(reserved);
    require!(sol_gross <= available, CurveError::VaultInsolvency);

    // =========================================================================
    // Step 8: Tax computation (ceil rounding, protocol-favored)
    //
    // CONTEXT.md explicitly overrides the spec's floor/truncation pseudocode.
    // Ceil formula: (sol_gross * SELL_TAX_BPS + (BPS_DENOMINATOR - 1)) / BPS_DENOMINATOR
    // =========================================================================
    let tax = sol_gross
        .checked_mul(SELL_TAX_BPS)
        .ok_or(CurveError::Overflow)?
        .checked_add(BPS_DENOMINATOR - 1)
        .ok_or(CurveError::Overflow)?
        / BPS_DENOMINATOR;

    // =========================================================================
    // Step 9: Net payout
    // =========================================================================
    let sol_net = sol_gross
        .checked_sub(tax)
        .ok_or(CurveError::Overflow)?;

    // =========================================================================
    // Step 10: Slippage protection
    // =========================================================================
    require!(sol_net >= minimum_sol_out, CurveError::SlippageExceeded);

    // =========================================================================
    // DEF-05: Validate Transfer Hook account count
    //
    // Token-2022 Transfer Hook requires exactly 4 remaining accounts:
    // extra_account_meta_list, whitelist PDA (source), whitelist PDA (dest), hook program.
    // Reject malformed invocations before the CPI.
    // =========================================================================
    require!(
        ctx.remaining_accounts.len() == 4,
        CurveError::InvalidHookAccounts
    );

    // =========================================================================
    // Step 11: Transfer tokens from user to vault via Token-2022 transfer_checked
    //
    // Uses manual invoke (not invoke_signed) since the user is a real signer,
    // not a PDA. Remaining_accounts are appended for Transfer Hook support.
    // This mirrors the purchase.rs pattern for consistency.
    // =========================================================================
    let mut ix = spl_token_2022::instruction::transfer_checked(
        ctx.accounts.token_program.key,
        &ctx.accounts.user_token_account.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_vault.key(),
        &ctx.accounts.user.key(),
        &[], // no multisig signers
        tokens_to_sell,
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
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.token_vault.to_account_info(),
        ctx.accounts.user.to_account_info(),
    ];
    for account_info in ctx.remaining_accounts {
        account_infos.push(account_info.clone());
    }

    // Invoke with user as signer (not PDA -- user is a real signer)
    anchor_lang::solana_program::program::invoke(&ix, &account_infos)?;

    // =========================================================================
    // Step 12: Transfer SOL_net from sol_vault to user (direct lamport manipulation)
    //
    // The sol_vault is owned by the bonding curve program, NOT the system program.
    // system_program::transfer CPI DOES NOT WORK for program-owned accounts.
    // Direct lamport manipulation is the ONLY correct approach.
    // =========================================================================
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= sol_net;
    **ctx.accounts.user.try_borrow_mut_lamports()? += sol_net;

    // =========================================================================
    // Step 13: Transfer tax from sol_vault to tax_escrow (direct lamport manipulation)
    // =========================================================================
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= tax;
    **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? += tax;

    // =========================================================================
    // Step 14: Update tokens_sold (x2 was computed as x1 - tokens_to_sell)
    // =========================================================================
    let curve = &mut ctx.accounts.curve_state;
    curve.tokens_sold = x2;

    // =========================================================================
    // Step 15: Update cumulative counters
    //
    // sol_returned tracks gross SOL (before tax) per Phase 70-02 decision.
    // This preserves the identity: vault_balance = sol_raised - sol_returned.
    // =========================================================================
    curve.sol_returned = curve
        .sol_returned
        .checked_add(sol_gross)
        .ok_or(CurveError::Overflow)?;
    curve.tokens_returned = curve
        .tokens_returned
        .checked_add(tokens_to_sell)
        .ok_or(CurveError::Overflow)?;
    curve.tax_collected = curve
        .tax_collected
        .checked_add(tax)
        .ok_or(CurveError::Overflow)?;

    // =========================================================================
    // Step 16: Post-state solvency assertion (defense-in-depth)
    //
    // The vault must hold at least the integral value of currently-sold tokens.
    // Rent-exempt minimum is subtracted from the expected value since the vault
    // was initialized with rent-exempt lamports that are not from purchases.
    //
    // If this check EVER fires, it means the math has a bug.
    // =========================================================================
    let rent = Rent::get()?;
    let rent_exempt_min = rent.minimum_balance(0);
    let expected_from_integral = calculate_sol_for_tokens(0, curve.tokens_sold)?;
    let vault_balance = ctx.accounts.sol_vault.lamports();

    require!(
        vault_balance >= expected_from_integral.saturating_sub(rent_exempt_min as u64),
        CurveError::VaultInsolvency
    );

    // =========================================================================
    // Step 17: Emit TokensSold event
    // =========================================================================
    emit!(TokensSold {
        user: ctx.accounts.user.key(),
        token: curve.token,
        tokens_sold: tokens_to_sell,
        sol_received_net: sol_net,
        tax_amount: tax,
        new_tokens_sold: curve.tokens_sold,
        current_price: get_current_price(curve.tokens_sold),
        slot: Clock::get()?.slot,
    });

    // =========================================================================
    // Step 18: Emit TaxCollected event
    // =========================================================================
    emit!(TaxCollected {
        token: curve.token,
        amount: tax,
        escrow_balance: ctx.accounts.tax_escrow.lamports(),
        slot: Clock::get()?.slot,
    });

    Ok(())
}
