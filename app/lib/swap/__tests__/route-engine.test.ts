/**
 * Route Engine Unit Tests
 *
 * Tests the pure routing engine: path enumeration, quoting via quote-engine
 * primitives, and ranking by output amount.
 *
 * All tests use deterministic test reserves and tax state to verify
 * that computeRoutes returns correct routes for every token pair combination.
 *
 * Protocol topology:
 *       SOL
 *      /   \
 *    CRIME  FRAUD     (AMM pools: CRIME/SOL, FRAUD/SOL)
 *      \   /
 *      PROFIT          (vault: fixed 100:1 conversion)
 */

import { describe, it, expect } from "vitest";
import { computeRoutes, buildRouteGraph, ROUTE_GRAPH } from "../route-engine";
import type { PoolReserves, EpochTaxState } from "../route-types";
import {
  quoteSolBuy,
  quoteSolSell,
  quoteVaultConvert,
} from "../quote-engine";
import { SOL_POOL_FEE_BPS, VAULT_CONVERSION_RATE } from "@dr-fraudsworth/shared";

// =============================================================================
// BigInt conversion helpers (shared constants are `number`, quote-engine needs `bigint`)
// =============================================================================

const SOL_POOL_FEE_BPS_BI = BigInt(SOL_POOL_FEE_BPS);
const VAULT_CONVERSION_RATE_BI = BigInt(VAULT_CONVERSION_RATE);

// =============================================================================
// Test Fixtures
// =============================================================================

/** Only 2 AMM pools — PROFIT conversion uses a fixed-rate vault (no reserves) */
const TEST_RESERVES: PoolReserves = {
  "CRIME/SOL": { reserveA: 2_000_000_000, reserveB: 10_000_000_000 }, // A=WSOL (2 SOL), B=CRIME (10K)
  "FRAUD/SOL": { reserveA: 2_000_000_000, reserveB: 10_000_000_000 }, // A=WSOL (2 SOL), B=FRAUD (10K)
};

const TEST_TAX_STATE: EpochTaxState = {
  crimeBuyTaxBps: 400,   // 4% buy tax on CRIME
  crimeSellTaxBps: 800,  // 8% sell tax on CRIME
  fraudBuyTaxBps: 800,   // 8% buy tax on FRAUD
  fraudSellTaxBps: 400,  // 4% sell tax on FRAUD
};

const SLIPPAGE_BPS = 100; // 1% slippage tolerance

// =============================================================================
// Test 1: Direct SOL -> CRIME (single-hop AMM)
// =============================================================================

