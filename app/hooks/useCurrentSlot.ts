"use client";

/**
 * useCurrentSlot -- SSE-powered slot with client-side estimation
 *
 * Reads the current slot from useProtocolState (server-side SSE feed) as a
 * base value, then runs a client-side estimation interval for sub-second
 * countdown granularity between SSE updates (~5s apart).
 *
 * Zero browser-side RPC calls. Previous cost was ~1-2 credits/hr from
 * getSlot() polling; now 0 credits from browser.
 *
 * Data flow:
 *   ws-subscriber onSlotChange (WS) / getSlot fallback (HTTP)
 *     -> protocolStore("__slot") -> SSE -> useProtocolState
 *     -> useCurrentSlot (this hook) -> client-side estimation interval
 *
 * Return type is unchanged (UseCurrentSlotResult). No downstream changes.
 */

import { useEffect, useState, useRef } from "react";
import { useProtocolState } from "@/hooks/useProtocolState";
import { MS_PER_SLOT } from "@dr-fraudsworth/shared";

/** How often to recompute the estimated slot for display (ms) */
const ESTIMATION_INTERVAL_MS = 5_000;

export interface UseCurrentSlotResult {
  currentSlot: number | null;
  loading: boolean;
  error: string | null;
}

export function useCurrentSlot(): UseCurrentSlotResult {
  const { currentSlot: sseSlotData } = useProtocolState();

  // Base slot + timestamp for client-side estimation between SSE updates
  const baseSlotRef = useRef<number | null>(null);
  const baseTimestampRef = useRef<number>(0);
  const [displaySlot, setDisplaySlot] = useState<number | null>(null);

  // Rebase estimation whenever SSE delivers a new slot value
  useEffect(() => {
    if (!sseSlotData || typeof sseSlotData.slot !== "number") return;

    const sseSlot = sseSlotData.slot as number;
    baseSlotRef.current = sseSlot;
    baseTimestampRef.current = Date.now();
    setDisplaySlot(sseSlot);
  }, [sseSlotData]);

  // Client-side estimation interval for sub-second countdown granularity
  useEffect(() => {
    const interval = setInterval(() => {
      if (baseSlotRef.current === null) return;
      const elapsedMs = Date.now() - baseTimestampRef.current;
      const elapsedSlots = Math.floor(elapsedMs / MS_PER_SLOT);
      setDisplaySlot(baseSlotRef.current + elapsedSlots);
    }, ESTIMATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // loading = no slot data yet
  const loading = sseSlotData === null;

  return { currentSlot: displaySlot, loading, error: null };
}
