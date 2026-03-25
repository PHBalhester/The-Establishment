# Confirmed Invariants: Tax Distribution Math
**Priority Rank: 3** (critical-path: every swap pays tax through this code)
**Source:** `programs/tax-program/src/helpers/tax_math.rs`, `constants.rs`
**Confirmed:** 20 invariants | Skipped: 0
**Finding:** lib.rs lines 4-7 reference stale "75/24/1" split (now 71/24/5)

---

## P0: No Existing Coverage

### INV-TAX-9: Carnage Exact Share
- **Tool:** Proptest
- **Property:** `carnage = floor(total * 2400 / 10000)` for total >= 4
- **Why:** No test verifies carnage gets exactly 24%.

### INV-TAX-10: Treasury Dust Bounded
- **Tool:** Proptest 100K
- **Property:** `treasury - ideal_treasury <= 2` lamports per tx
- **Why:** Unbounded dust = systematic treasury inflation.

### INV-TAX-12: Constants Sync (BPS Sum)
- **Tool:** LiteSVM
- **Property:** `STAKING_BPS + CARNAGE_BPS + TREASURY_BPS == 10000` AND inline values match
- **Why:** Stale lib.rs comment proves drift is already happening.

### INV-TAX-13: split_distribution Never Returns None
- **Tool:** Proptest 100K
- **Property:** `split_distribution(x).is_some()` for all u64
- **Why:** None -> TaxError::TaxOverflow -> all swaps fail (DoS).

### INV-TAX-16: Floor Monotonicity with BPS
- **Tool:** Proptest
- **Property:** Higher floor_bps -> higher output floor
- **Why:** Ensures tiered Carnage floors (85%/75%) work correctly.

### INV-TAX-17: floor_bps Unvalidated (Latent DoS)
- **Tool:** Proptest
- **Property:** Document behavior when floor_bps > 10000 (currently unguarded)
- **Why:** Public function with no input validation on BPS parameter.

---

## P1: Strengthened Coverage

### INV-TAX-7: Split Conservation (Sum = Total)
- **Tool:** Proptest 100K (upgraded from 12-value sweep)
- **Property:** `staking + carnage + treasury == total_tax` (exact equality)
- **Why:** Missing lamports locked forever; excess causes transfer failure.

### INV-TAX-8: Staking Exact 71%
- **Tool:** Proptest (upgraded from >= 70% to exact floor check)
- **Property:** `staking == floor(total * 7100 / 10000)`
- **Why:** Existing test only checks >= 70%, not exact 71%.

---

## P2: Core Tax Properties

### INV-TAX-1: Tax Never Exceeds Principal
- **Tool:** Kani
- **Property:** `calculate_tax(amount, bps) <= amount` for bps <= 10000

### INV-TAX-2: Zero Input/Rate -> Zero Tax
- **Tool:** Kani
- **Property:** `calculate_tax(0, bps) == 0` and `calculate_tax(amount, 0) == 0`

### INV-TAX-3: Tax Monotonic with BPS
- **Tool:** Proptest
- **Property:** `bps_low <= bps_high => tax_low <= tax_high`

### INV-TAX-4: Invalid BPS Rejected
- **Tool:** Proptest
- **Property:** `bps > 10000 => calculate_tax returns None`

### INV-TAX-5: Floor Division Zero-Tax Threshold
- **Tool:** Proptest
- **Property:** `amount < ceil(10000/bps) => tax = 0`

### INV-TAX-6: u128 Prevents Overflow
- **Tool:** Proptest
- **Property:** `calculate_tax(amount, bps).is_some()` for all valid inputs

### INV-TAX-11: Micro-Tax Rule
- **Tool:** Proptest
- **Property:** `total < 4 => split = (total, 0, 0)`

### INV-TAX-14: Output Floor <= Expected
- **Tool:** Proptest
- **Property:** `floor <= expected_output` for floor_bps <= 10000

### INV-TAX-15: Zero-Input Floor Safety
- **Tool:** Proptest
- **Property:** Any zero input -> floor returns 0

---

## P3: Compound Properties

### INV-TAX-18: Fee-on-Fee Compounding Order
- **Tool:** LiteSVM
- **Property:** Buy: tax then AMM. Sell: AMM then tax.

### INV-TAX-19: Rounding Dust Accumulation Bound
- **Tool:** Proptest
- **Property:** Cumulative dust <= N * 2 lamports

### INV-TAX-20: 71/24/5 Split Verification
- **Tool:** Proptest
- **Property:** `split_distribution(10000) == (7100, 2400, 500)`
