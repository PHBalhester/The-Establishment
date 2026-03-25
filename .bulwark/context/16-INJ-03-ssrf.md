---
task_id: db-phase1-INJ-03
provides: [INJ-03-findings, INJ-03-invariants]
focus_area: INJ-03
files_analyzed:
  - app/app/api/rpc/route.ts
  - app/app/api/sol-price/route.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/health/route.ts
  - app/app/api/sse/protocol/route.ts
  - app/app/api/candles/route.ts
  - app/lib/connection.ts
  - app/lib/sentry.ts
  - app/lib/ws-subscriber.ts
  - app/lib/protocol-config.ts
  - app/lib/jupiter.ts
  - app/lib/mobile-wallets.ts
  - app/hooks/useChartData.ts
  - app/hooks/useCarnageEvents.ts
  - app/hooks/useStaking.ts
  - app/hooks/useSwap.ts
  - app/providers/SettingsProvider.tsx
  - app/middleware.ts
  - app/next.config.ts
  - app/instrumentation-client.ts
  - scripts/deploy/upload-metadata.ts
  - scripts/webhook-manage.ts
  - shared/constants.ts
finding_count: 3
severity_breakdown: {critical: 0, high: 0, medium: 2, low: 1}
---
<!-- CONDENSED_SUMMARY_START -->
# INJ-03: SSRF (Server-Side Request Forgery) — Condensed Summary

## Key Findings (Top 5)

1. **RPC proxy forwards to env-var-only endpoints, no user-controlled URL**: The `/api/rpc` route forwards JSON-RPC bodies to `HELIUS_RPC_URL` / `HELIUS_RPC_URL_FALLBACK` / `NEXT_PUBLIC_RPC_URL` -- all from server-side env vars, never from request input. No classic SSRF vector. — `app/app/api/rpc/route.ts:128-132`

2. **Sentry DSN URL construction uses env var, but `captureException` accepts an optional `dsn` parameter**: The `dsn` parameter on `captureException()` could theoretically allow URL injection if called with attacker-controlled input. Currently all callers use the default (env-var path). The function constructs `https://${host}/api/${projectId}/envelope/` from the parsed DSN. — `app/lib/sentry.ts:139-221`

3. **SOL price proxy fetches hardcoded external URLs only**: `/api/sol-price` fetches from `COINGECKO_URL` and `BINANCE_URL` constants — both hardcoded. No user input flows into these URLs. — `app/app/api/sol-price/route.ts:26-31`

4. **Upload metadata verification fetches Arweave/Irys gateway with txId derived from upload receipts**: `scripts/deploy/upload-metadata.ts:274-280` constructs `https://gateway.irys.xyz/${txId}` where txId comes from the `metadataUris[key]` string split. The URI itself was just returned from Irys upload receipt. No external user input reaches this fetch. Script is admin-only CLI tool. — `scripts/deploy/upload-metadata.ts:274`

5. **Webhook-manage script constructs Helius API URL from env vars**: `scripts/webhook-manage.ts:87` builds `${HELIUS_API_BASE}${path}?api-key=${HELIUS_API_KEY}`. `HELIUS_API_BASE` is hardcoded from cluster detection, `path` is code-controlled (`/webhooks`, `/webhooks/${webhookId}`). `webhookId` comes from CLI argv. Admin-only script, no web-facing vector. — `scripts/webhook-manage.ts:87`

## Critical Mechanisms

- **RPC Proxy (`/api/rpc`)**: Accepts JSON-RPC body from browser, validates method against strict allowlist (19 methods), forwards to env-var-configured Helius endpoints. URL is never user-supplied. Body is passed through as-is. Method allowlist prevents abuse of arbitrary RPC methods. — `app/app/api/rpc/route.ts:31-59,128-148`

- **Connection Factory (`getConnection`)**: Resolves RPC URL via `resolveRpcUrl()` -- browser always gets `/api/rpc` proxy URL, server reads `HELIUS_RPC_URL` env var. An optional `rpcUrl` override parameter exists but is never called with user input (only used by internal connection setup). — `app/lib/connection.ts:30-46,54-87`

- **WS Subscriber (`ws-subscriber.ts`)**: Opens WebSocket to Helius via `getConnection()`. All outbound RPC calls use static program IDs, PDA addresses, and mint addresses from `protocol-config.ts`. No user input reaches any URL or RPC parameter. — `app/lib/ws-subscriber.ts:450-476`

