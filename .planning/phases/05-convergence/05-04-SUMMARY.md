---
phase: 05-convergence
plan: 04
subsystem: documentation
tags: [tax-program, cpi-depth, error-handling, compute-budget, authority-signing, solana]

# Dependency graph
requires:
  - phase: 05-convergence-01
    provides: Tax spec account architecture (Section 2) and swap instructions (Section 10)
  - phase: 05-convergence-02
    provides: Carnage CPI depth analysis (Section 2 ARCHITECTURAL CONSTRAINT)
  - phase: 05-convergence-03
    provides: HIGH tier verification confirming quality baseline
provides:
  - Complete Tax_Pool_Logic_Spec.md with all 9 gaps filled (5 HIGH + 4 MEDIUM)
  - CPI depth analysis for all Tax swap variants (Section 11)
  - Compute budget estimates with frontend recommendations (Section 12)
  - CPI authority signing chain documentation (Section 13)
  - TaxError enum with 11 error variants (Section 19)
affects: [05-convergence verification plans, phase-06-validation, implementation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CPI depth documentation pattern: ASCII tree diagrams with depth annotations"
    - "Error enum pattern: Anchor #[error_code] with descriptive #[msg] attributes"
    - "Compute budget documentation: CU estimate table with frontend recommendations"

key-files:
  created: []
  modified:
    - Docs/Tax_Pool_Logic_Spec.md
    - .planning/audit/GAPS.md

key-decisions:
  - "Tax spec expanded from 16 to 20 sections to accommodate CPI depth, compute budget, authority chain, and error handling"
  - "Compute budget recommendation: 200k CU standard, 300k CU multi-hop (provides ~40% safety margin)"
  - "Error handling follows Epoch spec pattern with 11 TaxError variants covering all swap failure modes"

patterns-established:
  - "CPI depth + compute budget + authority chain as a documentation trio for any CPI-heavy program"

# Metrics
duration: 8min
completed: 2026-02-03
---

# Phase 5 Plan 04: Tax Spec MEDIUM Gaps Summary

**CPI depth analysis, compute budget estimates, authority signing chain, and TaxError enum completing Tax_Pool_Logic_Spec.md to match Epoch spec quality**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-03T16:24:16Z
- **Completed:** 2026-02-03T16:32:04Z
- **Tasks:** 4
- **Files modified:** 2

## Accomplishments
- Tax spec now has 20 sections covering all 14 gap categories (was 16 sections)
- All 9 Tax spec gaps resolved (5 HIGH from Plans 01/02, 4 MEDIUM from this plan)
- CPI depth documented for all 4 swap variants with ASCII tree diagrams
- Compute budget estimates with concrete CU numbers and frontend recommendations
- Authority signing chain with flow diagrams for both user swaps and Carnage execution
- TaxError enum with 11 variants covering swap failures, token mismatches, and authorization

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CPI Depth Analysis (GAP-006)** - `c24a514` (feat)
2. **Task 2: Add Error Handling (GAP-007)** - `7ace35b` (feat)
3. **Task 3: Add Compute Budget + Authority Signing (GAP-065, GAP-066)** - `0857a5a` (feat)
4. **Task 4: Update GAPS.md** - `1e26464` (docs)

## Files Created/Modified
- `Docs/Tax_Pool_Logic_Spec.md` - Added Sections 11 (CPI Depth), 12 (Compute Budget), 13 (Authority Chain), 19 (Error Handling); renumbered sections 14-20
- `.planning/audit/GAPS.md` - Dashboard: MEDIUM 1 Open / 15 Filled; 4 filled gap entries added

## Decisions Made
- Tax spec section numbering expanded (16 -> 20) to accommodate new content rather than cramming into existing sections
- Compute budget: 200k CU recommended for standard swaps based on ~120-150k estimated usage with ~40% safety margin
- Error handling placed at Section 19 (near end, before Summary) following Epoch spec's error positioning pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tax_Pool_Logic_Spec.md is now the most comprehensive spec (20 sections, 0 remaining gaps)
- Matches Epoch_State_Machine_Spec.md quality (the Phase 4 exemplar)
- GAPS.md shows only 4 gaps remaining: 1 MEDIUM (GAP-057 cross-doc) + 3 LOW (GAP-008, GAP-052, GAP-062)
- Ready for remaining convergence plans or Phase 6 validation

---
*Phase: 05-convergence*
*Completed: 2026-02-03*
