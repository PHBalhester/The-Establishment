# Phase 39: Foundation + Scaffolding - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up the Next.js monorepo with shared code extraction, IDL sync, Anchor browser integration, and Drizzle schema definition. This is the technical foundation every subsequent frontend phase builds on. No visual design, no styling decisions -- purely making the tech work.

</domain>

<decisions>
## Implementation Decisions

### App shell & pages
- This phase is purely functional tech validation -- no design, styling, or navigation decisions
- Production vision is a **single-page app with modal/popup interactions** (not separate routes), but that's a future milestone concern
- For this phase: minimal shell that proves Next.js + Anchor + shared imports work
- Navigation pattern, page routes, visual layout: all deferred to design milestone

### Shared code boundaries
- Create `shared/` for **app/ consumption only** -- do NOT migrate existing scripts/ or tests/ imports
- Existing scripts and devnet runner stay untouched (battle-tested, working on devnet)
- Scripts can be migrated to import from shared/ incrementally in future phases as we naturally touch those files
- Currently, `tests/integration/helpers/constants.ts` is the canonical constants source, with 9 e2e files duplicating values locally -- that duplication is accepted for now

### Swap events schema
- **Rich data capture** -- include full tax/fee breakdown, not just price data
- Fields: TX signature, pool, direction (buy/sell), SOL amount, token amount, price, tax amount, LP fee, slippage, user wallet, epoch number, timestamp
- Enables analytics like "total tax collected per epoch" and detailed trade history

### Candle data
- All 4 pools get candle series: CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT
- Complete market coverage including the PROFIT pairs

### Claude's Discretion
- App shell visual structure and proof-of-life display (visible on page vs console-only)
- Whether to include wallet button placeholder in scaffold
- Shared code: whether to include TypeScript types alongside constants, and whether to include a pda-manifest.json loader
- Epoch events schema design (snapshot vs delta vs both)
- Carnage events schema design (outcomes-only vs full execution trace)
- Candle resolutions and aggregation grain

</decisions>

<specifics>
## Specific Ideas

- Production app is envisioned as a **single-page design with clickable objects that open popup/modal menus** -- not a multi-route SPA. This doesn't affect this phase but is important context for future phases.
- Rich swap event data was chosen specifically to enable per-epoch tax analytics and detailed trade history displays.

</specifics>

<deferred>
## Deferred Ideas

- Visual design, navigation patterns, branding -- future design milestone
- Migration of existing scripts/tests to import from shared/ -- future code health task
- Single-page modal/popup interaction design -- future design milestone

</deferred>

---

*Phase: 39-foundation-scaffolding*
*Context gathered: 2026-02-15*
