/**
 * Stress Wallet -- Individual bot wallet lifecycle for concurrent stress testing.
 *
 * Encapsulates a single wallet that can:
 * 1. Receive SOL funding from a funder wallet
 * 2. Create Token-2022 accounts for CRIME/FRAUD and standard SPL WSOL account
 * 3. Execute random buy/sell swaps across CRIME/SOL and FRAUD/SOL pools
 *
 * Why per-wallet state tracking:
 * Each wallet tracks its own token balances locally to determine when sells
 * are possible (must have bought tokens first). This avoids expensive
 * on-chain getTokenAccountBalance calls between every swap and prevents
 * selling from an empty account.
 *
 * Why random delays:
 * Staggered swap timing prevents all 50 wallets from hitting Helius RPC
 * simultaneously, which would trigger rate limits (~10 TPS on free tier).
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAccount,
  createWrappedNativeAccount,
  createSyncNativeInstruction,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";

import { Programs } from "../../deploy/lib/connection";
import { PDAManifest } from "../devnet-e2e-validation";
import { readEpochState, EpochStateSnapshot } from "../../vrf/lib/epoch-reader";

// ---- Constants ----

/** All tokens use 6 decimals */
const TOKEN_DECIMALS = 6;

/** Rate limit delay between RPC calls (ms) */
const RPC_DELAY_MS = 200;

// ---- Types ----

/** Result of a single swap attempt */
export interface SwapResult {
  success: boolean;
  txSig: string | null;
  error: string | null;
  pair: string;
  direction: "buy" | "sell";
  amount: number;
  walletIndex: number;
  timestamp: string;
}

// ---- Utilities ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random integer in [min, max] inclusive */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max] */
function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Check if an error is transient (network/rate limit) vs permanent.
 * Mirrors the check in swap-flow.ts.
 */
function isTransientError(errStr: string): boolean {
  const transientPatterns = [
    "429",
    "Too Many Requests",
    "ECONNRESET",
    "ETIMEDOUT",
    "socket hang up",
    "BlockhashNotFound",
    "TransactionExpiredBlockheightExceededError",
  ];
  return transientPatterns.some((pattern) =>
    errStr.toLowerCase().includes(pattern.toLowerCase())
  );
}

// ---- Resolve Hook Accounts ----

/**
 * Resolve Transfer Hook remaining_accounts for a token transfer.
 * Mirrors the resolveHookAccounts in swap-flow.ts.
 */
async function resolveHookAccounts(
  connection: Connection,
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

  // Skip first 4 keys (source, mint, dest, authority) -- rest are hook accounts
  return transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));
}

// ---- StressWallet Class ----

export class StressWallet {
  readonly index: number;
  readonly keypair: Keypair;
  private connection: Connection;
  private manifest: PDAManifest;
  private programs: Programs;
  private provider: AnchorProvider;
  private alt: AddressLookupTableAccount;

  /** Token accounts (created in createAccounts) */
  wsolAccount: PublicKey | null = null;
  crimeAccount: PublicKey | null = null;
  fraudAccount: PublicKey | null = null;

  /** Local balance tracking (raw units, 6 decimals) */
  private crimeBalance = 0;
  private fraudBalance = 0;

  /** Whether the first swap has been a buy (required before selling) */
  private hasBought = false;

  /** Swap PDA derived from Tax Program */
  private swapAuthorityPda: PublicKey;

  /** Cached epoch state (refreshed periodically to avoid excessive RPC calls) */
  private cachedEpochState: EpochStateSnapshot | null = null;
  private epochStateLastRefresh = 0;
  private static readonly EPOCH_STATE_CACHE_MS = 30_000; // refresh every 30s

  constructor(
    index: number,
    keypair: Keypair,
    connection: Connection,
    provider: AnchorProvider,
    programs: Programs,
    manifest: PDAManifest,
    alt: AddressLookupTableAccount
  ) {
    this.index = index;
    this.keypair = keypair;
    this.connection = connection;
    this.provider = provider;
    this.programs = programs;
    this.manifest = manifest;
    this.alt = alt;

    // Pre-derive swap_authority PDA from Tax Program
    const [swapAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap_authority")],
      programs.taxProgram.programId
    );
    this.swapAuthorityPda = swapAuth;
  }

