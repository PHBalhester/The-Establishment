---
phase: 52-smart-swap-routing
plan: 03
subsystem: ui
tags: [react, tailwind, swap-ui, route-display, components]

# Dependency graph
requires:
  - phase: 52-01
    provides: Route type definition in route-types.ts
provides:
  - RouteSelector collapsible route list component
  - RouteCard individual route display with fees/impact
  - RouteBadge "Best" indicator badge
affects: [52-04 (swap page integration), 52-05 (hook wiring)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Props-only presentational components (no hooks in RouteCard/RouteBadge)"
    - "Anti-flicker route selection (10 bps threshold before auto-switching)"
    - "SVG circular countdown timer for quote refresh cycle"
    - "Token-specific color coding in path visualization"

key-files:
  created:
    - app/components/swap/RouteBadge.tsx
    - app/components/swap/RouteCard.tsx
    - app/components/swap/RouteSelector.tsx
  modified: []

key-decisions:
  - "Route flicker prevention: 10 bps (0.1%) threshold before auto-switching selected route"
  - "Compare routes by label string (stable across recomputation) for selection tracking"
  - "Conditional render (not height animation) for expand/collapse -- simpler for v1"
  - "Unicode arrow character for path viz instead of SVG arrows -- cleaner inline rendering"

patterns-established:
  - "Anti-flicker selection: keep current if within threshold of new best"
  - "Token color map: SOL=purple-400, CRIME=red-400, FRAUD=yellow-400, PROFIT=green-400"

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 52 Plan 03: Route Display UI Summary

**RouteSelector/RouteCard/RouteBadge components with color-coded path visualization, fee/impact breakdown, collapsible route list, and 0.1% anti-flicker selection stability**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T18:44:33Z
- **Completed:** 2026-02-20T18:46:54Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- RouteBadge renders a "Best" pill badge for the highest-ranked route
- RouteCard displays clickable route with path visualization (color-coded tokens), output amount, LP fee %, tax %, price impact with color thresholds (yellow >100bps, red >500bps), hop count, and split route annotation
- RouteSelector provides collapsible route list with expand/collapse, auto-selection with flicker prevention (10 bps threshold), circular SVG countdown timer for refresh cycle, loading state, and single-route mode

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RouteBadge and RouteCard components** - `394f356` (feat)
2. **Task 2: Create RouteSelector component** - `2deeb19` (feat)

## Files Created/Modified
- `app/components/swap/RouteBadge.tsx` - Simple "Best" badge component (named export)
- `app/components/swap/RouteCard.tsx` - Individual route card with path viz, output amount, fee/tax/impact breakdown, hop count, split annotation
- `app/components/swap/RouteSelector.tsx` - Collapsible route list with auto-selection, flicker prevention, countdown timer, expand/collapse

## Decisions Made
- **Route comparison by label:** Routes are recomputed on each refresh, so object identity changes. Comparing by `route.label` (e.g., "SOL -> CRIME -> PROFIT") provides stable identity across recomputation cycles.
- **Anti-flicker threshold at 10 bps:** From RESEARCH.md guidance. Only auto-switches when a different route beats current selection by >0.1%. Prevents jarring UI jumps from minor quote fluctuations.
- **Conditional render for expand/collapse:** Used simple conditional rendering instead of height animation for v1 simplicity. Can upgrade to `framer-motion` or CSS transitions later.
- **Unicode arrow in path viz:** Used Unicode right arrow (U+2192) between tokens instead of SVG arrow icons. Renders inline without layout complexity.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None -- TypeScript compilation passed on first attempt for all 3 components.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Route display components are ready for integration into the swap page
- Components accept Route[] as props, so they can be wired to the route engine from 52-01 via a hook (likely 52-04 or 52-05)
- No blockers or concerns

---
*Phase: 52-smart-swap-routing*
*Completed: 2026-02-20*
