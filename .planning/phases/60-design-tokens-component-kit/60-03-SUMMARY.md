---
phase: 60-design-tokens-component-kit
plan: 03
subsystem: ui
tags: [photoshop, assets, frame, border-image, 9-slice, png]

requires:
  - phase: 60-01
    provides: "Asset specification document guiding Photoshop creation"
  - phase: 60-02
    provides: "kit.css with .kit-frame-asset class referencing frame assets"
provides:
  - "riveted-paper.png frame asset in app/public/frames/"
  - "kit.css updated to reference actual PNG asset"
affects: [60-04, 60-05, 60-06]

tech-stack:
  added: []
  patterns: ["Single frame variant for UI cohesion"]

key-files:
  created:
    - app/public/frames/riveted-paper.png
  modified:
    - app/app/kit.css

key-decisions:
  - "Single frame type (riveted-paper) instead of two variants -- keeps UI cohesive"
  - "PNG format instead of WebP -- Photoshop export limitation, functionally identical for border-image"
  - "No active/pressed state for frames -- frames are passive containers, not interactive elements"
  - "No ornate-paper variant -- one frame type is sufficient"

patterns-established:
  - "Frame assets are PNG in public/frames/, referenced via border-image-source"

duration: 1min
completed: 2026-02-26
---

# Phase 60 Plan 03: User Creates Frame Assets Summary

**Single riveted-paper PNG frame asset created in Photoshop, kit.css updated to reference actual asset**

## Performance

- **Duration:** 1 min (user Photoshop work + orchestrator updates)
- **Started:** 2026-02-26T12:05:00Z
- **Completed:** 2026-02-26T12:10:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- User created riveted-paper.png frame asset (270KB) with brass riveted border and parchment center
- kit.css .kit-frame-asset updated from placeholder ornate-paper.webp to actual riveted-paper.png
- Removed unnecessary active/pressed state for frames (passive containers)
- Simplified from 4 planned assets to 1 actual asset

## Task Commits

1. **Task 1: Create frame assets + update kit.css** - `768725a` (feat)

**Plan metadata:** (included in task commit)

## Files Created/Modified
- `app/public/frames/riveted-paper.png` - Brass riveted frame with parchment center, 9-slice ready
- `app/app/kit.css` - Updated .kit-frame-asset source URL and comments

## Decisions Made
1. Single frame type (riveted-paper only) -- user decided one cohesive frame type is sufficient
2. PNG format -- user's Photoshop lacks WebP export, PNG is functionally identical for border-image
3. No active/pressed states on frames -- frames are passive containers, interaction feedback belongs on child elements
4. No ornate variant -- simplifies the visual language

## Deviations from Plan

### User-Directed Changes

**1. Reduced from 4 assets to 1**
- **Plan specified:** 4 WebP files (ornate-paper, ornate-paper-active, riveted-paper, riveted-paper-active)
- **Actual:** 1 PNG file (riveted-paper.png)
- **Rationale:** User decided one frame type is sufficient for UI cohesion; active states don't apply to passive containers; PNG format due to Photoshop export limitations

**Total deviations:** 1 user-directed scope simplification
**Impact on plan:** Positive -- simpler, more cohesive UI with fewer assets to maintain

## Issues Encountered
None

## Next Phase Readiness
- Frame asset ready for Plan 60-04 (structural components) to use in Frame component
- CSS-only fallback (.kit-frame-css) remains available for rounded-corner contexts
- Single frame variant simplifies the Frame component API

---
*Phase: 60-design-tokens-component-kit*
*Completed: 2026-02-26*
