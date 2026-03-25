/**
 * Client-Side Staking Reward Calculation
 *
 * Mirrors the on-chain update_rewards() function from programs/staking/src/helpers/math.rs.
 * Uses BigInt arithmetic throughout to prevent precision loss on u128 fields.
 *
 * The on-chain Synthetix/Quarry cumulative reward-per-token pattern works as follows:
 * 1. When tax is collected, SOL goes to the escrow vault
 * 2. update_cumulative() is called at epoch boundaries to distribute pending_rewards
 *    into the cumulative rewards_per_token_stored (scaled by PRECISION = 1e18)
 * 3. Each user tracks their last checkpoint (rewards_per_token_paid) and accumulated
 *    rewards_earned (in lamports)
 * 4. On any user action (stake/unstake/claim), the delta is computed and added to
 *    their rewards_earned
 *
 * This file provides the same calculation client-side for display purposes.
 *
 * Source: programs/staking/src/helpers/math.rs
 */

// =============================================================================
// Constants (exported for hook use)
// =============================================================================

/**
 * Precision multiplier for reward-per-token calculations.
 * Matches on-chain PRECISION in programs/staking/src/constants.rs.
 * 1e18 provides sufficient precision for u128 cumulative tracking.
 */
export const PRECISION = BigInt("1000000000000000000"); // 1e18

/** All three meme tokens (CRIME, FRAUD, PROFIT) use 6 decimals */
export const PROFIT_DECIMALS = 6;

/** Lamports per SOL */
export const LAMPORTS_PER_SOL = 1_000_000_000;

// =============================================================================
// Pending Reward Calculation
// =============================================================================

/**
 * Calculate pending SOL rewards for a staker.
 *
 * This mirrors the on-chain update_rewards() logic:
 *   delta = pool.rewards_per_token_stored - user.rewards_per_token_paid
 *   new_pending = (user.staked_balance * delta) / PRECISION
 *   total_pending = user.rewards_earned + new_pending
 *
 * CRITICAL: All parameters are BigInt because rewards_per_token_stored
 * and rewards_per_token_paid are u128 on-chain. JavaScript Number cannot
 * represent these accurately (max safe integer is 2^53 - 1, while u128
 * can be up to 2^128 - 1).
 *
 * The caller (useStaking hook) must convert Anchor BN to BigInt before
 * calling this function. Example: BigInt(bn.toString())
 *
 * @param poolRewardsPerTokenStored - StakePool.rewardsPerTokenStored (u128 as BigInt)
 * @param userRewardsPerTokenPaid - UserStake.rewardsPerTokenPaid (u128 as BigInt)
 * @param userStakedBalance - UserStake.stakedBalance (u64 as BigInt)
 * @param userRewardsEarned - UserStake.rewardsEarned (u64 as BigInt)
 * @returns Pending reward in lamports (safe for Number: individual rewards << MAX_SAFE_INTEGER)
 */
export function calculatePendingRewards(
  poolRewardsPerTokenStored: bigint,
  userRewardsPerTokenPaid: bigint,
  userStakedBalance: bigint,
  userRewardsEarned: bigint,
): number {
  // Step 1: Reward delta since user's last checkpoint
  const delta = poolRewardsPerTokenStored - userRewardsPerTokenPaid;

  // Step 2: New pending from this delta (PRECISION-scaled division)
  const newPending = (userStakedBalance * delta) / PRECISION;

  // Step 3: Total = already-accrued + newly-calculated
  const totalPending = userRewardsEarned + newPending;

  // Convert to lamports -- safe for Number because individual staker rewards
  // are bounded well below Number.MAX_SAFE_INTEGER (2^53 - 1 = ~9e15 lamports).
  // Note: total SOL supply (~5e17 lamports) exceeds MAX_SAFE_INTEGER, but a single
  // staker's accumulated rewards will never approach total supply.
  return Number(totalPending);
}

// =============================================================================
// Reward Rate Statistics
// =============================================================================

/** Reward rate statistics for display */
export interface RewardRateStats {
  /** SOL per epoch in lamports (from pendingRewards) */
  perEpochLamports: number;
  /** Annualized percentage (requires SOL/PROFIT price ratio)
   * DEAD CODE — APR/APY will never be displayed (legal reasons). Retained for
   * type stability. Phase 4 DBS — vault replaces PROFIT pools, no market price. */
  annualizedPct: number;
  /** Total PROFIT staked in display units (6 decimals) */
  totalStakedProfit: number;
  /** User's share of total staking pool (0-100) */
  userSharePct: number;
}

/**
 * Approximate epoch duration in seconds on devnet.
 * ~100 slots * 0.4s/slot = 40 seconds.
 * Production will be longer (~30 minutes at 4,500 slots).
 */
const EPOCH_DURATION_SECONDS = 40;

/** Seconds per year for annualization */
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

/** Approximate epochs per year on devnet */
const EPOCHS_PER_YEAR = SECONDS_PER_YEAR / EPOCH_DURATION_SECONDS;

/**
 * Calculate reward rate statistics.
 *
 * For v1, uses pending_rewards as a proxy for "this epoch's reward deposit".
 * This is accurate between update_cumulative calls but resets to 0
 * immediately after finalization (when pending is moved to cumulative).
 *
 * Annualized percentage calculation:
 * - Annual rewards = perEpochReward * epochsPerYear
 * - Total staked value in SOL = totalStakedBaseUnits * solPricePerProfit / 10^6
 * - APR = (annualRewards / totalStakedInSol) * 100
 *
 * If solPricePerProfit is not available (e.g., pool prices not loaded),
 * annualizedPct defaults to 0 and the UI should hide the APR line.
 *
 * @param pendingRewardsLamports - StakePool.pendingRewards (current epoch's SOL)
 * @param totalStakedBaseUnits - StakePool.totalStaked (PROFIT base units, 6 dec)
 * @param userStakedBaseUnits - UserStake.stakedBalance (PROFIT base units, 6 dec)
 * @param solPricePerProfit - DEAD CODE — no market-derived SOL/PROFIT price exists
 *   after vault replacement. Always pass undefined. Retained for API stability.
 * @returns Reward rate statistics for display
 */
export function calculateRewardRate(
  pendingRewardsLamports: number,
  totalStakedBaseUnits: number,
  userStakedBaseUnits: number,
  solPricePerProfit?: number,
): RewardRateStats {
  const totalStakedProfit = totalStakedBaseUnits / 10 ** PROFIT_DECIMALS;
  const userSharePct = totalStakedBaseUnits > 0
    ? (userStakedBaseUnits / totalStakedBaseUnits) * 100
    : 0;

  // Annualized APR: requires knowing the SOL value of staked PROFIT
  // to express rewards as a percentage of staked value.
  let annualizedPct = 0;
  if (totalStakedBaseUnits > 0 && pendingRewardsLamports > 0 && solPricePerProfit) {
    // Total staked PROFIT expressed in SOL
    const totalStakedInSol = totalStakedBaseUnits * solPricePerProfit / 10 ** PROFIT_DECIMALS;
    // Annual rewards in SOL (lamports -> SOL, then multiply by epochs/year)
    const annualRewardsInSol = (pendingRewardsLamports / LAMPORTS_PER_SOL) * EPOCHS_PER_YEAR;
    annualizedPct = (annualRewardsInSol / totalStakedInSol) * 100;
  }

  return {
    perEpochLamports: pendingRewardsLamports,
    annualizedPct,
    totalStakedProfit,
    userSharePct,
  };
}
