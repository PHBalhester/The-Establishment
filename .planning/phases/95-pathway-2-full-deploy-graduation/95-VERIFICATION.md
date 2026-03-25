---
phase: 95-pathway-2-full-deploy-graduation
verified: 2026-03-14T17:00:00Z
status: passed
score: 4/4 must-haves verified
gaps: []
human_verification:
  - test: "Confirm test swap TX signature exists on-chain"
    expected: "A CRIME/SOL or FRAUD/SOL swap TX from the post-graduation session is visible on Solana Explorer"
    why_human: "Report section 6 describes swaps in prose only with no TX signature recorded. User confirmed swaps worked but no on-chain reference is captured in the report artifact."
  - test: "Confirm NEXT_PUBLIC_SITE_MODE=live is active on Railway"
    expected: "https://dr-fraudsworth-production.up.railway.app serves the trading interface (not the launch/bonding curve page) as the default route"
    why_human: "SITE_MODE is a Railway env var baked at build time. Cannot verify programmatically from this codebase."
  - test: "Confirm /launch shows graduated banner with historical curve display"
    expected: "Visiting /launch route shows the graduated state — curves shown as completed with historical SOL amounts, not active fill UI"
    why_human: "Frontend behavior depends on Railway env var and deployed build — not verifiable from source alone."
---

# Phase 95: Pathway 2 Full Deploy + Graduation Verification Report

