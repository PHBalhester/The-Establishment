"use client";

/**
 * SlippageConfig -- Inline slippage tolerance and priority fee controls
 *
 * Horizontal row with two groups:
 * - Slippage: preset buttons [0.5%] [1%] [2%] [Custom] with 1% default
 * - Priority: preset buttons [None] [Low] [Medium] [High] [Turbo] with Medium default
 *
 * Warns if slippage is >5% ("High slippage") or <0.1% ("May fail").
 *
 * Uses kit Button and Input components for consistent steampunk theming.
 * Props-only component (no hooks). Receives config from parent (SwapForm or SettingsStation).
 */

import { useState } from "react";
import { Button, Input } from "@/components/kit";
import type { PriorityFeePreset } from "@/providers/SettingsProvider";

// =============================================================================
// Props
// =============================================================================

interface SlippageConfigProps {
  /** Current slippage in basis points */
  slippageBps: number;
  /** Set slippage in basis points */
  setSlippageBps: (bps: number) => void;
  /** Current priority fee preset */
  priorityFeePreset: PriorityFeePreset;
  /** Set priority fee preset */
  setPriorityFeePreset: (preset: PriorityFeePreset) => void;
  /** Whether controls are disabled (during transaction) */
  disabled?: boolean;
  /** When true, slippage controls are disabled (vault routes have fixed rate, no slippage) */
  isVaultOnly?: boolean;
}

// =============================================================================
// Slippage presets (in basis points)
// =============================================================================

const SLIPPAGE_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "2%", bps: 200 },
] as const;

// =============================================================================
// Priority fee presets
// =============================================================================

const PRIORITY_PRESETS: { label: string; value: PriorityFeePreset }[] = [
  { label: "None", value: "none" },
  { label: "Low", value: "low" },
  { label: "Med", value: "medium" },
  { label: "High", value: "high" },
  { label: "Turbo", value: "turbo" },
];

// =============================================================================
// Component
// =============================================================================

export function SlippageConfig({
  slippageBps,
  setSlippageBps,
  priorityFeePreset,
  setPriorityFeePreset,
  disabled = false,
  isVaultOnly = false,
}: SlippageConfigProps) {
  // Pitfall 5 fix: If the incoming slippageBps doesn't match any preset,
  // default to showing the custom input (e.g., localStorage has 150 BPS).
  const [customSlippage, setCustomSlippage] = useState(
    !SLIPPAGE_PRESETS.some((p) => p.bps === slippageBps)
  );
  const [customValue, setCustomValue] = useState(
    !SLIPPAGE_PRESETS.some((p) => p.bps === slippageBps)
      ? (slippageBps / 100).toString()
      : ""
  );

  // Check if current slippage matches a preset
  const isPreset = SLIPPAGE_PRESETS.some((p) => p.bps === slippageBps);

  // Warnings
  const highSlippage = slippageBps > 500; // > 5%
  const lowSlippage = slippageBps < 10; // < 0.1%

  return (
    <div className="mt-3 space-y-3 text-sm">
      {/* Slippage tolerance */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-factory-text-secondary">Slippage tolerance</span>
          <span>
            {isVaultOnly ? "N/A \u2014 fixed rate" : `${(slippageBps / 100).toFixed(1)}%`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {SLIPPAGE_PRESETS.map((preset) => (
            <Button
              key={preset.bps}
              variant="secondary"
              size="sm"
              disabled={disabled || isVaultOnly}
              onClick={() => {
                setSlippageBps(preset.bps);
                setCustomSlippage(false);
              }}
              data-state={slippageBps === preset.bps && !customSlippage ? "active" : "inactive"}
            >
              {preset.label}
            </Button>
          ))}

          {/* Custom slippage */}
          {customSlippage ? (
            <div className="flex items-center">
              <Input
                variant="default"
                inputMode="decimal"
                value={customValue}
                placeholder="0.0"
                disabled={disabled || isVaultOnly}
                onChange={(e) => {
                  const val = e.target.value;
                  // Allow digits and single decimal point
                  if (/^\d*\.?\d*$/.test(val)) {
                    setCustomValue(val);
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
                      setSlippageBps(Math.round(parsed * 100));
                    }
                  }
                }}
                suffix="%"
                wrapperClassName="w-20"
                className={
                  "text-xs " +
                  (highSlippage
                    ? "!border-factory-warning"
                    : lowSlippage
                      ? "!border-factory-warning"
                      : "")
                }
              />
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || isVaultOnly}
              onClick={() => {
                setCustomSlippage(true);
                setCustomValue((slippageBps / 100).toString());
              }}
              data-state={!isPreset && !customSlippage ? "active" : "inactive"}
            >
              Custom
            </Button>
          )}
        </div>

        {/* Slippage warnings (hidden for vault-only routes) */}
        {!isVaultOnly && highSlippage && (
          <p className="text-factory-warning text-xs mt-1">
            High slippage -- you may receive significantly less than expected.
          </p>
        )}
        {!isVaultOnly && lowSlippage && (
          <p className="text-factory-warning text-xs mt-1">
            Very low slippage -- transaction may fail if price moves.
          </p>
        )}
      </div>

      {/* Priority fee */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-factory-text-secondary">Priority fee</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRIORITY_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => setPriorityFeePreset(preset.value)}
              data-state={priorityFeePreset === preset.value ? "active" : "inactive"}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
