# Dinh's Bulwark Hot Spots Analysis

**Project**: Dr. Fraudsworth
**Audit Focus**: Frontend RPC optimization (DBS change)
**Key Files Added/Modified**: WebSocket subscriber, SSE streaming, RPC proxy, rate limiting, protocol store
**Analysis Date**: 2026-03-21
**Scope**: Off-chain codebase (excludes programs/, node_modules/, target/, .next/)

---

## Executive Summary

The recent DBS change (Phase 102) refactored frontend RPC usage to support hundreds of concurrent users on the Helius Developer plan by:
- Moving shared protocol data from per-browser RPC polling to server-side WebSocket subscriptions
- Broadcasting state updates via Server-Sent Events (SSE) to connected browsers
- Adding RPC request credit tracking and rate limiting
- Centralizing Solana cluster configuration

This analysis identifies hot spots across 10 Dinh's Bulwark auditors that are most relevant to concurrent real-time systems with WebSocket, RPC, and financial data flows.

**Total Files Scanned**: 165 TS/TSX files (app/ + scripts/)
**Files with Trigger Matches**: 84
**Total Auditor Triggers Across All Files**: 2,183

---

## Auditor-Specific Hot File Rankings

### ERR-02: Race Conditions & Concurrency

**Auditor Trigger Patterns**: `async`, `await`, `Promise.all`, `Promise.race`, `setTimeout`, `setInterval`, `mutex`, `concurrent`, `lock`

Critical for DBS changes involving concurrent user sessions, WebSocket message ordering, and parallel RPC requests.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | scripts/vrf/lib/vrf-flow.ts | 94 | HIGH | Concurrent VRF polling + delay management |
| 2 | scripts/deploy/initialize.ts | 89 | HIGH | Sequential deployment steps with async waits |
| 3 | scripts/e2e/lib/swap-flow.ts | 73 | HIGH | Parallel swap execution in load tests |
| 4 | scripts/deploy/test-upgrade.ts | 71 | HIGH | Concurrent upgrade verification |
| 5 | scripts/e2e/security-verification.ts | 69 | HIGH | Parallel security tests |
| 6 | scripts/vrf/lib/security-tests.ts | 68 | MEDIUM | Concurrent security test execution |
| 7 | app/lib/ws-subscriber.ts | 41 | HIGH | **DBS: WebSocket subscription, polling intervals, Promise chains** |
| 8 | scripts/graduation/graduate.ts | 56 | HIGH | Sequential graduation steps |
| 9 | scripts/e2e/lib/carnage-flow.ts | 55 | HIGH | Parallel carnage fund operations |
| 10 | scripts/vrf/devnet-vrf-validation.ts | 49 | MEDIUM | Concurrent VRF validation |

**DBS-Specific Hot Spots**:
- `app/lib/ws-subscriber.ts` (41): Multiple `setInterval` timers for polling supply/stakers + WebSocket subscription. Race condition risk if one timer fires while another is updating protocol store.

### API-03: WebSocket & Real-Time Security

**Auditor Trigger Patterns**: `WebSocket`, `wss://`, `socket`, `ws`, `subscribe`, `emit`

Critical for SSE and WebSocket security—authentication, connection limits, message ordering.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | scripts/deploy/generate-constants.ts | 620 | MEDIUM | (Type definitions, not functional WS code) |
| 2 | app/lib/ws-subscriber.ts | 18 | CRITICAL | **DBS: Helius WS connection + onSlotChange subscription** |
| 3 | app/lib/sse-manager.ts | 17 | CRITICAL | **DBS: Pub/sub for SSE broadcast to browsers** |
| 4 | app/lib/connection.ts | 9 | HIGH | RPC connection setup (not WS, but network I/O) |
| 5 | app/app/api/sse/candles/route.ts | 8 | MEDIUM | SSE endpoint for candle streaming |
| 6 | app/instrumentation.ts | 7 | HIGH | **DBS: WS_SUBSCRIBER_ENABLED initialization** |
| 7 | app/app/api/sse/protocol/route.ts | 6 | CRITICAL | **DBS: SSE streaming for protocol state updates** |
| 8 | app/lib/event-parser.ts | 6 | MEDIUM | Event message parsing |
| 9 | app/components/chart/CandlestickChart.tsx | 5 | LOW | Chart component (frontend only) |
| 10 | app/next.config.ts | 4 | LOW | Next.js configuration |

