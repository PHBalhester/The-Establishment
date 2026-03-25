---
phase: 05-convergence
plan: 01
subsystem: documentation
tags: [anchor, account-architecture, instruction-spec, tax-program, pda]

# Dependency graph
requires:
  - phase: 04-gap-analysis
    provides: Gap inventory with GAP-004 and GAP-005 identified

provides:
  - Tax Program account architecture documentation
  - Complete swap instruction account lists for all 4 variants
  - All HIGH-severity gaps now filled (5/5)

affects: [implementation, security-audit, phase-06-validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stateless program design pattern (reads from EpochState)"
    - "Signer-only PDA pattern for CPI authority"
    - "Anchor-style account tables with Type and Description columns"

key-files:
  created: []
  modified:
    - Docs/Tax_Pool_Logic_Spec.md
    - .planning/audit/GAPS.md

key-decisions:
  - "Tax Program is stateless - reads tax config from EpochState, no TaxState account needed"
  - "swap_authority PDA is signer-only (no data stored) with seeds ['swap_authority']"
  - "PROFIT pool swaps have 9 accounts (no tax accounts); SOL pool swaps have 15 accounts"

patterns-established:
  - "Cross-program reference table showing Owner Program, Access, and Purpose"
  - "Token program references table for mixed SPL Token / Token-2022 pools"
  - "Pool type differences summary table"

# Metrics
duration: 8min
completed: 2026-02-02
---

# Phase 5 Plan 01: Tax Spec Gap Fill Summary

**Comprehensive account architecture and instruction account lists added to Tax_Pool_Logic_Spec.md, completing all HIGH-severity gaps**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-02
- **Completed:** 2026-02-02
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added Section 2 "Account Architecture" with stateless design rationale, swap_authority PDA specification, and cross-program references
- Added Section 10 "Swap Instructions" with complete Anchor-style account tables for swap_sol_buy, swap_sol_sell, swap_profit_buy, swap_profit_sell
- All 5 HIGH-severity gaps now filled (GAP-001, GAP-004, GAP-005, GAP-054, GAP-064)
- Fixed section numbering throughout Tax_Pool_Logic_Spec.md (now 1-16)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Account Architecture Section** - `20f6ab4` (docs)
2. **Task 2: Add Instruction Account Lists** - `baa5264` (docs)
3. **Task 3: Update GAPS.md Status** - `0c23b79` (docs)

## Files Created/Modified

- `Docs/Tax_Pool_Logic_Spec.md` - Added Section 2 (Account Architecture) and Section 10 (Swap Instructions), fixed all section numbering
- `.planning/audit/GAPS.md` - Updated dashboard (HIGH: 0 open, 5 filled), marked GAP-004 and GAP-005 as filled with resolution details

## Decisions Made

1. **Stateless Tax Program Design:** The Tax Program does not maintain its own state account. Tax configuration is read from EpochState (owned by Epoch Program), pool state from AMM Program, and distribution targets are external accounts. This eliminates state synchronization complexity.

2. **Signer-Only PDA Pattern:** The swap_authority PDA has seeds `["swap_authority"]` and no associated data. It exists solely to sign AMM CPI calls, proving to the AMM that swaps originated from the Tax Program after tax collection.

3. **Account Count Difference:** SOL pool swaps require 15 accounts (including epoch_state, staking_escrow, carnage_vault, treasury). PROFIT pool swaps only require 9 accounts since they are untaxed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Markdown formatting corruption:** The original Tax_Pool_Logic_Spec.md had corrupted markdown formatting after section 9 (missing code fences, broken section headers). Fixed as part of Task 1 edits.
- **Section renumbering:** Adding Section 2 and Section 10 required renumbering all subsequent sections. Final document has 16 sections (previously had 14).

## Next Phase Readiness

- All HIGH-severity gaps are now resolved (5/5)
- Ready to proceed with MEDIUM gaps (16 remaining) and CROSS-DOC gaps (3)
- Tax_Pool_Logic_Spec.md now at parity with Epoch_State_Machine_Spec.md quality level

---
*Phase: 05-convergence*
*Completed: 2026-02-02*
