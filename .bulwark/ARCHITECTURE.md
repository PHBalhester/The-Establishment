# Unified Off-Chain Architectural Understanding

**Project:** Dr. Fraudsworth's Finance Factory
**Generated:** 2026-03-21
**Source:** Dinh's Bulwark Audit #2 — Phase 2 Synthesis (35 context auditors + 5 verification agents)
**SOS Cross-Reference:** `.audit/ARCHITECTURE.md` (SOS-002, 2026-03-07)
**Stacked Audit:** #2 (previous: #1 @ 173de12, 71 confirmed, 23 potential)

---

## Executive Summary

Dr. Fraudsworth's off-chain stack is a Next.js 16 DeFi frontend deployed on Railway, backed by a server-side WebSocket data pipeline (Helius → ws-subscriber → protocolStore → SSE → browser), a PostgreSQL candle/event database, and a standalone crank process managing VRF-driven epoch transitions and Carnage buyback-and-burn events. The architecture underwent a major DBS refactor (7 phases) since Audit #1, moving from per-browser RPC polling to server-side WebSocket subscriptions with SSE broadcast — introducing new components (`ws-subscriber`, `credit-counter`, `protocol-config`) and modifying the SSE/connection layer.

The protocol is permissionless — no user accounts, sessions, or traditional auth. Authentication reduces to: (1) Helius webhook shared-secret (fail-closed, timingSafeEqual), (2) Solana wallet signing via wallet-adapter (sign-then-send pattern), and (3) crank wallet keypair on Railway. The security model relies heavily on on-chain enforcement (minimumOutput, PDA constraints, 50% output floor) as the ultimate safety net, with off-chain code treated as untrusted display/submission layer.

Key risk areas identified across all 35 auditors: **private key/secret exposure** (CRITICAL items in git history and working tree), **MEV extraction surface** (5% default slippage + no Jito/private mempool), **data pipeline integrity** (CarnageSolVault balance desync, stale data propagation, replay-vulnerable enhanced webhooks), **rate limiting gaps** (RPC batch amplification, unprotected DB endpoints, bypassable body size limits), and **supply chain risk** (crank builds with `npm install`, 30 unpatched CVEs, unclaimed npm scope).

---

## System Overview

### Core Components

| Component | Type | Purpose | Location | Security Role |
|-----------|------|---------|----------|---------------|
| Next.js Frontend | Frontend + API | DeFi trading UI, swap/staking/bonding curve | `app/` | Client-side TX construction, RPC proxy |
| WS Subscriber | Server Pipeline | Server-side Helius WebSocket → protocolStore | `app/lib/ws-subscriber.ts` | Real-time on-chain state ingestion |
| Protocol Store | In-Memory Cache | Centralized protocol state (Map) | `app/lib/protocol-store.ts` | Single source of truth for SSE |
| SSE Manager | Pub/Sub | Broadcast to browser EventSource clients | `app/lib/sse-manager.ts` | Fan-out data delivery |
| SSE Connection Tracker | Rate Limiting | Per-IP + global SSE cap | `app/lib/sse-connections.ts` | DoS mitigation (H008 fix) |
| RPC Proxy | API Gateway | Method-allowlisted JSON-RPC relay to Helius | `app/app/api/rpc/route.ts` | API key protection (H002 fix) |
| Webhook Handler | Data Ingestion | Helius webhook → DB + protocolStore | `app/app/api/webhooks/helius/route.ts` | Authenticated external data gate |
| Crank Runner | Bot | Epoch transitions, VRF, Carnage, vault top-up | `scripts/crank/crank-runner.ts` | Protocol liveness, signing authority |
| Deploy Scripts | Admin Tools | Program deploy, initialize, authority transfer | `scripts/deploy/` | Keypair handling, shell commands |
| PostgreSQL (Drizzle) | Database | Swap events, candles, epoch/carnage events | `app/db/` | Persistent event history |

### Technology Stack

