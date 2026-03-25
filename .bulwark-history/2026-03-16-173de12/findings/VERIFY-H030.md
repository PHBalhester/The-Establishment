# VERIFY-H030: VRF Wait Loop
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence
`scripts/vrf/lib/vrf-flow.ts` `waitForSlotAdvance()` (lines 164-215) now has a wall-clock timeout:

1. **Configurable `maxWaitMs` parameter** (line 167): Optional third argument. Default is `Math.max(30_000, targetSlots * 400 * 3)` -- 3x the expected time at 400ms/slot with a 30-second floor.

2. **Timeout check before each poll iteration** (lines 195-201): `Date.now() - startTime > effectiveTimeout` is checked at the top of the `while(true)` loop, before sleeping. On timeout, it fetches the current slot one final time for diagnostics and throws:
   ```
   waitForSlotAdvance timed out after Xs. Target: T, current: C, started at: S
   ```

3. **Sleep cap for long waits** (line 182): The pre-poll sleep for long waits (>30 slots) is capped to `effectiveTimeout - 5_000` to ensure the function wakes up before the timeout expires.

4. **Logging** (line 175): Timeout value is logged at start so operators can see the expected wait window.

Call sites in `advanceEpochWithVRF` use the default timeout (no explicit `maxWaitMs`), which means:
- Oracle waits (3 slots): timeout = 30s (floor)
- VRF timeout recovery (~300 slots): timeout = max(30s, 300*400*3) = 360s (6 min)
- Epoch boundary waits (~750 slots): timeout = max(30s, 750*400*3) = 900s (15 min)

## Assessment
Fixed. The `waitForSlotAdvance` function now has a wall-clock timeout that throws an error if slot advancement stalls. The default heuristic (3x expected time, 30s floor) is reasonable -- generous enough to avoid false positives during normal slot variance, but prevents infinite loops if the network halts or RPC returns stale data. The thrown error will propagate to the crank runner's error handling and circuit breaker (H029).
