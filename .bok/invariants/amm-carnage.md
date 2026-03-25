---
task_id: bok-analyze-amm-carnage
provides: [invariant-proposals]
subsystem: amm-swap-math, carnage-slippage
confidence: high
invariant_count: 18
---

# Invariant Proposals -- AMM Swap Math & Carnage Slippage

## Source Files
- `programs/amm/src/helpers/math.rs` (497 lines) -- calculate_effective_input, calculate_swap_output, verify_k_invariant
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` -- 85% slippage floor, combined SOL capping, raw pool reserve reading
- Existing: 22 unit + 3 proptest (10K each) for AMM; 4 unit tests for Carnage
- Previous BOK run: 5 Kani proofs passed, 8 timed out on AMM math

---

## Part A: AMM Swap Math (INV-1 through INV-8)

### INV-AMM-001: k-Invariant Preservation

**What it checks:**
After every swap, the product of reserves (k = reserve_a * reserve_b) is >= the product before the swap. The constant-product invariant holds.

**Why it matters:**
If k decreases after a swap, value is leaking from the pool. An attacker could execute swaps that systematically drain liquidity, eventually emptying the pool. This is the foundational AMM property.

**Tool:** Proptest (100K iterations -- reassigned from Kani to avoid previous timeout)
**Confidence:** high
**Based on:** VP-001 (constant-product preservation)

**Formal Property:**
```
For all valid swap(input, reserve_a, reserve_b):
  k_after = (reserve_a + effective_input) * (reserve_b - output)
  assert!(k_after >= reserve_a * reserve_b)
```

**Proptest sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn prop_k_invariant_preservation(
        reserve_a in 1_000u64..10_000_000_000,
        reserve_b in 1_000u64..10_000_000_000,
        input in 1u64..1_000_000_000
    ) {
        let k_before = reserve_a as u128 * reserve_b as u128;
        let effective = calculate_effective_input(input)?;
        let output = calculate_swap_output(effective, reserve_a, reserve_b)?;
        let k_after = (reserve_a as u128 + effective as u128) * (reserve_b as u128 - output as u128);
        prop_assert!(k_after >= k_before);
    }
}
```

---

### INV-AMM-002: Output Strictly Less Than Reserve

**What it checks:**
The swap output is always strictly less than the output reserve. A single swap can never drain the entire output side of the pool.

**Why it matters:**
If output >= reserve_b, the pool is emptied in one trade. The constant-product formula mathematically prevents this, but implementation bugs (especially with integer arithmetic) could violate it.

**Tool:** Kani (bounded)
**Confidence:** high
**Based on:** VP-002 (output < reserve)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_output_lt_reserve() {
    let reserve_a: u64 = kani::any();
    let reserve_b: u64 = kani::any();
    let input: u64 = kani::any();
    kani::assume!(reserve_a >= 1000 && reserve_b >= 1000);
    kani::assume!(input > 0 && input <= 1_000_000_000);
    let effective = calculate_effective_input(input).unwrap();
    let output = calculate_swap_output(effective, reserve_a, reserve_b).unwrap();
    kani::assert!(output < reserve_b);
}
```

---

### INV-AMM-003: Fee Never Exceeds Principal

**What it checks:**
The LP fee deducted from the input amount is always <= the input amount. The effective input after fees is non-negative.

**Why it matters:**
If the fee calculation overflows or uses wrong BPS, the "effective input" could be larger than the actual input (negative fee). This would create value from nothing.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-003 (fee bounds), VP-011 (BPS computation)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_fee_lte_principal() {
    let input: u64 = kani::any();
    kani::assume!(input > 0);
    let effective = calculate_effective_input(input).unwrap();
    kani::assert!(effective <= input);
    kani::assert!(effective > 0 || input == 0);
}
```

---

### INV-AMM-004: Fee Monotonicity

**What it checks:**
Larger inputs produce larger (or equal) fees. The fee function is monotonically non-decreasing.

**Why it matters:**
If larger trades pay less fees, traders could avoid fees by using a single large trade instead of many small ones -- or vice versa. Either direction creates an unfair advantage.

**Tool:** Proptest (100K)
**Confidence:** high
**Based on:** VP-004 (fee monotonicity)

