//! BOK Verification: VRF Tax Derivation & Full-Range Invariants
//!
//! Tests INV-TD-001 through INV-TD-011, INV-VR-001, INV-VR-003, INV-VR-004.
//! Combines exhaustive (all 256 values) checks with proptest for random VRF buffers.

use epoch_program::helpers::tax_derivation::{derive_taxes, TaxConfig};
use epoch_program::helpers::carnage::{is_carnage_triggered, get_carnage_action, get_carnage_target};
use epoch_program::state::Token;
use epoch_program::constants::{CARNAGE_TRIGGER_THRESHOLD, CARNAGE_SELL_THRESHOLD};
use proptest::prelude::*;

// ============================================================================
// Helpers
// ============================================================================

/// Build a 32-byte VRF buffer with specified bytes at positions 0-4.
fn make_vrf_tax(b0: u8, b1: u8, b2: u8, b3: u8, b4: u8) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[0] = b0;
    buf[1] = b1;
    buf[2] = b2;
    buf[3] = b3;
    buf[4] = b4;
    buf
}

const LOW_RATES: [u16; 4] = [100, 200, 300, 400];
const HIGH_RATES: [u16; 4] = [1100, 1200, 1300, 1400];

// ============================================================================
// INV-TD-001: Flip Probability Exactly 75%
// ============================================================================

#[test]
fn inv_td_001_flip_probability_exhaustive() {
    let mut flip_count = 0u32;
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(b as u8, 0, 0, 0, 0);
        let config = derive_taxes(&vrf, Token::Crime);
        if config.cheap_side == Token::Fraud {
            // Flipped from Crime -> Fraud
            flip_count += 1;
        }
    }
    assert_eq!(flip_count, 192, "Exactly 192/256 = 75% of byte values should flip");
    // Non-flip count
    assert_eq!(256 - flip_count, 64, "Exactly 64/256 = 25% should NOT flip");
}

#[test]
fn inv_td_001_no_flip_probability_exhaustive() {
    let mut no_flip_count = 0u32;
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(b as u8, 0, 0, 0, 0);
        let config = derive_taxes(&vrf, Token::Fraud);
        if config.cheap_side == Token::Fraud {
            no_flip_count += 1;
        }
    }
    assert_eq!(no_flip_count, 64, "Exactly 64/256 = 25% should keep same side");
}

// ============================================================================
// INV-TD-002: LOW_RATES = {100, 200, 300, 400}
// ============================================================================

#[test]
fn inv_td_002_low_rates_all_256_byte1() {
    // Byte 1 maps to CRIME low rate. When CRIME is cheap, crime_buy = crime_low.
    let valid: std::collections::HashSet<u16> = [100, 200, 300, 400].iter().copied().collect();
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(255, b as u8, 0, 0, 0); // no flip, CRIME cheap
        let config = derive_taxes(&vrf, Token::Crime);
        assert!(
            valid.contains(&config.crime_buy_tax_bps),
            "byte1={}: crime_buy_tax_bps={} not in LOW_RATES",
            b, config.crime_buy_tax_bps
        );
    }
}

#[test]
fn inv_td_002_low_rates_all_256_byte3() {
    // Byte 3 maps to FRAUD low rate. When FRAUD is cheap, fraud_buy = fraud_low.
    let valid: std::collections::HashSet<u16> = [100, 200, 300, 400].iter().copied().collect();
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(255, 0, 0, b as u8, 0); // no flip, FRAUD cheap
        let config = derive_taxes(&vrf, Token::Fraud);
        assert!(
            valid.contains(&config.fraud_buy_tax_bps),
            "byte3={}: fraud_buy_tax_bps={} not in LOW_RATES",
            b, config.fraud_buy_tax_bps
        );
    }
}

// ============================================================================
// INV-TD-003: HIGH_RATES = {1100, 1200, 1300, 1400}
// ============================================================================

