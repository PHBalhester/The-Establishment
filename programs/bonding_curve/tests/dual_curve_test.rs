//! LiteSVM Dual-Curve Integration Tests
//!
//! Tests bonding curve dual-curve scenarios that require both CRIME and
//! FRAUD curves to be present:
//!
//! - TEST-01: One curve fills, other fails, prepare_transition rejects
//! - TEST-02: Purchase during grace period returns DeadlinePassed
//! - TEST-03: Multiple refund claimants complete lifecycle
//! - TEST-04: Vault solvency breach triggers VaultInsolvency
//!
//! These complement the refund_clock_test.rs tests which focus on single-
//! curve clock-dependent behavior. These add dual-curve interaction coverage.
//!
//! Source: .planning/phases/86-test-coverage-sweep/86-01-PLAN.md

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

const BC_ADMIN_SEED: &[u8] = b"bc_admin";
const CURVE_SEED: &[u8] = b"curve";
const CURVE_TOKEN_VAULT_SEED: &[u8] = b"curve_token_vault";
const CURVE_SOL_VAULT_SEED: &[u8] = b"curve_sol_vault";
const TAX_ESCROW_SEED: &[u8] = b"tax_escrow";

/// Production DEADLINE_SLOTS (432,000) -- LiteSVM gives full clock control.
const DEADLINE_SLOTS: u64 = 432_000;
const FAILURE_GRACE_SLOTS: u64 = 150;
const TARGET_TOKENS: u64 = 460_000_000_000_000;
const TOKEN_DECIMALS: u8 = 6;
const MIN_PURCHASE_SOL: u64 = 50_000_000; // 0.05 SOL
#[allow(dead_code)]
const SELL_TAX_BPS: u64 = 1_500;
#[allow(dead_code)]
const BPS_DENOMINATOR: u64 = 10_000;

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

