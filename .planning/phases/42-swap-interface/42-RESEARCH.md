# Phase 42: Swap Interface - Research

**Researched:** 2026-02-15
**Domain:** Solana swap UI (transaction building, client-side AMM quoting, Privy wallet signing, error handling, priority fees)
**Confidence:** HIGH

## Summary

Phase 42 builds the interactive swap form that lets users buy and sell CRIME, FRAUD, and PROFIT tokens across all 4 AMM pools. The codebase already has everything needed for the backend side: 5 deployed Anchor programs, complete IDL types, shared constants with all PDA addresses, an Anchor program factory for read-only access, and extensive E2E test scripts that demonstrate exact transaction building patterns. The frontend framework (Next.js + Tailwind v4 + Privy) and data layer (usePoolPrices, useEpochState, useTokenBalances, useProtocolWallet) are established from Phases 39-41.

The core technical challenge is translating the server-side swap transaction building (currently in `scripts/e2e/lib/swap-flow.ts` using AnchorProvider with keypair signing) into browser-side transaction building with Privy wallet signing. This requires: (1) building Transaction objects with the correct account lists using only the IDL + shared constants, (2) resolving Transfer Hook remaining_accounts via `createTransferCheckedWithTransferHookInstruction`, (3) signing via `useProtocolWallet().signTransaction()`, (4) sending via `connection.sendRawTransaction()`, and (5) confirming via `connection.confirmTransaction()` with proper blockhash lifecycle management.

**Primary recommendation:** Port the exact account structures from `swap-flow.ts` and the on-chain Rust instruction structs into a browser-compatible `lib/swap-builders.ts` module. Use the existing `usePoolPrices` reserves data for client-side quote computation (same math as on-chain `programs/amm/src/helpers/math.rs`). Keep all transaction logic in pure library functions; the React hook layer (`useSwap`) orchestrates state transitions only.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | ^1.x (already installed) | Transaction, PublicKey, Connection, ComputeBudgetProgram | Already in use; provides all primitives for building and sending transactions |
| `@solana/spl-token` | ^0.4.x (already installed) | `createTransferCheckedWithTransferHookInstruction`, `NATIVE_MINT`, `TOKEN_2022_PROGRAM_ID`, `TOKEN_PROGRAM_ID`, ATA utilities | Already used in E2E scripts for Transfer Hook account resolution |
| `@coral-xyz/anchor` | ^0.30.x (already installed) | `BN` for u64 instruction arguments, IDL type safety | Already in use for program factory; needed for instruction argument serialization |
| `@privy-io/react-auth` | ^2.x (already installed) | `useSignTransaction`, `useWallets` from `/solana` subpath | Already configured in providers.tsx; useProtocolWallet wraps these |
| `@dr-fraudsworth/shared` | workspace | `DEVNET_POOLS`, `DEVNET_PDAS`, `MINTS`, `PROGRAM_IDS`, `SEEDS`, fee constants | Single source of truth for all addresses; already used by dashboard hooks |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bn.js` | (transitive via @coral-xyz/anchor) | `new BN(amount)` for u64 instruction args | Every swap instruction call |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw instruction building | Anchor `.methods` builder | Anchor methods builder requires a Provider with wallet, which conflicts with Privy's signing model. Raw instruction building (matching swap-flow.ts pattern) gives full control over account lists and remaining_accounts. Use raw building. |
| `@solana/kit` (web3.js v2) | `@solana/web3.js` v1 | The codebase is on web3.js v1 everywhere. Migrating mid-project adds risk for zero benefit. Stay on v1. |
| `useSignAndSendTransaction` (Privy) | `useSignTransaction` + manual `sendRawTransaction` | signAndSendTransaction hides the sending step, preventing us from adding custom confirmation logic. Use sign-then-send for full control over confirmation UX. |

**Installation:**
No new packages needed. All dependencies are already in the workspace.

## Architecture Patterns

### Recommended Project Structure
```
app/
├── lib/
│   ├── swap/
│   │   ├── quote-engine.ts      # Client-side AMM math (mirrors on-chain math.rs)
│   │   ├── swap-builders.ts     # Transaction builders for all 4 swap types
│   │   ├── hook-resolver.ts     # Transfer Hook remaining_accounts resolution
│   │   ├── error-map.ts         # Anchor error code -> human-readable message
│   │   └── wsol.ts              # WSOL wrap/unwrap/ATA helpers
│   ├── anchor.ts                # (existing) Program factory
│   └── connection.ts            # (existing) Connection singleton
├── hooks/
│   ├── useSwap.ts               # Orchestrates swap lifecycle (quote -> sign -> send -> confirm)
│   ├── useProtocolWallet.ts     # (existing) Wallet abstraction
│   ├── usePoolPrices.ts         # (existing) Real-time pool reserves
│   ├── useEpochState.ts         # (existing) Tax rates
│   └── useTokenBalances.ts      # (existing) Wallet balances
└── components/
    └── swap/
        ├── SwapForm.tsx          # Main swap form (input/output fields, token selectors)
        ├── TokenSelector.tsx     # Dropdown with valid token pairs
        ├── FeeBreakdown.tsx      # Expandable fee/tax details
        ├── SlippageConfig.tsx    # Inline slippage + priority fee controls
        └── SwapStatus.tsx        # TX status indicator (inline on form)
