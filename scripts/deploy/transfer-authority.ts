/**
 * Authority Transfer Script
 *
 * Transfers all program and admin PDA authorities to the Squads vault PDA:
 * - 7 program upgrade authorities (BPFLoaderUpgradeable)
 * - 3 admin PDA authorities (AMM AdminConfig, WhitelistAuthority, BcAdminConfig)
 * - 3 token metadata update authorities (CRIME, FRAUD, PROFIT mints)
 *
 * Idempotent: checks current authority before transferring, skips if already transferred.
 *
 * Updates deployments/{cluster}.json with transferredAt timestamp.
 *
 * Usage:
 *   set -a && source .env.devnet && set +a
 *   npx tsx scripts/deploy/transfer-authority.ts
 *
 * Source: .planning/phases/97-squads-governance/97-02-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { BorshCoder, Idl } from "@coral-xyz/anchor";
import {
  tokenMetadataUpdateAuthority,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// =============================================================================
// Constants
// =============================================================================

const ROOT = path.resolve(__dirname, "../..");
const KEYPAIRS_DIR = path.join(ROOT, "keypairs");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

// =============================================================================
// Helpers
// =============================================================================

function detectCluster(url: string): string {
  if (url.includes("devnet")) return "devnet";
  if (url.includes("mainnet")) return "mainnet";
  return "localnet";
}

function loadDeploymentConfig(cluster: string): any {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function saveDeploymentConfig(cluster: string, config: any): void {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Fetch the upgrade authority of a deployed program.
 * Returns the authority pubkey string, or null if burned/immutable.
 */
async function getUpgradeAuthority(
  connection: Connection,
  programId: PublicKey
): Promise<string | null> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo || programInfo.data.length < 36) return null;

  const programDataAddr = new PublicKey(programInfo.data.slice(4, 36));
  const programDataInfo = await connection.getAccountInfo(programDataAddr);
  if (!programDataInfo || programDataInfo.data.length < 45) return null;

  const hasAuthority = programDataInfo.data[12] === 1;
  if (!hasAuthority) return null;

  return new PublicKey(programDataInfo.data.slice(13, 45)).toBase58();
}

/**
 * Get ProgramData address for a given program.
 */
async function getProgramDataAddress(
  connection: Connection,
  programId: PublicKey
): Promise<PublicKey | null> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo || programInfo.data.length < 36) return null;
  return new PublicKey(programInfo.data.slice(4, 36));
}

/**
 * Transfer program upgrade authority using BPFLoaderUpgradeable SetAuthority.
 *
 * We construct the instruction in TypeScript to avoid CLI path-with-spaces issues
 * (project dir is "Dr Fraudsworth").
 *
 * BPFLoaderUpgradeable SetAuthority instruction:
 * - Instruction index: 4 (u32 LE)
 * - Data: ONLY [4, 0, 0, 0] (variant index)
 * - Accounts: [programData (writable)] [currentAuthority (signer)] [newAuthority (NOT signer)]
 *
 * CRITICAL: The new authority is passed as the 3rd ACCOUNT, NOT in instruction data.
 * If the 3rd account is omitted, the program sets authority to None (burns it).
 * This is equivalent to --skip-new-upgrade-authority-signer-check (new authority not a signer).
 */
