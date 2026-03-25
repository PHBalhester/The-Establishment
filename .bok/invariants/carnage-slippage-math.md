# Carnage Slippage Math -- Verification Invariants

Source files:
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` (1016 lines)
- `programs/epoch-program/src/instructions/execute_carnage.rs` (1003 lines, fallback)
- `programs/epoch-program/src/constants.rs` (319 lines)
- `programs/tax-program/src/helpers/pool_reader.rs` (85 lines)
- `programs/tax-program/src/helpers/tax_math.rs` (function: `calculate_output_floor`)
- `programs/tax-program/src/constants.rs` (constant: `MINIMUM_OUTPUT_FLOOR_BPS`)

Constants:
- `CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500` (85% floor, 15% tolerance)
- `CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500` (75% floor, 25% tolerance)
- `MAX_CARNAGE_SWAP_LAMPORTS = 1_000_000_000_000` (1000 SOL)
- `MINIMUM_OUTPUT_FLOOR_BPS = 5000` (50% floor for user swaps)

---

## Function Map

| Function | File | Line | Purpose |
|----------|------|------|---------|
| `handler` (atomic) | `execute_carnage_atomic.rs` | 207 | Main Carnage execution bundled with VRF consume |
| `handler` (fallback) | `execute_carnage.rs` | 208 | Fallback Carnage after lock window expires |
| `read_pool_reserves` (atomic) | `execute_carnage_atomic.rs` | 930 | Raw byte read of AMM pool reserves + canonical mint detection |
| `read_pool_reserves` (fallback) | `execute_carnage.rs` | 863 | Identical logic in fallback handler |
| `read_pool_reserves` (tax) | `pool_reader.rs` | 39 | Tax Program's version (no canonical mint detection) |
| `calculate_output_floor` | `tax_math.rs` | 135 | User swap 50% floor computation |

---

## Invariants

### INV-CARN-001: Atomic Slippage Floor (85%)

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:422-438`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** When Carnage executes atomically (bundled with VRF reveal), the actual tokens received must be at least 85% of the expected constant-product output computed from pre-swap pool reserves. If actual < 85% of expected, the transaction reverts with `CarnageSlippageExceeded`.

**Why It Matters:** Without this floor, an MEV bot that learns the VRF result (e.g., from a leaked commitment or a colluding validator) could front-run the Carnage swap with a massive trade that moves the pool price by >15%. The Carnage buy would then execute at a severely degraded price, and the attacker would back-run to capture the spread. The 85% floor limits the maximum extractable value from such an attack to 15% of the Carnage swap amount.

**Formal Property:**
```
Given pre-swap reserves (reserve_sol, reserve_token) where both > 0:

  let expected = reserve_token * total_buy_amount / (reserve_sol + total_buy_amount)
  let min_output = expected * 8500 / 10_000

  => bought >= min_output  OR  transaction reverts
```

**Verification Approach:**
LiteSVM integration test: deploy full protocol, trigger a Carnage event via VRF, then in the same block front-run with a large swap that moves reserves. Verify that the Carnage transaction either (a) succeeds with output >= 85% of pre-manipulation expected, or (b) reverts with `CarnageSlippageExceeded`. The existing unit test at `execute_carnage_atomic.rs:966` validates the math (expected=1000, min=850, 849 fails, 850 passes). Additional LiteSVM test should exercise the full CPI chain.

---

### INV-CARN-002: Fallback Slippage Floor (75%)

**Function:** `handler` (fallback) at `execute_carnage.rs:429-446`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** When Carnage executes via the fallback path (after the 50-slot atomic lock expires), the actual tokens received must be at least 75% of expected output. This is deliberately more lenient than the 85% atomic floor to prioritize execution over optimal price in recovery mode.

**Why It Matters:** The fallback path runs 20+ seconds after the VRF reveal, giving MEV bots ample time to observe the pending Carnage and manipulate pool reserves. The 75% floor accepts up to 25% degradation, which is appropriate because: (1) the fallback only runs if the atomic path failed, and (2) not executing Carnage at all is worse than executing at a 25% discount (SOL would accumulate indefinitely in the vault). An attacker could still extract up to 25% of the Carnage swap, but this is bounded by MAX_CARNAGE_SWAP_LAMPORTS.

