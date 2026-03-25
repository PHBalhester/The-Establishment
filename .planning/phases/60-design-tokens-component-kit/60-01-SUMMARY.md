---
phase: 60-design-tokens-component-kit
plan: 01
subsystem: ui
tags: [photoshop, assets, webp, 9-slice, border-image, steampunk, component-kit]

# Dependency graph
requires:
  - phase: none
    provides: First plan of v1.1 milestone
provides:
  - Complete Photoshop asset catalog (33 assets across phases 60-68)
  - Color palette reference with hex values matching CSS tokens
  - 9-slice anatomy diagrams with slice values per frame variant
  - WebP export settings and directory structure
  - Asset naming convention aligned with CSS border-image references
affects: [60-02, 60-03, 60-04, 60-05, 60-06, 61, 62, 63, 64, 65, 66]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Asset naming: {component}-{variant}[-{state}].webp"
    - "Frame naming exception: {variant}-paper.webp for 9-slice frames"
    - "2x resolution for retina (600x600 Photoshop = 300x300 CSS)"
    - "WebP lossy 90 + lossless alpha for transparent frame borders"

key-files:
  created:
    - "Docs/v1.1-asset-spec.md"
  modified: []

key-decisions:
  - "33 total assets across 9 phases (19 kit + 14 phase-specific)"
  - "Frame names use variant-paper.webp pattern matching 60-RESEARCH.md CSS references"
  - "3 button variants (primary/secondary/ghost) based on codebase usage analysis"
  - "Interactive components: exactly 2 assets (Normal + Active); hover/disabled via CSS-only"
  - "Gauge component (3 assets: frame + fill arc + needle) for Phase 63 meters"
  - "Chart frame uses dark center fill (not parchment) for TradingView integration"

patterns-established:
  - "State strategy: Normal + Active as assets; Hover/Disabled/Focus as CSS-only"
  - "Directory split: public/frames/ for 9-slice, public/kit/ for component assets"
  - "All assets at 2x native resolution for retina display support"

# Metrics
duration: 7min
completed: 2026-02-25
---

# Phase 60 Plan 01: v1.1 Asset Specification Summary

**33-asset Photoshop catalog covering all v1.1 phases (60-68) with native sizes, 9-slice diagrams, state variants, color palette, and creation notes referencing three AI-generated inspiration images**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-25T17:53:28Z
- **Completed:** 2026-02-25T18:01:14Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created comprehensive 1,090-line asset specification document at `Docs/v1.1-asset-spec.md`
- Cataloged 33 Photoshop assets across 9 phases with complete creation guidance
- Analyzed current codebase usage (.brass-button, .big-red-button, .lever-tab, .brass-input, .modal-close-btn) to determine the correct button variants and component states
- Aligned asset naming convention with 60-RESEARCH.md CSS border-image references (ornate-paper.webp, riveted-paper.webp)

## Task Commits

Each task was committed atomically:

1. **Task 1: Analyze current app usage to determine asset needs** - `f7a2727` (feat)

## Files Created/Modified

- `Docs/v1.1-asset-spec.md` - Complete v1.1 Photoshop asset catalog (1,090 lines) with 33 assets, color palette, 9-slice diagrams, WebP export settings, and directory structure

## Decisions Made

1. **3 button variants (primary/secondary/ghost):** Based on analyzing `.brass-button` usage in ConnectModal (2 types: prominent CTA + subtle option), WalletButton, StakeTab/UnstakeTab (MAX), SwapForm, and SlippageConfig (toggle presets). Primary maps to CTA/action buttons, secondary to utility/settings, ghost to toggle-group presets.

2. **Chart frame with dark center fill:** TradingView charts render on a dark canvas. A parchment center fill would create a jarring visual contrast. The chart frame uses dark metal center (`#0d0907`) so the chart blends naturally.

3. **Gauge as 3-part composite (frame + fill + needle):** Rather than one static gauge image per value, splitting into 3 layers lets CSS dynamically rotate the needle and clip the fill arc for any percentage. One set of assets serves all gauge instances.

4. **Frame naming uses variant-paper convention:** The 60-RESEARCH.md CSS examples reference `ornate-paper.webp` and `riveted-paper.webp`. Changing this to `frame-ornate.webp` would require updating all CSS references. Aligned the spec with the established convention.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Asset spec complete -- user can begin Photoshop work at any time
- Plan 60-02 (design tokens + kit.css) can proceed in parallel (Wave 1)
- Plan 60-03 (user asset creation checkpoint) blocked until both 60-01 and 60-02 complete
- All 33 assets have sufficient detail for batch creation without clarifying questions

---
*Phase: 60-design-tokens-component-kit*
*Completed: 2026-02-25*
