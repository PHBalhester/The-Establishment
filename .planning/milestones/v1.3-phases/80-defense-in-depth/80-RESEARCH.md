# Phase 80: Defense-in-Depth - Research

**Researched:** 2026-03-08
**Domain:** Rust/Anchor defensive hardening -- ownership verification, checked casts, struct layout stability
**Confidence:** HIGH

## Summary

Phase 80 applies 8 defensive fixes (DEF-01 through DEF-08) across 5 programs. All changes are hardening of existing code paths -- no new features. The work falls into four categories:

1. **Ownership verification** (DEF-01, DEF-06): Verify that accounts passed as raw `AccountInfo` are owned by the expected program before reading their bytes.
2. **Checked casts** (DEF-04, DEF-07): Replace truncating `as u64` casts with `u64::try_from()` or checked enum conversions.
3. **Struct layout stability** (DEF-03, DEF-08): Add reserved padding, `#[repr(C)]`, and compile-time size assertions to EpochState and its Tax Program mirror.
4. **Input validation** (DEF-02, DEF-05): Add `is_reversed` canonical mint detection and `remaining_accounts` count checks.

**Primary recommendation:** Tackle these in three plan files: (1) pool reader hardening (DEF-01, DEF-02, DEF-06), (2) checked casts + enum safety (DEF-04, DEF-07), (3) struct layout + remaining_accounts (DEF-03, DEF-05, DEF-08). Each plan is independent and testable.

## Standard Stack

No new libraries needed. All changes use existing Rust/Anchor primitives.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Framework constraints, error macros | Already in use across all programs |
| std::convert::TryFrom | stable | `u64::try_from(u128)` checked conversion | Rust stdlib, zero overhead |
| std::mem::size_of | stable | Compile-time struct size assertion | Rust stdlib, zero runtime cost |

### Supporting
No additional dependencies.

## Architecture Patterns

### Pattern 1: Account Owner Verification Before Byte Read

**What:** Before reading raw bytes from an `AccountInfo`, verify `.owner` matches the expected program.
**When to use:** Any cross-program byte read (pool_reader.rs, carnage slippage checks).
**Why:** A spoofed account with valid byte layout but wrong owner could feed arbitrary data. Owner check is O(1) -- single Pubkey comparison.

**Example (DEF-01 -- pool_reader.rs):**
```rust
use crate::constants::amm_program_id;

pub fn read_pool_reserves(pool_info: &AccountInfo) -> Result<(u64, u64)> {
    // DEF-01: Verify pool account is owned by AMM program
    require!(
        *pool_info.owner == amm_program_id(),
        TaxError::InvalidPoolOwner
    );

    let data = pool_info.data.borrow();
    require!(data.len() >= 153, TaxError::InvalidPoolType);
    // ... existing byte reads ...
}
```

**Example (DEF-06 -- carnage pool owner in execute_carnage.rs):**
```rust
// Add to account constraints:
/// CRIME/SOL AMM pool
/// CHECK: Owner verified as AMM program, contents validated by Tax during CPI
#[account(mut, owner = amm_program_id() @ EpochError::InvalidAmmProgram)]
pub crime_pool: AccountInfo<'info>,

/// FRAUD/SOL AMM pool
/// CHECK: Owner verified as AMM program, contents validated by Tax during CPI
#[account(mut, owner = amm_program_id() @ EpochError::InvalidAmmProgram)]
pub fraud_pool: AccountInfo<'info>,
```

**Confidence:** HIGH -- `owner` field is always available on `AccountInfo`, Pubkey comparison is standard Anchor pattern.

### Pattern 2: is_reversed Canonical Mint Detection

**What:** Read mint_a from pool bytes [9..41], compare to NATIVE_MINT to determine if reserves are in expected order.
**When to use:** Tax Program pool_reader only (per CONTEXT.md -- epoch_program deferred to Phase 82).
**Why:** AMM stores pools with canonical mint ordering (lower Pubkey = mint_a). If mint_a != NATIVE_MINT, reserves are (token, SOL) not (SOL, token).

