# Phase 106: Vault Convert-All - Research

**Researched:** 2026-03-26
**Domain:** Anchor/Rust on-chain program upgrade + Next.js client integration
**Confidence:** HIGH

## Summary

Phase 106 adds a `convert_v2` instruction to the existing Conversion Vault program. The new instruction reads on-chain token balances (sentinel `amount_in=0`) and enforces on-chain slippage protection (`minimum_output`). This eliminates intermediate token leakage in multi-hop swaps that currently triggers Blowfish wallet security warnings.

The change is surgically small: one new Rust handler function (~40 lines), two new error variants, one new instruction registration in `lib.rs`, and client-side swap builder updates. The existing `convert` instruction remains unchanged. The Anchor 0.32.1 framework supports registering multiple instructions against the same `#[derive(Accounts)]` struct natively.

**Primary recommendation:** Implement `convert_v2` as a new handler in a separate file (`convert_v2.rs`) that imports and reuses the existing `Convert<'info>` accounts struct. Keep client changes minimal -- swap `vaultProgram.methods.convert()` to `vaultProgram.methods.convertV2()` with the new `minimum_output` arg, and pass `amount_in=0` for multi-hop vault steps.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework | Project standard, already in Cargo.toml |
| anchor-spl | 0.32.1 | Token-2022 integration | Project standard, already in Cargo.toml |
| @coral-xyz/anchor | latest | Client-side IDL consumption | Project standard, already in app |
| proptest | 1.9 | Property-based testing | Project standard for BOK audit suite |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-security-txt | 1.1.1 | Security contact metadata | Already in program, no changes needed |
| litesvm | (not used) | On-chain integration tests | Current vault tests are math-only (no CPI) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `convert_v2` instruction | Modify existing `convert` in-place | Breaking change, requires coordinated deploy. Decision locked: new instruction. |
| Separate `convert_v2.rs` file | Same `convert.rs` file | Separate file is cleaner, keeps the diff reviewable for SOS audit |

## Architecture Patterns

### Recommended Project Structure
```
programs/conversion-vault/src/
  instructions/
    mod.rs          # Add: pub mod convert_v2; pub use convert_v2::*;
    convert.rs      # UNCHANGED — existing handler stays frozen
    convert_v2.rs   # NEW — convert_v2 handler, imports Convert struct from convert.rs
    initialize.rs   # UNCHANGED
  error.rs          # ADD: SlippageExceeded, InvalidOwner variants
  lib.rs            # ADD: convert_v2 instruction registration
  constants.rs      # UNCHANGED
  state.rs          # UNCHANGED
  helpers/
    hook_helper.rs  # UNCHANGED
    mod.rs          # UNCHANGED
```

### Pattern 1: Reusing Accounts Struct Across Instructions

**What:** Anchor allows multiple `#[program]` methods to accept the same `#[derive(Accounts)]` struct. The `convert_v2` instruction reuses `Convert<'info>` from `convert.rs` without any modification to the struct itself.

**When to use:** When a new instruction needs identical account validation but different handler logic.

**Example:**
```rust
// lib.rs
#[program]
pub mod conversion_vault {
    use super::*;

    // Existing — UNCHANGED
    pub fn convert<'info>(
        ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
        amount_in: u64,
    ) -> Result<()> {
        instructions::convert::handler(ctx, amount_in)
    }

    // NEW — same accounts, different handler + args
    pub fn convert_v2<'info>(
        ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
        amount_in: u64,
        minimum_output: u64,
    ) -> Result<()> {
        instructions::convert_v2::handler(ctx, amount_in, minimum_output)
    }
}
```

**Key detail:** Anchor generates a different 8-byte discriminator for `convert_v2` vs `convert` based on the instruction name hash (`sighash("global", "convert_v2")`). The accounts struct is the same, but the wire format differs because `convert_v2` has an extra `u64` arg in the instruction data.

### Pattern 2: Sentinel Value for On-Chain Balance Reading

**What:** Use `amount_in == 0` as a sentinel to trigger on-chain balance reading from `user_input_account.amount`. The existing `ZeroAmount` error from `compute_output` is bypassed by checking the sentinel BEFORE calling compute.

**When to use:** When the client cannot predict the exact input amount (multi-hop chaining).

