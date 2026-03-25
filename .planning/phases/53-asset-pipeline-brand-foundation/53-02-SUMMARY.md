---
phase: 53-asset-pipeline-brand-foundation
plan: 02
subsystem: ui
tags: [tailwindcss-v4, theme-tokens, next-font, cinzel, ibm-plex-mono, steampunk, css-variables, typography]

# Dependency graph
requires:
  - phase: none
    provides: "First visual foundation plan -- builds on blank globals.css canvas"
provides:
  - "15 steampunk color tokens as Tailwind v4 utilities (bg-factory-*, text-factory-*, border-factory-*)"
  - "7-layer z-index system (z-background through z-spinner)"
  - "6-step typography scale (text-display through text-micro)"
  - "3 CSS animation keyframes (fade-in, gear-spin, pulse-glow)"
  - "Cinzel heading font (font-heading utility)"
  - "IBM Plex Mono financial data font (font-mono utility)"
  - "Reduced-motion media query for accessibility"
affects: [phase-54-modal-system, phase-55-scene-layout, phase-56-station-content, phase-57-brand-application, phase-58-ambient-animations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tailwind v4 @theme tokens for all design decisions (no tailwind.config.js)"
    - "@theme inline for bridging next/font CSS variables to Tailwind font-family utilities"
    - "next/font/google for self-hosted Google Fonts with zero external network requests"

key-files:
  created:
    - "app/app/fonts.ts"
  modified:
    - "app/app/globals.css"
    - "app/app/layout.tsx"

key-decisions:
  - "Cinzel for headings: Roman inscriptional display serif matches engraved nameplate aesthetic"
  - "IBM Plex Mono for financial data: industrial heritage + tabular numerals for column alignment"
  - "System font stack for body text: readable sans-serif, Cinzel is heading/display only"
  - "Z-index increments of 10: provides room for intermediate layers if needed later"
  - "Keyframes defined outside @theme: Tailwind v4 does not support @keyframes inside @theme blocks"

patterns-established:
  - "Color tokens use --color-factory-* namespace (bg-factory-bg, text-factory-accent, etc.)"
  - "Z-index tokens use --z-index-* namespace (z-background, z-modal, z-spinner, etc.)"
  - "Typography uses --text-* namespace (text-display, text-heading, text-body, etc.)"
  - "Animations use --animate-* namespace (animate-fade-in, animate-gear-spin, etc.)"
  - "Fonts loaded via fonts.ts -> CSS variables on <html> -> @theme inline -> Tailwind utilities"

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 53 Plan 02: Steampunk Theme Tokens + Typography Summary

**Tailwind v4 @theme steampunk design system with 15 colors, z-index layering, typography scale, animation keyframes, and Cinzel/IBM Plex Mono fonts self-hosted via next/font/google**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T20:49:19Z
- **Completed:** 2026-02-22T20:51:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Complete steampunk color palette (15 tokens) generating working Tailwind utilities for backgrounds, text, borders, and status indicators
- Z-index layering system (7 named layers) ensuring predictable stacking across scene, overlays, tooltips, and modals
- Typography scale (6 sizes from 3rem display to 0.75rem micro) and 3 animation keyframes for steampunk effects
- Cinzel (variable font, headings) and IBM Plex Mono (financial data) self-hosted with zero external network requests
- Font pipeline: fonts.ts exports -> CSS variables on html -> @theme inline bridge -> font-heading/font-mono utilities
- Body element defaults to dark warm steampunk background (#1a1208) with parchment text (#e8dcc8)
- Reduced-motion media query disabling all animations for accessibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Define steampunk theme tokens in globals.css** - `52a91e8` (feat)
2. **Task 2: Create font definitions and wire into layout** - `f3340f3` (feat)

## Files Created/Modified

- `app/app/globals.css` - Complete steampunk design token system: @theme block with colors, z-index, typography, animations; @theme inline for font bridges; reduced-motion media query
- `app/app/fonts.ts` - Cinzel (variable 400-900) and IBM Plex Mono (400/500/700) definitions with CSS variable names
- `app/app/layout.tsx` - Font CSS variables on html element, steampunk base classes on body (bg-factory-bg text-factory-text)

## Decisions Made

1. **Cinzel over Playfair Display/EB Garamond** - Roman inscriptional letterforms match the "engraved nameplates" vision from context. Designed for all-caps display, which suits headings/titles. Variable font means single file for all weights.
2. **IBM Plex Mono over JetBrains Mono** - Industrial heritage aligns with steampunk instrument-readout aesthetic. Tabular numerals built-in for financial data alignment. Three specific weights (400/500/700) minimize download size.
3. **System font stack for body text** - Per context decision "Body text must remain highly readable despite decorative heading style." Cinzel is heading/display only.
4. **Keyframes outside @theme block** - Tailwind v4 does not support @keyframes declarations inside @theme {}. Defined at top level of globals.css with @theme referencing animation shorthand values.
5. **Typography uses --text-* namespace** - Custom names (display, heading, subheading, body, detail, micro) do not collide with Tailwind defaults (sm, base, lg, xl). Generates text-display, text-heading, etc. directly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All theme tokens available for Phase 53-03 (factory scene components) and all subsequent phases
- Font pipeline verified: Cinzel and IBM Plex Mono load correctly via next/font/google
- Build passes cleanly with all new tokens and fonts
- Ready for 53-03-PLAN.md (Factory scene components: FactoryBackground, FactoryOverlay, LoadingSpinner)

---
*Phase: 53-asset-pipeline-brand-foundation*
*Completed: 2026-02-22*
