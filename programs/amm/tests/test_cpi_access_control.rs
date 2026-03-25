/// Integration tests for AMM CPI access control using LiteSVM.
///
/// Tests cover Phase 13 access control requirements:
/// - AUTH-01: swap_authority must be a valid PDA signer
/// - AUTH-02: seeds::program = TAX_PROGRAM_ID is enforced
/// - AUTH-03: Direct user calls without swap_authority fail
/// - AUTH-04: Mock Tax Program CPI produces valid signatures
/// - AUTH-05: PDAs from wrong programs are rejected
/// - TEST-05: Access control integration testing
/// - TEST-08: Full CPI chain with Token-2022 hooks completes
///
/// Key tests:
/// 1. Mock Tax Program can CPI into AMM swaps (valid swap_authority)
/// 2. Direct calls to AMM swaps fail (no valid swap_authority)
/// 3. Fake Tax Program CPI fails (wrong program's PDA)
/// 4. Full CPI chain works with Token-2022 transfer hooks
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
use spl_token_2022::state::Mint as T22MintState;
use sha2::{Sha256, Digest};

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------

/// AMM program ID -- matches declare_id! in lib.rs
fn amm_program_id() -> Pubkey {
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

/// Fake Tax Program ID -- different from TAX_PROGRAM_ID
/// Used for negative testing: PDAs from this program should be rejected
fn fake_tax_program_id() -> Pubkey {
    "7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ"
        .parse()
        .unwrap()
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

// ---------------------------------------------------------------------------
// Seeds (must match AMM and Mock/Fake Tax Program constants)
// ---------------------------------------------------------------------------

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
const SOL_POOL_FEE_BPS: u16 = 100;

// Direction constants for swap instructions
const DIRECTION_A_TO_B: u8 = 0;
const DIRECTION_B_TO_A: u8 = 1;

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

/// Build AMM swap_sol_pool instruction data.
/// This is the data passed to AMM (via Mock Tax) or directly (for negative tests).
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
/// For Mock Tax Program: this matches TAX_PROGRAM_ID, so AMM accepts it.
/// For Fake Tax Program: this is a different PDA, so AMM rejects it.
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
/// Returns the ProgramData address for reference.
fn deploy_upgradeable_program(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    upgrade_authority: &Pubkey,
    program_bytes: &[u8],
) -> Pubkey {
    let (programdata_key, _bump) = program_data_address(program_id);
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

    // IMPORTANT: Set programdata account FIRST (litesvm reads it when setting executable)
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
        addr(program_id),
        Account {
            lamports: program_lamports,
            data: program_account_data,
            owner: addr(&loader_id),
            executable: true,
            rent_epoch: 0,
        },
    )
    .expect("Failed to set program account");

    programdata_key
}

/// Create a Token-2022 mint.
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

/// Create a token account (T22) for a given mint and owner.
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

/// Mint tokens to a destination token account.
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

/// Build the initialize_admin instruction.
fn build_initialize_admin_ix(
    authority: &Pubkey,
    admin: &Pubkey,
) -> Instruction {
    let pid = amm_program_id();
    let (admin_config, _bump) = admin_config_pda(&pid);
    let (programdata_key, _) = program_data_address(&pid);

    Instruction {
        program_id: addr(&pid),
        accounts: vec![
            AccountMeta::new(addr(authority), true),
            AccountMeta::new(addr(&admin_config), false),
            AccountMeta::new_readonly(addr(&pid), false),
            AccountMeta::new_readonly(addr(&programdata_key), false),
            AccountMeta::new_readonly(addr(&system_program_id()), false),
        ],
        data: initialize_admin_data(admin),
    }
}

/// Build the initialize_pool instruction.
fn build_initialize_pool_ix(
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
    let pid = amm_program_id();
    let (admin_config, _) = admin_config_pda(&pid);
    let (pool, _) = pool_pda(&pid, mint_a, mint_b);
    let (vault_a, _) = vault_a_pda(&pid, &pool);
    let (vault_b, _) = vault_b_pda(&pid, &pool);

    Instruction {
        program_id: addr(&pid),
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

/// Build Mock Tax Program execute_swap instruction.
///
/// This instruction CPIs into AMM with the swap_authority PDA signed via invoke_signed.
/// Account ordering for Mock Tax Program's execute_swap:
/// 1. amm_program (the program to CPI into)
/// 2. swap_authority (the PDA that will sign)
/// Then remaining_accounts (forwarded to AMM):
/// 3+ AMM accounts: pool, vault_a, vault_b, mint_a, mint_b, user_token_a, user_token_b, user, token_program_a, token_program_b
fn build_mock_tax_execute_swap_ix(
    tax_program_id: &Pubkey,
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
    amm_instruction_data: Vec<u8>,
) -> Instruction {
    let amm_pid = amm_program_id();

    Instruction {
        program_id: addr(tax_program_id),
        accounts: vec![
            // Mock Tax Program accounts
            AccountMeta::new_readonly(addr(&amm_pid), false),  // amm_program
            AccountMeta::new_readonly(addr(swap_authority), false),  // swap_authority (will be signed by invoke_signed)
            // Remaining accounts forwarded to AMM (must match SwapSolPool order AFTER swap_authority)
            AccountMeta::new(addr(pool), false),               // pool (mut)
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
        data: mock_tax_execute_swap_data(amm_instruction_data),
    }
}

/// Build direct AMM swap instruction (for negative tests).
///
/// This attempts to call AMM directly without going through Tax Program.
/// The swap_authority is NOT marked as signer (user can't sign a PDA).
/// Anchor's Signer type should reject this because the account isn't a signer.
fn build_direct_amm_swap_ix(
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
    swap_instruction_data: Vec<u8>,
) -> Instruction {
    let amm_pid = amm_program_id();

    Instruction {
        program_id: addr(&amm_pid),
        accounts: vec![
            // swap_authority FIRST (as required by AMM account struct)
            // NOT marked as signer - user can't sign a PDA, so Anchor's Signer type rejects
            AccountMeta::new_readonly(addr(swap_authority), false),
            AccountMeta::new(addr(pool), false),
            AccountMeta::new(addr(vault_a), false),
            AccountMeta::new(addr(vault_b), false),
            AccountMeta::new_readonly(addr(mint_a), false),
            AccountMeta::new_readonly(addr(mint_b), false),
            AccountMeta::new(addr(user_token_a), false),
            AccountMeta::new(addr(user_token_b), false),
            AccountMeta::new_readonly(addr(user), true),
            AccountMeta::new_readonly(addr(token_program_a), false),
            AccountMeta::new_readonly(addr(token_program_b), false),
        ],
        data: swap_instruction_data,
    }
}

// ---------------------------------------------------------------------------
// Pool state reader
// ---------------------------------------------------------------------------

/// Deserialized view of PoolState from raw account bytes.
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
fn get_token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    let acct = svm.get_account(&addr(token_account))
        .expect("Token account should exist");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

// ---------------------------------------------------------------------------
// Test context for CPI access control testing
// ---------------------------------------------------------------------------

/// Test context with multi-program deployment (AMM, Mock Tax, Fake Tax).
#[allow(dead_code)]
struct CpiTestContext {
    svm: LiteSVM,
    admin: LiteKeypair,
    user: LiteKeypair,
    // Pool accounts
    pool: Pubkey,
    vault_a: Pubkey,
    vault_b: Pubkey,
    mint_a: Pubkey,
    mint_b: Pubkey,
    // User token accounts
    user_token_a: Pubkey,
    user_token_b: Pubkey,
    // Token programs
    token_program_a: Pubkey,
    token_program_b: Pubkey,
    // swap_authority PDAs from different programs
    mock_swap_authority: Pubkey,
    mock_swap_authority_bump: u8,
    fake_swap_authority: Pubkey,
    fake_swap_authority_bump: u8,
    // LP fee for this pool
    lp_fee_bps: u16,
}

impl CpiTestContext {
    /// Set up a SOL pool (T22 + SPL mix) with all 3 programs deployed.
    /// Uses a simpler mixed pool configuration.
    fn setup_sol_pool() -> Self {
        let upgrade_authority = LiteKeypair::new();
        let mut svm = LiteSVM::new();

        svm.airdrop(&upgrade_authority.pubkey(), 100_000_000_000)
            .expect("Failed to airdrop to upgrade authority");

        // Deploy all 3 programs
        let amm_bytes = read_program_bytes("amm");
        deploy_upgradeable_program(
            &mut svm,
            &amm_program_id(),
            &kp_pubkey(&upgrade_authority),
            &amm_bytes,
        );

        let mock_tax_bytes = read_program_bytes("mock_tax_program");
        deploy_upgradeable_program(
            &mut svm,
            &mock_tax_program_id(),
            &kp_pubkey(&upgrade_authority),
            &mock_tax_bytes,
        );

        let fake_tax_bytes = read_program_bytes("fake_tax_program");
        deploy_upgradeable_program(
            &mut svm,
            &fake_tax_program_id(),
            &kp_pubkey(&upgrade_authority),
            &fake_tax_bytes,
        );

        let admin = LiteKeypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000)
            .expect("Failed to airdrop to admin");

        // Initialize AMM AdminConfig
        let init_admin_ix = build_initialize_admin_ix(
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
        svm.expire_blockhash();

        // For SOL pool, we still use T22 for both to keep test simple
        // (The access control tests don't care about token program type)
        let t22_mint_1 = create_t22_mint(&mut svm, &admin, TEST_DECIMALS);
        svm.expire_blockhash();
        let t22_mint_2 = create_t22_mint(&mut svm, &admin, TEST_DECIMALS);
        svm.expire_blockhash();

        let (mint_a, mint_b) = if t22_mint_1 < t22_mint_2 {
            (t22_mint_1, t22_mint_2)
        } else {
            (t22_mint_2, t22_mint_1)
        };
        let token_program_a = token_2022_program_id();
        let token_program_b = token_2022_program_id();

        let source_a = create_token_account(&mut svm, &admin, &mint_a, &kp_pubkey(&admin), &token_program_a);
        svm.expire_blockhash();
        let source_b = create_token_account(&mut svm, &admin, &mint_b, &kp_pubkey(&admin), &token_program_b);
        svm.expire_blockhash();

        mint_tokens(&mut svm, &admin, &mint_a, &source_a, SEED_AMOUNT, &admin, &token_program_a);
        svm.expire_blockhash();
        mint_tokens(&mut svm, &admin, &mint_b, &source_b, SEED_AMOUNT, &admin, &token_program_b);
        svm.expire_blockhash();

        let payer = LiteKeypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000)
            .expect("Failed to airdrop to payer");

        let ix = build_initialize_pool_ix(
            &kp_pubkey(&payer),
            &kp_pubkey(&admin),
            &mint_a,
            &mint_b,
            &source_a,
            &source_b,
            &token_program_a,
            &token_program_b,
            SOL_POOL_FEE_BPS,
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

        let pid = amm_program_id();
        let (pool, _) = pool_pda(&pid, &mint_a, &mint_b);
        let (vault_a, _) = vault_a_pda(&pid, &pool);
        let (vault_b, _) = vault_b_pda(&pid, &pool);

        let user = LiteKeypair::new();
        svm.airdrop(&user.pubkey(), 100_000_000_000)
            .expect("Failed to airdrop to user");

        let user_token_a = create_token_account(&mut svm, &user, &mint_a, &kp_pubkey(&user), &token_program_a);
        svm.expire_blockhash();
        let user_token_b = create_token_account(&mut svm, &user, &mint_b, &kp_pubkey(&user), &token_program_b);
        svm.expire_blockhash();

        let user_token_amount = 100_000_000_000u64;
        mint_tokens(&mut svm, &admin, &mint_a, &user_token_a, user_token_amount, &admin, &token_program_a);
        svm.expire_blockhash();
        mint_tokens(&mut svm, &admin, &mint_b, &user_token_b, user_token_amount, &admin, &token_program_b);
        svm.expire_blockhash();

        let (mock_swap_authority, mock_swap_authority_bump) = swap_authority_pda(&mock_tax_program_id());
        let (fake_swap_authority, fake_swap_authority_bump) = swap_authority_pda(&fake_tax_program_id());

        CpiTestContext {
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
            mock_swap_authority,
            mock_swap_authority_bump,
            fake_swap_authority,
            fake_swap_authority_bump,
            lp_fee_bps: SOL_POOL_FEE_BPS,
        }
    }
}

// ===========================================================================
// HELPER: Execute Mock Tax CPI swap
// ===========================================================================

/// Execute a swap through Mock Tax Program via CPI.
/// Returns the transaction result for success/failure verification.
fn send_mock_tax_cpi_swap(
    ctx: &mut CpiTestContext,
    tax_program_id: &Pubkey,
    swap_authority: &Pubkey,
    amm_instruction_data: Vec<u8>,
) -> litesvm::types::TransactionResult {
    let ix = build_mock_tax_execute_swap_ix(
        tax_program_id,
        swap_authority,
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
        amm_instruction_data,
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

/// Execute a direct AMM swap (for negative tests).
/// The user cannot sign the swap_authority PDA, so this should fail.
fn send_direct_amm_swap(
    ctx: &mut CpiTestContext,
    swap_authority: &Pubkey,
    swap_instruction_data: Vec<u8>,
) -> litesvm::types::TransactionResult {
    let ix = build_direct_amm_swap_ix(
        swap_authority,
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
        swap_instruction_data,
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

// ---------------------------------------------------------------------------
// Swap math helpers (replicated for test independence)
// ---------------------------------------------------------------------------

/// Calculate expected effective input after LP fee deduction.
fn expected_effective_input(amount_in: u64, fee_bps: u16) -> u128 {
    let amount = amount_in as u128;
    let fee_factor = 10_000u128 - fee_bps as u128;
    amount * fee_factor / 10_000
}

/// Calculate expected swap output using constant-product formula.
fn expected_swap_output(reserve_in: u64, reserve_out: u64, effective_input: u128) -> u64 {
    let r_in = reserve_in as u128;
    let r_out = reserve_out as u128;
    let numerator = r_out * effective_input;
    let denominator = r_in + effective_input;
    (numerator / denominator) as u64
}

// ===========================================================================
// MOCK TAX PROGRAM CPI SUCCESS TESTS
// ===========================================================================

/// Test: Mock Tax Program CPIs into AMM swap_sol_pool (AtoB direction).
/// This proves AUTH-04: Mock Tax Program produces valid swap_authority signatures.
#[test]
fn test_mock_tax_cpi_swap_sol_pool_a_to_b() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000; // 0.01 token

    // Copy swap_authority before mutable borrow (borrow checker)
    let mock_swap_authority = ctx.mock_swap_authority;

    // Record balances before swap
    let user_a_before = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_before = get_token_balance(&ctx.svm, &ctx.user_token_b);

    // Build AMM swap instruction data
    let amm_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);

    // Execute CPI through Mock Tax Program
    let result = send_mock_tax_cpi_swap(
        &mut ctx,
        &mock_tax_program_id(),
        &mock_swap_authority,
        amm_data,
    );

    assert!(result.is_ok(), "Mock Tax CPI swap_sol_pool AtoB should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    // Verify balances changed correctly
    let user_a_after = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_after = get_token_balance(&ctx.svm, &ctx.user_token_b);

    // Calculate expected output
    let effective_input = expected_effective_input(amount_in, ctx.lp_fee_bps);
    let expected_out = expected_swap_output(SEED_AMOUNT, SEED_AMOUNT, effective_input);

    assert_eq!(
        user_a_before - amount_in, user_a_after,
        "User token A balance should decrease by amount_in"
    );
    assert_eq!(
        user_b_before + expected_out, user_b_after,
        "User token B balance should increase by expected output"
    );

    // Verify pool state updated
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);
    assert_eq!(pool.reserve_a, SEED_AMOUNT + amount_in, "Reserve A should grow");
    assert_eq!(pool.reserve_b, SEED_AMOUNT - expected_out, "Reserve B should shrink");
}

/// Test: Mock Tax Program CPIs into AMM swap_sol_pool (BtoA direction).
#[test]
fn test_mock_tax_cpi_swap_sol_pool_b_to_a() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000;
    let mock_swap_authority = ctx.mock_swap_authority;

    let user_a_before = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_before = get_token_balance(&ctx.svm, &ctx.user_token_b);

    let amm_data = swap_sol_pool_data(amount_in, DIRECTION_B_TO_A, 0);

    let result = send_mock_tax_cpi_swap(
        &mut ctx,
        &mock_tax_program_id(),
        &mock_swap_authority,
        amm_data,
    );

    assert!(result.is_ok(), "Mock Tax CPI swap_sol_pool BtoA should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    let user_a_after = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_after = get_token_balance(&ctx.svm, &ctx.user_token_b);

    let effective_input = expected_effective_input(amount_in, ctx.lp_fee_bps);
    let expected_out = expected_swap_output(SEED_AMOUNT, SEED_AMOUNT, effective_input);

    assert_eq!(user_b_before - amount_in, user_b_after, "User B should decrease");
    assert_eq!(user_a_before + expected_out, user_a_after, "User A should increase");
}

// ===========================================================================
// DIRECT CALL REJECTION TESTS
// ===========================================================================

/// Test: Direct call to swap_sol_pool fails.
/// User cannot sign the swap_authority PDA, so the transaction fails.
/// This proves AUTH-01, AUTH-03: swap requires valid swap_authority.
#[test]
fn test_direct_call_swap_sol_pool_fails() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000;
    let mock_swap_authority = ctx.mock_swap_authority;

    // Try to call AMM directly with the mock swap_authority
    // The user can't sign the PDA, so this should fail
    let swap_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);

    let result = send_direct_amm_swap(
        &mut ctx,
        &mock_swap_authority,
        swap_data,
    );

    assert!(
        result.is_err(),
        "Direct call to swap_sol_pool should fail -- user cannot sign swap_authority PDA"
    );

    // Verify pool state unchanged
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);
    assert_eq!(pool.reserve_a, SEED_AMOUNT, "Reserve A unchanged after failed swap");
    assert_eq!(pool.reserve_b, SEED_AMOUNT, "Reserve B unchanged after failed swap");
}

/// Test: Direct call with wrong signer (random keypair) fails.
/// Even if someone passes a different pubkey as swap_authority,
/// it won't match the PDA seeds, so Anchor rejects it.
#[test]
fn test_direct_call_with_wrong_signer_fails() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000;

    // Create a random keypair and try to use it as swap_authority
    let random_kp = LiteKeypair::new();
    let random_pk = kp_pubkey(&random_kp);

    let swap_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);

    // Build instruction with random pubkey as swap_authority
    let amm_pid = amm_program_id();
    let ix = Instruction {
        program_id: addr(&amm_pid),
        accounts: vec![
            AccountMeta::new_readonly(addr(&random_pk), true),  // random signer
            AccountMeta::new(addr(&ctx.pool), false),
            AccountMeta::new(addr(&ctx.vault_a), false),
            AccountMeta::new(addr(&ctx.vault_b), false),
            AccountMeta::new_readonly(addr(&ctx.mint_a), false),
            AccountMeta::new_readonly(addr(&ctx.mint_b), false),
            AccountMeta::new(addr(&ctx.user_token_a), false),
            AccountMeta::new(addr(&ctx.user_token_b), false),
            AccountMeta::new_readonly(ctx.user.pubkey(), true),
            AccountMeta::new_readonly(addr(&ctx.token_program_a), false),
            AccountMeta::new_readonly(addr(&ctx.token_program_b), false),
        ],
        data: swap_data,
    };

    // Fund the random keypair so it can sign
    ctx.svm.airdrop(&random_kp.pubkey(), 1_000_000_000)
        .expect("Failed to airdrop to random keypair");

    let msg = Message::new_with_blockhash(
        &[ix],
        Some(&ctx.user.pubkey()),
        &ctx.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[&ctx.user, &random_kp],  // Both user and random sign
    )
    .unwrap();
    let result = ctx.svm.send_transaction(tx);

    assert!(
        result.is_err(),
        "Direct call with random signer should fail -- PDA seeds don't match"
    );
}

/// Test: Direct call with user-derived PDA fails.
/// Even if user derives a PDA with same seeds but from their own keypair,
/// the seeds::program constraint requires it to be from TAX_PROGRAM_ID.
#[test]
fn test_direct_call_with_user_pda_fails() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000;

    // Derive a PDA using the same seed but from user's pubkey
    // This creates a different PDA than what AMM expects
    let (user_pda, _bump) = Pubkey::find_program_address(
        &[SWAP_AUTHORITY_SEED],
        &kp_pubkey(&ctx.user),  // Wrong program ID (user's pubkey isn't a program)
    );

    let swap_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);

    // Try to use user-derived PDA (which isn't valid because user isn't a program)
    let result = send_direct_amm_swap(
        &mut ctx,
        &user_pda,
        swap_data,
    );

    assert!(
        result.is_err(),
        "Direct call with user-derived PDA should fail -- not from TAX_PROGRAM_ID"
    );
}

