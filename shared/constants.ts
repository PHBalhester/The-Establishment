// AUTO-GENERATED from deployments/devnet.json -- DO NOT EDIT MANUALLY
// Generated: 2026-03-20T22:20:47.507Z
// Run: npx tsx scripts/deploy/generate-constants.ts devnet

import { PublicKey } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

// =============================================================================
// Program IDs (from deployments/devnet.json)
// =============================================================================
export const PROGRAM_IDS = {
  AMM: new PublicKey("J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5"),
  TRANSFER_HOOK: new PublicKey("5X5STgDbSd7uTJDBx9BXd2NCED4WXqS5WVznM89YjMqj"),
  TAX_PROGRAM: new PublicKey("FGgidfhNLwxhGHpyH7SoZdxAkAyQNXjA5o8ndV3LkG4W"),
  EPOCH_PROGRAM: new PublicKey("E1u6fM9Pr3Pgbcz1NGq9KQzFbwD8F1uFkT3c9x1juA5h"),
  STAKING: new PublicKey("DrFg87bRjNZUmE6FZw5oPL9zGsbpdrVHrxPHSibfZv1H"),
  VAULT: new PublicKey("9SGsfhxHM7dA4xqApSHKj6c24Bp2rYyqHsti2bDdh263"),
  BONDING_CURVE: new PublicKey("HT3vw2LccPDEQLGVCoszSkLCSGLnjFLjWuaiAMC3qdzy"),
} as const;

// =============================================================================
// Mint Addresses (from deployments/devnet.json)
// =============================================================================
export const MINTS = {
  CRIME: new PublicKey("DtbDMB2dU8veALKTB12fi2HYBKMEVoKxYTbLp9VAvAxR"),
  FRAUD: new PublicKey("78EhS3i2wNM8RQMd8U3xX4eCYm5Xytr2aDcCUH4BzNtx"),
  PROFIT: new PublicKey("Eaipvk74Cw7CYUJNafsai9jxQ913V76MF9EfdQ3nNp2a"),
} as const;

// =============================================================================
// Token Constants
// =============================================================================

/** All three meme tokens (CRIME, FRAUD, PROFIT) use 6 decimals */
export const TOKEN_DECIMALS = 6;

/** Minimum stake: 1 PROFIT = 1,000,000 base units (6 decimals) */
export const MINIMUM_STAKE = 1_000_000;

/** Cooldown period after claiming before unstake is allowed. 43,200s = 12 hours. Source: programs/staking/src/constants.rs */
export const COOLDOWN_SECONDS = 43_200;

// =============================================================================
// Pool Fee Constants (bps)
// Source: programs/amm/src/constants.rs
// =============================================================================

/** LP fee for SOL pools (CRIME/SOL, FRAUD/SOL). 100 bps = 1.0% */
export const SOL_POOL_FEE_BPS = 100;

// =============================================================================
// Vault Constants
// Source: programs/conversion-vault/src/constants.rs
// =============================================================================

/** Fixed conversion rate: 100 CRIME/FRAUD = 1 PROFIT */
export const VAULT_CONVERSION_RATE = 100;

/** PDA seeds for conversion vault program (must match on-chain constants.rs) */
export const VAULT_SEEDS = {
  CONFIG: Buffer.from("vault_config"),
  VAULT_CRIME: Buffer.from("vault_crime"),
  VAULT_FRAUD: Buffer.from("vault_fraud"),
  VAULT_PROFIT: Buffer.from("vault_profit"),
} as const;

