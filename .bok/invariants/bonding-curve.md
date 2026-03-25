---
task_id: bok-analyze-bonding-curve
provides: [invariant-proposals]
subsystem: bonding-curves
confidence: high
invariant_count: 14
---

# Invariant Proposals -- Bonding Curve (math.rs, purchase.rs, sell.rs)

## Source Files
- `programs/bonding_curve/src/math.rs` (~400 lines) -- calculate_tokens_out, calculate_sol_for_tokens, get_current_price
- `programs/bonding_curve/src/instructions/purchase.rs` (310 lines) -- wallet cap, partial fill, SOL recalculation
- `programs/bonding_curve/src/instructions/sell.rs` (320 lines) -- reverse integral, ceil-rounded 15% tax, solvency assertion
- Category: Bonding Curves + Fee Calculations + Decimal Normalization
- Constants: P_START=900, P_END=3450, TOTAL_FOR_SALE=460T, PRECISION=1e12, TARGET_SOL=1000

## Existing Coverage
- 13.5M+ proptest iterations (P1-P5, S1-S6) during v1.2
- Covers: no-panic (P1/P2), price monotonicity (P3), round-trip (P4), full integral (P5), sell conservation (S1), solvency basic (S2)

---

## Proposed Invariants

### INV-BC-001: Round-Trip Value Non-Creation

**What it checks:**
Buying tokens with X SOL, then immediately selling those same tokens, must return <= X SOL (after tax). No value is created through the round-trip.

**Why it matters:**
If the reverse integral overestimates SOL owed, an attacker could buy-then-sell in a loop, extracting SOL from the vault each cycle until it's drained. This is the most critical property for any bonding curve.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-047 (bonding curve integral consistency), VP-048 (buy-sell round-trip)

**Formal Property:**
```
For all valid sol_amount, tokens_sold:
  let tokens = calculate_tokens_out(sol_amount, tokens_sold)
  let sol_back = calculate_sol_for_tokens(tokens_sold, tokens)
  let sol_after_tax = sol_back - ceil_tax(sol_back)
  assert!(sol_after_tax <= sol_amount)
```

**Kani sketch:**
```rust
#[kani::proof]
#[kani::unwind(2)]
fn proof_round_trip_no_value_creation() {
    let sol_amount: u64 = kani::any();
    let tokens_sold: u64 = kani::any();
    kani::assume!(sol_amount > 0 && sol_amount <= 1_000_000_000_000); // <= 1000 SOL
    kani::assume!(tokens_sold <= TOTAL_FOR_SALE);
    let tokens = calculate_tokens_out(sol_amount, tokens_sold).unwrap();
    if tokens > 0 {
        let sol_back = calculate_sol_for_tokens(tokens_sold, tokens).unwrap();
        let tax = (sol_back * 1500 + 9999) / 10000;
        let sol_after_tax = sol_back - tax;
        kani::assert!(sol_after_tax <= sol_amount);
    }
}
```

---

### INV-BC-002: Price Monotonicity

**What it checks:**
The spot price get_current_price(tokens_sold) is strictly non-decreasing as more tokens are sold. Price can only go up along the curve.

**Why it matters:**
If price decreases at some point on the curve, an attacker could buy at the dip and sell at a higher position, extracting arbitrage profits that drain the vault. The linear bonding curve must have monotonic pricing.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-049 (monotonic pricing)

**Formal Property:**
```
For all a, b where a < b <= TOTAL_FOR_SALE:
  get_current_price(a) <= get_current_price(b)
```

**Kani sketch:**
```rust
#[kani::proof]
fn proof_price_monotonicity() {
    let a: u64 = kani::any();
    let b: u64 = kani::any();
    kani::assume!(a < b && b <= TOTAL_FOR_SALE);
    kani::assert!(get_current_price(a) <= get_current_price(b));
}
```

---

### INV-BC-003: Input Monotonicity (More SOL -> More Tokens)

