# VRF Carnage Decisions Invariants

**Source:** `programs/epoch-program/src/helpers/carnage.rs` (174 lines)
**Constants:** `programs/epoch-program/src/constants.rs` (lines 140-146)
**Spec Reference:** Carnage_Fund_Spec.md Sections 6-7, Token Economics Model

---

## Byte Allocation Map

| VRF Byte | Decision            | Threshold / Mechanism           | Line(s)       |
|----------|---------------------|---------------------------------|---------------|
| Byte 5   | Carnage trigger     | `< 11` = triggered (~4.3%)     | carnage.rs:26 |
| Byte 6   | Carnage action      | `< 5` = Sell (~2%), else Burn  | carnage.rs:41 |
| Byte 7   | Carnage target      | `< 128` = Crime (50%)          | carnage.rs:59 |

No overlap with tax derivation bytes (0-4). Each carnage decision uses a distinct byte.

---

### INV-CG-001: Carnage Trigger Probability Is Exactly 11/256 (~4.3%)

**Function:** `is_carnage_triggered` at `carnage.rs:25-27`
**Pattern:** VP-096 (Modulo Bias) / VP-097 (Distribution Fairness)
**Tool:** Proptest (exhaustive)
**Confidence:** high

**Plain English:** Carnage triggers when VRF byte 5 is strictly less than 11. For a uniform byte in [0, 255], exactly 11 values (0 through 10) satisfy this condition, giving a trigger probability of 11/256 = 4.296875%.

**Why It Matters:** Carnage events are the primary deflationary mechanism (98% burn path) and the secondary volume driver (2% sell-then-rebuy path). If the trigger rate is too high, the Carnage SOL vault drains quickly and the protocol's buyback runway shortens. If too low, the deflationary pressure is insufficient and token price bleeds. The ~4.3% rate is calibrated for ~2 events per day at 48 epochs/day.

**Formal Property:**
```
CARNAGE_TRIGGER_THRESHOLD = 11  (constants.rs:142)

For all b in [0, 255]:
  is_triggered(b) = (b < 11)

P(trigger) = |{b : b < 11}| / 256 = 11 / 256 = 0.04296875

Boundary: triggered(10) = true, triggered(11) = false
```

**Verification Approach:**
Exhaustive: iterate all 256 byte values for byte 5, count how many trigger `is_carnage_triggered`. Assert count == 11. Boundary check: construct VRF with byte5=10 (should trigger) and byte5=11 (should not). The existing tests at lines 81-100 already do exhaustive range checks, but a standalone invariant test documents the probability calculation explicitly.

---

### INV-CG-002: Sell Action Probability Is Exactly 5/256 (~2%) When Holdings Exist

**Function:** `get_carnage_action` at `carnage.rs:36-46`
**Pattern:** VP-096 (Modulo Bias) / VP-097 (Distribution Fairness)
**Tool:** Proptest (exhaustive)
**Confidence:** high

**Plain English:** When `has_holdings` is true, the Sell action occurs when VRF byte 6 is strictly less than 5. Exactly 5 of 256 values (0-4) produce Sell; the remaining 251 produce Burn. The conditional sell probability is 5/256 = 1.953125%.

**Why It Matters:** The Sell path (2%) converts held tokens back to SOL before rebuying, creating a larger market-moving event than Burn (which destroys tokens without market impact). If the sell threshold were accidentally set too high (e.g., 128 = 50%), half of all Carnage events would dump tokens on the market, causing severe price impact and potential death spirals. The 2% rate ensures sells are rare spectacles, not routine dumps.

**Formal Property:**
```
CARNAGE_SELL_THRESHOLD = 5  (constants.rs:146)

For all b in [0, 255], given has_holdings = true:
  action(b) = if b < 5 then Sell else Burn

P(Sell | has_holdings) = 5 / 256 = 0.01953125
P(Burn | has_holdings) = 251 / 256 = 0.98046875

Boundary: action(4) = Sell, action(5) = Burn
```

**Verification Approach:**
Exhaustive: iterate all 256 byte values for byte 6 with `has_holdings=true`, count Sell and Burn outcomes. Assert Sell count == 5, Burn count == 251. The existing tests at lines 110-133 already do exhaustive range checks for both outcomes.

---

### INV-CG-003: No-Holdings Override Always Returns CarnageAction::None

**Function:** `get_carnage_action` at `carnage.rs:37-39`
**Pattern:** VP-097 (Distribution Fairness -- state-dependent behavior)
**Tool:** Proptest
**Confidence:** high

