"use client";

/**
 * ChartControls -- Controls bar above the candlestick chart
 *
 * Horizontal flex bar with:
 * - Unified timeframe buttons: 1m, 5m, 15m, 1H, 4H, 1D, 1W
 *   (each sets both range + resolution for optimal candle count)
 * - Resolution picker: dropdown for fine-grained resolution override
 * - Log/linear scale toggle button (kit Button)
 * - Volume visibility toggle (kit Toggle brass switch)
 * - Connection indicator: small dot (green=connected, amber=reconnecting, red=disconnected)
 *
 * Pool selector has been moved to SwapStatsBar (Phase 62-02).
 *
 * Styling uses kit Button/Toggle components for steampunk consistency.
 * The controls bar sits inside ChartWrapper within the kit-frame parchment context,
 * which remaps --color-factory-text to dark ink. Since the controls bar has its own
 * dark bg-factory-surface background, we restore the original light text variables
 * via inline style so kit-button-secondary and other text-factory-* classes render
 * correctly against the dark background.
 */

import type { TimeRange, Resolution } from "@/hooks/useChartData";
import type { ConnectionStatus } from "@/hooks/useChartSSE";
import { Button } from "@/components/kit";
import { Toggle } from "@/components/kit";

// =============================================================================
// Types
// =============================================================================

