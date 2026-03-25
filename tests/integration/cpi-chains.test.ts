/**
 * CPI Chain Validation Tests
 *
 * Exercises all swap types through the Tax->AMM CPI chain with compute budget
 * profiling and tax distribution verification.
 *
 * Swap types tested:
 * 1. SOL Buy (CRIME)  -- Tax -> AMM -> T22 -> Hook, taxed (300 bps genesis)
 * 2. SOL Buy (FRAUD)  -- Tax -> AMM -> T22 -> Hook, taxed (1400 bps genesis)
 * 3. SOL Sell (CRIME) -- Tax -> AMM -> T22 -> Hook, taxed on OUTPUT (1400 bps genesis)
 * 4. SOL Sell (FRAUD) -- Tax -> AMM -> T22 -> Hook, taxed on OUTPUT (300 bps genesis)
 * 5. Vault Conversion -- Conversion Vault -> T22 x2, untaxed (100:1 fixed rate)
 * 6. Tax Distribution -- Verifies 71/24/5 SOL split + deposit_rewards CPI
 *
 * CU measurements are logged for each swap type with [CU] prefix.
 *
 * Source: .planning/phases/32-cpi-chain-validation/32-01-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
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
  EXTRA_ACCOUNT_META_SEED,
  VAULT_CONFIG_SEED,
  VAULT_CRIME_SEED,
  VAULT_FRAUD_SEED,
  VAULT_PROFIT_SEED,
  VAULT_CONVERSION_RATE,
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

// =============================================================================
// Test Suite
// =============================================================================

describe("CPI Chain Validation", () => {
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
    console.log("Loading programs for CPI Chain Validation...");
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
      "\nProtocol initialized successfully -- ready for CPI chain tests"
    );
  });

  // ===========================================================================
  // SOL Pool Swaps (Tax -> AMM -> T22 -> Hook)
  // ===========================================================================

  describe("SOL Pool Swaps (Tax -> AMM -> T22 -> Hook)", () => {
    // -----------------------------------------------------------------------
    // Helper: Execute a SOL buy swap for a given pool (CRIME or FRAUD)
    // -----------------------------------------------------------------------
    async function executeSolBuy(
      poolKey: PublicKey,
      ipMint: PublicKey,
      isCrime: boolean,
      label: string
    ): Promise<{
      cuUsed: number;
      tokensReceived: number;
    }> {
      const trader = protocol.wallets.trader;

      // Determine canonical ordering
      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, ipMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);

      // Map user token accounts to canonical ordering
      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(ipMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(ipMint.toBase58())!
        : trader.wsolAccount!;

      // Get pool vaults
      const poolVaults = protocol.poolVaults.get(poolKey.toBase58())!;
      expect(poolVaults, `${label} pool vaults not found`).to.exist;

      // Derive PDAs
      const [swapAuthority] = PublicKey.findProgramAddressSync(
        [SWAP_AUTHORITY_SEED],
        taxProgram.programId
      );
      const [taxAuthority] = PublicKey.findProgramAddressSync(
        [TAX_AUTHORITY_SEED],
        taxProgram.programId
      );

      // Resolve hook accounts for T22 side
      const ipMintForHook = wsolIsMintA ? mintB : mintA;
      const ipVault = wsolIsMintA ? poolVaults.vaultB : poolVaults.vaultA;
      const userIpAccount = wsolIsMintA ? userTokenB : userTokenA;

      const hookAccounts = await resolveHookAccounts(
        connection,
        ipVault,
        ipMintForHook,
        userIpAccount,
        poolKey, // pool PDA is vault authority
        BigInt(1)
      );

      // Capture pre-swap T22 token balance
      const preBalance = await getAccount(
        connection,
        userIpAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const preTokenAmount = Number(preBalance.amount);

      // Build swap instruction
      const swapAmount = new anchor.BN(100_000_000); // 0.1 SOL
      const minimumOutput = new anchor.BN(0);

      const swapIx = await taxProgram.methods
        .swapSolBuy(swapAmount, minimumOutput, isCrime)
        .accountsStrict({
          user: trader.keypair.publicKey,
          epochState: protocol.epochState,
          swapAuthority,
          taxAuthority,
          pool: poolKey,
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
        .instruction();

      // Simulate to measure CU
      const measureTx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        swapIx
      );
      measureTx.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
      measureTx.feePayer = trader.keypair.publicKey;
      measureTx.sign(trader.keypair);

      const sim = await connection.simulateTransaction(measureTx);
      expect(sim.value.err, `${label} simulation failed: ${JSON.stringify(sim.value.err)}`).to.be.null;
      const cuUsed = sim.value.unitsConsumed!;
      console.log(`  [CU] ${label}: ${cuUsed} CU`);

      // Execute with tight CU limit
      const execTx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: Math.ceil(cuUsed * 1.1),
        }),
        swapIx
      );

      await sendAndConfirmTransaction(connection, execTx, [trader.keypair]);

      // Check post-swap balance
      const postBalance = await getAccount(
        connection,
        userIpAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const postTokenAmount = Number(postBalance.amount);
      const tokensReceived = postTokenAmount - preTokenAmount;

      return { cuUsed, tokensReceived };
    }

    // -----------------------------------------------------------------------
    // Helper: Execute a SOL sell swap for a given pool (CRIME or FRAUD)
    // -----------------------------------------------------------------------
    async function executeSolSell(
      poolKey: PublicKey,
      ipMint: PublicKey,
      isCrime: boolean,
      label: string,
      sellAmount: number
    ): Promise<{
      cuUsed: number;
      solReceived: number;
    }> {
      const trader = protocol.wallets.trader;

      // Determine canonical ordering
      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, ipMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);

      // Map user token accounts to canonical ordering
      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(ipMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(ipMint.toBase58())!
        : trader.wsolAccount!;

      // Get pool vaults
      const poolVaults = protocol.poolVaults.get(poolKey.toBase58())!;

      // Derive PDAs
      const [swapAuthority] = PublicKey.findProgramAddressSync(
        [SWAP_AUTHORITY_SEED],
        taxProgram.programId
      );
      const [taxAuthority] = PublicKey.findProgramAddressSync(
        [TAX_AUTHORITY_SEED],
        taxProgram.programId
      );

      // Resolve hook accounts for T22 side (input token for sell)
      // For sell: user sends T22 token to pool vault
      const ipMintForHook = wsolIsMintA ? mintB : mintA;
      const userIpAccount = wsolIsMintA ? userTokenB : userTokenA;
      const ipVault = wsolIsMintA ? poolVaults.vaultB : poolVaults.vaultA;

      const hookAccounts = await resolveHookAccounts(
        connection,
        userIpAccount,
        ipMintForHook,
        ipVault,
        trader.keypair.publicKey, // user is authority for user->vault transfer
        BigInt(sellAmount)
      );

      // Capture pre-swap SOL balance
      const preSolBalance = await connection.getBalance(
        trader.keypair.publicKey
      );

      // Build swap instruction
      const swapIx = await taxProgram.methods
        .swapSolSell(new anchor.BN(sellAmount), new anchor.BN(0), isCrime)
        .accountsStrict({
          user: trader.keypair.publicKey,
          epochState: protocol.epochState,
          swapAuthority,
          taxAuthority,
          pool: poolKey,
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
        .instruction();

      // Simulate to measure CU
      const measureTx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        swapIx
      );
      measureTx.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
      measureTx.feePayer = trader.keypair.publicKey;
      measureTx.sign(trader.keypair);

      const sim = await connection.simulateTransaction(measureTx);
      expect(sim.value.err, `${label} simulation failed: ${JSON.stringify(sim.value.err)}`).to.be.null;
      const cuUsed = sim.value.unitsConsumed!;
      console.log(`  [CU] ${label}: ${cuUsed} CU`);

      // Execute with tight CU limit
      const execTx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: Math.ceil(cuUsed * 1.1),
        }),
        swapIx
      );

      await sendAndConfirmTransaction(connection, execTx, [trader.keypair]);

      // Check post-swap SOL balance
      const postSolBalance = await connection.getBalance(
        trader.keypair.publicKey
      );
      // SOL received = post - pre (may be negative due to tx fees, but sell should net positive minus fee)
      const solReceived = postSolBalance - preSolBalance;

      return { cuUsed, solReceived };
    }

    // Test 1: SOL Buy (CRIME) -- already proven in smoke test, measure CU here
    it("SOL buy (CRIME) completes with CU profiling", async () => {
      const result = await executeSolBuy(
        protocol.crimeSolPool,
        protocol.crimeMint,
        true,
        "swap_sol_buy (CRIME)"
      );

      expect(result.tokensReceived).to.be.greaterThan(
        0,
        "Should receive CRIME tokens from SOL buy"
      );
      console.log(
        `    Received: ${result.tokensReceived / 10 ** TOKEN_DECIMALS} CRIME`
      );
    });

    // Test 2: SOL Buy (FRAUD) -- same path, different pool
    it("SOL buy (FRAUD) completes with CU profiling", async () => {
      const result = await executeSolBuy(
        protocol.fraudSolPool,
        protocol.fraudMint,
        false,
        "swap_sol_buy (FRAUD)"
      );

      expect(result.tokensReceived).to.be.greaterThan(
        0,
        "Should receive FRAUD tokens from SOL buy"
      );
      console.log(
        `    Received: ${result.tokensReceived / 10 ** TOKEN_DECIMALS} FRAUD`
      );
    });

    // Test 3: SOL Sell (CRIME) -- BtoA direction, tax on OUTPUT not input
    it("SOL sell (CRIME) completes with CU profiling", async () => {
      // Sell some of the CRIME tokens we just bought
      // Use a smaller amount to ensure we have enough
      const sellAmount = 50_000_000; // 50 CRIME tokens (6 decimals)

      const result = await executeSolSell(
        protocol.crimeSolPool,
        protocol.crimeMint,
        true,
        "swap_sol_sell (CRIME)",
        sellAmount
      );

      // solReceived can be negative because tx fee is deducted too,
      // but the swap output should be positive
      console.log(
        `    Net SOL change: ${result.solReceived / LAMPORTS_PER_SOL} SOL`
      );
    });

    // Test 4: SOL Sell (FRAUD) -- same path, different pool
    it("SOL sell (FRAUD) completes with CU profiling", async () => {
      const sellAmount = 50_000_000; // 50 FRAUD tokens

      const result = await executeSolSell(
        protocol.fraudSolPool,
        protocol.fraudMint,
        false,
        "swap_sol_sell (FRAUD)",
        sellAmount
      );

      console.log(
        `    Net SOL change: ${result.solReceived / LAMPORTS_PER_SOL} SOL`
      );
    });
  });

  // ===========================================================================
  // Vault Conversion (100:1 Fixed Rate)
  //
  // The Conversion Vault is a leaf-node program (no CPI chain). It calls
  // Token-2022 transfer_checked directly for both input and output legs.
  // These tests verify exact 100:1 conversion math and balance changes.
  // ===========================================================================

  describe("Vault Conversion (100:1 Fixed Rate)", () => {
    // Vault token account PDAs (derived once for all tests)
    let vaultCrime: PublicKey;
    let vaultFraud: PublicKey;
    let vaultProfit: PublicKey;

    before(() => {
      // Derive vault token account PDAs
      [vaultCrime] = PublicKey.findProgramAddressSync(
        [VAULT_CRIME_SEED, protocol.vaultConfig.toBuffer()],
        vaultProgram.programId
      );
      [vaultFraud] = PublicKey.findProgramAddressSync(
        [VAULT_FRAUD_SEED, protocol.vaultConfig.toBuffer()],
        vaultProgram.programId
      );
      [vaultProfit] = PublicKey.findProgramAddressSync(
        [VAULT_PROFIT_SEED, protocol.vaultConfig.toBuffer()],
        vaultProgram.programId
      );
    });

    /**
     * Helper: Execute a vault conversion and return balance changes.
     */
    async function executeConversion(
      inputMint: PublicKey,
      outputMint: PublicKey,
      vaultInput: PublicKey,
      vaultOutput: PublicKey,
      amountIn: number,
      label: string
    ): Promise<{
      userInputDelta: number;
      userOutputDelta: number;
      vaultInputDelta: number;
      vaultOutputDelta: number;
    }> {
      const trader = protocol.wallets.trader;
      const userInputAccount = trader.tokenAccounts.get(inputMint.toBase58())!;
      const userOutputAccount = trader.tokenAccounts.get(outputMint.toBase58())!;

      // Snapshot balances before conversion
      const [userInputBefore, userOutputBefore, vaultInputBefore, vaultOutputBefore] =
        await Promise.all([
          getAccount(connection, userInputAccount, undefined, TOKEN_2022_PROGRAM_ID),
          getAccount(connection, userOutputAccount, undefined, TOKEN_2022_PROGRAM_ID),
          getAccount(connection, vaultInput, undefined, TOKEN_2022_PROGRAM_ID),
          getAccount(connection, vaultOutput, undefined, TOKEN_2022_PROGRAM_ID),
        ]);

      // Resolve hook accounts for both input and output transfers
      // Layout: [input_hooks (4), output_hooks (4)]
      const inputHooks = await resolveHookAccounts(
        connection,
        userInputAccount,
        inputMint,
        vaultInput,
        trader.keypair.publicKey,
        BigInt(amountIn)
      );
      const outputHooks = await resolveHookAccounts(
        connection,
        vaultOutput,
        outputMint,
        userOutputAccount,
        protocol.vaultConfig, // vault_config PDA is vault authority
        BigInt(1)
      );
      const remainingAccounts = [...inputHooks, ...outputHooks];

      // Build and execute conversion instruction
      const convertIx = await vaultProgram.methods
        .convert(new anchor.BN(amountIn))
        .accountsStrict({
          user: trader.keypair.publicKey,
          vaultConfig: protocol.vaultConfig,
          userInputAccount,
          userOutputAccount,
          inputMint,
          outputMint,
          vaultInput,
          vaultOutput,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        convertIx
      );

      await sendAndConfirmTransaction(connection, tx, [trader.keypair]);

      // Snapshot balances after conversion
      const [userInputAfter, userOutputAfter, vaultInputAfter, vaultOutputAfter] =
        await Promise.all([
          getAccount(connection, userInputAccount, undefined, TOKEN_2022_PROGRAM_ID),
          getAccount(connection, userOutputAccount, undefined, TOKEN_2022_PROGRAM_ID),
          getAccount(connection, vaultInput, undefined, TOKEN_2022_PROGRAM_ID),
          getAccount(connection, vaultOutput, undefined, TOKEN_2022_PROGRAM_ID),
        ]);

      const result = {
        userInputDelta: Number(userInputAfter.amount) - Number(userInputBefore.amount),
        userOutputDelta: Number(userOutputAfter.amount) - Number(userOutputBefore.amount),
        vaultInputDelta: Number(vaultInputAfter.amount) - Number(vaultInputBefore.amount),
        vaultOutputDelta: Number(vaultOutputAfter.amount) - Number(vaultOutputBefore.amount),
      };

      console.log(`  ${label}:`);
      console.log(`    User input:  ${result.userInputDelta}`);
      console.log(`    User output: +${result.userOutputDelta}`);
      console.log(`    Vault input: +${result.vaultInputDelta}`);
      console.log(`    Vault output: ${result.vaultOutputDelta}`);

      return result;
    }

    it("CRIME -> PROFIT conversion (100:1)", async () => {
      const amountIn = 10_000_000_000; // 10,000 CRIME (6 decimals)
      const expectedOut = amountIn / VAULT_CONVERSION_RATE; // 100 PROFIT

      const result = await executeConversion(
        protocol.crimeMint,
        protocol.profitMint,
        vaultCrime,
        vaultProfit,
        amountIn,
        "CRIME -> PROFIT"
      );

      expect(result.userInputDelta).to.equal(-amountIn, "User CRIME should decrease by input amount");
      expect(result.userOutputDelta).to.equal(expectedOut, "User PROFIT should increase by output amount");
      expect(result.vaultInputDelta).to.equal(amountIn, "Vault CRIME should increase by input amount");
      expect(result.vaultOutputDelta).to.equal(-expectedOut, "Vault PROFIT should decrease by output amount");
    });

    it("FRAUD -> PROFIT conversion (100:1)", async () => {
      const amountIn = 10_000_000_000; // 10,000 FRAUD
      const expectedOut = amountIn / VAULT_CONVERSION_RATE; // 100 PROFIT

      const result = await executeConversion(
        protocol.fraudMint,
        protocol.profitMint,
        vaultFraud,
        vaultProfit,
        amountIn,
        "FRAUD -> PROFIT"
      );

      expect(result.userInputDelta).to.equal(-amountIn, "User FRAUD should decrease by input amount");
      expect(result.userOutputDelta).to.equal(expectedOut, "User PROFIT should increase by output amount");
      expect(result.vaultInputDelta).to.equal(amountIn, "Vault FRAUD should increase by input amount");
      expect(result.vaultOutputDelta).to.equal(-expectedOut, "Vault PROFIT should decrease by output amount");
    });

    it("PROFIT -> CRIME conversion (1:100)", async () => {
      const amountIn = 10_000_000; // 10 PROFIT
      const expectedOut = amountIn * VAULT_CONVERSION_RATE; // 1,000 CRIME

      const result = await executeConversion(
        protocol.profitMint,
        protocol.crimeMint,
        vaultProfit,
        vaultCrime,
        amountIn,
        "PROFIT -> CRIME"
      );

      expect(result.userInputDelta).to.equal(-amountIn, "User PROFIT should decrease by input amount");
      expect(result.userOutputDelta).to.equal(expectedOut, "User CRIME should increase by output amount");
      expect(result.vaultInputDelta).to.equal(amountIn, "Vault PROFIT should increase by input amount");
      expect(result.vaultOutputDelta).to.equal(-expectedOut, "Vault CRIME should decrease by output amount");
    });

    it("PROFIT -> FRAUD conversion (1:100)", async () => {
      const amountIn = 10_000_000; // 10 PROFIT
      const expectedOut = amountIn * VAULT_CONVERSION_RATE; // 1,000 FRAUD

      const result = await executeConversion(
        protocol.profitMint,
        protocol.fraudMint,
        vaultProfit,
        vaultFraud,
        amountIn,
        "PROFIT -> FRAUD"
      );

      expect(result.userInputDelta).to.equal(-amountIn, "User PROFIT should decrease by input amount");
      expect(result.userOutputDelta).to.equal(expectedOut, "User FRAUD should increase by output amount");
      expect(result.vaultInputDelta).to.equal(amountIn, "Vault PROFIT should increase by input amount");
      expect(result.vaultOutputDelta).to.equal(-expectedOut, "Vault FRAUD should decrease by output amount");
    });

    it("Transfer Hooks fire on vault conversion (8 remaining accounts)", async () => {
      const trader = protocol.wallets.trader;
      const amountIn = 1_000_000_000; // 1,000 CRIME

      const userCrimeAccount = trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
      const userProfitAccount = trader.tokenAccounts.get(protocol.profitMint.toBase58())!;

      // Resolve hook accounts for both legs
      const inputHooks = await resolveHookAccounts(
        connection,
        userCrimeAccount,
        protocol.crimeMint,
        vaultCrime,
        trader.keypair.publicKey,
        BigInt(amountIn)
      );
      const outputHooks = await resolveHookAccounts(
        connection,
        vaultProfit,
        protocol.profitMint,
        userProfitAccount,
        protocol.vaultConfig,
        BigInt(1)
      );

      // Verify 4 accounts per hook leg = 8 total
      expect(inputHooks.length).to.equal(4, "Input hook should resolve 4 extra accounts");
      expect(outputHooks.length).to.equal(4, "Output hook should resolve 4 extra accounts");

      const remainingAccounts = [...inputHooks, ...outputHooks];
      expect(remainingAccounts.length).to.equal(8, "Total remaining accounts should be 8");

      // Execute to verify the hooks don't reject the transfer
      const convertIx = await vaultProgram.methods
        .convert(new anchor.BN(amountIn))
        .accountsStrict({
          user: trader.keypair.publicKey,
          vaultConfig: protocol.vaultConfig,
          userInputAccount: userCrimeAccount,
          userOutputAccount: userProfitAccount,
          inputMint: protocol.crimeMint,
          outputMint: protocol.profitMint,
          vaultInput: vaultCrime,
          vaultOutput: vaultProfit,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        convertIx
      );

      await sendAndConfirmTransaction(connection, tx, [trader.keypair]);
      console.log("  OK: Vault conversion with 8 hook accounts succeeded");
    });

    it("Zero tax collected on vault conversion", async () => {
      // Snapshot tax distribution targets before conversion
      const escrowBefore = await connection.getBalance(protocol.escrowVault);
      const carnageBefore = await connection.getBalance(protocol.carnageSolVault);
      const treasuryBefore = await connection.getBalance(protocol.authority.publicKey);

      // Execute a vault conversion (CRIME -> PROFIT)
      const amountIn = 1_000_000_000; // 1,000 CRIME
      await executeConversion(
        protocol.crimeMint,
        protocol.profitMint,
        vaultCrime,
        vaultProfit,
        amountIn,
        "CRIME -> PROFIT (tax check)"
      );

      // Verify all tax destinations unchanged
      const escrowAfter = await connection.getBalance(protocol.escrowVault);
      const carnageAfter = await connection.getBalance(protocol.carnageSolVault);
      const treasuryAfter = await connection.getBalance(protocol.authority.publicKey);

      expect(escrowAfter).to.equal(escrowBefore, "Escrow should be unchanged (vault bypasses Tax Program)");
      expect(carnageAfter).to.equal(carnageBefore, "Carnage vault should be unchanged");
      // Treasury is the authority wallet -- may change due to tx fees from other operations
      // Use closeTo with small tolerance
      expect(treasuryAfter).to.be.closeTo(
        treasuryBefore,
        100, // 100 lamports tolerance for runtime micro-adjustments
        "Treasury should be approximately unchanged"
      );

      console.log("  OK: Zero tax collected on vault conversion (bypasses Tax Program)");
    });
  });

  // ===========================================================================
  // Tax Distribution (Tax -> Staking deposit_rewards CPI)
  // ===========================================================================

  describe("Tax Distribution (Tax -> Staking deposit_rewards CPI)", () => {
    it("SOL buy distributes tax 71/24/5 and updates StakePool", async () => {
      const trader = protocol.wallets.trader;

      // -----------------------------------------------------------------------
      // Step 1: Read EpochState for current tax rate (not hardcoded)
      // -----------------------------------------------------------------------
      const epochStateAccount =
        await epochProgram.account.epochState.fetch(protocol.epochState);

      // CRIME buy tax at genesis: 300 bps (3%) -- CRIME is the cheap side
      const crimeBuyTaxBps = epochStateAccount.crimeBuyTaxBps;
      console.log(`  CRIME buy tax rate: ${crimeBuyTaxBps} bps (${crimeBuyTaxBps / 100}%)`);

      // -----------------------------------------------------------------------
      // Step 2: Capture pre-swap balances for all distribution targets
      // -----------------------------------------------------------------------
      const escrowBefore = await connection.getBalance(protocol.escrowVault);
      const carnageBefore = await connection.getBalance(protocol.carnageSolVault);
      const treasuryBefore = await connection.getBalance(
        protocol.authority.publicKey
      );
      const stakePoolBefore = await stakingProgram.account.stakePool.fetch(
        protocol.stakePool
      );
      const pendingRewardsBefore = stakePoolBefore.pendingRewards.toNumber();

      console.log(`  Pre-swap escrow:   ${escrowBefore} lamports`);
      console.log(`  Pre-swap carnage:  ${carnageBefore} lamports`);
      console.log(`  Pre-swap treasury: ${treasuryBefore} lamports`);
      console.log(`  Pre-swap pending:  ${pendingRewardsBefore} lamports`);

      // -----------------------------------------------------------------------
      // Step 3: Execute a SOL buy swap
      // -----------------------------------------------------------------------
      const swapAmount = 100_000_000; // 0.1 SOL = 100,000,000 lamports

      // Calculate expected tax amounts (matching on-chain integer math)
      const taxAmount = Math.floor(
        (swapAmount * crimeBuyTaxBps) / 10000
      );
      const stakingPortion = Math.floor((taxAmount * 7100) / 10000);
      const carnagePortion = Math.floor((taxAmount * 2400) / 10000);
      const treasuryPortion = taxAmount - stakingPortion - carnagePortion;

      console.log(`  Expected tax:      ${taxAmount} lamports`);
      console.log(`  Expected staking:  ${stakingPortion} lamports (71%)`);
      console.log(`  Expected carnage:  ${carnagePortion} lamports (24%)`);
      console.log(`  Expected treasury: ${treasuryPortion} lamports (5%)`);

      // Build and execute the swap
      const [mintA, mintB] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
      const wsolIsMintA = mintA.equals(NATIVE_MINT);

      const userTokenA = wsolIsMintA
        ? trader.wsolAccount!
        : trader.tokenAccounts.get(protocol.crimeMint.toBase58())!;
      const userTokenB = wsolIsMintA
        ? trader.tokenAccounts.get(protocol.crimeMint.toBase58())!
        : trader.wsolAccount!;

      const poolVaults = protocol.poolVaults.get(
        protocol.crimeSolPool.toBase58()
      )!;

      const [swapAuthority] = PublicKey.findProgramAddressSync(
        [SWAP_AUTHORITY_SEED],
        taxProgram.programId
      );
      const [taxAuthority] = PublicKey.findProgramAddressSync(
        [TAX_AUTHORITY_SEED],
        taxProgram.programId
      );

      const ipVault = wsolIsMintA ? poolVaults.vaultB : poolVaults.vaultA;
      const userIpAccount = wsolIsMintA ? userTokenB : userTokenA;
      const ipMintForHook = wsolIsMintA ? mintB : mintA;

      const hookAccounts = await resolveHookAccounts(
        connection,
        ipVault,
        ipMintForHook,
        userIpAccount,
        protocol.crimeSolPool,
        BigInt(1)
      );

      // Build as instruction + sendAndConfirmTransaction so the TRADER pays
      // the tx fee, not the provider wallet (which IS the treasury/authority).
      // Using .rpc() would make the provider wallet pay fees, skewing the
      // treasury balance assertion.
      const swapIx = await taxProgram.methods
        .swapSolBuy(
          new anchor.BN(swapAmount),
          new anchor.BN(0),
          true // isCrime
        )
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
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        swapIx
      );

      await sendAndConfirmTransaction(connection, tx, [trader.keypair]);

      // -----------------------------------------------------------------------
      // Step 4: Verify tax distribution
      // -----------------------------------------------------------------------
      const escrowAfter = await connection.getBalance(protocol.escrowVault);
      const carnageAfter = await connection.getBalance(protocol.carnageSolVault);
      const treasuryAfter = await connection.getBalance(
        protocol.authority.publicKey
      );

      const escrowGain = escrowAfter - escrowBefore;
      const carnageGain = carnageAfter - carnageBefore;
      const treasuryGain = treasuryAfter - treasuryBefore;

      console.log(`  Actual escrow gain:   ${escrowGain} lamports`);
      console.log(`  Actual carnage gain:  ${carnageGain} lamports`);
      console.log(`  Actual treasury gain: ${treasuryGain} lamports`);

      // Verify each portion matches expected
      expect(escrowGain).to.equal(
        stakingPortion,
        `Escrow should receive ${stakingPortion} lamports (71% of ${taxAmount} tax)`
      );
      expect(carnageGain).to.equal(
        carnagePortion,
        `Carnage should receive ${carnagePortion} lamports (24% of ${taxAmount} tax)`
      );
      // Treasury assertion uses closeTo because the treasury address is the
      // authority wallet, which may receive small rent refunds or other
      // micro-adjustments from Solana runtime operations (e.g., account
      // reallocation in the same slot). The tax portion itself is exact.
      expect(treasuryGain).to.be.closeTo(
        treasuryPortion,
        100, // tolerance: 100 lamports (0.0000001 SOL)
        `Treasury should receive ~${treasuryPortion} lamports (5% of ${taxAmount} tax)`
      );

      // -----------------------------------------------------------------------
      // Step 5: Verify StakePool.pendingRewards increased via deposit_rewards CPI
      // -----------------------------------------------------------------------
      const stakePoolAfter = await stakingProgram.account.stakePool.fetch(
        protocol.stakePool
      );
      const pendingRewardsAfter = stakePoolAfter.pendingRewards.toNumber();
      const pendingGain = pendingRewardsAfter - pendingRewardsBefore;

      console.log(`  StakePool pending gain: ${pendingGain} lamports`);

      expect(pendingGain).to.equal(
        stakingPortion,
        `StakePool.pendingRewards should increase by ${stakingPortion} (71% staking portion)`
      );

      console.log(
        "    Tax distribution 71/24/5 verified with deposit_rewards CPI"
      );
    });
  });
});
