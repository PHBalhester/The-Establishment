# Phase 8: Foundation & Scaffolding - Research

**Researched:** 2026-02-03
**Domain:** Anchor/Rust AMM workspace setup, constant-product swap math, Solana test infrastructure
**Confidence:** HIGH

## Summary

This phase sets up the Anchor 0.32.1 workspace by forking `arrayappy/solana-uniswap-v2`, upgrading dependencies, restructuring for a multi-program future, implementing the swap math module with u128 checked arithmetic, and establishing dual test infrastructure (litesvm for unit tests, solana-test-validator for future integration tests).

The fork provides a useful starting skeleton (Anchor project structure, basic constant-product swap pattern, PDA patterns) but requires substantial gutting: it uses Anchor 0.29.0, SPL Token only (no T22), `fixed`/`fixed-sqrt` crates for math (we use u128 integers), and has a bug in its k-invariant check. We keep the directory structure pattern and rewrite everything else from our specs.

The math module is the security-critical deliverable. The constant-product formula `amount_out = reserve_out * effective_input / (reserve_in + effective_input)` with LP fee deduction `effective_input = amount_in * (10_000 - fee_bps) / 10_000` must use u128 checked arithmetic throughout. Property-based testing with proptest (10,000 iterations) validates the k-invariant holds across randomized inputs.

**Primary recommendation:** Fork the repo, immediately upgrade to Anchor 0.32.1 + anchor-spl with token/token_2022/associated_token features, strip all existing instruction logic and tests, implement math as a pure Rust module with zero on-chain dependencies, then test exhaustively with proptest + hand-picked edge cases.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Anchor framework for Solana programs | Installed locally, matches project requirement SCAF-01 |
| anchor-spl | 0.32.1 | SPL token CPI helpers (token, token_2022, associated_token) | Official Anchor companion for token operations, requirement SCAF-02 |
| solana-cli | 3.0.13 | Solana toolchain (build, deploy, test-validator) | Installed locally |
| rustc | 1.93.0 | Rust compiler | Installed locally |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| proptest | 1.9.0 (latest) | Property-based testing framework | Math module k-invariant verification, randomized swap simulations (MATH-04, TEST-01) |
| litesvm | latest | Lightweight in-process Solana VM for fast Rust tests | Unit tests for math module, fast iteration (SCAF-03) |
| anchor-litesvm | 0.3.0 | Anchor-aware litesvm wrapper with simplified syntax | Anchor program integration tests in Rust (SCAF-03) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| u128 checked arithmetic | `fixed`/`fixed-sqrt` crates (what fork uses) | External math crates add attack surface and complexity; u128 checked ops are stdlib, auditable, and explicitly required by SCAF-02 |
| u128 checked arithmetic | `uint` crate (U256) | Overkill -- u128 has 1e9 headroom for worst-case scenarios per yield spec precision analysis |
| litesvm | solana-program-test (BanksClient) | solana-program-test is older, slower, and more complex to set up; litesvm is the modern replacement recommended by Anchor docs |
| proptest | quickcheck | proptest has better shrinking, configurable strategies, and is more actively maintained |
| proptest | bolero | bolero is overkill for our needs; proptest is the Rust ecosystem standard |

**Installation (program Cargo.toml):**
```toml
[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token", "token_2022", "associated_token"] }

[dev-dependencies]
proptest = "1.9"
litesvm = "*"
anchor-litesvm = "0.3"

[features]
idl-build = [
    "anchor-lang/idl-build",
    "anchor-spl/idl-build",
]
```

## Architecture Patterns

### Recommended Project Structure

Based on the fork's existing pattern, upgraded for multi-program workspace:

```
Dr Fraudsworth/
├── Anchor.toml                    # Workspace config (programs, cluster, scripts)
├── Cargo.toml                     # Workspace root (members = ["programs/*"])
├── programs/
│   └── amm/                       # AMM program (renamed from solana-uniswap-v2)
│       ├── Cargo.toml             # Program dependencies
│       └── src/
│           ├── lib.rs             # declare_id!, #[program] module, instruction dispatch
│           ├── constants.rs       # Fee BPS, seeds, PDA constants
│           ├── errors.rs          # #[error_code] enum AmmError
│           ├── events.rs          # #[event] structs (SwapEvent, PoolInitializedEvent)
│           ├── helpers/           # Pure logic modules
│           │   ├── mod.rs
│           │   └── math.rs        # Swap math: fee calc, output calc, k-invariant check
│           ├── state/             # Account structs
│           │   ├── mod.rs
│           │   └── pool.rs        # PoolState, PoolType enum
│           └── instructions/      # Instruction handlers
│               ├── mod.rs
│               ├── initialize_pool.rs
│               ├── swap_sol_pool.rs
│               └── swap_profit_pool.rs
├── tests/                         # Integration tests (TypeScript, for later phases)
│   └── .gitkeep
├── keypairs/                      # Wallet keypairs
│   └── devnet-wallet.json
└── Docs/                          # Specification documents
```

**Why this structure:**
- `helpers/math.rs` is a pure Rust module with zero Anchor/Solana dependencies, making it trivially testable with `#[cfg(test)]` and proptest
- `state/` and `instructions/` follow the fork's pattern and standard Anchor convention
- Program renamed from `solana-uniswap-v2` to `amm` (matches our spec naming)
- Future programs (transfer_hook, tax, epoch) will be added as `programs/transfer_hook/`, `programs/tax/`, etc.

### Pattern 1: Pure Math Module (No On-Chain Dependencies)

**What:** The math module contains only pure functions operating on primitive types (u64, u128). No `anchor_lang`, no `Pubkey`, no `Account` types.

**When to use:** Always, for any computational logic that can be separated from account validation.

**Why:** Pure functions are testable without spinning up any Solana VM. Tests run in microseconds, not seconds. This is the key architectural decision that makes 10,000 proptest iterations practical.

**Example:**
```rust
// helpers/math.rs -- NO use anchor_lang::prelude::*;

/// Calculate effective input after LP fee deduction.
/// Returns None on overflow.
pub fn calculate_effective_input(amount_in: u64, fee_bps: u16) -> Option<u128> {
    let amount = amount_in as u128;
    let fee = fee_bps as u128;
    amount.checked_mul(10_000u128.checked_sub(fee)?)?
          .checked_div(10_000)
}

/// Calculate swap output using constant-product formula.
/// Returns None on overflow or division by zero.
pub fn calculate_swap_output(
    reserve_in: u64,
    reserve_out: u64,
    effective_input: u128,
) -> Option<u64> {
    let r_in = reserve_in as u128;
    let r_out = reserve_out as u128;

    let numerator = r_out.checked_mul(effective_input)?;
    let denominator = r_in.checked_add(effective_input)?;

    if denominator == 0 { return None; }

    let output = numerator.checked_div(denominator)?;

    // Output must fit in u64
    if output > u64::MAX as u128 { return None; }

    Some(output as u64)
}

/// Verify k-invariant: k_after >= k_before.
/// Uses u128 multiplication to avoid overflow.
/// Returns None if multiplication overflows u128.
pub fn verify_k_invariant(
    reserve_in_before: u64,
    reserve_out_before: u64,
    reserve_in_after: u64,
    reserve_out_after: u64,
) -> Option<bool> {
    let k_before = (reserve_in_before as u128)
        .checked_mul(reserve_out_before as u128)?;
    let k_after = (reserve_in_after as u128)
        .checked_mul(reserve_out_after as u128)?;
    Some(k_after >= k_before)
}
```

### Pattern 2: Proptest Configuration for AMM Math

**What:** Property-based testing with custom strategies for swap parameters.

**When to use:** Math module verification (TEST-01, MATH-04).

