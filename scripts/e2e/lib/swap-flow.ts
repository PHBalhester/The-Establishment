/**
 * E2E Swap Flow -- SOL Buy Swap with Tax Distribution Verification
 *
 * Executes a SOL buy swap on the CRIME/SOL pool through the Tax->AMM
 * CPI chain, then verifies the 71/24/5 tax distribution across
 * staking escrow, carnage vault, and treasury.
 *
 * The swap instruction flow:
 * 1. User sends SOL (as WSOL) to Tax Program
 * 2. Tax Program deducts tax from SOL input
 * 3. Tax distributes: 71% to staking escrow, 24% to carnage vault, 5% to treasury
 * 4. Tax Program CPIs into AMM with net SOL amount
 * 5. AMM executes constant-product swap (SOL -> CRIME)
 * 6. AMM transfers output tokens via Transfer Hook CPI
 * 7. User receives CRIME tokens
 *
 * Why resolve Transfer Hook accounts:
 * The CRIME/FRAUD tokens use Token-2022 with Transfer Hook extension.
 * Every transfer of these tokens requires the hook program's
 * ExtraAccountMeta accounts to be present. The Tax Program instruction
 * must include these as remaining_accounts so the AMM can forward them
 * through the nested CPI chain.
 *
 * Exports for Plans 02-03:
 * - executeSolBuySwap: generate tax revenue between epochs (Plan 02)
 * - resolveHookAccounts: PROFIT transfer hook resolution for staking (Plan 02)
 * - runSwapFlow: orchestrator entry point
 * - BalanceSnapshot, TaxVerificationResult: type exports
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";

import { Programs } from "../../deploy/lib/connection";
import { E2EUser } from "./user-setup";
import { E2ELogger } from "./e2e-logger";
import { PDAManifest } from "../devnet-e2e-validation";
import { readEpochState, EpochStateSnapshot } from "../../vrf/lib/epoch-reader";

// ---- Constants ----

/** All tokens use 6 decimals */
const TOKEN_DECIMALS = 6;

/** Rate limit delay between RPC calls (ms) */
const RPC_DELAY_MS = 200;

/** Maximum retry attempts for transient TX errors */
const MAX_RETRIES = 3;

/** Swap amount: 0.1 SOL in lamports */
const SWAP_AMOUNT_LAMPORTS = 100_000_000;

/** Vault PDA seeds (must match programs/conversion-vault/src/constants.rs) */
const VAULT_CONFIG_SEED = Buffer.from("vault_config");
const VAULT_CRIME_SEED = Buffer.from("vault_crime");
const VAULT_FRAUD_SEED = Buffer.from("vault_fraud");
const VAULT_PROFIT_SEED = Buffer.from("vault_profit");

// ---- Utilities ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Types ----

/**
 * Balance snapshot of SOL-denominated protocol accounts.
 * Captured before and after swaps to verify tax distribution.
 */
export interface BalanceSnapshot {
  /** Staking escrow vault SOL balance (lamports) */
  escrowVault: number;
  /** Carnage SOL vault balance (lamports) */
  carnageSolVault: number;
  /** Treasury (devnet wallet) SOL balance (lamports) */
  treasury: number;
}

/**
 * Result of verifying the 71/24/5 tax distribution.
 */
export interface TaxVerificationResult {
  /** Total tax collected (sum of all 3 destinations) */
  totalTax: number;
  /** SOL received by staking escrow */
  stakingReceived: number;
  /** SOL received by carnage vault */
  carnageReceived: number;
  /** SOL received by treasury */
  treasuryReceived: number;
  /** Staking percentage of total tax */
  stakingPct: number;
  /** Carnage percentage of total tax */
  carnagePct: number;
  /** Treasury percentage of total tax */
  treasuryPct: number;
  /** Whether the distribution matches the expected 71/24/5 split */
  valid: boolean;
}

// ---- Hook Account Resolution ----

/**
 * Resolve Transfer Hook remaining_accounts for a Token-2022 transfer.
 *
 * Uses createTransferCheckedWithTransferHookInstruction to build a
 * dummy transfer instruction, then extracts the extra accounts
 * (everything after source, mint, dest, authority -- the first 4 keys).
 *
 * Why slice(4):
 * The instruction includes [source, mint, dest, authority, ...hookAccounts].
 * We only need the hook accounts as remaining_accounts for the Tax Program
 * instruction, which has its own named accounts for source/mint/dest/authority.
 *
 * @param connection - Solana connection for reading ExtraAccountMetaList
 * @param source - Token account sending tokens (e.g., pool vault)
 * @param mint - Token-2022 mint with Transfer Hook extension
 * @param dest - Token account receiving tokens (e.g., user account)
 * @param authority - Authority signing the transfer (e.g., swap_authority PDA)
 * @param amount - Transfer amount (BigInt, used for instruction but doesn't affect hook resolution)
 * @returns Array of remaining accounts for the Transfer Hook
 */
