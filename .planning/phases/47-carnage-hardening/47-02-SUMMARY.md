---
phase: 47-carnage-hardening
plan: 02
subsystem: epoch-program/carnage
tags: [carnage, slippage, lock-window, fallback, events, security]

dependency-graph:
  requires: [47-01]
  provides: [fallback-carnage-hardening, carnage-failed-events]
  affects: [47-03, 49]

tech-stack:
  added: []
  patterns:
    - "Lock window gate on fallback Carnage (CarnageLockActive)"
    - "u128 BPS slippage calculation with named constant"
    - "Dual event emission for backward compatibility (CarnageExpired + CarnageFailed)"

file-tracking:
  key-files:
    created: []
    modified:
      - programs/epoch-program/src/instructions/execute_carnage.rs
      - programs/epoch-program/src/instructions/expire_carnage.rs
      - programs/epoch-program/src/instructions/consume_randomness.rs
      - .planning/REQUIREMENTS.md

decisions:
  - id: D-47-02-01
    decision: "SEC-04 confirmed complete: discriminator + swap_authority already present in execute_carnage.rs"
    rationale: "Both the swap_exempt discriminator bytes and swap_authority AccountInfo matched execute_carnage_atomic.rs exactly"

metrics:
  duration: "4 min"
  completed: 2026-02-19
---

# Phase 47 Plan 02: Fallback Carnage Path Hardening Summary

**Lock window gate + 75% slippage floor on fallback execute_carnage, CarnageFailed diagnostic events on expire paths**

## What Was Done

### Task 1: Lock Window Enforcement + 75% Slippage on Fallback Path
- Added `CARNAGE_SLIPPAGE_BPS_FALLBACK` import to `execute_carnage.rs`
- Inserted lock window check immediately after deadline check: `require!(clock.slot > carnage_lock_slot, CarnageLockActive)` prevents fallback from executing during the 50-slot atomic-only window
- Replaced naive `expected / 2` (50%) slippage floor with proper u128 BPS calculation using `CARNAGE_SLIPPAGE_BPS_FALLBACK` (7500 = 75%), matching the arithmetic pattern established in execute_carnage_atomic.rs
- Updated doc comments: "100-slot deadline" -> "300-slot deadline", added lock window documentation
- **SEC-04 verified**: discriminator `[0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c]` and `swap_authority` AccountInfo both present; marked complete in REQUIREMENTS.md

### Task 2: CarnageFailed Event Emission
- `expire_carnage.rs`: Added `CarnageFailed` event emission after existing `CarnageExpired` (backward compat preserved). Includes `vault_balance` from sol_vault lamports and `slot` for timing diagnostics
- `consume_randomness.rs`: Added `CarnageFailed` event in auto-expire block (section 0) for completeness when stale pending Carnage is cleared during next epoch's consume_randomness
- Both use `attempted_amount: 0` since failing transactions roll back entirely (no way to know what was attempted)

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check -p epoch-program` | Pass (0 errors, warnings only) |
| `cargo test -p epoch-program` | 59 pass, 8 pre-existing failures (Phase 51) |
| CarnageLockActive in execute_carnage.rs | Confirmed |
| CARNAGE_SLIPPAGE_BPS_FALLBACK in execute_carnage.rs | Confirmed (import + usage) |
| CarnageFailed in expire_carnage.rs | Confirmed |
| CarnageFailed in consume_randomness.rs | Confirmed |
| SEC-04 discriminator match | Confirmed |
| SEC-04 swap_authority present | Confirmed |

## Commits

| Hash | Message |
|------|---------|
| 308f3a7 | feat(47-02): add lock window enforcement and 75% slippage to fallback Carnage |
| 991c555 | feat(47-02): emit CarnageFailed event from expire_carnage and auto-expire |

## Requirements Addressed

- **SEC-04**: Complete -- fallback Carnage path has correct discriminator bytes and swap_authority account (confirmed, not changed -- were already present)
- **SEC-05**: Partial -- 75% slippage floor (CARNAGE_SLIPPAGE_BPS_FALLBACK) now applied to fallback path. Atomic path was done in 47-01. Full SEC-05 completion pending swap_exempt minimum output update in 47-03.

## Next Phase Readiness

Plan 47-03 (atomic bundling + final integration) can proceed. All shared definitions from 47-01 are in use:
- `CARNAGE_SLIPPAGE_BPS_ATOMIC` used by execute_carnage_atomic.rs (47-01)
- `CARNAGE_SLIPPAGE_BPS_FALLBACK` used by execute_carnage.rs (this plan)
- `CARNAGE_LOCK_SLOTS` used by consume_randomness.rs (47-01) for setting lock_slot
- `CarnageLockActive` error checked in execute_carnage.rs (this plan)
- `CarnageFailed` event emitted by expire_carnage.rs + consume_randomness.rs (this plan)
