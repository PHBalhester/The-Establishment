//! trigger_epoch_transition instruction.
//!
//! Initiates an epoch transition by validating epoch boundary reached,
//! validating and binding the Switchboard randomness account, and paying bounty.
//!
//! The client MUST bundle this with Switchboard SDK's commitIx in the same transaction.
//! Source: Epoch_State_Machine_Spec.md Section 8.2

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::rent::Rent;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::sysvar::Sysvar;
use switchboard_on_demand::RandomnessAccountData;

use crate::constants::{
    CARNAGE_SOL_VAULT_SEED, EPOCH_STATE_SEED, SLOTS_PER_EPOCH, SWITCHBOARD_PROGRAM_ID,
    TRIGGER_BOUNTY_LAMPORTS,
};
use crate::errors::EpochError;
use crate::events::EpochTransitionTriggered;
use crate::state::EpochState;

/// Accounts for trigger_epoch_transition instruction.
///
/// Initiates the VRF commit phase of an epoch transition.
/// Anyone can call this after the epoch boundary is reached.
#[derive(Accounts)]
pub struct TriggerEpochTransition<'info> {
    /// Payer who triggers the transition. Receives the trigger bounty.
    /// Anyone can call - permissionless epoch advancement.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Global epoch state singleton.
    /// Validated via seeds and bump.
    #[account(
        mut,
        seeds = [EPOCH_STATE_SEED],
        bump = epoch_state.bump,
        constraint = epoch_state.initialized @ EpochError::NotInitialized,
    )]
    pub epoch_state: Account<'info, EpochState>,

    /// Carnage SOL vault PDA that funds the trigger bounty.
    /// The vault accrues 24% of all trade tax and has ample balance for bounties.
    /// Uses invoke_signed with PDA seeds to authorize the transfer.
    #[account(
        mut,
        seeds = [CARNAGE_SOL_VAULT_SEED],
        bump,
    )]
    pub carnage_sol_vault: SystemAccount<'info>,

    /// Switchboard On-Demand randomness account.
    /// Created by the client in a prior transaction, passed here for validation.
    /// CHECK: Owner validated via SWITCHBOARD_PROGRAM_ID, data validated via parse()
    #[account(owner = SWITCHBOARD_PROGRAM_ID @ EpochError::InvalidRandomnessOwner)]
    pub randomness_account: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// Helper Functions (public for unit testing)
// ============================================================================

/// Calculate the current epoch number from a given slot.
///
/// # Arguments
/// * `slot` - Current slot
/// * `genesis_slot` - Slot when protocol was initialized
///
/// # Returns
/// The epoch number (0-indexed)
///
/// # Example
/// With SLOTS_PER_EPOCH (750 devnet / 4500 mainnet) and genesis_slot = 1000:
/// - slot 1000 -> epoch 0
/// - slot genesis + SLOTS_PER_EPOCH - 1 -> epoch 0
/// - slot genesis + SLOTS_PER_EPOCH -> epoch 1
// EPOCH NUMBER CAST (VH-I002):
// u64 -> u32 cast. Overflows after ~4 billion epochs.
// At current Solana slot rate (~2.5 slots/sec) and SLOTS_PER_EPOCH=4500 (~30min):
//   4,294,967,296 epochs * 30 min = ~2,447 years until overflow.
// This is not exploitable in any realistic timeframe.
pub fn current_epoch(slot: u64, genesis_slot: u64) -> u32 {
    ((slot.saturating_sub(genesis_slot)) / SLOTS_PER_EPOCH) as u32
}

