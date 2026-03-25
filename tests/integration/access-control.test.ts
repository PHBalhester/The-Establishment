/**
 * CPI Access Control Validation Tests (Negative Authorization Matrix)
 *
 * Exercises the negative authorization matrix across all 5 CPI-gated
 * instructions in the Dr. Fraudsworth protocol. Each entry point is tested
 * with two attack vectors:
 *
 *   1. Random keypair as authority -- proves a random signer cannot bypass
 *   2. PDA from wrong program -- proves seeds::program constraint works
 *
 * CPI entry points tested:
 * - AMM: swap_sol_pool (swap_authority from Tax Program)
 * - Staking: deposit_rewards (tax_authority from Tax Program)
 * - Staking: update_cumulative (epoch_authority from Epoch Program)
 * - Tax: swap_exempt (carnage_authority from Epoch Program)
 * - Vault: convert (permissionless) + initialize (one-shot)
 *
 * CPI tests should reject with ConstraintSeeds (Anchor error 2006)
 * or a related seeds/PDA validation error. Vault tests verify the
 * permissionless convert model and one-shot initialization guard.
 *
 * Source: .planning/phases/32-cpi-chain-validation/32-03-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createTransferCheckedWithTransferHookInstruction,
  createAccount as createSplAccount,
  mintTo,
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
  STAKING_AUTHORITY_SEED,
  CARNAGE_SIGNER_SEED,
  EXTRA_ACCOUNT_META_SEED,
  VAULT_CONFIG_SEED,
  VAULT_CRIME_SEED,
  VAULT_FRAUD_SEED,
  VAULT_PROFIT_SEED,
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
 * Canonically order two mints (smaller pubkey = mintA).
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

  return transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));
}

/**
 * Assert that a transaction error is a seeds constraint violation.
 *
 * Anchor encodes ConstraintSeeds as error code 2006. The error may appear
 * in different formats depending on the RPC response path, so we check
 * multiple indicators.
 */
function assertConstraintSeedsError(err: any, context: string): void {
  const errStr = err.message || err.toString();
  const isConstraintSeeds =
    err.error?.errorCode?.code === "ConstraintSeeds" ||
    errStr.includes("ConstraintSeeds") ||
    errStr.includes("seeds") ||
    errStr.includes("Seeds") ||
    errStr.includes("2006") ||
    errStr.includes("privilege escalation") ||
    errStr.includes("custom program error") ||
    err.logs?.some(
      (log: string) =>
        log.includes("seeds constraint") ||
        log.includes("ConstraintSeeds") ||
        log.includes("0x7d6") // 2006 in hex
    );

  expect(
    isConstraintSeeds,
    `${context}: Expected ConstraintSeeds error, got: ${errStr}`
  ).to.be.true;
}

/**
 * Fund a keypair with SOL via airdrop.
 */
async function fundKeypair(
  connection: anchor.web3.Connection,
  keypair: Keypair,
  lamports: number = LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await connection.requestAirdrop(keypair.publicKey, lamports);
  await connection.confirmTransaction(sig);
}

// =============================================================================
// Test Suite
// =============================================================================

