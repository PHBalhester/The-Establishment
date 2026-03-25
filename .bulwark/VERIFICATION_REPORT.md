# Dinh's Bulwark — Verification Report

**Original Audit Date:** 2026-03-21
**Verification Date:** 2026-03-25
**Findings Verified:** 35 (priority-filtered for open-source fund-safety)
**Verification Focus:** Can users be directly drained/lose money? Wallet security, website security.
**Open-Source Strategy:** Fresh repo (no git history carries over) — secret-in-history findings mitigated by default.

---

## Summary

| Status | Count |
|--------|-------|
| FIXED | 9 |
| PARTIALLY_FIXED | 8 |
| NOT_FIXED | 11 |
| MITIGATED_BY_NEW_REPO | 5 |
| ACCEPTED_RISK | 2 |

---

## Tier 0: Mitigated by Fresh Repo Strategy

These findings are about secrets/keys in git history. Since the open-source release uses a **new repo** with sanitized content, the git-history attack vectors are eliminated. **However**, the underlying issues in the working tree should still be cleaned up for operational security.

| ID | Severity | Finding | Current Code Status | New Repo Status |
|----|----------|---------|-------------------|-----------------|
| H001 | CRITICAL | Private key in `.mcp.json` | NOT_FIXED — key still in file, still tracked, wallet not rotated | **MITIGATED** — fresh repo won't contain history. Still: rotate wallet, remove key from file. |
| H002 | HIGH | Mainnet Helius key in `deployment-report.md` | NOT_FIXED — key in committed report | **MITIGATED** — won't be in new repo. Still: rotate both Helius keys. |
| H004 | HIGH | Helius API key in `shared/programs.ts` | NOT_FIXED — hardcoded devnet key at line 24 | **MITIGATED** — replace with env var before copying to new repo. |
| H012 | HIGH | 17 devnet keypairs in git | NOT_FIXED — 18 files tracked | **MITIGATED** — `.gitignore` keypairs in new repo. |
| S010 | CRITICAL | Repo clone → full takeover chain | NOT_FIXED in current repo | **MITIGATED** — chain requires H001+H012 from git history. |

### Action items (operational, not blocking open-source):
1. Rotate devnet wallet `8kPzhQ...` — private key is compromised in current repo
2. Rotate both Helius API keys (`[REDACTED-DEVNET-KEY]` devnet, `[REDACTED-MAINNET-KEY]` mainnet)
3. Ensure new repo `.gitignore` excludes: `.mcp.json`, `keypairs/*.json`, `.env.*`, `deployment-report.md`
4. Replace hardcoded Helius URL in `shared/programs.ts:24` with env var

---

## Tier 1: CRITICAL for User Fund Safety

### FIXED

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| H096 | HIGH | No bounds check after Anchor decode | `webhook-validators.ts` validates all account types: BPS in [0,10000], reserves >= 0, feeDenominator > 0 |
| H119 | HIGH | Decode failure broadcasts raw data via SSE | Catch block explicitly skips `setAccountState()`; logs + Sentry only |
| H008 | HIGH | RPC batch amplification | Batches rejected outright (`Array.isArray` → 400); 64KB body cap added |
| H010 | HIGH | RPC proxy no fetch timeout | `AbortSignal.timeout(10_000)` on all upstream fetches |
| H003 | HIGH | Supply chain via `npm install` | `railway-crank.toml` buildCommand is now `echo 'install complete'` (no-op) |
| H007 | HIGH | Dependency confusion `@dr-fraudsworth` scope | `app/package.json` uses `"file:../shared"` — never resolves from npm registry |
| H058 | MEDIUM | Webhook type confusion | Discriminators are functionally exclusive; no replay bypass possible |

### PARTIALLY FIXED

| ID | Severity | Finding | What's Fixed | What's Still Open |
|----|----------|---------|-------------|-------------------|
| H005 | HIGH | Webhook state injection | Semantic validator gates all decoded data; H011 slot freshness now blocks replays | Residual: maximally-valid-but-adversarial values within bounds |
| H020 | HIGH | Webhook→SSE injection chain | Chain broken for crafted data (H096+H119) AND stale replays (H011) | Residual: same-slot adversarial data within bounds |
| H006 | HIGH | `NEXT_PUBLIC_RPC_URL` API key exposure | Browser always uses `/api/rpc` proxy, never reads the var client-side | `.env.mainnet` template still instructs setting it with `NEXT_PUBLIC_` prefix — any operator following template leaks key in JS bundle |

### NOT FIXED — Requires Action Before Open-Source

| ID | Severity | Finding | Risk to Users | Recommended Fix |
|----|----------|---------|--------------|-----------------|
| ~~H011~~ | ~~HIGH~~ | ~~Enhanced webhook replay — no slot freshness~~ | **FIXED** — Slot-monotonic check added to `handleAccountChanges()`. Rejects payloads with `slot < lastAcceptedSlot`. Watermarks seeded at startup via `batchSeed()`. 16 tests. | N/A |
| **H013** | **HIGH** | CarnageSolVault balance desync | `nativeBalanceChange` (delta) stored as absolute balance — displays wildly wrong Carnage fund | Use `getAccountInfo` for actual lamports instead of webhook delta |
| **H018** | **HIGH** | No MEV-protected submission | Every swap sandwichable for up to 5% extraction via public mempool | Integrate Jito bundle submission; reduce default slippage |
| **H016** | **HIGH** | Default 5% slippage | Up to 5% extractable per swap | Reduce default to 100 BPS (1%); cap localStorage validation at 5000 BPS |

