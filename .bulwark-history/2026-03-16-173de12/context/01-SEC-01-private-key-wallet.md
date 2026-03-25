---
task_id: db-phase1-private-key-wallet
provides: [private-key-wallet-findings, private-key-wallet-invariants]
focus_area: private-key-wallet
files_analyzed:
  - scripts/crank/crank-provider.ts
  - scripts/crank/crank-runner.ts
  - scripts/deploy/initialize.ts
  - scripts/deploy/lib/connection.ts
  - scripts/deploy/deploy-all.sh
  - scripts/graduation/graduate.ts
  - scripts/vrf/lib/vrf-flow.ts
  - scripts/vrf/devnet-vrf-validation.ts
  - scripts/e2e/lib/swap-flow.ts
  - scripts/webhook-manage.ts
  - scripts/backfill-candles.ts
  - app/hooks/useProtocolWallet.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/connection.ts
  - app/providers/providers.tsx
  - app/app/api/webhooks/helius/route.ts
  - shared/constants.ts
  - shared/programs.ts
  - shared/index.ts
  - .gitignore
  - .env
  - app/.env.local
  - keypairs/ (directory)
finding_count: 10
severity_breakdown: { critical: 1, high: 3, medium: 4, low: 2 }
---
<!-- CONDENSED_SUMMARY_START -->
# Private Key & Wallet Security -- Condensed Summary

## Key Findings (Top 10)

