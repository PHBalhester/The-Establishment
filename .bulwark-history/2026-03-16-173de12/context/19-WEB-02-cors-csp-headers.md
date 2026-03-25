---
task_id: db-phase1-cors-csp-headers
provides: [cors-csp-headers-findings, cors-csp-headers-invariants]
focus_area: cors-csp-headers
files_analyzed: [app/next.config.ts, app/lib/sentry.ts, app/lib/jupiter.ts, app/hooks/useSolPrice.ts, app/app/api/sol-price/route.ts, app/app/api/sse/candles/route.ts, app/app/api/health/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/app/api/webhooks/helius/route.ts, app/components/station/DocsStation.tsx, app/components/launch/DocsModal.tsx, app/app/layout.tsx, app/app/global-error.tsx, app/instrumentation-client.ts, app/providers/providers.tsx, app/lib/audio-manager.ts]
finding_count: 8
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# CORS, CSP & Security Headers -- Condensed Summary

## Key Findings (Top 8)
1. **CSP `script-src 'unsafe-inline'` allows inline script injection**: Negates XSS protection from CSP. Next.js style injection legitimately needs `unsafe-inline` on `style-src`, but `script-src 'unsafe-inline'` is broader than necessary -- `app/next.config.ts:9`
2. **Missing HSTS header**: No `Strict-Transport-Security` header configured anywhere. Railway serves over HTTPS but without HSTS, users on first visit or after cache expiry can be MITM'd via HTTP downgrade -- `app/next.config.ts:58-86`
3. **Webhook auth is optional (skipped when env var unset)**: `HELIUS_WEBHOOK_SECRET` auth check is bypassed if the env var is not set. If production deployment accidentally omits this var, anyone can POST crafted events that get written to the database -- `app/app/api/webhooks/helius/route.ts:135-141`
4. **SSE endpoint has no authentication**: `/api/sse/candles` accepts any connection without auth. While data is non-sensitive (public price data), it is a resource exhaustion vector -- `app/app/api/sse/candles/route.ts:38`
5. **Sentry DSN exposed in client bundle**: `NEXT_PUBLIC_SENTRY_DSN` is a public env var embedded in client JS. While Sentry DSNs are designed to be public, an attacker could flood the Sentry project with garbage events -- `app/lib/sentry.ts:30`, `app/instrumentation-client.ts:37`
6. **`connect-src` CSP missing CoinGecko and Binance API domains**: Server-side price proxy calls CoinGecko/Binance from Node.js (not browser), so CSP doesn't apply. However, if architecture changes to client-side calls, CSP would block them. Currently safe by design -- `app/next.config.ts:19`, `app/app/api/sol-price/route.ts:24-29`
7. **iframe `sandbox` allows `allow-same-origin` + `allow-scripts`**: The docs iframes use `sandbox="allow-scripts allow-same-origin allow-popups"`. The combination of `allow-scripts` + `allow-same-origin` effectively allows the embedded page to remove the sandbox itself. Mitigated by CSP `frame-ancestors 'none'` preventing reverse embedding, but the sandboxed page retains full same-origin privileges -- `app/components/station/DocsStation.tsx:66`, `app/components/launch/DocsModal.tsx:107`
8. **No `X-Permitted-Cross-Domain-Policies` header**: Minor. Flash/PDF cross-domain policy not explicitly denied. Low impact given modern browser landscape -- `app/next.config.ts:58-86`

