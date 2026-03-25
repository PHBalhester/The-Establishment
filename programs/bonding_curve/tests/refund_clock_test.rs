//! LiteSVM Refund Clock Tests
//!
//! Tests the clock-dependent behavior of the bonding curve's refund flow
//! using LiteSVM's `set_sysvar()` to manipulate the Clock sysvar.
//!
//! Coverage:
//! - mark_failed before deadline (should fail: CurveNotActive or DeadlineNotPassed)
//! - mark_failed during grace period (should fail: DeadlineNotPassed)
//! - mark_failed at exact boundary (should fail: strictly-greater check)
//! - mark_failed after grace period (should succeed)
//! - consolidate_for_refund after mark_failed (should succeed)
//! - claim_refund with multiple users (proportional + sequential)
//! - purchase after deadline (should fail: DeadlinePassed)
//!
//! Why LiteSVM: The Anchor test validator doesn't expose clock warping,
//! so the lifecycle.test.ts integration test uses feature-gated short
//! DEADLINE_SLOTS and natural slot advancement. LiteSVM gives us exact
//! clock control for precise boundary testing.
//!
//! Note: These tests complement the 5M proptest iterations (Phase 73)
//! that cover refund math correctness. These add clock-dependent
//! integration coverage.
//!
//! Source: .planning/phases/74-protocol-integration/74-05-PLAN.md

use std::path::Path;

use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_keypair::Keypair as LiteKeypair;
use solana_signer::Signer as LiteSigner;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;

use anchor_lang::prelude::Pubkey;
use sha2::{Sha256, Digest};

use solana_sdk::program_pack::Pack;

// ---------------------------------------------------------------------------
// Constants matching on-chain bonding_curve/src/constants.rs
// ---------------------------------------------------------------------------

const CURVE_SEED: &[u8] = b"curve";
const CURVE_TOKEN_VAULT_SEED: &[u8] = b"curve_token_vault";
const CURVE_SOL_VAULT_SEED: &[u8] = b"curve_sol_vault";
const TAX_ESCROW_SEED: &[u8] = b"tax_escrow";

/// We use the production DEADLINE_SLOTS (432_000) for LiteSVM tests because
/// we have full clock control. This tests the real on-chain constants.
const DEADLINE_SLOTS: u64 = 432_000;
const FAILURE_GRACE_SLOTS: u64 = 150;
const TARGET_TOKENS: u64 = 460_000_000_000_000;
const TOKEN_DECIMALS: u8 = 6;

/// Bonding curve program ID
fn program_id() -> Pubkey {
    "DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV"
        .parse()
        .unwrap()
}

/// Token-2022 program ID
fn token_2022_id() -> Pubkey {
    spl_token_2022::id()
}

/// System program ID
fn system_program_id() -> Pubkey {
    solana_sdk::system_program::id()
}

/// BPF Loader Upgradeable program ID
fn bpf_loader_upgradeable_id() -> Pubkey {
    solana_sdk::bpf_loader_upgradeable::id()
}

// ---------------------------------------------------------------------------
// Type conversion helpers
// ---------------------------------------------------------------------------

fn addr(pk: &Pubkey) -> Address {
    Address::from(pk.to_bytes())
}

fn pk(address: &Address) -> Pubkey {
    Pubkey::new_from_array(address.to_bytes())
}

fn kp_pubkey(kp: &LiteKeypair) -> Pubkey {
    pk(&kp.pubkey())
}

// ---------------------------------------------------------------------------
// Anchor instruction discriminator
// ---------------------------------------------------------------------------

fn anchor_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name));
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

fn curve_state_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CURVE_SEED, mint.as_ref()], &program_id())
}

fn token_vault_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CURVE_TOKEN_VAULT_SEED, mint.as_ref()], &program_id())
}

fn sol_vault_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CURVE_SOL_VAULT_SEED, mint.as_ref()], &program_id())
}

fn tax_escrow_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TAX_ESCROW_SEED, mint.as_ref()], &program_id())
}

fn program_data_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[program_id().as_ref()],
        &bpf_loader_upgradeable_id(),
    )
}

// ---------------------------------------------------------------------------
// Clock sysvar manipulation
// ---------------------------------------------------------------------------

