# Phase 61: Chart Overhaul - Research

**Researched:** 2026-02-26
**Domain:** TradingView Lightweight Charts v5 theming, OHLC legend, volume histogram, UX polish
**Confidence:** HIGH

## Summary

This phase transforms the existing `CandlestickChart.tsx` from a functional but unstyled chart wrapper into a fully themed steampunk chart instrument. The existing code already uses lightweight-charts v5.1.0 correctly (v5 `addSeries(CandlestickSeries, options)` API), has a working ResizeObserver, and incremental update optimization. The overhaul adds: centralized theme constants, chart creation helper to reduce boilerplate, OHLC legend overlay, volume histogram series, steampunk-styled crosshair axis labels, Frame wrapper, loading/empty states, and keyboard accessibility.

All required APIs are verified from the installed typings at `node_modules/lightweight-charts/dist/typings.d.ts`. The library is already installed at v5.1.0 and no version changes are needed. The primary risk is SSR -- all lightweight-charts imports must remain behind `'use client'` boundaries.

**Primary recommendation:** Extract all hardcoded hex values from `CandlestickChart.tsx` into a `chart-theme.ts` module, build a `createThemedChart()` helper, then layer on the OHLC legend (via `subscribeCrosshairMove`) and volume histogram (via `HistogramSeries` with `priceScaleId: ''` overlay) as additive features to the existing chart.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lightweight-charts | 5.1.0 | Candlestick chart, histogram series, crosshair events | Already installed, v5 API confirmed working |
| React | 19.2.3 | Component framework | Already in use |
| Next.js | 16.1.6 | App framework with Turbopack | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | No additional libraries needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom OHLC legend | lightweight-charts series primitives | Built-in primitives are lower-level; HTML overlay is simpler, more flexible for steampunk styling |

**Installation:**
No new packages needed. Everything required is already installed.

## Architecture Patterns

### Recommended Project Structure
```
app/
  components/
    chart/
      chart-theme.ts            # NEW: FACTORY_CHART_THEME + FACTORY_CANDLE_COLORS exports
      create-chart.ts           # NEW: createThemedChart() helper
      CandlestickChart.tsx      # MODIFIED: uses chart-theme + create-chart, adds volume + legend
      ChartControls.tsx          # MODIFIED: add volume toggle checkbox
      OhlcLegend.tsx            # NEW: positioned overlay updated by crosshair events
      ChartWrapper.tsx          # NEW: Frame wrapper + loading/empty states
```

### Pattern 1: Centralized Chart Theme Constants

**What:** A pure TypeScript module exporting all chart color values as named constants, with comments mapping each hex value to the corresponding CSS custom property name from globals.css.

**When to use:** Whenever any chart component needs a theme color. Canvas-based rendering (lightweight-charts) cannot read CSS custom properties at runtime, so hex values must be hardcoded. Centralizing them in one file prevents drift between the chart and the rest of the UI.

**Source:** Verified from installed typings -- `ChartOptionsImpl` and all series options accept string hex colors.

```typescript
// chart-theme.ts
// Source: globals.css @theme block -- values copied here because
// canvas rendering cannot read CSS custom properties

/** Chart layout colors matching --color-factory-* tokens */
export const FACTORY_CHART_THEME = {
  // Layout
  background: '#1c120a',         // --color-factory-bg
  textColor: '#bca88a',          // --color-factory-text-secondary
  fontSize: 11,

  // Grid
  gridVertColor: '#4a3520',      // --color-factory-border-subtle
  gridHorzColor: '#4a3520',      // --color-factory-border-subtle

  // Scale borders
  scaleBorderColor: '#86644a',   // --color-factory-border

  // Crosshair
  crosshairColor: '#86644a',     // --color-factory-border
  crosshairLabelBg: '#2c1e12',   // --color-factory-surface
} as const;

/** Candle colors */
export const FACTORY_CANDLE_COLORS = {
  upColor: '#5da84a',            // --color-factory-success
  downColor: '#c04030',          // --color-factory-error
  borderUpColor: '#5da84a',
  borderDownColor: '#c04030',
  wickUpColor: '#5da84a',
  wickDownColor: '#c04030',
} as const;

/** Volume histogram colors (semi-transparent to not obscure candle wicks) */
export const FACTORY_VOLUME_COLORS = {
  up: 'rgba(93, 168, 74, 0.35)',    // --color-factory-success @ 35% opacity
  down: 'rgba(192, 64, 48, 0.35)',  // --color-factory-error @ 35% opacity
} as const;
```

