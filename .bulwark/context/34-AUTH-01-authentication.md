---
task_id: db-phase1-auth-01
provides: [auth-01-findings, auth-01-invariants]
focus_area: auth-01
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/lib/rate-limit.ts, app/lib/sse-connections.ts, app/lib/connection.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/app/api/rpc/route.ts, app/app/api/health/route.ts, app/app/api/candles/route.ts, app/app/api/sol-price/route.ts, app/app/api/carnage-events/route.ts, app/middleware.ts, app/next.config.ts, app/instrumentation.ts, app/hooks/useProtocolWallet.ts, app/lib/anchor.ts, app/lib/protocol-config.ts, app/lib/sse-manager.ts, app/lib/protocol-store.ts, scripts/webhook-manage.ts, scripts/crank/crank-provider.ts, scripts/deploy/fix-carnage-wsol.ts, .env.devnet, .gitignore]
finding_count: 9
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Authentication Mechanisms -- Condensed Summary

## Key Findings (Top 9)
- **No user authentication system exists**: The protocol is a permissionless DeFi app with no user accounts, sessions, JWTs, or passwords. Authentication reduces to two things: webhook secret verification (server-to-server) and Solana wallet signing (client-side). This is architecturally correct for a permissionless protocol but means the AUTH-01 pattern catalog (OC-021 through OC-048) has limited applicability. -- `entire codebase`
- **Webhook auth is well-implemented with fail-closed production behavior**: `timingSafeEqual()` constant-time comparison prevents timing attacks, length-mismatch branch prevents length leakage, production rejects all requests when HELIUS_WEBHOOK_SECRET is unset. -- `app/app/api/webhooks/helius/route.ts:270-301`
- **SSE endpoints have no authentication -- open to any HTTP client**: Both `/api/sse/protocol` and `/api/sse/candles` accept GET requests from any origin with no auth. Rate-limited by IP (10 per IP, 5000 global) but an attacker can read all real-time protocol state. -- `app/app/api/sse/protocol/route.ts:41-49`, `app/app/api/sse/candles/route.ts:40-48`
- **API routes have no authentication**: `/api/candles`, `/api/carnage-events`, `/api/sol-price`, `/api/rpc` are all open endpoints. Some have rate limiting, some do not. -- `app/app/api/candles/route.ts`, `app/app/api/carnage-events/route.ts`
- **RPC proxy method allowlist is strong but sendTransaction is allowed**: The allowlist includes `sendTransaction`, meaning any browser client can submit arbitrary (pre-signed) transactions through the server's Helius endpoint. This is expected for DeFi but worth noting. -- `app/app/api/rpc/route.ts:31-58`
- **Rate limiter IP extraction trusts x-forwarded-for header**: The first IP from `x-forwarded-for` is used as the rate-limit key. Behind Railway's reverse proxy this is correct, but if the app were ever exposed directly, an attacker could spoof IPs to bypass rate limits. -- `app/lib/rate-limit.ts:129-151`
- **Health endpoint exposes internal system status without authentication**: `/api/health` returns postgres connectivity, Solana RPC status, WebSocket subscriber state, and RPC credit usage to any caller. -- `app/app/api/health/route.ts:32-73`
- **.env.devnet committed to git with Helius API key**: The file `.env.devnet` is tracked by git and contains `HELIUS_API_KEY=[REDACTED-DEVNET-KEY]-...`. This is a devnet key (low severity) but the pattern is concerning for mainnet. -- `.env.devnet:8-9`
- **Webhook secret is a simple string comparison against Authorization header**: Helius sends the secret in the `Authorization` header directly (not HMAC-SHA256 of the body). This means the secret is replayable -- anyone who intercepts one webhook delivery can replay future requests with the same header value. The replay protection (5-minute blockTime check) only applies to raw transaction webhooks, not enhanced account change webhooks. -- `app/app/api/webhooks/helius/route.ts:286-301`

