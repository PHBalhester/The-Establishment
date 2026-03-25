use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::{CurveFilled, TokensPurchased};
use crate::math::{calculate_sol_for_tokens, calculate_tokens_out, get_current_price};
use crate::state::{CurveState, CurveStatus};

/// Accounts for the `purchase` instruction.
///
/// Buys tokens from the curve by sending SOL. Open access -- no whitelist required.
/// The user's ATA is init_if_needed so first-time buyers don't need a separate setup TX.
///
/// Token transfer uses manual invoke_signed with transfer_checked to forward
/// remaining_accounts for the Transfer Hook CPI chain (CRIME/FRAUD use Token-2022 hooks).
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.5.
#[derive(Accounts)]
pub struct Purchase<'info> {
    /// The buyer. Pays SOL and receives tokens.
    #[account(mut)]
    pub user: Signer<'info>,

    /// CurveState PDA -- must be Active. Seeds: ["curve", token_mint].
    #[account(
        mut,
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Active @ CurveError::CurveNotActive,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// User's ATA for this token. Created if it doesn't exist (init_if_needed).
    /// Used for wallet cap enforcement (read balance before transfer).
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Curve's token vault PDA. Authority is curve_state PDA.
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

    /// SOL vault PDA -- 0-byte SOL-only account that holds raised SOL.
    /// Seeds: ["curve_sol_vault", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds constraint. No data stored.
    #[account(
        mut,
        seeds = [CURVE_SOL_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// Token mint (CRIME or FRAUD).
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Handler for `purchase`.
///
/// Implements spec Section 8.5 step by step:
///
/// 1. Deadline check (clock.slot <= deadline_slot)
/// 2. Minimum purchase check (sol_amount >= MIN_PURCHASE_SOL)
/// 3. Calculate tokens via curve integral (calculate_tokens_out)
/// 4. Dust buy protection (tokens_out > 0)
/// 5. Wallet cap check (ATA balance + tokens_out <= MAX_TOKENS_PER_WALLET)
/// 6. Supply cap / partial fill (actual_tokens = min(tokens_out, remaining))
/// 7. Recalculate SOL for partial fill (calculate_sol_for_tokens)
/// 8. Re-check wallet cap with actual_tokens
/// 9. Slippage check (actual_tokens >= minimum_tokens_out)
/// 10. SOL transfer: system_program::transfer from user to sol_vault
/// 11. Token transfer: invoke_signed with transfer_checked + remaining_accounts for hook
/// 12. Participant count: increment if ATA was empty before transfer
/// 13. Update state: tokens_sold += actual, sol_raised += actual
/// 14. Status transition: if tokens_sold >= TARGET_TOKENS -> Filled
/// 15. Emit events
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Purchase<'info>>,
    sol_amount: u64,
    minimum_tokens_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let curve = &ctx.accounts.curve_state;

    // =========================================================================
    // Step 1: Deadline check
    // =========================================================================
    require!(
        clock.slot <= curve.deadline_slot,
        CurveError::DeadlinePassed
    );

    // =========================================================================
    // Step 2: Minimum purchase check
    // =========================================================================
    require!(
        sol_amount >= MIN_PURCHASE_SOL,
        CurveError::BelowMinimum
    );

    // =========================================================================
    // Step 3: Calculate tokens via curve integral
    // =========================================================================
    let tokens_out = calculate_tokens_out(sol_amount, curve.tokens_sold)?;

    // =========================================================================
    // Step 4: Dust buy protection -- if SOL is too small for even 1 token
    // =========================================================================
    require!(tokens_out > 0, CurveError::InsufficientTokensOut);

    // =========================================================================
    // Step 5: Wallet cap check (pre-partial fill)
    // =========================================================================
    let user_ata_balance = ctx.accounts.user_token_account.amount;
    require!(
        user_ata_balance
            .checked_add(tokens_out)
            .ok_or(CurveError::Overflow)?
            <= MAX_TOKENS_PER_WALLET,
        CurveError::WalletCapExceeded
    );

    // =========================================================================
    // Step 6: Supply cap / partial fill
    // =========================================================================
    let remaining = TARGET_TOKENS
        .checked_sub(curve.tokens_sold)
        .ok_or(CurveError::CurveAlreadyFilled)?;

    let actual_tokens = std::cmp::min(tokens_out, remaining);

    // =========================================================================
    // Step 7: Recalculate SOL for partial fill
    //
    // If the user wanted more tokens than remaining, they only pay for the
    // actual tokens they receive (proportional SOL).
    // =========================================================================
    let actual_sol = if actual_tokens < tokens_out {
        calculate_sol_for_tokens(curve.tokens_sold, actual_tokens)?
    } else {
        sol_amount
    };

    // =========================================================================
    // Step 7b: Defense-in-depth -- actual_sol must never exceed user's input
    //
    // If a math bug in calculate_sol_for_tokens returns more SOL than the user
    // sent, this catches it before the transfer. Should never fire; if it does,
    // the curve integral has a bug.
    // =========================================================================
    require!(actual_sol <= sol_amount, CurveError::PartialFillOvercharge);

    // =========================================================================
    // Step 8: Re-check wallet cap with actual_tokens (may differ from tokens_out)
    // =========================================================================
    require!(
        user_ata_balance
            .checked_add(actual_tokens)
            .ok_or(CurveError::Overflow)?
            <= MAX_TOKENS_PER_WALLET,
        CurveError::WalletCapExceeded
    );

    // =========================================================================
    // Step 9: Slippage protection
    // =========================================================================
    require!(
        actual_tokens >= minimum_tokens_out,
        CurveError::SlippageExceeded
    );

    // =========================================================================
    // Step 10: Transfer SOL from user to sol_vault
    // =========================================================================
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        actual_sol,
    )?;

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
    // Step 11: Transfer tokens from vault to user via Token-2022 transfer_checked
    //
    // CRITICAL: We use manual invoke_signed instead of Anchor's CPI helper because
    // anchor_spl::token_2022::transfer_checked does NOT properly forward
    // remaining_accounts through the Transfer Hook CPI chain.
    //
    // The curve_state PDA is the token vault authority. Signer seeds:
    //   ["curve", token_mint.key().as_ref(), &[curve_state.bump]]
    // =========================================================================
    let token_mint_key = ctx.accounts.token_mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        CURVE_SEED,
        token_mint_key.as_ref(),
        &[ctx.accounts.curve_state.bump],
    ]];

    // Build the base transfer_checked instruction
    let mut ix = spl_token_2022::instruction::transfer_checked(
        ctx.accounts.token_program.key,
        &ctx.accounts.token_vault.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.user_token_account.key(),
        &ctx.accounts.curve_state.key(),
        &[], // no multisig signers
        actual_tokens,
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
        ctx.accounts.token_vault.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.curve_state.to_account_info(),
    ];
    for account_info in ctx.remaining_accounts {
        account_infos.push(account_info.clone());
    }

    // Invoke with PDA signer so Token-2022 can find hook accounts
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &account_infos,
        signer_seeds,
    )?;

    // =========================================================================
    // Step 12: Participant count -- increment on first purchase
    //
    // If the user's ATA was empty before this transfer, this is their first
    // purchase on this curve. Increment participant_count.
    //
    // Note: If a user sells all tokens and buys again, the ATA balance is 0
    // again and participant_count increments again. Per spec, this is acceptable
    // -- participant_count is a convenience stat, not security-critical.
    // =========================================================================
    let curve = &mut ctx.accounts.curve_state;

    if user_ata_balance == 0 {
        curve.participant_count = curve.participant_count.saturating_add(1);
    }

    // =========================================================================
    // Step 13: Update state -- checked arithmetic to prevent overflow
    // =========================================================================
    curve.tokens_sold = curve
        .tokens_sold
        .checked_add(actual_tokens)
        .ok_or(CurveError::Overflow)?;

    curve.sol_raised = curve
        .sol_raised
        .checked_add(actual_sol)
        .ok_or(CurveError::Overflow)?;

    // =========================================================================
    // Step 14: Status transition -- Filled when target reached
    // =========================================================================
    if curve.tokens_sold >= TARGET_TOKENS {
        curve.status = CurveStatus::Filled;

        emit!(CurveFilled {
            token: curve.token,
            total_sold: curve.tokens_sold,
            total_raised: curve.sol_raised,
            slot: clock.slot,
        });
    }

    // =========================================================================
    // Step 15: Emit TokensPurchased event
    // =========================================================================
    emit!(TokensPurchased {
        user: ctx.accounts.user.key(),
        token: curve.token,
        sol_spent: actual_sol,
        tokens_received: actual_tokens,
        new_tokens_sold: curve.tokens_sold,
        current_price: get_current_price(curve.tokens_sold),
        slot: clock.slot,
    });

    Ok(())
}