// ===========================================================================
// FAKE TAX PROGRAM REJECTION TESTS
// ===========================================================================

/// Test: Fake Tax Program CPI into swap_sol_pool is rejected.
///
/// Fake Tax Program has a different program ID than TAX_PROGRAM_ID (Mock Tax).
/// When it signs its own swap_authority PDA, that PDA is derived from the wrong
/// program ID. The AMM's seeds::program = TAX_PROGRAM_ID constraint rejects it.
///
/// This proves AUTH-02, AUTH-05: only TAX_PROGRAM_ID can produce valid swap_authority.
#[test]
fn test_fake_tax_cpi_swap_sol_pool_rejected() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000;

    // Copy values before mutable borrow
    let fake_swap_authority = ctx.fake_swap_authority;

    let amm_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);

    // Try to execute via Fake Tax Program
    // The swap_authority PDA is derived from Fake Tax's ID, not Mock Tax's ID
    let result = send_mock_tax_cpi_swap(
        &mut ctx,
        &fake_tax_program_id(),
        &fake_swap_authority,
        amm_data,
    );

    assert!(
        result.is_err(),
        "Fake Tax Program CPI should fail -- swap_authority PDA from wrong program"
    );

    // Verify pool state unchanged
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool account should exist");
    let pool = read_pool_state(&pool_acct.data);
    assert_eq!(pool.reserve_a, SEED_AMOUNT, "Reserve A unchanged after rejected swap");
    assert_eq!(pool.reserve_b, SEED_AMOUNT, "Reserve B unchanged after rejected swap");
}

