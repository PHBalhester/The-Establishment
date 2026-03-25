# Confirmed Invariants: Bonding Curve
**Priority Rank: 1** (critical-path: main token sale mechanism)
**Source:** `programs/bonding_curve/src/math.rs`, `purchase.rs`, `sell.rs`
**Confirmed:** 14 invariants | Skipped: 0

---

## P0: No Existing Coverage (highest priority)

### INV-BC-010: Split-Buy Exploit Prevention (Sub-Additivity)
- **Tool:** Proptest
- **Property:** `tokens_out(A+B, pos) >= tokens_out(A, pos) + tokens_out(B, pos+t1)`
- **Why:** Known DeFi exploit vector. Floor division could allow split purchases to yield more tokens.

### INV-BC-003: Input Monotonicity (More SOL -> More Tokens)
- **Tool:** Kani
- **Property:** `sol_a < sol_b => tokens_out(sol_a) <= tokens_out(sol_b)` for fixed position
- **Why:** If violated, enables split attack (pay more, get less).

### INV-BC-008: Partial Fill SOL Recalculation
- **Tool:** Proptest
- **Property:** When partial fill occurs, `actual_sol_charged <= original_sol_amount`
- **Why:** User never overpays for partial fill at curve end.

### INV-BC-013: Wallet Cap Not Bypassed via Partial Fill
- **Tool:** Kani
- **Property:** `existing_balance + actual_tokens <= WALLET_CAP` even during partial fill
- **Why:** Cap check must account for post-partial-fill balance.

---

## P1: Strengthened from Existing Coverage

### INV-BC-001: Round-Trip Value Non-Creation
- **Tool:** Kani
- **Property:** Buy X SOL worth of tokens, sell them -> receive <= X SOL (after 15% tax)
- **Why:** Prevents vault drain via buy-sell loops.

### INV-BC-002: Price Monotonicity
- **Tool:** Kani
- **Property:** `get_current_price(a) <= get_current_price(b)` for `a < b`
- **Why:** Non-monotonic pricing enables arbitrage.

### INV-BC-007: Vault Solvency After Buy/Sell Sequences
- **Tool:** Proptest (multi-tx sequences, up to 100 ops)
- **Property:** `vault_balance >= integral(0, tokens_sold)` after any sequence
- **Why:** Global solvency guarantee. Existing test only covers single tx.

### INV-BC-009: Buy+Sell Conservation (Full Range)
- **Tool:** Proptest
- **Property:** Buy then sell returns strictly less SOL, across full curve range
- **Why:** Extends INV-BC-001 to statistical coverage of entire domain.

---

## P2: Overflow and Precision

### INV-BC-005: Sell Tax Ceil >= Floor
- **Tool:** Kani
- **Property:** `ceil_tax(x) >= floor_tax(x)` for all valid x
- **Why:** Protocol never undercharges tax.

### INV-BC-006: Sell Tax No Overflow
- **Tool:** Kani
- **Property:** `sol_gross * 1500 + 9999` fits u64 for all valid amounts
- **Why:** Overflow would produce tiny tax, draining protocol.

### INV-BC-012: u128 PRECISION No Overflow
- **Tool:** Kani
- **Property:** All u128 intermediates in calculate_tokens_out stay within bounds
- **Why:** Silent overflow wraps to incorrect token amounts.

### INV-BC-011: Price Accuracy vs Float Reference
- **Tool:** Proptest
- **Property:** Integer price within 0.01% of expected float price
- **Why:** Verifies PRECISION scaling doesn't introduce significant error.

---

## P3: Integration

### INV-BC-004: Full Integral Bounds
- **Tool:** Proptest
- **Property:** Total SOL for all tokens = TARGET_SOL ± 0.1%
- **Why:** Economic model correctness.

### INV-BC-014: Solvency Assertion Correctness (On-Chain)
- **Tool:** LiteSVM
- **Property:** sell.rs assertion fires before SOL leaves vault, checks correct post-sell value
- **Why:** Last line of defense against insolvency.
