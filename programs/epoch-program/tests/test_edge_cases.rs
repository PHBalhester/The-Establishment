/// Edge case tests for Epoch Program.
///
/// Covers gaps from docs/edge-case-audit.md:
/// - EPOCH-01 (HIGH): Epoch helper function edge cases (integration-level)
/// - EPOCH-02 (HIGH): current_epoch with extreme slot values (u64::MAX, overflow in u32 cast)
/// - EPOCH-03 (MEDIUM): epoch_start_slot with u32::MAX epoch (overflow in multiplication)
///
/// Note: Full instruction-level integration tests require Switchboard VRF account
/// mocking which is impractical in LiteSVM. These tests cover the critical math
/// edge cases that could cause incorrect epoch transitions or panics.

use epoch_program::instructions::trigger_epoch_transition::{current_epoch, epoch_start_slot};

// ===========================================================================
// EPOCH-01: Comprehensive epoch helper function edge cases
//
// The epoch calculation helpers are used in every epoch transition.
// Edge cases that could produce wrong epoch numbers would cause
// missed transitions or double-transitions.
// ===========================================================================

#[test]
fn epoch_01_current_epoch_at_genesis() {
    assert_eq!(current_epoch(0, 0), 0);
    assert_eq!(current_epoch(100, 100), 0);
    assert_eq!(current_epoch(1000, 1000), 0);
}

#[test]
fn epoch_01_current_epoch_boundary_precision() {
    // With genesis=0, devnet SLOTS_PER_EPOCH:
    // Check the exact boundary slots.
    // SLOTS_PER_EPOCH is either 750 (devnet) or 4500 (mainnet)
    // We test against the compiled value.
    let genesis = 0u64;

    // One slot before boundary should still be epoch 0
    let boundary_slot = epoch_start_slot(1, genesis);
    assert_eq!(current_epoch(boundary_slot - 1, genesis), 0);

    // Exactly at boundary should be epoch 1
    assert_eq!(current_epoch(boundary_slot, genesis), 1);

    // One slot after should still be epoch 1
    assert_eq!(current_epoch(boundary_slot + 1, genesis), 1);
}

#[test]
fn epoch_01_large_epoch_number() {
    // Simulate 1000 epochs from genesis=0
    let genesis = 0u64;
    let epoch_1000_start = epoch_start_slot(1000, genesis);
    assert_eq!(current_epoch(epoch_1000_start, genesis), 1000);
}

#[test]
fn epoch_01_epoch_start_slot_roundtrip() {
    // For any epoch N, current_epoch(epoch_start_slot(N, g), g) == N
    let genesis = 42_000u64;
    for epoch in 0..=500 {
        let start = epoch_start_slot(epoch, genesis);
        let computed = current_epoch(start, genesis);
        assert_eq!(
            computed, epoch,
            "Round-trip failed for epoch {}: start_slot={}, computed={}",
            epoch, start, computed
        );
    }
}

// ===========================================================================
// EPOCH-02: current_epoch with extreme slot values
//
// If slot is u64::MAX and genesis is 0, the division result must
// fit in u32 (cast via `as u32`). This is a truncation risk.
// ===========================================================================

#[test]
fn epoch_02_max_slot_with_zero_genesis() {
    // u64::MAX / SLOTS_PER_EPOCH will be very large, then cast to u32
    // This tests that the cast doesn't panic (Rust `as` never panics, it truncates)
    let result = current_epoch(u64::MAX, 0);
    // The result will be truncated to u32. Verify it doesn't panic.
    // u64::MAX / 4500 = ~4.1e15, cast to u32 = some truncated value
    // This is expected behavior -- epochs beyond u32::MAX wrap.
    let _ = result; // No panic = pass
}

#[test]
fn epoch_02_slot_before_genesis() {
    // slot < genesis uses saturating_sub -> 0 -> epoch 0
    assert_eq!(current_epoch(0, 1000), 0);
    assert_eq!(current_epoch(500, 1000), 0);
    assert_eq!(current_epoch(999, 1000), 0);
}

#[test]
fn epoch_02_genesis_at_max_slot() {
    // Genesis at u64::MAX, current slot also u64::MAX
    // Elapsed = 0 / SLOTS_PER_EPOCH = 0
    assert_eq!(current_epoch(u64::MAX, u64::MAX), 0);
}

#[test]
fn epoch_02_overflow_in_epoch_number() {
    // When elapsed slots is very large, the u32 cast truncates
    // This verifies the behavior is deterministic (not UB)
    let genesis = 0u64;
    let slots_for_max_epoch = (u32::MAX as u64) * epoch_start_slot(1, 0); // approximate
    // This will truncate, but should not panic
    let _ = current_epoch(slots_for_max_epoch, genesis);
}

// ===========================================================================
// EPOCH-03: epoch_start_slot with extreme epoch values
//
// epoch_start_slot(epoch, genesis) = genesis + (epoch as u64 * SLOTS_PER_EPOCH)
// With u32::MAX epoch, this can overflow u64 (u32::MAX * 4500 ~= 1.9e13, fine)
// but conceptually tests the boundary.
// ===========================================================================

#[test]
fn epoch_03_epoch_start_slot_max_epoch() {
    // u32::MAX * SLOTS_PER_EPOCH should not overflow u64
    // u32::MAX = 4,294,967,295
    // * 4500 = 19,327,352,827,500 which fits in u64 (max ~1.8e19)
    let result = epoch_start_slot(u32::MAX, 0);
    assert!(result > 0, "Start slot for max epoch should be > 0");
    assert!(result < u64::MAX, "Should not overflow to max u64");
}

#[test]
fn epoch_03_epoch_start_slot_with_large_genesis() {
    // Genesis near u64::MAX could overflow when adding epoch offset
    // genesis + (epoch * SLOTS_PER_EPOCH) could wrap
    let genesis = u64::MAX - 1000;
    // epoch_start_slot uses regular + which would panic in debug, wrap in release
    // With epoch=0, should just return genesis
    let result = epoch_start_slot(0, genesis);
    assert_eq!(result, genesis);
}

#[test]
fn epoch_03_epoch_start_slot_sequential_ordering() {
    // Each epoch's start slot must be strictly greater than the previous
    let genesis = 100u64;
    let mut prev_start = epoch_start_slot(0, genesis);
    for epoch in 1..=100 {
        let start = epoch_start_slot(epoch, genesis);
        assert!(
            start > prev_start,
            "Epoch {} start {} should be > epoch {} start {}",
            epoch, start, epoch - 1, prev_start
        );
        prev_start = start;
    }
}
