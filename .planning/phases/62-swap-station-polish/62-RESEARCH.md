# Phase 62: Swap Station Polish - Research

**Researched:** 2026-02-27
**Domain:** CSS layout restructuring, component kit application, 9-slice asset integration, responsive two-column layout, image-based button patterns
**Confidence:** HIGH

## Summary

This phase transforms the Swap Station modal from its current single-column stacked layout into a polished, steampunk-themed two-column design applying the Phase 60 component kit. The work spans five distinct areas: (1) replacing the modal chrome with kit Frame, (2) restructuring the below-chart area from vertical stack to two-column layout, (3) restyling the stats bar as a dual-panel pool selector with riveted brass background, (4) applying kit components to the swap form and chart controls, and (5) integrating a custom Photoshop Big Red Button asset.

The existing codebase is well-structured for this transformation. SwapStation.tsx is a clean layout compositor (141 lines) that composes five child components. The component kit (Phase 60) provides all needed primitives: Frame, Button, Input, Toggle, Card, Divider. The chart pipeline from Phase 61 (ChartWrapper, ChartControls, CandlestickChart) is already wrapped in a Frame. The current modal system uses a singleton dialog (ModalShell) with `.modal-chrome` CSS and `.station-content` dark inner wrapper -- Phase 62 replaces this chrome with kit Frame for the swap station specifically.

The critical user instruction is that the two-column layout restructuring MUST come first as its own wave, before any individual component restyling. This is architecturally sound: layout changes affect all children, so getting the container structure right before restyling contents avoids rework.

**Primary recommendation:** Execute in the following wave order: (1) modal Frame + two-column layout restructuring, (2) stats bar dual-panel pool selector, (3) chart controls restyling, (4) swap form kit Input application, (5) Big Red Button asset integration. Each wave is independently verifiable.

## Standard Stack

### Core (Already Installed -- Zero New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.1.18 | @theme tokens, utility classes for layout | Already installed |
| Next.js | 16.1.6 | CSS handling, public/ static serving for assets | Already installed |
| React | 19.2.3 | Component architecture | Already installed |
| lightweight-charts | 5.x | TradingView chart (untouched in this phase) | Already installed |

### Supporting (Already Available)
| Library | Purpose | When to Use |
|---------|---------|-------------|
| Kit components (Phase 60) | Frame, Button, Input, Toggle, Card, Divider | All component restyling |
| CSS Grid / Flexbox | Two-column responsive layout | Below-chart layout restructuring |
| CSS border-image | 9-slice riveted brass panel | Stats bar and swap section panels |
| CSS @layer kit | Component styling cascade | All new kit.css additions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS Grid for two-column | Flexbox with percentages | Grid is better: `grid-template-columns` handles equal-height columns natively, flexbox requires workarounds |
| Image element for Big Red Button | CSS background-image | `<img>` is better: clearer semantics, alt text for a11y, easier loading state handling, no need for explicit width/height |
| Inline style for riveted panel | New kit CSS class | New CSS class is better: reusable, cacheable, consistent with kit.css pattern |

**Installation:** None required. All tools are already in the project.

## Architecture Patterns

### Current SwapStation Component Tree
```
SwapStation.tsx (layout compositor)
  SwapStatsBar.tsx              -- display-only stats (mcap + tax rates)
  ChartWrapper.tsx              -- Frame + loading/empty + a11y
    ChartControls.tsx           -- pool selector, timeframes, toggles
    CandlestickChart.tsx        -- TradingView chart
  SwapForm.tsx                  -- swap inputs + BigRedButton via renderAction
    TokenSelector.tsx           -- custom dropdown for token selection
    FeeBreakdown.tsx            -- expandable fee details
    SlippageConfig.tsx          -- slippage + priority fee presets  [BEING REMOVED]
    RouteSelector.tsx           -- smart routing route picker
    MultiHopStatus.tsx          -- multi-hop progress UI
    BigRedButton.tsx            -- 3D CSS circular swap button  [BEING REPLACED]
```

