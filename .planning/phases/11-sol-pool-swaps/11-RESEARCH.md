# Phase 11: SOL Pool Swaps - Research

**Researched:** 2026-02-04
**Domain:** Anchor AMM swap instruction for mixed T22/SPL constant-product pools
**Confidence:** HIGH

## Summary

Phase 11 implements the `swap_sol_pool` instruction that executes bidirectional swaps in CRIME/SOL and FRAUD/SOL mixed pools. These pools pair Token-2022 tokens (with transfer hooks) against WSOL (standard SPL Token, no hooks), requiring dual token program handling within a single instruction.

The existing codebase provides a solid foundation: swap math is complete and property-tested (`helpers/math.rs`), transfer routing helpers handle both T22 and SPL paths (`helpers/transfers.rs`), and pool state includes all necessary metadata including stored token program keys and vault bumps (`state/pool.rs`). The remaining work is wiring these together into a swap instruction with direction-based routing, reentrancy protection, slippage enforcement, and event emission.

The primary complexity is the direction-aware account routing: a single `SwapSolPool` account struct serves both AtoB and BtoA directions, and the instruction handler must dynamically select input/output vaults, mints, and token programs based on the `SwapDirection` enum argument. The transfer helpers already accept raw `AccountInfo` parameters, which supports this dynamic dispatch cleanly.

**Primary recommendation:** Build a single `swap_sol_pool` instruction with a `SwapDirection` enum argument. Use the existing transfer helpers (`transfer_t22_checked`, `transfer_spl`) for token movement, the existing math functions for swap computation, and a bool reentrancy guard on `PoolState` for defense-in-depth protection.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework | Already in use; provides `#[account]`, `#[event]`, `emit!`, PDA derivation |
| anchor-spl | 0.32.1 | Token interface types | Already in use; provides `InterfaceAccount<TokenAccount/Mint>`, `Interface<TokenInterface>` |
| spl-token | (via anchor-spl) | SPL Token program ID | Already referenced for WSOL-side transfers |
| spl-token-2022 | (via anchor-spl) | Token-2022 program ID | Already referenced for T22-side transfers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| litesvm | 0.9.1 | Integration testing | Already in dev-deps; test swap instruction with real token programs |
| proptest | (already in dev-deps) | Property-based testing | Already used in math module; not needed for swap instruction tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `InterfaceAccount` for vaults | Raw `AccountInfo` with manual deser | InterfaceAccount gives free type checking at Anchor constraint level; use it |
| `Interface<TokenInterface>` for programs | `UncheckedAccount` + manual validation | Interface gives free program ID validation; use it |

## Architecture Patterns

### Recommended File Structure
```
programs/amm/src/
├── instructions/
│   ├── mod.rs                    # Add swap_sol_pool module
│   ├── initialize_admin.rs       # Existing
│   ├── initialize_pool.rs        # Existing (reference pattern)
│   └── swap_sol_pool.rs          # NEW: swap instruction handler + accounts
├── state/
│   └── pool.rs                   # MODIFY: add `locked: bool` field
├── helpers/
│   ├── math.rs                   # Existing (consumed, not modified)
│   └── transfers.rs              # Existing (consumed, not modified)
├── errors.rs                     # MODIFY: add swap-specific errors
├── events.rs                     # MODIFY: add SwapEvent
├── constants.rs                  # Existing (consumed, not modified)
└── lib.rs                        # MODIFY: add swap_sol_pool entry point
```

### Pattern 1: Direction-Based Dynamic Routing

**What:** Single account struct with direction enum; handler dynamically selects input/output accounts.

**When to use:** When the same instruction handles both swap directions (AtoB/BtoA) through the same pool.

**Why:** The 11-CONTEXT.md locks this decision -- direction enum argument, not separate instructions or account ordering inference.

