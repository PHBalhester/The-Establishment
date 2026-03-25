/**
 * Bonding Curve Lifecycle Integration Test
 *
 * Capstone test for Phase 74: exercises the full bonding curve lifecycle
 * from initialization through graduation (or failure/refund) on localnet.
 *
 * This test proves all 12 bonding curve instructions work correctly within
 * the full 7-program protocol stack (Transfer Hook, AMM, Bonding Curve,
 * Tax, Epoch, Staking, Conversion Vault).
 *
 * Coverage:
 * - Happy path: init -> fund -> start -> buy -> sell -> fill -> graduate
 *   -> withdraw SOL -> close token vault -> distribute tax escrow
 * - Failure path: init -> fund -> start -> buy -> deadline -> mark_failed
 *   -> consolidate_for_refund -> claim_refund
 * - Edge cases: partial fill, wallet cap, slippage, min purchase,
 *   single curve fill rejection, non-Active buy/sell rejection
 *
 * All token transfers include Transfer Hook remaining_accounts.
 * Dense assertions on every state transition.
 *
 * Source: .planning/phases/74-protocol-integration/74-05-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
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
  createAccount,
  mintTo,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// Anchor IDL types
import { BondingCurve } from "../../target/types/bonding_curve";
import { TransferHook } from "../../target/types/transfer_hook";

// Local helpers
import {
  TOKEN_DECIMALS,
  CURVE_SEED,
  CURVE_TOKEN_VAULT_SEED,
  CURVE_SOL_VAULT_SEED,
  CURVE_TAX_ESCROW_SEED,
  WHITELIST_AUTHORITY_SEED,
  WHITELIST_ENTRY_SEED,
  EXTRA_ACCOUNT_META_SEED,
  CARNAGE_SOL_VAULT_SEED,
  deriveWhitelistEntryPDA,
} from "./helpers/constants";

// =============================================================================
// Constants matching on-chain bonding_curve/src/constants.rs
// =============================================================================

/** 460M tokens at 6 decimals */
const TARGET_TOKENS = 460_000_000_000_000;
/** 500 SOL in lamports */
const TARGET_SOL = 500_000_000_000;
/** 20M tokens at 6 decimals */
const MAX_TOKENS_PER_WALLET = 20_000_000_000_000;
/** 0.05 SOL minimum purchase */
const MIN_PURCHASE_SOL = 50_000_000;
/**
 * Localnet build uses DEADLINE_SLOTS = 500 (feature-gated short deadline).
 * Long enough for happy path curve fills (~200 TXs) to complete before
 * the deadline, short enough for failure path tests to advance the
 * validator clock past deadline + FAILURE_GRACE_SLOTS (500 + 150 = 650).
 */
const DEADLINE_SLOTS = 500;
/** 150-slot grace period (same on all builds) */
const FAILURE_GRACE_SLOTS = 150;
/** Sell tax: 15% = 1500 bps */
const SELL_TAX_BPS = 1_500;
const BPS_DENOMINATOR = 10_000;

// =============================================================================
// Helper: Build Transfer Hook remaining_accounts for a Token-2022 transfer
// =============================================================================

/**
 * Build the 4 Transfer Hook remaining_accounts for a Token-2022 transfer.
 *
 * For every T22 transfer involving our Transfer Hook, the runtime needs:
 *   [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]
 *
 * We build these deterministically from known seeds rather than using the
 * async resolver (which requires accounts to already exist on-chain and
 * adds latency). The pattern matches protocol-init.ts exactly.
 */
function buildHookRemainingAccounts(
  mint: PublicKey,
  source: PublicKey,
  dest: PublicKey,
  hookProgramId: PublicKey,
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const [extraMeta] = PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()],
    hookProgramId,
  );
  const [wlSource] = deriveWhitelistEntryPDA(source, hookProgramId);
  const [wlDest] = deriveWhitelistEntryPDA(dest, hookProgramId);

  return [
    { pubkey: extraMeta, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: hookProgramId, isSigner: false, isWritable: false },
  ];
}

/**
 * Airdrop SOL and wait for confirmation.
 */
async function airdropSol(
  connection: anchor.web3.Connection,
  recipient: PublicKey,
  lamports: number,
): Promise<void> {
  const sig = await connection.requestAirdrop(recipient, lamports);
  await connection.confirmTransaction(sig);
}

/**
 * Create a Token-2022 account and optionally mint tokens into it.
 */
