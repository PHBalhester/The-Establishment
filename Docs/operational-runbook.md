---
doc_id: operational-runbook
title: "Dr. Fraudsworth's Finance Factory -- Operational Runbook"
wave: 3
requires: [architecture]
provides: [operational-runbook]
status: draft
decisions_referenced: [operations, security, error-handling, testing, architecture]
needs_verification: [mainnet-priority-fee-vs-bounty-economics]
---

# Operational Runbook

## Overview

This runbook covers the day-to-day operation of the Dr. Fraudsworth protocol infrastructure. The protocol runs on three pillars:

1. **Railway** -- Single instance hosting the Next.js frontend and background crank worker. Built-in container restart on failure (`restartPolicyType = "ON_FAILURE"`, max 3 retries). No PM2 or systemd needed.
2. **Helius** -- Single RPC provider for all Solana interactions (crank bot, frontend, deployment). Free tier through ~600 DAU, Developer tier ($49/mo) at ~1,000 DAU.
3. **Sentry** -- Zero-dependency error tracking via raw HTTP POST envelopes (`app/lib/sentry.ts`). No `@sentry/*` npm packages (incompatible with Turbopack SSR).

**Key architectural property:** The crank bot has no on-chain privileges. It is a regular wallet executing permissionless instructions. If it dies, anyone can crank. Swaps continue with stale tax rates, staking works normally, rewards accumulate safely, and no funds are ever locked. The protocol degrades gracefully.

### Program IDs (Mainnet -- Canonical)

Source of truth: `deployments/mainnet.json`

| Program | ID |
|---------|-----|
| AMM | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| Transfer Hook | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` |
| Tax Program | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` |
| Epoch Program | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` |
| Staking | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` |
| Conversion Vault | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` |
| Bonding Curve | `DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV` (closed post-graduation) |

### Token Mints (Mainnet)

| Token | Mint Address |
|-------|-------------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` |

### Key Addresses (Mainnet)

| Entity | Address |
|--------|---------|
| Deployer Wallet | `23g7xmrtXA6LSWopQcAUgiptGUArSLEMakBKcY1S59YR` |
| Crank Wallet | `F84XUxo5VM8FJZeGvC3CrHYwLzFod3ep57CULjZ4ZXc1` |
| Treasury | `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv` |
| Squads Vault | `4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ` |
| Squads Multisig | `F7axBNUgWQQ33ZYLdenCk5SV3wBrKyYz9R7MscdPJi1A` |
| EpochState PDA | `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU` |
| CarnageFund PDA | `CX9Xx2vwSheqMY7zQZUDfAexXg2XHcQmZ45wLgHZDNhV` |
| CarnageSolVault | `5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT` |
| Address Lookup Table | `7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h` |

### Key Addresses (Devnet -- Historical)

> **Note:** These are Phase 69/95 devnet addresses retained for historical reference. All mainnet operational addresses are in the tables above.

| Entity | Address |
|--------|---------|
| Devnet Wallet | `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` |

---

## Crank Bot Operations

The crank bot is implemented as `scripts/e2e/overnight-runner.ts` -- a single long-lived TypeScript process that cycles epochs on devnet with real VRF, swaps, staking, and Carnage detection.

### Starting the Crank Bot

**Prerequisites:**
- All 6 programs deployed on devnet (run `build.sh --devnet` then `deploy.sh`)
- EpochState initialized (`npx tsx scripts/deploy/initialize.ts`)
- Funded devnet wallet with >= 20 SOL (wallet: `keypairs/devnet-wallet.json`)
- `CLUSTER_URL` env var pointing to Helius devnet RPC

**Start command (local):**
```bash
cd /Users/mlbob/Projects/Dr\ Fraudsworth
set -a && source .env && set +a && npx tsx scripts/e2e/overnight-runner.ts
```

**Start with custom epoch count:**
```bash
OVERNIGHT_EPOCHS=50 set -a && source .env && set +a && npx tsx scripts/e2e/overnight-runner.ts
```

The `OVERNIGHT_EPOCHS` env var controls the target number of epochs (default: 100).

### Stopping the Crank Bot

**Graceful shutdown:** Send SIGINT (Ctrl+C) or SIGTERM. The runner sets a `shutdownRequested` flag, finishes the current epoch, claims any pending staking rewards, generates the overnight report, and exits cleanly.

**Hard shutdown:** Send SIGKILL (kill -9). This is safe because:
- Each epoch record is appended to the JSONL log file immediately after completion (crash-safe)
- On-chain state is always consistent (each TX either commits or reverts atomically)
- The next run will detect `vrfPending=true` and execute VRF timeout recovery automatically

### Crank Bot Configuration Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `TARGET_EPOCHS` | 100 (or `OVERNIGHT_EPOCHS` env) | Number of epochs to run |
| `AIRDROP_THRESHOLD` | 2 SOL | Request airdrop when wallet drops below |
| `AIRDROP_AMOUNT` | 2 SOL | Airdrop request amount (devnet max) |
| `SLOT_WAIT_BETWEEN_EPOCHS` | 760 slots (~5 min) | Wait between transitions (750 on-chain + 10 buffer) |
| `SWAP_EVERY_N_EPOCHS` | 10 | Execute a swap every Nth epoch |
| `SWAP_AMOUNT` | 0.003 SOL (3,000,000 lamports) | Per-swap SOL amount |
| `WSOL_BUDGET` | 0.1 SOL (100,000,000 lamports) | Total WSOL for test user |
| `RPC_DELAY_MS` | 200 ms | Rate limit delay between RPC calls |
| `STAKE_AMOUNT` | 10 PROFIT (10,000,000 raw units) | Amount staked for rewards testing |

