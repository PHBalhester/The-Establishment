---
task_id: db-phase1-SEC-02
provides: [SEC-02-findings, SEC-02-invariants]
focus_area: SEC-02
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/lib/connection.ts, app/lib/protocol-config.ts, app/db/connection.ts, app/app/api/rpc/route.ts, app/app/api/health/route.ts, app/app/api/sol-price/route.ts, app/lib/sentry.ts, app/instrumentation-client.ts, app/lib/ws-subscriber.ts, app/instrumentation.ts, app/middleware.ts, app/next.config.ts, app/lib/rate-limit.ts, app/drizzle.config.ts, app/db/migrate.ts, scripts/crank/crank-provider.ts, scripts/crank/crank-runner.ts, scripts/deploy/upload-metadata.ts, scripts/deploy/fix-carnage-wsol.ts, scripts/deploy/lib/connection.ts, scripts/webhook-manage.ts, scripts/backfill-candles.ts, shared/constants.ts, shared/programs.ts, shared/index.ts, .env, .env.devnet, app/.env.local, app/.env.mainnet, .gitignore]
finding_count: 14
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 6}
---
<!-- CONDENSED_SUMMARY_START -->
# SEC-02: Secret & Credential Management -- Condensed Summary

## Key Findings (Top 10)

1. **Helius API key committed in `.env.devnet` (tracked by git)**: The file `.env.devnet` is committed and contains `HELIUS_API_KEY=[REDACTED-DEVNET-HELIUS-KEY]` and the full `CLUSTER_URL` with embedded key. While labeled "devnet credentials are non-sensitive" (line 3), this is the same key used by the crank runner and webhook management. Anyone with repo access can manage/delete Helius webhooks. -- `.env.devnet:8-9`

2. **17 devnet keypairs committed to git (H005 PARTIALLY_FIXED)**: 18 keypair JSON files tracked in `keypairs/` including `devnet-wallet.json`, all Squads signer keypairs, program keypairs, and test keypairs. While devnet-only, these hold SOL, can sign transactions, and their git history is permanent. Mainnet keypairs are correctly gitignored. -- `keypairs/*.json` via `git ls-files`

3. **`NEXT_PUBLIC_RPC_URL` in `app/.env.local` contains Helius API key**: `NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]...` is a client-exposed env var. While `.env.local` is not tracked by git and the key is devnet-only, if this pattern is replicated for mainnet (as the mainnet template suggests at `app/.env.mainnet:49`), the mainnet Helius API key would be baked into the client bundle at build time. -- `app/.env.local:1`, `app/.env.mainnet:49`

4. **Mainnet env template instructs putting API key in `NEXT_PUBLIC_RPC_URL`**: `app/.env.mainnet:49` has `NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=CHANGE_ME_MAINNET`. If followed, this bakes the mainnet Helius API key into the browser bundle. The connection.ts proxy pattern (H002 fix) correctly routes browser RPC through `/api/rpc`, but `NEXT_PUBLIC_RPC_URL` is still referenced as a server-side fallback and its build-time value is visible in the bundle. -- `app/.env.mainnet:49`, `app/lib/connection.ts:41`

5. **`DEVNET_RPC_URL` with hardcoded API key exported from shared package**: `shared/programs.ts:23-24` hardcodes the full Helius devnet URL with API key. This is re-exported via `shared/index.ts:53`. However, no `app/` code currently imports it -- the H002 fix redirected all browser RPC through `/api/rpc` proxy. Risk is regression if any future code imports `DEVNET_RPC_URL` from shared. -- `shared/programs.ts:23-24`, `shared/index.ts:53`

6. **Webhook auth comparison has subtle length-leak risk**: The webhook route's timing-safe comparison at `route.ts:293-299` handles length mismatch by comparing `secretBuf` against itself. While this prevents timing leaks, a sophisticated attacker can still determine the _length_ of the secret by measuring total processing time (short secrets = faster Buffer.from). The mitigation is correct but could be hardened with fixed-length hashing (HMAC). -- `app/app/api/webhooks/helius/route.ts:293-299`

7. **Health endpoint exposes internal state publicly (H028 NOT_FIXED)**: `/api/health` returns WebSocket subscriber state, RPC credit counts, and dependency connectivity status with no authentication. While no secrets are directly exposed, the credit counts and subscriber state reveal operational details useful for targeted attacks. -- `app/app/api/health/route.ts:66-72`

8. **Crank provider logs partial public key on load**: `crank-provider.ts:50-51` logs the first 12 characters of the wallet public key. This is a public key (not secret) but combined with the crank runner context, it identifies the crank wallet for targeted attacks. -- `scripts/crank/crank-provider.ts:50-51`

9. **`SUPERMEMORY_CC_API_KEY` committed in `.env.devnet`**: The key `[REDACTED-SUPERMEMORY-KEY]` is committed in git history. No code currently references this env var, but it's a valid third-party API key in version control. -- `.env.devnet:1`

