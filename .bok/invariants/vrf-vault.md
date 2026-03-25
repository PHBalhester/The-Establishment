---
task_id: bok-analyze-vrf-vault
provides:
  - conversion-vault-overflow-safety
  - conversion-vault-truncation-behavior
  - conversion-vault-round-trip-conservation
  - vrf-byte-coverage-full-range
  - vrf-byte-no-overlap
  - vrf-distribution-probability
subsystem:
  - conversion-vault
  - epoch-program/vrf
confidence: high
invariant_count: 12
---

# VRF Derivation & Conversion Vault Math Invariants

**Sources:**
- `programs/epoch-program/src/helpers/tax_derivation.rs` -- derive_taxes (VRF byte parsing to discrete rates)
- `programs/epoch-program/src/helpers/carnage.rs` -- is_carnage_triggered, get_carnage_action, get_carnage_target
- `programs/conversion-vault/src/instructions/convert.rs` -- compute_output_with_mints (fixed 100:1 rate)
- `programs/conversion-vault/src/constants.rs` -- CONVERSION_RATE=100, TOKEN_DECIMALS=6

**Existing invariant files (not duplicated here):**
- `vrf-tax-derivation.md` (INV-TD-001 through INV-TD-011)
- `vrf-carnage-decisions.md` (INV-CG-001 through INV-CG-010)

This file covers: (A) conversion vault math invariants, (B) cross-cutting VRF full-range coverage invariants not addressed in the per-subsystem files.

---

## Part A: Conversion Vault Math

---

### INV-CV-001: PROFIT->IP Multiplication Cannot Overflow u64 for Realistic Supply

**What it checks:** For any PROFIT amount up to the total PROFIT supply (20M tokens = 20_000_000_000_000 base units at 6 decimals), multiplying by CONVERSION_RATE (100) fits in u64.

**Why it matters:** If `amount_in.checked_mul(100)` returned None for a legitimate conversion amount, the transaction would fail with MathOverflow, bricking the PROFIT->CRIME/FRAUD conversion path for large holders. The checked_mul at convert.rs:109 is the sole arithmetic guard.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-083 (Cross-Token Decimal Normalization Overflow), VP-086 (Scale Factor Overflow)

**Formal Property:**
```
CONVERSION_RATE = 100
MAX_PROFIT_SUPPLY = 20_000_000 * 10^6 = 20_000_000_000_000

MAX_PROFIT_SUPPLY * CONVERSION_RATE = 2_000_000_000_000_000

u64::MAX = 18_446_744_073_709_551_615

2_000_000_000_000_000 << 18_446_744_073_709_551_615

Therefore: for all amount_in <= MAX_PROFIT_SUPPLY:
  amount_in.checked_mul(100).is_some() == true
```

**Verification sketch:**
```rust
#[kani::proof]
fn verify_profit_to_ip_no_overflow() {
    let amount_in: u64 = kani::any();
    // Realistic bound: entire PROFIT supply (20M * 10^6)
    kani::assume!(amount_in <= 20_000_000_000_000);

    let result = amount_in.checked_mul(100);
    kani::assert!(result.is_some(), "overflow for realistic PROFIT amount");
}
```

---

### INV-CV-002: PROFIT->IP Multiplication Overflows at u64::MAX / 100

**What it checks:** The checked_mul(100) correctly returns None when amount_in exceeds u64::MAX / 100 = 184_467_440_737_095_516.

**Why it matters:** Without checked_mul, a wrapping multiplication at amount_in = u64::MAX would produce (u64::MAX * 100) mod 2^64 = a small number, allowing an attacker to convert a huge PROFIT amount and receive only dust in return -- effectively burning their own tokens. With checked_mul, the transaction correctly fails. This invariant verifies the guard fires at the right boundary.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-083 (Overflow), VP-086 (Scale Factor Overflow)

**Formal Property:**
```
OVERFLOW_BOUNDARY = u64::MAX / CONVERSION_RATE = 184_467_440_737_095_516

For all amount_in:
  amount_in <= OVERFLOW_BOUNDARY  =>  checked_mul(100).is_some()
  amount_in >  OVERFLOW_BOUNDARY  =>  checked_mul(100).is_none()
```

**Verification sketch:**
```rust
#[kani::proof]
fn verify_profit_overflow_boundary() {
    let amount_in: u64 = kani::any();
    let result = amount_in.checked_mul(100u64);

    let boundary = u64::MAX / 100;
    if amount_in <= boundary {
        kani::assert!(result.is_some());
    } else {
        kani::assert!(result.is_none());
    }
}
```