// =============================================================================
// PDA Seeds (must match on-chain constants.rs exactly)
//
// Source mapping:
// - Staking seeds   -> programs/staking/src/constants.rs
// - Transfer Hook   -> programs/transfer-hook/src/state/*.rs
// - AMM seeds       -> programs/amm/src/constants.rs
// - Tax seeds       -> programs/tax-program/src/constants.rs
// - Epoch seeds     -> programs/epoch-program/src/constants.rs
// =============================================================================
export const SEEDS = {
  // Staking
  STAKE_POOL: Buffer.from("stake_pool"),
  ESCROW_VAULT: Buffer.from("escrow_vault"),
  STAKE_VAULT: Buffer.from("stake_vault"),
  USER_STAKE: Buffer.from("user_stake"),

  // Transfer Hook
  WHITELIST_AUTHORITY: Buffer.from("authority"),
  WHITELIST_ENTRY: Buffer.from("whitelist"),
  EXTRA_ACCOUNT_META: Buffer.from("extra-account-metas"),

  // AMM
  ADMIN: Buffer.from("admin"),
  POOL: Buffer.from("pool"),
  VAULT: Buffer.from("vault"),
  VAULT_A: Buffer.from("a"),
  VAULT_B: Buffer.from("b"),
  SWAP_AUTHORITY: Buffer.from("swap_authority"),

  // Tax
  TAX_AUTHORITY: Buffer.from("tax_authority"),

  // Bonding Curve
  CURVE: Buffer.from("curve"),
  CURVE_TOKEN_VAULT: Buffer.from("curve_token_vault"),
  CURVE_SOL_VAULT: Buffer.from("curve_sol_vault"),
  TAX_ESCROW: Buffer.from("tax_escrow"),

  // Epoch
  EPOCH_STATE: Buffer.from("epoch_state"),
  CARNAGE_FUND: Buffer.from("carnage_fund"),
  CARNAGE_SOL_VAULT: Buffer.from("carnage_sol_vault"),
  CARNAGE_CRIME_VAULT: Buffer.from("carnage_crime_vault"),
  CARNAGE_FRAUD_VAULT: Buffer.from("carnage_fraud_vault"),
  CARNAGE_SIGNER: Buffer.from("carnage_signer"),
  STAKING_AUTHORITY: Buffer.from("staking_authority"),
} as const;

// =============================================================================
// Epoch Timing Constants
// Source: programs/epoch-program/src/constants.rs
// =============================================================================

/**
 * Devnet epoch duration in slots (~5 minutes at 400ms/slot).
 * Production will be 4,500 (~30 minutes).
 * Used for countdown timer computation: remaining_slots = SLOTS_PER_EPOCH - (current_slot - epoch_start_slot)
 */
export const SLOTS_PER_EPOCH = 750;

/**
 * Approximate average Solana slot time in milliseconds.
 * Slot timing is inherently variable; 400ms is the standard approximation
 * used for converting slot counts to human-readable time displays.
 */
export const MS_PER_SLOT = 400;

// =============================================================================
// Bonding Curve Constants
// Source: programs/bonding_curve/src/constants.rs
// =============================================================================

/** Target SOL raised per curve: 500 SOL in lamports */
export const CURVE_TARGET_SOL = 500_000_000_000;

/** Target tokens for sale per curve: 460M with 6 decimals */
export const CURVE_TARGET_TOKENS = 460_000_000_000_000;

/** Maximum tokens any single wallet can hold per curve: 20M with 6 decimals */
export const MAX_TOKENS_PER_WALLET = 20_000_000_000_000;

/** Minimum SOL per purchase: 0.05 SOL in lamports */
export const MIN_PURCHASE_SOL = 50_000_000;

/** Sell tax: 15% in basis points */
export const CURVE_SELL_TAX_BPS = 1_500;

/** Deadline duration: ~48 hours at 400ms/slot */
export const CURVE_DEADLINE_SLOTS = 432_000;

// =============================================================================
// Pre-computed Devnet Bonding Curve PDA Addresses
// Source: deployments/devnet.json curvePdas
// =============================================================================

