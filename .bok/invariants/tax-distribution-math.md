---
task_id: bok-analyze-tax-distribution
provides:
  - tax-calculate-tax-invariants
  - tax-split-distribution-invariants
  - tax-output-floor-invariants
  - tax-compound-properties
subsystem: tax-program
confidence: high
invariant_count: 20
split_version: "71/24/5"
---

# Tax Distribution Math Invariants

**Source File:** `programs/tax-program/src/helpers/tax_math.rs` (515 lines)
**Supporting Constants:** `programs/tax-program/src/constants.rs` (252 lines)
**Spec Reference:** `Docs/token-economics-model.md` (Economic Invariants section)
**Split Ratios:** 71% staking / 24% carnage / 5% treasury (UPDATED from 75/24/1)

---

## Function: `calculate_tax`

### INV-1: Tax Never Exceeds Principal

**What it checks:** For any valid tax rate (0-10000 bps), the computed tax is always less than or equal to the input amount.
**Why it matters:** If `tax > amount`, the subsequent `amount - tax` subtraction in the swap handler would underflow -- either reverting (if checked) or wrapping to a massive number (if unchecked), potentially letting a user buy the entire pool for free.
**Tool:** Kani
**Confidence:** high
**Based on:** VP-012

**Formal Property:**
```
forall amount: u64, bps: u16 where bps <= 10000:
  calculate_tax(amount, bps) = Some(tax) => tax <= amount
```

**Verification sketch:**
```rust
#[kani::proof]
fn verify_tax_bounded_by_principal() {
    let amount: u64 = kani::any();
    let bps: u16 = kani::any();
    kani::assume!(bps <= 10_000);

    if let Some(tax) = calculate_tax(amount, bps) {
        kani::assert!(tax <= amount, "tax exceeds principal");
    }
}
```

---

### INV-2: Zero Fee at Zero Input (No Phantom Fees)

**What it checks:** Taxing a zero-amount produces zero tax. A zero-rate tax on any amount also produces zero tax. No fees from nothing.
**Why it matters:** If `calculate_tax(0, 400)` returned nonzero, the swap handler would attempt to transfer tax SOL from a user who deposited nothing, causing a failed transfer or debiting stale WSOL from a previous swap.
**Tool:** Kani
**Confidence:** high
**Based on:** VP-013

**Formal Property:**
```
forall bps: u16 where bps <= 10000:
  calculate_tax(0, bps) = Some(0)

forall amount: u64:
  calculate_tax(amount, 0) = Some(0)
```

**Verification sketch:**
```rust
#[kani::proof]
fn verify_zero_input_zero_fee() {
    let bps: u16 = kani::any();
    kani::assume!(bps <= 10_000);
    kani::assert!(calculate_tax(0, bps) == Some(0));
}

#[kani::proof]
fn verify_zero_rate_zero_fee() {
    let amount: u64 = kani::any();
    kani::assert!(calculate_tax(amount, 0) == Some(0));
}
```

---

### INV-3: Tax Monotonicity with BPS Rate

**What it checks:** For a fixed amount, increasing the tax rate never decreases the tax. A 14% rate always collects at least as much as a 3% rate.
**Why it matters:** If monotonicity broke (due to integer overflow wrapping), a higher on-chain tax rate could paradoxically collect less revenue. An attacker who can influence VRF byte interpretation to land on a "higher" rate that yields less tax could drain the system.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-016

**Formal Property:**
```
forall amount: u64, bps_low: u16, bps_high: u16
  where bps_low <= bps_high <= 10000:
  calculate_tax(amount, bps_low) <= calculate_tax(amount, bps_high)
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn tax_monotonic_strict(
        amount in 0u64..=u64::MAX,
        bps_low in 0u16..=10000u16,
        bps_high in 0u16..=10000u16,
    ) {
        prop_assume!(bps_low <= bps_high);
        let tax_lo = calculate_tax(amount, bps_low).unwrap();
        let tax_hi = calculate_tax(amount, bps_high).unwrap();
        prop_assert!(tax_lo <= tax_hi);
    }
}
```