---

### INV-CV-003: IP->PROFIT Truncation Produces Zero for Amounts < 100

**What it checks:** When converting CRIME or FRAUD to PROFIT, any input amount in [1, 99] base units produces `amount_in / 100 == 0`, which is caught by the `require!(out > 0, VaultError::OutputTooSmall)` guard at convert.rs:104.

**Why it matters:** Without the OutputTooSmall guard, a user could send 99 CRIME tokens and receive 0 PROFIT in return -- a pure loss with no error. The guard ensures dust conversions fail explicitly rather than silently destroying user funds. An attacker cannot grief users by constructing transactions that pass but produce zero output.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-085 (Truncation vs Rounding Consistency)

**Formal Property:**
```
For all amount_in in [1, 99]:
  amount_in / 100 == 0
  compute_output_with_mints(crime, profit, amount_in, ...) == Err(VaultError::OutputTooSmall)

For amount_in = 100:
  100 / 100 == 1
  compute_output_with_mints(crime, profit, 100, ...) == Ok(1)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn dust_conversion_rejected(amount_in in 1u64..100) {
        let result = compute_output_with_mints(
            &crime, &profit, amount_in, &crime, &fraud, &profit
        );
        prop_assert!(result.is_err(), "amount {} should fail with OutputTooSmall", amount_in);
    }
}

#[test]
fn minimum_conversion_succeeds() {
    let result = compute_output_with_mints(
        &crime, &profit, 100, &crime, &fraud, &profit
    );
    assert_eq!(result.unwrap(), 1);
}
```

---

### INV-CV-004: Round-Trip IP->PROFIT->IP Loses Exactly (amount mod 100) Tokens

**What it checks:** Converting N CRIME/FRAUD tokens to PROFIT and back yields exactly N - (N mod 100) tokens. The loss is deterministic and bounded by 99 base units (0.000099 tokens at 6 decimals).

**Why it matters:** If the round-trip produced MORE tokens than the input, the vault would be drained by repeated conversions (infinite money glitch). The integer division truncation guarantees the protocol always keeps the dust, matching VP-085's "round against the user" principle. The loss is bounded and predictable.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-082 (Decimal Conversion Precision), VP-085 (Truncation vs Rounding Consistency)

**Formal Property:**
```
For all amount_in >= 100:
  profit_amount = amount_in / 100
  round_trip    = profit_amount * 100
  loss          = amount_in - round_trip
  loss          = amount_in % 100

  round_trip <= amount_in         (never gain tokens)
  loss < 100                      (bounded dust)
  loss == amount_in % 100         (deterministic)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn round_trip_conservation(amount_in in 100u64..1_000_000_000_000) {
        let profit_out = compute_output_with_mints(
            &crime, &profit, amount_in, &crime, &fraud, &profit
        ).unwrap();
        let crime_back = compute_output_with_mints(
            &profit, &crime, profit_out, &crime, &fraud, &profit
        ).unwrap();

        prop_assert!(crime_back <= amount_in, "round-trip gained tokens!");
        let loss = amount_in - crime_back;
        prop_assert_eq!(loss, amount_in % 100, "loss should equal remainder");
        prop_assert!(loss < 100, "loss exceeds dust bound");
    }
}
```

---

### INV-CV-005: Round-Trip PROFIT->IP->PROFIT Is Lossless

**What it checks:** Converting N PROFIT tokens to CRIME/FRAUD and back always returns exactly N PROFIT tokens (zero loss), because the multiplication by 100 followed by division by 100 is exact.

**Why it matters:** Unlike the IP->PROFIT direction which truncates, the PROFIT->IP direction uses multiplication (exact) and the return trip divides an exact multiple of 100. If this invariant failed, PROFIT holders would lose tokens on every vault round-trip, creating an unintended deflationary tax on PROFIT conversions.

**Tool:** Proptest
**Confidence:** high
**Based on:** VP-082 (Decimal Conversion Precision)

**Formal Property:**
```
For all profit_in where profit_in * 100 <= u64::MAX:
  crime_amount = profit_in * 100        (exact)
  profit_back  = crime_amount / 100     (exact, since crime_amount % 100 == 0)
  profit_back  == profit_in             (lossless round-trip)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn profit_round_trip_lossless(profit_in in 1u64..184_467_440_737_095_516) {
        let crime_out = compute_output_with_mints(
            &profit, &crime, profit_in, &crime, &fraud, &profit
        ).unwrap();
        // crime_out = profit_in * 100, which is divisible by 100
        prop_assert_eq!(crime_out % 100, 0);

        let profit_back = compute_output_with_mints(
            &crime, &profit, crime_out, &crime, &fraud, &profit
        ).unwrap();
        prop_assert_eq!(profit_back, profit_in, "PROFIT round-trip not lossless");
    }
}
```