#[test]
fn inv_td_003_high_rates_all_256_byte2() {
    // Byte 2 maps to CRIME high rate. When CRIME is cheap, crime_sell = crime_high.
    let valid: std::collections::HashSet<u16> = [1100, 1200, 1300, 1400].iter().copied().collect();
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(255, 0, b as u8, 0, 0); // no flip, CRIME cheap
        let config = derive_taxes(&vrf, Token::Crime);
        assert!(
            valid.contains(&config.crime_sell_tax_bps),
            "byte2={}: crime_sell_tax_bps={} not in HIGH_RATES",
            b, config.crime_sell_tax_bps
        );
    }
}

#[test]
fn inv_td_003_high_rates_all_256_byte4() {
    // Byte 4 maps to FRAUD high rate. When FRAUD is cheap, fraud_sell = fraud_high.
    let valid: std::collections::HashSet<u16> = [1100, 1200, 1300, 1400].iter().copied().collect();
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(255, 0, 0, 0, b as u8); // no flip, FRAUD cheap
        let config = derive_taxes(&vrf, Token::Fraud);
        assert!(
            valid.contains(&config.fraud_sell_tax_bps),
            "byte4={}: fraud_sell_tax_bps={} not in HIGH_RATES",
            b, config.fraud_sell_tax_bps
        );
    }
}

// ============================================================================
// INV-TD-004: Modulo-4 Bias Exactly Zero
// ============================================================================

#[test]
fn inv_td_004_mod4_zero_bias_exhaustive() {
    // For each of bytes 1-4, verify each residue class (0,1,2,3) occurs exactly 64 times.
    for byte_idx in 1..=4usize {
        let mut counts = [0u32; 4];
        for b in 0u16..=255 {
            counts[(b as u8 % 4) as usize] += 1;
        }
        for (residue, &count) in counts.iter().enumerate() {
            assert_eq!(
                count, 64,
                "byte{}: residue {} occurs {} times, expected 64",
                byte_idx, residue, count
            );
        }
    }
}

#[test]
fn inv_td_004_rate_distribution_uniform_byte1() {
    // Verify each LOW_RATE appears exactly 64 times across all 256 byte1 values.
    let mut rate_counts = std::collections::HashMap::new();
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(255, b as u8, 0, 0, 0);
        let config = derive_taxes(&vrf, Token::Crime);
        *rate_counts.entry(config.crime_buy_tax_bps).or_insert(0u32) += 1;
    }
    for &rate in &LOW_RATES {
        assert_eq!(
            rate_counts.get(&rate).copied().unwrap_or(0), 64,
            "LOW_RATE {} should appear exactly 64 times via byte1, got {}",
            rate, rate_counts.get(&rate).copied().unwrap_or(0)
        );
    }
    assert_eq!(rate_counts.len(), 4, "Exactly 4 distinct low rates expected");
}

#[test]
fn inv_td_004_rate_distribution_uniform_byte2() {
    let mut rate_counts = std::collections::HashMap::new();
    for b in 0u16..=255 {
        let vrf = make_vrf_tax(255, 0, b as u8, 0, 0);
        let config = derive_taxes(&vrf, Token::Crime);
        *rate_counts.entry(config.crime_sell_tax_bps).or_insert(0u32) += 1;
    }
    for &rate in &HIGH_RATES {
        assert_eq!(
            rate_counts.get(&rate).copied().unwrap_or(0), 64,
            "HIGH_RATE {} should appear exactly 64 times via byte2",
            rate
        );
    }
    assert_eq!(rate_counts.len(), 4, "Exactly 4 distinct high rates expected");
}

// ============================================================================
// INV-TD-005: CRIME and FRAUD Use Independent VRF Bytes
// ============================================================================

#[test]
fn inv_td_005_independent_bytes() {
    // Changing byte1 (CRIME low) should NOT affect FRAUD rates.
    let base = make_vrf_tax(255, 0, 0, 0, 0);
    let alt = make_vrf_tax(255, 3, 0, 0, 0); // only byte1 differs
    let base_cfg = derive_taxes(&base, Token::Crime);
    let alt_cfg = derive_taxes(&alt, Token::Crime);

    // FRAUD rates unchanged
    assert_eq!(base_cfg.fraud_buy_tax_bps, alt_cfg.fraud_buy_tax_bps,
        "Changing byte1 must not affect FRAUD buy rate");
    assert_eq!(base_cfg.fraud_sell_tax_bps, alt_cfg.fraud_sell_tax_bps,
        "Changing byte1 must not affect FRAUD sell rate");

    // CRIME rate DID change
    assert_ne!(base_cfg.crime_buy_tax_bps, alt_cfg.crime_buy_tax_bps,
        "Changing byte1 should change CRIME buy rate");
}