### Crank Bot Output Files

| File | Path | Description |
|------|------|-------------|
| JSONL log | `scripts/e2e/overnight-run.jsonl` | Per-epoch records (crash-safe append) |
| Overnight report | `Docs/Overnight_Report.md` | Human-readable summary with stats |
| Dummy log | `scripts/e2e/overnight-dummy.jsonl` | Logger stub for sub-functions |
| Stdout log | `scripts/e2e/overnight-stdout.log` | Console output (if redirected) |

### What Each Epoch Does

For each of the `TARGET_EPOCHS` iterations, the main loop:

1. **Auto-airdrop safety net** -- Checks wallet balance; if below 2 SOL, requests a devnet airdrop (silently catches faucet rate limits)
2. **Wait for slot boundary** -- Waits 760 slots (~5 min) between epochs (skipped for first epoch)
3. **Advance epoch with VRF** -- Executes the 3-TX VRF flow (see VRF Epoch Flow below)
4. **Execute swap** -- Every 10th epoch, executes a SOL buy swap alternating CRIME/SOL and FRAUD/SOL pools (0.003 SOL per swap)
5. **Carnage execution** -- If VRF triggered Carnage, attempts `execute_carnage_atomic` via `testForcedCarnage()`
6. **Read post-epoch state** -- Captures wallet balance, Carnage vault balance, staking rewards delta
7. **Log EpochRecord** -- Appends JSON to the JSONL file and prints a one-line summary

After all epochs complete (or graceful shutdown), the runner:
- Claims accumulated staking rewards
- Generates `Docs/Overnight_Report.md` via `OvernightReporter`
- Prints a final summary with duration, epoch count, swap count, Carnage triggers, and errors

### Monitoring (Sentry Crons)

**Architecture (Decision D2):** Two-layer monitoring:

1. **Error tracking:** The crank bot wraps each epoch in try/catch. Errors are logged to the JSONL record and can be POSTed to Sentry via the zero-dependency `captureException()` function in `app/lib/sentry.ts`. This provides stack traces and diagnostics.

2. **Uptime heartbeat (planned):** Sentry Crons monitor -- the bot will send a check-in every epoch. If Sentry does not hear from the bot within the expected window (~6 minutes), it alerts via email. This catches the "dead process can't report its own death" gap.

**Sentry DSN configuration:** Set via `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN` env var. The `captureException()` function silently no-ops if neither is set.

**How the zero-dependency Sentry integration works (`app/lib/sentry.ts`):**
- Parses the DSN URL to extract `key`, `projectId`, and `host`
- Constructs a Sentry envelope (header + item_header + event JSON)
- POSTs to `https://{host}/api/{projectId}/envelope/` via `fetch()`
- Fire-and-forget: never awaits the response, never throws
- Works in both browser and Node.js (no polyfills needed)

**CSP requirement for Sentry:** The Next.js CSP header in `app/next.config.ts` includes both `*.ingest.sentry.io` AND `*.ingest.us.sentry.io` because US-region DSNs use two subdomain levels (e.g., `o123.ingest.us.sentry.io`).

---

## VRF Epoch Flow (Step-by-Step)

The VRF epoch transition is implemented in `scripts/vrf/lib/vrf-flow.ts` and executes a 3-transaction Switchboard On-Demand VRF commit-reveal cycle.

### Happy Path (3 Transactions)

**TX 1: Create Randomness Account**
```
Keypair.generate() -> sb.Randomness.create() -> sendRawTransaction(skipPreflight: true) -> confirmTransaction("finalized")
```
- Generates a fresh Keypair for the Switchboard randomness account
- `skipPreflight: true` because the SDK's LUT creation uses a finalized slot that can be slightly stale
- **CRITICAL:** Must wait for FINALIZATION, not just confirmation. `commitIx()` reads the account client-side and will fail if not finalized
- Duration: ~6-10 seconds (finalization on devnet)

**TX 2: Commit + Trigger Epoch Transition**
```
randomness.commitIx(queue) + epochProgram.methods.triggerEpochTransition() -> sendAndConfirm()
```
- Combines the Switchboard commit instruction with the on-chain epoch transition trigger
- `triggerEpochTransition` sets `vrf_pending=true` on EpochState and pays the crank bounty (0.001 SOL)
- 400,000 CU budget
- Duration: ~500ms

**Wait for Oracle (~3 slots)**
```
waitForSlotAdvance(connection, 3) -- polls getSlot() every 500ms
```
- The Switchboard oracle needs approximately 3 slots to process the commitment and produce the random value

**TX 3: Reveal + Consume Randomness (+ optional Carnage Atomic)**
```
randomness.revealIx() + epochProgram.methods.consumeRandomness() -> sendAndConfirm()
```
- Gets the reveal instruction from the oracle (up to 10 retry attempts with exponential backoff: 3s, 6s, 9s...)
- `consumeRandomness` reads the revealed VRF bytes and updates tax rates on EpochState
- When `carnageAccounts` AND `alt` are provided, bundles `executeCarnageAtomic` as a third instruction in a VersionedTransaction v0 (600,000 CU). The on-chain no-op guard returns `Ok(())` when Carnage does not trigger, making this always safe. When Carnage triggers, the swap executes atomically in the same transaction -- zero MEV window (CARN-002 fix)
- Duration: ~500ms-30s (depends on oracle response time)

### VRF Byte Interpretation

