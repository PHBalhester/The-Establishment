"use client";

/**
 * useSolPrice -- Polls Jupiter Price API for SOL/USD price
 *
 * Fetches the current SOL/USD price every 30 seconds using the Jupiter
 * Price API V3. The longer interval (vs 10s for on-chain data) reflects
 * that SOL price changes less frequently than protocol state.
 *
 * Used for:
 * - Market cap computation (pool reserves in SOL * SOL/USD)
 * - Dollar-denominated value displays
 *
 * Follows the useTokenBalances pattern: useState + useCallback + useEffect + cleanup.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchSolPrice } from "@/lib/jupiter";
import { useVisibility } from "./useVisibility";

/** How often to poll SOL price (ms) -- 30 seconds */
const POLL_INTERVAL_MS = 30_000;

export interface UseSolPriceResult {
  solPrice: number | null;
  loading: boolean;
  error: string | null;
}

export function useSolPrice(): UseSolPriceResult {
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Visibility gating: pause polling when tab is hidden. No station specified
  // because SOL price is used everywhere (dashboard, swap, staking).
  const { isActive, onResume } = useVisibility();

  // Track mounted state to prevent setState on unmounted component
  const mountedRef = useRef(true);

  const fetchPrice = useCallback(async () => {
    try {
      const price = await fetchSolPrice();

      if (!mountedRef.current) return;

      if (price !== null) {
        setSolPrice(price);
        setError(null);
      } else {
        // fetchSolPrice returns null on error -- don't overwrite last good price,
        // just flag that the latest fetch failed.
        setError("Failed to fetch SOL price from Jupiter");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Gate polling by isActive: pauses when tab is hidden, resumes when visible.
  useEffect(() => {
    if (!isActive) return;

    mountedRef.current = true;

    // Initial fetch
    fetchPrice();

    // Poll every 30 seconds
    const interval = setInterval(fetchPrice, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [isActive, fetchPrice]);

  // Burst-refresh on tab return: immediately re-fetch SOL price so users
  // see a current value without waiting for the next poll cycle.
  useEffect(() => {
    return onResume(() => {
      fetchPrice();
    });
  }, [onResume, fetchPrice]);

  return { solPrice, loading, error };
}