**Proptest sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn prop_fee_monotonic(
        input_a in 1u64..1_000_000_000,
        input_b in 1u64..1_000_000_000
    ) {
        let fee_a = input_a - calculate_effective_input(input_a)?;
        let fee_b = input_b - calculate_effective_input(input_b)?;
        if input_a <= input_b {
            prop_assert!(fee_a <= fee_b);
        }
    }
}
```

---

### INV-AMM-005: Swap Output Monotonic in Input (NEW -- NO EXISTING COVERAGE)

**What it checks:**
For fixed reserves, a larger input always produces a larger (or equal) output. The swap function is monotonically non-decreasing in the input amount.

**Why it matters:**
If this fails, a trader paying more gets less. Beyond being unfair, it enables a split attack: execute two smaller swaps that together yield more than one large swap, draining the pool.

**Tool:** Proptest (100K)
**Confidence:** high
**Based on:** VP-005 (output monotonicity), novel gap identification

**Proptest sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn prop_output_monotonic_in_input(
        reserve_a in 1_000u64..10_000_000_000,
        reserve_b in 1_000u64..10_000_000_000,
        input_a in 1u64..500_000_000,
        input_b in 1u64..500_000_000
    ) {
        let eff_a = calculate_effective_input(input_a)?;
        let eff_b = calculate_effective_input(input_b)?;
        let out_a = calculate_swap_output(eff_a, reserve_a, reserve_b)?;
        let out_b = calculate_swap_output(eff_b, reserve_a, reserve_b)?;
        if input_a <= input_b {
            prop_assert!(out_a <= out_b);
        }
    }
}
```

---

### INV-AMM-006: Zero Input Yields Zero Output

**What it checks:**
A swap with 0 input produces exactly 0 output. No tokens are created from nothing.

**Why it matters:**
If zero-input returns non-zero output, an attacker can call swap repeatedly with 0 tokens to drain the pool for free.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-006 (zero-input safety)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_zero_input_zero_output() {
    let reserve_a: u64 = kani::any();
    let reserve_b: u64 = kani::any();
    kani::assume!(reserve_a >= 1000 && reserve_b >= 1000);
    let effective = calculate_effective_input(0).unwrap();
    kani::assert!(effective == 0);
    // calculate_swap_output with 0 effective should return 0
}
```

---

### INV-AMM-007: u128 No Overflow for Valid Inputs

**What it checks:**
All u128 intermediate computations in calculate_swap_output stay within bounds for reserves up to 10B tokens and inputs up to 1B tokens.

**Why it matters:**
The constant-product formula uses `input * reserve_b` as a u128 intermediate. If reserves are large enough for this to overflow u128 (unlikely but must be proven), the output wraps to a small number.

**Tool:** Kani (bounded)
**Confidence:** high
**Based on:** VP-007 (overflow safety), VP-082 (precision overflow)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_amm_u128_no_overflow() {
    let reserve_a: u64 = kani::any();
    let reserve_b: u64 = kani::any();
    let input: u64 = kani::any();
    kani::assume!(reserve_a >= 1000 && reserve_a <= 10_000_000_000);
    kani::assume!(reserve_b >= 1000 && reserve_b <= 10_000_000_000);
    kani::assume!(input > 0 && input <= 1_000_000_000);
    // Should not panic from overflow
    let _ = calculate_swap_output(input, reserve_a, reserve_b);
}
```

---

### INV-AMM-008: k-Check Symmetry (NEW -- Phase 52.1 Informed)

**What it checks:**
verify_k_invariant produces the same result regardless of which token is designated as A vs B. The k-check is symmetric under mint reordering.

**Why it matters:**
Phase 52.1 discovered that mint ordering (PROFIT vs CRIME as mint_a) was causing incorrect reserve mapping. If verify_k_invariant depends on which side is A vs B, the `is_reversed` detection could pass k-check in one direction but fail in the other.

**Tool:** Proptest (100K)
**Confidence:** medium
**Based on:** Novel (informed by Phase 52.1 canonical mint ordering bug)

