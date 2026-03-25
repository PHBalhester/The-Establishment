# Phase 60: Design Tokens + Component Kit - Research

**Researched:** 2026-02-24
**Domain:** CSS design tokens (Tailwind v4 @theme), CSS border-image 9-slice, component architecture, WCAG AA contrast
**Confidence:** HIGH

## Summary

This phase builds the reusable steampunk component kit that all subsequent v1.1 phases (61-68) depend on. The technical surface area spans three domains: (1) extending the existing Tailwind v4 `@theme` token system with component-level tokens, (2) implementing a CSS `border-image` 9-slice frame system for steampunk frames, and (3) building 8 themed primitive components with a consistent variant/size API pattern.

The existing codebase already has a mature `@theme` block in `globals.css` (156 lines of tokens: colors, z-index, typography, animations) and several CSS-only steampunk component classes (`.brass-button`, `.brass-input`, `.lever-tab`, `.big-red-button`, `.modal-chrome`). These existing patterns establish conventions that the kit must follow: CSS classes in globals.css, Tailwind utility classes in JSX, and zero npm dependencies.

The critical technical challenge is the `border-image` 9-slice system. CSS `border-image` ignores `border-radius` entirely (per CSS spec), requiring a dual-mode Frame component. Sub-pixel seam artifacts on retina displays are a real risk with `border-image` and require 2x source images plus the `round` repeat mode.

**Primary recommendation:** Extend `@theme` with component-level tokens (frame, slider, toggle timing), create `kit.css` with `@layer kit` imported via CSS `@import` in globals.css between Tailwind's `components` and `utilities` layers, build a `Frame` component with CSS-only mode (box-shadow/border + border-radius) and asset-based mode (border-image with WebP), and implement all 8 primitives as React components in `components/kit/` with consistent `variant` + `size` prop pattern.

## Standard Stack

### Core (Already Installed -- Zero New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.1.18 | @theme tokens, @layer for kit CSS | Already installed, v4 native CSS @layer |
| Next.js | 16.1.6 | CSS import handling, `public/` static serving | Already installed, built-in CSS layer support |
| React | 19.2.3 | Component architecture (FC, forwardRef) | Already installed |
| PostCSS | via @tailwindcss/postcss 4.1.18 | CSS processing with @import | Already configured |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| WebP images | N/A (browser-native) | Frame assets for border-image source | All modern browsers support WebP |
| CSS border-image | Baseline since 2015 | 9-slice frame rendering | For rectangular steampunk frames |
| CSS custom properties | Baseline | Design tokens consumed by kit components | All component theming |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS border-image | HTML Canvas 9-slice | Overkill, no CSS integration, JS dependency |
| @layer kit in CSS | CSS Modules per component | Loses global token access, harder to compose |
| WebP frame images | SVG frames | WebP better for photorealistic textures; SVG is for geometric |
| border-image fill | Separate background-image | Fill is purpose-built for 9-slice centers; extra background property would fight with fill |

**Installation:** None required. All tools are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
app/
  app/
    globals.css              # Extended @theme tokens + @import "./kit.css" layer(kit)
    kit.css                  # NEW: @layer kit { ... } component styles
    layout.tsx               # No changes needed (already imports globals.css)
  components/
    kit/                     # NEW: Component kit directory
      index.ts               # Barrel export
      Frame.tsx              # Dual-mode frame (CSS-only + border-image)
      Button.tsx             # Brass button variants
      Input.tsx              # Aged metal input
      Tabs.tsx               # Lever-style tabs (extends existing .lever-tab)
      Toggle.tsx             # On/off switch
      Slider.tsx             # Brass knob slider
      Card.tsx               # Framed content container (uses Frame internally)
      Divider.tsx            # Riveted horizontal rule
      Scrollbar.tsx          # CSS utility component (applies scrollbar tokens)
public/
  frames/                    # NEW: WebP frame assets for border-image
    ornate-paper.webp        # Victorian ornate frame (parchment fill)
    ornate-paper-active.webp # Active state variant
    riveted-paper.webp       # Industrial riveted frame (parchment fill)
    riveted-paper-active.webp # Active state variant