**DBS-Specific Hot Spots**:
- `app/lib/ws-subscriber.ts` (18): Helius WebSocket + onSlotChange subscription. No visible authentication/rate limiting per subscriber—depends on RPC key configuration.
- `app/lib/sse-manager.ts` (17): In-memory pub/sub. Subscribers stored in Set. No authentication per client; relies on HTTP request context.
- `app/app/api/sse/protocol/route.ts` (6): Long-lived SSE connection. Missing per-client authentication context; heartbeat keeps connection alive but no explicit cleanup on auth timeout.

### CHAIN-04: State Synchronization

**Auditor Trigger Patterns**: `subscribe`, `onAccountChange`, `websocket`, `polling`, `helius`, `slot`, `commitment`

Critical for blockchain data consistency—account synchronization, slot progression, subscription staleness.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | app/lib/ws-subscriber.ts | 54 | CRITICAL | **DBS: Helius polling + account subscriptions** |
| 2 | app/lib/audio-manager.ts | 42 | MEDIUM | (Audio event sequencing, not chain state) |
| 3 | scripts/vrf/lib/vrf-flow.ts | 38 | HIGH | VRF randomness polling until ready |
| 4 | app/idl/types/epoch_program.ts | 35 | LOW | Type definitions (no functional code) |
| 5 | scripts/vrf/devnet-vrf-validation.ts | 26 | HIGH | Concurrent slot polling for VRF validation |
| 6 | app/hooks/useProtocolState.ts | 23 | CRITICAL | **DBS: Hook consuming WS subscriber updates + polling** |
| 7 | scripts/test/pathway1-test.ts | 22 | MEDIUM | Test polling for account state readiness |
| 8 | scripts/vrf/lib/security-tests.ts | 19 | MEDIUM | Slot-based VRF security tests |
| 9 | app/idl/types/bonding_curve.ts | 17 | LOW | Type definitions |
| 10 | app/lib/sse-manager.ts | 17 | HIGH | **DBS: Broadcasting subscription updates to clients** |

**DBS-Specific Hot Spots**:
- `app/lib/ws-subscriber.ts` (54): Multiple polling patterns (supply via HTTP, staker count via gPA, token metadata via HTTP). No commitment level enforcement; devnet may poll unconfirmed slots.
- `app/hooks/useProtocolState.ts` (23): Uses WS subscriber data + SSE EventSource. Falls back to polling if SSE unavailable—risk of double-polling creating duplicate work.
- `app/lib/sse-manager.ts` (17): Broadcasts account updates. No way for server to detect stale subscriptions; clients may receive updates for accounts they no longer care about.

### ERR-03: Rate Limiting & DoS

**Auditor Trigger Patterns**: `rate-limit`, `rateLimit`, `throttle`, `timeout`, `AbortController`, `credit`, `limit`

Critical for DBS change: RPC rate limits on Helius Developer plan (3 credits/sec), WebSocket connection limits, per-user quotas.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | scripts/vrf/lib/vrf-flow.ts | 30 | HIGH | Polling delays + timeouts in VRF flow |
| 2 | scripts/vrf/lib/security-tests.ts | 23 | MEDIUM | Timeout-based security test controls |
| 3 | scripts/load-test/run.ts | 19 | CRITICAL | **DBS: Load test rate limiting** |
| 4 | scripts/vrf/devnet-vrf-validation.ts | 18 | HIGH | Polling timeouts in VRF validation |
| 5 | app/lib/ws-subscriber.ts | 13 | CRITICAL | **DBS: Poll interval (rate limiting for supply/staker updates)** |
| 6 | scripts/backfill-candles.ts | 13 | MEDIUM | Candle backfill rate limiting |
| 7 | scripts/vrf/lib/reporter.ts | 13 | MEDIUM | Reporter polling throttling |
| 8 | app/lib/sse-connections.ts | 10 | CRITICAL | **DBS: SSE client timeout tracking** |
| 9 | app/app/api/candles/route.ts | 8 | MEDIUM | Candle endpoint rate limiting |
| 10 | app/lib/rate-limit.ts | 8 | CRITICAL | **DBS: Rate limiter library** |