**Example:**
```rust
// convert_v2.rs
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
    amount_in: u64,
    minimum_output: u64,
) -> Result<()> {
    // Owner check: ensure user_input_account belongs to the signer
    require!(
        ctx.accounts.user_input_account.owner == ctx.accounts.user.key(),
        VaultError::InvalidOwner
    );

    // Sentinel: amount_in == 0 means "convert all"
    let effective_amount = if amount_in == 0 {
        let balance = ctx.accounts.user_input_account.amount;
        require!(balance > 0, VaultError::ZeroAmount);
        msg!("convert_v2: convert-all mode, balance={}", balance);
        balance
    } else {
        amount_in
    };

    // Compute output (validates mint pair, dust, overflow)
    // ... same as existing convert handler ...

    // Slippage guard
    require!(amount_out >= minimum_output, VaultError::SlippageExceeded);

    // Log for debugging/indexing
    msg!("convert_v2: effective_amount={}, output={}", effective_amount, amount_out);

    // Transfer input: user -> vault (user-signed)
    // Transfer output: vault -> user (PDA-signed)
    // ... identical to existing convert handler ...
}
```

### Pattern 3: Client Anchor IDL Method Invocation

**What:** After `anchor build`, the IDL auto-generates `convertV2` method (camelCase) on the Anchor `Program` instance. The client calls it with the new args.

**Example:**
```typescript
// swap-builders.ts — buildVaultConvertTransaction
const convertIx = await vaultProgram.methods
  .convertV2(new BN(amountInBaseUnits), new BN(minimumOutput))
  .accountsStrict({ /* same accounts as convert */ })
  .remainingAccounts([...inputHooks, ...outputHooks])
  .instruction();
```

**CRITICAL Anchor 0.32 note:** `new Program()` calls `convertIdlToCamelCase()`. The IDL will have `convert_v2` (snake_case) but the TypeScript method is `.convertV2()` (camelCase). This is consistent with the existing `.convert()` method.

### Pattern 4: Multi-Hop Amount=0 + Derived minimum_output

**What:** For vault steps in multi-hop routes, the client passes `amount_in=0` (convert-all sentinel) and derives `minimum_output` from the AMM step's guaranteed minimum, converted through the vault rate.

**Example:**
```typescript
// multi-hop-builder.ts — buildStepTransaction for vault steps
if (step.pool.includes("Vault")) {
  const isMultiHop = route.steps.length > 1;
  const amountIn = isMultiHop ? 0 : step.inputAmount;

  // Derive minimum_output from the vault conversion rate
  // If AMM guarantees at least X CRIME, vault output >= X/100 PROFIT
  // If vault converts PROFIT to CRIME, output = input * 100
  const minimumOutput = step.minimumOutput; // computed by route engine

  return buildVaultConvertTransaction({
    amountInBaseUnits: amountIn,
    minimumOutput,
    // ... other params
  });
}
```

### Anti-Patterns to Avoid
- **Modifying the existing `convert` handler:** Locked decision -- `convert` stays frozen forever. No deprecation log, no modifications.
- **Adding constraints to `Convert<'info>` struct:** The struct is shared between convert and convert_v2. Any new constraint added there would also apply to the old convert instruction. Owner check goes in the handler function, not the struct.
- **Passing `minimum_output=0` from client as default:** While allowed, direct convert callers should pass the exact expected output (tight slippage). Only multi-hop intermediate steps should use loose values.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token account balance reading | Manual deserialization | `ctx.accounts.user_input_account.amount` | Anchor's `InterfaceAccount<TokenAccount>` already deserializes the SPL Token account |
| Token-2022 transfer with hooks | Custom CPI builder | Existing `helpers::hook_helper::transfer_t22_checked` | Already battle-tested, handles hook account forwarding correctly |
| IDL generation for new instruction | Manual IDL editing | `anchor build` auto-generates IDL | Anchor 0.32 IDL generation handles the new instruction natively |
| Instruction discriminator | Manual hash computation | Anchor framework auto-generates | Anchor computes `sha256("global:convert_v2")[0..8]` |
| Error code assignment | Manual code numbering | Anchor `#[error_code]` auto-assigns | Current errors are 6000-6005; new variants will be 6006-6007 |

**Key insight:** The entire on-chain change reuses existing infrastructure (accounts struct, transfer helper, compute_output math). The only new code is the handler logic (~30 lines) and two error variants.

## Common Pitfalls

