---
phase: 57-brand-application
plan: 04
subsystem: ui
tags: [tailwind-v4, staking-components, lever-tab, brass-input, steampunk-theme]

# Dependency graph
requires:
  - phase: 57-brand-application
    provides: Refined palette tokens, lever-tab/brass-input/brass-button CSS classes (Plan 01)
provides:
  - 6 fully themed staking components with factory-* palette
  - Lever-tab mechanical switch tabs on StakingForm
  - Brass-input styled amount fields on StakeTab and UnstakeTab
  - Semantic status banners (success/error/warning surfaces) on StakingStatus
affects: [57-05 through 57-07, any future staking UI changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "data-state attribute on lever-tab buttons driven by existing React state (no new state)"
    - "brass-input class on container div wrapping amount input (input itself uses bg-transparent)"
    - "brass-button class on Max buttons and Try Again button for consistent beveled appearance"

key-files:
  created: []
  modified:
    - app/components/staking/StakingForm.tsx
    - app/components/staking/StakeTab.tsx
    - app/components/staking/UnstakeTab.tsx
    - app/components/staking/ClaimTab.tsx
    - app/components/staking/StakingStats.tsx
    - app/components/staking/StakingStatus.tsx

key-decisions:
  - "StakingForm tab buttons: all inline color classes removed, replaced with single lever-tab class + data-state attribute"
  - "Amount input containers use brass-input class; inner input element stays bg-transparent for seamless look"
  - "Max buttons use brass-button class with text-factory-accent for accent color pop"
  - "StakingStatus idle action button uses brass-button + bg-factory-accent for primary CTA feel"
  - "ClaimTab reward amount uses text-factory-success (green) for positive reward display"
  - "Warning banner (UnstakeTab minimum stake) uses factory-warning-surface/border/text tokens"

patterns-established:
  - "Staking components: className-only theming without touching hook logic or prop interfaces"
  - "Lever-tab tab pattern: reuse existing state variable via data-state, zero new React state"

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 57 Plan 04: Staking Components Re-theme Summary

**Lever-tab mechanical switch tabs on StakingForm, brass-input amount fields on StakeTab/UnstakeTab, semantic status banners on StakingStatus -- all 6 staking components fully themed with zero gray/zinc/blue remnants**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-23T23:17:18Z
- **Completed:** 2026-02-23T23:20:04Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Converted StakingForm tab buttons from inline blue/gray class logic to single `.lever-tab` class with `data-state="active"/"inactive"` attribute driven by existing `staking.activeTab` state
- Applied `.brass-input` to amount field containers in StakeTab and UnstakeTab for recessed gauge appearance
- Applied `.brass-button` to Max buttons for consistent beveled brass look
- Converted StakingStatus to semantic factory banners: success-surface/border/text, error-surface/border/text, active-surface for in-progress
- Converted UnstakeTab minimum stake warning from amber-* to factory-warning-surface/border/text tokens
- ClaimTab reward amount display uses factory-success for positive reward emphasis

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-theme StakingForm tabs, StakeTab, and UnstakeTab** - `2f06bf4` (feat)
2. **Task 2: Re-theme ClaimTab, StakingStats, and StakingStatus** - `7eec768` (feat)

## Files Created/Modified
- `app/components/staking/StakingForm.tsx` - Tab buttons converted to lever-tab with data-state, container bg to factory-surface
- `app/components/staking/StakeTab.tsx` - Amount input container uses brass-input, Max button uses brass-button, all text uses factory-text-*
- `app/components/staking/UnstakeTab.tsx` - Same brass treatment as StakeTab, warning uses factory-warning-* tokens
- `app/components/staking/ClaimTab.tsx` - Reward amount uses factory-success, details panel uses factory-text-secondary
- `app/components/staking/StakingStats.tsx` - Container bg to factory-surface, all labels/values to factory-text-muted/factory-text
- `app/components/staking/StakingStatus.tsx` - 5 status states themed: not-connected, success banner, error banner, in-progress, idle action button

## Decisions Made
- Lever-tab buttons: removed ALL inline color classes and replaced with the single CSS class. The lever-tab CSS handles all visual states (default, hover, active, disabled) via data-state and pseudo-selectors. This is cleaner than conditional className strings.
- brass-input applied to the container div wrapping the input, not the input itself. The input uses bg-transparent so it inherits the brass-input background seamlessly.
- StakingStatus idle action button: uses brass-button + bg-factory-accent to give it a prominent CTA appearance while staying in the steampunk family. The bg-factory-accent overrides the brass-button default gradient for the primary action.
- Spinner SVG color changed from text-white to text-factory-accent (brass gold) for thematic consistency in the loading state.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 staking components now use exclusively factory-* palette classes
- Zero gray/zinc/blue classes remain in any staking component
- Lever-tab CSS pattern successfully applied (first use of this Phase 57 CSS class in production components)
- Next: 57-05-PLAN.md (remaining component re-theming)

---
*Phase: 57-brand-application*
*Completed: 2026-02-23*
