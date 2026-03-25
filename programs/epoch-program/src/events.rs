//! Epoch Program events.
//!
//! Source: Epoch_State_Machine_Spec.md Section 12

use anchor_lang::prelude::*;

/// Emitted when epoch state is initialized at protocol deployment.
///
/// This event marks the genesis of the epoch system.
/// Source: Epoch_State_Machine_Spec.md Section 12
#[event]
pub struct EpochStateInitialized {
    /// Slot when protocol was initialized
    pub genesis_slot: u64,
    /// Initial cheap side: 0 = CRIME, 1 = FRAUD
    pub initial_cheap_side: u8,
    /// Unix timestamp of initialization
    pub timestamp: i64,
}

/// Emitted when an epoch transition is triggered.
///
/// This event indicates that the VRF commitment phase has begun.
/// Client should bundle with Switchboard SDK commitIx.
/// Source: Epoch_State_Machine_Spec.md Section 12
#[event]
pub struct EpochTransitionTriggered {
    /// The new epoch number
    pub epoch: u32,
    /// Public key of the account that triggered the transition
    pub triggered_by: Pubkey,
    /// Slot when transition was triggered
    pub slot: u64,
    /// Bounty paid to triggerer in lamports
    pub bounty_paid: u64,
}

/// Emitted when taxes are updated after VRF randomness is consumed.
///
/// Contains the new tax configuration derived from VRF bytes.
/// Source: Epoch_State_Machine_Spec.md Section 12
#[event]
pub struct TaxesUpdated {
    /// Current epoch number
    pub epoch: u32,
    /// New cheap side: 0 = CRIME, 1 = FRAUD
    pub cheap_side: u8,
    /// Low tax rate in basis points (100-400)
    pub low_tax_bps: u16,
    /// High tax rate in basis points (1100-1400)
    pub high_tax_bps: u16,
    /// Whether the cheap side flipped from previous epoch
    pub flipped: bool,
}

/// Emitted when a VRF retry is requested after timeout.
///
/// Indicates the original VRF request timed out (300 slots) and a fresh
/// randomness account was committed.
/// Source: Epoch_State_Machine_Spec.md Section 12
#[event]
pub struct VrfRetryRequested {
    /// Current epoch number
    pub epoch: u32,
    /// Slot of the original (failed) VRF request
    pub original_request_slot: u64,
    /// Slot of this retry request
    pub retry_slot: u64,
    /// Public key of the account that requested the retry
    pub requested_by: Pubkey,
}

// ===========================================================================
// Carnage Fund Events
// Source: Carnage_Fund_Spec.md Section 14
// ===========================================================================

/// Emitted when Carnage Fund is initialized.
///
/// This event marks the initialization of the Carnage Fund vaults.
/// Source: Carnage_Fund_Spec.md Section 14
#[event]
pub struct CarnageFundInitialized {
    /// PDA of the SOL vault
    pub sol_vault: Pubkey,
    /// PDA of the CRIME token vault
    pub crime_vault: Pubkey,
    /// PDA of the FRAUD token vault
    pub fraud_vault: Pubkey,
    /// Unix timestamp of initialization
    pub timestamp: i64,
}

/// Emitted when Carnage executes successfully.
///
/// Contains full details of the buyback-and-burn (or sell) operation.
/// Source: Carnage_Fund_Spec.md Section 14
#[event]
pub struct CarnageExecuted {
    /// Epoch when Carnage executed
    pub epoch: u32,
    /// 0=None, 1=Burn, 2=Sell (matches CarnageAction enum)
    pub action: u8,
    /// 0=CRIME, 1=FRAUD (matches Token enum)
    pub target: u8,
    /// SOL spent on the swap (in lamports)
    pub sol_spent: u64,
    /// Tokens bought from the pool
    pub tokens_bought: u64,
    /// Tokens burned (0 if action=Sell)
    pub tokens_burned: u64,
    /// SOL received from sale (0 if action=Burn)
    pub sol_from_sale: u64,
    /// true if executed atomically in consume_randomness, false if via fallback
    pub atomic: bool,
}

/// Emitted when atomic Carnage fails and enters pending state.
///
/// Indicates that Carnage was triggered but could not execute atomically
/// (e.g., due to compute limits). Fallback execution is now available.
/// Source: Carnage_Fund_Spec.md Section 14
#[event]
pub struct CarnagePending {
    /// Epoch when Carnage was triggered
    pub epoch: u32,
    /// 0=CRIME, 1=FRAUD (matches Token enum)
    pub target: u8,
    /// 0=None, 1=Burn, 2=Sell (matches CarnageAction enum)
    pub action: u8,
    /// Slot deadline for fallback execution
    pub deadline_slot: u64,
}

/// Emitted when pending Carnage expires without execution.
///
/// Indicates that the fallback window (300 slots) elapsed without
/// anyone calling execute_pending_carnage. SOL is retained for next time.
/// Source: Carnage_Fund_Spec.md Section 14
#[event]
pub struct CarnageExpired {
    /// Epoch when Carnage was originally triggered
    pub epoch: u32,
    /// 0=CRIME, 1=FRAUD (matches Token enum)
    pub target: u8,
    /// 0=None, 1=Burn, 2=Sell (matches CarnageAction enum)
    pub action: u8,
    /// Slot deadline that was missed
    pub deadline_slot: u64,
    /// SOL that remains in vault for next trigger
    pub sol_retained: u64,
}

/// Emitted when Carnage execution fails and funds carry forward.
///
/// Only emitted from expire_carnage when stale pending Carnage is cleared,
/// since failing transactions roll back entirely (no event emission).
/// Source: Phase 47 CONTEXT.md
#[event]
pub struct CarnageFailed {
    /// Epoch when Carnage was triggered
    pub epoch: u32,
    /// 0=None, 1=Burn, 2=Sell (matches CarnageAction enum)
    pub action: u8,
    /// 0=CRIME, 1=FRAUD (matches Token enum)
    pub target: u8,
    /// SOL that was attempted (lamports)
    pub attempted_amount: u64,
    /// SOL remaining in vault (lamports)
    pub vault_balance: u64,
    /// Slot when failure was detected
    pub slot: u64,
    /// Whether the atomic path was attempted (always true for expire, distinguishes from future use)
    pub atomic: bool,
}

/// Emitted when Carnage trigger check occurs but doesn't trigger.
///
/// Indicates that VRF byte 5 did not meet the trigger threshold.
/// Source: Carnage_Fund_Spec.md Section 14
#[event]
pub struct CarnageNotTriggered {
    /// Epoch when trigger was checked
    pub epoch: u32,
    /// VRF byte 5 value that didn't meet threshold (<11 required)
    pub vrf_byte: u8,
}
