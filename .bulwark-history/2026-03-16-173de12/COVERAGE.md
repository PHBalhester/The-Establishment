# Bulwark Off-Chain Audit -- Coverage Verification Report

**Generated:** 2026-03-07
**Auditor:** Coverage Verification Agent
**Scope:** 132 hypothesis findings (H001-H132) + 10 strategy findings (S001-S010)
**Status Distribution:** 61 CONFIRMED, 23 POTENTIAL, 48 NOT VULNERABLE

---

## 1. Component Coverage

| Component | Location | Findings Referencing | Adequately Covered? | Notes |
|-----------|----------|---------------------|---------------------|-------|
| Next.js Frontend | `app/` | ~30 (swap UI, forms, hooks, wallet) | YES | BuyForm, SellForm, useSwap, useStaking, quote-engine, route-engine, curve-math, Privy wallet all examined. H012, H014, H034, H037-H040, H068-H069, H072, H075, H124-H128. |
| API Routes (6) | `app/app/api/` | ~36 (webhook) + ~20 (candles) + ~6 (sol-price) + ~2 (carnage-events) + ~87 (SSE) + ~17 (health) | PARTIAL -- see G001 | Webhook and SSE heavily covered. Health, candles, sol-price adequately covered. Carnage-events endpoint has only incidental coverage (H024, H090). |
| Crank Runner | `scripts/crank/` | ~41 | YES | Spending limits (H013), kill switch (H019), retry logic (H029-H030), error handling (H031), logging (H058, H076), health checks (H086), distributed lock (H091). Thorough. |
| PostgreSQL + Drizzle | `app/db/` | ~27 | YES | TLS (H011), connection pool (H035, H073), parameterized queries (INV-OC5 confirmed), candle aggregator precision (H062), migration injection (H067). |
| Deployment Scripts | `scripts/deploy/`, `scripts/graduation/` | ~43 | YES | Graduation irreversibility (H018, H097), env sourcing (H095), ALT cache (H064), initialize.ts, patch-mint-addresses (H021), keypair management (H005). |
| Shared Constants | `shared/` | ~22 | YES | Constants drift (H084), API key in constants (H002, H060), dependency confusion (H066), exports raw TS (H087), epoch duration hardcoded (H070). |
| E2E Test Scripts | `scripts/e2e/`, `tests/integration/` | ~5 | PARTIAL -- see G002 | Only incidental references. No dedicated finding examines test script security (e.g., test fixtures leaking secrets, test wallet management, test-only code paths in production). |

**Component Coverage Estimate: ~90%**

---

## 2. Pattern Coverage

| Security Pattern | Findings Count | Adequately Covered? | Key Findings |
|-----------------|---------------|---------------------|--------------|
| Authentication/Authorization | ~45 | YES | H001 (webhook fail-open), H006 (timing attack), H049 (replay), H117 (signature uniqueness) |
| Secret Management | ~40 | YES | H002 (API key in bundle), H004 (crank wallet), H005 (keypairs in git), H060 (PDA manifest API key) |
| Transaction Construction | ~73 | YES | H012 (float-to-int), H039 (skipPreflight), H041 (no compute budget), H048 (sign-then-send) |
| RPC Trust/Failover | ~74 | YES | H009 (devnet fallback), H047 (single provider), H098 (stale commitment), H111 (localhost fallback) |
| MEV Protection | ~18 | YES | H015 (sandwich attack), H040 (5% slippage), H054 (carnage MEV), H113 (split route observability), S003 (precision+slippage stack) |
| Supply Chain | ~29 | YES | H003 (lockfile gitignored), H020 (IDL supply chain), H056 (deprecated pkgs), H057 (install scripts), H066 (dependency confusion), H071 (React override) |
| Rate Limiting | ~28 | YES | H024 (no rate limiting anywhere), H023 (SSE exhaustion), H050 (webhook body size), H051 (CustomEvent RPC DoS) |
| Error Handling | ~22 | YES | H029 (infinite retry), H031 (unhandledRejection), H045 (no server-side reporting), H089 (error truncation) |
| Financial Precision | ~42 | YES | H014 (Number overflow), H012 (float-to-int), H062 (candle float), H072 (price impact math), H096 (BN to Number), H119 (dust fees), H124-H125 (BigInt via Number) |
| State Synchronization | ~46 | YES | H032 (WebSocket reconnection), H033 (out-of-order webhooks), H064 (ALT stale), H092 (SSE single-process), H098 (stale commitment), H104 (layout coupling) |
| Infrastructure Security | ~63 | YES | H011 (no TLS), H026 (no HSTS), H077 (no resource limits), H086 (no crank health check), H132 (Railway SPOA) |

**Pattern Coverage Estimate: ~95%**

---

## 3. API Surface Coverage