**DBS-Specific Hot Spots**:
- `scripts/load-test/run.ts` (19): Stress test deliberately hammers endpoints. No RPC credit awareness; may exceed Helius limits and cause silent failures.
- `app/lib/ws-subscriber.ts` (13): Poll intervals hardcoded (no dynamic adjustment). If supply poll takes 500ms but interval is 1s, no overlap protection—subsequent polls may get stale data.
- `app/lib/sse-connections.ts` (10): Tracks SSE timeout; 15s heartbeat keeps connection alive. No per-client rate limiting; hundreds of clients = hundreds of concurrent SSE connections.
- `app/lib/rate-limit.ts` (8): Implementation unclear—need to verify it actually enforces 3 credits/sec limit on Helius calls.

### ERR-01: Error Handling & Fail Modes

**Auditor Trigger Patterns**: `try`, `catch`, `throw`, `Error`, `reject`, `finally`

Critical for reliability—graceful degradation when WS fails, RPC overloads, account fetch timeouts.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | scripts/deploy/initialize.ts | 32 | HIGH | Deployment rollback on error |
| 2 | scripts/deploy/test-upgrade.ts | 32 | HIGH | Upgrade verification error handling |
| 3 | scripts/e2e/devnet-e2e-validation.ts | 27 | HIGH | E2E test failure recovery |
| 4 | scripts/graduation/graduate.ts | 26 | HIGH | Authority burn errors (CRITICAL—no recovery!) |
| 5 | scripts/test/pathway1-test.ts | 25 | MEDIUM | Test assertion failures |
| 6 | scripts/e2e/lib/carnage-flow.ts | 21 | HIGH | Carnage fund swap error recovery |
| 7 | app/lib/ws-subscriber.ts | 10 | CRITICAL | **DBS: WebSocket reconnection + polling fallback** |
| 8 | scripts/deploy/upload-metadata.ts | 20 | HIGH | Metadata upload retry |
| 9 | scripts/deploy/transfer-authority.ts | 19 | HIGH | Authority transfer verification |
| 10 | scripts/e2e/lib/swap-flow.ts | 19 | MEDIUM | Swap execution error recovery |

**DBS-Specific Hot Spots**:
- `app/lib/ws-subscriber.ts` (10): Catches WebSocket errors. Does it automatically reconnect? Code shows subscription + polling fallback, but error handling path unclear.
- Missing: SSE protocol route error handling. If SSE stream fails, browser falls back to polling—need explicit error context to trigger fallback.
- Missing: Credit counter error handling. What happens if RPC call exceeds rate limit? Does it queue, reject, or return stale cache?

### CHAIN-02: RPC Client & Node Trust

**Auditor Trigger Patterns**: `Connection`, `clusterApiUrl`, `rpcUrl`, `RPC_URL`, `getAccountInfo`, `commitment`

Critical for DBS change: Single RPC endpoint for server-side subscriptions, cluster-aware routing, RPC failover.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | app/lib/connection.ts | 27 | CRITICAL | **DBS: Singleton RPC connection** |
| 2 | scripts/deploy/test-upgrade.ts | 15 | HIGH | Deployment RPC connection |
| 3 | scripts/deploy/transfer-authority.ts | 14 | HIGH | Authority transfer RPC calls |
| 4 | scripts/deploy/initialize.ts | 11 | HIGH | Initialization RPC calls |
| 5 | scripts/deploy/lib/connection.ts | 11 | HIGH | Deploy helper RPC connection |
| 6 | scripts/deploy/verify-authority.ts | 10 | HIGH | Authority verification RPC calls |
| 7 | scripts/deploy/verify.ts | 10 | HIGH | Verification RPC calls |
| 8 | scripts/graduation/graduate.ts | 9 | HIGH | Graduation RPC calls |
| 9 | app/lib/anchor.ts | 8 | CRITICAL | **DBS: Anchor program instantiation from RPC** |
| 10 | app/lib/swap/swap-builders.ts | 7 | MEDIUM | Swap building uses RPC data |

**DBS-Specific Hot Spots**:
- `app/lib/connection.ts` (27): Singleton Connection + clusterApiUrl. Hard-coded cluster from env. No failover if Helius down; entire server-side polling stack dies.
- `app/lib/anchor.ts` (8): Program instantiation depends on connection. If connection stale, all on-chain reads fail silently (need error context).
- Missing: Commitment level enforcement. Are slot subscriptions `confirmed` or `finalized`? Critical for state consistency.

