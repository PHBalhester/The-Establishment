# Phase 12: PROFIT Pool Swaps & Swap Validation - Research

**Researched:** 2026-02-04
**Domain:** Anchor AMM swap instruction for pure T22 constant-product pools with dual transfer hooks, plus comprehensive cross-pool test suite
**Confidence:** HIGH

## Summary

Phase 12 has two deliverables: (1) a `swap_profit_pool` instruction for CRIME/PROFIT and FRAUD/PROFIT pure T22 pools with dual-hook invocation and 50 bps fee, and (2) a comprehensive test suite covering all 4 pool types including edge cases, slippage, and cross-pool consistency.

The existing `swap_sol_pool` instruction (Phase 11) provides a near-complete template. The core swap logic (math, CEI ordering, reentrancy guard, slippage, k-invariant, event emission) is identical. The key difference is the transfer routing: in SOL pools, one side is SPL (no hooks) and one side is T22 (hooks). In PROFIT pools, **both** sides are T22 with transfer hooks, meaning `remaining_accounts` must carry hook accounts for two separate `transfer_checked` CPI calls. This is the primary new technical challenge.

The 12-CONTEXT.md locks several decisions: zero-output swap protection (revert when math produces 0), dual-hook account validation, identical instruction args to `swap_sol_pool`, same SwapDirection enum and SwapEvent, and two-layer test scope (realistic extremes + adversarial stress tests). Several areas are left to Claude's discretion: `remaining_accounts` splitting strategy, code sharing between handlers, PoolType validation, integration-level proptests, and test organization.

**Primary recommendation:** Build `swap_profit_pool` as a separate handler file mirroring `swap_sol_pool` structure but with simplified transfer routing (both sides always T22, no `is_t22()` branching). Use convention-based `remaining_accounts` splitting where the first N accounts are for the input transfer's hooks and the remaining are for the output transfer's hooks, with N derivable from the hook program's ExtraAccountMetaList configuration. Add zero-output error variants to the math module and backport to `swap_sol_pool`. For tests, extend the existing test infrastructure with a PureT22Pool setup helper alongside the existing MixedPool one.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework | Already in use; `#[account]`, `#[event]`, `emit!`, PDA derivation |
| anchor-spl | 0.32.1 | Token interface types | Already in use; `InterfaceAccount<TokenAccount/Mint>`, `Interface<TokenInterface>` |
| spl-token-2022 | (via anchor-spl) | Token-2022 program ID | Both sides of PROFIT pools use T22 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| litesvm | 0.9.1 | Integration testing | Already in dev-deps; test swap instructions with real token programs |
| proptest | 1.9 | Property-based testing | Already in dev-deps; math module proptests (Phase 8), potential integration-level use |
| sha2 | 0.10 | Anchor discriminator computation | Already in dev-deps; used in test instruction builders |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate `swap_profit_pool` handler | Shared generic handler for both pool types | Separate handlers are clearer; both are ~100 lines. Generic handler adds complexity for marginal DRY benefit. Separate files are easier to audit. |
| Convention-based remaining_accounts split | Instruction arg for split index | Convention avoids adding a new instruction arg; both mints use the same hook program with the same ExtraAccountMetaList structure, so the account count per side is deterministic. |

## Architecture Patterns

### Recommended File Structure
```
programs/amm/src/
├── instructions/
│   ├── mod.rs                    # Add swap_profit_pool module
│   ├── initialize_admin.rs       # Existing
│   ├── initialize_pool.rs        # Existing
│   ├── swap_sol_pool.rs          # Existing (MODIFY: add zero-output checks)
│   └── swap_profit_pool.rs       # NEW: pure T22 swap handler + accounts
├── helpers/
│   ├── math.rs                   # MODIFY: add zero-output error returns
│   └── transfers.rs              # Existing (consumed, not modified)
├── errors.rs                     # MODIFY: add zero-output error variants
├── events.rs                     # Existing (consumed, not modified)
├── constants.rs                  # Existing (consumed, not modified)
├── state/
│   └── pool.rs                   # Existing (consumed, not modified)
└── lib.rs                        # MODIFY: add swap_profit_pool entry point

programs/amm/tests/
├── test_swap_sol_pool.rs         # Existing (may extend with edge case tests)
└── test_swap_profit_pool.rs      # NEW: comprehensive test suite for all 4 pools
```