## Critical Mechanisms
- **CSP Header Construction**: Single CSP string built in `next.config.ts:7-23`, applied to all routes via `headers()` function at `:58-86`. Whitespace-collapsed via regex replace. Covers `default-src`, `script-src`, `style-src`, `img-src`, `font-src`, `object-src`, `base-uri`, `form-action`, `frame-ancestors`, `child-src`, `frame-src`, `connect-src`, `worker-src`, `manifest-src`, `upgrade-insecure-requests`.
- **Security Header Stack**: 5 headers applied: CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy (strict-origin-when-cross-origin), Permissions-Policy (camera/mic/geo denied). Applied via Next.js `headers()` config, not middleware.
- **Sentry Outbound**: Custom zero-dependency reporter uses fire-and-forget `fetch()` to `https://{host}/api/{projectId}/envelope/`. CSP `connect-src` includes `*.ingest.sentry.io` and `*.ingest.us.sentry.io` to cover both regions -- `app/lib/sentry.ts:82-92`, `app/next.config.ts:19`.
- **SOL Price Proxy**: Server-side proxy at `/api/sol-price` fetches from CoinGecko/Binance. Client calls same-origin `/api/sol-price`. This avoids CORS issues and keeps external API calls server-side -- `app/app/api/sol-price/route.ts`.

## Invariants & Assumptions
- INVARIANT: All responses include CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy -- enforced at `app/next.config.ts:58-86`
- INVARIANT: `frame-ancestors 'none'` prevents the app from being embedded in any iframe -- enforced at `app/next.config.ts:16`
- INVARIANT: `object-src 'none'` prevents Flash/plugin-based attacks -- enforced at `app/next.config.ts:13`
- INVARIANT: `form-action 'self'` prevents form submission to external sites -- enforced at `app/next.config.ts:15`
- INVARIANT: `upgrade-insecure-requests` forces HTTPS for all subresource loads -- enforced at `app/next.config.ts:22`
- ASSUMPTION: Railway deployment enforces HTTPS at the edge -- UNVALIDATED (no HSTS header to pin this)
- ASSUMPTION: `HELIUS_WEBHOOK_SECRET` is always set in production -- UNVALIDATED (code explicitly allows skipping auth when unset)
- ASSUMPTION: External price APIs (CoinGecko, Binance) return well-formed JSON -- validated via type checks in `app/app/api/sol-price/route.ts:50-55,69-72`
- ASSUMPTION: Docs iframe content (`NEXT_PUBLIC_DOCS_URL` / Railway docs) is trusted -- partially validated by sandbox attribute, but `allow-scripts` + `allow-same-origin` weakens sandbox

## Risk Observations (Prioritized)
1. **`script-src 'unsafe-inline'` (MEDIUM)**: `app/next.config.ts:9` -- Allows execution of inline scripts. If an attacker finds any HTML injection point (even if not via `dangerouslySetInnerHTML`), inline scripts will execute. Next.js can work with nonce-based CSP instead.
2. **Missing HSTS (MEDIUM)**: `app/next.config.ts:58-86` -- No `Strict-Transport-Security` header. Without HSTS, the browser won't enforce HTTPS on subsequent visits. This enables SSL stripping attacks on first visit or after HSTS cache expiry.
3. **Optional webhook auth (HIGH in production)**: `app/app/api/webhooks/helius/route.ts:135-141` -- If `HELIUS_WEBHOOK_SECRET` is unset in production, the webhook endpoint is completely unauthenticated. An attacker could inject fake swap events, manipulate price charts, and broadcast false SSE data.
4. **Iframe sandbox weakened by `allow-scripts` + `allow-same-origin` (MEDIUM)**: `app/components/station/DocsStation.tsx:66` -- Per MDN: "When the embedded document has the same origin as the embedding page, it is strongly discouraged to use both `allow-scripts` and `allow-same-origin`, as that lets the embedded document remove the sandbox attribute."
5. **SSE endpoint open to abuse (LOW)**: `app/app/api/sse/candles/route.ts:38` -- No rate limiting or auth. An attacker could open many concurrent connections to exhaust server resources.

## Novel Attack Surface
- **Sentry envelope spam via exposed DSN**: Client-side code includes `NEXT_PUBLIC_SENTRY_DSN`. An attacker could extract the DSN from the client bundle and flood the Sentry project with fake error events, potentially exceeding quota and causing real errors to be dropped. Not a direct security vulnerability but a reliability concern.
- **Price oracle manipulation via unauthenticated webhook**: If webhook auth is misconfigured (env var unset), an attacker could POST fabricated swap events with manipulated prices. These would be written to DB, aggregated into candles, and broadcast via SSE to all connected clients -- showing fake prices in the chart. Combined with social engineering, this could manipulate trading behavior.

