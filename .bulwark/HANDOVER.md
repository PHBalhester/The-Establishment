# Dinh's Bulwark — Audit #2 Handover

**Project:** Dr. Fraudsworth's Finance Factory
**Audit Number:** 2
**Handover Date:** 2026-03-21
**Current HEAD:** `dc063ec859f61f7efc30ad17e9ad7825eb7f2845`

---

## Previous Audit Summary

| Field | Value |
|-------|-------|
| Audit # | 1 |
| Date | 2026-03-07 |
| Commit | `173de1297d73a17b5b6cb52f992301208e7b9b81` |
| Verified through | 2026-03-16 (4 verification rounds) |
| Confirmed findings | 71 |
| Potential findings | 23 |
| Not vulnerable (cleared) | 48 |
| Files scanned | 219 |
| Archive location | `.bulwark-history/2026-03-16-173de12/` |

---

## Delta Summary

| Metric | Value |
|--------|-------|
| Files changed | 98 |
| Insertions | 4,502 |
| Deletions | 2,415 |
| Estimated total off-chain files | ~266 |
| Delta percentage | ~37% |
| Massive rewrite? | **NO** — normal delta |

---

## Changed File Inventory

### Modified Off-Chain Files (HIGH PRIORITY)

| File | Category |
|------|----------|
| `app/app/api/health/route.ts` | API |
| `app/app/api/rpc/route.ts` | API |
| `app/app/api/sse/protocol/route.ts` | API / SSE |
| `app/app/api/webhooks/helius/route.ts` | API / Webhook |
| `app/components/launch/BuySellPanel.tsx` | Frontend / Launch |
| `app/components/launch/RefundPanel.tsx` | Frontend / Launch |
| `app/components/station/SwapStation.tsx` | Frontend / Swap |
| `app/components/station/SwapStatsBar.tsx` | Frontend / Swap |
| `app/components/swap/SwapForm.tsx` | Frontend / Swap |
| `app/hooks/useCarnageData.ts` | Hook |
| `app/hooks/useCurrentSlot.ts` | Hook |
| `app/hooks/useCurveState.ts` | Hook |
| `app/hooks/useEpochState.ts` | Hook |
| `app/hooks/usePoolPrices.ts` | Hook |
| `app/hooks/useProtocolState.ts` | Hook |
| `app/hooks/useStaking.ts` | Hook |
| `app/hooks/useSwap.ts` | Hook |
| `app/hooks/useTokenBalances.ts` | Hook |
| `app/hooks/useTokenSupply.ts` | Hook |
| `app/instrumentation.ts` | Infra |
| `app/lib/anchor.ts` | Lib / Core |
| `app/lib/connection.ts` | Lib / Core |
| `app/lib/protocol-store.ts` | Lib / State |
| `app/lib/sse-connections.ts` | Lib / SSE |
| `app/lib/sse-manager.ts` | Lib / SSE |
| `app/lib/curve/error-map.ts` | Lib / Curve |
| `app/lib/curve/hook-accounts.ts` | Lib / Curve |
| `app/lib/swap/error-map.ts` | Lib / Swap |
| `app/lib/swap/hook-resolver.ts` | Lib / Swap |
| `app/lib/swap/multi-hop-builder.ts` | Lib / Swap |
| `app/lib/swap/swap-builders.ts` | Lib / Swap |
| `app/lib/staking/staking-builders.ts` | Lib / Staking |
| `app/next.config.ts` | Config |
| `app/providers/providers.tsx` | Providers |
| `scripts/deploy/generate-constants.ts` | Deploy |
| `scripts/deploy/upload-metadata.ts` | Deploy |
| `scripts/e2e/lib/carnage-flow.ts` | E2E |
| `scripts/e2e/lib/stress-wallet.ts` | E2E |
| `shared/constants.ts` | Shared |
| `shared/index.ts` | Shared |

### New Off-Chain Files (FULL AUDIT REQUIRED)

