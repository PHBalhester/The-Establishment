"use client";

/**
 * RefundPanel -- Replaces BuySellPanel when a curve has Failed
 *
 * Shows per-curve refund estimates and claim buttons. When either curve
 * reaches "failed" status (mark_failed has been called), this panel
 * replaces the buy/sell interface entirely.
 *
 * Refund formula (mirrors on-chain claim_refund):
 *   total_outstanding = tokensSold (already decremented during sells)
 *   total_refundable = solRaised - solReturned + taxCollected
 *   user_refund = (userBalance * total_refundable) / total_outstanding
 *
 * Claim flow:
 *   1. Build claimRefundInstruction with correct partner curve
 *   2. Sign-then-send via useProtocolWallet
 *   3. Confirm via pollTransactionConfirmation
 *   4. Balance auto-refreshes via useTokenBalances
 */

import { useState, useMemo, useCallback } from "react";
import { Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { MINTS } from "@/lib/protocol-config";
import type { CurveStateData } from "@/hooks/useCurveState";
import { useProtocolWallet } from "@/hooks/useProtocolWallet";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useSolPrice } from "@/hooks/useSolPrice";
import { getBondingCurveProgram } from "@/lib/anchor";
import { getConnection } from "@/lib/connection";
import { buildClaimRefundInstruction } from "@/lib/curve/curve-tx-builder";
import { parseCurveError } from "@/lib/curve/error-map";
import { pollTransactionConfirmation } from "@/lib/confirm-transaction";
import { TOKEN_DECIMAL_FACTOR } from "@/lib/curve/curve-constants";
import { ConnectModal } from "@/components/wallet/ConnectModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefundPanelProps {
  crime: CurveStateData;
  fraud: CurveStateData;
}

type TxStatus = "idle" | "submitting" | "confirmed" | "error";