The 8 VRF bytes are consumed by `consume_randomness` to set epoch parameters:

| Byte | Name | Logic |
|------|------|-------|
| 0 | coinFlip | `< 192` = flip cheap side (75% probability), `>= 192` = keep current |
| 1 | crimeLowTaxByte | `(byte % 4) * 100 + 100` = 100/200/300/400 bps (CRIME low tax magnitude) |
| 2 | crimeHighTaxByte | `(byte % 4) * 100 + 1100` = 1100/1200/1300/1400 bps (CRIME high tax magnitude) |
| 3 | fraudLowTaxByte | `(byte % 4) * 100 + 100` = 100/200/300/400 bps (FRAUD low tax magnitude) |
| 4 | fraudHighTaxByte | `(byte % 4) * 100 + 1100` = 1100/1200/1300/1400 bps (FRAUD high tax magnitude) |
| 5 | carnageTrigger | `< 11` = Carnage triggered (~4.3% probability per epoch) |
| 6 | carnageAction | `< 5` = Sell path (2%), else Burn path (98%) |
| 7 | carnageCoin | `< 128` = CRIME target, `>= 128` = FRAUD target |

### Anti-Patterns (NEVER do these)

- **NEVER combine TX1 + TX2** -- The Switchboard SDK reads the randomness account client-side before constructing `commitIx()`. The account MUST exist and be finalized first.
- **NEVER use "confirmed" for TX1** -- Always finalize. Confirmed-but-not-finalized accounts can cause `commitIx()` to fail.
- **NEVER hardcode Switchboard addresses** -- Use `sb.getProgramId()` and `sb.getDefaultQueue()` for dynamic resolution.
- **NEVER rotate gateways for reveal** -- Each randomness account is assigned to a specific oracle. Alternative gateways serve different oracles whose signatures fail on-chain verification (error `0x1780`). Only retry the default gateway.

---

## Carnage Execution

Carnage is the protocol's deflationary mechanism. When VRF byte 5 triggers Carnage (~4.3% per epoch), the CarnageFund's SOL is used to buy CRIME or FRAUD tokens, with optional burn or sell of previously held tokens.

### Carnage Hunter (Testing Script)

`scripts/e2e/carnage-hunter.ts` tests all 6 Carnage execution paths using the devnet-only `force_carnage` instruction.

**Run:**
```bash
cd /Users/mlbob/Projects/Dr\ Fraudsworth
set -a && source .env && set +a && npx tsx scripts/e2e/carnage-hunter.ts
```

**The 6 chained test cases (order matters):**
1. BuyOnly CRIME -- Establishes CRIME holdings
2. Burn + Buy FRAUD -- Burns CRIME, buys FRAUD (cross-token burn)
3. Sell + Buy CRIME -- Sells FRAUD, buys CRIME (sell path)
4. Burn + Buy CRIME -- Burns CRIME, buys CRIME (same-token burn = Bug 1 fix)
5. Sell + Buy FRAUD -- Sells CRIME, buys FRAUD (sell cross-token)
6. BuyOnly FRAUD -- No disposal, buys FRAUD (overwrite test)

Each test:
- Funds the CarnageSolVault with 0.05 SOL
- Calls `force_carnage(target, action)` to set pending state
- Executes `execute_carnage_atomic` using the protocol-wide ALT for v0 transaction compression
- Captures pre/post snapshots of vault balances

**SOL budget:** 6 tests x 0.05 SOL = 0.3 SOL total

**Output:** `scripts/e2e/carnage-hunter.jsonl` (per-test results in JSON Lines format)

### Carnage in Overnight Runner

The overnight runner handles natural Carnage triggers (not forced). When `advanceEpochWithVRF` returns `carnageTriggered: true`:
- If atomic Carnage was bundled in TX3 (CARN-002 fix), `carnageExecutedAtomically: true` and no further action needed
- If atomic bundling was not available, `testForcedCarnage()` is called as a fallback

### Empty Carnage Vault (Expected Behavior -- Decision D8)

When the CarnageSolVault has zero SOL, Carnage execution is a graceful no-op:
- `execute_buy_swap` and `execute_sell_swap` both return `Ok(())` when amount = 0
- State still updates (target switches, trigger count increments)
- The system self-corrects as tax fees refill the vault over subsequent epochs
- **Operators: this is expected behavior, not a bug.** Empty Carnage logs do not indicate failure.

---

## Conversion Vault Operations

### Overview

The Conversion Vault replaces the former PROFIT AMM pools (CRIME/PROFIT, FRAUD/PROFIT) with a deterministic 100:1 fixed-rate conversion. Users convert 100 CRIME or 100 FRAUD into 1 PROFIT (and vice versa) with zero fees, zero slippage, and no AMM curve.

### Vault Health Checks

| Check | How to Verify | Expected |
|-------|--------------|----------|
| VaultConfig initialized | `anchor account VaultConfig [PDA]` | `conversion_rate: 100` |
| Vault CRIME balance | `spl-token balance [vault_crime]` | Sufficient for pending conversions |
| Vault FRAUD balance | `spl-token balance [vault_fraud]` | Sufficient for pending conversions |
| Vault PROFIT balance | `spl-token balance [vault_profit]` | Sufficient for pending conversions |
| Vault token accounts whitelisted | Transfer Hook whitelist check | All 3 vault accounts on whitelist |

### Vault Properties

