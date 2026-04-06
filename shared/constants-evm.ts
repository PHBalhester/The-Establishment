/**
 * The Establishment - EVM/Arc Network Constants
 * 
 * Token Mapping (Solana -> Arc):
 *   CRIME  -> BRIBE
 *   FRAUD  -> CORUPT
 *   PROFIT -> VOTES
 */

// =============================================================================
// Token Constants
// =============================================================================

/** All three tokens use 6 decimals */
export const TOKEN_DECIMALS = 6;

/** Token symbols */
export const TOKENS = {
  BRIBE: "BRIBE",
  CORUPT: "CORUPT",
  VOTES: "VOTES",
  USDC: "USDC",
} as const;

export type TokenSymbol = keyof typeof TOKENS;

/** Token display names */
export const TOKEN_NAMES: Record<TokenSymbol, string> = {
  BRIBE: "Bribe",
  CORUPT: "Corruption",
  VOTES: "Votes",
  USDC: "USD Coin",
};

// =============================================================================
// Staking Constants
// =============================================================================

/** Minimum stake: 1 VOTES = 1,000,000 base units (6 decimals) */
export const MINIMUM_STAKE = 1_000_000n;

/** Cooldown period after claiming before next claim is allowed. 43,200s = 12 hours. */
export const COOLDOWN_SECONDS = 43_200;

// =============================================================================
// Pool Fee Constants (bps)
// =============================================================================

/** LP fee for USDC pools. 100 bps = 1.0% */
export const POOL_FEE_BPS = 100;

// =============================================================================
// Vault Constants
// =============================================================================

/** Fixed conversion rate: 100 BRIBE/CORUPT = 1 VOTES */
export const VAULT_CONVERSION_RATE = 100n;

// =============================================================================
// Epoch Constants
// =============================================================================

/** Epoch duration in seconds (~30 minutes) */
export const EPOCH_DURATION_SECONDS = 30 * 60;

/** Carnage probability in basis points (~4.3%) */
export const CARNAGE_PROBABILITY_BPS = 430;

/** Tax rates in basis points */
export const TAX_RATES = {
  LOW_MIN: 100,   // 1%
  LOW_MAX: 400,   // 4%
  HIGH_MIN: 1100, // 11%
  HIGH_MAX: 1400, // 14%
} as const;

/** Epoch phases */
export enum EpochPhase {
  LOW_TAX = 0,
  HIGH_TAX = 1,
}

// =============================================================================
// Tax Distribution Constants (bps)
// =============================================================================

/** Tax distribution percentages */
export const TAX_DISTRIBUTION = {
  STAKING: 7100,    // 71%
  CARNAGE: 2400,    // 24%
  TREASURY: 500,    // 5%
} as const;

// =============================================================================
// Valid Trading Pairs
// =============================================================================

/** Valid input -> output token pairs */
export const VALID_PAIRS: Record<TokenSymbol, TokenSymbol[]> = {
  USDC: ["BRIBE", "CORUPT"],
  BRIBE: ["USDC", "VOTES"],
  CORUPT: ["USDC", "VOTES"],
  VOTES: [], // VOTES cannot be sold, only staked
};

/** Check if a trading pair is valid */
export function isValidPair(input: TokenSymbol, output: TokenSymbol): boolean {
  return VALID_PAIRS[input]?.includes(output) ?? false;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/** Format token amount from raw units to human-readable */
export function formatTokenAmount(amount: bigint, decimals: number = TOKEN_DECIMALS): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  
  if (fraction === 0n) {
    return whole.toString();
  }
  
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}

/** Parse human-readable amount to raw units */
export function parseTokenAmount(amount: string, decimals: number = TOKEN_DECIMALS): bigint {
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFraction);
}
