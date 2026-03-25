"use client";

/**
 * StateMachineWrapper -- Conditional rendering based on compound curve state
 *
 * Tracks BOTH curves independently and determines which UI to show:
 *
 * 1. BOTH graduated -> GraduationOverlay (covers everything, full-screen)
 * 2. EITHER failed (mark_failed called) -> RefundPanel (replaces buy/sell)
 * 3. Otherwise -> children (BuySellPanel for active/filled states)
 *
 * Individual curve states within the "otherwise" case:
 * - Active: buy/sell enabled for that curve
 * - Filled: buy/sell disabled for that curve (handled within BuySellPanel)
 * - Initialized: pre-start state (also within BuySellPanel)
 *
 * NOTE: "failed" here means mark_failed has actually been called on-chain
 * (status === "failed"). If the deadline has passed but mark_failed hasn't
 * been called yet, the countdown timer shows "EXPIRED" but buy/sell stays
 * visible until the on-chain state transition happens.
 */

import type { CurveStateData } from "@/hooks/useCurveState";
import { RefundPanel } from "./RefundPanel";
import { GraduationOverlay } from "./GraduationOverlay";

interface StateMachineWrapperProps {
  crime: CurveStateData | null;
  fraud: CurveStateData | null;
  /** The BuySellPanel (or any active/filled state content) */
  children: React.ReactNode;
}

export function StateMachineWrapper({
  crime,
  fraud,
  children,
}: StateMachineWrapperProps) {
  // If either curve hasn't loaded yet, show children (loading state
  // is handled by the page-level loading check)
  if (!crime || !fraud) {
    return <>{children}</>;
  }

  // Priority 1: Both graduated -> celebration overlay
  if (crime.status === "graduated" && fraud.status === "graduated") {
    return (
      <>
        {/* Render the scene behind the overlay for visual depth */}
        {children}
        <GraduationOverlay />
      </>
    );
  }

  // Priority 2: Either failed -> refund panel replaces buy/sell
  if (crime.status === "failed" || fraud.status === "failed") {
    return <RefundPanel crime={crime} fraud={fraud} />;
  }

  // Priority 3: Active/Filled/Initialized -> show children (BuySellPanel)
  return <>{children}</>;
}
