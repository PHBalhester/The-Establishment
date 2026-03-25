/**
 * Deployment Adapter -- loads deployments/devnet.json and returns PDAManifest shape.
 *
 * Why this adapter exists:
 * All E2E scripts were written against the PDAManifest interface, which uses
 * PascalCase PDA keys (e.g., EscrowVault) and pool keys like "CRIME/SOL".
 * The canonical address source (deployments/devnet.json, Phase 91) uses camelCase
 * keys (e.g., escrowVault) and pool keys like "crimeSol".
 *
 * Rather than rewriting every script's PDA references, this adapter bridges the
 * two conventions in a single place.
 *
 * Usage:
 *   import { loadDeployment } from "./lib/load-deployment";
 *   const manifest = loadDeployment();
 */

import * as fs from "fs";
import * as path from "path";
import { PDAManifest } from "../devnet-e2e-validation";

/**
 * Load deployments/devnet.json and return it in PDAManifest shape.
 *
 * Maps:
 * - programs: camelCase -> PascalCase
 * - mints: camelCase -> UPPERCASE
 * - pdas: camelCase -> PascalCase
 * - pools: "crimeSol" -> "CRIME/SOL"
 *
 * Also carries through hookAccounts, alt, treasury, and curvePdas as extra
 * fields on the returned object (PDAManifest.pdas is Record<string, string>
 * so they merge cleanly).
 */
export function loadDeployment(): PDAManifest {
  const deployPath = path.resolve(
    __dirname,
    "../../../deployments/devnet.json"
  );
  const d = JSON.parse(fs.readFileSync(deployPath, "utf-8"));

  // Map PDA keys from camelCase (devnet.json) to PascalCase (PDAManifest)
  const pdas: Record<string, string> = {};

  // Direct camelCase -> PascalCase mappings
  const pdaMap: Record<string, string> = {
    adminConfig: "AdminConfig",
    swapAuthority: "SwapAuthority",
    taxAuthority: "TaxAuthority",
    epochState: "EpochState",
    stakePool: "StakePool",
    escrowVault: "EscrowVault",
    stakeVault: "StakeVault",
    whitelistAuthority: "WhitelistAuthority",
    carnageFund: "CarnageFund",
    carnageSolVault: "CarnageSolVault",
    carnageCrimeVault: "CarnageCrimeVault",
    carnageFraudVault: "CarnageFraudVault",
    carnageSigner: "CarnageSigner",
    stakingAuthority: "StakingAuthority",
    wsolIntermediary: "WsolIntermediary",
    vaultConfig: "VaultConfig",
    vaultCrime: "VaultCrime",
    vaultFraud: "VaultFraud",
    vaultProfit: "VaultProfit",
  };

  for (const [camel, pascal] of Object.entries(pdaMap)) {
    if (d.pdas[camel]) {
      pdas[pascal] = d.pdas[camel];
    }
  }

  // Hook accounts mapped as ExtraAccountMetaList_{TOKEN} for alt-helper.ts
  if (d.hookAccounts) {
    if (d.hookAccounts.crime) {
      pdas["ExtraAccountMetaList_CRIME"] = d.hookAccounts.crime;
    }
    if (d.hookAccounts.fraud) {
      pdas["ExtraAccountMetaList_FRAUD"] = d.hookAccounts.fraud;
    }
    if (d.hookAccounts.profit) {
      pdas["ExtraAccountMetaList_PROFIT"] = d.hookAccounts.profit;
    }
  }

  return {
    programs: {
      AMM: d.programs.amm,
      TransferHook: d.programs.transferHook,
      TaxProgram: d.programs.taxProgram,
      EpochProgram: d.programs.epochProgram,
      Staking: d.programs.staking,
      ConversionVault: d.programs.conversionVault,
      BondingCurve: d.programs.bondingCurve,
    },
    mints: {
      CRIME: d.mints.crime,
      FRAUD: d.mints.fraud,
      PROFIT: d.mints.profit,
    },
    pdas,
    pools: {
      "CRIME/SOL": d.pools.crimeSol,
      "FRAUD/SOL": d.pools.fraudSol,
    },
  };
}