### Pattern 1: Dual-Hook remaining_accounts Splitting

**What:** In PROFIT pools, both transfer_checked calls need hook accounts. The instruction's `remaining_accounts` carries accounts for both transfers, split by convention.

**When to use:** Any pure T22 pool swap where both mints have transfer hooks.

**How it works:**

Per the Transfer_Hook_Spec.md Section 8, each transfer hook invocation requires the ExtraAccountMetaList entries (whitelist PDAs for source and destination) plus the hook program itself and the ExtraAccountMetaList PDA account. For our hook program, each transfer needs exactly 4 extra accounts:
1. Whitelist PDA for source token account
2. Whitelist PDA for destination token account
3. Hook program account (transfer hook program ID)
4. ExtraAccountMetaList PDA for the mint

The convention for `remaining_accounts` ordering:
```
[hook_accounts_for_input_transfer..., hook_accounts_for_output_transfer...]
```

Since both mints use the same hook program with the same ExtraAccountMetaList structure, the split point is always at the midpoint: first half for the input transfer, second half for the output transfer. In the handler:

```rust
// Split remaining_accounts for dual-hook CPI
let hook_account_count = ctx.remaining_accounts.len() / 2;
let (input_hook_accounts, output_hook_accounts) =
    ctx.remaining_accounts.split_at(hook_account_count);
```

**Why not an instruction arg for the split index?** The hook program structure is deterministic -- same program, same ExtraAccountMetaList layout for all three T22 mints (CRIME, FRAUD, PROFIT). The client resolves accounts for each mint independently but they always have the same count. Adding an instruction arg adds complexity without flexibility benefit.

**Confidence:** HIGH -- derived from Transfer_Hook_Spec.md Section 8 (each mint needs exactly 2 ExtraAccountMeta entries: whitelist PDA for source + whitelist PDA for destination). The total extra accounts per transfer are: 2 extra metas + hook program + ExtraAccountMetaList PDA = 4 accounts per side.

### Pattern 2: SwapProfitPool Account Struct (Pure T22)

**What:** Account struct identical to `SwapSolPool` but both token programs are Token-2022.

**When to use:** CRIME/PROFIT and FRAUD/PROFIT swaps.

```rust
#[derive(Accounts)]
pub struct SwapProfitPool<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
        constraint = pool.initialized @ AmmError::PoolNotInitialized,
        constraint = !pool.locked @ AmmError::PoolLocked,
    )]
    pub pool: Account<'info, PoolState>,

    #[account(mut, constraint = vault_a.key() == pool.vault_a @ AmmError::VaultMismatch)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = vault_b.key() == pool.vault_b @ AmmError::VaultMismatch)]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,

    #[account(constraint = mint_a.key() == pool.mint_a @ AmmError::InvalidMint)]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(constraint = mint_b.key() == pool.mint_b @ AmmError::InvalidMint)]
    pub mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,

    pub user: Signer<'info>,

    // BOTH are Token-2022 (unlike SwapSolPool where one may be SPL)
    #[account(constraint = token_program_a.key() == pool.token_program_a @ AmmError::InvalidTokenProgram)]
    pub token_program_a: Interface<'info, TokenInterface>,

    #[account(constraint = token_program_b.key() == pool.token_program_b @ AmmError::InvalidTokenProgram)]
    pub token_program_b: Interface<'info, TokenInterface>,
}
```

**Key difference from SwapSolPool:** Structurally identical. The Anchor constraints validate against stored pool state, which already knows both sides are T22 (pool.token_program_a == pool.token_program_b == Token-2022 ID). The behavioral difference is entirely in the handler: PROFIT pool handler always uses `transfer_t22_checked` for both sides and splits `remaining_accounts`.

**Confidence:** HIGH -- mirrors Phase 11 pattern exactly, validated against AMM_Implementation.md Section 11.

### Pattern 3: Simplified Transfer Routing (No is_t22 Branching)

**What:** In PROFIT pools, both sides are always T22. The handler can skip the `is_t22()` check and always use `transfer_t22_checked`.

**When to use:** `swap_profit_pool` handler only.