```rust
// SwapDirection enum (new type)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SwapDirection {
    AtoB,  // Token A in, Token B out
    BtoA,  // Token B in, Token A out
}

// In handler: select input/output based on direction
let (reserve_in, reserve_out, input_vault, output_vault, input_mint, output_mint,
     input_token_program, output_token_program, input_decimals, output_decimals) =
    match direction {
        SwapDirection::AtoB => (
            pool.reserve_a, pool.reserve_b,
            &ctx.accounts.vault_a, &ctx.accounts.vault_b,
            &ctx.accounts.mint_a, &ctx.accounts.mint_b,
            &ctx.accounts.token_program_a, &ctx.accounts.token_program_b,
            ctx.accounts.mint_a.decimals, ctx.accounts.mint_b.decimals,
        ),
        SwapDirection::BtoA => (
            pool.reserve_b, pool.reserve_a,
            &ctx.accounts.vault_b, &ctx.accounts.vault_a,
            &ctx.accounts.mint_b, &ctx.accounts.mint_a,
            &ctx.accounts.token_program_b, &ctx.accounts.token_program_a,
            ctx.accounts.mint_b.decimals, ctx.accounts.mint_a.decimals,
        ),
    };
```

**Confidence:** HIGH -- follows directly from locked decision in 11-CONTEXT.md.

### Pattern 2: Account Struct by Pool Position (a/b)

**What:** Name accounts by pool position (vault_a, vault_b, mint_a, mint_b) not by role (input_vault, output_vault).

**When to use:** When both directions share the same account struct.

**Why:** Anchor constraints validate accounts at deserialization time. Constraints reference pool state fields (`pool.vault_a`, `pool.mint_a`) which are stored by position. Using position-based names means constraints read naturally: `constraint = vault_a.key() == pool.vault_a`. Role-based naming would require direction-conditional constraints, which Anchor does not support at the constraint level.

```rust
#[derive(Accounts)]
pub struct SwapSolPool<'info> {
    // Pool state -- mut for reserve updates and reentrancy guard
    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
        constraint = pool.initialized @ AmmError::PoolNotInitialized,
        constraint = !pool.locked @ AmmError::PoolLocked,
    )]
    pub pool: Account<'info, PoolState>,

    // Vaults -- validated against pool state
    #[account(
        mut,
        constraint = vault_a.key() == pool.vault_a @ AmmError::VaultMismatch,
    )]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_b.key() == pool.vault_b @ AmmError::VaultMismatch,
    )]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,

    // Mints -- validated against pool state
    #[account(constraint = mint_a.key() == pool.mint_a @ AmmError::InvalidMint)]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(constraint = mint_b.key() == pool.mint_b @ AmmError::InvalidMint)]
    pub mint_b: InterfaceAccount<'info, Mint>,

    // User token accounts -- both sides needed regardless of direction
    #[account(mut)]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,

    // User signer (authority for user-to-vault transfers)
    pub user: Signer<'info>,

    // Token programs -- validated against pool state
    #[account(constraint = token_program_a.key() == pool.token_program_a @ AmmError::InvalidTokenProgram)]
    pub token_program_a: Interface<'info, TokenInterface>,

    #[account(constraint = token_program_b.key() == pool.token_program_b @ AmmError::InvalidTokenProgram)]
    pub token_program_b: Interface<'info, TokenInterface>,
}
```

**Confidence:** HIGH -- follows from existing `InitializePool` pattern and pool state field naming.

### Pattern 3: PDA Signer Seeds for Vault-to-User Transfers

**What:** Pool PDA signs outbound transfers using stored bump seed.

**When to use:** Every swap output transfer (vault to user).

```rust
// Pool PDA signs vault-to-user transfers
let pool_seeds: &[&[u8]] = &[
    POOL_SEED,
    pool.mint_a.as_ref(),
    pool.mint_b.as_ref(),
    &[pool.bump],
];
let signer_seeds: &[&[&[u8]]] = &[pool_seeds];

// For T22 token (CRIME/FRAUD) output:
transfer_t22_checked(
    &output_token_program.to_account_info(),
    &output_vault.to_account_info(),
    &output_mint.to_account_info(),
    &user_output.to_account_info(),
    &pool.to_account_info(),  // PDA authority
    amount_out,
    output_decimals,
    signer_seeds,
    hook_accounts,  // from remaining_accounts
)?;

// For SPL (WSOL) output:
transfer_spl(
    &output_token_program.to_account_info(),
    &output_vault.to_account_info(),
    &output_mint.to_account_info(),
    &user_output.to_account_info(),
    &pool.to_account_info(),  // PDA authority
    amount_out,
    output_decimals,
    signer_seeds,
)?;
```

