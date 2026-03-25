/**
 * k6 SSE Ramp Test — Raw Connection Scaling
 *
 * Progressive ramp from 100 to 1000 VUs, testing SSE connection capacity,
 * event delivery latency, and connection stability under load.
 *
 * Usage:
 *   k6 run scripts/load-test/k6-sse.js
 *   k6 run scripts/load-test/k6-sse.js --env TARGET=http://localhost:3000
 *   k6 run scripts/load-test/k6-sse.js --vus 10 --duration 30s  # quick smoke test
 *
 * Output: stdout summary + optional JSON export via --out json=results.json
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// =============================================================================
// Custom Metrics
// =============================================================================

const sseConnectSuccess = new Rate("sse_connect_success");
const sseEventsReceived = new Counter("sse_events_received");
// Note: k6 buffers SSE responses, so per-event latency can't be measured
// in real time. Use the TypeScript harness (run.ts) for latency metrics.
// k6's built-in http_req_waiting (TTFB) is the meaningful latency metric here.
const sseConnectionDrops = new Counter("sse_connection_drops");
const sseInitialStateReceived = new Rate("sse_initial_state_received");

// =============================================================================
// Configuration
// =============================================================================

const TARGET = __ENV.TARGET || "http://localhost:3000";
const SSE_URL = `${TARGET}/api/sse/protocol`;

// Default: progressive ramp to find the breaking point.
// Override with --vus and --duration for quick smoke tests.
export const options = {
  stages: [
    { duration: "30s", target: 100 },   // Ramp to 100
    { duration: "2m",  target: 100 },   // Hold 100
    { duration: "30s", target: 250 },   // Ramp to 250
    { duration: "2m",  target: 250 },   // Hold 250
    { duration: "30s", target: 500 },   // Ramp to 500
    { duration: "2m",  target: 500 },   // Hold 500
    { duration: "30s", target: 750 },   // Ramp to 750
    { duration: "2m",  target: 750 },   // Hold 750
    { duration: "30s", target: 1000 },  // Ramp to 1000
    { duration: "2m",  target: 1000 },  // Hold 1000
    { duration: "30s", target: 0 },     // Ramp down
  ],
  thresholds: {
    sse_connect_success: ["rate>0.99"],       // 99% connection success at 500 VUs
    sse_initial_state_received: ["rate>0.95"], // 95% get initial state
    http_req_waiting: ["p(95)<1000"],         // TTFB p95 < 1s (k6 built-in)
  },
};

// =============================================================================
// VU Logic
// =============================================================================

/**
 * Each VU opens a streaming HTTP connection to the SSE endpoint and reads
 * events for ~30 seconds before closing and re-connecting (simulates
 * browser tab refresh / reconnect behavior).
 *
 * k6 doesn't have native EventSource, so we use HTTP streaming with
 * manual event parsing. We read the response body as a stream using
 * http.get with a timeout.
 */
export default function () {
  const startTime = Date.now();

  // Open SSE connection as a streaming HTTP request.
  // k6 will hold the connection for `timeout` ms.
  const res = http.get(SSE_URL, {
    timeout: "30s",
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    // Disable redirects for SSE
    redirects: 0,
  });

  // k6 treats SSE streaming connections as "timed out" because they never
  // complete normally. The body IS populated with received SSE data despite
  // the timeout. We check for actual SSE data rather than relying on status.
  const body = res.body || "";
  const hasData = body.includes("event:");

  // Connection success = got HTTP 200 OR got SSE data (timeout with data = success)
  const connected = res.status === 200 || (res.status === 0 && hasData);
  sseConnectSuccess.add(connected ? 1 : 0);

  if (!connected) {
    if (res.status === 429) {
      // Rate limited — back off before retrying
      sleep(5);
    }
    sseConnectionDrops.add(1);
    return;
  }
  const lines = body.split("\n");
  let currentEvent = "";
  let gotInitialState = false;
  let eventCount = 0;

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      eventCount++;
      sseEventsReceived.add(1);

      if (currentEvent === "initial-state") {
        gotInitialState = true;
      }
    } else if (line.startsWith(": heartbeat")) {
      // Heartbeat received — connection is alive, don't count as event
    }
  }

  sseInitialStateReceived.add(gotInitialState ? 1 : 0);

  if (eventCount === 0) {
    sseConnectionDrops.add(1);
  }

  // Brief pause before reconnecting (simulates user behavior)
  sleep(1);
}

// =============================================================================
// Lifecycle Hooks
// =============================================================================

export function handleSummary(data) {
  // Print a human-readable summary
  console.log("\n=== SSE Load Test Results ===");
  console.log(`Target: ${SSE_URL}`);
  console.log(`Max VUs reached: ${data.metrics.vus_max ? data.metrics.vus_max.values.max : "unknown"}`);
  console.log(`Total events received: ${data.metrics.sse_events_received ? data.metrics.sse_events_received.values.count : 0}`);
  console.log(`Connection success rate: ${data.metrics.sse_connect_success ? (data.metrics.sse_connect_success.values.rate * 100).toFixed(1) : 0}%`);
  console.log(`Connection drops: ${data.metrics.sse_connection_drops ? data.metrics.sse_connection_drops.values.count : 0}`);

  if (data.metrics.http_req_waiting) {
    const ttfb = data.metrics.http_req_waiting.values;
    console.log(`TTFB (initial response) p50: ${ttfb["p(50)"] ? ttfb["p(50)"].toFixed(0) : "N/A"}ms`);
    console.log(`TTFB (initial response) p95: ${ttfb["p(95)"] ? ttfb["p(95)"].toFixed(0) : "N/A"}ms`);
    console.log(`TTFB (initial response) p99: ${ttfb["p(99)"] ? ttfb["p(99)"].toFixed(0) : "N/A"}ms`);
  }

  // Return default stdout + optional JSON
  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

// k6 built-in text summary
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.3/index.js";