10. **No secret rotation mechanism for any credential**: HELIUS_API_KEY, HELIUS_WEBHOOK_SECRET, DATABASE_URL, WALLET_KEYPAIR -- none have rotation support. Webhook secret requires updating both Railway env var and Helius webhook config simultaneously. No dual-key acceptance (current + previous) pattern exists. -- project-wide observation

## Critical Mechanisms

- **RPC Proxy (`app/app/api/rpc/route.ts`)**: Protects Helius API key from browser exposure via method-allowlisted JSON-RPC proxy. Server reads `HELIUS_RPC_URL` (no NEXT_PUBLIC_ prefix). Browser calls `/api/rpc` (relative URL). Failover chain: HELIUS_RPC_URL > HELIUS_RPC_URL_FALLBACK > NEXT_PUBLIC_RPC_URL. The fallback to NEXT_PUBLIC_RPC_URL is server-side only (the route is a POST handler), so the key stays server-side. Endpoint URLs are masked in logs via `maskEndpoint()`. -- `app/app/api/rpc/route.ts:72-78, 128-132`

- **Webhook Auth (`app/app/api/webhooks/helius/route.ts`)**: Fail-closed in production (missing secret = 500). Timing-safe comparison via `timingSafeEqual`. Non-production skips auth for dev convenience. The auth header is compared as a raw string (not HMAC-verified), meaning the secret is the Authorization header value directly. -- `route.ts:266-302`

- **Database Connection (`app/db/connection.ts`)**: DATABASE_URL loaded lazily (Proxy pattern defers until first query). Throws on missing. TLS enforced in production. globalThis singleton prevents pool exhaustion during HMR. Warns on non-TLS remote connections in dev. -- `app/db/connection.ts:40-57`

- **Crank Wallet Loading (`scripts/crank/crank-provider.ts`)**: Three-tier priority: WALLET_KEYPAIR env var (JSON array) > WALLET env var (file path) > keypairs/devnet-wallet.json. WALLET_KEYPAIR errors are truncated to 100 chars to prevent full key disclosure in logs. -- `crank-provider.ts:39-80`

- **Irys/Arweave Signing (`scripts/deploy/upload-metadata.ts`)**: Reads keypair from CLI `--keypair` argument. Converts to base58 private key for Irys SDK. The private key exists in memory during upload. No zeroization after use. -- `upload-metadata.ts:124-126`

## Invariants & Assumptions

