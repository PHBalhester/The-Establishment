/**
 * Transfer Hook Account Resolver for Bonding Curve Operations
 *
 * Derives the 4 Transfer Hook remaining_accounts needed for purchase and sell
 * instructions. CRIME and FRAUD use Token-2022 Transfer Hooks, so every token
 * transfer through the bonding curve program must include these extra accounts.
 *
 * Hook accounts per mint = 4 (documented in MEMORY.md):
 * 1. ExtraAccountMetaList PDA: seeds = ["extra-account-metas", mint]
 * 2. Whitelist entry for source: seeds = ["whitelist", source]
 * 3. Whitelist entry for destination: seeds = ["whitelist", destination]
 * 4. Hook program ID itself (as non-signer, non-writable AccountMeta)
 *
 * NOTE: Do NOT use spl-token's createTransferCheckedWithTransferHookInstruction.
 * It has browser Buffer polyfill issues (documented in MEMORY.md). Manual PDA
 * derivation is the project standard.
 *
 * Direction matters:
 * - PURCHASE (vault -> user): source = curve token vault, dest = user's ATA
 * - SELL (user -> vault): source = user's ATA, dest = curve token vault
 */

import { PublicKey } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { SEEDS } from "@dr-fraudsworth/shared";
import { PROGRAM_IDS } from "@/lib/protocol-config";

/**
 * Derive the 4 Transfer Hook remaining_accounts for a bonding curve token transfer.
 *
 * @param mint - Token mint (CRIME or FRAUD)
 * @param source - Token account sending tokens (vault for purchase, user ATA for sell)
 * @param destination - Token account receiving tokens (user ATA for purchase, vault for sell)
 * @returns Array of 4 AccountMeta objects, all non-signer non-writable
 */
export function getCurveHookAccounts(
  mint: PublicKey,
  source: PublicKey,
  destination: PublicKey,
): AccountMeta[] {
  const hookProgram = PROGRAM_IDS.TRANSFER_HOOK;

  // 1. ExtraAccountMetaList PDA: seeds = ["extra-account-metas", mint]
  const [metaList] = PublicKey.findProgramAddressSync(
    [SEEDS.EXTRA_ACCOUNT_META, mint.toBuffer()],
    hookProgram,
  );

  // 2. Whitelist entry for source: seeds = ["whitelist", source]
  const [wlSource] = PublicKey.findProgramAddressSync(
    [SEEDS.WHITELIST_ENTRY, source.toBuffer()],
    hookProgram,
  );

  // 3. Whitelist entry for destination: seeds = ["whitelist", destination]
  const [wlDest] = PublicKey.findProgramAddressSync(
    [SEEDS.WHITELIST_ENTRY, destination.toBuffer()],
    hookProgram,
  );

  // 4. Hook program ID itself
  return [
    { pubkey: metaList, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: hookProgram, isSigner: false, isWritable: false },
  ];
}
