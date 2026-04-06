import { type Address } from "viem";

/**
 * Contract Addresses for The Establishment on Arc Network
 * 
 * Token names: BRIBE, CORUPT, VOTES (formerly CRIME, FRAUD, PROFIT)
 */

// Testnet Addresses (to be filled after deployment)
export const TESTNET_CONTRACTS = {
  // Tokens
  BRIBE: (process.env.NEXT_PUBLIC_BRIBE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  CORUPT: (process.env.NEXT_PUBLIC_CORUPT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  VOTES: (process.env.NEXT_PUBLIC_VOTES_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  
  // Protocol Contracts
  AMM: (process.env.NEXT_PUBLIC_AMM_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  TAX_CONTROLLER: (process.env.NEXT_PUBLIC_TAX_CONTROLLER_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  EPOCH_MANAGER: (process.env.NEXT_PUBLIC_EPOCH_MANAGER_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  VOTES_STAKING: (process.env.NEXT_PUBLIC_VOTES_STAKING_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  CONVERSION_VAULT: (process.env.NEXT_PUBLIC_CONVERSION_VAULT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
} as const;

// Mainnet Addresses (to be filled after mainnet deployment)
export const MAINNET_CONTRACTS = {
  // Tokens
  BRIBE: "0x0000000000000000000000000000000000000000" as Address,
  CORUPT: "0x0000000000000000000000000000000000000000" as Address,
  VOTES: "0x0000000000000000000000000000000000000000" as Address,
  USDC: "0x0000000000000000000000000000000000000000" as Address,
  
  // Protocol Contracts
  AMM: "0x0000000000000000000000000000000000000000" as Address,
  TAX_CONTROLLER: "0x0000000000000000000000000000000000000000" as Address,
  EPOCH_MANAGER: "0x0000000000000000000000000000000000000000" as Address,
  VOTES_STAKING: "0x0000000000000000000000000000000000000000" as Address,
  CONVERSION_VAULT: "0x0000000000000000000000000000000000000000" as Address,
} as const;

// Get contracts based on environment
export const CONTRACTS = process.env.NEXT_PUBLIC_NETWORK === "mainnet" 
  ? MAINNET_CONTRACTS 
  : TESTNET_CONTRACTS;

// Token metadata
export const TOKEN_METADATA = {
  BRIBE: {
    symbol: "BRIBE",
    name: "Bribe",
    decimals: 6,
    address: CONTRACTS.BRIBE,
  },
  CORUPT: {
    symbol: "CORUPT",
    name: "Corruption",
    decimals: 6,
    address: CONTRACTS.CORUPT,
  },
  VOTES: {
    symbol: "VOTES",
    name: "Votes",
    decimals: 6,
    address: CONTRACTS.VOTES,
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    address: CONTRACTS.USDC,
  },
} as const;

export type TokenSymbol = keyof typeof TOKEN_METADATA;