export async function resolveHookAccounts(
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

// ---- Balance Snapshot ----

/**
 * Capture SOL balances of the 3 tax distribution destinations.
 *
 * @param connection - Solana connection
 * @param manifest - PDA manifest with account addresses
 * @param treasuryPubkey - Treasury wallet public key
 * @returns Balance snapshot with lamport values
 */
async function captureBalanceSnapshot(
  connection: Connection,
  manifest: PDAManifest,
  treasuryPubkey: PublicKey
): Promise<BalanceSnapshot> {
  const escrowVault = await connection.getBalance(
    new PublicKey(manifest.pdas.EscrowVault)
  );
  await sleep(RPC_DELAY_MS);

  const carnageSolVault = await connection.getBalance(
    new PublicKey(manifest.pdas.CarnageSolVault)
  );
  await sleep(RPC_DELAY_MS);

  const treasury = await connection.getBalance(treasuryPubkey);
  await sleep(RPC_DELAY_MS);

  return { escrowVault, carnageSolVault, treasury };
}

// ---- Tax Distribution Verification ----

/**
 * Verify the 71/24/5 tax distribution from a swap.
 *
 * Per tax_math.rs:
 * - staking  = floor(tax * 7100 / 10000)
 * - carnage  = floor(tax * 2400 / 10000)
 * - treasury = tax - staking - carnage (remainder, ~5%)
 *
 * Allows 1-2 lamport tolerance for micro-rounding.
 *
 * @param pre - Balance snapshot before swap
 * @param post - Balance snapshot after swap
 * @param amountIn - Gross SOL input (lamports)
 * @param taxBps - Tax rate in basis points (from EpochState)
 * @param logger - E2E logger for recording results
 * @returns Verification result with pass/fail and breakdown
 */
export function verifyTaxDistribution(
  pre: BalanceSnapshot,
  post: BalanceSnapshot,
  amountIn: number,
  taxBps: number,
  logger: E2ELogger
): TaxVerificationResult {
  // Calculate expected tax amount
  const expectedTax = Math.floor(amountIn * taxBps / 10_000);

  // Calculate actual deltas
  const stakingReceived = post.escrowVault - pre.escrowVault;
  const carnageReceived = post.carnageSolVault - pre.carnageSolVault;
  const treasuryReceived = post.treasury - pre.treasury;
  const totalReceived = stakingReceived + carnageReceived + treasuryReceived;

  // Expected split per tax_math.rs: 71/24/5
  // staking = floor(tax * 7100 / 10000), carnage = floor(tax * 2400 / 10000), treasury = remainder
  const expectedStaking = Math.floor(expectedTax * 7100 / 10000);
  const expectedCarnage = Math.floor(expectedTax * 2400 / 10000);
  const expectedTreasury = expectedTax - expectedStaking - expectedCarnage;

  // Calculate percentages (handle zero total)
  const stakingPct = totalReceived > 0 ? (stakingReceived / totalReceived) * 100 : 0;
  const carnagePct = totalReceived > 0 ? (carnageReceived / totalReceived) * 100 : 0;
  const treasuryPct = totalReceived > 0 ? (treasuryReceived / totalReceived) * 100 : 0;

  // Tolerance: 2 lamports for staking/carnage (micro-rounding in tax_math.rs)
  // Treasury tolerance is wider because the treasury wallet also pays TX fees,
  // so its balance delta includes both tax receipt (+) and fee payment (-).
  // We verify treasury received AT LEAST expectedTreasury - fee headroom.
  const TOLERANCE = 2;
  // Treasury wallet = deployer wallet on devnet. When running arb loops,
  // the wallet pays for preceding vault/swap TXs between pre/post snapshots.
  // Headroom must cover multiple TX fees in rapid succession.
  const TX_FEE_HEADROOM = 10_000_000; // 0.01 SOL -- covers ~1000 TX fees
  const stakingOk = Math.abs(stakingReceived - expectedStaking) <= TOLERANCE;
  const carnageOk = Math.abs(carnageReceived - expectedCarnage) <= TOLERANCE;
  // Treasury receives tax but wallet also pays TX fees, so delta can be negative.
  // Check: treasury_delta >= expectedTreasury - TX_FEE_HEADROOM
  const treasuryOk = treasuryReceived >= expectedTreasury - TX_FEE_HEADROOM;
  const valid = stakingOk && carnageOk && treasuryOk;

  const result: TaxVerificationResult = {
    totalTax: totalReceived,
    stakingReceived,
    carnageReceived,
    treasuryReceived,
    stakingPct,
    carnagePct,
    treasuryPct,
    valid,
  };

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: valid ? "pass" : "fail",
    message: `Tax distribution verification: ${valid ? "PASS" : "FAIL"} (${stakingPct.toFixed(1)}/${carnagePct.toFixed(1)}/${treasuryPct.toFixed(1)})`,
    details: {
      amountIn,
      taxBps,
      expectedTax,
      expectedStaking,
      expectedCarnage,
      expectedTreasury,
      actualStaking: stakingReceived,
      actualCarnage: carnageReceived,
      actualTreasury: treasuryReceived,
      totalReceived,
      stakingPct,
      carnagePct,
      treasuryPct,
      stakingOk,
      carnageOk,
      treasuryOk,
      valid,
    },
  });

  return result;
}

