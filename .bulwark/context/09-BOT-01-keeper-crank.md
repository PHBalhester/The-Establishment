---
task_id: db-phase1-bot-01
provides: [bot-01-findings, bot-01-invariants]
focus_area: bot-01
files_analyzed:
  - scripts/crank/crank-runner.ts
  - scripts/crank/crank-provider.ts
  - scripts/vrf/lib/vrf-flow.ts
  - scripts/vrf/lib/epoch-reader.ts
  - scripts/e2e/lib/carnage-flow.ts
  - scripts/e2e/lib/alt-helper.ts
  - scripts/e2e/overnight-runner.ts
  - scripts/e2e/lib/epoch-observer.ts
  - scripts/deploy/fix-carnage-wsol.ts
  - app/lib/ws-subscriber.ts
  - app/lib/protocol-store.ts
  - app/lib/sse-manager.ts
  - app/lib/sse-connections.ts
  - app/lib/credit-counter.ts
  - app/instrumentation.ts
  - app/app/api/health/route.ts
  - app/app/api/sse/protocol/route.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# BOT-01: Keeper & Crank Security — Condensed Summary

## Key Findings (Top 10)
- **No unhandledRejection handler**: Unhandled promise rejection in crank process causes silent crash without error logging — `scripts/crank/crank-runner.ts` (missing)
- **No distributed lock / singleton enforcement**: Two crank instances can run simultaneously, causing double epoch transitions, double vault top-ups, and duplicate VRF requests — `scripts/crank/crank-runner.ts` (H091 ACCEPTED_RISK, still absent)
- **Private key in plaintext env var**: WALLET_KEYPAIR loaded from Railway environment variable as raw JSON byte array; visible in process listings, env dumps, and container inspection — `scripts/crank/crank-provider.ts:41-57`
- **No external alerting on circuit breaker trip**: Circuit breaker logs to stdout only; no webhook, PagerDuty, or Slack notification when crank halts — `scripts/crank/crank-runner.ts:535-539`
- **Recovery path does not attempt atomic Carnage**: VRF recovery path (stale VRF or timeout) always returns `carnageExecutedAtomically: false`, leaving MEV gap open for Carnage triggered during recovery — `scripts/vrf/lib/vrf-flow.ts:644`
- **Error truncation to 300 chars loses Anchor logs**: Error messages sliced at 300 chars, discarding Anchor `.logs` property that contains on-chain program logs — `scripts/crank/crank-runner.ts:529` (H089 NOT_FIXED)
- **ws-subscriber setInterval polls lack overlap protection**: Supply poll (60s) and staker gPA poll (30s) use bare setInterval; if an RPC call takes longer than the interval, concurrent calls pile up — `app/lib/ws-subscriber.ts:360,430`
- **Spending cap uses estimated cost, not actual cost**: recordSpend() uses ESTIMATED_TX_COST_LAMPORTS (10k) per TX, not actual consumed fee; large priority fees or CU consumption could exceed the cap without detection — `scripts/crank/crank-runner.ts:110,500`
- **Health endpoint exposes internal status publicly**: /health returns wsSubscriber internal state, RPC credit stats, and dependency health without authentication — `app/app/api/health/route.ts:66-72` (H028 NOT_FIXED)
- **COMMITMENT env var cast without validation**: COMMITMENT env var cast directly to `anchor.web3.Commitment` type without runtime validation; invalid values cause runtime errors — `scripts/crank/crank-provider.ts:37`

## Critical Mechanisms
- **Crank Main Loop**: While-loop with graceful shutdown (SIGINT/SIGTERM), reading EpochState, waiting for epoch boundary, then calling advanceEpochWithVRF. Circuit breaker halts after 5 consecutive errors. Hourly spending cap (0.5 SOL) tracked via in-memory log — `scripts/crank/crank-runner.ts:390-553`
- **VRF 3-TX Flow**: TX1 creates randomness account (finalized wait), TX2 bundles commit + trigger_epoch_transition, TX3 bundles reveal + consume_randomness + executeCarnageAtomic (v0 VersionedTransaction with ALT). Recovery path handles stale VRF (reveal stale or timeout+retry) — `scripts/vrf/lib/vrf-flow.ts:377-922`
- **Vault Top-Up**: Detects carnage_sol_vault below rent-safe threshold (~2M lamports), tops up with capped 5M lamports (0.005 SOL), max 0.1 SOL per top-up. Spending cap checked before each top-up — `scripts/crank/crank-runner.ts:418-448`
- **ws-subscriber Server Pipeline**: Instrumentation.ts init() seeds protocolStore via batch getMultipleAccountsInfo, then starts 4 concurrent pipelines: WS slot subscription, 60s supply poll, 30s staker gPA poll, 10s staleness monitor. globalThis singleton pattern survives Next.js HMR — `app/lib/ws-subscriber.ts:450-475`

