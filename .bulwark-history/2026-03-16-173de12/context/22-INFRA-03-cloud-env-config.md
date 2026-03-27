---
task_id: db-phase1-cloud-env-config
provides: [cloud-env-config-findings, cloud-env-config-invariants]
focus_area: cloud-env-config
files_analyzed: [scripts/crank/crank-provider.ts, scripts/crank/crank-runner.ts, scripts/deploy/lib/connection.ts, scripts/deploy/deploy-all.sh, scripts/deploy/deploy.sh, scripts/webhook-manage.ts, scripts/e2e/lib/alt-helper.ts, scripts/backfill-candles.ts, app/lib/connection.ts, app/lib/sse-manager.ts, app/db/connection.ts, app/db/migrate.ts, app/app/api/health/route.ts, app/app/api/sse/candles/route.ts, app/app/api/webhooks/helius/route.ts, app/next.config.ts, app/providers/providers.tsx, shared/constants.ts, shared/programs.ts, railway.toml, railway-crank.toml, railway-docs.toml]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 3, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Cloud & Environment Configuration -- Condensed Summary

## Key Findings (Top 10)
- **Helius API key hardcoded in source**: Key `[REDACTED-DEVNET-KEY]...` committed to git in 4 locations, accessible in client bundle via `shared/programs.ts` -- `shared/constants.ts:474`, `shared/programs.ts:22`, `scripts/webhook-manage.ts:28`, `scripts/backfill-candles.ts:47`
- **Webhook auth is optional**: `HELIUS_WEBHOOK_SECRET` check skipped when env var unset; no fail-closed default -- `app/app/api/webhooks/helius/route.ts:135-141`
- **No centralized env var validation**: Each file reads `process.env.*` with its own fallback pattern; no startup-time schema validation (no envalid/zod); missing vars silently fall through to defaults -- scattered across all config files
- **DATABASE_URL passed raw to postgres driver**: No SSL mode enforcement; Railway Postgres may or may not use TLS by default -- `app/db/connection.ts:51`, `app/db/migrate.ts:42`
- **SSE endpoint has no authentication**: Any client can open unlimited SSE connections, no rate limiting -- `app/app/api/sse/candles/route.ts:38`
- **Health endpoint always returns 200**: Even degraded state returns HTTP 200; monitoring tools relying on status codes will miss failures -- `app/app/api/health/route.ts:49-55`
- **Crank runner logs wallet balance publicly**: Balance printed to stdout (Railway logs) every cycle -- `scripts/crank/crank-runner.ts:213-216`
- **RPC URL fallback chain ends with hardcoded devnet URL**: `app/lib/connection.ts:33` falls back to `DEVNET_RPC_URL` from shared package containing embedded API key; if `NEXT_PUBLIC_RPC_URL` unset in mainnet, frontend silently uses devnet
- **No resource limits in Railway config**: `railway.toml`, `railway-crank.toml`, `railway-docs.toml` specify no memory/CPU limits; runaway processes could exhaust Railway plan
- **Webhook secret comparison is not timing-safe**: `authHeader !== webhookSecret` uses JavaScript string equality, not `crypto.timingSafeEqual` -- `app/app/api/webhooks/helius/route.ts:138`

## Critical Mechanisms
- **Keypair loading (crank)**: Three-tier priority (WALLET_KEYPAIR env -> WALLET file path -> default file). JSON byte array parsed from env var on Railway. Error on parse failure includes partial error message -- `scripts/crank/crank-provider.ts:34-87`
- **Database connection**: Lazy singleton via Proxy + globalThis cache. `DATABASE_URL` validated at first access, not startup. Connection pool max=10 hardcoded -- `app/db/connection.ts:37-79`
- **RPC connection**: Singleton with URL-based cache invalidation. WebSocket endpoint derived by string replacement (`https://` -> `wss://`) -- `app/lib/connection.ts:31-52`
- **SSE broadcast**: In-memory pub/sub singleton (globalThis cached). No subscriber limits, no auth. Designed for single-process Railway deployment -- `app/lib/sse-manager.ts:29-92`
- **Railway deployment**: Nixpacks builder, preDeployCommand runs migrations, health check at `/api/health`, ON_FAILURE restart policy (3 retries web, 10 retries crank) -- `railway.toml`, `railway-crank.toml`