- **Sentry Reporter (`sentry.ts`)**: Constructs ingest URL from parsed DSN: `https://${host}/api/${projectId}/envelope/`. DSN comes from `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN` env var (or optional `dsn` parameter). Fire-and-forget POST. — `app/lib/sentry.ts:217-231`

## Invariants & Assumptions

- INVARIANT: No API route accepts a user-supplied URL for server-side fetching — enforced across all 7 API routes (`rpc`, `sol-price`, `candles`, `carnage-events`, `health`, `sse/protocol`, `sse/candles`, `webhooks/helius`). None accept URL parameters in query/body.
- INVARIANT: RPC proxy destination URLs come exclusively from env vars (`HELIUS_RPC_URL`, `HELIUS_RPC_URL_FALLBACK`, `NEXT_PUBLIC_RPC_URL`) — enforced at `app/app/api/rpc/route.ts:128-132`
- INVARIANT: RPC method allowlist blocks all non-whitelisted JSON-RPC methods — enforced at `app/app/api/rpc/route.ts:31-59,116-123`
- ASSUMPTION: Environment variables (`HELIUS_RPC_URL`, `NEXT_PUBLIC_SENTRY_DSN`, etc.) are trusted and operator-controlled — validated by Railway deployment model
- ASSUMPTION: `getConnection(rpcUrl?)` override parameter is never called with user input — UNVALIDATED (grep confirms only called without args or with env-var values, but no compile-time enforcement)
- ASSUMPTION: The `dsn` parameter of `captureException(error, dsn?)` is never called with attacker-controlled values — validated by manual trace (all callers omit the parameter)

## Risk Observations (Prioritized)

1. **Sentry `captureException(error, dsn?)` optional DSN parameter**: `app/lib/sentry.ts:139` accepts an optional `dsn` string that overrides the env-var DSN. If any future code passes attacker-controlled input as the DSN, the function would construct a fetch URL to an attacker-controlled host (`https://${host}/api/${projectId}/envelope/`). Currently no caller uses this parameter. Medium risk due to latent SSRF surface.

2. **RPC proxy body passthrough without size limit**: `app/app/api/rpc/route.ts` parses `request.json()` then `JSON.stringify(body)` and forwards to Helius. No explicit body size limit (relies on Next.js/Railway defaults). An attacker could send a very large JSON-RPC payload. This is more DoS than SSRF, but noted as it could amplify upstream requests. Low risk — Helius has its own limits.

3. **`getConnection(rpcUrl?)` override parameter lacks type safety against SSRF**: `app/lib/connection.ts:54` accepts an optional URL override. If any module were to pass user-supplied input (e.g., from a query param), it would create a `Connection` to an attacker-controlled endpoint. Currently safe by convention, not by enforcement. Medium risk — latent surface.

## Novel Attack Surface

- **No classic SSRF vectors found**: This codebase has no URL-fetching endpoint that takes user-supplied URLs. All server-side outbound requests go to hardcoded constants or env-var-configured endpoints. The absence of features like "URL preview", "webhook tester", "image proxy", or "import from URL" means the primary SSRF attack surface does not exist.

- **Solana-specific SSRF variant (Connection override)**: The `getConnection(rpcUrl?)` function is a unique risk surface. If an attacker could influence the RPC URL (e.g., via env var injection or import override), they could redirect all on-chain reads through a malicious RPC endpoint, returning spoofed account data. This would be a Solana-specific SSRF that doesn't steal cloud credentials but instead corrupts the application's on-chain view. Currently mitigated by env-var-only configuration.

## Cross-Focus Handoffs

- → **SEC-02 (Secret & Credential Management)**: The `HELIUS_API_KEY` is embedded in the URL path for webhook-manage.ts API calls (`?api-key=${HELIUS_API_KEY}`). If logs capture the full URL, the API key leaks. Also, `HELIUS_RPC_URL` contains the Helius API key in the URL path. The `maskEndpoint()` function in rpc/route.ts only logs the hostname, but verify no other code path logs the full URL.

