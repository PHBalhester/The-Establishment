---
phase: 57-brand-application
plan: 06
subsystem: ui
tags: [tailwind-v4, chart-theming, candlestick-chart, wallet-ui, steampunk-palette]

# Dependency graph
requires:
  - phase: 57-brand-application-01
    provides: Refined @theme token palette and CSS component classes (brass-button, etc.)
provides:
  - 6 fully themed component files (chart controls, candlestick chart, wallet modal, wallet button, balance display, legacy swap page)
  - CandlestickChart JS hex values aligned with @theme tokens
affects: [57-07 verification pass]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CandlestickChart JS hex values hardcoded with documentation comment mapping to @theme tokens"
    - "Semantic status indicators (connected/reconnecting/disconnected) use factory-success/warning/error tokens"
    - "Faction identity colors for balance display (factory-crime, factory-fraud, factory-profit)"

key-files:
  created: []
  modified:
    - app/components/chart/ChartControls.tsx
    - app/components/chart/CandlestickChart.tsx
    - app/components/wallet/ConnectModal.tsx
    - app/components/wallet/WalletButton.tsx
    - app/components/wallet/BalanceDisplay.tsx
    - app/app/swap/page.tsx

key-decisions:
  - "CandlestickChart uses hardcoded hex strings matching @theme tokens (not getComputedStyle) -- simplicity over dynamism"
  - "Candle up/down colors warm-shifted to factory-success #5da84a / factory-error #c04030 instead of standard green-500/red-500"
  - "SOL balance uses factory-accent color (brass gold) since there is no dedicated SOL faction token"
  - "ConnectModal buttons use brass-button CSS class for consistent beveled appearance"

patterns-established:
  - "Chart hex value documentation: comment block above createChart() lists each hex and its @theme token origin"

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 57 Plan 06: Chart, Wallet, and Legacy Page Re-theme Summary

**Re-themed CandlestickChart JS hex values to factory palette, ChartControls to factory-accent active states, wallet components to factory-surface/border, and legacy swap page to factory-bg/text**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T23:17:25Z
- **Completed:** 2026-02-23T23:21:28Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Updated CandlestickChart createChart() JS hex values to match @theme tokens: bg #1c120a, grid #4a3520, crosshair #86644a, candle up #5da84a, down #c04030
- Re-themed ChartControls with factory-accent for active pool/range buttons, factory-surface for containers, factory-success/warning/error for status dots
- Replaced all zinc-* classes in ConnectModal (16 occurrences), WalletButton (6), and BalanceDisplay (10) with factory-* equivalents
- Updated legacy swap/page.tsx from gray-950/100 to factory-bg/text (including header border, nav link hover, heading colors)
- Zero gray/zinc/blue/indigo class remnants across all 6 target files

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-theme ChartControls and CandlestickChart** - `4da665d` (feat)
2. **Task 2: Re-theme wallet components and legacy swap page** - `9789d6f` (feat)

## Files Created/Modified
- `app/components/chart/ChartControls.tsx` - Factory-accent active states, factory-surface container, semantic status dots
- `app/components/chart/CandlestickChart.tsx` - JS hex values mapped to @theme tokens with documentation comment
- `app/components/wallet/ConnectModal.tsx` - Factory-surface/border modal, brass-button class on action buttons
- `app/components/wallet/WalletButton.tsx` - Factory-surface-elevated button states, brass-button connect CTA
- `app/components/wallet/BalanceDisplay.tsx` - Factory-surface cards, faction identity colors, factory-error-* error state
- `app/app/swap/page.tsx` - Factory-bg/text wrapper, factory-border-subtle header divider

## Decisions Made
- CandlestickChart uses hardcoded hex strings matching @theme tokens rather than getComputedStyle() runtime reads -- chart colors do not change at runtime so the added complexity has zero benefit
- Candle up/down colors use factory-success (#5da84a) and factory-error (#c04030) for warm-shifted green/red that fits the steampunk palette
- SOL balance color uses factory-accent (brass gold) since SOL is not a faction token and has no dedicated color token
- ConnectModal action buttons use the brass-button CSS class from Plan 01 for consistent beveled appearance across the UI

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 target component files fully themed with factory-* palette
- CandlestickChart JS hex values documented and aligned with @theme tokens
- Ready for 57-07 comprehensive verification pass (if applicable)

---
*Phase: 57-brand-application*
*Completed: 2026-02-23*
