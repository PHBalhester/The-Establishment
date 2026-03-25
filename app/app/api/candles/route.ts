/**
 * Candle REST API -- Historical OHLCV Data
 *
 * Returns candle data for a specific pool and resolution, sorted by time ascending.
 * TradingView Lightweight Charts consumes this format directly.
 *
 * Query parameters:
 *   pool       (required) -- Pool PDA address (base58 string)
 *   resolution (required) -- One of "1m", "5m", "15m", "1h", "4h", "1d"
 *   from       (optional) -- Start time as ISO string or Unix seconds
 *   to         (optional) -- End time as ISO string or Unix seconds (defaults to now)
 *   limit      (optional) -- Max candles to return. Default 500, max 2000.
 *   gapfill    (optional) -- Set to 'false' to skip gap-fill and return only
 *                            real trade candles. Defaults to true for backward
 *                            compatibility. When false, time gaps between candles
 *                            are preserved (lightweight-charts handles these
 *                            gracefully on the time axis).
 *
 * Gap-fill (when enabled):
 *   Periods with no trades get synthetic "flat" candles where O=H=L=C=last price
 *   and volume=0. This ensures continuous chart rendering without visual gaps.
 *   Gap-fill is applied at query time (not stored in DB) to avoid writing millions
 *   of empty rows during low-activity periods.
 *
 * Response format:
 *   Array of { time, open, high, low, close, volume, tradeCount }
 *   where `time` is Unix seconds (UTCTimestamp for TradingView).
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, CANDLES_RATE_LIMIT } from "@/lib/rate-limit";
import { captureException } from "@/lib/sentry";
import { db } from "@/db/connection";
import { candles } from "@/db/schema";
import { and, eq, gte, lte, asc } from "drizzle-orm";

// Force Node.js runtime (not Edge) -- postgres.js driver needs Node APIs
export const runtime = "nodejs";
// Disable response caching
export const dynamic = "force-dynamic";

// =============================================================================
// Validation
// =============================================================================

const VALID_RESOLUTIONS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

/** Resolution bucket sizes in seconds (same as candle-aggregator.ts). */
const RESOLUTION_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

// =============================================================================
// Candle Formatting
// =============================================================================

/** Format a DB candle row for API response (TradingView-compatible). */
function formatCandle(row: typeof candles.$inferSelect) {
  return {
    time: Math.floor(row.openTime.getTime() / 1000), // Unix seconds (UTCTimestamp)
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    tradeCount: row.tradeCount,
  };
}

// =============================================================================
// Gap Fill
// =============================================================================

/**
 * Insert flat candles for periods with no trades.
 *
 * Walks from the first candle's time to the last candle's time (or the
 * requested range boundaries), stepping by the resolution's bucket size.
 * Any missing time slot gets a synthetic candle with O=H=L=C=last known
 * close price and volume=0.
 *
 * This is the "carry forward last price" approach from CONTEXT.md.
 * It ensures TradingView sees a continuous time series without gaps.
 *
 * @param rows - Candle rows from DB, sorted by openTime ascending
 * @param resolution - The candle resolution being queried
 * @param fromParam - The user's `from` query parameter (null if not provided)
 * @param toParam - The user's `to` query parameter (null if not provided)
 */