**Formal Property:**
```
Given pre-swap reserves (reserve_sol, reserve_token) where both > 0:

  let expected = reserve_token * total_buy_amount / (reserve_sol + total_buy_amount)
  let min_output = expected * 7500 / 10_000

  => bought >= min_output  OR  transaction reverts
```

**Verification Approach:**
Same approach as INV-CARN-001 but targeting the fallback handler. The existing unit test at `execute_carnage.rs:960` validates (expected=1000, min=750). LiteSVM test should verify the lock window timing: during slots 0-50, fallback is rejected (`CarnageLockActive`); during slots 50-300, fallback succeeds with 75% floor; after slot 300, expired.

---

### INV-CARN-003: Fallback Floor Strictly Weaker Than Atomic

**Function:** Constants at `constants.rs:127,132`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** Proptest (unit-level)
**Confidence:** high

**Plain English:** The fallback slippage floor (75%) is always more lenient than the atomic floor (85%). This ordering is critical: if the fallback were tighter, it could reject transactions that the atomic path would have accepted, breaking the recovery model.

**Why It Matters:** The two-tier system exists because the atomic path has a fundamental advantage (VRF result unknown until reveal), while the fallback is vulnerable to front-running. If CARNAGE_SLIPPAGE_BPS_FALLBACK > CARNAGE_SLIPPAGE_BPS_ATOMIC, the system would be backwards -- the less-protected path would have the tighter constraint, potentially causing Carnage to never execute.

**Formal Property:**
```
CARNAGE_SLIPPAGE_BPS_FALLBACK < CARNAGE_SLIPPAGE_BPS_ATOMIC
  => 7500 < 8500  (true)
```

**Verification Approach:**
Existing unit test `test_fallback_more_lenient_than_atomic` at `execute_carnage.rs:972` validates this. This is also a compile-time assertion candidate -- a `const_assert!` would prevent any future code change from inverting the relationship.

---

### INV-CARN-004: MAX_CARNAGE_SWAP_LAMPORTS Cap

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:356,361-364`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The total SOL amount used for a Carnage buy swap is capped at MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL = 1,000,000,000,000 lamports). This cap applies to the COMBINED amount of tax SOL + sell proceeds. Even if the Carnage vault has accumulated 5000 SOL, only 1000 SOL is used per swap.

**Why It Matters:** Without the cap, a Carnage vault that has accumulated excessive SOL (e.g., from a long period of failed triggers) could execute a swap so large it causes >99% slippage and effectively donates most of the SOL to the pool as LP fee. The 1000 SOL cap bounds the maximum price impact per Carnage event. Against the mainnet 1000 SOL pool, a 1000 SOL Carnage buy causes ~50% slippage (documented in liquidity-slippage-analysis.md), which is the worst-case by design.

**Formal Property:**
```
For both atomic and fallback paths:

  let swap_amount = min(available_sol, MAX_CARNAGE_SWAP_LAMPORTS)   // line 356
  let total_buy_amount = min(swap_amount + sol_from_sale, MAX_CARNAGE_SWAP_LAMPORTS)  // line 361-364

  => total_buy_amount <= 1_000_000_000_000
```

**Verification Approach:**
The cap is applied twice (lines 356 and 361-364) with `std::cmp::min`. The first cap bounds the tax SOL portion. The second cap bounds the combined amount after adding sell proceeds. LiteSVM test: fund the Carnage vault with >1000 SOL, trigger Carnage with a Sell action (so sol_from_sale > 0), and verify the total swap never exceeds 1000 SOL.

---

### INV-CARN-005: Sell Proceeds Combined (Not Stranded)

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:358-366`
**Pattern:** VP-001 (Conservation of Value)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** On the Sell path, WSOL received from selling held tokens is combined with freshly-wrapped tax SOL for the buy step. The formula is `total_buy_amount = min(swap_amount + sol_from_sale, MAX_CARNAGE_SWAP_LAMPORTS)`, and only `wrap_amount = total_buy_amount - sol_from_sale` lamports are wrapped (the sell proceeds are already WSOL in carnage_wsol).

**Why It Matters:** A previous bug (fixed in Phase 49, documented in MEMORY.md as "Sell SOL flow fix") caused sell proceeds to be stranded in carnage_wsol. The buy step only wrapped tax SOL and ignored the existing WSOL from the sell. This meant the Carnage fund was systematically underbuying on Sell path, leaving SOL idle. The fix ensures every available lamport (up to the 1000 SOL cap) participates in the buy.

