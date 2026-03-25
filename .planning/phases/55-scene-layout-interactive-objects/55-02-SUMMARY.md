---
phase: 55-scene-layout-interactive-objects
plan: 02
subsystem: ui
tags: [react, tailwind, scene-compositor, responsive, accessibility]

# Dependency graph
requires:
  - phase: 55-01
    provides: STATIONS array, SceneStation component, StationTooltip, SwapPlaceholder
  - phase: 53-asset-optimization
    provides: FactoryBackground component, SCENE_DATA module
  - phase: 54-modal-system
    provides: ModalProvider, useModal hook, openModal API
provides:
  - Full-viewport interactive factory scene as the root page
  - Unified scene container with contain-fit scaling strategy
  - Mobile fallback message below 1024px
affects:
  - 56 (station content renders inside modals opened by scene station clicks)
  - 58 (ambient animations layer into the scene container)
  - 59 (mobile nav replaces the below-1024px fallback)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contain-fit scene scaling: min() CSS function ensures entire scene fits viewport, letterbox/pillarbox with bg-factory-bg"
    - "Unified coordinate space: background image and overlay stations share same container, scale identically"
    - "Scene IS navigation: no header, no nav bar -- factory machines are the entry points"

key-files:
  created: []
  modified:
    - app/app/page.tsx
    - app/components/scene/FactoryBackground.tsx
    - app/components/scene/SceneStation.tsx
  deleted:
    - app/components/scene/StationTooltip.tsx

key-decisions:
  - "Removed clip-path polygons: hand-traced polygons were cutting off visible overlay content (e.g. Connect Wallet sign corners). Full bounding-box click areas are sufficient."
  - "Contain-fit over cover-crop: min() instead of max() ensures all 6 stations stay visible at every viewport size. Letterbox/pillarbox bars use bg-factory-bg seamlessly."
  - "Tooltips removed: user preference -- glow effect provides sufficient interactive affordance without tooltip labels."
  - "Glow boosted: drop-shadow 16px/0.6 -> 28px/0.9, brightness 125 -> 140 for more visible hover feedback."
  - "Image ratio is 1.81:1 (5568/3072), not 16:9 -- confirmed from actual image file dimensions."

patterns-established:
  - "Contain-fit responsive scene: use min() for scene container sizing to prevent cropping interactive elements"
  - "Human-in-the-loop checkpoint: visual verification revealed 4 issues (clip-path, scaling, glow, tooltips) -- all resolved through iterative feedback"

# Metrics
duration: 25min (including 4 rounds of human verification and iteration)
completed: 2026-02-23
---

# Phase 55 Plan 02: Scene Compositor Summary

**Rewrote page.tsx as full-viewport factory scene compositor with contain-fit scaling, iterative visual fixes from human verification**

## Performance

- **Duration:** ~25 min (including human verification iterations)
- **Started:** 2026-02-23
- **Completed:** 2026-02-23
- **Tasks:** 1 auto + 1 checkpoint (with 4 rounds of feedback)
- **Files modified:** 3
- **Files deleted:** 1

## Accomplishments

- Rewrote page.tsx as a clean scene compositor: FactoryBackground wraps 6 SceneStation children in tab-priority order, removing all Phase 54 demo code
- Unified scene container where background image and overlay stations share the same coordinate space, eliminating the scaling mismatch that caused overlays to drift
- Contain-fit scaling strategy using CSS `min()` function: entire scene fits within the viewport while maintaining 1.81:1 aspect ratio, with seamless letterbox/pillarbox bars
- Mobile fallback below 1024px with factory-themed message
- All Phase 54 demo triggers removed (ModalDemoTrigger, DEMO_STATIONS)

## Human Verification Iterations

The checkpoint revealed issues that were fixed iteratively:

1. **Clip-path clipping content**: Hand-traced polygon coordinates cut off visible overlay art (e.g. Connect Wallet sign corners). Fixed by removing all clip-path polygons.
2. **Background/overlay scaling mismatch**: Background used object-cover (crops) but overlays were in a separate container that scaled differently. Fixed with unified scene container.
3. **Glow not bright enough**: Boosted drop-shadow spread (16px->28px), opacity (0.6->0.9), brightness (125->140).
4. **Tooltips unwanted**: User preferred no tooltip labels. Removed StationTooltip component entirely and cleaned up group class references.

## Task Commits

1. **Task 1: Page compositor rewrite** - `4bab18d` (feat)
2. **Fix: Unified container + clip-path removal** - `d7a5e1c` (fix)
3. **Fix: Contain-fit scaling + glow boost** - uncommitted (part of this session)
4. **Fix: Tooltip removal** - uncommitted (part of this session)

## Files Modified/Deleted

- `app/app/page.tsx` - Rewritten as scene compositor with FactoryBackground + 6 SceneStations + mobile fallback
- `app/components/scene/FactoryBackground.tsx` - Unified scene container with contain-fit min() sizing
- `app/components/scene/SceneStation.tsx` - Removed clip-path, tooltip references, group class; boosted glow values
- `app/components/scene/StationTooltip.tsx` - **DELETED** (user preference: tooltips removed)

## Deviations from Plan

1. **Safe zone container removed**: Plan specified a separate safe zone div inside FactoryBackground. Replaced with unified scene container where background and children share the same coordinate space directly -- simpler and eliminates the root cause of scaling mismatch.
2. **Clip-paths removed**: Plan relied on clip-path polygons from 55-01. Visual verification showed they cut off visible content; removed entirely.
3. **Tooltips removed**: Plan specified tooltip labels on hover. User found them unnecessary; StationTooltip component deleted.
4. **Cover -> Contain scaling**: Plan specified cover (background bleeds past safe zone, no letterboxing). Changed to contain (entire scene fits, letterbox/pillarbox with themed bars) to ensure all stations stay visible.

## Issues Encountered

All issues caught and resolved during human verification checkpoint -- none remained after 4 rounds of iteration.

## User Setup Required

None.

## Next Phase Readiness

- All 6 stations are clickable and wired to openModal -- ready for Phase 56 (station content)
- Scene container established for Phase 58 (ambient animations layer into same coordinate space)
- Mobile fallback in place for Phase 59 to replace with proper navigation

---
*Phase: 55-scene-layout-interactive-objects*
*Completed: 2026-02-23*
