"use client";

/**
 * ProtocolStateProvider -- Single SSE connection for the entire app
 *
 * Problem: useProtocolState() previously created a new EventSource per hook
 * call. The SwapStation page has 7 components that each call useProtocolState()
 * (directly or via derived hooks like usePoolPrices, useEpochState,
 * useTokenSupply), creating 7 SSE connections per tab. The server-side
 * MAX_PER_IP=10 cap means a second user gets blocked.
 *
 * Solution: This provider creates ONE EventSource per tab and shares the
 * parsed protocol state via React Context. All existing consumers call
 * useProtocolState() which now reads from context instead of managing its
 * own EventSource.
 *
 * Features preserved from the original hook:
 * - SSE connection with auto-reconnect (exponential backoff: 1s -> 30s max)
 * - Initial state snapshot on connect (no stale data on first render)
 * - Polling fallback after 30s of SSE downtime (60s interval via RPC)
 * - Visibility-aware: pauses SSE when tab is hidden, resumes on return
 */

import { createContext, useEffect, useState, useRef, useCallback } from "react";
import { useVisibility } from "@/hooks/useVisibility";
import {
  DEVNET_PDAS,
  DEVNET_PDAS_EXTENDED,
  DEVNET_POOLS,
  DEVNET_CURVE_PDAS,
} from "@/lib/protocol-config";
import { getConnection } from "@/lib/connection";
import { PublicKey } from "@solana/web3.js";
import { bigintReviver } from "@/lib/bigint-json";
import type { ProtocolState, ProtocolStateMap, AccountStateData } from "@/hooks/useProtocolState";

// =============================================================================
// Constants (moved from useProtocolState)
// =============================================================================

/** Pubkeys for well-known protocol accounts (used for structured state extraction) */
const ACCOUNT_KEYS = {
  // Existing (7)
  epochState: DEVNET_PDAS.EpochState.toBase58(),
  carnageFund: DEVNET_PDAS.CarnageFund.toBase58(),
  crimePool: DEVNET_POOLS.CRIME_SOL.pool.toBase58(),
  fraudPool: DEVNET_POOLS.FRAUD_SOL.pool.toBase58(),
  stakePool: DEVNET_PDAS_EXTENDED.StakePool.toBase58(),
  crimeCurve: DEVNET_CURVE_PDAS.crime.curveState.toBase58(),
  fraudCurve: DEVNET_CURVE_PDAS.fraud.curveState.toBase58(),
  // New -- Phase 3 (5)
  carnageSolVault: DEVNET_PDAS.CarnageSolVault.toBase58(),
  crimeSupply: "__supply:CRIME",
  fraudSupply: "__supply:FRAUD",
  currentSlot: "__slot",
  stakingStats: "__staking:globalStats",
} as const;

/** All monitored account pubkeys for RPC polling fallback */
const ALL_MONITORED_PUBKEYS: PublicKey[] = [
  DEVNET_PDAS.EpochState,
  DEVNET_PDAS.CarnageFund,
  DEVNET_PDAS.CarnageSolVault,
  DEVNET_POOLS.CRIME_SOL.pool,
  DEVNET_POOLS.FRAUD_SOL.pool,
  DEVNET_PDAS_EXTENDED.StakePool,
  DEVNET_CURVE_PDAS.crime.curveState,
  DEVNET_CURVE_PDAS.fraud.curveState,
];

/** How long to wait before activating polling fallback (30 seconds) */
const SSE_DOWNTIME_THRESHOLD_MS = 30_000;

/** Polling interval when SSE is down (60 seconds) */
const POLLING_INTERVAL_MS = 60_000;

// =============================================================================
// Helper: extract structured state from raw accounts map
// =============================================================================

function extractStructuredState(accounts: ProtocolStateMap): ProtocolState {
  return {
    accounts,
    epochState: accounts[ACCOUNT_KEYS.epochState] ?? null,
    crimePool: accounts[ACCOUNT_KEYS.crimePool] ?? null,
    fraudPool: accounts[ACCOUNT_KEYS.fraudPool] ?? null,
    stakePool: accounts[ACCOUNT_KEYS.stakePool] ?? null,
    carnageFund: accounts[ACCOUNT_KEYS.carnageFund] ?? null,
    crimeCurve: accounts[ACCOUNT_KEYS.crimeCurve] ?? null,
    fraudCurve: accounts[ACCOUNT_KEYS.fraudCurve] ?? null,
    // New -- Phase 3
    carnageSolVault: accounts[ACCOUNT_KEYS.carnageSolVault] ?? null,
    crimeSupply: accounts[ACCOUNT_KEYS.crimeSupply] ?? null,
    fraudSupply: accounts[ACCOUNT_KEYS.fraudSupply] ?? null,
    currentSlot: accounts[ACCOUNT_KEYS.currentSlot] ?? null,
    stakingStats: accounts[ACCOUNT_KEYS.stakingStats] ?? null,
  };
}

// =============================================================================
// Default state (used before provider mounts and as context default)
// =============================================================================

const DEFAULT_STATE: ProtocolState = {
  accounts: {},
  epochState: null,
  crimePool: null,
  fraudPool: null,
  stakePool: null,
  carnageFund: null,
  crimeCurve: null,
  fraudCurve: null,
  carnageSolVault: null,
  crimeSupply: null,
  fraudSupply: null,
  currentSlot: null,
  stakingStats: null,
};

