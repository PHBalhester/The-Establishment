/**
 * PDA Manifest Generator
 *
 * Derives ALL protocol PDA addresses from program IDs and mint public keys.
 * Outputs both JSON (machine-readable for verify.ts) and markdown (human review)
 * formats so operators can confirm every address matches expectations.
 *
 * Why a manifest?
 * - PDAs are deterministic: given program IDs + seeds, addresses are fixed
 * - The verify script uses the manifest to confirm all accounts exist on-chain
 * - The markdown table gives operators a single-page view of the entire protocol
 * - Debugging "account not found" errors is trivial when you have the expected addresses
 *
 * All PDA seeds are imported from the canonical constants module (not duplicated).
 * Pool PDAs use canonical mint ordering (smaller pubkey = mintA) to match the
 * on-chain AMM constraint.
 *
 * Source: .planning/phases/33-deployment-scripts/33-02-PLAN.md
 */

import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { DeploymentConfig } from "./deployment-schema";

// Import PDA seed constants and derivation helpers from the canonical source.
// These are the SAME constants used in integration tests, ensuring consistency
// between test and deployment environments. Never duplicate these seeds.
import {
  STAKE_POOL_SEED,
  ESCROW_VAULT_SEED,
  STAKE_VAULT_SEED,
  WHITELIST_AUTHORITY_SEED,
  EXTRA_ACCOUNT_META_SEED,
  ADMIN_SEED,
  SWAP_AUTHORITY_SEED,
  TAX_AUTHORITY_SEED,
  EPOCH_STATE_SEED,
  CARNAGE_FUND_SEED,
  CARNAGE_SOL_VAULT_SEED,
  CARNAGE_CRIME_VAULT_SEED,
  CARNAGE_FRAUD_VAULT_SEED,
  CARNAGE_SIGNER_SEED,
  STAKING_AUTHORITY_SEED,
  WSOL_INTERMEDIARY_SEED,
  derivePoolPDA,
  deriveVaultPDAs,
} from "../../../tests/integration/helpers/constants";

// =============================================================================
// Types
// =============================================================================

/**
 * Complete PDA manifest for the Dr. Fraudsworth protocol.
 *
 * Contains every derived address organized by category:
 * - programs: Program IDs (for reference, not derived)
 * - mints: Token mint addresses (not derived, but recorded for pool PDA derivation)
 * - pdas: All singleton PDAs (AdminConfig, WhitelistAuthority, EpochState, etc.)
 * - pools: 2 AMM SOL pools with their vault pair addresses
 */
export interface PdaManifest {
  generatedAt: string;
  clusterUrl: string;
  programs: Record<string, string>;
  mints: Record<string, string>;
  pdas: Record<string, string>;
  pools: Record<string, { pool: string; vaultA: string; vaultB: string }>;
}

/**
 * Program IDs for all 7 protocol programs.
 */
export interface ProgramIds {
  amm: PublicKey;
  transferHook: PublicKey;
  taxProgram: PublicKey;
  epochProgram: PublicKey;
  staking: PublicKey;
  conversionVault: PublicKey;
  bondingCurve: PublicKey;
}

/**
 * Token mint public keys for the 3 protocol tokens.
 */