- → **ERR-01 (Error Handling)**: RPC proxy error messages from upstream Helius responses are forwarded to the client verbatim (`const data = await upstream.text(); return new NextResponse(data, ...)`). Helius error responses could contain internal infrastructure information. Verify Helius doesn't leak server details in error responses.

- → **INFRA-03 (Cloud/Env Config)**: All SSRF protections in this codebase rely entirely on environment variable integrity. If Railway env vars can be manipulated (admin panel compromise, CI/CD injection), every outbound connection target changes. Verify Railway env var access controls.

- → **DATA-04 (Logging & Disclosure)**: The `console.warn` in RPC proxy logs the masked endpoint hostname on failures. Verify the `maskEndpoint()` function correctly strips API keys from all URL formats (including query params, path segments, and basic auth).

## Trust Boundaries

The SSRF trust model in this codebase is straightforward and conservative. The server never fetches user-supplied URLs. All outbound HTTP requests target either (a) hardcoded constant URLs (CoinGecko, Binance, Irys gateway) or (b) environment-variable-configured endpoints (Helius RPC, Helius API, Sentry ingest). The browser communicates with the server exclusively through the 7 defined API routes, none of which accept URL parameters for server-side fetching. The RPC proxy is the closest thing to an SSRF surface, but it only forwards JSON-RPC method+params to pre-configured Helius endpoints — the destination URL is never user-controlled. The CSP `connect-src` directive in `next.config.ts` further limits which external hosts the browser can reach, but this is a defense-in-depth measure for the client, not the server.

<!-- CONDENSED_SUMMARY_END -->

---

# INJ-03: SSRF (Server-Side Request Forgery) — Full Analysis

## Executive Summary

This SSRF audit found **no exploitable SSRF vulnerabilities** in the Dr. Fraudsworth off-chain codebase. The architecture is inherently resistant to SSRF because no API route, hook, or server-side function accepts a user-supplied URL for outbound fetching. All server-side HTTP requests target either hardcoded URLs (CoinGecko, Binance, Irys/Arweave gateway) or environment-variable-configured endpoints (Helius RPC, Helius webhook API, Sentry ingest).

Three observations of **latent SSRF risk** were identified — code paths that could become SSRF vectors if future development introduces user-controlled URL input. These are documented as medium/low findings to guide secure development practices.

## Scope

### Files Analyzed (23 files)

**Server-side API routes (7 — all routes in the application):**
- `app/app/api/rpc/route.ts` — RPC JSON proxy (full read, 188 LOC)
- `app/app/api/sol-price/route.ts` — SOL price proxy (full read, 137 LOC)
- `app/app/api/webhooks/helius/route.ts` — Webhook handler (full read, 851 LOC)
- `app/app/api/health/route.ts` — Health check (full read, 73 LOC)
- `app/app/api/sse/protocol/route.ts` — Protocol SSE stream (full read, 136 LOC)
- `app/app/api/candles/route.ts` — Candle REST API (signature scan, 256 LOC)
- `app/app/api/carnage-events/route.ts` — Carnage event JSON (mentioned in INDEX, 23 LOC)

**Core libraries making outbound requests (6):**
- `app/lib/connection.ts` — RPC connection factory (full read, 87 LOC)
- `app/lib/sentry.ts` — Error reporter with fetch (full read, 235 LOC)
- `app/lib/ws-subscriber.ts` — WebSocket subscriber (full read, 496 LOC)
- `app/lib/protocol-config.ts` — Cluster address resolver (full read, 73 LOC)
- `app/lib/jupiter.ts` — SOL price helper (full read, 32 LOC)
- `app/lib/mobile-wallets.ts` — Deep link builder (full read, 32 LOC)

**Frontend hooks with fetch calls (5 — client-side, lower SSRF risk):**
- `app/hooks/useChartData.ts` — Candle chart data (signature scan)
- `app/hooks/useCarnageEvents.ts` — Carnage event polling (full read)
- `app/hooks/useStaking.ts` — Staking hook (signature scan)
- `app/hooks/useSwap.ts` — Swap hook (INDEX reference)
- `app/providers/SettingsProvider.tsx` — Priority fee fetch (signature scan)

**Scripts (2 — admin-only CLI tools):**
- `scripts/deploy/upload-metadata.ts` — Arweave upload+verify (full read, 480 LOC)
- `scripts/webhook-manage.ts` — Helius webhook CRUD (full read, 255 LOC)

