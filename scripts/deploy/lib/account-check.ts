/**
 * On-Chain Account Existence Checking
 *
 * Provides reliable detection of whether accounts exist on-chain, enabling
 * idempotent initialization. Each init step checks if its target account
 * already exists before sending a transaction, so re-running the deployment
 * scripts safely skips already-completed steps.
 *
 * Why on-chain detection instead of local state files?
 * - No state to get out of sync (decided in 33-CONTEXT.md)
 * - Works even if deployment was partially completed by another tool
 * - The chain is the source of truth
 *
 * Three check functions for three account types:
 * - accountExists:     Generic -- any account with data
 * - programIsDeployed: Programs -- must be executable
 * - mintExists:        Token mints -- must be owned by Token-2022 or SPL Token
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Check if a generic account exists on-chain.
 *
 * Returns true if the account has been created and contains data.
 * This is the primary check for PDAs (StakePool, AdminConfig, WhitelistAuthority, etc.)
 *
 * Why check data.length > 0?
 * - An account can exist with 0 data (e.g., a system account with only lamports)
 * - PDAs created by Anchor always have data (discriminator + state)
 * - data.length > 0 means the account was initialized by a program, not just funded
 *
 * @param connection - Solana RPC connection
 * @param address - Public key of the account to check
 * @returns true if account exists and has data
 */
export async function accountExists(
  connection: Connection,
  address: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null && info.data.length > 0;
}

/**
 * Check if a program is deployed and executable.
 *
 * Programs are special accounts that have the `executable` flag set.
 * This distinguishes deployed programs from regular data accounts or
 * accounts that were created but never had a program uploaded.
 *
 * Why check executable specifically?
 * - A program keypair can have an account (from airdrop) without being deployed
 * - After `solana program deploy`, the account is marked executable
 * - This catches the "forgot to deploy" case that accountExists would miss
 *
 * @param connection - Solana RPC connection
 * @param programId - Public key of the program to check
 * @returns true if account exists and is executable
 */
export async function programIsDeployed(
  connection: Connection,
  programId: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(programId);
  return info !== null && info.executable === true;
}

/**
 * Check if a token mint account exists.
 *
 * Verifies the account exists and is owned by either Token-2022 or SPL Token.
 * This handles both our custom Token-2022 mints (PROFIT, CRIME, FRAUD) and
 * native WSOL which uses the original SPL Token program.
 *
 * Why check owner program?
 * - An account at a mint address could be anything (data account, program, etc.)
 * - Verifying the owner is a token program confirms it's actually a mint
 * - Supporting both token programs handles WSOL (SPL Token) vs our mints (Token-2022)
 *
 * @param connection - Solana RPC connection
 * @param mintAddress - Public key of the mint to check
 * @returns true if account exists and is owned by Token-2022 or SPL Token
 */
export async function mintExists(
  connection: Connection,
  mintAddress: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(mintAddress);
  if (info === null) return false;

  // Check if owned by either token program
  const owner = info.owner.toBase58();
  return (
    owner === TOKEN_2022_PROGRAM_ID.toBase58() ||
    owner === TOKEN_PROGRAM_ID.toBase58()
  );
}
