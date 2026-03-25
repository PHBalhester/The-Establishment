/**
 * SOL Price Helper
 *
 * Fetches the current SOL/USD price for market cap and value computations.
 *
 * Calls our own /api/sol-price route which proxies Jupiter (primary) and
 * Binance (fallback) server-side. This avoids CORS issues and rate limits
 * because all visitors share a single 60-second cached price on the server.
 */

/**
 * Fetch the current SOL/USD price from our server-side proxy.
 *
 * @returns The SOL price in USD, or null if the request fails or the
 *          response is malformed. Never throws -- all errors are swallowed.
 */
export async function fetchSolPrice(): Promise<number | null> {
  try {
    const response = await fetch("/api/sol-price");
    if (!response.ok) return null;

    // Response shape: { price: 123.45, source: "jupiter", cached: false }
    const json = await response.json();
    const price = json?.price;
    if (typeof price !== "number" || !Number.isFinite(price)) return null;

    return price;
  } catch {
    // Network error, JSON parse error, etc. -- return null, don't crash.
    return null;
  }
}
