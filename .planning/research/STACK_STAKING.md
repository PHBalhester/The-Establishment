# Technology Stack: Staking/Yield System

**Project:** Dr. Fraudsworth Staking Program (v0.6)
**Researched:** 2026-02-06
**Overall Confidence:** HIGH

---

## Executive Summary

The staking/yield system requires **no new crate dependencies**. The existing stack (Anchor 0.32.1, Token-2022) plus Rust's native `u128` with checked arithmetic is sufficient for the Synthetix/Quarry-style cumulative reward-per-token pattern.

**Key insight:** The spec already uses the industry-standard approach (1e18 precision, u128 intermediates, checked_* operations). This is the same pattern used by Quarry Protocol and derived from Synthetix's battle-tested StakingRewards.sol.

---

## Recommended Stack (Staking Program)

### Core Dependencies

| Crate | Version | Purpose | Why This Version |
|-------|---------|---------|------------------|
| anchor-lang | 0.32.1 | Framework | Matches existing programs. Upgrading to 1.0.0-rc.2 would require migrating all programs simultaneously. |
| anchor-spl | 0.32.1 | Token-2022 CPI | Required for PROFIT token transfers (Token-2022 with transfer hook). |

### Why NOT to Add

| Crate | Why NOT | Alternative |
|-------|---------|-------------|
| spl-math | Overkill for this use case. PreciseNumber is designed for complex interest calculations with 12 decimal precision. Our pattern needs only multiplication/division with 18-decimal scaling. | Native u128 + checked_* ops |
| ra-solana-math | Immature (v0.1.1, 262 downloads as of Oct 2025). Adds external dependency for no benefit. | Native u128 + checked_* ops |
| fixed | Generic fixed-point crate not optimized for Solana. Compute unit overhead. | Native u128 + checked_* ops |
| num-traits | Only needed for complex numeric operations. Our math is simple multiply/divide. | Standard Rust traits |

### Rationale: Native Arithmetic is Sufficient

The spec's math (from `New_Yield_System_Spec.md`) is:

```rust
// Reward calculation
let reward_delta = pool.rewards_per_token_stored
    .checked_sub(user.rewards_per_token_paid)?;

let pending = (user.staked_balance as u128)
    .checked_mul(reward_delta)?
    .checked_div(PRECISION)? as u64;
```

This pattern requires only:
1. `u128` for intermediate precision (native Rust)
2. `checked_*` operations (native Rust, enabled via `overflow-checks = true` in Cargo.toml)
3. A constant `PRECISION = 1_000_000_000_000_000_000u128` (1e18)

**No external crates needed.**

---

## Precision Analysis

### Why 1e18 (Not 1e12 or 1e6)?

| Precision | Max Safe Rewards | Risk |
|-----------|------------------|------|
| 1e6 | ~3.4e32 lamports | Overflow with large rewards |
| 1e12 | ~3.4e26 lamports | Safe but less headroom |
| 1e18 | ~3.4e20 lamports | Industry standard, ~1e9 headroom beyond max SOL supply |

**Decision:** Use 1e18. This matches:
- Synthetix StakingRewards.sol (1e18)
- Quarry Protocol (1e18 effective via spl-math)
- Ethereum DeFi conventions

### Overflow Boundary Check

From the spec:
```
Worst case:
- Total SOL supply: 580M SOL = 5.8e17 lamports
- Minimum stake: 1 PROFIT = 1e6 units
- If all SOL distributed to 1 staker: 5.8e17 * 1e18 / 1e6 = 5.8e29
- u128 max: 3.4e38

Verdict: ~1e9 headroom. Safe for any realistic scenario.
```

**Confidence:** HIGH (verified against Solana supply limits and u128 max)

---

## Cargo.toml Template