**What it checks:**
For a fixed position on the curve, providing more SOL always yields more (or equal) tokens. calculate_tokens_out is monotonically non-decreasing in its SOL input.

**Why it matters:**
If this fails, a user paying more SOL could receive fewer tokens. Beyond being unfair, it could be exploited: split a large purchase into smaller ones to get more tokens total (see INV-BC-010).

**Tool:** Kani
**Confidence:** high
**Based on:** VP-047 (integral monotonicity), novel application to input axis

**Formal Property:**
```
For all sol_a < sol_b, fixed tokens_sold:
  calculate_tokens_out(sol_a, tokens_sold) <= calculate_tokens_out(sol_b, tokens_sold)
```

**Kani sketch:**
```rust
#[kani::proof]
fn proof_input_monotonicity() {
    let sol_a: u64 = kani::any();
    let sol_b: u64 = kani::any();
    let tokens_sold: u64 = kani::any();
    kani::assume!(sol_a < sol_b);
    kani::assume!(sol_b <= 1_000_000_000_000);
    kani::assume!(tokens_sold <= TOTAL_FOR_SALE);
    let t_a = calculate_tokens_out(sol_a, tokens_sold).unwrap_or(0);
    let t_b = calculate_tokens_out(sol_b, tokens_sold).unwrap_or(0);
    kani::assert!(t_a <= t_b);
}
```

---

### INV-BC-004: Full Integral Bounds

**What it checks:**
The total SOL collected when selling ALL tokens (from 0 to TOTAL_FOR_SALE) equals approximately TARGET_SOL (1000 SOL). The integral of the entire curve is bounded.

**Why it matters:**
If the integral exceeds TARGET_SOL, the vault won't hold enough SOL for the last sellers. If it's significantly less, the protocol undercharges buyers. Either way, it breaks the economic model.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-050 (curve integral bounds)

**Formal Property:**
```
let total_sol = calculate_sol_for_tokens(0, TOTAL_FOR_SALE)
assert!(total_sol >= TARGET_SOL * 0.999 && total_sol <= TARGET_SOL * 1.001)
```

**Proptest sketch:**
```rust
#[test]
fn test_full_integral_bounds() {
    let total_sol = calculate_sol_for_tokens(0, TOTAL_FOR_SALE).unwrap();
    let target_lamports = 1_000_000_000_000u64; // 1000 SOL
    assert!(total_sol >= target_lamports * 999 / 1000);
    assert!(total_sol <= target_lamports * 1001 / 1000);
}
```

---

### INV-BC-005: Sell Tax Ceil >= Floor

**What it checks:**
The ceil-rounded 15% tax `(sol_gross * 1500 + 9999) / 10000` is always >= the floor-rounded tax `sol_gross * 1500 / 10000`. The protocol never undercharges tax.

**Why it matters:**
If rounding somehow produces a lower tax than floor division, the protocol loses revenue on every sell. Over many transactions, dust leakage accumulates. Ceil rounding must always favor the protocol.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-014 (rounding direction), VP-015 (fee floor guarantee)

**Formal Property:**
```
For all sol_gross > 0:
  (sol_gross * 1500 + 9999) / 10000 >= sol_gross * 1500 / 10000
```

**Kani sketch:**
```rust
#[kani::proof]
fn proof_ceil_tax_gte_floor() {
    let sol_gross: u64 = kani::any();
    kani::assume!(sol_gross > 0 && sol_gross <= 1_000_000_000_000);
    let ceil_tax = (sol_gross as u128 * 1500 + 9999) / 10000;
    let floor_tax = (sol_gross as u128 * 1500) / 10000;
    kani::assert!(ceil_tax >= floor_tax);
}
```

---

### INV-BC-006: Sell Tax Never Overflows u64

**What it checks:**
The intermediate computation `sol_gross * 1500 + 9999` never overflows u64 for any valid SOL amount within the curve bounds.

**Why it matters:**
If sol_gross is large enough that `sol_gross * 1500` overflows u64, the tax computation wraps and produces an incorrect (tiny) tax. Attacker sells a large position, pays near-zero tax due to overflow, extracts protocol funds.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-011 (BPS overflow), VP-082 (precision scaling overflow)