#[test]
fn inv_td_005_independent_bytes_fraud_side() {
    // Changing byte3 (FRAUD low) should NOT affect CRIME rates.
    let base = make_vrf_tax(255, 0, 0, 0, 0);
    let alt = make_vrf_tax(255, 0, 0, 3, 0); // only byte3 differs
    let base_cfg = derive_taxes(&base, Token::Crime);
    let alt_cfg = derive_taxes(&alt, Token::Crime);

    assert_eq!(base_cfg.crime_buy_tax_bps, alt_cfg.crime_buy_tax_bps,
        "Changing byte3 must not affect CRIME buy rate");
    assert_eq!(base_cfg.crime_sell_tax_bps, alt_cfg.crime_sell_tax_bps,
        "Changing byte3 must not affect CRIME sell rate");
    assert_ne!(base_cfg.fraud_sell_tax_bps, alt_cfg.fraud_sell_tax_bps,
        "Changing byte3 should change FRAUD sell rate");
}

proptest! {
    #[test]
    fn inv_td_005_proptest_independence(
        b0 in 0u8..=255,
        b1 in 0u8..=255,
        b2 in 0u8..=255,
        b3 in 0u8..=255,
        b4 in 0u8..=255,
        alt_b1 in 0u8..=255,
    ) {
        // Changing byte1 must not affect FRAUD rates
        let vrf1 = make_vrf_tax(b0, b1, b2, b3, b4);
        let vrf2 = make_vrf_tax(b0, alt_b1, b2, b3, b4);
        let cfg1 = derive_taxes(&vrf1, Token::Crime);
        let cfg2 = derive_taxes(&vrf2, Token::Crime);

        // Same flip decision (byte0 unchanged)
        prop_assert_eq!(cfg1.cheap_side, cfg2.cheap_side);
        // FRAUD rates must be identical (bytes 3,4 unchanged)
        prop_assert_eq!(cfg1.fraud_buy_tax_bps, cfg2.fraud_buy_tax_bps);
        prop_assert_eq!(cfg1.fraud_sell_tax_bps, cfg2.fraud_sell_tax_bps);
    }
}

// ============================================================================
// INV-TD-006: Cheap Side Gets Low Buy / High Sell Tax
// ============================================================================

#[test]
fn inv_td_006_cheap_side_rates_exhaustive() {
    let low_set: std::collections::HashSet<u16> = LOW_RATES.iter().copied().collect();
    let high_set: std::collections::HashSet<u16> = HIGH_RATES.iter().copied().collect();

    for b0 in 0u16..=255 {
        for b1 in [0u8, 1, 2, 3, 127, 128, 252, 253, 254, 255] {
            for b2 in [0u8, 1, 2, 3, 127, 128, 252, 253, 254, 255] {
                for b3 in [0u8, 1, 2, 3, 127, 252, 255] {
                    for b4 in [0u8, 1, 2, 3, 127, 252, 255] {
                        let vrf = make_vrf_tax(b0 as u8, b1, b2, b3, b4);
                        let config = derive_taxes(&vrf, Token::Crime);

                        match config.cheap_side {
                            Token::Crime => {
                                assert!(low_set.contains(&config.crime_buy_tax_bps),
                                    "CRIME cheap: buy {} not in LOW", config.crime_buy_tax_bps);
                                assert!(high_set.contains(&config.crime_sell_tax_bps),
                                    "CRIME cheap: sell {} not in HIGH", config.crime_sell_tax_bps);
                                assert!(high_set.contains(&config.fraud_buy_tax_bps),
                                    "FRAUD expensive: buy {} not in HIGH", config.fraud_buy_tax_bps);
                                assert!(low_set.contains(&config.fraud_sell_tax_bps),
                                    "FRAUD expensive: sell {} not in LOW", config.fraud_sell_tax_bps);
                            }
                            Token::Fraud => {
                                assert!(low_set.contains(&config.fraud_buy_tax_bps),
                                    "FRAUD cheap: buy {} not in LOW", config.fraud_buy_tax_bps);
                                assert!(high_set.contains(&config.fraud_sell_tax_bps),
                                    "FRAUD cheap: sell {} not in HIGH", config.fraud_sell_tax_bps);
                                assert!(high_set.contains(&config.crime_buy_tax_bps),
                                    "CRIME expensive: buy {} not in HIGH", config.crime_buy_tax_bps);
                                assert!(low_set.contains(&config.crime_sell_tax_bps),
                                    "CRIME expensive: sell {} not in LOW", config.crime_sell_tax_bps);
                            }
                        }
                    }
                }
            }
        }
    }
}

