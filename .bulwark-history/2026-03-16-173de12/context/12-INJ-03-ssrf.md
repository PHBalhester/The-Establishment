---
task_id: db-phase1-ssrf
provides: [ssrf-findings, ssrf-invariants]
focus_area: ssrf
files_analyzed: [app/app/api/sol-price/route.ts, app/app/api/webhooks/helius/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/app/api/sse/candles/route.ts, app/app/api/health/route.ts, app/lib/sentry.ts, app/lib/jupiter.ts, app/lib/connection.ts, app/db/connection.ts, app/components/station/DocsStation.tsx, app/components/launch/DocsModal.tsx, scripts/webhook-manage.ts, scripts/crank/crank-provider.ts, shared/programs.ts, shared/constants.ts]
finding_count: 4
severity_breakdown: {critical: 0, high: 0, medium: 1, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# SSRF (Server-Side Request Forgery) -- Condensed Summary

## Key Findings (Top 5)
- **No user-controlled URLs reach server-side fetch**: All outbound HTTP requests use hardcoded URLs or server-side env vars. No API endpoint accepts a URL parameter from the client and fetches it server-side. -- `app/app/api/sol-price/route.ts:24-29`
- **Sentry DSN parsed as URL but sourced from env only**: `parseDsn()` calls `new URL(dsn)` but `dsn` comes exclusively from `process.env.NEXT_PUBLIC_SENTRY_DSN` or `process.env.SENTRY_DSN`, never from request input. -- `app/lib/sentry.ts:14-19`
- **Helius API key hardcoded in shared constants**: The Helius API key `[REDACTED-DEVNET-HELIUS-KEY]` is hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22`, also appears as default in `scripts/webhook-manage.ts:28`. Not an SSRF finding per se, but if the key were to leak (it already has -- it's in client bundle via `NEXT_PUBLIC_RPC_URL`), an attacker could register malicious webhooks via the Helius API pointing to internal services. -- `scripts/webhook-manage.ts:28`, `shared/constants.ts:474`
- **Webhook manage script sends user-controlled webhookId in URL path**: `updateWebhook(webhookId)` and `deleteWebhook(webhookId)` interpolate CLI arguments into the Helius API URL path (`/webhooks/${webhookId}`). This is a CLI script (not externally accessible), so the attack surface is negligible. -- `scripts/webhook-manage.ts:156,164`
- **DocsStation iframe URL from env var (client-side only)**: `NEXT_PUBLIC_DOCS_URL` controls the iframe `src` in DocsStation. This is a client-side component (`'use client'`), not server-side. The iframe is sandboxed. No SSRF concern. -- `app/components/station/DocsStation.tsx:22,62`

## Critical Mechanisms
- **SOL Price Proxy** (`/api/sol-price`): Server-side route fetches from two hardcoded external APIs (CoinGecko, Binance). URLs are constants, not parameterized. 5-second timeout via `AbortSignal.timeout()`. Response validated for type before caching. -- `app/app/api/sol-price/route.ts:24-76`
- **Sentry Reporter**: Constructs ingest URL from DSN environment variable. Fire-and-forget `fetch()` to `https://${host}/api/${projectId}/envelope/`. Host extracted from DSN URL parsing. Only env-sourced, never user-sourced. -- `app/lib/sentry.ts:82-92`
- **Helius Webhook Manager**: CLI script that calls Helius REST API at hardcoded base URL `https://api.helius.xyz/v0`. API key from env or hardcoded default. Not a web-facing service. -- `scripts/webhook-manage.ts:29-71`
- **RPC Connection Factory**: Server creates Solana RPC connections using `NEXT_PUBLIC_RPC_URL` env var or hardcoded Helius devnet URL. WS endpoint derived by replacing `https://` with `wss://`. No user input in URL construction. -- `app/lib/connection.ts:31-52`
- **Health Check**: Makes outbound call to Solana RPC (`connection.getSlot()`) and Postgres (`SELECT 1`). RPC URL from env var, Postgres from `DATABASE_URL` env var. No user input. -- `app/app/api/health/route.ts:28-56`

## Invariants & Assumptions
- INVARIANT: All outbound server-side HTTP requests use hardcoded URLs or env-var-configured URLs -- enforced by code structure (no dynamic URL construction from request params)
- INVARIANT: The `/api/sol-price` route accepts no query parameters or body -- enforced at `app/app/api/sol-price/route.ts:80` (GET handler with no parameter parsing)
- INVARIANT: The `/api/candles` route accepts query params (`pool`, `resolution`, `from`, `to`, `limit`, `gapfill`) but these are used only for Postgres queries via Drizzle ORM (parameterized), never for outbound HTTP -- enforced at `app/app/api/candles/route.ts:185-253`
- ASSUMPTION: Environment variables (`DATABASE_URL`, `NEXT_PUBLIC_RPC_URL`, `CLUSTER_URL`) are trusted and not attacker-controlled -- UNVALIDATED (no URL scheme/host validation on env vars)
- ASSUMPTION: Helius API key in shared constants is acceptable for devnet use -- validated by project context (devnet only, key is rate-limited)
- ASSUMPTION: `NEXT_PUBLIC_SENTRY_DSN` is always a well-formed Sentry DSN URL -- partially validated (wrapped in try/catch at `sentry.ts:35,93`)

## Risk Observations (Prioritized)
1. **Helius API key exposure enables webhook registration to internal targets**: `shared/constants.ts:474` -- The hardcoded Helius API key is bundled into the client (via `NEXT_PUBLIC_RPC_URL` which contains the key). An attacker who extracts this key could call `POST /v0/webhooks` on the Helius API to register a webhook pointing to `http://169.254.169.254/latest/meta-data/` or internal Railway services. This is an indirect SSRF via a third-party API (Helius). Impact depends on whether Helius validates webhook URLs. Medium severity: requires external service interaction, not direct SSRF.
2. **Sentry DSN host used in outbound fetch without validation**: `app/lib/sentry.ts:82` -- If an attacker could control `NEXT_PUBLIC_SENTRY_DSN` (e.g., via env injection), they could redirect error reports to an arbitrary host. The DSN is an env var so this requires environment compromise. Low severity.
3. **RPC URL from env var used without scheme validation**: `app/lib/connection.ts:33,44` -- The `getConnection()` function blindly replaces `https://` with `wss://` in line 44. If `NEXT_PUBLIC_RPC_URL` were set to something like `http://internal-service`, the WS endpoint would become `wss://internal-service` (incorrect but not exploitable as SSRF since Connection is a Solana RPC client, not a generic HTTP client). Low severity.
4. **Webhook manage script has no URL validation on WEBHOOK_URL env var**: `scripts/webhook-manage.ts:103` -- `WEBHOOK_URL` env var is passed directly to Helius API as the webhook delivery target. A malicious env value could register a webhook pointing to internal services. But this is a CLI tool run by admins, not exposed to external users. Low severity.

## Novel Attack Surface
- **Indirect SSRF via Helius webhook registration**: The exposed Helius API key could allow an attacker to register webhooks that cause Helius to send HTTP requests to arbitrary URLs (including internal/metadata endpoints). This is a "confused deputy" SSRF where the attacker uses a third-party service (Helius) as the proxy rather than the application server directly. The practical impact depends on whether Helius validates webhook destination URLs and whether Railway's network allows metadata endpoint access.

## Cross-Focus Handoffs
- -> **SEC-01/SEC-02**: Helius API key hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22` -- exposed in client bundle. Credential exposure concern.
- -> **API-04**: Webhook handler at `app/app/api/webhooks/helius/route.ts:136-141` has optional auth (skipped if `HELIUS_WEBHOOK_SECRET` not set). Combined with the exposed Helius API key, an attacker could register a new webhook to this endpoint and inject fake transaction data.
- -> **DATA-01**: The `/api/candles` route passes user-supplied `pool` and `resolution` query params to Drizzle ORM queries. While parameterized (not SSRF), worth verifying no injection through ORM.

## Trust Boundaries
The application makes server-side outbound HTTP requests exclusively to hardcoded, well-known external APIs (CoinGecko, Binance, Helius, Sentry ingest). No API endpoint or server-side code path accepts a user-supplied URL and fetches it. The primary SSRF concern is indirect: the Helius API key is publicly exposed in the client bundle, which could allow an attacker to use the Helius API as a confused deputy to make requests to arbitrary URLs via webhook registration. All RPC and database connection URLs come from server-side environment variables, which are trusted. The trust boundary is at the environment variable layer -- if env vars are compromised, outbound request targets could be manipulated, but this is true of any application.
<!-- CONDENSED_SUMMARY_END -->

---

# SSRF (Server-Side Request Forgery) -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase has **no direct SSRF vulnerabilities**. There are zero code paths where user-supplied input (from HTTP requests, query parameters, or request bodies) is used to construct a URL for a server-side outbound HTTP request. All outbound requests target hardcoded URLs (CoinGecko, Binance) or environment-variable-configured endpoints (Helius RPC, Sentry, Postgres).

The only notable observation is an **indirect SSRF risk via the exposed Helius API key**: the key is hardcoded in shared constants and bundled into the client, potentially allowing an attacker to register webhooks via the Helius API that target internal services or cloud metadata endpoints.

## Scope

**Analyzed** (16 files):
- All 6 API routes under `app/app/api/`
- Key libraries: `sentry.ts`, `jupiter.ts`, `connection.ts`
- Database: `db/connection.ts`, `db/candle-aggregator.ts`
- Scripts: `webhook-manage.ts`, `crank-provider.ts`
- Shared: `programs.ts`, `constants.ts`
- Frontend: `DocsStation.tsx`, `DocsModal.tsx`

**Out of scope**: `programs/` (on-chain Anchor code), `.next/` build artifacts, test files.

## Key Mechanisms

### 1. SOL Price Proxy (`/api/sol-price`)

**File**: `app/app/api/sol-price/route.ts`

This is the only API route that makes outbound HTTP requests. It fetches SOL/USD prices from two hardcoded external APIs:

```
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
```

**SSRF analysis**:
- URLs are string constants defined at module level (lines 24-29)
- The `GET()` handler accepts no parameters -- no query string, no body
- `AbortSignal.timeout(5_000)` prevents slow-loris from external APIs
- Responses are type-checked (`typeof price === "number" && Number.isFinite(price)`)
- 60-second in-memory cache reduces external call frequency
- **Verdict: No SSRF risk.** URLs cannot be influenced by any external input.

### 2. Sentry Error Reporter (`lib/sentry.ts`)

**File**: `app/lib/sentry.ts`

Constructs an outbound `fetch()` to Sentry's ingest endpoint:

```typescript
const ingestUrl = `https://${host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`;
```

Where `host`, `projectId`, and `key` are extracted from a DSN string via `new URL(dsn)`.

**SSRF analysis**:
- `dsn` comes from `process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN` (line 28-31)
- No code path passes user input as the `dsn` parameter
- The `captureException()` function has an optional `dsn` parameter, but all callers use the default (env var)
- Fire-and-forget: `.catch(() => {})` swallows errors silently
- **Verdict: No SSRF risk** unless environment variables are compromised.

### 3. Helius Webhook Manager (`scripts/webhook-manage.ts`)

**File**: `scripts/webhook-manage.ts`

CLI script that calls the Helius REST API:

```typescript
const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const url = `${HELIUS_API_BASE}${path}?api-key=${HELIUS_API_KEY}`;
```

**SSRF analysis**:
- `path` values are hardcoded (`/webhooks`, `/webhooks/${webhookId}`)
- `webhookId` comes from `process.argv[3]` (CLI argument, not web input)
- `WEBHOOK_URL` env var is passed as the destination URL in webhook creation/update, but this is admin-controlled
- Not a web-facing service -- only runs manually via CLI
- **Verdict: No SSRF risk.** CLI tools are not externally accessible.

### 4. RPC Connection Factory (`lib/connection.ts`)

**File**: `app/lib/connection.ts`

Creates Solana RPC connections:

```typescript
const url = rpcUrl ?? process.env.NEXT_PUBLIC_RPC_URL ?? DEVNET_RPC_URL;
const wsEndpoint = url.replace("https://", "wss://");
```

**SSRF analysis**:
- `rpcUrl` parameter exists but is only called by `getConnection()` from `health/route.ts` without arguments (defaults to env var)
- The `Connection` object is a Solana JSON-RPC client, not a general HTTP client
- URL comes from env var or hardcoded constant
- **Verdict: No SSRF risk.**

### 5. All Other API Routes

| Route | Outbound Requests | User Input | SSRF Risk |
|-------|-------------------|------------|-----------|
| `/api/health` | Postgres `SELECT 1`, Solana `getSlot()` | None | None |
| `/api/candles` | None (Postgres only) | `pool`, `resolution`, `from`, `to`, `limit` -- all used in parameterized ORM queries | None |
| `/api/carnage-events` | None (Postgres only) | None | None |
| `/api/sse/candles` | None (SSE stream) | None | None |
| `/api/webhooks/helius` | None (receives data) | POST body (JSON array of transactions) | None |

## Trust Model

The application's outbound request trust model is straightforward:

1. **Hardcoded URLs** (CoinGecko, Binance): Fully trusted, immutable at runtime
2. **Environment variables** (RPC URL, DATABASE_URL, Sentry DSN): Trusted by convention -- set by admin during deployment
3. **Third-party API keys** (Helius): Should be server-side only but are currently exposed in client bundle
4. **User input**: Never used in URL construction for outbound requests

The weakest link is the Helius API key exposure, which creates an indirect attack surface through the Helius API itself.

## State Analysis

No databases, caches, or sessions store URLs that are later used for outbound requests. The only cached data is the SOL price cache (in-memory, lines 36-38 of `sol-price/route.ts`), which stores a numeric price, not a URL.

## Dependencies

| Dependency | Purpose | SSRF Relevance |
|------------|---------|----------------|
| `@solana/web3.js` | RPC client | Uses `Connection` class with hardcoded/env-var URLs |
| `postgres` (postgres.js) | DB driver | Connects to `DATABASE_URL` env var |
| `drizzle-orm` | ORM | Parameterized queries, no outbound HTTP |
| `next` (Next.js) | Framework | Route handlers, no SSRF-relevant middleware |

No HTTP client libraries (axios, got, node-fetch) are used. All outbound HTTP is via the global `fetch()`.

## Focus-Specific Analysis

### Pattern OC-057: SSRF to Cloud Metadata
**Not present.** No code path constructs requests to `169.254.169.254` or any IP-based URL. All URLs use hostnames. However, the indirect Helius webhook registration attack could theoretically target metadata endpoints if Helius doesn't validate webhook URLs.

### Pattern OC-058: SSRF to Internal Services
**Not present.** No user-controlled URL construction. Railway's internal network topology is unknown, but no code fetches URLs based on user input.

### Pattern OC-059: SSRF via Redirect Following
**Not relevant.** The `fetch()` calls in `sol-price/route.ts` use default redirect behavior (follow), but since URLs are hardcoded to CoinGecko/Binance, redirect following cannot be exploited.

### Pattern OC-060: DNS Rebinding
**Not relevant.** No DNS resolution of user-supplied hostnames occurs.

### Pattern OC-061: SSRF via URL Parser Differential
**Not relevant.** No user-supplied URLs are parsed.

### AI Pitfall AIP-030: URL Fetching Without SSRF Protection
**Not applicable.** The codebase does not have any endpoint that accepts `req.body.url` or similar patterns. All fetch destinations are predetermined.

## Cross-Focus Intersections

### SEC-01/SEC-02 (Secrets): Helius API Key Exposure
The Helius API key `[REDACTED-DEVNET-HELIUS-KEY]` appears in:
- `shared/constants.ts:474` (exported)
- `shared/programs.ts:22` (embedded in `DEVNET_RPC_URL` constant)
- `scripts/webhook-manage.ts:28` (default fallback)

This key is bundled into the client via `NEXT_PUBLIC_RPC_URL`. While the key is for devnet (limited risk), it enables webhook management operations on the Helius API.

### API-04 (Webhooks): Optional Auth on Webhook Endpoint
The Helius webhook handler at `app/app/api/webhooks/helius/route.ts:135-141` only validates the `Authorization` header if `HELIUS_WEBHOOK_SECRET` is set. If the env var is unset (which the code explicitly allows for local testing), any client can POST fake transaction data.

### DATA-01 (SQL Injection): Candle Aggregator Raw SQL
`app/db/candle-aggregator.ts:121-127` uses Drizzle's `sql` tagged template for `GREATEST`/`LEAST` operations in upsert. The values interpolated are numeric (`update.price`, `update.volume`) derived from parsed Anchor events, not direct user input. This is noted for DATA-01 to verify the full data flow from webhook POST body to SQL.

## Cross-Reference Handoffs

1. **SEC-01/SEC-02**: Verify that the Helius API key in `shared/constants.ts:474` is acceptable for client-side exposure. On mainnet, this key would need to be server-side only.
2. **API-04**: Investigate the optional webhook auth at `app/app/api/webhooks/helius/route.ts:136-141` -- if `HELIUS_WEBHOOK_SECRET` is unset in production, fake transaction injection is possible.
3. **DATA-01**: Trace the data flow from webhook POST body through `parseSwapEvents()` to `upsertCandlesForSwap()` to verify that the Drizzle SQL interpolations in `candle-aggregator.ts` are safe from injection via crafted log messages.

## Risk Observations

1. **MEDIUM -- Indirect SSRF via Helius API key exposure**: An attacker could extract the Helius API key from the client bundle and register webhooks targeting internal services or cloud metadata endpoints. The practical impact depends on Helius's webhook URL validation policy and Railway's network isolation. Mitigation: use a separate, restricted Helius API key for RPC-only access (no webhook management permissions).

2. **LOW -- Sentry DSN controls outbound fetch destination**: If `NEXT_PUBLIC_SENTRY_DSN` were maliciously set, error reports would go to an attacker-controlled server. Requires environment compromise. No immediate action needed.

3. **LOW -- No redirect restriction on price API fetches**: The `fetch()` calls in `sol-price/route.ts` follow redirects by default. If CoinGecko or Binance were compromised to issue redirects, the server would follow them. Mitigation (defense-in-depth): add `redirect: 'error'` to fetch options.

4. **LOW -- Webhook manage script trusts WEBHOOK_URL env var**: The CLI script passes `WEBHOOK_URL` to Helius API without validation. Admin-only tool, not externally accessible.

## Novel Attack Surface Observations

The most interesting attack vector is the "confused deputy" SSRF through Helius webhook registration. The attack chain would be:

1. Extract Helius API key from client bundle (trivial -- it's in `NEXT_PUBLIC_RPC_URL`)
2. Call Helius API `POST /v0/webhooks` with `webhookURL: "http://169.254.169.254/latest/meta-data/"`
3. Helius attempts to deliver webhook events to the metadata endpoint
4. If Railway runs on AWS/GCP and Helius's servers can reach the metadata endpoint, this could leak IAM credentials

This is speculative and depends on multiple assumptions (Helius doesn't validate URLs, Railway doesn't block metadata access, Helius servers have network access to Railway's internal network). Worth investigating as a defense-in-depth concern for mainnet.

## Questions for Other Focus Areas

1. **SEC-02**: Is the Helius API key scoped to RPC-only, or does it also allow webhook management? If the latter, this is a real concern.
2. **INFRA-03**: Does Railway block access to cloud metadata endpoints (169.254.169.254) from within containers?
3. **API-04**: Is `HELIUS_WEBHOOK_SECRET` reliably set in the Railway production environment?

## Raw Notes

- Searched for `fetch(`, `axios`, `got(`, `http.get`, `http.request`, `new URL(`, `redirect`, `proxy` across all off-chain TypeScript files
- No HTTP client libraries are installed (no axios, got, node-fetch in dependencies)
- All outbound HTTP uses native `fetch()` (Node.js 18+ built-in)
- 6 API routes total, only 1 makes outbound HTTP requests (`/api/sol-price`)
- Frontend hooks (`useChartData`, `usePoolPrices`, etc.) use `fetch()` but these are client-side calls to the app's own API routes or Solana RPC -- not server-side SSRF
- The crank runner (`scripts/crank/`) uses Solana `Connection` (RPC client) but no raw `fetch()` calls
- `scripts/graduation/graduate.ts` is a CLI script with no outbound HTTP -- only Solana RPC via `Connection`
