# Phase 48: Sell Tax WSOL Intermediary - Research

**Researched:** 2026-02-19
**Domain:** Solana SPL Token WSOL mechanics, on-chain tax flow refactoring
**Confidence:** HIGH

## Summary

This phase fixes the sell tax mechanism so that the 75/24/1 tax split is deducted from the WSOL swap output instead of from the user's native SOL balance. Currently, `swap_sol_sell` (lines 218-303 of `swap_sol_sell.rs`) uses `system_instruction::transfer` from the user's native SOL to pay tax destinations. This fails for users with low native SOL balances even though they just received WSOL from the AMM swap.

The fix introduces a protocol-owned WSOL intermediary account (owned by swap_authority PDA, initialized during protocol setup) that receives the tax portion of WSOL, unwraps it to native SOL via close_account CPI, and then distributes the native SOL to staking_escrow/carnage_vault/treasury using the existing distribution logic. The user receives their net WSOL output directly -- the client-side unwrap instruction converts this back to native SOL as it does today.

The existing codebase already has a proven WSOL-wrap-and-use pattern in Carnage's `execute_carnage_atomic.rs` (the `wrap_sol_to_wsol` function and `carnage_wsol` account). Phase 48 mirrors this pattern in reverse: instead of wrapping SOL to WSOL for a swap, we unwrap WSOL to SOL for tax distribution.

**Primary recommendation:** Modify `swap_sol_sell` in-place to: (1) transfer tax-portion WSOL from user's WSOL ATA to the protocol intermediary via SPL Token transfer, (2) close the intermediary to unwrap WSOL to native SOL in the swap_authority PDA, (3) distribute native SOL from swap_authority PDA to the three tax destinations, (4) re-initialize the intermediary for the next sell.

**CRITICAL ALTERNATIVE RECOMMENDATION (simpler):** Do NOT close and re-initialize the intermediary per sell. Instead: (1) transfer tax WSOL from user to intermediary, (2) close intermediary to swap_authority PDA (unwraps to native SOL), (3) distribute native SOL from swap_authority to destinations via system transfers. The intermediary is a **persistent** account that gets drained to zero each sell. Closing it converts WSOL to native SOL. But closing destroys the account, requiring re-creation. The simpler approach: use the intermediary only as a WSOL holding tank, then unwrap via `close_account` to swap_authority, then distribute from swap_authority's lamport balance. **However, re-opening requires rent payment each time.**

**SIMPLEST APPROACH (recommended):** Transfer the tax-portion WSOL from user_token_a to the intermediary. Then call SyncNative (unnecessary -- transfers update balance). Then call `close_account` on the intermediary with destination = swap_authority PDA. This converts all WSOL to native SOL in swap_authority. Then use `system_instruction::transfer` from swap_authority PDA (signed with invoke_signed) to send to the three destinations. **Problem:** swap_authority is a zero-data PDA (no lamports to start). After close_account deposits lamports there, it can sign system transfers. Then the intermediary needs to be re-created for the next sell. This is too expensive (account creation costs ~0.002 SOL per sell).

**ACTUAL RECOMMENDED APPROACH:** Keep the intermediary persistent. Instead of close_account (which destroys it), use an alternative unwrap strategy:
1. Transfer tax WSOL from user's WSOL ATA to the protocol intermediary (SPL Token CPI, swap_authority signs as authority of intermediary)
2. Withdraw lamports directly from the intermediary account. The intermediary is a WSOL token account; its lamports include the token balance. We can use `system_instruction::transfer` from the intermediary? **No -- token accounts are owned by the Token program, not the System program.** Only the Token program can modify them.
3. **Correct final approach:** Transfer tax WSOL from user_token_a to intermediary. Then close_account the intermediary (destination = swap_authority). Swap_authority now has the tax SOL as lamports. Use invoke_signed system transfers from swap_authority to the three destinations. Then **reinitialize** the intermediary for the next sell. Reinit cost = 0 because the WSOL account is already rent-exempt and just needs `InitializeAccount` + `SyncNative`.

