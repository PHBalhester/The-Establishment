---
phase: 47
plan: 03
subsystem: carnage-mev-protection
tags: [vrf-flow, carnage, atomic-bundling, mev, slippage, lock-window, typescript, rust, unit-tests]
depends_on:
  requires: ["47-01", "47-02"]
  provides: ["Atomic Carnage bundling in vrf-flow.ts", "Shared instruction builder", "Phase 47 unit test coverage"]
  affects: ["48", "50", "51"]
tech-stack:
  added: []
  patterns: ["Dynamic import to avoid circular dependency", "Post-consume Carnage detection with conditional TX4", "Shared instruction builder extracted from test flow"]
key-files:
  created: []
  modified:
    - scripts/vrf/lib/vrf-flow.ts
    - scripts/e2e/lib/carnage-flow.ts
    - programs/epoch-program/src/constants.rs
    - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
    - programs/epoch-program/src/instructions/execute_carnage.rs
decisions:
  - id: D47-03-01
    decision: "Use dynamic import() for buildExecuteCarnageAtomicIx in vrf-flow.ts to avoid circular dependency (carnage-flow already imports from vrf-flow)"
    rationale: "Static import would create a circular dependency chain: vrf-flow -> carnage-flow -> vrf-flow"
  - id: D47-03-02
    decision: "Option C (two sequential TXs) instead of bundling reveal+consume+executeCarnageAtomic in one TX"
    rationale: "Client cannot predict VRF result before submission. Including executeCarnageAtomic in non-Carnage epochs would fail the entire TX. The 50-slot lock window provides equivalent MEV protection."
  - id: D47-03-03
    decision: "carnageWsol field in carnageAccounts set to PublicKey.default -- resolved inside buildExecuteCarnageAtomicIx from keypair file"
    rationale: "The WSOL account keypair is loaded from disk at instruction build time. Callers don't need to know the pubkey in advance."
metrics:
  duration: "8 min"
  completed: "2026-02-19"
---

# Phase 47 Plan 03: Atomic Carnage Bundling Summary

**One-liner:** Post-consume Carnage detection in vrf-flow.ts sends executeCarnageAtomic as TX4 within 50-slot lock window, closing CARN-002 MEV gap; 12 new Rust unit tests for slippage floors and lock window.

## What Was Done

### Task 1: Carnage-aware atomic bundling (vrf-flow.ts + carnage-flow.ts)

**vrf-flow.ts changes:**
- Added `carnageAccounts` (17 fields) and `alt` (AddressLookupTableAccount) optional fields to `VRFAccounts` interface
- Added `carnageExecutedAtomically: boolean` to `EpochTransitionResult`
- After TX3 (reveal+consume), added TX4 conditional block:
  1. Wait 2s for RPC propagation
  2. Fetch EpochState to check `carnage_pending`
  3. If triggered: build and send executeCarnageAtomic via shared builder
  4. Use v0 VersionedTransaction with ALT if available (Sell path compression)
  5. Fallback to legacy TX for BuyOnly/Burn (fewer accounts)
  6. On failure: log and let the fallback path handle after lock window expires
- Updated `carnageTriggered` detection to account for atomic execution clearing the flag
- Recovery path returns `carnageExecutedAtomically: false`

**carnage-flow.ts changes:**
- Extracted `buildExecuteCarnageAtomicIx()` shared helper function:
  - Reads EpochState for carnage_target and carnage_action
  - Resolves Transfer Hook remaining_accounts (4 for BuyOnly/Burn, 8 for Sell)
  - Loads carnage-wsol keypair from disk
  - Builds the full 23-account instruction via epochProgram.methods.executeCarnageAtomic()
  - Exported for use by both carnage-flow.ts and vrf-flow.ts
- Refactored `testForcedCarnage` to use shared builder (eliminated ~100 lines of duplicated account wiring)
- Updated `testNaturalCarnage` to populate `carnageAccounts` and `alt` on VRFAccounts, enabling atomic bundling during epoch cycling
- Updated Carnage trigger detection to handle three scenarios:
  1. Atomically executed (no separate forced test needed)
  2. Triggered but atomic failed (falls through to testForcedCarnage)
  3. Not triggered (continue cycling)
- Used dynamic `import()` in vrf-flow.ts to avoid circular dependency

### Task 2: Unit tests for slippage floor and lock window constants

**constants.rs (5 new tests):**
- `test_carnage_slippage_bps_atomic`: Verifies 8500 value
- `test_carnage_slippage_bps_fallback`: Verifies 7500 value
- `test_carnage_lock_slots`: Verifies 50 slots, less than deadline
- `test_carnage_deadline_slots_updated`: Verifies 300 (Phase 47 increase)
- `test_lock_window_within_deadline`: Fallback window >= 200 slots invariant

**execute_carnage_atomic.rs (4 new tests):**
- `test_slippage_floor_rejects_low_output`: 849 < 850 minimum for expected=1000
- `test_slippage_floor_handles_large_values`: u128 arithmetic at 1 trillion tokens
- `test_slippage_floor_zero_expected`: Edge case zero input = zero minimum
- `test_old_50_percent_floor_is_gone`: New 85% > old 50% documented

**execute_carnage.rs (3 new tests):**
- `test_fallback_slippage_floor`: 75% floor = 750 for expected=1000
- `test_fallback_more_lenient_than_atomic`: 75% < 85% by design
- `test_lock_window_check_logic`: Three timing scenarios (during/after/expired)

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| D47-03-01 | Dynamic import() for shared builder | Avoids circular dependency (carnage-flow -> vrf-flow -> carnage-flow) |
| D47-03-02 | Two sequential TXs (Option C) | Client can't predict VRF result; bundling would fail on non-Carnage epochs |
| D47-03-03 | carnageWsol resolved from keypair at build time | Callers don't need the pubkey in advance; keypair loaded from disk |

## Verification Results

1. `cargo test -p epoch-program`: 71 passed (12 new), 8 failed (pre-existing, Phase 51 todo)
2. TypeScript compilation: No new errors in vrf-flow.ts or carnage-flow.ts
3. `carnageExecutedAtomically` present in vrf-flow.ts (8 occurrences)
4. `buildExecuteCarnageAtomicIx` exported from carnage-flow.ts, imported in vrf-flow.ts
5. `CARNAGE_SLIPPAGE_BPS_ATOMIC` used in both production code and tests

## Next Phase Readiness

Phase 47 (Carnage Hardening) is now complete:
- Plan 01: Constants, lock slot, slippage floor (atomic path)
- Plan 02: Fallback path hardening, lock window gate, auto-expire events
- Plan 03: Client-side atomic bundling, shared builder, unit test coverage

All three CARN-002 fixes are in place:
- On-chain: 50-slot lock window prevents fallback during atomic window
- On-chain: 85% atomic / 75% fallback slippage floors replace old 50%
- Client-side: vrf-flow.ts detects and executes Carnage within lock window

Ready for Phase 48 (next phase in v0.9 roadmap).
