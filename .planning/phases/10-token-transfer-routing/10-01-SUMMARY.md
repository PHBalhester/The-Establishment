---
phase: 10-token-transfer-routing
plan: 01
subsystem: amm
tags: [token-2022, transfer-hook, spl-token, cpi, anchor, transfer-checked]

# Dependency graph
requires:
  - phase: 08-foundation-scaffolding
    provides: "helpers/mod.rs module structure, AmmError enum"
  - phase: 09-pool-initialization
    provides: "InvalidTokenProgram error variant, token program validation pattern"
provides:
  - "transfer_t22_checked() helper for Token-2022 transfers with hook account passthrough"
  - "transfer_spl() helper for standard SPL Token transfers"
  - "ZeroAmount error variant in AmmError"
affects: [11-sol-pool-swap, 12-profit-pool-swap, 13-cpi-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CPI via token_interface::transfer_checked with with_remaining_accounts for hook forwarding"
    - "Defense-in-depth token program ID validation before CPI"
    - "Signer seeds branching for PDA-signed vs user-signed transfers"

key-files:
  created:
    - "programs/amm/src/helpers/transfers.rs"
  modified:
    - "programs/amm/src/helpers/mod.rs"
    - "programs/amm/src/errors.rs"

key-decisions:
  - "Raw AccountInfo parameters (not typed Anchor accounts) for maximum flexibility across instruction contexts"
  - "Conditional with_remaining_accounts only when hook_accounts is non-empty (avoids empty vec allocation)"
  - "Mutable cpi_ctx binding for T22 helper to conditionally append remaining accounts"

patterns-established:
  - "Transfer helper pattern: validate program ID, validate amount, build CPI accounts, branch on signer_seeds, call transfer_checked"
  - "Hook account forwarding: caller passes pre-resolved accounts, helper forwards via with_remaining_accounts"

# Metrics
duration: 2min
completed: 2026-02-04
---

# Phase 10 Plan 01: Transfer Routing Helpers Summary

**Two transfer helpers (T22 with hook passthrough, SPL without) using transfer_checked CPI with defense-in-depth validation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-04T15:36:16Z
- **Completed:** 2026-02-04T15:37:55Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `transfer_t22_checked()` for Token-2022 transfers with hook account forwarding via `with_remaining_accounts`
- Created `transfer_spl()` for standard SPL Token transfers without hook accounts
- Both helpers validate token program ID and amount > 0 before CPI (defense-in-depth)
- Both support PDA-signed (vault-to-user) and user-signed (user-to-vault) via signer_seeds branching
- Added ZeroAmount error variant to AmmError enum
- All 39 existing tests pass (zero regressions), anchor build compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ZeroAmount error variant** - `be48921` (feat)
2. **Task 2: Create transfer routing helpers and wire module** - `a27631a` (feat)

## Files Created/Modified
- `programs/amm/src/helpers/transfers.rs` - Two public transfer helper functions (T22 and SPL)
- `programs/amm/src/helpers/mod.rs` - Added `pub mod transfers` declaration
- `programs/amm/src/errors.rs` - Added `ZeroAmount` error variant under Phase 10 section

## Decisions Made
- Used raw `AccountInfo` parameters rather than typed Anchor accounts -- maximizes flexibility since these helpers will be called from multiple instruction contexts with different account struct shapes
- Conditional `with_remaining_accounts` call (only when hook_accounts is non-empty) -- avoids unnecessary empty vec allocation on the happy path
- Used `mut cpi_ctx` binding in T22 helper for conditional remaining account attachment -- cleaner than nested if/else with duplicate `transfer_checked` calls

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Transfer helpers ready for consumption by swap instruction handlers in Phases 11-13
- Unused function warnings expected until swap instructions import these helpers
- Phase 10-02 (transfer routing tests) can now test these helpers in isolation

---
*Phase: 10-token-transfer-routing*
*Completed: 2026-02-04*