function makeSetAuthorityIx(
  programDataAddress: PublicKey,
  currentAuthority: PublicKey,
  newAuthority: PublicKey
): TransactionInstruction {
  // Instruction data: ONLY the variant index (4 = SetAuthority)
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: currentAuthority, isSigner: true, isWritable: false },
      // New authority as 3rd account (NOT a signer = skip-new-upgrade-authority-signer-check)
      { pubkey: newAuthority, isSigner: false, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

// =============================================================================
// Main
// =============================================================================

interface TransferResult {
  name: string;
  type: "upgrade" | "admin-pda" | "metadata";
  status: "transferred" | "already-transferred" | "skipped" | "failed";
  details: string;
}

async function main() {
  const clusterUrl = process.env.CLUSTER_URL || "https://api.devnet.solana.com";
  const cluster = detectCluster(clusterUrl);
  const commitment = (process.env.COMMITMENT as any) || "confirmed";
  const connection = new Connection(clusterUrl, commitment);

  console.log("=== Authority Transfer to Squads Vault ===\n");
  console.log(`Cluster: ${cluster}`);

  // Load deployer wallet
  const walletPath = process.env.WALLET || path.join(KEYPAIRS_DIR, "devnet-wallet.json");
  const deployer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);

  // Load deployment config
  const config = loadDeploymentConfig(cluster);
  const vaultPda = config.authority.squadsVault;
  if (!vaultPda) {
    throw new Error(
      "authority.squadsVault not set in deployment config. Run setup-squads.ts first."
    );
  }
  console.log(`Vault PDA: ${vaultPda}\n`);

  const results: TransferResult[] = [];

  // =========================================================================
  // Part 1: Transfer 7 program upgrade authorities
  // =========================================================================
  console.log("=== Part 1: Program Upgrade Authorities (7) ===\n");

  const programs: [string, string][] = [
    ["amm", config.programs.amm],
    ["transferHook", config.programs.transferHook],
    ["taxProgram", config.programs.taxProgram],
    ["epochProgram", config.programs.epochProgram],
    ["staking", config.programs.staking],
    ["conversionVault", config.programs.conversionVault],
    ["bondingCurve", config.programs.bondingCurve],
  ];

  for (const [name, programId] of programs) {
    console.log(`--- ${name} (${programId}) ---`);

    const currentAuth = await getUpgradeAuthority(connection, new PublicKey(programId));

    if (currentAuth === vaultPda) {
      console.log(`  Already transferred to vault. Skipping.`);
      results.push({
        name,
        type: "upgrade",
        status: "already-transferred",
        details: "Authority already held by vault PDA",
      });
      continue;
    }

    if (currentAuth === null) {
      console.log(`  Authority burned/immutable. Skipping.`);
      results.push({
        name,
        type: "upgrade",
        status: "skipped",
        details: "Authority is immutable (burned)",
      });
      continue;
    }

    if (currentAuth !== deployer.publicKey.toBase58()) {
      console.log(`  WARNING: Authority is ${currentAuth}, not deployer. Skipping.`);
      results.push({
        name,
        type: "upgrade",
        status: "skipped",
        details: `Authority held by ${currentAuth} (not deployer)`,
      });
      continue;
    }

    // Transfer using BPFLoaderUpgradeable SetAuthority instruction
    try {
      const programDataAddr = await getProgramDataAddress(
        connection,
        new PublicKey(programId)
      );
      if (!programDataAddr) throw new Error("Could not find ProgramData address");

      const ix = makeSetAuthorityIx(
        programDataAddr,
        deployer.publicKey,
        new PublicKey(vaultPda)
      );

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
        skipPreflight: true,
      });
      console.log(`  Transferred! TX: ${sig}`);

      // Verify
      const newAuth = await getUpgradeAuthority(connection, new PublicKey(programId));
      if (newAuth === vaultPda) {
        console.log(`  Verified: authority = vault PDA`);
        results.push({
          name,
          type: "upgrade",
          status: "transferred",
          details: `TX: ${sig}`,
        });
      } else {
        console.log(`  WARNING: Post-transfer authority = ${newAuth} (expected vault PDA)`);
        results.push({
          name,
          type: "upgrade",
          status: "failed",
          details: `Post-transfer authority mismatch: ${newAuth}`,
        });
      }
    } catch (err: any) {
      console.error(`  FAILED: ${err.message}`);
      results.push({
        name,
        type: "upgrade",
        status: "failed",
        details: err.message,
      });
    }
  }

  // =========================================================================
  // Part 2: Transfer 3 admin PDA authorities
  // =========================================================================
  console.log("\n=== Part 2: Admin PDA Authorities (3) ===\n");

  // --- AMM AdminConfig ---
  console.log("--- AMM AdminConfig ---");
  try {
    const adminConfigPda = new PublicKey(config.pdas.adminConfig);
    const acct = await connection.getAccountInfo(adminConfigPda);
    if (!acct) throw new Error("AdminConfig PDA not found");

    // AdminConfig layout: 8 disc + 32 admin + 1 bump
    const currentAdmin = new PublicKey(acct.data.subarray(8, 40)).toBase58();
    console.log(`  Current admin: ${currentAdmin}`);

    if (currentAdmin === vaultPda) {
      console.log(`  Already transferred to vault. Skipping.`);
      results.push({
        name: "AMM AdminConfig",
        type: "admin-pda",
        status: "already-transferred",
        details: "Admin already held by vault PDA",
      });
    } else if (currentAdmin !== deployer.publicKey.toBase58()) {
      console.log(`  WARNING: Admin is not deployer (stuck on ${currentAdmin}). Cannot transfer.`);
      console.log(`  This is a known devnet issue from 97-01 smoke test.`);
      console.log(`  On mainnet (fresh deploy), deployer will hold admin and transfer will work.`);
      results.push({
        name: "AMM AdminConfig",
        type: "admin-pda",
        status: "skipped",
        details: `Admin stuck on ${currentAdmin} (devnet 97-01 smoke test artifact)`,
      });
    } else {
      // Transfer using AMM IDL
      const ammIdl: Idl = JSON.parse(
        fs.readFileSync(path.join(ROOT, "target/idl/amm.json"), "utf-8")
      );
      const coder = new BorshCoder(ammIdl);
      // CRITICAL: IDL uses snake_case field names -- camelCase encodes zeros
      const data = coder.instruction.encode("transfer_admin", {
        new_admin: new PublicKey(vaultPda),
      });
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
          { pubkey: adminConfigPda, isSigner: false, isWritable: true },
        ],
        programId: new PublicKey(config.programs.amm),
        data,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
        skipPreflight: true,
      });
      console.log(`  Transferred! TX: ${sig}`);

      // Verify
      const acct2 = await connection.getAccountInfo(adminConfigPda);
      const newAdmin = acct2
        ? new PublicKey(acct2.data.subarray(8, 40)).toBase58()
        : null;
      if (newAdmin === vaultPda) {
        console.log(`  Verified: admin = vault PDA`);
        results.push({
          name: "AMM AdminConfig",
          type: "admin-pda",
          status: "transferred",
          details: `TX: ${sig}`,
        });
      } else {
        results.push({
          name: "AMM AdminConfig",
          type: "admin-pda",
          status: "failed",
          details: `Post-transfer admin = ${newAdmin}`,
        });
      }
    }
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    results.push({
      name: "AMM AdminConfig",
      type: "admin-pda",
      status: "failed",
      details: err.message,
    });
  }

  // --- Transfer Hook WhitelistAuthority ---
  console.log("\n--- Transfer Hook WhitelistAuthority ---");
  try {
    const whPda = new PublicKey(config.pdas.whitelistAuthority);
    const acct = await connection.getAccountInfo(whPda);
    if (!acct) throw new Error("WhitelistAuthority PDA not found");

    // WhitelistAuthority layout: 8 disc + 1 option tag + 32 pubkey (if Some) + 1 bump
    const optionTag = acct.data[8];
    if (optionTag === 0) {
      console.log(`  Authority is None (burned). Cannot transfer.`);
      console.log(`  On mainnet (fresh deploy), deployer will hold authority and transfer will work.`);
      results.push({
        name: "WhitelistAuthority",
        type: "admin-pda",
        status: "skipped",
        details: "Authority is None (burned on devnet)",
      });
    } else {
      const currentAuth = new PublicKey(acct.data.subarray(9, 41)).toBase58();
      console.log(`  Current authority: ${currentAuth}`);

      if (currentAuth === vaultPda) {
        console.log(`  Already transferred to vault. Skipping.`);
        results.push({
          name: "WhitelistAuthority",
          type: "admin-pda",
          status: "already-transferred",
          details: "Authority already held by vault PDA",
        });
      } else if (currentAuth !== deployer.publicKey.toBase58()) {
        console.log(`  WARNING: Authority is not deployer. Cannot transfer.`);
        results.push({
          name: "WhitelistAuthority",
          type: "admin-pda",
          status: "skipped",
          details: `Authority held by ${currentAuth} (not deployer)`,
        });
      } else {
        // Transfer using Hook IDL
        const hookIdl: Idl = JSON.parse(
          fs.readFileSync(path.join(ROOT, "target/idl/transfer_hook.json"), "utf-8")
        );
        const coder = new BorshCoder(hookIdl);
        // CRITICAL: IDL uses snake_case field names -- camelCase encodes zeros
        const data = coder.instruction.encode("transfer_authority", {
          new_authority: new PublicKey(vaultPda),
        });
        const ix = new TransactionInstruction({
          keys: [
            { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
            { pubkey: whPda, isSigner: false, isWritable: true },
          ],
          programId: new PublicKey(config.programs.transferHook),
          data,
        });
        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
          skipPreflight: true,
        });
        console.log(`  Transferred! TX: ${sig}`);
        results.push({
          name: "WhitelistAuthority",
          type: "admin-pda",
          status: "transferred",
          details: `TX: ${sig}`,
        });
      }
    }
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    results.push({
      name: "WhitelistAuthority",
      type: "admin-pda",
      status: "failed",
      details: err.message,
    });
  }

  // --- Bonding Curve BcAdminConfig ---
  console.log("\n--- Bonding Curve BcAdminConfig ---");
  try {
    // BcAdminConfig PDA is not in devnet.json, derive it
    const BC_ADMIN_SEED = Buffer.from("bc_admin");
    const bcProgramId = new PublicKey(config.programs.bondingCurve);
    const [bcAdminPda] = PublicKey.findProgramAddressSync(
      [BC_ADMIN_SEED],
      bcProgramId
    );
    console.log(`  BcAdminConfig PDA: ${bcAdminPda.toBase58()}`);

    const acct = await connection.getAccountInfo(bcAdminPda);
    if (!acct) {
      console.log(`  BcAdminConfig PDA not found on-chain. Skipping.`);
      results.push({
        name: "BcAdminConfig",
        type: "admin-pda",
        status: "skipped",
        details: "PDA not found on-chain (may need initialize_bc_admin)",
      });
    } else {
      // BcAdminConfig layout: 8 disc + 32 authority + 1 bump
      const currentAuth = new PublicKey(acct.data.subarray(8, 40)).toBase58();
      console.log(`  Current authority: ${currentAuth}`);

      if (currentAuth === vaultPda) {
        console.log(`  Already transferred to vault. Skipping.`);
        results.push({
          name: "BcAdminConfig",
          type: "admin-pda",
          status: "already-transferred",
          details: "Authority already held by vault PDA",
        });
      } else if (currentAuth !== deployer.publicKey.toBase58()) {
        console.log(`  WARNING: Authority is not deployer. Cannot transfer.`);
        results.push({
          name: "BcAdminConfig",
          type: "admin-pda",
          status: "skipped",
          details: `Authority held by ${currentAuth} (not deployer)`,
        });
      } else {
        // Transfer using BC IDL
        const bcIdl: Idl = JSON.parse(
          fs.readFileSync(path.join(ROOT, "target/idl/bonding_curve.json"), "utf-8")
        );
        const coder = new BorshCoder(bcIdl);
        // CRITICAL: IDL uses snake_case field names -- camelCase encodes zeros
        const data = coder.instruction.encode("transfer_bc_admin", {
          new_authority: new PublicKey(vaultPda),
        });
        const ix = new TransactionInstruction({
          keys: [
            { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
            { pubkey: bcAdminPda, isSigner: false, isWritable: true },
          ],
          programId: bcProgramId,
          data,
        });
        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
          skipPreflight: true,
        });
        console.log(`  Transferred! TX: ${sig}`);

        // Verify
        const acct2 = await connection.getAccountInfo(bcAdminPda);
        const newAuth = acct2
          ? new PublicKey(acct2.data.subarray(8, 40)).toBase58()
          : null;
        if (newAuth === vaultPda) {
          console.log(`  Verified: authority = vault PDA`);
          results.push({
            name: "BcAdminConfig",
            type: "admin-pda",
            status: "transferred",
            details: `TX: ${sig}`,
          });
        } else {
          results.push({
            name: "BcAdminConfig",
            type: "admin-pda",
            status: "failed",
            details: `Post-transfer authority = ${newAuth}`,
          });
        }
      }
    }
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    results.push({
      name: "BcAdminConfig",
      type: "admin-pda",
      status: "failed",
      details: err.message,
    });
  }

  // =========================================================================
  // Part 3: Transfer Token Metadata Update Authorities (3 mints)
  // =========================================================================
  console.log("\n--- Token Metadata Update Authorities ---");

  const mintEntries = [
    { name: "CRIME", key: "crime" },
    { name: "FRAUD", key: "fraud" },
    { name: "PROFIT", key: "profit" },
  ];

  for (const { name, key } of mintEntries) {
    const mintAddress = config.mints?.[key];
    if (!mintAddress) {
      console.log(`  ${name}: No mint address in deployment config. Skipping.`);
      results.push({
        name: `${name} metadata update authority`,
        type: "metadata",
        status: "skipped",
        details: "No mint address in deployment config",
      });
      continue;
    }

    const mint = new PublicKey(mintAddress);
    console.log(`\n  ${name} mint: ${mint.toBase58()}`);

    try {
      const metadata = await getTokenMetadata(
        connection,
        mint,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );

      if (!metadata) {
        console.log(`  No metadata found on mint. Skipping.`);
        results.push({
          name: `${name} metadata update authority`,
          type: "metadata",
          status: "skipped",
          details: "No metadata on mint",
        });
        continue;
      }

      const currentAuth = metadata.updateAuthority?.toBase58() ?? "null";
      console.log(`  Current update authority: ${currentAuth}`);

      if (currentAuth === vaultPda) {
        console.log(`  Already transferred to vault. Skipping.`);
        results.push({
          name: `${name} metadata update authority`,
          type: "metadata",
          status: "already-transferred",
          details: "Authority already held by vault PDA",
        });
      } else if (currentAuth !== deployer.publicKey.toBase58()) {
        console.log(`  WARNING: Authority is not deployer. Cannot transfer.`);
        results.push({
          name: `${name} metadata update authority`,
          type: "metadata",
          status: "skipped",
          details: `Authority held by ${currentAuth} (not deployer)`,
        });
      } else {
        const sig = await tokenMetadataUpdateAuthority(
          connection,
          deployer,           // payer
          mint,                // mint account
          deployer,            // current update authority (signer)
          new PublicKey(vaultPda), // new update authority
        );
        console.log(`  Transferred! TX: ${sig}`);
        results.push({
          name: `${name} metadata update authority`,
          type: "metadata",
          status: "transferred",
          details: `TX: ${sig}`,
        });
      }
    } catch (err: any) {
      console.error(`  FAILED: ${err.message}`);
      results.push({
        name: `${name} metadata update authority`,
        type: "metadata",
        status: "failed",
        details: err.message,
      });
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n=== Transfer Summary ===\n");

  const transferred = results.filter((r) => r.status === "transferred");
  const alreadyDone = results.filter((r) => r.status === "already-transferred");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");

  console.log(`Transferred:       ${transferred.length}`);
  console.log(`Already done:      ${alreadyDone.length}`);
  console.log(`Skipped:           ${skipped.length}`);
  console.log(`Failed:            ${failed.length}`);
  console.log("");

  for (const r of results) {
    const icon =
      r.status === "transferred"
        ? "OK"
        : r.status === "already-transferred"
        ? "OK"
        : r.status === "skipped"
        ? "SKIP"
        : "FAIL";
    console.log(`  [${icon}] ${r.name} (${r.type}): ${r.details}`);
  }

  // Update deployment config with transfer timestamp
  if (transferred.length > 0 || alreadyDone.length > 0) {
    config.authority.transferredAt = new Date().toISOString();
    saveDeploymentConfig(cluster, config);
    console.log(`\nUpdated deployments/${cluster}.json with transferredAt timestamp.`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} transfer(s) FAILED!`);
    process.exit(1);
  }

  console.log("\n=== Authority Transfer Complete ===");
}

main().catch((err) => {
  console.error("\n=== Authority Transfer FAILED ===");
  console.error("Error:", err.message || err);
  if (err.logs) {
    console.error("Program logs:");
    for (const log of err.logs) {
      console.error("  ", log);
    }
  }
  process.exit(1);
});
