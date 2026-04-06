/**
 * @the-establishment/shared - Barrel export
 *
 * Re-exports all shared constants and types for The Establishment on Arc Network.
 * 
 * Token Mapping (Solana -> Arc):
 *   CRIME  -> BRIBE
 *   FRAUD  -> CORUPT
 *   PROFIT -> VOTES
 *   SOL    -> USDC
 */

export {
  // Token constants
  TOKEN_DECIMALS,
  TOKENS,
  TOKEN_NAMES,
  
  // Staking constants
  MINIMUM_STAKE,
  COOLDOWN_SECONDS,
  
  // Pool constants
  POOL_FEE_BPS,
  
  // Vault constants
  VAULT_CONVERSION_RATE,
  
  // Epoch constants
  EPOCH_DURATION_SECONDS,
  CARNAGE_PROBABILITY_BPS,
  TAX_RATES,
  EpochPhase,
  
  // Tax distribution
  TAX_DISTRIBUTION,
  
  // Trading pairs
  VALID_PAIRS,
  isValidPair,
  
  // Formatting helpers
  formatTokenAmount,
  parseTokenAmount,
} from "./constants-evm";

export type { TokenSymbol } from "./constants-evm";

// Legacy exports for backwards compatibility during migration
// These map old Solana names to new Arc names
export const LEGACY_TOKEN_MAP = {
  CRIME: "BRIBE",
  FRAUD: "CORUPT",
  PROFIT: "VOTES",
  SOL: "USDC",
} as const;
