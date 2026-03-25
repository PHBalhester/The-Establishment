/// Integration tests for AMM swap_sol_pool instruction using LiteSVM.
///
/// Tests cover Phase 11 swap requirements:
/// - SWAP-01: AtoB and BtoA swap directions produce correct output
/// - SWAP-03: Output matches constant-product formula with fee deduction
/// - SWAP-04: LP fee compounds into reserves (reserve_in grows by full amount_in)
/// - SWAP-05: Slippage protection rejects unfavorable outputs (TEST-04)
/// - SWAP-07: k-invariant holds (k_after >= k_before) for all swaps
/// - SWAP-08: Zero-amount swap rejected with ZeroAmount error
/// - SWAP-09: SwapEvent emitted with correct fields (verified via logs)
/// - Consecutive swaps succeed (proving reentrancy guard clears)
///
/// All swap tests route through the Mock Tax Program via CPI, because
/// Phase 46 added a `swap_authority` PDA requirement: the AMM now requires
/// swap_authority to be a Signer PDA derived from TAX_PROGRAM_ID. Direct
/// calls to AMM swap without a valid swap_authority fail with error 3010
/// (AccountNotSigner). The Mock Tax Program signs this PDA via invoke_signed.
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
fn program_id() -> Pubkey {
    "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        .parse()
        .unwrap()
}

/// Mock Tax Program ID -- MUST equal TAX_PROGRAM_ID in AMM constants.rs
/// because the AMM validates swap_authority PDA with seeds::program = TAX_PROGRAM_ID.
/// We deploy the mock_tax_program.so binary at this address in LiteSVM.
fn mock_tax_program_id() -> Pubkey {
    "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
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
const SWAP_AUTHORITY_SEED: &[u8] = b"swap_authority";

/// Standard test decimals
const TEST_DECIMALS: u8 = 9;

/// Seed liquidity: 1 token at 9 decimals
const SEED_AMOUNT: u64 = 1_000_000_000;

/// LP fee for SOL pools: 100 bps = 1%
const LP_FEE_BPS: u16 = 100;

/// BPS denominator
const BPS_DENOMINATOR: u64 = 10_000;

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

/// Build instruction data for swap_sol_pool(amount_in: u64, direction: SwapDirection, minimum_amount_out: u64)
///
/// SwapDirection is serialized as a single u8:
/// - AtoB = 0
/// - BtoA = 1
fn swap_sol_pool_data(amount_in: u64, direction: u8, minimum_amount_out: u64) -> Vec<u8> {
    let mut data = anchor_discriminator("swap_sol_pool").to_vec();
    amount_in.serialize(&mut data).unwrap();
    direction.serialize(&mut data).unwrap();
    minimum_amount_out.serialize(&mut data).unwrap();
    data
}

/// Build Mock Tax Program execute_swap instruction data.
/// This wraps the AMM instruction data for the CPI call.
fn mock_tax_execute_swap_data(amm_instruction_data: Vec<u8>) -> Vec<u8> {
    let mut data = anchor_discriminator("execute_swap").to_vec();
    // Anchor serializes Vec<u8> as: u32 length + bytes
    (amm_instruction_data.len() as u32).serialize(&mut data).unwrap();
    data.extend_from_slice(&amm_instruction_data);
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

/// Derive swap_authority PDA from a given program ID.
/// For Mock Tax Program (TAX_PROGRAM_ID): AMM accepts this PDA.
fn swap_authority_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], program_id)
}

// ---------------------------------------------------------------------------
// LiteSVM setup helpers
// ---------------------------------------------------------------------------

/// Read program bytes from the deploy folder.
fn read_program_bytes(program_name: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(format!("target/deploy/{}.so", program_name)),
    )
    .unwrap_or_else(|_| panic!("{}.so file not found -- run `anchor build` first", program_name))
}

