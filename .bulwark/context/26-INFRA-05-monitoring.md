---
task_id: db-phase1-infra-05-monitoring
provides: [infra-05-monitoring-findings, infra-05-monitoring-invariants]
focus_area: infra-05-monitoring
files_analyzed: [app/app/api/health/route.ts, app/lib/credit-counter.ts, app/lib/sentry.ts, app/instrumentation.ts, app/lib/ws-subscriber.ts, app/lib/sse-manager.ts, app/lib/sse-connections.ts, app/lib/protocol-store.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/app/api/rpc/route.ts, app/app/api/webhooks/helius/route.ts, app/next.config.ts, app/middleware.ts, app/lib/rate-limit.ts, app/lib/connection.ts, app/db/connection.ts, app/instrumentation-client.ts, app/app/global-error.tsx, app/app/launch/page.tsx, scripts/crank/crank-runner.ts, scripts/load-test/run.ts, scripts/load-test/k6-sse.js, railway.toml, .github/workflows/ci.yml]
finding_count: 12
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 5, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# INFRA-05: Monitoring, Metrics & Observability Exposure -- Condensed Summary

## Key Findings (Top 10)
- **Health endpoint exposes operational internals to the public internet**: wsSubscriber state, credit counter stats, dependency health, and timestamps exposed unauthenticated -- `app/app/api/health/route.ts:66-72`
- **Crank health endpoint exposes spending data on 0.0.0.0**: hourlySpendLamports, consecutiveErrors, uptime, maxHourlySpendLamports visible to anyone who can reach the port -- `scripts/crank/crank-runner.ts:163-177`
- **Credit counter exposes per-method RPC call breakdown via /api/health**: methodCounts dictionary reveals which RPC methods are used and at what frequency, aiding reconnaissance -- `app/lib/credit-counter.ts:41-46` via `app/app/api/health/route.ts:64`
- **Debug console.log left in production launch page**: Diagnostic logging of curve state (deadlineSlot, status, startSlot) persists in production build -- `app/app/launch/page.tsx:99-107`
- **No structured logging framework**: All observability uses raw console.log/warn/error. No log levels, no structured JSON, no correlation IDs. Makes incident response harder and risks logging sensitive data in unstructured output -- across all files
- **Sentry error reporter sends full stack traces including file paths**: Stack frames include absolute file paths that reveal server directory structure -- `app/lib/sentry.ts:181-184`
- **No alerting on observability data**: Credit counter tracks RPC usage but has no threshold alerting. Staleness monitor logs but does not trigger external alerts -- `app/lib/ws-subscriber.ts:299-323`, `app/lib/credit-counter.ts`
- **Error messages in webhook route expose internal state**: Decode failures log raw account data and error messages; on failure, raw account data is stored in protocolStore and broadcast via SSE -- `app/app/api/webhooks/helius/route.ts:608-619`
- **SSE connection count not exposed to monitoring**: No way to observe current SSE connection count or per-IP distribution from outside the process -- `app/lib/sse-connections.ts:110-118`
- **Railway healthcheck configured but only checks liveness, not readiness**: `railway.toml:8` uses /api/health which always returns 200. Degraded state (DB down, RPC down) still serves traffic -- `railway.toml:8`, `app/app/api/health/route.ts:61`

## Critical Mechanisms
- **Health endpoint (`/api/health`)**: Unauthenticated GET returning JSON with postgres/solanaRpc booleans, wsSubscriber state (initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive), credit counter stats (totalCalls, methodCounts, startedAt), and ISO timestamp. Always returns HTTP 200 regardless of dependency state. Railway uses this for container liveness checks. -- `app/app/api/health/route.ts:32-73`
- **Sentry error reporting (zero-dep)**: Custom fetch-based reporter that posts error envelopes to Sentry's ingest API. Tags include runtime (browser/node), cluster (devnet/mainnet), hostname, and git commit SHA. Stack traces are parsed and included. Breadcrumb ring buffer (20 entries) included. Fire-and-forget with silent error swallowing. -- `app/lib/sentry.ts:1-235`
- **Credit counter**: In-memory singleton tracking total RPC calls and per-method breakdown. Exposed via /api/health. No persistence, no threshold alerts, no rate limiting on the counter itself. Resets on process restart. -- `app/lib/credit-counter.ts:1-69`
- **WS subscriber staleness monitor**: Checks every 10s if WS slot data is >15s stale. Logs warning and activates HTTP fallback poll. No external alerting mechanism. -- `app/lib/ws-subscriber.ts:299-323`
- **Crank health server**: Minimal HTTP server on port 8080 (configurable via HEALTH_PORT). Exposes JSON with operational state including spending data and circuit breaker status. Bound to 0.0.0.0 but documented as "no public domain assigned". -- `scripts/crank/crank-runner.ts:152-190`