| Endpoint | Method | Dedicated Findings | Coverage Level |
|----------|--------|-------------------|----------------|
| `/api/webhooks/helius` | POST | H001, H006, H008, H049, H050, H117, H131 | THOROUGH -- Auth bypass, timing attack, amplification, replay, body size, signature uniqueness all examined. |
| `/api/sse/candles` | GET | H008, H023, H092 | THOROUGH -- Amplification, connection exhaustion, single-process limitation all examined. |
| `/api/candles` | GET | H024 (rate limiting), H062 (precision) | ADEQUATE -- Parameterized SQL confirmed (INV-OC5). Rate limiting gap noted. |
| `/api/sol-price` | GET | H079 (cache staleness), H118 (timeout handling) | ADEQUATE -- Cache behavior and upstream timeout examined. |
| `/api/health` | GET | H028 (info disclosure), H085 (always 200) | ADEQUATE -- Both key issues (information leak, no real health check) examined. |
| `/api/carnage-events` | GET | H024 (rate limiting mention only), H090 (fetch timeout) | THIN -- see G001 |

**API Surface Coverage Estimate: ~85%**

---

## 4. Gap Hypotheses

### G001 -- `/api/carnage-events` Endpoint Under-Examined (MEDIUM)

**Observation:** The carnage-events endpoint appears in only 2 findings (H024 and H090), both as incidental mentions in broader findings about rate limiting and fetch timeouts. No dedicated finding examines:
- Query parameter injection or abuse (e.g., unbounded `limit` parameter causing expensive DB queries)
- Response payload size (large result sets from unbounded queries)
- Whether event data can be manipulated via the webhook pipeline (carnage events likely flow through the same Helius webhook ingestion)
- Information disclosure in carnage event payloads (VRF outcomes, vault balances)

**Risk:** LOW-MEDIUM. The endpoint is read-only and uses Drizzle ORM (parameterized), so SQL injection is not a concern. The main risk is resource consumption from unbounded queries or information disclosure. On-chain data is public anyway, limiting the information disclosure risk.

**Recommendation:** No immediate action. If the endpoint accepts user-controlled pagination parameters, verify bounds exist.

### G002 -- E2E/Integration Test Scripts Not Audited as Attack Surface (LOW)

**Observation:** The E2E test scripts (`scripts/e2e/lib/swap-flow.ts`, `tests/integration/cpi-chains.test.ts`, `tests/integration/smoke.test.ts`) are referenced in ~5 findings but only as supporting evidence. No finding examines:
- Whether test-only code paths or test fixtures leak into production builds
- Whether test wallet keypairs are reused in production
- Whether test scripts contain hardcoded secrets that differ from production

**Risk:** LOW. Test scripts run locally or in CI, not in production. The main risk is test keypair reuse (already partially covered by H005 which flags all keypairs in the `keypairs/` directory).

**Recommendation:** No immediate action.

### G003 -- Cross-Boundary Graduation Race Not Fully Explored Off-Chain (MEDIUM)

**Observation:** S009 covers the graduation race condition, and H010/H018 cover the on-chain authority gap and state file tampering. However, no finding specifically examines whether the graduation script has sufficient atomic guarantees -- i.e., whether an attacker can observe the `prepare_transition` TX on-chain and front-run `withdraw_graduated_sol` before the script's next step completes.

**Risk:** MEDIUM. This is partially an on-chain issue (SOS audit found the authority gap), but the off-chain script's timing between steps determines the exploit window size. S009 addresses this at the strategy level but the individual investigation was thin.

**Recommendation:** Verify S009 includes specific timing analysis of the graduation script's inter-step delay.

---

## 5. Coverage Summary

| Dimension | Estimated Coverage | Gaps Found |
|-----------|--------------------|------------|
| Component Coverage | **90%** | G001 (carnage-events thin), G002 (E2E scripts) |
| Pattern Coverage | **95%** | None significant |
| API Surface Coverage | **85%** | G001 (carnage-events) |
| Cross-Boundary Coverage | **90%** | G003 (graduation timing) |
| **Overall** | **~90%** | 3 gaps, none CRITICAL |

---

## 6. Recommendations (CRITICAL/HIGH Gaps Only)

No CRITICAL or HIGH coverage gaps were identified. The audit achieved comprehensive coverage across all major components, security patterns, and API endpoints. The three gap hypotheses are rated MEDIUM and LOW.

The audit's strongest coverage areas are:
- **Webhook pipeline** (7+ dedicated findings, multiple attack strategies)
- **Secret management** (5+ dedicated findings covering all secret types)
- **Crank runner safety** (8+ dedicated findings covering all identified risks)
- **Financial precision** (10+ findings across Number overflow, float-to-int, BigInt inconsistency)

The audit's thinnest areas are:
- **Carnage-events endpoint** (incidental coverage only -- but risk is inherently low for a read-only parameterized endpoint)
- **E2E test script security** (not examined as attack surface -- but test scripts don't run in production)

---

**Conclusion:** The Bulwark off-chain audit achieved strong coverage. All 6 architecture components were examined, all 11 security patterns were addressed with multiple findings each, and 5 of 6 API endpoints received dedicated analysis. The 132 hypothesis findings + 10 strategy findings represent thorough investigation. No remediation-blocking coverage gaps exist.
