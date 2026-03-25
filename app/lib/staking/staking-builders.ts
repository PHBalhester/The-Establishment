/**
 * Staking Transaction Builders
 *
 * Builds complete Transaction objects for all 3 staking instructions:
 * - Stake (PROFIT -> StakeVault) -- 8 named accounts + 4 hook remaining_accounts
 * - Unstake (StakeVault -> PROFIT) -- 8 named accounts + 4 hook remaining_accounts
 * - Claim (SOL from EscrowVault) -- 5 named accounts, NO remaining_accounts
 *
 * Each builder:
 * 1. Creates compute budget instructions
 * 2. Checks/creates user's PROFIT ATA if needed (Token-2022)
 * 3. Resolves Transfer Hook remaining_accounts (stake/unstake only)
 * 4. Builds the Staking Program instruction via Anchor
 * 5. Assembles everything into a single Transaction
 *
 * CRITICAL hook direction:
 * - Stake: user ATA -> StakeVault (user sends PROFIT to vault)
 * - Unstake: StakeVault -> user ATA (vault sends PROFIT back to user) -- REVERSED
 * - Claim: no token transfer (native SOL from escrow PDA to user)
 *
 * All three fit in a legacy Transaction (no ALT needed):
 * - Stake: 12 total accounts (8 + 4 hook)
 * - Unstake: 12 total accounts (8 + 4 hook)
 * - Claim: 5 total accounts
 *
 * Source mapping:
 * - Stake struct: programs/staking/src/instructions/stake.rs
 * - Unstake struct: programs/staking/src/instructions/unstake.rs
 * - Claim struct: programs/staking/src/instructions/claim.rs
 * - Hook resolution: app/lib/swap/hook-resolver.ts
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import { getStakingProgram } from "@/lib/anchor";
import { resolveHookAccounts } from "@/lib/swap/hook-resolver";
import { SEEDS } from "@dr-fraudsworth/shared";
import {
  MINTS,
  PROGRAM_IDS,
  DEVNET_PDAS_EXTENDED,
} from "@/lib/protocol-config";

// =============================================================================
// Parameter Interfaces
// =============================================================================

/** Parameters for building a stake PROFIT transaction */
export interface StakeParams {
  /** Solana RPC connection */
  connection: Connection;
  /** User's wallet public key (signer) */
  userPublicKey: PublicKey;
  /** PROFIT amount to stake in base units (6 decimals) */
  amount: number;
  /** Compute unit limit (default 200,000) */
  computeUnits?: number;
  /** Priority fee in microLamports per compute unit (default 0) */
  priorityFeeMicroLamports?: number;
}

/** Parameters for building an unstake PROFIT transaction */
export interface UnstakeParams {
  /** Solana RPC connection */
  connection: Connection;
  /** User's wallet public key (signer) */
  userPublicKey: PublicKey;
  /** PROFIT amount to unstake in base units (6 decimals) */
  amount: number;
  /** Compute unit limit (default 200,000) */
  computeUnits?: number;
  /** Priority fee in microLamports per compute unit (default 0) */
  priorityFeeMicroLamports?: number;
}

/** Parameters for building a claim SOL rewards transaction */
export interface ClaimParams {
  /** Solana RPC connection */
  connection: Connection;
  /** User's wallet public key (signer) */
  userPublicKey: PublicKey;
  /** Compute unit limit (default 100,000 -- simpler instruction) */
  computeUnits?: number;
  /** Priority fee in microLamports per compute unit (default 0) */
  priorityFeeMicroLamports?: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Default compute unit limit for stake/unstake transactions */
const DEFAULT_COMPUTE_UNITS = 200_000;

/** Lower compute unit limit for claim (simpler instruction, no token transfer) */
const DEFAULT_CLAIM_COMPUTE_UNITS = 100_000;

/**
 * Derive the UserStake PDA for a given user.
 *
 * Seeds: ["user_stake", user_pubkey], program = Staking
 * This PDA holds the user's staking position (balance, rewards checkpoint, etc.)
 * The on-chain stake instruction uses init_if_needed, so the PDA will be
 * created automatically on first stake.
 *
 * @param userPubkey - User's wallet public key
 * @returns The UserStake PDA address
 */
export function deriveUserStakePDA(userPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.USER_STAKE, userPubkey.toBuffer()],
    PROGRAM_IDS.STAKING,
  );
  return pda;
}