## Invariants & Assumptions
- INVARIANT: Health endpoint always returns HTTP 200 -- enforced at `app/app/api/health/route.ts:66` (by design, for Railway liveness)
- INVARIANT: Credit counter is in-memory only, resets on restart -- enforced at `app/lib/credit-counter.ts:30-31` (no persistence layer)
- INVARIANT: Sentry DSN required for error reporting to function -- enforced at `app/lib/sentry.ts:146` (no-op if missing)
- INVARIANT: SSE connection limits are per-process only -- enforced at `app/lib/sse-connections.ts:33-37` (globalThis singleton, not distributed)
- ASSUMPTION: Railway does not expose the crank service's port 8080 to the public internet -- UNVALIDATED (depends on Railway network config)
- ASSUMPTION: Console output (stdout/stderr) is captured by Railway and not publicly accessible -- validated (Railway logs are dashboard-only, not public)
- ASSUMPTION: No Prometheus/Grafana/OpenTelemetry/Datadog integration exists -- validated (no metrics libraries detected in codebase)
- ASSUMPTION: /api/health is not behind any authentication middleware -- validated at `app/app/api/health/route.ts` (no auth checks)

## Risk Observations (Prioritized)
1. **Health endpoint information disclosure (H028 regression candidate)**: `/api/health` returns wsSubscriber internal state, credit counter per-method breakdown, and dependency status to any unauthenticated caller. An attacker can determine: whether WS subscriber is active, the latest Solana slot the server knows about, whether the server is in fallback mode, total RPC credit consumption, which RPC methods are being called and at what frequency, and whether Postgres/RPC are down. This is reconnaissance gold for targeted attacks. -- `app/app/api/health/route.ts:63-72`

2. **Decode failure leaks raw account data to SSE clients**: When Anchor decode fails for an enhanced webhook account change, the raw account data AND error message are stored in protocolStore and broadcast to all SSE clients. This could leak unintended data. -- `app/app/api/webhooks/helius/route.ts:608-619`

3. **Debug logging in production**: `console.log('[LaunchPage]', {...})` in `app/app/launch/page.tsx:99-107` outputs curve state to browser console. While not sensitive, it indicates incomplete cleanup of debug instrumentation.

4. **No observability pipeline for production**: The codebase has zero structured observability. No log levels (everything is console.*), no metrics collection, no distributed tracing, no alerting thresholds. The credit counter and health endpoint are ad-hoc solutions. For a DeFi protocol handling real funds, this increases incident response time.

5. **Crank health endpoint binds 0.0.0.0**: The crank's /health endpoint binds to all interfaces. If Railway ever routes traffic to this port (misconfiguration, new service discovery), operational data is exposed. -- `scripts/crank/crank-runner.ts:185`

## Novel Attack Surface
- **Health endpoint as oracle for DoS timing**: An attacker can poll `/api/health` to monitor `wsSubscriber.wsConnected` and `wsSubscriber.fallbackActive`. When the WS subscriber enters fallback mode (stale), the attacker knows the server is degraded and can time additional pressure (SSE flood, RPC proxy abuse) to maximize impact during the vulnerability window.
- **Credit counter as RPC budget exhaustion indicator**: By polling `/api/health` and watching `credits.totalCalls` growth rate, an attacker can estimate Helius credit consumption rate and potentially determine when the project is approaching credit limits, timing abuse for maximum impact.

## Cross-Focus Handoffs
- --> **ERR-01 (Error Handling)**: The staleness monitor in ws-subscriber.ts logs warnings but has no external alerting. If WS dies silently and fallback also fails, the protocol store goes stale with no notification to operators.
- --> **SEC-02 (Secrets)**: The Sentry DSN is exposed via NEXT_PUBLIC_SENTRY_DSN (client-side env var). While DSNs are designed to be semi-public, an attacker can send fake error reports to pollute the Sentry project. Check if DSN has write-only scope.
- --> **API-01 (RPC Client)**: Credit counter data exposed via /api/health reveals RPC usage patterns. The rate-limit module has per-endpoint profiles but no monitoring integration.
- --> **DATA-04 (Logging)**: Raw account data stored in protocolStore on decode failure (webhook route:613-619) could contain unexpected data that gets broadcast to all SSE clients.

## Trust Boundaries
The monitoring/observability surface has one primary trust boundary: the `/api/health` endpoint sits on the public-facing Next.js server with zero authentication. Railway uses it for liveness checks (which requires it to be reachable), but it also exposes operational intelligence to any internet client. The crank health endpoint has a secondary boundary -- it binds to 0.0.0.0 but relies on Railway's network isolation to prevent public access. The Sentry reporter trusts the DSN (which is public) and transmits error details including stack traces and breadcrumbs to an external service. Console logging trusts Railway's log pipeline to not be publicly accessible.
<!-- CONDENSED_SUMMARY_END -->

---

