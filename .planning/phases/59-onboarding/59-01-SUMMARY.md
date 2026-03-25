---
phase: 59-onboarding
plan: 01
subsystem: ui
tags: [dialog, localStorage, steampunk, onboarding, welcome-modal, privy, css-animations]

# Dependency graph
requires:
  - phase: 54-modal-system
    provides: "Modal patterns (dialog lifecycle, brass chrome, animations, body scroll lock)"
  - phase: 57-brand
    provides: "Steampunk CSS tokens, brass-button class, Cinzel heading font"
  - phase: 58-mobile
    provides: "Mobile fullscreen dialog pattern, 100dvh, responsive media query at 64rem"
provides:
  - "useWelcomeGate hook: hydration-safe localStorage gate (shouldShow + dismiss)"
  - "WelcomeModal component: standalone dialog with steampunk chrome, two action buttons"
  - "Welcome modal CSS: dialog reset, chrome, open/close animations, mobile fullscreen, primary button"
affects: [59-02-wiring, onboarding-future]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone dialog pattern: independent <dialog> with own lifecycle, separate from ModalShell singleton"
    - "Privy-safe dialog close: synchronous close() before connectWallet() to avoid inert trap"
    - "useWelcomeGate: hydration-safe localStorage with false initial state"
    - "Welcome CSS class prefix: welcome-* (welcome-modal, welcome-chrome, welcome-opening, welcome-closing, welcome-btn-primary)"

key-files:
  created:
    - app/hooks/useWelcomeGate.ts
    - app/components/onboarding/WelcomeModal.tsx
  modified:
    - app/app/globals.css

key-decisions:
  - "Standalone dialog instead of reusing ModalShell -- different lifecycle (one-shot gate vs station singleton)"
  - "Enter the Factory as primary visual weight (accent-filled brass button), Connect Wallet as secondary (standard brass-button)"
  - "Synchronous dialog.close() for Connect Wallet path -- no animation delay, Privy dialog masks disappearance"
  - "Inline SVG factory gear emblem -- self-contained, no network request, scales to any resolution"
  - "welcome-chrome as separate class from modal-chrome -- avoids selector coupling despite identical visuals"

patterns-established:
  - "Standalone dialog: own <dialog> element, own showModal/close lifecycle, own CSS class prefix"
  - "Privy wallet trigger from dialog: close synchronously, then connectWallet() -- never animate first"
  - "Welcome gate hook: localStorage check deferred to useEffect, state starts false for hydration safety"

# Metrics
duration: 3min
completed: 2026-02-24
---

# Phase 59 Plan 01: Welcome Modal Core Implementation Summary

**Standalone steampunk welcome dialog with useWelcomeGate localStorage hook, brass chrome frame, factory gear emblem SVG, and Privy-safe wallet connection trigger**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-24T17:33:31Z
- **Completed:** 2026-02-24T17:36:50Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- useWelcomeGate hook with hydration-safe localStorage persistence (starts false, checks after mount)
- WelcomeModal standalone dialog with steampunk chrome, inline SVG gear emblem, Cinzel title, 3-sentence protocol explainer
- Two action paths: "Enter the Factory" (animated close) and "Connect Wallet" (synchronous close + Privy trigger)
- Full CSS: dialog reset, welcome-chrome frame, welcome-open/close animations, mobile 100dvh fullscreen, accent primary button
- Zero new npm dependencies

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useWelcomeGate hook and welcome modal CSS** - `42418ea` (feat)
2. **Task 2: Create WelcomeModal component** - `92b500a` (feat)

## Files Created/Modified
- `app/hooks/useWelcomeGate.ts` - Hydration-safe localStorage gate hook (shouldShow + dismiss)
- `app/components/onboarding/WelcomeModal.tsx` - Standalone welcome dialog with steampunk chrome, emblem, title, buttons
- `app/app/globals.css` - Welcome modal CSS: dialog reset, chrome, animations, mobile fullscreen, primary button

## Decisions Made
- **Standalone dialog over ModalShell reuse**: The welcome modal has a fundamentally different lifecycle (one-shot gate vs. station singleton). Adding a "welcome" StationId would propagate through ModalProvider, ModalContent, ModalShell, scene-data.ts, and MobileNav -- massive coupling for a one-shot gate.
- **Enter the Factory as primary**: Exploration-first per CONTEXT.md. Accent-filled brass button with stronger visual weight. Connect Wallet is secondary (standard brass-button).
- **Synchronous close for Connect Wallet**: Must close our `<dialog>` before Privy opens its HeadlessUI dialog. `showModal()` makes all external elements inert -- if our dialog is still open, Privy's wallet picker buttons can't receive clicks. Same issue documented in usePrivyTopLayer.ts.
- **Inline SVG emblem**: Factory gear/chimney crest in brass palette (#daa520, #b8860b, #8b6914). Self-contained, no network request, scales to any resolution.
- **Separate welcome-chrome class**: Visually identical to modal-chrome but decoupled selector. Prevents future changes to modal-chrome from affecting the welcome modal.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- WelcomeModal and useWelcomeGate are complete and self-contained
- Plan 02 will wire WelcomeModal into providers.tsx (inside PrivyProvider for useConnectWallet access)
- Component is ready for mounting as a sibling of ModalRoot in the provider tree

---
*Phase: 59-onboarding*
*Completed: 2026-02-24*
