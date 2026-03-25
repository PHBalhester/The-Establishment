"use client";

/**
 * useStaking -- Orchestrates the entire staking lifecycle
 *
 * State machine: idle -> building -> signing -> sending -> confirming -> confirmed/failed
 *
 * Data sources (Phase 6 DBS split):
 * - StakePool: SSE via useProtocolState (shared, singleton PDA — same for all users)
 * - globalStats: SSE via useProtocolState (server-side gPA aggregate, 30s refresh)
 * - UserStake: per-user RPC fetch (per-wallet PDA, visibility-gated, 30s poll)
 *
 * Manages:
 * - Tab state (Stake | Unstake | Claim)
 * - Amount input for stake/unstake (claim has no amount)
 * - Client-side pending reward calculation using BigInt (mirrors on-chain math.rs)
 * - Reward rate statistics (per-epoch, annualized, pool share)
 * - Transaction building via staking-builders.ts
 * - Wallet signing + sending via useProtocolWallet
 * - Transaction submission and confirmation
 * - Error parsing via staking error-map.ts
 * - Minimum stake warning for partial unstake
 * - Auto-reset 10 seconds after confirmed state
 *
 * This hook is consumed by StakingForm.tsx (the sole hook consumer for the staking UI,
 * following the SwapForm pattern of props-only child components).
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useProtocolWallet } from "./useProtocolWallet";
import { useTokenBalances } from "./useTokenBalances";
import { useVisibility } from "./useVisibility";
import { useProtocolState } from "./useProtocolState";
import { getConnection } from "@/lib/connection";
import { getStakingProgram } from "@/lib/anchor";
import {
  buildStakeTransaction,
  buildUnstakeTransaction,
  buildClaimTransaction,
  deriveUserStakePDA,
} from "@/lib/staking/staking-builders";
import { parseStakingError } from "@/lib/staking/error-map";
import { pollTransactionConfirmation } from "@/lib/confirm-transaction";
import {
  calculatePendingRewards,
  calculateRewardRate,
  type RewardRateStats,
} from "@/lib/staking/rewards";
import {
  MINIMUM_STAKE,
  COOLDOWN_SECONDS,
} from "@dr-fraudsworth/shared";

// =============================================================================
// Types
// =============================================================================

/** Staking action corresponding to tabs */
export type StakingAction = "stake" | "unstake" | "claim";

/** Transaction lifecycle states */
export type StakingStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "confirmed"
  | "failed";

/** Result of a staking transaction, for display in the confirmed state */
export interface StakingResult {
  action: StakingAction;
  /** PROFIT unstaked in base units (for unstake success message) */
  unstakedAmount?: number;
  /** SOL forfeited to pool in lamports (for unstake success message) */
  forfeitedAmount?: number;
  /** SOL claimed in lamports (for claim success message) */
  claimedAmount?: number;
  /** PROFIT staked in base units (for stake success message) */
  stakedAmount?: number;
}

/** Priority fee preset -- canonical definition in SettingsProvider */
import type { PriorityFeePreset } from "@/providers/SettingsProvider";

/** microLamports per compute unit for each preset */
const PRIORITY_FEE_MAP: Record<PriorityFeePreset, number> = {
  none: 0,
  low: 1_000,
  medium: 10_000,
  high: 100_000,
  turbo: 1_000_000,
};

/** How often to poll UserStake per-user data (ms) */
const POLL_INTERVAL_MS = 30_000;

/** Auto-dismiss delay after confirmed state */
const AUTO_RESET_MS = 10_000;

/** PROFIT has 6 decimals */
const PROFIT_DECIMALS = 6;

// =============================================================================
// Hook Return Interface
// =============================================================================

export interface UseStakingReturn {
  // Tab state
  activeTab: StakingAction;
  setActiveTab: (tab: StakingAction) => void;

  // Form state
  amount: string;
  setAmount: (amount: string) => void;

  // On-chain data (polled every 30 seconds)
  stakePoolData: {
    totalStaked: number;           // PROFIT base units
    pendingRewards: number;        // SOL lamports
    totalDistributed: number;      // SOL lamports (lifetime)
    totalClaimed: number;          // SOL lamports (lifetime)
  } | null;
  userStakeData: {
    stakedBalance: number;         // PROFIT base units
    rewardsEarned: number;         // SOL lamports
    totalClaimed: number;          // SOL lamports (lifetime)
  } | null;
  pendingRewards: number;          // Client-calculated SOL lamports
  dataLoading: boolean;

