# Phase 54: Modal System - Research

**Researched:** 2026-02-22
**Domain:** HTML `<dialog>` element, CSS clip-path animations, focus management, steampunk-themed UI chrome
**Confidence:** HIGH

## Summary

This phase builds a reusable, accessible modal system using the native HTML `<dialog>` element with CSS-only animations (no Framer Motion/GSAP per D10). The `<dialog>` element provides enormous built-in value: automatic focus management, Escape key handling, `::backdrop` pseudo-element, top-layer rendering (no z-index wars), and `inert` on background content -- all for free. The iris-open animation uses CSS `clip-path: circle()` with CSS custom properties to originate from the clicked scene object's position. Close animations use a simpler fade+scale via CSS keyframe animations (more cross-browser than `@starting-style` transitions for exit).

The steampunk chrome is built entirely with CSS (gradients, box-shadows, borders, pseudo-elements) per CONTEXT.md decisions. No new npm dependencies are needed -- this is pure React 19 + HTML `<dialog>` + CSS.

**Primary recommendation:** Use the native `<dialog>` element with `showModal()` as the modal foundation. Use CSS `@keyframes` animations (not `@starting-style` transitions) for open/close to ensure cross-browser exit animations work. Use CSS custom properties (`--iris-x`, `--iris-y`) set via JavaScript `getBoundingClientRect()` to position the iris clip-path origin at the clicked scene object.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| HTML `<dialog>` | Native | Modal container | Built-in focus management, Escape key, backdrop, top-layer, inert. No library needed |
| CSS `clip-path: circle()` | Native | Iris open animation | Hardware-accelerated, animatable, resolution-independent. Baseline since Jan 2020 |
| CSS `@keyframes` | Native | Entry/exit animations | Cross-browser, works with `<dialog>`, no `@starting-style`/`allow-discrete` dependency |
| React 19 `useRef` | 19.2.3 | Dialog DOM access | Call `showModal()`/`close()` imperatively |
| React 19 Context | 19.2.3 | Modal state management | Single-modal policy, station tracking, click origin coordinates |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS | 4.1.18 | Utility classes for modal layout | Backdrop, sizing, positioning, scrolling, responsiveness |
| CSS custom properties | Native | Dynamic iris origin | Set `--iris-x`, `--iris-y` from JS click position |
| `scrollbar-width` / `scrollbar-color` | Native CSS | Themed scrollbar in modal body | Baseline since Feb 2025. Use for steampunk-colored scrollbar |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `<dialog>` | `<div>` with manual ARIA | `<dialog>` gives free focus management, backdrop, Escape, top-layer. No reason to use div |
| `@keyframes` animations | `@starting-style` + `allow-discrete` transitions | `@starting-style` is elegant but exit animations require `overlay` property (Chromium-only, ~73% support). `@keyframes` works everywhere |
| Custom focus trap JS | Native `<dialog>` behavior | `<dialog>.showModal()` automatically makes outside content inert. W3C APA concluded no manual focus trap needed |
| Framer Motion / GSAP | CSS-only | D10 decision locks us to zero new dependencies for visual layer |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── components/
│   └── modal/
│       ├── ModalProvider.tsx      # React Context for modal state
│       ├── ModalShell.tsx         # <dialog> wrapper with chrome, animations, accessibility
│       └── ModalCloseButton.tsx   # Brass valve close button component
├── hooks/
│   └── useModal.ts               # Hook to open/close modals from any component
└── app/
    └── globals.css               # New @keyframes + modal animation tokens
```

### Pattern 1: Native `<dialog>` with React Context (Modal State Management)

**What:** A React Context provider manages which modal is open, enforces single-modal policy, and passes click origin coordinates for the iris animation.

**When to use:** Always -- this is the core modal system.

**Example:**
```typescript
// Source: MDN <dialog> docs + React patterns
type StationId = 'swap' | 'staking' | 'carnage' | 'how-it-works' | 'settings' | 'wallet';