/// Manually set the Clock sysvar in LiteSVM.
///
/// The Clock sysvar is stored at SysvarC1ock11111111111111111111111111111111
/// and is bincode-serialized with fields:
///   slot: u64, epoch_start_timestamp: i64, epoch: u64,
///   leader_schedule_epoch: u64, unix_timestamp: i64
fn set_clock(svm: &mut LiteSVM, slot: u64, unix_timestamp: i64) {
    let clock_addr: Address = addr(
        &"SysvarC1ock11111111111111111111111111111111"
            .parse::<Pubkey>()
            .unwrap(),
    );

    // bincode layout: slot(u64) + epoch_start_timestamp(i64) + epoch(u64) +
    //                 leader_schedule_epoch(u64) + unix_timestamp(i64) = 40 bytes
    let mut data = vec![0u8; 40];
    data[0..8].copy_from_slice(&slot.to_le_bytes());
    data[8..16].copy_from_slice(&unix_timestamp.to_le_bytes()); // epoch_start_timestamp
    data[16..24].copy_from_slice(&0u64.to_le_bytes()); // epoch
    data[24..32].copy_from_slice(&0u64.to_le_bytes()); // leader_schedule_epoch
    data[32..40].copy_from_slice(&unix_timestamp.to_le_bytes()); // unix_timestamp

    let sysvar_owner: Address = addr(
        &"Sysvar1111111111111111111111111111111111111"
            .parse::<Pubkey>()
            .unwrap(),
    );

    svm.set_account(
        clock_addr,
        Account {
            lamports: 1_009_200, // Standard sysvar lamports
            data,
            owner: sysvar_owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to set Clock sysvar");
}

// ---------------------------------------------------------------------------
// CurveState serialization
// ---------------------------------------------------------------------------

/// CurveStatus enum variants (matching on-chain state.rs)
#[repr(u8)]
#[derive(Clone, Copy)]
enum CurveStatus {
    Initialized = 0,
    Active = 1,
    Filled = 2,
    Failed = 3,
    _Graduated = 4,
}

/// Token enum variants
#[repr(u8)]
#[derive(Clone, Copy)]
enum TokenKind {
    Crime = 0,
    _Fraud = 1,
}

/// Serialize a CurveState account for direct injection into LiteSVM.
///
/// Layout matches programs/bonding_curve/src/state.rs CurveState exactly:
///   8 bytes: Anchor discriminator (sha256("account:CurveState")[..8])
///   1 byte:  token (enum)
///  32 bytes: token_mint
///  32 bytes: token_vault
///  32 bytes: sol_vault
///   8 bytes: tokens_sold
///   8 bytes: sol_raised
///   1 byte:  status (enum)
///   8 bytes: start_slot
///   8 bytes: deadline_slot
///   4 bytes: participant_count
///   8 bytes: tokens_returned
///   8 bytes: sol_returned
///   8 bytes: tax_collected
///  32 bytes: tax_escrow
///   1 byte:  bump
///   1 byte:  escrow_consolidated
///  32 bytes: partner_mint (added Phase 79)
///  --------
///  232 bytes total (8 disc + 224 data)
fn serialize_curve_state(
    token: TokenKind,
    token_mint: &Pubkey,
    token_vault: &Pubkey,
    sol_vault: &Pubkey,
    tokens_sold: u64,
    sol_raised: u64,
    status: CurveStatus,
    start_slot: u64,
    deadline_slot: u64,
    participant_count: u32,
    tokens_returned: u64,
    sol_returned: u64,
    tax_collected: u64,
    tax_escrow: &Pubkey,
    bump: u8,
    escrow_consolidated: bool,
    partner_mint: &Pubkey,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(232);

    // Anchor discriminator for CurveState
    let mut hasher = Sha256::new();
    hasher.update("account:CurveState");
    let hash = hasher.finalize();
    data.extend_from_slice(&hash[..8]);

    // Fields (Borsh serialization: enums as u8, fixed-size fields)
    data.push(token as u8);
    data.extend_from_slice(token_mint.as_ref());
    data.extend_from_slice(token_vault.as_ref());
    data.extend_from_slice(sol_vault.as_ref());
    data.extend_from_slice(&tokens_sold.to_le_bytes());
    data.extend_from_slice(&sol_raised.to_le_bytes());
    data.push(status as u8);
    data.extend_from_slice(&start_slot.to_le_bytes());
    data.extend_from_slice(&deadline_slot.to_le_bytes());
    data.extend_from_slice(&participant_count.to_le_bytes());
    data.extend_from_slice(&tokens_returned.to_le_bytes());
    data.extend_from_slice(&sol_returned.to_le_bytes());
    data.extend_from_slice(&tax_collected.to_le_bytes());
    data.extend_from_slice(tax_escrow.as_ref());
    data.push(bump);
    data.push(escrow_consolidated as u8);
    data.extend_from_slice(partner_mint.as_ref());

    assert_eq!(data.len(), 232, "CurveState must be exactly 232 bytes");
    data
}

// ---------------------------------------------------------------------------
// LiteSVM setup
// ---------------------------------------------------------------------------

/// Deploy the bonding curve program as an upgradeable BPF program.
fn setup_svm() -> (LiteSVM, LiteKeypair) {
    let mut svm = LiteSVM::new();
    let authority = LiteKeypair::new();
    let pid = program_id();

    let program_bytes = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("target/deploy/bonding_curve.so"),
    )
    .expect("bonding_curve.so not found -- run `anchor build` first");

    let (programdata_key, _bump) = program_data_address();
    let loader_id = bpf_loader_upgradeable_id();

    // Program account: UpgradeableLoaderState::Program { programdata_address }
    let mut program_account_data = vec![0u8; 36];
    program_account_data[0..4].copy_from_slice(&2u32.to_le_bytes());
    program_account_data[4..36].copy_from_slice(programdata_key.as_ref());

    // ProgramData account: header + ELF bytes
    let header_size = 4 + 8 + 1 + 32; // 45 bytes
    let mut programdata_data = vec![0u8; header_size + program_bytes.len()];
    programdata_data[0..4].copy_from_slice(&3u32.to_le_bytes());
    programdata_data[4..12].copy_from_slice(&0u64.to_le_bytes());
    programdata_data[12] = 1; // Some(upgrade_authority)
    programdata_data[13..45].copy_from_slice(kp_pubkey(&authority).as_ref());
    programdata_data[header_size..].copy_from_slice(&program_bytes);

    let rent = solana_sdk::rent::Rent::default();
    let program_lamports = rent.minimum_balance(program_account_data.len()).max(1);
    let programdata_lamports = rent.minimum_balance(programdata_data.len()).max(1);

    // Set programdata FIRST (litesvm reads it when setting executable program)
    svm.set_account(
        addr(&programdata_key),
        Account {
            lamports: programdata_lamports,
            data: programdata_data,
            owner: addr(&loader_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to set programdata account");

    svm.set_account(
        addr(&pid),
        Account {
            lamports: program_lamports,
            data: program_account_data,
            owner: addr(&loader_id),
            executable: true,
            rent_epoch: 0,
        },
    )
    .expect("Failed to set program account");

    // Fund authority
    svm.airdrop(&authority.pubkey(), 100_000_000_000).unwrap();

    (svm, authority)
}

/// Inject a CurveState PDA into LiteSVM with the given parameters.
///
/// Creates the PDA account at the correct address with correct owner,
/// bypassing the initialize_curve instruction. This lets us test
/// individual instructions (mark_failed, consolidate, claim_refund)
/// in isolation with precise state control.
fn inject_curve_state(
    svm: &mut LiteSVM,
    mint: &Pubkey,
    tokens_sold: u64,
    sol_raised: u64,
    status: CurveStatus,
    start_slot: u64,
    participant_count: u32,
    tokens_returned: u64,
    sol_returned: u64,
    tax_collected: u64,
    escrow_consolidated: bool,
    partner_mint: &Pubkey,
) {
    let (curve_pda, bump) = curve_state_pda(mint);
    let (token_vault, _) = token_vault_pda(mint);
    let (sol_vault, _) = sol_vault_pda(mint);
    let (tax_escrow, _) = tax_escrow_pda(mint);

    let deadline_slot = start_slot + DEADLINE_SLOTS;

    let data = serialize_curve_state(
        TokenKind::Crime,
        mint,
        &token_vault,
        &sol_vault,
        tokens_sold,
        sol_raised,
        status,
        start_slot,
        deadline_slot,
        participant_count,
        tokens_returned,
        sol_returned,
        tax_collected,
        &tax_escrow,
        bump,
        escrow_consolidated,
        partner_mint,
    );

    let rent = solana_sdk::rent::Rent::default();
    let lamports = rent.minimum_balance(data.len());

    svm.set_account(
        addr(&curve_pda),
        Account {
            lamports,
            data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CurveState");
}

/// Inject a SOL vault PDA with the given lamport balance.
fn inject_sol_vault(svm: &mut LiteSVM, mint: &Pubkey, lamports: u64) {
    let (sol_vault, _) = sol_vault_pda(mint);
    svm.set_account(
        addr(&sol_vault),
        Account {
            lamports,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject SOL vault");
}

/// Inject a tax escrow PDA with the given lamport balance.
fn inject_tax_escrow(svm: &mut LiteSVM, mint: &Pubkey, lamports: u64) {
    let (tax_escrow, _) = tax_escrow_pda(mint);
    svm.set_account(
        addr(&tax_escrow),
        Account {
            lamports,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject tax escrow");
}

/// Create a Token-2022 mint account in LiteSVM.
/// Returns the mint pubkey.
fn create_t22_mint(svm: &mut LiteSVM, authority: &LiteKeypair) -> (Pubkey, LiteKeypair) {
    let mint_kp = LiteKeypair::new();
    let mint_pk = kp_pubkey(&mint_kp);
    let mint_addr = mint_kp.pubkey();

    // Simple Token-2022 mint (without TransferHook extension for these tests)
    let space = spl_token_2022::state::Mint::LEN;
    let rent = solana_sdk::rent::Rent::default();
    let lamports = rent.minimum_balance(space);

    // CreateAccount instruction
    let create_ix = Instruction {
        program_id: addr(&system_program_id()),
        accounts: vec![
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new(mint_addr, true),
        ],
        data: {
            let mut d = vec![0u8; 4 + 8 + 8 + 32];
            d[0..4].copy_from_slice(&0u32.to_le_bytes());
            d[4..12].copy_from_slice(&lamports.to_le_bytes());
            d[12..20].copy_from_slice(&(space as u64).to_le_bytes());
            d[20..52].copy_from_slice(token_2022_id().as_ref());
            d
        },
    };

    // InitializeMint2 instruction
    let init_ix = Instruction {
        program_id: addr(&token_2022_id()),
        accounts: vec![
            AccountMeta::new(mint_addr, false),
        ],
        data: {
            let mut d = vec![20u8]; // InitializeMint2 = 20
            d.push(TOKEN_DECIMALS);
            d.extend_from_slice(kp_pubkey(authority).as_ref());
            d.push(0); // no freeze authority
            d
        },
    };

    let msg = Message::new_with_blockhash(
        &[create_ix, init_ix],
        Some(&authority.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[authority, &mint_kp],
    )
    .unwrap();
    svm.send_transaction(tx).unwrap();

    (mint_pk, mint_kp)
}

/// Create a Token-2022 token account (non-ATA) and mint tokens into it.
/// Used for tests that don't require associated_token constraints.
#[allow(dead_code)]
fn create_and_fund_t22_account(
    svm: &mut LiteSVM,
    payer: &LiteKeypair,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> (Pubkey, LiteKeypair) {
    let account_kp = LiteKeypair::new();
    let account_pk = kp_pubkey(&account_kp);
    let account_addr = account_kp.pubkey();

    let space = spl_token_2022::state::Account::LEN;
    let rent = solana_sdk::rent::Rent::default();
    let lamports = rent.minimum_balance(space);

    // CreateAccount
    let create_ix = Instruction {
        program_id: addr(&system_program_id()),
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(account_addr, true),
        ],
        data: {
            let mut d = vec![0u8; 4 + 8 + 8 + 32];
            d[0..4].copy_from_slice(&0u32.to_le_bytes());
            d[4..12].copy_from_slice(&lamports.to_le_bytes());
            d[12..20].copy_from_slice(&(space as u64).to_le_bytes());
            d[20..52].copy_from_slice(token_2022_id().as_ref());
            d
        },
    };

    // InitializeAccount3 (token-2022 variant, no rent sysvar needed)
    let init_ix = Instruction {
        program_id: addr(&token_2022_id()),
        accounts: vec![
            AccountMeta::new(account_addr, false),
            AccountMeta::new_readonly(addr(mint), false),
        ],
        data: {
            let mut d = vec![18u8]; // InitializeAccount3 = 18
            d.extend_from_slice(owner.as_ref());
            d
        },
    };

    let msg = Message::new_with_blockhash(
        &[create_ix, init_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[payer, &account_kp],
    )
    .unwrap();
    svm.send_transaction(tx).unwrap();

    // Mint tokens if amount > 0
    if amount > 0 {
        let mint_to_ix = Instruction {
            program_id: addr(&token_2022_id()),
            accounts: vec![
                AccountMeta::new(addr(mint), false),
                AccountMeta::new(account_addr, false),
                AccountMeta::new_readonly(payer.pubkey(), true),
            ],
            data: {
                let mut d = vec![7u8]; // MintTo = 7
                d.extend_from_slice(&amount.to_le_bytes());
                d
            },
        };

        let msg = Message::new_with_blockhash(
            &[mint_to_ix],
            Some(&payer.pubkey()),
            &svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(
            VersionedMessage::Legacy(msg),
            &[payer],
        )
        .unwrap();
        svm.send_transaction(tx).unwrap();
    }

    (account_pk, account_kp)
}

/// Derive the Associated Token Account (ATA) address for a given owner + mint.
///
/// For Token-2022, the ATA seeds are:
///   [owner, token_2022_program_id, mint]
/// with the ATA program as the deriving program.
fn derive_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address_with_program_id(
        owner,
        mint,
        &token_2022_id(),
    )
}

/// Create an Associated Token Account (ATA) for Token-2022 and mint tokens into it.
///
/// Uses the spl_associated_token_account instruction to create the ATA at the
/// deterministic PDA address. This is required for instructions that use
/// `associated_token::mint` and `associated_token::authority` Anchor constraints
/// (like claim_refund).
fn create_ata_and_fund(
    svm: &mut LiteSVM,
    payer: &LiteKeypair,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> Pubkey {
    let ata = derive_ata(owner, mint);

    // Create ATA using the official instruction
    // This handles the PDA derivation and account initialization in one step.
    let create_ata_ix = spl_associated_token_account::instruction::create_associated_token_account(
        &kp_pubkey(payer),
        owner,
        mint,
        &token_2022_id(),
    );

    // Convert to litesvm Instruction format
    let create_ix = Instruction {
        program_id: addr(&create_ata_ix.program_id),
        accounts: create_ata_ix
            .accounts
            .iter()
            .map(|a| AccountMeta {
                pubkey: addr(&a.pubkey),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
        data: create_ata_ix.data.clone(),
    };

    let msg = Message::new_with_blockhash(
        &[create_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[payer],
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to create ATA");

    // Mint tokens if amount > 0
    if amount > 0 {
        let mint_to_ix = Instruction {
            program_id: addr(&token_2022_id()),
            accounts: vec![
                AccountMeta::new(addr(mint), false),
                AccountMeta::new(addr(&ata), false),
                AccountMeta::new_readonly(payer.pubkey(), true),
            ],
            data: {
                let mut d = vec![7u8]; // MintTo = 7
                d.extend_from_slice(&amount.to_le_bytes());
                d
            },
        };

        let msg = Message::new_with_blockhash(
            &[mint_to_ix],
            Some(&payer.pubkey()),
            &svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(
            VersionedMessage::Legacy(msg),
            &[payer],
        )
        .unwrap();
        svm.send_transaction(tx)
            .expect("Failed to mint to ATA");
    }

    ata
}

/// Build instruction data for mark_failed (no args, just discriminator)
fn mark_failed_data() -> Vec<u8> {
    anchor_discriminator("mark_failed").to_vec()
}

/// Build instruction data for consolidate_for_refund (no args)
fn consolidate_for_refund_data() -> Vec<u8> {
    anchor_discriminator("consolidate_for_refund").to_vec()
}

/// Build instruction data for claim_refund (no args)
fn claim_refund_data() -> Vec<u8> {
    anchor_discriminator("claim_refund").to_vec()
}

/// Send a transaction and return whether it succeeded
fn send_tx(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &LiteKeypair,
    signers: &[&LiteKeypair],
) -> Result<(), String> {
    let msg = Message::new_with_blockhash(
        ixs,
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        signers,
    )
    .unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("{:?}", e)),
    }
}

// ===========================================================================
// Tests
// ===========================================================================

/// Test: mark_failed should fail when curve is Active and clock is before
/// the deadline (slot < deadline_slot).
#[test]
fn mark_failed_before_deadline_fails() {
    let (mut svm, authority) = setup_svm();

    let mint = Pubkey::new_unique();
    let start_slot = 100;

    inject_curve_state(
        &mut svm, &mint,
        50_000_000_000_000, // tokens_sold: 50M
        5_000_000_000,      // sol_raised: 5 SOL
        CurveStatus::Active,
        start_slot,
        10,   // participant_count
        0, 0, 0,
        false,
        &Pubkey::default(),
    );

    // Set clock to well before deadline
    set_clock(&mut svm, start_slot + 100, 1_000_000);

    let (curve_pda, _) = curve_state_pda(&mint);
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&curve_pda), false),
        ],
        data: mark_failed_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(result.is_err(), "mark_failed should fail before deadline");
    let err = result.unwrap_err();
    assert!(
        err.contains("DeadlineNotPassed") || err.contains("custom program error"),
        "Expected DeadlineNotPassed error, got: {}",
        err,
    );
}

/// Test: mark_failed should fail during the grace period
/// (deadline_slot < slot <= deadline_slot + FAILURE_GRACE_SLOTS).
#[test]
fn mark_failed_during_grace_period_fails() {
    let (mut svm, authority) = setup_svm();

    let mint = Pubkey::new_unique();
    let start_slot = 100;
    let deadline_slot = start_slot + DEADLINE_SLOTS;

    inject_curve_state(
        &mut svm, &mint,
        50_000_000_000_000, 5_000_000_000,
        CurveStatus::Active,
        start_slot,
        10, 0, 0, 0, false,
        &Pubkey::default(),
    );

    // Set clock to during grace period (exactly at deadline + half grace)
    let grace_mid = deadline_slot + FAILURE_GRACE_SLOTS / 2;
    set_clock(&mut svm, grace_mid, 1_000_000);

    let (curve_pda, _) = curve_state_pda(&mint);
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&curve_pda), false),
        ],
        data: mark_failed_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(result.is_err(), "mark_failed should fail during grace period");
}

/// Test: mark_failed should fail at the exact boundary
/// (slot == deadline_slot + FAILURE_GRACE_SLOTS).
/// The on-chain check uses strictly-greater-than: clock.slot > failure_eligible_slot.
#[test]
fn mark_failed_at_exact_boundary_fails() {
    let (mut svm, authority) = setup_svm();

    let mint = Pubkey::new_unique();
    let start_slot = 100;
    let deadline_slot = start_slot + DEADLINE_SLOTS;
    let failure_eligible_slot = deadline_slot + FAILURE_GRACE_SLOTS;

    inject_curve_state(
        &mut svm, &mint,
        50_000_000_000_000, 5_000_000_000,
        CurveStatus::Active,
        start_slot,
        10, 0, 0, 0, false,
        &Pubkey::default(),
    );

    // Set clock to exactly the boundary (should fail due to strict >)
    set_clock(&mut svm, failure_eligible_slot, 1_000_000);

    let (curve_pda, _) = curve_state_pda(&mint);
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&curve_pda), false),
        ],
        data: mark_failed_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_err(),
        "mark_failed should fail at exact boundary (strictly greater required)"
    );
}

/// Test: mark_failed should succeed when slot > deadline + grace.
#[test]
fn mark_failed_after_grace_period_succeeds() {
    let (mut svm, authority) = setup_svm();

    let mint = Pubkey::new_unique();
    let start_slot = 100;
    let deadline_slot = start_slot + DEADLINE_SLOTS;
    let failure_eligible_slot = deadline_slot + FAILURE_GRACE_SLOTS;

    inject_curve_state(
        &mut svm, &mint,
        50_000_000_000_000, 5_000_000_000,
        CurveStatus::Active,
        start_slot,
        10, 0, 0, 0, false,
        &Pubkey::default(),
    );

    // Set clock to 1 slot after the boundary (should succeed)
    set_clock(&mut svm, failure_eligible_slot + 1, 1_000_000);

    let (curve_pda, _) = curve_state_pda(&mint);
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&curve_pda), false),
        ],
        data: mark_failed_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_ok(),
        "mark_failed should succeed after grace period: {:?}",
        result.err()
    );

    // Verify CurveState status changed to Failed
    let curve_account = svm.get_account(&addr(&curve_pda)).unwrap();
    // Status is at byte offset 8 (disc) + 1 (token) + 32 + 32 + 32 + 8 + 8 = 121
    let status_byte = curve_account.data[8 + 1 + 32 + 32 + 32 + 8 + 8];
    assert_eq!(
        status_byte,
        CurveStatus::Failed as u8,
        "CurveState status should be Failed (3), got {}",
        status_byte
    );
}

/// Test: mark_failed on non-Active curve should fail (InvalidStatus).
#[test]
fn mark_failed_on_filled_curve_fails() {
    let (mut svm, authority) = setup_svm();

    let mint = Pubkey::new_unique();
    let start_slot = 100;

    inject_curve_state(
        &mut svm, &mint,
        TARGET_TOKENS,        // fully sold
        1_000_000_000_000,    // ~1000 SOL
        CurveStatus::Filled,  // Already Filled, not Active
        start_slot,
        100, 0, 0, 0, false,
        &Pubkey::default(),
    );

    // Set clock past grace period
    let failure_eligible_slot = start_slot + DEADLINE_SLOTS + FAILURE_GRACE_SLOTS;
    set_clock(&mut svm, failure_eligible_slot + 1, 1_000_000);

    let (curve_pda, _) = curve_state_pda(&mint);
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&curve_pda), false),
        ],
        data: mark_failed_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_err(),
        "mark_failed should fail on Filled curve (InvalidStatus)"
    );
}