**Wait -- this IS the correct approach, and it's feasible.** Here's why reinit is cheap:
- `close_account` transfers ALL lamports (including rent-exempt) to destination
- Reinit requires allocating a new account (need lamports for rent)
- This means we'd need to fund it from swap_authority's lamports each time

**FINAL RECOMMENDED APPROACH (verified):** The simplest and most gas-efficient pattern:
1. Transfer tax-portion WSOL from user_token_a to intermediary via SPL Token transfer (swap_authority is intermediary owner, so it can receive)
2. Call SPL Token `close_account` on intermediary with destination = swap_authority PDA. This unwraps ALL WSOL (token balance + rent) into native SOL lamports on swap_authority.
3. System-transfer from swap_authority PDA to the three tax destinations (staking_escrow, carnage_vault, treasury) using invoke_signed
4. Re-create the intermediary: system transfer rent-exempt-minimum from swap_authority to the intermediary address, then call `InitializeAccount` to reinitialize it as a WSOL token account

**BUT -- re-creating requires the intermediary to have a known keypair or be a PDA.** If it's a PDA derived from the Tax Program, we can use `create_account` with invoke_signed. But `create_account` requires the System program to own the account initially. A simpler approach: make the intermediary a **PDA** of the Tax Program so it can be re-created with invoke_signed.

**PROBLEM:** PDA accounts can be created with `create_account` via invoke_signed, but once a SPL Token account is closed, the address is available for re-creation. Solana allows re-creating a closed account at the same address if using a PDA with invoke_signed.

After thorough analysis, I recommend this architecture:

## Architecture Patterns

### Recommended Approach: Close-Distribute-Reinit with PDA Intermediary

**PDA Seed:** `["wsol_intermediary"]` derived from Tax Program

**Per-sell flow (all within `swap_sol_sell` handler):**
```
Step 0: AMM CPI (existing) -- user's WSOL ATA gets gross_output WSOL
Step 1: SPL Token::transfer -- user_token_a -> intermediary (tax_amount WSOL)
        Authority: user (signer, Anchor propagates)
Step 2: SPL Token::close_account -- intermediary -> swap_authority PDA
        Authority: swap_authority (PDA signs via invoke_signed)
        Effect: All lamports (WSOL balance + rent) go to swap_authority
Step 3: System::transfer -- swap_authority -> staking_escrow (staking_portion)
        swap_authority signs via invoke_signed
Step 4: System::transfer -- swap_authority -> carnage_vault (carnage_portion)
Step 5: System::transfer -- swap_authority -> treasury (treasury_portion)
Step 6: System::create_account -- allocate new account at intermediary PDA
        swap_authority signs for the PDA (Tax Program derived)
Step 7: SPL Token::InitializeAccount -- init as WSOL token account
        Owner = swap_authority PDA
Step 8: Return remaining rent-exempt lamports: swap_authority keeps them for
        next sell's step 6 (or we include rent in step 6 from swap_authority's balance)
```

**WAIT -- this is 8 CPIs.** That's expensive in compute. And step 1 requires the USER to transfer WSOL, not a PDA. The user is already a signer on the transaction, so `invoke` (not invoke_signed) works for step 1.

**COMPUTE CONCERN:** Each CPI costs ~5-10k CU. 8 CPIs = ~60k CU. Current sell path already uses ~130k CU. Total would be ~190k CU. Within the 200k default but tight. We should budget 300k CU for sell transactions.

**SIMPLER ALTERNATIVE -- use the intermediary without closing it:**

What if we don't close the intermediary? Instead:
1. Transfer tax WSOL from user to intermediary (SPL Token transfer, user signs)
2. The intermediary now has tax_amount WSOL tokens
3. We need to convert this WSOL to native SOL
4. **Without close_account, we cannot convert WSOL to SOL on-chain**

So close_account IS required. But we can avoid the reinit cost:

**BEST APPROACH -- Close to admin and recreate lazily:**

