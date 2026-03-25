---
task_id: sos-phase1-arithmetic
provides: [arithmetic-findings, arithmetic-invariants]
focus_area: arithmetic
files_analyzed: [bonding_curve/math.rs, bonding_curve/constants.rs, bonding_curve/instructions/sell.rs, bonding_curve/instructions/purchase.rs, bonding_curve/instructions/claim_refund.rs, staking/helpers/math.rs, staking/instructions/update_cumulative.rs, staking/constants.rs, tax-program/helpers/tax_math.rs, tax-program/instructions/swap_sol_buy.rs, tax-program/instructions/swap_sol_sell.rs, amm/helpers/math.rs, epoch-program/helpers/tax_derivation.rs, epoch-program/state/epoch_state.rs, epoch-program/state/carnage_fund_state.rs, epoch-program/instructions/execute_carnage_atomic.rs, conversion-vault/instructions/convert.rs]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Arithmetic Safety -- Condensed Summary

## Key Findings (Top 10)

1. **Bonding curve sell tax uses u64 arithmetic, not u128**: Potential overflow if sol_gross exceeds ~1.23e15 lamports (~1230 SOL). The checked_mul catches this, but the bonding curve can theoretically produce sol_gross up to ~1000 SOL (1e12 lamports), so it's safe in practice. However, unlike tax_math.rs which uses u128 intermediates, this is a design inconsistency that reduces safety margin. -- `bonding_curve/instructions/sell.rs:174-179`

2. **get_current_price uses unchecked arithmetic and unwrap_or(0)**: The `checked_mul().unwrap_or(0)` silently returns 0 on overflow rather than erroring. The subsequent unchecked multiply `price_range * progress / PRECISION` could theoretically produce wrong results for out-of-range tokens_sold values. Used only for events/display, not financial logic. -- `bonding_curve/math.rs:203-212`

3. **Bonding curve math is extensively fuzz-tested (13.5M+ proptest iterations)**: Properties proven: no overflow, vault solvency, round-trip loss, monotonic pricing, sequential solvency. This is the highest quality math testing in the codebase. -- `bonding_curve/math.rs:576-999`

4. **Staking precision model (1e18 PRECISION) is sound**: u128 intermediates prevent overflow. Checked arithmetic throughout. Floor rounding favors protocol. Dead stake prevents first-depositor attack. 80K+ proptest iterations validate conservation and monotonicity. -- `staking/helpers/math.rs:36-127`

5. **Tax math split_distribution has provable sum-equals-total invariant**: Treasury absorbs rounding dust via remainder calculation. 10K proptest iterations validate. Micro-tax edge case (< 4 lamports) routes all to staking. -- `tax-program/helpers/tax_math.rs:79-110`

6. **Claim refund proportional math uses u128 intermediates but cast result to u64 without try_from**: The `as u64` at line 149 could theoretically truncate if refund_pool exceeds total_outstanding (impossible in practice since refund_pool comes from vault balance). Defense-in-depth would prefer try_from. -- `bonding_curve/instructions/claim_refund.rs:146-149`

7. **Carnage atomic slippage math has .unwrap() in test-only code**: The `.unwrap()` calls at lines 968-1012 in execute_carnage_atomic.rs are in `#[cfg(test)]` blocks -- confirmed false positive. Production code at lines 423-433 uses proper `ok_or(EpochError::Overflow)?`. -- `epoch-program/instructions/execute_carnage_atomic.rs:423-433`

8. **Conversion vault uses integer division (amount_in / 100) with remainder loss**: User loses up to 99 base units per conversion. The `OutputTooSmall` check prevents zero-output conversions, but dust loss is real. This is acceptable design (documented). -- `conversion-vault/instructions/convert.rs:101-105`

9. **AMM math (constant-product) is correctly implemented with u128 intermediates**: k-invariant verification uses u128 to prevent overflow on u64 * u64. Floor rounding on output favors protocol. 10K proptest iterations validate k-invariant preservation. -- `amm/helpers/math.rs:58-103`

10. **Tax rate derivation from VRF uses modulo on u8 (% 4)**: Modulo bias exists (256 % 4 == 0, so distribution is perfectly uniform). No arithmetic risk here. Rates are hardcoded to bounded arrays, preventing out-of-range values. -- `epoch-program/helpers/tax_derivation.rs:89-94`

## Critical Mechanisms

- **Bonding curve quadratic formula** (`bonding_curve/math.rs:56-110`): Solves the linear price curve integral using u128 arithmetic with PRECISION=1e12 scaling. Overflow analysis documented in comments shows worst-case values stay within u128. Floor division on tokens_out and ceil division on sol_for_tokens creates protocol-favored rounding on both sides.

- **Staking cumulative reward-per-token** (`staking/helpers/math.rs:91-127`): Synthetix pattern with 1e18 PRECISION. `pending_rewards * PRECISION / total_staked` computed in u128. Dead stake (MINIMUM_STAKE = 1e6) prevents division by zero. Rewards only accumulate (monotonic).