**Confidence:** HIGH -- matches existing transfer helper signatures and InitializePool PDA pattern.

### Pattern 4: Transfer Hook Account Forwarding via remaining_accounts

**What:** Client resolves ExtraAccountMetaList entries off-chain, passes them as `remaining_accounts`. Instruction forwards to T22 transfer helper.

**When to use:** Any T22 token transfer in the swap (CRIME or FRAUD side).

```rust
// In handler: forward remaining_accounts to T22 transfer helper
let hook_accounts = ctx.remaining_accounts;

// The transfer_t22_checked helper already handles this:
// - Accepts &[AccountInfo<'info>] as hook_accounts parameter
// - Calls cpi_ctx.with_remaining_accounts(hook_accounts.to_vec())
// - Token-2022 internally CPIs to the hook program with these accounts
```

**Important for mixed pools:** Only the T22 side (CRIME/FRAUD) needs hook accounts. The SPL side (WSOL) has no hooks. All `remaining_accounts` are for the T22 transfer. The `transfer_spl` helper ignores `remaining_accounts` entirely.

**Confidence:** HIGH -- existing `transfer_t22_checked` already implements this pattern (see `helpers/transfers.rs` line 78-80).

### Pattern 5: Instruction Args -- `amount_in + direction`

**What:** Instruction takes `amount_in: u64`, `direction: SwapDirection`, `minimum_amount_out: u64`.

**Why:** Consistent with the direction enum decision. The caller declares how much they're putting in and which direction. The AMM computes the output. `minimum_amount_out` provides slippage protection.

```rust
pub fn handler(
    ctx: Context<SwapSolPool>,
    amount_in: u64,
    direction: SwapDirection,
    minimum_amount_out: u64,
) -> Result<()> {
    // ...
}
```

**Confidence:** HIGH -- follows from locked decisions in 11-CONTEXT.md.

### Anti-Patterns to Avoid

- **Inferring direction from account ordering:** Locked out by 11-CONTEXT.md. Direction must be an explicit enum argument, not derived from which account is "first."
- **Separate instructions per direction:** Would double the instruction surface area. Single instruction with direction enum is locked.
- **Direction-conditional Anchor constraints:** Anchor constraints are evaluated at deserialization before the handler runs. They cannot branch on instruction args. All constraint validation must be direction-agnostic (validate by pool position), with direction-specific logic in the handler body.
- **Updating reserves before computing output:** The math functions take current reserves as input. Reserves must be read before swap math, then updated after computation. Do NOT modify reserves between the fee calculation and the output calculation.
- **Forgetting to add `amount_in` (pre-fee) to reserves:** The `reserve_in` update uses `amount_in` (the raw input before fee deduction), not `effective_input` (post-fee). The fee stays in the pool as part of the reserve, increasing k. This is how LP fees accrue value.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swap math (fee, output, k-check) | Custom math in instruction handler | `helpers/math.rs` functions | Property-tested with 10K iterations, proven correct |
| T22 token transfer with hooks | Manual CPI construction | `helpers/transfers::transfer_t22_checked` | Already validates program ID, amount > 0, handles hook accounts |
| SPL token transfer | Manual CPI construction | `helpers/transfers::transfer_spl` | Already validates program ID, amount > 0 |
| Token program validation | Manual pubkey comparison in handler | Anchor `constraint` on account struct | Anchor validates at deserialization; handler can trust account types |
| Pool PDA derivation/validation | Manual `Pubkey::find_program_address` | Anchor `seeds` + `bump` constraints | Anchor handles PDA validation automatically |
| Vault ownership validation | Manual owner field checks | Anchor `constraint = vault_a.key() == pool.vault_a` | Pool state stores vault keys; constraint enforces match |

**Key insight:** Phase 8 (math), Phase 9 (pool state/init), and Phase 10 (transfer routing) were specifically designed to be consumed by the swap instruction. The swap handler is primarily orchestration logic that wires these pieces together.

## Common Pitfalls

### Pitfall 1: Forgetting the Reentrancy Guard Clear on Error Paths

**What goes wrong:** If the handler sets `pool.locked = true` but an error occurs before clearing it, the pool stays locked forever (bricked).

