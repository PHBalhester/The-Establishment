/**
 * Carnage & Epoch CPI Chain Integration Tests
 *
 * Tests the depth-4 Carnage CPI chain and Epoch->Staking authorization:
 *
 * 1. Carnage depth-4 chain (Epoch->Tax->AMM->Token-2022->Transfer Hook):
 *    - EpochState pre-loaded with carnage_pending = true via --account override
 *    - execute_carnage_atomic buys CRIME via tax-exempt swap
 *    - CU consumption measured and logged with threshold assessment
 *
 * 2. Epoch->Staking update_cumulative authorization:
 *    - Negative test: unauthorized caller cannot call update_cumulative
 *
 * Prerequisites:
 * - All 5 programs loaded as upgradeable
 * - Protocol fully initialized (17-step sequence)
 * - EpochState account overridden with carnage_pending = true
 * - Carnage SOL vault funded with enough SOL for swap
 *
 * Source: .planning/phases/32-cpi-chain-validation/32-02-PLAN.md
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
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAccount,
  createAccount as createTokenAccount,
  createWrappedNativeAccount,
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
  STAKE_POOL_SEED,
  EPOCH_STATE_SEED,
  CARNAGE_FUND_SEED,
  CARNAGE_SOL_VAULT_SEED,
  CARNAGE_SIGNER_SEED,
  CARNAGE_CRIME_VAULT_SEED,
  CARNAGE_FRAUD_VAULT_SEED,
  STAKING_AUTHORITY_SEED,
  EXTRA_ACCOUNT_META_SEED,
  derivePoolPDA,
  deriveVaultPDAs,
  deriveWhitelistEntryPDA,
} from "./helpers/constants";

import {
  initializeProtocol,
  ProtocolState,
  Programs,
  InitOptions,
} from "./helpers/protocol-init";

import {
  parseEpochState,
  CarnageTarget,
  CarnageAction,
} from "./helpers/mock-vrf";

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
 * CU threshold assessment per CONTEXT.md.
 */
