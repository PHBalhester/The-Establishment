---
phase: 41
plan: 02
subsystem: frontend-dashboard-ui
tags: [react-components, tailwind, dashboard, cards, responsive-grid, market-cap]
requires: [41-01-data-fetching-hooks]
provides: [dashboard-components, dashboard-landing-page, epoch-countdown, pool-price-toggle]
affects: [41-03-dashboard-enhancements]
tech-stack:
  added: []
  patterns: [props-only-cards, orchestrator-component, useMemo-computation, responsive-css-grid]
key-files:
  created:
    - app/components/dashboard/EpochCard.tsx
    - app/components/dashboard/TaxRatesCard.tsx
    - app/components/dashboard/PoolCard.tsx
    - app/components/dashboard/CarnageCard.tsx
    - app/components/dashboard/DashboardGrid.tsx
  modified:
    - app/app/page.tsx
key-decisions:
  - id: DASH-01
    decision: "DashboardGrid is sole hook consumer; all cards receive data as props"
    rationale: "Testable cards without hook mocking, single data source, reusable components"
  - id: DASH-02
    decision: "Market cap default view with toggle to price-per-token"
    rationale: "Market cap is more meaningful for memecoin users; price per token available on demand"
  - id: DASH-03
    decision: "PROFIT pools show N/A for market cap (no SOL side)"
    rationale: "PROFIT/USD price requires separate price feed not yet available; honest display"
  - id: DASH-04
    decision: "BalanceDisplay removed from main page (kept as component for future use)"
    rationale: "Dashboard is read-only; wallet balances belong on swap/staking pages"
duration: ~3 minutes
completed: 2026-02-15
---

# Phase 41 Plan 02: Dashboard Components Summary

**5 dashboard components wired into root landing page with epoch countdown, tax rates, pool prices with market cap toggle, and Carnage fund stats -- all read-only, no wallet needed**

## Performance

- **Duration:** ~3 minutes
- **Tasks:** 3/3 completed
- **TypeScript:** Zero errors across all components
- **Next.js build:** Clean production build, all pages generated

## Accomplishments

1. **EpochCard** -- Displays current epoch number prominently, cheap side indicator (CRIME in red / FRAUD in amber), and countdown timer. Countdown turns amber when epoch transition is imminent (<30 seconds), satisfying DATA-07 warning requirement.

2. **TaxRatesCard** -- Shows all 4 tax rates (CRIME buy/sell, FRAUD buy/sell) formatted as percentages from basis points. Clean row layout with token-colored text.

3. **PoolCard** -- Shows pool reserves for both sides with human-readable formatting (1.2M, 12.5K). Market cap (USD) as default view with toggle to price-per-token. Cheap side pools get emerald border highlight and "CHEAP" badge. SOL side auto-detected by WSOL mint address comparison.

4. **CarnageCard** -- Displays vault SOL balance (4 decimal places), lifetime burn stats (CRIME burned, FRAUD burned, SOL spent), total triggers, and last trigger epoch with relative "X epochs ago" display. Placeholder for per-event history (Plan 41-03).

5. **DashboardGrid** -- Orchestrator component that calls all 5 data hooks, computes epoch countdown via useMemo, determines cheap side pools, and renders all cards in a responsive CSS grid (1 col mobile, 2 col tablet, 3 col desktop).

6. **page.tsx** -- Replaced scaffold page with dashboard. Removed old proof-of-life content (StatusCard, ProgramRow, AdminConfig fetch). WalletButton preserved in header.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | EpochCard and TaxRatesCard | `06aff17` | EpochCard.tsx, TaxRatesCard.tsx |
| 2 | PoolCard and CarnageCard | `39218b2` | PoolCard.tsx, CarnageCard.tsx |
| 3 | DashboardGrid + page.tsx | `0424b2f` | DashboardGrid.tsx, page.tsx |

## Files Created

- `app/components/dashboard/EpochCard.tsx` -- Epoch number, cheap side, countdown timer card
- `app/components/dashboard/TaxRatesCard.tsx` -- 4 tax rates as formatted percentages card
- `app/components/dashboard/PoolCard.tsx` -- Pool reserves, market cap/price toggle card
- `app/components/dashboard/CarnageCard.tsx` -- Vault balance, lifetime burn stats card
- `app/components/dashboard/DashboardGrid.tsx` -- Orchestrator: hooks + countdown computation + grid layout

## Files Modified

- `app/app/page.tsx` -- Replaced scaffold with DashboardGrid landing page

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| DASH-01 | DashboardGrid is sole hook consumer; all cards receive data as props | Testable cards without hook mocking, single data source, reusable components |
| DASH-02 | Market cap default view with toggle to price-per-token | Market cap is more meaningful for memecoin users; price per token available on demand |
| DASH-03 | PROFIT pools show N/A for market cap (no SOL side) | PROFIT/USD price requires separate price feed not yet available; honest display |
| DASH-04 | BalanceDisplay removed from main page | Dashboard is read-only; wallet balances belong on swap/staking pages |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Ready for Plan 41-03** (Dashboard Enhancements):
- All 5 dashboard cards render with live data
- Per-event Carnage history placeholder is in place for 41-03 to populate
- Component architecture (props-only cards + orchestrator) supports adding more data without restructuring
- DATA requirements status:
  - DATA-01 (epoch number): Done
  - DATA-02 (countdown): Done
  - DATA-03 (tax rates): Done
  - DATA-04 (vault balance): Done
  - DATA-05 (aggregates): Done (per-event detail deferred to 41-03)
  - DATA-06 (pool prices/market cap): Done
  - DATA-07 (imminent warning): Done