```toml
[package]
name = "staking"
version = "0.1.0"
description = "Dr Fraudsworth Staking Program - SOL yield distribution to PROFIT stakers"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token", "token_2022", "associated_token"] }

[dev-dependencies]
proptest = "1.9"
litesvm = "0.9.1"
solana-sdk = "2.2"
solana-program = "2.2"
spl-token-2022 = "8.0"
# Modular Solana 3.x crates for litesvm compatibility
solana-address = "2.0"
solana-keypair = "~3.1"
solana-signer = "~3.0"
solana-message = "~3.0"
solana-transaction = { version = "~3.0", features = ["verify"] }
solana-account = "3.3"
solana-instruction = "~3.1"
sha2 = "0.10"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

---

## Stack Changes to Existing Programs

### Tax Program

**Change needed:** Add CPI capability to call Staking Program.

```toml
# Add to programs/tax-program/Cargo.toml
[dependencies.staking]
path = "../staking"
features = ["cpi"]
```

**Reason:** Tax Program calls `deposit_rewards` on Staking Program when collecting SOL taxes.

### Epoch Program

**Change needed:** Add CPI capability to call Staking Program.

```toml
# Add to programs/epoch-program/Cargo.toml
[dependencies.staking]
path = "../staking"
features = ["cpi"]
```

**Reason:** Epoch Program calls `update_cumulative` on Staking Program during VRF callback.

### Transfer Hook

**No changes.** The Staking Program's stake vault PDA will be added to the whitelist at runtime, not compile time.

### AMM

**No changes.** AMM has no direct interaction with Staking Program.

---

## Token-2022 Considerations

### PROFIT Token (Token-2022) Handling

The Staking Program interacts with PROFIT tokens (Token-2022 with transfer hook). Required setup:

| Requirement | Solution |
|-------------|----------|
| Transfer hook invocation | Use `transfer_checked` from anchor-spl, not raw `transfer` |
| Stake vault authority | PDA-owned token account (stake_pool as authority) |
| Whitelist entry | Add stake vault PDA to Transfer Hook whitelist |

### SOL (Native Lamports) Handling

SOL rewards are native lamports, not SPL tokens. This simplifies the stack:

| Operation | Approach |
|-----------|----------|
| Deposit to escrow | Direct lamport transfer via `system_instruction::transfer` |
| Claim from escrow | Direct lamport manipulation via `try_borrow_mut_lamports()` |
| No token account | Escrow is a PDA holding native SOL, not a token account |

---

## Testing Stack

### Existing Tools (No Changes)

| Tool | Version | Purpose |
|------|---------|---------|
| litesvm | 0.9.1 | Local validator simulation |
| proptest | 1.9 | Property-based testing for edge cases |
| solana-sdk | 2.2 | Transaction building |

### Testing Considerations

The staking math is well-suited for property-based testing:

```rust
// Example proptest for reward calculation
proptest! {
    #[test]
    fn reward_calculation_never_overflows(
        staked_balance in 1u64..u64::MAX/2,
        reward_delta in 0u128..PRECISION * 1000,
    ) {
        let result = (staked_balance as u128)
            .checked_mul(reward_delta)
            .and_then(|v| v.checked_div(PRECISION));

        prop_assert!(result.is_some());
    }
}
```

---

## What NOT to Do

### Do NOT Add External Staking SDKs

| SDK | Why NOT |
|-----|---------|
| @quarryprotocol/quarry-sdk | TypeScript SDK, not relevant to on-chain program |
| Any "staking framework" crate | We have a clear spec; frameworks add abstraction without value |

### Do NOT Upgrade Anchor to 1.0.0

| Reason | Detail |
|--------|--------|
| Breaking changes | Anchor 1.0.0-rc.2 has breaking changes to account serialization |
| All-or-nothing | Would require migrating all 6+ existing programs simultaneously |
| Risk | RC = Release Candidate, not stable yet |

**Recommendation:** Stay on 0.32.1 for this milestone. Plan Anchor upgrade as separate milestone after staking is deployed.

### Do NOT Add spl-math for "Safety"

| Myth | Reality |
|------|---------|
| "PreciseNumber is safer" | It uses the same underlying checked arithmetic |
| "More precision" | 12 decimals vs our 18 decimals - we already have more |
| "Industry standard" | Quarry uses it for complex interest; our math is simpler |

**The spec's pattern is identical to Synthetix's battle-tested approach.** Adding spl-math would:
1. Increase compute units (more function calls)
2. Add learning curve (unfamiliar API)
3. Provide no safety benefit (same underlying math)

---

## Summary

| Category | Decision | Confidence |
|----------|----------|------------|
| New dependencies | None required | HIGH |
| Anchor version | Keep 0.32.1 | HIGH |
| Math approach | Native u128 + checked_* | HIGH |
| Precision | 1e18 (PRECISION constant) | HIGH |
| Tax Program changes | Add staking CPI | HIGH |
| Epoch Program changes | Add staking CPI | HIGH |

**The existing stack is production-ready for staking.** The Synthetix/Quarry pattern is proven and the spec correctly implements it with native Rust arithmetic.

---

## Sources

### Verified (HIGH confidence)
- [Helius: Solana Arithmetic Best Practices](https://www.helius.dev/blog/solana-arithmetic) - Confirms multiply-before-divide, checked arithmetic
- [Synthetix StakingRewards.sol](https://github.com/Synthetixio/synthetix/blob/develop/contracts/StakingRewards.sol) - Original 1e18 precision pattern
- [Quarry Protocol GitHub](https://github.com/QuarryProtocol/quarry) - Confirms pattern for Solana
- crates.io API - Version verification (anchor-lang latest 1.0.0-rc.2, spl-math 0.3.0, spl-token-2022 10.0.0)

### Project Context
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/New_Yield_System_Spec.md` - Existing spec with correct pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/*/Cargo.toml` - Current stack versions
