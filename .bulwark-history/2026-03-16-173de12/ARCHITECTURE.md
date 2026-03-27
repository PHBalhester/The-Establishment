# Unified Off-Chain Architectural Understanding

**Project:** Dr. Fraudsworth's Finance Factory
**Generated:** 2026-03-07T17:30:00Z
**Source:** Dinh's Bulwark Phase 2 Synthesis (24 context auditors)

---

## Executive Summary

Dr. Fraudsworth's Finance Factory is a Solana DeFi protocol with a substantial off-chain surface: a Next.js 16 frontend dApp, a 24/7 crank runner on Railway, 6 API routes (including a Helius webhook handler and SSE streaming), PostgreSQL for chart data, and deployment/graduation scripts that handle admin keypairs and irreversible state transitions.

The off-chain architecture has a clean trust model in principle -- all financial enforcement happens on-chain, with the off-chain layer providing display previews, transaction construction, and automated epoch management. However, several systemic gaps undermine this defense-in-depth: (1) the webhook authentication is fail-open by design, creating a data poisoning pipeline from unauthenticated HTTP POST to SSE broadcast; (2) the Helius API key is hardcoded in committed source and bundled into client JavaScript, enabling rate-limit exhaustion and webhook management abuse; (3) the crank runner has no spending limits, kill switch, or alerting; (4) the JavaScript npm supply chain is unprotected (lockfile gitignored, no CI/CD, no dependency scanning); and (5) the AMM quote engine uses JavaScript `number` type, already producing imprecise results at current pool sizes.

The on-chain SOS audit identified critical findings (bonding curve authority gap, transfer hook init front-running) that the off-chain layer cannot compensate for but should be aware of in cross-boundary analysis. The off-chain layer's primary security contribution is the `minimumOutput` slippage parameter -- if the off-chain quote engine computes this incorrectly (due to Number precision loss or stale data), users accept worse execution rates even though on-chain enforcement prevents outright theft.

---

## System Overview

### Core Components

| Component | Type | Purpose | Location | Security Role |
|-----------|------|---------|----------|---------------|
| Next.js Frontend | dApp (SSR + CSR) | Token swap UI, bonding curve launch page, staking, charts | `app/` | Constructs and submits transactions; computes slippage bounds |
| API Routes (6) | REST + SSE | Candle data, SOL price proxy, health, webhook handler, SSE streaming, carnage events | `app/app/api/` | Data ingestion (webhook), real-time broadcast (SSE), price proxy |
| Crank Runner | Background Bot | Epoch transitions, VRF commit/reveal, Carnage execution, vault top-ups | `scripts/crank/` | Signs and submits on-chain transactions with admin wallet |
| PostgreSQL | Database | Swap events, candle OHLCV, carnage events | `app/db/` | Stores webhook-ingested data for chart display |
| Deployment Scripts | Admin CLI | Program deploy, initialization, graduation, ALT creation | `scripts/deploy/`, `scripts/graduation/` | Handles admin keypairs, irreversible state transitions |
| Shared Constants | Package | Program IDs, mints, fee BPS, API keys | `shared/` | Single source of truth for protocol constants |

### Technology Stack

| Layer | Technology | Version | Security Notes |
|-------|-----------|---------|----------------|
| Runtime | Node.js (Nixpacks) | Auto-detected | No version pinning in Railway config |
| Framework | Next.js | 16.1.6 | App Router, Turbopack, `unsafe-inline` CSP |
| Database | PostgreSQL (Railway) | Auto-provisioned | No TLS enforcement in app code |
| ORM | Drizzle | 0.45.1 | Parameterized queries (no SQL injection) |
| Blockchain SDK | @solana/web3.js | 1.98.4 (app) / ^1.95.5 (root) | Version mismatch between workspaces |
| Anchor | @coral-xyz/anchor | 0.32.1 | BN type for on-chain arguments |
| Hosting | Railway | PaaS | 3 services: web, crank, docs |
| Error Reporting | Custom Sentry | Zero-dependency | Client-side only; server-side is no-op |

### Data Flow Diagram