## Invariants & Assumptions
- INVARIANT: Circuit breaker halts crank after 5 consecutive errors — enforced at `scripts/crank/crank-runner.ts:535`
- INVARIANT: Hourly spending cap of 0.5 SOL — enforced at `scripts/crank/crank-runner.ts:141`
- INVARIANT: Vault top-up capped at 0.1 SOL per operation — enforced at `scripts/crank/crank-runner.ts:82,421`
- INVARIANT: ws-subscriber only initializes once (globalThis + initialized flag) — enforced at `app/lib/ws-subscriber.ts:94-107,456`
- INVARIANT: SSE connections capped at 10/IP and 5000 global — enforced at `app/lib/sse-connections.ts:49-56`
- ASSUMPTION: Only one crank instance runs at a time — NOT ENFORCED (no distributed lock, H091)
- ASSUMPTION: Railway process restarts automatically on crash — UNVALIDATED (no explicit health check failure triggers restart)
- ASSUMPTION: WALLET_KEYPAIR env var is not accessible to other Railway services/users — TRUST IN PLATFORM
- ASSUMPTION: Switchboard oracle responds within 300 slots (VRF_TIMEOUT_SLOTS) — validated at `scripts/vrf/lib/vrf-flow.ts:498,748` with recovery fallback
- ASSUMPTION: Epoch slots constant matches on-chain (750 devnet / 4500 mainnet) — auto-detected at `scripts/crank/crank-runner.ts:270-276` with override support

## Risk Observations (Prioritized)
1. **No distributed lock (H091)**: Two simultaneous crank instances double-spend SOL on VRF transactions, create duplicate randomness accounts, and race on epoch transitions. TOCTOU handling exists in vrf-flow.ts (VRF-04) but does not prevent wasted gas or vault double-top-up. `scripts/crank/crank-runner.ts` — ACCEPTED_RISK per Audit #1, but mainnet deployment increases blast radius
2. **No external alerting (H004 PARTIALLY_FIXED)**: Circuit breaker logs to console.error only. On Railway, this goes to log aggregation, but there is no push notification (Slack, PagerDuty, email). If crank halts overnight, epochs stop advancing, stakers stop earning, and nobody is notified. `scripts/crank/crank-runner.ts:535-539`
3. **Private key as env var (AIP-138)**: WALLET_KEYPAIR env var contains full signing keypair as plaintext JSON array. Any supply chain attack, environment dump, or Railway dashboard compromise exposes the crank wallet. CVE-2024-54134 specifically targeted this pattern. `scripts/crank/crank-provider.ts:41-57`
4. **Recovery path leaves Carnage MEV gap**: VRF recovery (stale or timeout) does not attempt atomic Carnage bundling. If VRF triggers Carnage during recovery, the carnage_pending flag is set on-chain, visible to MEV bots who can sandwich the subsequent execute_carnage call. `scripts/vrf/lib/vrf-flow.ts:644`
5. **ws-subscriber poll overlap**: setInterval-based supply and staker polls have no overlap guard. A slow RPC response (>30s for gPA) allows the next interval to fire concurrently, creating unbounded parallel RPC calls. `app/lib/ws-subscriber.ts:360,430`

## Novel Attack Surface
- **VRF TOCTOU double-spend**: If an attacker deploys a second crank-like bot that races the legitimate crank, both can successfully create randomness accounts (TX1) and submit commit+trigger transactions (TX2). Only one TX2 succeeds on-chain (VrfAlreadyPending gate), but both pay SOL for TX1. Over thousands of epochs, this silently drains the crank wallet via wasted TX fees while appearing as normal VRF errors in logs.
- **Vault top-up as griefing vector**: The carnage_sol_vault top-up logic is triggered when vault balance drops below ~2M lamports. An attacker who can drain the vault (via rapid Carnage triggers or other means) could force the crank to repeatedly top up, amplifying the spending rate. The 0.1 SOL/operation cap and 0.5 SOL/hour cap limit this, but a sustained attack over days could drain the crank wallet.

## Cross-Focus Handoffs
- → **SEC-01 (Access Control)**: Crank wallet private key stored as plaintext env var (WALLET_KEYPAIR). Assess Railway platform security model and whether KMS-based signing is feasible.
- → **ERR-01 (Error Handling)**: Missing unhandledRejection handler in crank-runner.ts. Process can silently exit on unhandled promise rejection without logging.
- → **INFRA-03 (Infrastructure)**: No external alerting mechanism for circuit breaker trips. Railway health check only checks HTTP response, not crank operational state.
- → **ERR-02 (Race Conditions)**: ws-subscriber setInterval polls lack overlap protection. Concurrent RPC calls can stack up during slow responses.

## Trust Boundaries
The crank runner operates in the Sensitive Zone of the protocol's trust model. It holds a signing keypair that can spend SOL (vault top-ups, TX fees) and advance protocol state (epoch transitions, VRF, Carnage execution). The trust boundary is between the Railway environment (where the keypair lives as an env var) and the Solana blockchain (where transactions are submitted). A compromised crank wallet cannot steal user funds (on-chain CPI gates prevent unauthorized program calls), but it can halt epoch advancement (by draining its SOL balance), submit incorrect Carnage timing (no per-instruction program allowlist), and leak the private key (via environment access). The secondary trust boundary is between the ws-subscriber (server-side data pipeline) and the protocol store / SSE layer: corrupted RPC responses flow unchecked from Helius into the in-memory cache and out to all SSE clients, though this only affects display data, not transaction construction.
<!-- CONDENSED_SUMMARY_END -->

