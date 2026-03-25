# Stacked Audit #2 — Crank & Bot Security Verification

**Auditor**: Claude Opus 4.6 (verification pass)
**Date**: 2026-03-21
**Target file**: `scripts/crank/crank-runner.ts` (568 lines, unchanged)
**Scope**: 12 findings from Audit #1 targeting crank-runner.ts

## File Change Status

- `scripts/crank/crank-runner.ts` — **UNCHANGED** (last commit: `547fe02`, no uncommitted diff)
- `scripts/crank/crank-provider.ts` — **UNCHANGED** (last commit: `53ca01b`, no uncommitted diff)
- `scripts/vrf/lib/vrf-flow.ts` — **UNCHANGED** since audit #1 (last relevant: `0113402` adding maxWaitMs timeout)
- `scripts/vrf/lib/epoch-reader.ts` — **UNCHANGED**
- `scripts/e2e/lib/alt-helper.ts` — **UNCHANGED**

## Dependency Changes (Indirect)

- **On-chain staking claim** (`programs/staking/src/instructions/claim.rs`): Added rent-exempt guard in commit `5cbdd3d` (Phase 79). Escrow balance can no longer be drained below rent-exempt minimum by claim instructions.
- **On-chain epoch bounty** (`programs/epoch-program/src/instructions/trigger_epoch_transition.rs`): Added rent-exempt reservation check (same Phase 79 commit). Vault balance check now accounts for rent-exempt minimum.
- **On-chain carnage execution** (`programs/epoch-program/src/helpers/carnage_execution.rs`): Reserves rent-exempt minimum before spending SOL from vault.
- **Authority transfer instructions** added to AMM, Hook, BC programs (commit `c6068df`, Phase 97). Does not affect crank control flow.

---

## Finding Verdicts

### 1. H004 (HIGH, PARTIALLY_FIXED) — Crank wallet key via WALLET_KEYPAIR env var

**Verdict: STILL_VALID**

