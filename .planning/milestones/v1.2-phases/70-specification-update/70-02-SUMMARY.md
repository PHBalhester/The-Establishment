---
phase: 70-specification-update
plan: 02
subsystem: specification
tags: [bonding-curve, sell-instruction, burn-and-claim, tax-escrow, multi-tx-graduation, refund]

# Dependency graph
requires:
  - phase: 70-01
    provides: Updated Sections 1-7 with sell-back math, CurveState (191 bytes), state machine, tax escrow PDA
provides:
  - Complete v1.2 instruction set in Section 8 (11 active instructions + graduation orchestration)
  - Sell instruction with 10-step logic, slippage protection, 15% tax routing
  - Burn-and-claim refund with worked solvency proof (3-user sequential example)
  - consolidate_for_refund and distribute_tax_escrow lifecycle instructions
  - Multi-TX graduation replacing monolithic 32-account execute_transition
affects: [70-03 (Sections 9-15 updates), 71 (Program Scaffold), 72 (Core Instructions), 73 (Graduation), 74 (Client Orchestration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Burn-and-claim refund: burn tokens, receive proportional SOL, denominator shrinks for next claimer"
    - "Multi-TX graduation: lightweight on-chain state changes + client-side asset movement using existing instructions"
    - "Permissionless instruction pattern: consolidate_for_refund, distribute_tax_escrow, prepare_transition callable by anyone"
    - "ATA balance read for cap enforcement in purchase (no ParticipantState PDA)"

key-files:
  created: []
  modified:
    - docs/Bonding_Curve_Spec.md

key-decisions:
  - "Section numbers preserved for removed instructions (8.4 marked REMOVED, not renumbered) to maintain cross-references"
  - "Sell tokens return to vault (not burned) so they can be re-purchased -- maintains curve fungibility"
  - "sol_returned tracks gross SOL (before tax) to preserve identity: sol_vault_balance == sol_raised - sol_returned"
  - "participant_count incremented when user_ata_balance == 0 (first buy); sell-and-rebuy does NOT double-count (acceptable for convenience stat)"
  - "prepare_transition is the critical state change (Filled -> Graduated); finalize_transition is an optional confirmation"
  - "Consolidation required before refund claims (consolidate_for_refund must be called first, enforced by EscrowNotConsolidated error)"
  - "TokensPurchased event renamed from Purchase for clarity alongside TokensSold sell event"

patterns-established:
  - "10-step sell logic: read position, compute x2, reverse integral, tax, net, slippage check, transfer tokens, transfer SOL, transfer tax, update state"
  - "Burn-and-claim solvency proof format: worked example with 3+ users claiming sequentially, showing pool exhaustion = 0"
  - "Graduation orchestration table: Step/Type/Instruction/Description columns"

# Metrics
duration: 6min
completed: 2026-03-03
---

# Phase 70 Plan 02: Instruction Set Update (Section 8) Summary

**Complete v1.2 instruction set: sell with 10-step logic, burn-and-claim refund with solvency proof, consolidate/distribute tax escrow lifecycle, multi-TX graduation replacing monolithic 32-account instruction**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-03T20:32:07Z
- **Completed:** 2026-03-03T20:38:02Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Section 8 now contains 11 active instructions (+ 1 removed note + 1 orchestration doc) covering the full v1.2 lifecycle: initialize, fund, start, purchase (no whitelist), sell (NEW), mark_failed, claim_refund (burn-and-claim), consolidate_for_refund (NEW), distribute_tax_escrow (NEW), prepare_transition (NEW), finalize_transition (NEW)
- Sell instruction fully documented with accounts, args, 4 validation checks, 10-step logic matching Section 4.5 reverse integral, slippage protection, and 15% tax routing to tax_escrow
- Burn-and-claim refund includes worked solvency example with Alice/Bob/Carol proving the formula is order-independent and fully exhausts the refund pool
- Graduation uses multi-TX orchestration (7 steps) rather than monolithic 32-account instruction, leveraging existing AMM and vault instructions

## Task Commits

Each task was committed atomically:

1. **Task 1: Update/Remove Existing Instructions (8.1-8.5) and Add Sell Instruction** - `eb2d889` (docs)
2. **Task 2: Replace claim_refund, Add Tax Instructions, Update Graduation Instructions** - `768ebc6` (docs)

## Files Created/Modified
- `docs/Bonding_Curve_Spec.md` - Updated Section 8 with complete v1.2 instruction set

## Decisions Made
- **Section numbering preserved for removed 8.4:** Using "REMOVED (v1.2)" marker instead of renumbering avoids breaking cross-references in existing docs and team discussions.
- **Sell tokens return to vault, not burned:** Maintains curve fungibility -- returned tokens can be re-purchased. Price drops as tokens_sold decreases.
- **sol_returned tracks gross SOL:** Preserves the accounting identity `sol_vault_balance == sol_raised - sol_returned` at all times, since tax moves to a separate escrow.
- **TokensPurchased event renamed:** Distinguishes from TokensSold sell event. Clearer event names for indexer consumption.
- **prepare_transition is the critical gate:** The Filled -> Graduated state change is the irreversible decision point. All subsequent asset movement is idempotent and can be retried.
- **Consolidation as prerequisite:** Requiring consolidate_for_refund before claim_refund keeps the claim logic simple (single sol_vault read) and ensures all refundable SOL is in one place.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Section 8 instruction set is complete and internally consistent with Sections 1-7 (updated by Plan 01)
- Plan 03 can now update Sections 9-15 knowing the full instruction set: sell events (TokensSold), refund events (RefundClaimed with tokens_burned), new errors (CurveNotActiveForSell, InsufficientTokenBalance, SlippageExceeded, EscrowNotConsolidated, NothingToBurn, ZeroAmount, CurveNotGraduated, etc.), security analysis (15% tax anti-manipulation), testing requirements (sell paths, refund paths, graduation orchestration), and invariant updates
- Remaining references to old patterns in Sections 10-15 (WalletWhitelisted event, NotWhitelisted error, Purchase event struct, refund_claimed in security section, whitelist test cases) are all Plan 03 scope

---
*Phase: 70-specification-update*
*Completed: 2026-03-03*