export interface MintKeys {
  crime: PublicKey;
  fraud: PublicKey;
  profit: PublicKey;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Canonically order two mints for pool PDA derivation.
 *
 * The on-chain AMM program requires mint_a.key() < mint_b.key() (lexicographic
 * byte comparison). Pool PDAs are seeded with [mintA, mintB] in this order,
 * so we must sort the same way to derive the correct address.
 *
 * This is copied from protocol-init.ts rather than imported because
 * protocol-init.ts is a test helper and we avoid importing test modules
 * in deployment scripts.
 */
export function canonicalOrder(
  mint1: PublicKey,
  mint2: PublicKey
): [PublicKey, PublicKey] {
  return mint1.toBuffer().compare(mint2.toBuffer()) < 0
    ? [mint1, mint2]
    : [mint2, mint1];
}

/**
 * WSOL native mint address.
 * Defined here to avoid importing all of @solana/spl-token just for this constant.
 */
const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// =============================================================================
// Manifest Generation
// =============================================================================

/**
 * Generate a complete PDA manifest for the Dr. Fraudsworth protocol.
 *
 * Derives every PDA address from the given program IDs and mint public keys.
 * The manifest is a snapshot of what the protocol's on-chain state SHOULD
 * look like after successful initialization.
 *
 * @param programIds - All 6 program public keys
 * @param mints - All 3 token mint public keys
 * @param clusterUrl - RPC endpoint this manifest was generated for
 * @returns Complete PdaManifest with all derived addresses
 */
export function generateManifest(
  programIds: ProgramIds,
  mints: MintKeys,
  clusterUrl: string
): PdaManifest {
  const { amm, transferHook, taxProgram, epochProgram, staking, conversionVault, bondingCurve } = programIds;
  const { crime, fraud, profit } = mints;

  // -------------------------------------------------------------------------
  // Programs & Mints (not derived, but recorded for reference)
  // -------------------------------------------------------------------------
  const programs: Record<string, string> = {
    AMM: amm.toBase58(),
    TransferHook: transferHook.toBase58(),
    TaxProgram: taxProgram.toBase58(),
    EpochProgram: epochProgram.toBase58(),
    Staking: staking.toBase58(),
    ConversionVault: conversionVault.toBase58(),
    BondingCurve: bondingCurve.toBase58(),
  };

  const mintAddresses: Record<string, string> = {
    CRIME: crime.toBase58(),
    FRAUD: fraud.toBase58(),
    PROFIT: profit.toBase58(),
  };

  // -------------------------------------------------------------------------
  // Transfer Hook PDAs
  // -------------------------------------------------------------------------
  const pdas: Record<string, string> = {};

  // WhitelistAuthority: ["authority"]
  const [whitelistAuthority] = PublicKey.findProgramAddressSync(
    [WHITELIST_AUTHORITY_SEED],
    transferHook
  );
  pdas["WhitelistAuthority"] = whitelistAuthority.toBase58();

  // ExtraAccountMetaList for each mint: ["extra-account-metas", mint]
  for (const [name, mint] of [
    ["CRIME", crime],
    ["FRAUD", fraud],
    ["PROFIT", profit],
  ] as [string, PublicKey][]) {
    const [extraMeta] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()],
      transferHook
    );
    pdas[`ExtraAccountMetaList_${name}`] = extraMeta.toBase58();
  }

  // -------------------------------------------------------------------------
  // AMM PDAs
  // -------------------------------------------------------------------------

  // AdminConfig: ["admin"]
  const [adminConfig] = PublicKey.findProgramAddressSync(
    [ADMIN_SEED],
    amm
  );
  pdas["AdminConfig"] = adminConfig.toBase58();

  // SwapAuthority: ["swap_authority"] -- derived from TAX PROGRAM, not AMM.
  // The AMM validates swap_authority with seeds::program = TAX_PROGRAM_ID,
  // so both programs agree on the same PDA derivation base.
  const [swapAuthority] = PublicKey.findProgramAddressSync(
    [SWAP_AUTHORITY_SEED],
    taxProgram
  );
  pdas["SwapAuthority"] = swapAuthority.toBase58();

  // -------------------------------------------------------------------------
  // Tax Program PDAs
  // -------------------------------------------------------------------------

  // TaxAuthority: ["tax_authority"]
  const [taxAuthority] = PublicKey.findProgramAddressSync(
    [TAX_AUTHORITY_SEED],
    taxProgram
  );
  pdas["TaxAuthority"] = taxAuthority.toBase58();

  // WsolIntermediary: ["wsol_intermediary"] -- sell tax extraction account
  const [wsolIntermediary] = PublicKey.findProgramAddressSync(
    [WSOL_INTERMEDIARY_SEED],
    taxProgram
  );
  pdas["WsolIntermediary"] = wsolIntermediary.toBase58();

  // -------------------------------------------------------------------------
  // Epoch Program PDAs
  // -------------------------------------------------------------------------

  // EpochState: ["epoch_state"]
  const [epochState] = PublicKey.findProgramAddressSync(
    [EPOCH_STATE_SEED],
    epochProgram
  );
  pdas["EpochState"] = epochState.toBase58();

  // CarnageFund: ["carnage_fund"]
  const [carnageFund] = PublicKey.findProgramAddressSync(
    [CARNAGE_FUND_SEED],
    epochProgram
  );
  pdas["CarnageFund"] = carnageFund.toBase58();

  // CarnageSolVault: ["carnage_sol_vault"]
  const [carnageSolVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_SOL_VAULT_SEED],
    epochProgram
  );
  pdas["CarnageSolVault"] = carnageSolVault.toBase58();

  // CarnageCrimeVault: ["carnage_crime_vault"]
  const [carnageCrimeVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_CRIME_VAULT_SEED],
    epochProgram
  );
  pdas["CarnageCrimeVault"] = carnageCrimeVault.toBase58();

  // CarnageFraudVault: ["carnage_fraud_vault"]
  const [carnageFraudVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_FRAUD_VAULT_SEED],
    epochProgram
  );
  pdas["CarnageFraudVault"] = carnageFraudVault.toBase58();

  // CarnageSigner: ["carnage_signer"]
  const [carnageSigner] = PublicKey.findProgramAddressSync(
    [CARNAGE_SIGNER_SEED],
    epochProgram
  );
  pdas["CarnageSigner"] = carnageSigner.toBase58();

  // StakingAuthority: ["staking_authority"]
  const [stakingAuthority] = PublicKey.findProgramAddressSync(
    [STAKING_AUTHORITY_SEED],
    epochProgram
  );
  pdas["StakingAuthority"] = stakingAuthority.toBase58();

  // -------------------------------------------------------------------------
  // Staking PDAs
  // -------------------------------------------------------------------------

  // StakePool: ["stake_pool"]
  const [stakePool] = PublicKey.findProgramAddressSync(
    [STAKE_POOL_SEED],
    staking
  );
  pdas["StakePool"] = stakePool.toBase58();

  // EscrowVault: ["escrow_vault"]
  const [escrowVault] = PublicKey.findProgramAddressSync(
    [ESCROW_VAULT_SEED],
    staking
  );
  pdas["EscrowVault"] = escrowVault.toBase58();

  // StakeVault: ["stake_vault"]
  const [stakeVault] = PublicKey.findProgramAddressSync(
    [STAKE_VAULT_SEED],
    staking
  );
  pdas["StakeVault"] = stakeVault.toBase58();

  // -------------------------------------------------------------------------
  // Conversion Vault PDAs
  // -------------------------------------------------------------------------

  const VAULT_CONFIG_SEED = Buffer.from("vault_config");
  const VAULT_CRIME_SEED = Buffer.from("vault_crime");
  const VAULT_FRAUD_SEED = Buffer.from("vault_fraud");
  const VAULT_PROFIT_SEED = Buffer.from("vault_profit");

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [VAULT_CONFIG_SEED], conversionVault
  );
  pdas["VaultConfig"] = vaultConfigPda.toBase58();

  for (const [label, seed] of [
    ["VaultCrime", VAULT_CRIME_SEED],
    ["VaultFraud", VAULT_FRAUD_SEED],
    ["VaultProfit", VAULT_PROFIT_SEED],
  ] as [string, Buffer][]) {
    const [vaultToken] = PublicKey.findProgramAddressSync(
      [seed, vaultConfigPda.toBuffer()], conversionVault
    );
    pdas[label] = vaultToken.toBase58();
  }

  // -------------------------------------------------------------------------
  // Bonding Curve PDAs
  //
  // Each token (CRIME, FRAUD) gets 4 PDAs:
  //   CurveState:       ["curve", mint]
  //   CurveTokenVault:  ["curve_token_vault", mint]
  //   CurveSolVault:    ["curve_sol_vault", mint]
  //   CurveTaxEscrow:   ["tax_escrow", mint]
  // -------------------------------------------------------------------------
  const CURVE_SEED = Buffer.from("curve");
  const CURVE_TOKEN_VAULT_SEED = Buffer.from("curve_token_vault");
  const CURVE_SOL_VAULT_SEED = Buffer.from("curve_sol_vault");
  const CURVE_TAX_ESCROW_SEED = Buffer.from("tax_escrow");

  for (const [name, mint] of [
    ["CRIME", crime],
    ["FRAUD", fraud],
  ] as [string, PublicKey][]) {
    const [curveState] = PublicKey.findProgramAddressSync(
      [CURVE_SEED, mint.toBuffer()], bondingCurve
    );
    pdas[`CurveState_${name}`] = curveState.toBase58();

    const [tokenVault] = PublicKey.findProgramAddressSync(
      [CURVE_TOKEN_VAULT_SEED, mint.toBuffer()], bondingCurve
    );
    pdas[`CurveTokenVault_${name}`] = tokenVault.toBase58();

    const [solVault] = PublicKey.findProgramAddressSync(
      [CURVE_SOL_VAULT_SEED, mint.toBuffer()], bondingCurve
    );
    pdas[`CurveSolVault_${name}`] = solVault.toBase58();

    const [taxEscrow] = PublicKey.findProgramAddressSync(
      [CURVE_TAX_ESCROW_SEED, mint.toBuffer()], bondingCurve
    );
    pdas[`CurveTaxEscrow_${name}`] = taxEscrow.toBase58();
  }

  // -------------------------------------------------------------------------
  // Pool PDAs (2 SOL pools, each with vaultA + vaultB)
  // -------------------------------------------------------------------------
  const pools: Record<string, { pool: string; vaultA: string; vaultB: string }> = {};

  // Helper to derive and record a pool
  function addPool(
    label: string,
    rawMint1: PublicKey,
    rawMint2: PublicKey
  ): void {
    const [mintA, mintB] = canonicalOrder(rawMint1, rawMint2);
    const [pool] = derivePoolPDA(mintA, mintB, amm);
    const { vaultA: [vaultA], vaultB: [vaultB] } = deriveVaultPDAs(pool, amm);
    pools[label] = {
      pool: pool.toBase58(),
      vaultA: vaultA.toBase58(),
      vaultB: vaultB.toBase58(),
    };
  }

  addPool("CRIME/SOL", crime, NATIVE_MINT);
  addPool("FRAUD/SOL", fraud, NATIVE_MINT);

  // -------------------------------------------------------------------------
  // Assemble manifest
  // -------------------------------------------------------------------------
  return {
    generatedAt: new Date().toISOString(),
    clusterUrl,
    programs,
    mints: mintAddresses,
    pdas,
    pools,
  };
}

