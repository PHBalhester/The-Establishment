/**
 * RPC Proxy Route
 *
 * Proxies JSON-RPC requests from the browser to the Helius RPC endpoint.
 * This keeps the Helius API key server-side only -- the browser sends
 * requests to /api/rpc and never sees the upstream URL or credentials.
 *
 * Security:
 * - Method allowlist prevents abuse (only methods the frontend actually uses)
 * - API key stays in HELIUS_RPC_URL env var (server-only, no NEXT_PUBLIC_ prefix)
 * - Disallowed methods are logged and rejected with 400
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, RPC_RATE_LIMIT, SEND_TX_RATE_LIMIT, SIMULATE_TX_RATE_LIMIT } from "@/lib/rate-limit";
import { captureException } from "@/lib/sentry";
import { creditCounter } from "@/lib/credit-counter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Method Allowlist
//
// Every RPC method the frontend calls must be listed here.
// Audited from: hooks (useTokenBalances, usePoolPrices, useCurrentSlot,
// useCarnageData, useStaking), transaction builders (swap-builders,
// multi-hop-builder, staking-builders, wsol), confirm-transaction,
// useProtocolWallet, SwapForm, BuyForm, SellForm, RefundPanel.
//
// Each method has an inline comment explaining which frontend feature uses it.
// If you add a method, document it. If you remove one, grep the frontend first.
// ---------------------------------------------------------------------------
const ALLOWED_METHODS = new Set([
  // -- Account & balance queries --
  "getAccountInfo",           // Pool state, staking state, epoch state, bonding curve reads (usePoolPrices, useStaking, useCarnageData)
  "getBalance",               // SOL balance display in wallet panel (useTokenBalances)
  "getMultipleAccounts",      // Batch-fetch pool + epoch + staking accounts in one call (usePoolPrices, protocol-store)
  "getTokenAccountsByOwner",  // Token balance list for CRIME/FRAUD/PROFIT (useTokenBalances)
  "getTokenAccountBalance",   // Single SPL balance check during swap (swap-builders)
  "getProgramAccounts",       // Discover user staking positions, bonding curve state (useStaking, useCarnageData)

  // -- Transaction lifecycle --
  "getLatestBlockhash",       // Required for every transaction: blockhash + lastValidBlockHeight (all builders)
  "sendTransaction",          // Submit signed transactions to the network (useProtocolWallet) [rate-limited: 10/min]
  "simulateTransaction",      // Wallet preview / Blowfish simulation before signing (Phantom, Backpack) [rate-limited: 20/min]
  "getSignatureStatuses",     // Poll transaction confirmation status (confirm-transaction)
  "confirmTransaction",       // WebSocket-based confirmation listener (confirm-transaction)
  "getBlockHeight",           // Block height for transaction expiry checks (confirm-transaction)

  // -- Slot / block info --
  "getSlot",                  // Current slot for epoch progress display and health check fallback (useCurrentSlot)

  // -- Address Lookup Table (v0 transactions) --
  "getAddressLookupTable",    // Resolve ALT for multi-hop v0 transactions (multi-hop-builder, carnage)

  // -- Helius-specific --
  "getPriorityFeeEstimate",   // Dynamic priority fee for transaction landing (Helius DAS extension, all builders)

  // -- Rent --
  "getMinimumBalanceForRentExemption", // WSOL account creation: compute rent-exempt minimum (wsol helpers)
]);

// ---------------------------------------------------------------------------
// Failover State (H047)
//
// Track which endpoint last succeeded for sticky routing.
// Mask endpoint URLs in logs to avoid leaking API keys.
// ---------------------------------------------------------------------------

/** Last RPC endpoint that returned a successful response */
let lastSuccessfulEndpoint: string | null = null;

