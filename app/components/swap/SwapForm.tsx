"use client";

/**
 * SwapForm -- Presentational swap form container (Uniswap/Jupiter style).
 *
 * Phase 62 refactor: useSwap() has been lifted to SwapStation (the parent
 * compositor). SwapForm now receives ALL swap state and callbacks as props.
 * This enables the two-column grid layout where SwapForm lives in the left
 * column and BigRedButton lives in the right column -- both as siblings
 * of the grid container, both receiving state from SwapStation.
 *
 * SwapForm has exactly ONE consumer (SwapStation.tsx via React.lazy), so
 * the refactor scope is tightly bounded.
 *
 * Structure:
 * - Pool indicator / route label
 * - Input section (amount + TokenSelector + balance)
 * - Flip arrow button
 * - Output section (amount + TokenSelector + balance)
 * - Smart Routing toggle
 * - RouteSelector (when smart routing ON + routes exist)
 * - FeeBreakdown (expandable)
 * - "Swap settings" quick-link (replaces inline SlippageConfig)
 *
 * SlippageConfig has been REMOVED from the render output. The slippage/
 * priority state still lives in useSwap() with sensible defaults (1% / medium).
 * Phase 65 will add these controls to the Settings modal.
 *
 * MultiHopStatus and BigRedButton have been REMOVED from this component --
 * they now render in SwapStation's right grid column.
 */

import { useMemo, useEffect, useRef } from "react";
import type { SwapStatus as SwapStatusType, SwapQuote } from "@/hooks/useSwap";
import type { PriorityFeePreset } from "@/providers/SettingsProvider";
import { VALID_PAIRS, type TokenSymbol } from "@dr-fraudsworth/shared";
import { resolvePool } from "@/lib/protocol-config";
import { useToast } from "@/components/toast/ToastProvider";
import { useModal } from "@/hooks/useModal";
import { useSettings } from "@/hooks/useSettings";
import { solscanTxUrl } from "@/lib/solscan";
import type { Route } from "@/lib/swap/route-types";

import { Input, Toggle, Button } from "@/components/kit";

import { TokenSelector } from "./TokenSelector";
import { FeeBreakdown } from "./FeeBreakdown";
import { RouteSelector } from "./RouteSelector";

// =============================================================================
// Helpers
// =============================================================================

/** Get the balance for a specific token from the balances object */
function getBalance(
  balances: { sol: number; crime: number; fraud: number; profit: number },
  token: TokenSymbol,
): number {
  switch (token) {
    case "SOL":
      return balances.sol;
    case "CRIME":
      return balances.crime;
    case "FRAUD":
      return balances.fraud;
    case "PROFIT":
      return balances.profit;
  }
}