## Critical Mechanisms
- **Webhook Authentication Chain**: Helius sends `Authorization: <HELIUS_WEBHOOK_SECRET>`. Server compares with `timingSafeEqual()`. Production fail-closed if env var missing. Rate-limited at 120 req/min per IP. Body size capped at 1MB. Raw TX replay protected by 5-min blockTime check. Enhanced account changes have NO replay protection (no blockTime field). -- `app/app/api/webhooks/helius/route.ts:255-508`
- **Wallet-Based Transaction Signing**: User transactions are signed client-side via `useProtocolWallet` which wraps `@solana/wallet-adapter-react`. Sign-then-send pattern: wallet signs, app submits via Helius RPC. No server-side signing occurs in the frontend app. -- `app/hooks/useProtocolWallet.ts:55-130`
- **Crank Wallet Authentication**: The crank runner loads a private key from `WALLET_KEYPAIR` env var (JSON byte array) or `WALLET` file path. On Railway, the JSON env var approach is used. The keypair never passes through the Next.js frontend. -- `scripts/crank/crank-provider.ts:34-80`
- **SSE Connection Gating**: IP-based connection limits (10/IP, 5000 global) with 30-minute auto-expiry. No authentication token required. Functions as a resource exhaustion defense, not an authentication mechanism. -- `app/lib/sse-connections.ts:49-103`

## Invariants & Assumptions
- INVARIANT: In production (NODE_ENV=production), webhook processing requires HELIUS_WEBHOOK_SECRET to be set -- enforced at `app/app/api/webhooks/helius/route.ts:273-284` -- **Enforced (fail-closed)**
- INVARIANT: Webhook secret comparison is constant-time -- enforced at `app/app/api/webhooks/helius/route.ts:293-300` via `timingSafeEqual()` -- **Enforced**
- INVARIANT: All API routes that have rate limiting use the same `checkRateLimit()` function with per-endpoint configs -- enforced at `app/lib/rate-limit.ts:81-111` -- **Enforced**
- INVARIANT: RPC proxy only forwards allowlisted methods -- enforced at `app/app/api/rpc/route.ts:116-123` -- **Enforced**
- ASSUMPTION: Railway reverse proxy correctly sets `x-forwarded-for` to the real client IP -- validated by Railway documentation / NOT validated in code
- ASSUMPTION: Helius webhook Authorization header is treated as a shared secret and transmitted over HTTPS -- validated by Helius documentation / NOT validated in code
- ASSUMPTION: SSE endpoints do not need authentication because the data they serve is publicly readable on-chain anyway -- UNVALIDATED -- this is a design assumption, not a security control
- ASSUMPTION: The `/api/candles` and `/api/carnage-events` endpoints do not need rate limiting because they are read-only DB queries -- UNVALIDATED -- no rate limiter applied to these routes

## Risk Observations (Prioritized)
1. **Enhanced Account Change webhooks have no replay protection**: Raw TX webhooks check blockTime (5-min window), but enhanced account change webhooks have no equivalent timestamp check. An attacker who captures a webhook payload could replay it indefinitely to inject stale account state into the protocol store. The impact is limited (stale data, not fund theft) but could mislead frontend users. -- `app/app/api/webhooks/helius/route.ts:525-633`
2. **SSE streams unauthenticated**: Any internet-connected client can open an EventSource to `/api/sse/protocol` and receive real-time protocol state updates. While this data is on-chain (public), the SSE stream provides higher-frequency parsed data that could give automated systems an advantage. Connection limits mitigate volume but not access. -- `app/app/api/sse/protocol/route.ts:41-49`
3. **Rate limiter x-forwarded-for trust without validation**: If `x-forwarded-for` contains multiple IPs, only the first is used. This is correct behind a trusted proxy but does not validate the header format or reject requests without proxy headers in production. The production warning log is good but does not block. -- `app/lib/rate-limit.ts:129-151`
4. **`/api/candles` and `/api/carnage-events` have no rate limiting**: These endpoints perform Postgres queries. A determined attacker could issue rapid requests to exhaust DB connections. The `/api/candles` `limit` parameter is capped at 2000 rows, which bounds query cost, but repeated rapid queries are unbounded. -- `app/app/api/candles/route.ts:186`, `app/app/api/carnage-events/route.ts:32`
5. **Health endpoint information disclosure**: The `/api/health` endpoint exposes Postgres connectivity status, Solana RPC status, WebSocket subscriber internals, and RPC credit usage stats without any authentication. An attacker can fingerprint the deployment and monitor for degradation. -- `app/app/api/health/route.ts:32-73`

## Novel Attack Surface
- **Webhook-to-SSE data injection chain**: An attacker who obtains the HELIUS_WEBHOOK_SECRET (e.g., from git history, Railway dashboard breach) can inject arbitrary account state updates via the enhanced webhook path, which flow through `protocolStore.setAccountState()` to all SSE clients. The injected data would override real on-chain state in every connected browser. The dedup guard in protocol-store only prevents duplicate identical data -- different fake data would be broadcast immediately. This is a supply-chain-style attack on the data pipeline, unique to this architecture.
- **SSE as oracle for automated trading**: Since SSE streams are unauthenticated, a bot could subscribe to `/api/sse/protocol` and receive parsed, decoded protocol state faster than querying RPC directly. This isn't exploitable per se but creates an unintentional oracle service.

