//! Dr Fraudsworth Epoch Program
//!
//! VRF-driven tax regime coordination and Carnage Fund execution.
//!
//! The Epoch Program manages:
//! - 30-minute epoch transitions with Switchboard VRF
//! - Dynamic tax rates (1-4% low, 11-14% high)
//! - 75% flip probability between CRIME/FRAUD cheap sides
//! - ~4.3% Carnage trigger probability per epoch
//!
//! Source: Epoch_State_Machine_Spec.md

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod state;

use instructions::*;

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

declare_id!("4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2");

#[program]
pub mod epoch_program {
    use super::*;

    /// Initialize the global epoch state.
    ///
    /// Called once at protocol deployment. Sets up genesis configuration
    /// with CRIME as the cheap side, 3% low tax, 14% high tax.
    ///
    /// # Arguments
    /// None - all values are hardcoded for genesis.
    ///
    /// # Errors
    /// - `AlreadyInitialized` if called more than once
    pub fn initialize_epoch_state(ctx: Context<InitializeEpochState>) -> Result<()> {
        instructions::initialize_epoch_state::handler(ctx)
    }

    /// Trigger an epoch transition.
    ///
    /// Called permissionlessly when epoch boundary is reached. Validates and
    /// binds a Switchboard randomness account for anti-reroll protection.
    /// Client must bundle this with Switchboard SDK commitIx.
    ///
    /// This is the first instruction in the VRF three-transaction flow:
    /// 1. TX 1: Client creates randomness account (separate transaction)
    /// 2. TX 2: Client bundles SDK commitIx + trigger_epoch_transition
    /// 3. TX 3: Client bundles SDK revealIx + consume_randomness
    ///
    /// # Accounts
    /// - `payer`: Anyone, receives 0.001 SOL bounty from Carnage SOL vault
    /// - `epoch_state`: Global epoch state (mutated)
    /// - `carnage_sol_vault`: Carnage SOL vault PDA (funds bounty via invoke_signed)
    /// - `randomness_account`: Switchboard On-Demand account
    ///
    /// # Errors
    /// - `EpochBoundaryNotReached` if current slot hasn't passed next epoch boundary
    /// - `VrfAlreadyPending` if a VRF request is already in progress
    /// - `RandomnessParseError` if randomness account data is invalid
    /// - `RandomnessExpired` if seed_slot is stale (> 1 slot behind)
    /// - `RandomnessAlreadyRevealed` if randomness was already revealed
    pub fn trigger_epoch_transition(ctx: Context<TriggerEpochTransition>) -> Result<()> {
        instructions::trigger_epoch_transition::handler(ctx)
    }

