/**
 * Route Types for Smart Swap Routing
 *
 * Shared type definitions used by the route engine, multi-hop builder,
 * and UI components. These types describe the structure of swap routes
 * through the protocol's 2 AMM pools + vault conversions:
 *
 *       SOL
 *      /   \
 *    CRIME  FRAUD     (AMM pools: CRIME/SOL, FRAUD/SOL)
 *      \   /
 *      PROFIT          (vault: fixed 100:1 conversion)
 *
 * Pure data types -- no logic, no imports from heavy packages.
 */

// =============================================================================
// Token Symbol
// =============================================================================

/** The 4 tradeable tokens in the protocol */
export type TokenSymbol = "SOL" | "CRIME" | "FRAUD" | "PROFIT";

// =============================================================================
// Route Step (single hop within a route)
// =============================================================================

/**
 * A single hop in a swap route.
 *
 * Each step represents one pool swap: the output of step N becomes
 * the input of step N+1 in a multi-hop route.
 */
export interface RouteStep {
  /** Pool label: "CRIME/SOL", "FRAUD/SOL", "CRIME/Vault", "FRAUD/Vault" */
  pool: string;
  /** Token being sold in this step */
  inputToken: TokenSymbol;
  /** Token being received in this step */
  outputToken: TokenSymbol;
  /** Input amount in base units (lamports or token smallest denomination) */
  inputAmount: number;
  /** Output amount in base units */
  outputAmount: number;
  /** LP fee for this pool in basis points */
  lpFeeBps: number;
  /** Tax rate in basis points (0 for vault conversion steps) */
  taxBps: number;
  /** Price impact for this step in basis points */
  priceImpactBps: number;
}

// =============================================================================
// Route (complete path from input to output)
// =============================================================================

/**
 * A complete swap route from inputToken to outputToken.
 *
 * May consist of 1 step (direct swap) or 2 steps (multi-hop).
 * Routes are ranked by outputAmount (highest first).
 */
export interface Route {
  /** Ordered list of swap steps */
  steps: RouteStep[];
  /** Token being sold (user's input) */
  inputToken: TokenSymbol;
  /** Token being received (user's output) */
  outputToken: TokenSymbol;
  /** User's original input amount in base units */
  inputAmount: number;
  /** Final output amount in base units (after all hops, fees, and tax) */
  outputAmount: number;
  /** Aggregate LP fees across all hops (in input token base units for hop 1) */
  totalLpFee: number;
  /** Aggregate tax across all hops (in lamports for SOL-pool hops) */
  totalTax: number;
  /** Aggregate price impact across all hops in basis points */
  totalPriceImpactBps: number;
  /** Display string for total fee percentage, e.g. "4.9%" */
  totalFeePct: string;
  /** Number of hops (1 for direct, 2 for multi-hop) */
  hops: number;
  /** Whether this route splits input across multiple paths */
  isSplit: boolean;
  /** Split ratio if isSplit is true, e.g. [60, 40] */
  splitRatio?: [number, number];
  /** Human-readable route path, e.g. "SOL -> CRIME -> PROFIT" */
  label: string;
  /** Minimum output after slippage tolerance, in base units */
  minimumOutput: number;
}

// =============================================================================
// Pool Reserves (2 AMM pools)
// =============================================================================

/**
 * On-chain reserve state for the 2 AMM pools.
 *
 * Convention:
 * - SOL pools: reserveA = WSOL, reserveB = token (CRIME or FRAUD)
 *
 * PROFIT conversion uses a fixed-rate vault (no reserves needed).
 * Source: read from PoolState account data at byte offsets 137 and 145.
 */
export interface PoolReserves {
  "CRIME/SOL": { reserveA: number; reserveB: number };
  "FRAUD/SOL": { reserveA: number; reserveB: number };
}

// =============================================================================
// Epoch Tax State
// =============================================================================

/**
 * Current epoch's tax rates for CRIME and FRAUD in basis points.
 *
 * Tax applies only to SOL pool swaps (buy = tax on SOL input,
 * sell = tax on SOL output). Vault conversions are untaxed.
 *
 * Source: read from EpochState account (crime_tax_bps, fraud_tax_bps fields
 * split into buy/sell by the epoch's cheap_side).
 */
export interface EpochTaxState {
  crimeBuyTaxBps: number;
  crimeSellTaxBps: number;
  fraudBuyTaxBps: number;
  fraudSellTaxBps: number;
}

// =============================================================================
// Route Graph Edge (for adjacency list)
// =============================================================================

/** Pool labels as a union type */
export type PoolLabel =
  | "CRIME/SOL"
  | "FRAUD/SOL"
  | "CRIME/Vault"
  | "FRAUD/Vault";

/**
 * An edge in the route graph adjacency list.
 *
 * Each edge represents one direction of a pool swap.
 * The direction determines which quote function to use.
 */
export interface RouteGraphEdge {
  /** Token reachable via this edge */
  neighborToken: TokenSymbol;
  /** Pool used for this edge */
  poolLabel: PoolLabel;
  /**
   * Swap direction indicator.
   * - "solBuy": SOL -> token (quoteSolBuy)
   * - "solSell": token -> SOL (quoteSolSell)
   * - "vaultConvert": faction <-> PROFIT at fixed 100:1 rate, zero fee
   */
  direction: "solBuy" | "solSell" | "vaultConvert";
}

/** Route graph: maps each token to its direct neighbors via pool edges */
export type RouteGraph = Record<TokenSymbol, RouteGraphEdge[]>;
