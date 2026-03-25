/**
 * Shared Integration Test Constants
 *
 * All PDA seeds, token parameters, fee constants, and PDA derivation helpers
 * used across integration tests. Every seed MUST exactly match its on-chain
 * counterpart -- if a seed drifts, the PDA won't match and the test will fail
 * with a cryptic "account not found" error.
 *
 * Source mapping:
 * - Staking seeds   -> programs/staking/src/constants.rs
 * - Transfer Hook   -> programs/transfer-hook/src/state/whitelist_authority.rs
 *                      programs/transfer-hook/src/state/whitelist_entry.rs
 *                      programs/transfer-hook/src/instructions/transfer_hook.rs
 * - AMM seeds       -> programs/amm/src/constants.rs
 * - Tax seeds       -> programs/tax-program/src/constants.rs
 * - Epoch seeds     -> programs/epoch-program/src/constants.rs
 *
 * Source: .planning/phases/31-integration-test-infrastructure/31-01-PLAN.md
 */

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

// =============================================================================
// Staking Program PDA Seeds
// Source: programs/staking/src/constants.rs
// =============================================================================

/** Seeds: ["stake_pool"] -- singleton global pool account */
export const STAKE_POOL_SEED = Buffer.from("stake_pool");

/** Seeds: ["escrow_vault"] -- holds undistributed SOL yield */
export const ESCROW_VAULT_SEED = Buffer.from("escrow_vault");

/** Seeds: ["stake_vault"] -- holds all staked PROFIT tokens */
export const STAKE_VAULT_SEED = Buffer.from("stake_vault");

/** Seeds: ["user_stake", user_pubkey] -- per-user stake tracking */
export const USER_STAKE_SEED = Buffer.from("user_stake");

// =============================================================================
// Transfer Hook Program PDA Seeds
// Source: programs/transfer-hook/src/state/whitelist_authority.rs
//         programs/transfer-hook/src/state/whitelist_entry.rs
//         programs/transfer-hook/src/instructions/transfer_hook.rs
// =============================================================================

/** Seeds: ["authority"] -- whitelist authority config PDA */
export const WHITELIST_AUTHORITY_SEED = Buffer.from("authority");

/** Seeds: ["whitelist", address] -- per-address whitelist entry PDA */
export const WHITELIST_ENTRY_SEED = Buffer.from("whitelist");

/** Seeds: ["extra-account-metas", mint] -- Token-2022 ExtraAccountMetaList PDA */
export const EXTRA_ACCOUNT_META_SEED = Buffer.from("extra-account-metas");

// =============================================================================
// AMM Program PDA Seeds
// Source: programs/amm/src/constants.rs
// =============================================================================

/** Seeds: ["admin"] -- global admin config PDA */
export const ADMIN_SEED = Buffer.from("admin");

/** Seeds: ["pool", mint_a, mint_b] -- per-pool state PDA */
export const POOL_SEED = Buffer.from("pool");

/** Seeds: ["vault", pool, "a"|"b"] -- pool vault token accounts */
export const VAULT_SEED = Buffer.from("vault");

/** Vault A suffix seed */
export const VAULT_A_SEED = Buffer.from("a");

/** Vault B suffix seed */
export const VAULT_B_SEED = Buffer.from("b");

/** Seeds: ["swap_authority"] -- CPI authority for tax-authorized swaps */
export const SWAP_AUTHORITY_SEED = Buffer.from("swap_authority");

// =============================================================================
// Tax Program PDA Seeds
// Source: programs/tax-program/src/constants.rs
// =============================================================================

/** Seeds: ["tax_authority"] -- tax authority PDA for CPI signing */
export const TAX_AUTHORITY_SEED = Buffer.from("tax_authority");

/** Seeds: ["wsol_intermediary"] -- protocol-owned WSOL account for sell tax extraction */
export const WSOL_INTERMEDIARY_SEED = Buffer.from("wsol_intermediary");

// =============================================================================
// Epoch Program PDA Seeds
// Source: programs/epoch-program/src/constants.rs
// =============================================================================

/** Seeds: ["epoch_state"] -- singleton epoch state machine */
export const EPOCH_STATE_SEED = Buffer.from("epoch_state");

/** Seeds: ["carnage_fund"] -- carnage fund state PDA */
export const CARNAGE_FUND_SEED = Buffer.from("carnage_fund");

/** Seeds: ["carnage_sol_vault"] -- holds native SOL for carnage */
export const CARNAGE_SOL_VAULT_SEED = Buffer.from("carnage_sol_vault");

/** Seeds: ["carnage_crime_vault"] -- Token-2022 CRIME vault for carnage */
export const CARNAGE_CRIME_VAULT_SEED = Buffer.from("carnage_crime_vault");

/** Seeds: ["carnage_fraud_vault"] -- Token-2022 FRAUD vault for carnage */
export const CARNAGE_FRAUD_VAULT_SEED = Buffer.from("carnage_fraud_vault");

/** Seeds: ["carnage_signer"] -- carnage signer PDA for CPI */
export const CARNAGE_SIGNER_SEED = Buffer.from("carnage_signer");

/** Seeds: ["staking_authority"] -- Epoch Program's staking CPI authority */
export const STAKING_AUTHORITY_SEED = Buffer.from("staking_authority");

// =============================================================================
// Token Constants
// =============================================================================

/**
 * All three meme tokens (CRIME, FRAUD, PROFIT) use 6 decimals.
 * Source: programs/staking/src/constants.rs PROFIT_DECIMALS
 */