## Invariants & Assumptions
- INVARIANT: DATABASE_URL must be set at runtime for any DB-touching code to work -- enforced at `app/db/connection.ts:41-46` (throws on missing)
- INVARIANT: Wallet keypair must be available via env var or file for crank and deploy scripts -- enforced at `scripts/crank/crank-provider.ts:66-70` (throws on missing)
- INVARIANT: Crank wallet balance must stay above 1 SOL for operations -- partially enforced at `scripts/crank/crank-runner.ts:213` (warning only, no halt)
- ASSUMPTION: Railway runs a single Next.js process (no horizontal scaling) -- SSE manager uses in-memory state at `app/lib/sse-manager.ts:8` -- UNVALIDATED (no runtime check)
- ASSUMPTION: `DEVNET_RPC_URL` will be replaced for mainnet -- hardcoded fallback at `app/lib/connection.ts:33` and `app/providers/providers.tsx:35` -- NOT ENFORCED
- ASSUMPTION: Helius free-tier API key has no financial risk if exposed -- stated at `shared/constants.ts:471` -- PARTIALLY VALIDATED (free tier, but abuse could exhaust rate limits)

## Risk Observations (Prioritized)
1. **Helius API key in client bundle**: `shared/programs.ts` is imported by frontend code (`app/lib/connection.ts`, `app/providers/providers.tsx`). The API key is bundled into the browser JavaScript. While labeled "free-tier, not a secret," an attacker could abuse the key to exhaust RPC rate limits, causing service degradation for all users -- `shared/programs.ts:22`
2. **Webhook auth bypass when secret unset**: If `HELIUS_WEBHOOK_SECRET` is not configured in Railway (or accidentally deleted), the webhook endpoint accepts arbitrary POST requests. An attacker could inject fake swap events into the database, poisoning price charts and candle data -- `app/app/api/webhooks/helius/route.ts:135-141`
3. **No env var validation at startup**: Critical variables (CLUSTER_URL, DATABASE_URL, WALLET_KEYPAIR, NEXT_PUBLIC_RPC_URL) have scattered fallback patterns. There is no single point of validation that would fail-fast on misconfiguration. A missing CLUSTER_URL in crank-provider silently defaults to localhost -- `scripts/crank/crank-provider.ts:35`
4. **Database connection string not enforcing TLS**: The `postgres()` call in `app/db/connection.ts:51` and `app/db/migrate.ts:42` passes `DATABASE_URL` directly without `?sslmode=require`. If Railway's DATABASE_URL doesn't include SSL params, connections may be unencrypted
5. **SSE connection exhaustion**: No limit on number of SSE subscribers. An attacker opening thousands of connections could exhaust server memory or file descriptors -- `app/lib/sse-manager.ts:30`, `app/app/api/sse/candles/route.ts`

## Novel Attack Surface
- **Devnet-to-mainnet migration risk**: The codebase has multiple "MAINNET TODO" comments and hardcoded devnet values. The fallback chain (`NEXT_PUBLIC_RPC_URL ?? DEVNET_RPC_URL`) means a missing env var in mainnet deployment would silently route financial transactions through devnet RPC. This is not just a display issue -- `useProtocolWallet.ts` uses the connection for `sendRawTransaction`, meaning real mainnet transactions could be sent to devnet (where they would fail silently) or devnet transactions could be displayed as real

