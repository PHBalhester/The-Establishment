---
phase: 91-deploy-config-foundation
plan: 03
subsystem: infra
tags: [bash, typescript, deployment, safety-gates, env-config, bonding-curve]

# Dependency graph
requires:
  - phase: 91-deploy-config-foundation
    provides: deployment.json schema, .env.devnet/.env.mainnet cluster-specific env files
  - phase: 33-deployment-scripts
    provides: deploy-all.sh, initialize.ts, deploy pipeline
  - phase: 78-authority-hardening
    provides: BcAdminConfig PDA authority gating on bonding curve instructions
provides:
  - 7-phase deployment pipeline with explicit cluster argument
  - Cluster-aware .env sourcing with cross-validation
  - Mainnet confirmation prompt with SOL balance display
  - Env var hard-error guard for non-localhost clusters
  - Automated BcAdminConfig initialization (DEPLOY-GAP-01 closed)
affects: [92-generate-constants, 94-deploy-pipeline, 95-verify-upgrade, 96-lifecycle-test]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cluster-explicit deployment: no auto-detection, operator must type devnet or mainnet"
    - "Fail-fast env validation: all required vars checked before any on-chain operation"
    - "Cross-validation: CLUSTER_URL content checked against target cluster argument"

key-files:
  created: []
  modified:
    - scripts/deploy/deploy-all.sh
    - scripts/deploy/initialize.ts

key-decisions:
  - "Cluster argument is devnet|mainnet string, not URL -- prevents wrong-cluster from stale CLI config"
  - "Mainnet confirmation requires exact string 'DEPLOY MAINNET' to prevent accidental deploys"
  - "BcAdminConfig init placed at Step 17 before any curve operations (Step 18-25)"
  - "All bonding curve instructions updated to pass adminConfig account (was DEPLOY-GAP-01)"

patterns-established:
  - "Cluster-explicit: deploy-all.sh requires devnet|mainnet, sources .env.{cluster}"
  - "Env guard pattern: required vars validated at startup, not discovered mid-execution"

requirements-completed: [INFRA-05, INFRA-06, INFRA-07]

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 91 Plan 03: Deploy Pipeline & Env Guard Hardening Summary

**7-phase deploy-all.sh with cluster safety gates, env var hard-errors preventing Phase 69 repeat, and BcAdminConfig automation closing DEPLOY-GAP-01**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-12T21:21:20Z
- **Completed:** 2026-03-12T21:26:46Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended deploy-all.sh from 4 to 7 phases with explicit cluster argument requirement
- Added cluster-aware .env sourcing with cross-validation (devnet URL in mainnet config = abort)
- Added mainnet confirmation prompt showing deployer SOL balance and cost estimate
- Added fail-fast env var guard in initialize.ts for non-localhost clusters (SOL_POOL_SEED_SOL_OVERRIDE, SOL_POOL_SEED_TOKEN_OVERRIDE, HELIUS_API_KEY, CLUSTER_URL)
- Automated BcAdminConfig PDA initialization as Step 17 in initialize.ts
- Fixed all bonding curve instruction calls to pass adminConfig account

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend deploy-all.sh to 7-phase pipeline with cluster safety gates** - `9c180eb` (feat)
2. **Task 2: Add env var guards to initialize.ts and automate BcAdminConfig** - `62fcd98` (feat)

## Files Created/Modified
- `scripts/deploy/deploy-all.sh` - 7-phase pipeline with cluster argument, .env.{cluster} sourcing, cross-validation, mainnet confirmation prompt
- `scripts/deploy/initialize.ts` - Env var hard-error guard at startup, BcAdminConfig Step 17, adminConfig added to all bonding curve calls, steps renumbered 17-27

## Decisions Made
- Cluster argument is a simple string (devnet|mainnet) rather than a URL -- more explicit, less error-prone
- Mainnet confirmation uses exact string match ("DEPLOY MAINNET") rather than y/n -- higher friction = fewer accidents
- BcAdminConfig initialization placed before curve operations (Step 17) since initializeCurve/fundCurve/startCurve all require adminConfig
- Env var guard uses console.error directly (not logger) since logger hasn't been initialized yet at that point

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added adminConfig to all bonding curve instruction calls**
- **Found during:** Task 2 (BcAdminConfig automation)
- **Issue:** TypeScript compilation revealed initializeCurve, fundCurve, and startCurve all require adminConfig account (added in Phase 78 authority hardening), but initialize.ts never passed it. This was the root cause of DEPLOY-GAP-01.
- **Fix:** Added `adminConfig: bcAdminConfig` to all 6 bonding curve instruction accountsStrict calls
- **Files modified:** scripts/deploy/initialize.ts
- **Verification:** `npx tsc --noEmit` passes with no errors from our code
- **Committed in:** `62fcd98` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix -- without adminConfig, curve initialization/funding/starting would fail at runtime. This was the actual DEPLOY-GAP-01 bug.

## Issues Encountered
None -- plan executed as specified with one expected deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- deploy-all.sh Phase 4 calls generate-constants.ts (to be created in Plan 02)
- deploy-all.sh Phase 5 calls create-alt.ts (already exists)
- deploy-all.sh Phase 6 calls verify.ts (already exists, upgrade planned in Plan 04)
- Env var guard protects against Phase 69-style disasters on both devnet and mainnet

---
*Phase: 91-deploy-config-foundation*
*Completed: 2026-03-12*
