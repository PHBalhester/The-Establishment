# AMM Swap Math -- Verification Invariants

Source: `programs/amm/src/helpers/math.rs` (497 lines)
Call sites: `programs/amm/src/instructions/swap_sol_pool.rs`, `programs/amm/src/instructions/swap_profit_pool.rs`
Constants: `programs/amm/src/constants.rs`

---

## Function Map

| Function | Line | Purpose |
|----------|------|---------|
| `calculate_effective_input` | 36 | LP fee deduction: `amount_in * (10_000 - fee_bps) / 10_000` |
| `calculate_swap_output` | 58 | Constant-product output: `reserve_out * eff / (reserve_in + eff)` |
| `verify_k_invariant` | 92 | Post-swap safety check: `k_after >= k_before` |
| `check_effective_input_nonzero` | 115 | Guards against fee consuming entire input |
| `check_swap_output_nonzero` | 129 | Guards against zero-output swaps |

---

## Invariants

### INV-AMM-001: k-Invariant Preservation

**Function:** `verify_k_invariant` at `math.rs:92`
**Pattern:** VP-001 (Conservation of Value), VP-003 (K-Invariant Maintenance)
**Tool:** Proptest (degrades from Kani -- Kani not installed)
**Confidence:** high

**Plain English:** After every valid swap, the product of reserves (k = reserve_in * reserve_out) must be greater than or equal to what it was before the swap. Floor division in the output calculation means k strictly increases on every non-zero swap.

**Why It Matters:** If k decreases, an attacker can extract more tokens from the pool than they deposited. Repeated k-decreasing swaps would drain the pool entirely. This is the fundamental safety property that prevents pool theft. A single swap that reduces k by even 1 unit opens a path to total pool drain via iterative extraction.

**Formal Property:**
```
For all (reserve_in, reserve_out, amount_in, fee_bps) where
  reserve_in > 0, reserve_out > 0, amount_in > 0, fee_bps in [0, 10000]:

  let eff = calculate_effective_input(amount_in, fee_bps)
  let output = calculate_swap_output(reserve_in, reserve_out, eff)
  let new_in = reserve_in + amount_in    // pre-fee amount added to reserves
  let new_out = reserve_out - output

  => new_in * new_out >= reserve_in * reserve_out
```

**Verification Approach:**
Existing proptest `k_invariant_holds_for_valid_swaps` at line 400 covers this with 10,000 iterations using stratified random inputs (90% realistic range, 10% edge cases including 0, 1, u64::MAX). Kani would provide formal exhaustive proof over bounded inputs; since Kani is not installed, the proptest provides high probabilistic confidence. The critical insight: `amount_in` (pre-fee) is added to `reserve_in`, but only `effective_input` (post-fee) participates in the output calculation. The difference (the fee) strictly increases k.

---

### INV-AMM-002: Output Bounded by Reserve

**Function:** `calculate_swap_output` at `math.rs:58`
**Pattern:** VP-001 (Conservation of Value)
**Tool:** Proptest (degrades from Kani)
**Confidence:** high

**Plain English:** The output of any swap must be strictly less than the output reserve. No single swap can drain a pool, regardless of how large the input is.

**Why It Matters:** If output could equal or exceed reserve_out, a sufficiently large swap would empty one side of the pool. The pool would become permanently broken (one reserve at zero), and the attacker would have extracted all tokens of one type. This is a pool drain attack.

**Formal Property:**
```
For all (reserve_in, reserve_out, effective_input) where
  reserve_in > 0, reserve_out > 0, effective_input > 0:

  let output = calculate_swap_output(reserve_in, reserve_out, effective_input)

  => output.is_some() implies output.unwrap() < reserve_out
```

**Proof Sketch (from liquidity-slippage-analysis.md):**
Since `reserve_in > 0`, we have `reserve_in + effective_input > effective_input`, therefore `effective_input / (reserve_in + effective_input) < 1`, therefore `reserve_out * effective_input / (reserve_in + effective_input) < reserve_out`. Integer truncation only makes this smaller. QED.

**Verification Approach:**
Existing proptest `output_never_exceeds_reserve_out` at line 454 covers this with 10,000 iterations. The mathematical proof is complete (documented in liquidity-slippage-analysis.md). The on-chain k-invariant check provides defense-in-depth: even if the formula somehow produced output >= reserve_out (impossible), k_after would be <= 0 < k_before, triggering `AmmError::KInvariantViolation`.

