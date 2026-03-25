'use client';

/**
 * useSettings -- Hook for accessing global user preferences.
 *
 * Thin wrapper around SettingsContext that provides a clean API for any
 * component in the tree to read/write settings (slippage, priority fee,
 * mute, volume).
 *
 * Includes `getRecommendedFee()` for fetching dynamic priority fees from
 * Helius. Transaction builders call this before each TX to get real-time
 * fee estimates based on the user's selected tier.
 *
 * Throws if used outside a SettingsProvider -- intentional developer safety
 * to catch missing providers early during development.
 *
 * Usage:
 *   const { settings, setSlippageBps, getRecommendedFee } = useSettings();
 *   setSlippageBps(200); // 2%
 *   const fee = await getRecommendedFee(); // micro-lamports from Helius
 */

import { useContext } from 'react';
import { SettingsContext } from '@/providers/SettingsProvider';
import type { SettingsContextValue } from '@/providers/SettingsProvider';

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error(
      'useSettings must be used within a SettingsProvider. ' +
      'Wrap your component tree with <SettingsProvider> in providers.tsx.',
    );
  }
  return context;
}
