"use client";

/**
 * useCarnageEvents -- Fetches carnage events from Postgres API route
 *
 * Fetches carnage events from /api/carnage-events instead of client-side RPC
 * parsing. This eliminated ~900 credits/hr of getSignaturesForAddress +
 * getParsedTransaction calls.
 *
 * Previously, this hook:
 * 1. Called getSignaturesForAddress on the CarnageFund PDA (10 credits/call)
 * 2. Called getParsedTransaction for each signature (1 credit/call, ~5 per cycle)
 * 3. Parsed Anchor event discriminators from transaction logs
 *
 * Now it simply fetches from the Postgres-backed API route that the Helius
 * webhook handler already populates. Zero RPC credits consumed.
 *
 * Polls every 30 seconds with visibility pausing (pauses when tab is hidden
 * or a non-carnage modal is open).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useVisibility } from "@/hooks/useVisibility";

/** How often to poll for Carnage events (ms) -- 30 seconds */
const POLL_INTERVAL_MS = 30_000;

/** Maximum number of events displayed (matches API route limit) */
const MAX_EVENTS = 5;

/** A carnage event from the Postgres API response */
export interface CarnageEvent {
  /** Epoch number when Carnage executed */
  epochNumber: number;
  /** Transaction signature (for Explorer links) */
  txSignature: string;
  /** "CRIME" or "FRAUD" -- the cheap side targeted */
  targetToken: string | null;
  /** "BuyOnly", "Burn", or "BurnAndSell" */
  path: string | null;
  /** CRIME tokens burned in base units */
  crimeBurned: number;
  /** FRAUD tokens burned in base units */
  fraudBurned: number;
  /** SOL used for the buy step in lamports */
  solUsedForBuy: number;
  /** CRIME tokens bought from the pool in base units (null if not applicable) */
  crimeBought: number | null;
  /** FRAUD tokens bought from the pool in base units (null if not applicable) */
  fraudBought: number | null;
  /** SOL in carnage fund before execution in lamports (null if not recorded) */
  carnageSolBefore: number | null;
  /** SOL in carnage fund after execution in lamports (null if not recorded) */
  carnageSolAfter: number | null;
  /** ISO date string from Postgres */
  timestamp: string;
}

export interface UseCarnageEventsResult {
  /** Up to 5 most recent Carnage events, newest first */
  events: CarnageEvent[];
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
}

/**
 * Format a carnage path to a human-readable label.
 * Exported for use by CarnageCard to describe the event.
 *
 * Accepts the path string from the API response:
 * - "BuyOnly" -> "Buy Only"
 * - "Burn" -> "Burn"
 * - "BurnAndSell" -> "Burn & Sell"
 */
export function carnageActionLabel(path: string | null): string {
  switch (path) {
    case "BuyOnly":
      return "Buy Only";
    case "Burn":
      return "Burn";
    case "BurnAndSell":
      return "Burn & Sell";
    default:
      return "Unknown";
  }
}

export function useCarnageEvents(): UseCarnageEventsResult {
  const [events, setEvents] = useState<CarnageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // Carnage events are needed in CarnageStation modal and factory scene (no modal open)
  const { isActive, onResume } = useVisibility("carnage");

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/carnage-events");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CarnageEvent[] = await res.json();
      if (!mountedRef.current) return;
      setEvents(data.slice(0, MAX_EVENTS));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Visibility-aware polling: start/stop interval based on isActive
  useEffect(() => {
    mountedRef.current = true;

    if (!isActive) return;

    // Initial fetch when becoming active
    fetchEvents();

    // Poll every 30 seconds while active
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isActive, fetchEvents]);

  // Register burst-refresh for tab-return transition
  useEffect(() => {
    const cleanup = onResume(fetchEvents);
    return cleanup;
  }, [onResume, fetchEvents]);

  // Cleanup mounted ref on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { events, loading, error };
}
