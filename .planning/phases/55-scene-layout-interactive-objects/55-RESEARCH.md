# Phase 55: Scene Layout + Interactive Objects - Research

**Researched:** 2026-02-22
**Domain:** CSS interactive scene composition, accessible navigation, Tailwind v4 utilities
**Confidence:** HIGH

## Summary

This phase assembles the steampunk factory scene as a full-viewport interactive experience. The core work is wiring interactivity (hover glow, click feedback, tooltips, keyboard navigation, modal opening) onto the existing FactoryBackground and FactoryOverlay components from Phase 53, using the ModalProvider/useModal system from Phase 54.

The standard approach is entirely CSS-driven (zero new dependencies, as decided). Tailwind v4.1.18 provides all needed utility classes for filters, transitions, scales, and state variants (`hover:`, `active:`, `focus-visible:`). The only meaningful technical challenge is the "visible pixels only" click area requirement -- CSS `pointer-events: visiblePainted` does NOT work for HTML elements (SVG-only), so a `clip-path: polygon()` approach is needed.

**Primary recommendation:** Build a `SceneStation` button component that wraps FactoryOverlay, adds hover/active/focus states via Tailwind utilities, renders a tooltip child, and calls `openModal()` on click. The main page.tsx becomes the scene compositor that renders FactoryBackground with 6 SceneStation children in explicit tab order.

## Standard Stack

### Core (already installed -- zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | Framework, Image component for overlays | Already in use |
| React | 19.2.3 | Component model, hooks | Already in use |
| Tailwind CSS | 4.1.18 | All styling, hover/active/focus states | Already in use |

### Supporting (existing project infrastructure)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next/image | (bundled) | Optimized overlay image rendering | FactoryOverlay already uses it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tailwind utilities for glow | Raw CSS in globals.css | Tailwind preferred for consistency; only use globals.css if filter stacking gets too complex for inline classes |
| clip-path polygon for click areas | Canvas-based alpha hit testing | clip-path is CSS-only, no JS overhead; canvas approach is pixel-perfect but requires runtime computation |
| CSS tooltip (pseudo-element) | Floating UI / Tippy.js library | No new deps rule; CSS tooltip is sufficient for static label positioning |

**Installation:** None required -- zero new dependencies.

## Architecture Patterns

### Recommended Project Structure

```
app/
  components/
    scene/
      FactoryBackground.tsx      # EXISTS (Phase 53) -- no changes needed
      FactoryOverlay.tsx          # EXISTS (Phase 53) -- needs modification for button semantics
      LoadingSpinner.tsx          # EXISTS (Phase 53) -- no changes needed
      SceneStation.tsx            # NEW -- interactive button wrapper for overlays
      StationTooltip.tsx          # NEW -- tooltip label component
      SwapPlaceholder.tsx         # NEW -- CSS-only placeholder for swap-station
      scene-data.ts              # NEW -- station metadata (labels, tab order, clip-paths, station IDs)
  lib/
    image-data.ts                # EXISTS -- SCENE_DATA coordinates (read-only)
  app/
    page.tsx                     # MODIFY -- replace dashboard with scene compositor
    globals.css                  # MODIFY -- add scene-specific keyframes/styles if needed
```

### Pattern 1: SceneStation Button Component

**What:** A `<button>` element that wraps the overlay image and provides all interactivity (hover glow, click feedback, tooltip, focus indicator, modal opening).

**When to use:** For each of the 6 interactive factory stations.

**Why `<button>` not `<div>` with onClick:** Native `<button>` gives free keyboard activation (Enter/Space), ARIA role, and focus management. This satisfies A11Y-01 directly.

