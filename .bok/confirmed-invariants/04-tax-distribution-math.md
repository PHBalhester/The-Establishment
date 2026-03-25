# Confirmed: Tax Distribution Math
# Priority Rank: 4 (critical-path -- every swap taxes through this)
# Invariants: 18 confirmed, 0 skipped

Source: `programs/tax-program/src/helpers/tax_math.rs`

---

## Proptest Invariants (15)

### calculate_tax (6)

### INV-TAX-001: Tax Never Exceeds Principal [PRIORITY: P1]
- **Tool:** Proptest
- **Property:** `calculate_tax(amount, bps) <= amount` for all valid bps
- **Code ref:** `tax_math.rs:34`

### INV-TAX-002: Zero Fee at Zero Input [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `calculate_tax(0, any) = 0` and `calculate_tax(any, 0) = 0`
- **Code ref:** `tax_math.rs:34`

### INV-TAX-003: Tax Monotonicity [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `bps_low <= bps_high => tax_low <= tax_high`
- **Code ref:** `tax_math.rs:34`

### INV-TAX-004: Invalid BPS Rejection [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** `bps > 10000 => calculate_tax returns None`
- **Code ref:** `tax_math.rs:34`

### INV-TAX-005: Floor Division Zero Tax Threshold [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `amount < ceil(10000/bps) => tax = 0` (documents split-evasion threshold)
- **Code ref:** `tax_math.rs:46-48`

### INV-TAX-006: u128 Intermediate Overflow Safety [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** Never returns None for valid bps (u64::MAX * 10000 fits u128)
- **Code ref:** `tax_math.rs:41-48`

### split_distribution (5)

### INV-TAX-007: Conservation -- Sum Equals Input [PRIORITY: P1]
- **Tool:** Proptest
- **Property:** `staking + carnage + treasury = total_tax` (exact)
- **Code ref:** `tax_math.rs:79`

### INV-TAX-008: Staking Floor >= 75% [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** `staking = floor(total_tax * 75 / 100)` (tighten from existing >= 70%)
- **Code ref:** `tax_math.rs:90`

### INV-TAX-009: Carnage Floor >= 24% [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** `carnage = floor(total_tax * 24 / 100)`
- **Code ref:** `tax_math.rs:94`

### INV-TAX-010: Treasury Absorbs Dust [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `treasury >= 0` (u64) and `treasury <= 2` for total_tax >= 4
- **Code ref:** `tax_math.rs:99-101`

### INV-TAX-011: Micro-Tax Rule [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `total_tax < 4 => (total_tax, 0, 0)`
- **Code ref:** `tax_math.rs:82-84`

### calculate_output_floor (4)

### INV-TAX-013: Output Floor <= Expected [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** `floor <= expected` for all valid floor_bps
- **Code ref:** `tax_math.rs:135`

### INV-TAX-014: Zero-Input Safety [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** Any zero reserve/amount => floor = 0
- **Code ref:** `tax_math.rs:142-144`

### INV-TAX-015: Floor Monotonicity [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `bps_low <= bps_high => floor_low <= floor_high`
- **Code ref:** `tax_math.rs:153-155`

### INV-TAX-016: Unsafe Cast Check [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `floor as u64` safe when floor_bps <= 10000; document unguarded input
- **Code ref:** `tax_math.rs:158`

### Compound (1)

### INV-TAX-018: Rounding Accumulation Bound [PRIORITY: P4]
- **Tool:** Proptest
- **Property:** Treasury dust <= 2 lamports per transaction
- **Code ref:** `tax_math.rs:79` (per-call)

---

## LiteSVM Invariants (3)

### INV-TAX-012: Hardcoded % Match Constants [PRIORITY: P2]
- **Tool:** LiteSVM
- **Property:** `split_distribution(10000) = (7500, 2400, 100)` linking constants to code
- **Code ref:** `tax_math.rs:90,94` vs `constants.rs:18-25`

### INV-TAX-017: Fee-on-Fee Ordering [PRIORITY: P3]
- **Tool:** LiteSVM
- **Property:** Buy: tax first then LP fee. Sell: LP fee first then tax.
- **Code ref:** `swap_sol_buy.rs`, `swap_sol_sell.rs`
