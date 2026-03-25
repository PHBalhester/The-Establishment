/**
 * WSOL (Wrapped SOL) Helpers
 *
 * Instruction builders for wrapping SOL to WSOL and unwrapping WSOL back to SOL.
 * Used by the swap transaction builders for SOL buy/sell flows.
 *
 * CRITICAL: WSOL uses TOKEN_PROGRAM_ID (the original SPL Token program),
 * NOT TOKEN_2022_PROGRAM_ID. This is because NATIVE_MINT (So11111111111111111111111111111111111111112)
 * is owned by the original Token Program. Using TOKEN_2022_PROGRAM_ID for WSOL
 * operations will fail with "incorrect program id for instruction".
 *
 * WSOL lifecycle for a buy swap:
 * 1. Create WSOL ATA (if it doesn't exist)
 * 2. Transfer SOL to the WSOL ATA via SystemProgram.transfer
 * 3. SyncNative to update the WSOL account's token balance
 * 4. [Execute swap -- WSOL is now a regular SPL token account]
 * 5. CloseAccount to unwrap remaining WSOL back to SOL
 *
 * Source: @solana/spl-token NATIVE_MINT documentation
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// =============================================================================
// WSOL ATA
// =============================================================================

/**
 * Get the Associated Token Address for WSOL for a given owner.
 *
 * Uses TOKEN_PROGRAM_ID (not TOKEN_2022) because NATIVE_MINT is owned
 * by the original SPL Token program.
 *
 * @param owner - The wallet public key
 * @returns The WSOL ATA address
 */
export async function getWsolAta(owner: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(
    NATIVE_MINT,
    owner,
    false, // allowOwnerOffCurve = false (normal wallet)
    TOKEN_PROGRAM_ID,
  );
}

// =============================================================================
// Wrap SOL -> WSOL
// =============================================================================

/**
 * Build instructions to wrap SOL into WSOL.
 *
 * Returns an array of 2-3 instructions:
 * 1. (Optional) Create WSOL ATA if it doesn't exist
 * 2. Transfer SOL to WSOL ATA via SystemProgram
 * 3. SyncNative to update the token balance
 *
 * The caller should include all returned instructions in their transaction
 * BEFORE the swap instruction.
 *
 * @param connection - Solana connection for checking if WSOL ATA exists
 * @param userPublicKey - The user's wallet public key
 * @param amountLamports - Amount of SOL to wrap (in lamports)
 * @returns Array of instructions to wrap SOL into WSOL
 */
export async function buildWsolWrapInstructions(
  connection: Connection,
  userPublicKey: PublicKey,
  amountLamports: number,
): Promise<TransactionInstruction[]> {
  const wsolAta = await getWsolAta(userPublicKey);
  const instructions: TransactionInstruction[] = [];

  // Check if WSOL ATA already exists
  const accountInfo = await connection.getAccountInfo(wsolAta);

  if (!accountInfo) {
    // Create the WSOL ATA
    // Uses TOKEN_PROGRAM_ID because NATIVE_MINT is owned by original Token Program
    instructions.push(
      createAssociatedTokenAccountInstruction(
        userPublicKey, // payer
        wsolAta,       // associatedToken
        userPublicKey, // owner
        NATIVE_MINT,   // mint
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  // Transfer SOL to the WSOL ATA
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: userPublicKey,
      toPubkey: wsolAta,
      lamports: amountLamports,
    }),
  );

  // Sync the WSOL account's token balance to reflect the deposited SOL
  // This is required because SystemProgram.transfer only changes the SOL balance,
  // not the SPL token account's internal balance tracking
  instructions.push(
    createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
  );

  return instructions;
}

// =============================================================================
// Unwrap WSOL -> SOL
// =============================================================================

/**
 * Build an instruction to unwrap WSOL back to SOL.
 *
 * Closes the WSOL ATA and transfers all remaining SOL balance back to the owner.
 * This should be included as the LAST instruction in the transaction, after the
 * swap instruction, to recover any leftover WSOL.
 *
 * @param userPublicKey - The user's wallet public key (receives SOL + rent)
 * @returns Instruction to close WSOL account and recover SOL
 */
export async function buildWsolUnwrapInstruction(
  userPublicKey: PublicKey,
): Promise<TransactionInstruction> {
  const wsolAta = await getWsolAta(userPublicKey);

  // Close the WSOL account: transfers remaining SOL + rent to the owner
  return createCloseAccountInstruction(
    wsolAta,       // account to close
    userPublicKey, // destination for remaining SOL
    userPublicKey, // authority (owner of the account)
    [],            // no multisig signers
    TOKEN_PROGRAM_ID,
  );
}
