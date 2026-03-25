# Phase 59: Onboarding - Research

**Researched:** 2026-02-24
**Domain:** Client-side welcome modal with localStorage persistence, native dialog, Privy wallet trigger
**Confidence:** HIGH

## Summary

Phase 59 is a self-contained feature: a welcome modal shown to first-time visitors that persists dismissal via localStorage. The codebase already has a mature modal system (ModalProvider + ModalShell + ModalRoot), but the welcome modal is architecturally distinct from station modals. Station modals are part of a singleton dialog system tied to StationId state and iris/slide animations. The welcome modal is an independent, one-shot gate that should have its own dedicated `<dialog>` element rather than being shoehorned into the existing station modal flow.

The implementation touches three concerns: (1) a client-only localStorage check on mount to decide whether to show the modal, (2) a standalone dialog component styled with the existing steampunk chrome patterns, and (3) a "Connect Wallet" action button that triggers Privy's wallet connection flow. All three have well-established patterns in the current codebase.

**Primary recommendation:** Build a standalone WelcomeModal component with its own `<dialog>` element, separate from the ModalShell singleton. Check localStorage in a client-side useEffect, show the dialog programmatically, and set the flag on either button click. The "Connect Wallet" button calls Privy's `connectWallet()` / `login()` via the same hooks used in WalletStation.tsx.

## Standard Stack

### Core

No new dependencies. Everything required already exists in the project.

| Library | Version | Purpose | Already Used |
|---------|---------|---------|--------------|
| React 19 | 19.2.3 | Component + hooks (useState, useEffect, useRef, useCallback) | Yes |
| Native `<dialog>` | Browser built-in | Modal overlay with focus trapping + backdrop | Yes (ModalShell) |
| localStorage | Browser built-in | Persistence of "welcomed" flag | New usage (no existing localStorage in app) |
| @privy-io/react-auth | 3.13.1 | useLogin, useConnectWallet hooks for wallet connection | Yes (WalletStation, providers) |
| CSS (globals.css) | N/A | Steampunk chrome styling, animations | Yes (extensive) |

### Supporting

| Concern | Approach | Why |
|---------|----------|-----|
| Focus trap | Native `<dialog>.showModal()` | Browser provides it free -- same as ModalShell |
| Escape to close | Native `cancel` event + `e.preventDefault()` | Same pattern as ModalShell (line 220-232) |
| Body scroll lock | `document.body.classList.add('modal-open')` | Same pattern as ModalProvider |
| Backdrop blur | `dialog::backdrop` CSS | Same pattern as existing `backdrop-fade-in` keyframes |
| Animation | CSS keyframes with class toggle | Same pattern as iris-opening / mobile-slide-up |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Standalone `<dialog>` | Reuse ModalShell singleton by adding a virtual "welcome" StationId | StationId is typed to the 6 factory stations. The welcome modal has different chrome (no station header, no close button in header, different button layout). Forcing it into ModalShell would require conditional rendering throughout ModalShell and ModalContent, violating the clean single-responsibility design. |
| localStorage | Cookie or session flag | No server-side read needed. localStorage is simpler, doesn't expire, and doesn't transmit on every request. Context decision locks this. |
| Custom modal div | Native `<dialog>` | Native dialog provides free focus trap, Escape handling, backdrop, inert siblings. The codebase already uses this pattern. |

**Installation:** None required. Zero new npm dependencies.

## Architecture Patterns

### Recommended Project Structure

```
app/
  components/
    onboarding/
      WelcomeModal.tsx      # Standalone dialog component
  hooks/
    useWelcomeGate.ts       # localStorage check + show/dismiss logic
  app/
    globals.css             # Add welcome-modal CSS (minimal additions)
    page.tsx                # Render <WelcomeModal /> alongside existing content
```

### Pattern 1: Standalone Dialog (Separate from ModalShell)

**What:** WelcomeModal is its own `<dialog>` element, completely independent of the ModalProvider/ModalShell singleton.

**When to use:** When a modal has fundamentally different lifecycle from the station modals (one-shot, not tied to StationId, different content structure).