## Cross-Focus Handoffs
- -> **SEC-02**: Verify `HELIUS_WEBHOOK_SECRET` is set in production Railway environment variables. The webhook auth bypass when unset is a critical deployment concern.
- -> **API-04**: The webhook auth comparison at `route.ts:138` uses `===` (string equality) not timing-safe comparison. If `webhookSecret` is short, this may be vulnerable to timing attacks.
- -> **INFRA-05**: Health endpoint at `/api/health` returns dependency status (Postgres, RPC) always with HTTP 200. Could leak infrastructure topology to unauthenticated callers.
- -> **WEB-01**: `script-src 'unsafe-inline'` weakens XSS protection. Cross-reference with XSS auditor to determine if any injection vectors exist that this CSP gap enables.

## Trust Boundaries
The CSP and security header configuration establishes a strong baseline trust boundary between the app and external resources. The `connect-src` whitelist limits outbound connections to known services (WalletConnect relay, Helius RPC, Sentry ingest). The `frame-ancestors 'none'` directive prevents clickjacking. However, two gaps weaken the trust model: (1) `script-src 'unsafe-inline'` allows inline script execution, which negates CSP's primary XSS mitigation; and (2) the missing HSTS header means the HTTPS transport guarantee relies entirely on the hosting provider (Railway) rather than being enforced by the browser. The server-side price proxy correctly avoids exposing external API calls to the browser, maintaining the trust boundary between client and third-party services. The webhook endpoint's optional auth represents a trust boundary that could collapse if misconfigured.
<!-- CONDENSED_SUMMARY_END -->

---

# CORS, CSP & Security Headers -- Full Analysis

## Executive Summary

The Dr. Fraudsworth Next.js frontend implements a reasonably strong security header configuration through `next.config.ts`. CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy are all present. The major gaps are: (1) `script-src 'unsafe-inline'` which weakens XSS protection, (2) missing HSTS header, and (3) no CORS configuration needed because the app doesn't serve as a cross-origin API. The server-side price proxy pattern correctly avoids CORS issues. The webhook endpoint has an optional auth mechanism that is a deployment risk.

## Scope

All off-chain code in the `app/` directory, configuration files, and API routes. On-chain programs (`programs/`) are excluded.

**Files Analyzed (Full Read -- Layer 3):**
- `app/next.config.ts` -- CSP + security headers definition
- `app/lib/sentry.ts` -- Outbound Sentry reporting (connect-src consumer)
- `app/lib/jupiter.ts` -- SOL price fetch helper
- `app/hooks/useSolPrice.ts` -- SOL price polling hook
- `app/app/api/sol-price/route.ts` -- Server-side price proxy
- `app/app/api/sse/candles/route.ts` -- SSE streaming endpoint
- `app/app/api/health/route.ts` -- Health check endpoint
- `app/app/api/candles/route.ts` -- Candle REST API
- `app/app/api/carnage-events/route.ts` -- Carnage events API
- `app/app/api/webhooks/helius/route.ts` -- Webhook handler (auth check)
- `app/components/station/DocsStation.tsx` -- Docs iframe with sandbox
- `app/components/launch/DocsModal.tsx` -- Launch page docs iframe
- `app/app/layout.tsx` -- Root layout
- `app/app/global-error.tsx` -- Global error boundary
- `app/instrumentation-client.ts` -- Client instrumentation (Sentry setup)
- `app/providers/providers.tsx` -- Provider tree

**Files Scanned (Layer 2 -- signatures only):**
- `app/lib/audio-manager.ts` -- crossOrigin comment noted
- `app/hooks/useCarnageEvents.ts` -- same-origin fetch
- `app/hooks/useChartData.ts` -- same-origin fetch

