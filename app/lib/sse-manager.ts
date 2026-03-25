/**
 * SSE Manager -- In-Memory Pub/Sub for Server-Sent Events
 *
 * Provides a singleton publish/subscribe mechanism for broadcasting candle
 * updates (and other events) from the webhook handler to connected SSE clients.
 *
 * Why in-memory:
 * Railway runs a single Next.js process for devnet (no horizontal scaling).
 * An in-memory Set of subscriber callbacks is sufficient. If we ever need
 * multi-process broadcasting, we'd add Redis pub/sub -- but that's overkill
 * for a single-process devnet deployment.
 *
 * The globalThis singleton pattern survives Next.js hot reloads in development.
 * Without this, each HMR cycle would create a new SSEManager, orphaning
 * existing subscribers. Same pattern used in app/db/connection.ts.
 */

import { bigintReplacer } from "@/lib/bigint-json";

// =============================================================================
// Types
// =============================================================================

/** Callback function that receives raw SSE-formatted strings. */
export type SSECallback = (data: string) => void;

// =============================================================================
// SSE Manager Class
// =============================================================================

export class SSEManager {
  private subscribers = new Set<SSECallback>();

  /**
   * Subscribe to SSE events.
   *
   * @param callback - Function called with raw SSE payload strings
   * @returns Unsubscribe function -- call to remove the subscriber
   */
  subscribe(callback: SSECallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Broadcast an event to all connected subscribers.
   *
   * Formats the data as an SSE payload string:
   *   event: <eventName>\n
   *   data: <JSON>\n\n
   *
   * If a subscriber throws (client disconnected), it's silently removed
   * from the subscriber set.
   *
   * @param event - SSE event name (e.g., "candle-update")
   * @param data - Event payload (will be JSON-stringified)
   */
  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data, bigintReplacer)}\n\n`;
    for (const callback of this.subscribers) {
      try {
        callback(payload);
      } catch {
        // Subscriber disconnected or errored -- remove it
        this.subscribers.delete(callback);
      }
    }
  }

  /** Number of currently connected subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

// =============================================================================
// Singleton Instance
//
// globalThis cache survives Next.js hot reloads in dev mode.
// In production, there's only one module load, so globalThis isn't strictly
// needed -- but it's harmless and makes dev behavior correct.
// =============================================================================

const globalForSSE = globalThis as unknown as {
  sseManager: SSEManager | undefined;
};

export const sseManager = globalForSSE.sseManager ?? new SSEManager();

globalForSSE.sseManager = sseManager;
