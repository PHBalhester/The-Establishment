/**
 * SSE Protocol State Streaming Endpoint
 *
 * Keeps a long-lived HTTP connection open and pushes real-time protocol
 * account updates to connected browsers using Server-Sent Events (SSE).
 *
 * Connection flow:
 * 1. Browser opens EventSource("GET /api/sse/protocol")
 * 2. We send an "initial-state" event with ALL current account states from
 *    the protocol store (so new clients don't start with stale data)
 * 3. We subscribe to the SSE manager for "protocol-update" events
 * 4. When a Helius Enhanced Webhook delivers an account change, the webhook
 *    handler calls protocolStore.setAccountState() which broadcasts via
 *    sseManager, and this stream pushes the update to the browser
 * 5. Every 15 seconds we send a heartbeat comment to keep the connection alive
 *    (prevents proxy timeouts on Railway / nginx / Cloudflare)
 * 6. On client disconnect (abort signal), we clean up the subscription and interval
 *
 * SSE event types sent to clients:
 *   event: initial-state
 *   data: {"<pubkey>": {...}, "<pubkey>": {...}, ...}
 *
 *   event: protocol-update
 *   data: {"account":"<pubkey>","data":{...}}
 *
 * Follows the same pattern as /api/sse/candles (Plan 42-02).
 */

import { NextRequest } from "next/server";
import { sseManager } from "@/lib/sse-manager";
import { protocolStore } from "@/lib/protocol-store";
import { getClientIp } from "@/lib/rate-limit";
import { acquireConnection, releaseConnection, scheduleAutoRelease } from "@/lib/sse-connections";
import { bigintReplacer } from "@/lib/bigint-json";

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
      // ── Send initial state snapshot ──────────────────────────────────
      // New clients receive all currently cached protocol account states
      // so they don't start with empty data and wait for the next change.
      const initialState = protocolStore.getAllAccountStates();
      controller.enqueue(
        encoder.encode(
          `event: initial-state\ndata: ${JSON.stringify(initialState, bigintReplacer)}\n\n`,
        ),
      );

      // ── Subscribe to protocol updates ────────────────────────────────
      // The SSE manager broadcasts "protocol-update" events when the webhook
      // handler stores new account state. We filter for only protocol-update
      // events by checking the event name in the raw SSE payload.
      const unsubscribe = sseManager.subscribe((payload: string) => {
        // Only forward protocol-update events (not candle-update, etc.)
        if (!payload.startsWith("event: protocol-update\n")) return;

        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Client disconnected -- ReadableStream controller is closed
          unsubscribe();
        }
      });

      // ── Heartbeat: keep the connection alive ─────────────────────────
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

      // ── Cleanup on client disconnect ─────────────────────────────────
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
      "X-Accel-Buffering": "no",
    },
  });
}
