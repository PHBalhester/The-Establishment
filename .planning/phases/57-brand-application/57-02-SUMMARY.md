---
phase: 57-brand-application
plan: 02
subsystem: ui
tags: [tailwind-v4, factory-tokens, swap-form, steampunk-theming, brass-input, lever-tab]

# Dependency graph
requires:
  - phase: 57-brand-application-01
    provides: Refined palette tokens, CSS component classes (brass-input, lever-tab, brass-button)
provides:
  - 6 fully themed swap form components with zero gray/zinc/blue remnants
  - SwapForm, TokenSelector, SlippageConfig, FeeBreakdown, SwapStatus, RouteBadge
affects: [57-03 through 57-07, any future swap UI modifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "lever-tab with data-state attribute for slippage/priority preset buttons"
    - "brass-input class on custom slippage input field"
    - "brass-button class on flip button and try-again button"
    - "Semantic status tokens (factory-success-*/error-*/warning-*) for transaction lifecycle banners"

key-files:
  created: []
  modified:
    - app/components/swap/SwapForm.tsx
    - app/components/swap/TokenSelector.tsx
    - app/components/swap/SlippageConfig.tsx
    - app/components/swap/FeeBreakdown.tsx
    - app/components/swap/SwapStatus.tsx
    - app/components/swap/RouteBadge.tsx

key-decisions:
  - "Price impact severity uses factory-error (>5%) and factory-warning (>1%) -- semantic status, not faction identity"
  - "Smart routing toggle knob uses factory-text for the dot (parchment on brass/elevated surface)"
  - "Swap idle button uses factory-accent bg with factory-bg text for maximum contrast (dark on gold)"
  - "RouteBadge uses factory-accent/factory-bg same as swap button for visual consistency"
  - "TokenSelector TOKEN_COLORS left as-is (purple/red/green/yellow) -- token identity badges, not gray/zinc/blue"

patterns-established:
  - "data-state='active'/'inactive' on lever-tab buttons driven by conditional logic"
  - "Semantic status surface/border/text triplet pattern for success/error/warning banners"

# Metrics
duration: 5min
completed: 2026-02-23
---

# Phase 57 Plan 02: Swap Form Core Components Summary

**Re-themed 6 swap form components (SwapForm, TokenSelector, SlippageConfig, FeeBreakdown, SwapStatus, RouteBadge) replacing all gray/zinc/blue with factory-* tokens, brass-input, lever-tab, and brass-button CSS classes**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-23T23:17:01Z
- **Completed:** 2026-02-23T23:22:05Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Replaced all gray/zinc/blue class occurrences across 6 swap form components with factory-* palette tokens
- Applied lever-tab CSS class with data-state attribute to slippage presets and priority fee buttons (3 button groups)
- Applied brass-input class to custom slippage input field
- Applied brass-button class to flip button and try-again button
- Used semantic status surface/border/text triplets for SwapStatus confirmed/failed/in-progress banners
- Used factory-error/warning for price impact severity indicators in FeeBreakdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-theme SwapForm, TokenSelector, and SlippageConfig** - `fda71c8` (feat)
2. **Task 2: Re-theme FeeBreakdown, SwapStatus, and RouteBadge** - `7f5cc13` (feat)

## Files Created/Modified
- `app/components/swap/SwapForm.tsx` - 20 factory-* replacements: backgrounds, text, borders, toggle, Max button, flip button (brass-button), warning banner
- `app/components/swap/TokenSelector.tsx` - Trigger button, dropdown, option items, selected checkmark all using factory-* tokens
- `app/components/swap/SlippageConfig.tsx` - Preset buttons use lever-tab with data-state, custom input uses brass-input, labels/warnings use factory-* tokens
- `app/components/swap/FeeBreakdown.tsx` - Labels, values, borders, price impact severity colors all using factory-* tokens
- `app/components/swap/SwapStatus.tsx` - Success/error/in-progress banners use semantic triplets, idle button uses factory-accent, disabled state uses factory-surface-elevated
- `app/components/swap/RouteBadge.tsx` - Badge pill uses factory-accent bg with factory-bg text

## Decisions Made
- Price impact colors use semantic tokens (factory-error for >5%, factory-warning for >1%) rather than faction identity tokens -- these indicate severity, not CRIME/FRAUD identity
- Smart routing toggle knob uses factory-text (parchment) instead of bg-white -- stays in palette
- Swap button uses factory-accent bg with factory-bg text for strong dark-on-gold contrast
- TokenSelector TOKEN_COLORS (purple/red/green/yellow badge circles) left unchanged -- they are token identity colors, not part of the gray/zinc/blue sweep
- Try-again button uses brass-button class instead of inline bg-gray-700 for consistency with other secondary actions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 core swap form components now use exclusively factory-* palette classes
- CSS component classes (brass-input, lever-tab, brass-button) proven in real component usage
- Semantic status triplet pattern established for reuse in MultiHopStatus, StakingStatus, etc.
- Next: 57-03-PLAN.md (additional swap components or staking components)

---
*Phase: 57-brand-application*
*Completed: 2026-02-23*
