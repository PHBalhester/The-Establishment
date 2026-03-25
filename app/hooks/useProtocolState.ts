"use client";

/**
 * useProtocolState -- SSE-powered hook for real-time protocol account updates
 *
 * Reads shared protocol state from ProtocolStateProvider via React Context.
 * The provider creates a SINGLE EventSource("/api/sse/protocol") per tab,
 * eliminating the N-connections-per-tab problem where each component that
 * called this hook would create its own SSE connection.
 *
 * All derived hooks (usePoolPrices, useEpochState, useTokenSupply, etc.)
 * continue to call useProtocolState() unchanged -- they now share the same
 * underlying SSE connection via context.
 *
 * The return type (ProtocolState) is identical to the previous implementation.
 *
 * Connection management, reconnect logic, polling fallback, and visibility
 * gating now live in ProtocolStateProvider (app/providers/ProtocolStateProvider.tsx).
 */

import { useContext } from "react";
import { ProtocolStateContext } from "@/providers/ProtocolStateProvider";

// =============================================================================
// Types (re-exported so all existing imports continue to work)
// =============================================================================

/** Raw account state as received from the protocol store via SSE */
export type AccountStateData = Record<string, unknown>;

/** Map of account pubkey -> latest state data */
export type ProtocolStateMap = Record<string, AccountStateData>;

/** Structured protocol state with named fields for convenience */
export interface ProtocolState {
  /** All account states indexed by pubkey */
  accounts: ProtocolStateMap;
  // Existing (7)
  /** EpochState account data (if available) */
  epochState: AccountStateData | null;
  /** CRIME/SOL pool state (if available) */
  crimePool: AccountStateData | null;
  /** FRAUD/SOL pool state (if available) */
  fraudPool: AccountStateData | null;
  /** StakePool state (if available) */
  stakePool: AccountStateData | null;
  /** CarnageFundState (if available) */
  carnageFund: AccountStateData | null;
  /** CRIME bonding curve state (if available) */
  crimeCurve: AccountStateData | null;
  /** FRAUD bonding curve state (if available) */
  fraudCurve: AccountStateData | null;
  // New -- Phase 3 (5)
  /** CarnageSolVault native SOL balance (if available) */
  carnageSolVault: AccountStateData | null;
  /** CRIME token supply from server-side polling (if available) */
  crimeSupply: AccountStateData | null;
  /** FRAUD token supply from server-side polling (if available) */
  fraudSupply: AccountStateData | null;
  /** Current slot from server-side polling (if available) */
  currentSlot: AccountStateData | null;
  /** Global staking stats from server-side gPA (if available) */
  stakingStats: AccountStateData | null;
}

// =============================================================================
// Hook
// =============================================================================

export function useProtocolState(): ProtocolState {
  return useContext(ProtocolStateContext);
}
