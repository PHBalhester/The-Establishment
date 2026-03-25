---
phase: 54-modal-system
plan: 02
subsystem: ui
tags: [dialog, modal, steampunk-chrome, css, clip-path, focus-visible, accessibility, react]

# Dependency graph
requires:
  - phase: 54-01
    provides: "ModalProvider context, useModal hook, CSS @keyframes iris-open/modal-close/crossfade animations"
  - phase: 53-asset-pipeline-brand-foundation
    provides: "@theme color tokens (factory-accent, factory-glow, factory-surface-elevated), font pipeline"
provides:
  - "ModalShell singleton dialog wrapper with iris-open animation, close animation, backdrop click, Escape handling"
  - "ModalRoot station-to-title/maxWidth mapper for all 6 factory stations"
  - "ModalCloseButton brass circular close button with Victorian shut-valve styling"
  - "Steampunk modal chrome CSS: brass frame, decorative bolts, fixed header, scrollable body"
  - "Focus-visible glow indicators for dialog-scoped interactive elements (A11Y-02)"
affects: [54-03-integration, 55-scene-objects, 56-station-content]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Singleton dialog: one ModalShell always in DOM, content swaps for station switching"
    - "Close animation: JS class toggle (closing) + animationend event + dialog.close()"
    - "Native Escape handling via cancel event (no keydown listener)"
    - "Backdrop click via target === currentTarget on dialog element"
    - "will-change optimization: set before showModal, removed after animationend"

key-files:
  created:
    - "app/components/modal/ModalShell.tsx"
    - "app/components/modal/ModalCloseButton.tsx"
  modified:
    - "app/app/globals.css"

key-decisions:
  - "Singleton dialog: one ModalShell in DOM, content swaps prevent scene flash on station switch"
  - "Bolts as inline style positioning: absolute corners of modal-chrome, not pseudo-elements (simpler, four distinct elements)"
  - "Close button positioned absolute inside header with right padding offset"
  - "Crossfade on modal-chrome div (not dialog): exit class on chrome, then enter class after animationend"

patterns-established:
  - "Modal chrome structure: dialog > .modal-chrome > .modal-header + .modal-body"
  - "Station metadata map: STATION_META record mapping StationId to title/maxWidth"
  - "Victorian shut-valve button: brass gradient + beveled box-shadow + pressed-in active state"

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 54 Plan 02: ModalShell Dialog Wrapper Summary

**Singleton native dialog with steampunk brass chrome, iris-open animation from click origin, close animation sequence, backdrop/Escape/X close handlers, and Victorian shut-valve close button**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T22:07:18Z
- **Completed:** 2026-02-22T22:10:27Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- Created ModalShell singleton dialog wrapper that syncs with ModalProvider state, opens with iris-clip-path animation from click origin, and closes with animated sequence (class toggle + animationend + dialog.close)
- Created ModalRoot component mapping all 6 station IDs to display titles and max-widths, with placeholder content for Phase 56
- Created ModalCloseButton with brass gradient, beveled box-shadow, SVG X mark, hover glow, and pressed-in active state
- Added full steampunk chrome CSS: dialog reset, brass frame borders with multi-layer box-shadow, decorative corner bolts, fixed header with brass rule divider, scrollable body with themed scrollbar
- Added focus-visible glow indicators for all interactive elements within dialog (A11Y-02)
- Station crossfade support: content swap without closing/reopening the dialog (prevents scene flash)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ModalShell dialog wrapper component** - `2ae3b45` (feat)
2. **Task 2: Create ModalCloseButton and steampunk chrome + focus-visible styles** - `70a9f4f` (feat)

## Files Created/Modified

- `app/components/modal/ModalShell.tsx` - Singleton dialog wrapper (257 lines): ModalShell + ModalRoot components, station metadata, iris animation, close sequence, backdrop click, cancel event, crossfade
- `app/components/modal/ModalCloseButton.tsx` - Brass circular close button (56 lines): SVG X mark, brass gradient, beveled shadow, hover/active states, aria-label
- `app/app/globals.css` - Added modal chrome CSS: dialog reset, .modal-chrome brass frame, .modal-bolt corner rivets, .modal-header fixed header, .modal-body scrollable area, .modal-close-btn Victorian styling, :focus-visible glow indicators

## Decisions Made

- **Singleton dialog pattern**: One ModalShell always exists in the DOM. Station switching swaps content inside via crossfade rather than closing and reopening the dialog (prevents scene flash per RESEARCH.md Pitfall 7).
- **Bolt elements as styled divs (not pseudo-elements)**: Four .modal-bolt divs with inline style positioning are simpler and more maintainable than ::before/::after pseudo-elements, especially with four corners.
- **Close button absolute positioning in header**: Using absolute positioning within the header with padding-right offset ensures the button stays aligned regardless of title length.
- **Crossfade on .modal-chrome, not individual content**: Applying exit/enter classes to the chrome container crossfades the entire panel, including header text change, for a unified transition.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ModalShell and ModalCloseButton are ready for integration with the provider tree (Plan 03)
- ModalRoot needs to be rendered inside ModalProvider in the component tree
- Plan 03 will wire ModalProvider into providers.tsx, add ModalRoot to the layout, and verify end-to-end flow
- Phase 55 (scene objects) will call openModal() with click origin coordinates
- Phase 56 (station content) will replace the placeholder content in ModalRoot with actual station components

---
*Phase: 54-modal-system*
*Completed: 2026-02-22*
