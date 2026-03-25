"use client";

/**
 * ClaimTab -- One-click SOL reward claim display
 *
 * Shows:
 * - Large pending rewards display (X.XXXXXX SOL)
 * - "No rewards to claim" when pendingRewards === 0
 *
 * Detail stats (lifetime claimed, pool share, reward rate) are shown
 * in StakingStats above, so no expandable section needed here.
 *
 * Props-only component (no hooks). Receives data from StakingForm.
 */

// =============================================================================
// Props
// =============================================================================

interface ClaimTabProps {
  /** Client-calculated pending rewards in SOL lamports */
  pendingRewards: number;
  /** User's lifetime claimed SOL in lamports */
  userTotalClaimed: number;
  /** SOL per epoch in lamports */
  perEpochLamports: number;
  /** User's pool share percentage (0-100) */
  userSharePct: number;
  /** True when a transaction is in progress */
  disabled: boolean;
  /** Whether the unstake cooldown is currently active */
  isCooldownActive: boolean;
  /** Milliseconds remaining in the cooldown period */
  cooldownRemainingMs: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Format SOL lamports to display string */
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

// =============================================================================
// Component
// =============================================================================

export function ClaimTab({
  pendingRewards,
  isCooldownActive,
  cooldownRemainingMs,
}: ClaimTabProps) {
  const hasRewards = pendingRewards > 0;

  return (
    <div className="space-y-3">
      {/* Large reward display (plain div on parchment) */}
      <div className="text-center py-3">
        <span className="text-xs text-factory-text-secondary uppercase tracking-wide block mb-2">
          Available to claim
        </span>
        <span className={`text-3xl font-bold ${hasRewards ? "text-factory-success" : "text-factory-text-secondary"}`}>
          {formatSol(pendingRewards)} SOL
        </span>
        {!hasRewards && (
          <p className="text-xs text-factory-text-secondary mt-2">No rewards to claim</p>
        )}
      </div>

      {/* Pre-claim cooldown warning (always visible) */}
      <div className="bg-factory-warning-surface border border-factory-warning-border rounded-lg px-3 py-2">
        <p className="text-xs text-factory-warning-text">
          Claiming starts a 12h unstake cooldown. You will not be able to unstake for 12 hours after claiming.
        </p>
      </div>

      {/* Post-claim countdown (only when cooldown is active) */}
      {isCooldownActive && (
        <p className="text-xs text-factory-text-secondary">
          Unstake available in {formatCountdown(cooldownRemainingMs)}
        </p>
      )}
    </div>
  );
}