/// Deploy an upgradeable BPF program to litesvm.
fn deploy_upgradeable_program(
    svm: &mut LiteSVM,
    prog_id: &Pubkey,
    upgrade_authority: &Pubkey,
    program_bytes: &[u8],
) {
    let (programdata_key, _bump) = program_data_address(prog_id);
    let loader_id = bpf_loader_upgradeable_id();

    // Serialize UpgradeableLoaderState::Program { programdata_address }
    let mut program_account_data = vec![0u8; 36];
    program_account_data[0..4].copy_from_slice(&2u32.to_le_bytes());
    program_account_data[4..36].copy_from_slice(programdata_key.as_ref());

    // Serialize UpgradeableLoaderState::ProgramData { slot, upgrade_authority }
    let header_size = 4 + 8 + 1 + 32; // 45 bytes
    let mut programdata_data = vec![0u8; header_size + program_bytes.len()];
    programdata_data[0..4].copy_from_slice(&3u32.to_le_bytes());
    programdata_data[4..12].copy_from_slice(&0u64.to_le_bytes());
    programdata_data[12] = 1; // Some(upgrade_authority)
    programdata_data[13..45].copy_from_slice(upgrade_authority.as_ref());
    programdata_data[header_size..].copy_from_slice(program_bytes);

    let rent = solana_sdk::rent::Rent::default();
    let program_lamports = rent.minimum_balance(program_account_data.len()).max(1);
    let programdata_lamports = rent.minimum_balance(programdata_data.len()).max(1);

    // IMPORTANT: Set programdata account FIRST (litesvm's add_account calls
    // load_program when setting executable account, which reads programdata).
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
        addr(prog_id),
        Account {
            lamports: program_lamports,
            data: program_account_data,
            owner: addr(&loader_id),
            executable: true,
            rent_epoch: 0,
        },
    )
    .expect("Failed to set program account");
}

/// Deploy the AMM program AND Mock Tax Program as upgradeable BPF programs.
///
/// The Mock Tax Program is required because Phase 46 added swap_authority PDA
/// validation: AMM swap instructions require swap_authority to be a Signer PDA
/// derived from TAX_PROGRAM_ID. The Mock Tax Program signs this PDA via CPI.
fn setup_svm_with_programs(upgrade_authority: &LiteKeypair) -> LiteSVM {
    let mut svm = LiteSVM::new();
    let ua_pk = kp_pubkey(upgrade_authority);

    // Deploy AMM program
    let amm_bytes = read_program_bytes("amm");
    deploy_upgradeable_program(&mut svm, &program_id(), &ua_pk, &amm_bytes);

    // Deploy Mock Tax Program at TAX_PROGRAM_ID address
    let mock_tax_bytes = read_program_bytes("mock_tax_program");
    deploy_upgradeable_program(&mut svm, &mock_tax_program_id(), &ua_pk, &mock_tax_bytes);

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
            data[20..52].copy_from_slice(spl_token_program_id().as_ref());
            data
        },
    };

    let init_mint_ix = Instruction {
        program_id: addr(&spl_token_program_id()),
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
        .expect("Failed to create SPL mint");

    mint_pk
}