### Target SwapStation Component Tree (After Phase 62)
```
SwapStation.tsx (layout compositor)
  StatsBar                      -- TWO clickable faction panels (CRIME/FRAUD)
                                   each shows: mcap + buy tax + sell tax
                                   clicking switches chart pool (replaces pool dropdown)
                                   riveted brass panel background (9-slice asset)
  ChartWrapper                  -- unchanged from Phase 61
    ChartControls               -- restyled with kit Button/Toggle
                                   pool dropdown REMOVED (stats bar is now pool selector)
    CandlestickChart            -- unchanged from Phase 61
  ┌─────────────────────────────────────────────────────┐
  │ TWO-COLUMN LAYOUT (CSS Grid)                        │
  │                                                     │
  │  LEFT COLUMN (~50%)          RIGHT COLUMN (~50%)    │
  │  ┌─────────────────┐        ┌─────────────────┐    │
  │  │ Swap Form        │        │ Big Red Button   │    │
  │  │ - You Pay input  │        │ (Photoshop asset)│    │
  │  │ - Flip arrow     │        │                  │    │
  │  │ - You Receive    │        │ Swap Summary:    │    │
  │  │ - Smart Routing  │        │ - est. output    │    │
  │  │ - Route Selector │        │ - total fees     │    │
  │  │ - Fee Breakdown  │        │ - price impact   │    │
  │  │                  │        │                  │    │
  │  │ "Swap settings"  │        │                  │    │
  │  │  quick link      │        │                  │    │
  │  └─────────────────┘        └─────────────────┘    │
  └─────────────────────────────────────────────────────┘
  (Mobile: stacks vertically -- swap form on top, button below)
```

### Pattern 1: Two-Column Responsive Grid
**What:** CSS Grid layout for the below-chart area that splits into two equal columns on desktop and stacks on mobile.
**When to use:** The below-chart area where swap form and Big Red Button live.
**Confidence:** HIGH (standard CSS Grid pattern)

```css
/* kit.css -- add to @layer kit */
.swap-station-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  align-items: start;
}

/* Mobile: single column stack */
@media (width < 64rem) {
  .swap-station-columns {
    grid-template-columns: 1fr;
  }
}
```

**Why CSS Grid over Flexbox:** Grid gives us `grid-template-columns: 1fr 1fr` for truly equal column widths regardless of content. With flexbox, uneven content causes uneven columns unless you explicitly set width: 50% (which then needs gap compensation). Grid handles gap + equal columns natively.

**Why `width < 64rem`:** This is the project's established mobile breakpoint (globals.css line 979). Maintaining consistency with existing responsive patterns.

### Pattern 2: Stats Bar as Dual-Panel Pool Selector
**What:** Transform SwapStatsBar from a passive display bar into an interactive pool selector with two clickable faction panels.
**When to use:** Stats bar at the top of SwapStation, replacing the pool dropdown in ChartControls.
**Confidence:** HIGH (read existing SwapStatsBar.tsx and ChartControls.tsx props)

```tsx
// SwapStatsBar receives onPoolChange + activePool props from SwapStation
// Each panel is a <button> (not a div) for keyboard accessibility
interface StatsBarProps {
  activePool: string;           // current chart pool address
  onPoolChange: (pool: string) => void;  // sets chart pool
}

// Each panel renders:
//   CRIME                     FRAUD
//   $1.2M mcap                $0.8M mcap
//   Buy 3.5% / Sell 4.0%     Buy 2.0% / Sell 3.0%
//
// Active panel: factory-glow border + brighter background
// Inactive panel: muted/dimmed
```

**Key architectural decision:** This moves the pool selection responsibility from ChartControls to SwapStatsBar. The `pool` and `onPoolChange` props in ChartControls become unnecessary, and the pool `<select>` dropdown is removed. The ChartControls component signature simplifies.

### Pattern 3: Big Red Button as Custom Asset
**What:** Replace the CSS-only circular button with a rectangular Photoshop asset rendered via `<img>` or `<button>` with background-image.
**When to use:** The right column of the two-column layout.
**Confidence:** HIGH (standard pattern for custom button assets)

```tsx
// BigRedButton.tsx rewrite approach:
// 1. Use <button> wrapping an <img> for semantic + a11y
// 2. data-state attribute drives CSS overlay animations (same pattern as current)
// 3. Asset is a single image; loading/success/error are CSS overlays on top
// 4. Asset text ("BIG RED BUTTON") is baked into the image (not HTML)

<button
  type="button"
  className="big-red-button-asset"
  data-state={dataState}
  disabled={disabled}
  onClick={handleClick}
  aria-label={ariaLabel}
>
  <img
    src="/buttons/big-red-button.png"
    alt=""  // decorative -- aria-label on button provides semantics
    className="big-red-button-image"
    draggable={false}
  />
  {/* Overlay for loading spinner, success checkmark, error indicator */}
  {dataState === 'loading' && <LoadingOverlay />}
  {dataState === 'success' && <SuccessOverlay />}
  {dataState === 'error' && <ErrorOverlay />}
</button>
```