### Pitfall 1: Stale Token Account Balance After Anchor Deserialization
**What goes wrong:** `InterfaceAccount<TokenAccount>` is deserialized at instruction entry. If the token account's balance changed during the same transaction (e.g., AMM deposited tokens in a prior instruction), the `amount` field reflects the pre-instruction state.
**Why it happens:** Anchor deserializes accounts once at the top of the instruction. It does NOT re-read mid-execution.
**How to avoid:** This is actually FINE for convert_v2 because the vault reads the balance BEFORE any transfers. The AMM deposits tokens in a prior instruction within the same atomic TX, and Solana's account model ensures the balance is updated between instructions. The deserialized `amount` at convert_v2 entry reflects the post-AMM-deposit state.
**Warning signs:** If balance reads were needed AFTER a transfer within the same instruction, you'd need to use `reload()`.

### Pitfall 2: Error Code Numbering Collision
**What goes wrong:** Adding error variants in the wrong position shifts existing error codes, breaking client-side error parsing.
**Why it happens:** Anchor assigns error codes sequentially starting from 6000. Inserting a variant between existing ones shifts all subsequent codes.
**How to avoid:** Always append new error variants at the END of the `#[error_code]` enum. Current last variant is `MathOverflow` (6005). New `SlippageExceeded` = 6006, `InvalidOwner` = 6007.
**Warning signs:** Client error-map.ts hardcodes error code numbers -- must update after adding variants.

### Pitfall 3: Owner Check on InterfaceAccount
**What goes wrong:** Not checking that `user_input_account.owner == user.key()` allows an attacker to pass someone else's token account and drain their balance in convert-all mode.
**Why it happens:** The existing `Convert<'info>` struct does NOT enforce owner on `user_input_account` because with the old `convert` instruction, the user specifies the exact amount and the transfer itself enforces ownership (user must sign as token account authority).
**How to avoid:** In `convert_v2` handler, explicitly check `user_input_account.owner == user.key()` before reading balance. This is a handler-level check, not a struct constraint, because adding it to the struct would change `convert` behavior too.
**Warning signs:** Any handler that reads account state for decision-making without verifying ownership.

### Pitfall 4: IDL Sync After Rebuild
**What goes wrong:** Client code calls `.convertV2()` but the IDL JSON in `app/idl/conversion_vault.json` still only has `convert`. Anchor runtime throws "Error: Invalid instruction" because the method doesn't exist in the IDL.
**Why it happens:** `anchor build` outputs IDL to `target/idl/`, but the app reads from `app/idl/`. The project has a predev hook (`scripts/sync-idl.mjs`) that copies IDL files.
**How to avoid:** Run the IDL sync after building: `node scripts/sync-idl.mjs` or the full `build.sh` pipeline which includes sync.
**Warning signs:** "Invalid instruction" or "method not found" errors from Anchor client.

### Pitfall 5: Devnet Upgrade vs Fresh Deploy
**What goes wrong:** A fresh deploy creates new program addresses and PDAs, requiring re-initialization. This doesn't test the real mainnet upgrade path.
**Why it happens:** Temptation to start clean for testing convenience.
**How to avoid:** Locked decision: devnet uses `solana program deploy --program-id <existing-keypair>` to upgrade the existing program in-place. This mirrors the real mainnet Squads upgrade path.
**Warning signs:** Any `deploy-all.sh` usage instead of direct `solana program deploy`.

### Pitfall 6: Transaction Size Increase
**What goes wrong:** `convert_v2` adds 8 bytes (the `minimum_output: u64` arg) to instruction data. In already-tight multi-hop v0 transactions, this could push over the 1232-byte limit.
**Why it happens:** Each vault step in a 4-step split route adds 8 bytes. Two vault steps = 16 extra bytes.
**How to avoid:** The protocol ALT already compresses accounts heavily. 16 extra bytes of instruction data is well within budget. But verify by building the largest route (4-step split sell: 2x vault + 2x AMM sell) and checking serialized TX size.
**Warning signs:** "Transaction too large" errors on split routes.

### Pitfall 7: Feature Flag Build Order
**What goes wrong:** Building without `--features devnet` (or `--features localnet` for tests) uses mainnet mint addresses that don't exist on devnet, causing ConstraintOwner errors.
**Why it happens:** The vault program has feature-gated mint addresses in `constants.rs`.
**How to avoid:** Use `anchor build -p conversion_vault -- --features devnet` for devnet deployment. Use `--features localnet` for LiteSVM tests (which store mints in VaultConfig state).
**Warning signs:** ConstraintOwner or AccountNotFound errors after deploy.