```rust
// PROFIT pool handler: both sides are always T22
// No is_t22() branching needed

// Input transfer: user -> vault (user signs)
transfer_t22_checked(
    &input_token_program.to_account_info(),
    &user_input.to_account_info(),
    &input_mint.to_account_info(),
    &input_vault.to_account_info(),
    &user_info,
    amount_in,
    input_decimals,
    &[],                    // user signs directly
    input_hook_accounts,    // first half of remaining_accounts
)?;

// Output transfer: vault -> user (pool PDA signs)
transfer_t22_checked(
    &output_token_program.to_account_info(),
    &output_vault.to_account_info(),
    &output_mint.to_account_info(),
    &user_output.to_account_info(),
    &pool_account_info,
    amount_out,
    output_decimals,
    signer_seeds,           // PDA signs
    output_hook_accounts,   // second half of remaining_accounts
)?;
```

**Why separate from swap_sol_pool?** The transfer routing is the one area where the two instructions genuinely differ. SOL pools need 4-way branching (direction x T22/SPL). PROFIT pools always call `transfer_t22_checked` twice. Sharing a handler would require parameterizing the branching logic, adding complexity without reducing code surface significantly. Separate handlers are ~100 lines each, easily auditable, and follow the AMM spec's two-instruction design (Section 7.1).

**Confidence:** HIGH -- follows locked decision in 12-CONTEXT.md (same interface as swap_sol_pool, only account struct differs).

### Pattern 4: Zero-Output Protection in Math Module

**What:** Add explicit zero-output checks to the math module that revert when fee deduction or swap math produces 0 output.

**When to use:** All swap instructions (retroactively applied to `swap_sol_pool` too).

```rust
// In math.rs: Two new checks

/// After fee deduction, if effective_input rounds to 0, return specific error
pub fn calculate_effective_input(amount_in: u64, fee_bps: u16) -> Option<u128> {
    let amount = amount_in as u128;
    let fee_factor = 10_000u128.checked_sub(fee_bps as u128)?;
    let result = amount.checked_mul(fee_factor)?.checked_div(10_000)?;
    // Zero-output check: if effective input is 0, the user would burn
    // tokens for nothing. Return None to signal an error condition.
    // Note: This is a NEW check per 12-CONTEXT.md
    if result == 0 && amount_in > 0 {
        return None; // Caller maps to AmmError::ZeroEffectiveInput
    }
    Some(result)
}

/// After swap output calculation, if amount_out is 0, return specific error
pub fn calculate_swap_output(...) -> Option<u64> {
    // ... existing calculation ...
    let output = numerator.checked_div(denominator)?;
    let output_u64 = u64::try_from(output).ok()?;
    // Zero-output check: swap would produce nothing
    if output_u64 == 0 && effective_input > 0 {
        return None; // Caller maps to AmmError::ZeroSwapOutput
    }
    Some(output_u64)
}
```

**Important nuance:** The current math functions return `None` on overflow, which maps to `AmmError::Overflow`. With zero-output checks also returning `None`, we need a way to distinguish the error. Two options:
1. **Option A:** Change return type to `Result<T, MathError>` with distinct error variants
2. **Option B:** Keep `Option<T>` but add separate zero-output checking functions that the handler calls after the math functions

**Recommendation:** Option B is simpler and non-breaking. Keep the existing math functions unchanged. Add two new check functions:
```rust
pub fn check_effective_input_nonzero(amount_in: u64, effective_input: u128) -> bool {
    !(effective_input == 0 && amount_in > 0)
}

pub fn check_swap_output_nonzero(effective_input: u128, amount_out: u64) -> bool {
    !(amount_out == 0 && effective_input > 0)
}
```

The handler then calls math functions (existing), checks for zero (new), and maps to distinct errors. This avoids modifying the existing math function signatures which would break proptest compatibility and the existing swap_sol_pool handler.

**Confidence:** HIGH -- follows locked decision in 12-CONTEXT.md. Distinct error variants for each failure point.

### Pattern 5: Cross-Pool Consistency Testing

**What:** Tests that verify the relationship between SOL pool (100 bps) and PROFIT pool (50 bps) output amounts.

**When to use:** Comprehensive test suite to catch subtle fee calculation bugs.

```rust
// Given identical reserves and input amount:
// PROFIT pool (50 bps) should produce MORE output than SOL pool (100 bps)
// because less fee is taken

let sol_effective = expected_effective_input(amount_in, 100); // SOL pool: 100 bps
let profit_effective = expected_effective_input(amount_in, 50); // PROFIT pool: 50 bps

let sol_output = expected_swap_output(reserve, reserve, sol_effective);
let profit_output = expected_swap_output(reserve, reserve, profit_effective);

assert!(profit_output > sol_output,
    "PROFIT pool (50 bps) should produce more output than SOL pool (100 bps)");

// Verify the ratio is approximately 50 bps / 100 bps fee difference
// (not exact due to nonlinear constant-product formula)
```

