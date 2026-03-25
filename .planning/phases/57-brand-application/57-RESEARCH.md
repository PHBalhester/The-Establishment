# Phase 57: Brand Application - Research

**Researched:** 2026-02-23
**Domain:** CSS theming, Tailwind v4 @theme tokens, WCAG accessibility, steampunk visual design
**Confidence:** HIGH

## Summary

Phase 57 is a visual re-theming pass: replace all residual generic Tailwind gray/zinc classes with steampunk palette tokens already defined in `globals.css`, refine those token values toward warmer/richer tones per CONTEXT.md decisions, add new CSS component styles (brass inputs, lever tabs, beveled buttons), and verify WCAG AA contrast compliance across every text-on-background combination.

The project already has a solid Tailwind v4 @theme token system in place (`--color-factory-*` namespace in `globals.css`), and several components (scene, modal, toast, settings, wallet, docs stations) are already using factory-* utility classes. The work is to (a) refine the existing token hex values, (b) add missing tokens for semantic and interactive states, (c) systematically replace 197 gray/zinc class occurrences across 26 files, and (d) build CSS-only decorative styling for inputs, tabs, and secondary buttons.

**Primary recommendation:** Work token-out: first refine the @theme palette values, then add new tokens and CSS component classes, then sweep each component file replacing gray/zinc classes with factory-* equivalents, finally verify contrast ratios with a computed-check script and browser DevTools.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.1.18 | @theme token system + utility classes | Already installed, @theme directive IS the theming mechanism |
| @tailwindcss/postcss | 4.1.18 | PostCSS plugin for Tailwind v4 | Already installed, builds CSS from @theme tokens |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | D10 decision: zero new npm dependencies for visual layer |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual contrast verification | `axe-core` / `pa11y` | Would require headless browser test setup; manual is sufficient for className-only changes since we can compute ratios from hex values directly |
| CSS component classes in globals.css | Tailwind @apply directives | @apply is just sugar for inline utilities; raw CSS in globals.css is more readable for complex box-shadow/gradient stacks and already established (modal-chrome, big-red-button) |

**Installation:** No new packages needed.

## Architecture Patterns

### Existing Token Architecture (globals.css)

```
globals.css
├── @import "tailwindcss"
├── @theme { ... }                     ← Factory palette tokens
│   ├── --color-factory-bg             ← Darkest background
│   ├── --color-factory-surface        ← Card/panel background
│   ├── --color-factory-surface-elevated ← Raised element background
│   ├── --color-factory-border         ← Primary border
│   ├── --color-factory-border-subtle  ← Secondary border
│   ├── --color-factory-primary        ← Copper/brass primary
│   ├── --color-factory-secondary      ← Dark gold secondary
│   ├── --color-factory-accent         ← Bright brass accent
│   ├── --color-factory-glow           ← Brightest gold (focus rings)
│   ├── --color-factory-text           ← Primary text (parchment)
│   ├── --color-factory-text-secondary ← Secondary text
│   ├── --color-factory-text-muted     ← Muted text
│   ├── --color-factory-success        ← Status: success
│   ├── --color-factory-error          ← Status: error
│   ├── --color-factory-warning        ← Status: warning
│   ├── --z-index-*                    ← Stacking layer system
│   ├── --text-*                       ← Typography scale
│   └── --animate-*                    ← Animation tokens
├── @theme inline { ... }             ← Font variable bridge
├── @keyframes ...                     ← Animations
├── .modal-shell, .modal-chrome, ...   ← Modal system CSS
├── .big-red-button { ... }            ← Big Red Button CSS
├── .toast-popover, .toast-card { ... }← Toast CSS
├── .station-content { ... }           ← Dark inner card
└── @media (prefers-reduced-motion)    ← A11Y reduced motion
```

### Pattern 1: Token-First Theming
**What:** All color values live in @theme tokens. Components use only `factory-*` utility classes. No hardcoded hex values in component className strings.
**When to use:** Every component className that currently uses gray-*, zinc-*, blue-*, etc.
**Example:**
```css
/* globals.css -- token definition */
@theme {
  --color-factory-bg: #2a1a10;
  --color-factory-surface: #3a281a;
}
```
```tsx
/* Component -- uses generated utilities */
<div className="bg-factory-surface border border-factory-border rounded-xl p-4">
```

