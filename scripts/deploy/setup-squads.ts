/**
 * Squads 2-of-3 Multisig Setup Script
 *
 * Creates a Squads v4 multisig on devnet (or mainnet) with:
 * - 3 signer members (auto-generated for devnet, configurable for mainnet)
 * - Threshold: 2 of 3
 * - Timelock: SQUADS_TIMELOCK_SECONDS env var (default 300 = 5 min)
 * - Config authority: null (autonomous -- multisig governs itself)
 *
 * Idempotent: skips creation if multisig already exists on-chain.
 *
 * Updates deployments/{cluster}.json with squadsVault, squadsMultisig, squadsCreateKey.
 *
 * Usage:
 *   set -a && source .env.devnet && set +a
 *   npx tsx scripts/deploy/setup-squads.ts
 *
 * Source: .planning/phases/97-squads-governance/97-02-PLAN.md
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Constants
// =============================================================================

const ROOT = path.resolve(__dirname, "../..");
const KEYPAIRS_DIR = path.join(ROOT, "keypairs");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

const SIGNER_KEYPAIR_PATHS = [
  path.join(KEYPAIRS_DIR, "squads-signer-1.json"),
  path.join(KEYPAIRS_DIR, "squads-signer-2.json"),
  path.join(KEYPAIRS_DIR, "squads-signer-3.json"),
];
const CREATE_KEY_PATH = path.join(KEYPAIRS_DIR, "squads-create-key.json");

/** SOL to fund each signer with (enough for voting transactions) */
const SIGNER_FUNDING_SOL = 0.05;

// =============================================================================
// Helpers
// =============================================================================

/** Load or generate a keypair. Writes to disk if generated. */
function loadOrGenerateKeypair(filePath: string, label: string): Keypair {
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    console.log(`  Loaded ${label}: ${kp.publicKey.toBase58()}`);
    return kp;
  }
  const kp = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`  Generated ${label}: ${kp.publicKey.toBase58()} -> ${filePath}`);
  return kp;
}

/** Detect cluster name from CLUSTER_URL */
function detectCluster(url: string): string {
  if (url.includes("devnet")) return "devnet";
  if (url.includes("mainnet")) return "mainnet";
  return "localnet";
}

