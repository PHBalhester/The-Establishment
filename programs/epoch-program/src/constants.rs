//! Epoch Program constants.
//!
//! Timing parameters and seeds for the Epoch State Machine.
//! Source: Epoch_State_Machine_Spec.md Section 3.1

use anchor_lang::prelude::Pubkey;
use anchor_lang::pubkey;

// ---------------------------------------------------------------------------
// Cross-Program ID Constants
// ---------------------------------------------------------------------------

/// Tax Program ID for address constraint validation.
///
/// Matches declare_id! in tax-program/src/lib.rs.
/// Source keypair: keypairs/tax-program-keypair.json
pub fn tax_program_id() -> Pubkey {
    pubkey!("43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj")
}

/// AMM Program ID for address constraint validation.
///
/// Matches declare_id! in amm/src/lib.rs.
/// Source keypair: keypairs/amm-keypair.json
pub fn amm_program_id() -> Pubkey {
    pubkey!("5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR")
}

/// Staking Program ID for address constraint validation.
///
/// Matches declare_id! in staking/src/lib.rs.
/// Source keypair: keypairs/staking-keypair.json
pub fn staking_program_id() -> Pubkey {
    pubkey!("12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH")
}

// ---------------------------------------------------------------------------
// Switchboard VRF Program ID
// ---------------------------------------------------------------------------

/// Switchboard On-Demand program ID (feature-flagged for devnet/mainnet).
///
/// Used as `owner` constraint on randomness accounts to prevent
/// fake-randomness injection attacks.
#[cfg(feature = "devnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_DEVNET_PID;

#[cfg(not(feature = "devnet"))]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_MAINNET_PID;

// ---------------------------------------------------------------------------
// Timing Parameters
// ---------------------------------------------------------------------------

/// Slots per epoch (~5 minutes on devnet at 400ms/slot, ~30 minutes on mainnet).
/// Source: Epoch_State_Machine_Spec.md Section 3.1
#[cfg(feature = "devnet")]
pub const SLOTS_PER_EPOCH: u64 = 750;

#[cfg(not(feature = "devnet"))]
pub const SLOTS_PER_EPOCH: u64 = 4_500;

/// Milliseconds per slot estimate for UI display.
/// Conservative estimate accounting for validator variance.
pub const MS_PER_SLOT_ESTIMATE: u64 = 420;

/// VRF timeout in slots (~2 minutes).
/// If oracle doesn't reveal within this window, retry is permitted.
/// Source: Epoch_State_Machine_Spec.md Section 3.1
pub const VRF_TIMEOUT_SLOTS: u64 = 300;

/// Carnage execution deadline in slots (~2 minutes).
/// Total window: 0-50 = atomic-only lock, 50-300 = fallback allowed, >300 = expired.
/// Source: Phase 47 CONTEXT.md
pub const CARNAGE_DEADLINE_SLOTS: u64 = 300;

/// Bounty paid to epoch trigger caller (0.001 SOL).
/// Incentivizes timely epoch transitions.
/// ~66x actual 3-TX base cost -- generous but treasury-efficient.
/// Source: Phase 50 CONTEXT.md
pub const TRIGGER_BOUNTY_LAMPORTS: u64 = 1_000_000;

/// Seed for deriving the EpochState PDA.
/// Single global account: seeds = ["epoch_state"]
/// Source: Epoch_State_Machine_Spec.md Section 4.4
pub const EPOCH_STATE_SEED: &[u8] = b"epoch_state";

/// Seed for deriving the Carnage signer PDA.
/// Used by Epoch Program to sign CPI calls to Tax Program.
/// Must match Tax Program's CARNAGE_SIGNER_SEED.
pub const CARNAGE_SIGNER_SEED: &[u8] = b"carnage_signer";

// ---------------------------------------------------------------------------
// Tax Rate Constants (Genesis)
// ---------------------------------------------------------------------------

/// Genesis low tax rate in basis points (3%).
/// Source: Epoch_State_Machine_Spec.md Section 5
pub const GENESIS_LOW_TAX_BPS: u16 = 300;

/// Genesis high tax rate in basis points (14%).
/// Source: Epoch_State_Machine_Spec.md Section 5
pub const GENESIS_HIGH_TAX_BPS: u16 = 1400;

// ---------------------------------------------------------------------------
// Staking CPI Constants
// ---------------------------------------------------------------------------

