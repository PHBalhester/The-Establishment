/**
 * Timelocked Upgrade Round-Trip Test
 *
 * Proves the full Squads governance upgrade flow on devnet:
 *   Cycle 1: Deploy fresh test program -> transfer authority to vault ->
 *            write modified buffer -> propose upgrade -> 2-of-3 approve ->
 *            wait timelock -> execute upgrade -> verify bytecode changed
 *   Cycle 2: Revert to original bytecode through the same Squads flow
 *
 * ADAPTATION: Since all 7 devnet upgrade authorities were accidentally burned
 * (Plan 97-02 bug, now fixed), we deploy a FRESH test program with deployer
 * as upgrade authority, then transfer that authority to the Squads vault.
 * This proves the exact same governance flow that mainnet will use.
 *
 * We use fake_tax_program (186KB) as the guinea pig instead of conversion_vault
 * (375KB) to conserve devnet SOL -- buffer writes cost ~1.3 SOL vs ~2.6 SOL.
 * For the "modified" binary we use mock_tax_program (same size, different bytecode)
 * and revert back to fake_tax_program. This proves the upgrade mechanism without
 * needing to rebuild anything.
 *
 * Usage:
 *   set -a && source .env.devnet && set +a
 *   npx tsx scripts/deploy/test-upgrade.ts
 *
 * Source: .planning/phases/97-squads-governance/97-03-PLAN.md
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// =============================================================================
// Constants
// =============================================================================

const ROOT = path.resolve(__dirname, "../..");
const KEYPAIRS_DIR = path.join(ROOT, "keypairs");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");
const TARGET_DEPLOY = path.join(ROOT, "target/deploy");

const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

const SYSVAR_RENT = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);
const SYSVAR_CLOCK = new PublicKey(
  "SysvarC1ock11111111111111111111111111111111"
);

// Binary A (original): fake_tax_program (186KB, ~1.3 SOL per buffer)
const BINARY_A = path.join(TARGET_DEPLOY, "fake_tax_program.so");
// Binary B (modified): mock_tax_program (same size, different bytecode)
const BINARY_B = path.join(TARGET_DEPLOY, "mock_tax_program.so");

// =============================================================================
// Helpers
// =============================================================================

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf-8")))
  );
}

function detectCluster(url: string): string {
  if (url.includes("devnet")) return "devnet";
  if (url.includes("mainnet")) return "mainnet";
  return "localnet";
}

function loadDeploymentConfig(cluster: string): any {
  const configPath = path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/**
 * Solana CLI v3 has issues with paths containing spaces (our project dir is
 * "Dr Fraudsworth"). We create a temp symlink to avoid this.
 */
const SYMLINK_DIR = path.join(process.env.HOME || "/tmp", ".dr-fraudsworth-link");

function ensureSymlink(): void {
  try {
    const target = fs.readlinkSync(SYMLINK_DIR);
    if (target === ROOT) return;
    fs.unlinkSync(SYMLINK_DIR);
  } catch {
    // Doesn't exist yet
  }
  fs.symlinkSync(ROOT, SYMLINK_DIR);
}

/** Convert a path inside ROOT to use the symlink (no spaces) */
function safePath(p: string): string {
  if (!p.startsWith(ROOT)) return p;
  return p.replace(ROOT, SYMLINK_DIR);
}

/** Run a shell command and return stdout, with proper PATH setup */
function run(cmd: string): string {
  const env = {
    ...process.env,
    PATH: [
      path.join(process.env.HOME || "~", ".cargo/bin"),
      path.join(
        process.env.HOME || "~",
        ".local/share/solana/install/active_release/bin"
      ),
      "/opt/homebrew/bin",
      process.env.PATH || "",
    ].join(":"),
  };
  return execSync(cmd, {
    encoding: "utf-8",
    env,
    cwd: ROOT,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300_000,
  }).trim();
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Confirm a transaction and throw if it failed on-chain.
 * With skipPreflight, TXs can be "confirmed" but still have errors.
 */
async function confirmOrThrow(
  connection: Connection,
  sig: string,
  label: string
): Promise<void> {
  const result = await connection.confirmTransaction(sig, "confirmed");
  if (result.value.err) {
    // Try to get logs for debugging
    try {
      const tx = await connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta?.logMessages) {
        console.error(`  Logs for ${label}:`);
        for (const log of tx.meta.logMessages) {
          console.error(`    ${log}`);
        }
      }
    } catch {
      // Ignore log fetch errors
    }
    throw new Error(
      `${label} failed on-chain: ${JSON.stringify(result.value.err)}`
    );
  }
}

