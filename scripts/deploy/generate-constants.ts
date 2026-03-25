/**
 * Constants Code Generator
 *
 * Reads `deployments/{cluster}.json` and produces a complete `shared/constants.ts`
 * file that is a drop-in replacement for the previously hand-maintained version.
 *
 * Usage: npx tsx scripts/deploy/generate-constants.ts <devnet|mainnet>
 *
 * The generated file:
 * - Has an AUTO-GENERATED header to prevent accidental manual edits
 * - Exports the exact same names and types as the hand-maintained version
 * - Uses deployment.json for all dynamic addresses (programs, mints, PDAs, pools)
 * - Uses hardcoded static values for seeds, decimals, fees (these come from on-chain code)
 *
 * Source: .planning/phases/91-deploy-config-foundation/91-02-PLAN.md
 */

import * as fs from "fs";
import * as path from "path";
import type { DeploymentConfig } from "./lib/deployment-schema";

// =============================================================================
// CLI Argument Parsing
// =============================================================================

const cluster = process.argv[2];
if (!cluster || !["devnet", "mainnet"].includes(cluster)) {
  console.error("Usage: npx tsx scripts/deploy/generate-constants.ts <devnet|mainnet>");
  console.error("  cluster: 'devnet' or 'mainnet'");
  process.exit(1);
}

// =============================================================================
// Paths
// =============================================================================

const projectRoot = path.resolve(__dirname, "../..");
const deploymentPath = path.join(projectRoot, "deployments", `${cluster}.json`);
const outputPath = path.join(projectRoot, "shared", "constants.ts");

// =============================================================================
// Read Deployment Config
// =============================================================================

if (!fs.existsSync(deploymentPath)) {
  console.error(`ERROR: Deployment config not found: ${deploymentPath}`);
  console.error(`Run the deploy pipeline first to generate deployments/${cluster}.json`);
  process.exit(1);
}

const raw = fs.readFileSync(deploymentPath, "utf-8");
const config: DeploymentConfig = JSON.parse(raw);

console.log(`Reading deployment config: deployments/${cluster}.json (schema v${config.schemaVersion})`);

// =============================================================================
// Check if mainnet deployment.json exists (for CLUSTER_CONFIG mainnet section)
// =============================================================================

const mainnetPath = path.join(projectRoot, "deployments", "mainnet.json");
const hasMainnetConfig = fs.existsSync(mainnetPath);
let mainnetConfig: DeploymentConfig | null = null;
if (hasMainnetConfig) {
  mainnetConfig = JSON.parse(fs.readFileSync(mainnetPath, "utf-8"));
}

// =============================================================================
// Build the constants.ts file
// =============================================================================

