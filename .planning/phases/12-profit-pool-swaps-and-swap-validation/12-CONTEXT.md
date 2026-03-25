# Phase 12: PROFIT Pool Swaps & Swap Validation - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the AMM's core swap functionality: add `swap_profit_pool` instruction for pure T22 pools (CRIME/PROFIT, FRAUD/PROFIT) with dual-hook invocation and 50 bps fee, then build a comprehensive test suite covering all 4 pool types including edge cases, slippage, and cross-pool consistency. Access control (CPI-only gating) is Phase 13.

</domain>

<decisions>
## Implementation Decisions

### Zero-output swap behavior
- Revert with explicit error when swap math produces 0 output — do not allow users to burn tokens for nothing
- Check at two points in the math module: (1) after fee deduction, if effective_input rounds to 0, revert; (2) after swap math, if amount_out is 0, revert
- Distinct error variants for each failure point (clearer debugging for callers)
- Apply retroactively to swap_sol_pool as well — consistent behavior across all pool types
- Both checks live in the math module (single enforcement point, every caller protected automatically)

### Dual-hook account model
- PROFIT pools require hook accounts for both token sides (both are T22 with transfer hooks)
- Validate that hook accounts are present for both tokens — fail with clear error if missing (defense-in-depth, don't rely solely on transfer_checked runtime failure)
- CPI interface uses identical args as swap_sol_pool (amount_in, direction, min_amount_out) — only the account struct differs
- Tax Program uses the same calling pattern for both swap instructions

### Claude's Discretion
- remaining_accounts splitting strategy for dual-hook accounts (convention-based ordering vs count-based args)
- Hook error handling (surface original hook error vs wrap with AMM error)
- Code sharing between swap_sol_pool and swap_profit_pool handlers (shared core vs separate handlers)
- PoolType validation in swap instructions (check pool_type matches instruction vs treat as informational)
- Integration-level proptest decision (add or rely on Phase 8 math-level proptest)
- Test suite organization (unified vs extend-existing approach)

### Instruction symmetry
- Same SwapDirection enum (AtoB/BtoA) reused across both swap instructions
- Same SwapEvent emitted by both instructions — one event schema for all swaps, pool type inferred from pool address
- Identical instruction args (amount_in, direction, min_amount_out) — only account struct differs between swap_sol_pool and swap_profit_pool

### Test suite scope
- Two layers of edge case testing: realistic extremes (ratios ~1000:1, reserves ~100 tokens) for integration tests + adversarial extremes (1M:1, 1 token, u64::MAX) as stress tests
- Cross-pool consistency tests: verify that same input produces expected fee-adjusted output ratio between SOL pools (100 bps) and PROFIT pools (50 bps)
- Clear separation between "should work" scenarios and "should not break" stress tests

</decisions>

<specifics>
## Specific Ideas

- Zero-output check is industry standard (Uniswap V2 `INSUFFICIENT_OUTPUT_AMOUNT`) — aligns with DeFi conventions
- CPI-only model makes zero-output protection especially important: if Tax Program has a bug that passes dust amounts, the AMM catches it instead of silently burning tokens
- Dual-hook is the primary new technical challenge — SOL pools only hook one side, PROFIT pools hook both
- Cross-pool tests catch subtle fee calculation bugs that per-pool tests would miss

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-profit-pool-swaps-and-swap-validation*
*Context gathered: 2026-02-04*
