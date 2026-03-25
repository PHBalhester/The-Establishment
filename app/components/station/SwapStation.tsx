'use client';

/**
 * SwapStation -- Layout compositor for the swap modal station.
 *
 * Phase 62 refactor: useSwap() is now called HERE (lifted from SwapForm) so
 * both the left column (SwapForm) and right column (BigRedButton + swap
 * summary) can receive swap state as props from a common parent.
 *
 * Layout structure:
 * 1. SwapStatsBar: dual-panel pool selector + market caps + tax rates
 * 2. ChartWrapper (Frame + loading/empty + a11y) containing:
 *    - ChartControls: timeframes, resolution, volume/log toggles
 *    - CandlestickChart: TradingView chart with OHLC legend
 * 3. Two-column CSS Grid (.swap-station-columns):
 *    - Left:  SwapForm (presentational, receives all state as props)
 *    - Right: BigRedButton + swap summary + MultiHopStatus
 *
 * On mobile (<1024px), the grid stacks vertically: form on top, button below.
 *
 * Default export required for React.lazy in ModalContent.tsx.
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { TOKEN_DECIMALS } from '@dr-fraudsworth/shared';
import { DEVNET_POOLS } from '@/lib/protocol-config';
import { useChartData } from '@/hooks/useChartData';
import { useSwap } from '@/hooks/useSwap';
import { useTokenSupply } from '@/hooks/useTokenSupply';
import { SwapStatsBar } from './SwapStatsBar';
import { BigRedButton } from './BigRedButton';
import { MultiHopStatus } from '@/components/swap/MultiHopStatus';
import { SwapForm } from '@/components/swap/SwapForm';
import { CandlestickChart } from '@/components/chart/CandlestickChart';
import { ChartControls } from '@/components/chart/ChartControls';
import { ChartWrapper } from '@/components/chart/ChartWrapper';

// =============================================================================
// Constants
// =============================================================================

/** Default chart pool: CRIME/SOL (most actively traded) */
const DEFAULT_POOL = DEVNET_POOLS.CRIME_SOL.pool.toBase58();

/** SOL decimals for display formatting */
const SOL_DECIMALS = 9;

/** Fallback supply for PROFIT (not burned by Carnage, so static is fine) */
const PROFIT_SUPPLY = 20_000_000;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a base-unit output amount for display in the swap summary.
 * Uses the token's native decimal places, trims trailing zeros.
 */
