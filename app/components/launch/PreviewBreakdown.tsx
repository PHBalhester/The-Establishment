'use client';

/**
 * PreviewBreakdown -- Detailed trade preview with all metrics
 *
 * Shows a breakdown of the pending trade before the user confirms:
 * - Input/output amounts (SOL <-> tokens)
 * - Current and post-trade price
 * - Sell tax (15%, sell mode only)
 * - Current holdings vs 20M cap
 * - Remaining cap (buy mode only)
 *
 * All amounts arrive as bigint (lamports or base units) and are formatted
 * here for display. SOL amounts use 1e9 divisor, token amounts use 1e6.
 *
 * USD values are computed from the SOL/USD price feed (solPrice prop).
 */

import { TOKEN_DECIMAL_FACTOR } from '@/lib/curve/curve-constants';

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Format lamports to SOL string with 4-6 decimal places.
 * Uses Number conversion only for display -- precision loss is acceptable
 * for display values (sub-lamport error).
 */
function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  // Show more decimals for small amounts
  if (sol < 0.0001) return sol.toFixed(6);
  if (sol < 1) return sol.toFixed(4);
  return sol.toFixed(4);
}

/**
 * Format token base units to human-readable string with commas and 2 decimals.
 * Token decimal factor is 1e6 (6 decimals).
 */
function formatTokens(baseUnits: bigint): string {
  const human = Number(baseUnits) / Number(TOKEN_DECIMAL_FACTOR);
  return human.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a SOL lamports amount as USD.
 * Returns null if solPrice is not available.
 */
function formatUsd(lamports: bigint, solPrice: number | null): string | null {
  if (solPrice === null) return null;
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  const usd = sol * solPrice;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format price in lamports/human_token as SOL/token.
 * getCurrentPrice returns lamports per human token (not per base unit),
 * so we only divide by 1e9 to convert to SOL.
 */
function formatPrice(lamportsPerHumanToken: bigint): string {
  const sol = Number(lamportsPerHumanToken) / LAMPORTS_PER_SOL;
  if (sol < 0.000001) return sol.toExponential(2);
  return sol.toFixed(9);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PreviewBreakdownProps {
  mode: 'buy' | 'sell';
  /** SOL lamports (buy) or token base units (sell) */
  inputAmount: bigint;
  /** Token base units (buy) or SOL lamports after tax (sell) */
  outputAmount: bigint;
  /** Lamports per human token at current position */
  currentPrice: bigint;
  /** Lamports per human token after this trade */
  newPrice: bigint;
  /** SOL lamports tax (sell only) */
  taxAmount?: bigint;
  /** User's current token balance in base units */
  currentHoldings: bigint;
  /** MAX_TOKENS_PER_WALLET in base units */
  maxTokens: bigint;
  /** SOL/USD price for secondary display */
  solPrice: number | null;
}

export function PreviewBreakdown({
  mode,
  inputAmount,
  outputAmount,
  currentPrice,
  newPrice,
  taxAmount,
  currentHoldings,
  maxTokens,
  solPrice,
}: PreviewBreakdownProps) {
  const isBuy = mode === 'buy';

  // Price impact percentage
  const priceImpact =
    currentPrice > 0n
      ? ((Number(newPrice) - Number(currentPrice)) / Number(currentPrice)) * 100
      : 0;

  const remainingCap = maxTokens > currentHoldings ? maxTokens - currentHoldings : 0n;

  return (
    <div className="space-y-1.5 text-xs font-mono">
      {/* Input */}
      <Row
        label={isBuy ? 'You pay' : 'You sell'}
        value={
          isBuy
            ? `${formatSol(inputAmount)} SOL`
            : `${formatTokens(inputAmount)} tokens`
        }
        secondary={isBuy ? formatUsd(inputAmount, solPrice) : null}
      />

      {/* Output */}
      <Row
        label={isBuy ? 'You receive' : 'You get back'}
        value={
          isBuy
            ? `${formatTokens(outputAmount)} tokens`
            : `${formatSol(outputAmount)} SOL`
        }
        secondary={isBuy ? null : formatUsd(outputAmount, solPrice)}
        highlight
      />

      <Divider />

      {/* Current price */}
      <Row
        label="Current price"
        value={`${formatPrice(currentPrice)} SOL`}
        secondary={
          solPrice !== null
            ? `$${(Number(currentPrice) / LAMPORTS_PER_SOL * solPrice).toFixed(6)}`
            : null
        }
      />

      {/* Price after trade */}
      <Row
        label="Price after trade"
        value={`${formatPrice(newPrice)} SOL`}
        secondary={
          priceImpact !== 0
            ? `${priceImpact > 0 ? '+' : ''}${priceImpact.toFixed(2)}%`
            : null
        }
        secondaryClass={priceImpact > 1 ? 'text-red-600' : 'text-[#6b5a42]'}
      />

      {/* Sell tax (sell mode only) */}
      {!isBuy && taxAmount !== undefined && (
        <Row
          label="Sell tax (15%)"
          value={`-${formatSol(taxAmount)} SOL`}
          secondary={formatUsd(taxAmount, solPrice)}
          secondaryClass="text-red-600/70"
        />
      )}

      <Divider />

      {/* Holdings */}
      <Row
        label="Your holdings"
        value={`${formatTokens(currentHoldings)} / 20M cap`}
      />

      {/* Remaining cap (buy only) */}
      {isBuy && (
        <Row
          label="Remaining cap"
          value={`${formatTokens(remainingCap)} tokens`}
          secondaryClass={
            remainingCap < outputAmount ? 'text-red-400' : 'text-green-400/70'
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Row({
  label,
  value,
  secondary,
  secondaryClass,
  highlight,
}: {
  label: string;
  value: string;
  secondary?: string | null;
  secondaryClass?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[#6b5a42] shrink-0">{label}</span>
      <div className="text-right min-w-0 truncate">
        <span className={highlight ? 'text-[#2c1e12] font-semibold' : 'text-[#4a3520]'}>
          {value}
        </span>
        {secondary && (
          <span className={`block text-xs ${secondaryClass ?? 'text-[#8a7a62]'}`}>
            {secondary}
          </span>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#8a7a62]/30 my-1" />;
}
