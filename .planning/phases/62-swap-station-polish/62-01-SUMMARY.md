---
phase: 62-swap-station-polish
plan: 01
subsystem: ui
tags: [css-grid, modal, border-image, 9-slice, layout, react-refactor, state-lift]

# Dependency graph
requires:
  - phase: 60-component-kit
    provides: kit-frame-asset class, riveted-paper.png, kit CSS infrastructure
  - phase: 54-modal-system
    provides: ModalShell singleton, modal-chrome styling, STATION_META
  - phase: 61-chart-overhaul
    provides: ChartWrapper, ChartControls, CandlestickChart pipeline
provides:
  - chromeVariant field in STATION_META for per-station frame selection
  - modal-chrome-kit CSS class for 9-slice border-image modal frame
  - swap-station-columns CSS Grid class (responsive two-column layout)
  - kit-panel-riveted CSS class for interior riveted brass panels
  - SwapStation as sole useSwap() consumer (state lifted from SwapForm)
  - SwapForm as presentational component with SwapFormProps interface
  - BigRedButton + swap summary in right grid column
affects: [62-02 stats bar, 62-03 chart controls, 62-04 swap form, 62-05 big red button, 63-66 other station chrome]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chromeVariant per-station modal frame selection"
    - "Strategy B state lift: useSwap in parent, SwapForm receives props"
    - "CSS Grid two-column responsive layout with align-items: start"

key-files:
  created: []
  modified:
    - app/components/modal/ModalShell.tsx
    - app/components/station/SwapStation.tsx
    - app/components/swap/SwapForm.tsx
    - app/app/kit.css
    - app/app/globals.css

key-decisions:
  - "chromeVariant approach: per-station opt-in to kit-frame, forward-compatible for phases 63-66"
  - "Strategy B (lift useSwap to SwapStation): cleanest separation, SwapForm has exactly one consumer"
  - "SlippageConfig removed from SwapForm with settings quick-link; defaults apply until Phase 65"
  - "Mobile kit border stripped (border: none) since fullscreen slide-up has no visible outer frame"
  - "Swap summary includes min. received in addition to est. output, fees, and price impact"

patterns-established:
  - "chromeVariant: each station independently opts into kit-frame via STATION_META"
  - "SwapFormProps: comprehensive interface threading all useSwap state as props"
  - "Right column pattern: BigRedButton + swap summary as grid siblings of SwapForm"

# Metrics
duration: 9min
completed: 2026-02-27
---

# Phase 62 Plan 01: Modal Chrome + Two-Column Layout Summary

**Kit-frame 9-slice border on swap modal, useSwap() lifted to SwapStation, responsive two-column CSS Grid with BigRedButton in independent right column**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-27T13:40:40Z
- **Completed:** 2026-02-27T13:49:40Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Swap station modal displays kit Frame 9-slice border-image instead of CSS box-shadow chrome
- Below-chart area renders in two columns on desktop (swap form left, action area right)
- Mobile viewport stacks columns vertically (swap form top, action area below)
- BigRedButton and swap summary render in the right column, independent of SwapForm's DOM tree
- All existing swap functionality preserved (quotes, routing, execution, toasts)
- SlippageConfig replaced with "Swap settings" quick-link opening Settings modal
- Other station modals (carnage, staking, wallet, docs, settings) retain classic chrome unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Modal chrome kit Frame + CSS Grid layout classes** - `6302450` (feat)
2. **Task 2: Lift useSwap() to SwapStation + two-column grid layout** - `f3bc72e` (feat)

## Files Created/Modified

- `app/components/modal/ModalShell.tsx` - Added ChromeVariant type, chromeVariant field in STATION_META, conditional chrome class and bolt rendering, chromeVariant prop threading through ModalRoot
- `app/app/globals.css` - Added .modal-chrome-kit CSS class with 9-slice border-image override and mobile media query
- `app/app/kit.css` - Added .swap-station-columns responsive grid class and .kit-panel-riveted interior panel class
- `app/components/station/SwapStation.tsx` - Refactored to call useSwap(), distribute state to SwapForm and BigRedButton, two-column grid layout with swap summary
- `app/components/swap/SwapForm.tsx` - Refactored from hook consumer to presentational component with SwapFormProps interface, removed useSwap/SlippageConfig/MultiHopStatus/renderAction

## Decisions Made

- **chromeVariant approach:** Forward-compatible per-station opt-in. Only swap gets kit-frame now; phases 63-66 flip their stations. No breaking changes to other modals.
- **Strategy B (state lift):** useSwap() moved from SwapForm to SwapStation. SwapForm has exactly one consumer (SwapStation via React.lazy), so the refactor scope is tightly bounded. This is the cleanest approach for CSS Grid sibling columns.
- **SlippageConfig removal:** Replaced with "Swap settings" quick-link that opens Settings modal. Sensible defaults (1% slippage, medium priority) apply until Phase 65 adds controls to Settings.
- **Mobile kit border strip:** On mobile (<1024px), modal-chrome-kit removes the 30px border entirely since the fullscreen slide-up panel has no visible outer frame.
- **Swap summary content:** Includes estimated output, total fees, price impact (color-coded by severity), and minimum received -- all derived from swap.quote.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Two-column layout is in place and verified; phases 62-02 through 62-05 can restyle individual components within this container structure
- chromeVariant infrastructure is ready for phases 63-66 to opt other stations into kit-frame
- SwapFormProps interface is stable and comprehensive; future swap form restyling (62-04) can work within these props

---
*Phase: 62-swap-station-polish*
*Completed: 2026-02-27*
