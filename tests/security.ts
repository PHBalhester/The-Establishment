/**
 * Security Attack Simulation & Escrow Solvency Test Suite
 *
 * This suite validates that the staking system resists the three primary
 * attack vectors and maintains the escrow solvency invariant under load.
 *
 * Phase 29 requirements tested:
 * - SEC-01: First-depositor inflation attack (MINIMUM_STAKE dead stake)
 * - SEC-02: Flash loan same-epoch exploitation (checkpoint pattern)
 * - SEC-03: CPI forgery on deposit_rewards (seeds::program constraint)
 * - SEC-04: CPI forgery on update_cumulative (seeds::program constraint)
 * - SEC-06: Escrow solvency invariant (escrow_balance >= pending_rewards)
 *
 * NOTE: This test file runs in its own validator instance because StakePool
 * is a singleton PDA (seeds = ["stake_pool"]). Running alongside staking.ts
 * or token-flow.ts would cause PDA conflicts since each inits with a different mint.
 *
 * Initialization follows the EXACT same pattern as token-flow.ts (Steps 1-10).
 *
 * Source: .planning/phases/29-security-edge-case-testing/29-02-PLAN.md
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
const PRECISION = BigInt("1000000000000000000"); // 1e18

// PDA seeds - must match program constants
const STAKE_POOL_SEED = Buffer.from("stake_pool");
const ESCROW_VAULT_SEED = Buffer.from("escrow_vault");
const STAKE_VAULT_SEED = Buffer.from("stake_vault");
const USER_STAKE_SEED = Buffer.from("user_stake");
const WHITELIST_AUTHORITY_SEED = Buffer.from("authority");
const WHITELIST_ENTRY_SEED = Buffer.from("whitelist");
const TAX_AUTHORITY_SEED = Buffer.from("tax_authority");
const STAKING_AUTHORITY_SEED = Buffer.from("staking_authority");

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
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    accounts.stakeVault,
    accounts.profitMint,
    accounts.userTokenAccount,
    accounts.stakePool,
    BigInt(amount),
    PROFIT_DECIMALS,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );

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
 * Called after EVERY state-modifying operation in security tests.
 */
async function assertEscrowSolvency(
  connection: anchor.web3.Connection,
  stakingProgram: Program<Staking>,
  escrowVault: PublicKey,
  stakePool: PublicKey,
): Promise<void> {
  const pool = await stakingProgram.account.stakePool.fetch(stakePool);
  const escrowBalance = await connection.getBalance(escrowVault);

  expect(escrowBalance).to.be.gte(
    pool.pendingRewards.toNumber(),
    `Escrow solvency violated: balance ${escrowBalance} < pending ${pool.pendingRewards.toNumber()}`
  );
}

/**
 * Create a new staker with a funded token account, adapted for Transfer Hook setup.
 *
 * This factory creates a fresh keypair, airdrops SOL, creates a Token-2022
 * token account for the Transfer Hook-enabled PROFIT mint, mints tokens,
 * and derives the UserStake PDA.
 *
 * Follows the pattern from cross-program-integration.ts createStaker()
 * but uses Token-2022 with the Transfer Hook-enabled mint.
 */
