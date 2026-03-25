/**
 * GET /api/sol-price
 *
 * Server-side proxy for SOL/USD price with fallback chain.
 *
 * Why server-side: Browser-side calls to third-party price APIs hit CORS
 * restrictions and rate limits (each visitor = separate requests). By
 * proxying through our API route, we get:
 *   1. No CORS issues (server-to-server requests)
 *   2. Shared 60-second cache — all visitors share one cached price
 *   3. Fallback chain — if CoinGecko is down, we try Binance automatically
 *
 * Primary:  CoinGecko free API (no key, reliable from cloud hosting IPs)
 * Fallback: Binance public API (no key, SOLUSDT ≈ USD — may be geo-blocked on some hosts)
 *
 * Note: Jupiter Price API v6 was removed (dead) and v3 now requires an API key.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, SOL_PRICE_RATE_LIMIT } from "@/lib/rate-limit";
import { captureException } from "@/lib/sentry";

// --- Provider URLs ---

/** CoinGecko — free tier, no auth, works from cloud IPs */
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

/** Binance — largest CEX, public ticker endpoint (no auth) */
const BINANCE_URL =
  "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";

// --- Cache ---

/** Cache TTL in milliseconds (60 seconds) */
const CACHE_TTL_MS = 60_000;

let cachedPrice: number | null = null;
let cachedAt = 0;
let cachedSource: string | null = null;

// --- Provider fetchers ---

/** Try CoinGecko first — returns SOL price in USD or null on failure */
async function fetchFromCoinGecko(): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    // Shape: { solana: { usd: 76.78 } }
    const json = await res.json();
    const price = json?.solana?.usd;
    if (typeof price === "number" && Number.isFinite(price)) return price;
    return null;
  } catch {
    return null;
  }
}

/** Fallback to Binance — returns SOLUSDT price or null on failure */
async function fetchFromBinance(): Promise<number | null> {
  try {
    const res = await fetch(BINANCE_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    // Shape: { symbol: "SOLUSDT", price: "123.45000000" }
    const json = await res.json();
    const price = parseFloat(json?.price);
    if (Number.isFinite(price)) return price;
    return null;
  } catch {
    return null;
  }
}

// --- Route handler ---

export async function GET(request: NextRequest) {
  // --- Rate limiting (H024) ---
  const clientIp = getClientIp(request);
  const rateCheck = checkRateLimit(clientIp, SOL_PRICE_RATE_LIMIT, "sol-price");
  if (!rateCheck.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(rateCheck.retryAfter) },
    });
  }

  const now = Date.now();

  // Return cached price if still fresh
  if (cachedPrice !== null && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      price: cachedPrice,
      source: cachedSource,
      cached: true,
    });
  }

  // Try CoinGecko (primary)
  let price = await fetchFromCoinGecko();
  let source = "coingecko";

  // Try Binance (fallback)
  if (price === null) {
    price = await fetchFromBinance();
    source = "binance";
  }

  // Both failed — return stale cache if we have one
  if (price === null) {
    if (cachedPrice !== null) {
      return NextResponse.json({
        price: cachedPrice,
        source: cachedSource,
        cached: true,
        stale: true,
      });
    }
    captureException(new Error("[sol-price] All price providers unavailable (CoinGecko + Binance)"));
    return NextResponse.json(
      { error: "All price providers unavailable" },
      { status: 502 }
    );
  }

  // Update cache
  cachedPrice = price;
  cachedAt = now;
  cachedSource = source;

  return NextResponse.json({ price, source, cached: false });
}
