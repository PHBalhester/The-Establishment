//! EpochState account structure.
//!
//! Global singleton that governs tax regime transitions, VRF integration,
//! and Carnage Fund execution.
//!
//! Source: Epoch_State_Machine_Spec.md Section 4.1

use anchor_lang::prelude::*;

/// Global epoch state account.
///
/// Single PDA: seeds = ["epoch_state"]
///
/// This account is the coordination hub for all protocol dynamics:
/// - Tax rates (read by Tax Program during swaps)
/// - VRF state (commit-reveal randomness lifecycle)
/// - Carnage state (pending execution tracking)
///
/// **Size calculation:**
/// - Discriminator: 8 bytes
/// - genesis_slot: 8 bytes
/// - current_epoch: 4 bytes
/// - epoch_start_slot: 8 bytes
/// - cheap_side: 1 byte
/// - low_tax_bps: 2 bytes
/// - high_tax_bps: 2 bytes
/// - crime_buy_tax_bps: 2 bytes
/// - crime_sell_tax_bps: 2 bytes
/// - fraud_buy_tax_bps: 2 bytes
/// - fraud_sell_tax_bps: 2 bytes
/// - vrf_request_slot: 8 bytes
/// - vrf_pending: 1 byte
/// - taxes_confirmed: 1 byte
/// - pending_randomness_account: 32 bytes
/// - carnage_pending: 1 byte
/// - carnage_target: 1 byte
/// - carnage_action: 1 byte
/// - carnage_deadline_slot: 8 bytes
/// - carnage_lock_slot: 8 bytes
/// - last_carnage_epoch: 4 bytes
/// - initialized: 1 byte
/// - bump: 1 byte
/// - reserved: 64 bytes (future schema evolution padding)
/// - initialized: 1 byte
/// - bump: 1 byte
/// Total: 8 + 164 = 172 bytes
///
/// Source: Epoch_State_Machine_Spec.md Section 4.1, Phase 47 CONTEXT.md
#[account]
#[repr(C)]
pub struct EpochState {
    // =========================================================================
    // Timing (20 bytes)
    // =========================================================================
    /// Slot when protocol was initialized (genesis).
    /// Used for epoch calculation: epoch = (current_slot - genesis_slot) / SLOTS_PER_EPOCH
    pub genesis_slot: u64,

    /// Current epoch number (0-indexed).
    /// Increments each time trigger_epoch_transition succeeds.
    pub current_epoch: u32,

    /// Slot when the current epoch started.
    /// Calculated: genesis_slot + (current_epoch * SLOTS_PER_EPOCH)
    pub epoch_start_slot: u64,

    // =========================================================================
    // Tax Configuration - Active (7 bytes)
    // =========================================================================
    /// Current cheap side: 0 = CRIME, 1 = FRAUD.
    /// Cheap side gets low tax on buy, high tax on sell.
    pub cheap_side: u8,

    /// Low tax rate in basis points (100-400, i.e., 1-4%).
    /// Applied to cheap side buys and expensive side sells.
    pub low_tax_bps: u16,

    /// High tax rate in basis points (1100-1400, i.e., 11-14%).
    /// Applied to cheap side sells and expensive side buys.
    pub high_tax_bps: u16,

    // =========================================================================
    // Derived Tax Rates - Cached (8 bytes)
    // =========================================================================
    /// CRIME buy tax rate in basis points.
    /// If CRIME cheap: low_tax_bps. If FRAUD cheap: high_tax_bps.
    pub crime_buy_tax_bps: u16,

    /// CRIME sell tax rate in basis points.
    /// If CRIME cheap: high_tax_bps. If FRAUD cheap: low_tax_bps.
    pub crime_sell_tax_bps: u16,

    /// FRAUD buy tax rate in basis points.
    /// If FRAUD cheap: low_tax_bps. If CRIME cheap: high_tax_bps.
    pub fraud_buy_tax_bps: u16,

    /// FRAUD sell tax rate in basis points.
    /// If FRAUD cheap: high_tax_bps. If CRIME cheap: low_tax_bps.
    pub fraud_sell_tax_bps: u16,