| File | Category |
|------|----------|
| `app/lib/__tests__/bigint-json.test.ts` | Test |
| `app/lib/bigint-json.ts` | Lib / Serialization |
| `app/lib/credit-counter.ts` | Lib / Rate Limiting |
| `app/lib/protocol-config.ts` | Lib / Config |
| `app/lib/ws-subscriber.ts` | Lib / WebSocket |
| `app/providers/ClusterConfigProvider.tsx` | Provider |
| `scripts/load-test/k6-sse.js` | Load Test |
| `scripts/load-test/report.json` | Load Test |
| `scripts/load-test/run.ts` | Load Test |
| `scripts/deploy/fix-carnage-wsol.ts` | Deploy / Fix |

### Also Modified (On-Chain / Config / IDL — reference)

- `Anchor.toml`, `programs/*/src/*.rs`, `app/idl/*.json`, `keypairs/*.json`, `deployments/*.json`

---

## Architecture Snapshot

### Trust Zones

The protocol has four trust zones:

1. **Untrusted Zone:** Browser client input, webhook payloads (fail-closed auth since Audit #1 fix), SSE connections (now capped), RPC responses (display only).
2. **Validation Layer:** Webhook auth (fail-closed + timingSafeEqual), input validation (parseFloat + range checks in React hooks), CSP (script-src self + unsafe-inline), rate limiting (added post-Audit #1).
3. **Trusted Zone:** On-chain program enforcement (slippage, caps, PDA ownership), Drizzle ORM parameterized queries, server-side price proxy, wallet adapter sign-then-send flow.
4. **Sensitive Zone:** Crank wallet keypair (WALLET_KEYPAIR env var), admin keypairs (keypairs/ directory, mainnet gitignored), DATABASE_URL, Helius webhook secret.

### Top Invariants

| ID | Invariant | Status (Audit #1) |
|----|-----------|-------------------|
| INV-OC1 | On-chain enforces minimumOutput regardless of client quote | ENFORCED |
| INV-OC2 | Bonding curve math uses BigInt (no Number intermediates) | ENFORCED |
| INV-OC3 | Sell tax is ceil-rounded (protocol-favored) | ENFORCED |
| INV-OC5 | All SQL queries use parameterized ORM | ENFORCED |
| INV-OC6 | Cargo.lock is committed (Rust supply chain pinned) | ENFORCED |
| INV-OC8 | DATABASE_URL must be set (throws on missing) | ENFORCED |
| INV-OC9 | package-lock.json pins all JS deps | ENFORCED (was NOT ENFORCED, fixed) |
| INV-OC10 | Webhook authenticates incoming requests | ENFORCED (was NOT ENFORCED, fixed) |

### Data Flow

```
Browser Users ──→ Next.js Frontend (app/) ──── RPC ────→ Solana
       │          - useSwap, useStaking         ◄── WebSocket ──┘
       │          - BuyForm/SellForm
       │
       │ SSE ◄── /api/sse/protocol (was /candles)
       │              ▲
       │              │ broadcast
       │              │
  Helius ── POST ──→ /api/webhooks/helius ──→ PostgreSQL → Candle Aggregator
                  (fail-closed auth)

  Crank Runner (Railway) ──── RPC ────→ Solana
  - epoch advance, VRF, carnage, vault top-up
```

### On-Chain / Off-Chain Interface

- Off-chain quote engine drives `minimumOutput` — imprecise quotes widen slippage window (H014 was FIXED with BigInt)
- Webhook pipeline feeds chart data — corrupted events affect user perception (H001 FIXED — fail-closed auth)
- Crank signs admin TXs — compromised crank wallet = attacker controls epoch transitions (H004 PARTIALLY_FIXED — spending cap added, no external alerting)
- Cluster config now driven by `NEXT_PUBLIC_CLUSTER` env var — `protocol-config.ts` resolves all addresses (H009 FIXED)

---

## Previous Findings Digest

### Legend

| Tag | Meaning |
|-----|---------|
| RECHECK | Finding's primary file was MODIFIED in the delta — re-audit required |
| VERIFY | Finding's primary file is UNCHANGED — confirm fix still intact |
| N/A | Finding targets a NEW file — not applicable to previous finding |
| RESOLVED_BY_REMOVAL | Finding's file was deleted |

### CRITICAL Findings (3)

| ID | Title | Audit #1 Status | Primary File | Relevance |
|----|-------|-----------------|--------------|-----------|
| H003 | npm Supply Chain Attack | FIXED | `.gitignore`, `railway.toml` | VERIFY |
| H010 | Bonding Curve Authority Theft | FIXED | `programs/bonding_curve/src/instructions/prepare_transition.rs` | VERIFY (on-chain, modified) |
| H016 | Transfer Hook Init Front-Running | FIXED | `programs/transfer-hook/src/instructions/initialize_authority.rs` | VERIFY (on-chain, modified) |

### HIGH Findings (13)

| ID | Title | Audit #1 Status | Primary File | Relevance |
|----|-------|-----------------|--------------|-----------|
| H001 | Webhook Auth Bypass | FIXED | `app/app/api/webhooks/helius/route.ts` | **RECHECK** — file modified |
| H002 | Helius API Key in Bundle | FIXED | `shared/constants.ts` | **RECHECK** — file modified |
| H004 | Crank Wallet Key Compromise | PARTIALLY_FIXED | `scripts/crank/crank-runner.ts` | VERIFY — crank not in delta |
| H005 | Keypairs Committed to Git | PARTIALLY_FIXED | `keypairs/` | VERIFY |
| H008 | SSE Amplification DoS | FIXED | `app/lib/sse-manager.ts` | **RECHECK** — file modified |
| H009 | Devnet Fallback in Production | FIXED | `app/lib/connection.ts` | **RECHECK** — file modified |
| H014 | Quote-Engine Number Overflow | FIXED | `app/lib/swap/quote-engine.ts` | VERIFY — not in delta |
| H015 | No MEV Protection | NOT_FIXED | `app/providers/SettingsProvider.tsx` | VERIFY — not in delta |
| H017 | Staking Escrow Rent Depletion | NOT_FIXED | `scripts/crank/crank-runner.ts` | VERIFY — crank not in delta |
| H019 | Crank No Kill Switch | FIXED | `scripts/crank/crank-runner.ts` | VERIFY — crank not in delta |
| H106 | No Emergency Pause | ACCEPTED_RISK | All programs | VERIFY |
| S001 | Chained Supply Chain Attack | FIXED | `shared/constants.ts` | **RECHECK** — constants modified |
| S004 | Launch Day Attack Bundle | FIXED | Multiple | **RECHECK** — multiple files modified |

### MEDIUM Findings (22)

| ID | Title | Audit #1 Status | Primary File | Relevance |
|----|-------|-----------------|--------------|-----------|
| H002 | Helius API Key in Client Bundle | FIXED | `shared/constants.ts` | **RECHECK** — file modified |
| H011 | DB Without TLS | FIXED | `app/db/connection.ts` | VERIFY |
| H013 | Vault Top-Up Without Limit | FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H022 | Sell Path Zero AMM Slippage | FIXED | `programs/amm/src/instructions/swap_sol_sell.rs` | VERIFY (on-chain) |
| H023 | SSE Connection Exhaustion | FIXED | `app/lib/sse-manager.ts` | **RECHECK** — file modified |
| H024 | No Rate Limiting | FIXED | API routes | **RECHECK** — API routes modified |
| H026 | Missing HSTS | FIXED | `app/next.config.ts` | **RECHECK** — file modified |
| H029 | Crank Infinite Retry | FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H030 | VRF Wait Loop | FIXED | `scripts/vrf/lib/vrf-flow.ts` | VERIFY |
| H034 | Double-Submit Without Guard | FIXED | Frontend swap components | **RECHECK** — swap components modified |
| H045 | No Server Error Reporting | FIXED | `app/instrumentation.ts` | **RECHECK** — file modified |
| H047 | Single RPC No Failover | FIXED | `app/lib/connection.ts` | **RECHECK** — file modified |
| H049 | Webhook No Replay Protection | FIXED | `app/app/api/webhooks/helius/route.ts` | **RECHECK** — file modified |
| H050 | Webhook No Body Size Limit | FIXED | `app/app/api/webhooks/helius/route.ts` | **RECHECK** — file modified |
| H055 | No CI/CD Pipeline | FIXED | `.github/` | VERIFY |
| H057 | Install Script Packages | FIXED | `.npmrc` | VERIFY |
| H058 | Unredacted RPC URL | FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H086 | No Crank Health Check | FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H097 | Graduation Irreversibility | ACCEPTED_RISK | `scripts/graduation/graduate.ts` | VERIFY |
| H102 | Cross-Program Upgrade Cascade | ACCEPTED_RISK | Build pipeline | VERIFY |
| H103 | Bounty Rent-Exempt Gap | FIXED | `programs/epoch-program/` | VERIFY (on-chain) |
| H104 | EpochState Layout Coupling | FIXED | `programs/tax-program/src/helpers/pool_reader.rs` | VERIFY (on-chain) |

### LOW Findings (32)

| ID | Title | Audit #1 Status | Primary File | Relevance |
|----|-------|-----------------|--------------|-----------|
| H012 | Float-to-Int Precision Loss | FIXED | Frontend hooks | **RECHECK** — hooks modified |
| H021 | Patch-Mint Trust Amplifier | NOT_FIXED | `scripts/deploy/generate-constants.ts` | **RECHECK** — file modified |
| H028 | Health Info Disclosure | NOT_FIXED | `app/app/api/health/route.ts` | **RECHECK** — file modified |
| H031 | No unhandledRejection | NOT_FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H033 | Candle Close Ordering | NOT_FIXED | `app/db/candle-aggregator.ts` | VERIFY |
| H036 | Staking Rewards Comment | FIXED | `app/lib/staking/rewards.ts` | VERIFY |
| H037 | Mixed-Denomination Fee Display | FIXED | Route engine | VERIFY |
| H038 | Split Route Zero Fee | FIXED | Route engine | VERIFY |
| H039 | skipPreflight on BC TXs | NOT_FIXED | `app/components/launch/BuyForm.tsx` | **RECHECK** — BuySellPanel modified |
| H041 | No Compute Budget on BC | NOT_FIXED | `app/lib/curve/curve-tx-builder.ts` | VERIFY |
| H048 | Sign-Then-Send | ACCEPTED_RISK | `app/hooks/useProtocolWallet.ts` | VERIFY |
| H054 | Carnage Fallback MEV | FIXED | Epoch program | VERIFY (on-chain) |
| H056 | Deprecated npm Packages | NOT_FIXED | `package-lock.json` | VERIFY |
| H060 | pda-manifest API Key | ACCEPTED_RISK | `scripts/deploy/pda-manifest.json` | VERIFY |
| H069 | No Minimum Sell Amount | NOT_FIXED | Frontend sell forms | **RECHECK** — launch components modified |
| H072 | Price Impact Additive | NOT_FIXED | Route engine | VERIFY |
| H076 | Crank Logs Balance | NOT_FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H084 | Constants Drift | NOT_FIXED | `shared/constants.ts` | **RECHECK** — file modified |
| H085 | Health Always 200 | ACCEPTED_RISK | `app/app/api/health/route.ts` | **RECHECK** — file modified |
| H089 | Error Truncation 300 chars | NOT_FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H091 | No Distributed Lock | ACCEPTED_RISK | Crank runner | VERIFY |
| H092 | SSE Single-Process Only | FIXED | `app/lib/sse-manager.ts` | **RECHECK** — file modified |
| H095 | Deploy .env set -a | ACCEPTED_RISK | Deploy scripts | VERIFY |
| H096 | BN to Number Conversion | ACCEPTED_RISK | Frontend hooks | **RECHECK** — hooks modified |
| H105 | Pubkey::default() Placeholders | FIXED | On-chain programs | VERIFY (on-chain) |
| H110 | No Timelock on Admin | FIXED | Squads governance | VERIFY |
| H111 | RPC Fallback to localhost | FIXED | `scripts/crank/crank-runner.ts` | VERIFY |
| H119 | Fee Calculation Zero for Dust | FIXED | Frontend hooks | **RECHECK** — hooks modified |
| H124 | BuyForm BigInt via Number | FIXED | `app/components/launch/BuyForm.tsx` | **RECHECK** — launch components modified |
| H125 | Demo Mode BigInt via Number | FIXED | Demo code | VERIFY |
| H131 | Webhook URL Discoverable | FIXED | `scripts/webhook-manage.ts` | VERIFY |
| H132 | Railway Dashboard SPOA | ACCEPTED_RISK | Infrastructure | VERIFY |

### Strategy (Combination) Findings

| ID | Title | Audit #1 Status | Relevance |
|----|-------|-----------------|-----------|
| S001 | Chained Webhook + Supply Chain | FIXED | **RECHECK** — constituent files modified |
| S002 | Crank Wallet Drain Loop | FIXED | VERIFY |
| S004 | Launch Day Attack Bundle | FIXED | **RECHECK** — constituent files modified |
| S005 | Staking + Crank Cascade | FIXED | VERIFY |
| S008 | Browser-Console Webhook Hijack | FIXED | **RECHECK** — webhook route modified |
| S009 | Graduation Race | FIXED | VERIFY |
| S010 | VRF Recovery MEV Window | NOT_VULNERABLE | VERIFY |

---

## RECHECK Summary

The following findings MUST be re-verified because their primary files were modified in this delta:

| ID | Severity | Audit #1 Status | Modified File(s) |
|----|----------|-----------------|------------------|
| H001 | HIGH | FIXED | `app/app/api/webhooks/helius/route.ts` |
| H002 | HIGH/MED | FIXED | `shared/constants.ts` |
| H008 | HIGH | FIXED | `app/lib/sse-manager.ts` |
| H009 | HIGH | FIXED | `app/lib/connection.ts` |
| H012 | LOW | FIXED | Frontend hooks (multiple modified) |
| H021 | LOW | NOT_FIXED | `scripts/deploy/generate-constants.ts` |
| H023 | MED | FIXED | `app/lib/sse-manager.ts` |
| H024 | MED | FIXED | API routes (multiple modified) |
| H026 | MED | FIXED | `app/next.config.ts` |
| H028 | LOW | NOT_FIXED | `app/app/api/health/route.ts` |
| H034 | MED | FIXED | Swap/launch components modified |
| H039 | LOW | NOT_FIXED | `app/components/launch/BuySellPanel.tsx` |
| H045 | MED | FIXED | `app/instrumentation.ts` |
| H047 | MED | FIXED | `app/lib/connection.ts` |
| H049 | MED | FIXED | `app/app/api/webhooks/helius/route.ts` |
| H050 | MED | FIXED | `app/app/api/webhooks/helius/route.ts` |
| H069 | LOW | NOT_FIXED | Launch components modified |
| H084 | LOW | NOT_FIXED | `shared/constants.ts` |
| H085 | LOW | ACCEPTED_RISK | `app/app/api/health/route.ts` |
| H092 | LOW | FIXED | `app/lib/sse-manager.ts` |
| H096 | LOW | ACCEPTED_RISK | Frontend hooks modified |
| H119 | LOW | FIXED | Frontend hooks modified |
| H124 | LOW | FIXED | Launch components modified |
| S001 | CRIT | FIXED | `shared/constants.ts` modified |
| S004 | CRIT | FIXED | Multiple constituent files modified |
| S008 | HIGH | FIXED | Webhook route modified |

**Total RECHECK count: 26 findings**

---

## New File Audit Targets

These files did not exist during Audit #1 and require full security analysis:

| File | Risk Assessment | Notes |
|------|-----------------|-------|
| `app/lib/bigint-json.ts` | MEDIUM | Custom serialization — check for injection, overflow, prototype pollution |
| `app/lib/credit-counter.ts` | HIGH | Rate limiting primitive — check for bypass, integer overflow, race conditions |
| `app/lib/protocol-config.ts` | HIGH | Cluster-aware address resolution — check for env var injection, fallback behavior |
| `app/lib/ws-subscriber.ts` | HIGH | WebSocket manager — check for reconnect storms, memory leaks, message injection |
| `app/providers/ClusterConfigProvider.tsx` | MEDIUM | React context — check for unsafe defaults, env var handling |
| `app/lib/__tests__/bigint-json.test.ts` | LOW | Test file — check for hardcoded secrets only |
| `scripts/load-test/k6-sse.js` | LOW | Load test — check for hardcoded credentials |
| `scripts/load-test/report.json` | LOW | Report data — check for leaked secrets |
| `scripts/load-test/run.ts` | LOW | Load test runner — check for hardcoded credentials |
| `scripts/deploy/fix-carnage-wsol.ts` | MEDIUM | Deploy fix script — check for authority handling, keypair safety |

---

## False Positive Log

The following findings were investigated and cleared as NOT VULNERABLE in Audit #1. Entries are included only for findings whose primary files are UNCHANGED in the delta (confirming the clearance remains valid). Findings targeting MODIFIED or NEW files are omitted — they should be re-evaluated.

| ID | Title | Primary File | Reason Cleared |
|----|-------|--------------|----------------|
| H007 | Cross-Epoch Tax Arbitrage via VRF Observation | `scripts/vrf/lib/vrf-flow.ts` | Atomic bundling (reveal+consume+taxUpdate) prevents front-running. No window between VRF reveal and rate update. |
| H018 | Graduation State File Tampering | `scripts/graduation/graduate.ts` | Local file on admin machine. On-chain idempotency checks catch inconsistencies. Filesystem access is itself catastrophic. |
| H020 | IDL Supply Chain via Build Pipeline | `app/scripts/sync-idl.mjs` | IDL generated from on-chain program, not user-supplied. Build toolchain compromise is a separate threat model. |
| H035 | DB Connection Pool Exhaustion | `app/db/connection.ts` | Drizzle pool defaults reasonable. Railway restarts on OOM. |
| H043 | WALLET Env Var Path Traversal | `scripts/crank/crank-provider.ts` | No path traversal vector — env var is JSON content, not a file path. |
| H052 | Version Mismatch @solana/web3.js | `package.json` | Workspace resolution handles version alignment. No runtime divergence. |
| H059 | COMMITMENT Env Var Unsafe Cast | `scripts/crank/crank-provider.ts` | Only used for RPC commitment level. Invalid value causes RPC error, not security issue. |
| H061 | No Negative Amount Guards on Quote | `app/lib/swap/quote-engine.ts` | On-chain enforces amounts. Frontend UI prevents negative input. |
| H062 | Candle Aggregator Float Precision | `app/db/candle-aggregator.ts` | Display-only. Price precision adequate for chart rendering. |
| H064 | ALT Cache Stale Data | `scripts/e2e/lib/alt-helper.ts` | Self-healing: `getOrCreateProtocolALT` validates and extends. |
| H066 | Dependency Confusion @dr-fraudsworth/shared | Root `package.json` | Workspace protocol (`workspace:*`) prevents npm registry resolution. |
| H067 | Railway Migration Injection | `railway.toml` | Railway build commands are controlled by repo owner. No injection vector. |
| H068 | BuyForm Cap Check Validation Race | Frontend components | Sequential in same tick; on-chain enforces cap independently. |
| H073 | DB Connection Singleton Race | `app/db/connection.ts` | Node.js module cache ensures singleton. No race condition. |
| H074 | No localStorage Cleanup on Wallet Disconnect | Frontend | Only slippage/volume prefs stored. No sensitive data. |
| H075 | 100% Slippage Allowed | Frontend | UI caps at 50%. On-chain enforces minimumOutput. |
| H079 | SOL Price Proxy 60s Cache Staleness | API route | Display-only. 60s cache is standard practice. |
| H080 | No X-Permitted-Cross-Domain-Policies | Config | No Flash/Silverlight content. Header is legacy. |
| H081 | connect-src Missing CoinGecko/Binance | Config | Server-side proxy handles external API calls. Browser never connects directly. |
| H082 | Logger logFilePath Not Validated | Crank runner | Crank runs in controlled Railway environment. No user-supplied paths. |
| H083 | IDL Name Parameter Not Validated | Lib | Parameter is compile-time constant, not user input. |
| H088 | Auto-Reset Timer in useSwap | Hook | UX pattern. No security impact. |
| H098 | Quote Engine Stale Data from Processed Commitment | Quote engine | On-chain slippage check is the safety net. Stale quote = slightly worse UX, not exploitable. |
| H100 | Dual Seed Registry Drift | Deploy scripts | One-time deployment. Registry validated during init. |
| H101 | WSOL Intermediary DoS | Swap builders | Standard Solana WSOL pattern. No DoS vector. |
| H107 | Dual-Curve Grief Attack | On-chain | Bonding curve authority check (H010 fix) prevents unauthorized interaction. |
| H108 | Carnage VRF Predictability Window | On-chain + VRF | Switchboard VRF is cryptographically secure. No predictability. |
| H109 | Conversion Vault Whitelist Before Authority Burn | Deploy pipeline | Authority NOT burned (project decision). Squads multisig holds it. |
| H112 | Audio Manager Math.random() | Frontend | Audio selection, not security-sensitive. |
| H114 | globalThis Singleton HMR Leak | Frontend | Dev-only issue. Production builds don't use HMR. |
| H115 | No CORS Configuration | API routes | Next.js App Router handles CORS. Same-origin by default. |
| H116 | Privy Chain Configuration | Frontend | Privy removed — project uses wallet-adapter-react. |
| H117 | Webhook TX Signature Uniqueness | Webhook route | `onConflictDoNothing` is correct idempotency pattern. |
| H120 | Borsh Deserialization of Untrusted Data | Lib | Anchor deserializes from on-chain accounts (trusted source). |
| H121 | No Source Maps in Production | Frontend | Correct — source maps disabled in production builds. |
| H122 | Dead Code in rewards.ts | Lib | APR display disabled. Dead code is not a vulnerability. |
| H123 | Solana CLI v3 --keypair Flag | Scripts | Workaround in place (web3.js direct). |
| H126 | No Anti-Flicker on Route Selection | Frontend | Well-implemented debounce pattern. |
| H127 | Wallet-Adapter autoConnect Internal State | Frontend | Standard wallet-adapter behavior. |
| H128 | SellForm Correct Slippage on Net | Frontend | Slippage applied correctly to net output. |
| H129 | Vault Conversion Rate Hardcoded at 100 | On-chain | Conversion rate is a protocol constant, not configurable. By design. |

**Findings from Audit #1 NOT VULNERABLE list targeting MODIFIED files (excluded from false positive log — must be re-evaluated):**

| ID | Title | Modified File |
|----|-------|---------------|
| H006 | Webhook Timing Attack | `app/app/api/webhooks/helius/route.ts` |
| H025 | CSP unsafe-inline XSS | `app/next.config.ts` |
| H027 | Iframe Sandbox Weakness | May reference modified components |
| H032 | WebSocket Reconnection Loss | `app/hooks/useEpochState.ts`, `app/hooks/useCurveState.ts` |
| H048 | Sign-Then-Send (was NOT_VULNERABLE, later ACCEPTED_RISK) | `app/hooks/useProtocolWallet.ts` — check if modified |
| H051 | CustomEvent RPC DoS | `app/hooks/useTokenBalances.ts` |
| H053 | Pool Reserve Read Without Owner Check | `app/hooks/usePoolPrices.ts` |
| H065 | WSOL ATA Race Condition | `app/lib/swap/swap-builders.ts` |
| S010 | VRF Recovery MEV Window | `scripts/vrf/lib/vrf-flow.ts` — check if modified |

---

## Attack Tree Status (from Audit #1)

| Attack Tree | Audit #1 Final Status | Delta Impact |
|-------------|----------------------|--------------|
| Tree 1: Fund Theft (~2000 SOL) | **BLOCKED** | Verify H010 fix intact (on-chain modified) |
| Tree 2: Protocol Brick | **BLOCKED** | Verify H016 fix intact (on-chain modified) |
| Tree 3: Data Pipeline Takeover | **BLOCKED** | **RECHECK** — webhook route + SSE manager modified |
| Tree 4: Crank Wallet Drain | **LARGELY BLOCKED** | VERIFY — crank not in delta |
| Tree 5: Service Disruption | **BLOCKED** | **RECHECK** — SSE + connection modified |
| Tree 6: MEV Extraction | **MITIGATED** | VERIFY — no MEV-relevant changes apparent |

---

## Open Items from Audit #1

These findings were NOT_FIXED or PARTIALLY_FIXED at the end of Audit #1 verification. Check if any were addressed in this delta:

| ID | Severity | Status | Recommendation |
|----|----------|--------|---------------|
| H015 | HIGH | NOT_FIXED | Default slippage still 500 BPS. One-line fix in SettingsProvider.tsx:170. |
| H017 | HIGH | NOT_FIXED | Staking escrow monitoring absent from crank. |
| H004 | HIGH | PARTIALLY_FIXED | No external alerting on circuit breaker trip. |
| H005 | HIGH | PARTIALLY_FIXED | 17 devnet keypairs still tracked. Git history not purged. |
| H021 | LOW | NOT_FIXED | sync-program-ids.ts patches source from raw keypair JSON. |
| H028 | LOW | NOT_FIXED | /api/health returns internal dependency status publicly. |
| H031 | LOW | NOT_FIXED | No unhandledRejection handler in crank. |
| H033 | LOW | NOT_FIXED | Candle close price ordering on concurrent webhooks. |
| H039 | LOW | NOT_FIXED | skipPreflight on bonding curve TXs. |
| H041 | LOW | NOT_FIXED | No ComputeBudgetProgram on BC TXs. |
| H056 | LOW | NOT_FIXED | glob@7.x, inflight@1.x deprecated (build-time only). |
| H069 | LOW | NOT_FIXED | SellForm allows dust sells. |
| H072 | LOW | NOT_FIXED | Price impact additive not multiplicative (display-only, conservative). |
| H076 | LOW | NOT_FIXED | Crank logs wallet balance (public info). |
| H084 | LOW | NOT_FIXED | No automated CI sync for constants.ts vs on-chain. |
| H089 | LOW | NOT_FIXED | Error truncation to 300 chars, Anchor .logs discarded. |

---

## Audit #2 Focus Areas

Based on the delta analysis, the new audit should prioritize:

1. **WebSocket Subscriber (`app/lib/ws-subscriber.ts`)** — New file. Manages real-time Solana WebSocket subscriptions. High risk for reconnect storms, memory leaks, connection exhaustion.

2. **Protocol Config (`app/lib/protocol-config.ts`)** — New file. Cluster-aware address resolution. Misconfiguration could route mainnet transactions to wrong addresses.

3. **Credit Counter (`app/lib/credit-counter.ts`)** — New file. Rate limiting primitive. Bypass would re-expose H024 (no rate limiting).

4. **SSE Pipeline Rework** — `sse-manager.ts`, `sse-connections.ts`, `app/api/sse/protocol/route.ts` all modified. Verify H008 (amplification DoS) and H023 (connection exhaustion) fixes survived.

5. **Webhook Route** — `app/api/webhooks/helius/route.ts` modified. Verify H001 (fail-closed auth), H049 (replay protection), H050 (body size limit) fixes survived.

6. **Connection / Provider Changes** — `connection.ts`, `providers.tsx` modified. Verify H009 (devnet fallback) and H047 (RPC failover) fixes survived.

7. **Hook / State Management Changes** — 10 hooks modified. Check for new state management bugs, race conditions, stale data patterns.

8. **Deploy Script Changes** — `generate-constants.ts`, `upload-metadata.ts`, `fix-carnage-wsol.ts` (new). Check for keypair handling, authority safety.

9. **BigInt JSON Serialization** — New `bigint-json.ts`. Custom serializers are common vulnerability sources (prototype pollution, injection).

10. **Cluster Config Provider** — New React provider for cluster awareness. Verify no unsafe env var handling or fallback defaults.

---

## Verification Checklist

Before concluding Audit #2, verify:

- [ ] All 26 RECHECK findings confirmed (fix survived or regression identified)
- [ ] All 10 new files audited
- [ ] All VERIFY findings spot-checked (unchanged files, fixes intact)
- [ ] New attack surfaces from ws-subscriber, credit-counter, protocol-config analyzed
- [ ] SSE pipeline rework analyzed for amplification/exhaustion regressions
- [ ] Webhook auth chain (H001 + H049 + H050) verified intact
- [ ] On-chain program modifications cross-referenced for new cross-boundary issues
- [ ] Attack trees updated with any new findings
- [ ] False positive log entries for modified files re-evaluated

---

*Generated for Dinh's Bulwark Audit #2. Previous audit archive: `.bulwark-history/2026-03-16-173de12/`*