---

### INV-4: Invalid BPS Rejection

**What it checks:** Any tax rate above 10000 bps (100%) is rejected with `None`.
**Why it matters:** If `calculate_tax` accepted bps > 10000, an admin or oracle corruption that sets `buy_tax_bps = 15000` would compute `tax = amount * 1.5`, exceeding the user's input. The subtraction `amount - tax` would underflow.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-012

**Formal Property:**
```
forall amount: u64, bps: u16 where bps > 10000:
  calculate_tax(amount, bps) = None
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn tax_rejects_invalid_bps(
        amount in 0u64..=u64::MAX,
        bps in 10001u16..=u16::MAX,
    ) {
        prop_assert!(calculate_tax(amount, bps).is_none());
    }
}
```

---

### INV-5: Floor Division Allows Zero Tax on Small Amounts

**What it checks:** `calculate_tax` uses floor division, so small amounts produce zero tax. This is intentional -- the micro-tax rule in `split_distribution` handles downstream consequences.
**Why it matters:** An attacker could split a 1000-lamport swap into 250 individual 4-lamport swaps, each paying 0 tax (since `4 * 400 / 10000 = 0`). The protocol accepts this tradeoff at the lamport scale (documented at line 32). Verification confirms the exact bypass threshold per BPS rate.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-014

**Formal Property:**
```
forall amount: u64, bps: u16 where bps <= 10000:
  calculate_tax(amount, bps) = Some(tax) =>
    tax = floor(amount * bps / 10000)  // NOT ceil

// Tax bypass threshold:
amount < ceil(10000 / bps) => tax = 0
// At bps=400 (4%): amounts < 25 pay zero tax
// At bps=1400 (14%): amounts < 8 pay zero tax
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn tax_bypass_threshold(
        bps in 1u16..=10000u16,
    ) {
        let threshold = (10_000u64 + bps as u64 - 1) / bps as u64;
        // Below threshold: zero tax
        if threshold > 1 {
            let tax = calculate_tax(threshold - 1, bps).unwrap();
            prop_assert_eq!(tax, 0, "expected zero tax below threshold");
        }
        // At threshold: nonzero tax
        let tax = calculate_tax(threshold, bps).unwrap();
        prop_assert!(tax >= 1, "expected nonzero tax at threshold");
    }
}
```

---

### INV-6: u128 Intermediate Prevents Overflow

**What it checks:** The multiplication `amount * bps` is performed in u128 space. `calculate_tax` returns `Some(_)` for all valid inputs, never `None` from overflow.
**Why it matters:** Without u128 widening, `u64::MAX * 10000` overflows u64, producing silently wrong results. Token amounts with 6 decimals can reach high u64 values.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-015

**Formal Property:**
```
forall amount: u64, bps: u16 where bps <= 10000:
  calculate_tax(amount, bps) is Some(_)
  // Never returns None due to overflow for valid bps
  // max intermediate = u64::MAX * 10000 = 1.8e23 < u128::MAX = 3.4e38
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn tax_never_overflows(
        amount in 0u64..=u64::MAX,
        bps in 0u16..=10000u16,
    ) {
        prop_assert!(calculate_tax(amount, bps).is_some());
    }
}
```

---

## Function: `split_distribution`

### INV-7: Conservation -- Sum Equals Input (Zero-Loss Split)

**What it checks:** The three output portions (staking, carnage, treasury) always sum to exactly `total_tax`. Not one lamport is lost and not one lamport is created.
**Why it matters:** If `staking + carnage + treasury < total_tax`, the missing lamports are stuck in the swap_authority PDA forever (unrecoverable). If the sum exceeds `total_tax`, the system attempts to transfer more SOL than it has, causing an insufficient-funds denial-of-service on all swaps.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-078

**Formal Property:**
```
forall total_tax: u64:
  split_distribution(total_tax) = Some((s, c, t)) =>
    s + c + t = total_tax  // exact equality, no dust leakage
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn split_conservation(total in 0u64..=u64::MAX) {
        let (s, c, t) = split_distribution(total).unwrap();
        prop_assert_eq!(
            s.checked_add(c).and_then(|x| x.checked_add(t)),
            Some(total),
            "conservation violated: {} + {} + {} != {}", s, c, t, total
        );
    }
}
```