**Example:**
```rust
// In helpers/math.rs or a dedicated test file
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // Strategy: realistic reserve ranges (1 token to 1 billion tokens with 9 decimals)
    fn reserve_strategy() -> impl Strategy<Value = u64> {
        1u64..=1_000_000_000_000_000_000u64  // 1 to 1B tokens (9 decimals)
    }

    // Strategy: realistic swap amounts (1 lamport to 10% of reserve)
    fn swap_amount_strategy() -> impl Strategy<Value = u64> {
        1u64..=100_000_000_000_000_000u64  // up to 100M tokens
    }

    // Strategy: valid fee BPS (0 to 10000)
    fn fee_bps_strategy() -> impl Strategy<Value = u16> {
        0u16..=9999u16  // fee of 10000 bps = 100% would zero out input
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        #[test]
        fn k_invariant_holds_for_valid_swaps(
            reserve_in in reserve_strategy(),
            reserve_out in reserve_strategy(),
            amount_in in swap_amount_strategy(),
            fee_bps in fee_bps_strategy(),
        ) {
            // Skip cases where amount_in > reserve (unrealistic)
            prop_assume!(amount_in < reserve_in);

            let effective = calculate_effective_input(amount_in, fee_bps);
            prop_assume!(effective.is_some());
            let effective = effective.unwrap();

            let output = calculate_swap_output(reserve_in, reserve_out, effective);
            prop_assume!(output.is_some());
            let output = output.unwrap();

            // Skip if output >= reserve_out (would drain pool)
            prop_assume!(output < reserve_out);

            let new_reserve_in = reserve_in + amount_in;  // Pre-fee amount added
            let new_reserve_out = reserve_out - output;

            let k_ok = verify_k_invariant(
                reserve_in, reserve_out,
                new_reserve_in, new_reserve_out,
            );

            prop_assert!(k_ok == Some(true),
                "k-invariant violated: in={}, out={}, amount={}, fee={}, output={}",
                reserve_in, reserve_out, amount_in, fee_bps, output);
        }
    }
}
```

### Pattern 3: litesvm Unit Test Setup

**What:** Fast in-process Solana VM for testing compiled programs.

**When to use:** Program-level tests that need account validation but not full network behavior.

**Example:**
```rust
#[cfg(test)]
mod tests {
    use litesvm::LiteSVM;
    use solana_sdk::{signature::Keypair, signer::Signer};

    #[test]
    fn test_program_loads() {
        let mut svm = LiteSVM::new();
        let program_id = solana_sdk::pubkey::Pubkey::new_unique();

        // Load compiled program
        svm.add_program_from_file(
            program_id,
            "target/deploy/amm.so",
        ).unwrap();

        // Airdrop to payer
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

        // Program is deployed and ready for instruction tests
    }
}
```

### Anti-Patterns to Avoid

- **Floating-point math in swap calculations:** The fork uses `I64F64` fixed-point from the `fixed` crate. Our spec mandates u128 integer arithmetic. Floating-point introduces rounding non-determinism and is a known DeFi exploit vector. Never use `f32`, `f64`, or fixed-point crates for on-chain financial math.

- **Unchecked arithmetic:** Every `+`, `-`, `*`, `/` on amounts MUST use `checked_add`, `checked_sub`, `checked_mul`, `checked_div`. The `overflow-checks = true` in Cargo.toml's release profile catches panics but we want explicit `Option<T>` returns that map to program errors, not runtime panics.

- **Testing math through Solana VM:** Math correctness tests should NOT require spinning up litesvm or solana-test-validator. Pure function tests run 1000x faster and are more precise. Reserve VM-based tests for account validation and CPI logic (later phases).

- **Carrying fork code "just in case":** The fork's swap.rs, deposit_liquidity.rs, withdraw_liquidity.rs, and all test files should be deleted, not commented out. Dead code is a maintenance burden and security review surface. Our specs define exactly what to build.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Property-based test generation | Custom random number generators for test inputs | proptest crate with strategies | proptest has proper shrinking (finds minimal failing case), deterministic replay, and configurable iteration counts |
| Token account creation in tests | Manual account serialization | anchor-litesvm helpers or litesvm `set_account` | Token account layout is 165+ bytes with specific field ordering; getting it wrong causes silent failures |
| PDA derivation | Manual seed concatenation | `Pubkey::find_program_address` | Off-by-one in seed construction is a common Solana bug |
| Overflow detection | Manual bounds checking before operations | Rust's `checked_*` methods | `checked_mul` handles all edge cases including 0, 1, and MAX values correctly |

