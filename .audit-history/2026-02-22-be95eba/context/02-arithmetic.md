# Arithmetic Safety Analysis
<!-- Focus: 02-arithmetic -->
<!-- Auditor: Stronghold of Security -->
<!-- Date: 2026-02-22 -->
<!-- Scope: All 5 programs (AMM, Tax, Epoch, Staking, Transfer Hook) -->

<!-- CONDENSED_SUMMARY_START -->
## Condensed Summary

### Overall Assessment: STRONG (with minor findings)

The Dr Fraudsworth protocol demonstrates **mature arithmetic discipline** across all five programs. The codebase consistently uses `checked_*` methods for financial calculations, widens to `u128` before multiplication, and uses `u64::try_from()` for safe downcasting. Every pure math function returns `Option<T>` or `Result`, propagating failures cleanly. Property-based testing (proptest with 10,000 iterations) covers the AMM, Tax, and Staking math modules.

### Critical Findings: 0
### High Findings: 0
### Medium Findings: 2
### Low Findings: 3
### Informational: 5

### Key Invariants Verified
1. **k-invariant**: `k_after >= k_before` verified via u128 multiplication in every swap (AMM math.rs:72-90)
2. **Tax split conservation**: `staking + carnage + treasury == total_tax` (tax_math.rs:76-105, proptest verified)
3. **Reward conservation**: `reward_per_token * total_staked / PRECISION <= total_distributed` (staking math.rs)
4. **Rounding direction**: All division truncates (floor), consistently favoring protocol over users
5. **First-depositor protection**: `MINIMUM_STAKE = 1_000_000` (1 PROFIT) dead stake prevents ratio manipulation

### Architecture Strengths
- Pure math functions separated from instruction handlers (testable, auditable)
- `Option<T>` return pattern forces callers to handle overflow via `.ok_or(Error::Overflow)`
- u128 intermediates used for ALL cross-multiplication (reserves, BPS, precision-scaled rewards)
- CEI (Checks-Effects-Interactions) pattern enforced with reentrancy guards in AMM
- Comprehensive `checked_sub`/`checked_add` on all balance updates in staking stake/unstake/claim
- `saturating_sub` used appropriately for timing calculations (slot differences) where underflow is non-harmful

### Findings Summary
| ID | Severity | Location | Issue |
|----|----------|----------|-------|
| ARITH-001 | MEDIUM | epoch trigger_epoch_transition.rs:81 | `as u32` epoch truncation (theoretical) |
| ARITH-002 | MEDIUM | epoch trigger_epoch_transition.rs:99 | Unchecked multiply+add in epoch_start_slot |
| ARITH-003 | LOW | epoch execute_carnage_atomic.rs:428,433 / execute_carnage.rs:435,440 | `as u64` after checked u128 chain |
| ARITH-004 | LOW | tax_math.rs:158 | `floor as u64` after safe u128 chain |
| ARITH-005 | LOW | pool_reader.rs hardcoded offsets | Fragile byte offsets (137-153) |
| ARITH-INFO-001 | INFO | epoch trigger_epoch_transition.rs:195 | Bounty rent-exempt known bug (documented) |
| ARITH-INFO-002 | INFO | transfer_hook initialize_extra_account_meta_list.rs:79 | `account_size as u64` safe cast |
| ARITH-INFO-003 | INFO | staking update_cumulative.rs | `.unwrap()` calls are in `#[cfg(test)]` only |
| ARITH-INFO-004 | INFO | all programs | Non-financial counters use unchecked defaults |
| ARITH-INFO-005 | INFO | carnage slippage | 85%/75% floors use integer division (floor rounding favors protocol) |

### Cross-Focus Handoffs
- **-> 03-access-control**: `swap_exempt` passes `MINIMUM_OUTPUT: u64 = 0` (no slippage protection) - relies entirely on Carnage slippage floor in Epoch program. Verify Carnage caller authorization is airtight.
- **-> 04-cpi**: Raw byte offsets in `read_pool_reserves` assume PoolState layout. If AMM PoolState struct changes, offsets silently break. Cross-program data dependency.
- **-> 05-economic**: Rounding direction analysis (protocol-favoring floor everywhere) interacts with fee extraction economics.
- **-> 06-state**: `rewards_per_token_stored` is u128 that monotonically increases. Verify no path decrements it.
<!-- CONDENSED_SUMMARY_END -->

---

## Full Analysis

### Methodology

Applied 3-layer search methodology:
1. **Layer 1**: Identified 85 Rust source files across 6 program crates via glob patterns
2. **Layer 2**: Grepped for `checked_*`, `as u64/u128/u32`, `saturating_*`, `wrapping_*`, `.unwrap()`, `/`, `*`, `pow`, `sqrt`, `try_into`, `try_from` across all source files
3. **Layer 3**: Deep-read all 25+ files containing arithmetic operations

