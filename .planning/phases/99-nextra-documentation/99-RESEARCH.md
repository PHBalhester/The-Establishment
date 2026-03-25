# Phase 99: Nextra Documentation - Research

**Researched:** 2026-03-15
**Domain:** Content rewriting, Nextra 4.x MDX documentation, steampunk PNG diagrams
**Confidence:** HIGH

## Summary

Phase 99 is a **content-focused phase**, not a tech setup phase. The Nextra docs site is already fully operational at `docs-site/` with Nextra 4.6.1, Next.js 15, and 16 existing MDX pages across 6 sections. The work is rewriting every page for production accuracy, adding one new governance page, placing 9 steampunk PNG diagrams, and sweeping terminology/address updates.

The existing pages are well-structured and technically detailed but contain terminology violations (uses "game rewards", "yield", "APY" which the user has decided against), ASCII art diagrams that need replacing with PNGs, Rust code snippets that should be removed (user docs, not developer docs), and devnet/placeholder addresses that need mainnet values.

**Primary recommendation:** Plan this as a page-by-page walkthrough in sidebar order. Each plan covers a logical group of pages (1-3 pages per plan). The planner should NOT batch diagram work separately -- diagrams are created inline when each page is reached.

## Standard Stack

The entire stack is already installed and configured. No new dependencies needed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nextra | 4.6.1 | MDX-powered docs framework | Already installed, production-deployed |
| nextra-theme-docs | 4.6.1 | Docs theme with sidebar, search | Already installed |
| next | 15.x | React framework | Already installed |
| pagefind | 1.3.x | Static search indexing (postbuild) | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Nextra Callout | built-in | Info/warning/error callout boxes | Highlight important warnings, tips |
| Nextra Steps | built-in | Numbered step sequences | Multi-step processes (refund flow, staking) |
| Nextra Tabs | built-in | Tabbed content panels | Could use for side-by-side comparisons |

### No New Dependencies Needed
No npm installs required. The site builds and deploys as-is. The work is purely content.

## Architecture Patterns

### Existing Project Structure (DO NOT CHANGE)
```
docs-site/
├── app/
│   ├── layout.tsx           # Nextra Layout with Cinzel font, forced light theme
│   ├── [[...mdxPath]]/      # Catch-all MDX page renderer
│   └── globals.css
├── content/
│   ├── _meta.js             # Root sidebar: Welcome, Laboratory, How It Works, etc.
│   ├── index.mdx            # Welcome/landing page
│   ├── overview/             # "The Laboratory" (3 pages)
│   ├── gameplay/             # "How It Works" (4 pages)
│   ├── earning/              # "Earning Rewards" (2 pages)
│   ├── launch/               # "The Launch" (2 pages)
│   ├── security/             # "Trust & Safety" (2 pages + 1 new)
│   └── reference/            # "Reference" (2 pages)
├── public/
│   ├── _pagefind/            # Search index (auto-generated)
│   └── diagrams/             # NEW: steampunk PNG images go here
├── mdx-components.tsx        # Standard nextra-theme-docs MDX provider
├── next.config.mjs           # Nextra config + CSP for iframe embedding
├── railway.toml              # Deployment config
└── package.json
```

### Pattern 1: MDX Page Structure
**What:** Every page follows the same MDX pattern -- frontmatter optional, H1 title, steampunk quote, horizontal rules between sections, tables for data, plain prose for explanation.
**When to use:** Every page follows this pattern already.
**Example:**
```mdx
# Page Title

> *"Steampunk-flavored introductory quote"*

---

## Section Heading

Body text here. Clear, factual, direct.

| Parameter | Value |
|-----------|-------|
| Data      | Here  |

---

## Next Section
```

### Pattern 2: Nextra Callout Components
**What:** Import `Callout` from `nextra/components` for highlighted info/warning boxes.
**When to use:** Important warnings, caveats, or safety-critical information.
**Example:**
```mdx
import { Callout } from 'nextra/components'

<Callout type="warning">
Sells are disabled once the curve reaches Filled status.
</Callout>

<Callout type="info">
The 71/24/5 tax split is hardcoded and immutable.
</Callout>
```
Available types: `default`, `info`, `warning`, `error`.

### Pattern 3: Image Placement for Diagrams
**What:** PNG diagrams placed in `docs-site/public/diagrams/`, referenced via standard img tags in MDX.
**When to use:** All 9 diagrams.
**Example:**
```mdx
<img src="/diagrams/token-flow.png" alt="Token flow diagram showing tax distribution" style={{ maxWidth: '100%', margin: '2em auto', display: 'block' }} />
```
Note: Use `<img>` JSX tags (not `![markdown](syntax)`) for style control in MDX.

