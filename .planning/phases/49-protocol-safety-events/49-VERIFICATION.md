---
phase: 49-protocol-safety-events
verified: 2026-02-20T10:38:12Z
status: passed
score: 9/9 must-haves verified
---

# Phase 49: Protocol Safety & Events Verification Report

**Phase Goal:** The protocol has operational safety mechanisms (minimum output floors, escrow reconciliation monitoring) and comprehensive event emissions for off-chain monitoring and anomaly detection

**Verified:** 2026-02-20T10:38:12Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | swap_sol_buy with minimum_output=0 is rejected with MinimumOutputFloorViolation error before the AMM CPI fires | ✓ VERIFIED | swap_sol_buy.rs lines 105-111: floor check BEFORE CPI at line 304 |
| 2 | swap_sol_sell with minimum_output=0 is rejected with MinimumOutputFloorViolation error before the AMM CPI fires | ✓ VERIFIED | swap_sol_sell.rs lines 112-118: floor check BEFORE CPI invoke_signed |
| 3 | swap_sol_buy TaxedSwap event emits actual output_amount (not 0) | ✓ VERIFIED | swap_sol_buy.rs lines 296-320: balance-diff pattern, event at line 332 |
| 4 | swap_profit_buy with minimum_output=0 is rejected with MinimumOutputFloorViolation before AMM CPI | ✓ VERIFIED | swap_profit_buy.rs lines 55-61: floor check BEFORE CPI at line 154 |
| 5 | swap_profit_sell with minimum_output=0 is rejected with MinimumOutputFloorViolation before AMM CPI | ✓ VERIFIED | swap_profit_sell.rs lines 58-64: floor check BEFORE CPI invoke_signed |
| 6 | swap_profit_buy UntaxedSwap event emits actual output_amount and lp_fee (not 0) | ✓ VERIFIED | swap_profit_buy.rs lines 166-183: balance-diff + LP fee calc, event at line 195 |
| 7 | swap_profit_sell UntaxedSwap event emits actual output_amount and lp_fee (not 0) | ✓ VERIFIED | swap_profit_sell.rs lines 169-186: balance-diff + LP fee calc, event at line 198 |
| 8 | RewardsDeposited event includes escrow_vault pubkey and escrow_balance fields | ✓ VERIFIED | events.rs lines 144-150, deposit_rewards.rs line 108 |
| 9 | read_pool_reserves and calculate_output_floor helper functions exist with unit tests | ✓ VERIFIED | pool_reader.rs (59 lines), tax_math.rs lines 106-159 + 8 unit tests passing |