Cross-referenced against:
- EP-015 (Overflow/Underflow)
- EP-016 (Precision Loss in Fixed-Point Arithmetic)
- EP-017 (Decimal/Basis Point Normalization)
- EP-019 (Rounding Direction Exploitation)
- EP-020 (Unsafe Type Casting)
- EP-091 (Custom Overflow Guard Bypass)
- SP-027 through SP-035 (Secure arithmetic patterns)
- FP-010, FP-021 (False positive recognition)
- AMM/DEX attack playbook (Cetus-style overflow, fee bypass)

---

### Program-by-Program Analysis

---

#### 1. AMM Program (`programs/amm/`)

**Files analyzed:**
- `helpers/math.rs` (498 lines) - Core swap math
- `instructions/swap_sol_pool.rs` (430 lines) - SOL pool swap handler
- `instructions/swap_profit_pool.rs` (352 lines) - PROFIT pool swap handler
- `instructions/initialize_pool.rs` (286 lines) - Pool creation

##### 1.1 Swap Math (`helpers/math.rs`)

**Pattern: Pure functions returning `Option<T>`**

All core functions return `Option<u64>`, forcing callers to explicitly handle overflow:

```rust
// math.rs:10-30 - calculate_effective_input
pub fn calculate_effective_input(amount_in: u64, fee_bps: u64) -> Option<u64> {
    let fee_factor = 10_000u128.checked_sub(fee_bps as u128)?;
    let effective = (amount_in as u128)
        .checked_mul(fee_factor)?
        .checked_div(10_000)?;
    u64::try_from(effective).ok()
}
```

**Verification of each operation:**
- `10_000u128.checked_sub(fee_bps)`: Safe. `fee_bps` constrained by `MAX_LP_FEE_BPS = 500` in `initialize_pool.rs:185`. Result range: [9500, 10000].
- `amount_in as u128`: Safe widening (u64 -> u128, no truncation).
- `.checked_mul(fee_factor)`: Max = `u64::MAX * 10000 = 1.84e23` which fits in u128 (max `3.4e38`).
- `.checked_div(10_000)`: Division by non-zero constant. Cannot panic.
- `u64::try_from(effective).ok()`: Safe downcast. Result <= `amount_in` (fee_factor <= 10000), so always fits.

```rust
// math.rs:35-55 - calculate_swap_output
pub fn calculate_swap_output(reserve_in: u64, reserve_out: u64, effective_input: u64) -> Option<u64> {
    let numerator = (reserve_out as u128).checked_mul(effective_input as u128)?;
    let denominator = (reserve_in as u128).checked_add(effective_input as u128)?;
    let output = numerator.checked_div(denominator)?;
    u64::try_from(output).ok()
}
```

**Verification:**
- `reserve_out * effective_input`: Max = `u64::MAX^2 = 3.4e38` which is at the u128 limit (`3.4e38`). This is the tightest bound in the codebase. If both reserves are at u64::MAX, the multiplication **can overflow u128**. However, in practice, reserves are bounded by actual token supply (max ~10^18 for 6-decimal tokens). The `checked_mul` catches any theoretical overflow.
- `reserve_in + effective_input`: Max = `2 * u64::MAX = 3.7e19`, fits in u128.
- Division by non-zero (checked_add ensures denominator >= 1 if effective_input >= 1).
- `u64::try_from(output)`: Safe. `output <= reserve_out` by constant-product formula, and `reserve_out` is u64.

```rust
// math.rs:72-90 - verify_k_invariant
pub fn verify_k_invariant(
    reserve_in_before: u64, reserve_out_before: u64,
    reserve_in_after: u64, reserve_out_after: u64,
) -> Option<bool> {
    let k_before = (reserve_in_before as u128).checked_mul(reserve_out_before as u128)?;
    let k_after = (reserve_in_after as u128).checked_mul(reserve_out_after as u128)?;
    Some(k_after >= k_before)
}
```

**Verification:**
- u128 multiplication of two u64 values: `u64::MAX * u64::MAX = (2^64-1)^2 = 2^128 - 2^65 + 1 < 2^128 - 1`. **Fits exactly.**
- Comparison is `>=` (not `>`) which is correct: fees increase k, rounding can preserve it, but k must never decrease.
- **Proptest coverage**: 10,000 iterations verify k-invariant holds for random reserves and amounts.

**Zero-output guards** (`check_effective_input_nonzero`, `check_swap_output_nonzero`): Both return `bool` and are called by swap handlers to reject dust trades.

**Rounding analysis:** Integer division in `calculate_swap_output` truncates (floors). The user receives slightly less than the theoretical output. The dust remains in the pool, increasing k. This is **protocol-favoring** and correct per SP-035.

**Fee bypass check (Cetus attack vector):** For `amount_in = 1` with `fee_bps = 300`:
- `effective = 1 * 9700 / 10000 = 0` (truncated)
- `check_effective_input_nonzero` returns false, swap is rejected
- **Fee bypass is NOT possible** because zero effective input is explicitly blocked.

##### 1.2 Swap Handlers (`swap_sol_pool.rs`, `swap_profit_pool.rs`)