```

### Pattern 1: Tailwind v4 @theme Extension for Component Tokens
**What:** Add component-level design tokens to the existing @theme block in globals.css.
**When to use:** Always -- tokens must be in @theme to generate Tailwind utility classes.
**Confidence:** HIGH (verified via official Tailwind v4 docs)

```css
/* Source: https://tailwindcss.com/docs/theme */
@theme {
  /* === Existing tokens (colors, z-index, typography, animations) stay === */

  /* === NEW: Component Kit Tokens === */

  /* Frame system */
  --color-frame-parchment: #f5e6c8;
  --color-frame-parchment-dark: #e8d5a8;
  --color-frame-ink: #2a1f0e;
  --color-frame-ink-secondary: #5a4830;
  --color-frame-brass: #c4956a;
  --color-frame-brass-highlight: #f0c050;
  --color-frame-brass-shadow: #5a4510;

  /* Interactive timing (weighted 200-300ms per CONTEXT.md) */
  --duration-kit-hover: 250ms;
  --duration-kit-press: 200ms;
  --duration-kit-toggle: 300ms;

  /* Slider */
  --color-slider-track: #3d2b1a;
  --color-slider-fill: #c4956a;
  --color-slider-knob: #d4a04a;

  /* Toggle */
  --color-toggle-off-track: #3d2b1a;
  --color-toggle-on-track: #5da84a;
  --color-toggle-knob: #d4a04a;

  /* Hover glow (shared across all kit components per CONTEXT.md) */
  --shadow-kit-hover-glow: 0 0 12px rgba(240, 192, 80, 0.3);
}
```

**Key insight:** All token names use the `--color-`, `--duration-`, `--shadow-` namespaces so Tailwind v4 auto-generates corresponding utility classes (e.g., `bg-frame-parchment`, `duration-kit-hover`, `shadow-kit-hover-glow`).

### Pattern 2: CSS @layer kit in Separate File
**What:** Component kit CSS classes in a separate `kit.css` file using `@layer kit`.
**When to use:** For all kit component visual styles that go beyond Tailwind utilities.
**Confidence:** HIGH (verified: Tailwind v4 uses native CSS @layer; @import with layer() is built-in)

```css
/* globals.css -- declare layer order, then import kit */
@layer theme, base, kit, components, utilities;
@import "tailwindcss";
@import "./kit.css" layer(kit);
```

**Why `layer(kit)` between `components` and `utilities`:**
- Kit classes can be overridden by Tailwind utilities (correct behavior)
- Kit classes override Tailwind base/preflight (correct behavior)
- Kit classes sit at same level as ad-hoc component classes (`.modal-chrome` etc.)

**Important Tailwind v4 detail:** `@import "tailwindcss"` expands to multiple layer declarations internally. When you pre-declare layers with `@layer theme, base, kit, components, utilities;` BEFORE the import, the CSS cascade respects your declared order. This is confirmed by the Tailwind v4 release blog and GitHub discussions.

```css
/* kit.css -- all component kit styles */
/* No @import needed here; this file is imported into globals.css */

.kit-frame {
  position: relative;
  background: linear-gradient(135deg, var(--color-frame-parchment) 0%, var(--color-frame-parchment-dark) 50%, var(--color-frame-parchment) 100%);
}

.kit-frame-css {
  border: 3px solid var(--color-factory-accent);
  border-radius: 8px;
  box-shadow:
    0 0 0 6px var(--color-factory-surface-elevated),
    0 0 0 8px var(--color-factory-accent),
    0 0 40px rgba(240, 192, 80, 0.15);
}