/// Calculate the start slot for a given epoch.
///
/// # Arguments
/// * `epoch` - Epoch number (0-indexed)
/// * `genesis_slot` - Slot when protocol was initialized
///
/// # Returns
/// The first slot of the specified epoch
///
/// # Example
/// With SLOTS_PER_EPOCH (750 devnet / 4500 mainnet) and genesis_slot = 1000:
/// - epoch 0 -> slot 1000
/// - epoch 1 -> slot 1000 + SLOTS_PER_EPOCH
/// - epoch 2 -> slot 1000 + 2 * SLOTS_PER_EPOCH
pub fn epoch_start_slot(epoch: u32, genesis_slot: u64) -> u64 {
    genesis_slot + (epoch as u64 * SLOTS_PER_EPOCH)
}

// ============================================================================
// Instruction Handler
// ============================================================================

/// Trigger an epoch transition.
///
/// This is the first instruction in the VRF three-transaction flow:
/// 1. TX 1: Client creates randomness account (separate transaction)
/// 2. TX 2: Client bundles SDK commitIx + this instruction
/// 3. TX 3: Client bundles SDK revealIx + consume_randomness
///
/// # Validations performed:
/// 1. Epoch boundary reached (current slot past next epoch boundary)
/// 2. No VRF already pending (can't double-commit)
/// 3. Randomness account freshness (seed_slot within 1 slot of current)
/// 4. Randomness not yet revealed (get_value returns error)
///
/// # State changes:
/// - Advances current_epoch to expected epoch
/// - Sets epoch_start_slot for new epoch
/// - Sets vrf_request_slot to current slot
/// - Sets vrf_pending = true
/// - Sets taxes_confirmed = false
/// - Binds pending_randomness_account for anti-reroll protection
///
/// # Events:
/// Emits EpochTransitionTriggered
pub fn handler(ctx: Context<TriggerEpochTransition>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // === 1. Validate epoch boundary reached ===
    // Calculate what epoch we SHOULD be in based on current slot.
    //
    // NOTE: Epoch skipping is acceptable. If the crank is delayed, expected_epoch
    // may be > current_epoch + 1 (e.g., jumping from epoch 100 to epoch 105).
    // This is harmless because:
    // - No rewards accrue during gaps (staking tracks per-epoch)
    // - Tax rates persist at last-set values (safe fallback)
    // - Carnage only triggers from VRF (no implicit triggers from skips)
    // The new epoch number is set directly to expected_epoch, not incremented.
    let expected_epoch = current_epoch(clock.slot, epoch_state.genesis_slot);
    require!(
        expected_epoch > epoch_state.current_epoch,
        EpochError::EpochBoundaryNotReached
    );
    msg!(
        "Epoch boundary check: current_epoch={}, expected_epoch={}, slot={}",
        epoch_state.current_epoch,
        expected_epoch,
        clock.slot
    );

    // === 2. Validate no VRF already pending ===
    // Prevents double-commit attacks and state inconsistency
    require!(!epoch_state.vrf_pending, EpochError::VrfAlreadyPending);

    // === 3. Validate randomness account (On-Demand freshness checks) ===
    let randomness_data = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        RandomnessAccountData::parse(data).map_err(|_| EpochError::RandomnessParseError)?
    };

    // Freshness check: seed_slot must be within 1 slot of current
    // This prevents use of pre-generated/stale randomness accounts
    let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
    msg!(
        "Randomness freshness: current_slot={}, seed_slot={}, diff={}",
        clock.slot,
        randomness_data.seed_slot,
        slot_diff
    );
    require!(slot_diff <= 1, EpochError::RandomnessExpired);

    // Not-yet-revealed check: must still be in commit phase
    // If get_value succeeds, the randomness has already been revealed and can't be used
    if randomness_data.get_value(clock.slot).is_ok() {
        msg!("Randomness already revealed - cannot use for new commit");
        return Err(EpochError::RandomnessAlreadyRevealed.into());
    }

    // === 4. Advance epoch number ===
    epoch_state.current_epoch = expected_epoch;
    epoch_state.epoch_start_slot = epoch_start_slot(expected_epoch, epoch_state.genesis_slot);

    // === 5. Set VRF pending state ===
    epoch_state.vrf_request_slot = clock.slot;
    epoch_state.vrf_pending = true;
    epoch_state.taxes_confirmed = false;

    // === 6. Bind randomness account (anti-reroll protection) ===
    // This is critical: consume_randomness MUST use the same account
    epoch_state.pending_randomness_account = ctx.accounts.randomness_account.key();
    msg!(
        "Bound randomness account: {} at slot {}",
        epoch_state.pending_randomness_account,
        clock.slot
    );

    // === 7. Pay bounty to triggerer from Carnage SOL vault ===
    // Reserve rent-exempt minimum so the vault PDA isn't garbage-collected.
    let rent = Rent::get()?;
    let rent_exempt_min = rent.minimum_balance(0);
    let vault_balance = ctx.accounts.carnage_sol_vault.lamports();
    let bounty_threshold = TRIGGER_BOUNTY_LAMPORTS
        .checked_add(rent_exempt_min)
        .ok_or(EpochError::Overflow)?;
    let bounty_paid = if vault_balance >= bounty_threshold {
        // Transfer bounty from carnage_sol_vault PDA to triggerer
        let vault_bump = ctx.bumps.carnage_sol_vault;
        let signer_seeds: &[&[u8]] = &[CARNAGE_SOL_VAULT_SEED, &[vault_bump]];

        invoke_signed(
            &system_instruction::transfer(
                ctx.accounts.carnage_sol_vault.to_account_info().key,
                ctx.accounts.payer.to_account_info().key,
                TRIGGER_BOUNTY_LAMPORTS,
            ),
            &[
                ctx.accounts.carnage_sol_vault.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        msg!(
            "Bounty paid: {} lamports from carnage_sol_vault to {}",
            TRIGGER_BOUNTY_LAMPORTS,
            ctx.accounts.payer.key()
        );
        TRIGGER_BOUNTY_LAMPORTS
    } else {
        msg!(
            "Carnage vault balance insufficient for bounty: {} < {} (skipped)",
            vault_balance,
            TRIGGER_BOUNTY_LAMPORTS
        );
        0
    };

    msg!(
        "Epoch {} triggered by {} at slot {} (bounty: {} lamports)",
        expected_epoch,
        ctx.accounts.payer.key(),
        clock.slot,
        bounty_paid
    );

    // === 8. Emit event ===
    emit!(EpochTransitionTriggered {
        epoch: expected_epoch,
        triggered_by: ctx.accounts.payer.key(),
        slot: clock.slot,
        bounty_paid,
    });

    Ok(())
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_current_epoch_at_genesis() {
        // At genesis slot, should be epoch 0
        let genesis = 1000;
        assert_eq!(current_epoch(1000, genesis), 0);
    }

    #[test]
    fn test_current_epoch_just_before_boundary() {
        // Genesis at 1000, first boundary at genesis + SLOTS_PER_EPOCH
        // Slot genesis + SLOTS_PER_EPOCH - 1 is still epoch 0
        let genesis = 1000;
        assert_eq!(current_epoch(genesis + SLOTS_PER_EPOCH - 1, genesis), 0);
    }

    #[test]
    fn test_current_epoch_at_boundary() {
        // Slot genesis + SLOTS_PER_EPOCH is epoch 1 (first slot of epoch 1)
        let genesis = 1000;
        assert_eq!(current_epoch(genesis + SLOTS_PER_EPOCH, genesis), 1);
    }

    #[test]
    fn test_current_epoch_well_into_epoch_2() {
        // Well into epoch 2: genesis + 2*SLOTS_PER_EPOCH + some offset
        let genesis = 1000;
        let slot = genesis + 2 * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH / 2;
        assert_eq!(current_epoch(slot, genesis), 2);
    }

    #[test]
    fn test_current_epoch_with_zero_genesis() {
        // Genesis at slot 0
        // Epoch 0: slots 0 to SLOTS_PER_EPOCH-1
        // Epoch 1: slots SLOTS_PER_EPOCH to 2*SLOTS_PER_EPOCH-1
        // Epoch 2: slots 2*SLOTS_PER_EPOCH to 3*SLOTS_PER_EPOCH-1
        assert_eq!(current_epoch(0, 0), 0);
        assert_eq!(current_epoch(SLOTS_PER_EPOCH - 1, 0), 0);
        assert_eq!(current_epoch(SLOTS_PER_EPOCH, 0), 1);
        assert_eq!(current_epoch(2 * SLOTS_PER_EPOCH, 0), 2);
    }

    #[test]
    fn test_epoch_start_slot_epoch_0() {
        let genesis = 1000;
        assert_eq!(epoch_start_slot(0, genesis), 1000);
    }

    #[test]
    fn test_epoch_start_slot_epoch_1() {
        // Epoch 1 starts at genesis + SLOTS_PER_EPOCH
        let genesis = 1000;
        assert_eq!(epoch_start_slot(1, genesis), genesis + SLOTS_PER_EPOCH);
    }

    #[test]
    fn test_epoch_start_slot_epoch_2() {
        // Epoch 2 starts at genesis + 2 * SLOTS_PER_EPOCH
        let genesis = 1000;
        assert_eq!(epoch_start_slot(2, genesis), genesis + 2 * SLOTS_PER_EPOCH);
    }

    #[test]
    fn test_epoch_start_slot_with_zero_genesis() {
        assert_eq!(epoch_start_slot(0, 0), 0);
        assert_eq!(epoch_start_slot(1, 0), SLOTS_PER_EPOCH);
        assert_eq!(epoch_start_slot(2, 0), 2 * SLOTS_PER_EPOCH);
        assert_eq!(epoch_start_slot(10, 0), 10 * SLOTS_PER_EPOCH);
    }

    #[test]
    fn test_epoch_boundary_detection_logic() {
        // Simulate the boundary detection logic used in the handler
        let genesis = 0;
        let current_stored_epoch = 0u32;

        // Before boundary: should NOT trigger
        let slot = SLOTS_PER_EPOCH - 1;
        let expected = current_epoch(slot, genesis);
        assert!(
            !(expected > current_stored_epoch),
            "Should NOT trigger at slot SLOTS_PER_EPOCH-1 (expected={}, current={})",
            expected,
            current_stored_epoch
        );

        // At boundary: SHOULD trigger
        let slot = SLOTS_PER_EPOCH;
        let expected = current_epoch(slot, genesis);
        assert!(
            expected > current_stored_epoch,
            "Should trigger at slot SLOTS_PER_EPOCH (expected={}, current={})",
            expected,
            current_stored_epoch
        );

        // Well past boundary: SHOULD trigger
        let slot = 3 * SLOTS_PER_EPOCH;
        let expected = current_epoch(slot, genesis);
        assert!(
            expected > current_stored_epoch,
            "Should trigger at slot 3*SLOTS_PER_EPOCH (expected={}, current={})",
            expected,
            current_stored_epoch
        );
    }

    #[test]
    fn test_epoch_calculation_consistency() {
        // For any epoch N, epoch_start_slot(N) should give a slot
        // where current_epoch(slot) == N
        let genesis = 12345;
        for epoch in 0..100 {
            let start = epoch_start_slot(epoch, genesis);
            let computed = current_epoch(start, genesis);
            assert_eq!(
                computed, epoch,
                "Epoch {} start slot {} should map back to epoch {}",
                epoch, start, epoch
            );
        }
    }

    #[test]
    fn test_saturating_sub_handles_underflow() {
        // If slot < genesis (shouldn't happen but be safe)
        let genesis = 1000;
        let slot = 500; // Before genesis
        let epoch = current_epoch(slot, genesis);
        assert_eq!(epoch, 0, "Slots before genesis should be epoch 0");
    }
}