```

### Pattern 1: Client-Side Quote Engine (Mirrors On-Chain Math)
**What:** Pure TypeScript functions that replicate the on-chain AMM math exactly, using pool reserves from `usePoolPrices` and tax rates from `useEpochState`.
**When to use:** Every time the user types in the input or output field (debounced ~300ms).
**Example:**
```typescript
// Source: programs/amm/src/helpers/math.rs (verified against on-chain code)

const BPS_DENOMINATOR = 10_000;

/** Calculate effective input after LP fee deduction */
export function calculateEffectiveInput(amountIn: number, feeBps: number): number {
  return Math.floor(amountIn * (BPS_DENOMINATOR - feeBps) / BPS_DENOMINATOR);
}

/** Constant-product swap output: reserve_out * effective_in / (reserve_in + effective_in) */
export function calculateSwapOutput(
  reserveIn: number,
  reserveOut: number,
  effectiveInput: number,
): number {
  if (reserveIn + effectiveInput === 0) return 0;
  return Math.floor((reserveOut * effectiveInput) / (reserveIn + effectiveInput));
}

/** Calculate tax (SOL pools only): amount * taxBps / 10_000 */
export function calculateTax(amountLamports: number, taxBps: number): number {
  return Math.floor(amountLamports * taxBps / BPS_DENOMINATOR);
}

/** Full quote for SOL buy: SOL -> CRIME/FRAUD */
export function quoteSolBuy(
  solAmountLamports: number,
  reserveWsol: number,
  reserveToken: number,
  buyTaxBps: number,
  lpFeeBps: number,
): { outputTokens: number; lpFee: number; taxAmount: number; netInput: number } {
  // 1. Tax deducted from SOL input first
  const taxAmount = calculateTax(solAmountLamports, buyTaxBps);
  const afterTax = solAmountLamports - taxAmount;

  // 2. LP fee from remaining
  const lpFee = afterTax - calculateEffectiveInput(afterTax, lpFeeBps);
  const effectiveInput = calculateEffectiveInput(afterTax, lpFeeBps);

  // 3. AMM output
  const outputTokens = calculateSwapOutput(reserveWsol, reserveToken, effectiveInput);

  return { outputTokens, lpFee, taxAmount, netInput: effectiveInput };
}
```

### Pattern 2: Transaction Building (Port from E2E Scripts)
**What:** Functions that build complete Transaction objects with all named accounts + remaining_accounts, ready for signing.
**When to use:** When user clicks "Swap" button.
**Example:**
```typescript
// Source: scripts/e2e/lib/swap-flow.ts lines 443-478 (verified against on-chain IDL)

import { Transaction, PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { PROGRAM_IDS, MINTS, DEVNET_POOLS, DEVNET_PDAS, SEEDS } from "@dr-fraudsworth/shared";

export async function buildSolBuyTransaction(
  userPublicKey: PublicKey,
  amountInLamports: number,
  minimumOutput: number,
  isCrime: boolean,
  poolData: { pool: string; vaultA: string; vaultB: string },
  hookAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
  computeUnits: number = 200_000,
  priorityFeeMicroLamports: number = 0,
): Promise<Transaction> {
  // Derive swap_authority PDA from Tax Program
  const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
    [SEEDS.SWAP_AUTHORITY],
    PROGRAM_IDS.TAX_PROGRAM,
  );

  // Derive tax_authority PDA from Tax Program
  const [taxAuthorityPda] = PublicKey.findProgramAddressSync(
    [SEEDS.TAX_AUTHORITY],
    PROGRAM_IDS.TAX_PROGRAM,
  );

  const tokenMint = isCrime ? MINTS.CRIME : MINTS.FRAUD;

  // Build instruction using Anchor's method builder pattern
  // NOTE: This requires a Program instance. Since we don't have a Provider with
  // wallet in browser context, we build the instruction data manually (same as
  // swap-flow.ts does with invoke_signed).
  // Alternative: Use getTaxProgram() with read-only connection, then .methods.swapSolBuy()
  //   .accountsStrict({...}).remainingAccounts(hookAccounts).instruction()
  //   This works because .instruction() does not need a wallet - it just builds the IX.

  const taxProgram = getTaxProgram(); // read-only is fine for .instruction()

  const swapIx = await taxProgram.methods
    .swapSolBuy(
      new anchor.BN(amountInLamports),
      new anchor.BN(minimumOutput),
      isCrime,
    )
    .accountsStrict({
      user: userPublicKey,
      epochState: DEVNET_PDAS.EpochState,
      swapAuthority: swapAuthorityPda,
      taxAuthority: taxAuthorityPda,
      pool: new PublicKey(poolData.pool),
      poolVaultA: new PublicKey(poolData.vaultA),
      poolVaultB: new PublicKey(poolData.vaultB),
      mintA: NATIVE_MINT,
      mintB: tokenMint,
      userTokenA: userWsolAta, // User's WSOL ATA
      userTokenB: userTokenAta, // User's CRIME/FRAUD ATA
      stakePool: new PublicKey(manifest.pdas.StakePool),
      stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
      carnageVault: DEVNET_PDAS.CarnageSolVault,
      treasury: new PublicKey("8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4"),
      ammProgram: PROGRAM_IDS.AMM,
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      stakingProgram: PROGRAM_IDS.STAKING,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }
  tx.add(swapIx);

  return tx;
}
```

### Pattern 3: Sign-Then-Send with Privy
**What:** Use `useProtocolWallet().signTransaction()` to sign, then `connection.sendRawTransaction()` to send, then `connection.confirmTransaction()` to confirm. This gives full control over the UX state machine.
**When to use:** Every swap submission.
**Example:**
```typescript
// Source: useProtocolWallet (verified from app/hooks/useProtocolWallet.ts)

async function executeSwap(tx: Transaction): Promise<{ signature: string; status: 'confirmed' | 'failed' }> {
  const connection = getConnection();

  // 1. Set recent blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey!;

  // 2. Sign with Privy
  const signedTx = await wallet.signTransaction(tx);

  // 3. Send raw transaction
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false, // Use preflight for user-facing swaps (catches errors before submission)
    maxRetries: 2,
  });

  // 4. Confirm with blockhash strategy
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  }, "confirmed");

  if (confirmation.value.err) {
    return { signature, status: 'failed' };
  }

  return { signature, status: 'confirmed' };
}
```

### Pattern 4: Transfer Hook Account Resolution
**What:** Use `createTransferCheckedWithTransferHookInstruction` to build a dummy instruction, then extract remaining_accounts (keys after the first 4: source, mint, dest, authority).
**When to use:** Before every swap that involves Token-2022 tokens (all swaps in this protocol).
**Example:**
```typescript
// Source: scripts/e2e/lib/swap-flow.ts lines 132-159 (verified)