## Cross-Focus Handoffs
- -> **SEC-02**: HELIUS_WEBHOOK_SECRET management -- rotation, storage in Railway env vars, presence in git history. The `.env.devnet` file contains a Helius API key committed to git.
- -> **API-01**: SSE endpoints lack authentication. Evaluate whether this is acceptable given that data is publicly on-chain, or whether token-based gating should be added.
- -> **ERR-03**: `/api/candles` and `/api/carnage-events` have no rate limiting. Evaluate adding `checkRateLimit()` calls to prevent DB exhaustion.
- -> **DATA-04**: Health endpoint exposes internal system state. Evaluate whether to add authentication or strip sensitive fields (credit stats, WS subscriber state).

## Trust Boundaries
The application has a clear trust model: the browser is untrusted (no user sessions/accounts), the Helius webhook is semi-trusted (authenticated via shared secret), and the crank runner is trusted (has private key access). The webhook authentication is the only server-to-server auth mechanism and it is well-implemented with timing-safe comparison and fail-closed production behavior. However, the SSE/API layer between the server and browser clients has no authentication at all -- it relies entirely on the assumption that protocol data is publicly observable on-chain. The rate limiter provides volumetric defense but not identity verification. For a permissionless DeFi protocol, this model is reasonable but leaves the data pipeline as the primary attack surface: compromising the webhook secret would allow silent data injection to all connected clients.
<!-- CONDENSED_SUMMARY_END -->

---

# Authentication Mechanisms -- Full Analysis

## Executive Summary

Dr. Fraudsworth is a permissionless Solana DeFi protocol with no user accounts, passwords, sessions, JWTs, or traditional authentication. The entire authentication surface reduces to three mechanisms:

1. **Webhook shared secret** (Helius -> Next.js server): A static string in the `Authorization` header verified via `timingSafeEqual()`.
2. **Solana wallet signing** (browser -> blockchain): Standard wallet-adapter sign-then-send pattern; the server never sees private keys.
3. **Crank wallet keypair** (Railway -> blockchain): Private key loaded from env var on the Railway crank process.

This means the classical AUTH-01 pattern catalog (JWT algorithm confusion, bcrypt rounds, OAuth CSRF, session fixation, etc.) is almost entirely inapplicable. There are no login endpoints, no password hashing, no JWTs, no cookies, no session management. The audit focuses instead on the webhook auth chain, the absence of API-level authentication, rate limiting as an access control proxy, and the data pipeline trust model.

## Scope

**In scope (off-chain, AUTH-01 lens):**
- Webhook authentication (`app/app/api/webhooks/helius/route.ts`)
- Rate limiting as access control (`app/lib/rate-limit.ts`)
- SSE connection gating (`app/lib/sse-connections.ts`)
- All API route authentication (or lack thereof)
- Wallet signing flow (`app/hooks/useProtocolWallet.ts`)
- Crank wallet loading (`scripts/crank/crank-provider.ts`)
- Security headers and CSP (`app/next.config.ts`)
- Middleware site-mode routing (`app/middleware.ts`)

**Out of scope:** Anchor/Rust on-chain programs (run SOS for on-chain audit).

## Key Mechanisms

### 1. Webhook Authentication (HELIUS_WEBHOOK_SECRET)

**Location:** `app/app/api/webhooks/helius/route.ts:255-301`

**Flow:**
1. Rate limit check (IP-based, 120/min)
2. Production fail-closed: if `HELIUS_WEBHOOK_SECRET` is unset in production, return 500
3. If secret is set: extract `Authorization` header, compare with `timingSafeEqual()`
4. Length-mismatch handling: if lengths differ, compare secret against itself (preserves constant time), then reject
5. On match: proceed to payload processing

**Analysis:**
- **Constant-time comparison**: Correctly uses `timingSafeEqual()` from `node:crypto`. This prevents timing side-channel attacks where an attacker measures response time to deduce the secret byte-by-byte.
- **Length-mismatch branch**: Lines 295-298 handle the case where `secretBuf.length !== headerBuf.length`. Instead of short-circuiting (which would leak "wrong length"), it compares `secretBuf` against itself (always true, same time) then rejects. This is textbook correct.
- **Fail-closed production behavior**: Lines 273-284 ensure that a missing secret in production causes ALL requests to be rejected with 500. This prevents accidentally deploying without webhook auth.
- **Non-production skip**: When `NODE_ENV !== "production"` AND no secret is set, auth is skipped entirely. This allows local development without configuring a webhook secret.

