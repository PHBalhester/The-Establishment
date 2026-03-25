# BOK Phase 0: Scan Report

**Date:** 2026-02-22
**Codebase:** Dr. Fraudsworth's Finance Factory (5 programs, ~28.7K LOC)
**GL Docs:** /Docs (53 documents including token-economics-model, architecture, liquidity-slippage-analysis)

---

## Prerequisites

| Tool | Status | Impact |
|------|--------|--------|
| **Kani** | NOT INSTALLED | No formal proofs. Graceful degradation to LiteSVM + Proptest only. Results are probabilistic, not proven. |
| **LiteSVM** | Available (used in existing tests) | Runtime tests against actual SVM |
| **Proptest** | Available (already in use) | Property-based stress testing |
| **Cargo** | Available | Build and test toolchain |

**Recommendation:** Install Kani for formal proofs of AMM and staking math. Without it, we rely on probabilistic verification (high confidence but not mathematically proven).

---

## Math Regions Indexed

### Priority 1: CRITICAL (AMM Swap Math)
**File:** `programs/amm/src/helpers/math.rs` (497 lines)
**Functions:**
- `calculate_effective_input(amount_in: u64, fee_bps: u16) -> Option<u128>` (line 36)
- `calculate_swap_output(reserve_in: u64, reserve_out: u64, effective_input: u128) -> Option<u64>` (line 58)
- `verify_k_invariant(...)` (line 92)
- `check_effective_input_nonzero(...)` (line 115)
- `check_swap_output_nonzero(...)` (line 129)

**Existing tests:** 22 unit tests + 3 proptest properties (10K iterations each)
**GL invariants to verify:**
- INV-3: k_after >= k_before (every swap)
- INV-6: Pool reserves can only increase (no withdrawal mechanism)
- Pool drain impossibility (proven in liquidity-slippage-analysis.md)
- Output < reserve_out (always)
- Fee monotonicity (higher fee_bps -> less effective input)

**Why critical:** These functions execute on every single swap. An error here means every trade is wrong. The AMM handles all SOL flow through the protocol.

---

### Priority 2: CRITICAL (Tax Distribution Math)
**File:** `programs/tax-program/src/helpers/tax_math.rs` (509 lines)
**Functions:**
- `calculate_tax(amount_lamports: u64, tax_bps: u16) -> Option<u64>` (line 34)
- `split_distribution(total_tax: u64) -> Option<(u64, u64, u64)>` (line 79)
- `calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps) -> Option<u64>` (line 135)

**Existing tests:** 20 unit tests + 6 proptest properties (10K iterations each)
**GL invariants to verify:**
- INV-1: staking + carnage + treasury == total_tax (ALWAYS)
- INV-2: staking >= floor(total_tax * 75/100), carnage >= floor(total_tax * 24/100)
- Micro-tax rule: total_tax < 4 -> all to staking
- Tax monotonicity: higher bps -> higher tax
- Output floor correctness: floor = expected * floor_bps / 10000

**Why critical:** Controls how 100% of protocol revenue is distributed. A bug here means staking yield, Carnage funding, or treasury is wrong.

---

### Priority 3: HIGH (Staking Reward Math)
**File:** `programs/staking/src/helpers/math.rs` (617 lines)
**Functions:**
- `update_rewards(pool: &StakePool, user: &mut UserStake)` (line 36)
- `add_to_cumulative(pool: &mut StakePool) -> Result<u64>` (line 91)

**Existing tests:** 16 unit tests + 4 proptest properties (10K iterations each)
**GL invariants to verify:**
- INV-4: rewards_per_token_stored monotonically non-decreasing
- INV-5: For any user: user_reward <= total_deposited_rewards
- Division truncation always favors protocol (MATH-05)
- Zero stakers -> rewards stay pending
- Late staker gets no past rewards
- Flash-loan resistance (same-epoch stake/unstake = 0 rewards)

**Why critical:** Incorrect reward math could drain the escrow vault or shortchange stakers. The 1e18 PRECISION factor has overflow potential at extreme values.

---

### Priority 4: HIGH (Carnage Slippage Math)
**File:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
**File:** `programs/tax-program/src/helpers/pool_reader.rs` (84 lines)

**Key math regions:**
- Carnage expected output calculation (constant-product formula)
- Slippage floor enforcement: `bought >= expected * SLIPPAGE_BPS / 10000`
- `read_pool_reserves()` raw byte reading at offsets 137-153
- `total_buy_amount = min(tax_sol + wsol_from_sale, MAX_CARNAGE_SWAP_LAMPORTS)`

**GL invariants to verify:**
- INV-9: minimum_output >= 50% of expected (user swaps)
- Carnage atomic floor: 85% (8500 bps)
- Carnage fallback floor: 75% (7500 bps)
- MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL cap
- Sell path combined SOL doesn't exceed cap

**Why high:** Incorrect slippage math could allow MEV extraction or Carnage to execute at unfavorable prices, draining the Carnage fund faster than intended.

---

### Priority 5: MEDIUM (VRF Tax Derivation)
**File:** `programs/epoch-program/src/helpers/tax_derivation.rs` (333 lines)
**Functions:**
- `derive_taxes(vrf_result: &[u8; 32], current_cheap: Token) -> TaxConfig` (line 84)