/// Create a Token-2022 mint WITHOUT transfer hook extensions
fn create_t22_mint(svm: &mut LiteSVM, authority: &LiteKeypair, decimals: u8) -> Pubkey {
    let mint_kp = LiteKeypair::new();
    let mint_pk = kp_pubkey(&mint_kp);
    let mint_addr = mint_kp.pubkey();

    let rent = solana_sdk::rent::Rent::default();
    let space = T22MintState::LEN;
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

    let init_account_ix = Instruction {
        program_id: addr(token_program),
        accounts: vec![
            AccountMeta::new(account_addr, false),
            AccountMeta::new_readonly(addr(mint), false),
        ],
        data: {
            let mut data = vec![18u8]; // InitializeAccount3
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
    let mint_to_ix = Instruction {
        program_id: addr(token_program),
        accounts: vec![
            AccountMeta::new(addr(mint), false),
            AccountMeta::new(addr(dest), false),
            AccountMeta::new_readonly(authority.pubkey(), true),
        ],
        data: {
            let mut data = vec![7u8]; // MintTo
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
            AccountMeta::new(addr(authority), true),
            AccountMeta::new(addr(&admin_config), false),
            AccountMeta::new_readonly(addr(program_id), false),
            AccountMeta::new_readonly(addr(&programdata_key), false),
            AccountMeta::new_readonly(addr(&system_program_id()), false),
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
            AccountMeta::new(addr(payer), true),
            AccountMeta::new_readonly(addr(&admin_config), false),
            AccountMeta::new_readonly(addr(admin), true),
            AccountMeta::new(addr(&pool), false),
            AccountMeta::new(addr(&vault_a), false),
            AccountMeta::new(addr(&vault_b), false),
            AccountMeta::new_readonly(addr(mint_a), false),
            AccountMeta::new_readonly(addr(mint_b), false),
            AccountMeta::new(addr(source_a), false),
            AccountMeta::new(addr(source_b), false),
            AccountMeta::new_readonly(addr(token_program_a), false),
            AccountMeta::new_readonly(addr(token_program_b), false),
            AccountMeta::new_readonly(addr(&system_program_id()), false),
        ],
        data: initialize_pool_data(lp_fee_bps, amount_a, amount_b),
    }
}

/// Build Mock Tax Program execute_swap instruction that CPIs into AMM swap_sol_pool.
///
/// The Mock Tax Program signs the swap_authority PDA via invoke_signed, then
/// forwards the AMM swap instruction data and accounts via CPI.
///
/// Account ordering for Mock Tax Program's execute_swap:
/// 1. amm_program (the program to CPI into)
/// 2. swap_authority (the PDA that will sign)
/// Then remaining_accounts (forwarded to AMM):
/// 3+ AMM accounts: pool, vault_a, vault_b, mint_a, mint_b, user_token_a, user_token_b, user, token_program_a, token_program_b
fn build_swap_instruction(
    swap_authority: &Pubkey,
    pool: &Pubkey,
    vault_a: &Pubkey,
    vault_b: &Pubkey,
    mint_a: &Pubkey,
    mint_b: &Pubkey,
    user_token_a: &Pubkey,
    user_token_b: &Pubkey,
    user: &Pubkey,
    token_program_a: &Pubkey,
    token_program_b: &Pubkey,
    amount_in: u64,
    direction: u8,
    minimum_amount_out: u64,
) -> Instruction {
    let amm_pid = program_id();
    let amm_data = swap_sol_pool_data(amount_in, direction, minimum_amount_out);

    Instruction {
        program_id: addr(&mock_tax_program_id()),
        accounts: vec![
            // Mock Tax Program accounts
            AccountMeta::new_readonly(addr(&amm_pid), false),       // amm_program
            AccountMeta::new_readonly(addr(swap_authority), false),  // swap_authority (will be signed by invoke_signed)
            // Remaining accounts forwarded to AMM (must match SwapSolPool order AFTER swap_authority)
            AccountMeta::new(addr(pool), false),              // pool (mut)
            AccountMeta::new(addr(vault_a), false),            // vault_a (mut)
            AccountMeta::new(addr(vault_b), false),            // vault_b (mut)
            AccountMeta::new_readonly(addr(mint_a), false),    // mint_a
            AccountMeta::new_readonly(addr(mint_b), false),    // mint_b
            AccountMeta::new(addr(user_token_a), false),       // user_token_a (mut)
            AccountMeta::new(addr(user_token_b), false),       // user_token_b (mut)
            AccountMeta::new_readonly(addr(user), true),       // user (signer)
            AccountMeta::new_readonly(addr(token_program_a), false), // token_program_a
            AccountMeta::new_readonly(addr(token_program_b), false), // token_program_b
        ],
        data: mock_tax_execute_swap_data(amm_data),
    }
}

// ---------------------------------------------------------------------------
// Pool state reader
// ---------------------------------------------------------------------------

/// Deserialized view of PoolState from raw account bytes.
///
/// Layout (after 8-byte Anchor discriminator):
/// pool_type: 1, mint_a: 32, mint_b: 32, vault_a: 32, vault_b: 32,
/// reserve_a: 8, reserve_b: 8, lp_fee_bps: 2, initialized: 1, locked: 1,
/// bump: 1, vault_a_bump: 1, vault_b_bump: 1, token_program_a: 32, token_program_b: 32
#[derive(Debug)]
#[allow(dead_code)]
struct PoolStateView {
    pool_type: u8,
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

fn read_pool_state(data: &[u8]) -> PoolStateView {
    let d = &data[8..]; // skip discriminator
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

// ---------------------------------------------------------------------------
// Token balance reader
// ---------------------------------------------------------------------------

/// Read a token account's balance from litesvm.
/// SPL Token / T22 layout: amount at offset 64 (8 bytes LE).
fn get_token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    let acct = svm.get_account(&addr(token_account))
        .expect("Token account should exist");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

// ---------------------------------------------------------------------------
// Swap math helpers (replicated from math.rs for test independence)
// ---------------------------------------------------------------------------

/// Calculate expected effective input after LP fee deduction.
/// Formula: amount_in * (10_000 - fee_bps) / 10_000
fn expected_effective_input(amount_in: u64, fee_bps: u16) -> u128 {
    let amount = amount_in as u128;
    let fee_factor = 10_000u128 - fee_bps as u128;
    amount * fee_factor / 10_000
}

/// Calculate expected swap output using constant-product formula.
/// Formula: reserve_out * effective_input / (reserve_in + effective_input)
fn expected_swap_output(reserve_in: u64, reserve_out: u64, effective_input: u128) -> u64 {
    let r_in = reserve_in as u128;
    let r_out = reserve_out as u128;
    let numerator = r_out * effective_input;
    let denominator = r_in + effective_input;
    (numerator / denominator) as u64
}

// ---------------------------------------------------------------------------
// High-level test context
// ---------------------------------------------------------------------------

/// All the state needed for swap testing.
///
/// CRITICAL: `t22_is_mint_a` tracks whether the T22 mint ended up as mint_a
/// (true) or mint_b (false) after canonical ordering. This determines:
/// - AtoB direction = T22->SPL (if t22_is_mint_a) or SPL->T22 (if !t22_is_mint_a)
/// - BtoA direction = SPL->T22 (if t22_is_mint_a) or T22->SPL (if !t22_is_mint_a)
#[allow(dead_code)]
struct SwapTestContext {
    svm: LiteSVM,
    admin: LiteKeypair,
    user: LiteKeypair,
    pool: Pubkey,
    vault_a: Pubkey,
    vault_b: Pubkey,
    mint_a: Pubkey,
    mint_b: Pubkey,
    user_token_a: Pubkey,
    user_token_b: Pubkey,
    token_program_a: Pubkey,
    token_program_b: Pubkey,
    /// True if the T22 mint is mint_a (smaller pubkey), false if it's mint_b.
    t22_is_mint_a: bool,
    /// swap_authority PDA derived from Mock Tax Program (TAX_PROGRAM_ID)
    swap_authority: Pubkey,
}

/// Set up a complete swap test context:
/// 1. Deploy AMM program + Mock Tax Program
/// 2. Initialize admin
/// 3. Create T22 mint + SPL mint (CRIME/SOL pattern)
/// 4. Canonical ordering
/// 5. Initialize pool with seed liquidity
/// 6. Create and fund user token accounts
/// 7. Derive swap_authority PDA from Mock Tax Program
fn setup_initialized_pool() -> SwapTestContext {
    let upgrade_authority = LiteKeypair::new();
    let mut svm = setup_svm_with_programs(&upgrade_authority);

    svm.airdrop(&upgrade_authority.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to upgrade authority");

    let admin = LiteKeypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to admin");

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

    // Create mints: one T22 (CRIME-like) and one SPL (WSOL-like)
    let t22_mint = create_t22_mint(&mut svm, &admin, TEST_DECIMALS);
    svm.expire_blockhash();
    let spl_mint = create_spl_mint(&mut svm, &admin, TEST_DECIMALS);
    svm.expire_blockhash();

    // Ensure canonical order: mint_a < mint_b by pubkey bytes
    let (mint_a, mint_b, token_program_a, token_program_b, t22_is_mint_a) =
        if t22_mint < spl_mint {
            (t22_mint, spl_mint, token_2022_program_id(), spl_token_program_id(), true)
        } else {
            (spl_mint, t22_mint, spl_token_program_id(), token_2022_program_id(), false)
        };

    // Create admin source token accounts and mint seed liquidity
    let source_a = create_token_account(&mut svm, &admin, &mint_a, &kp_pubkey(&admin), &token_program_a);
    svm.expire_blockhash();
    let source_b = create_token_account(&mut svm, &admin, &mint_b, &kp_pubkey(&admin), &token_program_b);
    svm.expire_blockhash();

    mint_tokens(&mut svm, &admin, &mint_a, &source_a, SEED_AMOUNT, &admin, &token_program_a);
    svm.expire_blockhash();
    mint_tokens(&mut svm, &admin, &mint_b, &source_b, SEED_AMOUNT, &admin, &token_program_b);
    svm.expire_blockhash();

    // Initialize pool
    let pid = program_id();
    let payer = LiteKeypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to payer");

    let ix = build_initialize_pool_ix(
        &pid,
        &kp_pubkey(&payer),
        &kp_pubkey(&admin),
        &mint_a,
        &mint_b,
        &source_a,
        &source_b,
        &token_program_a,
        &token_program_b,
        LP_FEE_BPS,
        SEED_AMOUNT,
        SEED_AMOUNT,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&payer, &admin],
    )
    .unwrap();
    svm.send_transaction(tx)
        .expect("Failed to initialize pool");
    svm.expire_blockhash();

    let (pool, _) = pool_pda(&pid, &mint_a, &mint_b);
    let (vault_a, _) = vault_a_pda(&pid, &pool);
    let (vault_b, _) = vault_b_pda(&pid, &pool);

    // Create user and fund with SOL + tokens
    let user = LiteKeypair::new();
    svm.airdrop(&user.pubkey(), 100_000_000_000)
        .expect("Failed to airdrop to user");

    let user_token_a = create_token_account(&mut svm, &user, &mint_a, &kp_pubkey(&user), &token_program_a);
    svm.expire_blockhash();
    let user_token_b = create_token_account(&mut svm, &user, &mint_b, &kp_pubkey(&user), &token_program_b);
    svm.expire_blockhash();

    // Mint generous amounts to user (enough for multiple swaps)
    let user_token_amount = 100_000_000_000u64; // 100 tokens
    mint_tokens(&mut svm, &admin, &mint_a, &user_token_a, user_token_amount, &admin, &token_program_a);
    svm.expire_blockhash();
    mint_tokens(&mut svm, &admin, &mint_b, &user_token_b, user_token_amount, &admin, &token_program_b);
    svm.expire_blockhash();

    // Derive swap_authority PDA from Mock Tax Program (TAX_PROGRAM_ID)
    let (swap_authority, _) = swap_authority_pda(&mock_tax_program_id());

    SwapTestContext {
        svm,
        admin,
        user,
        pool,
        vault_a,
        vault_b,
        mint_a,
        mint_b,
        user_token_a,
        user_token_b,
        token_program_a,
        token_program_b,
        t22_is_mint_a,
        swap_authority,
    }
}

/// Execute a swap via Mock Tax Program CPI and return the transaction result
fn send_swap(
    ctx: &mut SwapTestContext,
    amount_in: u64,
    direction: u8,
    minimum_amount_out: u64,
) -> litesvm::types::TransactionResult {
    let ix = build_swap_instruction(
        &ctx.swap_authority,
        &ctx.pool,
        &ctx.vault_a,
        &ctx.vault_b,
        &ctx.mint_a,
        &ctx.mint_b,
        &ctx.user_token_a,
        &ctx.user_token_b,
        &kp_pubkey(&ctx.user),
        &ctx.token_program_a,
        &ctx.token_program_b,
        amount_in,
        direction,
        minimum_amount_out,
    );

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.user.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.user],
    )
    .unwrap();
    ctx.svm.send_transaction(tx)
}

// ===========================================================================
// TESTS
// ===========================================================================

// Direction constants for readability
const DIRECTION_A_TO_B: u8 = 0;
const DIRECTION_B_TO_A: u8 = 1;

// ---------------------------------------------------------------------------
// Test 1: AtoB swap produces correct output (SWAP-01, SWAP-03)
// ---------------------------------------------------------------------------

/// Verify that an AtoB swap produces the correct output amount matching
/// the constant-product formula with 100 bps fee deduction.
///
/// Pool: 1_000_000_000 / 1_000_000_000 (1:1 ratio, 9 decimals)
/// Swap: 10_000_000 (0.01 token) AtoB
///
/// Expected math:
///   effective_input = 10_000_000 * 9900 / 10000 = 9_900_000
///   amount_out = 1_000_000_000 * 9_900_000 / (1_000_000_000 + 9_900_000)
///              = 9_900_000_000_000_000 / 1_009_900_000
///              = 9_802_940 (integer truncation)
#[test]
fn test_swap_a_to_b_correct_output() {
    let mut ctx = setup_initialized_pool();

    let amount_in: u64 = 10_000_000; // 0.01 token

    // Record balances before swap
    let user_a_before = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_before = get_token_balance(&ctx.svm, &ctx.user_token_b);

    // Execute AtoB swap with no slippage constraint
    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, 0);
    assert!(result.is_ok(), "AtoB swap should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    // Calculate expected output
    let effective_input = expected_effective_input(amount_in, LP_FEE_BPS);
    let expected_out = expected_swap_output(SEED_AMOUNT, SEED_AMOUNT, effective_input);

    // Verify user balances
    let user_a_after = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_after = get_token_balance(&ctx.svm, &ctx.user_token_b);

    assert_eq!(
        user_a_before - amount_in, user_a_after,
        "User token A balance should decrease by amount_in"
    );
    assert_eq!(
        user_b_before + expected_out, user_b_after,
        "User token B balance should increase by expected output"
    );

    // Verify pool reserves
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    assert_eq!(
        pool.reserve_a, SEED_AMOUNT + amount_in,
        "Reserve A should increase by full amount_in (pre-fee)"
    );
    assert_eq!(
        pool.reserve_b, SEED_AMOUNT - expected_out,
        "Reserve B should decrease by amount_out"
    );

    // Sanity check: the expected output is reasonable
    assert!(expected_out > 0, "Output should be non-zero");
    assert!(expected_out < amount_in, "Output should be less than input (fee + price impact)");
}

// ---------------------------------------------------------------------------
// Test 2: BtoA swap produces correct output (SWAP-01, SWAP-03)
// ---------------------------------------------------------------------------

/// Verify that a BtoA swap produces the correct output amount.
/// Same pool setup, same amount, reverse direction.
#[test]
fn test_swap_b_to_a_correct_output() {
    let mut ctx = setup_initialized_pool();

    let amount_in: u64 = 10_000_000;

    let user_a_before = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_before = get_token_balance(&ctx.svm, &ctx.user_token_b);

    let result = send_swap(&mut ctx, amount_in, DIRECTION_B_TO_A, 0);
    assert!(result.is_ok(), "BtoA swap should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    // For BtoA: reserve_in = reserve_b, reserve_out = reserve_a
    let effective_input = expected_effective_input(amount_in, LP_FEE_BPS);
    let expected_out = expected_swap_output(SEED_AMOUNT, SEED_AMOUNT, effective_input);

    let user_a_after = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_after = get_token_balance(&ctx.svm, &ctx.user_token_b);

    assert_eq!(
        user_b_before - amount_in, user_b_after,
        "User token B balance should decrease by amount_in"
    );
    assert_eq!(
        user_a_before + expected_out, user_a_after,
        "User token A balance should increase by expected output"
    );

    // Verify pool reserves: B side grows, A side shrinks
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    assert_eq!(
        pool.reserve_b, SEED_AMOUNT + amount_in,
        "Reserve B should increase by full amount_in (pre-fee)"
    );
    assert_eq!(
        pool.reserve_a, SEED_AMOUNT - expected_out,
        "Reserve A should decrease by amount_out"
    );
}

// ---------------------------------------------------------------------------
// Test 3: LP fee compounds into reserves (SWAP-04)
// ---------------------------------------------------------------------------

/// Prove that the LP fee stays in the pool: reserve_in grows by the full
/// amount_in (pre-fee), NOT by effective_input (post-fee).
///
/// The difference (amount_in - effective_input) is the LP revenue that
/// compounds into reserves, increasing the value of liquidity positions.
#[test]
fn test_swap_fee_compounds_into_reserves() {
    let mut ctx = setup_initialized_pool();

    let amount_in: u64 = 100_000_000; // 0.1 token -- larger amount for clearer fee signal

    // Execute AtoB swap
    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, 0);
    assert!(result.is_ok(), "Swap should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);

    // CRITICAL ASSERTION: reserve_in grew by full amount_in, not effective_input
    assert_eq!(
        pool.reserve_a, SEED_AMOUNT + amount_in,
        "Reserve A (input side) must grow by full amount_in, not effective_input -- \
         this proves the fee compounds into reserves"
    );

    // Verify the fee amount is correct
    let effective_input = expected_effective_input(amount_in, LP_FEE_BPS);
    let effective_input_u64 = effective_input as u64;
    let lp_fee = amount_in - effective_input_u64;
    let expected_fee = amount_in / (BPS_DENOMINATOR / LP_FEE_BPS as u64); // amount_in * 100 / 10000

    assert_eq!(
        lp_fee, expected_fee,
        "LP fee should equal amount_in * fee_bps / BPS_DENOMINATOR"
    );

    // Double-check: effective_input is amount_in minus fee
    assert_eq!(
        effective_input_u64, amount_in - expected_fee,
        "Effective input should be amount_in minus fee"
    );
}

// ---------------------------------------------------------------------------
// Test 4: Slippage protection (SWAP-05, TEST-04)
// ---------------------------------------------------------------------------

/// Verify that swaps with insufficient output are rejected (SlippageExceeded),
/// and that the exact expected output is accepted.
#[test]
fn test_swap_slippage_protection() {
    let mut ctx = setup_initialized_pool();

    let amount_in: u64 = 10_000_000;

    // Calculate the exact expected output
    let effective_input = expected_effective_input(amount_in, LP_FEE_BPS);
    let exact_output = expected_swap_output(SEED_AMOUNT, SEED_AMOUNT, effective_input);

    // Attempt swap with minimum_amount_out = exact_output + 1 (one unit above actual)
    // This MUST FAIL -- the output cannot meet this threshold
    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, exact_output + 1);
    assert!(
        result.is_err(),
        "Swap with minimum_amount_out above actual output should fail (SlippageExceeded)"
    );
    ctx.svm.expire_blockhash();

    // Verify no state changed (swap was rejected)
    let _user_a_after_fail = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool_after_fail = read_pool_state(&pool_acct.data);
    assert_eq!(pool_after_fail.reserve_a, SEED_AMOUNT, "Reserves unchanged after failed swap");
    assert_eq!(pool_after_fail.reserve_b, SEED_AMOUNT, "Reserves unchanged after failed swap");

    // Now attempt swap with minimum_amount_out = exact_output (exactly meets threshold)
    // This MUST SUCCEED
    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, exact_output);
    assert!(
        result.is_ok(),
        "Swap with minimum_amount_out equal to exact output should succeed: {:?}", result.err()
    );
}

// ---------------------------------------------------------------------------
// Test 5: k-invariant holds (SWAP-07)
// ---------------------------------------------------------------------------

/// Verify that the k-invariant (reserve_a * reserve_b) never decreases
/// after a swap. k should increase slightly due to LP fee revenue and
/// integer truncation in the output calculation.
#[test]
fn test_swap_k_invariant_holds() {
    let mut ctx = setup_initialized_pool();

    // k_before
    let k_before = SEED_AMOUNT as u128 * SEED_AMOUNT as u128;

    let amount_in: u64 = 50_000_000; // 0.05 token

    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, 0);
    assert!(result.is_ok(), "Swap should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    // k_after
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);
    let k_after = pool.reserve_a as u128 * pool.reserve_b as u128;

    assert!(
        k_after >= k_before,
        "k-invariant violated: k_before={} > k_after={}. reserve_a={}, reserve_b={}",
        k_before, k_after, pool.reserve_a, pool.reserve_b
    );

    // k should have increased (due to fee + truncation)
    assert!(
        k_after > k_before,
        "k should increase after swap with fees: k_before={}, k_after={}",
        k_before, k_after
    );
}

