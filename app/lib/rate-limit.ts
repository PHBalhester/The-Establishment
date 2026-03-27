/**
 * In-Memory Sliding Window Rate Limiter
 *
 * Zero-dependency rate limiting for API endpoints. Uses a sliding window
 * algorithm: for each IP, we track recent request timestamps and reject
 * requests when the count within the window exceeds the configured maximum.
 *
 * Why in-memory (not Redis):
 * - Single Railway instance (no horizontal scaling needed)
 * - Zero external dependencies
 * - Microsecond lookup time
 * - Automatic cleanup via periodic sweep
 *
 * Closes H024 (API rate limiting).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** Recent request timestamps (ms since epoch) */
  timestamps: number[];
}

export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests allowed within the window */
  maxRequests: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until the client should retry (only set when rejected) */
  retryAfter?: number;
}

// ---------------------------------------------------------------------------
// Pre-configured rate limit profiles
// ---------------------------------------------------------------------------

/** /api/rpc -- RPC proxy. Launch page at 1s polling needs ~180 req/min */
export const RPC_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 300,
};

/** /api/sol-price -- 1 req per page load, 60s cache. 30/min is generous */
export const SOL_PRICE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 30,
};

/** /api/webhooks/helius -- Helius sends bursts during active trading */
export const WEBHOOK_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 120,
};

/** /api/candles -- chart data, polls every 5-15s. 120/min generous */
export const CANDLES_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 120,
};

/** /api/carnage-events -- loaded once per page, SSE provides updates */
export const CARNAGE_EVENTS_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 60,
};

/** /api/health -- Railway probes ~1/min; 30/min generous for monitoring */
export const HEALTH_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 30,
};

/** /api/rpc sendTransaction -- normal user: 1-2/min (one per swap) */
export const SEND_TX_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 10,
};

/** /api/rpc simulateTransaction -- normal user: 1-2 per swap attempt (wallet preview) */
export const SIMULATE_TX_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 20,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const entries = new Map<string, RateLimitEntry>();

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Check whether a request from the given IP is allowed under the rate limit.
 *
 * Algorithm (sliding window counter):
 * 1. Filter the IP's timestamps to those within the current window.
 * 2. If the count >= maxRequests, reject and return retryAfter (seconds until
 *    the oldest timestamp in the window expires).
 * 3. Otherwise, record this request's timestamp and allow.
 */
export function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
  endpoint: string = "default",
): RateLimitResult {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = entries.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    entries.set(key, entry);
  }

  // Slide the window: keep only timestamps within the current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    // Rejected -- calculate when the oldest request in the window expires
    const oldestInWindow = entry.timestamps[0]!;
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    return {
      allowed: false,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  // Allowed -- record this request
  entry.timestamps.push(now);
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// IP Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the client's real IP address from the request.
 *
 * Priority:
 * 1. x-envoy-external-address (Railway uses Envoy proxy — this is the real client IP)
 * 2. x-forwarded-for rightmost (fallback for non-Railway proxies)
 * 3. x-real-ip (nginx convention)
 * 4. "unknown" fallback
 *
 * Railway's Envoy proxy sets x-envoy-external-address to the actual client IP.
 * x-forwarded-for rightmost on Railway is often the Envoy internal IP, NOT the
 * client — which causes all users to share one rate-limit bucket.
 */
export function getClientIp(request: Request): string {
  // Railway Envoy: trusted, not client-spoofable
  const envoyIp = request.headers.get("x-envoy-external-address");
  if (envoyIp) return envoyIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the rightmost IP (appended by trusted proxy, not client-spoofable)
    const ips = forwarded.split(",").map((ip) => ip.trim()).filter(Boolean);
    const realIp = ips[ips.length - 1];
    if (realIp) return realIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  // No proxy headers found -- all requests will share a single rate-limit bucket.
  // In production behind a reverse proxy this indicates misconfiguration (VH-M002).
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[rate-limit] WARNING: No proxy headers (x-forwarded-for, x-real-ip) detected. " +
      "All requests sharing a single rate-limit bucket. " +
      "Check reverse proxy configuration (VH-M002)."
    );
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Periodic Cleanup
//
// Sweep stale entries every 60 seconds to prevent unbounded memory growth.
// An entry is stale if all its timestamps are older than 5 minutes.
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MS = 5 * 60_000;

// Use globalThis to prevent duplicate intervals across hot reloads in dev
const CLEANUP_KEY = Symbol.for("dr-fraudsworth-rate-limit-cleanup");

if (!(globalThis as Record<symbol, unknown>)[CLEANUP_KEY]) {
  const interval = setInterval(() => {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    for (const [ip, entry] of entries) {
      // Remove entries where ALL timestamps are older than the stale threshold
      if (entry.timestamps.length === 0 || entry.timestamps.every((t) => t < cutoff)) {
        entries.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent Node.js from exiting
  if (interval.unref) interval.unref();

  (globalThis as Record<symbol, unknown>)[CLEANUP_KEY] = true;
}
