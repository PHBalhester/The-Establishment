//! BOK Proptest verification suite for Conversion Vault math.
//!
//! Tests the pure conversion math: CRIME/FRAUD <-> PROFIT at 100:1 ratio.
//!
//! Invariants verified:
//! - INV-CV-001: PROFIT->IP No Overflow (realistic supply)
//! - INV-CV-002: PROFIT->IP Overflow Boundary Correct
//! - INV-CV-003: IP->PROFIT Dust Rejection (< 100 = Error)
//! - INV-CV-004: Round-Trip IP->PROFIT->IP Loses Exactly N%100
//! - INV-CV-005: Round-Trip PROFIT->IP->PROFIT Is Lossless
//! - INV-CV-006: Same-Mint Conversion Rejected
//! - INV-CV-007: CRIME<->FRAUD Direct Rejected
//! - INV-CV-008: Zero Amount Rejected
//!
//! Run: `cargo test --test bok_proptest_vault -- --nocapture`

use anchor_lang::prelude::Pubkey;
use conversion_vault::instructions::convert::compute_output_with_mints;
use proptest::prelude::*;

/// Create three unique mint pubkeys for testing.
fn test_mints() -> (Pubkey, Pubkey, Pubkey) {
    let crime = Pubkey::new_unique();
    let fraud = Pubkey::new_unique();
    let profit = Pubkey::new_unique();
    (crime, fraud, profit)
}

// =============================================================================
// INV-CV-001: PROFIT->IP No Overflow (Realistic Supply)
//
// For amount <= 20_000_000_000_000 (20T = entire PROFIT supply at 6 decimals),
// amount * 100 must not overflow u64.
// 20T * 100 = 2T, well within u64::MAX (~18.4e18).
// =============================================================================
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_cv_001_profit_to_ip_no_overflow(
        amount in 1u64..=20_000_000_000_000u64,
    ) {
        let (crime, _, profit) = test_mints();
        let result = compute_output_with_mints(&profit, &crime, amount, &crime, &Pubkey::new_unique(), &profit);
        prop_assert!(result.is_ok(), "INV-CV-001: PROFIT->CRIME overflow at amount={}", amount);
        let output = result.unwrap();
        prop_assert_eq!(output, amount * 100, "INV-CV-001: Expected {}*100={}, got {}", amount, amount * 100, output);
    }
}

// =============================================================================
// INV-CV-002: PROFIT->IP Overflow Boundary
//
// Overflow occurs at exactly u64::MAX / 100 + 1.
// =============================================================================
#[test]
fn inv_cv_002_overflow_boundary() {
    let (crime, _, profit) = test_mints();

    // Just below overflow: should succeed
    let safe_amount = u64::MAX / 100;
    let result = compute_output_with_mints(&profit, &crime, safe_amount, &crime, &Pubkey::new_unique(), &profit);
    assert!(result.is_ok(), "INV-CV-002: Should not overflow at u64::MAX/100");
    assert_eq!(result.unwrap(), safe_amount * 100);

    // At overflow: should fail
    let overflow_amount = safe_amount + 1;
    let result = compute_output_with_mints(&profit, &crime, overflow_amount, &crime, &Pubkey::new_unique(), &profit);
    assert!(result.is_err(), "INV-CV-002: Should overflow at u64::MAX/100 + 1");
}

// =============================================================================
// INV-CV-003: IP->PROFIT Dust Rejection
//
// Amounts [1, 99] of CRIME/FRAUD produce 0 PROFIT via integer division.
// The function must return OutputTooSmall error.
// =============================================================================
#[test]
fn inv_cv_003_dust_rejection() {
    let (crime, _, profit) = test_mints();
    for amount in 1..100u64 {
        let result = compute_output_with_mints(&crime, &profit, amount, &crime, &Pubkey::new_unique(), &profit);
        assert!(
            result.is_err(),
            "INV-CV-003: Amount {} should be rejected as dust (output=0)",
            amount
        );
    }

    // amount=100 should succeed (100/100 = 1)
    let result = compute_output_with_mints(&crime, &profit, 100, &crime, &Pubkey::new_unique(), &profit);
    assert!(result.is_ok(), "INV-CV-003: Amount 100 should produce output 1");
    assert_eq!(result.unwrap(), 1);
}

