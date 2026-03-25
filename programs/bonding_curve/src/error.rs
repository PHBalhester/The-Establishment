use anchor_lang::prelude::*;

/// Error codes for the bonding curve program.
///
/// Covers all phases:
/// - Phase 71: Buy instruction errors
/// - Phase 72: Sell instruction errors
/// - Phase 73: Graduation and refund errors
#[error_code]
pub enum CurveError {
    /// Caller is not the admin authority stored in BcAdminConfig.
    #[msg("Unauthorized: caller is not the admin")]
    Unauthorized,

    /// Arithmetic overflow in curve math (intermediate u128 calculation exceeded bounds).
    #[msg("Arithmetic overflow in curve calculation")]
    Overflow,

    /// Curve is not in Active status -- buys are only accepted when Active.
    #[msg("Curve is not active for purchases")]
    CurveNotActive,

    /// Curve is not in Active status -- sells are only accepted when Active.
    #[msg("Curve is not active for sells")]
    CurveNotActiveForSell,

    /// The curve's deadline slot has been exceeded.
    #[msg("Curve deadline has passed")]
    DeadlinePassed,

    /// SOL amount is below the minimum purchase threshold (0.05 SOL).
    #[msg("Purchase amount is below minimum (0.05 SOL)")]
    BelowMinimum,

    /// Purchase would push the user's ATA balance over the 20M per-wallet cap.
    #[msg("Purchase would exceed per-wallet cap of 20M tokens")]
    WalletCapExceeded,

    /// Slippage protection triggered: output amount is below the caller's minimum.
    #[msg("Slippage exceeded -- output below minimum specified")]
    SlippageExceeded,

    /// The curve is not in the required status for this operation.
    #[msg("Invalid curve status for this operation")]
    InvalidStatus,

    /// Curve has not been funded yet -- fund_curve must be called before start_curve.
    #[msg("Curve token vault has not been funded")]
    CurveNotFunded,

    /// Token amount must be greater than zero.
    #[msg("Token amount must be greater than zero")]
    ZeroAmount,

    /// User does not hold enough tokens to sell the requested amount.
    #[msg("Insufficient token balance for sell")]
    InsufficientTokenBalance,

    /// Tax escrow has not been consolidated before claiming refund.
    #[msg("Tax escrow must be consolidated before refund")]
    EscrowNotConsolidated,

    /// Curve is not in a refund-eligible state.
    #[msg("Curve is not eligible for refunds")]
    NotRefundEligible,

    /// Curve has already been filled -- cannot over-fill.
    #[msg("Curve has already reached its target")]
    CurveAlreadyFilled,

    /// Calculated tokens out is zero (dust buy -- SOL too small for even 1 token).
    #[msg("Purchase too small -- calculated tokens out is zero")]
    InsufficientTokensOut,

    /// SOL vault solvency invariant violated -- vault balance below expected from integral.
    /// This is a defense-in-depth check: if this fires, the math has a bug.
    #[msg("Vault solvency invariant violated -- SOL vault balance below expected")]
    VaultInsolvency,

    // ----- Phase 73: Graduation and Refund errors -----

    /// Deadline + grace period has not passed yet.
    #[msg("Deadline and grace period have not passed yet")]
    DeadlineNotPassed,

    /// Curve has not graduated (required for escrow distribution).
    #[msg("Curve has not graduated")]
    CurveNotGraduated,

    /// User has no tokens to burn for refund.
    #[msg("No tokens to burn -- user balance is zero")]
    NothingToBurn,

    /// Tax escrow has already been consolidated.
    #[msg("Tax escrow has already been consolidated")]
    EscrowAlreadyConsolidated,

    /// Tax escrow has already been distributed (zero transferable balance).
    #[msg("Tax escrow has already been distributed")]
    EscrowAlreadyDistributed,

    /// CRIME curve is not in Filled status (required for graduation).
    #[msg("CRIME curve is not filled")]
    CRIMECurveNotFilled,

    /// FRAUD curve is not in Filled status (required for graduation).
    #[msg("FRAUD curve is not filled")]
    FRAUDCurveNotFilled,

    /// No tokens outstanding (division by zero guard for refund calculation).
    #[msg("No tokens outstanding -- cannot calculate refund")]
    NoTokensOutstanding,

    // ----- Phase 79: Financial Safety errors -----

    /// Partial fill recalculation produced actual_sol > sol_amount (defense-in-depth).
    #[msg("Partial fill overcharge -- actual SOL exceeds input amount")]
    PartialFillOvercharge,

    /// Partner curve's token_mint does not match this curve's partner_mint.
    #[msg("Invalid partner curve -- token mint mismatch")]
    InvalidPartnerCurve,

    // ----- Phase 80: Defense-in-depth errors -----

    /// Transfer Hook remaining_accounts count mismatch -- expected exactly 4.
    #[msg("Invalid hook accounts -- expected exactly 4 remaining accounts")]
    InvalidHookAccounts,

    // ----- Phase 97: Transfer authority errors -----

    /// New authority cannot be Pubkey::default() (use burn_bc_admin for that).
    #[msg("Invalid authority: cannot transfer to Pubkey::default()")]
    InvalidAuthority,
}