---

### INV-CV-006: Same-Mint Conversion Is Always Rejected

**What it checks:** Passing the same Pubkey for both input_mint and output_mint always returns Err(VaultError::SameMint), regardless of amount.

**Why it matters:** Without this guard, a same-mint "conversion" would either be a no-op (losing gas for nothing) or, worse, the transfer logic could produce an accounting error if source and destination token accounts overlap. The guard at convert.rs:99 prevents this class of bugs entirely.

**Tool:** Proptest
**Confidence:** high
**Based on:** novel (input validation)

**Formal Property:**
```
For all mint in {crime, fraud, profit}, amount_in > 0:
  compute_output_with_mints(mint, mint, amount_in, ...) == Err(VaultError::SameMint)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn same_mint_rejected(amount_in in 1u64..u64::MAX) {
        for mint in [&crime, &fraud, &profit] {
            let result = compute_output_with_mints(
                mint, mint, amount_in, &crime, &fraud, &profit
            );
            prop_assert!(result.is_err());
        }
    }
}
```

---

### INV-CV-007: Invalid Mint Pairs Are Rejected (CRIME<->FRAUD Not Allowed)

**What it checks:** Direct CRIME<->FRAUD conversion (without going through PROFIT) returns Err(VaultError::InvalidMintPair). Only CRIME<->PROFIT and FRAUD<->PROFIT are valid pairs.

**Why it matters:** If CRIME->FRAUD were accidentally permitted, it would bypass the 100:1 rate entirely (both are "IP" tokens at the same denomination). An attacker could freely convert between tokens at 1:1 instead of going through the intended CRIME->PROFIT->FRAUD path (which imposes a 100:1 step in each direction, costing 99% in dust). This guard enforces the PROFIT bottleneck.

**Tool:** Proptest
**Confidence:** high
**Based on:** novel (input validation)

**Formal Property:**
```
For all amount_in > 0:
  compute_output_with_mints(crime, fraud, amount_in, ...) == Err(VaultError::InvalidMintPair)
  compute_output_with_mints(fraud, crime, amount_in, ...) == Err(VaultError::InvalidMintPair)
```

**Verification sketch:**
```rust
proptest! {
    #[test]
    fn crime_fraud_direct_rejected(amount_in in 1u64..u64::MAX) {
        let r1 = compute_output_with_mints(
            &crime, &fraud, amount_in, &crime, &fraud, &profit
        );
        let r2 = compute_output_with_mints(
            &fraud, &crime, amount_in, &crime, &fraud, &profit
        );
        prop_assert!(r1.is_err());
        prop_assert!(r2.is_err());
    }
}
```

---

### INV-CV-008: Zero Amount Is Always Rejected

**What it checks:** Passing amount_in = 0 returns Err(VaultError::ZeroAmount) for every valid mint pair.

**Why it matters:** A zero-amount conversion could succeed silently (producing 0 output), wasting gas and polluting transaction logs. More critically, if the output transfer of 0 tokens interacts with Token-2022 transfer hooks, a hook might process a zero-amount transfer differently (e.g., skip whitelist validation), creating an inconsistent state.

**Tool:** Kani
**Confidence:** high
**Based on:** novel (input validation)

**Formal Property:**
```
For all valid (input_mint, output_mint) pairs:
  compute_output_with_mints(input_mint, output_mint, 0, ...) == Err(VaultError::ZeroAmount)
```

**Verification sketch:**
```rust
#[test]
fn zero_amount_rejected_all_pairs() {
    let pairs = [
        (&crime, &profit), (&fraud, &profit),
        (&profit, &crime), (&profit, &fraud),
    ];
    for (input, output) in pairs {
        let result = compute_output_with_mints(input, output, 0, &crime, &fraud, &profit);
        assert!(result.is_err(), "zero amount should be rejected");
    }
}
```

---

## Part B: VRF Full-Range Coverage (Cross-Cutting)

These invariants verify properties across the entire VRF byte parsing pipeline (tax_derivation.rs + carnage.rs together) that the per-subsystem files do not cover in combined form.

---

### INV-VR-001: Every Byte Value [0, 255] Maps to a Valid Output (Full Coverage, No Gaps)