**Example (DEF-02 -- pool_reader.rs):**
```rust
use anchor_lang::solana_program::pubkey::Pubkey;
use spl_token::native_mint::id as native_mint;
// OR use the raw bytes: solana_program::native_token::ID

pub fn read_pool_reserves(pool_info: &AccountInfo) -> Result<(u64, u64)> {
    // DEF-01: Owner check (see above)
    require!(*pool_info.owner == amm_program_id(), TaxError::InvalidPoolOwner);

    let data = pool_info.data.borrow();
    require!(data.len() >= 153, TaxError::InvalidPoolType);

    let reserve_a = u64::from_le_bytes(
        data[137..145].try_into().map_err(|_| error!(TaxError::TaxOverflow))?,
    );
    let reserve_b = u64::from_le_bytes(
        data[145..153].try_into().map_err(|_| error!(TaxError::TaxOverflow))?,
    );

    // DEF-02: Canonical mint detection
    // Read mint_a pubkey from bytes [9..41]
    let mint_a_bytes: [u8; 32] = data[9..41]
        .try_into()
        .map_err(|_| error!(TaxError::TaxOverflow))?;
    let mint_a = Pubkey::new_from_array(mint_a_bytes);

    // Tax Program only reads SOL pools. SOL mint (0x06...) is always lowest.
    // If mint_a == NATIVE_MINT: reserves are (SOL, token) -- no reversal needed.
    // If mint_a != NATIVE_MINT: reserves are (token, SOL) -- swap them.
    if mint_a == native_mint() {
        Ok((reserve_a, reserve_b))
    } else {
        Ok((reserve_b, reserve_a))  // Swap: return (SOL, token)
    }
}
```

**Important note:** The return type semantics must match what callers expect. Currently `read_pool_reserves` returns `(reserve_a, reserve_b)` and callers in swap_sol_buy.rs and swap_sol_sell.rs use these directly. Need to verify callers expect `(sol_reserve, token_reserve)` ordering. Check the call sites.

**Confidence:** HIGH -- this pattern was successfully implemented in epoch_program Phase 52.1. NATIVE_MINT (0x06...) is confirmed always lowest in canonical ordering (MEMORY.md).

### Pattern 3: Checked u128-to-u64 Cast

**What:** Replace `value as u64` with `u64::try_from(value).map_err(|_| error!(SomeError::MathOverflow))?`
**When to use:** Every `as u64` cast from a u128 intermediate in on-chain math.
**Why:** `as u64` silently truncates. While most cases are mathematically safe (result bounded by input u64 values), defense-in-depth catches any future regression.

**Example (DEF-04 -- staking math.rs line 50):**
```rust
// BEFORE (silent truncation):
let pending = (user.staked_balance as u128)
    .checked_mul(reward_delta)
    .ok_or(StakingError::Overflow)?
    .checked_div(PRECISION)
    .ok_or(StakingError::DivisionByZero)? as u64;

// AFTER (checked):
let pending_u128 = (user.staked_balance as u128)
    .checked_mul(reward_delta)
    .ok_or(StakingError::Overflow)?
    .checked_div(PRECISION)
    .ok_or(StakingError::DivisionByZero)?;
let pending = u64::try_from(pending_u128)
    .map_err(|_| error!(StakingError::Overflow))?;
```

**Confidence:** HIGH -- `u64::try_from(u128)` is stable Rust, zero-cost when value fits.

### Pattern 4: Compile-Time Struct Size Assertion

**What:** Use `const _: () = assert!(...)` to verify struct size at compile time.
**When to use:** Any struct read cross-program via raw byte offsets.
**Why:** If a field is added/removed, the build fails immediately instead of silently reading wrong offsets at runtime.

**Example (DEF-08 -- epoch_state.rs):**
```rust
#[repr(C)]
#[account]
pub struct EpochState {
    // ... fields ...
    pub reserved: [u8; 64],  // DEF-03: padding for future schema evolution
    pub initialized: bool,
    pub bump: u8,
}

impl EpochState {
    // DATA_LEN includes the new 64 bytes of padding
    pub const DATA_LEN: usize = 8 + 4 + 8 + 1 + 2 + 2 + 2 + 2 + 2 + 2
        + 8 + 1 + 1 + 32 + 1 + 1 + 1 + 8 + 8 + 4 + 64 + 1 + 1;
    pub const LEN: usize = 8 + Self::DATA_LEN;
}

// DEF-08: Compile-time layout assertion
const _: () = assert!(EpochState::DATA_LEN == 164); // 100 + 64 padding
```

