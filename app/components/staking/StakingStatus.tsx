"use client";

/**
 * StakingStatus -- BigRedButton action button + transaction status
 *
 * Renders UI based on the staking lifecycle:
 * - idle: BigRedButton (interactive)
 * - building/signing/sending/confirming: BigRedButton (pulsing) + status text
 * - not connected: "Connect wallet to stake" text
 *
 * Confirmed/failed states are handled by toast notifications (fired in StakingForm).
 * The form auto-resets to idle after the toast fires.
 *
 * Props-only component (no hooks). Receives status data from StakingForm.
 */

import { BigRedButton } from "@/components/station/BigRedButton";
import type { StakingStatus as StakingStatusType, StakingAction, StakingResult } from "@/hooks/useStaking";

// =============================================================================
// Props
// =============================================================================

interface StakingStatusProps {
  /** Current staking lifecycle status */
  status: StakingStatusType;
  /** Execute staking action callback */
  onExecute: () => void;
  /** Whether the action button should be disabled */
  disabled: boolean;
  /** Whether a wallet is connected */
  connected: boolean;
  /** Current active tab (determines status text) */
  activeTab: StakingAction;
}

// =============================================================================
// Helpers
// =============================================================================

const STATUS_TEXT: Record<string, string> = {
  building: "Preparing transaction...",
  signing: "Sign in your wallet...",
  sending: "Sending transaction...",
  confirming: "Confirming on Solana...",
};

/** Format PROFIT base units to display string */
function formatProfit(baseUnits: number): string {
  const value = baseUnits / 1e6;
  return value.toFixed(4).replace(/\.?0+$/, "");
}

/** Format SOL lamports to display string */
function formatSol(lamports: number): string {
  const value = lamports / 1e9;
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * Build the success message based on the staking result.
 * Exported for reuse in StakingForm toast notifications.
 */
export function buildSuccessMessage(result: StakingResult): string {
  switch (result.action) {
    case "stake":
      return `Staked ${formatProfit(result.stakedAmount ?? 0)} PROFIT`;
    case "unstake": {
      const profitMsg = `Unstaked ${formatProfit(result.unstakedAmount ?? 0)} PROFIT`;
      const solMsg = result.forfeitedAmount && result.forfeitedAmount > 0
        ? ` (forfeited ${formatSol(result.forfeitedAmount)} SOL to pool)`
        : "";
      return profitMsg + solMsg;
    }
    case "claim":
      return `Claimed ${formatSol(result.claimedAmount ?? 0)} SOL rewards`;
  }
}

// =============================================================================
// Component
// =============================================================================

export function StakingStatus({
  status,
  onExecute,
  disabled,
  connected,
}: StakingStatusProps) {
  // Not connected: show connect wallet prompt (plain div on parchment)
  if (!connected) {
    return (
      <div className="mt-4">
        <div className="w-full py-3 text-center text-sm font-medium text-factory-text-secondary">
          Connect wallet to stake
        </div>
      </div>
    );
  }

  // Whether a transaction is in-flight
  const isTransacting =
    status === "building" ||
    status === "signing" ||
    status === "sending" ||
    status === "confirming";

  return (
    <div className="mt-4">
      {/* BigRedButton -- always rendered when connected (never unmount) */}
      <BigRedButton
        status={status}
        disabled={disabled}
        onSwap={onExecute}
        onReset={() => {}}
        txSignature={null}
        errorMessage={null}
        connected={connected}
      />

      {/* Status text below button during transaction */}
      {isTransacting && (
        <p className="text-center text-sm font-medium text-factory-text mt-2">
          {STATUS_TEXT[status] ?? "Processing..."}
        </p>
      )}
    </div>
  );
}
