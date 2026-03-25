# Phase 72: Sell-Back + Tax Escrow - Research

**Researched:** 2026-03-04
**Domain:** Solana on-chain instruction (Anchor/Rust), bonding curve reverse integral, SOL PDA transfers, Token-2022 Transfer Hook
**Confidence:** HIGH

## Summary

Phase 72 adds the `sell` instruction to the existing bonding curve program. The research focused on seven key areas: (1) the exact spec mechanics for sell (Section 4.5, 8.6), (2) how the existing purchase instruction patterns map to sell, (3) SOL transfer from program-owned PDAs (lamport manipulation vs system_program CPI), (4) Token-2022 Transfer Hook handling for the sell direction (user -> vault), (5) tax escrow routing, (6) solvency invariant computation, and (7) property testing infrastructure.

The codebase is exceptionally well-prepared for this phase. All state fields, error codes, events, constants, PDA seeds, and even math functions are already implemented. The sell instruction is largely a mirror of the purchase instruction with reversed transfer directions and added tax logic.

**Primary recommendation:** Implement sell as a close structural mirror of `purchase.rs`, reusing `calculate_sol_for_tokens(x2, tokens_to_sell)` for the reverse integral, using direct lamport manipulation for SOL transfers (sol_vault -> user and sol_vault -> tax_escrow), and using Anchor's `token_2022::transfer_checked` with `.with_remaining_accounts()` for the user-signed token transfer (following the `fund_curve.rs` pattern). Add a runtime solvency assertion as defense-in-depth. Property tests should extend the existing proptest infrastructure in `math.rs` with sell-specific invariants at 1M+ iterations.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Solana program framework | Already in use, program depends on it |
| anchor-spl | 0.32.1 | Token-2022 CPI helpers | Already in use with `token_2022` feature |
| spl-token-2022 | (via anchor-spl) | Token-2022 instruction building | Used by purchase.rs for manual invoke_signed |
| proptest | 1.9 | Property-based testing | Already in dev-dependencies, used by Phase 71 math tests |
| litesvm | 0.9.1 | On-chain integration testing | Already in dev-dependencies for full instruction tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-sdk | 2.2 | Test keypairs, transactions | Already in dev-dependencies for integration tests |
| sha2 | 0.10 | Discriminator computation for LiteSVM tests | Already in dev-dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct lamport manipulation | system_program::transfer CPI with invoke_signed | System program CPI DOES NOT WORK for program-owned PDAs -- the sol_vault is owned by the bonding curve program, not the System Program. Direct lamport manipulation is the ONLY correct approach. |
| Anchor token_2022::transfer_checked for user-signed transfer | Manual invoke for sell token transfer | The fund_curve.rs pattern (Anchor CPI + .with_remaining_accounts()) works for user-signed transfers. However, for PDA-signed transfers (purchase direction), manual invoke_signed is required. For sell (user signs), either approach works, but CONTEXT.md says to follow the same manual invoke_signed pattern as purchase for consistency and safety. |

**No new dependencies needed.** Everything is already in Cargo.toml.

## Architecture Patterns

### Recommended File Structure
```
programs/bonding_curve/src/
├── constants.rs             # SELL_TAX_BPS, BPS_DENOMINATOR already exist
├── error.rs                 # CurveNotActiveForSell, InsufficientTokenBalance, ZeroAmount already exist
├── events.rs                # TokensSold, TaxCollected already exist
├── math.rs                  # calculate_sol_for_tokens already serves as reverse integral
├── state.rs                 # tokens_returned, sol_returned, tax_collected, tax_escrow already exist
├── lib.rs                   # Add sell dispatch
└── instructions/
    ├── mod.rs               # Add pub mod sell; pub use sell::*;
    ├── initialize_curve.rs  # Unchanged
    ├── fund_curve.rs        # Unchanged
    ├── start_curve.rs       # Unchanged
    ├── purchase.rs          # Unchanged
    └── sell.rs              # NEW -- Phase 72's primary deliverable
```