---

## Tier 2: Service Availability / DoS

### FIXED

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| H028 | MEDIUM | 5 of 8 routes unprotected | `/api/candles`, `/api/carnage-events`, both SSE routes now rate-limited; `/api/health` intentionally exempt (Railway liveness) |

### PARTIALLY FIXED

| ID | Severity | Finding | What's Fixed | What's Still Open |
|----|----------|---------|-------------|-------------------|
| H015 | MEDIUM | IP spoofing bypasses rate limits | Envoy `x-envoy-external-address` prioritized (not client-spoofable on Railway) | No IP-format validation as defensive fallback |
| H047 | MEDIUM | No rate limits on DB endpoints | Rate limiting added on both routes | `connectionTimeoutMillis` absent from postgres.js config |

### NOT FIXED

| ID | Severity | Finding | Risk | Recommended Fix |
|----|----------|---------|------|-----------------|
| H019 | MEDIUM | gapFillCandles memory amplification | 29M synthetic candles OOM with `from=0&resolution=1m&gapfill=true` | Cap `(rangeEnd - alignedStart) / step` before loop (e.g., max 10,000 synthetic candles) |
| H060 | MEDIUM | RPC proxy as free TX relay | Anyone can submit arbitrary TXs through paid Helius endpoint | Remove `sendTransaction` from allowlist or add per-method sub-limit |
| H014 | MEDIUM | Webhook body size guard bypassed via chunked encoding | Large payloads bypass Content-Length check | Read body stream with byte counter, or use middleware size limit |

---

## Tier 3: Website Security

### NOT FIXED

| ID | Severity | Finding | Risk | Recommended Fix |
|----|----------|---------|------|-----------------|
| H100 | MEDIUM | CSP `script-src 'unsafe-inline'` | XSS via inline scripts not blocked by CSP | Implement nonce-based CSP (Next.js 13+ supports this natively) |
| H041 | MEDIUM | Health endpoint exposes internals | ws-subscriber state, credit stats, dependency health — no auth | Add basic auth or restrict to internal network |
| H026 | MEDIUM | `protocol-config.ts` defaults to devnet | Misconfigured deploy silently uses devnet addresses | Throw error if `NEXT_PUBLIC_CLUSTER` unset in production |
| H036 | LOW | `toBaseUnits` float precision loss | Fractional token units lost via IEEE 754 | Use BigInt-safe conversion |
| H071 | LOW | Missing CORS on SSE responses | Cross-origin SSE access possible | Add explicit CORS headers |
| H111 | MEDIUM | Deploy logger path traversal | Arbitrary filesystem write from unsanitized path | Validate path stays within allowed directory |
| H110 | MEDIUM | Shell injection via WALLET env var | Operator script vulnerable to env var injection | Use `execFileSync` with argument array |

### PARTIALLY FIXED

| ID | Severity | Finding | What's Fixed | What's Still Open |
|----|----------|---------|-------------|-------------------|
| H034 | LOW | Double-submit no in-function guard | Status state machine exists | No explicit mutex/`if (status !== "idle") return` at function entry |
| H069 | LOW | SSE zombie via NAT/CGNAT | Auto-release timeout reduced to 5 min | Per-IP cap still 10; corporate NAT = 5 users max |

---

## Findings NOT Verified (Deprioritized per User Direction)

The following were excluded from this verification pass as they do not represent direct fund-loss or wallet-compromise vectors:

- H013 CarnageSolVault display (known bug, no fund loss)
- H044/H045/H049/H050/H051 — ws-subscriber robustness issues
- H054/H056/H075 — Crank error handling / alerting
- H057/H093/H095 — DB TLS / connection pool
- H059/H061/H065/H067/H070 — SSE/info-disclosure
- H072-H132 — LOW/INFO/ACCEPTED findings
- S001-S009 — Combination chains (verified via constituent findings)

---

## Priority Actions for Open-Source Readiness

### MUST FIX (users can lose money):

1. ~~**H011 — Webhook replay protection**~~: **FIXED** — Slot-monotonic check implemented.
2. **H016 — Default 5% slippage**: ACCEPTED RISK — intentional design decision. Asymmetric 14% minimum tax makes MEV sandwiching unprofitable (attacker pays ~28% taxes to extract ≤5%).
3. **H018 — No MEV-protected submission**: ACCEPTED RISK — on-chain tax structure IS the MEV protection. 14% minimum tax per swap leg makes sandwich attacks net-negative for attackers.

### SHOULD FIX (service availability / hardening):

4. **H019 — gapFill range cap**: Prevent OOM by capping synthetic candle generation.
5. **H060 — Remove `sendTransaction` from RPC proxy**: Prevents cost abuse of Helius credits.
6. **H100 — Nonce-based CSP**: Eliminates XSS via inline script injection.
7. **H026 — Production cluster guard**: Throw error if `NEXT_PUBLIC_CLUSTER` unset in production.

### SHOULD FIX (before new repo push):

8. **H004 — Remove hardcoded Helius URL from `shared/programs.ts:24`**
9. **H006 — Rename `NEXT_PUBLIC_RPC_URL` to non-public prefix in `.env.mainnet` template**
10. **Rotate all compromised credentials**: devnet wallet, both Helius API keys, webhook secret

---

## Regression Scan

No regressions detected in the fixed findings. The H096 semantic validation layer and H119 catch-block fix are both clean and well-commented. The H008 batch rejection is decisive. Supply chain fixes (H003, H007) are solid.

---

*Report generated by Dinh's Bulwark v1.0 verification pass.*