**Plain English:** When `has_holdings` is false, `get_carnage_action` returns `CarnageAction::None` regardless of byte 6's value. The VRF byte is not even inspected.

**Why It Matters:** If the no-holdings check were missing or inverted, the protocol would attempt to sell or burn tokens from an empty vault, causing either a transaction failure (best case) or an underflow/accounting error (worst case). The early return at line 38 prevents any Carnage action on an empty vault.

**Formal Property:**
```
For all vrf in [u8; 32]:
  get_carnage_action(vrf, has_holdings=false) == CarnageAction::None

Contrapositive: CarnageAction::Sell or CarnageAction::Burn implies has_holdings=true.
```

**Verification Approach:**
Proptest: generate arbitrary 32-byte arrays, call `get_carnage_action` with `has_holdings=false`, assert all return `CarnageAction::None`. Exhaustive variant: iterate all 256 values of byte 6, confirm None for every one. Existing test at line 104-107 covers a single case; Proptest adds statistical confidence.

---

### INV-CG-004: Target Selection Is Exactly 50/50 (CRIME vs FRAUD)

**Function:** `get_carnage_target` at `carnage.rs:58-63`
**Pattern:** VP-096 (Modulo Bias) / VP-097 (Distribution Fairness)
**Tool:** Proptest (exhaustive)
**Confidence:** high

**Plain English:** Carnage target is determined by byte 7: values [0, 127] select CRIME, values [128, 255] select FRAUD. Each range contains exactly 128 values, giving a perfect 50/50 split with zero bias.

**Why It Matters:** If the target selection were biased (e.g., threshold at 100 giving 100/256 = 39% CRIME, 61% FRAUD), Carnage would preferentially buy one token over the other. Over time, this would create persistent buy pressure on the favored token, breaking the symmetric duality that the entire game mechanic relies on. Market participants would "solve" which token gets more Carnage buys and concentrate there, collapsing the two-token system into a single-token system.

**Formal Property:**
```
TARGET_THRESHOLD = 128  (hardcoded at carnage.rs:59, not in constants.rs)

For all b in [0, 255]:
  target(b) = if b < 128 then Crime else Fraud

P(Crime) = |{b : b < 128}| / 256 = 128 / 256 = 0.50
P(Fraud) = |{b : b >= 128}| / 256 = 128 / 256 = 0.50

Boundary: target(127) = Crime, target(128) = Fraud
```

**Verification Approach:**
Exhaustive: iterate all 256 byte values for byte 7, count Crime and Fraud outcomes. Assert Crime count == 128, Fraud count == 128. The existing tests at lines 137-160 already do exhaustive range checks for both halves. Note: the threshold 128 is hardcoded in `get_carnage_target` directly, not extracted to a named constant in `constants.rs` -- consider promoting it for consistency.

---

### INV-CG-005: Carnage Decisions Use Distinct VRF Bytes (No Reuse)

**Function:** `is_carnage_triggered` at `carnage.rs:26`, `get_carnage_action` at `carnage.rs:41`, `get_carnage_target` at `carnage.rs:59`
**Pattern:** VP-098 (Seed Derivation Determinism -- independence)
**Tool:** Source audit (static) / Proptest
**Confidence:** high

**Plain English:** The three Carnage decisions read from bytes 5, 6, and 7 respectively. No two decisions share a byte. This guarantees statistical independence: knowing whether Carnage triggered tells you nothing about the action or target.

**Why It Matters:** If the trigger and action shared byte 5 (e.g., `byte5 < 11` for trigger, `byte5 < 5` for sell), then every Sell event would require byte5 in [0, 4], and every Burn would require byte5 in [5, 10]. This would mean Sell can only happen for byte5 in {0,1,2,3,4} and Burn for {5,6,7,8,9,10} -- the conditional probabilities would be fixed artifacts of the shared byte, not independent draws. Independence is critical for unbiased outcomes.

**Formal Property:**
```
TRIGGER_BYTE = 5   (carnage.rs:26)
ACTION_BYTE  = 6   (carnage.rs:41)
TARGET_BYTE  = 7   (carnage.rs:59)

{5} intersection {6} = empty set
{5} intersection {7} = empty set
{6} intersection {7} = empty set

All three bytes are distinct.
```

**Verification Approach:**
Static: confirm hardcoded indices in source. Dynamic (Proptest): generate pairs of VRF arrays that differ in only byte 5. Assert `is_carnage_triggered` may change, but `get_carnage_action` and `get_carnage_target` remain identical. Repeat for bytes 6 and 7 in isolation.

---

### INV-CG-006: Joint Probability of Sell-Type Carnage Is Exactly 55/65536 (~0.084%)

