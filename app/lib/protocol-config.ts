/**
 * Cluster-aware protocol address re-exports.
 *
 * Resolves the correct set of protocol addresses (mints, pools, PDAs, program IDs)
 * based on the NEXT_PUBLIC_CLUSTER env var (set at build time by Next.js).
 *
 * All app/ code that needs cluster-specific addresses should import from here
 * instead of from @dr-fraudsworth/shared directly. This ensures the frontend
 * works correctly on both devnet and mainnet without regenerating constants.ts.
 *
 * Static constants (SEEDS, TOKEN_DECIMALS, fee BPS, etc.) are cluster-independent
 * and can still be imported directly from @dr-fraudsworth/shared.
 */

import {
  getClusterConfig,
  resolvePoolWithConfig,
  resolveRouteWithConfig,
  type TokenSymbol,
  type PoolConfig,
  type RouteConfig,
} from "@dr-fraudsworth/shared";

// Resolve cluster name: "mainnet" → "mainnet-beta", default → "devnet"
const rawCluster = process.env.NEXT_PUBLIC_CLUSTER || "devnet";
const clusterName = rawCluster === "mainnet" ? "mainnet-beta" : rawCluster;
const config = getClusterConfig(clusterName);

// Re-export cluster-resolved addresses using the same names as constants.ts
// so consuming files only need to change the import source.
export const PROGRAM_IDS = config.programIds;
export const MINTS = config.mints;
export const DEVNET_POOLS = config.pools;
export const DEVNET_POOL_CONFIGS = config.poolConfigs;
export const DEVNET_PDAS = config.pdas;
export const DEVNET_PDAS_EXTENDED = config.pdasExtended;
export const DEVNET_CURVE_PDAS = config.curvePdas;
export const TREASURY_PUBKEY = config.treasury;
export const PROTOCOL_ALT = config.alt;

// Re-export TOKEN_PROGRAM_FOR_MINT using cluster-resolved mints
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const TOKEN_PROGRAM_FOR_MINT: Record<string, PublicKey> = {
  [NATIVE_MINT.toBase58()]: TOKEN_PROGRAM_ID,
  [MINTS.CRIME.toBase58()]: TOKEN_2022_PROGRAM_ID,
  [MINTS.FRAUD.toBase58()]: TOKEN_2022_PROGRAM_ID,
  [MINTS.PROFIT.toBase58()]: TOKEN_2022_PROGRAM_ID,
};

// Cluster-aware pool/route resolution
export function resolvePool(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): PoolConfig | null {
  return resolvePoolWithConfig(config.poolConfigs, inputToken, outputToken);
}

export function resolveRoute(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): RouteConfig | null {
  return resolveRouteWithConfig(
    { poolConfigs: config.poolConfigs, mints: config.mints, programIds: config.programIds },
    inputToken,
    outputToken,
  );
}
