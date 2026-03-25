---
phase: 84-frontend-hardening-mainnet-readiness
plan: 02
subsystem: ui
tags: [typescript, error-handling, dead-code, refactor, settings]

# Dependency graph
requires:
  - phase: 80-defense-in-depth
    provides: InvalidPoolOwner error variant (6018) in tax-program
  - phase: 49-protocol-hardening
    provides: MinimumOutputFloorViolation error variant (6017)
provides:
  - Complete Tax error map (6000-6018, all 19 variants)
  - PriorityFeePreset canonical type in SettingsProvider
  - Clean codebase with no dead code or stale references
affects: [85-launch-page-mobile-polish, 86-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Canonical type ownership: shared types live in providers, consumers import"

key-files:
  created: []
  modified:
    - app/lib/swap/error-map.ts
    - app/providers/SettingsProvider.tsx
    - app/lib/staking/staking-builders.ts
    - app/hooks/useStaking.ts
    - app/hooks/useSwap.ts

key-decisions:
  - "PriorityFeePreset canonical home is SettingsProvider (settings own fee config)"
  - "DashboardGrid references replaced with 'factory scene' (current architecture)"
  - "useSwap.ts re-exports PriorityFeePreset for backward-compatible imports"
  - "systemProgram removed only from unstake (IDL confirms stake/claim still have it)"

patterns-established:
  - "Type ownership: shared UI types defined in providers, re-exported from hooks for convenience"

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 84 Plan 02: Code Cleanup & Error Map Extension Summary

**Dead code removal (BalanceDisplay), Tax error map extended to 6018, PriorityFeePreset migrated to SettingsProvider, 11 stale DashboardGrid comments fixed, unstake systemProgram TS error resolved**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T12:20:59Z
- **Completed:** 2026-03-08T12:26:00Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments
- Deleted orphaned BalanceDisplay.tsx (dead since Phase 40), verified no import references
- Extended Tax error map with 5 new codes (6014-6018), cross-referenced against errors.rs
- Migrated PriorityFeePreset type ownership from useSwap/useStaking to SettingsProvider
- Updated 11 stale "DashboardGrid" comment references across 9 files to "factory scene"
- Fixed TS error: removed systemProgram from unstake instruction builder (IDL no longer lists it)
- Verified swap/page.tsx already removed (CLN-02 satisfied)

## Task Commits

Each task was committed atomically:

1. **Task 1: Dead Code Removal + Error Map Extension** - `c7ecef8` (feat)
2. **Task 2: Comment Cleanup + TS Fix + PriorityFee Migration** - `f33fb40` (refactor)

## Files Created/Modified
- `app/components/wallet/BalanceDisplay.tsx` - DELETED (orphaned component)
- `app/lib/swap/error-map.ts` - Added Tax codes 6014-6018 (19 variants total)
- `app/providers/SettingsProvider.tsx` - Now owns PriorityFeePreset type definition
- `app/lib/staking/staking-builders.ts` - Removed systemProgram from unstake
- `app/hooks/useStaking.ts` - Imports PriorityFeePreset from SettingsProvider, comment fix
- `app/hooks/useSwap.ts` - Re-exports PriorityFeePreset from SettingsProvider, comment fix
- `app/hooks/useCurrentSlot.ts` - DashboardGrid -> factory scene in comments
- `app/hooks/usePoolPrices.ts` - DashboardGrid -> factory scene in comments
- `app/hooks/useCarnageData.ts` - DashboardGrid -> factory scene in comments
- `app/hooks/useCarnageEvents.ts` - DashboardGrid -> factory scene in comments
- `app/hooks/useEpochState.ts` - DashboardGrid -> factory scene in comments
- `app/hooks/useVisibility.ts` - DashboardGrid -> factory scene in comments
- `app/components/staking/StakingForm.tsx` - DashboardGrid -> removed from comment
- `app/components/swap/SlippageConfig.tsx` - PriorityFeePreset import updated
- `app/components/swap/SwapForm.tsx` - PriorityFeePreset import updated

## Decisions Made
- PriorityFeePreset canonical home is SettingsProvider (settings semantically own fee configuration)
- useSwap.ts re-exports PriorityFeePreset for backward-compatible consumer imports
- DashboardGrid references replaced with "factory scene" (matching current page.tsx architecture)
- systemProgram removed only from unstake builder (IDL confirms stake and claim still list it)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Codebase clean of dead code and stale references
- All error maps complete for mainnet
- TypeScript compiles cleanly with zero errors
- Ready for remaining Phase 84 plans

---
*Phase: 84-frontend-hardening-mainnet-readiness*
*Completed: 2026-03-08*