The crank wallet private key is loaded from `WALLET_KEYPAIR` env var in `crank-provider.ts` lines 41-57. No change to how this is handled. No external alerting integration was added when the circuit breaker trips — it only logs to stdout and exits. Railway log capture is the sole observability channel. The partially-fixed status (key exposure risk mitigated by Railway's env var encryption, but no external alert on circuit breaker trip) remains accurate.

### 2. H017 (HIGH, NOT_FIXED) — Staking escrow rent depletion monitoring absent

**Verdict: STILL_VALID (severity reduced by on-chain mitigations)**

The crank still does not monitor staking escrow rent levels. However, the risk is now significantly lower because:
- On-chain `claim.rs` (Phase 79) now has a rent-exempt guard that prevents claims from draining escrow below `rent.minimum_balance(0)`.
- On-chain `trigger_epoch_transition.rs` reserves rent-exempt minimum for the vault PDA.

The crank monitors the *carnage vault* balance (lines 414-448) but NOT the staking escrow PDA balance. While the on-chain guards prevent catastrophic depletion, monitoring would still provide early warning if the escrow approaches its floor. Finding still valid as a defense-in-depth gap, but effective severity is reduced from HIGH to LOW/INFORMATIONAL given the on-chain fix.

### 3. H019 (HIGH, FIXED) — Crank kill switch

**Verdict: STILL_VALID (fix confirmed)**

Circuit breaker at lines 84-150: `CIRCUIT_BREAKER_THRESHOLD = 5` consecutive errors triggers halt. Hourly spending cap at `MAX_HOURLY_SPEND_LAMPORTS = 500_000_000` (0.5 SOL). SIGINT/SIGTERM graceful shutdown at lines 194-206. All three mechanisms are present and unchanged. Fix confirmed.

### 4. H013 (MED, FIXED) — Vault top-up cap (0.1 SOL)

**Verdict: STILL_VALID (fix confirmed)**

`MAX_TOPUP_LAMPORTS = 100_000_000` (0.1 SOL) ceiling at line 82. Applied at lines 420-426 via `Math.min(requestedTopUp, MAX_TOPUP_LAMPORTS)`. Fix confirmed.

### 5. H029 (MED, FIXED) — Crank infinite retry fixed with circuit breaker

**Verdict: STILL_VALID (fix confirmed)**

Circuit breaker at lines 535-540: after `CIRCUIT_BREAKER_THRESHOLD` (5) consecutive failures, the loop breaks. `consecutiveErrors` is reset to 0 on success (line 505). Fix confirmed.

### 6. H086 (MED, FIXED) — Crank health check endpoint

**Verdict: STILL_VALID (fix confirmed)**

HTTP health server at lines 152-190. Responds on `GET /health` with JSON status including `consecutiveErrors`, `hourlySpendLamports`, `uptime`, `lastSuccessAt`. Binds to `0.0.0.0:HEALTH_PORT` (default 8080). Returns 404 for all other routes. Fix confirmed.

### 7. H091 (MED, ACCEPTED_RISK) — No distributed lock for singleton crank

**Verdict: STILL_VALID**

No distributed locking mechanism. Running multiple crank instances would cause duplicate VRF commits and wasted SOL. Accepted risk is reasonable — Railway runs a single instance, and the on-chain VRF flow is idempotent (second commit to same epoch would fail). No change.

### 8. H031 (LOW, NOT_FIXED) — No unhandledRejection handler

**Verdict: STILL_VALID**

Confirmed via grep: no `unhandledRejection` or `uncaughtException` handlers in `scripts/crank/`. The `main().catch()` at line 565 catches top-level errors, but unhandled promise rejections from background operations (e.g., health server errors, timer callbacks) could crash the process silently. Still not fixed.

### 9. H058 (MED, FIXED) — RPC URL redacted in logs

**Verdict: STILL_VALID (fix confirmed)**

`maskRpcUrl()` at lines 233-250 masks path segments >20 chars and query params >10 chars. Used at line 365 for startup log. Fix confirmed.

### 10. H076 (LOW, NOT_FIXED) — Crank logs wallet balance

**Verdict: STILL_VALID**

Lines 403-410: wallet balance is logged with `toFixed(3)` when below threshold. The wallet public key is logged at line 364 (`provider.wallet.publicKey.toBase58()`). Balance + pubkey in logs could be used for reconnaissance. Railway logs are not public, but this remains an informational disclosure risk. Still not fixed.

### 11. H089 (LOW, NOT_FIXED) — Error truncation to 300 chars

**Verdict: STILL_VALID**

Line 529: `String(err).slice(0, 300)`. Error messages over 300 characters are silently truncated, potentially losing diagnostic information (e.g., Solana program log lines, stack traces). Still not fixed.

### 12. H111 (LOW, FIXED) — RPC fallback to localhost removed

**Verdict: NEEDS_FULL_RECHECK**

The finding is marked FIXED targeting `crank-runner.ts`, but the actual RPC connection URL is set in `crank-provider.ts` line 35: `const url = process.env.CLUSTER_URL || "http://localhost:8899"`. This localhost fallback **still exists** in the provider module. The crank-runner.ts line 365 also references `"http://localhost:8899"` as a fallback for the log display. If `CLUSTER_URL` is not set, the crank will silently connect to localhost. This needs a full recheck — the fix status may be incorrect, or the fix was applied to a different aspect than the provider fallback.

---

## Summary

| Finding | Original Status | Verdict | Notes |
|---------|----------------|---------|-------|
| H004 | PARTIALLY_FIXED | STILL_VALID | No external alerting added |
| H017 | NOT_FIXED | STILL_VALID | On-chain rent guards reduce severity to LOW |
| H019 | FIXED | STILL_VALID | Circuit breaker + spending cap + SIGTERM confirmed |
| H013 | FIXED | STILL_VALID | 0.1 SOL cap confirmed |
| H029 | FIXED | STILL_VALID | 5-error circuit breaker confirmed |
| H086 | FIXED | STILL_VALID | /health endpoint confirmed |
| H091 | ACCEPTED_RISK | STILL_VALID | Single instance by deployment convention |
| H031 | NOT_FIXED | STILL_VALID | No unhandledRejection handler |
| H058 | FIXED | STILL_VALID | maskRpcUrl() confirmed |
| H076 | NOT_FIXED | STILL_VALID | Balance + pubkey in logs |
| H089 | NOT_FIXED | STILL_VALID | 300-char truncation |
| H111 | FIXED | NEEDS_FULL_RECHECK | localhost:8899 fallback still in crank-provider.ts |

**Totals**: 10 STILL_VALID, 0 INVALIDATED, 1 NEEDS_FULL_RECHECK