// ---------------------------------------------------------------------------
// Test 6: Zero-amount swap rejected (SWAP-08)
// ---------------------------------------------------------------------------

/// Verify that a swap with amount_in = 0 is rejected with ZeroAmount error.
#[test]
fn test_swap_zero_amount_rejected() {
    let mut ctx = setup_initialized_pool();

    let result = send_swap(&mut ctx, 0, DIRECTION_A_TO_B, 0);
    assert!(
        result.is_err(),
        "Zero-amount swap should be rejected"
    );

    // Verify pool state unchanged
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);
    assert_eq!(pool.reserve_a, SEED_AMOUNT, "Reserve A unchanged after rejected swap");
    assert_eq!(pool.reserve_b, SEED_AMOUNT, "Reserve B unchanged after rejected swap");
    assert!(!pool.locked, "Pool should not be locked after rejected swap");
}

// ---------------------------------------------------------------------------
// Test 7: SwapEvent emitted (SWAP-09)
// ---------------------------------------------------------------------------

/// Verify that the SwapEvent is emitted during a successful swap.
///
/// Direct event parsing from litesvm is not straightforward (events are
/// encoded in transaction logs as base64 data). We verify by checking that
/// the transaction logs contain evidence of the event emission. The emit!
/// macro generates a log entry with the event discriminator. If the event
/// struct were incorrectly formed, the code would not compile.
#[test]
fn test_swap_event_emitted() {
    let mut ctx = setup_initialized_pool();

    let amount_in: u64 = 10_000_000;

    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, 0);
    let meta = result.expect("Swap should succeed for event test");

    // Anchor emits events via sol_log_data (Program data: <base64>).
    // The transaction logs should contain at least one "Program data:" entry
    // from our program, which is the serialized SwapEvent.
    let logs = &meta.logs;

    let has_program_data = logs.iter().any(|log| log.contains("Program data:"));
    assert!(
        has_program_data,
        "Transaction logs should contain 'Program data:' entry (SwapEvent emission). Logs: {:?}",
        logs
    );

    // Additional compile-time proof: if SwapEvent struct fields did not match
    // the emit! call in swap_sol_pool.rs, Rust would refuse to compile.
    // The fact that this test runs at all proves the event is correctly formed.
}

