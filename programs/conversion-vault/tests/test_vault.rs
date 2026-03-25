use anchor_lang::prelude::Pubkey;
use conversion_vault::constants::{
    CONVERSION_RATE, VAULT_CONFIG_SEED, VAULT_CRIME_SEED, VAULT_FRAUD_SEED,
    VAULT_PROFIT_SEED,
};
use conversion_vault::instructions::compute_output_with_mints;
use conversion_vault::state::VaultConfig;

// Use distinct deterministic pubkeys so tests work without feature flags.
// The conversion math only cares that input != output and that the pair
// matches one of the known (crime, fraud, profit) triples.
fn test_crime() -> Pubkey {
    Pubkey::new_from_array([1u8; 32])
}
fn test_fraud() -> Pubkey {
    Pubkey::new_from_array([2u8; 32])
}
fn test_profit() -> Pubkey {
    Pubkey::new_from_array([3u8; 32])
}

fn compute(input: &Pubkey, output: &Pubkey, amount: u64) -> anchor_lang::Result<u64> {
    compute_output_with_mints(input, output, amount, &test_crime(), &test_fraud(), &test_profit())
}

// ---------------------------------------------------------------------------
// T1: CRIME -> PROFIT conversion
// ---------------------------------------------------------------------------

#[test]
fn test_crime_to_profit_conversion() {
    let crime = test_crime();
    let profit = test_profit();

    // 1000 CRIME (1000 * 10^6 raw) -> 10 PROFIT (10 * 10^6 raw)
    let input = 1_000_000_000u64; // 1000 tokens at 6 decimals
    let output = compute(&crime, &profit, input).unwrap();
    assert_eq!(output, 10_000_000u64); // 10 tokens at 6 decimals

    // 100 CRIME -> 1 PROFIT
    let input = 100_000_000u64;
    let output = compute(&crime, &profit, input).unwrap();
    assert_eq!(output, 1_000_000u64);
}

// ---------------------------------------------------------------------------
// T2: FRAUD -> PROFIT conversion
// ---------------------------------------------------------------------------

#[test]
fn test_fraud_to_profit_conversion() {
    let fraud = test_fraud();
    let profit = test_profit();

    // 500 FRAUD (500 * 10^6 raw) -> 5 PROFIT (5 * 10^6 raw)
    let input = 500_000_000u64;
    let output = compute(&fraud, &profit, input).unwrap();
    assert_eq!(output, 5_000_000u64);
}

// ---------------------------------------------------------------------------
// T3: PROFIT -> CRIME conversion
// ---------------------------------------------------------------------------

#[test]
fn test_profit_to_crime_conversion() {
    let crime = test_crime();
    let profit = test_profit();

    // 1 PROFIT (1 * 10^6 raw) -> 100 CRIME (100 * 10^6 raw)
    let input = 1_000_000u64;
    let output = compute(&profit, &crime, input).unwrap();
    assert_eq!(output, 100_000_000u64);
}

// ---------------------------------------------------------------------------
// T4: PROFIT -> FRAUD conversion
// ---------------------------------------------------------------------------

#[test]
fn test_profit_to_fraud_conversion() {
    let fraud = test_fraud();
    let profit = test_profit();

    // 1 PROFIT -> 100 FRAUD
    let input = 1_000_000u64;
    let output = compute(&profit, &fraud, input).unwrap();
    assert_eq!(output, 100_000_000u64);
}

// ---------------------------------------------------------------------------
// T5: Zero amount rejected
// ---------------------------------------------------------------------------

#[test]
fn test_zero_amount_rejected() {
    let crime = test_crime();
    let profit = test_profit();

    let result = compute(&crime, &profit, 0);
    assert!(result.is_err());
    // Check error code = VaultError::ZeroAmount (6000)
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6000"),
        "Expected ZeroAmount (6000), got: {}",
        err_str
    );
}

// ---------------------------------------------------------------------------
// T6: Dust amount rejected (99 raw CRIME -> 0 PROFIT)
// ---------------------------------------------------------------------------

#[test]
fn test_dust_amount_rejected() {
    let crime = test_crime();
    let profit = test_profit();

    // 99 raw units / 100 = 0 -> OutputTooSmall
    let result = compute(&crime, &profit, 99);
    assert!(result.is_err());
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6001"),
        "Expected OutputTooSmall (6001), got: {}",
        err_str
    );
}

// ---------------------------------------------------------------------------
// T7: Dust boundary accepted (100 raw CRIME -> 1 raw PROFIT)
// ---------------------------------------------------------------------------

#[test]
fn test_dust_boundary_accepted() {
    let crime = test_crime();
    let profit = test_profit();

    // 100 raw units / 100 = 1 -> succeeds
    let output = compute(&crime, &profit, 100).unwrap();
    assert_eq!(output, 1);
}

