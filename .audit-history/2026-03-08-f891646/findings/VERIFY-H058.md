# Verification: H058 - CPI depth at Solana 4-level limit

**Original Severity:** MEDIUM
**Verification Status:** NOT_FIXED (finding remains valid as a latent architectural constraint; hotfix did not worsen it and introduced no regression)

## Changes Found

The hotfix modified `partition_hook_accounts` (lines 415–453) to support the atomic path
where the VRF-derived target token is unknown at transaction build time. The new function
signature adds four parameters: `action: &CarnageAction`, `target: &Token`,
`_held_token: u8`, and `atomic: bool`.

The new logic introduces a three-region layout for the atomic path:
- `[CRIME_buy(4), FRAUD_buy(4), held_sell(4)?]`

On the atomic path the function selects the correct buy-hook slice based on the resolved
`target` and, when `action == Sell` and at least 12 accounts are present, slices the
sell-hook region at `[8..12]`. The fallback branches are unchanged.

No other functions were modified.

## Verification Analysis

`partition_hook_accounts` is pure account slicing. The entire function body consists of
index arithmetic on `remaining_accounts` and conditional slice selection. There are zero
`invoke`, `invoke_signed`, or CPI helper calls anywhere in the function — the hotfix did
not add any.

The CPI depth chain is unchanged from before the hotfix:

```
execute_carnage[_atomic] (entry, depth 0)
  -> Tax::swap_exempt          (depth 1)
     -> AMM::swap_sol_pool     (depth 2)
        -> Token-2022::transfer_checked (depth 3)
           -> Transfer Hook::execute   (depth 4)  <- SOLANA LIMIT
```

The module-level comment at lines 11–19 documents this chain explicitly and states that
`system_program::transfer` and `sync_native` (used in `wrap_sol_to_wsol`) execute at
depth 0 before the swap chain. The `approve_delegate` CPI (Token-2022 Approve, called
before the sell swap) also executes at depth 0 from the entry handler and is not part of
the swap chain. Both remain correct after the hotfix.

The original finding — that the chain is exactly at the 4-level limit and any CPI added
to the swap path would silently break it — remains an accurate description of the
architectural constraint. The hotfix did not resolve that latent risk (no compile-time
guard was added), but it also did not trigger it.

## Regression Check

No regression introduced by the hotfix:

1. No new CPI calls were added anywhere in the file.
2. The new `atomic` branch correctly falls through to the existing fallback branches when
   `atomic == false`, preserving all prior behaviour.
3. The sell-hook slice (`[8..12]`) is only activated when
   `remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 3` (i.e., >= 12), preventing
   an out-of-bounds panic on short account lists.
4. The `_held_token` parameter is intentionally unused (underscore prefix), confirming it
   was added for signature consistency without side effects.

CPI depth on the swap path remains exactly 4.