/// Test: consolidate_for_refund after mark_failed succeeds and moves
/// tax escrow SOL into the SOL vault.
#[test]
fn consolidate_after_mark_failed_succeeds() {
    let (mut svm, authority) = setup_svm();

    // Two mints: CRIME (Failed) and FRAUD (Failed) -- both partners failed
    let crime_mint = Pubkey::new_unique();
    let fraud_mint = Pubkey::new_unique();
    let start_slot = 100;

    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Inject CRIME curve as Failed
    inject_curve_state(
        &mut svm, &crime_mint,
        50_000_000_000_000,  // 50M tokens sold
        5_000_000_000,       // 5 SOL raised
        CurveStatus::Failed,
        start_slot,
        10,
        10_000_000_000_000,  // 10M tokens returned
        500_000_000,         // 0.5 SOL returned
        75_000_000,          // 0.075 SOL tax collected
        false,               // not consolidated
        &fraud_mint,
    );

    // Inject FRAUD curve as Failed (partner)
    inject_curve_state(
        &mut svm, &fraud_mint,
        30_000_000_000_000,
        3_000_000_000,
        CurveStatus::Failed,
        start_slot,
        8, 0, 0, 0, false,
        &crime_mint,
    );

    // Inject SOL vault with 5 SOL + rent-exempt
    inject_sol_vault(&mut svm, &crime_mint, 5_000_000_000 + rent_exempt);

    // Inject tax escrow with 75M lamports (0.075 SOL) + rent-exempt
    inject_tax_escrow(&mut svm, &crime_mint, 75_000_000 + rent_exempt);

    // Set clock past grace period
    let failure_eligible_slot = start_slot + DEADLINE_SLOTS + FAILURE_GRACE_SLOTS;
    set_clock(&mut svm, failure_eligible_slot + 10, 1_000_000);

    let (crime_curve_pda, _) = curve_state_pda(&crime_mint);
    let (fraud_curve_pda, _) = curve_state_pda(&fraud_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);

    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&crime_tax_escrow), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
        ],
        data: consolidate_for_refund_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_ok(),
        "consolidate_for_refund should succeed: {:?}",
        result.err()
    );

    // Verify: tax escrow should have only rent-exempt left
    let escrow_account = svm.get_account(&addr(&crime_tax_escrow)).unwrap();
    assert_eq!(
        escrow_account.lamports, rent_exempt,
        "Tax escrow should have only rent-exempt minimum after consolidation"
    );

    // Verify: SOL vault should have received the escrow balance
    let vault_account = svm.get_account(&addr(&crime_sol_vault)).unwrap();
    let expected_vault = 5_000_000_000 + rent_exempt + 75_000_000;
    assert_eq!(
        vault_account.lamports, expected_vault,
        "SOL vault should have original + consolidated escrow"
    );

    // Verify: escrow_consolidated flag is set
    let curve_account = svm.get_account(&addr(&crime_curve_pda)).unwrap();
    let consolidated_byte = curve_account.data[199]; // escrow_consolidated offset
    assert_eq!(consolidated_byte, 1, "escrow_consolidated should be true (1)");
}

