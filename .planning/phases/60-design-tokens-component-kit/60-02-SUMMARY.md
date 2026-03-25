---
phase: 60-design-tokens-component-kit
plan: 02
subsystem: ui
tags: [css, tailwind-v4, design-tokens, @theme, @layer, css-custom-properties, border-image, 9-slice]

# Dependency graph
requires:
  - phase: 57-brand-application
    provides: Existing @theme token system, steampunk CSS component classes
provides:
  - 18 component kit design tokens in @theme (frame, slider, toggle, timing, glow)
  - kit.css with @layer kit (interactive, frame, scrollbar base classes)
  - Tailwind utility classes for all kit tokens (bg-frame-parchment, duration-kit-hover, etc.)
  - WCAG AA verified parchment color pairs
affects: [60-03, 60-04, 60-05, 60-06, 61-swap-station, 62-staking-station]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@import layer(kit) pattern for separate CSS file with cascade layer"
    - "kit-interactive shared hover/press/disabled behavior class"
    - "Dual-mode frame system: kit-frame-css (rounded) vs kit-frame-asset (9-slice)"
    - "data-active attribute for asset frame state switching"
    - "data-disabled attribute for non-button disabled states"

key-files:
  created:
    - app/app/kit.css
  modified:
    - app/app/globals.css

key-decisions:
  - "No @layer pre-declaration needed: @import layer(kit) after tailwindcss works without explicit @layer ordering"
  - "Added data-disabled attribute support to kit-interactive for non-button elements (divs, spans)"
  - "kit.css includes .kit-scrollbar utility (consistent with .modal-body scrollbar pattern)"

patterns-established:
  - "Kit tokens use standard Tailwind v4 namespaces (--color-*, --duration-*, --shadow-*) for auto utility generation"
  - "Kit CSS classes imported via CSS @import only, never from TypeScript (preserves layer cascade)"
  - "Parchment surfaces use ink text (#2a1f0e) not factory text (#ecdcc4)"

# Metrics
duration: 3min
completed: 2026-02-25
---

# Phase 60 Plan 02: Design Tokens + kit.css Summary

**18 @theme component tokens generating Tailwind utilities + kit.css @layer with shared interactive/frame/scrollbar base classes, verified Turbopack-compatible**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-25T17:54:34Z
- **Completed:** 2026-02-25T17:57:04Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Extended @theme with 18 component kit tokens (frame colors, interactive timing, slider, toggle, hover glow) that auto-generate Tailwind utility classes
- Created kit.css (176 lines) with @layer kit containing .kit-interactive, .kit-frame, .kit-frame-css, .kit-frame-asset, .kit-focus, and .kit-scrollbar
- Verified Turbopack compatibility: `next build` compiles successfully in 4.1s with zero CSS errors
- Added WCAG AA contrast verification matrix for parchment color pairs (ink on parchment ~14:1)
- Confirmed all existing steampunk styles (.brass-button, .lever-tab, .modal-chrome, .big-red-button, .brass-input) unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend @theme tokens and create kit.css with @layer kit** - `3bd2146` (feat)

## Files Created/Modified
- `app/app/kit.css` - Component kit CSS layer with shared interactive styles (.kit-interactive), frame base classes (.kit-frame, .kit-frame-css, .kit-frame-asset), focus utility (.kit-focus), and scrollbar utility (.kit-scrollbar)
- `app/app/globals.css` - Extended @theme with 18 component kit tokens + WCAG parchment contrast matrix + @import kit.css layer(kit)

## Decisions Made
- **No @layer pre-declaration needed:** The plan suggested trying `@layer theme, base, kit, components, utilities;` before `@import "tailwindcss"`, but testing showed `@import "./kit.css" layer(kit)` after the tailwindcss import works correctly without pre-declaration. Tailwind v4's internal layer handling is compatible. Simpler approach adopted.
- **Added data-disabled support:** kit-interactive selectors include `[data-disabled="true"]` in addition to `:disabled` pseudo-class, supporting non-button elements (divs, spans used as toggles/sliders) that cannot have the HTML disabled attribute.
- **Included .kit-scrollbar in kit.css:** Not explicitly listed in the plan task but mentioned in RESEARCH.md Example 4 as a kit class. Added for completeness since it follows the established .modal-body scrollbar pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added data-disabled attribute support to kit-interactive**
- **Found during:** Task 1 (kit.css creation)
- **Issue:** Plan only specified `:disabled` pseudo-class for disabled state, but non-button elements (divs for toggles, divs for sliders) cannot use the HTML disabled attribute
- **Fix:** Added `[data-disabled="true"]` selectors alongside `:disabled` in all interactive state rules
- **Files modified:** app/app/kit.css
- **Verification:** Build passes, CSS is valid
- **Committed in:** 3bd2146

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for components like Toggle and Slider that use div elements. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All kit tokens generate Tailwind utilities (bg-frame-parchment, duration-kit-hover, shadow-kit-hover-glow, etc.)
- kit.css base classes are ready for component plans (60-03 through 60-06) to build upon
- Turbopack compatibility verified -- no concerns for subsequent plans
- Frame asset placeholders (ornate-paper.webp) are referenced in CSS but files don't exist yet -- this is expected and will be created in the asset checkpoint between Wave 1 and Wave 2

---
*Phase: 60-design-tokens-component-kit*
*Completed: 2026-02-25*