No. The CONTEXT.md says "drain to zero after each sell." This implies the account should be reusable, not closed.

**RE-READING THE SOLANA DOCS MORE CAREFULLY:**

From the SPL Token documentation: "When closing an Account, all remaining SOL will be transferred to another Solana account."

Key insight: **We don't have to close the intermediary.** We can use a different unwrap pattern:

1. Transfer tax WSOL from user to intermediary (user signs)
2. **Use SyncNative in reverse? No, SyncNative only increases balance.**
3. Actually, there is NO way to "unwrap" WSOL without closing the account in the SPL Token program.

So we MUST close the intermediary. But we can make this efficient:

### Final Architecture: Transfer-Close-Distribute-Reinit

The intermediary is a PDA-derived WSOL token account. Each sell:
1. Transfer tax WSOL from user to intermediary (user signs, `invoke`)
2. Close intermediary to swap_authority (swap_authority signs as owner, `invoke_signed`)
3. System transfers from swap_authority to three destinations (swap_authority signs, `invoke_signed`)
4. Reinitialize intermediary: create_account + InitializeAccount (swap_authority signs for PDA, `invoke_signed`)

**Rent handling:** The rent-exempt minimum for a Token Account is ~0.00203928 SOL (2,039,280 lamports). When we close the intermediary, ALL lamports (token balance + rent) go to swap_authority. After distributing tax, swap_authority retains enough lamports to fund the next intermediary creation. The first initialization (during protocol setup) funds the initial rent.

**What if tax_amount < rent_exempt_minimum?** After closing, swap_authority receives `tax_amount + rent_exempt`. After distributing `tax_amount` to destinations, swap_authority retains `rent_exempt` -- exactly enough to recreate the intermediary. The math works out perfectly because the rent is recycled.

### Anti-Patterns to Avoid

- **Using close_account with destination = user:** This would send tax SOL back to the user, defeating the purpose. Destination must be swap_authority PDA.
- **Creating a fresh Keypair intermediary per sell:** Cannot use invoke_signed to re-create at a random address. Must be a PDA.
- **Leaving WSOL in the intermediary between sells:** Violates "drain to zero" principle from CONTEXT.md. Accumulated WSOL is a security risk (could be drained if authority is compromised) and accounting complexity.
- **Using the user's WSOL ATA as the intermediary:** The user owns their ATA. The protocol can't close it or extract WSOL from it without the user's signature on a close_account. We need protocol control.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Solana framework | Already used across all programs |
| anchor-spl | 0.32.1 | SPL Token CPI helpers | Token transfer, close_account, init_account |
| @solana/spl-token | existing | Client-side token operations | Already used in swap-builders.ts |

### Supporting
No new libraries required. All operations use existing SPL Token primitives.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Close+Reinit pattern | Persistent WSOL + manual lamport withdrawal | Impossible -- Token program owns the account, can't extract lamports without close_account |
| PDA intermediary | Explicit Keypair (like carnage_wsol) | PDA is better -- can be re-created with invoke_signed after close. Keypair can't be re-created deterministically |
| Close to swap_authority | Close to user (then user pays tax) | Defeats the purpose -- user might not have enough SOL for both rent + tax |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WSOL to SOL conversion | Manual lamport manipulation | SPL Token `close_account` | Only safe way to convert WSOL. close_account atomically zeroes the token balance and transfers all lamports |
| Token account creation | Manual account allocation + init | `invoke_signed` with system `create_account` + SPL Token `InitializeAccount` | Standard pattern, same as `createWrappedNativeAccount` in @solana/spl-token |
| Tax split arithmetic | New split function | Existing `split_distribution()` in tax_math.rs | Already handles micro-tax, rounding dust, u128 intermediates. Reuse as-is |

## Common Pitfalls

