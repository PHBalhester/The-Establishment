/**
 * Chart Creation Helper -- Factory function for themed lightweight-charts
 *
 * Creates a fully themed chart with candlestick + volume series in a single call.
 * Callers get back { chart, candleSeries, volumeSeries } and can immediately
 * set data and subscribe to events.
 *
 * This file imports from lightweight-charts (DOM-dependent). It MUST only be
 * imported from 'use client' files. It does NOT have 'use client' itself because
 * it doesn't render JSX -- it relies on being imported from client components.
 *
 * WHY this exists: The old CandlestickChart.tsx had ~30 lines of inline chart
 * configuration with hardcoded hex values. This helper reduces chart creation
 * to ~5 lines of caller code and ensures consistent theming across all charts.
 */

import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type HistogramData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { CandleData } from '@/hooks/useChartData';
import { FACTORY_CHART_THEME, FACTORY_CANDLE_COLORS, FACTORY_VOLUME_COLORS } from './chart-theme';

// =============================================================================
// Types
// =============================================================================

/** Options for createThemedChart */
export interface CreateChartOptions {
  /** Chart width in pixels. Omit for responsive (fills container). */
  width?: number;
  /** Chart height in pixels. */
  height: number;
  /** Custom price formatter for Y-axis labels (e.g., SOL price formatting). */
  priceFormatter?: (price: number) => string;
  /** Use logarithmic price scale. Default: false. */
  logScale?: boolean;
}

/** Return value from createThemedChart */
export interface CreateChartResult {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
  volumeSeries: ISeriesApi<'Histogram'>;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a fully themed chart with candlestick and volume series.
 *
 * The chart is configured with:
 * - Factory steampunk theme (dark background, warm text, subtle grid)
 * - Styled crosshair with themed axis labels
 * - Green/red candlestick colors matching factory-success/error tokens
 * - Volume histogram overlaid at bottom 20% of chart area
 * - Optional logarithmic price scale for memecoin-scale price ranges
 * - Optional custom price formatter for the Y-axis
 *
 * @param container - The HTMLDivElement to render the chart into
 * @param opts - Chart configuration options
 * @returns { chart, candleSeries, volumeSeries } for data binding and event subscription
 */
export function createThemedChart(
  container: HTMLDivElement,
  opts: CreateChartOptions,
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
      // Logarithmic scale is essential for memecoin pools where prices can
      // move orders of magnitude -- linear scale compresses early action to
      // a flat line at the bottom.
      ...(opts.logScale ? { mode: PriceScaleMode.Logarithmic } : {}),
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
    handleScroll: {
      pressedMouseMove: true,
    },
    kineticScroll: {
      touch: true,
    },
  });

  // ── Candlestick series ──────────────────────────────────────────────────
  const candleSeries = chart.addSeries(CandlestickSeries, {
    ...FACTORY_CANDLE_COLORS,
    // Apply custom price formatter if provided (e.g., SOL price with many decimals)
    ...(opts.priceFormatter ? {
      priceFormat: {
        type: 'custom' as const,
        formatter: opts.priceFormatter,
        minMove: 0.000000001,
      },
    } : {}),
  });

  // ── Volume histogram series ─────────────────────────────────────────────
  // Overlaid on same pane using empty priceScaleId ('') which creates a
  // hidden overlay scale. This avoids a second Y-axis appearing on the chart.
  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',           // hidden overlay scale
    lastValueVisible: false,    // no "last value" label on price axis
    priceLineVisible: false,    // no horizontal price line
  });

  // Position volume at bottom 20% of chart area. The scaleMargins top:0.8
  // means the volume series only uses the bottom 20% of the pane height,
  // keeping candles prominent and volume subtle.
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  return { chart, candleSeries, volumeSeries };
}

// =============================================================================
// Volume Data Conversion
// =============================================================================

/**
 * Convert CandleData[] to HistogramData[] with per-bar direction coloring.
 *
 * Each volume bar is colored based on whether the candle closed up (green)
 * or down (red) relative to its open. Colors are semi-transparent (35% opacity)
 * so candle wicks remain visible through the volume bars.
 *
 * @param candles - Array of OHLCV candle data
 * @returns Array of HistogramData with per-bar color for the volume series
 */
export function toVolumeData(candles: CandleData[]): HistogramData[] {
  return candles.map(c => ({
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open
      ? FACTORY_VOLUME_COLORS.up
      : FACTORY_VOLUME_COLORS.down,
  }));
}
