# Phase 58: Mobile Navigation - Research

**Researched:** 2026-02-24
**Domain:** Responsive mobile navigation with CSS-only animations, native `<dialog>` adaptation
**Confidence:** HIGH

## Summary

Phase 58 replaces the desktop-only fallback message (below 1024px) with a steampunk-themed vertical navigation list and full-screen slide-up modal adaptation. The existing codebase is exceptionally well-structured for this: `page.tsx` already has the `lg:hidden` / `hidden lg:block` split, the modal system (`ModalProvider` + `ModalShell` + `ModalContent`) is fully decoupled from the scene, and station metadata is centralized in `scene-data.ts`. Zero new npm dependencies are needed.

The primary technical challenges are: (1) making the existing `<dialog>`-based modal fullscreen on mobile with a slide-up animation instead of the iris-open clip-path, (2) building the mobile nav list component that calls `openModal()` with appropriate coordinates, and (3) adding a header with wallet connection status. All of this is achievable with CSS media queries and one new component.

**Primary recommendation:** Build a `MobileNav` component that renders inside the existing `lg:hidden` block in `page.tsx`. Use CSS `@media (width < 64rem)` overrides on `dialog.modal-shell` to make modals fullscreen with slide-up animation. The existing `ModalProvider`/`useModal()` API is used as-is -- mobile nav buttons just call `openModal()` like desktop `SceneStation` buttons do.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.1.18 | Responsive utilities (`lg:hidden`, `hidden lg:block`) | Already in project, `lg:` breakpoint = 1024px matches requirement exactly |
| Native `<dialog>` | N/A | Modal rendering (fullscreen on mobile via CSS override) | Already the modal implementation; no new dependency |
| CSS `@keyframes` | N/A | Slide-up animation for mobile modal | Project policy: CSS-only animations (D10), compositor-only properties (transform, opacity) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next/image` | 16.1.6 | Header illustration (static factory scene teaser) | Already in project for all scene images |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS @media on dialog | Separate MobileModalShell component | Avoids touching ModalShell.tsx but duplicates logic; CSS override is simpler since all animation/sizing is CSS already |
| JS matchMedia for breakpoint detection | CSS media queries only | JS would be needed if we wanted different React component trees above/below 1024px; but `hidden lg:block` / `lg:hidden` handles this in pure CSS already |
| Framer Motion for slide-up | CSS @keyframes | D10 policy: zero animation dependencies. CSS transform translateY is compositor-only (60fps guaranteed) |

**Installation:**
```bash
# No new packages needed. Zero-dependency implementation.
```

## Architecture Patterns

### Recommended Project Structure

```
app/
├── components/
│   ├── mobile/
│   │   └── MobileNav.tsx         # NEW: vertical nav list + header
│   ├── modal/
│   │   ├── ModalProvider.tsx      # UNCHANGED
│   │   ├── ModalShell.tsx         # MINOR: add mobile close button variant
│   │   ├── ModalContent.tsx       # UNCHANGED
│   │   └── ModalCloseButton.tsx   # UNCHANGED (or extend for back-arrow)
│   └── scene/
│       └── scene-data.ts          # UNCHANGED (mobile reuses STATIONS array)
├── app/
│   ├── page.tsx                   # MODIFY: replace fallback with MobileNav
│   └── globals.css                # ADD: mobile modal CSS + nav styles
```

### Pattern 1: CSS Media Query Override for Mobile Modal

**What:** Use `@media (width < 64rem)` to override `dialog.modal-shell` sizing and animation so that it becomes fullscreen with a slide-up transition instead of the iris-open clip-path.

**When to use:** Whenever the same `<dialog>` element needs different visual treatment at different viewport widths.

**Why this works:** The existing ModalShell is a singleton `<dialog>` that always exists in the DOM. Its sizing (`width: 90vw; max-height: 85vh; max-width: per-station`) and animation (`iris-open` clip-path) are all defined in CSS. A media query override changes these to `width: 100%; height: 100%; max-width: none; max-height: none` and swaps the animation.

**Example:**
```css
/* globals.css -- Mobile modal override */
@media (width < 64rem) {
  dialog.modal-shell {
    width: 100%;
    max-width: none;
    max-height: none;
    height: 100dvh;           /* dvh for mobile address bar safety */
    margin: 0;
    border-radius: 0;
  }

  .modal-chrome {
    border-radius: 0;
    max-height: 100dvh;
    height: 100%;
  }

  /* Replace iris-open with slide-up */
  dialog.modal-shell.iris-opening {
    animation: mobile-slide-up 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  /* Replace shrink-close with slide-down */
  dialog.modal-shell.closing {
    animation: mobile-slide-down 200ms ease-in forwards;
  }
}

@keyframes mobile-slide-up {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

@keyframes mobile-slide-down {
  from { transform: translateY(0); opacity: 1; }
  to   { transform: translateY(100%); opacity: 0; }
}
```

**Key insight:** Because ModalShell uses CSS class toggles (`iris-opening`, `closing`) driven by JS, swapping the animation per media query "just works" -- the JS logic is unchanged, only the CSS animation name changes.

### Pattern 2: Mobile Nav as useModal() Consumer

**What:** `MobileNav` imports `STATIONS` from `scene-data.ts` and calls `openModal(station.stationId, origin)` on tap, identical to how `SceneStation` does it on desktop.

**When to use:** Mobile entry points that open the same modal content as desktop.

**Example:**
```tsx
// MobileNav.tsx
import { STATIONS } from '@/components/scene/scene-data';
import { useModal } from '@/hooks/useModal';

// Mobile-specific station ordering (DeFi actions first)
const MOBILE_STATIONS = [
  STATIONS.find(s => s.stationId === 'swap')!,
  STATIONS.find(s => s.stationId === 'carnage')!,
  STATIONS.find(s => s.stationId === 'staking')!,
  STATIONS.find(s => s.stationId === 'wallet')!,
  STATIONS.find(s => s.stationId === 'docs')!,
  STATIONS.find(s => s.stationId === 'settings')!,
];

function MobileNavItem({ station }: { station: StationMeta }) {
  const { openModal } = useModal();

  const handleTap = (e: React.MouseEvent<HTMLButtonElement>) => {
    // For mobile slide-up, center-bottom origin makes thematic sense
    openModal(station.stationId, {
      x: window.innerWidth / 2,
      y: window.innerHeight,
    });
  };

  return (
    <button onClick={handleTap} className="mobile-nav-item">
      {/* Icon + label */}
    </button>
  );
}
```

**Note on IrisOrigin:** `openModal()` requires an `IrisOrigin { x, y }`. On mobile, the iris animation is replaced by slide-up via CSS media query, so the coordinates are unused. Passing `{ x: innerWidth/2, y: innerHeight }` (center-bottom) is a safe default that also works if the user resizes above 1024px while a modal is open.

### Pattern 3: Mobile Close Button (Back Arrow)

**What:** The CONTEXT.md decision specifies a top-left back arrow for mobile close (iOS convention), replacing the top-right brass X button used on desktop.

**When to use:** Mobile modal header.

**Implementation approach:** Add a `MobileCloseButton` component (or a `variant` prop on `ModalCloseButton`) that renders a left-pointing arrow SVG instead of the X. In `ModalShell`, conditionally render based on viewport or use CSS `hidden lg:block` / `lg:hidden` to show the appropriate button.

**Alternatively:** Use CSS media query to reposition the close button: `@media (width < 64rem) { .modal-close-btn { right: auto; left: 1rem; } }` and swap the SVG content. This approach avoids touching the React component tree.

**Recommended approach:** Since the SVG content changes (X vs arrow), use two elements with responsive visibility classes:
```tsx
// In ModalShell header
<ModalCloseButton onClick={closeModal} className="hidden lg:flex" />
<MobileBackButton onClick={closeModal} className="lg:hidden" />
```

### Pattern 4: Wallet Status Badge in Header

**What:** A small indicator in the mobile header showing connected/disconnected state.

**When to use:** Mobile header (CONTEXT.md: "Wallet connection status badge in the header corner").

**Implementation:** Use `useProtocolWallet()` hook (already exists) to read `{ connected, ready }` state. Render a small colored dot or badge:
- Connected: green dot + truncated address (or just green dot for minimal space)
- Disconnected: grey/amber dot
- Loading: pulse animation

This is lightweight -- no new hooks or providers needed.

### Anti-Patterns to Avoid

- **Duplicating ModalProvider for mobile:** The existing ModalProvider/ModalShell is viewport-agnostic. Do NOT create a separate mobile modal system. One `<dialog>`, one `ModalRoot`, CSS handles the visual difference.
- **JS-based breakpoint detection for show/hide:** Tailwind's `hidden lg:block` / `lg:hidden` handles all responsive visibility. Do NOT use `window.matchMedia()` in React state for this purpose (causes hydration mismatches and flash of wrong content on SSR).
- **Swipe-down dismiss:** CONTEXT.md explicitly prohibits swipe-down dismiss ("close via buttons only to avoid accidental dismissal while scrolling content"). Do NOT add touch gesture handlers for modal dismissal.
- **Fixed bottom tab bar:** The decision specifies a vertical list navigation, not a bottom tab bar. All 6 stations are visible in a scrollable list.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Responsive breakpoint detection | Custom `useMediaQuery()` hook | Tailwind `hidden lg:block` / `lg:hidden` CSS classes | Zero JS, no hydration issues, no flash of wrong content |
| Modal fullscreen on mobile | Separate MobileModalShell component | CSS `@media (width < 64rem)` override on existing `dialog.modal-shell` | Single dialog element, no duplication of sync logic |
| Slide-up animation | JavaScript-driven animation | CSS `@keyframes` with `transform: translateY()` | Compositor-only property, 60fps guaranteed, matches D10 policy |
| Touch target sizing | Custom padding heuristics | `min-h-[48px] min-w-[48px]` Tailwind utilities | Google Material Design 48dp standard, exceeds WCAG 2.2 Level AA (24px) |
| Station metadata | Duplicate station list for mobile | Import `STATIONS` from `scene-data.ts` and reorder | Single source of truth, no drift between desktop and mobile |

**Key insight:** The existing modal system (Phase 54) was built as a viewport-agnostic state machine (React context) + viewport-specific rendering (CSS). Mobile navigation is purely a new entry point (MobileNav component) and CSS overrides. The core modal logic is untouched.

## Common Pitfalls

### Pitfall 1: `100vh` on Mobile Safari

**What goes wrong:** `100vh` on iOS Safari includes the area behind the address bar, causing content to be hidden behind it. When the address bar collapses on scroll, `100vh` becomes the correct size, but on initial render it's too tall.

**Why it happens:** Safari's dynamic viewport behavior. The address bar occupies ~70-90px that `100vh` doesn't account for.

**How to avoid:** Use `100dvh` (dynamic viewport height) instead of `100vh`. This CSS unit was specifically designed for this problem. `dvh` adjusts dynamically as the address bar shows/hides.

**Warning signs:** Modal content cut off at the bottom on iOS Safari. Close button unreachable.

**Browser support:** `dvh` is supported in Safari 15.4+, Chrome 108+, Firefox 101+ -- well within the project's browser targets.

### Pitfall 2: Dialog `max-height` Browser Default

**What goes wrong:** Browsers apply `max-height: calc(100% - 2em - 6px)` to modal dialogs via user-agent styles. Even if you set `height: 100dvh`, the browser default creates a gap at the bottom.

**Why it happens:** User-agent stylesheet protection to keep dialog content accessible/scrollable.

**How to avoid:** Explicitly set `max-height: none` (or `max-height: 100dvh`) in the mobile CSS override.

**Warning signs:** Small gap at top/bottom of fullscreen mobile modal, dialog not truly fullscreen.

### Pitfall 3: Iris Animation Conflicting with Slide-Up on Resize

**What goes wrong:** If a user opens a modal on desktop (iris animation), then resizes below 1024px, the dialog may have leftover `clip-path` styles that conflict with the slide-up positioning.

**Why it happens:** The iris animation sets inline `clip-path` and CSS custom properties (`--iris-x`, `--iris-y`) via JavaScript.

**How to avoid:** The mobile CSS media query should include `clip-path: none !important` to override any inline clip-path styles. The `iris-opening` class animation override handles the class-based clip-path, but the inline style from ModalShell's JS needs explicit override.

**Warning signs:** Modal appears invisible (clipped to 0%) or partially clipped on mobile after resize.

### Pitfall 4: Body Scroll Lock + Mobile Keyboard

**What goes wrong:** `body.modal-open { overflow: hidden }` is already in place. On mobile, when a text input inside the modal receives focus and the virtual keyboard opens, the viewport shrinks. If the modal doesn't adjust, content may be hidden behind the keyboard.

**Why it happens:** iOS Safari and Chrome resize the visual viewport when the keyboard appears, but `dvh` doesn't account for the keyboard.

**How to avoid:** Ensure the modal body (`.modal-body`) uses `overflow-y: auto` (already does) so content remains scrollable within the modal even when the keyboard is open. The `dvh` unit handles address bar; the scrollable body handles keyboard.

**Warning signs:** Input fields hidden behind virtual keyboard in swap/staking modals on mobile.

### Pitfall 5: Tap Target Sizing Cascade

**What goes wrong:** A 48px minimum tap target on the nav list doesn't guarantee 48px targets inside modal content. Station components (SwapStation, StakingStation, etc.) were built for desktop mouse interaction.

**Why it happens:** Buttons, links, and inputs inside station panels may be smaller than 48px.

**How to avoid:** This is Phase 58's scope for the nav list only. Station content 48px audit should be a separate concern (noted as feature parity check). The CONTEXT.md says "minimum 48px tap targets throughout" -- the "throughout" likely means the mobile nav and modal chrome, not retroactively auditing all station panel content.

**Recommendation:** Apply 48px minimums to: mobile nav items, modal close button, modal header controls. Log station content tap-target audit as a follow-up.

### Pitfall 6: `dialog.modal-shell` Inline `maxWidth` Style

**What goes wrong:** ModalShell passes `style={{ maxWidth }}` directly on the `<dialog>` element (per-station: 500px-1100px). This inline style has higher specificity than a CSS class and will fight with the mobile `max-width: none` override.

**Why it happens:** The per-station maxWidth is set as an inline style in JSX, which CSS classes cannot override without `!important`.

**How to avoid:** Use `!important` on the mobile media query `max-width: none !important` (justified because inline styles can only be overridden this way), OR add a conditional in ModalShell that omits the inline style on mobile. The `!important` approach is simpler and doesn't require JS viewport detection.

**Warning signs:** Mobile modal has a max-width of 500-700px instead of spanning the full viewport width.

## Code Examples

### Mobile Fullscreen Dialog Override (CSS)
```css
/* Source: Project research -- no external library */
@media (width < 64rem) {
  /* Fullscreen dialog on mobile */
  dialog.modal-shell {
    width: 100%;
    max-width: none !important;  /* Override inline style={{ maxWidth }} */
    max-height: none;
    height: 100dvh;
    margin: 0;
    border-radius: 0;
    clip-path: none !important;  /* Override JS-set inline clip-path */
  }

  .modal-chrome {
    border-radius: 0;
    max-height: none;
    height: 100%;
    /* Remove corner bolts on mobile (too small to see, waste of DOM) */
  }

  .modal-bolt {
    display: none;
  }

  /* Slide-up open animation */
  dialog.modal-shell.iris-opening {
    animation: mobile-slide-up 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  /* Slide-down close animation */
  dialog.modal-shell.closing {
    animation: mobile-slide-down 200ms ease-in forwards;
  }

  /* Backdrop: simpler on mobile (no blur needed, saves GPU) */
  dialog.modal-shell[open]::backdrop {
    animation: backdrop-fade-in 200ms ease-out forwards;
  }
}

@keyframes mobile-slide-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes mobile-slide-down {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(100%);
    opacity: 0;
  }
}
```

### MobileNav Component Structure (TSX)
```tsx
// Source: Project architecture -- follows SceneStation pattern
'use client';

import Image from 'next/image';
import { useModal } from '@/hooks/useModal';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { STATIONS } from '@/components/scene/scene-data';
import type { StationMeta } from '@/components/scene/scene-data';

// Reorder stations for mobile: DeFi actions first, utility last
const MOBILE_ORDER: StationMeta[] = [
  STATIONS.find(s => s.stationId === 'swap')!,
  STATIONS.find(s => s.stationId === 'carnage')!,
  STATIONS.find(s => s.stationId === 'staking')!,
  STATIONS.find(s => s.stationId === 'wallet')!,
  STATIONS.find(s => s.stationId === 'docs')!,
  STATIONS.find(s => s.stationId === 'settings')!,
];

export function MobileNav() {
  const { connected } = useProtocolWallet();

  return (
    <div className="min-h-screen bg-factory-bg flex flex-col">
      {/* Fixed header with scene teaser + wallet status */}
      <header className="mobile-header">
        {/* Scene teaser image */}
        <div className="relative h-[120px] overflow-hidden">
          <Image
            src="/scene/background/factory-bg-1920.webp"
            alt=""
            fill
            className="object-cover object-center"
            quality={75}
          />
          {/* Gradient fade at bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-factory-bg" />
          {/* Wallet status badge */}
          <div className="absolute top-3 right-3">
            <span className={`inline-block w-3 h-3 rounded-full ${
              connected ? 'bg-factory-success' : 'bg-factory-text-muted'
            }`} />
          </div>
        </div>
      </header>

      {/* Station list */}
      <nav className="flex-1 px-4 py-2">
        {MOBILE_ORDER.map(station => (
          <MobileNavItem key={station.stationId} station={station} />
        ))}
      </nav>
    </div>
  );
}

function MobileNavItem({ station }: { station: StationMeta }) {
  const { openModal } = useModal();

  return (
    <button
      type="button"
      onClick={() => openModal(station.stationId, {
        x: window.innerWidth / 2,
        y: window.innerHeight,
      })}
      className="mobile-nav-item"
    >
      {/* Icon placeholder + station label */}
      <span className="mobile-nav-icon">{/* SVG icon */}</span>
      <span className="mobile-nav-label">{station.label}</span>
    </button>
  );
}
```

### Mobile Back Button (Close) Component
```tsx
// Source: CONTEXT.md decision -- iOS convention top-left back arrow
interface MobileBackButtonProps {
  onClick: () => void;
}

export function MobileBackButton({ onClick }: MobileBackButtonProps) {
  return (
    <button
      type="button"
      className="mobile-back-btn"
      onClick={onClick}
      aria-label="Close"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M12 4L6 10L12 16"
          stroke="#2a1f0e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
```

### page.tsx Integration
```tsx
// Source: Existing page.tsx pattern -- replace fallback with MobileNav
export default function Home() {
  return (
    <>
      {/* Desktop scene: visible at lg (1024px) and above */}
      <main className="hidden lg:block">
        <FactoryBackground>
          <FactoryOverlay overlayId="banner" />
          {STATIONS.map((station) => (
            <SceneStation key={station.stationId} station={station} />
          ))}
        </FactoryBackground>
      </main>

      {/* Mobile navigation: visible below lg (1024px) */}
      <main className="lg:hidden">
        <MobileNav />
      </main>
    </>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `100vh` for fullscreen mobile | `100dvh` (dynamic viewport height) | CSS spec 2022, baseline 2023 | Accounts for iOS Safari address bar |
| JS matchMedia for responsive React | CSS `hidden lg:block` / `lg:hidden` | Always preferred, but SSR concerns drove JS solutions | CSS-only means no hydration mismatch risk |
| Custom slide animation libraries | CSS `@keyframes` + `transform: translateY()` | Always possible, but frameworks popularized | Compositor-only = 60fps, zero-dependency |
| `@starting-style` for dialog animations | `@keyframes` via class toggle | 2024-2025 (Chrome, Safari; Firefox partial) | `@starting-style` not universally supported yet; class toggle pattern used by this project works everywhere |

**Deprecated/outdated:**
- `vh` units on mobile: Use `dvh` or `svh` instead. `vh` doesn't account for mobile browser chrome (address bar).
- JS-driven viewport detection for responsive layout: Use CSS media queries. JS solutions cause hydration mismatches in Next.js SSR.

## Open Questions

1. **Header Image Treatment**
   - What we know: CONTEXT.md says "Claude's Discretion: image treatment (cropped factory scene vs logo lockup)". Available assets include `/scene/background/factory-bg-1920.webp` (the full factory scene) and `/scene/overlays/banner.webp` (the title banner).
   - What's unclear: Whether to use a cropped version of the full scene, the banner overlay, or a combination. No mobile-specific image assets exist.
   - Recommendation: Use the full background image (`factory-bg-1920.webp`) with `object-cover object-center` at 120px height, with a gradient fade to `factory-bg` at the bottom. This gives the "factory glimpse" effect without requiring new assets. The banner overlay could optionally be composited on top. This is within Claude's discretion.

2. **Station Icons for Mobile Nav**
   - What we know: CONTEXT.md says "Claude's Discretion: Exact icon choices for each station in the mobile list." No icon set exists in the project currently.
   - What's unclear: Whether to use inline SVGs (zero-dependency, matches project philosophy), or small raster crops from overlay images.
   - Recommendation: Inline SVGs matching the steampunk aesthetic. 6 simple icons: swap arrows, cauldron, staking/vat, wallet, document, gear. CSS-styled to match `factory-accent` color. This is within Claude's discretion.

3. **ModalShell Header Adaptation for Mobile Back Button**
   - What we know: Desktop has a right-aligned X close button in `.modal-header`. Mobile needs a left-aligned back arrow.
   - What's unclear: Whether to modify `ModalShell.tsx` to render both buttons with responsive visibility, or handle it purely in CSS (reposition + SVG swap via media query).
   - Recommendation: Render both buttons in ModalShell with `hidden lg:flex` / `lg:hidden` responsive classes. This is the cleanest approach -- both buttons exist in the DOM but only one is visible at any viewport width. The back arrow button should be positioned before the `<h2>` in the header for correct visual order (left-to-right: back arrow, title).

## Sources

### Primary (HIGH confidence)
- **Project codebase** (direct file reads): `page.tsx`, `ModalProvider.tsx`, `ModalShell.tsx`, `ModalContent.tsx`, `ModalCloseButton.tsx`, `SceneStation.tsx`, `scene-data.ts`, `globals.css`, `providers.tsx`, `useModal.ts`, `useProtocolWallet.ts`, `package.json`, `image-data.ts`, `WalletButton.tsx`, `WalletStation.tsx`, `useVisibility.ts`, `FactoryBackground.tsx`, `next.config.ts`, `fonts.ts`
- **Tailwind CSS v4 responsive design docs** (WebFetch) -- confirmed `lg:` = 1024px, `hidden lg:block` pattern, `@theme` breakpoint customization
- **CONTEXT.md** (Phase 58 decisions) -- locked decisions on layout, modal behavior, breakpoint, ordering

### Secondary (MEDIUM confidence)
- **Simon Willison TIL: dialog full height** (WebFetch) -- confirmed `max-height` browser default gotcha, `max-height: none` fix
- **Frontend Masters: Animating Dialog** (WebFetch) -- confirmed `@keyframes` approach works cross-browser for dialog animations; `@starting-style` not yet universal
- **WCAG 2.2 / Material Design touch targets** (WebSearch) -- confirmed 48px = Google Material Design recommendation, exceeds WCAG 2.2 Level AA minimum of 24px
- **iOS Safari dvh support** (WebSearch) -- confirmed `dvh` supported Safari 15.4+

### Tertiary (LOW confidence)
- **iOS 26 Safari fullscreen** (WebSearch) -- noted fullscreen API improvements but not directly relevant to this phase (dialog modal, not fullscreen API)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all patterns verified in existing codebase
- Architecture: HIGH -- direct codebase inspection confirms ModalProvider is viewport-agnostic, CSS override is the correct seam
- Pitfalls: HIGH -- `dvh` vs `vh`, dialog max-height default, inline style specificity all verified with authoritative sources

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable -- no fast-moving dependencies, all CSS/HTML standards)
