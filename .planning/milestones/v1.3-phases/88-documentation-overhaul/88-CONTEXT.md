# Phase 88: Documentation Overhaul - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Update all specification documents to match current code, rewrite the Nextra documentation site content, and document the cross-program upgrade cascade. Requirements: DOC-01, DOC-02, DOC-03.

</domain>

<decisions>
## Implementation Decisions

### Spec Doc Update Strategy
- Full sweep of all 32 files in Docs/ — not just the 4 named in DOC-01
- Security audit reports (VULNHUNTER-AUDIT, SFK.md) stay in Docs/ — useful reference for future auditors
- Planning artifacts and deployment reports (DBS-base-profit-redesign, Jupiter_DEX_Integration_Roadmap, E2E_Devnet_Test_Report, redeploy-schedule.md, etc.) move to Docs/archive/
- Updated spec docs written as fresh files in Docs/ — archived v0.1 originals stay as historical record in Docs/archive/
- Code-first verification: read actual on-chain program source and write docs from what the code does today, not from existing stale docs
- DOC_MANIFEST.md updated as the index of all active docs — purpose, category (spec/audit/operational/reference), and last-verified date

### Nextra Site Review Process
- "I draft, you approve" workflow — Claude rewrites each page based on current code, presents section by section for user approval
- Audience: DeFi-savvy traders who understand AMMs/staking/yield
- Include code snippets where they add clarity (VRF mechanics, tax derivation, bonding curve math, etc.) — not full code walkthrough, but helpful excerpts for technically curious readers
- Silent snippets approach — don't explicitly state closed-source status, just include code naturally as transparency gesture
- Full bonding curve mechanics in Launch section: pricing formula, dual-curve coupling, graduation conditions, 48hr deadline, refund flow
- No cross-links to spec docs from Nextra pages (repo is closed-source at launch, links would be dead). Revisit if/when open-sourced
- 16 MDX pages across 6 sections (overview, gameplay, earning, launch, security, reference)

### Upgrade Cascade Doc (DOC-03)
- New standalone file: Docs/upgrade-cascade.md
- Content: CPI dependency graph (which program calls which), breaking change categories, safe upgrade order, commitment to upgrade-at-same-address
- Concise and actionable — developer/operational audience, not user-facing
- Brief "Future" section noting planned 2-of-3 Squads multisig with 48-72hr timelock (v1.4 scope context)
- Referenced from architecture.md

### Doc Authority
- Spec docs (Docs/*.md) are the developer-facing source of truth for how the protocol works
- Nextra site is a user-friendly presentation of the same information — if conflicts arise, fix the Nextra page
- DOC_MANIFEST.md serves as the master index of all active docs

### Claude's Discretion
- File naming for fresh spec docs (e.g., carnage-spec.md vs Carnage_Fund_Spec.md)
- Which specific files from Docs/ get archived vs updated vs kept as-is
- Exact structure and depth of each spec doc rewrite
- How to organize the Nextra review into plan waves (by section, by page, etc.)
- Order of operations (specs first vs Nextra first vs interleaved)

</decisions>

<specifics>
## Specific Ideas

- Code snippets in Nextra should show things like VRF randomness derivation, tax band calculation, bonding curve integral pricing — the "how does this actually work" moments that closed-source projects rarely share
- The 14 original spec docs from v0.1 have drifted significantly across 12 milestones — code-first rewrites will be more accurate than attempting to patch existing docs
- Bonding curve Launch pages should explain what buyers need to understand before participating (pricing, refund conditions, graduation coupling)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Docs/DOC_MANIFEST.md`: Existing manifest file — update rather than create new
- `Docs/architecture.md`: Current architecture doc — update and add reference to upgrade-cascade.md
- `Docs/archive/`: 22 archived docs from v0.1 and earlier milestones
- `docs-site/content/`: 16 MDX pages organized in 6 sections (overview, gameplay, earning, launch, security, reference)

### Established Patterns
- Spec docs use PascalCase_With_Underscores naming (original 14) and kebab-case (newer docs) — mixed convention
- Nextra site uses MDX with Nextra theme-docs
- PROJECT.md lists the canonical 14-document specification set

### Integration Points
- New file: `Docs/upgrade-cascade.md`
- Updated: `Docs/DOC_MANIFEST.md` (master index)
- Updated: `Docs/architecture.md` (reference to upgrade cascade)
- Updated/new: Fresh spec docs in `Docs/` for Carnage, Epoch, Tax, Transfer Hook (+ others found stale)
- Updated: All 16 `docs-site/content/**/*.mdx` pages
- Archived: Planning artifacts and deployment reports moved to `Docs/archive/`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 88-documentation-overhaul*
*Context gathered: 2026-03-08*
