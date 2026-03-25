# Phase 85: Launch Page & Mobile Polish - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Launch page receives final visual assets (gauge needle PNGs, updated curve overlay) and all station modals plus the launch page are made fully responsive on mobile. 5 requirements: LP-01, LP-02, LP-03 (deferred), LP-04, MOB-01.

</domain>

<decisions>
## Implementation Decisions

### Gauge Needle Assets (LP-01)
- Separate needle PNG asset overlaid on gauge face, CSS-rotated via existing PressureGauge rotation math (270-degree arc, -135 to +135 degrees)
- Smooth CSS transition animation on `transform: rotate()` when fill percentage changes
- User will provide a clean curve-overlay.png without baked-in needles — CSS-rotated needle PNG becomes the sole needle
- PressureGauge.tsx already has all the math; implementation adds Image element with rotation transform

### Updated Curve Overlay (LP-02)
- User provides a new curve-overlay.png with updated visual elements (replaces current 2.7MB baked-in version)
- New overlay will NOT have baked-in needles (clean gauge faces for CSS needle overlay)
- Drop-in replacement at `app/public/scene/launch/curve-overlay.png`

### Docs Button Position (LP-03)
- **DEFERRED** — user doesn't have the asset ready yet. Leave docs button at current position (bottom-left, 3%/3%). Will be addressed in a future phase when the new overlay design dictates placement.

### Cosmetic Fixes (LP-04)
- No predefined list — user will flag issues during execution while reviewing the live site
- Plan must be flexible for ad-hoc cosmetic adjustments as they're identified
- User-verified: each fix shown to user before moving on

### Asset Handoff (LP-01, LP-02)
- **First plan wave must be an interactive asset handoff step**: executor asks user where the asset files are and gets explanation of each asset (what it is, where to place it)
- Assets: needle PNG(s), clean curve-overlay.png
- No work starts until assets are received and placed

### Mobile Responsive Pass (MOB-01)
- First-time systematic review — station modals and launch page haven't been thoroughly tested on mobile
- **Two-pass approach**: (1) Code audit for common mobile issues (overflow, fixed positioning, min-height, tap targets, horizontal scroll), (2) User reviews live site on phone and flags remaining issues
- **Systematic**: go through each modal and the launch page one at a time, fix before moving to next
- Modals covered: Swap Station, Carnage Cauldron, Rewards Vat, Connect Wallet, Documentation Table, Settings, Launch Page
- Existing patterns: 1024px breakpoint, full-screen slide-up modals, 48px tap targets (Phase 58)

### Claude's Discretion
- Minimum viewport width target (375px vs 390px — pick what makes sense)
- Needle transition timing and easing curve
- Specific CSS fixes for mobile issues discovered during audit
- Optimization of new curve-overlay.png if needed (WebP conversion, compression)
- Order of modal review during mobile pass

</decisions>

<specifics>
## Specific Ideas

- PressureGauge.tsx already has complete rotation math (NEEDLE_MIN_DEG=-135, NEEDLE_MAX_DEG=135, linear interpolation) — just needs the image element and transform style
- LaunchScene.tsx uses contain-fit scaling with min() CSS — needle positioning must use percentage-based coordinates within the same container
- Launch page already has distinct desktop (`lg:block`) and mobile (`lg:hidden`) layouts — mobile issues are likely spacing/overflow, not missing layout
- Station modals built in Phase 58-63 with mobile in mind but never systematically tested on real devices

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/components/launch/PressureGauge.tsx`: Has needle rotation math, renders empty div — add Image + transform
- `app/components/launch/LaunchScene.tsx`: Contain-fit overlay container — needle must share this coordinate space
- `app/components/launch/BuySellPanel.tsx`: max-w-[380px] constraint — verify on small mobile viewports
- Station modal components (Swap, Carnage, Rewards, Wallet, Docs, Settings): Full-screen slide-up on mobile

### Established Patterns
- Percentage-based positioning within contain-fit scene container (LaunchScene)
- CSS media query at `lg:` (1024px) for mobile/desktop swap
- Next.js Image component for optimized image loading
- CSS-only animations (no npm deps) per project constraint

### Integration Points
- `app/public/scene/launch/curve-overlay.png`: Replace with clean overlay
- `app/public/scene/launch/needle.png` (new): Needle asset
- `app/components/launch/PressureGauge.tsx`: Primary modification target
- All station modal components: Mobile CSS audit targets
- `app/app/launch/page.tsx`: Mobile layout audit target

</code_context>

<deferred>
## Deferred Ideas

- LP-03 (docs button repositioning) — deferred until new overlay design dictates placement

</deferred>

---

*Phase: 85-launch-page-mobile-polish*
*Context gathered: 2026-03-08*