**Formal Property:**
```
On the Sell path where sol_from_sale > 0:

  let total_buy_amount = min(swap_amount + sol_from_sale, MAX)
  let wrap_amount = total_buy_amount.saturating_sub(sol_from_sale)

  => total_buy_amount = wrap_amount + sol_from_sale  (no SOL stranded)
  => wrap_amount <= swap_amount  (never wraps more than available tax SOL)
```

**Verification Approach:**
LiteSVM integration test: Initialize Carnage with held tokens and some tax SOL in the vault. Trigger a Sell-path Carnage event. Verify that the total SOL entering the buy swap equals the sell proceeds plus the wrapped tax SOL. Check that carnage_wsol balance after the transaction matches expectations (should be close to zero, with only rounding dust).

---

### INV-CARN-006: Pool Reserve Reader Correctness

**Function:** `read_pool_reserves` at `execute_carnage_atomic.rs:930-956`
**Pattern:** VP-084 (Intermediate Precision Loss)
**Tool:** LiteSVM
**Confidence:** medium

**Plain English:** The raw byte reader correctly extracts reserve_a (bytes 137-145) and reserve_b (bytes 145-153) from the PoolState account, and correctly swaps them based on canonical mint ordering. If mint_a is WSOL, returns (reserve_a, reserve_b); otherwise (reserve_b, reserve_a).

**Why It Matters:** If the byte offsets are wrong, the slippage check uses garbage reserve values, potentially computing an expected output of 0 (skipping the floor) or an enormous expected output (blocking all Carnage execution). The canonical mint swap is critical because the AMM stores `mint_a < mint_b` (raw byte ordering), so WSOL (which starts with `0x06`) is always mint_a in SOL pools. But if a future pool has different ordering, the detection at line 951 (`pool_mint_a == *wsol_mint_key`) handles it correctly.

**Formal Property:**
```
Given a PoolState account with known layout:
  data[137..145] = reserve_a (little-endian u64)
  data[145..153] = reserve_b (little-endian u64)
  data[9..41] = mint_a (Pubkey)

  If mint_a == WSOL_MINT:
    return (reserve_a, reserve_b)  // (SOL reserve, token reserve)
  Else:
    return (reserve_b, reserve_a)  // (SOL reserve, token reserve)
```

**NOTE:** There are THREE independent copies of this reader:
1. `execute_carnage_atomic.rs:930` (atomic)
2. `execute_carnage.rs:863` (fallback)
3. `tax-program/helpers/pool_reader.rs:39` (tax, no canonical swap)

If byte offsets change in the AMM PoolState struct, all three must be updated. The tax version at `pool_reader.rs` does NOT do canonical mint detection -- it returns raw (reserve_a, reserve_b). This is correct for its use case (the tax program knows which direction the swap is going), but it means the three implementations are NOT identical.

**Verification Approach:**
LiteSVM test: initialize a pool with known reserve values, then call the reader and verify the returned tuple matches. Test both orderings: (a) pool where mint_a == WSOL (standard SOL pool), and (b) a hypothetical pool where WSOL is mint_b. The latter case exercises the `else` branch at line 953. The medium confidence reflects the risk of byte offset drift if the AMM PoolState struct is ever modified.

---

### INV-CARN-007: Slippage Floor Skipped for Empty Pools

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:422`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** medium

**Plain English:** The slippage floor check is only applied when `reserve_sol > 0 && reserve_token > 0`. If either reserve is zero, the slippage check is skipped entirely. This is correct: an empty pool cannot provide a meaningful "expected output" for comparison.

**Why It Matters:** The skip condition prevents a division-by-zero in the expected output calculation (denominator = `reserve_sol + total_buy_amount`; if reserve_sol = 0, this is just total_buy_amount, which is fine, but the expected output would be all of reserve_token, which is 0 -- so min_output = 0, and any bought >= 0 passes). The check is defensive: it avoids computing an expected output in degenerate cases. However, this means a Carnage buy into a completely empty pool bypasses slippage protection. This is acceptable because an empty pool returns 0 tokens anyway.

**Formal Property:**
```
If reserve_sol == 0 OR reserve_token == 0:
  slippage check is NOT applied
  Carnage proceeds regardless of bought amount