**Function:** `is_carnage_triggered` + `get_carnage_action` (composed)
**Pattern:** VP-097 (Distribution Fairness -- compound event)
**Tool:** Proptest (statistical)
**Confidence:** high

**Plain English:** A Sell-type Carnage (the market-moving event) requires both: (1) Carnage triggers (byte5 < 11, P=11/256), AND (2) action is Sell (byte6 < 5, P=5/256). Since bytes 5 and 6 are independent (INV-CG-005), the joint probability is (11/256) * (5/256) = 55/65536 = 0.08392%. At 48 epochs/day, this is ~0.04 sell events per day, or roughly one every 25 days.

**Why It Matters:** This is the rarest Carnage outcome and the most impactful (tokens sold to SOL, then SOL used to buy the target token). The extreme rarity (~25-day interval) means it should be a memorable event when it happens. If the joint probability were higher (e.g., both thresholds at 50 giving (50/256)^2 = 3.8%), sells would happen multiple times per day, creating persistent sell pressure that degrades token value.

**Formal Property:**
```
P(Sell Carnage) = P(trigger) * P(sell | trigger, has_holdings)
                = (11/256) * (5/256)
                = 55 / 65536
                = 0.000839233...

Note: P(sell | trigger) = P(sell) because bytes 5 and 6 are independent.
```

**Verification Approach:**
Proptest (statistical): generate 1,000,000 random 32-byte arrays, count how many satisfy both `is_carnage_triggered` AND `get_carnage_action(_, true) == Sell`. Assert the count is within 3 standard deviations of the expected value (839 +/- 87 for 1M trials). Alternatively, exhaustive over bytes 5 and 6 (256 * 256 = 65536 combinations): count pairs where byte5 < 11 AND byte6 < 5, assert count == 55.

---

### INV-CG-007: CarnageAction Enum Is Exhaustive (No Fourth Variant)

**Function:** `get_carnage_action` at `carnage.rs:36-46`
**Pattern:** VP-097 (Distribution Fairness -- completeness)
**Tool:** Source audit (static)
**Confidence:** high

**Plain English:** The `CarnageAction` enum has exactly three variants: None (0), Burn (1), Sell (2). The function `get_carnage_action` returns exactly one of these three for any input. There is no "undefined" or "default" path -- the if/else chain is exhaustive.

**Why It Matters:** If a future code change added a fourth variant (e.g., `CarnageAction::Swap`) without updating `get_carnage_action`, the function would never return it, making the variant dead code. Conversely, if the function's control flow had a path that didn't return (e.g., missing `else`), Rust's exhaustiveness checker would catch it at compile time -- but this invariant documents the design intent explicitly.

**Formal Property:**
```
CarnageAction = {None, Burn, Sell}  (enums.rs:59-66)

For all vrf, has_holdings:
  get_carnage_action(vrf, has_holdings) in {None, Burn, Sell}

has_holdings = false  =>  result = None
has_holdings = true   =>  result in {Sell, Burn}

|image(get_carnage_action)| = 3  (all three variants are reachable)
```

**Verification Approach:**
Source audit confirms the enum has exactly 3 variants at `enums.rs:59-66` and the function has exactly two code paths (plus the early return). Proptest: generate all combinations of `has_holdings` and byte 6, assert each CarnageAction variant is produced at least once: None (has_holdings=false), Sell (has_holdings=true, byte6=0), Burn (has_holdings=true, byte6=5).

---

### INV-CG-008: Carnage Target Is Independent of Holdings State

**Function:** `get_carnage_target` at `carnage.rs:58-63`
**Pattern:** VP-098 (Seed Derivation Determinism)
**Tool:** Source audit (static)
**Confidence:** high

**Plain English:** `get_carnage_target` takes only the VRF array as input -- it does not accept or check `has_holdings`. The buy target is determined purely by VRF byte 7, regardless of what the Carnage vault currently holds.

**Why It Matters:** As documented in the function's comment (lines 53-54): "Target is VRF-determined regardless of which token is currently held. This means after a 2% sell, Carnage could immediately rebuy the same token." If target selection were influenced by current holdings, an attacker who could manipulate the vault's token balance (e.g., by donating tokens) could steer Carnage buys toward a specific token. Pure VRF determination prevents this.

**Formal Property:**
```
get_carnage_target : &[u8; 32] -> Token

The function signature does not include a holdings parameter.
For all vrf:
  get_carnage_target(vrf) depends only on vrf[7].
  get_carnage_target(vrf) is independent of CarnageFundState.held_token.
```