# INFRA-05: Monitoring, Metrics & Observability Exposure -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol has minimal formal observability infrastructure. There is no Prometheus, Grafana, OpenTelemetry, Datadog, or any dedicated metrics collection system. Monitoring is handled through three ad-hoc mechanisms: (1) a public health endpoint at `/api/health` that exposes extensive operational state, (2) a zero-dependency Sentry error reporter that captures unhandled exceptions, and (3) a credit counter singleton that tracks Helius RPC call counts. The crank process adds a fourth: a standalone HTTP health server on port 8080.

The primary concern is information disclosure through the unauthenticated health endpoint. While the design decision to always return HTTP 200 is sound for Railway liveness checks, the response body contains operational intelligence that aids targeted attacks. The absence of structured logging, metric thresholds, and alerting creates blind spots for incident response in a system managing real financial operations.

No critical vulnerabilities were found -- there are no Prometheus instances, pprof endpoints, or debug ports exposed. The risk profile is dominated by information disclosure and operational visibility gaps.

## Scope

### Files Analyzed (Full Read -- Layer 3)
1. `app/app/api/health/route.ts` (74 LOC) -- Health check endpoint
2. `app/lib/credit-counter.ts` (69 LOC) -- RPC call tracking
3. `app/lib/sentry.ts` (236 LOC) -- Zero-dep error reporter
4. `app/instrumentation.ts` (30 LOC) -- Server boot hook
5. `app/lib/ws-subscriber.ts` (496 LOC) -- WS data pipeline with staleness monitor
6. `app/lib/sse-manager.ts` (93 LOC) -- SSE pub/sub
7. `app/lib/sse-connections.ts` (119 LOC) -- Connection tracking
8. `app/lib/protocol-store.ts` (126 LOC) -- In-memory state cache
9. `app/app/api/sse/protocol/route.ts` (137 LOC) -- SSE protocol stream
10. `app/app/api/sse/candles/route.ts` (125 LOC) -- SSE candle stream
11. `app/app/api/rpc/route.ts` (189 LOC) -- RPC proxy with method logging
12. `app/app/api/webhooks/helius/route.ts` (partial -- logging sections)
13. `app/next.config.ts` (123 LOC) -- CSP and security headers
14. `app/middleware.ts` (48 LOC) -- Site mode toggle
15. `app/lib/rate-limit.ts` (182 LOC) -- Rate limiter with IP extraction
16. `app/lib/connection.ts` (88 LOC) -- RPC connection factory
17. `app/db/connection.ts` (103 LOC) -- Database connection
18. `app/instrumentation-client.ts` (45 LOC) -- Client-side error handlers
19. `app/app/global-error.tsx` (63 LOC) -- React error boundary
20. `scripts/crank/crank-runner.ts` (partial -- health endpoint, logging)
21. `scripts/load-test/run.ts` (617 LOC) -- Protocol-aware load test
22. `scripts/load-test/k6-sse.js` (165 LOC) -- k6 SSE load test
23. `railway.toml` (12 LOC) -- Railway deployment config
24. `.github/workflows/ci.yml` (306 LOC) -- CI pipeline

### Files Analyzed (Signature Scan -- Layer 2)
- `app/app/launch/page.tsx` -- Debug console.log found
- `app/components/launch/CountdownTimer.tsx` -- Debug comment found
- `app/lib/rate-limit.ts` -- Logging of missing proxy headers
- `app/providers/SettingsProvider.tsx` -- Console.warn reference
- `app/hooks/useSwap.ts` -- Error logging patterns
- `app/hooks/useStaking.ts` -- Error logging patterns

## Key Mechanisms

### 1. Health Endpoint (`/api/health`)

**Location:** `app/app/api/health/route.ts`

The health endpoint serves two purposes documented in its header comment:
1. Container liveness (HTTP status) -- Railway checks if the server process is alive
2. Dependency health (response body) -- Monitoring reads the body for degraded state

**Response structure:**
```json
{
  "status": "ok" | "degraded",
  "checks": { "postgres": true/false, "solanaRpc": true/false },
  "wsSubscriber": {
    "initialized": true/false,
    "wsConnected": true/false,
    "latestSlot": 12345,
    "lastSlotReceivedAt": 1711036800000,
    "fallbackActive": true/false
  },
  "credits": {
    "totalCalls": 1234,
    "methodCounts": { "getAccountInfo": 100, "getTokenSupply": 50, ... },
    "startedAt": "2026-03-21T..."
  },
  "timestamp": "2026-03-21T..."
}
```

**Observations:**
- Always returns HTTP 200 (intentional -- Railway liveness check)
- No authentication required
- `wsSubscriber` section reveals internal state including slot numbers and timing
- `credits.methodCounts` reveals exact RPC method usage patterns
- `checks` reveals whether Postgres and Solana RPC are currently reachable
- RPC check tries cached slot first to save 1 credit (line 47-54), good practice
- On failure, errors are logged to console AND reported to Sentry

