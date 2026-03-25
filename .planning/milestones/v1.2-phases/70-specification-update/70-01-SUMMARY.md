---
phase: 70-specification-update
plan: 01
subsystem: specification
tags: [bonding-curve, sell-back, reverse-integral, state-machine, tax-escrow, ATA-balance]

# Dependency graph
requires:
  - phase: v1.1 (Modal Mastercraft)
    provides: Existing Bonding_Curve_Spec.md with buy-only design
provides:
  - Updated Sections 1-7 of Bonding_Curve_Spec.md with sell-back math, state accounts, constraints
  - Reverse integral formula with 6-step tax deduction ordering
  - CurveState struct with sell/tax tracking fields (191 bytes)
  - CurveStatus state machine with Graduated terminal state and transition table
  - Tax escrow PDA definition with lifecycle
  - ATA balance-based cap enforcement
affects: [70-02 (Instructions), 70-03 (Sections 8-15), 71 (Program Scaffold), 72 (Core Instructions)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reverse integral for sell-back (same math as buy, applied backward)"
    - "Tax deduction on SOL output, not token count"
    - "ATA balance reads for cap enforcement (safe due to Transfer Hook whitelist)"
    - "SOL-only PDA for tax escrow (balance = lamports, no data struct)"

key-files:
  created: []
  modified:
    - docs/Bonding_Curve_Spec.md

key-decisions:
  - "CurveState size: 191 bytes (56 bytes added for sell/tax fields + tax_escrow pubkey)"
  - "participant_count kept as lightweight counter (4 bytes, incremented on first buy when ATA was 0)"
  - "Transitioned renamed to Graduated for clarity"
  - "Tax escrow is 0-byte SOL-only PDA; authoritative balance is lamports, not CurveState.tax_collected"

patterns-established:
  - "Elimination notes: removed sections include > blockquote explaining what replaced them and where to look"
  - "State machine transition table format: From/To/Trigger/Condition columns"

# Metrics
duration: 7min
completed: 2026-03-03
---

# Phase 70 Plan 01: Specification Update (Sections 1-7) Summary

**Reverse integral sell-back formula with 6-step tax ordering, expanded CurveState (191 bytes), Graduated state machine, tax escrow PDA, and ATA-based cap enforcement -- ParticipantState/WhitelistEntry/ReserveState removed**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-03T20:21:22Z
- **Completed:** 2026-03-03T20:28:05Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Sections 1-4 updated: removed buy-only and whitelist constraints, added complete sell-back math with reverse integral formula, explicit 6-step tax deduction ordering, slippage protection, and worked example
- Sections 5-7 updated: CurveState expanded with 4 new fields (191 bytes), CurveStatus state machine with transition table and Graduated terminal state, ParticipantState/WhitelistEntry/ReserveState removed with elimination notes, tax escrow PDA fully defined, purchase constraints use ATA balance reads, deadline timing clarified

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Sections 1-4 (Purpose, Constraints, Parameters, Curve Formula + Sell Math)** - `f8d0274` (docs)
2. **Task 2: Update Sections 5-7 (State Accounts, Constraints, Timing)** - `0f793bb` (docs)

## Files Created/Modified
- `docs/Bonding_Curve_Spec.md` - Updated Sections 1-7 with v1.2 design: sell-back mechanics, expanded state accounts, open access constraints

## Decisions Made
- **CurveState size = 191 bytes:** Added tokens_returned (u64), sol_returned (u64), tax_collected (u64), tax_escrow (Pubkey) = 56 new bytes. Total with discriminator: 199 bytes.
- **participant_count retained as lightweight u32 counter:** Incremented on first buy when user's ATA balance was 0. Cheap (4 bytes), useful for on-chain display, avoids requiring an indexer for a basic stat. Follows RESEARCH.md Open Question 1 recommendation.
- **Renamed Transitioned to Graduated:** Clearer semantics -- "Graduated" communicates the curve successfully completed and transitioned to pools.
- **Tax escrow is 0-byte SOL-only PDA:** The balance IS the lamports. No data struct, no desync risk. CurveState.tax_collected is a convenience counter only; authoritative balance is the escrow PDA lamports.
- **Deadline timing clarified:** Both curves should be started simultaneously so their deadline_slots are identical. Added note about deadline applying to both buys and sells.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Sections 1-7 are complete and internally consistent for v1.2
- Plan 02 can now reference correct state accounts, formulas, and constraints when updating Instructions (Section 8)
- Plan 03 can update Sections 9-15 knowing the state machine, escrow lifecycle, and removed accounts
- Remaining "Buy-only" reference in Section 15 (Invariants) is expected -- Plan 03 scope

---
*Phase: 70-specification-update*
*Completed: 2026-03-03*
