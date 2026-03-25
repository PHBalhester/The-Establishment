---
phase: 98-mainnet-checklist
plan: 01
subsystem: infra
tags: [bash, deployment, stage-scripts, deploy-pipeline, solana-cli]

# Dependency graph
requires:
  - phase: 91-deploy-config-foundation
    provides: deployment.json schema, deploy-all.sh pipeline, generate-constants.ts
  - phase: 92-mainnet-credentials
    provides: preflight safety gate, env separation, hash generator
  - phase: 97-squads-governance
    provides: setup-squads.ts, transfer-authority.ts, verify-authority.ts
provides:
  - 8 independently-runnable stage scripts (stage-0 through stage-7)
  - Refactored deploy-all.sh calling stages 0-4 sequentially
  - Clear separation of pre-deploy (0-4) vs launch (5) vs post-launch (6-7)
affects: [98-mainnet-checklist, 98.1-production-infra, 99-nextra-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stage script pattern: cluster arg, env sourcing, prerequisites, actions, verification, GO/NO-GO gate"
    - "Pre-deploy (stages 0-4) vs launch (stage 5) vs post-launch (stages 6-7) separation"

key-files:
  created:
    - scripts/deploy/stage-0-preflight.sh
    - scripts/deploy/stage-1-build.sh
    - scripts/deploy/stage-2-deploy.sh
    - scripts/deploy/stage-3-initialize.sh
    - scripts/deploy/stage-4-infra.sh
    - scripts/deploy/stage-5-launch.sh
    - scripts/deploy/stage-6-graduation.sh
    - scripts/deploy/stage-7-governance.sh
  modified:
    - scripts/deploy/deploy-all.sh

key-decisions:
  - "deploy-all.sh only runs stages 0-4 (pre-deploy); stages 5-7 run independently for launch/post-launch"
  - "Partial deploy path preserved with inline logic (stage scripts are full-deploy only)"
  - "Stage 5 is the explicit PUBLIC LAUNCH MOMENT with mainnet 'LAUNCH' confirmation prompt"
  - "Stage 7 (governance) is LAST, after launch+graduation, so deployer retains hot-fix capability during critical window"

patterns-established:
  - "Stage script template: cluster arg validation, env sourcing, prerequisites check, numbered action steps, verification section, GO/NO-GO gate summary"

requirements-completed: [CHECK-01, CHECK-02]

# Metrics
duration: 10min
completed: 2026-03-15
---

# Phase 98 Plan 01: Stage Scripts Summary

**8 independently-runnable stage scripts decomposing deploy-all.sh into atomic deployment stages with verification gates between each**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-15T11:02:07Z
- **Completed:** 2026-03-15T11:12:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Created 8 stage scripts that can each be run independently with `./scripts/deploy/stage-N-*.sh <devnet|mainnet>`
- Refactored deploy-all.sh to call stage scripts 0-4 sequentially while preserving --partial flag
- Embedded all 15 Phase 95 pitfall WARNINGs as inline comments at the exact steps where they apply
- Stage 5 clearly separated as "the public launch moment" with mainnet LAUNCH confirmation prompt
- Pre-deploy (stages 0-4) can be run days before launch; only stage 5 runs at launch time

## Task Commits

Each task was committed atomically:

1. **Task 1: Create pre-deploy stage scripts (stages 0-3)** - `8e1510d` (feat)
2. **Task 2: Create launch/post-launch stage scripts (stages 4-7) + update deploy-all.sh** - `d4044f5` (feat)

## Files Created/Modified
- `scripts/deploy/stage-0-preflight.sh` (399 lines) - Toolchain versions, env vars, wallet balance, keypair safety, mint keypair handling, binary hash comparison
- `scripts/deploy/stage-1-build.sh` (227 lines) - build.sh invocation, hash manifest generation, binary address cross-validation
- `scripts/deploy/stage-2-deploy.sh` (206 lines) - deploy.sh invocation, per-program on-chain verification (executable + authority)
- `scripts/deploy/stage-3-initialize.sh` (170 lines) - initialize.ts with .env sourcing, pitfall warnings for pool/whitelist timing
- `scripts/deploy/stage-4-infra.sh` (210 lines) - ALT creation, generate-constants, IDL sync to app/idl/
- `scripts/deploy/stage-5-launch.sh` (197 lines) - PUBLIC LAUNCH: bonding curve init, monitoring checklist
- `scripts/deploy/stage-6-graduation.sh` (200 lines) - 13-step graduation, crank setup, frontend mode switch
- `scripts/deploy/stage-7-governance.sh` (203 lines) - Squads multisig, authority transfer, verification, timelock schedule
- `scripts/deploy/deploy-all.sh` (modified) - Refactored to call stages 0-4 sequentially, preserving --partial path

## Decisions Made
- deploy-all.sh only runs stages 0-4 (pre-deploy); stages 5-7 are separate launch/post-launch operations run independently
- Partial deploy path preserved with inline logic since stage scripts are designed for full deploys
- Stage 2 includes mainnet DEPLOY confirmation prompt; Stage 5 has mainnet LAUNCH prompt; Stage 7 has TRANSFER prompt
- Stage 6 crank setup is documented instructions (not automated crank start) since Railway deployment is manual

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 8 stage scripts ready for the comprehensive checklist document (Plan 98-02)
- Stage scripts ARE the procedure -- checklist document references them
- Fresh devnet validation deploy (Plan 98-03) will exercise these scripts end-to-end

---
*Phase: 98-mainnet-checklist*
*Completed: 2026-03-15*
