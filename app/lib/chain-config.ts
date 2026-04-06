import { defineChain } from "viem";

/**
 * Arc Network Chain Configuration
 * 
 * Arc Network is EVM-compatible with USDC as the native gas token.
 * Sub-second deterministic finality.
 */
export const arcTestnet = defineChain({
  id: 1337, // Placeholder - use actual Arc testnet chain ID
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.testnet.arc.network",
    },
  },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 1338, // Placeholder - use actual Arc mainnet chain ID
  name: "Arc",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.network",
    },
  },
});

// Default chain based on environment
export const defaultChain = process.env.NEXT_PUBLIC_NETWORK === "mainnet" 
  ? arcMainnet 
  : arcTestnet;

// Supported chains
export const supportedChains = [arcTestnet, arcMainnet] as const;
