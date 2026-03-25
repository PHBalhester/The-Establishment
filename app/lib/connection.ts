/**
 * RPC Connection Factory (Singleton)
 *
 * Creates a Solana Connection instance with environment-aware routing:
 * - **Browser**: Routes through /api/rpc proxy (keeps Helius API key server-side)
 * - **Server** (API routes, SSR, crank): Uses HELIUS_RPC_URL env var directly
 *
 * The Connection is memoized as a singleton because multiple hooks share it.
 * This prevents creating duplicate WebSocket connections (each Connection opens
 * its own WS channel). The singleton is invalidated if the RPC URL changes.
 *
 * Migration note: NEXT_PUBLIC_RPC_URL is no longer used. All browser RPC calls
 * go through /api/rpc. Server-side code reads HELIUS_RPC_URL env var.
 */

import { Connection } from "@solana/web3.js";

// Singleton cache: separate entries for browser vs server contexts.
// This is critical for WebSocket hooks -- without caching, each hook would
// open its own WS connection, wasting resources and hitting rate limits.
let cachedConnection: Connection | null = null;
let cachedUrl: string | null = null;

/**
 * Resolve the RPC URL based on execution context.
 *
 * Browser: /api/rpc (relative path, works on any domain -- proxied to Helius)
 * Server: HELIUS_RPC_URL env var (required, no cross-cluster fallback)
 */
function resolveRpcUrl(override?: string): string {
  if (override) return override;

  // Browser: all RPC goes through the proxy to protect the API key.
  // Must use full URL — @solana/web3.js Connection rejects relative paths.
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/rpc`;
  }

  // Server: use HELIUS_RPC_URL (preferred) or NEXT_PUBLIC_RPC_URL (fallback).
  // Both are set per-cluster on Railway, so no cross-cluster risk.
  const serverUrl = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
  if (!serverUrl) {
    throw new Error("HELIUS_RPC_URL or NEXT_PUBLIC_RPC_URL env var is required for server-side RPC");
  }
  return serverUrl;
}

/**
 * Get a Solana Connection instance (memoized singleton).
 *
 * @param rpcUrl - Override RPC URL. If omitted, auto-detects browser vs server.
 * @returns A Connection instance with "confirmed" commitment.
 */
export function getConnection(rpcUrl?: string): Connection {
  const url = resolveRpcUrl(rpcUrl);

  // Return cached connection if URL hasn't changed
  if (cachedConnection && cachedUrl === url) {
    return cachedConnection;
  }

  const isBrowser = typeof window !== "undefined";
  const isProxyUrl = url.includes("/api/rpc");

  // WebSocket endpoint configuration:
  // - Proxy URL (/api/rpc): No WebSocket support (HTTP-only), disable WS
  // - Direct Helius URL: Mirror HTTP URL with wss:// for WS subscriptions
  const connectionConfig: ConstructorParameters<typeof Connection>[1] = {
    commitment: "confirmed",
  };

  if (isProxyUrl) {
    // The /api/rpc proxy is HTTP-only. WebSocket subscriptions won't work
    // through it, but the browser uses HTTP polling for all its current needs.
    // If WS is needed in the future, add a separate WS proxy or expose a
    // WS-only Helius endpoint.
    connectionConfig.wsEndpoint = undefined;
  } else if (!isBrowser) {
    // Server-side: enable WebSocket with proper wss:// endpoint
    connectionConfig.wsEndpoint = url.replace("https://", "wss://");
  }

  cachedConnection = new Connection(url, connectionConfig);
  cachedUrl = url;

  return cachedConnection;
}
