---
doc_id: mainnet-readiness-assessment
title: "Dr. Fraudsworth's Finance Factory -- Mainnet Readiness Assessment"
wave: 4
requires: []
provides: [mainnet-readiness-assessment]
status: draft
decisions_referenced: [architecture, security, testing, operations, token-model]
needs_verification: [mainnet-priority-fee-vs-bounty-economics, carnage-fallback-front-running-frequency]
---

# Mainnet Readiness Assessment

## Executive Summary

**Verdict: CONDITIONALLY READY**

The protocol is architecturally complete with all 7 on-chain programs shipped, security-hardened, and audit-verified across three independent audit passes (SOS, BOK formal verification, VulnHunter variant analysis). v1.3 Protocol Hardening & Polish closed every audit finding, refactored Carnage code, hardened all authority paths, added CI/CD, and polished the frontend for mainnet. The bonding curve (v1.2) is live with 13.5M proptest iterations.

Mainnet deployment is blocked by **2 hard blockers** and faces **4 significant risks**:

- **B1**: Squads multisig not yet configured -- required for holding upgrade authorities behind a timelocked governance layer at launch
- **B2**: No external security audit or bug bounty program -- relying on SVK internal tooling (3 audit passes). Authorities will NOT be burned until an external audit is funded and completed.

Estimated remaining work: 2-3 weeks for operational readiness (Squads, Arweave metadata, fresh devnet lifecycle test, mainnet deploy).

---

## Assessment Methodology

This assessment was produced by cross-referencing the following sources:

1. **Docs/mainnet-checklist.md** -- 12-section devnet-to-mainnet switch-point inventory
2. **3 independent audit passes** -- SOS deep audit, BOK formal verification (Kani proofs + proptest), VulnHunter variant analysis
3. **.planning/MILESTONES.md** -- v1.0 through v1.3 milestone completion records
4. **v1.3 audit remediation** -- 57/57 requirements satisfied, all SOS/BOK/VulnHunter findings closed
5. **GL Wave 3-4 docs** -- deployment-sequence, security-model, operational-runbook, error-handling-playbook, token-economics-model
6. **MEMORY.md** -- Running project state, known issues, and patterns

Status indicators:
- **PASS**: Verified complete, tested, and production-ready
- **FAIL**: Not implemented or broken -- hard blocker
- **BLOCKED**: Depends on another incomplete item
- **IN_PROGRESS**: Active work, partially complete
- **NOT_STARTED**: No work begun

---

## Category Assessments

### 1. On-Chain Programs

| Check | Status | Details |
|-------|--------|---------|
| All 7 programs deployed and functional | PASS | AMM, Hook, Tax, Epoch, Staking, Conversion Vault, Bonding Curve all deployed to devnet. |
| All tests passing | PASS | Rust tests + LiteSVM integration tests + 13.5M proptest iterations (bonding curve) + 40K proptest iterations (staking/AMM). |
| Security hardening complete (v1.3) | PASS | Authority hardening across all 7 programs, rent-exempt drain prevention, checked u128-to-u64 casts, EpochState reserved padding, compile-time mainnet guards. |
| CARN-002 MEV vulnerability fixed | PASS | consume_randomness + executeCarnageAtomic bundled in single v0 TX. Slippage floors enforced. |
| TAX-006 sell tax bricking fixed | PASS | WSOL intermediary deducts sell tax from WSOL output. Users with 0.001 SOL native can sell. |
| EPOCH-001 SLOTS_PER_EPOCH feature-gated | PASS | `#[cfg(feature = "devnet")]` selects 750 (devnet) vs 4500 (mainnet). |
| EPOCH-004 bounty payment implemented | PASS | 0.001 SOL bounty from CarnageSolVault to epoch triggerer. |
| AMM admin burn instruction exists | PASS | `burn_admin` sets admin to `Pubkey::default()`. |
| Feature flags correct for mainnet build | PASS | `build.sh` without `--devnet` compiles with mainnet Switchboard PID, SLOTS_PER_EPOCH=4500, mainnet treasury. |
| Conversion Vault deployed and initialized | PASS | VaultConfig PDA initialized. Vault seeded. 3 vault token accounts whitelisted. |
| Carnage logic deduplicated | PASS | v1.3 refactored into shared `carnage_execution.rs` (Phase 82). |
| Bonding Curve program | PASS | v1.2 shipped 7th program. Dual linear curves, 460M tokens each, 15% sell tax escrow, coupled graduation, 48h deadline, 20M wallet cap. Program ID: AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1. |
| BcAdminConfig authority pattern | PASS | Burnable admin via BcAdminConfig PDA. |
| force_carnage gated to devnet-only | PASS | Gated by `#[cfg(feature = "devnet")]`. Excluded from mainnet build. |
| Compile-time mainnet guards | PASS | `compile_error!` macros prevent building with placeholder mainnet addresses. |

