/**
 * Route Engine: Path Enumeration, Quoting, and Ranking
 *
 * Pure-function routing engine for the Dr. Fraudsworth protocol.
 * Takes pool reserves, epoch tax state, and swap parameters as input.
 * Returns an array of Route objects sorted by descending output amount.
 *
 * No RPC calls, no React, no side effects. All functions are deterministic
 * and testable in isolation.
 *
 * H014 FIX: All internal arithmetic uses BigInt via quote-engine.ts.
 * Conversion to Number happens only at the Route output boundary, where
 * amounts are safe for display (individual amounts < Number.MAX_SAFE_INTEGER).
 *
 * The protocol has 2 AMM pools + vault conversions:
 *
 *       SOL
 *      /   \
 *    CRIME  FRAUD     (AMM pools: CRIME/SOL, FRAUD/SOL)
 *      \   /
 *      PROFIT          (vault: fixed 100:1 conversion)
 *
 * This gives us:
 * - 4 direct single-hop routes (SOL pools + vault conversions)
 * - Multi-hop 2-hop routes (via intermediate tokens)
 * - No beneficial 3+ hop routes (topology constraint)
 */

import {
  quoteSolBuy,
  quoteSolSell,
  quoteVaultConvert,
} from "./quote-engine";

import { SOL_POOL_FEE_BPS, VAULT_CONVERSION_RATE } from "@dr-fraudsworth/shared";

import type {
  TokenSymbol,
  RouteStep,
  Route,
  PoolReserves,
  EpochTaxState,
  RouteGraph,
  RouteGraphEdge,
} from "./route-types";

// =============================================================================
// BigInt conversion helpers
// =============================================================================

/** Convert SOL_POOL_FEE_BPS (number constant from shared) to bigint once */
const SOL_POOL_FEE_BPS_BI = BigInt(SOL_POOL_FEE_BPS);

/** Convert VAULT_CONVERSION_RATE (number constant from shared) to bigint once */
const VAULT_CONVERSION_RATE_BI = BigInt(VAULT_CONVERSION_RATE);

// =============================================================================
// Route Graph (static adjacency list)
// =============================================================================

/**
 * Static route graph representing all direct pool connections.
 *
 * Each token maps to its neighbors with the pool label and swap direction.
 * The graph is bidirectional: each pool appears as two edges (one per direction).
 *
 *   SOL  <--solBuy/solSell-->  CRIME
 *   SOL  <--solBuy/solSell-->  FRAUD
 *   CRIME <--vaultConvert-->  PROFIT   (fixed 100:1)
 *   FRAUD <--vaultConvert-->  PROFIT   (fixed 100:1)
 */
export const ROUTE_GRAPH: RouteGraph = {
  SOL: [
    { neighborToken: "CRIME", poolLabel: "CRIME/SOL", direction: "solBuy" },
    { neighborToken: "FRAUD", poolLabel: "FRAUD/SOL", direction: "solBuy" },
  ],
  CRIME: [
    { neighborToken: "SOL", poolLabel: "CRIME/SOL", direction: "solSell" },
    { neighborToken: "PROFIT", poolLabel: "CRIME/Vault", direction: "vaultConvert" },
  ],
  FRAUD: [
    { neighborToken: "SOL", poolLabel: "FRAUD/SOL", direction: "solSell" },
    { neighborToken: "PROFIT", poolLabel: "FRAUD/Vault", direction: "vaultConvert" },
  ],
  PROFIT: [
    { neighborToken: "CRIME", poolLabel: "CRIME/Vault", direction: "vaultConvert" },
    { neighborToken: "FRAUD", poolLabel: "FRAUD/Vault", direction: "vaultConvert" },
  ],
};

/**
 * Returns the route graph. Currently returns the static ROUTE_GRAPH.
 * Exists as a function for future dynamic pool support where pools
 * may be added/removed at runtime.
 */
export function buildRouteGraph(): RouteGraph {
  return ROUTE_GRAPH;
}

// =============================================================================
// Path Enumeration
// =============================================================================

/**
 * A path is an ordered list of edges to traverse.
 * Single-hop: 1 edge. Multi-hop: 2 edges.
 */
type Path = RouteGraphEdge[];

/**
 * Enumerate all viable paths from inputToken to outputToken.
 *
 * 1. Single-hop: direct edge from input to output
 * 2. Two-hop: input -> intermediate -> output (intermediate has edges to both)
 * 3. No 3+ hop paths (topology doesn't support beneficial ones)
 *
 * @param inputToken - Starting token
 * @param outputToken - Target token
 * @returns Array of paths (each path is an ordered array of edges)
 */
function enumeratePaths(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): Path[] {
  const graph = ROUTE_GRAPH;
  const paths: Path[] = [];

  // 1. Single-hop: direct edge from input to output
  const directEdges = graph[inputToken].filter(
    (edge) => edge.neighborToken === outputToken,
  );
  for (const edge of directEdges) {
    paths.push([edge]);
  }

  // 2. Two-hop: input -> intermediate -> output
  //    Find all intermediates reachable from input that can reach output
  for (const firstEdge of graph[inputToken]) {
    const intermediate = firstEdge.neighborToken;
    if (intermediate === outputToken) continue; // Already covered as single-hop

    // Check if intermediate has an edge to outputToken
    const secondEdges = graph[intermediate].filter(
      (edge) => edge.neighborToken === outputToken,
    );
    for (const secondEdge of secondEdges) {
      paths.push([firstEdge, secondEdge]);
    }
  }

  return paths;
}

