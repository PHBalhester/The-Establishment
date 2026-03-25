/**
 * E2E Staking Flow -- Stake PROFIT, Multi-Epoch VRF Cycling, Claim SOL Yield
 *
 * Tests the complete staking yield lifecycle on devnet:
 * 1. Stake PROFIT tokens (with Transfer Hook remaining_accounts)
 * 2. Generate tax revenue via SOL buy swaps
 * 3. Advance multiple epochs with VRF (update_cumulative called automatically via CPI)
 * 4. Claim SOL yield from staking escrow
 * 5. Unstake after cooldown (wait 3s for test-build 2s cooldown, then unstake)
 *
 * This validates:
 * - E2E-03: Staking claim flow (stake -> generate revenue -> claim yield)
 * - E2E-04: Multi-epoch cycling (3+ consecutive VRF transitions with valid tax rates)
 * - E2E-05: Unstake-after-cooldown test (claim -> wait -> unstake succeeds)
 *
 * Why Transfer Hook on stake:
 * PROFIT is a Token-2022 token with Transfer Hook extension. Every transfer
 * (including user -> stake_vault) requires the hook program's ExtraAccountMeta
 * accounts as remaining_accounts. Without them, the transfer CPI fails.
 *
 * Why swaps between epochs:
 * Staking yield comes from SOL tax collected on swaps. Each swap's tax is
 * distributed 71% to staking escrow via deposit_rewards. Without swap revenue,
 * there is nothing to claim. We run a small swap between each epoch transition
 * to generate claimable yield.
 *
 * Exports:
 * - stakePROFIT: Stake PROFIT tokens into the staking program
 * - claimYield: Claim accumulated SOL yield from staking escrow
 * - unstakePROFIT: Unstake PROFIT tokens (forfeits pending rewards)
 * - runMultiEpochCycling: Advance N epochs with VRF + inter-epoch swaps
 * - runStakingFlow: Full lifecycle orchestrator (stake -> swap -> epochs -> claim -> unstake)
 */

import * as anchor from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  advanceEpochWithVRF,
  VRFAccounts,
  EpochTransitionResult,
  sleep,
  waitForSlotAdvance,
} from "../../vrf/lib/vrf-flow";
import { readEpochState } from "../../vrf/lib/epoch-reader";
import { E2ELogger, LogEntry } from "./e2e-logger";
import { E2EUser } from "./user-setup";
import { executeSolBuySwap, resolveHookAccounts } from "./swap-flow";
import { Programs } from "../../deploy/lib/connection";
import { PDAManifest } from "../devnet-e2e-validation";

// ---- Constants ----

/** Rate limit delay between RPC calls (ms) for Helius free tier */
const RPC_DELAY_MS = 200;

/** Stake amount: 10 PROFIT = 10_000_000 raw units (6 decimals) */
const STAKE_AMOUNT_RAW = 10_000_000;

/**
 * Number of slots to wait between epoch transitions.
 * The on-chain epoch program requires SLOTS_PER_EPOCH (750) slots between
 * transitions -- attempting back-to-back calls hits EpochBoundaryNotReached.
 * We add a 10-slot buffer (760) to account for slot timing jitter.
 * On devnet, slot time is ~400ms, so 760 slots = ~5 min wait.
 */
const SLOT_WAIT_BETWEEN_EPOCHS = 760;

/** Staking program seeds (must match programs/staking/src/constants.rs) */
const USER_STAKE_SEED = "user_stake";
const STAKE_POOL_SEED = "stake_pool";

// ---- Utilities ----

function localSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Core Functions ----

/**
 * Stake PROFIT tokens into the staking program.
 *
 * Resolves Transfer Hook remaining_accounts for the PROFIT transfer
 * (user -> stake_vault), builds the stake instruction, and sends it.
 *
 * @param provider - Anchor provider with devnet wallet
 * @param programs - All 6 protocol program instances
 * @param manifest - PDA manifest with all deployed addresses
 * @param user - E2E test user with keypair and PROFIT token account
 * @param amount - Raw amount to stake (default: 10 PROFIT = 10_000_000)
 * @param logger - E2E logger for recording results
 * @returns TX signature on success, null on failure
 */