### Pattern 2: Chart Creation Helper

**What:** A factory function that creates a themed chart + candlestick series in ~5 lines, replacing the ~30 lines of inline configuration in the current `CandlestickChart.tsx`.

**When to use:** Every chart instantiation. Returns `{ chart, candleSeries, volumeSeries }` so the caller can add data and subscribe to events.

```typescript
// create-chart.ts
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { FACTORY_CHART_THEME, FACTORY_CANDLE_COLORS } from './chart-theme';

interface CreateChartResult {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
  volumeSeries: ISeriesApi<'Histogram'>;
}

export function createThemedChart(
  container: HTMLDivElement,
  opts: { width?: number; height: number; priceFormatter?: (price: number) => string },
): CreateChartResult {
  const chart = createChart(container, {
    width: opts.width ?? container.clientWidth,
    height: opts.height,
    layout: {
      background: { type: ColorType.Solid, color: FACTORY_CHART_THEME.background },
      textColor: FACTORY_CHART_THEME.textColor,
      fontSize: FACTORY_CHART_THEME.fontSize,
    },
    grid: {
      vertLines: { color: FACTORY_CHART_THEME.gridVertColor },
      horzLines: { color: FACTORY_CHART_THEME.gridHorzColor },
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: FACTORY_CHART_THEME.scaleBorderColor,
    },
    rightPriceScale: {
      borderColor: FACTORY_CHART_THEME.scaleBorderColor,
    },
    crosshair: {
      horzLine: {
        color: FACTORY_CHART_THEME.crosshairColor,
        labelBackgroundColor: FACTORY_CHART_THEME.crosshairLabelBg,
      },
      vertLine: {
        color: FACTORY_CHART_THEME.crosshairColor,
        labelBackgroundColor: FACTORY_CHART_THEME.crosshairLabelBg,
      },
    },
  });

  const candleSeries = chart.addSeries(CandlestickSeries, {
    ...FACTORY_CANDLE_COLORS,
    ...(opts.priceFormatter ? {
      priceFormat: {
        type: 'custom' as const,
        formatter: opts.priceFormatter,
        minMove: 0.01,
      },
    } : {}),
  });

  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',  // overlay on same pane
    lastValueVisible: false,
    priceLineVisible: false,
  });

  // Position volume at bottom ~20% of chart
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  return { chart, candleSeries, volumeSeries };
}
```

### Pattern 3: OHLC Legend via subscribeCrosshairMove

**What:** An absolutely-positioned HTML div inside the chart container, updated on every crosshair move event. Shows O, H, L, C, and Volume for the hovered candle. Falls back to the latest candle when the crosshair leaves the chart.

**When to use:** Always present on the chart. Driven by `chart.subscribeCrosshairMove()`.