/**
 * Get the ProgramData address and last_deploy_slot for a program.
 */
async function getProgramDataInfo(
  connection: Connection,
  programId: PublicKey
): Promise<{ programData: PublicKey; lastDeploySlot: bigint } | null> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo || programInfo.data.length < 36) return null;

  const programData = new PublicKey(programInfo.data.slice(4, 36));
  const programDataInfo = await connection.getAccountInfo(programData);
  if (!programDataInfo) return null;

  const lastDeploySlot = programDataInfo.data.readBigUInt64LE(4);
  return { programData, lastDeploySlot };
}

/**
 * Get upgrade authority of a program. Returns null if burned/immutable.
 */
async function getUpgradeAuthority(
  connection: Connection,
  programId: PublicKey
): Promise<string | null> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo || programInfo.data.length < 36) return null;
  const programData = new PublicKey(programInfo.data.slice(4, 36));
  const pdInfo = await connection.getAccountInfo(programData);
  if (!pdInfo || pdInfo.data.length < 45) return null;
  if (pdInfo.data[12] !== 1) return null;
  return new PublicKey(pdInfo.data.slice(13, 45)).toBase58();
}

/**
 * Write a program binary to a buffer account. Returns the buffer address.
 */
function writeBuffer(binaryPath: string, keypairPath: string, url: string): string {
  console.log("  Writing binary to buffer account...");
  ensureSymlink();
  const output = run(
    `solana program write-buffer ${safePath(binaryPath)} ` +
      `--keypair ${safePath(keypairPath)} ` +
      `--url ${url} ` +
      `--with-compute-unit-price 10000`
  );
  const match = output.match(/Buffer:\s+(\S+)/);
  if (!match) throw new Error(`Could not parse buffer address from: ${output}`);
  console.log(`  Buffer: ${match[1]}`);
  return match[1];
}

/**
 * Set buffer authority to the Squads vault PDA.
 */
function setBufferAuthority(
  bufferAddress: string,
  newAuthority: string,
  keypairPath: string,
  url: string
): void {
  console.log("  Setting buffer authority to vault PDA...");
  ensureSymlink();
  run(
    `solana program set-buffer-authority ${bufferAddress} ` +
      `--new-buffer-authority ${newAuthority} ` +
      `--keypair ${safePath(keypairPath)} ` +
      `--url ${url}`
  );
  console.log("  Buffer authority set.");
}

/**
 * BPFLoaderUpgradeable SetAuthority instruction.
 * CRITICAL: New authority is the 3rd account, NOT in instruction data.
 */
