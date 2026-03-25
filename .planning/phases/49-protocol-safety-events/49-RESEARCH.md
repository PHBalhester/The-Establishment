# Phase 49: Protocol Safety & Events - Research

**Researched:** 2026-02-20
**Domain:** Solana/Anchor on-chain program instrumentation (events, slippage floors, escrow reconciliation)
**Confidence:** HIGH

## Summary

This phase adds three categories of improvements to the existing protocol:
1. **Minimum output floor (SEC-10)** -- reject user swaps where `minimum_amount_out=0` by enforcing a protocol-level 50% constant-product floor on both buy and sell paths
2. **Escrow reconciliation (SEC-08)** -- the `deposit_rewards` instruction already has `escrow_vault` in its account struct and verifies balance. This requirement is already implemented. Verification needed.
3. **Event fixes and additions (FIX-06 + SEC-09)** -- fix three swap instructions that emit `output_amount: 0` and `lp_fee: 0`, and verify event coverage for all critical state changes

The codebase is mature (5 programs, ~30 existing `emit!()` calls). No new libraries are needed. All changes are within existing Anchor programs using existing patterns already proven in the codebase.

**Primary recommendation:** This phase is primarily a "fix and verify" phase. The largest new code is the minimum output floor (SEC-10), which should reuse the exact constant-product + BPS floor pattern already proven in Carnage slippage (Phase 47). The event fixes (FIX-06) require reading token account balances before/after CPI, following the pattern already used in `swap_sol_sell`. No new dependencies or architectural patterns needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `anchor-lang` | 0.30.x | Program framework, `emit!()` macro, account constraints | Already used across all 5 programs |
| `anchor-spl` | 0.30.x | Token account types, interface types | Already used for all swap instructions |

### Supporting
No additional libraries needed. All work is within existing program code.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Balance-diff for output_amount | `get_return_data()` CPI return | Return data approach requires modifying AMM to set return data; balance-diff is already proven in `swap_sol_sell.rs` and zero-modification to AMM |
| Direct pool reserve read for floor | CPI to AMM for quote | Would add CPI depth; raw byte read at known offsets is proven in `execute_carnage_atomic.rs` |

## Architecture Patterns

### Existing Codebase Structure (No Changes Needed)
```
programs/
  amm/src/
    events.rs          # SwapEvent, PoolInitializedEvent
    instructions/
      swap_sol_pool.rs   # emits SwapEvent with amount_out, lp_fee
      swap_profit_pool.rs # emits SwapEvent with amount_out, lp_fee
  tax-program/src/
    events.rs          # TaxedSwap, UntaxedSwap, ExemptSwap
    errors.rs          # TaxError enum (add new floor error here)
    constants.rs       # Add MINIMUM_OUTPUT_FLOOR_BPS here
    helpers/
      tax_math.rs      # Add floor calculation helper here
    instructions/
      swap_sol_buy.rs    # FIX: output_amount=0, ADD: floor check
      swap_sol_sell.rs   # ADD: floor check (output_amount already correct)
      swap_profit_buy.rs # FIX: output_amount=0, lp_fee=0, ADD: floor check
      swap_profit_sell.rs # FIX: output_amount=0, lp_fee=0, ADD: floor check
  epoch-program/src/
    events.rs          # CarnageExecuted, TaxesUpdated, etc.
  staking/src/
    events.rs          # RewardsDeposited, Claimed, etc.
    instructions/
      deposit_rewards.rs # SEC-08: Already has escrow_vault + reconciliation
```

### Pattern 1: Balance-Diff for CPI Output (FIX-06)
**What:** Snapshot token account balance before CPI, reload after CPI, compute difference.
**When to use:** When the Tax Program needs to know the AMM's swap output but does not control the AMM's return data.
**Why not `get_return_data()`:** The AMM currently uses `emit!()` (which writes to logs, not return data) and does not call `set_return_data`. Modifying the AMM to add `set_return_data` would touch Phase 49's boundary and add a program upgrade. The balance-diff pattern is already proven in `swap_sol_sell.rs` lines 96-203.