// =============================================================================
// Step Quoting (internal BigInt, output Number)
// =============================================================================

/**
 * Result of quoting a single step. Bundles the RouteStep with the
 * fee/tax amounts extracted from the quote-engine result, avoiding
 * redundant re-invocation of quote functions in the route builder.
 */
interface StepQuoteResult {
  step: RouteStep;
  /** LP fee amount in this step's input token base units */
  lpFeeAmount: number;
  /** Tax amount in lamports (0 for vault conversion steps) */
  taxAmount: number;
  /** Output amount as bigint for chaining to next step without precision loss */
  outputAmountBigInt: bigint;
}

/**
 * Quote a single step (one pool swap) using the appropriate quote-engine function.
 *
 * Maps the edge's direction to the correct quote function and extracts
 * the relevant reserves, tax rate, and fee amounts.
 *
 * Internal arithmetic uses BigInt via quote-engine. Results are converted
 * to Number at the RouteStep boundary (amounts are individual values,
 * well within Number.MAX_SAFE_INTEGER).
 *
 * @param edge - The route graph edge defining the pool and direction
 * @param inputAmountBI - Amount to swap in base units (BigInt for precision)
 * @param poolReserves - Current pool reserves snapshot
 * @param taxState - Current epoch tax rates
 * @returns StepQuoteResult with step data and fee breakdown, or null if reserves missing
 */
function quoteStep(
  edge: RouteGraphEdge,
  inputAmountBI: bigint,
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
): StepQuoteResult | null {
  // Vault conversion: fixed 100:1 rate, no reserves needed
  if (edge.direction === "vaultConvert") {
    // Determine direction: if neighborToken is PROFIT, we're converting faction -> PROFIT
    // If neighborToken is CRIME/FRAUD, we're converting PROFIT -> faction
    const isProfitInput = edge.neighborToken !== "PROFIT";
    const factionToken: TokenSymbol = edge.poolLabel.startsWith("CRIME") ? "CRIME" : "FRAUD";

    const quote = quoteVaultConvert(inputAmountBI, VAULT_CONVERSION_RATE_BI, isProfitInput);
    if (quote.outputAmount <= 0n) return null;

    return {
      step: {
        pool: edge.poolLabel,
        inputToken: isProfitInput ? "PROFIT" : factionToken,
        outputToken: edge.neighborToken,
        inputAmount: Number(inputAmountBI),
        outputAmount: Number(quote.outputAmount),
        lpFeeBps: 0,
        taxBps: 0,
        priceImpactBps: 0,
      },
      lpFeeAmount: 0,
      taxAmount: 0,
      outputAmountBigInt: quote.outputAmount,
    };
  }

  // AMM pool swaps: require reserves
  const reserves = poolReserves[edge.poolLabel as keyof PoolReserves];
  if (!reserves) return null;

  // Convert reserves to BigInt for quote-engine
  const reserveABI = BigInt(reserves.reserveA);
  const reserveBBI = BigInt(reserves.reserveB);

  switch (edge.direction) {
    case "solBuy": {
      // SOL -> CRIME or SOL -> FRAUD
      // Pool convention: reserveA = WSOL, reserveB = token
      const taxBps =
        edge.poolLabel === "CRIME/SOL"
          ? taxState.crimeBuyTaxBps
          : taxState.fraudBuyTaxBps;
      const quote = quoteSolBuy(
        inputAmountBI,
        reserveABI,
        reserveBBI,
        BigInt(taxBps),
        SOL_POOL_FEE_BPS_BI,
      );
      return {
        step: {
          pool: edge.poolLabel,
          inputToken: "SOL" as TokenSymbol,
          outputToken: edge.neighborToken,
          inputAmount: Number(inputAmountBI),
          outputAmount: Number(quote.outputTokens),
          lpFeeBps: SOL_POOL_FEE_BPS,
          taxBps,
          priceImpactBps: Number(quote.priceImpactBps),
        },
        lpFeeAmount: Number(quote.lpFee),
        taxAmount: Number(quote.taxAmount),
        outputAmountBigInt: quote.outputTokens,
      };
    }

    case "solSell": {
      // CRIME -> SOL or FRAUD -> SOL
      // Pool convention: reserveA = WSOL, reserveB = token
      const sellingToken: TokenSymbol =
        edge.poolLabel === "CRIME/SOL" ? "CRIME" : "FRAUD";
      const taxBps =
        edge.poolLabel === "CRIME/SOL"
          ? taxState.crimeSellTaxBps
          : taxState.fraudSellTaxBps;
      const quote = quoteSolSell(
        inputAmountBI,
        reserveABI,
        reserveBBI,
        BigInt(taxBps),
        SOL_POOL_FEE_BPS_BI,
      );
      return {
        step: {
          pool: edge.poolLabel,
          inputToken: sellingToken,
          outputToken: "SOL" as TokenSymbol,
          inputAmount: Number(inputAmountBI),
          outputAmount: Number(quote.outputSol),
          lpFeeBps: SOL_POOL_FEE_BPS,
          taxBps,
          priceImpactBps: Number(quote.priceImpactBps),
        },
        lpFeeAmount: Number(quote.lpFee),
        taxAmount: Number(quote.taxAmount),
        outputAmountBigInt: quote.outputSol,
      };
    }

    default:
      return null;
  }
}

