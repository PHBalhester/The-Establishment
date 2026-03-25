# Phase 18: Tax Program Core - Research

**Researched:** 2026-02-06
**Domain:** Anchor CPI, Solana Token Transfers, Tax Calculation Patterns
**Confidence:** HIGH

## Summary

This research covers implementing a Tax Program that wraps AMM swaps with asymmetric taxation and atomic SOL distribution. The phase requires building `swap_sol_buy` and `swap_sol_sell` instructions that:
1. Read tax rates from an external EpochState account (owned by Epoch Program)
2. Calculate and deduct tax using u128 intermediate arithmetic
3. Distribute collected SOL atomically (75% staking, 24% carnage, 1% treasury)
4. Invoke the AMM via CPI with proper PDA signing

The implementation pattern is well-established: the existing AMM already implements the CPI access control pattern with `swap_authority` PDA validation. The Tax Program creates the other half of this pattern by signing CPI calls with its own `swap_authority` PDA.

**Primary recommendation:** Follow the existing AMM's CPI patterns and transfer helpers exactly. The Tax Program is a thin routing layer with tax calculation/distribution logic. Avoid adding state accounts beyond the `swap_authority` PDA.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.30+ | Program framework | Already used in AMM/Transfer Hook |
| anchor-spl | 0.30+ | Token-2022 and SPL Token interfaces | Already used in AMM |
| spl-token | - | SPL Token program ID | WSOL transfers |
| spl-token-2022 | - | Token-2022 program ID | CRIME/FRAUD transfers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-program | Match Anchor | System program, invoke_signed | Native SOL transfers to escrow/carnage/treasury |

### Not Needed
| Library | Reason |
|---------|--------|
| spl-math | Tax calculation is simple basis point division, no compound interest |
| Custom PreciseNumber | u128 intermediates with `checked_*` operations suffice |

**No additional dependencies required** - the AMM's existing Cargo.toml covers all needs.

## Architecture Patterns

### Recommended Project Structure
```
programs/tax-program/src/
├── lib.rs               # Program entry points: swap_sol_buy, swap_sol_sell
├── constants.rs         # SWAP_AUTHORITY_SEED, BPS_DENOMINATOR, distribution percentages
├── errors.rs            # TaxError enum
├── events.rs            # TaxedSwap event
├── helpers/
│   ├── mod.rs
│   ├── tax_math.rs      # Tax calculation and distribution split
│   └── transfers.rs     # Native SOL transfer helpers (if needed)
└── instructions/
    ├── mod.rs
    ├── swap_sol_buy.rs   # SOL -> CRIME/FRAUD with buy tax
    └── swap_sol_sell.rs  # CRIME/FRAUD -> SOL with sell tax
```

### Pattern 1: Stateless Routing Layer
**What:** Tax Program owns no state accounts except the `swap_authority` PDA (signer-only, no data).
**When to use:** Always - per Tax_Pool_Logic_Spec.md Section 2.1
**Why:** Tax rates come from EpochState (Epoch Program), pool state comes from AMM, distribution targets are external accounts. No state to synchronize.

```rust
// swap_authority is a signer-only PDA with no data storage
// Seeds: ["swap_authority"]
// Program: tax_program
#[account(
    seeds = [b"swap_authority"],
    bump,
)]
pub swap_authority: SystemAccount<'info>, // No data, just signs
```

### Pattern 2: CPI to AMM with PDA Signing
**What:** Tax Program invokes AMM swap instructions using its `swap_authority` PDA as signer.
**When to use:** Every swap instruction
**Example:**
```rust
// Source: AMM_Implementation.md Section 18, existing AMM swap_sol_pool.rs
let swap_authority_seeds: &[&[u8]] = &[
    b"swap_authority",
    &[ctx.bumps.swap_authority],
];

// Build CPI context with PDA signer
let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.amm_program.to_account_info(),
    amm::cpi::accounts::SwapSolPool {
        swap_authority: ctx.accounts.swap_authority.to_account_info(),
        pool: ctx.accounts.pool.to_account_info(),
        vault_a: ctx.accounts.pool_vault_a.to_account_info(),
        vault_b: ctx.accounts.pool_vault_b.to_account_info(),
        mint_a: ctx.accounts.mint_a.to_account_info(),
        mint_b: ctx.accounts.mint_b.to_account_info(),
        user_token_a: ctx.accounts.user_token_a.to_account_info(),
        user_token_b: ctx.accounts.user_token_b.to_account_info(),
        user: ctx.accounts.user.to_account_info(),
        token_program_a: ctx.accounts.token_program_a.to_account_info(),
        token_program_b: ctx.accounts.token_program_b.to_account_info(),
    },
    &[swap_authority_seeds],
);

// Forward remaining_accounts for transfer hook
let cpi_ctx = cpi_ctx.with_remaining_accounts(ctx.remaining_accounts.to_vec());

amm::cpi::swap_sol_pool(cpi_ctx, amount_to_swap, direction, minimum_amount_out)?;
```

