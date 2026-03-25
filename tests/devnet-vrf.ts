/**
 * Minimal devnet VRF validation script.
 *
 * Demonstrates the complete 3-TX flow for Epoch Program VRF integration:
 * 1. Create randomness account (wait for finalization)
 * 2. Commit + trigger_epoch_transition
 * 3. Reveal + consume_randomness
 *
 * Run with: npx ts-node tests/devnet-vrf.ts
 *
 * Prerequisites:
 * - Epoch Program deployed to devnet
 * - EpochState initialized
 * - Funded wallet (keypairs/devnet-wallet.json)
 * - ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
 *
 * Source: VRF_Implementation_Reference.md Section 4, 23-RESEARCH.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import * as fs from "fs";
import * as path from "path";

// Epoch Program type - will be generated when program is built
// For now, using any since IDL may not be generated yet
type EpochProgram = any;

const EPOCH_STATE_SEED = Buffer.from("epoch_state");

// Epoch Program ID loaded from IDL (auto-synced during deployment)
const epochIdl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "idl", "epoch_program.json"), "utf-8"));
const EPOCH_PROGRAM_ID = new PublicKey(epochIdl.address);

/**
 * Wait for slot advancement.
 * @param connection Solana connection
 * @param targetSlots Number of slots to wait for
 */
async function waitForSlotAdvance(
  connection: Connection,
  targetSlots: number
): Promise<void> {
  const startSlot = await connection.getSlot();
  console.log(`Current slot: ${startSlot}, waiting for +${targetSlots}...`);

  while (true) {
    await sleep(500);
    const currentSlot = await connection.getSlot();
    if (currentSlot >= startSlot + targetSlots) {
      console.log(`Slot advanced to ${currentSlot}`);
      return;
    }
  }
}

/**
 * Sleep for a specified duration.
 * @param ms Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load wallet keypair from file.
 * @param walletPath Path to wallet JSON file
 */