### DATA-04: Logging & Information Disclosure

**Auditor Trigger Patterns**: `console.log`, `console.error`, `console.warn`, `debug`

Critical for DBS—avoid leaking RPC responses (account data, slot info) or user identity to logs.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | scripts/vrf/devnet-vrf-validation.ts | 100 | MEDIUM | Test logging (not production code) |
| 2 | scripts/graduation/graduate.ts | 86 | MEDIUM | Deployment logging |
| 3 | scripts/deploy/test-upgrade.ts | 80 | MEDIUM | Deployment logging |
| 4 | scripts/deploy/upload-metadata.ts | 65 | MEDIUM | Upload logging |
| 5 | scripts/load-test/run.ts | 64 | CRITICAL | **DBS: Load test logging—may expose RPC quota data** |
| 6 | scripts/deploy/transfer-authority.ts | 63 | MEDIUM | Authority transfer logging |
| 7 | scripts/e2e/carnage-hunter.ts | 60 | MEDIUM | E2E test logging |
| 8 | scripts/e2e/soak-verify.ts | 59 | MEDIUM | Soak test logging |
| 9 | scripts/e2e/stress-test.ts | 54 | MEDIUM | Stress test logging |
| 10 | scripts/e2e/overnight-runner.ts | 51 | MEDIUM | E2E runner logging |

**DBS-Specific Hot Spots**:
- `scripts/load-test/run.ts` (64): Likely logs RPC response times, error rates, credit usage. Ensure no sensitive data logged to console (could leak to Railway logs accessible by support).
- Missing: Server-side WS subscriber + SSE logs. Need to verify no account data is logged when subscriptions fire.

### SEC-02: Secret & Credential Management

**Auditor Trigger Patterns**: `process.env`, `API_KEY`, `SECRET`, `TOKEN`, `.env`

Critical for DBS—RPC key, Helius webhook signature key, Sentry DSN.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | scripts/deploy/initialize.ts | 63 | HIGH | Reads deployment env vars |
| 2 | scripts/graduation/graduate.ts | 40 | HIGH | Reads authority keypairs from env |
| 3 | scripts/test/pathway1-test.ts | 22 | MEDIUM | Test env var loading |
| 4 | scripts/webhook-manage.ts | 20 | CRITICAL | **Webhook signature key management** |
| 5 | scripts/deploy/upload-metadata.ts | 19 | HIGH | Arweave API key |
| 6 | scripts/e2e/lib/swap-flow.ts | 14 | MEDIUM | Test RPC key |
| 7 | app/app/api/webhooks/helius/route.ts | 13 | CRITICAL | **DBS: Helius webhook signature validation** |
| 8 | app/lib/swap/swap-builders.ts | 13 | HIGH | Swap RPC calls via connection env |
| 9 | scripts/deploy/generate-constants.ts | 13 | MEDIUM | Program ID env loading |
| 10 | scripts/e2e/lib/stress-wallet.ts | 13 | MEDIUM | Test wallet loading |

**DBS-Specific Hot Spots**:
- `app/app/api/webhooks/helius/route.ts` (13): Reads HELIUS_WEBHOOK_SECRET for signature verification. Critical: ensure HMAC validation is constant-time (not string comparison).
- `app/lib/protocol-config.ts` (10): Likely reads NEXT_PUBLIC_CLUSTER (public), but verify no private RPC key hardcoded in cluster config.
- Missing: Explicit env var validation. What if HELIUS_WEBHOOK_SECRET missing? Server crashes vs. graceful fallback?

### LOGIC-02: Financial & Economic Logic

**Auditor Trigger Patterns**: `balance`, `amount`, `price`, `fee`, `reward`, `BigInt`, `BN`