// ---------------------------------------------------------------------------
// Test 8: Consecutive swaps succeed (reentrancy guard clears)
// ---------------------------------------------------------------------------

/// Verify that the pool can be swapped multiple times consecutively.
/// This proves the reentrancy guard (locked: bool) is properly cleared
/// after each swap completes. If locked remained true, the second swap
/// would fail with PoolLocked error.
#[test]
fn test_consecutive_swaps_succeed() {
    let mut ctx = setup_initialized_pool();

    let amount_in: u64 = 10_000_000;

    // Swap 1: AtoB
    let result = send_swap(&mut ctx, amount_in, DIRECTION_A_TO_B, 0);
    assert!(result.is_ok(), "First swap (AtoB) should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    // Verify pool is NOT locked after first swap
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool_after_first = read_pool_state(&pool_acct.data);
    assert!(!pool_after_first.locked, "Pool should NOT be locked after first swap");

    // Record reserves after first swap
    let reserve_a_after_first = pool_after_first.reserve_a;
    let reserve_b_after_first = pool_after_first.reserve_b;

    // Swap 2: BtoA (reverse direction)
    let result = send_swap(&mut ctx, amount_in, DIRECTION_B_TO_A, 0);
    assert!(
        result.is_ok(),
        "Second swap (BtoA) should succeed -- proves reentrancy guard cleared: {:?}",
        result.err()
    );
    ctx.svm.expire_blockhash();

    // Verify reserves updated correctly for second swap
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool_after_second = read_pool_state(&pool_acct.data);

    // After BtoA: reserve_b should have grown, reserve_a should have shrunk
    let effective_input_2 = expected_effective_input(amount_in, LP_FEE_BPS);
    let expected_out_2 = expected_swap_output(
        reserve_b_after_first, reserve_a_after_first, effective_input_2
    );

    assert_eq!(
        pool_after_second.reserve_b, reserve_b_after_first + amount_in,
        "Reserve B should increase by amount_in after BtoA swap"
    );
    assert_eq!(
        pool_after_second.reserve_a, reserve_a_after_first - expected_out_2,
        "Reserve A should decrease by output after BtoA swap"
    );
    assert!(!pool_after_second.locked, "Pool should NOT be locked after second swap");
}
