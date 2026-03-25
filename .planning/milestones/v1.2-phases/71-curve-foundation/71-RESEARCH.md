# Phase 71: Curve Foundation - Research

**Researched:** 2026-03-03
**Domain:** Solana/Anchor bonding curve program -- linear pricing, quadratic solver, integer arithmetic, property testing
**Confidence:** HIGH (verified against existing codebase, Solana platform-tools, Rust stable docs, and spec)

## Summary

Phase 71 builds the 7th on-chain Anchor program: a standalone bonding curve where users buy tokens on two independent linear curves (CRIME + FRAUD). The math is a linear integral solved via the quadratic formula, implemented entirely in u128 integer arithmetic with 1e12 precision scaling. This phase covers buy-only (sell is Phase 72).

The key technical discovery is that **Rust's `u128::isqrt()` is available on-chain** -- the SBF platform-tools ship with rustc 1.84.1, and `isqrt()` was stabilized in 1.84.0. This eliminates the need for a hand-rolled Newton's method integer square root, using the standard library's Karatsuba square root algorithm instead (proven correct, zero dependencies).

The project's existing patterns (Anchor 0.32.1, Token-2022 InterfaceAccounts, proptest 1.9, LiteSVM 0.9.1, checked arithmetic, feature-gated mint addresses, `localnet` feature for test flexibility) apply directly. The bonding curve program follows the same structure as `conversion-vault` but with curve math in a `math.rs` module.

**Primary recommendation:** Build from scratch using existing project patterns. Use `u128::isqrt()` for the quadratic solver. Proptest for pure math (500K iterations), LiteSVM for on-chain instruction tests, Kani for formal overflow verification via `kamiyo-kani` crate.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework | Project standard, matches all 6 existing programs |
| anchor-spl | 0.32.1 (features: `token_2022`) | Token-2022 account types | Required for InterfaceAccount<TokenAccount>, InterfaceAccount<Mint> |
| Rust std `u128::isqrt()` | stable since 1.84.0 | Integer square root for quadratic solver | Available on SBF (platform-tools rustc 1.84.1). Karatsuba algorithm, proven correct, 0 CU overhead vs hand-rolled |

### Testing

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| proptest | 1.9 | Property-based testing for pure math functions | Fuzz `calculate_tokens_out`, `calculate_sol_for_tokens`, `integer_sqrt` (if kept), overflow boundaries. 500K+ iterations. |
| litesvm | 0.9.1 | In-process Solana VM for instruction-level tests | Full buy instruction tests: account creation, SOL transfer, token transfer, state updates, cap enforcement |
| solana-sdk | 2.2 | Test account creation, program pack | LiteSVM test helpers |
| solana-address/keypair/signer/message/transaction/account/instruction | 2.0-3.3 (various) | LiteSVM type compatibility | Required for LiteSVM's Solana 3.x modular types (see AMM Cargo.toml pattern) |
| sha2 | 0.10 | Anchor discriminator computation in tests | Instruction data construction |
| kamiyo-kani | 0.1.1 | Kani formal verification primitives for Solana | Overflow proofs, value conservation proofs. `[dev-dependencies]` only. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `u128::isqrt()` (stdlib) | Hand-rolled Newton's method (~15 lines) | Context decision says "hand-rolled Newton's method" but stdlib isqrt is now available on SBF (1.84.1). **Recommend stdlib** -- proven correct, zero maintenance, Karatsuba algorithm, const fn. Falls back to hand-rolled ONLY if SBF compilation fails with isqrt (unlikely but testable). |
| `ra-solana-math` crate | Heavy dependency (U256, 1e18 precision) | Overkill. We need exactly one operation: integer square root. 1e12 precision is sufficient per spec. No need for log/exp/pow. |
| `brine-fp` crate | 192-bit fixed-point with log/exp | Same -- overkill. Linear curve needs only basic arithmetic + sqrt. |
| `integer-sqrt` crate (0.1.5) | External Newton's method impl | Unnecessary now that stdlib has isqrt. Also hasn't been updated in 4+ years. |
| `proptest-derive` | Auto-derive Arbitrary for structs | Not needed -- we generate primitive inputs (u64, u128) and derive struct fields via percentage-based strategies |

