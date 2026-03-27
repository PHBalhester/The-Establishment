# SOS Diff-Audit: convert_v2 Instruction

**Audit date:** 2026-03-26
**Auditor:** SOS (Stronghold of Security) v1.4 -- targeted diff review
**Scope:** convert_v2 changes only (Phase 106-01, commits ba922cd + 34d015e)
**Methodology:** Targeted diff-audit with line-by-line cross-reference against proven convert handler

---

## Scope

### Files Under Review (New/Changed)

| File | Change Type | Lines Changed |
|------|-------------|---------------|
| `programs/conversion-vault/src/instructions/convert_v2.rs` | NEW (full review) | 87 lines |
| `programs/conversion-vault/src/error.rs` | DIFF (+6 lines) | 2 new variants appended |
| `programs/conversion-vault/src/lib.rs` | DIFF (+12 lines) | 1 new instruction registration |
| `programs/conversion-vault/src/instructions/mod.rs` | DIFF (+1 line) | 1 new module export |

### Cross-Reference File (Proven, Battle-Tested)

| File | Purpose |
|------|---------|
| `programs/conversion-vault/src/instructions/convert.rs` | Existing handler -- gold standard for transfer logic comparison |

### Out of Scope

- `programs/conversion-vault/src/constants.rs` (unchanged)
- `programs/conversion-vault/src/state.rs` (unchanged)
- `programs/conversion-vault/src/helpers/hook_helper.rs` (unchanged)
- `programs/conversion-vault/tests/bok_proptest_vault.rs` (test-only, no security impact)
- Client-side code (separate audit scope)

---

## Checklist Findings

### 1. Owner Check Correctness

**Verdict: PASS**

**convert_v2.rs lines 16-20:**
```rust
require!(
    ctx.accounts.user_input_account.owner == ctx.accounts.user.key(),
    VaultError::InvalidOwner
);
```

**Analysis:**

