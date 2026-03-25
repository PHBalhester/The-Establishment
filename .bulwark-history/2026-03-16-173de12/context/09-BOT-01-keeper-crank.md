---
task_id: db-phase1-keeper-crank
provides: [keeper-crank-findings, keeper-crank-invariants]
focus_area: keeper-crank
files_analyzed: [scripts/crank/crank-runner.ts, scripts/crank/crank-provider.ts, scripts/vrf/lib/vrf-flow.ts, scripts/vrf/devnet-vrf-validation.ts, scripts/e2e/overnight-runner.ts, scripts/e2e/lib/carnage-flow.ts, scripts/graduation/graduate.ts, tests/integration/helpers/mock-vrf.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Keeper & Crank Security -- Condensed Summary

## Key Findings (Top 10)
- **No fund spend limit or circuit breaker on crank wallet**: The crank runner has no max daily spend cap, no cumulative loss threshold, and no automatic shutdown if balance drains faster than expected -- `scripts/crank/crank-runner.ts:197-316`
- **No kill switch mechanism**: No remote kill switch, no config-based toggle, no health endpoint. The only shutdown is SIGINT/SIGTERM signals -- `scripts/crank/crank-runner.ts:79-89`
- **No alerting or monitoring integration**: Crank errors go to stdout only. No Sentry, PagerDuty, webhook, or any external notification on failures or low balance -- `scripts/crank/crank-runner.ts:302-315`
- **Vault top-up has no cumulative limit**: Each cycle can auto-transfer 0.005 SOL to the CarnageSolVault with no per-day/per-run cap. A bug causing continuous low-vault reads could drain the wallet -- `scripts/crank/crank-runner.ts:225-241`
- **No program ID allowlist on signed transactions**: The crank constructs and signs transactions targeting program IDs from the manifest JSON without validating they match expected program IDs. A poisoned PDA_MANIFEST env var could redirect signing to arbitrary programs -- `scripts/crank/crank-runner.ts:126-172`
- **Infinite retry without escalation or max attempts**: On error, crank sleeps 30s and retries forever. No escalating backoff, no max consecutive error count before auto-shutdown -- `scripts/crank/crank-runner.ts:302-315`
- **VRF flow has unbounded slot polling loops**: `waitForSlotAdvance` contains `while (true)` with no timeout. If RPC returns a stuck slot (cluster halt), the crank hangs indefinitely -- `scripts/vrf/lib/vrf-flow.ts:182-195`
- **skipPreflight usage on multiple TX paths**: TX1 (create randomness) and recovery paths use `skipPreflight: true`, meaning malformed transactions land on-chain and consume fees without prior simulation -- `scripts/vrf/lib/vrf-flow.ts:559-562`
- **Wallet balance check is advisory only**: Low balance at 1 SOL triggers a console.log WARNING but does not pause or stop operations. The crank continues signing transactions even with insufficient balance -- `scripts/crank/crank-runner.ts:212-218`
- **Graduation script lacks confirmation gate**: `prepareTransition` is irreversible (Filled -> Graduated) with only a console.log warning and no interactive confirmation. A premature or accidental run could lock curves permanently -- `scripts/graduation/graduate.ts:351-365`

## Critical Mechanisms
- **Crank main loop** (`crank-runner.ts:197-316`): `while (!shutdownRequested)` loop reading epoch state, checking balances, waiting for epoch boundary, then calling `advanceEpochWithVRF`. Error catch-all logs and retries after 30s. No overlap guard needed (single-threaded await-based loop).
- **VRF 3-TX flow** (`vrf-flow.ts:357-790`): TX1 creates randomness (finalized), TX2 commits+triggers epoch, TX3 reveals+consumes+carnage-atomic. Recovery path handles stale VRF and oracle failures. Bounded retry on reveal (10 attempts with linear backoff).
- **Vault top-up** (`crank-runner.ts:220-241`): Auto-transfers 0.005 SOL to CarnageSolVault when balance drops below ~2M lamports. Mitigates on-chain rent-bug (bounty check doesn't account for rent-exempt minimum).
- **Atomic Carnage bundling** (`vrf-flow.ts:269-341`): Bundles reveal+consume+executeCarnageAtomic in single v0 VersionedTransaction. On-chain no-op guard makes this always safe. Closes CARN-002 MEV gap.

## Invariants & Assumptions
- INVARIANT: Only one crank instance should run at a time -- NOT enforced (no distributed lock, no PID file, no concurrency guard)
- INVARIANT: Crank wallet must maintain sufficient SOL for operations -- partially enforced at `crank-runner.ts:212-218` (log warning at <1 SOL but no operational pause)
- INVARIANT: VRF recovery must clear stale pending state before new transitions -- enforced at `vrf-flow.ts:400-535` (recovery path with timeout+retry)
- ASSUMPTION: PDA_MANIFEST env var contains correct, unmodified JSON -- UNVALIDATED (no signature, no hash check, no program ID cross-reference)
- ASSUMPTION: RPC endpoint returns accurate slot numbers -- UNVALIDATED (a malicious/faulty RPC could cause premature or delayed transitions)
- ASSUMPTION: Switchboard oracle gateway responds within 10 attempts (~30 seconds) -- validated with fallback at `vrf-flow.ts:613-700` (VRF timeout recovery creates fresh randomness)
- ASSUMPTION: Only one operator runs the graduation script at a time -- UNVALIDATED (no lock mechanism, checkpoint file is not atomic)

## Risk Observations (Prioritized)
1. **No cumulative fund drain protection**: `crank-runner.ts` -- The crank has no daily/weekly SOL spend tracking. Transaction fees + vault top-ups accumulate without bounds. An attacker who can cause repeated failures (e.g., by manipulating RPC responses) could drain the wallet through fees.
2. **Manifest poisoning attack surface**: `crank-provider.ts:141-177` -- PDA_MANIFEST is parsed from env var with zero integrity verification. A compromised Railway environment variable could redirect the crank to sign transactions targeting attacker-controlled programs.
3. **No operational alerting**: All crank files -- Railway captures stdout, but there is no proactive alerting (webhook, email, SMS) when the crank enters error loops, runs low on funds, or stops advancing epochs.
4. **Recovery path double-spend risk**: `vrf-flow.ts:400-535` -- If two crank instances run simultaneously (no guard), both could attempt VRF recovery, potentially creating duplicate randomness accounts and wasting SOL.
5. **Graduation script irreversibility without safeguards**: `graduate.ts:351-365` -- `prepareTransition` is a terminal state change with no interactive confirmation, no --dry-run flag, and no time-delay safety mechanism.

## Novel Attack Surface
- **RPC response manipulation causing fund drainage**: If an attacker can compromise or MITM the RPC endpoint (e.g., via DNS hijack of CLUSTER_URL), they could return artificially low vault balances to trigger continuous top-ups, or return stuck slot numbers to hang the crank in polling loops, or return manipulated epoch state to cause repeated failed transitions (burning fees).
- **Railway environment variable injection**: The crank loads WALLET_KEYPAIR (private key material) and PDA_MANIFEST (all protocol addresses) from Railway env vars. A Railway platform compromise or misconfigured access control could inject modified values.

## Cross-Focus Handoffs
- -> **SEC-01**: Wallet keypair loading in `crank-provider.ts` -- private key in WALLET_KEYPAIR env var is a secret management concern. SEC-01 should assess the key storage mechanism for Railway deployment.
- -> **ERR-01**: Error handling patterns in `vrf-flow.ts` recovery paths -- multiple nested try/catch blocks with fallthrough behavior need error resilience review.
- -> **CHAIN-01**: Transaction construction in `vrf-flow.ts` and `carnage-flow.ts` -- skipPreflight usage, commitment levels, and blockhash handling are transaction security concerns.
- -> **INFRA-03**: Railway deployment configuration -- env var management, log retention, process restart behavior for the crank runner.

## Trust Boundaries
The crank runner operates as a privileged automated signer with access to the protocol wallet's private key. It trusts three external inputs without verification: (1) the RPC endpoint specified by CLUSTER_URL, (2) the PDA_MANIFEST containing all protocol addresses, and (3) the Switchboard oracle's reveal responses. Any of these being compromised could cause the crank to sign harmful transactions or drain its wallet through fees. The trust model is "trust the deployment environment completely" with no defense-in-depth for the operational phase. Railway provides process isolation but environment variables are the primary (and only) boundary between legitimate and compromised configuration.
<!-- CONDENSED_SUMMARY_END -->

---

# Keeper & Crank Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol runs a single 24/7 crank process (`scripts/crank/crank-runner.ts`) deployed on Railway that continuously advances protocol epochs using Switchboard VRF. The crank signs transactions using a wallet keypair loaded from environment variables, performs automatic vault top-ups, and executes atomic Carnage operations. Additionally, there are supporting automation scripts for E2E testing (overnight-runner), VRF validation, and bonding curve graduation.

The crank architecture is well-structured with good separation of concerns (provider loading, VRF flow, epoch reading), comprehensive VRF recovery logic, and atomic Carnage bundling (CARN-002 fix). However, it lacks several safety mechanisms expected of production keeper infrastructure: fund spend limits, circuit breakers, alerting integrations, manifest integrity verification, and concurrency guards.

## Scope

### Files Analyzed (Full Read)
| File | Lines | Purpose |
|------|-------|---------|
| `scripts/crank/crank-runner.ts` | 332 | Production crank loop |
| `scripts/crank/crank-provider.ts` | 178 | Provider/program/manifest loading |
| `scripts/vrf/lib/vrf-flow.ts` | 791 | VRF 3-TX epoch transition flow |
| `scripts/vrf/devnet-vrf-validation.ts` | 669 | VRF validation suite |
| `scripts/e2e/overnight-runner.ts` | 595 | Overnight E2E test runner (deprecated) |
| `scripts/e2e/lib/carnage-flow.ts` | 1108 | Carnage execution flows |
| `scripts/graduation/graduate.ts` | 1011 | Bonding curve graduation |
| `tests/integration/helpers/mock-vrf.ts` | 297 | Mock VRF for local tests |

### Files Scanned (Signatures Only)
- `scripts/e2e/lib/alt-helper.ts` -- ALT creation/caching
- `scripts/e2e/lib/swap-flow.ts` -- Swap execution helpers
- `scripts/deploy/lib/connection.ts` -- Provider factory
- `scripts/vrf/lib/epoch-reader.ts` -- Epoch state reader

## Key Mechanisms

### 1. Crank Main Loop (`crank-runner.ts:197-316`)

The production crank is a single `while (!shutdownRequested)` loop that:
1. Reads EpochState to determine timing
2. Checks wallet balance (log-only warning at <1 SOL)
3. Checks CarnageSolVault balance and auto-tops-up if below ~2M lamports
4. Calculates slots until next epoch boundary and waits
5. Calls `advanceEpochWithVRF()` (the core VRF flow)
6. Logs result as JSON line to stdout
7. On error: logs and sleeps 30s before retrying

**Positive patterns observed:**
- Graceful shutdown via SIGINT/SIGTERM handlers
- Rate limiting via RPC_DELAY_MS (200ms) between RPC calls
- Comprehensive JSON-line logging for each epoch cycle
- Vault top-up addresses a known on-chain rent-bug

**Missing patterns:**
- No max consecutive error count before shutdown
- No daily/cumulative SOL spend tracking
- No external alerting on errors or low balance
- No overlap/concurrency guard
- No health check endpoint for Railway monitoring

### 2. VRF 3-TX Flow (`vrf-flow.ts:357-790`)

The core epoch transition mechanism:
- **TX1**: Create Switchboard randomness account (must wait for finalization)
- **TX2**: Commit randomness + `trigger_epoch_transition` (bundled)
- **TX3**: Reveal + `consume_randomness` + `executeCarnageAtomic` (bundled v0)

**Recovery mechanisms:**
- Stale VRF detection: If `vrf_pending=true` at start, attempts to complete stale randomness first
- Oracle timeout: If reveal fails after 10 attempts, waits 300 slots for VRF timeout, creates fresh randomness, uses `retry_epoch_vrf`
- Oracle gateway: No rotation (each randomness account binds to a specific oracle)

**Positive patterns:**
- TX1 waits for "finalized" commitment (not just "confirmed")
- Bounded retry on reveal (10 attempts with linear backoff: 3s, 6s, 9s...)
- Atomic Carnage bundling closes MEV gap
- Dynamic Switchboard address resolution (no hardcoded SB addresses)

**Concerns:**
- `waitForSlotAdvance` has `while (true)` with no absolute timeout
- `skipPreflight: true` on TX1 and recovery TX creates
- No program ID validation on constructed instructions
- Recovery path could be triggered by stale RPC data

### 3. Vault Top-Up (`crank-runner.ts:220-241`)

Automatic SOL transfer from crank wallet to CarnageSolVault:
- Triggered when vault balance < MIN_VAULT_BALANCE (~2M lamports)
- Transfers VAULT_TOP_UP_LAMPORTS (0.005 SOL = 5M lamports)
- No per-cycle or per-day limit on top-ups
- No validation that the vault address is correct (trusts manifest)

### 4. Graduation Script (`graduate.ts`)

Manual admin script with checkpoint+resume:
- 11 sequential steps with state file persistence
- Includes IRREVERSIBLE operations (Filled -> Graduated)
- Idempotent checks before each step (resume-safe)
- Hardcoded graduation amounts (Phase 69 lesson learned)

**Concerns:**
- No interactive confirmation before irreversible step
- No --dry-run mode
- State file is not atomically written (could corrupt on crash during write)

## Trust Model

### Trusted Inputs
| Input | Source | Validation | Risk |
|-------|--------|-----------|------|
| WALLET_KEYPAIR | Railway env var | JSON parse only | HIGH: private key material |
| PDA_MANIFEST | Railway env var | JSON parse only | HIGH: all protocol addresses |
| CLUSTER_URL | Railway env var | None | HIGH: RPC endpoint for all operations |
| COMMITMENT | Railway env var | Cast to string | LOW: defaults to "confirmed" |
| CARNAGE_WSOL_PUBKEY | Railway env var | PublicKey parse | MEDIUM: carnage WSOL account |

### Trust Boundaries
1. **Railway -> Crank Process**: Env vars are the only boundary. Railway provides process isolation but env var access is the critical trust point.
2. **Crank Process -> RPC Node**: All on-chain reads and TX submissions go through a single RPC endpoint. The crank trusts all responses.
3. **Crank Process -> Switchboard Oracle**: Oracle responses are verified on-chain (Switchboard program validates signatures), but the crank trusts the oracle's availability.
4. **Manifest -> Program Addresses**: The PDA_MANIFEST maps all protocol addresses. The crank trusts these are correct and signs transactions targeting them.

## State Analysis

### On-Disk State
| File | Location | Purpose | Risk |
|------|----------|---------|------|
| `graduation-state.json` | `scripts/graduation/` | Checkpoint+resume state | LOW: only used by admin manual run |
| `alt-address.json` | `scripts/deploy/` | Cached ALT address | LOW: read-only reference |
| `pda-manifest.json` | `scripts/deploy/` | PDA addresses (fallback) | MEDIUM: local file fallback |
| `carnage-wsol.json` | `keypairs/` | Carnage WSOL keypair | LOW: public key extraction only |

### In-Memory State
- `shutdownRequested` boolean flag (graceful shutdown)
- `cycleCount` and `carnageTriggerCount` counters (logging only)
- VRF flow transient state (randomness keypair, instruction builders)

## Dependencies

### External APIs/Services
| Service | Usage | Failure Impact |
|---------|-------|---------------|
| Solana RPC (Helius) | All chain reads/writes | Crank stops advancing epochs |
| Switchboard Oracle | VRF randomness reveal | Triggers VRF timeout recovery (300 slots) |

### npm Packages
| Package | Usage | Risk |
|---------|-------|------|
| `@coral-xyz/anchor` | Program interaction | Core dependency, well-maintained |
| `@solana/web3.js` | Transaction construction | Core dependency |
| `@switchboard-xyz/on-demand` | VRF SDK | Third-party, but actively maintained |
| `@solana/spl-token` | Token operations | Core dependency |

## Focus-Specific Analysis

### OC-246: Automated Signing Without Approval
The crank signs every transaction it constructs without any program ID allowlist validation. Instructions are built using IDL-typed methods (e.g., `epochProgram.methods.triggerEpochTransition()`), which provides implicit program targeting through the IDL's embedded program address. However, if the IDL files in `app/idl/` were tampered with, the crank would sign transactions targeting arbitrary programs.

**Mitigation present**: IDL files contain embedded program addresses; Anchor's Program class uses these.
**Mitigation missing**: No explicit allowlist check comparing instruction.programId against known program IDs.

### OC-247: No Fund Limit Per Operation
The crank has no per-operation, per-cycle, or per-day fund limits. Each VRF cycle costs ~0.002-0.01 SOL in transaction fees. The vault top-up adds 0.005 SOL per trigger. Over 24 hours (~288 cycles at 5-min intervals), normal operation costs ~0.6-3 SOL. But in error conditions (repeated failed TXs), costs could escalate without bounds.

### OC-248: No Kill Switch / Emergency Shutdown
The only shutdown mechanism is OS signals (SIGINT/SIGTERM). There is:
- No remote kill switch (e.g., health check endpoint that can be disabled)
- No config-based toggle (e.g., check a file/env var/on-chain flag)
- No dead man's switch (e.g., require periodic heartbeat confirmation)

### OC-249: Infinite Retry on Failed Operations
`crank-runner.ts:302-315`: On any error, the crank logs and sleeps 30s, then loops. There is no:
- Maximum consecutive error count
- Escalating backoff
- Error categorization (permanent vs transient)
- Auto-shutdown on persistent failures

The VRF flow itself has bounded retry (10 attempts for reveal), but the outer crank loop is unbounded.

### OC-250: Fee Escalation in Retry Loop
No priority fee escalation is used in the crank. All transactions use default fees. However, the fixed 30s retry delay + lack of max attempts means fees from failed TXs accumulate without limit.

### OC-251: No Monitoring/Alerting on Failures
All output goes to stdout. Railway captures logs, but there is no proactive alerting. The project has Sentry configured for the frontend (per memory: custom zero-dependency implementation), but the crank has no Sentry or equivalent integration.

### OC-252: Non-Idempotent Automated Operation
The VRF epoch transition is naturally idempotent due to on-chain guards (EpochBoundaryNotReached, VrfAlreadyPending). However, the vault top-up (`SystemProgram.transfer`) is not guarded against double-execution within a cycle if the balance check and transfer are interrupted.

### OC-264: Cron Job Overlap / No Lock
The crank uses a single-threaded `while` loop with `await`, so individual cycle overlap is impossible within a single process. However, there is no distributed lock preventing two crank instances from running simultaneously (e.g., if Railway scales to 2 instances or a developer runs it locally while Railway is active). On-chain guards (VrfAlreadyPending) would catch most conflicts, but both instances would waste SOL on failed transactions.

### OC-265: Keeper Operating on Stale State
The crank reads EpochState at the start of each cycle using "confirmed" commitment (from provider config). This is appropriate. However, `waitForSlotAdvance` uses `getSlot()` without specifying commitment, defaulting to the connection's configured level. If the RPC returns a stale slot, the crank could attempt epoch transitions too early.

## Cross-Focus Intersections

### SEC-01 (Private Key Management)
`crank-provider.ts:41-57`: The WALLET_KEYPAIR env var contains the full 64-byte secret key as a JSON array. This is the standard Solana keypair format but means the private key is in plaintext in Railway's environment. The `@solana/web3.js` supply chain attack (CVE-2024-54134) specifically targeted this pattern. The crank's `@solana/web3.js` dependency should be pinned and audited.

### CHAIN-01 (Transaction Construction)
Multiple `skipPreflight: true` usages in `vrf-flow.ts`. While documented as necessary for Switchboard SDK LUT staleness, each instance bypasses transaction simulation, meaning:
- Malformed instructions land on-chain (costing fees)
- Error feedback is delayed (must check confirmation result)
- TX1 create and recovery creates all skip preflight

### ERR-01 (Error Handling)
The VRF recovery path in `vrf-flow.ts:400-535` has multiple nested try/catch blocks with fallthrough behavior. If the stale reveal succeeds on-chain but the `sendRevealAndConsume` throws due to RPC timeout, the state may have advanced but the crank doesn't know. The next cycle would detect `vrfPending=false` and proceed normally, but any carnage trigger from that transition would be missed.

### INFRA-03 (Railway Deployment)
The crank is deployed as a single Railway process. Railway provides:
- Automatic restart on crash (process.exit)
- Log capture (stdout)
- Environment variable management

Railway does NOT provide:
- Multi-instance coordination
- Health check monitoring
- Alerting on repeated restarts

## Cross-Reference Handoffs

| Target Auditor | Item | Context |
|---------------|------|---------|
| SEC-01 | WALLET_KEYPAIR in Railway env var | Private key material in plaintext environment variable |
| SEC-01 | carnage-wsol.json file read in `loadCarnageWsolPubkey` | Reads keypair from disk at `crank-runner.ts:110-111` |
| CHAIN-01 | skipPreflight on TX1 and recovery | `vrf-flow.ts:559-562`, `vrf-flow.ts:458`, `vrf-flow.ts:652` |
| CHAIN-01 | v0 VersionedTransaction for atomic carnage | `vrf-flow.ts:310-329` |
| ERR-01 | Unbounded `while(true)` in waitForSlotAdvance | `vrf-flow.ts:182-195` -- no absolute timeout |
| ERR-01 | VRF recovery nested try/catch | `vrf-flow.ts:413-427` -- fallthrough on reveal failure |
| INFRA-03 | Railway single-process deployment | No distributed lock, no health check endpoint |
| LOGIC-01 | Graduation checkpoint atomicity | `graduate.ts:191-193` -- non-atomic state file write |

## Risk Observations

### R-01: No Fund Drain Protection (HIGH)
**Files**: `crank-runner.ts:197-316`, `vrf-flow.ts`
**What**: The crank has no cumulative spend tracking or circuit breaker. Each cycle costs transaction fees, and vault top-ups add 0.005 SOL per trigger. In adversarial conditions (RPC manipulation, repeated oracle failures), the wallet could drain.
**Impact**: Complete loss of crank wallet SOL balance.
**Likelihood**: Possible (requires adversarial RPC or sustained oracle failure).

### R-02: Manifest Poisoning (HIGH)
**Files**: `crank-provider.ts:141-177`, `crank-runner.ts:126-172`
**What**: PDA_MANIFEST is loaded from a Railway env var with no integrity verification (no hash, no signature, no cross-reference with on-chain data). All protocol addresses (PDAs, pools, vaults, program IDs) come from this manifest.
**Impact**: Crank signs transactions targeting attacker-controlled programs.
**Likelihood**: Unlikely (requires Railway env compromise), but impact is critical.

### R-03: No Operational Alerting (MEDIUM)
**Files**: All crank scripts
**What**: No external alerting on errors, low balance, epoch advancement failures, or crank shutdown. Operators would not know the crank stopped until users report stale epochs.
**Impact**: Extended protocol downtime (no epoch transitions).
**Likelihood**: Probable (transient failures are expected in production).

### R-04: Concurrent Crank Instances (MEDIUM)
**Files**: `crank-runner.ts`
**What**: No distributed lock prevents multiple instances. A second instance (dev laptop, Railway scaling) would compete for epoch transitions.
**Impact**: Wasted SOL on failed transactions, potential VRF state confusion.
**Likelihood**: Possible (developer mistake, Railway misconfiguration).

### R-05: waitForSlotAdvance Infinite Loop (MEDIUM)
**Files**: `vrf-flow.ts:182-195`
**What**: `while (true)` polling loop with no absolute timeout. If the RPC consistently returns the same slot (cluster halt, RPC caching bug), the crank hangs forever.
**Impact**: Crank becomes unresponsive; requires manual restart.
**Likelihood**: Unlikely (Solana cluster halts are rare but have occurred).

### R-06: skipPreflight Fee Waste (MEDIUM)
**Files**: `vrf-flow.ts:559-562`, `vrf-flow.ts:458`, `vrf-flow.ts:652`
**What**: Multiple transaction submission paths use `skipPreflight: true`. Failed TXs still land on-chain and consume fees.
**Impact**: Accelerated wallet drain during error conditions.
**Likelihood**: Possible (Switchboard SDK interactions are known to be finicky).

### R-07: Vault Top-Up Without Limit (MEDIUM)
**Files**: `crank-runner.ts:225-241`
**What**: No per-cycle or per-day cap on vault top-ups. If vault balance consistently reads below threshold (e.g., on-chain drain, RPC returning stale data), the crank continuously transfers SOL.
**Impact**: Wallet drain through continuous small transfers.
**Likelihood**: Unlikely but possible with stale RPC data.

### R-08: Overnight Runner Deprecated but Present (LOW)
**Files**: `scripts/e2e/overnight-runner.ts:1-6`
**What**: Marked `@deprecated` but still present and executable. Uses `loadProvider()` which reads WALLET env var. Could be accidentally run in production context.
**Impact**: Unintended devnet operations, potential confusion.
**Likelihood**: Unlikely (requires manual execution).

### R-09: Graduation State File Not Atomic (LOW)
**Files**: `graduate.ts:191-193`
**What**: `saveState()` uses `fs.writeFileSync()` which is not atomic. A process crash during write could corrupt the state file, losing checkpoint progress.
**Impact**: Need to manually reconstruct graduation progress.
**Likelihood**: Rare (crash during the few ms of file write).

### R-10: Wallet Balance Logged Publicly (LOW)
**Files**: `crank-runner.ts:214-217`
**What**: Wallet balance is logged to stdout (Railway logs). While not a direct vulnerability, it provides intelligence about the crank wallet's financial state.
**Impact**: Information disclosure to anyone with Railway log access.
**Likelihood**: N/A (informational).

### R-11: VRF Bytes Reverse-Engineered (LOW)
**Files**: `vrf-flow.ts:743-762`
**What**: VRF bytes are "reverse-engineered" from post-transition state rather than read directly. The logged vrfBytes are approximations, not actual oracle output. This could mask anomalies if VRF output verification is needed.
**Impact**: Debugging/audit trail inaccuracy.
**Likelihood**: N/A (informational).

### R-12: Crank Logs RPC URL (LOW)
**Files**: `crank-runner.ts:177`
**What**: Logs `process.env.CLUSTER_URL || "localhost"` which may contain API keys if the Helius URL includes `?api-key=...`.
**Impact**: API key exposure in Railway logs.
**Likelihood**: Check FP-004 -- the devnet-vrf-validation.ts at line 94 masks API keys in logs (`rpcEndpoint.replace(/api-key=[^&]+/, "api-key=***")`), but crank-runner.ts does NOT mask.

## Novel Attack Surface Observations

### 1. RPC-Mediated Fund Drainage
The crank makes all decisions based on RPC responses (slot numbers, account balances, epoch state). An attacker who can MITM or spoof the RPC endpoint could:
- Return artificially low CarnageSolVault balance to trigger continuous top-ups
- Return stuck slot numbers to hang the crank in polling loops
- Return manipulated EpochState to force repeated recovery attempts (each creating new randomness accounts and consuming fees)
This is distinct from standard RPC trust issues because the crank is an automated signer -- it acts on data without human verification.

### 2. Railway Environment Variable Injection Chain
The crank's entire identity (wallet key) and target (manifest addresses) come from Railway env vars. A single env var compromise cascades:
- WALLET_KEYPAIR: Attacker gets the private key directly
- PDA_MANIFEST: Attacker redirects all crank operations to controlled addresses
- CLUSTER_URL: Attacker controls all RPC responses
Unlike frontend code where users verify transactions in their wallet, the crank signs automatically. The attack surface is the deployment platform, not the code itself.

### 3. Epoch Transition Timing Manipulation
The crank calculates `slotsToWait` using `MIN_EPOCH_SLOTS = 750` as a hardcoded minimum. But on-chain, `SLOTS_PER_EPOCH` could differ between devnet (750) and mainnet (4500). The crank-runner.ts comment acknowledges this: "On-chain SLOTS_PER_EPOCH: we don't have direct access, so we estimate." If the on-chain constant is changed during an upgrade, the crank would attempt transitions at incorrect intervals until manually updated.

## Questions for Other Focus Areas

1. **SEC-01**: Is the Railway WALLET_KEYPAIR env var encrypted at rest? Does Railway support secrets management (e.g., Vault integration) vs. plain env vars?
2. **CHAIN-01**: Are the `skipPreflight: true` usages all strictly necessary? Could TX1 create use simulation with a higher slot tolerance instead?
3. **INFRA-03**: Does Railway support health check endpoints? Could the crank expose a simple HTTP endpoint that Railway monitors?
4. **ERR-01**: Should `waitForSlotAdvance` have an absolute timeout (e.g., 30 minutes) to prevent permanent hangs?
5. **LOGIC-01**: The graduation script handles ~2000+ SOL in transfers. Should it require a multi-sig or time-delay mechanism?

## Raw Notes

- The overnight-runner.ts is deprecated but not deleted. It has a devnet airdrop safety net (`checkAndAirdrop`) that would fail silently on mainnet. The crank-runner.ts correctly does NOT have airdrop logic.
- mock-vrf.ts manipulates EpochState binary directly, including byte offsets for carnage_pending, carnage_target, etc. This is test-only code but documents the exact binary layout which is useful for understanding what the crank reads.
- The crank uses `provider.sendAndConfirm()` for most TXs, which defaults to the provider's commitment level ("confirmed"). This is appropriate for keeper operations.
- carnage-flow.ts line 525 sets `carnageWsol: PublicKey.default` (11111...1), which would be overridden by the shared builder. This is a test helper pattern, not used in the production crank path.
- The graduation script's `distributeTaxEscrow` function calls a permissionless instruction (`programs.bondingCurve.methods.distributeTaxEscrow()`) -- anyone can call this after graduation. The admin calling it in the script is for convenience, not access control.
