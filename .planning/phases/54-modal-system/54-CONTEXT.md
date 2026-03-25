# Phase 54: Modal System - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a reusable, accessible modal system that all 6 factory stations plug into -- themed steampunk chrome, iris-open animation from click origin, focus management, and single-modal policy. This phase delivers the modal infrastructure only; station content is Phase 56, scene objects are Phase 55.

</domain>

<decisions>
## Implementation Decisions

### Modal Chrome & Visual Style
- Full Victorian machine aesthetic -- ornate brass frame with decorative corners, visible bolts/rivets along edges, gear motifs in the border
- Layered surface: dark metal outer frame surrounding a lighter aged-paper content area -- industrial border containing readable documents
- Backdrop: light dim (~40% opacity) + subtle blur (4-8px) -- factory scene remains somewhat visible, atmosphere stays present
- CSS-only implementation first (gradients, box-shadows, borders, pseudo-elements) -- component architecture makes swapping to image-based frame assets a single-component change later
- Possible future: actual image assets for frame chrome -- architecture should not preclude this

### Transition Choreography
- **Open**: Iris/aperture reveal using CSS `clip-path: circle()` animation expanding from the clicked scene object's position -- like a porthole opening
- **Close**: Fade out + slight scale down (simpler than reverse iris, doesn't need to track origin)
- **Station switch**: Quick crossfade (~300ms) between modals -- current fades out while new fades in simultaneously, no scene flash
- **Click feedback**: Brief physical press depression (~95% scale for 100-150ms) on scene object before iris animation begins -- feels like pressing a machine lever

### Modal Sizing & Positioning
- Per-station sizing -- each station specifies its own optimal width (e.g., Swap ~1100px with chart, Settings ~500px)
- Modal component accepts a size/width prop from each station
- Vertically centered in viewport
- Internal scroll with fixed header when content exceeds modal height (max-height ~85vh)
- Minimum width ~400px on desktop; below 1024px viewport, Phase 59 mobile navigation takes over with full-screen panels

### Header & Close Button Design
- Header contains station name only (e.g., "Swap Machine", "Carnage Cauldron") -- no icons or subtitles
- Header background matches the paper content area (not the metal frame) -- station name in dark text on light surface
- Close button: brass circular button with X/cross, Victorian shut-valve appearance, beveled/raised, positioned top-right
- Brass rule line divider (1-2px with slight bevel) separating fixed header from scrollable body -- like a metal seam between plates

### Claude's Discretion
- Exact CSS technique for iris clip-path animation (performance tuning, easing curves)
- Specific brass/gold color values and texture gradients (within Phase 53 theme token system)
- Focus trap implementation approach (custom vs native `inert` attribute)
- Exact timing values within the specified ranges (200-300ms open, 150-200ms close per success criteria)
- Rivet/bolt decoration density and placement on the frame
- Scrollbar styling within the modal body

</decisions>

<specifics>
## Specific Ideas

- Iris animation should originate from the exact position of the clicked scene object -- creates a spatial connection between the factory and the modal
- The physical press feedback (100-150ms depression) before the iris open is important -- it sells the "operating machinery" metaphor
- The crossfade for station switching should feel seamless -- user shouldn't feel like they're "leaving and re-entering"
- Metal frame + paper content layering creates natural visual hierarchy: heavy industrial border says "this is a machine interface", lighter paper interior says "here's the readable content"

</specifics>

<deferred>
## Deferred Ideas

- Image-based frame assets (actual brass/rivet PNG/SVG assets for modal chrome) -- may be created by a designer later, architecture should support the swap
- No other scope creep noted -- discussion stayed within phase scope

</deferred>

---

*Phase: 54-modal-system*
*Context gathered: 2026-02-22*