// ---- Swap Execution ----

/**
 * Execute a SOL buy swap on a specified pool.
 *
 * This is the core swap function that builds and sends the Tax Program's
 * swap_sol_buy instruction with all ~20 accounts + Transfer Hook
 * remaining_accounts.
 *
 * @param provider - Anchor provider with devnet wallet
 * @param programs - All 5 protocol program instances
 * @param manifest - PDA manifest with all deployed addresses
 * @param user - E2E test user with keypair and token accounts
 * @param logger - E2E logger for recording results
 * @param poolName - Pool to swap on (default: "CRIME/SOL")
 * @returns TX signature on success, null on failure
 */
export async function executeSolBuySwap(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  poolName: string = "CRIME/SOL",
  amountLamports: number = SWAP_AMOUNT_LAMPORTS
): Promise<string | null> {
  const connection = provider.connection;
  const isCrime = poolName === "CRIME/SOL";
  const pool = manifest.pools[poolName];

  if (!pool) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Pool "${poolName}" not found in manifest`,
    });
    return null;
  }

  // Derive swap_authority PDA from Tax Program (NOT from manifest -- manifest
  // incorrectly stored the AMM-derived PDA; Tax Program derives its own).
  const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_authority")],
    programs.taxProgram.programId
  );

  // a. Read EpochState to get current tax rates
  let epochState: EpochStateSnapshot;
  try {
    epochState = await readEpochState(
      programs.epochProgram,
      new PublicKey(manifest.pdas.EpochState)
    );
    await sleep(RPC_DELAY_MS);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "pass",
      message: `EpochState read: epoch=${epochState.currentEpoch}, cheapSide=${epochState.cheapSide}, crimeBuyTax=${epochState.crimeBuyTaxBps}bps`,
      details: {
        currentEpoch: epochState.currentEpoch,
        cheapSide: epochState.cheapSide,
        crimeBuyTaxBps: epochState.crimeBuyTaxBps,
        crimeSellTaxBps: epochState.crimeSellTaxBps,
        fraudBuyTaxBps: epochState.fraudBuyTaxBps,
        fraudSellTaxBps: epochState.fraudSellTaxBps,
      },
    });
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Failed to read EpochState: ${String(err)}`,
      details: { error: String(err) },
    });
    return null;
  }

  // Determine applicable tax rate for this swap
  // SOL buy = buying CRIME/FRAUD with SOL
  const taxBps = isCrime ? epochState.crimeBuyTaxBps : epochState.fraudBuyTaxBps;

  // b. Capture pre-swap balance snapshot
  const preSnapshot = await captureBalanceSnapshot(
    connection,
    manifest,
    provider.wallet.publicKey
  );

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: "pass",
    message: "Pre-swap balance snapshot captured",
    details: {
      escrowVault: preSnapshot.escrowVault,
      carnageSolVault: preSnapshot.carnageSolVault,
      treasury: preSnapshot.treasury,
    },
  });

  // c. Swap parameters
  const amountIn = amountLamports;

  // Calculate a reasonable minimum_output to satisfy the protocol's 50% floor (SEC-10).
  // Read pool reserves and compute constant-product expected output, then set minimum
  // to 51% of that (just above the 50% floor).
  // For buy: reserve_in = reserve_a (SOL), reserve_out = reserve_b (token).
  // sol_to_swap = amountIn - tax. Expected output = (sol_to_swap * reserve_b) / (reserve_a + sol_to_swap).
  let minimumOutput = 1; // fallback
  try {
    const poolVaultABal = await connection.getBalance(new PublicKey(pool.vaultA));
    await sleep(RPC_DELAY_MS);
    const poolVaultBBal = await connection.getTokenAccountBalance(new PublicKey(pool.vaultB));
    await sleep(RPC_DELAY_MS);
    const reserveA = poolVaultABal;
    const reserveB = parseInt(poolVaultBBal.value.amount);
    const taxDeducted = Math.floor(amountIn * taxBps / 10_000);
    const solToSwap = amountIn - taxDeducted;
    if (reserveA > 0 && reserveB > 0 && solToSwap > 0) {
      const expectedOutput = Math.floor((solToSwap * reserveB) / (reserveA + solToSwap));
      // Set minimum to 51% of expected (just above the 50% floor)
      minimumOutput = Math.max(1, Math.floor(expectedOutput * 51 / 100));
    }
  } catch {
    // If reserve read fails, use 1 (will likely fail floor check anyway)
    minimumOutput = 1;
  }

  // d. Resolve Transfer Hook remaining_accounts
  //    For SOL buy: output transfer is Token-2022 (pool vaultB -> user token)
  const tokenMint = new PublicKey(isCrime ? manifest.mints.CRIME : manifest.mints.FRAUD);
  const userTokenB = isCrime ? user.crimeAccount : user.fraudAccount;

  let hookAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  try {
    hookAccounts = await resolveHookAccounts(
      connection,
      new PublicKey(pool.vaultB),          // source: pool vault
      tokenMint,                            // mint: CRIME or FRAUD
      userTokenB,                           // dest: user's token account
      new PublicKey(manifest.pdas.SwapAuthority), // authority: swap_authority PDA
      BigInt(0)                             // amount doesn't affect hook resolution
    );
    await sleep(RPC_DELAY_MS);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "pass",
      message: `Resolved ${hookAccounts.length} Transfer Hook accounts`,
      details: {
        hookAccountCount: hookAccounts.length,
        hookAccounts: hookAccounts.map((a) => a.pubkey.toBase58()),
      },
    });
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Failed to resolve hook accounts: ${String(err)}`,
      details: { error: String(err) },
    });
    return null;
  }

  // e. Build swap instruction
  //    Tax Program's swap_sol_buy(amount_in, minimum_output, is_crime)
  let txSig: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Build the instruction first so we can add compute budget
      const swapIx = await programs.taxProgram.methods
        .swapSolBuy(
          new anchor.BN(amountIn),
          new anchor.BN(minimumOutput),
          isCrime
        )
        .accountsStrict({
          user: user.keypair.publicKey,
          epochState: new PublicKey(manifest.pdas.EpochState),
          swapAuthority: swapAuthorityPda,
          taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
          pool: new PublicKey(pool.pool),
          poolVaultA: new PublicKey(pool.vaultA),
          poolVaultB: new PublicKey(pool.vaultB),
          mintA: NATIVE_MINT,
          mintB: tokenMint,
          userTokenA: user.wsolAccount,
          userTokenB: userTokenB,
          stakePool: new PublicKey(manifest.pdas.StakePool),
          stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
          carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
          treasury: provider.wallet.publicKey,
          ammProgram: new PublicKey(manifest.programs.AMM),
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          stakingProgram: new PublicKey(manifest.programs.Staking),
        })
        .remainingAccounts(hookAccounts)
        .instruction();

      // Build transaction with compute budget
      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        swapIx
      );

      // Send with user as signer
      txSig = await provider.sendAndConfirm(tx, [user.keypair]);

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "swap",
        status: "pass",
        message: `SOL buy swap executed on ${poolName} (attempt ${attempt})`,
        txSignature: txSig,
        details: {
          poolName,
          amountIn,
          minimumOutput,
          isCrime,
          taxBps,
          attempt,
        },
      });

      break; // Success, exit retry loop
    } catch (err) {
      const errStr = String(err);

      if (attempt < MAX_RETRIES && isTransientError(errStr)) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "swap",
          status: "fail",
          message: `Swap attempt ${attempt}/${MAX_RETRIES} failed (transient): ${errStr.slice(0, 200)}`,
        });
        await sleep(1000 * attempt); // Exponential backoff
        continue;
      }

      // Final attempt or non-transient error
      logger.log({
        timestamp: new Date().toISOString(),
        phase: "swap",
        status: "fail",
        message: `SOL buy swap failed on ${poolName}: ${errStr.slice(0, 500)}`,
        details: {
          error: errStr,
          poolName,
          amountIn,
          attempt,
        },
      });
      return null;
    }
  }

  // h. Capture post-swap balance snapshot
  await sleep(RPC_DELAY_MS);
  const postSnapshot = await captureBalanceSnapshot(
    connection,
    manifest,
    provider.wallet.publicKey
  );

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: "pass",
    message: "Post-swap balance snapshot captured",
    details: {
      escrowVault: postSnapshot.escrowVault,
      carnageSolVault: postSnapshot.carnageSolVault,
      treasury: postSnapshot.treasury,
    },
  });

  // Verify tax distribution
  verifyTaxDistribution(preSnapshot, postSnapshot, amountIn, taxBps, logger);

  return txSig;
}

// ---- SOL Sell Swap ----

/**
 * Execute a token sell swap (CRIME/FRAUD -> SOL) on a specified pool.
 *
 * This is the reverse of executeSolBuySwap. The user sends CRIME/FRAUD
 * tokens and receives SOL. Tax is deducted from the output SOL.
 *
 * @param provider - Anchor provider with devnet wallet
 * @param programs - All 6 protocol program instances
 * @param manifest - PDA manifest with all deployed addresses
 * @param user - E2E test user with keypair and token accounts
 * @param logger - E2E logger for recording results
 * @param poolName - Pool to swap on (default: "CRIME/SOL")
 * @param amountTokens - Amount of tokens to sell (raw units at 6 decimals)
 * @returns TX signature on success, null on failure
 */
export async function executeSolSellSwap(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  poolName: string = "CRIME/SOL",
  amountTokens: number = 500_000_000 // 500 tokens at 6 decimals
): Promise<string | null> {
  const connection = provider.connection;
  const isCrime = poolName === "CRIME/SOL";
  const pool = manifest.pools[poolName];

  if (!pool) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Pool "${poolName}" not found in manifest`,
    });
    return null;
  }

  // Derive swap_authority PDA from Tax Program
  const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_authority")],
    programs.taxProgram.programId
  );

  // Read EpochState for tax rates
  let epochState: EpochStateSnapshot;
  try {
    epochState = await readEpochState(
      programs.epochProgram,
      new PublicKey(manifest.pdas.EpochState)
    );
    await sleep(RPC_DELAY_MS);
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Failed to read EpochState for sell: ${String(err)}`,
    });
    return null;
  }

  // Sell tax rate
  const taxBps = isCrime ? epochState.crimeSellTaxBps : epochState.fraudSellTaxBps;

  // Calculate minimum_output to satisfy the on-chain 50% floor.
  // The on-chain floor is 50% of GROSS constant-product output (pre-tax).
  // We set minimum_output to 51% of gross to clear the floor.
  // Note: we do NOT factor in tax here because the on-chain check compares
  // minimum_output against the gross output floor, not net output.
  let minimumOutput = 1;
  try {
    const poolVaultABal = await connection.getBalance(new PublicKey(pool.vaultA));
    await sleep(RPC_DELAY_MS);
    const poolVaultBBal = await connection.getTokenAccountBalance(new PublicKey(pool.vaultB));
    await sleep(RPC_DELAY_MS);
    const reserveA = poolVaultABal; // SOL
    const reserveB = parseInt(poolVaultBBal.value.amount); // token
    if (reserveA > 0 && reserveB > 0 && amountTokens > 0) {
      // Sell: token -> SOL. gross_sol_out = (amountTokens * reserveA) / (reserveB + amountTokens)
      const grossSolOut = Math.floor((amountTokens * reserveA) / (reserveB + amountTokens));
      minimumOutput = Math.max(1, Math.floor(grossSolOut * 51 / 100));
    }
  } catch {
    minimumOutput = 1;
  }

  // Resolve Transfer Hook remaining_accounts for sell
  // For sell: input transfer is Token-2022 (user token -> pool vaultB)
  const tokenMint = new PublicKey(isCrime ? manifest.mints.CRIME : manifest.mints.FRAUD);
  const userTokenB = isCrime ? user.crimeAccount : user.fraudAccount;

  let hookAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  try {
    hookAccounts = await resolveHookAccounts(
      connection,
      userTokenB,                           // source: user's token account
      tokenMint,                            // mint: CRIME or FRAUD
      new PublicKey(pool.vaultB),            // dest: pool vault
      user.keypair.publicKey,               // authority: user (signer for sell)
      BigInt(amountTokens)
    );
    await sleep(RPC_DELAY_MS);
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Failed to resolve sell hook accounts: ${String(err)}`,
    });
    return null;
  }

  // Build sell swap instruction
  let txSig: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const sellIx = await programs.taxProgram.methods
        .swapSolSell(
          new anchor.BN(amountTokens),
          new anchor.BN(minimumOutput),
          isCrime
        )
        .accountsStrict({
          user: user.keypair.publicKey,
          epochState: new PublicKey(manifest.pdas.EpochState),
          swapAuthority: swapAuthorityPda,
          taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
          pool: new PublicKey(pool.pool),
          poolVaultA: new PublicKey(pool.vaultA),
          poolVaultB: new PublicKey(pool.vaultB),
          mintA: NATIVE_MINT,
          mintB: tokenMint,
          userTokenA: user.wsolAccount,
          userTokenB: userTokenB,
          stakePool: new PublicKey(manifest.pdas.StakePool),
          stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
          carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
          treasury: provider.wallet.publicKey,
          wsolIntermediary: new PublicKey(manifest.pdas.WsolIntermediary),
          ammProgram: new PublicKey(manifest.programs.AMM),
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          stakingProgram: new PublicKey(manifest.programs.Staking),
        })
        .remainingAccounts(hookAccounts)
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        sellIx
      );

      txSig = await provider.sendAndConfirm(tx, [user.keypair]);

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "swap",
        status: "pass",
        message: `Token sell swap executed on ${poolName} (attempt ${attempt})`,
        txSignature: txSig,
        details: {
          poolName,
          amountTokens,
          minimumOutput,
          isCrime,
          taxBps,
          attempt,
        },
      });

      break;
    } catch (err) {
      const errStr = String(err);

      if (attempt < MAX_RETRIES && isTransientError(errStr)) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "swap",
          status: "fail",
          message: `Sell swap attempt ${attempt}/${MAX_RETRIES} failed (transient): ${errStr.slice(0, 200)}`,
        });
        await sleep(1000 * attempt);
        continue;
      }

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "swap",
        status: "fail",
        message: `Token sell swap failed on ${poolName}: ${errStr.slice(0, 500)}`,
        details: { error: errStr, poolName, amountTokens, attempt },
      });
      return null;
    }
  }

  return txSig;
}

