---
phase: 99-nextra-documentation
plan: 03
subsystem: docs
tags: [nextra, mdx, documentation, staking, arbitrage, bonding-curve, pool-seeding]

key-files:
  modified:
    - "docs-site/content/earning/profit-and-yield.mdx"
    - "docs-site/content/earning/arbitrage.mdx"
    - "docs-site/content/launch/bonding-curve.mdx"
    - "docs-site/content/launch/pool-seeding.mdx"

requirements-completed: [DOCS-03]

duration: manual
completed: 2026-03-19
---

# Phase 99 Plan 03: Earning Rewards + Launch Section Summary

**Rewrote Staking & Rewards, Arbitrage, Bonding Curve, and Pool Seeding pages with corrected mechanics and updated constants**

## Accomplishments
- Staking page: replaced "call the instruction" language with "Rewards Vat" UI references, removed Ponzi defense section, replaced code blocks with bullet points
- Arbitrage page: corrected canonical arb route to price dislocation model, rewrote profitability as volume-driven, removed Symbiosis section, renamed from "Arbitrage (Advanced)" to "Arbitrage"
- Bonding Curve page: updated SOL target from 1000→500 per curve, corrected start price (0.00000045), end price (0.000001725), FDVs ($45K/$172.5K), removed Rust code blocks
- Pool Seeding page: updated SOL amounts to 500, added authority note (upgrade authority retained behind timelocked multisig, not burned)

## Decisions Made
- Bonding curve SOL target confirmed as 500 SOL per curve (1000 total) from on-chain constants (P_START=450, P_END=1725)
- 3.83x price ratio unchanged
- Removed "Why It Is Not a Ponzi" section — better to not address it at all
- Pool seeding page gets authority disclosure linking to governance page

---
*Phase: 99-nextra-documentation*
*Completed: 2026-03-19*
