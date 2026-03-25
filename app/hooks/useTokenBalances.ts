"use client";

/**
 * useTokenBalances -- CRIME/FRAUD/PROFIT/SOL balance fetching
 *
 * Fetches balances for the connected wallet using RPC. All three meme tokens
 * (CRIME, FRAUD, PROFIT) are Token-2022 tokens, so we MUST query with
 * TOKEN_2022_PROGRAM_ID -- using TOKEN_PROGRAM_ID (classic SPL) returns zero.
 *
 * Auto-refreshes every 30 seconds while a wallet is connected.
 * Exposes refresh() for manual re-fetch (e.g. after a swap or staking action).
 *
 * Cross-instance sync: Multiple components may call useTokenBalances independently
 * (e.g. SwapForm and StakingForm on the same page). When ANY instance calls
 * refresh(), a "token-balances-refresh" CustomEvent is dispatched on `window`,
 * causing ALL instances to re-fetch. This ensures that a swap completing updates
 * the staking section's PROFIT balance (and vice versa) without a page refresh.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "@/lib/connection";
import { MINTS } from "@/lib/protocol-config";
import { useVisibility } from "./useVisibility";

/** How often to poll for updated balances (ms) */
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Custom event name for cross-instance balance refresh coordination.
 * When any useTokenBalances instance calls refresh(), this event fires on
 * `window` so all other instances also re-fetch.
 */
const BALANCE_REFRESH_EVENT = "token-balances-refresh";

export interface TokenBalances {
  sol: number;
  crime: number;
  fraud: number;
  profit: number;
  loading: boolean;
  error: string | null;
  /** Manually re-fetch all balances (also notifies other instances to refresh) */
  refresh: () => void;
}

export function useTokenBalances(publicKey: PublicKey | null): TokenBalances {
  const [balances, setBalances] = useState({
    sol: 0,
    crime: 0,
    fraud: 0,
    profit: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Visibility gating: pause polling when tab is hidden. No station specified
  // because token balances are needed by both SwapStation and StakingStation.
  const { isActive, onResume } = useVisibility();

  // Track the latest publicKey in a ref so the interval callback always
  // uses the current value without being re-created on every key change.
  const publicKeyRef = useRef(publicKey);
  publicKeyRef.current = publicKey;

  // Pre-compute mint address strings once (they never change).
  const crimeMint = MINTS.CRIME.toBase58();
  const fraudMint = MINTS.FRAUD.toBase58();
  const profitMint = MINTS.PROFIT.toBase58();

  const fetchBalances = useCallback(async () => {
    const key = publicKeyRef.current;
    if (!key) return;

    setLoading(true);
    setError(null);

    try {
      const connection = getConnection();

      // Fetch SOL balance and all Token-2022 accounts in parallel.
      // Using TOKEN_2022_PROGRAM_ID is critical -- CRIME/FRAUD/PROFIT are
      // Token-2022 mints, not classic SPL tokens.
      const [solBalance, tokenAccounts] = await Promise.all([
        connection.getBalance(key),
        connection.getParsedTokenAccountsByOwner(key, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);

      // Build a mint -> uiAmount map from the parsed token accounts.
      const mintToBalance: Record<string, number> = {};
      for (const { account } of tokenAccounts.value) {
        const info = account.data.parsed?.info;
        if (info?.mint && info?.tokenAmount) {
          mintToBalance[info.mint] = info.tokenAmount.uiAmount ?? 0;
        }
      }

      setBalances({
        sol: solBalance / LAMPORTS_PER_SOL,
        crime: mintToBalance[crimeMint] ?? 0,
        fraud: mintToBalance[fraudMint] ?? 0,
        profit: mintToBalance[profitMint] ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [crimeMint, fraudMint, profitMint]);

  // Fetch on mount and whenever publicKey changes. Gated by isActive:
  // pauses polling when tab is hidden, resumes when tab returns.
  useEffect(() => {
    if (!publicKey) {
      // No wallet connected -- reset to zeros.
      setBalances({ sol: 0, crime: 0, fraud: 0, profit: 0 });
      setLoading(false);
      setError(null);
      return;
    }

    if (!isActive) return;

    fetchBalances();

    // Auto-refresh on a 30-second interval while wallet is connected and tab is visible.
    const interval = setInterval(fetchBalances, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [publicKey, isActive, fetchBalances]);

  // Burst-refresh on tab return: immediately re-fetch balances so users
  // see fresh numbers without waiting for the next poll cycle.
  useEffect(() => {
    return onResume(() => {
      fetchBalances();
    });
  }, [onResume, fetchBalances]);

  // Guard to prevent double-fetch: when THIS instance dispatches the refresh
  // event, the listener on this same instance would also fire. The ref lets
  // us skip the self-triggered event and only respond to OTHER instances.
  const isDispatchingRef = useRef(false);

  // Listen for cross-instance refresh events.
  // When another hook instance (e.g. useSwap's useTokenBalances) calls refresh(),
  // it dispatches BALANCE_REFRESH_EVENT. We listen here so THIS instance also
  // re-fetches, keeping balances in sync across SwapForm and StakingForm.
  useEffect(() => {
    const handleRefreshEvent = () => {
      // Skip if this instance dispatched the event (already fetching).
      if (isDispatchingRef.current) return;
      fetchBalances();
    };

    window.addEventListener(BALANCE_REFRESH_EVENT, handleRefreshEvent);
    return () => {
      window.removeEventListener(BALANCE_REFRESH_EVENT, handleRefreshEvent);
    };
  }, [fetchBalances]);

  // Exposed refresh function -- triggers immediate re-fetch in THIS instance
  // AND broadcasts to all other instances via CustomEvent.
  const refresh = useCallback(() => {
    fetchBalances();
    // Notify other useTokenBalances instances to also refresh.
    // This is what keeps SwapForm's balances in sync when StakingForm
    // completes a transaction (and vice versa).
    isDispatchingRef.current = true;
    window.dispatchEvent(new CustomEvent(BALANCE_REFRESH_EVENT));
    isDispatchingRef.current = false;
  }, [fetchBalances]);

  return {
    ...balances,
    loading,
    error,
    refresh,
  };
}