**Why:** The existing ModalShell is a singleton dialog that swaps station content via ModalContent.tsx's lazy switch. It expects a StationId, renders a fixed header with station title, and supports station crossfade. The welcome modal has none of these behaviors. It renders once, on mount, with a fixed body, two action buttons, and no header title. Coupling it to ModalShell would require branching logic throughout the shell.

**Example (verified from existing codebase patterns):**
```typescript
// WelcomeModal.tsx -- follows same dialog patterns as ModalShell.tsx
'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useLogin, useConnectWallet } from '@privy-io/react-auth';

const STORAGE_KEY = 'dr-fraudsworth-welcomed';

export function WelcomeModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { login } = useLogin();
  const { connectWallet } = useConnectWallet();

  // Client-only: check localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const alreadyWelcomed = localStorage.getItem(STORAGE_KEY);
    if (!alreadyWelcomed) {
      dialogRef.current?.showModal();
      document.body.classList.add('modal-open');
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    document.body.classList.remove('modal-open');
    // Animated close sequence here (same pattern as ModalShell)
    dialogRef.current?.close();
  }, []);

  const handleEnterFactory = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const handleConnectWallet = useCallback(() => {
    dismiss();
    connectWallet({ walletChainType: 'solana-only' });
  }, [dismiss, connectWallet]);

  // Handle native Escape (same pattern as ModalShell line 220)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      dismiss();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [dismiss]);

  return (
    <dialog ref={dialogRef} className="welcome-modal">
      {/* Content: title, tagline, body, two buttons */}
    </dialog>
  );
}
```

### Pattern 2: useWelcomeGate Hook (localStorage + Hydration Safety)

**What:** A custom hook that encapsulates the localStorage check, returning `{ shouldShow, dismiss }`.

**When to use:** To separate persistence logic from presentation, and to handle SSR/hydration correctly.

**Why:** SSR renders without the modal (server has no localStorage). On hydration, a useEffect checks localStorage and conditionally shows the dialog. This avoids hydration mismatches because the dialog starts hidden (not `open`) in both SSR and initial client render.

**Example:**
```typescript
// useWelcomeGate.ts
'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'dr-fraudsworth-welcomed';

export function useWelcomeGate() {
  // Start false -- SSR and initial client render agree (no modal visible)
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    // Client-only: check localStorage after hydration
    const welcomed = localStorage.getItem(STORAGE_KEY);
    if (!welcomed) {
      setShouldShow(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setShouldShow(false);
  }, []);

  return { shouldShow, dismiss };
}
```

### Pattern 3: Privy Wallet Trigger from Welcome Modal

**What:** The "Connect Wallet" button in the welcome modal calls Privy's `connectWallet()` after dismissing the modal.

**When to use:** When the welcome modal offers a wallet connection shortcut.

**Critical sequencing:** Dismiss the welcome `<dialog>` BEFORE triggering Privy. If the welcome dialog is still `showModal()` when Privy opens its HeadlessUI dialog, Privy's dialog will be inert (same issue documented in `usePrivyTopLayer.ts`). The simplest fix: call `dialog.close()` synchronously, then call `connectWallet()` in the next tick.

**Example:**
```typescript
const handleConnectWallet = useCallback(() => {
  // 1. Set localStorage flag
  localStorage.setItem(STORAGE_KEY, 'true');
  // 2. Close our dialog synchronously (removes inert from all elements)
  document.body.classList.remove('modal-open');
  dialogRef.current?.close();
  setShouldShow(false);
  // 3. Trigger Privy wallet flow (opens its own dialog)
  connectWallet({ walletChainType: 'solana-only' });
}, [connectWallet]);
```

### Pattern 4: Welcome Modal Placement in Component Tree

**What:** The WelcomeModal renders inside the providers.tsx tree, alongside ModalRoot.

**Why:** It needs access to PrivyProvider (for useConnectWallet/useLogin hooks). It should render as a sibling of ModalRoot, not inside it.