- **Tax split distribution** (`tax-program/helpers/tax_math.rs:79-110`): 71/24/5 BPS split with treasury absorbing rounding dust. Uses u128 intermediates. Conservation invariant (sum == total) enforced by construction (treasury = total - staking - carnage).

- **AMM constant-product formula** (`amm/helpers/math.rs:58-76`): `reserve_out * effective_input / (reserve_in + effective_input)` in u128. Output capped at reserve_out by mathematical property. u64::try_from() guard on result.

- **Bonding curve sell tax** (`bonding_curve/instructions/sell.rs:174-179`): Ceil-rounding tax: `(sol_gross * 1500 + 9999) / 10000` in u64 arithmetic. Bounded by maximum sol_gross from curve integral (~1000 SOL). checked_mul provides overflow protection.

## Invariants & Assumptions

- INVARIANT: `cost(tokens_out(S, x)) <= S` for all valid SOL inputs S and positions x (vault solvency) -- enforced at `bonding_curve/math.rs` via round-trip proptest (500K iterations)
- INVARIANT: `staking + carnage + treasury == total_tax` for all inputs -- enforced at `tax-program/helpers/tax_math.rs:105-107` by construction (treasury is remainder)
- INVARIANT: `rewards_per_token_stored` is monotonically non-decreasing -- enforced at `staking/helpers/math.rs:114` via checked_add (only ever adds)
- INVARIANT: k_after >= k_before for all valid AMM swaps -- enforced at `amm/helpers/math.rs:92-103` and verified by 10K proptest
- INVARIANT: No single user can claim more rewards than total deposited -- enforced by floor division in `staking/helpers/math.rs:49-50` and validated by proptest
- ASSUMPTION: `sol_gross` from bonding curve sell never exceeds ~1000 SOL (1e12 lamports) -- validated by curve parameters (`TARGET_SOL = 1e12`), but the u64 tax math would overflow at ~1.23e15 lamports. / NOT explicitly enforced in sell.rs but bounded by curve economics.
- ASSUMPTION: `tokens_sold` never exceeds `TARGET_TOKENS` (460e12) -- validated at `bonding_curve/instructions/purchase.rs:285` (status transition to Filled)
- ASSUMPTION: Bonding curve PRECISION (1e12) provides sufficient precision for the integral -- validated by proptest round-trip tests showing <= 1 lamport error

## Risk Observations (Prioritized)

1. **Bonding curve sell.rs tax computation in u64**: `bonding_curve/instructions/sell.rs:174` -- The `sol_gross.checked_mul(SELL_TAX_BPS)` operates in u64 space. While bounded by curve parameters in practice, any future increase in TARGET_SOL could push sol_gross past the overflow threshold (~1.23e15 lamports). This is the only financial calculation not using u128 intermediates.

2. **Claim refund `as u64` truncation risk**: `bonding_curve/instructions/claim_refund.rs:149` -- Result of u128 division cast to u64 without try_from. Theoretically safe because refund_pool < sol_vault.lamports() < u64::MAX, but lacks the defense-in-depth of other calculations.

3. **get_current_price unchecked multiply**: `bonding_curve/math.rs:210` -- `price_range * progress` is unchecked u128 multiplication. Safe with current parameters but fragile if constants change. Function is display-only (used in events), not financial.

4. **Staking update_rewards `as u64` cast**: `staking/helpers/math.rs:50` -- The result of `(balance * reward_delta) / PRECISION` is cast to u64 with `as u64`. If the intermediate value exceeds u64::MAX (which would require reward_delta > PRECISION * u64::MAX / balance), truncation occurs. In practice, reward_delta is bounded by total SOL ever deposited, making this safe.

5. **Carnage slippage calculation**: `epoch-program/instructions/execute_carnage_atomic.rs:423-433` -- The expected output calculation uses u128 intermediates correctly, but the `as u64` cast on the final result could truncate for extreme reserve values. In practice, pool reserves are bounded.

## Novel Attack Surface

- **Bonding curve sell/buy rounding arbitrage across partial fills**: The purchase instruction uses a partial-fill mechanism where `actual_sol` is recalculated via `calculate_sol_for_tokens` when `actual_tokens < tokens_out`. The ceil-rounding on sol_for_tokens means the user pays slightly more per token when the fill is partial. An attacker could attempt to exploit the difference between `sol_amount` (original) and `actual_sol` (recalculated) by manipulating the curve position to trigger partial fills at specific rounding boundaries. However, the 15% sell tax and minimum purchase (0.05 SOL) make this economically unviable. Worth verifying that `actual_sol <= sol_amount` always holds (it should, by the floor/ceil rounding relationship).

- **Cross-program precision mismatch**: The bonding curve uses PRECISION = 1e12, while staking uses PRECISION = 1e18. Tax math uses no precision scaling (raw BPS). There's no cross-program arithmetic, but if any future integration multiplies values with different precision assumptions, precision loss or overflow could occur.

## Cross-Focus Handoffs

