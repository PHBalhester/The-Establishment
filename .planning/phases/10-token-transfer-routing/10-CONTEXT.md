# Phase 10: Token Transfer Routing - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the transfer abstraction layer that correctly routes token transfers between SPL Token and Token-2022 programs with hook account passthrough. This is consumed by swap instructions in Phases 11-13. Verified in isolation before swap integration.

</domain>

<decisions>
## Implementation Decisions

### Transfer helper API shape
- **Separate explicit functions:** `transfer_t22_checked()` and `transfer_spl()` — no single routing function
- Swap instructions explicitly pick which helper to call per token side (swap_sol_pool knows token A is T22, token B is SPL)
- Both helpers share consistent parameter patterns but with program-specific extras (T22 needs mint/decimals/hook accounts, SPL just needs token program)
- Routing logic lives at the swap instruction level, not hidden inside helpers

### Dual-hook account passing
- Hook accounts passed via `remaining_accounts` (not explicit named fields in instruction struct)
- Instruction arg `hook_accounts_a: u8` tells the code where to split remaining_accounts between token A and token B hook data
- For SOL pools: all remaining_accounts belong to the T22 side (no split needed)
- For PROFIT pools: remaining_accounts split at `hook_accounts_a` — first slice for token A hooks, second for token B hooks
- **Per-token hook program resolution** — AMM reads hook program from mint's Transfer Hook extension data, does NOT hardcode a hook program ID
- Caller pre-resolves ExtraAccountMetas client-side (standard T22 pattern) — helper just uses what's passed in

### Error semantics
- **Raw error propagation** — let token program and hook errors bubble up unchanged (standard Anchor pattern, authentic error codes for debugging)
- **Defense-in-depth pre-validation** — validate token program IDs match expected SPL Token / T22 before CPI (prevents calling arbitrary programs), validate amount > 0 and vault ownership before transfer
- Silent revert on hook rejection — no custom events before revert (Solana doesn't persist events from reverted transactions anyway)
- Anchor account constraints handle wrong-vault and wrong-mint attacks at the constraint level

### Claude's Discretion
- PDA signer seeds: Claude decides whether helpers derive seeds internally from pool state or accept them from caller
- Type safety: Claude decides whether helpers take raw AccountInfo or typed Anchor accounts
- Module layout: Claude decides whether transfer helpers live in a dedicated transfers.rs or alongside other helpers
- Pre-check granularity: Claude decides exact set of defense-in-depth checks beyond what Anchor constraints cover

</decisions>

<specifics>
## Specific Ideas

- AMM is a "pure swap primitive" that does not interpret hook logic — it just forwards the right accounts per T22 standards
- Transfer_Hook_Spec.md Section 8 defines ExtraAccountMetaList format (two whitelist PDAs derived from source/destination accounts)
- All three protocol tokens (CRIME, FRAUD, PROFIT) currently share the same hook program, but AMM should resolve from mint to stay decoupled
- The coupling point between AMM and Transfer Hook is the ExtraAccountMetaList format (T22 standard), not any custom protocol interface

</specifics>

<testing>
## Test Strategy Decisions

- **Mock hook program** for tests — simple always-approve hook. Real Transfer Hook program is a future milestone; don't build it in Phase 10
- **Test-only instructions** — add `#[cfg(test)]` instructions that expose transfer helpers directly via litesvm, without building full swap flow
- **Real T22 mints with Transfer Hook extension** — create actual Token-2022 mints configured with hook extension to exercise the full transfer_checked path including hook account resolution
- **Both directions tested** — user-to-vault (user signs) and vault-to-user (PDA signs) tested separately to catch PDA signing issues and authority validation

</testing>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-token-transfer-routing*
*Context gathered: 2026-02-04*