```
                         ┌─────────────────────┐
    Browser Users ──────→│  Next.js Frontend    │──── RPC ────→ Solana
         │               │  (app/)              │                 │
         │               │  - useSwap           │◄─── WebSocket ──┘
         │               │  - useStaking        │
         │               │  - BuyForm/SellForm  │
         │               └──────────┬───────────┘
         │                          │
         │ SSE ◄────────── /api/sse/candles
         │                          │
         │                  SSE Manager (in-memory)
         │                          ▲
         │                          │ broadcast
         │                          │
    Helius ───── POST ──→ /api/webhooks/helius ──→ PostgreSQL
    (webhook)        (optional auth!)                  │
                                                       ▼
                                               Candle Aggregator
                                               (6 resolutions)

    ┌──────────────────┐
    │  Crank Runner     │──── RPC ────→ Solana
    │  (Railway)        │
    │  - epoch advance  │
    │  - VRF commit/    │
    │    reveal/consume  │
    │  - carnage execute │
    │  - vault top-up   │
    └──────────────────┘
```

---

## Trust Model

### Actors

| Actor | Trust Level | Capabilities | Entry Points |
|-------|-------------|--------------|--------------|
| Anonymous Browser User | UNTRUSTED | All API routes (no auth), SSE connection, frontend interaction | `/api/*`, SSE, wallet-connected TX |
| Wallet-Connected User | PARTIAL | Sign transactions via wallet adapter | `useSwap`, `useStaking`, `BuyForm`, `SellForm` |
| Helius Webhook | UNTRUSTED (should be PARTIAL) | POST to webhook endpoint; auth is OPTIONAL | `/api/webhooks/helius` |
| Crank Runner | SYSTEM (TRUSTED) | Sign+submit epoch/VRF/carnage TXs, vault top-ups | Direct RPC, admin wallet signing |
| Admin Operator | TRUSTED | Run deployment scripts, graduation, keypair management | CLI scripts on local machine |
| Helius RPC | PARTIAL | Blockchain state reads, TX submission | `app/lib/connection.ts`, crank-provider |
| Railway Platform | TRUSTED | Hosting, env var storage, log capture, health checks | `railway.toml` config |
| npm Registry | UNTRUSTED (treated as TRUSTED) | Dependency resolution on every build | No lockfile committed |