export const TOKEN_DECIMALS = 6;

/**
 * Minimum stake to prevent first-depositor inflation attack.
 * 1 PROFIT = 1,000,000 base units (6 decimals).
 * Source: programs/staking/src/constants.rs MINIMUM_STAKE
 */
export const MINIMUM_STAKE = 1_000_000;

// =============================================================================
// Pool Fee Constants
// Source: programs/amm/src/constants.rs
// =============================================================================

/**
 * LP fee for SOL pools (CRIME/SOL, FRAUD/SOL).
 * 100 bps = 1.0% fee per swap.
 */
export const SOL_POOL_FEE_BPS = 100;

// =============================================================================
// Conversion Vault PDA Seeds
// Source: programs/conversion-vault/src/constants.rs
// =============================================================================

/** PDA seed for VaultConfig singleton */
export const VAULT_CONFIG_SEED = Buffer.from("vault_config");
/** PDA seed for vault CRIME token account */
export const VAULT_CRIME_SEED = Buffer.from("vault_crime");
/** PDA seed for vault FRAUD token account */
export const VAULT_FRAUD_SEED = Buffer.from("vault_fraud");
/** PDA seed for vault PROFIT token account */
export const VAULT_PROFIT_SEED = Buffer.from("vault_profit");
/** Conversion rate: 100 CRIME/FRAUD = 1 PROFIT */
export const VAULT_CONVERSION_RATE = 100;

// =============================================================================
// Bonding Curve PDA Seeds
// Source: programs/bonding_curve/src/constants.rs
// =============================================================================

/** Seeds: ["curve", token_mint] -- per-token bonding curve state PDA */
export const CURVE_SEED = Buffer.from("curve");

/** Seeds: ["curve_token_vault", token_mint] -- token vault holding 460M tokens for sale */
export const CURVE_TOKEN_VAULT_SEED = Buffer.from("curve_token_vault");

/** Seeds: ["curve_sol_vault", token_mint] -- SOL vault holding raised SOL */
export const CURVE_SOL_VAULT_SEED = Buffer.from("curve_sol_vault");

/** Seeds: ["tax_escrow", token_mint] -- tax escrow holding sell tax SOL */
export const CURVE_TAX_ESCROW_SEED = Buffer.from("tax_escrow");

// =============================================================================
// Seed Liquidity Amounts
//
// Defaults are test values (small amounts for fast localnet tests).
// Override via env vars for devnet/mainnet deployment with production amounts:
//   SOL_POOL_SEED_SOL_OVERRIDE=25000000000      (25 SOL in lamports)
//   SOL_POOL_SEED_TOKEN_OVERRIDE=290000000000000 (290M tokens at 6 decimals)
// =============================================================================

/** SOL seed liquidity for SOL pools (default: 10 SOL for tests) */
export const SOL_POOL_SEED_SOL = Number(process.env.SOL_POOL_SEED_SOL_OVERRIDE) || 10 * LAMPORTS_PER_SOL;

/** Token seed liquidity for SOL pools (default: 10,000 tokens at 6 decimals for tests) */
export const SOL_POOL_SEED_TOKEN = Number(process.env.SOL_POOL_SEED_TOKEN_OVERRIDE) || 10_000_000_000;

// =============================================================================
// PDA Derivation Helpers
//
// These accept programId as a parameter so they work in any test context
// without hardcoding program addresses.
// =============================================================================

/**
 * Derive the Pool PDA for a given mint pair.
 *
 * Seeds: ["pool", mint_a, mint_b]
 * The on-chain program sorts mints lexicographically, but the caller
 * must pass them in the same order the pool was created with.
 *
 * @param mintA - First mint public key
 * @param mintB - Second mint public key
 * @param ammProgramId - AMM program public key
 * @returns [publicKey, bump]
 */
export function derivePoolPDA(
  mintA: PublicKey,
  mintB: PublicKey,
  ammProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, mintA.toBuffer(), mintB.toBuffer()],
    ammProgramId
  );
}

/**
 * Derive both vault PDAs for a pool.
 *
 * Seeds: ["vault", pool, "a"] and ["vault", pool, "b"]
 *
 * @param poolKey - Pool state PDA public key
 * @param ammProgramId - AMM program public key
 * @returns Object with vaultA and vaultB as [PublicKey, bump] tuples
 */
export function deriveVaultPDAs(
  poolKey: PublicKey,
  ammProgramId: PublicKey
): {
  vaultA: [PublicKey, number];
  vaultB: [PublicKey, number];
} {
  const vaultA = PublicKey.findProgramAddressSync(
    [VAULT_SEED, poolKey.toBuffer(), VAULT_A_SEED],
    ammProgramId
  );
  const vaultB = PublicKey.findProgramAddressSync(
    [VAULT_SEED, poolKey.toBuffer(), VAULT_B_SEED],
    ammProgramId
  );
  return { vaultA, vaultB };
}

/**
 * Derive a whitelist entry PDA for a given address.
 *
 * Seeds: ["whitelist", address]
 *
 * @param address - Public key to check whitelist status for
 * @param hookProgramId - Transfer Hook program public key
 * @returns [publicKey, bump]
 */
export function deriveWhitelistEntryPDA(
  address: PublicKey,
  hookProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [WHITELIST_ENTRY_SEED, address.toBuffer()],
    hookProgramId
  );
}
