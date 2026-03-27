"use client";

/**
 * useProtocolWallet -- Unified wallet abstraction over wallet-adapter
 *
 * Wraps @solana/wallet-adapter-react's useWallet() to provide a stable
 * interface for all protocol operations. Works with any wallet-standard
 * wallet (Phantom, Solflare, Backpack, etc.).
 *
 * Returns { publicKey, connected, ready, sendTransaction, disconnect }
 * regardless of wallet type.
 *
 * Why keep this abstraction: If we swap wallet libraries again, only this
 * file changes. All 8+ consumers remain untouched.
 *
 * TX Submission Strategy (cluster-dependent):
 *
 * MAINNET: Uses wallet-adapter's sendTransaction() which calls Phantom's
 * signAndSendTransaction. This sends via Phantom's own RPC — fine on
 * mainnet. Critically, this avoids Phantom's Blowfish security flag:
 * using signTransaction() + sendRawTransaction() is treated as a phishing
 * pattern and triggers "This dApp could be malicious" on every TX.
 *
 * DEVNET: Uses sign-then-send (signTransaction + sendRawTransaction via
 * our Helius RPC). Phantom's signAndSendTransaction routes through
 * Phantom's own RPC which silently drops devnet transactions.
 */

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { SendTransactionOptions } from "@solana/wallet-adapter-base";
import {
  type PublicKey,
  type Connection,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

const isMainnet = process.env.NEXT_PUBLIC_CLUSTER?.toLowerCase() === "mainnet";

export interface ProtocolWallet {
  /** The connected wallet's public key, or null if not connected */
  publicKey: PublicKey | null;
  /** True when a wallet is connected and available for use */
  connected: boolean;
  /** True when wallet adapter is not in the process of connecting */
  ready: boolean;
  /** Sign a transaction via the wallet, then send it through our RPC.
   *  Returns the transaction signature string. */
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    connection: Connection,
    opts?: SendTransactionOptions,
  ) => Promise<string>;
  /** Disconnect the current wallet */
  disconnect: () => Promise<void>;
}

export function useProtocolWallet(): ProtocolWallet {
  const {
    publicKey,
    connected,
    connecting,
    disconnect,
    signTransaction,
    sendTransaction: walletSendTransaction,
  } = useWallet();

  // ready: true when wallet-adapter is NOT in the process of connecting.
  // Maps to Privy's old "SDK initialized" semantics. During auto-connect,
  // `connecting` is briefly true (~100-500ms), so ready=false shows loading
  // skeleton in WalletButton. (Per discuss decision #2: ready = !connecting)
  const ready = !connecting;

  // Wrap disconnect to match async interface. wallet-adapter's disconnect
  // is already async, but we wrap for type safety.
  const wrappedDisconnect = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  // Cluster-dependent TX submission strategy.
  //
  // MAINNET: wallet-adapter's sendTransaction() → Phantom's signAndSendTransaction.
  // This avoids the Blowfish "malicious dApp" warning that sign-then-send triggers.
  // Phantom sends via its own mainnet RPC which works reliably on mainnet.
  //
  // DEVNET: sign-then-send via our Helius RPC. Phantom's signAndSendTransaction
  // routes through Phantom's RPC which silently drops devnet transactions.
  const wrappedSendTransaction = useCallback(
    async (
      tx: Transaction | VersionedTransaction,
      connection: Connection,
      opts?: SendTransactionOptions,
    ): Promise<string> => {
      if (!publicKey) throw new Error("No wallet connected");

      if (isMainnet) {
        // Mainnet: use wallet-adapter's sendTransaction (signAndSendTransaction)
        // This is the Phantom-recommended path — no Blowfish warning.
        return walletSendTransaction(tx, connection, opts);
      }

      // Devnet: sign-then-send via our RPC
      if (!signTransaction) {
        throw new Error(
          "Wallet does not support signTransaction. " +
          "Please use a wallet that supports transaction signing (Phantom, Solflare, Backpack).",
        );
      }

      const signed = await signTransaction(tx);
      const serialized = signed.serialize();

      const { signers: _signers, ...sendOptions } = opts ?? {};
      const signature = await connection.sendRawTransaction(serialized, {
        skipPreflight: true, // Forced on devnet: v0 simulation returns "Blockhash not found"
        preflightCommitment: sendOptions.preflightCommitment ?? connection.commitment ?? undefined,
        maxRetries: sendOptions.maxRetries,
        minContextSlot: sendOptions.minContextSlot,
      });

      return signature;
    },
    [publicKey, signTransaction, walletSendTransaction],
  );

  return {
    publicKey,
    connected,
    ready,
    sendTransaction: wrappedSendTransaction,
    disconnect: wrappedDisconnect,
  };
}