import { createTransferCheckedWithTransferHookInstruction } from "@solana/spl-token";

export async function resolveHookAccounts(
  connection: Connection,
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
): Promise<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]> {
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    source,       // e.g., pool vault
    mint,         // CRIME/FRAUD/PROFIT mint
    dest,         // e.g., user token account
    authority,    // swap_authority PDA
    BigInt(0),    // amount doesn't affect hook resolution
    6,            // TOKEN_DECIMALS
    [],           // no extra signers
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );

  // Skip first 4 keys (source, mint, dest, authority)
  return transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));
}
```

### Pattern 5: WSOL Wrap/Unwrap for Browser Users
**What:** Browser users hold native SOL, not WSOL. Before a SOL buy swap, we must wrap SOL into a WSOL token account. After a SOL sell swap, users receive WSOL that should be unwrapped.
**When to use:** SOL pool swaps (CRIME/SOL, FRAUD/SOL).
**Critical detail:** The WSOL wrapping/unwrapping instructions should be included in the SAME transaction as the swap to make it atomic.
**Example:**
```typescript
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// For SOL buy: wrap SOL -> execute swap (atomic, single TX)
async function buildSolBuyWithWrap(
  userPublicKey: PublicKey,
  amountLamports: number,
  // ...swap params
): Promise<Transaction> {
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, userPublicKey, false, TOKEN_PROGRAM_ID);

  const tx = new Transaction();

  // Check if WSOL ATA exists; if not, create it
  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    tx.add(createAssociatedTokenAccountInstruction(
      userPublicKey,  // payer
      wsolAta,        // ATA address
      userPublicKey,  // owner
      NATIVE_MINT,    // mint
      TOKEN_PROGRAM_ID,
    ));
  }

  // Transfer SOL to WSOL ATA + sync
  tx.add(
    SystemProgram.transfer({
      fromPubkey: userPublicKey,
      toPubkey: wsolAta,
      lamports: amountLamports,
    }),
    createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
  );

  // Add swap instruction (uses wsolAta as userTokenA)
  // ...add swap IX...

  return tx;
}

// For SOL sell: execute swap -> unwrap WSOL (atomic, single TX)
// After swap, user receives WSOL. Close the WSOL account to get native SOL back.
// Add createCloseAccountInstruction(wsolAta, userPublicKey, userPublicKey) at the end.
```

### Pattern 6: Debounced Quote with Both-Direction Support
**What:** When user types in input field, compute output. When user types in output field, reverse-compute input. Debounce at ~300ms.
**When to use:** As the user types in either field of the swap form.
**Example:**
```typescript
// Reverse quote: "I want X output tokens, how much input do I need?"
// Reverse constant-product: input_needed = reserve_in * output / (reserve_out - output)
// Then reverse LP fee: gross_input = net_input * 10_000 / (10_000 - fee_bps)
// Then reverse tax (for SOL buy): total_sol = gross_input * 10_000 / (10_000 - tax_bps)