describe("computeRoutes", () => {
  it("returns exactly 1 direct route for SOL -> CRIME", () => {
    const routes = computeRoutes(
      "SOL",
      "CRIME",
      100_000_000, // 0.1 SOL
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].hops).toBe(1);
    expect(routes[0].inputToken).toBe("SOL");
    expect(routes[0].outputToken).toBe("CRIME");
    expect(routes[0].steps).toHaveLength(1);
    expect(routes[0].steps[0].pool).toBe("CRIME/SOL");

    // Output must match quoteSolBuy exactly
    const directQuote = quoteSolBuy(
      100_000_000n,
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveA),
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.crimeBuyTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    expect(routes[0].outputAmount).toBe(Number(directQuote.outputTokens));
  });

  // ===========================================================================
  // Test 2: SOL -> PROFIT (multi-hop: AMM + vault)
  // ===========================================================================

  it("returns 2 multi-hop routes for SOL -> PROFIT, ranked by output", () => {
    const routes = computeRoutes(
      "SOL",
      "PROFIT",
      100_000_000, // 0.1 SOL
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(2);

    // Both routes are 2-hop
    expect(routes[0].hops).toBe(2);
    expect(routes[1].hops).toBe(2);

    // Route through CRIME (lower buy tax 400 bps) should rank first (higher output)
    expect(routes[0].label).toBe("SOL -> CRIME -> PROFIT");
    expect(routes[1].label).toBe("SOL -> FRAUD -> PROFIT");
    expect(routes[0].outputAmount).toBeGreaterThan(routes[1].outputAmount);

    // Verify route via CRIME: AMM hop + vault conversion
    const hop1Crime = quoteSolBuy(
      100_000_000n,
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveA),
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.crimeBuyTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    const hop2Crime = quoteVaultConvert(
      hop1Crime.outputTokens,
      VAULT_CONVERSION_RATE_BI,
      false, // faction -> PROFIT
    );
    expect(routes[0].outputAmount).toBe(Number(hop2Crime.outputAmount));

    // Verify route via FRAUD: AMM hop + vault conversion
    const hop1Fraud = quoteSolBuy(
      100_000_000n,
      BigInt(TEST_RESERVES["FRAUD/SOL"].reserveA),
      BigInt(TEST_RESERVES["FRAUD/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.fraudBuyTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    const hop2Fraud = quoteVaultConvert(
      hop1Fraud.outputTokens,
      VAULT_CONVERSION_RATE_BI,
      false,
    );
    expect(routes[1].outputAmount).toBe(Number(hop2Fraud.outputAmount));
  });

  // ===========================================================================
  // Test 3: CRIME -> FRAUD (multi-hop: via SOL and via PROFIT vault)
  // ===========================================================================

  it("returns 2 multi-hop routes for CRIME -> FRAUD", () => {
    const routes = computeRoutes(
      "CRIME",
      "FRAUD",
      1_000_000, // 1 CRIME
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(2);

    // Both routes are 2-hop
    expect(routes[0].hops).toBe(2);
    expect(routes[1].hops).toBe(2);

    // Verify CRIME -> SOL -> FRAUD route (AMM + AMM)
    const viaSolRoute = routes.find((r) => r.label === "CRIME -> SOL -> FRAUD");
    expect(viaSolRoute).toBeDefined();

    const hop1Sol = quoteSolSell(
      1_000_000n,
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveA),
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.crimeSellTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    const hop2Sol = quoteSolBuy(
      hop1Sol.outputSol,
      BigInt(TEST_RESERVES["FRAUD/SOL"].reserveA),
      BigInt(TEST_RESERVES["FRAUD/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.fraudBuyTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    expect(viaSolRoute!.outputAmount).toBe(Number(hop2Sol.outputTokens));

    // Verify CRIME -> PROFIT -> FRAUD route (vault + vault)
    const viaProfitRoute = routes.find(
      (r) => r.label === "CRIME -> PROFIT -> FRAUD",
    );
    expect(viaProfitRoute).toBeDefined();

    const hop1Vault = quoteVaultConvert(
      1_000_000n,
      VAULT_CONVERSION_RATE_BI,
      false, // CRIME -> PROFIT
    );
    const hop2Vault = quoteVaultConvert(
      hop1Vault.outputAmount,
      VAULT_CONVERSION_RATE_BI,
      true, // PROFIT -> FRAUD
    );
    expect(viaProfitRoute!.outputAmount).toBe(Number(hop2Vault.outputAmount));
  });

  // ===========================================================================
  // Test 4: Direct CRIME -> SOL (single-hop AMM)
  // ===========================================================================

  it("returns exactly 1 direct route for CRIME -> SOL", () => {
    const routes = computeRoutes(
      "CRIME",
      "SOL",
      1_000_000, // 1 CRIME
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].hops).toBe(1);
    expect(routes[0].steps).toHaveLength(1);
    expect(routes[0].steps[0].pool).toBe("CRIME/SOL");

    // Output must match quoteSolSell exactly
    const directQuote = quoteSolSell(
      1_000_000n,
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveA),
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.crimeSellTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    expect(routes[0].outputAmount).toBe(Number(directQuote.outputSol));
  });

  // ===========================================================================
  // Test 5: Zero input returns empty array
  // ===========================================================================

  it("returns empty array for zero input amount", () => {
    const routes = computeRoutes(
      "SOL",
      "CRIME",
      0,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toEqual([]);
  });

  // ===========================================================================
  // Test 6: minimumOutput uses slippage tolerance
  // ===========================================================================

  it("calculates minimumOutput correctly with slippage tolerance", () => {
    const routes = computeRoutes(
      "SOL",
      "CRIME",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    const route = routes[0];

    // minimumOutput = floor(outputAmount * (10000 - slippageBps) / 10000)
    const expectedMinimum = Math.floor(
      route.outputAmount * (10000 - SLIPPAGE_BPS) / 10000,
    );
    expect(route.minimumOutput).toBe(expectedMinimum);
  });

  // ===========================================================================
  // Test 7: Route label for multi-hop
  // ===========================================================================

  it("generates correct labels for multi-hop routes", () => {
    const routes = computeRoutes(
      "SOL",
      "PROFIT",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    const labels = routes.map((r) => r.label);
    expect(labels).toContain("SOL -> CRIME -> PROFIT");
    expect(labels).toContain("SOL -> FRAUD -> PROFIT");
  });

  // ===========================================================================
  // Test 8: totalFeePct correctly sums BPS-based fees
  // ===========================================================================

  it("calculates totalFeePct correctly for SOL pool routes", () => {
    const routes = computeRoutes(
      "SOL",
      "CRIME",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    const route = routes[0];

    // totalLpFee and totalTax should be populated for SOL pool swaps
    expect(route.totalLpFee).toBeGreaterThan(0);
    expect(route.totalTax).toBeGreaterThan(0);

    // totalFeePct should be a string like "X.X%"
    expect(route.totalFeePct).toMatch(/^\d+(\.\d+)?%$/);

    // totalFeePct is BPS-based: sum of (lpFeeBps + taxBps) across steps / 100
    const expectedBps = route.steps.reduce(
      (sum, s) => sum + s.lpFeeBps + s.taxBps,
      0,
    );
    const expectedPct = expectedBps / 100;
    const actualPct = parseFloat(route.totalFeePct.replace("%", ""));
    expect(actualPct).toBeCloseTo(expectedPct, 1);
  });

  // ===========================================================================
  // Additional coverage: Routes are sorted by outputAmount descending
  // ===========================================================================

  it("returns routes sorted by descending outputAmount", () => {
    const routes = computeRoutes(
      "SOL",
      "PROFIT",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    for (let i = 1; i < routes.length; i++) {
      expect(routes[i - 1].outputAmount).toBeGreaterThanOrEqual(
        routes[i].outputAmount,
      );
    }
  });

  // ===========================================================================
  // Additional coverage: Negative input returns empty array
  // ===========================================================================

  it("returns empty array for negative input amount", () => {
    const routes = computeRoutes(
      "SOL",
      "CRIME",
      -100,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toEqual([]);
  });

  // ===========================================================================
  // Additional coverage: PROFIT -> SOL multi-hop routes
  // ===========================================================================

  it("returns 2 multi-hop routes for PROFIT -> SOL", () => {
    const routes = computeRoutes(
      "PROFIT",
      "SOL",
      1_000_000, // 1 PROFIT
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(2);
    expect(routes[0].hops).toBe(2);
    expect(routes[1].hops).toBe(2);

    // Verify PROFIT -> CRIME -> SOL route (vault + AMM)
    const viaCrimeRoute = routes.find(
      (r) => r.label === "PROFIT -> CRIME -> SOL",
    );
    expect(viaCrimeRoute).toBeDefined();

    const hop1 = quoteVaultConvert(
      1_000_000n,
      VAULT_CONVERSION_RATE_BI,
      true, // PROFIT -> CRIME
    );
    const hop2 = quoteSolSell(
      hop1.outputAmount,
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveA),
      BigInt(TEST_RESERVES["CRIME/SOL"].reserveB),
      BigInt(TEST_TAX_STATE.crimeSellTaxBps),
      SOL_POOL_FEE_BPS_BI,
    );
    expect(viaCrimeRoute!.outputAmount).toBe(Number(hop2.outputSol));
  });

  // ===========================================================================
  // Direct vault conversions: PROFIT -> CRIME and CRIME -> PROFIT
  // ===========================================================================

  it("returns 1 direct route for PROFIT -> CRIME via vault", () => {
    const routes = computeRoutes(
      "PROFIT",
      "CRIME",
      1_000_000, // 1 PROFIT
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].hops).toBe(1);
    expect(routes[0].steps[0].pool).toBe("CRIME/Vault");

    const directQuote = quoteVaultConvert(
      1_000_000n,
      VAULT_CONVERSION_RATE_BI,
      true, // PROFIT -> CRIME
    );
    expect(routes[0].outputAmount).toBe(Number(directQuote.outputAmount));
  });

  it("returns 1 direct route for CRIME -> PROFIT via vault", () => {
    const routes = computeRoutes(
      "CRIME",
      "PROFIT",
      1_000_000, // 1 CRIME
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].hops).toBe(1);
    expect(routes[0].steps[0].pool).toBe("CRIME/Vault");

    const directQuote = quoteVaultConvert(
      1_000_000n,
      VAULT_CONVERSION_RATE_BI,
      false, // CRIME -> PROFIT
    );
    expect(routes[0].outputAmount).toBe(Number(directQuote.outputAmount));
  });

  // ===========================================================================
  // Vault conversion math
  // ===========================================================================

  it("vault: 100 CRIME (100_000_000 base) -> 1 PROFIT (1_000_000 base)", () => {
    // 100 CRIME = 100_000_000 base units (6 decimals)
    // 100:1 conversion -> 1 PROFIT = 1_000_000 base units
    const quote = quoteVaultConvert(100_000_000n, VAULT_CONVERSION_RATE_BI, false);
    expect(Number(quote.outputAmount)).toBe(1_000_000);
  });

  it("vault: 1 PROFIT (1_000_000 base) -> 100 CRIME (100_000_000 base)", () => {
    // 1 PROFIT = 1_000_000 base units -> 100 CRIME = 100_000_000 base units
    const quote = quoteVaultConvert(1_000_000n, VAULT_CONVERSION_RATE_BI, true);
    expect(Number(quote.outputAmount)).toBe(100_000_000);
  });

  it("vault: zero fee, zero price impact, zero tax for vault steps", () => {
    const routes = computeRoutes(
      "CRIME",
      "PROFIT",
      1_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes).toHaveLength(1);
    const step = routes[0].steps[0];
    expect(step.lpFeeBps).toBe(0);
    expect(step.taxBps).toBe(0);
    expect(step.priceImpactBps).toBe(0);
  });

  it("vault-only route has totalFeePct = '0%'", () => {
    const routes = computeRoutes(
      "CRIME",
      "PROFIT",
      1_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    expect(routes[0].totalFeePct).toBe("0.0%");
  });

  it("mixed AMM+vault route shows only SOL pool fees in totalFeePct", () => {
    const routes = computeRoutes(
      "SOL",
      "PROFIT",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    // Best route (via CRIME): fee = SOL pool LP (100 bps) + tax (400 bps) + vault (0 bps)
    const route = routes[0];
    const expectedBps = route.steps.reduce(
      (sum, s) => sum + s.lpFeeBps + s.taxBps,
      0,
    );
    // Vault step contributes 0 bps
    expect(expectedBps).toBe(SOL_POOL_FEE_BPS + TEST_TAX_STATE.crimeBuyTaxBps);
    const actualPct = parseFloat(route.totalFeePct.replace("%", ""));
    expect(actualPct).toBeCloseTo(expectedBps / 100, 1);
  });

  // ===========================================================================
  // Additional coverage: isSplit is false for non-split routes
  // ===========================================================================

  it("marks all non-split routes as isSplit = false", () => {
    const routes = computeRoutes(
      "SOL",
      "PROFIT",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    for (const route of routes) {
      expect(route.isSplit).toBe(false);
    }
  });

  // ===========================================================================
  // Step-level data for single-hop AMM
  // ===========================================================================

  it("populates step-level data correctly for single-hop AMM", () => {
    const routes = computeRoutes(
      "SOL",
      "CRIME",
      100_000_000,
      TEST_RESERVES,
      TEST_TAX_STATE,
      SLIPPAGE_BPS,
    );

    const step = routes[0].steps[0];
    expect(step.inputToken).toBe("SOL");
    expect(step.outputToken).toBe("CRIME");
    expect(step.inputAmount).toBe(100_000_000);
    expect(step.outputAmount).toBeGreaterThan(0);
    expect(step.lpFeeBps).toBe(SOL_POOL_FEE_BPS);
    expect(step.taxBps).toBe(400); // crimeBuyTaxBps
    expect(step.priceImpactBps).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// buildRouteGraph and ROUTE_GRAPH
// =============================================================================

describe("ROUTE_GRAPH", () => {
  it("is a complete adjacency list for all 4 tokens", () => {
    const graph = buildRouteGraph();
    expect(Object.keys(graph)).toHaveLength(4);
    expect(graph).toHaveProperty("SOL");
    expect(graph).toHaveProperty("CRIME");
    expect(graph).toHaveProperty("FRAUD");
    expect(graph).toHaveProperty("PROFIT");
  });

  it("SOL has edges to CRIME and FRAUD (solBuy)", () => {
    const neighbors = ROUTE_GRAPH["SOL"].map((e) => e.neighborToken);
    expect(neighbors).toContain("CRIME");
    expect(neighbors).toContain("FRAUD");
    expect(neighbors).toHaveLength(2);

    for (const edge of ROUTE_GRAPH["SOL"]) {
      expect(edge.direction).toBe("solBuy");
    }
  });

  it("CRIME has edges to SOL (solSell) and PROFIT (vaultConvert)", () => {
    const neighbors = ROUTE_GRAPH["CRIME"].map((e) => e.neighborToken);
    expect(neighbors).toContain("SOL");
    expect(neighbors).toContain("PROFIT");
    expect(neighbors).toHaveLength(2);

    const solEdge = ROUTE_GRAPH["CRIME"].find((e) => e.neighborToken === "SOL");
    expect(solEdge!.direction).toBe("solSell");
    expect(solEdge!.poolLabel).toBe("CRIME/SOL");

    const profitEdge = ROUTE_GRAPH["CRIME"].find((e) => e.neighborToken === "PROFIT");
    expect(profitEdge!.direction).toBe("vaultConvert");
    expect(profitEdge!.poolLabel).toBe("CRIME/Vault");
  });

  it("PROFIT has edges to CRIME and FRAUD (vaultConvert)", () => {
    const neighbors = ROUTE_GRAPH["PROFIT"].map((e) => e.neighborToken);
    expect(neighbors).toContain("CRIME");
    expect(neighbors).toContain("FRAUD");
    expect(neighbors).toHaveLength(2);

    for (const edge of ROUTE_GRAPH["PROFIT"]) {
      expect(edge.direction).toBe("vaultConvert");
    }

    const crimeEdge = ROUTE_GRAPH["PROFIT"].find((e) => e.neighborToken === "CRIME");
    expect(crimeEdge!.poolLabel).toBe("CRIME/Vault");

    const fraudEdge = ROUTE_GRAPH["PROFIT"].find((e) => e.neighborToken === "FRAUD");
    expect(fraudEdge!.poolLabel).toBe("FRAUD/Vault");
  });
});