**Score:** 9/9 truths verified (100%)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/tax-program/src/helpers/pool_reader.rs` | read_pool_reserves function | ✓ VERIFIED | 59 lines, exports read_pool_reserves(AccountInfo) -> Result<(u64, u64)> |
| `programs/tax-program/src/helpers/tax_math.rs` | calculate_output_floor helper with unit tests | ✓ VERIFIED | Lines 106-159 function + 8 passing unit tests (lines 326-415) |
| `programs/tax-program/src/constants.rs` | MINIMUM_OUTPUT_FLOOR_BPS constant (5000) | ✓ VERIFIED | Line 40: `pub const MINIMUM_OUTPUT_FLOOR_BPS: u64 = 5000;` |
| `programs/tax-program/src/errors.rs` | MinimumOutputFloorViolation error variant | ✓ VERIFIED | Line 84: MinimumOutputFloorViolation in TaxError enum |
| `programs/tax-program/src/instructions/swap_sol_buy.rs` | Floor enforcement + balance-diff output + event fix | ✓ VERIFIED | Lines 24-25: imports, 105-111: floor, 296-320: balance-diff, 332: event |
| `programs/tax-program/src/instructions/swap_sol_sell.rs` | Floor enforcement | ✓ VERIFIED | Lines 112-118: floor check before CPI |
| `programs/tax-program/src/instructions/swap_profit_buy.rs` | Floor enforcement + balance-diff + LP fee | ✓ VERIFIED | Lines 17-18: imports, 55-61: floor, 166-183: output+fee, 195: event |
| `programs/tax-program/src/instructions/swap_profit_sell.rs` | Floor enforcement + balance-diff + LP fee | ✓ VERIFIED | Lines 58-64: floor, 169-186: output+fee, 198: event |
| `programs/staking/src/events.rs` | Enriched RewardsDeposited event struct | ✓ VERIFIED | Lines 144-150: escrow_vault (Pubkey) and escrow_balance (u64) fields |
| `programs/staking/src/instructions/deposit_rewards.rs` | Enriched event emission | ✓ VERIFIED | Line 108: `escrow_balance: ctx.accounts.escrow_vault.lamports()` |

**All 10 artifacts VERIFIED** (exists, substantive, wired)

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| swap_sol_buy.rs | pool_reader.rs | read_pool_reserves call | ✓ WIRED | Line 105: `read_pool_reserves(&ctx.accounts.pool)?` |
| swap_sol_buy.rs | tax_math.rs | calculate_output_floor call | ✓ WIRED | Line 106: `calculate_output_floor(reserve_a, reserve_b, sol_to_swap, MINIMUM_OUTPUT_FLOOR_BPS)` |
| swap_sol_sell.rs | pool_reader.rs | read_pool_reserves call | ✓ WIRED | Line 112: `read_pool_reserves(&ctx.accounts.pool)?` |
| swap_sol_sell.rs | tax_math.rs | calculate_output_floor call | ✓ WIRED | Line 113: `calculate_output_floor(reserve_b, reserve_a, amount_in, MINIMUM_OUTPUT_FLOOR_BPS)` |
| swap_profit_buy.rs | pool_reader.rs | read_pool_reserves call | ✓ WIRED | Line 55: `read_pool_reserves(&ctx.accounts.pool)?` |
| swap_profit_buy.rs | tax_math.rs | calculate_output_floor call | ✓ WIRED | Line 56: `calculate_output_floor(reserve_a, reserve_b, amount_in, MINIMUM_OUTPUT_FLOOR_BPS)` |
| swap_profit_sell.rs | pool_reader.rs | read_pool_reserves call | ✓ WIRED | Line 58: `read_pool_reserves(&ctx.accounts.pool)?` |
| swap_profit_sell.rs | tax_math.rs | calculate_output_floor call | ✓ WIRED | Line 59: `calculate_output_floor(reserve_b, reserve_a, amount_in, MINIMUM_OUTPUT_FLOOR_BPS)` |
| deposit_rewards.rs | events.rs | enriched RewardsDeposited emit | ✓ WIRED | Lines 107-108: emit new fields from existing AccountInfo |

**All 9 key links WIRED**

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| SEC-06 (Emergency pause) | N/A | DECLINED per ROADMAP.md line 88 |
| SEC-08 (Escrow reconciliation) | ✓ SATISFIED | deposit_rewards.rs already has balance check (line 99-102), now enriched with event visibility |
| SEC-09 (Event coverage) | ✓ SATISFIED | All critical state changes emit events with addresses and amounts |
| SEC-10 (Minimum output floor) | ✓ SATISFIED | All 4 user-facing swap instructions enforce 50% floor |
| FIX-06 (Event field fixes) | ✓ SATISFIED | Zero instances of `output_amount: 0` or `lp_fee: 0` as placeholders |

**5/5 requirements satisfied** (SEC-06 N/A by design decision)

### Anti-Patterns Found

**Zero blocker anti-patterns found.**

No TODO/FIXME comments, no placeholder content, no empty implementations found in modified files.

Grep verification:
```bash
# Zero matches for placeholder event values
grep -r "output_amount: 0" programs/tax-program/src/instructions/*.rs
# (no output)

grep -r "lp_fee: 0," programs/tax-program/src/instructions/*.rs
# (no output)
```

### Test Results

**All unit tests pass:**

```
cargo test -p tax-program --lib tax_math
running 34 tests
test helpers::tax_math::tests::floor_100pct ... ok
test helpers::tax_math::tests::floor_large_reserves_no_overflow ... ok
test helpers::tax_math::tests::floor_50pct_equal_reserves ... ok
test helpers::tax_math::tests::floor_realistic_sol_pool ... ok
test helpers::tax_math::tests::floor_small_amount_rounds_down ... ok
test helpers::tax_math::tests::floor_zero_amount ... ok
test helpers::tax_math::tests::floor_zero_reserve_in ... ok
test helpers::tax_math::tests::floor_zero_reserve_out ... ok
... (26 more tests)
test result: ok. 34 passed; 0 failed
```

**Compilation clean:**

```
cargo check -p tax-program
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s

cargo check -p staking
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.09s
```

(Warnings are Anchor internal cfg warnings, not code issues)

### Human Verification Required

**None.** All verification can be performed programmatically:

1. **Floor enforcement** — grep confirms `MinimumOutputFloorViolation` checks exist before all CPI calls
2. **Event fields** — grep confirms zero instances of `output_amount: 0` or `lp_fee: 0` as placeholders
3. **Balance-diff pattern** — code inspection confirms `.reload()` calls after CPI and `checked_sub` for actual amounts
4. **Compilation** — cargo check passes for both programs
5. **Tests** — 34/34 unit tests pass including 8 new calculate_output_floor tests

The phase goal is fully verifiable from the codebase structure and test suite.

---

## Verification Methodology

**Three-level artifact verification applied:**

1. **Level 1 (Existence):** All 10 artifacts exist at expected paths
2. **Level 2 (Substantive):** 
   - pool_reader.rs: 59 lines, exports read_pool_reserves function
   - calculate_output_floor: 54 lines implementation + 90 lines of unit tests
   - All 4 swap instructions: 15+ line modifications with imports, floor checks, balance-diff patterns
   - No stub patterns (TODO, FIXME, placeholder) found
3. **Level 3 (Wired):**
   - All 4 swap instructions import and call read_pool_reserves + calculate_output_floor
   - All 4 swap instructions use balance-diff pattern for actual output measurement
   - PROFIT swaps additionally read LP fee from pool bytes and emit in events
   - deposit_rewards emits enriched event with escrow_vault fields

**Key link verification:**

Pattern matching confirmed 9/9 critical connections:
- 4 swap instructions × 2 helper calls = 8 floor enforcement links
- 1 staking event enrichment link

All links verified as WIRED (not just imported, but actively used in control flow).

---

## Overall Assessment

**Phase 49 goal ACHIEVED.**

The protocol has:

1. **Operational safety mechanisms:**
   - 50% minimum output floor enforced on all 4 user-facing swap instructions
   - Floor calculation uses safe u128 intermediates (no overflow risk)
   - Hard reject (not silent upgrade) educates users/bots

2. **Escrow reconciliation monitoring:**
   - Existing balance check in deposit_rewards.rs (lines 99-102) remains intact
   - RewardsDeposited event enriched with escrow_vault pubkey and escrow_balance
   - Off-chain dashboards can now filter by vault and verify reconciliation

3. **Comprehensive event emissions:**
   - All swap events emit actual output_amount (balance-diff pattern)
   - PROFIT swap events emit actual lp_fee (read from pool bytes)
   - Zero placeholder values remain in event structs

**No gaps found.** All must-haves verified. Phase ready to proceed to Phase 50.

---

_Verified: 2026-02-20T10:38:12Z_
_Verifier: Claude (gsd-verifier)_