- **No admin key**: VaultConfig has no update authority after initialization
- **One-shot init**: `initialize_vault` can only be called once (PDA already exists check)
- **PDA-derived token accounts**: vault_crime, vault_fraud, vault_profit derived from `[b"vault", mint.key()]`
- **Hardcoded mints**: Feature-gated (devnet vs mainnet addresses)
- **Leaf node**: Vault calls Token-2022 `transfer_checked` only. No CPI surface -- direct user calls only via `convert` instruction.

### Vault Monitoring

**Conversion event tracking:** Monitor `convert` instruction invocations via Helius webhook (add Conversion Vault program ID to monitored accounts). Each conversion emits logs showing the input mint, output mint, input amount, and output amount.

**Balance drift detection:** If vault token balances approach zero for any mint, conversions in that direction will fail. This is not a bug -- the vault must be seeded with sufficient tokens for both directions. Check balances periodically:

```bash
# Check all vault token account balances
spl-token balance --owner [VaultPDA] [CRIME_MINT]
spl-token balance --owner [VaultPDA] [FRAUD_MINT]
spl-token balance --owner [VaultPDA] [PROFIT_MINT]
```

### Vault in Program Upgrade Procedures (Squads)

During the pre-burn phase, the Conversion Vault upgrade authority follows the same Squads multisig procedure as the other 5 programs. Include the Conversion Vault program ID in all batch upgrade proposals and authority burn sequences.

---

## Devnet SOL Management

### Budget

- **Continuous runner:** ~1.5-3 SOL/day for the overnight runner at 288 epochs/day
- **Devnet faucet:** Rate-limited aggressively. The runner's auto-airdrop requests 2 SOL when balance drops below 2 SOL
- **User setup overhead:** 0.05 SOL (not 1 SOL) -- minimized for devnet conservation

### Auto-Airdrop Logic

The `checkAndAirdrop()` function in `overnight-runner.ts`:
1. Reads current wallet balance
2. If below `AIRDROP_THRESHOLD` (2 SOL), requests `AIRDROP_AMOUNT` (2 SOL)
3. Waits for confirmation
4. Silently catches faucet rate limit errors (non-fatal)

### Manual SOL Funding

```bash
source "$HOME/.cargo/env" && export PATH="/Users/mlbob/.local/share/solana/install/active_release/bin:$PATH"
solana airdrop 2 --url https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY --keypair keypairs/devnet-wallet.json
```

Check balance:
```bash
solana balance --url https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY --keypair keypairs/devnet-wallet.json
```

### SOL Conservation Strategies

- **Swap every 10th epoch** (not every epoch) -- saves 90% of swap SOL
- **0.003 SOL per swap** (minimal amount)
- **0.1 SOL WSOL budget** for the test user (covers ~33 swaps)
- **0.05 SOL per Carnage test** (minimal for pool swap)

---

## RPC Configuration (Helius)

### Environment Variables

| Variable | Location | Value |
|----------|----------|-------|
| `CLUSTER_URL` | `.env` (project root) | `https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY` |
| `HELIUS_API_KEY` | `.env` | *(your Helius API key)* |
| `COMMITMENT` | `.env` | `finalized` |
| `WALLET` | `.env` (default) | `keypairs/devnet-wallet.json` |
| `NEXT_PUBLIC_RPC_URL` | `app/.env.local` | Same Helius devnet URL |

### Connection Factory (`scripts/deploy/lib/connection.ts`)

The `loadProvider()` function constructs an Anchor provider from env vars:
- `CLUSTER_URL` -- RPC endpoint (default: `http://localhost:8899`)
- `WALLET` -- Path to wallet keypair JSON (default: `keypairs/devnet-wallet.json`)
- `COMMITMENT` -- Transaction commitment level (default: `"confirmed"`, use `"finalized"` for devnet/mainnet)

### Polling Optimization (POLLING_CONFIG -- Decision D6)

**Problem:** Frontend polling was consuming ~75K credits/day due to aggressive intervals (10-30s for data that changes every 5-30min) and expensive archival queries.

**Solution:** A planned `POLLING_CONFIG` object keyed by network:

```typescript
POLLING_CONFIG[network] = {
  currentSlot:   devnet ? 120_000 : 300_000,  // ms
  epochState:    devnet ? 60_000  : 300_000,
  carnageData:   devnet ? 60_000  : 300_000,
  tokenBalances: devnet ? 60_000  : 120_000,
}
```

**Six fixes for 91% credit reduction:**
1. Replace `useCarnageEvents` polling with Helius webhook (58% savings -- 43,200 credits/day eliminated)
2. `useCurrentSlot` interval: 10s -> 120s (devnet) / 300s (mainnet)
3. `useEpochState` interval: 10s -> 60s (devnet) / 300s (mainnet)
4. `useCarnageData` interval: 10s -> 60s (devnet) / 300s (mainnet)
5. `useTokenBalances` interval: 30s -> 60s (devnet) / 120s (mainnet), plus event-triggered refresh on swap/stake confirmation
6. Dev-mode RPC guard: double intervals or disable non-essential hooks when `NODE_ENV === 'development'`

**Note:** `usePoolPrices` uses WebSocket subscriptions (`onAccountChange`) -- this is already efficient and should NOT be changed to polling.

### Credit Usage Projections

| Component | Credits/Day | Credits/Month |
|-----------|-------------|---------------|
| Crank bot | ~3,168 | ~95,040 |
| Frontend (per DAU) | ~46/session | ~1,380/DAU/month |
| Helius Free Tier limit | -- | 1,000,000 |

**Upgrade trigger:** ~600 DAU -> Helius Developer ($49/mo, 10M credits)

---

## Monitoring and Alerting

### Health Check Endpoint