- -> **Token/Economic Agent**: The bonding curve sell tax (15% ceil-rounding) feeds into tax_escrow which later distributes to epoch program's carnage vault. Verify the full SOL flow from sell -> escrow -> carnage is accounted for correctly.
- -> **Error Handling Agent**: `get_current_price()` uses `unwrap_or(0)` which silently fails. While display-only, this could mask bugs in future usage. Also, `claim_refund` uses `as u64` instead of `try_from().ok_or()`.
- -> **CPI Agent**: Tax program's `calculate_tax` returns `Option<u64>` but the instruction layer maps `None` to `TaxOverflow` error. Verify the CPI chain from Tax -> AMM correctly propagates these errors.
- -> **State Machine Agent**: The bonding curve `tokens_sold` counter is central to all math. Verify it cannot be manipulated to exceed TARGET_TOKENS (which would break all curve math assumptions).

## Trust Boundaries

The arithmetic trust model relies on bounded inputs: all token amounts are bounded by TARGET_TOKENS (460e12), all SOL amounts are bounded by TARGET_SOL (1e12), tax BPS is bounded by discrete VRF-derived values (100-1400 BPS). The u128 intermediate pattern is used consistently for cross-type multiplications. The key trust boundary is between user-supplied values (sol_amount, tokens_to_sell, minimum_output) and protocol-computed values (curve integrals, tax calculations). User inputs are validated before entering math functions (minimum purchase, balance checks), and math functions themselves use checked arithmetic. The weakest link is the bonding curve sell.rs tax computation which uses u64 rather than u128 intermediates, relying on parameter bounds rather than type safety.
<!-- CONDENSED_SUMMARY_END -->

---

# Arithmetic Safety -- Full Analysis

## Executive Summary

This analysis covers all arithmetic operations across 7 on-chain programs in the Dr. Fraudsworth protocol. The codebase demonstrates strong arithmetic hygiene overall: checked arithmetic is used pervasively, u128 intermediates prevent overflow in cross-type multiplications, and rounding consistently favors the protocol (floor on user payouts, ceil on user costs).

The highest-risk file is `bonding_curve/math.rs` (71 semgrep findings, 85 grep patterns) which implements a linear bonding curve using quadratic formula solving in u128. Despite the high pattern count, the implementation is sound -- the semgrep findings are mostly false positives from the proptest suite (13.5M iterations) using unchecked arithmetic in test-only code.

Two observations warrant follow-up investigation: (1) the bonding curve sell instruction computes tax in u64 space rather than u128, and (2) several `as u64` casts on u128 division results lack try_from guards. Neither is exploitable with current parameters, but both represent reduced safety margins compared to the rest of the codebase.

## Scope

**Files analyzed (full source read -- Layer 3):**
- `programs/bonding_curve/src/math.rs` (1,827 LOC)
- `programs/bonding_curve/src/constants.rs` (177 LOC)
- `programs/bonding_curve/src/instructions/sell.rs` (319 LOC)
- `programs/bonding_curve/src/instructions/purchase.rs` (310 LOC)
- `programs/bonding_curve/src/instructions/claim_refund.rs` (206 LOC)
- `programs/staking/src/helpers/math.rs` (735 LOC)
- `programs/staking/src/instructions/update_cumulative.rs` (257 LOC)
- `programs/staking/src/constants.rs` (202 LOC)
- `programs/tax-program/src/helpers/tax_math.rs` (515 LOC)
- `programs/amm/src/helpers/math.rs` (497 LOC)
- `programs/epoch-program/src/helpers/tax_derivation.rs` (333 LOC)
- `programs/conversion-vault/src/instructions/convert.rs` (174 LOC)

