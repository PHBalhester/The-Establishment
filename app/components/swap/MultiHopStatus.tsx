"use client";

/**
 * MultiHopStatus -- Multi-hop execution progress and partial failure UI
 *
 * Renders different UI based on the multi-hop swap lifecycle:
 * - building/signing/sending/confirming: Spinner with status text
 *   (for multi-hop routes, shows route label underneath)
 * - failed with intermediateToken: Partial failure with Retry/Keep buttons
 *
 * Confirmed and plain-failed states are handled by toast notifications
 * (fired in SwapForm). The form auto-resets to idle after the toast fires.
 *
 * Props-only component (no hooks). Receives status data from SwapForm.
 */

import type { Route } from "@/lib/swap/route-types";

// =============================================================================
// Props
// =============================================================================

export interface MultiHopStatusProps {
  /** Current execution lifecycle status */
  status: "building" | "signing" | "sending" | "confirming" | "confirmed" | "failed";
  /** The route being executed (for label display) */
  route: Route | null;
  /** Human-readable error message on failure */
  errorMessage: string | null;
  /** Set on partial failure -- the token the user now holds */
  intermediateToken?: string;
  /** Retry hop 2 with fresh quote */
  onRetry: () => void;
  /** Dismiss partial failure, keep intermediate token */
  onKeep: () => void;
}

// =============================================================================
// Spinner Component
// =============================================================================

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-factory-text"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// =============================================================================
// Status text mapping
// =============================================================================

const STATUS_TEXT: Record<string, string> = {
  building: "Preparing route...",
  signing: "Approve in wallet...",
  sending: "Executing route...",
  confirming: "Confirming transaction...",
};

// =============================================================================
// Component
// =============================================================================

export function MultiHopStatus({
  status,
  route,
  errorMessage,
  intermediateToken,
  onRetry,
  onKeep,
}: MultiHopStatusProps) {
  // -------------------------------------------------------------------------
  // Confirmed / plain failed: toast handles notification, form auto-resets
  // -------------------------------------------------------------------------
  if (status === "confirmed") return null;
  if (status === "failed" && !intermediateToken) return null;

  // -------------------------------------------------------------------------
  // Failed with intermediateToken: partial failure UI (action required)
  // -------------------------------------------------------------------------
  if (status === "failed" && intermediateToken) {
    return (
      <div className="mt-4 space-y-3">
        <div className="bg-factory-warning-surface border border-factory-warning-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            {/* Amber warning icon */}
            <svg
              className="h-5 w-5 text-factory-warning flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-sm font-medium text-factory-warning-text">
              Hop 1 succeeded, Hop 2 failed
            </span>
          </div>
          {errorMessage && (
            <p className="text-xs text-factory-warning-text/80 mb-2 ml-7">
              {errorMessage}
            </p>
          )}
          <p className="text-sm text-factory-text font-semibold ml-7">
            You now hold {intermediateToken}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-factory-accent text-factory-bg hover:brightness-110 active:brightness-90 transition-colors"
          >
            Retry swap
          </button>
          <button
            type="button"
            onClick={onKeep}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-factory-surface-elevated text-factory-text hover:bg-factory-border-subtle transition-colors"
          >
            Keep {intermediateToken}
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // In-progress states: spinner with status text
  // -------------------------------------------------------------------------
  const isMultiHop = route && route.hops > 1;
  const showRouteLabel =
    isMultiHop && (status === "sending" || status === "confirming");

  return (
    <div className="mt-4">
      <div className="w-full py-3 rounded-xl flex flex-col items-center justify-center gap-1 bg-factory-active-surface border border-factory-border">
        <div className="flex items-center gap-2">
          <Spinner />
          <span className="text-sm font-medium text-factory-text">
            {STATUS_TEXT[status] ?? "Processing..."}
          </span>
        </div>
        {showRouteLabel && route && (
          <span className="text-xs text-factory-text-secondary">{route.label}</span>
        )}
      </div>
    </div>
  );
}
