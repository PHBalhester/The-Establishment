"use client";

/**
 * useEpochState -- SSE-powered epoch state data
 *
 * Reads EpochState from useProtocolState (server-side SSE feed).
 * Zero browser-side WebSocket connections or RPC polling.
 *
 * Data flow:
 *   ws-subscriber batchSeed / Helius webhook
 *     -> Anchor decode + anchorToJson()
 *     -> protocolStore -> SSE -> useProtocolState
 *     -> useEpochState (this hook)
 *
 * Return type is unchanged from the pre-SSE version (UseEpochStateResult).
 * No downstream component modifications needed.
 */

import { useMemo } from "react";
import { useProtocolState } from "@/hooks/useProtocolState";

/** Extracted EpochState fields as plain numbers (no BN serialization issues) */
export interface EpochStateData {
  /** Current epoch number (0-indexed, increments each transition) */
  currentEpoch: number;
  /** Cheap side: 0 = CRIME, 1 = FRAUD */
  cheapSide: number;
  /** Slot when the current epoch started */
  epochStartSlot: number;
  /** CRIME buy tax rate in basis points */
  crimeBuyTaxBps: number;
  /** CRIME sell tax rate in basis points */
  crimeSellTaxBps: number;
  /** FRAUD buy tax rate in basis points */
  fraudBuyTaxBps: number;
  /** FRAUD sell tax rate in basis points */
  fraudSellTaxBps: number;
}

export interface UseEpochStateResult {
  epochState: EpochStateData | null;
  loading: boolean;
  error: string | null;
}

export function useEpochState(): UseEpochStateResult {
  const { epochState: sseData } = useProtocolState();

  const epochState = useMemo((): EpochStateData | null => {
    if (!sseData || typeof sseData.currentEpoch !== "number") return null;

    return {
      currentEpoch: sseData.currentEpoch as number,
      cheapSide: sseData.cheapSide as number,
      epochStartSlot: sseData.epochStartSlot as number,
      crimeBuyTaxBps: sseData.crimeBuyTaxBps as number,
      crimeSellTaxBps: sseData.crimeSellTaxBps as number,
      fraudBuyTaxBps: sseData.fraudBuyTaxBps as number,
      fraudSellTaxBps: sseData.fraudSellTaxBps as number,
    };
  }, [sseData]);

  // loading = data not yet received, error = null (SSE handles retries)
  const loading = sseData === null;

  return { epochState, loading, error: null };
}