/** Pre-computed PDA addresses for bonding curve accounts on devnet. */
export const DEVNET_CURVE_PDAS = {
  crime: {
    curveState: new PublicKey("CNuXrgKntNKvnWKUVrHhsasm2KB45U91mnXbej47b38K"),
    tokenVault: new PublicKey("CA9YngjY5ddr7Ht3wFf2QyGwyq2WsBRLsvkDdo4RSrSx"),
    solVault: new PublicKey("A8Bj1ku7cxYmaxbHYcw196aS7U46vdzfkB2jGfghm9yZ"),
    taxEscrow: new PublicKey("DA7cXVWXjghh56B8QLiwTCLmZpXNek3ds58AxLq8dZAC"),
  },
  fraud: {
    curveState: new PublicKey("N4bhtJydCDUzALo4QdvCG6gdMvmf23La9S7NuzuQHjo"),
    tokenVault: new PublicKey("8PpZkPcGN98SBe92uTPNZ6CjoGBAiaP2dJx7twss9YCD"),
    solVault: new PublicKey("HdhpCnro2Jh6BcmwgkM9Cpaba23F7WE9wo2CMEjWKSym"),
    taxEscrow: new PublicKey("AvKUWQwtvQEGW4ZKRD3Bca52x5vaguGymY32MpbZRxU1"),
  },
} as const;

// =============================================================================
// Pre-computed Devnet PDA Addresses
// Source: deployments/devnet.json pdas
// =============================================================================

/** Pre-computed PDA addresses for protocol singleton accounts on devnet. */
export const DEVNET_PDAS = {
  /** EpochState PDA: seeds = ["epoch_state"] */
  EpochState: new PublicKey("DR2EgtZTQ9WiZ3ep47J6d5miHcrnoWrH1RuMZWmoj7Eg"),
  /** CarnageFundState PDA: seeds = ["carnage_fund"] */
  CarnageFund: new PublicKey("AvtbMe7SmSXj1bdohygvgSb8s4sNW27qsRHspNMXMTXX"),
  /** Carnage SOL vault (SystemAccount): seeds = ["carnage_sol_vault"] */
  CarnageSolVault: new PublicKey("BLhP2JQoM9YR4T4dv28RDuwTwnqToNPw358DfnDnXuXH"),
} as const;

// =============================================================================
// Pre-computed Devnet Pool Addresses (2 AMM pools)
// Source: deployments/devnet.json pools
// =============================================================================

/** Pre-computed pool PDA addresses for the 2 AMM pools on devnet. */
export const DEVNET_POOLS = {
  CRIME_SOL: {
    pool: new PublicKey("7Auii5EJ7qyRgmDs5UCy1FrgqZBbSu4oeD9C84At7rtt"),
    label: "CRIME/SOL",
  },
  FRAUD_SOL: {
    pool: new PublicKey("Fj555XwmroKgPGFBpEGAvf1mu6rc3xwBY1Xf4tqznbNe"),
    label: "FRAUD/SOL",
  },
} as const;

// =============================================================================
// Extended Pool Configs with Vault Addresses
// Source: deployments/devnet.json pools
// =============================================================================

export const DEVNET_POOL_CONFIGS = {
  CRIME_SOL: {
    pool: new PublicKey("7Auii5EJ7qyRgmDs5UCy1FrgqZBbSu4oeD9C84At7rtt"),
    vaultA: new PublicKey("BjNeT6fFHgjofVvA3gLwAczkLGCxXrZRb7hVzG5XcAvV"),
    vaultB: new PublicKey("BYNNxomnB4JZtGjP5NKH3SU9MvWGq3aUHVbpv4gMSbuJ"),
    label: "CRIME/SOL",
    lpFeeBps: 100,
    isTaxed: true,
  },
  FRAUD_SOL: {
    pool: new PublicKey("Fj555XwmroKgPGFBpEGAvf1mu6rc3xwBY1Xf4tqznbNe"),
    vaultA: new PublicKey("4vdvGDaB7T9pL9VfThNWFGQzKC7b9tk6MG3DAVbTjZVb"),
    vaultB: new PublicKey("5JkcjcsZUN8h1Fc6C6rDkNg1RUVDKngTcnBPD7moDobC"),
    label: "FRAUD/SOL",
    lpFeeBps: 100,
    isTaxed: true,
  },
} as const;

