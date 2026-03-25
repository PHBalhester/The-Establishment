# Regression Scan: Carnage Hotfix

**Files Scanned:** 3
**Scan Date:** 2026-03-16
**New Patterns Found:** 4

Files reviewed:
- `programs/epoch-program/src/helpers/carnage_execution.rs`
- `scripts/e2e/lib/carnage-flow.ts`
- `programs/epoch-program/tests/test_partition_hook_accounts.rs`

---

## Pattern Results

### Unchecked Arithmetic

**None found in new code.**

All arithmetic in `carnage_execution.rs` uses `checked_*` variants with `.ok_or(EpochError::Overflow)?`:
- `swap_amount.checked_add(sol_from_sale)` (line 271)
- `total_buy_amount.saturating_sub(sol_from_sale)` — intentional saturation, not a bug (wrap amount can only be less than or equal to total_buy_amount by design)
- `target_vault_after.checked_sub(target_vault_before)` (line 321)
- `carnage_state.total_sol_spent.checked_add(total_buy_amount)` (line 362)
- `carnage_state.total_triggers.checked_add(1)` (line 366)
- u128 intermediate arithmetic in slippage check uses `checked_mul` + `checked_div` (lines 333-344)
- Statistics updates in `burn_held_tokens`: `total_crime_burned.checked_add(amount)` and `total_fraud_burned.checked_add(amount)` (lines 526-533)

One observation: `available_sol = sol_balance.saturating_sub(rent_exempt_min)` (line 264). This is correct — saturating is appropriate here since a zero result simply means no SOL is available to swap.

---

### Array Bounds

**One low-severity concern found.**

**SCAN-ARR-01 (Low): `partition_hook_accounts` does not check for undersized atomic layout**

In `carnage_execution.rs` lines 422-452, the outer atomic branch fires when `remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 2` (i.e., >= 8). This is correct for the buy-only and burn cases. However the function signature does not document or enforce the minimum 8-account expectation for the atomic path. If a caller passes exactly 7 accounts with `atomic=true`, the outer condition is false and the code falls through to the fallback branch — changing behaviour silently rather than returning an error.

This is a logic correctness issue rather than a panic risk (Rust slice indexing is bounds-checked at runtime), but it means a misconfigured atomic transaction would silently degrade to fallback partitioning rather than failing fast.

The fallback branch at line 441 then checks `remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 2` again for the Sell path. If action is Sell and only 7 accounts were provided, buy hooks become an undersized `remaining_accounts` slice (< 4 elements) and the on-chain swap will fail when the hook program tries to use them.

**Recommendation:** Add an explicit `require!(remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 2, ...)` guard at the entry to `execute_carnage_core` for the atomic path, before calling `partition_hook_accounts`. This fails fast with a clear error instead of silently mispartitioning.

**`read_pool_reserves` bounds check is correct**: `require!(data.len() >= 153, ...)` (line 830) guards all slice accesses. No raw index panics possible.

---

### Access Control

**One medium-severity concern found.**

**SCAN-AC-01 (Medium): `atomic` boolean is informational only — does not gate execution**

The `atomic: bool` parameter passed to `execute_carnage_core` is used for two purposes:
1. Controlling the `partition_hook_accounts` layout (lines 422-452) — this is a functional use.
2. Populating the `CarnageExecuted` event's `atomic` field (line 395) — purely informational.

It does NOT gate any access control logic. Both callers supply their own value:
- `execute_carnage_atomic/handler` passes `true`
- `execute_carnage/handler` passes `false`

There is no way for a caller to lie about this flag and gain privilege. The actual privilege separation (lock window, deadline, carnage_pending check) is enforced by the Anchor `#[account(...)]` constraints and slot checks in each handler, BEFORE `execute_carnage_core` is called. The `atomic` flag inside core only affects hook account partitioning and event metadata.

**No privilege escalation vector via the `atomic` flag.** However, it is worth noting that the `atomic` value affects which hook account slice is used. If a future change were to add logic that ONLY ran for `atomic=true` (e.g., a stricter check), a caller of `execute_carnage` passing `atomic=true` manually could bypass it. The current architecture is safe; this is a design-hygiene note for future maintainers.

**SCAN-AC-02 (Info): `swap_authority` is not PDA-validated in either handler**

Both `ExecuteCarnageAtomic` and `ExecuteCarnage` declare `swap_authority` as `AccountInfo<'info>` with only a `/// CHECK: PDA derived from Tax Program seeds, validated during Tax CPI` comment — no on-chain seed derivation constraint. This means any arbitrary pubkey can be passed as `swap_authority`. The Tax Program validates it during the CPI, so the end-to-end security holds, but an invalid pubkey would only be caught at CPI time (causing an opaque error) rather than at Anchor constraint validation time.

This is an existing pattern, not introduced by this hotfix. It is documented as a known trade-off (stack budget). Flagged here for completeness.

---

### TypeScript Client

**Two concerns found.**

**SCAN-TS-01 (Medium): BN comparison `carnageState.heldAmount > 0` is unreliable**

In `carnage-flow.ts` line 359:
```typescript
if (carnageState.heldAmount > 0 && carnageState.heldToken > 0) {
```

`heldAmount` is fetched from an Anchor account as a `BN` (BigNumber) object (it maps to `u64` on-chain). Comparing a `BN` object with the number literal `0` using `>` relies on JavaScript coercing the BN to a number. For small values this works, but for values exceeding `Number.MAX_SAFE_INTEGER` (2^53 - 1) the comparison is unreliable. Token amounts with 9 decimals can easily exceed this threshold.