**What it checks:** For each VRF byte position (0-7), every possible value in [0, 255] produces a valid, defined output. There is no byte value that causes a panic, an out-of-bounds access, or an undefined behavior.

**Why it matters:** If any byte value caused an out-of-bounds panic (e.g., an array index from `byte % 5` on a 4-element array), the on-chain program would fail at runtime for ~20% of VRF outcomes, causing epoch transitions to be bricked until a VRF result avoids the bad byte. Since VRF outputs are not controllable, this could deadlock the protocol for an unpredictable duration.

**Tool:** Proptest (exhaustive)
**Confidence:** high
**Based on:** VP-097 (VRF Output Distribution Fairness)

**Formal Property:**
```
For all b in [0, 255]:
  Byte 0: derive_taxes maps b to a valid cheap_side (Crime or Fraud)
  Byte 1: LOW_RATES[b % 4] is in-bounds (guaranteed since |LOW_RATES| = 4)
  Byte 2: HIGH_RATES[b % 4] is in-bounds (guaranteed since |HIGH_RATES| = 4)
  Byte 3: LOW_RATES[b % 4] is in-bounds
  Byte 4: HIGH_RATES[b % 4] is in-bounds
  Byte 5: is_carnage_triggered returns bool (always defined)
  Byte 6: get_carnage_action returns CarnageAction (always defined)
  Byte 7: get_carnage_target returns Token (always defined)

No panic for any byte value. No unreachable code path.
```

**Verification sketch:**
```rust
#[test]
fn all_256_values_produce_valid_output_per_byte() {
    for b in 0u8..=255 {
        // Tax derivation: set each byte position to b, others to 0
        for pos in 0..5 {
            let mut vrf = [0u8; 32];
            vrf[pos] = b;
            let config = derive_taxes(&vrf, Token::Crime);
            assert!(VALID_RATES.contains(&config.crime_buy_tax_bps));
            assert!(VALID_RATES.contains(&config.crime_sell_tax_bps));
            assert!(VALID_RATES.contains(&config.fraud_buy_tax_bps));
            assert!(VALID_RATES.contains(&config.fraud_sell_tax_bps));
        }
        // Carnage: set each byte position to b
        let mut vrf = [0u8; 32];
        vrf[5] = b;
        let _ = is_carnage_triggered(&vrf); // bool, always valid
        vrf[6] = b;
        let _ = get_carnage_action(&vrf, true); // enum, always valid
        vrf[7] = b;
        let _ = get_carnage_target(&vrf); // enum, always valid
    }
}
```

---

### INV-VR-002: No Byte Value Maps to Two Different Outputs (No Overlap)

**What it checks:** For each VRF byte position, the mapping from byte value to output is a function (deterministic, single-valued). No byte value produces ambiguous or non-deterministic results.

**Why it matters:** If the same byte value could produce two different tax rates (e.g., due to a race condition or mutable state), validators would disagree on epoch parameters, causing consensus divergence. The pure-function nature of derive_taxes and the carnage helpers guarantees single-valued mapping.

**Tool:** Kani
**Confidence:** high
**Based on:** VP-098 (Seed Derivation Determinism)

**Formal Property:**
```
For all vrf in [u8; 32], current_cheap in {Crime, Fraud}:
  derive_taxes(vrf, current_cheap) == derive_taxes(vrf, current_cheap)

For all vrf in [u8; 32]:
  is_carnage_triggered(vrf) == is_carnage_triggered(vrf)
  get_carnage_action(vrf, h) == get_carnage_action(vrf, h)  for same h
  get_carnage_target(vrf) == get_carnage_target(vrf)
```

**Verification sketch:**
```rust
#[kani::proof]
fn verify_no_overlap_tax() {
    let vrf: [u8; 32] = kani::any();
    let cheap: bool = kani::any();
    let current = if cheap { Token::Crime } else { Token::Fraud };

    let a = derive_taxes(&vrf, current);
    let b = derive_taxes(&vrf, current);
    kani::assert!(a == b, "non-deterministic tax derivation");
}

#[kani::proof]
fn verify_no_overlap_carnage() {
    let vrf: [u8; 32] = kani::any();
    kani::assert!(is_carnage_triggered(&vrf) == is_carnage_triggered(&vrf));
    kani::assert!(get_carnage_target(&vrf) == get_carnage_target(&vrf));
}
```

---

### INV-VR-003: Modulo-4 on u8 Has Zero Bias (Exact 64/64/64/64 Split)

**What it checks:** The `byte % 4` operation used for tax rate selection (bytes 1-4) produces each residue class {0, 1, 2, 3} exactly 64 times across the 256 possible byte values, giving exactly 25% probability per rate with zero modulo bias.