---

### INV-8: Staking Floor Guarantee (== floor(71%) of Input)

**What it checks:** For non-micro-tax inputs (>= 4 lamports), staking always receives exactly `floor(total_tax * 7100 / 10000)` lamports. This is >= 70% of the input.
**Why it matters:** If rounding error or overflow caused staking to receive less than 71%, the difference would silently flow to treasury (the remainder recipient). Over millions of transactions, this could divert significant yield from stakers to the treasury wallet.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-079

**Formal Property:**
```
forall total_tax: u64 where total_tax >= 4:
  split_distribution(total_tax) = Some((staking, _, _)) =>
    staking = floor(total_tax * 7100 / 10000)
    staking >= total_tax * 70 / 100  // lower bound check
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn staking_exact_71pct(total in 4u64..=u64::MAX) {
        let (staking, _, _) = split_distribution(total).unwrap();
        let expected = (total as u128 * 7100 / 10000) as u64;
        prop_assert_eq!(staking, expected,
            "staking {} != expected {} for total {}", staking, expected, total);
    }
}
```

---

### INV-9: Carnage Floor Guarantee (== floor(24%) of Input)

**What it checks:** For non-micro-tax inputs (>= 4 lamports), carnage always receives exactly `floor(total_tax * 2400 / 10000)` lamports.
**Why it matters:** If carnage received less than 24%, the Carnage Fund accumulates SOL slower, reducing burn frequency and undermining the deflationary mechanism.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-079

**Formal Property:**
```
forall total_tax: u64 where total_tax >= 4:
  split_distribution(total_tax) = Some((_, carnage, _)) =>
    carnage = floor(total_tax * 2400 / 10000)
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn carnage_exact_24pct(total in 4u64..=u64::MAX) {
        let (_, carnage, _) = split_distribution(total).unwrap();
        let expected = (total as u128 * 2400 / 10000) as u64;
        prop_assert_eq!(carnage, expected);
    }
}
```

---

### INV-10: Treasury Absorbs Dust (Never Negative, Bounded)

**What it checks:** Treasury receives `total_tax - staking - carnage`, which is always non-negative. The dust from floor divisions is bounded by at most 2 lamports above the ideal 5%.
**Why it matters:** If treasury computation underflowed (staking + carnage > total_tax), `checked_sub` would return `None`, propagating as `TaxError::TaxOverflow` -- a denial-of-service on all swaps. The dust bound ensures treasury never gets significantly more than its 5% share.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-079

**Formal Property:**
```
forall total_tax: u64 where total_tax >= 4:
  let (s, c, t) = split_distribution(total_tax)
  let ideal_t = floor(total_tax * 500 / 10000)
  t >= ideal_t           // treasury >= ideal (absorbs dust upward)
  t - ideal_t <= 2       // at most 2 lamports of dust
  // Dust sources: staking floor loses <=0.99, carnage floor loses <=0.99
  // Both round down, remainder absorbs both truncations
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn treasury_dust_bounded(total in 4u64..=u64::MAX) {
        let (_, _, treasury) = split_distribution(total).unwrap();
        let ideal = (total as u128 * 500 / 10000) as u64;
        prop_assert!(treasury >= ideal,
            "treasury {} < ideal {} for total {}", treasury, ideal, total);
        prop_assert!(treasury - ideal <= 2,
            "dust {} > 2 for total {}", treasury - ideal, total);
    }
}
```

---

### INV-11: Micro-Tax Rule -- All to Staking Below Threshold

**What it checks:** When total tax < 4 lamports, the entire amount goes to staking. Carnage and treasury receive nothing.
**Why it matters:** Without this rule, `split_distribution(1)` would produce `staking=0, carnage=0, treasury=1` -- sending the entire 1 lamport to treasury instead of staking. For total_tax=2: `staking=1, carnage=0, treasury=1` gives treasury 50% instead of 5%. The micro-tax rule protects stakers.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-080

