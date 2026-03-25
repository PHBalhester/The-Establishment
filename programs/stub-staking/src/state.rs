//! State accounts for Stub Staking Program.
//!
//! This module defines the StubStakePool account which tracks epoch finalization
//! for testing Epoch Program's CPI into a staking program.

use anchor_lang::prelude::*;

/// Stub stake pool account.
///
/// Single PDA: seeds = ["stake_pool"]
///
/// This is a minimal staking pool implementation for testing.
/// It tracks how many times Epoch Program has called update_cumulative,
/// and prevents double-finalization for the same epoch.
///
/// **Size calculation:**
/// - Discriminator: 8 bytes (Anchor adds automatically)
/// - cumulative_epochs: 8 bytes (u64)
/// - last_epoch: 8 bytes (u64)
/// - total_yield_distributed: 8 bytes (u64)
/// - initialized: 1 byte (bool)
/// - bump: 1 byte (u8)
/// Total data: 26 bytes
/// Total with discriminator: 8 + 26 = 34 bytes
#[account]
pub struct StubStakePool {
    /// Count of epoch finalize calls received.
    /// Incremented each time update_cumulative succeeds.
    pub cumulative_epochs: u64, // 8 bytes

    /// Last epoch number that was finalized.
    /// Used to prevent double-finalization: new epoch must be > last_epoch.
    pub last_epoch: u64, // 8 bytes

    /// Placeholder for total yield distributed (for future integration).
    /// Incremented by 1 each call as a stub implementation.
    pub total_yield_distributed: u64, // 8 bytes

    /// Whether the stake pool has been initialized.
    /// Must be true before update_cumulative can be called.
    pub initialized: bool, // 1 byte

    /// PDA bump seed.
    pub bump: u8, // 1 byte
}

impl StubStakePool {
    /// Data size without discriminator.
    /// 8 + 8 + 8 + 1 + 1 = 26 bytes
    pub const DATA_LEN: usize = 8 + 8 + 8 + 1 + 1;

    /// Total account size including 8-byte discriminator.
    /// 8 (discriminator) + 26 (data) = 34 bytes
    pub const LEN: usize = 8 + Self::DATA_LEN;
}

// Static assertion that DATA_LEN equals expected 26 bytes
const _: () = assert!(StubStakePool::DATA_LEN == 26);

// Static assertion that LEN equals expected 34 bytes (8 discriminator + 26 data)
const _: () = assert!(StubStakePool::LEN == 34);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_stake_pool_data_len() {
        // Verify DATA_LEN matches expected 26 bytes
        // Field breakdown:
        // - cumulative_epochs: u64 = 8 bytes
        // - last_epoch: u64 = 8 bytes
        // - total_yield_distributed: u64 = 8 bytes
        // - initialized: bool = 1 byte
        // - bump: u8 = 1 byte
        // Total: 8 + 8 + 8 + 1 + 1 = 26 bytes
        assert_eq!(StubStakePool::DATA_LEN, 26);
    }

    #[test]
    fn test_stub_stake_pool_len() {
        // Verify LEN includes 8-byte Anchor discriminator
        // 8 (discriminator) + 26 (data) = 34 bytes
        assert_eq!(StubStakePool::LEN, 34);
        assert_eq!(StubStakePool::LEN, 8 + StubStakePool::DATA_LEN);
    }

    #[test]
    fn test_field_sizes_match_constants() {
        // Individual field size verification
        assert_eq!(std::mem::size_of::<u64>(), 8); // cumulative_epochs
        assert_eq!(std::mem::size_of::<u64>(), 8); // last_epoch
        assert_eq!(std::mem::size_of::<u64>(), 8); // total_yield_distributed
        assert_eq!(std::mem::size_of::<bool>(), 1); // initialized
        assert_eq!(std::mem::size_of::<u8>(), 1); // bump

        // Sum should equal DATA_LEN
        let expected_size = 8 + 8 + 8 + 1 + 1;
        assert_eq!(expected_size, StubStakePool::DATA_LEN);
    }
}
