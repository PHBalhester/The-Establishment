//! Exhaustive tests for partition_hook_accounts fix.
//!
//! Verifies that the atomic path correctly selects hook account slices
//! from the fixed [CRIME_buy(4), FRAUD_buy(4), held_sell(4)?] layout,
//! and that the fallback path is unchanged.
//!
//! Test matrix (atomic path):
//! - 3 actions (BuyOnly, Burn, Sell) × 2 targets (CRIME, FRAUD)
//!   × 3 held states (none, CRIME, FRAUD) = 18 combinations
//! - Each verifies correct sell_hooks and buy_hooks slice selection
//!
//! Run: `cargo test --test test_partition_hook_accounts -- --nocapture`

use anchor_lang::prelude::*;
use epoch_program::helpers::carnage_execution::{partition_hook_accounts, HOOK_ACCOUNTS_PER_MINT};
use epoch_program::state::{CarnageAction, Token};

/// Create N dummy AccountInfo entries with distinct keys for testing.
/// Each account gets a unique Pubkey so we can verify which slice was selected.
fn make_dummy_accounts(n: usize) -> (Vec<Pubkey>, Vec<AccountData>) {
    let pubkeys: Vec<Pubkey> = (0..n)
        .map(|i| {
            let mut bytes = [0u8; 32];
            bytes[0] = i as u8;
            bytes[1] = (i >> 8) as u8;
            Pubkey::new_from_array(bytes)
        })
        .collect();
    let data: Vec<AccountData> = pubkeys
        .iter()
        .map(|pk| AccountData {
            key: *pk,
            lamports: 0,
            data: vec![],
            owner: Pubkey::default(),
        })
        .collect();
    (pubkeys, data)
}

/// Minimal data to build AccountInfo for partition testing.
struct AccountData {
    key: Pubkey,
    lamports: u64,
    data: Vec<u8>,
    owner: Pubkey,
}

impl AccountData {
    fn to_account_info(&self) -> AccountInfo {
        let lamports_ref = Box::leak(Box::new(self.lamports));
        let data_ref: &mut [u8] = Box::leak(self.data.clone().into_boxed_slice());
        AccountInfo::new(
            &self.key,
            false,
            false,
            lamports_ref,
            data_ref,
            &self.owner,
            false,
            0,
        )
    }
}

/// Build AccountInfo slice from AccountData vec.
fn build_account_infos(data: &[AccountData]) -> Vec<AccountInfo> {
    data.iter().map(|d| d.to_account_info()).collect()
}

// =============================================================================
// ATOMIC PATH: BuyOnly × CRIME target
// Layout: [CRIME_buy(4), FRAUD_buy(4)] — 8 accounts, no sell hooks
// Expected: sell_hooks=empty, buy_hooks=CRIME_buy[0..4]
// =============================================================================
#[test]
fn atomic_buyonly_target_crime() {
    let (pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::None, // BuyOnly
        &Token::Crime,
        0, // no holdings
        &infos,
        true, // atomic
    );

    assert_eq!(sell.len(), 0, "BuyOnly should have no sell hooks");
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT, "Buy hooks should be 4 accounts");
    // Buy hooks should be CRIME_buy = remaining[0..4]
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[i], "Buy hook {} should be CRIME_buy[{}]", i, i);
    }
}

// =============================================================================
// ATOMIC PATH: BuyOnly × FRAUD target
// Layout: [CRIME_buy(4), FRAUD_buy(4)] — 8 accounts
// Expected: sell_hooks=empty, buy_hooks=FRAUD_buy[4..8]
// =============================================================================
#[test]
fn atomic_buyonly_target_fraud() {
    let (pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::None,
        &Token::Fraud,
        0,
        &infos,
        true,
    );

    assert_eq!(sell.len(), 0);
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    // Buy hooks should be FRAUD_buy = remaining[4..8]
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[4 + i], "Buy hook {} should be FRAUD_buy[{}]", i, i);
    }
}

// =============================================================================
// ATOMIC PATH: Burn × CRIME target (no sell hooks needed, burn doesn't use hooks)
// =============================================================================
#[test]
fn atomic_burn_target_crime() {
    let (pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Burn,
        &Token::Crime,
        1, // held CRIME (but burn doesn't use hooks)
        &infos,
        true,
    );

    assert_eq!(sell.len(), 0, "Burn should have no sell hooks");
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[i], "Buy hook should be CRIME_buy");
    }
}

