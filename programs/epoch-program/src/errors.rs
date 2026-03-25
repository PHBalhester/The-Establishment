//! Epoch Program error codes.
//!
//! Source: Epoch_State_Machine_Spec.md Section 11

use anchor_lang::prelude::*;

#[error_code]
pub enum EpochError {
    /// Epoch state has already been initialized
    #[msg("Epoch state already initialized")]
    AlreadyInitialized,

    /// Epoch state has not been initialized
    #[msg("Epoch state not initialized")]
    NotInitialized,

    /// Invalid epoch state (corrupted or unexpected data)
    #[msg("Invalid epoch state")]
    InvalidEpochState,

    /// Epoch boundary has not been reached yet
    #[msg("Epoch boundary has not been reached yet")]
    EpochBoundaryNotReached,

    /// VRF request is already pending
    #[msg("VRF request is already pending")]
    VrfAlreadyPending,

    /// No VRF request is pending
    #[msg("No VRF request is pending")]
    NoVrfPending,

    /// Randomness account data could not be parsed
    #[msg("Randomness account data could not be parsed")]
    RandomnessParseError,

    /// Randomness account is stale (seed_slot too old)
    #[msg("Randomness account is stale (seed_slot too old)")]
    RandomnessExpired,

    /// Randomness has already been revealed (cannot commit)
    #[msg("Randomness has already been revealed (cannot commit)")]
    RandomnessAlreadyRevealed,

    /// Randomness account does not match committed account
    #[msg("Randomness account does not match committed account")]
    RandomnessAccountMismatch,

    /// Randomness has not been revealed by oracle yet
    #[msg("Randomness has not been revealed by oracle yet")]
    RandomnessNotRevealed,

    /// Insufficient randomness bytes (need 8)
    #[msg("Insufficient randomness bytes (need 8)")]
    InsufficientRandomness,

    /// VRF timeout has not elapsed (wait 300 slots)
    #[msg("VRF timeout has not elapsed (wait 300 slots)")]
    VrfTimeoutNotElapsed,

    /// No Carnage execution is pending
    #[msg("No Carnage execution is pending")]
    NoCarnagePending,

    /// Carnage execution deadline has expired
    #[msg("Carnage execution deadline has expired")]
    CarnageDeadlineExpired,

    /// Carnage deadline has not expired yet
    #[msg("Carnage deadline has not expired yet")]
    CarnageDeadlineNotExpired,

    /// Carnage lock window is still active (only atomic path allowed)
    #[msg("Carnage lock window active (atomic-only period)")]
    CarnageLockActive,

    /// Invalid Carnage target pool
    #[msg("Invalid Carnage target pool")]
    InvalidCarnageTargetPool,

    // =========================================================================
    // Carnage Fund-specific errors (Source: Carnage_Fund_Spec.md Section 15)
    // =========================================================================

    /// Carnage fund not initialized
    #[msg("Carnage fund not initialized")]
    CarnageNotInitialized,

    /// Carnage fund already initialized
    #[msg("Carnage fund already initialized")]
    CarnageAlreadyInitialized,

    /// Insufficient SOL in Carnage vault
    #[msg("Insufficient SOL in Carnage vault")]
    InsufficientCarnageSol,

    /// Carnage swap execution failed
    #[msg("Carnage swap execution failed")]
    CarnageSwapFailed,

    /// Carnage burn execution failed
    #[msg("Carnage burn execution failed")]
    CarnageBurnFailed,

    /// Arithmetic overflow
    #[msg("Arithmetic overflow")]
    Overflow,

    /// Insufficient SOL in treasury for bounty
    #[msg("Insufficient SOL in treasury for bounty")]
    InsufficientTreasuryBalance,

    /// Randomness account not owned by Switchboard program
    #[msg("Randomness account not owned by Switchboard program")]
    InvalidRandomnessOwner,

    /// Carnage WSOL account not owned by CarnageSigner PDA
    #[msg("Carnage WSOL account not owned by CarnageSigner PDA")]
    InvalidCarnageWsolOwner,

    /// Staking program address does not match expected program ID
    #[msg("Staking program address mismatch")]
    InvalidStakingProgram,

    /// Invalid mint account (doesn't match expected vault mint)
    #[msg("Invalid mint account")]
    InvalidMint,

    /// Carnage swap received too few tokens (slippage exceeded)
    #[msg("Carnage swap slippage exceeded (below minimum output floor)")]
    CarnageSlippageExceeded,

    /// Tax program address does not match expected program ID
    #[msg("Tax program address mismatch")]
    InvalidTaxProgram,

    /// AMM program address does not match expected program ID
    #[msg("AMM program address mismatch")]
    InvalidAmmProgram,

    /// Invalid cheap_side value stored in EpochState
    #[msg("Invalid cheap_side value -- expected 0 (CRIME) or 1 (FRAUD)")]
    InvalidCheapSide,
}