### Pattern 1: Sell Instruction Account Struct
**What:** The `Sell` accounts struct mirrors `Purchase` with additions (tax_escrow) and different constraints.
**When to use:** This is the only pattern for the sell instruction.
**Key differences from Purchase:**
```
Purchase: user (Signer), curve_state (Active), user_token_account (init_if_needed),
          token_vault, sol_vault, token_mint, token_program, associated_token_program, system_program

Sell:     user (Signer, Mut), curve_state (Active, Mut), user_token_account (Mut, NOT init_if_needed),
          token_vault (Mut), sol_vault (Mut), tax_escrow (Mut),
          token_mint, token_program, system_program
          (NO associated_token_program -- ATA must already exist for sellers)
```
**Source:** Bonding_Curve_Spec.md Section 8.6 account table.

### Pattern 2: Reverse Integral Computation
**What:** Computing gross SOL for a sell using the existing `calculate_sol_for_tokens`.
**When to use:** Step 3 of the sell handler.
**Example:**
```rust
// Source: math.rs lines 125-127 (docstring) + Bonding_Curve_Spec.md Section 4.5
// For sell of N tokens when tokens_sold = x1:
let x2 = x1.checked_sub(tokens_to_sell).ok_or(CurveError::Overflow)?;
let sol_gross = calculate_sol_for_tokens(x2, tokens_to_sell)?;
// This computes: integral from x2 to x1 of P(x)dx = area under curve for those tokens
```

### Pattern 3: Tax Computation (Protocol-Favored Ceil Rounding)
**What:** The 15% tax rounds UP (ceil) per CONTEXT.md decision.
**When to use:** Step 4 of the sell handler.
**Example:**
```rust
// Source: 72-CONTEXT.md decisions
// Tax rounds up: tax = (SOL_gross * SELL_TAX_BPS + (BPS_DENOMINATOR - 1)) / BPS_DENOMINATOR
let tax = sol_gross
    .checked_mul(SELL_TAX_BPS)
    .ok_or(CurveError::Overflow)?
    .checked_add(BPS_DENOMINATOR - 1)  // ceil rounding
    .ok_or(CurveError::Overflow)?
    / BPS_DENOMINATOR;
let sol_net = sol_gross.checked_sub(tax).ok_or(CurveError::Overflow)?;
```

**IMPORTANT DISCREPANCY:** The spec Section 8.6 pseudocode uses `sol_gross * 15 / 100` (floor/truncation), which it says "rounds down -- user-favorable." The CONTEXT.md decision says ceil rounding (protocol-favored). **The CONTEXT.md decision overrides the spec pseudocode** since it was a deliberate discussion decision. Use ceil with BPS: `(sol_gross * 1500 + 9999) / 10000`.

### Pattern 4: SOL Transfer from Program-Owned PDA (Direct Lamport Manipulation)
**What:** Transferring SOL from the sol_vault PDA to the user and from sol_vault to tax_escrow.
**When to use:** Steps 8 and 9 of the sell handler.
**Why NOT system_program CPI:** The sol_vault PDA is owned by the bonding curve program (created with `init, space = 0` in initialize_curve.rs). The System Program can only transfer SOL from accounts it owns. Since the bonding curve program owns these PDAs, you MUST use direct lamport manipulation.
**Example:**
```rust
// Source: Bonding_Curve_Spec.md Section 8.6 Steps 8-9, verified via Solana expert research
// Step 8: SOL_net from sol_vault to user
**ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= sol_net;
**ctx.accounts.user.try_borrow_mut_lamports()? += sol_net;

// Step 9: Tax from sol_vault to tax_escrow
**ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= tax;
**ctx.accounts.tax_escrow.try_borrow_mut_lamports()? += tax;
```

**CRITICAL:** The Solana runtime enforces that the sum of all lamports across all accounts is preserved within a transaction. If you subtract from sol_vault more than it holds, the transaction will fail at the runtime level. The `try_borrow_mut_lamports` pattern is safe for program-owned accounts.

### Pattern 5: Token Transfer for Sell (User -> Vault)
**What:** Transferring tokens from user's ATA back to the curve's token vault.
**When to use:** Step 7 of the sell handler.
**Two viable approaches:**