### 2. Token System

| Check | Status | Details |
|-------|--------|---------|
| Mint authorities ready for burn | PASS | All 3 mints (CRIME, FRAUD, PROFIT) created with Token-2022. Mint authority can be burned via `SetAuthority` to `None`. |
| MetadataPointer extension | PASS | `initialize.ts` includes MetadataPointer + TokenMetadata extensions. Mainnet mints will have it from creation. |
| Transfer Hook configuration | PASS | TransferHook extension points to Transfer Hook program on all 3 mints. Hook fires on every `transfer_checked`. |
| Whitelist completeness | PASS | Admin T22 accounts + SOL pool vaults + vault token accounts + StakeVault + Carnage vaults + bonding curve vaults. Verified by deployment verification script. |
| Token metadata URIs | NOT_STARTED | Currently point to Railway placeholder endpoints. Need Arweave-hosted metadata JSON with logos, descriptions, socials for mainnet. Planned for v1.4. |
| Token logos designed | NOT_STARTED | No token logos exist. Required for Solana explorers, wallet display, and DEX aggregator listings. |
| Mainnet vanity mint keypairs | PASS | Generated and git-ignored: CRIME=`cRiME...`, FRAUD=`FraUd...`, PROFIT=`pRoFiT...`. |

### 3. Economic Model

| Check | Status | Details |
|-------|--------|---------|
| Tax distribution verified (71/24/5) | PASS | `split_distribution()` distributes 71% staking, 24% carnage, 5% treasury. Verified by unit tests + proptests. |
| Rewards sustainability modeled | PASS | GL token-economics-model doc proves closed-loop: all rewards derive from trading friction, not inflation. |
| Bonding curve ready | PASS | Program shipped (v1.2). Parameters: 0.0000009 to 0.00000345 SOL/token, 48h deadline, 20M wallet cap. 13.5M proptest iterations. |
| Pool seeding plan finalized | PASS | Mainnet: 1000 SOL + 290M tokens per SOL pool (from bonding curve proceeds). Conversion Vault seeded with 250M CRIME + 250M FRAUD + 20M PROFIT. |
| LP fee structure | PASS | SOL pools: 100 bps (1%). Hardcoded. Conversion Vault: zero fees. |
| Priority fee vs bounty economics | OPEN | <!-- NEEDS_VERIFICATION: mainnet-priority-fee-vs-bounty-economics --> Crank bounty is 0.001 SOL/epoch. If mainnet priority fees consistently exceed this, cranking becomes unprofitable. Must analyze before authority burn. |

### 4. Infrastructure

| Check | Status | Details |
|-------|--------|---------|
| Railway deployment | PASS | Active at `dr-fraudsworth-production.up.railway.app`. Health check at `/api/health`, auto-restart. |
| Helius RPC plan | PASS | Free tier sufficient through ~600 DAU. Upgrade path documented. |
| Sentry monitoring | PASS | Zero-dependency integration via `app/lib/sentry.ts`. CSP configured for US-region DSNs. |
| Backend RPC proxy | PASS | `/api/rpc` route implemented (Phase 84). Hides Helius API key from frontend bundle. Priority fees via `getPriorityFeeEstimate`. |
| SSE real-time pipeline | PASS | `/api/sse` endpoint for real-time state updates. 30s downtime threshold before RPC polling fallback. |
| Crank bot SOL funding | PASS | Budget documented. Auto-airdrop for devnet. Mainnet: manual seed + bounty sustains gas. |
| Health check endpoint | PASS | `GET /api/health` verifies PostgreSQL + Solana RPC connectivity. |
| Helius webhook handler | PASS | Idempotent TX signature PK. Replay protection added (v1.3). |
| CI/CD pipeline | PASS | `.github/workflows/ci.yml` exists. Rust + TS tests on push to main. |
| API rate limiting | PASS | Rate limiting implemented (v1.3). |
| Crank mainnet readiness | PASS | Configurable epoch slots, balance alerting, circuit breaker, spending cap (v1.3). |