    /// Consume revealed VRF randomness and update taxes.
    ///
    /// Called after Switchboard oracle has revealed randomness (~3 slots after trigger).
    /// Verifies anti-reroll protection, reads VRF bytes, derives tax rates.
    /// Client must bundle this with Switchboard SDK revealIx.
    ///
    /// This is the third instruction in the VRF three-transaction flow:
    /// 1. TX 1: Client creates randomness account (separate transaction)
    /// 2. TX 2: Client bundles SDK commitIx + trigger_epoch_transition
    /// 3. TX 3: Client bundles SDK revealIx + consume_randomness (this instruction)
    ///
    /// # Accounts
    /// - `caller`: Anyone
    /// - `epoch_state`: Global epoch state (mutated)
    /// - `randomness_account`: Same Switchboard account from trigger (verified)
    ///
    /// # Errors
    /// - `NoVrfPending` if no VRF request is pending
    /// - `RandomnessAccountMismatch` if account doesn't match bound account (anti-reroll)
    /// - `RandomnessParseError` if randomness account data is invalid
    /// - `RandomnessNotRevealed` if oracle hasn't revealed yet
    /// - `InsufficientRandomness` if less than 6 bytes revealed
    pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
        instructions::consume_randomness::handler(ctx)
    }

    /// Retry VRF after timeout.
    ///
    /// Called permissionlessly if oracle fails to reveal within 300 slots (~2 min).
    /// Replaces the stale randomness account with a fresh one.
    /// Client must bundle this with Switchboard SDK commitIx.
    ///
    /// This is a recovery mechanism to prevent protocol deadlock. If the original
    /// oracle fails to reveal, anyone can call this instruction with a new
    /// randomness account to restart the VRF process.
    ///
    /// # Accounts
    /// - `payer`: Anyone
    /// - `epoch_state`: Global epoch state (mutated)
    /// - `randomness_account`: Fresh Switchboard account
    ///
    /// # Errors
    /// - `NoVrfPending` if no VRF request is pending
    /// - `VrfTimeoutNotElapsed` if 300 slots haven't passed since original request
    /// - `RandomnessParseError` if randomness account data is invalid
    /// - `RandomnessExpired` if seed_slot is stale
    /// - `RandomnessAlreadyRevealed` if randomness was already revealed
    pub fn retry_epoch_vrf(ctx: Context<RetryEpochVrf>) -> Result<()> {
        instructions::retry_epoch_vrf::handler(ctx)
    }

    /// Initialize the Carnage Fund.
    ///
    /// Called once at protocol deployment. Creates the Carnage Fund state
    /// account and token vaults for CRIME and FRAUD.
    ///
    /// The SOL vault is a SystemAccount PDA that will hold native lamports
    /// from protocol fees. The token vaults are Token-2022 accounts that
    /// will hold purchased tokens before burning.
    ///
    /// # Accounts
    /// - `authority`: Deployer (pays for account creation)
    /// - `carnage_state`: Carnage Fund state PDA (created)
    /// - `sol_vault`: SOL vault PDA (SystemAccount)
    /// - `crime_vault`: CRIME token vault PDA (Token-2022, created)
    /// - `fraud_vault`: FRAUD token vault PDA (Token-2022, created)
    /// - `crime_mint`: CRIME token mint
    /// - `fraud_mint`: FRAUD token mint
    /// - `token_program`: Token-2022 program
    /// - `system_program`: System program
    ///
    /// # Errors
    /// - `CarnageAlreadyInitialized` if called more than once
    pub fn initialize_carnage_fund(ctx: Context<InitializeCarnageFund>) -> Result<()> {
        instructions::initialize_carnage_fund::handler(ctx)
    }

    /// Execute pending Carnage (fallback).
    ///
    /// Called permissionlessly when atomic Carnage execution failed.
    /// Must be called within 100 slots of the failure (carnage_deadline_slot).
    ///
    /// This instruction performs the same execution as atomic Carnage:
    /// 1. If holdings exist and action = Burn: burn tokens, then buy target
    /// 2. If holdings exist and action = Sell: sell tokens to SOL, then buy target
    /// 3. If no holdings: just buy target token
    ///
    /// All swaps are tax-exempt (0% tax, 1% LP fee only).
    ///
    /// # Accounts
    /// - `caller`: Anyone (permissionless)
    /// - `epoch_state`: Global epoch state (has pending flags)
    /// - `carnage_state`: Carnage Fund state (updated)
    /// - `sol_vault`: Carnage SOL vault
    ///
    /// # Errors
    /// - `NoCarnagePending` if no Carnage execution is pending
    /// - `CarnageDeadlineExpired` if current_slot > carnage_deadline_slot
    /// - `CarnageNotInitialized` if Carnage Fund not initialized
    ///
    /// Source: Carnage_Fund_Spec.md Section 13.3
    pub fn execute_carnage<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteCarnage<'info>>,
    ) -> Result<()> {
        instructions::execute_carnage::handler(ctx)
    }

    /// Execute Carnage atomically (primary path).
    ///
    /// Called immediately after consume_randomness when Carnage is triggered.
    /// Typically bundled in the same transaction for MEV protection.
    ///
    /// This instruction executes the full Carnage flow:
    /// 1. If holdings exist and action = Burn: burn tokens, then buy target
    /// 2. If holdings exist and action = Sell: sell tokens to SOL via Tax::swap_exempt, then buy target
    /// 3. If no holdings: just buy target token via Tax::swap_exempt
    ///
    /// All swaps are tax-exempt (0% tax, 1% LP fee only) via Tax::swap_exempt.
    /// Swap amount capped at MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL).
    ///
    /// CRITICAL CPI DEPTH: This path reaches Solana's 4-level limit:
    ///   execute_carnage_atomic -> Tax::swap_exempt -> AMM::swap_sol_pool
    ///   -> Token-2022::transfer_checked -> Transfer Hook::execute
    ///
    /// # Accounts
    /// - `caller`: Anyone (permissionless when carnage_pending = true)
    /// - `epoch_state`: Global epoch state (has pending Carnage flags)
    /// - `carnage_state`: Carnage Fund state (updated with holdings/stats)
    /// - `carnage_signer`: PDA that signs Tax::swap_exempt calls
    /// - `sol_vault`: Carnage SOL vault (native lamports)
    /// - `carnage_wsol`: Carnage WSOL account for swap operations
    /// - `crime_vault`: Carnage CRIME vault (Token-2022)
    /// - `fraud_vault`: Carnage FRAUD vault (Token-2022)
    /// - `target_pool`: AMM pool for target token
    /// - `pool_vault_a/b`: Pool vaults
    /// - `mint_a/b`: Token mints
    /// - `tax_program`: Tax Program for swap_exempt CPI
    /// - `amm_program`: AMM Program (passed through to Tax)
    /// - `token_program_a/b`: Token programs
    /// - `system_program`: System program
    ///
    /// # Errors
    /// - `NoCarnagePending` if carnage_pending = false
    /// - `CarnageNotInitialized` if Carnage Fund not initialized
    /// - `InvalidCarnageTargetPool` if target pool doesn't match pending target
    /// - `Overflow` if statistics overflow
    ///
    /// Source: Carnage_Fund_Spec.md Sections 8-10, 13.2
    pub fn execute_carnage_atomic<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteCarnageAtomic<'info>>,
    ) -> Result<()> {
        instructions::execute_carnage_atomic::handler(ctx)
    }

    /// Expire pending Carnage after deadline.
    ///
    /// Called permissionlessly after the 100-slot deadline has passed.
    /// Clears the pending Carnage state. SOL is retained in vault for
    /// the next Carnage trigger.
    ///
    /// This instruction does NOT execute Carnage - it simply clears the
    /// pending state so the protocol can continue. The accumulated SOL
    /// remains in the Carnage vault and will be used on the next trigger.
    ///
    /// # Accounts
    /// - `caller`: Anyone (permissionless)
    /// - `epoch_state`: Global epoch state (pending flags cleared)
    /// - `carnage_state`: Carnage Fund state (read for vault balance)
    /// - `sol_vault`: Carnage SOL vault (read for balance in event)
    ///
    /// # Errors
    /// - `NoCarnagePending` if no Carnage execution is pending
    /// - `CarnageDeadlineNotExpired` if current_slot <= carnage_deadline_slot
    ///
    /// Source: Carnage_Fund_Spec.md Section 13.4
    pub fn expire_carnage(ctx: Context<ExpireCarnage>) -> Result<()> {
        instructions::expire_carnage::handler(ctx)
    }

    /// DEVNET ONLY: Force Carnage pending state for testing.
    ///
    /// Admin-gated test helper that sets carnage_pending on EpochState
    /// without waiting for a natural VRF trigger. Allows rapid testing
    /// of all Carnage execution paths (Burn, Sell, BuyOnly).
    ///
    /// MUST BE REMOVED BEFORE MAINNET DEPLOYMENT.
    ///
    /// # Arguments
    /// - `target`: 0 = CRIME, 1 = FRAUD
    /// - `action`: 0 = None (BuyOnly), 1 = Burn, 2 = Sell
    #[cfg(feature = "devnet")]
    pub fn force_carnage(ctx: Context<ForceCarnage>, target: u8, action: u8) -> Result<()> {
        instructions::force_carnage::handler(ctx, target, action)
    }
}

// ---------------------------------------------------------------------------
// IDL Verification Tests (CTG-02)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #[test]
    fn force_carnage_excluded_from_non_devnet_idl() {
        // Read the IDL file generated by `anchor build` (without devnet feature).
        // If built with default features, force_carnage should NOT appear.
        let idl_path =
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/idl/epoch_program.json");
        let Ok(idl_content) = std::fs::read_to_string(idl_path) else {
            eprintln!(
                "IDL file not found at {idl_path} -- skipping (run `anchor build` first)"
            );
            return;
        };

        // In non-devnet builds, force_carnage should not appear in instructions.
        // Anchor IDL uses camelCase, so check both forms.
        if cfg!(not(feature = "devnet")) {
            assert!(
                !idl_content.contains("forceCarnage")
                    && !idl_content.contains("force_carnage"),
                "force_carnage found in non-devnet IDL! The cfg gate may have been removed."
            );
        }
    }
}
