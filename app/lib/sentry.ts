/**
 * Zero-dependency Sentry error reporter.
 *
 * @sentry/nextjs and @sentry/browser both conflict with Turbopack's
 * SSR runtime (monkey-patching webpack internals or getting bundled
 * into server code that lacks browser globals). This module uses raw
 * fetch() to POST error envelopes directly to Sentry's ingest API.
 *
 * Works in both browser and Node.js (fetch is available in both).
 * No build-time side effects, no module-level browser API references.
 *
 * Features:
 * - Runtime detection (browser vs node) via tags
 * - Release tracking from RAILWAY_GIT_COMMIT_SHA or NEXT_PUBLIC_COMMIT_SHA
 * - Cluster tagging from NEXT_PUBLIC_CLUSTER
 * - Breadcrumb support (last 20 entries included in error envelopes)
 * - US-region DSN support (o123.ingest.us.sentry.io)
 */

// ---------------------------------------------------------------------------
// Breadcrumbs -- module-level ring buffer (last 20)
// ---------------------------------------------------------------------------

interface Breadcrumb {
  timestamp: string;
  message: string;
  category: string;
}

const MAX_BREADCRUMBS = 20;
const breadcrumbs: Breadcrumb[] = [];

/**
 * Add a breadcrumb that will be included in the next error envelope.
 * Useful for tracing user actions leading up to an error.
 *
 * @param message - Human-readable description of the action
 * @param category - Category tag (e.g. "navigation", "rpc", "wallet")
 */
export function addBreadcrumb(message: string, category = "default") {
  breadcrumbs.push({
    timestamp: new Date().toISOString(),
    message,
    category,
  });
  // Keep only the most recent MAX_BREADCRUMBS
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

// ---------------------------------------------------------------------------
// Runtime Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether we're running in a browser or Node.js server environment.
 */
function detectRuntime(): "browser" | "node" {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }
  return "node";
}

/**
 * Get the server name for distinguishing error sources.
 * Browser returns the page hostname; server returns the OS hostname or fallback.
 */
function getServerName(): string {
  const runtime = detectRuntime();
  if (runtime === "browser") {
    try {
      return window.location.hostname;
    } catch {
      return "browser";
    }
  }
  // Node.js -- try os.hostname() equivalent via process
  try {
    // Next.js server environment
    return typeof process !== "undefined" && process.env.HOSTNAME
      ? process.env.HOSTNAME
      : "next-server";
  } catch {
    return "next-server";
  }
}

/**
 * Get the release identifier from environment variables.
 * Railway provides RAILWAY_GIT_COMMIT_SHA automatically.
 */
function getRelease(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return (
    process.env.NEXT_PUBLIC_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    undefined
  );
}

/**
 * Get the cluster identifier (devnet/mainnet-beta) from env.
 */
function getCluster(): string {
  if (typeof process === "undefined") return "unknown";
  return process.env.NEXT_PUBLIC_CLUSTER ?? "unknown";
}

// ---------------------------------------------------------------------------
// DSN Parser
// ---------------------------------------------------------------------------

// Parse DSN: https://<key>@<host>/<project_id>
// Handles US region format: https://<key>@o123.ingest.us.sentry.io/<project_id>
function parseDsn(dsn: string) {
  const url = new URL(dsn);
  const key = url.username;
  const projectId = url.pathname.replace("/", "");
  const host = url.hostname;
  return { key, projectId, host };
}

// ---------------------------------------------------------------------------
// Error Capture
// ---------------------------------------------------------------------------

/**
 * Send an error to Sentry via the envelope API.
 * Silently no-ops if DSN is not configured.
 *
 * Enriches each event with:
 * - server_name: hostname or "next-server"
 * - release: git commit SHA (from Railway or NEXT_PUBLIC_COMMIT_SHA)
 * - tags: { runtime, cluster }
 * - breadcrumbs: last 20 recorded breadcrumbs
 */
export function captureException(error: unknown, dsn?: string) {
  const sentryDsn =
    dsn ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN
      : undefined);

  if (!sentryDsn) return;

  try {
    const { key, projectId, host } = parseDsn(sentryDsn);
    const eventId = crypto.randomUUID().replace(/-/g, "");

    const errorObj =
      error instanceof Error
        ? error
        : new Error(typeof error === "string" ? error : JSON.stringify(error));

    const runtime = detectRuntime();
    const release = getRelease();

    const event: Record<string, unknown> = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "error",
      server_name: getServerName(),
      environment:
        typeof process !== "undefined"
          ? process.env.NODE_ENV ?? "production"
          : "production",
      tags: {
        runtime,
        cluster: getCluster(),
      },
      exception: {
        values: [
          {
            type: errorObj.name,
            value: errorObj.message,
            stacktrace: errorObj.stack
              ? {
                  frames: errorObj.stack
                    .split("\n")
                    .slice(1, 20)
                    .map((line: string) => ({ filename: line.trim() })),
                }
              : undefined,
          },
        ],
      },
      breadcrumbs: {
        values: breadcrumbs.map((b) => ({
          timestamp: b.timestamp,
          message: b.message,
          category: b.category,
          level: "info",
        })),
      },
    };

    // Only include release if available (avoids null tag in Sentry)
    if (release) {
      event.release = release;
    }

    // Sentry envelope format: header\nitem_header\npayload
    const eventJson = JSON.stringify(event);
    const envelope = [
      JSON.stringify({
        event_id: eventId,
        dsn: sentryDsn,
        sent_at: new Date().toISOString(),
      }),
      JSON.stringify({ type: "event", length: eventJson.length }),
      eventJson,
    ].join("\n");

    // The ingest URL uses the full hostname from the DSN.
    // This correctly handles US region (o123.ingest.us.sentry.io)
    // and EU region (o123.ingest.de.sentry.io) formats because
    // parseDsn extracts the complete hostname via url.hostname.
    const ingestUrl = `https://${host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`;

    // Fire-and-forget. Don't await -- error reporting should never
    // block the application or throw its own errors.
    fetch(ingestUrl, {
      method: "POST",
      body: envelope,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {
      // Silently swallow fetch errors (network down, etc.)
    });
  } catch {
    // Silently swallow any parsing/serialization errors.
  }
}
