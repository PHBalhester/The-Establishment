---
phase: 94-bonding-curve-deadline-pathway-1
plan: 01
subsystem: infra
tags: [bonding-curve, feature-flags, deploy-pipeline, devnet, constants]

# Dependency graph
requires:
  - phase: 91-deployment-config
    provides: deploy-all.sh pipeline, build.sh, deployment infrastructure
  - phase: 70-77 (v1.2 Bonding Curves)
    provides: bonding_curve program, constants.rs, curve-constants.ts
provides:
  - Three-way devnet/localnet/mainnet feature flags for bonding curve constants
  - Client-side cluster-aware curve constants (NEXT_PUBLIC_CLUSTER)
  - --partial flag in deploy pipeline (build.sh, deploy-all.sh)
affects: [94-02 (partial deploy execution), 94-03 (pathway 1 testing)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-way cfg pattern extended to P_START, P_END, TARGET_SOL, MIN_PURCHASE_SOL, DEADLINE_SLOTS"
    - "Client isDevnet ternary pattern for cluster-aware BigInt constants"
    - "--partial flag for reduced deploy pipeline (2 of 7 programs)"

key-files:
  created: []
  modified:
    - programs/bonding_curve/src/constants.rs
    - app/lib/curve/curve-constants.ts
    - scripts/deploy/build.sh
    - scripts/deploy/deploy-all.sh

key-decisions:
  - "Devnet P_START=5, P_END=17 produces ~5.06 SOL total raised (acceptable rounding for devnet)"
  - "Localnet P_START/P_END kept same as mainnet (900/3450) -- localnet tests don't depend on specific values"
  - "Partial deploy uses inline solana program deploy commands instead of modifying deploy.sh"
  - "Partial preflight skips pool seed env var requirement (no AMM pools in partial)"

patterns-established:
  - "Partial deploy: --partial flag in build.sh and deploy-all.sh for Pathway 1 testing"
  - "PARTIAL_DEPLOY=true env var for initialize.ts awareness"

# Metrics
duration: 12min
completed: 2026-03-13
---

# Phase 94 Plan 01: Devnet Feature Flags + Partial Deploy Pipeline Summary

**Three-way devnet/localnet/mainnet feature flags for bonding curve constants (5 SOL target, 30-min deadline) plus --partial deploy pipeline flag for Pathway 1 testing**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-13T20:12:16Z
- **Completed:** 2026-03-13T20:24:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Bonding curve compiles with --features devnet using 4500-slot deadline (~30 min) and 5 SOL target pricing
- Client-side curve-constants.ts selects devnet values when NEXT_PUBLIC_CLUSTER=devnet
- deploy-all.sh devnet --partial runs a reduced pipeline: only Transfer Hook + Bonding Curve
- build.sh --partial --devnet compiles only 2 programs instead of 7
- All compile-time assertions pass for devnet, localnet, and mainnet builds

## Task Commits

Each task was committed atomically:

1. **Task 1: Add devnet feature-flag constants to bonding curve program + client** - `496d624` (feat)
2. **Task 2: Add --partial flag to deploy pipeline** - `00cd1f7` (feat)

## Files Created/Modified
- `programs/bonding_curve/src/constants.rs` - Three-way cfg for P_START, P_END, TARGET_SOL, MIN_PURCHASE_SOL, DEADLINE_SLOTS
- `app/lib/curve/curve-constants.ts` - Cluster-aware constant selection via NEXT_PUBLIC_CLUSTER
- `scripts/deploy/build.sh` - --partial flag: build only transfer_hook + bonding_curve
- `scripts/deploy/deploy-all.sh` - --partial flag: reduced 7-phase pipeline for Pathway 1

## Decisions Made
- Devnet P_START=5, P_END=17: produces (5+17)/2 * 460M = 5,060,000,000 lamports (~5.06 SOL). Close enough to 5 SOL target for devnet testing.
- Localnet P_START/P_END unchanged (same as mainnet 900/3450) -- verified no localnet tests reference these values.
- Partial deploy Phase 2 uses inline `solana program deploy` commands rather than modifying deploy.sh, keeping the full deploy path completely unchanged.
- Partial preflight relaxes env var checks: SOL_POOL_SEED_SOL_OVERRIDE and SOL_POOL_SEED_TOKEN_OVERRIDE not required (no AMM pools in partial).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Constants and deploy pipeline ready for Plan 02 (partial deploy execution)
- initialize.ts needs PARTIAL_DEPLOY awareness (checking env var to skip AMM/Tax/Epoch/Staking/Vault steps) -- this will be addressed in Plan 02
- Devnet wallet needs sufficient SOL before running partial deploy

---
*Phase: 94-bonding-curve-deadline-pathway-1*
*Completed: 2026-03-13*