**Key insight:** The math module is deceptively simple (3 functions, ~30 lines). The complexity is in the edge cases: zero reserves, u64::MAX inputs, fee of 9999 bps (99.99%), output exceeding reserves. proptest finds these edge cases automatically; hand-written tests miss them.

## Common Pitfalls

### Pitfall 1: Fork Anchor Version Mismatch
**What goes wrong:** Building the fork as-is fails because it uses Anchor 0.29.0 and our toolchain is 0.32.1. Anchor 0.29 -> 0.32 has breaking changes in IDL generation, feature flags, and some account validation macros.
**Why it happens:** The fork hasn't been maintained since early 2024.
**How to avoid:** First action after cloning: update ALL Cargo.toml files to `anchor-lang = "0.32.1"` and `anchor-spl = "0.32.1"`. Remove `fixed` and `fixed-sqrt` dependencies. Add `idl-build` feature. Run `anchor build` before writing any code to confirm clean compilation.
**Warning signs:** Cryptic compile errors about missing traits, `idl-build` feature not found, or version conflicts in Cargo.lock.

### Pitfall 2: k-Invariant Bug in Fork
**What goes wrong:** The fork's swap.rs has a bug where the k-invariant check compares `pool_a * pool_a` instead of `pool_a * pool_b`. This means the invariant check is meaningless.
**Why it happens:** Copy-paste error in the original fork code.
**How to avoid:** Our math module is written from scratch based on our AMM_Implementation.md spec (Section 8). The k-invariant check is `k_after = reserve_in_after * reserve_out_after >= reserve_in_before * reserve_out_before`. This is verified by 10,000 proptest iterations.
**Warning signs:** Tests pass when they should fail for invalid swaps.

### Pitfall 3: u128 Overflow at Extreme Values
**What goes wrong:** `u64::MAX * u64::MAX` overflows u128. While realistic reserves never approach u64::MAX, the math module must handle this gracefully.
**Why it happens:** u128 max is ~3.4e38, but u64::MAX * u64::MAX is ~3.4e38, right at the boundary.
**How to avoid:** All multiplications use `checked_mul` which returns `None` on overflow. The calling code maps `None` to an explicit `AmmError::Overflow` program error. proptest specifically includes u64::MAX edge cases.
**Warning signs:** Tests with large values panic instead of returning errors.

### Pitfall 4: Integer Division Rounding Direction
**What goes wrong:** Rust integer division truncates toward zero (rounds down). For swap outputs, this is correct (protocol keeps dust). But if you accidentally round UP, users get more tokens than the math justifies, violating the k-invariant.
**Why it happens:** Confusion about whether to use `checked_div` (truncates) vs. ceiling division.
**How to avoid:** Always use `checked_div` for output calculations. The spec (AMM_Implementation.md Section 8.2) explicitly states "Round down for outputs." proptest validates k_after >= k_before, which would fail if rounding were wrong.
**Warning signs:** k-invariant check fails for some inputs with very small remainders.

### Pitfall 5: Fee of 0 BPS or 10000 BPS
**What goes wrong:** A fee of 0 means no fee (effective_input = amount_in). A fee of 10000 means 100% fee (effective_input = 0), which produces 0 output. Both are mathematically valid but operationally suspicious.
**Why it happens:** Fee BPS is u16 with range 0-65535, but valid protocol values are 50 and 100 per spec.
**How to avoid:** The math module handles all u16 fee values correctly. The instruction layer validates fee_bps is within protocol bounds (50 or 100 per AMM_Implementation.md Section 6). Tests cover fee=0 and fee=10000 as edge cases to verify the math is correct even outside normal bounds.
**Warning signs:** Zero-output swaps silently succeed instead of erroring.