// =============================================================================
// Token Program Resolution
//
// Maps each mint address to the correct token program.
// WSOL (NATIVE_MINT) uses TOKEN_PROGRAM_ID (original SPL Token).
// CRIME, FRAUD, PROFIT use TOKEN_2022_PROGRAM_ID.
// =============================================================================

export const TOKEN_PROGRAM_FOR_MINT: Record<string, PublicKey> = {
  [NATIVE_MINT.toBase58()]: TOKEN_PROGRAM_ID,
  [MINTS.CRIME.toBase58()]: TOKEN_2022_PROGRAM_ID,
  [MINTS.FRAUD.toBase58()]: TOKEN_2022_PROGRAM_ID,
  [MINTS.PROFIT.toBase58()]: TOKEN_2022_PROGRAM_ID,
};

// =============================================================================
// Token Symbols and Valid Pairs
// =============================================================================

/** Token symbol union for the 4 tradeable assets */
export type TokenSymbol = "SOL" | "CRIME" | "FRAUD" | "PROFIT";

/**
 * Valid output tokens for each input token.
 *
 * Direct pairs:
 * - SOL <-> CRIME, SOL <-> FRAUD (taxed AMM pools)
 * - CRIME <-> PROFIT, FRAUD <-> PROFIT (fixed-rate vault conversion, 100:1)
 *
 * Multi-hop pairs (resolved by route engine):
 * - SOL <-> PROFIT (via CRIME or FRAUD as intermediate)
 * - CRIME <-> FRAUD (via SOL or PROFIT as intermediate)
 */
export const VALID_PAIRS: Record<TokenSymbol, TokenSymbol[]> = {
  SOL: ["CRIME", "FRAUD", "PROFIT"],       // +PROFIT (multi-hop via CRIME or FRAUD)
  CRIME: ["SOL", "PROFIT", "FRAUD"],       // +FRAUD (multi-hop via SOL or PROFIT)
  FRAUD: ["SOL", "PROFIT", "CRIME"],       // +CRIME (multi-hop via SOL or PROFIT)
  PROFIT: ["CRIME", "FRAUD", "SOL"],       // +SOL (multi-hop via CRIME or FRAUD)
};

// =============================================================================
// Pool Resolution
//
// Given an input/output token pair, returns the pool config and swap instruction
// type needed to execute the swap.
// =============================================================================

/** Swap instruction type corresponding to Tax Program instruction names */
export type SwapInstruction =
  | "swapSolBuy"
  | "swapSolSell";

/** Extended pool config with vault addresses and swap instruction type */
export interface PoolConfig {
  pool: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  label: string;
  lpFeeBps: number;
  isTaxed: boolean;
  instruction: SwapInstruction;
}

/** Configuration for a vault conversion (fixed-rate, no AMM) */
export interface VaultConvertConfig {
  vaultProgram: PublicKey;
  conversionRate: number;
  inputMint: PublicKey;
  outputMint: PublicKey;
  type: "vaultConvert";
}

/** Unified route config — either an AMM pool swap or a vault conversion */
export type RouteConfig = (PoolConfig & { type: "pool" }) | VaultConvertConfig;

/**
 * Resolve the pool config and swap instruction for a given input/output pair.
 *
 * Returns null for non-pool pairs (vault conversions, multi-hop).
 *
 * @param inputToken - Token symbol being sold
 * @param outputToken - Token symbol being bought
 * @returns PoolConfig with vault addresses and instruction type, or null
 */
