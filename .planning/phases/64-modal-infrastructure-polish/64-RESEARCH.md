# Phase 64: Modal Infrastructure Polish - Research

**Researched:** 2026-02-27
**Domain:** CSS animations, image-based UI buttons, modal scroll containment
**Confidence:** HIGH

## Summary

Phase 64 is a small, well-scoped phase with two deliverables: (1) replace the CSS-only brass close button with a Photoshop-designed asset (`ExitButton.png`) that includes hover rotation and click snap animations, and (2) add `overscroll-behavior: contain` to modal content areas to prevent scroll chaining.

The existing codebase already has all the infrastructure needed. The `ModalCloseButton.tsx` component is a clean single-purpose component used in `ModalShell.tsx`. The CSS lives in `globals.css` lines 533-595 (`.modal-close-btn` rules). The project already uses asset-based buttons (see `BigRedButton.tsx` with `next/image` for the swap button). The close button asset (`ExitButton.png`) is already created at 64x64 RGBA PNG -- perfect for 2x retina at 32x32 rendered size.

**Primary recommendation:** Replace the SVG X mark and CSS brass gradient with the `ExitButton.png` asset as a plain `<img>` tag (not `next/image` -- at 32x32 rendered / 64x64 source, the overhead of Image optimization is unnecessary for a tiny decorative button). Strip the CSS brass gradient/border/box-shadow since the asset already contains the visual treatment. Add CSS `transition: transform` for the valve rotation hover animation and a quick snap keyframe for click.

## Standard Stack

### Core

No new libraries needed. This phase is pure CSS + asset swap.

| Technology | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| CSS `transform: rotate()` | Baseline | Hover/click rotation animation | Native CSS, zero dependencies, GPU-composited |
| CSS `overscroll-behavior` | Baseline since Feb 2025 | Scroll containment | Native CSS, one-liner, universal browser support |
| HTML `<img>` with `srcSet` | N/A | Retina-ready close button | Simplest approach for a fixed-size decorative icon |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `next/image` (Image) | Optimized image loading | NOT needed here -- 64x64 PNG is 1.7KB, Image optimization overhead is wasted. `BigRedButton.tsx` uses it because those assets are 300KB+ each. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|-----------|-----------|----------|
| Plain `<img>` | `next/image` | Adds layout shift protection and lazy loading, but for a 32x32 button that's always visible in the header, the ~2KB overhead and complexity aren't justified. BigRedButton uses Image because its assets are 300KB+. |
| CSS `rotate()` property | CSS `transform: rotate()` | The standalone `rotate` CSS property is newer (baseline 2022) and doesn't interfere with `transform`. However, the existing codebase uses `transform` exclusively, and combining with existing `translateY(-50%)` is well-understood. Keep consistent. |

**Installation:** None. No new packages.

## Architecture Patterns

### Existing File Structure (No Changes Needed)

```
app/
├── components/modal/
│   ├── ModalCloseButton.tsx   # MODIFY -- replace SVG with <img> asset
│   ├── ModalShell.tsx         # NO CHANGE -- already uses ModalCloseButton
│   └── ModalContent.tsx       # NO CHANGE
├── app/
│   └── globals.css            # MODIFY -- update .modal-close-btn rules
└── public/
    └── buttons/
        └── exit-button.png    # ADD -- copy from WebsiteAssets/ExitButton.png
```

### Pattern 1: Asset-Based Button (Established in Codebase)

**What:** Replace CSS-drawn visuals with a pre-designed image asset.
**When to use:** When the visual treatment is too complex for CSS (3D textures, hand-drawn art).
**Example from codebase:**

```tsx
// BigRedButton.tsx -- established pattern for asset-based buttons
<Image
  src="/buttons/big-red-button-centre.png"
  alt=""
  fill
  sizes="320px"
  className="brb-centre-img"
  draggable={false}
  priority
/>
```

For the close button, we use a simpler version since it's a tiny fixed-size element:

```tsx
// ModalCloseButton.tsx -- recommended approach
<button
  type="button"
  className="modal-close-btn"
  onClick={onClick}
  aria-label="Close"
>
  <img
    src="/buttons/exit-button.png"
    alt=""
    width={32}
    height={32}
    draggable={false}
  />
</button>
```

### Pattern 2: Valve Rotation Animation (CSS Only)

**What:** Subtle clockwise rotation on hover, quick snap rotation on click.
**When to use:** Steampunk "turning a valve" interaction feedback.

```css
/* Base: no rotation, transition handles smooth hover/unhover */
.modal-close-btn {
  /* ... existing position/size ... */
  transition: transform 200ms ease, filter 150ms ease;
}

/* Hover: gentle clockwise turn (like loosening a valve) */
.modal-close-btn:hover {
  transform: translateY(-50%) rotate(15deg);
  filter: brightness(1.1) drop-shadow(0 0 6px rgba(240, 192, 80, 0.4));
}

/* Click: quick snap further rotation */
.modal-close-btn:active {
  transform: translateY(-50%) rotate(30deg);
  transition-duration: 80ms;
}
```

### Pattern 3: Transform Stacking Pitfall (CRITICAL)

**What:** The base `.modal-close-btn` has `transform: translateY(-50%)` for vertical centering in the classic header. The floating variant (`.modal-floating-close .modal-close-btn`) overrides `top` and `right` but inherits the base `translateY(-50%)`.

**Implication for rotation:** Any hover/active `transform` MUST preserve the existing `translateY(-50%)` or the button jumps. CSS `transform` is a single property -- setting `rotate(15deg)` alone would REMOVE the translateY.

**Two contexts for the close button:**
1. **Classic header** (docs, settings): `top: 50%; right: 1rem; transform: translateY(-50%)` -- rotation must combine: `translateY(-50%) rotate(Xdeg)`
2. **Kit-frame floating** (swap, carnage, staking, wallet): `top: -20px; right: -36px; transform: translateY(-50%)` -- same transform stacking needed

**Simplification opportunity:** Since the asset image IS the button (no CSS gradient/border to maintain), we could remove `translateY(-50%)` and instead use flexbox centering or `top: calc(50% - 16px)` to avoid transform stacking entirely. This would make rotation cleaner: just `transform: rotate(Xdeg)`.

### Anti-Patterns to Avoid

- **Using `next/image` for tiny decorative icons:** The Image component adds a `<span>` wrapper, lazy loading logic, and srcSet generation. For a 32x32 button rendered from a 64x64 source (< 2KB), this is pure overhead. Plain `<img>` is correct.
- **Animating `filter` and `transform` simultaneously on the same transition:** Keep them on separate transition properties to avoid jank. The existing code already does this correctly.
- **Using `@keyframes` for hover rotation:** A simple CSS transition on `transform: rotate()` is smoother and more responsive than a keyframe animation for hover states. Keyframes are better for the click snap (one-shot) if desired.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scroll chaining prevention | JS scroll event listeners | `overscroll-behavior: contain` | CSS one-liner, no JS, no edge cases, baseline since Feb 2025 |
| Retina support | Canvas rendering or JS pixel ratio detection | `<img>` with 2x asset at explicit width/height | Browser handles device pixel ratio natively with a 2x source |
| Button rotation animation | JS-driven transform updates (requestAnimationFrame) | CSS `transition` on `transform` | GPU-composited, no JS cost, smooth 60fps |

**Key insight:** Everything in this phase is solved by CSS. No JS animation libraries, no polyfills, no build tools.

## Common Pitfalls

### Pitfall 1: Transform Stacking Destroys Centering

**What goes wrong:** Adding `transform: rotate(15deg)` on hover removes the existing `translateY(-50%)` vertical centering, causing the button to jump 16px.
**Why it happens:** CSS `transform` is a single property. Setting it replaces the entire value, not just the rotation part.
**How to avoid:** Always combine transforms: `transform: translateY(-50%) rotate(15deg)`. Or better: refactor to use `top: calc(50% - 16px)` instead of `translateY(-50%)` so transform is free for rotation alone.
**Warning signs:** Button visually jumps on hover.