Both handlers follow identical patterns:
1. Reentrancy guard: `require!(!pool.locked)` then `pool.locked = true`
2. Delegate all math to `helpers/math.rs` functions
3. Map `None` returns to `AmmError::Overflow` via `.ok_or()`
4. `checked_sub`/`checked_add` on all reserve updates
5. k-invariant verification after reserve updates
6. LP fee separated from output: `lp_fee = effective_input.checked_sub(amount_after_fee)?`

Key line in `swap_sol_pool.rs:153`:
```rust
let effective_u64 = u64::try_from(effective_input).map_err(|_| AmmError::Overflow)?;
```
Safe: uses `try_from` not `as u64`.

**Minimum output enforcement** in swap handlers: `require!(output >= minimum_amount_out)` with user-provided `minimum_amount_out`. The Tax Program provides an additional protocol-level floor.

##### 1.3 Pool Initialization (`initialize_pool.rs`)

- Canonical mint ordering: `require!(mint_a.key() < mint_b.key())`
- LP fee validation: `require!(lp_fee_bps <= MAX_LP_FEE_BPS)` where MAX = 500 (5%)
- No arithmetic on token amounts beyond assignment to initial reserves

**No findings in AMM Program.**

---

#### 2. Tax Program (`programs/tax-program/`)

**Files analyzed:**
- `helpers/tax_math.rs` (509 lines) - Tax calculation and distribution
- `helpers/pool_reader.rs` (85 lines) - Raw pool state byte reading
- `instructions/swap_sol_buy.rs` - Buy tax handler
- `instructions/swap_sol_sell.rs` - Sell tax handler
- `instructions/swap_profit_buy.rs` - PROFIT buy tax handler
- `instructions/swap_exempt.rs` (256 lines) - Carnage exempt swap

##### 2.1 Tax Math (`helpers/tax_math.rs`)

```rust
// tax_math.rs:10-25 - calculate_tax
pub fn calculate_tax(amount_in: u64, tax_bps: u16) -> Option<u64> {
    let tax = (amount_in as u128)
        .checked_mul(tax_bps as u128)?
        .checked_div(10_000)?;
    u64::try_from(tax).ok()
}
```

**Verification:**
- `amount_in as u128 * tax_bps as u128`: Max = `u64::MAX * 65535 = 1.2e24`. Fits in u128.
- `/10_000`: Non-zero constant divisor.
- `u64::try_from(tax)`: Safe. `tax <= amount_in * 65535/10000 = amount_in * 6.55`. For valid BPS (max ~1400 = 14%), result < `amount_in`, always fits in u64.

```rust
// tax_math.rs:50-105 - split_distribution
pub fn split_distribution(total_tax: u64) -> Option<TaxDistribution> {
    // Micro-tax rule: < 4 lamports all goes to staking
    if total_tax < 4 {
        return Some(TaxDistribution { staking: total_tax, carnage: 0, treasury: 0 });
    }
    let staking = (total_tax as u128).checked_mul(75)?.checked_div(100)?;
    let carnage = (total_tax as u128).checked_mul(24)?.checked_div(100)?;
    let staking = u64::try_from(staking).ok()?;
    let carnage = u64::try_from(carnage).ok()?;
    let treasury = total_tax.checked_sub(staking)?.checked_sub(carnage)?;
    Some(TaxDistribution { staking, carnage, treasury })
}
```

**Verification:**
- 75/100 and 24/100 with u128 intermediates: safe.
- **Treasury absorbs rounding dust**: `treasury = total - staking - carnage`. This ensures `staking + carnage + treasury == total_tax` always (conservation invariant).
- Example: `total_tax = 100`: staking=75, carnage=24, treasury=1. Sum=100.
- Example: `total_tax = 3`: micro-tax rule, staking=3, carnage=0, treasury=0. Sum=3.
- **Proptest verified** with 10,000 iterations.

```rust
// tax_math.rs:140-160 - calculate_output_floor
pub fn calculate_output_floor(reserve_in: u64, reserve_out: u64, amount_in: u64, floor_bps: u16) -> Option<u64> {
    let expected = (reserve_out as u128)
        .checked_mul(amount_in as u128)?
        .checked_div((reserve_in as u128).checked_add(amount_in as u128)?)?;
    let floor = expected
        .checked_mul(floor_bps as u128)?
        .checked_div(10_000)?;
    Some(floor as u64)  // Line 158
}
```

**ARITH-004 (LOW):** Line 158 uses `floor as u64` instead of `u64::try_from(floor).ok()?`. However, this is **safe in context**: `floor <= expected <= reserve_out` (constant product formula output bounded by reserves), and `reserve_out` is u64. The truncation cannot occur. Recommendation: use `u64::try_from` for consistency with the codebase pattern.

##### 2.2 Pool Reader (`helpers/pool_reader.rs`)