/** Load deployment config JSON */
function loadDeploymentConfig(cluster: string): any {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Deployment config not found: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/** Save deployment config JSON */
function saveDeploymentConfig(cluster: string, config: any): void {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`  Updated: ${configPath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const clusterUrl = process.env.CLUSTER_URL || "https://api.devnet.solana.com";
  const cluster = detectCluster(clusterUrl);
  const commitment = (process.env.COMMITMENT as any) || "confirmed";
  const connection = new Connection(clusterUrl, commitment);

  const timelockSeconds = Number(process.env.SQUADS_TIMELOCK_SECONDS) || 300;

  console.log("=== Squads 2-of-3 Multisig Setup ===\n");
  console.log(`Cluster:  ${cluster} (${clusterUrl})`);
  console.log(`Timelock: ${timelockSeconds}s (${timelockSeconds / 60} min)\n`);

  // -------------------------------------------------------------------------
  // Step 1: Load deployer wallet (fee payer)
  // -------------------------------------------------------------------------
  const walletPath = process.env.WALLET || path.join(KEYPAIRS_DIR, "devnet-wallet.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found: ${walletPath}`);
  }
  const deployer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`Balance:  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // -------------------------------------------------------------------------
  // Step 2: Resolve signer public keys
  //
  // Two modes:
  //   DEVNET:  All 3 signers are file keypairs (auto-generated if missing).
  //   MAINNET: Signer 1 is a file keypair (the script proposer -- needs
  //            private key for transaction signing). Signers 2 and 3 are
  //            pubkey-only (Phantom browser wallet + Ledger hardware wallet).
  //            Their private keys never touch this machine.
  //
  // Mode is determined by the presence of SQUADS_SIGNER_2_PUBKEY and
  // SQUADS_SIGNER_3_PUBKEY env vars.
  // -------------------------------------------------------------------------
  const isMainnetSignerMode =
    !!process.env.SQUADS_SIGNER_2_PUBKEY && !!process.env.SQUADS_SIGNER_3_PUBKEY;

  console.log(
    isMainnetSignerMode
      ? "--- Signer Mode: MAINNET (signer 1 file + signers 2,3 pubkey-only) ---"
      : "--- Signer Mode: DEVNET (all file keypairs) ---"
  );

  /** Public keys for all 3 members (used in multisig creation) */
  const memberPubkeys: PublicKey[] = [];
  /**
   * File keypairs we loaded (used for funding check).
   * In mainnet mode this is only signer 1; signers 2+3 fund themselves.
   */
  const fileSigners: Keypair[] = [];

  if (isMainnetSignerMode) {
    // -- Signer 1: file keypair (the script proposer) --
    const signer1 = loadOrGenerateKeypair(
      SIGNER_KEYPAIR_PATHS[0],
      "squads-signer-1 (proposer)"
    );
    fileSigners.push(signer1);
    memberPubkeys.push(signer1.publicKey);

    // -- Signer 2: pubkey-only (Phantom browser wallet) --
    const signer2Pubkey = new PublicKey(process.env.SQUADS_SIGNER_2_PUBKEY!);
    console.log(`  Signer 2 (pubkey-only / Phantom): ${signer2Pubkey.toBase58()}`);
    memberPubkeys.push(signer2Pubkey);

    // -- Signer 3: pubkey-only (Ledger hardware wallet) --
    const signer3Pubkey = new PublicKey(process.env.SQUADS_SIGNER_3_PUBKEY!);
    console.log(`  Signer 3 (pubkey-only / Ledger):  ${signer3Pubkey.toBase58()}`);
    memberPubkeys.push(signer3Pubkey);
  } else {
    // Devnet: all 3 signers are file keypairs (auto-generated if missing)
    for (let i = 0; i < 3; i++) {
      const kp = loadOrGenerateKeypair(
        SIGNER_KEYPAIR_PATHS[i],
        `squads-signer-${i + 1}`
      );
      fileSigners.push(kp);
      memberPubkeys.push(kp.publicKey);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Generate/load create key (one-time key for multisig PDA derivation)
  // -------------------------------------------------------------------------
  console.log("\n--- Create Key ---");
  const createKey = loadOrGenerateKeypair(CREATE_KEY_PATH, "squads-create-key");

  // -------------------------------------------------------------------------
  // Step 4: Derive PDAs
  // -------------------------------------------------------------------------
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0,
  });

  console.log("\n--- Derived Addresses ---");
  console.log(`  Multisig PDA: ${multisigPda.toBase58()}`);
  console.log(`  Vault PDA:    ${vaultPda.toBase58()} <-- THIS holds authority`);

  // -------------------------------------------------------------------------
  // Step 5: Check if multisig already exists (idempotent)
  // -------------------------------------------------------------------------
  const existingAccount = await connection.getAccountInfo(multisigPda);
  if (existingAccount) {
    console.log("\n>>> Multisig already exists on-chain. Skipping creation.");
    console.log(`    Multisig PDA: ${multisigPda.toBase58()}`);
    console.log(`    Vault PDA:    ${vaultPda.toBase58()}`);

    // Still update devnet.json in case it was missed
    updateDeploymentConfig(cluster, multisigPda, vaultPda, createKey.publicKey);
    console.log("\n=== Setup complete (idempotent) ===");
    return;
  }

  // -------------------------------------------------------------------------
  // Step 6: Fund signer wallets (file keypairs only)
  //
  // In mainnet mode, only signer 1 is funded by the deployer.
  // Signers 2 and 3 are pubkey-only -- they fund themselves via their
  // own wallets (Phantom / Ledger).
  // -------------------------------------------------------------------------
  console.log("\n--- Funding Signers ---");
  if (isMainnetSignerMode) {
    console.log("  (Mainnet mode: only funding signer 1 -- signers 2,3 fund themselves)");
  }
  const fundingLamports = Math.ceil(SIGNER_FUNDING_SOL * LAMPORTS_PER_SOL);

  for (let i = 0; i < fileSigners.length; i++) {
    const signerBalance = await connection.getBalance(fileSigners[i].publicKey);
    if (signerBalance >= fundingLamports) {
      console.log(
        `  Signer ${i + 1}: ${(signerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL (sufficient)`
      );
      continue;
    }

    const needed = fundingLamports - signerBalance;
    console.log(
      `  Signer ${i + 1}: ${(signerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL -> funding ${(needed / LAMPORTS_PER_SOL).toFixed(4)} SOL`
    );

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: fileSigners[i].publicKey,
        lamports: needed,
      })
    );
    const fundSig = await sendAndConfirmTransaction(connection, tx, [deployer], {
      skipPreflight: true,
    });
    console.log(`    TX: ${fundSig}`);
  }

  // -------------------------------------------------------------------------
  // Step 7: Fetch Squads program config (for treasury address)
  // -------------------------------------------------------------------------
  console.log("\n--- Fetching Squads Program Config ---");
  const [programConfigPda] = multisig.getProgramConfigPda({});
  console.log(`  ProgramConfig PDA: ${programConfigPda.toBase58()}`);

  const programConfig =
    await multisig.accounts.ProgramConfig.fromAccountAddress(
      connection,
      programConfigPda
    );
  console.log(`  Treasury: ${programConfig.treasury.toBase58()}`);

  // -------------------------------------------------------------------------
  // Step 8: Create multisig
  // -------------------------------------------------------------------------
  console.log("\n--- Creating Multisig ---");
  console.log(`  Threshold:        2 of 3`);
  console.log(`  Timelock:         ${timelockSeconds}s`);
  console.log(`  Config authority: null (autonomous)`);
  console.log(`  Members:`);
  for (let i = 0; i < memberPubkeys.length; i++) {
    const label = isMainnetSignerMode
      ? i === 0
        ? "(file keypair / proposer)"
        : i === 1
        ? "(pubkey-only / Phantom)"
        : "(pubkey-only / Ledger)"
      : "(file keypair)";
    console.log(`    ${i + 1}. ${memberPubkeys[i].toBase58()} ${label}`);
  }

  const sig = await multisig.rpc.multisigCreateV2({
    connection,
    createKey,
    creator: deployer,
    multisigPda,
    configAuthority: null,
    timeLock: timelockSeconds,
    members: memberPubkeys.map((key) => ({
      key,
      permissions: multisig.types.Permissions.all(),
    })),
    threshold: 2,
    treasury: programConfig.treasury,
    rentCollector: null,
    sendOptions: { skipPreflight: true },
  });

  console.log(`  TX: ${sig}`);

  // Wait for confirmation
  console.log("  Waiting for finalization...");
  await connection.confirmTransaction(sig, commitment);

  // Verify creation
  const verifyAccount = await connection.getAccountInfo(multisigPda);
  if (!verifyAccount) {
    throw new Error("Multisig PDA not found after creation TX confirmed!");
  }
  console.log(`  Multisig created and verified on-chain.`);

  // -------------------------------------------------------------------------
  // Step 9: Update deployments/{cluster}.json
  // -------------------------------------------------------------------------
  updateDeploymentConfig(cluster, multisigPda, vaultPda, createKey.publicKey);

  console.log("\n=== Squads Multisig Setup Complete ===");
  console.log(`  Multisig PDA: ${multisigPda.toBase58()}`);
  console.log(`  Vault PDA:    ${vaultPda.toBase58()} <-- Use this for authority transfers`);
  console.log(`  Timelock:     ${timelockSeconds}s`);
  console.log(`  Threshold:    2 of 3`);
}

function updateDeploymentConfig(
  cluster: string,
  multisigPda: PublicKey,
  vaultPda: PublicKey,
  createKeyPubkey: PublicKey
): void {
  console.log("\n--- Updating Deployment Config ---");
  const config = loadDeploymentConfig(cluster);

  config.authority.squadsVault = vaultPda.toBase58();
  config.squadsMultisig = multisigPda.toBase58();
  config.squadsCreateKey = createKeyPubkey.toBase58();

  saveDeploymentConfig(cluster, config);
}

main().catch((err) => {
  console.error("\n=== Squads Setup FAILED ===");
  console.error("Error:", err.message || err);
  if (err.logs) {
    console.error("Program logs:");
    for (const log of err.logs) {
      console.error("  ", log);
    }
  }
  process.exit(1);
});