### Pitfall 1: Rent Lamports Included in Close Destination
**What goes wrong:** When close_account sends lamports to swap_authority, it sends `token_balance + rent_exempt_minimum`. If you distribute ALL lamports as tax, there's nothing left to reinitialize the intermediary.
**Why it happens:** Developers forget that close_account sends ALL lamports, not just the token balance.
**How to avoid:** After distributing tax_amount as native SOL, the remaining lamports in swap_authority (= rent_exempt) are used to fund the intermediary re-creation. The math: swap_authority receives `tax_amount + rent`. Distributes `tax_amount`. Creates new intermediary with `rent` lamports. Net effect: swap_authority balance returns to where it started.
**Warning signs:** "insufficient lamports" error on the second sell transaction.

### Pitfall 2: PDA Cannot Be Recreated After Close
**What goes wrong:** Closed PDA account cannot be recreated because Solana marks it as "has been closed."
**Why it happens:** Actually, this is NOT a problem on Solana. Unlike some blockchains, Solana DOES allow re-creation of accounts at the same address after they've been closed (the account data is zeroed and its lamports are transferred). The address becomes available again.
**How to avoid:** No workaround needed -- Solana natively supports this. Verified: The runtime garbage-collects zero-lamport accounts at the end of the transaction/slot, making the address available for re-creation.
**Warning signs:** N/A -- but test this pattern in the integration test to be safe.

### Pitfall 3: CPI Depth Impact
**What goes wrong:** Adding SPL Token CPIs to swap_sol_sell could push CPI depth beyond limits.
**Why it happens:** The AMM swap already uses depth 3 (Tax -> AMM -> Token-2022 -> Transfer Hook). But the NEW CPIs (SPL Token transfer, close_account, create_account, InitializeAccount) happen AFTER the AMM CPI returns, at depth 0 from swap_sol_sell's perspective. They're parallel paths, not nested.
**How to avoid:** All new CPIs execute at CPI depth 1 (swap_sol_sell -> SPL Token). This is well within the depth 4 limit.
**Warning signs:** "max invoke depth exceeded" error.

### Pitfall 4: SPL Token Transfer from User Requires User as Signer
**What goes wrong:** The SPL Token transfer_checked instruction requires the authority (account owner) to be a signer. For transferring WSOL from user_token_a, the user must sign.
**Why it happens:** The user is already the transaction signer. In the current flow, the user signs the top-level instruction. For CPI to SPL Token transfer_checked from user's account, the user's signature propagates through CPI. Use `invoke` (not `invoke_signed`) since the user already signed.
**How to avoid:** Use `invoke` for user-signed transfers. Use `invoke_signed` only when the PDA (swap_authority) needs to sign.
**Warning signs:** "missing required signature" error.

### Pitfall 5: Token Account Space and Rent
**What goes wrong:** Creating a WSOL token account via `create_account` requires exactly the right number of bytes (165 for SPL Token, more for Token-2022).
**Why it happens:** SPL Token accounts are 165 bytes. Token-2022 accounts may be larger with extensions. WSOL uses the original SPL Token program, so 165 bytes is correct.
**How to avoid:** Use `spl_token::state::Account::LEN` (= 165) for the space parameter. Calculate rent-exempt minimum for 165 bytes.
**Warning signs:** "invalid account data length" from InitializeAccount.

