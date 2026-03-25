# Confirmed: Carnage Slippage Math
# Priority Rank: 3 (critical-path -- Carnage execution, two past-bug regressions)
# Invariants: 14 confirmed, 0 skipped

Source: `execute_carnage_atomic.rs`, `execute_carnage.rs`, `pool_reader.rs`, `tax_math.rs`

---

## Proptest Invariants (3)

### INV-CARN-003: Fallback Floor Strictly Weaker Than Atomic [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** `CARNAGE_SLIPPAGE_BPS_FALLBACK < CARNAGE_SLIPPAGE_BPS_ATOMIC` (7500 < 8500)
- **Code ref:** `constants.rs:127,132`

### INV-CARN-009: User Swap 50% Floor [PRIORITY: P2]
- **Tool:** Proptest
- **Property:** `minimum_amount_out >= expected * 5000 / 10000` enforced on all user swaps
- **Code ref:** `tax_math.rs:135`, called in 4 swap handlers

### INV-CARN-010: Slippage BPS Overflow Safety [PRIORITY: P3]
- **Tool:** Proptest
- **Property:** All intermediates fit u128; no overflow in floor computation
- **Code ref:** `execute_carnage_atomic.rs:423-433`

---

## LiteSVM Invariants (11)

### INV-CARN-001: Atomic Slippage Floor (85%) [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** `bought >= expected * 8500 / 10000` or transaction reverts
- **Code ref:** `execute_carnage_atomic.rs:422-438`

### INV-CARN-002: Fallback Slippage Floor (75%) [PRIORITY: P1]
- **Tool:** LiteSVM
- **Property:** `bought >= expected * 7500 / 10000` or transaction reverts
- **Code ref:** `execute_carnage.rs:429-446`

### INV-CARN-004: MAX_CARNAGE_SWAP_LAMPORTS Cap [PRIORITY: P2]
- **Tool:** LiteSVM
- **Property:** `total_buy_amount <= 1_000_000_000_000` always
- **Code ref:** `execute_carnage_atomic.rs:356,361-364`

### INV-CARN-005: Sell Proceeds Combined (Not Stranded) [PRIORITY: P1 -- PAST BUG REGRESSION]
- **Tool:** LiteSVM
- **Property:** `total_buy_amount = wrap_amount + sol_from_sale` (no SOL stranded)
- **Code ref:** `execute_carnage_atomic.rs:358-366`

### INV-CARN-006: Pool Reserve Reader Correctness [PRIORITY: P2]
- **Tool:** LiteSVM
- **Property:** Byte offsets 137-145, 145-153 correct; canonical mint swap works
- **Code ref:** `execute_carnage_atomic.rs:930-956` (3 independent copies)

### INV-CARN-007: Slippage Floor Skipped for Empty Pools [PRIORITY: P4]
- **Tool:** LiteSVM
- **Property:** Zero reserves skip slippage check; nonzero applies it
- **Code ref:** `execute_carnage_atomic.rs:422`

### INV-CARN-008: Slippage Floor Uses Pre-Swap Reserves [PRIORITY: P2]
- **Tool:** LiteSVM
- **Property:** Expected output computed from reserves BEFORE swap CPI
- **Code ref:** `execute_carnage_atomic.rs:369-379`

### INV-CARN-011: Carnage Expected Output Excludes LP Fee [PRIORITY: P4]
- **Tool:** LiteSVM
- **Property:** Effective tolerance = floor% + ~1% LP fee gap (by design)
- **Code ref:** `execute_carnage_atomic.rs:423-428`

### INV-CARN-012: Vault Balance Delta (Step 1.5 Reload) [PRIORITY: P1 -- PAST BUG REGRESSION]
- **Tool:** LiteSVM
- **Property:** `tokens_bought = post_buy - post_burn` (not post_buy - pre_burn)
- **Code ref:** `execute_carnage_atomic.rs:388-414`

### INV-CARN-013: Rent-Exempt Minimum Preserved [PRIORITY: P2]
- **Tool:** LiteSVM
- **Property:** `sol_vault.lamports() >= rent_exempt_min` after Carnage wrap
- **Code ref:** `execute_carnage_atomic.rs:352-355`

### INV-CARN-014: Sell Path Has No Slippage Floor [PRIORITY: P4]
- **Tool:** LiteSVM
- **Property:** Document: sell-side manipulation causes rejection (DoS), not extraction
- **Code ref:** `execute_carnage_atomic.rs:289-331`