**Concern: Not HMAC-based.** Helius uses a simple shared secret in the Authorization header, not HMAC-SHA256 of the request body. This means:
- The secret is replayable: anyone who intercepts one request can replay the Authorization header on future requests.
- The body integrity is not verified: an attacker who knows the secret could modify the payload (though HTTPS prevents in-transit modification).
- This is Helius's design, not a code bug. The code correctly implements what Helius provides.

**Concern: Enhanced webhooks lack replay protection.** Raw TX webhooks have a 5-minute `blockTime` freshness check (lines 361-388). Enhanced account change webhooks (the `handleAccountChanges` path, lines 525-633) have no timestamp or freshness check. An attacker who captures an enhanced webhook payload could replay it days later to inject stale account state.

### 2. Rate Limiting

**Location:** `app/lib/rate-limit.ts`

**Implementation:** In-memory sliding window counter. Per-IP timestamps stored in a `Map`. Periodic cleanup every 60 seconds.

**Profiles:**
| Endpoint | Window | Max Requests |
|----------|--------|-------------|
| `/api/rpc` | 60s | 300 |
| `/api/sol-price` | 60s | 30 |
| `/api/webhooks/helius` | 60s | 120 |

**Not rate-limited:**
- `/api/candles` -- Postgres query, limit parameter capped at 2000 rows
- `/api/carnage-events` -- Postgres query, fixed 5 rows
- `/api/health` -- Lightweight checks
- `/api/sse/protocol` -- SSE connection (has connection cap instead)
- `/api/sse/candles` -- SSE connection (has connection cap instead)

**IP Extraction Analysis (`getClientIp`):**
- Reads `x-forwarded-for` header, takes first IP (leftmost)
- Falls back to `x-real-ip`
- Falls back to `"unknown"` (all requests share one bucket)
- In production, logs a warning if no proxy headers found
- **Risk:** The function trusts `x-forwarded-for` unconditionally. Behind Railway's proxy this is safe (Railway strips client-sent XFF and adds the real IP). If the app were ever deployed without a trusted reverse proxy, an attacker could spoof arbitrary IPs via the `x-forwarded-for` header.

**Cleanup:** Every 60 seconds, entries older than 5 minutes are swept. The `globalThis` singleton pattern prevents duplicate intervals during HMR.

### 3. SSE Connection Gating

**Location:** `app/lib/sse-connections.ts`

**Limits:**
- `MAX_PER_IP = 10` (5 tabs x 2 SSE routes per user)
- `MAX_GLOBAL = 5000` (500 users x 2 SSE routes x 5x headroom)
- `MAX_CONNECTION_MS = 30 * 60_000` (30-minute safety timeout)

**Analysis:**
- `acquireConnection(ip)` checks both per-IP and global caps before allowing a new SSE stream
- `releaseConnection(ip)` is idempotent (floor at 0)
- `scheduleAutoRelease(ip)` sets a 30-minute timeout to reclaim zombie connections
- Double-release protection with `released` boolean flag
- globalThis singleton survives HMR

**Not authentication:** This is a resource exhaustion defense, not identity verification. Any IP can open up to 10 SSE connections and receive all protocol data.

### 4. RPC Proxy Method Allowlist

**Location:** `app/app/api/rpc/route.ts:31-58`

**Allowlisted methods (17):**
`getAccountInfo`, `getBalance`, `getMultipleAccounts`, `getTokenAccountsByOwner`, `getTokenAccountBalance`, `getProgramAccounts`, `getLatestBlockhash`, `sendTransaction`, `simulateTransaction`, `getSignatureStatuses`, `confirmTransaction`, `getBlockHeight`, `getSlot`, `getAddressLookupTable`, `getPriorityFeeEstimate`, `getMinimumBalanceForRentExemption`

**Analysis:**
- The allowlist prevents arbitrary RPC method calls through the proxy (e.g., `requestAirdrop`, admin methods)
- `sendTransaction` is intentionally allowed because users need to submit signed transactions
- The proxy protects the Helius API key (only in `HELIUS_RPC_URL`, a server-side env var)
- Batch requests are supported and each method in the batch is validated
- Failover to fallback endpoints (`HELIUS_RPC_URL_FALLBACK`, `NEXT_PUBLIC_RPC_URL`)
- Endpoint URLs are masked in logs to avoid leaking API keys