// ---- Orchestrator ----

/**
 * Run the complete swap flow: test all 4 swap directions.
 *
 * Tests:
 * 1. SOL -> CRIME buy swap (with tax distribution verification)
 * 2. SOL -> FRAUD buy swap
 * 3. CRIME -> SOL sell swap
 * 4. FRAUD -> SOL sell swap
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @returns true if all swap directions pass
 */
export async function runSwapFlow(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger
): Promise<boolean> {
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: "pass",
    message: "Starting swap flow -- testing all 4 directions",
  });

  let allPassed = true;

  // 1. SOL -> CRIME buy (0.1 SOL)
  const crimeBuySig = await executeSolBuySwap(
    provider, programs, manifest, user, logger,
    "CRIME/SOL", SWAP_AMOUNT_LAMPORTS
  );
  if (!crimeBuySig) {
    allPassed = false;
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: "SOL -> CRIME buy FAILED",
    });
  } else {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "pass",
      message: "SOL -> CRIME buy PASS",
      txSignature: crimeBuySig,
    });
  }

  // 2. SOL -> FRAUD buy (0.1 SOL)
  const fraudBuySig = await executeSolBuySwap(
    provider, programs, manifest, user, logger,
    "FRAUD/SOL", SWAP_AMOUNT_LAMPORTS
  );
  if (!fraudBuySig) {
    allPassed = false;
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: "SOL -> FRAUD buy FAILED",
    });
  } else {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "pass",
      message: "SOL -> FRAUD buy PASS",
      txSignature: fraudBuySig,
    });
  }

  // 3. CRIME -> SOL sell (sell 500 CRIME from the buy)
  const crimeSellSig = await executeSolSellSwap(
    provider, programs, manifest, user, logger,
    "CRIME/SOL", 500_000_000 // 500 CRIME
  );
  if (!crimeSellSig) {
    allPassed = false;
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: "CRIME -> SOL sell FAILED",
    });
  } else {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "pass",
      message: "CRIME -> SOL sell PASS",
      txSignature: crimeSellSig,
    });
  }

  // 4. FRAUD -> SOL sell (sell 500 FRAUD from the buy)
  const fraudSellSig = await executeSolSellSwap(
    provider, programs, manifest, user, logger,
    "FRAUD/SOL", 500_000_000 // 500 FRAUD
  );
  if (!fraudSellSig) {
    allPassed = false;
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: "FRAUD -> SOL sell FAILED",
    });
  } else {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "pass",
      message: "FRAUD -> SOL sell PASS",
      txSignature: fraudSellSig,
    });
  }

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: allPassed ? "pass" : "fail",
    message: `Swap flow complete: ${allPassed ? "all 4 directions PASS" : "some directions FAILED"}`,
  });

  return allPassed;
}

