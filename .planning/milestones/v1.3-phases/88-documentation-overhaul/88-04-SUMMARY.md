---
phase: 88-documentation-overhaul
plan: 04
subsystem: docs
tags: [documentation, nextra, mdx, overview, gameplay, earning]

requires:
  - phase: 88-02
    provides: "Fresh code-first spec docs for Carnage, Epoch, Tax, Transfer Hook"
  - phase: 88-03
    provides: "Refreshed remaining active docs (architecture, data-model, etc.)"
provides:
  - "10 accurate Nextra MDX pages: index, overview (3), gameplay (4), earning (2)"
  - "User-facing documentation matching current protocol behavior"
affects: [88-05, mainnet-launch]

tech-stack:
  added: []
  patterns:
    - "MDX content derived from code-first spec docs, not written independently"

key-files:
  created: []
  modified:
    - "docs-site/content/index.mdx"
    - "docs-site/content/overview/what-is-dr-fraudsworth.mdx"
    - "docs-site/content/overview/how-it-works.mdx"
    - "docs-site/content/overview/three-tokens.mdx"
    - "docs-site/content/gameplay/tax-regime.mdx"
    - "docs-site/content/gameplay/epoch-rounds.mdx"
    - "docs-site/content/gameplay/carnage-fund.mdx"
    - "docs-site/content/gameplay/soft-peg.mdx"
    - "docs-site/content/earning/profit-and-yield.mdx"
    - "docs-site/content/earning/arbitrage.mdx"

key-decisions:
  - "Corrected PROFIT from SPL Token to Token-2022 with transfer hook (all 3 tokens use T22)"
  - "Replaced all 'yield' language with 'game rewards' for legal compliance"
  - "Tax split corrected from 75/24/1 to 71/24/5 matching on-chain constants"
  - "PROFIT supply corrected from 50M to 20M"

patterns-established:
  - "Legal language: use 'game rewards' not 'yield' when describing PROFIT staking returns"

requirements-completed: [DOC-02]

duration: 20min
completed: 2026-03-09
---

# Phase 88 Plan 04: Nextra Pages — Overview, Gameplay & Earning

**10 Nextra MDX pages rewritten with accurate protocol mechanics, corrected token types, and legal-compliant reward language**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-08
- **Completed:** 2026-03-09
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Rewrote all 10 MDX pages from scratch based on fresh spec docs from 88-02/88-03
- Corrected multiple factual errors: tax split (71/24/5), PROFIT supply (20M), program count (7), Carnage paths (6), authority plan (gradual burn)
- Fixed PROFIT incorrectly labeled as SPL Token → Token-2022 with transfer hook
- Replaced ~40 instances of "yield" with "game rewards" for legal compliance

## Task Commits

1. **Task 1: Rewrite 10 MDX pages** - `aa02782` (docs)
2. **Task 2: User review + corrections** - `5aada71` (fix: PROFIT type + yield→rewards)

## Files Modified
- `docs-site/content/index.mdx` - Landing page with protocol overview
- `docs-site/content/overview/what-is-dr-fraudsworth.mdx` - Protocol introduction
- `docs-site/content/overview/how-it-works.mdx` - Closed-loop mechanics explanation
- `docs-site/content/overview/three-tokens.mdx` - CRIME/FRAUD/PROFIT token details
- `docs-site/content/gameplay/tax-regime.mdx` - Asymmetric tax mechanics
- `docs-site/content/gameplay/epoch-rounds.mdx` - VRF-driven epoch rounds
- `docs-site/content/gameplay/carnage-fund.mdx` - Carnage buyback-and-burn
- `docs-site/content/gameplay/soft-peg.mdx` - Soft peg arbitrage mechanics
- `docs-site/content/earning/profit-and-yield.mdx` - Staking & rewards
- `docs-site/content/earning/arbitrage.mdx` - Arbitrage guide for bot operators

## Decisions Made
- PROFIT is Token-2022 with transfer hook (same as CRIME/FRAUD) — confirmed from initialize.ts source
- "Game rewards" terminology replaces "yield" throughout for legal reasons — PROFIT stakers earn rewards for providing stability by locking tokens
- Kept "yield" only when criticizing other protocols' yield farming models

## Deviations from Plan

### Auto-fixed Issues

**1. PROFIT token standard was incorrect**
- **Found during:** User review (Task 2)
- **Issue:** Agent incorrectly labeled PROFIT as classic SPL Token
- **Fix:** Corrected to Token-2022 with transfer hook across 5 files
- **Verification:** Confirmed from initialize.ts — all 3 mints use TOKEN_2022_PROGRAM_ID

**2. Legal language — yield → game rewards**
- **Found during:** User review (Task 2)
- **Issue:** "Yield" language poses legal risk for a DeFi protocol
- **Fix:** Replaced ~40 instances across all MDX pages
- **Verification:** grep confirms only intentional "yield" references remain (criticizing other protocols, filename keys)

---

**Total deviations:** 2 auto-fixed (both content accuracy)
**Impact on plan:** Essential corrections. No scope creep.

## Issues Encountered
- Next.js 15.5 global-error.js bug caused client navigation crashes — added global-error.tsx

## User Setup Required
None.

## Next Phase Readiness
- 10/16 docs-site pages complete and accurate
- Ready for 88-05 (remaining 6 pages)

---
*Phase: 88-documentation-overhaul*
*Completed: 2026-03-09*
