---
task_id: db-phase1-auth-03-authorization
provides: [auth-03-authorization-findings, auth-03-authorization-invariants]
focus_area: authorization-access-control
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/app/api/rpc/route.ts, app/app/api/health/route.ts, app/app/api/candles/route.ts, app/app/api/sol-price/route.ts, app/app/api/carnage-events/route.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/middleware.ts, app/lib/rate-limit.ts, app/lib/sse-connections.ts, app/lib/sse-manager.ts, app/lib/protocol-store.ts, app/lib/protocol-config.ts, app/lib/ws-subscriber.ts, app/instrumentation.ts, app/next.config.ts, scripts/crank/crank-runner.ts, scripts/crank/crank-provider.ts, scripts/deploy/transfer-authority.ts, scripts/deploy/fix-carnage-wsol.ts, scripts/webhook-manage.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 5, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Authorization & Access Control -- Condensed Summary

## Key Findings (Top 10)
- **No user authentication system exists**: The entire application is a public DeFi frontend with no user accounts, sessions, JWTs, or login flows. All 8 API routes are either fully public (candles, carnage-events, sol-price, health) or gated by shared secrets (webhook) or connection caps (SSE). This is architecturally appropriate for a protocol frontend -- but it means the authorization model is entirely structural (secret-based webhook auth, rate limits, CSP) rather than identity-based. -- `app/app/api/*/route.ts`
- **Webhook is the only authenticated endpoint**: POST `/api/webhooks/helius` is the sole endpoint with secret-based auth (HELIUS_WEBHOOK_SECRET via timingSafeEqual). All other API routes have zero auth. -- `app/app/api/webhooks/helius/route.ts:266-301`
- **RPC proxy method allowlist is the strongest access control on public routes**: The `/api/rpc` proxy restricts JSON-RPC calls to 17 explicitly allowed methods, preventing abuse of the proxied Helius endpoint (e.g., no `requestAirdrop`, no `getClusterNodes`). However, `sendTransaction` is allowed, meaning anyone can use the proxy to submit arbitrary transactions via the project's Helius key. -- `app/app/api/rpc/route.ts:31-59`
- **Health endpoint discloses internal state**: `/api/health` returns WS subscriber status, RPC credit counters, Postgres connectivity, and Solana RPC status with zero authentication. This is an existing finding (H028 NOT_FIXED) confirmed still present. -- `app/app/api/health/route.ts:32-73`
- **SSE connections are capped but not authenticated**: SSE endpoints use IP-based connection limiting (10 per IP, 5000 global) but no authentication. Any client can open SSE streams and receive protocol state updates. This is by design for a public DeFi app. -- `app/lib/sse-connections.ts:23-24`
- **Rate limiting uses IP-based sliding window**: All public API routes use in-memory rate limiting keyed on `x-forwarded-for` or `x-real-ip`. The `getClientIp()` function takes the first IP from `x-forwarded-for`, which is correct for Railway's single-proxy architecture but can be spoofed in multi-proxy environments. -- `app/lib/rate-limit.ts:129-151`
- **Protocol store has no write authorization**: `protocolStore.setAccountState()` is callable from any server-side code path. Currently only the webhook handler and ws-subscriber call it, but there is no enforcement preventing other code from writing arbitrary data. -- `app/lib/protocol-store.ts:53-65`
- **Crank runner health endpoint has no auth**: The crank's `/health` HTTP endpoint (port 8080) returns operational status (consecutive errors, spending, uptime) without authentication. Mitigated by Railway not assigning a public domain. -- `scripts/crank/crank-runner.ts:163-190`
- **Middleware only implements site-mode routing**: `middleware.ts` redirects non-`/launch` routes during bonding curve phase but performs zero authentication or authorization checks. API routes are explicitly excluded from middleware. -- `app/middleware.ts:20-36`
- **Deploy scripts load keypairs from environment/files with proper validation**: `crank-provider.ts` validates keypair sources (WALLET_KEYPAIR env var > WALLET file > default). Authority transfer script validates current authority before transferring. No mass assignment or role escalation vectors. -- `scripts/crank/crank-provider.ts:34-87`, `scripts/deploy/transfer-authority.ts:194-279`

