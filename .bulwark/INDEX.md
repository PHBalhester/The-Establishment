# Dinh's Bulwark: Off-Chain Source File Index

**Generated:** 2026-03-21
**Audit Phase:** Phase 1 (Completion) to Phase 2 (Differential)
**Baseline:** v1.3 shipping candidates + NEW files for DBS (Dinh's Bulwark Streaming)

---

## Summary

### File Inventory
- **Total files:** 245 off-chain source files (TS/TSX/JS/JSX)
- **App layer:** 168 files (app/ + shared/)
- **Scripts & tests:** 77 files (scripts/, tests/)

### Lines of Code
- **App+Shared:** ~26k LOC (API routes, hooks, components, UI, shared constants)
- **Top 10 files by LOC:**
  1. `app/hooks/useSwap.ts` (954 LOC) — Swap transaction building + state
  2. `app/app/api/webhooks/helius/route.ts` (851 LOC) — Event parsing + account changes
  3. `app/hooks/useStaking.ts` (715 LOC) — Staking UI orchestration
  4. `app/hooks/useRoutes.ts` (626 LOC) — Route discovery + price quotes
  5. `app/lib/swap/swap-builders.ts` (507 LOC) — Multi-hop swap builders
  6. `app/lib/audio-manager.ts` (506 LOC) — Audio state machine
  7. `app/lib/ws-subscriber.ts` (495 LOC) — NEW: WS data pipeline
  8. `app/components/swap/SwapForm.tsx` (467 LOC) — Swap UI form
  9. `app/lib/swap/route-engine.ts` (445 LOC) — Route optimization
  10. `app/lib/swap/multi-hop-builder.ts` (416 LOC) — Multi-hop assembly

### Delta Status
- **NEW:** 10 files (6 for DBS: ws-subscriber, credit-counter, protocol-store, sse-manager, sse-connections, ClusterConfigProvider; 4 load-test/CI)
- **MODIFIED:** 41 files (API routes, hooks, critical libraries for DBS integration)
- **UNCHANGED:** 194 files (Components, utilities, shared logic)

---

## New Files: DBS Infrastructure (Phase 3 Foundation)

The following 10 files are NEW and form the backbone of Dinh's Bulwark Streaming:

| Path | Language | Lines | Purpose | Focus Areas | Risk |
|------|----------|-------|---------|-------------|------|
| `app/lib/ws-subscriber.ts` | TS | 495 | Server-side WS pipeline (slot/supply/stakers) | CHAIN-01, CHAIN-02, DATA-01, ERR-01 | 5 |
| `app/lib/protocol-store.ts` | TS | 126 | In-memory cache for protocol PDAs | DATA-01, DATA-04, LOGIC-01 | 3 |
| `app/lib/sse-manager.ts` | TS | 93 | Pub/sub for SSE broadcasts | API-01, INFRA-03 | 2 |
| `app/lib/sse-connections.ts` | TS | 119 | Connection rate-limiting (H008) | SEC-01, INFRA-03 | 1 |
| `app/lib/credit-counter.ts` | TS | 69 | RPC call tracking for Helius credits | DATA-04, ERR-02 | 1 |
| `app/lib/bigint-json.ts` | TS | 80 | BigInt serialization for SSE | LOGIC-02, DATA-01 | 1 |
| `app/lib/__tests__/bigint-json.test.ts` | TS | 68 | Unit tests for BigInt JSON | — | 0 |
| `app/providers/ClusterConfigProvider.tsx` | TSX | 124 | Cluster-aware config context | FE-01, LOGIC-01 | 2 |
| `scripts/load-test/run.ts` | TS | 42 | k6 load-test orchestrator | INFRA-03 | 1 |
| `scripts/load-test/k6-sse.js` | JS | 68 | k6 SSE load-test scenario | INFRA-03 | 1 |

### DBS Architecture: Data Flow
```
[Helius] ─onSlotChange──▸ [ws-subscriber] ─batch-seed──▸ [protocol-store]
  (WS)                    (gPA, HTTP polls)              (in-memory cache)
                                                              ▲
                                                              │
                                                       [broadcast SSE]
                                                              │
                                          [useProtocolState] ◀─
                                             (browser)
```

**Key patterns in NEW files:**
- **Singleton globalThis pattern:** ws-subscriber, protocol-store, sse-manager, credit-counter all use globalThis to survive Next.js HMR
- **Server-side only:** All ws-* and protocol-* files are Node.js-only, guarded with runtime checks
- **Feature-flagged:** WS_SUBSCRIBER_ENABLED env var gates initialization
- **Instrumentation hook:** initialization.ts calls ws-subscriber.init() on server boot

---

## Critical Path: Risk Markers ≥ 3

These 8 files handle sensitive operations (RPC signing, user input, database access, WebSocket operations) and require deep auditing:

### High-Risk API Routes & Hooks

| Path | Language | Lines | Purpose | Focus Areas | Risk Markers |
|------|----------|-------|---------|-------------|------------|
| `app/app/api/webhooks/helius/route.ts` | TS | 851 | Webhook signature verification + event parsing | SEC-01, SEC-02, CHAIN-02, CHAIN-03, API-01, INJ-01, DATA-01, ERR-03 | **7** |
| `app/hooks/useSwap.ts` | TS | 954 | Swap TX building + signing + RPC calls | SEC-01, SEC-02, CHAIN-04, CHAIN-05, CHAIN-06, API-01, INJ-03, ERR-02, ERR-03 | **7** |
| `app/hooks/useStaking.ts` | TS | 715 | Staking TX building + signing + cooldown logic | SEC-01, CHAIN-04, CHAIN-05, API-01, INJ-03, DATA-01, ERR-02 | **6** |
| `app/hooks/useRoutes.ts` | TS | 626 | Route discovery + quote engine calls | CHAIN-01, CHAIN-02, API-01, API-03, API-04, DATA-01, LOGIC-01 | **6** |
| `app/lib/swap/route-engine.ts` | TS | 445 | Multi-leg route optimization logic | CHAIN-03, LOGIC-01, LOGIC-02, DATA-01, DATA-04, ERR-02 | **5** |
| `app/lib/swap/swap-builders.ts` | TS | 507 | Instruction assembly + ALT handling | CHAIN-04, CHAIN-05, CHAIN-06, LOGIC-01, INJ-03, API-04 | **5** |
| `app/hooks/useCurveState.ts` | TS | 241 | Bonding curve state + math | CHAIN-01, CHAIN-02, DATA-01, LOGIC-01, ERR-01 | **4** |
| `app/hooks/useEpochState.ts` | TS | 215 | Epoch state + timeout recovery | CHAIN-01, CHAIN-02, DATA-01, ERR-01, ERR-02 | **4** |

### Detailed Risk Analysis: Top 3 Files

#### 1. `app/app/api/webhooks/helius/route.ts` (851 LOC) — **Risk 7**

**Sensitive operations (each tagged):**
1. **Signature verification** (SEC-01) — `timingSafeEqual()` on HELIUS_WEBHOOK_SECRET
2. **User input parsing** (INJ-01) — Raw Helius payload validation (array detection, event extraction)
3. **Database writes** (DATA-01) — Three tables: swap_events (parsed from logs), epoch_events, carnage_events
4. **RPC calls** (SEC-02, CHAIN-02) — Anchor account decoding for EpochState, PoolState, CurveState
5. **WebSocket broadcast** (API-01) — SSE manager publish to connected clients
6. **Account change propagation** (CHAIN-03) — Helius Enhanced Webhook updates protocol-store in-memory
7. **Error handling** (ERR-03) — Malformed JSON, signature mismatch, RPC failures must not crash

**Critical safeguards:**
- FAIL-CLOSED: In production, missing HELIUS_WEBHOOK_SECRET returns 500 (prevents accidental open webhook)
- Idempotency: Swap events keyed on TX signature; epoch/carnage on epoch_number
- Rate-limiting: Per-IP webhook rate limit checked before processing
- Dedup: Protocol store includes last-serialized check to avoid redundant broadcasts

**Audit gaps (to resolve):**
- Helius signature verification uses `timingSafeEqual()` — confirm algorithm matches Helius HMAC-SHA256
- Event parser must handle all Anchor event variants (ParsedSwap, ParsedEpoch, ParsedCarnage)
- Candle aggregation must be idempotent for replay resilience

---

#### 2. `app/hooks/useSwap.ts` (954 LOC) — **Risk 7**

**Sensitive operations:**
1. **TX building** (CHAIN-04) — Route assembly, account list construction, ALT resolution
2. **Signing** (SEC-01, SEC-02) — Wallet adapter signTransaction() call
3. **RPC submission** (CHAIN-05, API-01) — sendRawTransaction() with custom preflight logic
4. **User input** (INJ-03) — Slippage, amount parsing, route selection
5. **Error recovery** (ERR-02, ERR-03) — Swap failures, timeout detection, retry logic
6. **Token metadata** (CHAIN-06) — Token balance checks, decimals handling
7. **Multi-hop logic** (LOGIC-01) — Intermediate token routing, fee calculations

**Critical safeguards:**
- Slippage floor: 50% hard cap (ref. memory: Carnage bug fix)
- ALT versioning: Use v0 TXs with cached ALT for sell path (>1232 bytes)
- skipPreflight: Required for devnet simulation (v0 TX blockhash issue)
- Snapshot wait: 2s delay after v0 TX before reading state (RPC propagation)

**Audit gaps:**
- Multi-hop path selection must prevent cycles
- Token decimals must match on-chain metadata
- Slippage calculation must account for multi-leg rounding

---

#### 3. `app/app/api/webhooks/helius/route.ts` (cont.) — Event Parser Security

The webhook route imports event-parser.ts which extracts Anchor events from logMessages. Ensure:
- IDL account type names are camelCase (Anchor 0.32 convertIdlToCamelCase convention)
- Event discriminators match deployed programs
- Anchor event parsing handles custom types (e.g., ParsedTaxedSwap vs ParsedUntaxedSwap)

---

## Standard Risk: 1-2 Markers

These 31 files handle moderate-risk operations (API calls, user input, state management) and can be reviewed as a group:

### API Routes & Health Checks

| Path | Lines | Purpose | Focus |
|------|-------|---------|-------|
| `app/app/api/sse/protocol/route.ts` | 90 | SSE stream for protocol account updates | API-01, INFRA-03, ERR-01 |
| `app/app/api/health/route.ts` | 74 | Container liveness + dependency checks | CHAIN-01, DATA-01 |
| `app/app/api/rpc/route.ts` | 188 | RPC proxy (quote engine fallback) | API-01, CHAIN-01, ERR-02 |
| `app/app/api/candles/route.ts` | 256 | Candle data query endpoint | CHAIN-01, DATA-01, API-03 |
| `app/app/api/sse/candles/route.ts` | 48 | Candle streaming (SSE) | API-01, INFRA-03 |
| `app/app/api/carnage-events/route.ts` | 23 | Carnage event JSON export | API-03, DATA-01 |
| `app/app/api/sol-price/route.ts` | 36 | SOL/USDC price fetch | API-03, CHAIN-01 |

### Core State Hooks (Modified)

| Path | Lines | Purpose | Focus |
|------|-------|---------|-------|
| `app/hooks/useProtocolState.ts` | 365 | SSE-powered protocol state (NEW: phase 3) | API-01, CHAIN-01, DATA-01, LOGIC-01 |
| `app/hooks/useTokenBalances.ts` | 182 | User token balance polling | API-01, CHAIN-01, DATA-01 |
| `app/hooks/useTokenSupply.ts` | 41 | Token supply from protocol store | DATA-01, LOGIC-01 |
| `app/hooks/useCurrentSlot.ts` | 47 | Current slot from protocol store | DATA-01, CHAIN-01 |
| `app/hooks/usePoolPrices.ts` | 110 | Pool reserve caching + price math | CHAIN-01, DATA-01, LOGIC-01 |
| `app/hooks/useCarnageData.ts` | 78 | Carnage fund state + calculations | DATA-01, CHAIN-01, LOGIC-01 |

### Swap Infrastructure (Modified)

| Path | Lines | Purpose | Focus |
|------|-------|---------|-------|
| `app/lib/swap/hook-resolver.ts` | 82 | Transfer hook account resolution | SEC-02, CHAIN-03, INJ-03, API-04 |
| `app/lib/swap/error-map.ts` | 200 | Swap error code decoding | ERR-02, ERR-03 |
| `app/lib/swap/multi-hop-builder.ts` | 416 | Multi-hop instruction assembly | CHAIN-04, LOGIC-01, API-04 |
| `app/lib/curve/hook-accounts.ts` | 73 | Bonding curve hook setup | CHAIN-03, CHAIN-04, API-04 |
| `app/lib/curve/error-map.ts` | 49 | Bonding curve error decoding | ERR-02, ERR-03 |

### Staking Infrastructure (Modified)

| Path | Lines | Purpose | Focus |
|------|-------|---------|-------|
| `app/lib/staking/staking-builders.ts` | 379 | Stake/unstake/claim instructions | CHAIN-04, CHAIN-05, INJ-03, API-01 |
| `app/lib/staking/error-map.ts` | 41 | Staking error decoding | ERR-02 |
| `app/lib/staking/rewards.ts` | 98 | Reward calculation | LOGIC-01, LOGIC-02, DATA-01 |

### Deployment & Configuration (Modified)

| Path | Lines | Purpose | Focus |
|------|-------|---------|-------|
| `app/lib/protocol-config.ts` | 171 | Cluster-aware address resolution (NEW, critical) | LOGIC-01, DATA-01, API-03 |
| `app/lib/connection.ts` | 58 | Helius RPC + connection pooling | CHAIN-01, API-01 |
| `app/lib/anchor.ts` | 83 | Anchor program instances | CHAIN-01, API-01 |
| `app/next.config.ts` | 52 | Next.js build configuration | WEB-02, INFRA-03 |
| `app/providers/providers.tsx` | 60 | React context setup | FE-01 |
| `app/instrumentation.ts` | 30 | Server boot hook (calls ws-subscriber) | API-01, INFRA-03, ERR-01 |
| `shared/constants.ts` | 287 | Shared program IDs + PDAs (MODIFIED) | DATA-01 |
| `shared/index.ts` | 7 | Re-export barrel | — |

### Scripts: Deployment & E2E (Modified)

| Path | Lines | Purpose | Focus |
|------|-------|---------|-------|
| `scripts/deploy/generate-constants.ts` | 89 | Program ID generation from keypairs | DATA-01, API-03 |
| `scripts/deploy/upload-metadata.ts` | 151 | Arweave/Irys metadata upload | SEC-02, INJ-01, API-03 |
| `scripts/deploy/fix-carnage-wsol.ts` | 81 | WSOL balance fix (NEW) | CHAIN-05, DATA-01, INJ-03 |
| `scripts/e2e/lib/carnage-flow.ts` | 194 | Carnage hunter test suite (MODIFIED) | CHAIN-04, CHAIN-05, LOGIC-01 |
| `scripts/e2e/lib/stress-wallet.ts` | 168 | Stress-test wallet setup (MODIFIED) | CHAIN-05, DATA-01 |

---

## Low Risk: 0 Markers

These 206 files are low-risk (UI components, utilities, generated types, non-critical helpers) and can be spot-checked:

### UI Components (Unmodified — 70+ files)
- `app/components/swap/*` — Swap UI form, routes, fees (9 files)
- `app/components/launch/*` — Launch/bonding curve UI (15 files)
- `app/components/staking/*` — Staking interface (6 files)
- `app/components/station/*` — Station routing UI (8 files)
- `app/components/chart/*` — Candlestick chart + controls (6 files)
- `app/components/kit/*` — Design system (10 files)
- `app/components/modal/*`, `wallet/*`, `mobile/*`, etc. (20+ files)

### Utilities & Helpers (Unmodified — 50+ files)
- `app/lib/curve/` — Curve math (not modified)
- `app/lib/swap/__tests__/` — Route engine tests (2 files)
- `app/db/` — Database schema, connection, candle aggregator (4 files)
- `app/lib/audio-manager.ts` — Audio state machine (unmodified)
- `app/lib/event-parser.ts` — Event parsing (unmodified)
- `app/lib/sentry.ts` — Error reporting (unmodified)
- `app/lib/mobile-wallets.ts`, `jupiter.ts`, `solscan.ts` — Integrations (3 files)

### Generated & Configuration (80+ files)
- `app/idl/types/*.ts` — Anchor IDL types (10 files)
- `app/app/fonts.ts`, `page.tsx`, `layout.tsx`, `kit/page.tsx` — Pages (5 files)
- `tests/` — Integration tests (15 files)
- `scripts/` — Various test/deployment scripts (50+ files)

---

## Focus Area Cross-Reference

### By Auditor Domain

**SEC-01 (Access Control):**
- `app/app/api/webhooks/helius/route.ts` (webhook auth)
- `app/hooks/useSwap.ts` (signing)
- `app/hooks/useStaking.ts` (signing)

**SEC-02 (Signature Verification):**
- `app/app/api/webhooks/helius/route.ts` (HELIUS_WEBHOOK_SECRET)
- `app/hooks/useSwap.ts` (wallet sign)
- `app/lib/swap/hook-resolver.ts` (transfer hook validation)
- `scripts/deploy/upload-metadata.ts` (Arweave signing)

**CHAIN-01 (Slot/RPC):**
- `app/lib/ws-subscriber.ts` (slot subscription)
- `app/hooks/useCurveState.ts` (slot-dependent math)
- `app/hooks/useEpochState.ts` (epoch slot tracking)
- `app/hooks/useProtocolState.ts` (slot from SSE)
- `app/hooks/useCurrentSlot.ts` (slot tracking)
- `app/hooks/usePoolPrices.ts` (RPC calls)
- `app/app/api/health/route.ts` (RPC health)
- `app/app/api/rpc/route.ts` (RPC proxy)
- `app/lib/anchor.ts` (program instances)
- `app/lib/connection.ts` (RPC connection)

**CHAIN-02 (Accounts & State):**
- `app/app/api/webhooks/helius/route.ts` (account decoding)
- `app/hooks/useRoutes.ts` (pool reserve reading)
- `app/hooks/useCurveState.ts` (curve state)
- `app/hooks/useEpochState.ts` (epoch state)
- `app/hooks/useProtocolState.ts` (all PDA states)
- `app/lib/protocol-store.ts` (state caching)

**CHAIN-03 (Transfer Hooks):**
- `app/app/api/webhooks/helius/route.ts` (hook account updates)
- `app/lib/swap/hook-resolver.ts` (hook account resolution)
- `app/lib/curve/hook-accounts.ts` (curve hook setup)

**CHAIN-04 (Instruction Building):**
- `app/hooks/useSwap.ts` (swap instruction)
- `app/hooks/useStaking.ts` (stake instruction)
- `app/lib/swap/swap-builders.ts` (multi-leg assembly)
- `app/lib/swap/multi-hop-builder.ts` (multi-hop assembly)
- `app/lib/staking/staking-builders.ts` (stake/unstake/claim)
- `scripts/e2e/lib/carnage-flow.ts` (E2E instruction tests)

**CHAIN-05 (Signing/Submission):**
- `app/hooks/useSwap.ts` (TX signing + submission)
- `app/hooks/useStaking.ts` (TX signing + submission)
- `app/lib/swap/swap-builders.ts` (v0 TX handling)
- `scripts/e2e/lib/stress-wallet.ts` (TX submission)

**CHAIN-06 (Token Metadata):**
- `app/hooks/useSwap.ts` (decimals, balance checks)
- `app/hooks/useTokenBalances.ts` (balance queries)

**BOT-01, BOT-02:** Not applicable to off-chain code

**API-01 (RPC Client):**
- `app/lib/ws-subscriber.ts` (WS + HTTP RPC)
- `app/app/api/webhooks/helius/route.ts` (Helius webhook)
- `app/app/api/sse/protocol/route.ts` (SSE server)
- `app/app/api/sse/candles/route.ts` (SSE server)
- `app/app/api/health/route.ts` (dependency checks)
- `app/app/api/rpc/route.ts` (RPC proxy)
- `app/hooks/useProtocolState.ts` (SSE client)
- `app/hooks/useRoutes.ts` (Jupiter API)
- `app/hooks/useTokenBalances.ts` (RPC polling)
- `app/lib/connection.ts` (Helius connection)
- `app/lib/anchor.ts` (program instances)
- `app/lib/sse-manager.ts` (SSE pub/sub)
- `app/instrumentation.ts` (server boot)

**API-03 (External APIs):**
- `app/hooks/useRoutes.ts` (Jupiter quotes)
- `app/app/api/rpc/route.ts` (fallback routing)
- `app/app/api/candles/route.ts` (DB queries)
- `app/app/api/sol-price/route.ts` (Birdeye/CoinGecko)
- `scripts/deploy/generate-constants.ts` (IDL reading)
- `scripts/deploy/upload-metadata.ts` (Arweave/Irys)

**API-04 (Account Metadata):**
- `app/lib/swap/hook-resolver.ts` (hook metadata)
- `app/lib/swap/multi-hop-builder.ts` (account fetch)
- `app/lib/curve/hook-accounts.ts` (curve hook accounts)

**INJ-01 (User Input):**
- `app/app/api/webhooks/helius/route.ts` (payload validation)
- `scripts/deploy/upload-metadata.ts` (file input)

**INJ-03 (User Input in TX):**
- `app/hooks/useSwap.ts` (slippage, amount)
- `app/hooks/useStaking.ts` (amount, type)
- `app/lib/staking/staking-builders.ts` (user amounts)
- `scripts/e2e/lib/stress-wallet.ts` (test amounts)
- `scripts/deploy/fix-carnage-wsol.ts` (target amount)

**DATA-01 (Data Persistence):**
- `app/lib/ws-subscriber.ts` (protocolStore writes)
- `app/lib/protocol-store.ts` (in-memory cache)
- `app/app/api/webhooks/helius/route.ts` (DB writes)
- `app/hooks/useRoutes.ts` (cached quotes)
- `app/hooks/useProtocolState.ts` (SSE data)
- `app/hooks/useCurveState.ts` (curve state)
- `app/hooks/usePoolPrices.ts` (reserve cache)
- `app/hooks/useCarnageData.ts` (carnage state)
- `app/hooks/useCurrentSlot.ts` (slot cache)
- `app/hooks/useTokenSupply.ts` (supply cache)
- `app/lib/protocol-config.ts` (cluster config)
- `shared/constants.ts` (program IDs)

**DATA-04 (Query/Report):**
- `app/lib/credit-counter.ts` (RPC call tracking)
- `app/lib/swap/route-engine.ts` (route stats)

**ERR-01 (Slot Availability):**
- `app/lib/ws-subscriber.ts` (staleness monitoring)
- `app/hooks/useCurveState.ts` (slot dependent)
- `app/hooks/useEpochState.ts` (timeout recovery)
- `app/app/api/health/route.ts` (slot check)

**ERR-02 (Error Handling):**
- `app/hooks/useSwap.ts` (swap failures)
- `app/hooks/useStaking.ts` (stake failures)
- `app/hooks/useEpochState.ts` (timeout recovery)
- `app/lib/swap/error-map.ts` (error decoding)
- `app/lib/staking/error-map.ts` (error decoding)
- `app/app/api/rpc/route.ts` (error forwarding)
- `app/lib/credit-counter.ts` (stats tracking)

**ERR-03 (Critical Errors):**
- `app/app/api/webhooks/helius/route.ts` (webhook crashes)
- `app/hooks/useSwap.ts` (TX submission failures)
- `app/lib/swap/error-map.ts` (error codes)

**LOGIC-01 (Business Logic):**
- `app/hooks/useRoutes.ts` (route selection)
- `app/hooks/useSwap.ts` (swap flow)
- `app/hooks/useStaking.ts` (staking flow)
- `app/hooks/useCurveState.ts` (curve math)
- `app/lib/swap/route-engine.ts` (route optimization)
- `app/lib/protocol-store.ts` (state cache)
- `app/lib/protocol-config.ts` (config resolution)
- `app/lib/staking/rewards.ts` (reward math)
- `app/lib/sse-manager.ts` (pub/sub logic)
- `app/hooks/useProtocolState.ts` (state aggregation)
- `app/hooks/usePoolPrices.ts` (price calc)
- `app/hooks/useCarnageData.ts` (carnage calc)
- `scripts/e2e/lib/carnage-flow.ts` (flow logic)

**LOGIC-02 (Complex State):**
- `app/lib/bigint-json.ts` (BigInt serialization)
- `app/lib/swap/route-engine.ts` (multi-leg optimization)
- `app/lib/staking/rewards.ts` (cooldown logic)

**FE-01 (UI State):**
- `app/providers/ClusterConfigProvider.tsx` (cluster context)
- `app/providers/providers.tsx` (all providers)

**INFRA-03 (Deployment/Config):**
- `app/lib/sse-connections.ts` (connection limits)
- `app/next.config.ts` (Next.js config)
- `app/lib/sse-manager.ts` (SSE infrastructure)
- `app/instrumentation.ts` (boot sequence)
- `app/app/api/sse/protocol/route.ts` (SSE route)
- `app/app/api/sse/candles/route.ts` (SSE route)
- `scripts/load-test/run.ts` (load test config)
- `scripts/load-test/k6-sse.js` (k6 script)

**WEB-02 (Build/Tooling):**
- `app/next.config.ts` (Next.js config)

---

## Files by Delta Status

### NEW (10 files) — Full Detail Required

1. **app/lib/ws-subscriber.ts** (495 LOC) — Server boot RPC pipeline; risk=5
2. **app/lib/protocol-store.ts** (126 LOC) — In-memory PDA cache; risk=3
3. **app/lib/sse-manager.ts** (93 LOC) — SSE broadcast pub/sub; risk=2
4. **app/lib/sse-connections.ts** (119 LOC) — Connection rate-limiting; risk=1
5. **app/lib/credit-counter.ts** (69 LOC) — RPC call tracking; risk=1
6. **app/lib/bigint-json.ts** (80 LOC) — BigInt JSON helpers; risk=1
7. **app/lib/__tests__/bigint-json.test.ts** (68 LOC) — Unit tests; risk=0
8. **app/providers/ClusterConfigProvider.tsx** (124 LOC) — Cluster context; risk=2
9. **scripts/load-test/run.ts** (42 LOC) — Load test runner; risk=1
10. **scripts/load-test/k6-sse.js** (68 LOC) — k6 SSE scenario; risk=1

### MODIFIED (41 files) — Focus on Diffs

**API Routes (8):**
- `app/app/api/health/route.ts` — Added WS subscriber + credit counter status
- `app/app/api/rpc/route.ts` — Updated RPC client/proxy
- `app/app/api/sse/protocol/route.ts` — NEW: Protocol state streaming (critical)
- `app/app/api/webhooks/helius/route.ts` — Enhanced account webhook support (critical)
- Other API routes: minor updates for configuration/error handling

**Critical Hooks (11):**
- `app/hooks/useProtocolState.ts` — NEW: SSE-powered real-time state
- `app/hooks/useCurrentSlot.ts` — Updated to use protocol store
- `app/hooks/useTokenSupply.ts` — Updated to use protocol store
- `app/hooks/useTokenBalances.ts` — Updated RPC calls
- Other hooks: minor updates for error handling, RPC optimization

**Core Libraries (15):**
- `app/lib/protocol-config.ts` — NEW: Cluster-aware config resolution (critical)
- `app/lib/connection.ts` — Updated for RPC changes
- `app/lib/anchor.ts` — Updated program instances
- `app/lib/protocol-store.ts` — NEW cache integration
- `app/lib/sse-connections.ts` — NEW connection tracking
- `app/lib/sse-manager.ts` — NEW SSE pub/sub
- Swap/staking builders: minor error handling updates

**Configuration (3):**
- `app/next.config.ts` — Build config updates
- `app/instrumentation.ts` — Added ws-subscriber init call
- `app/providers/providers.tsx` — Added ClusterConfigProvider

**Deployment/E2E (4):**
- `scripts/deploy/generate-constants.ts` — Program ID sync
- `scripts/deploy/upload-metadata.ts` — Metadata upload
- `scripts/deploy/fix-carnage-wsol.ts` — NEW: WSOL balance fix
- `scripts/e2e/lib/carnage-flow.ts` — Enhanced test coverage

**Shared (2):**
- `shared/constants.ts` — Updated program IDs + config
- `shared/index.ts` — Re-export updates

---

## Audit Strategy

### Phase 1 (Completed)
- ✅ Full audit of base codebase (security, architecture, compliance)
- ✅ Findings in SOS/BOK/VulnHunter reports

### Phase 2 (This Diff) — Three Tiers

**Tier 1: Critical Audit (8 files, ~4.5k LOC)**
- All 10 NEW files + 8 high-risk MODIFIED files
- Required: Line-by-line review, threat model, integration testing
- Estimated effort: 40 hours per auditor

**Tier 2: Standard Review (31 files, ~3.5k LOC)**
- Moderate-risk MODIFIED files + API routes
- Required: Diff-based review, logic verification
- Estimated effort: 15 hours per auditor

**Tier 3: Spot Check (206 files, ~18k LOC)**
- Low-risk UNCHANGED files + UI components
- Sampling: 10% random spot-check + any files touched by tier 1/2 changes
- Estimated effort: 5 hours per auditor

### DBS-Specific Attack Surface

**New threat vectors introduced by Dinh's Bulwark Streaming:**

1. **WebSocket Starvation (H008)**
   - Mitigation: `sse-connections.ts` rate-limiting (10 per IP, 5000 global)
   - Audit: Verify limits are enforced before creating ReadableStream

2. **Protocol State Staleness**
   - Mitigation: `ws-subscriber.ts` fallback polling + staleness monitor
   - Audit: Verify 15s threshold detection + HTTP fallback activation

3. **Webhook Signature Bypass**
   - Mitigation: `timingSafeEqual()` in Helius route + fail-closed prod behavior
   - Audit: Verify HELIUS_WEBHOOK_SECRET is required in production

4. **Account Data Corruption (Helius→Client)**
   - Mitigation: Anchor account decoding validation in webhook handler
   - Audit: Verify all account types have proper error handling

5. **SSE Broadcast Spam**
   - Mitigation: `protocol-store.ts` dedup on serialized data
   - Audit: Verify dedup prevents duplicate broadcasts to clients

6. **globalThis Singleton Collision**
   - Mitigation: Feature-flagged init + WS_SUBSCRIBER_ENABLED guard
   - Audit: Verify all singletons use globalThis pattern correctly

---

## Quick Reference: Risk Hotspots

| Risk Area | Files | Action |
|-----------|-------|--------|
| Webhook Auth | `webhooks/helius` | Verify timingSafeEqual() implementation + prod fail-closed |
| TX Signing | `useSwap`, `useStaking` | Verify wallet adapter + skipPreflight logic |
| Account State | `protocol-store`, `ws-subscriber` | Verify Anchor decoding + dedup guards |
| SSE Streaming | `sse-protocol`, `sse-manager` | Verify connection limits + heartbeat timeout |
| RPC Credits | `credit-counter`, `ws-subscriber` | Verify call tracking + polling intervals |
| BigInt JSON | `bigint-json`, `protocol-store` | Verify serialization roundtrip fidelity |
| Cluster Config | `protocol-config`, `ClusterConfigProvider` | Verify mainnet/devnet address isolation |

---

## Integration Points (Phase 3 Critical)

**DBS data flows through:**
1. `ws-subscriber.init()` → `protocolStore.setAccountStateQuiet()` (seeding)
2. Helius Enhanced Webhook → `protocolStore.setAccountState()` (updates)
3. `sseManager.broadcast()` → Browser `/api/sse/protocol` stream
4. `useProtocolState()` hook → React components (real-time UI)

**All 4 steps must be audited as an integrated flow:**
- No stale data handoffs between layers
- No race conditions on globalThis singletons
- Proper error isolation (one failure doesn't crash others)

---

## References

- **Memory:** `/Users/mlbob/.claude/projects/-Users-mlbob-Projects-Dr-Fraudsworth/memory/MEMORY.md`
  - DBS architecture, singleton patterns, cluster-aware config pitfalls
- **Project Docs:** `Docs/mainnet-governance.md` (authority strategy), `Docs/protocol-arb-spec.md` (future)
- **Audit Reports:** `.bok/reports/` (SOS, BOK, VulnHunter findings)
- **Deployment:** `scripts/deploy/deployment-report.md` (program IDs, mints, ALT addresses)

---

**Last Updated:** 2026-03-21
**Index Maintained By:** Claude Code Agent
**Next Review:** Post-Phase 3 (Differential audit #2)