### Trust Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│                      UNTRUSTED ZONE                            │
│  - All browser client input (swap amounts, slippage settings)  │
│  - Helius webhook payloads (when HELIUS_WEBHOOK_SECRET unset)  │
│  - SSE connections (no auth, no rate limit)                    │
│  - npm registry packages (no lockfile pinning)                 │
│  - RPC responses (used for display, not enforcement)           │
├────────────────────────────────────────────────────────────────┤
│                      VALIDATION LAYER (WEAK)                   │
│  - Webhook auth: OPTIONAL (fail-open if env var unset)         │
│  - Input validation: parseFloat + range checks in React hooks  │
│  - CSP: Present but has script-src 'unsafe-inline'             │
│  - Rate limiting: NONE on any endpoint                         │
│  - No CI/CD, no dependency scanning, no automated tests on PR  │
├────────────────────────────────────────────────────────────────┤
│                      TRUSTED ZONE                              │
│  - On-chain program enforcement (slippage, caps, state gates)  │
│  - Drizzle ORM parameterized queries (SQL injection safe)      │
│  - Server-side price proxy (CoinGecko/Binance)                 │
│  - Wallet adapter sign-then-send flow                          │
├────────────────────────────────────────────────────────────────┤
│                      SENSITIVE ZONE                             │
│  - Crank wallet keypair (WALLET_KEYPAIR env var)               │
│  - Admin keypairs (keypairs/ directory)                        │
│  - Database connection string (DATABASE_URL)                   │
│  - Helius webhook secret (HELIUS_WEBHOOK_SECRET)               │
│  - Graduation state file (graduation-state.json)               │
└────────────────────────────────────────────────────────────────┘
```

---

## Critical Invariants

| ID | Invariant | Enforcement | Status | Source Agents |
|----|-----------|-------------|--------|---------------|
| INV-OC1 | On-chain program enforces minimumOutput regardless of client-side quote | On-chain constraint | ENFORCED | LOGIC-01, LOGIC-02, CHAIN-01 |
| INV-OC2 | All bonding curve math uses BigInt (no Number for intermediates) | `curve-math.ts` all BigInt | ENFORCED | LOGIC-01, LOGIC-02 |
| INV-OC3 | Sell tax is ceil-rounded (protocol-favored) | `curve-math.ts:202-204` | ENFORCED | LOGIC-02 |
| INV-OC4 | No sensitive data in localStorage | Only slippage/volume prefs | ENFORCED | FE-01 |
| INV-OC5 | All SQL queries use parameterized ORM | Drizzle ORM everywhere | ENFORCED | DATA-01, INJ-03 |
| INV-OC6 | Cargo.lock is committed (Rust supply chain pinned) | Git-tracked | ENFORCED | DEP-01 |
| INV-OC7 | CSP restricts script sources to 'self' | `next.config.ts:9` | PARTIALLY ENFORCED (`unsafe-inline` weakens) | WEB-02 |
| INV-OC8 | DATABASE_URL must be set (throws on missing) | `app/db/connection.ts:41-46` | ENFORCED | INFRA-03 |
| INV-OC9 | package-lock.json pins all JS dependency versions | GITIGNORED at `.gitignore:9` | **NOT ENFORCED** | DEP-01 |
| INV-OC10 | Webhook endpoint authenticates incoming requests | Optional auth (fail-open) | **NOT ENFORCED** | API-04, SEC-02, WEB-02, INFRA-03 |

---

## Critical Assumptions

| ID | Assumption | Validation Status | Source Agents |
|----|-----------|------------------|---------------|
| A-OC1 | HELIUS_WEBHOOK_SECRET is set in production Railway env | **UNVALIDATED** (no startup check) | API-04, WEB-02, INFRA-03, INFRA-05 |
| A-OC2 | NEXT_PUBLIC_RPC_URL will be changed for mainnet (not contain API key) | **NOT ENFORCED** (falls back to devnet) | FE-01, CHAIN-02, INFRA-03 |
| A-OC3 | Pool reserves will stay within Number.MAX_SAFE_INTEGER | **ALREADY VIOLATED** at current pool sizes | LOGIC-01, LOGIC-02 |
| A-OC4 | npm install scripts from dependencies are safe | **UNVALIDATED** (no --ignore-scripts) | DEP-01 |
| A-OC5 | Railway runs single Next.js process (SSE in-memory state) | **UNVALIDATED** (no runtime check) | INFRA-03, ERR-02 |
| A-OC6 | Helius free-tier API key has no financial risk if exposed | **PARTIALLY INVALID** (webhook management access confirmed) | SEC-01, SEC-02, INFRA-05 |
| A-OC7 | Railway Postgres enforces TLS by default | **UNVALIDATED** (no sslmode=require in app code) | DATA-01, INFRA-03 |
| A-OC8 | Curve constants in client-side code stay in sync with on-chain | Currently validated (manual verification) | LOGIC-01, LOGIC-02 |
| A-OC9 | Staking rewards in lamports never exceed 2^53 | Comment claims 5e17 < 9e15 (**MATH IS WRONG** but practically safe) | LOGIC-02 |
| A-OC10 | Programs are non-upgradeable at mainnet | Not yet enforced (devnet is upgradeable) | SOS ARCHITECTURE |

---

## Key Mechanisms

### 1. Webhook → Database → SSE Pipeline

**Purpose:** Ingest on-chain swap events from Helius webhooks, aggregate into OHLCV candles, broadcast to connected browsers.

**Flow:**
1. Helius POSTs transaction data to `/api/webhooks/helius`
2. Auth check: `if (webhookSecret) { compare(header, secret) }` — **OPTIONAL**
3. Events parsed and written to PostgreSQL via Drizzle ORM
4. Candle aggregator upserts OHLCV across 6 time resolutions
5. SSE manager broadcasts to all connected `EventSource` clients

**Security considerations:**
- Auth is fail-open: if `HELIUS_WEBHOOK_SECRET` env var is unset, anyone can POST
- String comparison is not timing-safe (`!==` not `crypto.timingSafeEqual`)
- No body size limit on webhook POST
- No replay protection (no timestamp validation)
- SSE has no auth, no subscriber cap, no rate limit
- Webhook URL is hardcoded in source: `dr-fraudsworth-production.up.railway.app/api/webhooks/helius`

### 2. AMM Quote Engine

**Purpose:** Client-side replica of on-chain constant-product AMM math for swap previews.

**Key files:** `app/lib/swap/quote-engine.ts`, `app/lib/swap/route-engine.ts`, `app/lib/swap/split-router.ts`

**Security considerations:**
- Uses JavaScript `number` type — intermediates already exceed `Number.MAX_SAFE_INTEGER` at current pool sizes (290M tokens * 2.5 SOL swap = 7.25e23)
- Drives `minimumOutput` computation — imprecise quotes lead to wider-than-intended slippage windows
- On-chain slippage check is the safety net, but users accept worse rates unknowingly
- Bonding curve math (`curve-math.ts`) correctly uses BigInt — inconsistency in approach

### 3. Crank Runner

**Purpose:** 24/7 bot on Railway managing epoch transitions, VRF lifecycle, Carnage execution, vault top-ups.

**Key files:** `scripts/crank/crank-runner.ts`, `scripts/crank/crank-provider.ts`

**Security considerations:**
- No spending limit per operation or per epoch
- No kill switch or emergency shutdown mechanism
- No alerting on failures (only Railway stdout logs)
- Infinite retry without backoff on transient errors
- Vault top-up has no upper bound (drain amplifier if compromised)
- Wallet balance logged to stdout (information disclosure via Railway logs)
- CLUSTER_URL defaults to localhost if env var unset

### 4. Transaction Construction (User Swaps)

**Purpose:** Build, sign, and submit swap transactions from the frontend.

**Key files:** `app/hooks/useSwap.ts`, `app/lib/swap/swap-builders.ts`, `app/hooks/useProtocolWallet.ts`

**Security considerations:**
- Sign-then-send pattern (bypasses wallet simulation) — necessary for devnet but mainnet risk
- `skipPreflight: true` on bonding curve TXs — unnecessary for legacy TXs
- Default 5% slippage enables sandwich attacks on thin liquidity
- No MEV-protected RPC (standard Helius, no Jito bundles)
- Float-to-int conversion: `Math.floor(parseFloat("0.1") * 1e9)` = 99999999 (1 lamport short)
- No compute budget on bonding curve TXs (risk of compute exhaustion failure)

### 5. Graduation Workflow

**Purpose:** Irreversible transition from bonding curves to AMM trading.

**Key files:** `scripts/graduation/graduate.ts`

**Security considerations:**
- Step 2 (prepare_transition) is IRREVERSIBLE — commits to graduation before pools exist
- Env override (`SOL_POOL_SEED_SOL_OVERRIDE`) lacks bounds validation
- State file (`graduation-state.json`) has no integrity protection (no HMAC)
- SOS audit found: bonding curve `prepare_transition` accepts ANY SIGNER (CRITICAL)

---

## API Surface

### Public Endpoints (No Authentication)

| Method | Path | Rate Limited | Input Validation | Risk |
|--------|------|-------------|------------------|------|
| GET | `/api/health` | No | N/A | Info disclosure (dependency topology) |
| GET | `/api/candles` | No | Pool pubkey, resolution (parameterized SQL) | Resource consumption |
| GET | `/api/sol-price` | No | N/A (60s cache) | Minimal |
| GET | `/api/carnage-events` | No | Query params (parameterized SQL) | Resource consumption |
| GET | `/api/sse/candles` | No | N/A (long-lived stream) | **Memory exhaustion (no subscriber cap)** |
| POST | `/api/webhooks/helius` | No | **Auth OPTIONAL** | **Data poisoning → chart manipulation** |

---

## Secret Management

### Secrets Inventory

| Secret | Type | Storage | Rotation | Exposure Risk |
|--------|------|---------|----------|---------------|
| Crank wallet keypair | Solana keypair | Railway env var (WALLET_KEYPAIR) | None documented | Railway dashboard access, crank startup logs |
| Helius API key | API key | **Hardcoded in source** (4 locations) | None | Client JS bundle, git history, forever |
| Helius webhook secret | Shared secret | Railway env var | None | Optional — may not be set |
| DATABASE_URL | Connection string | Railway env var | Auto-rotated by Railway | No TLS enforcement in app |
| Sentry DSN | Public key | NEXT_PUBLIC_ env var | N/A (public by design) | Client bundle (acceptable) |
| Admin keypairs | Solana keypairs | `keypairs/` directory (some committed) | None | Git history |

---

## On-Chain / Off-Chain Interface (SOS Cross-Reference)

### SOS Assumptions About Off-Chain Behavior

| SOS Assumption | Off-Chain Reality | Risk |
|----------------|-------------------|------|
| A-1: BC authority signer is deployer | **ANY signer accepted on-chain** — off-chain graduation script uses admin keypair, but attacker can call directly | CRITICAL (off-chain cannot compensate) |
| A-2: Init instructions called before attackers | Off-chain `initialize.ts` runs init, but no on-chain authority check | HIGH (deployment ordering is the only protection) |
| A-7: Programs non-upgradeable at mainnet | Off-chain has no enforcement — devnet is upgradeable | MEDIUM (mainnet checklist item) |
| A-8: Conversion vault whitelisted before authority burn | Off-chain `initialize.ts` must whitelist before burn — not verified programmatically | MEDIUM (operational) |
| A-10: taxes_confirmed unchecked by Tax | Off-chain uses stale epoch data for quotes during VRF window — intentional design | LOW (accepted) |

### Cross-Boundary Attack Surfaces

1. **Off-chain quote → on-chain slippage**: Quote-engine Number precision loss makes `minimumOutput` lower than intended → MEV extraction in the gap
2. **Off-chain webhook → on-chain perception**: Fake webhook events → false chart data → user makes bad trading decisions based on manipulated display
3. **Off-chain crank → on-chain state**: Crank signs admin transactions — if crank wallet compromised, attacker controls epoch transitions, carnage execution
4. **Off-chain devnet fallback → on-chain network mismatch**: Missing NEXT_PUBLIC_RPC_URL → frontend silently uses devnet RPC → mainnet transactions sent to wrong network

---

## High-Complexity Areas

### Area 1: Webhook → SSE Data Pipeline
**Identified by:** API-04, SEC-02, WEB-02, CHAIN-04, DATA-01, ERR-01, ERR-02, INFRA-03, INFRA-05 (9 agents)

**Why complex:** Single unauthenticated entry point feeds data through database to real-time broadcast. No validation of transaction existence, no replay protection, no rate limiting, no subscriber cap. Amplification factor: 1 POST → 6 candle upserts → N subscriber broadcasts.

### Area 2: AMM Quote Engine Precision
**Identified by:** LOGIC-01, LOGIC-02, CHAIN-06, BOT-02 (4 agents)

**Why complex:** JavaScript `number` arithmetic already exceeds safe integer range at current pool sizes. Drives minimumOutput (slippage protection) sent to on-chain programs. Inconsistency with bonding curve math (which correctly uses BigInt).

### Area 3: Crank Runner Safety
**Identified by:** BOT-01, BOT-02, ERR-01, INFRA-03, INFRA-05 (5 agents)

**Why complex:** 24/7 automated transaction signer with no spending limits, no kill switch, no alerting. Vault top-up is unbounded. Infinite retry on errors. Single point of failure for epoch management.

### Area 4: Supply Chain (npm)
**Identified by:** DEP-01, INFRA-03 (2 agents, but foundational)

**Why complex:** `package-lock.json` is gitignored. Every build resolves deps fresh from npm registry. No CI/CD pipeline, no automated scanning. Railway deploy uses `npm install` not `npm ci`. 11 packages with install scripts run without `--ignore-scripts`.

---

## Cross-Cutting Concerns

### Theme 1: Fail-Open Authentication (10 agents flagged)
The webhook auth pattern `if (secret) { check(header, secret) }` means authentication is disabled when the env var is unset. This is the most-flagged cross-cutting concern, identified by SEC-01, SEC-02, CHAIN-04, API-04, WEB-02, DATA-01, ERR-01, ERR-02, INFRA-03, INFRA-05.

### Theme 2: Helius API Key Exposure (10 agents flagged)
Key `[REDACTED-DEVNET-KEY]...` is hardcoded in `shared/constants.ts:474`, `shared/programs.ts:22`, and 2 script files. Bundled into client JS. Permanently in git history. Grants RPC access AND webhook management API access.

### Theme 3: No MEV Protection (4 agents flagged)
User swap transactions use standard Helius RPC with no Jito bundles or MEV-protected submission. Combined with default 5% slippage, this creates a significant sandwich attack surface.

### Theme 4: No Rate Limiting Anywhere (4 agents flagged)
Zero rate limiting on any of the 6 API endpoints. SSE connections are unbounded. Webhook accepts unlimited POST requests. Health endpoint is publicly accessible.

### Theme 5: Devnet-to-Mainnet Migration Gaps (3 agents flagged)
Multiple hardcoded devnet values, NEXT_PUBLIC_RPC_URL falls back to devnet, CLUSTER_URL defaults to localhost. Missing HSTS. Mainnet readiness checklist exists but items are NOT_STARTED.

---

## Risk Heat Map

| Rank | Risk | Severity | Frequency (agents) | Components |
|------|------|----------|---------------------|------------|
| 1 | Webhook auth fail-open → data poisoning | HIGH | 10 | API, DB, SSE |
| 2 | Helius API key hardcoded in client bundle | HIGH | 10 | Frontend, RPC, Webhooks |
| 3 | npm lockfile gitignored (supply chain) | HIGH | 2 | All JS components |
| 4 | Crank no spend limit / kill switch | HIGH | 5 | Crank, on-chain state |
| 5 | Quote-engine Number overflow | HIGH | 4 | Frontend quotes, slippage |
| 6 | No MEV protection for user swaps | HIGH | 4 | Frontend TX submission |
| 7 | SSE unbounded connections (DoS) | MEDIUM | 4 | API, Railway |
| 8 | Default 5% slippage | MEDIUM | 4 | Frontend, MEV surface |
| 9 | skipPreflight on bonding curve | MEDIUM | 4 | Frontend TX submission |
| 10 | Devnet fallback in production | MEDIUM | 3 | Frontend, crank |
| 11 | CSP unsafe-inline | MEDIUM | 2 | Frontend XSS surface |
| 12 | Missing HSTS | MEDIUM | 2 | Transport security |
| 13 | DB connection no TLS enforcement | MEDIUM | 2 | Data in transit |
| 14 | Float-to-int precision loss | MEDIUM | 2 | User input amounts |
| 15 | No server-side error reporting | MEDIUM | 2 | Incident detection |

---

## Novel Attack Surface Observations

1. **Webhook → SSE amplification attack**: Single unauthenticated webhook POST with N fake transactions triggers N*6 candle upserts and N*6*M SSE broadcasts (M = subscriber count). Combined with no subscriber cap, this is a novel amplification vector specific to this architecture.

2. **Quote-engine divergence as MEV enabler**: JavaScript `number` vs Rust `u64` precision mismatch means off-chain `minimumOutput` is slightly different from the on-chain optimal. The gap between the off-chain-computed minimum and the actual optimal execution is extractable by MEV bots.

3. **Devnet-to-mainnet silent network switch**: Missing `NEXT_PUBLIC_RPC_URL` env var → frontend silently uses devnet RPC → mainnet-signed transactions could be sent to devnet (where they fail) or devnet state displayed as mainnet (user confusion). This is not just a display issue — `useProtocolWallet.ts` uses the connection for `sendRawTransaction`.

4. **IDL supply chain attack**: `app/scripts/sync-idl.mjs` copies IDL JSON from `target/idl/` on every build. If the Rust build toolchain were compromised, tampered IDL files would propagate to the frontend, causing incorrect account deserialization and potentially malicious transaction construction.

5. **Graduation MEV bundle (cross-boundary)**: SOS found bonding curve accepts ANY signer for `prepare_transition` and `withdraw_graduated_sol`. An attacker could bundle these atomically when curves reach Filled, stealing ~2000 SOL. The off-chain graduation script provides no protection against this.

6. **CustomEvent balance sync as RPC DoS trigger**: `useTokenBalances.ts` dispatches `CustomEvent("token-balances-refresh")` on window. Any in-page script (XSS, extension) could rapidly dispatch this event, causing all hooks to fire simultaneous RPC requests, exhausting the Helius rate limit.

---

**This document synthesizes findings from 24 parallel off-chain context audits + SOS on-chain cross-reference.**
**Use this as the foundation for attack strategy generation in Phase 3.**
