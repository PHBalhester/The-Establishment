"use client";

/**
 * useTokenBalances -- BRIBE/CORUPT/VOTES/USDC balance fetching for Arc Network
 *
 * Fetches balances for the connected wallet using wagmi/viem.
 * Token names (Solana -> Arc):
 *   CRIME  -> BRIBE
 *   FRAUD  -> CORUPT  
 *   PROFIT -> VOTES
 *   SOL    -> USDC (native gas token on Arc)
 *
 * Auto-refreshes every 10 seconds while a wallet is connected.
 * Exposes refresh() for manual re-fetch (e.g. after a swap or staking action).
 *
 * Cross-instance sync: Multiple components may call useTokenBalances independently.
 * When ANY instance calls refresh(), a "token-balances-refresh" CustomEvent is
 * dispatched on `window`, causing ALL instances to re-fetch.
 */

import { useEffect, useCallback, useRef } from "react";
import { useReadContracts, useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { CONTRACTS, TOKEN_METADATA } from "@/lib/contract-addresses";
import { erc20Abi } from "@/lib/abis";
import { arcTestnet } from "@/lib/chain-config";

/** How often to poll for updated balances (ms) */
const REFRESH_INTERVAL_MS = 10_000;

/**
 * Custom event name for cross-instance balance refresh coordination.
 */
const BALANCE_REFRESH_EVENT = "token-balances-refresh";

export interface TokenBalances {
  /** USDC balance (native gas token on Arc) */
  usdc: number;
  /** BRIBE token balance (formerly CRIME) */
  bribe: number;
  /** CORUPT token balance (formerly FRAUD) */
  corupt: number;
  /** VOTES token balance (formerly PROFIT) */
  votes: number;
  loading: boolean;
  error: string | null;
  /** Manually re-fetch all balances (also notifies other instances to refresh) */
  refresh: () => void;
}

// Legacy alias for backwards compatibility
export interface LegacyTokenBalances {
  sol: number;
  crime: number;
  fraud: number;
  profit: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTokenBalances(): TokenBalances {
  const { address, isConnected } = useAccount();

  // Native USDC balance (gas token on Arc)
  const { 
    data: nativeBalance, 
    isLoading: nativeLoading,
    refetch: refetchNative,
  } = useBalance({
    address,
    chainId: arcTestnet.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: REFRESH_INTERVAL_MS,
    },
  });

  // ERC-20 token balances
  const { 
    data: tokenData, 
    isLoading: tokensLoading,
    refetch: refetchTokens,
    error: tokenError,
  } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.BRIBE,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      {
        address: CONTRACTS.CORUPT,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      {
        address: CONTRACTS.VOTES,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
    ],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: REFRESH_INTERVAL_MS,
    },
  });

  // Parse results
  const bribeBalance = tokenData?.[0]?.result as bigint | undefined;
  const coruptBalance = tokenData?.[1]?.result as bigint | undefined;
  const votesBalance = tokenData?.[2]?.result as bigint | undefined;

  // Format to human-readable numbers
  const balances: Omit<TokenBalances, 'loading' | 'error' | 'refresh'> = {
    usdc: nativeBalance ? Number(formatUnits(nativeBalance.value, 18)) : 0,
    bribe: bribeBalance ? Number(formatUnits(bribeBalance, TOKEN_METADATA.BRIBE.decimals)) : 0,
    corupt: coruptBalance ? Number(formatUnits(coruptBalance, TOKEN_METADATA.CORUPT.decimals)) : 0,
    votes: votesBalance ? Number(formatUnits(votesBalance, TOKEN_METADATA.VOTES.decimals)) : 0,
  };

  // Guard to prevent double-fetch on self-triggered events
  const isDispatchingRef = useRef(false);

  // Listen for cross-instance refresh events
  useEffect(() => {
    const handleRefreshEvent = () => {
      if (isDispatchingRef.current) return;
      refetchNative();
      refetchTokens();
    };

    window.addEventListener(BALANCE_REFRESH_EVENT, handleRefreshEvent);
    return () => {
      window.removeEventListener(BALANCE_REFRESH_EVENT, handleRefreshEvent);
    };
  }, [refetchNative, refetchTokens]);

  // Exposed refresh function
  const refresh = useCallback(() => {
    refetchNative();
    refetchTokens();
    
    // Notify other instances to also refresh
    isDispatchingRef.current = true;
    window.dispatchEvent(new CustomEvent(BALANCE_REFRESH_EVENT));
    isDispatchingRef.current = false;
  }, [refetchNative, refetchTokens]);

  const loading = nativeLoading || tokensLoading;
  const error = tokenError ? (tokenError as Error).message : null;

  return {
    ...balances,
    loading,
    error,
    refresh,
  };
}

/**
 * Legacy hook that maps new token names to old names for backwards compatibility.
 * Use this during migration to avoid breaking existing components.
 * 
 * Mapping:
 *   usdc   -> sol
 *   bribe  -> crime
 *   corupt -> fraud
 *   votes  -> profit
 */
export function useTokenBalancesLegacy(): LegacyTokenBalances {
  const { usdc, bribe, corupt, votes, loading, error, refresh } = useTokenBalances();
  
  return {
    sol: usdc,
    crime: bribe,
    fraud: corupt,
    profit: votes,
    loading,
    error,
    refresh,
  };
}