function makeSetAuthorityIx(
  programDataAddress: PublicKey,
  currentAuthority: PublicKey,
  newAuthority: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4, 0);
  return new TransactionInstruction({
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: currentAuthority, isSigner: true, isWritable: false },
      { pubkey: newAuthority, isSigner: false, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

/**
 * BPFLoaderUpgradeable::Upgrade instruction.
 * Discriminator: 3 (u32 LE)
 * Accounts: [programData(w), program(w), buffer(w), spill(w), rent(r), clock(r), authority(s)]
 */
function makeUpgradeIx(
  programId: PublicKey,
  programData: PublicKey,
  bufferAddress: PublicKey,
  spillAddress: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(3, 0);
  return new TransactionInstruction({
    keys: [
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: true },
      { pubkey: bufferAddress, isSigner: false, isWritable: true },
      { pubkey: spillAddress, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

/**
 * Execute one complete timelocked upgrade cycle through Squads:
 * write buffer -> set buffer authority -> create vault TX -> create proposal ->
 * approve x2 -> wait timelock -> execute -> verify
 */
async function executeUpgradeCycle(
  connection: Connection,
  cycleName: string,
  testProgramId: PublicKey,
  vaultPda: PublicKey,
  multisigPda: PublicKey,
  deployer: Keypair,
  signers: Keypair[],
  walletPath: string,
  clusterUrl: string,
  timeLockSeconds: number,
  binaryPath: string
): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${cycleName}`);
  console.log(`${"=".repeat(60)}\n`);

  // Step 1: Write buffer
  console.log(`[${cycleName}] Step 1: Writing buffer...`);
  const cluster = detectCluster(clusterUrl);
  const bufferAddress = writeBuffer(binaryPath, walletPath, cluster);

  // Step 2: Set buffer authority to vault PDA
  console.log(`\n[${cycleName}] Step 2: Setting buffer authority...`);
  setBufferAuthority(bufferAddress, vaultPda.toBase58(), walletPath, cluster);

  // Step 3: Get program data and next transaction index
  console.log(`\n[${cycleName}] Step 3: Preparing vault transaction...`);
  const pdInfo = await getProgramDataInfo(connection, testProgramId);
  if (!pdInfo) throw new Error("Could not read ProgramData");
  console.log(`  ProgramData: ${pdInfo.programData.toBase58()}`);
  console.log(`  Last deploy slot: ${pdInfo.lastDeploySlot}`);

  const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );
  const currentTxIndex = Number(msAccount.transactionIndex);
  const txIndex = BigInt(currentTxIndex + 1);
  console.log(`  Next transaction index: ${txIndex}`);

  // Step 4: Create vault transaction with Upgrade IX
  console.log(`\n[${cycleName}] Step 4: Creating vault transaction...`);
  const upgradeIx = makeUpgradeIx(
    testProgramId,
    pdInfo.programData,
    new PublicKey(bufferAddress),
    vaultPda,
    vaultPda
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const txMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [upgradeIx],
  });

  const vtSig = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: deployer,
    multisigPda,
    transactionIndex: txIndex,
    creator: signers[0].publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: txMessage,
    memo: `${cycleName}: Upgrade test program`,
    signers: [deployer, signers[0]],
    sendOptions: { skipPreflight: true },
  });
  console.log(`  Vault TX created: ${vtSig}`);
  await confirmOrThrow(connection, vtSig, `${cycleName} vault TX create`);

  // Step 5: Create proposal
  console.log(`\n[${cycleName}] Step 5: Creating proposal...`);
  const propSig = await multisig.rpc.proposalCreate({
    connection,
    feePayer: deployer,
    creator: signers[0],
    multisigPda,
    transactionIndex: txIndex,
    sendOptions: { skipPreflight: true },
  });
  console.log(`  Proposal created: ${propSig}`);
  await confirmOrThrow(connection, propSig, `${cycleName} proposal create`);
  console.log(`  ${cycleName}: Upgrade proposal created`);

  // Step 6: Approve with signer 1
  console.log(`\n[${cycleName}] Step 6: Approving with signer 1...`);
  const approveSig1 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: deployer,
    member: signers[0],
    multisigPda,
    transactionIndex: txIndex,
    sendOptions: { skipPreflight: true },
  });
  console.log(`  Signer 1 approved: ${approveSig1}`);
  await confirmOrThrow(connection, approveSig1, `${cycleName} signer 1 approve`);

  // Step 7: Approve with signer 2 (threshold met)
  console.log(`\n[${cycleName}] Step 7: Approving with signer 2...`);
  const approveSig2 = await multisig.rpc.proposalApprove({
    connection,
    feePayer: deployer,
    member: signers[1],
    multisigPda,
    transactionIndex: txIndex,
    sendOptions: { skipPreflight: true },
  });
  console.log(`  Signer 2 approved: ${approveSig2}`);
  await confirmOrThrow(connection, approveSig2, `${cycleName} signer 2 approve`);
  console.log(`  ${cycleName}: 2-of-3 approved`);

  // Step 8: Wait for timelock
  console.log(`\n[${cycleName}] Step 8: Waiting for timelock...`);
  console.log(`  ${cycleName}: Waiting for timelock...`);

  const timelockStart = Date.now();
  const timelockMs = timeLockSeconds * 1000;

  while (true) {
    const elapsed = Date.now() - timelockStart;
    const remaining = Math.max(0, timelockMs - elapsed);
    if (remaining <= 0) {
      console.log("  Timelock: elapsed!");
      break;
    }
    const remainingSec = Math.ceil(remaining / 1000);
    process.stdout.write(`\r  Timelock: ${remainingSec}s remaining...   `);
    await sleep(10_000);
  }
  console.log("");

  // Step 9: Execute the upgrade
  console.log(`\n[${cycleName}] Step 9: Executing upgrade...`);
  await sleep(5_000); // Ensure timelock is definitively past

  const execSig = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: deployer,
    multisigPda,
    transactionIndex: txIndex,
    member: signers[0].publicKey,
    signers: [deployer, signers[0]],
    sendOptions: { skipPreflight: true },
  });
  console.log(`  Execute TX: ${execSig}`);
  await confirmOrThrow(connection, execSig, `${cycleName} execute`);

  // Step 10: Verify upgrade (with retries for RPC propagation)
  console.log(`\n[${cycleName}] Step 10: Verifying upgrade...`);

  let newPdInfo = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(3_000);
    newPdInfo = await getProgramDataInfo(connection, testProgramId);
    if (newPdInfo && newPdInfo.lastDeploySlot > pdInfo.lastDeploySlot) break;
    console.log(`  Waiting for RPC propagation (attempt ${attempt + 1})...`);
  }

  if (!newPdInfo) throw new Error("Could not read ProgramData after upgrade");

  if (newPdInfo.lastDeploySlot > pdInfo.lastDeploySlot) {
    console.log(
      `  last_deploy_slot changed: ${pdInfo.lastDeploySlot} -> ${newPdInfo.lastDeploySlot}`
    );
    console.log(`  ${cycleName}: Upgrade executed successfully`);
  } else {
    throw new Error(
      `${cycleName}: last_deploy_slot did NOT change (${pdInfo.lastDeploySlot} -> ${newPdInfo.lastDeploySlot})`
    );
  }

  // Verify authority is still vault PDA
  const auth = await getUpgradeAuthority(connection, testProgramId);
  if (auth !== vaultPda.toBase58()) {
    throw new Error(
      `${cycleName}: Authority changed unexpectedly: ${auth} (expected vault PDA)`
    );
  }
  console.log("  Authority still held by vault PDA -- correct.");

  // Verify proposal status
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: txIndex,
  });
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(
    connection,
    proposalPda
  );
  console.log(`  Proposal status: ${proposal.status.__kind}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("=== Timelocked Upgrade Round-Trip Test ===\n");

  const clusterUrl = process.env.CLUSTER_URL || "https://api.devnet.solana.com";
  const cluster = detectCluster(clusterUrl);
  const commitment = (process.env.COMMITMENT as any) || "confirmed";
  const connection = new Connection(clusterUrl, commitment);

  console.log(`Cluster: ${cluster}`);

  // Load deployer
  const walletPath =
    process.env.WALLET || path.join(KEYPAIRS_DIR, "devnet-wallet.json");
  const deployer = loadKeypair(walletPath);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (balance < 1.5 * LAMPORTS_PER_SOL) {
    throw new Error(
      `Insufficient balance (${(balance / LAMPORTS_PER_SOL).toFixed(
        4
      )} SOL). Need at least 1.5 SOL.`
    );
  }

  // Load deployment config
  const config = loadDeploymentConfig(cluster);
  const vaultPda = new PublicKey(config.authority.squadsVault);
  const multisigPda = new PublicKey(config.squadsMultisig);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`Multisig PDA: ${multisigPda.toBase58()}`);

  // Load signers
  const signers = [
    loadKeypair(path.join(KEYPAIRS_DIR, "squads-signer-1.json")),
    loadKeypair(path.join(KEYPAIRS_DIR, "squads-signer-2.json")),
    loadKeypair(path.join(KEYPAIRS_DIR, "squads-signer-3.json")),
  ];
  console.log(
    `Signers: ${signers
      .map((s) => s.publicKey.toBase58().slice(0, 12) + "...")
      .join(", ")}`
  );

  // Read timelock from multisig account
  const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );
  const timeLockSeconds = msAccount.timeLock;
  console.log(`Timelock: ${timeLockSeconds}s (${timeLockSeconds / 60} min)`);

  // Verify binaries exist
  for (const [label, bin] of [
    ["Binary A (original)", BINARY_A],
    ["Binary B (modified)", BINARY_B],
  ] as const) {
    if (!fs.existsSync(bin)) {
      throw new Error(`${label} not found: ${bin}. Run anchor build first.`);
    }
    const size = fs.statSync(bin).size;
    console.log(`${label}: ${bin} (${(size / 1024).toFixed(0)} KB)`);
  }

  // -------------------------------------------------------------------------
  // Phase 0: Deploy fresh test program
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 0: Deploy fresh test program ---\n");

  const testProgramKpPath = path.join(KEYPAIRS_DIR, "test-upgrade-program.json");
  let testProgramKp: Keypair;
  if (fs.existsSync(testProgramKpPath)) {
    testProgramKp = loadKeypair(testProgramKpPath);
    console.log(
      `Loaded existing test program keypair: ${testProgramKp.publicKey.toBase58()}`
    );
  } else {
    testProgramKp = Keypair.generate();
    fs.writeFileSync(
      testProgramKpPath,
      JSON.stringify(Array.from(testProgramKp.secretKey))
    );
    console.log(
      `Generated test program keypair: ${testProgramKp.publicKey.toBase58()}`
    );
  }

  // Check if test program is already deployed
  const existingProgram = await connection.getAccountInfo(
    testProgramKp.publicKey
  );
  if (existingProgram) {
    console.log("  Test program already deployed. Checking authority...");
    const auth = await getUpgradeAuthority(connection, testProgramKp.publicKey);
    console.log(`  Current authority: ${auth}`);

    if (auth === vaultPda.toBase58()) {
      console.log(
        "  Authority already held by vault PDA. Proceeding to upgrade cycles."
      );
    } else if (auth === deployer.publicKey.toBase58()) {
      console.log("  Authority held by deployer. Transferring to vault...");
      await transferToVault(
        connection,
        deployer,
        testProgramKp.publicKey,
        vaultPda
      );
    } else if (auth === null) {
      throw new Error(
        "Test program authority is burned! Delete keypairs/test-upgrade-program.json and re-run."
      );
    } else {
      throw new Error(`Test program authority held by unknown: ${auth}`);
    }
  } else {
    // Deploy fresh using Binary A
    console.log(`  Deploying fresh test program (${path.basename(BINARY_A)})...`);
    ensureSymlink();
    const deployOutput = run(
      `solana program deploy ${safePath(BINARY_A)} ` +
        `--program-id ${safePath(testProgramKpPath)} ` +
        `--keypair ${safePath(walletPath)} ` +
        `--url ${cluster} ` +
        `--with-compute-unit-price 10000`
    );
    console.log(`  Deploy output: ${deployOutput}`);

    // Wait for deployment to propagate (devnet RPC can be slow)
    console.log("  Waiting for deployment to propagate...");
    let auth: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(3_000);
      auth = await getUpgradeAuthority(connection, testProgramKp.publicKey);
      if (auth === deployer.publicKey.toBase58()) break;
      console.log(`  Attempt ${attempt + 1}: authority = ${auth}, retrying...`);
    }
    if (auth !== deployer.publicKey.toBase58()) {
      throw new Error(`Deploy authority mismatch after 10 retries: ${auth}`);
    }
    console.log("  Deployed! Authority: deployer");

    // Transfer authority to vault
    console.log("\n  Transferring authority to vault PDA...");
    await transferToVault(
      connection,
      deployer,
      testProgramKp.publicKey,
      vaultPda
    );
  }

  // Final authority check
  const finalAuth = await getUpgradeAuthority(
    connection,
    testProgramKp.publicKey
  );
  if (finalAuth !== vaultPda.toBase58()) {
    throw new Error(`Authority not held by vault: ${finalAuth}`);
  }
  console.log(`  Test program: ${testProgramKp.publicKey.toBase58()}`);
  console.log("  Authority: vault PDA (confirmed)");

  // -------------------------------------------------------------------------
  // Cycle 1: Upgrade to Binary B (modified)
  // -------------------------------------------------------------------------
  await executeUpgradeCycle(
    connection,
    "Cycle 1 (Upgrade)",
    testProgramKp.publicKey,
    vaultPda,
    multisigPda,
    deployer,
    signers,
    walletPath,
    clusterUrl,
    timeLockSeconds,
    BINARY_B
  );

  // -------------------------------------------------------------------------
  // Cycle 2: Revert to Binary A (original)
  // -------------------------------------------------------------------------
  await executeUpgradeCycle(
    connection,
    "Cycle 2 (Revert)",
    testProgramKp.publicKey,
    vaultPda,
    multisigPda,
    deployer,
    signers,
    walletPath,
    clusterUrl,
    timeLockSeconds,
    BINARY_A
  );

  // -------------------------------------------------------------------------
  // Cleanup: close the test program to reclaim SOL
  // -------------------------------------------------------------------------
  console.log("\n--- Cleanup ---\n");
  console.log(
    "  Note: Test program left deployed on devnet (authority = vault PDA)."
  );
  console.log(
    "  To reclaim SOL, close it via Squads proposal or after next full redeploy."
  );

  // -------------------------------------------------------------------------
  // Final verdict
  // -------------------------------------------------------------------------
  console.log(
    "\n============================================================"
  );
  console.log(
    "  PASS: Full timelocked upgrade round-trip proven (upgrade + revert)"
  );
  console.log(
    "============================================================\n"
  );
  console.log("Both cycles completed successfully through:");
  console.log(
    "  - Buffer write + buffer authority transfer to vault PDA"
  );
  console.log(
    "  - Squads vault transaction create (BPFLoaderUpgradeable::Upgrade)"
  );
  console.log("  - Proposal create -> 2-of-3 approval");
  console.log(`  - ${timeLockSeconds}s timelock wait`);
  console.log("  - Vault transaction execute");
  console.log(
    "  - On-chain verification (last_deploy_slot changed, authority preserved)"
  );
}

/**
 * Transfer upgrade authority from deployer to vault PDA.
 */
async function transferToVault(
  connection: Connection,
  deployer: Keypair,
  programId: PublicKey,
  vaultPda: PublicKey
): Promise<void> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo || programInfo.data.length < 36) {
    throw new Error("Could not read program account");
  }
  const programData = new PublicKey(programInfo.data.slice(4, 36));

  const ix = makeSetAuthorityIx(programData, deployer.publicKey, vaultPda);
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
    skipPreflight: true,
  });
  console.log(`  Authority transferred to vault: ${sig}`);

  const auth = await getUpgradeAuthority(connection, programId);
  if (auth !== vaultPda.toBase58()) {
    throw new Error(`Authority transfer failed! Current: ${auth}`);
  }
}

main().catch((err) => {
  console.error("\n=== Timelocked Upgrade Test FAILED ===");
  console.error("Error:", err.message || err);
  if (err.logs) {
    console.error("Program logs:");
    for (const log of err.logs) {
      console.error("  ", log);
    }
  }
  process.exit(1);
});