**Example (from existing `swap_sol_sell.rs`):**
```rust
// Source: programs/tax-program/src/instructions/swap_sol_sell.rs:96-203
// 2. Record balance before CPI
let wsol_before = ctx.accounts.user_token_a.amount;

// 3. Execute AMM CPI
invoke_signed(&swap_ix, &account_infos, &[swap_authority_seeds])?;

// 4. Reload and compute difference
ctx.accounts.user_token_a.reload()?;
let wsol_after = ctx.accounts.user_token_a.amount;
let gross_output = wsol_after.checked_sub(wsol_before)
    .ok_or(error!(TaxError::TaxOverflow))?;
```

For `swap_sol_buy` (buy direction), the pattern is inverted -- snapshot `user_token_b` (CRIME/FRAUD) before and after the AMM CPI to get `tokens_received`.

For `swap_profit_buy` and `swap_profit_sell`, the same pattern applies -- snapshot the output token account before CPI, reload after, compute diff.

**Compute cost:** `reload()` costs ~3000 CU per account (deserialization). Each swap instruction already has margin within the 200,000 CU limit.

### Pattern 2: Protocol-Enforced Minimum Output Floor (SEC-10)
**What:** Before passing `minimum_amount_out` to the AMM CPI, the Tax Program computes a floor based on constant-product expected output and enforces `actual_minimum >= floor`.
**When to use:** All four user-facing swap instructions.
**Existing precedent:** `execute_carnage_atomic.rs` lines 422-438.

**Implementation approach -- SOL pool swaps (buy/sell):**
For SOL pool swaps, the Tax Program already has access to the AMM pool account (via `ctx.accounts.pool`). The pool account data can be read at known byte offsets using the `read_pool_reserves` pattern already proven in Carnage code.

PoolState byte layout (verified from `pool.rs` + `execute_carnage_atomic.rs`):
```
[0..8]    Anchor discriminator
[8]       pool_type (1 byte)
[9..41]   mint_a (Pubkey, 32 bytes)
[41..73]  mint_b (Pubkey, 32 bytes)
[73..105] vault_a (Pubkey, 32 bytes)
[105..137] vault_b (Pubkey, 32 bytes)
[137..145] reserve_a (u64, 8 bytes)
[145..153] reserve_b (u64, 8 bytes)
[153..155] lp_fee_bps (u16, 2 bytes)
```

Floor calculation (identical to Carnage but with 5000 bps instead of 8500):
```rust
// Constant-product expected output (pre-fee for simplicity):
// expected = reserve_out * amount_in / (reserve_in + amount_in)
let expected = (reserve_out as u128)
    .checked_mul(effective_input as u128)
    .and_then(|n| n.checked_div(
        (reserve_in as u128).checked_add(effective_input as u128)?
    ))
    .ok_or(TaxError::Overflow)? as u64;

// 50% floor
let floor = (expected as u128)
    .checked_mul(MINIMUM_OUTPUT_FLOOR_BPS as u128)
    .and_then(|n| n.checked_div(10_000))
    .ok_or(TaxError::Overflow)? as u64;

// Enforce: user's minimum must be >= floor
let enforced_minimum = std::cmp::max(minimum_output, floor);
// OR: reject if minimum_output < floor (depends on design choice)
```