### Pattern 4: Adding New Page (Authority & Governance)
**What:** Create new MDX file in security section, update _meta.js.
**When to use:** The one new page being added.
**Steps:**
1. Create `docs-site/content/security/authority-governance.mdx`
2. Update `docs-site/content/security/_meta.js` to add the entry:
```js
export default {
  'protocol-guarantees': 'Protocol Guarantees',
  'how-randomness-works': 'Verifiable Randomness',
  'authority-governance': 'Authority & Governance',
}
```

### Anti-Patterns to Avoid
- **Do NOT add Rust code snippets** -- this is user documentation for traders, not developer docs. The existing bonding curve page has `calculate_tokens_out` Rust code that should be replaced with plain-language explanation.
- **Do NOT use Mermaid diagrams** -- the decision is custom steampunk PNGs, not generated diagrams (even though d3-sankey is in deps from an earlier phase).
- **Do NOT reorganize sections** -- the existing 6-section hierarchy is locked per CONTEXT.md.
- **Do NOT batch diagram creation** -- diagrams are crafted collaboratively when each page is reached.
- **Do NOT use "yield", "APY", "game", "gamble"** -- use "rewards" or "staking rewards", "protocol" or "system".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Callout/admonition boxes | Custom styled divs | `nextra/components` Callout | Built-in, styled, accessible |
| Search functionality | Custom search | Pagefind (already configured as postbuild step) | Already working |
| Sidebar navigation | Manual nav | `_meta.js` files per section | Already working |
| Image optimization | next/image config | Plain `<img>` from `/public/diagrams/` | MDX compatibility, simpler for static PNGs |
| Address placeholder tracking | Manual grep | `Docs/address-placeholders.md` tracking doc | Decided in CONTEXT.md |

## Common Pitfalls

### Pitfall 1: Terminology Drift
**What goes wrong:** Using "game rewards", "yield", "APY", "yield farming", "game", or "gamble" in rewritten text.
**Why it happens:** The existing pages already use "game rewards" extensively (found in 15+ locations across all sections). Easy to miss during rewrite or unconsciously copy existing phrasing.
**How to avoid:** After each page rewrite, grep for banned terms: `yield|APY|game reward|gambl`. Use "rewards" or "staking rewards" exclusively. Use "protocol" or "system" for the overall thing, "factory" and "experiment" only for steampunk flavor.
**Warning signs:** Any instance of the banned terms in committed MDX files.

### Pitfall 2: Stale Tax Split Numbers
**What goes wrong:** Using 75/24/1 (the spec value) instead of 71/24/5 (the actual on-chain value).
**Why it happens:** The original spec said 75/24/1. Phase 96-01 discovered the on-chain value is 71/24/5 from `tax_math.rs`. Some pages may reference the wrong split.
**How to avoid:** Always use 71/24/5. Verify against on-chain reality documented in STATE.md.
**Warning signs:** Any page showing 75% staking or 1% treasury.

### Pitfall 3: Mainnet Address Confusion
**What goes wrong:** Mixing devnet addresses, mainnet vanity addresses, and placeholder format inconsistently.
**Why it happens:** The project has Phase 95 devnet addresses, Phase 93 mainnet vanity mint addresses, and not-yet-known mainnet program IDs. Three different address pools to keep straight.
**How to avoid:** Follow the decided strategy exactly:
- Known vanity mints: `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` (CRIME), `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` (FRAUD), `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` (PROFIT)
- Unknown program IDs: `<MAINNET_AMM_PROGRAM_ID>`, `<MAINNET_TAX_PROGRAM_ID>`, etc.
- Track every placeholder in `Docs/address-placeholders.md` with file:line mapping.
**Warning signs:** Devnet addresses (8kPzh..., 5JsS..., HL3r...) appearing in docs content.

### Pitfall 4: Code Snippets Surviving the Rewrite
**What goes wrong:** Rust code blocks remain in user-facing documentation.
**Why it happens:** Several existing pages include Rust code (bonding curve math, refund eligibility check, wallet cap enforcement). The decision is "no code snippets" for user documentation.
**How to avoid:** Replace every Rust/code block with plain-language explanation or a table. The math can be shown as formulas (not code), but the implementation details should go.
**Warning signs:** Any ```rust``` or ```typescript``` code fence in the rewritten content.

### Pitfall 5: Forgetting the Tracking Document
**What goes wrong:** Placeholders are scattered through docs with no index, making the post-Phase-100 sweep difficult.
**Why it happens:** It is easy to focus on content quality and forget the mechanical tracking deliverable.
**How to avoid:** Create `Docs/address-placeholders.md` early (first plan) as a living document. Update it every time a placeholder is written. Final plan verifies completeness.
**Warning signs:** Placeholders in MDX files not listed in the tracking doc.

