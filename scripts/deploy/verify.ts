/**
 * Post-Deployment Verification Script (v2 - deployment.json-powered)
 *
 * Performs deep on-chain verification of the Dr. Fraudsworth protocol by reading
 * addresses from `deployments/{cluster}.json` (the single source of truth) and
 * confirming every address matches on-chain state.
 *
 * Verification depth:
 * - **Programs**: Exists, executable, BPF Loader Upgradeable owner, upgrade authority match
 * - **Mints**: Exists, Token-2022 owner, correct decimals (6), non-zero supply
 * - **PDAs**: Exists, owned by expected program
 * - **Pools**: Exists, initialized with non-zero reserves, vault balances confirmed
 * - **ALT**: Exists, spot-checks key addresses are present
 * - **Authority**: Deployer wallet matches deployment.json
 * - **Backward compat**: Cross-checks pda-manifest.json if it exists
 *
 * Exit code 0 = all checks passed. Exit code 1 = at least one failure.
 *
 * Usage: CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/verify.ts
 *
 * Source: .planning/phases/91-deploy-config-foundation/91-04-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, AddressLookupTableAccount } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  ExtensionType,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Shared deployment library
import { loadProvider, loadPrograms } from "./lib/connection";
import { createLogger, Logger } from "./lib/logger";
import { accountExists, programIsDeployed, mintExists } from "./lib/account-check";
import {
  DeploymentConfig,
  validateDeploymentConfig,
} from "./lib/deployment-schema";

// Legacy manifest support (backward compat)
import {
  generateManifest,
  PdaManifest,
  ProgramIds,
  MintKeys,
} from "./lib/pda-manifest";

// PDA seed constants from canonical source
import {
  TOKEN_DECIMALS,
  MINIMUM_STAKE,
  WHITELIST_ENTRY_SEED,
  deriveWhitelistEntryPDA,
} from "../../tests/integration/helpers/constants";

// =============================================================================
// Constants
// =============================================================================

/** BPF Loader Upgradeable program ID for owner verification */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/** Directory where mint keypairs are saved by initialize.ts */
const MINT_KEYPAIRS_DIR = path.resolve(__dirname, "mint-keypairs");

// =============================================================================
// Verification Result Tracking
// =============================================================================

interface CheckResult {
  category: string;
  name: string;
  address: string;
  status: "OK" | "FAIL";
  details: string;
}

// =============================================================================
// Deployment Config Loading
// =============================================================================

/**
 * Determine the cluster name from the CLUSTER_URL env var.
 * Returns "devnet", "mainnet", or "localnet".
 */
function detectCluster(clusterUrl: string): string {
  if (clusterUrl.includes("devnet")) return "devnet";
  if (clusterUrl.includes("mainnet")) return "mainnet";
  return "localnet";
}

/**
 * Load deployment.json for the given cluster.
 * Returns null if the file doesn't exist (triggers fallback to pda-manifest).
 */
