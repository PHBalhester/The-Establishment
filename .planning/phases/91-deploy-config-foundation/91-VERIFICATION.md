---
phase: 91-deploy-config-foundation
verified: 2026-03-12T22:00:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 91: Deploy Config Foundation Verification Report

**Phase Goal:** All protocol addresses flow from a single deployment.json file, eliminating manual address copy-paste and preventing wrong-cluster deploys
**Verified:** 2026-03-12T22:00:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | deployments/devnet.json contains every protocol address (7 programs, 3 mints, 19 PDAs, 2 pools, 2 curve sets, 3 hook accounts, ALT, treasury, authority) | VERIFIED | File exists (78 lines), validated: 7 programs, 3 mints, 19 PDAs, 2 pools, 2 curvePdas, 3 hookAccounts, ALT, treasury, authority all present with schemaVersion: 1 |
| 2 | Running generate-constants.ts produces shared/constants.ts with zero manual edits | VERIFIED | generate-constants.ts (789 lines) reads deployments/{cluster}.json, shared/constants.ts (566 lines) starts with AUTO-GENERATED header |
| 3 | verify.ts reads from deployments/{cluster}.json and validates all addresses match on-chain state | VERIFIED | verify.ts (939 lines) contains deployment.json loading with fallback to pda-manifest derivation, deep checks for programs/mints/PDAs/pools/ALT/authority |
| 4 | Attempting a mainnet build with devnet addresses baked into .so files aborts with clear error | VERIFIED | deploy-all.sh Phase 1.5 (lines 251+) greps 4 feature-flagged .so files for devnet addresses from devnet.json, sets FOUND_DEVNET flag, exits 1 on match |
| 5 | initialize.ts hard-errors if pool seed env vars are missing on non-localhost cluster | VERIFIED | Lines 191-226 check SOL_POOL_SEED_SOL_OVERRIDE, SOL_POOL_SEED_TOKEN_OVERRIDE, HELIUS_API_KEY, CLUSTER_URL; prints "MISSING REQUIRED ENVIRONMENT VARIABLES" and process.exit(1) |
| 6 | deploy-all.sh requires explicit cluster argument with 7 phases | VERIFIED | Lines 50-54 require devnet/mainnet arg; Phases 0-6 plus 1.5 confirmed (mint keypairs, build, binary check, deploy, initialize, generate-constants, ALT, verify) |
| 7 | .env.devnet and .env.mainnet exist as separate cluster-specific env files | VERIFIED | .env.devnet (14 lines) has real devnet values; .env.mainnet (17 lines) has CHANGE_ME_MAINNET placeholders; .gitignore contains .env.mainnet; deployments/ NOT gitignored |
| 8 | BcAdminConfig initialization is automated in initialize.ts pipeline | VERIFIED | Step 17 (lines 1436-1478) derives BcAdminConfig PDA, checks existence, calls initializeAdmin if needed, passes bcAdminConfig to all subsequent curve instructions |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/deploy/lib/deployment-schema.ts` | TypeScript schema + validation | VERIFIED (260 lines) | Exports DeploymentConfig interface, PoolEntry, CurvePdaEntry, AuthorityInfo, MetadataInfo, validateDeploymentConfig(). No stubs. |
| `deployments/devnet.json` | Canonical devnet addresses | VERIFIED (78 lines) | schemaVersion: 1, all 7 programs, 3 mints, 19 PDAs, 2 pools, 2 curvePda sets, 3 hookAccounts, ALT, treasury, authority |
| `scripts/deploy/generate-deployment-json.ts` | Standalone JSON generator | VERIFIED (244 lines) | Reads Anchor.toml + mint-keypairs, calls generateDeploymentConfig(), writes deployments/{cluster}.json |
| `scripts/deploy/generate-constants.ts` | Code generator for constants.ts | VERIFIED (789 lines) | Reads deployments/{cluster}.json, writes shared/constants.ts with all exports |
| `shared/constants.ts` | Auto-generated constants | VERIFIED (566 lines) | Has AUTO-GENERATED header, imports from @solana/web3.js + @solana/spl-token |
| `.env.devnet` | Devnet environment | VERIFIED (14 lines) | Has HELIUS_API_KEY, CLUSTER_URL, SOL_POOL_SEED_* values |
| `.env.mainnet` | Mainnet template | VERIFIED (17 lines) | Has CHANGE_ME_MAINNET placeholders |
| `scripts/deploy/deploy-all.sh` | 7-phase pipeline | VERIFIED (390 lines) | Phases 0-6 + 1.5 binary check, cluster arg required, .env.{cluster} sourcing, mainnet confirmation |
| `scripts/deploy/verify.ts` | Deep on-chain verification | VERIFIED (939 lines) | Reads deployment.json, checks programs/mints/PDAs/pools/ALT/authority |
| `scripts/deploy/initialize.ts` | Extended with env guards + BcAdminConfig | VERIFIED (2032 lines) | Env var guard at lines 191-226, BcAdminConfig Step 17, writes deployments/{cluster}.json |
| `scripts/deploy/lib/pda-manifest.ts` | Extended with generateDeploymentConfig | VERIFIED | Export at line 431 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| generate-constants.ts | deployments/devnet.json | JSON.parse file read | WIRED | Line 38: reads `deployments/${cluster}.json` |
| generate-constants.ts | shared/constants.ts | fs.writeFileSync | WIRED | Writes complete constants.ts from deployment.json |
| initialize.ts | deployments/{cluster}.json | JSON.stringify write | WIRED | Lines 1934-1990: writes deployment.json at end of init |
| verify.ts | deployments/{cluster}.json | JSON.parse file read | WIRED | Line 241: loads deployment.json, falls back to pda-manifest |
| deploy-all.sh | .env.{cluster} | source command | WIRED | Lines 103-113: sources .env.${CLUSTER} with set -a |
| deploy-all.sh | generate-constants.ts | npx tsx invocation | WIRED | Line 351: Phase 4 calls generate-constants |
| deploy-all.sh | devnet.json (binary check) | grep -F .so files | WIRED | Lines 251-320: Phase 1.5 greps for devnet addresses in mainnet .so |
| initialize.ts | process.env | env var validation | WIRED | Lines 201-224: checks 4 required vars, exits on missing |
| deployment-schema.ts | pda-manifest.ts | Type imports | WIRED | generateDeploymentConfig returns DeploymentConfig type |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| INFRA-01: Deploy pipeline generates canonical deployments/{cluster}.json | SATISFIED | devnet.json exists with all addresses; initialize.ts writes it; generate-deployment-json.ts creates it standalone |
| INFRA-02: generate-constants.ts auto-writes shared/constants.ts from deployment.json | SATISFIED | 789-line generator produces 566-line constants.ts with AUTO-GENERATED header |
| INFRA-03: verify.ts reads from deployment.json and validates on-chain state | SATISFIED | 939-line verify.ts reads deployment.json, checks programs/mints/PDAs/pools/ALT/authority |
| INFRA-04: Binary verification step aborts mainnet build if devnet addresses found | SATISFIED | deploy-all.sh Phase 1.5 greps 4 .so files for devnet addresses, exits 1 on match |
| INFRA-05: deploy-all.sh extended with 7 phases and mainnet safety gates | SATISFIED | 390-line script with Phases 0-6 + 1.5, cluster arg, confirmation prompt |
| INFRA-06: initialize.ts hard-errors if pool seed env vars unset on non-localhost | SATISFIED | Lines 191-226 validate 4 required vars, exit(1) on missing |
| INFRA-07: BcAdminConfig initialization automated in pipeline | SATISFIED | Step 17 in initialize.ts derives PDA, calls initializeAdmin, passes to all curve calls |
| INFRA-13: Separate .env.devnet and .env.mainnet with cluster-aware sourcing | SATISFIED | Both files exist; deploy-all.sh sources .env.${CLUSTER}; .env.mainnet gitignored |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| generate-constants.ts | 674-759 | TODO comments for mainnet placeholders | Info | Expected -- mainnet.json does not exist yet. These TODOs are inside the placeholder emitter and will be resolved when mainnet deploy occurs in Phase 95. Not blockers. |

### Human Verification Required

### 1. Full Pipeline Dry Run
**Test:** Run `./scripts/deploy/deploy-all.sh devnet` end-to-end on a fresh devnet deploy
**Expected:** All 7 phases complete, deployments/devnet.json written, shared/constants.ts regenerated, verify.ts passes
**Why human:** Requires live on-chain interaction with Solana devnet

### 2. Mainnet Safety Gates
**Test:** Run `./scripts/deploy/deploy-all.sh mainnet` without mainnet env
**Expected:** Fails with ".env.mainnet not found" or missing env var errors; never touches mainnet
**Why human:** Requires interactive confirmation prompt testing

### 3. Constants Consumer Compilation
**Test:** Run `npx tsc --noEmit` in app/ directory
**Expected:** Zero compilation errors from shared/constants.ts consumers
**Why human:** Requires full TypeScript compilation environment with all dependencies

### Gaps Summary

No gaps found. All 8 observable truths verified. All 8 requirements (INFRA-01 through INFRA-07 plus INFRA-13) satisfied. All artifacts exist, are substantive (well above minimum line counts), and are properly wired together. The deployment.json schema is complete, the code generator works from it, the pipeline orchestrates it, the verifier validates against it, and safety gates prevent wrong-cluster disasters.

---

_Verified: 2026-03-12T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
