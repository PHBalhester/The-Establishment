/**
 * Pathway 1 Test: Bonding Curve Failure Path (Buy/Sell/Expire/Refund)
 *
 * This script automates the complete Pathway 1 lifecycle:
 * 1. Setup: Fund 5 test wallets with SOL
 * 2. Buy: Execute varied purchases on CRIME and FRAUD curves
 * 3. Sell: Partial sell on one wallet (exercises tax escrow)
 * 4. Wait: Poll until deadline + FAILURE_GRACE_SLOTS + safety margin
 * 5. Mark failed: Transition both curves to Failed status
 * 6. Consolidate: Move tax escrow SOL into sol_vault
 * 7. Snapshot: Record pre-claim balances
 * 8. Claim: Execute claim_refund for all token holders
 * 9. Output: Write structured JSON log for verify-refunds.ts
 *
 * Usage:
 *   source .env.devnet
 *   npx tsx scripts/test/pathway1-test.ts
 *
 * Reads deployment addresses from deployments/devnet.json.
 * Requires CLUSTER_URL and WALLET env vars (or defaults).
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

import { BondingCurve } from "../../target/types/bonding_curve";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_DECIMALS = 6;
const FAILURE_GRACE_SLOTS = 150;
const SAFETY_MARGIN_SLOTS = 10;
const POLL_INTERVAL_MS = 10_000; // 10 seconds

// PDA seeds (must match on-chain constants.rs)
const CURVE_SEED = Buffer.from("curve");
const CURVE_TOKEN_VAULT_SEED = Buffer.from("curve_token_vault");
const CURVE_SOL_VAULT_SEED = Buffer.from("curve_sol_vault");
const TAX_ESCROW_SEED = Buffer.from("tax_escrow");
const EXTRA_ACCOUNT_META_SEED = Buffer.from("extra-account-metas");
const WHITELIST_SEED = Buffer.from("whitelist");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeploymentConfig {
  programs: { transferHook: string; bondingCurve: string };
  mints: { crime: string; fraud: string };
  curvePdas: {
    crime: { curveState: string; tokenVault: string; solVault: string; taxEscrow: string };
    fraud: { curveState: string; tokenVault: string; solVault: string; taxEscrow: string };
  };
}

interface ActionLog {
  wallet: string;
  walletIndex: number;
  curve: "CRIME" | "FRAUD";
  action: "buy" | "sell";
  solAmount?: number;
  tokenAmount?: number;
  solReceived?: number;
  txSig: string;
  slot: number;
}

interface WalletSnapshot {
  wallet: string;
  walletIndex: number;
  solBalance: number;
  crimeBalance: number;
  fraudBalance: number;
}

interface CurveSnapshot {
  curve: "CRIME" | "FRAUD";
  tokensSold: number;
  solRaised: number;
  taxCollected: number;
  escrowConsolidated: boolean;
  refundPoolLamports: number;
  totalOutstandingTokens: number;
  solVaultBalance: number;
}

interface Pathway1Log {
  timestamp: string;
  deployment: DeploymentConfig;
  actions: ActionLog[];
  preClaim: WalletSnapshot[];
  curveSnapshots: CurveSnapshot[];
  postClaim: WalletSnapshot[];
  claimActions: { wallet: string; walletIndex: number; curve: string; txSig: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDeployment(): DeploymentConfig {
  const deployPath = path.resolve(process.cwd(), "deployments/devnet.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error(`Deployment config not found: ${deployPath}`);
  }
  return JSON.parse(fs.readFileSync(deployPath, "utf8"));
}

function loadWalletKeypair(): Keypair {
  const walletPath = process.env.WALLET || "keypairs/devnet-wallet.json";
  const resolved = path.isAbsolute(walletPath)
    ? walletPath
    : path.resolve(process.cwd(), walletPath);
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

/**
 * Derive the 4 Transfer Hook remaining_accounts for a token transfer.
 */