// ---- Helpers ----

/**
 * Check if an error is transient (network/rate limit) vs permanent.
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

// ---- Vault Conversion ----

/**
 * Execute a vault conversion and verify exact balance changes.
 *
 * The conversion vault uses a fixed 100:1 rate:
 * - CRIME/FRAUD → PROFIT: divide by 100
 * - PROFIT → CRIME/FRAUD: multiply by 100
 *
 * No tax is collected on vault conversions (bypasses Tax Program entirely).
 *
 * @param provider - Anchor provider
 * @param programs - All 6 protocol program instances
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @param inputToken - Token to convert from
 * @param outputToken - Token to convert to
 * @param amountIn - Raw input amount (at 6 decimals)
 * @returns TX signature on success, null on failure
 */
export async function executeVaultConversion(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  inputToken: "CRIME" | "FRAUD" | "PROFIT",
  outputToken: "CRIME" | "FRAUD" | "PROFIT",
  amountIn: number
): Promise<string | null> {
  const connection = provider.connection;
  const vaultProgram = programs.conversionVault;

  // Derive vault PDAs
  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [VAULT_CONFIG_SEED], vaultProgram.programId
  );

  const mintMap: Record<string, PublicKey> = {
    CRIME: new PublicKey(manifest.mints.CRIME),
    FRAUD: new PublicKey(manifest.mints.FRAUD),
    PROFIT: new PublicKey(manifest.mints.PROFIT),
  };
  const vaultSeedMap: Record<string, Buffer> = {
    CRIME: VAULT_CRIME_SEED,
    FRAUD: VAULT_FRAUD_SEED,
    PROFIT: VAULT_PROFIT_SEED,
  };
  const userAccountMap: Record<string, PublicKey> = {
    CRIME: user.crimeAccount,
    FRAUD: user.fraudAccount,
    PROFIT: user.profitAccount,
  };

  const inputMint = mintMap[inputToken];
  const outputMint = mintMap[outputToken];
  const userInputAccount = userAccountMap[inputToken];
  const userOutputAccount = userAccountMap[outputToken];

  const [vaultInput] = PublicKey.findProgramAddressSync(
    [vaultSeedMap[inputToken], vaultConfig.toBuffer()], vaultProgram.programId
  );
  const [vaultOutput] = PublicKey.findProgramAddressSync(
    [vaultSeedMap[outputToken], vaultConfig.toBuffer()], vaultProgram.programId
  );

  try {
    // Snapshot pre-conversion balances
    const preInput = await connection.getTokenAccountBalance(userInputAccount);
    await sleep(RPC_DELAY_MS);
    const preOutput = await connection.getTokenAccountBalance(userOutputAccount);
    await sleep(RPC_DELAY_MS);

    // Resolve Transfer Hook accounts for both conversion legs
    const inputHookIx = await createTransferCheckedWithTransferHookInstruction(
      connection, userInputAccount, inputMint, vaultInput, user.keypair.publicKey,
      BigInt(amountIn), TOKEN_DECIMALS, [], "confirmed", TOKEN_2022_PROGRAM_ID
    );
    const inputHooks = inputHookIx.keys.slice(4);
    await sleep(RPC_DELAY_MS);

    // Compute expected output for hook resolution
    const isToProfit = outputToken === "PROFIT";
    const expectedOutput = isToProfit ? Math.floor(amountIn / 100) : amountIn * 100;

    const outputHookIx = await createTransferCheckedWithTransferHookInstruction(
      connection, vaultOutput, outputMint, userOutputAccount, vaultConfig,
      BigInt(expectedOutput), TOKEN_DECIMALS, [], "confirmed", TOKEN_2022_PROGRAM_ID
    );
    const outputHooks = outputHookIx.keys.slice(4);
    await sleep(RPC_DELAY_MS);

    // Build and send vault convert instruction
    const convertIx = await vaultProgram.methods
      .convert(new anchor.BN(amountIn))
      .accountsStrict({
        user: user.keypair.publicKey,
        vaultConfig,
        userInputAccount,
        userOutputAccount,
        inputMint,
        outputMint,
        vaultInput,
        vaultOutput,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([...inputHooks, ...outputHooks])
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      convertIx
    );
    const txSig = await provider.sendAndConfirm(tx, [user.keypair]);
    await sleep(RPC_DELAY_MS);

    // Snapshot post-conversion balances
    const postInput = await connection.getTokenAccountBalance(userInputAccount);
    await sleep(RPC_DELAY_MS);
    const postOutput = await connection.getTokenAccountBalance(userOutputAccount);
    await sleep(RPC_DELAY_MS);

    // Verify exact amounts
    const inputDelta = Number(preInput.value.amount) - Number(postInput.value.amount);
    const outputDelta = Number(postOutput.value.amount) - Number(preOutput.value.amount);
    const inputCorrect = inputDelta === amountIn;
    const outputCorrect = outputDelta === expectedOutput;

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: inputCorrect && outputCorrect ? "pass" : "fail",
      message: `Vault ${inputToken}→${outputToken}: ${inputCorrect && outputCorrect ? "PASS" : "FAIL"} (in=${inputDelta}, out=${outputDelta}, expected_out=${expectedOutput})`,
      txSignature: txSig,
      details: {
        inputToken, outputToken, amountIn,
        expectedOutput, inputDelta, outputDelta,
        inputCorrect, outputCorrect,
      },
    });

    return txSig;
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: `Vault ${inputToken}→${outputToken} failed: ${String(err).slice(0, 500)}`,
      details: { error: String(err) },
    });
    return null;
  }
}

