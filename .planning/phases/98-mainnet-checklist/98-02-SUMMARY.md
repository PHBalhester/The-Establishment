---
phase: 98-mainnet-checklist
plan: 02
subsystem: infra
tags: [deployment, checklist, sol-budget, mainnet, operational-procedures]

# Dependency graph
requires:
  - phase: 98-mainnet-checklist
    provides: 8 stage scripts (stage-0 through stage-7) that the checklist references
  - phase: 91-deploy-config-foundation
    provides: deployment.json schema, deploy-all.sh, generate-constants.ts, verify.ts
  - phase: 92-mainnet-credentials
    provides: preflight safety gate, .env.mainnet, generate-hashes.sh
  - phase: 95-pathway2-deploy
    provides: 15 deployment pitfalls from real deploy experience
  - phase: 97-squads-governance
    provides: setup-squads.ts, transfer-authority.ts, verify-authority.ts
provides:
  - Comprehensive 1538-line mainnet deployment checklist (Docs/mainnet-deploy-checklist.md)
  - SOL budget with line items totaling ~32 SOL (26.65 + 20% contingency)
  - Emergency procedures appendix (rollback, hot-fix, crank crash, VRF down)
  - All 15 deployment pitfalls as inline WARNING boxes at exact steps
affects: [98-mainnet-checklist, 98.1-production-infra, 99-nextra-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Action/Verify/Expected format for every checklist item (38 items total)"
    - "GO/NO-GO checkbox gates between every deployment stage"
    - "Inline pitfall WARNING boxes at exact steps where each could occur"

key-files:
  created:
    - Docs/mainnet-deploy-checklist.md
  modified: []

key-decisions:
  - "SOL budget uses devnet binary sizes with note to run solana rent for exact costs"
  - "Emergency procedures cover 4 scenarios: rollback, hot-fix, crank crash, VRF oracle down"
  - "Old Docs/mainnet-checklist.md (v0.8 era, 219 lines) deleted and fully replaced"
  - "Some pitfalls referenced at multiple steps where they could reoccur (18 total references for 15 pitfalls)"

patterns-established:
  - "Deployment checklist format: Action (bash command), Verify (bash command), Expected (output pattern), checkbox"

requirements-completed: [CHECK-01, CHECK-02, CHECK-04]

# Metrics
duration: 6min
completed: 2026-03-15
---

# Phase 98 Plan 02: Deployment Checklist Summary

**1538-line mainnet deployment checklist with 8-stage procedure, 15 inline pitfall WARNINGs, SOL budget (~32 SOL), and emergency procedures replacing stale v0.8 checklist**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-15T11:12:46Z
- **Completed:** 2026-03-15T11:18:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created comprehensive 1538-line mainnet deployment checklist covering all 8 stages (0-7)
- Every checklist item follows Action/Verify/Expected format (38 verifiable items)
- All 15 deployment pitfalls placed as inline WARNING boxes at the exact steps where they could occur
- GO/NO-GO checkbox gates between every stage (8 gates total)
- SOL budget appendix with detailed line items totaling ~32 SOL (26.65 base + 20% contingency)
- Emergency procedures appendix covering rollback, hot-fix, crank crash, and VRF oracle failure
- Deleted stale v0.8-era Docs/mainnet-checklist.md (219 lines, missing 90% of current requirements)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the comprehensive mainnet deployment checklist** - `c6ad524` (feat)
2. **Task 2: Add SOL budget section + delete old checklist** - `412c5ec` (chore)

## Files Created/Modified
- `Docs/mainnet-deploy-checklist.md` (1538 lines, created) - Complete 8-stage mainnet deployment procedure with verification at every step
- `Docs/mainnet-checklist.md` (deleted) - Stale v0.8-era checklist replaced by new document

## Decisions Made
- SOL budget estimates use devnet binary sizes with explicit note to run `solana rent <bytes>` for exact mainnet costs
- Emergency procedures cover 4 distinct scenarios with actionable steps for each
- Some pitfalls referenced at multiple steps (Pitfall #1 appears at Stage 0, Stage 3, and Stage 6; Pitfall #6 appears at Stage 3 and Stage 6; Pitfall #13 appears at Stage 3 and Stage 6) -- this is intentional, as these pitfalls can bite at multiple points
- Community-funded bonding curve fills (~1000 SOL) documented separately from deployer cost

## Deviations from Plan

None - plan executed exactly as written. The SOL budget and emergency procedures appendixes were written as part of the main document in Task 1 (natural document flow), with Task 2 verifying their presence and deleting the old checklist.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Checklist ready for validation: Plan 98-03 will exercise this checklist via fresh devnet deploy
- All stage scripts from Plan 98-01 are referenced correctly in the checklist
- Checklist satisfies CHECK-01 (comprehensive coverage), CHECK-02 (every item verifiable), CHECK-04 (SOL budget estimated)
- CHECK-03 (devnet validation) deferred to Plan 98-03

---
*Phase: 98-mainnet-checklist*
*Completed: 2026-03-15*