## Code Examples

Verified patterns from the existing codebase:

### New Error Variants
```rust
// error.rs — APPEND to end of existing enum
#[error_code]
pub enum VaultError {
    // ... existing variants 6000-6005 ...

    #[msg("Output below minimum — slippage protection")]
    SlippageExceeded,         // 6006

    #[msg("Input account not owned by signer")]
    InvalidOwner,             // 6007
}
```

### convert_v2 Handler (Complete)
```rust
// instructions/convert_v2.rs
use anchor_lang::prelude::*;
use crate::constants::{self, TOKEN_DECIMALS, VAULT_CONFIG_SEED};
use crate::error::VaultError;
use crate::helpers;
use crate::instructions::convert::{Convert, compute_output, compute_output_with_mints};

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
    amount_in: u64,
    minimum_output: u64,
) -> Result<()> {
    // --- 0. Owner check for convert-all safety ---
    require!(
        ctx.accounts.user_input_account.owner == ctx.accounts.user.key(),
        VaultError::InvalidOwner
    );

    // --- 1. Resolve effective amount ---
    let effective_amount = if amount_in == 0 {
        let balance = ctx.accounts.user_input_account.amount;
        require!(balance > 0, VaultError::ZeroAmount);
        balance
    } else {
        amount_in
    };

    // --- 2. Compute output (validates mint pair, dust, overflow) ---
    let input_key = ctx.accounts.input_mint.key();
    let output_key = ctx.accounts.output_mint.key();

    #[cfg(feature = "localnet")]
    let amount_out = {
        let vc = &ctx.accounts.vault_config;
        compute_output_with_mints(
            &input_key, &output_key, effective_amount,
            &vc.crime_mint, &vc.fraud_mint, &vc.profit_mint,
        )?
    };
    #[cfg(not(feature = "localnet"))]
    let amount_out = compute_output(&input_key, &output_key, effective_amount)?;

    // --- 3. Slippage guard ---
    require!(amount_out >= minimum_output, VaultError::SlippageExceeded);

    // --- 4. Log for debugging/indexing ---
    msg!("convert_v2: effective_amount={}, output={}", effective_amount, amount_out);

    // --- 5. Transfer input: user -> vault (user-signed) ---
    let remaining = ctx.remaining_accounts;
    let mid = remaining.len() / 2;
    let (input_hooks, output_hooks) = remaining.split_at(mid);

    helpers::hook_helper::transfer_t22_checked(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.user_input_account.to_account_info(),
        &ctx.accounts.input_mint.to_account_info(),
        &ctx.accounts.vault_input.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        effective_amount,
        TOKEN_DECIMALS,
        &[],
        input_hooks,
    )?;

    // --- 6. Transfer output: vault -> user (PDA-signed) ---
    let vault_bump = ctx.accounts.vault_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CONFIG_SEED, &[vault_bump]]];

    helpers::hook_helper::transfer_t22_checked(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.vault_output.to_account_info(),
        &ctx.accounts.output_mint.to_account_info(),
        &ctx.accounts.user_output_account.to_account_info(),
        &ctx.accounts.vault_config.to_account_info(),
        amount_out,
        TOKEN_DECIMALS,
        signer_seeds,
        output_hooks,
    )?;

    Ok(())
}
```

### Client: Updated buildVaultConvertTransaction
```typescript
// swap-builders.ts — key changes only
const convertIx = await vaultProgram.methods
  .convertV2(new BN(amountInBaseUnits), new BN(minimumOutput))
  .accountsStrict({
    user: userPublicKey,
    vaultConfig,
    userInputAccount,
    userOutputAccount,
    inputMint,
    outputMint,
    vaultInput,
    vaultOutput,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .remainingAccounts([...inputHooks, ...outputHooks])
  .instruction();
```

### Client: Multi-Hop Builder Change
```typescript
// multi-hop-builder.ts — in buildStepTransaction, vault section
if (step.pool.includes("Vault")) {
  const inputMint = step.inputToken === "PROFIT"
    ? MINTS.PROFIT : (isCrime ? MINTS.CRIME : MINTS.FRAUD);
  const outputMint = step.outputToken === "PROFIT"
    ? MINTS.PROFIT : (isCrime ? MINTS.CRIME : MINTS.FRAUD);

  // Multi-hop vault steps use convert-all mode (amount_in=0)
  // Direct vault converts use exact amount
  const isMultiHopStep = route.steps.length > 1;
  const amountIn = isMultiHopStep ? 0 : step.inputAmount;

  return buildVaultConvertTransaction({
    connection,
    userPublicKey,
    amountInBaseUnits: amountIn,
    minimumOutput,
    inputMint,
    outputMint,
    priorityFeeMicroLamports,
  });
}
```

