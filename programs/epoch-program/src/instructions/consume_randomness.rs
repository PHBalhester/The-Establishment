//! consume_randomness instruction.
//!
//! Reads revealed VRF bytes, verifies anti-reroll protection,
//! derives new tax rates, and updates EpochState.
//!
//! The client MUST bundle this with Switchboard SDK's revealIx in the same transaction.
//! Source: Epoch_State_Machine_Spec.md Section 8.3

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use switchboard_on_demand::RandomnessAccountData;

use crate::constants::{
    staking_program_id, CARNAGE_DEADLINE_SLOTS, CARNAGE_FUND_SEED, EPOCH_STATE_SEED,
    STAKING_AUTHORITY_SEED, SWITCHBOARD_PROGRAM_ID, UPDATE_CUMULATIVE_DISCRIMINATOR,
    CARNAGE_LOCK_SLOTS,
};
use crate::errors::EpochError;
use crate::events::{CarnageExpired, CarnageFailed, CarnageNotTriggered, CarnagePending, TaxesUpdated};
use crate::helpers::{derive_taxes, get_carnage_action, get_carnage_target, is_carnage_triggered};
use crate::state::{CarnageAction, CarnageFundState, EpochState, Token};

/// Minimum VRF bytes needed for tax derivation + Carnage.
/// Bytes 0-4: Tax (flip + 4 independent magnitude rolls)
/// Bytes 5-7: Carnage (trigger + action + target)
/// Total: 8 bytes of 32 available.
/// Source: Epoch_State_Machine_Spec.md Section 7.2 (updated Phase 37)
pub const MIN_VRF_BYTES: usize = 8;

/// Accounts for the consume_randomness instruction.
///
/// Called after Switchboard oracle has revealed randomness (~3 slots after trigger).
/// Verifies anti-reroll protection, reads VRF bytes, derives tax rates.
/// Client must bundle this with Switchboard SDK revealIx.
#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    /// Caller (anyone can call after oracle reveals).
    pub caller: Signer<'info>,

    /// Global epoch state.
    #[account(
        mut,
        seeds = [EPOCH_STATE_SEED],
        bump = epoch_state.bump,
        constraint = epoch_state.initialized @ EpochError::NotInitialized,
    )]
    pub epoch_state: Account<'info, EpochState>,

    /// Switchboard randomness account (MUST match pending_randomness_account).
    /// CHECK: Owner validated via SWITCHBOARD_PROGRAM_ID, data validated via parse()
    #[account(owner = SWITCHBOARD_PROGRAM_ID @ EpochError::InvalidRandomnessOwner)]
    pub randomness_account: AccountInfo<'info>,

    /// Staking authority PDA - Epoch Program signs CPIs to Staking.
    /// CHECK: PDA derived from this program's seeds, validated by seeds constraint.
    #[account(
        seeds = [STAKING_AUTHORITY_SEED],
        bump,
    )]
    pub staking_authority: AccountInfo<'info>,

    /// Staking Program's pool state (mutable for update_cumulative).
    /// CHECK: Validated by Staking Program during CPI.
    #[account(mut)]
    pub stake_pool: AccountInfo<'info>,

    /// Staking Program for update_cumulative CPI.
    /// CHECK: Address validated against known Staking program ID.
    #[account(address = staking_program_id() @ EpochError::InvalidStakingProgram)]
    pub staking_program: AccountInfo<'info>,

    /// Carnage Fund state (for checking holdings and auto-expire).
    /// Optional - if not provided, Carnage trigger check is skipped.
    /// This allows backward compatibility and gradual rollout.
    #[account(
        seeds = [CARNAGE_FUND_SEED],
        bump,
    )]
    pub carnage_state: Option<Account<'info, CarnageFundState>>,
}