| Layer | Technology | Version | Security Notes |
|-------|-----------|---------|----------------|
| Runtime | Node.js 22+ | LTS | No process-level error handlers |
| Framework | Next.js | 16.1.6 | 5 moderate CVEs (CSRF, request smuggling) |
| Database | PostgreSQL + Drizzle ORM | postgres.js driver | Parameterized queries throughout |
| Blockchain | @solana/web3.js | 1.98.4 | `bigint-buffer` CVE in dep tree |
| Anchor Client | @coral-xyz/anchor | 0.32 | camelCase IDL conversion |
| Wallet | @solana/wallet-adapter-react | Latest | Sign-then-send pattern |
| Build | Turbopack (Next.js 16) | Integrated | globalThis singleton pattern required |
| Hosting | Railway (Nixpacks) | Auto-detect | Single process, no horizontal scaling |

### Data Flow Diagram

```
Browser Users ──→ Next.js Frontend (app/)
       │          - useSwap, useStaking hooks
       │          - BuyForm/SellForm (bonding curve)
       │          - SwapForm/SwapStation (AMM)
       │
       │ SSE ◄── /api/sse/protocol ◄── sseManager ◄── protocolStore
       │              ▲                                      ▲
       │              │ broadcast                             │ setAccountState
       │              │                                      │
  Helius ── POST ──→ /api/webhooks/helius ──→ Anchor decode ──┘
         (fail-closed auth)        │                         ▲
                                   │ DB insert               │ batchSeed + polls
                                   ▼                         │
                              PostgreSQL              ws-subscriber ──WS──→ Helius RPC
                              (candles, events)         │ slot sub, supply poll,
                                                        │ staker gPA poll (30s)
       │
       │ POST ──→ /api/rpc ──→ Helius RPC ──→ Solana
       │ (method allowlist, rate limit)
       │
  Crank Runner (Railway) ──── RPC ────→ Solana
  - epoch advance, VRF 3-TX flow
  - carnage execute, vault top-up
  - circuit breaker, spending cap
```

---

## Trust Model

### Actors

| Actor | Trust Level | Capabilities | Entry Points |
|-------|-------------|--------------|--------------|
| Browser User | UNTRUSTED | Public endpoints, wallet signing, SSE streaming | All GET routes, /api/rpc POST, SSE |
| Helius Webhook | SEMI-TRUSTED | Authenticated data delivery | POST /api/webhooks/helius |
| Helius RPC | TRUSTED | On-chain state, TX submission | Server-side Connection, ws-subscriber |
| Crank Runner | SYSTEM | Epoch transitions, VRF, Carnage, vault SOL | Direct RPC, funded wallet |
| Deploy Admin | PRIVILEGED | Program deploy, init, authority transfer | Local scripts, keypair files |
| Railway Platform | INFRASTRUCTURE | Env vars, networking, container lifecycle | Build/deploy pipeline |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      UNTRUSTED ZONE                          │
│  - Browser client input (amounts, slippage, token pair)      │
│  - SSE connections (unauthenticated)                         │
│  - RPC proxy requests (method-allowlisted)                   │
│  - Candle/carnage-events/health/sol-price GET requests       │
├─────────────────────────────────────────────────────────────┤
│                      VALIDATION LAYER                        │
│  - Webhook auth (fail-closed + timingSafeEqual)              │
│  - RPC method allowlist (17 methods)                         │
│  - Rate limiting (3 of 8 routes: webhook/rpc/sol-price)     │
│  - SSE connection caps (10/IP, 5000 global)                  │
│  - Input validation (parseFloat, range checks in hooks)      │
│  - CSP (script-src self + unsafe-inline, frame-ancestors none)│
├─────────────────────────────────────────────────────────────┤
│                      TRUSTED ZONE                            │
│  - On-chain program enforcement (slippage, PDA, caps)        │
│  - Drizzle ORM parameterized queries                         │
│  - Server-side RPC proxy (API key hidden)                    │
│  - Wallet adapter sign-then-send flow                        │
│  - Deterministic PDA derivation (no RPC dependency)          │
│  - Quote engine BigInt arithmetic                            │
├─────────────────────────────────────────────────────────────┤
│                      SENSITIVE ZONE                           │
│  - Crank wallet keypair (WALLET_KEYPAIR env var)             │
│  - HELIUS_WEBHOOK_SECRET (env var)                           │
│  - DATABASE_URL (env var, TLS in production)                 │
│  - HELIUS_RPC_URL (server-only env var)                      │
│  - Admin keypairs (keypairs/ directory, mainnet gitignored)  │
│  - .env.mainnet (working tree, gitignored)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Invariants (Merged from 35 Auditors)