**Example:**
```tsx
// Source: Verified against Tailwind v4.1.18 docs + MDN
interface SceneStationProps {
  overlayId: string;        // Key into SCENE_DATA.overlays
  stationId: StationId;     // Key for useModal().openModal()
  label: string;            // Tooltip text
  clipPath?: string;        // polygon() for visible-pixels-only click area
}

function SceneStation({ overlayId, stationId, label, clipPath }: SceneStationProps) {
  const { openModal } = useModal();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openModal(stationId, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="absolute z-overlays cursor-pointer
        transition-[filter,transform] duration-150 ease-out
        hover:drop-shadow-[0_0_20px_rgba(212,160,74,0.7)] hover:brightness-125
        focus-visible:drop-shadow-[0_0_20px_rgba(212,160,74,0.7)] focus-visible:brightness-125
        focus-visible:outline-none
        active:scale-95 active:duration-100"
      style={{
        left: `${overlay.left}%`,
        top: `${overlay.top}%`,
        width: `${overlay.widthPct}%`,
        height: `${overlay.heightPct}%`,
        clipPath: clipPath,  // Restricts click area to visible pixels
      }}
    >
      {/* Overlay image inside button */}
      <Image ... />
      {/* Tooltip label (shown on hover/focus via group) */}
      <StationTooltip label={label} />
    </button>
  );
}
```

### Pattern 2: Overlay ID to Station ID Mapping

**What:** SCENE_DATA overlay keys (kebab-case asset names) must map to ModalProvider StationId values. These are different naming conventions that must be bridged.

**Critical mapping:**

| SCENE_DATA overlay key | StationId | Tooltip Label |
|------------------------|-----------|---------------|
| `connect-wallet` | `wallet` | Connect Wallet |
| `swap-station` | `swap` | Swap Machine |
| `carnage-cauldron` | `carnage` | Carnage Cauldron |
| `rewards-vat` | `staking` | Rewards Vat |
| `documentation-table` | `docs` | Documentation Table |
| `settings` | `settings` | Settings |

**Tab order (from CONTEXT.md):** Connect Wallet -> Swap Machine -> Carnage Cauldron -> Rewards Vat -> Documentation Table -> Settings

This mapping should live in a dedicated `scene-data.ts` metadata module that the scene compositor imports, keeping the mapping explicit and centralized.

### Pattern 3: Cover with Safe Zone Scaling

**What:** Background image fills viewport (cover mode), while interactive overlays live within an inner safe area that prevents clipping at extreme aspect ratios.

**Implementation approach:**
```tsx
// Background: fills entire viewport with cover
<div className="relative w-full h-screen overflow-hidden">
  <Image src={bg} fill className="object-cover" />

  {/* Safe zone: aspect-ratio container centered within viewport */}
  <div className="absolute inset-0 flex items-center justify-center">
    <div
      className="relative w-full h-full"
      style={{ maxWidth: 'calc(100vh * 1.81)', maxHeight: 'calc(100vw / 1.81)' }}
    >
      {/* Overlays positioned inside safe zone using % coordinates */}
    </div>
  </div>
</div>
```

The safe zone maintains the 1.81:1 aspect ratio (5568/3072) of the original scene. On wide monitors, it constrains width; on tall monitors, it constrains height. The background bleeds beyond the safe zone (cover mode) so there is never letterboxing.

### Pattern 4: Tooltip via CSS (group-hover)

**What:** Simple label tooltip that appears on hover/focus, positioned relative to the station button.

**Example using Tailwind group pattern:**
```tsx
// Source: Tailwind v4 docs (group variant)
<button className="group relative ...">
  <Image ... />
  <span
    className="absolute -bottom-8 left-1/2 -translate-x-1/2
      px-3 py-1 rounded bg-factory-surface/90 text-factory-text text-sm
      font-heading whitespace-nowrap pointer-events-none
      opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100
      transition-opacity duration-200"
    role="tooltip"
  >
    {label}
  </span>
</button>
```

**Key details:**
- `pointer-events-none` on the tooltip so it does not interfere with the button's click area
- `opacity-0` -> `group-hover:opacity-100` for smooth appear/disappear
- `group-focus-visible:opacity-100` so keyboard users see the label too
- `role="tooltip"` with the button having `aria-describedby` pointing to the tooltip's ID

### Anti-Patterns to Avoid