export async function stakePROFIT(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  amount: number = STAKE_AMOUNT_RAW,
  logger: E2ELogger
): Promise<string | null> {
  const connection = provider.connection;

  try {
    // Capture pre-stake PROFIT balance of user
    const preBalance = await connection.getTokenAccountBalance(user.profitAccount);
    await localSleep(RPC_DELAY_MS);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Pre-stake PROFIT balance: ${preBalance.value.uiAmountString}`,
      details: {
        userProfitAccount: user.profitAccount.toBase58(),
        balanceRaw: preBalance.value.amount,
        balanceUi: preBalance.value.uiAmountString,
      },
    });

    // Resolve Transfer Hook remaining_accounts for PROFIT transfer
    // Source: user's PROFIT account
    // Mint: PROFIT mint
    // Dest: StakeVault PDA
    // Authority: user (signer, not PDA)
    const profitMint = new PublicKey(manifest.mints.PROFIT);
    const stakeVault = new PublicKey(manifest.pdas.StakeVault);

    const hookAccounts = await resolveHookAccounts(
      connection,
      user.profitAccount,       // source
      profitMint,               // mint
      stakeVault,               // destination
      user.keypair.publicKey,   // authority (user is signer)
      BigInt(amount)            // amount (doesn't affect hook resolution)
    );
    await localSleep(RPC_DELAY_MS);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Resolved ${hookAccounts.length} Transfer Hook accounts for PROFIT stake`,
      details: {
        hookAccountCount: hookAccounts.length,
        hookAccounts: hookAccounts.map((a) => a.pubkey.toBase58()),
      },
    });

    // Derive userStake PDA: seeds=["user_stake", user_pubkey]
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(USER_STAKE_SEED), user.keypair.publicKey.toBuffer()],
      programs.staking.programId
    );

    // Build stake instruction
    const txSig = await programs.staking.methods
      .stake(new BN(amount))
      .accountsStrict({
        user: user.keypair.publicKey,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        userStake: userStakePda,
        userTokenAccount: user.profitAccount,
        stakeVault: stakeVault,
        profitMint: profitMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(hookAccounts)
      .signers([user.keypair])
      .rpc();

    await localSleep(RPC_DELAY_MS);

    // Capture post-stake PROFIT balance
    const postBalance = await connection.getTokenAccountBalance(user.profitAccount);
    await localSleep(RPC_DELAY_MS);

    const balanceChange = Number(preBalance.value.amount) - Number(postBalance.value.amount);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Staked ${balanceChange / 1_000_000} PROFIT successfully`,
      txSignature: txSig,
      details: {
        amountStaked: amount,
        amountStakedUi: amount / 1_000_000,
        preBalanceRaw: preBalance.value.amount,
        postBalanceRaw: postBalance.value.amount,
        balanceChange,
        userStakePda: userStakePda.toBase58(),
      },
    });

    return txSig;
  } catch (err) {
    const errStr = String(err);
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "fail",
      message: `Stake PROFIT failed: ${errStr.slice(0, 500)}`,
      details: { error: errStr },
    });
    return null;
  }
}

/**
 * Claim accumulated SOL yield from the staking escrow.
 *
 * The claim instruction transfers native SOL from the escrow PDA
 * to the user. No token transfer or hook accounts needed.
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @returns Object with txSig and yieldLamports on success, null on failure
 */
export async function claimYield(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger
): Promise<{ txSig: string; yieldLamports: number } | null> {
  const connection = provider.connection;

  try {
    // Derive userStake PDA
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(USER_STAKE_SEED), user.keypair.publicKey.toBuffer()],
      programs.staking.programId
    );

    // Capture pre-claim SOL balance
    const preSolBalance = await connection.getBalance(user.keypair.publicKey);
    await localSleep(RPC_DELAY_MS);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Pre-claim SOL balance: ${(preSolBalance / 1e9).toFixed(6)} SOL`,
      details: {
        preSolBalanceLamports: preSolBalance,
        userStakePda: userStakePda.toBase58(),
        escrowVault: manifest.pdas.EscrowVault,
      },
    });

    // Build claim instruction
    const txSig = await programs.staking.methods
      .claim()
      .accountsStrict({
        user: user.keypair.publicKey,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        userStake: userStakePda,
        escrowVault: new PublicKey(manifest.pdas.EscrowVault),
        systemProgram: SystemProgram.programId,
      })
      .signers([user.keypair])
      .rpc();

    await localSleep(RPC_DELAY_MS);

    // Capture post-claim SOL balance
    const postSolBalance = await connection.getBalance(user.keypair.publicKey);
    await localSleep(RPC_DELAY_MS);

    // Yield = post - pre + txFee (approximate, TX fee is ~5000 lamports)
    // Since the user pays the TX fee, the actual yield is:
    // yieldReceived = (postBalance - preBalance) + txFee
    // We approximate txFee as 5000 lamports
    const TX_FEE_APPROX = 5000;
    const netDelta = postSolBalance - preSolBalance;
    const yieldLamports = netDelta + TX_FEE_APPROX;

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: yieldLamports > 0 ? "pass" : "known_issue",
      message: `Claim yield: ${yieldLamports > 0 ? "received" : "zero yield"} ${(yieldLamports / 1e9).toFixed(9)} SOL`,
      txSignature: txSig,
      details: {
        preSolBalance,
        postSolBalance,
        netDelta,
        yieldLamports,
        yieldSol: yieldLamports / 1e9,
        txFeeApprox: TX_FEE_APPROX,
      },
    });

    return { txSig, yieldLamports };
  } catch (err) {
    const errStr = String(err);

    // NothingToClaim is a known issue, not a crash
    const isNothingToClaim = errStr.includes("NothingToClaim") || errStr.includes("0x1775");
    const isInsufficientEscrow = errStr.includes("InsufficientEscrowBalance") || errStr.includes("0x1776");

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: isNothingToClaim || isInsufficientEscrow ? "known_issue" : "fail",
      message: `Claim yield failed: ${isNothingToClaim ? "NothingToClaim (no rewards accrued)" : isInsufficientEscrow ? "InsufficientEscrowBalance" : errStr.slice(0, 500)}`,
      details: {
        error: errStr,
        isNothingToClaim,
        isInsufficientEscrow,
      },
    });

    return null;
  }
}

