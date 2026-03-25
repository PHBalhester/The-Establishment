---
phase: 70-specification-update
plan: 03
subsystem: specification
tags: [bonding-curve, failure-handling, events, errors, security, invariants, cross-reference, burn-and-claim, solvency]

# Dependency graph
requires:
  - phase: 70-01
    provides: Updated Sections 1-7 with sell-back math, CurveState (191 bytes), state machine, tax escrow PDA
  - phase: 70-02
    provides: Complete v1.2 instruction set in Section 8 (sell, refund, consolidate, distribute, graduation)
provides:
  - Complete v1.2 Bonding Curve Specification (Sections 1-16)
  - Failure handling with burn-and-claim refund and tax escrow consolidation
  - Event contracts for sell/tax/refund lifecycle (TokensSold, TaxCollected, EscrowConsolidated, EscrowDistributed, RefundClaimed)
  - Error catalog updated (11 new errors, 4 removed)
  - Security analysis with sell manipulation bounds, solvency proof, cap enforcement without whitelist
  - 18 invariants summarizing v1.2 guarantees
  - Testing requirements for sell, refund, graduation, and property tests
  - Cross-reference consistency notes in Protocol_Init and Transfer_Hook docs
affects: [71 (Program Scaffold), 72 (Core Instructions), 73 (Graduation), 74 (Client Orchestration), 75 (Launch Page)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Burn-and-claim solvency proof: mathematical induction showing pool exhaustion equals vault balance"
    - "15% sell tax as economic MEV defense: round-trip cost bounds sandwich attacks"
    - "Surgical cross-reference notes: v1.2 blockquote annotations in archived docs without rewriting"

key-files:
  created: []
  modified:
    - docs/Bonding_Curve_Spec.md
    - docs/archive/Protocol_Initialzation_and_Launch_Flow.md
    - docs/archive/Transfer_Hook_Spec.md

key-decisions:
  - "18 invariants in Section 15 (up from 10), covering sell-back, solvency, tax routing, terminal states, price continuity"
  - "Security section restructured: removed whitelist bypass and Privy friction, added sell manipulation, solvency proof, cap enforcement, escrow integrity, deadline manipulation, refund double-claim"
  - "Cross-reference edits are surgical v1.2 blockquote notes, not rewrites -- preserves archived doc integrity"
  - "TaxCollected event emitted inline during sell (not separately) for atomicity; listed as separate event struct for indexer clarity"

patterns-established:
  - "v1.2 cross-reference annotation format: > **v1.2 Update:** [description] -- used consistently in both archived docs"
  - "Property test requirements: fuzz/proptest for buy/sell round-trip, vault solvency, refund solvency, state machine validity, cap enforcement"

# Metrics
duration: 8min
completed: 2026-03-03
---

# Phase 70 Plan 03: Sections 9-16 + Cross-Reference Updates Summary

**Complete v1.2 spec: failure handling with burn-and-claim, 18 invariants, solvency proof, sell manipulation bounds, updated event/error contracts, and surgical cross-reference notes in Protocol_Init and Transfer_Hook**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-03T20:42:03Z
- **Completed:** 2026-03-03T20:49:35Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Sections 9-16 of Bonding_Curve_Spec.md fully updated for v1.2: failure handling uses burn-and-claim with tax escrow consolidation, events cover full sell/tax/refund lifecycle, errors catalog has 11 new entries (4 removed), security section analyzes sell manipulation (15% bound), solvency proof (mathematical induction), cap enforcement without whitelist, tax escrow integrity, and deadline manipulation
- Section 15 invariants expanded from 10 to 18, replacing outdated Buy-only/Whitelist/RefundsPreserveTokens with sell-back, solvency, tax routing, terminal states, and price continuity invariants
- Section 16 added documenting known cross-reference inconsistencies between Bonding_Curve_Spec.md and Protocol_Init/Transfer_Hook archived docs
- Protocol_Initialization_and_Launch_Flow.md updated with 7 surgical v1.2 notes: Privy removed, 7th program noted, PROFIT supply correction, transaction count changes
- Transfer_Hook_Spec.md updated with 3 surgical v1.2 notes: tax escrow whitelisting clarified, sell-back test case added, Conversion Vault entries documented

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Sections 9-16 (Failure, Events, Errors, Security, Testing, UI, Invariants)** - `fc1f8fe` (docs)
2. **Task 2: Cross-Reference Updates (Protocol_Init + Transfer_Hook)** - `32bb8cb` (docs)

## Files Created/Modified
- `docs/Bonding_Curve_Spec.md` - Updated Sections 9-16: failure handling, events, errors, security analysis, testing requirements, UI integration notes, invariants summary, cross-reference notes
- `docs/archive/Protocol_Initialzation_and_Launch_Flow.md` - Surgical v1.2 notes: Privy removed, 7th program, PROFIT supply, transaction count
- `docs/archive/Transfer_Hook_Spec.md` - Surgical v1.2 notes: tax escrow whitelisting, sell-back test case, Conversion Vault entries

## Decisions Made
- **18 invariants replace 10:** Comprehensive coverage of v1.2 guarantees including sell-back walkback, 15% round-trip cost, vault solvency, tax escrow routing, burn-and-claim solvency, sells-disabled-when-Filled, cap enforcement during sells, coupled graduation, terminal states, no double refund, permissionless transition, and price continuity.
- **Security section restructured (not incremented):** Removed 12.1 (whitelist bypass) and 12.3 (front-running with Privy). Renumbered remaining and added new subsections 12.1-12.8. This is cleaner than appending to a broken numbering scheme.
- **Cross-reference annotations use consistent blockquote format:** `> **v1.2 Update:** [description]` in both archived docs. Does not rewrite existing content.
- **Property test requirements added as Section 13.4:** Fuzz/proptest requirements for buy/sell round-trip, vault solvency, refund solvency, state machine validity, and cap enforcement. These are critical for Phase 72 implementation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The Bonding Curve Specification (v1.2) is COMPLETE across all 16 sections
- Phase 70 is fully done: Plans 01 (Sections 1-7), 02 (Section 8), and 03 (Sections 9-16) deliver the single source of truth for implementation
- Phase 71 (Program Scaffold) can begin: all instruction interfaces, state accounts, errors, events, and invariants are specified
- Phase 72 (Core Instructions) has: buy/sell math formulas, 10-step sell logic, burn-and-claim refund with solvency proof, and property test requirements
- Phase 73 (Graduation) has: multi-TX orchestration sequence (7 steps), prepare_transition and finalize_transition interfaces, distribute_tax_escrow specification
- Phase 74 (Client Orchestration) has: UI integration guidelines, sell/refund preview functions, display element requirements
- Phase 75 (Launch Page) has: CurveDisplay interface, progress tracking, tax escrow counter, no-whitelist UI requirements
- Cross-reference docs are consistent: Protocol_Init and Transfer_Hook have surgical v1.2 notes. Pre-existing v1.1 inconsistencies (Conversion Vault) are documented but not fixed (separate effort).

---
*Phase: 70-specification-update*
*Completed: 2026-03-03*