## Cross-Focus Handoffs
- -> **SEC-02**: Helius API key hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22` -- assess exposure via git history and client bundle
- -> **API-04**: Webhook auth bypass (`app/app/api/webhooks/helius/route.ts:135-141`) -- assess data poisoning impact on candle/price data integrity
- -> **INFRA-05**: Health endpoint always returns 200 -- assess monitoring/alerting implications for Railway deployment

## Trust Boundaries
The infrastructure trust model has three layers: (1) Railway environment variables are trusted as the source of secrets (wallet keypairs, database URLs, webhook secrets); (2) the Helius RPC/webhook service is trusted for transaction data delivery; (3) the Solana RPC is trusted for on-chain state reads. The primary weakness is the boundary between Railway env vars and code defaults -- when a trusted env var is missing, the code silently falls back to hardcoded devnet values rather than failing. This creates a subtle risk where a production misconfiguration could cause the system to operate against the wrong network without any visible error. The webhook trust boundary is also weak: authentication is opt-in rather than mandatory, meaning a deployment misconfiguration exposes the data ingestion pipeline.
<!-- CONDENSED_SUMMARY_END -->

---

# Cloud & Environment Configuration -- Full Analysis

## Executive Summary

The Dr. Fraudsworth project deploys to Railway (PaaS) with three services: a Next.js web application, a crank runner bot, and a docs site. The infrastructure configuration is straightforward but has several security-relevant patterns: hardcoded API keys in source code, optional webhook authentication, no centralized environment variable validation, and a devnet-first architecture with scattered mainnet migration points. There are no Docker containers, CI/CD pipelines, or cloud IAM policies to audit -- the project relies entirely on Railway's Nixpacks builder and environment variable configuration.

## Scope

All off-chain infrastructure configuration files were analyzed. The `programs/` directory (Anchor/Rust on-chain code) was excluded per auditor scope rules.

**Files analyzed in full (Layer 3):**
- `scripts/crank/crank-provider.ts` -- Keypair and manifest loading for Railway
- `scripts/crank/crank-runner.ts` -- 24/7 crank bot main loop
- `scripts/deploy/lib/connection.ts` -- Deploy script provider factory
- `scripts/deploy/deploy-all.sh` -- Full deployment orchestrator
- `scripts/deploy/deploy.sh` -- Program deployment script
- `scripts/webhook-manage.ts` -- Helius webhook CRUD
- `scripts/e2e/lib/alt-helper.ts` -- ALT creation/caching
- `scripts/backfill-candles.ts` -- Historical data backfill
- `app/lib/connection.ts` -- Frontend RPC connection singleton
- `app/lib/sse-manager.ts` -- SSE pub/sub singleton
- `app/db/connection.ts` -- Postgres connection singleton
- `app/db/migrate.ts` -- Migration runner
- `app/app/api/health/route.ts` -- Health check endpoint
- `app/app/api/sse/candles/route.ts` -- SSE streaming endpoint
- `app/app/api/webhooks/helius/route.ts` -- Webhook handler (auth section)
- `app/next.config.ts` -- Next.js config with CSP
- `app/providers/providers.tsx` -- Root provider with RPC endpoint
- `shared/constants.ts` -- Shared constants including API keys
- `shared/programs.ts` -- Devnet ALT and RPC URL
- `railway.toml` -- Web service config
- `railway-crank.toml` -- Crank service config
- `railway-docs.toml` -- Docs site config

## Key Mechanisms

### 1. Railway Deployment Configuration

Three Railway services defined by TOML files:

**Web app (`railway.toml`):**
- Builder: Nixpacks (auto-detected Node.js)
- Build: `npm run --workspace app build`
- Start: `npm run --workspace app start`
- preDeployCommand: `npx tsx app/db/migrate.ts` (runs migrations before new version starts)
- Health check: `/api/health` with 120s timeout
- Restart: ON_FAILURE, max 3 retries

**Crank (`railway-crank.toml`):**
- Builder: Nixpacks
- Build: `npm install`
- Start: `npx tsx scripts/crank/crank-runner.ts`
- No health check (background worker)
- Restart: ON_FAILURE, max 10 retries (higher tolerance for a 24/7 bot)

**Docs (`railway-docs.toml`):**
- Builder: Nixpacks
- Build: `cd docs-site && npm install && npm run build`
- Start: `cd docs-site && npm start`
- Health check at `/`
- Restart: ON_FAILURE, max 3 retries

**Observations:**
- No resource limits (memory, CPU) specified in any TOML file
- No environment variable declarations in TOML -- all configured via Railway dashboard
- No Dockerfile -- Nixpacks auto-detects Node.js runtime
- Crank has no health check mechanism -- if it hangs without crashing, Railway won't restart it

### 2. Environment Variable Landscape

Cataloguing all env vars used across the codebase:

| Variable | Used In | Fallback | Validated |
|----------|---------|----------|-----------|
| `DATABASE_URL` | `app/db/connection.ts`, `app/db/migrate.ts`, `app/drizzle.config.ts` | None (throws) | Yes -- throws if missing |
| `CLUSTER_URL` | `crank-provider.ts`, `deploy/lib/connection.ts`, `deploy-all.sh` | `http://localhost:8899` | No -- silently uses localhost |
| `WALLET_KEYPAIR` | `crank-provider.ts` | Falls to WALLET/file | Yes -- throws on parse failure |
| `WALLET` | `crank-provider.ts`, `deploy/lib/connection.ts`, `deploy-all.sh` | `keypairs/devnet-wallet.json` | Yes -- throws if file not found |
| `COMMITMENT` | `crank-provider.ts`, `deploy/lib/connection.ts` | `"confirmed"` | No -- silently accepts any string |
| `PDA_MANIFEST` | `crank-provider.ts` | Falls to file | Yes -- throws on parse failure |
| `CARNAGE_WSOL_PUBKEY` | `crank-runner.ts` | Falls to keypair file | Yes -- throws if both missing |
| `NEXT_PUBLIC_RPC_URL` | `app/lib/connection.ts`, `app/providers/providers.tsx` | `DEVNET_RPC_URL` (hardcoded) | No -- silently uses devnet |
| `HELIUS_WEBHOOK_SECRET` | `app/app/api/webhooks/helius/route.ts` | Auth skipped if unset | No -- silently disables auth |
| `HELIUS_API_KEY` | `scripts/webhook-manage.ts`, `scripts/backfill-candles.ts` | Hardcoded key | No -- uses hardcoded key |
| `WEBHOOK_URL` | `scripts/webhook-manage.ts` | Railway production URL | No |
| `NEXT_PUBLIC_SENTRY_DSN` | `app/instrumentation-client.ts`, `app/lib/sentry.ts` | Sentry disabled if unset | No |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `app/lib/solscan.ts` | `"devnet"` | No |
| `NEXT_PUBLIC_CURVE_PHASE` | `app/app/page.tsx` | `false` | No |
| `NEXT_PUBLIC_DEMO_MODE` | `app/hooks/useCurveState.ts` | `false` | No |
| `NEXT_PUBLIC_DOCS_URL` | `app/components/station/DocsStation.tsx` | `http://localhost:3001` | No |
| `NODE_ENV` | Various | Standard Node.js | N/A |