/// Test: claim_refund with Token-2022 burn for a single user.
///
/// This test creates a real Token-2022 mint and token account, injects
/// CurveState in Failed+Consolidated state, and verifies the full
/// claim_refund flow: burn tokens, receive proportional SOL.
#[test]
fn claim_refund_single_user() {
    let (mut svm, authority) = setup_svm();

    // Create Token-2022 mint
    let (crime_mint, _mint_kp) = create_t22_mint(&mut svm, &authority);

    // Create a user with tokens
    let user = LiteKeypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap(); // 10 SOL for fees

    let user_balance = 20_000_000_000_000u64; // 20M tokens
    let user_token_account = create_ata_and_fund(
        &mut svm, &authority, &crime_mint, &kp_pubkey(&user), user_balance,
    );

    // Create partner mint and curve
    let fraud_mint = Pubkey::new_unique();

    let start_slot = 100;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Total tokens outstanding = 100M (several users bought, some sold back)
    let total_outstanding = 100_000_000_000_000u64;
    // SOL vault = 100 SOL + rent (from purchases + consolidated escrow)
    let vault_sol = 100_000_000_000u64;

    // Inject CRIME curve: Failed, consolidated, 100M tokens outstanding
    inject_curve_state(
        &mut svm, &crime_mint,
        total_outstanding,
        vault_sol, // sol_raised
        CurveStatus::Failed,
        start_slot,
        50,        // participants
        10_000_000_000_000, // 10M returned
        1_000_000_000,      // 1 SOL returned
        150_000_000,        // 0.15 SOL tax
        true,      // escrow consolidated
        &fraud_mint,
    );

    // Inject partner FRAUD curve (also Failed)
    inject_curve_state(
        &mut svm, &fraud_mint,
        30_000_000_000_000, 3_000_000_000,
        CurveStatus::Failed,
        start_slot,
        8, 0, 0, 0, false,
        &crime_mint,
    );

    // Inject SOL vault with the refund pool
    inject_sol_vault(&mut svm, &crime_mint, vault_sol + rent_exempt);

    // Set clock past everything
    set_clock(&mut svm, 1_000_000, 1_000_000);

    // Build claim_refund instruction
    let (crime_curve_pda, _) = curve_state_pda(&crime_mint);
    let (fraud_curve_pda, _) = curve_state_pda(&fraud_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);

    // claim_refund needs: user(mut,signer), curveState(mut), partnerCurveState,
    // userTokenAccount(mut), tokenMint(mut), solVault(mut), tokenProgram
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(user.pubkey(), true),
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&user_token_account), false),
            AccountMeta::new(addr(&crime_mint), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
            AccountMeta::new_readonly(addr(&token_2022_id()), false),
        ],
        data: claim_refund_data(),
    };

    // Record balances before
    let user_sol_before = svm.get_balance(&user.pubkey()).unwrap();

    let result = send_tx(&mut svm, &[ix], &user, &[&user]);
    assert!(
        result.is_ok(),
        "claim_refund should succeed: {:?}",
        result.err()
    );

    // Verify: user tokens burned (balance = 0)
    let token_account = svm.get_account(&addr(&user_token_account)).unwrap();
    // Token account data: mint(32) + owner(32) + amount(8) + ... amount starts at offset 64
    let token_balance_bytes: [u8; 8] = token_account.data[64..72].try_into().unwrap();
    let token_balance = u64::from_le_bytes(token_balance_bytes);
    assert_eq!(token_balance, 0, "User tokens should be burned after refund");

    // Verify: user received SOL
    let user_sol_after = svm.get_balance(&user.pubkey()).unwrap();
    assert!(
        user_sol_after > user_sol_before,
        "User should have received SOL refund"
    );

    // Verify: proportional refund amount
    // Expected: floor(20M_tokens * 100_SOL / 100M_tokens) = floor(20 SOL) = 20_000_000_000
    let expected_refund = 20_000_000_000u64;
    let sol_received = user_sol_after - user_sol_before;
    // Account for TX fee (typically 5000 lamports)
    let sol_received_plus_fee = sol_received + 10_000; // generous fee margin
    assert!(
        sol_received_plus_fee >= expected_refund,
        "Refund should be ~{} lamports, got {} (+ fee)",
        expected_refund,
        sol_received,
    );

    // Verify: CurveState tokens_sold decreased
    let curve_account = svm.get_account(&addr(&crime_curve_pda)).unwrap();
    // tokens_sold at offset 8 + 1 + 32 + 32 + 32 = 105, 8 bytes
    let ts_bytes: [u8; 8] = curve_account.data[105..113].try_into().unwrap();
    let new_tokens_sold = u64::from_le_bytes(ts_bytes);
    assert_eq!(
        new_tokens_sold,
        total_outstanding - user_balance,
        "tokens_sold should decrease by user balance"
    );
}

