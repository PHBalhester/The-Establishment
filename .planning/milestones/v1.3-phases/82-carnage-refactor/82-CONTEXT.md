# Phase 82: Carnage Refactor - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deduplicate ~1800 lines of near-identical Carnage execution logic across `execute_carnage.rs` (1004 lines) and `execute_carnage_atomic.rs` (1017 lines) into a shared module with zero behavioral regression across all 6 paths. Two requirements: CARN-01 (shared module extraction), CARN-02 (6-path integration tests pass).

</domain>

<decisions>
## Implementation Decisions

### Extraction Strategy
- Use **raw AccountInfo parameters** (no traits, no macros, no generics over Context types)
- Extract **all 7 helper functions** to shared module: `burn_held_tokens`, `wrap_sol_to_wsol`, `execute_sell_swap`, `execute_buy_swap`, `execute_swap_exempt_cpi`, `read_pool_reserves`, `approve_delegate`
- Bundle the ~14 shared accounts into a **`CarnageAccounts<'a, 'info>` struct** to avoid 14-param function signatures
- **Mixed typing** in the struct: vaults stay as `&InterfaceAccount<TokenAccount>` (needed for `.amount` and `.reload()`), pools/mints/programs stay as `&AccountInfo`
- Each handler destructures its Context, builds a `CarnageAccounts` instance, and passes it to shared functions

### Handler Core Extraction
- Extract a **`execute_carnage_core()`** function in the shared module that implements the full dispose->buy->update flow
- Each handler reduced to ~30 lines: entry guard + build CarnageAccounts + call core
- **Core assumes carnage_pending == true** -- callers are responsible for their own guards:
  - Atomic: checks `!carnage_pending` and returns `Ok(())` early before calling core
  - Fallback: Anchor constraint already enforces `carnage_pending`
- **Mutable state as separate params**: `CarnageAccounts` holds only immutable references; `epoch_state` and `carnage_state` are separate `&mut` params to the core function
- Core function signature: `execute_carnage_core(accounts, epoch_state, carnage_state, remaining_accounts, carnage_signer_bump, sol_vault_bump, slippage_bps, atomic) -> Result<()>`

### Module Structure
- **New file: `helpers/carnage_execution.rs`** for the CarnageAccounts struct + 7 shared helpers + core function + `partition_hook_accounts()` helper
- Existing `helpers/carnage.rs` stays untouched (VRF byte interpretation -- separate concern)
- Clean separation: `carnage.rs` = VRF derivation, `carnage_execution.rs` = swap/burn/wrap mechanics
- `HOOK_ACCOUNTS_PER_MINT` const and remaining_accounts partitioning logic move to shared module
- **`SWAP_EXEMPT_DISCRIMINATOR`** promoted to `constants.rs` now (Phase 83 VRF-10 will add validation test for it)

### CU Regression Testing
- **Capture CU baseline as first step of plan execution** (before any code changes), not during discussion
- Run existing 6 Carnage integration tests on devnet, capture CU from transaction logs
- After refactor, run same tests, compare CU values
- **Hard 5% gate**: if any path regresses >5% CU, investigate and fix before merging -- no exceptions
- Document baseline + post-refactor values in plan summary

### Claude's Discretion
- Exact field ordering in CarnageAccounts struct
- Whether CarnageAccounts has a `from_context()` constructor or is built inline in each handler
- Test structure for the 6-path regression tests (reuse existing or new)
- Exact error handling in partition_hook_accounts

</decisions>

<specifics>
## Specific Ideas

- The 3 differences between handlers are: entry guard (deadline+lock vs no-op), slippage BPS (FALLBACK 75% vs ATOMIC 85%), and event `atomic` flag
- Phase 80 deferred epoch_program is_reversed to Phase 82 -- the shared `read_pool_reserves` already has is_reversed detection, so this is satisfied by the refactor
- SWAP_EXEMPT_DISCRIMINATOR promotion to constants.rs sets up Phase 83 VRF-10 cleanly

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `helpers/carnage.rs`: VRF byte helpers (174 lines) -- untouched, separate concern
- `burn_held_tokens` and `read_pool_reserves`: Already context-free, can move as-is
- `CarnageFundState` and `EpochState`: Anchor state structs used by both handlers

### Established Patterns
- Box'd InterfaceAccounts for stack savings (established in Phase 47)
- `invoke_signed` for manual CPI to Token-2022 and Tax Program
- `HOOK_ACCOUNTS_PER_MINT = 4` constant for remaining_accounts partitioning
- Phase 80's hard error philosophy: all checks are hard errors, no silent degradation

### Integration Points
- `instructions/execute_carnage.rs` (1004 lines): Fallback handler -- will shrink to ~30 lines + account struct
- `instructions/execute_carnage_atomic.rs` (1017 lines): Atomic handler -- will shrink to ~30 lines + account struct
- `helpers/mod.rs`: Add `pub mod carnage_execution;`
- `constants.rs`: Add `SWAP_EXEMPT_DISCRIMINATOR` const
- Existing Carnage integration tests (carnage.test.ts, carnage-flow.ts): Used for CU baseline/comparison

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 82-carnage-refactor*
*Context gathered: 2026-03-08*