**Formal Property:**
```
forall total_tax: u64 where total_tax < 4:
  split_distribution(total_tax) = Some((total_tax, 0, 0))
```

**Verification sketch:**
```rust
// Exhaustive: only 4 values
#[test]
fn micro_tax_exhaustive() {
    for total in 0..4u64 {
        assert_eq!(split_distribution(total), Some((total, 0, 0)));
    }
}
```

---

### INV-12: Hardcoded BPS Match constants.rs

**What it checks:** The inline constants in `split_distribution` (STAKING_BPS=7100, CARNAGE_BPS=2400) match the module-level constants in `constants.rs` (STAKING_BPS=7100, CARNAGE_BPS=2400, TREASURY_BPS=500). The BPS values sum to exactly 10000.
**Why it matters:** If someone updates `STAKING_BPS` in constants.rs without updating the hardcoded values in `split_distribution`, on-chain behavior and documented constants silently diverge. The lib.rs module doc (lines 4-7) ALREADY has a stale reference to "75/24/1" -- proving this drift is real.
**Tool:** LiteSVM (compile-time check)
**Confidence:** high
**Based on:** VP-078

**Formal Property:**
```
// constants.rs values:
STAKING_BPS + CARNAGE_BPS + TREASURY_BPS == 10000
// Currently: 7100 + 2400 + 500 = 10000  -- CORRECT

// tax_math.rs inline values must match:
split_distribution::STAKING_BPS == constants::STAKING_BPS  // 7100
split_distribution::CARNAGE_BPS == constants::CARNAGE_BPS  // 2400
```

**Verification sketch:**
```rust
#[test]
fn constants_sum_to_10000() {
    assert_eq!(STAKING_BPS + CARNAGE_BPS + TREASURY_BPS, 10_000,
        "BPS split does not sum to 100%");
}

#[test]
fn inline_matches_constants() {
    // Verify split_distribution(10000) produces (7100, 2400, 500)
    // which matches STAKING_BPS/CARNAGE_BPS/TREASURY_BPS
    let (s, c, t) = split_distribution(10000).unwrap();
    assert_eq!(s, STAKING_BPS as u64);
    assert_eq!(c, CARNAGE_BPS as u64);
    assert_eq!(t, TREASURY_BPS as u64);
}
```

**FINDING:** `programs/tax-program/src/lib.rs` lines 4-7 still reference "75/24/1" split. This doc comment is stale after the split change to 71/24/5. Not a code bug but could mislead auditors.

---

### INV-13: split_distribution Never Returns None

**What it checks:** For any u64 input, `split_distribution` always returns `Some(...)`. The internal `checked_sub` chain never underflows because `staking + carnage <= total_tax` (since `7100/10000 + 2400/10000 = 9500/10000 < 1`).
**Why it matters:** If `split_distribution` returned `None`, the swap handler maps it to `TaxError::TaxOverflow`, rejecting the transaction. A systematic `None` would be a total denial-of-service.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-015

**Formal Property:**
```
forall total_tax: u64:
  split_distribution(total_tax).is_some()
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn split_always_some(total in 0u64..=u64::MAX) {
        prop_assert!(split_distribution(total).is_some());
    }
}
```

---

## Function: `calculate_output_floor`

### INV-14: Output Floor Never Exceeds Expected Output

**What it checks:** The computed minimum output floor is always less than or equal to the AMM's constant-product expected output, when `floor_bps <= 10000`.
**Why it matters:** If `floor > expected`, the swap handler would reject all transactions as "below minimum output" -- a total denial-of-service on all swaps.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-012

**Formal Property:**
```
forall reserve_in, reserve_out, amount_in > 0, floor_bps <= 10000:
  let expected = reserve_out * amount_in / (reserve_in + amount_in)
  calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps) <= expected
```

