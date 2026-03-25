/// Integration tests for AMM pool initialization using LiteSVM.
///
/// Tests cover all Phase 9 requirements:
/// - POOL-01 through POOL-06: Pool state, vaults, reserves, fees, pool type
/// - POOL-07: Admin access control (upgrade authority + admin signer)
/// - POOL-08: Duplicate pool prevention via PDA collision
/// - SWAP-10: PoolInitializedEvent emission
/// - TEST-02: Integration test coverage
///
/// Type bridge: Anchor uses `anchor_lang::prelude::Pubkey` (Solana 2.x),
/// while litesvm 0.9.1 uses `solana_address::Address` (Solana 3.x modular).
/// Both are [u8; 32] wrappers. We convert via bytes at the litesvm boundary.

use std::path::Path;

use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_keypair::Keypair as LiteKeypair;
use solana_signer::Signer as LiteSigner;
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;
use solana_instruction::{Instruction, account_meta::AccountMeta};

// Anchor types for Pubkey arithmetic, PDA derivation, and serialization
use anchor_lang::prelude::Pubkey;
use anchor_lang::AnchorSerialize;

// SPL crates for creating mints and token accounts
use solana_sdk::program_pack::Pack;
use spl_token::state::Mint as SplMintState;
use spl_token_2022::state::Mint as T22MintState;
use sha2::{Sha256, Digest};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// AMM program ID -- matches declare_id! in lib.rs
/// "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
fn program_id() -> Pubkey {
    "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        .parse()
        .unwrap()
}

/// SPL Token program ID
fn spl_token_program_id() -> Pubkey {
    spl_token::id()
}

/// Token-2022 program ID
fn token_2022_program_id() -> Pubkey {
    spl_token_2022::id()
}

/// BPF Loader Upgradeable program ID
fn bpf_loader_upgradeable_id() -> Pubkey {
    solana_sdk::bpf_loader_upgradeable::id()
}

/// System program ID
fn system_program_id() -> Pubkey {
    solana_sdk::system_program::id()
}

// Seeds from the AMM program constants
const ADMIN_SEED: &[u8] = b"admin";
const POOL_SEED: &[u8] = b"pool";
const VAULT_SEED: &[u8] = b"vault";
const VAULT_A_SEED: &[u8] = b"a";
const VAULT_B_SEED: &[u8] = b"b";

// ---------------------------------------------------------------------------
// Type conversion helpers
// ---------------------------------------------------------------------------

/// Convert anchor Pubkey -> litesvm Address
fn addr(pk: &Pubkey) -> Address {
    Address::from(pk.to_bytes())
}

/// Convert litesvm Address -> anchor Pubkey
fn pk(address: &Address) -> Pubkey {
    Pubkey::new_from_array(address.to_bytes())
}

/// Convert litesvm Keypair -> anchor Pubkey
fn kp_pubkey(kp: &LiteKeypair) -> Pubkey {
    pk(&kp.pubkey())
}

// ---------------------------------------------------------------------------
// Anchor instruction data helpers
// ---------------------------------------------------------------------------

/// Compute the Anchor instruction discriminator: sha256("global:<name>")[..8]
fn anchor_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name));
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Build instruction data for initialize_admin(admin: Pubkey)
fn initialize_admin_data(admin: &Pubkey) -> Vec<u8> {
    let mut data = anchor_discriminator("initialize_admin").to_vec();
    admin.serialize(&mut data).unwrap();
    data
}

/// Build instruction data for initialize_pool(lp_fee_bps: u16, amount_a: u64, amount_b: u64)
fn initialize_pool_data(lp_fee_bps: u16, amount_a: u64, amount_b: u64) -> Vec<u8> {
    let mut data = anchor_discriminator("initialize_pool").to_vec();
    lp_fee_bps.serialize(&mut data).unwrap();
    amount_a.serialize(&mut data).unwrap();
    amount_b.serialize(&mut data).unwrap();
    data
}

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

fn admin_config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ADMIN_SEED], program_id)
}

fn pool_pda(program_id: &Pubkey, mint_a: &Pubkey, mint_b: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_SEED, mint_a.as_ref(), mint_b.as_ref()],
        program_id,
    )
}

fn vault_a_pda(program_id: &Pubkey, pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VAULT_SEED, pool.as_ref(), VAULT_A_SEED],
        program_id,
    )
}

fn vault_b_pda(program_id: &Pubkey, pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VAULT_SEED, pool.as_ref(), VAULT_B_SEED],
        program_id,
    )
}

fn program_data_address(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[program_id.as_ref()],
        &bpf_loader_upgradeable_id(),
    )
}

// ---------------------------------------------------------------------------
// LiteSVM setup helpers
// ---------------------------------------------------------------------------

