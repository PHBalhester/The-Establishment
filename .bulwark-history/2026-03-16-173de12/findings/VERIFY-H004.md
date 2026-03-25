# VERIFY-H004: Crank Wallet Key Compromise
**Status:** PARTIALLY_FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

### Mitigations Present (unchanged from round 2)

1. **Spending cap (FIXED):** Rolling hourly cap of 0.5 SOL (`MAX_HOURLY_SPEND_LAMPORTS = 500_000_000`) in `crank-runner.ts:104`. Every TX cost recorded via `recordSpend()` (line 139). Crank halts immediately if cap would be exceeded (lines 141-147, 429, 500).

2. **Circuit breaker (FIXED):** `CIRCUIT_BREAKER_THRESHOLD = 5` consecutive errors triggers halt (`crank-runner.ts:91`). Counter resets on success (line 505). Health endpoint exposes state (lines 163-190).

3. **Per-top-up ceiling (FIXED):** `MAX_TOPUP_LAMPORTS = 100_000_000` (0.1 SOL) caps any single vault top-up (`crank-runner.ts:82`, enforced at line 421).

4. **Health endpoint (FIXED):** HTTP server exposes JSON status including `consecutiveErrors`, `hourlySpendLamports`, `status` (halted/running), `lastSuccessAt` on configurable port.

5. **RPC URL masking (FIXED):** `maskRpcUrl()` (lines 233-250) prevents API key leakage in logs.

### Gap 1: External Alerting Webhook (NOT FIXED)

No external alerting has been added since round 2. Searched the entire `scripts/crank/` directory for "webhook", "discord", "pagerduty", "alert", "notify", "notification" — zero matches (only the log-level `Balance alert` threshold label at line 367).

When the circuit breaker trips (line 535-539) or spending cap is hit (line 142-146), the crank logs `CRITICAL` to stdout and halts. There is no push notification to any external service. Operators must poll Railway logs or hit the `/health` endpoint to discover the crank is down.

### Gap 2: Wallet Key Still Plaintext Env Var (ACCEPTED RISK — no change)

`crank-provider.ts` loads the wallet via:
- **Priority 1:** `WALLET_KEYPAIR` env var — full secret key as JSON byte array (line 41-57)
- **Priority 2:** `WALLET` env var — file path to keypair JSON (line 60-79)
- **Priority 3:** `keypairs/devnet-wallet.json` — committed file (devnet only)

No HSM, KMS, or encrypted secrets manager integration. The raw secret key is parsed directly from the environment variable (`JSON.parse(keypairEnv)` at line 46, then `Keypair.fromSecretKey()`).

### No Regressions

All previously verified mitigations remain intact and functional. No code paths bypass the spending cap or circuit breaker.

## Assessment

**PARTIALLY_FIXED** — The core economic mitigations (spending cap, circuit breaker, per-top-up ceiling) remain solid and would limit damage from a compromised crank wallet to at most 0.5 SOL/hour with automatic halt after 5 consecutive errors.

**Remaining gaps (same as round 2):**

1. **No external alerting (Medium priority):** A simple Discord/PagerDuty webhook POST on circuit breaker trip or spending cap hit would close this gap. Without it, a halted crank means no epoch advancement and the protocol stalls silently until an operator manually checks.

2. **Plaintext wallet key (Low priority, accepted risk):** Standard practice for Solana cranks. Railway's env vars are encrypted at rest. For mainnet, consider a dedicated crank wallet with minimal SOL balance (the spending cap already enforces this operationally) and rotating keys periodically.