function assessCU(cuUsed: number, limit: number): string {
  const utilization = cuUsed / limit;
  if (utilization > 0.95) return "CRITICAL (>95%)";
  if (utilization > 0.80) return "WARNING (80-95%)";
  return "OK (<80%)";
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Carnage & Epoch CPI Chains", () => {
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

  // Derived PDAs
  let epochState: PublicKey;
  let carnageState: PublicKey;
  let carnageSigner: PublicKey;
  let carnageSolVault: PublicKey;
  let carnageCrimeVault: PublicKey;
  let carnageFraudVault: PublicKey;
  let stakePool: PublicKey;

  before(async () => {
    console.log("Loading programs from workspace...");
    console.log(`  AMM:           ${ammProgram.programId.toBase58()}`);
    console.log(`  TransferHook:  ${hookProgram.programId.toBase58()}`);
    console.log(`  TaxProgram:    ${taxProgram.programId.toBase58()}`);
    console.log(`  EpochProgram:  ${epochProgram.programId.toBase58()}`);
    console.log(`  Staking:       ${stakingProgram.programId.toBase58()}`);

    // Initialize the full protocol (17-step sequence)
    // skipEpochStateInit: EpochState was pre-loaded via --account override
    // with carnage_pending = true (set by prepare-carnage-state.ts)
    protocol = await initializeProtocol(
      provider,
      {
        amm: ammProgram,
        transferHook: hookProgram,
        taxProgram: taxProgram,
        epochProgram: epochProgram,
        staking: stakingProgram,
        vault: vaultProgram,
      },
      { skipEpochStateInit: true },
    );

    // Derive Epoch PDAs
    [epochState] = PublicKey.findProgramAddressSync(
      [EPOCH_STATE_SEED],
      epochProgram.programId
    );
    [carnageState] = PublicKey.findProgramAddressSync(
      [CARNAGE_FUND_SEED],
      epochProgram.programId
    );
    [carnageSigner] = PublicKey.findProgramAddressSync(
      [CARNAGE_SIGNER_SEED],
      epochProgram.programId
    );
    [carnageSolVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_SOL_VAULT_SEED],
      epochProgram.programId
    );
    [carnageCrimeVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_CRIME_VAULT_SEED],
      epochProgram.programId
    );
    [carnageFraudVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_FRAUD_VAULT_SEED],
      epochProgram.programId
    );
    [stakePool] = PublicKey.findProgramAddressSync(
      [STAKE_POOL_SEED],
      stakingProgram.programId
    );

    console.log("\nCarnage test PDAs:");
    console.log(`  EpochState:       ${epochState.toBase58()}`);
    console.log(`  CarnageState:     ${carnageState.toBase58()}`);
    console.log(`  CarnageSigner:    ${carnageSigner.toBase58()}`);
    console.log(`  CarnageSolVault:  ${carnageSolVault.toBase58()}`);
    console.log(`  CarnageCrimeVault: ${carnageCrimeVault.toBase58()}`);
    console.log(`  CarnageFraudVault: ${carnageFraudVault.toBase58()}`);

    console.log("\nProtocol initialized -- ready for Carnage tests");
  });

  // ===========================================================================
  // Test 1: Verify EpochState has carnage_pending = true (from --account override)
  // ===========================================================================

  it("EpochState has carnage_pending set by --account override", async () => {
    const epochAccountInfo = await connection.getAccountInfo(epochState);
    expect(epochAccountInfo, "EpochState account must exist").to.not.be.null;

    const data = Buffer.from(epochAccountInfo!.data);
    const parsed = parseEpochState(data);

    console.log("  EpochState parsed:");
    console.log(`    carnage_pending: ${parsed.carnagePending}`);
    console.log(`    carnage_target: ${parsed.carnageTarget} (${parsed.carnageTarget === 0 ? "CRIME" : "FRAUD"})`);
    console.log(`    carnage_action: ${parsed.carnageAction} (${parsed.carnageAction === 0 ? "BuyOnly" : parsed.carnageAction === 1 ? "Burn" : "Sell"})`);
    console.log(`    carnage_deadline_slot: ${parsed.carnageDeadlineSlot}`);
    console.log(`    vrf_pending: ${parsed.vrfPending}`);
    console.log(`    taxes_confirmed: ${parsed.taxesConfirmed}`);
    console.log(`    initialized: ${parsed.initialized}`);

    expect(parsed.carnagePending, "carnage_pending should be true").to.be.true;
    expect(parsed.carnageTarget, "carnage_target should be CRIME (0)").to.equal(CarnageTarget.CRIME);
    expect(parsed.carnageAction, "carnage_action should be BuyOnly (0)").to.equal(CarnageAction.NONE);
    expect(parsed.initialized, "EpochState should be initialized").to.be.true;
    expect(parsed.vrfPending, "vrf_pending should be false").to.be.false;
    expect(parsed.taxesConfirmed, "taxes_confirmed should be true").to.be.true;

    console.log("  EpochState carnage_pending verification -- PASSED");
  });

  // ===========================================================================
  // Test 2: Carnage depth-4 chain (Epoch->Tax->AMM->T22->Hook) with CU profiling
  // ===========================================================================

  it("executes Carnage atomic buy through depth-4 CPI chain with CU profiling", async () => {
    const authority = protocol.authority;

    // -----------------------------------------------------------------------
    // Step 1: Determine canonical ordering for pools
    // With dual pools, we always pass both CRIME/SOL and FRAUD/SOL.
    // -----------------------------------------------------------------------
    const [mintA] = canonicalOrder(NATIVE_MINT, protocol.crimeMint);
    const wsolIsMintA = mintA.equals(NATIVE_MINT);
    console.log(`  Pool ordering: WSOL is mint${wsolIsMintA ? "A" : "B"}`);

    const crimePoolVaults = protocol.poolVaults.get(
      protocol.crimeSolPool.toBase58()
    )!;
    expect(crimePoolVaults, "CRIME/SOL pool vaults must exist").to.exist;

    const fraudPoolVaults = protocol.poolVaults.get(
      protocol.fraudSolPool.toBase58()
    )!;
    expect(fraudPoolVaults, "FRAUD/SOL pool vaults must exist").to.exist;

    // -----------------------------------------------------------------------
    // Step 2: Fund Carnage SOL vault with enough SOL for swap
    //
    // The vault starts with just rent-exempt minimum from protocol init.
    // We need to add enough SOL for a meaningful swap.
    // -----------------------------------------------------------------------
    const swapSolAmount = 0.5 * LAMPORTS_PER_SOL; // 0.5 SOL buy

    const fundVaultTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: carnageSolVault,
        lamports: swapSolAmount,
      })
    );
    await sendAndConfirmTransaction(connection, fundVaultTx, [authority]);
    console.log(`  Funded Carnage SOL vault with ${swapSolAmount / LAMPORTS_PER_SOL} SOL`);

    // Read actual sol_vault balance after funding (includes rent-exempt minimum)
    // The Epoch Program uses sol_vault.lamports() as the swap amount, so the
    // WSOL account must be funded to match exactly.
    const solVaultBalance = await connection.getBalance(carnageSolVault);
    console.log(`  SOL vault total balance: ${solVaultBalance} lamports (${solVaultBalance / LAMPORTS_PER_SOL} SOL)`);

    // -----------------------------------------------------------------------
    // Step 3: Create Carnage WSOL account owned by carnage_signer PDA
    //
    // The swap_exempt CPI passes carnage_signer as the AMM "user" who signs
    // token transfers. So the WSOL account authority must be carnage_signer.
    //
    // We must provide an explicit keypair because carnageSigner is a PDA
    // (off-curve key). The default ATA path in createWrappedNativeAccount
    // calls getAssociatedTokenAddressSync with allowOwnerOffCurve=false,
    // which rejects PDA owners. Providing a keypair bypasses the ATA path
    // and creates a standalone token account instead.
    //
    // The amount must match sol_vault.lamports() because the Epoch Program
    // calculates swap_amount = min(sol_vault.lamports(), MAX_CAP) and the
    // AMM transfers that exact amount from the WSOL account.
    // -----------------------------------------------------------------------
    const carnageWsolKeypair = Keypair.generate();
    const carnageWsol = await createWrappedNativeAccount(
      connection,
      authority,            // payer
      carnageSigner,        // owner (carnage_signer PDA)
      solVaultBalance,      // WSOL amount (matches sol_vault.lamports())
      carnageWsolKeypair,   // explicit keypair (bypasses ATA off-curve check)
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`  Carnage WSOL account: ${carnageWsol.toBase58()}`);
    console.log(`  WSOL amount: ${solVaultBalance / LAMPORTS_PER_SOL} SOL`);

    // -----------------------------------------------------------------------
    // Step 4: Resolve Transfer Hook accounts for the output transfer
    //
    // For Carnage buy (AtoB direction in SOL pool):
    // - Input: WSOL (SPL Token) -- no hook needed
    // - Output: CRIME (Token-2022) -- vault_b -> carnage_crime_vault
    //
    // Hook accounts are for the CRIME transfer from pool vault_b to
    // carnage_crime_vault.
    // -----------------------------------------------------------------------
    const crimeMintForHook = protocol.crimeMint;
    const crimePoolVault = wsolIsMintA ? crimePoolVaults.vaultB : crimePoolVaults.vaultA;

    const hookAccounts = await resolveHookAccounts(
      connection,
      crimePoolVault,            // source (pool vault)
      crimeMintForHook,          // CRIME mint
      carnageCrimeVault,         // dest (carnage vault)
      protocol.crimeSolPool,     // authority (pool PDA signs)
      BigInt(1)                  // amount doesn't matter for resolution
    );
    console.log(`  Resolved ${hookAccounts.length} hook accounts for Carnage swap`);

    // -----------------------------------------------------------------------
    // Step 5: Build execute_carnage_atomic instruction
    //
    // Derive Tax Program's swap_authority PDA (needed by swap_exempt CPI).
    // The swap_authority signs the AMM CPI within Tax::swap_exempt.
    // -----------------------------------------------------------------------
    const [swapAuthority] = PublicKey.findProgramAddressSync(
      [SWAP_AUTHORITY_SEED],
      taxProgram.programId,
    );

    const carnageIx = await epochProgram.methods
      .executeCarnageAtomic()
      .accountsStrict({
        caller: authority.publicKey,
        epochState,
        carnageState,
        carnageSigner,
        solVault: carnageSolVault,
        carnageWsol,
        crimeVault: carnageCrimeVault,
        fraudVault: carnageFraudVault,
        crimePool: protocol.crimeSolPool,
        crimePoolVaultA: crimePoolVaults.vaultA,
        crimePoolVaultB: crimePoolVaults.vaultB,
        fraudPool: protocol.fraudSolPool,
        fraudPoolVaultA: fraudPoolVaults.vaultA,
        fraudPoolVaultB: fraudPoolVaults.vaultB,
        mintA: NATIVE_MINT,
        crimeMint: protocol.crimeMint,
        fraudMint: protocol.fraudMint,
        taxProgram: taxProgram.programId,
        ammProgram: ammProgram.programId,
        swapAuthority,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(hookAccounts)
      .instruction();

    // -----------------------------------------------------------------------
    // Step 6: CU measurement via simulateTransaction
    // -----------------------------------------------------------------------
    const CU_LIMIT = 1_400_000; // Max for measurement
    const measureTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      carnageIx,
    );
    measureTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    measureTx.feePayer = authority.publicKey;

    // Sign the tx for simulation
    measureTx.sign(authority);

    const simulation = await connection.simulateTransaction(measureTx);

    if (simulation.value.err) {
      console.error("  Simulation failed:", JSON.stringify(simulation.value.err));
      if (simulation.value.logs) {
        console.error("  Simulation logs:");
        for (const log of simulation.value.logs) {
          console.error("    ", log);
        }
      }
    }

    const cuUsed = simulation.value.unitsConsumed || 0;
    const headroom = ((CU_LIMIT - cuUsed) / CU_LIMIT * 100).toFixed(1);
    const assessment = assessCU(cuUsed, CU_LIMIT);

    console.log(`\n  [CU] Carnage Atomic Buy (depth-4 chain)`);
    console.log(`  [CU]   Consumed: ${cuUsed.toLocaleString()} CU`);
    console.log(`  [CU]   Limit:    ${CU_LIMIT.toLocaleString()} CU`);
    console.log(`  [CU]   Headroom: ${headroom}%`);
    console.log(`  [CU]   Status:   ${assessment}`);

    // Verify simulation succeeded
    expect(simulation.value.err, "Carnage simulation should succeed").to.be.null;
    expect(cuUsed, "CU consumption should be measurable").to.be.greaterThan(0);

    // -----------------------------------------------------------------------
    // Step 7: Execute the actual transaction
    // -----------------------------------------------------------------------
    const tightLimit = Math.ceil(cuUsed * 1.1); // 10% margin
    const execTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: tightLimit }),
      carnageIx,
    );

    try {
      const txSig = await sendAndConfirmTransaction(
        connection,
        execTx,
        [authority],
      );
      console.log(`  Carnage tx: ${txSig}`);
    } catch (error: any) {
      console.error("  CARNAGE EXECUTION FAILED:", error.message || error);
      if (error.logs) {
        console.error("  Program logs:");
        for (const log of error.logs) {
          console.error("    ", log);
        }
      }
      throw error;
    }

    // -----------------------------------------------------------------------
    // Step 8: Verify post-Carnage state
    // -----------------------------------------------------------------------

    // Check EpochState: carnage_pending should be cleared
    const epochAccountAfter = await connection.getAccountInfo(epochState);
    const epochDataAfter = Buffer.from(epochAccountAfter!.data);
    const parsedAfter = parseEpochState(epochDataAfter);

    expect(parsedAfter.carnagePending, "carnage_pending should be cleared after execution").to.be.false;
    console.log(`  Post-Carnage: carnage_pending = ${parsedAfter.carnagePending} (cleared)`);

    // Check CarnageFundState: total_triggers should increase
    const carnageStateData = await epochProgram.account.carnageFundState.fetch(carnageState);
    expect(carnageStateData.totalTriggers, "total_triggers should be > 0").to.be.greaterThan(0);
    expect(carnageStateData.heldAmount.toNumber(), "held_amount should be > 0 (tokens bought)").to.be.greaterThan(0);

    // held_token should be 1 (CRIME) since target was CRIME
    expect(carnageStateData.heldToken, "held_token should be 1 (CRIME)").to.equal(1);

    console.log(`  Post-Carnage: total_triggers = ${carnageStateData.totalTriggers}`);
    console.log(`  Post-Carnage: held_amount = ${carnageStateData.heldAmount.toNumber()} (${carnageStateData.heldAmount.toNumber() / 10 ** TOKEN_DECIMALS} CRIME)`);
    console.log(`  Post-Carnage: held_token = ${carnageStateData.heldToken} (CRIME)`);
    console.log(`  Post-Carnage: total_sol_spent = ${carnageStateData.totalSolSpent.toNumber()} lamports`);

    // Check CRIME vault balance increased
    const crimeVaultAccount = await getAccount(
      connection,
      carnageCrimeVault,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(
      Number(crimeVaultAccount.amount),
      "Carnage CRIME vault should have tokens after buy"
    ).to.be.greaterThan(0);
    console.log(`  Post-Carnage: CRIME vault balance = ${Number(crimeVaultAccount.amount) / 10 ** TOKEN_DECIMALS} CRIME`);

    console.log("\n  Carnage depth-4 CPI chain execution -- PASSED");
  });

  // ===========================================================================
  // Test 3: update_cumulative authorization (negative test)
  // ===========================================================================

  describe("Epoch->Staking update_cumulative CPI", () => {
    it("rejects update_cumulative from unauthorized caller", async () => {
      // Try to call update_cumulative directly with a random keypair
      // instead of the Epoch Program's staking_authority PDA
      const fakeKeypair = Keypair.generate();
      const airdropSig = await connection.requestAirdrop(
        fakeKeypair.publicKey,
        LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(airdropSig);

      // Build the update_cumulative instruction manually
      // Discriminator: sha256("global:update_cumulative")[0..8]
      const UPDATE_CUMULATIVE_DISCRIMINATOR = Buffer.from([
        0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71,
      ]);

      // Build instruction data: discriminator + epoch (u32 LE)
      const ixData = Buffer.alloc(12);
      UPDATE_CUMULATIVE_DISCRIMINATOR.copy(ixData, 0);
      ixData.writeUInt32LE(0, 8); // epoch = 0

      const updateCumulativeIx = new anchor.web3.TransactionInstruction({
        programId: stakingProgram.programId,
        keys: [
          { pubkey: fakeKeypair.publicKey, isSigner: true, isWritable: false }, // authority (fake)
          { pubkey: stakePool, isSigner: false, isWritable: true }, // stake_pool
        ],
        data: ixData,
      });

      try {
        const tx = new Transaction().add(updateCumulativeIx);
        await sendAndConfirmTransaction(connection, tx, [fakeKeypair]);
        expect.fail("Should have rejected unauthorized update_cumulative call");
      } catch (err: any) {
        // Expect seeds constraint error (ConstraintSeeds = 2006) or similar auth failure
        const errStr = err.message || err.toString();
        const isAuthError =
          errStr.includes("seeds") ||
          errStr.includes("Seeds") ||
          errStr.includes("2006") ||
          errStr.includes("ConstraintSeeds") ||
          errStr.includes("privilege escalation") ||
          errStr.includes("custom program error");

        expect(isAuthError, `Expected auth error, got: ${errStr}`).to.be.true;
        console.log("  update_cumulative correctly rejected unauthorized caller");
        console.log(`  Error type: ${errStr.includes("2006") ? "ConstraintSeeds (2006)" : "auth failure"}`);
      }

      console.log("  Epoch->Staking update_cumulative auth -- PASSED");
    });
  });
});