    // =========================================================================
    // VRF State (42 bytes)
    // =========================================================================
    /// Slot when VRF randomness was committed (0 = none pending).
    /// Used for timeout detection: if current_slot > vrf_request_slot + VRF_TIMEOUT_SLOTS, retry allowed.
    pub vrf_request_slot: u64,

    /// Whether a VRF request is pending (waiting for consume_randomness).
    pub vrf_pending: bool,

    /// Whether taxes have been confirmed for the current epoch.
    /// False between trigger_epoch_transition and consume_randomness.
    pub taxes_confirmed: bool,

    /// Pubkey of the Switchboard randomness account bound at commit time.
    /// Anti-reroll protection: consume_randomness must use this exact account.
    pub pending_randomness_account: Pubkey,

    // =========================================================================
    // Carnage State (23 bytes)
    // =========================================================================
    /// Whether Carnage execution is pending (atomic failed, fallback active).
    pub carnage_pending: bool,

    /// Target token for Carnage buy: 0 = CRIME, 1 = FRAUD.
    /// Only valid when carnage_pending = true.
    pub carnage_target: u8,

    /// Carnage action type: 0 = None, 1 = Burn, 2 = Sell.
    /// Only valid when carnage_pending = true.
    pub carnage_action: u8,

    /// Slot deadline for fallback Carnage execution.
    /// If current_slot > carnage_deadline_slot, Carnage expires.
    pub carnage_deadline_slot: u64,

    /// Slot until which only the atomic Carnage path can execute.
    /// After lock expires, fallback execute_carnage becomes callable.
    /// Set to current_slot + CARNAGE_LOCK_SLOTS when Carnage triggers.
    pub carnage_lock_slot: u64,

    /// Last epoch when Carnage was triggered.
    /// Used to track Carnage frequency.
    pub last_carnage_epoch: u32,

    // =========================================================================
    // Reserved Padding (64 bytes) -- DEF-03
    //
    // Future schema evolution: add new fields by consuming reserved bytes.
    // This avoids account migration on schema changes.
    // =========================================================================
    pub reserved: [u8; 64],

    // =========================================================================
    // Protocol (2 bytes)
    // =========================================================================
    /// Whether the epoch state has been initialized.
    /// Set to true in initialize_epoch_state, prevents re-initialization.
    pub initialized: bool,

    /// PDA bump seed.
    pub bump: u8,
}

impl EpochState {
    /// Total account size including 8-byte discriminator.
    /// 8 (discriminator) + 164 (data) = 172 bytes.
    ///
    /// Source: Phase 47 added carnage_lock_slot (u64, +8 bytes).
    /// Phase 80 added reserved padding (+64 bytes).
    pub const LEN: usize = 8 + Self::DATA_LEN;

    /// Calculate data size without discriminator (for verification).
    /// Should equal 164 bytes.
    /// Layout: genesis_slot(8) + current_epoch(4) + epoch_start_slot(8)
    ///       + cheap_side(1) + low_tax_bps(2) + high_tax_bps(2)
    ///       + crime_buy_tax_bps(2) + crime_sell_tax_bps(2) + fraud_buy_tax_bps(2) + fraud_sell_tax_bps(2)
    ///       + vrf_request_slot(8) + vrf_pending(1) + taxes_confirmed(1) + pending_randomness_account(32)
    ///       + carnage_pending(1) + carnage_target(1) + carnage_action(1) + carnage_deadline_slot(8) + carnage_lock_slot(8) + last_carnage_epoch(4)
    ///       + reserved(64)
    ///       + initialized(1) + bump(1)
    pub const DATA_LEN: usize = 8 + 4 + 8 + 1 + 2 + 2 + 2 + 2 + 2 + 2 + 8 + 1 + 1 + 32 + 1 + 1 + 1 + 8 + 8 + 4 + 64 + 1 + 1;
}

// DEF-08: Compile-time assertion that DATA_LEN matches expected value.
// If this fails, the struct layout has drifted from the documented size.
const _: () = assert!(EpochState::DATA_LEN == 164);
