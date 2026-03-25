# Verification: Carnage Hotfix Security Review

**Verification Status:** FIXED

**Reviewed files:**
- `programs/epoch-program/src/helpers/carnage_execution.rs` — `partition_hook_accounts` and all callers
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` — atomic entry point
- `programs/epoch-program/src/instructions/execute_carnage.rs` — fallback entry point
- `scripts/e2e/lib/carnage-flow.ts` — `buildExecuteCarnageAtomicIx`
- `programs/epoch-program/tests/test_partition_hook_accounts.rs` — unit tests

---

## Changes Found

### On-chain (`partition_hook_accounts`)

**Before (bug):** The function used `_held_token` to select the `buy_hooks` slice in atomic mode,
which reflected stale `CarnageFundState.held_token` rather than the VRF-derived `target` from
`EpochState`. Because VRF sets `target` in the same TX (`consume_randomness`) and the client reads
state before that TX, the client always resolved hooks for the previously-held token — causing
CRIME to be selected every time when FRAUD was held.

**After (fix):** The atomic branch now resolves `buy_hooks` using the on-chain `target` parameter
(already correctly populated from `EpochState.carnage_target` before `partition_hook_accounts` is
called). The layout `[CRIME_buy(4), FRAUD_buy(4), held_sell(4)?]` provides hooks for both possible
targets. The function selects the correct buy slice at runtime using the real `target`:

```rust
let buy_hooks = match target {
    Token::Crime => crime_buy,   // remaining[0..4]
    Token::Fraud => fraud_buy,   // remaining[4..8]
};
```

Sell hooks remain at `remaining[8..12]` regardless of which token is held; the client resolves
sell-direction hooks for the currently-held token at TX-build time (that information IS stable).

### Client (`buildExecuteCarnageAtomicIx`)

**Before (bug):** The client read `carnage_target` from stale state before the bundled TX ran, and
passed only hooks for that stale target.

**After (fix):** The client now resolves buy hooks for **both** CRIME and FRAUD unconditionally
(`crimeBuyHooks` then `fraudBuyHooks`), then conditionally appends sell hooks for the held token
only if `heldAmount > 0`. This matches the on-chain layout exactly.

---

## Security Analysis

### a. Can an attacker pass crafted remaining_accounts to manipulate which hooks are used?

**No — account pubkeys are validated by Token-2022 and the Transfer Hook program, not by Epoch.**

The Epoch program passes `hook_accounts` slices as `remaining_accounts` to `Tax::swap_exempt`,
which forwards them to `Token-2022::transfer_checked_with_hook`. Token-2022 independently derives
the expected `extra_account_meta_list` PDA for each mint and validates all extra accounts against
it. An attacker submitting crafted hook pubkeys would cause Token-2022's on-chain validation to
fail, not silently succeed. No Epoch-side validation of hook account pubkeys is needed or missing.

**One nuance:** `execute_swap_exempt_cpi` preserves `is_writable` and `is_signer` flags from the
hook accounts as passed. An attacker cannot grant themselves signing privileges via this path because
Token-2022 already validates the accounts' metadata; a wrong signer bit would cause Token-2022 to
reject the TX. No vulnerability here.

### b. Are there any out-of-bounds slice panics possible?

**No — all slice indexing is guarded.**

The function uses length checks before indexing:

```rust
if atomic && remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 2 {
    // safe to index [0..4] and [4..8]
    if matches!(action, CarnageAction::Sell)
        && remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 3
    {
        // safe to index [8..12]
    }
}
```

The fallback branch similarly gates `[HOOK_ACCOUNTS_PER_MINT..]` on a `>= HOOK_ACCOUNTS_PER_MINT * 2`
check. Extra accounts beyond the expected count (e.g. 13+ in atomic mode) are silently ignored —
they are never indexed. This is safe: Solana passes remaining_accounts as a slice and the program
only takes what it expects. No panics are possible from over-provisioning.

**Confirmed:** `HOOK_ACCOUNTS_PER_MINT = 4` is a `pub const usize`, not a runtime value, so all
arithmetic is compile-time constant and cannot overflow.

### c. Does the fallback path (atomic=false) remain unchanged and secure?

**Yes — fallback path is bitwise identical to pre-hotfix.**

The `atomic=false` branch is the final `else if` / `else` chain and is entered whenever
`atomic == false` regardless of account count. The logic:
- Sell: `([0..4], [4..8])` — client sends `[sell_hook(4), buy_hook(4)]`
- Burn/BuyOnly: `(empty, remaining_accounts)` — all accounts are buy hooks

This code was not touched by the hotfix. Additionally, `execute_carnage.rs` (the fallback
instruction handler) still passes `false` as the `atomic` argument to `execute_carnage_core`, and
all its Anchor constraints (deadline, lock window) are unchanged.

### d. Is there any way to pass wrong number of accounts to cause unexpected behavior?

**Gracefully handled in all cases, with one deliberate design choice worth noting.**

| Scenario | Behaviour |
|---|---|
| Atomic + 0 accounts | Falls through to fallback Burn/BuyOnly branch: buy_hooks = empty slice. Buy swap called with empty hooks — Token-2022 will reject (hook missing). TX fails with hook error, no state change. |
| Atomic + 4 accounts (only one mint) | Falls through to fallback branch (len < 8 fails guard). Buy_hooks = those 4 accounts. Swap attempts with wrong-mint hooks → Token-2022 rejects. |
| Atomic + 8 accounts, Sell action | `sell_hooks = empty`, buy proceeds. Sell step is skipped when `held_amount = 0`. If `held_amount > 0`, `execute_sell_swap` is called with empty hooks → Token-2022 rejects. No state corruption possible; sell CPI failure aborts the entire TX. |
| Atomic + 12 accounts, non-Sell action | Sell hooks at [8..12] are resolved but never consumed. Surplus is silently ignored. No issue. |
| Fallback + >8 accounts | `buy_hooks = &remaining_accounts[4..]` includes all extra accounts. Token-2022 validates against the hook's `ExtraAccountMetaList`. Extra accounts cause Token-2022 to reject (wrong account count). TX fails safely. |

The only footgun is sending too few hooks in the atomic path, but that results in a clean CPI
failure, not silent state corruption or fund theft.

### e. Does the `_held_token` parameter being unused create any issue?

**No — the underscore prefix is intentional and correct.**

`_held_token` is accepted for API symmetry (callers can pass `carnage_state.held_token` without
needing to know whether it is used) but is not needed by `partition_hook_accounts` because:

1. The **buy** target is determined by `target` (from `EpochState.carnage_target`, set by VRF).
2. The **sell** hooks are always at a fixed position `[8..12]` in atomic mode; the client resolves
   them for the correct held token at TX-build time.

The function never needs to branch on which specific token is held for slice selection. The
underscore silences the unused-variable compiler warning. No dead-code concern: the parameter
documents the interface contract even if the value is unused in this version.

**One future-proofing note:** If a future change needs to validate that the sell hooks actually
match the held token on-chain (e.g. requiring `sell_hooks[3].key() == crime_hook_program`), this
parameter would be available without an ABI change. This is not a current gap — Token-2022
validates hooks independently.

### f. Can the atomic flag be controlled by external callers or is it internal only?

**Fully internal — not user-controllable.**

The `atomic` boolean is a **compile-time constant** at each call site:

- `execute_carnage_atomic.rs` handler: `execute_carnage_core(..., true)` — hardcoded `true`
- `execute_carnage.rs` handler: `execute_carnage_core(..., false)` — hardcoded `false`

There is no instruction field, account flag, or remaining_accounts value that an external caller
can use to flip this. The only effect of `atomic` externally visible is the `atomic` field of the
`CarnageExecuted` event (informational only) and which `partition_hook_accounts` branch runs — the
latter is entirely determined by which on-chain instruction the caller invokes.

An attacker cannot call `execute_carnage_atomic` with `atomic=false` semantics or vice versa.

---

## Test Coverage

### Coverage Assessment: Sufficient for partition_hook_accounts correctness

The 18-combination exhaustive test (`atomic_exhaustive_all_combinations`) plus 9 named single-case
tests cover:

| Test | Purpose |
|---|---|
| `atomic_buyonly_target_crime/fraud` | Buy slice selection per target |
| `atomic_burn_target_crime/fraud` | Burn does not produce sell hooks |
| `atomic_sell_target_crime_held_fraud` | Cross-token Sell+Buy |
| `atomic_sell_target_fraud_held_crime` | Cross-token Sell+Buy (reversed) |
| `atomic_sell_target_crime_held_crime` | Same-token Sell+Buy |
| `atomic_sell_target_fraud_held_fraud` | Same-token Sell+Buy (reversed) |
| `atomic_sell_action_but_no_sell_hooks` | Graceful degradation (8 accounts, Sell action) |
| `atomic_noop_still_partitions_safely` | No-op after cleared state |
| `fallback_buyonly/burn/sell` | Fallback path unchanged |

**Missing edge cases (low severity):**

1. **Atomic + 0 accounts:** No test for completely empty remaining_accounts in atomic mode.
   Currently falls through to the fallback Burn/BuyOnly branch and returns an empty buy slice,
   which will fail at the CPI level. Safe failure, but untested explicitly.

2. **Atomic + >12 accounts:** No test that extra trailing accounts are silently ignored.
   Confirmed safe by code inspection but not proven by test.

3. **Fallback + >8 accounts for Sell:** `buy_hooks = &remaining[4..]` would include >4 accounts.
   Confirmed Token-2022 rejects this, but no test exercises it.

4. **Account limit / TX size:** No integration test that the Sell atomic path (12 remaining +
   23 named = 35 total accounts) stays within Solana's 64-account-per-TX limit. At 35 it is well
   within limits (35 < 64), but this should be confirmed in a comment in the instruction file.

None of these missing cases represent exploitable paths — they all fail safely at the CPI layer —
but adding tests for (1) and (2) would complete the coverage matrix.

---

## Regression Check

**No new vulnerabilities introduced.**

1. **State source is correct:** `target` and `action` are read from `EpochState` (set by
   `consume_randomness` in the same TX for atomic, or already committed for fallback). These are
   Anchor-validated PDA accounts with seed constraints. They cannot be spoofed.

2. **Fallback unaffected:** The `atomic=false` code path in `partition_hook_accounts` and the
   `execute_carnage.rs` handler are unchanged from pre-hotfix. Lock-window and deadline constraints
   remain in place.

3. **No new CPI depth:** The hook account forwarding pattern is identical to pre-hotfix. No new CPI
   calls were added.

4. **No silent success on hook mismatch:** Passing wrong-mint hooks now causes a clean CPI failure
   from Token-2022 (same as before). The hotfix did not introduce any path where wrong hooks are
   silently accepted.

5. **`_held_token` not causing data flow issues:** Verified that the unused parameter does not
   affect any other execution path. The parameter is only passed through and never dereferenced for
   logic.

**Summary:** The root cause (buy hooks selected from stale client-side state rather than on-chain
VRF-derived target) is fully addressed. Both buy-hook slots are now always provided, and the
selection is made on-chain against authoritative state. The fallback path is structurally unchanged.
Test coverage for `partition_hook_accounts` is thorough for the happy paths; three low-severity
edge cases are missing tests but represent safe-failure scenarios only.