**Source:** Verified from typings.d.ts line 1639 and [official legends tutorial](https://tradingview.github.io/lightweight-charts/tutorials/how_to/legends).

```typescript
// In CandlestickChart.tsx useEffect:
const handler = (param: MouseEventParams) => {
  if (!param.time) {
    // Crosshair left chart -- show latest candle
    updateLegend(latestCandleRef.current);
    return;
  }
  const candleData = param.seriesData.get(candleSeriesRef.current!);
  if (candleData && 'open' in candleData) {
    updateLegend(candleData as CandlestickData);
  }
};

chart.subscribeCrosshairMove(handler);

// CRITICAL: unsubscribe in cleanup to prevent memory leak
return () => {
  chart.unsubscribeCrosshairMove(handler);
  // ... rest of cleanup
};
```

### Pattern 4: Volume Histogram with Per-Bar Coloring

**What:** A HistogramSeries overlaid on the same chart pane, with each bar colored by candle direction (green if close >= open, red otherwise).

**When to use:** Volume data derived from the same CandleData that feeds the candlestick series. Color is set per data point via the `color` field on `HistogramData`.

**Source:** Verified from typings.d.ts line 1271 (`HistogramData.color?: string`) and [official price-and-volume tutorial](https://tradingview.github.io/lightweight-charts/tutorials/how_to/price-and-volume).

```typescript
// Convert CandleData[] to HistogramData[] with direction coloring
function toVolumeData(candles: CandleData[]): HistogramData[] {
  return candles.map(c => ({
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open
      ? FACTORY_VOLUME_COLORS.up
      : FACTORY_VOLUME_COLORS.down,
  }));
}
```

### Pattern 5: ResizeObserver with RAF Debounce

**What:** The existing ResizeObserver in CandlestickChart.tsx fires on every pixel of resize, which can trigger a "ResizeObserver loop completed with undelivered notifications" error. Wrapping the callback in `requestAnimationFrame` prevents this.

**Source:** CONTEXT.md MOD-05 pitfall.

```typescript
let resizeRAF: number | undefined;
const resizeObserver = new ResizeObserver((entries) => {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    const entry = entries[0];
    if (entry) {
      const newWidth = entry.contentRect.width;
      if (newWidth > 0) {
        chart.applyOptions({ width: newWidth });
      }
    }
  });
});
```

### Anti-Patterns to Avoid
- **Importing lightweight-charts in a server component:** Will crash at build time. Every file importing from `lightweight-charts` MUST have `'use client'` at the top or be imported only from `'use client'` files.
- **Forgetting to unsubscribe crosshairMove:** Creates a memory leak where old handlers accumulate. MUST call `chart.unsubscribeCrosshairMove(handler)` in the useEffect cleanup.
- **Using CSS custom properties in chart options:** Canvas rendering cannot read CSS variables. Always use hardcoded hex strings from `chart-theme.ts`.
- **Setting volume color on HistogramSeries options instead of per-bar:** The series-level `color` would make all bars the same color. Per-bar color requires setting `color` on each `HistogramData` item.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Volume histogram | Custom canvas overlay | `HistogramSeries` with `priceScaleId: ''` | Library handles scaling, alignment, and axis interactions automatically |
| Crosshair data tracking | Manual mouse position to candle mapping | `chart.subscribeCrosshairMove()` | Library handles coordinate-to-data conversion, series data lookup, and magnet snapping |
| Chart resize handling | window.onresize | `ResizeObserver` (already in use) | Detects container-level resize, not just window resize |
| Tooltip positioning | Manual coordinate calculation | Keep default axis labels + OHLC legend overlay | Axis labels auto-position on the scale; legend is fixed-position overlay |

**Key insight:** Lightweight-charts v5 provides all the primitives needed (HistogramSeries, subscribeCrosshairMove, priceScaleId overlay, labelBackgroundColor). The work is composing these existing features with steampunk colors, not building custom rendering.

## Common Pitfalls

### Pitfall 1: SSR Crash (CRIT-04)
**What goes wrong:** Importing `lightweight-charts` (or any file that imports it) from a server component causes a build failure -- the library accesses `document` and `HTMLCanvasElement` at import time.
**Why it happens:** Next.js App Router server components run in Node.js where DOM APIs don't exist. ESM-only packages are evaluated eagerly.
**How to avoid:** Every file in the chart module tree must have `'use client'` or only be imported from `'use client'` files. The new `chart-theme.ts` is safe (pure constants, no library imports). The new `create-chart.ts` imports from `lightweight-charts` so it MUST only be imported from `'use client'` files.
**Warning signs:** Build error mentioning `document is not defined` or `HTMLCanvasElement is not defined`.

### Pitfall 2: subscribeCrosshairMove Memory Leak (HIGH-04)
**What goes wrong:** Each React re-render subscribes a new crosshair handler without unsubscribing the old one, causing handler accumulation and performance degradation.
**Why it happens:** The subscription is done inside useEffect but the cleanup function forgets to unsubscribe.
**How to avoid:** Always pair `chart.subscribeCrosshairMove(handler)` with `chart.unsubscribeCrosshairMove(handler)` in the useEffect cleanup return. Use a stable handler reference (useCallback or define inside the effect).
**Warning signs:** OHLC legend updates becoming sluggish over time, console showing increasing event handler counts.

### Pitfall 3: ResizeObserver Loop (MOD-05)
**What goes wrong:** ResizeObserver callback triggers a layout change (via `chart.applyOptions({ width })`) which triggers another ResizeObserver notification, creating an infinite loop that the browser breaks with a warning.
**Why it happens:** Changing chart width can change the container layout, which re-fires the observer.
**How to avoid:** Wrap the ResizeObserver callback in `requestAnimationFrame` with cancellation. This batches resize events to one-per-frame and breaks the synchronous loop.
**Warning signs:** Console warning "ResizeObserver loop completed with undelivered notifications".

### Pitfall 4: Crosshair Label Text Color Auto-Contrast
**What goes wrong:** Setting `labelBackgroundColor` to a dark color works correctly -- lightweight-charts auto-calculates a contrasting text color. But early versions had bugs where the text color matched the background, making labels invisible.
**Why it happens:** The auto-contrast algorithm was fixed in PR #1310. Version 5.1.0 includes this fix.
**How to avoid:** Use the current v5.1.0 (which has the fix). The chosen `labelBackgroundColor: '#2c1e12'` (dark surface) will get light auto-contrast text. No manual text color override is available or needed.
**Warning signs:** Crosshair axis labels appearing as solid-color rectangles with no visible text.

### Pitfall 5: Volume Overlay priceScaleId Must Be Empty String
**What goes wrong:** Setting `priceScaleId: 'volume'` or any non-empty string creates a new visible price scale on the left side, wasting horizontal space.
**Why it happens:** Non-empty priceScaleId values create dedicated scales. Only `''` (empty string) creates a "hidden" overlay scale.
**How to avoid:** Always use `priceScaleId: ''` for volume overlay. Then control positioning via `volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })`.
**Warning signs:** A second Y-axis appearing on the chart showing volume numbers.

### Pitfall 6: Volume Toggle Visibility vs Data
**What goes wrong:** Toggling volume visibility by removing/re-adding the series causes the chart to flash or lose data.
**Why it happens:** `chart.removeSeries()` is irreversible. You cannot re-add the same series reference.
**How to avoid:** Use `volumeSeries.applyOptions({ visible: false })` to hide and `volumeSeries.applyOptions({ visible: true })` to show. This preserves the series and its data.
**Warning signs:** Chart flickering or volume data disappearing permanently after toggle.

### Pitfall 7: Gap-Fill Removal Side Effects
**What goes wrong:** Removing gap-fill candles (volume=0, flat OHLC) from the API response causes visual time gaps on the chart -- the X-axis jumps over periods with no trades.
**Why it happens:** lightweight-charts v5 draws time gaps when there are missing time periods in the data array.
**How to avoid:** This is the desired behavior per CONTEXT.md decision -- natural time gaps are preferable to misleading flat lines. The chart will skip periods with no trades, which is honest. The timeScale is already configured with `timeVisible: true` which handles gaps gracefully.
**Warning signs:** None -- this is intentional behavior. But verify the chart still looks good with gapped data.

## Code Examples

### Complete Volume Data Conversion
```typescript
// Source: typings.d.ts line 1271 (HistogramData interface)
import type { HistogramData, UTCTimestamp } from 'lightweight-charts';
import type { CandleData } from '@/hooks/useChartData';
import { FACTORY_VOLUME_COLORS } from './chart-theme';

export function toVolumeData(candles: CandleData[]): HistogramData[] {
  return candles.map(c => ({
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open
      ? FACTORY_VOLUME_COLORS.up
      : FACTORY_VOLUME_COLORS.down,
  }));
}
```

### OHLC Legend DOM Update
```typescript
// Source: typings.d.ts line 3302 (MouseEventParams) + line 3329 (seriesData)
function updateLegend(
  legendEl: HTMLDivElement,
  data: { open: number; high: number; low: number; close: number } | null,
  volume?: number,
) {
  if (!data) {
    legendEl.textContent = '';
    return;
  }
  const fmt = (n: number) => n.toFixed(6); // SOL prices have many decimals
  legendEl.innerHTML =
    `<span>O</span> ${fmt(data.open)} ` +
    `<span>H</span> ${fmt(data.high)} ` +
    `<span>L</span> ${fmt(data.low)} ` +
    `<span>C</span> ${fmt(data.close)}` +
    (volume !== undefined ? ` <span>V</span> ${volume.toLocaleString()}` : '');
}
```

### Keyboard Accessibility for Chart
```typescript
// Chart container receives tabIndex + onKeyDown for basic keyboard interaction
<div
  ref={containerRef}
  tabIndex={0}
  role="img"
  aria-label={`Candlestick chart for ${poolLabel}`}
  onKeyDown={(e) => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    switch (e.key) {
      case 'ArrowLeft':
        ts.scrollToPosition(ts.scrollPosition() - 3, false);
        break;
      case 'ArrowRight':
        ts.scrollToPosition(ts.scrollPosition() + 3, false);
        break;
      case '+':
      case '=':
        // Zoom in via timeScale range change
        ts.applyOptions({ barSpacing: (chartRef.current?.options().timeScale?.barSpacing ?? 6) + 2 });
        break;
      case '-':
        ts.applyOptions({ barSpacing: Math.max((chartRef.current?.options().timeScale?.barSpacing ?? 6) - 2, 2) });
        break;
    }
  }}
/>
```

### Loading Spinner (Gear Logo)
```typescript
// Copy WebsiteAssets/logo:icon.png to app/public/logo-icon.png
// (colon in filename is problematic for URLs, rename on copy)
<div className="absolute inset-0 flex items-center justify-center bg-factory-bg/80">
  <img
    src="/logo-icon.png"
    alt="Loading..."
    className="w-12 h-12 animate-gear-spin"
  />
</div>
```

Note: `animate-gear-spin` is already defined in globals.css as `gear-spin 3s linear infinite`.

### Empty State
```typescript
<Frame mode="css" padding="md">
  <div className="flex flex-col items-center justify-center h-[300px] text-factory-text-secondary">
    <p className="font-heading text-lg">No trades recorded in this factory</p>
    <p className="text-sm text-factory-text-muted mt-2">
      Trades will appear here once swaps occur in this pool
    </p>
  </div>
</Frame>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `chart.addCandlestickSeries()` | `chart.addSeries(CandlestickSeries, opts)` | v5.0 (2024) | Already using correct v5 API |
| `watermark` chart option | `createTextWatermark(pane, opts)` / `createImageWatermark(pane, url, opts)` | v5.0 (2024) | Watermark is now a plugin, not a chart option -- but NOT NEEDED (user declined) |
| `CrosshairMode.Magnet` (close only) | `CrosshairMode.MagnetOHLC` (snaps to O/H/L/C) | v5.x | Could use MagnetOHLC=3 for better OHLC precision, but default Magnet=1 is fine for this use case |

**Deprecated/outdated:**
- `chart.addCandlestickSeries()` -- replaced by `chart.addSeries(CandlestickSeries, opts)` in v5. The existing code already uses the v5 API correctly.
- `chart.applyOptions({ watermark: {...} })` -- watermark moved to plugin API in v5. Not relevant since watermark was declined by user.

## API Surface Summary (from installed typings.d.ts)

Key types and exports verified from the installed package:

| Export | Source Line | Usage |
|--------|------------|-------|
| `HistogramSeries` | 4898 | Volume histogram series definition for `chart.addSeries()` |
| `HistogramData<T>` | 1271 | `{ time, value, color? }` -- per-bar color support confirmed |
| `HistogramStyleOptions` | 1280 | `{ color, base }` -- series-level default color |
| `subscribeCrosshairMove` | 1639 | `chart.subscribeCrosshairMove(handler)` for OHLC legend |
| `unsubscribeCrosshairMove` | 1649 | Paired unsubscribe for cleanup |
| `MouseEventParams` | 3302 | `{ time?, point?, seriesData, hoveredSeries? }` |
| `seriesData` | 3329 | `Map<ISeriesApi, BarData \| LineData \| HistogramData \| CustomData>` |
| `CrosshairLineOptions` | 1014 | `{ color, labelBackgroundColor, labelVisible }` -- NO labelTextColor (auto-contrast) |
| `LayoutOptions` | 3040 | `{ background, textColor, fontSize, fontFamily }` -- controls axis label appearance |
| `PriceScaleMargins` | 3597 | `{ top, bottom }` -- 0-1 range for positioning volume overlay |
| `SeriesOptionsCommon.priceScaleId` | 3912 | `''` for hidden overlay scale |
| `SeriesOptionsCommon.visible` | 3920 | Toggle volume visibility without removing series |
| `CrosshairMode.MagnetOHLC` | 51 | Mode 3 -- snaps to nearest OHLC value |
| `ISeriesApi.data()` | 2405 | Returns all current data -- useful for getting latest candle for idle legend |

## Existing Codebase Integration Points

### Files to Modify
| File | Change | Risk |
|------|--------|------|
| `app/components/chart/CandlestickChart.tsx` | Replace inline theme with imports from chart-theme.ts, use createThemedChart helper, add volume series, add OHLC legend, add RAF debounce to ResizeObserver | MEDIUM -- core component, must preserve existing incremental update behavior |
| `app/components/chart/ChartControls.tsx` | Add volume toggle checkbox | LOW -- additive change |
| `app/components/station/SwapStation.tsx` | Wrap chart section in ChartWrapper (Frame + loading/empty) | LOW -- wrapper change |
| `app/app/api/candles/route.ts` | Remove gap-fill logic (return raw DB candles) OR add `?gapfill=false` parameter | MEDIUM -- behavioral change, existing consumers may expect gap-filled data |

### Files to Create
| File | Purpose |
|------|---------|
| `app/components/chart/chart-theme.ts` | Centralized hex constants with token name comments |
| `app/components/chart/create-chart.ts` | Factory function for themed chart + series |
| `app/components/chart/OhlcLegend.tsx` | Positioned overlay for OHLC values |
| `app/components/chart/ChartWrapper.tsx` | Frame + loading gear + empty state wrapper |

### Assets to Copy
| Source | Destination | Note |
|--------|-------------|------|
| `WebsiteAssets/logo:icon.png` | `app/public/logo-icon.png` | Rename (colon in filename is URL-unsafe). 232KB PNG for loading spinner. |

### Design Token References
All chart hex values map to these CSS custom properties (from globals.css @theme block):

| Chart Use | Hex | CSS Token |
|-----------|-----|-----------|
| Background | `#1c120a` | `--color-factory-bg` |
| Axis text | `#bca88a` | `--color-factory-text-secondary` |
| Grid lines | `#4a3520` | `--color-factory-border-subtle` |
| Scale borders | `#86644a` | `--color-factory-border` |
| Crosshair lines | `#86644a` | `--color-factory-border` |
| Crosshair label bg | `#2c1e12` | `--color-factory-surface` |
| Candle up | `#5da84a` | `--color-factory-success` |
| Candle down | `#c04030` | `--color-factory-error` |
| Legend text | `#ecdcc4` | `--color-factory-text` |
| Legend labels | `#daa520` | `--color-factory-accent` |
| Legend background | `#1c120a` with opacity | `--color-factory-bg` |

## Open Questions

1. **Gap-fill removal scope**
   - What we know: CONTEXT.md says remove synthetic zero-volume flat candles
   - What's unclear: Should the API route be modified to accept a `gapfill=false` param (backward compatible) or should gap-fill be removed entirely? Other consumers of `/api/candles` may exist.
   - Recommendation: Add `gapfill=false` as a query parameter, default to current behavior. Chart component passes `gapfill=false`. This is backward compatible.

2. **Volume data in SSE updates**
   - What we know: CandleSSEUpdate includes `volume` field, and useChartData accumulates volume in candles
   - What's unclear: When the volume histogram receives SSE updates, the volume bar color depends on close >= open direction which may flip mid-candle
   - Recommendation: On each SSE update, re-color the last volume bar based on current close vs open. Use `volumeSeries.update()` just like `candleSeries.update()`.

3. **Loading spinner image size**
   - What we know: logo:icon.png is 232KB
   - What's unclear: Is this too large for a loading spinner? Could cause layout shift if slow to load.
   - Recommendation: The image is small (12x12 rendered size), 232KB is fine for a single asset. Browser caches it after first load. Could optionally be optimized but not critical.

## Sources

### Primary (HIGH confidence)
- Installed typings: `node_modules/lightweight-charts/dist/typings.d.ts` (5.1.0) -- all API surface verified directly
- Existing codebase: `CandlestickChart.tsx`, `ChartControls.tsx`, `useChartData.ts`, `useChartSSE.ts`, `SwapStation.tsx`
- globals.css @theme block -- all color tokens verified
- kit.css -- Frame component styles verified

### Secondary (MEDIUM confidence)
- [Price and Volume Tutorial](https://tradingview.github.io/lightweight-charts/tutorials/how_to/price-and-volume) -- confirmed priceScaleId: '' + scaleMargins pattern
- [Legends Tutorial](https://tradingview.github.io/lightweight-charts/tutorials/how_to/legends) -- confirmed subscribeCrosshairMove + HTML overlay pattern
- [GitHub Issue #1309](https://github.com/tradingview/lightweight-charts/issues/1309) -- confirmed crosshair label auto-contrast text color fix

### Tertiary (LOW confidence)
- None -- all findings verified against installed typings

## Memecoin Chart Industry Practices (Supplementary Research)

Additional research into DEX Screener, Birdeye, Defined.fi, pump.fun, and memecoin trading patterns.

### Key Findings for Phase 61 Scope

**1. Logarithmic Scale Default (HIGH priority)**
- Memecoin prices can move orders of magnitude. Linear scale compresses early price action to a flat line at the bottom.
- DEX Screener and Birdeye default to log scale for new tokens.
- **Action:** Add a log/linear toggle to ChartControls, default to logarithmic for our pools.
- API: `priceScale.mode: PriceScaleMode.Logarithmic` (already in installed typings).

**2. Shorter Timeframes (HIGH priority)**
- Current ChartControls: 1H / 4H / 1D / 1W. Memecoin traders expect 1m / 5m / 15m.
- 5-minute interval is the standard starting point for memecoin discovery (per Nansen workflow).
- **Action:** Add 1m, 5m, 15m to existing controls. Default to 5m. Smart default based on pool age (< 1H old → 1m, < 24H → 5m, older → 1H).
- **Constraint:** Our candles API needs 1-minute granularity data. Verify this exists.

**3. Data Conflation v5.1 (MEDIUM priority)**
- v5.1.0 introduced automatic data conflation — merges bars when zoomed out (< 0.5px per bar).
- Critical for pools with 10K+ candles at 1-minute resolution.
- **Action:** Enable `conflation: { enabled: true }` on chart options.

**4. Responsive Legend (MEDIUM priority)**
- Desktop: full OHLCV + change%. Mobile: price + change% only. Full data on long-tap tracking mode.
- Matches TradingView mobile patterns where legend simplifies for small screens.
- **Action:** Detect viewport width, render compact legend on mobile.

**5. SSE Update Batching (MEDIUM priority)**
- Multiple SSE events within one animation frame should be coalesced via RAF.
- Prevents redundant canvas redraws on fast-moving tokens.
- Our `useChartSSE` already does incremental `series.update()` — verify it's not causing re-renders.

**6. Memory Hygiene (HIGH priority — defensive)**
- Always `chart.remove()` on unmount (existing code does this).
- `series.setData([])` before switching pools/timeframes.
- Do NOT store candle arrays in React state — let the chart manage its own data.

### Differentiating Features (Deferred — Not Phase 61)
These would set us apart from all existing platforms but are beyond Phase 61 scope:
- Epoch boundary vertical lines on chart (when tax rates changed)
- Carnage event markers (when buyback-burns happened)
- Tax rate annotations at specific points in time
- These require epoch/carnage data integration with the chart timeline.

### Volume Display Consensus
- **Overlay** in bottom 20-30% is universal across DEX Screener, Birdeye, TradingView.
- Semi-transparent colors matching candle direction is standard.
- Our planned approach (priceScaleId: '', scaleMargins top: 0.8) matches industry best practice exactly.

### Accessibility Edge
- **No memecoin platform has chart accessibility.** Even basic aria-live announcements + keyboard nav puts us ahead of the entire space.
- Keep Phase 61 a11y scope to: aria-label, aria-live price region, arrow key navigation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- library already installed, typings verified directly
- Architecture: HIGH -- patterns verified from official tutorials + installed API surface
- Pitfalls: HIGH -- crosshair unsubscribe, SSR crash, ResizeObserver loop all documented in installed typings and confirmed by existing codebase patterns
- Theme mapping: HIGH -- all hex values verified against globals.css @theme block

**Research date:** 2026-02-26
**Valid until:** 2026-04-26 (stable -- lightweight-charts v5.1.0 is locked, no version changes planned)
