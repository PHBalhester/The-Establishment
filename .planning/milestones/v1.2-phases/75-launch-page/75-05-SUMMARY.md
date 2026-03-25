---
phase: 75-launch-page
plan: 05
subsystem: ui
tags: [bonding-curve, state-machine, refund, graduation, redirect, steampunk, css-animation]

# Dependency graph
requires:
  - phase: 75-launch-page
    provides: useCurveState hook, curve-tx-builder (buildClaimRefundInstruction), error-map (Plans 01-02)
  - phase: 75-launch-page
    provides: Launch page shell with LaunchScene, gauges, stats, wallet button (Plan 03)
provides:
  - RefundPanel with per-curve token balance display and claim_refund TX execution
  - GraduationOverlay with full-screen CSS-only celebration
  - StateMachineWrapper for compound curve state conditional rendering
  - Root / redirect to /launch during curve phase
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [compound-state-machine-conditional-rendering, proportional-refund-formula, css-only-celebration-overlay]

key-files:
  created:
    - app/components/launch/RefundPanel.tsx
    - app/components/launch/GraduationOverlay.tsx
    - app/components/launch/StateMachineWrapper.tsx
  modified:
    - app/app/launch/page.tsx
    - app/app/page.tsx

key-decisions:
  - "StateMachineWrapper priority order: graduated > failed > active/filled"
  - "GraduationOverlay renders ON TOP of children (fixed z-50) for visual depth"
  - "Root redirect uses next/navigation redirect() which works in client components during render"
  - "RefundPanel disables claim until escrowConsolidated flag is true"

patterns-established:
  - "Compound state machine: check both curves independently, prioritize terminal states"
  - "CSS-only celebration: @keyframes for gear rotation and glow pulse, no npm animation deps"
  - "Env-var redirect: NEXT_PUBLIC_CURVE_PHASE inlined at build time controls route behavior"

requirements-completed: [PAGE-01, PAGE-07, PAGE-08]

# Metrics
duration: 7min
completed: 2026-03-07
---

# Phase 75 Plan 05: State Machine UI Summary

**Refund panel with per-curve claim_refund TX, graduation celebration overlay with CSS gear animation, compound state wrapper, and NEXT_PUBLIC_CURVE_PHASE root redirect**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-07T10:51:44Z
- **Completed:** 2026-03-07T10:58:34Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RefundPanel shows per-curve token balances, proportional refund estimates (matching on-chain formula), and claim buttons with full TX lifecycle
- GraduationOverlay renders full-screen celebration with CSS-only brass gear rotation and glow pulse animation
- StateMachineWrapper drives conditional rendering: both graduated -> overlay, either failed -> refund, otherwise -> BuySellPanel
- Root / redirects to /launch when NEXT_PUBLIC_CURVE_PHASE=true (server-inlined at build time)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refund panel and graduation overlay** - `c700ab9` (feat)
2. **Task 2: State machine wrapper, page integration, and route redirect** - `5387c97` (feat)

## Files Created/Modified
- `app/components/launch/RefundPanel.tsx` - Per-curve refund display with claim_refund TX execution
- `app/components/launch/GraduationOverlay.tsx` - Full-screen celebration overlay with CSS animations
- `app/components/launch/StateMachineWrapper.tsx` - Compound curve state conditional rendering
- `app/app/launch/page.tsx` - Wrapped content with StateMachineWrapper
- `app/app/page.tsx` - Added NEXT_PUBLIC_CURVE_PHASE redirect to /launch

## Decisions Made
- **StateMachineWrapper priority**: Graduated (both) takes highest priority, then Failed (either), then active/filled as default. This ensures terminal states always show appropriate UI.
- **GraduationOverlay over children**: Renders children behind the overlay (not replaces them) so the brass machine scene provides visual depth behind the blurred celebration.
- **Client-component redirect**: Used `redirect()` from `next/navigation` which works during client component render (throws internal Next.js navigation error). The `NEXT_PUBLIC_CURVE_PHASE` env var is inlined at build time by Next.js.
- **Refund escrow gate**: Claim button is disabled until `escrowConsolidated` is true, matching the on-chain `EscrowNotConsolidated` error guard. Shows a warning message when consolidation is pending.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript error in lib/staking/staking-builders.ts (references removed systemProgram account). Not related to this plan, documented as existing deferred item.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 75 launch page is functionally complete: all 4 curve states handled (Active, Filled, Failed, Graduated)
- Route redirect makes /launch the sole entry point during curve phase
- Ready for visual polish and user testing on devnet
- No blockers for mainnet preparation

---
*Phase: 75-launch-page*
*Completed: 2026-03-07*
