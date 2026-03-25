# VRF Tax Derivation -- Confirmed Invariants
# Priority Rank: 6 (VRF-derived game mechanics)

Source: `programs/epoch-program/src/helpers/tax_derivation.rs`

---

## INV-TD-006: Cheap Side Gets Low Buy, High Sell [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 1 (core game mechanic)
- **Property:** Cheap token: buy in LOW_RATES, sell in HIGH_RATES. Expensive: inverse.
- **Code:** `tax_derivation.rs:106-117`

## INV-TD-010: Cheap Buy Tax < Expensive Buy Tax (gap >= 700 bps) [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 2 (game-theoretic correctness)
- **Property:** `max(LOW_RATES) = 400 < 1100 = min(HIGH_RATES)` guarantees 700+ bps gap
- **Code:** `tax_derivation.rs:106-117`

## INV-TD-007: No Tax Rate Outside Defined Ranges [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 3 (catch-all safety net)
- **Property:** All rates in `{100,200,300,400,1100,1200,1300,1400}`
- **Code:** `tax_derivation.rs:84-128`

## INV-TD-001: Flip Probability = 75% [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 4 (exhaustive over 256)
- **Property:** `count(b < 192 for b in 0..255) == 192`
- **Code:** `tax_derivation.rs:86`

## INV-TD-002: LOW_RATES = {100, 200, 300, 400} [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 5 (exhaustive)
- **Property:** Table has 4 elements, `byte % 4` covers all 4
- **Code:** `tax_derivation.rs:23, 89, 91`

## INV-TD-003: HIGH_RATES = {1100, 1200, 1300, 1400} [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 6 (exhaustive)
- **Property:** Table has 4 elements, `byte % 4` covers all 4
- **Code:** `tax_derivation.rs:26, 90, 92`

## INV-TD-004: Modulo-4 Bias = Zero [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 7 (exhaustive)
- **Property:** Each residue class {0,1,2,3} has exactly 64 values
- **Code:** `tax_derivation.rs:89-92`

## INV-TD-005: CRIME & FRAUD Use Independent VRF Bytes [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 8
- **Property:** `{1,2} ∩ {3,4} = ∅`
- **Code:** `tax_derivation.rs:89-92`

## INV-TD-008: Flip Is a Toggle [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 9
- **Property:** `opposite(opposite(x)) == x`
- **Code:** `Token::opposite` at `enums.rs:20-24`
- **Existing:** Already tested (enums.rs:130)

## INV-TD-009: Deterministic Output [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 10
- **Property:** Same VRF + same current_cheap = same TaxConfig
- **Code:** `tax_derivation.rs:84-128`

## INV-TD-011: No Byte Index Collision (Tax vs Carnage) [CONFIRMED]
- **Tool:** Source audit
- **Priority:** 11
- **Property:** Tax uses {0,1,2,3,4}, Carnage uses {5,6,7} -- disjoint
- **Code:** `tax_derivation.rs` vs `carnage.rs`
