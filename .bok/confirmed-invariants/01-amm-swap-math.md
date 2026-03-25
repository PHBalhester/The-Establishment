# AMM Swap Math -- Confirmed Invariants
# Priority Rank: 1 (Critical-path swap functions)

Source: `programs/amm/src/helpers/math.rs`, `programs/amm/src/instructions/swap_sol_pool.rs`

---

## INV-AMM-001: k-Invariant Preservation [CONFIRMED]
- **Tool:** Kani (formal proof over bounded inputs)
- **Priority:** 1 (fundamental safety property)
- **Property:** `new_in * new_out >= reserve_in * reserve_out` after every swap
- **Code:** `verify_k_invariant` at `math.rs:92`
- **Existing:** Proptest (line 400, 10K iter) -- Kani upgrades to exhaustive proof

## INV-AMM-002: Output Bounded by Reserve [CONFIRMED]
- **Tool:** Kani (formal proof over bounded inputs)
- **Priority:** 2
- **Property:** `output < reserve_out` for all valid swaps
- **Code:** `calculate_swap_output` at `math.rs:58`
- **Existing:** Proptest (line 454, 10K iter) -- Kani upgrades to exhaustive proof

## INV-AMM-003: Fee Never Exceeds Principal [CONFIRMED]
- **Tool:** Kani (formal proof over bounded inputs)
- **Priority:** 3 (GAP: no explicit test)
- **Property:** `effective_input <= amount_in`
- **Code:** `calculate_effective_input` at `math.rs:36`
- **Existing:** Implicit only -- Kani provides exhaustive proof

## INV-AMM-004: Fee Monotonicity [CONFIRMED]
- **Tool:** Kani (formal proof -- relational property over two fee_bps values)
- **Priority:** 4
- **Property:** `fee_low <= fee_high => eff_low >= eff_high`
- **Code:** `calculate_effective_input` at `math.rs:36`
- **Existing:** Proptest (line 477, 10K iter) -- Kani upgrades to exhaustive proof

## INV-AMM-005: Zero-Fee Precision Loss [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 5 (GAP: only unit tests at boundary)
- **Property:** `eff == 0 iff amount_in * (10000 - fee_bps) < 10000`
- **Code:** `calculate_effective_input` at `math.rs:36`, `check_effective_input_nonzero` at `math.rs:115`
- **Existing:** Partial -- needs boundary sweep

## INV-AMM-006: u128 Overflow Safety [CONFIRMED]
- **Tool:** Kani (formal proof over bounded inputs)
- **Priority:** 6 (GAP: no systematic edge-case test)
- **Property:** No checked operation returns None for valid inputs
- **Code:** `math.rs:36`, `math.rs:58`
- **Existing:** Partial -- Kani proves no-overflow exhaustively

## INV-AMM-007: k-Invariant Check Ordering (CEI) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 7 (GAP: manual audit only)
- **Property:** k-check at line 171 executes BEFORE token transfers at line 210+
- **Code:** `swap_sol_pool.rs:57`
- **Existing:** Manual audit only

## INV-AMM-008: Slippage Check Precedes Transfer [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 8 (GAP: manual audit only)
- **Property:** `minimum_amount_out` check at line 145 before any CPI
- **Code:** `swap_sol_pool.rs:145`
- **Existing:** Manual audit only

## INV-AMM-009: Zero-Output Swap Rejection [CONFIRMED]
- **Tool:** Proptest
- **Priority:** 9
- **Property:** `effective_input > 0 AND amount_out == 0 => revert`
- **Code:** `check_swap_output_nonzero` at `math.rs:129`
- **Existing:** Partial (unit test)

## INV-AMM-010: Fee Rounding Favors Protocol [CONFIRMED]
- **Tool:** Kani (formal proof -- directional rounding property)
- **Priority:** 10
- **Property:** Floor division on effective_input means fee rounds UP; protocol never undercharges
- **Code:** `calculate_effective_input` at `math.rs:36`
- **Existing:** Implicit via INV-001 -- Kani provides standalone proof

## INV-AMM-011: Swap Output Rounding Favors Protocol [CONFIRMED]
- **Tool:** Kani (formal proof -- directional rounding property)
- **Priority:** 11
- **Property:** Floor division on output means user gets slightly less; dust stays in pool
- **Code:** `calculate_swap_output` at `math.rs:58`
- **Existing:** Implicit via INV-001 -- Kani provides standalone proof