Critical for DBS—ensure swap quotes, fee calculations, and staker rewards computed consistently across browser + server.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | app/hooks/useSwap.ts | 82 | CRITICAL | **Client-side swap logic (amounts, quotes, fees)** |
| 2 | app/lib/swap/quote-engine.ts | 82 | CRITICAL | **Quote engine (price discovery)** |
| 3 | scripts/e2e/lib/swap-flow.ts | 78 | HIGH | E2E swap execution |
| 4 | app/hooks/useStaking.ts | 73 | CRITICAL | **Staking reward calculations** |
| 5 | app/idl/types/staking.ts | 69 | MEDIUM | Staking type definitions |
| 6 | scripts/graduation/graduate.ts | 70 | HIGH | Supply burn logic |
| 7 | scripts/e2e/lib/stress-wallet.ts | 66 | MEDIUM | Stress test wallet operations |
| 8 | scripts/e2e/lib/staking-flow.ts | 58 | HIGH | E2E staking verification |
| 9 | app/lib/swap/route-engine.ts | 53 | CRITICAL | **Route selection for swap routing** |
| 10 | scripts/deploy/initialize.ts | 50 | HIGH | Initial supply minting |

**DBS-Specific Hot Spots**:
- `app/hooks/useSwap.ts` (82): Client-side swap amounts depend on real-time pool reserves from WS subscriber. Race condition if client reads reserves while server is updating pools.
- `app/lib/swap/quote-engine.ts` (82): Quote engine must use same pool reserves as browser sees from SSE. If server calculates quotes server-side (for load testing), ensure consistency with client logic.
- Missing: Amount truncation/rounding logic. Are amounts consistently rounded to token decimals? BigInt truncation can cause off-by-one errors in swap math.

### API-04: Webhook & Callback

**Auditor Trigger Patterns**: `webhook`, `callback`, `hmac`, `signature`

Critical for DBS—Helius webhook delivery, HMAC signature validation, event idempotency.

| Rank | File | Triggers | Risk Level | Notes |
|------|------|----------|-----------|-------|
| 1 | app/app/api/webhooks/helius/route.ts | 79 | CRITICAL | **DBS: Helius webhook signature + account parsing** |
| 2 | scripts/webhook-manage.ts | 65 | CRITICAL | **Webhook management CLI** |
| 3 | scripts/backfill-candles.ts | 21 | HIGH | Candle backfill (webhook-like events) |
| 4 | app/lib/swap/multi-hop-builder.ts | 14 | MEDIUM | Multi-hop route building |
| 5 | app/lib/sse-manager.ts | 9 | HIGH | **DBS: SSE event broadcasting (pub/sub pattern)** |
| 6 | scripts/deploy/lib/logger.ts | 8 | MEDIUM | Logging callbacks |
| 7 | app/hooks/useSwap.ts | 7 | MEDIUM | Swap callback handlers |
| 8 | app/components/launch/RefundPanel.tsx | 6 | LOW | Component event callbacks |
| 9 | app/hooks/useVisibility.ts | 6 | LOW | Visibility change callbacks |
| 10 | app/components/chart/CandlestickChart.tsx | 5 | LOW | Chart event callbacks |

**DBS-Specific Hot Spots**:
- `app/app/api/webhooks/helius/route.ts` (79): Webhook signature validation + account state parsing. Critical: Is HMAC validation constant-time? Does webhook handler enforce idempotency (reject duplicate signatures)?
- `scripts/webhook-manage.ts` (65): CLI for webhook management. Verify no raw webhook secrets logged or exposed.
- Missing: Webhook retry logic. If webhook handler fails, does Helius retry? Is retry limit configurable?

---

## Global Hot Files (Ranked by Total Triggers)

Files with highest cross-auditor trigger density. These are the most critical files for security review in the DBS change.