**Confidence:** HIGH -- `const _: () = assert!(...)` is a standard Rust pattern, zero runtime cost.

### Anti-Patterns to Avoid
- **Manual bounds checks instead of try_from:** Don't write `if value > u64::MAX as u128 { ... }`. Use `u64::try_from()` which does this internally.
- **Separate owner check utility function:** Keep the owner check inline in `read_pool_reserves` -- it's a single `require!()`, not worth a separate function.
- **Adding `#[repr(C)]` without size assertion:** `#[repr(C)]` alone doesn't prevent layout drift. The compile-time assertion is what catches mistakes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| u128 -> u64 conversion | Manual bounds check | `u64::try_from()` | Standard library, handles edge cases correctly |
| Struct layout validation | Runtime size check | `const _: () = assert!(size_of::<T>() == N)` | Zero runtime cost, fails at compile time |
| Account owner verification | Custom CPI verification | `require!(*info.owner == expected)` or Anchor `owner = ` constraint | O(1), proven Anchor pattern |

## Common Pitfalls

### Pitfall 1: Changing EpochState Size Breaks Existing Accounts
**What goes wrong:** Adding `reserved: [u8; 64]` changes the account from 108 to 172 bytes. Existing on-chain accounts are 108 bytes and will fail deserialization.
**Why it happens:** Anchor's `#[account]` macro checks discriminator + expects exact data length.
**How to avoid:** This is expected -- CONTEXT.md acknowledges devnet redeploy is required. v1.4 does full fresh deploy. Use `realloc` if needed for migration, but per CONTEXT.md a redeploy is acceptable.
**Warning signs:** `AccountDidNotDeserialize` errors on existing accounts after deploy.

### Pitfall 2: is_reversed Breaking Caller Assumptions
**What goes wrong:** If callers of `read_pool_reserves` assume `(reserve_a, reserve_b)` maps to `(SOL, token)` but the function was returning raw `(a, b)` which could be `(token, SOL)`, adding is_reversed could flip the values when callers already compensate.
**Why it happens:** Implicit convention vs explicit documentation.
**How to avoid:** Check every call site of `read_pool_reserves`. Currently called in `swap_sol_buy.rs` and `swap_sol_sell.rs`. Verify what they do with the returned values. The function should document its return order: `(sol_reserve, token_reserve)`.
**Warning signs:** Swaps returning wrong amounts after the fix.

### Pitfall 3: reserved Field Position in Struct
**What goes wrong:** If `reserved` is added in the middle of the struct, all byte offsets after it shift. The Tax Program's mirror must match exactly.
**Why it happens:** `#[repr(C)]` lays out fields in declaration order.
**How to avoid:** Add `reserved` at the END of the struct (before `initialized` and `bump`), or add after `bump` as the very last field. The key constraint is both structs must have the same field order. Since this is a redeploy, existing byte offsets in other programs (e.g., epoch_program inline readers in execute_carnage) will also need adjustment or recompilation.
**Warning signs:** Misaligned byte reads, wrong tax rates.

### Pitfall 4: Anchor's #[repr(C)] Interaction with #[account]
**What goes wrong:** Anchor's `#[account]` macro adds an 8-byte discriminator prefix. `#[repr(C)]` controls field layout within the data portion, not the discriminator. Both attributes are compatible.
**Why it happens:** Confusion about what `#[repr(C)]` controls.
**How to avoid:** `#[repr(C)]` goes on the struct definition. The discriminator is separate. `LEN` includes discriminator (8 + DATA_LEN).
**Warning signs:** None if applied correctly -- the two attributes are orthogonal.

### Pitfall 5: Bonding Curve remaining_accounts Count vs Fund Curve
**What goes wrong:** `fund_curve` also uses `remaining_accounts` for Transfer Hook. Adding a count check to purchase.rs and sell.rs but not fund_curve.rs creates inconsistency.
**Why it happens:** CONTEXT.md scopes DEF-05 to purchase.rs and sell.rs only.
**How to avoid:** Per CONTEXT.md, count check is only on purchase.rs and sell.rs. fund_curve.rs is admin-only (called once during initialization) so the attack surface is minimal.
**Warning signs:** fund_curve failing if someone forgets hook accounts -- but this is admin-only and caught in testing.