### 5. Security

| Check | Status | Details |
|-------|--------|---------|
| Authority governance documented | PASS | Timelocked Squads multisig at launch. Authorities retained until external audit completed. Progressive timelock extension. Burn sequence documented in deployment-sequence doc. |
| Authority hardening (all 7 programs) | PASS | BcAdminConfig PDA with burnable admin, ProgramData upgrade authority gating on all non-BC programs (v1.3). |
| Squads multisig configured | NOT_STARTED | **Hard blocker.** 2-of-3 timelocked multisig not yet created. Required to hold upgrade authorities at launch. Can be tested on devnet first (Squads v4 supports devnet). |
| Sensitive data rotated | NOT_STARTED | Devnet keys must not be reused on mainnet. Fresh keypairs, API keys, webhook secrets required. |
| Webhook replay protection | PASS | Added in v1.3. |
| External security audit | DEFERRED | No external auditor engaged yet. Three internal audit passes completed (SOS, BOK, VulnHunter). Will be funded from protocol revenue post-launch. Authority burn gated on audit completion. |
| Bug bounty program | NOT_STARTED | Should launch alongside mainnet. Immunefi recommended. |
| On-chain security checks | PASS | PDA-gated CPI gates, account substitution prevention, adversarial test matrix. |
| Anti-reentrancy | PASS | Acyclic CPI DAG + AMM `locked` guard. |
| VRF manipulation prevention | PASS | Anti-reroll binding, freshness check, stale-VRF TOCTOU recovery (v1.3). |
| Financial safety guards | PASS | Rent-exempt drain prevention on staking escrow and epoch vault, AMM sell floor propagation, partial fill assertions, vault solvency buffer (v1.3). |
| Defense-in-depth | PASS | Pool reader ownership verification, checked u128-to-u64 casts, EpochState 64-byte reserved padding with `#[repr(C)]` layout stability (v1.3). |

### 6. Frontend

| Check | Status | Details |
|-------|--------|---------|
| All swap paths functional | PASS | SOL buy/sell for CRIME/FRAUD. PROFIT conversion via Vault. Full arb loop verified. |
| Staking UI complete | PASS | Stake, unstake, claim. Eligible unstake display (Phase 85.2). |
| Error handling complete | PASS | `parseSwapError()` covers all Tax codes 6000-6017 and AMM codes 6000-6017 (v1.3). |
| Smart Swap Routing | PASS | Route engine, split router, multi-hop builder, route UI, SwapForm integration. |
| Launch page (bonding curve) | PASS | Steampunk `/launch` route with dual pressure gauges, buy/sell panel, countdown, refund UI (v1.2). |
| Mobile responsive | PASS | Full responsive pass across all station modals and launch page (v1.3). |
| Mobile wallet adapter | PASS | Deep-link connection for Phantom/Solflare/Backpack (Phase 85.1). |
| Mainnet constant migration | NOT_STARTED | `DEVNET_*` constants need environment-aware switching. Tracked in mainnet-checklist.md. |
| Explorer links devnet->mainnet | NOT_STARTED | `?cluster=devnet` suffix must be removed for mainnet. |
| Faucet link removal | NOT_STARTED | Devnet faucet link must be removed. |

### 7. Documentation

| Check | Status | Details |
|-------|--------|---------|
| GL docs complete | PASS | 12+ GL docs validated across 4 waves. |
| 4 design specs rewritten | PASS | Carnage, Epoch, Tax, Transfer Hook specs rewritten to match current code (v1.3). |
| Nextra docs site rewritten | PASS | Page-by-page rewrite (v1.3). |
| Bonding curve documentation | PASS | Math proofs, solvency assertions, state machine edge cases documented (v1.3). |

---

## Blockers (Must Fix Before Mainnet)

### B1: Squads Multisig Not Configured
**Severity**: HIGH
**Status**: NOT_STARTED

All 7 program upgrade authorities must be held behind a Squads 2-of-3 timelocked multisig at launch. Authorities are **kept unburnt** — they will only be burned after an external audit has been funded and completed. The timelock duration will be progressively extended as the protocol proves itself stable.

Remaining work:
- Signer set not determined
- Multisig not created (can be tested on devnet first — Squads v4 supports devnet)
- Upgrade authority not transferred from deployer wallet
- No practice runs of the governance flow (propose, approve 2-of-3, execute after timelock)