/// Deploy the AMM program as an upgradeable BPF program with a known
/// upgrade authority. This is required because initialize_admin checks
/// that the signer is the program's upgrade authority via the ProgramData
/// account constraint.
fn setup_svm_with_upgradeable_program(upgrade_authority: &LiteKeypair) -> LiteSVM {
    let mut svm = LiteSVM::new();
    let pid = program_id();
    let program_bytes = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("target/deploy/amm.so"),
    )
    .expect("AMM .so file not found -- run `anchor build` first");

    // BPF Loader Upgradeable stores the program in two accounts:
    //
    // 1. Program account (at program_id):
    //    - owner: BPFLoaderUpgradeab1e
    //    - data: UpgradeableLoaderState::Program { programdata_address }
    //    - executable: true
    //
    // 2. ProgramData account (PDA of [program_id] under BPFLoaderUpgradeab1e):
    //    - owner: BPFLoaderUpgradeab1e
    //    - data: UpgradeableLoaderState::ProgramData { slot, upgrade_authority } + ELF bytes
    //    - executable: false

    let (programdata_key, _bump) = program_data_address(&pid);
    let loader_id = bpf_loader_upgradeable_id();

    // Serialize UpgradeableLoaderState::Program { programdata_address }
    // Layout: 4 bytes (enum tag = 2 for Program) + 32 bytes (programdata pubkey)
    let mut program_account_data = vec![0u8; 36];
    program_account_data[0..4].copy_from_slice(&2u32.to_le_bytes()); // Program variant = 2
    program_account_data[4..36].copy_from_slice(programdata_key.as_ref());

    // Serialize UpgradeableLoaderState::ProgramData { slot, upgrade_authority_address }
    // Layout: 4 bytes (enum tag = 3) + 8 bytes (slot) + 1 byte (option tag) + 32 bytes (authority) + ELF bytes
    let header_size = 4 + 8 + 1 + 32; // 45 bytes
    let mut programdata_data = vec![0u8; header_size + program_bytes.len()];
    programdata_data[0..4].copy_from_slice(&3u32.to_le_bytes()); // ProgramData variant = 3
    programdata_data[4..12].copy_from_slice(&0u64.to_le_bytes()); // slot = 0
    programdata_data[12] = 1; // Some(upgrade_authority)
    programdata_data[13..45].copy_from_slice(kp_pubkey(upgrade_authority).as_ref());
    programdata_data[header_size..].copy_from_slice(&program_bytes);

    let rent = solana_sdk::rent::Rent::default();
    let program_lamports = rent.minimum_balance(program_account_data.len()).max(1);
    let programdata_lamports = rent.minimum_balance(programdata_data.len()).max(1);

    // IMPORTANT: Set programdata account FIRST because when we set the
    // executable program account, litesvm's add_account will call
    // load_program, which looks up the programdata account.
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

    // Now set the program account (executable, owned by BPFLoaderUpgradeable).
    // This will trigger load_program which reads the programdata we just set.
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

    svm
}

