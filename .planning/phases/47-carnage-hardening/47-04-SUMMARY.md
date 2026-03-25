---
phase: 47-carnage-hardening
plan: 04
subsystem: epoch-program/carnage
tags: [carnage, mev, atomic-bundling, vrf, v0-transaction]
dependency-graph:
  requires: ["47-01", "47-02", "47-03"]
  provides: ["atomic-carnage-bundling-in-tx3", "no-op-guard-execute-carnage-atomic"]
  affects: ["continuous-runner", "carnage-hunter"]
tech-stack:
  added: []
  patterns: ["no-op-guard-for-conditional-bundling", "v0-tx-bundling-three-instructions"]
key-files:
  created: []
  modified:
    - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
    - scripts/vrf/lib/vrf-flow.ts
decisions:
  - id: D-47-04-01
    decision: "Remove carnage_pending constraint from struct, add no-op guard in handler"
    rationale: "Allows instruction to be bundled in every TX without knowing VRF result"
  - id: D-47-04-02
    decision: "Bundle reveal+consume+executeCarnageAtomic in one v0 TX (600k CU)"
    rationale: "Eliminates CARN-002 MEV window entirely -- zero gap between consume and swap"
  - id: D-47-04-03
    decision: "Detect atomic Carnage from post-TX3 state (lastCarnageEpoch == currentEpoch)"
    rationale: "No-op path also returns Ok(), so can't distinguish from TX success alone"
metrics:
  duration: "13 min"
  completed: "2026-02-19"
---

# Phase 47 Plan 04: Gap Closure -- True Atomic Carnage Bundling Summary

**One-liner:** No-op guard on executeCarnageAtomic + v0 TX bundling (reveal+consume+carnage) eliminates CARN-002 MEV window entirely

## What Was Done

### Task 1: Make executeCarnageAtomic no-op when carnage_pending is false
- **Removed** the `constraint = epoch_state.carnage_pending @ EpochError::NoCarnagePending` from the `ExecuteCarnageAtomic` struct
- **Added** no-op early return at the top of the handler: `if !ctx.accounts.epoch_state.carnage_pending { return Ok(()); }`
- **Updated** module-level and handler doc comments to reflect safe bundling behavior
- **Safety:** Account validation (PDA seeds, bumps, initialized checks) still runs on the no-op path. No state mutation, no events emitted. Compute cost is ~100 CU for validation + early return.
- **Commit:** `ee7404f`

### Task 2: Bundle executeCarnageAtomic into the reveal+consume TX
- **Modified** `sendRevealAndConsume` to build a v0 VersionedTransaction with three instructions (reveal + consume + executeCarnageAtomic) when `carnageAccounts` and `alt` are provided
- **Removed** the entire TX4 conditional section (~85 lines) that previously sent executeCarnageAtomic as a separate transaction
- **Added** post-TX3 Carnage detection: checks `lastCarnageEpoch === currentEpoch` to determine if Carnage executed atomically
- **Compute budget:** 600,000 CU for the combined TX (covers reveal ~50k + consume ~100k + executeCarnageAtomic ~300k)
- **Backward compatible:** When carnageAccounts not provided, builds legacy Transaction with just reveal + consume
- **Commit:** `2a81f63`

## Security Impact

**CARN-002 MEV gap: FULLY CLOSED.** Previously, there was a window between TX3 (consume_randomness sets carnage_pending=true) and TX4 (executeCarnageAtomic does the swap). During this window, an MEV bot could observe the CarnagePending event and front-run the swap. Now, all three instructions execute atomically in a single transaction -- no CarnagePending event is visible on-chain until the swap has already completed.

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| D-47-04-01 | No-op guard in handler (not constraint removal only) | Handler-level guard allows instruction to be safely included in every TX without knowing VRF result |
| D-47-04-02 | 600k CU compute budget for bundled TX | Covers reveal (~50k) + consume (~100k) + executeCarnageAtomic (~300k swap path) with headroom |
| D-47-04-03 | Post-TX3 state detection for Carnage execution | Since no-op path also returns Ok(), must check lastCarnageEpoch to distinguish Carnage from no-op |

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check -p epoch-program` | Clean (warnings only, pre-existing) |
| `cargo test -p epoch-program execute_carnage` | 8/8 pass |
| NoCarnagePending NOT in struct | Confirmed removed |
| No-op guard in handler | Confirmed at line 215 |
| `Reveal+Consume+CarnageAtomic` in vrf-flow.ts | Confirmed at line 304 |
| `[tx4]` in vrf-flow.ts | No matches (fully removed) |
| `carnageExecutedAtomically` tracked | Confirmed via post-state detection |
| Backward compatibility (legacy TX path) | Preserved in else branch |

## Next Phase Readiness

Phase 47 is now fully complete (4/4 plans). The Carnage hardening phase has:
- SEC-03: Slippage floor (85% atomic, 50% fallback) -- Plan 47-01
- SEC-04: Dual-path Carnage (atomic + fallback with lock window) -- Plan 47-02
- CARN-002: Atomic bundling with shared instruction builder -- Plan 47-03
- CARN-002 gap closure: True single-TX bundling via no-op guard -- Plan 47-04

All on-chain programs compile, all tests pass (excluding 8 pre-existing trigger_epoch_transition failures tracked for Phase 51).
