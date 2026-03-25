/**
 * @dr-fraudsworth/shared - Barrel export
 *
 * Re-exports all shared constants, program IDs, mints, seeds, and devnet config.
 * Consumed by app/ via transpilePackages in next.config.ts.
 */

export {
  PROGRAM_IDS,
  MINTS,
  TOKEN_DECIMALS,
  MINIMUM_STAKE,
  COOLDOWN_SECONDS,
  SOL_POOL_FEE_BPS,
  VAULT_CONVERSION_RATE,
  VAULT_SEEDS,
  SEEDS,
  SLOTS_PER_EPOCH,
  MS_PER_SLOT,
  DEVNET_PDAS,
  DEVNET_CURVE_PDAS,
  CURVE_TARGET_SOL,
  CURVE_TARGET_TOKENS,
  MAX_TOKENS_PER_WALLET,
  MIN_PURCHASE_SOL,
  CURVE_SELL_TAX_BPS,
  CURVE_DEADLINE_SLOTS,
  DEVNET_POOLS,
  DEVNET_POOL_CONFIGS,
  TOKEN_PROGRAM_FOR_MINT,
  VALID_PAIRS,
  resolvePool,
  resolvePoolWithConfig,
  resolveRoute,
  resolveRouteWithConfig,
  DEVNET_PDAS_EXTENDED,
  TREASURY_PUBKEY,
  PROTOCOL_ALT,
  CLUSTER_CONFIG,
  getClusterConfig,
} from "./constants";

export type {
  TokenSymbol,
  SwapInstruction,
  PoolConfig,
  VaultConvertConfig,
  RouteConfig,
  ClusterName,
  ClusterConfig,
} from "./constants";

export { DEVNET_ALT, DEVNET_RPC_URL } from "./programs";
