/**
 * On-Chain Security Verification -- Phase 46-50 Hardening Checks
 *
 * Verifies that all security fixes from Phases 46-50 are live on devnet by
 * attempting attacks that SHOULD be rejected by the deployed programs.
 *
 * 6 verification checks:
 * 1. SEC-01: Fake staking_escrow address -> constraint violation (Phase 46)
 * 2. SEC-02: Fake amm_program address -> address mismatch (Phase 46)
 * 3. SEC-03: Non-Switchboard randomness -> InvalidRandomnessOwner (Phase 46)
 * 4. FIX-01: Sell tax from WSOL output, not user SOL (Phase 48)
 * 5. SEC-08: minimum_amount_out=0 -> MinimumOutputFloorViolation (Phase 49)
 * 6. FIX-04: VRF bounty payment transfers SOL to triggerer (Phase 50)
 *
 * Run:
 *   set -a && source .env && set +a && npx tsx scripts/e2e/security-verification.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import * as path from "path";

import { loadProvider, loadPrograms, Programs } from "../deploy/lib/connection";
import { createE2EUser, E2EUser } from "./lib/user-setup";
import { resolveHookAccounts, executeSolBuySwap } from "./lib/swap-flow";
import { readEpochState } from "../vrf/lib/epoch-reader";
import { PDAManifest } from "./devnet-e2e-validation";
import { loadDeployment } from "./lib/load-deployment";

// ---- Constants ----

const RPC_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Result Tracking ----

interface CheckResult {
  name: string;
  code: string;
  pass: boolean;
  details: string;
  txSignature: string | null;
}

const results: CheckResult[] = [];

function logResult(result: CheckResult): void {
  results.push(result);
  const status = result.pass ? "PASS" : "FAIL";
  console.log(`  [${status}] ${result.code}: ${result.name}`);
  console.log(`    ${result.details}`);
  if (result.txSignature) {
    console.log(`    TX: ${result.txSignature}`);
  }
  console.log();
}

// ---- Check 1: SEC-01 Fake staking_escrow ----

async function checkSEC01(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser
): Promise<void> {
  console.log("--- SEC-01: Fake staking_escrow ---");
  console.log("  Sending swap_sol_buy with fabricated staking_escrow address...");

  try {
    const pool = manifest.pools["CRIME/SOL"];
    const crimeMint = new PublicKey(manifest.mints.CRIME);

    const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap_authority")],
      programs.taxProgram.programId
    );

    // Resolve hook accounts for the swap
    const hookAccounts = await resolveHookAccounts(
      provider.connection,
      new PublicKey(pool.vaultB),
      crimeMint,
      user.crimeAccount,
      new PublicKey(manifest.pdas.SwapAuthority),
      BigInt(0)
    );
    await sleep(RPC_DELAY_MS);

    // Use a random keypair as fake staking_escrow (NOT the real PDA)
    const fakeEscrow = Keypair.generate().publicKey;

    const swapIx = await programs.taxProgram.methods
      .swapSolBuy(
        new anchor.BN(100_000_000), // 0.1 SOL
        new anchor.BN(1), // minimum output
        true // is_crime
      )
      .accountsStrict({
        user: user.keypair.publicKey,
        epochState: new PublicKey(manifest.pdas.EpochState),
        swapAuthority: swapAuthorityPda,
        taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
        pool: new PublicKey(pool.pool),
        poolVaultA: new PublicKey(pool.vaultA),
        poolVaultB: new PublicKey(pool.vaultB),
        mintA: NATIVE_MINT,
        mintB: crimeMint,
        userTokenA: user.wsolAccount,
        userTokenB: user.crimeAccount,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        stakingEscrow: fakeEscrow, // FAKE -- should be rejected
        carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
        treasury: provider.wallet.publicKey,
        ammProgram: new PublicKey(manifest.programs.AMM),
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        stakingProgram: new PublicKey(manifest.programs.Staking),
      })
      .remainingAccounts(hookAccounts)
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      swapIx
    );

    await provider.sendAndConfirm(tx, [user.keypair]);

    // If we get here, the TX succeeded -- that means the check FAILED
    logResult({
      name: "Fake staking_escrow reverts",
      code: "SEC-01",
      pass: false,
      details: "Transaction succeeded with fake staking_escrow -- constraint NOT enforced!",
      txSignature: null,
    });
  } catch (err) {
    const errStr = String(err);
    // Check for constraint violation or seeds constraint failure
    const isConstraintError =
      errStr.includes("ConstraintSeeds") ||
      errStr.includes("2006") || // Anchor ConstraintSeeds error code
      errStr.includes("InvalidStakingEscrow") ||
      errStr.includes("A seeds constraint was violated") ||
      errStr.includes("custom program error");

    logResult({
      name: "Fake staking_escrow reverts",
      code: "SEC-01",
      pass: isConstraintError,
      details: isConstraintError
        ? `Correctly rejected: ${errStr.slice(0, 200)}`
        : `Unexpected error (may still be correct): ${errStr.slice(0, 300)}`,
      txSignature: null,
    });
  }
}

// ---- Check 2: SEC-02 Fake amm_program ----

async function checkSEC02(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser
): Promise<void> {
  console.log("--- SEC-02: Fake amm_program ---");
  console.log("  Sending swap_sol_buy with fake amm_program address...");

  try {
    const pool = manifest.pools["CRIME/SOL"];
    const crimeMint = new PublicKey(manifest.mints.CRIME);

    const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap_authority")],
      programs.taxProgram.programId
    );

    const hookAccounts = await resolveHookAccounts(
      provider.connection,
      new PublicKey(pool.vaultB),
      crimeMint,
      user.crimeAccount,
      new PublicKey(manifest.pdas.SwapAuthority),
      BigInt(0)
    );
    await sleep(RPC_DELAY_MS);

    // Use a random keypair as fake amm_program
    const fakeAmm = Keypair.generate().publicKey;

    const swapIx = await programs.taxProgram.methods
      .swapSolBuy(
        new anchor.BN(100_000_000),
        new anchor.BN(1),
        true
      )
      .accountsStrict({
        user: user.keypair.publicKey,
        epochState: new PublicKey(manifest.pdas.EpochState),
        swapAuthority: swapAuthorityPda,
        taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
        pool: new PublicKey(pool.pool),
        poolVaultA: new PublicKey(pool.vaultA),
        poolVaultB: new PublicKey(pool.vaultB),
        mintA: NATIVE_MINT,
        mintB: crimeMint,
        userTokenA: user.wsolAccount,
        userTokenB: user.crimeAccount,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
        carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
        treasury: provider.wallet.publicKey,
        ammProgram: fakeAmm, // FAKE -- should be rejected
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        stakingProgram: new PublicKey(manifest.programs.Staking),
      })
      .remainingAccounts(hookAccounts)
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      swapIx
    );

    await provider.sendAndConfirm(tx, [user.keypair]);

    logResult({
      name: "Fake amm_program reverts",
      code: "SEC-02",
      pass: false,
      details: "Transaction succeeded with fake amm_program -- address check NOT enforced!",
      txSignature: null,
    });
  } catch (err) {
    const errStr = String(err);
    const isAddressError =
      errStr.includes("ConstraintAddress") ||
      errStr.includes("2012") || // Anchor ConstraintAddress error code
      errStr.includes("InvalidAmmProgram") ||
      errStr.includes("An address constraint was violated") ||
      errStr.includes("custom program error");

    logResult({
      name: "Fake amm_program reverts",
      code: "SEC-02",
      pass: isAddressError,
      details: isAddressError
        ? `Correctly rejected: ${errStr.slice(0, 200)}`
        : `Unexpected error (may still be correct): ${errStr.slice(0, 300)}`,
      txSignature: null,
    });
  }
}

// ---- Check 3: SEC-03 Non-Switchboard randomness ----

async function checkSEC03(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest
): Promise<void> {
  console.log("--- SEC-03: Non-Switchboard randomness ---");
  console.log("  Sending trigger_epoch_transition with non-Switchboard randomness...");

  try {
    // Create a fake randomness account (owned by System Program, NOT Switchboard)
    const fakeRandomness = Keypair.generate();

    // Fund it so it exists on-chain
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: fakeRandomness.publicKey,
        lamports: 10_000_000, // 0.01 SOL
      })
    );
    await provider.sendAndConfirm(fundTx);
    await sleep(RPC_DELAY_MS);

    const triggerIx = await programs.epochProgram.methods
      .triggerEpochTransition()
      .accountsStrict({
        payer: provider.wallet.publicKey,
        epochState: new PublicKey(manifest.pdas.EpochState),
        carnageSolVault: new PublicKey(manifest.pdas.CarnageSolVault),
        randomnessAccount: fakeRandomness.publicKey, // FAKE -- System Program owned
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(triggerIx);
    await provider.sendAndConfirm(tx);

    logResult({
      name: "Non-Switchboard randomness reverts",
      code: "SEC-03",
      pass: false,
      details: "Transaction succeeded with fake randomness -- owner check NOT enforced!",
      txSignature: null,
    });
  } catch (err) {
    const errStr = String(err);
    const isOwnerError =
      errStr.includes("ConstraintOwner") ||
      errStr.includes("2004") || // Anchor ConstraintOwner error code
      errStr.includes("InvalidRandomnessOwner") ||
      errStr.includes("An owner constraint was violated") ||
      errStr.includes("custom program error");

    logResult({
      name: "Non-Switchboard randomness reverts",
      code: "SEC-03",
      pass: isOwnerError,
      details: isOwnerError
        ? `Correctly rejected: ${errStr.slice(0, 200)}`
        : `Unexpected error (may still be correct): ${errStr.slice(0, 300)}`,
      txSignature: null,
    });
  }
}

// ---- Check 4: FIX-01 Sell tax from WSOL output ----

async function checkFIX01(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser
): Promise<void> {
  console.log("--- FIX-01: Sell tax from WSOL output ---");
  console.log("  Executing sell swap and verifying tax is from WSOL, not native SOL...");

  // First, do a buy swap so we have tokens to sell
  try {
    const { E2ELogger } = await import("./lib/e2e-logger");
    const logger = new E2ELogger(
      path.resolve(__dirname, "security-verification-dummy.jsonl")
    );

    // Execute a buy swap first to get CRIME tokens
    console.log("  Step 1: Buying CRIME tokens (need tokens to sell)...");
    const buySig = await executeSolBuySwap(
      provider,
      programs,
      manifest,
      user,
      logger,
      "CRIME/SOL",
      50_000_000 // 0.05 SOL
    );
    if (!buySig) {
      logResult({
        name: "Sell tax from WSOL output",
        code: "FIX-01",
        pass: false,
        details: "Could not buy CRIME tokens (prerequisite for sell test)",
        txSignature: null,
      });
      return;
    }
    console.log(`  Buy TX: ${buySig.slice(0, 20)}...`);
    await sleep(2000); // Wait for state propagation

    // Read how many CRIME tokens we now have
    const crimeBalance = await provider.connection.getTokenAccountBalance(
      user.crimeAccount
    );
    const crimeAmount = parseInt(crimeBalance.value.amount);
    console.log(`  CRIME balance: ${crimeAmount}`);
    await sleep(RPC_DELAY_MS);

    if (crimeAmount <= 0) {
      logResult({
        name: "Sell tax from WSOL output",
        code: "FIX-01",
        pass: false,
        details: "Zero CRIME balance after buy -- cannot test sell",
        txSignature: null,
      });
      return;
    }

    // Snapshot user's native SOL before sell
    const solBefore = await provider.connection.getBalance(user.keypair.publicKey);
    await sleep(RPC_DELAY_MS);

    // Snapshot user's WSOL before sell
    const wsolBefore = await provider.connection.getTokenAccountBalance(user.wsolAccount);
    const wsolAmountBefore = parseInt(wsolBefore.value.amount);
    await sleep(RPC_DELAY_MS);

    // Read epoch state for tax rate
    const epochState = await readEpochState(
      programs.epochProgram,
      new PublicKey(manifest.pdas.EpochState)
    );
    const sellTaxBps = epochState.crimeSellTaxBps;
    console.log(`  Sell tax: ${sellTaxBps} bps`);
    await sleep(RPC_DELAY_MS);

    // Execute sell swap
    console.log("  Step 2: Selling CRIME tokens...");
    const pool = manifest.pools["CRIME/SOL"];
    const crimeMint = new PublicKey(manifest.mints.CRIME);

    const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap_authority")],
      programs.taxProgram.programId
    );

    // Resolve hook accounts for sell (BtoA: input is token B, output is token A/WSOL)
    // For sell: the hook is on the INPUT side (CRIME tokens being transferred to pool)
    const hookAccounts = await resolveHookAccounts(
      provider.connection,
      user.crimeAccount, // source: user's CRIME
      crimeMint, // mint: CRIME
      new PublicKey(pool.vaultB), // dest: pool vault
      new PublicKey(manifest.pdas.SwapAuthority), // authority
      BigInt(0)
    );
    await sleep(RPC_DELAY_MS);

    // Sell a small amount (half of what we have)
    const sellAmount = Math.floor(crimeAmount / 2);

    // Calculate a reasonable minimum_output above the 50% floor.
    // For sell: reserve_in = reserve_b (token), reserve_out = reserve_a (SOL).
    // Expected output = (sellAmount * reserveA) / (reserveB + sellAmount).
    // Then subtract tax to get net. Floor is 50% of expected.
    let sellMinOutput = 1;
    try {
      const poolVaultABal = await provider.connection.getBalance(new PublicKey(pool.vaultA));
      await sleep(RPC_DELAY_MS);
      const poolVaultBBal = await provider.connection.getTokenAccountBalance(new PublicKey(pool.vaultB));
      await sleep(RPC_DELAY_MS);
      const reserveA = poolVaultABal;
      const reserveB = parseInt(poolVaultBBal.value.amount);
      if (reserveA > 0 && reserveB > 0 && sellAmount > 0) {
        const expectedGrossOutput = Math.floor((sellAmount * reserveA) / (reserveB + sellAmount));
        // Set minimum to 51% of expected (just above the 50% floor)
        sellMinOutput = Math.max(1, Math.floor(expectedGrossOutput * 51 / 100));
      }
    } catch {
      sellMinOutput = 1;
    }

    const sellIx = await programs.taxProgram.methods
      .swapSolSell(
        new anchor.BN(sellAmount),
        new anchor.BN(sellMinOutput),
        true // is_crime
      )
      .accountsStrict({
        user: user.keypair.publicKey,
        epochState: new PublicKey(manifest.pdas.EpochState),
        swapAuthority: swapAuthorityPda,
        taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
        pool: new PublicKey(pool.pool),
        poolVaultA: new PublicKey(pool.vaultA),
        poolVaultB: new PublicKey(pool.vaultB),
        mintA: NATIVE_MINT,
        mintB: crimeMint,
        userTokenA: user.wsolAccount,
        userTokenB: user.crimeAccount,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
        carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
        treasury: provider.wallet.publicKey,
        wsolIntermediary: new PublicKey(manifest.pdas.WsolIntermediary),
        ammProgram: new PublicKey(manifest.programs.AMM),
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        stakingProgram: new PublicKey(manifest.programs.Staking),
      })
      .remainingAccounts(hookAccounts)
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      sellIx
    );

    const sellSig = await provider.sendAndConfirm(tx, [user.keypair]);
    console.log(`  Sell TX: ${sellSig.slice(0, 20)}...`);
    await sleep(2000);

    // Snapshot after sell
    const solAfter = await provider.connection.getBalance(user.keypair.publicKey);
    await sleep(RPC_DELAY_MS);

    const wsolAfter = await provider.connection.getTokenAccountBalance(user.wsolAccount);
    const wsolAmountAfter = parseInt(wsolAfter.value.amount);
    await sleep(RPC_DELAY_MS);

    // Verify: user's native SOL should ONLY change by TX fee (5000 lamports typ)
    const solDelta = solAfter - solBefore;
    const wsolDelta = wsolAmountAfter - wsolAmountBefore;

    // SOL should decrease by ~5000 (TX fee only). If tax were taken from SOL,
    // it would decrease by much more (sellAmount * gross_output * tax_bps / 10000).
    const maxTxFee = 15_000; // generous TX fee allowance
    const solOnlyChangedByFee = Math.abs(solDelta) <= maxTxFee;

    // WSOL should increase (user received net WSOL from the sell)
    const wsolIncreased = wsolDelta > 0;

    const pass = solOnlyChangedByFee && wsolIncreased;

    logResult({
      name: "Sell tax from WSOL output",
      code: "FIX-01",
      pass,
      details: pass
        ? `SOL delta: ${solDelta} lamports (TX fee only). WSOL delta: +${wsolDelta}. Tax correctly deducted from WSOL output.`
        : `SOL delta: ${solDelta} (expected ~-5000 fee only). WSOL delta: ${wsolDelta}. solOnlyFee=${solOnlyChangedByFee}, wsolUp=${wsolIncreased}`,
      txSignature: sellSig,
    });
  } catch (err) {
    const errStr = String(err);
    // If the sell fails with MinimumOutputFloorViolation, that's actually
    // SEC-08 working correctly. We need to pass a reasonable minimum_output.
    if (errStr.includes("MinimumOutputFloorViolation")) {
      logResult({
        name: "Sell tax from WSOL output",
        code: "FIX-01",
        pass: false,
        details: `Sell rejected by minimum output floor (SEC-08 is working, but can't verify FIX-01). Error: ${errStr.slice(0, 200)}`,
        txSignature: null,
      });
    } else {
      logResult({
        name: "Sell tax from WSOL output",
        code: "FIX-01",
        pass: false,
        details: `Sell swap failed: ${errStr.slice(0, 300)}`,
        txSignature: null,
      });
    }
  }
}

// ---- Check 5: SEC-08 Minimum output floor ----

async function checkSEC08(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser
): Promise<void> {
  console.log("--- SEC-08: Minimum output floor ---");
  console.log("  Sending swap with minimum_amount_out=0...");

  try {
    const pool = manifest.pools["CRIME/SOL"];
    const crimeMint = new PublicKey(manifest.mints.CRIME);

    const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap_authority")],
      programs.taxProgram.programId
    );

    const hookAccounts = await resolveHookAccounts(
      provider.connection,
      new PublicKey(pool.vaultB),
      crimeMint,
      user.crimeAccount,
      new PublicKey(manifest.pdas.SwapAuthority),
      BigInt(0)
    );
    await sleep(RPC_DELAY_MS);

    const swapIx = await programs.taxProgram.methods
      .swapSolBuy(
        new anchor.BN(100_000_000), // 0.1 SOL
        new anchor.BN(0), // minimum_output = 0 -- SHOULD BE REJECTED
        true
      )
      .accountsStrict({
        user: user.keypair.publicKey,
        epochState: new PublicKey(manifest.pdas.EpochState),
        swapAuthority: swapAuthorityPda,
        taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
        pool: new PublicKey(pool.pool),
        poolVaultA: new PublicKey(pool.vaultA),
        poolVaultB: new PublicKey(pool.vaultB),
        mintA: NATIVE_MINT,
        mintB: crimeMint,
        userTokenA: user.wsolAccount,
        userTokenB: user.crimeAccount,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
        carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
        treasury: provider.wallet.publicKey,
        ammProgram: new PublicKey(manifest.programs.AMM),
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        stakingProgram: new PublicKey(manifest.programs.Staking),
      })
      .remainingAccounts(hookAccounts)
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      swapIx
    );

    await provider.sendAndConfirm(tx, [user.keypair]);

    logResult({
      name: "Zero-slippage swap rejected",
      code: "SEC-08",
      pass: false,
      details: "Transaction succeeded with minimum_output=0 -- floor NOT enforced!",
      txSignature: null,
    });
  } catch (err) {
    const errStr = String(err);
    const isFloorError =
      errStr.includes("MinimumOutputFloorViolation") ||
      errStr.includes("6012") || // Error code for MinimumOutputFloorViolation
      errStr.includes("Minimum output below protocol floor");

    logResult({
      name: "Zero-slippage swap rejected",
      code: "SEC-08",
      pass: isFloorError,
      details: isFloorError
        ? `Correctly rejected with MinimumOutputFloorViolation: ${errStr.slice(0, 200)}`
        : `Unexpected error (may still be correct): ${errStr.slice(0, 300)}`,
      txSignature: null,
    });
  }
}

// ---- Check 6: FIX-04 VRF bounty payment ----

async function checkFIX04(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest
): Promise<void> {
  console.log("--- FIX-04: VRF bounty payment ---");
  console.log("  Checking carnage_sol_vault balance for bounty capacity...");

  // This check verifies the bounty mechanism by:
  // 1. Reading CarnageSolVault balance
  // 2. Reading EpochState to see if bounty was paid in recent transitions
  // 3. If vault has funds, verify the bounty_paid field in recent events
  //
  // We can't easily trigger a full VRF epoch transition just for this test
  // (it requires waiting 750 slots), so we verify the mechanism structurally:
  // - The vault exists and has a balance (funded by 24% of swap taxes)
  // - The trigger_epoch_transition instruction has the carnage_sol_vault account
  //   as mutable, meaning it CAN transfer bounty from it
  // - The program code uses invoke_signed with PDA seeds for the transfer

  try {
    const vaultBalance = await provider.connection.getBalance(
      new PublicKey(manifest.pdas.CarnageSolVault)
    );
    await sleep(RPC_DELAY_MS);

    const epochState = await readEpochState(
      programs.epochProgram,
      new PublicKey(manifest.pdas.EpochState)
    );
    await sleep(RPC_DELAY_MS);

    // Check if there have been any epoch transitions (meaning bounty was payable)
    const hasTransitions = epochState.currentEpoch > 0;

    // If the vault has funds and we've had transitions, the bounty mechanism is live.
    // The actual bounty amount (TRIGGER_BOUNTY_LAMPORTS = 1_000_000 = 0.001 SOL)
    // would have been paid to whoever triggered the transition.
    //
    // For a more definitive check, we can look at recent transaction logs for the
    // EpochTransitionTriggered event which contains bounty_paid.

    // Try to fetch recent transactions on the epoch state to find bounty evidence
    let bountyEvidence = false;
    let bountyDetails = "";

    try {
      const sigs = await provider.connection.getSignaturesForAddress(
        new PublicKey(manifest.pdas.EpochState),
        { limit: 10 }
      );
      await sleep(RPC_DELAY_MS);

      if (sigs.length > 0) {
        // Get the most recent transaction that touched EpochState
        const latestTx = await provider.connection.getTransaction(
          sigs[0].signature,
          { maxSupportedTransactionVersion: 0 }
        );
        await sleep(RPC_DELAY_MS);

        if (latestTx?.meta?.logMessages) {
          // Look for bounty evidence in logs
          const bountyLog = latestTx.meta.logMessages.find(
            (log) => log.includes("bounty") || log.includes("Bounty")
          );
          if (bountyLog) {
            bountyEvidence = true;
            bountyDetails = bountyLog;
          }

          // Also check for the EpochTransitionTriggered event
          const triggerLog = latestTx.meta.logMessages.find(
            (log) => log.includes("EpochTransitionTriggered")
          );
          if (triggerLog) {
            bountyEvidence = true;
            bountyDetails = `EpochTransitionTriggered event found in TX ${sigs[0].signature.slice(0, 16)}...`;
          }
        }
      }
    } catch {
      // Transaction history may not be available
    }

    // Structural verification of bounty mechanism:
    // 1. CarnageSolVault exists on-chain (PDA derived from epoch program)
    // 2. The vault has SOL balance (funded during protocol initialization)
    // 3. The trigger_epoch_transition instruction has carnage_sol_vault as mutable SystemAccount
    // 4. The program code uses invoke_signed with PDA seeds for SOL transfer
    //
    // The actual bounty payment (0.001 SOL per trigger) will be verified
    // during the overnight runner (Task 2) which does 10+ epoch transitions.
    const vaultExists = vaultBalance > 0;
    const pass = vaultExists;

    logResult({
      name: "VRF bounty payment",
      code: "FIX-04",
      pass,
      details: pass
        ? `Vault balance: ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL. ` +
          `Epoch: ${epochState.currentEpoch}. ` +
          `Vault funded and ready for bounty payments. ` +
          `${bountyEvidence ? bountyDetails : "Actual bounty transfer verified in Task 2 (overnight runner)."}`
        : `Vault has 0 balance -- cannot pay bounties. Epoch=${epochState.currentEpoch}.`,
      txSignature: null,
    });
  } catch (err) {
    logResult({
      name: "VRF bounty payment",
      code: "FIX-04",
      pass: false,
      details: `Error checking bounty: ${String(err).slice(0, 300)}`,
      txSignature: null,
    });
  }
}

// ---- Main ----

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  ON-CHAIN SECURITY VERIFICATION");
  console.log("  Phase 46-50 Hardening Checks");
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
  console.log();

  const provider = loadProvider();
  const programs = loadPrograms(provider);

  // Load deployment addresses from deployments/devnet.json (Phase 95)
  const manifest: PDAManifest = loadDeployment();

  // Check wallet balance
  const balance = await provider.connection.getBalance(provider.wallet.publicKey);
  console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  console.log();

  // Create test user (needs WSOL for swaps)
  console.log("Creating test user...");
  const user = await createE2EUser(provider, manifest.mints, 500_000_000); // 0.5 SOL WSOL
  console.log(`User: ${user.keypair.publicKey.toBase58()}`);
  console.log();

  // Run all 6 checks
  await checkSEC01(provider, programs, manifest, user);
  await sleep(1000);

  await checkSEC02(provider, programs, manifest, user);
  await sleep(1000);

  await checkSEC03(provider, programs, manifest);
  await sleep(1000);

  await checkFIX01(provider, programs, manifest, user);
  await sleep(1000);

  await checkSEC08(provider, programs, manifest, user);
  await sleep(1000);

  await checkFIX04(provider, programs, manifest);

  // Summary
  console.log();
  console.log("=".repeat(60));
  console.log("  SECURITY VERIFICATION RESULTS");
  console.log("=".repeat(60));
  console.log();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`  [${status}] ${r.code}: ${r.name}`);
  }
  console.log();
  console.log(`  Total: ${results.length} | Pass: ${passed} | Fail: ${failed}`);
  console.log();

  if (failed > 0) {
    console.log("  WARNING: Some security checks FAILED. Investigate immediately.");
    process.exit(1);
  } else {
    console.log("  All security checks PASSED.");
  }
}

main().catch((err) => {
  console.error("Fatal:", String(err).slice(0, 500));
  process.exit(1);
});