If reserve_sol > 0 AND reserve_token > 0:
  slippage check IS applied: bought >= expected * BPS_FLOOR / 10000
```

**Verification Approach:**
LiteSVM test: create a pool with one zero reserve and trigger Carnage. Verify the transaction succeeds without the slippage check. Then verify with non-zero reserves that the check is active. Medium confidence because the skip condition is a potential attack vector in an unusual scenario (e.g., if a pool's reserves are manipulated to zero before Carnage executes -- but this requires draining the pool, which INV-AMM-002 proves impossible).

---

### INV-CARN-008: Slippage Floor Uses Pre-Swap Reserves

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:369-379`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The pool reserves used for the expected output calculation are read BEFORE the swap CPI executes. After the CPI, Solana's runtime updates the AccountInfo data in-place, so reading post-CPI would give post-swap reserves. Pre-swap reserves give the correct "expected" output for slippage comparison.

**Why It Matters:** If post-swap reserves were used to compute "expected" output, the expected would be recalculated based on the already-moved reserves. Since the swap has already happened, `expected` would approximately equal `bought` (both computed from the same state), and the slippage check would always pass trivially. This would make the slippage floor completely useless -- it would never catch manipulation.

**Formal Property:**
```
let (reserve_sol, reserve_token) = read_pool_reserves(target_pool_info)  // line 376-379
// ... wrap_sol_to_wsol (does NOT affect pool reserves) ...
execute_buy_swap(...)  // CPI that changes pool reserves
// After CPI, pool reserves have changed in-place
// But our expected calculation uses the PRE-swap snapshot:
let expected = reserve_token * total_buy_amount / (reserve_sol + total_buy_amount)
```

**Verification Approach:**
LiteSVM test: read pool reserves before and after a Carnage swap CPI. Verify that the `expected` value in the slippage check corresponds to the pre-swap reserves, not the post-swap reserves. This can be validated by computing the expected output independently from known pre-swap reserves and comparing it against the actual `min_output` value (observable via transaction logs).

---

### INV-CARN-009: User Swap 50% Floor (Tax Program)

**Function:** `calculate_output_floor` at `tax_math.rs:135`
**Pattern:** VP-002 (Slippage Bound), VP-004 (Minimum Output Enforcement)
**Tool:** Proptest
**Confidence:** high

**Plain English:** All user-facing swaps (buy, sell, PROFIT pool) enforce that the user's `minimum_amount_out` parameter is at least 50% of the expected constant-product output. If the user provides a lower minimum, the transaction reverts with `TaxError::MinimumOutputFloorViolation`.

**Why It Matters:** Without this floor, a user (or bot) could set `minimum_amount_out = 0`, accepting any output including zero. This makes sandwich attacks trivially profitable: an attacker front-runs the user's swap to move the price, the user's swap executes at the degraded price (accepted because min = 0), and the attacker back-runs to capture the spread. The 50% floor forces users to accept at most 50% slippage, making sandwich attacks require moving the pool price by >50% (which requires swapping more than the entire input reserve -- economically prohibitive).

**Formal Property:**
```
For all user swaps (buy, sell, profit_buy, profit_sell):

  let expected = reserve_out * amount_in / (reserve_in + amount_in)
  let floor = expected * 5000 / 10_000

  => minimum_amount_out >= floor  OR  transaction reverts

Note: amount_in is post-tax for buys (sol_to_swap), and pre-AMM for sells.
```

**Verification Approach:**
The `calculate_output_floor` function is called in four swap handlers:
- `swap_sol_buy.rs:106` (with `sol_to_swap`, post-tax input)
- `swap_sol_sell.rs:113` (with `amount_in`, the raw token amount)
- `swap_profit_buy.rs:84`
- `swap_profit_sell.rs:76`

Proptest at tax_math.rs tests cover the pure function. LiteSVM integration tests should submit swaps with `minimum_amount_out = 0` and verify rejection.

---