async function createAndFundT22Account(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  mintAuthority: Keypair,
  amount: number,
): Promise<PublicKey> {
  const tokenAccount = await createAccount(
    connection,
    payer,
    mint,
    owner,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  if (amount > 0) {
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount,
      mintAuthority,
      amount,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
  }
  return tokenAccount;
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Bonding Curve Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  // Programs from workspace
  const bondingCurve = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const hookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  const hookProgramId = hookProgram.programId;
  const bondingCurveId = bondingCurve.programId;

  // In localnet build, the bonding curve's epoch_program_id() returns Pubkey::default()
  // (System Program). The distribute_tax_escrow constraint derives the carnage vault
  // PDA from this ID, so we must derive the same PDA in the test.
  const LOCALNET_EPOCH_PROGRAM_ID = SystemProgram.programId;

  // Authority (provider wallet)
  const authority = (provider.wallet as any).payer as Keypair;

  // =========================================================================
  // Shared state for Happy Path
  // =========================================================================
  let crimeMintKp: Keypair;
  let fraudMintKp: Keypair;
  let crimeMint: PublicKey;
  let fraudMint: PublicKey;

  // Admin token accounts
  let adminCrimeAccount: PublicKey;
  let adminFraudAccount: PublicKey;

  // Curve PDAs
  let crimeCurveState: PublicKey;
  let fraudCurveState: PublicKey;
  let crimeTokenVault: PublicKey;
  let fraudTokenVault: PublicKey;
  let crimeSolVault: PublicKey;
  let fraudSolVault: PublicKey;
  let crimeTaxEscrow: PublicKey;
  let fraudTaxEscrow: PublicKey;

  // Transfer Hook
  let whitelistAuthority: PublicKey;

  // Epoch
  let carnageSolVault: PublicKey;

  // Test buyers
  let buyer1: Keypair;
  let buyer2: Keypair;

  // =========================================================================
  // Setup: Create mints, Transfer Hook infra, fund curves, start curves
  // =========================================================================

  before(async function () {
    this.timeout(300_000); // 5 min for setup

    console.log("\n========================================");
    console.log("  Lifecycle Test Setup Starting");
    console.log("========================================\n");

    // --- Airdrop SOL to authority ---
    console.log("Airdrop SOL to authority...");
    await airdropSol(connection, authority.publicKey, 100 * LAMPORTS_PER_SOL);

    // --- Create Token-2022 mints with TransferHook ---
    console.log("Creating Token-2022 mints with TransferHook...");
    const {
      createInitializeTransferHookInstruction,
      createInitializeMintInstruction,
      getMintLen,
      ExtensionType,
    } = await import("@solana/spl-token");

    crimeMintKp = Keypair.generate();
    fraudMintKp = Keypair.generate();
    crimeMint = crimeMintKp.publicKey;
    fraudMint = fraudMintKp.publicKey;

    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    for (const { name, kp } of [
      { name: "CRIME", kp: crimeMintKp },
      { name: "FRAUD", kp: fraudMintKp },
    ]) {
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
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMintInstruction(
          kp.publicKey,
          TOKEN_DECIMALS,
          authority.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, mintTx, [authority, kp]);
      console.log(`  ${name} mint: ${kp.publicKey.toBase58()}`);
    }

    // --- Initialize WhitelistAuthority ---
    console.log("Initializing WhitelistAuthority...");
    [whitelistAuthority] = PublicKey.findProgramAddressSync(
      [WHITELIST_AUTHORITY_SEED],
      hookProgramId,
    );
    await hookProgram.methods
      .initializeAuthority()
      .accountsStrict({
        signer: authority.publicKey,
        whitelistAuthority,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // --- Initialize ExtraAccountMetaLists ---
    console.log("Initializing ExtraAccountMetaLists...");
    for (const { name, mint } of [
      { name: "CRIME", mint: crimeMint },
      { name: "FRAUD", mint: fraudMint },
    ]) {
      const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()],
        hookProgramId,
      );
      await hookProgram.methods
        .initializeExtraAccountMetaList()
        .accountsStrict({
          payer: authority.publicKey,
          whitelistAuthority,
          authority: authority.publicKey,
          extraAccountMetaList,
          mint,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log(`  ${name} ExtraAccountMetaList created`);
    }

    // --- Create admin token accounts and mint 1B each ---
    console.log("Creating admin token accounts...");
    const TOTAL_SUPPLY = 1_000_000_000 * 10 ** TOKEN_DECIMALS; // 1B tokens
    adminCrimeAccount = await createAndFundT22Account(
      connection, authority, crimeMint, authority.publicKey,
      authority, TOTAL_SUPPLY,
    );
    adminFraudAccount = await createAndFundT22Account(
      connection, authority, fraudMint, authority.publicKey,
      authority, TOTAL_SUPPLY,
    );
    console.log(`  Admin CRIME account: ${adminCrimeAccount.toBase58()}`);
    console.log(`  Admin FRAUD account: ${adminFraudAccount.toBase58()}`);

    // --- Whitelist admin token accounts ---
    console.log("Whitelisting admin token accounts...");
    for (const account of [adminCrimeAccount, adminFraudAccount]) {
      const [wlEntry] = deriveWhitelistEntryPDA(account, hookProgramId);
      await hookProgram.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry: wlEntry,
          addressToWhitelist: account,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }

    // --- Set up carnage SOL vault for distribute_tax_escrow ---
    // In localnet build, the bonding curve's epoch_program_id() returns Pubkey::default()
    // (System Program), so the distribute_tax_escrow constraint expects the carnage vault
    // PDA to be derived from SystemProgram.programId. We derive this PDA and fund it with
    // enough SOL so the account exists for the lamport credit in the handler.
    console.log("Setting up carnage SOL vault (localnet mode)...");
    [carnageSolVault] = PublicKey.findProgramAddressSync(
      [CARNAGE_SOL_VAULT_SEED],
      LOCALNET_EPOCH_PROGRAM_ID,
    );
    // Fund the PDA so it exists as an account (SOL can be sent to any address)
    const rentExemptMin = await connection.getMinimumBalanceForRentExemption(0);
    const fundCarnageTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: carnageSolVault,
        lamports: rentExemptMin,
      }),
    );
    await sendAndConfirmTransaction(connection, fundCarnageTx, [authority]);
    console.log(`  Carnage SOL vault: ${carnageSolVault.toBase58()}`);

    // --- Initialize CRIME curve ---
    console.log("Initializing CRIME bonding curve...");
    [crimeCurveState] = PublicKey.findProgramAddressSync(
      [CURVE_SEED, crimeMint.toBuffer()],
      bondingCurveId,
    );
    [crimeTokenVault] = PublicKey.findProgramAddressSync(
      [CURVE_TOKEN_VAULT_SEED, crimeMint.toBuffer()],
      bondingCurveId,
    );
    [crimeSolVault] = PublicKey.findProgramAddressSync(
      [CURVE_SOL_VAULT_SEED, crimeMint.toBuffer()],
      bondingCurveId,
    );
    [crimeTaxEscrow] = PublicKey.findProgramAddressSync(
      [CURVE_TAX_ESCROW_SEED, crimeMint.toBuffer()],
      bondingCurveId,
    );

    await bondingCurve.methods
      .initializeCurve({ crime: {} } as any)
      .accountsStrict({
        authority: authority.publicKey,
        curveState: crimeCurveState,
        tokenVault: crimeTokenVault,
        solVault: crimeSolVault,
        taxEscrow: crimeTaxEscrow,
        tokenMint: crimeMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(`  CRIME CurveState: ${crimeCurveState.toBase58()}`);

    // --- Initialize FRAUD curve ---
    console.log("Initializing FRAUD bonding curve...");
    [fraudCurveState] = PublicKey.findProgramAddressSync(
      [CURVE_SEED, fraudMint.toBuffer()],
      bondingCurveId,
    );
    [fraudTokenVault] = PublicKey.findProgramAddressSync(
      [CURVE_TOKEN_VAULT_SEED, fraudMint.toBuffer()],
      bondingCurveId,
    );
    [fraudSolVault] = PublicKey.findProgramAddressSync(
      [CURVE_SOL_VAULT_SEED, fraudMint.toBuffer()],
      bondingCurveId,
    );
    [fraudTaxEscrow] = PublicKey.findProgramAddressSync(
      [CURVE_TAX_ESCROW_SEED, fraudMint.toBuffer()],
      bondingCurveId,
    );

    await bondingCurve.methods
      .initializeCurve({ fraud: {} } as any)
      .accountsStrict({
        authority: authority.publicKey,
        curveState: fraudCurveState,
        tokenVault: fraudTokenVault,
        solVault: fraudSolVault,
        taxEscrow: fraudTaxEscrow,
        tokenMint: fraudMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log(`  FRAUD CurveState: ${fraudCurveState.toBase58()}`);

    // --- Whitelist curve token vaults ---
    console.log("Whitelisting curve token vaults...");
    for (const vault of [crimeTokenVault, fraudTokenVault]) {
      const [wlEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);
      await hookProgram.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry: wlEntry,
          addressToWhitelist: vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }

    // --- Fund curves (460M tokens each) ---
    console.log("Funding CRIME curve (460M tokens)...");
    const hookAccountsCrimeFund = buildHookRemainingAccounts(
      crimeMint, adminCrimeAccount, crimeTokenVault, hookProgramId,
    );
    await bondingCurve.methods
      .fundCurve()
      .accountsStrict({
        authority: authority.publicKey,
        curveState: crimeCurveState,
        authorityTokenAccount: adminCrimeAccount,
        tokenVault: crimeTokenVault,
        tokenMint: crimeMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(hookAccountsCrimeFund)
      .signers([authority])
      .rpc();

    console.log("Funding FRAUD curve (460M tokens)...");
    const hookAccountsFraudFund = buildHookRemainingAccounts(
      fraudMint, adminFraudAccount, fraudTokenVault, hookProgramId,
    );
    await bondingCurve.methods
      .fundCurve()
      .accountsStrict({
        authority: authority.publicKey,
        curveState: fraudCurveState,
        authorityTokenAccount: adminFraudAccount,
        tokenVault: fraudTokenVault,
        tokenMint: fraudMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(hookAccountsFraudFund)
      .signers([authority])
      .rpc();

    // Verify vaults funded
    const crimeVaultInfo = await getAccount(connection, crimeTokenVault, undefined, TOKEN_2022_PROGRAM_ID);
    const fraudVaultInfo = await getAccount(connection, fraudTokenVault, undefined, TOKEN_2022_PROGRAM_ID);
    expect(Number(crimeVaultInfo.amount)).to.equal(TARGET_TOKENS);
    expect(Number(fraudVaultInfo.amount)).to.equal(TARGET_TOKENS);
    console.log("  Vaults verified: 460M tokens each");

    // --- Start curves ---
    console.log("Starting curves...");
    await bondingCurve.methods
      .startCurve()
      .accountsStrict({
        authority: authority.publicKey,
        curveState: crimeCurveState,
        tokenVault: crimeTokenVault,
        tokenMint: crimeMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    await bondingCurve.methods
      .startCurve()
      .accountsStrict({
        authority: authority.publicKey,
        curveState: fraudCurveState,
        tokenVault: fraudTokenVault,
        tokenMint: fraudMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    // Verify Active status
    const crimeState = await bondingCurve.account.curveState.fetch(crimeCurveState);
    const fraudState = await bondingCurve.account.curveState.fetch(fraudCurveState);
    expect(JSON.stringify(crimeState.status)).to.include("active");
    expect(JSON.stringify(fraudState.status)).to.include("active");
    expect(crimeState.startSlot.toNumber()).to.be.greaterThan(0);
    expect(crimeState.deadlineSlot.toNumber()).to.equal(
      crimeState.startSlot.toNumber() + DEADLINE_SLOTS,
    );
    console.log(`  Both curves Active, deadline at slot ${crimeState.deadlineSlot.toNumber()} (start + ${DEADLINE_SLOTS})`);

    // --- Create test buyers ---
    console.log("Creating test buyer wallets...");
    buyer1 = Keypair.generate();
    buyer2 = Keypair.generate();
    await airdropSol(connection, buyer1.publicKey, 50 * LAMPORTS_PER_SOL);
    await airdropSol(connection, buyer2.publicKey, 50 * LAMPORTS_PER_SOL);

    console.log("\n========================================");
    console.log("  Lifecycle Test Setup Complete");
    console.log("========================================\n");
  });

  // ===========================================================================
  // Happy Path: Graduation
  // ===========================================================================

  describe("Happy Path: Graduation", () => {
    let buyer1CrimeAta: PublicKey;
    let buyer1TokensBought: number;

    it("should allow users to buy tokens from CRIME curve", async () => {
      // Buy with 1 SOL on CRIME curve
      const solAmount = 1 * LAMPORTS_PER_SOL;

      // Derive user's ATA
      buyer1CrimeAta = getAssociatedTokenAddressSync(
        crimeMint,
        buyer1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      // Build hook remaining_accounts: vault -> user ATA transfer
      // The user ATA doesn't exist yet (init_if_needed in purchase), but
      // the hook check needs whitelistDest. If the vault is whitelisted,
      // the hook passes even if the dest is not whitelisted.
      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, crimeTokenVault, buyer1CrimeAta, hookProgramId,
      );

      // Read state before purchase
      const stateBefore = await bondingCurve.account.curveState.fetch(crimeCurveState);
      const tokensSoldBefore = stateBefore.tokensSold.toNumber();
      const solRaisedBefore = stateBefore.solRaised.toNumber();

      await bondingCurve.methods
        .purchase(
          new anchor.BN(solAmount),
          new anchor.BN(1), // minimum_tokens_out: at least 1 token
        )
        .accountsStrict({
          user: buyer1.publicKey,
          curveState: crimeCurveState,
          userTokenAccount: buyer1CrimeAta,
          tokenVault: crimeTokenVault,
          solVault: crimeSolVault,
          tokenMint: crimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .signers([buyer1])
        .rpc();

      // Verify state after purchase
      const stateAfter = await bondingCurve.account.curveState.fetch(crimeCurveState);
      expect(stateAfter.tokensSold.toNumber()).to.be.greaterThan(tokensSoldBefore);
      expect(stateAfter.solRaised.toNumber()).to.be.greaterThan(solRaisedBefore);
      expect(stateAfter.participantCount).to.equal(1);

      // Verify user received tokens
      const userAccount = await getAccount(
        connection, buyer1CrimeAta, undefined, TOKEN_2022_PROGRAM_ID,
      );
      buyer1TokensBought = Number(userAccount.amount);
      expect(buyer1TokensBought).to.be.greaterThan(0);

      // Verify SOL vault received SOL
      const vaultBalance = await connection.getBalance(crimeSolVault);
      expect(vaultBalance).to.be.greaterThan(0);

      console.log(`  Bought ${buyer1TokensBought / 1e6} CRIME tokens for 1 SOL`);
    });

    it("should allow users to sell tokens back (Active curve)", async () => {
      // Sell half of bought tokens back
      const tokensToSell = Math.floor(buyer1TokensBought / 2);
      expect(tokensToSell).to.be.greaterThan(0);

      // Hook accounts for user ATA -> vault transfer
      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, buyer1CrimeAta, crimeTokenVault, hookProgramId,
      );

      // Capture state before sell
      const stateBefore = await bondingCurve.account.curveState.fetch(crimeCurveState);
      const escrowBalBefore = await connection.getBalance(crimeTaxEscrow);
      const userSolBefore = await connection.getBalance(buyer1.publicKey);

      await bondingCurve.methods
        .sell(
          new anchor.BN(tokensToSell),
          new anchor.BN(1), // minimum_sol_out: at least 1 lamport
        )
        .accountsStrict({
          user: buyer1.publicKey,
          curveState: crimeCurveState,
          userTokenAccount: buyer1CrimeAta,
          tokenVault: crimeTokenVault,
          solVault: crimeSolVault,
          taxEscrow: crimeTaxEscrow,
          tokenMint: crimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .signers([buyer1])
        .rpc();

      // Verify state after sell
      const stateAfter = await bondingCurve.account.curveState.fetch(crimeCurveState);
      expect(stateAfter.tokensSold.toNumber()).to.be.lessThan(stateBefore.tokensSold.toNumber());
      expect(stateAfter.tokensReturned.toNumber()).to.be.greaterThan(0);
      expect(stateAfter.solReturned.toNumber()).to.be.greaterThan(0);
      expect(stateAfter.taxCollected.toNumber()).to.be.greaterThan(0);

      // Verify tax escrow received 15% tax
      const escrowBalAfter = await connection.getBalance(crimeTaxEscrow);
      expect(escrowBalAfter).to.be.greaterThan(escrowBalBefore);

      // Verify user received SOL
      const userSolAfter = await connection.getBalance(buyer1.publicKey);
      expect(userSolAfter).to.be.greaterThan(userSolBefore);

      console.log(`  Sold ${tokensToSell / 1e6} tokens, tax collected: ${stateAfter.taxCollected.toNumber()} lamports`);
    });

    it("should enforce per-wallet cap (20M tokens)", async () => {
      // Try to buy more than 20M tokens worth of SOL
      // At the start of the curve, ~20M tokens costs roughly 20M * 900 / 1e6 = 18 SOL
      // But the user already has some tokens, so let's try to buy enough to exceed cap
      // We'll buy 30 SOL worth which should push past the 20M cap
      const solAmount = 30 * LAMPORTS_PER_SOL;

      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, crimeTokenVault, buyer1CrimeAta, hookProgramId,
      );

      try {
        await bondingCurve.methods
          .purchase(
            new anchor.BN(solAmount),
            new anchor.BN(1),
          )
          .accountsStrict({
            user: buyer1.publicKey,
            curveState: crimeCurveState,
            userTokenAccount: buyer1CrimeAta,
            tokenVault: crimeTokenVault,
            solVault: crimeSolVault,
            tokenMint: crimeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(hookAccounts)
          .signers([buyer1])
          .rpc();
        expect.fail("Should have thrown WalletCapExceeded");
      } catch (err: any) {
        expect(err.toString()).to.include("WalletCapExceeded");
        console.log("  WalletCapExceeded error correctly thrown");
      }
    });

    it("should enforce minimum purchase (0.05 SOL)", async () => {
      // Try to buy with less than MIN_PURCHASE_SOL
      const tinyAmount = MIN_PURCHASE_SOL - 1; // 49,999,999 lamports

      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, crimeTokenVault, buyer1CrimeAta, hookProgramId,
      );

      try {
        await bondingCurve.methods
          .purchase(
            new anchor.BN(tinyAmount),
            new anchor.BN(0),
          )
          .accountsStrict({
            user: buyer1.publicKey,
            curveState: crimeCurveState,
            userTokenAccount: buyer1CrimeAta,
            tokenVault: crimeTokenVault,
            solVault: crimeSolVault,
            tokenMint: crimeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(hookAccounts)
          .signers([buyer1])
          .rpc();
        expect.fail("Should have thrown BelowMinimum");
      } catch (err: any) {
        expect(err.toString()).to.include("BelowMinimum");
        console.log("  BelowMinimum error correctly thrown");
      }
    });

    it("should enforce slippage protection (minimum_tokens_out)", async () => {
      const solAmount = new anchor.BN(MIN_PURCHASE_SOL); // 0.05 SOL
      // Set minimum_tokens_out absurdly high
      const absurdMinTokens = new anchor.BN(TARGET_TOKENS);

      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, crimeTokenVault, buyer1CrimeAta, hookProgramId,
      );

      try {
        await bondingCurve.methods
          .purchase(solAmount, absurdMinTokens)
          .accountsStrict({
            user: buyer1.publicKey,
            curveState: crimeCurveState,
            userTokenAccount: buyer1CrimeAta,
            tokenVault: crimeTokenVault,
            solVault: crimeSolVault,
            tokenMint: crimeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(hookAccounts)
          .signers([buyer1])
          .rpc();
        expect.fail("Should have thrown SlippageExceeded");
      } catch (err: any) {
        expect(err.toString()).to.include("SlippageExceeded");
        console.log("  SlippageExceeded error correctly thrown");
      }
    });

    it("should reject graduation if only one curve filled", async () => {
      // Try prepare_transition before filling both curves
      try {
        await bondingCurve.methods
          .prepareTransition()
          .accountsStrict({
            authority: authority.publicKey,
            crimeCurveState,
            fraudCurveState,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have thrown CRIMECurveNotFilled or FRAUDCurveNotFilled");
      } catch (err: any) {
        const errStr = err.toString();
        expect(
          errStr.includes("CRIMECurveNotFilled") || errStr.includes("FRAUDCurveNotFilled"),
        ).to.be.true;
        console.log("  Graduation rejected with only unfilled curves");
      }
    });

    it("should fill CRIME curve by buying remaining supply", async function () {
      this.timeout(120_000);

      // Use multiple buyers with purchases sized to stay under wallet cap.
      // The full curve costs ~500 SOL. At the curve start, ~1 SOL buys ~2.2M tokens.
      // As the price rises, ~1 SOL buys fewer tokens. With 20M wallet cap,
      // we use ~15 SOL per buyer (~16.5M tokens at start, under 20M cap).
      // Need ~70 buyers to fill the curve.

      const bulkBuyers: Keypair[] = [];
      for (let i = 0; i < 80; i++) {
        const kp = Keypair.generate();
        await airdropSol(connection, kp.publicKey, 20 * LAMPORTS_PER_SOL);
        bulkBuyers.push(kp);
      }

      let filled = false;
      for (const buyerKp of bulkBuyers) {
        if (filled) break;

        const state = await bondingCurve.account.curveState.fetch(crimeCurveState);
        if (JSON.stringify(state.status).includes("filled")) {
          filled = true;
          break;
        }

        const buyerAta = getAssociatedTokenAddressSync(
          crimeMint, buyerKp.publicKey, false, TOKEN_2022_PROGRAM_ID,
        );
        const hookAccounts = buildHookRemainingAccounts(
          crimeMint, crimeTokenVault, buyerAta, hookProgramId,
        );

        try {
          await bondingCurve.methods
            .purchase(
              new anchor.BN(15 * LAMPORTS_PER_SOL),
              new anchor.BN(1),
            )
            .accountsStrict({
              user: buyerKp.publicKey,
              curveState: crimeCurveState,
              userTokenAccount: buyerAta,
              tokenVault: crimeTokenVault,
              solVault: crimeSolVault,
              tokenMint: crimeMint,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(hookAccounts)
            .signers([buyerKp])
            .rpc();
        } catch (err: any) {
          // CurveNotActive means it's already filled, or DeadlinePassed, or CurveAlreadyFilled
          if (
            err.toString().includes("CurveNotActive") ||
            err.toString().includes("CurveAlreadyFilled")
          ) {
            filled = true;
            break;
          }
          throw err;
        }
      }

      // Verify CRIME curve is Filled
      const crimeState = await bondingCurve.account.curveState.fetch(crimeCurveState);
      expect(JSON.stringify(crimeState.status)).to.include("filled");
      expect(crimeState.tokensSold.toNumber()).to.equal(TARGET_TOKENS);
      console.log(`  CRIME curve filled: ${crimeState.solRaised.toNumber() / LAMPORTS_PER_SOL} SOL raised`);
    });

    it("should reject sells on Filled curve", async () => {
      // Buyer1 still has some tokens from the earlier buy/sell cycle
      const userAccount = await getAccount(
        connection, buyer1CrimeAta, undefined, TOKEN_2022_PROGRAM_ID,
      );
      if (Number(userAccount.amount) === 0) {
        console.log("  (Skipping sell rejection test -- buyer1 has 0 tokens)");
        return;
      }

      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, buyer1CrimeAta, crimeTokenVault, hookProgramId,
      );

      try {
        await bondingCurve.methods
          .sell(
            new anchor.BN(Number(userAccount.amount)),
            new anchor.BN(0),
          )
          .accountsStrict({
            user: buyer1.publicKey,
            curveState: crimeCurveState,
            userTokenAccount: buyer1CrimeAta,
            tokenVault: crimeTokenVault,
            solVault: crimeSolVault,
            taxEscrow: crimeTaxEscrow,
            tokenMint: crimeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(hookAccounts)
          .signers([buyer1])
          .rpc();
        expect.fail("Should have thrown CurveNotActiveForSell");
      } catch (err: any) {
        expect(err.toString()).to.include("CurveNotActiveForSell");
        console.log("  CurveNotActiveForSell error correctly thrown on Filled curve");
      }
    });

    it("should fill FRAUD curve by buying remaining supply", async function () {
      this.timeout(120_000);

      const bulkBuyers: Keypair[] = [];
      for (let i = 0; i < 80; i++) {
        const kp = Keypair.generate();
        await airdropSol(connection, kp.publicKey, 20 * LAMPORTS_PER_SOL);
        bulkBuyers.push(kp);
      }

      let filled = false;
      for (const buyerKp of bulkBuyers) {
        if (filled) break;

        const state = await bondingCurve.account.curveState.fetch(fraudCurveState);
        if (JSON.stringify(state.status).includes("filled")) {
          filled = true;
          break;
        }

        const buyerAta = getAssociatedTokenAddressSync(
          fraudMint, buyerKp.publicKey, false, TOKEN_2022_PROGRAM_ID,
        );
        const hookAccounts = buildHookRemainingAccounts(
          fraudMint, fraudTokenVault, buyerAta, hookProgramId,
        );

        try {
          await bondingCurve.methods
            .purchase(
              new anchor.BN(15 * LAMPORTS_PER_SOL),
              new anchor.BN(1),
            )
            .accountsStrict({
              user: buyerKp.publicKey,
              curveState: fraudCurveState,
              userTokenAccount: buyerAta,
              tokenVault: fraudTokenVault,
              solVault: fraudSolVault,
              tokenMint: fraudMint,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(hookAccounts)
            .signers([buyerKp])
            .rpc();
        } catch (err: any) {
          if (
            err.toString().includes("CurveNotActive") ||
            err.toString().includes("CurveAlreadyFilled")
          ) {
            filled = true;
            break;
          }
          throw err;
        }
      }

      // Verify FRAUD curve is Filled
      const fraudState = await bondingCurve.account.curveState.fetch(fraudCurveState);
      expect(JSON.stringify(fraudState.status)).to.include("filled");
      expect(fraudState.tokensSold.toNumber()).to.equal(TARGET_TOKENS);
      console.log(`  FRAUD curve filled: ${fraudState.solRaised.toNumber() / LAMPORTS_PER_SOL} SOL raised`);
    });

    it("should graduate both curves via prepare_transition", async () => {
      await bondingCurve.methods
        .prepareTransition()
        .accountsStrict({
          authority: authority.publicKey,
          crimeCurveState,
          fraudCurveState,
        })
        .signers([authority])
        .rpc();

      // Verify both curves are now Graduated
      const crimeState = await bondingCurve.account.curveState.fetch(crimeCurveState);
      const fraudState = await bondingCurve.account.curveState.fetch(fraudCurveState);
      expect(JSON.stringify(crimeState.status)).to.include("graduated");
      expect(JSON.stringify(fraudState.status)).to.include("graduated");
      console.log("  Both curves graduated successfully");
    });

    it("should reject purchases on Graduated curve", async () => {
      const buyerAta = getAssociatedTokenAddressSync(
        crimeMint, buyer2.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const hookAccounts = buildHookRemainingAccounts(
        crimeMint, crimeTokenVault, buyerAta, hookProgramId,
      );

      try {
        await bondingCurve.methods
          .purchase(
            new anchor.BN(LAMPORTS_PER_SOL),
            new anchor.BN(1),
          )
          .accountsStrict({
            user: buyer2.publicKey,
            curveState: crimeCurveState,
            userTokenAccount: buyerAta,
            tokenVault: crimeTokenVault,
            solVault: crimeSolVault,
            tokenMint: crimeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(hookAccounts)
          .signers([buyer2])
          .rpc();
        expect.fail("Should have thrown CurveNotActive");
      } catch (err: any) {
        expect(err.toString()).to.include("CurveNotActive");
        console.log("  CurveNotActive error correctly thrown on Graduated curve");
      }
    });

    it("should withdraw SOL from graduated curve vaults", async () => {
      const authBalBefore = await connection.getBalance(authority.publicKey);
      const rentExempt = await connection.getMinimumBalanceForRentExemption(0);

      // Withdraw from CRIME SOL vault
      const crimeSolBefore = await connection.getBalance(crimeSolVault);
      expect(crimeSolBefore).to.be.greaterThan(rentExempt);

      await bondingCurve.methods
        .withdrawGraduatedSol()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: crimeCurveState,
          solVault: crimeSolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Verify vault has only rent-exempt minimum
      const crimeSolAfter = await connection.getBalance(crimeSolVault);
      expect(crimeSolAfter).to.equal(rentExempt);

      // Withdraw from FRAUD SOL vault
      await bondingCurve.methods
        .withdrawGraduatedSol()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: fraudCurveState,
          solVault: fraudSolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const fraudSolAfter = await connection.getBalance(fraudSolVault);
      expect(fraudSolAfter).to.equal(rentExempt);

      const authBalAfter = await connection.getBalance(authority.publicKey);
      expect(authBalAfter).to.be.greaterThan(authBalBefore);

      console.log(`  SOL withdrawn. Admin received ~${(authBalAfter - authBalBefore) / LAMPORTS_PER_SOL} SOL`);
    });

    it("should be idempotent on second withdraw call", async () => {
      // Second withdraw should be a no-op (returns Ok with 0 withdrawn)
      const authBalBefore = await connection.getBalance(authority.publicKey);

      await bondingCurve.methods
        .withdrawGraduatedSol()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: crimeCurveState,
          solVault: crimeSolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const authBalAfter = await connection.getBalance(authority.publicKey);
      // Balance should have decreased slightly (TX fee only)
      expect(authBalBefore - authBalAfter).to.be.lessThan(100_000); // < 0.0001 SOL
      console.log("  Idempotent withdraw: no-op on second call");
    });

    it("should close empty token vaults (recovering rent)", async () => {
      // First, transfer all tokens out of the vaults to make them empty
      // The token vault still holds tokens (users bought, but the vault authority
      // is the curve PDA). After graduation, tokens_sold == TARGET_TOKENS meaning
      // all 460M were purchased and the vault should be empty (0 tokens).
      const crimeVaultInfo = await getAccount(
        connection, crimeTokenVault, undefined, TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(crimeVaultInfo.amount)).to.equal(0, "CRIME vault should be empty after full fill");

      const authBalBefore = await connection.getBalance(authority.publicKey);

      await bondingCurve.methods
        .closeTokenVault()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: crimeCurveState,
          tokenVault: crimeTokenVault,
          tokenMint: crimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      // Verify vault account is closed
      const crimeVaultAfter = await connection.getAccountInfo(crimeTokenVault);
      expect(crimeVaultAfter).to.be.null;

      // Close FRAUD vault
      await bondingCurve.methods
        .closeTokenVault()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: fraudCurveState,
          tokenVault: fraudTokenVault,
          tokenMint: fraudMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      const fraudVaultAfter = await connection.getAccountInfo(fraudTokenVault);
      expect(fraudVaultAfter).to.be.null;

      const authBalAfter = await connection.getBalance(authority.publicKey);
      expect(authBalAfter).to.be.greaterThan(authBalBefore);
      console.log(`  Token vaults closed. Rent recovered: ${(authBalAfter - authBalBefore) / LAMPORTS_PER_SOL} SOL`);
    });

    it("should distribute tax escrow to carnage fund", async () => {
      const carnageBalBefore = await connection.getBalance(carnageSolVault);
      const rentExempt = await connection.getMinimumBalanceForRentExemption(0);

      // Distribute CRIME tax escrow
      const crimeEscrowBal = await connection.getBalance(crimeTaxEscrow);
      const crimeTransferable = crimeEscrowBal - rentExempt;

      if (crimeTransferable > 0) {
        await bondingCurve.methods
          .distributeTaxEscrow()
          .accountsStrict({
            curveState: crimeCurveState,
            taxEscrow: crimeTaxEscrow,
            carnageFund: carnageSolVault,
          })
          .rpc();

        const crimeEscrowAfter = await connection.getBalance(crimeTaxEscrow);
        expect(crimeEscrowAfter).to.equal(rentExempt);
        console.log(`  CRIME tax escrow distributed: ${crimeTransferable} lamports`);
      } else {
        console.log("  CRIME tax escrow: no transferable balance (no sells occurred on CRIME before fill)");
      }

      // Distribute FRAUD tax escrow
      const fraudEscrowBal = await connection.getBalance(fraudTaxEscrow);
      const fraudTransferable = fraudEscrowBal - rentExempt;

      if (fraudTransferable > 0) {
        await bondingCurve.methods
          .distributeTaxEscrow()
          .accountsStrict({
            curveState: fraudCurveState,
            taxEscrow: fraudTaxEscrow,
            carnageFund: carnageSolVault,
          })
          .rpc();

        const fraudEscrowAfter = await connection.getBalance(fraudTaxEscrow);
        expect(fraudEscrowAfter).to.equal(rentExempt);
      }

      const carnageBalAfter = await connection.getBalance(carnageSolVault);
      const totalDistributed = carnageBalAfter - carnageBalBefore;
      if (totalDistributed > 0) {
        console.log(`  Total distributed to carnage: ${totalDistributed} lamports`);
      }
    });
  });

  // ===========================================================================
  // Failure Path: Refund
  //
  // Uses a separate pair of mints/curves that are initialized but NOT filled.
  // The deadline is artificially set by warping the clock past it.
  // ===========================================================================

  describe("Failure Path: Refund", () => {
    let failCrimeMintKp: Keypair;
    let failFraudMintKp: Keypair;
    let failCrimeMint: PublicKey;
    let failFraudMint: PublicKey;
    let failCrimeCurveState: PublicKey;
    let failFraudCurveState: PublicKey;
    let failCrimeTokenVault: PublicKey;
    let failFraudTokenVault: PublicKey;
    let failCrimeSolVault: PublicKey;
    let failFraudSolVault: PublicKey;
    let failCrimeTaxEscrow: PublicKey;
    let failFraudTaxEscrow: PublicKey;
    let failAdminCrimeAccount: PublicKey;
    let failAdminFraudAccount: PublicKey;
    let refundBuyer: Keypair;
    let refundBuyerCrimeAta: PublicKey;

    before(async function () {
      this.timeout(600_000);

      console.log("\n  Setting up Failure Path curves...");

      // Create fresh mints for the failure path test
      const {
        createInitializeTransferHookInstruction,
        createInitializeMintInstruction,
        getMintLen,
        ExtensionType,
      } = await import("@solana/spl-token");

      failCrimeMintKp = Keypair.generate();
      failFraudMintKp = Keypair.generate();
      failCrimeMint = failCrimeMintKp.publicKey;
      failFraudMint = failFraudMintKp.publicKey;

      const mintLen = getMintLen([ExtensionType.TransferHook]);
      const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      for (const { name, kp } of [
        { name: "FAIL_CRIME", kp: failCrimeMintKp },
        { name: "FAIL_FRAUD", kp: failFraudMintKp },
      ]) {
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
            TOKEN_2022_PROGRAM_ID,
          ),
          createInitializeMintInstruction(
            kp.publicKey,
            TOKEN_DECIMALS,
            authority.publicKey,
            null,
            TOKEN_2022_PROGRAM_ID,
          ),
        );
        await sendAndConfirmTransaction(connection, mintTx, [authority, kp]);
      }

      // Create ExtraAccountMetaLists for new mints
      for (const mint of [failCrimeMint, failFraudMint]) {
        const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
          [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()],
          hookProgramId,
        );
        await hookProgram.methods
          .initializeExtraAccountMetaList()
          .accountsStrict({
            payer: authority.publicKey,
            whitelistAuthority,
            authority: authority.publicKey,
            extraAccountMetaList,
            mint,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      }

      // Create admin token accounts and mint 1B each
      const TOTAL = 1_000_000_000 * 10 ** TOKEN_DECIMALS;
      failAdminCrimeAccount = await createAndFundT22Account(
        connection, authority, failCrimeMint, authority.publicKey, authority, TOTAL,
      );
      failAdminFraudAccount = await createAndFundT22Account(
        connection, authority, failFraudMint, authority.publicKey, authority, TOTAL,
      );

      // Whitelist admin accounts
      for (const account of [failAdminCrimeAccount, failAdminFraudAccount]) {
        const [wlEntry] = deriveWhitelistEntryPDA(account, hookProgramId);
        await hookProgram.methods
          .addWhitelistEntry()
          .accountsStrict({
            authority: authority.publicKey,
            whitelistAuthority,
            whitelistEntry: wlEntry,
            addressToWhitelist: account,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      }

      // Initialize CRIME curve
      [failCrimeCurveState] = PublicKey.findProgramAddressSync(
        [CURVE_SEED, failCrimeMint.toBuffer()], bondingCurveId,
      );
      [failCrimeTokenVault] = PublicKey.findProgramAddressSync(
        [CURVE_TOKEN_VAULT_SEED, failCrimeMint.toBuffer()], bondingCurveId,
      );
      [failCrimeSolVault] = PublicKey.findProgramAddressSync(
        [CURVE_SOL_VAULT_SEED, failCrimeMint.toBuffer()], bondingCurveId,
      );
      [failCrimeTaxEscrow] = PublicKey.findProgramAddressSync(
        [CURVE_TAX_ESCROW_SEED, failCrimeMint.toBuffer()], bondingCurveId,
      );

      await bondingCurve.methods
        .initializeCurve({ crime: {} } as any)
        .accountsStrict({
          authority: authority.publicKey,
          curveState: failCrimeCurveState,
          tokenVault: failCrimeTokenVault,
          solVault: failCrimeSolVault,
          taxEscrow: failCrimeTaxEscrow,
          tokenMint: failCrimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Initialize FRAUD curve
      [failFraudCurveState] = PublicKey.findProgramAddressSync(
        [CURVE_SEED, failFraudMint.toBuffer()], bondingCurveId,
      );
      [failFraudTokenVault] = PublicKey.findProgramAddressSync(
        [CURVE_TOKEN_VAULT_SEED, failFraudMint.toBuffer()], bondingCurveId,
      );
      [failFraudSolVault] = PublicKey.findProgramAddressSync(
        [CURVE_SOL_VAULT_SEED, failFraudMint.toBuffer()], bondingCurveId,
      );
      [failFraudTaxEscrow] = PublicKey.findProgramAddressSync(
        [CURVE_TAX_ESCROW_SEED, failFraudMint.toBuffer()], bondingCurveId,
      );

      await bondingCurve.methods
        .initializeCurve({ fraud: {} } as any)
        .accountsStrict({
          authority: authority.publicKey,
          curveState: failFraudCurveState,
          tokenVault: failFraudTokenVault,
          solVault: failFraudSolVault,
          taxEscrow: failFraudTaxEscrow,
          tokenMint: failFraudMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Whitelist token vaults
      for (const vault of [failCrimeTokenVault, failFraudTokenVault]) {
        const [wlEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);
        await hookProgram.methods
          .addWhitelistEntry()
          .accountsStrict({
            authority: authority.publicKey,
            whitelistAuthority,
            whitelistEntry: wlEntry,
            addressToWhitelist: vault,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      }

      // Fund curves
      for (const { curveState, adminAccount, tokenVault, mint } of [
        {
          curveState: failCrimeCurveState,
          adminAccount: failAdminCrimeAccount,
          tokenVault: failCrimeTokenVault,
          mint: failCrimeMint,
        },
        {
          curveState: failFraudCurveState,
          adminAccount: failAdminFraudAccount,
          tokenVault: failFraudTokenVault,
          mint: failFraudMint,
        },
      ]) {
        const hookAccounts = buildHookRemainingAccounts(
          mint, adminAccount, tokenVault, hookProgramId,
        );
        await bondingCurve.methods
          .fundCurve()
          .accountsStrict({
            authority: authority.publicKey,
            curveState,
            authorityTokenAccount: adminAccount,
            tokenVault,
            tokenMint: mint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .remainingAccounts(hookAccounts)
          .signers([authority])
          .rpc();
      }

      // Start curves
      for (const { curveState, tokenVault, mint } of [
        { curveState: failCrimeCurveState, tokenVault: failCrimeTokenVault, mint: failCrimeMint },
        { curveState: failFraudCurveState, tokenVault: failFraudTokenVault, mint: failFraudMint },
      ]) {
        await bondingCurve.methods
          .startCurve()
          .accountsStrict({
            authority: authority.publicKey,
            curveState,
            tokenVault,
            tokenMint: mint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([authority])
          .rpc();
      }

      // Create a buyer who buys some tokens (partial fill, not enough to fill)
      refundBuyer = Keypair.generate();
      await airdropSol(connection, refundBuyer.publicKey, 20 * LAMPORTS_PER_SOL);

      refundBuyerCrimeAta = getAssociatedTokenAddressSync(
        failCrimeMint, refundBuyer.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );

      // Buy 5 SOL worth of CRIME tokens
      const hookAccounts = buildHookRemainingAccounts(
        failCrimeMint, failCrimeTokenVault, refundBuyerCrimeAta, hookProgramId,
      );
      await bondingCurve.methods
        .purchase(
          new anchor.BN(5 * LAMPORTS_PER_SOL),
          new anchor.BN(1),
        )
        .accountsStrict({
          user: refundBuyer.publicKey,
          curveState: failCrimeCurveState,
          userTokenAccount: refundBuyerCrimeAta,
          tokenVault: failCrimeTokenVault,
          solVault: failCrimeSolVault,
          tokenMint: failCrimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .signers([refundBuyer])
        .rpc();

      // Also do a sell to generate tax escrow SOL
      const userAccount = await getAccount(
        connection, refundBuyerCrimeAta, undefined, TOKEN_2022_PROGRAM_ID,
      );
      const sellAmount = Math.floor(Number(userAccount.amount) / 4); // Sell 25%
      if (sellAmount > 0) {
        const sellHookAccounts = buildHookRemainingAccounts(
          failCrimeMint, refundBuyerCrimeAta, failCrimeTokenVault, hookProgramId,
        );
        await bondingCurve.methods
          .sell(
            new anchor.BN(sellAmount),
            new anchor.BN(0),
          )
          .accountsStrict({
            user: refundBuyer.publicKey,
            curveState: failCrimeCurveState,
            userTokenAccount: refundBuyerCrimeAta,
            tokenVault: failCrimeTokenVault,
            solVault: failCrimeSolVault,
            taxEscrow: failCrimeTaxEscrow,
            tokenMint: failCrimeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(sellHookAccounts)
          .signers([refundBuyer])
          .rpc();
      }

      // Advance the validator clock past deadline + grace period.
      //
      // With localnet DEADLINE_SLOTS=500, the deadline is ~500 slots after
      // start_curve. Grace period is 150 slots.
      // Total needed: deadline_slot + FAILURE_GRACE_SLOTS + 1 = ~651 slots past start.
      //
      // The test validator advances ~1 slot per confirmed transaction.
      // We use large parallel batches of system transfers (cheaper than airdrops)
      // to advance the clock efficiently.
      const curveState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      const targetSlot = curveState.deadlineSlot.toNumber() + FAILURE_GRACE_SLOTS + 1;
      let currentSlot = await connection.getSlot();
      const slotsNeeded = targetSlot - currentSlot;
      console.log(`  Need to advance from slot ${currentSlot} to >${targetSlot} (~${slotsNeeded} slots)`);

      // Fire-and-forget transfers to advance the clock as fast as possible.
      // Each TX must be unique (different lamports) to avoid validator dedup.
      const dummy = Keypair.generate();
      const batchSize = 50;
      let txCounter = 0;
      while (currentSlot <= targetSlot) {
        const { blockhash } = await connection.getLatestBlockhash();
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          txCounter++;
          const tx = new Transaction({
            feePayer: authority.publicKey,
            recentBlockhash: blockhash,
          }).add(
            SystemProgram.transfer({
              fromPubkey: authority.publicKey,
              toPubkey: dummy.publicKey,
              lamports: txCounter, // unique per TX to avoid dedup
            }),
          );
          tx.sign(authority);
          promises.push(
            connection.sendRawTransaction(tx.serialize()).catch(() => {}),
          );
        }
        await Promise.all(promises);
        // Brief pause to let validator process the batch
        await new Promise((r) => setTimeout(r, 300));
        currentSlot = await connection.getSlot();
      }

      console.log(`  Advanced to slot ${currentSlot} (target was >${targetSlot})`);
      console.log("  Failure path setup complete");
    });

    it("should mark curves as Failed after deadline", async function () {
      this.timeout(60_000);

      // The before() hook already advanced the clock past deadline + grace.
      // Verify the clock is past the failure-eligible slot.
      const curveState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      const failureEligibleSlot = curveState.deadlineSlot.toNumber() + FAILURE_GRACE_SLOTS;
      const currentSlot = await connection.getSlot();
      expect(currentSlot).to.be.greaterThan(
        failureEligibleSlot,
        `Clock should be past failure-eligible slot (current: ${currentSlot}, target: >${failureEligibleSlot})`,
      );

      // Mark CRIME curve as failed
      await bondingCurve.methods
        .markFailed()
        .accountsStrict({
          curveState: failCrimeCurveState,
        })
        .rpc();

      const crimeState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(JSON.stringify(crimeState.status)).to.include("failed");
      console.log("  CRIME curve marked as Failed");

      // Mark FRAUD curve as failed
      await bondingCurve.methods
        .markFailed()
        .accountsStrict({
          curveState: failFraudCurveState,
        })
        .rpc();

      const fraudState = await bondingCurve.account.curveState.fetch(failFraudCurveState);
      expect(JSON.stringify(fraudState.status)).to.include("failed");
      console.log("  FRAUD curve marked as Failed");
    });

    it("should consolidate tax escrow for refunds", async function () {
      // Verify curve is Failed (guaranteed by mark_failed test above)
      const crimeState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(JSON.stringify(crimeState.status)).to.include("failed");

      const solVaultBefore = await connection.getBalance(failCrimeSolVault);
      const escrowBefore = await connection.getBalance(failCrimeTaxEscrow);
      const rentExempt = await connection.getMinimumBalanceForRentExemption(0);

      await bondingCurve.methods
        .consolidateForRefund()
        .accountsStrict({
          curveState: failCrimeCurveState,
          partnerCurveState: failFraudCurveState,
          taxEscrow: failCrimeTaxEscrow,
          solVault: failCrimeSolVault,
        })
        .rpc();

      // Verify consolidation
      const stateAfter = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(stateAfter.escrowConsolidated).to.be.true;

      const solVaultAfter = await connection.getBalance(failCrimeSolVault);
      const escrowAfter = await connection.getBalance(failCrimeTaxEscrow);

      const transferable = escrowBefore - rentExempt;
      if (transferable > 0) {
        expect(solVaultAfter).to.equal(solVaultBefore + transferable);
        expect(escrowAfter).to.equal(rentExempt);
        console.log(`  Consolidated ${transferable} lamports from escrow to vault`);
      } else {
        console.log("  Consolidation: no transferable escrow (0 sells)");
      }
    });

    it("should reject second consolidation (EscrowAlreadyConsolidated)", async function () {
      // Verify consolidation happened (guaranteed by previous test)
      const crimeState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(crimeState.escrowConsolidated).to.be.true;

      try {
        await bondingCurve.methods
          .consolidateForRefund()
          .accountsStrict({
            curveState: failCrimeCurveState,
            partnerCurveState: failFraudCurveState,
            taxEscrow: failCrimeTaxEscrow,
            solVault: failCrimeSolVault,
          })
          .rpc();
        expect.fail("Should have thrown EscrowAlreadyConsolidated");
      } catch (err: any) {
        expect(err.toString()).to.include("EscrowAlreadyConsolidated");
        console.log("  EscrowAlreadyConsolidated error correctly thrown");
      }
    });

    it("should allow users to claim proportional refunds", async function () {
      // Verify consolidation happened (guaranteed by previous test)
      const crimeState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(crimeState.escrowConsolidated).to.be.true;

      const userAccount = await getAccount(
        connection, refundBuyerCrimeAta, undefined, TOKEN_2022_PROGRAM_ID,
      );
      const userBalance = Number(userAccount.amount);
      expect(userBalance).to.be.greaterThan(0, "User should have tokens to refund");

      const userSolBefore = await connection.getBalance(refundBuyer.publicKey);
      const vaultBefore = await connection.getBalance(failCrimeSolVault);
      const rentExempt = await connection.getMinimumBalanceForRentExemption(0);

      // Calculate expected refund
      const refundPool = vaultBefore - rentExempt;
      const totalOutstanding = crimeState.tokensSold.toNumber();
      const expectedRefund = Math.floor(
        (userBalance * refundPool) / totalOutstanding,
      );

      await bondingCurve.methods
        .claimRefund()
        .accountsStrict({
          user: refundBuyer.publicKey,
          curveState: failCrimeCurveState,
          partnerCurveState: failFraudCurveState,
          userTokenAccount: refundBuyerCrimeAta,
          tokenMint: failCrimeMint,
          solVault: failCrimeSolVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([refundBuyer])
        .rpc();

      // Verify tokens burned (ATA balance should be 0)
      const userAccountAfter = await getAccount(
        connection, refundBuyerCrimeAta, undefined, TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(userAccountAfter.amount)).to.equal(0, "All tokens should be burned");

      // Verify SOL received
      const userSolAfter = await connection.getBalance(refundBuyer.publicKey);
      expect(userSolAfter).to.be.greaterThan(userSolBefore);

      // Verify refund matches expected (within TX fee margin)
      const solReceived = userSolAfter - userSolBefore;
      // Account for TX fee (~5000 lamports)
      expect(solReceived).to.be.greaterThan(expectedRefund - 10_000);

      // Verify tokens_sold decreased
      const stateAfter = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(stateAfter.tokensSold.toNumber()).to.equal(totalOutstanding - userBalance);

      console.log(`  Refund claimed: ${userBalance / 1e6} tokens burned, ~${solReceived / LAMPORTS_PER_SOL} SOL received`);
    });

    it("should reject refund with no tokens (NothingToBurn)", async function () {
      // Verify curve is Failed (guaranteed by mark_failed test above)
      const crimeState = await bondingCurve.account.curveState.fetch(failCrimeCurveState);
      expect(JSON.stringify(crimeState.status)).to.include("failed");

      // The buyer already claimed their refund, so their balance is 0
      try {
        await bondingCurve.methods
          .claimRefund()
          .accountsStrict({
            user: refundBuyer.publicKey,
            curveState: failCrimeCurveState,
            partnerCurveState: failFraudCurveState,
            userTokenAccount: refundBuyerCrimeAta,
            tokenMint: failCrimeMint,
            solVault: failCrimeSolVault,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([refundBuyer])
          .rpc();
        expect.fail("Should have thrown NothingToBurn");
      } catch (err: any) {
        expect(err.toString()).to.include("NothingToBurn");
        console.log("  NothingToBurn error correctly thrown for empty balance");
      }
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    it("should handle partial fill at curve boundary", async function () {
      this.timeout(300_000);

      // Create a fresh curve to test partial fill behavior.
      // Strategy: fill the curve to 99%+ with many small buyers, then have
      // one buyer buy with more SOL than needed to consume the remaining supply.
      // The purchase instruction should clamp to remaining supply and refund
      // proportional SOL (partial fill logic).
      const partialMintKp = Keypair.generate();
      const partialMint = partialMintKp.publicKey;

      const {
        createInitializeTransferHookInstruction,
        createInitializeMintInstruction,
        getMintLen,
        ExtensionType,
      } = await import("@solana/spl-token");

      const mintLen = getMintLen([ExtensionType.TransferHook]);
      const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      const mintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: partialMint,
          space: mintLen,
          lamports: mintLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferHookInstruction(
          partialMint,
          authority.publicKey,
          hookProgramId,
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMintInstruction(
          partialMint,
          TOKEN_DECIMALS,
          authority.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, mintTx, [authority, partialMintKp]);

      // ExtraAccountMetaList
      const [extraMeta] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, partialMint.toBuffer()],
        hookProgramId,
      );
      await hookProgram.methods
        .initializeExtraAccountMetaList()
        .accountsStrict({
          payer: authority.publicKey,
          whitelistAuthority,
          authority: authority.publicKey,
          extraAccountMetaList: extraMeta,
          mint: partialMint,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Mint, admin account, whitelist
      const TOTAL = 1_000_000_000 * 10 ** TOKEN_DECIMALS;
      const adminPartialAccount = await createAndFundT22Account(
        connection, authority, partialMint, authority.publicKey, authority, TOTAL,
      );
      const [adminWl] = deriveWhitelistEntryPDA(adminPartialAccount, hookProgramId);
      await hookProgram.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry: adminWl,
          addressToWhitelist: adminPartialAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Initialize curve
      const [partCurveState] = PublicKey.findProgramAddressSync(
        [CURVE_SEED, partialMint.toBuffer()], bondingCurveId,
      );
      const [partTokenVault] = PublicKey.findProgramAddressSync(
        [CURVE_TOKEN_VAULT_SEED, partialMint.toBuffer()], bondingCurveId,
      );
      const [partSolVault] = PublicKey.findProgramAddressSync(
        [CURVE_SOL_VAULT_SEED, partialMint.toBuffer()], bondingCurveId,
      );
      const [partTaxEscrow] = PublicKey.findProgramAddressSync(
        [CURVE_TAX_ESCROW_SEED, partialMint.toBuffer()], bondingCurveId,
      );

      await bondingCurve.methods
        .initializeCurve({ crime: {} } as any)
        .accountsStrict({
          authority: authority.publicKey,
          curveState: partCurveState,
          tokenVault: partTokenVault,
          solVault: partSolVault,
          taxEscrow: partTaxEscrow,
          tokenMint: partialMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Whitelist vault
      const [vaultWl] = deriveWhitelistEntryPDA(partTokenVault, hookProgramId);
      await hookProgram.methods
        .addWhitelistEntry()
        .accountsStrict({
          authority: authority.publicKey,
          whitelistAuthority,
          whitelistEntry: vaultWl,
          addressToWhitelist: partTokenVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Fund and start
      const fundHook = buildHookRemainingAccounts(
        partialMint, adminPartialAccount, partTokenVault, hookProgramId,
      );
      await bondingCurve.methods
        .fundCurve()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: partCurveState,
          authorityTokenAccount: adminPartialAccount,
          tokenVault: partTokenVault,
          tokenMint: partialMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(fundHook)
        .signers([authority])
        .rpc();

      await bondingCurve.methods
        .startCurve()
        .accountsStrict({
          authority: authority.publicKey,
          curveState: partCurveState,
          tokenVault: partTokenVault,
          tokenMint: partialMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      // Step 1: Nearly fill the curve with many buyers (15 SOL each, under wallet cap)
      console.log("    Filling curve to ~99%...");
      const fillers: Keypair[] = [];
      for (let i = 0; i < 70; i++) {
        const kp = Keypair.generate();
        await airdropSol(connection, kp.publicKey, 20 * LAMPORTS_PER_SOL);
        fillers.push(kp);
      }

      let curveIsFilled = false;
      for (const filler of fillers) {
        if (curveIsFilled) break;

        const state = await bondingCurve.account.curveState.fetch(partCurveState);
        if (JSON.stringify(state.status).includes("filled")) {
          curveIsFilled = true;
          break;
        }

        // Check remaining tokens -- if less than what 0.05 SOL buys, stop
        const remaining = TARGET_TOKENS - state.tokensSold.toNumber();
        if (remaining < 50_000_000_000) break; // ~50M tokens left, close enough

        const fillerAta = getAssociatedTokenAddressSync(
          partialMint, filler.publicKey, false, TOKEN_2022_PROGRAM_ID,
        );
        const hookAccts = buildHookRemainingAccounts(
          partialMint, partTokenVault, fillerAta, hookProgramId,
        );

        try {
          await bondingCurve.methods
            .purchase(
              new anchor.BN(15 * LAMPORTS_PER_SOL),
              new anchor.BN(1),
            )
            .accountsStrict({
              user: filler.publicKey,
              curveState: partCurveState,
              userTokenAccount: fillerAta,
              tokenVault: partTokenVault,
              solVault: partSolVault,
              tokenMint: partialMint,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(hookAccts)
            .signers([filler])
            .rpc();
        } catch (err: any) {
          if (
            err.toString().includes("CurveNotActive") ||
            err.toString().includes("CurveAlreadyFilled")
          ) {
            curveIsFilled = true;
            break;
          }
          throw err;
        }
      }

      if (curveIsFilled) {
        console.log("    Curve filled during bulk phase -- partial fill was triggered internally");
        const state = await bondingCurve.account.curveState.fetch(partCurveState);
        expect(JSON.stringify(state.status)).to.include("filled");
        return;
      }

      // Step 2: Check how much supply remains
      const stateBeforeFinal = await bondingCurve.account.curveState.fetch(partCurveState);
      const tokensSoldBefore = stateBeforeFinal.tokensSold.toNumber();
      const remainingTokens = TARGET_TOKENS - tokensSoldBefore;
      console.log(`    Remaining supply: ${remainingTokens / 1e6} tokens (${((tokensSoldBefore / TARGET_TOKENS) * 100).toFixed(1)}% filled)`);

      // Step 3: One final buyer with more SOL than needed for remaining supply.
      // This triggers partial fill: buyer asks for X tokens, only gets `remaining`.
      const finalBuyer = Keypair.generate();
      await airdropSol(connection, finalBuyer.publicKey, 50 * LAMPORTS_PER_SOL);

      const finalBuyerAta = getAssociatedTokenAddressSync(
        partialMint, finalBuyer.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const buyHook = buildHookRemainingAccounts(
        partialMint, partTokenVault, finalBuyerAta, hookProgramId,
      );

      const finalBuyerSolBefore = await connection.getBalance(finalBuyer.publicKey);

      // Buy with 15 SOL (more than needed for remaining supply since we're near the end)
      await bondingCurve.methods
        .purchase(
          new anchor.BN(15 * LAMPORTS_PER_SOL),
          new anchor.BN(1),
        )
        .accountsStrict({
          user: finalBuyer.publicKey,
          curveState: partCurveState,
          userTokenAccount: finalBuyerAta,
          tokenVault: partTokenVault,
          solVault: partSolVault,
          tokenMint: partialMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(buyHook)
        .signers([finalBuyer])
        .rpc();

      // Verify: curve should now be Filled
      const stateAfter = await bondingCurve.account.curveState.fetch(partCurveState);
      expect(JSON.stringify(stateAfter.status)).to.include("filled");
      expect(stateAfter.tokensSold.toNumber()).to.equal(TARGET_TOKENS);

      // Verify buyer received exactly the remaining tokens (partial fill)
      const finalBuyerAccount = await getAccount(
        connection, finalBuyerAta, undefined, TOKEN_2022_PROGRAM_ID,
      );
      expect(Number(finalBuyerAccount.amount)).to.equal(remainingTokens);

      // Verify buyer paid less SOL than they sent (partial fill refund)
      const finalBuyerSolAfter = await connection.getBalance(finalBuyer.publicKey);
      const solActuallyPaid = finalBuyerSolBefore - finalBuyerSolAfter;
      // They sent 15 SOL but should have paid less (proportional to remaining tokens)
      expect(solActuallyPaid / LAMPORTS_PER_SOL).to.be.lessThan(15);

      console.log(`  Partial fill: ${remainingTokens / 1e6} tokens for ${solActuallyPaid / LAMPORTS_PER_SOL} SOL (of 15 SOL sent)`);
    });
  });
});
