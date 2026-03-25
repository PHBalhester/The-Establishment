---
task_id: db-phase1-data-04-logging-disclosure
provides: [data-04-logging-disclosure-findings, data-04-logging-disclosure-invariants]
focus_area: data-04-logging-disclosure
files_analyzed: [app/app/api/health/route.ts, app/app/api/webhooks/helius/route.ts, app/app/api/rpc/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/app/api/sol-price/route.ts, app/app/api/sse/protocol/route.ts, app/lib/ws-subscriber.ts, app/lib/protocol-store.ts, app/lib/credit-counter.ts, app/lib/connection.ts, app/lib/sentry.ts, app/lib/rate-limit.ts, app/lib/swap/error-map.ts, app/lib/swap/route-engine.ts, app/next.config.ts, app/instrumentation.ts, app/hooks/useSwap.ts, app/hooks/useProtocolState.ts, app/db/connection.ts, scripts/crank/crank-runner.ts, scripts/deploy/lib/logger.ts, scripts/e2e/smoke-test.ts, scripts/webhook-manage.ts]
finding_count: 10
severity_breakdown: {critical: 0, high: 0, medium: 3, low: 5, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# DATA-04: Logging & Information Disclosure — Condensed Summary

## Key Findings (Top 10)

1. **Health endpoint exposes internal architecture**: wsSubscriber state (slot numbers, connection status, fallback status), RPC credit counter breakdown (per-method call counts), Postgres/Solana connectivity — all publicly accessible without authentication — `app/app/api/health/route.ts:66-72`
2. **RPC proxy logs disallowed methods from user input (log injection vector)**: `req.method` from untrusted JSON-RPC body interpolated directly into `console.warn` — `app/app/api/rpc/route.ts:117`
3. **Webhook route logs transaction signatures in warning messages**: Stale TX signatures and unknown pool types are logged with full signature values from untrusted Helius payloads — `app/app/api/webhooks/helius/route.ts:383-385,407-409`
4. **Crank runner logs wallet balance in plaintext**: Wallet SOL balance logged every cycle when below threshold — `scripts/crank/crank-runner.ts:407-409`; confirmed as H076 (NOT_FIXED from Audit #1)
5. **Smoke test logs raw CLUSTER_URL containing API key**: `process.env.CLUSTER_URL` logged without masking — `scripts/e2e/smoke-test.ts:36`
6. **Error messages propagated to UI contain internal error structure**: `parseSwapError` maps Anchor error codes to user messages, but unrecognized errors may expose raw error strings — `app/hooks/useSwap.ts:797`
7. **SSE protocol stream broadcasts all protocol account states to any connected client**: No authentication on SSE endpoint — any browser can connect and receive full protocol PDA state — `app/app/api/sse/protocol/route.ts:71-76`
8. **Console.error calls log full Error objects (including stack traces) to server logs**: Multiple API routes pass raw `err` objects to `console.error` — `app/app/api/webhooks/helius/route.ts:41,57,480-484,502,609-612`
9. **Credit counter exposes RPC method usage patterns via health endpoint**: Per-method call counts (getAccountInfo, getProgramAccounts, etc.) visible publicly — `app/lib/credit-counter.ts:41-47` exposed at `app/app/api/health/route.ts:64`
10. **DB connection warns with remote hostname in non-production**: Remote DB hostname logged in warning message — `app/db/connection.ts:67` (FP-check: non-production only, acceptable)

## Critical Mechanisms

- **Error Response Pattern**: All API routes use generic `{ error: "Internal server error" }` for 500 responses. Stack traces go to server `console.error` + Sentry, never to HTTP response body. This is the correct pattern (SP-029). — `app/app/api/webhooks/helius/route.ts:504-506`, `app/app/api/candles/route.ts:251-254`, `app/app/api/rpc/route.ts:184-186`
- **RPC URL Masking**: Crank runner has `maskRpcUrl()` that strips API keys from Helius URLs before logging. RPC proxy has `maskEndpoint()` that extracts hostname only. Both prevent API key leakage in logs. — `scripts/crank/crank-runner.ts:233-250`, `app/app/api/rpc/route.ts:72-78`
- **Source Maps**: No `productionBrowserSourceMaps: true` or `devtool: "source-map"` found in production config. Next.js config does not enable source maps. — `app/next.config.ts`
- **CSP Headers**: Strict Content Security Policy in place with `default-src 'self'`, preventing cross-origin data exfiltration. — `app/next.config.ts:31-47`
- **Sentry Error Reporting**: Custom zero-dependency implementation sends stack traces to Sentry ingest API only, never to client. Includes breadcrumbs, release tags, runtime detection. — `app/lib/sentry.ts`
- **Health Endpoint Information Richness**: Returns wsSubscriber status (initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive), credit stats (totalCalls, methodCounts, startedAt), and dependency connectivity. Always returns 200 (H085 accepted risk). — `app/app/api/health/route.ts:62-72`

## Invariants & Assumptions

- INVARIANT: API error responses NEVER contain stack traces or internal error details — enforced across all API routes via generic `{ error: "..." }` pattern. Each route catches errors, logs internally via `console.error` + `captureException`, returns generic message.
- INVARIANT: Helius API keys (in RPC URLs) are NEVER logged unmasked by the app layer — enforced at `app/app/api/rpc/route.ts:72-78` (maskEndpoint) and `scripts/crank/crank-runner.ts:233-250` (maskRpcUrl). BUT NOT enforced in `scripts/e2e/smoke-test.ts:36`.
- INVARIANT: `HELIUS_WEBHOOK_SECRET` is never logged or included in error responses — verified across all occurrences in `app/app/api/webhooks/helius/route.ts`.
- ASSUMPTION: Server-side `console.error` output is only accessible to Railway operators (not end users) — UNVALIDATED. Railway logs are accessible via dashboard. If Railway dashboard credentials are compromised, all console.error output (including full Error objects with stacks) is exposed.
- ASSUMPTION: Health endpoint disclosure is acceptable because the information is not sensitive — PARTIALLY VALID. Slot numbers and Postgres connectivity are not secrets, but RPC method call patterns and wsSubscriber internal state provide reconnaissance data.
- ASSUMPTION: SSE protocol data (pool reserves, epoch state, staker stats) is public on-chain data anyway — VALID. All data broadcast via SSE is readable from Solana RPC by anyone.

## Risk Observations (Prioritized)

1. **Health endpoint info disclosure (H028 NOT_FIXED)**: `app/app/api/health/route.ts:66-72` — Exposes wsSubscriber connection state, credit counter per-method breakdown, and dependency health. An attacker can determine: (a) whether WS is connected or in fallback mode, (b) server uptime via `startedAt`, (c) RPC usage patterns. Impact: reconnaissance for timing-based attacks or DoS targeting known infrastructure dependencies. Severity: LOW (on-chain data is public, but infrastructure state aids attackers).

2. **Log injection via RPC proxy method field**: `app/app/api/rpc/route.ts:117` — User-controlled `req.method` from JSON-RPC body is interpolated into `console.warn` without sanitization. An attacker could inject newlines or ANSI escape codes. Impact: log forging, potentially confusing log analysis tools. Severity: LOW (Railway console strips ANSI, but structured logging would be better).

3. **Log injection via webhook pool type**: `app/app/api/webhooks/helius/route.ts:407-409` — `swap.poolType` from parsed Anchor events logged via `console.warn`. While Helius payloads are authenticated, a compromised webhook secret or a replay with crafted logs could inject arbitrary strings into server logs.

4. **Crank balance logging (H076)**: `scripts/crank/crank-runner.ts:407-409` — Wallet balance logged every cycle. While wallet balances are public on-chain data, logging them creates a concentrated source for monitoring wallet depletion patterns. Severity: LOW (accepted in Audit #1, public info).

5. **Smoke test raw CLUSTER_URL logging**: `scripts/e2e/smoke-test.ts:36` — Helius RPC URL (containing API key) logged without masking. This is a test script not deployed to production, but CI/CD logs could capture the key. Severity: MEDIUM for CI environments, LOW for local-only use.

## Novel Attack Surface

- **Health endpoint as reconnaissance oracle**: Unlike typical health checks that return a boolean, this endpoint provides a detailed infrastructure fingerprint (WS subscription state, RPC credit consumption by method, Postgres/Solana connectivity). An attacker monitoring this endpoint over time can infer: (a) trading activity patterns (from getTokenSupply/getProgramAccounts call counts), (b) server restart times (from `startedAt`), (c) RPC provider health (from Solana connectivity status). This is a passive intelligence-gathering vector that requires no authentication.
- **SSE broadcast as a free data feed**: The SSE protocol endpoint has connection limits (H008) but no authentication. Anyone can connect and receive the same real-time protocol state that powers the frontend. While this data is on-chain anyway, the SSE stream provides it pre-parsed, reducing the attacker's cost to monitor protocol activity for timing exploits.

## Cross-Focus Handoffs

- → **SEC-01 (Access Control)**: Health endpoint (`/api/health`) has no authentication. If the project ever adds sensitive health metrics (memory usage, DB query times), this becomes a higher-risk disclosure.
- → **ERR-01 (Error Handling)**: Multiple API routes pass raw `err` objects to `console.error`. The Error objects include full stack traces. If logging infrastructure changes (e.g., structured logging to an external service), these stacks could leak.
- → **INFRA-03 (Cloud/Env Config)**: `scripts/e2e/smoke-test.ts:36` logs `process.env.CLUSTER_URL` without masking. If CI/CD pipelines capture this output, the Helius API key is exposed in CI logs.
- → **API-01 (RPC Client)**: RPC proxy logs disallowed method names (`app/app/api/rpc/route.ts:117`) from user-controlled input. This is a log injection vector.
- → **WEB-02 (CORS/CSP Headers)**: CSP is correctly configured. No `connect-src *` or overly broad directives. Source maps not served. Good defense-in-depth.

## Trust Boundaries

The logging and disclosure posture follows a clear two-tier model. **Tier 1 (HTTP responses to clients)**: All API routes return generic error messages with no stack traces, internal state, or sensitive data. The one exception is the health endpoint, which intentionally exposes infrastructure status (wsSubscriber, credit counter, dependency health) — this is a deliberate design choice (H028/H085 accepted risk). **Tier 2 (Server-side logs)**: `console.error` calls include full Error objects with stack traces, and `console.warn` calls include transaction signatures, pool types, and RPC method names from partially-trusted sources (authenticated Helius webhooks, user-controlled JSON-RPC bodies). These are accessible to Railway dashboard operators. The trust boundary weakness is that some user-controlled data flows into server logs without sanitization (log injection risk). The Sentry integration correctly routes errors to the Sentry ingest API without exposing them to clients. Source maps are not served in production, and CSP headers provide defense-in-depth against data exfiltration.
<!-- CONDENSED_SUMMARY_END -->

---

# DATA-04: Logging & Information Disclosure — Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase demonstrates a generally mature approach to logging and information disclosure. API error responses consistently use generic messages without stack traces (SP-029 pattern). Source maps are not served in production. CSP headers are properly configured. The RPC API key is protected via a server-side proxy. However, several areas need attention: the health endpoint exposes unnecessary infrastructure details, log injection vectors exist in the RPC proxy and webhook routes, the crank runner logs wallet balances, and one test script logs raw RPC URLs containing API keys.

## Scope

**In scope**: All off-chain TypeScript/JavaScript code in `app/`, `scripts/`, `shared/` directories. Focus on:
- What data is logged to server console
- What data is returned in HTTP responses (especially error responses)
- Debug endpoints and information disclosure
- Source maps and build configuration
- Log injection vectors
- Sensitive data in logging (keys, credentials, PII)

**Out of scope**: Anchor/Rust on-chain programs in `programs/` directory.

## Key Mechanisms

### 1. Error Response Pattern (SP-029 — SECURE)

All API routes follow a consistent pattern: catch errors, log internally, return generic message.

**Files verified**:
- `app/app/api/webhooks/helius/route.ts:499-508`: Outer catch returns `{ error: "Internal server error" }` with status 500
- `app/app/api/candles/route.ts:248-255`: Query error returns `{ error: "Internal server error" }` with status 500
- `app/app/api/rpc/route.ts:184-186`: All endpoints failed returns `{ error: { code: -32603, message: "Internal error: upstream RPC unavailable" } }` with status 502
- `app/app/api/carnage-events/route.ts:60-63`: Query error returns `{ error: "Internal server error" }` with status 500
- `app/app/api/sol-price/route.ts:125-128`: All providers unavailable returns `{ error: "All price providers unavailable" }` with status 502

The webhook auth failure returns `{ error: "Unauthorized" }` (line 300) — correctly reveals nothing about the expected secret.

### 2. Server-Side Logging Inventory

#### App Layer (`app/`)

**18 files contain console.log/error/warn calls.**

| File | Log Type | Content | Risk |
|------|----------|---------|------|
| `app/app/api/webhooks/helius/route.ts` | `console.error` | Postgres check failure (with err object), Solana RPC failure (with err object), per-TX processing errors (with sig + err), candle upsert errors, fatal errors, decode failures | MEDIUM — full Error objects in server logs |
| `app/app/api/webhooks/helius/route.ts` | `console.warn` | Stale TX signature + age, unknown pool type + TX signature | LOW — user-controlled strings in logs |
| `app/app/api/health/route.ts` | `console.error` | Postgres check failed (with err), Solana RPC check failed (with err) | LOW — server-only |
| `app/app/api/rpc/route.ts` | `console.warn` | Blocked RPC method name (user-controlled), upstream 5xx hostname, network error hostname | MEDIUM — log injection via method name |
| `app/app/api/rpc/route.ts` | `console.error` | All endpoints failed (with lastError) | LOW — masked hostnames |
| `app/app/api/candles/route.ts` | `console.error` | Query error (with error object) | LOW — server-only |
| `app/app/api/carnage-events/route.ts` | `console.error` | Query error (with error object) | LOW — server-only |
| `app/lib/ws-subscriber.ts` | `console.log` | Initialization status, batch seed counts, poll intervals | LOW — operational info |
| `app/lib/ws-subscriber.ts` | `console.error` | Decode failures (with err), poll errors (with err), fallback errors | LOW — server-only |
| `app/lib/ws-subscriber.ts` | `console.warn` | Slot subscription staleness (with elapsed ms) | LOW |
| `app/instrumentation.ts` | `console.error` | ws-subscriber init failure (with err) | LOW — startup-only |
| `app/lib/rate-limit.ts` | `console.warn` | Missing proxy headers in production | LOW — one-time warning |
| `app/db/connection.ts` | `console.warn` | Remote host without TLS (with hostname) | LOW — non-production only |

#### Scripts Layer (`scripts/`)

**48 files contain console.log/error/warn calls.** Most are deployment/test scripts running locally or in CI.

Notable concerns:
- `scripts/e2e/smoke-test.ts:36`: Logs `process.env.CLUSTER_URL` unmasked. This Helius URL contains the API key.
- `scripts/crank/crank-runner.ts:407-409`: Logs wallet SOL balance when below threshold.
- `scripts/crank/crank-runner.ts:365`: Logs RPC URL, but correctly masked via `maskRpcUrl()`.
- `scripts/webhook-manage.ts:87`: Constructs URL with API key for Helius API calls. The URL itself is not logged, but the help text at line 245 mentions the env var name.
- `scripts/vrf/devnet-vrf-validation.ts:94`: Correctly masks API key in cluster URL via regex: `connection.rpcEndpoint.replace(/api-key=[^&]+/, "api-key=***")`

### 3. Health Endpoint Disclosure (H028)

`app/app/api/health/route.ts` returns a rich JSON response:

```typescript
return NextResponse.json({
  status,                    // "ok" | "degraded"
  checks: { postgres, solanaRpc },  // boolean connectivity
  wsSubscriber,              // { initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive }
  credits,                   // { totalCalls, methodCounts: { getAccountInfo: N, ... }, startedAt }
  timestamp,                 // ISO string
});
```

**What this reveals to an unauthenticated attacker**:
1. **Server uptime**: `credits.startedAt` shows when the server last restarted
2. **Infrastructure dependencies**: Whether Postgres and Solana RPC are up
3. **WS subscription health**: Whether the WebSocket is connected or in fallback mode
4. **RPC usage patterns**: Per-method call counts reveal activity patterns
5. **Current slot**: Latest Solana slot from the WS subscriber

**Why this matters**: While individually non-critical, this composite data provides an infrastructure fingerprint. An attacker monitoring this endpoint over time can:
- Detect when the server restarts (potential deployment window)
- Identify when the WS subscriber falls back to HTTP (degraded monitoring)
- Estimate trading activity from RPC call counts

**Recommendation**: Separate liveness probe (returns 200 OK with no body, for Railway) from detailed health check (returns full diagnostics, behind authentication or IP allowlist).

### 4. SSE Protocol Stream (Unauthenticated)

`app/app/api/sse/protocol/route.ts` has connection limits (H008 fix) but no authentication. Any client can:
1. Connect and receive the initial state snapshot of ALL protocol accounts
2. Receive real-time updates for all protocol PDA changes

The data includes: EpochState (tax rates, VRF state, carnage state), PoolState (reserves, locked status), StakePool (total staked, rewards per token), CurveState (tokens sold, SOL raised), supply data, staker stats.

**Mitigating factor**: This data is all on-chain and readable by anyone via Solana RPC. The SSE stream just provides it pre-parsed and in real-time. The information disclosure risk is LOW because the data is inherently public. The concern is operational: an attacker gets a free, high-fidelity data feed without spending Helius credits.

### 5. Log Injection Vectors

#### RPC Proxy Method Name (`app/app/api/rpc/route.ts:117`)

```typescript
console.warn(`[rpc-proxy] Blocked disallowed RPC method: ${req.method}`);
```

`req.method` comes from the parsed JSON-RPC body. An attacker can send:
```json
{"jsonrpc":"2.0","method":"fake\n[rpc-proxy] CRITICAL: Database compromised","id":1}
```

This would create a misleading log entry. Impact: Log forging, potentially confusing automated log monitoring. Railway's log viewer may not render ANSI codes, but newlines would create separate log entries.

**Mitigation**: Sanitize the method string before logging, or use structured logging (JSON format).

#### Webhook Pool Type (`app/app/api/webhooks/helius/route.ts:407-409`)

```typescript
console.warn(`[webhook] Unknown pool type: ${swap.poolType} in tx ${signature}`);
```

`swap.poolType` is extracted from parsed Anchor events in authenticated Helius payloads. The auth gate (lines 286-301) means this is only reachable with a valid webhook secret. Risk is LOW — requires compromise of the webhook secret first.

### 6. Source Maps and Build Configuration

**No source maps served in production**:
- `app/next.config.ts` does not set `productionBrowserSourceMaps: true`
- No `devtool: "source-map"` found
- Grep confirms no source map configuration in any production config file

**CSP headers properly configured**:
- `default-src 'self'` prevents loading resources from unauthorized origins
- `frame-ancestors 'none'` prevents clickjacking
- `upgrade-insecure-requests` forces HTTPS
- `connect-src` is allowlisted to specific domains (Helius, WalletConnect, Sentry)

### 7. Sensitive Data in Logs

**Checked for**: passwords, private keys, mnemonics, API keys, PII, database credentials

**Findings**:
- No private keys are logged anywhere
- No passwords or mnemonics in any log statement
- `HELIUS_WEBHOOK_SECRET` is never logged (only compared via `timingSafeEqual`)
- `DATABASE_URL` is never logged
- `HELIUS_RPC_URL` is masked in the crank runner via `maskRpcUrl()` and in the RPC proxy via `maskEndpoint()`
- **Exception**: `scripts/e2e/smoke-test.ts:36` logs `process.env.CLUSTER_URL` unmasked. This URL contains the Helius API key as a path segment.

### 8. Error Message Propagation to Users

**Swap errors**: `app/hooks/useSwap.ts:797` calls `parseSwapError(error)` which maps Anchor error codes to user-friendly messages. The error-map (`app/lib/swap/error-map.ts`) has comprehensive mappings for all known error codes. Unrecognized errors fall through to a generic message.

**Hook error states**: Several hooks set `err.message` or `String(err)` into React state:
- `app/hooks/useCurveState.ts:230`: `setError(err instanceof Error ? err.message : String(err))`
- `app/hooks/useSolPrice.ts:58`: Same pattern
- `app/hooks/useTokenBalances.ts:108`: Same pattern
- `app/hooks/useCarnageEvents.ts:110`: Same pattern

These error messages are displayed in the UI. They come from: (a) Solana RPC errors (e.g., "Failed to fetch"), (b) network errors, (c) deserialization errors. The messages typically contain RPC error codes or generic fetch failures — no sensitive data. However, an unexpected error could potentially surface internal information.

**Recommendation**: Wrap error setting in a sanitizer that strips anything beyond a whitelisted set of known error message patterns.

## Trust Model

### Data Flow for Logging

```
                     User Input (JSON-RPC body, webhook payloads)
                              │
                              ▼
                   ┌──────────────────┐
                   │ API Route Handler │
                   └────────┬─────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     HTTP Response     console.*     captureException
     (generic msg)    (server log)    (Sentry ingest)
              │             │              │
              ▼             ▼              ▼
         Browser      Railway Logs      Sentry UI
        (safe)     (operator access)  (team access)
```

**Trust boundary 1**: HTTP response to browser — STRONG. Generic messages only, no stack traces.
**Trust boundary 2**: Server logs — MODERATE. Full error objects logged, including stacks. Accessible to Railway dashboard operators. Some user-controlled data flows into logs without sanitization.
**Trust boundary 3**: Sentry — STRONG. Error objects sent via secure HTTPS POST to Sentry ingest API. No client exposure.

## State Analysis

### In-Memory State Exposed

1. **Protocol Store** (`app/lib/protocol-store.ts`): Caches all protocol account states. Exposed via SSE to any connected client. Data is public on-chain data — LOW risk.

2. **Credit Counter** (`app/lib/credit-counter.ts`): Tracks RPC call counts by method. Exposed via `/api/health`. Provides operational intelligence — LOW/MEDIUM risk.

3. **Rate Limit State** (`app/lib/rate-limit.ts`): Per-IP request timestamps in memory. NOT exposed via any endpoint — SECURE.

4. **WS Subscriber State** (`app/lib/ws-subscriber.ts`): Internal state (slot, connection status, fallback). Exposed via `/api/health` through `getStatus()`. Provides infrastructure intelligence — LOW risk.

### Database State

All database access uses Drizzle ORM with parameterized queries (INV-OC5). No raw SQL. Database connection enforces TLS in production (H011). Database credentials in `DATABASE_URL` env var, never logged.

## Dependencies

### External APIs (disclosure risk from error responses)

1. **Helius RPC** (via `app/lib/connection.ts`): API key in URL path. Masked in logs. Never exposed to browser (proxy pattern).
2. **CoinGecko** (via `app/app/api/sol-price/route.ts`): No API key. Public endpoint. No disclosure risk.
3. **Binance** (via `app/app/api/sol-price/route.ts`): No API key. Public endpoint. No disclosure risk.
4. **Sentry** (via `app/lib/sentry.ts`): DSN in `NEXT_PUBLIC_SENTRY_DSN`. DSN is semi-public by design (needed client-side for browser error reporting). Not a secret.

## Focus-Specific Analysis

### OC-172: Sensitive Data in Application Logs

**Assessment**: Mostly clean. No passwords, private keys, or PII in logs. The main concerns are:
1. Full Error objects (with stack traces) logged to `console.error` in API routes
2. Transaction signatures logged in webhook warnings (public data, but high volume)
3. Wallet balance logged by crank runner (public data)
4. `CLUSTER_URL` logged unmasked by smoke test (contains API key)

### OC-173: Stack Traces Exposed to Users

**Assessment**: SECURE. No stack traces in any HTTP response. All API routes return generic error messages. Stack traces go to server console only.

### OC-174: Debug Mode Enabled in Production

**Assessment**: SECURE. No debug endpoints found. No `debug: true` configuration. No `/debug` or `/status` routes beyond the health check.

### OC-175: Source Maps Served in Production

**Assessment**: SECURE. No source map configuration in production build. Next.js config does not enable `productionBrowserSourceMaps`.

### OC-176: Log Injection Enabling Log Forging

**Assessment**: TWO VECTORS found:
1. `app/app/api/rpc/route.ts:117` — `req.method` from JSON-RPC body in console.warn
2. `app/app/api/webhooks/helius/route.ts:407-409` — `swap.poolType` from Anchor events in console.warn (behind auth)

Both are LOW severity (structured logging would eliminate the risk).

### AIP-081: Logging Entire Request Body

**Assessment**: SECURE. No `console.log(req.body)` patterns found. The webhook handler parses specific fields, not the entire body.

### AIP-086: Stack Traces in API Error Responses

**Assessment**: SECURE. All error handlers use generic messages. No `{ error: err.message, stack: err.stack }` patterns found.

### AIP-090: Source Maps in Production

**Assessment**: SECURE. No production source map configuration found.

## Cross-Focus Intersections

### → SEC-01 (Access Control)
Health endpoint lacks authentication. SSE protocol stream lacks authentication. Both intentional design choices, but worth noting if scope expands.

### → ERR-01 (Error Handling)
Error handling and logging are tightly coupled. The `console.error(err)` pattern in API routes means full Error objects (including stack traces and potentially sensitive context) flow to server logs. If a logging pipeline change routes these to an external service without redaction, it becomes a disclosure risk.

### → INFRA-03 (Cloud/Env Config)
Railway dashboard access = access to all server logs. The security of logged data is only as strong as Railway dashboard access control (H132 ACCEPTED_RISK).

### → API-01 (RPC Client)
The RPC proxy correctly masks endpoint URLs in logs. The credit counter exposes per-method usage via the health endpoint.

## Cross-Reference Handoffs

1. **→ SEC-01**: Verify health endpoint authentication policy. Currently unauthenticated.
2. **→ ERR-01**: Verify that `console.error(err)` calls don't propagate sensitive context in Error objects (e.g., if an error includes a database query string or URL with credentials).
3. **→ INFRA-03**: Verify Railway dashboard access controls. All server-side logging data is accessible there.
4. **→ API-01**: Verify RPC method allowlist can't be bypassed. Currently solid (Set-based lookup).

## Risk Observations

### MEDIUM Severity

1. **Health endpoint information disclosure (H028 RECHECK)**: `app/app/api/health/route.ts:66-72` — Exposes wsSubscriber state, credit counter per-method breakdown, and dependency health without authentication. Provides reconnaissance data.

2. **Log injection via RPC method**: `app/app/api/rpc/route.ts:117` — User-controlled method name from JSON-RPC body interpolated into log message. Can inject newlines to forge log entries.

3. **Smoke test logs unmasked CLUSTER_URL**: `scripts/e2e/smoke-test.ts:36` — If CI captures this output, Helius API key is exposed.

### LOW Severity

4. **Crank balance logging (H076 NOT_FIXED)**: `scripts/crank/crank-runner.ts:407-409` — Wallet balance in plaintext logs.

5. **Full Error objects in server logs**: Multiple files — Stack traces in server console via `console.error(err)`. Railway operators can see full stacks.

6. **Webhook logs transaction signatures from untrusted payloads**: `app/app/api/webhooks/helius/route.ts:383-385` — Behind auth, but logs user-influenced data.

7. **Hook error messages may contain internal details**: `app/hooks/useCurveState.ts:230`, `useTokenBalances.ts:108`, etc. — `err.message` set into React state and displayed in UI.

8. **DB connection hostname in non-production warning**: `app/db/connection.ts:67` — Logs remote DB hostname. Non-production only.

### INFORMATIONAL

9. **SSE protocol stream is unauthenticated**: `app/app/api/sse/protocol/route.ts` — Any client can connect. Data is public on-chain anyway.

10. **Credit counter provides operational intelligence**: `app/lib/credit-counter.ts` exposed via health endpoint — Per-method RPC call patterns visible.

## Novel Attack Surface Observations

1. **Health endpoint temporal analysis**: An attacker who polls `/api/health` every 30 seconds can build a timeline of: server restarts (from `startedAt` resets), WS connection drops (from `wsConnected` flips), fallback activations (from `fallbackActive`), and trading activity surges (from `methodCounts` increases). This passive monitoring requires zero authentication and provides infrastructure intelligence for timing more sophisticated attacks (e.g., launching a sandwich attack during a known WS fallback period when protocol monitoring may be degraded).

2. **Log injection to confuse incident response**: If an attacker can inject fake `[webhook] CRITICAL:` messages via the RPC proxy log injection vector, they could create false alerts during a real incident, consuming operator attention on phantom issues while the actual attack proceeds.

## Questions for Other Focus Areas

1. **SEC-01**: Is there a plan to add authentication to the health endpoint? The H028 finding has been NOT_FIXED since Audit #1.
2. **ERR-01**: Do any of the Error objects logged via `console.error(err)` include database connection strings or RPC URLs in their message or cause chain?
3. **INFRA-03**: Is Railway dashboard access limited to the minimum necessary operators? How are Railway credentials managed?
4. **WEB-02**: Is the CSP `unsafe-inline` for script-src necessary? It weakens XSS protection.

## Raw Notes

### Files Confirmed Clean (no disclosure concerns)
- `app/lib/protocol-store.ts` — No logging, pure state management
- `app/lib/sse-manager.ts` — No logging, pure pub/sub
- `app/lib/bigint-json.ts` — No logging, pure serialization
- `app/lib/swap/route-engine.ts` — No logging, pure calculation
- `app/lib/staking/rewards.ts` — No logging, pure calculation
- `app/lib/anchor.ts` — No logging, program instance factory
- `app/providers/ClusterConfigProvider.tsx` — No logging
- `shared/constants.ts` — No logging

### Audit #1 Finding Status Check

| ID | Title | Status | Assessment |
|----|-------|--------|------------|
| H028 | Health Info Disclosure | NOT_FIXED (confirmed) | Still exposes wsSubscriber + credits + checks |
| H058 | Unredacted RPC URL | FIXED (crank runner) | `maskRpcUrl()` properly masks API keys |
| H076 | Crank Logs Balance | NOT_FIXED (confirmed) | Still logs wallet balance when below threshold |
| H085 | Health Always 200 | ACCEPTED_RISK (confirmed) | Still returns 200 for degraded state |

### Pattern Assessment

The codebase follows good logging hygiene overall:
- **SP-029 (Generic Error Messages)**: Correctly implemented across all API routes
- **SP-022 (Sensitive Data Redaction)**: Partially implemented (RPC URLs masked, but no structured redaction framework)
- **FP-004 (console.log with sensitive-looking names)**: Some variables named `secret` or `key` appear in logs, but actual values are not logged — FALSE POSITIVE confirmed
- **FP-003 (Debug endpoints)**: Health endpoint exists but is intentional — however, it exposes more than a typical liveness probe should