**Why it happens:** Early returns, `?` operator propagation, or panics after setting the lock but before clearing it.

**How to avoid:** Set the lock at the very beginning of the handler, and structure the handler so that `pool.locked = false` runs at the end regardless of success or failure. In Anchor, if the transaction reverts, all account mutations revert too (including `locked = true`). So in practice, a reverted transaction does NOT leave the lock set. The lock only persists on successful commit. Still, explicitly clear the lock before `Ok(())` for clarity.

**Warning signs:** Any code path that could `return Err(...)` after setting `locked = true` but before clearing it. Since Solana transactions are atomic (all-or-nothing), this is safe in practice, but the code should still be clean.

### Pitfall 2: Using effective_input Instead of amount_in for Reserve Update

**What goes wrong:** If you add `effective_input` (post-fee amount) to `reserve_in` instead of `amount_in` (pre-fee amount), the fee value disappears from the pool. The k-invariant would still hold, but LP value would not accrue.

**Why it happens:** Confusing "what the swapper sends" (amount_in, the full amount including fee) with "what participates in the price formula" (effective_input, after fee deduction).

**How to avoid:** The reserve update is: `new_reserve_in = reserve_in + amount_in` (NOT `+ effective_input`). The fee is implicitly captured because the pool receives `amount_in` tokens but only computes output based on `effective_input`. The difference (`amount_in - effective_input`) stays in the pool as LP fee revenue.

**Warning signs:** Reserve update line uses `effective_input` instead of `amount_in`.

### Pitfall 3: INIT_SPACE Mismatch After Adding `locked` Field

**What goes wrong:** Adding `locked: bool` to PoolState changes INIT_SPACE from 223 to 224 bytes. If the space constant isn't updated, `initialize_pool` allocates 231 bytes (8 + 223) but needs 232 (8 + 224). The new field would be stored outside allocated space, causing runtime errors.

**Why it happens:** The field is added to the struct but Anchor's `#[derive(InitSpace)]` auto-computes, so the derive handles it. However, any test that hardcodes 223 or 231 will break.

**How to avoid:** Rely on `PoolState::INIT_SPACE` (auto-derived), never hardcode the byte count. After adding the field, verify `initialize_pool`'s space expression still uses `8 + PoolState::INIT_SPACE`. Document this as a formal spec deviation (11-CONTEXT.md already flags it).

**Warning signs:** Hardcoded space values in tests or instruction code.

### Pitfall 4: Passing Hook Accounts to SPL Transfer

**What goes wrong:** If `remaining_accounts` (hook accounts for T22) are accidentally forwarded to the SPL transfer helper, the CPI would include unexpected accounts. SPL Token ignores them, but it wastes compute and signals a logic bug.

**Why it happens:** Symmetric treatment of both sides when only the T22 side needs hook accounts.

**How to avoid:** The existing `transfer_spl` helper does not accept hook accounts at all (different function signature from `transfer_t22_checked`). The type system prevents this mistake. When calling transfers, use `transfer_t22_checked` for the T22 side (with hook accounts) and `transfer_spl` for the SPL side (no hook accounts parameter).

**Warning signs:** Any attempt to pass `remaining_accounts` to the SPL transfer path.

### Pitfall 5: Direction Enum Serialization Mismatch

**What goes wrong:** Client sends wrong byte for `SwapDirection`, causing AtoB to be interpreted as BtoA or vice versa.

**Why it happens:** Anchor serializes enums as a single u8 variant index (0 = first variant, 1 = second). If client and program disagree on ordering, swaps go the wrong direction.

**How to avoid:** Define the enum with explicit ordering: `AtoB` = variant 0, `BtoA` = variant 1. Document the IDL mapping. Test both directions explicitly.

**Warning signs:** Swap test passes but tokens move in the unexpected direction.

### Pitfall 6: Slippage Check Placement

**What goes wrong:** If slippage check happens before transfers, a transfer hook could theoretically manipulate state between the check and the actual transfer, invalidating the slippage guarantee.

**Why it happens:** Premature optimization or habit from EVM where checks come first.

