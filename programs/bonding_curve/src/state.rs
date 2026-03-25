use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// BcAdminConfig (Phase 78 — Authority Hardening)
// ---------------------------------------------------------------------------

/// Global admin configuration for the Bonding Curve program.
///
/// This PDA is initialized once by the program's upgrade authority,
/// storing the admin pubkey that gates all admin-only instructions
/// (initialize_curve, fund_curve, start_curve, prepare_transition,
/// withdraw_graduated_sol, close_token_vault).
///
/// The admin can be a multisig address — not required to be the upgrade authority.
/// Once burned (authority set to Pubkey::default()), admin operations are
/// permanently disabled.
///
/// Seeds: [b"bc_admin"]
#[account]
#[derive(InitSpace)]
pub struct BcAdminConfig {
    /// The admin pubkey authorized to perform admin operations.
    /// Set to Pubkey::default() after burn to permanently revoke.
    pub authority: Pubkey,
    /// PDA bump seed for re-derivation in downstream instructions.
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Token Enum
// ---------------------------------------------------------------------------

/// Which token this curve is selling.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Token {
    Crime,
    Fraud,
}

// ---------------------------------------------------------------------------
// CurveStatus Enum (Section 5.2)
// ---------------------------------------------------------------------------

/// Lifecycle status of a bonding curve.
///
/// State machine transitions:
///   Initialized -> Active      (start_curve: curve funded, authority calls)
///   Active      -> Filled      (purchase: tokens_sold >= TARGET_TOKENS)
///   Active      -> Failed      (mark_failed: clock.slot > deadline_slot)
///   Filled      -> Graduated   (finalize_transition: partner also Filled/Graduated)
///
/// Terminal states: Graduated, Failed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CurveStatus {
    /// Curve initialized but not started.
    Initialized,

    /// Curve is active, accepting buys and sells.
    Active,

    /// Curve reached target (460M sold / 1000 SOL raised). Sells disabled.
    Filled,

    /// Deadline passed without filling, or partner failed. Refunds available.
    Failed,

    /// Both curves filled and transition to pools completed. Terminal state.
    Graduated,
}

// ---------------------------------------------------------------------------
// CurveState Account (Section 5.1)
// ---------------------------------------------------------------------------

/// Per-token bonding curve state account.
///
/// One CurveState exists for CRIME, one for FRAUD.
/// Seeds: ["curve", token_mint].
///
/// Size: 8 (discriminator) + 224 (data) = 232 bytes.
///
/// Field sizes:
///   token:            1 byte  (enum Tag)
///   token_mint:      32 bytes (Pubkey)
///   token_vault:     32 bytes (Pubkey)
///   sol_vault:       32 bytes (Pubkey)
///   tokens_sold:      8 bytes (u64)
///   sol_raised:       8 bytes (u64)
///   status:           1 byte  (enum Tag)
///   start_slot:       8 bytes (u64)
///   deadline_slot:    8 bytes (u64)
///   participant_count: 4 bytes (u32)
///   tokens_returned:  8 bytes (u64)
///   sol_returned:     8 bytes (u64)
///   tax_collected:    8 bytes (u64)
///   tax_escrow:      32 bytes (Pubkey)
///   bump:             1 byte  (u8)
///   escrow_consolidated: 1 byte (bool)
///   partner_mint:    32 bytes (Pubkey)
///   -------------------------
///   Total data:     224 bytes
#[account]
pub struct CurveState {
    /// Token this curve is selling (CRIME or FRAUD).
    pub token: Token,                   // 1 byte

    /// Mint address of the token being sold.
    pub token_mint: Pubkey,             // 32 bytes

    /// PDA holding tokens for sale.
    pub token_vault: Pubkey,            // 32 bytes

    /// PDA holding raised SOL.
    pub sol_vault: Pubkey,              // 32 bytes

    /// Total tokens currently sold (decreases on sells).
    pub tokens_sold: u64,               // 8 bytes

    /// Total SOL raised from buys (gross, does not decrease on sells).
    pub sol_raised: u64,                // 8 bytes

    /// Curve status.
    pub status: CurveStatus,            // 1 byte

    /// Slot when curve started (0 if not started).
    pub start_slot: u64,                // 8 bytes

    /// Deadline slot (start_slot + DEADLINE_SLOTS).
    pub deadline_slot: u64,             // 8 bytes

    /// Number of unique purchasers (incremented on first buy when user ATA balance was 0).
    pub participant_count: u32,         // 4 bytes

    /// Cumulative tokens returned to curve via sells.
    pub tokens_returned: u64,           // 8 bytes

    /// Cumulative SOL returned to sellers (gross, before tax deduction).
    pub sol_returned: u64,              // 8 bytes

    /// Cumulative sell tax collected (15% of gross sell proceeds).
    pub tax_collected: u64,             // 8 bytes

    /// PDA address of this curve's tax escrow account.
    pub tax_escrow: Pubkey,             // 32 bytes

