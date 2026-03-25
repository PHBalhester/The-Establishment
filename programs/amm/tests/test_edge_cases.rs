/// Edge case tests for AMM program.
///
/// Covers gaps from docs/edge-case-audit.md:
/// - AMM-01 (MEDIUM): Zero effective input from dust amount
/// - AMM-02 (MEDIUM): Zero swap output from tiny effective input vs large reserves

use amm::helpers::math::{
    calculate_effective_input, calculate_swap_output, check_effective_input_nonzero,
    check_swap_output_nonzero,
};

// ===========================================================================
// AMM-01: Zero effective input from dust amount
//
// When amount_in=1 with 100bps fee, effective_input = 1*9900/10000 = 0.
// The check_effective_input_nonzero function should detect this and
// the instruction should return ZeroEffectiveInput.
// ===========================================================================

#[test]
fn amm_01_dust_amount_produces_zero_effective_input() {
    // 1 lamport with 100bps (1%) fee -> effective = 1 * 9900 / 10000 = 0
    let effective = calculate_effective_input(1, 100).unwrap();
    assert_eq!(effective, 0, "1 lamport with 100bps fee should produce 0 effective input");

    // The nonzero check should flag this as invalid
    let is_valid = check_effective_input_nonzero(1, effective);
    assert!(
        !is_valid,
        "Nonzero check should return false when amount_in=1 but effective=0"
    );
}

#[test]
fn amm_01_dust_boundary_at_fee_threshold() {
    // Find the minimum amount where effective_input > 0 with 100bps fee
    // amount * 9900 / 10000 >= 1 -> amount >= ceil(10000/9900) = 2
    let effective_1 = calculate_effective_input(1, 100).unwrap();
    let effective_2 = calculate_effective_input(2, 100).unwrap();

    assert_eq!(effective_1, 0, "1 lamport should produce 0 effective");
    assert!(effective_2 > 0, "2 lamports should produce >0 effective");

    // Verify nonzero check passes at boundary
    assert!(check_effective_input_nonzero(2, effective_2));
}

#[test]
fn amm_01_dust_with_high_fee() {
    // With 9999bps fee (99.99%), even large amounts produce 0
    // 10000 * 1 / 10000 = 1 -> minimum viable is 10000 lamports
    let effective = calculate_effective_input(9999, 9999).unwrap();
    assert_eq!(effective, 0, "9999 lamports with 9999bps should produce 0");
    assert!(!check_effective_input_nonzero(9999, effective));

    let effective = calculate_effective_input(10000, 9999).unwrap();
    assert_eq!(effective, 1, "10000 lamports with 9999bps should produce 1");
    assert!(check_effective_input_nonzero(10000, effective));
}

// ===========================================================================
// AMM-02: Zero swap output from tiny effective input vs large reserves
//
// With very large reserves and tiny effective input, the constant-product
// formula produces 0 output: reserve_out * effective / (reserve_in + effective)
// rounds down to 0.
// ===========================================================================

#[test]
fn amm_02_tiny_effective_vs_huge_reserves() {
    // reserve_in = u64::MAX, reserve_out = u64::MAX, effective = 1
    // output = u64::MAX * 1 / (u64::MAX + 1) = u64::MAX / 2^64 = 0 (truncated)
    let output = calculate_swap_output(u64::MAX, u64::MAX, 1).unwrap();
    assert_eq!(output, 0, "Tiny effective input vs max reserves should produce 0 output");

    // Nonzero check should flag this
    assert!(!check_swap_output_nonzero(1, output));
}

#[test]
fn amm_02_boundary_output_nonzero() {
    // Find the minimum effective input that produces output > 0
    // With reserves 1M/1M: output = 1M * eff / (1M + eff) >= 1
    // -> 1M * eff >= 1M + eff -> eff >= 1M/(1M-1) ~= 2
    let output_1 = calculate_swap_output(1_000_000, 1_000_000, 1).unwrap();
    let output_2 = calculate_swap_output(1_000_000, 1_000_000, 2).unwrap();

    assert_eq!(output_1, 0, "effective=1 with 1M/1M reserves should produce 0");
    assert!(output_2 > 0, "effective=2 with 1M/1M reserves should produce >0");

    assert!(!check_swap_output_nonzero(1, output_1));
    assert!(check_swap_output_nonzero(2, output_2));
}

#[test]
fn amm_02_full_pipeline_dust_swap_rejected() {
    // End-to-end: 1 lamport input with 100bps fee through swap math
    // Step 1: Fee -> effective = 0
    let effective = calculate_effective_input(1, 100).unwrap();
    assert_eq!(effective, 0);

    // Step 2: Zero effective input check catches it
    assert!(!check_effective_input_nonzero(1, effective));

    // If we somehow bypassed step 2, output would also be 0
    let output = calculate_swap_output(1_000_000, 1_000_000, effective).unwrap();
    assert_eq!(output, 0);
    // And zero output check would catch it (but effective is also 0 so this passes -- correct)
    assert!(check_swap_output_nonzero(effective, output));
}