.kit-frame-asset {
  border: 30px solid transparent;
  border-image-source: url('/frames/ornate-paper.webp');
  border-image-slice: 80 fill;
  border-image-repeat: round;
  border-radius: 0; /* border-image ignores border-radius -- be explicit */
}
```

### Pattern 3: Dual-Mode Frame Component
**What:** A single `<Frame>` component that supports CSS-only mode (with border-radius) and asset-based mode (with border-image 9-slice).
**When to use:** CSS-only for rounded elements (buttons, pills, tooltips); asset-based for rectangular steampunk frames (cards, panels, modals).
**Confidence:** HIGH (verified: border-image ignores border-radius per MDN docs)

```tsx
// components/kit/Frame.tsx
interface FrameProps {
  /** 'css' = box-shadow/border with border-radius, 'ornate' | 'riveted' = border-image 9-slice */
  mode: 'css' | 'ornate' | 'riveted';
  /** Whether this is an active/pressed state (swaps to Active asset) */
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Frame({ mode, active = false, children, className }: FrameProps) {
  if (mode === 'css') {
    return (
      <div className={`kit-frame kit-frame-css ${className ?? ''}`}>
        {children}
      </div>
    );
  }

  // Asset-based mode
  const variant = mode; // 'ornate' | 'riveted'
  const suffix = active ? '-active' : '';
  const src = `/frames/${variant}-paper${suffix}.webp`;

  return (
    <div
      className={`kit-frame kit-frame-asset ${className ?? ''}`}
      style={{ borderImageSource: `url('${src}')` }}
    >
      {children}
    </div>
  );
}
```

### Pattern 4: Consistent Component API (Variant + Size Props)
**What:** All kit primitives follow the same prop pattern for variants and sizes.
**When to use:** Every component in the kit.
**Confidence:** HIGH (standard React component pattern)

```tsx
// Consistent type pattern across all kit components
interface KitComponentProps {
  variant?: 'brass' | 'parchment' | 'dark';  // visual variant
  size?: 'sm' | 'md' | 'lg';                 // size scale
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Each component picks relevant variants from the shared pattern
// Button: variant = 'primary' | 'secondary' | 'ghost'
// Input: variant = 'default' | 'flush'
// Tabs: variant = 'lever' (only one for now, extends existing .lever-tab)
```

### Anti-Patterns to Avoid
- **Using border-image with border-radius:** CSS spec says border-image ignores border-radius. Never combine them -- use the CSS-only Frame mode when you need rounded corners.
- **Sprite sheets for frame assets:** The CONTEXT.md explicitly requires individual WebP files per frame, NOT sprite sheets. Sprite sheets complicate border-image-slice math and defeat HTTP/2 multiplexing.
- **New npm dependencies:** Zero new dependencies is a hard constraint. No Framer Motion, no styled-components, no UI component libraries.
- **Importing kit.css from TypeScript:** Do NOT `import './kit.css'` in a component file. Import it via CSS `@import` in globals.css so it participates in the layer cascade correctly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 9-slice image scaling | Custom Canvas/JS slicer | CSS `border-image` with `border-image-slice` | Native browser implementation, GPU-accelerated, zero JS |
| Component state animations | Custom JS animation timers | CSS `transition` with `data-state` attributes | Already established pattern in codebase (.lever-tab, .brass-button) |
| Scrollbar styling | Custom scrollbar overlay div | CSS `scrollbar-width: thin` + `scrollbar-color` | Baseline since Feb 2025, already used in `.modal-body` |
| Hover glow effect | JS mousemove with radial gradient | CSS `filter: brightness()` + `box-shadow` | Already established in .brass-button:hover pattern |
| Focus indicators | Custom focus ring component | CSS `:focus-visible` with box-shadow glow | Already established in `dialog :focus-visible` pattern |
| Disabled state | Custom overlay div + pointer-events | CSS `opacity` + `filter: saturate()` + `:disabled` | Already established in .brass-button:disabled pattern |

**Key insight:** The codebase already has 5+ steampunk CSS component patterns in globals.css. The kit should formalize and extend these, not replace them with a new approach.

## Common Pitfalls

### Pitfall 1: border-image Ignores border-radius (CRIT-05)
**What goes wrong:** Developer applies `border-radius: 8px` to an element with `border-image`. The corners remain square.
**Why it happens:** CSS spec explicitly states border-image replaces the border rendering, including radius. MDN confirms: "border-radius has no effect on the border image."
**How to avoid:** Frame component has two explicit modes. CSS-only mode uses box-shadow/border (supports border-radius). Asset mode uses border-image (always rectangular). Never attempt to combine them.
**Warning signs:** Rounded corners visible in CSS-only mode but disappearing when asset mode is enabled.

### Pitfall 2: Sub-Pixel Seams on Retina (HIGH-01)
**What goes wrong:** Thin visible lines (seams) appear at the boundaries between 9-slice regions on high-DPI screens.
**Why it happens:** When `border-image-repeat: stretch` or `repeat` is used, the browser interpolates between slice regions. At non-integer pixel boundaries on retina displays, sub-pixel rounding creates 1px gaps.
**How to avoid:**
1. Source images at 2x native resolution (e.g., 600x600 WebP for a frame that renders at 300x300 CSS pixels)
2. Use `border-image-repeat: round` (adjusts tile sizes to avoid fractional cuts)
3. In the source image, overlap slice regions by 1px at boundaries (the corner region extends 1px into the edge region)
4. Test on actual retina hardware (device pixel ratio 2x and 3x)
**Warning signs:** Seams that appear only on high-DPI screens or only at certain element sizes.

### Pitfall 3: border-image-slice Units Confusion
**What goes wrong:** Developer writes `border-image-slice: 30px` expecting CSS pixels. The browser ignores the `px` unit.
**Why it happens:** `border-image-slice` only accepts unitless numbers (image pixels) or percentages. CSS length units like `px`, `em`, `rem` are NOT valid.
**How to avoid:** Always use unitless numbers that correspond to actual pixel coordinates in the source image. For a 600x600 source image with 80px corners, use `border-image-slice: 80`.
**Warning signs:** Build warnings about invalid CSS values; frame corners appear too small or too large.

### Pitfall 4: Layer Ordering with @import
**What goes wrong:** Kit CSS classes have wrong specificity -- either utilities can't override them, or they can't override base styles.
**Why it happens:** In Tailwind v4, `@layer` is native CSS cascade layers. If you don't pre-declare layer order, the browser uses document order which may not match intent.
**How to avoid:** Pre-declare the full layer order at the top of globals.css BEFORE any @import:
```css
@layer theme, base, kit, components, utilities;
```
This ensures `kit` sits between `base` and `utilities` regardless of import order.
**Warning signs:** Kit component styles being overridden unexpectedly, or kit styles overriding Tailwind utilities.

### Pitfall 5: border-image-source Load Failure
**What goes wrong:** Frame renders with no visible border -- just content on transparent background.
**Why it happens:** The WebP file path is wrong, the file doesn't exist in `public/frames/`, or there's a typo in the filename.
**How to avoid:** Always specify `border-style: solid` and a `border-color` as fallback. If the image fails to load, the browser renders the solid border instead.
```css
.kit-frame-asset {
  border: 30px solid var(--color-factory-accent); /* Fallback */
  border-image-source: url('/frames/ornate-paper.webp');
  border-image-slice: 80 fill;
}
```
**Warning signs:** Frame looks like a plain colored border instead of the textured steampunk frame.

### Pitfall 6: Parchment Content Colors vs. Dark Theme Colors
**What goes wrong:** Text inside a Frame with parchment fill is unreadable because it uses the dark-theme text color (light on light).
**Why it happens:** The existing `text-factory-text` token (#ecdcc4) is designed for dark backgrounds. Parchment frames use a light background (~#f5e6c8).
**How to avoid:** Frame component automatically applies `color: var(--color-frame-ink)` to its children. The ink color (#2a1f0e dark brown) is verified for WCAG AA contrast on parchment.
**Warning signs:** Light-colored text appearing inside parchment frames.

### Pitfall 7: fill Keyword Stacking with Background
**What goes wrong:** The `border-image-slice: 80 fill` center fills the element, but a `background-color` was also set. The fill renders ON TOP of the background.
**Why it happens:** Per CSS spec, the `fill` center slice is painted above the element's background. If both are visible, you see layering artifacts.
**How to avoid:** When using `fill`, set `background: transparent` or `background: none` on the element. Let the fill keyword handle the content area background.
**Warning signs:** Double-layered parchment texture, or unexpected color showing through the fill.

## Code Examples

### Example 1: Complete Frame Component (CSS-Only Mode)
```css
/* kit.css */
.kit-frame {
  position: relative;
  color: var(--color-frame-ink);
}

.kit-frame-css {
  background: linear-gradient(
    135deg,
    var(--color-frame-parchment) 0%,
    var(--color-frame-parchment-dark) 50%,
    var(--color-frame-parchment) 100%
  );
  border: 3px solid var(--color-factory-accent);
  border-radius: 8px;
  box-shadow:
    0 0 0 6px var(--color-factory-surface-elevated),
    0 0 0 8px var(--color-factory-accent),
    0 0 40px rgba(240, 192, 80, 0.15),
    0 16px 48px rgba(0, 0, 0, 0.5);
}
```

### Example 2: Complete Frame Component (Asset-Based 9-Slice Mode)
```css
/* kit.css */
.kit-frame-asset {
  /* Fallback border in case image fails to load */
  border: 30px solid var(--color-factory-accent);
  /* 9-slice border-image */
  border-image-source: url('/frames/ornate-paper.webp');
  border-image-slice: 80 fill;
  border-image-width: 30px;
  border-image-repeat: round;
  /* border-image ignores border-radius -- be explicit */
  border-radius: 0;
  /* fill paints above background, so set background to none */
  background: none;
}

/* Active state: swap to active asset */
.kit-frame-asset[data-active="true"] {
  border-image-source: url('/frames/ornate-paper-active.webp');
}
```

### Example 3: Hover Effect Pattern (Shared Across All Kit Components)
```css
/* kit.css -- per CONTEXT.md: warm golden glow + brightness + translateY lift */
.kit-interactive {
  transition:
    filter var(--duration-kit-hover) ease,
    transform var(--duration-kit-hover) ease,
    box-shadow var(--duration-kit-hover) ease;
}

.kit-interactive:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: var(--shadow-kit-hover-glow);
}

.kit-interactive:active:not(:disabled) {
  filter: brightness(0.95);
  transform: translateY(0);
  transition-duration: var(--duration-kit-press);
}

.kit-interactive:disabled {
  opacity: 0.4;
  filter: saturate(0.5);
  cursor: not-allowed;
}
```

### Example 4: Scrollbar Component (CSS-Only)
```css
/* kit.css */
.kit-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--color-factory-secondary) var(--color-factory-surface);
}

