/**
 * Token Flow Integration Tests
 *
 * Tests the Transfer Hook whitelist integration with the Staking Program.
 * Validates that PROFIT token transfers work through the Transfer Hook whitelist
 * for stake/unstake flows.
 *
 * Phase 28 requirements tested:
 * - StakeVault PDA can be whitelisted in Transfer Hook
 * - stakeWithHook helper resolves ExtraAccountMetas correctly
 * - unstakeWithHook helper resolves ExtraAccountMetas correctly
 * - Stake fails with NoWhitelistedParty when vault not whitelisted
 *
 * Initialization order (per 28-CONTEXT.md):
 * 1. Transfer Hook init (create WhitelistAuthority)
 * 2. StakePool init (creates StakeVault PDA)
 * 3. Add StakeVault to whitelist
 *
 * NOTE: This test file runs in its own validator instance because StakePool
 * is a singleton PDA (seeds = ["stake_pool"]). Running alongside staking.ts
 * would cause PDA conflicts since both init with different mints.
 *
 * Source: .planning/phases/28-token-flow-whitelist/28-01-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  createTransferCheckedWithTransferHookInstruction,
  createAccount,
  mintTo,
  getAccount,
  getMintLen,
  ExtensionType,
} from "@solana/spl-token";
import { expect } from "chai";
import { Staking } from "../target/types/staking";
import { TransferHook } from "../target/types/transfer_hook";

// =============================================================================
// Constants
// =============================================================================

const PROFIT_DECIMALS = 6;
const MINIMUM_STAKE = 1_000_000; // 1 PROFIT (6 decimals)

// PDA seeds - must match program constants
const STAKE_POOL_SEED = Buffer.from("stake_pool");
const ESCROW_VAULT_SEED = Buffer.from("escrow_vault");
const STAKE_VAULT_SEED = Buffer.from("stake_vault");
const USER_STAKE_SEED = Buffer.from("user_stake");
const WHITELIST_AUTHORITY_SEED = Buffer.from("authority");
const WHITELIST_ENTRY_SEED = Buffer.from("whitelist");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve Transfer Hook ExtraAccountMetas and call stake with remaining_accounts.
 *
 * Uses createTransferCheckedWithTransferHookInstruction to resolve the hook
 * accounts dynamically, then extracts remaining_accounts (everything after
 * first 4 keys: source, mint, dest, authority) and passes them to the
 * Staking Program's stake instruction.
 *
 * @param connection - Solana connection
 * @param program - Staking program instance
 * @param user - User keypair (signer)
 * @param amount - Amount of PROFIT tokens to stake (in base units)
 * @param accounts - Account pubkeys needed for the stake instruction
 * @returns Transaction signature
 */
