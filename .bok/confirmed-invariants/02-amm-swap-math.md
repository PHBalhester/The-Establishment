# Confirmed Invariants: AMM Swap Math
**Priority Rank: 2** (critical-path: all token swaps flow through AMM)
**Source:** `programs/amm/src/helpers/math.rs`, `swap_sol_pool.rs`, `swap_profit_pool.rs`
**Confirmed:** 14 invariants | Skipped: 0

---

## P0: No Existing Coverage

### INV-AMM-005: Swap Output Monotonic in Input
- **Tool:** Proptest 100K
- **Property:** For fixed reserves, `input_a <= input_b => output_a <= output_b`
- **Why:** If violated, split attack: two smaller swaps yield more than one large.

### INV-AMM-008: k-Check Symmetry (Phase 52.1 Informed)
- **Tool:** Proptest 100K
- **Property:** verify_k_invariant produces same result regardless of A/B designation
- **Why:** Canonical mint ordering bug (Phase 52.1) could cause asymmetric k-check.

---

## P1: Upgraded to Formal Proofs

### INV-AMM-001: k-Invariant Preservation
- **Tool:** Proptest 100K (upgraded from 10K)
- **Property:** `k_after = (reserve_in + input) * (reserve_out - output) >= k_before`
- **Why:** Foundational AMM safety. k decrease = pool drain.

### INV-AMM-002: Output Bounded by Reserve
- **Tool:** Kani (upgraded from Proptest)
- **Property:** `output < reserve_out` for all valid inputs
- **Why:** Single swap cannot drain pool.

### INV-AMM-003: Fee Never Exceeds Principal
- **Tool:** Kani
- **Property:** `effective_input <= amount_in`
- **Why:** Negative fee would create value from nothing.

### INV-AMM-004: Fee Monotonicity
- **Tool:** Proptest 100K (upgraded from 10K)
- **Property:** Higher fee_bps -> less effective input
- **Why:** Ensures fee revenue is monotonic.

---

## P2: Precision and Edge Cases

### INV-AMM-006: Zero Input -> Zero Output
- **Tool:** Kani
- **Property:** `effective_input(0) == 0`
- **Why:** Prevents free token extraction.

### INV-AMM-007: u128 No Overflow
- **Tool:** Kani (bounded)
- **Property:** All u128 intermediates stay within bounds for valid inputs
- **Why:** Overflow wraps to incorrect output.

### INV-AMM-009: Zero-Fee Precision Loss Caught
- **Tool:** Proptest
- **Property:** When `amount * (10000 - fee) < 10000`, effective = 0, guard rejects
- **Why:** Prevents dust-donation grief attacks.

### INV-AMM-010: Fee Rounding Favors Protocol
- **Tool:** Proptest
- **Property:** Floor division on effective_input means fee rounds UP
- **Why:** Prevents systematic fee leakage.

### INV-AMM-011: Swap Output Rounding Favors Protocol
- **Tool:** Proptest
- **Property:** Floor division on output means user gets slightly less
- **Why:** This is what makes k >= k_before possible.

### INV-AMM-009b: Zero-Output Swap Rejection
- **Tool:** Proptest
- **Property:** `effective_input > 0 AND output == 0` -> reject with ZeroSwapOutput
- **Why:** Prevents burning tokens for nothing.

---

## P3: Structural (LiteSVM)

### INV-AMM-LiteSVM-1: k-Invariant Check Ordering (CEI)
- **Tool:** LiteSVM
- **Property:** k-check at line 171 executes BEFORE token transfers at line 210+
- **Why:** CEI pattern prevents reentrancy via Transfer Hook.

### INV-AMM-LiteSVM-2: Slippage Check Precedes Transfer
- **Tool:** LiteSVM
- **Property:** minimum_amount_out check at line 145 before any CPI
- **Why:** Failed slippage check must not move any tokens.
