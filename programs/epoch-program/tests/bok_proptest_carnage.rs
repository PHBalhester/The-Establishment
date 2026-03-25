//! BOK Proptest verification suite for Carnage VRF decisions.
//!
//! Exhaustive (all 256 byte values) tests for trigger, action, and target.
//!
//! Invariants verified:
//! - INV-CG-001: Trigger Probability 11/256 (~4.3%)
//! - INV-CG-002: Sell Probability 5/256 (~2%)
//! - INV-CG-003: No-Holdings -> Always None
//! - INV-CG-004: Target Selection 50/50
//! - INV-CG-005: Three Decisions Use Distinct Bytes (5, 6, 7)
//! - INV-CG-006: Joint Sell-Carnage Probability 55/65536
//! - INV-CG-009: Threshold Constants Match Documented Probabilities
//!
//! Run: `cargo test --test bok_proptest_carnage -- --nocapture`

use epoch_program::helpers::carnage::*;
use epoch_program::state::{CarnageAction, Token};
use epoch_program::constants::{CARNAGE_TRIGGER_THRESHOLD, CARNAGE_SELL_THRESHOLD};
use proptest::prelude::*;

/// Creates a 32-byte VRF result with specified Carnage bytes at positions 5, 6, 7.
fn make_vrf(byte5: u8, byte6: u8, byte7: u8) -> [u8; 32] {
    let mut result = [0u8; 32];
    result[5] = byte5;
    result[6] = byte6;
    result[7] = byte7;
    result
}

// =============================================================================
// INV-CG-001: Trigger Probability 11/256
//
// Exhaustive: exactly 11 of 256 byte values trigger Carnage.
// =============================================================================
#[test]
fn inv_cg_001_trigger_probability_exhaustive() {
    let mut trigger_count = 0u32;
    for byte5 in 0..=255u8 {
        let vrf = make_vrf(byte5, 0, 0);
        if is_carnage_triggered(&vrf) {
            trigger_count += 1;
        }
    }
    assert_eq!(
        trigger_count, 11,
        "INV-CG-001: Expected exactly 11 trigger values, got {}",
        trigger_count
    );
}

// =============================================================================
// INV-CG-002: Sell Probability 5/256
//
// Exhaustive: exactly 5 of 256 byte values produce Sell action.
// =============================================================================
#[test]
fn inv_cg_002_sell_probability_exhaustive() {
    let mut sell_count = 0u32;
    for byte6 in 0..=255u8 {
        let vrf = make_vrf(0, byte6, 0);
        if get_carnage_action(&vrf, true) == CarnageAction::Sell {
            sell_count += 1;
        }
    }
    assert_eq!(
        sell_count, 5,
        "INV-CG-002: Expected exactly 5 sell values, got {}",
        sell_count
    );
}

// =============================================================================
// INV-CG-003: No-Holdings -> Always None
//
// Exhaustive: every byte 6 value produces CarnageAction::None when no holdings.
// =============================================================================
#[test]
fn inv_cg_003_no_holdings_always_none() {
    for byte6 in 0..=255u8 {
        let vrf = make_vrf(0, byte6, 0);
        let action = get_carnage_action(&vrf, false);
        assert_eq!(
            action,
            CarnageAction::None,
            "INV-CG-003: byte6={} with no holdings should be None, got {:?}",
            byte6, action
        );
    }
}

// =============================================================================
// INV-CG-004: Target Selection 50/50
//
// Exhaustive: 128 Crime, 128 Fraud — perfect split.
// =============================================================================
#[test]
fn inv_cg_004_target_selection_5050() {
    let mut crime_count = 0u32;
    let mut fraud_count = 0u32;
    for byte7 in 0..=255u8 {
        let vrf = make_vrf(0, 0, byte7);
        match get_carnage_target(&vrf) {
            Token::Crime => crime_count += 1,
            Token::Fraud => fraud_count += 1,
        }
    }
    assert_eq!(crime_count, 128, "INV-CG-004: Expected 128 Crime, got {}", crime_count);
    assert_eq!(fraud_count, 128, "INV-CG-004: Expected 128 Fraud, got {}", fraud_count);
}

// =============================================================================
// INV-CG-005: Three Decisions Use Distinct Bytes
//
// Byte 5 = trigger, Byte 6 = action, Byte 7 = target.
// Changing one byte must not affect the other decisions.
// =============================================================================
proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    #[test]
    fn inv_cg_005_distinct_bytes(
        byte5 in 0u8..=255u8,
        byte6 in 0u8..=255u8,
        byte7 in 0u8..=255u8,
        alt_byte5 in 0u8..=255u8,
        alt_byte6 in 0u8..=255u8,
        alt_byte7 in 0u8..=255u8,
    ) {
        // Changing byte 5 must not change action or target
        let vrf_a = make_vrf(byte5, byte6, byte7);
        let vrf_b = make_vrf(alt_byte5, byte6, byte7);
        prop_assert_eq!(
            get_carnage_action(&vrf_a, true), get_carnage_action(&vrf_b, true),
            "INV-CG-005: Changing byte5 affected action"
        );
        prop_assert_eq!(
            get_carnage_target(&vrf_a), get_carnage_target(&vrf_b),
            "INV-CG-005: Changing byte5 affected target"
        );

        // Changing byte 6 must not change trigger or target
        let vrf_c = make_vrf(byte5, alt_byte6, byte7);
        prop_assert_eq!(
            is_carnage_triggered(&vrf_a), is_carnage_triggered(&vrf_c),
            "INV-CG-005: Changing byte6 affected trigger"
        );
        prop_assert_eq!(
            get_carnage_target(&vrf_a), get_carnage_target(&vrf_c),
            "INV-CG-005: Changing byte6 affected target"
        );

        // Changing byte 7 must not change trigger or action
        let vrf_d = make_vrf(byte5, byte6, alt_byte7);
        prop_assert_eq!(
            is_carnage_triggered(&vrf_a), is_carnage_triggered(&vrf_d),
            "INV-CG-005: Changing byte7 affected trigger"
        );
        prop_assert_eq!(
            get_carnage_action(&vrf_a, true), get_carnage_action(&vrf_d, true),
            "INV-CG-005: Changing byte7 affected action"
        );
    }
}

// =============================================================================
// INV-CG-006: Joint Sell-Carnage Probability 55/65536
//
// Exhaustive over byte 5 + byte 6: count pairs where trigger AND sell.
// 11 trigger values * 5 sell values = 55.
// =============================================================================
#[test]
fn inv_cg_006_joint_sell_carnage_probability() {
    let mut joint_count = 0u32;
    for byte5 in 0..=255u16 {
        for byte6 in 0..=255u16 {
            let vrf = make_vrf(byte5 as u8, byte6 as u8, 0);
            if is_carnage_triggered(&vrf) && get_carnage_action(&vrf, true) == CarnageAction::Sell {
                joint_count += 1;
            }
        }
    }
    assert_eq!(
        joint_count, 55,
        "INV-CG-006: Expected 55 joint sell-carnage pairs, got {}",
        joint_count
    );
}

// =============================================================================
// INV-CG-009: Threshold Constants Match Documented Probabilities
// =============================================================================
#[test]
fn inv_cg_009_threshold_constants() {
    assert_eq!(CARNAGE_TRIGGER_THRESHOLD, 11, "Trigger threshold must be 11");
    assert_eq!(CARNAGE_SELL_THRESHOLD, 5, "Sell threshold must be 5");
    // Target threshold is hardcoded as 128 in carnage.rs
    // (INV-CG-010 advisory: should be a named constant)
}