**ARITH-005 (LOW):** Hardcoded byte offsets:
```rust
let reserve_a = u64::from_le_bytes(data[137..145].try_into()?);
let reserve_b = u64::from_le_bytes(data[145..153].try_into()?);
let lp_fee_bps = u16::from_le_bytes(data[153..155].try_into()?);
```

This pattern appears in three locations:
1. `tax-program/src/helpers/pool_reader.rs` (for tax buy/sell)
2. `epoch-program/src/instructions/execute_carnage_atomic.rs:930-956`
3. `epoch-program/src/instructions/execute_carnage.rs:863-889`

All three duplicate the same byte offsets. If the AMM `PoolState` struct layout changes (e.g., a field is added before reserves), all three break silently, reading garbage data. Length validation (`data.len() >= 153`) prevents out-of-bounds but not wrong-offset reads.

**Mitigation:** The offsets are documented in comments matching the PoolState struct definition. Any PoolState change would also break existing on-chain accounts (requiring migration), so this is a deployment-time concern, not a runtime vulnerability. **Handoff to 04-cpi focus area.**

##### 2.3 Swap Handlers (Buy/Sell)

All four swap handlers (`swap_sol_buy.rs`, `swap_sol_sell.rs`, `swap_profit_buy.rs`, `swap_profit_sell.rs`) follow the same pattern:
1. Read EpochState for tax rate (cross-program, owner-verified)
2. `calculate_tax(amount_in, tax_bps)` via helper
3. `amount_in.checked_sub(tax_amount)` for amount entering AMM
4. Execute AMM CPI
5. `split_distribution(tax_amount)` for distribution
6. Transfer tax portions to staking escrow, carnage vault, treasury

LP fee calculation in `swap_profit_buy.rs:222-225`:
```rust
let lp_fee = (amount_in as u128)
    .checked_mul(lp_fee_bps as u128)
    .and_then(|n| n.checked_div(10_000))
    .ok_or(TaxError::TaxOverflow)? as u64;
```
The `as u64` is safe: max = `u64::MAX * 500 / 10000 = u64::MAX * 0.05 < u64::MAX`.

`swap_exempt.rs` passes `MINIMUM_OUTPUT: u64 = 0` to AMM. This is intentional per spec (Carnage accepts market execution). Slippage protection is handled by the Epoch program's slippage floors (85% atomic, 75% fallback). **Handoff to 03-access-control**: verify only Carnage can call swap_exempt.

---

#### 3. Staking Program (`programs/staking/`)

**Files analyzed:**
- `helpers/math.rs` (617 lines) - Reward calculation
- `constants.rs` (191 lines) - PRECISION, MINIMUM_STAKE
- `instructions/update_cumulative.rs` (258 lines) - Epoch reward finalization
- `instructions/claim.rs` - Reward claiming
- `instructions/stake.rs` (164 lines) - Stake handler
- `instructions/unstake.rs` (253 lines) - Unstake handler
- `state/stake_pool.rs` (83 lines) - Pool state definition

##### 3.1 Reward Math (`helpers/math.rs`)

**Synthetix/Quarry pattern with PRECISION = 1e18:**

```rust
// math.rs:20-50 - update_rewards (simplified)
pub fn update_rewards(pool: &mut StakePool, user: &mut UserStake) -> Result<()> {
    if pool.total_staked == 0 { return Ok(()); }

    // Calculate delta: new rewards since last checkpoint
    let reward_delta = (pool.pending_rewards as u128)
        .checked_mul(PRECISION)
        .ok_or(StakingError::Overflow)?
        .checked_div(pool.total_staked as u128)
        .ok_or(StakingError::DivisionByZero)?;

    // User's earned rewards
    let user_delta = (user.staked_balance as u128)
        .checked_mul(
            pool.rewards_per_token_stored
                .checked_sub(user.rewards_per_token_paid)
                .ok_or(StakingError::Underflow)?
        )
        .ok_or(StakingError::Overflow)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)?;

    user.rewards_earned = user.rewards_earned
        .checked_add(user_delta as u64)   // Line ~50
        .ok_or(StakingError::Overflow)?;
    ...
}
```

**Verification of `user_delta as u64` (Line ~50):**
- `user_delta = staked_balance * (rewards_per_token_stored - rewards_per_token_paid) / PRECISION`
- `staked_balance` is u64 (max ~1.8e19)
- `rewards_per_token_stored - paid` represents accumulated reward per token scaled by PRECISION
- The intermediate `staked_balance * delta` can theoretically reach u128 max, but `/ PRECISION` brings it back to u64 range
- In practice, `rewards_per_token_stored` grows by `pending_rewards * PRECISION / total_staked` per epoch. With pending_rewards as u64 lamports and total_staked as u64, the per-epoch delta is at most `u64::MAX * PRECISION / 1 = ~1.8e37`, and the cumulative can grow unboundedly over infinite epochs.
- **However**: `user_delta / PRECISION` gives the actual SOL reward in lamports, which is bounded by `pending_rewards * user_balance / total_staked`, always fitting in u64.
- The `as u64` cast is **safe in practice** but relies on economic invariants. The `checked_add` on the next line catches any overflow.

