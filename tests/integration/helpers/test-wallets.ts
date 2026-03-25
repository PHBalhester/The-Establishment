/**
 * Role-Based Test Wallet Factory
 *
 * Creates 4 wallets with distinct roles for integration testing:
 * - trader:  The primary swap user. Has all 3 meme tokens + wrapped SOL.
 * - staker:  Stakes PROFIT for yield. Only holds PROFIT.
 * - admin:   Protocol authority. Signs admin-only instructions.
 * - attacker: Attempts unauthorized operations. Small balances only.
 *
 * Each wallet gets an SOL airdrop and the appropriate Token-2022 accounts
 * pre-funded so tests can focus on protocol logic, not account setup.
 *
 * NOTE: Token accounts for CRIME/FRAUD/PROFIT are Token-2022 (with transfer hook).
 * The WSOL account uses standard SPL Token (no hook on native SOL).
 *
 * Source: .planning/phases/31-integration-test-infrastructure/31-01-PLAN.md
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAccount,
  mintTo,
  createWrappedNativeAccount,
} from "@solana/spl-token";
import { TOKEN_DECIMALS } from "./constants";

// =============================================================================
// Types
// =============================================================================

/**
 * A single test wallet with its keypair and associated token accounts.
 *
 * tokenAccounts is a Map keyed by mint address string for flexible lookup
 * across different token types (CRIME, FRAUD, PROFIT).
 */
export interface TestWallet {
  keypair: Keypair;
  /** Wrapped SOL account (standard SPL Token, not Token-2022) */
  wsolAccount?: PublicKey;
  /** PROFIT token account shortcut for staker role */
  profitAccount?: PublicKey;
  /** Map of mint address -> token account address */
  tokenAccounts: Map<string, PublicKey>;
}

/**
 * Complete set of test wallets for integration tests.
 *
 * Why 4 roles:
 * - trader: Tests normal swap/trade flows with all tokens
 * - staker: Tests staking flows (only needs PROFIT)
 * - admin:  Tests admin-gated instructions (initialize, configure)
 * - attacker: Tests unauthorized access (should fail everywhere)
 */
export interface TestWallets {
  trader: TestWallet;
  staker: TestWallet;
  admin: TestWallet;
  attacker: TestWallet;
}

/**
 * Mint addresses to create token accounts for.
 * All three are Token-2022 mints with transfer hook extensions.
 */
export interface TestMints {
  crimeMint: PublicKey;
  fraudMint: PublicKey;
  profitMint: PublicKey;
}

// =============================================================================
// Constants
// =============================================================================

/** Amounts in base units (6 decimals). 1000 tokens = 1_000_000_000 */
const TOKENS_1000 = 1_000 * 10 ** TOKEN_DECIMALS;
const TOKENS_100 = 100 * 10 ** TOKEN_DECIMALS;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Airdrop SOL and wait for confirmation.
 *
 * Why separate helper: Airdrop + confirm is 2 calls that every wallet
 * needs. Extracting avoids repeating the confirm pattern 4 times.
 */
async function airdropSol(
  connection: Connection,
  recipient: PublicKey,
  lamports: number
): Promise<void> {
  const sig = await connection.requestAirdrop(recipient, lamports);
  await connection.confirmTransaction(sig);
}

/**
 * Create a Token-2022 account and mint tokens into it.
 *
 * Why combined: Every test wallet needs create + mint as an atomic pair.
 * Having them separate would double the number of await calls.
 *
 * @param connection - Solana connection
 * @param payer - Keypair paying for account creation
 * @param mint - Token-2022 mint address
 * @param owner - Owner of the new token account
 * @param mintAuthority - Authority that can mint tokens
 * @param amount - Amount to mint (base units)
 * @returns The new token account address
 */
async function createAndFundToken2022Account(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  mintAuthority: Keypair,
  amount: number
): Promise<PublicKey> {
  // Create the Token-2022 account
  const tokenAccount = await createAccount(
    connection,
    payer,
    mint,
    owner,
    undefined, // keypair (auto-generate)
    undefined, // confirmOptions
    TOKEN_2022_PROGRAM_ID
  );

  // Mint tokens if amount > 0
  if (amount > 0) {
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount,
      mintAuthority,
      amount,
      undefined, // multiSigners
      undefined, // confirmOptions
      TOKEN_2022_PROGRAM_ID
    );
  }

  return tokenAccount;
}

// =============================================================================
// Main Factory
// =============================================================================

/**
 * Create all 4 role-based test wallets with SOL airdrops and token accounts.
 *
 * Execution order:
 * 1. Generate 4 keypairs
 * 2. Airdrop SOL to each (different amounts per role)
 * 3. Create Token-2022 accounts per role requirements
 * 4. Mint tokens into each account
 * 5. Create wrapped SOL for trader (standard SPL Token)
 *
 * The admin parameter is the mint authority who can mint tokens. This is
 * typically the same keypair that created the mints during protocol init.
 *
 * NOTE: User token accounts do NOT need whitelisting in the Transfer Hook.
 * The whitelist check requires at least ONE party (source or dest) to be
 * whitelisted. Pool vaults are whitelisted during protocol init, so user
 * accounts can transfer to/from pool vaults without being whitelisted.
 *
 * @param connection - Solana RPC connection
 * @param mintAuthority - Keypair with mint authority over all 3 tokens
 * @param mints - Object with crimeMint, fraudMint, profitMint public keys
 * @returns TestWallets with all 4 roles fully funded
 */