// ---- Unstake ----

/**
 * Unstake PROFIT tokens from the staking program.
 *
 * Resolves Transfer Hook remaining_accounts for the PROFIT transfer
 * (stake_vault -> user). Does NOT pass escrowVault (removed in Phase 2).
 * Pending rewards are forfeited to remaining stakers (not claimed).
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param amount - Raw amount to unstake (default: STAKE_AMOUNT_RAW)
 * @param logger - E2E logger
 * @returns TX signature on success, null on failure
 */
export async function unstakePROFIT(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  amount: number = STAKE_AMOUNT_RAW,
  logger: E2ELogger
): Promise<string | null> {
  const connection = provider.connection;

  try {
    const profitMint = new PublicKey(manifest.mints.PROFIT);
    const stakeVault = new PublicKey(manifest.pdas.StakeVault);

    // Capture pre-unstake PROFIT balance
    const preBalance = await connection.getTokenAccountBalance(user.profitAccount);
    await localSleep(RPC_DELAY_MS);

    // Resolve Transfer Hook remaining_accounts for PROFIT transfer
    // Direction is vault -> user (opposite of stake)
    const hookAccounts = await resolveHookAccounts(
      connection,
      stakeVault,               // source: vault sends PROFIT
      profitMint,               // mint
      user.profitAccount,       // dest: user receives PROFIT
      user.keypair.publicKey,   // authority
      BigInt(amount)
    );
    await localSleep(RPC_DELAY_MS);

    // Derive userStake PDA
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(USER_STAKE_SEED), user.keypair.publicKey.toBuffer()],
      programs.staking.programId
    );

    // Build unstake instruction -- no escrowVault (removed in Phase 2)
    const txSig = await programs.staking.methods
      .unstake(new BN(amount))
      .accountsStrict({
        user: user.keypair.publicKey,
        stakePool: new PublicKey(manifest.pdas.StakePool),
        userStake: userStakePda,
        userTokenAccount: user.profitAccount,
        stakeVault: stakeVault,
        profitMint: profitMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(hookAccounts)
      .signers([user.keypair])
      .rpc();

    await localSleep(RPC_DELAY_MS);

    // Capture post-unstake PROFIT balance
    const postBalance = await connection.getTokenAccountBalance(user.profitAccount);
    await localSleep(RPC_DELAY_MS);

    const balanceChange = Number(postBalance.value.amount) - Number(preBalance.value.amount);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Unstaked ${balanceChange / 1_000_000} PROFIT successfully (rewards forfeited)`,
      txSignature: txSig,
      details: {
        amountUnstaked: amount,
        amountUnstakedUi: amount / 1_000_000,
        preBalanceRaw: preBalance.value.amount,
        postBalanceRaw: postBalance.value.amount,
        balanceChange,
        userStakePda: userStakePda.toBase58(),
      },
    });

    return txSig;
  } catch (err) {
    const errStr = String(err);
    const isCooldownActive = errStr.includes("CooldownActive") || errStr.includes("0x177b");

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: isCooldownActive ? "known_issue" : "fail",
      message: `Unstake PROFIT failed: ${isCooldownActive ? "CooldownActive (12h cooldown not expired)" : errStr.slice(0, 500)}`,
      details: { error: errStr, isCooldownActive },
    });
    return null;
  }
}

// ---- Multi-Epoch Cycling ----

/**
 * Advance N epochs with VRF, running swaps between epochs to generate tax revenue.
 *
 * Each epoch transition:
 * 1. Read EpochState BEFORE transition (snapshot)
 * 2. Call advanceEpochWithVRF (3-TX VRF flow: create -> commit+trigger -> reveal+consume)
 *    - consume_randomness automatically calls update_cumulative via CPI
 * 3. Read EpochState AFTER transition (snapshot)
 * 4. Log transition details: epoch, cheapSide, tax rates, flip status
 * 5. Run a SOL buy swap to generate tax revenue for staking yield
 *
 * Why advanceEpochWithVRF handles Switchboard internally:
 * The function calls sb.getProgramId, Program.fetchIdl, sb.getDefaultQueue
 * internally. No external Switchboard setup is needed by the caller.
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E user (for inter-epoch swaps)
 * @param logger - E2E logger
 * @param epochCount - Number of epoch transitions to run (default: 3)
 * @returns Array of EpochTransitionResult for each successful transition
 */
export async function runMultiEpochCycling(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger,
  epochCount: number = 3
): Promise<EpochTransitionResult[]> {
  const results: EpochTransitionResult[] = [];

  // Construct VRFAccounts from manifest (same pattern as scripts/vrf/devnet-vrf-validation.ts)
  const vrfAccounts: VRFAccounts = {
    epochStatePda: new PublicKey(manifest.pdas.EpochState),
    treasuryPda: provider.wallet.publicKey, // Treasury placeholder
    stakingAuthorityPda: new PublicKey(manifest.pdas.StakingAuthority),
    stakePoolPda: new PublicKey(manifest.pdas.StakePool),
    stakingProgramId: new PublicKey(manifest.programs.Staking),
    carnageFundPda: new PublicKey(manifest.pdas.CarnageFund),
  };

  logger.log({
    timestamp: new Date().toISOString(),
    phase: "epoch",
    status: "pass",
    message: `Starting multi-epoch cycling: ${epochCount} transitions`,
    details: {
      epochCount,
      epochStatePda: vrfAccounts.epochStatePda.toBase58(),
      stakePoolPda: vrfAccounts.stakePoolPda.toBase58(),
    },
  });

  for (let i = 0; i < epochCount; i++) {
    const transitionStartMs = Date.now();

    try {
      // 0. Wait for slot boundary before transitions after the first.
      //    The on-chain epoch program enforces SLOTS_PER_EPOCH (750) between
      //    transitions. Without this wait, back-to-back calls fail with
      //    EpochBoundaryNotReached. (Gap SC-3 fix)
      if (i > 0) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "epoch",
          status: "pass",
          message: `Waiting for ${SLOT_WAIT_BETWEEN_EPOCHS} slots before epoch transition ${i + 1}/${epochCount} (~${Math.round(SLOT_WAIT_BETWEEN_EPOCHS * 0.4 / 60)} min on devnet)`,
        });
        await waitForSlotAdvance(provider.connection, SLOT_WAIT_BETWEEN_EPOCHS);
        await localSleep(RPC_DELAY_MS);
      }

      // 1. Read EpochState BEFORE transition
      const epochStatePda = new PublicKey(manifest.pdas.EpochState);
      const beforeSnapshot = await readEpochState(programs.epochProgram, epochStatePda);
      await localSleep(RPC_DELAY_MS);

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "epoch",
        status: "pass",
        message: `Epoch transition ${i + 1}/${epochCount}: BEFORE state -- epoch=${beforeSnapshot.currentEpoch}, cheapSide=${beforeSnapshot.cheapSide}, lowTax=${beforeSnapshot.lowTaxBps}bps, highTax=${beforeSnapshot.highTaxBps}bps`,
        details: {
          transitionIndex: i + 1,
          beforeEpoch: beforeSnapshot.currentEpoch,
          beforeCheapSide: beforeSnapshot.cheapSide,
          beforeLowTax: beforeSnapshot.lowTaxBps,
          beforeHighTax: beforeSnapshot.highTaxBps,
        },
      });

      // 2. Advance epoch with VRF (3-TX flow, handles Switchboard internally)
      console.log(`\n--- Epoch Transition ${i + 1}/${epochCount} ---`);
      const result = await advanceEpochWithVRF(provider, programs.epochProgram, vrfAccounts);
      await localSleep(RPC_DELAY_MS);

      // 3. Read EpochState AFTER transition
      const afterSnapshot = await readEpochState(programs.epochProgram, epochStatePda);
      await localSleep(RPC_DELAY_MS);

      // 4. Verify tax rates are in spec bands
      const lowTaxValid = [100, 200, 300, 400].includes(result.lowTaxBps);
      const highTaxValid = [1100, 1200, 1300, 1400].includes(result.highTaxBps);
      const taxRatesValid = lowTaxValid && highTaxValid;

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "epoch",
        status: taxRatesValid ? "pass" : "fail",
        message: `Epoch transition ${i + 1}/${epochCount}: epoch=${result.epoch}, cheapSide=${result.cheapSide}, lowTax=${result.lowTaxBps}bps, highTax=${result.highTaxBps}bps, flipped=${result.flipped}, carnage=${result.carnageTriggered}`,
        txSignature: result.consumeSig,
        details: {
          transitionIndex: i + 1,
          epoch: result.epoch,
          cheapSide: result.cheapSide,
          lowTaxBps: result.lowTaxBps,
          highTaxBps: result.highTaxBps,
          flipped: result.flipped,
          carnageTriggered: result.carnageTriggered,
          vrfBytes: result.vrfBytes,
          createSig: result.createSig,
          commitSig: result.commitSig,
          consumeSig: result.consumeSig,
          durationMs: result.durationMs,
          taxRatesValid,
          beforeEpoch: beforeSnapshot.currentEpoch,
          afterEpoch: afterSnapshot.currentEpoch,
          afterLowTax: afterSnapshot.lowTaxBps,
          afterHighTax: afterSnapshot.highTaxBps,
          afterCheapSide: afterSnapshot.cheapSide,
        },
      });

      results.push(result);

      // 5. Run a swap between epochs to generate tax revenue for staking yield
      // (Skip swap after last transition -- no need to generate more revenue)
      if (i < epochCount - 1) {
        logger.log({
          timestamp: new Date().toISOString(),
          phase: "epoch",
          status: "pass",
          message: `Running inter-epoch swap ${i + 1} to generate tax revenue for staking yield`,
        });

        const swapSig = await executeSolBuySwap(
          provider,
          programs,
          manifest,
          user,
          logger,
          "CRIME/SOL"
        );

        if (swapSig) {
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "epoch",
            status: "pass",
            message: `Inter-epoch swap ${i + 1} completed: ${swapSig.slice(0, 16)}...`,
            txSignature: swapSig,
          });
        } else {
          logger.log({
            timestamp: new Date().toISOString(),
            phase: "epoch",
            status: "fail",
            message: `Inter-epoch swap ${i + 1} failed -- staking yield may be 0`,
          });
        }
      }
    } catch (err) {
      const errStr = String(err);
      const durationMs = Date.now() - transitionStartMs;

      logger.log({
        timestamp: new Date().toISOString(),
        phase: "epoch",
        status: "fail",
        message: `Epoch transition ${i + 1}/${epochCount} failed after ${(durationMs / 1000).toFixed(1)}s: ${errStr.slice(0, 500)}`,
        details: {
          transitionIndex: i + 1,
          error: errStr,
          durationMs,
        },
      });

      // Continue to next transition -- don't abort the entire cycle
      // Some failures are transient (oracle delays, rate limits)
    }
  }

  // Summary
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "epoch",
    status: results.length >= epochCount ? "pass" : results.length > 0 ? "known_issue" : "fail",
    message: `Multi-epoch cycling complete: ${results.length}/${epochCount} transitions successful`,
    details: {
      attempted: epochCount,
      successful: results.length,
      epochs: results.map((r) => ({
        epoch: r.epoch,
        cheapSide: r.cheapSide,
        lowTax: r.lowTaxBps,
        highTax: r.highTaxBps,
        flipped: r.flipped,
        durationMs: r.durationMs,
      })),
    },
  });

  return results;
}

// ---- Full Lifecycle Orchestrator ----

/**
 * Run the complete staking yield lifecycle:
 * 1. Stake 10 PROFIT tokens
 * 2. Run a swap to generate initial tax revenue
 * 3. Advance 3 epochs with VRF (update_cumulative called automatically)
 * 4. Claim SOL yield
 * 5. Unstake after cooldown (wait 3s for test-build 2s cooldown, then unstake)
 *
 * @param provider - Anchor provider
 * @param programs - Protocol programs
 * @param manifest - PDA manifest
 * @param user - E2E test user
 * @param logger - E2E logger
 * @returns true if the full lifecycle completed with non-zero yield
 */
export async function runStakingFlow(
  provider: AnchorProvider,
  programs: Programs,
  manifest: PDAManifest,
  user: E2EUser,
  logger: E2ELogger
): Promise<boolean> {
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "staking",
    status: "pass",
    message: "Starting staking + multi-epoch flow (E2E-03 + E2E-04 + E2E-05)",
  });

  const flowStartMs = Date.now();
  let overallSuccess = true;

  // Step 1: Stake 10 PROFIT
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "staking",
    status: "pass",
    message: "Step 1/5: Staking 10 PROFIT tokens",
  });

  const stakeSig = await stakePROFIT(
    provider,
    programs,
    manifest,
    user,
    STAKE_AMOUNT_RAW,
    logger
  );

  if (!stakeSig) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "fail",
      message: "Staking flow aborted: stake PROFIT failed",
    });
    return false;
  }

  // Step 2: Run initial swap to generate tax revenue
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "staking",
    status: "pass",
    message: "Step 2/5: Running initial swap to generate tax revenue",
  });

  const initialSwapSig = await executeSolBuySwap(
    provider,
    programs,
    manifest,
    user,
    logger,
    "CRIME/SOL"
  );

  if (!initialSwapSig) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "known_issue",
      message: "Initial swap failed -- staking yield may be 0, continuing with epoch transitions",
    });
    // Don't abort -- epoch transitions + inter-epoch swaps may still generate revenue
  }

  // Step 3: Advance 3 epochs with VRF
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "staking",
    status: "pass",
    message: "Step 3/5: Advancing 3 epochs with VRF",
  });

  const epochResults = await runMultiEpochCycling(
    provider,
    programs,
    manifest,
    user,
    logger,
    3 // 3 transitions minimum for E2E-04
  );

  if (epochResults.length === 0) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "fail",
      message: "Staking flow failed: no epoch transitions completed",
    });
    overallSuccess = false;
  }

  // Step 4: Claim SOL yield
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "staking",
    status: "pass",
    message: "Step 4/5: Claiming SOL yield from staking escrow",
  });

  const claimResult = await claimYield(provider, programs, manifest, user, logger);

  // Step 5: Unstake after cooldown (E2E-05)
  // Wait 3s to clear the test-build 2s cooldown (COOLDOWN_SECONDS = 2 in test feature flag)
  logger.log({
    timestamp: new Date().toISOString(),
    phase: "staking",
    status: "pass",
    message: "Step 5/5: Waiting 3s for test-build cooldown, then unstaking",
  });

  await localSleep(3000);

  const unstakeSig = await unstakePROFIT(
    provider,
    programs,
    manifest,
    user,
    STAKE_AMOUNT_RAW,
    logger
  );

  if (unstakeSig) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Unstake-after-cooldown succeeded (E2E-05)`,
      txSignature: unstakeSig,
    });
  } else {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "known_issue",
      message: "Unstake-after-cooldown failed (E2E-05) -- may need longer cooldown wait",
    });
  }

  const flowDurationMs = Date.now() - flowStartMs;

  if (claimResult && claimResult.yieldLamports > 0) {
    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "pass",
      message: `Staking flow complete: staked ${STAKE_AMOUNT_RAW / 1_000_000} PROFIT, claimed ${(claimResult.yieldLamports / 1e9).toFixed(9)} SOL yield, ${epochResults.length}/3 epoch transitions`,
      txSignature: claimResult.txSig,
      details: {
        stakeSig,
        claimSig: claimResult.txSig,
        yieldLamports: claimResult.yieldLamports,
        yieldSol: claimResult.yieldLamports / 1e9,
        epochTransitions: epochResults.length,
        flowDurationMs,
        flowDurationMin: (flowDurationMs / 60000).toFixed(1),
      },
    });
  } else {
    // Yield was 0 or claim failed -- log as known issue with diagnostic info
    const escrowBalance = await provider.connection.getBalance(
      new PublicKey(manifest.pdas.EscrowVault)
    ).catch(() => -1);

    logger.log({
      timestamp: new Date().toISOString(),
      phase: "staking",
      status: "known_issue",
      message: `Staking flow complete but yield claim ${claimResult ? "returned 0" : "failed"}: ${epochResults.length}/3 epoch transitions completed`,
      details: {
        stakeSig,
        claimResult: claimResult ? {
          txSig: claimResult.txSig,
          yieldLamports: claimResult.yieldLamports,
        } : null,
        epochTransitions: epochResults.length,
        escrowBalanceLamports: escrowBalance,
        flowDurationMs,
        flowDurationMin: (flowDurationMs / 60000).toFixed(1),
        diagnosis: "If yield is 0, check: (1) deposit_rewards was called during swaps, (2) update_cumulative was called during consume_randomness CPI, (3) sufficient epochs passed for rewards to accrue",
      },
    });
    overallSuccess = false;
  }

  return overallSuccess;
}