| ID | Invariant | Status | Enforced At |
|----|-----------|--------|-------------|
| INV-1 | Browser code NEVER accesses private keys | **ENFORCED** | `useProtocolWallet.ts` — wallet adapter delegation |
| INV-2 | Helius API key is server-side only in production | **ENFORCED** | `connection.ts:35-36` — browser returns `/api/rpc` |
| INV-3 | Webhook auth is fail-closed in production | **ENFORCED** | `webhooks/helius/route.ts:273-284` |
| INV-4 | All SQL uses Drizzle ORM parameterized queries | **ENFORCED** | All `app/db/` files |
| INV-5 | On-chain enforces minimumOutput on every swap | **ENFORCED** | Tax Program (on-chain) |
| INV-6 | RPC proxy only forwards allowlisted methods | **ENFORCED** | `rpc/route.ts:31-59` |
| INV-7 | SSE connections capped 10/IP, 5000 global | **ENFORCED** | `sse-connections.ts:49-56` |
| INV-8 | All financial quote math uses BigInt | **ENFORCED** | `quote-engine.ts` — BPS_DENOMINATOR=10_000n |
| INV-9 | Transfer hook remaining_accounts = exactly 4 per mint | **ENFORCED** | `hook-resolver.ts:72-77` |
| INV-10 | Slippage BPS bounded [0, 10000] | **ENFORCED** | `SettingsProvider.tsx:196-198` |
| INV-11 | Circuit breaker halts crank after 5 errors | **ENFORCED** | `crank-runner.ts:535` |
| INV-12 | Crank hourly spending cap 0.5 SOL | **ENFORCED** | `crank-runner.ts:141` |
| INV-13 | Swap events idempotent via TX signature PK | **ENFORCED** | `webhooks/helius/route.ts:680` |
| INV-14 | Protocol store dedup prevents identical broadcasts | **PARTIALLY** | `protocol-store.ts:58` — fragile (JSON key order) |
| INV-15 | Webhook body size capped 1MB | **PARTIALLY** | `route.ts:309-315` — Content-Length only, bypassable |
| INV-16 | Pre-computed PDA addresses match on-chain deployment | **NOT ENFORCED** | Relies on manual `generate-constants.ts` run |

---

## Critical Assumptions (Merged from 35 Auditors)

| ID | Assumption | Status | Risk if Violated |
|----|-----------|--------|------------------|
| ASM-1 | NEXT_PUBLIC_CLUSTER is correctly set on Railway | **UNVALIDATED** | Silent devnet fallback — all TXs target wrong addresses |
| ASM-2 | Railway sets NODE_ENV=production | **UNVALIDATED** | DB TLS disabled, webhook auth bypassed |
| ASM-3 | x-forwarded-for accurately reflects client IP | **UNVALIDATED** | All rate limits bypassable |
| ASM-4 | NEXT_PUBLIC_RPC_URL won't contain API key for mainnet | **CONTRADICTED** | .env.mainnet template instructs putting key there |
| ASM-5 | Single Railway process (no horizontal scaling) | **VALIDATED** | All in-memory state (rate limiter, SSE, protocolStore) breaks |
| ASM-6 | Helius delivers correct Solana data | **UNVALIDATED** | Entire frontend state corrupted if compromised |
| ASM-7 | Enhanced webhook nativeBalanceChange is absolute | **LIKELY INCORRECT** | CarnageSolVault balance desync |
| ASM-8 | Pool reserves from SSE are fresh for quoting | **PARTIALLY** | 5-60s staleness, minimumOutput is backstop |
| ASM-9 | PROFIT supply * 10^6 within Number.MAX_SAFE_INTEGER | **UNVALIDATED** | Staker stats overflow |
| ASM-10 | Git history will be purged for committed secrets | **NOT ENFORCED** | Private key in .mcp.json, API keys in .env.devnet |