**Approach A: Anchor CPI (fund_curve.rs pattern)**
```rust
// User is the signer (not PDA), so Anchor CPI with .with_remaining_accounts() works
let cpi_accounts = token_2022::TransferChecked {
    from: ctx.accounts.user_token_account.to_account_info(),
    to: ctx.accounts.token_vault.to_account_info(),
    mint: ctx.accounts.token_mint.to_account_info(),
    authority: ctx.accounts.user.to_account_info(),
};
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),
    cpi_accounts,
).with_remaining_accounts(ctx.remaining_accounts.to_vec());
token_2022::transfer_checked(cpi_ctx, tokens_to_sell, TOKEN_DECIMALS)?;
```

**Approach B: Manual invoke (purchase.rs pattern)**
```rust
// Same pattern as purchase but with user as authority instead of PDA
// Use invoke() (not invoke_signed) since user is a real signer
let mut ix = spl_token_2022::instruction::transfer_checked(
    ctx.accounts.token_program.key,
    &ctx.accounts.user_token_account.key(),
    &ctx.accounts.token_mint.key(),
    &ctx.accounts.token_vault.key(),
    &ctx.accounts.user.key(),
    &[],
    tokens_to_sell,
    TOKEN_DECIMALS,
)?;
// Append Transfer Hook accounts from remaining_accounts
for account_info in ctx.remaining_accounts {
    ix.accounts.push(AccountMeta {
        pubkey: *account_info.key,
        is_signer: account_info.is_signer,
        is_writable: account_info.is_writable,
    });
}
let mut account_infos = vec![
    ctx.accounts.user_token_account.to_account_info(),
    ctx.accounts.token_mint.to_account_info(),
    ctx.accounts.token_vault.to_account_info(),
    ctx.accounts.user.to_account_info(),
];
for account_info in ctx.remaining_accounts {
    account_infos.push(account_info.clone());
}
anchor_lang::solana_program::program::invoke(&ix, &account_infos)?;
```

**Recommendation:** CONTEXT.md says "Transfer Hook handling for sell must follow same manual invoke_signed pattern as purchase instruction." Use **Approach B** (manual invoke) for consistency, but use `invoke` (not `invoke_signed`) since the user is a real signer. This ensures identical Transfer Hook account resolution behavior as purchase, reducing the risk of subtle differences.

### Pattern 6: Solvency Invariant Check
**What:** Runtime assertion that vault balance >= expected from integral.
**When to use:** After state updates, before returning Ok(()).
**Example:**
```rust
// Source: Bonding_Curve_Spec.md Invariant 9, CONTEXT.md decisions
// Expected vault balance = integral(0, new_tokens_sold) - cumulative_sol_returned_net
// where sol_returned_net = total SOL actually removed from vault across all sells
// Since we track sol_returned as gross and tax goes to escrow:
//   vault should hold >= integral(0, tokens_sold) - (sol_returned_gross - tax_collected)
// Simplified: vault >= integral(0, tokens_sold) - sol_returned + tax_collected
// Wait -- tax is moved FROM vault TO escrow. So vault balance should be:
//   vault = sol_raised - sol_returned_gross  (because sol_returned_gross = sol_net + tax,
//           but tax comes from vault too)
//   Actually: sol_raised - (sol_net_to_users + tax_to_escrow) = sol_raised - sol_returned_gross
// No, let's think step by step:
//   On buy:  vault += actual_sol.  sol_raised += actual_sol.
//   On sell: vault -= sol_net (to user).  vault -= tax (to escrow).
//            So vault -= (sol_net + tax) = sol_gross.
//            sol_returned += sol_gross.
// Therefore: vault_balance = sol_raised - sol_returned + rent_exempt_min
// And integral(0, tokens_sold) should equal sol_raised - sol_returned (approximately).
//
// The solvency check from the spec (Invariant 9):
//   sol_vault_balance >= integral(0, tokens_sold) - rent_exempt_minimum
//
// But this doesn't account for the fact that cumulative rounding means
// sol_raised >= integral(0, peak_tokens_sold) -- vault has MORE than integral.
// After sells, vault = sol_raised - sol_returned.
// Expected minimum = calculate_sol_for_tokens(0, current_tokens_sold).
// Vault should be >= expected because:
//   1. Buys round UP (sol_raised >= sum of integrals)
//   2. Sells return integral amount (which is <= what was paid)

let rent = Rent::get()?;
let rent_exempt_min = rent.minimum_balance(0);
let expected_from_integral = calculate_sol_for_tokens(0, curve.tokens_sold)?;
let vault_balance = ctx.accounts.sol_vault.lamports();

require!(
    vault_balance >= expected_from_integral.saturating_sub(rent_exempt_min as u64),
    CurveError::VaultInsolvency  // New error variant needed (Claude's Discretion)
);
```

