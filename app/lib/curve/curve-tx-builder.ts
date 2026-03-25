/**
 * Bonding Curve Transaction Builders
 *
 * Three instruction builders for bonding curve operations:
 * 1. buildPurchaseInstruction - Buy tokens with SOL (vault -> user transfer, needs hook accounts)
 * 2. buildSellInstruction - Sell tokens for SOL minus 15% tax (user -> vault, needs hook accounts)
 * 3. buildClaimRefundInstruction - Burn tokens for proportional SOL refund (no hooks needed)
 *
 * All builders accept a Program<BondingCurve> instance and return Promise<TransactionInstruction>.
 * BigInt args are converted to BN via .toString() intermediate (Anchor expects BN, not BigInt).
 *
 * Transfer Hook accounts:
 * - Purchase: source = tokenVault (PDA sends tokens to user), dest = userAta
 * - Sell: source = userAta (user sends tokens to vault), dest = tokenVault
 * - ClaimRefund: No hook accounts (burn does not trigger Transfer Hooks)
 */

import { BN, type Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { BondingCurve } from "@/idl/types/bonding_curve";
import { SEEDS } from "@dr-fraudsworth/shared";
import { getCurveHookAccounts } from "./hook-accounts";

// ---------------------------------------------------------------------------
// PDA derivation helpers (all use program.programId as the owning program)
// ---------------------------------------------------------------------------

function deriveCurveState(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CURVE, mint.toBuffer()],
    programId,
  )[0];
}

function deriveTokenVault(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CURVE_TOKEN_VAULT, mint.toBuffer()],
    programId,
  )[0];
}

function deriveSolVault(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CURVE_SOL_VAULT, mint.toBuffer()],
    programId,
  )[0];
}

function deriveTaxEscrow(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.TAX_ESCROW, mint.toBuffer()],
    programId,
  )[0];
}

/**
 * Derive the user's Associated Token Account for a Token-2022 mint.
 * Uses allowOwnerOffCurve=true so PDAs can also be resolved (future-proofing).
 */
function deriveUserAta(user: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    user,
    true, // allowOwnerOffCurve
    TOKEN_2022_PROGRAM_ID,
  );
}

// ---------------------------------------------------------------------------
// Instruction Builders
// ---------------------------------------------------------------------------

/**
 * Build a purchase (buy) instruction for the bonding curve.
 *
 * Buys tokens with SOL. The curve walks forward on the linear price curve.
 * Includes Transfer Hook remaining_accounts (vault -> user direction).
 *
 * @param program - Anchor Program<BondingCurve> instance
 * @param user - Buyer's wallet public key (signer, pays SOL)
 * @param tokenMint - MINTS.CRIME or MINTS.FRAUD
 * @param solAmount - SOL to spend in lamports (as bigint)
 * @param minimumTokensOut - Minimum tokens to receive in base units (slippage protection)
 * @returns TransactionInstruction ready to add to a Transaction
 */
export async function buildPurchaseInstruction(
  program: Program<BondingCurve>,
  user: PublicKey,
  tokenMint: PublicKey,
  solAmount: bigint,
  minimumTokensOut: bigint,
): Promise<TransactionInstruction> {
  const programId = program.programId;

  // Derive PDAs
  const curveState = deriveCurveState(tokenMint, programId);
  const tokenVault = deriveTokenVault(tokenMint, programId);
  const solVault = deriveSolVault(tokenMint, programId);
  const userTokenAccount = deriveUserAta(user, tokenMint);

  // Hook accounts: source = tokenVault (PDA sends tokens TO user)
  const hookAccounts = getCurveHookAccounts(tokenMint, tokenVault, userTokenAccount);

  return program.methods
    .purchase(
      new BN(solAmount.toString()),
      new BN(minimumTokensOut.toString()),
    )
    .accountsStrict({
      user,
      curveState,
      userTokenAccount,
      tokenVault,
      solVault,
      tokenMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();
}

/**
 * Build a sell instruction for the bonding curve.
 *
 * Sells tokens back to the curve for SOL minus 15% tax. Tax goes to the
 * tax escrow PDA. Includes Transfer Hook remaining_accounts (user -> vault direction).
 *
 * @param program - Anchor Program<BondingCurve> instance
 * @param user - Seller's wallet public key (signer, receives SOL)
 * @param tokenMint - MINTS.CRIME or MINTS.FRAUD
 * @param tokensToSell - Tokens to sell in base units (as bigint)
 * @param minimumSolOut - Minimum SOL to receive in lamports (slippage protection)
 * @returns TransactionInstruction ready to add to a Transaction
 */
export async function buildSellInstruction(
  program: Program<BondingCurve>,
  user: PublicKey,
  tokenMint: PublicKey,
  tokensToSell: bigint,
  minimumSolOut: bigint,
): Promise<TransactionInstruction> {
  const programId = program.programId;

  // Derive PDAs
  const curveState = deriveCurveState(tokenMint, programId);
  const tokenVault = deriveTokenVault(tokenMint, programId);
  const solVault = deriveSolVault(tokenMint, programId);
  const taxEscrow = deriveTaxEscrow(tokenMint, programId);
  const userTokenAccount = deriveUserAta(user, tokenMint);

  // Hook accounts: source = userAta (user sends tokens TO vault) -- REVERSED vs purchase
  const hookAccounts = getCurveHookAccounts(tokenMint, userTokenAccount, tokenVault);

  return program.methods
    .sell(
      new BN(tokensToSell.toString()),
      new BN(minimumSolOut.toString()),
    )
    .accountsStrict({
      user,
      curveState,
      userTokenAccount,
      tokenVault,
      solVault,
      taxEscrow,
      tokenMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();
}

/**
 * Build a claim_refund instruction for the bonding curve.
 *
 * Burns the user's entire token balance and returns proportional SOL from the
 * vault. Only callable when the curve has Failed status. Both curves must be
 * checked (partner_curve_state) for compound state eligibility.
 *
 * NOTE: claim_refund does NOT need Transfer Hook remaining_accounts because
 * the refund burns tokens directly (burn does not trigger Transfer Hooks).
 *
 * @param program - Anchor Program<BondingCurve> instance
 * @param user - User claiming refund (signer, receives SOL)
 * @param tokenMint - Mint of the curve being refunded (CRIME or FRAUD)
 * @param partnerTokenMint - Mint of the partner curve (for compound state check)
 * @returns TransactionInstruction ready to add to a Transaction
 */
export async function buildClaimRefundInstruction(
  program: Program<BondingCurve>,
  user: PublicKey,
  tokenMint: PublicKey,
  partnerTokenMint: PublicKey,
): Promise<TransactionInstruction> {
  const programId = program.programId;

  // Derive PDAs
  const curveState = deriveCurveState(tokenMint, programId);
  const partnerCurveState = deriveCurveState(partnerTokenMint, programId);
  const solVault = deriveSolVault(tokenMint, programId);
  const userTokenAccount = deriveUserAta(user, tokenMint);

  // No remaining_accounts -- burn does not trigger Transfer Hooks
  return program.methods
    .claimRefund()
    .accountsStrict({
      user,
      curveState,
      partnerCurveState,
      userTokenAccount,
      tokenMint,
      solVault,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
}
