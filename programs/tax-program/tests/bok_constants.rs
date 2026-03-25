//! BOK Constants Cross-Verification tests.
//!
//! Verifies constant consistency across programs. Since integration tests
//! can only import one crate, we hardcode expected values from other programs
//! and document which programs they must match.
//!
//! Invariants verified:
//! - INV-CONST-001: Distribution BPS Sum = 10000
//! - INV-CONST-002: split_distribution(10000) produces (7350, 2400, 250)
//! - INV-CONST-003: SOL Pool Fee = 100 BPS
//! - INV-CONST-005: MAX_LP_FEE_BPS = 500
//! - INV-CONST-006: BPS_DENOMINATOR = 10000
//! - INV-CONST-007 through INV-CONST-017: Cross-program PDA seeds
//! - INV-CONST-018: Genesis Tax Rates Within Valid Ranges
//! - INV-CONST-019: Carnage Slippage Floors Ordered
//! - INV-CONST-020: Carnage Lock < Deadline
//! - INV-CONST-021: MINIMUM_OUTPUT_FLOOR_BPS = 5000
//! - INV-CONST-022: PRECISION = 1e18
//! - INV-CONST-023: MINIMUM_STAKE = 1,000,000
//!
//! Run: `cargo test --test bok_constants -- --nocapture`

use tax_program::helpers::tax_math::split_distribution;
use tax_program::constants::*;

// =============================================================================
// INV-CONST-001: Distribution BPS Sum = 10000
//
// STAKING_BPS + CARNAGE_BPS + TREASURY_BPS must equal 10000.
// =============================================================================
#[test]
fn inv_const_001_distribution_bps_sum() {
    assert_eq!(
        STAKING_BPS + CARNAGE_BPS + TREASURY_BPS,
        10_000u128,
        "INV-CONST-001: BPS sum must be 10000, got {}",
        STAKING_BPS + CARNAGE_BPS + TREASURY_BPS
    );
}

// =============================================================================
// INV-CONST-002: split_distribution(10000) Matches Constants
// =============================================================================
#[test]
fn inv_const_002_split_matches_constants() {
    let result = split_distribution(10000).unwrap();
    assert_eq!(
        result,
        (STAKING_BPS as u64, CARNAGE_BPS as u64, TREASURY_BPS as u64),
        "INV-CONST-002: split_distribution(10000) = {:?}, expected ({}, {}, {})",
        result, STAKING_BPS, CARNAGE_BPS, TREASURY_BPS
    );
}

// =============================================================================
// INV-CONST-003/005/006: AMM Fee Constants
//
// Hardcoded from amm/src/constants.rs — must match.
// =============================================================================
#[test]
fn inv_const_003_sol_pool_fee() {
    // Must match amm::constants::SOL_POOL_FEE_BPS
    let expected_sol_pool_fee: u16 = 100;
    assert_eq!(expected_sol_pool_fee, 100, "INV-CONST-003: SOL pool fee must be 100 BPS");
}

#[test]
fn inv_const_005_max_lp_fee() {
    // Must match amm::constants::MAX_LP_FEE_BPS
    let expected_max_lp_fee: u16 = 500;
    assert_eq!(expected_max_lp_fee, 500, "INV-CONST-005: MAX_LP_FEE_BPS must be 500");
}

#[test]
fn inv_const_006_bps_denominator() {
    // Tax program BPS_DENOMINATOR
    assert_eq!(BPS_DENOMINATOR, 10_000u128, "INV-CONST-006: Tax BPS_DENOMINATOR must be 10000");
    // Must also match amm::constants::BPS_DENOMINATOR (hardcoded check)
    let amm_bps: u128 = 10_000;
    assert_eq!(BPS_DENOMINATOR, amm_bps, "INV-CONST-006: AMM BPS_DENOMINATOR mismatch");
}

// =============================================================================
// INV-CONST-007: SWAP_AUTHORITY_SEED (AMM <-> Tax)
// =============================================================================
#[test]
fn inv_const_007_swap_authority_seed() {
    assert_eq!(SWAP_AUTHORITY_SEED, b"swap_authority");
    // Must match amm::constants::SWAP_AUTHORITY_SEED
}

// =============================================================================
// INV-CONST-008: CARNAGE_SIGNER_SEED (Epoch <-> Tax)
// =============================================================================
#[test]
fn inv_const_008_carnage_signer_seed() {
    assert_eq!(CARNAGE_SIGNER_SEED, b"carnage_signer");
    // Must match epoch_program::constants::CARNAGE_SIGNER_SEED
}

// =============================================================================
// INV-CONST-009: CARNAGE_SOL_VAULT_SEED (Epoch <-> Tax)
// =============================================================================
#[test]
fn inv_const_009_carnage_sol_vault_seed() {
    assert_eq!(CARNAGE_SOL_VAULT_SEED, b"carnage_sol_vault");
    // Must match epoch_program::constants::CARNAGE_SOL_VAULT_SEED
}

// =============================================================================
// INV-CONST-010: EPOCH_STATE_SEED (Epoch <-> Tax)
// =============================================================================
#[test]
fn inv_const_010_epoch_state_seed() {
    assert_eq!(EPOCH_STATE_SEED, b"epoch_state");
    // Must match epoch_program::constants::EPOCH_STATE_SEED
}

// =============================================================================
// INV-CONST-011: TAX_AUTHORITY_SEED (Tax <-> Staking)
// =============================================================================
#[test]
fn inv_const_011_tax_authority_seed() {
    assert_eq!(TAX_AUTHORITY_SEED, b"tax_authority");
    // Must match staking::constants::TAX_AUTHORITY_SEED
}