### Pattern 3: Tax Calculation with u128 Intermediates
**What:** Use u128 for all intermediate tax calculations, downcast to u64 only at the end.
**When to use:** All tax calculations and distribution splits
**Example:**
```rust
// Source: Helius Solana Arithmetic Best Practices, existing AMM math.rs patterns
pub fn calculate_tax(amount: u64, tax_bps: u16) -> Option<u64> {
    let amount_u128 = amount as u128;
    let tax_bps_u128 = tax_bps as u128;

    // tax = amount * tax_bps / 10_000
    let tax_u128 = amount_u128
        .checked_mul(tax_bps_u128)?
        .checked_div(10_000)?;

    u64::try_from(tax_u128).ok()
}

pub fn calculate_distribution(total_tax: u64) -> Option<(u64, u64, u64)> {
    let total = total_tax as u128;

    // Staking: 75% (floor)
    let staking = total.checked_mul(75)?.checked_div(100)? as u64;

    // Carnage: 24% (floor)
    let carnage = total.checked_mul(24)?.checked_div(100)? as u64;

    // Treasury: remainder (absorbs dust)
    let treasury = total_tax
        .checked_sub(staking)?
        .checked_sub(carnage)?;

    Some((staking, carnage, treasury))
}
```

### Pattern 4: Buy vs Sell Tax Application Points
**What:** Buy tax deducted from SOL input BEFORE swap; sell tax deducted from SOL output AFTER swap.
**When to use:** Per CALC-02, CALC-03

**Buy flow (SOL -> CRIME/FRAUD):**
```
1. User submits: sol_amount, minimum_crime_out
2. Tax Program: tax = sol_amount * buy_tax_bps / 10_000
3. Tax Program: sol_to_swap = sol_amount - tax
4. CPI to AMM: swap(sol_to_swap) -> crime_received
5. Distribute tax: 75% staking, 24% carnage, 1% treasury
6. Verify: crime_received >= minimum_crime_out
```

**Sell flow (CRIME/FRAUD -> SOL):**
```
1. User submits: crime_amount, minimum_sol_out
2. CPI to AMM: swap(crime_amount) -> sol_gross
3. Tax Program: tax = sol_gross * sell_tax_bps / 10_000
4. Tax Program: sol_net = sol_gross - tax
5. Distribute tax: 75% staking, 24% carnage, 1% treasury
6. Verify: sol_net >= minimum_sol_out
```

### Pattern 5: Native SOL Transfers for Distribution
**What:** Tax distribution uses native SOL transfers (system_instruction::transfer), not WSOL.
**When to use:** For staking_escrow, carnage_vault, treasury payments
**Example:**
```rust
// Source: Solana CPI docs, New_Yield_System_Spec.md Section 7.5
use solana_program::system_instruction;

// Transfer to staking escrow
let transfer_ix = system_instruction::transfer(
    &ctx.accounts.user.key(),  // or a temp holding account
    &ctx.accounts.staking_escrow.key(),
    staking_portion,
);
invoke(
    &transfer_ix,
    &[
        ctx.accounts.user.to_account_info(),
        ctx.accounts.staking_escrow.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    ],
)?;
```