export function reverseQuoteSolBuy(
  desiredOutputTokens: number,
  reserveWsol: number,
  reserveToken: number,
  buyTaxBps: number,
  lpFeeBps: number,
): { inputSolNeeded: number; lpFee: number; taxAmount: number } | null {
  if (desiredOutputTokens >= reserveToken) return null; // Impossible

  // Reverse AMM: how much effective_input produces desiredOutputTokens?
  // output = reserve_out * eff_in / (reserve_in + eff_in)
  // => eff_in = reserve_in * output / (reserve_out - output)
  const effectiveInput = Math.ceil(
    (reserveWsol * desiredOutputTokens) / (reserveToken - desiredOutputTokens)
  );

  // Reverse LP fee: effective = gross * (10000 - fee) / 10000
  // => gross = effective * 10000 / (10000 - fee)
  const afterTax = Math.ceil(effectiveInput * BPS_DENOMINATOR / (BPS_DENOMINATOR - lpFeeBps));

  // Reverse tax: afterTax = total - tax = total * (10000 - taxBps) / 10000
  // => total = afterTax * 10000 / (10000 - taxBps)
  const totalSol = Math.ceil(afterTax * BPS_DENOMINATOR / (BPS_DENOMINATOR - buyTaxBps));

  const taxAmount = totalSol - afterTax;
  const lpFee = afterTax - effectiveInput;

  return { inputSolNeeded: totalSol, lpFee, taxAmount };
}
```

### Anti-Patterns to Avoid
- **Using Anchor Provider with wallet for browser:** The Anchor Provider pattern used in E2E scripts (`provider.sendAndConfirm(tx, [keypair])`) doesn't work with Privy. Instead, build instructions with `.instruction()` (read-only program), then sign with Privy separately.
- **Forgetting WSOL wrapping:** Users have native SOL, not WSOL. Every SOL pool swap must include WSOL wrap instructions in the same transaction. Forgetting this causes the swap to fail with "insufficient balance" on the WSOL token account.
- **Hardcoding minimum_output to 0:** The E2E scripts use `minimumOutput = 0` for testing convenience. Production swaps MUST calculate a real minimum based on quoted output minus slippage tolerance.
- **Using `sendAndConfirmTransaction`:** This blocks until confirmation with no status updates. Use `sendRawTransaction` + manual `confirmTransaction` to show Sending/Confirming/Confirmed states.
- **Polling for confirmation:** Use `connection.confirmTransaction()` with the blockhash strategy (returns a promise that resolves on confirmation or expiry). Do NOT poll `getSignatureStatuses` manually.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transfer Hook account resolution | Manual PDA derivation for ExtraAccountMetaList | `createTransferCheckedWithTransferHookInstruction` from `@solana/spl-token` | The hook meta list format is complex; the SDK resolves it correctly including nested accounts |
| WSOL ATA address derivation | Manual PDA derivation | `getAssociatedTokenAddress(NATIVE_MINT, owner, false, TOKEN_PROGRAM_ID)` | Must use TOKEN_PROGRAM_ID (not TOKEN_2022_PROGRAM_ID) for WSOL; easy to get wrong |
| Anchor instruction serialization | Manual discriminator + borsh encoding | `program.methods.swapSolBuy(...).accountsStrict({...}).instruction()` | Anchor handles discriminator computation and argument serialization |
| Token-2022 ATA for CRIME/FRAUD/PROFIT | Manual derivation with wrong program | `getAssociatedTokenAddress(mint, owner, false, TOKEN_2022_PROGRAM_ID)` | MUST use TOKEN_2022_PROGRAM_ID; using TOKEN_PROGRAM_ID returns wrong address |
| Debounce | Custom setTimeout logic | `useDebouncedCallback` from `use-debounce` or simple custom hook | Edge case handling (rapid typing, unmount cleanup) is error-prone |

**Key insight:** The existing E2E scripts (`scripts/e2e/lib/swap-flow.ts`, `user-setup.ts`) are the authoritative reference for how to build swap transactions. Port their exact account structures; do not re-derive from scratch.

## Common Pitfalls

### Pitfall 1: WSOL Token Account Lifecycle
**What goes wrong:** User has no WSOL token account, or the WSOL account has stale balance. Swap fails with "Account not found" or "insufficient funds".
**Why it happens:** Unlike CRIME/FRAUD/PROFIT, WSOL accounts are not automatically created. Users hold native SOL, not WSOL.
**How to avoid:** Bundle WSOL ATA creation + SOL transfer + syncNative in the same transaction as the swap. For sell swaps, append `closeAccount` instruction to unwrap WSOL back to native SOL.
**Warning signs:** "Account does not exist" error on the WSOL token account.

### Pitfall 2: Token Program Mismatch (TOKEN_PROGRAM_ID vs TOKEN_2022_PROGRAM_ID)
**What goes wrong:** Passing the wrong token program for a mint causes the transaction to fail with `WsolProgramMismatch` or `Token2022ProgramMismatch`.
**Why it happens:** WSOL uses SPL Token (TOKEN_PROGRAM_ID), while CRIME/FRAUD/PROFIT use Token-2022 (TOKEN_2022_PROGRAM_ID). Easy to mix up.
**How to avoid:** Use a lookup map:
```typescript
const TOKEN_PROGRAM_FOR_MINT: Record<string, PublicKey> = {
  [NATIVE_MINT.toBase58()]: TOKEN_PROGRAM_ID,
  [MINTS.CRIME.toBase58()]: TOKEN_2022_PROGRAM_ID,
  [MINTS.FRAUD.toBase58()]: TOKEN_2022_PROGRAM_ID,
  [MINTS.PROFIT.toBase58()]: TOKEN_2022_PROGRAM_ID,
};
```
**Warning signs:** Error 6007 (WsolProgramMismatch) or 6008 (Token2022ProgramMismatch) from Tax Program.

### Pitfall 3: Transfer Hook Accounts for PROFIT Pool Swaps (Dual Hooks)
**What goes wrong:** PROFIT pool swaps need Transfer Hook accounts for BOTH sides (input token + output token), not just one side. Missing half the hook accounts causes the AMM CPI to fail.
**Why it happens:** SOL pool swaps only need hooks for the Token-2022 side (CRIME/FRAUD), since WSOL has no hooks. PROFIT pool swaps have hooks on both tokens.
**How to avoid:** For PROFIT pools, resolve hook accounts for BOTH mints and concatenate them. The AMM splits remaining_accounts at the midpoint: first half for Token A (CRIME/FRAUD), second half for Token B (PROFIT). Per MEMORY.md: `HOOK_ACCOUNTS_PER_MINT = 4`. So PROFIT pools need 8 remaining_accounts total (4 per side).
**Warning signs:** CPI failure in AMM with "insufficient accounts" or hook program errors.

### Pitfall 4: Sell Swap Account Count and TX Size
**What goes wrong:** Sell swap transactions have 20 named accounts + 4 Transfer Hook remaining_accounts = 24 total accounts. This is large but still fits in a legacy transaction (unlike Carnage which needs v0 + ALT).
**Why it happens:** SWAP-10 requirement specifies legacy TX for sell path.
**How to avoid:** Per MEMORY.md: "All user-facing transactions fit legacy TX format (v0 TX + ALT only needed for server-cranked Carnage)." SOL sell swaps have 20 named + 4 remaining = 24 accounts. This fits in legacy TX (1232 byte limit). No ALT needed.
**Warning signs:** "Transaction too large" error would indicate an account list bug.

### Pitfall 5: Slippage Applied AFTER Tax (Not Before)
**What goes wrong:** If slippage is applied to the pre-tax output, users get less than expected because tax is deducted afterward.
**Why it happens:** Confusion about the order of operations.
**How to avoid:** Per Tax_Pool_Logic_Spec.md and CONTEXT.md: "Slippage is applied AFTER fees/taxes are calculated." The `minimum_output` parameter in all swap instructions represents the minimum the user ACTUALLY RECEIVES (post-tax for sell, post-swap for buy). Calculate: `minimumOutput = quotedOutput * (1 - slippageTolerance)`.
**Warning signs:** Users consistently receiving less than the displayed quote.

### Pitfall 6: Quote Staleness from Pool Reserve Changes
**What goes wrong:** User gets a quote, waits, then submits. By submission time, pool reserves have changed (another swap occurred). The on-chain output differs from the quoted output.
**Why it happens:** Mempool activity, other users swapping, Carnage execution.
**How to avoid:** (1) `usePoolPrices` provides real-time WebSocket updates, so quotes auto-refresh. (2) Use a reasonable slippage tolerance (1% default) to absorb minor price movement. (3) Re-quote on form submission (not just on typing) to catch large movements.
**Warning signs:** Frequent `SlippageExceeded` (error 6002) failures.

### Pitfall 7: Privy signTransaction Returns Uint8Array, Not Transaction
**What goes wrong:** Calling `signTransaction` with Privy's hook returns `{ signedTransaction: Uint8Array }`. Treating it as a Transaction object causes serialization errors.
**Why it happens:** Privy serializes/deserializes through its iframe bridge.
**How to avoid:** The existing `useProtocolWallet` hook already handles this correctly -- it serializes the Transaction to Uint8Array before passing to Privy, then deserializes back. Use `useProtocolWallet().signTransaction()`, not Privy hooks directly.
**Warning signs:** "Cannot read property 'serialize' of undefined" errors.

### Pitfall 8: Token Account Creation for New Users
**What goes wrong:** First-time users don't have Token-2022 ATAs for CRIME/FRAUD/PROFIT. Swap fails because the output token account doesn't exist.
**Why it happens:** ATAs are created on first use, not on wallet creation.
**How to avoid:** Before building the swap transaction, check if the user's output token ATA exists. If not, prepend a `createAssociatedTokenAccountInstruction` to the transaction. Use `TOKEN_2022_PROGRAM_ID` for CRIME/FRAUD/PROFIT ATAs, `TOKEN_PROGRAM_ID` for WSOL ATA.
**Warning signs:** "Account not found" or "Invalid account data" on the output token account.

## Code Examples

### Complete Error Map (From On-Chain Error Codes)
```typescript
// Source: programs/tax-program/src/errors.rs, programs/amm/src/errors.rs (verified)

