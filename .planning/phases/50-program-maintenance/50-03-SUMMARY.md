# Phase 50 Plan 03: VRF Byte Reference Sweep Summary

**One-liner:** Corrected 18 stale VRF byte position references across 6 files (byte 3->5, need 6->8, MIN_VRF_BYTES 6->8)

## Execution Details

| Field | Value |
|-------|-------|
| Phase | 50-program-maintenance |
| Plan | 03 |
| Duration | ~1 min |
| Completed | 2026-02-20 |
| Tasks | 2/2 |
| Deviations | 0 |

## Tasks Completed

### Task 1: Fix stale byte references in Rust files
**Commit:** `8072a47`
**Files modified:**
- `programs/epoch-program/src/events.rs` -- CarnageNotTriggered doc comments: byte 3 -> byte 5
- `programs/epoch-program/src/errors.rs` -- InsufficientRandomness error message: "need 6" -> "need 8"
- `programs/epoch-program/src/instructions/consume_randomness.rs` -- Flow doc comments: MIN_VRF_BYTES = 6 -> 8, "less than 6 bytes" -> "less than 8 bytes"

**Verification:** `cargo test -p epoch-program` -- 81 tests pass. Zero `grep` hits for "byte 3" or "need 6" in target files.

### Task 2: Fix stale byte references in TypeScript files
**Commit:** `6e4c932`
**Files modified:**
- `scripts/e2e/lib/carnage-flow.ts` -- 5 occurrences of "byte 3 < 11" -> "byte 5 < 11" (comments and log messages)
- `scripts/vrf/lib/vrf-flow.ts` -- Carnage trigger comment byte 3 -> byte 5; replaced 4-line byte mapping with correct 8-byte layout (coinFlip/crimeLow/crimeHigh/fraudLow/fraudHigh/carnageTrigger/carnageAction/carnageCoin)
- `scripts/vrf/devnet-vrf-validation.ts` -- Carnage trigger log message byte 3 -> byte 5

**Verification:** Zero `grep` hits for "byte 3 <" or "byte 3.*carnage" in target files.

## What Changed and Why

Pre-Phase 37, the VRF byte layout used only 4 bytes: flip (0), low (1), high (2), carnage (3). Phase 37 expanded to 8 bytes with independent per-token tax rates (crimeLow, crimeHigh, fraudLow, fraudHigh) shifting Carnage trigger from byte 3 to byte 5.

The code logic was updated in Phase 37, but comments, error messages, and log strings were left stale. This plan sweeps all 18 stale references to prevent confusion during future maintenance and audit review.

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

No decisions required. Pure comment/string sweep with no behavioral changes.

## Success Criteria Verification

- [x] Zero occurrences of stale "byte 3" referencing Carnage trigger in any program or script source file
- [x] InsufficientRandomness error says "need 8"
- [x] consume_randomness.rs MIN_VRF_BYTES comments say 8
- [x] vrf-flow.ts has correct 8-byte VRF layout mapping
- [x] All 81 existing epoch-program tests pass

## Next Phase Readiness

No blockers. Plans 50-01 and 50-02 can be executed independently (wave 1 plan).