/** Format a balance for display (max 6 decimal places, trim trailing zeros) */
function formatBalance(value: number): string {
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * Validate decimal input: allow digits, single decimal point,
 * and limit decimal places based on token type.
 */
function isValidDecimalInput(value: string, maxDecimals: number): boolean {
  if (value === "") return true;
  // Allow digits and single decimal point
  if (!/^\d*\.?\d*$/.test(value)) return false;
  // Check decimal places
  const parts = value.split(".");
  if (parts.length === 2 && parts[1].length > maxDecimals) return false;
  return true;
}

/**
 * Compute the SOL reserve for "Max" based on the user's priority fee preset.
 *
 * Reserve = priority fee cost + buffer for base fee + ATA rent.
 * Uses worst-case 450k CU (200k buy + 250k sell in a multi-hop).
 * Buffer of 0.007 SOL covers base TX fee + up to 2 ATA creations.
 */
const PRIORITY_MICRO_LAMPORTS: Record<PriorityFeePreset, number> = {
  none: 0,
  low: 1_000,
  medium: 10_000,
  high: 100_000,
  turbo: 1_000_000,
};
const MAX_COMPUTE_UNITS = 450_000;
const BASE_FEE_BUFFER_SOL = 0.007;

function getSolFeeReserve(preset: PriorityFeePreset): number {
  const priorityCostLamports = PRIORITY_MICRO_LAMPORTS[preset] * MAX_COMPUTE_UNITS / 1_000_000;
  const priorityCostSol = priorityCostLamports / 1e9;
  return priorityCostSol + BASE_FEE_BUFFER_SOL;
}

// =============================================================================
// Props
// =============================================================================

export interface SwapFormProps {
  // -- Form state --
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  inputAmount: string;
  outputAmount: string;
  setInputToken: (token: TokenSymbol) => void;
  setOutputToken: (token: TokenSymbol) => void;
  setInputAmount: (amount: string) => void;
  setOutputAmount: (amount: string) => void;
  flipTokens: () => void;

  // -- Quote data --
  quote: SwapQuote | null;
  quoteLoading: boolean;

  // -- Smart routing --
  smartRouting: boolean;
  setSmartRouting: (enabled: boolean) => void;
  routes: Route[];
  selectedRoute: Route | null;
  selectRoute: (route: Route) => void;
  routesLoading: boolean;
  refreshCountdown: number;

  // -- Execution state (for toast notifications + transacting guard) --
  status: SwapStatusType;
  txSignature: string | null;
  errorMessage: string | null;
  resetForm: () => void;
  executeRoute: () => Promise<void>;

  // -- Wallet --
  connected: boolean;

  // -- Balances --
  balances: { sol: number; crime: number; fraud: number; profit: number };

  // -- Layout --
  /** Optional className override for the outer container */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function SwapForm({
  inputToken,
  outputToken,
  inputAmount,
  outputAmount,
  setInputToken,
  setOutputToken,
  setInputAmount,
  setOutputAmount,
  flipTokens,
  quote,
  quoteLoading,
  smartRouting,
  setSmartRouting,
  routes,
  selectedRoute,
  selectRoute,
  routesLoading,
  refreshCountdown,
  status,
  txSignature,
  errorMessage,
  resetForm,
  executeRoute,
  connected,
  balances,
  className,
}: SwapFormProps) {
  const { openModal } = useModal();

  // Resolve the current pool config for display
  const poolConfig = useMemo(
    () => resolvePool(inputToken, outputToken),
    [inputToken, outputToken],
  );

  // Valid tokens for each selector
  const validInputTokens = useMemo(() => {
    // All tokens that can output to the current output token
    return (Object.entries(VALID_PAIRS) as [TokenSymbol, TokenSymbol[]][])
      .filter(([, outputs]) => outputs.includes(outputToken))
      .map(([input]) => input);
  }, [outputToken]);

  const validOutputTokens = useMemo(
    () => VALID_PAIRS[inputToken],
    [inputToken],
  );

  // Whether the form is in a transacting state
  const isTransacting = status !== "idle" && status !== "confirmed" && status !== "failed";

  // Whether a multi-hop route is selected and active
  const isMultiHopRoute = smartRouting && selectedRoute && selectedRoute.hops > 1;

  // Whether the selected route is vault-only (all steps are vault conversions)
  const isVaultOnly = smartRouting
    && selectedRoute != null
    && selectedRoute.steps.every((s) => s.pool.includes("Vault"));

  // Max decimals for input validation
  const inputDecimals = inputToken === "SOL" ? 9 : 6;
  const outputDecimals = outputToken === "SOL" ? 9 : 6;

  // Priority fee preset (for dynamic Max reserve)
  const { settings } = useSettings();

  // Input balance
  const inputBalance = getBalance(balances, inputToken);
  const outputBalance = getBalance(balances, outputToken);

  // Is this a taxed pool? (for non-routed display)
  // Vault-only routes have no tax regardless of pool config
  const isTaxed = isVaultOnly ? false : (poolConfig?.isTaxed ?? true);

  // No direct pool available (for Smart Routing OFF message)
  const noDirectPool = !poolConfig;

  // ── Toast notifications: fire on status transitions ─────────────────
  // Covers ALL swap paths (direct + multi-hop) since SwapForm renders
  // for every swap. BigRedButton handles CSS animations separately.
  const { showToast } = useToast();
  const prevStatusRef = useRef<SwapStatusType>(status);

  // Extract intermediate token from error for partial failure display
  const intermediateToken = useMemo(() => {
    if (!errorMessage) return undefined;
    const match = errorMessage.match(/You now hold (\w+)/);
    return match ? match[1] : undefined;
  }, [errorMessage]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    // Only fire toast when status CHANGES to confirmed/failed
    if (prev === status) return;

    if (status === "confirmed") {
      const message = isMultiHopRoute ? "Route completed!" : "Swap confirmed!";
      showToast(
        "success",
        message,
        txSignature
          ? { label: "View on Solscan", href: solscanTxUrl(txSignature) }
          : undefined,
      );
      // Auto-reset for multi-hop (no inline UI). Direct swap: BigRedButton handles reset.
      if (isMultiHopRoute) resetForm();
    } else if (status === "failed") {
      // Multi-hop partial failure: mention the intermediate token
      const message =
        intermediateToken
          ? `Hop 2 failed \u2014 you now hold ${intermediateToken}`
          : errorMessage || "Swap failed";
      showToast("error", message);
      // Auto-reset for multi-hop plain failure. Partial failure: Retry/Keep handles it.
      if (isMultiHopRoute && !intermediateToken) resetForm();
    }
  }, [status, txSignature, errorMessage, isMultiHopRoute, intermediateToken, showToast, resetForm]);

  return (
    <div className={className ?? "max-w-md mx-auto"}>
      {/* ================================================================ */}
      {/* Pool indicator / route label */}
      {/* ================================================================ */}
      {smartRouting ? (
        // Smart routing ON: show selected route label or nothing
        selectedRoute && (
          <div className="text-xs text-factory-text-muted mb-2 px-1">
            Route: {selectedRoute.label}
          </div>
        )
      ) : (
        // Smart routing OFF: show pool label as before
        poolConfig && (
          <div className="text-xs text-factory-text-muted mb-2 px-1">
            Pool: {poolConfig.label}
          </div>
        )
      )}

      {/* ================================================================ */}
      {/* Input section */}
      {/* ================================================================ */}
      <div
        className="bg-factory-surface rounded-xl p-4 shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)]"
        style={{ '--color-factory-text': '#ecdcc4', '--color-factory-text-secondary': '#bca88a', '--color-factory-text-muted': '#8a7a62' } as React.CSSProperties}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-factory-text-secondary">You pay</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-factory-text-muted">
              Balance: {formatBalance(inputBalance)}
            </span>
            {inputBalance > 0 && (
              <Button
                variant="primary"
                size="sm"
                disabled={isTransacting}
                onClick={() => {
                  // For SOL, reserve enough for priority fees + base fee + ATA rent
                  const maxAmount =
                    inputToken === "SOL"
                      ? Math.max(0, inputBalance - getSolFeeReserve(settings.priorityFeePreset))
                      : inputBalance;
                  setInputAmount(maxAmount.toString());
                }}
              >
                Max
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={inputAmount}
            disabled={isTransacting}
            onChange={(e) => {
              const val = e.target.value;
              if (isValidDecimalInput(val, inputDecimals)) {
                setInputAmount(val);
              }
            }}
            variant="flush"
            wrapperClassName="flex-1"
            className="text-2xl font-medium"
          />
          <TokenSelector
            selectedToken={inputToken}
            validTokens={validInputTokens}
            onChange={setInputToken}
            disabled={isTransacting}
          />
        </div>
      </div>

      {/* ================================================================ */}
      {/* Flip arrow button */}
      {/* ================================================================ */}
      <div className="flex justify-center -my-3 relative z-10">
        <Button
          variant="primary"
          size="sm"
          onClick={flipTokens}
          disabled={isTransacting}
          aria-label="Flip tokens"
          className="w-8 h-8 rounded-lg"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </Button>
      </div>

      {/* ================================================================ */}
      {/* Output section */}
      {/* ================================================================ */}
      <div
        className="bg-factory-surface rounded-xl p-4 shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)]"
        style={{ '--color-factory-text': '#ecdcc4', '--color-factory-text-secondary': '#bca88a', '--color-factory-text-muted': '#8a7a62' } as React.CSSProperties}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-factory-text-secondary">You receive</span>
          <span className="text-xs text-factory-text-muted">
            Balance: {formatBalance(outputBalance)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={outputAmount}
            disabled={isTransacting}
            onChange={(e) => {
              const val = e.target.value;
              if (isValidDecimalInput(val, outputDecimals)) {
                setOutputAmount(val);
              }
            }}
            variant="flush"
            wrapperClassName="flex-1"
            className="text-2xl font-medium"
          />
          <TokenSelector
            selectedToken={outputToken}
            validTokens={validOutputTokens}
            onChange={setOutputToken}
            disabled={isTransacting}
          />
        </div>

        {/* Quote loading indicator */}
        {quoteLoading && (
          <div className="mt-1 text-xs text-factory-text-muted">
            Fetching quote...
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* Smart Routing toggle */}
      {/* ================================================================ */}
      <div className="flex items-center justify-between mt-3 px-1">
        <span className="text-sm text-[#4a3a24]">Smart Routing</span>
        <Toggle
          checked={smartRouting}
          onChange={(val) => setSmartRouting(val)}
          disabled={isTransacting}
        />
      </div>

      {/* ================================================================ */}
      {/* RouteSelector (when smart routing ON + routes exist) */}
      {/* ================================================================ */}
      {smartRouting && (routes.length > 0 || routesLoading) && (
        <RouteSelector
          routes={routes}
          selectedRoute={selectedRoute}
          onSelectRoute={selectRoute}
          loading={routesLoading}
          outputDecimals={outputDecimals}
          refreshCountdown={refreshCountdown}
        />
      )}

      {/* No direct pool message when Smart Routing is OFF */}
      {!smartRouting && noDirectPool && (
        <div className="mt-3 px-3 py-2 text-sm text-factory-warning-text bg-factory-warning-surface border border-factory-warning-border rounded-lg">
          No direct pool. Enable Smart Routing for this pair.
        </div>
      )}

      {/* ================================================================ */}
      {/* Fee breakdown (expandable) */}
      {/* ================================================================ */}
      <FeeBreakdown
        quote={quote}
        inputToken={inputToken}
        outputToken={outputToken}
        isTaxed={isTaxed}
        loading={quoteLoading}
        route={smartRouting ? selectedRoute : null}
      />

      {/* ================================================================ */}
      {/* Swap settings quick-link (replaces inline SlippageConfig) */}
      {/* Phase 65 will add slippage/priority controls to Settings modal. */}
      {/* Until then, defaults apply: 1% slippage, medium priority. */}
      {/* ================================================================ */}
      <button
        type="button"
        onClick={() => openModal('settings', { x: window.innerWidth / 2, y: window.innerHeight / 2 })}
        className="text-xs text-[#6b5a3e] hover:text-factory-accent cursor-pointer mt-2 px-1 transition-colors"
      >
        Swap settings
      </button>
    </div>
  );
}
