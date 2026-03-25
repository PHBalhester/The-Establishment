"use client";

/**
 * useChartData -- Manages chart candle state from REST + SSE
 *
 * This hook provides the complete data layer for the CandlestickChart component:
 * 1. Fetches historical candles from GET /api/candles when pool, resolution, or
 *    time range changes
 * 2. Receives real-time SSE updates via useChartSSE and merges them into the
 *    candle array (update-in-place or append)
 * 3. Exposes the candle data array, loading state, and control setters
 *
 * Time ranges auto-select a sensible default resolution:
 *   1H -> 1m, 4H -> 5m, 1D -> 15m, 1W -> 1h
 *
 * SSE update logic:
 * - Only processes updates matching the current pool + resolution
 * - If the update timestamp falls within the last candle's period, updates it
 *   in-place (high=max, low=min, close=price, volume+=)
 * - If the update timestamp is beyond the last candle, appends a new candle
 * - Uses functional setState to avoid stale closure issues
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useChartSSE, type CandleSSEUpdate } from "./useChartSSE";

// =============================================================================
// Types
// =============================================================================

/** OHLCV candle data in TradingView-compatible format. */
export interface CandleData {
  /** Unix seconds (UTCTimestamp for TradingView Lightweight Charts) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Predefined time ranges for the chart view window. */
export type TimeRange = "1H" | "4H" | "1D" | "1W";

/** Candle resolution (bucket size). Must match the 6 resolutions in candle-aggregator.ts. */
export type Resolution = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

// =============================================================================
// Mappings
// =============================================================================

/**
 * Map time ranges to sensible default resolutions.
 *
 * Why these defaults:
 * - 1H range with 1m resolution = 60 candles (readable, not too dense)
 * - 4H range with 5m resolution = 48 candles
 * - 1D range with 15m resolution = 96 candles
 * - 1W range with 1h resolution = 168 candles
 */
const RANGE_TO_RESOLUTION: Record<TimeRange, Resolution> = {
  "1H": "1m",
  "4H": "5m",
  "1D": "15m",
  "1W": "1h",
};

/** Map time ranges to seconds of history to fetch from the REST API. */
const RANGE_TO_SECONDS: Record<TimeRange, number> = {
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
  "1W": 604800,
};

/**
 * Resolution bucket sizes in seconds.
 * Used for determining whether an SSE update falls within the last candle's
 * time period or should create a new candle.
 */
const RESOLUTION_SECONDS: Record<Resolution, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

// =============================================================================
// Hook
// =============================================================================

export function useChartData(pool: string, options?: {
  initialRange?: TimeRange;
  initialResolution?: Resolution;
}) {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [range, setRange] = useState<TimeRange>(options?.initialRange ?? "1D");
  const [resolution, setResolution] = useState<Resolution>(
    options?.initialResolution ?? RANGE_TO_RESOLUTION["1D"]
  );
  const [loading, setLoading] = useState(true);

  // Track current resolution in a ref for SSE callback (avoids stale closure)
  const resolutionRef = useRef(resolution);
  resolutionRef.current = resolution;
  const poolRef = useRef(pool);
  poolRef.current = pool;

  // ── Range change handler ────────────────────────────────────────────────
  // When range changes, auto-select a sensible resolution so the user
  // doesn't get 1m candles for a 1W view (too many data points).
  const handleRangeChange = useCallback((newRange: TimeRange) => {
    setRange(newRange);
    setResolution(RANGE_TO_RESOLUTION[newRange]);
  }, []);

  // ── Fetch historical candles from REST API ──────────────────────────────
  // Re-fetches whenever pool, resolution, or range changes.
  useEffect(() => {
    if (!pool) return;

    // Memory hygiene: clear stale data immediately on pool/resolution/range change.
    // This triggers seriesRef.current.setData([]) in CandlestickChart before the
    // new fetch completes, preventing a flash of stale candles from the previous
    // pool or timeframe. This is the recommended pattern from RESEARCH.md.
    setCandles([]);

    let cancelled = false;
    setLoading(true);

    const now = Math.floor(Date.now() / 1000);
    const from = now - RANGE_TO_SECONDS[range];
    // gapfill=false: request only real trade candles. Synthetic gap-fill candles
    // create misleading flat lines for memecoin prices where long idle periods
    // are normal. The API defaults gapfill=true for backward compatibility.
    const url = `/api/candles?pool=${encodeURIComponent(pool)}&resolution=${resolution}&from=${from}&to=${now}&limit=2000&gapfill=false`;

    fetch(url)
      .then((res) => res.json())
      .then((data: CandleData[]) => {
        if (!cancelled) {
          setCandles(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCandles([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pool, resolution, range]);

  // ── Handle SSE updates ──────────────────────────────────────────────────
  // Only processes updates for the current pool + resolution.
  // Uses functional setState to avoid stale closure issues.
  const handleSSEUpdate = useCallback((update: CandleSSEUpdate) => {
    // Filter: ignore updates for other pools or resolutions
    if (update.pool !== poolRef.current || update.resolution !== resolutionRef.current) {
      return;
    }

    const bucketSeconds = RESOLUTION_SECONDS[resolutionRef.current];

    setCandles((prev) => {
      if (prev.length === 0) {
        // No existing candles -- create the first one
        const bucketTime = Math.floor(update.timestamp / bucketSeconds) * bucketSeconds;
        return [{
          time: bucketTime,
          open: update.price,
          high: update.price,
          low: update.price,
          close: update.price,
          volume: update.volume,
        }];
      }

      const lastCandle = prev[prev.length - 1];
      const updateBucketTime = Math.floor(update.timestamp / bucketSeconds) * bucketSeconds;

      if (updateBucketTime === lastCandle.time) {
        // Update falls within the last candle's period -- update in-place
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...lastCandle,
          high: Math.max(lastCandle.high, update.price),
          low: Math.min(lastCandle.low, update.price),
          close: update.price,
          volume: lastCandle.volume + update.volume,
        };
        return updated;
      }

      if (updateBucketTime > lastCandle.time) {
        // Update is beyond the last candle -- append a new candle
        return [...prev, {
          time: updateBucketTime,
          open: update.price,
          high: update.price,
          low: update.price,
          close: update.price,
          volume: update.volume,
        }];
      }

      // Update is for an older candle (out of order) -- ignore for simplicity.
      // Historical data from REST API is the source of truth for past candles.
      return prev;
    });
  }, []);

  // Connect to SSE stream
  const { status: connectionStatus } = useChartSSE(handleSSEUpdate);

  return {
    candles,
    loading,
    range,
    setRange: handleRangeChange,
    resolution,
    setResolution,
    connectionStatus,
  };
}
