/**
 * E2E Fresh User Wallet Setup
 *
 * Creates a brand-new Keypair, funds it via SOL transfer from the
 * devnet wallet (never airdrop -- CONTEXT.md locks this decision),
 * creates Token-2022 accounts for CRIME/FRAUD/PROFIT, and creates
 * a WSOL account.
 *
 * Why fresh wallet per run:
 * - Clean state: no leftover accounts, stakes, or approvals
 * - Deterministic starting conditions for every test
 * - Avoids PDA collisions with previous test user_stake accounts
 *
 * Why SOL transfer (not airdrop):
 * - Devnet faucet has rate limits and occasionally fails
 * - SOL transfer from funded wallet is instant and reliable
 * - CONTEXT.md explicitly prohibits airdrop
 *
 * Token acquisition (Phase 69 change):
 * - Mint authorities are revoked (fixed supply). Tokens cannot be minted.
 * - Tokens are acquired through protocol interactions (buy swaps, vault
 *   conversions) by the E2E orchestrator after user creation.
 * - This function only creates empty token accounts.
 *
 * Token program assignment:
 * - CRIME/FRAUD/PROFIT: Token-2022 (TOKEN_2022_PROGRAM_ID) with Transfer Hook
 * - WSOL: Standard SPL Token (TOKEN_PROGRAM_ID) -- native SOL has no hooks
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAccount,
  createWrappedNativeAccount,
} from "@solana/spl-token";
import { AnchorProvider } from "@coral-xyz/anchor";

// ---- Constants ----

/** Rate limit delay between RPC calls (ms) for Helius free tier */
const RPC_DELAY_MS = 200;

// ---- Utilities ----

/**
 * Sleep for a given number of milliseconds.
 * Local definition to avoid cross-module dependency issues.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Interfaces ----

/**
 * A fully-funded E2E test user with all token accounts.
 *
 * This user can execute swaps on any SOL pool (CRIME/SOL, FRAUD/SOL)
 * and stake PROFIT tokens.
 */
export interface E2EUser {
  /** User's signing keypair */
  keypair: Keypair;
  /** WSOL token account (standard SPL Token) */
  wsolAccount: PublicKey;
  /** CRIME token account (Token-2022) */
  crimeAccount: PublicKey;
  /** FRAUD token account (Token-2022) */
  fraudAccount: PublicKey;
  /** PROFIT token account (Token-2022) */
  profitAccount: PublicKey;
}

/**
 * PDA manifest shape (subset of fields needed for user setup).
 * Loaded via loadDeployment() from deployments/devnet.json.
 */
export interface ManifestMints {
  CRIME: string;
  FRAUD: string;
  PROFIT: string;
}

// ---- Main Function ----

/**
 * Create a fresh E2E test user with funded wallet, token accounts, and WSOL.
 *
 * NOTE: Mint authorities are revoked (fixed supply). This function does NOT
 * mint tokens. The caller must acquire CRIME/FRAUD via SOL buy swaps and
 * PROFIT via vault conversion after this returns.
 *
 * Steps:
 * 1. Generate new Keypair
 * 2. Fund via SystemProgram.transfer from devnet wallet (NOT airdrop)
 * 3. Create Token-2022 accounts for CRIME, FRAUD, PROFIT
 * 4. Create WSOL account with the specified SOL amount
 *
 * @param provider - Anchor provider with devnet wallet as payer
 * @param mints - Mint addresses from PDA manifest
 * @param solAmount - Amount of SOL (in lamports) to wrap as WSOL (default: 2 SOL)
 * @param _vaultProgram - Deprecated parameter (kept for API compat, unused)
 * @returns E2EUser with empty token accounts, ready for swap-based token acquisition
 */
export async function createE2EUser(
  provider: AnchorProvider,
  mints: ManifestMints,
  solAmount: number = 2 * LAMPORTS_PER_SOL,
  _vaultProgram?: any
): Promise<E2EUser> {
  const connection = provider.connection;

  // 1. Generate fresh keypair
  const userKp = Keypair.generate();

  // 2. Fund user via SOL transfer (NOT airdrop)
  //    We send enough for: WSOL wrapping + token account rent + TX fees
  //    Overhead: ~0.003 SOL rent per Token-2022 account * 4 + TX fees ≈ 0.1 SOL
  const fundAmount = solAmount + Math.round(0.1 * LAMPORTS_PER_SOL);
  const fundIx = SystemProgram.transfer({
    fromPubkey: provider.wallet.publicKey,
    toPubkey: userKp.publicKey,
    lamports: fundAmount,
  });
  const fundTx = new Transaction().add(fundIx);
  await provider.sendAndConfirm(fundTx, []);
  await sleep(RPC_DELAY_MS);

  // 3. Create Token-2022 accounts for CRIME, FRAUD, PROFIT
  const crimeMint = new PublicKey(mints.CRIME);
  const fraudMint = new PublicKey(mints.FRAUD);
  const profitMint = new PublicKey(mints.PROFIT);

  // CRIME account
  const crimeAccount = await createAccount(
    connection,
    userKp,        // payer for rent
    crimeMint,
    userKp.publicKey, // owner
    undefined,     // keypair (auto-generate)
    undefined,     // confirmOptions
    TOKEN_2022_PROGRAM_ID
  );
  await sleep(RPC_DELAY_MS);

  // FRAUD account
  const fraudAccount = await createAccount(
    connection,
    userKp,
    fraudMint,
    userKp.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  await sleep(RPC_DELAY_MS);

  // PROFIT account
  const profitAccount = await createAccount(
    connection,
    userKp,
    profitMint,
    userKp.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  await sleep(RPC_DELAY_MS);

  // 4. Create WSOL account (standard SPL Token, NOT Token-2022)
  //    Native SOL has no transfer hooks.
  const wsolAccount = await createWrappedNativeAccount(
    connection,
    userKp,              // payer
    userKp.publicKey,    // owner
    solAmount,           // lamports to wrap
    undefined,           // keypair
    undefined,           // confirmOptions
    TOKEN_PROGRAM_ID
  );
  await sleep(RPC_DELAY_MS);

  return {
    keypair: userKp,
    wsolAccount,
    crimeAccount,
    fraudAccount,
    profitAccount,
  };
}