**Configuration (2):**
- `app/next.config.ts` — CSP + security headers (full read, 122 LOC)
- `app/middleware.ts` — Site mode redirect (full read, 47 LOC)

### Out of Scope
- `programs/` (Anchor on-chain code)
- `tests/` (test files — no server-side request construction)
- `.next/` (build artifacts)

## Key Mechanisms

### 1. RPC Proxy — The Closest SSRF Surface

**File:** `app/app/api/rpc/route.ts`

The RPC proxy is the highest-risk file for SSRF because it forwards HTTP requests to an upstream endpoint. Analysis:

**URL construction (lines 128-132):**
```typescript
const endpoints = [
  process.env.HELIUS_RPC_URL,
  process.env.HELIUS_RPC_URL_FALLBACK,
  process.env.NEXT_PUBLIC_RPC_URL,
].filter(Boolean) as string[];
```

All three URL sources are environment variables. No `req.body`, `req.query`, or `req.params` value flows into any URL. The browser sends a JSON-RPC body (`{jsonrpc, method, params, id}`) which is validated against the method allowlist and then forwarded as the body — not as a URL.

**Method allowlist (lines 31-59):** 19 specific RPC methods are whitelisted. This prevents abuse of dangerous Helius-specific methods (e.g., `getAssetsByOwner` which could be expensive) and blocks any hypothetical RPC method that accepts URLs.

**Body passthrough (lines 139-148):** The JSON body is stringified and forwarded verbatim. This means the `params` array of each RPC call passes through unvalidated. For example, a `getAccountInfo` call with params `["<pubkey>"]` is forwarded. The params are consumed by the Helius RPC node, not by the proxy. No URL is constructed from params.

**Redirect handling:** `fetch()` in Node.js follows redirects by default (up to 20). Since the target is a hardcoded Helius endpoint, redirect-based SSRF is not relevant unless Helius itself is compromised.

**Verdict:** No SSRF. The proxy only controls which endpoint receives the request (env vars), not the content parsed as URLs.

### 2. SOL Price Proxy

**File:** `app/app/api/sol-price/route.ts`

Two hardcoded URLs:
- Line 27: `const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";`
- Line 30: `const BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";`

No query params, request body, or user input of any kind flows into these URLs. The route only accepts a GET request with no parameters (the `request` object is used solely for rate limiting via `getClientIp(request)`).

**Verdict:** No SSRF. Pure server-to-server proxy with hardcoded destinations.

### 3. Sentry Error Reporter

**File:** `app/lib/sentry.ts`

The `captureException` function (line 139) has a latent SSRF surface:

```typescript
export function captureException(error: unknown, dsn?: string) {
  const sentryDsn =
    dsn ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN
      : undefined);
```

If the optional `dsn` parameter is provided, it overrides the env-var DSN. The DSN is then parsed into `{key, projectId, host}` (line 149) and used to construct:

```typescript
const ingestUrl = `https://${host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`;
```

If `dsn` were attacker-controlled (e.g., `https://key@attacker.com/1`), the function would POST an error envelope to `https://attacker.com/api/1/envelope/`. The envelope contains:
- Error message and stack trace
- Server hostname
- Environment name
- Git commit SHA
- Cluster name (devnet/mainnet)
- Last 20 breadcrumbs

**Current callers:** All 14 call sites in the codebase use `captureException(error)` without the `dsn` parameter. The DSN always comes from env vars.

**Risk assessment:** Medium (latent). If any future code path passes user-controlled data as the DSN, it becomes an SSRF with data exfiltration of error context. Recommend removing the `dsn` parameter or adding validation.

### 4. Connection Factory

**File:** `app/lib/connection.ts`

```typescript
export function getConnection(rpcUrl?: string): Connection {
  const url = resolveRpcUrl(rpcUrl);
  ...
  cachedConnection = new Connection(url, connectionConfig);
}
```

The `rpcUrl` optional parameter could redirect all Solana RPC calls to an attacker-controlled endpoint. All current callers:
- `app/lib/ws-subscriber.ts:462` — `getConnection()` (no args)
- `app/app/api/health/route.ts:52` — `getConnection()` (no args)
- Various hooks — `getConnection()` (no args)

No caller passes user input. The function is safe by convention.