1. **Devnet keypairs committed to git**: All 11 keypair JSON files in `keypairs/` are tracked by git (devnet wallet, all 7 program deploy authorities, mock keypairs, carnage-wsol). `.gitignore` only excludes `scripts/deploy/mint-keypairs/`, not `keypairs/`. -- `keypairs/*.json` (git-tracked)
2. **Helius API key hardcoded in shared package**: The devnet Helius API key (`[REDACTED-DEVNET-KEY]...`) is hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22`, which are imported by the frontend (`app/lib/connection.ts:16`, `app/providers/providers.tsx:4`). This key ends up in the client-side JavaScript bundle. -- `shared/constants.ts:474`, `shared/programs.ts:22`
3. **Helius API key hardcoded in scripts**: Same API key hardcoded in `scripts/webhook-manage.ts:28` and `scripts/backfill-candles.ts:47-48` as fallback defaults. -- `scripts/webhook-manage.ts:28`
4. **CLUSTER_URL logged with embedded API key**: `scripts/crank/crank-runner.ts:177` logs `process.env.CLUSTER_URL` raw (contains API key). `scripts/e2e/smoke-test.ts:40` does the same. Contrast with `devnet-vrf-validation.ts:94` which properly redacts (`api-key=***`). -- `scripts/crank/crank-runner.ts:177`
5. **Webhook auth uses string equality (not timing-safe)**: `app/app/api/webhooks/helius/route.ts:138` compares `authHeader !== webhookSecret` using JavaScript `!==`. This is vulnerable to timing side-channel attacks. -- `route.ts:138`
6. **Webhook auth is optional**: When `HELIUS_WEBHOOK_SECRET` env var is unset, the webhook endpoint accepts unauthenticated requests. The code explicitly documents this as intentional for dev, but no guard ensures it's set in production. -- `route.ts:135-141`
7. **No key material zeroization**: No file in the codebase calls `.fill(0)` or equivalent on secret key byte arrays after use. `Uint8Array` containing secret keys in `crank-provider.ts`, `connection.ts`, `initialize.ts`, `graduate.ts` persist in memory until GC. -- all keypair-loading files
8. **WALLET_KEYPAIR env var contains full secret key JSON**: On Railway, the entire 64-byte secret key is passed as a JSON array string in `WALLET_KEYPAIR`. Railway env vars are visible in the dashboard and may appear in build logs. -- `scripts/crank/crank-provider.ts:41-57`
9. **Mint keypairs written to disk with no file permissions**: `initialize.ts:168` writes keypair JSON via `fs.writeFileSync` with default permissions (0644 typically). Contrast with `keypairs/` files which have `0600`. -- `scripts/deploy/initialize.ts:168`
10. **No secret validation on startup for crank**: `crank-provider.ts` validates keypair JSON parsing but does not validate the public key matches expected addresses. A wrong keypair could silently operate as a different wallet. -- `scripts/crank/crank-provider.ts:44-57`

## Critical Mechanisms

- **Crank Keypair Loading** (`crank-provider.ts:34-87`): Three-priority chain: `WALLET_KEYPAIR` env var (JSON byte array) > `WALLET` env var (file path) > `keypairs/devnet-wallet.json` (default file). The loaded keypair signs ALL crank transactions including vault top-ups (SOL transfers) and epoch transitions. Single point of compromise = full crank control.
- **Deploy Keypair Loading** (`scripts/deploy/lib/connection.ts:64-101`): Loads wallet from `WALLET` env var or default `keypairs/devnet-wallet.json`. This keypair is the upgrade authority for all 7 programs and the admin for all initialization operations. Compromise = protocol takeover.
- **Mint Keypair Persistence** (`initialize.ts:156-170`): Generates mint keypairs on first run, saves to `scripts/deploy/mint-keypairs/`. Used by `graduate.ts:206-217` which loads them to derive PDAs. These keypairs have mint authority (burned after init, but private keys still on disk).
- **Frontend Wallet** (`app/hooks/useProtocolWallet.ts`): Uses wallet-adapter (Phantom etc.) for user signing. No private keys in frontend code. Sign-then-send pattern gives app control over RPC submission. Properly scoped.
- **Client RPC URL** (`app/lib/connection.ts:31-33`): Falls back chain: `NEXT_PUBLIC_RPC_URL` > `DEVNET_RPC_URL` (hardcoded). Both contain the Helius API key, exposed in client bundle.

## Invariants & Assumptions

- INVARIANT: Private keys never appear in frontend source code. -- Enforced: no `Keypair.fromSecretKey` in `app/` directory.
- INVARIANT: Frontend wallet operations use external wallet signing only (never server-side keys). -- Enforced at `useProtocolWallet.ts` (wallet-adapter `signTransaction` only).
- INVARIANT: Mint keypairs are generated once and reused across deploys. -- Enforced at `initialize.ts:156-170` with `loadOrCreateMintKeypair()`.
- ASSUMPTION: `keypairs/devnet-wallet.json` is a devnet-only wallet with no mainnet value. -- UNVALIDATED: nothing prevents reuse on mainnet. The `.gitignore` does not protect `keypairs/`.
- ASSUMPTION: The Helius API key in `shared/` is a free-tier devnet key with no financial risk. -- PARTIALLY VALIDATED: comment in `shared/programs.ts:18` says "not a secret", but rate-limit abuse or key revocation could cause service disruption.
- ASSUMPTION: Railway env vars (WALLET_KEYPAIR, PDA_MANIFEST) are secure at rest. -- UNVALIDATED: depends on Railway's security posture; no encryption layer is used.

## Risk Observations (Prioritized)

1. **CRITICAL -- Keypairs in git history**: Even if `keypairs/` were added to `.gitignore` now, the secret keys are already in git history. For mainnet, completely new keypairs must be generated and the old ones considered compromised. `keypairs/*.json` tracked by git.
2. **HIGH -- Hardcoded API key in client bundle**: The Helius API key in `shared/constants.ts` and `shared/programs.ts` is compiled into the Next.js client bundle. Any user can extract it from browser devtools and abuse the rate limit or use it for their own RPC calls. Mainnet Helius keys have credit costs.
3. **HIGH -- No mainnet keypair strategy**: The codebase has no HSM/KMS integration, no multi-sig, no key rotation mechanism. The single `WALLET_KEYPAIR` env var pattern used for the crank and deploy scripts will not be adequate for mainnet where the same key controls program upgrades and crank operations.
4. **HIGH -- Webhook auth bypass**: Optional webhook authentication with non-timing-safe comparison. An attacker could forge webhook payloads to inject false swap events into the database, corrupting price data and OHLCV candles.
5. **MEDIUM -- CLUSTER_URL logged with API key**: Crank runner logs to stdout (Railway captures), potentially exposing the RPC API key in log aggregation systems.
6. **MEDIUM -- Mint keypair file permissions**: `initialize.ts` writes keypair files with default permissions (likely 0644), making them world-readable on shared systems.
7. **MEDIUM -- No wallet address validation on crank startup**: Wrong keypair loaded silently. Could result in transactions that fail (wrong signer) or worse, operating with an unintended wallet.
8. **MEDIUM -- No key zeroization**: Secret key byte arrays persist in Node.js heap memory until GC. In a long-running process like the crank runner, this increases the window for memory dump attacks.

## Novel Attack Surface

- **RPC key in shared package as client-side constant**: The `@dr-fraudsworth/shared` package exports `HELIUS_API_KEY` and `DEVNET_RPC_URL` as plain constants. Next.js `transpilePackages` includes these in the client bundle. This is a supply-chain-like exposure: changing the shared package affects both backend scripts and the frontend bundle simultaneously. On mainnet, this pattern would expose a paid Helius key.
- **Graduation script loads mint keypairs from deploy phase**: `graduate.ts:206-217` reads `scripts/deploy/mint-keypairs/` which contains the mint authority keypairs. The mint authority is burned during init, making these keypairs useless for minting -- but they are still the canonical keypair file format, and an attacker with file access could confuse them with active keypairs.

## Cross-Focus Handoffs

- **SEC-02 (Secret & Credential Management)**: The `.env` file contains `SUPERMEMORY_CC_API_KEY`, `HELIUS_API_KEY`, and `CLUSTER_URL` with embedded key. Investigate whether these are properly scoped and whether the Supermemory key has excessive permissions.
- **API-04 (Webhook Security)**: The Helius webhook handler at `app/app/api/webhooks/helius/route.ts` has optional auth with non-timing-safe comparison. Full analysis of injection surface needed.
- **BOT-01 (Crank Security)**: The crank runner uses the same keypair for epoch transitions and vault SOL top-ups. If the crank wallet is compromised, attacker can drain top-up SOL. Investigate separation of concerns.
- **INFRA-03 (Railway Deployment)**: `WALLET_KEYPAIR` as a Railway env var containing the full 64-byte secret key. Investigate Railway's env var encryption and access controls.

## Trust Boundaries

The project has a clear separation between frontend (user wallets via wallet-adapter, no server-side keys) and backend (crank/deploy scripts with file-based or env-var-based keypairs). The trust boundary is sound for the frontend: private keys never enter the app code. However, the backend trust model relies entirely on file system security for keypair files and environment variable security for Railway deployments. There is no HSM, KMS, multi-sig, or key rotation layer. The single-keypair-controls-everything model (one wallet for deploy authority, crank operations, vault top-ups, and program upgrades) creates a dangerous concentration of privilege. For devnet, this is acceptable. For mainnet, this architecture needs fundamental redesign with privilege separation, hardware security modules, and key rotation capabilities.
<!-- CONDENSED_SUMMARY_END -->

---

# Private Key & Wallet Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase handles private keys in two distinct contexts: (1) backend scripts (crank runner, deploy, graduation, VRF) that load keypairs from files or environment variables, and (2) the Next.js frontend that uses wallet-adapter for user signing without ever touching private keys server-side. The frontend pattern is sound. The backend pattern is functional for devnet but has significant gaps for mainnet readiness: committed keypairs in git, hardcoded API keys in the shared package that leak into client bundles, no key rotation or HSM integration, and a single-wallet-controls-everything privilege model.

## Scope

All off-chain TypeScript, TSX, and Shell files. On-chain Anchor programs in `programs/` are excluded.

**Files analyzed deeply (Layer 3):**
- `scripts/crank/crank-provider.ts` -- keypair loading for 24/7 crank
- `scripts/crank/crank-runner.ts` -- crank main loop, vault top-ups
- `scripts/deploy/initialize.ts` -- mint keypair generation and persistence
- `scripts/deploy/lib/connection.ts` -- deploy keypair loading
- `scripts/graduation/graduate.ts` -- graduation keypair loading
- `scripts/vrf/lib/vrf-flow.ts` -- VRF transaction signing
- `app/hooks/useProtocolWallet.ts` -- frontend wallet abstraction
- `app/lib/swap/multi-hop-builder.ts` -- TX construction (no keys)
- `app/lib/connection.ts` -- RPC connection with API key
- `app/app/api/webhooks/helius/route.ts` -- webhook auth
- `shared/constants.ts` -- hardcoded API key
- `shared/programs.ts` -- hardcoded RPC URL with API key

**Files analyzed at Layer 2 (signatures only):**
- `scripts/e2e/lib/swap-flow.ts` -- uses E2EUser keypairs (test context)
- `scripts/vrf/devnet-vrf-validation.ts` -- uses loadProvider (same pattern)
- `scripts/deploy/deploy-all.sh` -- orchestrator, sources .env
- `scripts/webhook-manage.ts` -- hardcoded API key fallback
- `scripts/backfill-candles.ts` -- hardcoded API key
- `app/providers/providers.tsx` -- DEVNET_RPC_URL import

## Key Mechanisms

### 1. Keypair Loading Chain (Backend Scripts)

Three independent loading implementations exist:

**A. Deploy scripts** (`scripts/deploy/lib/connection.ts:64-101`):
```
loadProvider() -> WALLET env var || "keypairs/devnet-wallet.json" -> fs.readFileSync -> JSON.parse -> Keypair.fromSecretKey
```
Used by: `initialize.ts`, `verify.ts`, `graduate.ts`, `devnet-vrf-validation.ts`

**B. Crank runner** (`scripts/crank/crank-provider.ts:34-87`):
```
loadCrankProvider() -> WALLET_KEYPAIR env var (JSON array) || WALLET env var (file path) || "keypairs/devnet-wallet.json" -> Keypair.fromSecretKey
```
Priority 1 (WALLET_KEYPAIR) is used on Railway where files aren't available. The entire secret key byte array is stored as a JSON string in the environment variable.

**C. Mint keypair persistence** (`scripts/deploy/initialize.ts:156-170`):
```
loadOrCreateMintKeypair(name) -> check scripts/deploy/mint-keypairs/{name}-mint.json -> if missing, generate + save -> return Keypair
```
These are used only during deployment. The mint authority is burned after initialization (irreversible), so the keypairs become inert for minting purposes. However, the files still contain valid secret keys.

### 2. Frontend Wallet (No Server-Side Keys)

`app/hooks/useProtocolWallet.ts` wraps `@solana/wallet-adapter-react`'s `useWallet()`. The abstraction:
- Exposes `signTransaction` + `sendRawTransaction` (sign-then-send pattern)
- Never accesses private keys -- wallet signing happens in the browser extension
- No `Keypair` imports, no `fromSecretKey` calls
- The sign-then-send pattern was chosen specifically because Phantom's `signAndSendTransaction` routes through Phantom's own RPC (not the app's Helius endpoint), causing silent TX drops on devnet.

### 3. API Key Exposure Path

```
shared/constants.ts (HELIUS_API_KEY = "[REDACTED-DEVNET-KEY]...")
  -> shared/programs.ts (DEVNET_RPC_URL includes key in URL)
  -> shared/index.ts (barrel re-export)
  -> app/lib/connection.ts (import DEVNET_RPC_URL)
  -> app/providers/providers.tsx (import DEVNET_RPC_URL)
  -> Next.js client bundle (compiled into JS, visible in browser)
```

The `NEXT_PUBLIC_RPC_URL` env var in `.env.local` also contains the same key, and is designed to be exposed to the client (that's what `NEXT_PUBLIC_` prefix does in Next.js).

For devnet, this is low-impact (free tier key). For mainnet, this pattern must change -- the RPC key must be server-side only, proxied through an API route.

### 4. Webhook Authentication

`app/app/api/webhooks/helius/route.ts:131-141`:
- If `HELIUS_WEBHOOK_SECRET` env var is set: checks `Authorization` header equality
- If env var is unset: skips auth entirely (allows unauthenticated POSTs)
- Comparison uses `!==` (not `crypto.timingSafeEqual`)
- The webhook writes to Postgres (swap_events, epoch_events, carnage_events) and triggers SSE price broadcasts

## Trust Model

| Component | Key Source | Trust Level | Concern |
|-----------|-----------|-------------|---------|
| Crank runner | Env var (Railway) or file | High (signs all epoch TXs) | Single key, no rotation |
| Deploy scripts | File (keypairs/) | Critical (upgrade authority) | Committed to git |
| Graduation script | File (mint-keypairs/) | High (creates AMM pools with 1000+ SOL) | Persisted on disk |
| Frontend | Wallet-adapter (browser extension) | User-controlled | Proper separation |
| Webhook handler | Env var (optional) | Medium (DB write access) | Auth bypass possible |

## State Analysis

**Keypair files on disk:**
- `keypairs/devnet-wallet.json` -- devnet wallet (admin, crank, deploy authority)
- `keypairs/{program}-keypair.json` -- 7 program deploy keypairs (determine program addresses)
- `keypairs/carnage-wsol.json` -- WSOL account keypair for carnage operations
- `keypairs/StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU.json` -- unknown purpose
- `keypairs/fake-tax-keypair.json`, `keypairs/mock-tax-keypair.json` -- test keypairs
- `scripts/deploy/mint-keypairs/{crime,fraud,profit}-mint.json` -- mint authority keypairs (gitignored)

**Environment variables (Railway):**
- `WALLET_KEYPAIR` -- Full 64-byte secret key as JSON array
- `PDA_MANIFEST` -- Full PDA manifest JSON (not a secret, but large)
- `CLUSTER_URL` -- RPC URL with embedded API key
- `HELIUS_WEBHOOK_SECRET` -- Webhook auth token
- `CARNAGE_WSOL_PUBKEY` -- Public key only (safe)

## Dependencies

- `@solana/web3.js` -- `Keypair.fromSecretKey()`, `Connection`
- `@coral-xyz/anchor` -- `Wallet` wrapper, `AnchorProvider`
- `@solana/wallet-adapter-react` -- Frontend wallet integration
- `@switchboard-xyz/on-demand` -- VRF operations (uses same wallet)
- `fs` (Node.js) -- Keypair file I/O

## Focus-Specific Analysis

### Key Lifecycle: Generation -> Storage -> Usage -> Retirement

**Generation:**
- Devnet wallet: `solana-keygen new` (manual, one-time)
- Program keypairs: `solana-keygen new` or `anchor build` (one-time per deploy)
- Mint keypairs: `initialize.ts:loadOrCreateMintKeypair()` or `deploy-all.sh` Phase 0 (`solana-keygen new`)
- VRF randomness keypairs: `Keypair.generate()` per epoch transition (ephemeral)

**Storage:**
- Disk: `keypairs/` directory (committed to git), `scripts/deploy/mint-keypairs/` (gitignored)
- Environment: `WALLET_KEYPAIR` on Railway (JSON array of secret key bytes)
- Memory: Loaded into `Keypair` objects, never explicitly zeroized

**Usage:**
- Deploy authority: Signs all program deployments and initialization transactions
- Crank wallet: Signs epoch transitions, vault top-ups, VRF create/commit/reveal
- Mint authority: Signs mint creation and token minting (then authority is burned)
- Frontend: Never touches server keys; uses wallet-adapter for user signing

**Retirement:**
- Mint authority: Burned on-chain (`createSetAuthorityInstruction` with `null` new authority) in initialize.ts. Irreversible. But keypair files remain on disk.
- Other keys: No rotation mechanism. No retirement procedure documented.

### Specific File Analysis

#### `scripts/crank/crank-provider.ts`
- **Lines 44-57**: WALLET_KEYPAIR parsing. Good: wraps in try/catch, truncates error to 100 chars (prevents leaking full key in error messages). Bad: no validation that the parsed key is the expected wallet address.
- **Lines 50-52**: Logs truncated public key (`slice(0, 12)...`). Safe -- only public key, truncated.
- **Lines 58-80**: File-based fallback. Good: checks file existence. Bad: no file permission check.

#### `scripts/crank/crank-runner.ts`
- **Lines 97-112**: `loadCarnageWsolPubkey()`. Loads WSOL account's SECRET KEY just to extract the public key. This is unnecessary -- a `PublicKey` could be derived from the env var or stored separately. Reading the full keypair file to get a pubkey means secret key bytes are in memory.
- **Line 177**: Logs `process.env.CLUSTER_URL` raw. If CLUSTER_URL contains an API key (as in the .env file), this leaks to Railway logs.

#### `scripts/deploy/initialize.ts`
- **Lines 156-170**: `loadOrCreateMintKeypair()`. Good: creates directory with `recursive: true`. Bad: `fs.writeFileSync` with no explicit permissions (defaults to umask, typically 0644).
- **Line 168**: Writes `Array.from(keypair.secretKey)` to disk. The secretKey Uint8Array is not zeroized after writing.
- **Lines 1179-1184**: Carnage WSOL keypair handling. Same pattern -- load or generate, save to disk.

#### `shared/programs.ts`
- **Lines 18-22**: Comment says "not a secret" for the Helius API key in DEVNET_RPC_URL. For devnet free tier, this is arguably true. For mainnet, this would be a critical exposure. The pattern trains developers to accept hardcoded keys.

#### `app/app/api/webhooks/helius/route.ts`
- **Lines 131-141**: Optional auth. The `if (webhookSecret)` guard means: no env var = no auth. This is explicitly documented for dev convenience, but nothing enforces it's set in production.
- **Line 138**: `authHeader !== webhookSecret` -- standard JavaScript string comparison, not timing-safe.

## Cross-Focus Intersections

| Other Focus | Intersection | Detail |
|-------------|-------------|--------|
| SEC-02 | .env contains SUPERMEMORY_CC_API_KEY | Unknown service, unknown permissions |
| BOT-01/02 | Crank wallet = deploy wallet | Single key controls both automation and admin |
| API-04 | Webhook auth bypass | Unauthenticated DB writes possible |
| INFRA-03 | Railway env var security | WALLET_KEYPAIR in Railway dashboard |
| CHAIN-01 | skipPreflight usage | Not SEC-01, but affects TX security |
| ERR-01 | Error message truncation | crank-provider.ts truncates errors (good for key safety) |

## Cross-Reference Handoffs

1. **SEC-02**: Investigate `SUPERMEMORY_CC_API_KEY` in `.env` -- scope, permissions, rotation.
2. **API-04**: Full webhook injection analysis -- what happens if attacker sends forged swap events.
3. **BOT-01**: Crank wallet separation of concerns -- should epoch transitions and vault top-ups use different keys?
4. **INFRA-03**: Railway deployment security -- env var encryption, access logs, build log exposure.

## Risk Observations

### R-01: Keypairs Committed to Git (CRITICAL)

**Files:** All 11 files in `keypairs/` directory
**Evidence:** `git ls-files | grep keypair` returns all files
**Impact:** Anyone with repository access (current or historical) has the devnet wallet private key and all program deploy authority keys. For devnet, impact is limited (SOL is free). For mainnet, this is catastrophic -- attacker could upgrade all programs, drain all wallets.
**Mitigation:** Add `keypairs/` to `.gitignore`, remove from git history with `git filter-repo`, generate new keypairs for mainnet.

### R-02: Hardcoded Helius API Key in Client Bundle (HIGH)

**Files:** `shared/constants.ts:474`, `shared/programs.ts:22`
**Impact:** Key exposed in browser. Devnet: rate limit abuse. Mainnet: credit consumption, service disruption.
**Mitigation:** For mainnet, move RPC URL to server-side only. Create an API route proxy or use `NEXT_PUBLIC_` with a different (rate-limited) key.

### R-03: No Mainnet Key Management Strategy (HIGH)

**Files:** All keypair-loading code
**Impact:** The single-wallet model with file/env-var based keys has no: HSM/KMS, multi-sig, key rotation, access audit trail, separation of duties.
**Mitigation:** Document mainnet key management plan. Consider: Squads multi-sig for program upgrades, separate crank wallet with limited SOL, KMS for signing.

### R-04: Optional Webhook Authentication (HIGH)

**File:** `app/app/api/webhooks/helius/route.ts:131-141`
**Impact:** Unauthenticated webhook allows price data injection via forged swap events. Could manipulate displayed prices.
**Mitigation:** Make webhook auth mandatory (throw on missing env var in production). Use timing-safe comparison.

### R-05: API Key Logged in Crank Output (MEDIUM)

**File:** `scripts/crank/crank-runner.ts:177`
**Impact:** Railway log aggregation captures the Helius API key. Anyone with Railway log access sees it.
**Mitigation:** Redact API keys in logs (pattern: `url.replace(/api-key=[^&]+/, "api-key=***")`), as already done in `devnet-vrf-validation.ts:94`.

### R-06: Mint Keypair File Permissions (MEDIUM)

**File:** `scripts/deploy/initialize.ts:168`
**Impact:** On shared systems, default file permissions may allow other users to read keypair files.
**Mitigation:** Use `fs.writeFileSync(filePath, data, { mode: 0o600 })`.

### R-07: No Wallet Address Validation on Crank Startup (MEDIUM)

**File:** `scripts/crank/crank-provider.ts:44-57`
**Impact:** If wrong keypair is loaded (wrong env var, wrong file), crank silently operates as different wallet. Transactions would fail (wrong signer) but SOL for fees comes from the wrong wallet.
**Mitigation:** Add startup validation: check loaded public key against expected address (from manifest or env var).

### R-08: Secret Key in Memory for Public Key Extraction (MEDIUM)

**File:** `scripts/crank/crank-runner.ts:110-111`
**Impact:** `loadCarnageWsolPubkey()` reads the full keypair just to call `.publicKey`. The secret key bytes are unnecessarily in memory.
**Mitigation:** Accept `CARNAGE_WSOL_PUBKEY` env var (already supported as priority 1). Remove the keypair fallback for Railway.

### R-09: No Key Zeroization (LOW)

**Files:** All keypair-loading files
**Impact:** Secret key Uint8Arrays persist in Node.js heap until GC. In long-running processes (crank), this extends the attack window for memory dump exploits.
**Mitigation:** After creating the `Keypair`, zero the source `Uint8Array`: `secretKeyBytes.fill(0)`. Note: the Keypair object still holds a reference internally, so this is defense-in-depth only.

### R-10: Webhook String Comparison Timing (LOW)

**File:** `app/app/api/webhooks/helius/route.ts:138`
**Impact:** Theoretical timing side-channel on webhook secret. Practical exploitation is extremely difficult over network.
**Mitigation:** Use `crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(webhookSecret))`.

## Novel Attack Surface Observations

1. **Shared package as secret distribution vector**: The `@dr-fraudsworth/shared` package is consumed by both backend scripts (Node.js) and frontend (browser via Next.js transpilePackages). Any secret added to `shared/` automatically enters the client bundle. This is a particularly insidious pattern because the import path looks like a server-side module import, not a client-side exposure.

2. **Carnage WSOL keypair as unnecessary attack surface**: The carnage WSOL account is a wrapped SOL token account. Its keypair is only needed during creation. After that, only its public key matters (for account addressing). Yet the full keypair file persists on disk and is loaded by the crank runner. If an attacker gains the keypair, they could close the WSOL account (destroying wrapped SOL), disrupting carnage operations.

3. **Program deploy keypairs = deterministic program addresses**: The committed program keypairs in `keypairs/` determine the program addresses. An attacker who knows the program keypair could deploy a malicious program to the same address on a different cluster, then social-engineer users to connect to the wrong cluster. This is mitigated by `NEXT_PUBLIC_` cluster configuration but worth noting.

## Questions for Other Focus Areas

- **BOT-01**: Does the crank runner have any rate limiting on vault top-ups? Could a bug cause rapid SOL drain from the crank wallet?
- **INFRA-03**: Are Railway environment variables encrypted at rest? Who has access to the Railway dashboard?
- **CHAIN-01**: The VRF flow generates ephemeral `Keypair.generate()` keypairs for randomness accounts. Are these ever logged or persisted?
- **SEC-02**: What is `SUPERMEMORY_CC_API_KEY` used for? What permissions does it have?

## Raw Notes

- The `keypairs/devnet-wallet.json` address is `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` (from CLAUDE.md memory).
- Crank runner on Railway has `restartPolicyMaxRetries = 10` -- if keypair loading fails repeatedly, Railway gives up. No alerting mechanism documented.
- The `.env.local` file with `NEXT_PUBLIC_RPC_URL` is not in `.gitignore` but is also not tracked by git (verified with `git ls-files`). It should be added to `.gitignore` to prevent accidental commits.
- The `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5.json` and `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc.json` in the project root are untracked keypair files (per git status). These appear to be vanity address keypairs for FRAUD and CRIME program IDs.
- `scripts/deploy/deploy-all.sh` sources `.env` before running child scripts. This is the correct pattern (centralized env loading). But if `.env` is accidentally committed, all secrets are exposed.