/// Create an SPL Token mint (standard, for WSOL-like tokens)
fn create_spl_mint(svm: &mut LiteSVM, authority: &LiteKeypair, decimals: u8) -> Pubkey {
    let mint_kp = LiteKeypair::new();
    let mint_pk = kp_pubkey(&mint_kp);
    let mint_addr = mint_kp.pubkey();

    let rent = solana_sdk::rent::Rent::default();
    let space = SplMintState::LEN;
    let lamports = rent.minimum_balance(space);

    // Create account via system program
    let create_account_ix = Instruction {
        program_id: addr(&system_program_id()),
        accounts: vec![
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new(mint_addr, true),
        ],
        data: {
            // SystemInstruction::CreateAccount { lamports, space, owner }
            let mut data = vec![0u8; 4 + 8 + 8 + 32];
            data[0..4].copy_from_slice(&0u32.to_le_bytes()); // CreateAccount = 0
            data[4..12].copy_from_slice(&lamports.to_le_bytes());
            data[12..20].copy_from_slice(&(space as u64).to_le_bytes());
            data[20..52].copy_from_slice(spl_token_program_id().as_ref());
            data
        },
    };

    // Initialize mint
    let init_mint_ix = Instruction {
        program_id: addr(&spl_token_program_id()),
        accounts: vec![
            AccountMeta::new(mint_addr, false),
            AccountMeta::new_readonly(addr(&solana_sdk::sysvar::rent::id()), false),
        ],
        data: {
            // InitializeMint2 { decimals, mint_authority, freeze_authority }
            let mut data = vec![20u8]; // InitializeMint2 instruction = 20
            data.push(decimals);
            data.extend_from_slice(kp_pubkey(authority).as_ref()); // mint authority
            data.push(0); // no freeze authority (COption::None)
            data
        },
    };

    let msg = Message::new_with_blockhash(
        &[create_account_ix, init_mint_ix],
        Some(&authority.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[authority, &mint_kp],
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to create SPL mint");

    mint_pk
}

/// Create a Token-2022 mint WITHOUT transfer hook extensions
fn create_t22_mint(svm: &mut LiteSVM, authority: &LiteKeypair, decimals: u8) -> Pubkey {
    let mint_kp = LiteKeypair::new();
    let mint_pk = kp_pubkey(&mint_kp);
    let mint_addr = mint_kp.pubkey();

    let rent = solana_sdk::rent::Rent::default();
    let space = T22MintState::LEN; // 82 bytes, no extensions
    let lamports = rent.minimum_balance(space);

    let create_account_ix = Instruction {
        program_id: addr(&system_program_id()),
        accounts: vec![
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new(mint_addr, true),
        ],
        data: {
            let mut data = vec![0u8; 4 + 8 + 8 + 32];
            data[0..4].copy_from_slice(&0u32.to_le_bytes());
            data[4..12].copy_from_slice(&lamports.to_le_bytes());
            data[12..20].copy_from_slice(&(space as u64).to_le_bytes());
            data[20..52].copy_from_slice(token_2022_program_id().as_ref());
            data
        },
    };

    let init_mint_ix = Instruction {
        program_id: addr(&token_2022_program_id()),
        accounts: vec![
            AccountMeta::new(mint_addr, false),
            AccountMeta::new_readonly(addr(&solana_sdk::sysvar::rent::id()), false),
        ],
        data: {
            let mut data = vec![20u8]; // InitializeMint2
            data.push(decimals);
            data.extend_from_slice(kp_pubkey(authority).as_ref());
            data.push(0); // no freeze authority
            data
        },
    };

    let msg = Message::new_with_blockhash(
        &[create_account_ix, init_mint_ix],
        Some(&authority.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[authority, &mint_kp],
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to create T22 mint");

    mint_pk
}

/// Create a token account (SPL or T22) for a given mint and owner
fn create_token_account(
    svm: &mut LiteSVM,
    payer: &LiteKeypair,
    mint: &Pubkey,
    owner: &Pubkey,
    token_program: &Pubkey,
) -> Pubkey {
    let account_kp = LiteKeypair::new();
    let account_pk = kp_pubkey(&account_kp);
    let account_addr = account_kp.pubkey();

    let rent = solana_sdk::rent::Rent::default();
    // Token account is 165 bytes for both SPL and T22 (without extensions)
    let space = 165u64;
    let lamports = rent.minimum_balance(space as usize);

    let create_account_ix = Instruction {
        program_id: addr(&system_program_id()),
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(account_addr, true),
        ],
        data: {
            let mut data = vec![0u8; 4 + 8 + 8 + 32];
            data[0..4].copy_from_slice(&0u32.to_le_bytes());
            data[4..12].copy_from_slice(&lamports.to_le_bytes());
            data[12..20].copy_from_slice(&space.to_le_bytes());
            data[20..52].copy_from_slice(token_program.as_ref());
            data
        },
    };

    // InitializeAccount3 { owner } -- instruction index 18
    let init_account_ix = Instruction {
        program_id: addr(token_program),
        accounts: vec![
            AccountMeta::new(account_addr, false),
            AccountMeta::new_readonly(addr(mint), false),
        ],
        data: {
            let mut data = vec![18u8]; // InitializeAccount3 = 18
            data.extend_from_slice(owner.as_ref());
            data
        },
    };

    let msg = Message::new_with_blockhash(
        &[create_account_ix, init_account_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[payer, &account_kp],
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to create token account");

    account_pk
}

/// Mint tokens to a destination token account
fn mint_tokens(
    svm: &mut LiteSVM,
    payer: &LiteKeypair,
    mint: &Pubkey,
    dest: &Pubkey,
    amount: u64,
    authority: &LiteKeypair,
    token_program: &Pubkey,
) {
    // MintTo instruction = 7
    let mint_to_ix = Instruction {
        program_id: addr(token_program),
        accounts: vec![
            AccountMeta::new(addr(mint), false),
            AccountMeta::new(addr(dest), false),
            AccountMeta::new_readonly(authority.pubkey(), true),
        ],
        data: {
            let mut data = vec![7u8]; // MintTo = 7
            data.extend_from_slice(&amount.to_le_bytes());
            data
        },
    };

    let msg = Message::new_with_blockhash(
        &[mint_to_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );

    let signers: Vec<&LiteKeypair> = if kp_pubkey(payer) == kp_pubkey(authority) {
        vec![payer]
    } else {
        vec![payer, authority]
    };

    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &signers,
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to mint tokens");
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

/// Build the initialize_admin instruction
fn build_initialize_admin_ix(
    program_id: &Pubkey,
    authority: &Pubkey,
    admin: &Pubkey,
) -> Instruction {
    let (admin_config, _bump) = admin_config_pda(program_id);
    let (programdata_key, _) = program_data_address(program_id);

    Instruction {
        program_id: addr(program_id),
        accounts: vec![
            AccountMeta::new(addr(authority), true),         // authority (signer, mut)
            AccountMeta::new(addr(&admin_config), false),    // admin_config (init)
            AccountMeta::new_readonly(addr(program_id), false), // program
            AccountMeta::new_readonly(addr(&programdata_key), false), // program_data
            AccountMeta::new_readonly(addr(&system_program_id()), false), // system_program
        ],
        data: initialize_admin_data(admin),
    }
}

/// Build the initialize_pool instruction
fn build_initialize_pool_ix(
    program_id: &Pubkey,
    payer: &Pubkey,
    admin: &Pubkey,
    mint_a: &Pubkey,
    mint_b: &Pubkey,
    source_a: &Pubkey,
    source_b: &Pubkey,
    token_program_a: &Pubkey,
    token_program_b: &Pubkey,
    lp_fee_bps: u16,
    amount_a: u64,
    amount_b: u64,
) -> Instruction {
    let (admin_config, _) = admin_config_pda(program_id);
    let (pool, _) = pool_pda(program_id, mint_a, mint_b);
    let (vault_a, _) = vault_a_pda(program_id, &pool);
    let (vault_b, _) = vault_b_pda(program_id, &pool);

    Instruction {
        program_id: addr(program_id),
        accounts: vec![
            AccountMeta::new(addr(payer), true),                // payer
            AccountMeta::new_readonly(addr(&admin_config), false), // admin_config
            AccountMeta::new_readonly(addr(admin), true),       // admin (signer)
            AccountMeta::new(addr(&pool), false),               // pool (init)
            AccountMeta::new(addr(&vault_a), false),            // vault_a (init)
            AccountMeta::new(addr(&vault_b), false),            // vault_b (init)
            AccountMeta::new_readonly(addr(mint_a), false),     // mint_a
            AccountMeta::new_readonly(addr(mint_b), false),     // mint_b
            AccountMeta::new(addr(source_a), false),            // source_a
            AccountMeta::new(addr(source_b), false),            // source_b
            AccountMeta::new_readonly(addr(token_program_a), false), // token_program_a
            AccountMeta::new_readonly(addr(token_program_b), false), // token_program_b
            AccountMeta::new_readonly(addr(&system_program_id()), false), // system_program
        ],
        data: initialize_pool_data(lp_fee_bps, amount_a, amount_b),
    }
}

// ---------------------------------------------------------------------------
// High-level test context
// ---------------------------------------------------------------------------

/// Describes which token programs a pool uses
#[derive(Clone, Copy)]
enum PoolConfig {
    /// One T22 mint + one SPL mint (CRIME/SOL, FRAUD/SOL pattern)
    Mixed,
    /// Two T22 mints (CRIME/PROFIT, FRAUD/PROFIT pattern)
    PureT22,
}

/// All the state needed for a pool initialization test
#[allow(dead_code)]
struct TestContext {
    svm: LiteSVM,
    upgrade_authority: LiteKeypair,
    admin: LiteKeypair,
    payer: LiteKeypair,
    /// mint_a < mint_b (canonical order)
    mint_a: Pubkey,
    mint_b: Pubkey,
    source_a: Pubkey,
    source_b: Pubkey,
    token_program_a: Pubkey,
    token_program_b: Pubkey,
}

/// Set up a complete test context: deploy program, create admin, create mints
/// and token accounts, fund everything.
fn setup_pool_test(config: PoolConfig, amount_a: u64, amount_b: u64) -> TestContext {
    let upgrade_authority = LiteKeypair::new();
    let mut svm = setup_svm_with_upgradeable_program(&upgrade_authority);

    // Fund the upgrade authority (will also be admin for simplicity)
    svm.airdrop(&upgrade_authority.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to upgrade authority");

    let admin = LiteKeypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to admin");

    let payer = LiteKeypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to payer");

    // Initialize AdminConfig
    let init_admin_ix = build_initialize_admin_ix(
        &program_id(),
        &kp_pubkey(&upgrade_authority),
        &kp_pubkey(&admin),
    );
    let msg = Message::new_with_blockhash(
        &[init_admin_ix],
        Some(&upgrade_authority.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&upgrade_authority],
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to initialize admin config");

    // Create mints based on pool config
    let (raw_mint_1, raw_mint_2, tp_1, tp_2) = match config {
        PoolConfig::Mixed => {
            let t22_mint = create_t22_mint(&mut svm, &admin, 9);
            svm.expire_blockhash(); // Avoid duplicate tx
            let spl_mint = create_spl_mint(&mut svm, &admin, 9);
            let t22_tp = token_2022_program_id();
            let spl_tp = spl_token_program_id();
            (t22_mint, spl_mint, t22_tp, spl_tp)
        }
        PoolConfig::PureT22 => {
            let mint_1 = create_t22_mint(&mut svm, &admin, 9);
            svm.expire_blockhash();
            let mint_2 = create_t22_mint(&mut svm, &admin, 9);
            let tp = token_2022_program_id();
            (mint_1, mint_2, tp, tp)
        }
    };

    // Ensure canonical order: mint_a < mint_b
    let (mint_a, mint_b, token_program_a, token_program_b) = if raw_mint_1 < raw_mint_2 {
        (raw_mint_1, raw_mint_2, tp_1, tp_2)
    } else {
        (raw_mint_2, raw_mint_1, tp_2, tp_1)
    };

    svm.expire_blockhash();

    // Create source token accounts for the admin (who will transfer seed liquidity)
    let source_a = create_token_account(&mut svm, &admin, &mint_a, &kp_pubkey(&admin), &token_program_a);
    svm.expire_blockhash();
    let source_b = create_token_account(&mut svm, &admin, &mint_b, &kp_pubkey(&admin), &token_program_b);
    svm.expire_blockhash();

    // Mint tokens to admin's source accounts
    mint_tokens(&mut svm, &admin, &mint_a, &source_a, amount_a, &admin, &token_program_a);
    svm.expire_blockhash();
    mint_tokens(&mut svm, &admin, &mint_b, &source_b, amount_b, &admin, &token_program_b);
    svm.expire_blockhash();

    TestContext {
        svm,
        upgrade_authority,
        admin,
        payer,
        mint_a,
        mint_b,
        source_a,
        source_b,
        token_program_a,
        token_program_b,
    }
}

/// Send the initialize_pool transaction and return the result
fn send_initialize_pool(
    ctx: &mut TestContext,
    lp_fee_bps: u16,
    amount_a: u64,
    amount_b: u64,
) -> litesvm::types::TransactionResult {
    let ix = build_initialize_pool_ix(
        &program_id(),
        &kp_pubkey(&ctx.payer),
        &kp_pubkey(&ctx.admin),
        &ctx.mint_a,
        &ctx.mint_b,
        &ctx.source_a,
        &ctx.source_b,
        &ctx.token_program_a,
        &ctx.token_program_b,
        lp_fee_bps,
        amount_a,
        amount_b,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.payer, &ctx.admin],
    )
    .unwrap();
    ctx.svm.send_transaction(tx)
}

/// Deserialize a PoolState from account data (skip 8-byte Anchor discriminator)
fn read_pool_state(data: &[u8]) -> PoolStateView {
    // Skip 8-byte anchor discriminator
    let d = &data[8..];
    // PoolType: 1 byte (enum with AnchorSerialize)
    let pool_type = d[0];
    let mut offset = 1;

    let mint_a = Pubkey::new_from_array(d[offset..offset + 32].try_into().unwrap());
    offset += 32;
    let mint_b = Pubkey::new_from_array(d[offset..offset + 32].try_into().unwrap());
    offset += 32;
    let vault_a = Pubkey::new_from_array(d[offset..offset + 32].try_into().unwrap());
    offset += 32;
    let vault_b = Pubkey::new_from_array(d[offset..offset + 32].try_into().unwrap());
    offset += 32;
    let reserve_a = u64::from_le_bytes(d[offset..offset + 8].try_into().unwrap());
    offset += 8;
    let reserve_b = u64::from_le_bytes(d[offset..offset + 8].try_into().unwrap());
    offset += 8;
    let lp_fee_bps = u16::from_le_bytes(d[offset..offset + 2].try_into().unwrap());
    offset += 2;
    let initialized = d[offset] != 0;
    offset += 1;
    let locked = d[offset] != 0;
    offset += 1;
    let bump = d[offset];
    offset += 1;
    let vault_a_bump = d[offset];
    offset += 1;
    let vault_b_bump = d[offset];
    offset += 1;
    let token_program_a = Pubkey::new_from_array(d[offset..offset + 32].try_into().unwrap());
    offset += 32;
    let token_program_b = Pubkey::new_from_array(d[offset..offset + 32].try_into().unwrap());

    PoolStateView {
        pool_type,
        mint_a,
        mint_b,
        vault_a,
        vault_b,
        reserve_a,
        reserve_b,
        lp_fee_bps,
        initialized,
        locked,
        bump,
        vault_a_bump,
        vault_b_bump,
        token_program_a,
        token_program_b,
    }
}

#[derive(Debug)]
#[allow(dead_code)]
struct PoolStateView {
    pool_type: u8,        // 0 = MixedPool, 1 = PureT22Pool
    mint_a: Pubkey,
    mint_b: Pubkey,
    vault_a: Pubkey,
    vault_b: Pubkey,
    reserve_a: u64,
    reserve_b: u64,
    lp_fee_bps: u16,
    initialized: bool,
    locked: bool,
    bump: u8,
    vault_a_bump: u8,
    vault_b_bump: u8,
    token_program_a: Pubkey,
    token_program_b: Pubkey,
}

/// Read a token account's balance from raw account data
fn read_token_balance(data: &[u8]) -> u64 {
    // SPL Token / T22 token account layout: amount is at offset 64 (8 bytes LE)
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

/// Read a token account's owner (authority) from raw account data
fn read_token_owner(data: &[u8]) -> Pubkey {
    // Owner is at offset 32 (32 bytes)
    Pubkey::new_from_array(data[32..64].try_into().unwrap())
}

// ===========================================================================
// TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// Happy path: Admin initialization
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_admin_success() {
    let upgrade_authority = LiteKeypair::new();
    let mut svm = setup_svm_with_upgradeable_program(&upgrade_authority);
    svm.airdrop(&upgrade_authority.pubkey(), 100_000_000_000)
        .expect("Airdrop failed");

    let admin = LiteKeypair::new();
    let ix = build_initialize_admin_ix(
        &program_id(),
        &kp_pubkey(&upgrade_authority),
        &kp_pubkey(&admin),
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&upgrade_authority.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&upgrade_authority],
    )
    .unwrap();

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "initialize_admin should succeed: {:?}", result.err());

    // Verify AdminConfig PDA
    let (admin_config, expected_bump) = admin_config_pda(&program_id());
    let account = svm.get_account(&addr(&admin_config))
        .expect("AdminConfig account should exist");

    // Skip 8-byte discriminator, then: admin (32 bytes) + bump (1 byte)
    let data = &account.data[8..];
    let stored_admin = Pubkey::new_from_array(data[0..32].try_into().unwrap());
    let stored_bump = data[32];

    assert_eq!(stored_admin, kp_pubkey(&admin), "Admin pubkey should match");
    assert_eq!(stored_bump, expected_bump, "Bump should match PDA derivation");
}

// ---------------------------------------------------------------------------
// Happy path: Mixed pool (T22 + SPL) -- CRIME/SOL pattern
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_mixed_pool() {
    let amount_a = 1_000_000u64;
    let amount_b = 1_000_000u64;
    let lp_fee_bps = 100u16;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount_a, amount_b);

    let result = send_initialize_pool(&mut ctx, lp_fee_bps, amount_a, amount_b);
    assert!(result.is_ok(), "Mixed pool init should succeed: {:?}", result.err());

    // Verify pool state
    let pid = program_id();
    let (pool_key, expected_pool_bump) = pool_pda(&pid, &ctx.mint_a, &ctx.mint_b);
    let (vault_a_key, expected_va_bump) = vault_a_pda(&pid, &pool_key);
    let (vault_b_key, expected_vb_bump) = vault_b_pda(&pid, &pool_key);

    let pool_acct = ctx.svm.get_account(&addr(&pool_key))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    assert_eq!(pool.pool_type, 0, "Pool type should be MixedPool (0)");
    assert_eq!(pool.mint_a, ctx.mint_a, "mint_a should match");
    assert_eq!(pool.mint_b, ctx.mint_b, "mint_b should match");
    assert_eq!(pool.vault_a, vault_a_key, "vault_a should be at expected PDA");
    assert_eq!(pool.vault_b, vault_b_key, "vault_b should be at expected PDA");
    assert_eq!(pool.reserve_a, amount_a, "reserve_a should match seed amount");
    assert_eq!(pool.reserve_b, amount_b, "reserve_b should match seed amount");
    assert_eq!(pool.lp_fee_bps, lp_fee_bps, "lp_fee_bps should match");
    assert!(pool.initialized, "Pool should be marked initialized");
    assert_eq!(pool.bump, expected_pool_bump, "Pool bump should match PDA");
    assert_eq!(pool.vault_a_bump, expected_va_bump, "Vault A bump should match PDA");
    assert_eq!(pool.vault_b_bump, expected_vb_bump, "Vault B bump should match PDA");

    // Verify token programs stored correctly
    // In a mixed pool, one program is T22 and the other is SPL
    assert_eq!(pool.token_program_a, ctx.token_program_a, "token_program_a should match");
    assert_eq!(pool.token_program_b, ctx.token_program_b, "token_program_b should match");

    // Verify vault accounts
    let vault_a_acct = ctx.svm.get_account(&addr(&vault_a_key))
        .expect("Vault A should exist");
    let vault_b_acct = ctx.svm.get_account(&addr(&vault_b_key))
        .expect("Vault B should exist");

    // Pool PDA is authority on both vaults
    assert_eq!(read_token_owner(&vault_a_acct.data), pool_key,
        "Vault A authority should be pool PDA");
    assert_eq!(read_token_owner(&vault_b_acct.data), pool_key,
        "Vault B authority should be pool PDA");

    // Vault balances match seed amounts
    assert_eq!(read_token_balance(&vault_a_acct.data), amount_a,
        "Vault A balance should match seed amount");
    assert_eq!(read_token_balance(&vault_b_acct.data), amount_b,
        "Vault B balance should match seed amount");
}

// ---------------------------------------------------------------------------
// Happy path: Pure T22 pool -- CRIME/PROFIT pattern
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_pure_t22_pool() {
    let amount_a = 2_000_000u64;
    let amount_b = 500_000u64;
    let lp_fee_bps = 50u16;
    let mut ctx = setup_pool_test(PoolConfig::PureT22, amount_a, amount_b);

    let result = send_initialize_pool(&mut ctx, lp_fee_bps, amount_a, amount_b);
    assert!(result.is_ok(), "Pure T22 pool init should succeed: {:?}", result.err());

    let pid = program_id();
    let (pool_key, _) = pool_pda(&pid, &ctx.mint_a, &ctx.mint_b);

    let pool_acct = ctx.svm.get_account(&addr(&pool_key))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    assert_eq!(pool.pool_type, 1, "Pool type should be PureT22Pool (1)");
    assert_eq!(pool.token_program_a, token_2022_program_id(),
        "token_program_a should be Token-2022");
    assert_eq!(pool.token_program_b, token_2022_program_id(),
        "token_program_b should be Token-2022");
    assert_eq!(pool.reserve_a, amount_a, "reserve_a should match");
    assert_eq!(pool.reserve_b, amount_b, "reserve_b should match");
    assert_eq!(pool.lp_fee_bps, lp_fee_bps, "lp_fee_bps should match");
}

// ---------------------------------------------------------------------------
// Happy path: Second mixed pool config -- FRAUD/SOL pattern
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_mixed_pool_second_config() {
    let amount_a = 5_000_000u64;
    let amount_b = 10_000_000u64;
    let lp_fee_bps = 100u16;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount_a, amount_b);

    let result = send_initialize_pool(&mut ctx, lp_fee_bps, amount_a, amount_b);
    assert!(result.is_ok(), "Second mixed pool init should succeed: {:?}", result.err());

    let pid = program_id();
    let (pool_key, _) = pool_pda(&pid, &ctx.mint_a, &ctx.mint_b);
    let pool_acct = ctx.svm.get_account(&addr(&pool_key))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    assert_eq!(pool.pool_type, 0, "Pool type should be MixedPool (0)");
    assert_eq!(pool.reserve_a, amount_a, "reserve_a should match larger seed");
    assert_eq!(pool.reserve_b, amount_b, "reserve_b should match larger seed");
}

// ---------------------------------------------------------------------------
// Happy path: Second pure T22 pool config -- FRAUD/PROFIT pattern
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_pure_t22_pool_second_config() {
    let amount_a = 750_000u64;
    let amount_b = 3_000_000u64;
    let lp_fee_bps = 50u16;
    let mut ctx = setup_pool_test(PoolConfig::PureT22, amount_a, amount_b);

    let result = send_initialize_pool(&mut ctx, lp_fee_bps, amount_a, amount_b);
    assert!(result.is_ok(), "Second T22 pool init should succeed: {:?}", result.err());

    let pid = program_id();
    let (pool_key, _) = pool_pda(&pid, &ctx.mint_a, &ctx.mint_b);
    let pool_acct = ctx.svm.get_account(&addr(&pool_key))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    assert_eq!(pool.pool_type, 1, "Pool type should be PureT22Pool (1)");
    assert_eq!(pool.reserve_a, amount_a, "reserve_a should match");
    assert_eq!(pool.reserve_b, amount_b, "reserve_b should match");
}

// ---------------------------------------------------------------------------
// Happy path: Event emission (SWAP-10)
// ---------------------------------------------------------------------------

#[test]
fn test_pool_initialized_event() {
    let amount_a = 1_000_000u64;
    let amount_b = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount_a, amount_b);

    let result = send_initialize_pool(&mut ctx, 100, amount_a, amount_b);
    // If the transaction succeeds, the event was emitted (it's in the handler).
    // We verify by checking the logs contain the pool initialization message.
    let meta = result.expect("Pool init should succeed for event test");
    let logs = &meta.logs;

    let has_pool_init_log = logs.iter().any(|log| log.contains("Pool initialized"));
    assert!(has_pool_init_log,
        "Transaction logs should contain 'Pool initialized' message. Logs: {:?}", logs);
}

// ---------------------------------------------------------------------------
// Negative: Non-upgrade-authority cannot create AdminConfig (POOL-07)
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_admin_non_upgrade_authority_rejected() {
    let upgrade_authority = LiteKeypair::new();
    let mut svm = setup_svm_with_upgradeable_program(&upgrade_authority);

    let imposter = LiteKeypair::new();
    svm.airdrop(&imposter.pubkey(), 100_000_000_000)
        .expect("Airdrop failed");

    let admin = LiteKeypair::new();
    let ix = build_initialize_admin_ix(
        &program_id(),
        &kp_pubkey(&imposter),  // NOT the upgrade authority
        &kp_pubkey(&admin),
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&imposter.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&imposter],
    )
    .unwrap();

    let result = svm.send_transaction(tx);
    assert!(result.is_err(),
        "Non-upgrade-authority should be rejected for initialize_admin");
}

// ---------------------------------------------------------------------------
// Negative: Non-admin cannot create pools (POOL-07)
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_pool_non_admin_rejected() {
    let amount_a = 1_000_000u64;
    let amount_b = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount_a, amount_b);

    // Create a fake admin
    let fake_admin = LiteKeypair::new();
    ctx.svm.airdrop(&fake_admin.pubkey(), 100_000_000_000)
        .expect("Airdrop failed");

    // Create source accounts for fake admin
    ctx.svm.expire_blockhash();
    let fake_source_a = create_token_account(
        &mut ctx.svm, &fake_admin, &ctx.mint_a,
        &kp_pubkey(&fake_admin), &ctx.token_program_a,
    );
    ctx.svm.expire_blockhash();
    let fake_source_b = create_token_account(
        &mut ctx.svm, &fake_admin, &ctx.mint_b,
        &kp_pubkey(&fake_admin), &ctx.token_program_b,
    );
    ctx.svm.expire_blockhash();

    // Mint tokens to fake admin
    mint_tokens(&mut ctx.svm, &fake_admin, &ctx.mint_a, &fake_source_a, amount_a, &ctx.admin, &ctx.token_program_a);
    ctx.svm.expire_blockhash();
    mint_tokens(&mut ctx.svm, &fake_admin, &ctx.mint_b, &fake_source_b, amount_b, &ctx.admin, &ctx.token_program_b);
    ctx.svm.expire_blockhash();

    let ix = build_initialize_pool_ix(
        &program_id(),
        &kp_pubkey(&ctx.payer),
        &kp_pubkey(&fake_admin),  // NOT the real admin
        &ctx.mint_a,
        &ctx.mint_b,
        &fake_source_a,
        &fake_source_b,
        &ctx.token_program_a,
        &ctx.token_program_b,
        100,
        amount_a,
        amount_b,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.payer, &fake_admin],
    )
    .unwrap();

    let result = ctx.svm.send_transaction(tx);
    assert!(result.is_err(),
        "Non-admin should be rejected for initialize_pool");
}

// ---------------------------------------------------------------------------
// Negative: Duplicate pool creation (POOL-08)
// ---------------------------------------------------------------------------

#[test]
fn test_duplicate_pool_rejected() {
    let amount_a = 1_000_000u64;
    let amount_b = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount_a, amount_b);

    // First pool initialization should succeed
    let result = send_initialize_pool(&mut ctx, 100, amount_a, amount_b);
    assert!(result.is_ok(), "First pool init should succeed: {:?}", result.err());

    ctx.svm.expire_blockhash();

    // Mint more tokens for second attempt
    mint_tokens(&mut ctx.svm, &ctx.admin, &ctx.mint_a, &ctx.source_a, amount_a, &ctx.admin, &ctx.token_program_a);
    ctx.svm.expire_blockhash();
    mint_tokens(&mut ctx.svm, &ctx.admin, &ctx.mint_b, &ctx.source_b, amount_b, &ctx.admin, &ctx.token_program_b);
    ctx.svm.expire_blockhash();

    // Second pool init with same mints should fail (PDA already exists)
    let result = send_initialize_pool(&mut ctx, 100, amount_a, amount_b);
    assert!(result.is_err(),
        "Duplicate pool creation should be rejected by PDA collision");
}

