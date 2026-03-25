/**
 * Localnet Initialization Script
 *
 * Initializes the complete staking + Transfer Hook system in the correct order:
 * 1. Transfer Hook - WhitelistAuthority (must exist before any whitelist entries)
 * 2. PROFIT mint creation + ExtraAccountMetaList + StakePool init (creates StakeVault PDA)
 * 3. Transfer Hook - Add StakeVault to whitelist (entry #14)
 *
 * The order matters because:
 * - WhitelistAuthority must exist before addWhitelistEntry or initExtraAccountMetaList
 * - ExtraAccountMetaList must exist before any transfer_checked with hook
 * - StakePool init creates the StakeVault PDA (cannot whitelist what doesn't exist)
 * - StakeVault must be whitelisted before any stake/unstake operations
 *
 * Usage: npx ts-node scripts/init-localnet.ts
 *
 * Prerequisites:
 * - Local validator running (solana-test-validator or anchor localnet)
 * - Programs deployed to localnet (anchor build && anchor deploy)
 * - keypairs/devnet-wallet.json exists with SOL
 *
 * Source: .planning/phases/28-token-flow-whitelist/28-03-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  getMintLen,
  ExtensionType,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";

// Load program IDLs from anchor workspace
import { Staking } from "../target/types/staking";
import { TransferHook } from "../target/types/transfer_hook";

// =============================================================================
// Constants (must match on-chain program constants)
// =============================================================================

const PROFIT_DECIMALS = 6;
const MINIMUM_STAKE = 1_000_000; // 1 PROFIT (6 decimals)

// PDA seeds - must match programs/staking/src/constants.rs
const STAKE_POOL_SEED = Buffer.from("stake_pool");
const ESCROW_VAULT_SEED = Buffer.from("escrow_vault");
const STAKE_VAULT_SEED = Buffer.from("stake_vault");

// PDA seeds - must match programs/transfer-hook/src/state/
const WHITELIST_AUTHORITY_SEED = Buffer.from("authority");
const WHITELIST_ENTRY_SEED = Buffer.from("whitelist");

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if an account already exists on-chain.
 * Returns true if the account has data (i.e., has been initialized).
 */
async function accountExists(
  connection: anchor.web3.Connection,
  address: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null && info.data.length > 0;
}

/**
 * Check if an error indicates "already initialized" (account already exists).
 * Anchor's init constraint fails with a specific error when PDA already exists.
 */