**Verification sketch:**
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn floor_bounded_by_expected(
        r_in in 1u64..=u64::MAX/2,
        r_out in 1u64..=u64::MAX/2,
        a_in in 1u64..=u64::MAX/2,
        floor_bps in 0u64..=10000u64,
    ) {
        let floor = calculate_output_floor(r_in, r_out, a_in, floor_bps).unwrap();
        let expected = (r_out as u128 * a_in as u128 / (r_in as u128 + a_in as u128)) as u64;
        prop_assert!(floor <= expected,
            "floor {} > expected {}", floor, expected);
    }
}
```

---

### INV-15: Zero-Input Safety

**What it checks:** If any of reserve_in, reserve_out, or amount_in is zero, the floor returns 0 (no floor enforceable). Prevents division-by-zero.
**Why it matters:** Without the zero-guard, empty or newly created pools could produce nonsensical floors, blocking transactions.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-013

**Formal Property:**
```
calculate_output_floor(0, any, any, any) = Some(0)
calculate_output_floor(any, 0, any, any) = Some(0)
calculate_output_floor(any, any, 0, any) = Some(0)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn floor_zero_on_zero_input(
        a in 0u64..=u64::MAX,
        b in 0u64..=u64::MAX,
        bps in 0u64..=10000u64,
    ) {
        prop_assert_eq!(calculate_output_floor(0, a, b, bps), Some(0));
        prop_assert_eq!(calculate_output_floor(a, 0, b, bps), Some(0));
        prop_assert_eq!(calculate_output_floor(a, b, 0, bps), Some(0));
    }
}
```

---

### INV-16: Floor Monotonicity with Floor BPS

**What it checks:** For fixed pool state and swap amount, a higher floor_bps produces a higher or equal output floor.
**Why it matters:** If monotonicity broke, CARNAGE_SLIPPAGE_BPS_ATOMIC (8500) could paradoxically be more lenient than CARNAGE_SLIPPAGE_BPS_FALLBACK (7500), defeating tiered Carnage execution windows.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-016

**Formal Property:**
```
forall reserves, amount_in, bps_low, bps_high where bps_low <= bps_high:
  calculate_output_floor(r_in, r_out, a_in, bps_low)
    <= calculate_output_floor(r_in, r_out, a_in, bps_high)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn floor_monotonic_with_bps(
        r_in in 1u64..1_000_000_000_000u64,
        r_out in 1u64..1_000_000_000_000u64,
        a_in in 1u64..1_000_000_000_000u64,
        bps_low in 0u64..=10000u64,
        bps_delta in 0u64..=10000u64,
    ) {
        let bps_high = bps_low.saturating_add(bps_delta).min(10000);
        let f_lo = calculate_output_floor(r_in, r_out, a_in, bps_low).unwrap();
        let f_hi = calculate_output_floor(r_in, r_out, a_in, bps_high).unwrap();
        prop_assert!(f_lo <= f_hi);
    }
}
```

---

### INV-17: Output Floor Unsafe Cast (floor_bps Unvalidated)

**What it checks:** `calculate_output_floor` does NOT validate `floor_bps`. Unlike `calculate_tax` which rejects `bps > 10000`, this function accepts any u64. The `as u64` cast at line 164 silently truncates if the intermediate exceeds u64::MAX.
**Why it matters:** If a misconfigured constant or future code change passes `floor_bps > 10000`, the floor could exceed the expected output, rejecting all swaps. Currently safe because all callers use `MINIMUM_OUTPUT_FLOOR_BPS = 5000`, but the function itself is unguarded.
**Tool:** Proptest
**Confidence:** medium
**Based on:** novel

**Formal Property:**
```
// MISSING guard: floor_bps is NOT validated
// When floor_bps > 10000:
//   floor = expected * floor_bps / 10000 > expected
//   This REJECTS valid swaps (DoS)
// When floor_bps = u64::MAX:
//   expected * u64::MAX could overflow u128 for large expected values
//   But: expected <= reserve_out <= u64::MAX, so max = u64::MAX^2 / 10000
//   u64::MAX^2 = 3.4e38 which equals u128::MAX -- BORDERLINE
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn floor_bps_over_10000_safe_or_none(
        r_in in 1u64..=u64::MAX/4,
        r_out in 1u64..=u64::MAX/4,
        a_in in 1u64..=u64::MAX/4,
        floor_bps in 10001u64..=u64::MAX,
    ) {
        // Should either return Some (with potentially truncated value) or None (overflow)
        let result = calculate_output_floor(r_in, r_out, a_in, floor_bps);
        // Currently no validation -- document the behavior
        if let Some(floor) = result {
            // Floor may exceed expected output -- this is a latent DoS vector
        }
    }
}
```

---

## Compound Properties

### INV-18: Fee-on-Fee Compounding Order

**What it checks:** On buys, protocol tax is deducted from SOL input BEFORE AMM swap (sequential). On sells, AMM LP fee first, then protocol tax on output. The ordering is intentional and documented.
**Why it matters:** If ordering were reversed, users would pay slightly more total fees due to compounding. The difference is ~0.04% at 4% tax + 1% LP fee but compounds over millions of transactions.
**Tool:** LiteSVM
**Confidence:** high
**Based on:** VP-017

**Formal Property:**
```
// Buy flow:
net_sol_to_swap = amount - calculate_tax(amount, buy_tax_bps)
tokens_out = amm_swap(net_sol_to_swap, lp_fee_bps)

