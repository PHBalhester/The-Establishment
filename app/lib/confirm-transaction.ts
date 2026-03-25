/**
 * Polling-based transaction confirmation.
 *
 * Why not use connection.confirmTransaction()?
 * The built-in confirmTransaction relies on a websocket subscription
 * which can be unreliable (missed notifications, connection drops).
 *
 * This helper polls getSignatureStatuses over HTTP instead, which is
 * more robust and works reliably for all transaction types.
 */

import type { Connection, TransactionSignature } from "@solana/web3.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 90_000; // 90 second safety timeout

export interface ConfirmResult {
  err: unknown | null;
}

/**
 * Poll for transaction confirmation via HTTP RPC (no websocket needed).
 *
 * @param connection - Solana RPC connection (used for HTTP calls only)
 * @param signature - Transaction signature to confirm
 * @param lastValidBlockHeight - Blockhash expiry height (from getLatestBlockhash)
 * @returns ConfirmResult with err=null on success, or throws on timeout/expiry
 */
export async function pollTransactionConfirmation(
  connection: Connection,
  signature: TransactionSignature,
  lastValidBlockHeight: number,
): Promise<ConfirmResult> {
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_DURATION_MS) {
    // Check signature status via HTTP
    const { value: statuses } = await connection.getSignatureStatuses([signature]);
    const status = statuses[0];

    if (status) {
      // confirmationStatus progresses: processed → confirmed → finalized
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return { err: status.err };
      }
      // "processed" — TX landed but not yet confirmed, keep polling
    }

    // Check if blockhash has expired
    const blockHeight = await connection.getBlockHeight("confirmed");
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(
        "Transaction expired: block height exceeded lastValidBlockHeight",
      );
    }

    // Wait before next poll
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_DURATION_MS / 1000}s`,
  );
}