## Key Mechanisms

### 1. CSP Header Construction (`app/next.config.ts:7-23`)

The CSP is built as a template literal string with each directive on its own line, then whitespace-collapsed before being set as a header. Applied to all routes via `source: "/(.*)"`.

**Directive-by-directive analysis:**

| Directive | Value | Assessment |
|-----------|-------|------------|
| `default-src` | `'self'` | Good -- restrictive default |
| `script-src` | `'self' 'unsafe-inline'` | CONCERN -- `unsafe-inline` weakens XSS protection |
| `style-src` | `'self' 'unsafe-inline'` | Acceptable -- Next.js injects styles inline |
| `img-src` | `'self' data: blob:` | Good -- allows data URIs for base64 images (used by `image-data.ts`) |
| `font-src` | `'self'` | Good -- only same-origin fonts |
| `object-src` | `'none'` | Good -- blocks Flash/plugins |
| `base-uri` | `'self'` | Good -- prevents base tag hijacking |
| `form-action` | `'self'` | Good -- prevents form submission to external sites |
| `frame-ancestors` | `'none'` | Good -- strongest anti-clickjacking |
| `child-src` | localhost:3001, Railway docs, WalletConnect verify | Good -- explicit whitelist |
| `frame-src` | Same as child-src | Good -- mirrors child-src |
| `connect-src` | `'self'`, WalletConnect relay, Helius RPC, Sentry ingest | Good -- explicit whitelist |
| `worker-src` | `'self'` | Good |
| `manifest-src` | `'self'` | Good |
| `upgrade-insecure-requests` | Present | Good -- forces HTTPS subresources |

### 2. Security Header Stack (`app/next.config.ts:58-86`)

Five headers are applied to all routes:

1. **Content-Security-Policy** -- Present, comprehensive (see above)
2. **X-Frame-Options: DENY** -- Redundant with `frame-ancestors 'none'` but good defense-in-depth for older browsers
3. **X-Content-Type-Options: nosniff** -- Prevents MIME-type sniffing attacks
4. **Referrer-Policy: strict-origin-when-cross-origin** -- Good -- sends full referrer only to same origin, origin-only to cross-origin
5. **Permissions-Policy: camera=(), microphone=(), geolocation=()** -- Good -- disables unused browser APIs

**Missing headers:**
- `Strict-Transport-Security` (HSTS) -- Not present anywhere in the codebase
- `X-Permitted-Cross-Domain-Policies` -- Not present (low impact)
- `Cross-Origin-Embedder-Policy` (COEP) -- Not present (may not be needed)
- `Cross-Origin-Opener-Policy` (COOP) -- Not present (may conflict with wallet popups)
- `Cross-Origin-Resource-Policy` (CORP) -- Not present

### 3. CORS Configuration

There is **no explicit CORS configuration** in the codebase. This is correct for this architecture:
- All API routes (`/api/*`) are same-origin calls from the Next.js frontend
- External API calls (CoinGecko, Binance) are made server-side
- No cross-origin API consumers are expected

The `sol-price` proxy pattern (`app/app/api/sol-price/route.ts`) is specifically designed to avoid CORS issues -- the comment at line 6-9 explicitly documents this rationale.

### 4. Sentry Integration (`app/lib/sentry.ts`)

Zero-dependency Sentry reporter that sends error envelopes via raw `fetch()`. The DSN is parsed to extract key, project ID, and host. The ingest URL is constructed dynamically: `https://${host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`.

**CSP coverage:** `connect-src` includes `https://*.ingest.sentry.io https://*.ingest.us.sentry.io` -- this correctly handles both EU and US Sentry regions (the US region uses `o{id}.ingest.us.sentry.io` which has two subdomain levels, requiring the second wildcard pattern).