/** Parameterized pool resolver — uses provided pool configs instead of top-level exports. */
export function resolvePoolWithConfig(
  poolConfigs: typeof DEVNET_POOL_CONFIGS,
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): PoolConfig | null {
  if (inputToken === "SOL" && outputToken === "CRIME") {
    return { ...poolConfigs.CRIME_SOL, instruction: "swapSolBuy" };
  }
  if (inputToken === "SOL" && outputToken === "FRAUD") {
    return { ...poolConfigs.FRAUD_SOL, instruction: "swapSolBuy" };
  }
  if (inputToken === "CRIME" && outputToken === "SOL") {
    return { ...poolConfigs.CRIME_SOL, instruction: "swapSolSell" };
  }
  if (inputToken === "FRAUD" && outputToken === "SOL") {
    return { ...poolConfigs.FRAUD_SOL, instruction: "swapSolSell" };
  }
  return null;
}

/** Backward-compatible wrapper using top-level pool configs. */
export function resolvePool(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): PoolConfig | null {
  return resolvePoolWithConfig(DEVNET_POOL_CONFIGS, inputToken, outputToken);
}

/** Parameterized route resolver — uses provided config instead of top-level exports. */
export function resolveRouteWithConfig(
  config: { poolConfigs: typeof DEVNET_POOL_CONFIGS; mints: typeof MINTS; programIds: typeof PROGRAM_IDS },
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): RouteConfig | null {
  const pool = resolvePoolWithConfig(config.poolConfigs, inputToken, outputToken);
  if (pool) {
    return { ...pool, type: "pool" };
  }

  if (inputToken === "CRIME" && outputToken === "PROFIT") {
    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.CRIME, outputMint: config.mints.PROFIT, type: "vaultConvert" };
  }
  if (inputToken === "FRAUD" && outputToken === "PROFIT") {
    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.FRAUD, outputMint: config.mints.PROFIT, type: "vaultConvert" };
  }
  if (inputToken === "PROFIT" && outputToken === "CRIME") {
    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.PROFIT, outputMint: config.mints.CRIME, type: "vaultConvert" };
  }
  if (inputToken === "PROFIT" && outputToken === "FRAUD") {
    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.PROFIT, outputMint: config.mints.FRAUD, type: "vaultConvert" };
  }

  return null;
}

/** Backward-compatible wrapper using top-level exports. */
export function resolveRoute(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): RouteConfig | null {
  return resolveRouteWithConfig({ poolConfigs: DEVNET_POOL_CONFIGS, mints: MINTS, programIds: PROGRAM_IDS }, inputToken, outputToken);
}

// =============================================================================
// Extended Devnet PDA Addresses
// Source: deployments/devnet.json pdas
// =============================================================================

export const DEVNET_PDAS_EXTENDED = {
  ...DEVNET_PDAS,
  /** SwapAuthority PDA: seeds = ["swap_authority"], program = Tax Program */
  SwapAuthority: new PublicKey("DDLjeJX9fevjda7m4YPwotRb79bzRpGoD42ECcYhaZqH"),
  /** TaxAuthority PDA: seeds = ["tax_authority"], program = Tax Program */
  TaxAuthority: new PublicKey("FAdyShb4ax4u6cXnmjTEtBEQkjZDLsjsCkHyxw45ciNM"),
  /** StakePool PDA: seeds = ["stake_pool"], program = Staking */
  StakePool: new PublicKey("HNNetqJXr1Dqpjh9quk6y7Kw4b2VrTtyy2if6n4sgPDa"),
  /** EscrowVault PDA: seeds = ["escrow_vault"], program = Staking */
  EscrowVault: new PublicKey("Qa1pJQanFHSMT6z94HToYehWDtdFqvGE8qKbbbKpRBD"),
  /** StakeVault PDA: seeds = ["stake_vault"], program = Staking */
  StakeVault: new PublicKey("52VW6R7nYfvGS9CY7nf6VqVfpst59dF7FYeWMaq1XjsM"),
  /** WsolIntermediary PDA: seeds = ["wsol_intermediary"], program = Tax Program */
  WsolIntermediary: new PublicKey("FFaeGgxKHu7Sp98mVetQ59pRHVUcxYXY8sP84BUR8YjD"),
} as const;