interface ModalState {
  activeStation: StationId | null;
  irisOrigin: { x: number; y: number } | null;
}

interface ModalContextValue {
  state: ModalState;
  openModal: (station: StationId, clickOrigin: { x: number; y: number }) => void;
  closeModal: () => void;
}

// Single-modal policy: openModal() closes any existing modal first
function openModal(station: StationId, clickOrigin: { x: number; y: number }) {
  setState({ activeStation: station, irisOrigin: clickOrigin });
}
```

### Pattern 2: Iris Open Animation with CSS clip-path + Custom Properties

**What:** The modal opens with a `clip-path: circle()` animation expanding from the clicked scene object's position. JavaScript calculates the position via `getBoundingClientRect()` and sets CSS custom properties on the dialog element.

**When to use:** Every modal open.

**Example:**
```typescript
// Source: CSS-Tricks "Animating with Clip-Path" + MDN clip-path docs
// On scene object click:
const rect = clickedElement.getBoundingClientRect();
const x = rect.left + rect.width / 2;
const y = rect.top + rect.height / 2;

// Set CSS custom properties on dialog element
dialogRef.current.style.setProperty('--iris-x', `${x}px`);
dialogRef.current.style.setProperty('--iris-y', `${y}px`);
dialogRef.current.showModal();
```

```css
/* Iris open animation using clip-path: circle() */
@keyframes iris-open {
  from {
    clip-path: circle(0% at var(--iris-x) var(--iris-y));
    opacity: 0.5;
  }
  to {
    clip-path: circle(150% at var(--iris-x) var(--iris-y));
    opacity: 1;
  }
}