// =============================================================================
// Context
// =============================================================================

export const ProtocolStateContext = createContext<ProtocolState>(DEFAULT_STATE);

// =============================================================================
// Provider Component
// =============================================================================

export function ProtocolStateProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<ProtocolStateMap>({});

  // Refs for SSE lifecycle management
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  // Track SSE connection health for polling fallback
  const lastSseDataRef = useRef<number>(Date.now());
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Visibility gating (no station required -- protocol state used globally)
  const { isActive } = useVisibility();
  const prevIsActiveRef = useRef(isActive);

  // ---------------------------------------------------------------------------
  // RPC Polling Fallback
  //
  // When SSE has been down for >30s, poll via getMultipleAccountsInfo every
  // 60s to keep data somewhat fresh. Stops when SSE reconnects.
  // ---------------------------------------------------------------------------

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const pollViaRpc = useCallback(async () => {
    try {
      const connection = getConnection();
      const infos = await connection.getMultipleAccountsInfo(
        ALL_MONITORED_PUBKEYS,
      );

      if (!mountedRef.current) return;

      setAccounts((prev) => {
        const next = { ...prev };
        for (let i = 0; i < ALL_MONITORED_PUBKEYS.length; i++) {
          const info = infos[i];
          if (info) {
            const pubkey = ALL_MONITORED_PUBKEYS[i].toBase58();

            // Don't overwrite Anchor-decoded data with raw account metadata.
            // See original useProtocolState for full explanation.
            const existing = prev[pubkey];
            if (
              existing &&
              typeof existing === "object" &&
              (existing as Record<string, unknown>).label !== "rpc-poll"
            ) {
              continue; // Preserve existing decoded data
            }

            next[pubkey] = {
              label: `rpc-poll`,
              lamports: info.lamports,
              owner: info.owner.toBase58(),
              dataLength: info.data.length,
              updatedAt: Date.now(),
            };
          }
        }
        return next;
      });
    } catch (err) {
      // Polling failure is not critical -- will retry next interval
      console.warn("[ProtocolStateProvider] RPC polling failed:", err);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return; // Already polling

    // Immediate first poll
    pollViaRpc();

    pollingIntervalRef.current = setInterval(pollViaRpc, POLLING_INTERVAL_MS);
  }, [pollViaRpc]);

  // ---------------------------------------------------------------------------
  // SSE Connection Management
  // ---------------------------------------------------------------------------

  const closeEventSource = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    closeEventSource();

    const es = new EventSource("/api/sse/protocol");
    eventSourceRef.current = es;

    // -- Initial state snapshot -----------------------------------------------
    es.addEventListener("initial-state", (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data, bigintReviver) as ProtocolStateMap;
        setAccounts(data);
        lastSseDataRef.current = Date.now();
        reconnectAttemptsRef.current = 0;

        // SSE is working -- stop polling fallback if active
        stopPolling();
      } catch {
        // Ignore malformed initial state
      }
    });

    // -- Protocol update events -----------------------------------------------
    es.addEventListener("protocol-update", (event) => {
      if (!mountedRef.current) return;
      try {
        const { account, data } = JSON.parse(event.data, bigintReviver) as {
          account: string;
          data: AccountStateData;
        };
        setAccounts((prev) => ({ ...prev, [account]: data }));
        lastSseDataRef.current = Date.now();

        // SSE is working -- stop polling fallback if active
        stopPolling();
      } catch {
        // Ignore malformed updates
      }
    });

    // -- Error / disconnect handling ------------------------------------------
    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      if (!mountedRef.current) return;

      const delay = Math.min(
        1000 * 2 ** reconnectAttemptsRef.current,
        30_000,
      );
      reconnectAttemptsRef.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);

      // Check if SSE has been down long enough to activate polling fallback
      const downtime = Date.now() - lastSseDataRef.current;
      if (downtime >= SSE_DOWNTIME_THRESHOLD_MS) {
        startPolling();
      }
    };
  }, [closeEventSource, stopPolling, startPolling]);

  // ---------------------------------------------------------------------------
  // Periodic check: activate polling if SSE has been down >30s
  // (covers the case where onerror fires but downtime threshold not yet met)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (!mountedRef.current) return;
      const downtime = Date.now() - lastSseDataRef.current;
      if (
        downtime >= SSE_DOWNTIME_THRESHOLD_MS &&
        !pollingIntervalRef.current
      ) {
        startPolling();
      }
    }, 10_000); // Check every 10 seconds

    return () => clearInterval(checkInterval);
  }, [startPolling]);

  // ---------------------------------------------------------------------------
  // Mount / Unmount lifecycle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;

    if (isActive) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      closeEventSource();
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Visibility transitions: pause/resume SSE
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (wasActive && !isActive) {
      // Tab hidden: close SSE to save resources
      closeEventSource();
      stopPolling();
    } else if (!wasActive && isActive) {
      // Tab visible: reconnect SSE
      reconnectAttemptsRef.current = 0;
      connect();
    }
  }, [isActive, closeEventSource, stopPolling, connect]);

  // ---------------------------------------------------------------------------
  // Derive structured state and provide via context
  // ---------------------------------------------------------------------------
  const state = extractStructuredState(accounts);

  return (
    <ProtocolStateContext.Provider value={state}>
      {children}
    </ProtocolStateContext.Provider>
  );
}