// ---------------------------------------------------------------------------
// Negative: Non-canonical mint ordering
// ---------------------------------------------------------------------------

#[test]
fn test_non_canonical_order_rejected() {
    let amount_a = 1_000_000u64;
    let amount_b = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount_a, amount_b);

    // Swap mint_a and mint_b to violate canonical order
    let ix = build_initialize_pool_ix(
        &program_id(),
        &kp_pubkey(&ctx.payer),
        &kp_pubkey(&ctx.admin),
        &ctx.mint_b,    // WRONG: mint_b > mint_a, but passing as first
        &ctx.mint_a,    // WRONG: mint_a < mint_b, but passing as second
        &ctx.source_b,
        &ctx.source_a,
        &ctx.token_program_b,
        &ctx.token_program_a,
        100,
        amount_a,
        amount_b,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.payer, &ctx.admin],
    )
    .unwrap();

    let result = ctx.svm.send_transaction(tx);
    assert!(result.is_err(),
        "Non-canonical mint order should be rejected");
}

// ---------------------------------------------------------------------------
// Negative: Duplicate mints
// ---------------------------------------------------------------------------

#[test]
fn test_duplicate_mints_rejected() {
    let amount = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount, amount);

    // Use mint_a for both positions
    let ix = build_initialize_pool_ix(
        &program_id(),
        &kp_pubkey(&ctx.payer),
        &kp_pubkey(&ctx.admin),
        &ctx.mint_a,
        &ctx.mint_a,  // SAME mint as mint_a
        &ctx.source_a,
        &ctx.source_a,
        &ctx.token_program_a,
        &ctx.token_program_a,
        100,
        amount,
        amount,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.payer, &ctx.admin],
    )
    .unwrap();

    let result = ctx.svm.send_transaction(tx);
    assert!(result.is_err(),
        "Duplicate mints should be rejected");
}

