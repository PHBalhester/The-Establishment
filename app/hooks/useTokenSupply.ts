"use client";

/**
 * useTokenSupply -- SSE-powered hook for CRIME and FRAUD circulating supply
 *
 * Reads token supply from useProtocolState, where ws-subscriber polls
 * getTokenSupply every 60s and stores { amount, decimals, uiAmount } under
 * synthetic keys "__supply:CRIME" and "__supply:FRAUD".
 *
 * Client converts from raw base units (string) to human units (number).
 * Returns human-unit supply (already divided by 10^decimals).
 */

import { useMemo } from "react";
import { useProtocolState } from "@/hooks/useProtocolState";
import { TOKEN_DECIMALS } from "@dr-fraudsworth/shared";

/** Fallback values used while first SSE snapshot is in-flight */
const INITIAL_SUPPLY: Record<string, number> = {
  CRIME: 1_000_000_000,
  FRAUD: 1_000_000_000,
};

export interface UseTokenSupplyResult {
  /** Actual circulating supply in human units (e.g. 980_000_000 after burns) */
  supply: Record<string, number>;
  loading: boolean;
}

export function useTokenSupply(): UseTokenSupplyResult {
  const { crimeSupply, fraudSupply } = useProtocolState();

  const supply = useMemo((): Record<string, number> => {
    // ws-subscriber stores: { amount: "raw_string", decimals: N, uiAmount: N }
    const crimeAmount = crimeSupply?.amount as string | undefined;
    const fraudAmount = fraudSupply?.amount as string | undefined;

    return {
      CRIME: crimeAmount
        ? Number(crimeAmount) / 10 ** TOKEN_DECIMALS
        : INITIAL_SUPPLY.CRIME,
      FRAUD: fraudAmount
        ? Number(fraudAmount) / 10 ** TOKEN_DECIMALS
        : INITIAL_SUPPLY.FRAUD,
    };
  }, [crimeSupply, fraudSupply]);

  // D6: loading = no supply data yet from SSE
  const loading = crimeSupply === null || fraudSupply === null;

  return { supply, loading };
}
