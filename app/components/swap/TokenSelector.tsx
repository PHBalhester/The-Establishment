"use client";

/**
 * TokenSelector -- Dropdown for selecting swap tokens
 *
 * Shows a custom dropdown (not native <select>) with a colored circle icon
 * for each token and the symbol text. Only valid, unselected tokens are shown
 * in the dropdown. Uses VALID_PAIRS from shared/constants.ts for pair filtering.
 *
 * Props-only component (no hooks). Receives data from SwapForm.
 */

import { useState, useRef, useEffect } from "react";
import type { TokenSymbol } from "@dr-fraudsworth/shared";

// =============================================================================
// Token color mapping (placeholder icons)
// =============================================================================

const TOKEN_COLORS: Record<TokenSymbol, string> = {
  SOL: "bg-purple-500",
  CRIME: "bg-red-500",
  FRAUD: "bg-green-500",
  PROFIT: "bg-yellow-500",
};

const ALL_TOKENS: TokenSymbol[] = ["SOL", "CRIME", "FRAUD", "PROFIT"];

// =============================================================================
// Props
// =============================================================================

interface TokenSelectorProps {
  /** Currently selected token */
  selectedToken: TokenSymbol;
  /** Tokens that are valid selections (based on VALID_PAIRS of the other field) */
  validTokens: TokenSymbol[];
  /** Called when user selects a new token */
  onChange: (token: TokenSymbol) => void;
  /** Whether the selector is disabled (e.g. during transaction) */
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function TokenSelector({
  selectedToken,
  validTokens,
  onChange,
  disabled = false,
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger button -- brass secondary styling */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={
          "kit-button kit-button-secondary kit-button-sm kit-interactive kit-focus " +
          "flex items-center gap-2 px-3 py-1.5 rounded-lg"
        }
      >
        <span className="font-medium text-sm">{selectedToken}</span>
        <svg
          className={`w-4 h-4 text-factory-text-secondary transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown popover -- factory-themed with brass border */}
      {isOpen && (
        <div className="absolute z-20 mt-1 right-0 min-w-[140px] bg-factory-surface-elevated border border-factory-border rounded-lg shadow-lg overflow-hidden">
          {ALL_TOKENS.filter((token) => validTokens.includes(token) && token !== selectedToken).map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => {
                  onChange(token);
                  setIsOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors text-factory-text hover:bg-factory-surface cursor-pointer"
              >
                <span>{token}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
