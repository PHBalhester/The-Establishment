"use client";

/**
 * RouteCard -- Individual route display card
 *
 * Displays a single swap route with:
 * - Path visualization (color-coded token arrows)
 * - Output amount
 * - LP fee, tax, and price impact breakdown
 * - Hop count
 * - Split annotation for split routes
 *
 * Props-only component (no hooks). Purely presentational.
 */

import type { Route, TokenSymbol } from "@/lib/swap/route-types";
import { RouteBadge } from "./RouteBadge";

// =============================================================================
// Props
// =============================================================================

interface RouteCardProps {
  /** The route to display */
  route: Route;
  /** Whether this is the best (highest output) route */
  isBest: boolean;
  /** Whether this route is currently selected */
  isSelected: boolean;
  /** Called when the user clicks this route card */
  onSelect: () => void;
  /** Decimal places for the output token (6 for tokens, 9 for SOL) */
  outputDecimals: number;
}

// =============================================================================
// Token colors
// =============================================================================

/** Color class for each token in the path visualization */
const TOKEN_COLORS: Record<string, string> = {
  SOL: "text-factory-accent",
  CRIME: "text-factory-crime",
  FRAUD: "text-factory-fraud",
  PROFIT: "text-factory-profit",
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a base-unit amount for display.
 * Divides by 10^decimals, trims trailing zeros.
 */
function formatOutput(baseUnits: number, decimals: number): string {
  const value = baseUnits / 10 ** decimals;
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";

  // Show up to 6 decimal places, trim trailing zeros
  const formatted = value.toFixed(6);
  return formatted.replace(/\.?0+$/, "");
}

/**
 * Parse route label into token segments.
 * e.g. "SOL -> CRIME -> PROFIT" => ["SOL", "CRIME", "PROFIT"]
 */
function parsePathTokens(label: string): string[] {
  return label.split("->").map((s) => s.trim());
}

/**
 * Extract the intermediary token name from a split route's sub-path.
 * For a route like "SOL -> CRIME -> PROFIT", the intermediary is "CRIME".
 * Falls back to the second token in the label, or the first step's output.
 */
function getIntermediaryFromRoute(route: Route): string {
  const tokens = parsePathTokens(route.label);
  // Intermediary is the middle token in a 3-token path
  if (tokens.length >= 3) return tokens[1];
  // For 2-token paths, no real intermediary
  if (tokens.length === 2) return tokens[0];
  return route.steps[0]?.outputToken ?? "?";
}

// =============================================================================
// Component
// =============================================================================

export function RouteCard({
  route,
  isBest,
  isSelected,
  onSelect,
  outputDecimals,
}: RouteCardProps) {
  const pathTokens = parsePathTokens(route.label);
  const outputTokenSymbol = route.outputToken;

  // Fee percentages from step-level BPS (denomination-independent).
  // For multi-hop and split routes, totalLpFee/totalTax mix token denominations,
  // so dividing by inputAmount gives wrong results. BPS are always correct.
  const totalLpBps = route.steps.reduce((sum, s) => sum + s.lpFeeBps, 0);
  const totalTaxBps = route.steps.reduce((sum, s) => sum + s.taxBps, 0);
  const lpFeePct = (totalLpBps / 100).toFixed(1);
  const taxPct = (totalTaxBps / 100).toFixed(1);

  const priceImpactPct = (route.totalPriceImpactBps / 100).toFixed(2);
  const priceImpactClass =
    route.totalPriceImpactBps > 500
      ? "text-factory-error"
      : route.totalPriceImpactBps > 100
        ? "text-factory-warning"
        : "text-factory-text-secondary";

  const hasVaultStep = route.steps.some((s) => s.pool.includes("Vault"));
  const allVault = route.steps.every((s) => s.pool.includes("Vault"));

  const hopLabel = route.hops === 1 ? "1 hop" : `${route.hops} hops`;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        // Re-set text color tokens to light-on-dark inside this dark card.
        // The kit-frame parchment override remaps these to dark ink, but
        // this card has its own dark background so we restore the originals.
        '--color-factory-text': '#ecdcc4',
        '--color-factory-text-secondary': '#bca88a',
        '--color-factory-text-muted': '#8a7a62',
      } as React.CSSProperties}
      className={
        "w-full text-left rounded-lg border p-3 transition-colors " +
        (isSelected
          ? "border-factory-accent bg-factory-surface-elevated"
          : "border-factory-border bg-factory-surface-elevated hover:bg-factory-surface")
      }
    >
      {/* Top row: badge + path visualization */}
      <div className="flex items-center gap-2 flex-wrap">
        {isBest && <RouteBadge />}
        <div className="flex items-center flex-wrap">
          {pathTokens.map((token, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && (
                <span className="text-factory-text-muted mx-1 text-sm">
                  {"\u2192"}
                </span>
              )}
              <span
                className={
                  "text-sm font-medium " +
                  (TOKEN_COLORS[token] ?? "text-factory-text-secondary")
                }
              >
                {token}
              </span>
            </span>
          ))}
        </div>
        <span className="text-xs text-factory-text-muted ml-auto">{hopLabel}</span>
      </div>

      {/* Split annotation */}
      {route.isSplit && route.splitRatio && (
        <div className="text-xs text-factory-text-muted mt-1">
          Split: {route.splitRatio[0]}% via{" "}
          {getIntermediaryFromRoute(route)},{" "}
          {route.splitRatio[1]}% via{" "}
          {/* For split routes, the second intermediary differs from the first.
              We derive it from the label which contains only one path.
              In practice, the parent RouteSelector would render two cards or
              the route engine labels split routes differently. For now, show
              both percentages with the intermediary from this route's path. */}
          {route.steps.length > 1
            ? route.steps[route.steps.length - 1].inputToken
            : "alt"}
        </div>
      )}

      {/* Middle row: output amount */}
      <div className="mt-2 text-base text-factory-text font-medium">
        {formatOutput(route.outputAmount, outputDecimals)} {outputTokenSymbol}
      </div>

      {/* Bottom row: fee breakdown */}
      <div className="mt-1.5 flex items-center gap-3 text-xs">
        {allVault ? (
          <span className="text-factory-text-secondary">Vault: no fee</span>
        ) : (
          <>
            <span className="text-factory-text-secondary">LP: {lpFeePct}%</span>
            <span className="text-factory-text-secondary">
              {totalTaxBps > 0 ? `Tax: ${taxPct}%` : "No tax"}
            </span>
            {hasVaultStep && (
              <span className="text-factory-text-secondary">Vault: no fee</span>
            )}
          </>
        )}
        <span className={priceImpactClass}>Impact: {priceImpactPct}%</span>
      </div>
    </button>
  );
}