/* Webkit fallback for older Safari versions */
.kit-scrollbar::-webkit-scrollbar {
  width: 8px;
}
.kit-scrollbar::-webkit-scrollbar-track {
  background: var(--color-factory-surface);
}
.kit-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-factory-secondary);
  border-radius: 4px;
}
```

### Example 5: Button Component (TypeScript)
```tsx
// components/kit/Button.tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`kit-button kit-button-${variant} kit-button-${size} kit-interactive ${className ?? ''}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

### Example 6: Barrel Export
```tsx
// components/kit/index.ts
export { Frame } from './Frame';
export { Button } from './Button';
export { Input } from './Input';
export { Tabs } from './Tabs';
export { Toggle } from './Toggle';
export { Slider } from './Slider';
export { Card } from './Card';
export { Divider } from './Divider';
export { Scrollbar } from './Scrollbar';
```

## WCAG AA Contrast Verification Plan

The component kit introduces a new color context: dark text on light parchment. This needs verification alongside the existing dark-theme contrast pairs.

### New Pairs to Verify

| Pair | Foreground | Background | Target Ratio | Expected |
|------|-----------|-----------|--------------|----------|
| Ink on parchment | #2a1f0e | #f5e6c8 | 4.5:1 | ~14.0:1 (PASS) |
| Ink secondary on parchment | #5a4830 | #f5e6c8 | 4.5:1 | ~6.5:1 (PASS) |
| Brass accent on parchment | #8b6914 | #f5e6c8 | 3:1 UI | ~4.8:1 (PASS) |
| Error on parchment | #c04030 | #f5e6c8 | 3:1 UI | ~4.2:1 (PASS) |
| Success on parchment | #5da84a | #f5e6c8 | 3:1 UI | ~3.5:1 (PASS) |