/// Handler for consume_randomness instruction.
///
/// # Flow
/// 0. Auto-expire stale pending Carnage (if deadline passed)
/// 1. Validate VRF is pending
/// 2. Anti-reroll: verify SAME randomness account that was committed
/// 3. Read revealed randomness bytes (fails if oracle hasn't revealed yet)
/// 4. Validate sufficient bytes (MIN_VRF_BYTES = 8)
/// 5. Derive tax rates from VRF bytes
/// 6. Update EpochState with new tax configuration
/// 7. Clear VRF pending state
/// 7.5. CPI to Staking: finalize epoch yield
/// 8. Emit TaxesUpdated event
/// 9. Carnage trigger check (if carnage_state provided):
///    - Check if VRF byte 5 < 11 (triggers Carnage)
///    - If triggered: set pending state for execute_carnage_atomic
///    - Emit CarnagePending or CarnageNotTriggered event
///
/// # Errors
/// - `NoVrfPending` if no VRF request is pending
/// - `RandomnessAccountMismatch` if account doesn't match bound account (anti-reroll)
/// - `RandomnessParseError` if randomness account data is invalid
/// - `RandomnessNotRevealed` if oracle hasn't revealed yet
/// - `InsufficientRandomness` if less than 8 bytes revealed
/// - `Overflow` if deadline slot calculation overflows
pub fn handler(ctx: Context<ConsumeRandomness>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // === 0. Auto-expire stale pending Carnage ===
    // If previous Carnage triggered but deadline passed without execution,
    // clear the pending state so the system can proceed.
    if epoch_state.carnage_pending && clock.slot > epoch_state.carnage_deadline_slot {
        msg!(
            "Auto-expiring stale Carnage: deadline={}, current={}",
            epoch_state.carnage_deadline_slot,
            clock.slot
        );

        let expired_target = epoch_state.carnage_target;
        let expired_action = epoch_state.carnage_action;
        let deadline_slot = epoch_state.carnage_deadline_slot;

        epoch_state.carnage_pending = false;
        epoch_state.carnage_action = CarnageAction::None.to_u8();

        emit!(CarnageExpired {
            epoch: epoch_state.current_epoch,
            target: expired_target,
            action: expired_action,
            deadline_slot,
            sol_retained: 0, // Actual balance would need sol_vault account
        });

        // Emit CarnageFailed for off-chain monitoring (Phase 47).
        // Auto-expire in consume_randomness also means both paths failed.
        emit!(CarnageFailed {
            epoch: epoch_state.current_epoch,
            action: expired_action,
            target: expired_target,
            attempted_amount: 0,
            vault_balance: 0, // sol_vault not available in this instruction
            slot: clock.slot,
            atomic: false,
        });
    }

    // === 1. Validate VRF is pending ===
    require!(epoch_state.vrf_pending, EpochError::NoVrfPending);

    // === 2. Anti-reroll: verify SAME randomness account that was committed ===
    require!(
        ctx.accounts.randomness_account.key() == epoch_state.pending_randomness_account,
        EpochError::RandomnessAccountMismatch
    );
    msg!(
        "Anti-reroll verified: {} matches bound account",
        ctx.accounts.randomness_account.key()
    );

    // === 3. Read revealed randomness bytes ===
    let vrf_result: [u8; 32] = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        let randomness_data =
            RandomnessAccountData::parse(data).map_err(|_| EpochError::RandomnessParseError)?;
        randomness_data
            .get_value(clock.slot)
            .map_err(|_| EpochError::RandomnessNotRevealed)?
    };

    // === 4. Validate sufficient bytes ===
    // Note: get_value() returns [u8; 32], so this is always satisfied,
    // but we keep the check for defensive programming and documentation.
    require!(
        vrf_result.len() >= MIN_VRF_BYTES,
        EpochError::InsufficientRandomness
    );
    msg!(
        "VRF bytes received: [{}, {}, {}, {}, {}, {}, {}, {}]",
        vrf_result[0],
        vrf_result[1],
        vrf_result[2],
        vrf_result[3],
        vrf_result[4],
        vrf_result[5],
        vrf_result[6],
        vrf_result[7]
    );

    // === 5. Derive tax rates from VRF bytes ===
    let old_cheap_side = epoch_state.cheap_side;
    let current_token = Token::from_u8(epoch_state.cheap_side)
        .ok_or(EpochError::InvalidCheapSide)?;
    let tax_config = derive_taxes(&vrf_result, current_token);

    // === 6. Update EpochState with new tax configuration ===
    epoch_state.cheap_side = tax_config.cheap_side.to_u8();
    epoch_state.crime_buy_tax_bps = tax_config.crime_buy_tax_bps;
    epoch_state.crime_sell_tax_bps = tax_config.crime_sell_tax_bps;
    epoch_state.fraud_buy_tax_bps = tax_config.fraud_buy_tax_bps;
    epoch_state.fraud_sell_tax_bps = tax_config.fraud_sell_tax_bps;

    // VRF-03: Populate legacy summary fields with min/max of per-token rates.
    // These fields are kept for event emission and external consumers (e.g. UI).
    // derive_taxes() returns 0 for these (rates are independent per-token),
    // so we compute min/max explicitly from the 4 per-token rates.
    epoch_state.low_tax_bps = tax_config.crime_buy_tax_bps
        .min(tax_config.crime_sell_tax_bps)
        .min(tax_config.fraud_buy_tax_bps)
        .min(tax_config.fraud_sell_tax_bps);
    epoch_state.high_tax_bps = tax_config.crime_buy_tax_bps
        .max(tax_config.crime_sell_tax_bps)
        .max(tax_config.fraud_buy_tax_bps)
        .max(tax_config.fraud_sell_tax_bps);

    // === 7. Clear VRF pending state ===
    epoch_state.vrf_pending = false;
    epoch_state.taxes_confirmed = true;

    let flipped = epoch_state.cheap_side != old_cheap_side;
    msg!(
        "Taxes updated: cheap_side={} (flipped={}), low={}, high={}",
        epoch_state.cheap_side,
        flipped,
        epoch_state.low_tax_bps,
        epoch_state.high_tax_bps
    );

    // === 7.5. CPI TO STAKING: FINALIZE EPOCH YIELD ===
    // Notify staking that the epoch has advanced and yield is finalized.
    // This happens AFTER tax derivation, BEFORE Carnage check (per CONTEXT.md).
    // Timing: validate randomness -> derive new rates -> finalize old epoch yield -> check Carnage
    let staking_authority_bump = ctx.bumps.staking_authority;
    let staking_authority_seeds: &[&[u8]] = &[
        STAKING_AUTHORITY_SEED,
        &[staking_authority_bump],
    ];

    // Build instruction data: discriminator (8) + epoch (4)
    let mut ix_data = Vec::with_capacity(12);
    ix_data.extend_from_slice(&UPDATE_CUMULATIVE_DISCRIMINATOR);
    ix_data.extend_from_slice(&epoch_state.current_epoch.to_le_bytes());

    let update_cumulative_ix = Instruction {
        program_id: ctx.accounts.staking_program.key(),
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.staking_authority.key(), true),
            AccountMeta::new(ctx.accounts.stake_pool.key(), false),
        ],
        data: ix_data,
    };

    invoke_signed(
        &update_cumulative_ix,
        &[
            ctx.accounts.staking_authority.to_account_info(),
            ctx.accounts.stake_pool.to_account_info(),
            ctx.accounts.staking_program.to_account_info(),
        ],
        &[staking_authority_seeds],
    )?;

    msg!(
        "Staking cumulative updated for epoch {}",
        epoch_state.current_epoch
    );

    // === 8. Emit event ===
    emit!(TaxesUpdated {
        epoch: epoch_state.current_epoch,
        cheap_side: epoch_state.cheap_side,
        low_tax_bps: epoch_state.low_tax_bps,
        high_tax_bps: epoch_state.high_tax_bps,
        flipped,
    });

    // === 9. Carnage trigger check ===
    // Check VRF bytes 5-7 if carnage_state is provided.
    // This is optional for backward compatibility during rollout.
    if let Some(ref carnage_state) = ctx.accounts.carnage_state {
        if is_carnage_triggered(&vrf_result) {
            // Determine action based on current holdings
            let has_holdings = carnage_state.held_amount > 0;
            let action = get_carnage_action(&vrf_result, has_holdings);
            let target = get_carnage_target(&vrf_result);

            // Set pending state for execute_carnage_atomic
            epoch_state.carnage_pending = true;
            epoch_state.carnage_action = action.to_u8();
            epoch_state.carnage_target = target.to_u8();
            epoch_state.carnage_deadline_slot = clock
                .slot
                .checked_add(CARNAGE_DEADLINE_SLOTS)
                .ok_or(EpochError::Overflow)?;
            epoch_state.carnage_lock_slot = clock
                .slot
                .checked_add(CARNAGE_LOCK_SLOTS)
                .ok_or(EpochError::Overflow)?;

            msg!(
                "Carnage triggered! action={}, target={}, deadline={}",
                action.to_u8(),
                target.to_u8(),
                epoch_state.carnage_deadline_slot
            );

            emit!(CarnagePending {
                epoch: epoch_state.current_epoch,
                target: target.to_u8(),
                action: action.to_u8(),
                deadline_slot: epoch_state.carnage_deadline_slot,
            });
        } else {
            msg!(
                "Carnage not triggered: VRF byte 5 = {} (threshold = 11)",
                vrf_result[5]
            );

            emit!(CarnageNotTriggered {
                epoch: epoch_state.current_epoch,
                vrf_byte: vrf_result[5],
            });
        }
    } else {
        msg!("Carnage state not provided - skipping Carnage trigger check");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CARNAGE_DEADLINE_SLOTS;

    #[test]
    fn test_min_vrf_bytes_constant() {
        // Per spec Section 7.2 (updated Phase 37), we need 8 bytes:
        // 0: flip, 1: crime_low, 2: crime_high, 3: fraud_low, 4: fraud_high,
        // 5: carnage_trigger, 6: carnage_action, 7: carnage_target
        assert_eq!(MIN_VRF_BYTES, 8);
    }

    #[test]
    fn test_vrf_bytes_are_sufficient() {
        // Switchboard provides 32 bytes, we only need 8
        let vrf_result = vec![0u8; 32];
        assert!(vrf_result.len() >= MIN_VRF_BYTES);
    }

    // === Carnage integration tests ===

    #[test]
    fn test_carnage_trigger_logic_integration() {
        // Simulate a VRF result that triggers Carnage (byte 5)
        let mut vrf = [0u8; 32];
        vrf[5] = 5; // < 11 = trigger

        assert!(is_carnage_triggered(&vrf));

        // With no holdings
        let action = get_carnage_action(&vrf, false);
        assert_eq!(action, CarnageAction::None);

        // With holdings and byte 6 < 5 = sell
        vrf[6] = 3;
        let action = get_carnage_action(&vrf, true);
        assert_eq!(action, CarnageAction::Sell);

        // With holdings and byte 6 >= 5 = burn
        vrf[6] = 100;
        let action = get_carnage_action(&vrf, true);
        assert_eq!(action, CarnageAction::Burn);
    }

    #[test]
    fn test_carnage_no_trigger_integration() {
        // Simulate a VRF result that doesn't trigger Carnage (byte 5)
        let mut vrf = [0u8; 32];
        vrf[5] = 11; // >= 11 = no trigger

        assert!(!is_carnage_triggered(&vrf));
    }

    #[test]
    fn test_carnage_target_integration() {
        let mut vrf = [0u8; 32];

        // byte 7 < 128 = CRIME
        vrf[7] = 50;
        assert_eq!(get_carnage_target(&vrf), Token::Crime);

        // byte 7 >= 128 = FRAUD
        vrf[7] = 200;
        assert_eq!(get_carnage_target(&vrf), Token::Fraud);
    }

    #[test]
    fn test_deadline_calculation() {
        // Verify deadline is correctly calculated
        let current_slot: u64 = 1000;
        let deadline = current_slot.checked_add(CARNAGE_DEADLINE_SLOTS).unwrap();
        assert_eq!(deadline, 1300); // 1000 + 300 = 1300
    }

    #[test]
    fn test_stale_pending_detection() {
        // Simulate stale pending scenario
        let deadline_slot: u64 = 1000;
        let current_slot: u64 = 1001;

        // Stale: current > deadline
        assert!(current_slot > deadline_slot);
    }

    #[test]
    fn test_valid_pending_detection() {
        // Simulate valid pending scenario
        let deadline_slot: u64 = 1000;
        let current_slot: u64 = 999;

        // Valid: current <= deadline
        assert!(current_slot <= deadline_slot);
    }

    #[test]
    fn test_carnage_action_none_u8_value() {
        // Verify CarnageAction::None.to_u8() is 0 for state clearing
        assert_eq!(CarnageAction::None.to_u8(), 0);
    }
}