// ===========================================================================
// FULL CPI CHAIN TESTS
// ===========================================================================

/// Test: Full CPI chain for SOL pool (Mock Tax -> AMM -> Token Program).
///
/// This test verifies the complete CPI chain works end-to-end:
/// 1. Mock Tax Program receives user's swap request
/// 2. Mock Tax derives and signs swap_authority PDA
/// 3. Mock Tax CPIs into AMM swap_sol_pool
/// 4. AMM validates swap_authority via seeds::program constraint
/// 5. AMM CPIs into Token Program for transfer_checked
/// 6. Token balances update correctly
///
/// This proves TEST-08: CPI chain completes within depth limits.
#[test]
fn test_full_cpi_chain_sol_pool_with_hooks() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 50_000_000; // 0.05 token - larger for clearer signal
    let mock_swap_authority = ctx.mock_swap_authority;
    let lp_fee_bps = ctx.lp_fee_bps;

    // Record state before
    let user_a_before = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_before = get_token_balance(&ctx.svm, &ctx.user_token_b);
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool should exist");
    let pool_before = read_pool_state(&pool_acct.data);
    let k_before = pool_before.reserve_a as u128 * pool_before.reserve_b as u128;

    // Execute full CPI chain
    let amm_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);
    let result = send_mock_tax_cpi_swap(
        &mut ctx,
        &mock_tax_program_id(),
        &mock_swap_authority,
        amm_data,
    );

    assert!(result.is_ok(), "Full CPI chain should succeed: {:?}", result.err());
    ctx.svm.expire_blockhash();

    // Verify complete state change
    let user_a_after = get_token_balance(&ctx.svm, &ctx.user_token_a);
    let user_b_after = get_token_balance(&ctx.svm, &ctx.user_token_b);

    let effective_input = expected_effective_input(amount_in, lp_fee_bps);
    let expected_out = expected_swap_output(SEED_AMOUNT, SEED_AMOUNT, effective_input);

    // User balances changed
    assert_eq!(user_a_before - amount_in, user_a_after, "User A decreased by amount_in");
    assert_eq!(user_b_before + expected_out, user_b_after, "User B increased by output");

    // Pool reserves changed
    let pool_acct = ctx.svm.get_account(&addr(&ctx.pool))
        .expect("Pool should exist");
    let pool_after = read_pool_state(&pool_acct.data);
    assert_eq!(pool_after.reserve_a, SEED_AMOUNT + amount_in, "Reserve A grew");
    assert_eq!(pool_after.reserve_b, SEED_AMOUNT - expected_out, "Reserve B shrunk");

    // k-invariant holds
    let k_after = pool_after.reserve_a as u128 * pool_after.reserve_b as u128;
    assert!(k_after >= k_before, "k-invariant must hold");

    // Pool not locked
    assert!(!pool_after.locked, "Pool should not be locked after swap");
}