export async function createTestWallets(
  connection: Connection,
  mintAuthority: Keypair,
  mints: TestMints
): Promise<TestWallets> {
  // -------------------------------------------------------------------------
  // Step 1: Generate keypairs
  // -------------------------------------------------------------------------
  const traderKp = Keypair.generate();
  const stakerKp = Keypair.generate();
  const adminKp = Keypair.generate();
  const attackerKp = Keypair.generate();

  // -------------------------------------------------------------------------
  // Step 2: Airdrop SOL to all wallets
  //
  // Different amounts reflect role needs:
  // - Trader (10 SOL): Needs SOL for swaps, wrapping, and tx fees
  // - Staker (5 SOL):  Needs SOL for stake/unstake tx fees
  // - Admin (5 SOL):   Needs SOL for init + config tx fees
  // - Attacker (2 SOL): Minimal SOL -- just enough to attempt attacks
  // -------------------------------------------------------------------------
  await airdropSol(connection, traderKp.publicKey, 10 * LAMPORTS_PER_SOL);
  await airdropSol(connection, stakerKp.publicKey, 5 * LAMPORTS_PER_SOL);
  await airdropSol(connection, adminKp.publicKey, 5 * LAMPORTS_PER_SOL);
  await airdropSol(connection, attackerKp.publicKey, 2 * LAMPORTS_PER_SOL);

  // -------------------------------------------------------------------------
  // Step 3 + 4: Create token accounts and mint tokens per role
  // -------------------------------------------------------------------------

  // --- Trader: All 3 tokens (1000 each) ---
  const traderCrime = await createAndFundToken2022Account(
    connection,
    traderKp,
    mints.crimeMint,
    traderKp.publicKey,
    mintAuthority,
    TOKENS_1000
  );

  const traderFraud = await createAndFundToken2022Account(
    connection,
    traderKp,
    mints.fraudMint,
    traderKp.publicKey,
    mintAuthority,
    TOKENS_1000
  );

  const traderProfit = await createAndFundToken2022Account(
    connection,
    traderKp,
    mints.profitMint,
    traderKp.publicKey,
    mintAuthority,
    TOKENS_1000
  );

  const traderTokenAccounts = new Map<string, PublicKey>();
  traderTokenAccounts.set(mints.crimeMint.toBase58(), traderCrime);
  traderTokenAccounts.set(mints.fraudMint.toBase58(), traderFraud);
  traderTokenAccounts.set(mints.profitMint.toBase58(), traderProfit);

  // --- Trader: Wrapped SOL (5 SOL) via standard SPL Token ---
  // WSOL uses TOKEN_PROGRAM_ID (standard), not Token-2022.
  // Native SOL doesn't have transfer hooks.
  const traderWsol = await createWrappedNativeAccount(
    connection,
    traderKp,
    traderKp.publicKey,
    5 * LAMPORTS_PER_SOL,
    undefined, // keypair
    undefined, // confirmOptions
    TOKEN_PROGRAM_ID
  );

  // --- Staker: PROFIT only (1000 tokens) ---
  const stakerProfit = await createAndFundToken2022Account(
    connection,
    stakerKp,
    mints.profitMint,
    stakerKp.publicKey,
    mintAuthority,
    TOKENS_1000
  );

  const stakerTokenAccounts = new Map<string, PublicKey>();
  stakerTokenAccounts.set(mints.profitMint.toBase58(), stakerProfit);

  // --- Admin: No token accounts needed ---
  // Admin signs admin-gated instructions (initialize, configure)
  // but doesn't hold tokens directly.
  const adminTokenAccounts = new Map<string, PublicKey>();

  // --- Attacker: CRIME only (100 tokens) ---
  // Small amount for testing unauthorized swap attempts.
  const attackerCrime = await createAndFundToken2022Account(
    connection,
    attackerKp,
    mints.crimeMint,
    attackerKp.publicKey,
    mintAuthority,
    TOKENS_100
  );

  const attackerTokenAccounts = new Map<string, PublicKey>();
  attackerTokenAccounts.set(mints.crimeMint.toBase58(), attackerCrime);

  // -------------------------------------------------------------------------
  // Step 5: Assemble and return
  // -------------------------------------------------------------------------
  return {
    trader: {
      keypair: traderKp,
      wsolAccount: traderWsol,
      tokenAccounts: traderTokenAccounts,
    },
    staker: {
      keypair: stakerKp,
      profitAccount: stakerProfit,
      tokenAccounts: stakerTokenAccounts,
    },
    admin: {
      keypair: adminKp,
      tokenAccounts: adminTokenAccounts,
    },
    attacker: {
      keypair: attackerKp,
      tokenAccounts: attackerTokenAccounts,
    },
  };
}