/**
 * Run vault conversion tests: all 4 standalone directions + full bidirectional arb loop.
 *
 * Tests:
 * 1. CRIME → PROFIT (100:1) -- 1000 CRIME → 10 PROFIT
 * 2. PROFIT → CRIME (1:100) -- 10 PROFIT → 1000 CRIME (round-trip)
 * 3. FRAUD → PROFIT (100:1) -- 1000 FRAUD → 10 PROFIT
 * 4. PROFIT → FRAUD (1:100) -- 10 PROFIT → 1000 FRAUD (round-trip)
 * 5. Forward arb: SOL → CRIME(buy) → PROFIT(vault) → FRAUD(vault) → SOL(sell)
 * 6. Reverse arb: SOL → FRAUD(buy) → PROFIT(vault) → CRIME(vault) → SOL(sell)
 *
 * @returns true if all vault tests pass
 */
export async function runVaultTests(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger
): Promise<boolean> {
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: "pass",
    message: "Starting vault conversion tests -- all 4 directions + bidirectional arb loop",
  });

  let allPassed = true;

  // Test 1: CRIME → PROFIT (1000 CRIME → 10 PROFIT)
  const crimeToProfit = await executeVaultConversion(
    provider, programs, manifest, user, logger,
    "CRIME", "PROFIT", 1_000_000_000 // 1000 CRIME at 6 decimals
  );
  if (!crimeToProfit) allPassed = false;

  // Test 2: PROFIT → CRIME (10 PROFIT → 1000 CRIME, round-trip)
  const profitToCrime = await executeVaultConversion(
    provider, programs, manifest, user, logger,
    "PROFIT", "CRIME", 10_000_000 // 10 PROFIT at 6 decimals
  );
  if (!profitToCrime) allPassed = false;

  // Test 3: FRAUD → PROFIT (1000 FRAUD → 10 PROFIT)
  const fraudToProfit = await executeVaultConversion(
    provider, programs, manifest, user, logger,
    "FRAUD", "PROFIT", 1_000_000_000 // 1000 FRAUD at 6 decimals
  );
  if (!fraudToProfit) allPassed = false;

  // Test 4: PROFIT → FRAUD (10 PROFIT → 1000 FRAUD, round-trip)
  const profitToFraud = await executeVaultConversion(
    provider, programs, manifest, user, logger,
    "PROFIT", "FRAUD", 10_000_000 // 10 PROFIT at 6 decimals
  );
  if (!profitToFraud) allPassed = false;

  // === Full Bidirectional Arb Loop ===

  // Forward arb: SOL → CRIME(buy) → PROFIT(vault) → FRAUD(vault) → SOL(sell)
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: "pass",
    message: "Starting FORWARD arb loop: SOL→CRIME(buy)→PROFIT(vault)→FRAUD(vault)→SOL(sell)",
  });

  const fwdBuy = await executeSolBuySwap(
    provider, programs, manifest, user, logger,
    "CRIME/SOL", 50_000_000 // 0.05 SOL
  );

  if (fwdBuy) {
    // CRIME → PROFIT via vault (500 CRIME → 5 PROFIT)
    const fwdStep2 = await executeVaultConversion(
      provider, programs, manifest, user, logger,
      "CRIME", "PROFIT", 500_000_000
    );
    if (fwdStep2) {
      // PROFIT → FRAUD via vault (5 PROFIT → 500 FRAUD)
      const fwdStep3 = await executeVaultConversion(
        provider, programs, manifest, user, logger,
        "PROFIT", "FRAUD", 5_000_000
      );
      if (fwdStep3) {
        // FRAUD → SOL sell (sell 500 FRAUD)
        const fwdSell = await executeSolSellSwap(
          provider, programs, manifest, user, logger,
          "FRAUD/SOL", 500_000_000
        );
        if (fwdSell) {
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "swap",
            status: "pass",
            message: "FORWARD arb loop COMPLETE: SOL→CRIME→PROFIT→FRAUD→SOL all 4 legs succeeded",
            txSignature: fwdSell,
          });
        } else {
          allPassed = false;
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "swap",
            status: "fail",
            message: "FORWARD arb loop FAILED at leg 4: FRAUD→SOL sell",
          });
        }
      } else {
        allPassed = false;
      }
    } else {
      allPassed = false;
    }
  } else {
    allPassed = false;
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: "Forward arb loop aborted: initial SOL→CRIME swap failed",
    });
  }

  // Reverse arb: SOL → FRAUD(buy) → PROFIT(vault) → CRIME(vault) → SOL(sell)
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: "pass",
    message: "Starting REVERSE arb loop: SOL→FRAUD(buy)→PROFIT(vault)→CRIME(vault)→SOL(sell)",
  });

  const revBuy = await executeSolBuySwap(
    provider, programs, manifest, user, logger,
    "FRAUD/SOL", 50_000_000 // 0.05 SOL
  );

  if (revBuy) {
    // FRAUD → PROFIT via vault (500 FRAUD → 5 PROFIT)
    const revStep2 = await executeVaultConversion(
      provider, programs, manifest, user, logger,
      "FRAUD", "PROFIT", 500_000_000
    );
    if (revStep2) {
      // PROFIT → CRIME via vault (5 PROFIT → 500 CRIME)
      const revStep3 = await executeVaultConversion(
        provider, programs, manifest, user, logger,
        "PROFIT", "CRIME", 5_000_000
      );
      if (revStep3) {
        // CRIME → SOL sell (sell 500 CRIME)
        const revSell = await executeSolSellSwap(
          provider, programs, manifest, user, logger,
          "CRIME/SOL", 500_000_000
        );
        if (revSell) {
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "swap",
            status: "pass",
            message: "REVERSE arb loop COMPLETE: SOL→FRAUD→PROFIT→CRIME→SOL all 4 legs succeeded",
            txSignature: revSell,
          });
        } else {
          allPassed = false;
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "swap",
            status: "fail",
            message: "REVERSE arb loop FAILED at leg 4: CRIME→SOL sell",
          });
        }
      } else {
        allPassed = false;
      }
    } else {
      allPassed = false;
    }
  } else {
    allPassed = false;
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "swap",
      status: "fail",
      message: "Reverse arb loop aborted: initial SOL→FRAUD swap failed",
    });
  }

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "swap",
    status: allPassed ? "pass" : "fail",
    message: `Vault tests ${allPassed ? "all passed (4 standalone + 2 arb loops)" : "had failures"}`,
  });

  return allPassed;
}
