---
phase: 105-crank-hardening
plan: 01
subsystem: crank
tags: [switchboard, vrf, randomness, rent-reclaim, crank-runner]

# Dependency graph
requires:
  - phase: 103-off-chain-security-hardening
    provides: "closeRandomnessAccount() function and startup sweep in crank-runner"
provides:
  - "Inline stale randomness account close in both vrf-flow.ts recovery paths"
  - "Periodic sweep safety net every 50 cycles in crank-runner.ts"
affects: [105-02 (instrumentation extends same files), 105-03 (alerting extends crank-runner)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline close with try/catch warning-only pattern for non-critical cleanup"
    - "Periodic sweep at start of cycle (before TX1) to avoid racing active randomness"

key-files:
  created: []
  modified:
    - "scripts/vrf/lib/vrf-flow.ts"
    - "scripts/crank/crank-runner.ts"

key-decisions:
  - "Close stale accounts inline before return, not after -- ensures cleanup even if caller throws"
  - "TOCTOU path closes both stalePubkey AND retryRngKp since neither is returned for caller cleanup"
  - "Periodic sweep runs at START of every 50th cycle (before TX1) to avoid Pitfall 4 race"
  - "cycleCount > 1 guard prevents double-sweep on cycle 1 (startup sweep just ran)"

patterns-established:
  - "Inline close pattern: try/catch around closeRandomnessAccount(), log warning on failure, never throw"
  - "PERIODIC_SWEEP_INTERVAL constant with JSDoc at module top, conditional call in main loop"

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 105 Plan 01: Randomness Account Leak Fix + Periodic Sweep Summary

**Inline close of stale/original randomness accounts in both vrf-flow.ts recovery paths, plus periodic sweep every 50 cycles as safety net**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T21:45:46Z
- **Completed:** 2026-03-25T21:47:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed two distinct randomness account leak paths in advanceEpochWithVRF() that leaked ~0.008 SOL per recovery event
- Added inline close of stalePubkey + retryRngKp in TOCTOU early-return path (vrfPending timeout retry)
- Added inline close of stalePubkey after successful vrfPending recovery when fresh account replaced it
- Added inline close of original rngKp.publicKey in happy-path timeout recovery after retryRngKp replaces it
- Added periodic sweep every 50 cycles as a safety net for any accounts that escape inline closes

## Task Commits

Each task was committed atomically:

1. **Task 1: Inline close stale randomness accounts in both vrf-flow.ts recovery paths** - `01ef54d` (feat)
2. **Task 2: Add periodic sweep every 50 cycles in crank-runner.ts** - `7dc5119` (feat)

## Files Created/Modified
- `scripts/vrf/lib/vrf-flow.ts` - Added 4 inline closeRandomnessAccount() calls in 3 recovery code paths (TOCTOU x2, vrfPending x1, happy-path timeout x1)
- `scripts/crank/crank-runner.ts` - Added PERIODIC_SWEEP_INTERVAL constant (50) and conditional sweep call before readEpochState in main loop

## Decisions Made
- Close stale accounts inline before return statements, not after -- ensures cleanup even if the caller throws after receiving the result
- TOCTOU early-return path closes BOTH stalePubkey AND retryRngKp.publicKey, since randomnessPubkey is returned as null and the caller won't close either
- Periodic sweep runs at the START of every 50th cycle (before TX1 creates a new randomness account) to avoid Pitfall 4 from RESEARCH.md (racing with active cycle)
- cycleCount > 1 guard prevents running periodic sweep on cycle 1, since the startup sweep just ran

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- vrf-flow.ts and crank-runner.ts are ready for 105-02 (VRF instrumentation + exponential backoff tuning)
- All inline close patterns established; 105-02 can extend tryReveal() and add timing fields to EpochTransitionResult
- No blockers for next plan

---
*Phase: 105-crank-hardening*
*Completed: 2026-03-25*
