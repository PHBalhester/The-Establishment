# Phase 60: Design Tokens + Component Kit - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the foundation component kit: extended design tokens, 9-slice frame system, and all 8 themed primitive components (Button, Input, Tabs, Toggle, Slider, Card, Divider, Scrollbar). This phase also delivers a **comprehensive v1.1 asset specification document** cataloging every Photoshop asset needed across all 9 phases (60-68), with sizes and state variants, so the user can batch their Photoshop work in one session.

</domain>

<decisions>
## Implementation Decisions

### Frame aesthetic
- Ornate Victorian brass style — decorative scrollwork, filigree corners, engraved borders (gentleman-inventor aesthetic, not industrial)
- Two frame variants: ornate Victorian frames AND functional riveted frames — both with aged parchment background fills
- All frame content areas use the aged parchment texture from componentsinspo1.jpg — no dark recessed backgrounds
- Frame borders vary by decoration level (ornate vs industrial) but content surface is consistently parchment
- Reference images in `/Components/` folder: componentsinspo1.jpg (frames + dividers), componentsinspo2.jpeg (full component set), componentsinspo3.jpg (weathered industrial variants)

### Component personality
- Visual tone is a blend of polished brass (Image 2) and weathered patina (Image 3) — user will discover the right mix per-component during Photoshop work
- Text color on parchment components: dark brown/sepia — "ink on paper" aesthetic
- Background: aged parchment universally across all components — warm, period-authentic reading surface
- The factory's dark background provides contrast; components float as warm parchment-and-brass elements on top

### Variant & size system
- Single native size per component — 9-slice frames handle resizing naturally; CSS handles individual component scaling
- Asset spec defines "native size" (Photoshop creation size) for each piece
- Button variants: Claude's discretion based on actual app usage
- Component states as separate Photoshop assets: **Normal + Active only** (2 assets per interactive component)
- Hover state: CSS-only (no separate asset) — warm golden glow + brightness shift + subtle translateY lift
- Disabled state: CSS-only — opacity/desaturation on the Normal asset

### Interaction feel
- Blend of subtle/refined AND mechanical/tactile — Claude decides per-component what intensity matches the component's purpose
- Transition timing: **weighted (200-300ms)** — brass has physical mass, interactions feel deliberate
- Hover effect: golden/amber glow + brightness increase + tiny translateY(-1px) lift with shadow — "component lifts toward you"
- Click/active: swap to Active asset with the weighted transition timing
- Overall feel: high-quality game UI with mechanical authenticity

### Asset specification scope
- Full v1.1 catalog (all 9 phases, not just Phase 60) — one comprehensive asset spec document
- Covers: frames, buttons, inputs, toggles, sliders, cards, dividers, scrollbars, gauges, valve close button, gear loading spinner, chart frame, etc.
- Purpose: user can batch all Photoshop work in one session rather than context-switching each phase
- Spec defines: component name, native size, state variants needed, which phase uses it, notes on how to create from reference images

### Claude's Discretion
- Button variant count and types (based on analyzing current app usage)
- Interaction intensity per-component (which get mechanical vs subtle treatment)
- Design token naming and structure
- CSS implementation approach (layers, custom properties)
- Component API design (props, variants)

</decisions>

<specifics>
## Specific Ideas

- Reference images live in `/Components/` — AI-generated steampunk UI assets on transparent backgrounds
- Image 1: ornate Victorian brass frames with filigree corners, riveted edge rails, parchment fills, decorative scrollwork dividers
- Image 2: Big Red Button with brass bezel, recessed dark input fields, checkboxes, slider, scrollbar, gear icons, close button — polished game-UI quality
- Image 3: weathered/industrial variants — ON/OFF toggle, dome red button, riveted plates, simpler frames
- User will create assets in Photoshop from these AI references — blending polished and weathered styles as they work
- The asset spec MD file is the key Phase 60 deliverable for enabling Photoshop work — code components follow after

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 60-design-tokens-component-kit*
*Context gathered: 2026-02-24*