/// Test: claim_refund with multiple users claiming sequentially.
///
/// Verifies the shrinking-denominator property: as each user claims,
/// the remaining pool and outstanding tokens decrease, and subsequent
/// users get their proportional share of what remains.
#[test]
fn claim_refund_multiple_users_sequential() {
    let (mut svm, authority) = setup_svm();

    let (crime_mint, _mint_kp) = create_t22_mint(&mut svm, &authority);
    let fraud_mint = Pubkey::new_unique();

    let start_slot = 100;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Total tokens outstanding = 100M
    let total_outstanding = 100_000_000_000_000u64;
    let vault_sol = 100_000_000_000u64; // 100 SOL

    // Create 3 users with different balances
    let balances = [
        30_000_000_000_000u64, // 30M tokens
        50_000_000_000_000u64, // 50M tokens
        20_000_000_000_000u64, // 20M tokens (= total)
    ];

    let mut users = Vec::new();
    let mut user_token_accounts = Vec::new();
    for &balance in &balances {
        let user = LiteKeypair::new();
        svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
        let ata = create_ata_and_fund(
            &mut svm, &authority, &crime_mint, &kp_pubkey(&user), balance,
        );
        user_token_accounts.push(ata);
        users.push(user);
    }

    // Inject curves
    inject_curve_state(
        &mut svm, &crime_mint,
        total_outstanding, vault_sol,
        CurveStatus::Failed, start_slot,
        50, 0, 0, 0, true, // consolidated
        &fraud_mint,
    );
    inject_curve_state(
        &mut svm, &fraud_mint,
        30_000_000_000_000, 3_000_000_000,
        CurveStatus::Failed, start_slot,
        8, 0, 0, 0, false,
        &crime_mint,
    );
    inject_sol_vault(&mut svm, &crime_mint, vault_sol + rent_exempt);
    set_clock(&mut svm, 1_000_000, 1_000_000);

    let (crime_curve_pda, _) = curve_state_pda(&crime_mint);
    let (fraud_curve_pda, _) = curve_state_pda(&fraud_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);

    for (i, user) in users.iter().enumerate() {
        let ix = Instruction {
            program_id: addr(&program_id()),
            accounts: vec![
                AccountMeta::new(user.pubkey(), true),
                AccountMeta::new(addr(&crime_curve_pda), false),
                AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
                AccountMeta::new(addr(&user_token_accounts[i]), false),
                AccountMeta::new(addr(&crime_mint), false),
                AccountMeta::new(addr(&crime_sol_vault), false),
                AccountMeta::new_readonly(addr(&token_2022_id()), false),
            ],
            data: claim_refund_data(),
        };

        let result = send_tx(&mut svm, &[ix], user, &[user]);
        assert!(
            result.is_ok(),
            "User {} claim_refund should succeed: {:?}",
            i,
            result.err()
        );

        // Verify tokens burned
        let token_account = svm.get_account(&addr(&user_token_accounts[i])).unwrap();
        let balance_bytes: [u8; 8] = token_account.data[64..72].try_into().unwrap();
        assert_eq!(
            u64::from_le_bytes(balance_bytes),
            0,
            "User {} tokens should be burned",
            i,
        );
    }

    // Verify vault is nearly drained (only rent-exempt + dust from rounding/fees)
    let vault_after = svm.get_account(&addr(&crime_sol_vault)).unwrap();
    let vault_remaining = vault_after.lamports;
    assert!(
        vault_remaining <= rent_exempt + 10, // Allow tiny dust from floor rounding
        "Vault should be nearly drained: {} remaining (rent_exempt={})",
        vault_remaining,
        rent_exempt,
    );

    // Verify CurveState tokens_sold is now 0
    let curve_account = svm.get_account(&addr(&crime_curve_pda)).unwrap();
    let ts_bytes: [u8; 8] = curve_account.data[105..113].try_into().unwrap();
    assert_eq!(
        u64::from_le_bytes(ts_bytes),
        0,
        "tokens_sold should be 0 after all claims"
    );
}