function gapFillCandles(
  rows: (typeof candles.$inferSelect)[],
  resolution: string,
  fromParam: string | null,
  toParam: string | null,
): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}> {
  if (rows.length === 0) return [];

  const step = RESOLUTION_SECONDS[resolution]! * 1000; // ms

  // Determine time range boundaries
  // Use query params if provided, otherwise fall back to data boundaries
  const rangeStart = fromParam
    ? parseTimestamp(fromParam)
    : rows[0].openTime.getTime();
  const rangeEnd = toParam
    ? parseTimestamp(toParam)
    : rows[rows.length - 1].openTime.getTime();

  // Floor rangeStart to resolution boundary for alignment
  const stepSec = RESOLUTION_SECONDS[resolution]!;
  const alignedStart =
    Math.floor(rangeStart / 1000 / stepSec) * stepSec * 1000;

  const filled: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    tradeCount: number;
  }> = [];

  let lastPrice = rows[0].close;
  let rowIdx = 0;

  for (let t = alignedStart; t <= rangeEnd; t += step) {
    if (rowIdx < rows.length && rows[rowIdx].openTime.getTime() === t) {
      filled.push(formatCandle(rows[rowIdx]));
      lastPrice = rows[rowIdx].close;
      rowIdx++;
    } else {
      // Gap: carry forward last known price
      filled.push({
        time: Math.floor(t / 1000),
        open: lastPrice,
        high: lastPrice,
        low: lastPrice,
        close: lastPrice,
        volume: 0,
        tradeCount: 0,
      });
    }
  }

  // Append any remaining rows that might fall after rangeEnd
  // (shouldn't happen with correct alignment, but defensive)
  while (rowIdx < rows.length) {
    filled.push(formatCandle(rows[rowIdx]));
    lastPrice = rows[rowIdx].close;
    rowIdx++;
  }

  return filled;
}

/**
 * Parse a timestamp parameter (ISO string or Unix seconds) into ms since epoch.
 */
function parseTimestamp(value: string): number {
  const asNum = Number(value);
  if (!isNaN(asNum)) {
    // Unix seconds (e.g., "1708099200") -> convert to ms
    return asNum * 1000;
  }
  // ISO string (e.g., "2024-02-16T22:00:00Z")
  return new Date(value).getTime();
}

// =============================================================================
// GET Handler
// =============================================================================

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --- Rate limiting (H015) ---
  const clientIp = getClientIp(req);
  const rateCheck = checkRateLimit(clientIp, CANDLES_RATE_LIMIT, "candles");
  if (!rateCheck.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(rateCheck.retryAfter) },
    }) as unknown as NextResponse;
  }

  const { searchParams } = req.nextUrl;

  // ── Extract and validate parameters ──────────────────────────────────
  const pool = searchParams.get("pool");
  const resolution = searchParams.get("resolution");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const limitStr = searchParams.get("limit");
  // gapfill defaults to true for backward compatibility. Pass gapfill=false
  // to get only real trade candles (no synthetic flat candles for gaps).
  const gapfill = searchParams.get("gapfill") !== "false";

  if (!pool || !resolution || !VALID_RESOLUTIONS.has(resolution)) {
    return NextResponse.json(
      {
        error:
          "pool and resolution (1m|5m|15m|1h|4h|1d) query parameters are required",
      },
      { status: 400 },
    );
  }

  // Clamp limit between 1 and 2000, default 500
  const limit = Math.min(
    Math.max(parseInt(limitStr || "500", 10) || 500, 1),
    2000,
  );

  // ── Build query conditions ───────────────────────────────────────────
  const conditions = [
    eq(candles.pool, pool),
    eq(candles.resolution, resolution),
  ];

  if (fromParam) {
    const fromDate = new Date(parseTimestamp(fromParam));
    conditions.push(gte(candles.openTime, fromDate));
  }
  if (toParam) {
    const toDate = new Date(parseTimestamp(toParam));
    conditions.push(lte(candles.openTime, toDate));
  }

  // ── Query Postgres ───────────────────────────────────────────────────
  try {
    const rows = await db
      .select()
      .from(candles)
      .where(and(...conditions))
      .orderBy(asc(candles.openTime))
      .limit(limit);

    // ── Format and optionally gap-fill ─────────────────────────────
    // When gapfill=false, return only real trade candles (no synthetic
    // flat candles). This is preferred for charting because long flat
    // lines from gap-fill are visually misleading.
    const result = gapfill
      ? gapFillCandles(rows, resolution, fromParam, toParam)
      : rows.map(formatCandle);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[candles API] Query error:", error);
    captureException(error instanceof Error ? error : new Error(`[candles API] Query error: ${error}`));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