**Note:** These are estimated ratios. Actual verification should use the W3C relative luminance formula, consistent with the existing contrast matrix in globals.css (lines 17-64).

### Existing Modal Chrome Reference

The `.modal-chrome` already uses a parchment gradient (`#f5e6c8` to `#e8d5a8`) with dark text (`#2a1f0e`). The modal header `h2` color is `#2a1f0e`. This validates the parchment+ink approach is already in production use.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 `tailwind.config.js` | Tailwind v4 `@theme` in CSS | v4.0 (Jan 2025) | All tokens in CSS, no JS config file |
| Tailwind v3 `@layer components` | Tailwind v4 native CSS `@layer` | v4.0 (Jan 2025) | Cascade layers are standard CSS, not Tailwind-proprietary |
| `::-webkit-scrollbar` (non-standard) | `scrollbar-width` + `scrollbar-color` (standard) | Baseline Feb 2025 | Standard properties now override webkit pseudo-elements |
| PNG border-image assets | WebP border-image assets | WebP baseline 2022 | 25-35% smaller files with same quality, alpha support |

**Deprecated/outdated:**
- `tailwind.config.js` / `tailwind.config.ts`: Not used in Tailwind v4. All config is CSS `@theme`.
- `::-webkit-scrollbar` as primary approach: Standard properties are now baseline. Use webkit only as fallback for older Safari.
- `postcss-import` plugin: Tailwind v4 has built-in `@import` support; external plugin not needed.