**How to avoid:** Compute `amount_out` from math, then check `amount_out >= minimum_amount_out` BEFORE any transfers. Since `amount_out` is a pure math result (not a token balance query), transfer hooks cannot affect it. The computed amount is exactly what gets transferred. This ordering is safe.

**Warning signs:** Checking slippage against actual vault balance changes instead of computed math output.

## Code Examples

### Swap Handler Flow (Pseudocode)

```rust
pub fn handler(
    ctx: Context<SwapSolPool>,
    amount_in: u64,
    direction: SwapDirection,
    minimum_amount_out: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // === CHECKS ===

    // 1. Reentrancy guard (defense-in-depth)
    require!(!pool.locked, AmmError::PoolLocked);
    pool.locked = true;

    // 2. Input validation
    require!(amount_in > 0, AmmError::ZeroAmount);

    // 3. Direction-based account selection
    let (reserve_in, reserve_out, /* ... accounts ... */) = match direction { /* ... */ };

    // 4. Swap math
    let effective_input = calculate_effective_input(amount_in, pool.lp_fee_bps)
        .ok_or(AmmError::Overflow)?;
    let amount_out = calculate_swap_output(reserve_in, reserve_out, effective_input)
        .ok_or(AmmError::Overflow)?;

    // 5. Slippage protection
    require!(amount_out >= minimum_amount_out, AmmError::SlippageExceeded);

    // 6. Compute LP fee for event (amount_in - effective_input as u64)
    let lp_fee = amount_in
        .checked_sub(u64::try_from(effective_input).map_err(|_| AmmError::Overflow)?)
        .ok_or(AmmError::Overflow)?;

    // === EFFECTS (reserve updates) ===

    // 7. Update reserves (amount_in is pre-fee -- fee stays in pool)
    let new_reserve_in = reserve_in.checked_add(amount_in).ok_or(AmmError::Overflow)?;
    let new_reserve_out = reserve_out.checked_sub(amount_out).ok_or(AmmError::Overflow)?;

    // 8. Verify k-invariant
    let k_valid = verify_k_invariant(reserve_in, reserve_out, new_reserve_in, new_reserve_out)
        .ok_or(AmmError::Overflow)?;
    require!(k_valid, AmmError::KInvariantViolation);

    // 9. Write new reserves to pool state
    match direction {
        SwapDirection::AtoB => {
            pool.reserve_a = new_reserve_in;
            pool.reserve_b = new_reserve_out;
        }
        SwapDirection::BtoA => {
            pool.reserve_b = new_reserve_in;
            pool.reserve_a = new_reserve_out;
        }
    }

    // === INTERACTIONS (token transfers) ===

    // 10. Build PDA signer seeds
    let pool_seeds: &[&[u8]] = &[
        POOL_SEED,
        pool.mint_a.as_ref(),
        pool.mint_b.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[pool_seeds];

    // 11. Transfer input: user -> vault (user signs)
    //     Route through transfer_t22_checked or transfer_spl based on input token program

    // 12. Transfer output: vault -> user (pool PDA signs)
    //     Route through transfer_t22_checked or transfer_spl based on output token program

    // === POST-INTERACTION ===

    // 13. Clear reentrancy guard
    pool.locked = false;

    // 14. Emit swap event
    emit!(SwapEvent { /* fields */ });

    Ok(())
}
```

**Confidence:** HIGH -- assembles verified patterns from existing codebase.

### SwapEvent Structure

```rust
#[event]
pub struct SwapEvent {
    /// The pool PDA address.
    pub pool: Pubkey,
    /// The user who initiated the swap.
    pub user: Pubkey,
    /// Mint of the input token.
    pub input_mint: Pubkey,
    /// Mint of the output token.
    pub output_mint: Pubkey,
    /// Amount of input token (pre-fee).
    pub amount_in: u64,
    /// Amount of output token sent to user.
    pub amount_out: u64,
    /// LP fee deducted (in input token units).
    pub lp_fee: u64,
    /// Post-swap reserve of token A.
    pub reserve_a: u64,
    /// Post-swap reserve of token B.
    pub reserve_b: u64,
    /// Swap direction (0 = AtoB, 1 = BtoA).
    pub direction: u8,
    /// Unix timestamp from Clock sysvar.
    pub timestamp: i64,
    /// Slot from Clock sysvar.
    pub slot: u64,
}
```

