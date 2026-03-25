//! Dr Fraudsworth Bonding Curve
//!
//! Linear price discovery for CRIME and FRAUD tokens.
//! Two independent curves with deterministic pricing, per-wallet caps,
//! sell-back with 15% tax, and automatic graduation to AMM pools.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::Token;

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Dr Fraudsworth's Finance Factory",
    project_url: "https://fraudsworth.fun",
    contacts: "email:drfraudsworth@gmail.com,twitter:@fraudsworth",
    policy: "https://fraudsworth.fun/docs/security/security-policy",
    preferred_languages: "en",
    auditors: "Internal audits: SOS, BOK, VulnHunter (v1.3)",
    expiry: "2027-03-20"
}

declare_id!("DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV");

#[program]
pub mod bonding_curve {
    use super::*;

    /// Initialize the BcAdminConfig PDA. Only callable by the program's
    /// upgrade authority (verified via ProgramData). Stores the admin pubkey
    /// that gates all admin-only instructions.
    pub fn initialize_bc_admin(ctx: Context<InitializeBcAdmin>, admin: Pubkey) -> Result<()> {
        instructions::initialize_bc_admin::handler(ctx, admin)
    }

    /// Transfer the admin authority to a new pubkey (e.g., Squads multisig vault).
    /// Only the current authority can call this. new_authority must not be Pubkey::default().
    pub fn transfer_bc_admin(ctx: Context<TransferBcAdmin>, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_bc_admin::handler(ctx, new_authority)
    }

    /// Permanently burn the admin key by setting authority to Pubkey::default().
    /// After this, all admin-gated instructions become permanently uncallable.
    /// Irreversible. Only the current authority can call this.
    pub fn burn_bc_admin(ctx: Context<BurnBcAdmin>) -> Result<()> {
        instructions::burn_bc_admin::handler(ctx)
    }

    /// Initialize a CurveState PDA for a given token (CRIME or FRAUD).
    /// Creates the curve in `Initialized` status with all counters zeroed.
    /// Also creates token vault, SOL vault, and tax escrow PDAs.
    /// Admin-only: only the protocol authority can call this.
    pub fn initialize_curve(ctx: Context<InitializeCurve>, token: Token, partner_mint: Pubkey) -> Result<()> {
        instructions::initialize_curve::handler(ctx, token, partner_mint)
    }

    /// Fund the curve's token vault with the 460M tokens for sale.
    /// Must be called after initialize_curve and before start_curve.
    /// Accepts remaining_accounts for Transfer Hook support.
    pub fn fund_curve<'info>(
        ctx: Context<'_, '_, 'info, 'info, FundCurve<'info>>,
    ) -> Result<()> {
        instructions::fund_curve::handler(ctx)
    }

    /// Activate the curve: sets status to Active, records start_slot and deadline_slot.
    /// Validates that the token vault is fully funded before activation.
    pub fn start_curve(ctx: Context<StartCurve>) -> Result<()> {
        instructions::start_curve::handler(ctx)
    }

    /// Purchase tokens from the curve with SOL.
    /// Walks the linear price curve forward, enforces per-wallet cap and minimum purchase.
    /// Accepts remaining_accounts for Transfer Hook support (CRIME/FRAUD use Token-2022 hooks).
    pub fn purchase<'info>(
        ctx: Context<'_, '_, 'info, 'info, Purchase<'info>>,
        sol_amount: u64,
        minimum_tokens_out: u64,
    ) -> Result<()> {
        instructions::purchase::handler(ctx, sol_amount, minimum_tokens_out)
    }

    /// Sell tokens back to the curve for SOL minus 15% tax.
    /// Tax is routed to a separate escrow PDA.
    /// Accepts remaining_accounts for Transfer Hook support.
    pub fn sell<'info>(
        ctx: Context<'_, '_, 'info, 'info, Sell<'info>>,
        tokens_to_sell: u64,
        minimum_sol_out: u64,
    ) -> Result<()> {
        instructions::sell::handler(ctx, tokens_to_sell, minimum_sol_out)
    }

    /// Mark a curve as Failed after deadline + grace buffer expires.
    /// Permissionless: anyone can call once the deadline has passed.
    pub fn mark_failed(ctx: Context<MarkFailed>) -> Result<()> {
        instructions::mark_failed::handler(ctx)
    }

    /// Transition both curves from Filled to Graduated.
    /// Admin-only: only the protocol deployer can call.
    pub fn prepare_transition(ctx: Context<PrepareTransition>) -> Result<()> {
        instructions::prepare_transition::handler(ctx)
    }

    /// Distribute tax escrow SOL to the carnage fund after graduation.
    /// Permissionless: anyone can call once the curve has graduated.
    pub fn distribute_tax_escrow(ctx: Context<DistributeTaxEscrow>) -> Result<()> {
        instructions::distribute_tax_escrow::handler(ctx)
    }

    /// Consolidate tax escrow into SOL vault for refunds.
    /// Permissionless: anyone can call once the curve is refund-eligible.
    pub fn consolidate_for_refund(ctx: Context<ConsolidateForRefund>) -> Result<()> {
        instructions::consolidate_for_refund::handler(ctx)
    }

    /// Burn tokens and claim proportional SOL refund.
    /// User-signed: burns the caller's entire token balance.
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        instructions::claim_refund::handler(ctx)
    }

    /// Withdraw SOL from a graduated curve's SOL vault.
    /// Admin-only: only the protocol deployer can call.
    /// Leaves rent-exempt minimum in vault. Idempotent.
    pub fn withdraw_graduated_sol(ctx: Context<WithdrawGraduatedSol>) -> Result<()> {
        instructions::withdraw_graduated_sol::handler(ctx)
    }

    /// Close a graduated curve's empty token vault, recovering rent to admin.
    /// Admin-only: only the protocol deployer can call.
    /// Vault must have 0 token balance.
    pub fn close_token_vault(ctx: Context<CloseTokenVault>) -> Result<()> {
        instructions::close_token_vault::handler(ctx)
    }
}