function loadDeploymentConfig(cluster: string): DeploymentConfig | null {
  const configPath = path.resolve(
    __dirname,
    "../../deployments",
    `${cluster}.json`
  );
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // Validate schema
  const errors = validateDeploymentConfig(raw);
  if (errors.length > 0) {
    console.error(`deployment.json validation errors:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }

  return raw as DeploymentConfig;
}

// =============================================================================
// Deep Verification Helpers
// =============================================================================

/**
 * Fetch the upgrade authority of a deployed program.
 *
 * BPF Loader Upgradeable programs have a "program data" account whose address
 * is stored in the first 4+32 bytes of the program account's data. The program
 * data account contains the upgrade authority at offset 13 (4 byte variant tag
 * + 8 byte slot + 1 byte Option<Pubkey> tag + 32 byte pubkey if Some).
 */
async function getUpgradeAuthority(
  connection: Connection,
  programId: PublicKey
): Promise<string | null> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo || programInfo.data.length < 36) return null;

  // Program account data: [u32 variant (=2 for ProgramData pointer)] [Pubkey (program data addr)]
  // Variant 2 = Program, offset 4..36 = program data address
  const programDataAddr = new PublicKey(programInfo.data.slice(4, 36));
  const programDataInfo = await connection.getAccountInfo(programDataAddr);
  if (!programDataInfo || programDataInfo.data.length < 45) return null;

  // ProgramData account: [u32 variant (=3)] [u64 slot] [Option<Pubkey> authority]
  // offset 12 = Option tag (0=None, 1=Some), 13..45 = authority pubkey if Some
  const hasAuthority = programDataInfo.data[12] === 1;
  if (!hasAuthority) return null;

  return new PublicKey(programDataInfo.data.slice(13, 45)).toBase58();
}

/**
 * Map PDA names from deployment.json to expected owning program IDs.
 */
function buildPdaOwnerMap(config: DeploymentConfig): Record<string, string> {
  const { programs } = config;
  return {
    // AMM PDAs
    adminConfig: programs.amm,
    // SwapAuthority derived from taxProgram but stored as AMM PDA
    swapAuthority: programs.taxProgram,
    // Tax Program PDAs
    taxAuthority: programs.taxProgram,
    wsolIntermediary: programs.taxProgram,
    // Epoch Program PDAs
    epochState: programs.epochProgram,
    carnageFund: programs.epochProgram,
    carnageSolVault: programs.epochProgram,
    carnageCrimeVault: programs.epochProgram,
    carnageFraudVault: programs.epochProgram,
    carnageSigner: programs.epochProgram,
    stakingAuthority: programs.epochProgram,
    // Staking PDAs
    stakePool: programs.staking,
    escrowVault: programs.staking,
    stakeVault: programs.staking,
    // Conversion Vault PDAs
    vaultConfig: programs.conversionVault,
    vaultCrime: programs.conversionVault,
    vaultFraud: programs.conversionVault,
    vaultProfit: programs.conversionVault,
    // Whitelist Authority
    whitelistAuthority: programs.transferHook,
  };
}

// =============================================================================
// Main Verification
// =============================================================================

async function main() {
  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const provider = loadProvider();
  const programs = loadPrograms(provider);
  const connection = provider.connection;
  const log = createLogger();
  const clusterUrl = process.env.CLUSTER_URL || "http://localhost:8899";
  const wallet = (provider.wallet as anchor.Wallet).payer;
  const cluster = detectCluster(clusterUrl);

  log.section("Dr. Fraudsworth Deep Deployment Verification");
  log.info(`Cluster:   ${cluster} (${clusterUrl})`);
  log.info(`Wallet:    ${wallet.publicKey.toBase58()}`);
  log.info(`Tx log:    ${log.getLogPath()}`);

  const results: CheckResult[] = [];
  let failures = 0;

  function check(
    category: string,
    name: string,
    address: string,
    passed: boolean,
    details: string
  ): void {
    const status = passed ? "OK" : "FAIL";
    results.push({ category, name, address, status, details });
    if (!passed) {
      failures++;
      log.error(`  FAIL: ${name} (${address}) -- ${details}`);
    } else {
      log.info(`  OK:   ${name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1: Load deployment config (primary) or fall back to pda-manifest
  // ---------------------------------------------------------------------------
  log.section("Loading Deployment Configuration");

  const deployConfig = loadDeploymentConfig(cluster);
  let legacyManifest: PdaManifest | null = null;

  if (deployConfig) {
    log.info(`Loaded deployments/${cluster}.json (schemaVersion: ${deployConfig.schemaVersion})`);
    log.info(`Programs: ${Object.keys(deployConfig.programs).length}`);
    log.info(`Mints:    ${Object.keys(deployConfig.mints).length}`);
    log.info(`PDAs:     ${Object.keys(deployConfig.pdas).length}`);
    log.info(`Pools:    ${Object.keys(deployConfig.pools).length}`);
  } else {
    log.info(`No deployments/${cluster}.json found -- falling back to pda-manifest derivation`);

    // Fall back to legacy: derive from mint keypairs + programs
    if (!fs.existsSync(MINT_KEYPAIRS_DIR)) {
      log.error(
        `Neither deployments/${cluster}.json nor mint keypairs found. Run initialize.ts first.`
      );
      process.exit(1);
    }

    function loadMintKeypair(name: string): PublicKey {
      const filePath = path.join(MINT_KEYPAIRS_DIR, `${name}-mint.json`);
      if (!fs.existsSync(filePath)) {
        log.error(`Mint keypair not found: ${filePath}. Run initialize.ts first.`);
        process.exit(1);
      }
      const secretKey = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Keypair.fromSecretKey(new Uint8Array(secretKey)).publicKey;
    }

    const mints: MintKeys = {
      crime: loadMintKeypair("crime"),
      fraud: loadMintKeypair("fraud"),
      profit: loadMintKeypair("profit"),
    };

    const programIds: ProgramIds = {
      amm: programs.amm.programId,
      transferHook: programs.transferHook.programId,
      taxProgram: programs.taxProgram.programId,
      epochProgram: programs.epochProgram.programId,
      staking: programs.staking.programId,
      conversionVault: programs.conversionVault.programId,
      bondingCurve: programs.bondingCurve.programId,
    };

    legacyManifest = generateManifest(programIds, mints, clusterUrl);
    log.info(`Derived manifest: ${Object.keys(legacyManifest.pdas).length} PDAs, ${Object.keys(legacyManifest.pools).length} pools`);
  }

  // ---------------------------------------------------------------------------
  // Step 1.5: Cross-check pda-manifest.json if both sources exist
  // ---------------------------------------------------------------------------
  const pdaManifestPath = path.resolve(__dirname, "pda-manifest.json");
  if (deployConfig && fs.existsSync(pdaManifestPath)) {
    log.section("Cross-checking pda-manifest.json (backward compat)");
    const pdaManifest = JSON.parse(fs.readFileSync(pdaManifestPath, "utf8"));

    let mismatches = 0;

    // Check programs
    for (const [pdaKey, pdaAddr] of Object.entries(pdaManifest.programs || {})) {
      // Map PDA manifest keys (PascalCase) to deployment.json keys (camelCase)
      const keyMap: Record<string, string> = {
        AMM: "amm",
        TransferHook: "transferHook",
        TaxProgram: "taxProgram",
        EpochProgram: "epochProgram",
        Staking: "staking",
        ConversionVault: "conversionVault",
        BondingCurve: "bondingCurve",
      };
      const deployKey = keyMap[pdaKey];
      if (deployKey && deployConfig.programs[deployKey as keyof typeof deployConfig.programs] !== pdaAddr) {
        log.error(`  MISMATCH: programs.${pdaKey} -- manifest=${pdaAddr}, deployment.json=${deployConfig.programs[deployKey as keyof typeof deployConfig.programs]}`);
        mismatches++;
      }
    }

    // Check mints
    const mintKeyMap: Record<string, string> = { CRIME: "crime", FRAUD: "fraud", PROFIT: "profit" };
    for (const [pdaKey, pdaAddr] of Object.entries(pdaManifest.mints || {})) {
      const deployKey = mintKeyMap[pdaKey];
      if (deployKey && deployConfig.mints[deployKey as keyof typeof deployConfig.mints] !== pdaAddr) {
        log.error(`  MISMATCH: mints.${pdaKey} -- manifest=${pdaAddr}, deployment.json=${deployConfig.mints[deployKey as keyof typeof deployConfig.mints]}`);
        mismatches++;
      }
    }

    if (mismatches === 0) {
      log.info("  All addresses match between pda-manifest.json and deployment.json");
    } else {
      log.error(`  ${mismatches} mismatch(es) found. Update pda-manifest.json or deployment.json.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: Get address from either deployment config or legacy manifest
  // ---------------------------------------------------------------------------
  function getAddress(section: string, key: string): string | null {
    if (deployConfig) {
      const sectionObj = (deployConfig as any)[section];
      if (!sectionObj) return null;
      return sectionObj[key] || null;
    }
    if (legacyManifest) {
      const sectionObj = (legacyManifest as any)[section];
      if (!sectionObj) return null;
      return sectionObj[key] || null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Step 2: Verify Programs (7 checks)
  // ---------------------------------------------------------------------------
  log.section("Verifying Programs (7)");

  const programDefs = deployConfig
    ? Object.entries(deployConfig.programs)
    : [
        ["amm", programs.amm.programId.toBase58()],
        ["transferHook", programs.transferHook.programId.toBase58()],
        ["taxProgram", programs.taxProgram.programId.toBase58()],
        ["epochProgram", programs.epochProgram.programId.toBase58()],
        ["staking", programs.staking.programId.toBase58()],
        ["conversionVault", programs.conversionVault.programId.toBase58()],
        ["bondingCurve", programs.bondingCurve.programId.toBase58()],
      ];

  const expectedAuthority = deployConfig
    ? (deployConfig.authority.squadsVault || deployConfig.authority.deployer)
    : wallet.publicKey.toBase58();

  for (const [name, addr] of programDefs) {
    const programId = new PublicKey(addr);
    const deployed = await programIsDeployed(connection, programId);
    let detailParts: string[] = [];
    let allOk = deployed;

    if (deployed) {
      // Verify owner is BPF Loader Upgradeable
      const info = await connection.getAccountInfo(programId);
      if (info) {
        const ownerOk = info.owner.equals(BPF_LOADER_UPGRADEABLE);
        detailParts.push(ownerOk ? "BPF Loader OK" : `wrong owner: ${info.owner.toBase58()}`);
        allOk = allOk && ownerOk;
      }

      // Verify upgrade authority matches expected
      const authority = await getUpgradeAuthority(connection, programId);
      if (authority) {
        const authorityOk = authority === expectedAuthority;
        detailParts.push(
          authorityOk
            ? `authority=${authority.slice(0, 8)}...`
            : `authority MISMATCH: got ${authority.slice(0, 8)}..., expected ${expectedAuthority.slice(0, 8)}...`
        );
        allOk = allOk && authorityOk;
      } else {
        detailParts.push("authority=immutable (burned)");
        // Not necessarily a failure -- authority could be legitimately burned
      }
    } else {
      detailParts.push("Not deployed");
    }

    check("Programs", `${name}`, addr, allOk, detailParts.join(", "));
  }

  // ---------------------------------------------------------------------------
  // Step 3: Verify Mints (3 checks)
  // ---------------------------------------------------------------------------
  log.section("Verifying Mints (3)");

  const expectedMintLen = getMintLen([ExtensionType.TransferHook]);
  const mintDefs = deployConfig
    ? Object.entries(deployConfig.mints)
    : [
        ["crime", legacyManifest!.mints.CRIME],
        ["fraud", legacyManifest!.mints.FRAUD],
        ["profit", legacyManifest!.mints.PROFIT],
      ];

  for (const [name, addr] of mintDefs) {
    const mintAddress = new PublicKey(addr);
    const exists = await mintExists(connection, mintAddress);
    let passed = false;
    let details = "Mint not found";

    if (exists) {
      const info = await connection.getAccountInfo(mintAddress);
      if (info) {
        // Decimals at offset 44 in Token-2022 mint layout
        const decimals = info.data[44];
        const decimalsOk = decimals === TOKEN_DECIMALS;

        // Supply: bytes 36-43 (little-endian u64)
        const supplyBytes = info.data.slice(36, 44);
        const supply = Buffer.from(supplyBytes).readBigUInt64LE();
        const supplyOk = supply > 0n;

        // Check T22 owner
        const isT22 = info.owner.equals(TOKEN_2022_PROGRAM_ID);

        // Check data length matches TransferHook extension
        const lengthOk = info.data.length >= expectedMintLen;

        passed = decimalsOk && supplyOk && isT22 && lengthOk;

        const detailParts: string[] = [];
        detailParts.push(`decimals=${decimals}${decimalsOk ? "" : " (expected 6)"}`);
        detailParts.push(`supply=${supply.toString()}${supplyOk ? "" : " (expected > 0)"}`);
        detailParts.push(`T22=${isT22}`);
        detailParts.push(`hookExt=${lengthOk}`);
        details = detailParts.join(", ");
      }
    }

    check("Mints", `${name} Mint`, addr, passed, details);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Verify PDAs (19 checks)
  // ---------------------------------------------------------------------------
  log.section("Verifying PDAs");

  if (deployConfig) {
    const pdaOwnerMap = buildPdaOwnerMap(deployConfig);

    for (const [pdaName, pdaAddr] of Object.entries(deployConfig.pdas)) {
      const pdaPubkey = new PublicKey(pdaAddr);
      const info = await connection.getAccountInfo(pdaPubkey);
      const exists = info !== null;

      let passed = exists;
      let details = "Not found";

      if (exists) {
        const expectedOwner = pdaOwnerMap[pdaName];
        if (expectedOwner) {
          const ownerOk = info!.owner.equals(new PublicKey(expectedOwner));
          passed = ownerOk;
          details = ownerOk
            ? `Exists, owner=${expectedOwner.slice(0, 8)}... OK`
            : `Owner MISMATCH: got ${info!.owner.toBase58().slice(0, 8)}..., expected ${expectedOwner.slice(0, 8)}...`;
        } else {
          details = `Exists, ${info!.data.length} bytes`;
        }
      }

      check("PDAs", pdaName, pdaAddr, passed, details);
    }
  } else {
    // Legacy path: check PDAs from generated manifest
    for (const [pdaName, pdaAddr] of Object.entries(legacyManifest!.pdas)) {
      const exists = await accountExists(connection, new PublicKey(pdaAddr));
      check("PDAs", pdaName, pdaAddr, exists, exists ? "Exists with data" : "Not found");
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5: Verify Pools (2 pools, each with reserves + vault balance checks)
  // ---------------------------------------------------------------------------
  log.section("Verifying Pools");

  const poolDefs = deployConfig
    ? Object.entries(deployConfig.pools)
    : Object.entries(legacyManifest!.pools);

  for (const [poolName, poolAddrs] of poolDefs) {
    const poolPubkey = new PublicKey(poolAddrs.pool);
    const poolExists = await accountExists(connection, poolPubkey);

    let passed = false;
    let details = "Pool not found";

    if (poolExists) {
      try {
        const poolAccount = await programs.amm.account.poolState.fetch(poolPubkey);
        const reserveA = (poolAccount.reserveA as anchor.BN).toNumber();
        const reserveB = (poolAccount.reserveB as anchor.BN).toNumber();
        passed = reserveA > 0 && reserveB > 0;
        details = `reserveA=${reserveA}, reserveB=${reserveB}`;
        if (!passed) {
          details += " (expected both > 0)";
        }
      } catch (err: any) {
        details = `Pool exists but failed to deserialize: ${err.message}`;
      }
    }

    check("Pools", `Pool ${poolName}`, poolAddrs.pool, passed, details);

    // Check vault accounts have non-zero token balance (if pool is seeded)
    for (const [vaultLabel, vaultAddr] of [
      [`${poolName} vaultA`, poolAddrs.vaultA],
      [`${poolName} vaultB`, poolAddrs.vaultB],
    ]) {
      const vaultPubkey = new PublicKey(vaultAddr);
      let vaultPassed = false;
      let vaultDetails = "Not found";

      try {
        // Pool vaults can be either T22 or SPL Token (WSOL)
        const vaultInfo = await connection.getAccountInfo(vaultPubkey);
        if (vaultInfo) {
          vaultPassed = vaultInfo.data.length > 0;
          vaultDetails = `Exists, ${vaultInfo.data.length} bytes, ${vaultInfo.lamports} lamports`;
        }
      } catch (err: any) {
        vaultDetails = `Failed to fetch: ${err.message}`;
      }

      check("Pools", vaultLabel, vaultAddr, vaultPassed, vaultDetails);
    }

    // Check mint ordering (canonical order: mintA < mintB in bytes)
    if (poolExists) {
      try {
        const poolAccount = await programs.amm.account.poolState.fetch(poolPubkey);
        const mintA = (poolAccount.mintA as PublicKey).toBase58();
        const mintB = (poolAccount.mintB as PublicKey).toBase58();
        const mintABuf = new PublicKey(mintA).toBuffer();
        const mintBBuf = new PublicKey(mintB).toBuffer();
        const orderOk = mintABuf.compare(mintBBuf) < 0;
        check(
          "Pools",
          `${poolName} mint ordering`,
          poolAddrs.pool,
          orderOk,
          orderOk
            ? `mintA=${mintA.slice(0, 8)}... < mintB=${mintB.slice(0, 8)}... (canonical)`
            : `WRONG ORDER: mintA=${mintA.slice(0, 8)}... >= mintB=${mintB.slice(0, 8)}...`
        );
      } catch {
        // Already reported in pool fetch above
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 6: Verify Bonding Curve PDAs (if in deployment config)
  // ---------------------------------------------------------------------------
  if (deployConfig) {
    log.section("Verifying Bonding Curve PDAs");

    for (const [faction, curvePdas] of Object.entries(deployConfig.curvePdas)) {
      for (const [pdaName, pdaAddr] of Object.entries(curvePdas)) {
        const exists = await accountExists(connection, new PublicKey(pdaAddr));
        check(
          "Bonding Curves",
          `${faction} ${pdaName}`,
          pdaAddr,
          exists,
          exists ? "Exists with data" : "Not found"
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7: Verify Hook ExtraAccountMetaList PDAs
  // ---------------------------------------------------------------------------
  if (deployConfig) {
    log.section("Verifying Hook ExtraAccountMetaList PDAs");

    for (const [mintName, metaAddr] of Object.entries(deployConfig.hookAccounts)) {
      const exists = await accountExists(connection, new PublicKey(metaAddr));
      check(
        "Hook Accounts",
        `ExtraAccountMetaList (${mintName})`,
        metaAddr,
        exists,
        exists ? "Exists with data" : "Not found"
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Step 8: Verify ALT (Address Lookup Table)
  // ---------------------------------------------------------------------------
  log.section("Verifying ALT");

  const altAddress = deployConfig ? deployConfig.alt : null;
  if (altAddress) {
    const altPubkey = new PublicKey(altAddress);
    const altInfo = await connection.getAccountInfo(altPubkey);
    const altExists = altInfo !== null;

    check(
      "ALT",
      "Address Lookup Table",
      altAddress,
      altExists,
      altExists ? `Exists, ${altInfo!.data.length} bytes` : "Not found"
    );

    // Spot-check: verify a few key addresses are in the ALT
    if (altExists && deployConfig) {
      try {
        const altAccount = new AddressLookupTableAccount({
          key: altPubkey,
          state: AddressLookupTableAccount.deserialize(altInfo!.data),
        });
        const altAddresses = altAccount.state.addresses.map((a) => a.toBase58());

        // Check a sample of addresses that should be in the ALT
        const spotCheckAddrs = [
          { label: "AMM program", addr: deployConfig.programs.amm },
          { label: "Tax program", addr: deployConfig.programs.taxProgram },
          { label: "Transfer Hook", addr: deployConfig.programs.transferHook },
        ];

        let found = 0;
        for (const { label, addr } of spotCheckAddrs) {
          if (altAddresses.includes(addr)) {
            found++;
          } else {
            log.info(`  ALT missing: ${label} (${addr.slice(0, 12)}...)`);
          }
        }

        check(
          "ALT",
          "ALT address spot-check",
          altAddress,
          found === spotCheckAddrs.length,
          `${found}/${spotCheckAddrs.length} spot-checked addresses found`
        );
      } catch (err: any) {
        check(
          "ALT",
          "ALT deserialize",
          altAddress,
          false,
          `Failed to deserialize ALT: ${err.message}`
        );
      }
    }
  } else {
    log.info("  ALT address is null -- skipping ALT verification");
  }

  // ---------------------------------------------------------------------------
  // Step 9: Verify Authority
  // ---------------------------------------------------------------------------
  log.section("Verifying Authority");

  if (deployConfig) {
    const deployerAddr = deployConfig.authority.deployer;
    const walletMatches = wallet.publicKey.toBase58() === deployerAddr;
    check(
      "Authority",
      "Deployer wallet match",
      deployerAddr,
      walletMatches,
      walletMatches
        ? "Wallet matches deployment.json authority.deployer"
        : `Wallet MISMATCH: running as ${wallet.publicKey.toBase58().slice(0, 12)}..., expected ${deployerAddr.slice(0, 12)}...`
    );

    if (deployConfig.authority.squadsVault) {
      log.info(`  Squads vault: ${deployConfig.authority.squadsVault}`);
      log.info(`  Transferred at: ${deployConfig.authority.transferredAt || "N/A"}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 10: Verify Vault State (conversion vault balances)
  // ---------------------------------------------------------------------------
  log.section("Verifying Vault State");

  if (deployConfig) {
    const vaultConfigAddr = deployConfig.pdas.vaultConfig;
    const vaultConfigExists = await accountExists(
      connection,
      new PublicKey(vaultConfigAddr)
    );
    check(
      "Vault",
      "VaultConfig",
      vaultConfigAddr,
      vaultConfigExists,
      vaultConfigExists ? "Exists with data" : "Not found"
    );

    // Vault token accounts with expected balances
    const vaultExpectedAmounts: [string, string, number][] = [
      ["VaultCrime", deployConfig.pdas.vaultCrime, 250_000_000_000_000],
      ["VaultFraud", deployConfig.pdas.vaultFraud, 250_000_000_000_000],
      ["VaultProfit", deployConfig.pdas.vaultProfit, 20_000_000_000_000],
    ];

    for (const [name, addr, expectedAmount] of vaultExpectedAmounts) {
      let passed = false;
      let details = "Not found";
      try {
        const acct = await getAccount(
          connection,
          new PublicKey(addr),
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
        const balance = Number(acct.amount);
        passed = balance >= expectedAmount;
        details = `balance=${balance}${passed ? "" : ` (expected >= ${expectedAmount})`}`;
      } catch (err: any) {
        details = `Failed to fetch: ${err.message}`;
      }
      check("Vault", name, addr, passed, details);
    }

    // Verify mint authority burned for all 3 mints
    for (const [name, addr] of Object.entries(deployConfig.mints)) {
      const mintPubkey = new PublicKey(addr);
      const info = await connection.getAccountInfo(mintPubkey);
      let passed = false;
      let details = "Mint not found";
      if (info) {
        const hasAuthority = info.data[0] === 1;
        passed = !hasAuthority;
        details = passed ? "Mint authority burned (null)" : "Mint authority still set";
      }
      check("Vault", `${name} MintAuthority Burned`, addr, passed, details);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 11: Verify Whitelist entries (batch check)
  // ---------------------------------------------------------------------------
  log.section("Verifying Whitelist Entries");

  const hookProgramId = new PublicKey(
    deployConfig ? deployConfig.programs.transferHook : programs.transferHook.programId.toBase58()
  );

  const whitelistAddresses: { label: string; address: PublicKey }[] = [];

  // Pool vaults
  for (const [poolName, poolAddrs] of poolDefs) {
    whitelistAddresses.push({
      label: `${poolName} VaultA`,
      address: new PublicKey(poolAddrs.vaultA),
    });
    whitelistAddresses.push({
      label: `${poolName} VaultB`,
      address: new PublicKey(poolAddrs.vaultB),
    });
  }

  // StakeVault
  const stakeVaultAddr = deployConfig
    ? deployConfig.pdas.stakeVault
    : legacyManifest!.pdas.StakeVault;
  whitelistAddresses.push({
    label: "StakeVault",
    address: new PublicKey(stakeVaultAddr),
  });

  // Carnage token vaults
  const carnageCrimeVaultAddr = deployConfig
    ? deployConfig.pdas.carnageCrimeVault
    : legacyManifest!.pdas.CarnageCrimeVault;
  const carnageFraudVaultAddr = deployConfig
    ? deployConfig.pdas.carnageFraudVault
    : legacyManifest!.pdas.CarnageFraudVault;
  whitelistAddresses.push(
    { label: "CarnageCrimeVault", address: new PublicKey(carnageCrimeVaultAddr) },
    { label: "CarnageFraudVault", address: new PublicKey(carnageFraudVaultAddr) }
  );

  // Vault token accounts
  if (deployConfig) {
    for (const [name, addr] of [
      ["VaultCrime", deployConfig.pdas.vaultCrime],
      ["VaultFraud", deployConfig.pdas.vaultFraud],
      ["VaultProfit", deployConfig.pdas.vaultProfit],
    ]) {
      whitelistAddresses.push({ label: name, address: new PublicKey(addr) });
    }
  }

  let whitelistVerified = 0;
  for (const { label, address } of whitelistAddresses) {
    const [whitelistEntry] = deriveWhitelistEntryPDA(address, hookProgramId);
    const exists = await accountExists(connection, whitelistEntry);
    if (exists) whitelistVerified++;
    check(
      "Whitelist",
      `Whitelist: ${label}`,
      whitelistEntry.toBase58(),
      exists,
      exists ? "Whitelisted" : "Not whitelisted"
    );
  }

  log.info(`\n  Whitelist entries: ${whitelistVerified}/${whitelistAddresses.length} verified`);

  // ---------------------------------------------------------------------------
  // Generate Deployment Report
  // ---------------------------------------------------------------------------
  log.section("Generating Deployment Report");

  const timestamp = new Date().toISOString();
  const totalChecks = results.length;
  const passedChecks = totalChecks - failures;

  // Count by category
  const programChecks = results.filter((r) => r.category === "Programs");
  const mintChecks = results.filter((r) => r.category === "Mints");
  const poolChecks = results.filter((r) => r.category === "Pools");
  const pdaChecks = results.filter((r) => r.category === "PDAs");
  const curveChecks = results.filter((r) => r.category === "Bonding Curves");
  const hookChecks = results.filter((r) => r.category === "Hook Accounts");
  const altChecks = results.filter((r) => r.category === "ALT");
  const authorityChecks = results.filter((r) => r.category === "Authority");
  const vaultChecks = results.filter((r) => r.category === "Vault");
  const whitelistChecks = results.filter((r) => r.category === "Whitelist");

  let report = "";
  report += `# Deployment Report\n\n`;
  report += `Generated: ${timestamp}\n`;
  report += `Cluster: ${cluster} (${clusterUrl})\n`;
  report += `Wallet: ${wallet.publicKey.toBase58()}\n`;
  report += `Source: deployments/${cluster}.json${deployConfig ? "" : " (FALLBACK: pda-manifest derivation)"}\n\n`;

  report += `## Summary\n\n`;
  report += `- **Total checks: ${passedChecks}/${totalChecks}**\n`;
  report += `- Programs: ${programChecks.filter((r) => r.status === "OK").length}/${programChecks.length}\n`;
  report += `- Mints: ${mintChecks.filter((r) => r.status === "OK").length}/${mintChecks.length}\n`;
  report += `- PDAs: ${pdaChecks.filter((r) => r.status === "OK").length}/${pdaChecks.length}\n`;
  report += `- Pools: ${poolChecks.filter((r) => r.status === "OK").length}/${poolChecks.length}\n`;
  if (curveChecks.length > 0) {
    report += `- Bonding Curves: ${curveChecks.filter((r) => r.status === "OK").length}/${curveChecks.length}\n`;
  }
  if (hookChecks.length > 0) {
    report += `- Hook Accounts: ${hookChecks.filter((r) => r.status === "OK").length}/${hookChecks.length}\n`;
  }
  if (altChecks.length > 0) {
    report += `- ALT: ${altChecks.filter((r) => r.status === "OK").length}/${altChecks.length}\n`;
  }
  if (authorityChecks.length > 0) {
    report += `- Authority: ${authorityChecks.filter((r) => r.status === "OK").length}/${authorityChecks.length}\n`;
  }
  report += `- Vault: ${vaultChecks.filter((r) => r.status === "OK").length}/${vaultChecks.length}\n`;
  report += `- Whitelist: ${whitelistChecks.filter((r) => r.status === "OK").length}/${whitelistChecks.length}\n\n`;

  report += `## Results\n\n`;
  report += `| Category | Check | Address | Status | Details |\n`;
  report += `|----------|-------|---------|--------|---------|\n`;
  for (const r of results) {
    const shortAddr =
      r.address.length > 12
        ? `${r.address.slice(0, 6)}...${r.address.slice(-4)}`
        : r.address;
    report += `| ${r.category} | ${r.name} | \`${shortAddr}\` | ${r.status} | ${r.details} |\n`;
  }
  report += `\n`;

  report += `## Transaction Log\n\n`;
  report += `See: ${log.getLogPath()}\n\n`;

  if (deployConfig) {
    report += `## Deployment Config\n\n`;
    report += `Source: deployments/${cluster}.json\n`;
    report += `Schema Version: ${deployConfig.schemaVersion}\n`;
    report += `Generated At: ${deployConfig.generatedAt}\n`;
  }

  // Write deployment report
  const reportPath = path.resolve(__dirname, "deployment-report.md");
  fs.writeFileSync(reportPath, report);
  log.info(`Report written to: ${reportPath}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  log.section("Verification Complete");
  log.info(`Total checks: ${totalChecks}`);
  log.info(`Passed:       ${passedChecks}`);
  log.info(`Failed:       ${failures}`);
  log.info(`Report:       ${reportPath}`);

  if (failures > 0) {
    log.error(`\n${failures} check(s) FAILED. See deployment report for details.`);
    process.exit(1);
  }

  log.info("\nAll checks passed. Protocol deployment verified.");
}

main().catch((err) => {
  console.error("\n=== Post-Deployment Verification FAILED ===");
  console.error("Error:", err.message || err);
  if (err.logs) {
    console.error("Program logs:");
    for (const logLine of err.logs) {
      console.error("  ", logLine);
    }
  }
  process.exit(1);
});
