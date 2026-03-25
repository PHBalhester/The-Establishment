/**
 * Protocol Initialization Helper
 *
 * Orchestrates the complete Dr. Fraudsworth protocol setup in a single
 * local validator. Implements a 17-step initialization sequence across
 * all 6 programs: Transfer Hook, AMM, Conversion Vault, Epoch, Staking, and Carnage Fund.
 *
 * The initialization order is critical because of cross-program dependencies:
 * - Mints must exist before ExtraAccountMetaLists
 * - WhitelistAuthority must exist before any whitelist entries
 * - AdminConfig must exist before pools
 * - Pools must exist before their vaults can be whitelisted
 * - StakePool must be initialized with hook accounts (needs ExtraAccountMetaList)
 * - CarnageFund needs CRIME and FRAUD mints
 *
 * Usage:
 *   const state = await initializeProtocol(provider, programs);
 *   // state.crimeSolPool, state.wallets.trader, etc.
 *
 * Source: .planning/phases/31-integration-test-infrastructure/31-02-PLAN.md
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
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  getMintLen,
  ExtensionType,
  createAccount,
  mintTo,
  createWrappedNativeAccount,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

// Anchor IDL types
import { Amm } from "../../../target/types/amm";
import { TransferHook } from "../../../target/types/transfer_hook";
import { TaxProgram } from "../../../target/types/tax_program";
import { EpochProgram } from "../../../target/types/epoch_program";
import { Staking } from "../../../target/types/staking";
import { ConversionVault } from "../../../target/types/conversion_vault";

// Local helpers
import {
  TOKEN_DECIMALS,
  MINIMUM_STAKE,
  SOL_POOL_FEE_BPS,
  SOL_POOL_SEED_SOL,
  SOL_POOL_SEED_TOKEN,
  ADMIN_SEED,
  POOL_SEED,
  VAULT_SEED,
  VAULT_A_SEED,
  VAULT_B_SEED,
  WHITELIST_AUTHORITY_SEED,
  WHITELIST_ENTRY_SEED,
  EXTRA_ACCOUNT_META_SEED,
  EPOCH_STATE_SEED,
  STAKE_POOL_SEED,
  ESCROW_VAULT_SEED,
  STAKE_VAULT_SEED,
  CARNAGE_FUND_SEED,
  CARNAGE_SOL_VAULT_SEED,
  CARNAGE_CRIME_VAULT_SEED,
  CARNAGE_FRAUD_VAULT_SEED,
  VAULT_CONFIG_SEED,
  VAULT_CRIME_SEED,
  VAULT_FRAUD_SEED,
  VAULT_PROFIT_SEED,
  derivePoolPDA,
  deriveVaultPDAs,
  deriveWhitelistEntryPDA,
} from "./constants";

import { createTestWallets, TestWallets } from "./test-wallets";

// =============================================================================
// Types
// =============================================================================

/**
 * All program instances needed for protocol initialization.
 *
 * These are loaded from the Anchor workspace by the test file and
 * passed in, keeping this helper decoupled from workspace specifics.
 */
export interface Programs {
  amm: Program<Amm>;
  transferHook: Program<TransferHook>;
  taxProgram: Program<TaxProgram>;
  epochProgram: Program<EpochProgram>;
  staking: Program<Staking>;
  vault: Program<ConversionVault>;
}

/**
 * Complete protocol state returned after initialization.
 *
 * Contains every address and keypair a test might need to interact
 * with the protocol. Tests destructure what they need:
 *
 *   const { crimeSolPool, wallets } = await initializeProtocol(...);
 */
export interface ProtocolState {
  // Mints (all Token-2022 with TransferHook extension)
  crimeMint: PublicKey;
  fraudMint: PublicKey;
  profitMint: PublicKey;
  // Mint keypairs (needed for minting in tests)
  crimeMintKeypair: Keypair;
  fraudMintKeypair: Keypair;
  profitMintKeypair: Keypair;

  // AMM
  adminConfig: PublicKey;
  crimeSolPool: PublicKey;
  fraudSolPool: PublicKey;
  vaultConfig: PublicKey;

  // Pool vaults (keyed by pool pubkey string)
  poolVaults: Map<string, { vaultA: PublicKey; vaultB: PublicKey }>;

  // Transfer Hook
  whitelistAuthority: PublicKey;

  // Epoch
  epochState: PublicKey;

  // Staking
  stakePool: PublicKey;
  escrowVault: PublicKey;
  stakeVault: PublicKey;

