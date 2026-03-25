---
task_id: db-phase1-infra-03-cloud-env
provides: [infra-03-cloud-env-findings, infra-03-cloud-env-invariants]
focus_area: infra-03-cloud-env
files_analyzed: [app/instrumentation.ts, app/next.config.ts, app/lib/sse-connections.ts, app/lib/sse-manager.ts, app/lib/protocol-config.ts, app/lib/connection.ts, app/lib/ws-subscriber.ts, app/lib/protocol-store.ts, app/lib/credit-counter.ts, app/lib/rate-limit.ts, app/lib/sentry.ts, app/db/connection.ts, app/middleware.ts, app/app/api/sse/protocol/route.ts, app/app/api/sse/candles/route.ts, app/app/api/health/route.ts, app/app/api/rpc/route.ts, app/providers/ClusterConfigProvider.tsx, scripts/load-test/run.ts, scripts/load-test/k6-sse.js, railway.toml, railway-crank.toml, .github/workflows/ci.yml, .env, .env.devnet, .env.mainnet, app/.env.local, app/.env.mainnet, .gitignore, app/.gitignore]
finding_count: 12
severity_breakdown: {critical: 1, high: 3, medium: 4, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# INFRA-03: Cloud & Environment Configuration -- Condensed Summary

## Key Findings (Top 10)

1. **CRITICAL: .env.mainnet contains live mainnet secrets committed to working tree**: Mainnet Helius API key, crank wallet private key (full 64-byte secret key as JSON array), and webhook HMAC secret are present in `.env.mainnet`. While the root `.gitignore` has `.env.mainnet` on line 2, the file exists in the working directory and git status shows it as tracked/modified. The crank wallet private key (`WALLET_KEYPAIR=[REDACTED]`) provides direct SOL signing capability. -- `.env.mainnet:30-31,88,106`

2. **HIGH: .env (root) contains Helius devnet API key and SUPERMEMORY API key committed to git**: `.env` is listed in `.gitignore` but git status shows `M .env.devnet` (modified), and `.env` itself contains `HELIUS_API_KEY=[REDACTED-DEVNET-KEY]-...` and `SUPERMEMORY_CC_API_KEY=[REDACTED-SUPERMEMORY]-...`. The `.env.devnet` file explicitly comments "devnet credentials are non-sensitive" but SUPERMEMORY_CC_API_KEY looks like a third-party credential. -- `.env:1-2`, `.env.devnet:5`

3. **HIGH: No startup validation for critical environment variables**: The codebase uses `process.env.X || "default"` or `process.env.X ?? fallback` pattern extensively without centralized startup validation. Critical variables like `HELIUS_RPC_URL`, `HELIUS_WEBHOOK_SECRET`, `DATABASE_URL`, `WS_SUBSCRIBER_ENABLED` are checked at point-of-use with varying failure modes (throw, silent default, warn-and-continue). No envalid/zod schema validation at startup. -- `app/lib/connection.ts:41-44`, `app/lib/ws-subscriber.ts:451`, `app/db/connection.ts:40-46`

4. **HIGH: Health endpoint exposes internal infrastructure details without authentication**: `/api/health` returns wsSubscriber status (initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive), credit counter stats (totalCalls, per-method breakdown, startedAt timestamp), Postgres connectivity, and RPC status. No authentication middleware. This was previously flagged as H028 (NOT_FIXED). -- `app/app/api/health/route.ts:66-72`

5. **MEDIUM: NEXT_PUBLIC_CLUSTER defaults to "devnet" when unset**: Both `app/next.config.ts:10` and `app/lib/protocol-config.ts:25` use `process.env.NEXT_PUBLIC_CLUSTER || "devnet"` fallback. If the env var is accidentally omitted on a mainnet Railway deploy, the entire frontend silently operates against devnet addresses, CSP allows devnet Helius domain, and protocol-config resolves devnet mints/pools. -- `app/next.config.ts:10`, `app/lib/protocol-config.ts:25`

6. **MEDIUM: Polling intervals configurable via env vars without bounds validation**: `SLOT_BROADCAST_INTERVAL_MS`, `TOKEN_SUPPLY_POLL_INTERVAL_MS`, and `STAKER_COUNT_POLL_INTERVAL_MS` are parsed with `parseInt()` with no minimum/maximum bounds. Setting `STAKER_COUNT_POLL_INTERVAL_MS=100` would fire expensive `getProgramAccounts` calls 10x/second, exhausting Helius credits rapidly. -- `app/lib/ws-subscriber.ts:251-253,331-333,369-371`

7. **MEDIUM: CSP script-src includes 'unsafe-inline'**: The Content Security Policy allows `'unsafe-inline'` for both script-src and style-src. While style-src unsafe-inline is common (Next.js injects styles), script-src unsafe-inline weakens XSS protection. Previously flagged as H025. -- `app/next.config.ts:33`

8. **MEDIUM: Railway healthcheck always returns HTTP 200**: Per design comment and H085 (ACCEPTED_RISK), the health endpoint always returns 200 even when dependencies are degraded. The body differentiates "ok" vs "degraded" but Railway healthcheck only reads HTTP status. A fully broken Postgres + RPC server would still pass Railway's liveness check. -- `app/app/api/health/route.ts:61`

9. **LOW: CI workflow has no permissions block**: `.github/workflows/ci.yml` omits the `permissions:` key entirely, defaulting to broad read/write access (AIP-108 pattern). The workflow only needs `contents: read`. -- `.github/workflows/ci.yml:17-28`

10. **LOW: SSE connection limits are hardcoded, not configurable**: `MAX_PER_IP=10` and `MAX_GLOBAL=5000` in `sse-connections.ts` are compile-time constants. If mainnet needs different limits, a code change + redeploy is required. Not configurable via env var. -- `app/lib/sse-connections.ts:23-24`

## Critical Mechanisms

- **Cluster-Aware Address Resolution**: `protocol-config.ts` reads `NEXT_PUBLIC_CLUSTER` at module evaluation time and resolves ALL protocol addresses (mints, pools, PDAs, program IDs) from `getClusterConfig()`. This is the single point where devnet/mainnet address sets diverge. If this resolves wrong, every transaction targets wrong accounts. -- `app/lib/protocol-config.ts:25-28`

- **RPC Proxy with Method Allowlist**: `/api/rpc` proxies browser JSON-RPC to Helius, keeping the API key server-side. Uses a hardcoded `ALLOWED_METHODS` set (17 methods) and failover between up to 3 endpoints. Sticky routing via `lastSuccessfulEndpoint`. -- `app/app/api/rpc/route.ts:31-59,128-137`

- **WS Subscriber Feature Flag + Boot Sequence**: `WS_SUBSCRIBER_ENABLED` env var must be `"true"` (exact string match) to activate. Called from `instrumentation.ts` which runs at Next.js server boot. Double-init guarded by `state.initialized` flag on globalThis singleton. -- `app/lib/ws-subscriber.ts:450-474`, `app/instrumentation.ts:9-29`

- **SSE Connection Tracking**: `sse-connections.ts` tracks per-IP and global connection counts. Both SSE routes (`/api/sse/protocol`, `/api/sse/candles`) call `acquireConnection()` before creating the ReadableStream and `releaseConnection()` on disconnect. 30-minute zombie timeout via `scheduleAutoRelease()`. -- `app/lib/sse-connections.ts:49-103`

- **Database TLS Enforcement**: `db/connection.ts` conditionally enables `ssl: "require"` when `NODE_ENV === "production"`. Non-production connections to remote hosts emit a console warning. -- `app/db/connection.ts:51-52`

- **Railway Deployment**: No Dockerfile -- uses Nixpacks builder. Health check at `/api/health` with 120s timeout. Pre-deploy runs DB migrations. ON_FAILURE restart with 3 retries. Crank service has separate `railway-crank.toml` with 10 retries. -- `railway.toml:1-11`, `railway-crank.toml:1-8`

## Invariants & Assumptions

- INVARIANT: HELIUS_WEBHOOK_SECRET must be set in production or all webhooks are rejected (fail-closed) -- enforced at `app/app/api/webhooks/helius/route.ts:270-271`
- INVARIANT: DATABASE_URL must be set or server throws at first DB access -- enforced at `app/db/connection.ts:41-46`
- INVARIANT: HELIUS_RPC_URL (or NEXT_PUBLIC_RPC_URL) must be set for server-side RPC -- enforced at `app/lib/connection.ts:43`
- INVARIANT: SSE connection count per IP never exceeds MAX_PER_IP (10) -- enforced at `app/lib/sse-connections.ts:52`
- INVARIANT: SSE global connection count never exceeds MAX_GLOBAL (5000) -- enforced at `app/lib/sse-connections.ts:50`
- ASSUMPTION: NEXT_PUBLIC_CLUSTER is correctly set to "mainnet" on Railway mainnet service -- UNVALIDATED (silent devnet fallback)
- ASSUMPTION: Railway sets NODE_ENV=production automatically -- UNVALIDATED in code (relied on implicitly for DB TLS, rate-limit behavior, webhook auth)
- ASSUMPTION: Railway reverse proxy sets x-forwarded-for header -- validated at runtime with production warning if missing (`app/lib/rate-limit.ts:142-148`)
- ASSUMPTION: Single-process deployment (SSE manager, protocol store, rate limiter all in-memory) -- documented design choice, would break silently with horizontal scaling

## Risk Observations (Prioritized)

1. **Mainnet secret key in .env.mainnet**: Full crank wallet secret key as JSON byte array. Even though gitignored, the file is in the working tree. If the gitignore rule ever fails or the file is accidentally committed, all crank SOL is at risk. -- `.env.mainnet:88`
2. **No centralized env var validation**: Missing vars surface as runtime errors (throws, silent degradation) rather than startup failures. A Railway misconfiguration could leave the app running but broken. AIP-113 pattern. -- multiple files
3. **Cluster default to devnet**: A missing `NEXT_PUBLIC_CLUSTER` on mainnet would route all user transactions to devnet addresses, effectively bricking the mainnet frontend while appearing to work. -- `app/lib/protocol-config.ts:25`
4. **Health endpoint information disclosure**: Exposes internal timing (lastSlotReceivedAt), infrastructure state (wsConnected, fallbackActive), and credit consumption patterns to unauthenticated callers. Useful for attacker reconnaissance. -- `app/app/api/health/route.ts:66-72`
5. **Unbounded polling intervals**: Setting `STAKER_COUNT_POLL_INTERVAL_MS=1` would hammer RPC with expensive gPA calls. No floor enforced. -- `app/lib/ws-subscriber.ts:369-371`

## Novel Attack Surface

- **SSE Zombie Connection Amplification**: The 30-minute auto-release timeout in `scheduleAutoRelease()` means a client that opens 10 connections and immediately crashes (no TCP FIN) ties up 10 per-IP slots for 30 minutes. With NAT/CGNAT where many users share an IP, a single crashed client could exhaust the per-IP limit for legitimate users behind the same NAT. The `released` flag prevents double-release but the timeout is generous.

- **Cluster Config Poisoning via Build Cache**: `NEXT_PUBLIC_CLUSTER` is inlined at build time by Next.js. If Railway caches a previous build artifact where NEXT_PUBLIC_CLUSTER was devnet, and the env var is then changed to mainnet without a full rebuild, the cached build retains the devnet addresses. Railway's Nixpacks builder behavior with env var changes needs verification.

## Cross-Focus Handoffs

- -> **SEC-02 (Secrets & Credentials)**: `.env.mainnet` contains mainnet crank wallet private key and Helius API key. Verify these are not in git history. Verify `.env` SUPERMEMORY_CC_API_KEY sensitivity.
- -> **INFRA-05 (Monitoring & Observability)**: `/api/health` H028 (info disclosure) and H085 (always-200) are infrastructure monitoring concerns.
- -> **ERR-01 (Error Handling)**: `instrumentation.ts` wraps ws-subscriber init in try/catch but failure means degraded SSE data. Verify downstream consumers handle missing data gracefully.
- -> **CHAIN-02 (RPC Node Trust)**: RPC proxy failover logic in `/api/rpc` determines which Helius endpoint is used. Sticky routing state is in-memory and resets on process restart.

## Trust Boundaries

The infrastructure trust model relies on Railway as the deployment platform. Railway manages TLS termination, reverse proxying (x-forwarded-for), process management, and environment variable injection. The application trusts Railway to correctly set NODE_ENV=production, provide x-forwarded-for headers, and isolate env vars between services. All secrets (Helius API keys, webhook HMAC, DATABASE_URL, crank wallet) are stored as Railway env vars and never sent to the browser (no NEXT_PUBLIC_ prefix for sensitive values). The single-process architecture means all server-side state (SSE connections, rate limits, protocol store, credit counter) is process-local -- Railway's container restart policy provides the only recovery mechanism for corrupted in-memory state. The CSP and security headers provide browser-side defense but rely on correct cluster configuration to whitelist the right external domains.
<!-- CONDENSED_SUMMARY_END -->

---

# INFRA-03: Cloud & Environment Configuration -- Full Analysis

## Executive Summary

The Dr. Fraudsworth project deploys on Railway (Nixpacks, no Docker) with a Next.js frontend + API routes and a separate crank runner service. Cloud configuration is managed through environment variables with cluster-aware address resolution. The infrastructure demonstrates several mature patterns (API key proxying, fail-closed webhook auth, SSL enforcement, CSP headers) but has notable gaps in centralized env var validation, secret management hygiene, and health endpoint access control. The most critical finding is the presence of a mainnet crank wallet private key in `.env.mainnet` in the working tree.

## Scope

All off-chain infrastructure, configuration, and deployment files. On-chain Anchor programs are out of scope.

**Files analyzed (30):**
- Configuration: `next.config.ts`, `railway.toml`, `railway-crank.toml`
- Environment: `.env`, `.env.devnet`, `.env.mainnet`, `app/.env.local`, `app/.env.mainnet`
- Boot: `instrumentation.ts`, `middleware.ts`
- SSE Infrastructure: `sse-connections.ts`, `sse-manager.ts`, `app/api/sse/protocol/route.ts`, `app/api/sse/candles/route.ts`
- Data Pipeline: `ws-subscriber.ts`, `protocol-store.ts`, `credit-counter.ts`
- Connection: `connection.ts`, `anchor.ts`, `protocol-config.ts`
- API: `app/api/health/route.ts`, `app/api/rpc/route.ts`
- Rate Limiting: `rate-limit.ts`
- Database: `db/connection.ts`
- CI/CD: `.github/workflows/ci.yml`
- Providers: `ClusterConfigProvider.tsx`
- Load Test: `scripts/load-test/run.ts`, `scripts/load-test/k6-sse.js`
- Git: `.gitignore`, `app/.gitignore`

## Key Mechanisms

### 1. Railway Deployment Configuration

**railway.toml** (app service):
- Builder: Nixpacks (no Dockerfile means no Docker-specific pitfalls like AIP-104/105/106/111/112)
- Build: `npm run --workspace app build`
- Start: `npm run --workspace app start`
- Pre-deploy: `npx tsx app/db/migrate.ts` (runs DB migrations before new version starts)
- Healthcheck: `/api/health` with 120s timeout
- Restart: ON_FAILURE, max 3 retries

**railway-crank.toml** (crank service):
- Builder: Nixpacks
- Build: `npm install` (no app build needed)
- Start: `npx tsx scripts/crank/crank-runner.ts`
- Restart: ON_FAILURE, max 10 retries (more aggressive because crank downtime = missed epoch transitions)
- No healthcheck configured for crank service

**Observation**: The crank service has no healthcheck endpoint. If the crank process hangs (e.g., stuck on an RPC call), Railway has no way to detect it short of the process crashing. The crank has an internal health endpoint (HEALTH_PORT=8080 in `.env.mainnet`) but `railway-crank.toml` doesn't reference `healthcheckPath`.

### 2. Environment Variable Architecture

The project uses a layered env var strategy:

| Layer | File | Committed | Purpose |
|-------|------|-----------|---------|
| Root deploy | `.env` | Gitignored (but present) | Default devnet deploy config |
| Devnet deploy | `.env.devnet` | **Committed** | Devnet deploy config (explicitly non-sensitive) |
| Mainnet deploy | `.env.mainnet` | **Gitignored** | Mainnet deploy config with secrets |
| App local | `app/.env.local` | Gitignored | Local dev frontend config |
| App mainnet template | `app/.env.mainnet` | Gitignored | Railway env var reference |

**NEXT_PUBLIC_ prefix convention**: Correctly used for browser-visible vars (`NEXT_PUBLIC_CLUSTER`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SITE_MODE`, `NEXT_PUBLIC_CURVE_PHASE`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_COMMIT_SHA`). Sensitive vars (`HELIUS_RPC_URL`, `HELIUS_WEBHOOK_SECRET`, `DATABASE_URL`, `WALLET_KEYPAIR`) correctly omit the prefix.

**Critical env vars and their validation:**

| Env Var | Validated? | Failure Mode | File |
|---------|-----------|-------------|------|
| `DATABASE_URL` | Yes (throw) | Server crash on first DB access | `db/connection.ts:42` |
| `HELIUS_RPC_URL` | Yes (throw) | Server crash on first server-side RPC | `connection.ts:43` |
| `HELIUS_WEBHOOK_SECRET` | Partial | Production: reject all webhooks. Non-prod: accept all | `webhooks/helius/route.ts:270-271` |
| `NEXT_PUBLIC_CLUSTER` | No | Silent devnet fallback | `protocol-config.ts:25` |
| `WS_SUBSCRIBER_ENABLED` | No | Silent disable (logged) | `ws-subscriber.ts:451` |
| `NODE_ENV` | No | Implicit Railway default. Affects DB TLS, rate-limit warnings | Multiple |
| `SLOT_BROADCAST_INTERVAL_MS` | No | parseInt with fallback, no bounds | `ws-subscriber.ts:252` |
| `TOKEN_SUPPLY_POLL_INTERVAL_MS` | No | parseInt with fallback, no bounds | `ws-subscriber.ts:331` |
| `STAKER_COUNT_POLL_INTERVAL_MS` | No | parseInt with fallback, no bounds | `ws-subscriber.ts:370` |

### 3. Content Security Policy

The CSP in `next.config.ts` is cluster-aware -- it whitelists different Helius domains based on `NEXT_PUBLIC_CLUSTER`:

- **Mainnet**: `mainnet.helius-rpc.com` (HTTP + WSS), `api-mainnet.helius-rpc.com`
- **Devnet**: `devnet.helius-rpc.com` (HTTP + WSS), `api.helius.xyz`, `api-devnet.helius-rpc.com`

Common to both: WalletConnect relay, Sentry ingest, self.

**Positive patterns:**
- `default-src 'self'` (restrictive default)
- `object-src 'none'` (blocks Flash/plugins)
- `frame-ancestors 'none'` (prevents clickjacking)
- `base-uri 'self'` (prevents base tag injection)
- `upgrade-insecure-requests` (forces HTTPS)

**Concern:** `script-src 'self' 'unsafe-inline'` weakens XSS protection. If an attacker can inject HTML, they can execute inline scripts. This was previously flagged as H025.

**Additional security headers (all present):**
- HSTS: 2 years, includeSubDomains, preload (H026 fix)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()

### 4. SSE Infrastructure

The SSE system consists of 5 files working together:

```
[ws-subscriber] --> [protocol-store] --> [sse-manager] --> [SSE routes] --> Browser
                     (in-memory cache)    (pub/sub)         (ReadableStream)
```

**Connection limiting (`sse-connections.ts`):**
- Per-IP: 10 connections max
- Global: 5000 connections max
- Zombie cleanup: 30-minute auto-release timer
- Double-release protection via `released` boolean flag
- globalThis singleton survives HMR

**Both SSE routes follow identical pattern:**
1. Extract client IP via `getClientIp()`
2. `acquireConnection()` -- return 429 if capped
3. Create ReadableStream with subscriber
4. 15-second heartbeat (SSE comment format)
5. Abort signal handler for cleanup
6. `cancel()` handler for stream cancellation
7. Response headers: `text/event-stream`, no-cache, keep-alive, X-Accel-Buffering: no

**Observation**: The candle SSE route (`/api/sse/candles`) receives ALL events from `sseManager` (line 71: no event type filter), while the protocol SSE route filters for `protocol-update` only (line 84). This means candle clients also receive protocol-update events (wasted bandwidth, not a security issue).

### 5. GlobalThis Singleton Pattern

Six modules use the globalThis singleton pattern for HMR survival:

| Module | globalThis Key | Purpose |
|--------|---------------|---------|
| `sse-connections.ts` | `sseConnState` | Connection tracking state |
| `sse-manager.ts` | `sseManager` | SSEManager instance |
| `protocol-store.ts` | `protocolStore` | ProtocolStore instance |
| `credit-counter.ts` | `creditCounter` | CreditCounter instance |
| `ws-subscriber.ts` | `wsSubscriber` | WsSubscriberState |
| `db/connection.ts` | `pgClient`, `drizzleDb` | DB connection pool |
| `rate-limit.ts` | Symbol `dr-fraudsworth-rate-limit-cleanup` | Cleanup interval |

All follow the same pattern: `globalForX.y = globalForX.y ?? new Instance()`. The assignment is unconditional (matching the Turbopack requirement from MEMORY.md). In production (single load), globalThis is technically unnecessary but harmless.

**Observation**: `ws-subscriber.ts` assigns the state object unconditionally at line 107 (`globalForWsSub.wsSubscriber = state`), but note that `state` was initialized from `globalForWsSub.wsSubscriber ?? { ...defaults }` on line 94. This means on the first load, it creates defaults and assigns. On HMR re-execution, it re-reads the existing state (preserving WS connection state). This is the correct pattern per MEMORY.md ("Turbopack globalThis singleton -- NEVER use if (NODE_ENV !== production) guard").

### 6. CI/CD Pipeline

`.github/workflows/ci.yml` runs on push to main with two jobs:
- **rust-tests**: cargo test --workspace --features devnet (256 proptest iterations)
- **ts-tests**: anchor test with local validator

**Security observations:**
- No `permissions:` block (AIP-108) -- defaults to broad read/write
- Uses pinned tool versions (Rust 1.93.0, Solana 3.0.13, Anchor 0.32.1, Node 22)
- Uses `actions/checkout@v4`, `actions/cache@v4`, `actions/setup-node@v4` (pinned to major version, not SHA)
- No `${{ github.event.* }}` interpolation in `run:` blocks (no AIP-107 issue)
- No secrets accessed in the workflow (no AIP-114 issue)
- Uses committed `keypairs/devnet-wallet.json` as test keypair (FP-002 pattern -- devnet test wallet, non-sensitive)

### 7. Rate Limiting

`rate-limit.ts` implements a sliding window rate limiter with three profiles:
- RPC proxy: 300 req/min
- SOL price: 30 req/min
- Webhook: 120 req/min

State is in-memory (Map), cleaned up every 60 seconds. Per-endpoint key format: `${ip}:${endpoint}`. IP extraction priority: x-forwarded-for (first IP) > x-real-ip > "unknown" (with production warning).

**Observation**: The "unknown" fallback means all requests without proxy headers share a single rate-limit bucket. This could either be too restrictive (legitimate users compete for 300 RPC req/min) or too permissive (attacker sends 300 requests from different IPs all mapped to "unknown"). The production warning log is appropriate.

## Trust Model

**Trusted:**
- Railway platform (env var injection, TLS termination, process isolation)
- Helius RPC (data integrity for on-chain state)
- Helius webhook payloads (authenticated via HMAC)

**Validated at boundary:**
- Browser RPC requests (method allowlist in `/api/rpc`)
- SSE connections (IP-based rate limiting)
- Webhook payloads (timingSafeEqual HMAC verification)
- Database connections (TLS enforced in production)

**Untrusted:**
- Client IP headers (spoofable but Railway's proxy is trusted to set them)
- Polling interval env vars (not bounds-checked)
- NEXT_PUBLIC_CLUSTER value (not validated, silent fallback)

## State Analysis

### In-Memory State (process-local, lost on restart)

| Store | Module | Contents | Size Risk |
|-------|--------|----------|-----------|
| Rate limit entries | `rate-limit.ts` | IP -> timestamps array | Bounded by 60s cleanup sweep |
| SSE connections | `sse-connections.ts` | IP -> count + global count | Bounded by MAX_GLOBAL (5000) |
| SSE subscribers | `sse-manager.ts` | Set of callbacks | Bounded by SSE connection limit |
| Protocol state | `protocol-store.ts` | pubkey -> account data | Fixed set (~10 accounts + synthetics) |
| Dedup baselines | `protocol-store.ts` | pubkey -> JSON string | Same size as accounts |
| Credit stats | `credit-counter.ts` | method -> count | Fixed key set (~17 methods) |
| WS subscriber state | `ws-subscriber.ts` | Timers, connection state | Fixed size |
| DB connections | `db/connection.ts` | Postgres pool (max 10) | Pool-limited |
| RPC connection | `connection.ts` | Single Connection instance | Fixed size |

**Memory growth risk**: Rate limiter's `entries` Map could grow if many unique IPs hit the server. The 60-second cleanup with 5-minute stale threshold bounds this. With 300 req/min limit, a sustained attack from many IPs would add one Map entry per IP. At 10KB per entry (generous), 100K unique IPs = ~1GB. This is an acceptable upper bound given Railway's container memory limits would trigger an OOM restart first.

### Persistent State

| Store | Connection | TLS | Module |
|-------|-----------|-----|--------|
| PostgreSQL | DATABASE_URL env var | `ssl: "require"` in production | `db/connection.ts` |

No Redis, no file-based caches, no local storage on server.

## Dependencies (External APIs, Packages, Services)

| Service | Usage | Auth | Failure Mode |
|---------|-------|------|-------------|
| Helius RPC | Solana JSON-RPC, WebSocket | API key in URL | Failover to HELIUS_RPC_URL_FALLBACK |
| Helius Webhook | Account change notifications | HMAC-SHA256 (HELIUS_WEBHOOK_SECRET) | Missing updates, stale SSE data |
| Railway Postgres | Candle data, swap events | DATABASE_URL (TLS in prod) | Health check reports "degraded" |
| Sentry | Error reporting | DSN (zero-dep fetch-based) | Silent fail |
| WalletConnect | Wallet relay | Public | Wallet connection failures |

## Focus-Specific Analysis

### OC-221: Missing Environment Variable Validation (AIP-113)

The codebase has NO centralized startup validation (e.g., no `envalid`, `zod`, or custom validation at boot). Each module validates its own env vars at point-of-use:

1. `connection.ts:43` -- throws if HELIUS_RPC_URL missing (good, fail-fast)
2. `db/connection.ts:42` -- throws if DATABASE_URL missing (good, but lazy -- doesn't fail until first DB query)
3. `webhooks/helius/route.ts:270` -- production fail-closed on missing HELIUS_WEBHOOK_SECRET (good)
4. `ws-subscriber.ts:451` -- string equality check `!== "true"` (acceptable feature flag pattern)
5. `protocol-config.ts:25` -- `|| "devnet"` fallback (concerning for mainnet)
6. `next.config.ts:10` -- `|| "devnet"` fallback (concerning for mainnet)

**Risk**: A Railway deploy with a typo in NEXT_PUBLIC_CLUSTER (e.g., "Mainnet" instead of "mainnet") would fall through to devnet. The `app/.env.mainnet` template has `NEXT_PUBLIC_CLUSTER=mainnet` but Railway env var values could be uppercase per MEMORY.md note ("Railway env var VALUES may be uppercase. Always use .toLowerCase()"). The code at `protocol-config.ts:25` does NOT call `.toLowerCase()`. However, `middleware.ts:21` does call `.toLowerCase()` on NEXT_PUBLIC_SITE_MODE, showing awareness of this issue but inconsistent application.

### OC-222: Debug Mode via Feature Flag in Production

`WS_SUBSCRIBER_ENABLED` is a feature flag that gates the entire DBS pipeline. If set to "false" in production, the app falls back to webhook-only data flow (pre-DBS behavior). This is a safe degradation, not a debug mode exposure. No debug endpoints found.

`NEXT_PUBLIC_CURVE_PHASE` controls routing (curve page vs trade page). Not a security concern.

`NEXT_PUBLIC_SITE_MODE` controls site lockdown to `/launch`. In "launch" mode, all non-API routes redirect to `/launch`. Not exploitable.

### OC-218: Overly Permissive IAM Policies

Not applicable -- no IAM, Terraform, or cloud provider configuration files. Railway's Nixpacks builder manages the container environment. No S3, Lambda, or other cloud resources configured.

### OC-220: Hardcoded Cloud Credentials

No hardcoded cloud credentials in source code (checked via AIP-118 patterns). API keys are in env files, not source. However, `.env.devnet` (committed) contains `HELIUS_API_KEY=[REDACTED-DEVNET-KEY]-...`. Devnet Helius API keys have rate limits but no financial risk.

**`.env.mainnet` (gitignored but present)** contains:
- `HELIUS_API_KEY=[REDACTED-MAINNET-KEY]-...` (mainnet Helius key)
- `CLUSTER_URL=https://mainnet.helius-rpc.com/?api-key=[REDACTED-MAINNET-KEY]-...`
- `WALLET_KEYPAIR=[[REDACTED-CRANK-KEY-BYTES]` (64-byte secret key)
- `HELIUS_WEBHOOK_SECRET=[REDACTED-WEBHOOK-SECRET]...`
- `PDA_MANIFEST={...}` (contains mainnet Helius API key in clusterUrl)

The PDA_MANIFEST JSON blob at line 90 contains the mainnet Helius API key embedded in the clusterUrl field.

### AIP-109: NODE_TLS_REJECT_UNAUTHORIZED Check

**Clean.** No instances of `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false` found in any source file, env file, or CI configuration.

### AIP-107: GitHub Actions Expression Interpolation

**Clean.** The CI workflow at `.github/workflows/ci.yml` does not use `${{ github.event.* }}` in any `run:` block.

### AIP-108: CI/CD Workflow Permissions

**Finding**: The workflow lacks a `permissions:` block. GitHub Actions defaults to `write-all` for GITHUB_TOKEN permissions when no permissions block is specified. The workflow only needs `contents: read` (checkout + cache). This is LOW severity because the workflow doesn't use the GITHUB_TOKEN for any write operations, but it violates least privilege.

### Railway-Specific Configuration

**Healthcheck timeout**: 120 seconds is generous. The health endpoint makes a DB query + potentially an RPC call. If both are slow, 120s allows recovery. But it also means Railway won't kill a truly stuck container for 2 minutes.

**Restart policy**: ON_FAILURE with 3 retries for app, 10 for crank. If the crank fails 11 times, it stays down until manual intervention. No alerting mechanism for this.

**Pre-deploy migration**: `npx tsx app/db/migrate.ts` runs before the new version starts. If migration fails, the deploy is blocked. This is correct behavior.

**No Dockerfile**: Using Nixpacks means no Docker-specific security concerns (running as root, privileged mode, secret build args, unpinned images, debug ports). However, it also means less control over the container's security posture.

## Cross-Focus Intersections

### SEC-02 (Secrets & Credentials)
- `.env.mainnet` contains the crank wallet secret key -- this is the most sensitive artifact in the project
- `.env.devnet` commits devnet Helius API key (intentional, documented as non-sensitive)
- SUPERMEMORY_CC_API_KEY in `.env` -- unclear sensitivity; appears to be a third-party API key
- PDA_MANIFEST env var embeds the Helius API key in a JSON blob

### CHAIN-02 (RPC Node Trust)
- RPC proxy failover logic in `/api/rpc` with sticky routing
- WS subscriber fallback from WebSocket to HTTP polling on staleness
- Connection singleton caching could serve stale connections if Helius endpoint changes

### ERR-01 (Error Handling)
- `instrumentation.ts` wraps ws-subscriber init in try/catch -- failure is non-fatal
- SSE routes handle controller.close() errors silently
- Rate limiter handles missing proxy headers with warning

### DATA-01 (Data Persistence)
- Protocol store is entirely in-memory -- data loss on restart
- DB connection enforces TLS in production
- Credit counter stats are lost on restart (by design)

## Cross-Reference Handoffs

1. **-> SEC-02**: Audit `.env.mainnet` for git history exposure. Check if mainnet Helius API key or crank wallet key ever appeared in a committed file. The `.gitignore` entry for `.env.mainnet` should have been present from the start.

2. **-> INFRA-05**: The `/api/health` endpoint discloses infrastructure internals (H028). The always-200 behavior (H085) means Railway can't detect degraded state via healthcheck alone. Recommend separate internal monitoring.

3. **-> ERR-01**: Verify that all env var validation failures produce clear, actionable error messages. Current lazy validation means some failures only surface when specific code paths execute.

4. **-> CHAIN-02**: The RPC proxy's method allowlist should be reviewed -- `sendTransaction` is allowed, which means the proxy can be used to submit arbitrary transactions. This is by design (wallet adapter uses it) but the allowlist is the only gate.

## Risk Observations

### CRITICAL

**R1: Mainnet Crank Wallet Secret Key in Working Tree**
- File: `.env.mainnet:88`
- The full 64-byte secret key is present as `WALLET_KEYPAIR=[REDACTED]`
- Gitignored, but the file exists locally and is at risk from: accidental commit, backup systems, disk cloning, screen sharing, file sync services
- The crank wallet (`F84XUxo5VM8FJZeGvC3CrHYwLzFod3ep57CULjZ4ZXc1` per MEMORY.md) holds SOL for epoch transitions
- Impact: Direct SOL theft if the key is exposed
- Recommendation: Use a hardware wallet or KMS for the crank wallet. At minimum, store the key in a password manager rather than a file in the project directory

### HIGH

**R2: No Centralized Env Var Validation (AIP-113)**
- Files: Multiple (connection.ts, protocol-config.ts, ws-subscriber.ts, etc.)
- Missing vars surface as runtime errors rather than boot-time failures
- NEXT_PUBLIC_CLUSTER silent devnet fallback is especially dangerous for mainnet
- Recommendation: Add an `validateEnv()` function called from `instrumentation.ts` that checks all required vars at startup and throws with a clear message listing missing vars

**R3: NEXT_PUBLIC_CLUSTER Case Sensitivity**
- File: `app/lib/protocol-config.ts:25`
- `process.env.NEXT_PUBLIC_CLUSTER || "devnet"` -- no `.toLowerCase()` call
- Railway env var values may be uppercase per MEMORY.md
- If set to "Mainnet" or "MAINNET", the code falls through to devnet
- `middleware.ts:21` correctly calls `.toLowerCase()` on NEXT_PUBLIC_SITE_MODE but this pattern is not applied consistently
- Recommendation: Normalize cluster env var: `(process.env.NEXT_PUBLIC_CLUSTER || "devnet").toLowerCase()`

**R4: Health Endpoint Information Disclosure (H028 Recheck)**
- File: `app/app/api/health/route.ts:66-72`
- Exposes: wsSubscriber (initialized, wsConnected, latestSlot, lastSlotReceivedAt, fallbackActive), credits (totalCalls, methodCounts, startedAt), postgres/RPC status, timestamp
- No authentication
- An attacker can learn: whether WS is connected, credit consumption rate, when the server started, database connectivity
- Status: NOT_FIXED from Audit #1

### MEDIUM

**R5: Polling Interval Env Vars Without Bounds**
- File: `app/lib/ws-subscriber.ts:251-253,331-333,369-371`
- `parseInt(process.env.X ?? "default", 10)` with no min/max enforcement
- Setting STAKER_COUNT_POLL_INTERVAL_MS=100 would fire gPA 10x/sec (expensive)
- Setting SLOT_BROADCAST_INTERVAL_MS=0 would broadcast every slot (~2.5/sec)
- Recommendation: `Math.max(MIN, Math.min(MAX, parseInt(...)))`

**R6: CSP unsafe-inline for script-src (H025 Recheck)**
- File: `app/next.config.ts:33`
- `script-src 'self' 'unsafe-inline'` allows inline script execution
- Next.js requires unsafe-inline for its script injection mechanism
- Mitigation: Use nonce-based CSP when Next.js supports it

**R7: Railway Health Check Always 200 (H085)**
- File: `app/app/api/health/route.ts:61`
- Degraded Postgres + broken RPC still returns 200
- Railway only checks HTTP status for container liveness
- Status: ACCEPTED_RISK from Audit #1

**R8: Single-Process Architecture Assumption**
- Files: `sse-manager.ts:7-8`, `protocol-store.ts:16-17`
- All in-memory state (SSE subscribers, rate limits, protocol cache) is process-local
- If Railway ever scales to multiple instances, SSE connections would only see updates from their own process
- Documented design decision ("overkill for single-process devnet") but not enforced

### LOW

**R9: CI Workflow Missing Permissions Block (AIP-108)**
- File: `.github/workflows/ci.yml`
- No `permissions:` block -- defaults to broad GITHUB_TOKEN permissions
- Workflow only needs `contents: read`
- Low risk because no write operations are performed

**R10: SSE Limits Not Configurable**
- File: `app/lib/sse-connections.ts:23-24`
- MAX_PER_IP=10 and MAX_GLOBAL=5000 are compile-time constants
- Changing them requires code change + redeploy
- Consider making configurable via env var for operational flexibility

**R11: Crank Service No Railway Healthcheck**
- File: `railway-crank.toml`
- No `healthcheckPath` configured despite crank having HEALTH_PORT env var
- A hung crank process would not be detected or restarted by Railway

**R12: .env.devnet Commits SUPERMEMORY_CC_API_KEY**
- File: `.env.devnet:5`
- `SUPERMEMORY_CC_API_KEY=[REDACTED-SUPERMEMORY]-...` committed to git
- If this is a paid third-party API key, it could be abused by anyone with repo access
- Need to verify if this key has any associated costs or permissions

## Novel Attack Surface Observations

1. **Build-Time NEXT_PUBLIC_ Injection**: NEXT_PUBLIC_ env vars are inlined at build time by Next.js. An attacker who can modify Railway's build env vars (or the build command) could inject malicious values that get baked into the client bundle. The `NEXT_PUBLIC_RPC_URL` in `app/.env.mainnet` template has a placeholder `CHANGE_ME_MAINNET` -- if someone accidentally deploys with this value, browser RPC calls would fail with an opaque error.

2. **SSE IP-Based Rate Limiting Behind NAT**: With CGNAT or corporate proxies, hundreds of legitimate users share one IP. The 10-connection-per-IP limit (5 tabs x 2 SSE routes) could be exhausted by just 5 users behind the same NAT. An attacker could deliberately exhaust the per-IP limit to deny SSE service to all users behind a shared IP.

3. **RPC Proxy Replay**: The `/api/rpc` route proxies `sendTransaction` to Helius. An attacker who captures a signed transaction body could replay it through the proxy. This is mitigated by Solana's built-in replay protection (blockhash expiry, dedup) but the proxy itself doesn't check for replays.

4. **Cluster Config Build/Deploy Mismatch**: Because NEXT_PUBLIC_CLUSTER is inlined at build time, a scenario where Railway caches a devnet build and then env vars change to mainnet (or vice versa) would produce a mismatch between the client bundle (devnet addresses) and server-side config (mainnet addresses). This could cause user transactions to fail or target wrong accounts.

## Questions for Other Focus Areas

1. **SEC-02**: Is the SUPERMEMORY_CC_API_KEY a sensitive credential? What service does it access?
2. **SEC-02**: Has the mainnet Helius API key in `.env.mainnet` ever been committed to git history?
3. **CHAIN-02**: What happens if the Helius RPC URL is rotated (new API key)? Does the cached Connection in `connection.ts` invalidate?
4. **ERR-01**: When `instrumentation.ts` ws-subscriber init fails, do downstream SSE clients receive empty initial state or error?
5. **INFRA-05**: Is there any external monitoring for the crank service beyond Railway's restart policy?

## Raw Notes

- No Terraform, Kubernetes, or Docker configuration files present. The entire deployment is Railway Nixpacks-based.
- The `app/.gitignore` includes `.env*` (all env files gitignored from app/ directory). The root `.gitignore` specifically lists `.env` and `.env.mainnet` but NOT `.env.devnet` (which is committed by design).
- The `railway-docs.toml` suggests a separate docs site service on Railway.
- Load test scripts (`scripts/load-test/run.ts`, `k6-sse.js`) target `localhost:3000` by default. No hardcoded credentials or production URLs found.
- The k6 script imports from `https://jslib.k6.io/k6-summary/0.0.3/index.js` (external JS at runtime during k6 execution). This is standard k6 practice but worth noting for supply chain awareness.
- `app/lib/sentry.ts` uses a zero-dependency approach (raw fetch to Sentry ingest API) to avoid Turbopack incompatibility. It reads `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN` and tags errors with cluster, hostname, commit SHA. No secrets leaked to Sentry (only error stack traces + metadata).
- `app/instrumentation-client.ts:37` checks `typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN` before initializing browser Sentry. This is correct client-side initialization.
