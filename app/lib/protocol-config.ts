/**
 * Arc Network protocol address re-exports.
 *
 * Resolves the correct set of contract addresses (tokens, AMM, staking, etc.)
 * based on the NEXT_PUBLIC_NETWORK env var (set at build time by Next.js).
 *
 * All app/ code that needs network-specific addresses should import from here.
 */

export type TokenSymbol = "BRIBE" | "CORUPT" | "VOTES" | "USDC";

export type NetworkName = "testnet" | "mainnet";

const rawNetwork = process.env.NEXT_PUBLIC_NETWORK || "testnet";
export const NETWORK: NetworkName =
  rawNetwork === "mainnet" ? "mainnet" : "testnet";

// ── Contract addresses per network ──────────────────────────────────────────
// Replace with real deployed addresses after running: forge script Deploy.s.sol

const TESTNET_ADDRESSES = {
  BRIBE_TOKEN:    "0x0000000000000000000000000000000000000001",
  CORUPT_TOKEN:   "0x0000000000000000000000000000000000000002",
  VOTES_TOKEN:    "0x0000000000000000000000000000000000000003",
  USDC:           "0x0000000000000000000000000000000000000004",
  AMM:            "0x0000000000000000000000000000000000000005",
  TAX_CONTROLLER: "0x0000000000000000000000000000000000000006",
  EPOCH_MANAGER:  "0x0000000000000000000000000000000000000007",
  VOTES_STAKING:  "0x0000000000000000000000000000000000000008",
  CONVERSION_VAULT:"0x0000000000000000000000000000000000000009",
} as const;

const MAINNET_ADDRESSES = {
  BRIBE_TOKEN:    "0x0000000000000000000000000000000000000001",
  CORUPT_TOKEN:   "0x0000000000000000000000000000000000000002",
  VOTES_TOKEN:    "0x0000000000000000000000000000000000000003",
  USDC:           "0x0000000000000000000000000000000000000004",
  AMM:            "0x0000000000000000000000000000000000000005",
  TAX_CONTROLLER: "0x0000000000000000000000000000000000000006",
  EPOCH_MANAGER:  "0x0000000000000000000000000000000000000007",
  VOTES_STAKING:  "0x0000000000000000000000000000000000000008",
  CONVERSION_VAULT:"0x0000000000000000000000000000000000000009",
} as const;

export const CONTRACT_ADDRESSES =
  NETWORK === "mainnet" ? MAINNET_ADDRESSES : TESTNET_ADDRESSES;

// ── Token metadata ───────────────────────────────────────────────────────────

export const TOKEN_META: Record<TokenSymbol, { name: string; symbol: string; decimals: number; color: string }> = {
  BRIBE:  { name: "Bribe",       symbol: "BRIBE",  decimals: 18, color: "#ff6b6b" },
  CORUPT: { name: "Corruption",  symbol: "CORUPT", decimals: 18, color: "#d4a74d" },
  VOTES:  { name: "Votes",       symbol: "VOTES",  decimals: 18, color: "#51cf66" },
  USDC:   { name: "USD Coin",    symbol: "USDC",   decimals: 6,  color: "#2775ca" },
};

// ── Fee config ───────────────────────────────────────────────────────────────

export const FEE_CONFIG = {
  /** LP fee in basis points */
  LP_FEE_BPS: 100,
  /** Tax distribution: staking 71%, carnage 24%, treasury 5% */
  STAKING_SHARE_BPS:  7100,
  CARNAGE_SHARE_BPS:  2400,
  TREASURY_SHARE_BPS:  500,
  /** Conversion rate: 100 BRIBE or CORUPT → 1 VOTES */
  CONVERSION_RATE: 100n,
  /** Carnage probability: ~4.3% (1 in 23 epochs) */
  CARNAGE_ODDS_BPS: 430,
  /** Epoch duration in seconds */
  EPOCH_DURATION_SECONDS: 1800,
} as const;