### 5. Wallet Signing (Client-Side)

**Location:** `app/hooks/useProtocolWallet.ts`

**Pattern:** Sign-then-send.
1. `signTransaction(tx)` -- wallet signs (Phantom popup, Blowfish simulation)
2. `connection.sendRawTransaction(serialized)` -- app submits via Helius RPC

**Why not `sendTransaction()`:** Phantom's `signAndSendTransaction` sends via Phantom's own RPC, which silently drops devnet TXs. Sign-then-send gives the app control over which RPC receives the TX.

**No server-side keys:** The frontend app never has access to private keys. All signing happens in the wallet extension. This is the correct pattern for a DeFi frontend.

### 6. Crank Wallet Loading

**Location:** `scripts/crank/crank-provider.ts:34-80`

**Priority:**
1. `WALLET_KEYPAIR` env var (JSON byte array) -- used on Railway
2. `WALLET` env var (file path)
3. `keypairs/devnet-wallet.json` (committed, devnet only)

**Analysis:**
- The JSON byte array approach avoids file system dependency on Railway
- Error messages are truncated (`String(err).slice(0, 100)`) to avoid leaking key material
- Wallet public key is logged (first 12 chars) for diagnostics -- safe (public key is public)
- The devnet wallet file is committed to git (devnet only, acceptable risk per H005)

### 7. Security Headers

**Location:** `app/next.config.ts`

**Headers applied to all routes:**
- `Content-Security-Policy`: Strict CSP with `default-src 'self'`, cluster-aware Helius domains, Sentry ingest, WalletConnect relay
- `X-Frame-Options: DENY` -- prevents clickjacking
- `X-Content-Type-Options: nosniff` -- prevents MIME confusion
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (HSTS, 2 years)

**CSP Analysis:**
- `script-src 'self' 'unsafe-inline'` -- `unsafe-inline` is needed for Next.js style injection but weakens XSS protection. However, combined with React's auto-escaping (FP-008), this is standard for Next.js apps.
- `connect-src` includes Helius RPC (HTTPS + WSS), WalletConnect relay, Sentry ingest, and Helius REST API
- `frame-ancestors 'none'` -- prevents embedding in iframes
- `upgrade-insecure-requests` -- forces HTTPS

### 8. Middleware

**Location:** `app/middleware.ts`

**Function:** Site-mode toggle. In `launch` mode, redirects all non-`/launch` and non-`/api` routes to `/launch`. In `live` mode, passes through.

**Not a security control:** This is a UX feature for the bonding curve launch phase. API routes are explicitly excluded from the redirect, so it provides no authentication or access control.

## Trust Model

```
                    UNTRUSTED                    SEMI-TRUSTED              TRUSTED
                    ---------                    ------------              -------
  Browser           ---->  API Routes (no auth)  ---->  DB (Postgres)
  (any client)             SSE Routes (no auth)        Protocol Store
                           RPC Proxy (allowlist)

  Helius             ---->  Webhook Route         ---->  Protocol Store
  (shared secret)          (timingSafeEqual)            SSE Broadcast

  Crank Runner       ---->  Solana RPC (direct)
  (private key in env)
```

**Trust boundaries:**
1. **Browser -> Server:** Zero trust. No user identity. Rate limiting is the only defense.
2. **Helius -> Server:** Shared-secret trust. `timingSafeEqual` + fail-closed + rate limit.
3. **Crank -> Blockchain:** Full trust (holds private key). Isolated on Railway.
4. **Server -> Blockchain:** Read-only via Helius RPC. Helius API key server-side only.

## State Analysis

**No session state.** There are no user sessions, cookies, or server-side session stores. The application is entirely stateless from an authentication perspective.

**In-memory state that matters:**
- `protocolStore` (globalThis singleton): Holds cached account data, writeable by webhook handler and ws-subscriber. Any authenticated webhook call can overwrite state.
- `sseManager` (globalThis singleton): Subscriber set for SSE broadcast. No authentication on subscribe.
- Rate limiter state (`entries` Map): Per-IP request timestamps. Memory-bounded by cleanup interval.
- SSE connection state (`state` Map): Per-IP connection counts. Memory-bounded by auto-release.

## Dependencies