// =============================================================================
// ATOMIC PATH: Burn × FRAUD target
// =============================================================================
#[test]
fn atomic_burn_target_fraud() {
    let (pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Burn,
        &Token::Fraud,
        2, // held FRAUD
        &infos,
        true,
    );

    assert_eq!(sell.len(), 0);
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[4 + i], "Buy hook should be FRAUD_buy");
    }
}

// =============================================================================
// ATOMIC PATH: Sell × CRIME target, held FRAUD
// Layout: [CRIME_buy(4), FRAUD_buy(4), FRAUD_sell(4)] — 12 accounts
// Expected: sell_hooks=FRAUD_sell[8..12], buy_hooks=CRIME_buy[0..4]
// =============================================================================
#[test]
fn atomic_sell_target_crime_held_fraud() {
    let (pubkeys, data) = make_dummy_accounts(12);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Sell,
        &Token::Crime,
        2, // held FRAUD
        &infos,
        true,
    );

    assert_eq!(sell.len(), HOOK_ACCOUNTS_PER_MINT, "Sell should have 4 accounts");
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT, "Buy should have 4 accounts");
    // Sell hooks from [8..12]
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(sell[i].key(), pubkeys[8 + i], "Sell hook {} should be held_sell[{}]", i, i);
    }
    // Buy hooks = CRIME_buy[0..4]
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[i], "Buy hook {} should be CRIME_buy[{}]", i, i);
    }
}

// =============================================================================
// ATOMIC PATH: Sell × FRAUD target, held CRIME
// Layout: [CRIME_buy(4), FRAUD_buy(4), CRIME_sell(4)] — 12 accounts
// Expected: sell_hooks=CRIME_sell[8..12], buy_hooks=FRAUD_buy[4..8]
// =============================================================================
#[test]
fn atomic_sell_target_fraud_held_crime() {
    let (pubkeys, data) = make_dummy_accounts(12);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Sell,
        &Token::Fraud,
        1, // held CRIME
        &infos,
        true,
    );

    assert_eq!(sell.len(), HOOK_ACCOUNTS_PER_MINT);
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    // Sell hooks from [8..12]
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(sell[i].key(), pubkeys[8 + i]);
    }
    // Buy hooks = FRAUD_buy[4..8]
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[4 + i]);
    }
}

// =============================================================================
// ATOMIC PATH: Sell × CRIME target, held CRIME (same token sell+buy)
// Layout: [CRIME_buy(4), FRAUD_buy(4), CRIME_sell(4)] — 12 accounts
// Expected: sell_hooks=CRIME_sell[8..12], buy_hooks=CRIME_buy[0..4]
// =============================================================================
#[test]
fn atomic_sell_target_crime_held_crime() {
    let (pubkeys, data) = make_dummy_accounts(12);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Sell,
        &Token::Crime,
        1, // held CRIME
        &infos,
        true,
    );

    assert_eq!(sell.len(), HOOK_ACCOUNTS_PER_MINT);
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(sell[i].key(), pubkeys[8 + i], "Sell from [8..12]");
    }
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[i], "Buy from CRIME_buy[0..4]");
    }
}

// =============================================================================
// ATOMIC PATH: Sell × FRAUD target, held FRAUD (same token sell+buy)
// =============================================================================
#[test]
fn atomic_sell_target_fraud_held_fraud() {
    let (pubkeys, data) = make_dummy_accounts(12);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Sell,
        &Token::Fraud,
        2,
        &infos,
        true,
    );

    assert_eq!(sell.len(), HOOK_ACCOUNTS_PER_MINT);
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(sell[i].key(), pubkeys[8 + i], "Sell from [8..12]");
    }
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[4 + i], "Buy from FRAUD_buy[4..8]");
    }
}

// =============================================================================
// ATOMIC PATH: Sell action but only 8 accounts (no sell hooks appended)
// This happens if held_amount was 0 at TX build time but VRF picked Sell.
// On-chain: action=Sell but no sell hooks available → sell_hooks=empty.
// The sell step will be skipped because held_amount=0 (checked in execute_carnage_core).
// =============================================================================
#[test]
fn atomic_sell_action_but_no_sell_hooks() {
    let (pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Sell,
        &Token::Fraud,
        0, // no holdings
        &infos,
        true,
    );

    // Only 8 accounts, not enough for sell hooks at [8..12]
    assert_eq!(sell.len(), 0, "No sell hooks when < 12 remaining_accounts");
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
    for i in 0..HOOK_ACCOUNTS_PER_MINT {
        assert_eq!(buy[i].key(), pubkeys[4 + i]);
    }
}

