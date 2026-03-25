# Confirmed Invariants: VRF Derivation, Carnage Decisions & Conversion Vault
**Priority Rank: 6** (supporting: VRF determines epoch params, vault enables token conversion)
**Source:** `epoch-program/helpers/tax_derivation.rs`, `carnage.rs`, `conversion-vault/instructions/convert.rs`
**Confirmed:** 33 invariants | Skipped: 0

---

## A. VRF Tax Derivation (11 invariants)

### INV-TD-001: Flip Probability Exactly 75%
- **Tool:** Proptest (exhaustive 256)
- **Property:** `|{b < 192}| / 256 = 75.0%`

### INV-TD-002: LOW_RATES = {100, 200, 300, 400} BPS
- **Tool:** Proptest (exhaustive)
- **Property:** All 256 byte values map to exactly these 4 values

### INV-TD-003: HIGH_RATES = {1100, 1200, 1300, 1400} BPS
- **Tool:** Proptest (exhaustive)
- **Property:** All 256 byte values map to exactly these 4 values

### INV-TD-004: Modulo-4 Bias Exactly Zero
- **Tool:** Proptest (exhaustive)
- **Property:** Each residue class {0,1,2,3} occurs exactly 64 times

### INV-TD-005: CRIME and FRAUD Use Independent VRF Bytes
- **Tool:** Proptest
- **Property:** Bytes {1,2} for CRIME, bytes {3,4} for FRAUD — disjoint

### INV-TD-006: Cheap Side Gets Low Buy / High Sell Tax
- **Tool:** Proptest
- **Property:** Cheap buy in LOW_RATES, cheap sell in HIGH_RATES, expensive reversed

### INV-TD-007: No Tax Rate Outside Defined Ranges
- **Tool:** Proptest
- **Property:** All 4 per-token rates in VALID_RATES = LOW union HIGH

### INV-TD-008: Flip Is a Toggle (Double Flip = Identity)
- **Tool:** Proptest
- **Property:** `opposite(opposite(x)) == x`

### INV-TD-009: Deterministic Output (Pure Function)
- **Tool:** Proptest
- **Property:** Same input always produces same TaxConfig

### INV-TD-010: Cheap Buy Tax < Expensive Buy Tax (>=700 bps gap)
- **Tool:** Proptest
- **Property:** max(LOW) = 400 < 1100 = min(HIGH) -> always 700+ gap

### INV-TD-011: No Byte Index Collision (Tax vs Carnage)
- **Tool:** Static audit
- **Property:** Tax bytes {0-4} disjoint from Carnage bytes {5-7}

---

## B. VRF Carnage Decisions (10 invariants)

### INV-CG-001: Trigger Probability 11/256 (~4.3%)
- **Tool:** Proptest (exhaustive)
- **Property:** Exactly 11 byte values trigger carnage

### INV-CG-002: Sell Probability 5/256 (~2%) When Holdings Exist
- **Tool:** Proptest (exhaustive)
- **Property:** Exactly 5 byte values produce Sell action

### INV-CG-003: No-Holdings -> Always None
- **Tool:** Proptest
- **Property:** `has_holdings=false => CarnageAction::None` for all bytes

### INV-CG-004: Target Selection 50/50
- **Tool:** Proptest (exhaustive)
- **Property:** 128 Crime, 128 Fraud — perfect split

### INV-CG-005: Three Decisions Use Distinct Bytes
- **Tool:** Proptest/Static
- **Property:** Bytes {5}, {6}, {7} are disjoint -> independent

### INV-CG-006: Joint Sell-Carnage Probability 55/65536
- **Tool:** Proptest (exhaustive over bytes 5+6)
- **Property:** Exactly 55 of 65536 byte-pair combinations

### INV-CG-007: CarnageAction Enum Exhaustive (3 variants)
- **Tool:** Static
- **Property:** None, Burn, Sell — all reachable

### INV-CG-008: Target Independent of Holdings State
- **Tool:** Static
- **Property:** get_carnage_target takes only VRF, no state

### INV-CG-009: Threshold Constants Match Documented Probabilities
- **Tool:** Unit
- **Property:** TRIGGER=11, SELL=5, TARGET=128

### INV-CG-010: Target Threshold Should Be Named Constant (Advisory)
- **Tool:** Static
- **Property:** 128 hardcoded at carnage.rs:59, not in constants.rs

---

## C. Conversion Vault (8 invariants)

### INV-CV-001: PROFIT->IP No Overflow (Realistic Supply)
- **Tool:** Kani
- **Property:** `amount * 100 <= u64::MAX` for amount <= 20T (entire supply)

### INV-CV-002: PROFIT->IP Overflow Boundary Correct
- **Tool:** Kani
- **Property:** Overflow at exactly `u64::MAX / 100`

### INV-CV-003: IP->PROFIT Dust Rejection (< 100 = Error)
- **Tool:** Proptest
- **Property:** Amounts [1,99] produce OutputTooSmall error

### INV-CV-004: Round-Trip IP->PROFIT->IP Loses Exactly N%100
- **Tool:** Proptest
- **Property:** Deterministic, bounded dust loss

### INV-CV-005: Round-Trip PROFIT->IP->PROFIT Is Lossless
- **Tool:** Proptest
- **Property:** Multiply by 100 then divide by 100 = identity

### INV-CV-006: Same-Mint Conversion Rejected
- **Tool:** Proptest
- **Property:** `input_mint == output_mint => SameMint error`

### INV-CV-007: CRIME<->FRAUD Direct Rejected
- **Tool:** Proptest
- **Property:** Must go through PROFIT bottleneck

### INV-CV-008: Zero Amount Rejected
- **Tool:** Kani
- **Property:** `amount_in = 0 => ZeroAmount error`

---

## D. VRF Full-Range (4 invariants)

### INV-VR-001: Every Byte [0,255] Maps to Valid Output
- **Tool:** Proptest (exhaustive)
- **Property:** No panic, no OOB for any byte in any position

### INV-VR-002: Deterministic (Same Input = Same Output)
- **Tool:** Kani
- **Property:** Pure functions, no hidden state

### INV-VR-003: Modulo-4 Zero Bias Confirmed
- **Tool:** Proptest (exhaustive count)
- **Property:** 64/64/64/64 split

### INV-VR-004: Carnage Thresholds Have No Dead Zones
- **Tool:** Proptest (exhaustive)
- **Property:** For T in {5, 11, 128}: both partitions non-empty
