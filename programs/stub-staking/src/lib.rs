//! Stub Staking Program for testing Epoch Program CPI integration.
//!
//! This program provides a minimal staking interface that Epoch Program can
//! CPI into during `consume_randomness`. It tracks epoch finalization state
//! without implementing full staking logic (which is a future milestone).
//!
//! Instructions:
//! - `initialize`: Create the StubStakePool PDA
//! - `update_cumulative`: Called by Epoch Program via CPI to record epoch finalization
//!
//! Security:
//! - `update_cumulative` uses `seeds::program = epoch_program_id()` constraint
//!   to ensure only Epoch Program can call it with a valid staking_authority PDA
//!
//! Source: 24-RESEARCH.md, Epoch_State_Machine_Spec.md

use anchor_lang::prelude::*;

pub mod errors;
pub mod state;

use errors::StubStakingError;
use state::StubStakePool;

declare_id!("StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU");

/// Seed for the stake pool PDA.
pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";

/// Seed for the staking authority PDA in Epoch Program.
/// CRITICAL: Must match Epoch Program's staking_authority derivation.
pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";

/// Returns the Epoch Program ID for cross-program PDA verification.
///
/// This must match the declare_id! in Epoch Program.
/// Used in seeds::program constraint to verify CPI caller.
pub fn epoch_program_id() -> Pubkey {
    pubkey!("4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2")
}

#[program]
pub mod stub_staking {
    use super::*;

    /// Initialize the stub stake pool.
    ///
    /// Called once at deployment to create the StubStakePool PDA.
    /// Sets all tracking fields to zero and marks as initialized.
    ///
    /// # Accounts
    /// - `payer`: Pays for account creation
    /// - `stake_pool`: StubStakePool PDA to initialize
    /// - `system_program`: Required for account creation
    ///
    /// # Errors
    /// - None (Anchor handles duplicate initialization via init constraint)
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let stake_pool = &mut ctx.accounts.stake_pool;

        stake_pool.cumulative_epochs = 0;
        stake_pool.last_epoch = 0;
        stake_pool.total_yield_distributed = 0;
        stake_pool.initialized = true;
        stake_pool.bump = ctx.bumps.stake_pool;

        msg!("StubStakePool initialized");

        Ok(())
    }

    /// Update cumulative epoch tracking (CPI-gated).
    ///
    /// Called by Epoch Program via CPI during consume_randomness.
    /// Records that an epoch has been finalized and increments counters.
    ///
    /// # Access Control
    /// The `epoch_authority` account MUST be a PDA derived from Epoch Program
    /// with seeds = ["staking_authority"]. This is enforced via the
    /// `seeds::program = epoch_program_id()` constraint.
    ///
    /// # Arguments
    /// - `epoch`: The epoch number being finalized (u32)
    ///
    /// # Errors
    /// - `NotInitialized`: Stake pool not initialized
    /// - `AlreadyUpdated`: Epoch <= last_epoch (double-finalization protection)
    /// - `Overflow`: Arithmetic overflow (extremely unlikely)
    pub fn update_cumulative(ctx: Context<UpdateCumulative>, epoch: u32) -> Result<()> {
        let stake_pool = &mut ctx.accounts.stake_pool;

        // Validate stake pool is initialized
        require!(stake_pool.initialized, StubStakingError::NotInitialized);

        // Prevent double-finalization: epoch must be greater than last_epoch
        let epoch_u64 = epoch as u64;
        require!(
            epoch_u64 > stake_pool.last_epoch,
            StubStakingError::AlreadyUpdated
        );

        // Update tracking fields
        stake_pool.cumulative_epochs = stake_pool
            .cumulative_epochs
            .checked_add(1)
            .ok_or(StubStakingError::Overflow)?;

        stake_pool.last_epoch = epoch_u64;

        // Placeholder yield distribution (increment by 1 as stub)
        stake_pool.total_yield_distributed = stake_pool
            .total_yield_distributed
            .checked_add(1)
            .ok_or(StubStakingError::Overflow)?;

        // Emit event
        emit!(CumulativeUpdated {
            epoch,
            cumulative_epochs: stake_pool.cumulative_epochs,
        });

        msg!(
            "Cumulative updated: epoch={}, total={}",
            epoch,
            stake_pool.cumulative_epochs
        );

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account structs
// ---------------------------------------------------------------------------

/// Accounts for initialize instruction.
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Stub stake pool PDA.
    /// Seeds: ["stake_pool"]
    #[account(
        init,
        payer = payer,
        space = StubStakePool::LEN,
        seeds = [STAKE_POOL_SEED],
        bump,
    )]
    pub stake_pool: Account<'info, StubStakePool>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Accounts for update_cumulative instruction (CPI-gated).
#[derive(Accounts)]
pub struct UpdateCumulative<'info> {
    /// Epoch Program's staking authority PDA.
    ///
    /// CRITICAL SECURITY: seeds::program ensures this PDA is derived from Epoch Program.
    /// Only Epoch Program can produce a valid signer with these seeds.
    ///
    /// CROSS-PROGRAM DEPENDENCY:
    /// - STAKING_AUTHORITY_SEED must match Epoch Program's derivation
    /// - epoch_program_id() must match Epoch Program's declare_id!
    /// - If either mismatch, update_cumulative will reject all Epoch Program calls
    ///
    /// CHECK: PDA derived from Epoch Program seeds, validated by seeds::program constraint
    #[account(
        seeds = [STAKING_AUTHORITY_SEED],
        bump,
        seeds::program = epoch_program_id(),
    )]
    pub epoch_authority: Signer<'info>,

    /// Stub stake pool PDA.
    /// Seeds: ["stake_pool"]
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED],
        bump = stake_pool.bump,
    )]
    pub stake_pool: Account<'info, StubStakePool>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when cumulative epoch tracking is updated.
#[event]
pub struct CumulativeUpdated {
    /// The epoch number that was finalized.
    pub epoch: u32,

    /// Total number of epochs finalized.
    pub cumulative_epochs: u64,
}