dialog[open] {
  animation: iris-open 280ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
```

### Pattern 3: Close Animation with CSS Keyframes (Cross-Browser)

**What:** Close animation uses `@keyframes` with fade + scale-down. Since `overlay` property is Chromium-only (~73% support) and `@starting-style` exit animations aren't baseline, we use a JS-assisted approach: add a `closing` class, wait for `animationend`, then call `dialog.close()`.

**When to use:** Every modal close.

**Example:**
```typescript
// Source: Frontend Masters "Animating the Dialog Element"
function closeModal() {
  const dialog = dialogRef.current;
  if (!dialog) return;

  dialog.classList.add('closing');
  dialog.addEventListener('animationend', () => {
    dialog.classList.remove('closing');
    dialog.close();
    // Return focus to trigger element
    triggerRef.current?.focus();
  }, { once: true });
}
```

```css
@keyframes modal-close {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

dialog.closing {
  animation: modal-close 180ms ease-in forwards;
}

/* Backdrop fade-out matches close duration */
dialog.closing::backdrop {
  animation: backdrop-fade-out 180ms ease-in forwards;
}
```

### Pattern 4: Backdrop Click Detection for `<dialog>`

**What:** The `<dialog>` element does not natively close on backdrop click. The `closedby="any"` attribute handles this but lacks Safari support (~70% global). Use a JS fallback: listen for `click` on the dialog element itself and check if the click target is the dialog (not its children).

**When to use:** Always as fallback alongside `closedby`.

**Example:**
```typescript
// Source: MDN <dialog> docs, gomakethings.com
function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
  // When clicking the backdrop, the event target is the dialog itself
  // When clicking content inside, target is a child element
  if (e.target === e.currentTarget) {
    closeModal();
  }
}

// In JSX:
<dialog ref={dialogRef} onClick={handleDialogClick} closedBy="any">
  <div className="modal-content">
    {/* Content here -- clicks don't propagate to dialog */}
  </div>
</dialog>
```

### Pattern 5: Station-Specific Sizing

**What:** Each station specifies its own optimal width via a prop. The modal shell applies it as a CSS variable or inline style.

**When to use:** Every modal render.

**Example:**
```typescript
// Source: CONTEXT.md decisions
interface ModalShellProps {
  stationId: StationId;
  maxWidth?: string;  // e.g., '1100px' for swap, '500px' for settings
  children: React.ReactNode;
}

// The shell applies: style={{ maxWidth: maxWidth || '600px' }}
```

### Anti-Patterns to Avoid

- **DIV-based modals with manual ARIA:** `<dialog>.showModal()` provides `aria-modal="true"`, inert background, top-layer positioning, and Escape handling for free. Never rebuild this manually.
- **Manual focus trap with JS:** `<dialog>.showModal()` already makes outside content inert via the browser. The W3C APA confirmed no additional focus trapping is needed. Do NOT add a focus-trap library.
- **`z-index` layering for modals:** `<dialog>` renders in the top layer, above all z-index stacking contexts. The `z-modal` token in globals.css is a fallback for non-dialog modal scenarios only.
- **Removing default `outline` on `:focus`:** Never `outline: none` without replacement. Use `:focus-visible` with a glow-styled outline instead.
- **`@starting-style` for exit animations:** Entry animations work cross-browser, but exit requires `overlay` property (Chromium-only). Use `@keyframes` + JS class toggle for exit.
- **Body scroll lock via `overflow: hidden`:** `<dialog>.showModal()` does NOT automatically prevent body scroll in all browsers. Add `body.modal-open { overflow: hidden; }` class when modal opens.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Focus management | Custom focus trap with `querySelectorAll('[tabindex]')` | `<dialog>.showModal()` | Browser makes outside content inert automatically. W3C endorsed |
| Escape key handler | `document.addEventListener('keydown')` checking Escape | `<dialog>` built-in | `<dialog>` fires `cancel` event on Escape automatically |
| Backdrop overlay | Custom `<div>` with z-index stacking | `<dialog>::backdrop` | Native pseudo-element, styled via CSS, no DOM element needed |
| Top-layer rendering | Complex z-index management | `<dialog>` top layer | Renders above ALL z-index contexts, no stacking issues |
| Scroll lock | Custom `overflow: hidden` + scroll position save/restore | `body.modal-open` class | Simple class toggle; `<dialog>` handles accessibility |
| Scrollbar styling | Custom scrollbar library | `scrollbar-width: thin; scrollbar-color: thumb track;` | CSS standard, baseline since Feb 2025, no JS needed |

**Key insight:** The `<dialog>` element eliminates 80% of the code that modal libraries exist to solve. The remaining 20% is: (1) close animation timing, (2) backdrop click handling (for Safari), (3) custom visual chrome, and (4) click-origin iris animation. All solvable with small amounts of CSS + JS.

## Common Pitfalls

### Pitfall 1: Exit Animation Disappears Instantly
**What goes wrong:** Dialog vanishes immediately when `close()` is called, without playing the exit animation.
**Why it happens:** `close()` removes the `open` attribute and the element from the top layer synchronously. CSS transitions/animations don't have time to run.
**How to avoid:** Add a `closing` class, listen for `animationend`, then call `close()` in the callback. This gives CSS time to animate before removal.
**Warning signs:** Close animation never appears; dialog blinks out.

### Pitfall 2: `clip-path: circle()` Position Uses Wrong Coordinates
**What goes wrong:** Iris animation appears to originate from the wrong position (usually top-left corner or center of viewport instead of the clicked element).
**Why it happens:** `getBoundingClientRect()` returns viewport-relative coordinates, but `clip-path` positions are relative to the element's own coordinate space. The dialog may have padding, margins, or transforms that offset the coordinate system.
**How to avoid:** Since the `<dialog>` in modal mode is full-viewport (positioned `fixed` by the browser), viewport coordinates from `getBoundingClientRect()` can be used directly as the iris origin -- just ensure the dialog has no padding/margin on the outer element. Apply padding on the inner content wrapper instead.
**Warning signs:** Iris circle opens from top-left (0, 0) instead of clicked element position.

### Pitfall 3: Double-Fire on Dialog Cancel Event
**What goes wrong:** Pressing Escape fires both the native `cancel` event and any custom Escape handler, causing double-close behavior or state inconsistencies.
**Why it happens:** `<dialog>` fires a `cancel` event on Escape. If you also have a `keydown` listener checking for Escape, you get two handlers.
**How to avoid:** Use the dialog's native `cancel` event exclusively. Remove any manual Escape key listeners. Handle close logic in a single `onClose`/`onCancel` handler.
**Warning signs:** Modal state gets out of sync, animations fire twice.

### Pitfall 4: Body Scroll Not Locked
**What goes wrong:** Content behind the modal scrolls when user scrolls within or near the modal.
**Why it happens:** `<dialog>.showModal()` makes background content inert (no clicks, no focus) but does NOT prevent scroll events from reaching the body in all browsers.
**How to avoid:** Toggle `overflow: hidden` on `<body>` when modal opens/closes. Save and restore the scroll position.
**Warning signs:** Background page jumps or scrolls while modal is open.

### Pitfall 5: CSS `clip-path` Animation Jank
**What goes wrong:** Iris animation stutters or drops frames.
**Why it happens:** `clip-path` is animatable but is NOT a compositor-only property (unlike `transform` and `opacity`). It triggers paint operations. Complex page backgrounds behind the dialog can amplify paint cost.
**How to avoid:** Keep animation duration short (200-300ms per spec). Use `will-change: clip-path` on the dialog during animation (remove after). The `::backdrop` blur helps by simplifying what's behind the dialog.
**Warning signs:** Visible stutter on lower-end devices during iris open.

### Pitfall 6: Focus Indicator Removed Globally
**What goes wrong:** Keyboard users cannot see which element is focused.
**Why it happens:** Developer adds `outline: none` to remove browser's default blue ring without adding a custom focus-visible style.
**How to avoid:** A11Y-02 requires visible `:focus-visible` indicators. Style them with a glow matching the steampunk aesthetic (e.g., `box-shadow: 0 0 0 2px var(--color-factory-glow)`). Never remove without replacement.
**Warning signs:** Tab key moves focus but nothing visual changes.

### Pitfall 7: Station Switch Causes Flash
**What goes wrong:** Switching between stations briefly shows the scene behind both modals.
**Why it happens:** Closing one dialog and opening another creates a gap where no dialog is in the top layer.
**How to avoid:** Use a crossfade approach: keep the dialog element open, swap the content inside it with a CSS crossfade transition (~300ms). Do NOT close and reopen the dialog for station switches.
**Warning signs:** Brief flash of factory scene between modals.

## Code Examples

Verified patterns from official sources:

### Native Dialog with React (Open/Close Sync)
```typescript
// Source: MDN HTMLDialogElement, React 19 useRef
'use client';

import { useRef, useEffect, useCallback } from 'react';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  irisOrigin: { x: number; y: number } | null;
  children: React.ReactNode;
}

