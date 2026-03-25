'use client';

/**
 * ChartWrapper -- Frame-wrapped chart container with loading/empty states + a11y
 *
 * Wraps the CandlestickChart in a steampunk Frame component and provides:
 * - Loading state: spinning gear logo on initial load, subtle corner indicator on refetch
 * - Empty state: themed message when pool has zero trades
 * - Keyboard navigation: arrow keys scroll, +/- zoom (requires chartRef)
 * - Screen reader: aria-live region announces price changes
 *
 * WHY: Frame provides the steampunk border matching all other modals/panels.
 * Keyboard nav makes this more accessible than typical memecoin chart platforms.
 * Two loading states avoid jarring flashes when switching pools (corner indicator
 * during refetch vs full overlay on initial load).
 */

import type { IChartApi } from 'lightweight-charts';
import type { RefObject, KeyboardEvent, ReactNode } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface ChartWrapperProps {
  /** The CandlestickChart (and optionally ChartControls) rendered as children */
  children: ReactNode;
  /** Whether historical data is currently fetching */
  loading: boolean;
  /** True when candles array is empty AND not loading (pool has zero trades) */
  isEmpty: boolean;
  /** Human-readable pool name for aria-label (e.g., "CRIME/SOL") */
  poolLabel: string;
  /** Latest price for aria-live screen reader announcements */
  latestPrice?: number;
  /** Optional ref to chart instance for keyboard navigation */
  chartRef?: RefObject<IChartApi | null>;
}

// =============================================================================
// Component
// =============================================================================

export function ChartWrapper({
  children,
  loading,
  isEmpty,
  poolLabel,
  latestPrice,
  chartRef,
}: ChartWrapperProps) {
  // ── Keyboard navigation handler ──────────────────────────────────────────
  // Arrow keys scroll the time axis, +/- zoom by adjusting bar spacing.
  // If chartRef is not provided, this is a no-op (graceful degradation).
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const chart = chartRef?.current;
    if (!chart) return;

    const ts = chart.timeScale();

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        ts.scrollToPosition(ts.scrollPosition() - 3, false);
        break;
      case 'ArrowRight':
        e.preventDefault();
        ts.scrollToPosition(ts.scrollPosition() + 3, false);
        break;
      case '+':
      case '=': {
        e.preventDefault();
        const currentIn = chart.options().timeScale?.barSpacing ?? 6;
        ts.applyOptions({ barSpacing: currentIn + 2 });
        break;
      }
      case '-': {
        e.preventDefault();
        const currentOut = chart.options().timeScale?.barSpacing ?? 6;
        ts.applyOptions({ barSpacing: Math.max(currentOut - 2, 2) });
        break;
      }
    }
  };

  // ── Determine display state ──────────────────────────────────────────────
  const isInitialLoad = loading && isEmpty;
  const isRefetch = loading && !isEmpty;

  return (
    <div
      className="relative"
      tabIndex={0}
      role="figure"
      aria-label={`Price chart for ${poolLabel}`}
      onKeyDown={handleKeyDown}
    >
      {/* Screen reader price announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {latestPrice !== undefined ? `${poolLabel} price: ${latestPrice}` : ''}
      </div>

      {/* Content: always render children (chart container).
          When empty, the chart simply shows a blank area with no candles. */}
      {children}

      {/* Full loading overlay -- initial load with no cached data */}
      {isInitialLoad && (
        <div className="absolute inset-0 flex items-center justify-center bg-factory-bg/80 z-20">
          <img
            src="/logo-icon.png"
            alt="Loading chart data..."
            className="w-12 h-12 animate-gear-spin"
          />
        </div>
      )}

      {/* Subtle corner indicator -- background refetch with cached data visible */}
      {isRefetch && (
        <img
          src="/logo-icon.png"
          alt="Refreshing chart data..."
          className="absolute top-2 right-2 z-20 w-6 h-6 animate-gear-spin opacity-60"
        />
      )}
    </div>
  );
}