**Example (providers.tsx modification):**
```tsx
<PrivyProvider ...>
  <ModalProvider>
    <ToastProvider>
      {children}
      <ModalRoot />
      <WelcomeModal />    {/* <-- Add here, sibling of ModalRoot */}
      <ToastContainer />
      <WalletConnectionToast />
      <PrivyTopLayerFix />
    </ToastProvider>
  </ModalProvider>
</PrivyProvider>
```

### Anti-Patterns to Avoid

- **Adding a "welcome" StationId to the modal system:** The StationId type is `'swap' | 'carnage' | 'staking' | 'wallet' | 'docs' | 'settings'`. Adding `'welcome'` would propagate through ModalProvider, ModalContent (lazy imports), ModalShell (STATION_META), scene-data.ts, MobileNav (MOBILE_ORDER), and SceneStation. This is massive coupling for a one-shot gate.

- **Checking localStorage in a render path (not useEffect):** Would cause hydration mismatch. Server renders `shouldShow = false`, client immediately evaluates `shouldShow = localStorage.getItem(...)` as truthy. React would warn about server/client mismatch.

- **Using the `open` attribute on `<dialog>` in JSX:** This makes the dialog non-modal (no focus trap, no backdrop, no inert siblings). Always use `dialogRef.current.showModal()` in a useEffect.

- **Showing welcome modal and station modal simultaneously:** Two `showModal()` calls can stack, but the behavior is complex. Ensure the welcome modal is dismissed before any station modal can open. Since the welcome modal shows on mount and stations open on click, this is naturally sequential -- but verify with a guard.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Focus trapping | Custom focus trap library/logic | Native `<dialog>.showModal()` | Browser provides it for free. The entire existing modal system relies on this. |
| Escape key handling | `document.addEventListener('keydown', ...)` | Native `cancel` event on `<dialog>` | Same as ModalShell pattern. Cancel event fires on Escape, `preventDefault()` lets us animate first. |
| Backdrop overlay | Custom div with onClick and z-index | `dialog::backdrop` pseudo-element | Browser provides it. Style with CSS same as existing `backdrop-fade-in` keyframe. |
| Cross-tab sync for localStorage | BroadcastChannel or storage event | Nothing -- ignore cross-tab | Context decision: no cross-device sync. Multiple tabs from same user seeing welcome modal is harmless. |
| State persistence | IndexedDB, cookies, server-side flag | `localStorage.setItem(key, 'true')` | Context decision locks localStorage. Simple boolean flag, no expiry, no server round-trip. |

**Key insight:** The entire modal infrastructure (focus trap, backdrop, escape, scroll lock) is provided by the browser's native `<dialog>` element. The codebase already proves this pattern works. The welcome modal adds zero complexity to the modal system -- it's just another `<dialog>` with its own lifecycle.

## Common Pitfalls

### Pitfall 1: Hydration Mismatch with localStorage

**What goes wrong:** Component reads localStorage during render and conditionally renders the dialog as `open`. Server has no localStorage, so server renders "closed" but client renders "open" -- React hydration warning.

**Why it happens:** localStorage is a browser-only API. Any access must be deferred to a useEffect (which runs after hydration).

**How to avoid:** Initialize state as `false` (no modal). Check localStorage in a useEffect. Only call `showModal()` after the check. The dialog element always exists in the DOM (for ref stability), but starts not-open.

**Warning signs:** React console warning "Text content did not match" or "Hydration failed because the initial UI does not match what was rendered on the server."

### Pitfall 2: Privy Dialog Inert When Welcome Modal is Open

**What goes wrong:** User clicks "Connect Wallet" in the welcome modal. Privy opens its HeadlessUI wallet picker. But `showModal()` on the welcome dialog has made all elements outside it inert. Privy's dialog can't receive clicks.

**Why it happens:** This is the same issue documented in `usePrivyTopLayer.ts` -- `showModal()` makes everything outside the dialog inert (browser spec).

**How to avoid:** Close the welcome dialog BEFORE triggering Privy. The welcome modal's "Connect Wallet" handler must: (1) close the dialog synchronously, (2) then trigger `connectWallet()`. Since the welcome modal won't reopen (localStorage flag is set), there's no need for the complex toggle logic in usePrivyTopLayer -- just close permanently.

