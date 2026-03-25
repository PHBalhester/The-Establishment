# Dinh's Bulwark — Verification Report

**Original Audit Date:** 2026-03-07
**Previous Verifications:** Round 1 (2026-03-08), Round 2 (2026-03-09), Round 3 (2026-03-12)
**Verification Date:** 2026-03-16
**Verification Round:** 4
**Findings Verified:** 20 re-verified (all non-FIXED from round 3)

---

## Summary

| Status | Count | Round 3 (03-12) | Delta |
|--------|-------|-----------------|-------|
| FIXED | 42 | 41 | **+1** |
| PARTIALLY_FIXED | 2 | 3 | **-1** |
| NOT_FIXED | 14 | 17 | **-3** (reclassified) |
| ACCEPTED_RISK | 5 | 1 | **+4** (reclassified) |
| REGRESSION | 0 | 0 | — |
| CANNOT_VERIFY | 0 | 0 | — |

**Round 4 impact:** 1 finding upgraded to FIXED (H036). 4 LOW findings reclassified from NOT_FIXED to ACCEPTED_RISK (H048, H060, H085, H106). 2 findings downgraded from PARTIALLY_FIXED to NOT_FIXED (H015, H017 — gaps not addressed). Zero regressions.

**All CRITICAL findings remain FIXED.**

---

## Changes Since Round 3

| ID | Severity | Round 3 | Round 4 | Change Detail |
|----|----------|---------|---------|---------------|
| **H036** | LOW | NOT_FIXED | **FIXED** | Comment at `rewards.ts:79-83` corrected — now accurately describes 5e17 > MAX_SAFE_INTEGER |
| **H015** | HIGH | PARTIALLY_FIXED | **NOT_FIXED** | Default slippage still 500 BPS at `SettingsProvider.tsx:170`. One-line fix not applied. |
| **H017** | HIGH | PARTIALLY_FIXED | **NOT_FIXED** | Zero escrow references in crank-runner.ts. On-chain guard solid but crank monitoring still absent. |
| **H048** | LOW | NOT_FIXED | **ACCEPTED_RISK** | Sign-then-send is documented tradeoff (Phantom devnet TX drops). Revisit for mainnet. |
| **H060** | LOW | NOT_FIXED | **ACCEPTED_RISK** | pda-manifest.json gitignored, key not in source control. |
| **H085** | LOW | NOT_FIXED | **ACCEPTED_RISK** | Intentional for Railway liveness. Degraded state reported in response body. |
| **H106** | HIGH | NOT_FIXED | **ACCEPTED_RISK** | Deliberate design decision documented in 8+ project documents (Decision D5). |

---

## CRITICAL Findings (3) — ALL FIXED (stable)

| ID | Title | Status | Detail |
|----|-------|--------|--------|
| **H010** | Bonding Curve Authority Theft | **FIXED** | BcAdminConfig PDA with `has_one = authority`. Stable since Phase 78. |
| **H003** | npm Supply Chain Attack | **FIXED** | `.npmrc`, lockfile committed, `npm ci`. Stable since Phase 89. |
| **H016** | Transfer Hook Init Front-Running | **FIXED** | Ownership verification + programData. Stable since Phase 90. |

---

## HIGH Findings (13)

| ID | Title | Status | Detail |
|----|-------|--------|--------|
| **H009** | Devnet Fallback in Production | **FIXED** | Stable. |
| **H022** | Sell Path Zero AMM Slippage | **FIXED** | On-chain 50% output floor stable. |
| **H001** | Webhook Auth Bypass | **FIXED** | Fail-closed + timingSafeEqual. Regression scan clean. |
| **H002** | Helius API Key in Bundle | **FIXED** | Server-side only. Regression scan clean. |
| **H004** | Crank Wallet Key Compromise | **PARTIALLY_FIXED** | Spending cap + circuit breaker intact. **Gaps:** No external alerting, plaintext env var, no Squads multisig. |
| **H005** | Keypairs Committed to Git | **PARTIALLY_FIXED** | Mainnet gitignored. 17 devnet keypairs still tracked (accepted). Git history not purged. |
| **H008** | SSE Amplification DoS | **FIXED** | Stable. |
| **H014** | Quote-Engine Number Overflow | **FIXED** | BigInt throughout. Stable. |
| **H015** | No MEV Protection | **NOT_FIXED** | Default slippage still 500 BPS at `SettingsProvider.tsx:170`. Tax-as-MEV-defense documented but the one-line slippage fix has not been applied. UI presets (0.5%/1%/2%) don't match default (5%). |
| **H017** | Staking Escrow Rent Depletion | **NOT_FIXED** | On-chain guard solid. Crank still has zero escrow monitoring — no fetch, no balance check, no top-up logic. |
| **H019** | Crank No Kill Switch | **FIXED** | Circuit breaker + spending cap + /health. Stable. |
| **H106** | No Emergency Pause | **ACCEPTED_RISK** | Deliberate design decision (D5). Documented in 8+ documents. Squads multisig upgrade authority as mitigation. |
| **S004** | Launch Day Attack Bundle | **FIXED** | All components closed. Stable. |