**Formal Property:**
```
For all sol_gross where sol_gross <= TARGET_SOL_LAMPORTS:
  sol_gross as u128 * 1500 + 9999 fits in u64
  -- OR verify it uses u128 intermediate (which is safe)
```

**Kani sketch:**
```rust
#[kani::proof]
fn proof_sell_tax_no_overflow() {
    let sol_gross: u64 = kani::any();
    kani::assume!(sol_gross <= 1_000_000_000_000); // 1000 SOL max
    let intermediate = sol_gross as u128 * 1500u128 + 9999u128;
    kani::assert!(intermediate <= u64::MAX as u128);
}
```

---

### INV-BC-007: Vault Solvency After Sell (Strengthened)

**What it checks:**
After any sequence of N buys and M sells, the vault balance is always >= the integral from 0 to current tokens_sold. The vault can always cover all remaining sellers.

**Why it matters:**
If rounding errors accumulate across many transactions, the vault could slowly become insolvent. The last sellers would be unable to redeem. This is the global solvency guarantee.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-051 (reserve solvency), VP-047 (integral consistency)

**Formal Property:**
```
For all buy/sell sequences of length N:
  let vault = sum(buy_deposits) - sum(sell_withdrawals)
  let expected = calculate_sol_for_tokens(0, tokens_sold)
  assert!(vault >= expected)
```

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_vault_solvency_multi_tx(
        ops in prop::collection::vec((0..2u8, 1..1000u64), 1..100)
    ) {
        let mut tokens_sold = 0u64;
        let mut vault_balance = 0i128;
        for (op_type, amount) in ops {
            if op_type == 0 { // buy
                let tokens = calculate_tokens_out(amount * 1_000_000, tokens_sold)?;
                vault_balance += (amount * 1_000_000) as i128;
                tokens_sold += tokens;
            } else if tokens_sold > 0 { // sell
                let sell_tokens = std::cmp::min(amount, tokens_sold);
                let sol_back = calculate_sol_for_tokens(tokens_sold - sell_tokens, sell_tokens)?;
                let tax = (sol_back * 1500 + 9999) / 10000;
                vault_balance -= (sol_back - tax) as i128;
                tokens_sold -= sell_tokens;
            }
            let expected = calculate_sol_for_tokens(0, tokens_sold)? as i128;
            prop_assert!(vault_balance >= expected);
        }
    }
}
```

---

### INV-BC-008: Partial Fill SOL Recalculation

**What it checks:**
When a purchase partially fills (tokens_out > remaining supply), the SOL charged is recalculated for the actual tokens delivered. The user never overpays for a partial fill.

**Why it matters:**
If the partial fill path charges the original SOL amount but delivers fewer tokens, the excess SOL is trapped in the vault — a direct loss for the buyer. The recalculation must be exact.

**Tool:** Proptest
**Confidence:** high
**Based on:** Novel (partial fill edge case)

**Formal Property:**
```
For all sol_amount, tokens_sold where tokens_out > (TOTAL_FOR_SALE - tokens_sold):
  let actual_tokens = TOTAL_FOR_SALE - tokens_sold
  let actual_sol = calculate_sol_for_tokens(tokens_sold, actual_tokens)
  assert!(actual_sol <= sol_amount)
```

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_partial_fill_no_overpay(
        remaining in 1..1000u64,
        sol_amount in 100_000_000..1_000_000_000_000u64
    ) {
        let tokens_sold = TOTAL_FOR_SALE - remaining;
        let tokens_out = calculate_tokens_out(sol_amount, tokens_sold)?;
        if tokens_out > remaining {
            let actual_sol = calculate_sol_for_tokens(tokens_sold, remaining)?;
            prop_assert!(actual_sol <= sol_amount);
        }
    }
}
```

---

### INV-BC-009: Buy+Sell Conservation