**Warning signs:** Privy wallet picker appears but buttons don't respond to clicks.

### Pitfall 3: Two showModal() Dialogs Competing

**What goes wrong:** If the welcome modal is open (via showModal) and something triggers a station modal (via ModalShell's showModal), the browser stacks two modal dialogs. Only the topmost receives focus. The welcome backdrop may visually conflict with the station backdrop.

**How to avoid:** The welcome modal shows on mount (before user interaction). Station modals open on click (user must interact). Natural sequencing prevents overlap. However, add a safety check: if `shouldShow` is true, the station modals should not be triggerable. This could be done by conditionally rendering the ModalRoot or by checking the welcome gate state before openModal. The simplest approach: the welcome modal covers the entire viewport with its backdrop, so users can't click station objects behind it.

**Warning signs:** Visual glitches (double backdrop blur), focus jumping between dialogs.

### Pitfall 4: Close Animation vs. Synchronous close()

**What goes wrong:** Calling `dialog.close()` immediately hides the dialog (no animation). The existing ModalShell uses a "closing" CSS class + animationend event before calling `dialog.close()`.

**Why it happens:** `dialog.close()` is synchronous and instant. Animations require adding a class, waiting for animationend, then calling close().

**How to avoid:** Follow the ModalShell pattern: add "closing" class, listen for `animationend`, then `dialog.close()`. For the "Connect Wallet" path, skip the close animation (or use a faster one) since Privy's dialog will immediately appear -- the user won't notice a fade-out under Privy's overlay.

**Warning signs:** Modal vanishes instantly without animation (functional but jarring).

### Pitfall 5: Body Scroll Lock Left Behind

**What goes wrong:** If the welcome modal opens and adds `modal-open` class to body, but the close path fails to remove it, the page remains unscrollable.

**How to avoid:** Remove `modal-open` class in EVERY dismiss path (Enter Factory button, Connect Wallet button, Escape key). Don't rely on a single cleanup path. The useWelcomeGate hook's `dismiss()` function should handle body class removal.

**Warning signs:** Page doesn't scroll after dismissing welcome modal.

## Code Examples

### Example 1: Dialog CSS Following Existing Chrome Patterns

```css
/* Welcome modal: reuses existing steampunk chrome with centered layout.
   Separate from .modal-shell to avoid selector conflicts. */
dialog.welcome-modal {
  padding: 0;
  border: none;
  background: transparent;
  max-width: 480px;
  width: 90vw;
  outline: none;
  margin: auto;
}

/* Reuse the identical steampunk chrome from .modal-chrome */
.welcome-chrome {
  position: relative;
  background: linear-gradient(135deg, #f5e6c8 0%, #e8d5a8 50%, #f0dbb8 100%);
  border: 3px solid var(--color-factory-accent);
  border-radius: 8px;
  box-shadow:
    0 0 0 6px var(--color-factory-surface-elevated),
    0 0 0 8px var(--color-factory-accent),
    0 0 40px rgba(240, 192, 80, 0.15),
    0 16px 48px rgba(0, 0, 0, 0.5);
  padding: 2rem;
  text-align: center;
}

/* Reuse existing backdrop animation */
dialog.welcome-modal[open]::backdrop {
  animation: backdrop-fade-in 280ms ease-out forwards;
}

/* Open animation: simple fade-in + scale for the welcome "title card" feel.
   Uses CSS only, compositor properties, 60fps. */
@keyframes welcome-open {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}

dialog.welcome-modal.welcome-opening {
  animation: welcome-open 350ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

/* Close animation */
dialog.welcome-modal.welcome-closing {
  animation: modal-close 180ms ease-in forwards;
}

dialog.welcome-modal.welcome-closing::backdrop {
  animation: backdrop-fade-out 180ms ease-in forwards;
}

/* Mobile: fullscreen, same as station modals */
@media (width < 64rem) {
  dialog.welcome-modal {
    width: 100%;
    max-width: none !important;
    max-height: none;
    height: 100dvh;
    margin: 0;
    border-radius: 0;
  }

  .welcome-chrome {
    border-radius: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
}
```

### Example 2: Welcome Content Layout

```tsx
// Typography follows existing theme: Cinzel heading, system body, Plex Mono for tokens
<div className="welcome-chrome">
  {/* Decorative corner bolts (same as ModalShell) */}
  <div className="modal-bolt" style={{ top: '6px', left: '6px' }} />
  <div className="modal-bolt" style={{ top: '6px', right: '6px' }} />
  <div className="modal-bolt" style={{ bottom: '6px', left: '6px' }} />
  <div className="modal-bolt" style={{ bottom: '6px', right: '6px' }} />

  {/* Decorative header element: factory crest/emblem */}
  <div className="welcome-emblem" aria-hidden="true">
    {/* SVG or static image -- Claude's discretion per CONTEXT.md */}
  </div>

  {/* Title: Cinzel serif, dark on paper */}
  <h2 className="font-heading text-[#2a1f0e] text-subheading font-bold tracking-wide mb-2">
    Welcome to Dr. Fraudsworth&apos;s Finance Factory
  </h2>

  {/* Tagline */}
  <p className="text-[#5a4a32] text-sm italic mb-4">
    {/* One line capturing the value prop -- Claude's discretion */}
  </p>

  {/* Body: 2-3 sentences, dark text on paper */}
  <p className="text-[#3a2e1e] text-sm leading-relaxed mb-6">
    {/* Protocol description -- theatrical, no jargon */}
  </p>

  {/* Action buttons */}
  <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
    <button onClick={handleEnterFactory} className="brass-button ...">
      Enter the Factory
    </button>
    <button onClick={handleConnectWallet} className="brass-button ...">
      Connect Wallet
    </button>
  </div>
</div>
```

### Example 3: Animated Close (Following ModalShell Pattern)

```typescript
// Animated close with callback -- exactly mirrors ModalShell.handleAnimatedClose
const handleAnimatedClose = useCallback((onComplete?: () => void) => {
  const dialog = dialogRef.current;
  if (!dialog?.open) return;

  dialog.classList.add('welcome-closing');
  dialog.addEventListener('animationend', () => {
    dialog.classList.remove('welcome-closing');
    dialog.close();
    document.body.classList.remove('modal-open');
    onComplete?.();
  }, { once: true });
}, []);

// "Enter the Factory" -- animated close, no follow-up action
const handleEnterFactory = useCallback(() => {
  localStorage.setItem(STORAGE_KEY, 'true');
  handleAnimatedClose();
}, [handleAnimatedClose]);

// "Connect Wallet" -- skip animation (Privy opens immediately after)
const handleConnectWallet = useCallback(() => {
  localStorage.setItem(STORAGE_KEY, 'true');
  document.body.classList.remove('modal-open');
  dialogRef.current?.close(); // Instant close -- Privy dialog will mask it
  connectWallet({ walletChainType: 'solana-only' });
}, [connectWallet]);
```

## State of the Art

| Aspect | Current Codebase Approach | Applies to Welcome Modal |
|--------|---------------------------|--------------------------|
| Modal system | Native `<dialog>` with showModal(), CSS animations, singleton pattern | Yes, same dialog API but standalone (not singleton) |
| Styling | Steampunk chrome with CSS custom properties, Tailwind v4 utilities | Yes, reuse chrome patterns from globals.css |
| Wallet connection | Privy v3 useConnectWallet/useLogin hooks | Yes, same hooks |
| Body scroll lock | `body.modal-open` class | Yes, same class |
| Mobile responsiveness | CSS media query at 64rem (1024px), fullscreen slide-up | Yes, same breakpoint and approach |
| Animation | CSS keyframes + class toggle + animationend event | Yes, same pattern |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` disables all animations | Already applies globally -- no additional work |

**Nothing deprecated or outdated** -- the codebase is current (React 19, Next.js 16, Tailwind 4, Privy v3).

## Open Questions

1. **Decorative header image/emblem**
   - What we know: CONTEXT.md says "factory crest/emblem or simplified factory silhouette" -- Claude's discretion
   - What's unclear: Whether to use an inline SVG (smaller, scalable) or a static image from `/public`
   - Recommendation: Inline SVG. Keeps the component self-contained, scales to any resolution, and avoids an extra network request. A simple gear/cog or factory chimney silhouette in the brass color palette works well.

2. **"Enter the Factory" vs "Connect Wallet" visual weight**
   - What we know: CONTEXT.md says "Enter the Factory should feel like the primary/default action" -- Claude's discretion on visual weight
   - What's unclear: Whether primary means brass-accent-filled or simply left-positioned
   - Recommendation: "Enter the Factory" gets the accent-filled brass button (visual primary), "Connect Wallet" gets the outlined/secondary brass button. Position "Enter the Factory" first (left on desktop row, top on mobile stack).

3. **Welcome modal vs. station modal z-index stacking**
   - What we know: The welcome modal shows on mount, station modals on click. They shouldn't overlap.
   - What's unclear: Whether an explicit z-index ordering is needed if both use showModal()
   - Recommendation: Since `showModal()` places dialogs in the browser top layer in stack order, and the welcome modal closes before any station modal opens, no z-index management is needed. If someone force-navigates (unlikely), the browser's top-layer stacking handles it correctly.

## Sources

### Primary (HIGH confidence)

All research was conducted by reading the actual project source code. No external library documentation was needed because:

- The welcome modal uses native browser APIs (`<dialog>`, `localStorage`) -- no library-specific behavior to verify
- The Privy integration uses the exact same hooks (`useLogin`, `useConnectWallet`) already proven in `WalletStation.tsx` and `providers.tsx`
- The CSS patterns are established in `globals.css` with 1000+ lines of verified steampunk chrome

**Source files examined:**
- `app/components/modal/ModalProvider.tsx` -- Modal state management, StationId type, openModal/closeModal API
- `app/components/modal/ModalShell.tsx` -- Dialog lifecycle, showModal/close sync, animation patterns, STATION_META
- `app/components/modal/ModalContent.tsx` -- Lazy station loading, Suspense boundary
- `app/components/modal/ModalCloseButton.tsx` -- Brass close button SVG pattern
- `app/components/wallet/ConnectModal.tsx` -- Privy connectWallet/login usage (legacy, pre-modal-system)
- `app/components/station/WalletStation.tsx` -- Current Privy connectWallet/login usage in modal system
- `app/hooks/useModal.ts` -- Context consumption pattern
- `app/hooks/useProtocolWallet.ts` -- Privy wallet abstraction, chain config
- `app/hooks/usePrivyTopLayer.ts` -- showModal() inert issue, toggle pattern
- `app/providers/providers.tsx` -- Provider nesting, Privy config, component siblings
- `app/app/page.tsx` -- Root page with desktop/mobile responsive split
- `app/app/layout.tsx` -- Font variables, body classes
- `app/app/globals.css` -- Complete modal CSS, chrome, animations, mobile overrides, button patterns
- `app/app/fonts.ts` -- Cinzel (heading), IBM Plex Mono (data)
- `app/components/scene/scene-data.ts` -- Station metadata, tab order
- `app/components/mobile/MobileNav.tsx` -- Mobile navigation, wallet badge
- `.planning/phases/59-onboarding/59-CONTEXT.md` -- All locked decisions

### Secondary (MEDIUM confidence)

None needed. All patterns are verified from the codebase itself.

### Tertiary (LOW confidence)

None. No external web searches were required.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zero new dependencies, all patterns from existing codebase
- Architecture: HIGH -- Direct extrapolation from ModalShell.tsx patterns to a simpler standalone dialog
- Pitfalls: HIGH -- Privy inert issue documented in usePrivyTopLayer.ts, hydration pattern well-understood from React 19/Next.js 16 `'use client'` convention
- Code examples: HIGH -- All derived from actual source files, not hypothetical

**Research date:** 2026-02-24
**Valid until:** Indefinite (no external dependencies, no version-sensitive advice)