### Anti-Patterns to Avoid
- **Using system_program::transfer for program-owned PDAs:** The sol_vault is owned by the bonding curve program, NOT the system program. A CPI to system_program::transfer will fail with "invalid program argument." Always use direct lamport manipulation.
- **Using Anchor CPI (token_2022::transfer_checked) for PDA-signed transfers with Transfer Hook:** Known issue in MEMORY.md -- remaining_accounts are not forwarded properly. But for user-signed transfers, Anchor CPI works fine (see fund_curve.rs). However, per CONTEXT.md, use manual invoke for consistency.
- **Mixing tax rounding direction:** CONTEXT.md explicitly decides ceil rounding for tax. Don't use the spec's `* 15 / 100` floor pattern.
- **Forgetting rent-exempt minimum in solvency check:** A 0-byte account has ~890,880 lamports of rent. The vault balance will always include this. The solvency check must account for it.
- **Draining vault to 0:** If the vault drops to 0 lamports, the Solana runtime will garbage-collect the account. The sell must never drain the vault below rent-exempt minimum. This is naturally prevented by the solvency check -- if tokens_sold > 0, the integral is > 0, so the vault can't be fully drained.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reverse integral math | New function | Existing `calculate_sol_for_tokens(x2, N)` | Already proven correct with 500K property test iterations. Same function, different call site. |
| Tax calculation | Inline ad-hoc math | `SELL_TAX_BPS` and `BPS_DENOMINATOR` constants with ceil formula | Constants already exist. BPS pattern is standard, self-documenting, and testable. |
| PDA seed derivation | Hardcoded seeds | `CURVE_SEED`, `CURVE_SOL_VAULT_SEED`, `TAX_ESCROW_SEED` constants | Constants already exist, shared with initialize_curve.rs and purchase.rs. |
| Event emission | Custom logging | Existing `TokensSold` and `TaxCollected` event structs | Already defined in events.rs with all necessary fields. |
| Error codes | Generic errors | Existing `CurveNotActiveForSell`, `InsufficientTokenBalance`, `ZeroAmount`, `SlippageExceeded` | Already defined in error.rs. Only `VaultInsolvency` may need adding. |
| Property test infrastructure | New test harness | Existing proptest setup in math.rs | Percentage-based derivation strategy already proven to avoid >50% rejection. |

**Key insight:** Phase 71 was meticulously designed to pre-provision everything Phase 72 needs. The sell instruction is an assembly task, not a design task.

## Common Pitfalls

### Pitfall 1: Incorrect Reverse Integral Call Convention
**What goes wrong:** Calling `calculate_sol_for_tokens(tokens_sold, tokens_to_sell)` instead of `calculate_sol_for_tokens(tokens_sold - tokens_to_sell, tokens_to_sell)`.
**Why it happens:** The function signature is `calculate_sol_for_tokens(current_sold, tokens)` where `current_sold` is the START position. For a sell, the start position is the new (lower) position, not the current position.
**How to avoid:** Compute `x2 = x1 - N` first, then call `calculate_sol_for_tokens(x2, N)`. The math.rs docstring at line 125-127 explicitly documents this convention.
**Warning signs:** Round-trip tests will fail if the integral is computed from the wrong position.

### Pitfall 2: SOL Vault Drain Below Rent-Exempt Minimum
**What goes wrong:** Selling returns enough SOL to drop the vault below rent-exempt minimum (~890,880 lamports), causing account garbage collection.
**Why it happens:** The sell handler doesn't check available balance before transferring.
**How to avoid:** The solvency assertion naturally prevents this (if tokens_sold > 0, integral > 0, vault must retain funds). Additionally, add an explicit check: `require!(sol_vault.lamports() - sol_gross >= rent_exempt_min, ...)` before the lamport manipulation. Or rely on the post-state solvency check.
**Warning signs:** Account not found errors after a sell transaction.