**Files analyzed (signature scan -- Layer 2):**
- `programs/tax-program/src/instructions/swap_sol_buy.rs` (arithmetic sections)
- `programs/tax-program/src/instructions/swap_sol_sell.rs` (arithmetic sections)
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` (arithmetic sections)
- `programs/epoch-program/src/state/epoch_state.rs` (structure only)
- `programs/epoch-program/src/state/carnage_fund_state.rs` (structure only)
- `programs/tax-program/src/state/epoch_state_reader.rs` (get_tax_bps only)

**Functions analyzed:** 22 production functions + 13 test/proptest suites

**Estimated coverage:** 90%+ of all arithmetic operations in production code

## Key Mechanisms

### 1. Bonding Curve Integral Math

**Location:** `programs/bonding_curve/src/math.rs:56-237`

**Purpose:** Implements buy (SOL->tokens) and sell (tokens->SOL) calculations for a linear bonding curve P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE.

**How it works:**

`calculate_tokens_out(sol_lamports, current_sold)` (lines 56-110):
- Converts inputs to u128
- Computes linear coefficient: `coef = P_START * TOTAL_FOR_SALE + (P_END-P_START) * current_sold`
- Computes discriminant: `coef^2 + 2 * (P_END-P_START) * sol_lamports * TOKEN_DECIMAL_FACTOR * TOTAL_FOR_SALE`
- Takes integer square root (isqrt)
- Computes `delta_x = (sqrt_disc - coef) / (P_END-P_START)` with floor division
- Caps at remaining supply

`calculate_sol_for_tokens(current_sold, tokens)` (lines 133-193):
- Uses PRECISION (1e12) scaling with remainder recovery for maximum precision
- Ceil-rounding via `(total_scaled + denominator - 1) / denominator`
- Splits division into quotient + remainder to recover precision from intermediate division

`get_current_price(tokens_sold)` (lines 203-212):
- Uses PRECISION scaling but with unchecked multiply (price_range * progress)
- `unwrap_or(0)` on checked_mul -- silent failure mode
- Display/event function only, not used in financial calculations

`calculate_refund(user_balance, refund_pool, total_outstanding)` (lines 229-237):
- u128 intermediates with floor division
- Returns None for zero denominator
- `as u64` cast on result (no try_from)

**Assumptions:**
- P_START < P_END (enforced: 900 < 3450)
- TOTAL_FOR_SALE fits in u128 (460e12 -- yes)
- sol_lamports fits in u128 (u64 input -- yes)
- Worst-case discriminant fits in u128: ~4.87e36 < 3.4e38 (documented, verified)
- isqrt is available on SBF platform (since platform-tools v1.51)

**Invariants:**
- `tokens_out = floor(exact_solution)` -- user gets fewer tokens (protocol-favored)
- `sol_for_tokens = ceil(exact_integral)` -- user pays more SOL (protocol-favored)
- `cost(floor_tokens) <= sol_input` -- vault is always solvent
- `cost(floor_tokens + 1) > sol_input` -- can't get extra tokens

**Concerns:**
- Line 104: `delta_x / b_num` uses direct division (not checked_div). b_num = P_END - P_START = 2550, which is always positive given the constant definitions. Safe but relies on constant relationship.
- Line 109: `tokens_out as u64` -- safe because tokens_out is capped at `remaining` which is derived from a u64 subtraction.
- Line 192: `sol_lamports as u64` -- safe because sol_lamports is at most `total_scaled / denominator` where total_scaled comes from u64 inputs multiplied by constants.
- Line 175: `term2_rem = b_num * rem * PRECISION / two_total` uses direct division. two_total > 0 always (= 2 * TOTAL_FOR_SALE). Safe.
- Line 210: `price_range * progress` unchecked. Safe with current constants (max 2550 * 1e12 = 2.55e15) but fragile.

### 2. AMM Constant-Product Math

**Location:** `programs/amm/src/helpers/math.rs:36-103`

**Purpose:** LP fee deduction, swap output calculation, and k-invariant verification for the constant-product AMM.

**How it works:**

`calculate_effective_input(amount_in, fee_bps)` (lines 36-40):
- `amount_in * (10_000 - fee_bps) / 10_000` in u128
- Returns None if fee_bps > 10_000 (underflow in subtraction)
- Fee deduction rounds down (protocol keeps dust)

`calculate_swap_output(reserve_in, reserve_out, effective_input)` (lines 58-76):
- `reserve_out * effective_input / (reserve_in + effective_input)` in u128
- Division by zero check (denominator == 0)
- u64::try_from() on output -- safe because output < reserve_out (which is u64)
- Floor rounding (protocol keeps dust)

`verify_k_invariant(...)` (lines 92-103):
- u128 multiplication of u64 * u64 -- fits in u128 (worst: (2^64-1)^2 = 2^128 - 2^65 + 1 < u128::MAX)
- Returns Some(true/false)

**Assumptions:**
- reserve_out < u64::MAX (Solana token amounts bounded)
- effective_input from calculate_effective_input is bounded
- Fee BPS is valid (0-10000)

**Invariants:**
- Output < reserve_out (can't drain more than pool holds)
- k_after >= k_before (proven by 10K proptest)
- Effective input is monotonically decreasing with fee_bps

**Concerns:**
- None identified. Implementation follows standard constant-product AMM pattern with appropriate safeguards.

### 3. Staking Reward Math

**Location:** `programs/staking/src/helpers/math.rs:36-127`

**Purpose:** Synthetix-style cumulative reward-per-token calculation for pro-rata SOL yield distribution.

**How it works:**

`update_rewards(pool, user)` (lines 36-67):
- `pending = (balance as u128) * (global_cumulative - user_checkpoint) / PRECISION`
- PRECISION = 1e18 (staking/constants.rs)
- `as u64` cast on result of u128 division
- Updates user's checkpoint to prevent double-claiming

`add_to_cumulative(pool)` (lines 91-127):
- `reward_per_token = (pending_rewards as u128) * PRECISION / (total_staked as u128)`
- Added to `rewards_per_token_stored` via checked_add
- Clears pending_rewards to 0

**Assumptions:**
- total_staked > 0 (guaranteed by MINIMUM_STAKE dead stake = 1e6)
- PRECISION (1e18) provides sufficient precision for reward distribution
- rewards_per_token_stored fits in u128 even after many epochs

**Overflow analysis:**
- `pending_rewards * PRECISION`: max u64 * 1e18 = 1.84e37, within u128 (3.4e38)
- `rewards_per_token_stored` accumulation: worst case 1e37 per epoch, even after 10 epochs = 1e38, approaching u128 max. For realistic values (max ~1e12 SOL deposited * 1e18 / 1e6 = 1e24 per epoch), thousands of epochs are safe.

**Invariants:**
- rewards_per_token_stored is monotonically non-decreasing
- Sum of individual rewards <= total deposited (proven by proptest)
- Floor division ensures protocol retains dust

**Concerns:**
- Line 50: `as u64` cast. The division by PRECISION (1e18) should always bring the result below u64::MAX for realistic inputs, but extreme accumulation over many epochs could theoretically exceed u64. The proptest bounds this to realistic ranges only.

### 4. Tax Math

**Location:** `programs/tax-program/src/helpers/tax_math.rs:34-165`

**Purpose:** BPS-based tax calculation and three-way distribution split (71% staking, 24% carnage, 5% treasury).

**How it works:**

`calculate_tax(amount_lamports, tax_bps)` (lines 34-53):
- Validates tax_bps <= 10_000
- `amount * bps / 10_000` in u128
- u64::try_from on result (safe: max = u64::MAX * 10000 / 10000 = u64::MAX)

`split_distribution(total_tax)` (lines 79-110):
- Micro-tax edge case: if total_tax < 4, all goes to staking
- Staking = floor(total * 7100 / 10000) in u128
- Carnage = floor(total * 2400 / 10000) in u128
- Treasury = total - staking - carnage (remainder absorbs rounding)

`calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps)` (lines 141-165):
- Constant-product expected output in u128
- Floor = expected * floor_bps / 10000
- `as u64` cast on result (safe: floor <= expected <= reserve_out <= u64::MAX)

**Invariants:**
- staking + carnage + treasury == total_tax (enforced by construction)
- tax <= amount_lamports (for valid BPS)
- output_floor <= expected_output

**Concerns:**
- Line 164: `floor as u64` -- safe because floor <= reserve_out which is u64.
- The micro-tax threshold (< 4 lamports) means for very small taxes, carnage and treasury get nothing. This is documented and intentional.

### 5. Bonding Curve Sell Tax

**Location:** `programs/bonding_curve/src/instructions/sell.rs:174-179`

**Purpose:** Compute 15% sell tax on gross SOL proceeds from bonding curve sell.

**How it works:**
```rust
let tax = sol_gross
    .checked_mul(SELL_TAX_BPS)     // u64 * u64
    .ok_or(CurveError::Overflow)?
    .checked_add(BPS_DENOMINATOR - 1) // ceil rounding
    .ok_or(CurveError::Overflow)?
    / BPS_DENOMINATOR;
