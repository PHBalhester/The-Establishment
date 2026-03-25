---
phase: 53-asset-pipeline-brand-foundation
plan: 01
subsystem: ui
tags: [sharp, webp, image-optimization, next-image, blur-placeholder, scene-assets]

# Dependency graph
requires:
  - phase: none
    provides: First plan of v1.0 milestone; builds on existing WebsiteAssets/ PNGs
provides:
  - Optimized WebP scene images (background + 5 overlays) in app/public/scene/
  - SCENE_DATA metadata module (blur data URLs, percentage positions, dimensions)
  - Next.js Image optimization config (qualities, formats, deviceSizes)
  - Build script for re-processing images when source assets change
affects: [53-02 (theme tokens reference scene structure), 53-03 (scene components consume SCENE_DATA), 55 (scene layout uses position metadata)]

# Tech tracking
tech-stack:
  added: []
  patterns: [build-time image optimization with sharp, percentage-based overlay positioning from trim offsets, auto-generated TypeScript metadata from build scripts]

key-files:
  created:
    - scripts/optimize-images.mjs
    - app/lib/image-data.ts
    - app/public/scene/background/factory-bg-1920.webp
    - app/public/scene/background/factory-bg-2560.webp
    - app/public/scene/background/factory-bg-3840.webp
    - app/public/scene/overlays/carnage-cauldron.webp
    - app/public/scene/overlays/connect-wallet.webp
    - app/public/scene/overlays/documentation-table.webp
    - app/public/scene/overlays/rewards-vat.webp
    - app/public/scene/overlays/settings.webp
  modified:
    - app/next.config.ts

key-decisions:
  - "sharp trim offsets are negative (pixels removed from edge) -- use Math.abs() for actual content position"
  - "Background quality 80, overlay quality 82 -- slightly higher for overlays since detail matters more at smaller sizes"
  - "Blur placeholder: 20px for background (captures scene composition), 10px for overlays (smaller source images)"
  - "Swap station placeholder: metadata entry with available:false, no placeholder image file"

patterns-established:
  - "Build script generates TypeScript: optimize-images.mjs writes image-data.ts with exact types"
  - "Percentage-based positioning: all overlay positions stored as % of 5568x3072 scene for responsive scaling"
  - "Scene asset convention: app/public/scene/{background,overlays}/*.webp"

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 53 Plan 01: Image Optimization Pipeline Summary

**19.5MB PNG scene assets transformed to 1.3MB optimized WebP with blur placeholders and percentage-based position metadata via sharp build script**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T20:48:36Z
- **Completed:** 2026-02-22T20:52:10Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Built reusable image optimization script (optimize-images.mjs) that crops overlays to bounding boxes, converts to WebP, and generates blur placeholders -- 93% size reduction (19.5MB to 1.3MB)
- Background: 3 responsive variants (1920w=185KB, 2560w=261KB, 3840w=406KB) from 12.9MB source
- Overlays: 5 cropped WebP files totaling ~510KB from 7.8MB of full-scene PNGs
- Auto-generated image-data.ts with TypeScript types (BackgroundData, OverlayData, SceneData), blur data URLs, and precise percentage-based position metadata derived from sharp trim offsets
- Swap station placeholder entry in metadata (available: false) for when the asset arrives
- Next.js 16 image optimization config with qualities whitelist [75, 80, 82, 85] and device sizes matching scene breakpoints

## Task Commits

Each task was committed atomically:

1. **Task 1: Build image optimization script and run it** - `419a62b` (feat)
2. **Task 2: Update next.config.ts with image optimization settings** - `65195e6` (feat)

## Files Created/Modified
- `scripts/optimize-images.mjs` - Build script: crop, convert, blur generation, metadata output
- `app/lib/image-data.ts` - SCENE_DATA export with types, blur URLs, positions (auto-generated)
- `app/public/scene/background/factory-bg-1920.webp` - 1920w background variant (185KB)
- `app/public/scene/background/factory-bg-2560.webp` - 2560w background variant (261KB)
- `app/public/scene/background/factory-bg-3840.webp` - 3840w background variant (406KB)
- `app/public/scene/overlays/carnage-cauldron.webp` - Cropped cauldron overlay (59KB)
- `app/public/scene/overlays/connect-wallet.webp` - Cropped wallet overlay (120KB)
- `app/public/scene/overlays/documentation-table.webp` - Cropped docs table overlay (137KB)
- `app/public/scene/overlays/rewards-vat.webp` - Cropped rewards vat overlay (114KB)
- `app/public/scene/overlays/settings.webp` - Cropped settings overlay (81KB)
- `app/next.config.ts` - Added images config block (qualities, formats, deviceSizes)

## Decisions Made
- **Sharp trim offset sign convention:** trim() returns negative offsets representing pixels removed from left/top edges. Used Math.abs() to convert to actual content position within the scene. Discovered during first script run when positions showed negative percentages.
- **Quality levels:** Background at quality 80 (large area, compression matters), overlays at 82 (detail matters more at smaller cropped sizes). Both well within the plan's size targets.
- **Blur placeholder sizing:** 20px wide for background (needs to capture overall scene layout), 10px wide for overlays (smaller objects, less detail needed for the blur effect).
- **No swap station placeholder image:** Only a metadata entry with `available: false` -- no fake image file. The script simply skips it. When the SwapMachine asset arrives, re-running the script with it added to the OVERLAYS array will generate the WebP and update metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed negative trim offset values producing incorrect position percentages**
- **Found during:** Task 1 (first script run)
- **Issue:** sharp's trim() returns trimOffsetLeft/Top as negative numbers (pixels removed from edge), not positive positions. Initial code passed them through directly, producing negative percentage positions (e.g., left=-73.69% instead of left=73.69%).
- **Fix:** Added Math.abs() wrapper around trim offset values before percentage calculation, with explanatory comment about the sign convention.
- **Files modified:** scripts/optimize-images.mjs
- **Verification:** Re-ran script; all positions now in 0-100% range matching visual inspection
- **Committed in:** 419a62b (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for correct overlay positioning. No scope creep.

## Issues Encountered
None -- all source assets present and processed successfully.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All optimized scene images ready in `app/public/scene/` for consumption by Phase 53-02 (theme tokens) and 53-03 (scene components)
- SCENE_DATA module at `app/lib/image-data.ts` ready for import by FactoryBackground and FactoryOverlay components
- Next.js image optimization configured and ready for Image component usage
- Swap station metadata placeholder ready -- when asset arrives, re-run `node scripts/optimize-images.mjs` after adding the source PNG to WebsiteAssets/

---
*Phase: 53-asset-pipeline-brand-foundation*
*Completed: 2026-02-22*