  // Global staking stats (locked/unlocked PROFIT across all stakers)
  globalStats: { unlockedProfit: number; lockedProfit: number } | null;
  globalStatsLoading: boolean;

  // Whether the current user is eligible to unstake (has stake + no cooldown)
  isEligibleToUnstake: boolean;

  // Reward rate stats
  rewardRate: RewardRateStats | null;

  // Execution
  execute: () => Promise<void>;
  status: StakingStatus;
  txSignature: string | null;
  errorMessage: string | null;
  lastResult: StakingResult | null;

  // Wallet & balance
  connected: boolean;
  profitBalance: number;           // PROFIT display units

  // Minimum stake warning (for unstake tab)
  minimumStakeWarning: boolean;

  // Cooldown state
  isCooldownActive: boolean;
  cooldownRemainingMs: number;

  // Config
  priorityFeePreset: PriorityFeePreset;
  setPriorityFeePreset: (preset: PriorityFeePreset) => void;

  // Reset
  resetForm: () => void;
}

// =============================================================================
// Internal types for on-chain data with BigInt fields
// =============================================================================

/** Raw BigInt values from StakePool (for reward calculation) */
interface StakePoolRaw {
  totalStaked: number;
  rewardsPerTokenStored: bigint;   // u128
  pendingRewards: number;
  totalDistributed: number;
  totalClaimed: number;
}

