---
phase: 99-nextra-documentation
plan: 02
subsystem: docs
tags: [nextra, mdx, documentation, gameplay, tax, epoch, carnage, soft-peg]

key-files:
  modified:
    - "docs-site/content/gameplay/tax-regime.mdx"
    - "docs-site/content/gameplay/epoch-rounds.mdx"
    - "docs-site/content/gameplay/carnage-fund.mdx"
    - "docs-site/content/gameplay/soft-peg.mdx"

requirements-completed: [DOCS-02]

duration: manual
completed: 2026-03-19
---

# Phase 99 Plan 02: How It Works Section Summary

**Rewrote all 4 How It Works pages with user-directed copy edits, corrected arb mechanics, and added epoch lifecycle diagram**

## Accomplishments
- Rewrote Tax System page: corrected authority claims, removed sell floor section, fixed worked example to show actual price dislocation arb (not wait-for-flip)
- Rewrote Epoch Rounds page: simplified VRF lifecycle, added epoch.png diagram, removed unnecessary quote
- Rewrote Carnage Fund page: corrected Path 3 sell-then-buy description, added "Oops" quote, removed bottom quote
- Rewrote Soft Peg page: replaced canonical arb route with price dislocation worked example (1M MCAP), added conversion vault 1:1 equivalence explanation
- Fixed all hydration errors (nested `<p>` tags → `<span>` with `display: block`)
- Replaced all code blocks with bullet points/tables

## Decisions Made
- Arb route corrected: profit comes from buying undervalued token cheaply and selling overvalued token cheaply after a flip, not from waiting for a future flip
- Soft peg explained through conversion vault equivalence (100 CRIME = 1 PROFIT = 100 FRAUD)
- Removed "Why This Creates Opportunities" and "Sell Floor Protection" sections from tax page (too technical/unnecessary)
- Removed "Simple Analogy" and "When Peg Breaks Hardest" from soft peg (redundant)

---
*Phase: 99-nextra-documentation*
*Completed: 2026-03-19*
