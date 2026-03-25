---
phase: 83-vrf-crank-hardening
plan: 04
subsystem: vrf
tags: [switchboard, vrf, crank, toctou, recovery, timeout]

requires:
  - phase: 82-carnage-refactor
    provides: "Atomic carnage bundling in vrf-flow.ts"
provides:
  - "TOCTOU-safe VRF recovery in both stale and timeout retry paths"
  - "Request-slot-based timeout calculation in normal flow"
  - "Distinct ops monitoring log lines for VRF timeout recovery"
affects: [83-crank-runner, 84-frontend-hardening]

tech-stack:
  added: []
  patterns: ["TOCTOU race detection via error string matching", "Slot-relative timeout calculation"]

key-files:
  created: []
  modified: ["scripts/vrf/lib/vrf-flow.ts"]

key-decisions:
  - "TOCTOU detection uses string matching on 'already', 'VrfNotPending', and '07DC' (ConstraintRaw) -- covers runtime, epoch program, and Anchor error paths"
  - "Both recovery paths (stale VRF + timeout retry) get independent TOCTOU handling -- another crank can race at either point"
  - "Normal flow timeout now reads vrfRequestSlot from on-chain state and calculates remaining wait instead of hardcoded 305 slots"

patterns-established:
  - "TOCTOU recovery: detect already-consumed error, re-read state, return valid result with 'already-consumed' sentinel signatures"

duration: 3min
completed: 2026-03-08
---

# Phase 83 Plan 04: VRF Recovery Hardening Summary

**TOCTOU-safe "already consumed" handling in both VRF recovery paths + request-slot-based timeout calculation replacing hardcoded 305-slot wait**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-08T11:57:38Z
- **Completed:** 2026-03-08T12:00:38Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Stale VRF recovery catches TOCTOU "already consumed" race gracefully -- re-reads state and returns valid result instead of crashing
- Timeout retry path gets same TOCTOU handling for when another crank consumes fresh randomness between retry_epoch_vrf and reveal
- Normal flow timeout recovery calculates remaining wait from actual VRF request_slot instead of hardcoded 305-slot wait -- avoids premature retries AND excessive waiting
- Added distinct ops monitoring log line: `[crank] VRF timeout recovery: waited X slots from request_slot Y, creating fresh randomness`

## Task Commits

Each task was committed atomically:

1. **Task 1: Handle "already consumed" TOCTOU + calculate remaining VRF timeout** - `4cc439c` (feat)

## Files Created/Modified
- `scripts/vrf/lib/vrf-flow.ts` - Added TOCTOU detection in both stale VRF and timeout retry catch blocks, replaced hardcoded 305-slot wait with request_slot-based calculation

## Decisions Made
- TOCTOU detection uses string matching on "already", "VrfNotPending", and "07DC" (ConstraintRaw hex) -- covers all three error paths (Solana runtime, epoch program custom error, Anchor constraint error)
- Both recovery paths get independent TOCTOU handling since another crank instance can race at either point in the flow
- The `[crank]` prefix (no indent) on the distinct log line differentiates it from `[recovery]` internal logs, making grep-based monitoring easier

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- VRF-04 and VRF-05 requirements satisfied
- vrf-flow.ts recovery paths are now TOCTOU-safe and slot-aware
- No blockers for remaining Phase 83 plans

---
*Phase: 83-vrf-crank-hardening*
*Completed: 2026-03-08*