### Pitfall 6: proptest and Solana Program Dependencies Don't Mix
**What goes wrong:** If the math module imports `anchor_lang` or `solana_program`, proptest tests require the entire Solana BPF toolchain to compile, making them extremely slow and fragile.
**Why it happens:** Cargo's feature unification pulls in BPF-specific dependencies.
**How to avoid:** Keep `helpers/math.rs` as a pure Rust module. Zero `use anchor_lang::*` or `use solana_program::*`. Only primitive types (`u64`, `u128`, `u16`, `bool`, `Option<T>`). The instruction layer calls these pure functions and maps `None` to Anchor errors.
**Warning signs:** `cargo test` takes minutes instead of seconds, or fails with BPF linker errors.

## Code Examples

### Example 1: Complete Math Module Structure

```rust
// programs/amm/src/helpers/math.rs

/// Calculate effective input after LP fee deduction.
/// fee_bps: fee in basis points (e.g., 100 = 1%)
/// Returns None if arithmetic overflows.
pub fn calculate_effective_input(amount_in: u64, fee_bps: u16) -> Option<u128> {
    let amount = amount_in as u128;
    let fee_factor = 10_000u128.checked_sub(fee_bps as u128)?;
    amount.checked_mul(fee_factor)?.checked_div(10_000)
}

/// Calculate swap output using constant-product formula.
/// amount_out = reserve_out * effective_input / (reserve_in + effective_input)
/// Returns None on overflow, division by zero, or if output exceeds u64.
pub fn calculate_swap_output(
    reserve_in: u64,
    reserve_out: u64,
    effective_input: u128,
) -> Option<u64> {
    let r_in = reserve_in as u128;
    let r_out = reserve_out as u128;

    let numerator = r_out.checked_mul(effective_input)?;
    let denominator = r_in.checked_add(effective_input)?;

    if denominator == 0 {
        return None;
    }

    let output = numerator.checked_div(denominator)?;

    u64::try_from(output).ok()
}

/// Verify the constant-product invariant: k_after >= k_before.
/// k = reserve_a * reserve_b (computed in u128 to avoid overflow).
/// Returns None if u128 multiplication overflows.
pub fn verify_k_invariant(
    reserve_in_before: u64,
    reserve_out_before: u64,
    reserve_in_after: u64,
    reserve_out_after: u64,
) -> Option<bool> {
    let k_before = (reserve_in_before as u128)
        .checked_mul(reserve_out_before as u128)?;
    let k_after = (reserve_in_after as u128)
        .checked_mul(reserve_out_after as u128)?;
    Some(k_after >= k_before)
}
```

### Example 2: Hand-Picked Unit Tests