**Verification Approach:**
Source-level audit: the function at `carnage.rs:58-63` takes only `vrf_result: &[u8; 32]` as parameter. No state account is read. Proptest: for the same VRF array, calling `get_carnage_target` always returns the same result (determinism), confirming no hidden state dependency.

---

### INV-CG-009: Threshold Constants Match Documented Probabilities

**Function:** Constants at `constants.rs:142, 146`
**Pattern:** VP-096 (Modulo Bias -- threshold-to-probability correspondence)
**Tool:** Unit test (arithmetic)
**Confidence:** high

**Plain English:** The named constants CARNAGE_TRIGGER_THRESHOLD (11) and CARNAGE_SELL_THRESHOLD (5) produce the documented probabilities of ~4.3% and ~2% respectively when compared against a uniform byte.

**Why It Matters:** If a constant were accidentally changed (e.g., CARNAGE_TRIGGER_THRESHOLD set to 110 instead of 11), the trigger probability would jump from 4.3% to 43%, causing Carnage to fire ~20 times per day instead of ~2, rapidly draining the Carnage SOL vault and potentially exhausting protocol reserves within days.

**Formal Property:**
```
CARNAGE_TRIGGER_THRESHOLD = 11
11 / 256 = 0.04296875 (documented as ~4.3%)
Error from 4.3%: |0.04296875 - 0.043| = 0.00003125 (negligible)

CARNAGE_SELL_THRESHOLD = 5
5 / 256 = 0.01953125 (documented as ~2%)
Error from 2%: |0.01953125 - 0.02| = 0.00046875 (negligible)

TARGET threshold = 128 (hardcoded, not named constant)
128 / 256 = 0.50 (documented as 50%)
Error from 50%: 0.0 (exact)
```

**Verification Approach:**
Unit test: assert `CARNAGE_TRIGGER_THRESHOLD == 11` and `CARNAGE_SELL_THRESHOLD == 5`. The existing tests at lines 164-173 already verify these values. Additionally, compute the probabilities as floating point and assert they are within 0.01 of the documented percentages (4.3% and 2%).

---

### INV-CG-010: Target Threshold 128 Should Be a Named Constant

**Function:** `get_carnage_target` at `carnage.rs:59`
**Pattern:** VP-097 (Distribution Fairness -- code hygiene)
**Tool:** Source audit (recommendation)
**Confidence:** medium

**Plain English:** The trigger threshold (11) and sell threshold (5) are both extracted to named constants in `constants.rs` (lines 142, 146). However, the target selection threshold (128) is hardcoded directly in `get_carnage_target` at `carnage.rs:59`. This inconsistency means the target threshold cannot be verified by the same constant-assertion tests that protect the other two thresholds.

**Why It Matters:** This is not a correctness issue today -- the hardcoded 128 is correct. It is a maintainability concern: if a future developer searches `constants.rs` for all Carnage thresholds, they will find trigger and sell but miss target. Extracting to `CARNAGE_TARGET_THRESHOLD: u8 = 128` would align all three decisions under the same discoverability pattern.

**Formal Property:**
```
RECOMMENDED: Extract to constants.rs:
  pub const CARNAGE_TARGET_THRESHOLD: u8 = 128;

Then carnage.rs:59 becomes:
  if vrf_result[7] < CARNAGE_TARGET_THRESHOLD {
```

**Verification Approach:**
Source audit only. This is an advisory invariant, not a verification target. If the constant is extracted, add an assertion test matching the pattern of `test_trigger_probability_documented` and `test_sell_probability_documented`.

---

## Summary: Probability Table

| Event                     | VRF Byte | Threshold | Probability      | Expected per Day (48 epochs) |
|---------------------------|----------|-----------|------------------|------------------------------|
| Cheap-side flip           | 0        | < 192     | 75.000%          | 36 flips                     |
| Carnage trigger           | 5        | < 11      | 4.297%           | 2.06 triggers                |
| Sell action (if triggered)| 6        | < 5       | 1.953%           | (conditional)                |
| Burn action (if triggered)| 6        | >= 5      | 98.047%          | (conditional)                |
| Target = CRIME            | 7        | < 128     | 50.000%          | (conditional)                |
| Target = FRAUD            | 7        | >= 128    | 50.000%          | (conditional)                |
| **Joint: Sell Carnage**   | 5+6      | both      | 0.084%           | 0.040 per day (~1/25 days)   |
| **Joint: Burn Carnage**   | 5+6      | both      | 4.213%           | 2.02 per day                 |

All probabilities are exact (no modulo bias) because threshold comparisons on uniform [0, 255] bytes produce exact counts.