function buildConstants(cfg: DeploymentConfig): string {
  const lines: string[] = [];

  function emit(line: string = "") {
    lines.push(line);
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  emit(`// AUTO-GENERATED from deployments/${cfg.cluster}.json -- DO NOT EDIT MANUALLY`);
  emit(`// Generated: ${new Date().toISOString()}`);
  emit(`// Run: npx tsx scripts/deploy/generate-constants.ts ${cfg.cluster}`);
  emit();

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------
  emit(`import { PublicKey } from "@solana/web3.js";`);
  emit(`import {`);
  emit(`  NATIVE_MINT,`);
  emit(`  TOKEN_PROGRAM_ID,`);
  emit(`  TOKEN_2022_PROGRAM_ID,`);
  emit(`} from "@solana/spl-token";`);
  emit();

  // -------------------------------------------------------------------------
  // Program IDs
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Program IDs (from deployments/${cfg.cluster}.json)`);
  emit(`// =============================================================================`);
  emit(`export const PROGRAM_IDS = {`);
  emit(`  AMM: new PublicKey("${cfg.programs.amm}"),`);
  emit(`  TRANSFER_HOOK: new PublicKey("${cfg.programs.transferHook}"),`);
  emit(`  TAX_PROGRAM: new PublicKey("${cfg.programs.taxProgram}"),`);
  emit(`  EPOCH_PROGRAM: new PublicKey("${cfg.programs.epochProgram}"),`);
  emit(`  STAKING: new PublicKey("${cfg.programs.staking}"),`);
  emit(`  VAULT: new PublicKey("${cfg.programs.conversionVault}"),`);
  emit(`  BONDING_CURVE: new PublicKey("${cfg.programs.bondingCurve}"),`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Mints
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Mint Addresses (from deployments/${cfg.cluster}.json)`);
  emit(`// =============================================================================`);
  emit(`export const MINTS = {`);
  emit(`  CRIME: new PublicKey("${cfg.mints.crime}"),`);
  emit(`  FRAUD: new PublicKey("${cfg.mints.fraud}"),`);
  emit(`  PROFIT: new PublicKey("${cfg.mints.profit}"),`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Token Constants (static -- from on-chain program code)
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Token Constants`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** All three meme tokens (CRIME, FRAUD, PROFIT) use 6 decimals */`);
  emit(`export const TOKEN_DECIMALS = 6;`);
  emit();
  emit(`/** Minimum stake: 1 PROFIT = 1,000,000 base units (6 decimals) */`);
  emit(`export const MINIMUM_STAKE = 1_000_000;`);
  emit();
  emit(`/** Cooldown period after claiming before unstake is allowed. 43,200s = 12 hours. Source: programs/staking/src/constants.rs */`);
  emit(`export const COOLDOWN_SECONDS = 43_200;`);
  emit();

  // -------------------------------------------------------------------------
  // Pool Fee Constants
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Pool Fee Constants (bps)`);
  emit(`// Source: programs/amm/src/constants.rs`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** LP fee for SOL pools (CRIME/SOL, FRAUD/SOL). 100 bps = 1.0% */`);
  emit(`export const SOL_POOL_FEE_BPS = 100;`);
  emit();

  // -------------------------------------------------------------------------
  // Vault Constants
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Vault Constants`);
  emit(`// Source: programs/conversion-vault/src/constants.rs`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Fixed conversion rate: 100 CRIME/FRAUD = 1 PROFIT */`);
  emit(`export const VAULT_CONVERSION_RATE = 100;`);
  emit();
  emit(`/** PDA seeds for conversion vault program (must match on-chain constants.rs) */`);
  emit(`export const VAULT_SEEDS = {`);
  emit(`  CONFIG: Buffer.from("vault_config"),`);
  emit(`  VAULT_CRIME: Buffer.from("vault_crime"),`);
  emit(`  VAULT_FRAUD: Buffer.from("vault_fraud"),`);
  emit(`  VAULT_PROFIT: Buffer.from("vault_profit"),`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // PDA Seeds (static -- must match on-chain constants.rs exactly)
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// PDA Seeds (must match on-chain constants.rs exactly)`);
  emit(`//`);
  emit(`// Source mapping:`);
  emit(`// - Staking seeds   -> programs/staking/src/constants.rs`);
  emit(`// - Transfer Hook   -> programs/transfer-hook/src/state/*.rs`);
  emit(`// - AMM seeds       -> programs/amm/src/constants.rs`);
  emit(`// - Tax seeds       -> programs/tax-program/src/constants.rs`);
  emit(`// - Epoch seeds     -> programs/epoch-program/src/constants.rs`);
  emit(`// =============================================================================`);
  emit(`export const SEEDS = {`);
  emit(`  // Staking`);
  emit(`  STAKE_POOL: Buffer.from("stake_pool"),`);
  emit(`  ESCROW_VAULT: Buffer.from("escrow_vault"),`);
  emit(`  STAKE_VAULT: Buffer.from("stake_vault"),`);
  emit(`  USER_STAKE: Buffer.from("user_stake"),`);
  emit();
  emit(`  // Transfer Hook`);
  emit(`  WHITELIST_AUTHORITY: Buffer.from("authority"),`);
  emit(`  WHITELIST_ENTRY: Buffer.from("whitelist"),`);
  emit(`  EXTRA_ACCOUNT_META: Buffer.from("extra-account-metas"),`);
  emit();
  emit(`  // AMM`);
  emit(`  ADMIN: Buffer.from("admin"),`);
  emit(`  POOL: Buffer.from("pool"),`);
  emit(`  VAULT: Buffer.from("vault"),`);
  emit(`  VAULT_A: Buffer.from("a"),`);
  emit(`  VAULT_B: Buffer.from("b"),`);
  emit(`  SWAP_AUTHORITY: Buffer.from("swap_authority"),`);
  emit();
  emit(`  // Tax`);
  emit(`  TAX_AUTHORITY: Buffer.from("tax_authority"),`);
  emit();
  emit(`  // Bonding Curve`);
  emit(`  CURVE: Buffer.from("curve"),`);
  emit(`  CURVE_TOKEN_VAULT: Buffer.from("curve_token_vault"),`);
  emit(`  CURVE_SOL_VAULT: Buffer.from("curve_sol_vault"),`);
  emit(`  TAX_ESCROW: Buffer.from("tax_escrow"),`);
  emit();
  emit(`  // Epoch`);
  emit(`  EPOCH_STATE: Buffer.from("epoch_state"),`);
  emit(`  CARNAGE_FUND: Buffer.from("carnage_fund"),`);
  emit(`  CARNAGE_SOL_VAULT: Buffer.from("carnage_sol_vault"),`);
  emit(`  CARNAGE_CRIME_VAULT: Buffer.from("carnage_crime_vault"),`);
  emit(`  CARNAGE_FRAUD_VAULT: Buffer.from("carnage_fraud_vault"),`);
  emit(`  CARNAGE_SIGNER: Buffer.from("carnage_signer"),`);
  emit(`  STAKING_AUTHORITY: Buffer.from("staking_authority"),`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Epoch Timing Constants
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Epoch Timing Constants`);
  emit(`// Source: programs/epoch-program/src/constants.rs`);
  emit(`// =============================================================================`);
  emit();
  emit(`/**`);
  emit(` * Devnet epoch duration in slots (~5 minutes at 400ms/slot).`);
  emit(` * Production will be 4,500 (~30 minutes).`);
  emit(` * Used for countdown timer computation: remaining_slots = SLOTS_PER_EPOCH - (current_slot - epoch_start_slot)`);
  emit(` */`);
  emit(`export const SLOTS_PER_EPOCH = 750;`);
  emit();
  emit(`/**`);
  emit(` * Approximate average Solana slot time in milliseconds.`);
  emit(` * Slot timing is inherently variable; 400ms is the standard approximation`);
  emit(` * used for converting slot counts to human-readable time displays.`);
  emit(` */`);
  emit(`export const MS_PER_SLOT = 400;`);
  emit();

  // -------------------------------------------------------------------------
  // Bonding Curve Constants
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Bonding Curve Constants`);
  emit(`// Source: programs/bonding_curve/src/constants.rs`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Target SOL raised per curve: 500 SOL in lamports */`);
  emit(`export const CURVE_TARGET_SOL = 500_000_000_000;`);
  emit();
  emit(`/** Target tokens for sale per curve: 460M with 6 decimals */`);
  emit(`export const CURVE_TARGET_TOKENS = 460_000_000_000_000;`);
  emit();
  emit(`/** Maximum tokens any single wallet can hold per curve: 20M with 6 decimals */`);
  emit(`export const MAX_TOKENS_PER_WALLET = 20_000_000_000_000;`);
  emit();
  emit(`/** Minimum SOL per purchase: 0.05 SOL in lamports */`);
  emit(`export const MIN_PURCHASE_SOL = 50_000_000;`);
  emit();
  emit(`/** Sell tax: 15% in basis points */`);
  emit(`export const CURVE_SELL_TAX_BPS = 1_500;`);
  emit();
  emit(`/** Deadline duration: ~48 hours at 400ms/slot */`);
  emit(`export const CURVE_DEADLINE_SLOTS = 432_000;`);
  emit();

  // -------------------------------------------------------------------------
  // Pre-computed Devnet Bonding Curve PDA Addresses (from deployment.json)
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Pre-computed Devnet Bonding Curve PDA Addresses`);
  emit(`// Source: deployments/${cfg.cluster}.json curvePdas`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Pre-computed PDA addresses for bonding curve accounts on devnet. */`);
  emit(`export const DEVNET_CURVE_PDAS = {`);
  emit(`  crime: {`);
  emit(`    curveState: new PublicKey("${cfg.curvePdas.crime.curveState}"),`);
  emit(`    tokenVault: new PublicKey("${cfg.curvePdas.crime.tokenVault}"),`);
  emit(`    solVault: new PublicKey("${cfg.curvePdas.crime.solVault}"),`);
  emit(`    taxEscrow: new PublicKey("${cfg.curvePdas.crime.taxEscrow}"),`);
  emit(`  },`);
  emit(`  fraud: {`);
  emit(`    curveState: new PublicKey("${cfg.curvePdas.fraud.curveState}"),`);
  emit(`    tokenVault: new PublicKey("${cfg.curvePdas.fraud.tokenVault}"),`);
  emit(`    solVault: new PublicKey("${cfg.curvePdas.fraud.solVault}"),`);
  emit(`    taxEscrow: new PublicKey("${cfg.curvePdas.fraud.taxEscrow}"),`);
  emit(`  },`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Pre-computed Devnet PDA Addresses (from deployment.json)
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Pre-computed Devnet PDA Addresses`);
  emit(`// Source: deployments/${cfg.cluster}.json pdas`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Pre-computed PDA addresses for protocol singleton accounts on devnet. */`);
  emit(`export const DEVNET_PDAS = {`);
  emit(`  /** EpochState PDA: seeds = ["epoch_state"] */`);
  emit(`  EpochState: new PublicKey("${cfg.pdas.epochState}"),`);
  emit(`  /** CarnageFundState PDA: seeds = ["carnage_fund"] */`);
  emit(`  CarnageFund: new PublicKey("${cfg.pdas.carnageFund}"),`);
  emit(`  /** Carnage SOL vault (SystemAccount): seeds = ["carnage_sol_vault"] */`);
  emit(`  CarnageSolVault: new PublicKey("${cfg.pdas.carnageSolVault}"),`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Pre-computed Devnet Pool Addresses (from deployment.json)
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Pre-computed Devnet Pool Addresses (2 AMM pools)`);
  emit(`// Source: deployments/${cfg.cluster}.json pools`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Pre-computed pool PDA addresses for the 2 AMM pools on devnet. */`);
  emit(`export const DEVNET_POOLS = {`);
  emit(`  CRIME_SOL: {`);
  emit(`    pool: new PublicKey("${cfg.pools.crimeSol.pool}"),`);
  emit(`    label: "CRIME/SOL",`);
  emit(`  },`);
  emit(`  FRAUD_SOL: {`);
  emit(`    pool: new PublicKey("${cfg.pools.fraudSol.pool}"),`);
  emit(`    label: "FRAUD/SOL",`);
  emit(`  },`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Extended Pool Configs
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Extended Pool Configs with Vault Addresses`);
  emit(`// Source: deployments/${cfg.cluster}.json pools`);
  emit(`// =============================================================================`);
  emit();
  emit(`export const DEVNET_POOL_CONFIGS = {`);
  emit(`  CRIME_SOL: {`);
  emit(`    pool: new PublicKey("${cfg.pools.crimeSol.pool}"),`);
  emit(`    vaultA: new PublicKey("${cfg.pools.crimeSol.vaultA}"),`);
  emit(`    vaultB: new PublicKey("${cfg.pools.crimeSol.vaultB}"),`);
  emit(`    label: "CRIME/SOL",`);
  emit(`    lpFeeBps: 100,`);
  emit(`    isTaxed: true,`);
  emit(`  },`);
  emit(`  FRAUD_SOL: {`);
  emit(`    pool: new PublicKey("${cfg.pools.fraudSol.pool}"),`);
  emit(`    vaultA: new PublicKey("${cfg.pools.fraudSol.vaultA}"),`);
  emit(`    vaultB: new PublicKey("${cfg.pools.fraudSol.vaultB}"),`);
  emit(`    label: "FRAUD/SOL",`);
  emit(`    lpFeeBps: 100,`);
  emit(`    isTaxed: true,`);
  emit(`  },`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Token Program Resolution
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Token Program Resolution`);
  emit(`//`);
  emit(`// Maps each mint address to the correct token program.`);
  emit(`// WSOL (NATIVE_MINT) uses TOKEN_PROGRAM_ID (original SPL Token).`);
  emit(`// CRIME, FRAUD, PROFIT use TOKEN_2022_PROGRAM_ID.`);
  emit(`// =============================================================================`);
  emit();
  emit(`export const TOKEN_PROGRAM_FOR_MINT: Record<string, PublicKey> = {`);
  emit(`  [NATIVE_MINT.toBase58()]: TOKEN_PROGRAM_ID,`);
  emit(`  [MINTS.CRIME.toBase58()]: TOKEN_2022_PROGRAM_ID,`);
  emit(`  [MINTS.FRAUD.toBase58()]: TOKEN_2022_PROGRAM_ID,`);
  emit(`  [MINTS.PROFIT.toBase58()]: TOKEN_2022_PROGRAM_ID,`);
  emit(`};`);
  emit();

  // -------------------------------------------------------------------------
  // Token Symbols and Valid Pairs
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Token Symbols and Valid Pairs`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Token symbol union for the 4 tradeable assets */`);
  emit(`export type TokenSymbol = "SOL" | "CRIME" | "FRAUD" | "PROFIT";`);
  emit();
  emit(`/**`);
  emit(` * Valid output tokens for each input token.`);
  emit(` *`);
  emit(` * Direct pairs:`);
  emit(` * - SOL <-> CRIME, SOL <-> FRAUD (taxed AMM pools)`);
  emit(` * - CRIME <-> PROFIT, FRAUD <-> PROFIT (fixed-rate vault conversion, 100:1)`);
  emit(` *`);
  emit(` * Multi-hop pairs (resolved by route engine):`);
  emit(` * - SOL <-> PROFIT (via CRIME or FRAUD as intermediate)`);
  emit(` * - CRIME <-> FRAUD (via SOL or PROFIT as intermediate)`);
  emit(` */`);
  emit(`export const VALID_PAIRS: Record<TokenSymbol, TokenSymbol[]> = {`);
  emit(`  SOL: ["CRIME", "FRAUD", "PROFIT"],       // +PROFIT (multi-hop via CRIME or FRAUD)`);
  emit(`  CRIME: ["SOL", "PROFIT", "FRAUD"],       // +FRAUD (multi-hop via SOL or PROFIT)`);
  emit(`  FRAUD: ["SOL", "PROFIT", "CRIME"],       // +CRIME (multi-hop via SOL or PROFIT)`);
  emit(`  PROFIT: ["CRIME", "FRAUD", "SOL"],       // +SOL (multi-hop via CRIME or FRAUD)`);
  emit(`};`);
  emit();

  // -------------------------------------------------------------------------
  // Pool Resolution
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Pool Resolution`);
  emit(`//`);
  emit(`// Given an input/output token pair, returns the pool config and swap instruction`);
  emit(`// type needed to execute the swap.`);
  emit(`// =============================================================================`);
  emit();
  emit(`/** Swap instruction type corresponding to Tax Program instruction names */`);
  emit(`export type SwapInstruction =`);
  emit(`  | "swapSolBuy"`);
  emit(`  | "swapSolSell";`);
  emit();
  emit(`/** Extended pool config with vault addresses and swap instruction type */`);
  emit(`export interface PoolConfig {`);
  emit(`  pool: PublicKey;`);
  emit(`  vaultA: PublicKey;`);
  emit(`  vaultB: PublicKey;`);
  emit(`  label: string;`);
  emit(`  lpFeeBps: number;`);
  emit(`  isTaxed: boolean;`);
  emit(`  instruction: SwapInstruction;`);
  emit(`}`);
  emit();
  emit(`/** Configuration for a vault conversion (fixed-rate, no AMM) */`);
  emit(`export interface VaultConvertConfig {`);
  emit(`  vaultProgram: PublicKey;`);
  emit(`  conversionRate: number;`);
  emit(`  inputMint: PublicKey;`);
  emit(`  outputMint: PublicKey;`);
  emit(`  type: "vaultConvert";`);
  emit(`}`);
  emit();
  emit(`/** Unified route config — either an AMM pool swap or a vault conversion */`);
  emit(`export type RouteConfig = (PoolConfig & { type: "pool" }) | VaultConvertConfig;`);
  emit();
  emit(`/**`);
  emit(` * Resolve the pool config and swap instruction for a given input/output pair.`);
  emit(` *`);
  emit(` * Returns null for non-pool pairs (vault conversions, multi-hop).`);
  emit(` *`);
  emit(` * @param inputToken - Token symbol being sold`);
  emit(` * @param outputToken - Token symbol being bought`);
  emit(` * @returns PoolConfig with vault addresses and instruction type, or null`);
  emit(` */`);
  emit(`/** Parameterized pool resolver — uses provided pool configs instead of top-level exports. */`);
  emit(`export function resolvePoolWithConfig(`);
  emit(`  poolConfigs: typeof DEVNET_POOL_CONFIGS,`);
  emit(`  inputToken: TokenSymbol,`);
  emit(`  outputToken: TokenSymbol,`);
  emit(`): PoolConfig | null {`);
  emit(`  if (inputToken === "SOL" && outputToken === "CRIME") {`);
  emit(`    return { ...poolConfigs.CRIME_SOL, instruction: "swapSolBuy" };`);
  emit(`  }`);
  emit(`  if (inputToken === "SOL" && outputToken === "FRAUD") {`);
  emit(`    return { ...poolConfigs.FRAUD_SOL, instruction: "swapSolBuy" };`);
  emit(`  }`);
  emit(`  if (inputToken === "CRIME" && outputToken === "SOL") {`);
  emit(`    return { ...poolConfigs.CRIME_SOL, instruction: "swapSolSell" };`);
  emit(`  }`);
  emit(`  if (inputToken === "FRAUD" && outputToken === "SOL") {`);
  emit(`    return { ...poolConfigs.FRAUD_SOL, instruction: "swapSolSell" };`);
  emit(`  }`);
  emit(`  return null;`);
  emit(`}`);
  emit();
  emit(`/** Backward-compatible wrapper using top-level pool configs. */`);
  emit(`export function resolvePool(`);
  emit(`  inputToken: TokenSymbol,`);
  emit(`  outputToken: TokenSymbol,`);
  emit(`): PoolConfig | null {`);
  emit(`  return resolvePoolWithConfig(DEVNET_POOL_CONFIGS, inputToken, outputToken);`);
  emit(`}`);
  emit();

  // -------------------------------------------------------------------------
  // Route Resolution
  // -------------------------------------------------------------------------
  emit(`/** Parameterized route resolver — uses provided config instead of top-level exports. */`);
  emit(`export function resolveRouteWithConfig(`);
  emit(`  config: { poolConfigs: typeof DEVNET_POOL_CONFIGS; mints: typeof MINTS; programIds: typeof PROGRAM_IDS },`);
  emit(`  inputToken: TokenSymbol,`);
  emit(`  outputToken: TokenSymbol,`);
  emit(`): RouteConfig | null {`);
  emit(`  const pool = resolvePoolWithConfig(config.poolConfigs, inputToken, outputToken);`);
  emit(`  if (pool) {`);
  emit(`    return { ...pool, type: "pool" };`);
  emit(`  }`);
  emit();
  emit(`  if (inputToken === "CRIME" && outputToken === "PROFIT") {`);
  emit(`    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.CRIME, outputMint: config.mints.PROFIT, type: "vaultConvert" };`);
  emit(`  }`);
  emit(`  if (inputToken === "FRAUD" && outputToken === "PROFIT") {`);
  emit(`    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.FRAUD, outputMint: config.mints.PROFIT, type: "vaultConvert" };`);
  emit(`  }`);
  emit(`  if (inputToken === "PROFIT" && outputToken === "CRIME") {`);
  emit(`    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.PROFIT, outputMint: config.mints.CRIME, type: "vaultConvert" };`);
  emit(`  }`);
  emit(`  if (inputToken === "PROFIT" && outputToken === "FRAUD") {`);
  emit(`    return { vaultProgram: config.programIds.VAULT, conversionRate: VAULT_CONVERSION_RATE, inputMint: config.mints.PROFIT, outputMint: config.mints.FRAUD, type: "vaultConvert" };`);
  emit(`  }`);
  emit();
  emit(`  return null;`);
  emit(`}`);
  emit();
  emit(`/** Backward-compatible wrapper using top-level exports. */`);
  emit(`export function resolveRoute(`);
  emit(`  inputToken: TokenSymbol,`);
  emit(`  outputToken: TokenSymbol,`);
  emit(`): RouteConfig | null {`);
  emit(`  return resolveRouteWithConfig({ poolConfigs: DEVNET_POOL_CONFIGS, mints: MINTS, programIds: PROGRAM_IDS }, inputToken, outputToken);`);
  emit(`}`);
  emit();

  // -------------------------------------------------------------------------
  // Extended Devnet PDA Addresses
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Extended Devnet PDA Addresses`);
  emit(`// Source: deployments/${cfg.cluster}.json pdas`);
  emit(`// =============================================================================`);
  emit();
  emit(`export const DEVNET_PDAS_EXTENDED = {`);
  emit(`  ...DEVNET_PDAS,`);
  emit(`  /** SwapAuthority PDA: seeds = ["swap_authority"], program = Tax Program */`);
  emit(`  SwapAuthority: new PublicKey("${cfg.pdas.swapAuthority}"),`);
  emit(`  /** TaxAuthority PDA: seeds = ["tax_authority"], program = Tax Program */`);
  emit(`  TaxAuthority: new PublicKey("${cfg.pdas.taxAuthority}"),`);
  emit(`  /** StakePool PDA: seeds = ["stake_pool"], program = Staking */`);
  emit(`  StakePool: new PublicKey("${cfg.pdas.stakePool}"),`);
  emit(`  /** EscrowVault PDA: seeds = ["escrow_vault"], program = Staking */`);
  emit(`  EscrowVault: new PublicKey("${cfg.pdas.escrowVault}"),`);
  emit(`  /** StakeVault PDA: seeds = ["stake_vault"], program = Staking */`);
  emit(`  StakeVault: new PublicKey("${cfg.pdas.stakeVault}"),`);
  emit(`  /** WsolIntermediary PDA: seeds = ["wsol_intermediary"], program = Tax Program */`);
  emit(`  WsolIntermediary: new PublicKey("${cfg.pdas.wsolIntermediary}"),`);
  emit(`} as const;`);
  emit();

  // -------------------------------------------------------------------------
  // Treasury
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Treasury Pubkey`);
  emit(`//`);
  emit(`// The protocol treasury wallet on ${cfg.cluster} (receives 1% of swap tax).`);
  emit(`// NOTE: This will change for mainnet deployment.`);
  emit(`// =============================================================================`);
  emit();
  emit(`export const TREASURY_PUBKEY = new PublicKey(`);
  emit(`  "${cfg.treasury}",`);
  emit(`);`);
  emit();

  // -------------------------------------------------------------------------
  // Address Lookup Table
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Address Lookup Table`);
  emit(`// Source: deployments/${cfg.cluster}.json alt`);
  emit(`// =============================================================================`);
  emit();
  emit(`export const PROTOCOL_ALT = new PublicKey("${cfg.alt}");`);
  emit();

  // -------------------------------------------------------------------------
  // Cluster-Keyed Configuration
  // -------------------------------------------------------------------------
  emit(`// =============================================================================`);
  emit(`// Cluster-Keyed Configuration`);
  emit(`//`);
  emit(`// Maps cluster name to the full set of protocol addresses. Devnet values are`);
  emit(`// the current live deployment. Mainnet values are placeholders (PublicKey.default)`);
  emit(`// until v1.4 mainnet deployment fills them in.`);
  emit(`//`);
  emit(`// Usage: getClusterConfig('devnet') or getClusterConfig('mainnet-beta')`);
  emit(`// The NEXT_PUBLIC_CLUSTER env var controls which config the frontend uses.`);
  emit(`//`);
  emit(`// NOTE: RPC URL is a server-only concern. The browser uses /api/rpc proxy.`);
  emit(`// Server-side code reads HELIUS_RPC_URL env var directly.`);
  emit(`// =============================================================================`);
  emit();
  emit(`export type ClusterName = "devnet" | "mainnet-beta";`);
  emit();
  emit(`export interface ClusterConfig {`);
  emit(`  programIds: typeof PROGRAM_IDS;`);
  emit(`  mints: typeof MINTS;`);
  emit(`  pools: typeof DEVNET_POOLS;`);
  emit(`  poolConfigs: typeof DEVNET_POOL_CONFIGS;`);
  emit(`  pdas: typeof DEVNET_PDAS;`);
  emit(`  pdasExtended: typeof DEVNET_PDAS_EXTENDED;`);
  emit(`  curvePdas: typeof DEVNET_CURVE_PDAS;`);
  emit(`  treasury: PublicKey;`);
  emit(`  alt: PublicKey;`);
  emit(`}`);
  emit();

  // -------------------------------------------------------------------------
  // Alternate cluster config (the "other" cluster's addresses)
  // When CLI=devnet, this emits mainnet addresses. When CLI=mainnet, devnet
  // addresses are already the top-level exports, so we read devnet.json here.
  // -------------------------------------------------------------------------

  // Always try to read BOTH deployment files so CLUSTER_CONFIG is fully populated
  const devnetPath = path.join(projectRoot, "deployments", "devnet.json");
  const hasDevnetConfig = fs.existsSync(devnetPath);
  let devnetCfg: DeploymentConfig | null = null;
  if (hasDevnetConfig && cfg.cluster !== "devnet") {
    devnetCfg = JSON.parse(fs.readFileSync(devnetPath, "utf-8"));
  }

  // Helper: emit a complete address block for an alternate cluster
  function emitAlternateClusterAddresses(prefix: string, ac: DeploymentConfig) {
    emit(`/** ${prefix} addresses from deployments/${ac.cluster}.json */`);
    emit(`const ${prefix}_PROGRAM_IDS = {`);
    emit(`  AMM: new PublicKey("${ac.programs.amm}"),`);
    emit(`  TRANSFER_HOOK: new PublicKey("${ac.programs.transferHook}"),`);
    emit(`  TAX_PROGRAM: new PublicKey("${ac.programs.taxProgram}"),`);
    emit(`  EPOCH_PROGRAM: new PublicKey("${ac.programs.epochProgram}"),`);
    emit(`  STAKING: new PublicKey("${ac.programs.staking}"),`);
    emit(`  VAULT: new PublicKey("${ac.programs.conversionVault}"),`);
    emit(`  BONDING_CURVE: new PublicKey("${ac.programs.bondingCurve}"),`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_MINTS = {`);
    emit(`  CRIME: new PublicKey("${ac.mints.crime}"),`);
    emit(`  FRAUD: new PublicKey("${ac.mints.fraud}"),`);
    emit(`  PROFIT: new PublicKey("${ac.mints.profit}"),`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_POOLS = {`);
    emit(`  CRIME_SOL: {`);
    emit(`    pool: new PublicKey("${ac.pools.crimeSol.pool}"),`);
    emit(`    label: "CRIME/SOL",`);
    emit(`  },`);
    emit(`  FRAUD_SOL: {`);
    emit(`    pool: new PublicKey("${ac.pools.fraudSol.pool}"),`);
    emit(`    label: "FRAUD/SOL",`);
    emit(`  },`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_POOL_CONFIGS = {`);
    emit(`  CRIME_SOL: {`);
    emit(`    pool: new PublicKey("${ac.pools.crimeSol.pool}"),`);
    emit(`    vaultA: new PublicKey("${ac.pools.crimeSol.vaultA}"),`);
    emit(`    vaultB: new PublicKey("${ac.pools.crimeSol.vaultB}"),`);
    emit(`    label: "CRIME/SOL",`);
    emit(`    lpFeeBps: 100,`);
    emit(`    isTaxed: true,`);
    emit(`  },`);
    emit(`  FRAUD_SOL: {`);
    emit(`    pool: new PublicKey("${ac.pools.fraudSol.pool}"),`);
    emit(`    vaultA: new PublicKey("${ac.pools.fraudSol.vaultA}"),`);
    emit(`    vaultB: new PublicKey("${ac.pools.fraudSol.vaultB}"),`);
    emit(`    label: "FRAUD/SOL",`);
    emit(`    lpFeeBps: 100,`);
    emit(`    isTaxed: true,`);
    emit(`  },`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_PDAS = {`);
    emit(`  EpochState: new PublicKey("${ac.pdas.epochState}"),`);
    emit(`  CarnageFund: new PublicKey("${ac.pdas.carnageFund}"),`);
    emit(`  CarnageSolVault: new PublicKey("${ac.pdas.carnageSolVault}"),`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_PDAS_EXTENDED = {`);
    emit(`  ...${prefix}_PDAS,`);
    emit(`  SwapAuthority: new PublicKey("${ac.pdas.swapAuthority}"),`);
    emit(`  TaxAuthority: new PublicKey("${ac.pdas.taxAuthority}"),`);
    emit(`  StakePool: new PublicKey("${ac.pdas.stakePool}"),`);
    emit(`  EscrowVault: new PublicKey("${ac.pdas.escrowVault}"),`);
    emit(`  StakeVault: new PublicKey("${ac.pdas.stakeVault}"),`);
    emit(`  WsolIntermediary: new PublicKey("${ac.pdas.wsolIntermediary}"),`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_CURVE_PDAS = {`);
    emit(`  crime: {`);
    emit(`    curveState: new PublicKey("${ac.curvePdas.crime.curveState}"),`);
    emit(`    tokenVault: new PublicKey("${ac.curvePdas.crime.tokenVault}"),`);
    emit(`    solVault: new PublicKey("${ac.curvePdas.crime.solVault}"),`);
    emit(`    taxEscrow: new PublicKey("${ac.curvePdas.crime.taxEscrow}"),`);
    emit(`  },`);
    emit(`  fraud: {`);
    emit(`    curveState: new PublicKey("${ac.curvePdas.fraud.curveState}"),`);
    emit(`    tokenVault: new PublicKey("${ac.curvePdas.fraud.tokenVault}"),`);
    emit(`    solVault: new PublicKey("${ac.curvePdas.fraud.solVault}"),`);
    emit(`    taxEscrow: new PublicKey("${ac.curvePdas.fraud.taxEscrow}"),`);
    emit(`  },`);
    emit(`} as const;`);
    emit();
    emit(`const ${prefix}_TREASURY = new PublicKey("${ac.treasury}");`);
    emit();
    emit(`const ${prefix}_ALT = new PublicKey("${ac.alt}");`);
    emit();
  }

  // Emit alternate cluster address blocks
  if (mainnetConfig && cfg.cluster === "devnet") {
    emitAlternateClusterAddresses("MAINNET", mainnetConfig);
  } else if (devnetCfg && cfg.cluster === "mainnet") {
    emitAlternateClusterAddresses("ALT_DEVNET", devnetCfg);
  }

  // Build CLUSTER_CONFIG with fully-populated entries for both clusters
  emit(`export const CLUSTER_CONFIG: Record<ClusterName, ClusterConfig> = {`);

  if (cfg.cluster === "devnet") {
    // Primary = devnet (top-level exports), alternate = mainnet
    emit(`  devnet: {`);
    emit(`    programIds: PROGRAM_IDS,`);
    emit(`    mints: MINTS,`);
    emit(`    pools: DEVNET_POOLS,`);
    emit(`    poolConfigs: DEVNET_POOL_CONFIGS,`);
    emit(`    pdas: DEVNET_PDAS,`);
    emit(`    pdasExtended: DEVNET_PDAS_EXTENDED,`);
    emit(`    curvePdas: DEVNET_CURVE_PDAS,`);
    emit(`    treasury: TREASURY_PUBKEY,`);
    emit(`    alt: PROTOCOL_ALT,`);
    emit(`  },`);
    if (mainnetConfig) {
      emit(`  "mainnet-beta": {`);
      emit(`    programIds: MAINNET_PROGRAM_IDS,`);
      emit(`    mints: MAINNET_MINTS,`);
      emit(`    pools: MAINNET_POOLS,`);
      emit(`    poolConfigs: MAINNET_POOL_CONFIGS,`);
      emit(`    pdas: MAINNET_PDAS,`);
      emit(`    pdasExtended: MAINNET_PDAS_EXTENDED,`);
      emit(`    curvePdas: MAINNET_CURVE_PDAS,`);
      emit(`    treasury: MAINNET_TREASURY,`);
      emit(`    alt: MAINNET_ALT,`);
      emit(`  },`);
    } else {
      emitMainnetPlaceholders();
    }
  } else {
    // Primary = mainnet (top-level exports), alternate = devnet
    if (devnetCfg) {
      emit(`  devnet: {`);
      emit(`    programIds: ALT_DEVNET_PROGRAM_IDS,`);
      emit(`    mints: ALT_DEVNET_MINTS,`);
      emit(`    pools: ALT_DEVNET_POOLS,`);
      emit(`    poolConfigs: ALT_DEVNET_POOL_CONFIGS,`);
      emit(`    pdas: ALT_DEVNET_PDAS,`);
      emit(`    pdasExtended: ALT_DEVNET_PDAS_EXTENDED,`);
      emit(`    curvePdas: ALT_DEVNET_CURVE_PDAS,`);
      emit(`    treasury: ALT_DEVNET_TREASURY,`);
      emit(`    alt: ALT_DEVNET_ALT,`);
      emit(`  },`);
    } else {
      emit(`  devnet: {`);
      emit(`    programIds: PROGRAM_IDS,`);
      emit(`    mints: MINTS,`);
      emit(`    pools: DEVNET_POOLS,`);
      emit(`    poolConfigs: DEVNET_POOL_CONFIGS,`);
      emit(`    pdas: DEVNET_PDAS,`);
      emit(`    pdasExtended: DEVNET_PDAS_EXTENDED,`);
      emit(`    curvePdas: DEVNET_CURVE_PDAS,`);
      emit(`    treasury: TREASURY_PUBKEY,`);
      emit(`    alt: PROTOCOL_ALT,`);
      emit(`  },`);
    }
    emit(`  "mainnet-beta": {`);
    emit(`    programIds: PROGRAM_IDS,`);
    emit(`    mints: MINTS,`);
    emit(`    pools: DEVNET_POOLS,`);
    emit(`    poolConfigs: DEVNET_POOL_CONFIGS,`);
    emit(`    pdas: DEVNET_PDAS,`);
    emit(`    pdasExtended: DEVNET_PDAS_EXTENDED,`);
    emit(`    curvePdas: DEVNET_CURVE_PDAS,`);
    emit(`    treasury: TREASURY_PUBKEY,`);
    emit(`    alt: PROTOCOL_ALT,`);
    emit(`  },`);
  }

  emit(`};`);

  function emitMainnetPlaceholders() {
    emit(`  "mainnet-beta": {`);
    emit(`    programIds: PROGRAM_IDS,`);
    emit(`    mints: MINTS,`);
    emit(`    pools: DEVNET_POOLS,`);
    emit(`    poolConfigs: DEVNET_POOL_CONFIGS,`);
    emit(`    pdas: DEVNET_PDAS,`);
    emit(`    pdasExtended: DEVNET_PDAS_EXTENDED,`);
    emit(`    curvePdas: DEVNET_CURVE_PDAS,`);
    emit(`    treasury: TREASURY_PUBKEY,`);
    emit(`    alt: PROTOCOL_ALT,`);
    emit(`  },`);
  }
  emit();

  // -------------------------------------------------------------------------
  // getClusterConfig
  // -------------------------------------------------------------------------
  emit(`/**`);
  emit(` * Get the cluster config for a given cluster name.`);
  emit(` * Defaults to 'devnet' if the cluster name is not recognized.`);
  emit(` */`);
  emit(`export function getClusterConfig(cluster: string): ClusterConfig {`);
  emit(`  if (cluster === "mainnet-beta") return CLUSTER_CONFIG["mainnet-beta"];`);
  emit(`  return CLUSTER_CONFIG.devnet;`);
  emit(`}`);

  return lines.join("\n") + "\n";
}

// =============================================================================
// Generate and Write
// =============================================================================

const output = buildConstants(config);
fs.writeFileSync(outputPath, output, "utf-8");

const lineCount = output.split("\n").length;
console.log(`Generated shared/constants.ts from deployments/${cluster}.json (${lineCount} lines)`);
