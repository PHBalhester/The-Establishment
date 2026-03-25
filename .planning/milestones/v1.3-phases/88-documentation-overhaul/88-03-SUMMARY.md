---
phase: 88-documentation-overhaul
plan: 03
subsystem: docs
tags: [documentation, audit, bonding-curve, hardening, spec-refresh]

# Dependency graph
requires:
  - phase: 88-01
    provides: "DOC_MANIFEST.md restructured, archived stale docs"
  - phase: 88-02
    provides: "Core spec rewrites (Carnage, Epoch, Tax, Transfer Hook)"
provides:
  - "All 12 active spec docs audited and refreshed to match current code"
  - "DOC-01 fully satisfied: no stale descriptions remain"
  - "Bonding curve (7th program) documented across all relevant specs"
affects: [89-final-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - Docs/architecture.md
    - Docs/data-model.md
    - Docs/token-economics-model.md
    - Docs/Bonding_Curve_Spec.md
    - Docs/security-model.md
    - Docs/cpi-interface-contract.md
    - Docs/account-layout-reference.md
    - Docs/frontend-spec.md
    - Docs/error-handling-playbook.md
    - Docs/deployment-sequence.md
    - Docs/operational-runbook.md
    - Docs/token-interaction-matrix.md
    - Docs/project-overview.md
    - Docs/DOC_MANIFEST.md

key-decisions:
  - "Targeted updates only -- sections that matched current code left untouched"
  - "Bonding curve error catalog added with all 24 variants (codes 6000-6023)"
  - "EpochState size updated 108->172 bytes across all docs consistently"
  - "PROFIT supply corrected 50M->20M in token-interaction-matrix"
  - "MetadataPointer extension added to all three token registries"

patterns-established: []

requirements-completed: [DOC-01]

# Metrics
duration: 16min
completed: 2026-03-08
---

# Phase 88 Plan 03: Remaining Spec Doc Audit Summary

**Full sweep of 14 active spec docs -- bonding curve added as 7th program, Phase 78-86 hardening reflected, stale sizes/counts/addresses corrected**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-08T20:12:39Z
- **Completed:** 2026-03-08T20:28:41Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Audited all 14 active spec docs against current program source code
- Added bonding curve (7th program) to architecture, data-model, security-model, CPI contract, account layouts, error playbook, deployment sequence, operational runbook, token interaction matrix, and project overview
- Updated EpochState from 108 to 172 bytes (Phase 80 reserved padding) across architecture, data-model, and account-layout-reference
- Added Phase 78-86 hardening changes to security-model (authority hardening, financial safety guards, defense-in-depth)
- Added 3 new frontend flows (launch page, mobile wallet, eligible unstake) to frontend-spec
- Corrected stale PROFIT supply (50M->20M) and mint addresses in token-interaction-matrix
- Added full 24-variant bonding curve error catalog to error-handling-playbook

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit and refresh core system docs** - `2b19a55` (docs)
   - architecture.md: 7 programs, bonding curve section, updated EpochState size
   - data-model.md: CurveState/BcAdminConfig PDAs, reserved padding, VRF-03 note
   - token-economics-model.md: bonding curve economics, 6 Carnage paths
   - Bonding_Curve_Spec.md: escrow_consolidated, partner_mint, v1.3 hardening section

2. **Task 2: Audit and refresh remaining active docs** - `0974134` (docs)
   - security-model.md, cpi-interface-contract.md, account-layout-reference.md
   - frontend-spec.md, error-handling-playbook.md, deployment-sequence.md
   - operational-runbook.md, token-interaction-matrix.md, project-overview.md
   - DOC_MANIFEST.md last-verified dates updated

## Files Created/Modified

- `Docs/architecture.md` - Added bonding curve as 7th program, updated EpochState 108->172, added Conversion Vault program ID
- `Docs/data-model.md` - Added CurveState/BcAdminConfig PDAs, EpochState reserved padding, updated account size summary
- `Docs/token-economics-model.md` - Added bonding curve economics section, updated Carnage to 6 paths
- `Docs/Bonding_Curve_Spec.md` - Added escrow_consolidated/partner_mint fields, v1.3 hardening section
- `Docs/security-model.md` - Added BC Admin authority, Phase 78-80 hardening summary
- `Docs/cpi-interface-contract.md` - Added bonding curve as leaf node, Conversion Vault/BC program IDs
- `Docs/account-layout-reference.md` - Added BcAdminConfig/CurveState byte layouts, updated EpochState offsets
- `Docs/frontend-spec.md` - Added launch page, mobile wallet, eligible unstake flows; updated RPC proxy
- `Docs/error-handling-playbook.md` - Added 24-variant bonding curve error catalog
- `Docs/deployment-sequence.md` - Added bonding curve to program registry, two-pass deploy note
- `Docs/operational-runbook.md` - Added Conversion Vault and Bonding Curve program IDs
- `Docs/token-interaction-matrix.md` - Fixed PROFIT supply 50M->20M, updated mint addresses, added MetadataPointer
- `Docs/project-overview.md` - Updated to 7 programs, ~32K LOC, added bonding curve description
- `Docs/DOC_MANIFEST.md` - Updated last-verified dates to 2026-03-08

## Decisions Made

- Targeted updates only: sections matching current code left untouched (no unnecessary rewrites)
- EpochState size updated consistently to 172 bytes across all docs (architecture, data-model, account-layout-reference)
- Bonding curve error catalog organized into User-Facing, Admin/Initialization, and Defense-in-Depth categories
- PROFIT supply corrected from stale 50M to current 20M in token-interaction-matrix
- Added MetadataPointer extension to all three token registries (was missing from docs)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Edit targeting wrong file: attempted to update VRF description in token-economics-model.md but the text was actually in data-model.md. Redirected edit to correct file.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DOC-01 fully satisfied: all 14 active spec docs audited and updated to match current code
- Phase 88 documentation overhaul complete (88-01 manifest, 88-02 core rewrites, 88-03 full sweep)
- Ready for Phase 89 (final verification)

---
*Phase: 88-documentation-overhaul*
*Completed: 2026-03-08*
