"use client";

/**
 * UnstakeTab -- Amount input for unstaking PROFIT tokens
 *
 * Shows:
 * - Amount input (decimal, max 6 places) inside kit Frame (recessed gauge)
 * - Staked balance display with kit Button "Max"
 * - Minimum stake warning (amber) when remaining would be below 1 PROFIT
 * - Forfeiture warning when pending rewards exist (rewards lost on unstake)
 *
 * Note: Cooldown display moved to StakingStats eligibility badge (single source of truth).
 *
 * Props-only component (no hooks). Receives data from StakingForm.
 */

import { Frame, Button } from "@/components/kit";

// =============================================================================
// Props
// =============================================================================

interface UnstakeTabProps {
  /** User-entered amount string */
  amount: string;
  /** Amount setter */
  setAmount: (val: string) => void;
  /** Currently staked PROFIT balance in display units */
  stakedBalance: number;
  /** Pending SOL rewards in lamports (will be forfeited on unstake) */
  pendingRewards: number;
  /** True if remaining balance would be below MINIMUM_STAKE */
  minimumStakeWarning: boolean;
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

/** Format PROFIT display units */
function formatProfit(value: number): string {
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/** Format SOL lamports to display string */
function formatSol(lamports: number): string {
  const value = lamports / 1e9;
  if (value === 0) return "0";
  if (value < 0.000001) return "<0.000001";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * Validate decimal input: allow digits, single decimal point,
 * and limit to 6 decimal places (PROFIT has 6 decimals).
 */
function isValidDecimalInput(value: string): boolean {
  if (value === "") return true;
  if (!/^\d*\.?\d*$/.test(value)) return false;
  const parts = value.split(".");
  if (parts.length === 2 && parts[1].length > 6) return false;
  return true;
}

// =============================================================================
// Component
// =============================================================================

export function UnstakeTab({
  amount,
  setAmount,
  stakedBalance,
  pendingRewards,
  minimumStakeWarning,
  disabled,
  isCooldownActive,
  cooldownRemainingMs,
}: UnstakeTabProps) {
  return (
    <div className="space-y-3">
      {/* Amount input -- kit Frame (recessed gauge styling) */}
      <Frame mode="css" padding="sm">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-factory-text font-medium">PROFIT</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-factory-text-secondary">
              Staked: {formatProfit(stakedBalance)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || stakedBalance <= 0}
              onClick={() => setAmount(stakedBalance.toString())}
            >
              Max
            </Button>
          </div>
        </div>

        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={amount}
          disabled={disabled}
          onChange={(e) => {
            const val = e.target.value;
            if (isValidDecimalInput(val)) {
              setAmount(val);
            }
          }}
          className={
            "w-full bg-transparent text-2xl text-factory-text font-medium " +
            "outline-none placeholder-factory-text-muted disabled:opacity-50"
          }
        />
      </Frame>

      {/* Minimum stake warning */}
      {minimumStakeWarning && (
        <div className="bg-factory-warning-surface border border-factory-warning-border rounded-lg px-3 py-2">
          <p className="text-xs text-factory-warning-text">
            Remaining balance would be below minimum (1 PROFIT). Your full balance will be unstaked.
          </p>
        </div>
      )}

      {/* Forfeiture warning (only when not in cooldown and rewards exist) */}
      {!isCooldownActive && pendingRewards > 0 && (
        <div className="bg-factory-warning-surface border border-factory-warning-border rounded-lg px-3 py-2">
          <p className="text-xs text-factory-warning-text">
            Unstaking will forfeit {formatSol(pendingRewards)} SOL in unclaimed rewards. These will be redistributed to remaining stakers.
          </p>
          <p className="text-xs text-factory-text-secondary mt-1">
            Claim your rewards first if you want to keep them (12h cooldown applies).
          </p>
        </div>
      )}
    </div>
  );
}
