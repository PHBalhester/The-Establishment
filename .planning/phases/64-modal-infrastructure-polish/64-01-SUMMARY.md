---
phase: 64-modal-infrastructure-polish
plan: 01
subsystem: ui
tags: css, animation, modal, overscroll, close-button, steampunk

# Dependency graph
requires:
  - phase: 63-station-polish
    provides: kit-frame modals on 4/6 stations
  - phase: 60-design-tokens-component-kit
    provides: kit components, design tokens, frame system
provides:
  - Photoshop asset-based brass valve close button on all modals
  - Valve rotation hover/click CSS animations
  - Modal overscroll containment (scroll-chaining prevention)
affects:
  - 65-settings-station (will inherit close button + overscroll)
  - 66-documentation-migration (docs modal gets close button)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Asset-based interactive elements: plain img tag over next/image for tiny assets (<2KB)"
    - "drop-shadow() over box-shadow for alpha-aware glow on PNG assets"
    - "Transform stacking: always combine translateY(-50%) + rotate() to preserve centering"

key-files:
  created:
    - app/public/buttons/exit-button.png
  modified:
    - app/components/modal/ModalCloseButton.tsx
    - app/app/globals.css

key-decisions:
  - "Plain img tag over next/image for tiny asset — optimization overhead not justified for <2KB PNG"
  - "drop-shadow() filter over box-shadow for hover glow — respects PNG alpha channel"
  - "Transform stacking preserved (translateY + rotate) — prevents 16px centering jump"
  - "No will-change: transform added — avoids compositor layer conflict with iris-open clip-path animation"

patterns-established:
  - "Asset-based buttons: transparent background, border:none, img child with display:block"
  - "Hover micro-animations: subtle rotation (20deg) + glow at 200ms ease"
  - "Active snap: faster transition-duration (80ms) for responsive click feel"

# Metrics
duration: 7min
completed: 2026-02-27
---

# Phase 64 Plan 01: Brass Valve Close Button Summary

**Brass valve close button asset with rotation hover/click animations + modal overscroll containment**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-02-27T21:18:00Z
- **Completed:** 2026-02-27T21:25:34Z
- **Tasks:** 2 (1 auto + 1 visual checkpoint)
- **Files modified:** 3

## Accomplishments
- Replaced CSS-drawn gradient circle + SVG X close button with Photoshop-designed brass valve PNG asset across all modals
- Added clockwise valve rotation on hover (20deg) with brass drop-shadow glow, and snap rotation on click (45deg at 80ms)
- Applied overscroll-behavior: contain to .modal-body preventing scroll-through to page content
- Preserved all existing behavior: iris-open animation, mobile hide rule, focus-visible glow ring, kit-frame/classic-header positioning

## Task Commits

Each task was committed atomically:

1. **Task 1: Copy asset + replace ModalCloseButton + update CSS** - `4842704` (feat)
2. **Task 2: Visual verification checkpoint** - N/A (human-verify, approved by user)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified
- `app/public/buttons/exit-button.png` - 64x64 RGBA PNG close button asset at 2x retina (copied from WebsiteAssets/ExitButton.png)
- `app/components/modal/ModalCloseButton.tsx` - Asset-based close button component using img tag instead of SVG
- `app/app/globals.css` - Valve rotation hover/active CSS, overscroll-behavior: contain on .modal-body

## Decisions Made
- **Plain img over next/image:** Asset is <2KB, Image component optimization overhead not justified. Plain img is simpler and equally performant.
- **drop-shadow over box-shadow:** box-shadow renders around the element's bounding box, producing a square glow on a round PNG. drop-shadow() respects the alpha channel for accurate glow shape.
- **Transform stacking:** Base rule uses translateY(-50%) for vertical centering. All hover/active states combine translateY(-50%) + rotate(Xdeg). Setting only rotate() would remove the centering offset and cause a 16px visual jump.
- **No will-change: transform:** Compositor layers from will-change can conflict with the iris-open clip-path animation on the dialog element. The rotation is simple enough for automatic browser optimization.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## User Feedback

User noted that mobile layout needs general attention across the project. This is not specific to Phase 64 and has been logged as a future consideration (potentially an extra phase at the end of the milestone).

## Next Phase Readiness
- All modals now have the brass valve close button and overscroll containment
- Phase 64 is complete (1 plan)
- Ready for Phase 65 (Settings Station + Audio Controls UI)
- Mobile layout improvement identified as future work (not blocking)

---
*Phase: 64-modal-infrastructure-polish*
*Completed: 2026-02-27*
