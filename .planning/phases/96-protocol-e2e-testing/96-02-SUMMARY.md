---
phase: 96-protocol-e2e-testing
plan: 02
subsystem: testing
tags: [e2e, charts, helius, mcap, epoch, staking, carnage, devnet]

# Dependency graph
requires:
  - phase: 96-01
    provides: "E2E script framework, 8 swap pairs validated, deployment config loader"
  - phase: 95
    provides: "Fresh graduated devnet deployment with running crank"
provides:
  - "Working chart pipeline (Helius webhook + candle aggregation + MCAP display)"
  - "Epoch observation + tax rate change verification in E2E suite"
  - "Staking lifecycle test (stake/earn/claim/unstake)"
  - "On-chain state reader for frontend cross-checking"
affects: [96-03, 96-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCAP formula: candle_price * (supply / 10^(SOL_DECIMALS - TOKEN_DECIMALS)) * SOL_USD"
    - "On-chain state reader pattern for E2E frontend cross-verification"

key-files:
  created:
    - scripts/e2e/lib/staking-flow.ts
  modified:
    - app/components/station/SwapStation.tsx
    - app/app/api/webhooks/helius/route.ts
    - scripts/e2e/devnet-e2e-validation.ts

key-decisions:
  - "Chart MCAP uses decimal difference (10^3) not TOKEN_DECIMALS (10^6) -- candle prices are lamports/base-unit ratios"
  - "Helius webhook re-registered with Phase 95 program IDs (not auto-discovered)"

patterns-established:
  - "MCAP formula: candle_price * (supply / 10^(SOL_DECIMALS - TOKEN_DECIMALS)) * SOL_USD"

# Metrics
duration: ~45min (across checkpoint pause)
completed: 2026-03-14
---

# Phase 96 Plan 02: Chart Pipeline + Epoch/Staking E2E Summary

**Fixed chart MCAP formula (decimal difference not TOKEN_DECIMALS), re-registered Helius webhook for Phase 95 program IDs, added epoch observation and staking lifecycle to E2E suite**

## Performance

- **Duration:** ~45 min (execution time, excluding checkpoint wait)
- **Started:** 2026-03-14
- **Completed:** 2026-03-14
- **Tasks:** 3/3 (2 auto + 1 checkpoint)
- **Files modified:** 4

## Accomplishments
- Fixed chart pipeline end-to-end: Helius webhook re-registered with current program IDs, MCAP formula corrected to use decimal difference (10^3) instead of TOKEN_DECIMALS (10^6)
- Added epoch observation logic to E2E orchestrator -- polls for epoch advancement, compares tax rates before/after
- Created full staking lifecycle test (stake PROFIT, earn yield, claim rewards, unstake)
- Built on-chain state reader for frontend cross-verification (epoch info, pool reserves, staking stats)
- User verified charts display correctly and frontend data matches on-chain state

## Task Commits

Each task was committed atomically:

1. **Task 1: Debug and fix chart pipeline** - Multiple commits:
   - `3a2f991` fix(96-02): fix chart pipeline by re-registering Helius webhook with current program IDs
   - `1ec7b7c` fix(96-02): chart y-axis shows MCAP in USD instead of raw SOL price
   - `5221597` fix(96-02): correct chart MCAP formula -- divide by TOKEN_DECIMALS
   - `1faacb2` fix(96-02): correct MCAP multiplier -- divide by decimal difference, not TOKEN_DECIMALS
2. **Task 2: Observe epoch/carnage + execute staking lifecycle** - `dcb2749` (feat)
3. **Task 3: Frontend verification checkpoint** - User approved

**State update:** `b4fba45` docs(96): update STATE.md -- 96-02 checkpoint approved

## Files Created/Modified
- `app/app/api/webhooks/helius/route.ts` - Re-registered webhook with Phase 95 AMM program ID
- `app/components/station/SwapStation.tsx` - Fixed MCAP formula: effectiveMultiplier uses decimal difference (SOL_DECIMALS - TOKEN_DECIMALS = 3) not TOKEN_DECIMALS (6)
- `scripts/e2e/devnet-e2e-validation.ts` - Added epoch observation, carnage monitoring, on-chain state reader
- `scripts/e2e/lib/staking-flow.ts` - Full staking lifecycle test (stake/earn/claim/unstake)

## Decisions Made
- **MCAP formula correction:** Candle prices are lamports-per-token-base-unit ratios. To convert to USD MCAP: `candle_price * (supply / 10^(SOL_DECIMALS - TOKEN_DECIMALS)) * SOL_USD`. The decimal difference is 10^3 (9 - 6), not 10^6. Using TOKEN_DECIMALS directly showed MCAP ~1000x too high.
- **Helius webhook re-registration:** Manually re-registered with Phase 95 program IDs rather than building auto-discovery (simpler, reliable).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MCAP multiplier used TOKEN_DECIMALS instead of decimal difference**
- **Found during:** Task 1 (chart pipeline fix)
- **Issue:** Chart showed MCAP ~1000x too high because effectiveMultiplier divided by 10^TOKEN_DECIMALS (10^6) when it should divide by 10^(SOL_DECIMALS - TOKEN_DECIMALS) (10^3)
- **Fix:** Changed effectiveMultiplier to use decimal difference (SOL_DECIMALS - TOKEN_DECIMALS = 3)
- **Files modified:** app/components/station/SwapStation.tsx
- **Verification:** Chart MCAP now matches expected values
- **Committed in:** 1faacb2 (final correction after iterating through 5221597 and 1ec7b7c)

---

**Total deviations:** 1 auto-fixed (1 bug fix -- iterative MCAP formula correction across 3 commits)
**Impact on plan:** Bug fix necessary for correct chart display. No scope creep.

## Issues Encountered
- MCAP formula required 3 iterations to get right: first showed raw SOL price (no USD conversion), then divided by TOKEN_DECIMALS (1000x too high), finally corrected to decimal difference. The root cause was understanding that candle prices are lamports/base-unit ratios, requiring only the decimal *difference* for unit conversion.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Chart pipeline fully functional for 96-03 stress testing
- E2E suite has epoch observation and staking lifecycle ready for FULL=1 mode
- On-chain state reader available for future cross-verification
- Ready for 96-03 (50-wallet stress test + multi-wallet + mobile sign-off)

---
*Phase: 96-protocol-e2e-testing*
*Completed: 2026-03-14*