  /**
   * Create token accounts for this wallet.
   * - CRIME + FRAUD: Token-2022 (with Transfer Hook)
   * - WSOL: Standard SPL Token
   */
  async createAccounts(): Promise<void> {
    const crimeMint = new PublicKey(this.manifest.mints.CRIME);
    const fraudMint = new PublicKey(this.manifest.mints.FRAUD);

    // CRIME account (Token-2022)
    this.crimeAccount = await createAccount(
      this.connection,
      this.keypair,
      crimeMint,
      this.keypair.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await sleep(RPC_DELAY_MS);

    // FRAUD account (Token-2022)
    this.fraudAccount = await createAccount(
      this.connection,
      this.keypair,
      fraudMint,
      this.keypair.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await sleep(RPC_DELAY_MS);

    // WSOL account (standard SPL Token)
    // Wrap minimal SOL -- buy swaps top up via SOL transfer + syncNative
    const wsolAmount = Math.floor(0.003 * LAMPORTS_PER_SOL);
    this.wsolAccount = await createWrappedNativeAccount(
      this.connection,
      this.keypair,
      this.keypair.publicKey,
      wsolAmount,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    await sleep(RPC_DELAY_MS);
  }

  /**
   * Get epoch state (cached for 30s to reduce RPC calls).
   */
  private async getEpochState(): Promise<EpochStateSnapshot | null> {
    const now = Date.now();
    if (
      this.cachedEpochState &&
      now - this.epochStateLastRefresh < StressWallet.EPOCH_STATE_CACHE_MS
    ) {
      return this.cachedEpochState;
    }
    try {
      this.cachedEpochState = await readEpochState(
        this.programs.epochProgram,
        new PublicKey(this.manifest.pdas.EpochState)
      );
      this.epochStateLastRefresh = now;
      return this.cachedEpochState;
    } catch {
      return this.cachedEpochState; // return stale if refresh fails
    }
  }

  /**
   * Calculate minimum output for a buy swap to satisfy the 50% floor.
   * Reads pool reserves and computes constant-product expected output.
   */
  private async calcBuyMinOutput(
    pool: { pool: string; vaultA: string; vaultB: string },
    amountIn: number,
    taxBps: number
  ): Promise<number> {
    try {
      const reserveA = await this.connection.getBalance(new PublicKey(pool.vaultA));
      const poolVaultBBal = await this.connection.getTokenAccountBalance(
        new PublicKey(pool.vaultB)
      );
      const reserveB = parseInt(poolVaultBBal.value.amount);
      const taxDeducted = Math.floor((amountIn * taxBps) / 10_000);
      const solToSwap = amountIn - taxDeducted;
      if (reserveA > 0 && reserveB > 0 && solToSwap > 0) {
        const expected = Math.floor((solToSwap * reserveB) / (reserveA + solToSwap));
        // Set to 51% of expected (just above the on-chain 50% floor).
        // Concurrent swaps may shift reserves, causing occasional floor violations --
        // those are expected and counted as normal failures in stress testing.
        return Math.max(1, Math.floor((expected * 51) / 100));
      }
    } catch {
      // fallback
    }
    return 1;
  }

  /**
   * Calculate minimum output for a sell swap to satisfy the 50% floor.
   */
  private async calcSellMinOutput(
    pool: { pool: string; vaultA: string; vaultB: string },
    amountTokens: number
  ): Promise<number> {
    try {
      const reserveA = await this.connection.getBalance(new PublicKey(pool.vaultA));
      const poolVaultBBal = await this.connection.getTokenAccountBalance(
        new PublicKey(pool.vaultB)
      );
      const reserveB = parseInt(poolVaultBBal.value.amount);
      if (reserveA > 0 && reserveB > 0 && amountTokens > 0) {
        const grossSolOut = Math.floor(
          (amountTokens * reserveA) / (reserveB + amountTokens)
        );
        return Math.max(1, Math.floor((grossSolOut * 51) / 100));
      }
    } catch {
      // fallback
    }
    return 1;
  }

  /**
   * Execute a random swap: random pool, random direction, random amount.
   * First swap is always a buy (need tokens before selling).
   */
  async executeRandomSwap(): Promise<SwapResult> {
    // Pick random pool
    const pools = ["CRIME/SOL", "FRAUD/SOL"];
    const pair = pools[randInt(0, pools.length - 1)];
    const isCrime = pair === "CRIME/SOL";

    // Determine direction: first 2 swaps must be buys (build up token balance),
    // then 30% chance of sell (biased toward buys to ensure volume/chart data)
    const canSell = this.hasBought && (isCrime ? this.crimeBalance > 10_000 : this.fraudBalance > 10_000);
    const direction: "buy" | "sell" = !this.hasBought || !canSell
      ? "buy"
      : Math.random() > 0.7 ? "sell" : "buy";

    // Random amount: 0.001-0.01 SOL for buys, up to 30% of balance for sells
    let amount: number;
    if (direction === "buy") {
      // 0.001 to 0.01 SOL in lamports
      amount = randInt(1_000_000, 10_000_000);
    } else {
      // Sell up to 30% of held token balance (keep buffer for future sells)
      const balance = isCrime ? this.crimeBalance : this.fraudBalance;
      const maxSell = Math.floor(balance * 0.3);
      const minSell = Math.max(10_000, Math.floor(balance * 0.1)); // at least 10%
      amount = randInt(Math.min(minSell, maxSell), maxSell);
      if (amount <= 10_000) {
        // Fallback to buy if balance too low to sell meaningfully
        return this.executeBuySwap(pair, isCrime, randInt(1_000_000, 10_000_000));
      }
    }

    if (direction === "buy") {
      return this.executeBuySwap(pair, isCrime, amount);
    } else {
      return this.executeSellSwap(pair, isCrime, amount);
    }
  }

  /**
   * Execute a SOL buy swap (SOL -> CRIME or FRAUD).
   * Uses standard Transaction (buy path fits within TX size limits).
   */
  private async executeBuySwap(
    pair: string,
    isCrime: boolean,
    amountLamports: number
  ): Promise<SwapResult> {
    const pool = this.manifest.pools[pair];
    const tokenMint = new PublicKey(
      isCrime ? this.manifest.mints.CRIME : this.manifest.mints.FRAUD
    );
    const userTokenB = isCrime ? this.crimeAccount! : this.fraudAccount!;

    try {
      // Read epoch state for tax rate
      const epochState = await this.getEpochState();
      const taxBps = epochState
        ? (isCrime ? epochState.crimeBuyTaxBps : epochState.fraudBuyTaxBps)
        : 500; // fallback 5%

      // Calculate minimum output to satisfy 50% floor
      const minimumOutput = await this.calcBuyMinOutput(pool, amountLamports, taxBps);

      // Resolve hook accounts for buy (pool vault -> user token)
      const hookAccounts = await resolveHookAccounts(
        this.connection,
        new PublicKey(pool.vaultB),
        tokenMint,
        userTokenB,
        new PublicKey(this.manifest.pdas.SwapAuthority),
        BigInt(0)
      );

      // Check native SOL balance before attempting swap.
      // We need enough for: swap amount + TX fee (~5000 lamports) + rent buffer.
      const nativeBalance = await this.connection.getBalance(this.keypair.publicKey);
      const neededLamports = amountLamports + 50_000; // swap + fee + buffer
      if (nativeBalance < neededLamports) {
        return {
          success: false,
          txSig: null,
          error: `Insufficient SOL: have ${nativeBalance}, need ${neededLamports}`,
          pair,
          direction: "buy",
          amount: amountLamports,
          walletIndex: this.index,
          timestamp: new Date().toISOString(),
        };
      }

      // Transfer SOL to WSOL account and sync before swap.
      // This ensures the WSOL account has enough balance for the swap.
      // Without this, repeated buys drain the initial WSOL wrapping.
      const topUpIx = SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: this.wsolAccount!,
        lamports: amountLamports + 10_000, // +10k lamports buffer for rent
      });
      const syncIx = createSyncNativeInstruction(this.wsolAccount!, TOKEN_PROGRAM_ID);

      // Build swap instruction
      const swapIx = await this.programs.taxProgram.methods
        .swapSolBuy(
          new anchor.BN(amountLamports),
          new anchor.BN(minimumOutput),
          isCrime
        )
        .accountsStrict({
          user: this.keypair.publicKey,
          epochState: new PublicKey(this.manifest.pdas.EpochState),
          swapAuthority: this.swapAuthorityPda,
          taxAuthority: new PublicKey(this.manifest.pdas.TaxAuthority),
          pool: new PublicKey(pool.pool),
          poolVaultA: new PublicKey(pool.vaultA),
          poolVaultB: new PublicKey(pool.vaultB),
          mintA: NATIVE_MINT,
          mintB: tokenMint,
          userTokenA: this.wsolAccount!,
          userTokenB: userTokenB,
          stakePool: new PublicKey(this.manifest.pdas.StakePool),
          stakingEscrow: new PublicKey(this.manifest.pdas.EscrowVault),
          carnageVault: new PublicKey(this.manifest.pdas.CarnageSolVault),
          treasury: this.provider.wallet.publicKey,
          ammProgram: new PublicKey(this.manifest.programs.AMM),
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          stakingProgram: new PublicKey(this.manifest.programs.Staking),
        })
        .remainingAccounts(hookAccounts)
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        topUpIx,
        syncIx,
        swapIx
      );

      const txSig = await this.provider.sendAndConfirm(tx, [this.keypair]);

      // Update local balance tracking by reading actual on-chain balance
      this.hasBought = true;
      try {
        const tokenBal = await this.connection.getTokenAccountBalance(userTokenB);
        const actualBalance = parseInt(tokenBal.value.amount);
        if (isCrime) {
          this.crimeBalance = actualBalance;
        } else {
          this.fraudBalance = actualBalance;
        }
      } catch {
        // Fallback: rough estimate if balance read fails
        if (isCrime) {
          this.crimeBalance += 100_000;
        } else {
          this.fraudBalance += 100_000;
        }
      }

      return {
        success: true,
        txSig,
        error: null,
        pair,
        direction: "buy",
        amount: amountLamports,
        walletIndex: this.index,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        txSig: null,
        error: String(err).slice(0, 300),
        pair,
        direction: "buy",
        amount: amountLamports,
        walletIndex: this.index,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute a token sell swap (CRIME/FRAUD -> SOL).
   * Uses v0 VersionedTransaction with ALT (sell path exceeds legacy TX size).
   */
  private async executeSellSwap(
    pair: string,
    isCrime: boolean,
    amountTokens: number
  ): Promise<SwapResult> {
    const pool = this.manifest.pools[pair];
    const tokenMint = new PublicKey(
      isCrime ? this.manifest.mints.CRIME : this.manifest.mints.FRAUD
    );
    const userTokenB = isCrime ? this.crimeAccount! : this.fraudAccount!;

    try {
      // Calculate minimum output to satisfy 50% floor
      const minimumOutput = await this.calcSellMinOutput(pool, amountTokens);

      // Resolve hook accounts for sell (user token -> pool vault)
      const hookAccounts = await resolveHookAccounts(
        this.connection,
        userTokenB,
        tokenMint,
        new PublicKey(pool.vaultB),
        this.keypair.publicKey,
        BigInt(amountTokens)
      );

      // Build sell swap instruction
      const sellIx = await this.programs.taxProgram.methods
        .swapSolSell(
          new anchor.BN(amountTokens),
          new anchor.BN(minimumOutput),
          isCrime
        )
        .accountsStrict({
          user: this.keypair.publicKey,
          epochState: new PublicKey(this.manifest.pdas.EpochState),
          swapAuthority: this.swapAuthorityPda,
          taxAuthority: new PublicKey(this.manifest.pdas.TaxAuthority),
          pool: new PublicKey(pool.pool),
          poolVaultA: new PublicKey(pool.vaultA),
          poolVaultB: new PublicKey(pool.vaultB),
          mintA: NATIVE_MINT,
          mintB: tokenMint,
          userTokenA: this.wsolAccount!,
          userTokenB: userTokenB,
          stakePool: new PublicKey(this.manifest.pdas.StakePool),
          stakingEscrow: new PublicKey(this.manifest.pdas.EscrowVault),
          carnageVault: new PublicKey(this.manifest.pdas.CarnageSolVault),
          treasury: this.provider.wallet.publicKey,
          wsolIntermediary: new PublicKey(this.manifest.pdas.WsolIntermediary),
          ammProgram: new PublicKey(this.manifest.programs.AMM),
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          stakingProgram: new PublicKey(this.manifest.programs.Staking),
        })
        .remainingAccounts(hookAccounts)
        .instruction();

      // Build v0 VersionedTransaction with ALT for sell path
      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash("confirmed");

      const messageV0 = new TransactionMessage({
        payerKey: this.keypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          sellIx,
        ],
      }).compileToV0Message([this.alt]);

      const vtx = new VersionedTransaction(messageV0);
      vtx.sign([this.keypair]);

      const txSig = await this.connection.sendTransaction(vtx, {
        skipPreflight: true, // devnet v0 simulation bug
        maxRetries: 3,
      });

      const confirmation = await this.connection.confirmTransaction(
        { signature: txSig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      // Check for on-chain failure (skipPreflight means failed TXs are still "confirmed")
      if (confirmation.value.err) {
        throw new Error(
          `TX confirmed but failed on-chain: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      // Update local balance tracking
      if (isCrime) {
        this.crimeBalance = Math.max(0, this.crimeBalance - amountTokens);
      } else {
        this.fraudBalance = Math.max(0, this.fraudBalance - amountTokens);
      }

      return {
        success: true,
        txSig,
        error: null,
        pair,
        direction: "sell",
        amount: amountTokens,
        walletIndex: this.index,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        txSig: null,
        error: String(err).slice(0, 300),
        pair,
        direction: "sell",
        amount: amountTokens,
        walletIndex: this.index,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