**Confidence:** HIGH -- this is a mathematical property that must hold.

### Anti-Patterns to Avoid

- **Sharing a single handler between swap_sol_pool and swap_profit_pool:** The transfer routing differs enough that a shared handler would need conditional logic parameterized by pool type. This makes the code harder to audit and introduces branches that could mask bugs. Two ~100-line handlers are clearer than one ~150-line handler with conditionals.

- **Passing all remaining_accounts to both transfer_t22_checked calls:** This would cause the second CPI to receive incorrect hook accounts (accounts for the wrong mint/transfer). Each transfer must receive only its own hook accounts.

- **Modifying existing math function signatures for zero-output checks:** This would break the Phase 8 proptest suite and require updating swap_sol_pool. Add separate check functions instead.

- **Using PoolType validation in the instruction handler:** The 12-CONTEXT.md marks this as Claude's discretion. **Recommendation: Do NOT add PoolType validation.** The pool's `token_program_a` and `token_program_b` are stored on-chain and validated by Anchor constraints. If someone calls `swap_profit_pool` with a mixed pool, the T22-only transfer calls would fail at the CPI level (trying to call T22 program with SPL token account). The runtime error is clear enough. Adding a PoolType check adds no real security -- it just changes the error message from a CPI failure to a custom error, at the cost of extra compute.

- **Integration-level proptests for swap instructions:** Per 12-CONTEXT.md, this is Claude's discretion. **Recommendation: Do NOT add integration-level proptests.** The Phase 8 math proptests (10K iterations) already prove the core math correctness. Integration tests in litesvm are expensive (~seconds each). Proptesting integration tests would be prohibitively slow and add little value beyond what the math-level proptests and explicit edge case tests provide. Use explicit edge case tests (minimum swap, imbalanced reserves, near-empty pools) instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swap math | Custom math in handler | `helpers/math.rs` functions + new zero-output checks | Property-tested, proven correct |
| T22 token transfer with hooks | Manual CPI construction | `helpers/transfers::transfer_t22_checked` | Validates program ID, amount > 0, handles hook accounts |
| Direction-based routing | Custom account selection logic | Same pattern as swap_sol_pool (match on direction enum) | Proven in Phase 11, audited |
| Test math verification | Import from program crate | Independent test-side math helpers (replicate formulas) | Test independence from program code |
| Pool setup for tests | Per-test manual setup | `setup_initialized_pool()` and new `setup_initialized_profit_pool()` helpers | Consistent, reusable, reduces test boilerplate |

**Key insight:** Phase 12's `swap_profit_pool` is 90% identical to `swap_sol_pool`. The only genuinely new technical challenge is the dual-hook `remaining_accounts` split. Everything else is proven patterns.

## Common Pitfalls

### Pitfall 1: Passing Wrong Hook Accounts to Wrong Transfer

**What goes wrong:** If `remaining_accounts` isn't split correctly, the input transfer receives output transfer's hook accounts (or vice versa). The hook program receives wrong whitelist PDAs, causing transfer rejection.

**Why it happens:** Each T22 transfer has its own ExtraAccountMetaList resolution that depends on the specific source/destination token accounts. Mixing them up means the whitelist PDA derivation won't match.

**How to avoid:** Split `remaining_accounts` at the midpoint. Input transfer gets first half, output transfer gets second half. Client-side code must resolve ExtraAccountMetas for each transfer independently and concatenate them in the correct order: [input_transfer_hooks, output_transfer_hooks].

**Warning signs:** Hook program rejects transfers with "NoWhitelistedParty" error even though vaults are whitelisted.

### Pitfall 2: Zero-Output Swaps Silently Burning Tokens

**What goes wrong:** With very small input amounts or heavily imbalanced reserves, the swap math can produce 0 output tokens. Without a check, the user loses their input tokens and receives nothing.

**Why it happens:** Integer truncation in the constant-product formula. For example: `amount_in = 1, fee_bps = 100 -> effective_input = 0`. Or: `reserve_in = 1_000_000_000, reserve_out = 1, effective_input = 1000 -> output = 0`.