The correct comparison is `carnageState.heldAmount.gtn(0)` (BN's greater-than-number method) or `!carnageState.heldAmount.isZero()`.

This bug means the sell hook accounts may not be appended when they should be (if `heldAmount` is large and BN coercion gives an incorrect result), causing the atomic TX to proceed without sell hooks and then fail on-chain with an insufficient accounts error. Because the hooks are missing from the TX, the on-chain sell will fail with an error that looks like an accounts problem, not a client logic problem.

**SCAN-TS-02 (Low): Race condition between hook resolution and TX submission**

In `buildExecuteCarnageAtomicIx` (lines 354-376), the function fetches `carnageFundState` to determine held token, then resolves hook accounts, then returns the instruction. This read-then-build sequence is not atomic. Between the `carnageFundState.fetch` call and `sendV0Transaction`, the on-chain state could change (e.g., another TX executes Carnage and clears `held_token`). If this happens:

- The TX would be built with sell hooks for a token that is no longer held.
- On-chain `held_amount == 0` so the sell step is skipped (`if held_amount > 0` guard), meaning the extra hook accounts are harmlessly ignored.
- The buy step proceeds normally.

This means the race window does NOT cause funds loss or incorrect execution — the on-chain guard is correct. However, it would cause an unnecessary TX size increase (8 extra bytes for hook accounts on a path that won't use them). The race is benign and acceptable for an E2E test harness.

---

### HOOK_ACCOUNTS_PER_MINT Usage

**Correct and consistent.**

- Defined once in `carnage_execution.rs` as `pub const HOOK_ACCOUNTS_PER_MINT: usize = 4` (line 45).
- Re-exported and used in `test_partition_hook_accounts.rs` via `use epoch_program::helpers::carnage_execution::HOOK_ACCOUNTS_PER_MINT`.
- All slice arithmetic in `partition_hook_accounts` uses `HOOK_ACCOUNTS_PER_MINT` as the unit — no hardcoded `4` literals in slice indexing.
- The TypeScript client (`carnage-flow.ts`) does not use this constant directly; instead it appends 4-element arrays returned from `resolveHookAccounts`. The `resolveHookAccounts` function is responsible for returning exactly 4 accounts — that function is not part of this hotfix but should be verified to always return exactly 4 entries.
- The test file covers all 18 combinations (3 actions × 2 targets × 3 held states) and explicitly asserts `buy.len() == HOOK_ACCOUNTS_PER_MINT` for every case. This is solid coverage.

---

### Other Concerns

**SCAN-OTH-01 (Info): Memory leak in test helper `to_account_info`**

In `test_partition_hook_accounts.rs` lines 51-52:
```rust
let lamports_ref = Box::leak(Box::new(self.lamports));
let data_ref: &mut [u8] = Box::leak(self.data.clone().into_boxed_slice());
```

`Box::leak` deliberately leaks memory to satisfy `AccountInfo`'s `'static`-like lifetime requirements in unit tests. This is a standard Solana test pattern and is acceptable for a test-only file. The memory is reclaimed when the test process exits. No production code is affected.

**SCAN-OTH-02 (Info): `runCarnageFlow` step 2 condition is always true**

In `carnage-flow.ts` line 1066:
```typescript
if (!forcedResult.tested || forcedResult.tested) {
```

This condition is a tautology — it is always `true`. Step 2 (natural Carnage cycling) always runs regardless of forced Carnage outcome. This appears to be leftover from a draft that intended to skip step 2 if forced Carnage already succeeded. The current behavior (always run step 2) is defensible for an E2E harness that wants maximum coverage, but the dead condition is misleading. Consider replacing with `if (true)` or removing the conditional entirely, or restoring the original intent with `if (!forcedResult.success)`.

**SCAN-OTH-03 (Info): No unsafe blocks present**

Grep confirmed zero `unsafe` blocks in all three files. Rust code is fully safe.

---

## Summary

| ID | Severity | File | Description |
|----|----------|------|-------------|
| SCAN-ARR-01 | Low | carnage_execution.rs | Atomic path falls through to fallback on 5-7 remaining_accounts; no explicit minimum guard |
| SCAN-AC-01 | Medium (Info) | carnage_execution.rs / handlers | `atomic` bool is informational only, does not bypass access control — confirmed safe, note for maintainers |
| SCAN-AC-02 | Info | execute_carnage_atomic.rs / execute_carnage.rs | `swap_authority` has no seed-derivation constraint; deferred to Tax CPI (pre-existing, not introduced by hotfix) |
| SCAN-TS-01 | Medium | carnage-flow.ts:359 | `carnageState.heldAmount > 0` should be `.gtn(0)` — BN comparison may fail for large token amounts |
| SCAN-TS-02 | Low | carnage-flow.ts:354-376 | TOCTOU race on held_token fetch vs TX submit; benign due to on-chain guard |
| SCAN-OTH-01 | Info | test_partition_hook_accounts.rs | `Box::leak` in test helper — standard pattern, no production impact |
| SCAN-OTH-02 | Info | carnage-flow.ts:1066 | Tautological condition `(!forcedResult.tested || forcedResult.tested)` — step 2 always runs |
| SCAN-OTH-03 | Info | all | No unsafe blocks present |

**Action required before mainnet:**
- Fix SCAN-TS-01 (BN comparison) — this can silently cause the sell hooks to be omitted for large held amounts.
- Consider adding the explicit `require!(remaining_accounts.len() >= ...)` guard noted in SCAN-ARR-01 for fail-fast behavior.