---

## Critical Intersections (Cross-Focus Overlaps)

### 1. Secret Exposure × Supply Chain (SEC-01/02 × DEP-01 × INFRA-03)
**Flagged by:** SEC-01, SEC-02, DEP-01, INFRA-03, DATA-04
Private key in `.mcp.json`, API keys in `.env.devnet`, mainnet crank wallet key in `.env.mainnet` (working tree). Crank builds with `npm install` (not `npm ci`). 30 unpatched CVEs. The @dr-fraudsworth npm scope is unclaimed. A compromised dependency in the crank could steal the wallet keypair from WALLET_KEYPAIR env var.

### 2. MEV × Wallet × Slippage (CHAIN-05 × CHAIN-03 × LOGIC-01 × BOT-02)
**Flagged by:** CHAIN-05, CHAIN-03, CHAIN-01, BOT-02, LOGIC-01
Default 500 BPS (5%) slippage + no Jito/private mempool + sign-then-send bypassing wallet simulation preview + skipPreflight on multi-hop/BC TXs. Every swap is sandwichable with up to 5% extraction. The sign-then-send pattern also bypasses Phantom's own MEV protection features.

### 3. Data Pipeline × State Sync (CHAIN-04 × API-03 × API-04 × CHAIN-02)
**Flagged by:** CHAIN-04, API-03, API-04, CHAIN-02, ERR-01
CarnageSolVault uses `nativeBalanceChange` (delta) as absolute balance → desync. Polling fallback produces incompatible data shape. Enhanced webhooks lack replay protection. No SSE gap detection. BigInt tag collision risk. Protocol store dedup fragile.

### 4. Rate Limiting × Resource Exhaustion (ERR-03 × API-01 × AUTH-03)
**Flagged by:** ERR-03, API-01, AUTH-03, CHAIN-02, ERR-01
RPC proxy fetch has no timeout. 5 of 8 API routes lack rate limiting. RPC proxy batch amplification (single request → N Helius credits). gapFillCandles CPU amplification. Webhook body size limit bypassable via chunked encoding. x-forwarded-for spoofable.

### 5. Health Endpoint × Reconnaissance (flagged by 15+ auditors)
**Flagged by:** SEC-01, SEC-02, API-01, API-03, AUTH-01, AUTH-03, CHAIN-02, BOT-01, DATA-04, INFRA-03, INFRA-05, ERR-01, ERR-03, WEB-02, FE-01
H028 NOT_FIXED, now expanded: wsSubscriber internal state, credit counter per-method breakdown, dependency health. Zero authentication. Enables timing attacks, infrastructure fingerprinting, DoS window detection.

---

## End-to-End Data Flows

### Flow 1: User Swap (SOL → CRIME)
```
User enters amount → useSwap computeQuote (300ms debounce)
  → usePoolPrices (SSE-fed reserves) → quote-engine (BigInt)
  → minimumOutput = floor(output × (10000-slippageBps)/10000)
  → swap-builders.ts builds TX (accountsStrict + hook accounts)
  → useProtocolWallet.signTransaction (wallet popup)
  → connection.sendRawTransaction via /api/rpc → Helius → Solana
  → pollTransactionConfirmation (2s poll, 90s timeout)
  [TRUST CROSSING: off-chain quote → on-chain enforcement]
  [RISK: 5% default slippage, no MEV protection, stale reserves]
```

