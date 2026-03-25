'use client';

/**
 * SwapStatsBar -- Interactive dual-panel pool selector and stats display.
 *
 * Two side-by-side faction panels (CRIME left, FRAUD right) that serve as
 * the sole pool selector for the chart. Each panel shows:
 *   - Faction name
 *   - USD market cap (computed from pool reserves * SOL/USD)
 *   - Buy and sell tax rates from the current epoch
 *
 * Active panel has factory-glow treatment (ring glow + brighter background).
 * Inactive panel is muted/dimmed with hover brightening.
 *
 * Uses kit-panel-riveted class for riveted brass background on each panel.
 *
 * Replaces the pool dropdown in ChartControls as the sole pool selector.
 */

import { useMemo } from 'react';
import { DEVNET_POOLS } from '@/lib/protocol-config';
import { usePoolPrices } from '@/hooks/usePoolPrices';
import { useSolPrice } from '@/hooks/useSolPrice';
import { useEpochState } from '@/hooks/useEpochState';
import { useTokenSupply } from '@/hooks/useTokenSupply';

// =============================================================================
// Types
// =============================================================================

interface SwapStatsBarProps {
  /** Current chart pool address (base58 string) */
  activePool: string;
  /** Callback when user clicks a faction panel to switch the chart pool */
  onPoolChange: (pool: string) => void;
}

// =============================================================================
// Constants
// =============================================================================

/** WSOL mint address for identifying SOL side in pools */
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Pool addresses as base58 strings for comparison */
const CRIME_SOL_ADDRESS = DEVNET_POOLS.CRIME_SOL.pool.toBase58();
const FRAUD_SOL_ADDRESS = DEVNET_POOLS.FRAUD_SOL.pool.toBase58();

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a USD market cap for compact display.
 * Uses $1.2B / $1.2M / $310K / $1,234 notation.
 */
function formatMcap(mcap: number): string {
  if (mcap >= 1_000_000_000) return `$${(mcap / 1_000_000_000).toFixed(2)}B`;
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
  return `$${mcap.toFixed(0)}`;
}

/** Convert basis points to a percentage string (e.g., 350 -> "3.5%") */
function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

// =============================================================================
// FactionPanel sub-component
// =============================================================================

interface FactionPanelProps {
  /** Faction name: "CRIME" or "FRAUD" */
  faction: string;
  /** Whether this panel is currently active (chart showing this pool) */
  isActive: boolean;
  /** USD market cap, or null if still loading */
  mcap: number | null;
  /** Buy tax in basis points */
  buyBps: number;
  /** Sell tax in basis points */
  sellBps: number;
  /** Whether data is still loading */
  loading: boolean;
  /** Click handler to select this pool */
  onClick: () => void;
}

/**
 * A single faction panel within the stats bar.
 *
 * Renders as a <button> for keyboard accessibility (Tab + Enter to activate).
 * Active state: ring glow + full opacity.
 * Inactive state: dimmed with hover brightening.
 * Background: kit-panel-riveted for riveted brass appearance.
 */
function FactionPanel({
  faction,
  isActive,
  mcap,
  buyBps,
  sellBps,
  loading,
  onClick,
}: FactionPanelProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`Show ${faction} chart`}
      style={{
        '--color-factory-text': '#ecdcc4',
        '--color-factory-text-secondary': '#bca88a',
        '--color-factory-text-muted': '#8a7a62',
      } as React.CSSProperties}
      className={
        'flex-1 px-4 py-3 text-left transition-all cursor-pointer rounded-xl ' +
        'border-3 border-[#8b6914] bg-factory-surface ' +
        (isActive
          ? 'border-factory-glow shadow-[0_0_12px_rgba(240,192,80,0.3)]'
          : 'opacity-70 hover:opacity-90')
      }
    >
      {/* Line 1: Faction name */}
      <div className="font-heading text-sm font-semibold text-factory-text">
        {faction}
      </div>

      {/* Line 2: Market cap */}
      {loading || mcap === null ? (
        <div className="h-4 w-20 bg-factory-surface-elevated rounded animate-pulse mt-1" />
      ) : (
        <div className="font-mono text-xs text-factory-text-secondary mt-1">
          {formatMcap(mcap)}
        </div>
      )}

      {/* Line 3: Buy / Sell tax rates */}
      {loading ? (
        <div className="h-3.5 w-28 bg-factory-surface-elevated rounded animate-pulse mt-1" />
      ) : (
        <div className="text-xs text-factory-text-muted mt-1">
          Buy {bpsToPercent(buyBps)} / Sell {bpsToPercent(sellBps)}
        </div>
      )}
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function SwapStatsBar({ activePool, onPoolChange }: SwapStatsBarProps) {
  const { pools, loading: poolsLoading } = usePoolPrices();
  const { solPrice, loading: solLoading } = useSolPrice();
  const { epochState, loading: epochLoading } = useEpochState();
  const { supply } = useTokenSupply();

  const isLoading = poolsLoading || solLoading;

  // Compute USD market caps from pool reserves.
  // mcap = pricePerToken * TOTAL_SUPPLY
  // where pricePerToken = (SOL_reserves / token_reserves) * SOL/USD
  const mcaps = useMemo(() => {
    const result: Record<string, number | null> = {
      CRIME: null,
      FRAUD: null,
    };

    if (!solPrice) return result;

    // SOL pools: derive token price directly from reserves
    // On-chain: WSOL (0x06) always sorts first -> mintA = WSOL, but we check anyway
    for (const [key, label] of [
      ['CRIME', 'CRIME/SOL'],
      ['FRAUD', 'FRAUD/SOL'],
    ] as const) {
      const pool = pools[label];
      if (!pool || pool.loading) continue;
      const aIsSOL = pool.mintA === WSOL_MINT;
      const solRes = (aIsSOL ? pool.reserveA : pool.reserveB) / 1e9;
      const tokRes = (aIsSOL ? pool.reserveB : pool.reserveA) / 1e6;
      if (tokRes > 0) {
        const price = (solRes / tokRes) * solPrice;
        result[key] = price * (supply[key] ?? 1_000_000_000);
      }
    }

    return result;
  }, [pools, solPrice, supply]);

  return (
    <div className="flex gap-3">
      <FactionPanel
        faction="CRIME"
        isActive={activePool === CRIME_SOL_ADDRESS}
        mcap={mcaps.CRIME}
        buyBps={epochState?.crimeBuyTaxBps ?? 0}
        sellBps={epochState?.crimeSellTaxBps ?? 0}
        loading={isLoading || epochLoading}
        onClick={() => onPoolChange(CRIME_SOL_ADDRESS)}
      />
      <FactionPanel
        faction="FRAUD"
        isActive={activePool === FRAUD_SOL_ADDRESS}
        mcap={mcaps.FRAUD}
        buyBps={epochState?.fraudBuyTaxBps ?? 0}
        sellBps={epochState?.fraudSellTaxBps ?? 0}
        loading={isLoading || epochLoading}
        onClick={() => onPoolChange(FRAUD_SOL_ADDRESS)}
      />
    </div>
  );
}