```

**Assumptions:**
- sol_gross is bounded by curve economics (max ~TARGET_SOL = 1e12 lamports)
- SELL_TAX_BPS = 1500 (15%)
- BPS_DENOMINATOR = 10000

**Overflow analysis:**
- `sol_gross * 1500`: max 1e12 * 1500 = 1.5e15, well within u64 (1.8e19)
- `+ 9999`: 1.5e15 + 9999 still within u64
- HOWEVER: if sol_gross exceeds ~1.23e16 (12,300 SOL), the checked_mul overflows u64. The checked_mul catches this and returns Overflow error.

**Concerns:**
- Uses u64 arithmetic instead of u128 intermediates. All other tax calculations in the codebase (tax_math.rs) use u128. This is inconsistent and reduces safety margin.
- The overflow threshold (~12,300 SOL) is 12x the maximum theoretical sol_gross from the curve (~1000 SOL), providing adequate safety margin with current parameters.
- If curve parameters were ever increased (e.g., TARGET_SOL = 10,000 SOL), this code would start failing with Overflow errors for legitimate sells.

### 6. Claim Refund Proportional Math

**Location:** `programs/bonding_curve/src/instructions/claim_refund.rs:146-149`

**Purpose:** Calculate proportional SOL refund based on user's token balance vs total outstanding.

**How it works:**
```rust
let refund_amount = ((user_balance as u128)
    .checked_mul(refund_pool as u128)
    .ok_or(CurveError::Overflow)?
    / (total_outstanding as u128)) as u64;