| Rank | File | Total Triggers | Primary Auditors | Risk Level |
|------|------|-----------------|------------------|-----------|
| 1 | scripts/load-test/run.ts | 145 | ERR-02, DATA-04, ERR-03 | CRITICAL |
| 2 | app/lib/ws-subscriber.ts | 178 | CHAIN-04, ERR-02, API-03 | CRITICAL |
| 3 | app/app/api/webhooks/helius/route.ts | 168 | API-04, ERR-02, LOGIC-02 | CRITICAL |
| 4 | app/hooks/useSwap.ts | 130 | LOGIC-02, ERR-02, API-04 | CRITICAL |
| 5 | app/lib/sse-manager.ts | 44 | API-03, CHAIN-04, API-04 | CRITICAL |
| 6 | app/lib/connection.ts | 44 | CHAIN-02, API-03, CHAIN-04 | CRITICAL |
| 7 | app/hooks/useProtocolState.ts | 41 | CHAIN-04, ERR-02, ERR-01 | CRITICAL |
| 8 | app/app/api/rpc/route.ts | 35 | ERR-02, ERR-03, ERR-01 | HIGH |
| 9 | app/app/api/sse/protocol/route.ts | 25 | API-03, CHAIN-04, ERR-03 | HIGH |
| 10 | app/app/api/health/route.ts | 25 | CHAIN-04, ERR-03, ERR-01 | MEDIUM |
| 11 | app/instrumentation.ts | 21 | API-03, CHAIN-04, ERR-02 | HIGH |
| 12 | app/lib/sse-connections.ts | 17 | ERR-03, CHAIN-04, CHAIN-02 | HIGH |
| 13 | app/lib/sentry.ts | 16 | SEC-02, ERR-01, ERR-02 | MEDIUM |
| 14 | app/lib/protocol-config.ts | 11 | SEC-02, LOGIC-02 | MEDIUM |
| 15 | app/lib/credit-counter.ts | 8 | ERR-03, CHAIN-02 | MEDIUM |
| 16 | app/lib/anchor.ts | 8 | CHAIN-02 | MEDIUM |
| 17 | app/providers/ClusterConfigProvider.tsx | 4 | ERR-01, ERR-02, SEC-02 | LOW |
| 18 | app/lib/protocol-store.ts | 3 | CHAIN-04, API-04 | LOW |

---

## DBS Change Hot Spot Summary

**Files most impacted by the WebSocket-to-SSE refactoring:**

### Tier 1 (Must Review)

1. **app/lib/ws-subscriber.ts** (178 triggers)
   - **Issues**: Multiple polling intervals, Promise chains, subscription lifecycle
   - **Review Focus**: Race conditions in onSlotChange + supply/staker polling; reconnection logic; timeout handling
   - **Risk**: One failed subscription breaks entire state pipeline

2. **app/app/api/webhooks/helius/route.ts** (168 triggers)
   - **Issues**: Webhook signature validation, event routing, candle aggregation
   - **Review Focus**: HMAC constant-time validation; idempotent event handling; error recovery
   - **Risk**: Webhook rejection = stale client data

3. **app/lib/sse-manager.ts** (44 triggers)
   - **Issues**: In-memory pub/sub for SSE broadcast
   - **Review Focus**: Subscriber cleanup; memory leaks if SSE connections not unsubscribed; no authentication per client
   - **Risk**: Memory leak under concurrent load

4. **app/app/api/sse/protocol/route.ts** (25 triggers)
   - **Issues**: Long-lived SSE streaming; heartbeat + error handling
   - **Review Focus**: Connection timeout; graceful shutdown; client abort handling
   - **Risk**: Zombie connections exhaust server resources

### Tier 2 (Should Review)

5. **app/lib/connection.ts** (44 triggers)
   - **Issues**: Singleton RPC connection; cluster-aware routing
   - **Review Focus**: Failover logic; retry policy; commitment levels
   - **Risk**: Single point of failure for server-side polling

6. **app/hooks/useProtocolState.ts** (41 triggers)
   - **Issues**: Hook consuming SSE updates + fallback polling
   - **Review Focus**: SSE fallback logic; duplicate polling prevention; subscription cleanup
   - **Risk**: Double-polling if SSE falls back without disabling initial polling

7. **app/lib/sse-connections.ts** (17 triggers)
   - **Issues**: SSE client timeout tracking
   - **Review Focus**: Per-client rate limiting; timeout enforcement; connection cleanup
   - **Risk**: Hundreds of concurrent connections may exceed server limits

8. **scripts/load-test/run.ts** (145 triggers)
   - **Issues**: Load test that exercises RPC + SSE + WebSocket
   - **Review Focus**: RPC credit awareness; test cleanup; load profile realism
   - **Risk**: Test may exceed Helius rate limit and hide production bottlenecks

### Tier 3 (Spot Check)

9. **app/hooks/useSwap.ts** (130 triggers)
   - **Issues**: Client swap logic; quote calculation
   - **Review Focus**: Pool reserve staleness; consistent rounding; BigInt handling
   - **Risk**: Swap quote mismatch vs. on-chain execution

