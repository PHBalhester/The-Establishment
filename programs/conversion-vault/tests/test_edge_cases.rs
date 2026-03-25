/// Edge case tests for Conversion Vault program.
///
/// Covers gaps from docs/edge-case-audit.md:
/// - VAULT-01 (MEDIUM): PROFIT->CRIME overflow with u64::MAX input
/// - VAULT-02 (MEDIUM): Unknown mint (not CRIME/FRAUD/PROFIT) produces InvalidMintPair

use anchor_lang::prelude::Pubkey;
use conversion_vault::instructions::compute_output_with_mints;
use conversion_vault::constants::CONVERSION_RATE;

/// Test mint addresses
fn test_crime() -> Pubkey {
    Pubkey::new_from_array([1u8; 32])
}
fn test_fraud() -> Pubkey {
    Pubkey::new_from_array([2u8; 32])
}
fn test_profit() -> Pubkey {
    Pubkey::new_from_array([3u8; 32])
}
fn unknown_mint() -> Pubkey {
    Pubkey::new_from_array([99u8; 32])
}

fn compute(input: &Pubkey, output: &Pubkey, amount: u64) -> anchor_lang::Result<u64> {
    compute_output_with_mints(input, output, amount, &test_crime(), &test_fraud(), &test_profit())
}

// ===========================================================================
// VAULT-01: PROFIT->CRIME overflow with u64::MAX input
//
// PROFIT->CRIME multiplies by CONVERSION_RATE (100).
// u64::MAX * 100 overflows u64 -> should return MathOverflow.
// ===========================================================================

#[test]
fn vault_01_profit_to_crime_overflow_u64_max() {
    let result = compute(&test_profit(), &test_crime(), u64::MAX);
    assert!(result.is_err(), "u64::MAX * 100 should overflow");

    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6005"), // VaultError::MathOverflow
        "Expected MathOverflow (6005), got: {}",
        err_str
    );
}

#[test]
fn vault_01_profit_to_fraud_overflow_u64_max() {
    let result = compute(&test_profit(), &test_fraud(), u64::MAX);
    assert!(result.is_err(), "u64::MAX * 100 should overflow");

    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6005"),
        "Expected MathOverflow (6005), got: {}",
        err_str
    );
}

#[test]
fn vault_01_profit_to_crime_max_safe_value() {
    // Maximum value that doesn't overflow: u64::MAX / 100
    let max_safe = u64::MAX / CONVERSION_RATE;
    let result = compute(&test_profit(), &test_crime(), max_safe);
    assert!(result.is_ok(), "u64::MAX/100 * 100 should not overflow");

    let output = result.unwrap();
    assert_eq!(output, max_safe * CONVERSION_RATE);
}

#[test]
fn vault_01_profit_to_crime_one_above_max_safe() {
    // One above max safe should overflow
    let max_safe = u64::MAX / CONVERSION_RATE;
    let result = compute(&test_profit(), &test_crime(), max_safe + 1);
    assert!(result.is_err(), "One above max safe should overflow");
}

// ===========================================================================
// VAULT-02: Unknown mint produces InvalidMintPair
//
// Only CRIME<->PROFIT and FRAUD<->PROFIT conversions are valid.
// Passing an unknown mint should fail with InvalidMintPair.
// ===========================================================================

#[test]
fn vault_02_unknown_to_profit_rejected() {
    let result = compute(&unknown_mint(), &test_profit(), 1_000_000);
    assert!(result.is_err(), "Unknown mint -> PROFIT should fail");

    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6002"), // VaultError::InvalidMintPair
        "Expected InvalidMintPair (6002), got: {}",
        err_str
    );
}

#[test]
fn vault_02_profit_to_unknown_rejected() {
    let result = compute(&test_profit(), &unknown_mint(), 1_000_000);
    assert!(result.is_err(), "PROFIT -> unknown mint should fail");

    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6002"),
        "Expected InvalidMintPair (6002), got: {}",
        err_str
    );
}

#[test]
fn vault_02_unknown_to_unknown_rejected() {
    let other_unknown = Pubkey::new_from_array([88u8; 32]);
    let result = compute(&unknown_mint(), &other_unknown, 1_000_000);
    assert!(result.is_err(), "Unknown -> unknown should fail");

    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6002"),
        "Expected InvalidMintPair (6002), got: {}",
        err_str
    );
}

#[test]
fn vault_02_crime_to_fraud_still_rejected() {
    // This was tested in existing tests but verify it here too
    // as part of exhaustive invalid pair coverage
    let result = compute(&test_crime(), &test_fraud(), 1_000_000);
    assert!(result.is_err(), "CRIME -> FRAUD direct conversion should fail");
}