### Pitfall 6: CSP for Diagram Images
**What goes wrong:** Images from `/public/diagrams/` fail to load when docs are embedded in the main app iframe.
**Why it happens:** The docs site serves via Railway with CSP headers configured in `next.config.mjs`. Static images served from the same origin should be fine, but worth verifying.
**How to avoid:** Images in `/public/diagrams/` are same-origin -- CSP img-src defaults allow this. No CSP changes needed. But verify after first diagram placement that images render in both standalone and iframe contexts.
**Warning signs:** Broken image icons in the DocsModal iframe.

## Code Examples

### Adding a Callout to an MDX Page
```mdx
import { Callout } from 'nextra/components'

<Callout type="warning">
Both curves must fill for either to succeed. If only one fills, both become refund-eligible.
</Callout>
```

### Image Placement in MDX
```mdx
<div style={{ textAlign: 'center', margin: '2em 0' }}>
  <img
    src="/diagrams/tax-distribution.png"
    alt="Tax distribution: 71% staking rewards, 24% Carnage Fund, 5% Treasury"
    style={{ maxWidth: '100%', borderRadius: '8px' }}
  />
  <p style={{ fontSize: '0.85em', opacity: 0.7, marginTop: '0.5em' }}>
    *Tax distribution across the three destinations*
  </p>
</div>
```

### New Page in _meta.js
```js
// docs-site/content/security/_meta.js
export default {
  'protocol-guarantees': 'Protocol Guarantees',
  'how-randomness-works': 'Verifiable Randomness',
  'authority-governance': 'Authority & Governance',
}
```

### Placeholder Format for Unknown Addresses
```mdx
| Program | Address |
|---------|---------|
| AMM | `<MAINNET_AMM_PROGRAM_ID>` |
| Transfer Hook | `<MAINNET_HOOK_PROGRAM_ID>` |
| Tax | `<MAINNET_TAX_PROGRAM_ID>` |
| Epoch/VRF | `<MAINNET_EPOCH_PROGRAM_ID>` |
| Staking | `<MAINNET_STAKING_PROGRAM_ID>` |
| Conversion Vault | `<MAINNET_VAULT_PROGRAM_ID>` |
| Bonding Curve | `<MAINNET_BONDING_CURVE_PROGRAM_ID>` |
```

## Page Inventory and Required Changes

Complete inventory of all 17 pages (16 existing + 1 new) with identified issues:

### Section 1: Welcome (1 page)
| Page | File | Issues |
|------|------|--------|
| Welcome | `index.mdx` | ASCII art diagram -> PNG; "game rewards" x3; "APYs" x1; has code-style diagram to replace |

### Section 2: The Laboratory (3 pages)
| Page | File | Issues |
|------|------|--------|
| What Is Dr. Fraudsworth | `overview/what-is-dr-fraudsworth.mdx` | "game rewards" x4; "yield farms" x1; "APY" reference |
| How It All Works | `overview/how-it-works.mdx` | 2x ASCII art diagrams -> PNGs; "game rewards" x1 |
| The Three Tokens | `overview/three-tokens.mdx` | "game rewards" x1; may need mainnet addresses |

### Section 3: How It Works (4 pages)
| Page | File | Issues |
|------|------|--------|
| The Tax System | `gameplay/tax-regime.mdx` | "game rewards" x1; verify 71/24/5 split |
| Epoch Rounds | `gameplay/epoch-rounds.mdx` | VRF byte layout details (keep or simplify?) |
| Carnage Fund | `gameplay/carnage-fund.mdx` | Needs diagram |
| The Soft Peg | `gameplay/soft-peg.mdx` | "game rewards" x1; needs diagram |

### Section 4: Earning Rewards (2 pages)
| Page | File | Issues |
|------|------|--------|
| Staking & Rewards | `earning/profit-and-yield.mdx` | Core rewards page; needs diagram |
| Arbitrage | `earning/arbitrage.mdx` | "game rewards" x1; advanced page for bot operators |

### Section 5: The Launch (2 pages)
| Page | File | Issues |
|------|------|--------|
| Bonding Curve | `launch/bonding-curve.mdx` | Rust code blocks (x3) to remove; needs diagram; has detailed math to simplify for users |
| Pool Seeding | `launch/pool-seeding.mdx` | "game rewards" x1 |

### Section 6: Trust & Safety (2 existing + 1 new)
| Page | File | Issues |
|------|------|--------|
| Protocol Guarantees | `security/protocol-guarantees.mdx` | Review for accuracy post-hardening |
| Verifiable Randomness | `security/how-randomness-works.mdx` | Review for accuracy |
| Authority & Governance | `security/authority-governance.mdx` | **NEW PAGE** -- Squads multisig, timelock, burn schedule |