// Sell flow:
gross_sol_output = amm_swap(token_amount, lp_fee_bps)
tax = calculate_tax(gross_sol_output, sell_tax_bps)
net_sol_to_user = gross_sol_output - tax
```

**Verification sketch:**
```rust
// LiteSVM integration test
// Execute buy and sell, verify exact lamport flow matches documented ordering
// Compare against alternative ordering to quantify compounding difference
```

---

### INV-19: Rounding Accumulation Bound

**What it checks:** Over N transactions, cumulative rounding error in split distribution is bounded by `N * 2` lamports (at most 2 lamports dust per transaction, absorbed by treasury).
**Why it matters:** Rounding dust always flows to treasury. If the bound were larger, treasury could accumulate meaningful extra revenue at the expense of staking and carnage. At 1M daily transactions, this is at most 0.002 SOL/day -- economically negligible.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-081

**Formal Property:**
```
forall total_tax: u64 where total_tax >= 4:
  let (s, c, t) = split_distribution(total_tax)
  let ideal_t = floor(total_tax * 500 / 10000)  // ideal 5%
  let dust = t - ideal_t
  0 <= dust <= 2  // per-transaction dust bound

// Over N distributions:
  cumulative_dust <= N * 2
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn cumulative_dust_bounded(
        base in 4u64..1_000_000u64,
    ) {
        let mut cumulative_dust: u64 = 0;
        for i in 0..1000u64 {
            let total = base + i;
            let (_, _, treasury) = split_distribution(total).unwrap();
            let ideal = (total as u128 * 500 / 10000) as u64;
            cumulative_dust += treasury - ideal;
        }
        prop_assert!(cumulative_dust <= 2000,
            "cumulative dust {} > 2000", cumulative_dust);
    }
}
```

---

### INV-20: 71/24/5 Split Percentages Are Correct

**What it checks:** The split_distribution function uses BPS values that implement the intended 71/24/5 percentage split. Staking gets 71% (7100 bps), carnage gets 24% (2400 bps), treasury gets the 5% remainder (500 bps nominal, computed as `total - staking - carnage`).
**Why it matters:** The split recently changed from 75/24/1 to 71/24/5. If the BPS constants were miscalculated during the change (e.g., STAKING_BPS=7100 but someone meant 71.5%), the on-chain split would silently differ from the intended percentages. This invariant locks in the exact conversion: 71% = 7100/10000, 24% = 2400/10000, remainder = 500/10000 = 5%.
**Tool:** Proptest
**Confidence:** high
**Based on:** VP-078

**Formal Property:**
```
// BPS-to-percentage correctness:
7100 / 10000 = 0.71 = 71%
2400 / 10000 = 0.24 = 24%
500  / 10000 = 0.05 =  5%
7100 + 2400 + 500 = 10000  // no dust leakage in percentage space