export function ModalShell({ isOpen, onClose, irisOrigin, children }: ModalShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync React state -> dialog DOM
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      // Set iris origin before opening
      if (irisOrigin) {
        dialog.style.setProperty('--iris-x', `${irisOrigin.x}px`);
        dialog.style.setProperty('--iris-y', `${irisOrigin.y}px`);
      }
      dialog.showModal();
      document.body.classList.add('modal-open');
    }
  }, [isOpen, irisOrigin]);

  // Handle native cancel event (Escape key)
  const handleCancel = useCallback((e: Event) => {
    e.preventDefault(); // Prevent instant close, let animation play
    onClose();
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [handleCancel]);

  // Animated close
  const handleClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open) return;

    dialog.classList.add('closing');
    dialog.addEventListener('animationend', () => {
      dialog.classList.remove('closing');
      dialog.close();
      document.body.classList.remove('modal-open');
    }, { once: true });
  }, []);

  // Wire onClose to animated close
  useEffect(() => {
    if (!isOpen) {
      handleClose();
    }
  }, [isOpen, handleClose]);

  // Backdrop click detection
  const handleDialogClick = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-shell"
      onClick={handleDialogClick}
    >
      <div className="modal-chrome">
        {children}
      </div>
    </dialog>
  );
}
```

### Steampunk Chrome CSS (Brass Frame with Rivets)
```css
/* Source: CONTEXT.md decisions -- CSS-only brass frame */
.modal-chrome {
  /* Layered surface: dark metal outer frame + aged paper content */
  background:
    /* Inner parchment */
    linear-gradient(135deg, #f5e6c8 0%, #e8d5a8 50%, #f0dbb8 100%);
  border: 3px solid var(--color-factory-accent);
  border-radius: 8px;
  box-shadow:
    /* Outer metal frame shadow */
    0 0 0 6px var(--color-factory-surface-elevated),
    0 0 0 8px var(--color-factory-accent),
    /* Ambient glow */
    0 0 40px rgba(240, 192, 80, 0.15),
    /* Drop shadow */
    0 16px 48px rgba(0, 0, 0, 0.5);
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Fixed header with brass divider */
.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 2px solid var(--color-factory-accent);
  /* Slight bevel on the divider */
  box-shadow: 0 1px 0 rgba(240, 192, 80, 0.3);
  flex-shrink: 0;
}

/* Scrollable body */
.modal-body {
  overflow-y: auto;
  flex: 1;
  padding: 1.5rem;
  scrollbar-width: thin;
  scrollbar-color: var(--color-factory-secondary) var(--color-factory-surface);
}
```

### Focus-Visible Glow Indicator (A11Y-02)
```css
/* Source: MDN :focus-visible docs */
/* Steampunk glow focus indicator for all interactive elements within modals */
dialog :focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-factory-glow),
              0 0 8px rgba(240, 192, 80, 0.4);
  border-radius: 4px;
}
```

### Iris Animation Keyframes
```css
/* Source: CSS-Tricks "Animating with Clip-Path", MDN clip-path docs */
@keyframes iris-open {
  from {
    clip-path: circle(0% at var(--iris-x, 50%) var(--iris-y, 50%));
  }
  to {
    clip-path: circle(150% at var(--iris-x, 50%) var(--iris-y, 50%));
  }
}