## Asset Preparation Notes

These are technical constraints the planner needs to account for when specifying frame asset creation tasks.

### WebP Frame Image Requirements

| Property | Requirement | Why |
|----------|------------|-----|
| Format | WebP (lossy body + lossless alpha) | CONTEXT.md specifies WebP. Lossy body keeps file size small; lossless alpha prevents edge fringing |
| Resolution | 2x native (e.g., 600x600 for 300px CSS render) | Retina seam prevention (HIGH-01) |
| Slice region overlap | 1px overlap at slice boundaries in source | Prevents sub-pixel gap artifacts |
| Corner size | Must be larger than desired CSS `border-image-width` | Corners are never stretched/repeated, only edges and center |
| Transparency | Transparent outside the frame border | Frame sits on dark factory background |
| Fill area | Parchment texture in the center region | `border-image-slice: N fill` preserves the center |
| Quality | 90 lossy / 100 alpha (Google's recommended settings) | Best quality-to-size ratio for WebP with transparency |

### 9-Slice Anatomy for Frame Assets

```
Source image (600x600 at 2x):
+--------+------------------+--------+
| Corner | Edge (repeats)   | Corner |
| 80x80  |    440x80        | 80x80  |  <- border-image-slice: 80
+--------+------------------+--------+
| Edge   | Center (fill)    | Edge   |
| 80x440 |    440x440       | 80x440 |
+--------+------------------+--------+
| Corner | Edge (repeats)   | Corner |
| 80x80  |    440x80        | 80x80  |
+--------+------------------+--------+

CSS usage:
  border: 30px solid transparent;
  border-image-source: url('/frames/ornate-paper.webp');
  border-image-slice: 80 fill;   /* 80 = image pixels (at 2x) */
  border-image-width: 30px;      /* 30px CSS = 60px at 2x device */
  border-image-repeat: round;
```

### Asset File Naming Convention

```
public/frames/
  ornate-paper.webp          # Victorian ornate frame, normal state
  ornate-paper-active.webp   # Victorian ornate frame, active/pressed state
  riveted-paper.webp         # Industrial riveted frame, normal state
  riveted-paper-active.webp  # Industrial riveted frame, active/pressed state
```

### Per-Asset Slice Values

The `border-image-slice` value is specific to each asset because corner sizes vary between ornate (elaborate filigree) and riveted (simple bolt corners) variants. These values are determined during Photoshop work and coded into kit.css as CSS custom properties:

```css
@theme {
  /* Slice values per frame variant (image pixels at 2x) */
  --frame-slice-ornate: 80;   /* Large corners for filigree */
  --frame-slice-riveted: 40;  /* Smaller corners for bolts */
}
```

**Important:** These values will need to be finalized after the user creates the actual Photoshop assets. The planner should account for a "measure and adjust" step.

## Open Questions

1. **Exact border-image-slice values per frame variant**
   - What we know: Slice values depend on the actual corner sizes in the Photoshop assets
   - What's unclear: The user hasn't created the assets yet, so exact pixel values are unknown
   - Recommendation: Use placeholder values (80 for ornate, 40 for riveted) and add a calibration task after assets are created

2. **Custom layer name: `kit` vs `components`**
   - What we know: Tailwind v4 uses `@layer components` internally. We can add a custom `@layer kit`.
   - What's unclear: Whether adding a custom layer between Tailwind's internal layers causes any edge cases with Turbopack
   - Recommendation: Test the `@layer kit` approach early. Fallback: put kit styles in `@layer components` (existing Tailwind layer). The risk is low since Tailwind v4 uses native CSS @layer.

3. **Scrollbar CSS: standard vs webkit for textured appearance**
   - What we know: Standard `scrollbar-color` supports only two flat colors (thumb + track). No textures or images.
   - What's unclear: Whether the steampunk aesthetic demands a textured scrollbar (which requires webkit pseudo-elements) or if colored scrollbars suffice
   - Recommendation: Use standard `scrollbar-width: thin` + `scrollbar-color` as primary. Add webkit pseudo-elements as enhancement for brass-colored gradient thumb. Standard CSS cannot do textured scrollbars.

4. **Whether `@import "./kit.css" layer(kit)` works correctly with Turbopack**
   - What we know: Tailwind v4 has built-in @import support. Next.js 16 with Turbopack handles CSS imports.
   - What's unclear: The combination of Tailwind v4's @import processor and a custom layer declaration hasn't been explicitly tested in this codebase
   - Recommendation: Make this the very first task in the plan -- create kit.css with a single test rule and verify it works before building all 8 components

## Sources

### Primary (HIGH confidence)
- [MDN border-image](https://developer.mozilla.org/en-US/docs/Web/CSS/border-image) -- 9-slice algorithm, border-radius incompatibility, fill keyword, browser support
- [MDN border-image-slice](https://developer.mozilla.org/en-US/docs/Web/CSS/border-image-slice) -- Slice value syntax, percentage vs unitless, 4-value mapping
- [MDN border-image-repeat](https://developer.mozilla.org/en-US/docs/Web/CSS/border-image-repeat) -- round vs repeat vs stretch for seam prevention
- [Tailwind CSS v4 @theme docs](https://tailwindcss.com/docs/theme) -- Token namespaces, utility generation, @theme inline, multiple @theme blocks
- [Tailwind CSS v4 custom styles docs](https://tailwindcss.com/docs/adding-custom-styles) -- @layer usage, components layer, importing separate files
- [Tailwind CSS v4 release blog](https://tailwindcss.com/blog/tailwindcss-v4) -- Built-in @import, native CSS layers, no postcss-import needed
- [Next.js CSS docs](https://nextjs.org/docs/app/getting-started/css) -- Multiple CSS imports, layer ordering, Turbopack considerations
- [MDN Scrollbar Styling](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scrollbars_styling) -- scrollbar-width, scrollbar-color, standard properties

### Secondary (MEDIUM confidence)
- [Tailwind v4 @layer ordering discussion](https://github.com/tailwindlabs/tailwindcss/discussions/16109) -- Custom layer ordering with Tailwind v4
- [Tailwind v4 CSS import discussion](https://github.com/tailwindlabs/tailwindcss/discussions/15524) -- Multiple @theme imports, external CSS file patterns
- [CSS-Tricks border-image](https://css-tricks.com/almanac/properties/b/border-image/) -- Practical usage patterns
- [TheLinuxCode border-image guide](https://thelinuxcode.com/css-border-image-property-a-practical-production-ready-guide/) -- Retina best practices, 2x source images
- [9-slicer tool](https://leanrada.com/9-slicer/) -- Interactive border-image CSS generator for calibrating slice values

### Tertiary (LOW confidence)
- [WebSearch: sub-pixel seam fixes](https://medium.com/design-bootcamp/addressing-sub-pixel-rendering-and-pixel-alignment-issues-in-web-development-cf4adb6ea6ac) -- GPU rendering techniques for pixel alignment, needs validation on actual hardware

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all tools already installed and verified
- Architecture patterns: HIGH -- @theme extension follows established codebase patterns, @layer is standard CSS
- border-image 9-slice: HIGH -- core CSS spec, well-documented, verified on MDN
- Kit CSS layer integration: MEDIUM -- Tailwind v4 native @layer is well-documented, but custom layer between Tailwind layers hasn't been tested in this specific codebase with Turbopack
- Pitfalls: HIGH -- border-image + border-radius incompatibility is explicitly documented in CSS spec; sub-pixel seams are well-known in game UI development
- Scrollbar styling: MEDIUM -- standard properties are baseline, but textured scrollbar (if desired) requires webkit fallback

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain -- CSS spec doesn't change frequently)
