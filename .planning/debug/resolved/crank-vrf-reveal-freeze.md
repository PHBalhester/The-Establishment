---
status: resolved
trigger: "Mainnet crank freezes completely after TransactionExpiredBlockheightExceededError on VRF reveal (tx3). After one 30s retry, no more logs appear."
created: 2026-03-25T00:00:00Z
updated: 2026-03-25T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - Crank waits ~30 min for next epoch boundary even when VRF recovery is needed
test: Traced code path after TX3 failure
expecting: Found the unnecessary wait
next_action: Implement fix - skip epoch boundary wait when vrfPending=true

## Symptoms

expected: Crank should retry or move on and continue operating
actual: Crank outputs "Retrying in 30s..." then produces no more output for 15+ minutes
errors: TransactionExpiredBlockheightExceededError on reveal tx (tx3)
reproduction: Mainnet crank, cycle 3. Previous cycles 1-2 worked.
started: Just happened, rent reclaim feature deployed today

## Eliminated

- hypothesis: Unhandled promise rejection or missing try/catch
  evidence: The catch block at line 610 properly catches all errors. The while loop continues after retry.
  timestamp: 2026-03-25T00:00:30Z

- hypothesis: RPC hang (confirmTransaction with signature-only overload)
  evidence: The hang happens BEFORE advanceEpochWithVRF is even called. The crank-runner's slot wait at lines 522-544 runs first.
  timestamp: 2026-03-25T00:00:45Z

## Evidence

- timestamp: 2026-03-25T00:00:15Z
  checked: crank-runner.ts main loop error handling (lines 610-635)
  found: Catch block properly logs, sleeps 30s, and continues loop. No hang here.
  implication: The hang is in the NEXT iteration, not in error handling.

- timestamp: 2026-03-25T00:00:30Z
  checked: Code path after retry sleep - lines 468-549
  found: After TX3 fails, TX2 (trigger_epoch_transition) already ran, so epochStartSlot was updated to a recent slot. The slot wait at lines 525-544 calculates slotsToWait = 4500 - ~75 + 10 = ~4435 slots (~29.5 min). Crank waits for the NEXT epoch boundary.
  implication: The crank appears frozen but is actually waiting ~30 min for an epoch boundary it doesn't need.

- timestamp: 2026-03-25T00:00:45Z
  checked: advanceEpochWithVRF recovery path (lines 422-653 in vrf-flow.ts)
  found: When vrfPending=true, recovery correctly detects stale VRF and completes it. But this code is only reached AFTER the unnecessary 30-min wait in crank-runner.ts.
  implication: The VRF recovery logic is sound. The bug is in crank-runner.ts ordering.

## Resolution

root_cause: When TX3 (reveal+consume) fails with TransactionExpiredBlockheightExceededError but TX2 (commit+trigger) succeeded, the on-chain epochStartSlot was already updated. On retry, crank-runner.ts calculates ~4500 slots remaining until the NEXT epoch boundary and waits ~30 minutes BEFORE calling advanceEpochWithVRF, even though the current epoch just needs VRF recovery (which advanceEpochWithVRF handles internally). The user perceives this as a complete freeze.
fix: Added vrfPending check before epoch boundary wait in crank-runner.ts. When vrfPending=true, skips the ~30-minute slot wait and proceeds directly to advanceEpochWithVRF which handles VRF recovery internally.
verification: TypeScript compiles clean (no new errors). Logic verified: vrfPending=true only skips slot wait, advanceEpochWithVRF recovery path handles all stale VRF cases. Edge cases: crank restart with pending VRF (correct -- recovers immediately), normal cycle (vrfPending=false, wait as before).
files_changed: [scripts/crank/crank-runner.ts]