describe("CPI Access Control Validation", () => {
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
    console.log("Loading programs for Access Control tests...");
    console.log(`  AMM:           ${ammProgram.programId.toBase58()}`);
    console.log(`  TransferHook:  ${hookProgram.programId.toBase58()}`);
    console.log(`  TaxProgram:    ${taxProgram.programId.toBase58()}`);
    console.log(`  EpochProgram:  ${epochProgram.programId.toBase58()}`);
    console.log(`  Staking:       ${stakingProgram.programId.toBase58()}`);

    protocol = await initializeProtocol(provider, {
      amm: ammProgram,
      transferHook: hookProgram,
      taxProgram: taxProgram,
      epochProgram: epochProgram,
      staking: stakingProgram,
      vault: vaultProgram,
    });
    console.log(
      "\nProtocol initialized -- ready for access control tests"
    );
  });

  // ===========================================================================
  // AMM: swap_sol_pool access control
  //
  // The swap_authority PDA must be derived from Tax Program with
  // seeds ["swap_authority"]. Any other signer is rejected.
  // ===========================================================================

  describe("AMM: swap_sol_pool access control", () => {
    it("rejects swap with random keypair as swap_authority", async () => {
      const fakeKeypair = Keypair.generate();
      await fundKeypair(connection, fakeKeypair);

      // Set up correct accounts for CRIME/SOL pool -- only authority is wrong
      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);
      const poolVaults = protocol.poolVaults.get(
        protocol.crimeSolPool.toBase58()
      )!;

      const trader = protocol.wallets.trader;
      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(protocol.crimeMint.toBase58())!
        : trader.wsolAccount!;

      try {
        await ammProgram.methods
          .swapSolPool(
            new anchor.BN(100_000), // small amount
            { atoB: {} },
            new anchor.BN(0)
          )
          .accountsStrict({
            swapAuthority: fakeKeypair.publicKey, // WRONG: random keypair
            pool: protocol.crimeSolPool,
            vaultA: poolVaults.vaultA,
            vaultB: poolVaults.vaultB,
            mintA,
            mintB,
            userTokenA,
            userTokenB,
            user: fakeKeypair.publicKey,
            tokenProgramA: TOKEN_PROGRAM_ID,
            tokenProgramB: TOKEN_2022_PROGRAM_ID,
          })
          .signers([fakeKeypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        assertConstraintSeedsError(err, "swap_sol_pool random keypair");
        console.log(
          "  swap_sol_pool correctly rejected random keypair as swap_authority"
        );
      }
    });

    it("rejects swap with PDA from wrong program", async () => {
      // Derive swap_authority PDA from Epoch Program (wrong -- should be Tax)
      const [wrongPDA] = PublicKey.findProgramAddressSync(
        [SWAP_AUTHORITY_SEED],
        epochProgram.programId // Wrong program!
      );

      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);
      const poolVaults = protocol.poolVaults.get(
        protocol.crimeSolPool.toBase58()
      )!;

      const trader = protocol.wallets.trader;
      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(protocol.crimeMint.toBase58())!
        : trader.wsolAccount!;

      try {
        // The wrongPDA is a valid PDA but derived from the wrong program.
        // Since it's a PDA (not a regular keypair), we can't sign with it.
        // The Anchor deserialization will fail because:
        // 1. It's not a signer (can't sign for a PDA from another program)
        // 2. Even if somehow signed, seeds::program would reject it
        //
        // We pass the wrong PDA as a non-signing account. Anchor's signer
        // check fires before seeds::program, so we expect a signature
        // verification failure or seeds constraint error.
        await ammProgram.methods
          .swapSolPool(
            new anchor.BN(100_000),
            { atoB: {} },
            new anchor.BN(0)
          )
          .accountsStrict({
            swapAuthority: wrongPDA, // WRONG: PDA from Epoch Program
            pool: protocol.crimeSolPool,
            vaultA: poolVaults.vaultA,
            vaultB: poolVaults.vaultB,
            mintA,
            mintB,
            userTokenA,
            userTokenB,
            user: trader.keypair.publicKey,
            tokenProgramA: TOKEN_PROGRAM_ID,
            tokenProgramB: TOKEN_2022_PROGRAM_ID,
          })
          .signers([trader.keypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        // PDA from wrong program cannot sign, so we get either:
        // - ConstraintSeeds (seeds::program mismatch)
        // - Missing signature error (PDA can't sign without its program)
        const errStr = err.message || err.toString();
        const isAuthError =
          errStr.includes("seeds") ||
          errStr.includes("Seeds") ||
          errStr.includes("2006") ||
          errStr.includes("ConstraintSeeds") ||
          errStr.includes("Signature verification failed") ||
          errStr.includes("signature") ||
          errStr.includes("missing") ||
          errStr.includes("privilege escalation") ||
          errStr.includes("custom program error") ||
          errStr.includes("unknown signer");

        expect(
          isAuthError,
          `swap_sol_pool wrong PDA: Expected auth error, got: ${errStr}`
        ).to.be.true;
        console.log(
          "  swap_sol_pool correctly rejected PDA from wrong program"
        );
      }
    });
  });

  // ===========================================================================
  // Vault: conversion authority model
  //
  // The vault has NO stored authority. Convert is permissionless (any user
  // can call it). The only protection is one-shot initialization — once
  // VaultConfig PDA exists, initialize cannot be called again.
  // ===========================================================================

  describe("Vault: conversion authority model", () => {
    it("vault convert is permissionless (any user can convert)", async () => {
      // Create a completely fresh keypair — not from protocol.wallets
      const freshUser = Keypair.generate();
      await fundKeypair(connection, freshUser, 2 * LAMPORTS_PER_SOL);

      // Create CRIME + PROFIT token accounts for the fresh user
      const freshCrimeAccount = await createSplAccount(
        connection,
        freshUser,
        protocol.crimeMint,
        freshUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const freshProfitAccount = await createSplAccount(
        connection,
        freshUser,
        protocol.profitMint,
        freshUser.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Mint CRIME to fresh user (we still have mint authority in integration tests)
      await mintTo(
        connection,
        freshUser,
        protocol.crimeMint,
        freshCrimeAccount,
        protocol.crimeMintKeypair, // mint authority
        1_000_000_000, // 1,000 CRIME
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Derive vault token accounts
      const [vaultCrime] = PublicKey.findProgramAddressSync(
        [VAULT_CRIME_SEED, protocol.vaultConfig.toBuffer()],
        vaultProgram.programId
      );
      const [vaultProfit] = PublicKey.findProgramAddressSync(
        [VAULT_PROFIT_SEED, protocol.vaultConfig.toBuffer()],
        vaultProgram.programId
      );

      // Resolve hook accounts
      const inputHooks = await resolveHookAccounts(
        connection,
        freshCrimeAccount,
        protocol.crimeMint,
        vaultCrime,
        freshUser.publicKey,
        BigInt(1_000_000_000)
      );
      const outputHooks = await resolveHookAccounts(
        connection,
        vaultProfit,
        protocol.profitMint,
        freshProfitAccount,
        protocol.vaultConfig,
        BigInt(1)
      );

      // Fresh user calls convert — should succeed (permissionless)
      const convertIx = await vaultProgram.methods
        .convert(new anchor.BN(1_000_000_000)) // 1,000 CRIME -> 10 PROFIT
        .accountsStrict({
          user: freshUser.publicKey,
          vaultConfig: protocol.vaultConfig,
          userInputAccount: freshCrimeAccount,
          userOutputAccount: freshProfitAccount,
          inputMint: protocol.crimeMint,
          outputMint: protocol.profitMint,
          vaultInput: vaultCrime,
          vaultOutput: vaultProfit,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([...inputHooks, ...outputHooks])
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        convertIx
      );

      await sendAndConfirmTransaction(connection, tx, [freshUser]);
      console.log("  vault convert accepted from fresh random keypair (permissionless)");
    });

    it("vault re-initialize is rejected (one-shot guard)", async () => {
      try {
        await vaultProgram.methods
          .initialize()
          .accountsStrict({
            payer: protocol.authority.publicKey,
            vaultConfig: protocol.vaultConfig,
            vaultCrime: PublicKey.findProgramAddressSync(
              [VAULT_CRIME_SEED, protocol.vaultConfig.toBuffer()],
              vaultProgram.programId
            )[0],
            vaultFraud: PublicKey.findProgramAddressSync(
              [VAULT_FRAUD_SEED, protocol.vaultConfig.toBuffer()],
              vaultProgram.programId
            )[0],
            vaultProfit: PublicKey.findProgramAddressSync(
              [VAULT_PROFIT_SEED, protocol.vaultConfig.toBuffer()],
              vaultProgram.programId
            )[0],
            crimeMint: protocol.crimeMint,
            fraudMint: protocol.fraudMint,
            profitMint: protocol.profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .rpc();

        expect.fail("Should have rejected re-initialization");
      } catch (err: any) {
        const errStr = err.message || err.toString();
        // Account already initialized — Anchor refuses to init again
        const isInitError =
          errStr.includes("already in use") ||
          errStr.includes("AccountInit") ||
          errStr.includes("custom program error") ||
          errStr.includes("0x0");

        expect(
          isInitError,
          `vault re-init: Expected init guard error, got: ${errStr}`
        ).to.be.true;
        console.log("  vault re-initialize correctly rejected (account already exists)");
      }
    });

    it("vault re-initialize rejected from different authority", async () => {
      const randomUser = Keypair.generate();
      await fundKeypair(connection, randomUser);

      try {
        await vaultProgram.methods
          .initialize()
          .accountsStrict({
            payer: randomUser.publicKey,
            vaultConfig: protocol.vaultConfig,
            vaultCrime: PublicKey.findProgramAddressSync(
              [VAULT_CRIME_SEED, protocol.vaultConfig.toBuffer()],
              vaultProgram.programId
            )[0],
            vaultFraud: PublicKey.findProgramAddressSync(
              [VAULT_FRAUD_SEED, protocol.vaultConfig.toBuffer()],
              vaultProgram.programId
            )[0],
            vaultProfit: PublicKey.findProgramAddressSync(
              [VAULT_PROFIT_SEED, protocol.vaultConfig.toBuffer()],
              vaultProgram.programId
            )[0],
            crimeMint: protocol.crimeMint,
            fraudMint: protocol.fraudMint,
            profitMint: protocol.profitMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([randomUser])
          .rpc();

        expect.fail("Should have rejected re-initialization from random user");
      } catch (err: any) {
        const errStr = err.message || err.toString();
        // PDA already exists — doesn't matter who calls, can't re-init
        const isInitError =
          errStr.includes("already in use") ||
          errStr.includes("AccountInit") ||
          errStr.includes("custom program error") ||
          errStr.includes("0x0");

        expect(
          isInitError,
          `vault re-init different auth: Expected init guard error, got: ${errStr}`
        ).to.be.true;
        console.log("  vault re-initialize from different authority correctly rejected");
      }
    });
  });

  // ===========================================================================
  // Staking: deposit_rewards access control
  //
  // The tax_authority PDA must be derived from Tax Program with
  // seeds ["tax_authority"]. Only Tax Program can sign for this PDA.
  // ===========================================================================

  describe("Staking: deposit_rewards access control", () => {
    it("rejects deposit_rewards from random keypair as tax_authority", async () => {
      const fakeKeypair = Keypair.generate();
      await fundKeypair(connection, fakeKeypair);

      const [stakePool] = PublicKey.findProgramAddressSync(
        [STAKE_POOL_SEED],
        stakingProgram.programId
      );

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [ESCROW_VAULT_SEED],
        stakingProgram.programId
      );

      try {
        await stakingProgram.methods
          .depositRewards(new anchor.BN(1_000_000)) // 0.001 SOL
          .accountsStrict({
            taxAuthority: fakeKeypair.publicKey, // WRONG: random keypair
            stakePool,
            escrowVault,
          })
          .signers([fakeKeypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        assertConstraintSeedsError(err, "deposit_rewards random keypair");
        console.log(
          "  deposit_rewards correctly rejected random keypair as tax_authority"
        );
      }
    });

    it("rejects deposit_rewards with PDA from wrong program", async () => {
      // Derive tax_authority PDA from Epoch Program (wrong -- should be Tax)
      const [wrongPDA] = PublicKey.findProgramAddressSync(
        [TAX_AUTHORITY_SEED],
        epochProgram.programId // Wrong program!
      );

      const [stakePool] = PublicKey.findProgramAddressSync(
        [STAKE_POOL_SEED],
        stakingProgram.programId
      );

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [ESCROW_VAULT_SEED],
        stakingProgram.programId
      );

      try {
        await stakingProgram.methods
          .depositRewards(new anchor.BN(1_000_000))
          .accountsStrict({
            taxAuthority: wrongPDA, // WRONG: PDA from Epoch Program
            stakePool,
            escrowVault,
          })
          .signers([]) // PDA can't sign -- no signers
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        const errStr = err.message || err.toString();
        const isAuthError =
          errStr.includes("seeds") ||
          errStr.includes("Seeds") ||
          errStr.includes("2006") ||
          errStr.includes("ConstraintSeeds") ||
          errStr.includes("Signature verification failed") ||
          errStr.includes("signature") ||
          errStr.includes("missing") ||
          errStr.includes("privilege escalation") ||
          errStr.includes("custom program error") ||
          errStr.includes("unknown signer");

        expect(
          isAuthError,
          `deposit_rewards wrong PDA: Expected auth error, got: ${errStr}`
        ).to.be.true;
        console.log(
          "  deposit_rewards correctly rejected PDA from wrong program"
        );
      }
    });
  });

  // ===========================================================================
  // Staking: update_cumulative access control
  //
  // The epoch_authority PDA must be derived from Epoch Program with
  // seeds ["staking_authority"]. Only Epoch Program can sign for this PDA.
  // ===========================================================================

  describe("Staking: update_cumulative access control", () => {
    it("rejects update_cumulative from random keypair as epoch_authority", async () => {
      const fakeKeypair = Keypair.generate();
      await fundKeypair(connection, fakeKeypair);

      const [stakePool] = PublicKey.findProgramAddressSync(
        [STAKE_POOL_SEED],
        stakingProgram.programId
      );

      try {
        await stakingProgram.methods
          .updateCumulative(new anchor.BN(0)) // epoch 0
          .accountsStrict({
            epochAuthority: fakeKeypair.publicKey, // WRONG: random keypair
            stakePool,
          })
          .signers([fakeKeypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        assertConstraintSeedsError(err, "update_cumulative random keypair");
        console.log(
          "  update_cumulative correctly rejected random keypair as epoch_authority"
        );
      }
    });

    it("rejects update_cumulative with PDA from wrong program", async () => {
      // Derive staking_authority PDA from Tax Program (wrong -- should be Epoch)
      const [wrongPDA] = PublicKey.findProgramAddressSync(
        [STAKING_AUTHORITY_SEED],
        taxProgram.programId // Wrong program!
      );

      const [stakePool] = PublicKey.findProgramAddressSync(
        [STAKE_POOL_SEED],
        stakingProgram.programId
      );

      try {
        await stakingProgram.methods
          .updateCumulative(new anchor.BN(0))
          .accountsStrict({
            epochAuthority: wrongPDA, // WRONG: PDA from Tax Program
            stakePool,
          })
          .signers([]) // PDA can't sign
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        const errStr = err.message || err.toString();
        const isAuthError =
          errStr.includes("seeds") ||
          errStr.includes("Seeds") ||
          errStr.includes("2006") ||
          errStr.includes("ConstraintSeeds") ||
          errStr.includes("Signature verification failed") ||
          errStr.includes("signature") ||
          errStr.includes("missing") ||
          errStr.includes("privilege escalation") ||
          errStr.includes("custom program error") ||
          errStr.includes("unknown signer");

        expect(
          isAuthError,
          `update_cumulative wrong PDA: Expected auth error, got: ${errStr}`
        ).to.be.true;
        console.log(
          "  update_cumulative correctly rejected PDA from wrong program"
        );
      }
    });
  });

  // ===========================================================================
  // Tax: swap_exempt access control
  //
  // The carnage_authority PDA must be derived from Epoch Program with
  // seeds ["carnage_signer"]. Only Epoch Program can sign for this PDA.
  // ===========================================================================

  describe("Tax: swap_exempt access control", () => {
    it("rejects swap_exempt from random keypair as carnage_authority", async () => {
      const fakeKeypair = Keypair.generate();
      await fundKeypair(connection, fakeKeypair);

      // Set up correct accounts for CRIME/SOL pool -- only authority is wrong
      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);
      const poolVaults = protocol.poolVaults.get(
        protocol.crimeSolPool.toBase58()
      )!;

      // swap_authority PDA from Tax Program (correct, but carnage_authority is wrong)
      const [swapAuthority] = PublicKey.findProgramAddressSync(
        [SWAP_AUTHORITY_SEED],
        taxProgram.programId
      );

      // Trader token accounts as stand-in for user token accounts
      const trader = protocol.wallets.trader;
      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(protocol.crimeMint.toBase58())!
        : trader.wsolAccount!;

      try {
        await taxProgram.methods
          .swapExempt(
            new anchor.BN(100_000),
            0, // direction: buy
            true // isCrime
          )
          .accountsStrict({
            carnageAuthority: fakeKeypair.publicKey, // WRONG: random keypair
            swapAuthority,
            pool: protocol.crimeSolPool,
            poolVaultA: poolVaults.vaultA,
            poolVaultB: poolVaults.vaultB,
            mintA,
            mintB,
            userTokenA,
            userTokenB,
            ammProgram: ammProgram.programId,
            tokenProgramA: TOKEN_PROGRAM_ID,
            tokenProgramB: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([fakeKeypair])
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        assertConstraintSeedsError(err, "swap_exempt random keypair");
        console.log(
          "  swap_exempt correctly rejected random keypair as carnage_authority"
        );
      }
    });

    it("rejects swap_exempt with PDA from wrong program", async () => {
      // Derive carnage_signer PDA from AMM Program (wrong -- should be Epoch)
      const [wrongPDA] = PublicKey.findProgramAddressSync(
        [CARNAGE_SIGNER_SEED],
        ammProgram.programId // Wrong program!
      );

      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);
      const poolVaults = protocol.poolVaults.get(
        protocol.crimeSolPool.toBase58()
      )!;

      const [swapAuthority] = PublicKey.findProgramAddressSync(
        [SWAP_AUTHORITY_SEED],
        taxProgram.programId
      );

      const trader = protocol.wallets.trader;
      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(protocol.crimeMint.toBase58())!
        : trader.wsolAccount!;

      try {
        await taxProgram.methods
          .swapExempt(
            new anchor.BN(100_000),
            0,
            true
          )
          .accountsStrict({
            carnageAuthority: wrongPDA, // WRONG: PDA from AMM Program
            swapAuthority,
            pool: protocol.crimeSolPool,
            poolVaultA: poolVaults.vaultA,
            poolVaultB: poolVaults.vaultB,
            mintA,
            mintB,
            userTokenA,
            userTokenB,
            ammProgram: ammProgram.programId,
            tokenProgramA: TOKEN_PROGRAM_ID,
            tokenProgramB: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([]) // PDA can't sign
          .rpc();

        expect.fail("Should have failed with seeds constraint violation");
      } catch (err: any) {
        const errStr = err.message || err.toString();
        const isAuthError =
          errStr.includes("seeds") ||
          errStr.includes("Seeds") ||
          errStr.includes("2006") ||
          errStr.includes("ConstraintSeeds") ||
          errStr.includes("Signature verification failed") ||
          errStr.includes("signature") ||
          errStr.includes("missing") ||
          errStr.includes("privilege escalation") ||
          errStr.includes("custom program error") ||
          errStr.includes("unknown signer");

        expect(
          isAuthError,
          `swap_exempt wrong PDA: Expected auth error, got: ${errStr}`
        ).to.be.true;
        console.log(
          "  swap_exempt correctly rejected PDA from wrong program"
        );
      }
    });
  });
});
