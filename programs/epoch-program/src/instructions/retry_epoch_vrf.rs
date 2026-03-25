//! retry_epoch_vrf instruction.
//!
//! Allows re-committing a new randomness account after VRF timeout.
//! Prevents protocol deadlock if oracle fails to reveal.
//!
//! The client MUST bundle this with Switchboard SDK's commitIx in the same transaction.
//! Source: Epoch_State_Machine_Spec.md Section 8.6

use anchor_lang::prelude::*;
use switchboard_on_demand::RandomnessAccountData;

use crate::constants::{EPOCH_STATE_SEED, SWITCHBOARD_PROGRAM_ID, VRF_TIMEOUT_SLOTS};
use crate::errors::EpochError;
use crate::events::VrfRetryRequested;
use crate::state::EpochState;

/// Accounts for retry_epoch_vrf instruction.
///
/// Allows re-committing a new randomness account after VRF timeout.
/// Anyone can call - permissionless deadlock recovery.
#[derive(Accounts)]
pub struct RetryEpochVrf<'info> {
    /// Payer for the retry (anyone can call).
    pub payer: Signer<'info>,

    /// Global epoch state.
    #[account(
        mut,
        seeds = [EPOCH_STATE_SEED],
        bump = epoch_state.bump,
        constraint = epoch_state.initialized @ EpochError::NotInitialized,
    )]
    pub epoch_state: Account<'info, EpochState>,

    /// Fresh Switchboard randomness account (replaces stale one).
    /// CHECK: Owner validated via SWITCHBOARD_PROGRAM_ID, data validated via parse()
    #[account(owner = SWITCHBOARD_PROGRAM_ID @ EpochError::InvalidRandomnessOwner)]
    pub randomness_account: AccountInfo<'info>,
}

/// Handler for retry_epoch_vrf instruction.
///
/// # Flow
/// 1. Validate VRF is pending
/// 2. Validate timeout has elapsed (elapsed_slots > VRF_TIMEOUT_SLOTS)
/// 3. Validate new randomness account freshness (seed_slot within 1 slot)
/// 4. Validate new randomness not yet revealed
/// 5. Overwrite pending state with new randomness account
/// 6. Emit VrfRetryRequested event
///
/// # Errors
/// - `NoVrfPending` if no VRF request is pending
/// - `VrfTimeoutNotElapsed` if 300 slots haven't passed since original request
/// - `RandomnessParseError` if randomness account data is invalid
/// - `RandomnessExpired` if seed_slot is stale
/// - `RandomnessAlreadyRevealed` if randomness was already revealed
pub fn handler(ctx: Context<RetryEpochVrf>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // === 1. Validate VRF is pending ===
    require!(epoch_state.vrf_pending, EpochError::NoVrfPending);

    // === 2. Validate timeout has elapsed ===
    let elapsed_slots = clock.slot.saturating_sub(epoch_state.vrf_request_slot);
    msg!(
        "VRF timeout check: elapsed={} slots, timeout={} slots",
        elapsed_slots,
        VRF_TIMEOUT_SLOTS
    );
    require!(
        elapsed_slots > VRF_TIMEOUT_SLOTS,
        EpochError::VrfTimeoutNotElapsed
    );

    // === 3. Validate new randomness account (same checks as trigger) ===
    let randomness_data = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        RandomnessAccountData::parse(data).map_err(|_| EpochError::RandomnessParseError)?
    };

    // Freshness check: seed_slot must be within 1 slot of current
    let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
    msg!(
        "New randomness freshness: current_slot={}, seed_slot={}, diff={}",
        clock.slot,
        randomness_data.seed_slot,
        slot_diff
    );
    require!(slot_diff <= 1, EpochError::RandomnessExpired);

    // Not-yet-revealed check
    if randomness_data.get_value(clock.slot).is_ok() {
        msg!("New randomness already revealed - cannot commit");
        return Err(EpochError::RandomnessAlreadyRevealed.into());
    }

    // === 4. Overwrite pending state with new randomness account ===
    let original_slot = epoch_state.vrf_request_slot;
    let original_account = epoch_state.pending_randomness_account;

    epoch_state.vrf_request_slot = clock.slot;
    epoch_state.pending_randomness_account = ctx.accounts.randomness_account.key();

    msg!(
        "VRF retry: replaced {} (slot {}) with {} (slot {})",
        original_account,
        original_slot,
        epoch_state.pending_randomness_account,
        clock.slot
    );

    // === 5. Emit event ===
    emit!(VrfRetryRequested {
        epoch: epoch_state.current_epoch,
        original_request_slot: original_slot,
        retry_slot: clock.slot,
        requested_by: ctx.accounts.payer.key(),
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vrf_timeout_slots_constant() {
        // Per spec Section 3.1, VRF timeout is 300 slots (~2 minutes)
        assert_eq!(VRF_TIMEOUT_SLOTS, 300);
    }

    #[test]
    fn test_timeout_boundary_logic() {
        // Simulate the timeout check logic used in the handler
        let vrf_request_slot: u64 = 1000;

        // At exactly timeout: NOT allowed (need > not >=)
        let current_slot: u64 = 1300; // 300 slots elapsed
        let elapsed = current_slot.saturating_sub(vrf_request_slot);
        assert_eq!(elapsed, 300);
        assert!(
            !(elapsed > VRF_TIMEOUT_SLOTS),
            "Should NOT allow retry at exactly 300 slots"
        );

        // One slot after timeout: allowed
        let current_slot: u64 = 1301; // 301 slots elapsed
        let elapsed = current_slot.saturating_sub(vrf_request_slot);
        assert_eq!(elapsed, 301);
        assert!(
            elapsed > VRF_TIMEOUT_SLOTS,
            "Should allow retry at 301 slots"
        );

        // Well after timeout: allowed
        let current_slot: u64 = 2000; // 1000 slots elapsed
        let elapsed = current_slot.saturating_sub(vrf_request_slot);
        assert!(elapsed > VRF_TIMEOUT_SLOTS, "Should allow retry at 1000 slots");
    }

    #[test]
    fn test_saturating_sub_handles_underflow() {
        // Edge case: current_slot < vrf_request_slot (shouldn't happen but be safe)
        let vrf_request_slot = 1000u64;
        let current_slot = 500u64;
        let elapsed = current_slot.saturating_sub(vrf_request_slot);
        assert_eq!(elapsed, 0, "saturating_sub should return 0 on underflow");
        assert!(
            !(elapsed > VRF_TIMEOUT_SLOTS),
            "Underflow case should NOT allow retry"
        );
    }
}