- **`<div>` with onClick for interactive elements:** Always use `<button>` for clickable scene objects. Divs require manual ARIA roles, keyboard handlers, and tabindex -- `<button>` gets all of this free.
- **Separate hover JS event handlers:** Use CSS `:hover` via Tailwind's `hover:` variant. JS `onMouseEnter`/`onMouseLeave` adds unnecessary complexity and re-renders for purely visual effects.
- **Absolute positioning with px values:** All positions must use percentages from SCENE_DATA to scale proportionally. Never hardcode pixel positions.
- **`pointer-events: visiblePainted` on HTML elements:** This is SVG-only. For HTML elements, only `auto` and `none` are supported. Use `clip-path: polygon()` instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hover glow effect | Custom JS animation loop | `hover:drop-shadow-[...] hover:brightness-125` Tailwind utilities | CSS filter is GPU-accelerated, no JS re-renders |
| Click feedback | JS state + setTimeout | `active:scale-95 active:duration-100` Tailwind utilities | :active pseudo-class is synchronous with click, no state management needed |
| Tooltip positioning | Floating UI / Popper.js / custom positioning JS | CSS absolute positioning within button container | Static labels don't need dynamic repositioning; CSS handles this cleanly |
| Focus management | Custom focus trap for scene | Native `<button>` elements with explicit `tabIndex` ordering | Browser handles sequential focus order natively |
| Scroll lock when modal opens | Custom scroll prevention | Already handled by ModalProvider (Phase 54) | `body.modal-open { overflow: hidden }` is already implemented |
| Reduced motion | Custom media query handling | Already in globals.css | `@media (prefers-reduced-motion: reduce)` already disables all animations |

**Key insight:** This phase is almost entirely CSS work. The only JS logic is the click handler that calls `openModal()` with coordinates, and the station metadata mapping. Every visual effect (glow, press, tooltip appear, focus ring) is pure CSS via Tailwind utilities.

## Common Pitfalls

### Pitfall 1: pointer-events: visiblePainted Does Not Work for HTML

**What goes wrong:** Developer uses `pointer-events: visiblePainted` on the overlay `<button>` expecting transparent PNG regions to ignore clicks. In HTML, this value is SVG-only -- the browser falls back to `auto`, meaning the entire bounding box is clickable.
**Why it happens:** MDN lists visiblePainted in the pointer-events docs, and it sounds perfect for this use case. But the fine print says "SVG only (experimental for HTML)."
**How to avoid:** Use `clip-path: polygon(...)` on the button element. clip-path both visually clips the element AND removes clipped regions from pointer event hit testing. Define approximate polygon shapes that follow the visible outline of each overlay asset.
**Warning signs:** Clicking on transparent areas between machines triggers the wrong station's modal.
**Confidence:** HIGH (verified via MDN official documentation)

### Pitfall 2: drop-shadow vs box-shadow on Transparent Images

**What goes wrong:** Using `box-shadow` instead of `filter: drop-shadow()` on transparent PNG overlays. Box-shadow draws a shadow around the rectangular bounding box, not around the visible pixels.
**Why it happens:** `box-shadow` is more commonly known and has more documentation.
**How to avoid:** Always use `filter: drop-shadow()` for transparent images. The drop-shadow filter respects the alpha channel and creates a glow that follows the actual shape of the machine silhouette.
**Warning signs:** Hover glow appears as a rectangle around the entire overlay area instead of conforming to the machine shape.
**Confidence:** HIGH (verified via MDN: "drop-shadow is effectively a blurred, offset version of the input image's alpha mask")

### Pitfall 3: Filter Stacking Order with drop-shadow + brightness

**What goes wrong:** Applying `drop-shadow` and `brightness` as separate `filter` properties causes one to override the other (CSS `filter` is a single property, not additive).
**Why it happens:** Each `filter: ...` declaration replaces the previous one. They must be combined in a single `filter` value.
**How to avoid:** Tailwind v4 handles this correctly -- multiple filter utilities (`drop-shadow-[...] brightness-125`) are combined into a single `filter` CSS property automatically. Just ensure both are on the same element and in the same state variant.
**Warning signs:** Only one of glow or brightness appears on hover.
**Confidence:** HIGH (Tailwind v4 docs confirm filter utility stacking)

### Pitfall 4: clip-path Breaks filter: drop-shadow