- INVARIANT: HELIUS_WEBHOOK_SECRET must be set in production (NODE_ENV=production) or all webhook requests are rejected with 500 -- enforced at `app/app/api/webhooks/helius/route.ts:273-284`
- INVARIANT: DATABASE_URL must be set at runtime or db.* calls throw -- enforced at `app/db/connection.ts:41-46`
- INVARIANT: HELIUS_RPC_URL (or NEXT_PUBLIC_RPC_URL) must be set server-side or Connection creation throws -- enforced at `app/lib/connection.ts:42-44`
- INVARIANT: Browser never directly accesses Helius RPC URL -- enforced by `resolveRpcUrl()` returning `/api/rpc` for `window !== undefined` at `app/lib/connection.ts:35-36`
- INVARIANT: RPC proxy only forwards allowlisted methods -- enforced at `app/app/api/rpc/route.ts:116-122`
- ASSUMPTION: `.env.mainnet` is never committed (it's gitignored via `app/.gitignore`) -- VALIDATED (only `.env.devnet` is tracked)
- ASSUMPTION: Mainnet keypairs are never committed (gitignored via `keypairs/mainnet-*`) -- VALIDATED (git ls-files shows no mainnet keypairs)
- ASSUMPTION: NEXT_PUBLIC_RPC_URL will NOT contain a paid Helius key for mainnet -- UNVALIDATED (the template at `app/.env.mainnet:49` actually instructs putting the key there)
- ASSUMPTION: `DEVNET_RPC_URL` in shared/programs.ts is never imported by app/ browser code -- VALIDATED (zero imports found, H002 fix removed all paths)

## Risk Observations (Prioritized)

1. **NEXT_PUBLIC_RPC_URL mainnet API key exposure (HIGH)**: `app/.env.mainnet:49` template instructs setting `NEXT_PUBLIC_RPC_URL` with the mainnet Helius API key. If followed during Railway setup, the key is baked into the client bundle at Next.js build time. The RPC proxy pattern makes this env var unnecessary for browser use, but it's still read as a server-side fallback in `rpc/route.ts:131`. Recommend removing `NEXT_PUBLIC_RPC_URL` from the mainnet template entirely or clearly marking it as DO NOT SET.
2. **Committed devnet API keys in git history (HIGH)**: `.env.devnet` contains Helius API key and SUPERMEMORY_CC_API_KEY. Even if `.env.devnet` is later removed from tracking, the keys persist in git history forever. For devnet this is low financial risk, but the Helius key grants webhook management access.
3. **No secret rotation support (MEDIUM)**: Zero support for rotating any secret without downtime. HELIUS_WEBHOOK_SECRET change requires simultaneous update in Railway + Helius dashboard. DATABASE_URL rotation requires Railway redeploy. No dual-key acceptance pattern for any credential.
4. **Devnet keypairs in git (MEDIUM)**: 18 keypair files tracked, including Squads multisig signers. While devnet-only, the pattern creates risk if mainnet keypairs accidentally follow the same workflow.
5. **Health endpoint information disclosure (LOW)**: `/api/health` exposes WebSocket state, RPC credits, and dependency status without authentication.

## Novel Attack Surface

- **Helius API key webhook management abuse**: The devnet Helius API key in `.env.devnet` and `.env` (untracked but in working directory) can be used to call `POST https://api.helius.xyz/v0/webhooks?api-key=...` to create, modify, or delete webhooks. An attacker with repo read access could redirect webhook data to their own endpoint, hijacking all protocol event data, or delete the webhook to blind the protocol's data pipeline.

- **NEXT_PUBLIC_RPC_URL as build-time fingerprint**: Because `NEXT_PUBLIC_` env vars are inlined at build time by Next.js, any future developer setting `NEXT_PUBLIC_RPC_URL` to a mainnet Helius URL creates a permanent artifact in the production JavaScript bundle that reveals the API key even after the env var is rotated. The old key remains visible in cached/CDN-served bundles.

## Cross-Focus Handoffs

- -> **CHAIN-02 (RPC Node Trust)**: The RPC proxy at `app/app/api/rpc/route.ts` is the single chokepoint for all browser-to-Solana communication. If the proxy is compromised or misconfigured, all client RPC calls can be intercepted or spoofed. Verify the proxy's response integrity and caching behavior.
- -> **ERR-01 (Error Handling)**: The webhook auth fail-closed pattern (reject if secret missing in production) is critical. Verify that error paths in the webhook handler don't bypass the auth check or leak the secret in error responses.
- -> **DATA-04 (Logging & Disclosure)**: The backfill script (`scripts/backfill-candles.ts:256`) correctly redacts the API key in logs. Verify all scripts follow this pattern. The crank runner logs wallet public keys and RPC endpoint info.
- -> **INFRA-03 (Cloud/Env Config)**: Railway env var management is the single source of truth for production secrets. Verify Railway's variable masking, access controls, and audit logging.

## Trust Boundaries

The system has a clear server/client trust boundary for secret management. Browser-side code accesses Solana only through the RPC proxy (`/api/rpc`), which correctly keeps the Helius API key server-side. The webhook handler enforces fail-closed authentication in production. Database credentials are server-only (no NEXT_PUBLIC_ prefix). The main risk is at the dev/ops boundary: committed `.env.devnet` with real API keys, a mainnet template that instructs exposing the API key via NEXT_PUBLIC_, and no secret rotation mechanism. The crank wallet is the highest-value secret (signs on-chain transactions), protected by env-var-based loading with file fallback.
<!-- CONDENSED_SUMMARY_END -->

---

# SEC-02: Secret & Credential Management -- Full Analysis

## Executive Summary

The Dr. Fraudsworth project demonstrates solid secret management fundamentals for a crypto project at its maturity level. The H002 fix (RPC proxy pattern) successfully prevents Helius API key exposure in the browser bundle. Webhook authentication uses timing-safe comparison with fail-closed production behavior. Database credentials are server-only with lazy initialization.

However, several gaps remain:
- The `.env.devnet` file is committed to git with real Helius API keys and a third-party service key
- 18 devnet keypairs are tracked in git
- The mainnet environment template instructs placing the Helius API key in a `NEXT_PUBLIC_` variable
- No secret rotation mechanism exists for any credential
- The `shared/programs.ts` file still exports a hardcoded Helius API key (unused by app/ code but available)

## Scope

All off-chain code analyzed through the lens of secret and credential management:
- Where secrets are defined (env files, source code, config)
- How secrets are loaded (env vars, file reads, hardcoded)
- Where secrets flow (logging, error responses, client bundles, API calls)
- Secret lifecycle (creation, rotation, revocation)
- Trust boundaries between secret-holding and non-secret-holding components

On-chain Anchor programs are out of scope.

## Key Mechanisms

### 1. RPC Proxy -- Helius API Key Protection

**File:** `app/app/api/rpc/route.ts` (188 LOC)

The RPC proxy is the cornerstone of the H002 fix, keeping the Helius API key server-side.

**How it works:**
1. Browser calls `POST /api/rpc` with JSON-RPC payload
2. Proxy validates method against allowlist (19 methods)
3. Proxy forwards to `HELIUS_RPC_URL` (server-only env var)
4. Failover chain: HELIUS_RPC_URL > HELIUS_RPC_URL_FALLBACK > NEXT_PUBLIC_RPC_URL
5. Response returned to browser without exposing upstream URL

**Secret protection mechanisms:**
- `HELIUS_RPC_URL` has no `NEXT_PUBLIC_` prefix -- server-only
- `maskEndpoint()` at line 72-78 strips URLs to hostname in log output
- Method allowlist prevents abuse (e.g., no `getHealth` which some providers gate)

**Concern:** The fallback chain at line 131 includes `NEXT_PUBLIC_RPC_URL`. While this is only read server-side (in the API route handler), the env var's value IS baked into the client bundle by Next.js. The server-side read works, but the same key is also available client-side in the bundle. For mainnet, this is the primary API key exposure vector.

### 2. Webhook Authentication

**File:** `app/app/api/webhooks/helius/route.ts` (851 LOC, auth at lines 266-302)

**How it works:**
1. Production: If `HELIUS_WEBHOOK_SECRET` is unset, return 500 (fail-closed)
2. Non-production: If unset, skip auth entirely (dev convenience)
3. When set: Compare `Authorization` header against secret using `timingSafeEqual`
4. Length mismatch handled by comparing secret against itself (prevents length-based timing leak)

**Analysis of the timing-safe implementation (lines 293-299):**
```typescript
const secretBuf = Buffer.from(webhookSecret, "utf-8");
const headerBuf = Buffer.from(authHeader, "utf-8");
const lengthMatch = secretBuf.length === headerBuf.length;
const compareBuf = lengthMatch ? headerBuf : secretBuf;
if (!lengthMatch || !timingSafeEqual(secretBuf, compareBuf)) {
```

This is correct per SP-005 (timing-safe comparison pattern). The length-mismatch handling compares `secretBuf` against itself, which always returns `true` for timingSafeEqual but the `!lengthMatch` check rejects the request. This prevents timing information from leaking about the secret's content.

**Residual risk:** An attacker can determine the secret LENGTH by measuring the time for `Buffer.from(authHeader, "utf-8")` construction with various-length inputs. This is extremely low risk (length alone is not exploitable for reasonable secret lengths). A more robust approach would use HMAC-SHA256 to hash both values to fixed-length digests before comparison, but this is an enhancement, not a vulnerability.

### 3. Database Connection

**File:** `app/db/connection.ts` (103 LOC)

**Secret handling:**
- `DATABASE_URL` loaded from `process.env` (line 40) -- no NEXT_PUBLIC_ prefix
- Throws on missing (lines 41-46) -- fail-fast, no empty-string fallback
- TLS enforced via `ssl: "require"` in production (line 52)
- Non-production warns on remote hosts without TLS (lines 61-73)
- globalThis singleton pattern prevents pool exhaustion

**Concern (minor):** The warning at line 66-68 prints the hostname extracted from DATABASE_URL. For devnet this is fine; for mainnet, it reveals the database host in logs. The hostname is not the full URL (no credentials), so this is LOW risk.

### 4. Crank Wallet Loading

**File:** `scripts/crank/crank-provider.ts` (177 LOC)

**Loading priority:**
1. `WALLET_KEYPAIR` env var (JSON byte array string) -- for Railway
2. `WALLET` env var (file path)
3. `keypairs/devnet-wallet.json` (committed file, devnet only)

**Secret protection:**
- Error messages truncated to 100 chars (line 55: `String(err).slice(0, 100)`)
- Public key logged with first 12 chars only (line 51)
- No fallback to default/known keypair for mainnet

**Concern:** The WALLET env var accepts a file path. If an attacker can control the WALLET env var (e.g., via environment injection on Railway), they could point to any file readable by the process. However, this requires control over the deployment environment, which is a higher-privilege attack.

### 5. Irys/Arweave Metadata Upload

**File:** `scripts/deploy/upload-metadata.ts` (481 LOC)

**Secret handling:**
- Keypair loaded from CLI `--keypair` argument (line 125)
- Converted to base58 private key at line 126: `bs58.encode(Uint8Array.from(keypairBytes))`
- Passed to Irys SDK via `withWallet(privateKeyBase58)` (line 128)
- Private key exists in memory as both `keypairBytes` (array) and `privateKeyBase58` (string)
- No zeroization after use

**Risk:** The private key material is not cleared from memory after the upload completes. In a long-running process, this could be extracted via memory dump. For a one-shot deployment script that exits after completion, this is LOW risk.

## Trust Model

### Secret Categories

| Category | Secret | Loaded From | Client-Exposed? | Fail Behavior |
|----------|--------|-------------|-----------------|---------------|
| RPC Auth | Helius API Key | `HELIUS_RPC_URL` env var | NO (proxy) | Throw on missing |
| Webhook Auth | Webhook Secret | `HELIUS_WEBHOOK_SECRET` env var | NO | Fail-closed (500) in prod |
| Database | DB Connection String | `DATABASE_URL` env var | NO | Throw on missing |
| Signing | Crank Wallet | `WALLET_KEYPAIR` env var / file | NO | Throw on missing |
| Signing | Deploy Wallet | `--keypair` CLI arg / file | NO | Exit on missing |
| Error Tracking | Sentry DSN | `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | YES (intentional) | Silent no-op |
| Feature Config | Cluster | `NEXT_PUBLIC_CLUSTER` | YES (intentional) | Default "devnet" |

### Trust Boundary Diagram

```
UNTRUSTED                     BOUNDARY                      TRUSTED
Browser ──── /api/rpc ────── method allowlist ───── HELIUS_RPC_URL (server)
Browser ──── /api/sse ────── connection limits ──── protocolStore (server)
Helius  ──── /api/webhooks ── fail-closed auth ──── DB writes (server)
Developer ── keypairs/ ────── .gitignore rules ──── mainnet-* (untracked)
Railway  ──── env vars ────── no NEXT_PUBLIC_ ───── HELIUS_RPC_URL, DATABASE_URL
```

## State Analysis

### Environment Variables (Complete Inventory)

**Server-only (correctly protected):**
- `HELIUS_RPC_URL` -- Helius RPC with API key
- `HELIUS_RPC_URL_FALLBACK` -- Failover RPC
- `HELIUS_WEBHOOK_SECRET` -- Webhook auth token
- `DATABASE_URL` -- Postgres connection string
- `WALLET_KEYPAIR` -- Crank wallet bytes
- `WALLET` -- Wallet file path
- `WS_SUBSCRIBER_ENABLED` -- Feature flag
- `SENTRY_DSN` -- Server-side error reporting

**Client-exposed (NEXT_PUBLIC_ prefix):**
- `NEXT_PUBLIC_CLUSTER` -- Cluster name (safe, public info)
- `NEXT_PUBLIC_SITE_MODE` -- Launch/live toggle (safe)
- `NEXT_PUBLIC_RPC_URL` -- **RISK: Contains API key in mainnet template**
- `NEXT_PUBLIC_SENTRY_DSN` -- Sentry DSN (semi-public by design)
- `NEXT_PUBLIC_COMMIT_SHA` -- Git hash (safe)
- `NEXT_PUBLIC_CURVE_PHASE` -- Feature flag (safe)
- `NEXT_PUBLIC_DEMO_MODE` -- Feature flag (safe)
- `NEXT_PUBLIC_DOCS_URL` -- Docs URL (safe)

### Files Containing Secrets

| File | Tracked in Git? | Contents |
|------|----------------|----------|
| `.env` | NO (.gitignore) | Helius API key, SUPERMEMORY key, CLUSTER_URL |
| `.env.devnet` | **YES** | Same as .env + metadata URIs, Squads config |
| `.env.mainnet` | NO (.gitignore) | Template with CHANGE_ME placeholders |
| `app/.env.local` | NO (not tracked) | NEXT_PUBLIC_RPC_URL with Helius key |
| `app/.env.mainnet` | NO (not tracked) | Mainnet template, CHANGE_ME placeholders |
| `keypairs/*.json` | **YES (18 files)** | Devnet keypairs (secret keys) |
| `keypairs/mainnet-*` | NO (.gitignore) | Mainnet mint keypairs |
| `shared/programs.ts` | **YES** | Hardcoded devnet Helius API key |

## Dependencies (External APIs & Services)

### Helius (RPC + Webhooks)
- **API Key Scope:** Single key (`[REDACTED-DEVNET-KEY]...`) used for both RPC and webhook management
- **Permissions:** Full Helius API access (create/delete webhooks, RPC calls)
- **Least Privilege Violation:** The same key that provides RPC should not also manage webhooks. Helius supports separate keys for different purposes.
- **Exposure Points:** `.env.devnet` (committed), `.env` (local), `shared/programs.ts` (committed), `app/.env.local` (local)

### Sentry
- **DSN Structure:** `https://<key>@<host>/<project_id>`
- **Exposure:** Via `NEXT_PUBLIC_SENTRY_DSN` (intentionally client-exposed)
- **Risk:** DSN spam -- attacker can flood Sentry with garbage events. This is a known Sentry design trade-off (DSNs are considered semi-public). Rate limiting on Sentry side mitigates.

### Irys/Arweave
- **Auth:** Solana keypair-based signing
- **Scope:** Upload files to permanent Arweave storage, fund Irys node
- **Exposure:** Private key loaded from CLI argument, not env var

### CoinGecko / Binance (Price APIs)
- **Auth:** None required (public endpoints)
- **Exposure:** N/A

## Focus-Specific Analysis

### Secret Inventory -- Every Secret in the System

1. **Helius RPC API Key** (`[REDACTED-DEVNET-HELIUS-KEY]`)
   - Defined: `.env.devnet:8`, `shared/programs.ts:24`, `.env:4`
   - Loaded: `HELIUS_API_KEY`, `CLUSTER_URL`, `HELIUS_RPC_URL`, `NEXT_PUBLIC_RPC_URL`
   - Used: RPC calls, webhook management, backfill script
   - Logged: Redacted in `backfill-candles.ts:256` (`replace(HELIUS_API_KEY, "***")`), masked in `rpc/route.ts:72-78`
   - Client-exposed: NO for app/ code (RPC proxy). YES if NEXT_PUBLIC_RPC_URL is set with key.

2. **HELIUS_WEBHOOK_SECRET** (value not committed)
   - Defined: Railway env vars only
   - Loaded: `process.env.HELIUS_WEBHOOK_SECRET`
   - Used: `app/app/api/webhooks/helius/route.ts:270`
   - Logged: Never logged (only existence checked)
   - Client-exposed: NO

3. **DATABASE_URL** (value not committed)
   - Defined: Railway env vars, `.env.local` (local dev)
   - Loaded: `process.env.DATABASE_URL` in 3 files
   - Used: `app/db/connection.ts`, `app/drizzle.config.ts`, `app/db/migrate.ts`
   - Logged: Hostname extracted and logged in dev warning (`connection.ts:67`)
   - Client-exposed: NO

4. **WALLET_KEYPAIR / WALLET** (secret key bytes)
   - Defined: Railway env var (JSON array) or keypair files
   - Loaded: `scripts/crank/crank-provider.ts:46`, `scripts/deploy/lib/connection.ts:84`
   - Used: Transaction signing (crank, deployment)
   - Logged: Public key only (first 12 chars in crank-provider.ts:51)
   - Client-exposed: NO

5. **SUPERMEMORY_CC_API_KEY** (committed in .env.devnet)
   - Defined: `.env.devnet:1` (value: `[REDACTED-SUPERMEMORY-KEY]...`)
   - Loaded: Not referenced in any source code
   - Status: Orphaned/unused API key committed to version control

6. **Sentry DSN**
   - Defined: `NEXT_PUBLIC_SENTRY_DSN` (client), `SENTRY_DSN` (server)
   - Client-exposed: YES (by design -- Sentry DSNs are semi-public)

7. **Devnet Keypairs** (18 files in `keypairs/`)
   - All tracked in git: devnet-wallet, program keypairs, Squads signers, test keypairs
   - Mainnet keypairs correctly gitignored via `keypairs/mainnet-*`

### .gitignore Analysis

```
.env           # Root .env -- PROTECTED
.env.mainnet   # Mainnet env -- PROTECTED
```

**Missing:**
- `.env.devnet` is NOT in .gitignore (intentionally committed per file comment)
- `app/.env.local` is not in root .gitignore but typically excluded by Next.js defaults
- `keypairs/` directory is not gitignored -- individual `mainnet-*` patterns are

### Default/Fallback Values for Secrets

| Env Var | Fallback | Risk |
|---------|----------|------|
| `HELIUS_RPC_URL` | `NEXT_PUBLIC_RPC_URL` | Server-side only, acceptable |
| `NEXT_PUBLIC_CLUSTER` | `"devnet"` | Safe fallback -- worse case is devnet addresses in mainnet build (detectable) |
| `NEXT_PUBLIC_SITE_MODE` | `"launch"` | Safe -- restrictive default |
| `CLUSTER_URL` (crank) | `"http://localhost:8899"` | Safe for dev, crank throws on mainnet if missing |
| `WALLET` (deploy) | `"keypairs/devnet-wallet.json"` | Safe -- devnet only, mainnet requires explicit path |
| `COMMITMENT` (crank) | `"confirmed"` | Safe default |

No secret-type env vars have fallback defaults (AIP-010 pattern avoided). All critical secrets throw on missing.

## Cross-Focus Intersections

### SEC-02 x CHAIN-02 (RPC Node Trust)
The RPC proxy is both a secret protection mechanism and a trust boundary. If the proxy is bypassed or the server-side HELIUS_RPC_URL is misconfigured (e.g., pointing to a malicious RPC), all user transactions could be intercepted. The proxy doesn't validate RPC response integrity.

### SEC-02 x API-01 (Webhook Auth)
The webhook secret is the sole authentication mechanism for the data pipeline. If compromised, an attacker can inject fake swap events, epoch transitions, and carnage events into the database, corrupting charts, portfolio displays, and triggering incorrect SSE broadcasts to all connected clients.

### SEC-02 x INFRA-03 (Railway Config)
Railway is the single source of truth for production secrets. Railway's security posture (variable encryption, access controls, audit logging) directly determines the security of all server-side secrets. There's no external secret vault (AWS KMS, HashiCorp Vault).

### SEC-02 x DATA-04 (Logging)
Several scripts correctly redact API keys in logs:
- `backfill-candles.ts:256`: `RPC_URL.replace(HELIUS_API_KEY, "***")`
- `vrf/lib/reporter.ts:285`: `url.replace(/api-key=[^&]+/, "api-key=***")`
- `rpc/route.ts:72-78`: `maskEndpoint()` extracts hostname only

However, the crank runner at `crank-runner.ts` was previously flagged for logging wallet balance (H076 NOT_FIXED -- public info, low risk).

## Cross-Reference Handoffs

| To Agent | Item | Context |
|----------|------|---------|
| CHAIN-02 | RPC proxy response integrity | Does the proxy validate upstream RPC responses? Could a compromised Helius endpoint inject malicious account data? |
| ERR-01 | Webhook auth error paths | Do any error conditions in the webhook handler bypass the auth check? What happens if `timingSafeEqual` throws? |
| DATA-04 | Log redaction completeness | Are all instances of API key logging properly redacted? Check crank-runner.ts, VRF scripts, e2e scripts. |
| INFRA-03 | Railway env var security | What access controls protect Railway environment variables? Is there audit logging? |
| DEP-01 | `postgres` package auth handling | Does the postgres.js driver correctly handle TLS certificate validation? Any known CVEs? |

## Risk Observations (Full Detail)

### R1: NEXT_PUBLIC_RPC_URL Mainnet API Key Exposure (HIGH)

**File:** `app/.env.mainnet:49`
**What:** The mainnet environment template explicitly instructs: `NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=CHANGE_ME_MAINNET`
**Why risky:** `NEXT_PUBLIC_` prefix means Next.js inlines this value into the client JavaScript bundle at build time. Anyone can extract the Helius API key from the production bundle.
**Impact:** Attacker gets the mainnet Helius API key, enabling: webhook manipulation, RPC credit exhaustion, or use of a paid API key for their own purposes.
**Mitigation in place:** The RPC proxy makes `NEXT_PUBLIC_RPC_URL` unnecessary for browser use. However, `rpc/route.ts:131` still reads it as a server-side fallback.
**Recommendation:** Remove `NEXT_PUBLIC_RPC_URL` from the mainnet template entirely. Add a code comment in `rpc/route.ts` noting that `NEXT_PUBLIC_RPC_URL` fallback should be removed for mainnet. Or rename the server fallback to a non-NEXT_PUBLIC_ variable.

### R2: Committed API Keys in .env.devnet (HIGH)

**File:** `.env.devnet:1,8-9`
**What:** HELIUS_API_KEY and SUPERMEMORY_CC_API_KEY committed to git.
**Why risky:** Keys persist forever in git history. The Helius key grants webhook management access (create/delete/update webhooks).
**Impact:** Anyone with repo access can manage Helius webhooks, potentially redirecting event data or deleting webhooks.
**Recommendation:** Revoke and rotate the committed Helius API key. Use a separate, restricted Helius key for devnet that only permits RPC calls (not webhook management). Move `.env.devnet` to a non-committed secret management system or use `.env.devnet.example` with placeholders.

### R3: Devnet Keypairs in Git (MEDIUM)

**Files:** 18 files in `keypairs/` tracked by git
**What:** Secret keys for devnet wallet, program keypairs, Squads multisig signers, and test keypairs.
**Why risky:** Devnet keypairs hold devnet SOL and can sign devnet transactions. The pattern normalizes committing keypairs, increasing risk of accidental mainnet keypair commits.
**Mitigation:** Mainnet keypairs are correctly gitignored (`keypairs/mainnet-*`).
**Recommendation:** This was flagged as H005 (PARTIALLY_FIXED) in Audit #1. Consider moving devnet keypairs to a separate, non-committed location and using environment variables for all environments.

### R4: No Secret Rotation Support (MEDIUM)

**What:** No credential supports zero-downtime rotation.
**Why risky:** If any secret is compromised, rotation requires coordinated manual updates across Railway, Helius dashboard, and potentially code deployment.
**Recommendation:** For HELIUS_WEBHOOK_SECRET, implement dual-key acceptance (check current key, then previous key). For DATABASE_URL, Railway supports zero-downtime database URL rotation.

### R5: Hardcoded DEVNET_RPC_URL in Shared Package (MEDIUM)

**File:** `shared/programs.ts:23-24`
**What:** Full Helius devnet URL with API key hardcoded and exported.
**Why risky:** While no app/ code currently imports it, it's re-exported from `shared/index.ts:53` and available to any consumer. A future import could re-introduce the H002 vulnerability.
**Recommendation:** Remove the hardcoded URL or move it behind an environment variable.

### R6: Health Endpoint Information Disclosure (LOW)

**File:** `app/app/api/health/route.ts:66-72`
**What:** Returns WebSocket subscriber state, RPC credit counters, dependency status.
**Recommendation:** Add basic authentication or IP-restrict to internal health checks.

### R7: Webhook Secret Not HMAC-Verified (LOW)

**File:** `app/app/api/webhooks/helius/route.ts:287-301`
**What:** Webhook auth compares raw Authorization header against secret string. Helius uses a simple auth header, not HMAC-SHA256 signature over the body.
**Why notable:** Without body signing, an attacker who obtains the webhook secret can forge arbitrary webhook payloads. Body-based HMAC would require the attacker to also know the request body at signing time.
**Note:** This is a Helius platform limitation, not a code bug. Helius sends `authHeader` as a simple bearer token, not an HMAC signature.

### R8: Upload Script Private Key Not Zeroized (LOW)

**File:** `scripts/deploy/upload-metadata.ts:125-126`
**What:** `keypairBytes` and `privateKeyBase58` remain in memory after use.
**Risk:** Very low for a one-shot script that exits after completion.

### R9: Drizzle Config Non-Null Assertion on DATABASE_URL (LOW)

**File:** `app/drizzle.config.ts:22`
**What:** `url: process.env.DATABASE_URL!` -- TypeScript non-null assertion.
**Risk:** If DATABASE_URL is unset, drizzle-kit will throw a connection error (not a security issue, but bad DX).

### R10: SUPERMEMORY_CC_API_KEY Orphaned (LOW)

**File:** `.env.devnet:1`
**What:** API key committed but never referenced in any source code.
**Risk:** Wasted credential in version control. Should be revoked if service is no longer used.

## Novel Attack Surface Observations

### Helius Webhook Hijacking via Committed API Key

The committed Helius API key in `.env.devnet` grants full Helius API access including webhook management. An attacker with read access to the repository could:

1. Call `GET https://api.helius.xyz/v0/webhooks?api-key=[REDACTED-DEVNET-KEY]...` to list all webhooks
2. Call `PUT` to modify the webhook URL to point to an attacker-controlled endpoint
3. Receive all protocol events (swap data, epoch transitions, carnage events)
4. Alternatively, call `DELETE` to remove the webhook, blinding the protocol's data pipeline

This is specific to the devnet deployment. For mainnet, the API key would be different and stored only in Railway env vars. The risk is that the devnet key and mainnet key may be from the same Helius account, potentially sharing webhook management access.

### Build-Time Secret Fossilization

Next.js `NEXT_PUBLIC_` variables are inlined at build time into the JavaScript bundle. If a developer sets `NEXT_PUBLIC_RPC_URL` with a Helius API key during a Railway build, that key is permanently embedded in the build artifacts. Even after rotating the key in Railway env vars, the old key remains in:
- Railway's cached build layers
- Any CDN-served JavaScript bundles
- Browser caches of users who loaded the page

This is a novel attack surface specific to SSR frameworks with build-time env var injection.

## Questions for Other Focus Areas

1. **For CHAIN-02:** Does the CSP at `next.config.ts:43` allow `connect-src` to the Helius RPC domain? If so, could a browser script bypass the RPC proxy and connect directly to Helius (if it somehow obtained the API key)?
2. **For INFRA-03:** Are Railway env vars encrypted at rest? Is there an audit log of env var access/changes?
3. **For ERR-01:** What happens if `Buffer.from(webhookSecret, "utf-8")` throws (e.g., if the secret contains invalid UTF-8 sequences)? Does the error propagate past the auth check?
4. **For DATA-04:** The webhook handler at `route.ts:274-278` logs a CRITICAL error message that mentions the missing secret. Is this logged to a public-facing logging service?
5. **For DEP-01:** Is the `postgres` npm package (used for DATABASE_URL connections) keeping up with security patches? Any known vulnerabilities in the connection string parser?

## Raw Notes

- `.env` (root, untracked) contains same keys as `.env.devnet` -- the developer likely `source .env` before running scripts
- `app/.env.mainnet` is a reference template with CHANGE_ME placeholders -- correctly not committed but the guidance for NEXT_PUBLIC_RPC_URL is dangerous
- CSP `connect-src` at `next.config.ts:43` includes `https://${heliusRpcDomain}` -- this allows the browser to connect directly to Helius if it has the URL, but without the API key in the URL this is useless. If NEXT_PUBLIC_RPC_URL is set with the key, the browser CAN bypass the proxy.
- The `scripts/backfill-candles.ts:256` properly redacts the API key: `RPC_URL.replace(HELIUS_API_KEY, "***")`
- The `scripts/vrf/lib/reporter.ts:285` properly redacts: `url.replace(/api-key=[^&]+/, "api-key=***")`
- The `app/lib/sentry.ts` DSN parsing extracts `key` from URL username -- this key is not a traditional secret (it's a Sentry public key for envelope submission)
- No `console.log` statements found that directly print secret values (checked via grep for console.log with secret-like variable names)
- The `process.env.COMMITMENT` cast at `crank-provider.ts:37` and `scripts/deploy/lib/connection.ts:92` uses type assertion `as anchor.web3.Commitment` without validation -- not a secret issue but noted for ERR-01
- Railway auto-sets `NODE_ENV=production` which activates the webhook fail-closed behavior and DB TLS enforcement