## Critical Mechanisms
- **Webhook authentication chain**: Rate limit check (IP-based, 120/min) -> fail-closed production guard (500 if no HELIUS_WEBHOOK_SECRET) -> constant-time secret comparison (timingSafeEqual with length-mismatch safe pattern) -> body size limit (1MB) -> payload parsing. This is the most security-critical access control in the off-chain code. -- `app/app/api/webhooks/helius/route.ts:255-316`
- **RPC proxy method allowlist**: Strict Set-based allowlist of 17 JSON-RPC methods. Disallowed methods are logged and rejected with 400. Batch requests have all methods validated. The `sendTransaction` inclusion is necessary for user swaps but means the proxy can submit any transaction. -- `app/app/api/rpc/route.ts:31-59,107-123`
- **SSE connection cap enforcement**: `acquireConnection(ip)` checks global count (5000) and per-IP count (10) before allowing SSE streams. Zombie connections auto-release after 30 minutes. Double-release prevented by `released` flag. -- `app/lib/sse-connections.ts:49-57`, `app/app/api/sse/protocol/route.ts:41-62`
- **Crank spending cap**: Rolling-hour SOL spending cap (0.5 SOL) with per-transaction cost tracking and circuit breaker (5 consecutive errors halt). Prevents runaway crank from draining wallet. -- `scripts/crank/crank-runner.ts:100-150`
- **Site mode middleware**: ENV-driven route lock during bonding curve phase. Redirects all non-API, non-`/launch` traffic. -- `app/middleware.ts:20-36`

## Invariants & Assumptions
- INVARIANT: Webhook requests in production MUST have a valid HELIUS_WEBHOOK_SECRET header -- enforced at `app/app/api/webhooks/helius/route.ts:272-283` (fail-closed: returns 500 if secret not configured)
- INVARIANT: RPC proxy only forwards allowlisted JSON-RPC methods -- enforced at `app/app/api/rpc/route.ts:116-122`
- INVARIANT: SSE connections are capped at 10 per IP and 5000 globally -- enforced at `app/lib/sse-connections.ts:49-52`
- INVARIANT: Crank hourly spending cannot exceed 0.5 SOL -- enforced at `scripts/crank/crank-runner.ts:139-150`
- INVARIANT: Deploy scripts verify current authority matches deployer before transferring -- enforced at `scripts/deploy/transfer-authority.ts:221-229`
- ASSUMPTION: Railway's reverse proxy correctly sets x-forwarded-for header with the real client IP -- validated at `app/lib/rate-limit.ts:131-135` / NOT validated by the app itself (trusts proxy)
- ASSUMPTION: The crank health endpoint (port 8080) is not publicly routable because Railway does not assign a public domain -- UNVALIDATED externally, relies on Railway infra config
- ASSUMPTION: All API endpoints are safe to be fully public (no user-specific data, no privileged operations) -- validated by design: all data is public protocol state
- ASSUMPTION: HELIUS_WEBHOOK_SECRET is set in Railway production environment -- UNVALIDATED at deploy time (fail-closed at runtime catches it)