### Anti-Patterns to Avoid
- **Storing tax rates in Tax Program:** Tax rates live in EpochState. Reading cross-program is correct.
- **Accumulating tax before distribution:** Per DIST-05, distribution is atomic within the swap instruction.
- **Using WSOL for distribution:** Distribution targets (escrow, carnage, treasury) hold native SOL.
- **Custom token transfer logic:** Reuse AMM's transfer helpers or let CPI handle it.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token transfers | Custom invoke() calls | AMM's `transfer_t22_checked` / `transfer_spl` helpers | Hook account handling, decimals, authority validation already done |
| Basis point math | `amount / 100 * bps` | `amount * bps / 10_000` with u128 | Multiply first for precision, per Helius best practices |
| CPI account building | Manual AccountInfo vectors | Anchor's CpiContext | Type safety, signer seed handling |
| Slippage check | Post-swap balance comparison | AMM's built-in minimum_amount_out | AMM already returns error on slippage violation |

**Key insight:** The Tax Program should be extremely thin. All complex logic (swap math, k-invariant, token routing, hook handling) is already in the AMM. Tax Program adds only: tax calculation, distribution, and CPI orchestration.

## Common Pitfalls

### Pitfall 1: Wrong Tax Application Point
**What goes wrong:** Applying buy tax to output tokens instead of input SOL, or sell tax to input tokens instead of output SOL.
**Why it happens:** Confusion about where in the flow tax applies.
**How to avoid:**
- Buy tax: deduct from SOL BEFORE calling AMM swap
- Sell tax: deduct from SOL AFTER receiving from AMM swap
**Warning signs:** Tests show users receiving more tokens than expected (buy) or more SOL than expected (sell).

### Pitfall 2: Distribution Rounding Errors
**What goes wrong:** 75 + 24 + 1 = 100, but integer division can leave dust unaccounted.
**Why it happens:** `tax * 75 / 100` floors, `tax * 24 / 100` floors, 1% may not equal remainder.
**How to avoid:** Per CONTEXT.md decision: Treasury = total_tax - staking - carnage (gets remainder).
**Warning signs:** Sum of distributed amounts != total tax collected.

### Pitfall 3: Missing remaining_accounts Passthrough
**What goes wrong:** Token-2022 transfers fail with "missing required accounts" because hook accounts aren't forwarded.
**Why it happens:** Tax Program doesn't pass `remaining_accounts` to AMM CPI.
**How to avoid:** Always include `.with_remaining_accounts(ctx.remaining_accounts.to_vec())` on CPI context.
**Warning signs:** Integration tests with real Transfer Hook fail; unit tests pass.

### Pitfall 4: CPI Depth Exceeded
**What goes wrong:** Transaction fails with "max CPI depth exceeded".
**Why it happens:** Tax -> AMM -> Token-2022 -> Transfer Hook = depth 4. Adding another CPI pushes to 5.
**How to avoid:** Keep Tax Program CPI chain minimal. Don't add intermediate programs.
**Warning signs:** Works in localnet without hooks, fails with real hooks deployed.

### Pitfall 5: Slippage Check in Wrong Place
**What goes wrong:** User sets `minimum_output = 100`, tax deducts 10%, AMM returns 95, user receives 85.5, AMM's slippage check passes but user got less than expected.
**Why it happens:** AMM checks gross output, not net-of-tax output.
**How to avoid:** Per CONTEXT.md discretion area: Check `net_output >= minimum_output` in Tax Program AFTER tax deduction.
**Warning signs:** Users complain about receiving less than minimum even when tx succeeds.

### Pitfall 6: Micro-Tax Edge Case
**What goes wrong:** Tax = 3 lamports. 75% = 2.25 -> 2, 24% = 0.72 -> 0, 1% = 0.03 -> 0. Only 2 distributed.
**Why it happens:** Integer division floors all portions to near-zero.
**How to avoid:** Per CONTEXT.md discretion: When tax < 4 lamports, send all to staking (simplest, avoids dust).
**Warning signs:** Treasury/carnage receive 0 on small swaps, total distributed < total tax.

## Code Examples

