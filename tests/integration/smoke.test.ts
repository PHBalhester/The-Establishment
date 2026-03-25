/**
 * Integration Smoke Tests
 *
 * Proves both major CPI paths work in the shared multi-program validator:
 * 1. SOL Buy Swap: Tax -> AMM -> Token-2022 -> Transfer Hook CPI chain
 * 2. Stake PROFIT: Staking Program CPI with Transfer Hook remaining_accounts
 *
 * These tests validate post-transaction state (token balances, account existence)
 * not just transaction success. They prove the entire integration test
 * infrastructure works end-to-end: all 5 programs load, initialize together,
 * and handle real transactions through the full CPI chains.
 *
 * Satisfies INTEG-01: All 5 programs load into single local validator and
 * pass basic smoke test.
 *
 * Source: .planning/phases/31-integration-test-infrastructure/31-03-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAccount,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";

// Anchor IDL types
import { Amm } from "../../target/types/amm";
import { TransferHook } from "../../target/types/transfer_hook";
import { TaxProgram } from "../../target/types/tax_program";
import { EpochProgram } from "../../target/types/epoch_program";
import { Staking } from "../../target/types/staking";
import { ConversionVault } from "../../target/types/conversion_vault";

// Local helpers
import {
  TOKEN_DECIMALS,
  SWAP_AUTHORITY_SEED,
  TAX_AUTHORITY_SEED,
  STAKE_POOL_SEED,
  ESCROW_VAULT_SEED,
  USER_STAKE_SEED,
  EXTRA_ACCOUNT_META_SEED,
  deriveWhitelistEntryPDA,
  deriveVaultPDAs,
} from "./helpers/constants";

import {
  initializeProtocol,
  ProtocolState,
  Programs,
} from "./helpers/protocol-init";

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

/**
 * Resolve Transfer Hook remaining_accounts for a Token-2022 transfer.
 *
 * Uses createTransferCheckedWithTransferHookInstruction to resolve the
 * ExtraAccountMetas, then extracts the remaining accounts (everything after
 * the first 4 keys: source, mint, dest, authority).
 *
 * @param connection - Solana connection
 * @param source - Source token account
 * @param mint - Token mint
 * @param dest - Destination token account
 * @param authority - Transfer authority
 * @param amount - Transfer amount
 * @returns Array of remaining account metas for the hook
 */
