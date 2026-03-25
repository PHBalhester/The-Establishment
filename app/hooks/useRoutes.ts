"use client";

/**
 * useRoutes -- Route computation hook wrapping route-engine + split-router
 *
 * Computes all viable routes for a given token pair using the pure routing engine,
 * with React state management for debounced computation, 30-second auto-refresh,
 * and flicker-safe route selection.
 *
 * Key behaviors:
 * - Debounced 300ms route computation when inputs change
 * - Auto-refresh every 30 seconds (countdown exposed for UI timer)
 * - Split route detection for SOL<->PROFIT paths
 * - Anti-flicker: keeps current selection if within 10 bps of new best
 * - Returns empty state when disabled (smart routing OFF)
 *
 * Consumed by useSwap to provide route data to the swap UI.
 */

import { useState, useEffect, useRef, useCallback } from "react";

import { computeRoutes } from "@/lib/swap/route-engine";
import { computeOptimalSplit } from "@/lib/swap/split-router";
import {
  quoteSolBuy,
  quoteSolSell,
  quoteVaultConvert,
} from "@/lib/swap/quote-engine";
import type { Route, PoolReserves, EpochTaxState, TokenSymbol } from "@/lib/swap/route-types";
import type { PoolData } from "./usePoolPrices";
import type { EpochStateData } from "./useEpochState";

import { SOL_POOL_FEE_BPS, VAULT_CONVERSION_RATE } from "@dr-fraudsworth/shared";

// =============================================================================
// BigInt conversion helpers (shared constants are `number`, quote-engine needs `bigint`)
// =============================================================================

const SOL_POOL_FEE_BPS_BI = BigInt(SOL_POOL_FEE_BPS);
const VAULT_CONVERSION_RATE_BI = BigInt(VAULT_CONVERSION_RATE);

// =============================================================================
// Constants
// =============================================================================

/** Debounce delay for route computation in milliseconds */
const COMPUTE_DEBOUNCE_MS = 300;

/** Auto-refresh interval in seconds */
const REFRESH_INTERVAL_SECONDS = 30;

/** Anti-flicker threshold: keep current selection if within 10 bps of new best */
const FLICKER_THRESHOLD_BPS = 10;

// =============================================================================
// Types
// =============================================================================

/** Map of pool labels to pool data (from usePoolPrices) */
export type PoolPricesMap = Record<string, PoolData>;