**Fire-and-forget pattern:** The fetch is not awaited and errors are silently swallowed (line 86-92). This is intentional -- error reporting should never block the app. However, there's no retry mechanism, so transient network failures cause event loss.

### 5. Iframe Sandbox Configuration

Two components embed external docs in iframes:

**`app/components/station/DocsStation.tsx:66`:**
```
sandbox="allow-scripts allow-same-origin allow-popups"
```
Source: `process.env.NEXT_PUBLIC_DOCS_URL || 'http://localhost:3001'`

**`app/components/launch/DocsModal.tsx:107`:**
```
sandbox="allow-scripts allow-same-origin allow-popups"
```
Source: hardcoded `'https://dr-fraudsworth-production.up.railway.app/docs'`

The combination of `allow-scripts` + `allow-same-origin` is documented by MDN as dangerous when the embedded content shares the same origin as the parent. In `DocsModal.tsx`, the iframe source (`dr-fraudsworth-production.up.railway.app/docs`) is the SAME origin as the parent app, meaning the sandboxed iframe can programmatically remove its own sandbox attribute.

## Trust Model

### Browser <-> App Server
- CSP restricts resource loading to whitelisted origins
- All state-changing operations go through on-chain transactions (signed by user wallet)
- No session cookies or server-side auth state
- API routes are all public (no auth required) -- data is non-sensitive

### App Server <-> External APIs
- CoinGecko and Binance calls are server-side only (no browser exposure)
- 5-second timeout on both calls (`AbortSignal.timeout(5_000)`)
- Response validation: type-checks `typeof price === "number" && Number.isFinite(price)`

### Helius Webhook <-> App Server
- Optional auth via `Authorization` header matching `HELIUS_WEBHOOK_SECRET`
- Non-timing-safe string comparison (`===`)
- If env var unset, completely unauthenticated

### Browser <-> SSE Endpoint
- No authentication on SSE connections
- Data is public (candle updates)
- No origin validation (any browser can connect)

## State Analysis

No databases, caches, or sessions are relevant to CORS/CSP/headers specifically. The headers are static configuration in `next.config.ts` -- no dynamic CSP nonce generation, no per-request header manipulation.

The in-memory price cache in `sol-price/route.ts` (lines 36-38) is process-level state that doesn't interact with security headers.

## Dependencies

| Dependency | Type | Security Relevance |
|-----------|------|-------------------|
| Next.js `headers()` | Framework | Sole mechanism for setting security headers |
| Railway | Infrastructure | Must enforce HTTPS at edge (no HSTS to enforce browser-side) |
| CoinGecko API | External | Server-side only, no CORS implications |
| Binance API | External | Server-side only, no CORS implications |
| Sentry ingest API | External | Client-side `connect-src` whitelisted |
| Helius RPC | External | Client-side `connect-src` whitelisted |
| WalletConnect relay | External | Client-side `connect-src` whitelisted (WSS) |

## Focus-Specific Analysis

### CSP `script-src 'unsafe-inline'` Deep Dive

The comment at `next.config.ts:6` says: `'unsafe-inline' needed for Next.js style injection`. However, `unsafe-inline` is on `script-src`, not just `style-src`. The comment appears to conflate the two.

**Why `unsafe-inline` on `script-src` is problematic:**
- It completely negates CSP's XSS protection for scripts
- Any HTML injection becomes a full XSS vector (attacker can use `<script>` tags)
- Nonce-based CSP is the modern alternative

**Why it might be needed:**
- Next.js historically needed `unsafe-inline` for its hydration scripts
- With App Router and React Server Components, this may no longer be necessary
- Need to verify: Does the app break if `unsafe-inline` is removed from `script-src`?

**Recommendation:** Investigate nonce-based CSP for script-src. Next.js 13+ supports this via middleware.

### Missing HSTS Header

No `Strict-Transport-Security` header is configured. This header tells browsers to always use HTTPS for subsequent visits, preventing SSL stripping attacks.

**Recommended configuration:**
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