### Flow 2: Helius Webhook → SSE Broadcast
```
Helius POST → webhook auth (timingSafeEqual, fail-closed)
  → rate limit (120/min) → body size check (Content-Length only)
  → JSON parse → type discrimination
  [Raw TX path]: event-parser → Drizzle insert (onConflictDoNothing) → candle upsert
  [Enhanced path]: Anchor decode → protocolStore.setAccountState → dedup → SSE broadcast
  [TRUST CROSSING: authenticated webhook → in-memory store → unauthenticated SSE]
  [RISK: enhanced path has NO replay protection, dedup is fragile]
```

### Flow 3: Crank Epoch Transition
```
Main loop → read EpochState → wait for epoch boundary
  → TX1: Keypair.generate → sb.Randomness.create (finalized wait)
  → TX2: commit + trigger_epoch_transition (bundle)
  → TX3: reveal + consume_randomness + executeCarnageAtomic (v0 + ALT)
  → VRF recovery: stale reveal or timeout → fresh randomness → retry
  [TRUST CROSSING: crank wallet signs TXs with funded keypair]
  [RISK: no distributed lock, no external alerting, recovery skips atomic Carnage]
```

### Flow 4: Protocol State Pipeline (Server Boot)
```
instrumentation.ts register() → ws-subscriber.init()
  → batchSeed: getMultipleAccountsInfo + getTokenSupply×2 + getSlot + gPA
  → protocolStore populated → initialized=true
  → Start 4 concurrent polls: WS slot (5s throttle), supply (60s), staker gPA (30s), staleness (10s/15s)
  [TRUST CROSSING: Helius RPC responses trusted without cross-verification]
  [RISK: batchSeed failure leaves empty store, setInterval polls lack overlap guard]
```

---

## Risk Heat Map (Top Concerns by Priority)

### Tier 1 — CRITICAL (Immediate Action)
1. **Mainnet crank wallet key in working tree** (INFRA-03) — `.env.mainnet` contains full secret key
2. **Private key in .mcp.json in git history** (SEC-01) — Base58 Solana key, tracked since commit 53ca01b
3. **Crank builds with `npm install` not `npm ci`** (DEP-01) — Supply chain attack on funded signing wallet

### Tier 2 — HIGH (Pre-Mainnet Required)
4. **Default 500 BPS slippage + no MEV protection** (CHAIN-05/BOT-02) — H015 NOT_FIXED, every swap sandwichable
5. **RPC proxy no fetch timeout** (ERR-01/ERR-03) — Hanging upstream exhausts all worker threads
6. **30 known CVEs, no npm audit in CI** (DEP-01) — next@16.1.6 CSRF/smuggling
7. **RPC batch amplification** (CHAIN-02/API-01) — Single request burns N Helius credits
8. **NEXT_PUBLIC_RPC_URL mainnet API key exposure** (SEC-02/FE-01) — Template instructs baking key into bundle
9. **Enhanced webhooks no replay protection** (API-04) — Stale data injection into all SSE clients
10. **CarnageSolVault balance desync** (CHAIN-04) — nativeBalanceChange is delta, not absolute

### Tier 3 — MEDIUM
11. Health endpoint info disclosure (15+ auditors)
12. Candles/carnage-events/health lack rate limits
13. Webhook body size limit bypassable
14. IP spoofing bypasses rate limiter
15. skipPreflight on BC/multi-hop TXs
16. Cluster defaults to devnet when env var missing
17. No secret rotation mechanism
18. ws-subscriber poll overlap
19. gapFillCandles CPU amplification
20. Polling fallback incompatible data shape

---

## Novel Attack Surface Observations

1. **MCP configuration as secret exfiltration vector** (SEC-01): `.mcp.json` is read by AI tools. If any AI assistant logs contents, the private key is leaked through a non-obvious channel.

2. **Helius webhook CRUD via committed API key** (SEC-01/SEC-02): The devnet Helius key enables webhook management — register shadow webhooks for passive surveillance, or delete the production webhook to blind the data pipeline.