/** Raw BigInt values from UserStake (for reward calculation) */
interface UserStakeRaw {
  stakedBalance: number;
  rewardsPerTokenPaid: bigint;     // u128
  rewardsEarned: number;
  totalClaimed: number;
  lastClaimTs: number;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useStaking(): UseStakingReturn {
  // --- Tab state ---
  const [activeTab, setActiveTab] = useState<StakingAction>("stake");

  // --- Amount string (user-entered, for stake/unstake) ---
  const [amount, setAmount] = useState("");

  // --- Per-user on-chain data (UserStake — fetched via RPC, not SSE) ---
  const [userStakeRaw, setUserStakeRaw] = useState<UserStakeRaw | null>(null);

  // --- Config ---
  const [priorityFeePreset, setPriorityFeePreset] = useState<PriorityFeePreset>("medium");

  // --- Cooldown state ---
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Execution state ---
  const [status, setStatus] = useState<StakingStatus>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<StakingResult | null>(null);

  // --- Data hooks ---
  const wallet = useProtocolWallet();
  const { profit: profitBalance, refresh: refreshBalances } =
    useTokenBalances(wallet.publicKey);

  // SSE: StakePool + globalStats arrive via server-side pipeline
  const { stakePool: stakePoolSse, stakingStats } = useProtocolState();

  // Visibility gating: pause UserStake polling when tab is hidden or staking
  // station is not the active modal. StakePool from SSE is always available.
  const { isActive, onResume } = useVisibility("staking");

  // --- Refs ---
  const autoResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // ==========================================================================
  // SSE-derived StakePool (shared, singleton PDA — same for all users)
  // ==========================================================================

  /**
   * Extract StakePoolRaw from SSE data.
   * rewardsPerTokenStored arrives as native bigint (bigintReviver reconstituted
   * from __bigint tag). Other fields arrive as plain numbers (anchorToJson .toNumber()).
   */
  const stakePoolRaw = useMemo((): StakePoolRaw | null => {
    if (!stakePoolSse || typeof stakePoolSse.totalStaked !== "number") return null;

    return {
      totalStaked: stakePoolSse.totalStaked as number,
      rewardsPerTokenStored:
        typeof stakePoolSse.rewardsPerTokenStored === "bigint"
          ? stakePoolSse.rewardsPerTokenStored
          : BigInt(0),
      pendingRewards: stakePoolSse.pendingRewards as number,
      totalDistributed: stakePoolSse.totalDistributed as number,
      totalClaimed: stakePoolSse.totalClaimed as number,
    };
  }, [stakePoolSse]);

  // ==========================================================================
  // SSE-derived globalStats (server-side gPA aggregate)
  // ==========================================================================

  const globalStats = useMemo((): { unlockedProfit: number; lockedProfit: number } | null => {
    if (!stakingStats || typeof stakingStats.stakerCount !== "number") return null;
    return {
      unlockedProfit: (stakingStats.unlockedProfit as number) ?? 0,
      lockedProfit: (stakingStats.lockedProfit as number) ?? 0,
    };
  }, [stakingStats]);

  const globalStatsLoading = stakingStats === null;

  // loading = StakePool from SSE not yet received
  const dataLoading = stakePoolRaw === null;

  // ==========================================================================
  // Per-user UserStake fetch (RPC, visibility-gated)
  // ==========================================================================

  const fetchUserStake = useCallback(async () => {
    if (!mountedRef.current || !wallet.publicKey) {
      setUserStakeRaw(null);
      return;
    }

    try {
      const program = getStakingProgram();
      const userStakePda = deriveUserStakePDA(wallet.publicKey);
      const userStakeAccount = await program.account.userStake.fetch(userStakePda);

      if (!mountedRef.current) return;

      setUserStakeRaw({
        stakedBalance: userStakeAccount.stakedBalance.toNumber(),
        rewardsPerTokenPaid: BigInt(userStakeAccount.rewardsPerTokenPaid.toString()),
        rewardsEarned: userStakeAccount.rewardsEarned.toNumber(),
        totalClaimed: userStakeAccount.totalClaimed.toNumber(),
        lastClaimTs: userStakeAccount.lastClaimTs.toNumber(),
      });
    } catch {
      // Account doesn't exist = user has never staked. This is normal.
      if (mountedRef.current) setUserStakeRaw(null);
    }
  }, [wallet.publicKey]);

  // Poll UserStake when staking modal is visible (D4 visibility gating)
  useEffect(() => {
    if (!isActive || !wallet.publicKey) return;

    mountedRef.current = true;
    fetchUserStake();

    const timer = setInterval(fetchUserStake, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [isActive, fetchUserStake, wallet.publicKey]);

  // Burst-refresh UserStake on tab resume
  useEffect(() => {
    return onResume(() => {
      if (wallet.publicKey) fetchUserStake();
    });
  }, [onResume, fetchUserStake, wallet.publicKey]);

  // Re-fetch UserStake immediately after confirmed TX.
  // StakePool arrives via SSE automatically (~200ms).
  useEffect(() => {
    if (status === "confirmed") {
      fetchUserStake();
    }
  }, [status, fetchUserStake]);

  // Cleanup auto-reset timer on unmount
  useEffect(() => {
    return () => {
      if (autoResetTimerRef.current) {
        clearTimeout(autoResetTimerRef.current);
        autoResetTimerRef.current = null;
      }
    };
  }, []);

  // Cooldown countdown timer: 1-second interval while cooldown is active
  useEffect(() => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }

    const lastClaimTs = userStakeRaw?.lastClaimTs;
    if (!lastClaimTs || lastClaimTs === 0) {
      setCooldownRemainingMs(0);
      return;
    }

    const expiryMs = (lastClaimTs + COOLDOWN_SECONDS) * 1000;
    const remaining = expiryMs - Date.now();

    if (remaining <= 0) {
      setCooldownRemainingMs(0);
      return;
    }

    setCooldownRemainingMs(remaining);

    cooldownTimerRef.current = setInterval(() => {
      const nowRemaining = expiryMs - Date.now();
      if (nowRemaining <= 0) {
        setCooldownRemainingMs(0);
        if (cooldownTimerRef.current) {
          clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
        }
      } else {
        setCooldownRemainingMs(nowRemaining);
      }
    }, 1000);

    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [userStakeRaw?.lastClaimTs]);

  const isCooldownActive = cooldownRemainingMs > 0;

  // Whether the current user is eligible to unstake:
  // Must have an active stake AND cooldown must NOT be active
  const isEligibleToUnstake = useMemo(() => {
    return (
      userStakeRaw !== null &&
      userStakeRaw.stakedBalance > 0 &&
      !isCooldownActive
    );
  }, [userStakeRaw, isCooldownActive]);

  // ==========================================================================
  // Client-side pending reward calculation
  // ==========================================================================

  /**
   * Calculate pending rewards using BigInt arithmetic.
   * This mirrors on-chain update_rewards() from math.rs.
   * Returns 0 if data isn't available.
   */
  const pendingRewards = useMemo(() => {
    if (!stakePoolRaw || !userStakeRaw) return 0;
    if (userStakeRaw.stakedBalance === 0) return userStakeRaw.rewardsEarned;

    return calculatePendingRewards(
      stakePoolRaw.rewardsPerTokenStored,
      userStakeRaw.rewardsPerTokenPaid,
      BigInt(userStakeRaw.stakedBalance),
      BigInt(userStakeRaw.rewardsEarned),
    );
  }, [stakePoolRaw, userStakeRaw]);

  // ==========================================================================
  // Reward rate statistics
  // ==========================================================================

  const rewardRate = useMemo((): RewardRateStats | null => {
    if (!stakePoolRaw) return null;

    const userStakedBaseUnits = userStakeRaw?.stakedBalance ?? 0;

    return calculateRewardRate(
      stakePoolRaw.pendingRewards,
      stakePoolRaw.totalStaked,
      userStakedBaseUnits,
      // solPricePerProfit: omit for now (would need pool reserves),
      // annualizedPct will default to 0 and UI hides it
    );
  }, [stakePoolRaw, userStakeRaw]);

  // ==========================================================================
  // Minimum stake warning
  // ==========================================================================

  /**
   * If the user is on the unstake tab and the remaining balance after unstake
   * would be below MINIMUM_STAKE (1 PROFIT = 1_000_000 base units), warn them
   * that their full balance will be unstaked.
   */
  const minimumStakeWarning = useMemo(() => {
    if (activeTab !== "unstake" || !userStakeRaw || !amount) return false;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return false;

    const amountBaseUnits = Math.floor(parsedAmount * 10 ** PROFIT_DECIMALS);
    const remaining = userStakeRaw.stakedBalance - amountBaseUnits;

    // Warning: remaining is above 0 but below minimum.
    // If remaining === 0, user is unstaking full balance (no warning needed).
    // If amountBaseUnits >= stakedBalance, it's a full unstake (no warning needed).
    return remaining > 0 && remaining < MINIMUM_STAKE && amountBaseUnits < userStakeRaw.stakedBalance;
  }, [activeTab, userStakeRaw, amount]);

  // ==========================================================================
  // Derived display values
  // ==========================================================================

  /** StakePool data formatted for display (numbers, not BigInt) */
  const stakePoolData = useMemo(() => {
    if (!stakePoolRaw) return null;
    return {
      totalStaked: stakePoolRaw.totalStaked,
      pendingRewards: stakePoolRaw.pendingRewards,
      totalDistributed: stakePoolRaw.totalDistributed,
      totalClaimed: stakePoolRaw.totalClaimed,
    };
  }, [stakePoolRaw]);

  /** UserStake data formatted for display (numbers, not BigInt) */
  const userStakeData = useMemo(() => {
    if (!userStakeRaw) return null;
    return {
      stakedBalance: userStakeRaw.stakedBalance,
      rewardsEarned: userStakeRaw.rewardsEarned,
      totalClaimed: userStakeRaw.totalClaimed,
    };
  }, [userStakeRaw]);

  // ==========================================================================
  // Execute staking action
  // ==========================================================================

  const execute = useCallback(async () => {
    if (!wallet.publicKey || !wallet.connected) return;

    const connection = getConnection();
    const priorityMicroLamports = PRIORITY_FEE_MAP[priorityFeePreset];

    try {
      // 1. Build transaction
      setStatus("building");
      setErrorMessage(null);
      setTxSignature(null);
      setLastResult(null);

      let tx;
      let resultAction = activeTab;

      switch (activeTab) {
        case "stake": {
          const parsedAmount = parseFloat(amount);
          if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setStatus("failed");
            setErrorMessage("Amount must be greater than zero.");
            return;
          }
          const amountBaseUnits = Math.floor(parsedAmount * 10 ** PROFIT_DECIMALS);

          tx = await buildStakeTransaction({
            connection,
            userPublicKey: wallet.publicKey,
            amount: amountBaseUnits,
            priorityFeeMicroLamports: priorityMicroLamports,
          });

          // Pre-set result for display after confirmation
          setLastResult({
            action: "stake",
            stakedAmount: amountBaseUnits,
          });
          break;
        }

        case "unstake": {
          const parsedAmount = parseFloat(amount);
          if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setStatus("failed");
            setErrorMessage("Amount must be greater than zero.");
            return;
          }
          const amountBaseUnits = Math.floor(parsedAmount * 10 ** PROFIT_DECIMALS);

          tx = await buildUnstakeTransaction({
            connection,
            userPublicKey: wallet.publicKey,
            amount: amountBaseUnits,
            priorityFeeMicroLamports: priorityMicroLamports,
          });

          // Unstake forfeits pending rewards to remaining stakers
          setLastResult({
            action: "unstake",
            unstakedAmount: amountBaseUnits,
            forfeitedAmount: pendingRewards,
          });
          break;
        }

        case "claim": {
          tx = await buildClaimTransaction({
            connection,
            userPublicKey: wallet.publicKey,
            priorityFeeMicroLamports: priorityMicroLamports,
          });

          setLastResult({
            action: "claim",
            claimedAmount: pendingRewards,
          });
          break;
        }
      }

      // 2. Set blockhash and fee payer
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;

      // 3. Sign and send transaction (single wallet prompt, Blowfish-compatible)
      setStatus("signing");
      const signature = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 2,
      });
      setTxSignature(signature);

      // 5. Confirm transaction (HTTP polling — more reliable than websocket)
      setStatus("confirming");
      const confirmation = await pollTransactionConfirmation(
        connection,
        signature,
        lastValidBlockHeight,
      );

      // 6. Check for errors
      if (confirmation.err) {
        setStatus("failed");
        setErrorMessage(parseStakingError(confirmation.err));
        setLastResult(null);
        return;
      }

      // 7. Success
      setStatus("confirmed");

      // 8. Refresh token balances (PROFIT balance will change after stake/unstake)
      refreshBalances();

      // 9. Auto-reset after 10 seconds
      autoResetTimerRef.current = setTimeout(() => {
        resetForm();
      }, AUTO_RESET_MS);
    } catch (error) {
      console.error("[useStaking] execute error:", error);
      let message = parseStakingError(error);

      // Override CooldownActive with time-aware message if we have on-chain state
      const errStr = String(error);
      if (
        (errStr.includes("6011") || errStr.includes("0x177b") || message.includes("Cooldown active")) &&
        userStakeRaw?.lastClaimTs && userStakeRaw.lastClaimTs > 0
      ) {
        const expiryMs = (userStakeRaw.lastClaimTs + COOLDOWN_SECONDS) * 1000;
        const remainMs = expiryMs - Date.now();
        if (remainMs > 0) {
          const hours = Math.floor(remainMs / 3_600_000);
          const minutes = Math.ceil((remainMs % 3_600_000) / 60_000);
          message = `Cooldown active. You can unstake in ${hours}h ${minutes}m.`;
        }
      }

      setStatus("failed");
      setErrorMessage(message);
      setLastResult(null);
    }
  }, [
    wallet,
    activeTab,
    amount,
    priorityFeePreset,
    pendingRewards,
    refreshBalances,
    userStakeRaw,
  ]);

  // ==========================================================================
  // Reset form
  // ==========================================================================

  const resetForm = useCallback(() => {
    setAmount("");
    setStatus("idle");
    setTxSignature(null);
    setErrorMessage(null);
    setLastResult(null);
    if (autoResetTimerRef.current) {
      clearTimeout(autoResetTimerRef.current);
      autoResetTimerRef.current = null;
    }
  }, []);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // Tab state
    activeTab,
    setActiveTab,

    // Form state
    amount,
    setAmount,

    // On-chain data
    stakePoolData,
    userStakeData,
    pendingRewards,
    dataLoading,

    // Global staking stats
    globalStats,
    globalStatsLoading,

    // Eligibility
    isEligibleToUnstake,

    // Reward rate
    rewardRate,

    // Execution
    execute,
    status,
    txSignature,
    errorMessage,
    lastResult,

    // Wallet & balance
    connected: wallet.connected,
    profitBalance,

    // Minimum stake warning
    minimumStakeWarning,

    // Cooldown state
    isCooldownActive,
    cooldownRemainingMs,

    // Config
    priorityFeePreset,
    setPriorityFeePreset,

    // Reset
    resetForm,
  };
}