---

### INV-AMM-003: Fee Never Exceeds Principal

**Function:** `calculate_effective_input` at `math.rs:36`
**Pattern:** VP-005 (Fee Never Exceeds Principal)
**Tool:** Proptest (degrades from Kani)
**Confidence:** high

**Plain English:** The effective input after fee deduction must be less than or equal to the original input. The fee deduction must never produce a result larger than the input (which would manufacture tokens from nothing).

**Why It Matters:** If `effective_input > amount_in`, the swap math would compute output as if the user deposited more than they actually did. The pool would pay out more tokens than warranted by the actual deposit, and k would decrease -- enabling extraction. A bug in the fee math (e.g., subtracting fee_bps from a number larger than 10,000) could cause this.

**Formal Property:**
```
For all (amount_in: u64, fee_bps: u16) where fee_bps in [0, 10000]:

  let eff = calculate_effective_input(amount_in, fee_bps)

  => eff.is_some() implies eff.unwrap() <= amount_in as u128
```

**Verification Approach:**
The implementation computes `amount * (10_000 - fee_bps) / 10_000`. Since `fee_bps <= 10000`, the fee_factor is in [0, 10000], so the product is `<= amount * 10000`, and dividing by 10000 yields `<= amount`. For `fee_bps > 10000`, checked_sub returns None (line 38). Proptest with `fee_bps_strategy` (0-9999 range + fixed 50/100 bps) validates this over 10,000 iterations. Kani would cover all 65536 possible u16 fee_bps values exhaustively.

---

### INV-AMM-004: Fee Monotonicity

**Function:** `calculate_effective_input` at `math.rs:36`
**Pattern:** VP-011 (Fee Rounding Direction)
**Tool:** Proptest
**Confidence:** high

**Plain English:** Higher fee_bps values must always produce less-or-equal effective input for the same amount_in. A fee of 2% must never leave more tokens than a fee of 1%.

**Why It Matters:** If the fee function were non-monotonic (e.g., due to integer rounding artifacts at certain input sizes), a user could pick a "sweet spot" fee rate that pays less fee than a lower rate. In the Dr. Fraudsworth AMM, fee_bps is set per pool at initialization and is immutable, so the user cannot choose it. But this property is still critical for correctness: it ensures the protocol's fee revenue is monotonically increasing with fee_bps.

**Formal Property:**
```
For all (amount_in: u64, fee_low: u16, fee_high: u16) where
  0 <= fee_low <= fee_high <= 10000:

  let eff_low = calculate_effective_input(amount_in, fee_low)
  let eff_high = calculate_effective_input(amount_in, fee_high)

  => eff_low >= eff_high  (lower fee leaves more input)
```

**Verification Approach:**
Existing proptest `fee_calculation_is_monotonic` at line 477 validates with 10,000 random (amount, fee_low, fee_delta) triples. The math is straightforward: `amount * (10000 - fee) / 10000` is a decreasing function of `fee` for fixed `amount`, because `(10000 - fee)` decreases. Integer truncation preserves monotonicity since floor(a * x / c) is monotonic in x when a, c > 0.

---

### INV-AMM-005: Zero-Fee Precision Loss

**Function:** `calculate_effective_input` at `math.rs:36`
**Pattern:** VP-014 (Fee Precision Loss at Small Amounts)
**Tool:** Proptest
**Confidence:** high

**Plain English:** When the input amount is very small (specifically, `amount_in * (10000 - fee_bps) < 10000`), the effective input rounds to zero. The swap effectively charges a 100% fee. The `check_effective_input_nonzero` guard catches this and rejects the swap.

**Why It Matters:** Without the zero-check at `swap_sol_pool.rs:130`, a user could send 1 lamport with 100 bps fee. The effective input would be `1 * 9900 / 10000 = 0`. The swap would add 1 lamport to `reserve_in` but produce 0 output, increasing k for free. The user's lamport is donated to the pool with no return. While not an exploit (the protocol profits), it is user-hostile. The `ZeroEffectiveInput` error prevents this.

**Formal Property:**
```
For all (amount_in: u64, fee_bps: u16) where
  amount_in > 0, fee_bps < 10000:

  let eff = calculate_effective_input(amount_in, fee_bps)

  => (eff == Some(0)) iff (amount_in * (10000 - fee_bps) < 10000)
```

