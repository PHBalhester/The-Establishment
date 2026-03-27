---
phase: 105-crank-hardening
plan: 02
subsystem: crank
tags: [switchboard, vrf, instrumentation, backoff, crank-runner, observability]

# Dependency graph
requires:
  - phase: 105-crank-hardening
    plan: 01
    provides: "closeRandomnessAccount() inline calls and periodic sweep in crank-runner"
provides:
  - "VRF instrumentation fields (gatewayMs, revealAttempts, recoveryTimeMs, commitToRevealSlots) on EpochTransitionResult"
  - "RevealResult interface for tryReveal() timing data"
  - "Exponential backoff in tryReveal() (1s base, 16s cap) and cycle error retry (15s base, 240s cap)"
  - "Extended JSON log line with 4 VRF metrics for production monitoring"
affects: [106-vault-multi-hop-fix, 107-jupiter-sdk]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RevealResult return type for tryReveal() instrumentation"
    - "Exponential backoff with Math.min(base * 2^i, cap) pattern"
    - "snake_case VRF instrumentation fields in JSON log lines"

key-files:
  created: []
  modified:
    - "scripts/vrf/lib/vrf-flow.ts"
    - "scripts/crank/crank-runner.ts"

key-decisions:
  - "Happy-path tryReveal uses 5 attempts (~31s), recovery keeps 10 (~93s) -- faster fail for common case"
  - "commitToRevealSlots = 0 for recovery paths (commit was in a prior cycle, no meaningful measurement)"
  - "gatewayMs captures wall-clock of the successful revealIx() call, not cumulative retry time"
  - "JSON log uses snake_case for new fields (consistent with being a JSON log, not TypeScript)"

patterns-established:
  - "RevealResult { revealIx, attempts, durationMs } pattern for tryReveal instrumentation"
  - "Exponential backoff: Math.min(BASE * Math.pow(2, i), MAX) throughout crank/VRF"

# Metrics
duration: 5min
completed: 2026-03-25
---

# Phase 105 Plan 02: VRF Instrumentation + Exponential Backoff Summary

**EpochTransitionResult now carries gateway_ms/reveal_attempts/recovery_time_ms/commit_to_reveal_slots; tryReveal uses true exponential backoff (1s-16s); cycle errors use 15s-240s exponential instead of flat 30s**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-25T21:50:39Z
- **Completed:** 2026-03-25T21:55:53Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- EpochTransitionResult interface extended with 4 instrumentation fields for production VRF observability
- tryReveal() returns RevealResult with attempts + durationMs; exponential backoff replaces misleadingly-named linear formula
- Happy path uses 5 reveal attempts (~31s total), recovery paths keep 10 (~93s) for better fail-fast on common oracle responsiveness
- JSON log line extended with gateway_ms, reveal_attempts, recovery_time_ms, commit_to_reveal_slots
- Cycle error retry switched from flat 30s to exponential (15s, 30s, 60s, 120s, 240s)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add instrumentation fields to EpochTransitionResult and instrument vrf-flow.ts** - `4fb56cd` (feat)
2. **Task 2: Extend JSON log line and add exponential cycle error backoff in crank-runner.ts** - `12c5e54` (feat)

## Files Created/Modified
- `scripts/vrf/lib/vrf-flow.ts` - Added RevealResult interface, instrumented tryReveal() with timing data, exponential backoff, populated all return paths with CRANK-03 fields
- `scripts/crank/crank-runner.ts` - Extended JSON log entry with 4 VRF metrics, replaced flat 30s error retry with exponential 15s-240s backoff

## Decisions Made
- Happy-path tryReveal reduced from 10 to 5 attempts -- faster fail-through to timeout recovery when oracle is genuinely down
- Recovery paths keep 10 attempts -- already waited 300 slots, more retries worthwhile
- commitToRevealSlots = 0 for all recovery paths since commit TX was in a prior cycle
- gatewayMs captures only the successful revealIx() duration, not cumulative retry time (separate from revealAttempts which tracks total retries)
- JSON log fields use snake_case (gateway_ms, not gatewayMs) for log consistency

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed retryRevealResult passed as raw object instead of .revealIx**
- **Found during:** Task 1 (happy-path timeout recovery sendRevealAndConsume call)
- **Issue:** After changing tryReveal() to return RevealResult object, the happy-path recovery's sendRevealAndConsume call still passed the full RevealResult instead of .revealIx
- **Fix:** Changed `retryRevealResult` to `retryRevealResult.revealIx` in the sendRevealAndConsume call
- **Files modified:** scripts/vrf/lib/vrf-flow.ts
- **Verification:** TypeScript compiles without errors in target files
- **Committed in:** 4fb56cd (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for correctness -- passing wrong type to sendRevealAndConsume would crash at runtime.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- VRF instrumentation data now available in every JSON log line for production monitoring
- Exponential backoff reduces unnecessary RPC load during oracle outages
- Ready for 105-03 (if any remaining plans in phase) or next phase

---
*Phase: 105-crank-hardening*
*Completed: 2026-03-25*