### INV-CARN-010: Slippage BPS Overflow Safety

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:423-433`
**Pattern:** VP-015 (BPS Overflow), VP-084 (Intermediate Precision Loss)
**Tool:** Proptest
**Confidence:** high

**Plain English:** The slippage floor computation uses u128 intermediates throughout. The maximum expected output is bounded by `reserve_token` (a u64), and multiplying by `CARNAGE_SLIPPAGE_BPS_ATOMIC` (8500, also fitting in u64) cannot overflow u128. The division by 10_000 is safe.

**Why It Matters:** If the computation used u64 intermediates, `expected * 8500` could overflow for large reserve values. For example, `expected = 18_000_000_000_000_000_000` (u64::MAX vicinity) * 8500 = 1.53e23, which exceeds u64::MAX (1.8e19). This would wrap to a small number, causing `min_output` to be near zero, and the slippage check would pass trivially -- defeating its purpose.

**Formal Property:**
```
For all (reserve_token: u64, total_buy_amount: u64, reserve_sol: u64) where
  reserve_sol > 0, reserve_token > 0:

  let expected = (reserve_token as u128) * (total_buy_amount as u128)
                 / ((reserve_sol as u128) + (total_buy_amount as u128))
  // expected <= reserve_token <= u64::MAX

  let min_output = expected * 8500 / 10_000
  // min_output <= u64::MAX * 8500 / 10_000 <= u64::MAX * 0.85 -- fits in u64

  => No overflow in any intermediate step
```

**Verification Approach:**
The existing unit test `test_slippage_floor_handles_large_values` at `execute_carnage_atomic.rs:983` tests with `expected = 1_000_000_000_000`. Proptest should cover `reserve_token = u64::MAX` and `total_buy_amount = MAX_CARNAGE_SWAP_LAMPORTS` to exercise the maximum practical values. All intermediate values fit in u128 by construction (u64 * u64 < u128).

---

### INV-CARN-011: Carnage Expected Output Excludes LP Fee

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:423-428`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** medium

**Plain English:** The Carnage slippage check computes "expected" output using the raw constant-product formula WITHOUT deducting the 1% LP fee. The actual swap (executed via CPI to swap_exempt -> AMM swap) DOES deduct the LP fee. This means the actual output is always ~1% less than the raw expected, so the effective tolerance is `floor% + ~1%` (i.e., the 85% floor effectively allows ~16% total deviation).

**Why It Matters:** This is a design choice, not a bug. Computing expected WITH the LP fee would tighten the floor to exactly 85% of post-fee output, leaving only 15% tolerance for manipulation. By computing WITHOUT the fee, the effective tolerance is ~16%, which is deliberately more lenient. This prevents legitimate Carnage swaps from failing due to the predictable 1% LP fee gap. However, it does mean an attacker gets slightly more room to manipulate.

**Formal Property:**
```
let expected_raw = reserve_token * total_buy_amount / (reserve_sol + total_buy_amount)
// Actual AMM uses: effective = total_buy_amount * 9900 / 10000, then output formula
// So actual_output < expected_raw (by ~1% from LP fee + rounding)

let min_output = expected_raw * 8500 / 10_000

// For min_output to be satisfied:
// actual_output >= expected_raw * 0.85
// But actual_output ~= expected_raw * 0.99 (from LP fee alone)
// So the check passes comfortably absent manipulation
// Manipulation headroom: 0.99 - 0.85 = 0.14 (14% of expected_raw)
```

**Verification Approach:**
LiteSVM test: execute a Carnage swap with no external manipulation and measure `bought / expected_raw`. It should be approximately 0.99 (only the LP fee reduces it). Verify `bought >= min_output` passes easily. Then inject manipulation to push the ratio below 0.85 and verify rejection.

---

### INV-CARN-012: Vault Balance Delta for Tokens Bought

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:388-414`
**Pattern:** VP-001 (Conservation of Value)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Tokens bought is measured as `target_vault_after - target_vault_before`, using Anchor `.reload()` to get fresh on-chain balances after CPI. The vault is reloaded BEFORE the buy (step 1.5 at line 344-347, to handle burn-then-buy-same-token) and AFTER the buy (line 400-409).

**Why It Matters:** If the target vault is the same one that was just burned from (e.g., Carnage holds CRIME, burns it, then buys CRIME), the pre-burn balance would be stale without the step 1.5 reload. The `tokens_bought` calculation would see `post_buy_balance - stale_pre_burn_balance`, which could underflow (since the burn reduced the balance) or compute an incorrect amount. Step 1.5 ensures `target_vault_before` reflects the post-burn state.

**Formal Property:**
```
For the Burn + Buy (same token) path:
  step 1: burn X tokens from vault -> vault.balance decreases by X
  step 1.5: reload vault -> target_vault_before = vault.balance (post-burn)
  step 2: buy Y tokens -> vault.balance increases by Y
  reload again -> target_vault_after = vault.balance (post-buy)

  tokens_bought = target_vault_after - target_vault_before = Y  (correct)