**Verification Approach:**
The threshold where effective input becomes zero is `amount_in < ceil(10000 / (10000 - fee_bps))`. At 100 bps (1% fee), this is `amount_in < ceil(10000/9900) = 2`, so amounts of 0 and 1 produce zero. Proptest can verify this boundary precisely by testing amounts near the threshold for each fee tier. The existing unit test `fee_on_one` at line 184 covers the canonical case (1 lamport, 100 bps -> 0).

---

### INV-AMM-006: u128 Overflow Safety

**Function:** `calculate_effective_input` at `math.rs:36`, `calculate_swap_output` at `math.rs:58`
**Pattern:** VP-015 (BPS Overflow), VP-084 (Intermediate Precision Loss)
**Tool:** Proptest (degrades from Kani)
**Confidence:** high

**Plain English:** All intermediate arithmetic uses u128. The maximum possible intermediate value is `u64::MAX * 10000` (in fee calc) or `u64::MAX * u64::MAX` (in swap output numerator). Both fit within u128. No checked operation should return None for valid inputs.

**Why It Matters:** If arithmetic silently overflowed (wrapping u64), the output calculation could produce wildly incorrect results -- potentially outputting more tokens than the reserve holds. The use of u128 intermediates prevents this. If someone changes the code to use u64 intermediates, `u64::MAX * 9900` would wrap, producing a tiny effective_input and enabling the user to extract nearly the entire output reserve for a dust input.

**Formal Property:**
```
Fee calc: For all (amount_in: u64, fee_bps: u16) where fee_bps <= 10000:
  amount_in as u128 * (10000 - fee_bps as u128) <= u128::MAX
  (Proof: u64::MAX * 10000 = 1.8e23, u128::MAX = 3.4e38)

Swap calc: For all (reserve_out: u64, effective_input: u128 where eff <= u64::MAX * 10000):
  reserve_out as u128 * effective_input <= u128::MAX
  (Proof: u64::MAX * (u64::MAX * 10000) = 1.8e23 * 1.8e19 = 3.2e42 -- EXCEEDS u128::MAX)
```

**FINDING:** The swap numerator `reserve_out * effective_input` CAN overflow u128 if `effective_input` is near `u64::MAX * 10000` and `reserve_out` is near `u64::MAX`. However, `effective_input` comes from `calculate_effective_input` which returns `amount_in * fee_factor / 10000`, so `effective_input <= amount_in`. Since `amount_in` is u64, `effective_input <= u64::MAX`. The actual maximum is `u64::MAX * u64::MAX = (2^64-1)^2 = 2^128 - 2^65 + 1 < u128::MAX = 2^128 - 1`. Safe. The `checked_mul` at line 66 catches the theoretical overflow case.

**Verification Approach:**
The existing unit test `swap_u64_max_reserves_small_input` at line 258 and `fee_on_u64_max` at line 192 test u64::MAX boundaries. Proptest covers random combinations including edge cases. Kani would prove no-overflow exhaustively over bounded ranges.

---

### INV-AMM-007: k-Invariant Check Ordering (CEI)

**Function:** `handler` at `swap_sol_pool.rs:57`
**Pattern:** VP-002 (Slippage Bound), VP-008 (Flash Loan Sandwich)
**Tool:** LiteSVM (runtime integration test)
**Confidence:** high

**Plain English:** The k-invariant check at swap_sol_pool.rs line 171-173 executes BEFORE token transfers (line 210+). This is the "Effects before Interactions" pattern (CEI). Reserves are updated in state before tokens move, and the invariant is verified on the new reserve values.

**Why It Matters:** If k-invariant were checked AFTER token transfers, a reentrancy attack through the Transfer Hook could manipulate pool state between the transfer and the check. The CEI ordering prevents this: reserves are committed and validated before any external CPI. Even though Solana's runtime prevents true reentrancy (pool.locked guard at line 84), the CEI pattern provides defense-in-depth.