- The check verifies that `user_input_account.owner` (the SPL Token account's `owner` field -- i.e., the wallet that can authorize transfers FROM this account) equals `user.key()` (the transaction signer).
- This check executes at line 17, BEFORE the balance reading at line 24 (`ctx.accounts.user_input_account.amount`). Ordering is correct -- ownership is validated before any state-dependent logic.
- **Attack scenario prevented:** Without this check, an attacker could pass victim's token account as `user_input_account`, set `amount_in=0` (convert-all sentinel), and the vault would read the victim's balance and transfer their entire token holdings. The owner check blocks this because the attacker is the signer (`user`), not the victim.
- **Why existing `convert` does NOT need this check:** The old `convert` instruction uses a caller-specified `amount_in > 0`. The user-signed transfer at line 145 (`helpers::hook_helper::transfer_t22_checked` with `&ctx.accounts.user.to_account_info()` as authority) enforces ownership inherently -- Token-2022 will reject the transfer if `user` is not the token account's owner. With convert_v2's sentinel mode, the transfer amount is derived from the account's balance, so ownership must be checked explicitly before balance reading.
- **Edge case: `amount_in > 0` path in convert_v2:** The owner check runs unconditionally (line 17), even when `amount_in > 0`. This is a defense-in-depth measure -- no harm, slight CU cost (~200 CU for the comparison). If a user passes `amount_in > 0` with someone else's token account, the owner check catches it before the transfer would have caught it anyway. Net effect: earlier, clearer error message.

**No issues found.**

---

### 2. Sentinel Safety (amount_in == 0)

**Verdict: PASS**

**convert_v2.rs lines 23-29:**
```rust
let effective_amount = if amount_in == 0 {
    let balance = ctx.accounts.user_input_account.amount;
    require!(balance > 0, VaultError::ZeroAmount);
    balance
} else {
    amount_in
};
```

**Analysis -- edge case matrix:**

| Scenario | amount_in | balance | Result | Correct? |
|----------|-----------|---------|--------|----------|
| Convert-all, normal balance | 0 | 1,000,000 | effective_amount = 1,000,000 | YES |
| Convert-all, zero balance | 0 | 0 | ZeroAmount error (line 25) | YES |
| Convert-all, dust < 100 (faction->PROFIT) | 0 | 50 | effective_amount = 50, then compute_output returns OutputTooSmall | YES |
| Convert-all, dust < 100 (PROFIT->faction) | 0 | 50 | effective_amount = 50, compute_output returns 50 * 100 = 5000 | YES (multiplication always succeeds for small values) |
| Exact amount, normal | 500 | (irrelevant) | effective_amount = 500 | YES |
| Exact amount = 1 | 1 | (irrelevant) | effective_amount = 1 | YES |

- **`amount_in == 0` is a safe sentinel:** In the existing `convert` handler, `amount_in == 0` would reach `compute_output_with_mints` which returns `ZeroAmount` error at line 98 of convert.rs. The sentinel in convert_v2 intercepts this case before `compute_output` is called, reading balance instead. If balance is also 0, the same `ZeroAmount` error is returned. There is no ambiguity or unexpected state.
- **Cannot be exploited for free conversions:** amount_in=0 does NOT mean "convert zero tokens." It means "read my balance." If the balance is zero, the instruction fails. If the balance is positive, the full balance is converted. The transfer helper (`transfer_t22_checked`) also has its own `require!(amount > 0)` defense-in-depth check (hook_helper.rs line 41).
- **u64 balance cannot be negative:** Solana token account balances are unsigned 64-bit integers. No underflow risk.

**No issues found.**

---

### 3. Transfer Equivalence (convert_v2 vs convert)

**Verdict: PASS**

Line-by-line comparison of the transfer logic:

#### Split at midpoint:

| convert.rs (lines 140-142) | convert_v2.rs (lines 53-55) | Match? |
|---|---|---|
| `let remaining = ctx.remaining_accounts;` | `let remaining = ctx.remaining_accounts;` | IDENTICAL |
| `let mid = remaining.len() / 2;` | `let mid = remaining.len() / 2;` | IDENTICAL |
| `let (input_hooks, output_hooks) = remaining.split_at(mid);` | `let (input_hooks, output_hooks) = remaining.split_at(mid);` | IDENTICAL |

#### Input transfer (user -> vault):

| convert.rs (lines 145-155) | convert_v2.rs (lines 57-67) | Match? |
|---|---|---|
| `helpers::hook_helper::transfer_t22_checked(` | `helpers::hook_helper::transfer_t22_checked(` | IDENTICAL |
| `&ctx.accounts.token_program.to_account_info(),` | `&ctx.accounts.token_program.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.user_input_account.to_account_info(),` | `&ctx.accounts.user_input_account.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.input_mint.to_account_info(),` | `&ctx.accounts.input_mint.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.vault_input.to_account_info(),` | `&ctx.accounts.vault_input.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.user.to_account_info(),` | `&ctx.accounts.user.to_account_info(),` | IDENTICAL |
| `amount_in,` | `effective_amount,` | DIFFERS (intentional: effective_amount replaces amount_in) |
| `TOKEN_DECIMALS,` | `TOKEN_DECIMALS,` | IDENTICAL |
| `&[],` | `&[],` | IDENTICAL |
| `input_hooks,` | `input_hooks,` | IDENTICAL |

**The only difference** is the amount parameter: convert uses `amount_in` (caller-specified), convert_v2 uses `effective_amount` (either caller-specified or balance-read). This is the intended behavioral difference.

#### Output transfer (vault -> user):

| convert.rs (lines 158-171) | convert_v2.rs (lines 70-83) | Match? |
|---|---|---|
| `let vault_bump = ctx.accounts.vault_config.bump;` | `let vault_bump = ctx.accounts.vault_config.bump;` | IDENTICAL |
| `let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CONFIG_SEED, &[vault_bump]]];` | `let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CONFIG_SEED, &[vault_bump]]];` | IDENTICAL |
| `helpers::hook_helper::transfer_t22_checked(` | `helpers::hook_helper::transfer_t22_checked(` | IDENTICAL |
| `&ctx.accounts.vault_output.to_account_info(),` | `&ctx.accounts.vault_output.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.output_mint.to_account_info(),` | `&ctx.accounts.output_mint.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.user_output_account.to_account_info(),` | `&ctx.accounts.user_output_account.to_account_info(),` | IDENTICAL |
| `&ctx.accounts.vault_config.to_account_info(),` | `&ctx.accounts.vault_config.to_account_info(),` | IDENTICAL |
| `amount_out,` | `amount_out,` | IDENTICAL |
| `TOKEN_DECIMALS,` | `TOKEN_DECIMALS,` | IDENTICAL |
| `signer_seeds,` | `signer_seeds,` | IDENTICAL |
| `output_hooks,` | `output_hooks,` | IDENTICAL |

**Output transfer is byte-for-byte identical.** Same signer seeds, same TOKEN_DECIMALS (6), same hook account ordering, same token program passthrough.

**No divergences found. Transfer logic is equivalent.**

---

### 4. Error Code Stability

**Verdict: PASS**

**error.rs diff analysis:**

```
Before (6 variants):          After (8 variants):
  ZeroAmount       = 6000       ZeroAmount       = 6000  (unchanged)
  OutputTooSmall   = 6001       OutputTooSmall   = 6001  (unchanged)
  InvalidMintPair  = 6002       InvalidMintPair  = 6002  (unchanged)
  SameMint         = 6003       SameMint         = 6003  (unchanged)
  InvalidTokenProg = 6004       InvalidTokenProg = 6004  (unchanged)
  MathOverflow     = 6005       MathOverflow     = 6005  (unchanged)
                                SlippageExceeded = 6006  (NEW - appended)
                                InvalidOwner     = 6007  (NEW - appended)
```

- **Verification:** Anchor's `#[error_code]` macro assigns codes sequentially starting from 6000 (the Anchor custom error base). The two new variants (`SlippageExceeded`, `InvalidOwner`) are appended AFTER `MathOverflow` (the previous last variant). All existing error codes 6000-6005 are unchanged.
- **Client impact:** Client error-map files need 6006 and 6007 added (noted in 106-01-SUMMARY.md as a 106-02 task). Existing error parsing for 6000-6005 is unaffected.
- **No insertion or reordering detected.**

**No issues found.**

---

### 5. Slippage Guard Correctness

**Verdict: PASS**

**convert_v2.rs line 47:**
```rust
require!(amount_out >= minimum_output, VaultError::SlippageExceeded);
```

**Analysis:**

- **Comparison type safety:** Both `amount_out` and `minimum_output` are `u64`. The comparison `>=` is a standard unsigned integer comparison. No type coercion, no overflow risk in the comparison itself.
- **minimum_output=0 behavior:** When `minimum_output=0`, the guard `amount_out >= 0` is always true for any `u64` (since `u64 >= 0` is tautologically true). This effectively disables slippage protection. This is by design per 106-CONTEXT.md: "minimum_output=0 allowed -- effectively disables slippage check." The compute_output function's own `OutputTooSmall` check still prevents zero-output conversions, so the user always receives something.
- **minimum_output overflow:** `minimum_output` is a `u64` instruction argument deserialized by Anchor. It cannot overflow -- the maximum value is `u64::MAX`. If a user passes `minimum_output = u64::MAX`, the guard would require `amount_out >= u64::MAX`, which would only pass if the conversion output is exactly `u64::MAX` (practically impossible for any reasonable input). This is safe -- it would just cause `SlippageExceeded` error, which is correct behavior (user set an unrealistic minimum).
- **Ordering:** The slippage guard runs AFTER compute_output (line 44) and BEFORE any transfers (line 57). This is correct -- if slippage check fails, no tokens move.
- **Deterministic rate note:** The conversion vault uses a fixed 100:1 rate (no AMM-style slippage). The slippage guard is primarily a defense-in-depth measure for:
  1. Multi-hop routes where the AMM step's variable output feeds into the vault step
  2. Future-proofing if the conversion rate ever becomes dynamic

**No issues found.**

---

### 6. cfg Feature Parity

**Verdict: PASS**

**convert.rs (lines 126-135) -- existing pattern:**
```rust
#[cfg(feature = "localnet")]
let amount_out = {
    let vc = &ctx.accounts.vault_config;
    compute_output_with_mints(
        &input_key, &output_key, amount_in,
        &vc.crime_mint, &vc.fraud_mint, &vc.profit_mint,
    )?
};
#[cfg(not(feature = "localnet"))]
let amount_out = compute_output(&input_key, &output_key, amount_in)?;
```

**convert_v2.rs (lines 35-44) -- new code:**
```rust
#[cfg(feature = "localnet")]
let amount_out = {
    let vc = &ctx.accounts.vault_config;
    compute_output_with_mints(
        &input_key, &output_key, effective_amount,
        &vc.crime_mint, &vc.fraud_mint, &vc.profit_mint,
    )?
};
#[cfg(not(feature = "localnet"))]
let amount_out = compute_output(&input_key, &output_key, effective_amount)?;
```

**Differences:**
1. `amount_in` (convert) vs `effective_amount` (convert_v2) -- intentional, this is the core behavioral change.
2. The `#[cfg(feature = "localnet")]` / `#[cfg(not(feature = "localnet"))]` pattern is identical.
3. Both call the same functions: `compute_output_with_mints` (localnet) and `compute_output` (production).

**Import parity (convert_v2.rs lines 6-9):**
```rust
#[cfg(not(feature = "localnet"))]
use crate::instructions::convert::compute_output;
#[cfg(feature = "localnet")]
use crate::instructions::convert::compute_output_with_mints;
```

These conditional imports avoid unused-import warnings across feature flags. The convert.rs file defines both functions in the same module, so it does not need conditional imports.

**No feature flag divergence found.**

---

### 7. No New Account Constraints on Convert Struct

**Verdict: PASS**

**Evidence:** `git diff ba922cd~1..ba922cd -- programs/conversion-vault/src/instructions/convert.rs` produced EMPTY output. The file was not modified at all in commit ba922cd.

**The `Convert<'info>` struct (convert.rs lines 9-54) is completely unchanged:**
- `user: Signer<'info>` -- no new constraints
- `vault_config: Account<'info, VaultConfig>` -- seeds/bump unchanged
- `user_input_account: InterfaceAccount<'info, TokenAccount>` -- still only `#[account(mut)]`, no owner constraint added
- `user_output_account: InterfaceAccount<'info, TokenAccount>` -- still only `#[account(mut)]`
- `input_mint: InterfaceAccount<'info, Mint>` -- unchanged
- `output_mint: InterfaceAccount<'info, Mint>` -- unchanged
- `vault_input: InterfaceAccount<'info, TokenAccount>` -- authority/mint constraints unchanged
- `vault_output: InterfaceAccount<'info, TokenAccount>` -- authority/mint constraints unchanged
- `token_program: Interface<'info, TokenInterface>` -- unchanged

**Critically:** The owner check is in the convert_v2 HANDLER (convert_v2.rs line 17), NOT in the struct. This is the correct pattern per 106-CONTEXT.md decision: "Owner check in handler, not struct -- avoids changing existing convert behavior."

**No modifications to shared struct.**

---

### 8. Instruction Discriminator Uniqueness

**Verdict: PASS**

**Anchor generates discriminators via `sha256("global:<fn_name>")[0:8]`:**

| Instruction | Discriminator (hex) | Discriminator (bytes) |
|-------------|--------------------|-----------------------|
| `convert` | `7a50d4d05cc822a1` | [122, 80, 212, 208, 92, 200, 34, 161] |
| `convert_v2` | `02a90c8d40261414` | [2, 169, 12, 141, 64, 38, 20, 20] |

- **No collision.** The discriminators differ in all 8 bytes.
- **Wire format:** `convert` expects 8 (discriminator) + 8 (amount_in) = 16 bytes of instruction data. `convert_v2` expects 8 + 8 + 8 = 24 bytes. Even if a client accidentally called the wrong instruction, the data length mismatch would cause Anchor deserialization to fail with an error before any handler logic runs.
- **Namespace:** Both use the `"global"` namespace (standard for `#[program]` instructions). The function names `convert` and `convert_v2` are sufficiently distinct.

**No collision risk.**

---

## Additional Observations

### A. Module Export Pattern (Informational)

**mod.rs line 3:** `pub mod convert_v2;` is added, but there is no corresponding `pub use convert_v2::*;` line. This is intentional per the 106-01 decision: "No pub use for convert_v2 module to avoid ambiguous handler re-export." Both `convert.rs` and `convert_v2.rs` export a `handler` function. A glob re-export (`pub use convert_v2::*`) would create an ambiguous `handler` name. Instead, `lib.rs` references `instructions::convert_v2::handler` directly.

**No issue.** This is a sound pattern choice.

### B. Log Message (Informational)

**convert_v2.rs line 50:** `msg!("convert_v2: effective_amount={}, output={}", effective_amount, amount_out);`

This log executes unconditionally (both convert-all and exact-amount modes). The existing `convert` handler has no equivalent log. This adds ~200 CU cost per invocation. This is acceptable for debugging/indexing purposes and does not represent a security concern.

### C. Compute Unit Budget (Informational)

The convert_v2 handler adds approximately:
- ~200 CU for owner check comparison
- ~200 CU for msg! log
- ~100 CU for slippage comparison
- ~50 CU for sentinel branch

Total additional CU vs convert: ~550 CU. Against a 200,000 CU default budget, this is negligible (0.3% overhead).

---

## Finding Summary

| # | Check | Severity | Verdict |
|---|-------|----------|---------|
| 1 | Owner check correctness | -- | PASS |
| 2 | Sentinel safety (amount_in=0) | -- | PASS |
| 3 | Transfer equivalence | -- | PASS |
| 4 | Error code stability | -- | PASS |
| 5 | Slippage guard correctness | -- | PASS |
| 6 | cfg feature parity | -- | PASS |
| 7 | No new constraints on Convert struct | -- | PASS |
| 8 | Discriminator uniqueness | -- | PASS |

**Findings at CRITICAL severity:** 0
**Findings at HIGH severity:** 0
**Findings at MEDIUM severity:** 0
**Findings at LOW severity:** 0
**Informational notes:** 3 (module export pattern, log message, CU budget)

---

## Final Verdict

### CLEARED

The convert_v2 instruction is cleared for devnet deployment. All 8 security checklist items pass without findings. The implementation:

1. **Correctly prevents balance-drain attacks** via explicit owner check before balance reading
2. **Maintains identical transfer logic** to the proven convert handler (verified line-by-line)
3. **Preserves error code stability** with append-only additions (6006, 6007)
4. **Handles all sentinel edge cases safely** (zero balance, dust, exact amounts)
5. **Enforces slippage protection** without introducing overflow or bypass paths
6. **Does not modify the shared Convert accounts struct** -- existing convert instruction behavior is completely unchanged
7. **Generates unique discriminators** with no collision risk

The convert_v2 changes are minimal, surgical, and defensively coded. The new instruction is a strict superset of the existing convert instruction's functionality (adds owner check, sentinel balance reading, slippage guard) without modifying any existing behavior.

---

*Audit performed by: SOS (Stronghold of Security) v1.4 -- targeted diff review*
*Scope: Phase 106-01 convert_v2 changes only*
*Date: 2026-03-26*