// =============================================================================
// INV-CV-004: Round-Trip IP->PROFIT->IP Loses Exactly N%100
//
// CRIME -> PROFIT: amount / 100 (loses remainder)
// PROFIT -> CRIME: output * 100
// Net loss = amount % 100
// =============================================================================
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_cv_004_round_trip_ip_profit_ip(
        amount in 100u64..=10_000_000_000u64,
    ) {
        let (crime, _, profit) = test_mints();
        let fraud = Pubkey::new_unique();

        // Step 1: CRIME -> PROFIT
        let profit_out = compute_output_with_mints(&crime, &profit, amount, &crime, &fraud, &profit).unwrap();
        prop_assert_eq!(profit_out, amount / 100);

        // Step 2: PROFIT -> CRIME
        let crime_back = compute_output_with_mints(&profit, &crime, profit_out, &crime, &fraud, &profit).unwrap();
        prop_assert_eq!(crime_back, profit_out * 100);

        // Verify loss is exactly amount % 100
        let loss = amount - crime_back;
        prop_assert_eq!(
            loss, amount % 100,
            "INV-CV-004: Expected loss={}, got {} (amount={}, profit_out={}, crime_back={})",
            amount % 100, loss, amount, profit_out, crime_back
        );
    }
}

// =============================================================================
// INV-CV-005: Round-Trip PROFIT->IP->PROFIT Is Lossless
//
// PROFIT -> CRIME: amount * 100
// CRIME -> PROFIT: (amount * 100) / 100 = amount (exact)
// =============================================================================
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    #[test]
    fn inv_cv_005_round_trip_profit_ip_profit(
        amount in 1u64..=(u64::MAX / 100),
    ) {
        let (crime, _, profit) = test_mints();
        let fraud = Pubkey::new_unique();

        // Step 1: PROFIT -> CRIME
        let crime_out = compute_output_with_mints(&profit, &crime, amount, &crime, &fraud, &profit).unwrap();
        prop_assert_eq!(crime_out, amount * 100);

        // Step 2: CRIME -> PROFIT
        let profit_back = compute_output_with_mints(&crime, &profit, crime_out, &crime, &fraud, &profit).unwrap();
        prop_assert_eq!(
            profit_back, amount,
            "INV-CV-005: Round-trip not lossless! amount={}, crime_out={}, profit_back={}",
            amount, crime_out, profit_back
        );
    }
}

// =============================================================================
// INV-CV-006: Same-Mint Conversion Rejected
// =============================================================================
#[test]
fn inv_cv_006_same_mint_rejected() {
    let (crime, fraud, profit) = test_mints();
    // Same mint for all three tokens
    for mint in [&crime, &fraud, &profit] {
        let result = compute_output_with_mints(mint, mint, 1000, &crime, &fraud, &profit);
        assert!(result.is_err(), "INV-CV-006: Same-mint conversion should be rejected");
    }
}

// =============================================================================
// INV-CV-007: CRIME<->FRAUD Direct Rejected
//
// Must go through PROFIT bottleneck.
// =============================================================================
#[test]
fn inv_cv_007_crime_fraud_direct_rejected() {
    let (crime, fraud, profit) = test_mints();

    // CRIME -> FRAUD
    let result = compute_output_with_mints(&crime, &fraud, 1000, &crime, &fraud, &profit);
    assert!(result.is_err(), "INV-CV-007: CRIME->FRAUD direct should be rejected");

    // FRAUD -> CRIME
    let result = compute_output_with_mints(&fraud, &crime, 1000, &crime, &fraud, &profit);
    assert!(result.is_err(), "INV-CV-007: FRAUD->CRIME direct should be rejected");
}

// =============================================================================
// INV-CV-008: Zero Amount Rejected
// =============================================================================
#[test]
fn inv_cv_008_zero_amount_rejected() {
    let (crime, _, profit) = test_mints();
    let fraud = Pubkey::new_unique();

    let result = compute_output_with_mints(&crime, &profit, 0, &crime, &fraud, &profit);
    assert!(result.is_err(), "INV-CV-008: Zero amount should be rejected");

    let result = compute_output_with_mints(&profit, &crime, 0, &crime, &fraud, &profit);
    assert!(result.is_err(), "INV-CV-008: Zero amount should be rejected");
}