// =============================================================================
// Deployment Config Generation
// =============================================================================

/**
 * Generate a complete DeploymentConfig for `deployments/{cluster}.json`.
 *
 * This extends the existing PDA manifest with additional fields:
 * - schemaVersion for forward compatibility
 * - Bonding curve PDAs organized by faction
 * - Hook ExtraAccountMetaList PDAs organized by mint
 * - ALT address
 * - Treasury and authority tracking
 *
 * @param cluster - Cluster name ("devnet" or "mainnet")
 * @param programIds - All 7 program IDs
 * @param mints - All 3 token mint public keys
 * @param altAddress - Address Lookup Table address (null if not created)
 * @param treasury - Treasury wallet address
 * @param deployer - Deployer wallet address (authority)
 * @returns Complete DeploymentConfig object
 */
export function generateDeploymentConfig(
  cluster: string,
  programIds: ProgramIds,
  mints: MintKeys,
  altAddress: string | null,
  treasury: string,
  deployer: string,
): DeploymentConfig {
  const { amm, transferHook, taxProgram, epochProgram, staking, conversionVault, bondingCurve } = programIds;
  const { crime, fraud, profit } = mints;

  // -------------------------------------------------------------------------
  // Singleton PDAs (same derivation as generateManifest)
  // -------------------------------------------------------------------------

  // Transfer Hook
  const [whitelistAuthority] = PublicKey.findProgramAddressSync(
    [WHITELIST_AUTHORITY_SEED], transferHook
  );

  // AMM
  const [adminConfig] = PublicKey.findProgramAddressSync(
    [ADMIN_SEED], amm
  );

  // SwapAuthority derived from Tax Program
  const [swapAuthority] = PublicKey.findProgramAddressSync(
    [SWAP_AUTHORITY_SEED], taxProgram
  );

  // Tax Program
  const [taxAuthority] = PublicKey.findProgramAddressSync(
    [TAX_AUTHORITY_SEED], taxProgram
  );
  const [wsolIntermediary] = PublicKey.findProgramAddressSync(
    [WSOL_INTERMEDIARY_SEED], taxProgram
  );

  // Epoch Program
  const [epochState] = PublicKey.findProgramAddressSync(
    [EPOCH_STATE_SEED], epochProgram
  );
  const [carnageFund] = PublicKey.findProgramAddressSync(
    [CARNAGE_FUND_SEED], epochProgram
  );
  const [carnageSolVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_SOL_VAULT_SEED], epochProgram
  );
  const [carnageCrimeVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_CRIME_VAULT_SEED], epochProgram
  );
  const [carnageFraudVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_FRAUD_VAULT_SEED], epochProgram
  );
  const [carnageSigner] = PublicKey.findProgramAddressSync(
    [CARNAGE_SIGNER_SEED], epochProgram
  );
  const [stakingAuthority] = PublicKey.findProgramAddressSync(
    [STAKING_AUTHORITY_SEED], epochProgram
  );

  // Staking
  const [stakePool] = PublicKey.findProgramAddressSync(
    [STAKE_POOL_SEED], staking
  );
  const [escrowVault] = PublicKey.findProgramAddressSync(
    [ESCROW_VAULT_SEED], staking
  );
  const [stakeVault] = PublicKey.findProgramAddressSync(
    [STAKE_VAULT_SEED], staking
  );

  // Conversion Vault
  const VAULT_CONFIG_SEED = Buffer.from("vault_config");
  const VAULT_CRIME_SEED = Buffer.from("vault_crime");
  const VAULT_FRAUD_SEED = Buffer.from("vault_fraud");
  const VAULT_PROFIT_SEED = Buffer.from("vault_profit");

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [VAULT_CONFIG_SEED], conversionVault
  );
  const [vaultCrime] = PublicKey.findProgramAddressSync(
    [VAULT_CRIME_SEED, vaultConfig.toBuffer()], conversionVault
  );
  const [vaultFraud] = PublicKey.findProgramAddressSync(
    [VAULT_FRAUD_SEED, vaultConfig.toBuffer()], conversionVault
  );
  const [vaultProfit] = PublicKey.findProgramAddressSync(
    [VAULT_PROFIT_SEED, vaultConfig.toBuffer()], conversionVault
  );

  // -------------------------------------------------------------------------
  // Hook ExtraAccountMetaList PDAs
  // -------------------------------------------------------------------------
  function deriveExtraAccountMeta(mint: PublicKey): string {
    const [meta] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()], transferHook
    );
    return meta.toBase58();
  }

  // -------------------------------------------------------------------------
  // Bonding Curve PDAs
  // -------------------------------------------------------------------------
  const CURVE_SEED_BUF = Buffer.from("curve");
  const CURVE_TOKEN_VAULT_SEED_BUF = Buffer.from("curve_token_vault");
  const CURVE_SOL_VAULT_SEED_BUF = Buffer.from("curve_sol_vault");
  const CURVE_TAX_ESCROW_SEED_BUF = Buffer.from("tax_escrow");

  function deriveCurvePdas(mint: PublicKey) {
    const [curveState] = PublicKey.findProgramAddressSync(
      [CURVE_SEED_BUF, mint.toBuffer()], bondingCurve
    );
    const [tokenVault] = PublicKey.findProgramAddressSync(
      [CURVE_TOKEN_VAULT_SEED_BUF, mint.toBuffer()], bondingCurve
    );
    const [solVault] = PublicKey.findProgramAddressSync(
      [CURVE_SOL_VAULT_SEED_BUF, mint.toBuffer()], bondingCurve
    );
    const [taxEscrow] = PublicKey.findProgramAddressSync(
      [CURVE_TAX_ESCROW_SEED_BUF, mint.toBuffer()], bondingCurve
    );
    return {
      curveState: curveState.toBase58(),
      tokenVault: tokenVault.toBase58(),
      solVault: solVault.toBase58(),
      taxEscrow: taxEscrow.toBase58(),
    };
  }

  // -------------------------------------------------------------------------
  // Pool PDAs
  // -------------------------------------------------------------------------
  function derivePool(rawMint1: PublicKey, rawMint2: PublicKey) {
    const [mintA, mintB] = canonicalOrder(rawMint1, rawMint2);
    const [pool] = derivePoolPDA(mintA, mintB, amm);
    const { vaultA: [vA], vaultB: [vB] } = deriveVaultPDAs(pool, amm);
    return {
      pool: pool.toBase58(),
      vaultA: vA.toBase58(),
      vaultB: vB.toBase58(),
    };
  }

  // -------------------------------------------------------------------------
  // Assemble config
  // -------------------------------------------------------------------------
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cluster,
    programs: {
      amm: amm.toBase58(),
      transferHook: transferHook.toBase58(),
      taxProgram: taxProgram.toBase58(),
      epochProgram: epochProgram.toBase58(),
      staking: staking.toBase58(),
      conversionVault: conversionVault.toBase58(),
      bondingCurve: bondingCurve.toBase58(),
    },
    mints: {
      crime: crime.toBase58(),
      fraud: fraud.toBase58(),
      profit: profit.toBase58(),
    },
    pdas: {
      adminConfig: adminConfig.toBase58(),
      swapAuthority: swapAuthority.toBase58(),
      taxAuthority: taxAuthority.toBase58(),
      epochState: epochState.toBase58(),
      stakePool: stakePool.toBase58(),
      escrowVault: escrowVault.toBase58(),
      stakeVault: stakeVault.toBase58(),
      whitelistAuthority: whitelistAuthority.toBase58(),
      carnageFund: carnageFund.toBase58(),
      carnageSolVault: carnageSolVault.toBase58(),
      carnageCrimeVault: carnageCrimeVault.toBase58(),
      carnageFraudVault: carnageFraudVault.toBase58(),
      carnageSigner: carnageSigner.toBase58(),
      stakingAuthority: stakingAuthority.toBase58(),
      wsolIntermediary: wsolIntermediary.toBase58(),
      vaultConfig: vaultConfig.toBase58(),
      vaultCrime: vaultCrime.toBase58(),
      vaultFraud: vaultFraud.toBase58(),
      vaultProfit: vaultProfit.toBase58(),
    },
    pools: {
      crimeSol: derivePool(crime, NATIVE_MINT),
      fraudSol: derivePool(fraud, NATIVE_MINT),
    },
    curvePdas: {
      crime: deriveCurvePdas(crime),
      fraud: deriveCurvePdas(fraud),
    },
    hookAccounts: {
      crime: deriveExtraAccountMeta(crime),
      fraud: deriveExtraAccountMeta(fraud),
      profit: deriveExtraAccountMeta(profit),
    },
    alt: altAddress,
    treasury,
    authority: {
      deployer,
      squadsVault: null,
      transferredAt: null,
    },
  };
}