**Route:** `GET /api/health` (`app/app/api/health/route.ts`)

Verifies connectivity to:
1. **PostgreSQL** -- `SELECT 1` via Drizzle
2. **Solana RPC** -- `getSlot()` via Helius

**Responses:**
- `200 { status: "ok", checks: { postgres: true, solanaRpc: true } }` -- All healthy
- `503 { status: "degraded", checks: { postgres: false, solanaRpc: true } }` -- Partial failure

Railway polls this endpoint to determine service health (configured in `railway.toml`):
```toml
healthcheckPath = "/api/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### Helius Webhook Handler

**Route:** `POST /api/webhooks/helius` (`app/app/api/webhooks/helius/route.ts`)

Receives raw Solana transaction payloads from Helius, parses Anchor events from `logMessages`, and stores them in PostgreSQL:
- **Swap events** -> `swap_events` table (TX signature as PK, idempotent)
- **Epoch events** -> `epoch_events` table (unique on epoch_number)
- **Carnage events** -> `carnage_events` table (unique on epoch_number)
- **Candle aggregation** -> Upserts OHLCV candles at 6 resolutions (1m, 5m, 15m, 1h, 4h, 1d)
- **SSE broadcast** -> Pushes candle updates to connected frontend clients

**Security:** Optional `HELIUS_WEBHOOK_SECRET` authorization header check. If unset, auth is skipped (local testing).

**Error handling:** Per-transaction errors are logged but do not fail the batch. Helius expects a `200` response; returning `500` triggers Helius retry (exponential backoff, 24h window).

#### Webhook Setup Procedure

Use `scripts/webhook-manage.ts` to create/manage the Helius webhook:

```bash
# List existing webhooks
npx tsx scripts/webhook-manage.ts list

# Create the webhook (uses rawDevnet type, monitors Tax + Epoch programs)
HELIUS_API_KEY=$HELIUS_API_KEY HELIUS_WEBHOOK_SECRET="your-secret" npx tsx scripts/webhook-manage.ts create

# Update an existing webhook
npx tsx scripts/webhook-manage.ts update <webhookId>

# Delete a webhook
npx tsx scripts/webhook-manage.ts delete <webhookId>
```

The `create` command configures: `webhookType: "rawDevnet"`, `transactionTypes: ["ANY"]`, `accountAddresses` set to the Tax Program (`DRjNCjt4...`) and Epoch Program (`G6dmJTdC...`). Webhook URL defaults to `https://dr-fraudsworth-production.up.railway.app/api/webhooks/helius`. Set `HELIUS_WEBHOOK_SECRET` in both the create command and Railway env vars to enable authorization header validation.

### Dashboard Alerts (Recommended Thresholds)

| Service | Alert At | Action |
|---------|----------|--------|
| Helius credits | 80% of tier limit (800K free / 8M Developer) | Review which hooks consume most credits |
| Railway budget | $15/mo (Hobby) or $35/mo (Pro) | Right-size resources, check for memory leaks |
| Sentry errors | 4,000/mo (80% of free tier) | Review top errors, fix root causes |
| Wallet balance | < 5 SOL (devnet) | Manual airdrop or faucet |

---

## Troubleshooting

### VRF Timeout Recovery

**Symptom:** `advanceEpochWithVRF` fails because the oracle did not respond. The reveal instruction fails after 10 retry attempts (30 seconds of exponential backoff).

**Automatic recovery (built into `vrf-flow.ts`):**

1. **Wait for VRF timeout:** 300 slots at ~400ms/slot = ~120 seconds. The `VRF_TIMEOUT_SLOTS` constant matches the on-chain value.
2. **Create fresh randomness:** `Keypair.generate()` + `sb.Randomness.create()` -- the fresh randomness may get assigned to a different (working) oracle.
3. **Retry commit:** `retryRandomness.commitIx()` + `epochProgram.methods.retryEpochVrf()` -- replaces the stale VRF request on-chain.
4. **Wait for oracle:** 3 slots.
5. **Reveal + consume:** Normal TX3 flow with the fresh randomness.

**If the runner restarts after a crash mid-VRF:**

On the next run, the runner reads `stateBefore.vrfPending === true` and automatically enters recovery:
1. Attempts to reveal the stale randomness (oracle may have responded while the runner was down)
2. If reveal fails, waits for VRF timeout and creates fresh randomness via `retry_epoch_vrf`
3. Completes the transition normally

**Key insight:** Gateway rotation does NOT work for VRF recovery. Each randomness account is locked to a specific oracle. Only retry the default gateway, or create fresh randomness to potentially get a different oracle.

### Crank Catch-Up After Downtime (Decision D9)

**Symptom:** The crank bot was offline for an extended period. Many epochs were missed.

**What happens during downtime:**
- Swaps continue with stale tax rates (last confirmed rates remain in effect)
- Staking and unstaking work normally
- Rewards accumulate in `pending_rewards` (monotonically increasing `rewards_per_token_stored`)
- Carnage deadlines auto-expire after 300 slots
- No funds are locked

**Catch-up procedure:**
1. Restart the crank bot normally
2. Each missed epoch requires ~3 transactions (TX1 create, TX2 commit+trigger, TX3 reveal+consume)
3. The runner waits 760 slots between epochs, so catching up 100 missed epochs takes ~8.3 hours of wall-clock time
4. Staking rewards finalization is delayed (not lost) until catch-up completes

**Cost estimate for catch-up:**
- ~3 TXs per missed epoch x ~0.000005 SOL base fee = ~0.000015 SOL/epoch
- Plus VRF account rent for each randomness account (~0.002 SOL)
- Total: ~0.002 SOL per missed epoch
- 100 missed epochs = ~0.2 SOL

