/**
 * Carnage Events REST API -- Last 5 Carnage Rebalancing Events
 *
 * Returns the most recent 5 carnage events from Postgres, ordered newest-first.
 * This replaces client-side getSignaturesForAddress + getParsedTransaction RPC
 * parsing, saving ~900 Helius credits/hr per browser tab.
 *
 * No query parameters -- always returns the last 5 events. This is a deliberate
 * simplification per CONTEXT.md: the CarnageStation only shows recent history,
 * and 5 events is sufficient for the UI display.
 *
 * The auto-increment `id` field is excluded from the response (not useful to
 * the client). Vault balance is served separately via WebSocket subscription.
 *
 * Follows the same pattern as /api/candles/route.ts:
 *   - Node.js runtime (postgres.js needs Node APIs)
 *   - force-dynamic (no caching)
 *   - Drizzle ORM query with try/catch error handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, CARNAGE_EVENTS_RATE_LIMIT } from '@/lib/rate-limit';
import { captureException } from '@/lib/sentry';
import { db } from '@/db/connection';
import { carnageEvents } from '@/db/schema';
import { desc } from 'drizzle-orm';

// Force Node.js runtime (not Edge) -- postgres.js driver needs Node APIs
export const runtime = 'nodejs';
// Disable response caching -- always serve fresh data
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --- Rate limiting (H015) ---
  const clientIp = getClientIp(req);
  const rateCheck = checkRateLimit(clientIp, CARNAGE_EVENTS_RATE_LIMIT, "carnage-events");
  if (!rateCheck.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(rateCheck.retryAfter) },
    }) as unknown as NextResponse;
  }

  try {
    const events = await db
      .select()
      .from(carnageEvents)
      .orderBy(desc(carnageEvents.timestamp))
      .limit(5);

    // Map to display-ready format (exclude auto-increment id)
    const displayEvents = events.map((row) => ({
      epochNumber: row.epochNumber,
      txSignature: row.txSignature,
      targetToken: row.targetToken,
      path: row.path,
      crimeBurned: row.crimeBurned,
      fraudBurned: row.fraudBurned,
      solUsedForBuy: row.solUsedForBuy,
      crimeBought: row.crimeBought,
      fraudBought: row.fraudBought,
      carnageSolBefore: row.carnageSolBefore,
      carnageSolAfter: row.carnageSolAfter,
      timestamp: row.timestamp,
    }));

    return NextResponse.json(displayEvents);
  } catch (error) {
    console.error('[carnage-events API] Query error:', error);
    captureException(error instanceof Error ? error : new Error(`[carnage-events API] Query error: ${error}`));
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