**H028 cross-reference (Audit #1 finding):** H028 flagged "Health Info Disclosure" as NOT_FIXED. This delta has EXPANDED the information exposure by adding `wsSubscriber` and `credits` fields. The finding has regressed.

### 2. Credit Counter

**Location:** `app/lib/credit-counter.ts`

Simple in-memory counter tracking RPC method calls. globalThis singleton pattern for HMR survival.

**Interface:**
- `recordCall(method: string)` -- Increment total + per-method counter
- `getStats()` -- Return snapshot (totalCalls, methodCounts map, startedAt timestamp)
- `resetStats()` -- Zero all counters (test utility only)

**Callers:**
- `app/lib/ws-subscriber.ts` -- Records getMultipleAccountsInfo, getTokenSupply, getSlot, getProgramAccounts
- `app/app/api/rpc/route.ts` -- Records per-method after successful upstream response (line 163-164)

**Observations:**
- No threshold alerting -- counter only increments, never triggers warnings
- No persistence -- resets on process restart
- Unbounded `methodCounts` map grows with each unique method name. Not exploitable because ALLOWED_METHODS in rpc/route.ts limits what the proxy accepts, and ws-subscriber only calls fixed methods. But if the proxy allowlist expands, this becomes a memory concern.
- methodCounts exposed via health endpoint reveals exact RPC usage fingerprint

### 3. Sentry Error Reporter

**Location:** `app/lib/sentry.ts`

Zero-dependency implementation that POSTs error envelopes directly to Sentry's ingest API.

**Error data sent to Sentry:**
- event_id (random UUID)
- timestamp
- server_name (HOSTNAME env var, or "next-server", or window.location.hostname)
- environment (NODE_ENV)
- tags: runtime (browser/node), cluster (NEXT_PUBLIC_CLUSTER)
- release (RAILWAY_GIT_COMMIT_SHA or NEXT_PUBLIC_COMMIT_SHA)
- exception: error name, message, stack trace (first 20 frames, trimmed)
- breadcrumbs: last 20 entries (timestamp, message, category)

**Stack trace handling (line 181-184):**
```typescript
frames: errorObj.stack
  .split("\n")
  .slice(1, 20)
  .map((line: string) => ({ filename: line.trim() })),
```
Raw stack frames include file paths like `at Module._compile (internal/modules/...)` or `at /app/.next/server/chunks/...`. These reveal:
- Server directory structure
- Next.js build output paths
- Module names and internal Node.js paths

**Sentry DSN exposure:**
- Server-side: `SENTRY_DSN` env var (server-only, good)
- Client-side: `NEXT_PUBLIC_SENTRY_DSN` (necessarily public for browser reporting)
- DSN contains project ID and public key -- anyone can send error reports to the project

**Client-side integration (instrumentation-client.ts):**
- Registers window.onerror and window.onunhandledrejection handlers
- Gates on NEXT_PUBLIC_SENTRY_DSN presence
- Also in global-error.tsx as React error boundary

**Observations:**
- Fire-and-forget pattern is correct -- error reporting never blocks the app
- Silent error swallowing (catch blocks with no action) prevents reporting loops
- Breadcrumb ring buffer (max 20) is reasonable
- No PII in breadcrumbs (used for navigation/rpc/wallet tracing)
- DSN parsing handles US and EU region formats correctly
- No rate limiting on error reports -- a crash loop could flood Sentry

### 4. WS Subscriber Staleness Monitor

**Location:** `app/lib/ws-subscriber.ts:299-323`

Checks every 10s if slot data is >15s stale. When stale:
- Sets `state.wsConnected = false`
- Starts HTTP fallback poll (getSlot every 5s)
- Logs warning to console

When recovered:
- Stops fallback poll
- Logs recovery to console

**Observations:**
- Detection threshold (15s) is reasonable for Solana (~400ms slot time)
- No external alerting -- only console output
- No escalation path if fallback also fails
- The monitor runs in the same process -- if the process hangs, the monitor hangs too

### 5. Crank Health Server

**Location:** `scripts/crank/crank-runner.ts:152-190`

Standalone HTTP server on configurable port (default 8080).

**Response structure:**
```json
{
  "status": "halted" | "running",
  "consecutiveErrors": 0,
  "circuitBreakerThreshold": 5,
  "hourlySpendLamports": 50000,
  "maxHourlySpendLamports": 500000000,
  "uptime": 3600,
  "lastSuccessAt": "2026-03-21T..."
}
```

**Observations:**
- Binds to `0.0.0.0:8080` (line 185) -- all interfaces
- Documented as "no public domain assigned" but this relies on Railway's network isolation
- Exposes spending cap headroom (hourlySpendLamports / maxHourlySpendLamports) -- reveals operational budget
- Returns 404 for non-/health paths (line 179-181) -- no other endpoints
- No authentication
- uptime reveals process start time

### 6. Logging Patterns

The codebase uses raw `console.*` throughout with no structured logging:

**Console.error patterns (server-side):**
- `[health] Postgres check failed:` + error object
- `[health] Solana RPC check failed:` + error object
- `[ws-subscriber] Failed to decode <type> at <pubkey>:` + error
- `[ws-subscriber] Slot fallback poll error:` + error
- `[ws-subscriber] Supply poll error:` + error
- `[ws-subscriber] Staker poll error:` + error
- `[webhook] Fatal error:` + error
- `[webhook] Failed to decode <label> at <pubkey>:` + error
- `[rpc-proxy] All RPC endpoints failed:` + error
- `[instrumentation] ws-subscriber init failed:` + error

**Console.warn patterns:**
- `[ws-subscriber] Slot subscription stale (<elapsed>ms).`
- `[webhook] Skipping stale transaction (blockTime <bt>, age <age>s): <signature>`
- `[webhook] Unknown pool type: <type> in tx <signature>`
- `[webhook] Received account change for unknown account: <pubkey>`
- `[rpc-proxy] Blocked disallowed RPC method: <method>`
- `[rpc-proxy] Upstream 5xx from <hostname>`
- `[rpc-proxy] Network error from <hostname>`
- `[rate-limit] WARNING: No proxy headers detected.`
- `[db] WARNING: Non-production DB connection to remote host without TLS.`

**Console.log patterns (info-level):**
- `[ws-subscriber] Batch seed complete: <count> accounts, slot <slot>, <stakers> stakers`
- `[ws-subscriber] Slot subscription started (broadcast every <interval>ms)`
- `[ws-subscriber] Supply poll started (every <interval>ms)`
- `[ws-subscriber] Staker poll started (every <interval>ms)`
- `[ws-subscriber] Initialized successfully`
- `[ws-subscriber] Disabled via WS_SUBSCRIBER_ENABLED`
- `[ws-subscriber] Already initialized, skipping`
- `[ws-subscriber] Slot subscription recovered.`
- `[LaunchPage] {crimeDeadline, fraudDeadline, crimeStatus, fraudStatus, ...}` (DEBUG -- should be removed)

**Assessment:**
- All log messages use `[prefix]` tags which is helpful but inconsistent with any log level standard
- No structured JSON logging -- makes log aggregation and querying difficult
- Error objects are logged raw (may contain stack traces with file paths in Railway logs)
- RPC proxy correctly masks endpoint URLs via `maskEndpoint()` (shows only hostname, hides API key)
- Database connection correctly warns about non-TLS remote connections
- Debug console.log in launch page should be removed before mainnet

### 7. Railway Configuration

**Location:** `railway.toml`

```toml
healthcheckPath = "/api/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

- Health check uses the same endpoint that exposes operational data
- 120s timeout is generous but reasonable for cold start
- ON_FAILURE with max 3 retries prevents infinite restart loops
- No readiness probe differentiation -- Railway can only check liveness via this single endpoint

### 8. CI Pipeline Logging

**Location:** `.github/workflows/ci.yml`

The CI pipeline is well-structured and does not exhibit common AI-generated pitfalls:
- No `${{ github.event.* }}` in `run:` blocks (AIP-107 safe)
- No explicit `permissions:` block -- uses default (read for pull_request, write for push on main). Since this only runs on push to main (trusted context), the default permissions are acceptable.
- No secrets echoed or `set -x` used (AIP-114 safe)
- Solana CLI keypair generated fresh (`solana-keygen new --no-bip39-passphrase --silent`) -- no real keys
- TS test job uses committed devnet wallet (non-sensitive, devnet-only)

## Trust Model

### Trust Boundaries for Observability

1. **Public --> Health endpoint**: Zero authentication. Anyone on the internet can read operational state. Trust assumption: Railway's healthcheck requires this to be public; the response body should contain minimal information.

2. **Server --> Sentry**: Error envelopes with stack traces and breadcrumbs sent to external Sentry service. Trust assumption: Sentry project is write-only (DSN scope), not readable by attackers even if they discover the DSN.

3. **Server --> Railway logs (stdout)**: All console.* output captured by Railway. Trust assumption: Railway logs are only accessible via authenticated dashboard.

4. **Crank --> Railway network**: Health endpoint on 0.0.0.0:8080. Trust assumption: Railway does not route public traffic to this port.

5. **Browser --> Sentry**: Client-side error reporting via NEXT_PUBLIC_SENTRY_DSN. Trust assumption: DSN is public by design; attackers can send fake errors but cannot read existing ones.

## State Analysis

### In-Memory State Exposed via Health Endpoint

| Data | Source | Sensitivity |
|------|--------|-------------|
| `checks.postgres` (bool) | Live DB query | LOW -- reveals if DB is up |
| `checks.solanaRpc` (bool) | Cached slot or live RPC | LOW -- reveals if RPC is up |
| `wsSubscriber.initialized` (bool) | globalThis state | LOW -- reveals feature state |
| `wsSubscriber.wsConnected` (bool) | WS subscription state | MEDIUM -- reveals degradation |
| `wsSubscriber.latestSlot` (number) | Solana slot | LOW -- public blockchain data |
| `wsSubscriber.lastSlotReceivedAt` (timestamp) | Internal timing | MEDIUM -- reveals data freshness |
| `wsSubscriber.fallbackActive` (bool) | Staleness monitor | MEDIUM -- reveals degradation |
| `credits.totalCalls` (number) | Counter | LOW -- aggregate count |
| `credits.methodCounts` (map) | Counter | MEDIUM -- reveals RPC usage patterns |
| `credits.startedAt` (timestamp) | Counter init time | LOW -- reveals process start time |
| `timestamp` (ISO string) | Server clock | INFORMATIONAL |

### In-Memory State NOT Exposed

| Data | Source | Why Not Exposed |
|------|--------|-----------------|
| SSE connection count | sse-connections.ts | Only exported via getGlobalCount/getIpCount, not wired to health |
| Protocol store contents | protocol-store.ts | Only via SSE stream (requires connection) |
| Rate limit entries | rate-limit.ts | Internal Map, no diagnostic export |
| Spending log (crank) | crank-runner.ts | Only via crank health endpoint, separate process |

## Dependencies

### External Services for Observability

| Service | Purpose | Authentication |
|---------|---------|----------------|
| Sentry | Error reporting | DSN (public key + project ID) |
| Railway | Log aggregation (stdout capture) | Dashboard auth (not app-controlled) |
| Helius | RPC credit tracking (indirect) | API key in HELIUS_RPC_URL |

### No Dedicated Observability Dependencies
- No prom-client / Prometheus
- No @opentelemetry/*
- No Datadog agent
- No Grafana
- No structured logging library (winston, pino, bunyan)

## Focus-Specific Analysis

### OC-228: Unauthenticated Metrics Endpoint

**Verdict: PARTIALLY PRESENT**

There is no `/metrics` (Prometheus) endpoint. However, `/api/health` functions as an unauthenticated observability endpoint that exposes operational data including RPC call counts per method, WebSocket subscriber state, and dependency health. This is the OC-228 pattern adapted to the project's custom observability approach.

**Specific data exposed:**
- `credits.methodCounts`: Reveals which RPC methods the server calls and at what frequency. An attacker can fingerprint the protocol's on-chain interaction patterns.
- `wsSubscriber.fallbackActive`: Reveals when the WS connection is degraded. Combined with `lastSlotReceivedAt`, reveals exact timing of degradation.
- `checks.postgres` / `checks.solanaRpc`: Reveals which dependencies are currently down.

**Impact:** MEDIUM -- Information aids targeted attacks (DoS timing, RPC abuse).

**Mitigation options:**
1. Split health into minimal liveness (200 OK only, for Railway) and detailed diagnostics (behind bearer token)
2. Remove `credits.methodCounts` from public response (keep totalCalls if needed)
3. Remove `wsSubscriber.lastSlotReceivedAt` and `wsSubscriber.fallbackActive` from public response

### OC-229: Sensitive Data in Metric Labels

**Verdict: NOT PRESENT**

No Prometheus metrics or structured metric labels exist. The credit counter tracks RPC methods (generic, non-sensitive) not user identifiers or wallet addresses. No PII or financial data appears in any metric-like structure.

The closest concern is the webhook route logging transaction signatures:
```
[webhook] Skipping stale transaction (blockTime <bt>, age <age>s): <signature>
```
Transaction signatures are public blockchain data, not sensitive. No wallet addresses or amounts are logged.

### OC-230: pprof/Debug Endpoint

**Verdict: NOT PRESENT**

No pprof, debug ports, or profiling endpoints detected. No `--inspect` flags. No Node.js debugger exposure. The codebase does not use Go (where pprof is the primary risk).

The only debug concern is the `console.log('[LaunchPage]', {...})` in `app/app/launch/page.tsx:99-107`, which is a client-side debug statement that outputs to the browser console, not a debug endpoint.

### OC-221: Missing Environment Variable Validation

**INFRA-03 domain but cross-cutting concern:**

Environment variables used by observability components:
- `WS_SUBSCRIBER_ENABLED` -- Feature flag, checked as string `=== "true"`. No validation library, but the binary check is sufficient.
- `SLOT_BROADCAST_INTERVAL_MS` -- Parsed with parseInt, fallback to "5000". No validation of range.
- `TOKEN_SUPPLY_POLL_INTERVAL_MS` -- Same pattern, fallback to "60000".
- `STAKER_COUNT_POLL_INTERVAL_MS` -- Same pattern, fallback to "30000".
- `HEALTH_PORT` -- parseInt with fallback to "8080". No range validation.
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` -- No format validation (but parseDsn will silently fail on invalid DSN).
- `HELIUS_WEBHOOK_SECRET` -- Validated for presence in production (fail-closed).

**Assessment:** The observability-related env vars use safe fallback defaults. Injecting malformed values would cause degraded behavior (wrong poll intervals) but not security failures. The webhook secret is properly validated.

### OC-222: Debug Mode via Feature Flag

**Verdict: LOW CONCERN**

`WS_SUBSCRIBER_ENABLED` gates the WebSocket subscriber. When set to anything other than "true", the subscriber is disabled. This is a feature toggle, not a debug mode. Disabling it causes degraded state (no pre-seeded protocol store) but does not expose any debug information.

No DEBUG, ENABLE_DEBUG, or similar flags were found in the production codebase (only in the launch page debug comment).

## Cross-Focus Intersections

### INFRA-05 x ERR-01 (Error Handling & Resilience)
The staleness monitor (ws-subscriber.ts:299-323) detects WS death and activates fallback polling, but has no external alerting. If the fallback also fails (RPC down), the protocol store goes completely stale with no notification to operators beyond console output. The credit counter could serve as a proxy metric (no new calls = potential issue) but this isn't implemented.

### INFRA-05 x SEC-02 (Secrets)
- Sentry DSN is intentionally public (NEXT_PUBLIC_ prefix). Standard practice, but allows error report injection.
- HELIUS_RPC_URL is correctly server-only. The RPC proxy masks URLs in logs via `maskEndpoint()` -- good practice.
- DATABASE_URL is server-only, not logged directly. The db/connection.ts warns about non-TLS connections but does NOT log the connection string.

### INFRA-05 x DATA-04 (Logging/Disclosure)
- The webhook decode failure path (route.ts:608-619) stores raw `accountData` and `rawAccountData` in protocolStore when Anchor decode fails. This data is then broadcast via SSE to all connected clients. If the raw data contains unexpected fields, it could be disclosed to all frontend users.
- RPC proxy logs blocked methods (`console.warn`) but not the requesting IP or payload content.

### INFRA-05 x API-01 (RPC Client)
The credit counter provides a consumption metric but no alerting. For a paid Helius plan with credit limits, exceeding the limit would silently break all RPC operations. The health endpoint could check remaining credits (if Helius exposes this) but does not.

## Cross-Reference Handoffs

| Target Agent | Item | Context |
|-------------|------|---------|
| ERR-01 | WS staleness monitor has no external alerting | ws-subscriber.ts:299-323, only logs to console |
| SEC-02 | Sentry DSN is NEXT_PUBLIC -- allows error injection | sentry.ts, instrumentation-client.ts |
| DATA-04 | Decode failure raw data broadcast via SSE | webhooks/helius/route.ts:608-619 |
| API-01 | Credit counter has no threshold alerting for Helius limits | credit-counter.ts, health/route.ts |
| ERR-02 | No unhandledRejection in main Next.js process (server-side) | instrumentation.ts only wraps ws-subscriber init |

## Risk Observations

### 1. [MEDIUM] Health Endpoint Information Disclosure (H028 Expanded)
**File:** `app/app/api/health/route.ts:63-72`
**Impact:** Reconnaissance value for targeted attacks
**Prior finding:** H028 (Audit #1, LOW, NOT_FIXED). Now expanded with wsSubscriber and credits data.
**Recommendation:** Split into liveness (minimal 200 OK) and diagnostics (authenticated).

### 2. [MEDIUM] Decode Failure Raw Data Broadcast to SSE Clients
**File:** `app/app/api/webhooks/helius/route.ts:608-619`
**Impact:** Unintended data disclosure to all connected frontend users
**Recommendation:** On decode failure, store only the error message and label, not raw account data. Broadcast a sanitized error event.

### 3. [MEDIUM] Crank Health Endpoint Binds 0.0.0.0
**File:** `scripts/crank/crank-runner.ts:185`
**Impact:** If Railway network isolation is misconfigured, spending data and circuit breaker state are publicly exposed
**Recommendation:** Bind to 127.0.0.1 unless Railway requires 0.0.0.0. Or add bearer token auth.

### 4. [MEDIUM] No Structured Logging Framework
**Files:** All server-side files
**Impact:** Increases incident response time, makes log aggregation unreliable
**Recommendation:** Adopt pino or winston with JSON output for Railway log ingestion.

### 5. [LOW] Debug Console.log in Production Launch Page
**File:** `app/app/launch/page.tsx:99-107`
**Impact:** Leaks curve state to browser DevTools console
**Recommendation:** Remove before mainnet.

### 6. [LOW] No Alerting on Credit Counter Thresholds
**Files:** `app/lib/credit-counter.ts`, `app/app/api/health/route.ts`
**Impact:** Credit exhaustion could silently break all RPC operations
**Recommendation:** Add configurable threshold (e.g., warn at 80% of plan limit).

### 7. [LOW] Sentry Stack Traces Include File Paths
**File:** `app/lib/sentry.ts:181-184`
**Impact:** Reveals server directory structure to Sentry project viewers
**Recommendation:** Strip file paths to relative project paths or add source map support.

### 8. [LOW] SSE Connection Count Not Observable
**File:** `app/lib/sse-connections.ts:110-118`
**Impact:** No way to monitor connection pressure from outside the process
**Recommendation:** Add connection stats to health endpoint (total, per-IP distribution).

### 9. [LOW] Credit Counter Method Map Unbounded
**File:** `app/lib/credit-counter.ts:37`
**Impact:** Theoretical memory growth if method names become dynamic
**Recommendation:** Currently safe due to fixed allowlist in rpc-proxy. Document the invariant.

### 10. [HIGH] H028 Regression: Health Endpoint Now Exposes More Data Than Audit #1
**File:** `app/app/api/health/route.ts`
**Impact:** Original H028 finding was NOT_FIXED. This delta has expanded exposure with wsSubscriber and credits fields.
**Prior status:** H028 was LOW, NOT_FIXED. The added fields increase both the reconnaissance value and the severity.
**Recommendation:** Address before mainnet. Either authenticate the detailed response or reduce its content.

### 11. [INFORMATIONAL] Railway Does Not Support Readiness Probes
**File:** `railway.toml:8`
**Impact:** Container can accept traffic while dependencies are down (Postgres, RPC)
**Recommendation:** Railway's restart policy (ON_FAILURE, max 3) provides some recovery. Consider returning non-200 from health if critical dependencies are down, but this would conflict with the documented liveness-only design.

### 12. [INFORMATIONAL] No Distributed Observability Architecture
**Files:** All
**Impact:** Single-process observability is sufficient for current Railway deployment but will not scale to multi-instance
**Recommendation:** Document this limitation. If horizontal scaling is planned, SSE connections, credit counter, and protocol store will all need distributed backends.

## Novel Attack Surface Observations

### Health Endpoint as Attack Timing Oracle

The `/api/health` endpoint provides a real-time view of system degradation. An attacker can:

1. **Poll `/api/health` every second** to detect when `wsSubscriber.wsConnected` flips to false
2. **Know the exact moment** the server enters fallback mode (degraded reliability)
3. **Time SSE connection floods** during the degradation window when the system is already stressed
4. **Monitor `checks.postgres`** to detect database outages and time injection attempts during recovery
5. **Track `credits.methodCounts` growth rate** to estimate when Helius credit budget will be exhausted

This is novel because the health endpoint was designed for operational monitoring but inadvertently serves as a real-time attack surface intelligence feed.

### Error Report Injection via Public Sentry DSN

The NEXT_PUBLIC_SENTRY_DSN allows anyone to send error envelopes to the project's Sentry instance. While Sentry has some rate limiting and dedup, a motivated attacker could:

1. **Flood the Sentry project** with fake errors to hide real production errors
2. **Inject misleading stack traces** to confuse incident response
3. **Consume Sentry event quota** if the project has a capped plan

This is a low-priority concern (standard for all projects with client-side Sentry) but worth noting for a financial protocol where error visibility is critical.

## Questions for Other Focus Areas

1. **SEC-02:** Is the Sentry DSN scoped to write-only? Can an attacker with the DSN read existing error reports? (Sentry DSNs are typically write-only, but project configuration matters.)

2. **ERR-01:** What happens if both the WS subscriber AND the HTTP fallback fail simultaneously? Is there any mechanism to detect that the protocol store is completely stale? The staleness monitor only checks WS, not the fallback.

3. **API-01:** Does Helius provide a credit balance API? If so, the health endpoint could expose remaining credits vs. consumed, enabling proactive alerting.

4. **DATA-04:** On decode failure in the webhook route, raw `accountData` and `rawAccountData` from Helius are stored in protocolStore. What data could these fields contain that would be problematic if broadcast to SSE clients?

5. **INFRA-03:** Is Railway's network isolation guaranteed to prevent public access to the crank's port 8080? Railway documentation should be checked for this guarantee.

## Raw Notes

### Pattern: AI-Pitfall AIP-116 (Metrics Without Auth)
The health endpoint matches AIP-116 exactly: an observability endpoint on the main application port without authentication. While there is no Prometheus involved, the pattern is identical -- operational data exposed to the public internet via a well-known path.

### False Positive Check: FP-003
FP-003 says health endpoints are safe "if behind authentication middleware or only bound to localhost." Neither condition is met here. The endpoint is publicly accessible and returns sensitive operational state. This is NOT a false positive.

### Load Test Infrastructure
The load test files (`run.ts`, `k6-sse.js`) consume health endpoint data for validation. They don't create new security concerns but confirm that the health endpoint's data is designed to be machine-readable and rich in operational detail. The report.json output is gitignored but contains the same health endpoint data.

### Comparison to OC-228/229/230 Patterns
- OC-228 (unauthenticated metrics): PARTIALLY PRESENT via health endpoint
- OC-229 (sensitive data in metric labels): NOT PRESENT (no PII/wallet data in counters)
- OC-230 (pprof/debug endpoint): NOT PRESENT (no Go, no debug ports)

The codebase avoids the most severe infrastructure observability pitfalls. The primary concern is the health endpoint's information richness, which is a lower-severity issue that should be addressed before mainnet launch.
