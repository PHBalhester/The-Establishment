---
phase: 35-vrf-devnet-validation
plan: 02
subsystem: infra
tags: [epoch-program, devnet, vrf, switchboard, validation]

# Dependency graph
requires:
  - phase: 35-01
    provides: "Epoch Program with 750-slot epochs on devnet"
provides:
  - "5 consecutive VRF-driven epoch transitions verified on devnet"
  - "VRF validation scripts (reusable for future testing)"
  - "Validation report with TX signatures and tax rate data"
affects: [35-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VRF timeout recovery: detect stale VRF, use retry_epoch_vrf with fresh randomness"
    - "Switchboard enum deserialization: handle both numeric (0/1) and object ({crime:{}}) representations"
    - "Oracle resilience: tryReveal() with configurable retries + fallback to timeout recovery"

key-files:
  created:
    - "scripts/vrf/devnet-vrf-validation.ts"
    - "scripts/vrf/vrf-validation-report.md"
  modified:
    - "scripts/vrf/lib/vrf-flow.ts"
    - "scripts/vrf/lib/epoch-reader.ts"

key-decisions:
  - "20 reveal retries at 3s intervals before falling back to VRF timeout recovery"
  - "skipPreflight: true for TX1 create (SDK LUT staleness issue)"
  - "Handle cheapSide as both numeric and object enum for compatibility"
  - "Use PDA manifest for all account addresses (no hardcoded keys)"

patterns-established:
  - "VRF 3-TX flow with built-in oracle failover via timeout recovery"
  - "Epoch boundary polling with 15s intervals and progress logging"
  - "Rate-limited RPC calls (200ms between non-critical calls)"

# Metrics
duration: ~35min (including oracle recovery from previous failed run)
completed: 2026-02-11
---

# Phase 35 Plan 02: VRF Devnet Validation Summary

**5 consecutive VRF-driven epoch transitions completed on devnet with real Switchboard oracles. All tax rates verified within spec bands.**

## Performance

- **Duration:** ~35 min (including VRF recovery + 5 transitions + epoch waits)
- **Started:** 2026-02-11T22:05:00Z (approx)
- **Completed:** 2026-02-11T22:41:00Z (approx)
- **Tasks:** 2/2 (build scripts + execute validation)
- **Files created:** 2 (orchestrator + report)
- **Files modified:** 2 (vrf-flow.ts + epoch-reader.ts)
- **SOL cost:** 0.0494 SOL

## Accomplishments

### VRF Validation Results (5/5 PASSED)

| # | Epoch | Cheap Side | Flipped | Low Tax | High Tax | Duration |
|---|-------|------------|---------|---------|----------|----------|
| 1 | 71 | CRIME | Yes | 400 bps | 1100 bps | 47s |
| 2 | 72 | FRAUD | Yes | 200 bps | 1400 bps | 45s |
| 3 | 73 | FRAUD | No | 100 bps | 1200 bps | 47s |
| 4 | 74 | CRIME | Yes | 100 bps | 1100 bps | 45s |
| 5 | 75 | FRAUD | Yes | 100 bps | 1200 bps | 48s |

### Statistical Analysis
- **Flips:** 4/5 (80%) -- consistent with 75% flip probability
- **Unique low rates:** 100, 200, 400 bps (3 of 4 possible values)
- **Unique high rates:** 1100, 1200, 1400 bps (3 of 4 possible values)
- **Both cheap sides observed:** CRIME and FRAUD
- **Carnage triggers:** 0/5 (expected: P(0 in 5) = ~80% with 4.3% per-epoch rate)
- **Oracle response:** First attempt for all 5 transitions (after initial recovery)

### Scripts Built
- `scripts/vrf/devnet-vrf-validation.ts` (21KB) -- Main orchestrator with pre-flight checks, epoch boundary waiting, and modular structure for Plan 03 security tests
- `scripts/vrf/lib/vrf-flow.ts` (17KB) -- Reusable 3-TX VRF flow with oracle failover, timeout recovery, and robust enum handling
- `scripts/vrf/lib/epoch-reader.ts` (9KB) -- EpochState reading and tax rate verification with 6 validation checks
- `scripts/vrf/lib/reporter.ts` (11KB) -- Structured markdown report generator
- `scripts/vrf/vrf-validation-report.md` -- Generated report with all TX signatures

### VRF Recovery (Pre-validation)
- Previous run left VRF pending due to oracle `162.19.171.93` going offline
- Recovery: used `retry_epoch_vrf` to clear stale VRF with fresh randomness account
- New oracle responded on first attempt, confirming single-oracle failure (not systemic)

## Task Commits

1. **Task 1: Build VRF flow helper modules** -- `2e4db75` (previous session)
2. **Task 2: Orchestrator + 5 epoch transitions** -- `9cc82b8` (this session)

## Files Created/Modified

- `scripts/vrf/devnet-vrf-validation.ts` -- Main validation orchestrator
- `scripts/vrf/vrf-validation-report.md` -- Generated validation report with TX sigs
- `scripts/vrf/lib/vrf-flow.ts` -- Added tryReveal(), sendRevealAndConsume(), VRF timeout recovery, RPC error resilience
- `scripts/vrf/lib/epoch-reader.ts` -- Fixed cheapSide deserialization (handle both numeric and object enum)

## Decisions Made

- **20 reveal retries at 3s intervals:** The Switchboard SDK's `revealIx()` makes an HTTP POST to the oracle gateway. With 3s between calls, 20 retries gives ~60s window which covers most oracle latencies. If all fail, falls back to VRF timeout recovery.
- **skipPreflight for TX1:** The SDK's randomness create instruction uses an address lookup table (LUT) that references a finalized slot. Preflight simulation can reject this if the slot reference is slightly stale, but the actual on-chain execution succeeds.
- **cheapSide dual handling:** Anchor serializes fieldless Rust enums inconsistently across versions -- sometimes as numbers (0/1), sometimes as objects ({crime:{}}). Both are handled for forward compatibility.

## Deviations from Plan

- **Oracle failure during initial attempt** required VRF recovery before starting the 5-transition run. This was handled automatically by the script's built-in recovery logic.
- **Script modifications during execution** to fix cheapSide deserialization and add oracle resilience were committed alongside the final execution results.

## Issues Encountered

- **Switchboard oracle 162.19.171.93 went offline** during the first attempt (previous session), blocking TX3 reveal. Confirmed to be external infrastructure failure, not code issue. Other oracles in the queue responded normally.
- **No issues during the successful 5-transition run** -- all oracles responded on first attempt.

## Validation Proof

All 15 transaction signatures (3 per transition x 5 transitions) are recorded in `scripts/vrf/vrf-validation-report.md` and can be verified on Solscan devnet:
- EpochState PDA: `DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU`
- Final state: epoch=75, cheapSide=FRAUD, lowTax=100bps, highTax=1200bps

## Next Phase Readiness

- VRF validation orchestrator is modular and ready for Plan 03 security tests
- Reporter class supports security tests, timeout recovery, and swap verification sections
- No blockers for Plan 03

---
*Phase: 35-vrf-devnet-validation*
*Completed: 2026-02-11*
