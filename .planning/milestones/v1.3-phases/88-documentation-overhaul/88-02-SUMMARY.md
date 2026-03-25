---
phase: 88-documentation-overhaul
plan: 02
subsystem: docs
tags: [documentation, spec, carnage, epoch, tax, transfer-hook, code-first]

requires:
  - phase: 88-01
    provides: "Stale docs archived, DOC_MANIFEST.md created"
provides:
  - "4 fresh code-first spec docs: carnage-spec, epoch-spec, tax-spec, transfer-hook-spec"
  - "Accurate developer reference for all 4 core programs"
affects: [88-03, 88-04, mainnet-readiness]

tech-stack:
  added: []
  patterns:
    - "Code-first documentation: read program source, write docs from code"

key-files:
  created:
    - "Docs/carnage-spec.md"
    - "Docs/epoch-spec.md"
    - "Docs/tax-spec.md"
    - "Docs/transfer-hook-spec.md"
  modified: []

key-decisions:
  - "All 4 specs written code-first from current program source, not copied from stale docs"
  - "Error codes documented with Anchor offset numbering (6000+) matching on-chain values"
  - "CPI depth chain documented as critical architectural constraint in Carnage spec"

patterns-established:
  - "Code-first spec docs: read source -> document behavior -> include account layouts, error codes, CPI dependencies"

duration: 12min
completed: 2026-03-08
---

# Phase 88 Plan 02: Core Spec Rewrites Summary

**4 program specs (Carnage, Epoch, Tax, Transfer Hook) rewritten code-first from current source with account layouts, error codes, and CPI chains**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-08T20:12:35Z
- **Completed:** 2026-03-08T20:24:00Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- Carnage spec documents all 6 execution paths, shared carnage_execution.rs module, ALT requirement, dual-hook ordering, slippage floors (85%/75%), CPI depth chain at Solana's 4-level limit
- Epoch spec documents full VRF lifecycle (commit-reveal-consume), anti-reroll protection, epoch skip safety properties, reserved [u8; 64] padding, retry_epoch_vrf timeout recovery, force_carnage devnet guard
- Tax spec documents buy/sell paths with sell floor propagation, pool reader with is_reversed detection, all error codes including 6014-6017, EpochState mirror struct with compile-time DATA_LEN assertion
- Transfer Hook spec documents whitelist PDA existence pattern, ExtraAccountMetaList schema with 4 accounts per mint, dual-hook ordering for PROFIT pools, direct invocation prevention via transferring flag

## Task Commits

1. **Task 1: Rewrite Carnage and Epoch spec docs** - `973293a` (docs)
2. **Task 2: Rewrite Tax and Transfer Hook spec docs** - `db6fbca` (docs)

## Files Created
- `Docs/carnage-spec.md` - Carnage Fund specification (304 lines)
- `Docs/epoch-spec.md` - Epoch/VRF specification (382 lines)
- `Docs/tax-spec.md` - Tax Program specification (345 lines)
- `Docs/transfer-hook-spec.md` - Transfer Hook specification (309 lines)

## Decisions Made
- All 4 specs written code-first: read actual program source files, wrote documentation from what the code does, not from existing stale specs
- Error codes documented with sequential Anchor numbering starting at 6000 (matching on-chain error values)
- CPI depth chain (4 levels: Epoch -> Tax -> AMM -> Token-2022 -> Hook) documented as critical constraint with DO NOT ADD warning

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 4 DOC-01 specs are current and accurate
- Ready for remaining Phase 88 plans (if any) or Phase 89

---
*Phase: 88-documentation-overhaul*
*Completed: 2026-03-08*