### Tax Calculation and Distribution
```rust
// Source: Verified pattern from AMM math.rs, adapted for tax
pub const BPS_DENOMINATOR: u128 = 10_000;

/// Calculate tax amount from a SOL value.
/// Returns None if arithmetic overflows.
pub fn calculate_tax(amount_lamports: u64, tax_bps: u16) -> Option<u64> {
    let amount = amount_lamports as u128;
    let bps = tax_bps as u128;

    let tax = amount
        .checked_mul(bps)?
        .checked_div(BPS_DENOMINATOR)?;

    u64::try_from(tax).ok()
}

/// Split total tax into (staking, carnage, treasury) portions.
/// Treasury gets remainder to absorb rounding dust.
/// Returns None if arithmetic underflows (shouldn't happen with valid inputs).
pub fn split_distribution(total_tax: u64) -> Option<(u64, u64, u64)> {
    // Handle micro-tax edge case: if tax < 4, all to staking
    if total_tax < 4 {
        return Some((total_tax, 0, 0));
    }

    let total = total_tax as u128;

    // Staking: floor(total * 75 / 100)
    let staking_u128 = total.checked_mul(75)?.checked_div(100)?;
    let staking = u64::try_from(staking_u128).ok()?;

    // Carnage: floor(total * 24 / 100)
    let carnage_u128 = total.checked_mul(24)?.checked_div(100)?;
    let carnage = u64::try_from(carnage_u128).ok()?;

    // Treasury: remainder (total - staking - carnage)
    let treasury = total_tax
        .checked_sub(staking)?
        .checked_sub(carnage)?;

    Some((staking, carnage, treasury))
}
```

### Reading Tax Rates from EpochState
```rust
// Source: Epoch_State_Machine_Spec.md Section 10
/// Read the appropriate tax rate based on token and direction.
pub fn get_tax_rate(
    epoch_state: &EpochState,
    is_crime: bool,  // true = CRIME pool, false = FRAUD pool
    is_buy: bool,    // true = buying tokens, false = selling tokens
) -> u16 {
    match (is_crime, is_buy) {
        (true, true) => epoch_state.crime_buy_tax_bps,
        (true, false) => epoch_state.crime_sell_tax_bps,
        (false, true) => epoch_state.fraud_buy_tax_bps,
        (false, false) => epoch_state.fraud_sell_tax_bps,
    }
}
```

### TaxedSwap Event Structure
```rust
// Source: Tax_Pool_Logic_Spec.md Section 20.1
#[event]
pub struct TaxedSwap {
    pub user: Pubkey,
    pub pool_type: PoolType,     // SolCrime or SolFraud
    pub direction: SwapDirection, // Buy or Sell
    pub input_amount: u64,
    pub output_amount: u64,
    pub tax_amount: u64,
    pub tax_rate_bps: u16,
    pub staking_portion: u64,
    pub carnage_portion: u64,
    pub treasury_portion: u64,
    pub epoch: u32,
    pub slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum PoolType {
    SolCrime,
    SolFraud,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum SwapDirection {
    Buy,   // SOL -> token
    Sell,  // token -> SOL
}
```