**Design decision (Claude's discretion -- RECOMMENDED):**
- **Option A: Silently upgrade** -- `enforced_minimum = max(user_minimum, floor)`. Pass `enforced_minimum` to AMM. User never sees the floor unless they get worse price than 50%.
- **Option B: Hard reject** -- If `minimum_output < floor`, return `TaxError::MinimumOutputFloorViolation`. Forces frontend/user to set reasonable slippage.
- **Recommendation: Option B (hard reject)**. Rationale: (a) "silent upgrade" masks broken frontends that send `minimum_amount_out=0`, (b) the error message educates users/bots, (c) Carnage uses hard reject too. Frontend should default to 1-3% slippage, and only expert users override.

**PROFIT pool multi-hop floor (Claude's discretion -- RECOMMENDED):**
- PROFIT pool swaps are single-leg (CRIME->PROFIT or PROFIT->CRIME). They are NOT multi-hop through SOL. The context refers to a potential future "buy PROFIT with SOL" flow that would do SOL->CRIME->PROFIT (two swaps). That flow is not currently implemented. The floor should apply to each individual `swap_profit_buy` and `swap_profit_sell` instruction independently, just like the SOL pool swaps.

### Pattern 3: Escrow Reconciliation (SEC-08) -- Already Implemented
**What:** `deposit_rewards` includes `escrow_vault` in its account struct and verifies `escrow_vault.lamports() >= pool.pending_rewards`.
**Status:** Already implemented in `programs/staking/src/instructions/deposit_rewards.rs` lines 53-66 (account struct) and lines 95-102 (reconciliation check).
**Verification needed:** Confirm this satisfies SEC-08 requirements by reviewing the existing code against the spec.

The existing implementation:
```rust
// Account struct (line 62-67)
#[account(
    seeds = [ESCROW_VAULT_SEED],
    bump,
)]
pub escrow_vault: AccountInfo<'info>,

// Reconciliation (line 99-102)
require!(
    ctx.accounts.escrow_vault.lamports() >= pool.pending_rewards,
    StakingError::InsufficientEscrowBalance
);
```

**Mismatch behavior (Claude's discretion -- RECOMMENDED):**
The current code does a hard revert with `StakingError::InsufficientEscrowBalance`. This is correct behavior -- it prevents inflated `pending_rewards` from causing future claim failures. Adding an event emission before the revert is belt-and-suspenders for monitoring but Anchor reverts the entire TX, so the event would not persist. The existing `EscrowInsufficientAttempt` event in `claim.rs` covers the claim-side detection. The deposit-side revert is sufficient as-is.

**Scope expansion (Claude's discretion -- RECOMMENDED):**
- Do NOT extend reconciliation beyond `deposit_rewards`. Other fund movements (carnage vault, treasury) are direct `system_instruction::transfer` calls that either succeed or revert -- no state update happens without the transfer completing. `deposit_rewards` is unique because it separates the transfer (done by Tax Program) from the state update (done by Staking Program via CPI), creating a window for mismatch.

### Anti-Patterns to Avoid
- **Using `get_return_data()` for swap output:** Would require modifying the AMM program. Balance-diff is simpler and already proven.
- **Deserializing PoolState in Tax Program:** Would create a Cargo dependency on AMM crate. Raw byte reads at known offsets (the `read_pool_reserves` pattern) avoid this coupling.
- **Emitting events before reverts:** Anchor reverts the entire TX on error, including events. Events emitted before `require!()` are lost if the require fails. Only emit after all checks pass.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constant-product expected output | Custom formula | Reuse AMM's `calculate_swap_output` formula inline | Already proven in Carnage, same math |
| BPS floor calculation | Custom percentage logic | Reuse Carnage's `(expected * BPS / 10_000)` pattern | Handles u128 overflow correctly |
| Event serialization | Custom log encoding | Anchor's `emit!()` macro with `#[event]` structs | Standard, client libraries understand it |
| Pool reserve reading | PoolState deserialization | Raw byte read at offsets 137/145 | Avoids cross-crate dependency, proven in Carnage |

**Key insight:** Every pattern needed for this phase already exists in the codebase. The Carnage slippage floor code is a direct template for the user swap floor. The sell-side balance-diff pattern is a direct template for the buy-side and profit-side fixes.

## Common Pitfalls

### Pitfall 1: Reading Stale Account Data After CPI
**What goes wrong:** After `invoke_signed()` returns, the Anchor-deserialized account data is stale. The CPI may have mutated the underlying account, but Anchor's cached struct still has the old values.
**Why it happens:** Anchor deserializes accounts at the start of instruction execution. CPI mutations happen through the runtime's AccountInfo, not through Anchor's Account wrapper.
**How to avoid:** Call `.reload()` on any `InterfaceAccount<TokenAccount>` or `Account<T>` after CPI before reading its fields. This is already done correctly in `swap_sol_sell.rs` (line 198: `ctx.accounts.user_token_a.reload()?`).
**Warning signs:** Reading `.amount` on a token account after CPI without `.reload()` will silently return pre-CPI values.

### Pitfall 2: Floor Calculation on Buy Side -- Amount Adjustment for Tax
**What goes wrong:** For buy swaps, the user specifies `amount_in` (total SOL), but only `sol_to_swap = amount_in - tax` goes to the AMM. The floor calculation must use `sol_to_swap` (post-tax), not `amount_in`, to compute the expected output.
**Why it happens:** Tax is deducted from input before the swap, reducing effective input. Using `amount_in` would compute a higher expected output than what's actually achievable.
**How to avoid:** Calculate tax first, compute `sol_to_swap`, then use `sol_to_swap` as the input amount for the floor calculation.
**Warning signs:** Floor rejects all buy swaps because expected output is inflated.

### Pitfall 3: Floor Calculation on Sell Side -- Tax Applied to Output
**What goes wrong:** For sell swaps, the floor should be computed on the gross output (before tax), and the user's `minimum_output` applies to the net output (after tax). The floor must account for this two-level check.
**Why it happens:** Sell tax is deducted from output, so the user receives `gross_output - tax`. The floor protects against sandwich attacks on the swap itself (gross output being too low), while `minimum_output` protects the user's post-tax expectation.
**How to avoid:** Apply floor check on gross output from AMM: `require!(gross_output >= floor)`. Then separately check `net_output >= minimum_output` (already done in `swap_sol_sell.rs` line 223).
**Warning signs:** Conflating gross and net output in floor calculations leads to either too-tight floors (rejecting legitimate swaps) or too-loose floors (not protecting against sandwiches).

### Pitfall 4: LP Fee Must Be Accounted For in Floor Calculation
**What goes wrong:** The constant-product formula gives expected output assuming no LP fee. But the AMM deducts LP fee before computing output. If the floor uses raw constant-product, it will be ~1% higher than what the AMM can actually produce, rejecting all swaps.
**Why it happens:** LP fee reduces effective input by `lp_fee_bps` basis points before the constant-product formula is applied.
**How to avoid:** Either (a) compute effective_input after LP fee deduction before calculating expected output, or (b) use a floor percentage (50%) that is generous enough to absorb the ~1% LP fee. With 50% floor, the LP fee is negligible -- an AMM producing 99% of raw expected is well above the 50% floor. **Recommendation: use raw constant-product without LP fee adjustment, since 50% floor already provides massive tolerance.**
**Warning signs:** Floor rejects all swaps when floor percentage is tight (e.g., 95%). At 50%, this is not a concern.

### Pitfall 5: Pool Account is AccountInfo in Tax Program
**What goes wrong:** The Tax Program's swap instructions declare `pool` as `AccountInfo` (not `Account<PoolState>`) because validation is delegated to the AMM CPI. To read reserves for the floor, you must borrow raw bytes from `AccountInfo::data`.
**Why it happens:** The Tax Program has no Cargo dependency on the AMM crate and doesn't import `PoolState`.
**How to avoid:** Use the `read_pool_reserves` pattern from `execute_carnage_atomic.rs` -- borrow the account data, read bytes at known offsets (137-153 for reserves). This function is already proven and tested.
**Warning signs:** Attempting to deserialize `Account<PoolState>` in Tax Program will fail to compile.

## Code Examples

### Fix Buy-Side output_amount=0 (FIX-06)
```rust
// In swap_sol_buy.rs, BEFORE the CPI:
let token_b_before = ctx.accounts.user_token_b.amount;

// ... existing CPI code (invoke_signed) ...

// AFTER the CPI:
ctx.accounts.user_token_b.reload()?;
let token_b_after = ctx.accounts.user_token_b.amount;
let tokens_received = token_b_after.checked_sub(token_b_before)
    .ok_or(error!(TaxError::TaxOverflow))?;

// In the emit! block, change output_amount: 0 to:
emit!(TaxedSwap {
    // ... existing fields ...
    output_amount: tokens_received,
    // ...
});
```

### Fix Profit Swap output_amount=0 and lp_fee=0 (FIX-06)
```rust
// In swap_profit_buy.rs / swap_profit_sell.rs:
// Snapshot output token account before CPI
let output_before = ctx.accounts.user_token_b.amount; // or user_token_a for sell

// ... existing CPI code ...

// After CPI, reload and compute
ctx.accounts.user_token_b.reload()?; // or user_token_a for sell
let output_after = ctx.accounts.user_token_b.amount;
let actual_output = output_after.checked_sub(output_before)
    .ok_or(error!(TaxError::TaxOverflow))?;

// LP fee can be computed: fee = amount_in * lp_fee_bps / 10_000
// But we don't have lp_fee_bps at the Tax Program level.
// Two options:
// 1. Read lp_fee_bps from pool data at offset 153-155
// 2. Compute from input/output: lp_fee = amount_in - (amount_in * effective_output / raw_expected)
// Option 1 is simpler and more accurate.
let pool_data = ctx.accounts.pool.try_borrow_data()?;
let lp_fee_bps = u16::from_le_bytes(
    pool_data[153..155].try_into()
        .map_err(|_| error!(TaxError::TaxOverflow))?
);
let lp_fee = (amount_in as u128)
    .checked_mul(lp_fee_bps as u128)
    .and_then(|n| n.checked_div(10_000))
    .ok_or(error!(TaxError::TaxOverflow))? as u64;

emit!(UntaxedSwap {
    // ... existing fields ...
    output_amount: actual_output,
    lp_fee,
    // ...
});
```

### Minimum Output Floor (SEC-10)
```rust
// In tax_math.rs (new helper function):
/// Calculate protocol-enforced minimum output floor.
///
/// Formula: expected_output * floor_bps / 10_000
/// where expected_output = reserve_out * amount_in / (reserve_in + amount_in)
///
/// Returns the floor amount (minimum acceptable output).
/// Returns 0 if reserves are 0 (empty pool edge case).
pub fn calculate_output_floor(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    floor_bps: u64,
) -> Option<u64> {
    if reserve_in == 0 || reserve_out == 0 || amount_in == 0 {
        return Some(0);
    }

    // Constant-product expected output (no LP fee adjustment needed at 50% floor)
    let expected = (reserve_out as u128)
        .checked_mul(amount_in as u128)?
        .checked_div(
            (reserve_in as u128).checked_add(amount_in as u128)?
        )? as u64;

    // Floor = expected * floor_bps / 10_000
    let floor = (expected as u128)
        .checked_mul(floor_bps as u128)?
        .checked_div(10_000)? as u64;

    Some(floor)
}

// In constants.rs:
/// Protocol-enforced minimum output floor (50% = 5000 bps).
/// User swaps with minimum_amount_out below this floor are rejected.
/// Consistent with Carnage's slippage floor approach.
/// Source: Phase 49 CONTEXT.md
pub const MINIMUM_OUTPUT_FLOOR_BPS: u64 = 5000;
```

### Read Pool Reserves in Tax Program (reuse Carnage pattern)
```rust
// In tax-program/src/helpers/pool_reader.rs (new file, or add to existing helpers):
use anchor_lang::prelude::*;
use crate::errors::TaxError;

/// Read reserve_a and reserve_b from a PoolState AccountInfo.
///
/// PoolState byte layout (from AMM PoolState struct):
///   [0..8]    Anchor discriminator
///   [8]       pool_type (1 byte)
///   [9..41]   mint_a (Pubkey, 32 bytes)
///   [41..73]  mint_b (Pubkey, 32 bytes)
///   [73..105] vault_a (Pubkey, 32 bytes)
///   [105..137] vault_b (Pubkey, 32 bytes)
///   [137..145] reserve_a (u64, 8 bytes)
///   [145..153] reserve_b (u64, 8 bytes)
///
/// Source: Identical to epoch-program/src/instructions/execute_carnage_atomic.rs
pub fn read_pool_reserves(pool_info: &AccountInfo) -> Result<(u64, u64)> {
    let data = pool_info.data.borrow();
    require!(data.len() >= 153, TaxError::InvalidPoolType);

    let reserve_a = u64::from_le_bytes(
        data[137..145].try_into()
            .map_err(|_| error!(TaxError::TaxOverflow))?
    );
    let reserve_b = u64::from_le_bytes(
        data[145..153].try_into()
            .map_err(|_| error!(TaxError::TaxOverflow))?
    );

    Ok((reserve_a, reserve_b))
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `output_amount: 0` in buy-side TaxedSwap events | Balance-diff pattern to get actual output | Phase 49 (this phase) | Enables off-chain analytics dashboard |
| No protocol floor on user slippage | 50% constant-product floor enforced by Tax Program | Phase 49 (this phase) | Prevents zero-slippage sandwich attacks |
| Event emit via program logs (`emit!()`) | Same -- `emit!()` remains the standard | No change | Anchor's `emit!()` uses `sol_log_data`, parseable by clients |

**Deprecated/outdated:**
- CPI return data (`get_return_data()`) would be an alternative to balance-diff, but requires AMM changes and is not used anywhere in the current codebase. Balance-diff is the established pattern.

## Detailed Findings by Requirement

### SEC-08: Escrow Reconciliation -- ALREADY IMPLEMENTED

**Finding (HIGH confidence):** The `deposit_rewards` instruction in `programs/staking/src/instructions/deposit_rewards.rs` already satisfies SEC-08:

1. **Account struct includes `escrow_vault`** (line 62-67): The `escrow_vault` field is present with PDA seed validation.
2. **Balance verification** (line 99-102): After incrementing `pending_rewards`, the code verifies `escrow_vault.lamports() >= pool.pending_rewards`.
3. **Hard revert on mismatch**: Uses `StakingError::InsufficientEscrowBalance`.
4. **Event emission**: `RewardsDeposited` event emitted (line 104-108) with `amount` and `new_pending`.

**Recommendation:** SEC-08 may need only verification (a test) rather than new code. The existing RewardsDeposited event could be enriched with the `escrow_vault` pubkey and `escrow_balance` for monitoring completeness. This is minor additive work.

### SEC-09: Event Emission Coverage

**Current event inventory (all programs):**

| Program | Instruction | Event | Status |
|---------|-----------|-------|--------|
| AMM | swap_sol_pool | SwapEvent | COMPLETE (has amount_out, lp_fee, reserves) |
| AMM | swap_profit_pool | SwapEvent | COMPLETE |
| AMM | initialize_pool | PoolInitializedEvent | COMPLETE |
| Tax | swap_sol_buy | TaxedSwap | **BROKEN: output_amount=0** |
| Tax | swap_sol_sell | TaxedSwap | COMPLETE (output_amount correct since Phase 48) |
| Tax | swap_profit_buy | UntaxedSwap | **BROKEN: output_amount=0, lp_fee=0** |
| Tax | swap_profit_sell | UntaxedSwap | **BROKEN: output_amount=0, lp_fee=0** |
| Tax | swap_exempt | ExemptSwap | COMPLETE (has authority, pool, amount, direction) |
| Epoch | trigger_epoch_transition | EpochTransitionTriggered | COMPLETE |
| Epoch | consume_randomness | TaxesUpdated | COMPLETE |
| Epoch | consume_randomness | CarnagePending/CarnageNotTriggered | COMPLETE |
| Epoch | execute_carnage_atomic | CarnageExecuted | COMPLETE |
| Epoch | execute_carnage | CarnageExecuted | COMPLETE |
| Epoch | expire_carnage | CarnageExpired + CarnageFailed | COMPLETE |
| Epoch | initialize_epoch_state | EpochStateInitialized | COMPLETE |
| Epoch | initialize_carnage_fund | CarnageFundInitialized | COMPLETE |
| Epoch | retry_epoch_vrf | VrfRetryRequested | COMPLETE |
| Staking | deposit_rewards | RewardsDeposited | NEEDS ENRICHMENT (missing escrow balance, depositor) |
| Staking | update_cumulative | CumulativeUpdated | COMPLETE |
| Staking | stake | Staked | COMPLETE |
| Staking | unstake | Unstaked | COMPLETE |
| Staking | claim | Claimed | COMPLETE |
| Staking | claim (insufficient) | EscrowInsufficientAttempt | COMPLETE |
| Staking | initialize_stake_pool | StakePoolInitialized | COMPLETE |
| Hook | add_whitelist_entry | AddressWhitelisted | COMPLETE |
| Hook | burn_authority | AuthorityBurned | COMPLETE |
| Hook | initialize_extra_account_meta_list | ExtraAccountMetaListInitialized | COMPLETE |

**Gap analysis:**
1. **FIX-06 (3 instructions):** `swap_sol_buy`, `swap_profit_buy`, `swap_profit_sell` emit `output_amount: 0` and/or `lp_fee: 0`.
2. **RewardsDeposited enrichment:** Missing `escrow_vault` pubkey and `escrow_balance` fields for off-chain monitoring.
3. **CarnageExecuted enrichment (Claude's discretion):** Could add pool reserves at time of execution for analytics. Currently has `sol_spent`, `tokens_bought`, `tokens_burned`, `sol_from_sale`, `atomic`. Consider adding `reserve_sol_before`, `reserve_token_before` for price-at-execution analytics. **Recommendation: Keep existing fields. Pool reserves are available in AMM's SwapEvent emitted in the same TX via inner instructions. Adding reserves to CarnageExecuted is redundant.**

### SEC-10: Minimum Output Floor

**Key design decisions:**

1. **Where to enforce:** In the Tax Program, before passing `minimum_amount_out` to the AMM CPI. The AMM itself does not need modification.

2. **What to compute:** `expected_output = reserve_out * amount_in / (reserve_in + amount_in)`, then `floor = expected_output * 5000 / 10_000`.

3. **Buy side:** Use `sol_to_swap` (post-tax input) as `amount_in` for the floor calculation. Read reserves from pool AccountInfo at offsets 137-153.

4. **Sell side:** The sell flow computes `gross_output` via balance-diff after the AMM CPI. Apply floor check on `gross_output`: `require!(gross_output >= floor)`. This checks the AMM swap quality before tax deduction.

5. **Sell-side timing issue:** For sell swaps, the floor calculation needs reserves BEFORE the CPI (because the CPI changes reserves). But the output is only known AFTER the CPI. Solution: read reserves before CPI, execute CPI, compute gross_output via balance-diff, then check `gross_output >= floor(reserves_before, amount_in)`.

6. **swap_exempt (Carnage):** Does NOT get the floor. Carnage already has its own slippage floor (85% atomic, 75% fallback) which is tighter than 50%. And Carnage intentionally accepts market execution in some edge cases.

7. **PROFIT pool floor for swap_profit_buy/sell:** Same pattern but read from the PROFIT pool's reserves. Both token accounts are Token-2022 so the balance-diff pattern works the same way.

### FIX-06: Zeroed Event Fields

**Root cause:** The Tax Program uses raw `invoke_signed()` for AMM CPI. After the CPI returns, the Tax Program does not read the AMM's computed output. It simply emits the event with `output_amount: 0` and comments `// TODO: Get from CPI return data or compute from reserves`.

**Fix approach:** For each affected instruction:
1. Snapshot output token account balance before CPI
2. Execute CPI (no changes)
3. `reload()` the output token account
4. Compute `actual_output = after - before`
5. For `lp_fee`: read `lp_fee_bps` from pool data at offset 153-155, compute `fee = amount_in * lp_fee_bps / 10_000`
6. Emit event with actual values

**Affected instructions:**
- `swap_sol_buy.rs`: output is `user_token_b` (CRIME/FRAUD). Currently `output_amount: 0`.
- `swap_profit_buy.rs`: output is `user_token_b` (PROFIT). Currently `output_amount: 0, lp_fee: 0`.
- `swap_profit_sell.rs`: output is `user_token_a` (CRIME/FRAUD). Currently `output_amount: 0, lp_fee: 0`.

**Note:** `swap_sol_sell.rs` already correctly emits `output_amount: net_output` (line 444). No fix needed.

## Open Questions

1. **Should the floor check be `require!(minimum_output >= floor)` or `require!(actual_output >= floor)`?**
   - What we know: The user passes `minimum_output` as slippage protection. The AMM enforces `actual_output >= minimum_amount_out`. If we enforce `minimum_output >= floor`, the user must set reasonable slippage to even submit the TX. If we enforce `actual_output >= floor`, the TX can be submitted with any slippage but will fail if the AMM gives too little.
   - Recommendation: **Both.** Check `minimum_output >= floor` upfront (catches zero-slippage bots before CPI). Then the AMM's own `require!(amount_out >= minimum_amount_out)` catches the actual execution. This is belt-and-suspenders. The floor is 50% -- only bots/sandwich attackers set slippage below 50%.

2. **Should the floor apply to swap_sol_sell's gross or net output?**
   - What we know: Sell swaps have tax deducted from output. `gross_output` is the AMM's raw output. `net_output = gross_output - tax`.
   - Recommendation: Apply floor to **gross output**. The floor protects against AMM-level sandwich attacks, not tax mechanics. The user's `minimum_output` already protects their net expectation.

3. **Compute budget impact of adding balance-diff + floor + reload to swap instructions?**
   - What we know: Each `.reload()` costs ~3000 CU. Each `read_pool_reserves()` is ~500 CU (byte slice operations). Floor math is ~200 CU. Total addition: ~4000-7000 CU per swap instruction.
   - Existing margin: Swap instructions typically use 50,000-80,000 CU of the 200,000 default. Ample headroom.
   - Recommendation: Not a concern. No compute budget increase needed.

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: All program files read and analyzed
  - `programs/tax-program/src/instructions/swap_sol_buy.rs` (line 293: `output_amount: 0`)
  - `programs/tax-program/src/instructions/swap_sol_sell.rs` (lines 96-203: balance-diff pattern)
  - `programs/tax-program/src/instructions/swap_profit_buy.rs` (line 150: `output_amount: 0, lp_fee: 0`)
  - `programs/tax-program/src/instructions/swap_profit_sell.rs` (line 150: `output_amount: 0, lp_fee: 0`)
  - `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` (lines 376-438: floor pattern, lines 930-956: read_pool_reserves)
  - `programs/staking/src/instructions/deposit_rewards.rs` (lines 53-102: escrow reconciliation)
  - `programs/amm/src/helpers/math.rs` (constant-product formula)
  - `programs/amm/src/state/pool.rs` (PoolState struct layout)
- Anchor official docs: Events page (https://www.anchor-lang.com/docs/features/events) -- `emit!()` uses CPI to self with event data, parseable from innerInstructions
- Solana SDK: `get_return_data()` / `set_return_data()` documentation (confirmed balance-diff is simpler for our use case)

### Secondary (MEDIUM confidence)
- Solana Stack Exchange answers on CPI return data (confirmed `invoke_signed` returns `Result<()>`, not the callee's return value; `get_return_data()` is needed separately)

### Tertiary (LOW confidence)
- None -- all findings verified against codebase and official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing patterns
- Architecture: HIGH -- reusing proven patterns (balance-diff, read_pool_reserves, BPS floor)
- Pitfalls: HIGH -- identified from actual bugs in current code (output_amount=0 TODO comments)
- SEC-08 status: HIGH -- verified by reading actual code that reconciliation exists

**Research date:** 2026-02-20
**Valid until:** Indefinite (all patterns are stable, no external dependency version changes)
