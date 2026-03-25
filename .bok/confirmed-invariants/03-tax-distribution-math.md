# Tax Distribution Math -- Confirmed Invariants
# Priority Rank: 3 (Critical-path tax collection)

Source: `programs/tax-program/src/helpers/tax_math.rs`

---

## INV-TAX-007: Conservation -- Sum Equals Input [CONFIRMED]
- **Tool:** Kani (formal proof -- fundamental conservation law)
- **Priority:** 1 (fundamental conservation)
- **Property:** `staking + carnage + treasury == total_tax` exactly
- **Code:** `split_distribution` at `tax_math.rs:79`
- **Existing:** Proptest (line 471, 10K iter) -- Kani upgrades to exhaustive proof

## INV-TAX-001: Tax Never Exceeds Principal [CONFIRMED]
- **Tool:** Kani (formal proof -- critical safety property)
- **Priority:** 2
- **Property:** `calculate_tax(amount, bps) <= amount` for valid bps
- **Code:** `calculate_tax` at `tax_math.rs:34`
- **Existing:** Partial proptest (missing prop_assert!) -- Kani provides complete proof

## INV-TAX-008: Staking Floor >= 75% [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 3 (GAP: existing check only >= 70%)
- **Property:** `staking == floor(total * 75 / 100)` exactly
- **Code:** `split_distribution` at `tax_math.rs:90`
- **Existing:** Relaxed bound -- tighten to exact

## INV-TAX-009: Carnage Floor >= 24% [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 4 (GAP: no exact check)
- **Property:** `carnage == floor(total * 24 / 100)` exactly
- **Code:** `split_distribution` at `tax_math.rs:94`
- **Existing:** None

## INV-TAX-012: Hardcoded Percentages Match Constants [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 5 (GAP: maintainability hazard)
- **Property:** `STAKING_BPS/100 == 75` and `CARNAGE_BPS/100 == 24`
- **Code:** `constants.rs:18-21` vs `tax_math.rs:90,94`
- **Existing:** None

## INV-TAX-010: Treasury Absorbs Dust (Never Negative) [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 6
- **Property:** `treasury <= 2 lamports` for total_tax >= 4
- **Code:** `split_distribution` at `tax_math.rs:99-101`
- **Existing:** Implicit

## INV-TAX-003: Tax Monotonicity with BPS Rate [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 7
- **Property:** `bps_low <= bps_high => tax_low <= tax_high`
- **Code:** `calculate_tax` at `tax_math.rs:34`
- **Existing:** Yes (line 450, 10K iter)

## INV-TAX-004: Invalid BPS Rejection [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 8
- **Property:** `bps > 10000 => None`
- **Code:** `calculate_tax` at `tax_math.rs:34`
- **Existing:** Yes (line 440, 10K iter)

## INV-TAX-002: Zero Fee at Zero Input [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 9
- **Property:** `calculate_tax(0, bps) == 0` and `calculate_tax(amount, 0) == 0`
- **Code:** `calculate_tax` at `tax_math.rs:34`
- **Existing:** Unit tests (lines 210-219)

## INV-TAX-005: Floor Division Allows Zero Tax on Small Amounts [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 10
- **Property:** `amount < ceil(10000/bps) => tax == 0`
- **Code:** `calculate_tax` at `tax_math.rs:46-48`
- **Existing:** Partial

## INV-TAX-006: u128 Intermediate Prevents Overflow [CONFIRMED]
- **Tool:** Kani (formal proof -- same pattern as AMM-006)
- **Priority:** 11
- **Property:** Never returns None due to overflow for valid bps
- **Code:** `calculate_tax` at `tax_math.rs:41-48`
- **Existing:** Unit test (u64::MAX) -- Kani proves exhaustively for all u64 x u16

## INV-TAX-011: Micro-Tax Rule -- All to Staking Below 4 [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 12
- **Property:** `total_tax < 4 => (total_tax, 0, 0)`
- **Code:** `split_distribution` at `tax_math.rs:82-84`
- **Existing:** Yes (exhaustive 0-3)

## INV-TAX-013: Output Floor Never Exceeds Expected [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 13
- **Property:** `floor <= expected` for floor_bps <= 10000
- **Code:** `calculate_output_floor` at `tax_math.rs:135`
- **Existing:** Partial

## INV-TAX-015: Floor Monotonicity with Floor BPS [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 14 (GAP: no test)
- **Property:** `bps_low <= bps_high => floor_low <= floor_high`
- **Code:** `calculate_output_floor` at `tax_math.rs:153-155`
- **Existing:** None

## INV-TAX-014: Zero-Input Safety [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 15
- **Property:** Any zero input => floor returns 0
- **Code:** `calculate_output_floor` at `tax_math.rs:142-144`
- **Existing:** Unit tests (lines 337-351)

## INV-TAX-016: Output Floor Unsafe Cast Check [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 16 (GAP: unguarded floor_bps)
- **Property:** No truncation for adversarial floor_bps values
- **Code:** `calculate_output_floor` at `tax_math.rs:158`
- **Existing:** None

## INV-TAX-017: Fee-on-Fee Compounding Documentation [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 17
- **Property:** Buy: tax then LP fee. Sell: LP fee then tax.
- **Code:** `swap_sol_buy` handler, `swap_sol_sell` handler
- **Existing:** None

## INV-TAX-018: Rounding Accumulation Bound [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 18
- **Property:** Treasury dust per TX <= 2 lamports
- **Code:** `split_distribution` called per-transaction
- **Existing:** None