**External APIs accessed server-side:**
- **Helius RPC** (`HELIUS_RPC_URL`): Solana RPC queries and transaction submission
- **Helius Webhook API** (`api.helius.xyz`): Webhook management (via `scripts/webhook-manage.ts`)
- **CoinGecko** (`api.coingecko.com`): SOL/USD price (no API key)
- **Binance** (`api.binance.com`): SOL/USDT price fallback (no API key)

**None of these dependencies require authentication from the browser.** All API keys are server-side only.

## Focus-Specific Analysis

### AIP-011 through AIP-025 Applicability Check

| AI Pitfall | Applicable? | Notes |
|-----------|-------------|-------|
| AIP-011: JWT without algorithm pinning | NO | No JWTs in codebase |
| AIP-012: Hardcoded JWT secrets | NO | No JWTs |
| AIP-013: SHA-256 password hashing | NO | No password hashing |
| AIP-014: Missing session regeneration | NO | No sessions |
| AIP-015: IDOR in CRUD endpoints | NO | No CRUD endpoints with ownership |
| AIP-016: OAuth without state | NO | No OAuth |
| AIP-017: Account enumeration | NO | No user accounts |
| AIP-018: Cookie missing security flags | NO | No cookies set |
| AIP-019: Auth checks only in frontend | PARTIAL | Middleware is UI-only gating; API routes have no auth (correct for permissionless) |
| AIP-020: Mass assignment | NO | No user-facing mutations on server |
| AIP-021: No rate limiting on auth | PARTIAL | Webhook has rate limiting; no other auth endpoints exist |
| AIP-022: JWTs that never expire | NO | No JWTs |
| AIP-023: Password comparison with === | NO | No passwords. Webhook secret uses timingSafeEqual (correct) |
| AIP-024: Logout clears only cookie | NO | No sessions/logout |
| AIP-025: Refresh tokens in localStorage | NO | No tokens. Only `slippageBps` settings in localStorage (non-sensitive) |

### OC Pattern Applicability Check

| Pattern | Applicable? | Notes |
|---------|-------------|-------|
| OC-021-024: JWT issues | NO | No JWTs |
| OC-025-026: Password hashing | NO | No passwords |
| OC-027-028: OAuth issues | NO | No OAuth |
| OC-029: Brute force login | NO | No login. Webhook has rate limiting. |
| OC-030-031: Account enumeration | NO | No accounts |
| OC-032-039: Session management | NO | No sessions |
| OC-040: Missing endpoint authorization | YES | All API endpoints are open (by design) |
| OC-041: IDOR | NO | No user-owned resources |
| OC-042: Vertical privilege escalation | NO | No roles/privileges |
| OC-043: Frontend-only auth | PARTIAL | Middleware is frontend-only, but correctly excludes /api |
| OC-044: Role bypass via params | NO | No roles |
| OC-045: API key in URL | WATCH | HELIUS_API_KEY appears in `.env.devnet` CLUSTER_URL param |
| OC-046: Refresh token reuse | NO | No tokens |
| OC-047: Token not scoped | NO | N/A |
| OC-048: MFA bypass | NO | No MFA |
| OC-095-096: CSRF | PARTIAL | API is JSON-only (FP-006 applies), no state-changing forms |
| OC-104: Cookie scope | NO | No cookies |
| OC-131: Mass assignment | NO | No user mutations |
| OC-139: GraphQL field auth | NO | No GraphQL |
| OC-140: WebSocket without auth | YES | SSE streams (equivalent) have no auth |

## Cross-Focus Intersections

### AUTH-01 x SEC-02 (Secret Management)
The `HELIUS_WEBHOOK_SECRET` is the most security-critical secret after the crank private key. Its management crosses into SEC-02 territory:
- How is it set on Railway? (env var dashboard)
- Is it in git history? (need to verify)
- Can it be rotated without downtime? (currently no rotation support -- single secret)

### AUTH-01 x API-01 (API Security)
The lack of API authentication is a deliberate design choice for a permissionless protocol, but it means:
- SSE streams are open data feeds (API-01 should assess data sensitivity)
- The RPC proxy is a public Helius relay (API-01 should assess abuse potential)
- Rate limiting is the only defense at the API boundary

### AUTH-01 x ERR-03 (Rate Limiting)
Rate limiting serves as a proxy for authentication in this codebase:
- Webhook: 120/min per IP
- RPC proxy: 300/min per IP
- SOL price: 30/min per IP
- SSE: 10 connections per IP, 5000 global
- Missing: candles, carnage-events, health (no rate limits)

