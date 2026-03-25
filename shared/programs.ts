/**
 * Devnet-specific program configuration
 *
 * Contains the Address Lookup Table and RPC URL for devnet deployment.
 */

import { PublicKey } from "@solana/web3.js";

// =============================================================================
// Devnet Address Lookup Table (55 addresses)
// Recreated during Phase 95 clean deploy; covers all pools, vaults, mints, PDAs
// Source of truth: scripts/deploy/alt-address.json (written by create-alt.ts)
// TODO: Have generate-constants.ts or create-alt.ts auto-sync this value
// =============================================================================
export const DEVNET_ALT = new PublicKey(
  "CJ4dhU2GxKfABR7Ns3jko4jEeHX1T6rZ4J42cp4HXTAB"
);

// =============================================================================
// Devnet RPC URL (Helius free tier -- not a secret)
// Same key used in pda-manifest.json and devnet scripts
// =============================================================================
export const DEVNET_RPC_URL =
  "https://devnet.helius-rpc.com/?api-key=your-helius-api-key-here";