**Formal Property:**
```
In the instruction execution flow:
  1. pool.locked = true                          (line 84)
  2. effective_input = fee_calc(amount_in)       (line 125)
  3. amount_out = swap_calc(reserves, eff)       (line 135)
  4. slippage check: amount_out >= minimum       (line 145)
  5. new_reserves = update(reserves, in, out)    (line 163-168)
  6. k_valid = verify_k(old, new)                (line 171)
  7. require!(k_valid)                           (line 173)
  8. write reserves to pool state                (line 176-185)
  9. TOKEN TRANSFERS (CPI)                       (line 210-315)
  10. pool.locked = false                        (line 322)
```

**Verification Approach:**
This is a code structure invariant, not a mathematical one. Static analysis or manual audit confirms the ordering. LiteSVM integration tests can verify that the pool state is correctly updated before and after transfers by inspecting account data at each step. The reentrancy guard (`pool.locked`) provides additional protection against reentrant calls during the Transfer Hook CPI.

---

### INV-AMM-008: Slippage Check Precedes Transfer

**Function:** `handler` at `swap_sol_pool.rs:145`
**Pattern:** VP-004 (Minimum Output Enforcement)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The user-provided `minimum_amount_out` is checked BEFORE any token transfer CPI. If the computed output is less than the minimum, the transaction reverts without moving any tokens.

**Why It Matters:** If slippage were checked AFTER transfers, a failed slippage check would need to "unwind" already-executed token transfers. On Solana, CPI failures do revert the entire transaction, but checking early prevents wasted compute units and makes the failure mode explicit. More critically, there is no code path that bypasses the check -- every swap passes through lines 145-148.

**Formal Property:**
```
For all swap executions:
  amount_out < minimum_amount_out => transaction reverts with AmmError::SlippageExceeded
  No token transfer CPI executes before the slippage check at line 145.
```

**Verification Approach:**
Manual code review confirms the ordering: slippage check at line 145, first transfer CPI at line 214+. LiteSVM tests should submit swaps with absurdly high `minimum_amount_out` and verify no token balances change. The constraint is structural -- the `require!` macro exits the handler immediately on failure, so downstream code (including transfers) never executes.

---

### INV-AMM-009: Zero-Output Swap Rejection

**Function:** `check_swap_output_nonzero` at `math.rs:129`, called at `swap_sol_pool.rs:139`
**Pattern:** VP-014 (Fee Precision Loss at Small Amounts)
**Tool:** Proptest
**Confidence:** high

**Plain English:** If a swap would produce zero output tokens despite having nonzero effective input, the transaction is rejected with `AmmError::ZeroSwapOutput`. This prevents users from burning tokens for nothing.

**Why It Matters:** Without this guard, a user swapping a tiny amount into a pool with very imbalanced reserves could get zero output. Their input tokens would be permanently added to the pool reserves (increasing k), but they receive nothing. While this benefits the protocol, it is user-hostile. In an adversarial scenario, a griefer could repeatedly send dust transactions to inflate k without cost if gas fees are low.

**Formal Property:**
```
For all (effective_input: u128, amount_out: u64):

  effective_input > 0 AND amount_out == 0
    => check_swap_output_nonzero returns false
    => transaction reverts with AmmError::ZeroSwapOutput
```

**Verification Approach:**
The function is trivially correct by inspection (line 130: `!(amount_out == 0 && effective_input > 0)`). Proptest should generate edge cases where `effective_input > 0` but the constant-product formula truncates output to 0 (e.g., `effective_input = 1, reserve_in = u64::MAX, reserve_out = 1`). Verify the guard catches all such cases.

---

### INV-AMM-010: Fee Rounding Favors Protocol

**Function:** `calculate_effective_input` at `math.rs:36`
**Pattern:** VP-011 (Fee Rounding Direction)
**Tool:** Proptest
**Confidence:** high

**Plain English:** Fee deduction uses floor division (`amount * fee_factor / 10000`), which rounds the effective input DOWN. This means the fee actually charged is rounded UP -- the protocol always collects at least as much fee as the mathematical formula specifies. The user never gets a "free pass" on fees due to rounding.

**Why It Matters:** If fee rounding favored the user (ceiling on effective_input), tiny rounding differences could accumulate over millions of swaps. Each swap would underpay the fee by up to 1 unit. While individually negligible, this is a directional bias that leaks value from the protocol. Floor division on effective_input ensures the bias favors the pool.

