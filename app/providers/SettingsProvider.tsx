'use client';

/**
 * SettingsProvider -- Global user preferences with localStorage persistence.
 *
 * Manages slippage tolerance, priority fee preset, mute state, and volume.
 * Persists to localStorage synchronously inside the setter callback (not via
 * useEffect) to avoid one-render-behind staleness.
 *
 * Provider tree position: inside WalletProvider, outside ModalProvider --
 * so all modal content (including SettingsStation) can access these values.
 *
 * Accessibility: On first visit (no localStorage), checks
 * `prefers-reduced-motion` to default muted=true for users who prefer
 * reduced motion/stimulation.
 *
 * Dynamic Priority Fees: The `getRecommendedFee()` function fetches real-time
 * priority fee estimates from Helius via the /api/rpc proxy, mapping the user's
 * selected tier (Low/Medium/High) to Helius percentile levels. Falls back to
 * 50,000 micro-lamports if the API is unreachable.
 */

import { createContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Priority fee preset names for Solana transaction compute unit pricing */
export type PriorityFeePreset = "none" | "low" | "medium" | "high" | "turbo";

/**
 * Helius priorityLevel values used by getPriorityFeeEstimate.
 * Maps our user-facing presets to Helius API tiers.
 */
type HeliusPriorityLevel = "Min" | "Low" | "Medium" | "High" | "VeryHigh" | "UnsafeMax";

export interface Settings {
  /** Slippage tolerance in basis points. Default: 500 (5%). */
  slippageBps: number;
  /** Priority fee tier for Solana transactions. Default: 'medium'. */
  priorityFeePreset: PriorityFeePreset;
  /** Whether audio is muted globally. Default: false (or true if prefers-reduced-motion). */
  muted: boolean;
  /** Master volume level 0-100. Default: 20. */
  volume: number;
}

export interface SettingsContextValue {
  /** Current settings state. */
  settings: Settings;
  /** Merge a partial update into settings and persist to localStorage. */
  updateSettings: (partial: Partial<Settings>) => void;
  /** Set slippage tolerance in basis points. */
  setSlippageBps: (bps: number) => void;
  /** Set priority fee preset. */
  setPriorityFeePreset: (preset: PriorityFeePreset) => void;
  /** Set muted state. */
  setMuted: (muted: boolean) => void;
  /** Set volume (0-100). */
  setVolume: (volume: number) => void;
  /**
   * Fetch the recommended priority fee (in micro-lamports per CU) for the
   * given tier. Calls Helius getPriorityFeeEstimate through /api/rpc.
   * Falls back to 50,000 micro-lamports on failure.
   *
   * @param tier - Override the user's saved preset for this single call.
   *               Defaults to the user's current `priorityFeePreset`.
   */
  getRecommendedFee: (tier?: PriorityFeePreset) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'dr-fraudsworth-settings';

const VALID_PRIORITY_PRESETS: PriorityFeePreset[] = [
  'none',
  'low',
  'medium',
  'high',
  'turbo',
];

/**
 * Fallback fee (micro-lamports per CU) when Helius API is unreachable.
 * 50,000 is a reasonable medium-tier fee on Solana mainnet as of early 2026.
 */
const FALLBACK_PRIORITY_FEE = 50_000;

/**
 * Map our user-facing preset names to Helius priorityLevel values.
 * - "none" -> "Min" (cheapest possible, may not land)
 * - "low"  -> "Low" (25th percentile of recent fees)
 * - "medium" -> "Medium" (50th percentile, Helius default)
 * - "high" -> "High" (75th percentile)
 * - "turbo" -> "VeryHigh" (95th percentile, near-guaranteed landing)
 */
const PRESET_TO_HELIUS_LEVEL: Record<PriorityFeePreset, HeliusPriorityLevel> = {
  none: "Min",
  low: "Low",
  medium: "Medium",
  high: "High",
  turbo: "VeryHigh",
};

// ---------------------------------------------------------------------------
// Dynamic Priority Fee Fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch real-time priority fee estimate from Helius via the /api/rpc proxy.
 *
 * Uses the Helius-specific `getPriorityFeeEstimate` RPC method (already in
 * the Plan 01 allowlist). Returns the recommended fee in micro-lamports per
 * compute unit for the requested priority level.
 *
 * @param level - Helius priority level (Min/Low/Medium/High/VeryHigh)
 * @returns micro-lamports per CU, or null on failure
 */
async function fetchPriorityFee(level: HeliusPriorityLevel): Promise<number | null> {
  try {
    const response = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'priority-fee',
        method: 'getPriorityFeeEstimate',
        params: [
          {
            options: {
              priorityLevel: level,
            },
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Helius returns { result: { priorityFeeEstimate: number } }
    const estimate = data?.result?.priorityFeeEstimate;
    if (typeof estimate === 'number' && estimate >= 0) {
      return Math.round(estimate);
    }

    return null;
  } catch {
    // Network error, timeout, etc. -- caller handles fallback
    return null;
  }
}

// ---------------------------------------------------------------------------
// Defaults & Loading
// ---------------------------------------------------------------------------

function getDefaults(): Settings {
  // Check prefers-reduced-motion for accessible muted default
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return {
    slippageBps: 500,
    priorityFeePreset: 'medium',
    muted: prefersReducedMotion,
    volume: 20,
  };
}

/**
 * Load settings from localStorage, validating each field individually.
 * Missing or invalid fields fall back to defaults.
 */
function loadSettings(): Settings {
  const defaults = getDefaults();

  if (typeof window === 'undefined') return defaults;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;

    return {
      slippageBps:
        typeof parsed.slippageBps === 'number' &&
        parsed.slippageBps >= 0 &&
        parsed.slippageBps <= 10_000
          ? parsed.slippageBps
          : defaults.slippageBps,

      priorityFeePreset:
        typeof parsed.priorityFeePreset === 'string' &&
        VALID_PRIORITY_PRESETS.includes(parsed.priorityFeePreset as PriorityFeePreset)
          ? (parsed.priorityFeePreset as PriorityFeePreset)
          : defaults.priorityFeePreset,

      muted:
        typeof parsed.muted === 'boolean'
          ? parsed.muted
          : defaults.muted,

      volume:
        typeof parsed.volume === 'number' &&
        parsed.volume >= 0 &&
        parsed.volume <= 100
          ? parsed.volume
          : defaults.volume,
    };
  } catch {
    // Corrupted JSON -- fall back to defaults
    return defaults;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * The settings context. Starts as null -- useSettings() throws if consumed
 * outside a SettingsProvider, ensuring developer safety.
 */
export const SettingsContext = createContext<SettingsContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider Component
// ---------------------------------------------------------------------------

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  // Lazy initializer: only runs on client during hydration
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      // Write to localStorage synchronously inside the setter callback
      // to avoid the one-render-behind anti-pattern.
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const setSlippageBps = useCallback(
    (bps: number) => updateSettings({ slippageBps: bps }),
    [updateSettings],
  );

  const setPriorityFeePreset = useCallback(
    (preset: PriorityFeePreset) => updateSettings({ priorityFeePreset: preset }),
    [updateSettings],
  );

  const setMuted = useCallback(
    (muted: boolean) => updateSettings({ muted }),
    [updateSettings],
  );

  const setVolume = useCallback(
    (volume: number) => updateSettings({ volume }),
    [updateSettings],
  );

  /**
   * Fetch the recommended priority fee for the given tier (or the user's
   * saved preset). Calls Helius getPriorityFeeEstimate through the /api/rpc
   * proxy. Returns micro-lamports per compute unit.
   *
   * On failure (API unreachable, parse error), falls back to 50,000
   * micro-lamports and logs a warning.
   */
  const getRecommendedFee = useCallback(
    async (tier?: PriorityFeePreset): Promise<number> => {
      const effectiveTier = tier ?? settings.priorityFeePreset;
      const heliusLevel = PRESET_TO_HELIUS_LEVEL[effectiveTier];

      const fee = await fetchPriorityFee(heliusLevel);

      if (fee !== null) {
        return fee;
      }

      // Fallback: log and return sensible default
      console.warn(
        `[SettingsProvider] Failed to fetch priority fee for tier "${effectiveTier}". ` +
        `Using fallback: ${FALLBACK_PRIORITY_FEE} micro-lamports.`,
      );
      return FALLBACK_PRIORITY_FEE;
    },
    [settings.priorityFeePreset],
  );

  const value: SettingsContextValue = {
    settings,
    updateSettings,
    setSlippageBps,
    setPriorityFeePreset,
    setMuted,
    setVolume,
    getRecommendedFee,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
