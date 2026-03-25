# SSE Load Test Results

**Date:** 2026-03-20
**Context:** DBS Phase 7 — Validation

## Test Environment

- **Machine:** macOS Darwin 25.2.0 (Apple Silicon)
- **Node.js:** 18+ (Next.js dev server via `npm run dev`)
- **k6:** v1.6.1
- **File descriptor limit:** unlimited (local)
- **Target:** `http://localhost:3000/api/sse/protocol`
- **Server state:** ws-subscriber running, Solana WS connected, devnet (quiet — no active transactions)

## k6 Raw Connection Test

### Configuration

| Setting | Value |
|---------|-------|
| VUs | 5 (per-IP limit = 10, shared with 2 SSE routes per user) |
| Duration | 15s hold + 30s timeout |
| Connection timeout | 30s |

### Results

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Connection success | 100% | > 99% | PASS |
| Initial state received | 100% | > 95% | PASS |
| TTFB p95 | 12ms | < 1000ms | PASS |
| Events received | 35 (7/VU) | - | OK |
| Data received | 12 KB | - | OK |

### k6 SSE Limitation

k6 uses HTTP request buffering — SSE responses are collected in full after the timeout. This means:
- Per-event real-time latency **cannot** be measured with k6
- k6's `http_req_waiting` (TTFB) is the meaningful latency metric: **p95 = 12ms**
- Event counts and connection success are accurate
- Use the TypeScript harness (`run.ts`) for real-time per-event latency tracking

### Per-IP Connection Limit

The SSE connection limiter (`sse-connections.ts`) enforces **MAX_PER_IP = 10**. Since all load test connections originate from `127.0.0.1`, we're capped at 10 simultaneous SSE connections from a single machine. This is correct production behavior (5 tabs × 2 SSE routes = 10).

**For true multi-hundred-connection testing**, options:
1. Run from multiple machines or containers
2. Temporarily increase MAX_PER_IP for testing
3. Use a load balancer/proxy that distributes across source IPs

## Custom TypeScript Harness

### Configuration

| Setting | Value |
|---------|-------|
| Connections | 10 (max per-IP) |
| Duration | 90s |
| Target | `http://localhost:3000` |

### Connection Results

| Metric | Value |
|--------|-------|
| Attempted | 10 |
| Connected | 10 (100%) |
| Initial state received | 10 (100%) |
| Errors | 0 |

### Event Coverage

| Source | Events | Avg Interval | Coverage | Notes |
|--------|--------|-------------|----------|-------|
| crimePool | 0 | N/A | 0% | No on-chain activity (quiet devnet) |
| fraudPool | 0 | N/A | 0% | No on-chain activity |
| epochState | 0 | N/A | 0% | No epoch advancement during test |
| stakePool | 0 | N/A | 0% | No staking changes |
| carnageFund | 0 | N/A | 0% | No carnage events |
| crimeCurve | 0 | N/A | 0% | No curve purchases |
| fraudCurve | 0 | N/A | 0% | No curve purchases |
| carnageSolVault | 0 | N/A | 0% | No vault changes |
| crimeSupply | 0 | N/A | 0% | Dedup: supply unchanged between polls |
| fraudSupply | 0 | N/A | 0% | Dedup: supply unchanged between polls |
| **currentSlot** | **170** | **5223ms** | **100%** | Slot broadcasts every ~5s (matches SLOT_BROADCAST_INTERVAL_MS=5000) |
| stakingStats | 0 | N/A | 0% | Dedup: staker data unchanged between polls |

**Why most sources show 0 events:** The protocol-store has a dedup guard that suppresses broadcasts when data hasn't changed. On a quiet devnet with no active transactions:
- Account-based sources (pools, curves, staking, carnage, epoch) only update when webhooks deliver actual changes
- Supply and staker polls fire on schedule but dedup suppresses identical data
- **Slot is the only source that changes every broadcast interval** — confirming the SSE pipeline works end-to-end

