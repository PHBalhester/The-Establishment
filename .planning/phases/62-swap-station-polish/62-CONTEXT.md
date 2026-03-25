# Phase 62: Swap Station Polish - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Apply the component kit (Phase 60) and custom Photoshop assets to the Swap Station modal for maximum visible impact. This includes restyling all sub-components (stats bar, chart controls, swap form, Big Red Button), restructuring the below-chart layout into a two-column format, and wrapping the modal in the kit Frame. No new swap functionality — purely visual polish and layout rearrangement.

</domain>

<decisions>
## Implementation Decisions

### Stats bar presentation
- Split into two clickable faction panels: CRIME on left, FRAUD on right
- Clicking a faction panel switches the chart to that pool (replaces the pool dropdown in ChartControls)
- Each panel shows: market cap (USD) + buy tax % + sell tax %
- Active/selected panel gets factory-glow treatment (subtle border glow + brighter background)
- Inactive panel is muted/dimmed
- Pool dropdown in ChartControls is REMOVED (stats bar panels are the sole pool selector)
- Riveted brass panel background (9-slice asset, designed in Photoshop)

### Below-chart layout restructure
- Two-column layout below the chart
- **Left column:** Swap form (You pay / You receive inputs, token selectors, smart routing toggle)
- **Right column:** Big Red Button area with swap summary underneath (estimated output, fees, price impact)
- Settings (slippage tolerance, priority fee) REMOVED from swap form — moved to Settings modal
- Small text link underneath swap section for quick access to swap settings in Settings modal
- On mobile: stacks vertically (swap form on top, Big Red Button below)

### Swap form & inputs
- Kit Input component applied to amount fields (You pay / You receive) — brass/parchment steampunk gauge look
- Kit Input + dropdown pattern: amount input with brass dropdown button for token selection attached to right side
- Smart routing toggle stays in the swap form
- Form width reduced to ~50% of modal width on desktop

### Big Red Button
- Custom rectangular Photoshop asset — metallic rim, glossy highlight, physical realism
- User will design the asset in Photoshop
- Text "BIG RED BUTTON" baked into the Photoshop asset (not HTML text)
- Single asset for all states — loading, success, error handled via CSS overlays/animations on top
- Takes up the right half of the below-chart area, similar height to the swap section
- Swap summary displayed underneath the button (estimated output, total fees, price impact)

### Custom scene assets
- **Riveted brass panel** — 9-slice scalable asset for stats bar AND swap section panel (same style, reused)
- **Big Red Button** — rectangular custom asset (user designs in Photoshop)
- **Modal frame** — entire modal wrapped in kit Frame component (9-slice border from Phase 60)
- Stats bar and swap section panels share the same riveted brass aesthetic

### Modal chrome
- Entire modal wrapped in kit Frame component (replaces current CSS brass border + corner bolts)
- 9-slice asset-based frame from Phase 60

### Claude's Discretion
- Chart controls restyling (timeframe buttons, resolution dropdown, toggles) — apply kit Button/Toggle as appropriate
- Exact spacing, padding, and typography within the two-column layout
- Swap summary content and formatting under the Big Red Button
- Connection status indicator styling in chart controls
- Loading skeleton and empty state restyling within the new layout
- How the "swap settings" quick-link is styled and positioned
- Route display treatment (TBD after two-column layout is in place)

</decisions>

<specifics>
## Specific Ideas

- Stats bar as pool selector is a UX improvement — removes redundancy between stats bar data and ChartControls dropdown
- Big Red Button text is literally "BIG RED BUTTON" (on-brand, playful)
- The Big Red Button asset will be created by the user in Photoshop — implementation should use an `<img>` or CSS background-image approach that accepts the asset
- Riveted brass panel is one reusable 9-slice asset shared between stats bar and swap section — not two different designs
- Settings relocation means the Settings modal needs to accept slippage/priority fee controls (may need coordination with Phase 65)

</specifics>

<deferred>
## Deferred Ideas

- Route display sections (multi-hop, split routing visualization) — decide treatment after two-column layout is implemented
- Settings modal receiving slippage/priority fee — coordinate with Phase 65 (Settings Station + Audio Controls UI)

</deferred>

---

*Phase: 62-swap-station-polish*
*Context gathered: 2026-02-27*