**What it checks:**
Buying tokens with X SOL then selling those same tokens returns strictly less SOL (due to 15% tax). No value is created through the cycle across the full range of the curve.

**Why it matters:**
Extends the round-trip check (INV-BC-001) to cover the entire curve range with statistical confidence. Even if Kani proves it for bounded inputs, proptest covers the full domain including edge cases near TOTAL_FOR_SALE.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-048 (buy-sell conservation)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_buy_sell_conservation(
        sol_amount in 1_000_000u64..1_000_000_000_000,
        tokens_sold in 0u64..TOTAL_FOR_SALE
    ) {
        let tokens = calculate_tokens_out(sol_amount, tokens_sold)?;
        if tokens > 0 {
            let sol_back = calculate_sol_for_tokens(tokens_sold, tokens)?;
            let tax = (sol_back * 1500 + 9999) / 10000;
            prop_assert!(sol_back - tax <= sol_amount);
        }
    }
}
```

---

### INV-BC-010: Integral Additivity (No Split Exploit)

**What it checks:**
Splitting a purchase into two smaller buys never yields more tokens than a single large buy for the same total SOL. `tokens_out(A+B, pos) >= tokens_out(A, pos) + tokens_out(B, pos+tokens_out(A, pos))`.

**Why it matters:**
The quadratic formula uses floor division. If `floor(A) + floor(B) > floor(A+B)`, an attacker could split purchases to extract more tokens than intended. This is a known DeFi exploit vector for bonding curves.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-047 (integral sub-additivity), novel priority escalation

**Formal Property:**
```
For all sol_a, sol_b, tokens_sold:
  let single = calculate_tokens_out(sol_a + sol_b, tokens_sold)
  let t1 = calculate_tokens_out(sol_a, tokens_sold)
  let t2 = calculate_tokens_out(sol_b, tokens_sold + t1)
  assert!(single >= t1 + t2)
```

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_no_split_exploit(
        sol_a in 1_000_000u64..500_000_000_000,
        sol_b in 1_000_000u64..500_000_000_000,
        tokens_sold in 0u64..TOTAL_FOR_SALE
    ) {
        let total_sol = sol_a.saturating_add(sol_b);
        prop_assume!(total_sol <= 1_000_000_000_000);
        let single = calculate_tokens_out(total_sol, tokens_sold)?;
        let t1 = calculate_tokens_out(sol_a, tokens_sold)?;
        let t2 = calculate_tokens_out(sol_b, tokens_sold + t1)?;
        prop_assert!(single >= t1 + t2, "Split exploit: {} + {} > {}", t1, t2, single);
    }
}
```

---

### INV-BC-011: Price Accuracy vs Float Reference

**What it checks:**
The integer-math price at any point on the curve is within 0.01% of the expected floating-point price. Verifies the u128 PRECISION scaling doesn't introduce significant error.

**Why it matters:**
If the integer approximation drifts significantly from the intended continuous curve, users pay incorrect prices. Small errors compound — a 0.1% error per trade could mean 10% value extraction over 100 trades.

**Tool:** Proptest
**Confidence:** medium
**Based on:** VP-083 (precision loss bounds), VP-086 (reference comparison)

**Proptest sketch:**
```rust
proptest! {
    #[test]
    fn prop_price_accuracy(tokens_sold in 0u64..TOTAL_FOR_SALE) {
        let integer_price = get_current_price(tokens_sold);
        let float_price = P_START as f64 + (P_END as f64 - P_START as f64) * (tokens_sold as f64 / TOTAL_FOR_SALE as f64);
        let expected_lamports = (float_price * 1e9 / 1e9) as u64; // adjust for decimals
        let error_bps = ((integer_price as f64 - expected_lamports as f64).abs() / expected_lamports as f64) * 10000.0;
        prop_assert!(error_bps < 1.0, "Price error {} bps at position {}", error_bps, tokens_sold);
    }
}
```

---

### INV-BC-012: u128 PRECISION Scaling No Overflow

