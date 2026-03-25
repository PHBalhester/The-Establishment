//! Cross-crate serialization round-trip tests (S007).
//!
//! Proves that epoch-program's EpochState and tax-program's mirror struct
//! are byte-level compatible. If either crate changes field order, types,
//! or padding, this test will fail.

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use anchor_lang::AnchorDeserialize;
    use anchor_lang::AnchorSerialize;

    /// Build an epoch-program EpochState with deterministic test values.
    fn build_epoch_state() -> epoch_program::state::epoch_state::EpochState {
        epoch_program::state::epoch_state::EpochState {
            genesis_slot: 100_000,
            current_epoch: 42,
            epoch_start_slot: 5_432_100,
            cheap_side: 1, // FRAUD
            low_tax_bps: 200,
            high_tax_bps: 1200,
            crime_buy_tax_bps: 1200,
            crime_sell_tax_bps: 200,
            fraud_buy_tax_bps: 200,
            fraud_sell_tax_bps: 1200,
            vrf_request_slot: 5_432_000,
            vrf_pending: false,
            taxes_confirmed: true,
            pending_randomness_account: Pubkey::new_unique(),
            carnage_pending: false,
            carnage_target: 0,
            carnage_action: 0,
            carnage_deadline_slot: 0,
            carnage_lock_slot: 0,
            last_carnage_epoch: 41,
            reserved: [0u8; 64],
            initialized: true,
            bump: 255,
        }
    }

    /// Build a tax-program EpochState mirror with the same values.
    fn build_tax_mirror(
        src: &epoch_program::state::epoch_state::EpochState,
    ) -> tax_program::state::epoch_state_reader::EpochState {
        tax_program::state::epoch_state_reader::EpochState {
            genesis_slot: src.genesis_slot,
            current_epoch: src.current_epoch,
            epoch_start_slot: src.epoch_start_slot,
            cheap_side: src.cheap_side,
            low_tax_bps: src.low_tax_bps,
            high_tax_bps: src.high_tax_bps,
            crime_buy_tax_bps: src.crime_buy_tax_bps,
            crime_sell_tax_bps: src.crime_sell_tax_bps,
            fraud_buy_tax_bps: src.fraud_buy_tax_bps,
            fraud_sell_tax_bps: src.fraud_sell_tax_bps,
            vrf_request_slot: src.vrf_request_slot,
            vrf_pending: src.vrf_pending,
            taxes_confirmed: src.taxes_confirmed,
            pending_randomness_account: src.pending_randomness_account,
            carnage_pending: src.carnage_pending,
            carnage_target: src.carnage_target,
            carnage_action: src.carnage_action,
            carnage_deadline_slot: src.carnage_deadline_slot,
            carnage_lock_slot: src.carnage_lock_slot,
            last_carnage_epoch: src.last_carnage_epoch,
            reserved: src.reserved,
            initialized: src.initialized,
            bump: src.bump,
        }
    }

    #[test]
    fn epoch_to_tax_round_trip() {
        let epoch_state = build_epoch_state();

        // Serialize from epoch-program
        let mut buf = Vec::new();
        epoch_state.serialize(&mut buf).expect("epoch serialize");

        // Deserialize as tax-program mirror
        let tax_state =
            tax_program::state::epoch_state_reader::EpochState::deserialize(&mut buf.as_slice())
                .expect("tax deserialize");

        // Verify all fields match
        assert_eq!(tax_state.genesis_slot, epoch_state.genesis_slot);
        assert_eq!(tax_state.current_epoch, epoch_state.current_epoch);
        assert_eq!(tax_state.epoch_start_slot, epoch_state.epoch_start_slot);
        assert_eq!(tax_state.cheap_side, epoch_state.cheap_side);
        assert_eq!(tax_state.low_tax_bps, epoch_state.low_tax_bps);
        assert_eq!(tax_state.high_tax_bps, epoch_state.high_tax_bps);
        assert_eq!(tax_state.crime_buy_tax_bps, epoch_state.crime_buy_tax_bps);
        assert_eq!(tax_state.crime_sell_tax_bps, epoch_state.crime_sell_tax_bps);
        assert_eq!(tax_state.fraud_buy_tax_bps, epoch_state.fraud_buy_tax_bps);
        assert_eq!(tax_state.fraud_sell_tax_bps, epoch_state.fraud_sell_tax_bps);
        assert_eq!(tax_state.vrf_request_slot, epoch_state.vrf_request_slot);
        assert_eq!(tax_state.vrf_pending, epoch_state.vrf_pending);
        assert_eq!(tax_state.taxes_confirmed, epoch_state.taxes_confirmed);
        assert_eq!(
            tax_state.pending_randomness_account,
            epoch_state.pending_randomness_account
        );
        assert_eq!(tax_state.carnage_pending, epoch_state.carnage_pending);
        assert_eq!(tax_state.carnage_target, epoch_state.carnage_target);
        assert_eq!(tax_state.carnage_action, epoch_state.carnage_action);
        assert_eq!(
            tax_state.carnage_deadline_slot,
            epoch_state.carnage_deadline_slot
        );
        assert_eq!(tax_state.carnage_lock_slot, epoch_state.carnage_lock_slot);
        assert_eq!(tax_state.last_carnage_epoch, epoch_state.last_carnage_epoch);
        assert_eq!(tax_state.reserved, epoch_state.reserved);
        assert_eq!(tax_state.initialized, epoch_state.initialized);
        assert_eq!(tax_state.bump, epoch_state.bump);
    }

    #[test]
    fn tax_to_epoch_round_trip() {
        let epoch_state = build_epoch_state();
        let tax_state = build_tax_mirror(&epoch_state);

        // Serialize from tax-program mirror
        let mut buf = Vec::new();
        tax_state.serialize(&mut buf).expect("tax serialize");

        // Deserialize as epoch-program struct
        let recovered =
            epoch_program::state::epoch_state::EpochState::deserialize(&mut buf.as_slice())
                .expect("epoch deserialize");

        // Verify round-trip integrity
        assert_eq!(recovered.genesis_slot, epoch_state.genesis_slot);
        assert_eq!(recovered.current_epoch, epoch_state.current_epoch);
        assert_eq!(recovered.bump, epoch_state.bump);
        assert_eq!(recovered.crime_buy_tax_bps, epoch_state.crime_buy_tax_bps);
        assert_eq!(recovered.fraud_sell_tax_bps, epoch_state.fraud_sell_tax_bps);
        assert_eq!(
            recovered.pending_randomness_account,
            epoch_state.pending_randomness_account
        );
        assert_eq!(recovered.last_carnage_epoch, epoch_state.last_carnage_epoch);
        assert_eq!(recovered.reserved, epoch_state.reserved);
    }

    #[test]
    fn byte_length_parity() {
        let epoch_state = build_epoch_state();
        let tax_state = build_tax_mirror(&epoch_state);

        let mut epoch_buf = Vec::new();
        epoch_state.serialize(&mut epoch_buf).unwrap();

        let mut tax_buf = Vec::new();
        tax_state.serialize(&mut tax_buf).unwrap();

        assert_eq!(
            epoch_buf.len(),
            tax_buf.len(),
            "Serialized byte lengths must match"
        );
        assert_eq!(
            epoch_buf, tax_buf,
            "Serialized bytes must be identical"
        );
    }
}