**Phase Goal:** A complete clean-room deployment of the entire protocol from absolute zero, with both bonding curves filled and graduated into AMM pools.
**Verified:** 2026-03-14T17:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 7 programs deployed with fresh IDs, all 3 mints with Arweave metadata, all pools/ALT/whitelist from zero | VERIFIED | `deployments/devnet.json` generated 2026-03-14T14:35:19Z with 7 program IDs, 3 mint addresses, `curvePdas`, `pools`, `alt`; `shared/constants.ts` auto-generated from same; `.env.devnet` holds permanent Arweave URIs for all 3 mints; `initialize.ts` reads and applies them |
| 2 | Both curves filled to capacity, watched in real-time via frontend pressure gauges | VERIFIED | `pathway2-fill.ts` (576 lines, substantive) implements 25-wallet fill with parallel waves, mixed buy/sell; `Docs/pathway2-report.md` documents both curves reaching ~5.076 SOL and ~5.074 SOL; user confirmed real-time gauge observation (per prompt context) |
| 3 | Coupled graduation triggered, AMM pools seeded with curve proceeds | VERIFIED | `Docs/pathway2-report.md` documents all 13/13 graduation steps with TX signatures; CRIME/SOL and FRAUD/SOL pool addresses present in `deployments/devnet.json`; vault balances (250M CRIME + 250M FRAUD + 20M PROFIT) documented as funded |
| 4 | Tax escrow routed to carnage vault, frontend transitioned from launch page to trading interface | VERIFIED | Report documents steps 11-12 distributing both tax escrows; `NEXT_PUBLIC_SITE_MODE` toggled to `live` on Railway with redeploy triggered; `app/middleware.ts` and `app/app/launch/page.tsx` implement mode-gated routing and graduated banner |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Exists | Lines | Stubs | Wired | Status |
|----------|----------|--------|-------|-------|-------|--------|
| `scripts/test/pathway2-fill.ts` | Curve filling script, 150+ lines | YES | 576 | None | Reads `deployments/devnet.json` via `loadDeployment()` | VERIFIED |
| `deployments/devnet.json` | Fresh deployment addresses | YES | — | None | Source of truth for all scripts | VERIFIED |
| `shared/constants.ts` | Regenerated from fresh deployment | YES | 450+ | None (auto-generated comment present) | Imported by frontend and scripts | VERIFIED |
| `scripts/test/pathway2-verify.ts` | Post-graduation verification script, 100+ lines | YES | 356 | None | Reads `deployments/devnet.json`; checks curves, pools, vault, escrow, frontend | VERIFIED |
| `Docs/pathway2-report.md` | Formal lifecycle report, 50+ lines | YES | 164 | None | Contains all 7 program IDs, graduation TX sigs, verification table, CURVE checklist | VERIFIED |
| `app/hooks/useCurveState.ts` (polling) | Polling reverted to 5s after recording | YES | — | None | `setInterval(..., 5_000)` confirmed at line 377; TEMP comment absent | VERIFIED |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/test/pathway2-fill.ts` | `deployments/devnet.json` | `loadDeployment()` at line 93-99; `deployment.curvePdas.crime/fraud` used for all curve PDAs | WIRED | `curvePdas` key exists in devnet.json with crime/fraud PDAs |
| `scripts/test/pathway2-verify.ts` | `deployments/devnet.json` | `configPath` at line 89; reads `curvePdas`, `pools`, `programs` | WIRED | All referenced keys present in devnet.json |
| `scripts/graduation/graduate.ts` | `deployments/devnet.json` | Shared deployment library pattern confirmed in source | WIRED | Pool addresses from graduation (CRIME/SOL: `6mvuA7AU...`, FRAUD/SOL: `Dix2G6iu...`) match devnet.json `pools` section |
| `shared/constants.ts` | `deployments/devnet.json` | Generated by `generate-constants.ts devnet` (timestamp header confirmed) | WIRED | Program IDs and mint addresses in constants.ts exactly match devnet.json |
| `app/middleware.ts` | `NEXT_PUBLIC_SITE_MODE` | Reads `process.env.NEXT_PUBLIC_SITE_MODE` at line 21 | WIRED | Code path handles 'launch' vs 'live' mode routing |
| `initialize.ts` | `.env.devnet` Arweave URIs | Reads `CRIME_METADATA_URI`, `FRAUD_METADATA_URI`, `PROFIT_METADATA_URI` env vars | WIRED | All 3 URIs present in `.env.devnet` pointing to `arweave.net` |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CURVE-06 | Clean-room deploy from zero — 7 programs, 3 mints with Arweave metadata, all pools/ALT/whitelist, crank | SATISFIED* | All infrastructure artifacts verified; crank crash is a known separate issue excluded per context |
| CURVE-07 | Both curves filled to capacity, watched via frontend | SATISFIED | 25-wallet fill script executed; ~10.15 SOL total raised; user confirmed gauge observation |
| CURVE-08 | Coupled graduation, AMM pools seeded with 290M tokens + SOL proceeds | SATISFIED | 13/13 graduation steps, TX sigs documented, pool addresses in devnet.json |
| CURVE-09 | Tax escrow to carnage vault, frontend to live trading | SATISFIED | Tax escrow steps 11-12 documented; SITE_MODE toggled to `live`; Railway redeployed |

*CURVE-06 includes "crank from absolute zero" which crashed. Per prompt context this is a known issue handled separately and does not fail the phase.

**Note:** REQUIREMENTS.md still shows CURVE-06 through CURVE-09 with `[ ]` (Pending) and status "Pending" in the tracking table. These were not checked off or marked complete in the requirements file after the phase finished. This is a documentation gap but does not affect goal achievement.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `Docs/pathway2-report.md` (section 6) | Test swap described in prose only — no TX signature captured | Warning | The "Test Swap" section says swaps were executed but provides no on-chain reference (TX signature). Report is otherwise comprehensive. User confirmed swaps worked via prompt context. |
| `deployments/devnet.json` | `"curves": {}` is an empty object while curve PDAs live under `curvePdas` | Info | Inconsistent naming but all scripts correctly reference `curvePdas`. No functional impact. |
| `.planning/REQUIREMENTS.md` | CURVE-06 through CURVE-09 checkboxes unchecked and status remains "Pending" | Warning | Phase completion is not reflected in the requirements tracker. Should be updated to show these as satisfied. |

### Human Verification Required

#### 1. Confirm Test Swap TX Signature

**Test:** Search Solana Explorer (devnet) for any swap transaction sent from the devnet wallet `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` after 2026-03-14T15:08:18Z (graduation completion time)
**Expected:** At least one transaction interacting with the Tax Program (`43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj`) or AMM (`5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR`) confirming a post-graduation test swap
**Why human:** Report section 6 describes swaps in prose only. No TX signature was captured in the report artifact. The user confirmed swaps worked (per prompt context) but on-chain evidence is not linked.

#### 2. Confirm NEXT_PUBLIC_SITE_MODE=live on Railway

**Test:** Visit https://dr-fraudsworth-production.up.railway.app — the default route should serve the trading interface, not the bonding curve launch page
**Expected:** Trading interface (swap UI, pool reserves, etc.) loads at the root URL
**Why human:** NEXT_PUBLIC_* vars are baked at Railway build time. Cannot verify from codebase; must check the live deployment.

#### 3. Confirm /launch page shows graduated banner

**Test:** Visit https://dr-fraudsworth-production.up.railway.app/launch
**Expected:** Page shows graduated state — historical curve fill data (CRIME: ~5.076 SOL raised, FRAUD: ~5.074 SOL raised), "graduated" status, not the active fill UI
**Why human:** Depends on Railway env var and deployed Next.js build.

### Gaps Summary

No blocking gaps found. The phase goal is achieved.

The three items flagged above are documentation quality issues and live-environment confirmations:

1. The test swap TX signature was not captured in the report — the user confirmed it worked but the evidence is only in the prompt context, not persisted in `Docs/pathway2-report.md`.
2. REQUIREMENTS.md checkboxes were not updated to reflect phase completion.
3. Two live-environment behaviors (trading interface, graduated /launch page) need human eyes to confirm since they depend on Railway env vars.

The crank crash is explicitly excluded from failing this phase per the prompt context — it is a known issue being investigated separately, and the epoch/VRF infrastructure is known-good from v1.3.

---

_Verified: 2026-03-14T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
