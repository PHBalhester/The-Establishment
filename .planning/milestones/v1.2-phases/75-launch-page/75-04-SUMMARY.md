---
phase: 75-launch-page
plan: 04
subsystem: ui
tags: [bonding-curve, buy-sell, transaction-builder, slippage, debounce, preview, steampunk]

# Dependency graph
requires:
  - phase: 75-launch-page
    provides: "Plan 01: curve-math, curve-constants, useCurveState hook"
  - phase: 75-launch-page
    provides: "Plan 02: buildPurchaseInstruction, buildSellInstruction TX builders"
  - phase: 75-launch-page
    provides: "Plan 03: LaunchScene, /launch page shell with overlay positioning"
provides:
  - BuySellPanel with CRIME/FRAUD tabs and Buy/Sell toggle
  - BuyForm with SOL input, debounced quote preview, purchase TX execution
  - SellForm with token input, debounced sell quote with 15% tax, sell TX execution
  - PreviewBreakdown with formatted trade metrics (price, impact, tax, holdings, cap)
affects: [75-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [debounced-quote-preview, sign-then-send-curve-tx, bigint-to-display-formatting]

key-files:
  created:
    - app/components/launch/BuySellPanel.tsx
    - app/components/launch/BuyForm.tsx
    - app/components/launch/SellForm.tsx
    - app/components/launch/PreviewBreakdown.tsx
  modified:
    - app/app/launch/page.tsx

key-decisions:
  - "No new decisions -- plan executed as specified"

patterns-established:
  - "Debounced quote preview: 300ms debounce on input change, BigInt curve math, display formatting at render boundary"
  - "Sell slippage on net amount: minimumSolOut = (grossSol - tax) * (10000 - slippageBps) / 10000, matching on-chain check"

# Metrics
duration: 6min
completed: 2026-03-07
---

# Phase 75 Plan 04: Buy/Sell Panel Summary

**Tabbed CRIME/FRAUD buy/sell panel with debounced curve-math quote preview, per-wallet cap validation, and slippage-protected TX execution via sign-then-send**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-07T10:51:01Z
- **Completed:** 2026-03-07T10:56:36Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Built BuySellPanel container with CRIME/FRAUD tabs, Buy/Sell toggle, and disabled overlay for inactive curves
- Created BuyForm with SOL input, debounced calculateTokensOut quote, balance/cap validation, and purchase TX with slippage protection
- Created SellForm with token input, debounced calculateSolForTokens + calculateSellTax quote, and sell TX with slippage on net (post-tax) amount
- Built PreviewBreakdown showing all trade metrics: input/output, current/post price, price impact %, sell tax, holdings vs cap, USD values
- Integrated BuySellPanel into /launch page for both desktop (overlay) and mobile (stacked) layouts

## Task Commits

Each task was committed atomically:

1. **Task 1: BuySellPanel container with tabs, toggle, and PreviewBreakdown** - `911b80c` (feat)
2. **Task 2: BuyForm, SellForm with quote preview and TX execution** - `eb38997` (feat)

## Files Created/Modified
- `app/components/launch/BuySellPanel.tsx` - Tabbed CRIME/FRAUD selection with Buy/Sell toggle, disabled overlay for non-active curves
- `app/components/launch/BuyForm.tsx` - SOL input, debounced quote via calculateTokensOut, cap/balance validation, purchase TX with slippage
- `app/components/launch/SellForm.tsx` - Token input, debounced quote via calculateSolForTokens + calculateSellTax, sell TX with slippage on net amount
- `app/components/launch/PreviewBreakdown.tsx` - Formatted trade metrics display (prices, impact, tax, holdings, cap, USD)
- `app/app/launch/page.tsx` - Added BuySellPanel import and placement in desktop (overlay) and mobile (stacked) layouts

## Decisions Made
None - followed plan as specified. All implementation choices aligned with existing patterns (sign-then-send, pollTransactionConfirmation, parseCurveError).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript error in lib/staking/staking-builders.ts (references removed systemProgram account). Not related to this plan, documented as existing deferred item.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Buy/sell panel complete and integrated into /launch page
- All curve trading functionality operational: quote preview, validation, TX execution
- Ready for Plan 05 (state machine UI) to add conditional rendering based on curve status (failed -> refund, graduated -> celebration)

---
*Phase: 75-launch-page*
*Completed: 2026-03-07*
