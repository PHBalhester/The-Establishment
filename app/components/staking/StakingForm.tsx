"use client";

/**
 * StakingForm -- Top-level staking form container (sole hook consumer)
 *
 * Calls useStaking() and passes data as props to all children.
 * Follows the same pattern as SwapForm.tsx.
 *
 * Layout:
 * - StakingStats (always visible, above form)
 * - Tab buttons: [Stake] [Unstake] [Claim]
 * - Active tab content (StakeTab / UnstakeTab / ClaimTab)
 * - StakingStatus (action button / status / result)
 */

import { useEffect, useRef } from "react";
import { useStaking } from "@/hooks/useStaking";
import { useToast } from "@/components/toast/ToastProvider";
import { solscanTxUrl } from "@/lib/solscan";
import { Tabs, TabList, Tab, TabPanel, Divider } from "@/components/kit";
import { StakingStats } from "./StakingStats";
import { StakeTab } from "./StakeTab";
import { UnstakeTab } from "./UnstakeTab";
import { ClaimTab } from "./ClaimTab";
import { StakingStatus, buildSuccessMessage } from "./StakingStatus";

import type { StakingAction, StakingStatus as StakingStatusType } from "@/hooks/useStaking";

// =============================================================================
// Tab Configuration
// =============================================================================

const TABS: { key: StakingAction; label: string }[] = [
  { key: "stake", label: "Stake" },
  { key: "unstake", label: "Unstake" },
  { key: "claim", label: "Claim" },
];

// =============================================================================
// Component
// =============================================================================

export function StakingForm() {
  const staking = useStaking();

  // Whether the form is in a transacting state
  const isTransacting =
    staking.status !== "idle" &&
    staking.status !== "confirmed" &&
    staking.status !== "failed";

  // Determine if the action button should be disabled per tab
  let actionDisabled = isTransacting;
  if (!actionDisabled) {
    switch (staking.activeTab) {
      case "stake":
        actionDisabled = !staking.amount || parseFloat(staking.amount) <= 0;
        break;
      case "unstake":
        actionDisabled =
          !staking.amount ||
          parseFloat(staking.amount) <= 0 ||
          !staking.userStakeData ||
          staking.isCooldownActive;
        break;
      case "claim":
        actionDisabled =
          staking.pendingRewards <= 0 ||
          !staking.userStakeData;
        break;
    }
  }

  // Derive display values for unstake tab
  const stakedBalanceDisplay = staking.userStakeData
    ? staking.userStakeData.stakedBalance / 1e6
    : 0;

  // ── Toast notifications: fire on status transitions ─────────────────
  const { showToast } = useToast();
  const prevStatusRef = useRef<StakingStatusType>(staking.status);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = staking.status;

    // Only fire toast when status CHANGES to confirmed/failed
    if (prev === staking.status) return;

    if (staking.status === "confirmed" && staking.lastResult) {
      showToast(
        "success",
        buildSuccessMessage(staking.lastResult),
        staking.txSignature
          ? { label: "View on Solscan", href: solscanTxUrl(staking.txSignature) }
          : undefined,
      );
      staking.resetForm();
    } else if (staking.status === "failed") {
      showToast("error", staking.errorMessage || "Staking operation failed");
      staking.resetForm();
    }
  }, [staking.status, staking.txSignature, staking.errorMessage, staking.lastResult, showToast, staking.resetForm]);

  return (
    <div className="max-w-md mx-auto">
      {/* Stats section with header */}
      <h2 className="kit-card-header">Rewards</h2>
      <StakingStats
        rewardRate={staking.rewardRate}
        pendingRewards={staking.pendingRewards}
        userStakedBalance={staking.userStakeData?.stakedBalance ?? 0}
        userTotalClaimed={staking.userStakeData?.totalClaimed ?? 0}
        protocolTotalDistributed={staking.stakePoolData?.totalDistributed ?? 0}
        protocolTotalClaimed={staking.stakePoolData?.totalClaimed ?? 0}
        loading={staking.dataLoading}
        isEligibleToUnstake={staking.isEligibleToUnstake}
        isCooldownActive={staking.isCooldownActive}
        cooldownRemainingMs={staking.cooldownRemainingMs}
        hasActiveStake={!!staking.userStakeData && staking.userStakeData.stakedBalance > 0}
        unlockedProfit={staking.globalStats?.unlockedProfit ?? null}
        lockedProfit={staking.globalStats?.lockedProfit ?? null}
        globalStatsLoading={staking.globalStatsLoading}
      />

      <Divider className="my-4" />

      {/* Tabbed form -- kit Tabs compound component */}
      <div>
        <Tabs value={staking.activeTab} onChange={(v) => staking.setActiveTab(v as StakingAction)}>
          <TabList>
            {TABS.map((tab) => (
              <Tab key={tab.key} value={tab.key} disabled={isTransacting}>
                {tab.label}
              </Tab>
            ))}
          </TabList>

          <div className="py-4">
            {/* min-h keeps modal height stable across all tabs */}
            <div className="min-h-[120px]">
              <TabPanel value="stake">
                <StakeTab
                  amount={staking.amount}
                  setAmount={staking.setAmount}
                  profitBalance={staking.profitBalance}
                  disabled={isTransacting}
                  isFirstStake={!staking.userStakeData}
                />
              </TabPanel>

              <TabPanel value="unstake">
                <UnstakeTab
                  amount={staking.amount}
                  setAmount={staking.setAmount}
                  stakedBalance={stakedBalanceDisplay}
                  pendingRewards={staking.pendingRewards}
                  minimumStakeWarning={staking.minimumStakeWarning}
                  disabled={isTransacting}
                  isCooldownActive={staking.isCooldownActive}
                  cooldownRemainingMs={staking.cooldownRemainingMs}
                />
              </TabPanel>

              <TabPanel value="claim">
                <ClaimTab
                  pendingRewards={staking.pendingRewards}
                  userTotalClaimed={staking.userStakeData?.totalClaimed ?? 0}
                  perEpochLamports={staking.rewardRate?.perEpochLamports ?? 0}
                  userSharePct={staking.rewardRate?.userSharePct ?? 0}
                  disabled={isTransacting}
                  isCooldownActive={staking.isCooldownActive}
                  cooldownRemainingMs={staking.cooldownRemainingMs}
                />
              </TabPanel>
            </div>

            {/* Action button / status */}
            <StakingStatus
              status={staking.status}
              onExecute={staking.execute}
              disabled={actionDisabled}
              connected={staking.connected}
              activeTab={staking.activeTab}
            />
          </div>
        </Tabs>
      </div>
    </div>
  );
}