**Note on lp_fee_bps:** The 11-CONTEXT.md states "Fee rate (lp_fee_bps) omitted from event -- it's immutable on pool state, query once and cache." However, user memory indicates a preference to include `lp_fee_bps` in SwapEvent for DX. **Recommendation to planner:** Include `lp_fee_bps: u16` in the SwapEvent. It's 2 bytes and saves every indexer from needing a separate pool state query. This is Claude's discretion per the CONTEXT.md.

### New Error Variants Needed

```rust
#[error_code]
pub enum AmmError {
    // ... existing variants ...

    // --- Phase 11: Swap errors ---

    /// Output amount is less than the user's minimum.
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    /// Pool has not been initialized with liquidity.
    #[msg("Pool is not initialized")]
    PoolNotInitialized,

    /// Pool is currently locked (reentrancy guard active).
    #[msg("Pool is locked")]
    PoolLocked,

    /// Vault account does not match the pool's stored vault.
    #[msg("Vault does not match pool state")]
    VaultMismatch,

    /// Mint account does not match the pool's stored mint.
    #[msg("Mint does not match pool state")]
    InvalidMint,
}
```

**Confidence:** HIGH -- error names follow Anchor conventions and map to spec Section 12 requirements.

### Transfer Routing Logic for Mixed Pools

```rust
// Determine if a token program is T22 or SPL
fn is_t22(token_program_key: &Pubkey) -> bool {
    *token_program_key == anchor_spl::token_2022::ID
}

// In the swap handler, after computing amount_in and amount_out:

// Input transfer: user -> vault (user signs, no PDA signer seeds)
if is_t22(&input_token_program.key()) {
    transfer_t22_checked(
        &input_token_program.to_account_info(),
        &user_input_account.to_account_info(),
        &input_mint.to_account_info(),
        &input_vault.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        amount_in,
        input_decimals,
        &[],  // user signs directly
        ctx.remaining_accounts,  // hook accounts
    )?;
} else {
    transfer_spl(
        &input_token_program.to_account_info(),
        &user_input_account.to_account_info(),
        &input_mint.to_account_info(),
        &input_vault.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        amount_in,
        input_decimals,
        &[],  // user signs directly
    )?;
}

// Output transfer: vault -> user (pool PDA signs)
if is_t22(&output_token_program.key()) {
    transfer_t22_checked(
        &output_token_program.to_account_info(),
        &output_vault.to_account_info(),
        &output_mint.to_account_info(),
        &user_output_account.to_account_info(),
        &pool_account_info,  // pool PDA as authority
        amount_out,
        output_decimals,
        signer_seeds,  // PDA signs
        ctx.remaining_accounts,  // hook accounts
    )?;
} else {
    transfer_spl(
        &output_token_program.to_account_info(),
        &output_vault.to_account_info(),
        &output_mint.to_account_info(),
        &user_output_account.to_account_info(),
        &pool_account_info,  // pool PDA as authority
        amount_out,
        output_decimals,
        signer_seeds,  // PDA signs
    )?;
}
```

**Important nuance for mixed pools:** In CRIME/SOL or FRAUD/SOL pools, exactly one side is T22 (CRIME or FRAUD) and one side is SPL (WSOL). The `remaining_accounts` (hook accounts) are only consumed by the T22 transfer. For a given swap direction, either:
- **AtoB (T22 -> SPL):** Input transfer needs hook accounts, output transfer does not.
- **BtoA (SPL -> T22):** Input transfer does not need hook accounts, output transfer does.

The same `remaining_accounts` slice is passed to both `transfer_t22_checked` calls (only one executes per direction since only one side is T22 in a mixed pool). The `transfer_spl` call has no hook accounts parameter.

**Confidence:** HIGH -- verified against existing transfer helper signatures.

### PoolState Modification (locked field)

```rust
// PoolState with new locked field
#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub pool_type: PoolType,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub lp_fee_bps: u16,
    pub initialized: bool,
    pub locked: bool,       // NEW: reentrancy guard (1 byte)
    pub bump: u8,
    pub vault_a_bump: u8,
    pub vault_b_bump: u8,
    pub token_program_a: Pubkey,
    pub token_program_b: Pubkey,
}
// INIT_SPACE: 223 + 1 = 224 bytes
// Account allocation: 8 (discriminator) + 224 = 232 bytes
```