**Estimated scope**: 1-2 days setup + devnet practice runs.

### B2: No External Security Audit
**Severity**: HIGH
**Status**: DEFERRED (funding dependent)

No external auditor engaged yet. Three internal audit passes completed (SOS, BOK formal verification, VulnHunter variant analysis). The protocol:
- Launches with upgrade authorities **retained** behind timelocked Squads multisig (not burned)
- Has no emergency pause mechanism, but the retained upgrade authority provides a patch path
- Manages real SOL (user deposits, staking escrow, Carnage vault)
- Has 7 interacting programs with complex CPI chains

The authority burn is explicitly gated on an external audit being funded and completed. Until then, the timelocked multisig provides a safety net — critical bugs discovered post-launch can be patched (after the timelock period).

**Recommendation**: Launch a bug bounty program on Immunefi alongside mainnet launch to incentivize community discovery during the pre-audit period. Prioritize the AMM and Tax Program for audit (highest-risk, deepest CPI chains).

---

## Risks (Should Address, Not Blocking)

### R1: No Emergency Pause Mechanism
**Impact**: MEDIUM (mitigated by retained upgrade authority)
**Decision**: SEC-06 DECLINED

No on-chain pause flag exists. However, since upgrade authorities are retained at launch behind a timelocked Squads multisig, critical bugs can be patched (after the timelock period). This risk escalates to HIGH only after authorities are eventually burned post-external-audit.

### R2: Carnage Atomic CU Budget Not Validated on Mainnet
**Impact**: MEDIUM
**Status**: NOT_VALIDATED

The Carnage atomic path uses a 600,000 CU budget client-side. Mainnet validators may have different compute characteristics. Actual CU consumption should be measured on mainnet-beta before authority burn.

### R3: RPC API Key Exposure (Mitigated)
**Impact**: LOW (was MEDIUM)
**Status**: MITIGATED

Backend RPC proxy (`/api/rpc`) implemented in Phase 84. Frontend no longer exposes Helius API key directly. WebSocket disabled for proxy (HTTP-only); browser uses SSE for real-time data.

### R4: Crank Bot Single Point of Infrastructure
**Impact**: LOW
**Mitigation**: Permissionless recovery

Any wallet can perform all crank operations. Protocol degrades gracefully without a crank. v1.3 added circuit breaker, spending cap, balance alerting.

---

## Open Questions

### OQ1: Mainnet Priority Fee vs Bounty Economics
<!-- NEEDS_VERIFICATION: mainnet-priority-fee-vs-bounty-economics -->

The crank bounty is 0.001 SOL per epoch trigger. If mainnet priority fees during congestion consistently exceed this, third-party cranking becomes unprofitable.

**Required analysis before mainnet**: Sample mainnet priority fees over a 2-week period. If median priority fee > 0.001 SOL, consider adjusting `CRANK_BOUNTY_LAMPORTS` BEFORE the upgrade authority burn.

### OQ2: Carnage Fallback Front-Running Frequency
<!-- NEEDS_VERIFICATION: carnage-fallback-front-running-frequency -->

The atomic Carnage path has zero front-running window. The fallback path (slots 50-300) has a 75% slippage floor but is theoretically front-runnable.

**Required analysis**: After 100+ mainnet epochs, measure fallback percentage and any detected front-running.

### OQ3: Token Metadata Strategy
Mainnet mints need real metadata URIs with token logos, descriptions, social links, website URL. Decision made: Arweave permanent storage. Upload planned for v1.4.

---

## Remaining Roadmap (v1.4 Pre-Mainnet)

| Item | Scope | Estimate | Dependency |
|------|-------|----------|------------|
| Squads multisig setup | Create multisig, transfer authorities, test governance | 1-2 days | None |
| Token logos + Arweave metadata | Design, upload to Arweave, update URIs | 1 week | None |
| Frontend mainnet migration | Environment-aware constants, remove devnet explorer/faucet refs | 2-3 days | Mainnet program IDs |
| Fresh devnet redeploy | Full lifecycle test with all 7 programs | 1-2 days | None |
| BcAdminConfig init automation | Add to deploy pipeline (DEPLOY-GAP-01) | 0.5 days | None |
| Mainnet program deployment | Build without --devnet, deploy all 7 programs, initialize | 1 day | Constants migration |
| Mainnet ALT creation | Create ALT with mainnet addresses | 0.5 days | Mainnet deployment |
| Pre-launch verification | Triple-verify whitelist, test all paths, overnight run | 2-3 days | Mainnet deployment |
| Authority burn (POST-AUDIT) | Burn whitelist -> burn AMM admin -> burn upgrade authorities | After external audit funded + completed | External audit |