// =============================================================================
// Treasury Pubkey
//
// The protocol treasury wallet on devnet (receives 1% of swap tax).
// NOTE: This will change for mainnet deployment.
// =============================================================================

export const TREASURY_PUBKEY = new PublicKey(
  "8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4",
);

// =============================================================================
// Address Lookup Table
// Source: deployments/devnet.json alt
// =============================================================================

export const PROTOCOL_ALT = new PublicKey("FwAetEADes6Q19naJQ5eXBet9M5uVstAhjtvwnHRbMFL");

// =============================================================================
// Cluster-Keyed Configuration
//
// Maps cluster name to the full set of protocol addresses. Devnet values are
// the current live deployment. Mainnet values are placeholders (PublicKey.default)
// until v1.4 mainnet deployment fills them in.
//
// Usage: getClusterConfig('devnet') or getClusterConfig('mainnet-beta')
// The NEXT_PUBLIC_CLUSTER env var controls which config the frontend uses.
//
// NOTE: RPC URL is a server-only concern. The browser uses /api/rpc proxy.
// Server-side code reads HELIUS_RPC_URL env var directly.
// =============================================================================

export type ClusterName = "devnet" | "mainnet-beta";

export interface ClusterConfig {
  programIds: typeof PROGRAM_IDS;
  mints: typeof MINTS;
  pools: typeof DEVNET_POOLS;
  poolConfigs: typeof DEVNET_POOL_CONFIGS;
  pdas: typeof DEVNET_PDAS;
  pdasExtended: typeof DEVNET_PDAS_EXTENDED;
  curvePdas: typeof DEVNET_CURVE_PDAS;
  treasury: PublicKey;
  alt: PublicKey;
}

/** MAINNET addresses from deployments/mainnet.json */
const MAINNET_PROGRAM_IDS = {
  AMM: new PublicKey("5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"),
  TRANSFER_HOOK: new PublicKey("CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd"),
  TAX_PROGRAM: new PublicKey("43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"),
  EPOCH_PROGRAM: new PublicKey("4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2"),
  STAKING: new PublicKey("12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"),
  VAULT: new PublicKey("5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ"),
  BONDING_CURVE: new PublicKey("DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV"),
} as const;

const MAINNET_MINTS = {
  CRIME: new PublicKey("cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc"),
  FRAUD: new PublicKey("FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5"),
  PROFIT: new PublicKey("pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR"),
} as const;

const MAINNET_POOLS = {
  CRIME_SOL: {
    pool: new PublicKey("ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf"),
    label: "CRIME/SOL",
  },
  FRAUD_SOL: {
    pool: new PublicKey("AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq"),
    label: "FRAUD/SOL",
  },
} as const;

const MAINNET_POOL_CONFIGS = {
  CRIME_SOL: {
    pool: new PublicKey("ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf"),
    vaultA: new PublicKey("14rFLiXzXk7aXLnwAz2kwQUjG9vauS84AQLu6LH9idUM"),
    vaultB: new PublicKey("6s6cprCGxTAYCk9LiwCpCsdHzReW7CLZKqy3ZSCtmV1b"),
    label: "CRIME/SOL",
    lpFeeBps: 100,
    isTaxed: true,
  },
  FRAUD_SOL: {
    pool: new PublicKey("AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq"),
    vaultA: new PublicKey("3sUDyw1k61NSKgn2EA9CaS3FbSZAApGeCRNwNFQPwg8o"),
    vaultB: new PublicKey("2nzqXn6FivXjPSgrUGTA58eeVUDjGhvn4QLfhXK1jbjP"),
    label: "FRAUD/SOL",
    lpFeeBps: 100,
    isTaxed: true,
  },
} as const;