---

# BOT-01: Keeper & Crank Security — Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol runs a single automated crank process on Railway that advances epochs via Switchboard VRF, atomically executes Carnage buyback-and-burn events, and tops up the Carnage SOL vault. The crank is the protocol's operational heartbeat — if it stops, epochs freeze, tax rates stagnate, stakers stop earning yield, and Carnage events cease.

The crank implementation is well-structured with multiple defense layers from Audit #1 findings (circuit breaker H019, spending cap H019, vault top-up cap H013, RPC URL masking H058). However, several gaps remain from previous audit cycles (H004 no external alerting, H031 no unhandledRejection, H091 no distributed lock, H089 error truncation) and the private key storage pattern matches AIP-138 (plaintext env var).

A secondary automation layer exists in the frontend: the ws-subscriber server-side pipeline runs setInterval-based polls for token supply and staker data. This layer has overlap protection gaps (AIP-136 pattern).

## Scope

### Primary Files (Deep Analysis)
1. `scripts/crank/crank-runner.ts` (569 LOC) — Main crank process
2. `scripts/crank/crank-provider.ts` (178 LOC) — Wallet/provider/manifest loading
3. `scripts/vrf/lib/vrf-flow.ts` (923 LOC) — VRF 3-TX flow + recovery
4. `scripts/vrf/lib/epoch-reader.ts` (251 LOC) — EpochState reading + tax verification
5. `app/lib/ws-subscriber.ts` (496 LOC) — Server-side data pipeline
6. `app/lib/protocol-store.ts` (126 LOC) — In-memory protocol state cache

### Secondary Files (Signature + Key Sections)
7. `scripts/e2e/lib/carnage-flow.ts` (194 LOC) — Carnage test flow
8. `scripts/e2e/lib/alt-helper.ts` — ALT management
9. `scripts/e2e/overnight-runner.ts` — Deprecated crank predecessor
10. `scripts/e2e/lib/epoch-observer.ts` — Epoch observation
11. `scripts/deploy/fix-carnage-wsol.ts` (152 LOC) — WSOL repair script
12. `app/instrumentation.ts` (30 LOC) — Server boot hook
13. `app/app/api/health/route.ts` (74 LOC) — Health endpoint
14. `app/lib/sse-connections.ts` (119 LOC) — SSE connection tracking
15. `app/lib/sse-manager.ts` (93 LOC) — SSE pub/sub
16. `app/lib/credit-counter.ts` (69 LOC) — RPC credit tracking

## Key Mechanisms

### 1. Crank Runner Main Loop (`crank-runner.ts:390-553`)

The crank runs as a continuous while-loop gated by a `shutdownRequested` flag:

```
while (!shutdownRequested) {
  1. Read EpochState (current epoch, VRF status)
  2. Check wallet balance (log warning if low)
  3. Check vault balance (top up if below threshold)
  4. Calculate slots to wait for epoch boundary
  5. Wait for slot advancement
  6. Call advanceEpochWithVRF()
  7. Record spend + reset circuit breaker
  8. Log JSON entry to stdout
}
```

**5 Whys on the main loop design:**
1. Why a while-loop not cron? Because epoch boundaries are slot-based (non-deterministic wall-clock time), cron can't align to on-chain state.
2. Why check vault balance every cycle? To prevent the rent-bug danger zone (H017/FIN-03) where vault balance falls between bounty amount and rent-exempt minimum.
3. Why use estimated TX costs not actual? Because the crank doesn't read actual fee receipts post-transaction — this is a simplification.
4. Why log JSON to stdout? Railway captures stdout as structured logs automatically.
5. Why would this fail? If RPC is consistently unreachable, circuit breaker trips after 5 errors (30s between retries = ~2.5 min to halt). If errors are intermittent, they reset on success and the crank continues.

### 2. VRF 3-TX Flow (`vrf-flow.ts:377-922`)

The epoch advancement flow executes three separate transactions:

**TX1: Create Randomness Account**
- Generates fresh Keypair
- Calls `sb.Randomness.create()` to build the create instruction
- Sends with `skipPreflight: true` (Switchboard SDK LUT staleness issue)
- **Waits for FINALIZATION** (not just confirmation) — critical for TX2's client-side account read

**TX2: Commit + Trigger**
- `commitIx()` reads the randomness account client-side
- Bundles with `triggerEpochTransition` instruction
- 400,000 CU compute budget