### AUTH-01 x CHAIN-02 (RPC Trust)
The connection factory (`app/lib/connection.ts`) routes browser RPC through `/api/rpc` to keep the Helius API key server-side. This is an access control mechanism: the key acts as authentication to Helius. If the proxy were bypassed, the key could be exposed.

## Cross-Reference Handoffs

| Handoff To | Item | Context |
|-----------|------|---------|
| SEC-02 | `.env.devnet` committed with Helius API key | File tracked by git: `HELIUS_API_KEY=[REDACTED-DEVNET-KEY]-...` |
| SEC-02 | Webhook secret rotation capability | No support for dual-secret rotation |
| API-01 | SSE endpoints unauthenticated | `/api/sse/protocol` and `/api/sse/candles` open to any client |
| ERR-03 | Missing rate limits on candles/carnage-events | DB query endpoints with no volumetric defense |
| DATA-04 | Health endpoint exposes internals | WS subscriber state, credit counter stats visible |
| WEB-02 | CSP `unsafe-inline` for scripts | Standard for Next.js but weakens XSS protection |

## Risk Observations

### 1. Enhanced Webhook Replay (MEDIUM)
**File:** `app/app/api/webhooks/helius/route.ts:525-633`
**Observation:** The raw transaction webhook path has a 5-minute freshness check on `blockTime` (line 382). The enhanced account change path (`handleAccountChanges`) has no equivalent check. Enhanced webhooks carry account data updates that are written directly to the protocol store and broadcast to all SSE clients.
**Impact:** An attacker who captures a valid webhook payload (HTTPS intercept, log exposure) could replay it to inject stale or misleading account state. The `updatedAt: Date.now()` field would make the stale data appear fresh.
**Mitigation consideration:** Add a timestamp or sequence number check to enhanced webhook processing.

### 2. Unauthenticated SSE Streams (MEDIUM)
**File:** `app/app/api/sse/protocol/route.ts:41-49`
**Observation:** Any HTTP client can open an SSE connection and receive real-time decoded protocol state. This includes parsed EpochState (tax rates, VRF state), PoolState (reserves), StakePool (staker data), and CurveState.
**Impact:** Low (data is on-chain and public), but the SSE stream provides higher-frequency pre-parsed data that could advantage automated trading bots. Connection limits mitigate volume but not access.
**Mitigation consideration:** If selective access is desired, add a lightweight token-based auth (e.g., signed nonce from connected wallet). However, this may not be needed for a permissionless protocol.

### 3. Rate Limiter IP Spoofing Potential (LOW)
**File:** `app/lib/rate-limit.ts:129-151`
**Observation:** `getClientIp()` trusts `x-forwarded-for` unconditionally. Behind Railway's proxy this is safe (Railway adds the real IP). The production warning for missing proxy headers is good defensive logging. However, if the app is ever deployed without a trusted proxy, all rate limits become bypassable.
**Impact:** Low (currently behind Railway proxy). Would become high if deployment architecture changes.

### 4. Missing Rate Limits on DB Query Endpoints (MEDIUM)
**File:** `app/app/api/candles/route.ts`, `app/app/api/carnage-events/route.ts`
**Observation:** These endpoints query Postgres directly with no rate limiting. The candles endpoint accepts `pool`, `resolution`, `from`, `to`, `limit` parameters and executes `SELECT` queries with `WHERE` clauses. While the `limit` parameter is capped at 2000, rapid repeated queries could exhaust the Postgres connection pool.
**Impact:** Denial of service on the data layer. Candle queries with large time ranges and no `limit` could be expensive.

### 5. Health Endpoint Information Disclosure (LOW)
**File:** `app/app/api/health/route.ts:32-73`
**Observation:** Returns Postgres connectivity, Solana RPC status, WebSocket subscriber state (connected, slot, polling timers), and RPC credit counter stats. No authentication required.
**Impact:** Attacker can fingerprint the deployment, monitor for degradation, and time attacks for when systems are under stress. Previously flagged as H028 (LOW, NOT_FIXED) in Audit #1 -- accepted risk.

### 6. .env.devnet API Key in Git (LOW)
**File:** `.env.devnet` (tracked by git)
**Observation:** Contains `HELIUS_API_KEY=[REDACTED-DEVNET-HELIUS-KEY]` and `CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]-...`. This is a devnet key (low impact) but the pattern of committing API keys to git is concerning. Previously flagged as H005 (partially fixed) in Audit #1.
**Impact:** Devnet Helius API key exposed. Could be used to register rogue webhooks or exhaust rate limits on the devnet plan. Not impactful for mainnet (separate key, not committed).

