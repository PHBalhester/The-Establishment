# Phase 57: Brand Application - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Apply the finalized steampunk palette across every UI component in the application. Eliminate all residual generic gray/zinc Tailwind classes and ensure all text-on-background combinations meet WCAG AA contrast requirements. No new features or components — this is purely visual theming of existing elements within their established modal containers.

</domain>

<decisions>
## Implementation Decisions

### Palette Definition
- Shift base tones warmer/richer — toward mahogany/wood tones rather than current dark brown (#1a1208 range). More warmth, less industrial grime
- Push metallic accents toward bright polished brass/gold — more saturated than current #d4a04a, like polished brass fixtures
- Semantic colors (success/error/warning) use standard recognizable green/red/amber but with a warm shift to stay in the palette family — not the current muted olive/rusty tones
- Refine from existing placeholder values — no external references, evolve what's there

### Styling Depth
- Form inputs (text fields, selects, sliders): Full steampunk — decorative borders, inner glow, brass-rimmed appearance. Every input looks like a factory gauge
- Card components (SwapStatsBar items, staking panels, route cards): Flat with factory borders — dark surface + factory border color, clean and minimal, content-forward
- Tabs (stake/unstake/claim): Lever/switch mechanical style — tabs look like mechanical levers or switches for immersive feel
- Non-Big-Red buttons (Connect Wallet, Copy Address, tab buttons): Beveled brass appearance — subtle 3D with box-shadow, feels clickable and mechanical. Big Red Button remains the star

### Interactive States
- Hover: Brass glow effect — outer glow in accent gold, consistent with existing scene station hover glow pattern
- Disabled: Faded/desaturated — tarnished, dull metal that's lost its shine. Same shape but washed out
- Focus-visible: Keep current gold glow ring (#f0c050) — consistent with brass theme and already visible
- Loading: Gear spinner everywhere — use the existing CSS gear spinner from Phase 53 consistently across all loading states

### Contrast Resolution
- Fix strategy: Claude's discretion — adjust text or background, whichever looks better per case
- Muted text strictness: Claude's discretion — make the call based on text size and context
- Verification: Both computed ratios during coding AND browser DevTools spot-check after deployment
- Accent text contrast failures: Claude's discretion — lighter shade or text-shadow per context

### Claude's Discretion
- Specific hex values for the refined palette (warmer base, brighter brass, warm-shifted semantic colors)
- Contrast fix direction per component (text vs background adjustment)
- Muted text contrast strictness per context
- Accent text contrast fix method (lighter shade vs text-shadow)
- Exact lever/switch tab CSS implementation
- Exact brass-rimmed input styling approach

</decisions>

<specifics>
## Specific Ideas

- Backgrounds should feel like rich wood/mahogany, not just dark brown — warmth is key
- Brass accents should look polished, not aged — shiny, saturated gold
- Semantic colors should be immediately recognizable (green=success, red=error) but warmed to fit
- Lever tabs are a standout stylistic choice — they should feel like real mechanical switches
- The gear spinner (Phase 53) is THE loading indicator everywhere — no mixing with other loading patterns

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 57-brand-application*
*Context gathered: 2026-02-23*
