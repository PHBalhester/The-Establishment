---
phase: 75-launch-page
plan: 03
subsystem: ui
tags: [bonding-curve, launch-page, pressure-gauge, countdown, steampunk, next-image, css-animation]

# Dependency graph
requires:
  - phase: 75-launch-page
    provides: useCurveState hook, curve-math, curve-constants, error-map (Plan 01)
provides:
  - /launch route with full-bleed immersive page
  - LaunchScene component (blurred factory bg + CurveOverlay.png centered overlay)
  - PressureGauge with CSS needle rotation driven by solRaised / 1000 SOL
  - CountdownTimer with slot-based ~Xh Ym countdown
  - CurveStats displaying SOL raised, market cap, spot price, tax escrow per curve
  - LaunchWalletButton (floating fixed-position wallet connect)
  - DocsModal (iframe overlay to Nextra documentation)
affects: [75-04, 75-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [blurred-background-overlay-pattern, percentage-based-overlay-positioning, CSS-needle-rotation]

key-files:
  created:
    - app/app/launch/page.tsx
    - app/components/launch/LaunchScene.tsx
    - app/components/launch/PressureGauge.tsx
    - app/components/launch/CountdownTimer.tsx
    - app/components/launch/CurveStats.tsx
    - app/components/launch/LaunchWalletButton.tsx
    - app/components/launch/DocsModal.tsx
    - app/public/scene/launch/curve-overlay.png
  modified: []

key-decisions:
  - "Blurred factory background + CurveOverlay.png overlay (not standalone background image)"
  - "Contain-fit scaling at 1.78:1 ratio for overlay positioning (matches 2560x1440 asset)"
  - "Spot price displayed as lamports/human_token / 1e9 (not divided by TOKEN_DECIMAL_FACTOR)"
  - "Desktop/mobile split at lg (1024px) -- desktop uses positioned overlays, mobile uses stacked layout"

patterns-established:
  - "Blurred background overlay: factory image + backdrop-blur-md + bg-black/40, then content overlay on top"
  - "Percentage-based positioning on contain-fit scaled image: children share coordinate space with overlay"
  - "CSS needle rotation: transform-origin at bottom center, cubic-bezier transition for smooth animation"

requirements-completed: [PAGE-01, PAGE-02, PAGE-04, PAGE-05, PAGE-06, PAGE-08]

# Metrics
duration: 23min
completed: 2026-03-07
---

# Phase 75 Plan 03: Launch Page Shell Summary

**Full-bleed /launch page with blurred factory background, CurveOverlay.png brass machine, CSS pressure gauges, slot countdown, curve stats, wallet button, and docs modal**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-03-07T10:22:03Z
- **Completed:** 2026-03-07T10:45:08Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built /launch route as full-viewport immersive page with no header/nav chrome
- LaunchScene uses existing factory background with CSS blur overlay + CurveOverlay.png centered brass machine
- PressureGauge components overlay gauge locations with CSS needle rotation (270-degree arc sweep)
- CountdownTimer converts deadlineSlot - currentSlot to ~Xh Ym format with EXPIRED state
- CurveStats shows SOL raised, market cap (USD), spot price, and tax escrow per curve
- Mobile responsive: stacked vertical layout below 1024px with blurred background

## Task Commits

Each task was committed atomically:

1. **Task 1: Launch page route + scene layout + pressure gauges** - `71bcd5f` (feat)
2. **Task 2: Countdown timer, curve stats, wallet button, docs modal** - `385d1a3` (feat)

## Files Created/Modified
- `app/app/launch/page.tsx` - /launch route entry point with desktop/mobile layouts
- `app/components/launch/LaunchScene.tsx` - Blurred factory bg + CurveOverlay.png contain-fit overlay
- `app/components/launch/PressureGauge.tsx` - CSS needle rotation driven by solRaised / TARGET_SOL
- `app/components/launch/CountdownTimer.tsx` - Slot-based countdown in ~Xh Ym format
- `app/components/launch/CurveStats.tsx` - SOL raised, market cap, spot price, tax escrow per curve
- `app/components/launch/LaunchWalletButton.tsx` - Floating wallet connect button (fixed position)
- `app/components/launch/DocsModal.tsx` - Docs button + iframe modal to Nextra documentation
- `app/public/scene/launch/curve-overlay.png` - CurveOverlay brass machine asset (2560x1440)

## Decisions Made
- **Blurred factory background pattern**: Used existing factory scene background with backdrop-blur-md + bg-black/40 overlay, then CurveOverlay.png as centered content on top. This matches the project's existing modal pattern (blurred bg + content) per the user's updated design direction.
- **Contain-fit 1.78:1 ratio**: CurveOverlay.png is 2560x1440 (16:9). Using min(100vw, calc(100vh * 1.78)) for width and the inverse for height ensures the overlay fits within the viewport at any size, with letterbox/pillarbox filled by the blurred background.
- **Spot price = lamports/human_token / 1e9**: getCurrentPrice() returns lamports per human token. Dividing by 1e9 converts to SOL/token. The TOKEN_DECIMAL_FACTOR is already accounted for in the on-chain math and is NOT needed in this conversion.
- **Separate desktop/mobile layouts**: Desktop uses absolute-positioned overlays on the brass machine image. Mobile uses a stacked vertical layout since the overlay image would be too small to read on narrow screens.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed spot price conversion in CurveStats**
- **Found during:** Task 2 (CurveStats implementation)
- **Issue:** Initial code divided spot price by both TOKEN_DECIMAL_FACTOR and 1e9, but getCurrentPrice already returns lamports/human_token (not lamports/base_unit). Double-dividing would show prices 1e6 too low.
- **Fix:** Removed TOKEN_DECIMAL_FACTOR division, only divide by 1e9 for lamports-to-SOL
- **Files modified:** app/components/launch/CurveStats.tsx
- **Verification:** At tokensSold=0, getCurrentPrice returns 900n (lamports), 900/1e9 = 0.0000009 SOL/token -- correct
- **Committed in:** 385d1a3 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Spot price would have displayed incorrectly without the fix. No scope creep.

## Issues Encountered
- Pre-existing TypeScript error in lib/staking/staking-builders.ts (references removed systemProgram account). Not related to this plan, does not affect launch page code. Listed as existing deferred item.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Launch page shell complete: /launch renders full-bleed scene with all overlay components
- Ready for Plan 04 (buy/sell panel) to be composed into the dark center panel area of the brass machine
- Ready for Plan 05 (state machine UI) to add conditional rendering based on curve status
- CurveOverlay.png gauge needles are currently baked into the image -- when separate needle assets are provided, PressureGauge will switch from CSS needle to Image-based needle

---
*Phase: 75-launch-page*
*Completed: 2026-03-07*
