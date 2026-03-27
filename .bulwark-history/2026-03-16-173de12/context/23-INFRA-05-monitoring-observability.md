---
task_id: db-phase1-monitoring-observability
provides: [monitoring-observability-findings, monitoring-observability-invariants]
focus_area: monitoring-observability
files_analyzed: [app/app/api/health/route.ts, app/lib/sentry.ts, app/instrumentation.ts, app/instrumentation-client.ts, app/app/global-error.tsx, app/lib/sse-manager.ts, app/lib/connection.ts, app/next.config.ts, app/providers/providers.tsx, shared/constants.ts, shared/programs.ts, scripts/crank/crank-runner.ts, scripts/crank/crank-provider.ts, scripts/e2e/lib/overnight-reporter.ts, scripts/deploy/lib/logger.ts, scripts/vrf/devnet-vrf-validation.ts, app/app/api/sse/candles/route.ts, app/app/api/webhooks/helius/route.ts, app/app/api/candles/route.ts, app/app/api/sol-price/route.ts, app/app/api/carnage-events/route.ts, app/db/connection.ts, railway.toml, railway-crank.toml]
finding_count: 9
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 3, informational: 1}
---
<!-- CONDENSED_SUMMARY_START -->
# Monitoring, Metrics & Observability Exposure — Condensed Summary

## Key Findings (Top 5-10)
- **Helius API key hardcoded in committed source**: API key `[REDACTED-DEVNET-KEY]...` is in `shared/constants.ts:474` and `shared/programs.ts:22`, embedded in the RPC URL and exported as a named constant. While documented as "free-tier, not a secret", this key gates RPC access and webhook management — abuse could exhaust rate limits or register malicious webhooks.
- **Health endpoint exposes dependency topology without authentication**: `/api/health` at `app/app/api/health/route.ts:28` returns Postgres and Solana RPC connectivity status to any caller. Railway uses this for liveness, but it also tells attackers which dependencies exist and whether they are reachable.
- **No server-side error reporting to Sentry**: `app/instrumentation.ts:6` is explicitly a no-op. Server-side errors (API routes, webhook handler, SSE) only surface through Railway's stdout log capture. Crank runner errors similarly go only to stdout.
- **Crank runner logs wallet public key and balance to stdout**: `scripts/crank/crank-runner.ts:176-177` logs full wallet pubkey and RPC URL. Line 214-216 logs wallet balance warnings. Railway captures all stdout — if Railway dashboard access is compromised, operational wallet identity is exposed.
- **Webhook auth is optional by design**: `app/app/api/webhooks/helius/route.ts:135-141` skips authorization if `HELIUS_WEBHOOK_SECRET` env var is unset. If production deploys without this var, any party can POST fabricated transaction data.
- **No rate limiting on any API endpoint**: All 6 API routes (`/api/health`, `/api/candles`, `/api/sol-price`, `/api/sse/candles`, `/api/carnage-events`, `/api/webhooks/helius`) lack rate limiting. SSE endpoint at `/api/sse/candles` is particularly concerning — unbounded subscriber connections could exhaust server memory.
- **CSP allows `'unsafe-inline'` for scripts**: `app/next.config.ts:9` includes `script-src 'self' 'unsafe-inline'` which weakens XSS protection. Next.js requires this for hydration, but it should be noted as a defense-in-depth gap.
- **RPC URL with API key logged with partial redaction in one location only**: `scripts/vrf/devnet-vrf-validation.ts:94` redacts `api-key=***`, but `scripts/crank/crank-runner.ts:177` logs `process.env.CLUSTER_URL` raw (which contains the full Helius URL with key if set via env).
- **No structured logging**: All logging uses raw `console.log`/`console.error`. No log levels, no structured JSON format (except one JSON line in crank-runner line 300), no correlation IDs. Makes production debugging and alerting difficult.