**Risk assessment:** Medium (latent). Same pattern as Sentry DSN — safe now, could become SSRF if misused.

### 5. WebSocket Subscriber

**File:** `app/lib/ws-subscriber.ts`

All outbound requests use `getConnection()` (no override) and static address constants from `protocol-config.ts`. The subscriber:
- Connects WebSocket to Helius for slot changes (line 256)
- Polls `getTokenSupply()` with hardcoded mint pubkeys (lines 168-171)
- Polls `getProgramAccounts()` with hardcoded staking program ID (lines 195-207)
- Batch-fetches `getMultipleAccountsInfo()` with hardcoded PDA pubkeys (line 115)

No user input flows into any RPC call, URL, or connection parameter.

**Verdict:** No SSRF.

### 6. Webhook Handler (Inbound Only)

**File:** `app/app/api/webhooks/helius/route.ts`

This route *receives* HTTP requests from Helius — it does not make outbound requests. The handler:
- Validates `Authorization` header against `HELIUS_WEBHOOK_SECRET`
- Parses JSON payload from Helius
- Writes to Postgres via Drizzle ORM (parameterized)
- Broadcasts via SSE manager (in-memory pub/sub)

No `fetch()` calls exist in this file. No outbound HTTP requests are made.

**Verdict:** No SSRF.

### 7. Frontend Hooks (Client-Side)

Frontend hooks make `fetch()` calls to first-party API routes:
- `useCarnageEvents.ts:102` — `fetch("/api/carnage-events")`
- `useChartData.ts:140` — `fetch(\`/api/candles?pool=${encodeURIComponent(pool)}&...\`)`
- `SettingsProvider.tsx:125` — `fetch('/api/rpc', ...)` (JSON-RPC body)
- `SwapStation.tsx:101` — `fetch('/api/sol-price')`