// =============================================================================
// ATOMIC PATH: No-op (carnage_pending=false) — remaining_accounts not touched
// In practice, the handler returns early before partition is called.
// But test that 8 accounts still partitions correctly if called.
// =============================================================================
#[test]
fn atomic_noop_still_partitions_safely() {
    let (_pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    // Even with action=None (from cleared state), partition should work
    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::None,
        &Token::Crime, // default
        0,
        &infos,
        true,
    );

    assert_eq!(sell.len(), 0);
    assert_eq!(buy.len(), HOOK_ACCOUNTS_PER_MINT);
}

// =============================================================================
// FALLBACK PATH: BuyOnly — unchanged behavior
// Layout: [buy_hook(4)]
// =============================================================================
#[test]
fn fallback_buyonly() {
    let (pubkeys, data) = make_dummy_accounts(4);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::None,
        &Token::Crime,
        0,
        &infos,
        false, // fallback
    );

    assert_eq!(sell.len(), 0);
    assert_eq!(buy.len(), 4);
    for i in 0..4 {
        assert_eq!(buy[i].key(), pubkeys[i]);
    }
}

// =============================================================================
// FALLBACK PATH: Burn — unchanged behavior
// =============================================================================
#[test]
fn fallback_burn() {
    let (pubkeys, data) = make_dummy_accounts(4);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Burn,
        &Token::Fraud,
        1,
        &infos,
        false,
    );

    assert_eq!(sell.len(), 0);
    assert_eq!(buy.len(), 4);
    for i in 0..4 {
        assert_eq!(buy[i].key(), pubkeys[i]);
    }
}

// =============================================================================
// FALLBACK PATH: Sell — unchanged behavior [sell(4), buy(4)]
// =============================================================================
#[test]
fn fallback_sell() {
    let (pubkeys, data) = make_dummy_accounts(8);
    let infos = build_account_infos(&data);

    let (sell, buy) = partition_hook_accounts(
        &CarnageAction::Sell,
        &Token::Crime,
        2,
        &infos,
        false,
    );

    assert_eq!(sell.len(), 4);
    assert_eq!(buy.len(), 4);
    for i in 0..4 {
        assert_eq!(sell[i].key(), pubkeys[i], "Sell from [0..4]");
    }
    for i in 0..4 {
        assert_eq!(buy[i].key(), pubkeys[4 + i], "Buy from [4..8]");
    }
}

// =============================================================================
// EXHAUSTIVE: All 18 atomic combinations (3 actions × 2 targets × 3 held states)
// Verifies no panics and correct slice lengths for every combination.
// =============================================================================
#[test]
fn atomic_exhaustive_all_combinations() {
    let actions = [CarnageAction::None, CarnageAction::Burn, CarnageAction::Sell];
    let targets = [Token::Crime, Token::Fraud];
    let held_tokens: [u8; 3] = [0, 1, 2]; // None, CRIME, FRAUD

    for action in &actions {
        for target in &targets {
            for &held in &held_tokens {
                // Use 12 accounts (max layout) to cover all cases
                let (_pubkeys, data) = make_dummy_accounts(12);
                let infos = build_account_infos(&data);

                let (sell, buy) = partition_hook_accounts(
                    action, target, held, &infos, true,
                );

                // Buy hooks should always be exactly 4
                assert_eq!(
                    buy.len(), HOOK_ACCOUNTS_PER_MINT,
                    "action={:?} target={:?} held={}: buy_hooks should be 4",
                    action, target, held
                );

                // Sell hooks should be 4 only for Sell action with 12 accounts
                if matches!(action, CarnageAction::Sell) {
                    assert_eq!(
                        sell.len(), HOOK_ACCOUNTS_PER_MINT,
                        "Sell action should have 4 sell hooks with 12 accounts"
                    );
                } else {
                    assert_eq!(
                        sell.len(), 0,
                        "Non-sell action should have 0 sell hooks"
                    );
                }
            }
        }
    }
}