**Proptest sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn prop_k_check_symmetric(
        r_a in 1_000u64..10_000_000_000,
        r_b in 1_000u64..10_000_000_000,
        input in 1u64..1_000_000_000
    ) {
        // Swap A->B
        let out_ab = calculate_swap_output(input, r_a, r_b)?;
        let k_ab = verify_k_invariant(r_a, r_b, r_a + input, r_b - out_ab);
        // Swap B->A (reversed)
        let out_ba = calculate_swap_output(input, r_b, r_a)?;
        let k_ba = verify_k_invariant(r_b, r_a, r_b + input, r_a - out_ba);
        prop_assert_eq!(k_ab, k_ba);
    }
}
```

---

## Part B: Carnage Slippage (INV-9 through INV-16)

### INV-CARN-009: 85% Slippage Floor Math

**What it checks:**
The slippage floor calculation `expected_output * 8500 / 10000` always produces a value that is exactly 85% of expected output (within 1 unit of rounding).

**Why it matters:**
If the floor is calculated wrong (e.g., overflow in multiplication, wrong constant), carnage swaps could either fail unnecessarily (floor too high) or accept catastrophic slippage (floor too low).

**Tool:** Proptest (100K)
**Confidence:** high
**Based on:** VP-008 (slippage bound), VP-011 (BPS arithmetic)

**Proptest sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn prop_slippage_floor_85pct(expected_output in 1u64..10_000_000_000) {
        let floor = expected_output as u128 * 8500 / 10000;
        let exact = expected_output as f64 * 0.85;
        let diff = (floor as f64 - exact).abs();
        prop_assert!(diff < 1.0);
    }
}
```

---

### INV-CARN-010: Combined SOL Capping (NEW -- NO EXISTING COVERAGE)

**What it checks:**
The total SOL used in a carnage buy step (`swap_amount + sol_from_sale`) is capped at MAX and never exceeds the vault's available balance.

**Why it matters:**
If the combined amount overflows u64 or exceeds the vault balance, the CPI will fail (best case) or transfer incorrect amounts (worst case). The cap must be applied BEFORE the CPI call.

**Tool:** Kani
**Confidence:** high
**Based on:** Novel (Carnage sell-proceeds fix from Feb 2026)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_combined_sol_capped() {
    let swap_amount: u64 = kani::any();
    let sol_from_sale: u64 = kani::any();
    let max_budget: u64 = kani::any();
    let vault_balance: u64 = kani::any();
    kani::assume!(max_budget <= vault_balance);
    let total = swap_amount.saturating_add(sol_from_sale);
    let capped = std::cmp::min(total, max_budget);
    kani::assert!(capped <= vault_balance);
    kani::assert!(capped <= max_budget);
}
```

---

### INV-CARN-011: wrap_amount Never Exceeds available_sol (NEW -- NO EXISTING COVERAGE)

**What it checks:**
The amount wrapped to WSOL for the buy step never exceeds the SOL actually available. Only the tax portion gets wrapped; sell WSOL is already in the carnage_wsol account.

**Why it matters:**
If wrap_amount > available SOL, the wrap CPI fails and the entire carnage transaction reverts. In the worst case, an incorrect wrap_amount could double-count SOL that's already in WSOL form.

**Tool:** Proptest
**Confidence:** high
**Based on:** Novel (Carnage bug fix from Feb 2026)

---

### INV-CARN-012: Pool Reserve Reader Byte Alignment (NEW -- NO EXISTING COVERAGE)

**What it checks:**
The raw pool reserve reading (`read_pool_reserves`) correctly extracts u64 values from the PoolState byte layout at offsets 137 and 145.

**Why it matters:**
If the byte offset is wrong (e.g., the AMM program changes its struct layout), the reserve reader returns garbage values. This would cause the slippage floor to be calculated against wrong reserves, potentially accepting a 99% loss or rejecting valid swaps.

**Tool:** LiteSVM
**Confidence:** medium
**Based on:** Novel (cross-program byte-level coupling)

**LiteSVM sketch:**
```rust
#[test]
fn test_reserve_reader_matches_amm_struct() {
    // Create a PoolState with known reserves via AMM program
    // Read reserves via read_pool_reserves byte extraction
    // Assert they match
}
```

---

### INV-CARN-013: Slippage Floor Overflow Safety

**What it checks:**
The multiplication `expected_output * 8500` never overflows u64 for any realistic output value.

**Why it matters:**
If expected_output > u64::MAX / 8500, the multiplication overflows and the floor becomes a tiny number, accepting catastrophic slippage.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-011 (BPS overflow)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_slippage_floor_no_overflow() {
    let expected_output: u64 = kani::any();
    kani::assume!(expected_output <= 10_000_000_000_000); // 10K SOL max
    let product = expected_output as u128 * 8500u128;
    kani::assert!(product <= u64::MAX as u128 * 10); // plenty of room
}
```

