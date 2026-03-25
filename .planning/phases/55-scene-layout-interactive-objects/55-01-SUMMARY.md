---
phase: 55-scene-layout-interactive-objects
plan: 01
subsystem: ui
tags: [react, tailwind, css-clip-path, accessibility, scene, interactive]

# Dependency graph
requires:
  - phase: 53-design-tokens-typography
    provides: Tailwind v4 @theme tokens (factory-*, z-*, font-heading)
  - phase: 53-asset-optimization
    provides: SCENE_DATA module with overlay positions and blur placeholders
  - phase: 54-modal-system
    provides: ModalProvider, StationId type, useModal hook, openModal API
provides:
  - Station metadata array (STATIONS) mapping overlayId to StationId, label, tab order, clip-path
  - SceneStation interactive button component with glow, press, tooltip, modal wiring
  - StationTooltip accessible tooltip component
  - SwapPlaceholder CSS-only steampunk placeholder
affects:
  - 55-02 (page compositor will iterate STATIONS and render SceneStation for each)
  - 56 (station content panels rendered inside modals opened by SceneStation clicks)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Station metadata centralized in scene-data.ts, decoupled from component logic"
    - "Two-layer div>button pattern: outer div for positioning + group, inner button for clip-path + interaction"
    - "CSS clip-path polygon() for click area restriction traced from overlay images"
    - "Tailwind group pattern for tooltip visibility (group-hover, group-focus-within)"
    - "Click origin passthrough: clientX/clientY for mouse, getBoundingClientRect center for keyboard"

key-files:
  created:
    - app/components/scene/scene-data.ts
    - app/components/scene/StationTooltip.tsx
    - app/components/scene/SwapPlaceholder.tsx
    - app/components/scene/SceneStation.tsx
  modified: []

key-decisions:
  - "Clip-path polygons traced from actual overlay images with ~10-25 contour points each"
  - "Accepted tight glow (clip-path clips drop-shadow) per RESEARCH.md Simple approach"
  - "Used brightness-125 (Tailwind v4 percentage scale) for hover brightness boost"
  - "Tooltip uses group-focus-within (not group-focus-visible) for broader focus state coverage"
  - "Image rendered directly inside button (not FactoryOverlay component) with alt='' since button has aria-label"

patterns-established:
  - "SceneStation pattern: station prop -> SCENE_DATA lookup -> positioned button with clip-path + modal wiring"
  - "Station metadata as data: STATIONS array is the single source of truth for tab order, labels, and hit areas"

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 55 Plan 01: Scene Station Components Summary

**Centralized station metadata with clip-path hit areas, interactive SceneStation button with amber glow/press/tooltip, and CSS swap placeholder**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T17:58:10Z
- **Completed:** 2026-02-23T18:01:42Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments

- Centralized STATIONS metadata array mapping all 6 overlay IDs to StationIds with tab-priority ordering, display labels, and clip-path polygons traced from the actual WebP overlay images
- SceneStation interactive button component with amber drop-shadow glow on hover/focus, scale-95 mechanical press on active, clip-path hit area restriction, and openModal wiring with click-origin coordinates for iris animation
- Accessible tooltip component using Tailwind group pattern for zero-JS visibility toggle
- CSS-only steampunk placeholder for the unavailable swap-station asset

## Task Commits

Each task was committed atomically:

1. **Task 1: Station metadata, tooltip, and swap placeholder** - `e807195` (feat)
2. **Task 2: SceneStation interactive button component** - `ccca881` (feat)

## Files Created/Modified

- `app/components/scene/scene-data.ts` - STATIONS array with 6 entries: overlayId, stationId, label, clipPath for each factory station
- `app/components/scene/StationTooltip.tsx` - Accessible tooltip (role="tooltip") with group-hover/focus-within CSS visibility
- `app/components/scene/SwapPlaceholder.tsx` - CSS-only steampunk gear silhouette with "Coming Soon" label
- `app/components/scene/SceneStation.tsx` - Interactive button wrapping overlay Image or SwapPlaceholder with glow, press, tooltip, and openModal

## Decisions Made

- **Clip-path polygons from image analysis:** Each overlay image was visually examined and ~10-25 contour points traced as percentage coordinates. The polygons are intentionally slightly generous to avoid clipping visible content.
- **Tight glow accepted:** Per RESEARCH.md, clip-path clips drop-shadow. The Simple approach (accept tight glow) was chosen over the two-element filter hack for simplicity.
- **brightness-125 not brightness-120:** Tailwind v4 uses percentage scale; 120 is not a standard value. Used `brightness-125` (1.25x) which is the closest standard utility.
- **group-focus-within for tooltip:** Used `group-focus-within` instead of `group-focus-visible` because the button's focus state needs to propagate to the tooltip span, and `focus-within` catches both mouse focus and keyboard focus on the button element.
- **Direct Image rendering:** SceneStation renders the `<Image>` directly rather than using FactoryOverlay component, because the button needs to control alt="" (the button's aria-label is the accessible name) and pointer-events-none on the image.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 station components are ready for Plan 02 (page compositor) to import STATIONS and render SceneStation for each entry
- SceneStation reads SCENE_DATA for positioning -- no additional wiring needed
- The modal system (Phase 54) is already in place -- openModal calls will work immediately
- Existing FactoryBackground, FactoryOverlay, and LoadingSpinner components are untouched

---
*Phase: 55-scene-layout-interactive-objects*
*Completed: 2026-02-23*