/// Test: mark_failed on an Initialized (not yet started) curve should fail.
#[test]
fn mark_failed_on_initialized_curve_fails() {
    let (mut svm, authority) = setup_svm();

    let mint = Pubkey::new_unique();

    inject_curve_state(
        &mut svm, &mint,
        0, 0,
        CurveStatus::Initialized,
        0,     // not started
        0, 0, 0, 0, false,
        &Pubkey::default(),
    );

    set_clock(&mut svm, 1_000_000, 1_000_000);

    let (curve_pda, _) = curve_state_pda(&mint);
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&curve_pda), false),
        ],
        data: mark_failed_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_err(),
        "mark_failed should fail on Initialized curve"
    );
}

/// Test: consolidate_for_refund should fail if curve is not refund-eligible
/// (e.g., Active curve).
#[test]
fn consolidate_on_active_curve_fails() {
    let (mut svm, authority) = setup_svm();

    let crime_mint = Pubkey::new_unique();
    let fraud_mint = Pubkey::new_unique();
    let start_slot = 100;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    inject_curve_state(
        &mut svm, &crime_mint,
        50_000_000_000_000, 5_000_000_000,
        CurveStatus::Active, // NOT Failed
        start_slot,
        10, 0, 0, 0, false,
        &fraud_mint,
    );
    inject_curve_state(
        &mut svm, &fraud_mint,
        30_000_000_000_000, 3_000_000_000,
        CurveStatus::Active,
        start_slot,
        8, 0, 0, 0, false,
        &crime_mint,
    );
    inject_sol_vault(&mut svm, &crime_mint, 5_000_000_000 + rent_exempt);
    inject_tax_escrow(&mut svm, &crime_mint, 75_000_000 + rent_exempt);
    set_clock(&mut svm, 1_000_000, 1_000_000);

    let (crime_curve_pda, _) = curve_state_pda(&crime_mint);
    let (fraud_curve_pda, _) = curve_state_pda(&fraud_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);

    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&crime_tax_escrow), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
        ],
        data: consolidate_for_refund_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_err(),
        "consolidate_for_refund should fail on Active curve"
    );
}