##### 3.2 Cumulative Update (`update_cumulative.rs`)

Production code (lines 72-130) uses proper `checked_*` throughout:
```rust
let reward_increase = (rewards_added as u128)
    .checked_mul(PRECISION)
    .ok_or(StakingError::Overflow)?
    .checked_div(pool.total_staked as u128)
    .ok_or(StakingError::DivisionByZero)?;

pool.rewards_per_token_stored = pool.rewards_per_token_stored
    .checked_add(reward_increase)
    .ok_or(StakingError::Overflow)?;

pool.total_distributed = pool.total_distributed
    .checked_add(rewards_added)
    .ok_or(StakingError::Overflow)?;
```

**ARITH-INFO-003**: The `.unwrap()` calls flagged in HOT_SPOTS.md are in `#[cfg(test)]` module (lines 132-257). These are **test-only** and do not execute on-chain. This is a **false positive** per FP-021.

##### 3.3 Stake/Unstake/Claim

All three handlers follow CEI with `checked_*`:
- `stake.rs:120-128`: `checked_add` on both `user.staked_balance` and `pool.total_staked`
- `unstake.rs:182-190`: `checked_sub` on both balances
- `unstake.rs:199-211`: `checked_sub`/`checked_add` on lamport transfers (escrow -> user)
- `claim.rs:119-128`: `checked_add` on `total_claimed` (user and pool)
- `claim.rs:137-149`: `checked_sub`/`checked_add` on lamport transfers

`unstake.rs:135-142` uses `saturating_sub` for partial unstake dust check:
```rust
let remaining_after = user_stake.staked_balance.saturating_sub(amount);
if remaining_after > 0 && remaining_after < MINIMUM_STAKE {
    amount = user_stake.staked_balance; // Full unstake
}
```
`saturating_sub` is appropriate here: it's a comparison, not a financial calculation. The actual balance subtraction on line 182 uses `checked_sub`.