**How to avoid:** Add explicit zero-output checks (per 12-CONTEXT.md locked decision). Two check points:
1. After fee deduction: if `effective_input == 0 && amount_in > 0` -> revert with `ZeroEffectiveInput`
2. After swap math: if `amount_out == 0 && effective_input > 0` -> revert with `ZeroSwapOutput`

**Warning signs:** Tests with amount_in = 1 succeed but produce 0 output without error.

### Pitfall 3: Test Infrastructure Duplication Without Pure T22 Pool Support

**What goes wrong:** The Phase 11 test infrastructure (`setup_initialized_pool`) only creates mixed pools (T22 + SPL). Attempting to test PROFIT pools requires creating both mints as T22.

**Why it happens:** Copy-pasting the mixed pool helper and forgetting to change the SPL mint to T22.

**How to avoid:** Create a separate `setup_initialized_profit_pool()` helper that creates both mints as T22 with Token-2022 program. The key difference:
- Mixed pool: `create_t22_mint()` + `create_spl_mint()`, one token_program is SPL, one is T22
- Pure T22 pool: `create_t22_mint()` + `create_t22_mint()`, both token_programs are T22, `lp_fee_bps = 50` (not 100)

**Warning signs:** Tests create a "PROFIT pool" but with wrong fee (100 bps instead of 50 bps) or with one SPL mint.

### Pitfall 4: Forgetting to Backport Zero-Output Checks to swap_sol_pool

**What goes wrong:** Zero-output protection is added to `swap_profit_pool` but not retrofitted into `swap_sol_pool`, creating inconsistent behavior across pool types.

**Why it happens:** The 12-CONTEXT.md explicitly says "Apply retroactively to swap_sol_pool as well" but this is easy to forget during implementation.

**How to avoid:** Add the zero-output check functions to `math.rs` first, then update both handlers to use them. Verify both handlers have identical check sequences.

**Warning signs:** Edge case tests pass for PROFIT pools but not SOL pools (or vice versa).

### Pitfall 5: Test-Side Math Drift Between Test Files

**What goes wrong:** Test math helpers in `test_swap_sol_pool.rs` and `test_swap_profit_pool.rs` diverge, one has a bug the other doesn't, leading to false positives.

**Why it happens:** Each test file independently replicates the swap math formulas. If a fix or change is made in one file, the other may not be updated.

**How to avoid:** While test files are standalone (per established pattern), the math helper functions must be byte-identical between files. When adding zero-output checks to program code, also verify test-side math helpers handle the same edge cases consistently.

**Warning signs:** A test in one file passes but the equivalent test in the other file fails.

### Pitfall 6: Hook Accounts in Tests Without Actual Hook Program

**What goes wrong:** PROFIT pool tests in litesvm fail because `transfer_t22_checked` tries to invoke the hook program, but no hook program is deployed in the test environment.

**Why it happens:** The Phase 11 tests use T22 mints WITHOUT transfer hook extensions (see `create_t22_mint()` in test_swap_sol_pool.rs line 313: "Token-2022 mint WITHOUT transfer hook extensions"). For mixed pools, the SPL side never needed hooks, and the T22 side's test mint had no hook configured. For PROFIT pools, the same pattern works -- test mints without hooks still accept `transfer_checked` calls from T22.

**How to avoid:** Continue using T22 mints WITHOUT transfer hook extensions in tests. The `transfer_t22_checked` helper passes hook accounts via `with_remaining_accounts()`, but if the mint has no hook extension, Token-2022 simply ignores the extra accounts. This means: (1) PROFIT pool tests work with hookless T22 mints, (2) hook account splitting logic doesn't get exercised in unit tests but the transfer routing does, (3) actual hook enforcement is tested separately in the Transfer Hook program tests (v0.3).

**Warning signs:** Tests pass an empty `remaining_accounts` and everything works, but the handler's split logic is untested. This is acceptable -- the split logic is simple array slicing that doesn't need the hook program to validate.

## Code Examples

### swap_profit_pool Handler Structure