/** Human-readable error messages for all swap-relevant Anchor error codes */
export const SWAP_ERROR_MAP: Record<number, string> = {
  // === Tax Program errors (6000-6013) ===
  6000: "This pool doesn't support that operation. Please check your token selection.",
  6001: "The swap amount is too large for the protocol to process safely.",
  6002: "Price moved beyond your slippage tolerance. Try increasing slippage or reducing the swap size.",
  6003: "The protocol's epoch state is currently unavailable. Please try again in a moment.",
  6004: "The swap amount is too small to produce any output after fees.",
  6005: "The output amount is below your minimum threshold after tax deduction.",
  6006: "Internal error: swap authority mismatch. Please refresh and try again.",
  6007: "Token program mismatch. The protocol detected an incorrect token program.",
  6008: "Token program mismatch. The protocol detected an incorrect token program.",
  6009: "Your token account ownership could not be verified.",
  6010: "This operation is restricted to the Carnage system.",
  6011: "Internal error: staking escrow mismatch.",
  6012: "Internal error: carnage vault mismatch.",
  6013: "Internal error: treasury address mismatch.",

  // === AMM errors (6000-6012, offset by AMM program) ===
  // NOTE: Anchor error codes are program-scoped. When the error comes from a CPI
  // to the AMM, the error code may appear differently. Parse the error logs to
  // identify which program emitted the error.
  // AMM-specific errors that users might see through CPI:
  // Overflow (6000 in AMM) -> "Swap calculation overflow"
  // SlippageExceeded (6010 in AMM) -> same as Tax 6002
  // ZeroEffectiveInput (6011 in AMM) -> same as Tax 6004
  // ZeroSwapOutput (6012 in AMM) -> same as Tax 6004
};