**Important:** The user will design the Photoshop asset. The implementation should accept any rectangular image at a known path. The plan must include a placeholder step that works until the asset is ready.

### Pattern 4: Modal Frame Replacement
**What:** Replace the current `.modal-chrome` CSS frame (box-shadow + corner bolts) with the kit Frame component for the Swap Station.
**When to use:** The outermost visual container of the swap modal.
**Confidence:** HIGH (Frame component already exists and is tested)

**Approach considerations:** The current modal system uses a singleton ModalShell that renders `.modal-chrome` for ALL stations. Phase 62 only styles the Swap Station. Two approaches:

**Option A -- Station-level Frame:** Keep ModalShell as-is. Wrap SwapStation content in a `<Frame>` component INSIDE the `.station-content` dark wrapper. This adds a frame inside a frame (modal-chrome + station-Frame). Not ideal visually.

**Option B -- Conditional modal chrome:** Modify ModalShell to conditionally apply different chrome based on the active station. Swap station gets kit Frame; others keep `.modal-chrome`. This is the cleaner approach but touches shared modal infrastructure.

**Recommendation:** Option B is the right approach long-term (all stations will eventually get kit Frame). But for Phase 62 scope, a simpler intermediate step: add a `chromeMode` prop or data attribute to ModalShell that lets individual stations opt into kit Frame styling. The ModalShell JSX stays mostly the same, but a CSS class swap (`.modal-chrome` vs `.modal-chrome-kit`) changes the visual treatment. This is reversible and doesn't break other stations.

**Simplest implementation:** Add a `chromeVariant` field to STATION_META in ModalShell.tsx. When `chromeVariant === 'kit-frame'`, the `.modal-chrome` div gets an additional class that replaces the current box-shadow/border with kit Frame styling. Other stations continue using the default chrome.

### Pattern 5: Riveted Brass Panel for Stats Bar + Swap Section
**What:** A reusable CSS class using the existing `riveted-paper.png` 9-slice asset as a background panel for the stats bar and swap form column.
**When to use:** Stats bar container and left-column swap form panel.
**Confidence:** HIGH (the riveted-paper.png asset and border-image infrastructure already exist from Phase 60)

```css
/* kit.css -- riveted brass panel for inline sections */
.kit-panel-riveted {
  border: 16px solid var(--color-factory-accent);
  border-image-source: url('/frames/riveted-paper.png');
  border-image-slice: 80 fill;
  border-image-width: 16px;
  border-image-repeat: round;
  border-radius: 0;
  background: none;
}
```

**Note:** The stats bar and swap section use a thinner border-image-width (16px) than the modal Frame (30px) because they are interior panels, not the outermost frame. The `border-image-slice` value (80) stays the same since it refers to the source image pixel coordinates. Only the `border-image-width` (CSS render size) changes.

### Anti-Patterns to Avoid
- **Restyling components before the layout restructure is complete:** The user explicitly requires layout restructuring FIRST, then component restyling. Attempting both simultaneously leads to rework when container dimensions change.
- **Modifying SwapForm's hook logic:** Phase 62 is purely visual. The `useSwap()` hook, route engine, and swap execution logic must not be touched. Only the JSX/CSS presentation layer changes.
- **Breaking the renderAction prop pattern:** BigRedButton currently receives its props via SwapForm's `renderAction` callback. This pattern must be preserved -- BigRedButton moves to the right column but still receives its state from SwapForm.
- **Removing SlippageConfig without a Settings modal destination:** CONTEXT.md says settings move to Settings modal (Phase 65 coordination). For Phase 62, REMOVE SlippageConfig from SwapForm's JSX render. The component and hook state remain available -- they just stop rendering inline. Phase 65 will wire them into Settings modal.
- **Using border-image with border-radius together:** CSS spec says border-image ignores border-radius (Phase 60 RESEARCH.md Pitfall 1). The riveted brass panels must be rectangular.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Steampunk button styling | Custom CSS from scratch | Kit Button component (`.kit-button-*`) | Already has primary/secondary/ghost variants with hover, press, disabled, focus |
| Themed text input | Custom input styling | Kit Input component (`.kit-input`) | Already has recessed gauge look, focus glow, disabled state, suffix support |
| On/off switch | Custom toggle CSS | Kit Toggle component (`.kit-toggle`) | Already has role="switch", aria-pressed, brass knob animation |
| Panel border frame | Custom box-shadow styling | Kit Frame `mode="asset"` or `.kit-panel-riveted` class | 9-slice infrastructure exists, fallback border handling included |
| Active/inactive tab styling | Custom active class | Kit Tab component with `data-state="active"` | Already has lever press-down, glow, disabled states |
| Responsive stacking | Custom JS viewport detection | CSS `@media (width < 64rem)` grid override | Project's established mobile breakpoint pattern |
| Hover glow effect | Per-component hover CSS | `.kit-interactive` class | Shared brightness + translateY + golden glow with timing tokens |
| Focus ring | Per-component focus CSS | `.kit-focus` class | Consistent golden glow ring for keyboard navigation |

