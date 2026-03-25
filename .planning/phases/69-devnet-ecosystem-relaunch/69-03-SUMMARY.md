---
phase: 69-devnet-ecosystem-relaunch
plan: 03
subsystem: infra
tags: [solana, devnet, frontend, constants, idl, next.js, addresses]

# Dependency graph
requires:
  - phase: 69-02
    provides: Fresh devnet deployment with pda-manifest.json and alt-address.json
provides:
  - Updated frontend constants (mints, pools, vaults, ALT) matching live devnet
  - Synced IDLs and TypeScript types from devnet build
  - Passing Next.js production build
affects: [69-04-crank-validation, railway-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - shared/constants.ts
    - shared/programs.ts
    - scripts/backfill-candles.ts
    - app/idl/conversion_vault.json
    - app/idl/tax_program.json
    - app/idl/types/conversion_vault.ts
    - app/idl/types/tax_program.ts

key-decisions:
  - "Seed-only PDAs unchanged since program keypairs were reused — only mint-dependent addresses needed updating"
  - "Removed crimeProfit/fraudProfit pool entries from backfill-candles.ts (PROFIT AMM pools replaced by conversion vault in Phase 69)"

patterns-established: []

# Metrics
duration: 7min
completed: 2026-02-26
---

# Phase 69 Plan 03: Frontend Address + IDL Update Summary

**Updated 11 devnet addresses (3 mints, 2 pools, 4 vaults, 1 ALT, 1 script) and synced 2 changed IDLs — Next.js production build passes clean**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-26T21:44:58Z
- **Completed:** 2026-02-26T21:52:24Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- All mint-dependent frontend addresses updated from pda-manifest.json (CRIME, FRAUD, PROFIT mints + 2 pool addresses + 4 pool vault addresses)
- DEVNET_ALT updated from alt-address.json (46 addresses)
- Seed-only PDAs verified unchanged (SwapAuthority, TaxAuthority, StakePool, EscrowVault, StakeVault, WsolIntermediary, EpochState, CarnageFund, CarnageSolVault)
- IDLs synced: conversion_vault (localnet mode docs) and tax_program (distribution ratios + treasury address)
- Next.js production build passes with 0 errors (Turbopack, 4.0s compile)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update shared/constants.ts and shared/programs.ts from deployment artifacts** - `69a0a04` (feat)
2. **Task 2: Sync IDLs and run Next.js production build** - `a6d9ec7` (chore)

**Plan metadata:** (pending)

## Files Created/Modified
- `shared/constants.ts` - Updated MINTS (3), DEVNET_POOLS (2), DEVNET_POOL_CONFIGS (6 addresses) from pda-manifest.json
- `shared/programs.ts` - Updated DEVNET_ALT to new ALT address, updated comment
- `scripts/backfill-candles.ts` - Updated pool addresses, removed defunct PROFIT pool entries
- `app/idl/conversion_vault.json` - Synced from target (localnet mode docs added)
- `app/idl/tax_program.json` - Synced from target (distribution 73.5/24/2.5 -> 75/24/1, treasury address)
- `app/idl/types/conversion_vault.ts` - TypeScript types regenerated
- `app/idl/types/tax_program.ts` - TypeScript types regenerated

## Decisions Made
- Seed-only PDAs (EpochState, CarnageFund, CarnageSolVault, SwapAuthority, TaxAuthority, StakePool, EscrowVault, StakeVault, WsolIntermediary) were verified unchanged since program IDs were reused — no update needed
- Removed crimeProfit/fraudProfit entries from backfill-candles.ts since PROFIT AMM pools no longer exist (replaced by conversion vault)
- TOKEN_PROGRAM_FOR_MINT uses `MINTS.X.toBase58()` so auto-updates when mints change — no manual update needed
- Only 2 of 6 IDLs had actual changes (conversion_vault, tax_program); the rest were already synced

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated scripts/backfill-candles.ts hardcoded pool addresses**
- **Found during:** Task 1 (address update verification)
- **Issue:** scripts/backfill-candles.ts had old pool addresses hardcoded independently from shared/constants.ts
- **Fix:** Updated solCrime/solFraud pool addresses, removed defunct crimeProfit/fraudProfit entries
- **Files modified:** scripts/backfill-candles.ts
- **Verification:** grep confirmed no remaining old addresses in source files
- **Committed in:** 69a0a04 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for backfill script correctness with new deployment. No scope creep.

## Issues Encountered
- Build script is `npm run build --workspace=app` (not root `npm run build`) due to workspace monorepo structure — resolved immediately
- 4 of 6 IDLs and 4 of 6 TypeScript types were already identical between target and app (amm, staking, transfer_hook, epoch_program) — only conversion_vault and tax_program had actual changes

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Frontend constants and IDLs fully synced with live devnet deployment
- Next.js production build passes — ready for Railway deployment
- Next: 69-04 (Crank restart + end-to-end validation)

---
*Phase: 69-devnet-ecosystem-relaunch*
*Completed: 2026-02-26*