```rust
#[cfg(test)]
mod unit_tests {
    use super::*;

    // --- Fee calculation tests ---

    #[test]
    fn fee_100bps_on_1000() {
        // 1% fee on 1000 = effective input of 990
        let result = calculate_effective_input(1000, 100);
        assert_eq!(result, Some(990));
    }

    #[test]
    fn fee_50bps_on_1000() {
        // 0.5% fee on 1000 = effective input of 995
        let result = calculate_effective_input(1000, 50);
        assert_eq!(result, Some(995));
    }

    #[test]
    fn fee_zero_bps() {
        // 0% fee = full amount passes through
        let result = calculate_effective_input(1000, 0);
        assert_eq!(result, Some(1000));
    }

    #[test]
    fn fee_10000_bps() {
        // 100% fee = zero effective input
        let result = calculate_effective_input(1000, 10000);
        assert_eq!(result, Some(0));
    }

    #[test]
    fn fee_on_u64_max() {
        // Must not overflow: u64::MAX * 9900 / 10000
        let result = calculate_effective_input(u64::MAX, 100);
        assert!(result.is_some());
    }

    // --- Swap output tests ---

    #[test]
    fn swap_equal_reserves() {
        // Equal reserves of 1M, swap 1000 with no fee
        // output = 1_000_000 * 1000 / (1_000_000 + 1000) = 999 (truncated)
        let output = calculate_swap_output(1_000_000, 1_000_000, 1000);
        assert_eq!(output, Some(999));
    }

    #[test]
    fn swap_zero_input() {
        // Zero effective input = zero output
        let output = calculate_swap_output(1_000_000, 1_000_000, 0);
        assert_eq!(output, Some(0));
    }

    #[test]
    fn swap_zero_reserve_in() {
        // Zero reserve_in: denominator = 0 + effective_input
        // Should still work if effective_input > 0
        let output = calculate_swap_output(0, 1_000_000, 1000);
        assert_eq!(output, Some(1_000_000)); // Gets entire reserve_out
    }

    #[test]
    fn swap_zero_reserve_out() {
        // Zero reserve_out = zero output regardless of input
        let output = calculate_swap_output(1_000_000, 0, 1000);
        assert_eq!(output, Some(0));
    }

    #[test]
    fn swap_u64_max_reserves() {
        // Must handle u64::MAX reserves without panic
        let output = calculate_swap_output(u64::MAX, u64::MAX, 1000);
        assert!(output.is_some());
    }

    // --- k-invariant tests ---

    #[test]
    fn k_invariant_valid_swap() {
        // Before: 1M * 1M = 1e12
        // Swap 1000 in, get 999 out
        // After: 1_001_000 * 999_001 = 1_000_001_999_001 > 1e12
        let result = verify_k_invariant(1_000_000, 1_000_000, 1_001_000, 999_001);
        assert_eq!(result, Some(true));
    }

    #[test]
    fn k_invariant_rejects_invalid() {
        // If someone gets more out than they should, k decreases
        let result = verify_k_invariant(1_000_000, 1_000_000, 1_001_000, 998_000);
        assert_eq!(result, Some(false));
    }

    #[test]
    fn k_invariant_u64_max_overflow() {
        // u64::MAX * u64::MAX may overflow u128
        let result = verify_k_invariant(u64::MAX, u64::MAX, u64::MAX, u64::MAX);
        // This SHOULD return None (overflow) since u64::MAX^2 > u128::MAX
        // Actually: u64::MAX = 2^64-1, (2^64-1)^2 = 2^128 - 2^65 + 1
        // u128::MAX = 2^128 - 1
        // So (2^64-1)^2 < 2^128, this fits in u128. Result should be Some(true).
        assert_eq!(result, Some(true));
    }
}
```

### Example 3: Workspace Cargo.toml (Root)

```toml
[workspace]
members = ["programs/*"]

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
```

### Example 4: Program Cargo.toml

```toml
[package]
name = "amm"
version = "0.1.0"
description = "Dr Fraudsworth AMM Program"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token", "token_2022", "associated_token"] }

[dev-dependencies]
proptest = "1.9"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

### Example 5: Anchor.toml

```toml
[toolchain]

[features]
resolution = true
skip-lint = false

[programs.localnet]
amm = "PROGRAM_ID_HERE"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "Localnet"
wallet = "keypairs/devnet-wallet.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anchor 0.29.0 (fork version) | Anchor 0.32.1 | 2025 | IDL generation changes, new features like `resolution = true`, updated account macros |
| `solana-program-test` (BanksClient) | litesvm + anchor-litesvm | 2024-2025 | 10-100x faster test execution, simpler API, time-travel support |
| SPL Token only | Token-2022 (anchor-spl token_interface) | 2024 | `InterfaceAccount<TokenAccount>` and `Interface<TokenInterface>` work with both SPL Token and Token-2022 |
| `fixed`/`fixed-sqrt` crates for math | u128 checked arithmetic (stdlib) | Project decision | Zero external dependencies for financial math, explicit overflow handling |
| Single-program Anchor workspace | Multi-program workspace | Standard Anchor pattern | `programs/*` glob in workspace members supports future program additions |

**Deprecated/outdated:**
- `fixed` and `fixed-sqrt` crates: Used by fork for AMM math. We replace with u128 checked arithmetic per SCAF-02.
- `Xargo.toml`: Present in fork, no longer needed for modern Anchor/Solana builds.
- Anchor 0.29.0 patterns: Some macros and feature flags have changed. The `anchor-spl` feature naming is stable but the `idl-build` feature is required in 0.32.1.

## Open Questions