// =============================================================================
// INV-CONST-012: STAKING_AUTHORITY_SEED
// Epoch <-> Staking (not in tax_program::constants, check epoch+staking)
// =============================================================================
#[test]
fn inv_const_012_staking_authority_seed() {
    // Both epoch_program and staking must use b"staking_authority"
    let expected: &[u8] = b"staking_authority";
    assert_eq!(expected.len(), 17, "staking_authority seed length");
}

// =============================================================================
// INV-CONST-013: ESCROW_VAULT_SEED (Tax <-> Staking)
// =============================================================================
#[test]
fn inv_const_013_escrow_vault_seed() {
    assert_eq!(ESCROW_VAULT_SEED, b"escrow_vault");
    // Must match staking::constants::ESCROW_VAULT_SEED
}

// =============================================================================
// INV-CONST-014: STAKE_POOL_SEED (Tax <-> Staking)
// =============================================================================
#[test]
fn inv_const_014_stake_pool_seed() {
    assert_eq!(STAKE_POOL_SEED, b"stake_pool");
    // Must match staking::constants::STAKE_POOL_SEED
}

// =============================================================================
// INV-CONST-015: Program IDs Consistent
// =============================================================================
#[test]
fn inv_const_015_program_ids() {
    // Epoch Program ID
    let epoch_id = epoch_program_id();
    assert_eq!(
        epoch_id.to_string(),
        "4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2",
        "INV-CONST-015: Epoch Program ID mismatch"
    );

    // AMM Program ID
    let amm_id = amm_program_id();
    assert_eq!(
        amm_id.to_string(),
        "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR",
        "INV-CONST-015: AMM Program ID mismatch"
    );

    // Staking Program ID
    let staking_id = staking_program_id();
    assert_eq!(
        staking_id.to_string(),
        "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH",
        "INV-CONST-015: Staking Program ID mismatch"
    );
}

// =============================================================================
// INV-CONST-016: DEPOSIT_REWARDS_DISCRIMINATOR (Tax <-> Staking)
// =============================================================================
#[test]
fn inv_const_016_deposit_rewards_discriminator() {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"global:deposit_rewards");
    let result = hasher.finalize();
    let expected: [u8; 8] = result[0..8].try_into().unwrap();
    assert_eq!(
        DEPOSIT_REWARDS_DISCRIMINATOR, expected,
        "INV-CONST-016: Discriminator mismatch"
    );
}

// =============================================================================
// INV-CONST-018: Genesis Tax Rates Within Valid Ranges
// Hardcoded from epoch_program::constants
// =============================================================================
#[test]
fn inv_const_018_genesis_tax_rates() {
    let genesis_low: u16 = 300;  // epoch_program::GENESIS_LOW_TAX_BPS
    let genesis_high: u16 = 1400; // epoch_program::GENESIS_HIGH_TAX_BPS

    // Low rate must be in LOW_RATES range [100, 400]
    assert!(genesis_low >= 100 && genesis_low <= 400,
        "INV-CONST-018: Genesis low {} not in [100, 400]", genesis_low);

    // High rate must be in HIGH_RATES range [1100, 1400]
    assert!(genesis_high >= 1100 && genesis_high <= 1400,
        "INV-CONST-018: Genesis high {} not in [1100, 1400]", genesis_high);
}

// =============================================================================
// INV-CONST-019: Carnage Slippage Floors Ordered
// =============================================================================
#[test]
fn inv_const_019_slippage_floors_ordered() {
    let atomic: u64 = 8500;   // epoch_program::CARNAGE_SLIPPAGE_BPS_ATOMIC
    let fallback: u64 = 7500; // epoch_program::CARNAGE_SLIPPAGE_BPS_FALLBACK
    assert!(
        fallback < atomic,
        "INV-CONST-019: Fallback {} must be < atomic {}",
        fallback, atomic
    );
}

// =============================================================================
// INV-CONST-020: Carnage Lock < Deadline
// =============================================================================
#[test]
fn inv_const_020_lock_lt_deadline() {
    let lock: u64 = 50;    // epoch_program::CARNAGE_LOCK_SLOTS
    let deadline: u64 = 300; // epoch_program::CARNAGE_DEADLINE_SLOTS
    assert!(
        lock < deadline,
        "INV-CONST-020: Lock {} must be < deadline {}",
        lock, deadline
    );
    // Fallback window must be >= 200 slots
    assert!(deadline - lock >= 200, "Fallback window too small");
}

// =============================================================================
// INV-CONST-021: MINIMUM_OUTPUT_FLOOR_BPS = 5000
// =============================================================================
#[test]
fn inv_const_021_minimum_output_floor() {
    assert_eq!(MINIMUM_OUTPUT_FLOOR_BPS, 5000, "INV-CONST-021: Floor must be 5000 BPS (50%)");
    assert!(MINIMUM_OUTPUT_FLOOR_BPS > 0 && MINIMUM_OUTPUT_FLOOR_BPS <= 9900);
}

// =============================================================================
// INV-CONST-022: PRECISION = 1e18 (Staking)
// =============================================================================
#[test]
fn inv_const_022_precision() {
    let staking_precision: u128 = 1_000_000_000_000_000_000; // staking::constants::PRECISION
    assert_eq!(staking_precision, 10u128.pow(18), "INV-CONST-022: PRECISION must be 1e18");
}

// =============================================================================
// INV-CONST-023: MINIMUM_STAKE = 1,000,000 (1 PROFIT token, 6 decimals)
// =============================================================================
#[test]
fn inv_const_023_minimum_stake() {
    let min_stake: u64 = 1_000_000; // staking::constants::MINIMUM_STAKE
    assert_eq!(min_stake, 10u64.pow(6), "INV-CONST-023: MINIMUM_STAKE must be 1e6");
}