// ---------------------------------------------------------------------------
// Negative: Zero seed amount
// ---------------------------------------------------------------------------

#[test]
fn test_zero_seed_amount_rejected() {
    let amount = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount, amount);

    // amount_a = 0 should fail
    let ix = build_initialize_pool_ix(
        &program_id(),
        &kp_pubkey(&ctx.payer),
        &kp_pubkey(&ctx.admin),
        &ctx.mint_a,
        &ctx.mint_b,
        &ctx.source_a,
        &ctx.source_b,
        &ctx.token_program_a,
        &ctx.token_program_b,
        100,
        0,        // ZERO amount_a
        amount,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.payer, &ctx.admin],
    )
    .unwrap();

    let result = ctx.svm.send_transaction(tx);
    assert!(result.is_err(),
        "Zero seed amount should be rejected");
}

// ---------------------------------------------------------------------------
// Negative: Token program mismatch
// ---------------------------------------------------------------------------

#[test]
fn test_token_program_mismatch_rejected() {
    let amount = 1_000_000u64;
    let mut ctx = setup_pool_test(PoolConfig::Mixed, amount, amount);

    // Create a source account under the WRONG token program for mint_a
    // We'll pass SPL Token program for a T22 mint (or vice versa)
    // The simplest way: just swap the token programs in the instruction
    let wrong_token_program_a = if ctx.token_program_a == token_2022_program_id() {
        spl_token_program_id()
    } else {
        token_2022_program_id()
    };

    let ix = build_initialize_pool_ix(
        &program_id(),
        &kp_pubkey(&ctx.payer),
        &kp_pubkey(&ctx.admin),
        &ctx.mint_a,
        &ctx.mint_b,
        &ctx.source_a,
        &ctx.source_b,
        &wrong_token_program_a,   // WRONG program for mint_a
        &ctx.token_program_b,
        100,
        amount,
        amount,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.payer, &ctx.admin],
    )
    .unwrap();

    let result = ctx.svm.send_transaction(tx);
    assert!(result.is_err(),
        "Token program mismatch should be rejected");
}