// =============================================================================
// Route Building
// =============================================================================

/**
 * Quote an entire path step-by-step, chaining outputs as inputs.
 *
 * The output of step N becomes the input of step N+1.
 * Chaining uses BigInt (via outputAmountBigInt) to avoid precision loss
 * in intermediate hops. Final route amounts are Number (display-safe).
 *
 * @param path - Ordered list of edges to traverse
 * @param inputAmount - User's original input amount (number, converted to BigInt internally)
 * @param poolReserves - Current pool reserves
 * @param taxState - Current epoch tax rates
 * @param slippageBps - Slippage tolerance in basis points
 * @returns A fully populated Route, or null if any step fails
 */
function quoteRoute(
  path: Path,
  inputAmount: number,
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
  slippageBps: number,
): Route | null {
  const steps: RouteStep[] = [];
  let currentInputBI = BigInt(inputAmount);
  let totalLpFee = 0;
  let totalTax = 0;

  for (const edge of path) {
    const result = quoteStep(edge, currentInputBI, poolReserves, taxState);
    if (!result || result.step.outputAmount <= 0) return null;

    steps.push(result.step);

    // Accumulate fees from the quote-engine result (no redundant re-computation)
    totalLpFee += result.lpFeeAmount;
    totalTax += result.taxAmount;

    // Chain: output of this step = input of next step (BigInt for precision)
    currentInputBI = result.outputAmountBigInt;
  }

  const finalOutput = steps[steps.length - 1].outputAmount;

  // Aggregate price impact: combine across hops
  // For multi-hop, impact compounds. Use max as a simple heuristic that's
  // informative to users without overstating.
  const totalPriceImpactBps = steps.reduce(
    (sum, s) => sum + s.priceImpactBps,
    0,
  );

  // Total fee percentage from per-step BPS (denomination-independent).
  // For multi-hop routes, LP fees and tax are in different token denominations,
  // so summing amounts and dividing by inputAmount gives wrong results.
  // BPS summation from step-level rates is always correct for display.
  const totalFeeBps = steps.reduce((sum, s) => sum + s.lpFeeBps + s.taxBps, 0);
  const totalFeePct = `${(totalFeeBps / 100).toFixed(1)}%`;

  // Build route label: "SOL -> CRIME -> PROFIT"
  const tokenPath = [inputToken, ...steps.map((s) => s.outputToken)];
  const label = tokenPath.join(" -> ");

  // Minimum output after slippage tolerance (BigInt arithmetic for precision)
  const finalOutputBI = currentInputBI; // This is the BigInt output of the last step
  const minimumOutputBI = finalOutputBI * BigInt(10_000 - slippageBps) / 10_000n;

  return {
    steps,
    inputToken,
    outputToken,
    inputAmount,
    outputAmount: finalOutput,
    totalLpFee,
    totalTax,
    totalPriceImpactBps,
    totalFeePct,
    hops: steps.length,
    isSplit: false,
    label,
    minimumOutput: Number(minimumOutputBI),
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Compute all viable routes for a given token pair, quote each path
 * using quote-engine primitives, and return routes ranked by output amount.
 *
 * This is the main entry point for the routing engine. It is a pure function
 * with no side effects -- all state is passed in as parameters.
 *
 * @param inputToken - Token being sold
 * @param outputToken - Token being bought
 * @param inputAmount - Amount to swap in base units (lamports or token units)
 * @param poolReserves - Current reserve state for the 2 AMM pools
 * @param taxState - Current epoch tax rates
 * @param slippageBps - Slippage tolerance in basis points (e.g., 100 = 1%)
 * @returns Array of Route objects sorted by descending outputAmount. Empty for invalid inputs.
 */
export function computeRoutes(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
  inputAmount: number,
  poolReserves: PoolReserves,
  taxState: EpochTaxState,
  slippageBps: number,
): Route[] {
  // Guard: zero or negative input
  if (inputAmount <= 0) return [];

  // Guard: same token
  if (inputToken === outputToken) return [];

  // Enumerate all viable paths
  const paths = enumeratePaths(inputToken, outputToken);

  // Quote each path
  const routes: Route[] = [];
  for (const path of paths) {
    const route = quoteRoute(
      path,
      inputAmount,
      inputToken,
      outputToken,
      poolReserves,
      taxState,
      slippageBps,
    );
    if (route && route.outputAmount > 0) {
      routes.push(route);
    }
  }

  // Rank by output amount descending (best first)
  routes.sort((a, b) => b.outputAmount - a.outputAmount);

  return routes;
}