  // Carnage
  carnageState: PublicKey;
  carnageSolVault: PublicKey;
  carnageCrimeVault: PublicKey;
  carnageFraudVault: PublicKey;

  // Authority
  authority: Keypair;

  // Test wallets (created by createTestWallets)
  wallets: TestWallets;
}

// =============================================================================
// BPF Loader Upgradeable Program ID
// =============================================================================

/**
 * The BPF Loader Upgradeable program. Used to derive ProgramData addresses
 * which are needed for the InitializeAdmin instruction (upgrade authority check).
 */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Canonically order two mints. The smaller (lexicographic byte comparison)
 * is mint_a, the larger is mint_b. This matches the on-chain AMM constraint
 * that mint_a.key() < mint_b.key().
 */
function canonicalOrder(
  mint1: PublicKey,
  mint2: PublicKey
): [PublicKey, PublicKey] {
  return mint1.toBuffer().compare(mint2.toBuffer()) < 0
    ? [mint1, mint2]
    : [mint2, mint1];
}

// =============================================================================
// Main Initialization Function
// =============================================================================

/**
 * Initialize the complete Dr. Fraudsworth protocol in a local validator.
 *
 * This is the heart of integration test infrastructure. It sets up:
 * - 3 Token-2022 mints with Transfer Hook extensions
 * - Transfer Hook whitelist authority + ExtraAccountMetaLists
 * - 2 AMM pools with seed liquidity + conversion vault
 * - All vault whitelist entries
 * - Epoch state machine
 * - Staking pool with dead stake
 * - Carnage fund with 3 vaults
 * - 4 role-based test wallets
 *
 * @param provider - Anchor provider (connection + wallet)
 * @param programs - All 6 program instances from Anchor workspace
 * @returns ProtocolState with every address a test might need
 */
export interface InitOptions {
  /** Skip EpochState initialization (when pre-loaded via --account override) */
  skipEpochStateInit?: boolean;
}

