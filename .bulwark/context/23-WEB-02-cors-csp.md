---
task_id: db-phase1-web-02
provides: [web-02-findings, web-02-invariants]
focus_area: web-02
files_analyzed: [app/next.config.ts, app/middleware.ts, app/app/layout.tsx, app/app/api/webhooks/helius/route.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/app/api/rpc/route.ts, app/app/api/health/route.ts, app/app/api/sol-price/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/lib/rate-limit.ts, app/lib/sse-connections.ts, app/lib/sentry.ts, app/lib/connection.ts, app/lib/mobile-wallets.ts, app/components/launch/DocsModal.tsx, app/components/station/DocsStation.tsx, app/providers/providers.tsx, app/scripts/https-proxy.mjs, railway.toml, app/instrumentation.ts]
finding_count: 7
severity_breakdown: {critical: 0, high: 0, medium: 3, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# WEB-02: CORS, CSP & Security Headers -- Condensed Summary

## Key Findings (Top 7)
- **CSP script-src allows 'unsafe-inline'**: Enables inline script injection if XSS vector exists elsewhere -- `app/next.config.ts:33`
- **No explicit CORS middleware**: Relies entirely on Next.js App Router same-origin default; no allowlist or explicit CORS rejection for API routes -- all API routes in `app/app/api/`
- **SSE routes return no CSP headers on their response**: SSE streams (`/api/sse/protocol`, `/api/sse/candles`) return only `Content-Type`, `Cache-Control`, `Connection`, `X-Accel-Buffering` -- no security headers -- `app/app/api/sse/protocol/route.ts:127-135`, `app/app/api/sse/candles/route.ts:113-123`
- **iframe sandbox includes allow-same-origin + allow-scripts**: This combination allows iframe content to remove its own sandbox if it can execute arbitrary JS -- `app/components/launch/DocsModal.tsx:105`, `app/components/station/DocsStation.tsx:66`
- **HTTPS dev proxy passes all client headers unmodified**: Dev-only proxy at `scripts/https-proxy.mjs:22` forwards raw headers including Host, which could confuse origin checks in dev -- `app/scripts/https-proxy.mjs:22`
- **Health endpoint returns internal component status without auth**: Exposes wsSubscriber status, credit counter stats, and dependency connectivity publicly -- `app/app/api/health/route.ts:66-72`
- **CSP connect-src uses wildcard subdomains for Sentry**: `*.ingest.sentry.io` and `*.ingest.us.sentry.io` allow connection to any subdomain under those domains -- `app/next.config.ts:43`

## Critical Mechanisms
- **CSP policy (centralized)**: Single CSP header string in `next.config.ts:31-47`, applied to all routes via `headers()` function at `next.config.ts:82-117`. Cluster-aware: build-time `NEXT_PUBLIC_CLUSTER` env var selects Helius RPC domain and docs iframe sources. Regex `replace(/\s{2,}/g, " ").trim()` at line 89 collapses whitespace. Concern: CSP is set at build time, not at request time -- switching cluster requires rebuild.
- **Security headers bundle**: Six headers applied globally: CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy (strict-origin-when-cross-origin), Permissions-Policy (camera/mic/geo disabled), HSTS (2yr, includeSubDomains, preload) -- `app/next.config.ts:82-117`
- **Same-origin CORS default**: No CORS middleware exists. Next.js App Router does NOT add `Access-Control-Allow-Origin` by default, meaning cross-origin requests from other domains will fail browser preflight. This is secure-by-default for JSON API routes. SSE routes are same-origin only because EventSource follows same-origin policy.
- **RPC proxy pattern**: Browser RPC goes through `/api/rpc` which acts as same-origin proxy to Helius, protecting the API key. CSP `connect-src` allows the Helius RPC domain only for server-side WS connections. Browser never connects directly to Helius -- `app/lib/connection.ts:35-36`, `app/providers/providers.tsx:37-39`
- **Middleware site-mode gate**: `middleware.ts` redirects all non-/launch, non-/api routes to /launch during bonding curve phase. Does not set/modify headers -- `app/middleware.ts:20-36`

## Invariants & Assumptions
- INVARIANT: All routes receive the 6-header security bundle via next.config.ts headers() -- enforced at `app/next.config.ts:82-117`
- INVARIANT: frame-ancestors 'none' prevents clickjacking (this page cannot be embedded) -- enforced at `app/next.config.ts:40`
- INVARIANT: X-Frame-Options DENY is set globally as defense-in-depth alongside frame-ancestors -- enforced at `app/next.config.ts:92-94`
- INVARIANT: CSP object-src is 'none' (no Flash/Java plugins) -- enforced at `app/next.config.ts:37`
- INVARIANT: form-action restricted to 'self' (no cross-origin form submission) -- enforced at `app/next.config.ts:39`
- ASSUMPTION: Next.js App Router does not add Access-Control-Allow-Origin headers by default -- validated via code search; no CORS middleware exists / UNVALIDATED at runtime (relies on framework behavior)
- ASSUMPTION: Railway reverse proxy does not strip/override security headers set by Next.js -- UNVALIDATED (Railway proxy configuration not visible in codebase)
- ASSUMPTION: SSE EventSource connections follow same-origin policy, so no CORS header is needed on SSE response -- validated per spec but the SSE responses lack explicit CORS denial headers

## Risk Observations (Prioritized)
1. **CSP script-src 'unsafe-inline'**: `app/next.config.ts:33` -- Next.js needs this for style/script injection, but it weakens XSS protection. If an attacker can inject arbitrary HTML via some other vector, inline scripts will execute. Impact: XSS protection degraded.
2. **iframe sandbox allow-same-origin + allow-scripts**: `app/components/launch/DocsModal.tsx:105`, `app/components/station/DocsStation.tsx:66` -- If the docs site is compromised, sandboxed iframe can escalate: scripts can read the parent origin's cookies/storage (same-origin) and manipulate DOM. Note: docs site is first-party controlled, reducing likelihood.
3. **No CORS headers on SSE responses**: `app/app/api/sse/protocol/route.ts:127-135` -- While EventSource follows same-origin by default, a fetch()-based SSE client from a cross-origin page would succeed if the response lacks explicit CORS denial. Modern browsers enforce same-origin on EventSource, but fetch with `mode: 'cors'` would fail due to missing ACAO header (safe).
4. **Health endpoint info disclosure**: `app/app/api/health/route.ts:66-72` -- Returns wsSubscriber status, credit counter stats, and dependency connectivity without authentication. Aids reconnaissance.
5. **CSP Sentry wildcards**: `app/next.config.ts:43` -- `*.ingest.sentry.io` and `*.ingest.us.sentry.io` are broad but necessary for Sentry DSN flexibility. Attacker controlling a Sentry project could exfiltrate data via connect-src to their own ingest endpoint.
6. **Dev HTTPS proxy header passthrough**: `app/scripts/https-proxy.mjs:22` -- Passes all client headers including Host. Dev-only, but if accidentally used in staging could confuse origin-based checks.
7. **Build-time CSP cluster detection**: `app/next.config.ts:10` -- CSP is baked at build time from `NEXT_PUBLIC_CLUSTER`. If env var is wrong at build time, CSP allows wrong Helius domain. Must rebuild when switching clusters.

## Novel Attack Surface
- **SSE data injection via crafted protocol-update events**: If an attacker can trigger a Helius webhook with crafted account data (requires knowing/spoofing HELIUS_WEBHOOK_SECRET), the protocolStore pushes that data via SSE to all connected browsers. The CSP allows the SSE connection but the data itself is JSON -- no script execution vector. However, if any UI component renders SSE data as HTML (not found in this audit -- React auto-escapes), this would become XSS. Intersection with WEB-01 (XSS).
- **CSP img-src blob: allows data exfiltration**: `img-src 'self' data: blob:` at `next.config.ts:35` -- A `blob:` URL can be generated from JavaScript to exfiltrate data as an image request to `'self'`. This is standard for frontend apps that generate images (charts, avatars), but combined with `unsafe-inline` script-src, an XSS payload could create blob URLs for data exfiltration to same-origin endpoints.

## Cross-Focus Handoffs
- **WEB-01 (XSS)**: CSP script-src 'unsafe-inline' means the CSP will NOT block inline XSS payloads. WEB-01 auditor must verify no dangerouslySetInnerHTML, innerHTML, or unsanitized user content rendering exists. (Grep confirmed: none found currently.)
- **API-01 (Webhook/API)**: Webhook route at `/api/webhooks/helius` has no CORS headers but is a POST endpoint. Verify that Helius webhook delivery does not require Access-Control-Allow-Origin (it shouldn't -- server-to-server). The webhook secret is the real auth gate.
- **INFRA-03 (Railway)**: Verify Railway proxy does not strip or override security headers (HSTS, CSP, X-Frame-Options). Railway uses nginx-based proxy -- check if `X-Accel-Buffering: no` header on SSE routes is respected.
- **SEC-01 (Access Control)**: Health endpoint (`/api/health`) exposes internal status without auth. If infrastructure monitoring needs authentication, this should be gated.

## Trust Boundaries
The CSP policy creates a strong boundary between the application's origin and external domains: only specific Helius RPC endpoints, WalletConnect relay servers, Sentry ingest endpoints, and docs iframe sources are permitted. The connect-src directive is the most permissive due to the number of legitimate external services. All API routes are same-origin (no CORS middleware), meaning cross-origin JavaScript cannot call them. The iframe sandbox provides a weaker boundary for the docs site -- allow-same-origin + allow-scripts is the minimum viable sandbox for an interactive docs site but does allow the iframe content to access parent-origin resources. The HSTS preload directive provides the strongest transport-layer protection available.
<!-- CONDENSED_SUMMARY_END -->

---

# WEB-02: CORS, CSP & Security Headers -- Full Analysis

## Executive Summary

The Dr. Fraudsworth application implements a reasonably strong set of security headers via Next.js's `next.config.ts` `headers()` function. Six security headers are applied globally to all routes, including CSP, HSTS with preload, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy.

The CSP policy is cluster-aware (build-time detection) and restricts resource loading to explicit whitelists for each directive. The most notable weakness is `script-src 'unsafe-inline'` which is required by Next.js for its style injection mechanism but reduces XSS mitigation effectiveness.

No explicit CORS configuration exists -- the application relies on Next.js App Router's same-origin default, which is secure for this architecture where all browser-to-backend communication is same-origin via the `/api/rpc` proxy pattern.

## Scope

All off-chain code analyzed through the lens of CORS configuration, Content-Security-Policy, and security headers. 22 files analyzed across API routes, middleware, configuration, providers, iframe components, and supporting libraries.

## Key Mechanisms

### 1. CSP Policy Construction (`app/next.config.ts:8-47`)

The CSP is built as a template literal string with cluster-aware domain insertion:

**Build-time cluster detection** (line 10):
```
const cluster = process.env.NEXT_PUBLIC_CLUSTER || "devnet";
```
This runs at Next.js build time. The CSP is therefore baked into the build artifact. Switching from devnet to mainnet requires a rebuild.

**Directive breakdown:**

| Directive | Value | Assessment |
|-----------|-------|------------|
| `default-src` | `'self'` | Correct -- restrictive default |
| `script-src` | `'self' 'unsafe-inline'` | Weakened -- unsafe-inline allows inline scripts |
| `style-src` | `'self' 'unsafe-inline'` | Acceptable -- Next.js needs inline styles |
| `img-src` | `'self' data: blob:` | Acceptable -- blob: needed for chart/image generation |
| `font-src` | `'self'` | Correct -- self-hosted fonts only |
| `object-src` | `'none'` | Correct -- no plugin content |
| `base-uri` | `'self'` | Correct -- prevents base tag hijacking |
| `form-action` | `'self'` | Correct -- no cross-origin form submission |
| `frame-ancestors` | `'none'` | Correct -- prevents clickjacking |
| `child-src` | `'self' + docs + walletconnect` | Correct -- limited iframe sources |
| `frame-src` | `'self' + docs + walletconnect` | Correct -- matches child-src |
| `connect-src` | `'self' + walletconnect + helius + sentry` | Broad but necessary |
| `worker-src` | `'self'` | Correct |
| `manifest-src` | `'self'` | Correct |
| `upgrade-insecure-requests` | (present) | Correct -- forces HTTPS |

**Missing directives:**
- `media-src`: Not set -- falls back to `default-src 'self'`. The app has audio files (audio-manager.ts). Self-hosted audio is fine under 'self'.
- `prefetch-src`: Deprecated, not needed.

### 2. Security Header Bundle (`app/next.config.ts:82-117`)

Six headers applied to all routes via source pattern `/(.*)`

| Header | Value | Standard |
|--------|-------|----------|
| Content-Security-Policy | (see above) | Modern best practice |
| X-Frame-Options | DENY | Defense-in-depth with frame-ancestors |
| X-Content-Type-Options | nosniff | Prevents MIME sniffing |
| Referrer-Policy | strict-origin-when-cross-origin | Good balance |
| Permissions-Policy | camera=(), microphone=(), geolocation=() | Restricts device APIs |
| Strict-Transport-Security | max-age=63072000; includeSubDomains; preload | Maximum HSTS |

**Not present:**
- `X-XSS-Protection`: Deprecated, not needed (CSP replaces it). Previously cleared as not-vulnerable (H080 in Audit #1 false-positive log).
- `X-Permitted-Cross-Domain-Policies`: Legacy Flash/Silverlight header, not needed. Previously cleared (H080).
- `Cross-Origin-Opener-Policy` (COOP): Not set. Could add `same-origin` for Spectre mitigation. LOW priority.
- `Cross-Origin-Embedder-Policy` (COEP): Not set. Required for `SharedArrayBuffer` but app doesn't use it.
- `Cross-Origin-Resource-Policy` (CORP): Not set. Would prevent cross-origin embedding of this site's resources. LOW priority.

### 3. CORS Configuration

**Explicit CORS middleware: None found.**

Comprehensive search for `cors`, `Access-Control`, `origin`, `allowedOrigins` across the entire `app/` directory found no CORS middleware or explicit CORS header setting on API routes.

**Framework behavior**: Next.js App Router does NOT add `Access-Control-Allow-Origin` headers by default. This means:
- Cross-origin `fetch()` requests from other domains will fail browser preflight (no ACAO header in response)
- Same-origin requests work normally
- This is the secure default for an app where all API calls originate from the same domain

**SSE routes**: EventSource follows same-origin policy by spec. The SSE route responses set `Content-Type: text/event-stream` but no CORS headers. A cross-origin EventSource would fail. A cross-origin `fetch()` with `mode: 'cors'` would also fail due to missing ACAO header.

**Helius webhook**: Server-to-server POST from Helius. No browser involved, CORS not applicable. Auth is via `HELIUS_WEBHOOK_SECRET` in Authorization header.

**RPC proxy**: `/api/rpc` is called from same-origin browser code (`window.location.origin + "/api/rpc"`). No CORS needed.

**Previous audit status**: H115 "No CORS Configuration" was cleared as NOT_VULNERABLE in Audit #1 with note: "Next.js App Router handles CORS. Same-origin by default." This finding was NOT in the modified files list for RECHECK.

### 4. Iframe Sandbox Configuration

Two components embed documentation iframes:

**DocsModal.tsx** (line 105):
```html
<iframe src={DOCS_URL} sandbox="allow-scripts allow-same-origin allow-popups" />
```

**DocsStation.tsx** (line 66):
```html
<iframe src={DOCS_URL} sandbox="allow-scripts allow-same-origin allow-popups" />
```

The combination `allow-scripts + allow-same-origin` is the minimum viable sandbox for an interactive docs site (Nextra needs JS for navigation, and same-origin is needed for its own resource loading). However, this combination means the iframe can:
- Execute JavaScript
- Access parent's cookies/localStorage if same-origin
- Open popups

**Mitigating factors:**
- The docs URL comes from `NEXT_PUBLIC_DOCS_URL` env var (controlled by deployer) or defaults to same-origin `/docs` (DocsModal) or `http://localhost:3001` (DocsStation dev)
- frame-src CSP restricts which domains can be framed: only docs.fraudsworth.fun, fraudsworth.fun, verify.walletconnect.com/org, and dev sources
- The iframe cannot navigate the parent frame (no allow-top-navigation)
- No form submission from iframe (no allow-forms)

**Previous audit status**: H027 "Iframe Sandbox Weakness" was in the "must be re-evaluated" list because components may have been modified. Confirmed: sandbox permissions are unchanged.

### 5. Middleware (`app/middleware.ts`)

The middleware only handles site-mode routing (launch mode vs live mode). It does NOT set or modify security headers. The middleware function calls `NextResponse.redirect()` or `NextResponse.next()` without header manipulation. Security headers are applied by the `headers()` function in `next.config.ts`, which runs after middleware.

### 6. Dev HTTPS Proxy (`app/scripts/https-proxy.mjs`)

A simple HTTPS-to-HTTP reverse proxy for mobile testing. Passes all client headers unmodified (line 22: `headers: clientReq.headers`). This means the Host header from the mobile browser is forwarded to localhost:3000, which could affect origin-based checks. Dev-only tool, not deployed.

## Trust Model

```
                    CSP enforced by browser
                          |
Browser ----[same-origin]----> Next.js API Routes
  |                                |
  |  frame-ancestors: 'none'       | Server-to-server (no CORS)
  |  (cannot be embedded)          |
  |                                v
  |                         Helius RPC (connect-src)
  |                         Helius Webhook (auth: secret)
  |                         CoinGecko/Binance (server-side only)
  |
  +--[frame-src whitelist]----> Docs iframe (sandboxed)
  +--[connect-src whitelist]--> WalletConnect relay (WSS)
  +--[connect-src whitelist]--> Sentry ingest
```

**Trust assumptions:**
1. Railway reverse proxy preserves all security headers set by Next.js
2. Next.js App Router does not add ACAO headers without explicit CORS configuration
3. Helius webhook uses server-to-server communication (no browser CORS involved)
4. First-party docs site is not compromised (iframe sandbox is weak if allow-scripts + allow-same-origin)

## State Analysis

No session state, cookies, or server-side state related to CORS/CSP. Headers are stateless configuration.

The CSP policy is determined at build time (from `NEXT_PUBLIC_CLUSTER` env var). The only runtime header-related state is in:
- `app/lib/sse-connections.ts` -- tracks connection counts (not header-related)
- `app/lib/rate-limit.ts` -- returns `Retry-After` header on 429 responses

## Dependencies

- **Next.js App Router**: Handles header application via `next.config.ts headers()`. No external CORS/security middleware (no `helmet`, `cors`, etc.)
- **Railway**: Reverse proxy may affect headers. `X-Accel-Buffering: no` on SSE routes targets nginx-based Railway proxy
- **Helius**: Two domains allowed in CSP connect-src based on cluster
- **WalletConnect**: WSS relay and HTTPS explorer-api allowed in connect-src
- **Sentry**: Wildcard ingest domains allowed in connect-src

## Focus-Specific Analysis

### CSP script-src 'unsafe-inline' Risk Assessment

The `'unsafe-inline'` directive in script-src means the CSP will NOT block inline `<script>` tags or inline event handlers if injected. This is the primary CSP weakness.

**Why it's present:** Next.js injects inline scripts for hydration and style management. Without `'unsafe-inline'`, Next.js pages break.

**Mitigation options (not implemented):**
1. **Nonce-based CSP**: Next.js 16 supports `nonce` prop on `<Script>` but requires per-request nonce generation via middleware. Complex with App Router.
2. **Hash-based CSP**: Requires computing SHA-256 of each inline script at build time and including in the CSP. Next.js does not automate this.

**Current risk**: If WEB-01 auditor confirms no XSS vectors exist (no dangerouslySetInnerHTML, no innerHTML, no unsanitized user content), then 'unsafe-inline' is a defense-in-depth gap rather than an exploitable weakness. Grep confirmed: zero instances of dangerouslySetInnerHTML or innerHTML in the codebase.

### connect-src Breadth Analysis

The connect-src directive allows connections to:
- `'self'` -- same-origin API routes
- `wss://relay.walletconnect.com` -- WalletConnect v2 relay
- `wss://relay.walletconnect.org` -- WalletConnect v2 relay (alternate)
- `wss://www.walletlink.org` -- Coinbase Wallet (legacy WalletLink)
- `https://explorer-api.walletconnect.com` -- WalletConnect explorer
- `https://{heliusRpcDomain}` -- Helius RPC (cluster-specific)
- `wss://{heliusRpcDomain}` -- Helius WS (cluster-specific)
- `{heliusApiSources}` -- Helius REST API (cluster-specific, 1-2 domains)
- `https://*.ingest.sentry.io` -- Sentry ingest (wildcard)
- `https://*.ingest.us.sentry.io` -- Sentry US ingest (wildcard)

**Observation**: Browser RPC goes through `/api/rpc` proxy (same-origin). The Helius RPC/WS domains in connect-src are for server-side ws-subscriber connections that run in Node.js -- CSP does not apply to server-side fetches. These entries may be unnecessary from a CSP perspective. However, they don't weaken security because the domains are specific.

**Sentry wildcards**: `*.ingest.sentry.io` allows any `<subdomain>.ingest.sentry.io`. An attacker who controls a Sentry project could potentially exfiltrate data via connect-src. However, this requires an existing XSS vector first, and the Sentry DSN (containing the project/key) is in env vars. Acceptable risk for Sentry integration.

### frame-src / child-src Analysis

Devnet allows:
- `http://localhost:3001` -- local docs dev server
- `https://docs-drfraudsworth.up.railway.app` -- Railway docs
- `https://docs.fraudsworth.fun` -- production docs

Mainnet allows:
- `https://docs.fraudsworth.fun`
- `https://fraudsworth.fun`

Both allow:
- `https://verify.walletconnect.com`
- `https://verify.walletconnect.org`

**WalletConnect verify**: Required for WalletConnect v2 domain verification modal. These are WalletConnect-controlled domains.

**Concern**: Devnet build allows `localhost:3001` which is fine for dev. Must ensure devnet CSP is not deployed to mainnet. The cluster detection at build time (`NEXT_PUBLIC_CLUSTER || "devnet"`) defaults to devnet, meaning an unset env var = devnet CSP in production. This is mitigated by Railway having NEXT_PUBLIC_CLUSTER=mainnet set.

### SSE Route Headers

SSE routes (`/api/sse/protocol`, `/api/sse/candles`) return custom Response objects with only streaming-related headers:
```typescript
headers: {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
}
```

The global security headers from `next.config.ts headers()` should be applied BY Next.js on top of these route-specific headers. In Next.js App Router, the `headers()` config applies to all matching routes (pattern `/(.*)`). Need to verify: does Next.js merge global headers with route-specific Response headers? Per Next.js docs, yes -- `headers()` config is additive. So CSP, HSTS, etc. should be present on SSE responses.

**Risk if not merged**: SSE streams without CSP would allow a browser to load resources referenced in SSE data from any origin. Since SSE data is JSON (not HTML), this is not directly exploitable, but it's a defense-in-depth gap.

### Rate Limiting Headers

Rate-limited responses return `Retry-After` header:
- `/api/rpc` (line 87): `"Retry-After": String(rateCheck.retryAfter)`
- `/api/sol-price` (line 89): `"Retry-After": String(rateCheck.retryAfter)`
- `/api/webhooks/helius` (line 262): `"Retry-After": String(rateCheck.retryAfter)`
- `/api/sse/protocol` (line 47): `"Retry-After": "30"` (hardcoded)
- `/api/sse/candles` (line 47): `"Retry-After": "30"` (hardcoded)

These are correct and follow HTTP spec.

## Cross-Focus Intersections

### WEB-01 (XSS)
The `unsafe-inline` in script-src means CSP is NOT a safety net for XSS. WEB-01 must verify the codebase has no injection points. Current state: no dangerouslySetInnerHTML or innerHTML found.

### API-01 (Webhook/API)
The webhook route authenticates via `HELIUS_WEBHOOK_SECRET` but does not return any CORS headers. This is correct -- Helius sends webhooks server-to-server. No browser is involved.

### FE-01 (Client State)
The iframe sandbox (allow-scripts + allow-same-origin) means compromised docs content can access parent-origin localStorage. The wallet adapter stores connection state there. FE-01 should assess what sensitive data exists in localStorage.

### INFRA-03 (Railway Deployment)
Railway's reverse proxy may strip or modify headers. The `X-Accel-Buffering: no` header on SSE routes specifically targets nginx. INFRA-03 should verify Railway's proxy preserves HSTS and CSP headers.

### SEC-01 (Access Control)
Health endpoint (`/api/health`) returns internal status without authentication. H028 was flagged as LOW/NOT_FIXED in Audit #1.

## Cross-Reference Handoffs

1. **WEB-01**: Verify no XSS vectors exist since `unsafe-inline` weakens CSP protection
2. **INFRA-03**: Verify Railway proxy preserves all 6 security headers (especially HSTS preload)
3. **FE-01**: Assess localStorage contents given iframe sandbox allows same-origin access
4. **SEC-01**: Health endpoint (`/api/health`) returns internal wsSubscriber/creditCounter status without auth (H028)

## Risk Observations

### MEDIUM

1. **CSP script-src 'unsafe-inline' (M)**: `app/next.config.ts:33` -- Weakens XSS protection. If any DOM injection vector is found by WEB-01, inline scripts will execute. Next.js requires this for its runtime behavior, but a nonce-based approach would be stronger. MEDIUM because it requires another vulnerability (XSS) to be exploitable.

2. **iframe sandbox allow-scripts + allow-same-origin (M)**: `app/components/launch/DocsModal.tsx:105`, `app/components/station/DocsStation.tsx:66` -- If the first-party docs site (Nextra) is compromised, the iframe can access parent-origin resources. MEDIUM because docs site is first-party controlled and framed sources are whitelisted.

3. **CSP build-time cluster detection defaults to devnet (M)**: `app/next.config.ts:10` -- `process.env.NEXT_PUBLIC_CLUSTER || "devnet"` means an unset env var produces a devnet CSP (allowing localhost:3001 in frame-src). If deployed to mainnet without the env var, frame-src would allow localhost connections. MEDIUM because Railway env vars should be set correctly, but defense should not depend on deployment procedure.

### LOW

4. **Health endpoint info disclosure (L)**: `app/app/api/health/route.ts:66-72` -- Returns wsSubscriber status, credit counter stats, and dependency connectivity without authentication. Previously flagged as H028 (LOW, NOT_FIXED, ACCEPTED_RISK). Aids reconnaissance but does not directly enable attacks.

5. **Sentry wildcard connect-src (L)**: `app/next.config.ts:43` -- `*.ingest.sentry.io` and `*.ingest.us.sentry.io` allow connections to any Sentry ingest endpoint. An attacker with XSS + knowledge of a Sentry project could exfiltrate data. LOW because it requires prior XSS and specific knowledge.

6. **No COOP header (L)**: Cross-Origin-Opener-Policy is not set. Could provide additional protection against Spectre-class side-channel attacks. LOW because no known exploitation path in this context.

7. **Dev HTTPS proxy header passthrough (L)**: `app/scripts/https-proxy.mjs:22` -- Passes Host header unmodified. Dev-only, but should be noted. LOW because not deployed.

## Novel Attack Surface Observations

1. **CSP bypass via blob: URL and service worker**: The CSP allows `worker-src 'self'` and `img-src blob:`. An attacker with XSS (aided by `unsafe-inline`) could register a service worker from `'self'` that intercepts requests and exfiltrates data via blob URLs to same-origin endpoints. This requires an existing XSS vector and the ability to register a service worker (which needs HTTPS, available). Novel because it chains worker-src + img-src blob: + unsafe-inline.

2. **WalletConnect verify iframe as pivot**: The CSP allows `frame-src https://verify.walletconnect.com`. If WalletConnect's verify domain is compromised, the iframe could load malicious content. Combined with allow-scripts + allow-same-origin sandbox (if such a sandbox were applied -- currently only docs iframes have sandbox, WalletConnect iframe is not explicitly sandboxed in the codebase, it's handled by the wallet adapter library). This is speculative but worth noting as a third-party dependency risk.

## Questions for Other Focus Areas

- **WEB-01**: Are there any code paths where user-controlled content could be rendered as HTML? The `unsafe-inline` CSP makes this critical.
- **INFRA-03**: Does Railway's nginx proxy respect all 6 security headers? Are they visible in browser DevTools when hitting the production URL?
- **FE-01**: What data does the wallet adapter store in localStorage/sessionStorage that would be accessible to a same-origin iframe?
- **API-01**: Are there any API routes that need cross-origin access (e.g., for mobile app deep links or third-party integrations)?

## Raw Notes

### Files Not Containing WEB-02 Concerns (Confirmed Clean)
- `app/lib/audio-manager.ts` -- Comment mentions CORS for audio elements but deliberately avoids setting crossOrigin (correct for same-origin files)
- `app/lib/jupiter.ts` -- Comment explains server-side proxy pattern to avoid CORS (correct architecture)
- `app/app/api/sol-price/route.ts` -- Server-side proxy, no CORS headers needed
- All IDL type files -- No security header relevance
- `app/lib/mobile-wallets.ts` -- Uses local static files to avoid CSP issues with external CDNs (correct approach)

### Previous Audit Finding Status
- **H025** (CSP unsafe-inline XSS): Was in "must be re-evaluated" list. `next.config.ts` was modified. Finding still present: `unsafe-inline` remains in script-src.
- **H026** (Missing HSTS): FIXED. HSTS header present with 2-year max-age, includeSubDomains, preload.
- **H027** (Iframe Sandbox Weakness): Was in "must be re-evaluated" list. Sandbox permissions unchanged (allow-scripts + allow-same-origin + allow-popups).
- **H080** (No X-Permitted-Cross-Domain-Policies): Cleared as NOT_VULNERABLE (legacy header, no Flash/Silverlight).
- **H081** (connect-src Missing CoinGecko/Binance): Cleared as NOT_VULNERABLE (server-side proxy handles external API calls, browser never connects directly).
- **H115** (No CORS Configuration): Cleared as NOT_VULNERABLE (Next.js App Router same-origin default).
