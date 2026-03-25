# Phase 103: Off-chain Security Hardening - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 7 confirmed Bulwark (off-chain audit) findings that affect the RPC proxy, webhook handler, supply chain, and rate limiter. The findings cluster into 4 fix groups: RPC proxy hardening (H008, H010), webhook decode safety (H119, H096), supply chain integrity (H003, H007), and rate limiter IP extraction (H015). Additionally, add rate limits to 2 unprotected database-hitting endpoints flagged by H015. No on-chain program changes. No new features.

</domain>

<decisions>
## Implementation Decisions

### RPC Proxy Hardening (H008 + H010)
- **Disable batch support entirely** — reject `Array.isArray(body)` with `400 Bad Request`. The frontend never sends batch RPC requests; there are zero legitimate use cases. Eliminates the full amplification vector
- **10-second fetch timeout** — add `AbortSignal.timeout(10_000)` to the upstream Helius `fetch()` call. Matches audit recommendation. Helius p99 < 2s; 10s gives headroom for transient slowness. Pattern already used in sol-price/route.ts (5s there)
- **20 concurrent requests per IP** — reject with 503 if more than 20 in-flight requests from the same IP. Defense-in-depth independent of timeout. Normal frontend usage is ~5 concurrent per tab
- **64KB request body size limit** — enforce max payload size before JSON parsing. A single RPC request is ~200 bytes; 64KB is extremely generous while blocking megabyte-sized abuse payloads

### Webhook Decode Safety (H119 + H096)
- **Fail-closed on decode error (H119)** — when Anchor `coder.accounts.decode()` throws, log the error and `continue`. Do NOT call `setAccountState()` with raw payload. Existing good data in protocolStore stays. Next legitimate webhook or ws-subscriber poll (≤60s) restores naturally
- **Per-account-type bounds validators (H096)** — write specific validators for each account type after decode, before `setAccountState()`:
  - EpochState: all tax BPS fields in [0, 10000]
  - PoolState: reserves > 0, fee in [0, 10000]
  - CarnageFundState: balances ≥ 0
  - StakePool: totalStaked ≥ 0, rewardPerShare ≥ 0
  - CurveState: currentPrice ≥ 0, totalSold ≥ 0
  - Reject (don't store) any account that fails validation
- **Sentry alerts on decode failures and bounds violations** — these are strong attack signals. Fire `captureException()` for decode errors and validation rejections. Rate limit hits are too noisy — just console.warn those

### Supply Chain Integrity (H003 + H007)
- **npm ci in railway-crank.toml** — change `buildCommand = "npm install"` to `buildCommand = "npm ci"`. One-line fix that completes the Audit #1 H003 remediation
- **Verify main app Railway build also uses npm ci** — Nixpacks auto-detects npm ci when package-lock.json exists, but this is not guaranteed across versions. Add explicit buildCommand to railway.toml if missing
- **workspace:* in app/package.json** — change `"@dr-fraudsworth/shared": "0.0.1"` to `"@dr-fraudsworth/shared": "workspace:*"`. Hard-fails instead of silently falling back to npm registry
- **Register @dr-fraudsworth npm scope** — manual step in plan. User registers the scope on npm.com (free, 30 seconds) as defense-in-depth. Permanently closes the namespace-squatting window

### Rate Limiter IP Extraction (H015)
- **Rightmost IP from x-forwarded-for** — take `ips[ips.length - 1]` instead of `ips[0]`. Railway's proxy appends the real client IP; the rightmost entry is what the trusted proxy observed, not what the client injected. No Railway-specific config needed
- **Add rate limits to /api/candles** — 120 req/min per IP. Hits PostgreSQL; without a limit an attacker can overload the database. 120/min is extremely generous for normal charting (browser polls every 5-15s)
- **Add rate limits to /api/carnage-events** — 60 req/min per IP. Called once on page load then SSE provides updates. Rarely used by legitimate users; database abuse vector without limits
- **/api/health left unprotected** — lightweight endpoint needed by UptimeRobot. Rate limiting could cause false-alarm monitor failures. Low abuse risk (no DB, no external calls)

### Claude's Discretion
- Exact structure of the per-account-type validator functions (implementation patterns)
- Whether to extract validators into a separate file or keep inline in the webhook handler
- Sentry error message format and grouping strategy
- Concurrent request tracking implementation (Map vs WeakMap, cleanup interval)
- Exact wording of error responses (400, 429, 503 status messages)
- Whether railway.toml needs an explicit buildCommand or Nixpacks auto-detection is sufficient after verification

</decisions>

<specifics>
## Specific Ideas

- These are all confirmed audit findings from the Bulwark (off-chain) Audit #2 — the fixes should follow the audit recommendations closely
- H003 was partially fixed in Audit #1 (committed package-lock.json + ignore-scripts=true) but the railway-crank.toml npm ci change was missed — this completes that fix
- H007 was incorrectly cleared in Audit #1 (auditor assumed workspace:* was in use when it wasn't) — this corrects that oversight
- The sol-price/route.ts already uses AbortSignal.timeout(5000) — the RPC proxy fix follows the same pattern
- npm scope registration is a manual user action (not code) — include clear instructions in the plan

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/lib/rate-limit.ts`: Existing sliding window rate limiter — `getClientIp()` is the function to fix (H015), `checkRateLimit()` called from all protected endpoints
- `app/lib/sentry.ts`: Zero-dependency Sentry client — `captureException()` already exists and works in both browser and Node.js
- `app/app/api/sol-price/route.ts`: Already uses `AbortSignal.timeout(5000)` — proven pattern for the H010 fix
- `app/lib/credit-counter.ts`: Observational only credit tracking — not affected by these changes
- `app/lib/protocol-store.ts`: `setAccountState()` method that broadcasts via SSE — the function NOT to call on decode failure

### Established Patterns
- Rate limit configs exported from `rate-limit.ts` (e.g., `RPC_RATE_LIMIT = { windowMs: 60_000, maxRequests: 300 }`)
- All API routes import `{ checkRateLimit, getClientIp }` from `@/lib/rate-limit`
- Sentry alerts via `captureException(new Error(...))` — no npm packages, just fetch()
- railway-crank.toml / railway.toml for Railway service configuration

### Integration Points
- `app/app/api/rpc/route.ts`: H008 (batch disable) + H010 (timeout + concurrent cap) + H008 (body size limit)
- `app/app/api/webhooks/helius/route.ts`: H119 (decode fail-closed) + H096 (bounds validation)
- `app/lib/rate-limit.ts`: H015 (rightmost IP) + new rate limit configs for candles/carnage-events
- `app/app/api/sse/candles/route.ts` and `app/app/api/carnage-events/route.ts`: Add rate limit calls
- `railway-crank.toml`: H003 (npm ci)
- `app/package.json`: H007 (workspace:*)
- `railway.toml`: Verify/add explicit npm ci buildCommand

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 103-off-chain-security-hardening-h008-h010-h119-h003-h007-h096-h015*
*Context gathered: 2026-03-23*
