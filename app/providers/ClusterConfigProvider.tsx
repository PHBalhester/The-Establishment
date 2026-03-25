"use client";

/**
 * ClusterConfigProvider -- Provides cluster-aware protocol addresses via React context.
 *
 * Reads NEXT_PUBLIC_CLUSTER env var at build time and resolves the correct
 * ClusterConfig (devnet or mainnet-beta) from the shared constants package.
 * All hooks and components that need protocol addresses (mints, pools, PDAs,
 * program IDs) should use `useClusterConfig()` instead of importing
 * top-level constants directly.
 *
 * This ensures the frontend works correctly regardless of which cluster
 * constants.ts was generated from, because CLUSTER_CONFIG contains
 * fully-populated address blocks for both clusters.
 */

import { createContext, useContext, useMemo } from "react";
import {
  getClusterConfig,
  type ClusterConfig,
} from "@dr-fraudsworth/shared";

const ClusterConfigContext = createContext<ClusterConfig | null>(null);

/** Resolve cluster name from env var. Accepts "devnet", "mainnet", or "mainnet-beta". */
function resolveClusterName(): string {
  const raw = process.env.NEXT_PUBLIC_CLUSTER || "devnet";
  // Accept "mainnet" as shorthand for "mainnet-beta" (Next.js env var convention)
  if (raw === "mainnet") return "mainnet-beta";
  return raw;
}

export function ClusterConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = useMemo(() => {
    const clusterName = resolveClusterName();
    return getClusterConfig(clusterName);
  }, []);

  return (
    <ClusterConfigContext.Provider value={config}>
      {children}
    </ClusterConfigContext.Provider>
  );
}

/**
 * Access the active cluster's protocol addresses.
 *
 * Returns: { programIds, mints, pools, poolConfigs, pdas, pdasExtended, curvePdas, treasury }
 *
 * Must be called within <ClusterConfigProvider>.
 */
export function useClusterConfig(): ClusterConfig {
  const ctx = useContext(ClusterConfigContext);
  if (!ctx) {
    throw new Error(
      "useClusterConfig must be used within <ClusterConfigProvider>"
    );
  }
  return ctx;
}