interface ChartControlsProps {
  /** Current time range */
  range: TimeRange;
  /** Callback when time range changes (auto-selects resolution in useChartData) */
  onRangeChange: (range: TimeRange) => void;
  /** Current candle resolution */
  resolution: Resolution;
  /** Callback when resolution changes */
  onResolutionChange: (res: Resolution) => void;
  /** SSE connection status for indicator dot */
  connectionStatus: ConnectionStatus;
  /** Whether volume histogram is visible */
  showVolume: boolean;
  /** Toggle volume histogram visibility */
  onVolumeToggle: () => void;
  /** Whether price scale is logarithmic (true) or linear (false) */
  logScale: boolean;
  /** Toggle between logarithmic and linear price scale */
  onLogScaleToggle: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Unified timeframe options combining short resolutions + standard time ranges.
 *
 * Each option maps to a (range, resolution) pair. When the user clicks a
 * timeframe button, both range and resolution are set simultaneously:
 * - Short timeframes (1m, 5m, 15m): Use a fixed range that yields ~48-96 candles
 * - Standard ranges (1H, 4H, 1D, 1W): Use the auto-mapped resolution from useChartData
 *
 * WHY 5m is default: RESEARCH.md finding -- 5m is the industry standard for
 * memecoin trading. Tight enough to see momentum shifts, wide enough to filter noise.
 */
const TIMEFRAME_OPTIONS: {
  label: string;
  range: TimeRange;
  resolution: Resolution;
}[] = [
  { label: "1m", range: "1H", resolution: "1m" },    // 1H of 1m candles = 60 candles
  { label: "5m", range: "4H", resolution: "5m" },    // 4H of 5m candles = 48 candles
  { label: "15m", range: "1D", resolution: "15m" },   // 1D of 15m candles = 96 candles
  { label: "1H", range: "1D", resolution: "1h" },     // 1D of 1H candles = 24 candles
  { label: "4H", range: "1W", resolution: "4h" },     // 1W of 4H candles = 42 candles
  { label: "1D", range: "1W", resolution: "1d" },     // 1W of 1D candles = 7 candles
  { label: "1W", range: "1W", resolution: "1d" },     // 1W at 1d (same as 1D range-wise)
];

/** Resolution options for the fine-grained dropdown override. */
const RESOLUTIONS: Resolution[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** Map connection status to indicator dot colors (semantic -- factory-* tokens). */
const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: "bg-factory-success",
  reconnecting: "bg-factory-warning",
  disconnected: "bg-factory-error",
};

/** Map connection status to tooltip text. */
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Live",
  reconnecting: "Reconnecting...",
  disconnected: "Disconnected",
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine which timeframe button is "active" based on the current resolution.
 * Since resolution is the more specific value (range auto-maps), we match on it.
 * Special case: "1W" label is active only when resolution=1d AND range=1W.
 */
function isTimeframeActive(
  opt: (typeof TIMEFRAME_OPTIONS)[number],
  resolution: Resolution,
  range: TimeRange,
): boolean {
  // Handle the 1D vs 1W ambiguity (both use 1d resolution)
  if (opt.label === "1W") return resolution === "1d" && range === "1W";
  if (opt.label === "1D") return resolution === "1d" && range !== "1W";
  return resolution === opt.resolution && opt.label !== "1W" && opt.label !== "1D";
}

// =============================================================================
// Component
// =============================================================================

export function ChartControls({
  range,
  onRangeChange,
  resolution,
  onResolutionChange,
  connectionStatus,
  showVolume,
  onVolumeToggle,
  logScale,
  onLogScaleToggle,
}: ChartControlsProps) {
  /**
   * Handle timeframe button click: sets both range and resolution.
   * Calls onRangeChange first (which auto-sets resolution in useChartData),
   * then overrides resolution if the timeframe specifies a different one.
   */
  const handleTimeframeClick = (opt: (typeof TIMEFRAME_OPTIONS)[number]) => {
    onRangeChange(opt.range);
    // Override the auto-selected resolution if this timeframe wants a specific one
    // (e.g., "1H" label wants 1h resolution, but range "1D" auto-selects 15m)
    onResolutionChange(opt.resolution);
  };

  return (
    <div
      className={
        "flex flex-wrap items-center gap-2 px-3 py-2 " +
        "bg-factory-surface/50 border-b border-factory-border-subtle"
      }
      style={{
        // Restore original light text variables. The kit-frame parchment context
        // remaps these to dark ink, but this controls bar has a dark bg-factory-surface
        // background, so text must be light for readability.
        '--color-factory-text': '#ecdcc4',
        '--color-factory-text-secondary': '#bca88a',
        '--color-factory-text-muted': '#8a7a62',
      } as React.CSSProperties}
    >
      {/* ── Unified timeframe buttons (1m 5m 15m 1H 4H 1D 1W) ─────── */}
      <div className="flex items-center gap-1">
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
      </div>

      {/* ── Resolution override dropdown ───────────────────────────── */}
      <select
        value={resolution}
        onChange={(e) => onResolutionChange(e.target.value as Resolution)}
        className="kit-input"
        style={{
          // Override kit-input's full width -- inline select needs compact sizing.
          // Match kit-button-sm padding/font for visual alignment.
          width: 'auto',
          padding: '0.25rem 0.5rem',
          fontSize: 'var(--text-micro)',
        }}
      >
        {RESOLUTIONS.map((res) => (
          <option key={res} value={res}>
            {res}
          </option>
        ))}
      </select>

      {/* ── Log/linear scale toggle ────────────────────────────────── */}
      <Button
        variant={logScale ? 'primary' : 'secondary'}
        size="sm"
        onClick={onLogScaleToggle}
        aria-label={logScale ? "Switch to linear scale" : "Switch to logarithmic scale"}
        title={logScale ? "Logarithmic scale (click for linear)" : "Linear scale (click for logarithmic)"}
      >
        {logScale ? "Log" : "Lin"}
      </Button>

      {/* ── Volume visibility toggle (brass knob switch) ─────────── */}
      <Toggle
        checked={showVolume}
        onChange={() => onVolumeToggle()}
        label="Vol"
      />

      {/* ── Connection status indicator ──────────────────────────────── */}
      <div
        className="flex items-center gap-1.5"
        title={STATUS_LABELS[connectionStatus]}
      >
        <div
          className={
            "w-2.5 h-2.5 rounded-full ring-1 ring-factory-border " +
            STATUS_COLORS[connectionStatus] +
            (connectionStatus === "reconnecting" ? " animate-pulse" : "")
          }
        />
        <span className="text-xs text-factory-text-muted hidden sm:inline">
          {STATUS_LABELS[connectionStatus]}
        </span>
      </div>
    </div>
  );
}