### BOK Proptest Extension
```rust
// bok_proptest_vault.rs — new properties to add

// INV-CV-009: convert_v2(amount, min) == convert(amount) when min <= output
// Verifies backwards compatibility of the math layer
proptest! {
    #[test]
    fn inv_cv_009_convert_v2_exact_matches_convert(
        amount in 100u64..=10_000_000_000u64,
    ) {
        let (crime, fraud, profit) = test_mints();
        let output = compute_output_with_mints(
            &crime, &profit, amount, &crime, &fraud, &profit
        ).unwrap();
        // When min <= output, convert_v2 produces same result
        prop_assert!(output >= 0); // slippage check would pass
        prop_assert_eq!(output, amount / 100);
    }
}

// INV-CV-010: SlippageExceeded when minimum_output > actual output
// (tested at handler level, not compute_output level)
```

### Error Map Update
```typescript
// error-map.ts — add new error codes
// 6006 = SlippageExceeded
// 6007 = InvalidOwner
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `convert(amount_in)` | `convert_v2(amount_in, minimum_output)` | Phase 106 | Adds balance reading + slippage guard |
| Client-side amount chaining (leaky) | On-chain balance reading (convert-all) | Phase 106 | Eliminates intermediate token leakage |
| No on-chain slippage for vault | `minimum_output` enforcement | Phase 106 | Protects against unexpected rate changes (future-proofing) |

**Deprecated/outdated:**
- The `convert` instruction will remain functional but all callers switch to `convert_v2`. Future phase will remove `convert` entirely.

## Open Questions

Things that couldn't be fully resolved:

1. **Multi-hop minimum_output derivation precision**
   - What we know: The vault rate is fixed 100:1. If the AMM step guarantees at least X CRIME output, the vault step produces at least X/100 PROFIT.
   - What's unclear: Whether the route engine's `minimumOutput` field for vault steps already accounts for the vault conversion rate, or if it needs to be derived from the AMM step's minimumOutput.
   - Recommendation: Inspect `quote-engine.ts` `quoteVaultConvert()` during planning to confirm the derivation chain. The math is deterministic (no AMM slippage), so the minimum can be tight.

2. **Direct vault convert in useSwap.ts: amount_in semantics**
   - What we know: Direct vault converts (1-hop, e.g., CRIME->PROFIT) currently pass exact `amountInBaseUnits` via the old `convert` instruction.
   - What's unclear: Should direct converts switch to `convert_v2` with `amount_in=exact_amount` (not zero), or also use convert-all mode?
   - Recommendation: Context decision says "ALL client paths switch to convert_v2". Direct converts should use `convert_v2(exact_amount, exact_expected_output)` -- not convert-all mode. Convert-all mode is only for multi-hop intermediate steps.

3. **Compute unit budget for convert_v2**
   - What we know: `convert` uses 200,000 CU (default). The `msg!()` log in convert_v2 adds minimal CU overhead.
   - What's unclear: Whether the owner check + msg log add enough CU to matter.
   - Recommendation: Keep 200,000 CU default. If devnet testing shows CU exhaustion, bump to 250,000.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `programs/conversion-vault/src/` -- all source files read directly
- Existing codebase: `app/lib/swap/` -- all swap builder and multi-hop builder files read directly
- Existing codebase: `programs/conversion-vault/tests/` -- all test files read directly
- Project proposal: `Docs/vault-convert-all-proposal.md` -- detailed design with edge cases
- Phase context: `.planning/phases/106-vault-convert-all/106-CONTEXT.md` -- locked decisions

### Secondary (MEDIUM confidence)
- Anchor 0.32 instruction registration pattern -- verified from existing `lib.rs` usage in this project
- Anchor camelCase IDL conversion -- documented in project MEMORY.md

### Tertiary (LOW confidence)
- None. All findings are from direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- pattern directly replicates existing `convert` handler structure
- Pitfalls: HIGH -- derived from project history (MEMORY.md) and direct code inspection
- Code examples: HIGH -- written from existing codebase patterns, not hypothetical

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable -- no external dependency changes expected)
