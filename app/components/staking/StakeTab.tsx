"use client";

/**
 * StakeTab -- Amount input for staking PROFIT tokens
 *
 * Shows:
 * - Amount input (decimal, max 6 places) inside kit Frame (recessed gauge)
 * - PROFIT balance display with kit Button "Max"
 * - First-stake note about SOL rent fee
 *
 * Props-only component (no hooks). Receives data from StakingForm.
 */

import { Frame, Button } from "@/components/kit";

// =============================================================================
// Props
// =============================================================================

interface StakeTabProps {
  /** User-entered amount string */
  amount: string;
  /** Amount setter */
  setAmount: (val: string) => void;
  /** PROFIT balance in display units (e.g., 500.123456) */
  profitBalance: number;
  /** True when a transaction is in progress */
  disabled: boolean;
  /** True if user has never staked (show first-stake note) */
  isFirstStake: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Format balance for display (max 6 decimal places, trim trailing zeros) */
function formatBalance(value: number): string {
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

export function StakeTab({
  amount,
  setAmount,
  profitBalance,
  disabled,
  isFirstStake,
}: StakeTabProps) {
  return (
    <div className="space-y-3">
      {/* Amount input -- kit Frame (recessed gauge styling) */}
      <Frame mode="css" padding="sm">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-factory-text font-medium">PROFIT</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-factory-text-secondary">
              Balance: {formatBalance(profitBalance)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || profitBalance <= 0}
              onClick={() => setAmount(profitBalance.toString())}
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

      {/* First stake note */}
      {isFirstStake && (
        <p className="text-xs text-factory-text-secondary">
          First stake creates your account (small SOL rent fee)
        </p>
      )}
    </div>
  );
}