## Critical Mechanisms
- **Sentry (client-only)**: Zero-dependency fetch-based reporter at `app/lib/sentry.ts`. Captures browser `error` and `unhandledrejection` events via `app/instrumentation-client.ts:37-44`. Global error boundary at `app/app/global-error.tsx` also reports. DSN comes from `NEXT_PUBLIC_SENTRY_DSN` env var. Fire-and-forget POST to Sentry ingest API. No server-side coverage.
- **Health check**: `app/app/api/health/route.ts` — always returns HTTP 200 (for Railway liveness), with body indicating `ok` or `degraded`. Checks Postgres (`SELECT 1`) and Solana RPC (`getSlot()`). No authentication.
- **Crank runner observability**: `scripts/crank/crank-runner.ts` — JSON-structured epoch log at line 300 (`[epoch] {...}`). Graceful shutdown on SIGINT/SIGTERM (lines 81-89). Logs cycle count and carnage trigger count on shutdown. All output to stdout captured by Railway.
- **SSE streaming**: `app/app/api/sse/candles/route.ts` — long-lived connections, in-memory subscriber set, 15s heartbeat. No authentication, no connection limits, no subscriber cap.
- **Overnight reporter**: `scripts/e2e/lib/overnight-reporter.ts` — generates Markdown reports with epoch details, error summaries, TX signatures. Development/testing tool, not production monitoring.

## Invariants & Assumptions
- INVARIANT: Health endpoint always returns HTTP 200 regardless of dependency state — enforced at `app/app/api/health/route.ts:49-55` (status field in body distinguishes ok/degraded)
- INVARIANT: Sentry reporting never blocks application execution — enforced at `app/lib/sentry.ts:86-92` (fire-and-forget fetch, catch swallows errors)
- INVARIANT: Crank runner never exits on transient errors — enforced at `scripts/crank/crank-runner.ts:308-314` (catch block sleeps and retries)
- ASSUMPTION: Railway captures all stdout/stderr as logs — UNVALIDATED (no explicit Railway logging configuration found beyond `railway.toml`)
- ASSUMPTION: `HELIUS_WEBHOOK_SECRET` is set in production Railway environment — UNVALIDATED (no startup validation for this env var)
- ASSUMPTION: SSE subscriber count stays manageable — NOT ENFORCED (no cap on `sseManager.subscribers` set size at `app/lib/sse-manager.ts:30`)

## Risk Observations (Prioritized)
1. **Hardcoded Helius API key in source**: `shared/constants.ts:474`, `shared/programs.ts:22` — Even if "free-tier", this key is committed to git history permanently. If upgraded to a paid tier or used for webhook management (`scripts/webhook-manage.ts:28`), abuse potential increases. Rate limit exhaustion is the immediate risk.
2. **No SSE connection limits**: `app/lib/sse-manager.ts:30`, `app/app/api/sse/candles/route.ts:38` — An attacker can open thousands of SSE connections, each holding a server-side ReadableStream and interval timer. Memory exhaustion / connection exhaustion DoS.
3. **Optional webhook authentication**: `app/app/api/webhooks/helius/route.ts:135-141` — If `HELIUS_WEBHOOK_SECRET` is not set, anyone can POST fake swap/epoch/carnage events, poisoning the database and chart data (SSE broadcasts to all clients).
4. **No server-side error reporting**: `app/instrumentation.ts` is a no-op — Server crashes, unhandled rejections in API routes, and database failures are only visible in Railway's log viewer. No alerting, no aggregation, no error rate tracking.
5. **Health endpoint information disclosure**: `app/app/api/health/route.ts:28` — Reveals Postgres and Solana RPC dependency names and connectivity status. Useful for reconnaissance (confirms tech stack).

## Novel Attack Surface
- **SSE as amplification vector**: The webhook handler broadcasts to all SSE subscribers. A single webhook POST with many transactions triggers N broadcasts per swap per resolution (6 resolutions). Combined with unbounded subscribers, this creates a multiplication factor for resource consumption.
- **Crank JSON log injection**: `scripts/crank/crank-runner.ts:300` logs `JSON.stringify(logEntry)` where `result.cheapSide` comes from on-chain data. If on-chain state somehow contains control characters, the JSON line format could be disrupted in log parsers (low likelihood but worth noting for structured logging migration).