interface CurveRefundInfo {
  label: "CRIME" | "FRAUD";
  curve: CurveStateData;
  userBalance: number;
  userBalanceBigInt: bigint;
  estimatedRefundLamports: bigint;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format lamports as SOL with 4 decimal places */
function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** Format base units as human-readable token amount */
function formatTokens(baseUnits: number): string {
  return baseUnits.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format USD value */
function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Calculate proportional refund for a user's token balance.
 * Mirrors on-chain claim_refund logic.
 */
function calculateRefund(
  curve: CurveStateData,
  userBalanceBaseUnits: bigint
): bigint {
  // total_outstanding = tokens still held by users
  // On-chain tokens_sold is already decremented during sells, so no subtraction needed
  const totalOutstanding = curve.tokensSold;
  if (totalOutstanding <= 0n || userBalanceBaseUnits <= 0n) return 0n;

  // total_refundable = sol_vault balance + tax_escrow balance
  // After consolidation: sol_vault = solRaised - solReturned + taxCollected
  const totalRefundable =
    curve.solRaised - curve.solReturned + curve.taxCollected;
  if (totalRefundable <= 0n) return 0n;

  // Proportional refund (floor division -- on-chain does the same)
  return (userBalanceBaseUnits * totalRefundable) / totalOutstanding;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Solscan explorer URL for a transaction signature */
function solscanTxUrl(signature: string): string {
  const cluster = process.env.NEXT_PUBLIC_CLUSTER;
  const base = `https://solscan.io/tx/${signature}`;
  return cluster === "devnet" ? `${base}?cluster=devnet` : base;
}

export function RefundPanel({ crime, fraud }: RefundPanelProps) {
  const { publicKey, connected, sendTransaction } = useProtocolWallet();
  const { disconnect } = useWallet();
  const { crime: crimeBalance, fraud: fraudBalance, refresh } =
    useTokenBalances(publicKey);
  const { solPrice } = useSolPrice();

  // Wallet connect modal
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Per-curve TX status
  const [crimeTxStatus, setCrimeTxStatus] = useState<TxStatus>("idle");
  const [fraudTxStatus, setFraudTxStatus] = useState<TxStatus>("idle");
  const [crimeTxError, setCrimeTxError] = useState<string | null>(null);
  const [fraudTxError, setFraudTxError] = useState<string | null>(null);
  const [crimeTxSig, setCrimeTxSig] = useState<string | null>(null);
  const [fraudTxSig, setFraudTxSig] = useState<string | null>(null);

  // Build refund info for both curves
  const curves = useMemo<CurveRefundInfo[]>(() => {
    const crimeBalanceBigInt = BigInt(
      Math.floor(crimeBalance * Number(TOKEN_DECIMAL_FACTOR))
    );
    const fraudBalanceBigInt = BigInt(
      Math.floor(fraudBalance * Number(TOKEN_DECIMAL_FACTOR))
    );

    return [
      {
        label: "CRIME",
        curve: crime,
        userBalance: crimeBalance,
        userBalanceBigInt: crimeBalanceBigInt,
        estimatedRefundLamports: calculateRefund(crime, crimeBalanceBigInt),
      },
      {
        label: "FRAUD",
        curve: fraud,
        userBalance: fraudBalance,
        userBalanceBigInt: fraudBalanceBigInt,
        estimatedRefundLamports: calculateRefund(fraud, fraudBalanceBigInt),
      },
    ];
  }, [crime, fraud, crimeBalance, fraudBalance]);

  // Claim refund handler
  const handleClaim = useCallback(
    async (curveLabel: "CRIME" | "FRAUD") => {
      if (!publicKey || !connected) return;

      const setStatus =
        curveLabel === "CRIME" ? setCrimeTxStatus : setFraudTxStatus;
      const setError =
        curveLabel === "CRIME" ? setCrimeTxError : setFraudTxError;
      const setSig =
        curveLabel === "CRIME" ? setCrimeTxSig : setFraudTxSig;

      setStatus("submitting");
      setError(null);
      setSig(null);

      try {
        const connection = getConnection();
        const program = getBondingCurveProgram();

        // Determine mints: token being refunded and its partner
        const tokenMint =
          curveLabel === "CRIME" ? MINTS.CRIME : MINTS.FRAUD;
        const partnerMint =
          curveLabel === "CRIME" ? MINTS.FRAUD : MINTS.CRIME;

        // Build the claim_refund instruction
        const ix = await buildClaimRefundInstruction(
          program,
          publicKey,
          tokenMint,
          partnerMint
        );

        // Build transaction
        const tx = new Transaction().add(ix);
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        // Sign-then-send via protocol wallet
        const signature = await sendTransaction(tx, connection);

        // Poll for confirmation
        const result = await pollTransactionConfirmation(
          connection,
          signature,
          lastValidBlockHeight
        );

        if (result.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(result.err)}`);
        }

        setSig(signature);
        setStatus("confirmed");

        // Refresh balances after successful claim
        refresh();

        // Reset status after 5 seconds
        setTimeout(() => setStatus("idle"), 5000);
      } catch (err) {
        const message = parseCurveError(err);
        setError(message);
        setStatus("error");

        // Reset error status after 8 seconds
        setTimeout(() => {
          setStatus("idle");
          setError(null);
        }, 8000);
      }
    },
    [publicKey, connected, sendTransaction, refresh]
  );

  return (
    <div className="w-full max-w-[420px] mx-auto">
      {/* Header */}
      <div className="border border-amber-900/60 rounded-t-lg bg-gradient-to-b from-amber-950/80 to-stone-950/90 px-5 py-4">
        <h2 className="text-amber-200 text-lg font-bold tracking-wide text-center">
          CURVE FAILED
        </h2>
        <p className="text-amber-200/60 text-xs text-center mt-1 font-mono">
          The curve has failed. You can claim your proportional refund below.
        </p>

        {/* Wallet connect/disconnect */}
        <div className="mt-3 flex justify-center">
          {connected && publicKey ? (
            <button
              onClick={() => disconnect()}
              className="flex items-center gap-2 px-3 py-1.5 rounded border border-amber-800/50 bg-amber-900/20 text-amber-200/80 text-xs font-mono hover:bg-amber-800/30 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
              <span className="text-amber-200/40 ml-1">Disconnect</span>
            </button>
          ) : (
            <button
              onClick={() => setShowConnectModal(true)}
              className="px-4 py-1.5 rounded border border-amber-700/50 bg-amber-800/40 text-amber-100 text-xs font-bold tracking-wide hover:bg-amber-700/50 transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Per-curve refund sections */}
      <div className="border-x border-b border-amber-900/60 rounded-b-lg bg-stone-950/90 divide-y divide-amber-900/30">
        {curves.map((info) => {
          const txStatus =
            info.label === "CRIME" ? crimeTxStatus : fraudTxStatus;
          const txError =
            info.label === "CRIME" ? crimeTxError : fraudTxError;
          const txSig =
            info.label === "CRIME" ? crimeTxSig : fraudTxSig;
          const hasBalance = info.userBalance > 0;
          const refundSol = Number(info.estimatedRefundLamports) / 1e9;
          const refundUsd = solPrice ? refundSol * solPrice : null;

          return (
            <div key={info.label} className="px-5 py-4 space-y-3">
              {/* Token name */}
              <h3 className="text-amber-300 font-bold text-sm tracking-wider">
                {info.label}
              </h3>

              {/* Balance */}
              <div className="flex justify-between text-sm">
                <span className="text-amber-200/60">Your tokens:</span>
                <span className="text-amber-100 font-mono">
                  {formatTokens(info.userBalance)} {info.label}
                </span>
              </div>

              {/* Estimated refund */}
              <div className="flex justify-between text-sm">
                <span className="text-amber-200/60">Estimated refund:</span>
                <span className="text-amber-100 font-mono">
                  {formatSol(info.estimatedRefundLamports)} SOL
                  {refundUsd !== null && (
                    <span className="text-amber-200/40 ml-1">
                      ({formatUsd(refundUsd)})
                    </span>
                  )}
                </span>
              </div>

              {/* Curve status info */}
              {info.curve.status !== "failed" && (
                <p className="text-amber-200/40 text-xs font-mono">
                  This curve is {info.curve.status} -- refund not yet available
                </p>
              )}

              {!info.curve.escrowConsolidated &&
                info.curve.status === "failed" && (
                  <p className="text-amber-400/70 text-xs font-mono">
                    Tax escrow consolidation pending. Refund will be available
                    once consolidated.
                  </p>
                )}

              {/* Claim button */}
              <button
                onClick={() => handleClaim(info.label)}
                disabled={
                  !connected ||
                  !hasBalance ||
                  txStatus === "submitting" ||
                  info.curve.status !== "failed" ||
                  !info.curve.escrowConsolidated
                }
                className={`
                  w-full py-2.5 rounded font-bold text-sm tracking-wide
                  transition-all duration-200
                  ${
                    txStatus === "confirmed"
                      ? "bg-green-800/60 text-green-200 border border-green-700/50"
                      : txStatus === "error"
                        ? "bg-red-900/40 text-red-300 border border-red-800/50"
                        : !connected ||
                            !hasBalance ||
                            txStatus === "submitting" ||
                            info.curve.status !== "failed" ||
                            !info.curve.escrowConsolidated
                          ? "bg-amber-900/20 text-amber-200/30 border border-amber-900/30 cursor-not-allowed"
                          : "bg-amber-800/50 text-amber-100 border border-amber-700/50 hover:bg-amber-700/50 hover:border-amber-600/60 cursor-pointer"
                  }
                `}
              >
                {txStatus === "submitting"
                  ? "Claiming..."
                  : txStatus === "confirmed"
                    ? "Refund Claimed!"
                    : txStatus === "error"
                      ? "Claim Failed"
                      : `Claim ${info.label} Refund`}
              </button>

              {/* TX feedback */}
              {txError && (
                <p className="text-red-400/80 text-xs font-mono">{txError}</p>
              )}

              {txStatus === "confirmed" && (
                <div className="text-green-400/80 text-xs font-mono space-y-1">
                  <p>Refund claimed successfully. Your SOL has been returned.</p>
                  {txSig && (
                    <a
                      href={solscanTxUrl(txSig)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-green-300/80 hover:text-green-200 underline underline-offset-2"
                    >
                      View on Solscan
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Not connected message */}
        {!connected && (
          <div className="px-5 py-3">
            <p className="text-amber-200/50 text-xs text-center font-mono">
              Connect your wallet above to claim refunds.
            </p>
          </div>
        )}
      </div>

      {/* Wallet connect modal */}
      <ConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
      />
    </div>
  );
}