### Pitfall 6: Test-Only as u64 Casts
**What goes wrong:** DEF-04 says "all u128 as u64 casts in staking, tax, and AMM math" -- but the grep shows many `as u64` casts in TEST files (proptest helpers, test utilities). Changing test code is not required and could bloat the diff.
**Why it happens:** Tests often use `as u64` for convenience in test arithmetic.
**How to avoid:** Only change production code files: `staking/src/helpers/math.rs`, `tax-program/src/helpers/tax_math.rs`, `amm/src/helpers/math.rs`, `bonding_curve/src/math.rs`, `bonding_curve/src/instructions/claim_refund.rs`, `epoch-program/src/instructions/execute_carnage.rs`, `epoch-program/src/instructions/execute_carnage_atomic.rs`. Leave test files unchanged.
**Warning signs:** Reviewing test files and finding `as u64` -- these are not in scope.

## Code Examples

### DEF-01 + DEF-02: Pool Reader Hardening (pool_reader.rs)

Current file: `programs/tax-program/src/helpers/pool_reader.rs`

The function needs two additions:
1. Owner check against `amm_program_id()` (DEF-01)
2. Read mint_a at [9..41], compare to NATIVE_MINT, swap reserves if reversed (DEF-02)

Return type semantics: `(sol_reserve, token_reserve)` -- verify all callers expect this.

### DEF-03 + DEF-08: EpochState Layout Stability

Two files must change in sync:
1. `programs/epoch-program/src/state/epoch_state.rs` -- add `reserved: [u8; 64]` + `#[repr(C)]` + update LEN/DATA_LEN
2. `programs/tax-program/src/state/epoch_state_reader.rs` -- identical changes to mirror struct

The `reserved` field should go BEFORE `initialized` and `bump` (maintaining their position as the last two fields for consistent layout). The field is initialized to `[0u8; 64]` in `initialize_epoch_state`.

New sizes:
- DATA_LEN: 164 bytes (100 + 64)
- LEN: 172 bytes (8 discriminator + 164)

Compile-time assertions in both files:
```rust
const _: () = assert!(std::mem::size_of::<EpochState>() == EXPECTED_SIZE);
// Note: size_of measures the Rust struct WITHOUT Anchor discriminator.
// With #[repr(C)], size_of includes padding between fields.
```

**Important caveat:** With `#[repr(C)]`, `size_of` may differ from the sum of field sizes due to alignment padding. The const assertion should use the actual computed `DATA_LEN` constant, not `size_of`. Alternatively, assert both:
```rust
const _: () = assert!(EpochState::DATA_LEN == 164);
// And a layout match test between the two structs
```

### DEF-04: u128-to-u64 Cast Locations

Production code files with truncating `as u64` casts to fix:

| File | Line(s) | Cast Context |
|------|---------|-------------|
| `staking/src/helpers/math.rs` | 50 | `pending` from reward calculation |
| `tax-program/src/helpers/tax_math.rs` | 164 | `floor` in `calculate_output_floor` |
| `bonding_curve/src/math.rs` | 109, 192, 211, 236 | `tokens_out`, `sol_lamports`, `price`, `refund` |
| `bonding_curve/src/instructions/claim_refund.rs` | 162 | `refund_amount` proportional calculation |
| `epoch-program/src/instructions/execute_carnage.rs` | 435, 440 | Slippage floor calculations |
| `epoch-program/src/instructions/execute_carnage_atomic.rs` | 428, 433 | Slippage floor calculations |

**Note:** `tax_math.rs` lines 52, 97, 101 already use `u64::try_from().ok()` -- only line 164 (`floor as u64`) needs fixing. Similarly, `amm/src/helpers/math.rs` line 75 already uses `u64::try_from(output).ok()`.

**Error variant to use:**
- Staking: `StakingError::Overflow` (already exists)
- Tax: `TaxError::TaxOverflow` (already exists)
- AMM: N/A (already uses try_from)
- Bonding Curve: `CurveError::Overflow` (already exists)
- Epoch: `EpochError::Overflow` (already exists)

### DEF-05: remaining_accounts Count Check

Two files: `bonding_curve/src/instructions/purchase.rs` and `sell.rs`.