**Existing tests:** 12 unit tests (exhaustive boundary coverage)
**GL invariants to verify:**
- Flip probability = 75% (byte < 192)
- Low rates: exactly {100, 200, 300, 400} bps (no other values possible)
- High rates: exactly {1100, 1200, 1300, 1400} bps
- Independent CRIME/FRAUD magnitude rolls
- Cheap side gets: low buy, high sell. Expensive side gets: high buy, low sell.

**Why medium:** Tax derivation is simple lookup table math with no overflow risk. But incorrect rate assignment would affect all trading volume. Already well-tested with boundary coverage.

---

### Priority 6: MEDIUM (VRF Carnage Decisions)
**File:** `programs/epoch-program/src/helpers/carnage.rs` (174 lines)
**Functions:**
- `is_carnage_triggered(vrf_result: &[u8; 32]) -> bool` (line 25)
- `get_carnage_action(vrf_result: &[u8; 32], has_holdings: bool) -> CarnageAction` (line 36)
- `get_carnage_target(vrf_result: &[u8; 32]) -> Token` (line 58)

**Existing tests:** 10 unit tests (exhaustive 0-255 boundary coverage)
**GL invariants to verify:**
- Trigger: byte 5 < 11 (~4.3%)
- Sell: byte 6 < 5 (~2%)
- Target: byte 7 < 128 (50/50)

**Why medium:** Simple threshold comparisons. Already exhaustively tested across all 256 byte values. Low risk.

---

### Priority 7: LOW (Constants Cross-Verification)
**Files:**
- `programs/amm/src/constants.rs` (46 lines)
- `programs/tax-program/src/constants.rs`
- `programs/staking/src/constants.rs` (190 lines)
- `programs/epoch-program/src/constants.rs` (319 lines)

**Cross-verification needed:**
- SOL_POOL_FEE_BPS = 100 (AMM) matches GL docs
- PROFIT_POOL_FEE_BPS = 50 (AMM) matches GL docs
- MAX_LP_FEE_BPS = 500 (AMM) matches audit fix (H030)
- PRECISION = 1e18 (Staking) matches DeFi standard
- MINIMUM_STAKE = 1_000_000 (Staking) = 1 PROFIT
- STAKING_BPS = 7500, CARNAGE_BPS = 2400, TREASURY_BPS = 100 sum to 10000
- Cross-program seeds match between all programs

---

### NOT IN SCOPE (No Math)
- `programs/transfer-hook/` - Whitelist check only, no arithmetic
- `programs/stub-staking/` - Test stub
- `programs/fake-tax-program/` - Test stub
- `programs/mock-tax-program/` - Test stub

---

## Existing Proptest Coverage Assessment

| Module | Properties | Iterations | Coverage Gaps |
|--------|-----------|------------|---------------|
| AMM math.rs | 3 (k-invariant, output < reserve, fee monotonic) | 10K each | Missing: fee + swap composition, u64 overflow at extreme reserves |
| Tax tax_math.rs | 6 (no overflow, invalid bps, monotonic, split sum, staking %, micro-tax) | 10K each | Missing: split distribution ratio precision bounds, output floor vs actual swap output |
| Staking math.rs | 4 (no panic, conservation, formula no panic, monotonic) | 10K each | Missing: multi-user conservation (N users claim <= total), dust accounting, u128 cumulative overflow bounds |

---

## Recommended BOK Verification Plan

### Tier 1: Formal Proofs (requires Kani)
1. AMM: output < reserve_out for ALL u64 inputs (not just 10K random)
2. AMM: k_after >= k_before for ALL valid fee/reserve/amount combos
3. Tax: split_distribution sum == total_tax for ALL u64 inputs
4. Staking: reward conservation for ALL balance/delta combos within u128

### Tier 2: LiteSVM Runtime Tests
5. End-to-end: Tax -> AMM -> Staking deposit_rewards SOL conservation
6. Carnage sell path: combined SOL capping at MAX_CARNAGE_SWAP_LAMPORTS
7. Multi-user staking: N users stake -> rewards distribute -> total claimed <= total deposited
8. Pool reserves monotonicity across swap sequences

### Tier 3: Proptest Gap-Fill
9. AMM: composed fee + swap for extreme u64 reserves (close to overflow)
10. Tax: output floor agrees with actual AMM swap output (cross-module)
11. Staking: u128 cumulative overflow boundary (when does it actually overflow?)
12. Staking: multi-epoch dust accumulation (does dust add up to material loss?)
13. Carnage: expected output formula matches AMM swap output for same reserves

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Math regions identified | 13 functions across 6 files |
| Existing unit tests | ~74 (math-specific) |
| Existing proptest properties | 13 (130K total iterations) |
| GL economic invariants | 9 documented |
| Verification gaps identified | 13 (5 formal, 4 runtime, 4 proptest) |
| Programs with math | 4 of 5 (Transfer Hook has none) |

**Next step:** Run `/BOK:analyze` to match these regions against verification patterns and propose specific invariants with plain-language explanations.