### Section 7: Reference (2 pages)
| Page | File | Issues |
|------|------|--------|
| Tokenomics | `reference/tokenomics.mdx` | "game rewards" x2; mainnet addresses needed |
| Glossary | `reference/glossary.mdx` | "game rewards" x3; "Game Rewards" heading; update all terms to match rewritten pages |

### Diagram Inventory (9 total)
| Diagram | Placed On Page | Description |
|---------|---------------|-------------|
| System architecture | Welcome (index.mdx) | Full system loop replacing ASCII art |
| Token flow | How It All Works | Three-token flow with tax split |
| Tax distribution | The Tax System | 71/24/5 split visualization |
| Epoch lifecycle | Epoch Rounds | VRF -> commit -> reveal -> consume -> new epoch |
| Carnage mechanics | Carnage Fund | Accumulate -> trigger -> buy/burn -> deflation |
| Staking rewards | Staking & Rewards | Stake PROFIT -> earn SOL from tax revenue |
| Bonding curve | Bonding Curve | Linear price curve, integral pricing, dual coupling |
| Conversion vault | The Three Tokens or Soft Peg | 100:1 conversion between factions and PROFIT |
| Soft peg | The Soft Peg | How asymmetric taxes create/restore peg dislocation |

## Governance Page Content Sources

The new Authority & Governance page should draw from these verified sources:

| Source | Path | What to Extract |
|--------|------|-----------------|
| Mainnet governance doc | `Docs/mainnet-governance.md` | Squads config, timelock progression, burn schedule |
| Security model | `Docs/security-model.md` | Authority architecture, threat model |
| Protocol guarantees page | `security/protocol-guarantees.mdx` | Existing trust framing to extend |

Key facts for governance page (from MEMORY.md and STATE.md):
- 2-of-3 Squads multisig
- Initial timelock: 15 minutes (900s) at launch
- Progressive extension: 15min -> 2hr -> 24hr based on stability
- Authority burned only AFTER external audit funded from protocol revenue
- 7 program upgrade authorities + admin PDA authorities transferred
- Deployer retains hot-fix capability during launch window (Stage 7 is last)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Nextra 3.x (pages router) | Nextra 4.x (app router) | Late 2024 | `_meta.js` replaces `_meta.json`, layout in `app/layout.tsx` not `theme.config.tsx` |
| `theme.config.tsx` | Props on `<Layout>` in `app/layout.tsx` | Nextra 4.0 | Config is now React component props, not exported object |
| `![markdown](image)` | `<img>` JSX in MDX | Nextra 4.x | Better style control, consistent rendering |

**Note:** This site is already on Nextra 4.6.1 and correctly uses the app router pattern. No migration needed.

## Open Questions

1. **Diagram image format and size**
   - What we know: PNGs in `public/diagrams/`, steampunk style, user generates from prompts
   - What's unclear: Target dimensions, file size budget, retina support
   - Recommendation: Suggest 1200px wide for desktop readability, standard PNG (no need for WebP since pagefind/Nextra handles static assets)

2. **Bonding curve page math presentation**
   - What we know: User said "no code snippets or Rust details" but the bonding curve math IS the content
   - What's unclear: How much mathematical notation to keep vs. replace with plain language
   - Recommendation: Keep formulas in plain math notation (not code blocks), remove all Rust. Show `Price = P_START + (P_END - P_START) * (tokens_sold / total_for_sale)` as text, not code.

3. **Iframe rendering of images**
   - What we know: DocsModal embeds docs via iframe, CSP allows framing from Railway
   - What's unclear: Whether large PNGs render well in the constrained iframe viewport
   - Recommendation: Test first diagram in iframe context before committing to all 9

## Sources

### Primary (HIGH confidence)
- Direct filesystem inspection of `docs-site/` (all 16 pages, package.json, config files read)
- `99-CONTEXT.md` -- user decisions from discussion phase
- `.planning/STATE.md` -- project state and accumulated decisions
- `.planning/REQUIREMENTS.md` -- DOCS-01 through DOCS-05 requirements

### Secondary (MEDIUM confidence)
- Nextra 4.6.1 components verified via `node_modules/nextra/dist/` type declarations (Callout, Steps, Tabs, Cards, FileTree all available)

### Tertiary (LOW confidence)
- None -- all findings from direct code inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- directly inspected installed packages
- Architecture: HIGH -- existing site structure fully documented from filesystem
- Content inventory: HIGH -- every page read and issues catalogued
- Pitfalls: HIGH -- terminology violations confirmed via grep, tax split issue documented in STATE.md

**Research date:** 2026-03-15
**Valid until:** No expiry -- content rewriting phase, not dependent on external library changes