/**
 * Parse an Anchor/Solana error into a human-readable message.
 *
 * Anchor errors appear in logs as: "AnchorError ... Error Code: <Name>. Error Number: <code>."
 * Standard Solana errors appear as: "Error: ... custom program error: 0x<hex_code>"
 */
export function parseSwapError(error: unknown): string {
  const errStr = String(error);

  // 1. Check for Anchor error number pattern
  const anchorMatch = errStr.match(/Error Number: (\d+)/);
  if (anchorMatch) {
    const code = parseInt(anchorMatch[1]);
    return SWAP_ERROR_MAP[code] ?? `Swap failed with error code ${code}. Please try again.`;
  }

  // 2. Check for custom program error hex pattern
  const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const code = parseInt(hexMatch[1], 16);
    return SWAP_ERROR_MAP[code] ?? `Swap failed with error code ${code}. Please try again.`;
  }

  // 3. Check for common Solana errors
  if (errStr.includes("Blockhash not found") || errStr.includes("block height exceeded")) {
    return "Transaction expired. Please try again.";
  }
  if (errStr.includes("insufficient funds") || errStr.includes("Insufficient")) {
    return "Insufficient balance for this swap. Check your SOL and token balances.";
  }
  if (errStr.includes("Transaction too large")) {
    return "Transaction is too large. This is an unexpected error -- please report it.";
  }
  if (errStr.includes("User rejected") || errStr.includes("rejected")) {
    return "Transaction was cancelled.";
  }

  // 4. Fallback
  return "Swap failed. Please try again or reduce the swap amount.";
}
```

### Priority Fee Configuration
```typescript
// Source: Solana docs "How to Add Priority Fees" (verified)

/** Priority fee presets in microLamports per compute unit */
export const PRIORITY_FEE_PRESETS = {
  none: 0,
  low: 1_000,       // ~0.0002 SOL for 200k CU
  medium: 10_000,    // ~0.002 SOL for 200k CU
  high: 100_000,     // ~0.02 SOL for 200k CU
  turbo: 1_000_000,  // ~0.2 SOL for 200k CU
} as const;

/** Compute unit limits per swap type (from Tax_Pool_Logic_Spec.md Section 12) */
export const COMPUTE_UNITS = {
  SOL_BUY: 200_000,     // Tax->AMM->T22->Hook (~120k actual + margin)
  SOL_SELL: 200_000,     // Tax->AMM->T22->Hook (~130k actual + margin)
  PROFIT_SWAP: 200_000,  // Tax->AMM->T22->Hook x2 (~150k actual + margin)
} as const;
```

### Pool Resolution from Token Pair
```typescript
// Source: 42-CONTEXT.md decisions + shared/constants.ts (verified)

type TokenSymbol = "SOL" | "CRIME" | "FRAUD" | "PROFIT";

interface PoolConfig {
  pool: string;
  vaultA: string;
  vaultB: string;
  label: string;
  lpFeeBps: number;
  isTaxed: boolean;
  instruction: "swapSolBuy" | "swapSolSell" | "swapProfitBuy" | "swapProfitSell";
}

/** Valid output tokens for each input token */
export const VALID_PAIRS: Record<TokenSymbol, TokenSymbol[]> = {
  SOL: ["CRIME", "FRAUD"],
  CRIME: ["SOL", "PROFIT"],
  FRAUD: ["SOL", "PROFIT"],
  PROFIT: ["CRIME", "FRAUD"],
};