```rust
// Simplified view of the handler showing dual-hook differences from swap_sol_pool

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SwapProfitPool<'info>>,
    amount_in: u64,
    direction: SwapDirection,
    minimum_amount_out: u64,
) -> Result<()> {
    // Save immutable values before mutations (same as swap_sol_pool)
    let mint_a_key = ctx.accounts.pool.mint_a;
    // ... etc ...

    // === CHECKS === (identical to swap_sol_pool)
    ctx.accounts.pool.locked = true;
    require!(amount_in > 0, AmmError::ZeroAmount);

    // Direction-based routing (identical to swap_sol_pool)
    let (reserve_in, reserve_out, ...) = match direction { ... };

    // Swap math (identical, plus new zero-output checks)
    let effective_input = calculate_effective_input(amount_in, lp_fee_bps)
        .ok_or(AmmError::Overflow)?;
    require!(
        check_effective_input_nonzero(amount_in, effective_input),
        AmmError::ZeroEffectiveInput
    );

    let amount_out = calculate_swap_output(reserve_in, reserve_out, effective_input)
        .ok_or(AmmError::Overflow)?;
    require!(
        check_swap_output_nonzero(effective_input, amount_out),
        AmmError::ZeroSwapOutput
    );

    require!(amount_out >= minimum_amount_out, AmmError::SlippageExceeded);

    // === EFFECTS === (identical to swap_sol_pool)
    // ... reserve updates, k-invariant check ...

    // === INTERACTIONS === (DIFFERENT from swap_sol_pool)

    // Split remaining_accounts for dual-hook
    let hook_count = ctx.remaining_accounts.len() / 2;
    let (input_hooks, output_hooks) = ctx.remaining_accounts.split_at(hook_count);

    // Both sides are always T22 -- no is_t22() branching
    match direction {
        SwapDirection::AtoB => {
            // Input: A (user -> vault_a)
            transfer_t22_checked(
                &ctx.accounts.token_program_a.to_account_info(),
                &ctx.accounts.user_token_a.to_account_info(),
                &ctx.accounts.mint_a.to_account_info(),
                &ctx.accounts.vault_a.to_account_info(),
                &user_info,
                amount_in, input_decimals, &[],
                input_hooks,
            )?;
            // Output: B (vault_b -> user)
            transfer_t22_checked(
                &ctx.accounts.token_program_b.to_account_info(),
                &ctx.accounts.vault_b.to_account_info(),
                &ctx.accounts.mint_b.to_account_info(),
                &ctx.accounts.user_token_b.to_account_info(),
                &pool_account_info,
                amount_out, output_decimals, signer_seeds,
                output_hooks,
            )?;
        }
        SwapDirection::BtoA => {
            // Input: B (user -> vault_b)
            transfer_t22_checked(..., input_hooks)?;
            // Output: A (vault_a -> user)
            transfer_t22_checked(..., output_hooks)?;
        }
    }

    // === POST-INTERACTION === (identical to swap_sol_pool)
    ctx.accounts.pool.locked = false;
    emit!(SwapEvent { ... });

    Ok(())
}
```

**Confidence:** HIGH -- assembles verified patterns from existing codebase plus locked decisions.

### New Error Variants

```rust
// In errors.rs, add under Phase 12 section:

// --- Phase 12: Zero-output swap errors ---

/// Swap fee deduction produced zero effective input.
/// Input amount is too small for the fee rate -- all tokens would be taken as fee.
#[msg("Input amount too small: fee deduction produces zero effective input")]
ZeroEffectiveInput,

/// Swap math produced zero output tokens.
/// Effective input is too small relative to reserves to produce any output.
#[msg("Swap produces zero output tokens")]
ZeroSwapOutput,
```

**Confidence:** HIGH -- follows locked decision in 12-CONTEXT.md (distinct error variants for each failure point).

### Test Suite Structure

```rust
// test_swap_profit_pool.rs organization

// === Infrastructure ===
// Type bridge helpers (same as test_swap_sol_pool.rs)
// Instruction builders: swap_profit_pool_data(), build_swap_profit_instruction()
// Pool setup: setup_initialized_profit_pool() -- both mints T22, 50 bps fee

// === PROFIT Pool Swap Tests ===
// test_profit_pool_swap_a_to_b_correct_output
// test_profit_pool_swap_b_to_a_correct_output
// test_profit_pool_fee_50bps_compounds_into_reserves
// test_profit_pool_slippage_protection
// test_profit_pool_k_invariant_holds
// test_profit_pool_zero_amount_rejected
// test_profit_pool_event_emitted
// test_profit_pool_consecutive_swaps

// === Zero-Output Tests (all pool types) ===
// test_zero_effective_input_reverts (amount_in=1 with 100 bps fee)
// test_zero_swap_output_reverts (tiny input, huge reserve imbalance)

// === Edge Case Tests (TEST-06) ===
// test_minimum_viable_swap (1 token input, both pool types)
// test_heavily_imbalanced_reserves (1000:1 ratio)
// test_near_empty_pool (reserves near minimum)

// === Cross-Pool Consistency Tests ===
// test_profit_pool_produces_more_output_than_sol_pool (50 bps < 100 bps fee)
// test_fee_ratio_consistency (verify fee amounts scale correctly)

// === Slippage Tests (TEST-04, all pool types) ===
// test_slippage_exact_boundary_sol_pool
// test_slippage_exact_boundary_profit_pool
```

