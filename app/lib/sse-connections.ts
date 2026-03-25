/**
 * SSE Connection Tracker
 *
 * Tracks active SSE connections per IP and globally to prevent resource
 * exhaustion from connection flooding (H008).
 *
 * Limits:
 * - MAX_PER_IP (10): 5 tabs × 2 SSE routes per user
 * - MAX_GLOBAL (5000): 500 users × 2 SSE routes × 5x headroom
 *
 * Connection lifecycle:
 * 1. acquireConnection(ip) called at SSE route entry -- returns false if capped
 * 2. releaseConnection(ip) called on disconnect (abort signal, stream cancel, timeout)
 * 3. Safety timeout (30 min) auto-releases zombie connections
 *
 * Zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_PER_IP = 10;
const MAX_GLOBAL = 5000;

/** Safety timeout: auto-release connections after 5 minutes to prevent zombies.
 * Reduced from 30 min because Railway's Envoy proxy doesn't reliably forward
 * the abort signal on client disconnect, causing ghost connections to accumulate
 * and block other users with 429s. 5 min is safe because the client heartbeats
 * reconnect within seconds if the connection drops. */
const MAX_CONNECTION_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// State (globalThis singleton survives HMR in dev mode)
// ---------------------------------------------------------------------------

const globalForSSEConn = globalThis as unknown as {
  sseConnState: { connections: Map<string, number>; globalCount: number } | undefined;
};
const state = globalForSSEConn.sseConnState ?? { connections: new Map<string, number>(), globalCount: 0 };
globalForSSEConn.sseConnState = state;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to acquire an SSE connection slot for the given IP.
 *
 * Returns true if the connection is allowed (slot acquired).
 * Returns false if the per-IP or global cap has been reached.
 */
export function acquireConnection(ip: string): boolean {
  if (state.globalCount >= MAX_GLOBAL) return false;
  const ipCount = state.connections.get(ip) ?? 0;
  if (ipCount >= MAX_PER_IP) return false;

  state.connections.set(ip, ipCount + 1);
  state.globalCount++;
  return true;
}

/**
 * Release an SSE connection slot for the given IP.
 *
 * Called when the client disconnects, the stream errors, or the safety
 * timeout fires. Safe to call multiple times (idempotent floor at 0).
 */
export function releaseConnection(ip: string): void {
  const ipCount = state.connections.get(ip) ?? 0;
  if (ipCount <= 1) {
    state.connections.delete(ip);
  } else {
    state.connections.set(ip, ipCount - 1);
  }
  state.globalCount = Math.max(0, state.globalCount - 1);
}

/**
 * Schedule automatic release of a connection after MAX_CONNECTION_MS.
 *
 * Returns a cleanup function that clears the timeout (call this if the
 * connection closes normally before the timeout fires).
 *
 * Why: SSE connections that never properly disconnect (e.g., client crashes
 * without sending FIN) can become zombies. This ensures they're eventually
 * reclaimed.
 */
export function scheduleAutoRelease(ip: string): () => void {
  let released = false;

  const timeout = setTimeout(() => {
    if (!released) {
      released = true;
      releaseConnection(ip);
    }
  }, MAX_CONNECTION_MS);

  // Don't prevent Node.js from exiting
  if (timeout.unref) timeout.unref();

  return () => {
    if (!released) {
      released = true;
      clearTimeout(timeout);
    }
  };
}

// ---------------------------------------------------------------------------
// Diagnostics (not exported to routes, available for debugging)
// ---------------------------------------------------------------------------

/** Current global connection count. Useful for monitoring. */
export function getGlobalCount(): number {
  return state.globalCount;
}

/** Current per-IP connection count. Useful for monitoring. */
export function getIpCount(ip: string): number {
  return state.connections.get(ip) ?? 0;
}

/** Full snapshot of connection state for diagnostics. */
export function getSnapshot(): { globalCount: number; perIp: Record<string, number> } {
  const perIp: Record<string, number> = {};
  for (const [ip, count] of state.connections) {
    perIp[ip] = count;
  }
  return { globalCount: state.globalCount, perIp };
}