function isAlreadyInitialized(err: any): boolean {
  const msg = err?.toString() ?? "";
  return (
    msg.includes("already in use") ||
    msg.includes("already been processed") ||
    msg.includes("custom program error: 0x0") ||
    msg.includes("Account already initialized") ||
    msg.includes("Error processing Instruction")
  );
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("=== Dr. Fraudsworth Localnet Initialization ===\n");

  // ---------------------------------------------------------------------------
  // Setup: Load provider, admin keypair, and programs
  // ---------------------------------------------------------------------------
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  // Load admin keypair from devnet-wallet (per 28-CONTEXT.md)
  const adminKeypairPath = "keypairs/devnet-wallet.json";
  if (!fs.existsSync(adminKeypairPath)) {
    console.error(`ERROR: Admin keypair not found at ${adminKeypairPath}`);
    console.error("Create it with: solana-keygen new -o keypairs/devnet-wallet.json");
    process.exit(1);
  }
  const adminSecretKey = JSON.parse(fs.readFileSync(adminKeypairPath, "utf8"));
  const admin = Keypair.fromSecretKey(new Uint8Array(adminSecretKey));
  console.log("Admin:", admin.publicKey.toBase58());

  // Check admin SOL balance
  const balance = await connection.getBalance(admin.publicKey);
  console.log("Admin SOL balance:", balance / LAMPORTS_PER_SOL, "SOL");
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("Low balance - requesting airdrop...");
    const sig = await connection.requestAirdrop(admin.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log("Airdrop confirmed");
  }

  // Load programs from anchor workspace
  const stakingProgram = anchor.workspace.Staking as Program<Staking>;
  const hookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  console.log("Staking Program:", stakingProgram.programId.toBase58());
  console.log("Transfer Hook Program:", hookProgram.programId.toBase58());

  // ===========================================================================
  // Step 1: Initialize Transfer Hook WhitelistAuthority
  //
  // WHY FIRST: The WhitelistAuthority PDA must exist before we can:
  //   - Initialize ExtraAccountMetaList (checks authority)
  //   - Add any whitelist entries (checked against authority)
  // ===========================================================================
  console.log("\n=== Step 1: Initialize Transfer Hook WhitelistAuthority ===");

  const [whitelistAuthority] = PublicKey.findProgramAddressSync(
    [WHITELIST_AUTHORITY_SEED],
    hookProgram.programId
  );

  if (await accountExists(connection, whitelistAuthority)) {
    console.log("SKIP: WhitelistAuthority already initialized at", whitelistAuthority.toBase58());
  } else {
    try {
      await hookProgram.methods
        .initializeAuthority()
        .accountsStrict({
          signer: admin.publicKey,
          whitelistAuthority,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      console.log("OK: WhitelistAuthority initialized at", whitelistAuthority.toBase58());
    } catch (err: any) {
      if (isAlreadyInitialized(err)) {
        console.log("SKIP: WhitelistAuthority already initialized (caught init error)");
      } else {
        throw err;
      }
    }
  }

  // ===========================================================================
  // Step 2: Create PROFIT mint + ExtraAccountMetaList + Initialize StakePool
  //
  // WHY THIS ORDER:
  //   a) PROFIT mint must exist with Transfer Hook extension before anything
  //   b) ExtraAccountMetaList must exist for this mint before transfer_checked
  //   c) StakePool init does a transfer_checked (dead stake), needs hook setup
  //   d) StakePool init creates StakeVault PDA (needed for step 3 whitelisting)
  //
  // NOTE: On re-run, the mint already exists and StakePool is already initialized.
  // We detect this by checking if the StakePool PDA has data.
  // ===========================================================================
  console.log("\n=== Step 2: Create PROFIT Mint + Initialize StakePool ===");

  // Derive Staking PDAs
  const [stakePool] = PublicKey.findProgramAddressSync(
    [STAKE_POOL_SEED],
    stakingProgram.programId
  );
  const [escrowVault] = PublicKey.findProgramAddressSync(
    [ESCROW_VAULT_SEED],
    stakingProgram.programId
  );
  const [stakeVault] = PublicKey.findProgramAddressSync(
    [STAKE_VAULT_SEED],
    stakingProgram.programId
  );

  console.log("StakePool PDA:", stakePool.toBase58());
  console.log("EscrowVault PDA:", escrowVault.toBase58());
  console.log("StakeVault PDA:", stakeVault.toBase58());

  if (await accountExists(connection, stakePool)) {
    console.log("SKIP: StakePool already initialized");
  } else {
    // Step 2a: Create PROFIT mint with Transfer Hook extension
    console.log("  Creating PROFIT mint with Transfer Hook extension...");
    const profitMint = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    const mintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: profitMint.publicKey,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        profitMint.publicKey,
        admin.publicKey,
        hookProgram.programId,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        profitMint.publicKey,
        PROFIT_DECIMALS,
        admin.publicKey,
        null, // no freeze authority
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [admin, profitMint]);
    console.log("  OK: PROFIT mint created:", profitMint.publicKey.toBase58());

    // Step 2b: Initialize ExtraAccountMetaList for this mint
    console.log("  Initializing ExtraAccountMetaList...");
    const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), profitMint.publicKey.toBuffer()],
      hookProgram.programId
    );

    await hookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsStrict({
        payer: admin.publicKey,
        whitelistAuthority,
        authority: admin.publicKey,
        extraAccountMetaList,
        mint: profitMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("  OK: ExtraAccountMetaList initialized");

    // Step 2c: Create admin token account + mint PROFIT for dead stake
    console.log("  Creating admin token account and minting PROFIT...");
    const adminTokenAccount = await createAccount(
      connection,
      admin,
      profitMint.publicKey,
      admin.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      connection,
      admin,
      profitMint.publicKey,
      adminTokenAccount,
      admin,
      100_000_000_000, // 100,000 PROFIT (enough for dead stake + testing)
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("  OK: Minted 100,000 PROFIT to admin");

    // Step 2d: Whitelist admin's token account (source for dead stake transfer)
    // The dead stake transfer goes admin -> stakeVault. Since stakeVault
    // doesn't exist yet (created during init), we whitelist admin as source.
    console.log("  Whitelisting admin token account (for dead stake transfer)...");
    const [adminWhitelistEntry] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, adminTokenAccount.toBuffer()],
      hookProgram.programId
    );

    await hookProgram.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: admin.publicKey,
        whitelistAuthority,
        whitelistEntry: adminWhitelistEntry,
        addressToWhitelist: adminTokenAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("  OK: Admin token account whitelisted");

    // Step 2e: Initialize StakePool
    // IMPORTANT: We manually derive hook accounts because stakeVault doesn't
    // exist yet (Anchor creates it in this instruction via init). The
    // createTransferCheckedWithTransferHookInstruction helper can't resolve
    // ExtraAccountMetas for a non-existent account.
    // Hook accounts: [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]
    console.log("  Initializing StakePool with dead stake...");

    const [whitelistSourceForInit] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, adminTokenAccount.toBuffer()],
      hookProgram.programId
    );
    const [whitelistDestForInit] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, stakeVault.toBuffer()],
      hookProgram.programId
    );

    const deadStakeHookAccounts = [
      { pubkey: extraAccountMetaList, isSigner: false, isWritable: false },
      { pubkey: whitelistSourceForInit, isSigner: false, isWritable: false },
      { pubkey: whitelistDestForInit, isSigner: false, isWritable: false },
      { pubkey: hookProgram.programId, isSigner: false, isWritable: false },
    ];

    await stakingProgram.methods
      .initializeStakePool()
      .accountsStrict({
        authority: admin.publicKey,
        stakePool,
        escrowVault,
        stakeVault,
        authorityTokenAccount: adminTokenAccount,
        profitMint: profitMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(deadStakeHookAccounts)
      .signers([admin])
      .rpc();
    console.log("  OK: StakePool initialized with", MINIMUM_STAKE, "dead stake");
  }

  // ===========================================================================
  // Step 3: Add StakeVault to whitelist (entry #14)
  //
  // WHY LAST: StakeVault PDA must exist (created during StakePool init in step 2)
  // before we can whitelist it. After this, stake/unstake transfers will pass
  // the Transfer Hook's whitelist check because stakeVault is always either
  // the source (unstake) or destination (stake).
  // ===========================================================================
  console.log("\n=== Step 3: Whitelist StakeVault (entry #14) ===");

  const [stakeVaultWhitelistEntry] = PublicKey.findProgramAddressSync(
    [WHITELIST_ENTRY_SEED, stakeVault.toBuffer()],
    hookProgram.programId
  );

  if (await accountExists(connection, stakeVaultWhitelistEntry)) {
    console.log("SKIP: StakeVault already whitelisted at", stakeVaultWhitelistEntry.toBase58());
  } else {
    try {
      await hookProgram.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: admin.publicKey,
          whitelistAuthority,
          whitelistEntry: stakeVaultWhitelistEntry,
          addressToWhitelist: stakeVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      console.log("OK: StakeVault whitelisted at", stakeVaultWhitelistEntry.toBase58());
    } catch (err: any) {
      if (isAlreadyInitialized(err)) {
        console.log("SKIP: StakeVault already whitelisted (caught init error)");
      } else {
        throw err;
      }
    }
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log("\n=== Initialization Complete ===");
  console.log("Admin:                   ", admin.publicKey.toBase58());
  console.log("WhitelistAuthority PDA:  ", whitelistAuthority.toBase58());
  console.log("StakePool PDA:           ", stakePool.toBase58());
  console.log("EscrowVault PDA:         ", escrowVault.toBase58());
  console.log("StakeVault PDA:          ", stakeVault.toBase58());
  console.log("StakeVault whitelist PDA:", stakeVaultWhitelistEntry.toBase58());
  console.log("\nSystem ready for stake/unstake operations.");
}

main().catch((err) => {
  console.error("\nInitialization failed:", err);
  process.exit(1);
});