---

## MEDIUM Findings (22) — All stable from Round 3

| ID | Title | Status |
|----|-------|--------|
| H011 | DB Without TLS | FIXED |
| H013 | Vault Top-Up Without Limit | FIXED |
| H023 | SSE Connection Exhaustion | FIXED |
| H024 | No Rate Limiting | FIXED (regression scan clean) |
| H026 | Missing HSTS | FIXED |
| H029 | Crank Infinite Retry | FIXED |
| H030 | VRF Wait Loop | FIXED |
| H034 | Double-Submit Without Guard | FIXED |
| H045 | No Server Error Reporting | FIXED |
| H047 | Single RPC No Failover | FIXED (regression scan clean) |
| H049 | Webhook No Replay Protection | FIXED (regression scan clean) |
| H050 | Webhook No Body Size Limit | FIXED |
| H055 | No CI/CD Pipeline | FIXED |
| H057 | Install Script Packages | FIXED |
| H058 | Unredacted RPC URL | FIXED |
| H086 | No Crank Health Check | FIXED |
| H097 | Graduation Irreversibility | ACCEPTED_RISK |
| H102 | Cross-Program Upgrade Cascade | ACCEPTED_RISK |
| H103 | Bounty Rent-Exempt Gap | FIXED |
| H104 | EpochState Layout Coupling | FIXED |
| H105 | Pubkey::default() Placeholders | FIXED |
| S001 | Chained Supply Chain Attack | FIXED |

---

## LOW Findings (23)

| Status | Count | IDs |
|--------|-------|-----|
| **FIXED** (6) | 6 | H012, H036 (new), H037, H038, H054, H092 |
| **NOT_FIXED** (12) | 12 | H021, H028, H031, H033, H039, H041, H056, H069, H072, H076, H084, H089 |
| **ACCEPTED_RISK** (5) | 5 | H048, H060, H085, H091, H095, H096 |

### LOW Detail (NOT_FIXED)

| ID | Title | Detail |
|----|-------|--------|
| H021 | Patch-Mint Trust Amplifier | sync-program-ids.ts still patches source from raw keypair JSON. No integrity validation. |
| H028 | Health Info Disclosure | `/api/health` still returns `{postgres, solanaRpc}` status publicly. |
| H031 | No unhandledRejection | `process.on('unhandledRejection')` still absent in crank-runner.ts. |
| H033 | Candle Close Ordering | GREATEST/LEAST upsert has no timestamp-ordering guard on `close`. |
| H039 | skipPreflight on BC TXs | BuyForm.tsx:191, SellForm.tsx:200 still skip preflight. |
| H041 | No Compute Budget on BC | No ComputeBudgetProgram in curve-tx-builder or BC forms. |
| H056 | Deprecated npm Packages | glob@7.x, inflight@1.x still in lockfile (build-time only). |
| H069 | No Minimum Sell Amount | SellForm allows dust sells (>0 passes). |
| H072 | Price Impact Additive | `reduce((sum, s) => sum + s.priceImpactBps, 0)` — conservative direction, display-only. |
| H076 | Crank Logs Balance | Low-balance warning still logs SOL amount (public info). |
| H084 | Constants Drift | No automated CI sync check between constants.ts and on-chain. |
| H089 | Error Truncation 300 chars | `String(err).slice(0, 300)` still present. Anchor `.logs` discarded. |