function getHookAccounts(
  hookProgramId: PublicKey,
  mint: PublicKey,
  source: PublicKey,
  destination: PublicKey,
): anchor.web3.AccountMeta[] {
  const [metaList] = PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()],
    hookProgramId,
  );
  const [wlSource] = PublicKey.findProgramAddressSync(
    [WHITELIST_SEED, source.toBuffer()],
    hookProgramId,
  );
  const [wlDest] = PublicKey.findProgramAddressSync(
    [WHITELIST_SEED, destination.toBuffer()],
    hookProgramId,
  );
  return [
    { pubkey: metaList, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: hookProgramId, isSigner: false, isWritable: false },
  ];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Pathway 1 Test: Bonding Curve Failure Path ===\n");

  // Load config
  const deployment = loadDeployment();
  const funder = loadWalletKeypair();
  const clusterUrl = process.env.CLUSTER_URL || "https://api.devnet.solana.com";
  const connection = new Connection(clusterUrl, "confirmed");

  // Load bonding curve program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(funder),
    { preflightCommitment: "confirmed", commitment: "confirmed" },
  );
  const idlPath = path.resolve(process.cwd(), "target/idl/bonding_curve.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const bondingCurve = new anchor.Program<BondingCurve>(idl, provider);

  // Key addresses
  const hookProgramId = new PublicKey(deployment.programs.transferHook);
  const crimeMint = new PublicKey(deployment.mints.crime);
  const fraudMint = new PublicKey(deployment.mints.fraud);

  const curvePdas = {
    crime: {
      curveState: new PublicKey(deployment.curvePdas.crime.curveState),
      tokenVault: new PublicKey(deployment.curvePdas.crime.tokenVault),
      solVault: new PublicKey(deployment.curvePdas.crime.solVault),
      taxEscrow: new PublicKey(deployment.curvePdas.crime.taxEscrow),
    },
    fraud: {
      curveState: new PublicKey(deployment.curvePdas.fraud.curveState),
      tokenVault: new PublicKey(deployment.curvePdas.fraud.tokenVault),
      solVault: new PublicKey(deployment.curvePdas.fraud.solVault),
      taxEscrow: new PublicKey(deployment.curvePdas.fraud.taxEscrow),
    },
  };

  // Check funder balance
  const funderBalance = await connection.getBalance(funder.publicKey);
  console.log(`Funder: ${funder.publicKey.toBase58()}`);
  console.log(`Balance: ${lamportsToSol(funderBalance)} SOL`);
  if (funderBalance < 3 * LAMPORTS_PER_SOL) {
    throw new Error("Funder needs at least 3 SOL for test (5 wallets + gas)");
  }

  // =========================================================================
  // Phase 1: Setup -- Generate and fund 5 test wallets
  // =========================================================================
  console.log("\n--- Phase 1: Setup (Generate + Fund Test Wallets) ---\n");

  const testWallets: Keypair[] = [];
  for (let i = 0; i < 5; i++) {
    testWallets.push(Keypair.generate());
  }

  // Fund each wallet with 0.5 SOL
  const FUND_AMOUNT = 0.5 * LAMPORTS_PER_SOL;
  for (let i = 0; i < testWallets.length; i++) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: testWallets[i].publicKey,
        lamports: FUND_AMOUNT,
      }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [funder]);
    console.log(`  Wallet ${i + 1}: ${testWallets[i].publicKey.toBase58()} funded with 0.5 SOL (${sig.slice(0, 8)}...)`);
  }

  // Create ATAs for all test wallets (both CRIME and FRAUD)
  console.log("\n  Creating Token-2022 ATAs...");
  for (let i = 0; i < testWallets.length; i++) {
    for (const { mint, label } of [
      { mint: crimeMint, label: "CRIME" },
      { mint: fraudMint, label: "FRAUD" },
    ]) {
      const ata = getAssociatedTokenAddressSync(
        mint,
        testWallets[i].publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );
      // Check if ATA already exists
      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            funder.publicKey,
            ata,
            testWallets[i].publicKey,
            mint,
            TOKEN_2022_PROGRAM_ID,
          ),
        );
        await sendAndConfirmTransaction(connection, tx, [funder]);
        console.log(`    Wallet ${i + 1} ${label} ATA: ${ata.toBase58()}`);
      }
    }
  }

  // =========================================================================
  // Phase 2: Buy tokens on curves
  // =========================================================================
  console.log("\n--- Phase 2: Buy Tokens ---\n");

  const actions: ActionLog[] = [];

  // Buy plan:
  // Wallet 1: Buy CRIME 0.003 SOL (minimum buy test)
  // Wallet 2: Buy CRIME 0.05 SOL (medium buy)
  // Wallet 3: Buy FRAUD 0.1 SOL (larger buy)
  // Wallet 4: Buy CRIME 0.02 SOL AND Buy FRAUD 0.02 SOL (both curves)
  // Wallet 5: Buy FRAUD 0.05 SOL (for sell-then-refund test)

  const buyPlan: { walletIndex: number; curve: "CRIME" | "FRAUD"; solAmount: number }[] = [
    { walletIndex: 0, curve: "CRIME", solAmount: 0.003 * LAMPORTS_PER_SOL },
    { walletIndex: 1, curve: "CRIME", solAmount: 0.05 * LAMPORTS_PER_SOL },
    { walletIndex: 2, curve: "FRAUD", solAmount: 0.1 * LAMPORTS_PER_SOL },
    { walletIndex: 3, curve: "CRIME", solAmount: 0.02 * LAMPORTS_PER_SOL },
    { walletIndex: 3, curve: "FRAUD", solAmount: 0.02 * LAMPORTS_PER_SOL },
    { walletIndex: 4, curve: "FRAUD", solAmount: 0.05 * LAMPORTS_PER_SOL },
  ];

  for (const buy of buyPlan) {
    const wallet = testWallets[buy.walletIndex];
    const mint = buy.curve === "CRIME" ? crimeMint : fraudMint;
    const pdas = buy.curve === "CRIME" ? curvePdas.crime : curvePdas.fraud;

    const userAta = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Derive hook accounts: purchase is vault -> user (source=vault, dest=userAta)
    const hookAccounts = getHookAccounts(hookProgramId, mint, pdas.tokenVault, userAta);

    try {
      const sig = await bondingCurve.methods
        .purchase(new anchor.BN(buy.solAmount), new anchor.BN(0)) // 0 minimum_tokens_out (accept any)
        .accountsStrict({
          user: wallet.publicKey,
          curveState: pdas.curveState,
          userTokenAccount: userAta,
          tokenVault: pdas.tokenVault,
          solVault: pdas.solVault,
          tokenMint: mint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .signers([wallet])
        .rpc();

      const txInfo = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const slot = txInfo?.slot || 0;

      console.log(`  Wallet ${buy.walletIndex + 1}: Buy ${buy.curve} with ${lamportsToSol(buy.solAmount)} SOL -> ${sig.slice(0, 8)}... (slot ${slot})`);

      actions.push({
        wallet: wallet.publicKey.toBase58(),
        walletIndex: buy.walletIndex,
        curve: buy.curve,
        action: "buy",
        solAmount: buy.solAmount,
        txSig: sig,
        slot,
      });
    } catch (err: any) {
      console.error(`  Wallet ${buy.walletIndex + 1}: Buy ${buy.curve} FAILED: ${err.message}`);
      // Log failure but continue
      actions.push({
        wallet: wallet.publicKey.toBase58(),
        walletIndex: buy.walletIndex,
        curve: buy.curve,
        action: "buy",
        solAmount: buy.solAmount,
        txSig: `FAILED: ${err.message}`,
        slot: 0,
      });
    }

    // Small delay between TXs to avoid rate limiting
    await sleep(1000);
  }

  // =========================================================================
  // Phase 3: Sell phase (Wallet 5 sells ~50% of FRAUD tokens)
  // =========================================================================
  console.log("\n--- Phase 3: Partial Sell (Wallet 5) ---\n");

  {
    const wallet = testWallets[4];
    const mint = fraudMint;
    const pdas = curvePdas.fraud;

    const userAta = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Read current token balance
    const ataInfo = await connection.getTokenAccountBalance(userAta);
    const tokenBalance = Number(ataInfo.value.amount);
    const sellAmount = Math.floor(tokenBalance / 2); // ~50%

    if (sellAmount > 0) {
      // Sell: hook accounts are user -> vault (source=userAta, dest=tokenVault)
      const hookAccounts = getHookAccounts(hookProgramId, mint, userAta, pdas.tokenVault);

      try {
        const sig = await bondingCurve.methods
          .sell(new anchor.BN(sellAmount), new anchor.BN(0)) // 0 minimum_sol_out
          .accountsStrict({
            user: wallet.publicKey,
            curveState: pdas.curveState,
            userTokenAccount: userAta,
            tokenVault: pdas.tokenVault,
            solVault: pdas.solVault,
            taxEscrow: pdas.taxEscrow,
            tokenMint: mint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(hookAccounts)
          .signers([wallet])
          .rpc();

        const txInfo = await connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const slot = txInfo?.slot || 0;

        console.log(`  Wallet 5: Sell ${sellAmount} FRAUD tokens (~50%) -> ${sig.slice(0, 8)}... (slot ${slot})`);

        actions.push({
          wallet: wallet.publicKey.toBase58(),
          walletIndex: 4,
          curve: "FRAUD",
          action: "sell",
          tokenAmount: sellAmount,
          txSig: sig,
          slot,
        });
      } catch (err: any) {
        console.error(`  Wallet 5: Sell FRAUD FAILED: ${err.message}`);
      }
    } else {
      console.log("  Wallet 5: No FRAUD tokens to sell (buy may have failed)");
    }
  }

  // =========================================================================
  // Phase 4: Wait for deadline to pass
  // =========================================================================
  console.log("\n--- Phase 4: Wait for Deadline ---\n");

  // Read deadline_slot from CRIME curve (both curves have same deadline)
  const crimeCurveData = await bondingCurve.account.curveState.fetch(
    curvePdas.crime.curveState,
  );
  const deadlineSlot = crimeCurveData.deadlineSlot.toNumber();
  const targetSlot = deadlineSlot + FAILURE_GRACE_SLOTS + SAFETY_MARGIN_SLOTS;

  console.log(`  Deadline slot:      ${deadlineSlot}`);
  console.log(`  Grace slots:        ${FAILURE_GRACE_SLOTS}`);
  console.log(`  Target slot:        ${targetSlot}`);

  let currentSlot = await connection.getSlot();
  console.log(`  Current slot:       ${currentSlot}`);

  while (currentSlot < targetSlot) {
    const remaining = targetSlot - currentSlot;
    const estimatedSeconds = Math.ceil(remaining * 0.4);
    const minutes = Math.floor(estimatedSeconds / 60);
    const seconds = estimatedSeconds % 60;
    console.log(`  Waiting... ${remaining} slots remaining (~${minutes}m ${seconds}s)`);
    await sleep(POLL_INTERVAL_MS);
    currentSlot = await connection.getSlot();
  }

  console.log(`  Deadline passed! Current slot: ${currentSlot}`);

  // =========================================================================
  // Phase 5: Mark both curves as Failed
  // =========================================================================
  console.log("\n--- Phase 5: Mark Failed ---\n");

  for (const { curve, pdas: p } of [
    { curve: "CRIME", pdas: curvePdas.crime },
    { curve: "FRAUD", pdas: curvePdas.fraud },
  ]) {
    try {
      const sig = await bondingCurve.methods
        .markFailed()
        .accountsStrict({
          curveState: p.curveState,
        })
        .rpc();
      console.log(`  ${curve}: Marked failed -> ${sig.slice(0, 8)}...`);
    } catch (err: any) {
      // May already be failed
      console.log(`  ${curve}: mark_failed result: ${err.message}`);
    }
  }

  // Verify both are Failed
  for (const { curve, pdas: p } of [
    { curve: "CRIME", pdas: curvePdas.crime },
    { curve: "FRAUD", pdas: curvePdas.fraud },
  ]) {
    const curveData = await bondingCurve.account.curveState.fetch(p.curveState);
    const status = Object.keys(curveData.status)[0];
    console.log(`  ${curve} status: ${status}`);
    if (status !== "failed") {
      throw new Error(`${curve} curve is not Failed! Status: ${status}`);
    }
  }

  // =========================================================================
  // Phase 6: Consolidate tax escrow into sol_vault
  // =========================================================================
  console.log("\n--- Phase 6: Consolidate for Refund ---\n");

  // CRIME consolidation (partner = FRAUD)
  try {
    const sig = await bondingCurve.methods
      .consolidateForRefund()
      .accountsStrict({
        curveState: curvePdas.crime.curveState,
        partnerCurveState: curvePdas.fraud.curveState,
        taxEscrow: curvePdas.crime.taxEscrow,
        solVault: curvePdas.crime.solVault,
      })
      .rpc();
    console.log(`  CRIME: Consolidated -> ${sig.slice(0, 8)}...`);
  } catch (err: any) {
    console.log(`  CRIME: consolidate result: ${err.message}`);
  }

  // FRAUD consolidation (partner = CRIME)
  try {
    const sig = await bondingCurve.methods
      .consolidateForRefund()
      .accountsStrict({
        curveState: curvePdas.fraud.curveState,
        partnerCurveState: curvePdas.crime.curveState,
        taxEscrow: curvePdas.fraud.taxEscrow,
        solVault: curvePdas.fraud.solVault,
      })
      .rpc();
    console.log(`  FRAUD: Consolidated -> ${sig.slice(0, 8)}...`);
  } catch (err: any) {
    console.log(`  FRAUD: consolidate result: ${err.message}`);
  }

  // Read and log post-consolidation curve state
  const curveSnapshots: CurveSnapshot[] = [];
  for (const { curve, pdas: p } of [
    { curve: "CRIME" as const, pdas: curvePdas.crime },
    { curve: "FRAUD" as const, pdas: curvePdas.fraud },
  ]) {
    const curveData = await bondingCurve.account.curveState.fetch(p.curveState);
    const solVaultBalance = await connection.getBalance(p.solVault);
    const rent = await connection.getMinimumBalanceForRentExemption(0);
    const refundPool = solVaultBalance - rent;

    const snapshot: CurveSnapshot = {
      curve,
      tokensSold: curveData.tokensSold.toNumber(),
      solRaised: curveData.solRaised.toNumber(),
      taxCollected: curveData.taxCollected.toNumber(),
      escrowConsolidated: curveData.escrowConsolidated,
      refundPoolLamports: refundPool,
      totalOutstandingTokens: curveData.tokensSold.toNumber(),
      solVaultBalance,
    };
    curveSnapshots.push(snapshot);

    console.log(`  ${curve}:`);
    console.log(`    tokens_sold:          ${curveData.tokensSold.toNumber()}`);
    console.log(`    sol_raised:           ${lamportsToSol(curveData.solRaised.toNumber())} SOL`);
    console.log(`    tax_collected:        ${lamportsToSol(curveData.taxCollected.toNumber())} SOL`);
    console.log(`    escrow_consolidated:  ${curveData.escrowConsolidated}`);
    console.log(`    sol_vault_balance:    ${lamportsToSol(solVaultBalance)} SOL`);
    console.log(`    refund_pool:          ${lamportsToSol(refundPool)} SOL`);
  }

  // =========================================================================
  // Phase 7: Snapshot pre-claim balances
  // =========================================================================
  console.log("\n--- Phase 7: Pre-Claim Snapshot ---\n");

  const preClaim: WalletSnapshot[] = [];
  for (let i = 0; i < testWallets.length; i++) {
    const wallet = testWallets[i];
    const solBalance = await connection.getBalance(wallet.publicKey);

    let crimeBalance = 0;
    let fraudBalance = 0;

    try {
      const crimeAta = getAssociatedTokenAddressSync(
        crimeMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const info = await connection.getTokenAccountBalance(crimeAta);
      crimeBalance = Number(info.value.amount);
    } catch { /* no ATA or zero */ }

    try {
      const fraudAta = getAssociatedTokenAddressSync(
        fraudMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const info = await connection.getTokenAccountBalance(fraudAta);
      fraudBalance = Number(info.value.amount);
    } catch { /* no ATA or zero */ }

    preClaim.push({
      wallet: wallet.publicKey.toBase58(),
      walletIndex: i,
      solBalance,
      crimeBalance,
      fraudBalance,
    });

    console.log(`  Wallet ${i + 1}: SOL=${lamportsToSol(solBalance)}, CRIME=${crimeBalance}, FRAUD=${fraudBalance}`);
  }

  // =========================================================================
  // Phase 8: Claim refunds
  // =========================================================================
  console.log("\n--- Phase 8: Claim Refunds ---\n");

  const claimActions: { wallet: string; walletIndex: number; curve: string; txSig: string }[] = [];

  for (let i = 0; i < testWallets.length; i++) {
    const wallet = testWallets[i];

    // Claim from CRIME curve if holding CRIME tokens
    if (preClaim[i].crimeBalance > 0) {
      const userAta = getAssociatedTokenAddressSync(
        crimeMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );

      try {
        const sig = await bondingCurve.methods
          .claimRefund()
          .accountsStrict({
            user: wallet.publicKey,
            curveState: curvePdas.crime.curveState,
            partnerCurveState: curvePdas.fraud.curveState,
            userTokenAccount: userAta,
            tokenMint: crimeMint,
            solVault: curvePdas.crime.solVault,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([wallet])
          .rpc();
        console.log(`  Wallet ${i + 1}: Claimed CRIME refund -> ${sig.slice(0, 8)}...`);
        claimActions.push({ wallet: wallet.publicKey.toBase58(), walletIndex: i, curve: "CRIME", txSig: sig });
      } catch (err: any) {
        console.error(`  Wallet ${i + 1}: CRIME claim FAILED: ${err.message}`);
        claimActions.push({ wallet: wallet.publicKey.toBase58(), walletIndex: i, curve: "CRIME", txSig: `FAILED: ${err.message}` });
      }
      await sleep(500);
    }

    // Claim from FRAUD curve if holding FRAUD tokens
    if (preClaim[i].fraudBalance > 0) {
      const userAta = getAssociatedTokenAddressSync(
        fraudMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );

      try {
        const sig = await bondingCurve.methods
          .claimRefund()
          .accountsStrict({
            user: wallet.publicKey,
            curveState: curvePdas.fraud.curveState,
            partnerCurveState: curvePdas.crime.curveState,
            userTokenAccount: userAta,
            tokenMint: fraudMint,
            solVault: curvePdas.fraud.solVault,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([wallet])
          .rpc();
        console.log(`  Wallet ${i + 1}: Claimed FRAUD refund -> ${sig.slice(0, 8)}...`);
        claimActions.push({ wallet: wallet.publicKey.toBase58(), walletIndex: i, curve: "FRAUD", txSig: sig });
      } catch (err: any) {
        console.error(`  Wallet ${i + 1}: FRAUD claim FAILED: ${err.message}`);
        claimActions.push({ wallet: wallet.publicKey.toBase58(), walletIndex: i, curve: "FRAUD", txSig: `FAILED: ${err.message}` });
      }
      await sleep(500);
    }
  }

  // =========================================================================
  // Phase 9: Post-claim snapshot
  // =========================================================================
  console.log("\n--- Phase 9: Post-Claim Snapshot ---\n");

  const postClaim: WalletSnapshot[] = [];
  for (let i = 0; i < testWallets.length; i++) {
    const wallet = testWallets[i];
    const solBalance = await connection.getBalance(wallet.publicKey);

    let crimeBalance = 0;
    let fraudBalance = 0;

    try {
      const crimeAta = getAssociatedTokenAddressSync(
        crimeMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const info = await connection.getTokenAccountBalance(crimeAta);
      crimeBalance = Number(info.value.amount);
    } catch { /* no ATA or zero */ }

    try {
      const fraudAta = getAssociatedTokenAddressSync(
        fraudMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const info = await connection.getTokenAccountBalance(fraudAta);
      fraudBalance = Number(info.value.amount);
    } catch { /* no ATA or zero */ }

    postClaim.push({
      wallet: wallet.publicKey.toBase58(),
      walletIndex: i,
      solBalance,
      crimeBalance,
      fraudBalance,
    });

    console.log(`  Wallet ${i + 1}: SOL=${lamportsToSol(solBalance)}, CRIME=${crimeBalance}, FRAUD=${fraudBalance}`);
  }

  // =========================================================================
  // Phase 10: Write structured log
  // =========================================================================
  console.log("\n--- Phase 10: Write Log ---\n");

  const log: Pathway1Log = {
    timestamp: new Date().toISOString(),
    deployment,
    actions,
    preClaim,
    curveSnapshots,
    postClaim,
    claimActions,
  };

  const logPath = path.resolve(process.cwd(), "scripts/test/pathway1-log.json");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`  Log written to: ${logPath}`);

  console.log("\n=== Pathway 1 Test Complete ===");
  console.log("  Run 'npx tsx scripts/test/verify-refunds.ts' to generate the report.\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