**Installation (Cargo.toml):**
```toml
[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token_2022"] }

[dev-dependencies]
proptest = "1.9"
litesvm = "0.9.1"
solana-sdk = "2.2"
solana-program = "2.2"
spl-token-2022 = "8.0"
spl-associated-token-account = "7.0"
solana-address = "2.0"
solana-keypair = "~3.1"
solana-signer = "~3.0"
solana-message = "~3.0"
solana-transaction = { version = "~3.0", features = ["verify"] }
solana-account = "3.3"
solana-instruction = "~3.1"
sha2 = "0.10"
kamiyo-kani = "0.1.1"

[features]
default = []
devnet = []
localnet = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

---

## Architecture Patterns

### Recommended Project Structure

```
programs/bonding_curve/
├── Cargo.toml
├── src/
│   ├── lib.rs              # declare_id!, #[program] mod with instruction dispatch
│   ├── constants.rs         # All curve constants (P_START, P_END, TOTAL_FOR_SALE, PRECISION, etc.)
│   ├── error.rs             # CurveError enum
│   ├── state.rs             # CurveState, CurveStatus, Token enum
│   ├── math.rs              # Pure math: calculate_tokens_out, calculate_sol_for_tokens, get_current_price
│   └── instructions/
│       ├── mod.rs           # Re-exports
│       ├── initialize_curve.rs  # InitializeCurve accounts struct + handler
│       ├── fund_curve.rs        # FundCurve accounts struct + handler
│       ├── start_curve.rs       # StartCurve accounts struct + handler
│       └── purchase.rs          # Purchase accounts struct + handler (buy_tokens)
└── tests/                   # Rust-side tests (LiteSVM)
    └── test_bonding_curve.rs
```

**Rationale:** Matches existing program structure (see conversion-vault: `lib.rs` -> `instructions/` -> `state.rs` -> `constants.rs` -> `error.rs`). The `math.rs` module is new but analogous to `programs/staking/src/helpers/math.rs` (pure math with proptest).

### Pattern 1: Constants Module with Feature-Gated Addresses

**What:** All curve parameters as named constants. Mint addresses feature-gated for devnet/localnet.
**When to use:** Always -- prevents magic numbers, enables devnet/mainnet switching.
**Source:** Existing `programs/conversion-vault/src/constants.rs`

```rust
// constants.rs
use anchor_lang::prelude::*;

pub const PRECISION: u128 = 1_000_000_000_000; // 1e12

// Curve parameters (from Bonding_Curve_Spec.md Section 3.2)
pub const P_START: u128 = 900;                           // 0.0000009 SOL in lamports-per-million-tokens scaling
pub const P_END: u128 = 3_450;                           // 0.00000345 SOL
pub const TOTAL_FOR_SALE: u128 = 460_000_000_000_000;    // 460M tokens with 6 decimals
pub const TARGET_TOKENS: u64 = 460_000_000_000_000;      // Same as u64 for state comparison
pub const TARGET_SOL: u64 = 1_000_000_000_000;           // 1000 SOL in lamports
pub const MAX_TOKENS_PER_WALLET: u64 = 20_000_000_000_000; // 20M with 6 decimals
pub const MIN_PURCHASE_SOL: u64 = 50_000_000;            // 0.05 SOL
pub const DEADLINE_SLOTS: u64 = 432_000;                 // ~48 hours at 400ms/slot
pub const TOKEN_DECIMALS: u8 = 6;

// PDA seeds
pub const CURVE_SEED: &[u8] = b"curve";
pub const CURVE_TOKEN_VAULT_SEED: &[u8] = b"curve_token_vault";
pub const CURVE_SOL_VAULT_SEED: &[u8] = b"curve_sol_vault";
pub const TAX_ESCROW_SEED: &[u8] = b"tax_escrow";

// Feature-gated mint addresses (same pattern as conversion-vault)
#[cfg(feature = "devnet")]
pub fn crime_mint() -> Pubkey {
    use std::str::FromStr;
    Pubkey::from_str("42WFgfkXy4M5bzcReUCuyQDUmNUjrPpw8DY2r7DwTqAr").unwrap()
}
// ... etc for fraud_mint, profit_mint
```

### Pattern 2: Pure Math Module with Proptest

**What:** All curve math in a standalone `math.rs` with `#[cfg(test)]` proptest block.
**When to use:** Any program with non-trivial math.
**Source:** Existing `programs/staking/src/helpers/math.rs` (see code examples below)

