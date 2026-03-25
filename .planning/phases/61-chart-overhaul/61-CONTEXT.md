# Phase 61: Chart Overhaul - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Transform charts from default lightweight-charts appearance to fully themed steampunk instruments with missing functional features. Includes: centralized chart theme, OHLC legend, volume histogram, data quality fixes, Frame wrapper, and UX polish (loading/empty/a11y). Does NOT include new chart types, new data sources, or trading features.

</domain>

<decisions>
## Implementation Decisions

### Tooltip & crosshair behavior
- Keep default crosshair axis labels (price on Y-axis, timestamp on X-axis) — do NOT add a floating tooltip panel near cursor
- Style axis labels with steampunk colors to match chart theme
- No custom HTML tooltip needed — axis labels + OHLC legend cover the information

### OHLC legend
- Position: top-left overlay inside the chart canvas (like TradingView/Binance convention)
- Updates on crosshair hover (shows hovered candle values), shows latest candle when idle
- Style: instrument readout feel — monospace font, bordered/framed, like a factory meter display
- Shows: O, H, L, C values + volume for the candle

### Volume histogram
- Overlaid at bottom of same chart pane (not a separate pane)
- Height: ~20% of chart area (subtle, doesn't obscure candles)
- Color: matches candle direction — green (up) / red (down)
- Toggle: checkbox in the chart controls bar to show/hide volume
- Semi-transparent so candle wicks remain visible through volume bars

### Watermark
- NO watermark — user explicitly declined. Skip entirely.

### Data quality fix (gap-fill removal)
- Remove synthetic zero-volume flat candles from API response
- Only show candles where actual trades occurred
- Let lightweight-charts handle natural time gaps in the axis
- This fixes the "data feels wrong" issue — long flat lines from gap-fill were misleading

### Loading state
- Spinning gear using the project logo (`WebsiteAssets/logo:icon.png` → copy to `app/public/`)
- Same image as favicon — brand consistency
- CSS animation rotation (no JS timer)
- Centered in chart area, shown during data fetch

### Empty state
- Themed message when pool has zero trades: steampunk-styled text (e.g., "No trades recorded in this factory")
- Chart area still framed (Frame component visible)
- Informative, not a call-to-action

### Shorter timeframes
- Add 1m, 5m, 15m to chart controls alongside existing 1H/4H/1D/1W
- Default to 5m (memecoin trading standard)
- Memecoin traders need sub-hour timeframes for entry/exit timing

### Log scale default
- Default to logarithmic scale for memecoin pools (prices can move orders of magnitude)
- Provide log/linear toggle button in controls bar

### Claude's Discretion
- Exact crosshair axis label styling (colors, font size, background)
- OHLC legend border/frame treatment (how brass-gauge it looks)
- Volume bar opacity value
- Loading gear animation speed
- Empty state exact copy and typography
- Chart creation helper API design
- Keyboard accessibility implementation details
- Resize debounce timing

</decisions>

<specifics>
## Specific Ideas

- OHLC legend should feel like "a brass gauge readout" — monospace, bordered, instrument-like
- Loading spinner uses the same gear image as the favicon (`logo:icon.png` from WebsiteAssets)
- Volume toggle lives in the controls bar alongside time range and resolution pickers
- Gap-fill candle removal is a functional fix, not just visual — currently confuses users about price behavior

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 61-chart-overhaul*
*Context gathered: 2026-02-26*