### 7. Webhook Secret Not HMAC-Based (LOW)
**File:** `app/app/api/webhooks/helius/route.ts:286-301`
**Observation:** Helius sends the secret as a raw value in the Authorization header, not as an HMAC signature of the request body. This is Helius's protocol, not a code bug. The code correctly implements what Helius provides. However, this means body integrity is not cryptographically verified (HTTPS provides integrity in transit, but not at-rest if payloads are logged or cached).
**Impact:** Minimal -- HTTPS covers the transit path. This is a Helius platform limitation, not a code fix.

### 8. Middleware Does Not Protect API Routes (LOW)
**File:** `app/middleware.ts:24-31`
**Observation:** In `launch` mode, the middleware redirects all routes to `/launch` EXCEPT `/api` paths. This is intentional (API routes must remain accessible for webhooks, SSE, RPC proxy). However, it means the "launch mode" is purely a UX feature with no security implications.
**Impact:** None -- this is correctly implemented for its purpose.

### 9. Single-Process Rate Limiter (INFORMATIONAL)
**File:** `app/lib/rate-limit.ts:66`
**Observation:** The rate limiter uses an in-memory `Map`. If Railway ever scales to multiple processes, rate limits would be per-process (effectively multiplied). The code comments acknowledge this (single Railway instance). This was previously flagged as H092 (FIXED for SSE, acknowledged for rate limits).
**Impact:** None currently. Would need Redis if horizontally scaled.

## Novel Attack Surface Observations

### Webhook Secret -> SSE Data Injection Chain
The most novel attack surface in this codebase is the webhook-to-SSE pipeline. If an attacker obtains the `HELIUS_WEBHOOK_SECRET`:
1. Craft a fake enhanced webhook payload with manipulated account data
2. POST to `/api/webhooks/helius` with the correct Authorization header
3. The handler decodes the payload, stores it in `protocolStore`
4. `setAccountState()` broadcasts via SSE to all connected browsers
5. Every connected frontend now displays attacker-controlled data

The dedup guard only prevents re-broadcast of *identical* data. Different (fake) data bypasses it. The only defense is the HTTPS transport security of the webhook secret itself.

This is unique because most DeFi frontends read directly from RPC. This app's SSE architecture creates a single point of data injection that affects all clients simultaneously.

### SSE as Unintentional Data Oracle
The `/api/sse/protocol` endpoint provides parsed, decoded Anchor account data in real-time. While this data is on-chain (public), the SSE stream provides it:
- Pre-decoded (no Borsh deserialization overhead)
- Pre-enriched (with `updatedAt` timestamps)
- In event-driven format (push, not poll)

A trading bot could subscribe to this for lower-latency state awareness than direct RPC polling, using the protocol's own infrastructure.

## Questions for Other Focus Areas

1. **SEC-02:** Is `HELIUS_WEBHOOK_SECRET` in Railway env vars properly secured? Is it in any git history?
2. **API-01:** Should SSE endpoints require a lightweight auth token (e.g., signed wallet message)?
3. **ERR-03:** Should `/api/candles` and `/api/carnage-events` have rate limiting?
4. **DATA-04:** Should `/api/health` strip internal details (WS subscriber state, credit stats)?
5. **INFRA-03:** If Railway auto-scales, will the in-memory rate limiter and SSE connection tracker still work correctly?

## Raw Notes

- Searched for `jwt`, `jsonwebtoken`, `bcrypt`, `argon2`, `OAuth`, `passport`, `session`, `cookie` patterns. None found in the codebase (confirmed: no traditional auth system).
- `localStorage.setItem` used only in `SettingsProvider.tsx` for user preferences (slippage, priority fee). Non-sensitive. Matches FP-015 (no security concern).
- No `Set-Cookie` headers anywhere in the codebase.
- No CORS configuration beyond CSP `connect-src`. Next.js App Router defaults to same-origin, which is correct (FP -- H115 cleared in Audit #1).
- The `SUPERMEMORY_CC_API_KEY` in `.env.devnet` appears to be a Supermemory (CC context caching) API key, not related to the protocol. Still committed to git.
- Webhook management script (`scripts/webhook-manage.ts`) properly requires `WEBHOOK_URL` env var (no default), preventing devnet/mainnet cross-contamination (VH-M001).
- The `createWebhook` function sets `authHeader` only if `HELIUS_WEBHOOK_SECRET` is set. If omitted, the webhook is created without auth. The script warns about this but does not block.
