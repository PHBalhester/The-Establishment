---
phase: 43-staking-interface
plan: 01
subsystem: ui
tags: [staking, transaction-builders, token-2022, transfer-hook, bigint, anchor, error-map]

# Dependency graph
requires:
  - phase: 42-swap-interface
    provides: "hook-resolver.ts, swap-builders.ts pattern, error-map pattern, anchor.ts"
  - phase: 26-29 (v0.6 Staking/Yield)
    provides: "On-chain staking program (Bb8ist), StakePool/UserStake account structs"
provides:
  - "Staking transaction builders (stake, unstake, claim) for frontend use"
  - "Staking error map covering all 11 program error codes"
  - "Client-side pending reward calculation with BigInt precision"
  - "StakeVault PDA in shared constants"
  - "deriveUserStakePDA helper for hook/component use"
affects: [43-02 (useStaking hook), 43-03 (staking components)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Staking transaction builder pattern (mirrors swap-builders.ts)"
    - "BigInt arithmetic for u128 on-chain fields (PRECISION=1e18)"
    - "Hook direction reversal for unstake (vault->user vs user->vault)"

key-files:
  created:
    - "app/lib/staking/staking-builders.ts"
    - "app/lib/staking/error-map.ts"
    - "app/lib/staking/rewards.ts"
  modified:
    - "shared/constants.ts"

key-decisions:
  - "StakeVault added to DEVNET_PDAS_EXTENDED (was missing because swap builders didn't need it)"
  - "Claim uses lower default compute units (100,000 vs 200,000) since it's simpler (no token transfer)"
  - "calculatePendingRewards takes all BigInt params, converts to Number only at return (safe for lamports)"
  - "calculateRewardRate annualizedPct defaults to 0 when SOL/PROFIT price unavailable"

patterns-established:
  - "Staking builder pattern: compute budget -> ATA check -> hook resolution -> Anchor instruction"
  - "Hook direction: stake=user->vault, unstake=vault->user, claim=none"
  - "BigInt conversion: Anchor BN -> BigInt(bn.toString()) before reward calculation"

# Metrics
duration: 4min
completed: 2026-02-16
---

# Phase 43 Plan 01: Staking Transaction Infrastructure Summary

**Three staking transaction builders (stake/unstake/claim), error map for 11 error codes, and BigInt-precise reward calculator mirroring on-chain math.rs**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T19:23:47Z
- **Completed:** 2026-02-16T19:27:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Staking transaction builders for all 3 instructions: stake (8+4 accounts), unstake (9+4 accounts), claim (5 accounts)
- Correct hook direction for each instruction: stake user->vault, unstake vault->user (REVERSED), claim none
- Error map covering all 11 staking program error codes (6000-6010) with user-friendly messages
- Client-side pending reward calculation using BigInt arithmetic matching on-chain PRECISION=1e18
- StakeVault PDA added to DEVNET_PDAS_EXTENDED for shared access

## Task Commits

Each task was committed atomically:

1. **Task 1: Add StakeVault to shared constants + create staking transaction builders** - `e65f5e0` (feat)
2. **Task 2: Create staking error map + client-side reward calculation** - `f5fe712` (feat)

## Files Created/Modified
- `shared/constants.ts` - Added StakeVault PDA to DEVNET_PDAS_EXTENDED
- `app/lib/staking/staking-builders.ts` - Transaction builders for stake, unstake, claim with hook resolution
- `app/lib/staking/error-map.ts` - parseStakingError covering 11 error codes + common TX errors
- `app/lib/staking/rewards.ts` - calculatePendingRewards (BigInt), calculateRewardRate (APR stats)

## Decisions Made
- Used DEVNET_PDAS_EXTENDED.StakeVault everywhere (not hardcoded address) for consistency with swap builder pattern
- Claim defaults to 100,000 compute units (vs 200,000 for stake/unstake) since it's a simpler instruction with no token transfer
- Reward calculation uses BigInt for ALL intermediate math, only converting to Number at the final lamport return value
- annualizedPct requires solPricePerProfit parameter; defaults to 0 when unavailable (UI hides APR line)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All transaction builders ready for consumption by useStaking hook (Plan 02)
- Error map ready for transaction error parsing in hook
- Reward calculation ready for display computation in hook
- deriveUserStakePDA exported for account reads in hook

---
*Phase: 43-staking-interface*
*Completed: 2026-02-16*