async function resolveHookAccounts(
  connection: anchor.web3.Connection,
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  amount: bigint
): Promise<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]> {
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    source,
    mint,
    dest,
    authority,
    amount,
    TOKEN_DECIMALS,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  // Extract remaining accounts (skip first 4: source, mint, dest, authority)
  // These are the hook-resolved accounts that Token-2022 needs for the hook call
  return transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Integration Smoke Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  // Load all 5 programs from workspace
  const ammProgram = anchor.workspace.Amm as Program<Amm>;
  const hookProgram = anchor.workspace
    .TransferHook as Program<TransferHook>;
  const taxProgram = anchor.workspace.TaxProgram as Program<TaxProgram>;
  const epochProgram = anchor.workspace
    .EpochProgram as Program<EpochProgram>;
  const stakingProgram = anchor.workspace.Staking as Program<Staking>;
  const vaultProgram = anchor.workspace
    .ConversionVault as Program<ConversionVault>;

  let protocol: ProtocolState;

  before(async () => {
    console.log("Loading programs from workspace...");
    console.log(`  AMM:           ${ammProgram.programId.toBase58()}`);
    console.log(`  TransferHook:  ${hookProgram.programId.toBase58()}`);
    console.log(`  TaxProgram:    ${taxProgram.programId.toBase58()}`);
    console.log(`  EpochProgram:  ${epochProgram.programId.toBase58()}`);
    console.log(`  Staking:       ${stakingProgram.programId.toBase58()}`);

    // Initialize the full protocol (17-step sequence across all 5 programs)
    protocol = await initializeProtocol(provider, {
      amm: ammProgram,
      transferHook: hookProgram,
      taxProgram: taxProgram,
      epochProgram: epochProgram,
      staking: stakingProgram,
      vault: vaultProgram,
    });
    console.log("\nProtocol initialized successfully -- ready for smoke tests");
  });

  // ===========================================================================
  // Test 1: SOL Buy Swap (Tax -> AMM -> Token-2022 -> Transfer Hook)
  // ===========================================================================

  it("SOL buy swap through full CPI chain", async () => {
    const trader = protocol.wallets.trader;

    // -----------------------------------------------------------------------
    // Step 1: Determine canonical ordering for CRIME/SOL pool
    // -----------------------------------------------------------------------
    const [mintA, mintB] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
    const wsolIsMintA = mintA.equals(NATIVE_MINT);
    console.log(
      `  WSOL is mint${wsolIsMintA ? "A" : "B"}: ${mintA.toBase58()}`
    );
    console.log(
      `  CRIME is mint${wsolIsMintA ? "B" : "A"}: ${mintB.toBase58()}`
    );

    // Map user token accounts to canonical ordering
    // Trader's WSOL account is on standard SPL Token
    // Trader's CRIME account is on Token-2022
    const userTokenA = wsolIsMintA
      ? trader.wsolAccount!
      : trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
    const userTokenB = wsolIsMintA
      ? trader.tokenAccounts.get(protocol.crimeMint.toBase58())!
      : trader.wsolAccount!;

    // -----------------------------------------------------------------------
    // Step 2: Get pool vaults
    // -----------------------------------------------------------------------
    const poolVaults = protocol.poolVaults.get(
      protocol.crimeSolPool.toBase58()
    )!;
    expect(poolVaults, "CRIME/SOL pool vaults not found").to.exist;

    // -----------------------------------------------------------------------
    // Step 3: Derive PDAs
    // -----------------------------------------------------------------------
    const [swapAuthority] = PublicKey.findProgramAddressSync(
      [SWAP_AUTHORITY_SEED],
      taxProgram.programId
    );
    const [taxAuthority] = PublicKey.findProgramAddressSync(
      [TAX_AUTHORITY_SEED],
      taxProgram.programId
    );

    // -----------------------------------------------------------------------
    // Step 4: Resolve Transfer Hook remaining_accounts
    //
    // For a SOL buy swap (AtoB direction):
    // - Input: WSOL (SPL Token) -- no hook needed
    // - Output: CRIME (Token-2022) -- vault_b -> user_token_b
    //
    // The AMM transfers CRIME from poolVaultB to userTokenB.
    // The pool PDA is the vault authority (signs the transfer).
    // -----------------------------------------------------------------------
    const crimeMintForHook = wsolIsMintA ? mintB : mintA;
    const crimeVault = wsolIsMintA ? poolVaults.vaultB : poolVaults.vaultA;
    const userCrimeAccount = wsolIsMintA ? userTokenB : userTokenA;

    // We need the pool PDA as authority for vault->user transfer
    const hookAccounts = await resolveHookAccounts(
      connection,
      crimeVault,
      crimeMintForHook,
      userCrimeAccount,
      protocol.crimeSolPool, // pool PDA is the vault authority
      BigInt(1) // amount doesn't matter for resolution
    );
    console.log(`  Resolved ${hookAccounts.length} hook accounts for swap`);

    // -----------------------------------------------------------------------
    // Step 5: Capture pre-swap balances
    // -----------------------------------------------------------------------
    const traderSolBefore = await connection.getBalance(
      trader.keypair.publicKey
    );
    const traderCrimeAccountBefore = await getAccount(
      connection,
      userCrimeAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const traderCrimeBefore = Number(traderCrimeAccountBefore.amount);

    const escrowBalanceBefore = await connection.getBalance(
      protocol.escrowVault
    );

    console.log(`  Pre-swap: trader SOL = ${traderSolBefore / LAMPORTS_PER_SOL}`);
    console.log(
      `  Pre-swap: trader CRIME = ${traderCrimeBefore / 10 ** TOKEN_DECIMALS}`
    );
    console.log(
      `  Pre-swap: escrow SOL = ${escrowBalanceBefore / LAMPORTS_PER_SOL}`
    );

    // -----------------------------------------------------------------------
    // Step 6: Execute swap_sol_buy through Tax Program
    // -----------------------------------------------------------------------
    const swapAmount = new anchor.BN(100_000_000); // 0.1 SOL
    // 50% output floor: for 0.1 SOL in a 10 SOL/10k CRIME pool, expected ~98.5 CRIME.
    // Floor requires >= 50% of expected. Use 50 CRIME (safely above floor).
    const minimumOutput = new anchor.BN(50_000_000);
    const isCrime = true;

    try {
      const txSig = await taxProgram.methods
        .swapSolBuy(swapAmount, minimumOutput, isCrime)
        .accountsStrict({
          user: trader.keypair.publicKey,
          epochState: protocol.epochState,
          swapAuthority,
          taxAuthority,
          pool: protocol.crimeSolPool,
          poolVaultA: poolVaults.vaultA,
          poolVaultB: poolVaults.vaultB,
          mintA,
          mintB,
          userTokenA,
          userTokenB,
          stakePool: protocol.stakePool,
          stakingEscrow: protocol.escrowVault,
          carnageVault: protocol.carnageSolVault,
          treasury: protocol.authority.publicKey,
          ammProgram: ammProgram.programId,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          stakingProgram: stakingProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .signers([trader.keypair])
        .rpc();

      console.log(`  Swap tx: ${txSig}`);
    } catch (error: any) {
      console.error("  SWAP FAILED:", error.message || error);
      if (error.logs) {
        console.error("  Program logs:");
        for (const log of error.logs) {
          console.error("    ", log);
        }
      }
      throw error;
    }

    // -----------------------------------------------------------------------
    // Step 7: Verify post-swap state
    // -----------------------------------------------------------------------
    const traderSolAfter = await connection.getBalance(
      trader.keypair.publicKey
    );
    const traderCrimeAccountAfter = await getAccount(
      connection,
      userCrimeAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const traderCrimeAfter = Number(traderCrimeAccountAfter.amount);

    const escrowBalanceAfter = await connection.getBalance(
      protocol.escrowVault
    );

    console.log(
      `  Post-swap: trader SOL = ${traderSolAfter / LAMPORTS_PER_SOL}`
    );
    console.log(
      `  Post-swap: trader CRIME = ${traderCrimeAfter / 10 ** TOKEN_DECIMALS}`
    );
    console.log(
      `  Post-swap: escrow SOL = ${escrowBalanceAfter / LAMPORTS_PER_SOL}`
    );

    // Trader received CRIME tokens
    expect(traderCrimeAfter).to.be.greaterThan(
      traderCrimeBefore,
      "Trader should have received CRIME tokens from swap"
    );

    // Trader spent SOL (swap amount + tax + tx fees)
    expect(traderSolAfter).to.be.lessThan(
      traderSolBefore,
      "Trader should have spent SOL on the swap"
    );

    // Escrow received 71% of tax (staking portion)
    expect(escrowBalanceAfter).to.be.greaterThan(
      escrowBalanceBefore,
      "Staking escrow should have received tax portion"
    );

    const crimeReceived = traderCrimeAfter - traderCrimeBefore;
    console.log(
      `  CRIME received: ${crimeReceived / 10 ** TOKEN_DECIMALS} tokens`
    );
    console.log(
      `  Escrow gain: ${(escrowBalanceAfter - escrowBalanceBefore) / LAMPORTS_PER_SOL} SOL`
    );
    console.log("  SOL buy swap through full CPI chain -- PASSED");
  });

  // ===========================================================================
  // Test 2: Stake PROFIT Tokens (Staking Program CPI)
  // ===========================================================================

  it("Stake PROFIT tokens", async () => {
    const staker = protocol.wallets.staker;
    const stakeAmount = 100_000_000; // 100 PROFIT (6 decimals)

    // -----------------------------------------------------------------------
    // Step 1: Resolve Transfer Hook remaining_accounts for PROFIT transfer
    //
    // The stake instruction transfers PROFIT from staker -> stakeVault.
    // Authority is the staker (user signs the transfer).
    // -----------------------------------------------------------------------
    const stakerProfitAccount = staker.profitAccount!;
    expect(stakerProfitAccount, "Staker PROFIT account not found").to.exist;

    const hookAccounts = await resolveHookAccounts(
      connection,
      stakerProfitAccount,
      protocol.profitMint,
      protocol.stakeVault,
      staker.keypair.publicKey,
      BigInt(stakeAmount)
    );
    console.log(`  Resolved ${hookAccounts.length} hook accounts for stake`);

    // -----------------------------------------------------------------------
    // Step 2: Derive UserStake PDA
    // -----------------------------------------------------------------------
    const [userStake] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, staker.keypair.publicKey.toBuffer()],
      stakingProgram.programId
    );
    console.log(`  UserStake PDA: ${userStake.toBase58()}`);

    // -----------------------------------------------------------------------
    // Step 3: Capture pre-stake balances
    // -----------------------------------------------------------------------
    const stakerProfitBefore = await getAccount(
      connection,
      stakerProfitAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const stakeVaultBefore = await getAccount(
      connection,
      protocol.stakeVault,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log(
      `  Pre-stake: staker PROFIT = ${Number(stakerProfitBefore.amount) / 10 ** TOKEN_DECIMALS}`
    );
    console.log(
      `  Pre-stake: vault PROFIT = ${Number(stakeVaultBefore.amount) / 10 ** TOKEN_DECIMALS}`
    );

    // -----------------------------------------------------------------------
    // Step 4: Execute stake
    // -----------------------------------------------------------------------
    try {
      const txSig = await stakingProgram.methods
        .stake(new anchor.BN(stakeAmount))
        .accountsStrict({
          user: staker.keypair.publicKey,
          stakePool: protocol.stakePool,
          userStake,
          userTokenAccount: stakerProfitAccount,
          stakeVault: protocol.stakeVault,
          profitMint: protocol.profitMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .signers([staker.keypair])
        .rpc();

      console.log(`  Stake tx: ${txSig}`);
    } catch (error: any) {
      console.error("  STAKE FAILED:", error.message || error);
      if (error.logs) {
        console.error("  Program logs:");
        for (const log of error.logs) {
          console.error("    ", log);
        }
      }
      throw error;
    }

    // -----------------------------------------------------------------------
    // Step 5: Verify post-stake state
    // -----------------------------------------------------------------------

    // Check UserStake account exists and has correct staked_amount
    const userStakeAccount =
      await stakingProgram.account.userStake.fetch(userStake);
    expect(userStakeAccount.stakedBalance.toNumber()).to.equal(
      stakeAmount,
      "UserStake staked_balance should equal stake amount"
    );
    expect(userStakeAccount.owner.toBase58()).to.equal(
      staker.keypair.publicKey.toBase58(),
      "UserStake owner should be the staker"
    );

    // StakeVault token balance increased by stakeAmount
    const stakeVaultAfter = await getAccount(
      connection,
      protocol.stakeVault,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(stakeVaultAfter.amount)).to.equal(
      Number(stakeVaultBefore.amount) + stakeAmount,
      "StakeVault balance should increase by stake amount"
    );

    // Staker's PROFIT balance decreased by stakeAmount
    const stakerProfitAfter = await getAccount(
      connection,
      stakerProfitAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(stakerProfitAfter.amount)).to.equal(
      Number(stakerProfitBefore.amount) - stakeAmount,
      "Staker PROFIT balance should decrease by stake amount"
    );

    console.log(
      `  Post-stake: staker PROFIT = ${Number(stakerProfitAfter.amount) / 10 ** TOKEN_DECIMALS}`
    );
    console.log(
      `  Post-stake: vault PROFIT = ${Number(stakeVaultAfter.amount) / 10 ** TOKEN_DECIMALS}`
    );
    console.log(
      `  Post-stake: userStake.staked_balance = ${userStakeAccount.stakedBalance.toNumber() / 10 ** TOKEN_DECIMALS}`
    );
    console.log("  Stake PROFIT tokens -- PASSED");
  });
});
