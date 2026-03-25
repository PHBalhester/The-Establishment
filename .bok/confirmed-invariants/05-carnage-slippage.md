# Confirmed Invariants: Carnage Slippage & Execution
**Priority Rank: 5** (critical-path: deflationary mechanism + MEV protection)
**Source:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`, `execute_carnage.rs`, `tax_math.rs`
**Confirmed:** 24 invariants | Skipped: 0

---

## P0: Regression Tests (Past Bugs, No Automated Test)

### INV-CARN-005 / B-014: Sell Proceeds Combined (Not Stranded)
- **Tool:** LiteSVM
- **Property:** `total_buy_amount = swap_amount + sol_from_sale`, wrap only tax portion
- **Why:** Was an actual bug (Feb 2026). Sell WSOL was stranded in carnage_wsol.

### INV-CARN-012 / B-018: Vault Balance Delta (Step 1.5 Reload)
- **Tool:** LiteSVM
- **Property:** tokens_bought = target_vault_after - target_vault_before (post-burn reload)
- **Why:** Past bug: burn-then-buy same token caused stale pre-burn balance.

### INV-CARN-B-016: Burn-Then-Buy Vault Delta
- **Tool:** LiteSVM
- **Property:** On BuyOnly+Burn path, vault SOL decreases by exactly buy amount
- **Why:** Regression for 6-path Carnage fix.

---

## P1: No Existing Coverage (Critical)

### INV-CARN-B-010: Combined SOL Capping
- **Tool:** Kani
- **Property:** `min(swap_amount + sol_from_sale, MAX) <= vault_balance`
- **Why:** Overflow or exceeding vault = CPI failure or incorrect amounts.

### INV-CARN-B-011: wrap_amount Never Exceeds Available SOL
- **Tool:** Proptest
- **Property:** Only tax portion wrapped; sell WSOL already in account
- **Why:** Double-counting SOL = wrap CPI failure.

### INV-CARN-008: Pre-Swap Reserve Snapshot
- **Tool:** LiteSVM
- **Property:** Expected output computed from reserves BEFORE swap CPI
- **Why:** Post-swap reserves make slippage check trivially pass (useless).

### INV-CARN-013 / B-015: Rent-Exempt Preserved
- **Tool:** LiteSVM
- **Property:** `sol_vault.lamports() >= rent_exempt_min` after all operations
- **Why:** Below rent-exempt -> account garbage collected -> irrecoverable.

### INV-CROSS-017: Carnage/AMM Formula Consistency
- **Tool:** Proptest 100K
- **Property:** Carnage expected output matches AMM's actual formula
- **Why:** Different formulas -> floor based on wrong expectations.

---

## P2: Existing Unit Tests (Upgraded)

### INV-CARN-001: Atomic Slippage Floor (85%)
- **Tool:** LiteSVM
- **Property:** `bought >= expected * 8500 / 10000` or revert
- **Why:** MEV protection for atomic VRF+Carnage.

### INV-CARN-002: Fallback Slippage Floor (75%)
- **Tool:** LiteSVM
- **Property:** `bought >= expected * 7500 / 10000` or revert
- **Why:** More lenient for fallback (post-lock-window).

### INV-CARN-003: Fallback Strictly Weaker Than Atomic
- **Tool:** Proptest
- **Property:** `7500 < 8500`
- **Why:** Inverted floors break recovery model.

### INV-CARN-004: MAX_CARNAGE_SWAP Cap (1000 SOL)
- **Tool:** LiteSVM
- **Property:** Total swap never exceeds 1,000,000,000,000 lamports
- **Why:** Unbounded swap = catastrophic slippage.

### INV-CARN-009: User Swap 50% Floor
- **Tool:** Proptest
- **Property:** User's minimum_amount_out >= 50% of expected output
- **Why:** Anti-sandwich protection.

### INV-CARN-010 / B-013: Slippage BPS Overflow Safety
- **Tool:** Proptest / Kani
- **Property:** `expected * 8500` uses u128, no overflow
- **Why:** u64 overflow -> tiny floor -> slippage check useless.

### INV-CARN-B-009: 85% Floor Math Accuracy
- **Tool:** Proptest 100K
- **Property:** `|floor_int - expected * 0.85| < 1.0`
- **Why:** Rounding correctness.

---

## P3: Design Properties

### INV-CARN-006 / B-012: Pool Reserve Reader Byte Alignment
- **Tool:** LiteSVM
- **Property:** Bytes [137..145] and [145..153] match AMM PoolState layout
- **Why:** 3 independent copies of byte reader — AMM struct change breaks all silently.

### INV-CARN-007: Slippage Floor Skipped for Empty Pools
- **Tool:** LiteSVM
- **Property:** reserve_sol=0 or reserve_token=0 -> skip floor check
- **Why:** Defensive — empty pool can't provide expected output.

### INV-CARN-011: Expected Output Excludes LP Fee
- **Tool:** LiteSVM
- **Property:** Expected uses raw constant-product (no fee deduction)
- **Why:** By design: effective tolerance = floor% + ~1% LP fee.

### INV-CARN-014: Sell Path Has No Slippage Floor
- **Tool:** LiteSVM
- **Property:** Only buy step checked. Failure mode is DoS (rejection), not theft.
- **Why:** Document as accepted risk.

### INV-CROSS-018: Post-Fee Output Passes Floor in Normal Conditions
- **Tool:** Proptest 100K
- **Property:** Actual output (~99% of expected) >= 85% floor without manipulation
- **Why:** Ensures LP fee doesn't trigger false slippage rejection.