### Empty Carnage Vault

**Symptom:** Carnage triggers but does nothing (no buy, no burn, no sell). Logs show Carnage executed but vault balances unchanged.

**This is expected behavior (Decision D8):**
- When CarnageSolVault has 0 SOL, both `execute_buy_swap` and `execute_sell_swap` return `Ok(())` with zero amounts
- State still updates: target token switches, trigger counter increments
- The vault refills naturally as tax fees accumulate from user swaps
- No operator action required

**If the vault is consistently empty:**
- Check that tax distribution is working (swap events should show tax amounts > 0)
- Verify that the Carnage fund allocation is receiving its share of tax proceeds
- Fund the vault manually if needed for testing:

```bash
# Fund Carnage SOL vault with 0.1 SOL
# Mainnet CarnageSolVault PDA: 5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT
```

### WSOL Intermediary Failure Recovery

**Symptom:** Sell swaps fail because the WSOL intermediary account does not exist. This can happen if a previous sell flow crashed after closing the WSOL account but before reinitializing it.

**Recovery:** Re-run the `initialize_wsol_intermediary` instruction from the Tax Program. This recreates the WSOL token account at the PDA derived from `WSOL_INTERMEDIARY_SEED`, owned by `swap_authority`. The admin wallet pays rent. This is the same instruction used during initial protocol setup (step 19 of `initialize.ts`):

```bash
set -a && source .env && set +a && npx tsx scripts/deploy/initialize.ts
```

The initialize script is idempotent -- it will skip already-initialized accounts and only recreate the missing WSOL intermediary.

### Common Error Codes

| Error | Source | Meaning | Recovery |
|-------|--------|---------|----------|
| `VrfAlreadyPending` (0x1774) | Epoch Program | Previous VRF was never consumed | Wait for timeout (300 slots), `retry_epoch_vrf` with fresh randomness |
| `0x1780` | Switchboard | Oracle signature verification failed (stale/wrong oracle) | Do NOT rotate gateways. Wait for VRF timeout + fresh randomness |
| `AccountNotEnoughKeys` (3005) | Transfer Hook | Wrong remaining_accounts ordering for dual-hook pools | Check hook account ordering: `[INPUT hooks, OUTPUT hooks]` not `[side A, side B]` |
| `ConstraintOwner` | Anchor | Program compiled without `--features devnet` | Rebuild: `anchor build -p epoch_program -- --features devnet` |
| `Blockhash not found` | Solana RPC | v0 TX simulation rejected (known devnet issue) | Use `skipPreflight: true` + check `confirmation.value.err` |
| `InsufficientInput` | Tax Program | Post-tax amount is zero or below floor | Increase swap amount or check tax rate (high-tax side can eat 14%) |

---

## Infrastructure Management

### Railway

**Production URL:** `https://dr-fraudsworth-production.up.railway.app`

**Configuration (`railway.toml`):**
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm run --workspace app build"

[deploy]
startCommand = "npm run --workspace app start"
preDeployCommand = "npx tsx app/db/migrate.ts"
healthcheckPath = "/api/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

- **Builder:** NIXPACKS (auto-detects Node.js, installs deps, runs build)
- **Pre-deploy:** Runs database migrations before starting the app
- **Health check:** Railway pings `/api/health` every few seconds; 3 consecutive failures trigger restart
- **Restart policy:** Automatic restart on failure, up to 3 retries

**Key operational note (Decision D1):** The crank bot runs as a background worker on the SAME Railway instance as the frontend. No separate service, no PM2. Railway's built-in container restart provides sufficient supervision.

#### Deployment Procedure

The crank bot (`scripts/e2e/overnight-runner.ts`) is a standalone process invoked manually or via a separate process -- it is NOT spawned by the Next.js start command. Railway deploys the frontend automatically on push to `main`:

1. **Push to `main`** -- Railway detects the commit and starts a NIXPACKS build
2. **Build phase** -- `npm run --workspace app build` compiles the Next.js frontend
3. **Pre-deploy** -- `npx tsx app/db/migrate.ts` runs pending DB migrations (fails deploy if migration errors)
4. **Start** -- `npm run --workspace app start` launches the Next.js server
5. **Health check** -- Railway polls `GET /api/health` (120s timeout). 3 consecutive failures trigger restart (max 3 retries)

To run the crank bot on Railway as a separate service, create a second Railway service in the same project with a custom start command: `npx tsx scripts/e2e/overnight-runner.ts`. Set the same env vars (`CLUSTER_URL`, `HELIUS_API_KEY`, `WALLET` path, etc.). Railway's `ON_FAILURE` restart policy supervises it automatically.

### Helius

**Current plan:** Free tier (1M credits/month, 10 req/s, 1 webhook)

**Upgrade triggers (Decision D5):**

| DAU | Credits/Month | Required Plan | Monthly Cost |
|-----|---------------|---------------|-------------|
| 0-600 | < 1M | Free | $0 |
| 600-5,000 | 1M-10M | Developer | $49 |
| 5,000-10,000 | 10M+ | Business/Professional | $200-500 |

**Features in use:**
- Standard Solana RPC (all methods = 1 credit each)
- Raw devnet webhooks (monitor protocol program transactions)
- Priority fee estimation (planned for mainnet)

### Sentry

**Current plan:** Free tier (5,000 errors/month, 30-day retention)