Without step 1.5:
  target_vault_before = vault.balance (pre-burn, stale)
  tokens_bought = target_vault_after - stale_balance
                = (original - X + Y) - original
                = Y - X  (WRONG if X > Y, underflow!)
```

**Verification Approach:**
LiteSVM test: trigger a Burn + Buy path where the target and held token are the same. Verify `tokens_bought` equals the actual increase in vault balance (Y), not Y - X. This directly tests the step 1.5 reload fix.

---

### INV-CARN-013: Rent-Exempt Minimum Preserved

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:352-355`
**Pattern:** VP-001 (Conservation of Value)
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Before wrapping SOL for the buy step, the handler computes `available_sol = sol_balance - rent_exempt_min` (using saturating_sub to avoid underflow). This ensures the sol_vault PDA always retains at least the rent-exempt minimum, preventing the account from being garbage-collected by the Solana runtime.

**Why It Matters:** If the handler transferred ALL lamports from sol_vault (including rent-exempt), the SystemAccount PDA would be closed by the runtime at the end of the transaction. On the next epoch, Carnage would fail because the sol_vault account no longer exists. Re-creating it requires a separate transaction and someone willing to fund it. The `saturating_sub` ensures that if sol_balance <= rent_exempt_min, available_sol = 0 and no wrap occurs -- the vault survives.

**Formal Property:**
```
let available_sol = sol_balance.saturating_sub(rent_exempt_min)  // line 355
let swap_amount = min(available_sol, MAX_CARNAGE_SWAP_LAMPORTS)   // line 356

// After wrap:
// sol_vault.lamports() >= rent_exempt_min  (if wrap_amount <= available_sol)
// Actually: sol_vault.lamports() = sol_balance - wrap_amount
//   where wrap_amount <= total_buy_amount - sol_from_sale <= available_sol
//   so sol_vault.lamports() >= sol_balance - available_sol = rent_exempt_min
```

**Verification Approach:**
LiteSVM test: set sol_vault balance to exactly rent_exempt_min + 1 lamport. Trigger Carnage. Verify that exactly 1 lamport is wrapped, and the vault retains rent_exempt_min. Then test with sol_vault balance = rent_exempt_min - 1. Verify available_sol = 0 and no wrap occurs.

---

### INV-CARN-014: Sell Path Has No Slippage Floor

**Function:** `handler` (atomic) at `execute_carnage_atomic.rs:289-331`
**Pattern:** VP-002 (Slippage Bound)
**Tool:** LiteSVM
**Confidence:** medium

**Plain English:** The Carnage sell step (selling held tokens for WSOL) does NOT have its own slippage floor check. Only the buy step (SOL -> target token) is checked against the 85%/75% floor. The sell step relies solely on the AMM-level slippage floor (`swap_exempt` -> AMM -> `minimum_amount_out`, which is set to 0 for exempt swaps).

**Why It Matters:** Without a sell-side slippage floor, an attacker who can predict a Sell-path Carnage (2% probability) could manipulate the held-token/SOL pool to give Carnage minimal WSOL for its tokens. The sell proceeds (`sol_from_sale`) would be much less than fair value. However, this is partially mitigated by: (1) the buy step floor catches the combined effect, (2) VRF unpredictability makes predicting Sell path nearly impossible, and (3) the sell is against the held token's pool, which is different from the target token's pool.

**Formal Property:**
```
Sell step: No explicit require!(sol_from_sale >= X) check.
Buy step: require!(bought >= expected * FLOOR_BPS / 10000)

The buy step's pre-swap reserves are read from the TARGET pool, not the held pool.
So manipulation of the held pool (affecting sell proceeds) is NOT detected by the
buy-side slippage check.
```