// At a clean multiple (total_tax = 10000):
split_distribution(10000) = (7100, 2400, 500)
```

**Verification sketch:**
```rust
#[test]
fn split_percentages_correct() {
    // Clean multiple: exact percentages with zero rounding
    let (s, c, t) = split_distribution(10_000).unwrap();
    assert_eq!(s, 7100, "staking should be exactly 71%");
    assert_eq!(c, 2400, "carnage should be exactly 24%");
    assert_eq!(t, 500, "treasury should be exactly 5%");

    // Verify BPS constants sum
    assert_eq!(7100u128 + 2400 + 500, 10_000, "BPS must sum to 10000");
}

proptest! {
    #[test]
    fn split_ratio_within_tolerance(total in 1000u64..=u64::MAX) {
        let (s, c, t) = split_distribution(total).unwrap();
        // Staking ratio: s/total should be in [0.70, 0.72]
        let ratio_s = s as f64 / total as f64;
        prop_assert!(ratio_s >= 0.70 && ratio_s <= 0.72,
            "staking ratio {} out of range for total {}", ratio_s, total);
        let ratio_c = c as f64 / total as f64;
        prop_assert!(ratio_c >= 0.23 && ratio_c <= 0.25,
            "carnage ratio {} out of range for total {}", ratio_c, total);
    }
}
```

---

## Coverage Gap Analysis

### Existing Test Coverage (20 unit + 6 proptest at 10K each)

| Region | Unit Tests | Proptest | Gap |
|--------|-----------|----------|-----|
| `calculate_tax` valid BPS | 7 tests | 1 (10K) -- never-overflows | **Missing:** tax <= amount assertion |
| `calculate_tax` invalid BPS | 1 test | 1 (10K) -- none-for-invalid | Adequate |
| `calculate_tax` monotonicity | 0 | 1 (10K) | Adequate |
| `split_distribution` conservation | 1 sweep (12 values) | 1 (10K) -- sum-equals-input | **Gap:** uses saturating_add, should use checked_add |
| `split_distribution` staking bound | 0 | 1 (10K) -- >= 70% | **Gap:** checks 70% not exact 71%; should verify exact floor(total*7100/10000) |
| `split_distribution` carnage exact | 0 | 0 | **MISSING:** no test verifies carnage = floor(total*2400/10000) |
| `split_distribution` treasury dust | 0 | 0 | **MISSING:** no test verifies treasury dust <= 2 |
| `split_distribution` micro-tax | 2 unit tests | 1 (10K) | Adequate |
| `split_distribution` totality | 0 | 0 | **MISSING:** no test verifies never-None for all u64 |
| `calculate_output_floor` basic | 8 unit tests | 0 | **MISSING:** no proptest for floor properties |
| `calculate_output_floor` monotonicity | 0 | 0 | **MISSING:** no test verifies floor monotonicity with bps |
| `calculate_output_floor` bps validation | 0 | 0 | **MISSING:** no test for floor_bps > 10000 behavior |
| Constants sync | 0 | 0 | **MISSING:** no test verifies STAKING_BPS + CARNAGE_BPS + TREASURY_BPS = 10000 |
| Stale doc comment | N/A | N/A | **FINDING:** lib.rs lines 4-7 say "75/24/1" but code is 71/24/5 |

### Priority Gaps (ordered by severity)

1. **INV-12 (Constants sync):** No compile-time or test-time verification that BPS constants sum to 10000 or that inline values match constants.rs. The stale lib.rs comment proves drift is already happening.
2. **INV-10 (Treasury dust):** No test verifies the dust bound. If a future change to BPS percentages caused staking+carnage > total, checked_sub would return None, DoS-ing all swaps.
3. **INV-9 (Carnage exact):** No test verifies carnage gets exactly floor(total*2400/10000). A subtle change could shift lamports from carnage to treasury.
4. **INV-14/16 (Floor properties):** Zero proptest coverage on calculate_output_floor. Only unit tests with hardcoded values. Monotonicity is untested.
5. **INV-17 (Unsafe cast):** floor_bps has no validation. Currently all callers pass safe values, but the function is public and unguarded.
