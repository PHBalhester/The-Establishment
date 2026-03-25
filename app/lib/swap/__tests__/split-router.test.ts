/**
 * Split Router Unit Tests
 *
 * Tests the pure split-routing optimizer: computeOptimalSplit finds the
 * input split ratio across two parallel paths that maximizes total output.
 *
 * Uses mock quoter callbacks that simulate constant-product AMM behavior
 * (output = reserveOut * input / (reserveIn + input)) to verify split
 * optimization logic without any RPC or on-chain dependencies.
 *
 * Test cases:
 * 1. Equal pools, small input -> shouldSplit=false (negligible price impact benefit)
 * 2. Equal pools, LARGE input (50% of one pool's reserve) -> shouldSplit=true, ~50/50 split
 * 3. Asymmetric pools (one has 10x more liquidity) -> shouldSplit=true, skewed ratio
 * 4. Zero input -> shouldSplit=false, splitOutput=0
 * 5. One pool has zero reserves -> shouldSplit=false, all through the other pool
 */

import { describe, it, expect } from "vitest";
import { computeOptimalSplit, SPLIT_THRESHOLD_BPS } from "../split-router";

// =============================================================================
// Mock AMM Quoter Factory
// =============================================================================

/**
 * Creates a mock constant-product AMM quoter callback.
 *
 * Simulates: output = floor(reserveOut * input / (reserveIn + input))
 * This is the standard xy=k formula without fees, suitable for testing
 * split optimization logic (fees are applied by the caller in production).
 *
 * @param reserveIn - Reserve of the input token
 * @param reserveOut - Reserve of the output token
 * @returns A quoter function: (input: number) => number
 */