### Pattern 2: CSS Component Classes for Complex Styling
**What:** Components with multi-property visual treatments (gradients, box-shadows, pseudo-elements) use named CSS classes in globals.css rather than long Tailwind utility strings.
**When to use:** Brass-rimmed inputs, lever tabs, beveled buttons -- any element needing 3+ CSS properties that Tailwind utilities can't cleanly express.
**Example:**
```css
/* globals.css */
.brass-input {
  background: var(--color-factory-surface);
  border: 2px solid var(--color-factory-border);
  border-radius: 6px;
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--color-factory-secondary);
  color: var(--color-factory-text);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.brass-input:focus {
  border-color: var(--color-factory-accent);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--color-factory-accent),
    0 0 8px rgba(240, 192, 80, 0.3);
}
```

### Pattern 3: data-state Attribute for Interactive States
**What:** Already established by BigRedButton. Use `data-state` attribute on interactive elements, with CSS selectors driving visual transitions.
**When to use:** Lever tabs (active/inactive), toggle switches (on/off).
**Example:**
```css
.lever-tab[data-state="active"] {
  /* Pressed-in lever look */
  transform: translateY(2px);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
}
```

### Anti-Patterns to Avoid
- **Mixed token sources:** Never use `bg-gray-*` alongside `bg-factory-*` in the same component. All or nothing per component.
- **Hardcoded hex in className:** Values like `text-[#9ca3af]` bypass the token system. Use `text-factory-text-secondary` instead.
- **Arbitrary Tailwind values for theme colors:** `bg-[#2a1f0e]` should be `bg-factory-surface` -- keeps the single source of truth.
- **Overriding factory-* with !important:** If a factory-* value doesn't look right, fix the token, don't override it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Contrast ratio calculation | Custom color math library | Simple JS function (50 lines, WCAG spec formula) OR browser DevTools | The algorithm is well-defined, a standalone script is trivial -- see Code Examples |
| Dark theme system | CSS variables + media query + JS toggle | @theme tokens already handle this (single dark theme, D7: no theme toggle) | The project is dark-only steampunk. No light mode needed |
| Loading spinner | New spinner component | Existing LoadingSpinner (CSS gear) from Phase 53 | CONTEXT.md: gear spinner is THE loading indicator everywhere |
| Focus ring styling | Per-component focus styles | Existing `dialog :focus-visible` rule in globals.css | Already themed with factory-glow color |

**Key insight:** The visual infrastructure is already built (token system, CSS component classes, focus styles, reduced motion). Phase 57 is applying what exists -- not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Token Value Changes Breaking Existing Themed Components
**What goes wrong:** Changing a token like `--color-factory-accent` from `#d4a04a` to a brighter value could make existing modal chrome, bolts, close button, and toast borders look wrong.
**Why it happens:** Multiple CSS rules in globals.css reference the same token -- modal-chrome border, modal-bolt gradient, toast-card border, focus-visible ring all use `var(--color-factory-accent)`.
**How to avoid:** After any token value change, visually inspect ALL existing themed elements: modal chrome frame, corner bolts, close button, toast cards, scene loading spinner, station-content wrapper.
**Warning signs:** Focus ring suddenly too bright/dim, modal border color mismatch, toast left-border wrong color.