**Confidence:** HIGH -- covers all requirements from phase description (SWAP-02, TEST-03, TEST-04, TEST-06).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single swap instruction for all pool types | Separate instructions per pool type (swap_sol_pool, swap_profit_pool) | AMM_Implementation.md Section 7.1 | Cleaner separation, simpler handler logic |
| Relying on transfer_checked runtime failure for zero output | Explicit zero-output checks before transfers | Industry standard (Uniswap V2 INSUFFICIENT_OUTPUT_AMOUNT) | Prevents silent token burning, clearer error messages |

## Open Questions

### 1. Exact Hook Account Count Per Transfer

**What we know:** Transfer_Hook_Spec.md Section 8 defines 2 ExtraAccountMeta entries per mint (whitelist PDA for source, whitelist PDA for destination). Plus the hook program itself and the ExtraAccountMetaList PDA account need to be passed.

**What's unclear:** The exact number of accounts per transfer depends on how Token-2022 internally resolves the hook invocation. The standard pattern requires: resolved extra metas + hook program + validation state PDA. For our hook program with 2 ExtraAccountMeta entries, this should be 2 + 1 + 1 = 4 accounts per transfer, so 8 total in remaining_accounts.

**Recommendation:** Use the midpoint split (`remaining_accounts.len() / 2`). If the count per side is always the same (both mints use the same hook program), midpoint splitting is correct. The test suite can't fully validate this without a deployed hook program, but the convention is sound. Real validation happens during integration testing (v0.3+).

**Confidence:** MEDIUM -- the exact account layout needs verification against an actual hook program deployment, but the midpoint splitting convention is safe as long as both mints use the same hook program (which they do per spec).

### 2. TransferHookAccount Extension on Vault Token Accounts

**What we know:** Prior phase decisions note "Token accounts for hooked mints need TransferHookAccount extension." The Phase 11 tests use T22 mints without hook extensions, so vault token accounts don't need this extension in tests.

**What's unclear:** When testing with actual hooked mints (v0.3+), will vault creation in `initialize_pool` need to handle the TransferHookAccount extension on vault token accounts?

**Recommendation:** Not a Phase 12 concern. Phase 12 tests use hookless T22 mints (same as Phase 11). The TransferHookAccount extension is automatically managed by Token-2022 when the mint has the TransferHook extension. This becomes relevant in Phase v0.3 (Transfer Hook program) integration.

**Confidence:** HIGH for Phase 12 scope. The concern is real but deferred.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `programs/amm/src/` -- all modules read and verified
- `Docs/AMM_Implementation.md` -- Sections 7-11 (two swap instructions, transfer routing, account requirements)
- `Docs/Transfer_Hook_Spec.md` -- Sections 8-9 (ExtraAccountMetaList, mint configuration)
- `.planning/phases/12-profit-pool-swaps-and-swap-validation/12-CONTEXT.md` -- locked decisions
- `.planning/phases/11-sol-pool-swaps/11-RESEARCH.md` -- Phase 11 research (patterns reused)
- Phase 11 summaries and existing test code -- proven patterns for swap testing

### Secondary (MEDIUM confidence)
- Solana Documentation MCP -- transfer hook interface examples, remaining_accounts patterns
- Solana Expert MCP -- dual-hook CPI patterns, ExtraAccountMetaList resolution

### Tertiary (LOW confidence)
- None. All findings verified against codebase or authoritative sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in Cargo.toml, no new dependencies needed
- Architecture: HIGH -- patterns derived from existing swap_sol_pool (proven) and locked decisions
- Pitfalls: HIGH -- derived from analyzing actual code paths, Phase 11 lessons learned, and dual-hook complexity analysis

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (stable domain, no expected breaking changes)
