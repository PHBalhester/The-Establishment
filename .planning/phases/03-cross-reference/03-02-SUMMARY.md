---
phase: 03-cross-reference
plan: 02
subsystem: documentation
tags: [cross-reference, matrix-building, specification-audit, conflict-detection]

# Dependency graph
requires:
  - phase: 03-01
    provides: Concept inventory with 85 concepts across 7 types
provides:
  - Six category-split cross-reference matrices
  - Systematic comparison of concepts across 12 documents
  - Agreements/discrepancies/single-source marking
  - Foundation for conflict detection (Plan 03)
affects: [03-03, 04-gap-analysis, 05-convergence]

# Tech tracking
tech-stack:
  added: []
  patterns: [category-split-matrices, status-marking, semantic-normalization]

key-files:
  created:
    - .planning/cross-reference/01-constants-matrix.md
    - .planning/cross-reference/02-entities-matrix.md
    - .planning/cross-reference/03-behaviors-matrix.md
    - .planning/cross-reference/04-constraints-matrix.md
    - .planning/cross-reference/05-formulas-matrix.md
    - .planning/cross-reference/06-terminology-matrix.md
  modified: []

key-decisions:
  - "Category-split approach: one matrix per concept type for pattern clustering"
  - "Normalization rules prevent false conflicts (1% = 100 bps)"
  - "Single-source concepts flagged for Phase 4 gap analysis"
  - "High single-source in formulas is expected - authoritative definitions should live in one place"

patterns-established:
  - "Status marking: AGREEMENT / DISCREPANCY / SINGLE-SOURCE"
  - "Matrix format: | Document | Value | Location | Context |"
  - "Behavioral sequences capture step order, not just presence"

# Metrics
duration: 8min
completed: 2026-02-01
---

# Phase 3 Plan 2: Cross-Reference Matrix Building Summary

**Six category-split matrices built covering 77 concepts (Constants, Entities, Behaviors, Constraints, Formulas, Terminology) with systematic status marking and semantic normalization - zero discrepancies found, specifications align**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-01T22:38:00Z
- **Completed:** 2026-02-01T22:46:00Z
- **Tasks:** 3
- **Files created:** 6

## Accomplishments

- Built six category-split cross-reference matrices from concept inventory
- Cross-referenced 77 concepts across 12 specification documents (8 assumptions feed into Plan 03)
- Applied semantic normalization (1% = 100 bps, ~30 min = 4500 slots)
- Identified 56 agreements, 0 discrepancies, 21 single-source concepts
- Flagged single-source items for Phase 4 gap analysis

## Task Commits

Each task was committed atomically:

1. **Task 1: Build constants cross-reference matrix** - `c5386c0` (docs)
2. **Task 2: Build entities and behaviors matrices** - `9a3764e` (docs)
3. **Task 3: Build constraints, formulas, terminology matrices** - `afc3d9e` (docs)

## Files Created

| File | Concepts | Agreements | Discrepancies | Single-Source |
|------|----------|------------|---------------|---------------|
| 01-constants-matrix.md | 15 | 12 | 0 | 3 |
| 02-entities-matrix.md | 14 | 9 | 0 | 5 |
| 03-behaviors-matrix.md | 16 | 12 | 0 | 4 |
| 04-constraints-matrix.md | 14 | 13 | 0 | 1 |
| 05-formulas-matrix.md | 8 | 2 | 0 | 6 |
| 06-terminology-matrix.md | 10 | 7 | 0 | 3 |
| **Total** | **77** | **55** | **0** | **22** |

## Key Findings

### Zero Discrepancies

No conflicts found between documents. This is a positive sign - the specification documents are internally consistent. The v3 failure was due to unstated assumptions (WSOL using SPL Token), not contradictory statements.

### High Single-Source in Formulas (Expected)

6 of 8 formulas are single-source. This is appropriate - formulas should have one authoritative definition:
- FORM-001 (AMM pricing) and FORM-002 (Tax calculation) have agreements
- Other formulas are domain-specific (epoch calc, yield calc, bonding curve) and live in their respective specs

### Single-Source Items for Phase 4

Items documented in only one place should be evaluated for:
1. **Gap detection:** Should they appear in Overview?
2. **Intentional single-source:** Some details belong only in implementation specs

**Constants (3):** VRF_TIMEOUT_SLOTS, TRIGGER_BOUNTY, MAX_CARNAGE_SWAP
**Entities (5):** YieldState, UserYieldAccount, Pool State, WhitelistEntry, CurveState
**Behaviors (4):** Yield cumulative update, Auto-claim, Transfer hook validation, VRF retry
**Constraints (1):** Per-wallet token cap (20M)
**Formulas (6):** Epoch calc, yield formulas, ATA derivation, bonding curve, no-arb band
**Terminology (3):** Checkpoint model, Ghost yield attack, Circulating supply

## Normalization Rules Applied

| Category | Rule | Example |
|----------|------|---------|
| Percentages | Always express in bps | 1% = 100 bps |
| Time | Keep specified unit | 4500 slots (~30 min) |
| Token programs | Explicit program ID | WSOL = SPL Token, IPA/IPB/OP4 = Token-2022 |
| Semantic equivalence | Synonyms not conflicts | "cheap to buy" = "low buy tax" |

## Decisions Made

1. **Category-split matrices:** One file per concept type allows pattern clustering by domain
2. **Status marking system:** Clear AGREEMENT/DISCREPANCY/SINGLE-SOURCE for systematic tracking
3. **Behavioral step capture:** Sequences include step order, not just "mentioned/not mentioned"
4. **Formula single-source acceptance:** Authoritative definitions belong in one place

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all 12 specification documents were well-structured and cross-referenceable.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready for Plan 03:** Matrices provide systematic comparison structure for conflict detection
- **Conflict analysis can proceed:** All concepts have status markers
- **Assumptions ready:** 8 assumptions from inventory inform Plan 03 analysis

### Key items for Plan 03 conflict detection:

1. **CONSTR-007 (WSOL uses SPL Token):** Critical constraint - verify all docs that mention WSOL align
2. **ASSUMP-003 (WSOL vault security):** Relies on AMM access control, assumption explicitly documented
3. **Single-source behaviors:** Some may indicate underdocumented flows

---
*Phase: 03-cross-reference*
*Completed: 2026-02-01*