**First-depositor attack prevention:** `MINIMUM_STAKE = 1_000_000` (1 PROFIT with 6 decimals) ensures a minimum viable staking position. Combined with the dead stake principle (first depositor's minimum is effectively locked), this prevents the classic Compound/Synthetix share inflation attack.

---

#### 4. Epoch Program (`programs/epoch-program/`)

**Files analyzed:**
- `helpers/carnage.rs` (175 lines) - VRF byte interpretation
- `helpers/tax_derivation.rs` (334 lines) - VRF tax rate derivation
- `instructions/trigger_epoch_transition.rs` (389 lines) - Epoch trigger
- `instructions/consume_randomness.rs` (420 lines) - VRF consumption
- `instructions/execute_carnage_atomic.rs` (1016 lines) - Atomic carnage
- `instructions/execute_carnage.rs` (1002 lines) - Fallback carnage
- `constants.rs` (319 lines) - All epoch constants

##### 4.1 Epoch Calculation

**ARITH-001 (MEDIUM): `as u32` truncation in `current_epoch`**

```rust
// trigger_epoch_transition.rs:80-82
pub fn current_epoch(slot: u64, genesis_slot: u64) -> u32 {
    ((slot.saturating_sub(genesis_slot)) / SLOTS_PER_EPOCH) as u32
}
```

The `as u32` cast truncates if the epoch number exceeds `u32::MAX` (4,294,967,295). At mainnet SLOTS_PER_EPOCH=4500 and ~2.16 slots/second, this is:
- `4,294,967,295 * 4500 / 2.16 / 86400 / 365 = ~284,000 years`

**Practical risk: NONE.** The protocol will not run for 284,000 years. However, the pattern violates the codebase's otherwise consistent use of safe casts. `u32::try_from().ok_or()` would be more defensive.

**ARITH-002 (MEDIUM): Unchecked multiply+add in `epoch_start_slot`**

```rust
// trigger_epoch_transition.rs:98-100
pub fn epoch_start_slot(epoch: u32, genesis_slot: u64) -> u64 {
    genesis_slot + (epoch as u64 * SLOTS_PER_EPOCH)
}
```

Two concerns:
1. `epoch as u64 * SLOTS_PER_EPOCH`: Max = `u32::MAX * 4500 = 1.93e13`. Fits in u64 (max `1.84e19`). **Safe.**
2. `genesis_slot + result`: If `genesis_slot` is very large (close to u64::MAX), this could wrap. However, genesis_slot is a Solana slot number (currently ~300M, max practical ~u64::MAX/2 over protocol lifetime). The addition is **unchecked** and uses the default `+` operator.

In release mode on Solana, this would **silently wrap** if overflow occurred. The function is called in a non-critical path (setting `epoch_start_slot` state field for display/reference), but incorrect epoch start slot could cause downstream timing logic issues.

**Risk: LOW in practice** (genesis_slot + max_epoch_offset = 300M + 19.3T << u64::MAX), but the pattern is inconsistent with the codebase's checked arithmetic standard.

##### 4.2 VRF Tax Derivation (`tax_derivation.rs`)

```rust
// tax_derivation.rs:89-94
let crime_low_idx = (vrf_result[1] % 4) as usize;
let crime_high_idx = (vrf_result[2] % 4) as usize;
let fraud_low_idx = (vrf_result[3] % 4) as usize;
let fraud_high_idx = (vrf_result[4] % 4) as usize;
```

**Safe:** `u8 % 4` produces values 0-3. Array sizes are 4 (`LOW_RATES[4]`, `HIGH_RATES[4]`). No out-of-bounds possible.

VRF byte distribution: `u8 % 4` has slight bias for values 0 (64/256=25%) since 256 is divisible by 4. No bias present. **No finding.**

##### 4.3 Carnage Slippage (`execute_carnage_atomic.rs`, `execute_carnage.rs`)

Both files contain identical slippage math (atomic uses 85% floor, fallback uses 75%):

```rust
// execute_carnage_atomic.rs:423-433
let expected = (reserve_token as u128)
    .checked_mul(total_buy_amount as u128)
    .and_then(|n| n.checked_div(
        (reserve_sol as u128).checked_add(total_buy_amount as u128)?
    ))
    .ok_or(EpochError::Overflow)? as u64;

let min_output = (expected as u128)
    .checked_mul(CARNAGE_SLIPPAGE_BPS_ATOMIC as u128)
    .and_then(|n| n.checked_div(10_000))
    .ok_or(EpochError::Overflow)? as u64;
```

**ARITH-003 (LOW): `as u64` after checked u128 chain**

Lines 428 and 433 use `as u64` instead of `u64::try_from().ok_or()`. Analysis:
- `expected`: bounded by `reserve_token` (which is u64) by constant-product formula. **Safe.**
- `min_output`: `expected * 8500 / 10000 <= expected <= reserve_token`. **Safe.**

Same pattern at lines 435 and 440 in `execute_carnage.rs` (fallback).

While technically safe, `u64::try_from` would be more defensive and consistent with AMM's pattern.

**ARITH-INFO-005**: The 85%/75% floors use integer division (`checked_div(10_000)`), which truncates. For `expected = 1`, `min_output = 0`. This means very small expected outputs (< 2 tokens) effectively have no slippage protection. In practice, Carnage swaps are large (MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL), so expected output is always substantial. **Not exploitable.**

##### 4.4 Carnage SOL Calculations

```rust
// execute_carnage_atomic.rs:355-366
let available_sol = sol_balance.saturating_sub(rent_exempt_min);
let swap_amount = std::cmp::min(available_sol, MAX_CARNAGE_SWAP_LAMPORTS);

let total_buy_amount = std::cmp::min(
    swap_amount.checked_add(sol_from_sale).ok_or(EpochError::Overflow)?,
    MAX_CARNAGE_SWAP_LAMPORTS,
);
let wrap_amount = total_buy_amount.saturating_sub(sol_from_sale);
```

- `saturating_sub(rent_exempt_min)`: Safe for timing/balance checks. If sol_balance < rent, available_sol = 0 (graceful).
- `checked_add(sol_from_sale)`: Properly checked.
- `std::cmp::min(..., MAX_CARNAGE_SWAP_LAMPORTS)`: Caps at 1000 SOL. Prevents unbounded swaps.
- `saturating_sub(sol_from_sale)`: Safe. `total_buy_amount >= sol_from_sale` because `total_buy_amount = min(swap + sale, MAX)` and if `sale > MAX`, then `total_buy_amount = MAX < sale + swap`, but `wrap_amount = MAX - sale` could saturate to 0. This is correct: if sell proceeds exceed the cap, no wrapping needed.

**ARITH-INFO-001**: Bounty rent-exempt known bug in `trigger_epoch_transition.rs:195`:
```rust
if vault_balance >= TRIGGER_BOUNTY_LAMPORTS {
    // Transfer bounty
}
```
This does not check `vault_balance >= TRIGGER_BOUNTY_LAMPORTS + rent_exempt_minimum`. After transfer, the vault can drop below rent floor. **Already documented in project memory as a known TODO.**

##### 4.5 Carnage Statistics

All carnage state updates use `checked_add`:
```rust
carnage_state.total_sol_spent = carnage_state.total_sol_spent
    .checked_add(total_buy_amount).ok_or(EpochError::Overflow)?;
carnage_state.total_triggers = carnage_state.total_triggers
    .checked_add(1).ok_or(EpochError::Overflow)?;
carnage_state.total_crime_burned = carnage_state.total_crime_burned
    .checked_add(amount).ok_or(EpochError::Overflow)?;
```

**No findings.**

##### 4.6 Consume Randomness (`consume_randomness.rs`)

Deadline calculation uses `checked_add`:
```rust
epoch_state.carnage_deadline_slot = clock.slot
    .checked_add(CARNAGE_DEADLINE_SLOTS)
    .ok_or(EpochError::Overflow)?;
epoch_state.carnage_lock_slot = clock.slot
    .checked_add(CARNAGE_LOCK_SLOTS)
    .ok_or(EpochError::Overflow)?;
```

Line 391 `.unwrap()` in HOT_SPOTS.md refers to **test code** (`test_deadline_calculation`), not production. **False positive.**

---

#### 5. Transfer Hook Program (`programs/transfer-hook/`)

**Files analyzed:**
- `instructions/transfer_hook.rs` (180 lines) - Hook execution
- `instructions/initialize_extra_account_meta_list.rs` (156 lines) - Meta list init

##### 5.1 Hook Execution (`transfer_hook.rs`)

The transfer hook performs **no arithmetic operations**. It validates:
1. `amount > 0` (zero check)
2. Mint owner == Token-2022
3. Transferring flag is set
4. Whitelist PDA existence

No integer math, no type casts, no overflow risk. **No findings.**

##### 5.2 Meta List Initialization (`initialize_extra_account_meta_list.rs`)

**ARITH-INFO-002**: Line 79:
```rust
account_size as u64,
```
Where `account_size` is `usize` from `ExtraAccountMetaList::size_of()`. On 64-bit platforms (Solana BPF), `usize` is 64 bits, so `as u64` is a no-op. On 32-bit platforms, `usize` fits in `u64`. **Safe. No finding.**

---

### Cross-Cutting Patterns

#### Checked Arithmetic Coverage

| Program | checked_* count | Unchecked `+`/`-`/`*` in financial code | as u64/u128 casts |
|---------|----------------|----------------------------------------|-------------------|
| AMM | 20+ | 0 | 2 (both via try_from) |
| Tax | 25+ | 0 | 3 (1 raw cast, 2 safe) |
| Staking | 30+ | 0 | 2 (both bounded) |
| Epoch | 35+ | 2 (epoch_start_slot) | 6 (all bounded) |
| Hook | 0 (no math) | 0 | 1 (usize->u64, safe) |

#### Rounding Direction Summary

All financial division in the codebase uses integer truncation (floor):
- **Swap output**: User receives floor(expected) -- protocol keeps dust
- **Tax calculation**: floor(amount * bps / 10000) -- user pays slightly less tax
- **Treasury remainder**: gets leftover from 75/24 split -- absorbs all rounding dust
- **Reward per token**: floor(rewards * PRECISION / total_staked) -- small rewards may round to 0
- **User reward claim**: floor(balance * delta / PRECISION) -- user receives slightly less

This is consistently **protocol-favoring** for output calculations and **user-favoring** for tax input calculations. The net effect is that dust accumulates in pool reserves and treasury, never in user accounts. This is the correct and expected behavior per SP-035.

#### False Positives Identified

1. **update_cumulative.rs `.unwrap()` calls** (HOT_SPOTS flagged as HIGH): These are in `#[cfg(test)]` module only. Production code uses `checked_*` throughout. **FP per FP-021.**

2. **`as u64` casts after checked u128 chains**: Multiple instances (carnage slippage, tax math floor, LP fee calc). All are bounded by input constraints and checked chain logic. While `u64::try_from` would be more defensive, these are not exploitable. **Informational only.**

3. **`unchecked defaults`** in struct initialization (e.g., `total_staked: 0`, `bump: 0`): These are initial values, not arithmetic operations. No overflow risk.

4. **`saturating_sub` usage**: All instances are for non-critical timing comparisons (slot differences, rent calculations) where underflow to 0 is the correct behavior.

---

### Invariant Verification Summary

| Invariant | Where Verified | Status |
|-----------|---------------|--------|
| `k_after >= k_before` | AMM math.rs + proptest | VERIFIED |
| `staking + carnage + treasury == total_tax` | tax_math.rs + proptest | VERIFIED |
| `output <= reserve_out` | AMM constant product formula | VERIFIED (mathematically) |
| `effective_input > 0` for all valid swaps | AMM math.rs zero guards | VERIFIED |
| `rewards_per_token_stored` monotonically increases | update_cumulative.rs checked_add | VERIFIED |
| `total_staked == sum(user.staked_balance)` | stake/unstake use paired checked_add/sub | VERIFIED (by construction) |
| `total_distributed >= total_claimed` | claim.rs checks escrow balance | VERIFIED |
| `MINIMUM_STAKE` prevents first-depositor attack | stake.rs, constants.rs | VERIFIED |
| VRF array indices in bounds | `% 4` on u8, array size 4 | VERIFIED |

---

### EP (Exploit Pattern) Coverage

| Pattern | Status | Notes |
|---------|--------|-------|
| EP-015 Overflow/Underflow | MITIGATED | checked_* everywhere in financial code |
| EP-016 Precision Loss | MITIGATED | PRECISION=1e18, u128 intermediates |
| EP-017 Decimal Normalization | N/A | All tokens use 6 decimals (consistent) |
| EP-018 Float Arithmetic | CLEAN | No floats used anywhere on-chain |
| EP-019 Rounding Direction | MITIGATED | Protocol-favoring floor throughout |
| EP-020 Unsafe Type Casting | MOSTLY MITIGATED | 2 medium findings (epoch), rest safe |
| EP-091 Custom Overflow Guard | N/A | No custom overflow guards (uses Rust checked_*) |

---

### Detailed Findings

#### ARITH-001: `as u32` Epoch Truncation
- **Severity:** MEDIUM
- **Location:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:81`
- **Pattern:** EP-020 (Unsafe Type Casting)
- **Code:** `((slot.saturating_sub(genesis_slot)) / SLOTS_PER_EPOCH) as u32`
- **Impact:** If epoch count exceeds u32::MAX (4.29B), epoch number wraps to 0. At 48 epochs/day (mainnet), this takes ~245,000 years.
- **Practical Risk:** None in any realistic scenario.
- **Recommendation:** Replace with `u32::try_from(...).map_err(|_| EpochError::Overflow)?` for defensive consistency. This also documents the assumption.

#### ARITH-002: Unchecked Multiply+Add in `epoch_start_slot`
- **Severity:** MEDIUM
- **Location:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:99`
- **Pattern:** EP-015 (Overflow/Underflow)
- **Code:** `genesis_slot + (epoch as u64 * SLOTS_PER_EPOCH)`
- **Impact:** Both `*` and `+` are unchecked. In Solana release mode, overflow wraps silently. Could produce incorrect `epoch_start_slot` value in state.
- **Practical Risk:** Very low. Max value = ~300M + ~19.3T << u64::MAX.
- **Recommendation:** Use `(epoch as u64).checked_mul(SLOTS_PER_EPOCH)?.checked_add(genesis_slot)?` and return `Option<u64>` or `Result`.

#### ARITH-003: Raw `as u64` Cast on Checked u128 Result
- **Severity:** LOW
- **Locations:**
  - `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:428,433`
  - `programs/epoch-program/src/instructions/execute_carnage.rs:435,440`
- **Pattern:** EP-020 (Unsafe Type Casting)
- **Code:** `.ok_or(EpochError::Overflow)? as u64`
- **Impact:** Truncation if result exceeds u64::MAX. Proven safe by mathematical bounds (result <= reserve_token, which is u64).
- **Recommendation:** Replace with `u64::try_from(...).map_err(|_| EpochError::Overflow)?` for consistency.

#### ARITH-004: Raw `as u64` Cast in Output Floor
- **Severity:** LOW
- **Location:** `programs/tax-program/src/helpers/tax_math.rs:158`
- **Pattern:** EP-020 (Unsafe Type Casting)
- **Code:** `Some(floor as u64)`
- **Impact:** Same analysis as ARITH-003. Bounded by reserve_out.
- **Recommendation:** Replace with `u64::try_from(floor).ok()`.

#### ARITH-005: Hardcoded Pool State Byte Offsets
- **Severity:** LOW
- **Locations:**
  - `programs/tax-program/src/helpers/pool_reader.rs:50-70`
  - `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:930-956`
  - `programs/epoch-program/src/instructions/execute_carnage.rs:863-889`
- **Pattern:** Data Dependency / Fragile Encoding
- **Impact:** If AMM PoolState struct changes layout, these functions read wrong data. Length validation prevents crashes but not incorrect values.
- **Recommendation:** Consider a shared constant file or integration test that verifies offsets match the actual PoolState layout.
- **Handoff:** -> 04-cpi focus area for cross-program data dependency analysis.

---

### Test Coverage Assessment

| Module | Proptest | Unit Tests | Integration Tests |
|--------|----------|------------|-------------------|
| AMM math.rs | 10,000 iter (k-invariant, bounds, monotonicity) | 15+ | Yes (swap handlers) |
| tax_math.rs | 10,000 iter (conservation, monotonicity, micro-tax) | 10+ | Yes (buy/sell) |
| staking math.rs | 10,000 iter (no-panic, conservation, bounds) | 10+ | Yes (stake/claim) |
| epoch trigger | N/A | 10+ (epoch calc consistency) | Yes |
| carnage slippage | N/A | 4 (floor values, large values, zero) | Yes (6 paths) |
| transfer_hook | N/A | N/A (no math) | Yes |

Property-based testing coverage is excellent for the three core math modules. The epoch and carnage arithmetic rely on unit tests and integration tests, which is adequate given the lower complexity.

---

### Conclusion

The Dr Fraudsworth protocol's arithmetic safety posture is **strong**. The two MEDIUM findings are theoretical concerns with no practical exploitation path (epoch truncation in 245,000 years, unchecked addition that can't overflow with realistic Solana slot values). The three LOW findings are stylistic inconsistencies (`as u64` instead of `try_from`) that are provably safe by mathematical bounds but deviate from the codebase's defensive standard.

No **critical** or **high** arithmetic vulnerabilities were identified. The consistent use of `checked_*` methods, u128 widening, `Option<T>` returns, and property-based testing represents security-conscious development practice.