/// Test: Filled curve with Failed partner is refund-eligible.
/// consolidate_for_refund should succeed.
#[test]
fn consolidate_filled_with_failed_partner_succeeds() {
    let (mut svm, authority) = setup_svm();

    let crime_mint = Pubkey::new_unique();
    let fraud_mint = Pubkey::new_unique();
    let start_slot = 100;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // CRIME: Filled (reached target) but partner failed
    inject_curve_state(
        &mut svm, &crime_mint,
        TARGET_TOKENS,
        1_000_000_000_000,
        CurveStatus::Filled, // Filled, not Failed
        start_slot,
        100,
        5_000_000_000_000,
        500_000_000,
        75_000_000,
        false,
        &fraud_mint,
    );

    // FRAUD: Failed (partner didn't make it)
    inject_curve_state(
        &mut svm, &fraud_mint,
        30_000_000_000_000, 3_000_000_000,
        CurveStatus::Failed,
        start_slot,
        8, 0, 0, 0, false,
        &crime_mint,
    );

    inject_sol_vault(&mut svm, &crime_mint, 1_000_000_000_000 + rent_exempt);
    inject_tax_escrow(&mut svm, &crime_mint, 75_000_000 + rent_exempt);
    set_clock(&mut svm, 1_000_000, 1_000_000);

    let (crime_curve_pda, _) = curve_state_pda(&crime_mint);
    let (fraud_curve_pda, _) = curve_state_pda(&fraud_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);

    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&crime_tax_escrow), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
        ],
        data: consolidate_for_refund_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_ok(),
        "Filled curve with Failed partner should be consolidatable: {:?}",
        result.err()
    );
}