**NOTE:** This is a potential gap. If `sol_from_sale` is manipulated to near-zero, `total_buy_amount` is smaller, and the buy step produces fewer tokens -- but the buy-side floor check uses the TARGET pool reserves, which were NOT manipulated. So `expected` is computed from clean reserves, and `min_output = expected * 0.85` could exceed `bought` (computed from a smaller `total_buy_amount`). This would REJECT the Carnage, not allow a bad trade. The attacker causes Carnage failure, not extraction. This is denial-of-service, not theft.

**Verification Approach:**
LiteSVM test: manipulate the held-token pool's reserves before a Sell-path Carnage. Measure `sol_from_sale` and verify it's degraded. Then check whether the buy step passes or fails the slippage check. Document whether the failure mode is rejection (safe) or acceptance at bad price (unsafe).

---

## Summary Table

| ID | Name | Pattern | Tool | Confidence | Existing Coverage |
|----|------|---------|------|------------|-------------------|
| INV-CARN-001 | Atomic Slippage Floor (85%) | VP-002 | LiteSVM | high | Unit test (line 966) |
| INV-CARN-002 | Fallback Slippage Floor (75%) | VP-002 | LiteSVM | high | Unit test (line 960) |
| INV-CARN-003 | Fallback Weaker Than Atomic | VP-002 | Proptest | high | Unit test (line 972) |
| INV-CARN-004 | MAX_CARNAGE_SWAP Cap | VP-002 | LiteSVM | high | None (structural) |
| INV-CARN-005 | Sell Proceeds Combined | VP-001 | LiteSVM | high | None (regression) |
| INV-CARN-006 | Pool Reserve Reader | VP-084 | LiteSVM | medium | None |
| INV-CARN-007 | Skip for Empty Pools | VP-002 | LiteSVM | medium | None |
| INV-CARN-008 | Pre-Swap Reserve Snapshot | VP-002 | LiteSVM | high | None (structural) |
| INV-CARN-009 | User 50% Floor (Tax) | VP-002, VP-004 | Proptest | high | Unit tests (tax_math) |
| INV-CARN-010 | Slippage BPS Overflow | VP-015, VP-084 | Proptest | high | Unit test (line 983) |
| INV-CARN-011 | Expected Excludes LP Fee | VP-002 | LiteSVM | medium | None |
| INV-CARN-012 | Vault Balance Delta | VP-001 | LiteSVM | high | None (regression) |
| INV-CARN-013 | Rent-Exempt Preserved | VP-001 | LiteSVM | high | None |
| INV-CARN-014 | Sell Path No Slippage Floor | VP-002 | LiteSVM | medium | None |

### Coverage Gaps (Priority Order)

1. **INV-CARN-005** (Sell Proceeds Combined): This was a past bug. No automated regression test exists. High priority because it's a known-broken code path.
2. **INV-CARN-012** (Vault Balance Delta / Step 1.5 Reload): Another past bug fix with no regression test. The burn-then-buy-same-token path is the critical case.
3. **INV-CARN-014** (Sell Path No Floor): This is a design gap, not a bug. But the analysis shows the failure mode is denial-of-service (Carnage rejection), not fund theft. Document this as accepted risk or add a sell-side floor.
4. **INV-CARN-006** (Pool Reserve Reader): Three independent copies of the byte reader with no shared code. A change in AMM PoolState layout would silently break all three. Consider extracting to a shared crate or adding a cross-program layout test.
5. **INV-CARN-008** (Pre-Swap Snapshot): The ordering is correct in the code but has no test that verifies it. A test that checks `expected` against known pre-swap values would prevent regression.
6. **INV-CARN-013** (Rent-Exempt): No test verifies the vault survives after Carnage execution.
7. **INV-CARN-011** (Expected Excludes LP Fee): The ~1% LP fee gap is by design but not documented as a conscious tolerance widener. This analysis is the first documentation.

### Cross-Invariant Dependencies

- INV-CARN-001/002 depend on INV-AMM-001 (k-invariant): the AMM must correctly compute output for the slippage comparison to be meaningful.
- INV-CARN-008 depends on Solana runtime behavior: AccountInfo data is updated in-place after CPI. This is a documented Solana behavior but not something the program can verify.
- INV-CARN-009 depends on INV-AMM-002 (output < reserve): the 50% floor uses the same constant-product formula. If the AMM formula were broken, the floor would also compute incorrect values.