**What goes wrong:** When `clip-path` is applied to the same element as `filter: drop-shadow()`, the drop-shadow gets clipped by the clip-path, cutting off the glow halo.
**Why it happens:** CSS clip-path clips the entire visual output of the element, including filter effects rendered outside the element's bounds.
**How to avoid:** Apply `clip-path` to an inner wrapper (or the image itself) and `filter` effects to the outer button. The structure should be:
```
<button>         -- filter: drop-shadow() + brightness (hover glow)
  <div>          -- clip-path: polygon() (click area restriction)
    <Image />    -- the actual overlay image
  </div>
  <Tooltip />
</button>
```
The outer button does NOT have clip-path, so the glow can extend beyond. But pointer events on the button... this creates a conflict. See the Architecture recommendation below.
**Warning signs:** Hover glow is truncated/cut off at the polygon edges.
**Confidence:** HIGH (CSS spec: clip-path clips the entire paint output including filters)

### Pitfall 5: Safe Zone Aspect Ratio Miscalculation

**What goes wrong:** Using `aspect-ratio: 1.81` CSS property on the safe zone container causes the container to collapse or overflow in certain viewport configurations.
**Why it happens:** `aspect-ratio` CSS property establishes preferred ratio but can conflict with `width: 100%` + `height: 100%` constraints.
**How to avoid:** Use `max-width: calc(100vh * 1.81)` and `max-height: calc(100vw / 1.81)` on the safe zone container. This constrains the container to always fit within the viewport while maintaining ratio. Width and height are set to 100% with these max constraints.
**Warning signs:** Overlays shift position or overflow on ultrawide or tall monitors.
**Confidence:** MEDIUM (pattern is well-established but needs testing on extreme viewports)

### Pitfall 6: tabIndex Ordering vs DOM Order

**What goes wrong:** Setting `tabIndex` values to enforce specific tab order (e.g., `tabIndex={1}`, `tabIndex={2}`) creates accessibility problems -- positive tabindex values take priority over ALL other focusable elements on the page.
**Why it happens:** Developer wants Connect Wallet first, so sets `tabIndex={1}`.
**How to avoid:** Use DOM order to control tab sequence. Render the buttons in the desired tab order in JSX. All buttons use `tabIndex={0}` (default for `<button>`). Visual positioning is handled by absolute CSS positioning, which is independent of DOM order.
**Warning signs:** Tabbing jumps unpredictably between scene buttons and other page elements.
**Confidence:** HIGH (WCAG best practice: avoid positive tabindex)

### Pitfall 7: Iris Animation Origin on Button Center vs Click Point

**What goes wrong:** The iris animation opens from the center of the button's bounding rect, but the button covers the entire overlay area (including transparent regions). The visual center of the machine may not match the bounding rect center.
**Why it happens:** Using `getBoundingClientRect()` center for the iris origin.
**How to avoid:** This is acceptable behavior -- the existing demo buttons in Phase 54 use the same approach. The iris animation radiates outward, so the exact origin point matters less for large radii. For more precise feel, could use `e.clientX/Y` (actual click coordinates) instead of button center.
**Warning signs:** Iris animation feels slightly off-center from where the user clicked.
**Confidence:** HIGH (minor UX detail, not a blocker)

## Code Examples

### Verified: Tailwind v4 Drop-Shadow with Custom Color

```tsx
// Source: Tailwind v4.1.18 docs (filter-drop-shadow)
// Arbitrary value syntax for warm brass/amber glow:
<button className="
  hover:drop-shadow-[0_0_20px_rgba(212,160,74,0.7)]
  hover:brightness-125
  transition-[filter,transform] duration-150
">
```

Tailwind v4 automatically combines `drop-shadow` and `brightness` into a single `filter` CSS property: `filter: drop-shadow(0 0 20px rgba(212,160,74,0.7)) brightness(1.25);`

### Verified: Active Press Feedback

```tsx
// Source: Tailwind v4.1.18 docs (scale, transition-duration)
// Quick mechanical press: scale down to 95% in 100ms
<button className="
  active:scale-95
  transition-transform duration-100
">
```

The `:active` pseudo-class fires on mousedown, giving instant feedback. The `duration-100` (100ms) transition makes the press feel snappy and mechanical.

### Verified: Tooltip with Group Pattern

```tsx
// Source: Tailwind v4 docs (group variant) + WAI-ARIA tooltip pattern
<button className="group relative" aria-describedby="tooltip-swap">
  {/* ... image ... */}
  <span
    id="tooltip-swap"
    role="tooltip"
    className="
      absolute -bottom-8 left-1/2 -translate-x-1/2
      px-3 py-1 rounded
      bg-factory-surface/90 text-factory-text text-sm font-heading
      whitespace-nowrap pointer-events-none
      opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100
      transition-opacity duration-200
    "
  >
    Swap Machine
  </span>
</button>
```

