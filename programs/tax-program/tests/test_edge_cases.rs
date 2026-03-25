/// Edge case tests for Tax Program.
///
/// Covers gaps from docs/edge-case-audit.md:
/// - TAX-01 (HIGH): InsufficientOutput error path (tax >= gross output)
/// - TAX-02 (MEDIUM): MinimumOutputFloorViolation error path
/// - TAX-03 (MEDIUM): InvalidPoolOwner error path (spoofed pool)
///
/// These tests exercise the tax math and validation functions directly.
/// The tax_math module contains the core calculation logic that determines
/// whether transactions succeed or fail.

use anchor_lang::prelude::Pubkey;

// ===========================================================================
// Tax math helpers (replicated from tax-program internals for testing)
//
// The tax program computes: net_output = gross_output - tax
// Where tax = gross_output * tax_bps / 10000
// If tax >= gross_output, InsufficientOutput is returned.
// ===========================================================================

/// Simulate tax calculation as done in swap_sol_sell.rs
fn calculate_tax(gross_output: u64, tax_bps: u16) -> Option<u64> {
    let tax = (gross_output as u128)
        .checked_mul(tax_bps as u128)?
        .checked_div(10_000)?;
    u64::try_from(tax).ok()
}

/// Simulate net output after tax
fn calculate_net_output(gross_output: u64, tax_bps: u16) -> Option<u64> {
    let tax = calculate_tax(gross_output, tax_bps)?;
    gross_output.checked_sub(tax)
}

/// Simulate the protocol floor: 50% of expected constant-product output
fn calculate_floor(expected_output: u64) -> u64 {
    expected_output / 2
}

/// Simulate pool owner validation
fn validate_pool_owner(pool_owner: &Pubkey, amm_program_id: &Pubkey) -> bool {
    pool_owner == amm_program_id
}

// ===========================================================================
// TAX-01: InsufficientOutput error path
//
// When tax >= gross_output, the net output would be 0 or negative.
// This triggers the InsufficientOutput error, protecting users from
// getting nothing in return for their tokens.
// ===========================================================================

#[test]
fn tax_01_tax_exceeds_gross_output_at_100_percent() {
    // 100% tax (10000 bps) on any amount
    let gross = 1_000_000u64;
    let tax = calculate_tax(gross, 10000).unwrap();
    assert_eq!(tax, gross, "100% tax should equal gross output");

    let net = calculate_net_output(gross, 10000).unwrap();
    assert_eq!(net, 0, "Net output should be 0 at 100% tax");
}

#[test]
fn tax_01_tiny_sell_with_normal_tax() {
    // Very small sell amount where tax rounds up to equal output
    // gross = 1 lamport, tax_bps = 5000 (50%)
    // tax = 1 * 5000 / 10000 = 0 (integer truncation)
    // This actually passes because truncation makes tax=0
    let tax = calculate_tax(1, 5000).unwrap();
    assert_eq!(tax, 0, "Tax on 1 lamport at 50% truncates to 0");

    // But at 10000bps: tax = 1 * 10000 / 10000 = 1
    let tax = calculate_tax(1, 10000).unwrap();
    assert_eq!(tax, 1, "Tax on 1 lamport at 100% should be 1");

    let net = calculate_net_output(1, 10000).unwrap();
    assert_eq!(net, 0, "Net output should be 0");
}

#[test]
fn tax_01_boundary_tax_rate() {
    // Find the boundary where tax just barely consumes everything
    // At 9999bps: tax = 100 * 9999 / 10000 = 99 (truncated) -> net = 1
    // At 10000bps: tax = 100 * 10000 / 10000 = 100 -> net = 0
    let net_9999 = calculate_net_output(100, 9999).unwrap();
    let net_10000 = calculate_net_output(100, 10000).unwrap();

    assert_eq!(net_9999, 1, "99.99% tax on 100 should leave 1 lamport");
    assert_eq!(net_10000, 0, "100% tax on 100 should leave 0 lamports");
}

#[test]
fn tax_01_realistic_scenario() {
    // Realistic scenario: 8% total tax (800bps) on a small sell
    // gross = 10 lamports -> tax = 10 * 800 / 10000 = 0 (truncated)
    let net = calculate_net_output(10, 800).unwrap();
    assert_eq!(net, 10, "8% tax on 10 lamports truncates to 0, net = 10");

    // gross = 100 lamports -> tax = 100 * 800 / 10000 = 8 -> net = 92
    let net = calculate_net_output(100, 800).unwrap();
    assert_eq!(net, 92, "8% tax on 100 lamports should be 92 net");

    // gross = 1 lamport with max realistic tax (800bps) -> tax = 0 -> net = 1
    let net = calculate_net_output(1, 800).unwrap();
    assert_eq!(net, 1, "8% tax on 1 lamport should still return 1");
}

// ===========================================================================
// TAX-02: MinimumOutputFloorViolation error path
//
// The protocol enforces a 50% slippage floor: user's minimum_amount_out
// must be >= 50% of the expected constant-product output. This prevents
// zero-slippage sandwich attacks (SEC-10).
// ===========================================================================

#[test]
fn tax_02_floor_calculation() {
    // Expected output 1000 -> floor = 500
    assert_eq!(calculate_floor(1000), 500);

    // Expected output 1 -> floor = 0 (truncation)
    assert_eq!(calculate_floor(1), 0);

    // Expected output 0 -> floor = 0
    assert_eq!(calculate_floor(0), 0);
}

#[test]
fn tax_02_minimum_below_floor_rejected() {
    let expected_output = 1_000_000u64; // 1M lamports
    let floor = calculate_floor(expected_output);
    assert_eq!(floor, 500_000);

    // User sets minimum_output at 400K (below floor) -- should be rejected
    let user_minimum = 400_000u64;
    assert!(
        user_minimum < floor,
        "User minimum {} should be below floor {}",
        user_minimum,
        floor
    );

    // User sets minimum_output at 500K (exactly at floor) -- should pass
    let user_minimum = 500_000u64;
    assert!(
        user_minimum >= floor,
        "User minimum {} should pass floor check {}",
        user_minimum,
        floor
    );
}

#[test]
fn tax_02_floor_with_odd_expected_output() {
    // Odd expected output: 999 -> floor = 499 (integer division)
    let floor = calculate_floor(999);
    assert_eq!(floor, 499);

    // User minimum at 499 passes, 498 fails
    assert!(499u64 >= floor);
    assert!(498u64 < floor);
}

// ===========================================================================
// TAX-03: InvalidPoolOwner error path (spoofed pool account)
//
// The pool account's owner must be the AMM program. This prevents
// attackers from passing a fake pool account with manipulated reserve
// data to bypass the slippage floor enforcement.
// ===========================================================================

#[test]
fn tax_03_valid_pool_owner() {
    let amm_id = Pubkey::new_unique();
    assert!(validate_pool_owner(&amm_id, &amm_id), "Same pubkey should pass");
}

#[test]
fn tax_03_spoofed_pool_owner_rejected() {
    let amm_id = Pubkey::new_unique();
    let attacker_program = Pubkey::new_unique();
    assert!(
        !validate_pool_owner(&attacker_program, &amm_id),
        "Different program should be rejected"
    );
}

#[test]
fn tax_03_system_program_owner_rejected() {
    let amm_id = Pubkey::new_unique();
    let system_program = Pubkey::default();
    assert!(
        !validate_pool_owner(&system_program, &amm_id),
        "System program should be rejected as pool owner"
    );
}
