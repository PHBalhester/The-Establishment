'use client';

/**
 * CurveStats -- Real-time bonding curve statistics display.
 *
 * Displays per-curve metrics:
 * - SOL Raised: X.XX SOL / 1,000 SOL target
 * - Market Cap: USD value = (solRaised / 1e9) * solPrice
 * - Current Price: Spot price at current tokensSold position (SOL + USD)
 * - Tax Escrow: Accumulated 15% sell tax in SOL
 *
 * Two-column layout on desktop (CRIME left, FRAUD right), stacked on mobile.
 * Uses steampunk brass aesthetic: warm amber colors, monospace numbers.
 */

import type { CurveStateData } from '@/hooks/useCurveState';
import { getCurrentPrice } from '@/lib/curve/curve-math';
import { TARGET_SOL } from '@/lib/curve/curve-constants';

interface CurveStatsProps {
  /** CRIME curve state (null until loaded) */
  crime: CurveStateData | null;
  /** FRAUD curve state (null until loaded) */
  fraud: CurveStateData | null;
  /** SOL/USD price (null until loaded) */
  solPrice: number | null;
  /** Optional positioning/styling classes */
  className?: string;
}

/** Format lamports to SOL string with specified decimal places */
function formatSol(lamports: bigint, decimals = 2): string {
  return (Number(lamports) / 1e9).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format USD value */
function formatUsd(value: number): string {
  if (value < 0.01) return '$0.00';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Single stat row */
function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2 py-1">
      <span className="text-amber-400/60 text-[10px] sm:text-xs uppercase tracking-wide shrink-0">
        {label}
      </span>
      <div className="text-right">
        <span className="text-amber-100 text-xs sm:text-sm font-mono tabular-nums">
          {value}
        </span>
        {sub && (
          <span className="text-amber-400/50 text-[10px] ml-1 font-mono">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

/** Stats panel for a single curve */
function CurvePanel({ data, label, solPrice }: {
  data: CurveStateData | null;
  label: string;
  solPrice: number | null;
}) {
  if (!data) {
    return (
      <div className="space-y-1 opacity-50">
        <h3 className="text-amber-300 text-xs font-bold uppercase tracking-widest mb-2 text-center">
          {label}
        </h3>
        <p className="text-amber-400/40 text-xs font-mono text-center">
          Loading...
        </p>
      </div>
    );
  }

  // Net SOL in vault = gross raised minus SOL returned via sells
  const netSol = data.solRaised - data.solReturned;
  const netSolNum = Number(netSol) / 1e9;
  const marketCap = netSolNum * (solPrice ?? 0);

  // Current spot price: lamports per human token -> SOL per token
  // getCurrentPrice returns lamports/human_token, divide by 1e9 to get SOL/token
  const spotPriceLamports = getCurrentPrice(data.tokensSold);
  const spotPriceSol = Number(spotPriceLamports) / 1e9;
  const spotPriceUsd = spotPriceSol * (solPrice ?? 0);

  return (
    <div className="space-y-0.5">
      <h3 className="text-amber-300 text-xs font-bold uppercase tracking-widest mb-1 text-center">
        {label}
      </h3>
      <StatRow
        label="Raised"
        value={`${formatSol(netSol)} SOL`}
        sub={`/ ${formatSol(TARGET_SOL)}`}
      />
      <StatRow
        label="Mkt Cap"
        value={formatUsd(marketCap)}
      />
      <StatRow
        label="Price"
        value={`${spotPriceSol.toFixed(7)} SOL`}
        sub={solPrice ? formatUsd(spotPriceUsd) : ''}
      />
      <StatRow
        label="Tax Escrow"
        value={`${formatSol(data.taxCollected)} SOL`}
      />
    </div>
  );
}

export function CurveStats({ crime, fraud, solPrice, className }: CurveStatsProps) {
  return (
    <div className={`${className ?? ''}`}>
      <div className="h-full flex flex-col justify-center">
        <div className="bg-black/40 backdrop-blur-sm rounded-lg border border-amber-900/30 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-4 divide-x divide-amber-800/30">
            <CurvePanel data={crime} label="CRIME" solPrice={solPrice} />
            <div className="pl-4">
              <CurvePanel data={fraud} label="FRAUD" solPrice={solPrice} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