## Risk Observations (Prioritized)
1. **RPC proxy `sendTransaction` allows arbitrary TX submission**: `app/app/api/rpc/route.ts:31-59` -- Any client can submit any Solana transaction through the project's Helius RPC endpoint. This consumes Helius credits and could be used as a free transaction relay. The rate limit (300/min per IP) provides some protection. Impact: credit exhaustion, potential attribution of malicious TXs to the project's RPC key.
2. **Health endpoint information disclosure**: `app/app/api/health/route.ts:62-72` -- Exposes WS subscriber internal state, RPC credit usage stats, and dependency connectivity. An attacker could use this to time attacks (e.g., wait for RPC degradation). This is H028 (NOT_FIXED from Audit #1).
3. **IP spoofing could bypass rate limits**: `app/lib/rate-limit.ts:129-135` -- If an attacker can inject a custom `x-forwarded-for` header that reaches the app (e.g., via a misconfigured CDN layer in front of Railway), they can bypass per-IP rate limits by rotating the spoofed IP. Railway's proxy should strip/overwrite this, but the app doesn't verify.
4. **Webhook replay window (300s) may be too generous**: `app/app/api/webhooks/helius/route.ts:361` -- The MAX_TX_AGE_SECONDS of 300 (5 minutes) allows replaying captured webhook payloads within that window. Since the idempotency guard (onConflictDoNothing) covers exact signature duplicates, the only risk is with new-but-old transactions. Consider reducing to 60s.
5. **No CORS configuration on API routes**: Next.js App Router applies same-origin by default, which is correct. But SSE routes and the RPC proxy could be accessed cross-origin if Next.js defaults change. Explicitly setting CORS headers would be defense-in-depth.

## Novel Attack Surface
- **RPC proxy as free transaction relay**: An attacker could build a service that routes arbitrary Solana transactions through `/api/rpc` using `sendTransaction`, effectively getting free RPC access on the project's Helius tier. The 300 req/min rate limit is per-IP, so a botnet could scale this significantly. This is unique because most DeFi frontends either expose the RPC URL directly (worse) or proxy only specific operations (better).
- **Protocol store write injection via compromised webhook**: If an attacker obtains HELIUS_WEBHOOK_SECRET, they can inject arbitrary protocol state into the in-memory store via crafted Enhanced Account Change payloads. The store broadcasts via SSE to all connected browsers, meaning all users would see falsified protocol data (fake prices, fake epoch states). The trust boundary between webhook auth and protocol store write has no secondary validation.

## Cross-Focus Handoffs
- -> **SEC-02 (Secret Management)**: HELIUS_WEBHOOK_SECRET is the only secret protecting the webhook endpoint. Verify its entropy, rotation policy, and whether it could leak via error messages, logs, or Railway environment exposure.
- -> **CHAIN-02 (Account State)**: Protocol store accepts any data written via `setAccountState()`. If the webhook handler's Anchor decoding fails (line 607-619 in route.ts), raw account data is stored with error flags -- verify this doesn't create exploitable state.
- -> **INJ-03 (SSRF)**: The `/api/rpc` proxy forwards requests to HELIUS_RPC_URL env var endpoints. Verify the endpoint list cannot be poisoned to include internal services.
- -> **INFRA-03 (Deployment)**: The crank health endpoint binds to 0.0.0.0:8080. Verify Railway's network isolation prevents external access.

## Trust Boundaries
The off-chain authorization model has three trust layers: (1) The webhook endpoint is the only truly authenticated boundary, using a shared secret for Helius-to-server communication. Its fail-closed design is robust. (2) All public-facing API routes (RPC proxy, candles, sol-price, carnage-events, health, SSE) have zero authentication by design -- they serve public protocol data and proxy blockchain operations. Their only protection is rate limiting and method allowlisting. (3) The crank runner operates in a trusted environment (Railway) with keypair-based signing authority. Its access control is physical (environment isolation) rather than cryptographic. The critical gap is that the protocol store has no write authorization beyond webhook authentication -- a compromised webhook secret would allow full state injection to all connected browsers.
<!-- CONDENSED_SUMMARY_END -->

---

# Authorization & Access Control -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase implements a public DeFi protocol frontend with no user authentication system. This is architecturally correct -- a Solana DeFi frontend needs no user accounts because identity is managed by wallet signatures at the blockchain level. The authorization model is therefore entirely structural:

1. **One authenticated endpoint** (webhook) with robust fail-closed secret comparison
2. **Rate-limited public endpoints** with IP-based throttling
3. **Connection-capped SSE streams** for real-time data
4. **Method-allowlisted RPC proxy** to protect the backend Helius key
5. **Environment-isolated crank** with spending caps and circuit breakers

No traditional auth patterns (JWT, sessions, RBAC, IDOR) exist because there are no user accounts. The audit focus shifts to: Are the structural access controls correctly implemented? Are there endpoints that SHOULD have auth but don't? Are the rate limits sufficient?

## Scope

**Files analyzed (22):**
- 8 API route handlers (all routes in `app/app/api/`)
- 1 middleware file
- 6 core infrastructure libraries (rate-limit, sse-connections, sse-manager, protocol-store, protocol-config, ws-subscriber)
- 1 instrumentation file
- 1 Next.js config
- 5 scripts (crank-runner, crank-provider, transfer-authority, fix-carnage-wsol, webhook-manage)

**Out of scope:** Anchor/Rust programs (on-chain), frontend React components (UI-only authorization is noted but not deeply analyzed), test files.

## Key Mechanisms

### 1. Webhook Authentication (app/app/api/webhooks/helius/route.ts)

The webhook is the most critical access control point. It's the sole ingress for external data that modifies server state (database writes + in-memory protocol store).

**Authentication chain (lines 256-302):**
1. Rate limit check: `checkRateLimit(clientIp, WEBHOOK_RATE_LIMIT, "webhook")` -- 120 req/min per IP
2. Fail-closed production guard: If `NODE_ENV === "production"` and `HELIUS_WEBHOOK_SECRET` is unset, returns 500
3. If secret is set: Extract `Authorization` header, perform constant-time comparison via `timingSafeEqual`
4. Length-mismatch protection: When lengths differ, compares secret against itself (prevents timing leak of length)
5. Body size limit: 1MB max (checked via Content-Length header)
6. Replay protection: Transactions older than 300 seconds are skipped

**Observations:**
- The fail-closed pattern at line 273 is correctly implemented. Missing secret = all requests rejected.
- The `timingSafeEqual` usage at line 299 is textbook correct, including the length-mismatch safe comparison.
- The Content-Length check at line 310 can be bypassed by omitting the header (chunked transfer encoding). The actual body is still read via `req.json()`, so memory usage depends on Next.js's built-in body parser limits.
- Enhanced Account Change webhooks bypass the MAX_TX_AGE_SECONDS replay check (line 379 note). This is by design since account changes don't have blockTime, but it means account data payloads have no staleness protection.

### 2. RPC Proxy Method Allowlist (app/app/api/rpc/route.ts)

**Mechanism (lines 31-59, 107-123):**
- Strict `Set`-based allowlist of 17 JSON-RPC methods
- Both single and batch requests validated
- Disallowed methods logged with console.warn and rejected with 400
- Rate limited at 300 req/min per IP

**Allowed methods include `sendTransaction`:**
This is necessary for user swap/staking operations but creates an open transaction relay. Any IP can submit any Solana transaction through the project's Helius endpoint, consuming credits.

**Allowed methods include `simulateTransaction`:**
Simulation is less concerning (read-only) but still consumes Helius credits.

**Method allowlist is appropriate and well-scoped.** No admin-level RPC methods (e.g., validator-specific calls) are included.

### 3. SSE Connection Management (app/lib/sse-connections.ts)

**Mechanism (lines 49-57):**
- Per-IP cap: 10 connections (5 tabs x 2 SSE routes)
- Global cap: 5000 connections (500 users x 2 routes x 5x headroom)
- Zombie cleanup: Auto-release after 30 minutes via setTimeout
- Double-release prevention: Boolean `released` flag

**Observations:**
- The state uses `globalThis` singleton pattern for HMR survival
- `globalCount` can theoretically drift if `releaseConnection` is called without a matching `acquireConnection` (Math.max(0, ...) prevents negative but doesn't prevent count inflation). The `released` flag in SSE routes prevents double-release, so drift is unlikely.
- There is no mechanism to detect if an IP is hoarding connections maliciously (e.g., 10 connections from a single attacker). The per-IP limit of 10 is the only defense.

### 4. Rate Limiting (app/lib/rate-limit.ts)

**Mechanism (lines 81-112):**
- Sliding window counter per IP:endpoint pair
- Timestamps array filtered to current window on each check
- Periodic cleanup (60s sweep) removes entries older than 5 minutes

**Profiles:**
- RPC: 300 req/min
- Webhook: 120 req/min
- SOL price: 30 req/min

**IP extraction (lines 129-151):**
- Takes first IP from `x-forwarded-for`, falls back to `x-real-ip`, then "unknown"
- Production warning if no proxy headers found (all requests share one bucket)
- The "unknown" fallback means if proxy headers are missing, ALL requests hit a single rate limit bucket -- this is a denial-of-service risk (one client triggers the limit for everyone)

### 5. Crank Runner Access Control (scripts/crank/crank-runner.ts)

**Mechanism:**
- Keypair loaded from WALLET_KEYPAIR env var or file (lines 40-80 in crank-provider.ts)
- Circuit breaker: 5 consecutive errors halt the crank (line 91)
- Spending cap: 0.5 SOL/hour rolling window (line 104)
- Per-top-up cap: 0.1 SOL max (line 82)
- Health endpoint: port 8080, no auth, Railway-internal only

**Observations:**
- The health endpoint at line 163-190 responds to any GET /health request with operational status. No IP restriction or auth. Relies entirely on Railway's network isolation.
- The spending cap is a defense-in-depth measure against compromised program state or bugs causing runaway transactions. The 50x headroom (0.5 SOL vs ~0.01 SOL normal) is reasonable.

### 6. Middleware (app/middleware.ts)

**Mechanism (lines 20-36):**
- Site mode toggle: NEXT_PUBLIC_SITE_MODE = "launch" redirects non-launch, non-API routes to /launch
- No authentication or authorization logic
- Matcher excludes static assets

**Observation:** The middleware explicitly passes through all `/api` routes without any checks. This is fine given the current architecture (all API routes handle their own auth), but adding a new privileged API route without per-route auth would create a gap.

### 7. Content Security Policy (app/next.config.ts)

**Mechanism (lines 31-47):**
- Strict CSP: `default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`
- `script-src 'self' 'unsafe-inline'` -- needed for Next.js style injection
- `connect-src` allowlists Helius RPC (cluster-specific), WalletConnect, Sentry
- HSTS with 2-year max-age, includeSubDomains, preload
- X-Frame-Options: DENY, X-Content-Type-Options: nosniff

**Observation:** The `'unsafe-inline'` in `script-src` is noted as necessary for Next.js but does weaken XSS protection. This is a known trade-off documented in the codebase.

## Trust Model

```
                        UNTRUSTED
                            |
    Browser Users ────> [Middleware] ─────> [API Routes]
    (wallet signs)           |                    |
                        Site mode only     Rate limit + method allowlist
                                                  |
    Helius Service ──────────────────> [Webhook Route]
    (webhook payloads)                    |
                                    Secret auth (timingSafeEqual)
                                    Fail-closed in production
                                          |
                                    [Protocol Store] ───> [SSE Broadcast]
                                    (in-memory cache)     (to all browsers)
                                          |
    Crank Runner ─────────────────> [Solana RPC]
    (Railway-isolated)             (keypair signs TXs)
         |
    Spending cap + circuit breaker
```

**Trust boundaries:**
1. **Browser -> API**: Fully untrusted. Rate limited. RPC method-restricted.
2. **Helius -> Webhook**: Semi-trusted (authenticated via shared secret). Fail-closed.
3. **Webhook -> Protocol Store**: Trusted (server-internal). No secondary auth.
4. **Protocol Store -> SSE Clients**: Fully trusted downstream (broadcasts to all browsers).
5. **Crank -> Solana**: Trusted (keypair-authenticated). Spending capped.

## State Analysis

### Protocol Store (in-memory)
- **Write access**: Webhook handler + ws-subscriber (server init)
- **Read access**: SSE routes (broadcast to all clients), health endpoint
- **No authorization on writes**: Any code path with access to the `protocolStore` import can write
- **Dedup prevents duplicate broadcasts**: Serialized comparison guards against redundant SSE pushes

### Rate Limit State (in-memory)
- **Keyed on**: `${ip}:${endpoint}` composite key
- **Cleanup**: 60-second periodic sweep of entries older than 5 minutes
- **Memory bounded**: Cleanup prevents unbounded growth

### SSE Connection State (in-memory)
- **globalThis singleton**: Survives HMR in dev
- **Global counter + per-IP map**: Dual cap enforcement
- **Zombie timeout**: 30-minute auto-release

## Dependencies (External APIs)

| Dependency | Auth Method | Scope |
|---|---|---|
| Helius RPC | API key in URL (HELIUS_RPC_URL) | Server-side only, proxied via /api/rpc |
| Helius Webhook | Shared secret (HELIUS_WEBHOOK_SECRET) | Server receives, auth at route level |
| CoinGecko API | None (public) | SOL price fetch, server-side only |
| Binance API | None (public) | SOL price fallback, server-side only |
| PostgreSQL | DATABASE_URL connection string | Server-side only |

## Focus-Specific Analysis

### Missing Authorization Checks on Endpoints

| Endpoint | Method | Auth | Rate Limit | Risk |
|---|---|---|---|---|
| `/api/webhooks/helius` | POST | HELIUS_WEBHOOK_SECRET | 120/min | LOW (well-protected) |
| `/api/rpc` | POST | None | 300/min | MEDIUM (open TX relay) |
| `/api/candles` | GET | None | None | LOW (public data) |
| `/api/carnage-events` | GET | None | None | LOW (public data) |
| `/api/sol-price` | GET | None | 30/min | LOW (proxy) |
| `/api/health` | GET | None | None | LOW-MEDIUM (info disclosure) |
| `/api/sse/protocol` | GET | None | Connection cap | LOW (public data) |
| `/api/sse/candles` | GET | None | Connection cap | LOW (public data) |

**Notable gaps:**
- `/api/candles` and `/api/carnage-events` have NO rate limiting. An attacker could make rapid DB queries.
- `/api/health` has NO rate limiting and discloses internal operational state.

### Horizontal/Vertical Privilege Escalation

Not applicable. There are no user accounts, roles, or resource ownership in the off-chain code. All data is public protocol state. The only "privileged" operation is webhook data ingestion, which is secret-gated.

### IDOR (Insecure Direct Object Reference)

Not applicable. No user-owned resources exist. The `/api/candles?pool=X` endpoint accepts a pool address parameter, but pool data is public on-chain.

### Frontend-Only Authorization

The `middleware.ts` site-mode lock redirects users to `/launch` during the bonding curve phase. This is a UX gate, not a security gate. Users can still access all API routes directly. No security-sensitive authorization decisions are made in frontend code.

### Default Deny vs Default Allow

The webhook endpoint implements **default deny** (fail-closed in production). All other endpoints implement **default allow** (no auth required). This is architecturally correct for a public DeFi protocol frontend.

## Cross-Focus Intersections

### Auth <-> Secret Management (SEC-02)
The HELIUS_WEBHOOK_SECRET is the sole authentication credential in the entire off-chain stack. Its compromise would allow arbitrary webhook payload injection. SEC-02 should verify:
- Secret entropy (is it sufficiently random?)
- Storage in Railway (is it in the secure env var store?)
- Whether error messages or logs could leak it

### Auth <-> RPC Trust (CHAIN-01, CHAIN-02)
The RPC proxy at `/api/rpc` is the primary RPC gateway for browser clients. It uses the backend Helius key. If rate limits are bypassed, an attacker could exhaust Helius credits, causing service degradation for all users.

### Auth <-> Data Pipeline (DATA-01)
The protocol store has no write authorization beyond the webhook secret. The data flow is: Helius -> webhook auth -> protocolStore.setAccountState() -> SSE broadcast. If the webhook is compromised, all downstream consumers receive poisoned data.

### Auth <-> Infrastructure (INFRA-03)
The crank health endpoint is network-isolated by Railway, not by application-level auth. This is a deployment dependency, not a code-level control.

## Cross-Reference Handoffs

| Target Focus | Item | Why |
|---|---|---|
| SEC-02 | HELIUS_WEBHOOK_SECRET entropy and lifecycle | Single auth credential for the most important endpoint |
| CHAIN-02 | Protocol store Anchor decode error handling | Failed decodes store raw data with error flag -- verify consumers handle this |
| INJ-03 | RPC proxy endpoint list poisoning | HELIUS_RPC_URL env vars define upstream -- verify no injection path |
| DATA-01 | `/api/candles` and `/api/carnage-events` have no rate limiting | DB query abuse potential |
| INFRA-03 | Crank health endpoint network isolation | Port 8080 bound to 0.0.0.0, relies on Railway |
| ERR-01 | `getClientIp` "unknown" fallback | All clients sharing one rate-limit bucket = DoS vector |
| WEB-02 | CSP unsafe-inline in script-src | Necessary for Next.js but weakens XSS protection |

## Risk Observations

### 1. RPC Proxy Open Transaction Relay (MEDIUM)
**File:** `app/app/api/rpc/route.ts:31-59`
**What:** The `sendTransaction` method is in the allowlist, enabling any client to submit arbitrary Solana transactions through the project's Helius RPC key.
**Impact:** Helius credit exhaustion (financial cost to project). Potential attribution of malicious transactions to the project's IP/key.
**Likelihood:** Possible (requires no special knowledge, just the public API URL).
**Mitigation:** Rate limiting (300/min per IP) provides partial protection. Consider whether `sendTransaction` should be restricted to only transactions containing the project's program IDs (would require TX deserialization).

### 2. Health Endpoint Information Disclosure (LOW -- existing H028)
**File:** `app/app/api/health/route.ts:62-72`
**What:** Returns WS subscriber state, RPC credit usage, Postgres/RPC connectivity status.
**Impact:** Attacker can fingerprint the infrastructure and time attacks for degraded periods.
**Likelihood:** Unlikely to directly enable an attack, but useful for reconnaissance.

### 3. IP Spoofing Could Bypass Rate Limits (MEDIUM)
**File:** `app/lib/rate-limit.ts:129-135`
**What:** Rate limiting trusts `x-forwarded-for` header. If a CDN or additional proxy is placed in front of Railway (e.g., Cloudflare) without proper header stripping, attackers can inject arbitrary IPs.
**Impact:** Complete rate limit bypass.
**Likelihood:** Depends on infrastructure configuration. Currently Railway-only (single proxy).

### 4. Missing Rate Limits on Candles and Carnage-Events Endpoints (MEDIUM)
**File:** `app/app/api/candles/route.ts`, `app/app/api/carnage-events/route.ts`
**What:** These endpoints query Postgres without rate limiting. An attacker could issue rapid queries.
**Impact:** Postgres connection pool exhaustion, degraded performance.
**Likelihood:** Possible (public endpoints, no rate limit).

### 5. Enhanced Webhook Account Data Has No Staleness Check (LOW)
**File:** `app/app/api/webhooks/helius/route.ts:525-633`
**What:** Enhanced Account Change webhooks bypass the MAX_TX_AGE_SECONDS check (which only applies to raw transaction webhooks). A replayed account change payload would overwrite the protocol store with potentially stale data.
**Impact:** Users see stale protocol state in their browsers until the next legitimate update overwrites it.
**Likelihood:** Low (requires the webhook secret).

### 6. "Unknown" IP Fallback Creates Shared Rate-Limit Bucket (MEDIUM)
**File:** `app/lib/rate-limit.ts:150`
**What:** If proxy headers are missing, all clients map to "unknown" IP and share a single rate-limit bucket. One fast client triggers the limit for all others.
**Impact:** Denial of service for all API consumers.
**Likelihood:** Unlikely in production (Railway sets headers), but could occur during misconfiguration.

### 7. Protocol Store Write Has No Authorization (LOW -- informational)
**File:** `app/lib/protocol-store.ts:53-65`
**What:** `setAccountState()` and `setAccountStateQuiet()` are public methods with no caller verification.
**Impact:** If a new code path (e.g., a new API route) accidentally calls setAccountState(), it could inject bad data.
**Likelihood:** Low (requires code change, caught in review).

## Novel Attack Surface Observations

### Free Transaction Relay via RPC Proxy
The `/api/rpc` proxy with `sendTransaction` in its allowlist creates an unusual attack surface specific to DeFi frontends. An attacker could:
1. Build a tool that routes arbitrary Solana transactions through the project's proxy
2. Benefit from the project's Helius tier (higher rate limits, better peering)
3. Potentially cause the project to exceed its Helius plan and get rate-limited

This is unique because:
- Most DeFi frontends expose the RPC URL directly in the bundle (worse for key security, but no proxy abuse)
- The method allowlist prevents RPC admin operations but not transaction abuse
- Rate limiting is per-IP, so a botnet could scale the abuse

### Webhook Compromise -> Full State Injection
If HELIUS_WEBHOOK_SECRET is compromised:
1. Attacker sends crafted Enhanced Account Change payloads
2. Webhook handler stores them in protocol store (any pubkey can be injected via `KNOWN_PROTOCOL_ACCOUNTS` check -- though unknown pubkeys are logged and skipped)
3. For known pubkeys, the Anchor decode must succeed or raw data is stored with error flag
4. SSE broadcasts the injected state to all connected browsers
5. Users see falsified protocol data (prices, epoch states, staking rewards)

The key insight: there is no secondary validation between the webhook and the protocol store. Once the auth boundary is passed, all downstream data flow is trusted.

## Questions for Other Focus Areas

1. **SEC-02**: What is the entropy and rotation policy for HELIUS_WEBHOOK_SECRET? Is it the same secret for both raw and enhanced webhooks?
2. **CHAIN-01**: Does the RPC proxy's rate limit of 300/min per IP align with the Helius plan's actual rate limit? Could a single attacker exhaust the plan?
3. **DATA-01**: Should `/api/candles` and `/api/carnage-events` have rate limits? What's the maximum query cost?
4. **INFRA-03**: Does Railway's network isolation guarantee that port 8080 on the crank service is unreachable from the public internet?
5. **ERR-01**: If the protocol store contains stale or error-flagged data, do consuming hooks (useProtocolState, usePoolPrices) handle this gracefully?

## Raw Notes

### All API Routes Audit Trail

```
POST /api/webhooks/helius   -- AUTH: secret-based (timingSafeEqual), RATE: 120/min, BODY: 1MB max
POST /api/rpc               -- AUTH: none, RATE: 300/min, METHOD: allowlist (17 methods)
GET  /api/health            -- AUTH: none, RATE: none, EXPOSURE: internal state
GET  /api/candles           -- AUTH: none, RATE: none, QUERY: pool+resolution (Drizzle ORM)
GET  /api/carnage-events    -- AUTH: none, RATE: none, QUERY: last 5 events (Drizzle ORM)
GET  /api/sol-price          -- AUTH: none, RATE: 30/min, PROXY: CoinGecko/Binance
GET  /api/sse/protocol       -- AUTH: none, RATE: connection cap (10/IP, 5000 global)
GET  /api/sse/candles        -- AUTH: none, RATE: connection cap (10/IP, 5000 global)
```

### Middleware Coverage
- Applies to: All routes except static assets (pattern in matcher config)
- Excludes: `/api/*` routes are NOT redirected in launch mode (intentional)
- Does NOT perform: Authentication, authorization, header injection

### Deploy Script Authority Handling
- `transfer-authority.ts`: Checks current authority matches deployer before transfer. Verifies post-transfer. Idempotent (skips already-transferred).
- `fix-carnage-wsol.ts`: Creates WSOL account with correct PDA owner. Writes keypair with mode 0o600 (owner-only read/write).
- `crank-provider.ts`: Loads keypair from env var (JSON array) or file path. Validates existence before use.
