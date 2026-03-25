---
phase: 11-sol-pool-swaps
plan: 01
subsystem: amm
tags: [anchor, swap, constant-product, cpi, token-2022, spl-token, reentrancy, slippage]

# Dependency graph
requires:
  - phase: 08-foundation-scaffolding
    provides: "Swap math helpers (calculate_effective_input, calculate_swap_output, verify_k_invariant)"
  - phase: 09-pool-initialization
    provides: "PoolState struct, initialize_pool instruction, pool PDA seeds"
  - phase: 10-token-transfer-routing
    provides: "transfer_t22_checked and transfer_spl helper functions"
provides:
  - "swap_sol_pool instruction with SwapDirection enum, SlipPage protection, k-invariant enforcement"
  - "SwapEvent with 12 fields for indexer/frontend consumption"
  - "Reentrancy guard (locked: bool) on PoolState"
  - "5 new error variants: SlippageExceeded, PoolNotInitialized, PoolLocked, VaultMismatch, InvalidMint"
affects:
  - 11-02 (swap integration tests will exercise this instruction)
  - 12-profit-pool-swaps (swap_profit_pool will follow same pattern)
  - 13-cpi-access-control (Tax Program will CPI into swap_sol_pool)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direction-based dynamic routing via SwapDirection enum argument"
    - "Position-based account struct naming (a/b) for direction-agnostic Anchor constraints"
    - "Explicit lifetime annotations on handler for remaining_accounts forwarding"
    - "CEI ordering: checks -> effects -> interactions -> post-interaction"
    - "Belt-and-suspenders reentrancy guard (locked bool) on PoolState"

key-files:
  created:
    - "programs/amm/src/instructions/swap_sol_pool.rs"
  modified:
    - "programs/amm/src/state/pool.rs"
    - "programs/amm/src/errors.rs"
    - "programs/amm/src/events.rs"
    - "programs/amm/src/instructions/mod.rs"
    - "programs/amm/src/lib.rs"
    - "programs/amm/tests/test_pool_initialization.rs"

key-decisions:
  - "Handler needs explicit lifetime annotations: Context<'_, '_, 'info, 'info, SwapSolPool<'info>> for remaining_accounts forwarding to transfer helpers"
  - "PoolState INIT_SPACE 223->224 bytes (locked: bool added) -- InitSpace derive auto-handles"
  - "Integration test PoolStateView updated for new locked field byte offset"

patterns-established:
  - "Direction enum pattern: single instruction + enum arg, not separate instructions per direction"
  - "Save immutable pool fields before any mutation to avoid RefCell borrow conflicts"
  - "Transfer routing: is_t22() check determines transfer_t22_checked vs transfer_spl path"

# Metrics
duration: 5min
completed: 2026-02-04
---

# Phase 11 Plan 01: SOL Pool Swap Instruction Summary

**Bidirectional swap_sol_pool instruction with CEI ordering, reentrancy guard, slippage protection, and k-invariant enforcement wiring existing math/transfer helpers**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-04T19:48:08Z
- **Completed:** 2026-02-04T19:53:25Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Implemented complete swap_sol_pool instruction that executes bidirectional swaps in CRIME/SOL and FRAUD/SOL mixed pools
- Wired existing Phase 8 math helpers and Phase 10 transfer routing helpers into orchestrated swap flow with strict CEI ordering
- Added reentrancy guard (locked: bool) to PoolState as defense-in-depth protection
- IDL correctly exposes swap_sol_pool with SwapDirection enum, all 3 instruction args, and SwapEvent with 12 fields

## Task Commits

Each task was committed atomically:

1. **Task 1: Add locked field, swap errors, and SwapEvent** - `9c545a5` (feat)
2. **Task 2: Create swap_sol_pool instruction and wire into program** - `56c496a` (feat)

## Files Created/Modified
- `programs/amm/src/instructions/swap_sol_pool.rs` - SwapDirection enum, SwapSolPool account struct, handler with full CEI-ordered swap logic
- `programs/amm/src/state/pool.rs` - Added locked: bool reentrancy guard field (INIT_SPACE 223->224)
- `programs/amm/src/errors.rs` - 5 new swap error variants (SlippageExceeded, PoolNotInitialized, PoolLocked, VaultMismatch, InvalidMint)
- `programs/amm/src/events.rs` - SwapEvent struct with 12 fields for indexer/frontend consumption
- `programs/amm/src/instructions/mod.rs` - Added swap_sol_pool module and glob re-export
- `programs/amm/src/lib.rs` - Added swap_sol_pool entry point with lifetime annotations
- `programs/amm/tests/test_pool_initialization.rs` - Updated PoolStateView for new locked field byte offset

## Decisions Made
- **Explicit lifetime annotations required:** The handler signature needs `Context<'_, '_, 'info, 'info, SwapSolPool<'info>>` because `pool.to_account_info()` and `ctx.remaining_accounts` must share the same lifetime for transfer helper calls. This is the standard Anchor pattern for instructions that use `remaining_accounts` with typed account structs.
- **Save immutable pool fields before mutations:** Anchor's Account type uses RefCell internally. Once any field is mutated (e.g., `pool.locked = true`), reading other fields through the same reference causes borrow conflicts. All needed pool values (mint keys, bump, fee, reserves, token programs) are captured into local variables at the top of the handler before any mutations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed integration test PoolStateView for locked field byte offset**
- **Found during:** Task 1 (adding locked field to PoolState)
- **Issue:** Integration tests `test_initialize_mixed_pool` and `test_initialize_pure_t22_pool` manually deserialize PoolState from raw bytes. Adding `locked: bool` shifted all subsequent fields by 1 byte, causing incorrect deserialization (bump read as 0, token_program_a read as wrong key).
- **Fix:** Added `locked: bool` field to `PoolStateView` struct and corresponding byte read in `read_pool_state()` function.
- **Files modified:** `programs/amm/tests/test_pool_initialization.rs`
- **Verification:** All 13 pool initialization tests pass
- **Committed in:** `9c545a5` (Task 1 commit)

**2. [Rule 3 - Blocking] Added explicit lifetime annotations to handler signature**
- **Found during:** Task 2 (implementing swap handler)
- **Issue:** Default `Context<SwapSolPool>` signature causes lifetime conflicts when `pool.to_account_info()` result is used alongside `ctx.remaining_accounts` in transfer helper calls. Compiler error: "lifetime may not live long enough".
- **Fix:** Changed handler signature to `handler<'info>(ctx: Context<'_, '_, 'info, 'info, SwapSolPool<'info>>, ...)` and matching entry point in lib.rs.
- **Files modified:** `programs/amm/src/instructions/swap_sol_pool.rs`, `programs/amm/src/lib.rs`
- **Verification:** Anchor build compiles with zero errors
- **Committed in:** `56c496a` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes necessary for compilation and test correctness. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- swap_sol_pool instruction is compiled and in the IDL, ready for integration testing (11-02)
- All existing tests (26 unit + 13 pool init + 8 transfer routing = 47) pass with zero regressions
- The instruction follows the same patterns that swap_profit_pool (Phase 12) will use, establishing the direction-based routing pattern
- CPI access control (Phase 13) can target this instruction via Tax Program PDA

---
*Phase: 11-sol-pool-swaps*
*Completed: 2026-02-04*