This should be added to the headers array in `next.config.ts`.

### Webhook Auth Comparison

At `app/app/api/webhooks/helius/route.ts:138`:
```typescript
if (authHeader !== webhookSecret) {
```

This uses JavaScript's `!==` operator for string comparison, which is not timing-safe. A timing attack could progressively leak the secret byte-by-byte. However, the practical exploitability is low because:
1. The comparison is over HTTP (network jitter dwarfs timing differences)
2. The secret is compared against the full `Authorization` header value

Still, best practice would use `crypto.timingSafeEqual()`.

## Cross-Focus Intersections

| Focus Area | Intersection |
|-----------|-------------|
| WEB-01 (XSS) | `script-src 'unsafe-inline'` means CSP won't block XSS even if injection vectors exist |
| SEC-02 (Secrets) | `HELIUS_WEBHOOK_SECRET` must be set in production, `NEXT_PUBLIC_SENTRY_DSN` is intentionally public |
| API-04 (Webhooks) | Webhook auth bypass when env var unset affects data integrity |
| INFRA-05 (Monitoring) | Health endpoint leaks dependency status without auth |
| FE-01 (Frontend) | Iframe sandbox configuration affects docs integration security |

## Cross-Reference Handoffs

1. **-> SEC-02**: Verify `HELIUS_WEBHOOK_SECRET` is configured in Railway production environment. Document as deployment requirement.
2. **-> API-04**: Evaluate webhook auth comparison for timing safety. Consider `crypto.timingSafeEqual()`.
3. **-> WEB-01**: Cross-reference XSS analysis with `script-src 'unsafe-inline'` -- any XSS vector found is unmitigated by CSP.
4. **-> INFRA-05**: Health endpoint at `/api/health` returns infrastructure topology (Postgres status, RPC status) without authentication.

## Risk Observations

### R1: `script-src 'unsafe-inline'` (MEDIUM)
**File:** `app/next.config.ts:9`
**Impact:** If any HTML injection exists, inline scripts will execute. CSP's primary XSS protection is nullified.
**Likelihood:** Possible -- depends on XSS auditor findings.
**Mitigation path:** Switch to nonce-based CSP. Next.js App Router supports this.

### R2: Missing HSTS (MEDIUM)
**File:** `app/next.config.ts:58-86` (absent)
**Impact:** First-visit SSL stripping attack possible. Browser won't enforce HTTPS on its own.
**Likelihood:** Unlikely in practice (Railway enforces HTTPS), but defense-in-depth gap.
**Mitigation path:** Add `Strict-Transport-Security: max-age=63072000; includeSubDomains` to headers array.

### R3: Optional Webhook Auth (HIGH if misconfigured)
**File:** `app/app/api/webhooks/helius/route.ts:135-141`
**Impact:** Unauthenticated webhook allows injection of fake swap events, price manipulation in charts, false SSE broadcasts.
**Likelihood:** Possible -- depends on deployment configuration.
**Mitigation path:** Make auth mandatory (throw if env var unset in production). Add `NODE_ENV` check.

### R4: Iframe Sandbox Weakness (MEDIUM)
**File:** `app/components/station/DocsStation.tsx:66`, `app/components/launch/DocsModal.tsx:107`
**Impact:** Same-origin iframe with `allow-scripts` + `allow-same-origin` can remove its own sandbox.
**Likelihood:** Unlikely -- requires compromise of the docs deployment.
**Mitigation path:** Serve docs from a different origin (already partially done with Railway docs).

### R5: SSE Resource Exhaustion (LOW)
**File:** `app/app/api/sse/candles/route.ts:38`
**Impact:** Attacker could open many concurrent SSE connections, exhausting server memory/file descriptors.
**Likelihood:** Possible but low impact (Railway can restart containers).
**Mitigation path:** Add connection limiting per IP or total connection cap.