**Key insight:** Phase 60 built ALL the primitives needed. Phase 62's job is applying them, not building new ones. The only new CSS classes needed are layout-specific (`.swap-station-columns`, `.kit-panel-riveted`, `.big-red-button-asset`).

## Common Pitfalls

### Pitfall 1: BigRedButton State Prop Threading After Layout Change
**What goes wrong:** After moving BigRedButton to the right column (separate from SwapForm's render tree), the `renderAction` prop pattern breaks because BigRedButton is no longer a child of SwapForm.
**Why it happens:** The current architecture renders BigRedButton INSIDE SwapForm via `renderAction`. If the layout change moves BigRedButton outside SwapForm's JSX tree, it loses access to useSwap() state.
**How to avoid:** Two valid approaches:
1. **Keep renderAction but restructure SwapForm's output** -- SwapForm can accept a `renderAction` that returns its content, but the CALLER (SwapStation) places the rendered action in the right column. SwapForm renders the form in the left column; SwapStation extracts the action and places it in the right column. This requires SwapForm to expose the action as a separate render slot.
2. **Lift swap state to SwapStation** -- SwapStation calls useSwap() and passes state down to both SwapForm and BigRedButton as props. This is a bigger refactor but cleaner long-term.

**Recommendation:** Approach 2 (lift state) is cleaner and matches the CONTEXT.md structure where BigRedButton and swap summary are in the right column, fully independent of SwapForm's tree. However, this is a significant refactor of SwapForm (currently the sole hook consumer). The planner should account for this complexity.

**Alternative Approach (minimal refactor):** Keep SwapForm as the sole hook consumer, but have it expose TWO render slots: one for the form content (left column) and one for the action area (right column). SwapStation composes them into the grid. This preserves the existing hook consumer pattern while enabling the two-column layout.

```tsx
// SwapStation layout with dual render slots:
<div className="swap-station-columns">
  <SwapForm
    renderAction={...}       // BigRedButton + summary for right column
    className="col-start-1"  // Left column
  />
  {/* Right column rendered via renderAction output */}
</div>
```

**Simplest approach:** Since SwapForm already accepts `renderAction` and `className`, and renders `renderAction` at the END of its output, we can restructure SwapStation to use CSS Grid to VISUALLY reposition the BigRedButton area to the right column using `grid-column` / `grid-row` placement, even though it renders in DOM order at the bottom of SwapForm. CSS Grid allows children to be placed in any grid cell regardless of source order.

**However** -- this only works if the BigRedButton and swap summary are separate DOM siblings from the form fields, which they are NOT currently (they render inside SwapForm's div). The grid approach requires the grid container to be a PARENT of both columns' content.

**Final recommendation:** The planner must choose between refactoring SwapForm's render structure or lifting state. Both are viable. The research documents both approaches so the planner can make an informed decision. The key constraint is: BigRedButton MUST receive useSwap() state.

### Pitfall 2: Stats Bar Pool Selection Callback Threading
**What goes wrong:** Stats bar panels need `onPoolChange` callback, but the current SwapStatsBar has no props -- it's self-contained (fetches its own data via hooks).
**Why it happens:** SwapStatsBar was designed as display-only. Adding pool selection requires threading the callback from SwapStation through to SwapStatsBar.
**How to avoid:** Add `activePool` and `onPoolChange` props to SwapStatsBar. SwapStation already has `chartPool` and `setChartPool` state -- just pass them down. Remove `pool` and `onPoolChange` from ChartControls (or mark them optional and stop passing them).
**Warning signs:** Pool selector appearing in both stats bar AND chart controls. The pool dropdown must be REMOVED from ChartControls.

### Pitfall 3: Kit Frame Inside Station-Content Color Clash
**What goes wrong:** Kit Frame sets `color: var(--color-frame-ink)` (dark brown, for parchment backgrounds). But `.station-content` sets `color: var(--color-factory-text)` (light cream, for dark backgrounds). Text becomes unreadable.
**Why it happens:** The existing `.station-content` wrapper provides a dark background for existing components. Kit Frame provides a parchment background. If both apply, the dark background wins (station-content is the outer container), but the Frame's ink color makes text invisible on the dark background.
**How to avoid:** When the Swap Station adopts kit Frame as its overall chrome, the `.station-content` dark wrapper's role changes. The stats bar, swap form panels, and button area need their own dark backgrounds (var(--color-factory-bg)) or parchment backgrounds depending on the section. The Frame's ink color should only apply INSIDE parchment areas, not across the entire station.

**Recommendation:** The swap station layout should NOT use kit Frame mode="asset" for the entire station content. Instead, the overall modal gets kit Frame (replacing .modal-chrome), and the station content remains on a dark background. Individual sections (stats bar panels, swap form wrapper) get riveted brass panels (parchment background) where appropriate. The chart and button areas stay on dark backgrounds.

**Actually, on re-read:** The CONTEXT.md says "Entire modal wrapped in kit Frame component (replaces current CSS brass border + corner bolts)". This means the Frame replaces .modal-chrome (the outermost chrome), not the .station-content inner area. The dark .station-content wrapper stays. This avoids the color clash entirely.

### Pitfall 4: Removing SlippageConfig Without Breaking useSwap
**What goes wrong:** Removing `<SlippageConfig>` from SwapForm's JSX causes the slippage/priority values to revert to defaults because the state setters are no longer called.
**Why it happens:** useSwap() maintains slippageBps and priorityFeePreset in state with sensible defaults (100bps, "medium"). Removing the UI doesn't reset the state -- the defaults just remain. This is actually FINE -- the swap still works with default slippage.
**How to avoid:** Simply remove the `<SlippageConfig>` JSX. The useSwap hook state retains its defaults. Add the "Swap settings" text link that opens the Settings modal (or for Phase 62, just links to the settings station). Phase 65 will add the actual slippage/priority controls to Settings.
**Warning signs:** Users unable to adjust slippage between Phase 62 (removal) and Phase 65 (re-addition in Settings). Ensure defaults are reasonable (1% slippage, medium priority).

### Pitfall 5: Big Red Button Asset Not Ready During Development
**What goes wrong:** The Photoshop asset doesn't exist yet when the developer implements the button component.
**Why it happens:** User designs assets in Photoshop on their own timeline. Code implementation may outpace asset creation.
**How to avoid:** Use a CSS-only placeholder that mimics the target dimensions and has clear "PLACEHOLDER" text. The implementation should use an `<img>` tag that cleanly swaps to the real asset when it's placed in `public/buttons/big-red-button.png`. Include a fallback in the component that renders the current CSS circular button if the asset file fails to load.
**Warning signs:** Component silently failing because the asset path is wrong or the file doesn't exist.

### Pitfall 6: Grid Column Height Mismatch
**What goes wrong:** The left column (swap form) is taller than the right column (Big Red Button + summary), creating awkward whitespace.
**Why it happens:** CSS Grid defaults to `align-items: stretch`, making both columns equal height. If the right column content is shorter, it stretches with empty space at the bottom.
**How to avoid:** Use `align-items: start` on the grid container so each column is only as tall as its content. The Big Red Button + swap summary naturally fills less height than the swap form, and that's fine -- it creates visual breathing room.

### Pitfall 7: Mobile Grid Stack Breaks renderAction Pattern
**What goes wrong:** On mobile, the grid stacks to single column. If BigRedButton renders inside a CSS Grid cell separate from SwapForm, the visual order on mobile may put the button above or below the form in an unexpected position.
**Why it happens:** CSS Grid's `grid-template-columns: 1fr` stacking follows source order. If BigRedButton's grid cell is second in source order, it stacks below the form -- which is correct per CONTEXT.md ("swap form on top, Big Red Button below").
**How to avoid:** Ensure DOM order matches the desired mobile stack order: form first, button second. CSS Grid on desktop rearranges into two columns. This is the default behavior, so just verify source order matches mobile intent.

## Code Examples

### Example 1: Two-Column Grid Layout
```tsx
// SwapStation.tsx -- target layout structure
return (
  <div className="flex flex-col gap-4">
    {/* Stats bar with pool selection */}
    <SwapStatsBar
      activePool={chartPool}
      onPoolChange={setChartPool}
    />

    {/* Chart (unchanged from Phase 61) */}
    <ChartWrapper {...chartProps}>
      <ChartControls
        // pool/onPoolChange REMOVED -- stats bar handles this now
        range={range}
        onRangeChange={setRange}
        resolution={resolution}
        onResolutionChange={setResolution}
        connectionStatus={connectionStatus}
        showVolume={showVolume}
        onVolumeToggle={() => setShowVolume(v => !v)}
        logScale={logScale}
        onLogScaleToggle={() => setLogScale(v => !v)}
      />
      <CandlestickChart {...chartProps} />
    </ChartWrapper>

    {/* Two-column below-chart area */}
    <div className="swap-station-columns">
      {/* Left: Swap form */}
      <div>
        {/* SwapForm content here */}
      </div>

      {/* Right: Big Red Button + swap summary */}
      <div>
        {/* BigRedButton + summary here */}
      </div>
    </div>
  </div>
);
```

### Example 2: Stats Bar Faction Panel
```tsx
// A single faction panel (CRIME or FRAUD)
<button
  type="button"
  onClick={() => onPoolChange(poolAddress)}
  className={`kit-panel-riveted flex-1 px-4 py-3 text-left transition-all ${
    isActive
      ? 'ring-2 ring-factory-glow shadow-[0_0_12px_rgba(240,192,80,0.3)]'
      : 'opacity-70 hover:opacity-90'
  }`}
  aria-pressed={isActive}
  aria-label={`Show ${faction} chart`}
>
  <div className="font-heading text-sm font-semibold">{faction}</div>
  <div className="font-mono text-xs mt-1">{formatMcap(mcap)}</div>
  <div className="text-xs mt-0.5">
    Buy {bpsToPercent(buyBps)} / Sell {bpsToPercent(sellBps)}
  </div>
</button>
```

### Example 3: Kit Button Applied to Chart Controls Timeframe Buttons
```tsx
// ChartControls.tsx -- timeframe buttons with kit Button
import { Button } from '@/components/kit';

{TIMEFRAME_OPTIONS.map((opt) => (
  <Button
    key={opt.label}
    variant={isTimeframeActive(opt, resolution, range) ? 'primary' : 'secondary'}
    size="sm"
    onClick={() => handleTimeframeClick(opt)}
  >
    {opt.label}
  </Button>
))}
```

### Example 4: Kit Input for Swap Amount Fields
```tsx
// Swap form "You pay" field using kit Input
import { Input } from '@/components/kit';

<Input
  type="text"
  inputMode="decimal"
  placeholder="0"
  value={swap.inputAmount}
  disabled={isTransacting}
  onChange={(e) => { /* existing handler */ }}
  label="You pay"
  wrapperClassName="flex-1"
/>
// Token selector attaches as a sibling or via a composite wrapper
```

**Note:** Kit Input has a `suffix` prop but the swap form needs a full dropdown button (TokenSelector) on the right side, not just a text suffix. The implementation will need a composite pattern: Input + TokenSelector as siblings in a flex row, or a new wrapper that positions TokenSelector absolutely over the Input's right side.

### Example 5: Big Red Button Asset Component
```tsx
// BigRedButton.tsx -- asset-based version
<button
  type="button"
  className="big-red-button-asset kit-interactive"
  data-state={dataState}
  disabled={disabled && status === 'idle'}
  onClick={handleClick}
  aria-label={ariaLabel}
>
  <img
    src="/buttons/big-red-button.png"
    alt=""
    className="w-full h-auto pointer-events-none select-none"
    draggable={false}
  />
  {/* State overlays render on top of the image */}
  {dataState === 'loading' && (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded">
      <LoadingSpinner />
    </div>
  )}
  {dataState === 'success' && (
    <div className="absolute inset-0 flex items-center justify-center bg-green-500/30 rounded animate-pulse" />
  )}
  {dataState === 'error' && (
    <div className="absolute inset-0 animate-shake" />
  )}
</button>
```

### Example 6: Swap Summary (Under Big Red Button)
```tsx
// Swap summary below the Big Red Button in the right column
<div className="mt-3 space-y-1 text-sm">
  {quote && (
    <>
      <div className="flex justify-between">
        <span className="text-factory-text-muted">Estimated output</span>
        <span className="text-factory-text font-mono">
          {formatAmount(quote.expectedOutput, outputToken)} {outputToken}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-factory-text-muted">Total fees</span>
        <span className="text-factory-text-secondary font-mono">
          {quote.totalFeePct}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-factory-text-muted">Price impact</span>
        <span className={impactClass}>
          {bpsToPercent(quote.priceImpactBps)}
        </span>
      </div>
    </>
  )}
</div>
```

## Key Implementation Details

### SwapForm Restructuring Strategy

The central architectural challenge is separating BigRedButton from SwapForm's render tree while maintaining access to useSwap() state. Three viable strategies exist:

**Strategy A: Dual Render Slots (Recommended)**
SwapForm accepts TWO render props: `renderForm` and `renderAction`. SwapStation calls SwapForm once, places the form output in the left column and the action output in the right column. useSwap() stays inside SwapForm.

```tsx
<div className="swap-station-columns">
  <SwapForm
    renderForm={(formContent) => <div>{formContent}</div>}
    renderAction={(actionProps) => (
      <div>
        <BigRedButton {...actionProps} />
        <SwapSummary quote={actionProps.quote} />
      </div>
    )}
  />
</div>
```

**Problem:** SwapForm renders a single `<div>`. It can't render into two separate grid cells because CSS Grid requires children of the grid container. SwapForm's output is a single child.

**Strategy B: Lift useSwap to SwapStation (Cleanest)**
Move the `useSwap()` call from SwapForm to SwapStation. Pass all needed state as props to both SwapForm (left column) and BigRedButton (right column). SwapForm becomes a pure presentational component.

- **Pro:** Clean separation, each column is a direct child of the grid container
- **Con:** Significant refactor of SwapForm (currently 460 lines of JSX that depends on useSwap() internals), and ALL places that render SwapForm need to supply props
- **Mitigation:** SwapForm is only used in SwapStation.tsx (the modal) via lazy import. There's only one consumer.

**Strategy C: CSS Grid with Subgrid/Source Reorder (Fragile)**
Keep SwapForm's current structure but use CSS to visually split its children across grid cells. Requires subgrid or display:contents hacks. Fragile and brittle.

**Recommendation for Planner:** Strategy B is the correct long-term architecture. The refactor is bounded (SwapForm has exactly one consumer: SwapStation.tsx). The planner should allocate a full wave to this structural change before any visual restyling.

### ChartControls Simplification

After stats bar takes over pool selection:
- Remove `pool` and `onPoolChange` props from ChartControls
- Remove the pool `<select>` dropdown from the JSX
- Remove the `POOL_OPTIONS` export (move it to SwapStatsBar or SwapStation)
- The spacer div (`<div className="flex-1" />`) may become unnecessary
- The component simplifies to: timeframe buttons + resolution dropdown + log toggle + volume toggle + connection status

### Settings Removal Coordination

CONTEXT.md decision: "Settings (slippage tolerance, priority fee) REMOVED from swap form -- moved to Settings modal."

Phase 62 action: Remove `<SlippageConfig>` from SwapForm render. Add a small text link "Swap Settings" that opens the Settings station. The link uses the modal system's `openModal('settings')` function.

Phase 65 action (deferred): Add slippage/priority controls to SettingsStation.

**Interim behavior (Phase 62-64):** Users cannot adjust slippage or priority fees from the swap interface. Defaults apply (1% slippage, medium priority). This is acceptable for devnet but must be resolved before mainnet.

### Asset Requirements Summary

| Asset | Creator | Path | Status |
|-------|---------|------|--------|
| riveted-paper.png | Already exists | public/frames/riveted-paper.png | DONE (276KB, Phase 60) |
| big-red-button.png | User (Photoshop) | public/buttons/big-red-button.png | NOT YET CREATED |
| kit Frame (CSS mode) | Phase 60 code | .kit-frame-css class | DONE |
| kit Frame (asset mode) | Phase 60 code | .kit-frame-asset class | DONE |

**Placeholder strategy for big-red-button.png:** Generate a CSS-only rectangular placeholder matching the target dimensions. When the user creates the asset, swap `<img src>` to point to it. No code changes needed -- the img tag already points to the right path.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Circular CSS Big Red Button | Rectangular Photoshop asset button | Phase 62 | Visual identity upgrade |
| Pool dropdown in ChartControls | Clickable faction panels in stats bar | Phase 62 | UX improvement -- fewer clicks, more info |
| Single-column below-chart layout | Two-column grid layout | Phase 62 | Desktop space utilization |
| Slippage/priority in swap form | Settings modal (Phase 65) | Phase 62-65 | Cleaner swap form, settings centralized |
| CSS-only modal chrome (.modal-chrome) | Kit Frame component | Phase 62 | Consistent component kit application |

## Wave Structure (User Requirement)

The user explicitly instructed: "The modal layout restructuring (two-column below-chart layout) must come FIRST as its own wave. Then individual component restyling should be separate waves -- one component at a time."

### Recommended Wave Order

**Wave 1: Layout Restructuring**
- Replace modal chrome with kit Frame (for swap station only)
- Restructure SwapStation for two-column grid below chart
- Refactor SwapForm/BigRedButton state threading (Strategy B)
- Mobile responsive stacking
- Verification: layout looks correct with unstyled components

**Wave 2: Stats Bar Restyle**
- Transform SwapStatsBar into dual-panel pool selector
- Add riveted brass panel background
- Wire onPoolChange callback
- Remove pool dropdown from ChartControls
- Active/inactive panel visual states

**Wave 3: Chart Controls Restyle**
- Apply kit Button to timeframe buttons
- Apply kit Toggle to volume/log toggles
- Restyle resolution dropdown with kit styling
- Restyle connection status indicator
- Remove pool selector code from ChartControls

**Wave 4: Swap Form Restyle**
- Apply kit Input to amount fields (You Pay / You Receive)
- Restyle TokenSelector with brass dropdown appearance
- Apply kit Toggle to Smart Routing switch
- Remove SlippageConfig, add settings quick-link
- Restyle FeeBreakdown with kit patterns
- Restyle flip arrow button

**Wave 5: Big Red Button Integration**
- Implement asset-based BigRedButton component
- CSS overlays for loading/success/error states
- Swap summary below button (estimated output, fees, impact)
- Placeholder until Photoshop asset is created
- Final visual verification

## Open Questions

1. **SwapForm refactor depth**
   - What we know: BigRedButton must render in a separate grid column from SwapForm content. This requires breaking the current pattern where BigRedButton renders inside SwapForm via renderAction.
   - What's unclear: How much of SwapForm's internal state needs to be exposed to SwapStation for the lift. The useSwap() hook returns ~20 values.
   - Recommendation: The planner should inspect useSwap() return type and determine the minimal props interface for a refactored SwapForm. The refactor is bounded (one consumer) but worth detailed task breakdown.

2. **Modal chrome transition approach**
   - What we know: ModalShell renders .modal-chrome for all stations. Phase 62 only changes the swap station.
   - What's unclear: Whether to add a conditional per-station chrome class now (simple) or wait until all stations are polished (Phases 63-66) and do a bulk migration.
   - Recommendation: Add a `chromeVariant` field to STATION_META now. Set swap to 'kit-frame', all others to 'classic'. This is forward-compatible and each subsequent phase just flips the variant.

3. **Big Red Button asset dimensions**
   - What we know: It's rectangular, takes up the right half of the below-chart area, similar height to the swap section.
   - What's unclear: The exact pixel dimensions the user will design at.
   - Recommendation: Use `width: 100%; height: auto` on the `<img>` so it scales to fill its column. The aspect ratio is determined by the asset. If the height is too tall/short, CSS `max-height` or `object-fit` can constrain it.

4. **Route display treatment**
   - What we know: CONTEXT.md defers route display decisions until after two-column layout is implemented.
   - What's unclear: Where RouteSelector and MultiHopStatus render in the new layout (left column with form? Below both columns? Overlay?).
   - Recommendation: Keep them in the left column (below the swap form inputs) for now. They are part of the swap form's input configuration. This can be revisited after Wave 1 layout is visible.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** -- SwapStation.tsx, SwapStatsBar.tsx, BigRedButton.tsx, SwapForm.tsx, ChartControls.tsx, ChartWrapper.tsx, all kit components, globals.css, kit.css, ModalShell.tsx, ModalContent.tsx
- **Phase 60 RESEARCH.md** -- Kit component architecture, 9-slice border-image patterns, CSS @layer cascade
- **Phase 60-06 SUMMARY.md** -- Kit component inventory (9 components, barrel export)
- **Phase 61-03 SUMMARY.md** -- Chart pipeline: ChartWrapper + ChartControls + CandlestickChart
- **Phase 62 CONTEXT.md** -- All user decisions constraining this phase

### Secondary (MEDIUM confidence)
- **MDN CSS Grid** -- grid-template-columns, align-items, responsive grid patterns
- **MDN border-image** -- 9-slice slice values, border-image-width independent of slice

### Tertiary (LOW confidence)
- None -- all findings are codebase-verified or from primary CSS spec sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all tools already installed and verified
- Architecture patterns: HIGH -- all patterns verified against existing codebase structure
- Layout restructuring: HIGH -- CSS Grid is standard, mobile breakpoint matches existing pattern
- SwapForm refactoring: MEDIUM -- the refactor approach is clear but the task complexity depends on useSwap() interface, which wasn't fully enumerated
- Kit component application: HIGH -- all kit components exist and are tested
- Big Red Button asset integration: MEDIUM -- standard img pattern but depends on user-provided asset timing
- Pitfalls: HIGH -- all identified from direct codebase inspection and Phase 60 research

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain -- CSS layout patterns and existing kit don't change frequently)