function makeConstantProductQuoter(
  reserveIn: number,
  reserveOut: number,
): (input: number) => number {
  return (input: number): number => {
    if (input <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
    return Math.floor((reserveOut * input) / (reserveIn + input));
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("computeOptimalSplit", () => {
  // -------------------------------------------------------------------------
  // Test 1: Equal pools, small input -> no benefit from splitting
  // -------------------------------------------------------------------------
  it("returns shouldSplit=false for small input through equal pools", () => {
    // Two identical pools with 1B reserve each.
    // Input is 1000 units (0.0001% of reserve) -- negligible price impact.
    const quoterA = makeConstantProductQuoter(1_000_000_000, 1_000_000_000);
    const quoterB = makeConstantProductQuoter(1_000_000_000, 1_000_000_000);

    const result = computeOptimalSplit(1_000, quoterA, quoterB);

    expect(result.shouldSplit).toBe(false);
    // bestSingleOutput should be the output of routing 100% through one path
    expect(result.bestSingleOutput).toBeGreaterThan(0);
    // improvementBps should be below threshold (or 0 for identical pools)
    expect(result.improvementBps).toBeLessThan(SPLIT_THRESHOLD_BPS);
  });

  // -------------------------------------------------------------------------
  // Test 2: Equal pools, LARGE input -> splitting beats single path
  // -------------------------------------------------------------------------
  it("returns shouldSplit=true with ~50/50 ratio for large input through equal pools", () => {
    // Two identical pools with 1M reserve each.
    // Input is 500K (50% of one pool's reserve) -- massive price impact on single path.
    const reserveIn = 1_000_000;
    const reserveOut = 1_000_000;
    const quoterA = makeConstantProductQuoter(reserveIn, reserveOut);
    const quoterB = makeConstantProductQuoter(reserveIn, reserveOut);

    const totalInput = 500_000; // 50% of a single pool

    const result = computeOptimalSplit(totalInput, quoterA, quoterB);

    expect(result.shouldSplit).toBe(true);
    // With equal pools and large input, optimal split should be ~50/50
    expect(result.splitRatioA).toBeGreaterThanOrEqual(45);
    expect(result.splitRatioA).toBeLessThanOrEqual(55);
    expect(result.splitRatioB).toBe(100 - result.splitRatioA);
    // Split output should be better than single path
    expect(result.splitOutput).toBeGreaterThan(result.bestSingleOutput);
    expect(result.improvementBps).toBeGreaterThanOrEqual(SPLIT_THRESHOLD_BPS);
  });

  // -------------------------------------------------------------------------
  // Test 3: Asymmetric pools -> splitting with skewed ratio
  // -------------------------------------------------------------------------
  it("returns shouldSplit=true with skewed ratio for asymmetric pools", () => {
    // Pool A: 5M reserve (deep liquidity).
    // Pool B: 500K reserve (shallow liquidity, 10x less).
    // Input is 2M -- 40% of pool A, 400% of pool B -- massive price impact difference.
    // At this scale, splitting clearly outperforms single-path (266 bps improvement).
    const quoterA = makeConstantProductQuoter(5_000_000, 5_000_000); // Deep
    const quoterB = makeConstantProductQuoter(500_000, 500_000);     // Shallow

    const totalInput = 2_000_000;

    const result = computeOptimalSplit(totalInput, quoterA, quoterB);

    expect(result.shouldSplit).toBe(true);
    // More should go through pool A (deeper liquidity) -- expect heavily skewed toward A
    expect(result.splitRatioA).toBeGreaterThan(result.splitRatioB);
    // The skew should be very significant (pool A has 10x more liquidity)
    expect(result.splitRatioA).toBeGreaterThanOrEqual(80);
    // Split output should beat single path
    expect(result.splitOutput).toBeGreaterThan(result.bestSingleOutput);
    expect(result.improvementBps).toBeGreaterThanOrEqual(SPLIT_THRESHOLD_BPS);
  });

  // -------------------------------------------------------------------------
  // Test 4: Zero input -> no split possible
  // -------------------------------------------------------------------------
  it("returns shouldSplit=false with splitOutput=0 for zero input", () => {
    const quoterA = makeConstantProductQuoter(1_000_000, 1_000_000);
    const quoterB = makeConstantProductQuoter(1_000_000, 1_000_000);

    const result = computeOptimalSplit(0, quoterA, quoterB);

    expect(result.shouldSplit).toBe(false);
    expect(result.splitOutput).toBe(0);
    expect(result.bestSingleOutput).toBe(0);
    expect(result.improvementBps).toBe(0);
    expect(result.splitRatioA).toBe(100);
    expect(result.splitRatioB).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: One pool has zero reserves -> all through the other pool
  // -------------------------------------------------------------------------
  it("returns shouldSplit=false when one pool has zero reserves", () => {
    const quoterA = makeConstantProductQuoter(1_000_000, 1_000_000); // Working pool
    const quoterB = makeConstantProductQuoter(0, 0);                  // Empty pool

    const totalInput = 100_000;

    const result = computeOptimalSplit(totalInput, quoterA, quoterB);

    expect(result.shouldSplit).toBe(false);
    // Best single output should be from pool A
    expect(result.bestSingleOutput).toBeGreaterThan(0);
    // Split cannot improve because pool B returns 0 for any input
    expect(result.improvementBps).toBeLessThan(SPLIT_THRESHOLD_BPS);
  });

  // -------------------------------------------------------------------------
  // Additional edge case: SPLIT_THRESHOLD_BPS constant is correct
  // -------------------------------------------------------------------------
  it("exports SPLIT_THRESHOLD_BPS = 50 (0.5%)", () => {
    expect(SPLIT_THRESHOLD_BPS).toBe(50);
  });

  // -------------------------------------------------------------------------
  // Additional edge case: ratioA + ratioB always sum to 100
  // -------------------------------------------------------------------------
  it("always returns splitRatioA + splitRatioB = 100", () => {
    const quoterA = makeConstantProductQuoter(5_000_000, 5_000_000);
    const quoterB = makeConstantProductQuoter(2_000_000, 2_000_000);

    const result = computeOptimalSplit(300_000, quoterA, quoterB);

    expect(result.splitRatioA + result.splitRatioB).toBe(100);
  });
});
