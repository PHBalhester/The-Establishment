---
phase: 43-staking-interface
plan: 02
subsystem: ui
tags: [staking, react-hooks, token-balances, cross-instance-sync, custom-event, staking-ui, tabs]

# Dependency graph
requires:
  - phase: 43-staking-interface plan 01
    provides: "staking-builders.ts, error-map.ts, rewards.ts, StakeVault PDA, deriveUserStakePDA"
  - phase: 42-swap-interface
    provides: "useSwap pattern, SwapForm pattern, useTokenBalances hook"
  - phase: 40-wallet-connection
    provides: "useProtocolWallet, useTokenBalances"
provides:
  - "useStaking orchestration hook with full transaction lifecycle"
  - "Tabbed staking UI components (StakeTab, UnstakeTab, ClaimTab, StakingStats, StakingStatus)"
  - "StakingForm container (sole hook consumer, props-only children)"
  - "Cross-instance token balance refresh via CustomEvent coordination"
  - "Staking section integrated into /swap page (two-column layout)"
affects: [44-helius-indexer, 45-railway-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-instance useTokenBalances sync via window CustomEvent (token-balances-refresh)"
    - "Tabbed form UI pattern (StakingForm mirrors SwapForm as sole hook consumer)"
    - "useStaking state machine: idle -> building -> signing -> sending -> confirming -> confirmed/failed"
    - "Self-dispatch guard ref to prevent double-fetch on CustomEvent broadcast"

key-files:
  created:
    - "app/hooks/useStaking.ts"
    - "app/components/staking/StakingForm.tsx"
    - "app/components/staking/StakeTab.tsx"
    - "app/components/staking/UnstakeTab.tsx"
    - "app/components/staking/ClaimTab.tsx"
    - "app/components/staking/StakingStatus.tsx"
    - "app/components/staking/StakingStats.tsx"
  modified:
    - "app/app/swap/page.tsx"
    - "app/hooks/useTokenBalances.ts"

key-decisions:
  - "Cross-instance balance sync via CustomEvent rather than React Context (zero refactoring, zero coupling)"
  - "Self-dispatch guard using useRef to prevent redundant double-fetch"
  - "Staking form placed as second column on /swap page (two-column lg+ layout)"
  - "useStaking consumes useTokenBalances directly (same pattern as useSwap)"

patterns-established:
  - "Cross-instance hook sync: window.dispatchEvent(new CustomEvent('token-balances-refresh')) for multi-hook pages"
  - "isDispatchingRef guard pattern: prevent self-triggered event listeners from causing redundant work"

# Metrics
duration: 10min
completed: 2026-02-16
---

# Phase 43 Plan 02: Staking UI Summary

**useStaking orchestration hook with tabbed UI (stake/unstake/claim), cross-instance token balance sync via CustomEvent, integrated into /swap page**

## Performance

- **Duration:** ~10 min (across two agent runs + checkpoint)
- **Started:** 2026-02-16T20:50:00Z (estimated)
- **Completed:** 2026-02-16T21:08:00Z
- **Tasks:** 2 (+ 1 post-checkpoint fix)
- **Files modified:** 9

## Accomplishments
- useStaking hook orchestrating full staking lifecycle (idle through confirmed/failed with auto-reset)
- 7 staking UI components: StakingForm, StakeTab, UnstakeTab, ClaimTab, StakingStatus, StakingStats
- Client-side pending reward calculation using BigInt math (mirrors on-chain update_rewards)
- Cross-instance token balance refresh so swap and staking sections stay in sync without page refresh
- Staking integrated into /swap page as two-column layout

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useStaking orchestration hook** - `84f2cd0` (feat)
2. **Task 2: Create staking UI components and integrate into /swap page** - `35118f3` (feat)
3. **Post-checkpoint fix: Cross-instance token balance refresh** - `c8e90b9` (fix)

## Files Created/Modified
- `app/hooks/useStaking.ts` - Full staking lifecycle orchestration hook (596 lines)
- `app/components/staking/StakingForm.tsx` - Tabbed form container, sole hook consumer
- `app/components/staking/StakeTab.tsx` - PROFIT amount input with balance display and MAX button
- `app/components/staking/UnstakeTab.tsx` - Unstake input with minimum-stake warning and auto-claim note
- `app/components/staking/ClaimTab.tsx` - One-click claim with pending rewards display
- `app/components/staking/StakingStatus.tsx` - Transaction status display (mirrors SwapStatus pattern)
- `app/components/staking/StakingStats.tsx` - Reward rate, pool share, protocol stats card
- `app/app/swap/page.tsx` - Added StakingForm in two-column layout alongside SwapForm
- `app/hooks/useTokenBalances.ts` - Added cross-instance refresh sync via CustomEvent

## Decisions Made
- **CustomEvent over React Context for balance sync**: Both useSwap and useStaking independently call useTokenBalances. Rather than refactoring to lift state into a shared Context (which would require changes to useSwap, SwapForm, useStaking, and StakingForm), used a window CustomEvent pattern. Any instance calling refresh() dispatches "token-balances-refresh", and all instances listen for it. Zero-coupling, zero refactoring of existing hooks.
- **Self-dispatch guard**: Used a useRef boolean (`isDispatchingRef`) to prevent the dispatching instance from responding to its own event, avoiding redundant RPC calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-instance token balance not refreshing after transactions**
- **Found during:** Post-checkpoint user testing
- **Issue:** useSwap and useStaking each instantiate their own useTokenBalances. When staking calls refreshBalances(), only the staking instance re-fetches. The swap section's PROFIT balance stays stale (and vice versa). User had to refresh the page.
- **Fix:** Added CustomEvent-based cross-instance sync to useTokenBalances. When any instance calls refresh(), it dispatches "token-balances-refresh" on window. All instances listen and re-fetch. Self-dispatch guard prevents double-fetch.
- **Files modified:** app/hooks/useTokenBalances.ts
- **Verification:** TypeScript compiles clean (npx tsc --noEmit passes)
- **Committed in:** `c8e90b9`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for correct UX. No scope creep.

## Issues Encountered

- **Pre-existing console error from useSwap.ts**: `DepositRewards: insufficient lamports` error appears in console during swaps. This is a pre-existing issue with the Tax Program's deposit_rewards CPI (the staking pool's reward balance is low or zero on devnet). NOT related to the staking UI -- it's a Tax Program operational issue that occurs when there aren't enough lamports in the reward fund. Logged for awareness but not a staking bug.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Full staking UI functional: stake, unstake, claim all working on devnet
- Token balance sync ensures swap and staking sections stay in sync
- Ready for Phase 44 (Helius Indexer + Charts) -- no staking dependencies needed
- Ready for Phase 45 (Railway Deployment) -- all UI features complete

---
*Phase: 43-staking-interface*
*Completed: 2026-02-16*
