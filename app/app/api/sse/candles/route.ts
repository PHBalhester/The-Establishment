/**
 * SSE Candle Streaming Endpoint
 *
 * Keeps a long-lived HTTP connection open and pushes real-time candle updates
 * to connected browsers using the Server-Sent Events (SSE) protocol.
 *
 * Connection flow:
 * 1. Browser opens EventSource("GET /api/sse/candles")
 * 2. We send an "event: connected" message to confirm the stream is live
 * 3. We subscribe to the SSE manager singleton (same process as webhook handler)
 * 4. When a swap arrives via webhook, the handler upserts candles and calls
 *    sseManager.broadcast("candle-update", {...}) which pushes to this stream
 * 5. Every 15 seconds we send a heartbeat comment to keep the connection alive
 *    (prevents proxy timeouts on Railway / nginx / Cloudflare)
 * 6. On client disconnect (abort signal), we clean up the subscription and interval
 *
 * SSE event format sent to clients:
 *   event: candle-update
 *   data: {"pool":"2QLD...","resolution":"15m","price":0.00005,...}
 *
 * The chart component (Plan 03) will filter events by its current pool and
 * resolution, ignoring updates for other pools/resolutions.
 *
 * Why SSE over WebSocket:
 * SSE is simpler (unidirectional server->client), works natively with Next.js
 * route handlers via ReadableStream, and requires zero extra infrastructure.
 * WebSocket would need a separate server or Socket.io setup.
 */

import { NextRequest } from "next/server";
import { sseManager } from "@/lib/sse-manager";
import { getClientIp } from "@/lib/rate-limit";
import { acquireConnection, releaseConnection, scheduleAutoRelease } from "@/lib/sse-connections";

// Force Node.js runtime -- long-lived connections need persistent Node.js process
export const runtime = "nodejs";
// Disable response caching -- SSE streams must not be cached
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  // ── SSE connection cap (H008) ──────────────────────────────────────
  const clientIp = getClientIp(req);
  if (!acquireConnection(clientIp)) {
    return new Response("Too Many Connections", {
      status: 429,
      headers: { "Retry-After": "30" },
    });
  }

  // Schedule auto-release after 30 min to prevent zombie connections
  const cancelAutoRelease = scheduleAutoRelease(clientIp);

  // Track whether we've already released (prevent double-release)
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      releaseConnection(clientIp);
      cancelAutoRelease();
    }
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // ── Send initial connection confirmation ───────────────────────
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      // ── Subscribe to candle updates ────────────────────────────────
      const unsubscribe = sseManager.subscribe((payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Client disconnected -- ReadableStream controller is closed
          unsubscribe();
        }
      });

      // ── Heartbeat: keep the connection alive ───────────────────────
      // Send an SSE comment (": heartbeat\n\n") every 15 seconds.
      // SSE comments start with ":" and are ignored by EventSource but
      // prevent proxy/LB timeout (Railway, nginx, Cloudflare typically
      // timeout idle connections after 60-120 seconds).
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Client disconnected
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);

      // ── Cleanup on client disconnect ───────────────────────────────
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        release();
        try {
          controller.close();
        } catch {
          // Controller already closed -- safe to ignore
        }
      });
    },
    cancel() {
      // Stream cancelled by the runtime (e.g., client closed tab)
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable nginx/reverse-proxy buffering (Railway uses nginx-based proxy).
      // Without this, SSE events get buffered and arrive in batches instead of
      // streaming in real-time.
      "X-Accel-Buffering": "no",
    },
  });
}