**TX3: Reveal + Consume + CarnageAtomic**
- Gets reveal instruction from Switchboard oracle gateway (up to 10 retries with 3s exponential backoff)
- Bundles reveal + consumeRandomness + executeCarnageAtomic in a single v0 VersionedTransaction
- The on-chain no-op guard on executeCarnageAtomic makes this safe when Carnage doesn't trigger
- 600,000 CU compute budget
- **This is the CARN-002 MEV gap closure** — no CarnagePending event is visible on-chain before the swap

**Recovery Paths:**
- **Stale VRF recovery** (line 420-646): If `vrfPending=true` from a previous failed flow, tries to reveal the stale randomness first. If that fails, waits for VRF_TIMEOUT_SLOTS (300), creates fresh randomness, and uses `retry_epoch_vrf`.
- **Oracle failure recovery** (line 736-832): If reveal fails after 10 attempts on normal path, falls back to timeout recovery with fresh randomness.
- **TOCTOU handling** (VRF-04, lines 447-487, 565-602): If another crank instance already consumed the randomness, detects "already consumed" signals and reads final state instead of throwing.

**Critical observation**: Recovery paths do NOT attempt atomic Carnage bundling (`carnageExecutedAtomically: false` always returned). If Carnage triggers during recovery, the MEV gap is open.

### 3. Wallet Loading (`crank-provider.ts:34-87`)

Three-tier priority:
1. `WALLET_KEYPAIR` env var (JSON array string) — used on Railway
2. `WALLET` env var (file path)
3. `keypairs/devnet-wallet.json` (committed, devnet only)

**AIP-138 concern**: Option 1 stores the full 64-byte secret key as a plaintext JSON array in a Railway environment variable. This is the standard AI-generated pattern that CVE-2024-54134 (December 2024 `@solana/web3.js` supply chain attack) specifically targeted.

The key is loaded into memory once at startup and held for the process lifetime. No rotation mechanism exists. The error message on parse failure truncates to 100 chars (good — avoids leaking key material).

### 4. Vault Top-Up (`crank-runner.ts:413-448`)

Checks carnage_sol_vault balance every cycle. If below `MIN_VAULT_BALANCE` (~2M lamports):
- Caps top-up at `MAX_TOPUP_LAMPORTS` (0.1 SOL) — H013 fix
- Checks spending cap before sending — prevents drain
- Sends SystemProgram.transfer from crank wallet to vault

**5 Hows on vault top-up:**
1. How does it work? Balance check → cap → spend check → transfer
2. How could it be exploited? If vault is repeatedly drained (by rapid Carnage or external drain), crank repeatedly tops up. 0.5 SOL/hour cap limits damage.
3. How does it interact with other components? Carnage execution draws SOL from vault; crank replenishes it. Race condition possible if Carnage fires between balance check and top-up (harmless — just a redundant top-up).
4. How could it fail? If crank wallet balance < top-up amount, the SystemProgram.transfer fails, incrementing consecutiveErrors.
5. How would an attacker approach this? Trigger maximum Carnage events to drain vault rapidly, forcing crank to hit spending cap. Not practical: Carnage ~4.3% probability per epoch.

### 5. ws-subscriber Data Pipeline (`ws-subscriber.ts:450-475`)

Server-side pipeline initialized from `instrumentation.ts` on Next.js server boot:

1. **Batch Seed** (lines 113-243): `getMultipleAccountsInfo` for 8 protocol PDAs, `getTokenSupply` for CRIME/FRAUD, `getSlot`, `getProgramAccounts` for staker stats
2. **Slot Subscription** (lines 250-272): WS `onSlotChange` with 5s broadcast throttle
3. **Supply Poll** (lines 329-362): setInterval every 60s, parallel `getTokenSupply`
4. **Staker Poll** (lines 368-431): setInterval every 30s, `getProgramAccounts` with decode
5. **Staleness Monitor** (lines 299-323): setInterval every 10s, detects WS death after 15s, activates HTTP fallback

**AIP-136 concern**: Supply poll (60s interval) and staker poll (30s interval) use bare `setInterval` without overlap guards. If RPC responds slowly (>30s for gPA), the next interval fires while the previous is still awaiting. This creates unbounded concurrent RPC calls.

## Trust Model

### Crank Trust Boundaries

```
[Railway Platform] ─── env vars ──→ [Crank Process] ─── signed TXs ──→ [Solana RPC] ──→ [On-Chain Programs]
       │                                    │
       │ WALLET_KEYPAIR                     │ console.log/error
       │ CLUSTER_URL                        │
       │ PDA_MANIFEST                       ▼
       │                              [Railway Logs]
       ▼
  [Railway Dashboard]
```

