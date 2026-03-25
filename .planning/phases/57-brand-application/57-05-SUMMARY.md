---
phase: 57-brand-application
plan: 05
subsystem: ui
tags: [tailwind-v4, css-tokens, steampunk-palette, faction-identity, dashboard-components]

# Dependency graph
requires:
  - phase: 57-01
    provides: Refined steampunk palette tokens and faction identity tokens (factory-crime, factory-fraud)
provides:
  - 5 fully themed dashboard components with factory-* palette and faction tokens
  - Zero residual gray/zinc/blue/emerald classes in dashboard directory
affects: [57-06, 57-07, any future dashboard or trading terminal components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Faction identity tokens (factory-crime, factory-fraud) for CRIME/FRAUD indicators -- distinct from semantic status colors"
    - "factory-accent for financial value highlights (vault balance, SOL amounts, explorer links)"
    - "factory-error for error messages vs factory-crime for CRIME identity -- semantic vs identity distinction"

key-files:
  created: []
  modified:
    - app/components/dashboard/CarnageCard.tsx
    - app/components/dashboard/EpochCard.tsx
    - app/components/dashboard/TaxRatesCard.tsx
    - app/components/dashboard/PoolCard.tsx
    - app/components/dashboard/DashboardGrid.tsx

key-decisions:
  - "Purple-400 (SOL spent values) mapped to factory-accent -- no purple in steampunk palette, brass accent fits financial data"
  - "Emerald cheap-side highlight mapped to factory-accent/50 -- brass accent serves as the pool highlight color"
  - "Error messages use factory-error (semantic), CRIME values use factory-crime (identity) -- critical distinction maintained"

patterns-established:
  - "Dashboard faction pattern: CRIME values = text-factory-crime, FRAUD values = text-factory-fraud, throughout all cards"

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 57 Plan 05: Dashboard Cards Summary

**Re-themed all 5 dashboard components (CarnageCard, EpochCard, TaxRatesCard, PoolCard, DashboardGrid) with factory-* tokens and faction identity colors, eliminating 60+ gray/zinc/blue/emerald/purple class occurrences**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-23T23:17:25Z
- **Completed:** 2026-02-23T23:21:12Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- CarnageCard: 28+ gray/zinc/blue/emerald/purple occurrences replaced with factory-* tokens; CRIME burned values use factory-crime, FRAUD burned values use factory-fraud, vault balance and SOL amounts use factory-accent
- EpochCard: 10 gray/zinc/amber occurrences replaced; imminent warning banner uses factory-warning-* semantic tokens; cheap side indicator uses faction identity tokens
- TaxRatesCard: 6 replacements; CRIME tax rates use factory-crime, FRAUD tax rates use factory-fraud
- PoolCard: 14 zinc/emerald replacements; cheap side highlight uses factory-accent/50 border; reserves and prices use factory-text hierarchy
- DashboardGrid: error banner uses factory-error-surface/border/text semantic tokens

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-theme CarnageCard and EpochCard** - `96981be` (style)
2. **Task 2: Re-theme TaxRatesCard, PoolCard, and DashboardGrid** - `5adeb77` (style)

## Files Created/Modified
- `app/components/dashboard/CarnageCard.tsx` - Full factory-* re-theme with faction tokens for CRIME/FRAUD identity
- `app/components/dashboard/EpochCard.tsx` - Factory tokens with warning-* semantic banner and faction cheap side
- `app/components/dashboard/TaxRatesCard.tsx` - Faction tokens for all 4 tax rate rows
- `app/components/dashboard/PoolCard.tsx` - Factory tokens for reserves, prices, cheap side accent highlight
- `app/components/dashboard/DashboardGrid.tsx` - Error banner using factory-error-* semantic tokens

## Decisions Made
- Purple-400 (used for SOL spent values in CarnageCard) mapped to factory-accent rather than introducing a purple token -- no purple in the steampunk palette, and brass accent appropriately highlights financial values
- Emerald cheap-side pool highlight mapped to factory-accent/50 border and factory-accent badge -- brass accent serves as the universal "highlighted/special" indicator in the steampunk theme
- Maintained strict separation between semantic error colors (factory-error for error messages) and faction identity colors (factory-crime for CRIME token values) even though both are reddish

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 dashboard components fully themed with zero gray/zinc/blue/emerald remnants
- Faction identity pattern (factory-crime, factory-fraud) established and consistent across all dashboard cards
- Ready for 57-06-PLAN.md (next component group re-theming)

---
*Phase: 57-brand-application*
*Completed: 2026-02-23*