### Pitfall 2: Hover Glow Leaks Beyond Circular Boundary

**What goes wrong:** Using `box-shadow` for the brass glow on a circular asset can create a rectangular glow since the asset is a square `<img>`.
**Why it happens:** `box-shadow` respects `border-radius` on the element, not the image content's transparency.
**How to avoid:** Use `filter: drop-shadow()` instead of `box-shadow` for the glow. `drop-shadow` respects the alpha channel of the image content, creating a glow that follows the circular brass shape.
**Warning signs:** Rectangular glow corners visible around the round button.

### Pitfall 3: Iris Animation Conflict

**What goes wrong:** Adding `will-change: transform` permanently to the close button can interfere with the dialog's `will-change: clip-path` during iris open animation by creating a new stacking context.
**Why it happens:** `will-change` creates compositor layers. Nested compositor layers during clip-path animation can cause rendering artifacts on some browsers.
**How to avoid:** Don't set `will-change` on the close button. The rotation is simple enough that browsers optimize it automatically. The existing iris animation already handles its own `will-change` lifecycle (set before, remove after).
**Warning signs:** Close button flickers during iris open animation.

### Pitfall 4: Mobile Close Button Still Shows

**What goes wrong:** The asset-based close button appears on mobile where it should be hidden (mobile uses the back arrow instead).
**Why it happens:** Forgetting that `globals.css` line 1194 hides `.modal-close-btn` at `width < 64rem`.
**How to avoid:** The existing `display: none` rule at the mobile breakpoint will continue to work since we're keeping the same `.modal-close-btn` class name. No changes needed, but verify it.
**Warning signs:** Two close mechanisms visible on mobile.

### Pitfall 5: overscroll-behavior on Wrong Element

**What goes wrong:** Adding `overscroll-behavior: contain` to the `<dialog>` element instead of the scrollable `.modal-body` has no effect because the dialog itself doesn't scroll (it has `overflow: visible`).
**Why it happens:** `overscroll-behavior` only affects elements that are themselves scroll containers.
**How to avoid:** Apply to `.modal-body` which has `overflow-y: auto`.
**Warning signs:** Page still scrolls behind the modal when reaching the end of modal content.

## Code Examples

### Close Button Component (Recommended Implementation)

```tsx
// ModalCloseButton.tsx -- asset-based brass valve close button
'use client';

interface ModalCloseButtonProps {
  onClick: () => void;
}

export function ModalCloseButton({ onClick }: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      className="modal-close-btn"
      onClick={onClick}
      aria-label="Close"
    >
      <img
        src="/buttons/exit-button.png"
        alt=""
        width={32}
        height={32}
        draggable={false}
      />
    </button>
  );
}
```

### CSS Changes (Recommended Implementation)

```css
/* =============================================================================
   Modal Close Button -- Brass Valve Asset (Phase 64)
   Replaces CSS-drawn brass circle with ExitButton.png asset.
   Hover: clockwise valve rotation + brass glow via drop-shadow.
   Active/click: quick snap rotation.
   ============================================================================= */

.modal-close-btn {
  position: absolute;
  top: 50%;
  right: 1rem;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 200ms ease, filter 200ms ease;
}

.modal-close-btn img {
  width: 32px;
  height: 32px;
  display: block;
}

.modal-close-btn:hover {
  transform: translateY(-50%) rotate(20deg);
  filter: brightness(1.1) drop-shadow(0 0 6px rgba(240, 192, 80, 0.4));
}

.modal-close-btn:active {
  transform: translateY(-50%) rotate(45deg);
  transition-duration: 80ms;
}

/* Focus ring -- circular treatment preserved */
dialog .modal-close-btn:focus-visible {
  border-radius: 50%;
  box-shadow:
    0 0 0 2px var(--color-factory-glow),
    0 0 12px rgba(240, 192, 80, 0.5);
}

/* Kit-frame floating position: outside top-right corner */
.modal-floating-close .modal-close-btn {
  top: -20px;
  right: -36px;
}

/* Mobile: hidden (back arrow used instead) -- existing rule preserved */
@media (width < 64rem) {
  .modal-close-btn {
    display: none;
  }
}
```