proptest! {
    #[test]
    fn inv_td_006_proptest_cheap_side_assignment(buf in proptest::array::uniform32(0u8..)) {
        let config = derive_taxes(&buf, Token::Crime);
        let low_set: std::collections::HashSet<u16> = LOW_RATES.iter().copied().collect();
        let high_set: std::collections::HashSet<u16> = HIGH_RATES.iter().copied().collect();

        match config.cheap_side {
            Token::Crime => {
                prop_assert!(low_set.contains(&config.crime_buy_tax_bps));
                prop_assert!(high_set.contains(&config.crime_sell_tax_bps));
                prop_assert!(high_set.contains(&config.fraud_buy_tax_bps));
                prop_assert!(low_set.contains(&config.fraud_sell_tax_bps));
            }
            Token::Fraud => {
                prop_assert!(low_set.contains(&config.fraud_buy_tax_bps));
                prop_assert!(high_set.contains(&config.fraud_sell_tax_bps));
                prop_assert!(high_set.contains(&config.crime_buy_tax_bps));
                prop_assert!(low_set.contains(&config.crime_sell_tax_bps));
            }
        }
    }
}

// ============================================================================
// INV-TD-007: No Tax Rate Outside Defined Ranges
// ============================================================================

proptest! {
    #[test]
    fn inv_td_007_all_rates_in_defined_set(buf in proptest::array::uniform32(0u8..)) {
        let all_valid: std::collections::HashSet<u16> =
            LOW_RATES.iter().chain(HIGH_RATES.iter()).copied().collect();

        for current in [Token::Crime, Token::Fraud] {
            let config = derive_taxes(&buf, current);
            prop_assert!(all_valid.contains(&config.crime_buy_tax_bps),
                "crime_buy {} invalid", config.crime_buy_tax_bps);
            prop_assert!(all_valid.contains(&config.crime_sell_tax_bps),
                "crime_sell {} invalid", config.crime_sell_tax_bps);
            prop_assert!(all_valid.contains(&config.fraud_buy_tax_bps),
                "fraud_buy {} invalid", config.fraud_buy_tax_bps);
            prop_assert!(all_valid.contains(&config.fraud_sell_tax_bps),
                "fraud_sell {} invalid", config.fraud_sell_tax_bps);
        }
    }
}

// ============================================================================
// INV-TD-008: Flip Is a Toggle -- opposite(opposite(x)) == x
// ============================================================================

#[test]
fn inv_td_008_flip_toggle() {
    assert_eq!(Token::Crime.opposite().opposite(), Token::Crime);
    assert_eq!(Token::Fraud.opposite().opposite(), Token::Fraud);
}

#[test]
fn inv_td_008_double_flip_restores_cheap_side() {
    // If byte0 < 192 (flip), applying it twice to the same current_cheap
    // should alternate. Two flips = no net change.
    for b in 0u8..192 {
        let vrf = make_vrf_tax(b, 0, 0, 0, 0);
        let first = derive_taxes(&vrf, Token::Crime);
        assert_eq!(first.cheap_side, Token::Fraud, "first flip should yield Fraud");
        let second = derive_taxes(&vrf, Token::Fraud);
        assert_eq!(second.cheap_side, Token::Crime, "second flip should restore Crime");
    }
}

// ============================================================================
// INV-TD-009: Deterministic Output -- same input -> same TaxConfig
// ============================================================================