// =============================================================================
// Manifest Output
// =============================================================================

/**
 * Write the PDA manifest to disk in both JSON and Markdown formats.
 *
 * JSON: Machine-readable, consumed by verify.ts to check on-chain state.
 * Markdown: Human-readable table, useful for deployment review and documentation.
 *
 * Both files are written to scripts/deploy/ (alongside the deployment scripts).
 *
 * @param manifest - Complete PDA manifest to write
 */
export function writeManifest(manifest: PdaManifest): void {
  const outputDir = path.resolve(__dirname, "..");

  // -------------------------------------------------------------------------
  // JSON output
  // -------------------------------------------------------------------------
  const jsonPath = path.join(outputDir, "pda-manifest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2) + "\n");

  // -------------------------------------------------------------------------
  // Markdown output
  // -------------------------------------------------------------------------
  const mdPath = path.join(outputDir, "pda-manifest.md");

  let md = "";
  md += `# PDA Manifest\n\n`;
  md += `Generated: ${manifest.generatedAt}\n`;
  md += `Cluster: ${manifest.clusterUrl}\n\n`;

  // Programs table
  md += `## Programs\n\n`;
  md += `| Program | Address |\n`;
  md += `|---------|----------|\n`;
  for (const [name, addr] of Object.entries(manifest.programs)) {
    md += `| ${name} | \`${addr}\` |\n`;
  }
  md += `\n`;

  // Mints table
  md += `## Mints\n\n`;
  md += `| Token | Address |\n`;
  md += `|-------|----------|\n`;
  for (const [name, addr] of Object.entries(manifest.mints)) {
    md += `| ${name} | \`${addr}\` |\n`;
  }
  md += `\n`;

  // Protocol PDAs table
  // Map PDA names to their owning program for the extra column
  const pdaProgram: Record<string, string> = {
    WhitelistAuthority: "Transfer Hook",
    ExtraAccountMetaList_CRIME: "Transfer Hook",
    ExtraAccountMetaList_FRAUD: "Transfer Hook",
    ExtraAccountMetaList_PROFIT: "Transfer Hook",
    AdminConfig: "AMM",
    SwapAuthority: "AMM",
    TaxAuthority: "Tax Program",
    WsolIntermediary: "Tax Program",
    EpochState: "Epoch Program",
    CarnageFund: "Epoch Program",
    CarnageSolVault: "Epoch Program",
    CarnageCrimeVault: "Epoch Program",
    CarnageFraudVault: "Epoch Program",
    CarnageSigner: "Epoch Program",
    StakingAuthority: "Epoch Program",
    StakePool: "Staking",
    EscrowVault: "Staking",
    StakeVault: "Staking",
    VaultConfig: "Conversion Vault",
    VaultCrime: "Conversion Vault",
    VaultFraud: "Conversion Vault",
    VaultProfit: "Conversion Vault",
    CurveState_CRIME: "Bonding Curve",
    CurveState_FRAUD: "Bonding Curve",
    CurveTokenVault_CRIME: "Bonding Curve",
    CurveTokenVault_FRAUD: "Bonding Curve",
    CurveSolVault_CRIME: "Bonding Curve",
    CurveSolVault_FRAUD: "Bonding Curve",
    CurveTaxEscrow_CRIME: "Bonding Curve",
    CurveTaxEscrow_FRAUD: "Bonding Curve",
  };

  md += `## Protocol PDAs\n\n`;
  md += `| Name | Address | Program |\n`;
  md += `|------|---------|----------|\n`;
  for (const [name, addr] of Object.entries(manifest.pdas)) {
    const prog = pdaProgram[name] || "Unknown";
    md += `| ${name} | \`${addr}\` | ${prog} |\n`;
  }
  md += `\n`;

  // Pool addresses table
  md += `## Pool Addresses\n\n`;
  md += `| Pool | Pool PDA | Vault A | Vault B |\n`;
  md += `|------|----------|---------|----------|\n`;
  for (const [name, addrs] of Object.entries(manifest.pools)) {
    md += `| ${name} | \`${addrs.pool}\` | \`${addrs.vaultA}\` | \`${addrs.vaultB}\` |\n`;
  }
  md += `\n`;

  fs.writeFileSync(mdPath, md);
}
