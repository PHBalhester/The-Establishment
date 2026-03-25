# Phase 19: Tax Program PROFIT Swaps - Research

**Researched:** 2026-02-06
**Domain:** CPI Routing, Dual Token-2022 Transfer Hooks, Untaxed Swap Instructions
**Confidence:** HIGH

## Summary

Phase 19 implements `swap_profit_buy` and `swap_profit_sell` instructions in the Tax Program to route PROFIT pool swaps through the AMM. Unlike the SOL pool swaps (Phase 18), PROFIT pool swaps are **untaxed** - no protocol tax is collected, only the 0.5% AMM LP fee applies. This significantly simplifies the implementation: no tax calculation, no 3-way distribution, no EpochState reading.

The key complexity in this phase is **dual transfer hooks**: PROFIT pools involve Token-2022 transfers on BOTH sides (CRIME/FRAUD to/from PROFIT), unlike SOL pools where one side is SPL Token (WSOL, no hooks). The AMM already handles this via `swap_profit_pool` instruction, which splits `remaining_accounts` at the midpoint for input and output hook accounts.

The implementation follows the same CPI routing pattern established in Phase 18: build raw instruction data with Anchor discriminator, construct AccountMeta list, forward remaining_accounts, and use `invoke_signed` with the swap_authority PDA.

**Primary recommendation:** Replicate Phase 18's CPI pattern with simplified account list (no tax distribution accounts). Focus testing on the dual hook passthrough and correct remaining_accounts splitting.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.30+ | Program framework | Already used in Tax Program |
| anchor-spl | 0.30+ | Token-2022 interfaces | Already used in Tax Program |
| solana-program | Match Anchor | invoke_signed CPI | Already used in swap_sol_buy/sell |

### Not Needed
| Library | Reason |
|---------|--------|
| solana-program system_instruction | No native SOL transfers (no tax distribution) |
| EpochState cross-program read | PROFIT pools are untaxed |
| tax_math helpers | No tax calculation |

**No additional dependencies required** - Phase 18's Cargo.toml covers all needs.

## Architecture Patterns

### Recommended Project Structure
```
programs/tax-program/src/
├── instructions/
│   ├── mod.rs                 # Add swap_profit_buy, swap_profit_sell exports
│   ├── swap_profit_buy.rs     # NEW: CRIME/FRAUD -> PROFIT routing
│   └── swap_profit_sell.rs    # NEW: PROFIT -> CRIME/FRAUD routing
├── events.rs                  # Add UntaxedSwap event, PoolType variants
└── lib.rs                     # Add instruction entry points
```

### Pattern 1: Simplified Account List (No Tax Distribution)
**What:** PROFIT swap instructions have a much simpler account list than SOL swaps.
**When to use:** All PROFIT pool swap instructions
**Why:** No tax = no epoch_state, staking_escrow, carnage_vault, treasury accounts

```rust
// Source: Tax_Pool_Logic_Spec.md Section 10.4-10.5
// Compare SOL swap (14+ accounts) vs PROFIT swap (9 accounts)
#[derive(Accounts)]
pub struct SwapProfitBuy<'info> {
    /// User initiating the swap
    #[account(mut)]
    pub user: Signer<'info>,

    /// Tax Program's swap_authority PDA - signs AMM CPI
    #[account(
        seeds = [SWAP_AUTHORITY_SEED],
        bump,
    )]
    pub swap_authority: AccountInfo<'info>,

    // === Pool State (AMM) ===
    #[account(mut)]
    pub pool: AccountInfo<'info>,

    // === Pool Vaults ===
    #[account(mut)]
    pub pool_vault_a: InterfaceAccount<'info, TokenAccount>,  // CRIME/FRAUD
    #[account(mut)]
    pub pool_vault_b: InterfaceAccount<'info, TokenAccount>,  // PROFIT

    // === Mints ===
    pub mint_a: InterfaceAccount<'info, Mint>,  // CRIME/FRAUD
    pub mint_b: InterfaceAccount<'info, Mint>,  // PROFIT

    // === User Token Accounts ===
    #[account(mut)]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,

    // === Programs (NO TAX DISTRIBUTION TARGETS) ===
    pub amm_program: AccountInfo<'info>,
    pub token_2022_program: Interface<'info, TokenInterface>,  // Both sides are T22
}
```

### Pattern 2: Dual Hook Account Passthrough
**What:** Forward `remaining_accounts` to AMM where they are split for two separate Token-2022 transfers.
**When to use:** Every PROFIT pool swap
**Why:** AMM's `swap_profit_pool` splits remaining_accounts at midpoint: first half for input transfer hooks, second half for output transfer hooks