All sources **ARE present in the initial-state snapshot** (verified by 100% initial-state receipt).

### BigInt Integrity

**PASS** — All BigInt fields correctly tagged. Zero integrity failures.

### Credit Counter

| Metric | Value |
|--------|-------|
| Before test | 17 calls |
| After test | 22 calls |
| Delta | 5 calls during 90s test |

5 calls = 1 supply poll (2 getTokenSupply) + 1 staker poll (1 gPA) + 2 getSlot slots. SSE connections themselves cost **zero RPC credits** — they're pure server-push.

### Reconnect Test

| Metric | Value |
|--------|-------|
| Reconnected | Yes |
| Initial state received | Yes |
| Time to reconnect | 8ms |

Fresh SSE connection receives full initial-state snapshot in **8ms** — confirms protocolStore seeding works correctly.

## Railway Performance Extrapolation

### Railway Hobby Plan Specs (confirmed 2026-03-20)

- Up to 48 vCPU / 48 GB RAM per service
- Up to 8 vCPU / 8 GB RAM per replica
- Up to 6 replicas
- $5/mo usage credits included

### Local Baseline

| Metric | Local Value |
|--------|------------|
| TTFB | p95 = 12ms |
| Max connections per IP | 10 |
| Max global connections | 5000 |
| Memory per connection | ~negligible (SSE is write-only) |
| FD limit | unlimited |

### Predicted Railway Performance

| Factor | Local | Railway Hobby | Adjustment |
|--------|-------|---------------|------------|
| **Memory** | Unlimited | 8 GB per replica | SSE connections are lightweight (no per-connection state beyond WriteStream). 5000 connections easily fits in 8GB. **Not a bottleneck.** |
| **Network** | 0ms RTT | 10-50ms RTT | TTFB would be ~60ms instead of 12ms. Still well under 1s. |
| **CPU** | Dedicated cores | Up to 8 vCPU | Event loop saturation depends on broadcast rate. At ~0.2 events/sec (quiet), no concern. Under load (25 events/sec × 5000 clients = 125K writes/sec), 8 vCPU should handle it. |
| **FD limit** | Unlimited | Unknown (check with `ulimit -n` in container) | **Only unknown.** Each SSE connection = 1 FD. If Railway default is low, this is the ceiling. |

### Estimated Railway Performance

| Users | SSE Connections | TTFB (est.) | Status |
|-------|----------------|-------------|--------|
| 250 | 500 | ~60ms | Comfortable on Hobby |
| 500 | 1000 | ~80ms | Comfortable on Hobby (if FD limit allows) |
| 1000 | 2000 | ~100ms | Hobby plan should handle — check FD limit |
| 2000 | 4000 | ~120ms | May need replica scaling (Hobby supports up to 6) |

### Key Finding

With 8 GB RAM and 8 vCPU per replica on the Hobby plan, memory and CPU are **not bottlenecks**. The only unknown is the **file descriptor limit** in Railway containers, which determines the maximum number of concurrent SSE connections.

**Recommendation:** After deploying, check `ulimit -n` in the Railway container. If it's ≥ 4096, the Hobby plan should comfortably handle 1000+ concurrent users. Upgrade to Pro only if you hit the $5/mo usage credit cap or need 30-day logs.

### Helius Plan

The Helius Developer plan ($49/mo, 50 RPS, 10M credits) is the other scaling constraint:
- Server-side fixed cost: ~734K credits/month (ws-subscriber polls)
- Per-user cost: ~2 calls/min (balance polling only, thanks to DBS migration)
- At 500 concurrent users (8hrs/day peak): ~734K + 7.2M ≈ 7.9M credits/month — fits
- RPS: 500 users × 0.03 RPS + 0.3 RPS server ≈ 15.3 RPS — well within 50 RPS
- **Next Helius tier is 10x more expensive** — stay on Developer until credit budget is consistently >80%