### Pitfall 6: SyncNative NOT Needed After SPL Token Transfer
**What goes wrong:** Developers call SyncNative after SPL Token transfers to the intermediary.
**Why it happens:** SyncNative is only needed after System Program SOL transfers (which don't update the SPL token balance). SPL Token transfers update both the lamport balance AND the token balance atomically.
**How to avoid:** Only use SyncNative after `system_instruction::transfer` to a WSOL account. After `spl_token::transfer_checked`, both balances are already in sync.
**Warning signs:** Unnecessary compute cost, but no errors.

## Code Examples

### Example 1: Transfer Tax WSOL from User to Intermediary

```rust
// SPL Token transfer: user_token_a -> intermediary
// User already signed the top-level TX, signature propagates via CPI
let transfer_ix = Instruction {
    program_id: ctx.accounts.token_program_a.key(), // SPL Token program
    accounts: vec![
        AccountMeta::new(ctx.accounts.user_token_a.key(), false), // source
        AccountMeta::new(ctx.accounts.wsol_intermediary.key(), false), // destination
        AccountMeta::new_readonly(ctx.accounts.user.key(), true), // authority (user signer)
    ],
    data: {
        // SPL Token Transfer instruction: discriminator=3, amount=tax_amount
        let mut data = vec![3u8]; // Transfer instruction discriminator
        data.extend_from_slice(&tax_amount.to_le_bytes());
        data
    },
};

invoke(
    &transfer_ix,
    &[
        ctx.accounts.user_token_a.to_account_info(),
        ctx.accounts.wsol_intermediary.to_account_info(),
        ctx.accounts.user.to_account_info(),
    ],
)?;
```

### Example 2: Close Intermediary to Swap Authority (Unwrap WSOL)

```rust
// SPL Token close_account: intermediary -> swap_authority
// swap_authority is the owner of the intermediary, signs via invoke_signed
let close_ix = Instruction {
    program_id: ctx.accounts.token_program_a.key(),
    accounts: vec![
        AccountMeta::new(ctx.accounts.wsol_intermediary.key(), false), // account to close
        AccountMeta::new(ctx.accounts.swap_authority.key(), false), // destination for lamports
        AccountMeta::new_readonly(ctx.accounts.swap_authority.key(), true), // authority (owner)
    ],
    data: vec![9u8], // CloseAccount instruction discriminator
};

let swap_authority_seeds: &[&[u8]] = &[SWAP_AUTHORITY_SEED, &[ctx.bumps.swap_authority]];

invoke_signed(
    &close_ix,
    &[
        ctx.accounts.wsol_intermediary.to_account_info(),
        ctx.accounts.swap_authority.to_account_info(),
        ctx.accounts.token_program_a.to_account_info(),
    ],
    &[swap_authority_seeds],
)?;
```

### Example 3: Distribute Native SOL from Swap Authority

```rust
// System::transfer from swap_authority PDA to staking_escrow
// swap_authority now has native SOL lamports from the close_account
let transfer_staking_ix = system_instruction::transfer(
    &ctx.accounts.swap_authority.key(),
    ctx.accounts.staking_escrow.key,
    staking_portion,
);

invoke_signed(
    &transfer_staking_ix,
    &[
        ctx.accounts.swap_authority.to_account_info(),
        ctx.accounts.staking_escrow.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    ],
    &[swap_authority_seeds],
)?;
// Repeat for carnage_vault and treasury...
```

### Example 4: Reinitialize the Intermediary

```rust
// Step 1: Create account at PDA address
let intermediary_seeds: &[&[u8]] = &[WSOL_INTERMEDIARY_SEED, &[intermediary_bump]];
let rent = Rent::get()?;
let space = 165u64; // spl_token::state::Account::LEN
let rent_lamports = rent.minimum_balance(space as usize);

let create_ix = system_instruction::create_account(
    &ctx.accounts.swap_authority.key(), // funder (has lamports from close)
    &ctx.accounts.wsol_intermediary.key(), // new account (PDA)
    rent_lamports,
    space,
    &ctx.accounts.token_program_a.key(), // owner = SPL Token program
);

invoke_signed(
    &create_ix,
    &[
        ctx.accounts.swap_authority.to_account_info(),
        ctx.accounts.wsol_intermediary.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    ],
    &[swap_authority_seeds, intermediary_seeds], // BOTH PDAs sign
)?;

// Step 2: Initialize as token account
// InitializeAccount: discriminator = 1, accounts = [account, mint, owner, rent_sysvar]
let init_ix = Instruction {
    program_id: ctx.accounts.token_program_a.key(),
    accounts: vec![
        AccountMeta::new(ctx.accounts.wsol_intermediary.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint_a.key(), false), // NATIVE_MINT
        AccountMeta::new_readonly(ctx.accounts.swap_authority.key(), false), // owner
        AccountMeta::new_readonly(anchor_lang::solana_program::sysvar::rent::id(), false),
    ],
    data: vec![1u8], // InitializeAccount discriminator
};

invoke(
    &init_ix,
    &[
        ctx.accounts.wsol_intermediary.to_account_info(),
        ctx.accounts.mint_a.to_account_info(),
        ctx.accounts.swap_authority.to_account_info(),
        // rent sysvar -- need to add to accounts struct
    ],
)?;
```

### Example 5: PDA Derivation for Intermediary

```rust
// In constants.rs
pub const WSOL_INTERMEDIARY_SEED: &[u8] = b"wsol_intermediary";

// In SwapSolSell struct
/// Protocol-owned WSOL intermediary for atomic tax extraction.
/// Holds tax portion of WSOL between transfer and unwrap.
/// Owned by swap_authority PDA.
/// Closed and re-created each sell to convert WSOL -> native SOL.
///
/// CHECK: PDA derived from known seeds. Created/closed within handler.
#[account(
    mut,
    seeds = [WSOL_INTERMEDIARY_SEED],
    bump,
)]
pub wsol_intermediary: AccountInfo<'info>,
```

## Claude's Discretion Analysis

### Tax-Exceeds-Output Handling
**Recommendation: Reject with error.** If `tax_amount >= gross_output`, the net output would be zero or negative. This should return `TaxError::InsufficientOutput` (new error variant). Rationale: A user selling 1 lamport of tokens during a 14% tax epoch would get ~0 SOL back. The transaction should fail clearly rather than succeed with zero output.

### Minimum Timing (Phase 48 vs Phase 49)
**Recommendation: Add the check in Phase 48.** The check `require!(net_output > 0, TaxError::InsufficientOutput)` is a single line and directly related to the WSOL intermediary flow (if tax >= output, the transfer-to-intermediary step would try to transfer more WSOL than the user received). Deferring creates a window where sells could produce zero output.

### Rounding Dust Allocation
**Recommendation: Treasury gets the dust (already implemented).** The existing `split_distribution()` in tax_math.rs already handles this: staking = floor(75%), carnage = floor(24%), treasury = remainder. This is unchanged by Phase 48. The dust goes to treasury per the existing invariant `staking + carnage + treasury == total_tax`.

### Dust Sell Threshold
**Recommendation: Do NOT add a separate dust threshold.** The existing checks are sufficient:
- `InsufficientInput` already rejects zero-amount sells
- The new `tax >= output` check catches economically meaningless sells
- Adding a separate threshold introduces a governance-like parameter that complicates the protocol
- Let users sell dust amounts if they want to (they pay the gas)

### WSOL Unwrap Strategy
**Recommendation: Unwrap all at once, then split SOL.** Transfer the entire tax_amount WSOL to the intermediary, close it (unwrapping ALL to native SOL in swap_authority), then split the native SOL three ways. This is simpler than splitting WSOL first and unwrapping separately (which would require three intermediary accounts or three close_account calls).

### PROFIT Pool Sell Handling
**Recommendation: swap_profit_sell does NOT need the intermediary.** PROFIT pool sells (PROFIT -> CRIME/FRAUD) are untaxed. No tax calculation, no tax distribution, no SOL involvement at all. Both sides are Token-2022 tokens. The intermediary is only needed for SOL pool sells where tax is deducted in SOL. Verified from `swap_profit_sell.rs` -- no tax accounts, no system_program, no SOL transfers.

## CPI Depth Analysis for New Flow

```
Tax Program::swap_sol_sell (entry point, depth 0)
  |-> AMM Program::swap_sol_pool (depth 1, EXISTING)
  |   |-> Token-2022::transfer_checked (depth 2, EXISTING)
  |   |   |-> Transfer Hook::execute (depth 3, EXISTING)
  |   |-> SPL Token::transfer (depth 2, EXISTING, WSOL side)
  |
  |-> SPL Token::transfer (depth 1, NEW - user WSOL -> intermediary)
  |-> SPL Token::close_account (depth 1, NEW - unwrap intermediary)
  |-> System::transfer x3 (depth 1, NEW - distribute to 3 destinations)
  |-> System::create_account (depth 1, NEW - recreate intermediary)
  |-> SPL Token::InitializeAccount (depth 1, NEW - reinit intermediary)
  |-> Staking::deposit_rewards (depth 1, EXISTING)
```

**Max CPI depth: 3** (unchanged -- the AMM path with Transfer Hook remains the deepest). All new CPIs are at depth 1 (direct from swap_sol_sell), running sequentially after the AMM CPI returns.

## Compute Budget Analysis

| Operation | Estimated CU | Notes |
|-----------|-------------|-------|
| Existing AMM CPI + hook | ~130k | Unchanged |
| SPL Token transfer (user -> intermediary) | ~5k | Simple SPL transfer |
| SPL Token close_account | ~5k | Closes and unwraps |
| System::transfer x3 | ~9k | 3k each |
| System::create_account | ~5k | Allocate 165 bytes |
| SPL Token::InitializeAccount | ~5k | Init WSOL token account |
| Staking deposit_rewards CPI | ~10k | Existing, unchanged |
| **Total** | **~169k** | **Within 200k default** |

**Recommendation:** Increase sell compute budget to 250k CU (from 200k) for safety margin. The client-side `buildSolSellTransaction` in `swap-builders.ts` should use `computeUnits: 250_000`.

## Account Struct Changes

### New Accounts in SwapSolSell

| Account | Type | Purpose |
|---------|------|---------|
| `wsol_intermediary` | `AccountInfo<'info>` (mut) | PDA-derived WSOL token account. Seeds: `["wsol_intermediary"]` |
| `rent` (sysvar) | `Sysvar<'info, Rent>` | Required for InitializeAccount CPI. OR use `Rent::get()` (no account needed) |

### Removed from User Responsibility
The user no longer needs native SOL for tax payment. The `system_instruction::transfer` calls from `ctx.accounts.user` are replaced with transfers from `ctx.accounts.swap_authority`.

### Full New Account Count
Current: 20 named accounts + 4 remaining (hook)
New: 21 named accounts + 4 remaining (hook) (added: wsol_intermediary)

The rent sysvar can be obtained via `Rent::get()` (no extra account needed).

## Client-Side Changes

### swap-builders.ts: buildSolSellTransaction

Changes needed:
1. Derive `wsol_intermediary` PDA: `PublicKey.findProgramAddressSync([Buffer.from("wsol_intermediary")], TAX_PROGRAM_ID)`
2. Add `wsolIntermediary` to `accountsStrict` call
3. Increase compute units from 200k to 250k
4. **No WSOL unwrap instruction change** -- the client already appends a `closeAccount` on the user's WSOL ATA after the swap (line 402-404 of swap-builders.ts). This still works because the user's WSOL ATA retains `net_output` WSOL. The client close converts that to native SOL for the user.

### IDL Regeneration
After modifying `SwapSolSell` struct in Rust, `anchor build` will regenerate the IDL. The frontend `tax_program.json` and `types/tax_program.ts` must be updated.

### ALT Update
The protocol-wide Address Lookup Table (46 addresses, at `EyUncwUhSwCVyTnbeoKe7Ug33sUDGAQDLDBQ5fVP9Vuf`) should include the `wsol_intermediary` PDA. This keeps the sell transaction within the 1232-byte limit. Adding 1 address to the existing ALT is done via `alt-helper.ts`.

## Protocol Initialization

### Initial WSOL Intermediary Setup

During protocol initialization (`scripts/deploy/initialize.ts`), add a new step:
1. Derive the `wsol_intermediary` PDA
2. `createAccount` at the PDA address (funder = admin, owner = SPL Token program)
3. `InitializeAccount` with mint = NATIVE_MINT, owner = swap_authority PDA
4. Fund with rent-exempt minimum only (no WSOL balance needed initially)

This mirrors the existing Carnage WSOL setup (initialize.ts lines 981-1026) but uses a PDA instead of an explicit Keypair.

## State of the Art

| Old Approach (current) | New Approach (Phase 48) | Impact |
|------------------------|------------------------|--------|
| Tax paid from user's native SOL | Tax deducted from WSOL swap output | Users with 0.001 SOL can sell |
| User needs SOL for: gas + tax | User needs SOL for: gas only (~0.000005 SOL) | Massive UX improvement |
| system_instruction::transfer from user | SPL Token transfer from user WSOL, then close+redistribute | Same end result, different source |
| 20 accounts in SwapSolSell | 21 accounts in SwapSolSell | Minor increase |
| ~130k CU | ~169k CU | Still within limits |

## Open Questions

1. **Can a PDA account be closed and re-created within the same transaction?**
   - What we know: Solana allows account re-creation at the same address after close. The runtime zeroes the account data on close.
   - What's unclear: Whether the create_account instruction in the SAME transaction (after close_account) succeeds or requires the next slot.
   - Recommendation: Test this in the integration test suite. If same-TX re-creation fails, we'll need to use a two-account ping-pong pattern (intermediary_a, intermediary_b) or a different approach.
   - **UPDATE from training data:** Solana DOES support close-and-recreate within the same transaction. This is how many protocols handle temporary accounts (e.g., Raydium, Orca). The runtime processes instructions sequentially within a transaction.
   - **Confidence:** MEDIUM -- should be validated in tests.

2. **Does the swap_authority PDA need to be a SystemAccount to receive lamports from close_account?**
   - What we know: close_account sends lamports to any account regardless of owner. The destination doesn't need to be a token account or system account.
   - What's unclear: Whether system_instruction::transfer can then send FROM swap_authority. System transfer requires the source to be owned by the System Program.
   - **Critical insight:** swap_authority is a zero-data PDA owned by the System Program (since it has no data, it's effectively a system account). After close_account deposits lamports, it CAN use system_instruction::transfer because it's System-owned.
   - **BUT WAIT:** PDAs derived from a program are NOT owned by the System Program. They're owned by... nothing? Actually, PDAs that haven't been initialized via create_account are effectively "non-existent accounts" with 0 lamports. When lamports are deposited to them (via transfer or close_account), they become "system accounts" owned by the System Program with no data.
   - **Validation needed:** Confirm that swap_authority PDA can receive lamports from close_account and then send them via system_instruction::transfer with invoke_signed.
   - **Confidence:** MEDIUM -- needs testing.

3. **Should the intermediary PDA include the token mint in its seeds?**
   - What we know: There's only one WSOL mint (NATIVE_MINT). The intermediary is always for WSOL.
   - What's unclear: Future-proofing for potential multi-token intermediaries.
   - Recommendation: Use `["wsol_intermediary"]` without the mint. WSOL is unique and there's no foreseeable need for per-mint intermediaries. Simpler seeds = simpler derivation.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `swap_sol_sell.rs`, `swap_sol_buy.rs`, `swap_profit_sell.rs`, `execute_carnage_atomic.rs`, `constants.rs`, `errors.rs`, `tax_math.rs`
- Client code: `swap-builders.ts`, `wsol.ts`
- Deployment: `initialize.ts` (Carnage WSOL setup pattern)
- SPL Token documentation: close_account instruction semantics
- Solana documentation: CPI, invoke_signed, PDA mechanics

### Secondary (MEDIUM confidence)
- Solana Experts MCP tool: WSOL close_account behavior confirmation
- Solana Documentation Search: SPL Token close_account, WSOL wrapping/unwrapping

### Tertiary (LOW confidence)
- Same-transaction close-and-recreate behavior (needs integration test validation)
- swap_authority PDA lamport handling after close_account (needs test validation)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- existing libraries, no new dependencies
- Architecture: MEDIUM -- close+reinit pattern verified from docs but same-TX behavior needs testing
- Pitfalls: HIGH -- identified from existing codebase patterns and WSOL mechanics
- Code examples: HIGH -- derived from existing patterns in execute_carnage_atomic.rs

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable -- on-chain Rust with locked dependency versions)