```rust
// Source: AMM swap_profit_pool.rs lines 171-180
// Tax Program must forward remaining_accounts identically to Phase 18
for account in ctx.remaining_accounts.iter() {
    if account.is_writable {
        account_metas.push(AccountMeta::new(account.key(), account.is_signer));
    } else {
        account_metas.push(AccountMeta::new_readonly(account.key(), account.is_signer));
    }
}

// AMM handler then splits:
// let (input_hook_accounts, output_hook_accounts) =
//     ctx.remaining_accounts.split_at(ctx.remaining_accounts.len() / 2);
```

### Pattern 3: Raw CPI with Anchor Discriminator
**What:** Build AMM instruction manually using precomputed Anchor discriminator.
**When to use:** All CPI calls to AMM (same as Phase 18)
**Why:** AMM may not export CPI stubs; raw invoke_signed is reliable

```rust
// Source: Phase 18 swap_sol_buy.rs lines 176-184
// Discriminator for swap_profit_pool = sha256("global:swap_profit_pool")[0..8]
// Verified: echo -n "global:swap_profit_pool" | shasum -a 256 = cea30b22f16c24a6...
const AMM_SWAP_PROFIT_POOL_DISCRIMINATOR: [u8; 8] = [0xce, 0xa3, 0x0b, 0x22, 0xf1, 0x6c, 0x24, 0xa6];

// Instruction data format: [discriminator][amount_in:u64][direction:u8][minimum_out:u64]
let mut ix_data = Vec::with_capacity(25);
ix_data.extend_from_slice(&AMM_SWAP_PROFIT_POOL_DISCRIMINATOR);
ix_data.extend_from_slice(&amount_in.to_le_bytes());
ix_data.push(direction);  // 0 = AtoB (buy PROFIT), 1 = BtoA (sell PROFIT)
ix_data.extend_from_slice(&minimum_output.to_le_bytes());
```

### Pattern 4: UntaxedSwap Event Emission
**What:** Emit UntaxedSwap event after successful swap with swap details.
**When to use:** After every PROFIT pool swap
**Source:** Tax_Pool_Logic_Spec.md Section 20.3

```rust
// Add to events.rs
#[event]
pub struct UntaxedSwap {
    /// The user performing the swap
    pub user: Pubkey,
    /// Pool type: CrimeProfit or FraudProfit
    pub pool_type: PoolType,
    /// Direction: Buy or Sell (relative to PROFIT)
    pub direction: SwapDirection,
    /// Input amount
    pub input_amount: u64,
    /// Output amount after LP fee
    pub output_amount: u64,
    /// LP fee amount deducted
    pub lp_fee: u64,
    /// Slot of the transaction
    pub slot: u64,
}

// Add new PoolType variants
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolType {
    SolCrime,
    SolFraud,
    CrimeProfit,   // NEW
    FraudProfit,   // NEW
}
```

### Anti-Patterns to Avoid
- **Including tax distribution accounts:** PROFIT pools have no tax. Don't cargo-cult from swap_sol_buy/sell.
- **Forgetting dual hook passthrough:** Both Token-2022 transfers need hook accounts. Empty remaining_accounts will fail with transfer hook mints.
- **Hardcoding single token_program:** Unlike SOL swaps (SPL + T22), PROFIT swaps use T22 for both. Pass same program for both sides.
- **Computing LP fee in Tax Program:** Let AMM handle fee calculation. Tax Program just passes amounts through.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LP fee calculation | Tax Program fee math | AMM's internal logic | Fee stays in pool reserves, no Tax Program involvement |
| Output amount tracking | Balance-before/after diff | AMM's slippage check | simpler, consistent with SOL pattern |
| Hook account resolution | On-chain PDA derivation | Off-chain client passes remaining_accounts | Hook accounts resolved by client (per Transfer_Hook_Spec.md Section 8) |
| Pool type detection | Mint checks | `is_crime` parameter | Same pattern as Phase 18, explicit is clearer |

**Key insight:** PROFIT swap instructions are even simpler than SOL swaps. The Tax Program is purely a CPI router for these - no tax logic, no distribution logic. The only value-add is enforcing that swaps route through the Tax Program's swap_authority for access control.

## Common Pitfalls

### Pitfall 1: Missing or Incorrect Hook Account Splitting
**What goes wrong:** One transfer succeeds but second fails with "missing required accounts".
**Why it happens:** Client doesn't provide hook accounts for both transfers, or provides unbalanced sets.
**How to avoid:**
- Document that client must provide `[input_hooks..., output_hooks...]`
- Both sets must be equal length (same hook structure for all IP tokens)
- Test with actual Transfer Hook program deployed
**Warning signs:** Works with mints that have no hooks, fails with hooked mints.