**Integration:** Zero-dependency `app/lib/sentry.ts` -- raw HTTP POST envelopes to Sentry ingest API. No `@sentry/*` npm packages due to Turbopack SSR incompatibility.

**DSN configuration:** `NEXT_PUBLIC_SENTRY_DSN` env var (frontend) or `SENTRY_DSN` (server-side).

**Upgrade trigger:** Error volume exceeding 5,000/month -> Sentry Team ($26/month, 50K errors).

### PostgreSQL (Railway Plugin)

**Provisioning:** PostgreSQL is added as a Railway plugin in the project dashboard. Railway injects the `DATABASE_URL` env var automatically into the service.

**Schema:** Defined in `app/db/schema.ts` using Drizzle ORM -- 4 tables: `swap_events` (TX signature PK), `candles` (OHLCV at 6 resolutions), `epoch_events` (unique on epoch_number), `carnage_events` (unique on epoch_number).

**Migrations:** `app/db/migrate.ts` runs all pending SQL files from `app/db/migrations/` using Drizzle's programmatic migrator. Railway's `preDeployCommand` (`npx tsx app/db/migrate.ts`) executes this before every deploy. If migration fails, the deploy is aborted. To run manually:

```bash
DATABASE_URL="postgres://..." npx tsx app/db/migrate.ts
```

**Schema changes:** Edit `app/db/schema.ts`, then generate a migration with `npx drizzle-kit generate`. The generated SQL file in `app/db/migrations/` will be applied on next deploy.

### Cost Summary

| Milestone | Helius | Railway | PostgreSQL | Sentry | Domain | Total/Month |
|-----------|--------|---------|------------|--------|--------|-------------|
| Launch (10 DAU) | $0 | $5-10 | $1-3 | $0 | $1-2 | ~$7-15 |
| Growing (100 DAU) | $0 | $8-15 | $1-3 | $0 | $1-2 | ~$10-20 |
| Traction (1,000 DAU) | $49 | $15-30 | $3-8 | $0-26 | $1-2 | ~$68-115 |
| Success (10,000 DAU) | $200-500 | $30-60 | $8-20 | $26 | $1-2 | ~$265-608 |

Full analysis: `Docs/Infrastructure_Cost_Analysis_2026.md`

---

## Mainnet Operations (Current State)

### Authority State (as of 2026-03-25)

All program upgrade authorities and admin PDA authorities are held by the Squads 2-of-3 multisig vault (`4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ`), with a 3600-second (1-hour) timelock. Mint authorities for all 3 tokens (CRIME, FRAUD, PROFIT) have been permanently burned.

| Authority | Status | Holder |
|-----------|--------|--------|
| 6 Upgrade Authorities | Transferred | Squads vault (timelocked) |
| Whitelist Authority | Transferred | Squads vault (NOT burned -- retained for future flexibility) |
| AMM Admin | Transferred | Squads vault (retained for future plans) |
| BC Admin | N/A | Bonding Curve program closed post-graduation |
| CRIME Mint Authority | Burned | Irreversible |
| FRAUD Mint Authority | Burned | Irreversible |
| PROFIT Mint Authority | Burned | Irreversible |

See `Docs/mainnet-governance.md` for the full governance and burn protocol.

### Planned Authority Burn Sequence

Authorities will be burned progressively as the protocol proves stable:

1. Timelock extended from 1hr to 24hr after stability period
2. External audit (OtterSec or equivalent) completed
3. Authorities burned individually with explicit owner confirmation per authority
4. See `Docs/mainnet-governance.md` Section 8 for the complete burn protocol

### Current Operational Surface

- **Crank bot:** Running on Railway (`F84XUxo5VM8FJZeGvC3CrHYwLzFod3ep57CULjZ4ZXc1`). Permissionless -- anyone can crank.
- **SOL funding:** Crank wallet funded separately from deployer. Bounty (0.001 SOL/epoch) sustains gas.
- **Frontend:** Railway deploys on push to `main`. Domain: `fraudsworth.fun`.
- **Database:** PostgreSQL on Railway. Migrations run on each deploy.
- **Monitoring:** Sentry + UptimeRobot (3 monitors: frontend, API health, crank health).
- **RPC:** Helius Developer plan ($49/mo, 10M credits).

### Mainnet Checklist

Full switch-point inventory in `Docs/mainnet-checklist.md`. Key items:

| Component | Devnet | Mainnet Action |
|-----------|--------|----------------|
| `shared/constants.ts` PROGRAM_IDS | Devnet program IDs | Redeploy, update IDs |
| `shared/constants.ts` MINTS | Devnet mint addresses | Create mainnet mints, update |
| `shared/constants.ts` TREASURY_PUBKEY | Devnet wallet | Set mainnet treasury multisig |
| `useProtocolWallet.ts` chain | `"solana:devnet"` | Change to `"solana:mainnet"` |
| Explorer links | `?cluster=devnet` | Remove query param (mainnet default) |
| ALT | Mainnet: `7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h` | Created during mainnet deploy |
| Token metadata URIs | Railway placeholder endpoints | Host real metadata JSON with logos |

---

## Recovery Procedures

### Full Redeployment (Fresh Environment)

If all on-chain state is lost or you need to start from scratch:

```bash
# 1. Source environment
source "$HOME/.cargo/env" && export PATH="/Users/mlbob/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# 2. Build programs (with devnet feature for epoch_program and tax_program)
cd /Users/mlbob/Projects/Dr\ Fraudsworth
./scripts/deploy/build.sh --devnet

# 3. Deploy all 6 programs
./scripts/deploy/deploy.sh https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY

# 4. Initialize protocol (19-step idempotent sequence)
set -a && source .env && set +a && npx tsx scripts/deploy/initialize.ts

# 5. Verify deployment (runs 30+ checks)
set -a && source .env && set +a && npx tsx scripts/deploy/verify.ts

# 6. Start the crank bot
set -a && source .env && set +a && npx tsx scripts/e2e/overnight-runner.ts
```