The math module exports pure functions that take primitives and return `Result<u64>`. No account access, no Anchor types (except error). This makes proptest trivial -- no mocking needed.

### Pattern 3: LiteSVM Integration Tests

**What:** Full instruction tests using LiteSVM in-process VM.
**When to use:** Any test requiring actual on-chain account state, PDA creation, CPI.
**Source:** Existing `programs/amm/tests/test_pool_initialization.rs`

Key patterns from the existing codebase:
- Type bridge: `fn addr(pk: &Pubkey) -> Address` converts Anchor Pubkey to LiteSVM Address via `.to_bytes()`
- Program loading: `svm.add_program_from_file(program_id, "path/to/program.so")`
- Instruction building: manual `Instruction` construction with Anchor discriminator (SHA256 of `"global:<fn_name>"`)
- Solana 3.x modular crates for LiteSVM types (separate from Anchor's Solana 2.x types)

### Pattern 4: Token-2022 Vault PDA (Token Account owned by program PDA)

**What:** PDA-derived token accounts for holding curve tokens.
**When to use:** Any program that needs to hold Token-2022 tokens in a program-controlled vault.
**Source:** Existing `programs/conversion-vault/src/instructions/initialize.rs`

```rust
// Token vault PDA -- authority is the curve_state PDA
#[account(
    init,
    payer = authority,
    token::mint = token_mint,
    token::authority = curve_state,  // curve_state PDA is the authority
    token::token_program = token_program,
    seeds = [CURVE_TOKEN_VAULT_SEED, token_mint.key().as_ref()],
    bump,
)]
pub token_vault: InterfaceAccount<'info, TokenAccount>,
```

**Critical:** The vault's authority is the `curve_state` PDA, NOT the program itself. Transfers out of the vault require PDA signer seeds for `curve_state`. This matches the conversion-vault pattern where `vault_config` is the authority for all three vault token accounts.

### Pattern 5: SOL Vault as Data-less PDA

**What:** A program-owned PDA that holds only SOL (lamports), no data.
**When to use:** When the program needs to hold and release SOL (e.g., curve SOL vault, tax escrow).
**Source:** Bonding_Curve_Spec.md Section 5.7 (tax escrow as 0-byte SOL-only PDA)

```rust
// SOL vault -- 0 bytes data, just holds lamports
#[account(
    init,
    payer = authority,
    space = 0,  // No data, just lamports
    seeds = [CURVE_SOL_VAULT_SEED, token_mint.key().as_ref()],
    bump,
)]
/// CHECK: SOL-only PDA, validated by seeds constraint
pub sol_vault: AccountInfo<'info>,
```

SOL transfers to/from this PDA use direct lamport manipulation:
```rust
// Transfer SOL out of PDA (program-owned, so direct lamport mutation is safe)
**ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= amount;
**ctx.accounts.user.try_borrow_mut_lamports()? += amount;
```

**Note on `init` for 0-byte accounts:** Anchor's `init` with `space = 0` creates the account with the rent-exempt minimum for 0 bytes (~890,880 lamports). This must be accounted for when reading the vault balance:
```rust
let rent = Rent::get()?;
let rent_exempt = rent.minimum_balance(0);
let available_sol = sol_vault.lamports() - rent_exempt;
```

### Anti-Patterns to Avoid

- **Using `f64` for any on-chain math:** BPF has limited float support; nondeterministic across validators. All math must be integer-only.
- **Using `prop_assume!` for input filtering:** Causes >50% rejection rates. Use percentage-based derivation instead (derive constrained values from unconstrained percentages). Project has a documented memory note about this.
- **Mixing Anchor Pubkey and LiteSVM Address types:** They are both `[u8; 32]` wrappers but are different types. Always convert at the boundary with `Address::from(pk.to_bytes())` and `Pubkey::new_from_array(addr.0)`.
- **Trusting `sol_raised` field for financial calculations:** The spec explicitly warns that `sol_raised` is a cumulative counter. The actual vault lamport balance is authoritative for solvency calculations.
- **Using `transfer_checked` from anchor-spl for Token-2022 with hooks:** The existing codebase has a documented bug where Anchor's CPI framework does not forward `remaining_accounts` through Transfer Hook CPIs. Use the manual `invoke_signed` pattern from `conversion-vault/src/helpers/hook_helper.rs`. However, for Phase 71 (buy instruction), token transfers are from PDA vault to user ATA -- the Transfer Hook whitelist should already cover this. Verify during implementation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Integer square root | Newton's method iteration loop | `u128::isqrt()` (Rust stdlib) | Stabilized in 1.84.0, available on SBF platform-tools 1.51 (rustc 1.84.1). Uses Karatsuba algorithm. Proven correct by Rust's own test suite. Zero maintenance. **Context decision says hand-rolled, but this is a strictly superior option that didn't exist at decision time.** |
| Anchor instruction dispatch | Manual entrypoint routing | Anchor's `#[program]` macro + `#[derive(Accounts)]` | Project standard. All 6 programs use this pattern. |
| Token-2022 account validation | Manual deserialization + owner checks | `InterfaceAccount<'info, TokenAccount>` / `InterfaceAccount<'info, Mint>` | Anchor validates owner, discriminator, mint match, authority match automatically via constraints. |
| PDA derivation | Manual `Pubkey::find_program_address` | Anchor `seeds` + `bump` constraints | Anchor handles PDA derivation and bump storage in `#[derive(Accounts)]` structs. |
| Proptest strategy composition | Custom `Strategy` implementations | `prop_map`, `prop_flat_map`, percentage-based derivation | See existing staking math.rs for the exact pattern used in this project. |

**Key insight:** The spec's pseudocode for `integer_sqrt` (Section 4.4) uses Newton's method. The CONTEXT.md decision says "Hand-rolled Newton's method (~15 lines, no external dependency)." However, `u128::isqrt()` became available in Rust 1.84.0 (Jan 2025), and the SBF platform-tools (v1.51, rustc 1.84.1) include it. **This is a decision that should be revisited with the user** -- stdlib isqrt is strictly better (proven correct, const fn, zero maintenance, uses Karatsuba which is algorithmically faster for large values). The hand-rolled approach is a fallback ONLY if SBF compilation somehow rejects isqrt.

---

## Common Pitfalls

### Pitfall 1: Precision Scaling Mismatch Between Spec Pseudocode and Constants

**What goes wrong:** The spec (Section 4.4) defines `P_START = 900` and `P_END = 3450`, which are "lamports per million tokens" scaled by some implicit factor. The `PRECISION = 1e12` constant is applied to scale everything to u128 arithmetic. If the relationship between P_START, P_END, TOTAL_FOR_SALE, and PRECISION is not exactly right, the total integral over the full curve will not equal exactly 1000 SOL.

**Why it happens:** The spec shows conceptual formulas. The implementer must translate these into exact integer arithmetic that satisfies the identity `integral(0, 460M) = 1000 SOL (in lamports)`. Off-by-one in the precision scaling leads to the curve raising 999.99 or 1000.01 SOL instead of exactly 1000.

**How to avoid:**
1. Write a unit test that computes `calculate_sol_for_tokens(0, TARGET_TOKENS)` and asserts it equals exactly `TARGET_SOL` (1000 SOL = 1,000,000,000,000 lamports) or is within 1 lamport.
2. Write the reverse: `calculate_tokens_out(TARGET_SOL, 0)` should return exactly `TARGET_TOKENS` or within 1 token.
3. These tests must pass BEFORE any other work proceeds.

**Warning signs:** Proptest finds cases where vault balance drifts from expected integral.

### Pitfall 2: Quadratic Formula Discriminant Overflow

**What goes wrong:** The discriminant `(a + b*x1)^2 + 2*b*S` can overflow u128 if the intermediate values are not carefully managed. With `PRECISION = 1e12`, the squared term can reach `(1e12 * 3450)^2 = ~1.19e31`, which is within u128 range (`~3.4e38`). But adding `2*b*S` where S could be up to 1000 SOL = 1e12 lamports scaled by PRECISION = 1e24 can push the total to ~1e31 + ~1e25 which is fine. However, with different precision choices or at curve extremes, overflow is possible.

**Why it happens:** u128 arithmetic has hard limits. The quadratic formula involves squaring a product of PRECISION and price parameters.

**How to avoid:**
1. Document the maximum intermediate value at every step of `solve_linear_integral`.
2. Property test with extreme inputs: max SOL input (1000 SOL), max tokens_sold (460M).
3. Kani proof: formally verify that no overflow occurs for all valid input ranges.
4. If overflow is detected, restructure the formula to divide before squaring where possible (trading precision for range).

**Warning signs:** `checked_mul` returning `None` during proptest runs.

### Pitfall 3: Rent-Exempt Minimum in SOL Vault Accounting

**What goes wrong:** The SOL vault PDA is created with `space = 0`, so it gets the minimum rent-exempt balance (~890,880 lamports = ~0.00089 SOL). If the program does not account for this when computing available SOL, it could try to transfer out the rent-exempt lamports, causing the account to become non-rent-exempt and be garbage-collected.

**Why it happens:** `sol_vault.lamports()` includes the rent-exempt minimum. Naive subtraction can underflow or leave the account below rent-exempt.

**How to avoid:**
1. Always compute available balance as `sol_vault.lamports() - rent.minimum_balance(0)`.
2. Use `Rent::get()?.minimum_balance(0)` to get the current rent-exempt minimum dynamically.
3. Property test: after any sequence of buys, `sol_vault.lamports() >= rent.minimum_balance(0)`.

**Warning signs:** Transaction failure with "insufficient lamports" on the sol_vault account.

### Pitfall 4: CurveState Account Size Calculation

**What goes wrong:** Anchor's `init` requires a `space` parameter. If the size calculation is wrong (even by 1 byte), the account is too small and deserialization fails on subsequent reads, or it's too large and wastes rent.

**Why it happens:** The spec (Section 5.1) lists 191 bytes + 8 discriminator = 199 bytes. But the actual serialized size depends on Borsh serialization alignment. Enum variants (Token, CurveStatus) serialize as a single byte tag. Pubkeys are always 32 bytes. But if any padding is added by Borsh or Anchor, the calculation is off.

**How to avoid:**
1. Define a `const LEN` on the state struct that explicitly adds discriminator + all field sizes.
2. Verify with a test: create the struct with all fields at max values, serialize it, check the length matches LEN.
3. Use Anchor's `space = CurveState::LEN` in the `init` constraint.
4. Follow existing pattern from `VaultConfig::LEN` in conversion-vault.

**Warning signs:** "Account not large enough" errors when reading CurveState after initialization.

### Pitfall 5: Token-2022 Transfer Hook Accounts for Curve Token Vault

**What goes wrong:** CRIME and FRAUD tokens use Token-2022 with a Transfer Hook. Every `transfer_checked` instruction for these tokens needs 4 extra accounts (ExtraAccountMetaList PDA, whitelist source, whitelist dest, hook program). If the bonding curve's buy instruction does not include these as `remaining_accounts`, the token transfer CPI will fail with error 3005 (AccountNotEnoughKeys).

**Why it happens:** The Transfer Hook is an extension on the mint. Any program that transfers these tokens must forward the hook accounts. The existing codebase handles this with the manual `invoke_signed` pattern in `hook_helper.rs`.

**How to avoid:**
1. Use the existing `transfer_t22_checked` helper pattern from `conversion-vault/src/helpers/hook_helper.rs`.
2. Client-side: resolve hook accounts using `createTransferCheckedWithTransferHookInstruction` (or manual PDA derivation).
3. On-chain: accept hook accounts via `ctx.remaining_accounts` and pass them to the transfer CPI.
4. The curve token vault must be in the Transfer Hook whitelist. Check that entries #11-12 in the whitelist table cover curve vaults (per spec Section 16.2).

**Warning signs:** Error 3005 on token transfer CPIs.

### Pitfall 6: Participant Count Double-Counting

**What goes wrong:** The spec increments `participant_count` when `user_ata_balance == 0` (first purchase). But if a user sells all tokens and buys again, the ATA balance is 0 again, and participant_count increments twice for the same user.

**Why it happens:** ATA balance reads are stateless -- there's no "has this user ever bought before" flag without a per-user PDA.

**How to avoid:** The spec explicitly says this is acceptable: "If a user sells all tokens and buys again, they are NOT double-counted because `participant_count` is a convenience stat, not a security-critical field." Accept this as-is. Do NOT add a ParticipantState PDA to fix it -- that was explicitly removed in v1.2.

**Warning signs:** participant_count exceeds actual unique wallets. Not a security issue.

---

## Code Examples

### Core Curve Math (calculate_tokens_out)

Verified pattern from spec Section 4.4, adapted for `u128::isqrt()`:

```rust
// math.rs -- Pure math, no Anchor/Solana dependencies except error type

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::CurveError;

/// Calculate tokens received for a given SOL input.
/// Uses closed-form solution of the linear integral (quadratic formula).
///
/// For linear curve P(x) = a + bx:
///   Quadratic: (b/2)*dx^2 + (a + b*x1)*dx - S = 0
///   Solution:  dx = (-(a + b*x1) + sqrt((a + b*x1)^2 + 2*b*S)) / b
///
/// All intermediate arithmetic in u128 with PRECISION scaling.
/// Rounding: floor (protocol-favored -- user gets slightly fewer tokens).
pub fn calculate_tokens_out(
    sol_lamports: u64,
    current_sold: u64,
) -> Result<u64> {
    let a = P_START * PRECISION;
    let b = ((P_END - P_START) * PRECISION) / TOTAL_FOR_SALE;
    let x1 = current_sold as u128;
    let s = sol_lamports as u128 * PRECISION;

    // Linear coefficient: a + b*x1
    let coef_linear = a + (b * x1 / PRECISION);

    // Discriminant: (a + b*x1)^2 + 2*b*S
    let discriminant = coef_linear
        .checked_mul(coef_linear)
        .ok_or(CurveError::Overflow)?
        / PRECISION
        + 2u128
            .checked_mul(b)
            .ok_or(CurveError::Overflow)?
            .checked_mul(s)
            .ok_or(CurveError::Overflow)?
            / PRECISION;

    // Integer square root -- use Rust stdlib (available on SBF since rustc 1.84.1)
    let sqrt_disc = discriminant.isqrt();

    // dx = (sqrt_disc - coef_linear) * PRECISION / b
    // Only positive root is valid
    require!(sqrt_disc >= coef_linear, CurveError::Overflow);
    let delta_x = (sqrt_disc - coef_linear)
        .checked_mul(PRECISION)
        .ok_or(CurveError::Overflow)?
        / b;

    // Floor to u64 (protocol-favored rounding)
    Ok(delta_x as u64)
}

/// Get current price at a given tokens_sold position.
/// P(x) = P_start + (P_end - P_start) * x / TOTAL_FOR_SALE
pub fn get_current_price(tokens_sold: u64) -> u64 {
    let price_delta = P_END - P_START;
    let progress = (tokens_sold as u128 * PRECISION) / TOTAL_FOR_SALE;
    let price = P_START + (price_delta * progress / PRECISION);
    price as u64
}
```

### Proptest Pattern (Percentage-Based Derivation)

From existing `programs/staking/src/helpers/math.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500_000))]

        /// No overflow for any valid input in the buy range.
        #[test]
        fn buy_no_overflow(
            sol_lamports in MIN_PURCHASE_SOL..=TARGET_SOL,
            // Derive current_sold as a percentage to avoid rejection
            sold_pct in 0u64..=999_999u64,
        ) {
            // Scale sold_pct to [0, TARGET_TOKENS - 1]
            let current_sold = ((TARGET_TOKENS as u128) * (sold_pct as u128) / 1_000_000u128) as u64;

            let result = calculate_tokens_out(sol_lamports, current_sold);
            // Must not panic -- Ok or Err both acceptable
            match result {
                Ok(tokens) => {
                    prop_assert!(tokens > 0, "Got 0 tokens for {} lamports", sol_lamports);
                    prop_assert!(tokens <= TARGET_TOKENS - current_sold,
                        "Got more tokens than remaining supply");
                }
                Err(_) => {
                    // Overflow error is acceptable for extreme combinations
                }
            }
        }

        /// Vault solvency: SOL collected >= expected from integral
        #[test]
        fn vault_solvency(
            num_buys in 1u32..=100u32,
            buy_pct in proptest::collection::vec(1u64..=1_000_000u64, 1..=100),
        ) {
            // ... simulate sequence of buys, verify vault >= integral at each step
        }
    }
}
```

### LiteSVM Integration Test Pattern

From existing `programs/amm/tests/test_pool_initialization.rs`:

```rust
use litesvm::LiteSVM;
use solana_address::Address;
use solana_keypair::Keypair as LiteKeypair;
use solana_signer::Signer as LiteSigner;
use anchor_lang::prelude::Pubkey;

fn addr(pk: &Pubkey) -> Address { Address::from(pk.to_bytes()) }
fn pk(a: &Address) -> Pubkey { Pubkey::new_from_array(a.0) }

#[test]
fn test_initialize_and_buy() {
    let mut svm = LiteSVM::new();

    // Load compiled program
    let program_id: Pubkey = "BONDING_CURVE_PROGRAM_ID".parse().unwrap();
    svm.add_program_from_file(
        addr(&program_id),
        "target/deploy/bonding_curve.so",
    );

    // Fund test accounts, create mints, etc.
    // Build instruction with Anchor discriminator
    let discriminator = {
        let mut hasher = sha2::Sha256::new();
        hasher.update(b"global:purchase");
        let hash = hasher.finalize();
        hash[..8].to_vec()
    };

    // ... construct instruction data, accounts, sign and send
}
```

### Kani Formal Verification Example

From `kamiyo-kani` patterns:

```rust
#[cfg(kani)]
mod kani_proofs {
    use super::*;

    /// Prove: calculate_tokens_out never overflows for valid input ranges
    #[kani::proof]
    fn tokens_out_no_overflow() {
        let sol_lamports: u64 = kani::any();
        let current_sold: u64 = kani::any();

        // Bound to valid ranges
        kani::assume(sol_lamports >= MIN_PURCHASE_SOL);
        kani::assume(sol_lamports <= TARGET_SOL);
        kani::assume(current_sold < TARGET_TOKENS);

        let result = calculate_tokens_out(sol_lamports, current_sold);
        // Must not panic (checked arithmetic returns Err, never panics)
        if let Ok(tokens) = result {
            kani::assert(tokens <= TARGET_TOKENS - current_sold,
                "Cannot exceed remaining supply");
        }
    }
}
```

Run with: `cargo kani -p bonding-curve` (requires Kani installation: `cargo install --locked kani-verifier && cargo kani setup`)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled Newton's method for isqrt | `u128::isqrt()` in Rust stdlib | Rust 1.84.0 (Jan 2025), available on SBF platform-tools v1.51 | Eliminates ~15 lines of hand-rolled code. Karatsuba algorithm is faster for large values. Proven correct. |
| `solana-test-validator` for integration tests | LiteSVM in-process VM | LiteSVM 0.9.x (2025) | 25x faster tests, no external process, fine-grained time/slot control |
| TypeScript/Mocha for Anchor tests | Rust LiteSVM tests | 2025 | Type-safe, faster, same language as program code |
| Manual proptest strategies | Percentage-based derivation | Project convention | Avoids >50% rejection rates from `prop_assume!` |

**Deprecated/outdated:**
- `solana-program-test`: Superseded by LiteSVM for most use cases. LiteSVM is faster and has a simpler API.
- `bankrun` (TypeScript): Useful for TS tests but Rust LiteSVM is preferred for this project.
- `anchor test` (TypeScript/Mocha): Still works but significantly slower than LiteSVM for large test suites.

---

## Open Questions

### 1. stdlib `isqrt()` vs Hand-Rolled Newton's Method

**What we know:** The CONTEXT.md decision says "Hand-rolled Newton's method (~15 lines)." However, `u128::isqrt()` is now available on the SBF target (platform-tools v1.51, rustc 1.84.1). The stdlib uses the Karatsuba square root algorithm, which is proven correct and is a `const fn`.

**What's unclear:** Whether the user wants to use the stdlib function given it contradicts the explicit context decision. The context decision was likely made before discovering that isqrt was available on SBF.

**Recommendation:** Confirm with user. Strongly recommend `u128::isqrt()` -- it is strictly superior. If the user wants defense-in-depth, we can write a proptest that verifies `isqrt()` matches our expectations for all relevant inputs, but the implementation itself should use stdlib.

### 2. Kani Installation and CI Integration

**What we know:** `kamiyo-kani` (0.1.1) provides Solana-focused verification primitives. Kani itself requires separate installation (`cargo install --locked kani-verifier && cargo kani setup`). It runs separately from `cargo test`.

**What's unclear:** Whether Kani is already installed in the dev environment. Whether CI has Kani support. Whether the bounded model checking time for u128 ranges is practical (Kani can be slow for large integer spaces).

**Recommendation:** Install Kani locally and run a minimal proof first. If it completes in reasonable time (<5 minutes for the overflow proof), integrate into the test suite. If not, rely on proptest 500K iterations as the primary safety net and defer Kani to a later phase.

### 3. Single vs Dual Initialize Instruction

**What we know:** The CONTEXT.md says "Single instruction creates both CurveState PDAs atomically." The spec (Section 8.1) shows `initialize_curve` as a per-token instruction. The context also says "If account limits are too tight (~13-14 accounts), fall back to two instructions."

**What's unclear:** The exact account count for a dual-init instruction. Each curve needs: curve_state (init), token_vault (init), sol_vault (init), tax_escrow (init), token_mint (read). That's ~10 accounts per curve = ~20 accounts + payer + system_program + token_program = ~23 accounts. This exceeds comfortable limits for a single TX but is technically possible with Anchor (no 1232-byte limit for account structs, only for the full TX).

**Recommendation:** Start with the single-instruction approach (both curves in one TX). If the Anchor discriminator + serialized args + 23 account keys exceed the TX size limit, fall back to per-curve initialization as the spec describes. This is an implementation discovery, not a design decision.

### 4. Transfer Hook Account Forwarding for Buy Instruction

**What we know:** Token transfers from the curve's token vault to the user's ATA will trigger the Transfer Hook. The existing `hook_helper::transfer_t22_checked` pattern handles this via `remaining_accounts`.

**What's unclear:** Whether the bonding curve's token vault PDA is already in the Transfer Hook whitelist. The spec (Section 16.2) says "v1.2 bonding curve token vaults are already in the whitelist (entries #11-12)." This needs verification against the actual deployed whitelist.

**Recommendation:** Verify the whitelist entries during implementation. If not yet whitelisted, the bonding curve's `initialize_curve` must also add the vault to the whitelist (or the deploy script must do this separately). For Phase 71 testing with LiteSVM, the whitelist can be configured in the test setup.

---

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/Bonding_Curve_Spec.md` -- All curve math, state accounts, instructions, security analysis (2250 lines, read in full)
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/71-curve-foundation/71-CONTEXT.md` -- User decisions for this phase
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/conversion-vault/src/` -- Existing Anchor program patterns (lib.rs, constants.rs, state.rs, error.rs, instructions/, helpers/)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/helpers/math.rs` -- Proptest integration pattern with percentage-based derivation
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/tests/test_pool_initialization.rs` -- LiteSVM integration test pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/Cargo.toml` -- Dev-dependencies for LiteSVM tests
- SBF platform-tools: `cargo-build-sbf --version` confirmed platform-tools v1.51, rustc 1.84.1
- `rustc --version`: 1.93.0 (host)
- Rust 1.84.0 release notes: `u128::isqrt()` stabilized (https://blog.rust-lang.org/2025/01/09/Rust-1.84.0/)
- Rust tracking issue #116226: isqrt stabilization (https://github.com/rust-lang/rust/issues/116226)

### Secondary (MEDIUM confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/research/STACK_BONDING_CURVE.md` -- Prior stack research (confirmed build-from-scratch recommendation)
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/research/PITFALLS_BONDING_CURVE.md` -- Detailed pitfall analysis for buy+sell mechanics
- `kamiyo-kani` GitHub (https://github.com/kamiyo-ai/kamiyo-kani) -- Kani verification primitives for Solana, 0.1.1, MIT license, created 2026-02-19
- QuickNode LiteSVM guide (https://www.quicknode.com/guides/solana-development/tooling/litesvm) -- LiteSVM setup and patterns
- Solana official LiteSVM docs (https://solana.com/developers/guides/advanced/testing-with-jest-and-bankrun) -- Testing framework guidance
- `rally-dfs/token-bonding-curve` (https://github.com/rally-dfs/token-bonding-curve) -- Reference linear bonding curve implementation (75 stars, SPL Token, old Anchor)

### Tertiary (LOW confidence)
- `ra-solana-math` crate (https://docs.rs/ra-solana-math) -- Fixed-point library for Solana (evaluated, not recommended)
- `brine-fp` crate (https://github.com/zfedoran/brine-fp) -- 192-bit fixed-point (evaluated, not recommended)
- Various Solana Stack Exchange answers on integer arithmetic -- general patterns confirmed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified against existing Cargo.toml files and SBF platform-tools
- Architecture: HIGH -- patterns copied directly from existing programs in the same codebase
- Math approach: HIGH -- spec formulas verified, isqrt availability confirmed on SBF
- Pitfalls: HIGH -- drawn from existing project pitfalls document + codebase analysis
- Kani integration: MEDIUM -- library exists and is Solana-focused, but not yet tested in this project
- Open questions: Flagged honestly for planner awareness

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (30 days -- stable domain, all libraries pinned)