### Verified: clip-path Polygon for Click Area Restriction

```tsx
// Source: MDN clip-path docs + CSS spec
// clip-path removes clipped regions from pointer event hit testing
<div
  style={{
    clipPath: 'polygon(10% 5%, 90% 5%, 95% 50%, 85% 95%, 15% 95%, 5% 50%)',
  }}
>
  <Image src={overlay.src} fill className="object-contain" />
</div>
```

Each station needs a hand-tuned polygon approximating the visible pixels. These are rough shapes (10-20 polygon points), not pixel-perfect contours. The polygons use percentage coordinates so they scale with the overlay.

### Verified: Safe Zone Container

```tsx
// Source: CSS calc() + MDN object-fit docs
// Background fills viewport, safe zone preserves 1.81:1 ratio
<div className="relative w-full h-screen overflow-hidden">
  <Image
    src={SCENE_DATA.background.src}
    fill
    className="object-cover"
    alt=""
    role="img"
    aria-label="Factory scene depicting Dr. Fraudsworth's steampunk finance factory"
  />

  {/* Safe zone: centered, maintains 1.81:1 ratio */}
  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
    <div
      className="relative w-full h-full pointer-events-auto"
      style={{
        maxWidth: 'calc(100vh * 1.81)',
        maxHeight: 'calc(100vw / 1.81)',
      }}
    >
      {/* Station buttons positioned inside safe zone */}
    </div>
  </div>
</div>
```

### Verified: CSS-Only Swap Station Placeholder

```tsx
// Source: CSS techniques for silhouette/placeholder shapes
// Steampunk machine silhouette using CSS borders, gradients, pseudo-elements
<div className="absolute z-overlays w-full h-full flex items-center justify-center">
  <div className="
    w-3/4 h-3/4
    border-2 border-dashed border-factory-accent/40
    rounded-lg
    bg-factory-surface/20
    flex items-center justify-center
  ">
    <span className="text-factory-text-muted text-sm font-heading">
      Swap Machine
    </span>
  </div>
</div>
```

## Clip-Path vs Filter Conflict Resolution

**The problem:** The context requires both:
1. Click area restricted to visible pixels (`clip-path` on the clickable element)
2. Hover glow extending beyond the image shape (`drop-shadow` filter)

These conflict because `clip-path` clips the filter output, cutting off the glow halo.

**Recommended architecture:**

```
<button>                    -- NO clip-path, HAS filter effects
  <div clip-path>           -- HAS clip-path, NO filter (inner hit area)
    <Image />               -- The overlay image
  </div>
  <StationTooltip />
</button>
```

**But this does not fully solve it.** The `<button>` still has its full bounding box as the click area. Only the inner `<div>` is clipped.

**Practical resolution:** Since the context says "bounding boxes may overlap but visible content does not," and all machines are distinct visual elements, the primary concern is not overlapping click regions but rather avoiding clicks on completely empty space between machines. Given this, there are two workable approaches:

1. **Simple approach (recommended):** Apply `clip-path` to the button itself. Accept that the glow gets slightly clipped at the edges. The drop-shadow glow on hover will still be clearly visible within the polygon region, and the clipping makes the glow look intentional (a tight halo rather than an extended bloom). This is the simplest implementation.

2. **Complex approach:** Use a two-layer structure where the outer wrapper has `pointer-events: none` and the filter, and an inner element has `pointer-events: auto` with the clip-path. This is fragile and harder to reason about.

**Recommendation:** Go with approach 1. The slight glow clipping looks intentional (the glow stays tight to the machine shape), and it drastically simplifies the component structure. A 12-point polygon per station captures the general machine shape well enough.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Image maps (`<map>` + `<area>`) | CSS clip-path + button elements | ~2020 | clip-path is GPU-accelerated, responsive, style-able |
| JS mouse position checking for hit areas | CSS clip-path pointer event clipping | ~2020 | No runtime JS cost, declarative |
| Custom focus ring styles per browser | `:focus-visible` pseudo-class | Baseline 2022 | Only shows focus ring for keyboard navigation |
| Separate JS tooltip libraries | CSS group-hover + transition | ~2023 | Zero-dependency for simple label tooltips |
| Tailwind v3 JIT arbitrary values | Tailwind v4 native arbitrary values | 2025 | Same syntax, but v4 uses CSS cascade layers natively |

