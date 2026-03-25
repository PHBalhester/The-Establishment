/// Edge case tests for Transfer Hook program.
///
/// Covers gaps from docs/edge-case-audit.md:
/// - HOOK-01 (HIGH): is_whitelisted function logic with actual PDA derivation
/// - HOOK-02 (MEDIUM): WhitelistEntry PDA derivation verification with wrong seed
///
/// These tests exercise the whitelist PDA derivation logic directly
/// rather than relying on assert!(true) documentation tests.

use anchor_lang::prelude::Pubkey;

/// Transfer Hook program ID
fn program_id() -> Pubkey {
    "CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd"
        .parse()
        .unwrap()
}

const WHITELIST_SEED: &[u8] = b"whitelist";

/// Replicate the is_whitelisted PDA derivation check from transfer_hook.rs.
///
/// This is the critical logic: verifies that a given account key matches
/// the expected PDA derived from [WHITELIST_SEED, token_account].
fn check_whitelist_pda(whitelist_pda_key: &Pubkey, token_account: &Pubkey) -> bool {
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account.as_ref()],
        &program_id(),
    );
    *whitelist_pda_key == expected_pda
}

// ===========================================================================
// HOOK-01: is_whitelisted function logic with actual PDA derivation
//
// The whitelist check verifies PDA derivation, not just existence.
// This prevents attackers from passing fake accounts with data.
// ===========================================================================

#[test]
fn hook_01_correct_pda_passes_derivation_check() {
    let token_account = Pubkey::new_unique();
    let (correct_pda, _bump) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account.as_ref()],
        &program_id(),
    );

    assert!(
        check_whitelist_pda(&correct_pda, &token_account),
        "Correctly derived PDA should pass check"
    );
}

#[test]
fn hook_01_wrong_pda_fails_derivation_check() {
    let token_account = Pubkey::new_unique();
    let fake_pda = Pubkey::new_unique(); // Random key, not a valid PDA

    assert!(
        !check_whitelist_pda(&fake_pda, &token_account),
        "Random pubkey should fail PDA derivation check"
    );
}

#[test]
fn hook_01_pda_for_different_account_fails() {
    let token_account_a = Pubkey::new_unique();
    let token_account_b = Pubkey::new_unique();

    let (pda_for_a, _) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account_a.as_ref()],
        &program_id(),
    );

    // PDA derived for account A should NOT match when checked against account B
    assert!(
        !check_whitelist_pda(&pda_for_a, &token_account_b),
        "PDA for account A should not validate for account B"
    );
}

#[test]
fn hook_01_pda_derivation_is_deterministic() {
    let token_account = Pubkey::new_unique();

    let (pda_1, bump_1) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account.as_ref()],
        &program_id(),
    );
    let (pda_2, bump_2) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account.as_ref()],
        &program_id(),
    );

    assert_eq!(pda_1, pda_2, "PDA derivation must be deterministic");
    assert_eq!(bump_1, bump_2, "Bump must be deterministic");
}

#[test]
fn hook_01_default_pubkey_produces_valid_pda() {
    // Even the default (zero) pubkey should produce a valid PDA derivation
    let token_account = Pubkey::default();
    let (pda, _bump) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account.as_ref()],
        &program_id(),
    );

    assert_ne!(pda, Pubkey::default(), "PDA for default pubkey should not be default");
    assert!(check_whitelist_pda(&pda, &token_account));
}

// ===========================================================================
// HOOK-02: WhitelistEntry PDA derivation with wrong seed (spoofed PDA)
//
// An attacker might try to use a PDA derived from different seeds
// to bypass the whitelist check.
// ===========================================================================

#[test]
fn hook_02_wrong_seed_prefix_fails() {
    let token_account = Pubkey::new_unique();

    // Derive PDA with wrong seed prefix
    let (spoofed_pda, _) = Pubkey::find_program_address(
        &[b"wrong_seed", token_account.as_ref()],
        &program_id(),
    );

    assert!(
        !check_whitelist_pda(&spoofed_pda, &token_account),
        "PDA with wrong seed prefix should fail"
    );
}

#[test]
fn hook_02_wrong_program_id_fails() {
    let token_account = Pubkey::new_unique();
    let wrong_program = Pubkey::new_unique();

    // Derive PDA from a different program
    let (wrong_program_pda, _) = Pubkey::find_program_address(
        &[WHITELIST_SEED, token_account.as_ref()],
        &wrong_program,
    );

    // The check function uses the correct program_id internally
    assert!(
        !check_whitelist_pda(&wrong_program_pda, &token_account),
        "PDA from wrong program should fail"
    );
}

#[test]
fn hook_02_system_program_as_pda_fails() {
    let token_account = Pubkey::new_unique();
    let system_program = Pubkey::default(); // System program = all zeros

    assert!(
        !check_whitelist_pda(&system_program, &token_account),
        "System program pubkey should not be a valid whitelist PDA"
    );
}

#[test]
fn hook_02_self_referencing_fails() {
    // Token account tries to use itself as the whitelist PDA
    let token_account = Pubkey::new_unique();

    assert!(
        !check_whitelist_pda(&token_account, &token_account),
        "Token account should not be its own whitelist PDA"
    );
}