### Overscroll Containment (One-Liner)

```css
/* Add to existing .modal-body rule (globals.css ~line 520) */
.modal-body {
  overflow-y: auto;
  flex: 1;
  padding: 1.5rem;
  overscroll-behavior: contain;  /* <-- ADD THIS */
  scrollbar-width: thin;
  scrollbar-color: var(--color-factory-secondary) var(--color-factory-surface);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|-------------|------------------|--------------|--------|
| CSS gradients for button visuals | Pre-designed asset images | Already used in codebase (BigRedButton, Phase 62) | Higher visual fidelity, easier for designer iteration |
| JS scroll event prevention | `overscroll-behavior: contain` | Baseline Feb 2025 | Zero JS, no edge cases, native browser support |
| `transform` stacking | Individual transform properties (`rotate`, `translate`, `scale`) | Baseline 2022 | Could use separate `rotate` property to avoid stacking, but project uses `transform` throughout -- stay consistent |

**Deprecated/outdated:**
- `overflow: hidden` on dialog for scroll prevention: This is a blunt instrument. `overscroll-behavior: contain` is the targeted solution.
- `-webkit-overflow-scrolling: touch` for iOS momentum scrolling: Obsolete since iOS 13. No longer needed.

## Open Questions

1. **Transform refactoring scope**
   - What we know: The base `.modal-close-btn` uses `translateY(-50%)` for classic-header centering. Adding rotation means stacking transforms.
   - What's unclear: Whether to refactor classic-header centering to `top: calc(50% - 16px)` (frees transform for rotation only) or keep transform stacking (less code change).
   - Recommendation: Keep transform stacking. It's 2 lines changed (hover + active) vs a centering refactor that touches 3 rules. Both work; transform stacking is the smaller diff.

2. **Rotation degrees for hover vs click**
   - What we know: Context says "subtle clockwise rotation (like turning a valve)" for hover and "quick snap rotation" for click.
   - What's unclear: Exact degree values.
   - Recommendation: Use 20deg for hover (subtle quarter-turn feel), 45deg for active/click (decisive snap). These can be tuned visually during implementation. Claude's discretion per CONTEXT.md.

3. **Whether to add a scale effect alongside rotation**
   - What we know: CONTEXT.md marks this as Claude's discretion.
   - What's unclear: Whether scale(1.05) on hover looks good with the rotation.
   - Recommendation: Start without scale (rotation + glow is enough for a 32px element). Add scale only if the rotation alone feels too subtle after visual testing.

## Sources

### Primary (HIGH confidence)
- `app/components/modal/ModalCloseButton.tsx` -- current close button implementation (SVG X mark)
- `app/components/modal/ModalShell.tsx` -- modal shell using ModalCloseButton, showing classic vs kit-frame paths
- `app/app/globals.css` lines 533-595 -- current `.modal-close-btn` CSS rules
- `app/app/globals.css` lines 465-492 -- `.modal-floating-close` positioning for kit-frame
- `app/app/globals.css` lines 520-526 -- `.modal-body` scroll rules (where overscroll-behavior goes)
- `app/app/globals.css` lines 1193-1196 -- mobile breakpoint hiding `.modal-close-btn`
- `app/components/station/BigRedButton.tsx` -- established pattern for asset-based buttons
- `WebsiteAssets/ExitButton.png` -- 64x64 RGBA PNG, the replacement close button asset
- `app/public/buttons/` -- existing asset directory for button images

### Secondary (MEDIUM confidence)
- CSS `overscroll-behavior` baseline status: MDN documents this as baseline Feb 2025, verified by prior project research docs (`.planning/research/v1.1/FEATURES.md` line 592).

### Tertiary (LOW confidence)
- None. All findings verified against codebase source files.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, pure CSS + asset swap
- Architecture: HIGH -- verified against existing codebase patterns (BigRedButton, ModalShell)
- Pitfalls: HIGH -- all pitfalls identified from reading the actual CSS transform rules and modal structure

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- CSS features, no moving parts)