fn bc_admin_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[BC_ADMIN_SEED], &program_id())
}

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
fn set_clock(svm: &mut LiteSVM, slot: u64, unix_timestamp: i64) {
    let clock_addr: Address = addr(
        &"SysvarC1ock11111111111111111111111111111111"
            .parse::<Pubkey>()
            .unwrap(),
    );

    let mut data = vec![0u8; 40];
    data[0..8].copy_from_slice(&slot.to_le_bytes());
    data[8..16].copy_from_slice(&unix_timestamp.to_le_bytes());
    data[16..24].copy_from_slice(&0u64.to_le_bytes());
    data[24..32].copy_from_slice(&0u64.to_le_bytes());
    data[32..40].copy_from_slice(&unix_timestamp.to_le_bytes());

    let sysvar_owner: Address = addr(
        &"Sysvar1111111111111111111111111111111111111"
            .parse::<Pubkey>()
            .unwrap(),
    );

    svm.set_account(
        clock_addr,
        Account {
            lamports: 1_009_200,
            data,
            owner: sysvar_owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to set Clock sysvar");
}

// ---------------------------------------------------------------------------
// CurveState serialization (includes partner_mint field)
// ---------------------------------------------------------------------------

/// CurveStatus enum variants (matching on-chain state.rs)
#[repr(u8)]
#[derive(Clone, Copy)]
#[allow(dead_code)]
enum CurveStatus {
    Initialized = 0,
    Active = 1,
    Filled = 2,
    Failed = 3,
    Graduated = 4,
}

/// Token enum variants
#[repr(u8)]
#[derive(Clone, Copy)]
enum TokenKind {
    Crime = 0,
    Fraud = 1,
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
///  32 bytes: partner_mint
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

/// Serialize a BcAdminConfig account for direct injection into LiteSVM.
///
/// Layout: 8 (discriminator) + 32 (authority) + 1 (bump) = 41 bytes
fn serialize_bc_admin_config(authority: &Pubkey, bump: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(41);

    let mut hasher = Sha256::new();
    hasher.update("account:BcAdminConfig");
    let hash = hasher.finalize();
    data.extend_from_slice(&hash[..8]);

    data.extend_from_slice(authority.as_ref());
    data.push(bump);

    assert_eq!(data.len(), 41, "BcAdminConfig must be exactly 41 bytes");
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

// ---------------------------------------------------------------------------
// Account injection helpers
// ---------------------------------------------------------------------------

/// Accounts returned from setup_dual_curves() for use in tests.
#[allow(dead_code)]
struct DualCurveSetup {
    crime_mint: Pubkey,
    fraud_mint: Pubkey,
    crime_curve_pda: Pubkey,
    fraud_curve_pda: Pubkey,
    crime_sol_vault: Pubkey,
    fraud_sol_vault: Pubkey,
    crime_tax_escrow: Pubkey,
    fraud_tax_escrow: Pubkey,
    start_slot: u64,
}

/// Configuration for pre-filling curves to specific levels.
struct CurveConfig {
    crime_tokens_sold: u64,
    crime_sol_raised: u64,
    crime_status: CurveStatus,
    fraud_tokens_sold: u64,
    fraud_sol_raised: u64,
    fraud_status: CurveStatus,
    /// If true, set escrow_consolidated on both curves
    consolidated: bool,
}

impl Default for CurveConfig {
    fn default() -> Self {
        Self {
            crime_tokens_sold: 50_000_000_000_000,  // 50M tokens
            crime_sol_raised: 5_000_000_000,          // 5 SOL
            crime_status: CurveStatus::Active,
            fraud_tokens_sold: 30_000_000_000_000,  // 30M tokens
            fraud_sol_raised: 3_000_000_000,          // 3 SOL
            fraud_status: CurveStatus::Active,
            consolidated: false,
        }
    }
}

/// Set up two linked curves (CRIME and FRAUD) with partner_mint pointing
/// at each other. Injects CurveState PDAs, SOL vaults, and tax escrows.
fn setup_dual_curves(
    svm: &mut LiteSVM,
    _authority: &LiteKeypair,
    config: CurveConfig,
) -> DualCurveSetup {
    let crime_mint = Pubkey::new_unique();
    let fraud_mint = Pubkey::new_unique();
    let start_slot = 100;

    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Derive PDAs
    let (crime_curve_pda, crime_bump) = curve_state_pda(&crime_mint);
    let (crime_token_vault, _) = token_vault_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);

    let (fraud_curve_pda, fraud_bump) = curve_state_pda(&fraud_mint);
    let (fraud_token_vault, _) = token_vault_pda(&fraud_mint);
    let (fraud_sol_vault, _) = sol_vault_pda(&fraud_mint);
    let (fraud_tax_escrow, _) = tax_escrow_pda(&fraud_mint);

    let deadline_slot = start_slot + DEADLINE_SLOTS;

    // Inject CRIME curve with partner_mint = fraud_mint
    let crime_data = serialize_curve_state(
        TokenKind::Crime,
        &crime_mint,
        &crime_token_vault,
        &crime_sol_vault,
        config.crime_tokens_sold,
        config.crime_sol_raised,
        config.crime_status,
        start_slot,
        deadline_slot,
        10,
        0, 0, 0,
        &crime_tax_escrow,
        crime_bump,
        config.consolidated,
        &fraud_mint, // partner_mint
    );

    let crime_lamports = rent.minimum_balance(crime_data.len());
    svm.set_account(
        addr(&crime_curve_pda),
        Account {
            lamports: crime_lamports,
            data: crime_data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CRIME CurveState");

    // Inject FRAUD curve with partner_mint = crime_mint
    let fraud_data = serialize_curve_state(
        TokenKind::Fraud,
        &fraud_mint,
        &fraud_token_vault,
        &fraud_sol_vault,
        config.fraud_tokens_sold,
        config.fraud_sol_raised,
        config.fraud_status,
        start_slot,
        deadline_slot,
        8,
        0, 0, 0,
        &fraud_tax_escrow,
        fraud_bump,
        config.consolidated,
        &crime_mint, // partner_mint
    );

    let fraud_lamports = rent.minimum_balance(fraud_data.len());
    svm.set_account(
        addr(&fraud_curve_pda),
        Account {
            lamports: fraud_lamports,
            data: fraud_data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject FRAUD CurveState");

    // Inject SOL vaults
    svm.set_account(
        addr(&crime_sol_vault),
        Account {
            lamports: config.crime_sol_raised + rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CRIME SOL vault");

    svm.set_account(
        addr(&fraud_sol_vault),
        Account {
            lamports: config.fraud_sol_raised + rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject FRAUD SOL vault");

    // Inject tax escrows (at rent-exempt minimum -- no sells have happened)
    svm.set_account(
        addr(&crime_tax_escrow),
        Account {
            lamports: rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CRIME tax escrow");

    svm.set_account(
        addr(&fraud_tax_escrow),
        Account {
            lamports: rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject FRAUD tax escrow");

    // Set clock to a reasonable slot (before deadline)
    set_clock(svm, start_slot + 100, 1_000_000);

    DualCurveSetup {
        crime_mint,
        fraud_mint,
        crime_curve_pda,
        fraud_curve_pda,
        crime_sol_vault,
        fraud_sol_vault,
        crime_tax_escrow,
        fraud_tax_escrow,
        start_slot,
    }
}

/// Inject a BcAdminConfig PDA with the given authority.
fn inject_admin_config(svm: &mut LiteSVM, authority_pk: &Pubkey) {
    let (admin_pda, bump) = bc_admin_pda();
    let data = serialize_bc_admin_config(authority_pk, bump);

    let rent = solana_sdk::rent::Rent::default();
    let lamports = rent.minimum_balance(data.len());

    svm.set_account(
        addr(&admin_pda),
        Account {
            lamports,
            data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject BcAdminConfig");
}

// ---------------------------------------------------------------------------
// Token helpers (same pattern as refund_clock_test.rs)
// ---------------------------------------------------------------------------

/// Create a Token-2022 mint account in LiteSVM.
fn create_t22_mint(svm: &mut LiteSVM, authority: &LiteKeypair) -> (Pubkey, LiteKeypair) {
    let mint_kp = LiteKeypair::new();
    let mint_pk = kp_pubkey(&mint_kp);
    let mint_addr = mint_kp.pubkey();

    let space = spl_token_2022::state::Mint::LEN;
    let rent = solana_sdk::rent::Rent::default();
    let lamports = rent.minimum_balance(space);

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

/// Derive ATA address for a given owner + mint (Token-2022).
fn derive_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address_with_program_id(
        owner,
        mint,
        &token_2022_id(),
    )
}

/// Create an ATA for Token-2022 and mint tokens into it.
fn create_ata_and_fund(
    svm: &mut LiteSVM,
    payer: &LiteKeypair,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> Pubkey {
    let ata = derive_ata(owner, mint);

    let create_ata_ix = spl_associated_token_account::instruction::create_associated_token_account(
        &kp_pubkey(payer),
        owner,
        mint,
        &token_2022_id(),
    );

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

// ---------------------------------------------------------------------------
// Instruction data builders
// ---------------------------------------------------------------------------

fn prepare_transition_data() -> Vec<u8> {
    anchor_discriminator("prepare_transition").to_vec()
}

fn purchase_data(sol_amount: u64, minimum_tokens_out: u64) -> Vec<u8> {
    let mut data = anchor_discriminator("purchase").to_vec();
    data.extend_from_slice(&sol_amount.to_le_bytes());
    data.extend_from_slice(&minimum_tokens_out.to_le_bytes());
    data
}

fn sell_data(tokens_to_sell: u64, minimum_sol_out: u64) -> Vec<u8> {
    let mut data = anchor_discriminator("sell").to_vec();
    data.extend_from_slice(&tokens_to_sell.to_le_bytes());
    data.extend_from_slice(&minimum_sol_out.to_le_bytes());
    data
}

fn mark_failed_data() -> Vec<u8> {
    anchor_discriminator("mark_failed").to_vec()
}

fn consolidate_for_refund_data() -> Vec<u8> {
    anchor_discriminator("consolidate_for_refund").to_vec()
}

fn claim_refund_data() -> Vec<u8> {
    anchor_discriminator("claim_refund").to_vec()
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

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
// TEST-01: One curve fills, other fails, prepare_transition rejects
// ===========================================================================

/// Verifies that prepare_transition rejects when only CRIME is Filled
/// but FRAUD is still Active (unfilled). The on-chain constraint requires
/// BOTH curves to be in Filled status before graduation can proceed.
#[test]
fn test_one_curve_fills_other_fails_prepare_transition_rejects() {
    let (mut svm, authority) = setup_svm();

    // Inject BcAdminConfig PDA so prepare_transition can validate authority
    let authority_pk = kp_pubkey(&authority);
    inject_admin_config(&mut svm, &authority_pk);

    // Set up dual curves: CRIME fully filled, FRAUD partially filled
    let setup = setup_dual_curves(
        &mut svm,
        &authority,
        CurveConfig {
            crime_tokens_sold: TARGET_TOKENS,        // Fully filled
            crime_sol_raised: 1_000_000_000_000,       // ~1000 SOL
            crime_status: CurveStatus::Filled,
            fraud_tokens_sold: 30_000_000_000_000,   // Only 30M (not filled)
            fraud_sol_raised: 3_000_000_000,           // 3 SOL
            fraud_status: CurveStatus::Active,         // Still Active, not Filled
            consolidated: false,
        },
    );

    let (admin_pda, _) = bc_admin_pda();

    // Build prepare_transition instruction
    // Accounts: authority(signer), admin_config, crime_curve_state(mut), fraud_curve_state(mut)
    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new_readonly(authority.pubkey(), true),  // authority (signer)
            AccountMeta::new_readonly(addr(&admin_pda), false),   // admin_config
            AccountMeta::new(addr(&setup.crime_curve_pda), false), // crime_curve_state
            AccountMeta::new(addr(&setup.fraud_curve_pda), false), // fraud_curve_state
        ],
        data: prepare_transition_data(),
    };

    let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
    assert!(
        result.is_err(),
        "prepare_transition should reject when FRAUD curve is not Filled"
    );
    let err = result.unwrap_err();
    // The on-chain error is FRAUDCurveNotFilled (error code)
    assert!(
        err.contains("FRAUDCurveNotFilled") || err.contains("custom program error"),
        "Expected FRAUDCurveNotFilled error, got: {}",
        err,
    );

    // Also test the reverse: FRAUD filled, CRIME not filled
    let (mut svm2, authority2) = setup_svm();
    let authority2_pk = kp_pubkey(&authority2);
    inject_admin_config(&mut svm2, &authority2_pk);

    let setup2 = setup_dual_curves(
        &mut svm2,
        &authority2,
        CurveConfig {
            crime_tokens_sold: 30_000_000_000_000,   // Not filled
            crime_sol_raised: 3_000_000_000,
            crime_status: CurveStatus::Active,
            fraud_tokens_sold: TARGET_TOKENS,          // Fully filled
            fraud_sol_raised: 1_000_000_000_000,
            fraud_status: CurveStatus::Filled,
            consolidated: false,
        },
    );

    let (admin_pda2, _) = bc_admin_pda();
    let ix2 = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new_readonly(authority2.pubkey(), true),
            AccountMeta::new_readonly(addr(&admin_pda2), false),
            AccountMeta::new(addr(&setup2.crime_curve_pda), false),
            AccountMeta::new(addr(&setup2.fraud_curve_pda), false),
        ],
        data: prepare_transition_data(),
    };

    let result2 = send_tx(&mut svm2, &[ix2], &authority2, &[&authority2]);
    assert!(
        result2.is_err(),
        "prepare_transition should reject when CRIME curve is not Filled"
    );
    let err2 = result2.unwrap_err();
    assert!(
        err2.contains("CRIMECurveNotFilled") || err2.contains("custom program error"),
        "Expected CRIMECurveNotFilled error, got: {}",
        err2,
    );
}

// ===========================================================================
// TEST-02: Purchase during grace period returns DeadlinePassed
// ===========================================================================

/// Verifies that purchase is rejected after the deadline slot, even during
/// the grace period. The purchase instruction checks `clock.slot <= deadline_slot`
/// (i.e., slot must be AT or BEFORE deadline). After the deadline, purchases
/// are blocked even though mark_failed hasn't been called yet.
///
/// Also verifies the exact boundary: at deadline_slot+1, purchase fails.
#[test]
fn test_purchase_during_grace_period_deadline_passed() {
    let (mut svm, authority) = setup_svm();

    // Create a real Token-2022 mint for this test (purchase needs real token operations)
    let (crime_mint, _mint_kp) = create_t22_mint(&mut svm, &authority);
    let fraud_mint = Pubkey::new_unique();

    let start_slot = 100;
    let deadline_slot = start_slot + DEADLINE_SLOTS;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Derive PDAs for CRIME
    let (crime_curve_pda, crime_bump) = curve_state_pda(&crime_mint);
    let (crime_token_vault, _) = token_vault_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);

    // Inject CRIME curve as Active with some tokens sold
    let crime_data = serialize_curve_state(
        TokenKind::Crime,
        &crime_mint,
        &crime_token_vault,
        &crime_sol_vault,
        50_000_000_000_000,  // 50M tokens sold
        5_000_000_000,        // 5 SOL raised
        CurveStatus::Active,
        start_slot,
        deadline_slot,
        10,
        0, 0, 0,
        &crime_tax_escrow,
        crime_bump,
        false,
        &fraud_mint,
    );

    let lamports = rent.minimum_balance(crime_data.len());
    svm.set_account(
        addr(&crime_curve_pda),
        Account {
            lamports,
            data: crime_data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CRIME CurveState");

    // Inject SOL vault
    svm.set_account(
        addr(&crime_sol_vault),
        Account {
            lamports: 5_000_000_000 + rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject SOL vault");

    // Create a token vault with tokens for the curve to sell from
    // We need a real Token-2022 account at the token_vault PDA address
    let vault_space = spl_token_2022::state::Account::LEN;
    let vault_lamports = rent.minimum_balance(vault_space);
    let mut vault_data = vec![0u8; vault_space];
    // Manually build Token-2022 account state:
    // mint (32) | owner (32) | amount (8) | delegate (36: 4 option + 32) | state (1) | ...
    vault_data[0..32].copy_from_slice(crime_mint.as_ref());       // mint
    vault_data[32..64].copy_from_slice(crime_curve_pda.as_ref()); // owner = curve_state PDA
    let vault_tokens = 400_000_000_000_000u64; // 400M remaining tokens
    vault_data[64..72].copy_from_slice(&vault_tokens.to_le_bytes()); // amount
    // delegate: None (COption = 0u32)
    vault_data[72..76].copy_from_slice(&0u32.to_le_bytes());
    // state: Initialized = 1
    vault_data[108] = 1;
    // is_native: None (COption = 0u32)
    vault_data[109..113].copy_from_slice(&0u32.to_le_bytes());

    svm.set_account(
        addr(&crime_token_vault),
        Account {
            lamports: vault_lamports,
            data: vault_data,
            owner: addr(&token_2022_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject token vault");

    // Create a buyer
    let buyer = LiteKeypair::new();
    svm.airdrop(&buyer.pubkey(), 10_000_000_000).unwrap(); // 10 SOL
    let buyer_pk = kp_pubkey(&buyer);
    let buyer_ata = derive_ata(&buyer_pk, &crime_mint);

    // Test 1: Set clock to during grace period (deadline + 75 slots)
    let grace_mid = deadline_slot + FAILURE_GRACE_SLOTS / 2;
    set_clock(&mut svm, grace_mid, 1_000_000);

    // Purchase instruction accounts:
    // user(mut,signer), curve_state(mut), user_token_account(mut),
    // token_vault(mut), sol_vault(mut), token_mint, token_program,
    // associated_token_program, system_program
    // + 4 remaining_accounts for Transfer Hook (but we'll use 4 dummy accounts)
    //
    // Actually, the purchase will fail at the deadline check BEFORE any token
    // operations, so the remaining_accounts don't need to be real hook accounts.
    // But Anchor will still try to deserialize the ATA. For purchase, the ATA
    // is init_if_needed, so we need the full account set.
    let ata_program_id: Pubkey = spl_associated_token_account::id();

    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(buyer.pubkey(), true),                  // user
            AccountMeta::new(addr(&crime_curve_pda), false),         // curve_state
            AccountMeta::new(addr(&buyer_ata), false),               // user_token_account
            AccountMeta::new(addr(&crime_token_vault), false),       // token_vault
            AccountMeta::new(addr(&crime_sol_vault), false),         // sol_vault
            AccountMeta::new_readonly(addr(&crime_mint), false),     // token_mint
            AccountMeta::new_readonly(addr(&token_2022_id()), false), // token_program
            AccountMeta::new_readonly(addr(&ata_program_id), false), // associated_token_program
            AccountMeta::new_readonly(addr(&system_program_id()), false), // system_program
        ],
        data: purchase_data(MIN_PURCHASE_SOL, 0), // Buy minimum, accept any slippage
    };

    let result = send_tx(&mut svm, &[ix.clone()], &buyer, &[&buyer]);
    assert!(
        result.is_err(),
        "Purchase should fail during grace period (past deadline)"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("DeadlinePassed") || err.contains("custom program error"),
        "Expected DeadlinePassed error, got: {}",
        err,
    );

    // Test 2: At exact deadline boundary (slot == deadline_slot)
    // purchase checks: clock.slot <= curve.deadline_slot
    // So at exact deadline_slot, purchase should SUCCEED (<=)
    // But at deadline_slot + 1, it should fail
    set_clock(&mut svm, deadline_slot + 1, 1_000_000);

    let ix2 = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(buyer.pubkey(), true),
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new(addr(&buyer_ata), false),
            AccountMeta::new(addr(&crime_token_vault), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
            AccountMeta::new_readonly(addr(&crime_mint), false),
            AccountMeta::new_readonly(addr(&token_2022_id()), false),
            AccountMeta::new_readonly(addr(&ata_program_id), false),
            AccountMeta::new_readonly(addr(&system_program_id()), false),
        ],
        data: purchase_data(MIN_PURCHASE_SOL, 0),
    };

    let result2 = send_tx(&mut svm, &[ix2], &buyer, &[&buyer]);
    assert!(
        result2.is_err(),
        "Purchase should fail at deadline_slot + 1 (DeadlinePassed)"
    );
}

// ===========================================================================
// TEST-03: Multiple refund claimants complete lifecycle
// ===========================================================================

/// Verifies the full multi-user refund lifecycle:
/// 1. Three users purchase different amounts on one curve
/// 2. Clock warped past deadline + grace period
/// 3. mark_failed transitions curve to Failed
/// 4. consolidate_for_refund closes tax escrow into SOL vault
/// 5. Each of 3 users calls claim_refund and receives proportional SOL
/// 6. A 4th claim from an already-claimed user fails (NothingToBurn)
#[test]
fn test_multiple_refund_claimants_lifecycle() {
    let (mut svm, authority) = setup_svm();

    // Create real Token-2022 mints (claim_refund needs real burn operations)
    let (crime_mint, _crime_mint_kp) = create_t22_mint(&mut svm, &authority);
    let fraud_mint = Pubkey::new_unique();

    let start_slot = 100;
    let deadline_slot = start_slot + DEADLINE_SLOTS;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // User balances -- total = 100M tokens
    let user_balances = [
        30_000_000_000_000u64, // User 0: 30M tokens
        50_000_000_000_000u64, // User 1: 50M tokens
        20_000_000_000_000u64, // User 2: 20M tokens
    ];
    let total_outstanding: u64 = user_balances.iter().sum();
    let vault_sol = 100_000_000_000u64; // 100 SOL in vault
    let tax_collected = 15_000_000_000u64; // 15 SOL in tax escrow (15% of some sells)

    // Create users and fund their ATAs
    let mut users = Vec::new();
    let mut user_atas = Vec::new();
    for &balance in &user_balances {
        let user = LiteKeypair::new();
        svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap(); // 10 SOL for fees
        let ata = create_ata_and_fund(
            &mut svm, &authority, &crime_mint, &kp_pubkey(&user), balance,
        );
        user_atas.push(ata);
        users.push(user);
    }

    // Derive PDAs
    let (crime_curve_pda, crime_bump) = curve_state_pda(&crime_mint);
    let (crime_token_vault, _) = token_vault_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);

    let (fraud_curve_pda, fraud_bump) = curve_state_pda(&fraud_mint);
    let (fraud_token_vault, _) = token_vault_pda(&fraud_mint);
    let (fraud_sol_vault, _) = sol_vault_pda(&fraud_mint);
    let (fraud_tax_escrow, _) = tax_escrow_pda(&fraud_mint);

    // Inject CRIME curve: Active with the total tokens outstanding
    let crime_data = serialize_curve_state(
        TokenKind::Crime,
        &crime_mint,
        &crime_token_vault,
        &crime_sol_vault,
        total_outstanding,
        vault_sol,
        CurveStatus::Active,
        start_slot,
        deadline_slot,
        3,        // 3 participants
        0, 0,
        tax_collected,
        &crime_tax_escrow,
        crime_bump,
        false,    // not consolidated yet
        &fraud_mint,
    );
    svm.set_account(
        addr(&crime_curve_pda),
        Account {
            lamports: rent.minimum_balance(crime_data.len()),
            data: crime_data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CRIME CurveState");

    // Inject FRAUD curve: Active (also not filled -- partner)
    let fraud_data = serialize_curve_state(
        TokenKind::Fraud,
        &fraud_mint,
        &fraud_token_vault,
        &fraud_sol_vault,
        30_000_000_000_000,
        3_000_000_000,
        CurveStatus::Active,
        start_slot,
        deadline_slot,
        8,
        0, 0, 0,
        &fraud_tax_escrow,
        fraud_bump,
        false,
        &crime_mint,
    );
    svm.set_account(
        addr(&fraud_curve_pda),
        Account {
            lamports: rent.minimum_balance(fraud_data.len()),
            data: fraud_data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject FRAUD CurveState");

    // Inject SOL vault and tax escrow
    svm.set_account(
        addr(&crime_sol_vault),
        Account {
            lamports: vault_sol + rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject SOL vault");

    svm.set_account(
        addr(&crime_tax_escrow),
        Account {
            lamports: tax_collected + rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject tax escrow");

    // Also need FRAUD SOL vault and tax escrow
    svm.set_account(
        addr(&fraud_sol_vault),
        Account { lamports: rent_exempt, data: vec![], owner: addr(&program_id()), executable: false, rent_epoch: 0 },
    ).unwrap();
    svm.set_account(
        addr(&fraud_tax_escrow),
        Account { lamports: rent_exempt, data: vec![], owner: addr(&program_id()), executable: false, rent_epoch: 0 },
    ).unwrap();

    // -----------------------------------------------------------------------
    // Step 1: Warp clock past deadline + grace period
    // -----------------------------------------------------------------------
    let failure_eligible_slot = deadline_slot + FAILURE_GRACE_SLOTS;
    set_clock(&mut svm, failure_eligible_slot + 1, 1_000_000);

    // -----------------------------------------------------------------------
    // Step 2: mark_failed on CRIME curve
    // -----------------------------------------------------------------------
    let ix_mark = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&crime_curve_pda), false),
        ],
        data: mark_failed_data(),
    };
    let result = send_tx(&mut svm, &[ix_mark], &authority, &[&authority]);
    assert!(result.is_ok(), "mark_failed should succeed: {:?}", result.err());
    svm.expire_blockhash();

    // Also mark FRAUD as failed (needed for partner check in consolidate/claim)
    let ix_mark_fraud = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&fraud_curve_pda), false),
        ],
        data: mark_failed_data(),
    };
    let result = send_tx(&mut svm, &[ix_mark_fraud], &authority, &[&authority]);
    assert!(result.is_ok(), "mark_failed FRAUD should succeed: {:?}", result.err());
    svm.expire_blockhash();

    // -----------------------------------------------------------------------
    // Step 3: consolidate_for_refund on CRIME curve
    // -----------------------------------------------------------------------
    let ix_consolidate = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&crime_tax_escrow), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
        ],
        data: consolidate_for_refund_data(),
    };
    let result = send_tx(&mut svm, &[ix_consolidate], &authority, &[&authority]);
    assert!(result.is_ok(), "consolidate_for_refund should succeed: {:?}", result.err());
    svm.expire_blockhash();

    // Verify tax escrow was drained to rent-exempt
    let escrow_after = svm.get_account(&addr(&crime_tax_escrow)).unwrap();
    assert_eq!(
        escrow_after.lamports, rent_exempt,
        "Tax escrow should have only rent-exempt after consolidation"
    );

    // Verify SOL vault now has vault_sol + tax_collected + rent_exempt
    let vault_after = svm.get_account(&addr(&crime_sol_vault)).unwrap();
    let expected_vault = vault_sol + rent_exempt + tax_collected;
    assert_eq!(
        vault_after.lamports, expected_vault,
        "SOL vault should have original + consolidated tax"
    );

    // -----------------------------------------------------------------------
    // Step 4: Each user claims refund
    // -----------------------------------------------------------------------
    // Total refund pool = vault_sol + tax_collected = 115 SOL
    let _refund_pool = vault_sol + tax_collected; // 115_000_000_000

    let mut _remaining_outstanding = total_outstanding;

    for (i, user) in users.iter().enumerate() {
        let sol_before = svm.get_balance(&user.pubkey()).unwrap();

        let ix_claim = Instruction {
            program_id: addr(&program_id()),
            accounts: vec![
                AccountMeta::new(user.pubkey(), true),
                AccountMeta::new(addr(&crime_curve_pda), false),
                AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
                AccountMeta::new(addr(&user_atas[i]), false),
                AccountMeta::new(addr(&crime_mint), false),
                AccountMeta::new(addr(&crime_sol_vault), false),
                AccountMeta::new_readonly(addr(&token_2022_id()), false),
            ],
            data: claim_refund_data(),
        };

        let result = send_tx(&mut svm, &[ix_claim], user, &[user]);
        assert!(
            result.is_ok(),
            "User {} claim_refund should succeed: {:?}",
            i,
            result.err()
        );

        let sol_after = svm.get_balance(&user.pubkey()).unwrap();

        // Verify tokens burned
        let token_account = svm.get_account(&addr(&user_atas[i])).unwrap();
        let balance_bytes: [u8; 8] = token_account.data[64..72].try_into().unwrap();
        assert_eq!(
            u64::from_le_bytes(balance_bytes), 0,
            "User {} tokens should be burned", i,
        );

        // Check proportional refund (accounting for tx fee)
        // After consolidation, refund_pool_remaining = vault_lamports - rent_exempt
        // For the first user: floor(30M * refund_pool / 100M) = floor(34.5 SOL) = 34_500_000_000
        // But each subsequent user works against the shrinking pool and denominator
        let sol_received = sol_after.saturating_sub(sol_before.saturating_sub(10_000)); // generous fee margin
        assert!(
            sol_received > 0,
            "User {} should have received SOL refund, got delta: {}",
            i, sol_after as i64 - sol_before as i64,
        );

        _remaining_outstanding -= user_balances[i];
        svm.expire_blockhash();
    }

    // Verify CurveState tokens_sold is now 0
    let curve_account = svm.get_account(&addr(&crime_curve_pda)).unwrap();
    let ts_bytes: [u8; 8] = curve_account.data[105..113].try_into().unwrap();
    assert_eq!(
        u64::from_le_bytes(ts_bytes), 0,
        "tokens_sold should be 0 after all claims"
    );

    // Verify vault is nearly drained
    let vault_final = svm.get_account(&addr(&crime_sol_vault)).unwrap();
    assert!(
        vault_final.lamports <= rent_exempt + 10, // dust from floor rounding
        "Vault should be nearly drained: {} remaining (rent_exempt={})",
        vault_final.lamports, rent_exempt,
    );

    // -----------------------------------------------------------------------
    // Step 5: A 4th claim from user 0 (already claimed) should fail
    // -----------------------------------------------------------------------
    let ix_double_claim = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(users[0].pubkey(), true),
            AccountMeta::new(addr(&crime_curve_pda), false),
            AccountMeta::new_readonly(addr(&fraud_curve_pda), false),
            AccountMeta::new(addr(&user_atas[0]), false),
            AccountMeta::new(addr(&crime_mint), false),
            AccountMeta::new(addr(&crime_sol_vault), false),
            AccountMeta::new_readonly(addr(&token_2022_id()), false),
        ],
        data: claim_refund_data(),
    };

    let result = send_tx(&mut svm, &[ix_double_claim], &users[0], &[&users[0]]);
    assert!(
        result.is_err(),
        "Double claim should fail (user already claimed, balance is 0)"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("NothingToBurn") || err.contains("custom program error"),
        "Expected NothingToBurn error, got: {}",
        err,
    );
}

// ===========================================================================
// TEST-04: Vault solvency breach triggers VaultInsolvency
// ===========================================================================

/// Verifies the VaultInsolvency defense-in-depth guard on the sell instruction.
///
/// The sell instruction has a pre-transfer solvency check:
///   available = sol_vault.lamports - rent_exempt
///   require!(sol_gross <= available, VaultInsolvency)
///
/// We artificially drain the SOL vault to below what a sell would require,
/// simulating a scenario where the vault has been compromised. The on-chain
/// guard should catch this and return VaultInsolvency.
///
/// Note: Normal operations cannot cause insolvency (proptest proves this).
/// This test validates the defense-in-depth guard itself.
#[test]
fn test_vault_insolvency_breach() {
    let (mut svm, authority) = setup_svm();

    // Create a real Token-2022 mint (sell needs real token operations)
    let (crime_mint, _crime_mint_kp) = create_t22_mint(&mut svm, &authority);
    let fraud_mint = Pubkey::new_unique();

    let start_slot = 100;
    let deadline_slot = start_slot + DEADLINE_SLOTS;
    let rent = solana_sdk::rent::Rent::default();
    let rent_exempt = rent.minimum_balance(0);

    // Derive PDAs
    let (crime_curve_pda, crime_bump) = curve_state_pda(&crime_mint);
    let (crime_token_vault, _) = token_vault_pda(&crime_mint);
    let (crime_sol_vault, _) = sol_vault_pda(&crime_mint);
    let (crime_tax_escrow, _) = tax_escrow_pda(&crime_mint);

    // Inject CRIME curve: Active with 100M tokens sold (significant position)
    let tokens_sold = 100_000_000_000_000u64; // 100M tokens
    let sol_raised = 100_000_000_000u64;       // 100 SOL raised

    let crime_data = serialize_curve_state(
        TokenKind::Crime,
        &crime_mint,
        &crime_token_vault,
        &crime_sol_vault,
        tokens_sold,
        sol_raised,
        CurveStatus::Active,
        start_slot,
        deadline_slot,
        50,
        0, 0, 0,
        &crime_tax_escrow,
        crime_bump,
        false,
        &fraud_mint,
    );
    svm.set_account(
        addr(&crime_curve_pda),
        Account {
            lamports: rent.minimum_balance(crime_data.len()),
            data: crime_data,
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject CRIME CurveState");

    // Inject SOL vault ARTIFICIALLY DRAINED -- only rent-exempt + tiny dust
    // This simulates a scenario where the vault has been compromised.
    // A sell of any meaningful amount should trigger VaultInsolvency.
    svm.set_account(
        addr(&crime_sol_vault),
        Account {
            lamports: rent_exempt + 1_000, // Almost empty: just rent + 1000 lamports
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject drained SOL vault");

    // Inject tax escrow
    svm.set_account(
        addr(&crime_tax_escrow),
        Account {
            lamports: rent_exempt,
            data: vec![],
            owner: addr(&program_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject tax escrow");

    // Create seller with tokens in their ATA
    let seller = LiteKeypair::new();
    svm.airdrop(&seller.pubkey(), 10_000_000_000).unwrap();
    let seller_pk = kp_pubkey(&seller);
    let sell_amount = 1_000_000_000_000u64; // 1M tokens -- would return ~2 SOL gross
    let seller_ata = create_ata_and_fund(
        &mut svm, &authority, &crime_mint, &seller_pk, sell_amount,
    );

    // Inject token vault with tokens (so the sell token transfer direction works)
    let vault_space = spl_token_2022::state::Account::LEN;
    let vault_lamports = rent.minimum_balance(vault_space);
    let mut vault_data = vec![0u8; vault_space];
    vault_data[0..32].copy_from_slice(crime_mint.as_ref());
    vault_data[32..64].copy_from_slice(crime_curve_pda.as_ref());
    let vault_tokens = 360_000_000_000_000u64; // Remaining tokens in vault
    vault_data[64..72].copy_from_slice(&vault_tokens.to_le_bytes());
    vault_data[72..76].copy_from_slice(&0u32.to_le_bytes()); // no delegate
    vault_data[108] = 1; // Initialized
    vault_data[109..113].copy_from_slice(&0u32.to_le_bytes()); // not native

    svm.set_account(
        addr(&crime_token_vault),
        Account {
            lamports: vault_lamports,
            data: vault_data,
            owner: addr(&token_2022_id()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("Failed to inject token vault");

    // Set clock to before deadline (sell is allowed during active period)
    set_clock(&mut svm, start_slot + 100, 1_000_000);

    // Build sell instruction
    // Accounts: user(mut,signer), curve_state(mut), user_token_account(mut),
    // token_vault(mut), sol_vault(mut), tax_escrow(mut), token_mint,
    // token_program, system_program
    // + 4 remaining_accounts for Transfer Hook
    //
    // For this test, the sell should fail at the VaultInsolvency check BEFORE
    // the token transfer, but after deserializing all accounts. We need valid
    // remaining_accounts for Anchor's account count check.
    // We'll use 4 dummy readable accounts.
    let dummy1 = Pubkey::new_unique();
    let dummy2 = Pubkey::new_unique();
    let dummy3 = Pubkey::new_unique();
    let dummy4 = Pubkey::new_unique();
    // Ensure dummy accounts exist in SVM
    for dummy in [&dummy1, &dummy2, &dummy3, &dummy4] {
        svm.set_account(
            addr(dummy),
            Account {
                lamports: rent_exempt,
                data: vec![],
                owner: addr(&system_program_id()),
                executable: false,
                rent_epoch: 0,
            },
        ).unwrap();
    }

    let ix = Instruction {
        program_id: addr(&program_id()),
        accounts: vec![
            AccountMeta::new(seller.pubkey(), true),                  // user
            AccountMeta::new(addr(&crime_curve_pda), false),          // curve_state
            AccountMeta::new(addr(&seller_ata), false),               // user_token_account
            AccountMeta::new(addr(&crime_token_vault), false),        // token_vault
            AccountMeta::new(addr(&crime_sol_vault), false),          // sol_vault
            AccountMeta::new(addr(&crime_tax_escrow), false),         // tax_escrow
            AccountMeta::new_readonly(addr(&crime_mint), false),      // token_mint
            AccountMeta::new_readonly(addr(&token_2022_id()), false), // token_program
            AccountMeta::new_readonly(addr(&system_program_id()), false), // system_program
            // 4 remaining_accounts for Transfer Hook validation
            AccountMeta::new_readonly(addr(&dummy1), false),
            AccountMeta::new_readonly(addr(&dummy2), false),
            AccountMeta::new_readonly(addr(&dummy3), false),
            AccountMeta::new_readonly(addr(&dummy4), false),
        ],
        data: sell_data(sell_amount, 0), // Sell 1M tokens, accept any slippage
    };

    let result = send_tx(&mut svm, &[ix], &seller, &[&seller]);
    assert!(
        result.is_err(),
        "Sell should fail with VaultInsolvency when vault is drained"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("VaultInsolvency") || err.contains("custom program error"),
        "Expected VaultInsolvency error, got: {}",
        err,
    );
}