- **Railway Platform → Crank**: Trust that Railway env vars are not exposed to unauthorized parties. This is the weakest link — Railway dashboard compromise (H132 ACCEPTED_RISK) would expose the signing key.
- **Crank → Solana**: The crank signs transactions with the loaded keypair. On-chain CPI gates prevent the crank wallet from performing unauthorized operations (e.g., cannot call AMM::swap_sol_pool directly — only through Tax Program's swap_authority PDA). However, the crank CAN:
  - Call `triggerEpochTransition` (permissionless)
  - Call `consumeRandomness` (permissionless)
  - Call `executeCarnageAtomic` (permissionless, within lock window)
  - Transfer SOL from crank wallet to vault
  - Create Switchboard randomness accounts (pays rent)
- **Crank → Logs**: All output goes to stdout/stderr. RPC URL is masked (H058 fix). Wallet pubkey is truncated in logs. No secrets in log output.

### ws-subscriber Trust Boundaries

```
[Helius RPC] ─── WS/HTTP ──→ [ws-subscriber] ──→ [protocolStore] ──→ [sseManager] ──→ [Browser SSE Clients]
```

- **Helius → ws-subscriber**: Anchor account decoding validates data structure, but a malicious RPC endpoint could return crafted account data. This only affects display (no signing decisions made from this data).
- **protocolStore → SSE**: Dedup guard prevents broadcast spam. Connection limits prevent DoS.

## State Analysis

### In-Memory State (No Persistence)

| Component | State | Persistence | Risk |
|-----------|-------|-------------|------|
| Crank: consecutiveErrors | Counter (0-5) | None — resets on restart | Low |
| Crank: spendingLog | Array of {lamports, timestamp} | None — resets on restart | Medium (spending cap resets on crash) |
| Crank: shutdownRequested | Boolean flag | None | Low |
| ws-subscriber: state | WsSubscriberState object | globalThis (survives HMR) | Low |
| protocolStore: accounts | Map<string, AccountState> | globalThis | Low |
| sseManager: subscribers | Set<SSECallback> | globalThis | Low |
| sseConnections: state | Map<string, number> + globalCount | globalThis | Medium |
| creditCounter: stats | Counters | globalThis | Low |

**Key observation**: The spending cap log is in-memory. If the crank process crashes and restarts, the spending log is empty, effectively resetting the hourly cap. An attacker who can crash the crank (e.g., via RPC poisoning) can reset the spending cap repeatedly.

### Environment Variables (Crank)

| Variable | Required | Sensitive | Validated |
|----------|----------|-----------|-----------|
| CLUSTER_URL | Yes | Yes (API key in URL) | URL format only |
| COMMITMENT | No (default: confirmed) | No | NO — cast directly to Commitment type |
| PDA_MANIFEST | Yes | No | JSON.parse (throws on invalid) |
| WALLET_KEYPAIR | Conditional | **CRITICAL** | JSON.parse + Uint8Array conversion |
| WALLET | Conditional | No (file path) | fs.existsSync check |
| CARNAGE_WSOL_PUBKEY | Yes | No | PublicKey constructor (throws on invalid) |
| MIN_EPOCH_SLOTS_OVERRIDE | No | No | parseInt + NaN/<=0 check |
| CRANK_LOW_BALANCE_SOL | No | No | parseFloat + NaN/<=0 check |
| HEALTH_PORT | No (default: 8080) | No | parseInt only |

## Dependencies

### External APIs
- **Helius RPC** (CLUSTER_URL): All RPC calls go through Helius. Rate limits: 50 RPS shared with frontend.
- **Switchboard On-Demand SDK** (@switchboard-xyz/on-demand): VRF randomness creation, commit, and reveal. Dynamic program ID resolution via `getProgramId()` and `getDefaultQueue()`.

### NPM Packages (Security-Relevant)
- `@switchboard-xyz/on-demand`: Switchboard SDK. Pinned version in package-lock.json.
- `@coral-xyz/anchor`: Anchor client. Used for program interaction.
- `@solana/web3.js`: Core Solana interaction. Subject to CVE-2024-54134 (supply chain attack in December 2024).
- `@solana/spl-token`: Token program interaction.

## Focus-Specific Analysis

### OC-246: Automated Signing Without Approval

The crank signs all transactions automatically without any approval mechanism. This is by design (autonomous crank), but the signing is NOT gated by a program allowlist.

**Analysis**: The crank constructs instructions targeting specific programs (epoch_program, Switchboard). The instruction construction is deterministic from the loaded IDL and manifest. There is no path for user input or external data to alter the target program ID. However, if the PDA_MANIFEST env var is poisoned (e.g., via Railway dashboard compromise), the crank could be directed to sign transactions against attacker-controlled programs.

**Risk**: Medium. Manifest poisoning requires Railway access, which is already a critical compromise.

### OC-247: No Fund Limit Per Operation

**Analysis**: The crank has per-operation limits:
- Vault top-up: MAX_TOPUP_LAMPORTS = 0.1 SOL per top-up (`crank-runner.ts:82`)
- Estimated TX cost: 10,000 lamports per TX (`crank-runner.ts:110`)
- Hourly cap: 0.5 SOL rolling window (`crank-runner.ts:104`)

These are well-implemented. The gap is that TX costs are estimated, not actual.

### OC-248: No Kill Switch / Emergency Shutdown

**Analysis**: The crank has two shutdown mechanisms:
1. **SIGINT/SIGTERM** (`crank-runner.ts:196-206`): Graceful shutdown. Sets flag, finishes current cycle.
2. **Circuit breaker** (`crank-runner.ts:535-539`): Auto-halt after 5 consecutive errors.

There is NO remote kill switch. To stop the crank, you must:
- SSH into Railway container and send SIGTERM, OR
- Redeploy with a different configuration, OR
- Delete the Railway service

**Risk**: Medium. No remote kill switch means emergency response requires Railway dashboard access.

### OC-249: Infinite Retry on Failed Operations

**Analysis**: The crank does NOT retry infinitely:
- Main loop retries after `ERROR_RETRY_DELAY_MS` (30s)
- Circuit breaker halts after 5 consecutive errors
- VRF reveal has bounded retries (10 attempts with exponential backoff)
- VRF timeout recovery is bounded by VRF_TIMEOUT_SLOTS (300 slots)

This is well-implemented. The 30s retry delay prevents rapid gas consumption.

### OC-250: Fee Escalation in Retry Loop

**Analysis**: The crank does not implement priority fee bidding. All transactions use base fee (5,000 lamports). No fee escalation occurs on retry. This is safe — but means transactions may not land during congestion.

### OC-251: No Monitoring/Alerting on Failures

**Analysis**: This is a confirmed gap (H004 PARTIALLY_FIXED):
- Circuit breaker trips are logged to stderr
- Wallet balance warnings are logged to stdout
- Railway captures logs, but there is no push notification
- No integration with PagerDuty, OpsGenie, Slack, or email

The health endpoint (`crank-runner.ts:163-190`) exposes status via HTTP, but no monitoring system polls it. The Railway health check only verifies the HTTP server responds, not that the crank is operationally healthy.

### OC-252: Non-Idempotent Automated Operation

**Analysis**: Epoch transitions are inherently idempotent at the on-chain level — `triggerEpochTransition` fails with `EpochBoundaryNotReached` if called too early. The VRF-04 TOCTOU handling gracefully detects when another instance already consumed the randomness.

However, vault top-ups are NOT idempotent — if two crank instances both detect low vault balance and both send top-ups, the vault gets double the intended amount. This is bounded by the spending cap but still wasteful.

### OC-264: Cron Job Overlap / No Lock

**Crank runner**: No overlap protection because the loop is sequential (awaits each step). However, MULTIPLE crank instances have no coordination (H091).

**ws-subscriber**: The setInterval-based polls (supply every 60s, stakers every 30s) lack overlap guards. If the RPC call takes longer than the interval, a new call fires while the previous is still pending. This could create unbounded parallel RPC calls during slow RPC conditions.

### OC-265: Keeper Operating on Stale State

**Analysis**: The crank reads EpochState at the start of each cycle and uses `confirmed` commitment. The state could change between the read and the action (e.g., another crank instance advances the epoch), but on-chain constraints catch this:
- `EpochBoundaryNotReached` if epoch already advanced
- `VrfAlreadyPending` if VRF already committed
- VRF-04 TOCTOU detection if randomness already consumed

The ws-subscriber has a staleness monitor that detects WS death after 15s and activates HTTP fallback. This is good practice.

## Cross-Focus Intersections

### BOT-01 × SEC-01 (Access Control)
The crank wallet keypair is the single most sensitive secret in the off-chain infrastructure. Its compromise gives an attacker the ability to sign any transaction from the crank wallet address. While on-chain CPI gates prevent unauthorized program calls, the attacker could:
- Drain the crank wallet via arbitrary SystemProgram transfers
- Halt epoch advancement by exhausting SOL
- Potentially front-run Carnage events during recovery paths

### BOT-01 × CHAIN-02 (RPC Trust)
The crank trusts RPC responses for epoch state reading, slot counting, and vault balance checking. A malicious RPC endpoint could return stale epoch state (causing premature transition attempts), incorrect slot values (causing incorrect wait calculations), or incorrect vault balance (causing unnecessary top-ups or skipping needed top-ups).

### BOT-01 × ERR-02 (Error Handling)
Error truncation to 300 chars (H089) loses critical Anchor `.logs` data. The circuit breaker counts consecutive errors but does not distinguish between transient (RPC timeout) and permanent (program error) failures. A permanent error (e.g., IDL mismatch after upgrade) still gets 5 retries over ~2.5 minutes before halting.

### BOT-01 × INFRA-03 (Infrastructure)
The crank health endpoint binds to 0.0.0.0:8080 on Railway. While Railway doesn't assign a public domain to this port by default, it's accessible from within Railway's internal network. The endpoint exposes:
- Circuit breaker status
- Consecutive error count
- Hourly spend amount
- Uptime and last success timestamp

This is useful for monitoring but could leak operational intelligence if exposed.

## Cross-Reference Handoffs

| Handoff To | Item | Context |
|-----------|------|---------|
| SEC-01 | Crank wallet keypair as env var | AIP-138. Assess Railway platform security model |
| SEC-02 | PDA_MANIFEST env var integrity | Poisoned manifest could redirect crank to attacker programs |
| ERR-01 | Missing unhandledRejection handler | H031 NOT_FIXED. Silent crank death |
| ERR-02 | ws-subscriber poll overlap | setInterval without isProcessing guard |
| INFRA-03 | No external alerting | H004 PARTIALLY_FIXED. Circuit breaker notification gap |
| INFRA-05 | Health endpoint public exposure | H028 NOT_FIXED. Internal status accessible without auth |
| CHAIN-05 | skipPreflight on randomness creation | Required for Switchboard SDK compatibility, but prevents pre-flight error detection |

## Risk Observations

### HIGH

**BOT-01-R1: No distributed lock for crank singleton enforcement (H091)**
- File: `scripts/crank/crank-runner.ts` (entire file)
- Impact: Two simultaneous crank instances cause double VRF requests (wasted SOL), double vault top-ups, and race conditions on epoch state. The VRF-04 TOCTOU handling prevents functional errors but not financial waste.
- Likelihood: Possible (Railway deployment overlap, accidental double-start)
- Mitigation: On-chain state constraints catch most functional issues. Spending cap limits financial damage.
- Previous status: H091 ACCEPTED_RISK in Audit #1

**BOT-01-R2: No external alerting on critical events (H004 PARTIALLY_FIXED)**
- File: `scripts/crank/crank-runner.ts:535-539`
- Impact: Circuit breaker trip, spending cap breach, wallet exhaustion — all logged to stdout only. No push notification. Epochs stop advancing, stakers stop earning, Carnage stops firing. Discovery depends on manual log monitoring or user reports.
- Likelihood: Probable (any sustained RPC outage triggers circuit breaker)
- Previous status: H004 PARTIALLY_FIXED in Audit #1

**BOT-01-R3: Recovery path Carnage MEV gap**
- File: `scripts/vrf/lib/vrf-flow.ts:644`
- Impact: When VRF recovery path triggers Carnage, the `carnagePending` flag is set on-chain but Carnage is NOT executed atomically. MEV bots can observe the flag and sandwich the subsequent Carnage execution. The recovery path explicitly returns `carnageExecutedAtomically: false`.
- Likelihood: Unlikely (requires VRF failure coinciding with Carnage trigger — both are uncommon events)
- Financial impact: MEV extraction from Carnage swap (bounded by on-chain 50% output floor)

### MEDIUM

**BOT-01-R4: Private key as plaintext environment variable (AIP-138)**
- File: `scripts/crank/crank-provider.ts:41-57`
- Impact: Railway dashboard compromise, supply chain attack, or process inspection exposes the crank wallet private key. Attack surface: Railway dashboard users, npm supply chain (CVE-2024-54134), container escape.
- Likelihood: Unlikely (requires platform compromise)
- Mitigation: Key is loaded once, not logged. Railway encrypts env vars at rest.

**BOT-01-R5: ws-subscriber poll overlap (AIP-136)**
- File: `app/lib/ws-subscriber.ts:360,430`
- Impact: Slow RPC responses cause concurrent poll execution, creating unbounded parallel RPC calls that can exhaust Helius credits and violate rate limits.
- Likelihood: Possible (network degradation causes slow RPC)
- Mitigation: Credit counter tracks calls but doesn't enforce limits

**BOT-01-R6: Spending cap resets on process restart**
- File: `scripts/crank/crank-runner.ts:117`
- Impact: The spendingLog array is in-memory only. Process crash + restart resets the hourly cap, allowing up to 2x the intended hourly spend if restart happens mid-window.
- Likelihood: Possible (Railway restarts processes)
- Mitigation: The 0.5 SOL/hour cap has 50x headroom over normal usage

**BOT-01-R7: Missing unhandledRejection handler (H031)**
- File: `scripts/crank/crank-runner.ts` (missing)
- Impact: An unhandled promise rejection (e.g., from an async operation that escapes try/catch) causes the Node.js process to exit without logging the error. From Node.js v15+, unhandled rejections crash the process by default.
- Likelihood: Unlikely (main loop has try/catch, but edge cases exist)

**BOT-01-R8: Error truncation loses diagnostic data (H089)**
- File: `scripts/crank/crank-runner.ts:529`
- Impact: `String(err).slice(0, 300)` discards Anchor `.logs` array containing on-chain program logs. Makes debugging on-chain failures significantly harder.
- Likelihood: Certain (every error is truncated)

### LOW

**BOT-01-R9: Health endpoint exposes internals (H028)**
- File: `app/app/api/health/route.ts:66-72`
- Impact: Unauthenticated access to wsSubscriber status, RPC credit stats, dependency health. Low-value intelligence for attackers.
- Previous status: H028 NOT_FIXED

**BOT-01-R10: COMMITMENT env var not validated**
- File: `scripts/crank/crank-provider.ts:37`
- Impact: Invalid COMMITMENT value causes runtime RPC errors. Not a security issue per se, but a reliability gap.
- Previous status: H059 NOT_VULNERABLE in Audit #1 (correct — not exploitable)

**BOT-01-R11: Estimated TX cost undercount**
- File: `scripts/crank/crank-runner.ts:110`
- Impact: ESTIMATED_TX_COST_LAMPORTS (10k) is a rough estimate. Actual TX fees include priority fees, CU consumption, and account creation costs. The spending cap has 50x headroom, so this is unlikely to cause real issues.

**BOT-01-R12: Crank health server binds to 0.0.0.0**
- File: `scripts/crank/crank-runner.ts:185`
- Impact: Health endpoint accessible from Railway's internal network. No auth. Returns operational status. Railway doesn't assign a public domain, but internal network access is possible.

## Novel Attack Surface Observations

### 1. VRF TOCTOU Wallet Drain
An attacker deploys their own crank-like process targeting the same EpochState PDA. Both processes independently:
1. Create randomness accounts (TX1) — both succeed, both pay rent
2. Submit commit+trigger (TX2) — only one succeeds, the other fails with VrfAlreadyPending
3. The losing process treats this as an error, increments consecutiveErrors, and retries next cycle

The attacker's process never succeeds at advancing epochs (on-chain gates prevent this), but it forces the legitimate crank to waste SOL on failed TX1 rent deposits and TX2 fees. Over thousands of cycles, this could drain the crank wallet. The spending cap (0.5 SOL/hour) provides an upper bound, but:
- 0.5 SOL/hour × 24 hours = 12 SOL/day
- At mainnet SOL prices (~$200), this is $2,400/day

This attack only requires a Solana keypair with SOL — no private infrastructure needed.

### 2. Staleness-Induced Stale Rate Swaps
If the crank halts (circuit breaker, wallet exhaustion, Railway outage) and no external alerting exists, the protocol runs on stale tax rates indefinitely. This creates a predictable trading environment: users know which side is "cheap" and which is "expensive" with no epoch volatility. While not directly exploitable for theft (on-chain enforces existing rates), it degrades the protocol's game-theoretic properties.

### 3. Carnage Recovery Path as MEV Beacon
The VRF recovery path logs detailed information about the recovery process to stdout. While this isn't directly observable by external attackers, the on-chain state transitions during recovery (vrfPending=true for extended periods, then carnagePending=true without immediate execution) are visible to on-chain observers. Sophisticated MEV bots can detect the recovery pattern and prepare sandwich transactions.

## Questions for Other Focus Areas

1. **SEC-01**: Is the Railway platform's environment variable encryption sufficient for a signing keypair? Has the team considered using Railway's "variable references" or an external secret manager?
2. **INFRA-03**: Is there a Railway health check configured for the crank service? What triggers restarts? Is there a dead man's switch?
3. **ERR-02**: The ws-subscriber's gPA poll fetches ALL UserStake accounts, decodes each, and classifies locked/unlocked. As staker count grows, this becomes increasingly expensive. Is there a pagination or caching strategy?
4. **CHAIN-02**: The crank trusts RPC responses for vault balance checks. Could a compromised RPC endpoint report an inflated vault balance, causing the crank to skip needed top-ups?
5. **LOGIC-01**: The hourly spending cap has 50x headroom (0.5 SOL vs ~0.01 SOL normal). Should the cap be tighter for mainnet where SOL is more valuable?

## Raw Notes

### Pattern Verification Against AI Pitfalls

| Pitfall | Present? | Evidence |
|---------|----------|---------|
| AIP-129: No kill switch | PARTIAL | Circuit breaker exists, no remote kill |
| AIP-130: Infinite retry | NO | 5-error circuit breaker + 30s delay |
| AIP-133: Signs without allowlist | PARTIAL | No explicit program allowlist, but instruction construction is deterministic |
| AIP-135: Non-idempotent ops | PARTIAL | Vault top-up is non-idempotent in multi-instance scenario |
| AIP-136: Cron overlap | YES | ws-subscriber setInterval without guards |
| AIP-138: Plaintext env key | YES | WALLET_KEYPAIR as JSON array in env |

### Previous Findings Cross-Reference

| Finding | Status | Verified |
|---------|--------|----------|
| H004 (Crank wallet compromise) | PARTIALLY_FIXED | Spending cap added, no alerting |
| H017 (Staking escrow rent) | NOT_FIXED | Crank doesn't monitor staking escrow |
| H019 (No kill switch) | FIXED | Circuit breaker implemented |
| H029 (Infinite retry) | FIXED | Bounded retries + circuit breaker |
| H031 (No unhandledRejection) | NOT_FIXED | Still missing |
| H086 (No health check) | FIXED | Health endpoint on port 8080 |
| H089 (Error truncation) | NOT_FIXED | Still 300-char slice |
| H091 (No distributed lock) | ACCEPTED_RISK | Still no lock |
| H076 (Logs balance) | NOT_FIXED | Still logs balance, but it's public info |

### Overnight Runner Note

The `scripts/e2e/overnight-runner.ts` is marked `@deprecated` — replaced by the Railway crank runner. It is NOT actively running. No audit required for its operational behavior, but its code is referenced by some E2E tests.