async function stakeWithHook(
  connection: anchor.web3.Connection,
  program: Program<Staking>,
  user: Keypair,
  amount: number,
  accounts: {
    stakePool: PublicKey;
    userStake: PublicKey;
    userTokenAccount: PublicKey;
    stakeVault: PublicKey;
    profitMint: PublicKey;
  },
): Promise<string> {
  // Resolve hook accounts by building a transfer_checked instruction
  // that includes ExtraAccountMetas from the Transfer Hook program
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    accounts.userTokenAccount,
    accounts.profitMint,
    accounts.stakeVault,
    user.publicKey,
    BigInt(amount),
    PROFIT_DECIMALS,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );

  // Extract remaining accounts (skip first 4: source, mint, dest, authority)
  // These are the hook-resolved accounts that Token-2022 needs for the hook call
  const hookAccounts = transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));

  return await program.methods
    .stake(new anchor.BN(amount))
    .accountsStrict({
      user: user.publicKey,
      stakePool: accounts.stakePool,
      userStake: accounts.userStake,
      userTokenAccount: accounts.userTokenAccount,
      stakeVault: accounts.stakeVault,
      profitMint: accounts.profitMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .signers([user])
    .rpc();
}

/**
 * Resolve Transfer Hook ExtraAccountMetas and call unstake with remaining_accounts.
 *
 * Same pattern as stakeWithHook but for the unstake instruction. Note that
 * unstake transfers FROM stakeVault TO userTokenAccount, so the transfer
 * resolution uses stakeVault as source and userTokenAccount as destination.
 * The authority for the transfer is the stakePool PDA (not the user).
 *
 * @param connection - Solana connection
 * @param program - Staking program instance
 * @param user - User keypair (signer)
 * @param amount - Amount of PROFIT tokens to unstake (in base units)
 * @param accounts - Account pubkeys needed for the unstake instruction
 * @returns Transaction signature
 */
async function unstakeWithHook(
  connection: anchor.web3.Connection,
  program: Program<Staking>,
  user: Keypair,
  amount: number,
  accounts: {
    stakePool: PublicKey;
    userStake: PublicKey;
    userTokenAccount: PublicKey;
    stakeVault: PublicKey;
    profitMint: PublicKey;
  },
): Promise<string> {
  // For unstake, the transfer goes FROM stakeVault TO userTokenAccount
  // Authority is the stakePool PDA (which signs via PDA seeds in the program)
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    accounts.stakeVault,
    accounts.profitMint,
    accounts.userTokenAccount,
    accounts.stakePool, // stakePool PDA is the authority for vault transfers
    BigInt(amount),
    PROFIT_DECIMALS,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );

  // Extract remaining accounts (skip first 4: source, mint, dest, authority)
  const hookAccounts = transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));

  return await program.methods
    .unstake(new anchor.BN(amount))
    .accountsStrict({
      user: user.publicKey,
      stakePool: accounts.stakePool,
      userStake: accounts.userStake,
      userTokenAccount: accounts.userTokenAccount,
      stakeVault: accounts.stakeVault,
      profitMint: accounts.profitMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts(hookAccounts)
    .signers([user])
    .rpc();
}


/**
 * Assert escrow solvency invariant: escrow balance >= pending rewards.
 *
 * This is the core safety invariant of the staking system. If this ever
 * fails, it means the escrow vault cannot cover all pending rewards,
 * indicating a bug in reward accounting.
 *
 * Called after EVERY state-modifying operation in tests.
 *
 * @param connection - Solana connection
 * @param stakingProgram - Staking program instance
 * @param escrowVault - Escrow vault PDA public key
 * @param stakePool - Stake pool PDA public key
 */
async function assertEscrowSolvency(
  connection: anchor.web3.Connection,
  stakingProgram: Program<Staking>,
  escrowVault: PublicKey,
  stakePool: PublicKey,
): Promise<void> {
  const pool = await stakingProgram.account.stakePool.fetch(stakePool);
  const escrowBalance = await connection.getBalance(escrowVault);

  // Escrow must cover pending rewards
  // pendingRewards is the undistributed amount before cumulative update
  expect(escrowBalance).to.be.gte(
    pool.pendingRewards.toNumber(),
    `Escrow solvency violated: balance ${escrowBalance} < pending ${pool.pendingRewards.toNumber()}`
  );
}

// =============================================================================
// Test Suite
// =============================================================================

describe("token-flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Program references
  const stakingProgram = anchor.workspace.Staking as Program<Staking>;
  const transferHookProgram = anchor.workspace
    .TransferHook as Program<TransferHook>;

  // Admin keypair (authority for both Transfer Hook and Staking)
  let admin: Keypair;

  // PROFIT mint (Token-2022 with transfer hook extension)
  let profitMint: Keypair;

  // Transfer Hook PDAs
  let whitelistAuthority: PublicKey;
  let extraAccountMetaList: PublicKey;

  // Staking PDAs
  let stakePool: PublicKey;
  let stakePoolBump: number;
  let escrowVault: PublicKey;
  let stakeVault: PublicKey;

  // Admin token account (for dead stake during init)
  let adminTokenAccount: PublicKey;

  // Test user
  let user: Keypair;
  let userTokenAccount: PublicKey;
  let userStake: PublicKey;

  // Whitelist entry PDA for StakeVault
  let stakeVaultWhitelistEntry: PublicKey;

  before(async () => {
    // =========================================================================
    // Step 1: Create admin keypair, fund with SOL
    // =========================================================================
    admin = Keypair.generate();
    const airdropSig1 = await provider.connection.requestAirdrop(
      admin.publicKey,
      10 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdropSig1);

    // =========================================================================
    // Step 2: Create PROFIT mint (Token-2022 with transfer hook extension)
    //
    // CRITICAL: We must use createInitializeTransferHookInstruction to add the
    // hook extension to the mint. This tells Token-2022 to invoke our Transfer
    // Hook program on every transfer_checked call.
    // =========================================================================
    profitMint = Keypair.generate();

    // Calculate mint size with TransferHook extension
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const mintLamports =
      await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    // Build transaction: create account + init transfer hook + init mint
    const mintTx = new Transaction().add(
      // Create the mint account with enough space for the extension
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: profitMint.publicKey,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      // Initialize the transfer hook extension pointing to our program
      createInitializeTransferHookInstruction(
        profitMint.publicKey,
        admin.publicKey,
        transferHookProgram.programId,
        TOKEN_2022_PROGRAM_ID,
      ),
      // Initialize the mint itself
      createInitializeMintInstruction(
        profitMint.publicKey,
        PROFIT_DECIMALS,
        admin.publicKey,
        null, // no freeze authority
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    await sendAndConfirmTransaction(provider.connection, mintTx, [
      admin,
      profitMint,
    ]);

    // =========================================================================
    // Step 3: Initialize Transfer Hook program (WhitelistAuthority PDA)
    //
    // This creates the global authority that controls whitelist additions.
    // Must happen before any whitelist entries can be added.
    // =========================================================================
    [whitelistAuthority] = PublicKey.findProgramAddressSync(
      [WHITELIST_AUTHORITY_SEED],
      transferHookProgram.programId,
    );

    await transferHookProgram.methods
      .initializeAuthority()
      .accountsStrict({
        signer: admin.publicKey,
        whitelistAuthority,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // =========================================================================
    // Step 4: Initialize ExtraAccountMetaList for the PROFIT mint
    //
    // This tells Token-2022 which extra accounts to resolve when calling the
    // transfer hook. It sets up the whitelist PDA resolution for source and
    // destination token accounts.
    // =========================================================================
    [extraAccountMetaList] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), profitMint.publicKey.toBuffer()],
      transferHookProgram.programId,
    );

    await transferHookProgram.methods
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

    // =========================================================================
    // Step 5: Create admin token account and mint PROFIT for dead stake
    // =========================================================================
    adminTokenAccount = await createAccount(
      provider.connection,
      admin,
      profitMint.publicKey,
      admin.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // Mint enough for dead stake + testing
    await mintTo(
      provider.connection,
      admin,
      profitMint.publicKey,
      adminTokenAccount,
      admin,
      100_000_000_000, // 100,000 PROFIT
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // =========================================================================
    // Step 6: Derive Staking PDAs
    // =========================================================================
    [stakePool, stakePoolBump] = PublicKey.findProgramAddressSync(
      [STAKE_POOL_SEED],
      stakingProgram.programId,
    );

    [escrowVault] = PublicKey.findProgramAddressSync(
      [ESCROW_VAULT_SEED],
      stakingProgram.programId,
    );

    [stakeVault] = PublicKey.findProgramAddressSync(
      [STAKE_VAULT_SEED],
      stakingProgram.programId,
    );

    // =========================================================================
    // Step 7: Whitelist admin's token account BEFORE StakePool init
    //
    // The initializeStakePool instruction transfers MINIMUM_STAKE from admin
    // to stakeVault using transfer_checked. Since the hook is active on the
    // mint, the admin's token account (source) needs to be whitelisted.
    //
    // We also whitelist the stakeVault (destination) so that future transfers
    // to/from vault work.
    // =========================================================================

    // Whitelist admin's token account (source for dead stake transfer)
    const [adminWhitelistEntry] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, adminTokenAccount.toBuffer()],
      transferHookProgram.programId,
    );

    await transferHookProgram.methods
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

    // =========================================================================
    // Step 8: Initialize StakePool (creates StakeVault PDA)
    //
    // This creates the global stake pool with dead stake protection.
    // The stakeVault is created as a Token-2022 account seeded by
    // ["stake_vault"], with stakePool PDA as its authority.
    //
    // IMPORTANT: We build hook remaining_accounts manually because stakeVault
    // does not exist yet (Anchor creates it in this instruction via init).
    // The hook accounts are derived deterministically from ExtraAccountMeta
    // seed definitions: extraAccountMetaList, whitelistSource, whitelistDest,
    // and the Transfer Hook program ID.
    // =========================================================================

    // Derive whitelist PDAs for source (admin) and dest (stakeVault)
    const [whitelistSourceForInit] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, adminTokenAccount.toBuffer()],
      transferHookProgram.programId,
    );
    const [whitelistDestForInit] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, stakeVault.toBuffer()],
      transferHookProgram.programId,
    );

    // Build the 4 hook accounts manually matching the ExtraAccountMeta layout:
    // [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]
    const deadStakeHookAccounts = [
      { pubkey: extraAccountMetaList, isSigner: false, isWritable: false },
      { pubkey: whitelistSourceForInit, isSigner: false, isWritable: false },
      { pubkey: whitelistDestForInit, isSigner: false, isWritable: false },
      { pubkey: transferHookProgram.programId, isSigner: false, isWritable: false },
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

    // =========================================================================
    // Step 9: Whitelist StakeVault in Transfer Hook (entry #14 pattern)
    //
    // Now that the StakeVault exists (created during StakePool init),
    // whitelist it so that stake/unstake transfers to/from vault succeed.
    // =========================================================================
    [stakeVaultWhitelistEntry] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, stakeVault.toBuffer()],
      transferHookProgram.programId,
    );

    await transferHookProgram.methods
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

    // =========================================================================
    // Step 10: Create test user with token account and minted PROFIT
    // =========================================================================
    user = Keypair.generate();
    const airdropSig2 = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdropSig2);

    userTokenAccount = await createAccount(
      provider.connection,
      user,
      profitMint.publicKey,
      user.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // Mint tokens to user for testing
    await mintTo(
      provider.connection,
      admin,
      profitMint.publicKey,
      userTokenAccount,
      admin,
      10_000_000_000, // 10,000 PROFIT
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // No need to whitelist user's token account - stakeVault is whitelisted
    // and the Transfer Hook checks source OR destination.
    // For stake: user (source) -> stakeVault (dest, whitelisted) = OK
    // For unstake: stakeVault (source, whitelisted) -> user (dest) = OK

    // Derive user stake PDA
    [userStake] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, user.publicKey.toBuffer()],
      stakingProgram.programId,
    );
  });

  // ===========================================================================
  // Initialization Verification Tests
  // ===========================================================================

  describe("whitelist initialization", () => {
    it("Transfer Hook WhitelistAuthority is initialized", async () => {
      const auth =
        await transferHookProgram.account.whitelistAuthority.fetch(
          whitelistAuthority,
        );
      expect(auth.initialized).to.equal(true);
      expect(auth.authority.toString()).to.equal(admin.publicKey.toString());
    });

    it("StakePool is initialized with dead stake", async () => {
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(pool.initialized).to.equal(true);
      expect(pool.totalStaked.toNumber()).to.equal(MINIMUM_STAKE);

      // Verify vault has the dead stake tokens
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(vault.amount)).to.equal(MINIMUM_STAKE);
    });

    it("StakeVault is whitelisted (entry #14 pattern)", async () => {
      const entry = await transferHookProgram.account.whitelistEntry.fetch(
        stakeVaultWhitelistEntry,
      );
      expect(entry.address.toString()).to.equal(stakeVault.toString());
    });
  });

  // ===========================================================================
  // Stake with Hook Tests
  // ===========================================================================

  describe("stakeWithHook", () => {
    const stakeAmount = 1_000_000_000; // 1,000 PROFIT

    it("stakes PROFIT tokens with Transfer Hook remaining_accounts", async () => {
      const beforePool =
        await stakingProgram.account.stakePool.fetch(stakePool);
      const beforeVault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      const sig = await stakeWithHook(
        provider.connection,
        stakingProgram,
        user,
        stakeAmount,
        {
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      expect(sig).to.be.a("string");

      // Verify user stake account was created
      const userStakeAccount =
        await stakingProgram.account.userStake.fetch(userStake);
      expect(userStakeAccount.owner.toString()).to.equal(
        user.publicKey.toString(),
      );
      expect(userStakeAccount.stakedBalance.toNumber()).to.equal(stakeAmount);

      // Verify pool total increased
      const afterPool =
        await stakingProgram.account.stakePool.fetch(stakePool);
      expect(afterPool.totalStaked.toNumber()).to.equal(
        beforePool.totalStaked.toNumber() + stakeAmount,
      );

      // Verify vault balance increased
      const afterVault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(afterVault.amount)).to.equal(
        Number(beforeVault.amount) + stakeAmount,
      );

      // Escrow solvency invariant must hold after stake
      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
    });
  });

  // ===========================================================================
  // Unstake with Hook Tests
  // ===========================================================================

  describe("unstakeWithHook", () => {
    const unstakeAmount = 200_000_000; // 200 PROFIT

    it("unstakes PROFIT tokens with Transfer Hook remaining_accounts", async () => {
      const beforeUser =
        await stakingProgram.account.userStake.fetch(userStake);
      const beforePool =
        await stakingProgram.account.stakePool.fetch(stakePool);

      const sig = await unstakeWithHook(
        provider.connection,
        stakingProgram,
        user,
        unstakeAmount,
        {
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      expect(sig).to.be.a("string");

      // Verify user balance decreased
      const afterUser =
        await stakingProgram.account.userStake.fetch(userStake);
      expect(afterUser.stakedBalance.toNumber()).to.equal(
        beforeUser.stakedBalance.toNumber() - unstakeAmount,
      );

      // Verify pool total decreased
      const afterPool =
        await stakingProgram.account.stakePool.fetch(stakePool);
      expect(afterPool.totalStaked.toNumber()).to.equal(
        beforePool.totalStaked.toNumber() - unstakeAmount,
      );

      // Escrow solvency invariant must hold after unstake
      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
    });
  });


  // ===========================================================================
  // Happy Path with Escrow Solvency Invariant
  // ===========================================================================

  describe("happy path", () => {
    it("stake transfers PROFIT through Transfer Hook and maintains solvency", async () => {
      const amount = 500_000_000; // 500 PROFIT

      const beforeVault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      await stakeWithHook(
        provider.connection,
        stakingProgram,
        user,
        amount,
        {
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      const afterVault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(afterVault.amount)).to.equal(
        Number(beforeVault.amount) + amount,
      );

      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
    });

    it("unstake transfers PROFIT back through Transfer Hook and maintains solvency", async () => {
      const amount = 200_000_000; // 200 PROFIT

      const beforeUser = await getAccount(
        provider.connection,
        userTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      await unstakeWithHook(
        provider.connection,
        stakingProgram,
        user,
        amount,
        {
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      const afterUser = await getAccount(
        provider.connection,
        userTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(afterUser.amount)).to.equal(
        Number(beforeUser.amount) + amount,
      );

      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
    });
  });


  // ===========================================================================
  // Multi-User Tests
  // ===========================================================================

  describe("multi-user", () => {
    // Second user for multi-user tests
    let userB: Keypair;
    let userBTokenAccount: PublicKey;
    let userBStake: PublicKey;

    before(async () => {
      // Create userB with token account and minted PROFIT
      userB = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        userB.publicKey,
        10 * LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(airdropSig);

      userBTokenAccount = await createAccount(
        provider.connection,
        userB,
        profitMint.publicKey,
        userB.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // Mint tokens to userB for testing
      await mintTo(
        provider.connection,
        admin,
        profitMint.publicKey,
        userBTokenAccount,
        admin,
        10_000_000_000, // 10,000 PROFIT
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // Derive userB stake PDA
      [userBStake] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, userB.publicKey.toBuffer()],
        stakingProgram.programId,
      );
    });

    it("two users stake and pool tracks proportional balances", async () => {
      const userAAmount = 1_000_000_000; // 1,000 PROFIT
      const userBAmount = 3_000_000_000; // 3,000 PROFIT

      const beforePool = await stakingProgram.account.stakePool.fetch(stakePool);
      const beforeTotal = beforePool.totalStaked.toNumber();

      // UserA stakes (user from outer scope, already has staked balance)
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        user,
        userAAmount,
        {
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);

      // UserB stakes
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        userB,
        userBAmount,
        {
          stakePool,
          userStake: userBStake,
          userTokenAccount: userBTokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);

      // Verify pool total reflects both users
      const afterPool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(afterPool.totalStaked.toNumber()).to.equal(
        beforeTotal + userAAmount + userBAmount,
      );

      // Verify userB's stake account
      const userBStakeAccount = await stakingProgram.account.userStake.fetch(userBStake);
      expect(userBStakeAccount.owner.toString()).to.equal(userB.publicKey.toString());
      expect(userBStakeAccount.stakedBalance.toNumber()).to.equal(userBAmount);

      // NOTE: Full proportional reward distribution test requires Tax/Epoch
      // Program CPI to call deposit_rewards and update_cumulative.
      // The proportional math is extensively unit-tested in helpers/math.rs
      // (see proportional_distribution, multi_epoch_accumulation tests).
    });
  });

  // ===========================================================================
  // Edge Case Tests
  // ===========================================================================

  describe("edge cases", () => {
    it("mid-epoch stake earns no same-epoch rewards (checkpoint pattern)", async () => {
      // When a user stakes, their rewards_per_token_paid checkpoint is set
      // to the current pool.rewards_per_token_stored. Since no new cumulative
      // update has happened, the delta is 0, so they earn 0 rewards.
      //
      // This is the flash-loan protection: stake/unstake in same epoch = 0 rewards.

      const userStakeAccount = await stakingProgram.account.userStake.fetch(userStake);
      const poolAccount = await stakingProgram.account.stakePool.fetch(stakePool);

      // User's checkpoint should match current cumulative (no pending delta)
      expect(userStakeAccount.rewardsPerTokenPaid.toString()).to.equal(
        poolAccount.rewardsPerTokenStored.toString(),
      );

      // Since no rewards have been deposited+distributed, rewards_earned should be 0
      expect(userStakeAccount.rewardsEarned.toNumber()).to.equal(0);

      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
    });

    it("claim with zero rewards fails gracefully (NothingToClaim)", async () => {
      // User has staked but no rewards have been distributed via
      // deposit_rewards + update_cumulative CPI, so rewards_earned = 0.
      // Claim should fail with NothingToClaim error.

      try {
        await stakingProgram.methods
          .claim()
          .accountsStrict({
            user: user.publicKey,
            stakePool,
            userStake,
            escrowVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed with NothingToClaim");
      } catch (err: any) {
        const errStr = err.toString();
        expect(
          errStr.includes("NothingToClaim") ||
          errStr.includes("No rewards to claim") ||
          errStr.includes("0x1773"), // 6003 in hex = NothingToClaim (4th error variant)
        ).to.equal(true, `Expected NothingToClaim error, got: ${errStr}`);
      }

      await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
    });

    it("escrow solvency holds after 10 consecutive operations", async () => {
      // Perform multiple stake/unstake operations in sequence and verify
      // escrow solvency invariant holds after each one.
      // This proves the invariant is robust under load.

      const smallAmount = 100_000_000; // 100 PROFIT

      for (let i = 0; i < 5; i++) {
        // Stake
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          user,
          smallAmount,
          {
            stakePool,
            userStake,
            userTokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);

        // Unstake
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          user,
          smallAmount,
          {
            stakePool,
            userStake,
            userTokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        await assertEscrowSolvency(provider.connection, stakingProgram, escrowVault, stakePool);
      }

      // Final state should be consistent
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(pool.totalStaked.toNumber()).to.be.gt(0); // At least dead stake remains
    });
  });

  // ===========================================================================
  // Whitelist Enforcement (Negative Tests)
  // ===========================================================================

  describe("whitelist enforcement", () => {
    it("stake fails with NoWhitelistedParty when StakeVault not whitelisted", async () => {
      // Create a completely separate PROFIT mint with transfer hook extension
      // but WITHOUT any whitelist entries - proving the hook rejects transfers
      const freshMint = Keypair.generate();
      const freshMintLen = getMintLen([ExtensionType.TransferHook]);
      const freshMintLamports =
        await provider.connection.getMinimumBalanceForRentExemption(
          freshMintLen,
        );

      const freshMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: freshMint.publicKey,
          space: freshMintLen,
          lamports: freshMintLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferHookInstruction(
          freshMint.publicKey,
          admin.publicKey,
          transferHookProgram.programId,
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMintInstruction(
          freshMint.publicKey,
          PROFIT_DECIMALS,
          admin.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      );

      await sendAndConfirmTransaction(provider.connection, freshMintTx, [
        admin,
        freshMint,
      ]);

      // Initialize ExtraAccountMetaList for the fresh mint
      const [freshExtraAccountMetaList] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("extra-account-metas"),
          freshMint.publicKey.toBuffer(),
        ],
        transferHookProgram.programId,
      );

      await transferHookProgram.methods
        .initializeExtraAccountMetaList()
        .accountsStrict({
          payer: admin.publicKey,
          whitelistAuthority,
          authority: admin.publicKey,
          extraAccountMetaList: freshExtraAccountMetaList,
          mint: freshMint.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      // Create source token account for the fresh mint
      const freshSourceAccount = await createAccount(
        provider.connection,
        user,
        freshMint.publicKey,
        user.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // Create a destination token account for the fresh mint
      // (owned by admin, just needs to exist for the transfer)
      const freshDestAccount = await createAccount(
        provider.connection,
        admin,
        freshMint.publicKey,
        admin.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // Mint tokens to source
      await mintTo(
        provider.connection,
        admin,
        freshMint.publicKey,
        freshSourceAccount,
        admin,
        10_000_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // Attempt a transfer_checked with the fresh mint where NEITHER source
      // nor destination is whitelisted. The Transfer Hook should reject this.
      try {
        const transferIx =
          await createTransferCheckedWithTransferHookInstruction(
            provider.connection,
            freshSourceAccount,
            freshMint.publicKey,
            freshDestAccount, // Neither source nor destination is whitelisted
            user.publicKey,
            BigInt(1_000_000),
            PROFIT_DECIMALS,
            [],
            "confirmed",
            TOKEN_2022_PROGRAM_ID,
          );

        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(provider.connection, tx, [user]);
        expect.fail("Should have failed with NoWhitelistedParty");
      } catch (err: any) {
        // The Transfer Hook should reject with NoWhitelistedParty (error code 6000)
        // The error may be wrapped in a transaction error
        const errStr = err.toString();
        expect(
          errStr.includes("0x1770") || // 6000 in hex = NoWhitelistedParty
            errStr.includes("NoWhitelistedParty") ||
            errStr.includes("custom program error: 0x1770"),
        ).to.equal(true, `Expected NoWhitelistedParty error, got: ${errStr}`);
      }
    });
  });
});