Add before the Transfer Hook invoke:
```rust
// DEF-05: Validate Transfer Hook account count
require!(
    ctx.remaining_accounts.len() == 4,
    CurveError::InvalidHookAccounts
);
```

New error variant needed in `bonding_curve/src/error.rs`:
```rust
/// Transfer Hook remaining_accounts count mismatch (expected 4).
#[msg("Invalid hook accounts -- expected exactly 4 remaining accounts")]
InvalidHookAccounts,
```

### DEF-06: Carnage Pool Owner Constraint

Two files: `execute_carnage.rs` and `execute_carnage_atomic.rs`.

Change pool account declarations from:
```rust
#[account(mut)]
pub crime_pool: AccountInfo<'info>,
```
To:
```rust
#[account(mut, owner = amm_program_id() @ EpochError::InvalidAmmProgram)]
pub crime_pool: AccountInfo<'info>,
```

Same for `fraud_pool`. The `amm_program_id()` function already exists in epoch-program constants. `EpochError::InvalidAmmProgram` already exists.

### DEF-07: Checked Token::from_u8

In `consume_randomness.rs` line 194, replace:
```rust
// BEFORE:
let tax_config = derive_taxes(&vrf_result, Token::from_u8_unchecked(epoch_state.cheap_side));

// AFTER:
let current_token = Token::from_u8(epoch_state.cheap_side)
    .ok_or(EpochError::InvalidCheapSide)?;
let tax_config = derive_taxes(&vrf_result, current_token);
```

New error variant needed in `epoch-program/src/errors.rs`:
```rust
/// cheap_side value is not a valid Token variant (expected 0 or 1)
#[msg("Invalid cheap_side value -- expected 0 (CRIME) or 1 (FRAUD)")]
InvalidCheapSide,
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `value as u64` truncating cast | `u64::try_from(value)?` checked | Always available in Rust | Catches overflow instead of silent truncation |
| No owner check on byte reads | `require!(*info.owner == program)` | Standard Anchor pattern | Prevents spoofed account attacks |
| No struct padding | `reserved: [u8; N]` padding | Common Anchor pattern | Allows schema evolution without migration |

## Open Questions

1. **reserved field position and initialization:**
   - What we know: `reserved` must go before `initialized` and `bump` to maintain their position. Both structs must match.
   - What's unclear: Whether `initialize_epoch_state` instruction already uses a space allocation that accommodates the new size (it does -- Anchor `init` uses `space = LEN` from the struct).
   - Recommendation: Update `LEN` constant, add `reserved: [0u8; 64]` to initialization logic.

2. **Callers of read_pool_reserves:**
   - What we know: Called in `swap_sol_buy.rs` and `swap_sol_sell.rs`.
   - What's unclear: Whether callers already handle reversal or assume (reserve_a, reserve_b) = (SOL, token).
   - Recommendation: Read both call sites during implementation to verify convention. With NATIVE_MINT always lowest, the current code may already work correctly on current devnet keys. But the fix should be robust for any key ordering.

3. **Carnage slippage as u64 casts (execute_carnage.rs lines 435, 440):**
   - What we know: These compute `expected` and `min_output` from u128 math chain ending in `as u64`.
   - What's unclear: Whether these are mathematically bounded (expected < reserve_token < u64::MAX). They likely are, but defense-in-depth means checking anyway.
   - Recommendation: Replace with `u64::try_from().map_err(|_| error!(EpochError::Overflow))?`

## Sources

### Primary (HIGH confidence)
- Source code review of all affected files (direct read)
- Phase 52.1 `is_reversed` implementation (established pattern, documented in MEMORY.md)
- Phase 47 HOOK_ACCOUNTS_PER_MINT = 4 constant (established, documented in MEMORY.md)

### Secondary (MEDIUM confidence)
- Rust stdlib documentation for `u64::try_from(u128)` (stable since Rust 1.0)
- Anchor `#[repr(C)]` compatibility with `#[account]` (widely used pattern)

### Tertiary (LOW confidence)
- None -- all findings based on direct code review.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all Rust/Anchor stdlib
- Architecture: HIGH -- patterns are established in existing codebase (Phase 52.1, Phase 47)
- Pitfalls: HIGH -- based on direct code inspection and known project history

**Research date:** 2026-03-08
**Valid until:** Indefinite -- these are Rust language features and Anchor framework patterns that don't change