**What it checks:**
All intermediate u128 computations in calculate_tokens_out and calculate_sol_for_tokens stay within u128 bounds. The PRECISION=1e12 scaling factor doesn't cause overflow for any valid input.

**Why it matters:**
u128 overflow wraps silently in release builds. If an intermediate calculation like `(value * PRECISION * PRECISION)` overflows u128, the result wraps to a small number, producing wildly incorrect token amounts.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-082 (u128 precision overflow), VP-083 (intermediate overflow)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_u128_no_overflow() {
    let sol_amount: u64 = kani::any();
    let tokens_sold: u64 = kani::any();
    kani::assume!(sol_amount <= 1_000_000_000_000);
    kani::assume!(tokens_sold <= TOTAL_FOR_SALE);
    // Exercise the function -- Kani detects any overflow/panic
    let _ = calculate_tokens_out(sol_amount, tokens_sold);
}
```

---

### INV-BC-013: Wallet Cap Cannot Be Bypassed via Partial Fill

**What it checks:**
After a partial fill at the curve's end, the buyer's total token balance does not exceed the wallet cap. The cap check accounts for both pre-existing balance and newly received tokens.

**Why it matters:**
If the wallet cap only checks the requested amount (before partial fill adjustment), a user at the cap could still receive tokens from a partial fill, bypassing the concentration limit.

**Tool:** Kani
**Confidence:** medium
**Based on:** Novel (partial fill + cap interaction)

**Kani sketch:**
```rust
#[kani::proof]
fn proof_wallet_cap_with_partial_fill() {
    let existing_balance: u64 = kani::any();
    let tokens_out: u64 = kani::any();
    let remaining: u64 = kani::any();
    let wallet_cap: u64 = WALLET_CAP;
    kani::assume!(existing_balance <= TOTAL_FOR_SALE);
    kani::assume!(tokens_out > remaining); // partial fill
    kani::assume!(remaining > 0);
    let actual_tokens = remaining;
    kani::assert!(existing_balance + actual_tokens <= wallet_cap);
}
```

---

### INV-BC-014: Solvency Assertion Correctness (On-Chain)

**What it checks:**
The on-chain solvency assertion in sell.rs correctly compares vault balance against the integral from 0 to tokens_sold_after_sell. The assertion fires before any SOL leaves the vault.

**Why it matters:**
If the assertion checks the wrong value (e.g., tokens_sold before the sell rather than after), it could pass even when the vault is about to become insolvent. This is the last line of defense.

**Tool:** LiteSVM
**Confidence:** high
**Based on:** VP-051 (reserve solvency), novel on-chain verification

**LiteSVM sketch:**
```rust
#[test]
fn test_solvency_assertion_fires() {
    // Setup: create curve with buys, then drain vault externally
    // Attempt sell -> expect solvency assertion error
    // Verify: sell fails with expected error code
}
```

---

## Coverage Gap Analysis

**Covered by existing tests (13.5M iterations):**
- No-panic for all valid inputs (P1, P2)
- Price monotonicity by position (P3)
- Basic round-trip (P4 -- limited range)
- Full integral (P5)
- Sell conservation (S1 -- limited range)
- Basic solvency (S2 -- single tx only)

**NEW gaps filled by these invariants:**
1. **INV-BC-010 (Split-Buy Exploit)** -- HIGHEST PRIORITY. No existing test checks sub-additivity.
2. **INV-BC-003 (Input Monotonicity)** -- Not tested on the SOL input axis, only the position axis.
3. **INV-BC-008 (Partial Fill)** -- The partial fill code path is never exercised in property tests.
4. **INV-BC-013 (Wallet Cap + Partial Fill)** -- Interaction between two features untested.
5. **INV-BC-011 (Float Reference)** -- No accuracy check against intended curve shape.

**Gaps NOT addressed (out of scope):**
- Cross-instruction atomicity (covered by Anchor framework)
- Frontrunning / MEV (runtime concern, not math)
- Lamport rent interaction with solvency (documented as TODO in MEMORY.md)
