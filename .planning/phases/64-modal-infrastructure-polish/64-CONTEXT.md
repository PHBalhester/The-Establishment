# Phase 64: Modal Infrastructure Polish - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Cross-cutting improvements that elevate ALL modals uniformly. Originally scoped as 6 items; discussion narrowed to 2 real deliverables plus a one-liner fix. The phase is smaller than originally estimated — most proposed features were either unnecessary (nothing loads slow enough for skeletons), already handled (iris animation is sufficient), or lacking enough scroll content to justify custom scrollbars.

</domain>

<decisions>
## Implementation Decisions

### Close button
- Replace current CSS-only brass circle with a Photoshop asset (`ExitButton.png` in Website assets folder)
- Same position as current button: floats outside top-right corner of kit-frame on desktop, hidden on mobile (back arrow stays)
- Current rendered size: 32x32px. Asset should be prepared at 2x (64x64px) for retina
- Hover animation: subtle clockwise rotation (like turning a valve) + brass glow
- Click animation: quick snap rotation
- Applies to ALL modals uniformly via ModalCloseButton component
- Keep existing `aria-label="Close"` and focus-visible glow ring

### Overscroll containment
- Apply `overscroll-behavior: contain` on all modal content areas
- Prevents page scrolling behind the modal — one-liner CSS fix, no visual component

### Loading skeleton — DROPPED
- User decision: nothing loads slow enough to warrant a skeleton
- Gear-spinning idea removed from scope entirely (not deferred)

### Custom scrollbar — DROPPED
- User decision: not enough scrollable content in current modals to justify
- May revisit after docs migration (Phase 66) if docs station has long scroll areas

### Content transitions — NOT NEEDED
- Existing iris-open clip-path animation is sufficient for modal open
- No close animation — instant close is correct (user wants it gone immediately)
- No station-to-station transitions — users must return to scene between stations

### Claude's Discretion
- Exact CSS rotation degrees for hover/click animations
- Whether to add a subtle scale effect alongside the rotation
- Transition timing/easing curves for the close button hover state

</decisions>

<specifics>
## Specific Ideas

- Close button asset: `ExitButton.png` already created by user, located in "Website assets" folder
- The close button component is `ModalCloseButton.tsx` — single file change + CSS update
- Current CSS is in `globals.css` lines 533-573 (`.modal-close-btn` rules)
- Kit-frame modals position the close button at `top: -20px; right: -36px` (floating outside frame)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Items dropped from this phase (skeleton, scrollbar) were intentionally removed, not deferred.

</deferred>

---

*Phase: 64-modal-infrastructure-polish*
*Context gathered: 2026-02-27*