### R6: Sentry DSN Exposure (LOW)
**File:** `app/instrumentation-client.ts:37`, `app/lib/sentry.ts:30`
**Impact:** Attacker could extract DSN from client bundle and spam Sentry with fake events, exhausting quota.
**Likelihood:** Possible -- DSN is in client JS.
**Mitigation path:** Rate-limit on Sentry dashboard. Consider server-side-only error reporting for sensitive contexts.

### R7: Non-timing-safe Webhook Comparison (LOW)
**File:** `app/app/api/webhooks/helius/route.ts:138`
**Impact:** Theoretical timing attack to leak webhook secret.
**Likelihood:** Rare -- network jitter makes HTTP timing attacks impractical.
**Mitigation path:** Use `crypto.timingSafeEqual()` for defense-in-depth.

### R8: Health Endpoint Information Disclosure (LOW)
**File:** `app/app/api/health/route.ts:28-56`
**Impact:** Leaks Postgres and RPC connectivity status to unauthenticated callers.
**Likelihood:** Low impact -- doesn't expose credentials, just availability.
**Mitigation path:** Return only `ok`/`degraded` to external callers; detailed checks behind auth.

## Novel Attack Surface Observations

### Price Chart Manipulation via Webhook + SSE Chain
If the webhook endpoint is unauthenticated (env var unset), an attacker could:
1. POST fabricated swap events with extreme prices
2. These events get stored in Postgres via `onConflictDoNothing` (unique on TX signature, so attacker needs unique fake signatures)
3. Candle aggregator upserts OHLCV data with the fake prices
4. SSE broadcasts the fake candle update to all connected browsers
5. Users see manipulated price charts and may make trading decisions based on false data

This is a multi-step chain but each step is straightforward. The key control point is webhook authentication.

### CSP Bypass via `unsafe-inline` + Wallet Adapter
The wallet adapter opens popups for wallet interactions. If an attacker can inject HTML into the page (e.g., via a stored XSS in a hypothetical future feature), `script-src 'unsafe-inline'` means they can execute arbitrary JavaScript. Combined with the wallet adapter context, the injected script could:
- Call wallet adapter methods to request transaction approval
- Modify transaction parameters before signing
- Exfiltrate wallet public keys

This is speculative (no known XSS vector exists currently), but the CSP gap makes it a viable escalation path if one is found.

## Questions for Other Focus Areas
- **WEB-01**: Are there any HTML injection points that `script-src 'unsafe-inline'` would fail to mitigate?
- **SEC-02**: Is `HELIUS_WEBHOOK_SECRET` confirmed set in the Railway production environment?
- **INFRA-05**: Does Railway's reverse proxy add any security headers (HSTS, etc.) that we're not seeing in `next.config.ts`?
- **FE-01**: Could the `DocsStation` iframe content be compromised to exploit the `allow-scripts + allow-same-origin` sandbox weakness?

## Raw Notes

- No `middleware.ts` file exists in the app directory. All security headers are configured via `next.config.ts` `headers()` function. This is a valid approach but means no per-request dynamic CSP (e.g., nonce injection).
- No `cors` package installed. No Express middleware. Pure Next.js App Router with no custom server.
- The `audio-manager.ts` at line 271 has a comment: "Do NOT set crossOrigin -- same-origin files, setting it can cause CORS preflight issues". This is correct -- same-origin audio files don't need crossOrigin attribute.
- All client-side fetches are to same-origin `/api/*` routes. No direct cross-origin fetches from the browser (correct architecture).
- `connect-src` whitelist covers: WalletConnect relay (WSS), Helius RPC (HTTPS + WSS), Sentry ingest. No other cross-origin connections observed.
- The `frame-src` / `child-src` whitelist includes `localhost:3001` for dev docs and `verify.walletconnect.com/org` for WalletConnect verification iframes. These are appropriate.
- No `dangerouslySetInnerHTML` usage found in any component (good).
- No `innerHTML` assignments found in app code (good).
- No `postMessage` handlers found in app code (good -- reduces attack surface).