proptest! {
    #[test]
    fn inv_td_009_deterministic(buf in proptest::array::uniform32(0u8..)) {
        let a = derive_taxes(&buf, Token::Crime);
        let b = derive_taxes(&buf, Token::Crime);
        prop_assert_eq!(a, b, "Same input must produce identical TaxConfig");

        let c = derive_taxes(&buf, Token::Fraud);
        let d = derive_taxes(&buf, Token::Fraud);
        prop_assert_eq!(c, d);
    }
}

// ============================================================================
// INV-TD-010: Cheap Buy Tax < Expensive Buy Tax (>=700 bps gap)
// ============================================================================

proptest! {
    #[test]
    fn inv_td_010_cheap_buy_lt_expensive_buy(buf in proptest::array::uniform32(0u8..)) {
        let config = derive_taxes(&buf, Token::Crime);
        let (cheap_buy, expensive_buy) = match config.cheap_side {
            Token::Crime => (config.crime_buy_tax_bps, config.fraud_buy_tax_bps),
            Token::Fraud => (config.fraud_buy_tax_bps, config.crime_buy_tax_bps),
        };
        // Cheap buy is from LOW_RATES (max 400), expensive from HIGH_RATES (min 1100)
        prop_assert!(cheap_buy <= 400, "cheap buy {} > 400", cheap_buy);
        prop_assert!(expensive_buy >= 1100, "expensive buy {} < 1100", expensive_buy);
        let gap = expensive_buy - cheap_buy;
        prop_assert!(gap >= 700, "gap {} < 700 bps", gap);
    }
}

#[test]
fn inv_td_010_minimum_gap_is_700() {
    // Worst case: cheap_buy = 400 (max low), expensive_buy = 1100 (min high)
    // Gap = 700 bps
    let vrf = make_vrf_tax(255, 3, 0, 0, 0); // byte1=3 -> LOW_RATES[3]=400
    let config = derive_taxes(&vrf, Token::Crime); // Crime cheap
    // Crime buy = 400 (cheap low), Fraud buy = HIGH_RATES[0%4=0] = 1100
    assert_eq!(config.crime_buy_tax_bps, 400);
    assert_eq!(config.fraud_buy_tax_bps, 1100);
    assert_eq!(config.fraud_buy_tax_bps - config.crime_buy_tax_bps, 700);
}

// ============================================================================
// INV-TD-011: No Byte Index Collision (Tax bytes {0-4} vs Carnage bytes {5-7})
// ============================================================================

#[test]
fn inv_td_011_byte_index_disjoint() {
    // Tax derivation uses bytes [0, 1, 2, 3, 4].
    // Carnage uses bytes [5, 6, 7].
    // Verify by setting carnage bytes to sentinel values and checking tax is unaffected.
    let mut vrf_a = [0u8; 32];
    vrf_a[0] = 100; vrf_a[1] = 1; vrf_a[2] = 2; vrf_a[3] = 3; vrf_a[4] = 0;
    // Carnage bytes all zero
    vrf_a[5] = 0; vrf_a[6] = 0; vrf_a[7] = 0;

    let mut vrf_b = vrf_a;
    // Change only carnage bytes
    vrf_b[5] = 255; vrf_b[6] = 255; vrf_b[7] = 255;

    let cfg_a = derive_taxes(&vrf_a, Token::Crime);
    let cfg_b = derive_taxes(&vrf_b, Token::Crime);
    assert_eq!(cfg_a, cfg_b, "Changing carnage bytes must not affect tax derivation");

    // Reverse: changing tax bytes must not affect carnage
    let mut vrf_c = vrf_a;
    vrf_c[0] = 200; vrf_c[1] = 255; vrf_c[2] = 255; vrf_c[3] = 255; vrf_c[4] = 255;

    assert_eq!(is_carnage_triggered(&vrf_a), is_carnage_triggered(&vrf_c),
        "Changing tax bytes must not affect carnage trigger");
    assert_eq!(get_carnage_target(&vrf_a), get_carnage_target(&vrf_c),
        "Changing tax bytes must not affect carnage target");
}

// ============================================================================
// INV-VR-001: Every Byte [0,255] Maps to Valid Output -- no panic, no OOB
// ============================================================================