/// Seed for deriving the Staking authority PDA.
/// Used by Epoch Program to sign CPI calls to Staking Program.
/// CRITICAL: Must match Stub Staking's expected seed for seeds::program verification.
pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";

/// Anchor discriminator for Staking::update_cumulative instruction.
/// Computed: sha256("global:update_cumulative")[0..8]
/// Used when building CPI instruction data.
pub const UPDATE_CUMULATIVE_DISCRIMINATOR: [u8; 8] = [0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71];

// ---------------------------------------------------------------------------
// Carnage VRF Constants
// ---------------------------------------------------------------------------

/// Carnage slippage floor for atomic path (85% = 8500 bps).
/// Actual output must be >= 85% of constant-product expected output.
/// 15% tolerance covers normal same-TX deviations; MEV defense is primarily atomicity + VRF unpredictability.
/// Source: Phase 47 CONTEXT.md
pub const CARNAGE_SLIPPAGE_BPS_ATOMIC: u64 = 8500;

/// Carnage slippage floor for fallback path (75% = 7500 bps).
/// More lenient than atomic -- prioritize execution over optimal price in recovery mode.
/// Source: Phase 47 CONTEXT.md
pub const CARNAGE_SLIPPAGE_BPS_FALLBACK: u64 = 7500;

/// Lock window in slots during which only the atomic Carnage path can execute.
/// After this window expires (but before CARNAGE_DEADLINE_SLOTS), the fallback path becomes callable.
/// ~20 seconds at 400ms/slot. Gives atomic TX ample time to confirm.
/// Source: Phase 47 CONTEXT.md
pub const CARNAGE_LOCK_SLOTS: u64 = 50;

/// Carnage trigger threshold (byte 5 < 11 triggers, ~4.3% probability).
/// Source: Carnage_Fund_Spec.md Section 7.1
pub const CARNAGE_TRIGGER_THRESHOLD: u8 = 11;

/// Carnage sell action threshold (byte 6 < 5 = sell, 2% probability).
/// Source: Carnage_Fund_Spec.md Section 7.2
pub const CARNAGE_SELL_THRESHOLD: u8 = 5;

/// Maximum SOL per Carnage swap (1000 SOL in lamports).
/// Bounds compute requirements and prevents "too big to execute" failures.
/// Source: Carnage_Fund_Spec.md Section 9.1
pub const MAX_CARNAGE_SWAP_LAMPORTS: u64 = 1_000_000_000_000;

// ---------------------------------------------------------------------------
// Carnage PDA Seeds
// ---------------------------------------------------------------------------

/// Seed for CarnageFundState PDA.
/// Single global account: seeds = ["carnage_fund"]
pub const CARNAGE_FUND_SEED: &[u8] = b"carnage_fund";

/// Seed for Carnage SOL vault PDA.
/// SystemAccount holding native SOL: seeds = ["carnage_sol_vault"]
pub const CARNAGE_SOL_VAULT_SEED: &[u8] = b"carnage_sol_vault";

/// Seed for Carnage CRIME token vault PDA.
/// Token-2022 account: seeds = ["carnage_crime_vault"]
pub const CARNAGE_CRIME_VAULT_SEED: &[u8] = b"carnage_crime_vault";

/// Seed for Carnage FRAUD token vault PDA.
/// Token-2022 account: seeds = ["carnage_fraud_vault"]
pub const CARNAGE_FRAUD_VAULT_SEED: &[u8] = b"carnage_fraud_vault";