---

### INV-CARN-014: Sell Proceeds Not Stranded (Regression -- NO EXISTING TEST)

**What it checks:**
After a carnage sell step, the SOL proceeds are correctly routed to the buy step. No SOL is stranded in intermediate accounts.

**Why it matters:**
This was an actual bug (fixed Feb 2026). The sell WSOL was being stranded because the buy step tried to wrap it again. This regression test ensures the fix holds.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** Novel (regression for Carnage bug fix)

---

### INV-CARN-015: Rent-Exempt Preserved (NEW -- NO EXISTING COVERAGE)

**What it checks:**
After all carnage operations, the vault account maintains at least the rent-exempt minimum balance. Operations never dip below rent-exempt.

**Why it matters:**
If the vault drops below rent-exempt, it gets garbage-collected by the Solana runtime, permanently destroying the account and all its data. This is an irrecoverable loss.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** Novel (Solana runtime concern)

---

### INV-CARN-016: Burn-then-Buy Vault Delta (Regression -- NO EXISTING TEST)

**What it checks:**
In BuyOnly+Burn carnage paths, the vault's SOL balance decreases by exactly the buy amount (no extra SOL consumed by the burn step).

**Why it matters:**
The burn step doesn't use SOL, but if account routing is wrong, the buy CPI could accidentally use SOL from the wrong source. This regression ensures clean separation.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** Novel (regression for Carnage 6-path fix)

---

## Part C: Cross-Domain (INV-17 through INV-18)

### INV-CROSS-017: Carnage/AMM Formula Consistency (NEW -- NO EXISTING COVERAGE)

**What it checks:**
The slippage floor calculation in carnage uses the same swap math as the AMM. The "expected output" used for the 85% floor matches what the AMM would actually return.

**Why it matters:**
If carnage calculates expected output with a different formula than the AMM uses, the 85% floor could be based on wrong expectations -- either too permissive or too restrictive.

**Tool:** Proptest (100K)
**Confidence:** high
**Based on:** Novel (cross-program consistency)

**Proptest sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn prop_carnage_amm_formula_match(
        reserve_a in 1_000u64..10_000_000_000,
        reserve_b in 1_000u64..10_000_000_000,
        input in 1u64..1_000_000_000
    ) {
        let amm_output = calculate_swap_output(
            calculate_effective_input(input)?, reserve_a, reserve_b
        )?;
        let carnage_expected = /* carnage's expected output formula */;
        prop_assert_eq!(amm_output, carnage_expected);
    }
}
```

---

### INV-CROSS-018: Post-Fee Output Always Passes 85% Floor (NEW -- NO EXISTING COVERAGE)

**What it checks:**
The actual swap output (after LP fees) is always >= the 85% floor of the pre-fee expected output. Normal market conditions should never trigger the slippage protection.

**Why it matters:**
If the fee deduction makes the output fall below the 85% floor in normal conditions, every carnage attempt would revert. The 85% floor should only trigger during extreme price impact, not from fees.

**Tool:** Proptest (100K)
**Confidence:** medium
**Based on:** VP-008 (slippage interaction with fees)

---

## Coverage Gap Analysis

**P0 gaps (no existing coverage):**
1. INV-AMM-005: Swap output monotonicity
2. INV-AMM-008: k-check symmetry (Phase 52.1 informed)
3. INV-CARN-010: Combined SOL capping
4. INV-CARN-011: wrap_amount bounds
5. INV-CARN-012: Pool reserve byte alignment
6. INV-CROSS-017: Carnage/AMM formula consistency

**Regression gaps (previously-fixed bugs, no test):**
7. INV-CARN-014: Sell proceeds not stranded
8. INV-CARN-016: Burn-then-buy vault delta

**Kani timeout mitigation:**
- Previous run had 8 Kani timeouts on AMM math
- Reassigned full-range properties to Proptest 100K
- Kept Kani for bounded proofs (output < reserve, fee <= principal, zero input, overflow)

**Cross-program risk:**
- 3 independent copies of `read_pool_reserves` with hardcoded byte offsets (AMM, Tax, Carnage)
- If AMM struct layout changes, all three break silently
- INV-CARN-012 addresses this for Carnage; similar tests needed for Tax
