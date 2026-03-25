"use client";

/**
 * StakingStats -- Reward rate, pool share, and protocol stats display
 *
 * Compact card displayed above the tabbed staking form.
 * Shows both personal staking data and protocol-wide statistics.
 *
 * Layout (2-column grid on md+ screens):
 * - Your Stake: X.XX PROFIT
 * - Pending Rewards: X.XXXXXX SOL
 * - Your Share: X.X% of pool
 * - Reward Rate: X.XXXXXX SOL/epoch ~X.X% annualized
 * - Total Staked: X.XX PROFIT (protocol-wide)
 * - Lifetime Claimed: X.XXXXXX SOL (user)
 *
 * Props-only component (no hooks). Receives data from StakingForm.
 */

import type { RewardRateStats } from "@/lib/staking/rewards";

// =============================================================================
// Props
// =============================================================================

interface StakingStatsProps {
  /** Reward rate statistics (null while loading) */
  rewardRate: RewardRateStats | null;
  /** Client-calculated pending rewards in SOL lamports */
  pendingRewards: number;
  /** User's currently staked PROFIT balance in base units */
  userStakedBalance: number;
  /** User's lifetime claimed SOL in lamports */
  userTotalClaimed: number;
  /** Protocol-wide total SOL distributed in lamports */
  protocolTotalDistributed: number;
  /** Protocol-wide total SOL claimed in lamports */
  protocolTotalClaimed: number;
  /** True while staking data is loading */
  loading: boolean;
  /** Whether the current user is eligible to unstake */
  isEligibleToUnstake: boolean;
  /** Whether the unstake cooldown is currently active */
  isCooldownActive: boolean;
  /** Milliseconds remaining in the cooldown period */
  cooldownRemainingMs: number;
  /** Whether the user has an active stake (controls badge visibility) */
  hasActiveStake: boolean;
  /** Protocol-wide unlocked PROFIT in base units (null while loading) */
  unlockedProfit: number | null;
  /** Protocol-wide locked PROFIT in base units (null while loading) */
  lockedProfit: number | null;
  /** True while global stats are loading */
  globalStatsLoading: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Format PROFIT base units (6 decimals) to display string */
function formatProfit(baseUnits: number): string {
  const value = baseUnits / 1e6;
  if (value === 0) return "0";
  if (value < 0.01) return value.toFixed(6).replace(/\.?0+$/, "");
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/** Format SOL lamports (9 decimals) to display string */
function formatSol(lamports: number): string {
  const value = lamports / 1e9;
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/** Format countdown milliseconds to "Xh Ym" or "Xs" */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.ceil((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Format percentage to display string */
function formatPct(pct: number): string {
  if (pct === 0) return "0";
  if (pct < 0.01) return "<0.01";
  if (pct < 1) return pct.toFixed(2);
  return pct.toFixed(1);
}

// =============================================================================
// Stat Item Component
// =============================================================================

function StatItem({
  label,
  value,
  subValue,
  loading,
}: {
  label: string;
  value: string;
  subValue?: string;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-factory-text-secondary uppercase tracking-wide">{label}</span>
      {loading ? (
        <span className="text-sm text-factory-text-secondary animate-pulse">Loading...</span>
      ) : (
        <>
          <span className="text-sm font-medium text-factory-text">{value}</span>
          {subValue && (
            <span className="text-xs text-factory-text-secondary">{subValue}</span>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function StakingStats({
  rewardRate,
  pendingRewards,
  userStakedBalance,
  userTotalClaimed,
  protocolTotalDistributed,
  protocolTotalClaimed,
  loading,
  isEligibleToUnstake,
  isCooldownActive,
  cooldownRemainingMs,
  hasActiveStake,
  unlockedProfit,
  lockedProfit,
  globalStatsLoading,
}: StakingStatsProps) {
  const hasUserStake = userStakedBalance > 0;

  return (
    <div className="mb-3">
      {/* Eligibility badge -- only shown when user has an active stake */}
      {hasActiveStake && (
        <div className="flex justify-center mb-3">
          {!isCooldownActive ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Eligible to Unstake
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Cooldown: {formatCountdown(cooldownRemainingMs)}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {/* Your Stake */}
        <StatItem
          label="Your Stake"
          value={hasUserStake ? `${formatProfit(userStakedBalance)} PROFIT` : "No active stake"}
          loading={loading}
        />

        {/* Pending Rewards */}
        <StatItem
          label="Pending Rewards"
          value={`${formatSol(pendingRewards)} SOL`}
          loading={loading}
        />

        {/* Your Share */}
        <StatItem
          label="Your Share"
          value={
            rewardRate && rewardRate.userSharePct > 0
              ? `${formatPct(rewardRate.userSharePct)}% of pool`
              : "--"
          }
          loading={loading}
        />

        {/* Reward Rate */}
        <StatItem
          label="Reward Rate"
          value={
            rewardRate && rewardRate.perEpochLamports > 0
              ? `${formatSol(rewardRate.perEpochLamports)} SOL/epoch`
              : "0 SOL/epoch"
          }
          loading={loading}
        />

        {/* Total Staked (protocol-wide) */}
        <StatItem
          label="Total Staked"
          value={
            rewardRate
              ? `${formatProfit(rewardRate.totalStakedProfit * 1e6)} PROFIT`
              : "0 PROFIT"
          }
          loading={loading}
        />

        {/* Lifetime Claimed (user) */}
        <StatItem
          label="Lifetime Claimed"
          value={hasUserStake ? `${formatSol(userTotalClaimed)} SOL` : "--"}
          loading={loading}
        />

        {/* Unlocked PROFIT (protocol-wide) */}
        <StatItem
          label="Unlocked PROFIT"
          value={unlockedProfit !== null ? `${formatProfit(unlockedProfit)} PROFIT` : "--"}
          loading={globalStatsLoading}
        />

        {/* Locked PROFIT (protocol-wide) */}
        <StatItem
          label="Locked PROFIT"
          value={lockedProfit !== null ? `${formatProfit(lockedProfit)} PROFIT` : "--"}
          loading={globalStatsLoading}
        />
      </div>
    </div>
  );
}
