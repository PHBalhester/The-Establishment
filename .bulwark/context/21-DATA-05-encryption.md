---
task_id: db-phase1-data-05-encryption
provides: [data-05-encryption-findings, data-05-encryption-invariants]
focus_area: data-05-encryption
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/db/connection.ts, app/db/migrate.ts, app/db/schema.ts, app/drizzle.config.ts, app/lib/sentry.ts, app/lib/rate-limit.ts, app/lib/connection.ts, app/lib/protocol-store.ts, app/lib/sse-manager.ts, app/lib/ws-subscriber.ts, app/app/api/rpc/route.ts, app/app/api/sse/protocol/route.ts, app/next.config.ts, app/middleware.ts, app/instrumentation.ts, scripts/crank/crank-provider.ts, scripts/crank/crank-runner.ts, scripts/deploy/lib/connection.ts, scripts/deploy/verify-authority.ts, scripts/deploy/upload-metadata.ts, scripts/webhook-manage.ts, shared/constants.ts, .gitignore]
finding_count: 8
severity_breakdown: {critical: 0, high: 1, medium: 3, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# DATA-05: Encryption & Data Protection -- Condensed Summary

## Key Findings (Top 8)

1. **DB migration script has no TLS enforcement**: `app/db/migrate.ts:42` creates a postgres client with `postgres(databaseUrl, { max: 1 })` and no `ssl` option. Railway's preDeployCommand runs this in production, potentially transmitting credentials and migration SQL in plaintext. The main `app/db/connection.ts:52` enforces TLS in production but this code path is entirely separate.

2. **Drizzle config has no TLS enforcement**: `app/drizzle.config.ts:22` uses `url: process.env.DATABASE_URL!` with no SSL configuration. If `drizzle-kit studio` or `drizzle-kit push` is run against a remote host, credentials transmit in plaintext.

3. **Webhook auth uses plaintext comparison, not HMAC**: `app/app/api/webhooks/helius/route.ts:286-301` compares the Authorization header directly against HELIUS_WEBHOOK_SECRET using `timingSafeEqual`. This is a shared-secret scheme, not HMAC-SHA256. Helius's `authHeader` field is sent verbatim as the Authorization header value. The `timingSafeEqual` usage is correctly implemented (constant-time, length-mismatch safe), but the auth model relies on TLS transport integrity -- if TLS were compromised, the secret would be exposed in plaintext in the header.

4. **SSE streams carry protocol state over unencrypted channel on non-HTTPS**: `app/app/api/sse/protocol/route.ts` streams decoded on-chain account state to browsers. HSTS (`app/next.config.ts:109-113`) forces HTTPS on browsers that have visited before, but first-visit or non-browser clients may connect over HTTP. The `upgrade-insecure-requests` CSP directive (`next.config.ts:46`) provides defense-in-depth.

5. **Sentry error envelopes may include stack traces with file paths**: `app/lib/sentry.ts:176-185` sends full stack trace frames (up to 20 lines) to Sentry ingest API via HTTPS. This includes server-side file paths. While Sentry is a trusted third party and TLS protects in-transit, stack frames reveal internal directory structure and file names if Sentry is compromised.

6. **Crank wallet keypair transmitted as env var**: `scripts/crank/crank-provider.ts:46` parses WALLET_KEYPAIR from env var (JSON array of secret key bytes). On Railway, this is an environment variable. Railway encrypts env vars at rest and injects them securely, but the secret key material is present in process memory. No HSM/KMS integration.

7. **crypto.randomUUID() used for Sentry event IDs**: `app/lib/sentry.ts:150` uses `crypto.randomUUID()` for Sentry event IDs. This is CSPRNG-backed and appropriate for non-security-critical identifiers.

8. **No encryption at rest for database data**: `app/db/schema.ts` stores `userWallet` (Base58 public keys), swap amounts, and epoch data as plaintext varchar/bigint columns. These are all public on-chain data and not PII, so encryption at rest is not required for regulatory compliance, but wallet addresses could be considered pseudonymous identifiers.

## Critical Mechanisms

- **Webhook HMAC/Auth**: `app/app/api/webhooks/helius/route.ts:286-301` -- Shared-secret auth (not HMAC). `timingSafeEqual` from `node:crypto` with length-mismatch padding using self-comparison. Fail-closed in production (line 273). Concern: Plaintext secret in Authorization header relies entirely on TLS.

- **Database TLS**: `app/db/connection.ts:48-57` -- Conditional TLS (`ssl: "require"`) for production only. Non-production connections to remote hosts log a warning (line 63-69). Concern: `migrate.ts` and `drizzle.config.ts` bypass this entirely.

- **RPC API Key Protection**: `app/app/api/rpc/route.ts` + `app/lib/connection.ts:35-36` -- Browser RPC calls proxied through `/api/rpc` to keep Helius API key server-side. `maskEndpoint()` (route.ts:72-77) redacts API keys from log output. Endpoint URLs in `HELIUS_RPC_URL` contain API keys as URL path/query parameters.

- **HSTS + CSP**: `app/next.config.ts:82-117` -- HSTS with 2-year max-age, includeSubDomains, preload. CSP with `upgrade-insecure-requests`. Prevents SSL stripping and enforces HTTPS for subsequent visits.

## Invariants & Assumptions

- INVARIANT: Webhook authentication is fail-closed in production -- enforced at `app/app/api/webhooks/helius/route.ts:273-284` (if `!webhookSecret && isProduction`, returns 500)
- INVARIANT: Database connections use TLS in production -- enforced at `app/db/connection.ts:51-52` (conditional `ssl: "require"`) / NOT enforced in `app/db/migrate.ts` or `app/drizzle.config.ts`
- INVARIANT: Helius API key never reaches browser -- enforced at `app/lib/connection.ts:35-36` (browser gets `/api/rpc` proxy URL) and `app/app/api/rpc/route.ts:72-77` (endpoint URLs masked in logs)
- INVARIANT: `timingSafeEqual` used for all secret comparisons -- enforced at `app/app/api/webhooks/helius/route.ts:299` / only one crypto comparison in entire off-chain codebase
- ASSUMPTION: Railway encrypts environment variables at rest -- UNVALIDATED (Railway-managed infrastructure)
- ASSUMPTION: Sentry DSN is treated as non-secret (public key component) -- validated by Sentry's security model (DSN key is a public identifier, not an auth secret)
- ASSUMPTION: All data stored in PostgreSQL (swap events, candles, epoch/carnage events) is public on-chain data requiring no encryption at rest -- validated by examining `app/db/schema.ts` (all fields are public blockchain data)

## Risk Observations (Prioritized)

1. **migrate.ts missing TLS**: `app/db/migrate.ts:42` -- Runs as Railway preDeployCommand in production. DB credentials and migration SQL may transmit unencrypted. Impact: credential interception on network path between Railway worker and Postgres host.

2. **drizzle.config.ts missing TLS**: `app/drizzle.config.ts:22` -- Developer tool, but may be run against remote devnet/production hosts during development. Credentials exposed if network is untrusted.

3. **No HMAC for webhook auth**: `app/app/api/webhooks/helius/route.ts:286-301` -- Shared secret in Authorization header is simpler but weaker than HMAC-SHA256. If a proxy logs Authorization headers (which is non-standard but possible), the secret is exposed. HMAC would allow verification without exposing the key in transit.

4. **Stack traces sent to Sentry**: `app/lib/sentry.ts:176-185` -- Server-side file paths in stack frames. Low risk (Sentry is trusted, TLS protected), but defense-in-depth would strip or hash paths.

## Novel Attack Surface

- **Webhook secret rotation gap**: The webhook auth model uses a single shared secret (`HELIUS_WEBHOOK_SECRET`). There is no support for rotating secrets (accepting both old and new key during transition). A rotation requires coordinating Helius webhook config update + Railway env var update atomically, or accepting a window where webhooks are rejected. This is unique to the webhook architecture -- most systems support dual-key rotation.

## Cross-Focus Handoffs

- --> **SEC-02 (Signature Verification)**: Verify the Helius webhook auth model (shared-secret in Authorization header vs HMAC-SHA256). Determine if Helius's webhook delivery actually uses the `authHeader` field as a plaintext Authorization header value, and whether an HMAC-based scheme is available.
- --> **DATA-01 (Data Persistence)**: The `migrate.ts` TLS gap means database write operations during migrations lack transport security. Verify whether Railway's internal network provides encryption at the infrastructure level.
- --> **INFRA-03 (Cloud/Env Config)**: Railway environment variable security model -- are env vars encrypted in transit when injected into containers? Does Railway's internal network between app and Postgres use mTLS?
- --> **SEC-01 (Access Control)**: Crank wallet private key stored as env var (`WALLET_KEYPAIR`) -- assess whether KMS/HSM integration is warranted given the crank wallet's spending capabilities.

## Trust Boundaries

The codebase has a well-structured encryption and data protection posture for a Solana DeFi frontend. All browser-to-server communication is HTTPS-enforced via HSTS with preload. The single cryptographic operation (webhook auth) uses `timingSafeEqual` correctly with a length-mismatch-safe implementation. The primary gaps are in database migration tooling (missing TLS enforcement) and the absence of HMAC-based webhook verification. No user PII is collected or stored -- the database contains only public on-chain blockchain data (transaction signatures, wallet addresses, swap amounts). The crank wallet private key is the most sensitive data element, managed via Railway environment variables without HSM/KMS integration.
<!-- CONDENSED_SUMMARY_END -->

---

# DATA-05: Encryption & Data Protection -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase has a limited but focused cryptographic surface area. There is exactly **one** crypto primitive used: `timingSafeEqual` from `node:crypto` for webhook authentication. The project does not perform encryption/decryption, password hashing, or key derivation. The primary data protection mechanism is TLS (HTTPS/WSS) enforced via HSTS headers and CSP `upgrade-insecure-requests`. Database TLS is enforced in the main connection module but is missing from the migration runner and Drizzle config. No user PII is collected -- all stored data is public blockchain information.

## Scope

### Files Analyzed (24 total)

**Layer 3 -- Full Source Read (10 files):**
- `app/app/api/webhooks/helius/route.ts` (851 LOC) -- Primary crypto operation (timingSafeEqual)
- `app/db/connection.ts` (102 LOC) -- Database TLS enforcement
- `app/db/migrate.ts` (57 LOC) -- Migration runner (missing TLS)
- `app/drizzle.config.ts` (25 LOC) -- Drizzle Kit config (missing TLS)
- `app/lib/sentry.ts` (235 LOC) -- Error reporting with stack traces
- `app/lib/connection.ts` (87 LOC) -- RPC connection factory (API key protection)
- `app/app/api/rpc/route.ts` (188 LOC) -- RPC proxy (API key protection)
- `scripts/crank/crank-provider.ts` (177 LOC) -- Private key handling
- `scripts/deploy/lib/connection.ts` (145 LOC) -- Deploy script key handling
- `app/next.config.ts` (122 LOC) -- HSTS, CSP, security headers

**Layer 2 -- Signature Scan (14 files):**
- `app/db/schema.ts` -- Database schema (data at rest classification)
- `app/lib/rate-limit.ts` -- No crypto ops, checked for secret handling
- `app/lib/protocol-store.ts` -- In-memory state cache, no encryption
- `app/lib/sse-manager.ts` -- SSE broadcast, no encryption
- `app/lib/ws-subscriber.ts` -- WebSocket data pipeline, no crypto
- `app/app/api/sse/protocol/route.ts` -- SSE streaming, data-in-transit
- `app/middleware.ts` -- Route gating, no crypto
- `app/instrumentation.ts` -- Server boot, no crypto
- `scripts/crank/crank-runner.ts` -- Crank loop, references keypair loading
- `scripts/deploy/verify-authority.ts` -- Keypair loading (file-based)
- `scripts/deploy/upload-metadata.ts` -- Arweave upload, keypair loading
- `scripts/webhook-manage.ts` -- Webhook secret handling
- `shared/constants.ts` -- Public program IDs (no secrets)
- `.gitignore` -- Secret exclusion patterns

## Key Mechanisms

### 1. Webhook Authentication (timingSafeEqual)

**Location:** `app/app/api/webhooks/helius/route.ts:286-301`

**How it works:**
1. `HELIUS_WEBHOOK_SECRET` loaded from env var (line 270)
2. In production, missing secret returns HTTP 500 (fail-closed, lines 273-284)
3. When secret is set, the Authorization header is compared using `timingSafeEqual`
4. Length mismatch is handled by comparing secret against itself (line 298), preventing timing leaks that would reveal the secret's length

**Analysis:**
- The implementation follows SP-005 (constant-time comparison) and SP-021 (webhook signature verification) patterns from the secure patterns guide
- The length-mismatch handling is a well-known defense: `const compareBuf = lengthMatch ? headerBuf : secretBuf` ensures the comparison always runs for `secretBuf.length` bytes, even when lengths differ
- This is NOT HMAC-SHA256 -- it's a direct shared-secret comparison. Helius sends the `authHeader` value as a plaintext Authorization header. This means the secret traverses the network in every webhook request. TLS protects this in transit, but:
  - Proxy servers that log headers would capture the secret
  - TLS termination at Railway's load balancer means the secret may be in plaintext within Railway's internal network
  - No message integrity -- a replay attack (within the 5-minute window) could inject modified payloads if an attacker compromised the TLS session

### 2. Database TLS

**Main connection -- `app/db/connection.ts:48-57`:**
```typescript
const isProductionDb = process.env.NODE_ENV === "production";
const sslConfig = isProductionDb ? { ssl: "require" as const } : {};
const client = globalForDb.pgClient ?? postgres(connectionString, { max: 10, ...sslConfig });
```
- Production: `ssl: "require"` -- postgres.js establishes TLS connection
- Non-production: No TLS. A warning is logged for remote hosts (line 63-69)
- `ssl: "require"` does NOT verify the server certificate (equivalent to `rejectUnauthorized: false`). For full certificate verification, `ssl: { rejectUnauthorized: true, ca: ... }` is needed

**Migration runner -- `app/db/migrate.ts:42`:**
```typescript
const client = postgres(databaseUrl, { max: 1 });
```
- No `ssl` option at all. Runs as Railway `preDeployCommand` in production
- The DATABASE_URL may or may not contain `?sslmode=require` as a query parameter (depends on Railway's Postgres provisioning), but it's not explicitly enforced in code

**Drizzle Kit config -- `app/drizzle.config.ts:22`:**
```typescript
dbCredentials: { url: process.env.DATABASE_URL! }
```
- No SSL configuration. Used by developers running `drizzle-kit studio` or `drizzle-kit push`

### 3. API Key Protection (RPC Proxy)

**Architecture:**
- Browser -> `/api/rpc` (same-origin, no API key) -> Helius RPC (server-side, API key in URL)
- `app/lib/connection.ts:35-36`: Browser gets proxy URL, never the Helius URL
- `app/app/api/rpc/route.ts:72-77`: `maskEndpoint()` strips API key from log output

**Effectiveness:**
- The HELIUS_RPC_URL (containing API key) is a server-only env var (no `NEXT_PUBLIC_` prefix)
- The proxy enforces a method allowlist (lines 31-59) preventing abuse of the proxied endpoint
- Rate limiting is applied before forwarding (line 82-89)

### 4. HSTS and Transport Security

**Location:** `app/next.config.ts:108-113`
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```
- 2-year HSTS with preload -- browsers that have visited will always use HTTPS
- CSP includes `upgrade-insecure-requests` (line 46) -- browsers automatically upgrade HTTP to HTTPS
- `X-Frame-Options: DENY` prevents clickjacking
- `X-Content-Type-Options: nosniff` prevents MIME confusion

### 5. Private Key Handling

**Crank provider -- `scripts/crank/crank-provider.ts:40-56`:**
- Priority 1: `WALLET_KEYPAIR` env var (JSON byte array)
- Priority 2: `WALLET` env var (file path)
- Priority 3: `keypairs/devnet-wallet.json` (committed file)
- Public key is logged (truncated to 12 chars, line 51)
- Secret key bytes are parsed from JSON and used to create `Keypair.fromSecretKey`
- No HSM/KMS integration -- key material is in process memory

**Deploy scripts -- `scripts/deploy/lib/connection.ts:84-86`:**
- Same pattern: `fs.readFileSync` -> `JSON.parse` -> `Keypair.fromSecretKey`
- Keypair file path from env var or default

**Gitignore protection -- `.gitignore:16`:**
- `keypairs/mainnet-*` prevents mainnet keypairs from being committed
- Devnet keypairs (`keypairs/devnet-wallet.json`) are committed (acceptable for devnet)

## Trust Model

### Data Classification

| Data Element | Storage | Classification | Encryption Needed? |
|---|---|---|---|
| Swap events (amounts, prices) | PostgreSQL | Public on-chain data | No |
| Candle OHLCV data | PostgreSQL | Derived from public data | No |
| Epoch events (tax rates) | PostgreSQL | Public on-chain data | No |
| Carnage events | PostgreSQL | Public on-chain data | No |
| User wallet addresses | PostgreSQL (userWallet) | Pseudonymous public key | No (public on-chain) |
| Helius API key | HELIUS_RPC_URL env var | Secret credential | N/A (env var) |
| Webhook secret | HELIUS_WEBHOOK_SECRET env var | Shared secret | N/A (env var) |
| Crank wallet private key | WALLET_KEYPAIR env var | Critical secret | Should be KMS |
| Sentry DSN | NEXT_PUBLIC_SENTRY_DSN | Public identifier | No |
| Database URL | DATABASE_URL env var | Contains password | N/A (env var) |
| Protocol account state | In-memory (protocol-store) | Public on-chain data | No |

### Data in Transit

| Path | Protocol | TLS? | Notes |
|---|---|---|---|
| Browser <-> Next.js | HTTPS | Yes (HSTS enforced) | First visit may be HTTP, CSP upgrades |
| Next.js <-> Helius RPC | HTTPS | Yes (helius-rpc.com) | API key in URL path |
| Next.js <-> PostgreSQL | postgres:// | Conditional | Production: `ssl: "require"`. Migrations: None |
| Helius <-> Next.js webhook | HTTPS | Yes | Shared secret in Auth header |
| Next.js <-> Sentry | HTTPS | Yes | Stack traces in payload |
| Crank <-> Solana RPC | HTTPS | Yes | Private key signs locally, only signed TX sent |

### Data at Rest

| Store | What | Encrypted? | Notes |
|---|---|---|---|
| PostgreSQL | Swap/candle/epoch/carnage events | No | All public blockchain data |
| Railway env vars | Secrets (API keys, keypairs) | Railway-managed | Railway encrypts env vars |
| In-memory (globalThis) | Protocol account state | N/A | Process memory, volatile |
| Git repo | Devnet keypairs | No | Committed in `keypairs/` directory |

## State Analysis

### Database

- **Engine:** PostgreSQL via postgres.js + Drizzle ORM
- **Schema:** 4 tables (`swap_events`, `candles`, `epoch_events`, `carnage_events`) -- all public blockchain data
- **TLS:** Enforced in production via `app/db/connection.ts:52` (`ssl: "require"`)
- **Connection pooling:** max 10 connections, singleton via globalThis
- **Query safety:** All queries use Drizzle ORM parameterized queries (no raw SQL)
- **Gap:** `migrate.ts` and `drizzle.config.ts` do not enforce TLS

### In-Memory Cache (Protocol Store)

- **Engine:** `Map<string, AccountState>` in `app/lib/protocol-store.ts`
- **Data:** Decoded on-chain account states (EpochState, PoolState, StakePool, etc.)
- **Persistence:** None -- volatile, repopulated from webhooks on restart
- **Encryption:** None needed (public data, not persisted)
- **Access control:** Any server-side code can call `protocolStore.getAccountState()`

## Dependencies (External APIs & Packages)

### Crypto Primitives Used

| Primitive | Source | Usage | Assessment |
|---|---|---|---|
| `timingSafeEqual` | `node:crypto` | Webhook auth | Correct usage, constant-time |
| `crypto.randomUUID` | Browser/Node `crypto` | Sentry event IDs | CSPRNG, appropriate |
| `Math.random` | V8 PRNG | Audio track shuffling | Non-security, acceptable |

### Packages with Crypto Surface

| Package | Usage | Notes |
|---|---|---|
| `postgres` (postgres.js) | DB driver with TLS | `ssl: "require"` mode used in production |
| `@solana/web3.js` | Transaction signing | Signs in-browser via wallet adapter, server-side via Keypair |
| `@coral-xyz/anchor` | Account decoding | No crypto ops in off-chain code (CPI signing is on-chain) |
| `@irys/upload-solana` | Arweave upload signing | Used in deploy script only, not production |
| `bs58` | Base58 encoding | Used for keypair encoding in deploy scripts |

## Focus-Specific Analysis

### Cryptographic Algorithm Assessment

**Algorithms in use:**
- `timingSafeEqual` -- Not an algorithm per se, but a comparison primitive. Used correctly.
- No encryption algorithms (AES, ChaCha, etc.) are used anywhere in the off-chain codebase
- No hashing algorithms (SHA-256, bcrypt, etc.) are used
- No key derivation functions (PBKDF2, scrypt, etc.) are used

**What's absent (and why):**
- No data encryption at rest -- all stored data is public blockchain information
- No password hashing -- no user accounts, no authentication system (wallet-based auth)
- No JWT/session management -- stateless frontend, wallet signatures are the auth mechanism
- No key derivation -- keys are loaded from files/env vars, not derived

### IV/Nonce Reuse Assessment

Not applicable -- no encryption operations exist in the codebase.

### PRNG Quality Assessment

- `crypto.randomUUID()` in `app/lib/sentry.ts:150` -- CSPRNG, used for non-security-critical event IDs
- `Math.random()` in `app/lib/audio-manager.ts:343,353` -- Used for audio track shuffling only (FP H112 confirmed safe in Audit #1)
- No PRNG usage for security-sensitive values (tokens, nonces, keys)

### Key Management Assessment

**Crank wallet (most sensitive):**
- Stored as Railway env var (`WALLET_KEYPAIR`)
- Loaded at process start, held in memory for lifetime
- Signs epoch transitions, VRF operations, Carnage execution
- Has spending capability (vault top-up, SOL transfers)
- No KMS/HSM integration -- accepted risk for devnet, should be assessed for mainnet
- H004 (Audit #1) flagged this as PARTIALLY_FIXED -- spending cap added but no external alerting

**Deployer wallet:**
- File-based (`keypairs/devnet-wallet.json` for devnet, `keypairs/mainnet-*` for mainnet)
- Mainnet keypairs gitignored (`.gitignore:16`)
- Devnet keypairs committed (acceptable)

**Helius API key:**
- In `HELIUS_RPC_URL` env var as URL parameter
- Never exposed to browser (RPC proxy architecture)
- `maskEndpoint()` strips from logs

**Webhook secret:**
- In `HELIUS_WEBHOOK_SECRET` env var
- Fail-closed in production
- Single-secret (no rotation support)

### Timing Side-Channel Assessment

**Webhook auth (`route.ts:286-301`):**
```typescript
const secretBuf = Buffer.from(webhookSecret, "utf-8");
const headerBuf = Buffer.from(authHeader, "utf-8");
const lengthMatch = secretBuf.length === headerBuf.length;
const compareBuf = lengthMatch ? headerBuf : secretBuf;
if (!lengthMatch || !timingSafeEqual(secretBuf, compareBuf)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Analysis:
- `timingSafeEqual` always compares `secretBuf.length` bytes -- correct
- When lengths differ, `compareBuf = secretBuf` causes self-comparison (always true), but `!lengthMatch` short-circuits to reject -- correct
- The `!lengthMatch` check does leak that lengths differ, but this is unavoidable without padding. The secret length is effectively fixed (set once in env var), so this is acceptable.
- `Buffer.from(webhookSecret, "utf-8")` and `Buffer.from(authHeader, "utf-8")` allocate new buffers each request -- no buffer reuse risk

**Potential concern:** The `Buffer.from()` allocation time is proportional to string length. An attacker could theoretically measure response time to determine whether `authHeader` length matches `webhookSecret` length. However, network jitter makes this impractical, and the secret length is not itself sensitive information.

## Cross-Focus Intersections

### SEC-02 (Signature Verification)
- The webhook auth is the only signature/secret verification in the off-chain code
- Audit #1 H001 confirmed the `timingSafeEqual` fix and H006 cleared timing attack as NOT_VULNERABLE
- The auth model (shared secret vs HMAC) is a SEC-02 concern

### DATA-01 (Data Persistence)
- Database TLS gap in `migrate.ts` affects data-in-transit for persistence operations
- All stored data is public on-chain data -- no encryption at rest needed

### INFRA-03 (Cloud/Env Config)
- Railway's internal network security model determines whether `migrate.ts` TLS gap is exploitable
- Railway environment variable encryption model determines crank wallet key security

### SEC-01 (Access Control)
- Crank wallet spending capabilities without KMS/HSM is an access control concern
- Audit #1 H004 partially addressed this with spending caps

## Cross-Reference Handoffs

| Target Agent | Item | Reason |
|---|---|---|
| SEC-02 | Webhook shared-secret vs HMAC model | Determine if Helius supports HMAC-SHA256 webhook signing |
| DATA-01 | migrate.ts TLS gap | Assess whether Railway internal network provides transport encryption |
| INFRA-03 | Railway env var security model | Validate encryption-at-rest for WALLET_KEYPAIR, DATABASE_URL |
| SEC-01 | Crank wallet KMS/HSM assessment | Evaluate whether mainnet crank needs KMS integration |
| ERR-01 | Sentry stack trace data leakage | Assess whether file paths in Sentry envelopes need scrubbing |

## Risk Observations

### 1. migrate.ts Missing TLS (Medium)
**File:** `app/db/migrate.ts:42`
**Impact:** Database credentials and migration SQL transmitted without TLS in production
**Likelihood:** Possible -- depends on Railway internal network architecture
**Mitigation:** Add `ssl: "require"` to the postgres client options, or parse SSL from DATABASE_URL

### 2. drizzle.config.ts Missing TLS (Low)
**File:** `app/drizzle.config.ts:22`
**Impact:** Developer credentials exposed when running Drizzle Kit against remote hosts
**Likelihood:** Unlikely -- developers typically use local databases
**Mitigation:** Document that Drizzle Kit should only be run against localhost or add SSL

### 3. Webhook Secret Rotation Gap (Medium)
**File:** `app/app/api/webhooks/helius/route.ts:270`
**Impact:** During secret rotation, webhooks are either rejected (downtime) or accepted with old key (delayed rotation)
**Likelihood:** Rare -- rotation is infrequent
**Mitigation:** Accept both `HELIUS_WEBHOOK_SECRET` and `HELIUS_WEBHOOK_SECRET_PREVIOUS` for rotation window

### 4. ssl: "require" Without Certificate Verification (Medium)
**File:** `app/db/connection.ts:52`
**Impact:** `ssl: "require"` in postgres.js does not verify server certificate by default. A MITM attacker could present a fraudulent certificate and intercept DB traffic.
**Likelihood:** Unlikely -- requires network-level compromise between Railway app and Postgres
**Mitigation:** Use `ssl: { rejectUnauthorized: true, ca: readFileSync(CA_CERT) }` for full verification

### 5. Sentry Stack Trace Exposure (Low)
**File:** `app/lib/sentry.ts:176-185`
**Impact:** Internal file paths exposed to Sentry (third party)
**Likelihood:** Very low -- requires Sentry compromise
**Mitigation:** Strip or hash file paths before sending (defense-in-depth)

### 6. No Crank Wallet KMS (Low)
**File:** `scripts/crank/crank-provider.ts:44-56`
**Impact:** Private key in process memory for entire crank lifetime
**Likelihood:** Requires Railway container compromise
**Mitigation:** Integrate with AWS KMS or similar for mainnet deployment

### 7. Devnet Keypairs in Git History (Low)
**File:** `keypairs/devnet-wallet.json` (committed)
**Impact:** Devnet keypairs are public in git history
**Likelihood:** N/A for devnet (no real funds)
**Mitigation:** Already addressed -- mainnet keypairs gitignored. H005 (Audit #1) noted git history not purged.

### 8. Database SSL Mode "require" vs "verify-full" (Low)
**File:** `app/db/connection.ts:52`
**Impact:** `ssl: "require"` establishes encrypted connection but doesn't verify server identity
**Likelihood:** Very low -- MITM between Railway internal services
**Mitigation:** Upgrade to `ssl: { rejectUnauthorized: true }` with CA cert for production

## Novel Attack Surface Observations

### Webhook Secret Exfiltration via Proxy Header Logging
If Railway's reverse proxy (nginx-based, per `app/app/api/sse/protocol/route.ts:132` referencing "Railway uses nginx-based proxy") logs Authorization headers at the proxy layer, the webhook secret would be captured in proxy logs. Railway's proxy configuration is not controllable by the application. An HMAC-based scheme (where the secret is never transmitted, only a digest) would eliminate this risk entirely. This is specific to the Helius webhook architecture's use of a plaintext shared secret in the Authorization header.

### SSE Protocol State Stream as Timing Oracle
The SSE protocol stream (`/api/sse/protocol`) broadcasts account state changes in real-time. While the data is public on-chain, the timing of webhook delivery provides a low-latency signal about on-chain events (epoch transitions, Carnage execution). An attacker could use this as a faster-than-RPC notification channel for MEV strategies. This is inherent to the SSE architecture, not a bug, but worth noting as a data-protection-adjacent concern.

## Questions for Other Focus Areas

1. **For SEC-02:** Does Helius offer HMAC-SHA256 webhook signing as an alternative to the `authHeader` shared-secret model? If so, migrating would eliminate the plaintext-secret-in-header risk.

2. **For INFRA-03:** Does Railway's internal network between app containers and managed PostgreSQL use mTLS or any form of transport encryption? If so, the `migrate.ts` TLS gap may be mitigated at the infrastructure level.

3. **For SEC-01:** What is the maximum SOL the crank wallet can transfer in a single transaction? The spending cap from H004 should be verified against the vault top-up logic (`VAULT_TOP_UP_LAMPORTS = 5_000_000` lamports = 0.005 SOL per crank-runner.ts:76).

4. **For ERR-01:** The Sentry error reporting sends stack traces. If an error contains user-influenced data (e.g., a bad swap amount that causes an exception), could user data leak into Sentry via error messages?

## Raw Notes

### Search Patterns Used
- Primary: `crypto`, `createHmac`, `createCipheriv`, `encrypt`, `decrypt`, `timingSafeEqual`, `createHash`, `randomBytes`
- Secondary: `HMAC`, `sha256`, `Buffer.from`, `secret`, `PRIVATE_KEY`, `WALLET_KEYPAIR`, `DATABASE_URL`
- Tertiary: `ssl`, `tls`, `rejectUnauthorized`, `certificate`
- Control: `Math.random` (found only in audio-manager.ts -- non-security)
- Control: `productionBrowserSourceMaps`, `sourcemap` (not found -- source maps correctly disabled)

### AI-Pitfall Checks Performed
- AIP-079 (DB without TLS): Found in `migrate.ts` and `drizzle.config.ts`. Main connection is protected.
- AIP-083 (AES with ECB/hardcoded key): No encryption operations found -- N/A.
- AIP-084 (S3 public ACL): No S3 usage -- N/A.
- AIP-085 (Cache without TTL): In-memory cache has no TTL but is volatile (acceptable for protocol state).
- AIP-086 (Stack traces in responses): Error responses use generic messages (`"Internal server error"`, `"Unauthorized"`). Stack traces sent only to Sentry (server-side, not in responses).
- AIP-090 (Source maps in production): No `productionBrowserSourceMaps` or `sourcemap: true` found. Source maps correctly disabled.

### Findings from Audit #1 Rechecked
- H001 (Webhook Auth Bypass): FIXED -- fail-closed + timingSafeEqual confirmed intact in modified file
- H002 (Helius API Key in Bundle): FIXED -- API key stays in HELIUS_RPC_URL (no NEXT_PUBLIC_ prefix), proxy architecture confirmed
- H011 (DB Without TLS): FIXED in main connection -- but migration script gap identified as new finding
- H026 (Missing HSTS): FIXED -- 2-year max-age with preload confirmed in modified file
