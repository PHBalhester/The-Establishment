use anchor_lang::prelude::*;
use std::str::FromStr;

/// Fixed conversion rate: 100 CRIME/FRAUD = 1 PROFIT.
/// Applied as integer division (CRIME->PROFIT) or multiplication (PROFIT->CRIME).
pub const CONVERSION_RATE: u64 = 100;

/// All project tokens use 6 decimals.
pub const TOKEN_DECIMALS: u8 = 6;

// ---------------------------------------------------------------------------
// PDA Seeds
// ---------------------------------------------------------------------------

pub const VAULT_CONFIG_SEED: &[u8] = b"vault_config";
pub const VAULT_CRIME_SEED: &[u8] = b"vault_crime";
pub const VAULT_FRAUD_SEED: &[u8] = b"vault_fraud";
pub const VAULT_PROFIT_SEED: &[u8] = b"vault_profit";

// ---------------------------------------------------------------------------
// Feature-Gated Mint Addresses
// ---------------------------------------------------------------------------

#[cfg(feature = "devnet")]
pub fn crime_mint() -> Pubkey {
    Pubkey::from_str("DtbDMB2dU8veALKTB12fi2HYBKMEVoKxYTbLp9VAvAxR").unwrap()
}

#[cfg(feature = "localnet")]
pub fn crime_mint() -> Pubkey {
    // Localnet: placeholder, runtime-generated addresses used in tests.
    Pubkey::default()
}

#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub fn crime_mint() -> Pubkey {
    Pubkey::from_str("DtbDMB2dU8veALKTB12fi2HYBKMEVoKxYTbLp9VAvAxR").unwrap()
}

#[cfg(feature = "devnet")]
pub fn fraud_mint() -> Pubkey {
    Pubkey::from_str("78EhS3i2wNM8RQMd8U3xX4eCYm5Xytr2aDcCUH4BzNtx").unwrap()
}

#[cfg(feature = "localnet")]
pub fn fraud_mint() -> Pubkey {
    Pubkey::default()
}

#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub fn fraud_mint() -> Pubkey {
    Pubkey::from_str("78EhS3i2wNM8RQMd8U3xX4eCYm5Xytr2aDcCUH4BzNtx").unwrap()
}

#[cfg(feature = "devnet")]
pub fn profit_mint() -> Pubkey {
    Pubkey::from_str("Eaipvk74Cw7CYUJNafsai9jxQ913V76MF9EfdQ3nNp2a").unwrap()
}

#[cfg(feature = "localnet")]
pub fn profit_mint() -> Pubkey {
    Pubkey::default()
}

#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub fn profit_mint() -> Pubkey {
    Pubkey::from_str("Eaipvk74Cw7CYUJNafsai9jxQ913V76MF9EfdQ3nNp2a").unwrap()
}