### Pitfall 3: Tax Escrow Drain Below Rent-Exempt Minimum (Not a Phase 72 concern)
**What goes wrong:** Future phases (graduation/refund) drain tax escrow to 0.
**Why it happens:** The tax escrow is also a 0-byte account with rent-exempt minimum.
**How to avoid:** Phase 72 only ADDS to the escrow, never drains it. This is a Phase 73 concern. But document that the escrow retains rent-exempt minimum as a floor.

### Pitfall 4: Incorrect Token Transfer Direction in Transfer Hook Accounts
**What goes wrong:** Client passes Transfer Hook extra accounts in the wrong order for the sell direction.
**Why it happens:** Transfer Hook resolves extra accounts based on source/destination. The sell direction (user -> vault) has different source/destination than purchase (vault -> user).
**How to avoid:** On-chain, the instruction just passes remaining_accounts through -- the order is the client's responsibility. The client must use `createTransferCheckedWithTransferHookInstruction` with the correct from/to for the sell direction.
**Warning signs:** Transfer Hook error 3005 (AccountNotEnoughKeys) or whitelist rejection.

### Pitfall 5: Tokens Sold Underflow
**What goes wrong:** A user tries to sell more tokens than `tokens_sold` (e.g., if they received tokens via some other mechanism, though Transfer Hook prevents this).
**Why it happens:** `x2 = x1 - tokens_to_sell` would underflow.
**How to avoid:** Use `checked_sub` and return `CurveError::Overflow`. The spec doesn't list a specific error for this case, but `Overflow` covers it. Also, `tokens_to_sell <= user's ATA balance <= tokens_sold` should hold due to the Token-2022 Transfer Hook preventing external token inflows.

### Pitfall 6: BPF Stack Overflow from Large Account Struct
**What goes wrong:** The Sell accounts struct has 8+ accounts including InterfaceAccount types, which are large on the BPF stack.
**Why it happens:** Token-2022 InterfaceAccount types include extension data, expanding stack usage.
**How to avoid:** Box the largest accounts (user_token_account, token_vault, token_mint) just like Purchase does. Purchase already demonstrates this pattern.
**Warning signs:** "Stack offset exceeded" error during `anchor build`.

## Code Examples

### Sell Handler Skeleton (Spec Section 8.6, 10 Steps)
```rust
// Source: Bonding_Curve_Spec.md Section 8.6, adapted with CONTEXT.md decisions

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Sell<'info>>,
    tokens_to_sell: u64,
    minimum_sol_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let curve = &ctx.accounts.curve_state;

    // === VALIDATION ===
    // 1. Status check (Active only)
    require!(curve.status == CurveStatus::Active, CurveError::CurveNotActiveForSell);
    // 2. Balance check
    require!(ctx.accounts.user_token_account.amount >= tokens_to_sell, CurveError::InsufficientTokenBalance);
    // 3. Non-zero check
    require!(tokens_to_sell > 0, CurveError::ZeroAmount);
    // 4. Deadline check
    require!(clock.slot <= curve.deadline_slot, CurveError::DeadlinePassed);

    // === COMPUTATION ===
    // 5. Current position
    let x1 = curve.tokens_sold;
    // 6. New position after sell
    let x2 = x1.checked_sub(tokens_to_sell).ok_or(CurveError::Overflow)?;
    // 7. Reverse integral: SOL_gross
    let sol_gross = calculate_sol_for_tokens(x2, tokens_to_sell)?;
    // 8. Tax (ceil rounding, protocol-favored)
    let tax = sol_gross
        .checked_mul(SELL_TAX_BPS)
        .ok_or(CurveError::Overflow)?
        .checked_add(BPS_DENOMINATOR - 1)
        .ok_or(CurveError::Overflow)?
        / BPS_DENOMINATOR;
    // 9. Net payout
    let sol_net = sol_gross.checked_sub(tax).ok_or(CurveError::Overflow)?;
    // 10. Slippage check
    require!(sol_net >= minimum_sol_out, CurveError::SlippageExceeded);

    // === TRANSFERS ===
    // 11. Token transfer: user -> vault (Token-2022 with Transfer Hook)
    //     [manual invoke pattern for consistency with purchase.rs]
    // 12. SOL transfer: sol_vault -> user (direct lamport manipulation)
    // 13. Tax transfer: sol_vault -> tax_escrow (direct lamport manipulation)

    // === STATE UPDATE ===
    let curve = &mut ctx.accounts.curve_state;
    // 14. Update tokens_sold
    curve.tokens_sold = x2;
    // 15. Update cumulative counters
    curve.sol_returned = curve.sol_returned.checked_add(sol_gross).ok_or(CurveError::Overflow)?;
    curve.tokens_returned = curve.tokens_returned.checked_add(tokens_to_sell).ok_or(CurveError::Overflow)?;
    curve.tax_collected = curve.tax_collected.checked_add(tax).ok_or(CurveError::Overflow)?;

    // === SOLVENCY CHECK ===
    // 16. Post-state assertion (defense-in-depth)

    // === EVENTS ===
    // 17. Emit TokensSold
    // 18. Emit TaxCollected

    Ok(())
}
```

### Sell Accounts Struct
```rust
// Source: Bonding_Curve_Spec.md Section 8.6, adapted from purchase.rs pattern

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [CURVE_SEED, token_mint.key().as_ref()],
        bump = curve_state.bump,
        constraint = curve_state.status == CurveStatus::Active @ CurveError::CurveNotActiveForSell,
    )]
    pub curve_state: Account<'info, CurveState>,

    // NOT init_if_needed -- seller must already have tokens
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = curve_state,
        token::token_program = token_program,
        seeds = [CURVE_TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: SOL-only PDA, validated by seeds constraint.
    #[account(
        mut,
        seeds = [CURVE_SOL_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// CHECK: SOL-only PDA, validated by seeds and stored tax_escrow pubkey.
    #[account(
        mut,
        seeds = [TAX_ESCROW_SEED, token_mint.key().as_ref()],
        bump,
        constraint = tax_escrow.key() == curve_state.tax_escrow @ CurveError::InvalidStatus,
    )]
    pub tax_escrow: UncheckedAccount<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