export async function initializeProtocol(
  provider: anchor.AnchorProvider,
  programs: Programs,
  options?: InitOptions,
): Promise<ProtocolState> {
  const connection = provider.connection;
  // The provider wallet is the upgrade authority in anchor test
  const authority = (provider.wallet as any).payer as Keypair;

  console.log("\n========================================");
  console.log("  Protocol Initialization Starting");
  console.log("========================================\n");

  try {
    // =========================================================================
    // PHASE 1: Mints & Hook Foundation (Steps 1-4)
    // =========================================================================

    // --- Step 1: Airdrop SOL to authority ---
    // The authority needs enough SOL for all account creation rent,
    // seed liquidity, and transaction fees across ~20+ transactions.
    console.log("Step 1: Airdrop SOL to authority...");
    const sig = await connection.requestAirdrop(
      authority.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);
    const balance = await connection.getBalance(authority.publicKey);
    console.log(
      `  OK: Authority ${authority.publicKey.toBase58()} has ${
        balance / LAMPORTS_PER_SOL
      } SOL`
    );

    // --- Step 2: Create 3 Token-2022 mints with TransferHook extension ---
    // Each mint needs: createAccount + initializeTransferHook + initializeMint
    // All three tokens point their transfer hook to the Transfer Hook program.
    console.log("\nStep 2: Create Token-2022 mints with TransferHook...");

    const crimeMintKeypair = Keypair.generate();
    const fraudMintKeypair = Keypair.generate();
    const profitMintKeypair = Keypair.generate();

    const hookProgramId = programs.transferHook.programId;
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const mintLamports = await connection.getMinimumBalanceForRentExemption(
      mintLen
    );

    // Create all 3 mints in parallel (they don't depend on each other)
    const mintKeypairs = [
      { name: "CRIME", kp: crimeMintKeypair },
      { name: "FRAUD", kp: fraudMintKeypair },
      { name: "PROFIT", kp: profitMintKeypair },
    ];

    for (const { name, kp } of mintKeypairs) {
      const mintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: kp.publicKey,
          space: mintLen,
          lamports: mintLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferHookInstruction(
          kp.publicKey,
          authority.publicKey,
          hookProgramId,
          TOKEN_2022_PROGRAM_ID
        ),
        createInitializeMintInstruction(
          kp.publicKey,
          TOKEN_DECIMALS,
          authority.publicKey,
          null, // no freeze authority
          TOKEN_2022_PROGRAM_ID
        )
      );

      await sendAndConfirmTransaction(connection, mintTx, [authority, kp]);
      console.log(`  OK: ${name} mint created: ${kp.publicKey.toBase58()}`);
    }

    const crimeMint = crimeMintKeypair.publicKey;
    const fraudMint = fraudMintKeypair.publicKey;
    const profitMint = profitMintKeypair.publicKey;

    // --- Step 3: Initialize Transfer Hook WhitelistAuthority ---
    // Must exist before any whitelist entries or ExtraAccountMetaLists.
    console.log("\nStep 3: Initialize WhitelistAuthority...");

    const [whitelistAuthority] = PublicKey.findProgramAddressSync(
      [WHITELIST_AUTHORITY_SEED],
      hookProgramId
    );

    await programs.transferHook.methods
      .initializeAuthority()
      .accountsStrict({
        signer: authority.publicKey,
        whitelistAuthority,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(
      `  OK: WhitelistAuthority at ${whitelistAuthority.toBase58()}`
    );

    // --- Step 4: Initialize ExtraAccountMetaList for each mint ---
    // Token-2022 uses these to resolve the extra accounts (whitelist PDAs)
    // that our transfer hook needs at transfer time.
    console.log("\nStep 4: Initialize ExtraAccountMetaLists...");

    for (const { name, kp } of mintKeypairs) {
      const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, kp.publicKey.toBuffer()],
        hookProgramId
      );

      await programs.transferHook.methods
        .initializeExtraAccountMetaList()
        .accountsStrict({
          payer: authority.publicKey,
          whitelistAuthority,
          authority: authority.publicKey,
          extraAccountMetaList,
          mint: kp.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log(
        `  OK: ExtraAccountMetaList for ${name}: ${extraAccountMetaList.toBase58()}`
      );
    }

    // =========================================================================
    // PHASE 2: AMM Infrastructure (Steps 5-11)
    // =========================================================================

    // --- Step 5: Initialize AMM AdminConfig ---
    // The AdminConfig PDA gates pool creation. It requires the upgrade
    // authority to sign, verified via ProgramData account.
    console.log("\nStep 5: Initialize AMM AdminConfig...");

    const ammProgramId = programs.amm.programId;

    const [adminConfig] = PublicKey.findProgramAddressSync(
      [ADMIN_SEED],
      ammProgramId
    );

    // Derive ProgramData address for upgrade authority verification
    const [programData] = PublicKey.findProgramAddressSync(
      [ammProgramId.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    );

    await programs.amm.methods
      .initializeAdmin(authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        adminConfig,
        program: ammProgramId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(`  OK: AdminConfig at ${adminConfig.toBase58()}`);

    // --- Step 6: Create admin token accounts for seed liquidity ---
    // The admin needs token accounts holding enough tokens to seed all 4 pools.
    // WSOL uses standard SPL Token; CRIME/FRAUD/PROFIT use Token-2022.
    console.log("\nStep 6: Create admin token accounts + mint seed liquidity...");

    // WSOL: Wrap enough SOL for both SOL pools (2 * SOL_POOL_SEED_SOL + buffer)
    const wsolAmount = SOL_POOL_SEED_SOL * 2 + 5 * LAMPORTS_PER_SOL; // Extra for fees
    const adminWsolAccount = await createWrappedNativeAccount(
      connection,
      authority,
      authority.publicKey,
      wsolAmount,
      undefined, // keypair
      undefined, // confirmOptions
      TOKEN_PROGRAM_ID
    );
    console.log(`  OK: Admin WSOL account: ${adminWsolAccount.toBase58()}`);

    // Create Token-2022 accounts for CRIME, FRAUD, PROFIT
    // Mint 100,000 of each token (enough for all pools + staking dead stake)
    const MINT_AMOUNT = 100_000 * 10 ** TOKEN_DECIMALS; // 100,000 tokens

    const adminCrimeAccount = await createAccount(
      connection,
      authority,
      crimeMint,
      authority.publicKey,
      undefined, // keypair
      undefined, // confirmOptions
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      connection,
      authority,
      crimeMint,
      adminCrimeAccount,
      authority,
      MINT_AMOUNT,
      undefined, // multiSigners
      undefined, // confirmOptions
      TOKEN_2022_PROGRAM_ID
    );
    console.log(`  OK: Admin CRIME account: ${adminCrimeAccount.toBase58()}`);

    const adminFraudAccount = await createAccount(
      connection,
      authority,
      fraudMint,
      authority.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      connection,
      authority,
      fraudMint,
      adminFraudAccount,
      authority,
      MINT_AMOUNT,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log(`  OK: Admin FRAUD account: ${adminFraudAccount.toBase58()}`);

    const adminProfitAccount = await createAccount(
      connection,
      authority,
      profitMint,
      authority.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      connection,
      authority,
      profitMint,
      adminProfitAccount,
      authority,
      MINT_AMOUNT,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log(`  OK: Admin PROFIT account: ${adminProfitAccount.toBase58()}`);

    // --- Step 6b: Whitelist admin T22 token accounts for pool seed liquidity ---
    // The AMM's initializePool transfers seed liquidity from admin accounts into
    // vault PDAs. For Token-2022 mints with Transfer Hook, at least one party
    // (source or dest) must be whitelisted. The vault doesn't exist yet at transfer
    // time (it's created in the same instruction), so we whitelist the admin source.
    console.log("\nStep 6b: Whitelist admin T22 accounts for pool seed liquidity...");

    for (const { name, account } of [
      { name: "CRIME", account: adminCrimeAccount },
      { name: "FRAUD", account: adminFraudAccount },
      { name: "PROFIT", account: adminProfitAccount },
    ]) {
      const [whitelistEntry] = deriveWhitelistEntryPDA(account, hookProgramId);

      await programs.transferHook.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry,
          addressToWhitelist: account,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log(`  OK: Admin ${name} account whitelisted`);
    }

    // --- Steps 7-8: Initialize 2 AMM pools ---
    // Each pool needs canonical mint ordering, correct token programs,
    // and seed liquidity transferred from admin accounts into PDA vaults.
    console.log("\nSteps 7-8: Initialize 2 AMM pools...");

    // Track pool addresses and vaults
    const poolVaults = new Map<string, { vaultA: PublicKey; vaultB: PublicKey }>();

    /**
     * Helper: Initialize a single AMM pool.
     *
     * Handles canonical ordering, PDA derivation, and the initializePool call.
     * Returns the pool PDA address.
     */
    async function initPool(
      name: string,
      rawMint1: PublicKey,
      rawMint2: PublicKey,
      tokenProgram1: PublicKey,
      tokenProgram2: PublicKey,
      source1: PublicKey,
      source2: PublicKey,
      feeBps: number,
      amount1: number | bigint,
      amount2: number | bigint
    ): Promise<PublicKey> {
      // Canonical ordering: smaller pubkey = mintA
      const [mintA, mintB] = canonicalOrder(rawMint1, rawMint2);

      // Map token programs and source accounts to canonical order
      let tokenProgramA: PublicKey;
      let tokenProgramB: PublicKey;
      let sourceA: PublicKey;
      let sourceB: PublicKey;
      let amountA: number | bigint;
      let amountB: number | bigint;

      if (mintA.equals(rawMint1)) {
        // rawMint1 is the canonical mintA
        tokenProgramA = tokenProgram1;
        tokenProgramB = tokenProgram2;
        sourceA = source1;
        sourceB = source2;
        amountA = amount1;
        amountB = amount2;
      } else {
        // rawMint2 is the canonical mintA (swapped)
        tokenProgramA = tokenProgram2;
        tokenProgramB = tokenProgram1;
        sourceA = source2;
        sourceB = source1;
        amountA = amount2;
        amountB = amount1;
      }

      // Derive pool PDA
      const [pool] = derivePoolPDA(mintA, mintB, ammProgramId);

      // Derive vault PDAs
      const { vaultA: [vaultA], vaultB: [vaultB] } = deriveVaultPDAs(
        pool,
        ammProgramId
      );

      console.log(`  Initializing ${name}...`);
      console.log(`    mintA: ${mintA.toBase58()}`);
      console.log(`    mintB: ${mintB.toBase58()}`);
      console.log(`    pool:  ${pool.toBase58()}`);

      // Build Transfer Hook remaining_accounts for T22 seed liquidity transfers.
      // The AMM's initializePool now forwards remaining_accounts to Token-2022
      // transfer_checked calls. For each T22 mint involved, we need:
      //   [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]
      // The source is whitelisted (admin account), dest vault may not be yet.
      const hookRemainingAccounts: {
        pubkey: PublicKey;
        isSigner: boolean;
        isWritable: boolean;
      }[] = [];

      // Check if either side needs hook accounts (Token-2022)
      const aIsT22 = tokenProgramA.equals(TOKEN_2022_PROGRAM_ID);
      const bIsT22 = tokenProgramB.equals(TOKEN_2022_PROGRAM_ID);

      if (aIsT22) {
        const [extraMeta] = PublicKey.findProgramAddressSync(
          [EXTRA_ACCOUNT_META_SEED, mintA.toBuffer()],
          hookProgramId
        );
        const [wlSource] = deriveWhitelistEntryPDA(sourceA, hookProgramId);
        const [wlDest] = deriveWhitelistEntryPDA(vaultA, hookProgramId);
        hookRemainingAccounts.push(
          { pubkey: extraMeta, isSigner: false, isWritable: false },
          { pubkey: wlSource, isSigner: false, isWritable: false },
          { pubkey: wlDest, isSigner: false, isWritable: false },
          { pubkey: hookProgramId, isSigner: false, isWritable: false }
        );
      }

      if (bIsT22) {
        const [extraMeta] = PublicKey.findProgramAddressSync(
          [EXTRA_ACCOUNT_META_SEED, mintB.toBuffer()],
          hookProgramId
        );
        const [wlSource] = deriveWhitelistEntryPDA(sourceB, hookProgramId);
        const [wlDest] = deriveWhitelistEntryPDA(vaultB, hookProgramId);
        hookRemainingAccounts.push(
          { pubkey: extraMeta, isSigner: false, isWritable: false },
          { pubkey: wlSource, isSigner: false, isWritable: false },
          { pubkey: wlDest, isSigner: false, isWritable: false },
          { pubkey: hookProgramId, isSigner: false, isWritable: false }
        );
      }

      await programs.amm.methods
        .initializePool(
          feeBps,
          new anchor.BN(amountA.toString()),
          new anchor.BN(amountB.toString())
        )
        .accountsStrict({
          payer: authority.publicKey,
          adminConfig,
          admin: authority.publicKey,
          pool,
          vaultA,
          vaultB,
          mintA,
          mintB,
          sourceA,
          sourceB,
          tokenProgramA,
          tokenProgramB,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookRemainingAccounts)
        .signers([authority])
        .rpc();

      console.log(`  OK: ${name} initialized at ${pool.toBase58()}`);

      // Track vaults for whitelist step
      poolVaults.set(pool.toBase58(), { vaultA, vaultB });

      return pool;
    }

    // Step 7: CRIME/SOL pool (MixedPool - WSOL via SPL Token + CRIME via Token-2022)
    const crimeSolPool = await initPool(
      "CRIME/SOL pool",
      NATIVE_MINT,
      crimeMint,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      adminWsolAccount,
      adminCrimeAccount,
      SOL_POOL_FEE_BPS,
      SOL_POOL_SEED_SOL,
      SOL_POOL_SEED_TOKEN
    );

    // Step 8: FRAUD/SOL pool (MixedPool - WSOL via SPL Token + FRAUD via Token-2022)
    const fraudSolPool = await initPool(
      "FRAUD/SOL pool",
      NATIVE_MINT,
      fraudMint,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      adminWsolAccount,
      adminFraudAccount,
      SOL_POOL_FEE_BPS,
      SOL_POOL_SEED_SOL,
      SOL_POOL_SEED_TOKEN
    );

    // --- Step 9: Initialize Conversion Vault ---
    // One-shot init: creates VaultConfig PDA + 3 vault token accounts.
    // Localnet feature: mints stored in VaultConfig (not hardcoded).
    console.log("\nStep 9: Initialize Conversion Vault...");

    const vaultProgramId = programs.vault.programId;

    const [vaultConfig] = PublicKey.findProgramAddressSync(
      [VAULT_CONFIG_SEED],
      vaultProgramId
    );
    const [vaultCrime] = PublicKey.findProgramAddressSync(
      [VAULT_CRIME_SEED, vaultConfig.toBuffer()],
      vaultProgramId
    );
    const [vaultFraud] = PublicKey.findProgramAddressSync(
      [VAULT_FRAUD_SEED, vaultConfig.toBuffer()],
      vaultProgramId
    );
    const [vaultProfit] = PublicKey.findProgramAddressSync(
      [VAULT_PROFIT_SEED, vaultConfig.toBuffer()],
      vaultProgramId
    );

    await programs.vault.methods
      .initialize()
      .accountsStrict({
        payer: authority.publicKey,
        vaultConfig,
        vaultCrime,
        vaultFraud,
        vaultProfit,
        crimeMint,
        fraudMint,
        profitMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(`  OK: VaultConfig at ${vaultConfig.toBase58()}`);
    console.log(`  Vault CRIME:  ${vaultCrime.toBase58()}`);
    console.log(`  Vault FRAUD:  ${vaultFraud.toBase58()}`);
    console.log(`  Vault PROFIT: ${vaultProfit.toBase58()}`);

    // --- Step 9b: Whitelist vault token accounts ---
    console.log("\nStep 9b: Whitelist vault token accounts...");
    for (const { name, vault } of [
      { name: "CRIME", vault: vaultCrime },
      { name: "FRAUD", vault: vaultFraud },
      { name: "PROFIT", vault: vaultProfit },
    ]) {
      const [whitelistEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);
      await programs.transferHook.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry,
          addressToWhitelist: vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log(`  OK: Vault ${name} account whitelisted`);
    }

    // --- Step 9c: Seed vault with tokens ---
    // Transfer tokens from admin accounts to vault PDAs.
    // 50,000 of each token (enough for all test conversions).
    console.log("\nStep 9c: Seed vault with tokens...");
    const VAULT_SEED_AMOUNT = 50_000 * 10 ** TOKEN_DECIMALS;

    for (const { name, source, vaultAccount, mint } of [
      { name: "CRIME", source: adminCrimeAccount, vaultAccount: vaultCrime, mint: crimeMint },
      { name: "FRAUD", source: adminFraudAccount, vaultAccount: vaultFraud, mint: fraudMint },
      { name: "PROFIT", source: adminProfitAccount, vaultAccount: vaultProfit, mint: profitMint },
    ]) {
      // Build hook remaining_accounts for the transfer
      const [extraMeta] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()],
        hookProgramId
      );
      const [wlSource] = deriveWhitelistEntryPDA(source, hookProgramId);
      const [wlDest] = deriveWhitelistEntryPDA(vaultAccount, hookProgramId);

      const transferIx = createTransferCheckedInstruction(
        source,
        mint,
        vaultAccount,
        authority.publicKey,
        VAULT_SEED_AMOUNT,
        TOKEN_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      // Append hook accounts as remaining accounts
      transferIx.keys.push(
        { pubkey: extraMeta, isSigner: false, isWritable: false },
        { pubkey: wlSource, isSigner: false, isWritable: false },
        { pubkey: wlDest, isSigner: false, isWritable: false },
        { pubkey: hookProgramId, isSigner: false, isWritable: false },
      );

      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log(`  OK: Seeded vault ${name} with ${VAULT_SEED_AMOUNT / 10 ** TOKEN_DECIMALS} tokens`);
    }

    // --- Step 11: Whitelist all pool vault addresses ---
    // The Transfer Hook checks that at least one party (source or dest)
    // is whitelisted. Pool vaults must be whitelisted so users can
    // transfer tokens to/from them during swaps.
    console.log("\nStep 11: Whitelist pool vault addresses...");

    let whitelistCount = 0;
    for (const [poolAddr, { vaultA, vaultB }] of poolVaults.entries()) {
      for (const vault of [vaultA, vaultB]) {
        const [whitelistEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);

        await programs.transferHook.methods
          .addWhitelistEntry()
          .accountsStrict({
            authority: authority.publicKey,
            whitelistAuthority,
            whitelistEntry,
            addressToWhitelist: vault,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        whitelistCount++;
      }
      console.log(`  OK: Whitelisted vaults for pool ${poolAddr.slice(0, 8)}...`);
    }
    console.log(`  Total pool vault whitelist entries: ${whitelistCount}`);

    // =========================================================================
    // PHASE 3: Epoch + Staking (Steps 12-14)
    // =========================================================================

    // --- Step 12: Initialize EpochState ---
    // The epoch state machine tracks the current epoch, tax rates,
    // VRF state, and carnage state. Must be initialized before live.
    console.log("\nStep 12: Initialize EpochState...");

    const [epochState] = PublicKey.findProgramAddressSync(
      [EPOCH_STATE_SEED],
      programs.epochProgram.programId
    );

    if (options?.skipEpochStateInit) {
      // EpochState was pre-loaded via --account override (e.g., for Carnage tests)
      const epochInfo = await connection.getAccountInfo(epochState);
      if (!epochInfo) {
        throw new Error("skipEpochStateInit=true but EpochState account not found. Did you use --account flag?");
      }
      console.log(`  SKIP: EpochState pre-loaded at ${epochState.toBase58()} (${epochInfo.data.length} bytes)`);
    } else {
      await programs.epochProgram.methods
        .initializeEpochState()
        .accountsStrict({
          payer: authority.publicKey,
          epochState,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log(`  OK: EpochState at ${epochState.toBase58()}`);
    }

    // --- Step 13: Initialize StakePool ---
    // Following the proven pattern from scripts/init-localnet.ts.
    // The staking pool requires a dead stake transfer (1 PROFIT) to
    // prevent first-depositor inflation attack.
    console.log("\nStep 13: Initialize StakePool...");

    const stakingProgramId = programs.staking.programId;

    const [stakePool] = PublicKey.findProgramAddressSync(
      [STAKE_POOL_SEED],
      stakingProgramId
    );
    const [escrowVault] = PublicKey.findProgramAddressSync(
      [ESCROW_VAULT_SEED],
      stakingProgramId
    );
    const [stakeVault] = PublicKey.findProgramAddressSync(
      [STAKE_VAULT_SEED],
      stakingProgramId
    );

    console.log(`  StakePool PDA:   ${stakePool.toBase58()}`);
    console.log(`  EscrowVault PDA: ${escrowVault.toBase58()}`);
    console.log(`  StakeVault PDA:  ${stakeVault.toBase58()}`);

    // Step 13a: Admin PROFIT account already whitelisted in Step 6b.
    // No need to whitelist again here.

    // Step 13b: Build hook remaining_accounts manually
    // We can't use createTransferCheckedWithTransferHookInstruction because
    // stakeVault doesn't exist yet (it's created by this instruction).
    // But we know the PDA address is deterministic, so we build the accounts:
    //   [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]
    const [profitExtraAccountMetaList] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_META_SEED, profitMint.toBuffer()],
      hookProgramId
    );

    const [whitelistSourceForInit] = deriveWhitelistEntryPDA(
      adminProfitAccount,
      hookProgramId
    );
    const [whitelistDestForInit] = deriveWhitelistEntryPDA(
      stakeVault,
      hookProgramId
    );

    const deadStakeHookAccounts = [
      { pubkey: profitExtraAccountMetaList, isSigner: false, isWritable: false },
      { pubkey: whitelistSourceForInit, isSigner: false, isWritable: false },
      { pubkey: whitelistDestForInit, isSigner: false, isWritable: false },
      { pubkey: hookProgramId, isSigner: false, isWritable: false },
    ];

    // Step 13c: Initialize StakePool with dead stake
    await programs.staking.methods
      .initializeStakePool()
      .accountsStrict({
        authority: authority.publicKey,
        stakePool,
        escrowVault,
        stakeVault,
        authorityTokenAccount: adminProfitAccount,
        profitMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(deadStakeHookAccounts)
      .signers([authority])
      .rpc();
    console.log(
      `  OK: StakePool initialized with ${MINIMUM_STAKE} dead stake`
    );

    // --- Step 14: Whitelist StakeVault ---
    // Now that stakeVault exists (created by initializeStakePool),
    // whitelist it so stake/unstake transfers pass the hook check.
    console.log("\nStep 14: Whitelist StakeVault...");

    const [stakeVaultWhitelistEntry] = deriveWhitelistEntryPDA(
      stakeVault,
      hookProgramId
    );

    await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry: stakeVaultWhitelistEntry,
        addressToWhitelist: stakeVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(
      `  OK: StakeVault whitelisted at ${stakeVaultWhitelistEntry.toBase58()}`
    );

    // =========================================================================
    // PHASE 4: Carnage Fund (Steps 15-16)
    // =========================================================================

    // --- Step 15: Initialize Carnage Fund ---
    // Creates the carnage state PDA and 3 vault PDAs:
    // - SOL vault (SystemAccount for native SOL)
    // - CRIME vault (Token-2022 account)
    // - FRAUD vault (Token-2022 account)
    console.log("\nStep 15: Initialize Carnage Fund...");

    const epochProgramId = programs.epochProgram.programId;

    const [carnageState] = PublicKey.findProgramAddressSync(
      [CARNAGE_FUND_SEED],
      epochProgramId
    );
    const [carnageSolVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_SOL_VAULT_SEED],
      epochProgramId
    );
    const [carnageCrimeVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_CRIME_VAULT_SEED],
      epochProgramId
    );
    const [carnageFraudVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_FRAUD_VAULT_SEED],
      epochProgramId
    );

    await programs.epochProgram.methods
      .initializeCarnageFund()
      .accountsStrict({
        authority: authority.publicKey,
        carnageState,
        solVault: carnageSolVault,
        crimeVault: carnageCrimeVault,
        fraudVault: carnageFraudVault,
        crimeMint,
        fraudMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(`  OK: CarnageState at ${carnageState.toBase58()}`);
    console.log(`  SOL vault:   ${carnageSolVault.toBase58()}`);
    console.log(`  CRIME vault: ${carnageCrimeVault.toBase58()}`);
    console.log(`  FRAUD vault: ${carnageFraudVault.toBase58()}`);

    // Fund the Carnage SOL vault with rent-exempt minimum.
    // The vault is a PDA owned by System Program that receives native SOL from
    // tax distribution (24% of buy/sell tax). It needs at least rent-exempt
    // minimum (890,880 lamports for 0-data SystemAccount) to be valid after
    // receiving the first deposit, otherwise the transaction fails with
    // "insufficient funds for rent".
    const rentExemptMinimum = await connection.getMinimumBalanceForRentExemption(0);
    const fundCarnageTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: carnageSolVault,
        lamports: rentExemptMinimum,
      })
    );
    await sendAndConfirmTransaction(connection, fundCarnageTx, [authority]);
    console.log(`  OK: Carnage SOL vault funded with ${rentExemptMinimum} lamports (rent-exempt)`);

    // --- Step 16: Whitelist Carnage vaults ---
    // Only token vaults need whitelisting (CRIME and FRAUD).
    // The SOL vault is a SystemAccount (no T22 transfer hook involved).
    console.log("\nStep 16: Whitelist Carnage token vaults...");

    for (const { name, vault } of [
      { name: "CRIME", vault: carnageCrimeVault },
      { name: "FRAUD", vault: carnageFraudVault },
    ]) {
      const [whitelistEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);

      await programs.transferHook.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry,
          addressToWhitelist: vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log(`  OK: Carnage ${name} vault whitelisted`);
    }

    // =========================================================================
    // PHASE 5: Test Wallets (Step 17)
    // =========================================================================

    // --- Step 17: Create test wallets ---
    // 4 role-based wallets (trader, staker, admin, attacker) with
    // appropriate token accounts and funding.
    console.log("\nStep 17: Create test wallets...");

    const wallets = await createTestWallets(connection, authority, {
      crimeMint,
      fraudMint,
      profitMint,
    });
    console.log("  OK: 4 test wallets created (trader, staker, admin, attacker)");

    // =========================================================================
    // Complete
    // =========================================================================

    console.log("\n========================================");
    console.log("  Protocol Initialization Complete");
    console.log("========================================");
    console.log(`  Mints:    CRIME, FRAUD, PROFIT (Token-2022 + TransferHook)`);
    console.log(`  Pools:    2 (CRIME/SOL, FRAUD/SOL)`);
    console.log(`  Vault:    Conversion Vault initialized + seeded`);
    console.log(`  Vaults:   ${whitelistCount} pool vaults whitelisted`);
    console.log(`  Staking:  StakePool + StakeVault + EscrowVault`);
    console.log(`  Carnage:  CarnageFund + 3 vaults (SOL, CRIME, FRAUD)`);
    console.log(`  Epoch:    EpochState initialized at genesis`);
    console.log(`  Wallets:  4 test wallets (trader, staker, admin, attacker)`);
    console.log("");

    return {
      crimeMint,
      fraudMint,
      profitMint,
      crimeMintKeypair,
      fraudMintKeypair,
      profitMintKeypair,

      adminConfig,
      crimeSolPool,
      fraudSolPool,
      vaultConfig,
      poolVaults,

      whitelistAuthority,

      epochState,

      stakePool,
      escrowVault,
      stakeVault,

      carnageState,
      carnageSolVault,
      carnageCrimeVault,
      carnageFraudVault,

      authority,

      wallets,
    };
  } catch (error: any) {
    // Wrap errors with step context so test failures are easier to diagnose
    console.error("\n=== Protocol Initialization FAILED ===");
    console.error("Error:", error.message || error);
    if (error.logs) {
      console.error("Program logs:");
      for (const log of error.logs) {
        console.error("  ", log);
      }
    }
    throw error;
  }
}
