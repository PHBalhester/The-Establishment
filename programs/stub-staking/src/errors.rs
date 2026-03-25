//! Error codes for Stub Staking Program.
//!
//! These errors match the error conditions documented in the staking integration spec.

use anchor_lang::prelude::*;

#[error_code]
pub enum StubStakingError {
    /// Cumulative already updated for this epoch.
    /// Prevents double-finalization for the same epoch number.
    #[msg("Cumulative already updated for this epoch")]
    AlreadyUpdated,

    /// Arithmetic overflow in calculation.
    #[msg("Arithmetic overflow")]
    Overflow,

    /// Stake pool not initialized.
    /// The initialize instruction must be called before update_cumulative.
    #[msg("Stake pool not initialized")]
    NotInitialized,
}