/** Resolve pool + instruction from input/output token pair */
export function resolvePool(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
): PoolConfig | null {
  // SOL pools (taxed, 1% LP fee)
  if (inputToken === "SOL" && outputToken === "CRIME") {
    return { ...pda("CRIME/SOL"), lpFeeBps: 100, isTaxed: true, instruction: "swapSolBuy" };
  }
  if (inputToken === "SOL" && outputToken === "FRAUD") {
    return { ...pda("FRAUD/SOL"), lpFeeBps: 100, isTaxed: true, instruction: "swapSolBuy" };
  }
  if (inputToken === "CRIME" && outputToken === "SOL") {
    return { ...pda("CRIME/SOL"), lpFeeBps: 100, isTaxed: true, instruction: "swapSolSell" };
  }
  if (inputToken === "FRAUD" && outputToken === "SOL") {
    return { ...pda("FRAUD/SOL"), lpFeeBps: 100, isTaxed: true, instruction: "swapSolSell" };
  }

  // PROFIT pools (untaxed, 0.5% LP fee)
  if (inputToken === "CRIME" && outputToken === "PROFIT") {
    return { ...pda("CRIME/PROFIT"), lpFeeBps: 50, isTaxed: false, instruction: "swapProfitBuy" };
  }
  if (inputToken === "FRAUD" && outputToken === "PROFIT") {
    return { ...pda("FRAUD/PROFIT"), lpFeeBps: 50, isTaxed: false, instruction: "swapProfitBuy" };
  }
  if (inputToken === "PROFIT" && outputToken === "CRIME") {
    return { ...pda("CRIME/PROFIT"), lpFeeBps: 50, isTaxed: false, instruction: "swapProfitSell" };
  }
  if (inputToken === "PROFIT" && outputToken === "FRAUD") {
    return { ...pda("FRAUD/PROFIT"), lpFeeBps: 50, isTaxed: false, instruction: "swapProfitSell" };
  }

  return null; // Invalid pair
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@solana/wallet-adapter` for wallet connection | Privy v3 as sole wallet provider | Phase 40 (Feb 2026) | No wallet-adapter needed; Privy handles both external (Phantom etc) and embedded wallets |
| Anchor Provider.sendAndConfirm() for TX | Sign with Privy + manual sendRawTransaction + confirmTransaction | Phase 42 (this phase) | Enables Sending/Confirming/Confirmed UX states |
| Toast notifications for TX status | Inline form status (button transforms) | Phase 42 (this phase) | CONTEXT.md decision: no toasts, all feedback inline |
| Jupiter API for price quotes | Client-side AMM math from pool reserves | Phase 41-42 | Protocol has its own AMM; no external DEX aggregator needed |

**Deprecated/outdated:**
- `useSendSolanaTransaction` from `@privy-io/react-auth` - migrated to `useSignTransaction` + `useSignAndSendTransaction` from `@privy-io/react-auth/solana` in Privy v2. Our `useProtocolWallet` uses the current `useSignTransaction`.

## Key Architectural Decisions (From CONTEXT.md + Codebase)

### 1. Four Distinct Swap Instructions
The Tax Program exposes 4 separate instructions, NOT a single generic swap:
- `swap_sol_buy(amount_in: u64, minimum_output: u64, is_crime: bool)` - SOL -> CRIME/FRAUD
- `swap_sol_sell(amount_in: u64, minimum_output: u64, is_crime: bool)` - CRIME/FRAUD -> SOL
- `swap_profit_buy(amount_in: u64, minimum_output: u64, is_crime: bool)` - CRIME/FRAUD -> PROFIT
- `swap_profit_sell(amount_in: u64, minimum_output: u64, is_crime: bool)` - PROFIT -> CRIME/FRAUD

Each has a DIFFERENT account struct (SOL swaps have 20 named accounts + tax distribution; PROFIT swaps have 11 named accounts, no tax accounts).

### 2. Account Counts Per Swap Type
| Swap Type | Named Accounts | Remaining Accounts (hooks) | Total | TX Format |
|-----------|---------------|---------------------------|-------|-----------|
| swap_sol_buy | 20 | 4 (one Token-2022 side) | 24 | Legacy |
| swap_sol_sell | 20 | 4 (one Token-2022 side) | 24 | Legacy |
| swap_profit_buy | 11 | 8 (both sides Token-2022, 4 each) | 19 | Legacy |
| swap_profit_sell | 11 | 8 (both sides Token-2022, 4 each) | 19 | Legacy |

All fit in legacy transactions. No Address Lookup Table needed for user swaps.

### 3. Pool Reserve Layout in PoolState
From `usePoolPrices`: reserves are at fields `reserveA` (u64) and `reserveB` (u64) of the PoolState account.
- SOL pools: reserveA = WSOL (lamports), reserveB = CRIME/FRAUD (base units, 6 decimals)
- PROFIT pools: reserveA = CRIME/FRAUD (base units), reserveB = PROFIT (base units)

### 4. Tax Rate Source
Tax rates come from EpochState (already available via `useEpochState` hook):
- `crimeBuyTaxBps`, `crimeSellTaxBps`, `fraudBuyTaxBps`, `fraudSellTaxBps`
- PROFIT pool swaps: tax = 0 (hardcoded, never read from EpochState)

### 5. PDA Addresses Already Pre-Computed
All PDAs needed for swap transactions are already in `shared/constants.ts` (DEVNET_PDAS, DEVNET_POOLS) and `pda-manifest.json`. The transaction builders should use these constants directly, NOT derive PDAs at runtime (except `swap_authority` and `tax_authority` which are derived from Tax Program seeds).

### 6. User Token Account Discovery
For the user's token accounts:
- WSOL: `getAssociatedTokenAddress(NATIVE_MINT, userPublicKey, false, TOKEN_PROGRAM_ID)`
- CRIME: `getAssociatedTokenAddress(MINTS.CRIME, userPublicKey, false, TOKEN_2022_PROGRAM_ID)`
- FRAUD: `getAssociatedTokenAddress(MINTS.FRAUD, userPublicKey, false, TOKEN_2022_PROGRAM_ID)`
- PROFIT: `getAssociatedTokenAddress(MINTS.PROFIT, userPublicKey, false, TOKEN_2022_PROGRAM_ID)`

## Open Questions

1. **Quote accuracy for sell swaps (tax on output)**
   - What we know: For SOL buy, tax is on input (straightforward). For SOL sell, tax is on the SOL OUTPUT -- the on-chain program does the AMM swap first, then calculates tax on the gross SOL received. The client-side quote must replicate this exact order: (1) LP fee on token input, (2) AMM output in SOL, (3) tax on SOL output.
   - What's unclear: The on-chain sell handler reads `wsol_before`, does the CPI, then reads `wsol_after` to compute gross_output. Our client-side quote uses the constant-product formula which should match, but minor rounding differences could occur.
   - Recommendation: Accept up to 1 lamport discrepancy between quoted and actual output. The slippage tolerance handles this.

2. **WSOL account cleanup after sell swaps**
   - What we know: After a sell swap, the user receives WSOL. We should close the WSOL account to return native SOL. But what if the user wants to do another swap immediately?
   - What's unclear: Should we always close the WSOL account, or leave it open? Jupiter leaves it open; most DEX UIs close it.
   - Recommendation: Close WSOL account after each sell swap (append `closeAccount` instruction). If the user swaps again, we create a new one. This is cleaner and prevents "phantom" WSOL balances confusing users.

3. **Token account creation cost**
   - What we know: Creating a Token-2022 ATA costs ~0.002 SOL in rent. First-time users swapping SOL->CRIME need both a WSOL ATA and a CRIME ATA created.
   - What's unclear: Should we show this rent cost to the user explicitly in the fee breakdown?
   - Recommendation: Show it as a one-time "Account setup fee" line item only when new accounts are being created. Do not show it on subsequent swaps.

4. **Priority fee "auto" mode**
   - What we know: CONTEXT.md says "auto/medium default" for priority fees. The Solana RPC has `getRecentPrioritizationFees` which returns recent fee data.
   - What's unclear: Whether to use the RPC endpoint for dynamic fees or just use a static "medium" preset.
   - Recommendation: For Phase 42, use the static `medium` preset (10,000 microLamports). Dynamic priority fees can be added as a future enhancement. The devnet testing environment doesn't have meaningful priority fee competition anyway.

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/errors.rs` - All Tax Program error codes (verified)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/errors.rs` - All AMM error codes (verified)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/math.rs` - On-chain swap math (verified, 34 unit tests + 10k proptests)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/helpers/tax_math.rs` - On-chain tax math (verified)
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/e2e/lib/swap-flow.ts` - Complete SOL buy swap transaction building (verified on devnet)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/idl/tax_program.json` - Full IDL with all 4 swap instruction account lists
- `/Users/mlbob/Projects/Dr Fraudsworth/app/hooks/useProtocolWallet.ts` - Privy wallet abstraction (verified)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/hooks/usePoolPrices.ts` - Real-time pool reserves via WebSocket
- `/Users/mlbob/Projects/Dr Fraudsworth/app/hooks/useEpochState.ts` - Tax rate polling
- `/Users/mlbob/Projects/Dr Fraudsworth/shared/constants.ts` - All PDA addresses and fee constants
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Tax_Pool_Logic_Spec.md` - Canonical spec for swap instructions and tax flow
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/AMM_Implementation.md` - AMM architecture and math

### Secondary (MEDIUM confidence)
- Privy docs (docs.privy.io) - `useSignTransaction`, `useSignAndSendTransaction` hooks for Solana
- Solana docs (solana.com/developers) - ComputeBudgetProgram, priority fees, transaction confirmation
- Exa search results - Solana frontend transaction patterns, WSOL wrapping patterns

### Tertiary (LOW confidence)
- None. All findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and in use
- Architecture: HIGH - Transaction building patterns verified against working E2E scripts and on-chain code
- Pitfalls: HIGH - All pitfalls derived from actual on-chain error codes and documented protocol behavior
- Quote engine: HIGH - Math verified against on-chain Rust code with 34 unit tests and 10k proptest iterations
- Error mapping: HIGH - Error codes from verified IDL JSON and Rust source

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (stable -- all dependencies are pinned and protocol is deployed)
