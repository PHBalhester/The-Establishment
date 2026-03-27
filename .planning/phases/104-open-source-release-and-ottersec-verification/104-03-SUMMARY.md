---
phase: 104-open-source-release-and-ottersec-verification
plan: 03
subsystem: docs
tags: [documentation, mainnet-addresses, github, docs-site, nextra, accuracy-review]

# Dependency graph
requires:
  - phase: 100-mainnet-deploy
    provides: mainnet program IDs, mint addresses, Squads governance state
  - phase: 99-nextra-documentation
    provides: docs-site content with mainnet addresses
provides:
  - Verified documentation accuracy against mainnet.json
  - Updated docs-site GitHub link to MetalLegBob/drfraudsworth
  - Mainnet program IDs, mint addresses, and authority state in all key docs
affects: [104-01-repo-sanitization, 104-05-final-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Source of truth pattern: deployments/mainnet.json referenced explicitly in docs"]

key-files:
  created: []
  modified:
    - Docs/operational-runbook.md
    - Docs/architecture.md
    - Docs/security-model.md
    - Docs/project-overview.md
    - Docs/deployment-sequence.md
    - docs-site/app/layout.tsx

key-decisions:
  - "Retained old devnet addresses as 'Historical' sections rather than removing them -- preserves deployment procedure reference context"
  - "Added 'Source of truth: deployments/mainnet.json' notation to mainnet address tables for traceability"
  - "Updated authority state descriptions to reflect current Squads governance (not pre-burn or post-burn assumptions)"

patterns-established:
  - "Address reference pattern: all docs that cite program IDs now reference mainnet.json as source of truth"
  - "Authority state pattern: docs describe current timelocked multisig state, not aspirational burned state"

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-03-25
---

# Phase 104 Plan 03: Documentation Accuracy Review Summary

**Mainnet address verification across 8 docs + docs-site GitHub link updated to MetalLegBob/drfraudsworth public repo**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-25T12:41:16Z
- **Completed:** 2026-03-25T12:53:05Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments
- Replaced Phase 69 devnet program IDs with mainnet canonical addresses in 5 key documentation files (operational-runbook, architecture, security-model, project-overview, deployment-sequence)
- Added mainnet token mint table (CRIME/FRAUD/PROFIT vanity addresses), key operational addresses (treasury, crank wallet, Squads vault, ALT), and accurate authority state
- Updated docs-site GitHub links (projectLink + docsRepositoryBase) from placeholder dr-fraudsworth to MetalLegBob/drfraudsworth
- Verified docs-site content pages already use correct mainnet addresses (Phase 99)
- Confirmed no hardcoded API keys exist anywhere in Docs/
- Verified token-economics-model.md parameters match on-chain state (1B/1B/20M supplies, 71/24/5 tax split)

## Task Commits

Each task was committed atomically:

1. **Task 1: Documentation accuracy review against mainnet state** - `6ac5cbe` (docs)
2. **Task 2: Update docs-site GitHub link and verify docs-site content** - `ad716f5` (feat)

## Files Created/Modified
- `Docs/operational-runbook.md` - Added mainnet program IDs, token mints, key addresses (treasury, crank, Squads vault); replaced devnet PDA references; updated authority state section to reflect Squads governance
- `Docs/architecture.md` - Updated all 7 program IDs to mainnet, updated mint abbreviations in ASCII diagram, replaced devnet program/token/ALT tables with mainnet
- `Docs/security-model.md` - Added Current Authority State section documenting Squads 2-of-3 multisig with 3600s timelock
- `Docs/project-overview.md` - Updated authority burn claims to reflect graduated governance approach, updated whitelist status (retained not burned), updated audit scope
- `Docs/deployment-sequence.md` - Added Mainnet Program Registry table, added mainnet mint table with vanity addresses
- `docs-site/app/layout.tsx` - Updated projectLink and docsRepositoryBase to MetalLegBob/drfraudsworth

## Decisions Made
- **Retained old devnet addresses as historical reference**: Rather than removing devnet addresses from docs like deployment-sequence.md and operational-runbook.md, they were clearly labeled as "Historical" with a note pointing to the mainnet section. This preserves deployment procedure context for future devnet work.
- **Authority state described as-is, not aspirational**: Documents previously claimed authorities "will be burned" or described post-burn state as current. Updated to accurately reflect the current state: all authorities held by Squads 2-of-3 multisig with 3600s timelock, with burns planned progressively after external audit.
- **Docs not modified per plan exclusions**: `mainnet-governance.md` (handled by Plan 01 sanitization), `archive/` and `DECISIONS/` (excluded from public repo), and historical reports (accurate for their time) were left untouched per plan specification.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Several docs (account-layout-reference.md, error-handling-playbook.md, data-model.md, cpi-interface-contract.md, token-interaction-matrix.md, oracle-failure-playbook.md, frontend-spec.md) also contain old devnet program IDs. These were NOT updated because: (a) they consistently label them as devnet, (b) Plan 01 handles what goes into the public repo via rsync/sanitization, and (c) the plan specified priority documents to review. These remaining docs are accurate as devnet references.
- The `.next/` build cache in docs-site contains stale old GitHub URLs from the previous build. This is expected and will be regenerated on next build. Not tracked by git.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All priority documentation files now reference mainnet canonical addresses
- Docs-site GitHub link points to the public repo
- Ready for Plan 04 (README and contributing guide) and Plan 05 (final verification)
- Remaining devnet-addressed docs will be handled by Plan 01's rsync/sanitization rules

---
*Phase: 104-open-source-release-and-ottersec-verification*
*Completed: 2026-03-25*
