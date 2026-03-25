"use client";

/**
 * usePoolPrices -- SSE-powered pool reserve data
 *
 * Reads CRIME/SOL and FRAUD/SOL pool data from useProtocolState (server-side
 * SSE feed). Zero browser-side WebSocket connections or RPC polling.
 *
 * Data flow:
 *   ws-subscriber batchSeed / Helius webhook
 *     -> Anchor decode + anchorToJson()
 *     -> protocolStore -> SSE -> useProtocolState
 *     -> usePoolPrices (this hook)
 *
 * Return type is unchanged from the pre-SSE version (UsePoolPricesResult).
 * No downstream component modifications needed.
 */

import { useMemo } from "react";
import { useProtocolState } from "@/hooks/useProtocolState";
import { DEVNET_POOLS } from "@/lib/protocol-config";

/** Data extracted from a single pool's on-chain PoolState */
export interface PoolData {
  /** Human-readable label: "CRIME/SOL", "FRAUD/SOL", etc. */
  label: string;
  /** Pool PDA address (base58) */
  address: string;
  /** Reserve A in base units (lamports or token base units) */
  reserveA: number;
  /** Reserve B in base units */
  reserveB: number;
  /** Mint A address (base58) */
  mintA: string;
  /** Mint B address (base58) */
  mintB: string;
  /** Whether this pool's data is still loading */
  loading: boolean;
  /** Error message if fetch/subscribe failed */
  error: string | null;
}

export interface UsePoolPricesResult {
  /** Pool data keyed by label (e.g. "CRIME/SOL") */
  pools: Record<string, PoolData>;
  /** True if ANY pool is still loading initial data */
  loading: boolean;
  /** Top-level error (e.g. program init failure) */
  error: string | null;
}

/** Pool config entries from DEVNET_POOLS */
const POOL_ENTRIES = Object.values(DEVNET_POOLS);

export function usePoolPrices(): UsePoolPricesResult {
  const { crimePool, fraudPool } = useProtocolState();

  const pools = useMemo(() => {
    const result: Record<string, PoolData> = {};

    // Map pool PDA addresses to their SSE data
    const sseMap: Record<string, typeof crimePool> = {
      [DEVNET_POOLS.CRIME_SOL.pool.toBase58()]: crimePool,
      [DEVNET_POOLS.FRAUD_SOL.pool.toBase58()]: fraudPool,
    };

    for (const entry of POOL_ENTRIES) {
      const address = entry.pool.toBase58();
      const data = sseMap[address];

      if (data && typeof data.reserveA === "number") {
        result[entry.label] = {
          label: entry.label,
          address,
          reserveA: data.reserveA as number,
          reserveB: data.reserveB as number,
          mintA: (data.mintA as string) ?? "",
          mintB: (data.mintB as string) ?? "",
          loading: false,
          error: data.decodeError ? String(data.decodeError) : null,
        };
      } else {
        // Data not yet available from SSE
        result[entry.label] = {
          label: entry.label,
          address,
          reserveA: 0,
          reserveB: 0,
          mintA: "",
          mintB: "",
          loading: data === null || data === undefined,
          error: data?.decodeError ? String(data.decodeError) : null,
        };
      }
    }

    return result;
  }, [crimePool, fraudPool]);

  // loading = data not yet received, error = null (SSE handles retries)
  const loading = crimePool === null || fraudPool === null;

  return { pools, loading, error: null };
}