## Cross-Focus Handoffs
- → **SEC-02**: Helius API key hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22` — assess credential exposure risk and whether this key is used for anything beyond free-tier RPC.
- → **API-04**: Webhook handler at `app/app/api/webhooks/helius/route.ts` has optional auth and no rate limiting — assess injection/poisoning attack surface.
- → **ERR-01/ERR-03**: No rate limiting on any API route, no structured error handling — assess resilience and DoS surface.
- → **BOT-01**: Crank runner logs operational details (wallet, balance, RPC URL) to stdout — assess information leakage through Railway log access.

## Trust Boundaries
The observability stack has a permissive trust model. The health endpoint trusts all callers (no auth), the SSE endpoint accepts unlimited anonymous connections, and the webhook endpoint's authentication is opt-in via an environment variable that may not be set. Sentry reporting only covers the client side, leaving server-side errors visible only through platform logs (Railway). The crank runner operates with implicit trust that its stdout is only accessible to authorized Railway dashboard users. All API keys (Helius) are hardcoded in committed source rather than injected via environment, creating a permanent exposure in git history.
<!-- CONDENSED_SUMMARY_END -->

---

# Monitoring, Metrics & Observability Exposure — Full Analysis

## Executive Summary

The Dr. Fraudsworth project has a minimal but functional observability setup: a health check endpoint for Railway container liveness, a zero-dependency Sentry client for browser-side error capture, and console-based logging throughout. There are no Prometheus metrics endpoints, no Grafana integrations, no OpenTelemetry, no debug/pprof endpoints, and no structured logging framework. The primary risks are: (1) a Helius API key hardcoded in committed source files, (2) no server-side error aggregation, (3) information disclosure through the unauthenticated health endpoint, (4) no rate limiting or connection caps on the SSE streaming endpoint, and (5) optional webhook authentication that could be accidentally omitted in production.

## Scope

All off-chain TypeScript/TSX files related to monitoring, health checks, error reporting, logging, and configuration exposure. On-chain Anchor/Rust programs in `programs/` are excluded.

**Files analyzed in full (Layer 3):**
- `app/app/api/health/route.ts` — Health check endpoint
- `app/lib/sentry.ts` — Zero-dependency Sentry reporter
- `app/instrumentation.ts` — Server-side instrumentation (no-op)
- `app/instrumentation-client.ts` — Client-side instrumentation + Sentry wiring
- `app/app/global-error.tsx` — Global error boundary
- `app/lib/sse-manager.ts` — SSE pub/sub singleton
- `app/app/api/sse/candles/route.ts` — SSE streaming endpoint
- `app/app/api/webhooks/helius/route.ts` — Webhook handler (auth check)
- `shared/constants.ts` — Hardcoded API key and program IDs
- `shared/programs.ts` — Hardcoded RPC URL with API key
- `app/lib/connection.ts` — RPC connection factory
- `app/next.config.ts` — CSP and security headers
- `scripts/crank/crank-runner.ts` — Production crank bot logging
- `scripts/crank/crank-provider.ts` — Crank configuration loader
- `railway.toml` — Railway deployment config
- `railway-crank.toml` — Railway crank service config

**Files analyzed at Layer 2 (signatures only):**
- `app/providers/providers.tsx` — RPC endpoint config
- `scripts/deploy/lib/logger.ts` — Deploy logger
- `scripts/e2e/lib/overnight-reporter.ts` — Test reporter
- `scripts/vrf/devnet-vrf-validation.ts` — VRF validation (API key redaction)
- `app/app/api/sol-price/route.ts` — Price proxy
- `app/app/api/candles/route.ts` — Candle REST API
- `app/app/api/carnage-events/route.ts` — Carnage events API
- `app/db/connection.ts` — Database connection

## Key Mechanisms

### 1. Health Check Endpoint (`app/app/api/health/route.ts`)

**Purpose:** Container liveness for Railway + dependency health monitoring.

**Mechanism:**
- Always returns HTTP 200 (Railway healthcheck expects 200 for "alive")
- Body contains `status: "ok" | "degraded"` and individual check results
- Checks: Postgres (`SELECT 1`), Solana RPC (`getSlot()`)
- Each check runs independently in try/catch
- Errors logged to console with `[health]` prefix

**Security observations:**
- No authentication — any HTTP client can query dependency status
- Reveals tech stack: confirms Postgres and Solana RPC are used
- Does NOT expose connection strings, version numbers, or internal IPs
- Railway configures this as healthcheck path in `railway.toml:8`
- Healthcheck timeout: 120 seconds (`railway.toml:9`)

**Per FP-003 (common false positives):** This would be a false positive IF the endpoint were behind auth or only on localhost. It is NOT — it's on the public port. However, the information disclosed is limited (boolean connectivity status, no internal details). Classifying as LOW.

### 2. Sentry Error Reporting (`app/lib/sentry.ts`)

**Purpose:** Browser-side error capture without `@sentry/*` npm packages (Turbopack incompatibility).

**Mechanism:**
- Parses DSN from `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` env vars
- Constructs Sentry envelope format manually
- Fire-and-forget `fetch()` POST to `https://{host}/api/{projectId}/envelope/`
- Sentry key is passed as query parameter `sentry_key={key}`
- Error object serialized with name, message, stack trace (first 20 frames)
- Environment set from `NODE_ENV`

**Security observations:**
- Sentry DSN contains the public key (this is by design — Sentry public keys are safe to expose client-side)
- Stack traces could contain file paths revealing internal code structure — this is standard for Sentry
- No PII scrubbing — if error messages contain user data, it goes to Sentry unfiltered
- `NEXT_PUBLIC_` prefix means DSN is exposed to the browser (intentional for client-side reporting)
- No rate limiting on error submission — a bug causing rapid errors could flood Sentry

**Wiring:**
- `app/instrumentation-client.ts:37-44` — Hooks `window.error` and `window.unhandledrejection` events
- `app/app/global-error.tsx:17-19` — React error boundary captures and reports

### 3. Server-Side Instrumentation (`app/instrumentation.ts`)

**Status:** Explicitly a no-op (line 7: "No-op. All @sentry/* npm packages conflict with Turbopack's SSR runtime").

**Impact:** Server-side errors in API routes, webhook handler, SSE streaming, and database operations are NOT reported to Sentry. They only appear in Railway's stdout/stderr log capture. There is no error aggregation, alerting, or rate tracking for server-side failures.

### 4. Crank Runner Logging (`scripts/crank/crank-runner.ts`)

**Mechanism:**
- All output via `console.log` / `console.error` to stdout
- JSON-structured epoch log at line 300: `[epoch] {"ts":..., "cycle":..., "epoch":..., ...}`
- Logs wallet public key (full, line 176) and RPC URL (raw from env, line 177)
- Logs wallet balance warnings when below 1 SOL (line 214-216)
- Graceful shutdown on SIGINT/SIGTERM with summary stats
- Error retry: 30-second delay after failed cycle, no exit

**Security observations:**
- Wallet public key in logs is not a secret (public information), but combined with balance logging, it provides operational intelligence
- RPC URL logged at line 177 may contain API key if `CLUSTER_URL` env var includes the Helius URL with key
- Contrast with `scripts/vrf/devnet-vrf-validation.ts:94` which actively redacts: `.replace(/api-key=[^&]+/, "api-key=***")`
- No log rotation or retention policy visible in code — dependent on Railway's log management

### 5. Hardcoded API Key (`shared/constants.ts`, `shared/programs.ts`)

**Details:**
- `shared/constants.ts:474`: `export const HELIUS_API_KEY = "[REDACTED-DEVNET-HELIUS-KEY]";`
- `shared/programs.ts:22`: Full Helius RPC URL with key embedded: `https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]...`
- Comment says "free-tier API key, not a secret"
- Used by: `app/lib/connection.ts` (fallback RPC), `app/providers/providers.tsx` (wallet-adapter endpoint), `scripts/webhook-manage.ts:28` (webhook CRUD operations)

**Risk analysis:**
- Even free-tier keys have rate limits; abuse could exhaust them, causing service disruption
- `scripts/webhook-manage.ts` uses this key for webhook registration/deletion — an attacker with the key could register malicious webhooks or delete legitimate ones
- Key is in git history permanently — even if moved to env var later, the historical key remains valid unless rotated
- CSP in `app/next.config.ts:19` explicitly allows `connect-src https://devnet.helius-rpc.com` — confirms this is the production RPC endpoint

### 6. SSE Manager (`app/lib/sse-manager.ts`, `app/app/api/sse/candles/route.ts`)

**Mechanism:**
- In-memory `Set<SSECallback>` — no cap on subscriber count
- Each SSE connection holds: 1 ReadableStream controller, 1 setInterval timer (15s heartbeat), 1 abort listener
- Cleanup on disconnect: interval cleared, subscriber removed
- globalThis singleton pattern for HMR survival

**Security observations:**
- No authentication on SSE endpoint
- No maximum connection limit
- No per-IP connection throttling
- Memory per connection: ~few KB (callback reference + ReadableStream overhead + interval timer)
- At 10,000 connections: ~50-100MB memory + 10K active intervals
- Broadcast is O(N) for every webhook event — could become CPU-bound with many subscribers

## Trust Model

```
Browser ─── (HTTPS) ──→ Next.js API Routes ─── (postgres://) ──→ Postgres
                                            ─── (https://)    ──→ Helius RPC
                                            ─── (https://)    ──→ CoinGecko/Binance

Helius ──── (HTTPS POST) ──→ /api/webhooks/helius (optional auth)

Crank ───── (stdout) ──→ Railway Logs
Browser ─── (fetch) ──→ Sentry Ingest API
```

Trust boundaries:
1. **Browser → API routes**: No authentication on any read endpoint. Webhook has optional auth.
2. **Helius → Webhook**: Auth header check only if `HELIUS_WEBHOOK_SECRET` is set.
3. **Crank → Railway Logs**: Implicit trust that Railway dashboard access is controlled.
4. **Browser → Sentry**: Public DSN, standard for client-side error reporting.

## State Analysis

### In-Memory State
- `app/lib/sse-manager.ts`: `Set<SSECallback>` — subscriber connections, lost on restart
- `app/lib/connection.ts`: `cachedConnection` / `cachedUrl` — RPC connection singleton
- `app/app/api/sol-price/route.ts`: `cachedPrice` / `cachedAt` — 60s price cache
- `app/db/connection.ts`: `globalForDb` — Postgres connection pool singleton

### Persistent State
- Railway logs: stdout/stderr capture (retention policy unknown)
- Sentry: Error events (cloud-hosted, retention per plan)
- Postgres: swap_events, epoch_events, carnage_events (webhook-sourced)

### No Metrics State
- No Prometheus registry
- No custom counters/gauges/histograms
- No request timing metrics
- No error rate tracking

## Dependencies (External APIs, Packages, Services)

| Dependency | Purpose | Auth | Failure Mode |
|-----------|---------|------|-------------|
| Helius RPC | Solana reads/writes | API key in URL | Health check reports `solanaRpc: false` |
| Postgres (Railway) | Event storage, candles | `DATABASE_URL` env var | Health check reports `postgres: false` |
| Sentry Ingest | Client error reporting | DSN (public key) | Errors silently dropped |
| CoinGecko | SOL/USD price | None | Falls back to Binance |
| Binance | SOL/USD price fallback | None | Returns stale cache or 502 |
| Railway | Hosting, log capture | Platform auth | N/A (infrastructure) |

## Focus-Specific Analysis

### Metrics Endpoints
**Finding: No metrics endpoints exist.** No `/metrics`, no Prometheus, no Grafana, no OpenTelemetry, no Datadog, no New Relic. The project has zero formal metrics collection.

This is both a strength (no unauthenticated metrics exposure, per OC-228/OC-229) and a weakness (no production monitoring beyond logs and Sentry).

### Debug Endpoints
**Finding: No debug endpoints exist.** No `/debug`, no pprof, no `/actuator`, no Node.js inspector port. Railway configs do not expose debug ports.

Per AIP-112 (AI pitfall: debug ports in Dockerfiles): No Dockerfiles exist in the project. Railway uses Nixpacks builder, which does not add debug ports by default.

### Health Check Information Disclosure
The `/api/health` endpoint reveals:
```json
{
  "status": "ok|degraded",
  "checks": { "postgres": true|false, "solanaRpc": true|false },
  "timestamp": "2026-03-07T..."
}
```

This confirms: (1) Postgres is a dependency, (2) Solana RPC is a dependency, (3) the server's clock time. It does NOT expose: connection strings, versions, internal IPs, query results, or error details.

**Severity: LOW** — Limited information, no actionable exploit path. Standard practice for container orchestration.

### Logging Analysis

**Console.log usage across scripts/:** 674 occurrences across 27 files. Highlights:

| Pattern | Files | Risk |
|---------|-------|------|
| Wallet pubkey logged | crank-runner, overnight-runner, smoke-test, security-verification, carnage-hunter | LOW — public keys are public |
| Balance logged | crank-runner, overnight-runner, security-verification | LOW — operational info |
| RPC URL logged (potentially with API key) | crank-runner:177 | MEDIUM — no redaction |
| API key redacted | devnet-vrf-validation:94 | GOOD — `.replace(/api-key=[^&]+/, "api-key=***")` |
| Error details logged | webhook route, candle API | GOOD — server-side only, uses `console.error` |

**No sensitive data logged in app/ directory** (frontend code). The `app/` code does not log any keys, secrets, or PII.

### Environment Variable Validation

| Env Var | Validated? | Default | File |
|---------|-----------|---------|------|
| `DATABASE_URL` | Yes (throws) | None | `app/db/connection.ts:41-46` |
| `NEXT_PUBLIC_RPC_URL` | No (falls back) | `DEVNET_RPC_URL` | `app/lib/connection.ts:33` |
| `HELIUS_WEBHOOK_SECRET` | No (skips auth) | None | `app/app/api/webhooks/helius/route.ts:135` |
| `NEXT_PUBLIC_SENTRY_DSN` | No (no-ops) | None | `app/lib/sentry.ts:33` |
| `WALLET_KEYPAIR` | Yes (throws on parse failure) | None | `scripts/crank/crank-provider.ts:46-56` |
| `CLUSTER_URL` | No (falls back) | `http://localhost:8899` | `scripts/crank/crank-provider.ts:35` |
| `PDA_MANIFEST` | Yes (throws on parse failure) | File fallback | `scripts/crank/crank-provider.ts:146-154` |
| `CARNAGE_WSOL_PUBKEY` | Yes (throws if missing + no file) | File fallback | `scripts/crank/crank-runner.ts:98-112` |

**Per AIP-113 (AI pitfall: env vars without validation):** Most critical env vars (`DATABASE_URL`, `WALLET_KEYPAIR`) do validate and throw. Non-critical ones (`NEXT_PUBLIC_RPC_URL`, `SENTRY_DSN`) gracefully fall back. The gap is `HELIUS_WEBHOOK_SECRET` — its absence silently disables authentication.

### CSP and Security Headers (`app/next.config.ts`)

Headers applied to all routes:
- `Content-Security-Policy`: Detailed directive set
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

CSP observations:
- `script-src 'self' 'unsafe-inline'` — Needed for Next.js hydration, but weakens XSS protection
- `connect-src` explicitly lists Helius RPC domains — good, restricts outbound connections
- Sentry ingest domains included: `*.ingest.sentry.io`, `*.ingest.us.sentry.io`
- `frame-ancestors 'none'` — prevents clickjacking (redundant with X-Frame-Options: DENY, but defense-in-depth)
- `upgrade-insecure-requests` — forces HTTPS
- Missing: `Strict-Transport-Security` (HSTS) header. Railway may add this at the proxy level, but it's not explicitly configured.

## Cross-Focus Intersections

### With SEC-02 (Secrets Management)
The hardcoded Helius API key in `shared/constants.ts:474` and `shared/programs.ts:22` is a cross-cutting concern. While it's labeled "free-tier", it's used for webhook management operations in `scripts/webhook-manage.ts`. The key is in git history permanently.

### With API-04 (API Security)
The optional webhook authentication in `app/app/api/webhooks/helius/route.ts:135-141` is a configuration-dependent security control. If the env var is missing, the entire webhook ingestion pipeline is open to data injection.

### With ERR-01 (Error Handling)
The no-op server-side instrumentation means server errors are invisible to structured monitoring. Combined with no rate limiting (ERR-03), the system has limited ability to detect and respond to attack patterns.

### With BOT-01 (Keeper/Crank)
The crank runner's logging to stdout creates a dependency on Railway's log infrastructure for operational visibility. No independent alerting exists for crank failures.

## Cross-Reference Handoffs

1. **→ SEC-02**: Assess whether Helius API key at `shared/constants.ts:474` is used beyond free-tier RPC. Check if `scripts/webhook-manage.ts` webhook CRUD operations are a risk if the key is abused.
2. **→ API-04**: Assess data injection risk through unauthenticated webhook endpoint. Could fake swap events poison chart data or manipulate displayed prices?
3. **→ ERR-03**: Assess DoS surface of unbounded SSE connections at `app/app/api/sse/candles/route.ts` and lack of rate limiting on all API routes.
4. **→ BOT-01**: Assess whether crank runner should have independent health reporting beyond Railway stdout (e.g., heartbeat to external service).
5. **→ FE-01**: `unsafe-inline` in CSP `script-src` — assess whether nonce-based CSP is feasible with current Next.js/Turbopack setup.

## Risk Observations

### R1: Hardcoded Helius API Key (HIGH)
- **File:** `shared/constants.ts:474`, `shared/programs.ts:22`
- **Risk:** API key in committed source, used for RPC access and webhook management. Even if rotated now, old key remains in git history.
- **Impact:** Rate limit exhaustion (availability), malicious webhook registration (integrity)
- **Likelihood:** Possible — key is in a public-facing git repo if ever open-sourced, or accessible to anyone with repo access

### R2: Unbounded SSE Connections (MEDIUM)
- **File:** `app/lib/sse-manager.ts:30`, `app/app/api/sse/candles/route.ts:38`
- **Risk:** No cap on concurrent SSE connections. Each holds memory, an interval timer, and receives broadcasts.
- **Impact:** Memory exhaustion, CPU overhead from broadcasting to thousands of subscribers
- **Likelihood:** Possible — trivial to script (just open EventSource connections in a loop)

### R3: Optional Webhook Authentication (MEDIUM)
- **File:** `app/app/api/webhooks/helius/route.ts:135-141`
- **Risk:** If `HELIUS_WEBHOOK_SECRET` is not set in production, webhook endpoint accepts any POST, enabling database poisoning
- **Impact:** Fake price data, false carnage events, misleading chart displays
- **Likelihood:** Possible — env var oversight during deployment

### R4: No Server-Side Error Aggregation (MEDIUM)
- **File:** `app/instrumentation.ts:6`
- **Risk:** Server errors only visible in Railway log viewer. No alerting, no dashboards, no error rate tracking.
- **Impact:** Delayed detection of production issues, difficulty diagnosing intermittent failures
- **Likelihood:** Probable — this is a known gap, not a potential one

### R5: Missing HSTS Header (MEDIUM)
- **File:** `app/next.config.ts`
- **Risk:** No `Strict-Transport-Security` header configured. Railway may add this at the proxy level.
- **Impact:** First-visit downgrade attacks if Railway proxy doesn't add HSTS
- **Likelihood:** Unlikely — Railway likely handles this, but should be verified

### R6: Health Endpoint Information Disclosure (LOW)
- **File:** `app/app/api/health/route.ts:28`
- **Risk:** Reveals dependency topology (Postgres, Solana RPC) and connectivity status
- **Impact:** Reconnaissance value — attacker knows what to target
- **Likelihood:** Possible — endpoint is public

### R7: Unredacted RPC URL in Crank Logs (LOW)
- **File:** `scripts/crank/crank-runner.ts:177`
- **Risk:** `CLUSTER_URL` logged without API key redaction (contrast with `devnet-vrf-validation.ts:94` which redacts)
- **Impact:** API key visible in Railway logs if `CLUSTER_URL` contains Helius URL with key
- **Likelihood:** Probable — this is a code path that runs on every crank start

### R8: No Structured Logging (LOW)
- **Files:** All TypeScript files
- **Risk:** Raw `console.log`/`console.error` makes log parsing, alerting, and filtering difficult
- **Impact:** Operational — harder to detect anomalies, slower incident response
- **Likelihood:** N/A (operational concern, not exploitable)

### R9: CSP unsafe-inline (INFORMATIONAL)
- **File:** `app/next.config.ts:9`
- **Risk:** `script-src 'unsafe-inline'` weakens XSS protection. Required by Next.js hydration.
- **Impact:** If XSS is found elsewhere, inline script execution is permitted by CSP
- **Note:** This is a known Next.js limitation, not an implementation error

## Novel Attack Surface Observations

### SSE Amplification via Webhook
The webhook handler at `app/app/api/webhooks/helius/route.ts` broadcasts to all SSE subscribers for every swap event across all 6 candle resolutions. A single webhook POST with N transactions generates up to N * 6 SSE broadcast calls. Combined with no authentication (if secret is unset) and no subscriber cap, an attacker could:
1. Open 1000 SSE connections
2. POST a batch of 100 fake transactions to the webhook endpoint
3. Trigger 100 * 6 = 600 broadcasts, each iterating 1000 subscribers
4. Result: 600,000 message deliveries from a single HTTP POST

This is a novel amplification pattern specific to this architecture.

### Crank Shutdown Timing
The crank runner logs shutdown statistics (cycles completed, carnage triggers) at `scripts/crank/crank-runner.ts:319-325`. If an attacker can trigger SIGTERM at a specific time (e.g., via Railway API if dashboard credentials are compromised), they could stop the crank mid-cycle, potentially leaving the protocol in an inconsistent state (e.g., VRF committed but not revealed).

## Questions for Other Focus Areas

1. **For SEC-02:** Is the Helius API key at `shared/constants.ts:474` the same key used in Railway's `CLUSTER_URL` env var? If so, rotating the env var but not the hardcoded value creates a split configuration.
2. **For API-04:** Does the webhook handler at `app/app/api/webhooks/helius/route.ts` validate that transaction signatures actually exist on-chain? Or does it trust the webhook payload entirely?
3. **For INFRA-03:** Does Railway add HSTS headers at the proxy level? The application code does not set them.
4. **For ERR-02:** What happens to in-flight SSE subscribers when Railway restarts the container? Are there reconnection storms?

## Raw Notes

- No Dockerfiles in the project — Railway uses Nixpacks builder
- No GitHub Actions workflows in the project (only in node_modules)
- `.env` and `.env.local` exist but are gitignored (`.gitignore` line 1: `.env`)
- The `overnight-reporter.ts` is a development/testing tool, not production monitoring
- `scripts/deploy/lib/logger.ts` writes TX signatures to timestamped log files — deployment audit trail, not runtime monitoring
- `app/lib/solscan.ts` builds Solscan URLs from `NEXT_PUBLIC_SOLANA_CLUSTER` env var — no observability concern
- Railway crank service has `restartPolicyMaxRetries: 10` vs main app's `restartPolicyMaxRetries: 3` — crank is more resilient to restarts
- No `NODE_TLS_REJECT_UNAUTHORIZED` or `rejectUnauthorized: false` found anywhere (per AIP-109 check — clean)