These are browser-to-server calls (client-side SSRF is not possible — the browser is the attacker's machine). The `useChartData` hook does include a `pool` parameter from application state in the URL, but this is a query parameter to the app's own `/api/candles` route, not a server-side fetch target.

**Verdict:** No SSRF (client-side context).

### 8. Admin Scripts

**`scripts/deploy/upload-metadata.ts`:**
- Irys SDK upload (line 168) — goes to Irys CDN
- Verification fetch (line 280) — `fetch(\`https://gateway.irys.xyz/${txId}\`)` where `txId` is extracted from the upload receipt (line 274). Not user-controlled.

**`scripts/webhook-manage.ts`:**
- `heliusRequest()` (line 87) — URL built from hardcoded `HELIUS_API_BASE` + code-controlled `path`. The `webhookId` in `updateWebhook`/`deleteWebhook` comes from CLI `process.argv[3]`. Admin-only, no web-facing vector.

**Verdict:** No SSRF. Both are CLI admin tools that don't accept untrusted input.

## Trust Model

### SSRF Trust Zones

| Zone | Description | SSRF Risk |
|------|-------------|-----------|
| **Browser → API routes** | Browser calls `/api/*` endpoints. No URL params control server-side fetch targets. | None |
| **API routes → Helius** | RPC proxy forwards to env-var endpoints. Method allowlist controls what operations. | None (env-var trust) |
| **API routes → Price APIs** | Hardcoded CoinGecko/Binance URLs. | None |
| **API routes → Postgres** | Drizzle ORM (no HTTP involved). | N/A |
| **API routes → Sentry** | DSN from env var constructs ingest URL. | Latent (via `dsn` param) |
| **WS subscriber → Helius** | WebSocket + HTTP polling to env-var endpoint. All query params are static. | None (env-var trust) |
| **Admin scripts → Irys/Helius** | CLI tools with operator-controlled inputs. | None (admin context) |

### Key Trust Assumption

**All SSRF protection relies on environment variable integrity.** There is no URL allowlist, no IP blocklist, no DNS resolution check. If an attacker can modify `HELIUS_RPC_URL`, `NEXT_PUBLIC_SENTRY_DSN`, or any other URL-containing env var, they control every outbound request. This is acceptable for a Railway-hosted application (env vars are admin-controlled), but would need additional hardening if the deployment model changed.

## State Analysis

No persistent state (database, cache, session) contains URL targets. All outbound request URLs are derived from:
1. Hardcoded constants in source code
2. Environment variables loaded at startup
3. Irys upload receipt IDs (admin scripts only)

## Dependencies

### External HTTP targets (server-side):
| Target | Source of URL | Auth | Protocol |
|--------|--------------|------|----------|
| Helius RPC | `HELIUS_RPC_URL` env var | API key in URL path | HTTPS |
| Helius RPC fallback | `HELIUS_RPC_URL_FALLBACK` env var | API key in URL path | HTTPS |
| CoinGecko API | Hardcoded constant | None | HTTPS |
| Binance API | Hardcoded constant | None | HTTPS |
| Sentry ingest | `NEXT_PUBLIC_SENTRY_DSN` env var | Key in query param | HTTPS |
| Helius webhook API | Hardcoded base + env API key | API key in query param | HTTPS |
| Irys/Arweave gateway | Hardcoded `https://gateway.irys.xyz` | None | HTTPS |

All targets use HTTPS. No HTTP connections. No custom protocols (file://, gopher://, etc.).

## Focus-Specific Analysis

### OC-057: SSRF to Cloud Metadata (169.254.169.254)

**Applicable?** No. There is no code path where a user-supplied URL is fetched server-side. The cloud metadata endpoint `169.254.169.254` is unreachable via any request the application makes.

**Even in the latent risk scenarios:** If the `captureException(error, dsn)` DSN parameter were attacker-controlled, it would construct `https://{host}/api/{projectId}/envelope/` — the `https://` scheme enforcement in the URL constructor prevents `http://169.254.169.254`.

Railway's deployment environment (containers on shared infrastructure) may or may not have IMDS access. This is an infrastructure concern, not an application-level SSRF.

### OC-058: SSRF to Internal Services

**Applicable?** No. Same reasoning as OC-057. No user-controlled URLs reach `fetch()`.

**Railway network context:** Railway containers run in an isolated network. Even if an SSRF existed, internal service discovery would be limited. However, `DATABASE_URL` (Postgres connection string) is in environment variables — if SSRF could exfiltrate env vars, that would be catastrophic.

### OC-059: SSRF via Redirect Following

**Applicable?** Partially relevant for defense-in-depth analysis.

The `fetch()` calls in `sol-price/route.ts` use default redirect behavior (follow). Since these target hardcoded URLs (CoinGecko, Binance), an attacker cannot exploit redirect following. However:

- If CoinGecko or Binance were compromised and returned a redirect to `http://169.254.169.254`, Node's `fetch()` would follow it.
- Mitigation: Both calls use `AbortSignal.timeout(5_000)` which limits the damage window.
- Risk: Extremely low. Third-party API compromise is a different threat model.

The `upload-metadata.ts:280` verification fetch uses `{ redirect: "follow" }` explicitly. Since the target is `https://gateway.irys.xyz/${txId}` with a receipt-derived txId, redirect following is acceptable (Irys may redirect to specific CDN nodes).

### OC-060: DNS Rebinding

**Applicable?** No. DNS rebinding requires a user-supplied hostname that resolves to different IPs over time. Since all hostnames are hardcoded or from env vars, an attacker cannot supply a rebinding hostname.

### OC-061: SSRF via URL Parser Differential

**Applicable?** No. The only URL parsing in SSRF-relevant code is:
- `new URL(dsn)` in sentry.ts (env-var input)
- `new URL(url).hostname` in rpc/route.ts `maskEndpoint()` (for logging only, not for fetch)

No URL is parsed by one library and fetched by another, eliminating parser differential attacks.

### AIP-030: AI-Generated SSRF (URL Fetching Without Protection)

**Applicable?** Partially. The codebase was developed with AI assistance (Claude Code), making AIP-030 relevant. However, the architecture avoided the classic AI pitfall: no endpoint was created that takes a user-supplied URL and fetches it. The RPC proxy pattern (forward body to hardcoded endpoint) is inherently safer than URL-fetching patterns.

The `captureException(error, dsn?)` optional parameter is the type of convenience API that AI might suggest — "let callers override the DSN for testing" — without considering SSRF implications. This matches the AIP-030 pattern of AI generating fetch-based code without protection.

## Cross-Focus Intersections

### INJ-03 × SEC-02 (Secrets in URLs)
The Helius RPC URL format is `https://<subdomain>.helius-rpc.com/?api-key=<KEY>`. This API key is embedded in the URL. The `maskEndpoint()` function in `rpc/route.ts:72-78` extracts only the hostname for logging:

```typescript
function maskEndpoint(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
```

This correctly strips the API key. However, the `endpoints` array (line 128) contains the full URLs including API keys. If any error handling or logging accidentally includes the full URL string, the API key leaks. The `lastError` variable on line 140 could potentially include the endpoint URL in error messages from `fetch()`.

### INJ-03 × CHAIN-02 (RPC Node Trust)
If the RPC endpoint is compromised (or if `HELIUS_RPC_URL` is modified), the WS subscriber would receive spoofed on-chain data. This is a Solana-specific trust boundary: the application trusts that the configured RPC node returns accurate blockchain state. An SSRF-like attack that redirects RPC calls would have the same effect as an RPC node compromise.

### INJ-03 × WEB-02 (CSP)
The `connect-src` CSP directive in `next.config.ts:43` restricts browser-side connections:
```
connect-src 'self' wss://relay.walletconnect.com ... https://${heliusRpcDomain} wss://${heliusRpcDomain} ...
```

This limits client-side SSRF (e.g., via XSS) to only the whitelisted domains. The CSP does not affect server-side SSRF, but it's a good defense-in-depth layer.

### INJ-03 × INFRA-03 (Railway Config)
All SSRF protections depend on Railway environment variable integrity. Railway provides:
- Dashboard access control (team-based)
- Env var encryption at rest
- No public API for env var modification without authentication

If the Railway dashboard is compromised (H132: ACCEPTED_RISK), all outbound URLs can be modified.

## Cross-Reference Handoffs

| To Agent | Item | Reason |
|----------|------|--------|
| SEC-02 | `HELIUS_API_KEY` in URL path of webhook-manage.ts API calls | API key could leak if URL is logged |
| SEC-02 | `lastError` in rpc/route.ts could contain full Helius URL | Error message may include endpoint URL with API key |
| ERR-01 | RPC proxy error response forwarded verbatim to client | Helius error responses may disclose infrastructure info |
| INFRA-03 | All SSRF defense relies on env var integrity | Railway admin compromise = all outbound targets compromised |
| DATA-04 | `maskEndpoint()` must strip API keys from all URL formats | Verify no code path logs unmasked endpoint URLs |

## Risk Observations

### R-001: Latent SSRF via `captureException(error, dsn?)` — MEDIUM

**File:** `app/lib/sentry.ts:139`
**Why risky:** The optional `dsn` parameter creates a latent SSRF surface. Any future code that calls `captureException(error, userInput)` would send error data (stack traces, server hostname, commit SHA, breadcrumbs) to an attacker-controlled endpoint.
**Current status:** All 14 callers omit the `dsn` parameter. Safe by convention.
**Recommendation:** Remove the `dsn` parameter from the public API. If testing with a custom DSN is needed, use a build-time flag or separate function.

### R-002: Latent SSRF via `getConnection(rpcUrl?)` — MEDIUM

**File:** `app/lib/connection.ts:54`
**Why risky:** The optional `rpcUrl` parameter allows overriding the RPC endpoint. If any code path passes user input (e.g., from a query parameter or POST body), all Solana RPC calls would route through an attacker-controlled server. This would enable spoofed account data, which could manipulate UI displays of balances, prices, and pool reserves.
**Current status:** All callers use `getConnection()` without arguments. Safe by convention.
**Recommendation:** Remove the `rpcUrl` parameter or restrict it to a hardcoded list of known endpoints.

### R-003: No body size limit on RPC proxy — LOW

**File:** `app/app/api/rpc/route.ts:93`
**Why risky:** The route calls `request.json()` without checking `Content-Length` first. A client could send a very large JSON-RPC payload that gets parsed into memory and then forwarded to Helius. This is more DoS than SSRF, but it amplifies traffic to the upstream endpoint.
**Mitigation:** Next.js has a default body size limit (typically 1MB). Helius also rejects oversized payloads. Railway's nginx proxy likely has a body size limit.
**Recommendation:** Add an explicit `Content-Length` check (similar to the webhook route's 1MB limit at line 308).

## Novel Attack Surface Observations

### Solana RPC as SSRF Amplifier

In traditional web apps, SSRF targets are HTTP endpoints that return sensitive data. In a Solana application, the RPC endpoint is a trust anchor — the application believes whatever the RPC node tells it about blockchain state.

If an attacker could redirect the RPC connection (via env var tampering or `getConnection()` override), they could:
1. Return spoofed pool reserves → manipulate displayed prices
2. Return fake epoch state → display wrong tax rates
3. Return fabricated staker data → inflate TVL displays
4. Return spoofed token balances → trick users into incorrect transactions

This is not classic SSRF (no credential theft, no internal service access), but it's a Solana-specific trust boundary violation. The application's entire on-chain view depends on a single env-var-configured endpoint.

**Current mitigation:** The RPC URL is set once at deployment and cached as a singleton. There's no mechanism for runtime URL changes. The WS subscriber and all hooks share the same cached connection.

### Absence as a Feature

The most notable SSRF observation is what the codebase does NOT have. There is no:
- URL preview/unfurling feature
- Webhook testing endpoint
- Image proxy or avatar fetcher
- Import-from-URL functionality
- OAuth callback with URL parameters
- PDF generation from URLs
- Link shortener/redirect service

This architectural choice (whether deliberate or incidental) eliminates the primary SSRF attack surface. If any of these features are added in the future, they must include URL validation (allowlist, DNS resolution check, redirect handling).

## Questions for Other Focus Areas

1. **For CHAIN-02 (RPC Node Trust):** Does the application validate any RPC responses beyond basic schema/type checks? If Helius returned invalid data (e.g., negative reserves), would the application detect it or silently use it?

2. **For INFRA-03 (Cloud/Env Config):** What is the Railway env var access model? Can non-admin team members modify env vars? Is there an audit log for env var changes?

3. **For SEC-02 (Secrets):** Is the Helius API key (in `HELIUS_RPC_URL`) rate-limited on the Helius side? If the key leaks via logs, what's the blast radius?

4. **For ERR-01 (Error Handling):** When the RPC proxy returns an upstream Helius error to the client, does the response body ever contain the Helius URL or API key?

## Raw Notes

### Complete Outbound Fetch Inventory (Server-Side)

| File | Line | Target | User-Controlled? | Notes |
|------|------|--------|-------------------|-------|
| `app/app/api/rpc/route.ts` | 144 | `endpoint` (env var) | No | RPC proxy |
| `app/app/api/sol-price/route.ts` | 47 | `COINGECKO_URL` (const) | No | Price fetch |
| `app/app/api/sol-price/route.ts` | 65 | `BINANCE_URL` (const) | No | Price fallback |
| `app/lib/sentry.ts` | 225 | `ingestUrl` (from DSN) | Latent (via `dsn` param) | Error reporting |
| `scripts/deploy/upload-metadata.ts` | 280 | `irysUri` (from receipt) | No | Verification |
| `scripts/webhook-manage.ts` | 94 | `url` (from env + path) | No | Admin script |

### Complete WebSocket Inventory (Server-Side)

| File | Line | Target | User-Controlled? | Notes |
|------|------|--------|-------------------|-------|
| `app/lib/ws-subscriber.ts` | 256 | Helius WS (via getConnection) | No | Slot subscription |
| `app/lib/connection.ts` | 80 | `url.replace("https://", "wss://")` | Latent (via `rpcUrl` param) | WS endpoint |

### Redirect Behavior Audit

| File | Fetch Call | Redirect Policy | Risk |
|------|-----------|-----------------|------|
| `rpc/route.ts:144` | `fetch(endpoint, ...)` | Default (follow) | Low — hardcoded endpoints |
| `sol-price/route.ts:47` | `fetch(COINGECKO_URL, ...)` | Default (follow) | Low — hardcoded URL |
| `sol-price/route.ts:65` | `fetch(BINANCE_URL, ...)` | Default (follow) | Low — hardcoded URL |
| `sentry.ts:225` | `fetch(ingestUrl, ...)` | Default (follow) | Low — env-var URL |
| `upload-metadata.ts:280` | `fetch(irysUri, { redirect: "follow" })` | Explicit follow | Low — receipt-derived URL |
| `webhook-manage.ts:94` | `fetch(url, options)` | Default (follow) | Low — admin script |

None of these follow redirects from user-controlled origins. The default follow behavior is acceptable for all cases.