function loadWallet(walletPath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

/**
 * Complete 3-TX VRF epoch advancement flow.
 */
async function advanceEpochWithVRF(
  provider: AnchorProvider,
  epochProgram: Program<EpochProgram>,
  epochStatePda: PublicKey,
  treasuryPda: PublicKey
): Promise<void> {
  const wallet = provider.wallet as Wallet;
  const connection = provider.connection;

  // === Setup Switchboard ===
  console.log("\n--- Setting up Switchboard ---");
  const sbProgramId = await sb.getProgramId(connection);
  console.log("Switchboard Program:", sbProgramId.toBase58());

  const sbIdl = await Program.fetchIdl(sbProgramId, provider);
  if (!sbIdl) throw new Error("Failed to fetch Switchboard IDL");
  const sbProgram = new Program(sbIdl, provider);

  const queueAccount = await sb.getDefaultQueue(connection.rpcEndpoint);
  await queueAccount.loadData();
  console.log("Switchboard Queue:", queueAccount.pubkey.toBase58());

  // === TX 1: Create randomness account ===
  console.log("\n--- TX 1: Create Randomness Account ---");
  const rngKp = Keypair.generate();
  console.log("Randomness keypair:", rngKp.publicKey.toBase58());

  const [randomness, createIx] = await sb.Randomness.create(
    sbProgram as any,
    rngKp,
    queueAccount.pubkey
  );
  console.log("Randomness account:", randomness.pubkey.toBase58());

  const createTx = new Transaction().add(createIx);
  createTx.feePayer = wallet.publicKey;
  createTx.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  createTx.sign(wallet.payer, rngKp);

  const createSig = await connection.sendRawTransaction(createTx.serialize());
  console.log("Create TX:", createSig);

  // MUST wait for finalization before commitIx
  console.log("Waiting for finalization...");
  await connection.confirmTransaction(createSig, "finalized");
  console.log("Account finalized!");

  // === TX 2: Commit + Trigger ===
  console.log("\n--- TX 2: Commit + Trigger Epoch Transition ---");

  const commitIx = await randomness.commitIx(queueAccount.pubkey);

  // Note: Treasury is a placeholder - actual bounty transfer deferred to Phase 25
  const triggerIx = await epochProgram.methods
    .triggerEpochTransition()
    .accounts({
      payer: wallet.publicKey,
      epochState: epochStatePda,
      treasury: treasuryPda,
      randomnessAccount: rngKp.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const commitTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    commitIx,
    triggerIx
  );

  const commitSig = await provider.sendAndConfirm(commitTx, [wallet.payer]);
  console.log("Commit+Trigger TX:", commitSig);

  // Verify state changed
  const stateAfterTrigger = await epochProgram.account.epochState.fetch(
    epochStatePda
  );
  console.log("State after trigger:");
  console.log("  Epoch:", stateAfterTrigger.currentEpoch);
  console.log("  VRF pending:", stateAfterTrigger.vrfPending);
  console.log(
    "  Bound randomness:",
    stateAfterTrigger.pendingRandomnessAccount.toBase58()
  );

  // === Wait for oracle ===
  console.log("\n--- Waiting for oracle (~3 slots) ---");
  await waitForSlotAdvance(connection, 3);

  // === TX 3: Reveal + Consume ===
  console.log("\n--- TX 3: Reveal + Consume Randomness ---");

  // Retry revealIx until oracle is ready
  let revealIx;
  for (let i = 0; i < 10; i++) {
    try {
      revealIx = await randomness.revealIx();
      console.log("Got reveal instruction (attempt", i + 1, ")");
      break;
    } catch (e) {
      console.log(`Reveal not ready (attempt ${i + 1}/10), waiting...`);
      await sleep(2000);
    }
  }

  if (!revealIx) {
    throw new Error("Failed to get reveal instruction after 10 retries");
  }

  const consumeIx = await epochProgram.methods
    .consumeRandomness()
    .accounts({
      caller: wallet.publicKey,
      epochState: epochStatePda,
      randomnessAccount: rngKp.publicKey,
    })
    .instruction();

  const consumeTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    revealIx,
    consumeIx
  );

  const consumeSig = await provider.sendAndConfirm(consumeTx, [wallet.payer]);
  console.log("Reveal+Consume TX:", consumeSig);
}

/**
 * Main entry point.
 */
async function main() {
  console.log("=== Dr Fraudsworth Devnet VRF Test ===\n");

  // Setup provider
  // Uses ANCHOR_PROVIDER_URL and ANCHOR_WALLET environment variables
  // Or falls back to defaults
  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(__dirname, "..", "keypairs", "devnet-wallet.json");
  const rpcUrl =
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

  console.log("RPC URL:", rpcUrl);
  console.log("Wallet path:", walletPath);

  // Check wallet exists
  if (!fs.existsSync(walletPath)) {
    console.error(`Wallet file not found: ${walletPath}`);
    console.error("Create a devnet wallet with: solana-keygen new -o keypairs/devnet-wallet.json");
    process.exit(1);
  }

  const walletKeypair = loadWallet(walletPath);
  console.log("Wallet:", walletKeypair.publicKey.toBase58());

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load Epoch Program
  // Note: IDL must be generated with `anchor build` first
  let epochProgram: Program<EpochProgram>;
  try {
    const idlPath = path.join(
      __dirname,
      "..",
      "target",
      "idl",
      "epoch_program.json"
    );
    if (!fs.existsSync(idlPath)) {
      console.error(`IDL not found: ${idlPath}`);
      console.error("Run `anchor build` first to generate the IDL.");
      process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    epochProgram = new Program(idl, provider) as Program<EpochProgram>;
  } catch (e) {
    console.error("Failed to load Epoch Program:", e);
    process.exit(1);
  }
  console.log("Epoch Program:", epochProgram.programId.toBase58());

  // Derive EpochState PDA
  const [epochStatePda] = PublicKey.findProgramAddressSync(
    [EPOCH_STATE_SEED],
    epochProgram.programId
  );
  console.log("EpochState PDA:", epochStatePda.toBase58());

  // Check if EpochState is initialized
  let epochState;
  try {
    epochState = await epochProgram.account.epochState.fetch(epochStatePda);
  } catch (e) {
    console.error("\nEpochState not found. Initialize it first:");
    console.error(
      "  await epochProgram.methods.initializeEpochState().accounts({...}).rpc();"
    );
    process.exit(1);
  }

  console.log("\nCurrent state:");
  console.log("  Epoch:", epochState.currentEpoch);
  console.log("  Cheap side:", epochState.cheapSide === 0 ? "CRIME" : "FRAUD");
  console.log("  VRF pending:", epochState.vrfPending);
  console.log(
    "  Taxes:",
    `low=${epochState.lowTaxBps}bps, high=${epochState.highTaxBps}bps`
  );

  if (epochState.vrfPending) {
    console.log("\n[!] VRF already pending - run consume or wait for timeout");
    console.log("    Pending since slot:", epochState.vrfRequestSlot.toString());
    console.log(
      "    Bound account:",
      epochState.pendingRandomnessAccount.toBase58()
    );
    return;
  }

  // Use wallet as treasury placeholder (Phase 25 will add real treasury)
  const treasuryPda = walletKeypair.publicKey;

  // Run the 3-TX VRF flow
  await advanceEpochWithVRF(provider, epochProgram, epochStatePda, treasuryPda);

  // === Verify final state ===
  console.log("\n--- Final State ---");
  const finalState = await epochProgram.account.epochState.fetch(epochStatePda);
  console.log("  Epoch:", finalState.currentEpoch);
  console.log("  Cheap side:", finalState.cheapSide === 0 ? "CRIME" : "FRAUD");
  console.log("  VRF pending:", finalState.vrfPending);
  console.log("  Taxes confirmed:", finalState.taxesConfirmed);
  console.log(
    "  Taxes:",
    `low=${finalState.lowTaxBps}bps, high=${finalState.highTaxBps}bps`
  );
  console.log("  Derived rates:");
  console.log(
    `    CRIME: buy=${finalState.crimeBuyTaxBps}bps, sell=${finalState.crimeSellTaxBps}bps`
  );
  console.log(
    `    FRAUD: buy=${finalState.fraudBuyTaxBps}bps, sell=${finalState.fraudSellTaxBps}bps`
  );

  console.log("\n=== VRF Test Complete! ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