### Swap Buy Instruction Account Structure
```rust
// Source: Tax_Pool_Logic_Spec.md Section 10.2, AMM swap_sol_pool.rs
#[derive(Accounts)]
pub struct SwapSolBuy<'info> {
    /// User initiating the swap
    #[account(mut)]
    pub user: Signer<'info>,

    /// EpochState from Epoch Program - read-only for tax rates
    /// Constraint: must be the canonical EpochState PDA
    #[account(
        seeds = [b"epoch_state"],
        seeds::program = EPOCH_PROGRAM_ID,
        bump,
    )]
    pub epoch_state: Account<'info, EpochState>,

    /// Tax Program's swap_authority PDA - signs AMM CPI
    #[account(
        seeds = [b"swap_authority"],
        bump,
    )]
    pub swap_authority: SystemAccount<'info>,

    // === AMM accounts (passed through to CPI) ===
    #[account(mut)]
    pub pool: Account<'info, PoolState>,

    #[account(mut)]
    pub pool_vault_sol: InterfaceAccount<'info, TokenAccount>,  // WSOL vault

    #[account(mut)]
    pub pool_vault_token: InterfaceAccount<'info, TokenAccount>, // CRIME/FRAUD vault

    pub mint_sol: InterfaceAccount<'info, Mint>,   // WSOL mint
    pub mint_token: InterfaceAccount<'info, Mint>, // CRIME/FRAUD mint

    #[account(mut)]
    pub user_wsol: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token: InterfaceAccount<'info, TokenAccount>,

    // === Distribution targets ===
    /// Staking Program escrow - receives 75% of tax
    #[account(mut)]
    pub staking_escrow: SystemAccount<'info>,

    /// Carnage Fund vault - receives 24% of tax
    #[account(mut)]
    pub carnage_vault: SystemAccount<'info>,

    /// Protocol treasury - receives 1% (remainder) of tax
    #[account(mut)]
    pub treasury: SystemAccount<'info>,

    // === Programs ===
    pub amm_program: Program<'info, Amm>,
    pub token_program_sol: Interface<'info, TokenInterface>,    // SPL Token
    pub token_program_token: Interface<'info, TokenInterface>,  // Token-2022
    pub system_program: Program<'info, System>,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| u64 throughout | u128 intermediates | Standard practice | Prevents overflow on large swaps |
| plain `transfer` | `transfer_checked` | Token-2022 launch | Required for hooks, validates decimals |
| CPI callback VRF | On-demand commit/reveal | 2025 | Tax rates come from EpochState, not callback |

**Deprecated/outdated:**
- Switchboard VRF v2 CPI callbacks: Use On-Demand (but Tax Program just reads EpochState, doesn't interact with VRF)
- Token mint-level transfer fees: Protocol uses custom Tax Program logic instead

## Open Questions

### 1. InsufficientInput Threshold
**What we know:** CONTEXT.md says "InsufficientInput error fires when output rounds to zero"
**What's unclear:** Should this fire when `net_output == 0` or `net_output < tax`?
**Recommendation:** Fire when `net_output == 0`. The user paying tax but receiving nothing is the problematic case. Receiving less than tax paid is economically unwise but not an error.

### 2. Where to Check Slippage
**What we know:** AMM has slippage check. CONTEXT.md marks this as discretion.
**What's unclear:** Should Tax Program ALSO check, or rely on AMM?
**Recommendation:** Tax Program should check `net_output >= minimum_output` because:
- Buy: AMM sees `sol_to_swap` (pre-tax), not `sol_amount` (user input). AMM's check is on the right thing.
- Sell: AMM sees `sol_gross`, user expects `sol_net`. Tax Program must verify `sol_net >= minimum_output`.
- Conclusion: Check in Tax Program for sell, let AMM handle buy (or check both for consistency).

### 3. Test Coverage Strategy
**What we know:** CONTEXT.md says both CRIME and FRAUD need testing.
**What's unclear:** Parameterized tests vs duplicate tests.
**Recommendation:** Parameterized tests with `#[test_case]` or proptest. Write test logic once, run for both tokens. Cover:
- Both tokens (CRIME, FRAUD)
- Both directions (buy, sell)
- Edge cases (micro amounts, max amounts, exact slippage boundary)

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Tax_Pool_Logic_Spec.md` - Canonical Tax Program specification
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/AMM_Implementation.md` - AMM CPI interface, swap_authority pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Epoch_State_Machine_Spec.md` - EpochState account structure, tax rate fields
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/New_Yield_System_Spec.md` - Staking escrow deposit interface
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/swap_sol_pool.rs` - Existing AMM implementation
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/transfers.rs` - Token transfer helpers
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/math.rs` - u128 arithmetic patterns

### Secondary (MEDIUM confidence)
- [Solana CPI Documentation](https://solana.com/docs/core/cpi) - invoke_signed, PDA signing, depth limits
- [Helius Solana Arithmetic](https://www.helius.dev/blog/solana-arithmetic) - u128 intermediates, basis points, multiply-before-divide
- [Anchor CPI Basics](https://www.anchor-lang.com/docs/basics/cpi) - CpiContext patterns

### Tertiary (LOW confidence)
- None - all patterns verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Already using Anchor/SPL in AMM, no new dependencies
- Architecture: HIGH - Tax_Pool_Logic_Spec.md is comprehensive, AMM patterns are implemented
- Pitfalls: HIGH - Derived from existing code patterns and spec edge cases
- CPI patterns: HIGH - Verified against existing AMM swap_sol_pool.rs implementation

**Research date:** 2026-02-06
**Valid until:** 60 days (stable patterns, specs are locked)
