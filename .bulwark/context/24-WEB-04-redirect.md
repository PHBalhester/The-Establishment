---
task_id: db-phase1-web-04-redirect
provides: [web-04-redirect-findings, web-04-redirect-invariants]
focus_area: web-04-redirect
files_analyzed: [app/middleware.ts, app/app/page.tsx, app/lib/mobile-wallets.ts, app/components/wallet/ConnectModal.tsx, app/components/station/WalletStation.tsx, app/components/toast/ToastProvider.tsx, app/app/api/rpc/route.ts, app/lib/sentry.ts, app/lib/solscan.ts, app/lib/connection.ts, app/lib/jupiter.ts, app/providers/providers.tsx, app/next.config.ts, app/app/api/candles/route.ts, app/app/api/sol-price/route.ts, app/components/station/DocsStation.tsx, app/components/station/CarnageStation.tsx, app/components/launch/RefundPanel.tsx, scripts/deploy/upload-metadata.ts]
finding_count: 2
severity_breakdown: {critical: 0, high: 0, medium: 0, low: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Open Redirect & URL Validation — Condensed Summary

## Key Findings (Top 5)
- **No user-controlled redirect destinations exist**: All redirects use hardcoded paths (`/launch`) or environment variables, never query parameters — `app/middleware.ts:29`, `app/app/page.tsx:39`
- **Mobile deep links use `window.location.href` as the URL parameter**: The current page URL is passed to wallet deep-link constructors (Phantom, Solflare, Backpack) without sanitization, but the URL comes from `window.location.href` which is always the app's own origin — `app/lib/mobile-wallets.ts:17-31`, `app/components/wallet/ConnectModal.tsx:69`
- **Solscan URL builders interpolate transaction signatures into URLs without encoding**: `solscanTxUrl(signature)` concatenates the signature directly into the URL string; signatures are base58 strings (safe charset) but no `encodeURIComponent` is applied — `app/lib/solscan.ts:33-34`
- **CSP `form-action 'self'` blocks form-based open redirects**: The Content Security Policy restricts form actions to same-origin, preventing HTML form submission to external domains — `app/next.config.ts:39`
- **DocsStation iframe src from env var only**: The `DOCS_URL` is read from `NEXT_PUBLIC_DOCS_URL` env var at build time, not from user input — `app/components/station/DocsStation.tsx:22`

## Critical Mechanisms
- **Middleware redirect (site-mode toggle)**: When `NEXT_PUBLIC_SITE_MODE === 'launch'`, all non-`/launch` and non-`/api` paths redirect via `NextResponse.redirect(new URL('/launch', request.url))`. The destination is hardcoded (`/launch`), and `request.url` is only used as a base for origin resolution. No user input flows into the redirect target. — `app/middleware.ts:20-36`
- **Server-side redirect (curve phase)**: `redirect('/launch')` from `next/navigation` is called when `NEXT_PUBLIC_CURVE_PHASE` is true. Destination is a literal string. — `app/app/page.tsx:38-39`
- **Mobile wallet deep links**: `MOBILE_WALLETS` array constructs deep-link URLs by embedding the current page URL (`window.location.href`) into wallet-specific URL schemes (e.g., `https://phantom.app/ul/browse/${encodeURIComponent(url)}`). The embedded URL is `encodeURIComponent`-encoded, and the source is always the app's own origin. — `app/lib/mobile-wallets.ts:12-32`
- **RPC proxy URL construction**: Browser-side code constructs `${window.location.origin}/api/rpc` for the Solana Connection endpoint. This is always same-origin. Server-side reads from env vars only. — `app/lib/connection.ts:35-36`, `app/providers/providers.tsx:37-38`

## Invariants & Assumptions
- INVARIANT: All HTTP redirects target hardcoded paths (`/launch`), never user-supplied URLs — enforced at `app/middleware.ts:29`, `app/app/page.tsx:39`
- INVARIANT: CSP `form-action 'self'` prevents form submissions to external origins — enforced at `app/next.config.ts:39`
- INVARIANT: CSP `frame-ancestors 'none'` prevents the app from being framed (blocks clickjacking + redirect abuse via framing) — enforced at `app/next.config.ts:40`
- ASSUMPTION: `window.location.href` always reflects the app's own origin (cannot be spoofed by client-side JS in a same-origin context) — validated by browser security model
- ASSUMPTION: Solana transaction signatures and addresses are base58 strings that do not contain URL-special characters — validated by base58 alphabet (no `/`, `?`, `#`, `&`)
- ASSUMPTION: `NEXT_PUBLIC_DOCS_URL` env var is set by the deployment operator and points to a trusted domain — UNVALIDATED at runtime (env var injection risk if operator error)

## Risk Observations (Prioritized)
1. **DocsStation iframe src from env var without URL validation**: `app/components/station/DocsStation.tsx:22` — The `DOCS_URL` is used directly as iframe `src`. If an attacker could influence `NEXT_PUBLIC_DOCS_URL` (env var misconfiguration, Railway environment injection), the app would embed an arbitrary page. However, this is a build-time env var, so the attack surface is limited to deployment pipeline compromise. Severity: LOW (requires deployment pipeline access).
2. **Solscan URL construction without encodeURIComponent on signature/address**: `app/lib/solscan.ts:33-44` — While base58 strings are URL-safe, this represents a defensive gap. If a non-base58 string were somehow passed (e.g., from corrupted on-chain data or a DB injection), it could alter the URL structure. Severity: LOW (base58 guarantees safe charset in normal operation; on-chain data is the source of truth).

## Novel Attack Surface
- **No novel attack surface identified for open redirect**: This codebase has an unusually small redirect surface. There are no login flows, no OAuth, no `returnTo` parameters, no user-facing URL construction from query strings. The application is a single-purpose DeFi frontend with wallet-adapter authentication (no server-side sessions or redirect-based auth). The only "redirect" is a site-mode toggle that locks to `/launch` during bonding curve phase.

## Cross-Focus Handoffs
- → **WEB-01 (XSS)**: The `wallet.adapter.icon` property is rendered as an `<img src>` attribute in `ConnectModal.tsx:128` and `WalletStation.tsx:65`. If a malicious wallet adapter provides a `javascript:` URI as the icon, React's `src` prop would not execute it (React does not allow javascript: in img src), but this should be verified by WEB-01.
- → **WEB-02 (CORS/CSP)**: CSP `connect-src` allowlist in `next.config.ts:43` should be reviewed to confirm no open redirect potential through allowed external origins (e.g., Helius, WalletConnect relay). If any allowed origin has an open redirect, it could be chained.
- → **INJ-03 (SSRF)**: The `app/app/api/rpc/route.ts` constructs upstream URLs from env vars (`HELIUS_RPC_URL`, `HELIUS_RPC_URL_FALLBACK`). While these are server-side env vars, any env var injection would allow SSRF through the RPC proxy.
- → **FE-01 (Client State)**: `window.location.href` is used as a value passed to deep-link constructors. If the app ever adds client-side routing with user-controlled path segments, this could be leveraged.

## Trust Boundaries
The redirect trust model in this application is extremely simple. All redirect destinations are hardcoded string literals (`/launch`), never derived from user input. The only dynamic URL construction happens in (a) mobile wallet deep links, which embed `window.location.href` (always same-origin) into wallet-specific URL templates, and (b) Solscan explorer links, which embed transaction signatures (base58, sourced from on-chain data) into a hardcoded Solscan URL pattern. There are no server-side redirect endpoints that accept a target URL parameter. The CSP's `form-action 'self'` directive provides an additional defense layer against form-based redirect attacks. The application has no authentication flow that uses redirect-based login/logout patterns (wallet-adapter is purely client-side). The only trust boundary concern is the `NEXT_PUBLIC_DOCS_URL` env var used as an iframe src, which trusts the deployment operator to provide a valid URL.
<!-- CONDENSED_SUMMARY_END -->

---

# Open Redirect & URL Validation — Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase has a minimal open redirect attack surface. The application contains exactly two server-side redirects (both to the hardcoded path `/launch`), zero user-input-derived redirects, and no OAuth or session-based authentication flows that use redirect parameters. All dynamic URL construction uses either `window.location.href` (same-origin by definition) or on-chain-derived base58 strings (URL-safe alphabet). The CSP includes `form-action 'self'` which prevents form-based redirect attacks. No open redirect vulnerabilities were identified.

## Scope

**In scope:** All off-chain code — Next.js frontend (app/), shared constants, deployment scripts, API routes, React hooks, utility libraries.

**Out of scope:** Anchor/Rust on-chain programs (programs/ directory).

**Files analyzed:** 19 files across API routes, middleware, components, hooks, and utility libraries. All files containing redirect, URL construction, `window.location`, `router.push`, `new URL()`, or `href` patterns were examined.

## Key Mechanisms

### 1. Server-Side Redirects

**Middleware redirect (`app/middleware.ts:20-36`):**
The Next.js middleware intercepts all non-static routes. When `NEXT_PUBLIC_SITE_MODE === 'launch'` (default), any path that is not `/launch` and not `/api/*` is redirected to `/launch`:

```typescript
return NextResponse.redirect(new URL('/launch', request.url));
```

The `new URL('/launch', request.url)` constructor uses `request.url` only as the base for origin resolution (protocol + host). The path is always the literal string `/launch`. An attacker cannot influence the redirect target because:
- The first argument (`'/launch'`) is hardcoded
- `request.url` only provides the origin/port (controlled by the server's hostname)
- There is no query parameter, fragment, or path component extraction from user input

**Page-level redirect (`app/app/page.tsx:38-39`):**
Uses Next.js `redirect('/launch')` from `next/navigation`. This is a server-side redirect with a hardcoded destination string. No user input involved.

### 2. Client-Side URL Construction

**Mobile wallet deep links (`app/lib/mobile-wallets.ts:12-32`):**
Three wallet providers (Phantom, Solflare, Backpack) have deep-link constructors:

```typescript
deepLink: (url: string) =>
  `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`
```

The `url` parameter comes from `window.location.href` in both `ConnectModal.tsx:69` and `WalletStation.tsx:44`:

```typescript
const currentUrl = typeof window !== "undefined" ? window.location.href : "";
```

Analysis:
- `window.location.href` is the browser's current URL, which is always the app's own origin
- The URL is `encodeURIComponent`-encoded before embedding, preventing URL injection
- Even if `window.location.href` contained a path like `/foo?evil=http://attacker.com`, the encoding would preserve it as a literal string parameter
- The deep links navigate to trusted wallet domains (phantom.app, solflare.com, backpack.app), not to user-controlled destinations

**Solscan URL builders (`app/lib/solscan.ts:33-44`):**

```typescript
export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}${clusterSuffix()}`;
}
```

The `signature` parameter is a Solana transaction signature (base58-encoded string). Base58 uses `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz` — no special URL characters. However, `encodeURIComponent` is not applied. If a non-base58 string were passed, URL structure could be altered (e.g., `../evil` or `?redirect=`). In practice, all callers pass on-chain-sourced signatures.

**RPC connection URL (`app/lib/connection.ts:35-36`, `app/providers/providers.tsx:37-38`):**

```typescript
return `${window.location.origin}/api/rpc`;
```

This constructs a same-origin URL for the RPC proxy. `window.location.origin` is always the app's own origin. No user input flows into this construction.

**Sentry DSN parsing (`app/lib/sentry.ts:117-123`):**

```typescript
function parseDsn(dsn: string) {
  const url = new URL(dsn);
  // ...
}
```

The DSN comes from `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN` env vars. Not user-controllable at runtime.

### 3. CSP Redirect Protections

The CSP in `app/next.config.ts:31-47` includes several directives that limit redirect-related attacks:

- `form-action 'self'` — Prevents HTML forms from submitting to external origins (blocks form-based open redirect)
- `frame-ancestors 'none'` — Prevents the app from being embedded in iframes (blocks clickjacking-based redirect attacks)
- `base-uri 'self'` — Prevents `<base>` tag injection that could alter relative URL resolution

### 4. External Link Handling

All external links in the codebase use `target="_blank"` with `rel="noopener noreferrer"`:
- Solscan links: `app/components/toast/ToastProvider.tsx:316`, `app/components/station/CarnageStation.tsx:286`, `app/components/launch/RefundPanel.tsx:380`
- Docs link: `app/components/station/DocsStation.tsx:75-78`

The `rel="noopener noreferrer"` attribute prevents reverse tabnabbing (where the opened page could redirect the opener).

## Trust Model

| Source | Trust Level | Rationale |
|--------|------------|-----------|
| Redirect destinations | **HARDCODED** | `/launch` only — no user input |
| Deep link URLs | **SAME-ORIGIN** | `window.location.href` always reflects app origin |
| Solscan URLs | **ON-CHAIN-DERIVED** | Base58 signatures from Solana transactions |
| Iframe src (DOCS_URL) | **ENV-VAR-DERIVED** | Set at build time by deployment operator |
| RPC proxy URL | **SAME-ORIGIN** | Constructed from `window.location.origin` |
| External API URLs | **HARDCODED** | CoinGecko, Binance URLs are string constants |
| Sentry ingest URL | **ENV-VAR-DERIVED** | Parsed from DSN in env var |

## State Analysis

No redirect-related state is stored in databases, caches, or sessions. The application has no server-side session management and no redirect-based authentication flow. All "state" relevant to URL handling is:
- `NEXT_PUBLIC_SITE_MODE` env var (build-time, controls middleware redirect behavior)
- `NEXT_PUBLIC_CURVE_PHASE` env var (build-time, controls page-level redirect)
- `NEXT_PUBLIC_DOCS_URL` env var (build-time, iframe src)

## Dependencies

No external libraries are used for URL validation or redirect handling. The application relies on:
- Next.js `redirect()` function (from `next/navigation`)
- Next.js `NextResponse.redirect()` (from `next/server`)
- Browser's `URL` constructor (for origin extraction in deep links)
- `encodeURIComponent()` (for deep link URL encoding)

## Focus-Specific Analysis

### Open Redirect Patterns Checked

| Pattern | Present? | Details |
|---------|----------|---------|
| `?returnTo=` / `?next=` / `?redirect=` query params | NO | No route reads redirect destination from query params |
| `res.redirect(req.query.*)` | NO | No Express/Next.js API route uses user input in redirect |
| `router.push(userInput)` | NO | No client-side router navigation from user input |
| `window.location = userInput` | NO | No assignment to `window.location` from user input |
| `window.location.href = userInput` | NO | No assignment from user input |
| OAuth `redirect_uri` | NO | No OAuth integration (wallet-adapter is client-side only) |
| Login redirect chain | NO | No login flow (wallet connection is client-side) |
| `javascript:` in href attributes | NO | All href values are HTTPS URLs or Solscan links |
| Form action with external target | BLOCKED | CSP `form-action 'self'` |
| Meta refresh redirect | NO | No `<meta http-equiv="refresh">` tags |

### URL Validation Audit

| URL Construction | File | Input Source | Validated? |
|-----------------|------|-------------|------------|
| `new URL('/launch', request.url)` | middleware.ts:29 | Hardcoded path | N/A (hardcoded) |
| `redirect('/launch')` | page.tsx:39 | Hardcoded path | N/A (hardcoded) |
| `mw.deepLink(currentUrl)` | ConnectModal.tsx:145, WalletStation.tsx:83 | `window.location.href` | encodeURIComponent applied |
| `solscanTxUrl(signature)` | Multiple components | On-chain base58 | No encoding (base58 is URL-safe) |
| `solscanAccountUrl(address)` | solscan.ts:38 | On-chain base58 | No encoding (base58 is URL-safe) |
| `${window.location.origin}/api/rpc` | connection.ts:36, providers.tsx:38 | Same-origin | N/A (same-origin) |
| `new URL(dsn)` | sentry.ts:118 | Env var | Parsed, not user input |
| `new URL(url).hostname` | rpc/route.ts:74 | Env var | Used for logging only |
| `https://gateway.irys.xyz/${txId}` | upload-metadata.ts:275 | Derived from metadata URI | URL-safe txId (Arweave hash) |

## Cross-Focus Intersections

### WEB-01 (XSS) Intersection
The `wallet.adapter.icon` property is rendered as `<img src={wallet.adapter.icon}>` in ConnectModal and WalletStation. React prevents `javascript:` execution in `src` props, but this is worth cross-referencing with XSS analysis.

### WEB-02 (CORS/CSP) Intersection
The CSP `connect-src` allowlist includes several external domains. If any of these have open redirects, they could be chained with the connect-src allowance to exfiltrate data. This is a WEB-02 concern, not WEB-04.

### INJ-03 (SSRF) Intersection
The RPC proxy (`app/app/api/rpc/route.ts`) forwards requests to URLs from env vars. If env vars were compromised, the proxy would become an SSRF vector. The proxy's method allowlist limits the damage but doesn't prevent the initial SSRF.

### FE-01 (Client State) Intersection
`window.location.href` is used as a parameter in two components. If the app ever implements client-side routing with user-controlled path segments (e.g., `/:token` routes), the deep link constructors would embed user-controlled path content into the URL. Currently, all routes are static (`/launch`, `/`, `/kit`).

## Cross-Reference Handoffs

| Target Agent | Item | File | Priority |
|-------------|------|------|----------|
| WEB-01 | Verify `wallet.adapter.icon` in `<img src>` is safe against javascript: protocol | `app/components/wallet/ConnectModal.tsx:128` | LOW |
| WEB-02 | Review CSP `connect-src` allowlist for open redirect chaining through allowed origins | `app/next.config.ts:43` | LOW |
| INJ-03 | Verify env var sources for RPC proxy upstream URLs cannot be injected | `app/app/api/rpc/route.ts:128-132` | MEDIUM |
| FE-01 | Monitor for future user-controlled route parameters that feed into `window.location.href` | `app/lib/mobile-wallets.ts:17` | LOW |

## Risk Observations

### LOW-01: DocsStation iframe src from unvalidated env var
**File:** `app/components/station/DocsStation.tsx:22`
**Observation:** `NEXT_PUBLIC_DOCS_URL` env var is used directly as iframe `src` without URL validation. If the env var were set to a malicious URL (via deployment pipeline compromise or Railway env var injection), the app would embed arbitrary content.
**Mitigations:** Build-time env var (not runtime), CSP `child-src` restricts allowed iframe sources, `sandbox` attribute limits iframe capabilities.
**Severity:** LOW — requires deployment pipeline access.

### LOW-02: Solscan URL construction without encodeURIComponent
**File:** `app/lib/solscan.ts:33-44`
**Observation:** Transaction signatures and addresses are interpolated into URL strings without encoding. While base58 is inherently URL-safe, defensive encoding would prevent edge cases.
**Mitigations:** Base58 alphabet excludes all URL-special characters, all callers pass on-chain-derived values.
**Severity:** LOW — defense-in-depth improvement only.

## Novel Attack Surface Observations

1. **Wallet deep-link as phishing vector**: If an attacker could convince a user to visit a URL like `https://dr-fraudsworth.app/launch` on mobile, the ConnectModal would construct deep links embedding that URL. The user would be redirected to `phantom.app/ul/browse/https%3A%2F%2Fdr-fraudsworth.app%2Flaunch`. If the attacker controlled `dr-fraudsworth.app` (typosquat), the deep link itself is not the vulnerability — the typosquat is. But the deep-link construction amplifies the phishing vector by making the wallet trust the URL. This is not an open redirect per se, but a social engineering consideration unique to wallet deep-link patterns.

## Questions for Other Focus Areas

1. **For SEC-02**: Are there any server-side API routes that accept a URL parameter and fetch from it (potential SSRF that could also be an open redirect)?
2. **For WEB-02**: Does the CSP `child-src` directive adequately restrict iframe sources to only the docs domain? The current allowlist includes several domains.
3. **For FE-01**: Are there plans to add dynamic route parameters (e.g., `/token/:mint`) that would put user-controlled content into `window.location.href`?

## Raw Notes

- No `useRouter` or `useSearchParams` imports found anywhere in the app codebase
- No `window.open()` calls found in the codebase
- No `location.href =` or `location.assign()` assignments found in source code (only in compiled `.next/` artifacts)
- The application has zero query-parameter-based navigation — all routing is path-based with hardcoded paths
- `upload-metadata.ts:280` uses `redirect: "follow"` in fetch options, but this is server-side deployment tooling fetching from Irys gateway — not user-facing
- `scripts/load-test/k6-sse.js:85-86` explicitly disables redirects (`redirects: 0`) for SSE load testing
- The `form-action 'self'` CSP directive is a strong defense that many projects miss; its presence here indicates intentional security hardening
