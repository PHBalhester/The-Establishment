//! Tests for carnage_signer PDA derivation compatibility.
//!
//! These tests verify that the Tax Program's CARNAGE_SIGNER_SEED constant
//! and epoch_program_id() function will produce PDAs compatible with
//! Epoch Program's carnage_signer derivation.
//!
//! IMPORTANT: These tests use the placeholder epoch_program_id.
//! After Epoch Program deployment, update epoch_program_id() and re-run.

use anchor_lang::prelude::Pubkey;
use tax_program::constants::{epoch_program_id, get_carnage_signer_pda, CARNAGE_SIGNER_SEED};

/// Test that CARNAGE_SIGNER_SEED is the expected value.
/// This ensures compatibility with Epoch Program which uses the same seed.
#[test]
fn test_carnage_signer_seed_value() {
    assert_eq!(
        CARNAGE_SIGNER_SEED,
        b"carnage_signer",
        "CARNAGE_SIGNER_SEED must be b\"carnage_signer\" to match Epoch Program"
    );
}

/// Test that carnage_signer PDA can be derived deterministically.
/// The same seeds + program_id must always produce the same PDA.
#[test]
fn test_carnage_signer_pda_derivation() {
    let epoch_program = epoch_program_id();

    // Derive PDA using the helper function
    let (pda1, bump1) = get_carnage_signer_pda();

    // Derive again - should get identical result
    let (pda2, bump2) = Pubkey::find_program_address(&[CARNAGE_SIGNER_SEED], &epoch_program);

    assert_eq!(pda1, pda2, "PDA derivation must be deterministic");
    assert_eq!(bump1, bump2, "Bump derivation must be deterministic");

    // Verify the PDA is off-curve (valid PDA)
    assert!(
        !pda1.is_on_curve(),
        "Carnage signer PDA must be off-curve"
    );
}

/// Test that PDA changes when epoch_program_id changes.
/// This validates that seeds::program constraint is meaningful.
#[test]
fn test_pda_varies_with_program_id() {
    let epoch_program = epoch_program_id();

    // Derive with Tax Program's epoch_program_id
    let (pda_epoch, _) = Pubkey::find_program_address(&[CARNAGE_SIGNER_SEED], &epoch_program);

    // Derive with a different program ID (e.g., System Program)
    let (pda_system, _) =
        Pubkey::find_program_address(&[CARNAGE_SIGNER_SEED], &anchor_lang::system_program::ID);

    // PDAs must be different
    assert_ne!(
        pda_epoch, pda_system,
        "PDAs derived from different programs must differ"
    );
}

/// Test that PDA changes when seed changes.
/// This validates the seed is actually used in derivation.
#[test]
fn test_pda_varies_with_seed() {
    let epoch_program = epoch_program_id();

    // Derive with CARNAGE_SIGNER_SEED
    let (pda_carnage, _) = Pubkey::find_program_address(&[CARNAGE_SIGNER_SEED], &epoch_program);

    // Derive with different seed
    let (pda_other, _) = Pubkey::find_program_address(&[b"other_seed"], &epoch_program);

    // PDAs must be different
    assert_ne!(
        pda_carnage, pda_other,
        "PDAs derived from different seeds must differ"
    );
}
