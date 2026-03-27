//! Dr Fraudsworth Conversion Vault
//!
//! Fixed-rate 100:1 token conversions between CRIME/FRAUD and PROFIT.
//! Leaf-node program: calls only Token-2022, receives no CPIs.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod helpers;
pub mod instructions;
pub mod state;

use instructions::*;

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Dr Fraudsworth's Finance Factory",
    project_url: "https://fraudsworth.fun",
    contacts: "email:drfraudsworth@gmail.com,twitter:@fraudsworth",
    policy: "https://fraudsworth.fun/docs/security/security-policy",
    preferred_languages: "en",
    auditors: "Internal audits: SOS, BOK, VulnHunter (v1.3)",
    expiry: "2027-03-20"
}

declare_id!("5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ");

#[program]
pub mod conversion_vault {
    use super::*;

    /// One-shot vault initialization. Creates VaultConfig PDA and 3 token accounts.
    /// Any signer can call — no authority stored.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Convert tokens at fixed 100:1 rate.
    /// Supports 4 paths: CRIME->PROFIT, FRAUD->PROFIT, PROFIT->CRIME, PROFIT->FRAUD.
    pub fn convert<'info>(
        ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
        amount_in: u64,
    ) -> Result<()> {
        instructions::convert::handler(ctx, amount_in)
    }

    /// Convert tokens at fixed 100:1 rate with on-chain balance reading and slippage protection.
    ///
    /// When `amount_in == 0` (convert-all mode), reads the user's on-chain token balance.
    /// The `minimum_output` parameter enforces slippage protection on the output amount.
    pub fn convert_v2<'info>(
        ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
        amount_in: u64,
        minimum_output: u64,
    ) -> Result<()> {
        instructions::convert_v2::handler(ctx, amount_in, minimum_output)
    }
}