**Spec deviation:** INIT_SPACE changes from 223 to 224 bytes. The `initialize_pool` instruction uses `8 + PoolState::INIT_SPACE` in its space expression, so it auto-adjusts. But tests that hardcode 223 or 231 will break.

**Confidence:** HIGH -- locked decision in 11-CONTEXT.md.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Account<'info, Token>` (single program) | `InterfaceAccount<'info, TokenAccount>` (multi-program) | Anchor 0.30+ | Supports both SPL Token and Token-2022 in one account type |
| Manual ExtraAccountMeta resolution | `with_remaining_accounts` on CpiContext | anchor-spl 0.30+ | Clean hook account forwarding pattern |
| `transfer` (plain) for T22 | `transfer_checked` (always) | Token-2022 design requirement | Plain transfer silently skips hooks; transfer_checked enforces them |

## Open Questions

### 1. remaining_accounts Ordering When Both Transfers Need Hooks

**What we know:** In a mixed pool, only one side (T22) needs hook accounts. All `remaining_accounts` go to that one T22 transfer. This is simple.

**What's unclear:** In Phase 12 (PROFIT pool swaps), both sides are T22 and both transfers need hook accounts. Will we need to split `remaining_accounts` between the two transfers? The current helpers take `&[AccountInfo]` so splitting is possible, but the split boundary must be known.

**Recommendation:** For Phase 11, pass all `remaining_accounts` to the single T22 transfer. Document that Phase 12 will need a `remaining_accounts` splitting convention (e.g., first N accounts for transfer A, rest for transfer B, with N passed as an instruction arg or derived from mint metadata). This is strictly Phase 12's problem.

### 2. Clock Sysvar Access for Event Timestamp/Slot

**What we know:** The SwapEvent requires both `timestamp` (i64) and `slot` (u64) per 11-CONTEXT.md. These come from the `Clock` sysvar.

**What's unclear:** Whether to use `Clock::get()` (runtime sysvar, no account needed) or pass Clock as an account. `Clock::get()` is the modern approach and avoids an extra account in the instruction.

**Recommendation:** Use `Clock::get()` in the handler. It's cheaper (no account deserialization) and works in all contexts including CPI. Example: `let clock = Clock::get()?; let timestamp = clock.unix_timestamp; let slot = clock.slot;`

**Confidence:** HIGH -- `Clock::get()` has been the standard approach since Solana 1.8+.

### 3. User Token Account Ownership Validation

**What we know:** The swap instruction takes user_token_a and user_token_b accounts. Anchor's `InterfaceAccount<TokenAccount>` validates the account is a valid token account, but does NOT automatically verify that `user_token_a.owner == user.key()` (token account owner vs transaction signer).

**What's unclear:** Whether to add explicit `constraint = user_token_a.owner == user.key()` or rely on the token program rejecting unauthorized transfers.

**Recommendation:** Do NOT add ownership constraints on user token accounts. The token program's `transfer_checked` already validates that the `authority` signer has rights over the `from` account. Adding redundant constraints wastes compute. The user signs as authority; if the token account doesn't belong to them, the CPI fails. This follows the existing `InitializePool` pattern which does not constrain source account ownership.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `programs/amm/src/` -- all modules read and verified
- `Docs/AMM_Implementation.md` -- Sections 8-18 (swap math, transfers, execution flow, accounts, errors, events, security)
- `.planning/phases/11-sol-pool-swaps/11-CONTEXT.md` -- locked decisions for Phase 11
- Solana Anchor Framework MCP expert -- CEI ordering, emit! macro, account struct patterns

### Secondary (MEDIUM confidence)
- Solana Documentation MCP -- reentrancy patterns, PDA signing, Clock sysvar

### Tertiary (LOW confidence)
- None. All findings verified against codebase or authoritative MCP sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in Cargo.toml, versions confirmed
- Architecture: HIGH -- patterns derived from existing codebase (InitializePool) and locked decisions
- Pitfalls: HIGH -- derived from analyzing actual code paths and math module behavior

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (stable domain, no expected breaking changes in Anchor 0.32.x)