---

## Regression Scan

**No regressions detected.** All files modified since 2026-03-12 checked:

| File | Status | Detail |
|------|--------|--------|
| app/app/api/rpc/route.ts | CLEAN | Rate limiting, method allowlist, failover all intact |
| app/app/api/sol-price/route.ts | CLEAN | Rate limiting intact, no API keys |
| app/app/api/webhooks/helius/route.ts | CLEAN | Fail-closed auth, timingSafeEqual, replay protection, body limit |
| app/middleware.ts | CLEAN | Security headers in next.config.ts (HSTS, CSP with Sentry US) |
| shared/constants.ts | CLEAN | Public addresses only, auto-generated header |
| scripts/deploy/stage-*.sh (7 files) | CLEAN | All secrets from env files, confirmation prompts, keypair git-staging check |
| app/components/launch/BuyForm.tsx | NOTED | skipPreflight=true (pre-existing H039, documented) |
| app/components/launch/SellForm.tsx | NOTED | skipPreflight=true (pre-existing H039, documented) |

Secret scan on all modified files: **0 hardcoded secrets found.**

---

## Attack Tree Impact

| Attack Tree | Round 3 (03-12) | Round 4 (03-16) | Key Changes |
|-------------|-----------------|-----------------|-------------|
| Tree 1: Fund Theft (~2000 SOL) | **BLOCKED** | **BLOCKED** | Stable |
| Tree 2: Protocol Brick | **BLOCKED** | **BLOCKED** | Stable |
| Tree 3: Data Pipeline Takeover | **BLOCKED** | **BLOCKED** | Stable |
| Tree 4: Crank Wallet Drain | **LARGELY BLOCKED** | **LARGELY BLOCKED** | No external alerting still |
| Tree 5: Service Disruption | **BLOCKED** | **BLOCKED** | Stable |
| Tree 6: MEV Extraction | **MITIGATED** | **MITIGATED** | Default slippage still high |

---

## Recommendations (Priority Ordered)

### Should Fix Before Mainnet

1. **H015 — Default slippage**: Change `slippageBps: 500` to `slippageBps: 100` in `app/providers/SettingsProvider.tsx:170`. One-line change. UI presets already offer 0.5%/1%/2%.

2. **H017 — Staking escrow monitoring**: Add balance check + top-up for staking escrow PDA in crank-runner.ts, analogous to carnage vault monitoring (lines 413-448).

3. **H004 — External alerting**: Add Discord/PagerDuty webhook POST on circuit breaker trip or spending cap hit.

4. **H041 — Compute budget on BC TXs**: Add `ComputeBudgetProgram.setComputeUnitLimit` + `setComputeUnitPrice` to bonding curve transactions. Mainnet priority fees are essential for landing TXs.

### Nice to Have

5. **H039 — skipPreflight**: Evaluate removing `skipPreflight: true` from BuyForm/SellForm for mainnet (may not be needed with non-Phantom RPCs).
6. **H069 — Minimum sell amount**: Add dust sell guard (e.g., minimum 0.01 tokens).
7. **H031 — unhandledRejection**: Add `process.on('unhandledRejection')` handler to crank-runner.ts.

### Accepted Risks (Documented)

- **H106**: No emergency pause — deliberate design decision (D5), 8+ documents.
- **H097**: Graduation irreversibility — terminal state machine, by design.
- **H102**: Cross-program upgrade cascade — mitigated by deploy-all.sh.
- **H004 (partial)**: Plaintext wallet key — standard Solana crank pattern, Railway env encrypted at rest.
- **H005**: Devnet keypairs tracked — accepted risk, mainnet keys gitignored.
- **H048**: Sign-then-send — documented tradeoff, revisit for mainnet.
- **12 LOW findings**: Accepted risks (logging, display, test patterns, infrastructure).

---

## Appendix: Verification Agent Coverage

Round 4 re-verified all 20 non-FIXED findings from round 3 across 7 parallel verification agents plus regression scan on all modified files. Previous verification files in `.bulwark/findings/VERIFY-{ID}.md` remain from rounds 1-3.
