/**
 * OHLCV Candle Aggregator
 *
 * Upserts candle data at all 6 resolutions (1m, 5m, 15m, 1h, 4h, 1d) when a
 * swap event arrives. Uses Drizzle ORM's onConflictDoUpdate with SQL GREATEST/LEAST
 * to atomically update high/low prices and accumulate volume + trade count.
 *
 * How it works:
 * 1. A swap event arrives with price P, volume V, and timestamp T
 * 2. For each of the 6 resolutions, compute the candle's openTime by flooring T
 *    to the bucket boundary (e.g., 14:37 floors to 14:35 for 5m resolution)
 * 3. INSERT a new candle OR UPDATE the existing one:
 *    - high = GREATEST(existing high, new price)
 *    - low = LEAST(existing low, new price)
 *    - close = new price (latest trade always becomes close)
 *    - volume += new volume
 *    - tradeCount += 1
 *    - open is NEVER overwritten (first trade in the candle sets it)
 *
 * The composite unique index (pool, resolution, open_time) on the candles table
 * provides the conflict target for upsert.
 */

import { db } from "./connection";
import { candles } from "./schema";
import { sql } from "drizzle-orm";
import type { ParsedTaxedSwap, ParsedUntaxedSwap } from "@/lib/event-parser";

// =============================================================================
// Types
// =============================================================================

/** Data needed to upsert candles for a single swap event. */
export interface CandleUpdate {
  /** Pool PDA address (base58 string) */
  pool: string;
  /** Derived price (SOL per token for SOL pools, sideA per sideB for PROFIT pools) */
  price: number;
  /** Volume in lamports (SOL-side for SOL pools, input amount for PROFIT pools) */
  volume: number;
  /** Swap timestamp */
  timestamp: Date;
}

// =============================================================================
// Resolution Configuration
// =============================================================================

/** All supported candle resolutions and their bucket size in seconds. */
const RESOLUTION_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

/** Ordered list of all resolutions for iteration. */
const RESOLUTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

// =============================================================================
// Time Truncation
// =============================================================================

/**
 * Floor a timestamp to the nearest resolution boundary.
 *
 * Example: For 15m resolution, 14:37:22 becomes 14:30:00.
 * All timestamps are treated as UTC (no timezone conversion).
 *
 * @param timestamp - The swap timestamp
 * @param resolution - One of "1m", "5m", "15m", "1h", "4h", "1d"
 * @returns Date floored to the resolution boundary
 */
function truncateToResolution(timestamp: Date, resolution: string): Date {
  const seconds = RESOLUTION_SECONDS[resolution];
  if (!seconds) throw new Error(`Unknown resolution: ${resolution}`);
  const unixSeconds = Math.floor(timestamp.getTime() / 1000);
  const truncated = Math.floor(unixSeconds / seconds) * seconds;
  return new Date(truncated * 1000);
}

// =============================================================================
// Core Upsert Function
// =============================================================================

/**
 * Upsert OHLCV candles at all 6 resolutions for a single swap event.
 *
 * All 6 upserts run in parallel (Promise.all) since they target different
 * resolution rows and cannot conflict with each other.
 *
 * The SQL GREATEST/LEAST functions ensure correct high/low tracking even
 * if webhook delivers events out of order. The `open` column is never
 * overwritten because Drizzle's onConflictDoUpdate only touches the
 * columns listed in `set`.
 *
 * @param update - Price, volume, pool, and timestamp from the swap event
 */
export async function upsertCandles(update: CandleUpdate): Promise<void> {
  await Promise.all(
    RESOLUTIONS.map((resolution) => {
      const openTime = truncateToResolution(update.timestamp, resolution);
      return db
        .insert(candles)
        .values({
          pool: update.pool,
          resolution,
          openTime,
          open: update.price,
          high: update.price,
          low: update.price,
          close: update.price,
          volume: update.volume,
          tradeCount: 1,
        })
        .onConflictDoUpdate({
          target: [candles.pool, candles.resolution, candles.openTime],
          set: {
            high: sql`GREATEST(${candles.high}, ${update.price})`,
            low: sql`LEAST(${candles.low}, ${update.price})`,
            close: sql`${update.price}`,
            volume: sql`${candles.volume} + ${update.volume}`,
            tradeCount: sql`${candles.tradeCount} + 1`,
          },
        });
    }),
  );
}

// =============================================================================
// Convenience Wrapper for Swap Events
// =============================================================================

/**
 * Compute a CandleUpdate from a parsed swap event and upsert all 6 resolutions.
 *
 * This simplifies the webhook handler call site by handling price derivation
 * and volume extraction in one place.
 *
 * Price derivation (AMM price, excluding tax):
 * - TaxedSwap Buy:  price = (inputAmount - taxAmount) / outputAmount
 *   Tax is deducted from SOL input before the AMM swap, so the AMM only
 *   sees (inputAmount - taxAmount). Using raw inputAmount would inflate
 *   the price and cause fake price jumps when tax rates change between epochs.
 * - TaxedSwap Sell: price = (outputAmount + taxAmount) / inputAmount
 *   Tax is deducted from the AMM's SOL output, so gross output = outputAmount + taxAmount.
 * - UntaxedSwap:    price = inputAmount / outputAmount (no tax adjustment needed)
 *
 * Volume:
 * - SOL pools: SOL-side amount in lamports (inputAmount for buy, outputAmount for sell)
 * - PROFIT pools: inputAmount (the amount the user is selling)
 *
 * @param swap - Parsed TaxedSwap or UntaxedSwap event
 * @param poolAddress - Pre-resolved pool PDA address
 * @param timestamp - Swap timestamp from block time
 */
export async function upsertCandlesForSwap(
  swap: ParsedTaxedSwap | ParsedUntaxedSwap,
  poolAddress: string,
  timestamp: Date,
): Promise<void> {
  // Derive AMM price (excluding tax) from input/output ratio
  const direction = swap.direction;
  let price: number;
  if (swap.type === "TaxedSwap") {
    // SOL pools: exclude tax to show the actual AMM exchange rate.
    // Without this, tax rate flips between epochs cause fake price jumps.
    if (direction === "buy") {
      const netInput = swap.inputAmount - swap.taxAmount;
      price = swap.outputAmount > 0 ? netInput / swap.outputAmount : 0;
    } else {
      const grossOutput = swap.outputAmount + swap.taxAmount;
      price = swap.inputAmount > 0 ? grossOutput / swap.inputAmount : 0;
    }
  } else {
    // DEAD CODE — UntaxedSwap (PROFIT pool) events no longer emitted.
    // Vault conversions have a fixed rate — no price discovery to aggregate
    // into candles. Retained for historical event replay. Phase 4 DBS.
    if (direction === "buy") {
      price = swap.outputAmount > 0 ? swap.inputAmount / swap.outputAmount : 0;
    } else {
      price = swap.inputAmount > 0 ? swap.outputAmount / swap.inputAmount : 0;
    }
  }

  // Skip zero-price swaps (shouldn't happen in practice, but guards against div-by-zero)
  if (price <= 0) return;

  // Determine volume:
  // SOL pools (TaxedSwap): use the SOL-side amount
  // PROFIT pools (UntaxedSwap): use inputAmount
  let volume: number;
  if (swap.type === "TaxedSwap") {
    // SOL is the input on buy, output on sell
    volume = direction === "buy" ? swap.inputAmount : swap.outputAmount;
  } else {
    // UntaxedSwap (PROFIT pool): use inputAmount as volume
    volume = swap.inputAmount;
  }

  await upsertCandles({
    pool: poolAddress,
    price,
    volume,
    timestamp,
  });
}
