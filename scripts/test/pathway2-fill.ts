/**
 * Pathway 2 Fill Script: Fill Both Bonding Curves to Capacity
 *
 * Generates 25 wallets, funds them, and executes parallel waves of buy/sell
 * operations across both CRIME and FRAUD curves with randomized timing.
 *
 * Math:
 * - Each curve needs ~4.9 SOL to fill (user manually buys 0.1 SOL first)
 * - MAX_TOKENS_PER_WALLET = 20M tokens, 460M per curve = 23 wallets minimum
 * - Devnet prices (P_START=5): 0.05 SOL ≈ 10M tokens, so buy range 0.03-0.08 SOL
 *   stays safely under the 20M wallet cap even at early curve prices
 * - 50 wallets with 0.3 SOL each = 15 SOL funded out
 * - Parallel waves of 5 wallets for ~2-3min total fill time
 *
 * Usage:
 *   set -a && source .env.devnet && set +a
 *   npx tsx scripts/test/pathway2-fill.ts
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

const WALLET_COUNT = 50;
const FUND_PER_WALLET = 0.3 * LAMPORTS_PER_SOL;
const TARGET_SOL_PER_CURVE = 4.9; // user manually buys 0.1 SOL first
const WAVE_SIZE = 5; // wallets per parallel wave
const WAVE_DELAY_MS_MIN = 1000;
const WAVE_DELAY_MS_MAX = 2000;
const BUY_SOL_MIN = 0.03;
const BUY_SOL_MAX = 0.08;
const SELL_CHANCE = 0.2; // 20% chance a wallet sells instead of buys
const SELL_PCT_MIN = 0.10;
const SELL_PCT_MAX = 0.15;
// PDA seeds (must match on-chain constants.rs)
const EXTRA_ACCOUNT_META_SEED = Buffer.from("extra-account-metas");
const WHITELIST_SEED = Buffer.from("whitelist");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeploymentConfig {
  programs: { transferHook: string; bondingCurve: string };
  mints: { crime: string; fraud: string };
  curvePdas: {
    crime: {
      curveState: string;
      tokenVault: string;
      solVault: string;
      taxEscrow: string;
    };
    fraud: {
      curveState: string;
      tokenVault: string;
      solVault: string;
      taxEscrow: string;
    };
  };
}

interface WalletState {
  keypair: Keypair;
  hasBoughtCrime: boolean;
  hasBoughtFraud: boolean;
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

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  console.log("=== Pathway 2: Fill Both Curves to Capacity ===\n");

  // Load config
  const deployment = loadDeployment();
  const funder = loadWalletKeypair();
  const clusterUrl =
    process.env.CLUSTER_URL || "https://api.devnet.solana.com";
  const connection = new Connection(clusterUrl, "confirmed");

  // Load bonding curve program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(funder),
    { preflightCommitment: "confirmed", commitment: "confirmed" },
  );
  const idlPath = path.resolve(
    process.cwd(),
    "target/idl/bonding_curve.json",
  );
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
  // 25 wallets * 0.5 SOL + ~0.5 SOL for ATA rent + gas
  const needed = WALLET_COUNT * FUND_PER_WALLET + 1 * LAMPORTS_PER_SOL;
  if (funderBalance < needed) {
    throw new Error(
      `Funder needs at least ${lamportsToSol(needed)} SOL (${WALLET_COUNT} wallets * ${lamportsToSol(FUND_PER_WALLET)} + ATA rent/gas)`,
    );
  }

  // =========================================================================
  // Phase 1: Generate and fund wallets
  // =========================================================================
  console.log(
    `\n--- Phase 1: Generate + Fund ${WALLET_COUNT} Wallets (${(FUND_PER_WALLET / LAMPORTS_PER_SOL).toFixed(1)} SOL each) ---\n`,
  );

  const wallets: WalletState[] = [];
  for (let i = 0; i < WALLET_COUNT; i++) {
    wallets.push({
      keypair: Keypair.generate(),
      hasBoughtCrime: false,
      hasBoughtFraud: false,
    });
  }

  // Fund wallets in parallel batches of 5
  for (let batch = 0; batch < wallets.length; batch += 5) {
    const batchWallets = wallets.slice(batch, batch + 5);
    await Promise.all(
      batchWallets.map(async (w, idx) => {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: funder.publicKey,
            toPubkey: w.keypair.publicKey,
            lamports: FUND_PER_WALLET,
          }),
        );
        await sendAndConfirmTransaction(connection, tx, [funder]);
        console.log(
          `  Wallet ${batch + idx + 1}: ${w.keypair.publicKey.toBase58().slice(0, 12)}... funded`,
        );
      }),
    );
  }

  // =========================================================================
  // Phase 1b: Create ATAs for all wallets (funder pays rent)
  // =========================================================================
  console.log("\n  Creating Token-2022 ATAs (funder pays rent)...");
  for (let batch = 0; batch < wallets.length; batch += 5) {
    const batchWallets = wallets.slice(batch, batch + 5);
    await Promise.all(
      batchWallets.map(async (w) => {
        for (const mint of [crimeMint, fraudMint]) {
          const ata = getAssociatedTokenAddressSync(
            mint,
            w.keypair.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
          );
          const ataInfo = await connection.getAccountInfo(ata);
          if (!ataInfo) {
            const tx = new Transaction().add(
              createAssociatedTokenAccountInstruction(
                funder.publicKey,
                ata,
                w.keypair.publicKey,
                mint,
                TOKEN_2022_PROGRAM_ID,
              ),
            );
            await sendAndConfirmTransaction(connection, tx, [funder]);
          }
        }
      }),
    );
    console.log(`    ATAs created for wallets ${batch + 1}-${batch + batchWallets.length}`);
  }

  // =========================================================================
  // Phase 2: Fill curves with parallel waves of buy/sell traffic
  // =========================================================================
  console.log("\n--- Phase 2: Fill Curves (Parallel Waves of 5) ---\n");

  let crimeSolIn = 0;
  let fraudSolIn = 0;
  let opCount = 0;
  let crimeFilled = false;
  let fraudFilled = false;
  let waveCount = 0;

  // Check curve state
  async function checkCurveState(
    curve: "CRIME" | "FRAUD",
  ): Promise<{ tokensSold: number; solRaised: number; status: string }> {
    const pdas = curve === "CRIME" ? curvePdas.crime : curvePdas.fraud;
    try {
      const data = await bondingCurve.account.curveState.fetch(
        pdas.curveState,
      );
      return {
        tokensSold: data.tokensSold.toNumber(),
        solRaised: data.solRaised.toNumber(),
        status: Object.keys(data.status)[0],
      };
    } catch {
      return { tokensSold: 0, solRaised: 0, status: "unknown" };
    }
  }

  // Execute a single buy
  async function executeBuy(
    walletState: WalletState,
    curve: "CRIME" | "FRAUD",
    solAmount: number,
  ): Promise<boolean> {
    const wallet = walletState.keypair;
    const mint = curve === "CRIME" ? crimeMint : fraudMint;
    const pdas = curve === "CRIME" ? curvePdas.crime : curvePdas.fraud;

    const userAta = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const hookAccounts = getHookAccounts(
      hookProgramId,
      mint,
      pdas.tokenVault,
      userAta,
    );

    try {
      const sig = await bondingCurve.methods
        .purchase(new anchor.BN(solAmount), new anchor.BN(0))
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

      if (curve === "CRIME") walletState.hasBoughtCrime = true;
      else walletState.hasBoughtFraud = true;

      opCount++;
      const solAmt = solAmount / LAMPORTS_PER_SOL;
      if (curve === "CRIME") crimeSolIn += solAmt;
      else fraudSolIn += solAmt;

      const total = curve === "CRIME" ? crimeSolIn : fraudSolIn;
      const pct = ((total / TARGET_SOL_PER_CURVE) * 100).toFixed(1);
      console.log(
        `  [${opCount}] BUY ${curve} ${solAmt.toFixed(3)} SOL | total: ${total.toFixed(3)} SOL (${pct}%) | ${sig.slice(0, 8)}...`,
      );
      return true;
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.includes("CurveFull") ||
        msg.includes("filled") ||
        msg.includes("Graduated") ||
        msg.includes("CurveNotActive")
      ) {
        console.log(`  [BUY ${curve}] Curve is full/graduated!`);
        if (curve === "CRIME") crimeFilled = true;
        else fraudFilled = true;
        return false;
      }
      if (msg.includes("WalletCapExceeded")) {
        console.log(`  [BUY ${curve}] Wallet cap hit for ${wallet.publicKey.toBase58().slice(0, 8)}...`);
        return false;
      }
      console.error(
        `  [BUY ${curve}] FAILED: ${msg.slice(0, 120)}`,
      );
      return false;
    }
  }

  // Execute a single sell
  async function executeSell(
    walletState: WalletState,
    curve: "CRIME" | "FRAUD",
    sellPct: number,
  ): Promise<boolean> {
    const wallet = walletState.keypair;
    const mint = curve === "CRIME" ? crimeMint : fraudMint;
    const pdas = curve === "CRIME" ? curvePdas.crime : curvePdas.fraud;

    const userAta = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    try {
      const ataInfo = await connection.getTokenAccountBalance(userAta);
      const tokenBalance = Number(ataInfo.value.amount);
      if (tokenBalance === 0) return false;

      const sellAmount = Math.floor(tokenBalance * sellPct);
      if (sellAmount === 0) return false;

      const hookAccounts = getHookAccounts(
        hookProgramId,
        mint,
        userAta,
        pdas.tokenVault,
      );

      const sig = await bondingCurve.methods
        .sell(new anchor.BN(sellAmount), new anchor.BN(0))
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

      opCount++;
      const humanTokens = (sellAmount / 1e6).toFixed(0);
      console.log(
        `  [${opCount}] SELL ${curve} ${humanTokens} tokens (${(sellPct * 100).toFixed(0)}%) | ${sig.slice(0, 8)}...`,
      );
      return true;
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.includes("CurveNotActive") ||
        msg.includes("filled") ||
        msg.includes("Graduated")
      ) {
        if (curve === "CRIME") crimeFilled = true;
        else fraudFilled = true;
        return false;
      }
      console.error(
        `  [SELL ${curve}] FAILED: ${msg.slice(0, 120)}`,
      );
      return false;
    }
  }

  // ---- Main fill loop: parallel waves ----
  // Round-robin through wallets in waves of WAVE_SIZE.
  // Each wallet in a wave picks a random curve and either buys or sells.
  let walletIdx = 0;

  while (!crimeFilled || !fraudFilled) {
    waveCount++;
    const waveWallets: WalletState[] = [];
    for (let i = 0; i < WAVE_SIZE && walletIdx < wallets.length; i++) {
      waveWallets.push(wallets[walletIdx]);
      walletIdx++;
    }
    // Wrap around when we've used all wallets
    if (walletIdx >= wallets.length) walletIdx = 0;

    // Execute wave in parallel
    await Promise.all(
      waveWallets.map(async (w) => {
        // Pick curve: if one is filled, use the other. Otherwise alternate.
        let curve: "CRIME" | "FRAUD";
        if (crimeFilled && !fraudFilled) {
          curve = "FRAUD";
        } else if (!crimeFilled && fraudFilled) {
          curve = "CRIME";
        } else if (crimeFilled && fraudFilled) {
          return; // both done
        } else {
          curve = Math.random() < 0.5 ? "CRIME" : "FRAUD";
        }

        // Decide buy or sell
        const canSell =
          (curve === "CRIME" && w.hasBoughtCrime) ||
          (curve === "FRAUD" && w.hasBoughtFraud);
        const doSell = canSell && Math.random() < SELL_CHANCE;

        if (doSell) {
          const sellPct = randFloat(SELL_PCT_MIN, SELL_PCT_MAX);
          await executeSell(w, curve, sellPct);
        } else {
          const solAmount = Math.floor(
            randFloat(BUY_SOL_MIN, BUY_SOL_MAX) * LAMPORTS_PER_SOL,
          );
          await executeBuy(w, curve, solAmount);
        }
      }),
    );

    // Check curve state after each wave
    if (!crimeFilled) {
      const crimeState = await checkCurveState("CRIME");
      if (
        crimeState.status === "filled" ||
        crimeState.status === "graduated"
      ) {
        crimeFilled = true;
        console.log(
          `\n  >>> CRIME curve FILLED! (${lamportsToSol(crimeState.solRaised)} SOL raised) <<<\n`,
        );
      }
    }
    if (!fraudFilled) {
      const fraudState = await checkCurveState("FRAUD");
      if (
        fraudState.status === "filled" ||
        fraudState.status === "graduated"
      ) {
        fraudFilled = true;
        console.log(
          `\n  >>> FRAUD curve FILLED! (${lamportsToSol(fraudState.solRaised)} SOL raised) <<<\n`,
        );
      }
    }

    // Random delay between waves for organic feel
    if (!crimeFilled || !fraudFilled) {
      const waitMs = randInt(WAVE_DELAY_MS_MIN, WAVE_DELAY_MS_MAX);
      await sleep(waitMs);
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n=== Fill Complete ===\n");
  console.log(`  Waves: ${waveCount}`);
  console.log(`  Operations: ${opCount}`);
  console.log(`  CRIME SOL in: ${crimeSolIn.toFixed(4)} SOL`);
  console.log(`  FRAUD SOL in: ${fraudSolIn.toFixed(4)} SOL`);
  console.log(`  Total SOL in: ${(crimeSolIn + fraudSolIn).toFixed(4)} SOL`);
  console.log(`  Time elapsed: ${elapsed}s`);

  // Final curve state
  for (const curve of ["CRIME", "FRAUD"] as const) {
    const state = await checkCurveState(curve);
    const humanTokens = (state.tokensSold / 1e6).toFixed(0);
    console.log(
      `  ${curve}: status=${state.status}, tokens_sold=${humanTokens}, sol_raised=${lamportsToSol(state.solRaised)}`,
    );
  }

  console.log("\n  Both curves filled! Ready for graduation.");
  console.log("  Next: npx tsx scripts/graduation/graduate.ts\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
