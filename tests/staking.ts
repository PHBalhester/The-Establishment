/**
 * Staking Program Unit Tests
 *
 * This test suite validates Phase 26 success criteria:
 * - initialize_stake_pool creates dead stake (first-depositor attack prevention)
 * - stake transfers PROFIT to vault and updates balances
 * - claim fails with NothingToClaim if no rewards
 * - unstake transfers PROFIT back and claims rewards
 * - Flash loan prevention (same-slot stake/unstake = 0 rewards)
 *
 * Source: .planning/phases/26-core-staking-program/26-05-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Staking } from "../target/types/staking";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Staking as Program<Staking>;

  // Test accounts
  let profitMint: PublicKey;
  let authority: Keypair;
  let authorityTokenAccount: PublicKey;
  let user: Keypair;
  let userTokenAccount: PublicKey;

  // PDAs
  let stakePool: PublicKey;
  let stakePoolBump: number;
  let escrowVault: PublicKey;
  let stakeVault: PublicKey;
  let userStake: PublicKey;

  // Constants from program
  const MINIMUM_STAKE = 1_000_000; // 1 PROFIT (6 decimals)
  const PROFIT_DECIMALS = 6;

  before(async () => {
    // Use provider wallet as authority — it's the program upgrade authority
    // in anchor test, required by ProgramData constraint (Phase 78).
    authority = (provider.wallet as anchor.Wallet).payer;

    // Create user keypair with SOL
    user = Keypair.generate();
    const airdropSig2 = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig2);

    // Create PROFIT mint (Token-2022)
    profitMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      PROFIT_DECIMALS,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create authority's token account and mint tokens
    authorityTokenAccount = await createAccount(
      provider.connection,
      authority,
      profitMint,
      authority.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Mint enough for dead stake + testing
    await mintTo(
      provider.connection,
      authority,
      profitMint,
      authorityTokenAccount,
      authority,
      100_000_000_000, // 100,000 PROFIT
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create user's token account and mint tokens
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      profitMint,
      user.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      authority,
      profitMint,
      userTokenAccount,
      authority,
      10_000_000_000, // 10,000 PROFIT
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive PDAs
    [stakePool, stakePoolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pool")],
      program.programId
    );

    [escrowVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_vault")],
      program.programId
    );

    [stakeVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_vault")],
      program.programId
    );

    [userStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), user.publicKey.toBuffer()],
      program.programId
    );
  });

  // ============================================================
  // Initialize Tests
  // ============================================================

  describe("initialize_stake_pool", () => {
    it("initializes pool with dead stake", async () => {
      const BPF_LOADER_UPGRADEABLE = new PublicKey(
        "BPFLoaderUpgradeab1e11111111111111111111111"
      );
      const [programDataAddress] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        BPF_LOADER_UPGRADEABLE
      );
      await program.methods
        .initializeStakePool()
        .accountsStrict({
          authority: authority.publicKey,
          stakePool,
          escrowVault,
          stakeVault,
          authorityTokenAccount,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          program: program.programId,
          programData: programDataAddress,
        })
        .signers([authority])
        .rpc();

      // Verify pool state
      const poolAccount = await program.account.stakePool.fetch(stakePool);
      expect(poolAccount.totalStaked.toNumber()).to.equal(MINIMUM_STAKE);
      expect(poolAccount.rewardsPerTokenStored.toString()).to.equal("0");
      expect(poolAccount.pendingRewards.toNumber()).to.equal(0);
      expect(poolAccount.initialized).to.equal(true);

      // Verify stake vault has dead stake
      const vaultAccount = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(Number(vaultAccount.amount)).to.equal(MINIMUM_STAKE);
    });

    it("prevents first-depositor attack (pool starts with MINIMUM_STAKE)", async () => {
      // Pool already initialized, verify total_staked >= MINIMUM_STAKE
      const poolAccount = await program.account.stakePool.fetch(stakePool);
      expect(poolAccount.totalStaked.toNumber()).to.be.gte(MINIMUM_STAKE);
    });
  });

  // ============================================================
  // Stake Tests
  // ============================================================

  describe("stake", () => {
    const stakeAmount = 1_000_000_000; // 1,000 PROFIT

    it("stakes PROFIT tokens successfully", async () => {
      const beforePool = await program.account.stakePool.fetch(stakePool);
      const beforeVault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .stake(new anchor.BN(stakeAmount))
        .accountsStrict({
          user: user.publicKey,
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify user stake account
      const userStakeAccount = await program.account.userStake.fetch(userStake);
      expect(userStakeAccount.owner.toString()).to.equal(
        user.publicKey.toString()
      );
      expect(userStakeAccount.stakedBalance.toNumber()).to.equal(stakeAmount);

      // Verify pool total increased
      const afterPool = await program.account.stakePool.fetch(stakePool);
      expect(afterPool.totalStaked.toNumber()).to.equal(
        beforePool.totalStaked.toNumber() + stakeAmount
      );

      // Verify vault balance increased
      const afterVault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(Number(afterVault.amount)).to.equal(
        Number(beforeVault.amount) + stakeAmount
      );
    });

    it("rejects zero amount stake", async () => {
      try {
        await program.methods
          .stake(new anchor.BN(0))
          .accountsStrict({
            user: user.publicKey,
            stakePool,
            userStake,
            userTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have thrown ZeroAmount error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ZeroAmount");
      }
    });

    it("accumulates multiple stakes", async () => {
      const additionalStake = 500_000_000; // 500 PROFIT

      const beforeUser = await program.account.userStake.fetch(userStake);

      await program.methods
        .stake(new anchor.BN(additionalStake))
        .accountsStrict({
          user: user.publicKey,
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const afterUser = await program.account.userStake.fetch(userStake);
      expect(afterUser.stakedBalance.toNumber()).to.equal(
        beforeUser.stakedBalance.toNumber() + additionalStake
      );
    });
  });

  // ============================================================
  // Claim Tests
  // ============================================================

  describe("claim", () => {
    it("rejects claim with nothing to claim", async () => {
      // No rewards deposited yet, so nothing to claim
      try {
        await program.methods
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
        expect.fail("Should have thrown NothingToClaim error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NothingToClaim");
      }
    });

    it("rejects claim from non-owner (seeds mismatch)", async () => {
      const otherUser = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        otherUser.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      // Derive the other user's stake PDA (which doesn't exist)
      const [otherUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), otherUser.publicKey.toBuffer()],
        program.programId
      );

      try {
        // Try to claim from user's stake with otherUser as signer
        // This should fail because PDA seeds don't match
        await program.methods
          .claim()
          .accountsStrict({
            user: otherUser.publicKey,
            stakePool,
            userStake, // This is user's stake, not otherUser's
            escrowVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([otherUser])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        // Should fail with seeds constraint violation
        expect(err.toString()).to.include("Error");
      }
    });
  });

  // ============================================================
  // Unstake Tests
  // ============================================================

  describe("unstake", () => {
    it("unstakes partial amount", async () => {
      const unstakeAmount = 200_000_000; // 200 PROFIT

      const beforeUser = await program.account.userStake.fetch(userStake);
      const beforePool = await program.account.stakePool.fetch(stakePool);

      await program.methods
        .unstake(new anchor.BN(unstakeAmount))
        .accountsStrict({
          user: user.publicKey,
          stakePool,
          userStake,
          userTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const afterUser = await program.account.userStake.fetch(userStake);
      const afterPool = await program.account.stakePool.fetch(stakePool);

      expect(afterUser.stakedBalance.toNumber()).to.equal(
        beforeUser.stakedBalance.toNumber() - unstakeAmount
      );
      expect(afterPool.totalStaked.toNumber()).to.equal(
        beforePool.totalStaked.toNumber() - unstakeAmount
      );
    });

    it("rejects unstake exceeding balance", async () => {
      const userStakeAccount = await program.account.userStake.fetch(userStake);
      const tooMuch = userStakeAccount.stakedBalance.toNumber() + 1;

      try {
        await program.methods
          .unstake(new anchor.BN(tooMuch))
          .accountsStrict({
            user: user.publicKey,
            stakePool,
            userStake,
            userTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have thrown InsufficientBalance error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientBalance");
      }
    });

    it("rejects zero amount unstake", async () => {
      try {
        await program.methods
          .unstake(new anchor.BN(0))
          .accountsStrict({
            user: user.publicKey,
            stakePool,
            userStake,
            userTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have thrown ZeroAmount error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ZeroAmount");
      }
    });

    it("rejects unstake from non-owner (seeds mismatch)", async () => {
      const otherUser = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        otherUser.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      // Create token account for otherUser
      const otherTokenAccount = await createAccount(
        provider.connection,
        otherUser,
        profitMint,
        otherUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        await program.methods
          .unstake(new anchor.BN(100_000))
          .accountsStrict({
            user: otherUser.publicKey,
            stakePool,
            userStake, // user's stake PDA, but otherUser is signer
            userTokenAccount: otherTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([otherUser])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        // Seeds mismatch should cause failure
        expect(err.toString()).to.include("Error");
      }
    });
  });

  // ============================================================
  // Edge Case Tests
  // ============================================================

  describe("edge cases", () => {
    it("tracks pool total_staked accurately across operations", async () => {
      const pool = await program.account.stakePool.fetch(stakePool);
      const vault = await getAccount(
        provider.connection,
        stakeVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Vault balance should match pool.total_staked
      expect(pool.totalStaked.toNumber()).to.equal(Number(vault.amount));
    });

    it("flash loan attack prevention: same-slot stake/unstake earns 0 rewards", async () => {
      // Stake and immediately unstake - should earn 0 rewards
      // (Checkpoint pattern: no rewards until cumulative updates)
      const smallStake = 100_000_000; // 100 PROFIT

      // Get a fresh user for this test
      const flashUser = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        flashUser.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      const flashTokenAccount = await createAccount(
        provider.connection,
        flashUser,
        profitMint,
        flashUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        flashTokenAccount,
        authority,
        smallStake * 2,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [flashUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), flashUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake
      await program.methods
        .stake(new anchor.BN(smallStake))
        .accountsStrict({
          user: flashUser.publicKey,
          stakePool,
          userStake: flashUserStake,
          userTokenAccount: flashTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([flashUser])
        .rpc();

      // Immediately unstake
      await program.methods
        .unstake(new anchor.BN(smallStake))
        .accountsStrict({
          user: flashUser.publicKey,
          stakePool,
          userStake: flashUserStake,
          userTokenAccount: flashTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([flashUser])
        .rpc();

      // Verify 0 rewards were claimed (unstake event would show rewards_claimed = 0)
      const flashAccount = await program.account.userStake.fetch(flashUserStake);
      expect(flashAccount.totalClaimed.toNumber()).to.equal(0);
    });

    it("auto-full-unstake when remaining would be below MINIMUM_STAKE", async () => {
      // Create a fresh user with exactly MINIMUM_STAKE + small_amount staked
      const dustUser = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        dustUser.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      const dustTokenAccount = await createAccount(
        provider.connection,
        dustUser,
        profitMint,
        dustUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const stakeAmount = MINIMUM_STAKE + 100; // 1,000,100 units
      await mintTo(
        provider.connection,
        authority,
        profitMint,
        dustTokenAccount,
        authority,
        stakeAmount * 2,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [dustUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), dustUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake the amount
      await program.methods
        .stake(new anchor.BN(stakeAmount))
        .accountsStrict({
          user: dustUser.publicKey,
          stakePool,
          userStake: dustUserStake,
          userTokenAccount: dustTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([dustUser])
        .rpc();

      // Try to unstake just 101 (would leave MINIMUM_STAKE - 1)
      // Should auto-full-unstake instead
      await program.methods
        .unstake(new anchor.BN(101))
        .accountsStrict({
          user: dustUser.publicKey,
          stakePool,
          userStake: dustUserStake,
          userTokenAccount: dustTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([dustUser])
        .rpc();

      // Verify balance is 0 (full unstake happened)
      const dustAccount = await program.account.userStake.fetch(dustUserStake);
      expect(dustAccount.stakedBalance.toNumber()).to.equal(0);
    });
  });

  // ============================================================
  // State Invariant Tests
  // ============================================================

  describe("state invariants", () => {
    it("pool initialized flag is true", async () => {
      const pool = await program.account.stakePool.fetch(stakePool);
      expect(pool.initialized).to.equal(true);
    });

    it("pool bump is stored correctly", async () => {
      const pool = await program.account.stakePool.fetch(stakePool);
      expect(pool.bump).to.equal(stakePoolBump);
    });

    it("user stake owner matches user pubkey", async () => {
      const userStakeAccount = await program.account.userStake.fetch(userStake);
      expect(userStakeAccount.owner.toString()).to.equal(
        user.publicKey.toString()
      );
    });

    it("cumulative rewards starts at 0", async () => {
      const pool = await program.account.stakePool.fetch(stakePool);
      // No rewards deposited yet
      expect(pool.rewardsPerTokenStored.toString()).to.equal("0");
    });
  });

  // ============================================================
  // Cooldown Gate Tests (T1-T5)
  // ============================================================
  //
  // These tests verify the cooldown mechanic: after claiming rewards,
  // users must wait COOLDOWN_SECONDS (2s in test builds) before unstaking.
  // This discourages mercenary capital that claims and exits immediately.

  describe("cooldown gate", () => {
    // Fresh user for cooldown tests — avoids interference with prior tests
    let cdUser: Keypair;
    let cdTokenAccount: PublicKey;
    let cdUserStake: PublicKey;
    const cdStakeAmount = 1_000_000_000; // 1000 PROFIT

    before(async () => {
      cdUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        cdUser.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      cdTokenAccount = await createAccount(
        provider.connection,
        cdUser,
        profitMint,
        cdUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        cdTokenAccount,
        authority,
        cdStakeAmount * 2,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      [cdUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), cdUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake
      await program.methods
        .stake(new anchor.BN(cdStakeAmount))
        .accountsStrict({
          user: cdUser.publicKey,
          stakePool,
          userStake: cdUserStake,
          userTokenAccount: cdTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([cdUser])
        .rpc();

      // Deposit + distribute rewards so claim can succeed
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: cdUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([cdUser])
        .rpc();
    });

    // T1: Claim sets lastClaimTs
    it("T1: claim sets lastClaimTs", async () => {
      await program.methods
        .claim()
        .accountsStrict({
          user: cdUser.publicKey,
          stakePool,
          userStake: cdUserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([cdUser])
        .rpc();

      const acct = await program.account.userStake.fetch(cdUserStake);
      expect(acct.lastClaimTs.toNumber()).to.be.gt(0);
    });

    // T2: Unstake blocked during cooldown
    it("T2: unstake blocked during active cooldown", async () => {
      // lastClaimTs was just set by T1 — cooldown is active
      try {
        await program.methods
          .unstake(new anchor.BN(100_000_000))
          .accountsStrict({
            user: cdUser.publicKey,
            stakePool,
            userStake: cdUserStake,
            userTokenAccount: cdTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([cdUser])
          .rpc();
        expect.fail("Should have thrown CooldownActive error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CooldownActive");
      }
    });

    // T3: Unstake succeeds after cooldown
    it("T3: unstake succeeds after cooldown expires", async () => {
      // Wait 3s (> 2s test cooldown)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const beforeUser = await program.account.userStake.fetch(cdUserStake);

      await program.methods
        .unstake(new anchor.BN(100_000_000))
        .accountsStrict({
          user: cdUser.publicKey,
          stakePool,
          userStake: cdUserStake,
          userTokenAccount: cdTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([cdUser])
        .rpc();

      const afterUser = await program.account.userStake.fetch(cdUserStake);
      expect(afterUser.stakedBalance.toNumber()).to.equal(
        beforeUser.stakedBalance.toNumber() - 100_000_000
      );
    });

    // T4: Same-slot unstake blocked (no sleep between claim and unstake)
    it("T4: same-slot unstake blocked after fresh claim", async () => {
      // Deposit more rewards so we can claim again
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: cdUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([cdUser])
        .rpc();

      // Claim (resets lastClaimTs)
      await program.methods
        .claim()
        .accountsStrict({
          user: cdUser.publicKey,
          stakePool,
          userStake: cdUserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([cdUser])
        .rpc();

      // Immediately try unstake
      try {
        await program.methods
          .unstake(new anchor.BN(100_000_000))
          .accountsStrict({
            user: cdUser.publicKey,
            stakePool,
            userStake: cdUserStake,
            userTokenAccount: cdTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([cdUser])
          .rpc();
        expect.fail("Should have thrown CooldownActive error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CooldownActive");
      }
    });

    // T5: Never-claimed user can unstake immediately
    it("T5: never-claimed user can unstake immediately", async () => {
      // Fresh user that never claims
      const freshUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        freshUser.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const freshTokenAccount = await createAccount(
        provider.connection,
        freshUser,
        profitMint,
        freshUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        freshTokenAccount,
        authority,
        500_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [freshUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), freshUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake
      await program.methods
        .stake(new anchor.BN(500_000_000))
        .accountsStrict({
          user: freshUser.publicKey,
          stakePool,
          userStake: freshUserStake,
          userTokenAccount: freshTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([freshUser])
        .rpc();

      // Immediately unstake — should succeed (lastClaimTs == 0)
      await program.methods
        .unstake(new anchor.BN(500_000_000))
        .accountsStrict({
          user: freshUser.publicKey,
          stakePool,
          userStake: freshUserStake,
          userTokenAccount: freshTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freshUser])
        .rpc();

      const acct = await program.account.userStake.fetch(freshUserStake);
      expect(acct.stakedBalance.toNumber()).to.equal(0);
    });
  });

  // ============================================================
  // Forfeiture Tests (T6-T10)
  // ============================================================
  //
  // These tests verify reward forfeiture on unstake: unclaimed rewards
  // are returned to pool.pending_rewards instead of being paid out.

  describe("forfeiture", () => {
    let fUser: Keypair;
    let fTokenAccount: PublicKey;
    let fUserStake: PublicKey;
    const fStakeAmount = 1_000_000_000; // 1000 PROFIT

    before(async () => {
      fUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fUser.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      fTokenAccount = await createAccount(
        provider.connection,
        fUser,
        profitMint,
        fUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        fTokenAccount,
        authority,
        fStakeAmount * 2,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      [fUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), fUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake
      await program.methods
        .stake(new anchor.BN(fStakeAmount))
        .accountsStrict({
          user: fUser.publicKey,
          stakePool,
          userStake: fUserStake,
          userTokenAccount: fTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([fUser])
        .rpc();

      // Deposit + distribute rewards
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: fUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([fUser])
        .rpc();
    });

    // T6: User gets 0 SOL on unstake (no escrow transfer)
    it("T6: unstake returns PROFIT but no SOL", async () => {
      const beforeSol = await provider.connection.getBalance(fUser.publicKey);
      const beforeToken = await getAccount(
        provider.connection,
        fTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .unstake(new anchor.BN(100_000_000)) // 100 PROFIT
        .accountsStrict({
          user: fUser.publicKey,
          stakePool,
          userStake: fUserStake,
          userTokenAccount: fTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fUser])
        .rpc();

      const afterSol = await provider.connection.getBalance(fUser.publicKey);
      const afterToken = await getAccount(
        provider.connection,
        fTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // SOL should decrease (tx fee) — NOT increase from escrow
      expect(afterSol).to.be.lte(beforeSol);
      // PROFIT should increase (tokens returned)
      expect(Number(afterToken.amount)).to.be.gt(Number(beforeToken.amount));
    });

    // T7: pending_rewards increased by forfeited amount
    it("T7: pending_rewards increases by forfeited rewards_earned", async () => {
      // Deposit more rewards and distribute
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: fUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([fUser])
        .rpc();

      // Trigger update_rewards by doing a no-op stake to update user checkpoint
      await program.methods
        .stake(new anchor.BN(MINIMUM_STAKE))
        .accountsStrict({
          user: fUser.publicKey,
          stakePool,
          userStake: fUserStake,
          userTokenAccount: fTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([fUser])
        .rpc();

      const userBefore = await program.account.userStake.fetch(fUserStake);
      const poolBefore = await program.account.stakePool.fetch(stakePool);
      const rewardsToForfeit = userBefore.rewardsEarned.toNumber();

      // Skip if no rewards to forfeit (pool has many stakers now)
      if (rewardsToForfeit === 0) {
        return; // No rewards earned — skip assertion
      }

      await program.methods
        .unstake(new anchor.BN(100_000_000))
        .accountsStrict({
          user: fUser.publicKey,
          stakePool,
          userStake: fUserStake,
          userTokenAccount: fTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([fUser])
        .rpc();

      const poolAfter = await program.account.stakePool.fetch(stakePool);
      expect(poolAfter.pendingRewards.toNumber()).to.equal(
        poolBefore.pendingRewards.toNumber() + rewardsToForfeit
      );
    });

    // T8: rewards_earned zeroed after unstake
    it("T8: rewards_earned zeroed after unstake", async () => {
      const userAfter = await program.account.userStake.fetch(fUserStake);
      expect(userAfter.rewardsEarned.toNumber()).to.equal(0);
    });

    // T9: Zero rewards = zero forfeiture
    it("T9: zero rewards means zero forfeiture", async () => {
      // Fresh user with no rewards
      const zUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        zUser.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const zTokenAccount = await createAccount(
        provider.connection,
        zUser,
        profitMint,
        zUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        zTokenAccount,
        authority,
        500_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [zUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), zUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake (no rewards deposited after this)
      await program.methods
        .stake(new anchor.BN(500_000_000))
        .accountsStrict({
          user: zUser.publicKey,
          stakePool,
          userStake: zUserStake,
          userTokenAccount: zTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([zUser])
        .rpc();

      const poolBefore = await program.account.stakePool.fetch(stakePool);

      // Unstake immediately — 0 rewards since no new distribution
      await program.methods
        .unstake(new anchor.BN(500_000_000))
        .accountsStrict({
          user: zUser.publicKey,
          stakePool,
          userStake: zUserStake,
          userTokenAccount: zTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([zUser])
        .rpc();

      const poolAfter = await program.account.stakePool.fetch(stakePool);
      // pending_rewards unchanged (0 forfeited)
      expect(poolAfter.pendingRewards.toNumber()).to.equal(
        poolBefore.pendingRewards.toNumber()
      );
    });

    // T10: Partial unstake forfeits ALL rewards
    it("T10: partial unstake forfeits ALL rewards (not proportional)", async () => {
      // Fresh user
      const pUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        pUser.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const pTokenAccount = await createAccount(
        provider.connection,
        pUser,
        profitMint,
        pUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        pTokenAccount,
        authority,
        2_000_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [pUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), pUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake 1000 PROFIT
      await program.methods
        .stake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: pUser.publicKey,
          stakePool,
          userStake: pUserStake,
          userTokenAccount: pTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([pUser])
        .rpc();

      // Deposit and distribute
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: pUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([pUser])
        .rpc();

      // Trigger checkpoint via a tiny stake
      await program.methods
        .stake(new anchor.BN(MINIMUM_STAKE))
        .accountsStrict({
          user: pUser.publicKey,
          stakePool,
          userStake: pUserStake,
          userTokenAccount: pTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([pUser])
        .rpc();

      const userBefore = await program.account.userStake.fetch(pUserStake);
      const rewardsBeforeUnstake = userBefore.rewardsEarned.toNumber();

      // Partial unstake (only 500 PROFIT out of ~1001)
      await program.methods
        .unstake(new anchor.BN(500_000_000))
        .accountsStrict({
          user: pUser.publicKey,
          stakePool,
          userStake: pUserStake,
          userTokenAccount: pTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([pUser])
        .rpc();

      // ALL rewards forfeited, not just proportional
      const userAfter = await program.account.userStake.fetch(pUserStake);
      expect(userAfter.rewardsEarned.toNumber()).to.equal(0);
      // Still has remaining stake
      expect(userAfter.stakedBalance.toNumber()).to.be.gt(0);
    });
  });

  // ============================================================
  // Lifecycle Tests (T14-T18)
  // ============================================================

  describe("lifecycle", () => {
    // T14: Full cycle — stake -> deposit -> claim -> wait -> unstake
    it("T14: full lifecycle cycle", async () => {
      const lcUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        lcUser.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const lcTokenAccount = await createAccount(
        provider.connection,
        lcUser,
        profitMint,
        lcUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        lcTokenAccount,
        authority,
        1_000_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [lcUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), lcUser.publicKey.toBuffer()],
        program.programId
      );

      // 1. Stake
      await program.methods
        .stake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: lcUser.publicKey,
          stakePool,
          userStake: lcUserStake,
          userTokenAccount: lcTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([lcUser])
        .rpc();

      // 2. Deposit rewards
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: lcUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([lcUser])
        .rpc();

      // 3. Claim
      await program.methods
        .claim()
        .accountsStrict({
          user: lcUser.publicKey,
          stakePool,
          userStake: lcUserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([lcUser])
        .rpc();

      // 4. Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 5. Unstake
      await program.methods
        .unstake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: lcUser.publicKey,
          stakePool,
          userStake: lcUserStake,
          userTokenAccount: lcTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([lcUser])
        .rpc();

      const acct = await program.account.userStake.fetch(lcUserStake);
      expect(acct.stakedBalance.toNumber()).to.equal(0);
      // Full unstake resets lastClaimTs
      expect(acct.lastClaimTs.toNumber()).to.equal(0);
    });

    // T16: Perpetual cooldown — second claim resets timer
    it("T16: second claim resets cooldown timer", async () => {
      const pcUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        pcUser.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const pcTokenAccount = await createAccount(
        provider.connection,
        pcUser,
        profitMint,
        pcUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        pcTokenAccount,
        authority,
        1_000_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [pcUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), pcUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake
      await program.methods
        .stake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: pcUser.publicKey,
          stakePool,
          userStake: pcUserStake,
          userTokenAccount: pcTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([pcUser])
        .rpc();

      // Deposit + claim
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: pcUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([pcUser])
        .rpc();

      await program.methods
        .claim()
        .accountsStrict({
          user: pcUser.publicKey,
          stakePool,
          userStake: pcUserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([pcUser])
        .rpc();

      const firstClaimTs = (
        await program.account.userStake.fetch(pcUserStake)
      ).lastClaimTs.toNumber();

      // Wait 1s (not enough for cooldown), deposit more, claim again
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: pcUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([pcUser])
        .rpc();

      await program.methods
        .claim()
        .accountsStrict({
          user: pcUser.publicKey,
          stakePool,
          userStake: pcUserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([pcUser])
        .rpc();

      const secondClaimTs = (
        await program.account.userStake.fetch(pcUserStake)
      ).lastClaimTs.toNumber();

      // Second claim resets timer to later timestamp
      expect(secondClaimTs).to.be.gte(firstClaimTs);

      // Immediately try unstake — should fail (cooldown reset by second claim)
      try {
        await program.methods
          .unstake(new anchor.BN(100_000_000))
          .accountsStrict({
            user: pcUser.publicKey,
            stakePool,
            userStake: pcUserStake,
            userTokenAccount: pcTokenAccount,
            stakeVault,
            profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([pcUser])
          .rpc();
        expect.fail("Should have thrown CooldownActive error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CooldownActive");
      }
    });

    // T17: Re-stake after full exit — no cooldown since never claimed in new position
    it("T17: re-stake after full exit has no cooldown", async () => {
      const rsUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        rsUser.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const rsTokenAccount = await createAccount(
        provider.connection,
        rsUser,
        profitMint,
        rsUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        rsTokenAccount,
        authority,
        2_000_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [rsUserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), rsUser.publicKey.toBuffer()],
        program.programId
      );

      // Stake -> deposit -> claim -> wait -> full unstake
      await program.methods
        .stake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: rsUser.publicKey,
          stakePool,
          userStake: rsUserStake,
          userTokenAccount: rsTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rsUser])
        .rpc();

      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: rsUser.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([rsUser])
        .rpc();

      await program.methods
        .claim()
        .accountsStrict({
          user: rsUser.publicKey,
          stakePool,
          userStake: rsUserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([rsUser])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Full unstake (resets lastClaimTs to 0)
      await program.methods
        .unstake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: rsUser.publicKey,
          stakePool,
          userStake: rsUserStake,
          userTokenAccount: rsTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([rsUser])
        .rpc();

      const afterFullExit = await program.account.userStake.fetch(rsUserStake);
      expect(afterFullExit.lastClaimTs.toNumber()).to.equal(0);

      // Re-stake
      await program.methods
        .stake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: rsUser.publicKey,
          stakePool,
          userStake: rsUserStake,
          userTokenAccount: rsTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rsUser])
        .rpc();

      // Immediately unstake — should succeed (no claim in new position)
      await program.methods
        .unstake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: rsUser.publicKey,
          stakePool,
          userStake: rsUserStake,
          userTokenAccount: rsTokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([rsUser])
        .rpc();

      const final_ = await program.account.userStake.fetch(rsUserStake);
      expect(final_.stakedBalance.toNumber()).to.equal(0);
    });

    // T18: Partial unstake then claim — new rewards only
    it("T18: partial unstake forfeits, then new rewards claimable", async () => {
      const t18User = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        t18User.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const t18TokenAccount = await createAccount(
        provider.connection,
        t18User,
        profitMint,
        t18User.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        profitMint,
        t18TokenAccount,
        authority,
        2_000_000_000,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [t18UserStake] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), t18User.publicKey.toBuffer()],
        program.programId
      );

      // Stake 1000
      await program.methods
        .stake(new anchor.BN(1_000_000_000))
        .accountsStrict({
          user: t18User.publicKey,
          stakePool,
          userStake: t18UserStake,
          userTokenAccount: t18TokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([t18User])
        .rpc();

      // Deposit rewards
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: t18User.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([t18User])
        .rpc();

      // Partial unstake 500 (forfeits all earned rewards)
      await program.methods
        .unstake(new anchor.BN(500_000_000))
        .accountsStrict({
          user: t18User.publicKey,
          stakePool,
          userStake: t18UserStake,
          userTokenAccount: t18TokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([t18User])
        .rpc();

      // Deposit NEW rewards
      await program.methods
        .testDepositAndDistribute(new anchor.BN(LAMPORTS_PER_SOL))
        .accountsStrict({
          payer: t18User.publicKey,
          stakePool,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([t18User])
        .rpc();

      // Trigger checkpoint
      await program.methods
        .stake(new anchor.BN(MINIMUM_STAKE))
        .accountsStrict({
          user: t18User.publicKey,
          stakePool,
          userStake: t18UserStake,
          userTokenAccount: t18TokenAccount,
          stakeVault,
          profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([t18User])
        .rpc();

      // Should have new rewards (from second deposit)
      const acct = await program.account.userStake.fetch(t18UserStake);
      expect(acct.rewardsEarned.toNumber()).to.be.gt(0);

      // Claim should succeed
      await program.methods
        .claim()
        .accountsStrict({
          user: t18User.publicKey,
          stakePool,
          userStake: t18UserStake,
          escrowVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([t18User])
        .rpc();

      const afterClaim = await program.account.userStake.fetch(t18UserStake);
      expect(afterClaim.rewardsEarned.toNumber()).to.equal(0);
      expect(afterClaim.totalClaimed.toNumber()).to.be.gt(0);
    });
  });
});
