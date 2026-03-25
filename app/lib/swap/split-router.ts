/**
 * Split Router: Optimal Split Calculation for 2-Path Parallel Routing
 *
 * When a user swaps between tokens that have two parallel multi-hop paths
 * (e.g., SOL->CRIME->PROFIT and SOL->FRAUD->PROFIT), it may be beneficial
 * to split the input across both paths to reduce price impact.
 *
 * This module provides computeOptimalSplit, which uses a 1% granularity
 * grid search (100 iterations, <1ms) to find the split ratio that maximizes
 * aggregate output. Split is only recommended when it produces >= 0.5%
 * more output than the best single path (SPLIT_THRESHOLD_BPS = 50).
 *
 * The function takes generic quoter callbacks, keeping it decoupled from
 * specific pool topology. Callers compose quoters from quote-engine primitives
 * (e.g., chaining quoteSolBuy + quoteProfitBuy for a SOL->CRIME->PROFIT path).
 *
 * Pure function -- no RPC calls, no React, no side effects.
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum improvement in basis points for a split to be recommended.
 * 50 bps = 0.5% -- below this threshold, the single best path is used
 * to avoid unnecessary transaction complexity (multi-TX signing).
 */
export const SPLIT_THRESHOLD_BPS = 50;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of the split optimization calculation.
 */
export interface SplitResult {
  /** True if split beats best single path by >= SPLIT_THRESHOLD_BPS */
  shouldSplit: boolean;
  /** Percentage of totalInput routed through path A (0-100) */
  splitRatioA: number;
  /** Percentage of totalInput routed through path B (0-100) */
  splitRatioB: number;
  /** Total output from the optimal split (or best single path if !shouldSplit) */
  splitOutput: number;
  /** Best single-path output for comparison */
  bestSingleOutput: number;
  /** Basis points improvement of split over best single path */
  improvementBps: number;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Find the input split ratio across two parallel paths that maximizes
 * total output.
 *
 * Algorithm:
 * 1. Compute output for 100% through path A and 100% through path B
 * 2. bestSingleOutput = max(pathA-only, pathB-only)
 * 3. Grid search: for ratioA in [1..99] by 1%, compute total output
 * 4. Compare best split output vs bestSingleOutput
 * 5. shouldSplit = improvement >= SPLIT_THRESHOLD_BPS
 *
 * The grid search runs 99 iterations with simple arithmetic -- completes
 * in microseconds on modern hardware.
 *
 * @param totalInput - Total input amount in base units (lamports or token units)
 * @param pathAQuoter - Callback that returns output for a given input through path A
 * @param pathBQuoter - Callback that returns output for a given input through path B
 * @returns SplitResult with optimal ratio and comparison metrics
 */
export function computeOptimalSplit(
  totalInput: number,
  pathAQuoter: (input: number) => number,
  pathBQuoter: (input: number) => number,
): SplitResult {
  // Guard: zero or negative input
  if (totalInput <= 0) {
    return {
      shouldSplit: false,
      splitRatioA: 100,
      splitRatioB: 0,
      splitOutput: 0,
      bestSingleOutput: 0,
      improvementBps: 0,
    };
  }

  // Step 1-2: Compute single-path outputs
  const outputA = pathAQuoter(totalInput);
  const outputB = pathBQuoter(totalInput);
  const bestSingleOutput = Math.max(outputA, outputB);

  // Step 3: Grid search for optimal split ratio
  // Test ratioA from 1% to 99% in 1% increments
  let bestSplitOutput = 0;
  let bestRatioA = outputA >= outputB ? 100 : 0; // Default: all through better path

  for (let ratioA = 1; ratioA <= 99; ratioA++) {
    const inputA = Math.floor(totalInput * ratioA / 100);
    const inputB = totalInput - inputA;

    // Skip if either side would receive zero
    if (inputA <= 0 || inputB <= 0) continue;

    const totalOutput = pathAQuoter(inputA) + pathBQuoter(inputB);

    if (totalOutput > bestSplitOutput) {
      bestSplitOutput = totalOutput;
      bestRatioA = ratioA;
    }
  }

  // Step 4-5: Compare split vs single path
  // If bestSingleOutput is 0, no improvement is possible
  const improvementBps = bestSingleOutput > 0
    ? Math.floor((bestSplitOutput - bestSingleOutput) / bestSingleOutput * 10_000)
    : 0;

  const shouldSplit = improvementBps >= SPLIT_THRESHOLD_BPS;

  // If split is not recommended, return the best single path ratio
  if (!shouldSplit) {
    return {
      shouldSplit: false,
      splitRatioA: outputA >= outputB ? 100 : 0,
      splitRatioB: outputA >= outputB ? 0 : 100,
      splitOutput: bestSingleOutput,
      bestSingleOutput,
      improvementBps: Math.max(0, improvementBps),
    };
  }

  return {
    shouldSplit: true,
    splitRatioA: bestRatioA,
    splitRatioB: 100 - bestRatioA,
    splitOutput: bestSplitOutput,
    bestSingleOutput,
    improvementBps,
  };
}