const MAINNET_PDAS = {
  EpochState: new PublicKey("FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU"),
  CarnageFund: new PublicKey("CX9Xx2vwSheqMY7zQZUDfAexXg2XHcQmZ45wLgHZDNhV"),
  CarnageSolVault: new PublicKey("5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT"),
} as const;

const MAINNET_PDAS_EXTENDED = {
  ...MAINNET_PDAS,
  SwapAuthority: new PublicKey("CoCdbornGtiZ8tLxF5HD2TdGidfgfwbbiDX79BaZGJ2D"),
  TaxAuthority: new PublicKey("8zijSBnoiGQzwccQkdNuAwbZCieDZsxdn2GgKDErCemQ"),
  StakePool: new PublicKey("5BdRPPwEDpHEtRgdp4MfywbwmZnrf6u23bXMnG1w8ViN"),
  EscrowVault: new PublicKey("E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY"),
  StakeVault: new PublicKey("9knYFeYSupqdhQv6yyMv6q1FGpD5L3q3yaym7N5Lwafo"),
  WsolIntermediary: new PublicKey("2HPNULWVVdTcRiAm2DkghLA6frXxA2Nsu4VRu8a4qQ1s"),
} as const;

const MAINNET_CURVE_PDAS = {
  crime: {
    curveState: new PublicKey("AT4WbYdxA5c16DYnWzVqHKeYtxjL8SezTHYzjcwz1q4U"),
    tokenVault: new PublicKey("BD2npfWhSYmJQt7YBy5AmCiePaMt5BFxrAor3Fv1oRmU"),
    solVault: new PublicKey("5559qC3D4HWi2jqzL9z3jm2y49DY1Uvj7BQ5QcAm39FX"),
    taxEscrow: new PublicKey("woyAQ2A7PB166jC7xAQVCfcUrW3ubLtdBNiUgY8uBgh"),
  },
  fraud: {
    curveState: new PublicKey("Aacsg5SY5TMeRn3GjByZ7wMoPX7RFuK7ostEYVDQPgU1"),
    tokenVault: new PublicKey("3iTPhBMzf4yxr4vpyGVJpFEHbGhj7T62eAnR6JAttoM6"),
    solVault: new PublicKey("4mz8D4B8YUBYpWZiWSExd2CiSdj9LRG5DaSAGNt8U6fM"),
    taxEscrow: new PublicKey("4aKbDmELUjXen7HFsjzgkPF3E7jUfYBr2MarR6bniQZx"),
  },
} as const;

const MAINNET_TREASURY = new PublicKey("3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv");

const MAINNET_ALT = new PublicKey("7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h");

export const CLUSTER_CONFIG: Record<ClusterName, ClusterConfig> = {
  devnet: {
    programIds: PROGRAM_IDS,
    mints: MINTS,
    pools: DEVNET_POOLS,
    poolConfigs: DEVNET_POOL_CONFIGS,
    pdas: DEVNET_PDAS,
    pdasExtended: DEVNET_PDAS_EXTENDED,
    curvePdas: DEVNET_CURVE_PDAS,
    treasury: TREASURY_PUBKEY,
    alt: PROTOCOL_ALT,
  },
  "mainnet-beta": {
    programIds: MAINNET_PROGRAM_IDS,
    mints: MAINNET_MINTS,
    pools: MAINNET_POOLS,
    poolConfigs: MAINNET_POOL_CONFIGS,
    pdas: MAINNET_PDAS,
    pdasExtended: MAINNET_PDAS_EXTENDED,
    curvePdas: MAINNET_CURVE_PDAS,
    treasury: MAINNET_TREASURY,
    alt: MAINNET_ALT,
  },
};

/**
 * Get the cluster config for a given cluster name.
 * Defaults to 'devnet' if the cluster name is not recognized.
 */
export function getClusterConfig(cluster: string): ClusterConfig {
  if (cluster === "mainnet-beta") return CLUSTER_CONFIG["mainnet-beta"];
  return CLUSTER_CONFIG.devnet;
}