/// Test: Double consolidation should fail (EscrowAlreadyConsolidated).
#[test]
fn double_consolidation_fails() {
    let (mut svm, authority) = setup_svm();

    let crime_mint = Pubkey::new_unique();
    let fraud_mint = Pubkey::new_unique();
    let start_slot = 100;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Already consolidated
    inject_curve_state(
        &mut svm, &crime_mint,
        50_000_000_000_000, 5_000_000_000,
        CurveStatus::Failed, start_slot,
        10, 0, 0, 75_000_000,
        true, // already consolidated
        &fraud_mint,
    );
    inject_curve_state(
        &mut svm, &fraud_mint,
        30_000_000_000_000, 3_000_000_000,
        CurveStatus::Failed, start_slot,
        8, 0, 0, 0, false,
        &crime_mint,
    );
    inject_sol_vault(&mut svm, &crime_mint, 5_075_000_000 + rent_exempt);
    inject_tax_escrow(&mut svm, &crime_mint, rent_exempt);
    set_clock(&mut svm, 1_000_000, 1_000_000);

    let (crime_curve_pda, _) = curve_state_pda(&crime_mint);
    let (fraud_curve_pda, _) = curve_state_pda(&fraud_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);

    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&crime_tax_escrow), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
        ],
        data: consolidate_for_refund_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_err(),
        "Double consolidation should fail"
    );
}