```

**Assumptions:**
- total_outstanding > 0 (checked at line 126)
- refund_pool derived from vault balance minus rent (always < u64::MAX)
- user_balance <= total_outstanding (user can't hold more tokens than total sold)

**Concerns:**
- `as u64` on the division result: The result is `user_balance * refund_pool / total_outstanding`. Since user_balance <= total_outstanding, the result <= refund_pool < u64::MAX. The cast is safe.
- Floor rounding means some dust remains in the vault after all claims. This is protocol-favored (correct).
- As tokens_sold decreases with each claim (line 183-186), later claimers divide by a smaller denominator, getting a slightly larger share of remaining SOL. This is the correct proportional refund behavior.

### 7. Conversion Vault Math

**Location:** `programs/conversion-vault/src/instructions/convert.rs:90-114`

**Purpose:** Fixed-rate token conversion at 100:1 (CRIME/FRAUD -> PROFIT) or 1:100 (PROFIT -> CRIME/FRAUD).

**How it works:**
- CRIME/FRAUD -> PROFIT: `amount_in / 100` (integer division, remainder lost)
- PROFIT -> CRIME/FRAUD: `amount_in.checked_mul(100)` (overflow-checked)

**Concerns:**
- Integer division remainder (up to 99 base units) is lost. With 6 decimals, this is up to 0.000099 tokens -- negligible.
- The multiply direction (PROFIT -> CRIME/FRAUD) is checked for overflow. A PROFIT input of u64::MAX / 100 + 1 = 1.84e17 would cause overflow. This is 184 billion PROFIT tokens -- far beyond the 20M total supply.

## Trust Model

**Trusted computations (protocol-computed, not user-influenced):**
- Curve integral results (calculate_tokens_out, calculate_sol_for_tokens)
- Tax calculations (calculate_tax, split_distribution)
- Reward per token (add_to_cumulative)
- VRF-derived tax rates (derive_taxes)

**Untrusted inputs (user-supplied):**
- sol_amount (purchase): Validated against MIN_PURCHASE_SOL
- tokens_to_sell (sell): Validated against user balance
- minimum_tokens_out / minimum_sol_out: Slippage protection, checked after calculation
- amount_in (convert): Validated > 0, checked for overflow

**Trust boundaries:**
- All user inputs are validated before entering math functions
- Math functions use checked arithmetic internally
- Results are validated post-computation (solvency assertions, slippage checks)

## State Analysis

**State modified by arithmetic:**
- `CurveState.tokens_sold`: Incremented on purchase, decremented on sell and refund claim
- `CurveState.sol_raised`: Incremented on purchase (checked_add)
- `CurveState.sol_returned`: Incremented on sell (checked_add)
- `CurveState.tax_collected`: Incremented on sell (checked_add)
- `StakePool.rewards_per_token_stored`: Incremented in update_cumulative (checked_add, u128)
- `StakePool.pending_rewards`: Set in deposit_rewards, cleared in update_cumulative
- `StakePool.total_distributed`: Incremented in update_cumulative (checked_add)
- `UserStake.rewards_earned`: Incremented in update_rewards (checked_add)

**Read-only arithmetic state:**
- `EpochState.*_tax_bps`: Read by Tax Program for rate lookup
- Pool reserves: Read for slippage floor calculations

## Dependencies

- `anchor_lang::prelude`: Error types, program entrypoint
- `spl_token_2022`: Token transfer operations
- No external math libraries (all custom implementations)
- No floating-point arithmetic anywhere in production code

## Focus-Specific Analysis

### Arithmetic Operations Inventory

| Location | Operation | Operand Types | Checked? | Intermediate Width | Risk |
|----------|-----------|---------------|----------|-------------------|------|
| math.rs:76-78 | a * b_den + b_num * x1 | u128 | Yes (checked_mul/add) | u128 | LOW |
| math.rs:82-94 | coef^2 + 2*b_num*s*d*b_den | u128 | Yes | u128 | LOW |
| math.rs:104 | numerator / b_num | u128 | No (direct div) | u128 | LOW (b_num=2550, constant) |
| math.rs:147-176 | term1 + term2 (sol integral) | u128 | Yes | u128 | LOW |
| math.rs:188-190 | ceil division | u128 | Yes (checked_add) | u128 | LOW |
| math.rs:210 | price_range * progress | u128 | **No** | u128 | LOW (display only) |
| sell.rs:174-179 | sol_gross * 1500 + 9999 | **u64** | Yes (checked_mul/add) | **u64** | MEDIUM |
| claim_refund.rs:146-149 | balance * pool / outstanding | u128->u64 | Partial (checked_mul, unchecked cast) | u128 | LOW |
| staking/math.rs:46-50 | balance * delta / PRECISION | u128->u64 | Partial (checked_mul/div, unchecked cast) | u128 | LOW |
| staking/math.rs:107-111 | pending * PRECISION / staked | u128 | Yes | u128 | LOW |
| tax_math.rs:46-48 | amount * bps / 10000 | u128->u64 | Yes (try_from) | u128 | LOW |
| tax_math.rs:96-101 | total * BPS / 10000 | u128->u64 | Yes (try_from) | u128 | LOW |
| amm/math.rs:66-73 | r_out * eff / (r_in + eff) | u128->u64 | Yes (try_from) | u128 | LOW |
| convert.rs:103 | amount_in / 100 | u64 | No (direct div) | u64 | LOW (intentional) |
| convert.rs:108-110 | amount_in * 100 | u64 | Yes (checked_mul) | u64 | LOW |
| execute_carnage_atomic.rs:423-428 | reserve * amount / (reserve + amount) | u128->u64 | Partial (and_then, unchecked cast) | u128 | LOW |

### Cast Analysis

| Location | Source -> Target | Can Truncate? | Impact if Max Value |
|----------|-----------------|---------------|---------------------|
| math.rs:64 | u64 -> u128 (current_sold) | No (widening) | Safe |
| math.rs:65 | u64 -> u128 (sol_lamports) | No (widening) | Safe |
| math.rs:109 | u128 -> u64 (tokens_out) | Yes if > u64::MAX | Capped at remaining (u64), safe |
| math.rs:192 | u128 -> u64 (sol_lamports) | Yes if > u64::MAX | Bounded by input params, safe |
| math.rs:211 | u128 -> u64 (price) | Yes if > u64::MAX | Max = P_END = 3450, safe |
| math.rs:236 | u128 -> u64 (refund) | Yes if > u64::MAX | Bounded by refund_pool (u64), safe |
| claim_refund.rs:149 | u128 -> u64 | Yes if > u64::MAX | Result <= refund_pool (u64), safe |
| staking/math.rs:50 | u128 -> u64 | Yes if > u64::MAX | Result bounded by pending (u64), safe |
| amm/math.rs:75 | u128 -> u64 (try_from) | Returns None | Handled correctly |
| tax_math.rs:52 | u128 -> u64 (try_from) | Returns None | Handled correctly |
| tax_math.rs:97,101 | u128 -> u64 (try_from) | Returns None | Handled correctly |
| execute_carnage_atomic.rs:428 | u128 -> u64 | Yes | Bounded by reserve (u64), safe |
| execute_carnage_atomic.rs:433 | u128 -> u64 | Yes | Bounded by expected (u64), safe |

### Precision Model

| Value Type | Decimal Precision | Scaling Factor | Rounding Direction |
|-----------|-------------------|----------------|-------------------|
| Token amounts (CRIME/FRAUD/PROFIT) | 6 decimals | TOKEN_DECIMAL_FACTOR (1e6) | N/A |
| SOL amounts (lamports) | 9 decimals | Native | N/A |
| Bonding curve intermediate | 12 decimals | PRECISION (1e12) | Floor tokens, ceil SOL |
| Staking cumulative | 18 decimals | PRECISION (1e18) | Floor rewards |
| Tax BPS | 2 decimals | BPS (10000 = 100%) | Floor tax |
| Tax split | 2 decimals | BPS | Floor staking/carnage, remainder treasury |
| AMM swap output | Native | u128 intermediates | Floor output |
| Output floor | 2 decimals | BPS | Floor |

### Rounding Direction Analysis

| Operation | Rounding | Favors | Exploitable? |
|-----------|----------|--------|-------------|
| Bonding curve buy (tokens out) | Floor | Protocol | No -- user gets fewer tokens |
| Bonding curve buy (SOL cost for partial fill) | Ceil | Protocol | No -- user pays more |
| Bonding curve sell (SOL gross) | Ceil | Protocol | No -- user gets slightly more gross BUT... |
| Bonding curve sell (tax) | Ceil | Protocol | No -- user pays more tax |
| Bonding curve sell (net = gross - tax) | Combined | Protocol | No -- ceil gross + ceil tax = slightly less net |
| Staking reward claim | Floor | Protocol | No -- dust stays in escrow |
| Tax split (staking + carnage) | Floor | Treasury | No -- treasury absorbs dust |
| AMM swap output | Floor | Protocol | No -- pool keeps dust |
| Refund claim | Floor | Protocol | No -- dust stays in vault |
| Conversion (CRIME->PROFIT) | Floor | Protocol | No -- remainder lost |

## Cross-Focus Intersections

- **Arithmetic x Token/Economic**: Every arithmetic result feeds into a token transfer or lamport manipulation. The sell.rs tax computation directly determines how much SOL is transferred to user vs escrow.
- **Arithmetic x CPI**: The staking reward_per_token calculation is called via CPI from Epoch Program. Arithmetic correctness here affects all stakers' yield.
- **Arithmetic x State Machine**: The bonding curve tokens_sold counter drives all curve math. State transitions (Active -> Filled) depend on arithmetic comparison (tokens_sold >= TARGET_TOKENS).
- **Arithmetic x Timing**: The bonding curve deadline check precedes all math -- expired curves reject sells, preventing edge cases in the math.

## Cross-Reference Handoffs

- -> **Token/Economic Agent**: The 15% sell tax on bonding curve sells is computed differently (u64 ceil rounding) than AMM swap taxes (u128 via tax_math.rs). Verify both flows produce correct economic outcomes.
- -> **Error Handling Agent**: `get_current_price()` at `math.rs:208` uses `unwrap_or(0)` which silently returns 0 instead of propagating an error. While used only in events, this could mask issues.
- -> **State Machine Agent**: `claim_refund` decrements `tokens_sold` at line 183-186. As this denominator shrinks with each claim, later claimers get proportionally more of remaining SOL. Verify this is correct behavior and cannot be exploited via claim ordering.
- -> **CPI Agent**: The Carnage slippage calculation in `execute_carnage_atomic.rs:423-433` reads pool reserves from raw bytes. Verify the byte offsets match the actual PoolState layout.

## Risk Observations

1. **u64 tax math in sell.rs vs u128 everywhere else**: The bonding curve sell.rs computes tax in u64 space (lines 174-179) while tax_math.rs uses u128 intermediates. This is a design inconsistency. If curve parameters change to allow higher SOL amounts, this code would need updating.

2. **`as u64` casts without try_from in multiple locations**: claim_refund.rs:149, staking/math.rs:50, execute_carnage_atomic.rs:428,433. All are provably safe with current parameters but lack the defense-in-depth of try_from. If input bounds change, these become truncation vectors.

3. **get_current_price unchecked arithmetic**: math.rs:204 (`P_END - P_START` unchecked), math.rs:210 (`price_range * progress` unchecked). Constants make this safe, but refactoring could introduce issues.

4. **Staking PRECISION 1e18 vs Bonding Curve PRECISION 1e12**: Different precision scaling factors could cause confusion in future cross-program integrations. Currently no cross-program arithmetic exists.

5. **Claim refund sequential claiming changes denominator**: Each claim reduces tokens_sold, changing the refund calculation for subsequent claimers. Floor rounding means earlier claimers get slightly less per token than later claimers (the pool grows relatively as denominator shrinks). This is correct proportional math but could be surprising.

## Novel Attack Surface Observations

1. **Bonding curve partial-fill rounding gap**: When a purchase is partially filled (actual_tokens < tokens_out), the user pays `calculate_sol_for_tokens(pos, actual_tokens)` which uses ceil rounding. But they originally computed `calculate_tokens_out(sol_amount, pos)` with floor rounding. The difference `sol_amount - actual_sol` is "overpayment" that stays in the vault as surplus. An attacker who can precisely control the remaining supply to trigger partial fills at maximum rounding gap could extract this surplus on a subsequent sell. However, the 15% sell tax makes this economically infeasible -- the tax far exceeds any rounding surplus.

2. **Staking reward accumulation u128 overflow after extremely long operation**: With 1e18 PRECISION, maximum pending per epoch of ~1e12 SOL, and minimum total_staked of 1e6, reward_per_token per epoch = 1e12 * 1e18 / 1e6 = 1e24. After 1e14 epochs (~3.2 million years at 10s epochs), cumulative would overflow u128. Not a practical concern, but the checked_add would start returning errors, bricking the staking system. A migration plan should exist for extreme longevity.

## Questions for Other Focus Areas

- For CPI Agent: In the sell flow, does the Token-2022 transfer_checked CPI (sell.rs lines 200-232) correctly account for any Transfer Hook-induced state changes before the direct lamport manipulation (sell.rs lines 241-248)?
- For State Machine Agent: Can tokens_sold ever become negative via underflow? The checked_sub at sell.rs:155-157 and claim_refund.rs:183-186 should prevent this, but verify no path bypasses these checks.
- For Account Validation Agent: The claim_refund instruction reads vault lamports at line 136 and transfers at line 176. Is there a TOCTOU risk if another transaction modifies the vault between these reads?
- For Timing Agent: The bonding curve deadline check at sell.rs:142-145 uses slot comparison. If the clock is manipulated (validator timing variance), could a sell execute with stale curve state?

## Raw Notes

**Previous audit finding recheck:**

- **H041 (Tax math incorrect fee calculation)**: The swap_sol_buy.rs tax calculation now uses `calculate_tax()` from tax_math.rs with u128 intermediates (line 83). The split_distribution (line 116-118) produces correct 71/24/5 split. The previous finding appears resolved -- the calculation chain is: `calculate_tax(amount_in, tax_bps) -> sol_to_swap = amount_in - tax -> split_distribution(tax_amount)`. All operations use checked arithmetic and u128 intermediates.

- **H075 (Staking reward precision loss)**: The PRECISION of 1e18 with u128 intermediates provides adequate precision. Floor rounding consistently favors protocol. The `as u64` cast at line 50 is the remaining concern -- it's safe because the result is bounded by pending_rewards which is u64, but lacks explicit try_from defense-in-depth.

- **H084 (Tax math rounding)**: The rounding behavior is now well-documented and intentional: floor on staking/carnage portions, remainder to treasury. Sum-equals-total invariant is proven by proptest. Micro-tax edge case (< 4 lamports) routes all to staking. No rounding exploitation path found.

- **H092 (Pool reserve overflow)**: AMM pool reserves are stored as u64. The k-invariant check uses u128 intermediates (amm/math.rs:98-101). u64::MAX * u64::MAX = 2^128 - 2^65 + 1 which fits in u128. No overflow possible in the k-invariant check.

**Semgrep finding analysis for bonding_curve/math.rs (71 findings):**

The vast majority are in the `#[cfg(test)]` proptest blocks (lines 243-999). Test code intentionally uses unchecked arithmetic for performance in property-based testing. Production functions (lines 56-237) use checked arithmetic consistently. The only unchecked operations in production are:
- Line 104: `numerator / b_num` (safe: b_num is a constant > 0)
- Line 161: `product / two_total` (safe: two_total is a constant > 0)
- Line 175: `... / two_total` (same)
- Line 190: `... / denominator` (safe: denominator is product of two constants > 0)
- Lines 204, 210: `get_current_price` unchecked arithmetic (display-only function)