@keyframes modal-close {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

@keyframes backdrop-fade-in {
  from { background-color: transparent; backdrop-filter: blur(0); }
  to { background-color: rgba(0, 0, 0, 0.4); backdrop-filter: blur(6px); }
}

@keyframes backdrop-fade-out {
  from { background-color: rgba(0, 0, 0, 0.4); backdrop-filter: blur(6px); }
  to { background-color: transparent; backdrop-filter: blur(0); }
}

/* Applied states */
dialog[open] {
  animation: iris-open 280ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

dialog[open]::backdrop {
  animation: backdrop-fade-in 280ms ease-out forwards;
}

dialog.closing {
  animation: modal-close 180ms ease-in forwards;
}

dialog.closing::backdrop {
  animation: backdrop-fade-out 180ms ease-in forwards;
}

/* Body scroll lock */
body.modal-open {
  overflow: hidden;
}
```

### Station Crossfade (No Dialog Close/Reopen)
```css
/* Source: CONTEXT.md -- crossfade for station switching */
@keyframes content-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes content-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content-enter {
  animation: content-fade-in 200ms ease-out forwards;
}

.modal-content-exit {
  animation: content-fade-out 150ms ease-in forwards;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `<div>` + `role="dialog"` + manual ARIA | `<dialog>.showModal()` | Baseline March 2022 | Free focus management, backdrop, Escape, inert, top-layer |
| Custom focus trap (`focus-trap` library) | `<dialog>` native inert behavior | W3C APA ruling, 2023 | No focus trap library needed |
| `@starting-style` + `allow-discrete` | `@keyframes` for entry/exit | `@starting-style` baseline Aug 2024, `overlay` NOT baseline | `@keyframes` approach works everywhere; `@starting-style` entry-only works but exit needs `overlay` (Chromium-only) |
| `::-webkit-scrollbar` | `scrollbar-width` + `scrollbar-color` | Baseline Feb 2025 | Cross-browser standard, no prefixes |
| `:focus` outline styling | `:focus-visible` | Baseline March 2022 | Shows ring on keyboard nav only, not mouse clicks |
| `closedby="any"` for light dismiss | JS fallback click detection | Chrome 134 (Mar 2025), no Safari | Use JS fallback for Safari compatibility |

**Deprecated/outdated:**
- **`focus-trap` npm package for `<dialog>` modals**: Not needed. The browser handles this natively.
- **`::-webkit-scrollbar` pseudo-elements**: Being superseded by `scrollbar-width`/`scrollbar-color` (now baseline). Keep webkit fallback only for Safari <26.2.
- **`z-index` management for modals**: `<dialog>` top layer makes this irrelevant.

## Open Questions

Things that couldn't be fully resolved:

1. **`clip-path` animation performance on low-end mobile**
   - What we know: `clip-path` IS animatable and hardware-accelerated in modern browsers. CSS-Tricks confirms clean interpolation. Short durations (200-300ms) mitigate jank.
   - What's unclear: Exact paint cost on budget Android devices with complex factory background behind the backdrop blur.
   - Recommendation: Implement with `will-change: clip-path` during animation. Add `@media (prefers-reduced-motion: reduce)` fallback that uses simple fade instead of iris. Test on real devices.

2. **`::backdrop` animation behavior across browsers**
   - What we know: `::backdrop` supports CSS animations in all modern browsers. Chrome/Edge handle it well. Firefox supports `@starting-style` since v129.
   - What's unclear: Whether `::backdrop` `backdrop-filter: blur()` animates smoothly in Firefox and Safari or causes jank.
   - Recommendation: Test backdrop blur animation. If it jitters, use static blur (no animation) and only animate the opacity dimming.

3. **Station crossfade without closing dialog**
   - What we know: We should NOT close+reopen the dialog for station switching (causes scene flash). Instead swap content with CSS crossfade.
   - What's unclear: Whether React content unmount/remount during crossfade causes layout flicker if new station content has different height.
   - Recommendation: During crossfade, set a minimum height on the modal body equal to the outgoing content's height. After fade-in completes, remove the min-height.

4. **ConnectModal integration**
   - What we know: The existing `ConnectModal` (app/components/wallet/ConnectModal.tsx) is a standalone div-based modal with its own Escape handling and backdrop.
   - What's unclear: Should ConnectModal be migrated into the new modal system immediately, or left as-is for Phase 54?
   - Recommendation: Ask the user. The wallet connection flow is special (opens Privy's own modal after). It could remain separate or be wrapped in the new ModalShell for visual consistency. Either way, Phase 54 should not break the existing ConnectModal.

## Sources

### Primary (HIGH confidence)
- [MDN `<dialog>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) - Built-in features, showModal(), backdrop, focus management, closedby attribute
- [MDN `clip-path`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/clip-path) - circle() function, animatability, browser support (Baseline Jan 2020)
- [MDN `@starting-style`](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style) - Entry animation capability, browser support (Baseline Aug 2024)
- [MDN `:focus-visible`](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible) - Smart focus indicators, browser support (Baseline March 2022)
- [MDN `inert` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert) - Focus and interaction blocking, browser support (Baseline April 2023)
- [MDN `overlay` property](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overlay) - Top-layer retention for exit animations, Chromium-only (~73%)
- [MDN CSS scrollbar styling](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scrollbars_styling) - `scrollbar-width`, `scrollbar-color` (Baseline Feb 2025)

### Secondary (MEDIUM confidence)
- [CSS-Tricks "Animating with Clip-Path"](https://css-tricks.com/animating-with-clip-path/) - circle() animation patterns, keyframe examples
- [CSS-Tricks "No Need to Trap Focus on Dialog"](https://css-tricks.com/there-is-no-need-to-trap-focus-on-a-dialog-element/) - W3C APA ruling on dialog focus behavior
- [Frontend Masters "Animating the Dialog Element"](https://frontendmasters.com/blog/animating-dialog/) - Entry/exit animation approaches, @keyframes vs @starting-style tradeoffs
- [Frontend Masters "Dialog with Entry and Exit Animations"](https://frontendmasters.com/blog/the-dialog-element-with-entry-and-exit-animations/) - Complete CSS patterns for dialog animation
- [Smashing Magazine "Transitioning Top-Layer Entries"](https://www.smashingmagazine.com/2025/01/transitioning-top-layer-entries-display-property-css/) - Firefox support notes, allow-discrete behavior
- [web.dev "Baseline Entry Animations"](https://web.dev/blog/baseline-entry-animations) - @starting-style + allow-discrete baseline status (Aug 2024)
- [Can I Use `@starting-style`](https://caniuse.com/mdn-css_at-rules_starting-style) - 86.62% global support
- [Can I Use `overlay`](https://caniuse.com/mdn-css_properties_overlay) - 72.92% global support (Chromium-only, no Firefox/Safari)
- [Can I Use `closedby`](https://caniuse.com/mdn-html_elements_dialog_closedby) - 70.43% global support (no Safari)
- [gomakethings.com "Dismiss Dialog on Backdrop Click"](https://gomakethings.com/revisiting-how-to-dismiss-native-html-dialog-elements-when-the-backdrop-is-clicked/) - JS fallback pattern for Safari
- [SpaceJelly "React + HTML Dialog"](https://spacejelly.dev/posts/how-to-create-a-modal-in-react-with-html-dialog) - React useRef + useEffect pattern for dialog

### Tertiary (LOW confidence)
- [LogRocket "Animating Dialog with @starting-style"](https://blog.logrocket.com/animating-dialog-popover-elements-css-starting-style/) - @starting-style browser support assessment (may be stale)

### Project-Internal Sources
- `app/components/wallet/ConnectModal.tsx` - Existing modal pattern (div-based, manual Escape handling)
- `app/app/globals.css` - Existing @theme tokens, z-index system, animation keyframes, reduced-motion media query
- `app/components/scene/FactoryOverlay.tsx` - Overlay position metadata (percentage-based coordinates)
- `app/lib/image-data.ts` - SCENE_DATA with overlay positions (left%, top%, widthPct%, heightPct%)
- `docs/frontend-spec.md` - Planned modal structure, hotspot-to-modal mapping, component file layout
- `app/app/layout.tsx` - Font variable injection, Providers wrapper
- `app/providers/providers.tsx` - Current provider tree (PrivyProvider only -- ModalProvider will nest inside)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `<dialog>` is native HTML with extensive MDN documentation. No libraries needed. All CSS features are Baseline.
- Architecture: HIGH - React + `<dialog>` pattern is well-documented across MDN, CSS-Tricks, Frontend Masters. Iris animation with clip-path is proven technique.
- Pitfalls: HIGH - Exit animation timing is the #1 documented pain point; solution (`@keyframes` + `animationend` event) is well-established. Backdrop click workaround for Safari is documented.
- CSS animation approach: MEDIUM - `@keyframes` chosen over `@starting-style` for exit animation cross-browser safety. `@starting-style` would be cleaner but `overlay` property (needed for exit) is Chromium-only. Trade-off is a small amount of JS to manage close animation timing.
- `clip-path` iris animation: MEDIUM - Proven animatable, confirmed hardware-accelerated, but real-device performance with complex backgrounds behind backdrop blur is untested for this specific use case.

**Research date:** 2026-02-22
**Valid until:** 2026-04-22 (stable domain, native HTML/CSS, unlikely to change)
