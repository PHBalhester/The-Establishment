---
phase: 88-documentation-overhaul
plan: 05
subsystem: docs
tags: [documentation, nextra, mdx, launch, security, reference]

requires:
  - phase: 88-02
    provides: "Fresh code-first spec docs for Carnage, Epoch, Tax, Transfer Hook"
  - phase: 88-03
    provides: "Refreshed remaining active docs (architecture, data-model, etc.)"
provides:
  - "6 accurate Nextra MDX pages: launch (2), security (2), reference (2)"
  - "Complete glossary (27 terms) and tokenomics reference"
affects: [mainnet-launch]

tech-stack:
  added: []
  patterns:
    - "MDX content derived from code-first spec docs, not written independently"

key-files:
  created: []
  modified:
    - "docs-site/content/launch/bonding-curve.mdx"
    - "docs-site/content/launch/pool-seeding.mdx"
    - "docs-site/content/security/how-randomness-works.mdx"
    - "docs-site/content/security/protocol-guarantees.mdx"
    - "docs-site/content/reference/glossary.mdx"
    - "docs-site/content/reference/tokenomics.mdx"

key-decisions:
  - "Corrected PROFIT from SPL Token to Token-2022 with transfer hook"
  - "Replaced all 'yield' language with 'game rewards' for legal compliance"
  - "Documented VRF gateway rotation limitation transparently"

patterns-established:
  - "Legal language: use 'game rewards' not 'yield' when describing PROFIT staking returns"

requirements-completed: [DOC-02]

duration: 15min
completed: 2026-03-09
---

# Phase 88 Plan 05: Nextra Pages — Launch, Security & Reference

**6 Nextra MDX pages rewritten covering bonding curves, pool seeding, VRF security, protocol guarantees, glossary, and tokenomics**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-08
- **Completed:** 2026-03-09
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Rewrote all 6 remaining MDX pages from current spec docs
- Bonding curve page documents pricing formula, sell-back mechanics, dual-curve coupling, refund flow
- Security pages document commit-reveal-consume VRF, anti-reroll, protocol invariants
- Glossary covers 27 terms across all site pages
- Tokenomics reference includes 71/24/5 split, round-trip costs, Carnage parameters
- Applied PROFIT Token-2022 fix and yield→rewards language changes

## Task Commits

1. **Task 1: Rewrite 6 MDX pages** - `4c196f9` (docs)
2. **Task 2: User review + corrections** - `5aada71` (fix: PROFIT type + yield→rewards)

## Files Modified
- `docs-site/content/launch/bonding-curve.mdx` - Pricing formula, sell-back, graduation
- `docs-site/content/launch/pool-seeding.mdx` - Conversion vault, pool initialization
- `docs-site/content/security/how-randomness-works.mdx` - VRF commit-reveal-consume
- `docs-site/content/security/protocol-guarantees.mdx` - PDA gates, financial guards
- `docs-site/content/reference/glossary.mdx` - 27-term glossary
- `docs-site/content/reference/tokenomics.mdx` - Supply, splits, reward model

## Decisions Made
- VRF gateway rotation limitation documented transparently (single oracle assignment)
- Glossary "Game Rewards" entry replaces "Yield" entry

## Deviations from Plan

Same corrections as 88-04 applied here (PROFIT token type, yield→rewards language).

## Issues Encountered
None.

## User Setup Required
None.

## Next Phase Readiness
- All 16/16 docs-site pages complete and accurate
- Documentation overhaul phase ready for verification

---
*Phase: 88-documentation-overhaul*
*Completed: 2026-03-09*