### Pitfall 2: Contrast Ratio Cascade Failures
**What goes wrong:** Fixing one contrast issue (making text lighter) creates a new one (that text is now too similar to a nearby element's color).
**Why it happens:** The steampunk palette is narrow (warm browns, golds, parchment) so there's less color space to work with than a standard gray scale.
**How to avoid:** Define the full palette FIRST with computed contrast ratios for every text/background pair BEFORE applying to components. Document the passing pairs in a lookup table.
**Warning signs:** Needing to use white (#fff) text on dark backgrounds because no parchment tone passes -- signals the background isn't dark enough.

### Pitfall 3: CandlestickChart Has Hardcoded Colors
**What goes wrong:** The TradingView Lightweight Charts library accepts colors as JavaScript hex strings, not CSS variables. Changing `globals.css` tokens won't automatically update chart colors.
**Why it happens:** The chart is created with `createChart(container, { layout: { background: { color: "#0a0a0f" } } })` -- these are runtime JS values, not CSS.
**How to avoid:** Update the hardcoded hex values in `CandlestickChart.tsx` (lines 103-127) to match the refined palette. Consider reading CSS variable values at chart creation via `getComputedStyle()`, but this adds complexity for minimal benefit since chart colors rarely change.
**Warning signs:** Chart background is a different shade than the surrounding card background.

### Pitfall 4: The swap/page.tsx Legacy Route
**What goes wrong:** The `/swap` page is a dev-only legacy route with its own inline styling (`bg-gray-950 text-gray-100`). Theming it seems like wasted effort. But if anyone visits it, it looks jarringly different.
**Why it happens:** D8 decision: legacy pages retained for dev but not deleted.
**How to avoid:** Apply theming to swap/page.tsx too, even though it's dev-only. The effort is minimal (3 class replacements in the outer wrapper) and prevents the jarring mismatch.

### Pitfall 5: Blue Accent Color Throughout Interactive Elements
**What goes wrong:** Multiple components use blue-* for active/selected states (tabs: `bg-blue-600/20 border-blue-500`, buttons: `bg-blue-600`, slippage presets: `bg-blue-600`, route cards: `border-blue-500`, toggle: `bg-blue-600`). These don't fit the steampunk palette.
**Why it happens:** Blue is the default "interactive" color in most UI frameworks; components were built with generic styling before the steampunk theme was established.
**How to avoid:** Replace blue accents with factory-accent (brass gold) or factory-glow for all interactive highlight states. The brass glow is already the established hover/focus pattern.

### Pitfall 6: Semantic Colors Need Careful Handling
**What goes wrong:** Success banners use `bg-green-900/40 border-green-600 text-green-200`, error banners use `bg-red-900/40 border-red-600 text-red-200`, warnings use `bg-amber-900/40 border-amber-600`. These are semantic (users expect green=good, red=bad) and can't just be replaced with brass tones.
**Why it happens:** CONTEXT.md says "standard recognizable green/red/amber but with a warm shift to stay in the palette family." This means keeping the hue but adjusting the specific shades.
**How to avoid:** Create warm-shifted semantic tokens (`--color-factory-success-surface`, `--color-factory-success-border`, `--color-factory-success-text`, and same for error/warning). Use these tokens instead of hardcoded green/red/amber values.

### Pitfall 7: Token Colors Used in Both CSS and TSX
**What goes wrong:** Some color references exist in TypeScript objects, not className strings. For example, `CandlestickChart.tsx` has JS hex values. `RouteCard.tsx` has a `TOKEN_COLORS` object with `text-red-400`, `text-amber-400`, `text-green-400`. `TokenSelector.tsx` has `TOKEN_BADGE_COLORS` with `bg-red-500`, `bg-green-500`. The chart-theme values, the toast provider inline styles, etc.
**Why it happens:** Not all styling is className-based. Runtime chart libraries, inline styles, and JS-computed class selections all contain color values.
**How to avoid:** Search for ALL color references, not just className patterns. Grep for hex values like `#22c55e`, `#ef4444`, and for Tailwind color names in string literals.

## Code Examples

### WCAG Contrast Ratio Verification Script
```typescript
// Source: W3C WCAG 2.2 relative luminance formula
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) throw new Error(`Invalid hex: ${hex}`);
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return rs * 0.2126 + gs * 0.7152 + bs * 0.0722;
}

function contrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const l1 = luminance(r1, g1, b1);
  const l2 = luminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA thresholds:
// Normal text (< 18pt or < 14pt bold): 4.5:1
// Large text (>= 18pt or >= 14pt bold): 3:1
// UI components and graphical objects: 3:1
```

### Tailwind v4 @theme Token Addition Pattern
```css
/* globals.css -- extend existing @theme block */
@theme {
  /* ... existing tokens ... */

  /* NEW: Interactive state tokens */
  --color-factory-active: #c48a30;       /* Active tab/selection indicator */
  --color-factory-active-surface: #3a2a15; /* Active element background */

  /* NEW: Semantic status surfaces (warm-shifted) */
  --color-factory-success-surface: #1a2a18;
  --color-factory-success-border: #4a8a3a;
  --color-factory-success-text: #b0dba0;
  --color-factory-error-surface: #2a1818;
  --color-factory-error-border: #a04040;
  --color-factory-error-text: #e0a0a0;
  --color-factory-warning-surface: #2a2218;
  --color-factory-warning-border: #c09030;
  --color-factory-warning-text: #e0c890;
}
```

### Gray-to-Factory Class Mapping (Systematic Replacement)
```
BACKGROUNDS:
  bg-gray-950  → bg-factory-bg
  bg-gray-900  → bg-factory-surface
  bg-gray-800  → bg-factory-surface-elevated
  bg-zinc-950  → bg-factory-bg
  bg-zinc-900  → bg-factory-surface
  bg-zinc-800  → bg-factory-surface-elevated

TEXT:
  text-white       → text-factory-text (in most cases)
  text-gray-100    → text-factory-text
  text-gray-200    → text-factory-text
  text-zinc-100    → text-factory-text
  text-zinc-200    → text-factory-text
  text-gray-300    → text-factory-text-secondary
  text-zinc-300    → text-factory-text-secondary
  text-gray-400    → text-factory-text-secondary
  text-zinc-400    → text-factory-text-secondary
  text-gray-500    → text-factory-text-muted
  text-zinc-500    → text-factory-text-muted
  text-gray-600    → text-factory-text-muted (or lighter -- contrast check)
  text-zinc-600    → text-factory-text-muted (or lighter -- contrast check)

BORDERS:
  border-gray-700  → border-factory-border
  border-gray-800  → border-factory-border-subtle
  border-zinc-700  → border-factory-border
  border-zinc-800  → border-factory-border-subtle

INTERACTIVE (blue replacements):
  bg-blue-600      → bg-factory-accent
  bg-blue-600/20   → bg-factory-accent/20
  border-blue-500  → border-factory-accent
  text-blue-400    → text-factory-accent
  text-blue-200    → text-factory-text
  bg-blue-900/40   → bg-factory-secondary/20 (or new --color-factory-active-surface)
  border-blue-700  → border-factory-secondary

INTERACTIVE (indigo replacements):
  bg-indigo-600    → bg-factory-accent
  border-indigo-500 → border-factory-accent
  focus:border-indigo-500 → focus:border-factory-accent

LOADING/SKELETON:
  bg-gray-800 animate-pulse → bg-factory-surface-elevated animate-pulse
  bg-zinc-800 animate-pulse → bg-factory-surface-elevated animate-pulse
```

### Brass-Rimmed Input CSS Class
```css
/* globals.css -- steampunk form input */
.brass-input {
  background: var(--color-factory-surface);
  border: 2px solid var(--color-factory-border);
  border-radius: 6px;
  color: var(--color-factory-text);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  /* Inner shadow for recessed gauge look */
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--color-factory-secondary);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.brass-input::placeholder {
  color: var(--color-factory-text-muted);
}

.brass-input:focus {
  outline: none;
  border-color: var(--color-factory-accent);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--color-factory-accent),
    0 0 8px rgba(240, 192, 80, 0.3);
}

.brass-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: saturate(0.5);
}
```

### Lever Tab CSS Class
```css
/* globals.css -- mechanical lever/switch tab */
.lever-tab {
  position: relative;
  background: linear-gradient(180deg, var(--color-factory-surface-elevated) 0%, var(--color-factory-surface) 100%);
  border: 1px solid var(--color-factory-border);
  color: var(--color-factory-text-secondary);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  /* Raised lever: highlight top, shadow bottom */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 2px 0 0 var(--color-factory-border),
    0 3px 4px rgba(0, 0, 0, 0.2);
  transform: translateY(0);
  transition: transform 100ms ease, box-shadow 100ms ease, color 150ms ease, background 150ms ease;
}

.lever-tab:hover:not(:disabled):not([data-state="active"]) {
  color: var(--color-factory-text);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 2px 0 0 var(--color-factory-border),
    0 3px 6px rgba(0, 0, 0, 0.25),
    0 0 8px rgba(240, 192, 80, 0.15);
}

/* Active: lever is pressed down */
.lever-tab[data-state="active"] {
  color: var(--color-factory-accent);
  background: var(--color-factory-surface);
  transform: translateY(2px);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--color-factory-accent);
  border-bottom-color: var(--color-factory-accent);
}

.lever-tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: saturate(0.5);
}
```

### Beveled Brass Button CSS Class
```css
/* globals.css -- brass button for secondary actions */
.brass-button {
  background: linear-gradient(145deg,
    var(--color-factory-surface-elevated) 0%,
    var(--color-factory-surface) 100%
  );
  border: 1px solid var(--color-factory-border);
  border-radius: 6px;
  color: var(--color-factory-text);
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  /* Beveled raised appearance */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 2px 0 0 var(--color-factory-border),
    0 2px 4px rgba(0, 0, 0, 0.2);
  transform: translateY(0);
  transition: transform 80ms ease, box-shadow 80ms ease, filter 150ms ease;
}

.brass-button:hover:not(:disabled) {
  filter: brightness(1.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 2px 0 0 var(--color-factory-border),
    0 2px 6px rgba(0, 0, 0, 0.25),
    0 0 8px rgba(240, 192, 80, 0.2);
}

.brass-button:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.3),
    0 1px 0 0 var(--color-factory-border);
}

.brass-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: saturate(0.5);
}
```

## Detailed Audit: Files Requiring Re-theming

### Tier 1: Active Station Components (visible to users in modals)
These are the components that render inside the modal system. They are the primary user-facing UI.

| File | Gray/Zinc Occurrences | Other Color Replacements | Notes |
|------|----------------------|------------------------|-------|
| `components/swap/SwapForm.tsx` | 22 | blue-400, blue-300, blue-600, gray-700, placeholder-gray-600 | Most class changes in the project. Input fields, flip button, toggle, labels |
| `components/swap/TokenSelector.tsx` | 8 | blue-400 (checkmark) | Dropdown menu, selected/hover states |
| `components/swap/FeeBreakdown.tsx` | 10 | red-400, amber-400 | Expandable panel, tax indicator colors |
| `components/swap/SlippageConfig.tsx` | 12 | blue-600 (active presets), amber-500 (warnings) | Slippage/priority radio buttons, custom input |
| `components/swap/SwapStatus.tsx` | 5 | green-*, red-*, blue-* (status banners) | Transaction lifecycle display |
| `components/swap/RouteCard.tsx` | 8 | blue-500, red-400, amber-400, green-400 (TOKEN_COLORS), green-300 | Route selection cards |
| `components/swap/RouteSelector.tsx` | 4 | gray-700 (SVG strokes) | Timer ring, route list |
| `components/swap/MultiHopStatus.tsx` | 3 | green-*, red-*, amber-*, blue-* (status banners) | Multi-hop progress display |
| `components/swap/RouteBadge.tsx` | 0 | blue-600 | Badge pill |
| `components/staking/StakingForm.tsx` | 4 | blue-600/20, blue-500 (active tab) | Tab container, tab buttons |
| `components/staking/StakeTab.tsx` | 6 | blue-400 (Max button) | Input card, labels |
| `components/staking/UnstakeTab.tsx` | 6 | blue-400 (Max button), amber-* (warning) | Input card, labels, minimum stake warning |
| `components/staking/ClaimTab.tsx` | 7 | green-300 (reward amount) | Rewards display, details expandable |
| `components/staking/StakingStats.tsx` | 5 | (none) | Stats grid, labels |
| `components/staking/StakingStatus.tsx` | 5 | green-*, red-*, blue-* (status banners) | Transaction lifecycle |
| `components/station/SwapStation.tsx` | 1 | (none) | Chart wrapper bg |
| `components/station/SwapStatsBar.tsx` | 8 | (none) | Stats bar container, dividers, labels |
| `components/chart/ChartControls.tsx` | 8 | indigo-500/600, green-500, amber-500, red-500 | Pool selector, range buttons, connection dot |
| `components/chart/CandlestickChart.tsx` | 2 | Hardcoded JS hex values for chart theme | TradingView chart options (not className) |
| `components/dashboard/CarnageCard.tsx` | 28 | red-400, amber-400, blue-400, emerald-400 | Full card (used inside CarnageStation modal) |
| `components/dashboard/EpochCard.tsx` | 10 | red-400, amber-400/600 | Epoch display (used in DashboardGrid -- may also appear in trading terminal) |
| `components/dashboard/TaxRatesCard.tsx` | 6 | red-400, amber-400 | Tax rates display |
| `components/dashboard/PoolCard.tsx` | 14 | emerald-500/400 | Pool reserves display |

### Tier 2: Wallet Components (already partially themed in WalletStation)
| File | Gray/Zinc Occurrences | Notes |
|------|----------------------|-------|
| `components/wallet/ConnectModal.tsx` | 16 | LEGACY standalone modal -- WalletStation.tsx already themed. This file may be dead code if all wallet connections go through WalletStation now |
| `components/wallet/WalletButton.tsx` | 6 | Header button -- may be unused if scene replaces header |
| `components/wallet/BalanceDisplay.tsx` | 10 | Balance cards, error state |

### Tier 3: Legacy Dev Pages
| File | Gray/Zinc Occurrences | Notes |
|------|----------------------|-------|
| `app/swap/page.tsx` | 3 | Dev-only page wrapper. Minimal effort to theme |
| `components/dashboard/DashboardGrid.tsx` | 2 | Dev-only dashboard orchestrator. Error banner only |

### Already Themed (no changes needed)
| File | Status |
|------|--------|
| `components/station/WalletStation.tsx` | Uses factory-* classes throughout |
| `components/station/SettingsStation.tsx` | Uses factory-* classes throughout |
| `components/station/DocsStation.tsx` | Uses factory-* classes throughout |
| `components/scene/FactoryBackground.tsx` | Uses factory-* classes |
| `components/scene/LoadingSpinner.tsx` | Uses factory-* classes |
| `components/scene/SwapPlaceholder.tsx` | Uses factory-* classes |
| `components/scene/SceneStation.tsx` | Scene layer component |
| `components/modal/ModalShell.tsx` | CSS classes in globals.css |
| `components/modal/ModalContent.tsx` | Uses factory-* classes |
| `components/modal/ModalCloseButton.tsx` | CSS classes in globals.css |
| `components/modal/ModalProvider.tsx` | State management, no styling |
| `components/station/BigRedButton.tsx` | CSS class in globals.css |
| `components/toast/ToastProvider.tsx` | CSS classes in globals.css + some inline var() references |
| `app/page.tsx` | Uses factory-* classes |
| `app/layout.tsx` | Uses factory-* classes |

## Token Refinement Guidance

### Palette Direction (from CONTEXT.md decisions)

**Current values → Refined direction:**

| Token | Current | Direction | Rationale |
|-------|---------|-----------|-----------|
| `--color-factory-bg` | `#1a1208` | Warmer, richer -- toward mahogany/wood | "More warmth, less industrial grime" |
| `--color-factory-surface` | `#2a1f0e` | Warmer -- rich dark wood grain tone | Same |
| `--color-factory-surface-elevated` | `#3a2d18` | Slightly lighter warm brown | Same |
| `--color-factory-accent` | `#d4a04a` | Brighter, more saturated brass/gold | "Like polished brass fixtures" |
| `--color-factory-glow` | `#f0c050` | Keep or brighten slightly | Already bright gold |
| `--color-factory-success` | `#6b8e5a` | Recognizable green, warm-shifted | "Standard green/red/amber with warm shift" |
| `--color-factory-error` | `#a85040` | Recognizable red, warm-shifted | Same |
| `--color-factory-warning` | `#c4956a` | Currently same as primary -- needs to be amber-ish | Should be recognizably amber/yellow |

### New Tokens Needed

| Token | Purpose | Generated Utilities |
|-------|---------|-------------------|
| `--color-factory-active` | Active tab/selection indicator (replaces blue) | `bg-factory-active`, `border-factory-active`, `text-factory-active` |
| `--color-factory-active-surface` | Active element background (replaces `bg-blue-600/20`) | `bg-factory-active-surface` |
| `--color-factory-success-surface` | Success banner bg (replaces `bg-green-900/40`) | `bg-factory-success-surface` |
| `--color-factory-success-border` | Success banner border | `border-factory-success-border` |
| `--color-factory-success-text` | Success banner text | `text-factory-success-text` |
| `--color-factory-error-surface` | Error banner bg (replaces `bg-red-900/40`) | `bg-factory-error-surface` |
| `--color-factory-error-border` | Error banner border | `border-factory-error-border` |
| `--color-factory-error-text` | Error banner text | `text-factory-error-text` |
| `--color-factory-warning-surface` | Warning banner bg | `bg-factory-warning-surface` |
| `--color-factory-warning-border` | Warning banner border | `border-factory-warning-border` |
| `--color-factory-warning-text` | Warning banner text | `text-factory-warning-text` |

### Token Colors for Faction Identity

CRIME and FRAUD tokens have distinct colors throughout the UI (CRIME = red, FRAUD = amber). These are semantic -- users learn to associate color with faction. New tokens can formalize this:

| Token | Purpose | Replaces |
|-------|---------|----------|
| `--color-factory-crime` | CRIME faction color | `text-red-400` in RouteCard TOKEN_COLORS, TaxRatesCard, CarnageCard |
| `--color-factory-fraud` | FRAUD faction color | `text-amber-400` in same locations |
| `--color-factory-profit` | PROFIT token color | `text-green-400` in RouteCard TOKEN_COLORS |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js theme extension | @theme in globals.css (CSS-first) | Tailwind v4 (2025) | All tokens are CSS native, no JS config file |
| @apply for component classes | Raw CSS classes in globals.css | Project convention | Complex multi-property styles are more readable as raw CSS |
| Separate color mode toggle | Single dark theme | D7 decision | No dark/light mode system needed |

## Open Questions

1. **ConnectModal.tsx vs WalletStation.tsx overlap**
   - What we know: WalletStation.tsx is already themed and used in the modal system. ConnectModal.tsx is the old standalone modal with zinc-* styling.
   - What's unclear: Is ConnectModal.tsx still used anywhere, or has WalletStation.tsx fully replaced it?
   - Recommendation: Check if ConnectModal is imported anywhere. If only by the legacy swap/page.tsx, theme it minimally. If dead code, skip it. Either way, not a blocker.

2. **DashboardGrid and dashboard cards scope**
   - What we know: DashboardGrid.tsx is the dev-only dashboard. But CarnageCard, EpochCard, TaxRatesCard, and PoolCard are reused inside station modals (CarnageStation uses CarnageCard; trading terminal may use EpochCard/TaxRatesCard).
   - What's unclear: Are EpochCard, TaxRatesCard, and PoolCard used inside any modal station, or only in the dev-only DashboardGrid?
   - Recommendation: Theme ALL dashboard cards since CarnageCard is definitely used in CarnageStation, and the others may be composed into the trading terminal. The effort is the same either way.

3. **Chart color theming depth**
   - What we know: CandlestickChart has 8 hardcoded hex values for the chart theme. ChartControls has gray-* and indigo-* classes.
   - What's unclear: Should chart colors use CSS variable values read at runtime via `getComputedStyle()`, or should they be hardcoded hex values that happen to match the palette?
   - Recommendation: Hardcoded hex values matching the palette. Adding `getComputedStyle()` reads adds complexity for zero user benefit -- chart colors won't change at runtime.

## Sources

### Primary (HIGH confidence)
- **Tailwind CSS v4 @theme docs** - https://tailwindcss.com/docs/theme - Token definition, namespace conventions, @theme inline
- **WCAG 2.2 Contrast Minimum** - https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html - 4.5:1 AA threshold, large text exception
- **WebAIM Contrast Checker** - https://webaim.org/resources/contrastchecker/ - Reference thresholds
- **Codebase analysis** - Direct reading of 30+ component files, globals.css, layout.tsx, package.json

### Secondary (MEDIUM confidence)
- **WCAG contrast ratio JS algorithm** - https://dev.to/afsar_khan/how-i-built-a-wcag-contrast-checker-in-50-lines-of-javascript-1lo5 - Verified against W3C spec formula
- **Tailwind v4 custom color guide** - https://tailkits.com/blog/tailwind-v4-custom-colors/ - Confirms @theme namespace patterns

### Tertiary (LOW confidence)
- Steampunk UI visual references (game UI asset sites) - Inspirational only, no code patterns extracted

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Tailwind v4 @theme is already in place, no new dependencies needed
- Architecture: HIGH - Token system, CSS component class pattern, data-state pattern all established in codebase
- Pitfalls: HIGH - Based on direct codebase analysis of 197 gray/zinc occurrences across 26 files
- Code examples: MEDIUM - CSS patterns are sound but specific hex values for the refined palette need iteration during implementation

**Research date:** 2026-02-23
**Valid until:** 2026-03-25 (stable -- no moving dependencies)