### Pitfall 2: Wrong Discriminator for swap_profit_pool
**What goes wrong:** AMM returns "instruction not found" or deserialization error.
**Why it happens:** Discriminator computed from wrong instruction name or typo.
**How to avoid:**
- Verify discriminator: `sha256("global:swap_profit_pool")[0..8]`
- Correct value: `[0xce, 0xa3, 0x0b, 0x22, 0xf1, 0x6c, 0x24, 0xa6]`
- Test CPI calls in integration tests
**Warning signs:** Transaction fails at AMM level, not Tax Program level.

### Pitfall 3: Passing Wrong Token Program
**What goes wrong:** Token transfer fails with program mismatch error.
**Why it happens:** Passing SPL Token ID instead of Token-2022 ID.
**How to avoid:**
- PROFIT pools: BOTH sides are Token-2022
- SOL pools: WSOL=SPL, CRIME/FRAUD=T22
- Validate token_program matches expected mint type
**Warning signs:** Works for SOL pools (Phase 18), fails for PROFIT pools.

### Pitfall 4: Slippage Check Location
**What goes wrong:** User expects minimum output but receives less.
**Why it happens:** Confusion about where slippage is checked.
**How to avoid:**
- For PROFIT swaps (no tax): AMM's `minimum_amount_out` is sufficient
- Tax Program can pass user's minimum directly to AMM
- Unlike SOL sell (where Tax Program must check net-of-tax), PROFIT has no deduction
**Warning signs:** None - this is simpler than Phase 18, but document the difference.

### Pitfall 5: Forgetting to Add New Event and PoolType Variants
**What goes wrong:** Event emission fails compilation or emits wrong type.
**Why it happens:** Using TaxedSwap (Phase 18) instead of UntaxedSwap.
**How to avoid:**
- Add `UntaxedSwap` event to events.rs
- Add `CrimeProfit`, `FraudProfit` to PoolType enum
- Use correct event type in instruction handlers
**Warning signs:** Compiler errors on event emission, or off-chain indexers confused.

## Code Examples

### swap_profit_buy Handler Structure
```rust
// Source: Tax_Pool_Logic_Spec.md Section 10.4, Phase 18 swap_sol_buy.rs pattern
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SwapProfitBuy<'info>>,
    amount_in: u64,
    minimum_output: u64,
    is_crime: bool,  // true = CRIME/PROFIT pool, false = FRAUD/PROFIT pool
) -> Result<()> {
    // 1. Build swap_authority PDA signer seeds
    let swap_authority_seeds: &[&[u8]] = &[
        SWAP_AUTHORITY_SEED,
        &[ctx.bumps.swap_authority],
    ];

    // 2. Build AMM swap_profit_pool instruction
    // Verified: echo -n "global:swap_profit_pool" | shasum -a 256 = cea30b22f16c24a6...
    const AMM_SWAP_PROFIT_POOL_DISCRIMINATOR: [u8; 8] =
        [0xce, 0xa3, 0x0b, 0x22, 0xf1, 0x6c, 0x24, 0xa6];

    let direction: u8 = 0;  // AtoB = buying PROFIT (CRIME/FRAUD -> PROFIT)

    let mut ix_data = Vec::with_capacity(25);
    ix_data.extend_from_slice(&AMM_SWAP_PROFIT_POOL_DISCRIMINATOR);
    ix_data.extend_from_slice(&amount_in.to_le_bytes());
    ix_data.extend_from_slice(&[direction]);
    ix_data.extend_from_slice(&minimum_output.to_le_bytes());

    // 3. Build account metas (order matches AMM SwapProfitPool struct)
    let mut account_metas = vec![
        AccountMeta::new_readonly(ctx.accounts.swap_authority.key(), true),
        AccountMeta::new(ctx.accounts.pool.key(), false),
        AccountMeta::new(ctx.accounts.pool_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.pool_vault_b.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint_a.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint_b.key(), false),
        AccountMeta::new(ctx.accounts.user_token_a.key(), false),
        AccountMeta::new(ctx.accounts.user_token_b.key(), false),
        AccountMeta::new_readonly(ctx.accounts.user.key(), true),
        AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false), // Both sides T22
    ];

    // 4. Forward remaining_accounts for dual transfer hooks
    for account in ctx.remaining_accounts.iter() {
        if account.is_writable {
            account_metas.push(AccountMeta::new(account.key(), account.is_signer));
        } else {
            account_metas.push(AccountMeta::new_readonly(account.key(), account.is_signer));
        }
    }

    // 5. Build and execute CPI
    let ix = Instruction {
        program_id: ctx.accounts.amm_program.key(),
        accounts: account_metas,
        data: ix_data,
    };

    let mut account_infos = vec![/* ... same as account_metas order ... */];
    for acc in ctx.remaining_accounts.iter() {
        account_infos.push(acc.clone());
    }
    account_infos.push(ctx.accounts.amm_program.to_account_info());

    invoke_signed(&ix, &account_infos, &[swap_authority_seeds])?;

    // 6. Emit UntaxedSwap event
    let clock = Clock::get()?;
    emit!(UntaxedSwap {
        user: ctx.accounts.user.key(),
        pool_type: if is_crime { PoolType::CrimeProfit } else { PoolType::FraudProfit },
        direction: SwapDirection::Buy,
        input_amount: amount_in,
        output_amount: 0,  // Note: Cannot easily get output from CPI return
        lp_fee: 0,         // Computed by AMM, not available here
        slot: clock.slot,
    });

    Ok(())
}
```