**Formal Property:**
```
For all (amount_in: u64, fee_bps: u16) where fee_bps in [0, 10000]:

  let actual_effective = calculate_effective_input(amount_in, fee_bps)
  let exact_effective = amount_in * (10000 - fee_bps) / 10000  (real arithmetic)

  => actual_effective <= floor(exact_effective)
  (i.e., the protocol never undercharges)
```

**Verification Approach:**
Since `u128` division truncates toward zero (which is floor for positive values), and all values are non-negative, this holds by construction. Proptest can double-check by computing `amount_in * fee_factor` and verifying `(amount_in * fee_factor) % 10000` (the remainder) is always >= 0, meaning the truncation always drops a non-negative amount.

---

### INV-AMM-011: Swap Output Rounding Favors Protocol

**Function:** `calculate_swap_output` at `math.rs:58`
**Pattern:** VP-011 (Fee Rounding Direction)
**Tool:** Proptest
**Confidence:** high

**Plain English:** The swap output uses floor division (`reserve_out * eff / (reserve_in + eff)`), which rounds output DOWN. The user gets slightly less than the mathematically exact output. The "dust" -- typically 0-1 base units per swap -- stays in the pool, increasing k.

**Why It Matters:** This rounding direction is what makes INV-AMM-001 (k >= k_before) possible. If output were rounded UP (ceiling), the user would sometimes extract more value than the constant-product formula provides, reducing k. Over enough swaps, k would trend toward zero, enabling pool drain. Floor division on output is the mechanism that prevents this.

**Formal Property:**
```
For all (reserve_in, reserve_out: u64, effective_input: u128) where denominator > 0:

  let actual_output = calculate_swap_output(reserve_in, reserve_out, effective_input)
  let exact_output = reserve_out * effective_input / (reserve_in + effective_input)  (real)

  => actual_output <= floor(exact_output)
```

**Verification Approach:**
Same reasoning as INV-AMM-010. u128 division truncates toward zero. This is the standard AMM construction used by Uniswap V2 and derivatives. The proptest `k_invariant_holds_for_valid_swaps` implicitly validates this because if output were rounded up, k would decrease for some inputs, and the proptest would catch it.

---

## Summary Table

| ID | Name | Pattern | Tool | Confidence | Existing Coverage |
|----|------|---------|------|------------|-------------------|
| INV-AMM-001 | k-Invariant Preservation | VP-001, VP-003 | Proptest | high | Yes (line 400, 10K iter) |
| INV-AMM-002 | Output Bounded by Reserve | VP-001 | Proptest | high | Yes (line 454, 10K iter) |
| INV-AMM-003 | Fee Never Exceeds Principal | VP-005 | Proptest | high | Partial (implicit) |
| INV-AMM-004 | Fee Monotonicity | VP-011 | Proptest | high | Yes (line 477, 10K iter) |
| INV-AMM-005 | Zero-Fee Precision Loss | VP-014 | Proptest | high | Partial (unit test) |
| INV-AMM-006 | u128 Overflow Safety | VP-015, VP-084 | Proptest | high | Partial (edge tests) |
| INV-AMM-007 | k-Invariant Check Ordering | VP-002, VP-008 | LiteSVM | high | Manual audit |
| INV-AMM-008 | Slippage Check Precedes Transfer | VP-004 | LiteSVM | high | Manual audit |
| INV-AMM-009 | Zero-Output Swap Rejection | VP-014 | Proptest | high | Partial (unit test) |
| INV-AMM-010 | Fee Rounding Favors Protocol | VP-011 | Proptest | high | Implicit via INV-001 |
| INV-AMM-011 | Swap Output Rounding Favors Protocol | VP-011 | Proptest | high | Implicit via INV-001 |

### Coverage Gaps

1. **INV-AMM-003** (Fee <= Principal): No explicit proptest. Implicitly covered by k-invariant proptest but should have its own dedicated property test.
2. **INV-AMM-005** (Zero-fee boundary): Only unit tests at the boundary. A proptest sweeping `amount_in` in [1, 100] with all fee tiers would be stronger.
3. **INV-AMM-006** (Overflow): Edge case tests exist but no systematic proptest covering `(u64::MAX, u64::MAX, u64::MAX)` combinations across all three functions simultaneously.
4. **INV-AMM-007/008** (Ordering): These are structural invariants. Static analysis tools or a dedicated LiteSVM test that hooks into Transfer Hook CPI to verify ordering would add confidence.