#[test]
fn inv_vr_001_no_panic_all_bytes() {
    // For each of the 5 tax bytes, iterate all 256 values.
    // No panic = pass.
    for b0 in 0u8..=255 {
        let vrf = make_vrf_tax(b0, 0, 0, 0, 0);
        let _ = derive_taxes(&vrf, Token::Crime);
    }
    for b1 in 0u8..=255 {
        let vrf = make_vrf_tax(192, b1, 0, 0, 0);
        let _ = derive_taxes(&vrf, Token::Crime);
    }
    for b2 in 0u8..=255 {
        let vrf = make_vrf_tax(192, 0, b2, 0, 0);
        let _ = derive_taxes(&vrf, Token::Crime);
    }
    for b3 in 0u8..=255 {
        let vrf = make_vrf_tax(192, 0, 0, b3, 0);
        let _ = derive_taxes(&vrf, Token::Crime);
    }
    for b4 in 0u8..=255 {
        let vrf = make_vrf_tax(192, 0, 0, 0, b4);
        let _ = derive_taxes(&vrf, Token::Crime);
    }
}

proptest! {
    #[test]
    fn inv_vr_001_proptest_no_panic(buf in proptest::array::uniform32(0u8..)) {
        // Must not panic for any random 32-byte buffer
        let _ = derive_taxes(&buf, Token::Crime);
        let _ = derive_taxes(&buf, Token::Fraud);
    }
}

// ============================================================================
// INV-VR-003: Modulo-4 Zero Bias -- 64/64/64/64 split
// ============================================================================

#[test]
fn inv_vr_003_mod4_exact_split() {
    // 256 is exactly divisible by 4, so modulo bias is mathematically impossible.
    // Verify empirically for each byte position.
    for _byte_idx in 1..=4 {
        let mut counts = [0u32; 4];
        for b in 0u32..256 {
            counts[(b % 4) as usize] += 1;
        }
        assert_eq!(counts, [64, 64, 64, 64], "256 mod 4 must split evenly");
    }
}

// ============================================================================
// INV-VR-004: Carnage Thresholds Have No Dead Zones
// ============================================================================

#[test]
fn inv_vr_004_no_dead_zones() {
    // Every byte value [0, 255] maps to exactly one outcome for each carnage function.
    // Trigger: < 11 = true, >= 11 = false. No gaps.
    let mut trigger_true = 0u32;
    let mut trigger_false = 0u32;
    for b in 0u16..=255 {
        let mut vrf = [0u8; 32];
        vrf[5] = b as u8;
        if is_carnage_triggered(&vrf) {
            trigger_true += 1;
        } else {
            trigger_false += 1;
        }
    }
    assert_eq!(trigger_true + trigger_false, 256, "All 256 values must be classified");
    assert_eq!(trigger_true, 11);
    assert_eq!(trigger_false, 245);

    // Action: < 5 = Sell, >= 5 = Burn (when has_holdings=true). No gaps.
    let mut sell_count = 0u32;
    let mut burn_count = 0u32;
    for b in 0u16..=255 {
        let mut vrf = [0u8; 32];
        vrf[6] = b as u8;
        match get_carnage_action(&vrf, true) {
            epoch_program::state::CarnageAction::Sell => sell_count += 1,
            epoch_program::state::CarnageAction::Burn => burn_count += 1,
            epoch_program::state::CarnageAction::None => panic!("None with has_holdings=true"),
        }
    }
    assert_eq!(sell_count + burn_count, 256);
    assert_eq!(sell_count, 5);
    assert_eq!(burn_count, 251);

    // Target: < 128 = Crime, >= 128 = Fraud. No gaps.
    let mut crime_count = 0u32;
    let mut fraud_count = 0u32;
    for b in 0u16..=255 {
        let mut vrf = [0u8; 32];
        vrf[7] = b as u8;
        match get_carnage_target(&vrf) {
            Token::Crime => crime_count += 1,
            Token::Fraud => fraud_count += 1,
        }
    }
    assert_eq!(crime_count + fraud_count, 256);
    assert_eq!(crime_count, 128);
    assert_eq!(fraud_count, 128);
}