### swap_profit_sell Direction Difference
```rust
// Source: AMM swap_profit_pool.rs SwapDirection enum
// For sell: PROFIT -> CRIME/FRAUD, direction = BtoA (1)
let direction: u8 = 1;  // BtoA = selling PROFIT (PROFIT -> CRIME/FRAUD)

// Emit with Sell direction
emit!(UntaxedSwap {
    direction: SwapDirection::Sell,
    // ... other fields
});
```

### Updated events.rs with UntaxedSwap
```rust
// Source: Tax_Pool_Logic_Spec.md Section 20.3

/// Pool type identifier for events.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolType {
    /// SOL-CRIME pool
    SolCrime,
    /// SOL-FRAUD pool
    SolFraud,
    /// CRIME-PROFIT pool
    CrimeProfit,
    /// FRAUD-PROFIT pool
    FraudProfit,
}

/// Emitted after every untaxed swap (PROFIT pool swaps only).
#[event]
pub struct UntaxedSwap {
    pub user: Pubkey,
    pub pool_type: PoolType,
    pub direction: SwapDirection,
    pub input_amount: u64,
    pub output_amount: u64,
    pub lp_fee: u64,
    pub slot: u64,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single token program per pool | Mixed SPL/T22 per pool | Token-2022 launch | PROFIT pools are dual-T22 |
| Single hook per transfer | Dual hooks in PROFIT pools | Protocol design | requires split remaining_accounts |
| Generic swap instruction | Pool-type specific instructions | Phase 18/19 | Clear separation of taxed vs untaxed |

**No deprecated patterns** - Phase 18 established the correct CPI patterns, Phase 19 follows them with simplification.

## Open Questions

### 1. UntaxedSwap Event output_amount Field
**What we know:** CPI to AMM doesn't return output amount directly. Balance diff approach (like swap_sol_sell) would require reloading user_token_b.
**What's unclear:** Is it worth the compute cost to capture actual output for the event?
**Recommendation:** Set to 0 initially (same as swap_sol_buy). Can enhance later if off-chain analytics need it. The AMM's SwapEvent already captures the full details.

### 2. LP Fee Calculation for Event
**What we know:** LP fee is `amount_in - effective_input`, but effective_input is computed inside AMM.
**What's unclear:** Should Tax Program replicate the 50 bps calculation for the event?
**Recommendation:** Set lp_fee to 0 in UntaxedSwap event. Computing it would duplicate AMM logic. Off-chain can calculate from amount_in if needed.

### 3. Discriminator Verification Complete
**Verified:** `sha256("global:swap_profit_pool")[0..8]` = `[0xce, 0xa3, 0x0b, 0x22, 0xf1, 0x6c, 0x24, 0xa6]`
**Command used:** `echo -n "global:swap_profit_pool" | shasum -a 256`
**Result:** cea30b22f16c24a6... (first 8 bytes in hex)

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Tax_Pool_Logic_Spec.md` - Sections 10.4, 10.5, 11.3, 20.3
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/swap_profit_pool.rs` - AMM dual-hook handling
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/transfers.rs` - transfer_t22_checked implementation
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_buy.rs` - Phase 18 CPI pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_sell.rs` - Phase 18 CPI pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/18-tax-program-core/18-RESEARCH.md` - Prior research

### Secondary (MEDIUM confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Transfer_Hook_Spec.md` - Section 8 (ExtraAccountMetaList)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/tests/test_swap_sol_buy.rs` - Testing patterns

### Tertiary (LOW confidence)
- None - all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, reuses Phase 18 patterns
- Architecture: HIGH - AMM swap_profit_pool already implemented, CPI pattern proven
- Pitfalls: HIGH - Derived from actual code review and Phase 18 experience
- Code examples: HIGH - Adapted from existing implementations

**Research date:** 2026-02-06
**Valid until:** 60 days (stable patterns, no external dependencies changing)