    /// PDA bump for this CurveState.
    pub bump: u8,                       // 1 byte

    /// Whether tax escrow has been consolidated into sol_vault for refunds.
    pub escrow_consolidated: bool,      // 1 byte

    /// Mint address of the partner curve's token (CRIME curve stores FRAUD mint, vice versa).
    /// Used to validate partner_curve_state identity in claim_refund / consolidate_for_refund.
    pub partner_mint: Pubkey,           // 32 bytes
}

impl CurveState {
    /// Total account size including 8-byte Anchor discriminator.
    /// 8 (discriminator) + 224 (data) = 232 bytes.
    pub const LEN: usize = 8 + 224;

    /// Check if this curve is eligible for refunds.
    ///
    /// A curve is refund-eligible if:
    /// - It has `Failed` status (deadline passed without filling), OR
    /// - It has `Filled` status but its partner curve has `Failed`
    ///   (transition to pools is impossible).
    pub fn is_refund_eligible(&self, partner_status: CurveStatus) -> bool {
        match self.status {
            CurveStatus::Failed => true,
            CurveStatus::Filled => partner_status == CurveStatus::Failed,
            _ => false,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::borsh;

    /// Verify CurveState serializes to exactly 191 bytes (LEN - 8 discriminator).
    ///
    /// This test catches any change to the struct layout that would cause
    /// on-chain deserialization failures (account too small / data misaligned).
    #[test]
    fn curve_state_serialized_size_matches_len() {
        let state = CurveState {
            token: Token::Crime,
            token_mint: Pubkey::new_unique(),
            token_vault: Pubkey::new_unique(),
            sol_vault: Pubkey::new_unique(),
            tokens_sold: u64::MAX,
            sol_raised: u64::MAX,
            status: CurveStatus::Active,
            start_slot: u64::MAX,
            deadline_slot: u64::MAX,
            participant_count: u32::MAX,
            tokens_returned: u64::MAX,
            sol_returned: u64::MAX,
            tax_collected: u64::MAX,
            tax_escrow: Pubkey::new_unique(),
            bump: u8::MAX,
            escrow_consolidated: false,
            partner_mint: Pubkey::new_unique(),
        };

        let serialized = borsh::to_vec(&state).expect("CurveState should serialize");
        let expected_data_size = CurveState::LEN - 8; // LEN includes 8-byte discriminator

        assert_eq!(
            serialized.len(),
            expected_data_size,
            "CurveState serialized size mismatch: got {} bytes, expected {} bytes (LEN={} minus 8 discriminator)",
            serialized.len(),
            expected_data_size,
            CurveState::LEN,
        );
    }

    /// Verify the exact LEN value matches the spec (232 bytes total).
    #[test]
    fn curve_state_len_is_232() {
        assert_eq!(CurveState::LEN, 232, "CurveState::LEN must be 232 (8 disc + 224 data)");
    }

    /// Verify is_refund_eligible logic matches spec Section 5.2.
    #[test]
    fn is_refund_eligible_logic() {
        let make_state = |status: CurveStatus| -> CurveState {
            CurveState {
                token: Token::Crime,
                token_mint: Pubkey::default(),
                token_vault: Pubkey::default(),
                sol_vault: Pubkey::default(),
                tokens_sold: 0,
                sol_raised: 0,
                status,
                start_slot: 0,
                deadline_slot: 0,
                participant_count: 0,
                tokens_returned: 0,
                sol_returned: 0,
                tax_collected: 0,
                tax_escrow: Pubkey::default(),
                bump: 0,
                escrow_consolidated: false,
                partner_mint: Pubkey::default(),
            }
        };

        // Failed curve is always refund-eligible regardless of partner
        let failed = make_state(CurveStatus::Failed);
        assert!(failed.is_refund_eligible(CurveStatus::Active));
        assert!(failed.is_refund_eligible(CurveStatus::Failed));
        assert!(failed.is_refund_eligible(CurveStatus::Filled));
        assert!(failed.is_refund_eligible(CurveStatus::Graduated));

        // Filled curve is refund-eligible only if partner is Failed
        let filled = make_state(CurveStatus::Filled);
        assert!(!filled.is_refund_eligible(CurveStatus::Active));
        assert!(filled.is_refund_eligible(CurveStatus::Failed));
        assert!(!filled.is_refund_eligible(CurveStatus::Filled));
        assert!(!filled.is_refund_eligible(CurveStatus::Graduated));

        // Active, Initialized, Graduated are never refund-eligible
        let active = make_state(CurveStatus::Active);
        assert!(!active.is_refund_eligible(CurveStatus::Failed));

        let initialized = make_state(CurveStatus::Initialized);
        assert!(!initialized.is_refund_eligible(CurveStatus::Failed));

        let graduated = make_state(CurveStatus::Graduated);
        assert!(!graduated.is_refund_eligible(CurveStatus::Failed));
    }
}
