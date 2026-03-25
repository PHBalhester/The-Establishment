/**
 * Transfer Hook Remaining Accounts Resolver
 *
 * Resolves the extra accounts required by Token-2022 Transfer Hook extensions
 * using deterministic PDA derivation (no RPC calls needed).
 *
 * Why manual derivation instead of createTransferCheckedWithTransferHookInstruction:
 * The spl-token helper uses Buffer.writeBigUInt64LE internally, which is not
 * available in the browser's `buffer` polyfill (v6.x). Manual PDA derivation
 * avoids this entirely and is also faster (no RPC round-trip).
 *
 * Per MEMORY.md: HOOK_ACCOUNTS_PER_MINT = 4. Each Token-2022 mint produces
 * exactly 4 extra accounts:
 *   1. ExtraAccountMetaList PDA -- seeds: ["extra-account-metas", mint]
 *   2. Source whitelist entry PDA -- seeds: ["whitelist", source_token_account]
 *   3. Dest whitelist entry PDA -- seeds: ["whitelist", dest_token_account]
 *   4. Hook program ID (as a read-only account)
 *
 * For PROFIT pool swaps (token <-> PROFIT), callers must call resolveHookAccounts
 * twice (once per Token-2022 side) and concatenate the results.
 *
 * Source: programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs
 */

import { PublicKey } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { PROGRAM_IDS } from "@/lib/protocol-config";

/** All three meme tokens (CRIME, FRAUD, PROFIT) use 6 decimals */
export const TOKEN_DECIMALS = 6;

/**
 * Resolve Transfer Hook remaining_accounts for a Token-2022 transfer.
 *
 * Derives all 4 hook accounts deterministically using PDA seeds:
 * - ExtraAccountMetaList: ["extra-account-metas", mint] @ Hook program
 * - Source whitelist: ["whitelist", source] @ Hook program
 * - Dest whitelist: ["whitelist", dest] @ Hook program
 * - Hook program itself (read-only, non-signer)
 *
 * @param source - Token account sending tokens (e.g., pool vault or user ATA)
 * @param mint - Token-2022 mint with Transfer Hook extension
 * @param dest - Token account receiving tokens (e.g., user ATA or pool vault)
 * @returns Array of 4 AccountMeta for remaining_accounts
 */
export function resolveHookAccounts(
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
): AccountMeta[] {
  const hookProgramId = PROGRAM_IDS.TRANSFER_HOOK;

  // 1. ExtraAccountMetaList PDA: Token-2022 reads this to find required accounts
  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    hookProgramId,
  );

  // 2. Source whitelist entry PDA: existence-based whitelist check
  const [sourceWhitelist] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), source.toBuffer()],
    hookProgramId,
  );

  // 3. Destination whitelist entry PDA: existence-based whitelist check
  const [destWhitelist] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), dest.toBuffer()],
    hookProgramId,
  );

  // 4. Hook program ID itself (Token-2022 requires it as trailing account)
  return [
    { pubkey: extraAccountMetaList, isSigner: false, isWritable: false },
    { pubkey: sourceWhitelist, isSigner: false, isWritable: false },
    { pubkey: destWhitelist, isSigner: false, isWritable: false },
    { pubkey: hookProgramId, isSigner: false, isWritable: false },
  ];
}