/**
 * Get the Token-2022 ATA for a given owner and mint.
 * PROFIT uses TOKEN_2022_PROGRAM_ID.
 */
async function getToken2022Ata(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(
    mint,
    owner,
    false, // allowOwnerOffCurve = false
    TOKEN_2022_PROGRAM_ID,
  );
}

// =============================================================================
// Stake Transaction Builder
// =============================================================================

/**
 * Build a stake PROFIT transaction.
 *
 * Transaction structure:
 * 1. ComputeBudgetProgram.setComputeUnitLimit (always)
 * 2. ComputeBudgetProgram.setComputeUnitPrice (if priority > 0)
 * 3. Create user's PROFIT ATA if it doesn't exist (Token-2022)
 * 4. Staking Program stake instruction with 4 hook remaining_accounts
 *
 * Named accounts (8 total, matching Stake struct):
 * user, stakePool, userStake, userTokenAccount, stakeVault,
 * profitMint, tokenProgram, systemProgram
 *
 * Hook resolution: user ATA -> StakeVault (user sends PROFIT to vault)
 *
 * @param params - Stake parameters
 * @returns Complete unsigned Transaction ready for signing
 */
export async function buildStakeTransaction(params: StakeParams): Promise<Transaction> {
  const {
    connection,
    userPublicKey,
    amount,
    computeUnits = DEFAULT_COMPUTE_UNITS,
    priorityFeeMicroLamports = 0,
  } = params;

  const tx = new Transaction();

  // 1. Compute budget (always set limit; only set price if priority > 0)
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }

  // 2. Derive user's PROFIT ATA
  const userProfitAta = await getToken2022Ata(userPublicKey, MINTS.PROFIT);

  // 3. Check if user's PROFIT ATA exists; create if needed
  const ataInfo = await connection.getAccountInfo(userProfitAta);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        userPublicKey, // payer
        userProfitAta, // ATA address
        userPublicKey, // owner
        MINTS.PROFIT,  // mint
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // 4. Resolve Transfer Hook accounts
  //    Stake: user ATA -> StakeVault (user sends PROFIT to vault)
  //    Deterministic PDA derivation -- no RPC needed
  const hookAccounts = resolveHookAccounts(
    userProfitAta,                      // source: user sends PROFIT
    MINTS.PROFIT,                       // PROFIT mint
    DEVNET_PDAS_EXTENDED.StakeVault,    // dest: stake vault receives PROFIT
  );

  // 5. Build the Staking Program stake instruction
  const stakingProgram = getStakingProgram(connection);
  const userStakePda = deriveUserStakePDA(userPublicKey);

  const stakeIx = await stakingProgram.methods
    .stake(new BN(amount))
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: userStakePda,
      userTokenAccount: userProfitAta,
      stakeVault: DEVNET_PDAS_EXTENDED.StakeVault,
      profitMint: MINTS.PROFIT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  tx.add(stakeIx);

  return tx;
}

// =============================================================================
// Unstake Transaction Builder
// =============================================================================