### Critical Path

```
Squads multisig (1-2 days) ----+
                                |
Token branding + Arweave (1 wk) |
                                v
Frontend mainnet migration ---> Mainnet deployment (1 day)
                                     |
                                     v
                               Pre-launch verification (2-3 days)
                                     |
                                     v
                               MAINNET LIVE (authorities held behind timelocked Squads)
                                     |
                                     v
                               External audit (funded from protocol revenue)
                                     |
                                     v
                               Authority burn (post-audit, progressive timelock extension)
```

**Estimated total to mainnet launch: 2-3 weeks from start of v1.4.**
**Authority burn timeline: deferred until external audit is funded and completed.**

---

## Scorecard Summary

| Category | Score | Notes |
|----------|-------|-------|
| On-Chain Programs | 10/10 | All 7 programs deployed, tested, hardened, audit-verified. Carnage deduplicated. Compile-time mainnet guards. |
| Token System | 7/10 | Mints ready, hooks configured, whitelist complete, vanity addresses generated. Missing: metadata/logos (v1.4). |
| Economic Model | 9/10 | Tax math verified, bonding curve shipped, rewards sustainability modeled. Open: priority fee analysis. |
| Infrastructure | 9/10 | Railway, Helius, Sentry, RPC proxy, SSE pipeline, CI/CD, rate limiting all operational. |
| Security | 7/10 | Strong internal testing (3 audit passes, 13.5M+ proptests, Kani proofs). Missing: external audit, bug bounty, Squads multisig. |
| Frontend | 8/10 | All swap + staking + launch flows functional. Mobile responsive. Missing: mainnet constant migration, explorer links. |
| Documentation | 9/10 | All GL docs validated, 4 specs rewritten, Nextra site refreshed, bonding curve docs complete. |
| **Overall** | **8.4/10** | Strong foundation. Operational readiness items remain for v1.4. |

---

## Recommendation

**DO NOT deploy to mainnet today.** The protocol's on-chain programs are complete and security-hardened, but operational readiness items remain:

1. **Configure Squads multisig** (1-2 days): All 7 program upgrade authorities must be transferred to a 2-of-3 timelocked Squads multisig before launch. This can be tested on devnet first (Squads v4 supports devnet). The multisig holds authorities at launch — they are NOT burned immediately.

2. **Complete operational readiness** (1-2 weeks, parallelizable):
   - Design token branding and upload metadata to Arweave
   - Complete frontend mainnet constant migration
   - Fresh devnet lifecycle test with all 7 programs
   - Automate BcAdminConfig initialization in deploy pipeline

3. **Pre-launch checkpoint**: The following must pass before mainnet launch:
   1. All Rust tests pass (`cargo test --workspace`)
   2. All TS integration tests pass
   3. All security tests pass
   4. Devnet continuous runner completes N epochs without error
   5. Carnage hunter fires and completes successfully on devnet
   6. All audit findings addressed (verified: 57/57 in v1.3)

**Authority lifecycle**: Authorities launch behind a timelocked Squads 2-of-3 multisig. The timelock duration will be progressively extended as the protocol proves stable. Authorities will only be burned after an external audit has been funded (from protocol revenue) and completed. This provides a safety net — critical bugs discovered post-launch can be patched after the timelock period.

**Regarding external audit**: Three internal audit passes (SOS, BOK, VulnHunter) provide strong coverage. An external audit will be engaged once funding is available from protocol revenue. A bug bounty program (e.g., Immunefi) should be launched alongside mainnet to incentivize community discovery during the pre-audit period.

**The protocol should proceed with v1.4 Pre-Mainnet as the next milestone.**

---

*Updated 2026-03-12 after v1.3 completion. Previous version was from 2026-02-20 (v0.9 era). Sources: .planning/MILESTONES.md, Docs/mainnet-checklist.md, .audit/ findings, .bulwark/ findings, .bok/ results, Docs/deployment-sequence.md, Docs/security-model.md, Docs/token-economics-model.md.*
