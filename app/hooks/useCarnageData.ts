"use client";

/**
 * useCarnageData -- SSE-powered hook for CarnageFundState + CarnageSolVault
 *
 * Reads CarnageFundState (Anchor-decoded) and CarnageSolVault (native SOL
 * SystemAccount lamports) from useProtocolState. Both sources are delivered
 * via SSE — no browser WS subscriptions or RPC polling.
 *
 * CarnageFundState fields (totalCrimeBurned, totalFraudBurned, totalSolSpent)
 * use BN.toNumber() via anchorToJson — safe because these are protocol-lifetime
 * aggregates well within 2^53 for any realistic scenario.
 */

import { useMemo } from "react";
import { useProtocolState } from "@/hooks/useProtocolState";

/** Extracted Carnage fund data as plain numbers */
export interface CarnageData {
  /** Total CRIME tokens burned (lifetime, in token base units) */
  totalCrimeBurned: number;
  /** Total FRAUD tokens burned (lifetime, in token base units) */
  totalFraudBurned: number;
  /** Total SOL spent on buybacks (lifetime, in lamports) */
  totalSolSpent: number;
  /** Total number of Carnage triggers (lifetime) */
  totalTriggers: number;
  /** Last epoch when Carnage triggered */
  lastTriggerEpoch: number;
  /** Current SOL vault balance in lamports (real-time via SSE) */
  vaultBalanceLamports: number;
}

export interface UseCarnageDataResult {
  carnageData: CarnageData | null;
  loading: boolean;
  error: string | null;
}

export function useCarnageData(): UseCarnageDataResult {
  const { carnageFund, carnageSolVault } = useProtocolState();

  const carnageData = useMemo((): CarnageData | null => {
    if (!carnageFund || typeof carnageFund.totalTriggers !== "number") return null;

    const vaultLamports = carnageSolVault
      ? (carnageSolVault.lamports as number) ?? 0
      : 0;

    return {
      totalCrimeBurned: carnageFund.totalCrimeBurned as number,
      totalFraudBurned: carnageFund.totalFraudBurned as number,
      totalSolSpent: carnageFund.totalSolSpent as number,
      totalTriggers: carnageFund.totalTriggers as number,
      lastTriggerEpoch: carnageFund.lastTriggerEpoch as number,
      vaultBalanceLamports: vaultLamports,
    };
  }, [carnageFund, carnageSolVault]);

  // D6: loading = data not yet received, error = null
  const loading = carnageFund === null;

  return { carnageData, loading, error: null };
}