/** Mask an endpoint URL to show only hostname (hides API key in path/query) */
function maskEndpoint(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Concurrent Request Tracking (H010)
//
// Cap in-flight requests per IP to prevent upstream worker exhaustion.
// An attacker sending many slow requests (e.g., getProgramAccounts) can
// tie up all upstream connections. This limits the damage per IP.
// ---------------------------------------------------------------------------

const inFlight = new Map<string, number>();
const MAX_CONCURRENT = 20;

// ---------------------------------------------------------------------------
// Body Size Limit (H008)
//
// A single JSON-RPC request is ~200 bytes. 64KB is generous for any
// legitimate request but blocks multi-MB payloads designed to exhaust
// memory or CPU during JSON parsing.
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 65_536; // 64KB

export async function POST(request: NextRequest) {
  // --- Rate limiting (H024) ---
  const clientIp = getClientIp(request);
  const rateCheck = checkRateLimit(clientIp, RPC_RATE_LIMIT, "rpc");
  if (!rateCheck.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(rateCheck.retryAfter) },
    });
  }

  // --- Concurrent request cap (H010) ---
  const currentInFlight = inFlight.get(clientIp) ?? 0;
  if (currentInFlight >= MAX_CONCURRENT) {
    return new Response("Service Unavailable", { status: 503 });
  }
  inFlight.set(clientIp, currentInFlight + 1);

  try {
    // --- Body size limit (H008) ---
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return new Response("Request Entity Too Large", { status: 413 });
    }

    // --- Parse incoming JSON-RPC payload ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
        { status: 400 },
      );
    }

    // --- Batch rejection (H008) ---
    // JSON-RPC batch requests (arrays) amplify a single HTTP request into N
    // upstream calls. Reject them outright -- our frontend never sends batches.
    if (Array.isArray(body)) {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32600, message: "Batch requests not supported" }, id: null },
        { status: 400 },
      );
    }

    const requests: Array<{ jsonrpc?: string; method?: string; params?: unknown; id?: unknown }> =
      [body as Record<string, unknown>];

    // --- Validate methods against allowlist ---
    for (const req of requests) {
      if (!req.method || typeof req.method !== "string") {
        return NextResponse.json(
          { jsonrpc: "2.0", error: { code: -32600, message: "Invalid request: missing method" }, id: req.id ?? null },
          { status: 400 },
        );
      }

      if (!ALLOWED_METHODS.has(req.method)) {
        console.warn(`[rpc-proxy] Blocked disallowed RPC method: ${req.method}`);
        return NextResponse.json(
          { jsonrpc: "2.0", error: { code: -32601, message: `Method not allowed: ${req.method}` }, id: req.id ?? null },
          { status: 400 },
        );
      }

      // --- Per-method rate limiting (defense in depth, on top of shared 300/min) ---
      if (req.method === "sendTransaction") {
        const sendCheck = checkRateLimit(clientIp, SEND_TX_RATE_LIMIT, "rpc:sendTransaction");
        if (!sendCheck.allowed) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": String(sendCheck.retryAfter) },
          });
        }
      } else if (req.method === "simulateTransaction") {
        const simCheck = checkRateLimit(clientIp, SIMULATE_TX_RATE_LIMIT, "rpc:simulateTransaction");
        if (!simCheck.allowed) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": String(simCheck.retryAfter) },
          });
        }
      }
    }

    // --- Forward to Helius with failover (H047) ---
    // Build ordered endpoint list from per-cluster env vars.
    // No hardcoded cross-cluster fallback — each env var is set per Railway service.
    const endpoints = [
      process.env.HELIUS_RPC_URL,
      process.env.HELIUS_RPC_URL_FALLBACK,
      process.env.NEXT_PUBLIC_RPC_URL,
    ].filter(Boolean) as string[];

    // Sticky routing: try last-successful endpoint first
    const orderedEndpoints = lastSuccessfulEndpoint && endpoints.includes(lastSuccessfulEndpoint)
      ? [lastSuccessfulEndpoint, ...endpoints.filter((e) => e !== lastSuccessfulEndpoint)]
      : endpoints;

    const bodyStr = JSON.stringify(body);
    let lastError: unknown = null;

    for (const endpoint of orderedEndpoints) {
      try {
        const upstream = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyStr,
          signal: AbortSignal.timeout(10_000), // 10s timeout (H010)
        });

        // On success (any response from upstream, even RPC errors), return it.
        // Only retry on HTTP 5xx from upstream (indicates upstream is down).
        if (upstream.status >= 500) {
          const hostname = maskEndpoint(endpoint);
          console.warn(`[rpc-proxy] Upstream 5xx from ${hostname} (status ${upstream.status}), trying next`);
          lastError = new Error(`Upstream ${hostname} returned ${upstream.status}`);
          continue;
        }

        // Success -- update sticky routing and return
        lastSuccessfulEndpoint = endpoint;

        // Record RPC credits per method (D5: only after successful upstream response)
        for (const req of requests) {
          if (req.method) creditCounter.recordCall(req.method);
        }

        const data = await upstream.text();
        return new NextResponse(data, {
          status: upstream.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        // Network error (DNS failure, timeout, etc.) -- try next endpoint
        const hostname = maskEndpoint(endpoint);
        console.warn(`[rpc-proxy] Network error from ${hostname}, trying next`);
        lastError = err;
        continue;
      }
    }

    // All endpoints failed
    console.error("[rpc-proxy] All RPC endpoints failed:", lastError);
    captureException(lastError instanceof Error ? lastError : new Error(`[rpc-proxy] All RPC endpoints failed: ${lastError}`));
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal error: upstream RPC unavailable" }, id: null },
      { status: 502 },
    );
  } finally {
    // Always decrement concurrent count, even on error/timeout/early return
    const count = inFlight.get(clientIp) ?? 1;
    if (count <= 1) {
      inFlight.delete(clientIp);
    } else {
      inFlight.set(clientIp, count - 1);
    }
  }
}
