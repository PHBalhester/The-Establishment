'use client';

/**
 * BigRedButton -- Two-layer asset button for swap execution (Phase 62-05).
 *
 * Same pattern as the SplashScreen gear button (wheel.png + wheelbutton.png):
 * - Border layer: static brass frame (big-red-button-border.png), always full colour
 * - Centre layer: interactive red button (big-red-button-centre.png)
 *   Expands on hover (scale 1.05), shrinks on click (scale 0.97),
 *   springs back on release via 300ms transition.
 *   Muted when disabled (no valid swap selected).
 *   Pulses with a red glow when a transaction is in-flight (building/signing/
 *   sending/confirming) to provide visual feedback without hiding the button.
 *
 * IMPORTANT: This component must ALWAYS be rendered in the DOM. The parent
 * (SwapStation) must never conditionally unmount it based on swap status.
 *
 * Assets live at app/public/buttons/big-red-button-{border,centre}.png.
 */

import Image from 'next/image';

// =============================================================================
// Props
// =============================================================================

/** Shared transaction lifecycle states used by both swap and staking flows */
export type ButtonTransactionStatus =
  | "idle"
  | "quoting"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "confirmed"
  | "failed";

interface BigRedButtonProps {
  /** Current transaction lifecycle status (swap or staking) */
  status: ButtonTransactionStatus;
  /** Whether the swap button should be disabled (no valid quote, zero input, etc.) */
  disabled: boolean;
  /** Execute swap callback */
  onSwap: () => void;
  /** Reset form callback */
  onReset: () => void;
  /** Transaction signature (set after sending) */
  txSignature: string | null;
  /** Human-readable error message */
  errorMessage: string | null;
  /** Whether a wallet is connected */
  connected: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function BigRedButton({
  status,
  disabled,
  onSwap,
  onReset,
  connected,
}: BigRedButtonProps) {
  // ── Click handler ─────────────────────────────────────────────────────
  const handleClick = () => {
    if (status === 'confirmed' || status === 'failed') {
      onReset();
    } else if (status === 'idle' && !disabled && connected) {
      onSwap();
    }
  };

  // ── Aria label (accessibility) ────────────────────────────────────────
  const ariaLabel = !connected
    ? 'Connect wallet to swap'
    : disabled
      ? 'Enter swap details to enable'
      : 'Execute swap';

  // Whether interactive animations should be active
  const isActive = connected && !disabled && status === 'idle';

  // Whether a transaction is in-flight (building, signing, sending, confirming)
  const isTransacting =
    status === 'building' ||
    status === 'signing' ||
    status === 'sending' ||
    status === 'confirming';

  // Build centre class list: base + active (idle) OR transacting (pulsing glow)
  const centreClasses = [
    'brb-centre',
    isActive ? 'brb-centre-active' : '',
    isTransacting ? 'brb-centre-transacting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className="brb-assembly"
      disabled={(disabled && status === 'idle') || isTransacting}
      onClick={handleClick}
      aria-label={isTransacting ? 'Transaction in progress' : ariaLabel}
      aria-busy={isTransacting}
    >
      {/* Layer 1: Static brass border frame -- always full colour */}
      <Image
        src="/buttons/big-red-button-border.png"
        alt=""
        fill
        sizes="360px"
        className="brb-border"
        draggable={false}
        priority
      />

      {/* Layer 2: Interactive red centre -- scales on hover/click,
          pulses with red glow during transaction */}
      <div className={centreClasses}>
        <Image
          src="/buttons/big-red-button-centre.png"
          alt=""
          fill
          sizes="320px"
          className="brb-centre-img"
          draggable={false}
          priority
        />
      </div>
    </button>
  );
}
