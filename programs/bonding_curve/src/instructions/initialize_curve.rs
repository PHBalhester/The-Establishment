use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::CurveError;
use crate::events::CurveInitialized;
use crate::state::{BcAdminConfig, CurveState, CurveStatus, Token};

/// Accounts for the `initialize_curve` instruction.
///
/// Creates a CurveState PDA, token vault PDA, SOL vault PDA, and tax escrow PDA
/// for a single token (CRIME or FRAUD). Called once per token at deployment.
///
/// Spec reference: Bonding_Curve_Spec.md Section 8.1.
#[derive(Accounts)]
pub struct InitializeCurve<'info> {
    /// Protocol authority. Must match BcAdminConfig.authority. Pays rent for all new accounts.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// BcAdminConfig PDA -- gates admin operations.
    #[account(
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// CurveState PDA -- seeds: ["curve", token_mint].
    /// Initialized with space for the full CurveState struct.
    #[account(
        init,
        payer = authority,
        space = CurveState::LEN,
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// Token vault PDA -- holds 460M tokens for sale.
    /// Authority is the curve_state PDA (transfers out require PDA signer).
    /// Seeds: ["curve_token_vault", token_mint].
    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = curve_state,
        token::token_program = token_program,
        seeds = [CURVE_TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// SOL vault PDA -- 0-byte SOL-only account that holds raised SOL.
    /// Balance is tracked via lamports, not data fields.
    /// Seeds: ["curve_sol_vault", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds constraint. No data stored.
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [CURVE_SOL_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// Tax escrow PDA -- 0-byte SOL-only account that holds sell tax.
    /// See Bonding_Curve_Spec.md Section 5.7.
    /// Seeds: ["tax_escrow", token_mint].
    /// CHECK: SOL-only PDA, validated by seeds constraint. No data stored.
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [TAX_ESCROW_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub tax_escrow: UncheckedAccount<'info>,

    /// Token mint (CRIME or FRAUD). Validated via feature-gated constraint.
    /// In localnet mode, any mint is accepted for testing flexibility.
    #[account(
        mint::token_program = token_program,
        constraint = cfg!(feature = "localnet")
            || token_mint.key() == crime_mint()
            || token_mint.key() == fraud_mint()
            @ crate::error::CurveError::InvalidStatus,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Handler for `initialize_curve`.
///
/// Sets all CurveState fields per spec Section 8.1:
/// - Status = Initialized
/// - All counters zeroed
/// - PDA keys stored for downstream lookups
/// - Bump stored for PDA signing in future instructions
pub fn handler(ctx: Context<InitializeCurve>, token: Token, partner_mint: Pubkey) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    curve.token = token;
    curve.token_mint = ctx.accounts.token_mint.key();
    curve.token_vault = ctx.accounts.token_vault.key();
    curve.sol_vault = ctx.accounts.sol_vault.key();
    curve.tokens_sold = 0;
    curve.sol_raised = 0;
    curve.status = CurveStatus::Initialized;
    curve.start_slot = 0;
    curve.deadline_slot = 0;
    curve.participant_count = 0;
    curve.tokens_returned = 0;
    curve.sol_returned = 0;
    curve.tax_collected = 0;
    curve.tax_escrow = ctx.accounts.tax_escrow.key();
    curve.bump = ctx.bumps.curve_state;
    curve.escrow_consolidated = false;
    curve.partner_mint = partner_mint;

    emit!(CurveInitialized {
        token,
        token_mint: curve.token_mint,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