**Deprecated/outdated:**
- **HTML image maps (`<map>` + `<area>`):** Legacy approach, poor accessibility, no styling control. Use CSS clip-path instead.
- **`pointer-events: visiblePainted` for HTML:** SVG-only; does not work for HTML elements.

## Open Questions

1. **Clip-path polygon coordinates for each station**
   - What we know: Each station needs an approximate polygon matching its visible pixels. The polygon uses % coordinates relative to the overlay's bounding box.
   - What's unclear: The exact polygon points for each of the 5 overlay assets. These need to be traced manually by examining each WebP overlay.
   - Recommendation: During implementation, open each overlay image, identify ~10-15 key contour points, express as percentage coordinates. These go in `scene-data.ts` alongside station metadata.

2. **Swap-station placeholder position and size**
   - What we know: SCENE_DATA has `left: 50, top: 50, widthPct: 15, heightPct: 20` -- these are placeholder values since no asset exists.
   - What's unclear: Whether these are the correct final position/size or just defaults.
   - Recommendation: Use the placeholder values from SCENE_DATA as-is. The CSS placeholder should be clearly identifiable as a "coming soon" station. When the real asset is provided, the optimizer script will regenerate SCENE_DATA with correct coordinates.

3. **Exact glow color values**
   - What we know: "Warm brass/amber" using existing design token `--color-factory-accent` (#d4a04a) and `--color-factory-glow` (#f0c050).
   - What's unclear: Exact opacity and spread radius for the drop-shadow that looks "medium intensity."
   - Recommendation: Start with `drop-shadow(0 0 16px rgba(212,160,74,0.6))` + `brightness(1.2)`. Tune visually during implementation. Both factory-accent and factory-glow tokens are reasonable base colors.

4. **Below-1024px behavior**
   - What we know: Scene does not render below 1024px (Phase 59 handles mobile).
   - What's unclear: What shows instead -- blank page? fallback message? redirect?
   - Recommendation: Show a simple "Visit on desktop" message or the current dashboard view. This is Claude's discretion per CONTEXT.md. A hidden utility class `hidden lg:block` (Tailwind `lg` = 1024px) handles the breakpoint cleanly.

## Sources

### Primary (HIGH confidence)
- MDN: `pointer-events` CSS property -- Verified that `visiblePainted` is SVG-only, HTML supports only `auto` and `none`
- MDN: `drop-shadow()` filter function -- Verified it follows alpha channel of transparent images
- MDN: `clip-path` CSS property -- Verified that clipped regions are removed from pointer event hit testing
- Tailwind v4.1.18 docs: filter-drop-shadow, brightness, scale, transition-duration, group variant -- Verified arbitrary value syntax and filter stacking behavior
- W3C WAI-ARIA APG: Tooltip pattern -- Verified `role="tooltip"` + `aria-describedby` pattern

### Secondary (MEDIUM confidence)
- CSS-Tricks: "Drop-Shadow: The Underrated CSS Filter" -- Confirmed drop-shadow respects alpha channel for irregular shapes
- Smashing Magazine: "Managing SVG Interaction With The Pointer Events Property" -- Confirmed SVG-only scope of visiblePainted
- web.dev: "CSS aspect-ratio" article -- Informed safe zone scaling approach

### Tertiary (LOW confidence)
- None -- all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Zero new dependencies, all existing tools verified
- Architecture: HIGH - Component structure follows established patterns (button elements, Tailwind utilities, CSS-only effects)
- Pitfalls: HIGH - All critical pitfalls (visiblePainted, clip-path+filter conflict, drop-shadow vs box-shadow) verified against MDN official docs
- Scaling/safe zone: MEDIUM - Approach is sound but exact calc() behavior on extreme viewports needs testing
- Clip-path polygons: MEDIUM - Technique is proven but per-station coordinates must be hand-traced during implementation

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable CSS techniques, no fast-moving dependencies)