**Why it matters:** Modulo bias (VP-096) is the classic randomness pitfall. Here, 4 divides 256 evenly (256 = 4 * 64), so there is provably zero bias. If the rate table were ever expanded to a non-power-of-2 size (e.g., 5 or 6 entries), this invariant would fail, alerting developers to introduce rejection sampling or restructure the table.

**Tool:** Proptest (exhaustive count)
**Confidence:** high
**Based on:** VP-096 (Modulo Bias in Random Distribution)

**Formal Property:**
```
256 % 4 == 0   (exact division, no remainder)

For k in {0, 1, 2, 3}:
  |{b in [0, 255] : b % 4 == k}| = 64

P(rate_k) = 64 / 256 = 0.25 exactly
```

**Verification sketch:**
```rust
#[test]
fn modulo_4_zero_bias() {
    let mut counts = [0u32; 4];
    for b in 0u8..=255 {
        counts[(b % 4) as usize] += 1;
    }
    for (k, &count) in counts.iter().enumerate() {
        assert_eq!(count, 64, "residue class {} has {} (expected 64)", k, count);
    }
}
```

---

### INV-VR-004: Carnage Threshold Comparisons Have No Dead Zones

**What it checks:** The three carnage threshold comparisons (byte < 11, byte < 5, byte < 128) partition the full [0, 255] range into exactly two non-empty subsets each. There is no byte value that falls "between" the partitions.

**Why it matters:** A strict `<` comparison on a u8 with threshold T partitions [0, 255] into [0, T-1] (size T) and [T, 255] (size 256-T). For T in {5, 11, 128}, both partitions are non-empty (T > 0 and T < 256). If a threshold were accidentally set to 0 (never triggers) or 256 (which would require u16 -- always triggers as u8), the partition would degenerate, eliminating one outcome entirely.

**Tool:** Proptest (exhaustive)
**Confidence:** high
**Based on:** VP-097 (Distribution Fairness)

**Formal Property:**
```
For threshold T in {CARNAGE_TRIGGER_THRESHOLD=11, CARNAGE_SELL_THRESHOLD=5, 128}:
  0 < T < 256
  |{b in [0,255] : b < T}| = T > 0         (below-threshold partition non-empty)
  |{b in [0,255] : b >= T}| = 256 - T > 0  (above-threshold partition non-empty)
```

**Verification sketch:**
```rust
#[test]
fn no_dead_zones_in_carnage_thresholds() {
    for threshold in [CARNAGE_TRIGGER_THRESHOLD, CARNAGE_SELL_THRESHOLD, 128u8] {
        assert!(threshold > 0, "threshold {} makes below-set empty", threshold);
        // For u8, threshold < 256 is always true, but document the intent:
        let below = threshold as u32;
        let above = 256 - below;
        assert!(below > 0 && above > 0,
            "threshold {} creates a dead zone: below={}, above={}", threshold, below, above);
    }
}
```

---

## Summary Table

| ID | Subsystem | What | Tool | Confidence | Based On |
|----|-----------|------|------|------------|----------|
| INV-CV-001 | Vault | PROFIT->IP no overflow for realistic supply | Kani | high | VP-083, VP-086 |
| INV-CV-002 | Vault | PROFIT->IP overflow boundary correct | Kani | high | VP-083, VP-086 |
| INV-CV-003 | Vault | IP->PROFIT dust rejection (< 100 = error) | Proptest | high | VP-085 |
| INV-CV-004 | Vault | Round-trip IP->PROFIT->IP loses exactly N%100 | Proptest | high | VP-082, VP-085 |
| INV-CV-005 | Vault | Round-trip PROFIT->IP->PROFIT is lossless | Proptest | high | VP-082 |
| INV-CV-006 | Vault | Same-mint conversion rejected | Proptest | high | novel |
| INV-CV-007 | Vault | CRIME<->FRAUD direct conversion rejected | Proptest | high | novel |
| INV-CV-008 | Vault | Zero amount rejected | Kani | high | novel |
| INV-VR-001 | VRF | Every byte [0,255] maps to valid output | Proptest | high | VP-097 |
| INV-VR-002 | VRF | Deterministic: same input = same output | Kani | high | VP-098 |
| INV-VR-003 | VRF | Modulo-4 has zero bias (64/64/64/64) | Proptest | high | VP-096 |
| INV-VR-004 | VRF | Carnage thresholds have no dead zones | Proptest | high | VP-097 |