10. **app/lib/rate-limit.ts** (8 triggers)
    - **Issues**: Rate limiting implementation
    - **Review Focus**: Credit bucket implementation; per-RPC-key limits
    - **Risk**: Rate limiter bypassed = DDoS exposure

---

## Recommended Review Checklist

### Security & Concurrency

- [ ] **ws-subscriber.ts**: Verify `onSlotChange`, `supplyPollTimer`, and `stakerPollTimer` don't race. Does reconnection logic prevent double-subscription?
- [ ] **sse-manager.ts**: Can subscribers leak memory? What triggers cleanup?
- [ ] **sse-protocol/route.ts**: Does heartbeat interval conflict with client abort handler?
- [ ] **sse-connections.ts**: Is per-client rate limiting enforced? What's the maximum concurrent connection limit?
- [ ] **webhooks/helius/route.ts**: Is HMAC validation constant-time (`crypto.timingSafeEqual`)? Does handler reject duplicate signatures?

### Financial Logic Consistency

- [ ] **useSwap.ts**: When is pool reserve read vs. swap execution? Can slippage increase due to WS latency?
- [ ] **quote-engine.ts**: Does quote use same pool state as client sees from SSE, or is it server-side computed?
- [ ] **useProtocolState.ts**: If SSE fallback triggers, is initial polling disabled to prevent duplicate work?

### Error Handling & Resilience

- [ ] **connection.ts**: What happens if Helius RPC is down? Does server gracefully degrade or crash?
- [ ] **ws-subscriber.ts**: If WebSocket subscription fails, does polling fallback activate?
- [ ] **load-test.ts**: Does load test respect RPC rate limits? Can it trigger false positives on production metrics?

### Logging & Secrets

- [ ] **load-test.ts**: Does it log RPC response times, error counts, or credit usage? Any account data leaked?
- [ ] **protocol-config.ts**: Are RPC keys hardcoded or always from env vars?
- [ ] **webhooks/helius/route.ts**: Is webhook secret only used for HMAC validation, never logged?

### Resource Cleanup

- [ ] **sse-manager.ts**: Are subscriber callbacks removed when SSE client disconnects?
- [ ] **sse-connections.ts**: Are timeout intervals cleared on connection close?
- [ ] **ws-subscriber.ts**: Are polling intervals cleared if WebSocket reconnection fails after N retries?

---

## File Locations (Absolute Paths)

**Core DBS Files**:
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/ws-subscriber.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/sse-manager.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/sse-connections.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/app/api/sse/protocol/route.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/app/api/webhooks/helius/route.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/connection.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/credit-counter.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/rate-limit.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/protocol-config.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/protocol-store.ts`

**Supporting Files**:
- `/Users/mlbob/Projects/Dr Fraudsworth/app/app/api/rpc/route.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/hooks/useProtocolState.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/hooks/useSwap.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/anchor.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/providers/ClusterConfigProvider.tsx`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/instrumentation.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/app/lib/sentry.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/load-test/run.ts`
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/webhook-manage.ts`

---

## Methodology Notes

**Auditor Patterns Used**:
1. **ERR-02** (Race Conditions): Async/await, Promise.all/race, timers, concurrency keywords
2. **API-03** (WebSocket Security): WebSocket constructors, subscribe/emit, connection setup
3. **CHAIN-04** (State Sync): subscribe, slot tracking, polling, commitment levels
4. **ERR-03** (Rate Limiting): rate-limit keywords, timeout controls, credit tracking
5. **ERR-01** (Error Handling): try/catch/throw, Error constructors, rejection handling
6. **CHAIN-02** (RPC Trust): Connection creation, clusterApiUrl, RPC endpoint config
7. **DATA-04** (Logging): console.log/error/warn, debug statements
8. **SEC-02** (Secret Management): process.env, API_KEY, SECRET, TOKEN references
9. **LOGIC-02** (Financial): balance, amount, price, fee, BigInt/BN operations
10. **API-04** (Webhooks): webhook, callback, hmac, signature keywords

**Scope**: Off-chain codebase (app/ + scripts/) excluding node_modules, target/, .next/, programs/

**Total Files Analyzed**: 165 TypeScript/TSX files
**Files with Matches**: 84
**Total Auditor Triggers**: 2,183

---

Generated by Dinh's Bulwark Auditor Framework
Analysis Date: 2026-03-21