/**
 * Build an unstake PROFIT transaction.
 *
 * Transaction structure:
 * 1. ComputeBudgetProgram.setComputeUnitLimit (always)
 * 2. ComputeBudgetProgram.setComputeUnitPrice (if priority > 0)
 * 3. Create user's PROFIT ATA if needed (should exist, but be safe)
 * 4. Staking Program unstake instruction with 4 hook remaining_accounts
 *
 * Named accounts (7 total, matching Unstake struct):
 * user, stakePool, userStake, userTokenAccount, stakeVault,
 * profitMint, tokenProgram
 *
 * CRITICAL: Hook direction is REVERSED compared to stake.
 * Unstake transfers PROFIT FROM StakeVault TO user.
 * Hook resolution: StakeVault -> user ATA (vault sends PROFIT back to user)
 *
 * @param params - Unstake parameters
 * @returns Complete unsigned Transaction ready for signing
 */
export async function buildUnstakeTransaction(params: UnstakeParams): Promise<Transaction> {
  const {
    connection,
    userPublicKey,
    amount,
    computeUnits = DEFAULT_COMPUTE_UNITS,
    priorityFeeMicroLamports = 0,
  } = params;

  const tx = new Transaction();

  // 1. Compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }

  // 2. Derive user's PROFIT ATA
  const userProfitAta = await getToken2022Ata(userPublicKey, MINTS.PROFIT);

  // 3. Check if user's PROFIT ATA exists; create if needed
  //    It should exist (they staked from it), but be defensive.
  const ataInfo = await connection.getAccountInfo(userProfitAta);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        userPublicKey, // payer
        userProfitAta, // ATA address
        userPublicKey, // owner
        MINTS.PROFIT,  // mint
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // 4. Resolve Transfer Hook accounts
  //    CRITICAL: Direction is REVERSED from stake.
  //    Unstake: StakeVault -> user ATA (vault sends PROFIT back to user)
  const hookAccounts = resolveHookAccounts(
    DEVNET_PDAS_EXTENDED.StakeVault,    // source: vault sends PROFIT
    MINTS.PROFIT,                       // PROFIT mint
    userProfitAta,                      // dest: user receives PROFIT
  );

  // 5. Build the Staking Program unstake instruction
  const stakingProgram = getStakingProgram(connection);
  const userStakePda = deriveUserStakePDA(userPublicKey);

  const unstakeIx = await stakingProgram.methods
    .unstake(new BN(amount))
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: userStakePda,
      userTokenAccount: userProfitAta,
      stakeVault: DEVNET_PDAS_EXTENDED.StakeVault,
      profitMint: MINTS.PROFIT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  tx.add(unstakeIx);

  return tx;
}

// =============================================================================
// Claim Transaction Builder
// =============================================================================

/**
 * Build a claim SOL rewards transaction.
 *
 * Transaction structure:
 * 1. ComputeBudgetProgram.setComputeUnitLimit (always)
 * 2. ComputeBudgetProgram.setComputeUnitPrice (if priority > 0)
 * 3. Staking Program claim instruction -- NO hook remaining_accounts
 *
 * Named accounts (5 total, matching Claim struct):
 * user, stakePool, userStake, escrowVault, systemProgram
 *
 * Claim transfers native SOL (lamports) from the escrow PDA to the user.
 * No Token-2022 transfer is involved, so NO hook accounts are needed.
 * This makes claim the simplest of the three staking transactions.
 *
 * @param params - Claim parameters
 * @returns Complete unsigned Transaction ready for signing
 */
export async function buildClaimTransaction(params: ClaimParams): Promise<Transaction> {
  const {
    connection,
    userPublicKey,
    computeUnits = DEFAULT_CLAIM_COMPUTE_UNITS,
    priorityFeeMicroLamports = 0,
  } = params;

  const tx = new Transaction();

  // 1. Compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }

  // 2. Build the Staking Program claim instruction
  //    NO hook accounts -- claim transfers native SOL, not Token-2022 tokens
  const stakingProgram = getStakingProgram(connection);
  const userStakePda = deriveUserStakePDA(userPublicKey);

  const claimIx = await stakingProgram.methods
    .claim()
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: userStakePda,
      escrowVault: DEVNET_PDAS_EXTENDED.EscrowVault,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  tx.add(claimIx);

  return tx;
}