### Property Test: Round-Trip Loss
```rust
// Source: Existing proptest infrastructure in math.rs, extended for sell
proptest! {
    #![proptest_config(ProptestConfig::with_cases(1_000_000))]

    #[test]
    fn buy_sell_round_trip_always_loses(
        sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL / 10,
        sold_pct in 0u64..=900_000u64,
    ) {
        let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

        // Buy tokens
        if let Ok(tokens_bought) = calculate_tokens_out(sol_lamports, current_sold) {
            if tokens_bought == 0 { return Ok(()); }

            // Sell those tokens back
            let new_sold = current_sold + tokens_bought;
            let x2 = current_sold; // back to where we started
            if let Ok(sol_gross) = calculate_sol_for_tokens(x2, tokens_bought) {
                // Apply 15% tax (ceil)
                let tax = (sol_gross as u128 * 1500 + 9999) / 10000;
                let sol_net = sol_gross.saturating_sub(tax as u64);

                // User should ALWAYS get back less than they spent
                prop_assert!(
                    sol_net < sol_lamports,
                    "Profitable round-trip! Spent {} got back {} (gross {}, tax {})",
                    sol_lamports, sol_net, sol_gross, tax
                );
            }
        }
    }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| system_program::transfer for PDA SOL transfers | Direct lamport manipulation | Always (Solana runtime constraint) | Must use lamport manipulation for program-owned PDAs. system_program only works for system-program-owned accounts. |
| Anchor CPI for all Token-2022 transfers | Manual invoke_signed for PDA-signed, Anchor CPI for user-signed | Project convention from Phase 71 | Anchor CPI's .with_remaining_accounts() works for user-signed transfers but not reliably for PDA-signed with Transfer Hook. |

**Deprecated/outdated:**
- The spec Section 8.6 pseudocode uses `sol_gross * 15 / 100` (floor). CONTEXT.md overrides this with ceil rounding using BPS. Use BPS ceil.

## Open Questions

### 1. New Error Variant for Solvency Violation
- **What we know:** CONTEXT.md lists "Claude's Discretion: Error variant for solvency violation" -- dedicated `VaultInsolvency` vs reuse existing.
- **What's unclear:** Whether to add a new error variant or reuse `Overflow`.
- **Recommendation:** Add a dedicated `VaultInsolvency` error variant. This is a defense-in-depth assertion that should never fire in production. A dedicated error code makes it immediately identifiable in logs and audits if it ever does fire. The cost is one more enum variant (zero runtime cost).

### 2. Rent-Exempt Minimum in Solvency Check
- **What we know:** CONTEXT.md says "Claude's Discretion: Whether the solvency formula accounts for rent-exempt minimum." The spec (Invariant 9) says: `sol_vault_balance >= integral(0, tokens_sold) - rent_exempt_minimum`.
- **What's unclear:** Whether to subtract rent_exempt from the integral or add it to the vault balance comparison.
- **Recommendation:** Follow the spec: `vault_balance >= expected_from_integral - rent_exempt_min`. The vault starts with rent-exempt minimum lamports from initialization, and the integral starts at 0 when tokens_sold is 0. The rent-exempt acts as a buffer. Fetch it dynamically via `Rent::get()?.minimum_balance(0)` rather than hardcoding.

### 3. Token Transfer Pattern: Manual invoke vs Anchor CPI
- **What we know:** CONTEXT.md says to follow the same manual invoke_signed pattern as purchase. But the sell direction has the user signing (not a PDA), so `invoke` (not `invoke_signed`) is used.
- **What's unclear:** Whether to literally use `invoke` (which works since user is a real signer) or use Anchor's CPI which also works for user-signed transfers (proven by fund_curve.rs).
- **Recommendation:** Use manual `invoke` (not `invoke_signed`) with remaining_accounts appended, mirroring the purchase.rs pattern but without PDA signer seeds. This maintains consistency with the existing codebase pattern and provides maximum control over Transfer Hook account forwarding.

### 4. Solvency Check on Buys
- **What we know:** CONTEXT.md says "Claude's Discretion: whether buys also get a solvency check (buys monotonically increase vault, so checking is redundant but harmless)."
- **Recommendation:** Don't add solvency checks to buys in Phase 72. Buys always increase vault balance, making the check trivially true. Adding it would add CU cost and code complexity for no security benefit. If desired, it can be added in a future hardening phase.

### 5. Sells That Would Drain Vault Below Rent-Exempt Minimum
- **What we know:** CONTEXT.md says "Claude's Discretion: How to handle sells that would reduce vault below rent-exempt minimum."
- **Recommendation:** The solvency assertion prevents this naturally. If `tokens_sold > 0`, then `integral(0, tokens_sold) > 0`, and the vault must hold at least that much. The minimum integral for even 1 token at position 0 is ~900 lamports (P_START), well above 0. Combined with the rent-exempt buffer, this is safe. No explicit minimum-balance check needed beyond the solvency invariant.

## Sources

### Primary (HIGH confidence)
- `programs/bonding_curve/src/` -- All source files read directly (math.rs, state.rs, constants.rs, error.rs, events.rs, purchase.rs, fund_curve.rs, initialize_curve.rs, lib.rs)
- `Docs/Bonding_Curve_Spec.md` -- Sections 4.5 (reverse integral), 5.7 (tax escrow), 8.6 (sell instruction), 13.4 (property tests), 15 (invariants)
- `.planning/phases/72-sell-back-tax-escrow/72-CONTEXT.md` -- Locked decisions and Claude's discretion items
- `.planning/phases/71-curve-foundation/71-03-PLAN.md` and `71-04-PLAN.md` -- Phase 71 implementation patterns
- Solana Expert (MCP tool) -- Confirmed SOL transfer patterns for program-owned PDAs, Transfer Hook behavior for user-signed transfers

### Secondary (MEDIUM confidence)
- Solana Stack Exchange -- Multiple verified answers confirming direct lamport manipulation is required for program-owned PDAs (links in expert research output)
- Anchor documentation on CPI -- Confirmed CpiContext::new() vs new_with_signer() distinction

### Tertiary (LOW confidence)
- None. All findings verified against authoritative sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All dependencies already in Cargo.toml, no new libraries needed
- Architecture: HIGH -- Pattern is a structural mirror of purchase.rs, all fields/types pre-exist
- Pitfalls: HIGH -- Verified against Solana runtime behavior via expert research and codebase patterns
- Math: HIGH -- Reverse integral already documented and tested in math.rs with 500K+ iterations

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, no external dependencies changing)