function formatOutputAmount(baseUnits: number, token: string): string {
  if (baseUnits <= 0) return '0';
  const decimals = token === 'SOL' ? SOL_DECIMALS : TOKEN_DECIMALS;
  const value = baseUnits / 10 ** decimals;
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

/**
 * Convert basis points to a percentage string for display.
 * Example: 350 -> "3.5%"
 */
function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

// =============================================================================
// Component
// =============================================================================

export default function SwapStation() {
  // ── Chart state ─────────────────────────────────────────────────────────
  const [chartPool, setChartPool] = useState(DEFAULT_POOL);
  const {
    candles,
    loading: chartLoading,
    range,
    setRange,
    resolution,
    setResolution,
    connectionStatus,
  } = useChartData(chartPool);

  // ── Live token supply for MCAP (decreases as Carnage burns tokens) ────
  const { supply: tokenSupply } = useTokenSupply();

  // ── SOL/USD price for MCAP y-axis ──────────────────────────────────────
  const [solPrice, setSolPrice] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    const fetchPrice = () => {
      fetch('/api/sol-price')
        .then(r => r.json())
        .then(data => { if (!cancelled && typeof data.price === 'number') setSolPrice(data.price); })
        .catch(() => {});
    };
    fetchPrice();
    // Refresh every 60s to match server cache TTL
    const interval = setInterval(fetchPrice, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Volume + log scale toggles ────────────────────────────────────────
  const [showVolume, setShowVolume] = useState(true);
  const [logScale, setLogScale] = useState(true);

  // ── Chart ref for keyboard navigation in ChartWrapper ─────────────────
  const chartRef = useRef<IChartApi | null>(null);

  // ── Pool label for aria-label and screen reader announcements ─────────
  const poolLabel = chartPool === DEVNET_POOLS.CRIME_SOL.pool.toBase58()
    ? 'CRIME/SOL'
    : 'FRAUD/SOL';

  // ── Latest price for aria-live announcement ───────────────────────────
  const latestPrice = candles.length > 0 ? candles[candles.length - 1].close : undefined;

  // ── MCAP formatter for chart y-axis ──────────────────────────────────
  // Candle prices are lamports/token_base_unit (ratio of base units).
  // SOL per human token = candle_price × 10^TOKEN_DECIMALS / 10^SOL_DECIMALS
  // MCAP = SOL_per_token × TOTAL_SUPPLY × SOL/USD
  // Simplified: candle_price × (TOTAL_SUPPLY / 10^(SOL_DECIMALS - TOKEN_DECIMALS)) × SOL/USD
  const tokenName = poolLabel.split('/')[0]; // "CRIME" or "FRAUD"
  const supply = tokenName === 'PROFIT' ? PROFIT_SUPPLY : (tokenSupply[tokenName] ?? 1_000_000_000);
  const effectiveMultiplier = supply / (10 ** (SOL_DECIMALS - TOKEN_DECIMALS)); // supply / 1e3

  const mcapFormatter = useCallback(
    (priceInSol: number): string => {
      if (!solPrice) return priceInSol.toFixed(8);
      const mcap = priceInSol * effectiveMultiplier * solPrice;
      if (mcap >= 1_000_000_000) return `$${(mcap / 1_000_000_000).toFixed(2)}B`;
      if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
      if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
      return `$${mcap.toFixed(0)}`;
    },
    [solPrice, effectiveMultiplier],
  );

  // ══════════════════════════════════════════════════════════════════════
  // Swap state (lifted from SwapForm -- Phase 62 Strategy B)
  // ══════════════════════════════════════════════════════════════════════
  const swap = useSwap();

  // Whether the form is in a transacting state
  const isTransacting = swap.status !== 'idle' && swap.status !== 'confirmed' && swap.status !== 'failed';

  // Whether a multi-hop route is selected and active
  const isMultiHopRoute = swap.smartRouting && swap.selectedRoute && swap.selectedRoute.hops > 1;

  // Whether swap button should be disabled
  const swapDisabled =
    isTransacting ||
    (!swap.quote && !(swap.smartRouting && swap.selectedRoute)) ||
    !swap.inputAmount ||
    parseFloat(swap.inputAmount) <= 0;

  // Extract intermediate token from error for partial failure display
  const intermediateToken = useMemo(() => {
    if (!swap.errorMessage) return undefined;
    const match = swap.errorMessage.match(/You now hold (\w+)/);
    return match ? match[1] : undefined;
  }, [swap.errorMessage]);

  // Price impact severity class
  const impactClass = useMemo(() => {
    if (!swap.quote) return 'text-factory-text font-mono';
    const bps = swap.quote.priceImpactBps;
    if (bps > 500) return 'text-factory-error font-mono';
    if (bps > 100) return 'text-factory-warning font-mono';
    return 'text-factory-text font-mono';
  }, [swap.quote]);

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {/* ================================================================ */}
      {/* Stats bar: token prices + tax rates */}
      {/* ================================================================ */}
      <SwapStatsBar activePool={chartPool} onPoolChange={setChartPool} />

      {/* ================================================================ */}
      {/* Chart: Hidden on mobile, shown on desktop (lg+) */}
      {/* ================================================================ */}
      <div className="hidden lg:block">
        <ChartWrapper
          loading={chartLoading}
          isEmpty={candles.length === 0 && !chartLoading}
          poolLabel={poolLabel}
          latestPrice={latestPrice}
          chartRef={chartRef}
        >
          <ChartControls
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
          <CandlestickChart
            candles={candles}
            loading={chartLoading}
            height={300}
            showVolume={showVolume}
            logScale={logScale}
            poolLabel={poolLabel}
            priceFormatter={solPrice ? mcapFormatter : undefined}
            onChartReady={(chart) => { chartRef.current = chart; }}
          />
        </ChartWrapper>
      </div>

      {/* ================================================================ */}
      {/* Two-column below-chart area (CSS Grid) */}
      {/* Desktop: swap form left, action area right */}
      {/* Mobile (<1024px): stacks vertically, form on top */}
      {/* ================================================================ */}
      <div className="swap-station-columns">
        {/* ── Left column: Swap form ─────────────────────────────────── */}
        <SwapForm
          className="w-full"
          inputToken={swap.inputToken}
          outputToken={swap.outputToken}
          inputAmount={swap.inputAmount}
          outputAmount={swap.outputAmount}
          setInputToken={swap.setInputToken}
          setOutputToken={swap.setOutputToken}
          setInputAmount={swap.setInputAmount}
          setOutputAmount={swap.setOutputAmount}
          flipTokens={swap.flipTokens}
          quote={swap.quote}
          quoteLoading={swap.quoteLoading}
          smartRouting={swap.smartRouting}
          setSmartRouting={swap.setSmartRouting}
          routes={swap.routes}
          selectedRoute={swap.selectedRoute}
          selectRoute={swap.selectRoute}
          routesLoading={swap.routesLoading}
          refreshCountdown={swap.refreshCountdown}
          status={swap.status}
          txSignature={swap.txSignature}
          errorMessage={swap.errorMessage}
          resetForm={swap.resetForm}
          executeRoute={swap.executeRoute}
          connected={swap.connected}
          balances={swap.balances}
        />

        {/* ── Right column: Big Red Button + swap summary ────────────── */}
        <div className="flex flex-col items-center gap-3">
          {/* BigRedButton always renders -- never unmounted during
              transaction lifecycle. Shows a pulsing glow when transacting. */}
          <BigRedButton
            status={swap.status}
            txSignature={swap.txSignature}
            errorMessage={swap.errorMessage}
            onSwap={swap.smartRouting ? swap.executeRoute : swap.executeSwap}
            onReset={swap.resetForm}
            disabled={swapDisabled}
            connected={swap.connected}
          />

          {/* Multi-hop partial failure: show retry/keep UI below the button */}
          {isMultiHopRoute && swap.status === 'failed' && intermediateToken && (
            <MultiHopStatus
              status={swap.status}
              route={swap.selectedRoute}
              errorMessage={swap.errorMessage}
              intermediateToken={intermediateToken}
              onRetry={() => {
                swap.resetForm();
                setTimeout(() => swap.executeRoute(), 0);
              }}
              onKeep={swap.resetForm}
            />
          )}

          {/* Swap summary: estimated output, fees, price impact
              mt-5 aligns with the RouteSelector box in the left column
              (accounts for Smart Routing toggle height) */}
          {swap.quote && (
            <div className="w-full space-y-1 text-sm mt-2">
              <div className="flex justify-between">
                <span className="text-factory-text-muted">Est. output</span>
                <span className="text-factory-text font-mono">
                  {formatOutputAmount(swap.quote.outputAmount, swap.outputToken)} {swap.outputToken}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-factory-text-muted">Total fees</span>
                <span className="text-factory-text-secondary font-mono">
                  {swap.quote.totalFeePct}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-factory-text-muted">Price impact</span>
                <span className={impactClass}>
                  {bpsToPercent(swap.quote.priceImpactBps)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-factory-text-muted">Min. received</span>
                <span className="text-factory-text-secondary font-mono">
                  {formatOutputAmount(swap.quote.minimumOutput, swap.outputToken)} {swap.outputToken}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
