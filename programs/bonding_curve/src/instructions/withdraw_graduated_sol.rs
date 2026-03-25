use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::CurveError;
use crate::events::SolWithdrawn;
use crate::state::{BcAdminConfig, CurveState, CurveStatus};

/// Accounts for the `withdraw_graduated_sol` instruction.
///
/// Admin-only instruction to withdraw all SOL (minus rent-exempt minimum)
/// from a graduated curve's SOL vault.
///
/// Used during graduation orchestration (Phase 74) to extract ~1000 SOL
/// from each curve's SOL vault for AMM pool seeding.
///
/// Why direct lamport manipulation? The sol_vault is a program-owned PDA
/// (owned by the bonding_curve program). The Solana runtime allows programs
/// to freely modify lamports of accounts they own. No CPI to system_program
/// needed. Same pattern as claim_refund.rs.
///
/// Security: Only callable on Graduated curves (terminal state). The Graduated
/// status is irreversible -- no future operations depend on the SOL vault balance.
/// Authority signer requirement prevents unauthorized withdrawal.
#[derive(Accounts)]
pub struct WithdrawGraduatedSol<'info> {
    /// Protocol authority (deployer). Must match BcAdminConfig.authority. Receives SOL.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// BcAdminConfig PDA -- gates admin operations.
    #[account(
        seeds = [BC_ADMIN_SEED],
        bump = admin_config.bump,
        has_one = authority @ CurveError::Unauthorized,
    )]
    pub admin_config: Account<'info, BcAdminConfig>,

    /// CurveState PDA -- must be Graduated.
    /// Seeds: ["curve", token_mint].
    #[account(
        seeds = [CURVE_SEED, curve_state.token_mint.as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Graduated @ CurveError::CurveNotGraduated,
    )]
    pub curve_state: Account<'info, CurveState>,

    /// SOL vault PDA -- source of SOL.
    /// Seeds: ["curve_sol_vault", token_mint]. Validated against curve_state.sol_vault.
    /// CHECK: SOL-only PDA, validated by seeds + constraint.
    #[account(
        mut,
        seeds = [CURVE_SOL_VAULT_SEED, curve_state.token_mint.as_ref()],
        bump,
        constraint = sol_vault.key() == curve_state.sol_vault @ CurveError::InvalidStatus,
    )]
    pub sol_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Handler for `withdraw_graduated_sol`.
///
/// Withdraws all SOL from the graduated curve's SOL vault, leaving only
/// the rent-exempt minimum. Idempotent: returns Ok if nothing to withdraw.
///
/// Steps:
/// 1. Compute rent-exempt minimum for 0-byte account.
/// 2. Calculate withdrawable amount (balance - rent).
/// 3. If nothing to withdraw, return early (idempotent).
/// 4. Transfer lamports from sol_vault to authority (direct manipulation).
/// 5. Emit SolWithdrawn event.
pub fn handler(ctx: Context<WithdrawGraduatedSol>) -> Result<()> {
    // Step 1: Rent-exempt minimum for a 0-byte account.
    let rent = Rent::get()?.minimum_balance(0);

    // Step 2: Calculate withdrawable amount.
    let vault_balance = ctx.accounts.sol_vault.lamports();
    let withdrawable = vault_balance.checked_sub(rent).unwrap_or(0);

    // Step 3: Idempotent -- if already withdrawn or only rent remains, no-op.
    if withdrawable == 0 {
        return Ok(());
    }

    // Step 4: Direct lamport manipulation (sol_vault is program-owned PDA).
    // Same pattern as claim_refund.rs -- program can freely modify lamports
    // of accounts it owns.
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= withdrawable;
    **ctx.accounts.authority.try_borrow_mut_lamports()? += withdrawable;

    // Step 5: Emit event for indexers/monitoring.
    emit!(SolWithdrawn {
        token_mint: ctx.accounts.curve_state.token_mint,
        amount: withdrawable,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
