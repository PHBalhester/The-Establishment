"use client";

/**
 * useChartSSE -- EventSource hook for SSE candle updates
 *
 * Manages the SSE connection lifecycle to /api/sse/candles with:
 * - Auto-reconnect using exponential backoff (1s, 2s, 4s, ... max 30s)
 * - Connection status tracking (connected/reconnecting/disconnected)
 * - Stable callback ref pattern (onUpdateRef) to prevent EventSource
 *   re-establishment when the onUpdate callback changes
 *
 * The SSE server (Plan 02) sends two event types:
 * - "connected" -- confirms the stream is live (resets reconnect counter)
 * - "candle-update" -- JSON payload with {pool, resolution, price, volume, timestamp}
 *
 * The consumer (useChartData) filters updates by pool+resolution before applying.
 */

import { useEffect, useRef, useState } from "react";

// =============================================================================
// Types
// =============================================================================

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

/** Shape of a candle-update SSE event payload from the server. */
export interface CandleSSEUpdate {
  /** Pool PDA address (base58 string) */
  pool: string;
  /** Candle resolution this update applies to (e.g., "15m") */
  resolution: string;
  /** Latest trade price */
  price: number;
  /** Trade volume */
  volume: number;
  /** Trade timestamp in Unix seconds */
  timestamp: number;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Connect to the SSE candle stream and dispatch updates to the provided callback.
 *
 * @param onUpdate - Called for each candle-update event. Uses ref pattern
 *   so the EventSource is not re-established when this function changes.
 * @returns Connection status for UI indicator (green/amber/red dot)
 */
export function useChartSSE(
  onUpdate: (update: CandleSSEUpdate) => void,
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Ref pattern: always call the latest callback without re-triggering the effect.
  // This is a standard React pattern for stable effect dependencies.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;

    function connect() {
      const es = new EventSource("/api/sse/candles");
      eventSourceRef.current = es;

      // "connected" event from SSE server confirms the stream is live
      es.addEventListener("connected", () => {
        setStatus("connected");
        reconnectAttempts = 0;
      });

      // "candle-update" event carries the OHLCV update payload
      es.addEventListener("candle-update", (event) => {
        try {
          const data = JSON.parse(event.data) as CandleSSEUpdate;
          onUpdateRef.current(data);
        } catch {
          // Ignore malformed data -- don't crash the SSE connection
        }
      });

      // On error (network disconnect, server restart), close and reconnect
      // with exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
      es.onerror = () => {
        es.close();
        setStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
        reconnectAttempts++;
        reconnectTimeout = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      eventSourceRef.current?.close();
      setStatus("disconnected");
    };
  }, []);

  return { status };
}