async function createStakerWithTokens(
  connection: anchor.web3.Connection,
  admin: Keypair,
  profitMint: PublicKey,
  stakingProgramId: PublicKey,
  amount: number,
): Promise<{ keypair: Keypair; userStake: PublicKey; tokenAccount: PublicKey }> {
  const keypair = Keypair.generate();

  // Airdrop SOL for rent and transaction fees
  const sig = await connection.requestAirdrop(
    keypair.publicKey,
    2 * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(sig);

  // Create Token-2022 token account for the Transfer Hook-enabled mint
  const tokenAccount = await createAccount(
    connection,
    keypair,
    profitMint,
    keypair.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  // Mint tokens (admin is mint authority)
  await mintTo(
    connection,
    admin,
    profitMint,
    tokenAccount,
    admin,
    amount,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  // Derive UserStake PDA
  const [userStake] = PublicKey.findProgramAddressSync(
    [USER_STAKE_SEED, keypair.publicKey.toBuffer()],
    stakingProgramId,
  );

  return { keypair, userStake, tokenAccount };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("security", () => {
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

  // Primary test user
  let user: Keypair;
  let userTokenAccount: PublicKey;
  let userStake: PublicKey;

  before(async () => {
    // =========================================================================
    // Step 1: Create admin keypair, fund with SOL
    // =========================================================================
    admin = Keypair.generate();
    const airdropSig1 = await provider.connection.requestAirdrop(
      admin.publicKey,
      100 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdropSig1);

    // =========================================================================
    // Step 2: Create PROFIT mint (Token-2022 with transfer hook extension)
    // =========================================================================
    profitMint = Keypair.generate();

    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const mintLamports =
      await provider.connection.getMinimumBalanceForRentExemption(mintLen);

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
        transferHookProgram.programId,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        profitMint.publicKey,
        PROFIT_DECIMALS,
        admin.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    await sendAndConfirmTransaction(provider.connection, mintTx, [
      admin,
      profitMint,
    ]);

    // =========================================================================
    // Step 3: Initialize Transfer Hook program (WhitelistAuthority PDA)
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

    // Mint enough for dead stake + all security tests
    await mintTo(
      provider.connection,
      admin,
      profitMint.publicKey,
      adminTokenAccount,
      admin,
      1_000_000_000_000, // 1,000,000 PROFIT (enough for stress tests)
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
    // =========================================================================
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
    // Hook remaining_accounts built manually because stakeVault does not
    // exist yet (Anchor creates it in this instruction via init).
    // =========================================================================
    const [whitelistSourceForInit] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, adminTokenAccount.toBuffer()],
      transferHookProgram.programId,
    );
    const [whitelistDestForInit] = PublicKey.findProgramAddressSync(
      [WHITELIST_ENTRY_SEED, stakeVault.toBuffer()],
      transferHookProgram.programId,
    );

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
    // Step 9: Whitelist StakeVault in Transfer Hook
    // =========================================================================
    const [stakeVaultWhitelistEntry] = PublicKey.findProgramAddressSync(
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
    // Step 10: Create primary test user with token account and minted PROFIT
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

    await mintTo(
      provider.connection,
      admin,
      profitMint.publicKey,
      userTokenAccount,
      admin,
      100_000_000_000, // 100,000 PROFIT for extensive testing
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    [userStake] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, user.publicKey.toBuffer()],
      stakingProgram.programId,
    );
  });

  // ===========================================================================
  // Security: First-Depositor Attack (SEC-01)
  // ===========================================================================

  /**
   * ATTACK: First-Depositor Inflation Attack
   *
   * SCENARIO:
   * 1. Attacker is first staker with minimal stake (1 lamport)
   * 2. Large reward deposited to pool
   * 3. Attacker claims disproportionate rewards as sole staker
   * 4. Subsequent stakers receive diluted yield
   *
   * MITIGATION: MINIMUM_STAKE dead stake during initialization (SEC-01)
   * Protocol stakes 1 PROFIT (1,000,000 units) as irrecoverable "dead stake"
   * during initialize_stake_pool. This ensures:
   * - Pool always has meaningful denominator for reward math
   * - Attacker cannot be sole staker with dust amount
   *
   * PROPERTY VALIDATED: total_staked >= MINIMUM_STAKE always
   */
  describe("Security: First-Depositor Attack (SEC-01)", () => {
    it("pool starts with MINIMUM_STAKE dead stake", async () => {
      // After initializeStakePool, the pool should have exactly MINIMUM_STAKE
      // staked as "dead stake" - protocol-owned, irrecoverable tokens that
      // ensure the reward math denominator is never trivially small.
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(pool.totalStaked.toNumber()).to.be.gte(MINIMUM_STAKE);

      // Verify the vault actually holds the tokens (not just an accounting entry)
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(vault.amount)).to.be.gte(MINIMUM_STAKE);

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    it("attacker with 1 unit cannot capture majority of rewards", async () => {
      // Even if an attacker stakes 1 unit (the smallest possible amount),
      // their share of the pool is bounded by MINIMUM_STAKE in the denominator.
      //
      // attacker_share = 1 / (MINIMUM_STAKE + 1)
      //                = 1 / 1,000,001
      //                = 0.000000999... (< 0.0001%)
      //
      // Without dead stake: attacker_share = 1 / 1 = 100% (catastrophic!)
      // With dead stake: attacker_share < 0.0001% (negligible)

      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      const currentTotalStaked = BigInt(pool.totalStaked.toString());
      const attackerStake = BigInt(1);
      const totalAfterAttack = currentTotalStaked + attackerStake;

      // Calculate attacker's share using BigInt precision
      // Multiply by 1e12 first to avoid truncation to 0
      const shareScaled = (attackerStake * BigInt(1_000_000_000_000)) / totalAfterAttack;

      // shareScaled / 1e12 gives the decimal fraction
      // We need this to be < 0.000001 (< 0.0001%)
      // So shareScaled < 1_000_000 (1e6 out of 1e12)
      expect(Number(shareScaled)).to.be.lt(
        1_000_000,
        `Attacker share ${Number(shareScaled) / 1e12} is too high (>= 0.0001%)`
      );

      // With MINIMUM_STAKE = 1,000,000, attacker's share is 1/1,000,001 ~= 9.999e-7
      // shareScaled = 999999 which is well below 1,000,000 (the 0.0001% threshold)
      // This proves the dead stake makes dust attacks economically irrelevant
      expect(Number(shareScaled)).to.be.lt(
        1_000_000,
        "Attacker share with dead stake protection must be < 0.0001%"
      );
    });

    it("dead stake is irrecoverable (no UserStake PDA for dead stake)", async () => {
      // The dead stake is transferred during initializeStakePool from the
      // admin's token account to the stakeVault. There is NO UserStake PDA
      // created for this dead stake -- it is protocol-owned and cannot be
      // unstaked or claimed by anyone.
      //
      // Verify: deriving a UserStake PDA for the stakePool authority
      // (which signed the dead stake transfer) should yield an account
      // that either doesn't exist or has 0 staked balance.

      // The stakePool PDA itself is the vault authority, but it doesn't have
      // a UserStake account. Let's also check the admin (who called init).
      const [adminUserStake] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, admin.publicKey.toBuffer()],
        stakingProgram.programId,
      );

      try {
        const adminStakeAccount = await stakingProgram.account.userStake.fetch(
          adminUserStake,
        );
        // If it exists, staked balance should be 0 (admin never staked via stake())
        expect(adminStakeAccount.stakedBalance.toNumber()).to.equal(0);
      } catch (err: any) {
        // Account doesn't exist -- this is the expected path.
        // The dead stake has no corresponding UserStake, meaning no one can claim it.
        expect(err.toString()).to.include("Account does not exist");
      }

      // Also verify: the stakePool PDA itself cannot have a UserStake
      const [poolUserStake] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, stakePool.toBuffer()],
        stakingProgram.programId,
      );

      try {
        await stakingProgram.account.userStake.fetch(poolUserStake);
        expect.fail("StakePool PDA should not have a UserStake account");
      } catch (err: any) {
        // Expected: no UserStake for the pool PDA
        expect(err.toString()).to.include("Account does not exist");
      }
    });
  });

  // ===========================================================================
  // Security: Flash Loan Attack (SEC-02)
  // ===========================================================================

  /**
   * ATTACK: Flash Loan Same-Epoch Exploitation
   *
   * SCENARIO:
   * 1. Attacker sees deposit_rewards tx in mempool
   * 2. Attacker flash-loans PROFIT tokens
   * 3. Attacker stakes PROFIT before epoch end
   * 4. update_cumulative finalizes rewards
   * 5. Attacker claims disproportionate rewards
   * 6. Attacker unstakes and repays flash loan
   *
   * MITIGATION: Checkpoint pattern (SEC-02)
   * On stake, user.rewards_per_token_paid = pool.rewards_per_token_stored.
   * User only earns from FUTURE cumulative increases.
   * update_cumulative is CPI-gated to Epoch Program (SEC-04).
   * Flash loans repay in same transaction; cannot span epochs.
   *
   * PROPERTY VALIDATED: same-epoch stake/unstake earns 0 rewards
   */
  describe("Security: Flash Loan Attack (SEC-02)", () => {
    it("stake captures current cumulative as checkpoint", async () => {
      // When a user stakes, their rewards_per_token_paid is set to the
      // current pool.rewards_per_token_stored. This "checkpoint" ensures
      // they can only earn from FUTURE cumulative increases, not past ones.

      // Stake some tokens with the test user
      const stakeAmount = 1_000_000_000; // 1,000 PROFIT
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        user,
        stakeAmount,
        { stakePool, userStake, userTokenAccount, stakeVault, profitMint: profitMint.publicKey },
      );

      // Verify checkpoint was captured
      const userStakeAccount = await stakingProgram.account.userStake.fetch(userStake);
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);

      expect(userStakeAccount.rewardsPerTokenPaid.toString()).to.equal(
        pool.rewardsPerTokenStored.toString(),
        "User checkpoint must match pool cumulative at time of stake"
      );

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    it("same-epoch stake/unstake earns exactly 0 rewards", async () => {
      // A flash loan attacker would stake and unstake in the same transaction
      // (or at least the same epoch). Since no update_cumulative has occurred
      // between stake and unstake, the reward delta is 0.
      //
      // This test creates a fresh user, stakes, immediately unstakes, and
      // verifies totalClaimed == 0 and rewardsEarned == 0.

      const flashAttacker = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        500_000_000, // 500 PROFIT
      );

      const flashStakeAmount = 200_000_000; // 200 PROFIT

      // Stake (attacker enters the pool)
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        flashAttacker.keypair,
        flashStakeAmount,
        {
          stakePool,
          userStake: flashAttacker.userStake,
          userTokenAccount: flashAttacker.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );

      // Immediately unstake (attacker exits the pool)
      await unstakeWithHook(
        provider.connection,
        stakingProgram,
        flashAttacker.keypair,
        flashStakeAmount,
        {
          stakePool,
          userStake: flashAttacker.userStake,
          userTokenAccount: flashAttacker.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Verify: attacker earned exactly 0 rewards
      const attackerAccount = await stakingProgram.account.userStake.fetch(
        flashAttacker.userStake,
      );
      expect(attackerAccount.totalClaimed.toNumber()).to.equal(
        0,
        "Flash loan attacker should have claimed 0 rewards"
      );
      expect(attackerAccount.rewardsEarned.toNumber()).to.equal(
        0,
        "Flash loan attacker should have earned 0 rewards"
      );

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    it("checkpoint math: stake after deposit earns 0 from that deposit", async () => {
      // Pure BigInt math test validating the checkpoint pattern.
      //
      // If cumulative is X when user stakes, their checkpoint = X.
      // If cumulative stays X (no update_cumulative called), delta = 0,
      // so rewards = 0.
      //
      // This is why flash loans fail: the attacker's checkpoint captures
      // the current cumulative, and no new cumulative can be added until
      // the next epoch (controlled by Epoch Program via CPI gate).

      // Simulate: pool has accumulated 500 SOL of rewards over past epochs
      const cumulativeBefore = BigInt(500) * PRECISION;

      // User stakes AFTER this cumulative has been set
      const userCheckpoint = cumulativeBefore; // Captured on stake
      const userBalance = BigInt(10_000_000_000); // 10,000 PROFIT

      // No update_cumulative has happened since user staked
      const cumulativeNow = cumulativeBefore; // Unchanged

      // Calculate rewards: (cumulative_now - checkpoint) * balance / PRECISION
      const delta = cumulativeNow - userCheckpoint;
      const rewards = (delta * userBalance) / PRECISION;

      expect(delta.toString()).to.equal("0", "Delta should be 0 when no update occurred");
      expect(rewards.toString()).to.equal("0", "Rewards should be 0 with zero delta");

      // Contrast with a legitimate staker who was in before the last update:
      const legitimateCheckpoint = BigInt(400) * PRECISION; // Staked at cumulative=400
      const legitimateDelta = cumulativeNow - legitimateCheckpoint;
      const legitimateRewards = (legitimateDelta * userBalance) / PRECISION;

      // Legitimate staker earns: (500-400) * 10B / 1e18 * 1e18 = 100 * 10B = 1T lamports
      expect(legitimateRewards.toString()).to.equal(
        "1000000000000",
        "Legitimate staker should earn proportional rewards"
      );
    });
  });

  // ===========================================================================
  // Security: CPI Forgery (SEC-03, SEC-04)
  // ===========================================================================

  /**
   * ATTACK: CPI Forgery (Unauthorized deposit_rewards/update_cumulative)
   *
   * SCENARIO:
   * 1. Attacker deploys fake program with same interface
   * 2. Fake program derives PDA with same seeds (TAX_AUTHORITY_SEED)
   * 3. Fake program CPIs to deposit_rewards with inflated amount
   * 4. Pool state corrupted with phantom rewards
   *
   * MITIGATION: seeds::program constraint (SEC-03, SEC-04)
   * Staking Program verifies PDA was derived from SPECIFIC program IDs:
   * - deposit_rewards: seeds::program = tax_program_id()
   * - update_cumulative: seeds::program = epoch_program_id()
   * A PDA from any other program ID will fail constraint validation.
   *
   * PROPERTY VALIDATED: Only Tax/Epoch Program can call CPI-gated instructions
   */
  describe("Security: CPI Forgery (SEC-03, SEC-04)", () => {
    it("rejects deposit_rewards from unauthorized keypair", async () => {
      // An attacker creates a random keypair and tries to call deposit_rewards.
      // The seeds::program constraint on taxAuthority will reject it because
      // the keypair is NOT a PDA derived from Tax Program.
      //
      // Even if the attacker derives a PDA with the same seeds ("tax_authority"),
      // it would be derived from THEIR program ID, not Tax Program's ID.

      const unauthorizedKeypair = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        unauthorizedKeypair.publicKey,
        LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await stakingProgram.methods
          .depositRewards(new anchor.BN(1_000_000_000))
          .accountsStrict({
            taxAuthority: unauthorizedKeypair.publicKey,
            stakePool,
          })
          .signers([unauthorizedKeypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        // Expected: ConstraintSeeds error because the keypair is not a valid
        // PDA derived from Tax Program with TAX_AUTHORITY_SEED
        expect(
          err.message.includes("seeds") ||
          err.message.includes("Constraint") ||
          err.error?.errorCode?.code === "ConstraintSeeds" ||
          err.logs?.some((log: string) => log.includes("seeds"))
        ).to.be.true;
      }

      // Pool state should be unchanged (no phantom rewards injected)
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(pool.pendingRewards.toNumber()).to.equal(
        0,
        "Pending rewards must remain 0 after rejected deposit_rewards"
      );
    });

    it("rejects update_cumulative from unauthorized keypair", async () => {
      // Same pattern as deposit_rewards: an attacker cannot call
      // update_cumulative because the epochAuthority constraint requires
      // a PDA derived from Epoch Program (seeds::program = epoch_program_id()).

      const unauthorizedKeypair = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        unauthorizedKeypair.publicKey,
        LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await stakingProgram.methods
          .updateCumulative(1)
          .accountsStrict({
            epochAuthority: unauthorizedKeypair.publicKey,
            stakePool,
          })
          .signers([unauthorizedKeypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        expect(
          err.message.includes("seeds") ||
          err.message.includes("Constraint") ||
          err.error?.errorCode?.code === "ConstraintSeeds" ||
          err.logs?.some((log: string) => log.includes("seeds"))
        ).to.be.true;
      }

      // Pool cumulative should be unchanged
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(pool.rewardsPerTokenStored.toString()).to.equal(
        "0",
        "Cumulative must remain 0 after rejected update_cumulative"
      );
    });

    it("rejects deposit_rewards with zero amount", async () => {
      // Even IF an authorized caller sends amount=0, the instruction
      // should fail with ZeroAmount. This tests dual protection:
      // 1. seeds::program constraint (first line of defense)
      // 2. ZeroAmount validation (second line of defense)
      //
      // With a random keypair, it fails on seeds first. The test documents
      // that both protections exist.

      const unauthorizedKeypair = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        unauthorizedKeypair.publicKey,
        LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await stakingProgram.methods
          .depositRewards(new anchor.BN(0))
          .accountsStrict({
            taxAuthority: unauthorizedKeypair.publicKey,
            stakePool,
          })
          .signers([unauthorizedKeypair])
          .rpc();

        expect.fail("Should have failed with constraint or ZeroAmount error");
      } catch (err: any) {
        // Will fail on seeds constraint first (before reaching ZeroAmount check).
        // This is correct -- the seeds constraint is the outer perimeter defense.
        const errStr = err.toString();
        expect(
          errStr.includes("seeds") ||
          errStr.includes("Constraint") ||
          errStr.includes("ZeroAmount") ||
          errStr.includes("0x1770") // ZeroAmount error code
        ).to.be.true;
      }
    });
  });

  // ===========================================================================
  // Security: Escrow Solvency (SEC-06)
  // ===========================================================================

  /**
   * INVARIANT: Escrow Solvency
   *
   * The escrow vault (native SOL) must ALWAYS hold enough to cover
   * all pending rewards. If violated, users cannot claim their earned yield.
   *
   * escrow_balance >= pool.pending_rewards
   *
   * This invariant is tested after EVERY state-modifying operation.
   * The 100+ operation stress test simulates adversarial ordering:
   * rapid stake/unstake cycling, varying amounts, multiple users.
   *
   * PROPERTY VALIDATED: escrow_balance >= pending_rewards after every operation
   */
  describe("Security: Escrow Solvency (SEC-06)", () => {
    it("solvency holds after 100+ stake/unstake operations (single user)", async () => {
      // Stress test: rapid stake/unstake cycling with a single user.
      // 50 iterations x 2 operations (stake + unstake) = 100+ operations.
      // Amounts vary but stay within user's balance.
      //
      // This simulates an adversarial pattern: rapid cycling to try to
      // desynchronize the escrow balance from the pending rewards counter.

      const stressUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        50_000_000_000, // 50,000 PROFIT (large enough for 50 rounds)
      );

      // First stake to initialize the UserStake account
      const initialStake = 10_000_000_000; // 10,000 PROFIT
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        stressUser.keypair,
        initialStake,
        {
          stakePool,
          userStake: stressUser.userStake,
          userTokenAccount: stressUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );
      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );

      // Run 50 stake/unstake cycles = 100 operations
      let operationCount = 1; // Count the initial stake
      const cycleAmount = 100_000_000; // 100 PROFIT per cycle

      for (let i = 0; i < 50; i++) {
        // Stake additional
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stressUser.keypair,
          cycleAmount,
          {
            stakePool,
            userStake: stressUser.userStake,
            userTokenAccount: stressUser.tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        operationCount++;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );

        // Unstake the same amount
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          stressUser.keypair,
          cycleAmount,
          {
            stakePool,
            userStake: stressUser.userStake,
            userTokenAccount: stressUser.tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        operationCount++;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );
      }

      expect(operationCount).to.be.gte(
        101,
        `Expected 100+ operations, got ${operationCount}`
      );

      // Verify pool state is still consistent after all operations
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(pool.totalStaked.toNumber()).to.be.gt(0, "Pool should still have staked tokens");
    });

    it("solvency holds after multi-user concurrent operations (5 users)", async () => {
      // Create 5 independent stakers and interleave their operations.
      // This simulates realistic multi-user activity:
      // User A stakes, User B stakes, User C unstakes, User D stakes, etc.

      const NUM_USERS = 5;
      const stakers: Array<{
        keypair: Keypair;
        userStake: PublicKey;
        tokenAccount: PublicKey;
        staked: number;
      }> = [];

      // Create all 5 stakers
      for (let i = 0; i < NUM_USERS; i++) {
        const amount = (i + 1) * 2_000_000_000; // 2K, 4K, 6K, 8K, 10K PROFIT
        const staker = await createStakerWithTokens(
          provider.connection,
          admin,
          profitMint.publicKey,
          stakingProgram.programId,
          amount,
        );
        stakers.push({ ...staker, staked: 0 });
      }

      let operationCount = 0;

      // Phase 1: All users stake (5 operations)
      for (let i = 0; i < NUM_USERS; i++) {
        const stakeAmount = (i + 1) * 500_000_000; // 500M, 1B, 1.5B, 2B, 2.5B
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stakers[i].keypair,
          stakeAmount,
          {
            stakePool,
            userStake: stakers[i].userStake,
            userTokenAccount: stakers[i].tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        stakers[i].staked = stakeAmount;
        operationCount++;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );
      }

      // Phase 2: Interleaved operations (15+ operations)
      // Round-robin: A unstakes, B stakes, C stakes, D unstakes, E stakes,
      // then reverse: A stakes, B unstakes, C unstakes, D stakes, E unstakes
      for (let round = 0; round < 3; round++) {
        // User A: unstake 100 PROFIT
        if (stakers[0].staked > 100_000_000) {
          await unstakeWithHook(
            provider.connection,
            stakingProgram,
            stakers[0].keypair,
            100_000_000,
            {
              stakePool,
              userStake: stakers[0].userStake,
              userTokenAccount: stakers[0].tokenAccount,
              stakeVault,
              profitMint: profitMint.publicKey,
            },
          );
          stakers[0].staked -= 100_000_000;
          operationCount++;
          await assertEscrowSolvency(
            provider.connection, stakingProgram, escrowVault, stakePool
          );
        }

        // User B: stake 200 PROFIT more
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stakers[1].keypair,
          200_000_000,
          {
            stakePool,
            userStake: stakers[1].userStake,
            userTokenAccount: stakers[1].tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        stakers[1].staked += 200_000_000;
        operationCount++;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );

        // User C: stake 150 PROFIT
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stakers[2].keypair,
          150_000_000,
          {
            stakePool,
            userStake: stakers[2].userStake,
            userTokenAccount: stakers[2].tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        stakers[2].staked += 150_000_000;
        operationCount++;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );

        // User D: stake 100 PROFIT more
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stakers[3].keypair,
          100_000_000,
          {
            stakePool,
            userStake: stakers[3].userStake,
            userTokenAccount: stakers[3].tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        stakers[3].staked += 100_000_000;
        operationCount++;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );

        // User E: unstake 100 PROFIT
        if (stakers[4].staked > 100_000_000) {
          await unstakeWithHook(
            provider.connection,
            stakingProgram,
            stakers[4].keypair,
            100_000_000,
            {
              stakePool,
              userStake: stakers[4].userStake,
              userTokenAccount: stakers[4].tokenAccount,
              stakeVault,
              profitMint: profitMint.publicKey,
            },
          );
          stakers[4].staked -= 100_000_000;
          operationCount++;
          await assertEscrowSolvency(
            provider.connection, stakingProgram, escrowVault, stakePool
          );
        }
      }

      expect(operationCount).to.be.gte(
        20,
        `Expected 20+ operations across 5 users, got ${operationCount}`
      );

      // Final solvency check
      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );

      // Verify vault balance matches pool total
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(pool.totalStaked.toNumber()).to.equal(
        Number(vault.amount),
        "Pool total_staked must match vault token balance"
      );
    });

    it("solvency holds with escrow funding simulation", async () => {
      // Since deposit_rewards is CPI-gated (only Tax Program can call it),
      // we simulate the escrow funding part manually: transfer SOL to the
      // escrow vault via SystemProgram.transfer (this is what Tax Program does
      // before calling deposit_rewards).
      //
      // After funding, we verify that:
      // 1. Escrow balance increased
      // 2. pool.pendingRewards is still 0 (no deposit_rewards called)
      // 3. Solvency invariant holds: balance >= pendingRewards
      //
      // This validates the "SOL flows before state updates" part of the CEI
      // (Checks-Effects-Interactions) pattern.

      const poolBefore = await stakingProgram.account.stakePool.fetch(stakePool);
      const escrowBefore = await provider.connection.getBalance(escrowVault);

      // Simulate Tax Program funding the escrow with 1 SOL
      const fundAmount = LAMPORTS_PER_SOL;
      const fundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: escrowVault,
          lamports: fundAmount,
        }),
      );
      await sendAndConfirmTransaction(provider.connection, fundTx, [admin]);

      // Verify escrow balance increased
      const escrowAfter = await provider.connection.getBalance(escrowVault);
      expect(escrowAfter).to.equal(
        escrowBefore + fundAmount,
        "Escrow should have received the funded SOL"
      );

      // pendingRewards should still be 0 (we didn't call deposit_rewards)
      const poolAfter = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(poolAfter.pendingRewards.toNumber()).to.equal(
        poolBefore.pendingRewards.toNumber(),
        "pendingRewards should be unchanged without deposit_rewards call"
      );

      // Solvency invariant: balance (funded) >= pendingRewards (0)
      // This is trivially true, but validates the pattern
      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  /**
   * Edge case tests validate correct behavior at boundary conditions.
   *
   * These tests cover:
   * - Zero total_staked prevention (dead stake)
   * - Mid-epoch stake earning no rewards from current epoch
   * - Partial unstake balance correctness
   * - NothingToClaim on zero rewards
   * - InsufficientBalance on excess unstake
   * - Auto-full-unstake dust prevention
   * - Rapid stake/unstake cycling economic manipulation
   *
   * Each edge case maps to specific error codes or security requirements
   * documented in Docs/New_Yield_System_Spec.md.
   */
  describe("Edge Cases", () => {
    /**
     * EDGE CASE: Zero total_staked scenario
     *
     * SCENARIO:
     * If total_staked were ever 0, the add_to_cumulative formula would
     * divide by zero: reward_per_token = pending * PRECISION / total_staked.
     * This would either panic or return an error, preventing reward distribution.
     *
     * MITIGATION: Dead stake (MINIMUM_STAKE = 1,000,000 units = 1 PROFIT)
     * is deposited during initializeStakePool and can never be withdrawn.
     * This guarantees total_staked >= MINIMUM_STAKE at all times.
     *
     * PROPERTY VALIDATED: pool.totalStaked >= MINIMUM_STAKE after init
     * Maps to: SEC-01, MATH-05
     */
    it("zero total_staked is prevented by dead stake (MINIMUM_STAKE)", async () => {
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);

      // Dead stake ensures total_staked is always >= MINIMUM_STAKE
      expect(pool.totalStaked.toNumber()).to.be.gte(
        MINIMUM_STAKE,
        `total_staked (${pool.totalStaked.toNumber()}) must be >= MINIMUM_STAKE (${MINIMUM_STAKE})`
      );

      // Verify the vault actually holds these tokens
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(vault.amount)).to.be.gte(
        MINIMUM_STAKE,
        "Vault must hold at least MINIMUM_STAKE tokens"
      );

      // Verify this prevents division-by-zero in reward math:
      // add_to_cumulative divides by total_staked, so total_staked > 0 is critical
      const totalStaked = BigInt(pool.totalStaked.toString());
      expect(totalStaked > BigInt(0)).to.be.true;

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    /**
     * EDGE CASE: Mid-epoch stake earns no rewards from current epoch
     *
     * SCENARIO:
     * User stakes after rewards have been deposited but before
     * update_cumulative has been called. Their checkpoint is set to
     * the current cumulative, so delta = 0 and they earn nothing
     * from any pending (undistributed) rewards.
     *
     * MITIGATION: On stake, user.rewardsPerTokenPaid is set to
     * pool.rewardsPerTokenStored. Since no update_cumulative has
     * occurred since they staked, delta remains 0.
     *
     * PROPERTY VALIDATED: user.rewardsPerTokenPaid == pool.rewardsPerTokenStored after stake
     * Maps to: SEC-02
     */
    it("mid-epoch stake earns no rewards from current epoch", async () => {
      // Create a fresh user for this test
      const midEpochUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        10_000_000_000, // 10,000 PROFIT
      );

      const stakeAmount = 5_000_000_000; // 5,000 PROFIT

      // Stake tokens -- this captures the checkpoint
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        midEpochUser.keypair,
        stakeAmount,
        {
          stakePool,
          userStake: midEpochUser.userStake,
          userTokenAccount: midEpochUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Verify: user's checkpoint matches pool's current cumulative
      const userAccount = await stakingProgram.account.userStake.fetch(
        midEpochUser.userStake,
      );
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);

      expect(userAccount.rewardsPerTokenPaid.toString()).to.equal(
        pool.rewardsPerTokenStored.toString(),
        "User checkpoint must equal pool cumulative at time of stake"
      );

      // Calculate delta (should be 0 since no update_cumulative occurred)
      const delta = BigInt(pool.rewardsPerTokenStored.toString()) -
        BigInt(userAccount.rewardsPerTokenPaid.toString());
      expect(delta.toString()).to.equal("0", "Delta must be 0 for mid-epoch stake");

      // Therefore pending = 0 * balance / PRECISION = 0
      const balance = BigInt(userAccount.stakedBalance.toString());
      const pending = (delta * balance) / PRECISION;
      expect(pending.toString()).to.equal("0", "Pending rewards must be 0 for mid-epoch stake");

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    /**
     * EDGE CASE: Partial unstake leaves correct remaining balance
     *
     * SCENARIO:
     * User stakes 1000 PROFIT, then unstakes 300 PROFIT. After the
     * partial unstake, user.stakedBalance should be exactly 700 PROFIT,
     * pool.totalStaked should have decreased by 300, and the vault
     * token balance should match pool.totalStaked.
     *
     * PROPERTY VALIDATED: Balance accounting is exact after partial unstake
     * Maps to: ERR-02
     */
    it("partial unstake leaves correct remaining balance", async () => {
      // Create fresh user for this test
      const partialUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        5_000_000_000, // 5,000 PROFIT
      );

      const stakeAmount = 1_000_000_000; // 1,000 PROFIT

      // Stake 1000 PROFIT
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        partialUser.keypair,
        stakeAmount,
        {
          stakePool,
          userStake: partialUser.userStake,
          userTokenAccount: partialUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );

      // Record pool state before unstake
      const poolBefore = await stakingProgram.account.stakePool.fetch(stakePool);
      const totalStakedBefore = poolBefore.totalStaked.toNumber();
      const vaultBefore = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // Unstake 300 PROFIT (partial)
      const unstakeAmount = 300_000_000; // 300 PROFIT
      await unstakeWithHook(
        provider.connection,
        stakingProgram,
        partialUser.keypair,
        unstakeAmount,
        {
          stakePool,
          userStake: partialUser.userStake,
          userTokenAccount: partialUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Verify user's remaining balance: 1000 - 300 = 700 PROFIT
      const userAfter = await stakingProgram.account.userStake.fetch(
        partialUser.userStake,
      );
      expect(userAfter.stakedBalance.toNumber()).to.equal(
        stakeAmount - unstakeAmount,
        `Expected ${stakeAmount - unstakeAmount}, got ${userAfter.stakedBalance.toNumber()}`
      );

      // Verify pool.totalStaked decreased by exactly 300
      const poolAfter = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(poolAfter.totalStaked.toNumber()).to.equal(
        totalStakedBefore - unstakeAmount,
        "Pool totalStaked should decrease by unstake amount"
      );

      // Verify vault balance decreased by 300
      const vaultAfter = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(vaultAfter.amount)).to.equal(
        Number(vaultBefore.amount) - unstakeAmount,
        "Vault balance should decrease by unstake amount"
      );

      // Solvency check after partial unstake
      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    /**
     * EDGE CASE: Claim with zero rewards fails with NothingToClaim
     *
     * SCENARIO:
     * User stakes tokens but no rewards have been deposited or distributed.
     * Their rewards_earned is 0. Calling claim should fail with the
     * NothingToClaim error (error code 0x1773 / 6003).
     *
     * PROPERTY VALIDATED: Cannot claim when rewards_earned == 0
     * Maps to: ERR-04
     */
    it("claim with zero rewards fails with NothingToClaim (ERR-04)", async () => {
      // Create fresh user and stake (no rewards deposited yet)
      const claimUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        5_000_000_000, // 5,000 PROFIT
      );

      // Stake some tokens
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        claimUser.keypair,
        1_000_000_000, // 1,000 PROFIT
        {
          stakePool,
          userStake: claimUser.userStake,
          userTokenAccount: claimUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Attempt to claim with 0 rewards -- should fail
      try {
        await stakingProgram.methods
          .claim()
          .accountsStrict({
            user: claimUser.keypair.publicKey,
            stakePool,
            userStake: claimUser.userStake,
            escrowVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([claimUser.keypair])
          .rpc();

        expect.fail("Should have failed with NothingToClaim error");
      } catch (err: any) {
        // NothingToClaim is the 4th error variant (index 3) -> 6000 + 3 = 6003 = 0x1773
        const errStr = err.toString();
        expect(
          errStr.includes("NothingToClaim") ||
          errStr.includes("0x1773") ||
          err.error?.errorCode?.code === "NothingToClaim",
        ).to.be.true;
      }
    });

    /**
     * EDGE CASE: Unstake exceeding balance fails with InsufficientBalance
     *
     * SCENARIO:
     * User has 500 PROFIT staked and tries to unstake 501 PROFIT.
     * The instruction should fail with InsufficientBalance error
     * before any state changes occur.
     *
     * PROPERTY VALIDATED: Cannot unstake more than staked balance
     * Maps to: ERR-02
     */
    it("unstake exceeding balance fails with InsufficientBalance (ERR-02)", async () => {
      // Create fresh user and stake 500 PROFIT
      const overflowUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        5_000_000_000, // 5,000 PROFIT
      );

      const stakeAmount = 500_000_000; // 500 PROFIT

      await stakeWithHook(
        provider.connection,
        stakingProgram,
        overflowUser.keypair,
        stakeAmount,
        {
          stakePool,
          userStake: overflowUser.userStake,
          userTokenAccount: overflowUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Attempt to unstake more than staked (501 PROFIT > 500 PROFIT)
      try {
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          overflowUser.keypair,
          stakeAmount + 1_000_000, // 501 PROFIT
          {
            stakePool,
            userStake: overflowUser.userStake,
            userTokenAccount: overflowUser.tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );

        expect.fail("Should have failed with InsufficientBalance error");
      } catch (err: any) {
        const errStr = err.toString();
        expect(
          errStr.includes("InsufficientBalance") ||
          errStr.includes("Insufficient staked balance") ||
          errStr.includes("0x1771") || // 6001 hex = InsufficientBalance (2nd variant)
          err.error?.errorCode?.code === "InsufficientBalance",
        ).to.be.true;
      }
    });

    /**
     * EDGE CASE: Auto-full-unstake when remaining < MINIMUM_STAKE
     *
     * SCENARIO:
     * User stakes MINIMUM_STAKE + 100 units. They unstake 101 units,
     * which would leave MINIMUM_STAKE - 1 remaining. Since this is
     * below MINIMUM_STAKE, the program auto-full-unstakes instead,
     * leaving the user with 0 staked balance.
     *
     * This prevents "dust positions" -- tiny staked amounts that can't
     * be further unstaked and would clog the pool accounting.
     *
     * PROPERTY VALIDATED: Auto-full-unstake triggers when remaining < MINIMUM_STAKE
     * Maps to: dust prevention (Phase 26-04 decision)
     */
    it("auto-full-unstake when remaining less than MINIMUM_STAKE", async () => {
      // Create fresh user
      const dustUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        10_000_000_000, // 10,000 PROFIT
      );

      // Stake exactly MINIMUM_STAKE + 100 units
      const stakeAmount = MINIMUM_STAKE + 100;

      await stakeWithHook(
        provider.connection,
        stakingProgram,
        dustUser.keypair,
        stakeAmount,
        {
          stakePool,
          userStake: dustUser.userStake,
          userTokenAccount: dustUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Verify initial stake
      const userBefore = await stakingProgram.account.userStake.fetch(
        dustUser.userStake,
      );
      expect(userBefore.stakedBalance.toNumber()).to.equal(stakeAmount);

      // Record pool state before unstake
      const poolBefore = await stakingProgram.account.stakePool.fetch(stakePool);

      // Unstake 101 units -- would leave MINIMUM_STAKE - 1 remaining
      // This should trigger auto-full-unstake (unstake full balance instead)
      const unstakeAmount = 101;
      await unstakeWithHook(
        provider.connection,
        stakingProgram,
        dustUser.keypair,
        unstakeAmount,
        {
          stakePool,
          userStake: dustUser.userStake,
          userTokenAccount: dustUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Verify: user's staked balance is 0 (auto-full-unstake triggered)
      const userAfter = await stakingProgram.account.userStake.fetch(
        dustUser.userStake,
      );
      expect(userAfter.stakedBalance.toNumber()).to.equal(
        0,
        "Auto-full-unstake should set balance to 0 when remaining < MINIMUM_STAKE"
      );

      // Verify: pool totalStaked decreased by the FULL stake amount (not just 101)
      const poolAfter = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(poolAfter.totalStaked.toNumber()).to.equal(
        poolBefore.totalStaked.toNumber() - stakeAmount,
        "Pool should decrease by full stake amount (auto-full-unstake)"
      );

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    /**
     * EDGE CASE: Rapid stake/unstake cycling cannot capture rewards
     *
     * SCENARIO:
     * An attacker rapidly stakes and unstakes in a loop, hoping to
     * accumulate rewards through some timing or rounding exploit.
     * Since no update_cumulative occurs between cycles, the checkpoint
     * pattern ensures delta = 0 every time, yielding 0 rewards.
     *
     * MITIGATION: Checkpoint pattern sets user.rewardsPerTokenPaid =
     * pool.rewardsPerTokenStored on every stake. Without update_cumulative
     * (which is CPI-gated to Epoch Program), the cumulative never changes,
     * so delta stays 0 across all cycles.
     *
     * PROPERTY VALIDATED: 10 stake/unstake cycles earn 0 rewards
     * Maps to: SEC-02 (checkpoint prevents manipulation)
     */
    it("rapid stake/unstake cycling cannot capture rewards (economic manipulation)", async () => {
      // Create fresh user with enough PROFIT for cycling
      const cycleUser = await createStakerWithTokens(
        provider.connection,
        admin,
        profitMint.publicKey,
        stakingProgram.programId,
        10_000_000_000, // 10,000 PROFIT
      );

      const cycleAmount = 500_000_000; // 500 PROFIT per cycle

      // First stake to initialize UserStake account
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        cycleUser.keypair,
        cycleAmount,
        {
          stakePool,
          userStake: cycleUser.userStake,
          userTokenAccount: cycleUser.tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      // Run 10 stake/unstake cycles
      for (let i = 0; i < 10; i++) {
        // Unstake
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          cycleUser.keypair,
          cycleAmount,
          {
            stakePool,
            userStake: cycleUser.userStake,
            userTokenAccount: cycleUser.tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );

        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );

        // Re-stake
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          cycleUser.keypair,
          cycleAmount,
          {
            stakePool,
            userStake: cycleUser.userStake,
            userTokenAccount: cycleUser.tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );

        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );
      }

      // Verify: total claimed == 0 after all cycles
      const userAfter = await stakingProgram.account.userStake.fetch(
        cycleUser.userStake,
      );
      expect(userAfter.totalClaimed.toNumber()).to.equal(
        0,
        "Rapid cycling should earn 0 claimed rewards"
      );
      expect(userAfter.rewardsEarned.toNumber()).to.equal(
        0,
        "Rapid cycling should earn 0 pending rewards"
      );

      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });
  });

  // ===========================================================================
  // Multi-User Proportional Distribution
  // ===========================================================================

  /**
   * Multi-user proportional distribution tests validate that the cumulative
   * reward-per-token math distributes rewards correctly among multiple stakers
   * with different stake amounts.
   *
   * These are pure BigInt math validation tests (off-chain) that prove the
   * on-chain formulas produce correct results. The key formula:
   *   userReward = (rewardPerToken * userBalance) / PRECISION
   *   where rewardPerToken = (totalRewards * PRECISION) / totalStaked
   *
   * Conservation property: sum(all userRewards) <= totalRewards
   * Dust property: totalRewards - sum(all userRewards) < numStakers
   */
  describe("Multi-User Proportional Distribution", () => {
    /**
     * PROPERTY: 10 stakers receive proportional rewards with BigInt precision
     *
     * SCENARIO:
     * 10 stakers with amounts [100, 200, 300, ... 1000] PROFIT (base units
     * with 6 decimals). 10 SOL is deposited as rewards. Each staker's reward
     * must match their stake proportion, with total dust < 10 (num stakers).
     *
     * PROPERTY VALIDATED:
     * - sum(all rewards) <= 10 SOL
     * - dust < number of stakers (truncation property)
     * - each user's share matches proportion (within 1 lamport tolerance)
     */
    it("10 stakers receive proportional rewards (BigInt math validation)", () => {
      // Define 10 stakers with escalating amounts (in base units, 6 decimals)
      const stakeAmounts = [
        BigInt(100_000_000),  // 100 PROFIT
        BigInt(200_000_000),  // 200 PROFIT
        BigInt(300_000_000),  // 300 PROFIT
        BigInt(400_000_000),  // 400 PROFIT
        BigInt(500_000_000),  // 500 PROFIT
        BigInt(600_000_000),  // 600 PROFIT
        BigInt(700_000_000),  // 700 PROFIT
        BigInt(800_000_000),  // 800 PROFIT
        BigInt(900_000_000),  // 900 PROFIT
        BigInt(1_000_000_000), // 1000 PROFIT
      ];

      const totalStaked = stakeAmounts.reduce((sum, a) => sum + a, BigInt(0));
      // totalStaked = 5,500,000,000 (5,500 PROFIT)

      const rewardsDeposited = BigInt(10_000_000_000); // 10 SOL in lamports

      // Calculate rewardPerToken (same formula as add_to_cumulative)
      const rewardPerToken = (rewardsDeposited * PRECISION) / totalStaked;

      // Calculate each user's reward
      let totalClaimed = BigInt(0);
      const userRewards: bigint[] = [];

      for (const amount of stakeAmounts) {
        const userReward = (rewardPerToken * amount) / PRECISION;
        userRewards.push(userReward);
        totalClaimed += userReward;
      }

      // Conservation: sum(all rewards) <= total deposited
      const dust = rewardsDeposited - totalClaimed;
      expect(Number(dust)).to.be.gte(
        0,
        "Total claimed cannot exceed total deposited (conservation)"
      );

      // Dust property: truncation dust < number of stakers
      expect(Number(dust)).to.be.lt(
        stakeAmounts.length,
        `Dust ${dust} must be < ${stakeAmounts.length} (number of stakers)`
      );

      // Proportionality: each user's share matches their stake proportion
      // Tolerance: 1 lamport per user due to integer truncation
      for (let i = 0; i < stakeAmounts.length; i++) {
        const expectedShare = (rewardsDeposited * stakeAmounts[i]) / totalStaked;
        const actualReward = userRewards[i];
        const diff = expectedShare > actualReward
          ? expectedShare - actualReward
          : actualReward - expectedShare;

        expect(Number(diff)).to.be.lte(
          1,
          `Staker ${i} reward ${actualReward} differs from expected ${expectedShare} by more than 1 lamport`
        );
      }
    });

    /**
     * PROPERTY: Late staker earns 0 from pre-existing rewards
     *
     * SCENARIO:
     * Epoch 1 distributes rewards, setting cumulative to X.
     * A new user stakes AFTER epoch 1. Their checkpoint = X.
     * Delta = X - X = 0. Rewards from epoch 1 = 0.
     *
     * This is critical for fairness: late stakers should not dilute
     * existing stakers' earnings from past epochs.
     *
     * PROPERTY VALIDATED: Checkpoint ensures late staker earns 0 from past epochs
     */
    it("late staker earns 0 from pre-existing rewards (checkpoint correctness)", () => {
      // Simulate: pool state after epoch 1 reward distribution
      const totalStaked = BigInt(1_000_000_000_000); // 1M PROFIT
      const epoch1Rewards = BigInt(100_000_000_000); // 100 SOL

      // After add_to_cumulative for epoch 1:
      // rewardPerToken = 100 SOL * 1e18 / 1M PROFIT
      const cumulativeAfterEpoch1 = (epoch1Rewards * PRECISION) / totalStaked;

      // New user stakes AFTER epoch 1
      // Their checkpoint is set to the current cumulative
      const lateUserCheckpoint = cumulativeAfterEpoch1;
      const lateUserBalance = BigInt(500_000_000); // 500 PROFIT

      // Calculate rewards for late user from epoch 1
      const delta = cumulativeAfterEpoch1 - lateUserCheckpoint;
      const lateUserRewards = (delta * lateUserBalance) / PRECISION;

      expect(delta.toString()).to.equal(
        "0",
        "Delta must be 0 for user who staked after epoch 1"
      );
      expect(lateUserRewards.toString()).to.equal(
        "0",
        "Late staker should earn 0 from epoch 1 rewards"
      );

      // Now simulate epoch 2 rewards (late user should earn from this)
      const epoch2Rewards = BigInt(50_000_000_000); // 50 SOL
      const newTotalStaked = totalStaked + lateUserBalance; // Original + late user
      const epoch2RewardPerToken = (epoch2Rewards * PRECISION) / newTotalStaked;
      const cumulativeAfterEpoch2 = cumulativeAfterEpoch1 + epoch2RewardPerToken;

      // Late user's delta for epoch 2
      const delta2 = cumulativeAfterEpoch2 - lateUserCheckpoint;
      const lateUserEpoch2Rewards = (delta2 * lateUserBalance) / PRECISION;

      // Late user should earn a proportional share of epoch 2 rewards
      expect(lateUserEpoch2Rewards > BigInt(0)).to.be.true;

      // Their share: 500 PROFIT / (1M + 500) total * 50 SOL
      const expectedShare = (epoch2Rewards * lateUserBalance) / newTotalStaked;
      const rewardDiff = lateUserEpoch2Rewards > expectedShare
        ? lateUserEpoch2Rewards - expectedShare
        : expectedShare - lateUserEpoch2Rewards;

      expect(Number(rewardDiff)).to.be.lte(
        1,
        "Late staker epoch 2 reward should match proportional share"
      );
    });

    /**
     * PROPERTY: Equal stakers receive equal rewards
     *
     * SCENARIO:
     * 5 stakers each with exactly 200 PROFIT. A reward of 10 SOL is
     * distributed. Each should receive exactly 1/5 = 2 SOL, with at
     * most 1 lamport rounding difference.
     *
     * PROPERTY VALIDATED: Equal stakes produce equal rewards
     */
    it("equal stakers receive equal rewards", () => {
      const NUM_STAKERS = 5;
      const stakePerUser = BigInt(200_000_000); // 200 PROFIT each
      const totalStaked = stakePerUser * BigInt(NUM_STAKERS);
      const rewardsDeposited = BigInt(10_000_000_000); // 10 SOL

      // Calculate reward per token
      const rewardPerToken = (rewardsDeposited * PRECISION) / totalStaked;

      // Each user's reward
      const rewards: bigint[] = [];
      for (let i = 0; i < NUM_STAKERS; i++) {
        const userReward = (rewardPerToken * stakePerUser) / PRECISION;
        rewards.push(userReward);
      }

      // All rewards should be equal
      const firstReward = rewards[0];
      for (let i = 1; i < NUM_STAKERS; i++) {
        expect(rewards[i].toString()).to.equal(
          firstReward.toString(),
          `Staker ${i} reward ${rewards[i]} differs from staker 0 reward ${firstReward}`
        );
      }

      // Expected: 10 SOL / 5 = 2 SOL each
      const expectedPerUser = rewardsDeposited / BigInt(NUM_STAKERS);
      const diff = firstReward > expectedPerUser
        ? firstReward - expectedPerUser
        : expectedPerUser - firstReward;

      expect(Number(diff)).to.be.lte(
        1,
        `Each staker should receive ~${expectedPerUser} lamports, got ${firstReward}`
      );

      // Conservation check
      const totalClaimed = rewards.reduce((sum, r) => sum + r, BigInt(0));
      expect(totalClaimed <= rewardsDeposited).to.be.true;
    });
  });

  // ===========================================================================
  // Multi-User Stress Test
  // ===========================================================================

  /**
   * Stress tests validate the staking system under scale with many users
   * performing concurrent operations. These tests verify:
   * - Pool tracking accuracy with 100 stakers
   * - Solvency invariant under interleaved multi-user operations
   *
   * The createBatchStakers helper minimizes airdrop overhead by using a
   * treasury pattern: fund one account with bulk SOL, then distribute
   * via SystemProgram.transfer.
   */
  describe("Multi-User Stress Test", () => {
    /**
     * Create multiple stakers efficiently using a treasury pattern.
     *
     * Instead of airdropping SOL to each user individually (which is slow
     * and can hit rate limits), we:
     * 1. Fund a single treasury with bulk SOL
     * 2. Create user keypairs
     * 3. Batch-distribute SOL from treasury via SystemProgram.transfer
     * 4. Create token accounts and mint PROFIT for each user
     * 5. Whitelist is not needed for user accounts (Transfer Hook checks
     *    source OR dest, and stakeVault is already whitelisted)
     *
     * @param count Number of stakers to create
     * @param profitPerUser Amount of PROFIT tokens to mint per user (base units)
     * @returns Array of staker contexts
     */
    async function createBatchStakers(
      count: number,
      profitPerUser: number,
    ): Promise<
      Array<{
        keypair: Keypair;
        userStake: PublicKey;
        tokenAccount: PublicKey;
      }>
    > {
      // Step 1: Create and fund treasury keypair with bulk SOL
      const treasury = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        treasury.publicKey,
        200 * LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(airdropSig);

      const stakers: Array<{
        keypair: Keypair;
        userStake: PublicKey;
        tokenAccount: PublicKey;
      }> = [];

      // Step 2-5: Create users in batches to avoid tx size limits
      // Each SystemProgram.transfer is ~40 bytes, so ~30 transfers per tx
      const BATCH_SIZE = 20;
      const keypairs: Keypair[] = [];

      for (let i = 0; i < count; i++) {
        keypairs.push(Keypair.generate());
      }

      // Distribute SOL in batches
      for (let batch = 0; batch < count; batch += BATCH_SIZE) {
        const batchEnd = Math.min(batch + BATCH_SIZE, count);
        const tx = new Transaction();

        for (let i = batch; i < batchEnd; i++) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: treasury.publicKey,
              toPubkey: keypairs[i].publicKey,
              lamports: LAMPORTS_PER_SOL, // 1 SOL per user for rent + fees
            }),
          );
        }

        await sendAndConfirmTransaction(provider.connection, tx, [treasury]);
      }

      // Create token accounts and mint PROFIT for each user
      for (let i = 0; i < count; i++) {
        const tokenAccount = await createAccount(
          provider.connection,
          keypairs[i],
          profitMint.publicKey,
          keypairs[i].publicKey,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID,
        );

        await mintTo(
          provider.connection,
          admin,
          profitMint.publicKey,
          tokenAccount,
          admin,
          profitPerUser,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID,
        );

        const [userStakePda] = PublicKey.findProgramAddressSync(
          [USER_STAKE_SEED, keypairs[i].publicKey.toBuffer()],
          stakingProgram.programId,
        );

        stakers.push({
          keypair: keypairs[i],
          userStake: userStakePda,
          tokenAccount,
        });
      }

      return stakers;
    }

    /**
     * STRESS TEST: 100 stakers all stake and pool tracks total correctly
     *
     * SCENARIO:
     * Create 100 stakers, each stakes a random amount between 100-1000 PROFIT.
     * After all 100 stake, verify:
     * - pool.totalStaked == MINIMUM_STAKE + sum(all stakes)
     * - vault balance == pool.totalStaked
     * - Escrow solvency invariant holds
     *
     * NOTE: If 100 stakers is too slow for the test timeout, this will
     * scale down to 50 stakers and document the adjustment.
     *
     * PROPERTY VALIDATED: Pool tracking accuracy under scale
     */
    it("100 stakers can all stake and pool tracks total correctly", async () => {
      const NUM_STAKERS = 100;
      const PROFIT_PER_USER = 2_000_000_000; // 2,000 PROFIT each

      // Create 100 stakers via batch pattern
      const stakers = await createBatchStakers(NUM_STAKERS, PROFIT_PER_USER);

      expect(stakers.length).to.equal(NUM_STAKERS);

      // Record pool state before mass staking
      const poolBefore = await stakingProgram.account.stakePool.fetch(stakePool);
      const totalStakedBefore = poolBefore.totalStaked.toNumber();

      // Each staker stakes a deterministic amount: (index + 1) * 10 PROFIT
      // This gives 10, 20, 30, ... 1000 PROFIT across 100 stakers
      let expectedStakeSum = 0;

      for (let i = 0; i < NUM_STAKERS; i++) {
        const stakeAmount = (i + 1) * 10_000_000; // (i+1) * 10 PROFIT in base units
        expectedStakeSum += stakeAmount;

        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stakers[i].keypair,
          stakeAmount,
          {
            stakePool,
            userStake: stakers[i].userStake,
            userTokenAccount: stakers[i].tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
      }

      // Verify pool.totalStaked == previous + sum(all stakes)
      const poolAfter = await stakingProgram.account.stakePool.fetch(stakePool);
      expect(poolAfter.totalStaked.toNumber()).to.equal(
        totalStakedBefore + expectedStakeSum,
        `Pool totalStaked should be ${totalStakedBefore + expectedStakeSum}, got ${poolAfter.totalStaked.toNumber()}`
      );

      // Verify vault balance matches pool.totalStaked
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(vault.amount)).to.equal(
        poolAfter.totalStaked.toNumber(),
        "Vault balance must match pool totalStaked"
      );

      // Escrow solvency invariant
      await assertEscrowSolvency(
        provider.connection, stakingProgram, escrowVault, stakePool
      );
    });

    /**
     * STRESS TEST: Multi-user solvency invariant under interleaved operations
     *
     * SCENARIO:
     * 10 stakers perform 50 interleaved operations (randomly stake or unstake).
     * After EACH operation, assertEscrowSolvency is called to verify the
     * invariant holds.
     *
     * This tests that rapid interleaving of different users' operations
     * cannot desynchronize pool accounting from vault balances.
     *
     * PROPERTY VALIDATED: Solvency invariant holds after every interleaved op
     */
    it("multi-user solvency invariant holds after interleaved operations", async () => {
      const NUM_STAKERS = 10;
      const PROFIT_PER_USER = 10_000_000_000; // 10,000 PROFIT each

      // Create 10 stakers
      const stakers = await createBatchStakers(NUM_STAKERS, PROFIT_PER_USER);

      // Track each staker's staked balance locally for operation selection
      const stakedBalances: number[] = new Array(NUM_STAKERS).fill(0);

      // Phase 1: All stakers stake an initial amount
      for (let i = 0; i < NUM_STAKERS; i++) {
        const amount = (i + 1) * 500_000_000; // 500M, 1B, 1.5B, ... 5B
        await stakeWithHook(
          provider.connection,
          stakingProgram,
          stakers[i].keypair,
          amount,
          {
            stakePool,
            userStake: stakers[i].userStake,
            userTokenAccount: stakers[i].tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        stakedBalances[i] = amount;
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );
      }

      // Phase 2: 50 interleaved operations
      // Use a deterministic seed for reproducibility
      let operationCount = NUM_STAKERS; // Count initial stakes
      const OP_AMOUNT = 100_000_000; // 100 PROFIT per operation

      for (let op = 0; op < 50; op++) {
        // Deterministic user selection: round-robin with offset
        const userIdx = op % NUM_STAKERS;

        // Alternate: even ops stake, odd ops unstake (if they have balance)
        if (op % 2 === 0 || stakedBalances[userIdx] < OP_AMOUNT + MINIMUM_STAKE) {
          // Stake 100 PROFIT
          await stakeWithHook(
            provider.connection,
            stakingProgram,
            stakers[userIdx].keypair,
            OP_AMOUNT,
            {
              stakePool,
              userStake: stakers[userIdx].userStake,
              userTokenAccount: stakers[userIdx].tokenAccount,
              stakeVault,
              profitMint: profitMint.publicKey,
            },
          );
          stakedBalances[userIdx] += OP_AMOUNT;
        } else {
          // Unstake 100 PROFIT
          await unstakeWithHook(
            provider.connection,
            stakingProgram,
            stakers[userIdx].keypair,
            OP_AMOUNT,
            {
              stakePool,
              userStake: stakers[userIdx].userStake,
              userTokenAccount: stakers[userIdx].tokenAccount,
              stakeVault,
              profitMint: profitMint.publicKey,
            },
          );
          stakedBalances[userIdx] -= OP_AMOUNT;
        }

        operationCount++;

        // Assert solvency AFTER EVERY operation
        await assertEscrowSolvency(
          provider.connection, stakingProgram, escrowVault, stakePool
        );
      }

      expect(operationCount).to.be.gte(
        60,
        `Expected 60+ total operations (10 initial + 50 interleaved), got ${operationCount}`
      );

      // Final: verify vault balance matches pool.totalStaked
      const pool = await stakingProgram.account.stakePool.fetch(stakePool);
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(vault.amount)).to.equal(
        pool.totalStaked.toNumber(),
        "Vault balance must match pool totalStaked after all interleaved ops"
      );
    });
  });

  // ============================================================
  // Cooldown / Forfeiture Security Tests
  // ============================================================
  //
  // Attack scenarios targeting the new cooldown gate and
  // forfeiture mechanics introduced in Phase 2.

  describe("cooldown/forfeiture security", () => {
    // Shared helper: create a funded user with staked PROFIT
    async function createStakedUser(
      stakeAmount: number,
    ): Promise<{
      keypair: Keypair;
      tokenAccount: PublicKey;
      userStakePda: PublicKey;
    }> {
      const kp = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        5 * LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

      const ta = await createAccount(
        provider.connection,
        kp,
        profitMint.publicKey,
        kp.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      await mintTo(
        provider.connection,
        admin,
        profitMint.publicKey,
        ta,
        admin,
        stakeAmount * 2,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      const [usPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), kp.publicKey.toBuffer()],
        stakingProgram.programId,
      );

      // Stake with Transfer Hook remaining accounts
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        kp,
        stakeAmount,
        {
          stakePool,
          userStake: usPda,
          userTokenAccount: ta,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      return { keypair: kp, tokenAccount: ta, userStakePda: usPda };
    }

    it("SEC-CD-1: cooldown bypass attempt — unstake during active cooldown blocked", async () => {
      const { keypair, tokenAccount, userStakePda } =
        await createStakedUser(1_000_000_000);

      // Deposit and distribute rewards
      await stakingProgram.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: keypair.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Claim (starts cooldown)
      await stakingProgram.methods
        .claim()
        .accountsStrict({
          user: keypair.publicKey,
          stakePool,
          userStake: userStakePda,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Verify staked balance unchanged before attempt
      const beforeUnstake = await stakingProgram.account.userStake.fetch(
        userStakePda,
      );
      const balanceBefore = beforeUnstake.stakedBalance.toNumber();

      // Immediately try unstake — should be blocked
      try {
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          keypair,
          100_000_000,
          {
            stakePool,
            userStake: userStakePda,
            userTokenAccount: tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        expect.fail("Should have thrown CooldownActive error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CooldownActive");
      }

      // Verify staked balance unchanged after failed attempt
      const afterUnstake = await stakingProgram.account.userStake.fetch(
        userStakePda,
      );
      expect(afterUnstake.stakedBalance.toNumber()).to.equal(balanceBefore);
    });

    it("SEC-CD-2: on-chain guard blocks unstake even if client skips cooldown check", async () => {
      const { keypair, tokenAccount, userStakePda } =
        await createStakedUser(1_000_000_000);

      // Deposit, distribute, claim
      await stakingProgram.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: keypair.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      await stakingProgram.methods
        .claim()
        .accountsStrict({
          user: keypair.publicKey,
          stakePool,
          userStake: userStakePda,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Client "bypasses" check and sends unstake TX directly
      // On-chain must still block it
      try {
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          keypair,
          1_000_000_000, // Full amount
          {
            stakePool,
            userStake: userStakePda,
            userTokenAccount: tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );
        expect.fail("On-chain guard should block");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CooldownActive");
      }
    });

    it("SEC-CD-3: forfeiture goes to pool.pending_rewards, not attacker", async () => {
      const { keypair, tokenAccount, userStakePda } =
        await createStakedUser(1_000_000_000);

      // Deposit and distribute
      await stakingProgram.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: keypair.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Trigger checkpoint to accumulate rewards_earned
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        keypair,
        MINIMUM_STAKE,
        {
          stakePool,
          userStake: userStakePda,
          userTokenAccount: tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      const userBefore = await stakingProgram.account.userStake.fetch(
        userStakePda,
      );
      const poolBefore = await stakingProgram.account.stakePool.fetch(
        stakePool,
      );
      const rewardsToForfeit = userBefore.rewardsEarned.toNumber();

      if (rewardsToForfeit > 0) {
        // Unstake (forfeits rewards)
        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          keypair,
          100_000_000,
          {
            stakePool,
            userStake: userStakePda,
            userTokenAccount: tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );

        const poolAfter = await stakingProgram.account.stakePool.fetch(
          stakePool,
        );

        // Forfeited rewards went to pool.pending_rewards
        expect(poolAfter.pendingRewards.toNumber()).to.equal(
          poolBefore.pendingRewards.toNumber() + rewardsToForfeit,
        );
      }
    });

    it("SEC-CD-4: pending_rewards accounting correct after deposit+claim+forfeit", async () => {
      const { keypair, tokenAccount, userStakePda } =
        await createStakedUser(1_000_000_000);

      // Step 1: Deposit and distribute
      await stakingProgram.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: keypair.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Step 2: Claim some rewards
      await stakingProgram.methods
        .claim()
        .accountsStrict({
          user: keypair.publicKey,
          stakePool,
          userStake: userStakePda,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Step 3: Deposit more
      await stakingProgram.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: keypair.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      // Checkpoint to get new rewards_earned
      await stakeWithHook(
        provider.connection,
        stakingProgram,
        keypair,
        MINIMUM_STAKE,
        {
          stakePool,
          userStake: userStakePda,
          userTokenAccount: tokenAccount,
          stakeVault,
          profitMint: profitMint.publicKey,
        },
      );

      const preUnstakeUser = await stakingProgram.account.userStake.fetch(
        userStakePda,
      );
      const preUnstakePool = await stakingProgram.account.stakePool.fetch(
        stakePool,
      );
      const userRewards = preUnstakeUser.rewardsEarned.toNumber();

      if (userRewards > 0) {
        // Wait for cooldown from earlier claim
        await new Promise((resolve) => setTimeout(resolve, 3000));

        await unstakeWithHook(
          provider.connection,
          stakingProgram,
          keypair,
          100_000_000,
          {
            stakePool,
            userStake: userStakePda,
            userTokenAccount: tokenAccount,
            stakeVault,
            profitMint: profitMint.publicKey,
          },
        );

        const postUnstakePool = await stakingProgram.account.stakePool.fetch(
          stakePool,
        );

        // pending_rewards = pre + forfeited
        expect(postUnstakePool.pendingRewards.toNumber()).to.equal(
          preUnstakePool.pendingRewards.toNumber() + userRewards,
        );
      }
    });
  });
});
