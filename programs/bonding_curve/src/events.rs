use anchor_lang::prelude::*;

use crate::state::Token;

// ==========================================================================
// Lifecycle Events
// ==========================================================================

/// Emitted when a new bonding curve is initialized for a token.
#[event]
pub struct CurveInitialized {
    pub token: Token,
    pub token_mint: Pubkey,
    pub timestamp: i64,
}

/// Emitted when the curve's token vault is funded with 460M tokens.
#[event]
pub struct CurveFunded {
    pub token: Token,
    pub amount: u64,
}

/// Emitted when the curve is activated for purchases.
#[event]
pub struct CurveStarted {
    pub token: Token,
    pub start_slot: u64,
    pub deadline_slot: u64,
    pub timestamp: i64,
}

/// Emitted when the curve reaches its target (460M sold / 1000 SOL raised).
#[event]
pub struct CurveFilled {
    pub token: Token,
    pub total_sold: u64,
    pub total_raised: u64,
    pub slot: u64,
}

/// Emitted when the curve fails (deadline passed without filling).
#[event]
pub struct CurveFailed {
    pub token: Token,
    pub tokens_sold: u64,
    pub sol_raised: u64,
    pub deadline_slot: u64,
    pub current_slot: u64,
}

// ==========================================================================
// Trade Events
// ==========================================================================

/// Emitted when a user purchases tokens from the curve.
#[event]
pub struct TokensPurchased {
    pub user: Pubkey,
    pub token: Token,
    pub sol_spent: u64,
    pub tokens_received: u64,
    pub new_tokens_sold: u64,
    pub current_price: u64,
    pub slot: u64,
}

/// Emitted when a user sells tokens back to the curve.
#[event]
pub struct TokensSold {
    pub user: Pubkey,
    pub token: Token,
    /// Number of tokens sold back to the curve.
    pub tokens_sold: u64,
    /// SOL sent to user (after 15% tax deduction).
    pub sol_received_net: u64,
    /// 15% tax amount routed to escrow.
    pub tax_amount: u64,
    /// Updated curve.tokens_sold after this sell.
    pub new_tokens_sold: u64,
    /// Price after sell (curve walks backward).
    pub current_price: u64,
    pub slot: u64,
}

// ==========================================================================
// Tax Escrow Events
// ==========================================================================

/// Emitted when sell tax is collected into the escrow.
#[event]
pub struct TaxCollected {
    pub token: Token,
    /// Tax amount from this sell transaction.
    pub amount: u64,
    /// Total escrow balance after collection.
    pub escrow_balance: u64,
    pub slot: u64,
}

/// Emitted when tax escrow is consolidated back into the SOL vault (for refunds).
#[event]
pub struct EscrowConsolidated {
    pub token: Token,
    /// Lamports moved from escrow to vault.
    pub escrow_amount: u64,
    /// SOL vault balance after consolidation.
    pub new_vault_balance: u64,
}

/// Emitted when tax escrow is distributed to the carnage fund (on graduation).
#[event]
pub struct EscrowDistributed {
    pub token: Token,
    /// Lamports sent to carnage fund.
    pub amount: u64,
    /// Carnage fund address.
    pub destination: Pubkey,
    pub slot: u64,
}

// ==========================================================================
// Refund Events
// ==========================================================================

/// Emitted when a user claims a refund after curve failure.
#[event]
pub struct RefundClaimed {
    pub user: Pubkey,
    pub token: Token,
    /// Tokens permanently destroyed (burned).
    pub tokens_burned: u64,
    /// SOL returned to user.
    pub refund_amount: u64,
    /// curve.tokens_sold after this claim.
    pub remaining_tokens_sold: u64,
    /// sol_vault balance after this claim.
    pub remaining_vault_balance: u64,
    pub slot: u64,
}

// ==========================================================================
// Graduation Events
// ==========================================================================

/// Emitted when prepare_transition is called (both curves filled).
#[event]
pub struct TransitionPrepared {
    pub crime_sol_raised: u64,
    pub fraud_sol_raised: u64,
    pub slot: u64,
}

/// Emitted when finalize_transition completes (terminal state).
#[event]
pub struct TransitionComplete {
    pub crime_sol_raised: u64,
    pub fraud_sol_raised: u64,
    pub timestamp: i64,
}

// ==========================================================================
// Post-Graduation Events (Phase 74)
// ==========================================================================

/// Emitted when SOL is withdrawn from a graduated curve's SOL vault.
#[event]
pub struct SolWithdrawn {
    /// Token mint of the graduated curve.
    pub token_mint: Pubkey,
    /// Lamports withdrawn.
    pub amount: u64,
    pub slot: u64,
}

/// Emitted when a graduated curve's empty token vault is closed.
#[event]
pub struct TokenVaultClosed {
    /// Token mint of the graduated curve.
    pub token_mint: Pubkey,
    /// Rent lamports recovered from closing the vault.
    pub rent_recovered: u64,
    pub slot: u64,
}
