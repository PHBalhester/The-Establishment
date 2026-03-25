use anchor_lang::prelude::*;

/// Global vault configuration PDA.
/// Seeds: ["vault_config"]
///
/// Minimal state — all conversion parameters are hardcoded constants.
/// No authority stored. No conversion rate stored.
/// Upgrade authority managed by Squads multisig on the program itself.
///
/// In localnet mode, mint addresses are stored in state (not hardcoded)
/// so integration tests with random mints can exercise the vault.
#[account]
pub struct VaultConfig {
    /// PDA bump seed for deterministic re-derivation.
    pub bump: u8,
    /// Localnet: CRIME mint address stored at init time.
    #[cfg(feature = "localnet")]
    pub crime_mint: Pubkey,
    /// Localnet: FRAUD mint address stored at init time.
    #[cfg(feature = "localnet")]
    pub fraud_mint: Pubkey,
    /// Localnet: PROFIT mint address stored at init time.
    #[cfg(feature = "localnet")]
    pub profit_mint: Pubkey,
}

impl VaultConfig {
    /// Account size including 8-byte Anchor discriminator.
    #[cfg(not(feature = "localnet"))]
    pub const LEN: usize = 8 + 1; // discriminator + bump

    /// Localnet: 8 (disc) + 1 (bump) + 32*3 (mints) = 105 bytes
    #[cfg(feature = "localnet")]
    pub const LEN: usize = 8 + 1 + 32 + 32 + 32;
}