/// Anchor discriminator for Tax Program's swap_exempt instruction.
/// Computed: sha256("global:swap_exempt")[0..8]
/// Used when building CPI instruction data for Carnage swap operations.
/// Promoted from instruction files in Phase 82 for single source of truth.
pub const SWAP_EXEMPT_DISCRIMINATOR: [u8; 8] = [0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c];

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify discriminator matches sha256("global:update_cumulative")[0..8].
    /// This test documents how the discriminator was derived and ensures
    /// it remains correct if the instruction name changes.
    #[test]
    fn test_update_cumulative_discriminator() {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"global:update_cumulative");
        let result = hasher.finalize();
        let expected: [u8; 8] = result[0..8].try_into().unwrap();
        assert_eq!(
            UPDATE_CUMULATIVE_DISCRIMINATOR, expected,
            "Discriminator mismatch: expected {:02x?}, got {:02x?}",
            expected, UPDATE_CUMULATIVE_DISCRIMINATOR
        );
    }

    /// Verify staking authority seed is correct string.
    /// CRITICAL: Must match stub-staking's STAKING_AUTHORITY_SEED.
    #[test]
    fn test_staking_authority_seed() {
        assert_eq!(
            STAKING_AUTHORITY_SEED,
            b"staking_authority",
            "Seed must match stub-staking's expected seed"
        );
    }

    /// Verify seed matches stub-staking expectation.
    /// Cross-reference: programs/stub-staking/src/lib.rs
    #[test]
    fn test_staking_authority_seed_length() {
        // 17 bytes: "staking_authority"
        assert_eq!(STAKING_AUTHORITY_SEED.len(), 17);
    }

    #[test]
    fn test_tax_program_id() {
        let id = tax_program_id();
        assert_eq!(
            id.to_string(),
            "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
        );
    }

    #[test]
    fn test_amm_program_id() {
        let id = amm_program_id();
        assert_eq!(
            id.to_string(),
            "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        );
    }

    #[test]
    fn test_staking_program_id() {
        let id = staking_program_id();
        assert_eq!(
            id.to_string(),
            "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
        );
    }

    /// Verify swap_exempt discriminator matches sha256("global:swap_exempt")[0..8].
    /// This test documents how the discriminator was derived and ensures
    /// it remains correct if the instruction name changes.
    #[test]
    fn test_swap_exempt_discriminator() {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"global:swap_exempt");
        let result = hasher.finalize();
        let expected: [u8; 8] = result[0..8].try_into().unwrap();
        assert_eq!(
            SWAP_EXEMPT_DISCRIMINATOR, expected,
            "Discriminator mismatch: expected {:02x?}, got {:02x?}",
            expected, SWAP_EXEMPT_DISCRIMINATOR
        );
    }

    #[test]
    fn test_switchboard_program_id_is_not_system() {
        // Verify it's not a placeholder
        assert_ne!(
            SWITCHBOARD_PROGRAM_ID.to_string(),
            "11111111111111111111111111111111",
            "SWITCHBOARD_PROGRAM_ID should not be System Program"
        );
    }

    // ---- Phase 47: Carnage Hardening Constants ----

    /// Verify atomic slippage floor is 85% (8500 bps).
    /// The 15% tolerance covers normal same-TX deviations; MEV defense
    /// is primarily atomicity + VRF unpredictability.
    #[test]
    fn test_carnage_slippage_bps_atomic() {
        assert_eq!(CARNAGE_SLIPPAGE_BPS_ATOMIC, 8500);
        // 85% floor: expected * 8500 / 10000
    }

    /// Verify fallback slippage floor is 75% (7500 bps).
    /// More lenient than atomic -- prioritize execution over optimal price
    /// in recovery mode (after lock window expires).
    #[test]
    fn test_carnage_slippage_bps_fallback() {
        assert_eq!(CARNAGE_SLIPPAGE_BPS_FALLBACK, 7500);
        // 75% floor: expected * 7500 / 10000
    }

    /// Verify lock window is 50 slots (~20 seconds at 400ms/slot).
    /// During this window, only the atomic Carnage path can execute.
    /// Must be less than CARNAGE_DEADLINE_SLOTS to leave room for fallback.
    #[test]
    fn test_carnage_lock_slots() {
        assert_eq!(CARNAGE_LOCK_SLOTS, 50);
        // Must be less than CARNAGE_DEADLINE_SLOTS
        assert!(CARNAGE_LOCK_SLOTS < CARNAGE_DEADLINE_SLOTS);
    }

    /// Verify Carnage deadline was increased to 300 slots in Phase 47.
    /// Total window: 0-50 = atomic-only lock, 50-300 = fallback allowed, >300 = expired.
    #[test]
    fn test_carnage_deadline_slots_updated() {
        // Phase 47 increased from 100 to 300 slots (~2 minutes)
        assert_eq!(CARNAGE_DEADLINE_SLOTS, 300);
    }

    /// Verify the lock window is well within the deadline, leaving adequate
    /// room for fallback execution. The fallback window should be at least
    /// 200 slots (~80 seconds) to allow multiple retry attempts.
    #[test]
    fn test_lock_window_within_deadline() {
        // Lock window must expire before fallback deadline
        // Lock: 50 slots. Deadline: 300 slots.
        // Fallback window: slots 50-300.
        assert!(CARNAGE_LOCK_SLOTS < CARNAGE_DEADLINE_SLOTS);
        let fallback_window = CARNAGE_DEADLINE_SLOTS - CARNAGE_LOCK_SLOTS;
        assert!(fallback_window >= 200, "Fallback window should be >= 200 slots");
    }

    #[test]
    fn test_slots_per_epoch_value() {
        // Value depends on feature flag:
        // devnet: 750 slots (~5 min)
        // mainnet: 4500 slots (~30 min)
        // This test asserts the compiled value is one of the two valid options.
        assert!(
            SLOTS_PER_EPOCH == 750 || SLOTS_PER_EPOCH == 4_500,
            "SLOTS_PER_EPOCH must be 750 (devnet) or 4500 (mainnet), got {}",
            SLOTS_PER_EPOCH
        );
    }

    #[test]
    fn test_trigger_bounty_lamports() {
        // 0.001 SOL = 1,000,000 lamports
        assert_eq!(TRIGGER_BOUNTY_LAMPORTS, 1_000_000);
    }

    // ---- Phase 83: EpochState Layout Validation (VRF-09) ----

    /// Validate EpochState Borsh-serialized byte offsets match TypeScript EPOCH_STATE_OFFSETS.
    ///
    /// This test serializes a known EpochState value with recognizable byte patterns,
    /// then reads specific byte positions to verify the layout matches documented offsets.
    /// If a field is added/removed/resized, this test WILL fail, catching layout drift.
    ///
    /// Offsets documented here are DATA offsets (without 8-byte discriminator).
    /// To get on-chain byte offset, add 8.
    ///
    /// Cross-reference: tests/integration/helpers/mock-vrf.ts EPOCH_STATE_OFFSETS
    #[test]
    fn test_epoch_state_serialized_offsets() {
        use anchor_lang::AnchorSerialize;
        use crate::state::EpochState;

        let state = EpochState {
            genesis_slot: 0x0807060504030201,         // LE: 01 02 03 04 05 06 07 08
            current_epoch: 0x0C0B0A09,                // LE: 09 0A 0B 0C
            epoch_start_slot: 0x100F0E0D_14131211,    // arbitrary
            cheap_side: 0xAA,
            low_tax_bps: 0xBBCC,
            high_tax_bps: 0xDDEE,
            crime_buy_tax_bps: 0x1122,
            crime_sell_tax_bps: 0x3344,
            fraud_buy_tax_bps: 0x5566,
            fraud_sell_tax_bps: 0x7788,
            vrf_request_slot: 0xAAAAAAAABBBBBBBB,
            vrf_pending: true,
            taxes_confirmed: false,
            pending_randomness_account: Pubkey::new_from_array([0xFF; 32]),
            carnage_pending: true,
            carnage_target: 0x42,
            carnage_action: 0x43,
            carnage_deadline_slot: 0xDEADBEEFCAFEBABE,
            carnage_lock_slot: 0x1234567890ABCDEF,
            last_carnage_epoch: 0xFEEDFACE,
            reserved: [0; 64],
            initialized: true,
            bump: 0xFD,
        };

        let mut buf = Vec::new();
        state.serialize(&mut buf).unwrap();

        // Verify total serialized size (without discriminator)
        assert_eq!(buf.len(), EpochState::DATA_LEN,
            "Serialized size must match DATA_LEN (164 bytes)");

        // --- Verify field offsets by checking recognizable byte patterns ---
        // All offsets below are DATA offsets (on-chain = offset + 8)

        // genesis_slot at data offset 0 (on-chain 8): 0x0807060504030201 LE
        assert_eq!(buf[0], 0x01, "genesis_slot[0] at data offset 0");
        assert_eq!(buf[7], 0x08, "genesis_slot[7] at data offset 7");

        // current_epoch at data offset 8 (on-chain 16): 0x0C0B0A09 LE
        assert_eq!(buf[8], 0x09, "current_epoch[0] at data offset 8");
        assert_eq!(buf[11], 0x0C, "current_epoch[3] at data offset 11");

        // epoch_start_slot at data offset 12 (on-chain 20)
        // cheap_side at data offset 20 (on-chain 28)
        assert_eq!(buf[20], 0xAA, "cheap_side at data offset 20");

        // low_tax_bps at data offset 21 (on-chain 29): 0xBBCC LE
        assert_eq!(buf[21], 0xCC, "low_tax_bps[0] at data offset 21");
        assert_eq!(buf[22], 0xBB, "low_tax_bps[1] at data offset 22");

        // high_tax_bps at data offset 23 (on-chain 31): 0xDDEE LE
        assert_eq!(buf[23], 0xEE, "high_tax_bps[0] at data offset 23");

        // crime_buy_tax_bps at data offset 25 (on-chain 33)
        assert_eq!(buf[25], 0x22, "crime_buy_tax_bps[0] at data offset 25");

        // vrf_request_slot at data offset 33 (on-chain 41)
        assert_eq!(buf[33], 0xBB, "vrf_request_slot[0] at data offset 33");

        // vrf_pending at data offset 41 (on-chain 49): true = 1
        assert_eq!(buf[41], 1, "vrf_pending at data offset 41");

        // taxes_confirmed at data offset 42 (on-chain 50): false = 0
        assert_eq!(buf[42], 0, "taxes_confirmed at data offset 42");

        // pending_randomness_account at data offset 43 (on-chain 51): all 0xFF
        assert_eq!(buf[43], 0xFF, "pending_randomness_account[0] at data offset 43");
        assert_eq!(buf[74], 0xFF, "pending_randomness_account[31] at data offset 74");

        // carnage_pending at data offset 75 (on-chain 83): true = 1
        assert_eq!(buf[75], 1, "carnage_pending at data offset 75");

        // carnage_target at data offset 76 (on-chain 84)
        assert_eq!(buf[76], 0x42, "carnage_target at data offset 76");

        // carnage_action at data offset 77 (on-chain 85)
        assert_eq!(buf[77], 0x43, "carnage_action at data offset 77");

        // carnage_deadline_slot at data offset 78 (on-chain 86): 0xDEADBEEFCAFEBABE LE
        assert_eq!(buf[78], 0xBE, "carnage_deadline_slot[0] at data offset 78");

        // carnage_lock_slot at data offset 86 (on-chain 94): 0x1234567890ABCDEF LE
        assert_eq!(buf[86], 0xEF, "carnage_lock_slot[0] at data offset 86");
        assert_eq!(buf[93], 0x12, "carnage_lock_slot[7] at data offset 93");

        // last_carnage_epoch at data offset 94 (on-chain 102): 0xFEEDFACE LE
        assert_eq!(buf[94], 0xCE, "last_carnage_epoch[0] at data offset 94");
        assert_eq!(buf[97], 0xFE, "last_carnage_epoch[3] at data offset 97");

        // reserved at data offset 98 (on-chain 106): 64 zero bytes
        for i in 0..64 {
            assert_eq!(buf[98 + i], 0, "reserved[{}] at data offset {}", i, 98 + i);
        }

        // initialized at data offset 162 (on-chain 170): true = 1
        assert_eq!(buf[162], 1, "initialized at data offset 162");

        // bump at data offset 163 (on-chain 171)
        assert_eq!(buf[163], 0xFD, "bump at data offset 163");
    }

    // ---- Phase 83: Anti-Reroll Documentation (VRF-06) ----

    /// Anti-reroll protection test documentation (VRF-06):
    ///
    /// The `consume_randomness` instruction has a constraint:
    ///   `constraint = randomness_account.key() == epoch_state.pending_randomness_account`
    ///
    /// Attempting to consume with a different randomness account triggers:
    ///   AnchorError { error_code_number: 2012, error_msg: "A raw constraint was violated" }
    ///   (ConstraintRaw / 0x07DC)
    ///
    /// This is validated in the LiteSVM integration tests at:
    ///   tests/integration/cpi-chains.test.ts
    ///
    /// The specific assertion should be:
    ///   expect(error.error.errorCode.number).toBe(2012);
    #[test]
    fn test_anti_reroll_error_code_documented() {
        // Anchor ConstraintRaw error code.
        // When consume_randomness receives a randomness account that doesn't match
        // pending_randomness_account, Anchor rejects with error 2012.
        const CONSTRAINT_RAW_ERROR_CODE: u32 = 2012;
        assert_eq!(CONSTRAINT_RAW_ERROR_CODE, 2012, "Anti-reroll uses Anchor ConstraintRaw");

        // Hex representation for cross-referencing with on-chain errors
        assert_eq!(CONSTRAINT_RAW_ERROR_CODE, 0x07DC, "ConstraintRaw hex value");
    }
}