**Key concern**: No startup validation schema. Each file handles its own env vars independently. Critical variables like `CLUSTER_URL` default to localhost without warning.

### 3. Database Connection Management

`app/db/connection.ts`:
- Lazy singleton pattern using `Proxy` to defer connection until first query
- `globalThis` cache survives Next.js HMR in development
- In production, `globalThis` caching is NOT applied (line 53: `if (process.env.NODE_ENV !== "production")`), but the `drizzleDb` cache in `getDb()` still prevents multiple connections
- Max 10 connections (hardcoded, documented as Railway free tier limit)
- No SSL/TLS enforcement in connection options -- relies entirely on what's in `DATABASE_URL`

`app/db/migrate.ts`:
- Single-connection client (`max: 1`) for sequential migration execution
- Properly closes connection in `finally` block
- Exit code 1 on failure halts Railway deployment (via preDeployCommand)

### 4. RPC Connection Management

`app/lib/connection.ts`:
- Singleton memoized by URL string
- WebSocket endpoint derived via string replacement: `url.replace("https://", "wss://")`
  - This is fragile: non-HTTPS URLs (http://localhost:8899) would produce `wss://localhost:8899` which might not work. However, localhost connections typically don't use WebSocket subscriptions in this path
- Commitment level hardcoded to `"confirmed"` (appropriate for frontend reads)

`scripts/crank/crank-provider.ts`:
- Separate connection factory for crank context
- `COMMITMENT` env var cast to `anchor.web3.Commitment` without validation -- passing `"invalid"` would propagate to the Solana Connection and fail at RPC level

### 5. Helius API Key Exposure

The Helius API key `[REDACTED-DEVNET-HELIUS-KEY]` appears in:
1. `shared/constants.ts:474` -- exported constant
2. `shared/programs.ts:22` -- embedded in RPC URL
3. `scripts/webhook-manage.ts:28` -- fallback constant
4. `scripts/backfill-candles.ts:47` -- hardcoded constant
5. `scripts/deploy/pda-manifest.json:3` -- in cluster URL

The comment at `shared/constants.ts:471` says "This is a free-tier API key, not a secret." However:
- `shared/programs.ts` is imported by `app/lib/connection.ts` and `app/providers/providers.tsx`, which are frontend code
- The key is bundled into the client JavaScript bundle
- An attacker could use this key to make RPC requests, exhausting the free-tier rate limit
- The key also provides access to the Helius webhook management API (CRUD operations on webhooks)
- Some redaction is attempted in logging code (`scripts/vrf/lib/reporter.ts:285`, `scripts/vrf/devnet-vrf-validation.ts:94`) but the key is already in the source

### 6. Webhook Authentication

`app/app/api/webhooks/helius/route.ts:135-141`:
```typescript
const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
if (webhookSecret) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```

Issues:
- Auth is opt-in: if `HELIUS_WEBHOOK_SECRET` is unset, ALL POST requests are accepted
- String comparison (`!==`) is not timing-safe. While this is a webhook secret (not a password hash), timing attacks could theoretically leak the secret byte-by-byte
- No HMAC signature verification -- just raw string comparison of Authorization header
- An attacker who can POST to this endpoint can inject fake transaction data into the database

### 7. Health Check Endpoint

`app/app/api/health/route.ts`:
- Always returns HTTP 200, even when Postgres or RPC is down
- Reports degraded state in response body but not in status code
- This is intentionally designed (comments explain Railway container liveness vs dependency health)
- However, external monitoring tools that check HTTP status codes will never detect degraded state
- The endpoint exposes dependency status (postgres: true/false, solanaRpc: true/false) without authentication

### 8. SSE Connection Management

`app/app/api/sse/candles/route.ts` + `app/lib/sse-manager.ts`:
- No authentication on SSE connections
- No subscriber limit -- `Set<SSECallback>` grows unbounded
- No rate limiting on new connections
- 15-second heartbeat keeps connections alive
- Proper cleanup on client disconnect (abort signal handler)
- In-memory only -- designed for single-process deployment

## Trust Model

```
[Railway Env Vars] -- trusted source of secrets
    |
    v
[Application Code] -- reads env vars, falls back to hardcoded devnet defaults
    |
    +---> [Helius RPC] -- trusted for transaction data (API key in source)
    |
    +---> [Railway Postgres] -- trusted for data persistence (conn string from env)
    |
    +---> [Solana RPC] -- trusted for on-chain state (URL from env or hardcoded)
    |
    +---> [Helius Webhooks] -- semi-trusted (auth optional)
    |
    +---> [Browser Clients] -- untrusted (SSE, API routes)
```

The critical trust boundary is between Railway env vars and code defaults. When env vars are missing, the code doesn't fail -- it silently uses devnet configurations. This is appropriate for development but dangerous for mainnet deployment.

## State Analysis

**Postgres (Railway-hosted):**
- Connection string from `DATABASE_URL` env var
- No explicit SSL configuration in application code
- Max 10 connections (hardcoded)
- Migration runner uses single connection with proper cleanup
- globalThis singleton survives HMR (dev only; in production, Proxy pattern handles lazy init)

**In-Memory State:**
- SSE subscriber set (lost on restart, acceptable for real-time streaming)
- RPC Connection singleton (re-created on URL change)
- Database connection pool (re-created on restart)

**Filesystem State:**
- ALT address cached at `scripts/deploy/alt-address.json` -- used by crank runner on startup
- Keypair files in `keypairs/` directory (gitignored per convention, but some committed for devnet)
- PDA manifest at `scripts/deploy/pda-manifest.json` (contains cluster URL with API key)

## Dependencies

**External Services:**
- Railway PaaS (hosting, health checks, restart policies)
- Helius (RPC, webhooks, API key management)
- Solana Devnet (on-chain state)
- CoinGecko/Binance (SOL price feed via `app/app/api/sol-price/route.ts`)
- Sentry (error reporting, optional via DSN env var)

**No cloud provider dependencies:**
- No AWS/GCP/Azure services
- No S3/storage buckets
- No IAM policies
- No Terraform/infrastructure-as-code

## Focus-Specific Analysis

### Environment Variable Validation Gap (AIP-113 Pattern)

The codebase matches the AI pitfall pattern AIP-113 ("Environment Variables Without Validation"). There is no centralized validation library (no envalid, no Zod schema for env vars). Each file implements its own fallback logic:

- `crank-provider.ts:35`: `process.env.CLUSTER_URL || "http://localhost:8899"` -- localhost default for a production service
- `crank-provider.ts:37`: `process.env.COMMITMENT as anchor.web3.Commitment` -- unsafe cast without validation
- `app/lib/connection.ts:33`: Three-way fallback ending in hardcoded devnet URL
- `app/providers/providers.tsx:35`: Same three-way fallback

A startup-time env var validation (e.g., envalid schema) would catch configuration errors before the service starts processing requests/transactions.

### Database TLS Configuration

Neither `app/db/connection.ts` nor `app/db/migrate.ts` explicitly configures TLS for the Postgres connection. The `postgres(connectionString, { max: 10 })` call relies entirely on what's in the DATABASE_URL. Railway's Postgres databases do support TLS, and their connection strings typically include `?sslmode=require`, but this is not verified or enforced by the application code. If a Railway configuration change removed SSL from the connection string, the application would silently connect over plaintext.

### Deployment Pipeline Security

`scripts/deploy/deploy-all.sh`:
- Sources `.env` file with `set -a` (auto-export) -- any variable in `.env` becomes available to child processes
- Solana CLI version gate (requires v3.0+) -- good practice, prevents silent corruption from old toolchain
- Auto-airdrop on localnet/devnet but NOT mainnet (URL pattern check) -- appropriate safety measure
- `set -e` ensures any failure stops the pipeline -- good practice

`scripts/deploy/deploy.sh`:
- Uses `solana program deploy --program-id <keypair>` for deterministic addresses -- correct pattern
- Adds minimal priority fee (`--with-compute-unit-price 1`) for reliability
- Post-deploy verification via `solana program show` -- catches silent deploy failures
- Auto-airdrop only for localhost/devnet URLs -- good safety check

### CSP Configuration

`app/next.config.ts` defines a comprehensive CSP:
- `default-src 'self'` -- good baseline
- `script-src 'self' 'unsafe-inline'` -- `unsafe-inline` required by Next.js but reduces CSP protection
- `frame-ancestors 'none'` -- prevents clickjacking
- `connect-src` whitelist includes Helius endpoints, WalletConnect, Sentry
- `upgrade-insecure-requests` -- enforces HTTPS
- Missing: `strict-dynamic` for stricter script loading (would require nonce-based CSP)

## Cross-Focus Intersections

- **SEC-01/SEC-02**: Keypair loading in `crank-provider.ts` reads raw secret key bytes from env vars. The `WALLET_KEYPAIR` env var contains the full 64-byte secret key as a JSON array. If Railway logs are accessible, the env var value could be visible in deployment logs.
- **API-04**: The webhook handler's optional auth directly impacts data integrity for all downstream consumers (candles, price charts, SSE clients).
- **DATA-01**: Database connection pooling (max=10) could become a bottleneck under high webhook delivery rate.
- **ERR-01**: The crank runner's error handling (30s retry, no backoff) could cause rapid RPC request loops if the cluster is unresponsive.
- **BOT-01**: The crank runner has no health check or external liveness monitoring. If it enters an infinite retry loop on a non-transient error, it consumes resources without progressing.

## Cross-Reference Handoffs

- -> **SEC-02**: Assess Helius API key exposure via git history (has it been in the repo since creation?) and client bundle (is it extractable from production JS?)
- -> **API-04**: Assess impact of unauthenticated webhook access on data integrity (can an attacker craft valid-looking Anchor events?)
- -> **INFRA-05**: The health endpoint returning 200 on degraded state may mask monitoring gaps
- -> **BOT-01**: Crank runner has no mechanism to alert on persistent failures or resource exhaustion
- -> **ERR-01**: The `COMMITMENT` env var is cast to `anchor.web3.Commitment` without runtime validation -- what happens with invalid values?

## Risk Observations

### HIGH

1. **Webhook authentication bypass by default**: If `HELIUS_WEBHOOK_SECRET` env var is accidentally deleted or never set, the webhook endpoint accepts arbitrary POST requests. An attacker could inject fake transaction data (swap events, epoch events, carnage events) into the database. The impact includes: corrupted price charts, false candle data broadcast via SSE, and incorrect carnage event history. The webhook URL is discoverable (hardcoded in `scripts/webhook-manage.ts:43`). -- `app/app/api/webhooks/helius/route.ts:135-141`

2. **Devnet fallback in production**: The RPC connection fallback chain (`NEXT_PUBLIC_RPC_URL ?? DEVNET_RPC_URL`) means a missing env var in a mainnet deployment would silently route all RPC calls to devnet. For read-only operations, this would show stale/wrong data. For transaction submissions via `useProtocolWallet.ts`, mainnet-signed transactions sent to devnet would fail silently. The reverse (devnet transactions appearing as real) is also possible if the frontend displays devnet state as if it were mainnet. -- `app/lib/connection.ts:33`, `app/providers/providers.tsx:35`

### MEDIUM

3. **Helius API key in client bundle**: While labeled "free tier," the key grants webhook management API access and RPC rate limits. An attacker extracting the key from the client bundle could: exhaust RPC rate limits (DoS), create/delete webhooks (data pipeline disruption), or make API calls impersonating the project. -- `shared/programs.ts:22`

4. **No TLS enforcement on database connection**: Application code does not enforce `sslmode=require` or verify SSL certificates. Relies on Railway's `DATABASE_URL` format. -- `app/db/connection.ts:51`

5. **SSE endpoint resource exhaustion**: No subscriber limit or authentication. An attacker could open thousands of EventSource connections, exhausting server memory or file descriptors. The `Set<SSECallback>` grows unbounded. -- `app/lib/sse-manager.ts:30`, `app/app/api/sse/candles/route.ts:38`

6. **Non-timing-safe webhook secret comparison**: `authHeader !== webhookSecret` enables theoretical timing attacks against the webhook secret. -- `app/app/api/webhooks/helius/route.ts:138`

7. **COMMITMENT env var cast without validation**: `process.env.COMMITMENT as anchor.web3.Commitment` performs an unsafe TypeScript cast. An invalid value (e.g., `"fast"`) would propagate to the Solana Connection constructor and fail at RPC level with an opaque error. -- `scripts/crank/crank-provider.ts:37`, `scripts/deploy/lib/connection.ts:92`

### LOW

8. **Health endpoint exposes dependency status without auth**: Reports Postgres and RPC connectivity status to any caller. While not directly exploitable, it reveals infrastructure architecture to potential attackers. -- `app/app/api/health/route.ts:49-55`

9. **Crank runner logs wallet balance**: Every cycle logs `WARNING: Wallet balance low: X.XXX SOL` to stdout. On Railway, these logs are accessible via dashboard. While the public key is not sensitive, the balance pattern could help an attacker assess the crank's operational budget. -- `scripts/crank/crank-runner.ts:213-216`

10. **No resource limits in Railway configuration**: None of the three Railway services specify memory or CPU limits. A memory leak or runaway process would consume the full Railway plan allocation before being killed by the platform's default limits. -- `railway.toml`, `railway-crank.toml`, `railway-docs.toml`

### INFORMATIONAL

11. **pda-manifest.json contains cluster URL with API key**: The generated manifest file at `scripts/deploy/pda-manifest.json` includes the full Helius RPC URL with embedded API key. If this file is committed (it appears to be in the git working tree), the key is in version history. -- `scripts/deploy/pda-manifest.json:3`

12. **ALT cache path hardcoded**: The ALT address is cached to `scripts/deploy/alt-address.json`. If this file is deleted or corrupted, the crank runner will attempt to create a new ALT on startup, which costs SOL. -- `scripts/e2e/lib/alt-helper.ts:48`

## Novel Attack Surface Observations

### Railway Deployment Pipeline as Attack Vector
The `railway.toml` preDeployCommand (`npx tsx app/db/migrate.ts`) runs migrations before the new version starts. If an attacker could push a malicious migration file to the `app/db/migrations/` directory (via compromised git access), it would execute automatically on next deploy with full database privileges. The migration runner has no validation of migration content -- it runs whatever SQL files are in the migrations folder.

### Webhook URL Discovery
The default webhook URL is hardcoded in source code: `https://dr-fraudsworth-production.up.railway.app/api/webhooks/helius` (`scripts/webhook-manage.ts:43`). Combined with optional auth, this makes the webhook endpoint both discoverable and accessible. An attacker doesn't need to find the endpoint through enumeration -- it's in the public source code.

### Single-Process SSE as Side Channel
Since the SSE manager is in-process and broadcasts to all subscribers, a connected attacker can observe real-time candle updates and price changes. While this data is eventually public, the real-time stream provides a slight information advantage for monitoring protocol activity.

## Questions for Other Focus Areas

- **SEC-01**: Are the keypair files in `keypairs/` directory committed to git? The `.gitignore` excludes `.env` but the gitignore coverage for keypair files needs verification.
- **DATA-01**: Does Railway's Postgres service enforce TLS by default? What's in the actual `DATABASE_URL` format provided by Railway?
- **BOT-01**: What happens to the crank runner if it enters a state where every epoch advance fails? The 30s retry with no backoff could generate significant RPC load.
- **ERR-01**: The crank runner catches all errors and retries after 30s. Are there error conditions that should cause a permanent halt instead of retry?

## Raw Notes

- No Dockerfile in the project. Railway uses Nixpacks auto-detection.
- No CI/CD pipelines (no `.github/workflows/` in project root, only in node_modules).
- No docker-compose files.
- No cloud provider SDKs (no AWS SDK, no GCP client libraries).
- The `.gitignore` includes `.env` but NOT `.env.local` explicitly (though Next.js gitignore templates typically include it).
- The `deploy-all.sh` script sources `.env` with `set -a` which makes ALL `.env` variables available to child processes, including any that shouldn't be exported.
- The crank runner's `WALLET_KEYPAIR` env var contains the raw 64-byte secret key. Railway's env var storage is encrypted at rest, but the value is visible in the Railway dashboard to anyone with project access.
- The `DEVNET_RPC_URL` comment in `shared/programs.ts:19` says "not a secret" but it contains an API key that provides webhook management access.
