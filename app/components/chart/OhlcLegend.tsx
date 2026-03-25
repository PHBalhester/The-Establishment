/**
 * OhlcLegend -- OHLC + Volume data overlay for the candlestick chart
 *
 * Positioned absolutely in the top-left of the chart container, this component
 * shows candle data (Open, High, Low, Close, Volume) and a change% indicator.
 *
 * Two layout modes:
 * - Desktop (compact=false): Full OHLC + V readout with labeled values
 * - Mobile (compact=true): Close price + change% only (saves space)
 *
 * The "brass gauge readout" aesthetic uses monospace font for values and
 * gold (#daa520) accent for labels, matching the factory steampunk theme.
 *
 * Prices are formatted with adaptive decimal places because SOL memecoin
 * prices can span from 0.000000001 to 100+ SOL.
 */

import { FACTORY_LEGEND_COLORS } from './chart-theme';

// =============================================================================
// Types
// =============================================================================

export interface OhlcLegendProps {
  /** OHLC data for the hovered/latest candle. Null = render nothing. */
  data: { open: number; high: number; low: number; close: number } | null;
  /** Volume for the hovered/latest candle */
  volume?: number;
  /** Previous candle's close price for calculating change% */
  prevClose?: number;
  /** Mobile layout: show only close + change% */
  compact?: boolean;
}

// =============================================================================
// Formatters
// =============================================================================

/**
 * Smart price formatter with adaptive decimal places.
 *
 * SOL memecoin prices can be extremely small (e.g., 0.000000123) or relatively
 * large (e.g., 1.5 SOL). Fixed decimal places would either truncate small
 * prices to "0.0000" or show unnecessary precision for larger prices.
 *
 * Thresholds:
 * - price > 1     -> 4 decimals  (e.g., 1.2345)
 * - price > 0.001 -> 6 decimals  (e.g., 0.012345)
 * - price <= 0.001 -> 9 decimals (e.g., 0.000000123)
 */
function formatPrice(price: number): string {
  if (price > 1) return price.toFixed(4);
  if (price > 0.001) return price.toFixed(6);
  return price.toFixed(9);
}

/**
 * Format volume with thousands separators for readability.
 * e.g., 1234567 -> "1,234,567"
 */
function formatVolume(vol: number): string {
  return vol.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Calculate and format the percentage change between previous close and current close.
 * Returns the formatted string with sign prefix (e.g., "+2.34%" or "-1.56%").
 */
function formatChange(close: number, prevClose: number): string {
  const change = ((close - prevClose) / prevClose) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

// =============================================================================
// Component
// =============================================================================

export function OhlcLegend({ data, volume, prevClose, compact }: OhlcLegendProps) {
  if (!data) return null;

  const changePositive = prevClose !== undefined ? data.close >= prevClose : undefined;
  const changeStr = prevClose !== undefined ? formatChange(data.close, prevClose) : undefined;

  // Shared inline styles for elements that reference chart-theme colors
  // (canvas-based chart colors cannot use CSS vars, so the legend matches
  // by using the same hex values from chart-theme.ts)
  const labelStyle = { color: FACTORY_LEGEND_COLORS.label };
  const valueStyle = { color: FACTORY_LEGEND_COLORS.text };

  // ── Compact layout (mobile): close price + change% only ───────────────
  if (compact) {
    return (
      <div
        className="absolute top-2 left-2 z-10 pointer-events-none rounded px-2 py-1 flex items-center gap-2"
        style={{ backgroundColor: FACTORY_LEGEND_COLORS.bg }}
      >
        <span className="font-mono text-xs" style={valueStyle}>
          {formatPrice(data.close)}
        </span>
        {changeStr !== undefined && (
          <span
            className={`font-mono text-xs font-bold ${
              changePositive ? 'text-factory-success' : 'text-factory-error'
            }`}
          >
            {changeStr}
          </span>
        )}
      </div>
    );
  }

  // ── Full layout (desktop): O, H, L, C, V + change% ───────────────────
  return (
    <div
      className="absolute top-2 left-2 z-10 pointer-events-none rounded px-2 py-1 flex flex-wrap items-center gap-x-3 gap-y-0.5"
      style={{ backgroundColor: FACTORY_LEGEND_COLORS.bg }}
    >
      <span className="text-xs">
        <span className="font-bold" style={labelStyle}>O </span>
        <span className="font-mono" style={valueStyle}>{formatPrice(data.open)}</span>
      </span>
      <span className="text-xs">
        <span className="font-bold" style={labelStyle}>H </span>
        <span className="font-mono" style={valueStyle}>{formatPrice(data.high)}</span>
      </span>
      <span className="text-xs">
        <span className="font-bold" style={labelStyle}>L </span>
        <span className="font-mono" style={valueStyle}>{formatPrice(data.low)}</span>
      </span>
      <span className="text-xs">
        <span className="font-bold" style={labelStyle}>C </span>
        <span className="font-mono" style={valueStyle}>{formatPrice(data.close)}</span>
      </span>
      {volume !== undefined && (
        <span className="text-xs">
          <span className="font-bold" style={labelStyle}>V </span>
          <span className="font-mono" style={valueStyle}>{formatVolume(volume)}</span>
        </span>
      )}
      {changeStr !== undefined && (
        <span
          className={`font-mono text-xs font-bold ${
            changePositive ? 'text-factory-success' : 'text-factory-error'
          }`}
        >
          {changeStr}
        </span>
      )}
    </div>
  );
}
