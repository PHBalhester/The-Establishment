# VRF Carnage Decisions -- Confirmed Invariants
# Priority Rank: 7 (VRF-derived Carnage mechanics)

Source: `programs/epoch-program/src/helpers/carnage.rs`

---

## INV-CG-001: Carnage Trigger = 11/256 (~4.3%) [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 1 (exhaustive over 256)
- **Property:** `count(b < 11 for b in 0..255) == 11`
- **Code:** `carnage.rs:25-27`
- **Existing:** Yes (lines 81-100)

## INV-CG-003: No-Holdings Override -> None [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 2 (safety guard)
- **Property:** `has_holdings=false => CarnageAction::None` always
- **Code:** `carnage.rs:37-39`
- **Existing:** Partial (line 104-107)

## INV-CG-002: Sell Action = 5/256 (~2%) [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 3 (exhaustive over 256)
- **Property:** `count(b < 5 for b in 0..255) == 5` when has_holdings=true
- **Code:** `carnage.rs:36-46`
- **Existing:** Yes (lines 110-133)

## INV-CG-004: Target Selection = 50/50 [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 4 (exhaustive over 256)
- **Property:** `count(b < 128) == 128`, `count(b >= 128) == 128`
- **Code:** `carnage.rs:58-63`
- **Existing:** Yes (lines 137-160)

## INV-CG-005: Three Decisions Use Distinct Bytes [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 5
- **Property:** Bytes {5, 6, 7} are disjoint
- **Code:** `carnage.rs:26, 41, 59`

## INV-CG-006: Joint Sell Probability = 55/65536 [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 6 (statistical / exhaustive over 65536)
- **Property:** `(11/256) * (5/256) = 55/65536 = 0.084%`
- **Code:** Composed from `is_carnage_triggered` + `get_carnage_action`

## INV-CG-009: Threshold Constants Match Documented Probabilities [CONFIRMED]
- **Tool:** Unit test
- **Priority:** 7
- **Property:** `TRIGGER=11`, `SELL=5`, documented as ~4.3% and ~2%
- **Code:** `constants.rs:142, 146`
- **Existing:** Yes (lines 164-173)

## INV-CG-007: CarnageAction Enum Exhaustive [CONFIRMED]
- **Tool:** Source audit
- **Priority:** 8
- **Property:** Exactly 3 variants: None, Burn, Sell -- all reachable
- **Code:** `enums.rs:59-66`, `carnage.rs:36-46`

## INV-CG-008: Target Independent of Holdings State [CONFIRMED]
- **Tool:** Source audit
- **Priority:** 9
- **Property:** `get_carnage_target` takes only VRF array, no holdings param
- **Code:** `carnage.rs:58-63`

## INV-CG-010: Target Threshold 128 Should Be Named Constant [CONFIRMED]
- **Tool:** Source audit (advisory)
- **Priority:** 10
- **Property:** Recommend extracting `128` to `CARNAGE_TARGET_THRESHOLD` in constants.rs
- **Code:** `carnage.rs:59`
