"use client";

/**
 * FeeBreakdown -- Expandable fee details panel
 *
 * Collapsed: shows a one-line summary (e.g. "~3.5% total fees").
 * Expanded: shows LP fee, tax, price impact, and minimum received as separate line items.
 *
 * Props-only component (no hooks). Receives quote data from SwapForm.
 */

import { useState } from "react";
import type { SwapQuote } from "@/hooks/useSwap";
import type { Route } from "@/lib/swap/route-types";
import type { TokenSymbol } from "@dr-fraudsworth/shared";
import { TOKEN_DECIMALS } from "@dr-fraudsworth/shared";

// =============================================================================
// Props
// =============================================================================

interface FeeBreakdownProps {
  /** Current price quote (null if no valid quote) */
  quote: SwapQuote | null;
  /** Input token symbol (for displaying fee units) */
  inputToken: TokenSymbol;
  /** Output token symbol (for displaying output units) */
  outputToken: TokenSymbol;
  /** Whether this pool has tax (false for vault conversion routes) */
  isTaxed: boolean;
  /** Whether a quote is currently loading */
  loading: boolean;
  /** Smart routing route (null for non-routed swaps) */
  route?: Route | null;
}

// =============================================================================
// Helpers
// =============================================================================

const SOL_DECIMALS = 9;

/**
 * Format a base unit amount for display.
 * SOL uses 9 decimals, all tokens use 6 decimals.
 */
function formatAmount(baseUnits: number, token: TokenSymbol): string {
  const decimals = token === "SOL" ? SOL_DECIMALS : TOKEN_DECIMALS;
  const value = baseUnits / 10 ** decimals;

  // Show enough precision to be meaningful
  if (value === 0) return "0";
  if (value < 0.001) return "<0.001";
  if (value < 1) return value.toFixed(decimals > 6 ? 6 : decimals);
  if (value < 100) return value.toFixed(4);
  return value.toFixed(2);
}

/**
 * Format basis points as a percentage string.
 */
function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

// =============================================================================
// Component
// =============================================================================

export function FeeBreakdown({
  quote,
  inputToken,
  outputToken,
  isTaxed,
  loading,
  route,
}: FeeBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  // Don't render anything if there's no quote
  if (!quote && !loading) return null;

  return (
    <div className="mt-2">
      {/* Collapsed: summary row -- factory-themed expandable header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg text-[#4a3a24] hover:text-[#2a1f0e] hover:bg-factory-surface/30 transition-colors"
      >
        <span>
          {loading ? (
            "Calculating fees..."
          ) : quote ? (
            <>~{quote.totalFeePct} total fees</>
          ) : (
            "No quote available"
          )}
        </span>
        <svg
          className={`w-4 h-4 text-[#6b5a3e] transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded: detailed breakdown -- factory theme tokens */}
      {expanded && quote && (
        <div className="px-3 pb-2 space-y-1.5 text-sm">
          {/* LP Fee */}
          <div className="flex justify-between text-[#6b5a3e]">
            <span>LP Fee</span>
            <span className="font-mono text-[#4a3a24]">
              {formatAmount(quote.lpFee, isTaxed ? inputToken : inputToken)}{" "}
              {inputToken}
            </span>
          </div>

          {/* Tax (hidden for PROFIT pools) */}
          {isTaxed && (
            <div className="flex justify-between text-[#6b5a3e]">
              <span>Tax</span>
              <span className="font-mono text-[#4a3a24]">
                {formatAmount(quote.taxAmount, "SOL")} SOL
              </span>
            </div>
          )}

          {/* Price Impact */}
          <div className="flex justify-between text-[#6b5a3e]">
            <span>Price Impact</span>
            <span
              className={
                "font-mono " + (
                  quote.priceImpactBps > 500
                    ? "text-factory-error"
                    : quote.priceImpactBps > 100
                      ? "text-factory-warning"
                      : "text-[#4a3a24]"
                )
              }
            >
              {bpsToPercent(quote.priceImpactBps)}
            </span>
          </div>

          {/* Per-hop breakdown for multi-hop routes */}
          {route && route.hops > 1 && (
            <div className="border-t border-factory-border-subtle pt-1.5 space-y-1">
              <span className="text-xs text-[#6b5a3e]">
                {route.isSplit ? "Split route" : "Route hops"}
              </span>
              {route.steps.map((step, i) => {
                const isVaultStep = step.pool.includes("Vault");
                return (
                  <div key={i} className="flex justify-between text-xs text-[#6b5a3e]">
                    <span>
                      {isVaultStep
                        ? `Vault (100:1): No fees`
                        : `${step.pool}: LP ${step.lpFeeBps}bps${step.taxBps > 0 ? ` / Tax ${step.taxBps}bps` : ""}`}
                    </span>
                    <span>
                      {step.inputToken} {"\u2192"} {step.outputToken}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Minimum received */}
          <div className="flex justify-between border-t border-factory-border-subtle pt-1.5 text-[#2a1f0e]">
            <span>Minimum received</span>
            <span className="font-mono">
              {formatAmount(quote.minimumOutput, outputToken)} {outputToken}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