### Initialize Script Details

`scripts/deploy/initialize.ts` executes 19 steps in strict dependency order:

1. Create 3 Token-2022 mints (CRIME, FRAUD, PROFIT) with TransferHook + MetadataPointer extensions
2. Initialize Transfer Hook WhitelistAuthority
3. Initialize ExtraAccountMetaList for each mint
4. Initialize AMM AdminConfig
5. Create admin token accounts + mint seed liquidity
6. Whitelist admin T22 accounts
7-8. Initialize 2 SOL AMM pools (CRIME/SOL, FRAUD/SOL)
9. Initialize Conversion Vault (100:1 fixed-rate CRIME/FRAUD <-> PROFIT)
10. Whitelist all pool vault addresses + vault token accounts (vault_crime, vault_fraud, vault_profit)
11. Initialize EpochState
12. Initialize StakePool (with dead stake of 1 PROFIT)
13. Whitelist StakeVault
14. Initialize Carnage Fund (3 vaults: SOL, CRIME, FRAUD)
15. Whitelist Carnage token vaults
16. Fund Carnage SOL vault with rent-exempt minimum
17. Create Carnage WSOL account (CarnageSigner PDA-owned)
18. Initialize WSOL Intermediary (sell tax extraction account)
19. Generate PDA manifest (`scripts/deploy/pda-manifest.json`)

**Idempotency:** Every step checks account existence on-chain before executing. Re-running after partial completion skips already-initialized accounts. Re-running after full completion skips all steps.

**Mint keypair persistence:** Mint keypairs are saved to `scripts/deploy/mint-keypairs/` on first run and reloaded on subsequent runs, ensuring pool PDAs (which depend on mint addresses) are consistent.

### Verify Deployment

`scripts/deploy/verify.ts` runs 30+ checks across all protocol components:

- 6 program deployments (existence + BPF Loader ownership)
- 3 mints (existence + decimals + supply + T22 ownership + TransferHook extension)
- Transfer Hook state (WhitelistAuthority + 3 ExtraAccountMetaLists)
- AMM state (AdminConfig + 2 pools with reserve verification + vault state verification)
- Epoch state (EpochState + CarnageFund + CarnageSolVault with balance)
- Staking state (StakePool + StakeVault with dead stake + EscrowVault)
- Whitelist entries (14 vault whitelist verifications, including 3 conversion vault token accounts)

**Output:** `scripts/deploy/deployment-report.md` with full results table.

### Sensitive Data Rotation

| Secret | Location | Rotation Procedure |
|--------|----------|--------------------|
| Helius API key | `.env`, `shared/constants.ts` | Regenerate in Helius dashboard, update both locations |
| Devnet wallet keypair | `keypairs/devnet-wallet.json` | Generate new: `solana-keygen new -o keypairs/devnet-wallet.json`, fund, re-deploy |
| Sentry DSN | `NEXT_PUBLIC_SENTRY_DSN` env var | Rotate in Sentry project settings |
| Helius webhook secret | `HELIUS_WEBHOOK_SECRET` env var | Rotate in Helius webhook config + Railway env vars |

**Note (Security Decision D14):** The `.mcp.json` key should be rotated periodically. The backend should proxy all RPC calls (never expose Helius API key to frontend directly in production). The Helius webhook secret should be set in production to prevent unauthorized webhook submissions.

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `scripts/e2e/overnight-runner.ts` | Main crank bot (epoch cycling, VRF, swaps, Carnage) |
| `scripts/e2e/carnage-hunter.ts` | Carnage path testing (6 forced test cases) |
| `scripts/vrf/lib/vrf-flow.ts` | 3-TX VRF epoch transition with recovery |
| `scripts/vrf/lib/epoch-reader.ts` | EpochState reader + tax rate verification |
| `scripts/deploy/lib/connection.ts` | Standalone Anchor provider factory |
| `scripts/deploy/initialize.ts` | 19-step protocol initialization (idempotent) |
| `scripts/deploy/verify.ts` | Post-deployment verification (30+ checks) |
| `scripts/deploy/build.sh` | Build script (anchor build + devnet features) |
| `scripts/deploy/deploy.sh` | Deploy script (6 programs, auto-airdrop) |
| `scripts/deploy/pda-manifest.json` | Generated PDA manifest (all addresses) |
| `shared/constants.ts` | Source of truth for seeds, IDs, fee constants |
| `app/lib/sentry.ts` | Zero-dependency Sentry error reporter |
| `app/app/api/health/route.ts` | Health check endpoint (Postgres + RPC) |
| `app/app/api/webhooks/helius/route.ts` | Helius webhook handler (events -> Postgres) |
| `app/next.config.ts` | Next.js config (CSP headers, Turbopack) |
| `railway.toml` | Railway deployment configuration |
| `.env` | Root env vars (Helius, cluster URL, commitment) |
| `app/.env.local` | Frontend env vars (RPC URL) |
| `keypairs/devnet-wallet.json` | Devnet deployer/crank wallet |
| `Docs/mainnet-checklist.md` | All devnet -> mainnet switch points |
| `Docs/Infrastructure_Cost_Analysis_2026.md` | Full infrastructure cost breakdown |