3. **RPC proxy as free transaction relay** (AUTH-03): `sendTransaction` in the allowlist means anyone can submit arbitrary Solana TXs through the project's Helius endpoint. Botnet could scale credit exhaustion.

4. **SSE as free oracle for MEV bots** (AUTH-01/API-03): Unauthenticated SSE provides pre-parsed protocol state faster than raw RPC polling — a structural advantage for automated trading.

5. **Candle gap-fill amplification** (ERR-03): `/api/candles?gapfill=true&resolution=1m` with a year range generates ~525K synthetic objects in memory.

6. **Webhook type confusion** (API-04): A payload straddling both raw TX and enhanced formats bypasses the stronger raw TX validation (replay protection).

7. **Cross-epoch tax rate sniping via SSE timing** (BOT-02): SSE broadcasts new tax rates milliseconds before UI renders them — automated clients can snipe favorable rates.

8. **VRF TOCTOU double-spend** (BOT-01): Racing crank duplicates both create randomness accounts (TX1), wasting SOL per epoch.

---

## On-Chain / Off-Chain Interface (SOS Cross-Reference)

From `.audit/ARCHITECTURE.md`:

| On-Chain Assumption | Off-Chain Reality | Gap |
|--------------------|--------------------|-----|
| minimumOutput enforced on all swaps | Off-chain computes from stale reserves + 5% default | Gap is UX, not security (on-chain backstop works) |
| Bonding curve authority = ANY signer (CRITICAL in SOS) | Off-chain BuyForm/SellForm construct TXs normally | Authority issue is on-chain, off-chain cannot mitigate |
| Transfer hook whitelist checked on every transfer | Hook accounts derived deterministically client-side | Correct — PDA derivation immune to spoofing |
| CPI swap_authority derived from Tax Program | Off-chain correctly uses Tax Program for derivation | Aligned |
| Epoch transitions are permissionless (bounty) | Crank calls trigger_epoch_transition with funded wallet | Crank wallet compromise ≠ protocol compromise (permissionless) |
| VRF reveal is public before consume | Off-chain crank bundles reveal+consume atomically | Correct pattern, but recovery path skips atomic Carnage |

---

## Stacked Audit Verification

### Previous Trust Zones (Audit #1) — Status

| Zone | Audit #1 Status | Audit #2 Verification |
|------|----------------|----------------------|
| Browser wallet isolation | SECURE | **INTACT** — sign-then-send still delegates signing |
| RPC proxy API key protection | FIXED (H002) | **INTACT** — but NEXT_PUBLIC_RPC_URL still set in .env templates |
| Webhook fail-closed auth | FIXED (H001) | **INTACT** — timingSafeEqual + fail-closed confirmed |
| SSE DoS protection | FIXED (H008) | **INTACT** — 10/IP, 5000 global caps |
| On-chain slippage enforcement | ENFORCED | **INTACT** — minimumOutput always set |

### Previous Attack Trees — Status

| Tree | Audit #1 Status | Audit #2 Delta Impact |
|------|----------------|----------------------|
| Tree 1: Fund Theft | BLOCKED | **VERIFY** — on-chain programs modified |
| Tree 2: Protocol Brick | BLOCKED | **VERIFY** — on-chain programs modified |
| Tree 3: Data Pipeline Takeover | BLOCKED | **RECHECK** — webhook + SSE heavily modified |
| Tree 4: Crank Wallet Drain | LARGELY BLOCKED | **VERIFY** — crank not in delta |
| Tree 5: Service Disruption | BLOCKED | **RECHECK** — SSE + connection + ws-subscriber modified |
| Tree 6: MEV Extraction | MITIGATED | **NOT FIXED** — H015 still unfixed, no Jito |

---

**This document synthesizes findings from 35 parallel off-chain context audits + 5 verification agents.**
**Use this as the foundation for attack strategy generation (Phase 3).**
