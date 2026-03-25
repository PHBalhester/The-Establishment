# SSE Load Testing Suite

Two complementary tools for validating the DBS server-side SSE migration under load.

## Prerequisites

- **k6** (`brew install k6`) — for raw connection scaling
- **Node.js 18+** — for the protocol-aware TypeScript harness
- **Local dev server running** — `cd app && npm run dev`

## Tool 1: k6 Raw SSE Ramp Test

Tests pure connection scaling — how many concurrent SSE connections the server can handle before breaking.

### Quick smoke test (10 VUs, 30s)

```bash
k6 run scripts/load-test/k6-sse.js --vus 10 --duration 30s
```

### Full ramp test (100 → 1000 VUs)

```bash
k6 run scripts/load-test/k6-sse.js
```

The default ramp profile:
| Stage | Target VUs | Duration |
|-------|-----------|----------|
| Ramp  | 100       | 30s      |
| Hold  | 100       | 2m       |
| Ramp  | 250       | 30s      |
| Hold  | 250       | 2m       |
| Ramp  | 500       | 30s      |
| Hold  | 500       | 2m       |
| Ramp  | 750       | 30s      |
| Hold  | 750       | 2m       |
| Ramp  | 1000      | 30s      |
| Hold  | 1000      | 2m       |
| Down  | 0         | 30s      |

### Metrics

| Metric | Description | Threshold |
|--------|-------------|-----------|
| `sse_connect_success` | % of VUs that connected successfully | > 99% |
| `sse_event_latency` | Time from connection open to first events | p95 < 500ms |
| `sse_events_received` | Total SSE events across all VUs | Higher = better |
| `sse_connection_drops` | Connections that dropped or got 0 events | Lower = better |
| `sse_initial_state_received` | % of connections that got initial-state | > 95% |

### Export to JSON

```bash
k6 run scripts/load-test/k6-sse.js --out json=results.json
```

## Tool 2: Custom TypeScript Harness

Protocol-aware validation — verifies SSE delivers correct, complete data.

### Quick validation (10 connections, 30s)

```bash
npx tsx scripts/load-test/run.ts --connections 10 --duration 30s
```

### Full test (100 connections, 60s)

```bash
npx tsx scripts/load-test/run.ts --connections 100 --duration 60s
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--connections N` | 100 | Number of concurrent SSE connections |
| `--duration Xs` | 60s | Test duration (`30s`, `5m`, etc.) |
| `--url URL` | http://localhost:3000 | Target server URL |

### What it validates

1. **Event coverage**: All 12 expected event sources received:
   - `crimePool`, `fraudPool` — AMM pool states
   - `epochState` — epoch singleton
   - `stakePool`, `stakingStats` — staking data
   - `crimeCurve`, `fraudCurve` — bonding curve states
   - `carnageFund`, `carnageSolVault` — carnage data
   - `crimeSupply`, `fraudSupply` — token supply
   - `currentSlot` — slot number

2. **BigInt integrity**: Verifies that u64/u128 fields arrive as `{ __bigint: "..." }` tags and parse correctly to BigInt:
   - Curve: `tokensSold`, `solRaised`, `tokensReturned`, `solReturned`, `taxCollected`
   - Staking: `rewardsPerTokenStored`

3. **Per-event-type latency**: Tracks delivery interval per source type.

4. **Credit counter**: Queries `/api/health` before/after to measure RPC credit consumption during the test.

5. **Reconnect test**: Opens a fresh connection after the main test and verifies it receives an `initial-state` snapshot.

### Output

- **stdout**: Human-readable summary with pass/fail
- **report.json**: Structured JSON report at `scripts/load-test/report.json`

## Interpreting Results

### What "passing" means

- **≥ 95%** connections successfully opened
- **≥ 95%** received initial-state snapshot
- **Zero** BigInt integrity failures
- **Reconnect** received initial-state

### Railway Performance Extrapolation

Local results need adjustment for Railway:

| Factor | Local | Railway | Impact |
|--------|-------|---------|--------|
| Memory | Unlimited | ~512MB default | Connection ceiling limited by memory |
| Network | 0ms RTT | 10-50ms RTT | Add to latency percentiles |
| CPU | Dedicated cores | Shared vCPU | Event loop saturation earlier |
| FD limit | `ulimit -n` (check locally) | Varies | Connection ceiling |

**Rule of thumb**: Expect Railway to handle ~60-70% of local connection capacity due to shared resources and network overhead.

To check your local FD limit:
```bash
ulimit -n
```

### When to scale

If the k6 ramp test shows:
- **p95 latency > 500ms** at N connections → N is your comfortable ceiling
- **Connection failures** above 1% → approaching the hard limit
- **Memory growth** non-linear → approaching OOM territory

Plan to scale (Railway Pro plan, or dedicated compute) before reaching 70% of the measured ceiling.