export interface UseRoutesReturn {
  /** Ranked routes (best first) */
  routes: Route[];
  /** Currently selected route */
  selectedRoute: Route | null;
  /** Manually select a route (user clicked a different route in RouteSelector) */
  selectRoute: (route: Route) => void;
  /** True during route computation */
  routesLoading: boolean;
  /** Seconds until next auto-refresh (0-30) */
  refreshCountdown: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert PoolPricesMap (from usePoolPrices) into PoolReserves for the route engine.
 * Returns null if either SOL pool is still loading or missing.
 *
 * Only 2 AMM pools remain after vault conversion replaced PROFIT pools.
 * PROFIT conversions use a fixed 100:1 vault (no reserves needed).
 */
function toPoolReserves(pools: PoolPricesMap): PoolReserves | null {
  const requiredPools = ["CRIME/SOL", "FRAUD/SOL"] as const;

  for (const label of requiredPools) {
    const pool = pools[label];
    if (!pool || pool.loading) return null;
  }

  return {
    "CRIME/SOL": {
      reserveA: pools["CRIME/SOL"].reserveA,
      reserveB: pools["CRIME/SOL"].reserveB,
    },
    "FRAUD/SOL": {
      reserveA: pools["FRAUD/SOL"].reserveA,
      reserveB: pools["FRAUD/SOL"].reserveB,
    },
  };
}

/**
 * Convert EpochStateData (from useEpochState) into EpochTaxState for the route engine.
 */
function toEpochTaxState(epochState: EpochStateData): EpochTaxState {
  return {
    crimeBuyTaxBps: epochState.crimeBuyTaxBps,
    crimeSellTaxBps: epochState.crimeSellTaxBps,
    fraudBuyTaxBps: epochState.fraudBuyTaxBps,
    fraudSellTaxBps: epochState.fraudSellTaxBps,
  };
}

/**
 * Check if a pair is split-eligible (two parallel multi-hop paths exist).
 * Only SOL<->PROFIT has two paths: via CRIME and via FRAUD.
 */
function isSplitEligible(inputToken: TokenSymbol, outputToken: TokenSymbol): boolean {
  return (
    (inputToken === "SOL" && outputToken === "PROFIT") ||
    (inputToken === "PROFIT" && outputToken === "SOL")
  );
}

/**
 * Build a split Route from computeOptimalSplit result.
 * Computes the individual step quotes for each leg to populate the Route.steps array.
 */
function buildSplitRoute(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
  totalInput: number,
  splitRatioA: number,
  splitRatioB: number,
  splitOutput: number,
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
  slippageBps: number,
): Route {
  const inputA = Math.floor(totalInput * splitRatioA / 100);
  const inputB = totalInput - inputA;

  // Determine which path is A (via CRIME) and B (via FRAUD)
  // For SOL -> PROFIT: pathA = SOL->CRIME->PROFIT, pathB = SOL->FRAUD->PROFIT
  // For PROFIT -> SOL: pathA = PROFIT->CRIME->SOL, pathB = PROFIT->FRAUD->SOL
  const isSolToProfit = inputToken === "SOL";

  // Compute step-level quotes for each leg
  const steps = isSolToProfit
    ? buildSolToProfitSplitSteps(inputA, inputB, poolReserves, taxState)
    : buildProfitToSolSplitSteps(inputA, inputB, poolReserves, taxState);

  // Accumulate price impact across all steps
  let totalPriceImpactBps = 0;
  for (const step of steps) {
    totalPriceImpactBps += step.priceImpactBps;
  }

  // Total fee percentage from per-step BPS (denomination-independent).
  // For cross-token routes (SOL<->PROFIT), input and output are in different
  // units, so (input - output) / input is meaningless. BPS summation from
  // step-level LP fee and tax rates is always correct for display.
  const totalFeeBps = steps.reduce((sum, s) => sum + s.lpFeeBps + s.taxBps, 0);
  const totalFeePct = `${(totalFeeBps / 100).toFixed(1)}%`;

  const minimumOutput = Math.floor(
    splitOutput * (10_000 - slippageBps) / 10_000,
  );

  const intermediateLabel = isSolToProfit ? "CRIME/FRAUD" : "CRIME/FRAUD";
  const label = `${inputToken} -> ${intermediateLabel} -> ${outputToken} (Split ${splitRatioA}/${splitRatioB})`;

  return {
    steps,
    inputToken,
    outputToken,
    inputAmount: totalInput,
    outputAmount: splitOutput,
    totalLpFee: 0, // Not meaningful for split routes (mixed denominations across legs)
    totalTax: 0,   // Callers use step-level BPS or totalFeePct for display
    totalPriceImpactBps,
    totalFeePct,
    hops: 2,
    isSplit: true,
    splitRatio: [splitRatioA, splitRatioB],
    label,
    minimumOutput,
  };
}

/**
 * Build steps for a SOL -> PROFIT split route (4 steps: 2 per leg).
 * Leg A: SOL -> CRIME -> PROFIT
 * Leg B: SOL -> FRAUD -> PROFIT
 */
function buildSolToProfitSplitSteps(
  inputA: number,
  inputB: number,
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
): import("@/lib/swap/route-types").RouteStep[] {
  const crimePool = poolReserves["CRIME/SOL"];
  const fraudPool = poolReserves["FRAUD/SOL"];

  // Leg A hop 1: SOL -> CRIME (AMM)
  const hop1A = quoteSolBuy(BigInt(inputA), BigInt(crimePool.reserveA), BigInt(crimePool.reserveB), BigInt(taxState.crimeBuyTaxBps), SOL_POOL_FEE_BPS_BI);
  // Leg A hop 2: CRIME -> PROFIT (vault, deterministic 100:1)
  const hop2A = quoteVaultConvert(hop1A.outputTokens, VAULT_CONVERSION_RATE_BI, false);

  // Leg B hop 1: SOL -> FRAUD (AMM)
  const hop1B = quoteSolBuy(BigInt(inputB), BigInt(fraudPool.reserveA), BigInt(fraudPool.reserveB), BigInt(taxState.fraudBuyTaxBps), SOL_POOL_FEE_BPS_BI);
  // Leg B hop 2: FRAUD -> PROFIT (vault, deterministic 100:1)
  const hop2B = quoteVaultConvert(hop1B.outputTokens, VAULT_CONVERSION_RATE_BI, false);

  return [
    // Leg A
    {
      pool: "CRIME/SOL",
      inputToken: "SOL",
      outputToken: "CRIME",
      inputAmount: inputA,
      outputAmount: Number(hop1A.outputTokens),
      lpFeeBps: SOL_POOL_FEE_BPS,
      taxBps: taxState.crimeBuyTaxBps,
      priceImpactBps: Number(hop1A.priceImpactBps),
    },
    {
      pool: "CRIME/Vault",
      inputToken: "CRIME",
      outputToken: "PROFIT",
      inputAmount: Number(hop1A.outputTokens),
      outputAmount: Number(hop2A.outputAmount),
      lpFeeBps: 0,
      taxBps: 0,
      priceImpactBps: 0,
    },
    // Leg B
    {
      pool: "FRAUD/SOL",
      inputToken: "SOL",
      outputToken: "FRAUD",
      inputAmount: inputB,
      outputAmount: Number(hop1B.outputTokens),
      lpFeeBps: SOL_POOL_FEE_BPS,
      taxBps: taxState.fraudBuyTaxBps,
      priceImpactBps: Number(hop1B.priceImpactBps),
    },
    {
      pool: "FRAUD/Vault",
      inputToken: "FRAUD",
      outputToken: "PROFIT",
      inputAmount: Number(hop1B.outputTokens),
      outputAmount: Number(hop2B.outputAmount),
      lpFeeBps: 0,
      taxBps: 0,
      priceImpactBps: 0,
    },
  ];
}

/**
 * Build steps for a PROFIT -> SOL split route (4 steps: 2 per leg).
 * Leg A: PROFIT -> CRIME -> SOL
 * Leg B: PROFIT -> FRAUD -> SOL
 */
function buildProfitToSolSplitSteps(
  inputA: number,
  inputB: number,
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
): import("@/lib/swap/route-types").RouteStep[] {
  const crimePool = poolReserves["CRIME/SOL"];
  const fraudPool = poolReserves["FRAUD/SOL"];

  // Leg A hop 1: PROFIT -> CRIME (vault, deterministic 100:1)
  const hop1A = quoteVaultConvert(BigInt(inputA), VAULT_CONVERSION_RATE_BI, true);
  // Leg A hop 2: CRIME -> SOL (AMM)
  const hop2A = quoteSolSell(hop1A.outputAmount, BigInt(crimePool.reserveA), BigInt(crimePool.reserveB), BigInt(taxState.crimeSellTaxBps), SOL_POOL_FEE_BPS_BI);

  // Leg B hop 1: PROFIT -> FRAUD (vault, deterministic 100:1)
  const hop1B = quoteVaultConvert(BigInt(inputB), VAULT_CONVERSION_RATE_BI, true);
  // Leg B hop 2: FRAUD -> SOL (AMM)
  const hop2B = quoteSolSell(hop1B.outputAmount, BigInt(fraudPool.reserveA), BigInt(fraudPool.reserveB), BigInt(taxState.fraudSellTaxBps), SOL_POOL_FEE_BPS_BI);

  return [
    // Leg A
    {
      pool: "CRIME/Vault",
      inputToken: "PROFIT",
      outputToken: "CRIME",
      inputAmount: inputA,
      outputAmount: Number(hop1A.outputAmount),
      lpFeeBps: 0,
      taxBps: 0,
      priceImpactBps: 0,
    },
    {
      pool: "CRIME/SOL",
      inputToken: "CRIME",
      outputToken: "SOL",
      inputAmount: Number(hop1A.outputAmount),
      outputAmount: Number(hop2A.outputSol),
      lpFeeBps: SOL_POOL_FEE_BPS,
      taxBps: taxState.crimeSellTaxBps,
      priceImpactBps: Number(hop2A.priceImpactBps),
    },
    // Leg B
    {
      pool: "FRAUD/Vault",
      inputToken: "PROFIT",
      outputToken: "FRAUD",
      inputAmount: inputB,
      outputAmount: Number(hop1B.outputAmount),
      lpFeeBps: 0,
      taxBps: 0,
      priceImpactBps: 0,
    },
    {
      pool: "FRAUD/SOL",
      inputToken: "FRAUD",
      outputToken: "SOL",
      inputAmount: Number(hop1B.outputAmount),
      outputAmount: Number(hop2B.outputSol),
      lpFeeBps: SOL_POOL_FEE_BPS,
      taxBps: taxState.fraudSellTaxBps,
      priceImpactBps: Number(hop2B.priceImpactBps),
    },
  ];
}

/**
 * Compose a quoter callback for computeOptimalSplit.
 * Chains two quote functions to simulate a 2-hop path.
 */
function makeSolToProfitQuoter(
  faction: "CRIME" | "FRAUD",
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
): (input: number) => number {
  return (input: number) => {
    if (input <= 0) return 0;
    const solPoolLabel = faction === "CRIME" ? "CRIME/SOL" : "FRAUD/SOL";
    const buyTaxBps = faction === "CRIME" ? taxState.crimeBuyTaxBps : taxState.fraudBuyTaxBps;
    const solPool = poolReserves[solPoolLabel];

    // Hop 1: SOL -> CRIME/FRAUD (AMM)
    const hop1 = quoteSolBuy(BigInt(input), BigInt(solPool.reserveA), BigInt(solPool.reserveB), BigInt(buyTaxBps), SOL_POOL_FEE_BPS_BI);
    if (hop1.outputTokens <= 0n) return 0;

    // Hop 2: CRIME/FRAUD -> PROFIT (vault, deterministic 100:1)
    const hop2 = quoteVaultConvert(hop1.outputTokens, VAULT_CONVERSION_RATE_BI, false);
    return Number(hop2.outputAmount);
  };
}

function makeProfitToSolQuoter(
  faction: "CRIME" | "FRAUD",
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
): (input: number) => number {
  return (input: number) => {
    if (input <= 0) return 0;
    const solPoolLabel = faction === "CRIME" ? "CRIME/SOL" : "FRAUD/SOL";
    const sellTaxBps = faction === "CRIME" ? taxState.crimeSellTaxBps : taxState.fraudSellTaxBps;
    const solPool = poolReserves[solPoolLabel];

    // Hop 1: PROFIT -> CRIME/FRAUD (vault, deterministic 100:1)
    const hop1 = quoteVaultConvert(BigInt(input), VAULT_CONVERSION_RATE_BI, true);
    if (hop1.outputAmount <= 0n) return 0;

    // Hop 2: CRIME/FRAUD -> SOL (AMM)
    const hop2 = quoteSolSell(hop1.outputAmount, BigInt(solPool.reserveA), BigInt(solPool.reserveB), BigInt(sellTaxBps), SOL_POOL_FEE_BPS_BI);
    return Number(hop2.outputSol);
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useRoutes(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
  inputAmount: number,
  pools: PoolPricesMap,
  epochState: EpochStateData | null,
  slippageBps: number,
  enabled: boolean,
): UseRoutesReturn {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [refreshCountdown, setRefreshCountdown] = useState(REFRESH_INTERVAL_SECONDS);

  // Refs for timers
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Track whether we should recompute (set by countdown reaching 0)
  const recomputeTriggerRef = useRef(0);

  // ============================================================================
  // Manual route selection (user clicks a different route in RouteSelector)
  // ============================================================================

  const selectRoute = useCallback((route: Route) => {
    setSelectedRoute(route);
  }, []);

  // ============================================================================
  // Route computation
  // ============================================================================

  const computeAllRoutes = useCallback(() => {
    if (!enabled || inputAmount <= 0) {
      setRoutes([]);
      setSelectedRoute(null);
      setRoutesLoading(false);
      return;
    }

    // Convert pool data to route-engine format
    const poolReserves = toPoolReserves(pools);
    if (!poolReserves) {
      // Pools still loading
      setRoutesLoading(true);
      return;
    }

    // Epoch state required for tax rates (SOL pool routes need it)
    if (!epochState) {
      setRoutesLoading(true);
      return;
    }

    const taxState = toEpochTaxState(epochState);

    // 1. Compute all standard routes (single-hop + multi-hop)
    const standardRoutes = computeRoutes(
      inputToken, outputToken, inputAmount,
      poolReserves, taxState, slippageBps,
    );

    // 2. Check for split route opportunity
    let allRoutes = [...standardRoutes];

    if (isSplitEligible(inputToken, outputToken)) {
      const isSolToProfit = inputToken === "SOL";

      const pathAQuoter = isSolToProfit
        ? makeSolToProfitQuoter("CRIME", poolReserves, taxState)
        : makeProfitToSolQuoter("CRIME", poolReserves, taxState);

      const pathBQuoter = isSolToProfit
        ? makeSolToProfitQuoter("FRAUD", poolReserves, taxState)
        : makeProfitToSolQuoter("FRAUD", poolReserves, taxState);

      const splitResult = computeOptimalSplit(inputAmount, pathAQuoter, pathBQuoter);

      if (splitResult.shouldSplit) {
        const splitRoute = buildSplitRoute(
          inputToken, outputToken, inputAmount,
          splitResult.splitRatioA, splitResult.splitRatioB,
          splitResult.splitOutput,
          poolReserves, taxState, slippageBps,
        );
        allRoutes.push(splitRoute);
      }
    }

    // 3. Sort by output amount descending
    allRoutes.sort((a, b) => b.outputAmount - a.outputAmount);

    if (!mountedRef.current) return;

    // 4. Update routes
    setRoutes(allRoutes);

    // 5. Anti-flicker route selection
    setSelectedRoute((prev) => {
      if (!prev || allRoutes.length === 0) {
        return allRoutes[0] ?? null;
      }

      // Check if current selection still exists in new routes
      const matchingRoute = allRoutes.find((r) => r.label === prev.label);
      if (!matchingRoute) {
        // Current selection gone -- select best
        return allRoutes[0];
      }

      // Check if a different route beats current by more than threshold
      const bestRoute = allRoutes[0];
      if (bestRoute.label !== matchingRoute.label && bestRoute.outputAmount > 0) {
        const improvementBps = Math.floor(
          (bestRoute.outputAmount - matchingRoute.outputAmount)
          / matchingRoute.outputAmount * 10_000,
        );
        if (improvementBps > FLICKER_THRESHOLD_BPS) {
          // New route significantly better -- switch
          return bestRoute;
        }
      }

      // Keep current selection (updated with new quote data)
      return matchingRoute;
    });

    setRoutesLoading(false);
  }, [enabled, inputToken, outputToken, inputAmount, pools, epochState, slippageBps]);

  // ============================================================================
  // Debounced computation on input changes
  // ============================================================================

  useEffect(() => {
    if (!enabled) {
      setRoutes([]);
      setSelectedRoute(null);
      setRoutesLoading(false);
      setRefreshCountdown(REFRESH_INTERVAL_SECONDS);
      // Clear timers
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    if (inputAmount <= 0) {
      setRoutes([]);
      setSelectedRoute(null);
      setRoutesLoading(false);
      return;
    }

    // Start debounce
    setRoutesLoading(true);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      computeAllRoutes();

      // Reset countdown after computation
      setRefreshCountdown(REFRESH_INTERVAL_SECONDS);
    }, COMPUTE_DEBOUNCE_MS);

    // Cleanup debounce on input change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, inputToken, outputToken, inputAmount, pools, epochState, slippageBps]);

  // ============================================================================
  // Auto-refresh countdown (30s timer)
  // ============================================================================

  useEffect(() => {
    if (!enabled || inputAmount <= 0) return;

    // Clear existing interval
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    countdownIntervalRef.current = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          // Time to refresh -- trigger recomputation
          recomputeTriggerRef.current += 1;
          computeAllRoutes();
          return REFRESH_INTERVAL_SECONDS;
        }
        return prev - 1;
      });
    }, 1_000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [enabled, inputAmount, computeAllRoutes]);

  // ============================================================================
  // Cleanup on unmount
  // ============================================================================

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    routes,
    selectedRoute,
    selectRoute,
    routesLoading,
    refreshCountdown,
  };
}