1. **anchor-litesvm version compatibility with Anchor 0.32.1**
   - What we know: anchor-litesvm 0.3.0 is the latest version. It targets the anchor-client API pattern.
   - What's unclear: Whether 0.3.0 is fully compatible with Anchor 0.32.1 (it may target 0.31.x internally). The litesvm crate itself has no Anchor version dependency.
   - Recommendation: For Phase 8, math tests use pure proptest (no Solana VM needed). If anchor-litesvm has compatibility issues, fall back to raw litesvm for any program-level smoke tests. This is LOW risk because Phase 8 math tests don't need anchor-litesvm at all.

2. **Exact proptest strategy distribution for edge cases**
   - What we know: proptest supports arbitrary strategies including `prop_oneof!` for biased distributions, weighted unions for hitting edge cases more frequently.
   - What's unclear: Whether the default uniform distribution adequately covers edge cases, or whether we need explicit bias toward 0, 1, and u64::MAX.
   - Recommendation: Use a combined strategy: 90% uniform realistic range + 10% explicit edge values (0, 1, u64::MAX). This ensures edge cases are hit ~1000 times in a 10,000 iteration run. Claude's discretion per CONTEXT.md.

3. **Whether to keep fork's git history or start fresh**
   - What we know: CONTEXT.md says "literal fork -- clone the repo, preserve git history."
   - What's unclear: Whether `git clone` + `git remote set-url` vs. GitHub fork button matters for the workflow.
   - Recommendation: `git clone` the repo into a subdirectory, then copy the relevant structure into our existing repo. We already have git history in the Dr Fraudsworth repo. The fork's history provides provenance for the Apache-2.0 license compliance. A simple approach: clone the fork, copy the Anchor skeleton files into our workspace, note the fork origin in a comment/LICENSE file.

## Sources

### Primary (HIGH confidence)
- Anchor 0.32.1 official docs (anchor-lang.com/docs/tokens) -- Cargo.toml configuration, anchor-spl features, token_interface patterns
- Anchor 0.32.1 official docs (anchor-lang.com/docs/testing/litesvm) -- litesvm setup and usage
- docs.rs/anchor-spl/latest -- anchor-spl 0.32.1 Cargo.toml features list (token, token_2022, associated_token, idl-build)
- docs.rs/anchor-litesvm -- anchor-litesvm 0.3.0 API documentation
- docs.rs/litesvm -- litesvm core API documentation
- docs.rs/proptest/latest -- proptest 1.9.0 API and configuration (ProptestConfig::with_cases)
- GitHub API: arrayappy/solana-uniswap-v2 -- complete file tree, program structure, Cargo.toml dependencies (Anchor 0.29.0, fixed 1.23.1)
- Local toolchain verification: anchor-cli 0.32.1, solana-cli 3.0.13, rustc 1.93.0

### Secondary (MEDIUM confidence)
- proptest book (proptest-rs.github.io) -- strategy composition, configuration, shrinking behavior
- Anchor multi-program workspace patterns from Solana expert query -- directory structure, Anchor.toml format
- solana-developers/program-examples (GitHub) -- TokenSwap program structure as reference for file organization
- QuickNode guide on litesvm -- practical usage patterns and anchor-litesvm examples

### Tertiary (LOW confidence)
- Exa search results for AMM implementations -- general pattern confirmation, not authoritative for specific versions
- dodecahedr0x Medium article on Uniswap V2 in Solana -- confirms fork's general pattern but predates our Anchor version

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All versions verified against local toolchain and official docs
- Architecture: HIGH -- Patterns drawn from official Anchor docs and established Solana conventions
- Math module: HIGH -- Formula matches AMM_Implementation.md spec exactly, u128 arithmetic is stdlib
- Test infrastructure: HIGH for proptest, MEDIUM for anchor-litesvm (version compat unverified)
- Pitfalls: HIGH -- Verified fork's actual code to confirm k-invariant bug and Anchor version mismatch

**Research date:** 2026-02-03
**Valid until:** 2026-03-05 (30 days -- Anchor and litesvm are stable, proptest changes rarely)