// ---------------------------------------------------------------------------
// T8: Wrong mint pair rejected (CRIME -> FRAUD)
// ---------------------------------------------------------------------------

#[test]
fn test_wrong_mint_pair_rejected() {
    let crime = test_crime();
    let fraud = test_fraud();

    // CRIME -> FRAUD is not a valid conversion pair
    let result = compute(&crime, &fraud, 1_000_000);
    assert!(result.is_err());
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6002"),
        "Expected InvalidMintPair (6002), got: {}",
        err_str
    );
}

// ---------------------------------------------------------------------------
// T9: Same mint rejected
// ---------------------------------------------------------------------------

#[test]
fn test_same_mint_rejected() {
    let crime = test_crime();

    let result = compute(&crime, &crime, 1_000_000);
    assert!(result.is_err());
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("6003"),
        "Expected SameMint (6003), got: {}",
        err_str
    );
}

// ---------------------------------------------------------------------------
// T10: Large amount no overflow
// ---------------------------------------------------------------------------

#[test]
fn test_large_amount_no_overflow() {
    let crime = test_crime();
    let profit = test_profit();

    // 20M tokens * 10^6 decimals = 20_000_000_000_000 raw
    // PROFIT -> CRIME: 20M * 10^6 * 100 = 2_000_000_000_000_000 (2e15 < u64 max 1.8e19)
    let max_profit_raw = 20_000_000_000_000u64;
    let output = compute(&profit, &crime, max_profit_raw).unwrap();
    assert_eq!(output, max_profit_raw * CONVERSION_RATE);

    // CRIME -> PROFIT: 2_000_000_000_000_000 / 100 = 20_000_000_000_000
    let max_crime_raw = 2_000_000_000_000_000u64;
    let output = compute(&crime, &profit, max_crime_raw).unwrap();
    assert_eq!(output, max_crime_raw / CONVERSION_RATE);
}

// ---------------------------------------------------------------------------
// T11: PDA derivation deterministic
// ---------------------------------------------------------------------------

#[test]
fn test_pda_derivation_deterministic() {
    let program_id = conversion_vault::ID;

    // VaultConfig PDA
    let (config_pda_1, bump_1) =
        Pubkey::find_program_address(&[VAULT_CONFIG_SEED], &program_id);
    let (config_pda_2, bump_2) =
        Pubkey::find_program_address(&[VAULT_CONFIG_SEED], &program_id);
    assert_eq!(config_pda_1, config_pda_2);
    assert_eq!(bump_1, bump_2);

    // Vault token account PDAs (seeded with vault_config key)
    let (crime_pda_1, _) = Pubkey::find_program_address(
        &[VAULT_CRIME_SEED, config_pda_1.as_ref()],
        &program_id,
    );
    let (crime_pda_2, _) = Pubkey::find_program_address(
        &[VAULT_CRIME_SEED, config_pda_1.as_ref()],
        &program_id,
    );
    assert_eq!(crime_pda_1, crime_pda_2);

    let (fraud_pda_1, _) = Pubkey::find_program_address(
        &[VAULT_FRAUD_SEED, config_pda_1.as_ref()],
        &program_id,
    );
    let (fraud_pda_2, _) = Pubkey::find_program_address(
        &[VAULT_FRAUD_SEED, config_pda_1.as_ref()],
        &program_id,
    );
    assert_eq!(fraud_pda_1, fraud_pda_2);

    let (profit_pda_1, _) = Pubkey::find_program_address(
        &[VAULT_PROFIT_SEED, config_pda_1.as_ref()],
        &program_id,
    );
    let (profit_pda_2, _) = Pubkey::find_program_address(
        &[VAULT_PROFIT_SEED, config_pda_1.as_ref()],
        &program_id,
    );
    assert_eq!(profit_pda_1, profit_pda_2);

    // All 4 PDAs are distinct
    assert_ne!(config_pda_1, crime_pda_1);
    assert_ne!(config_pda_1, fraud_pda_1);
    assert_ne!(config_pda_1, profit_pda_1);
    assert_ne!(crime_pda_1, fraud_pda_1);
    assert_ne!(crime_pda_1, profit_pda_1);
    assert_ne!(fraud_pda_1, profit_pda_1);
}

// ---------------------------------------------------------------------------
// Bonus: VaultConfig::LEN is correct
// ---------------------------------------------------------------------------

#[test]
fn test_vault_config_len() {
    // 8 (discriminator) + 1 (bump) = 9
    assert_eq!(VaultConfig::LEN, 9);
}

// ---------------------------------------------------------------------------
// Bonus: Conversion rate constant
// ---------------------------------------------------------------------------

#[test]
fn test_conversion_rate_constant() {
    assert_eq!(CONVERSION_RATE, 100);
}
