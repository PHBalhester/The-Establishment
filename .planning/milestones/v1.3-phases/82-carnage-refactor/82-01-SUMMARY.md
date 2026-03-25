---
phase: 82-carnage-refactor
plan: 01
subsystem: programs
tags: [rust, anchor, refactor, carnage, epoch-program, deduplication]

# Dependency graph
requires:
  - phase: 47-carnage-hardening
    provides: "Carnage execution logic with slippage floors, CPI depth chain, sell proceeds fix"
  - phase: 80-hardening-3
    provides: "read_pool_reserves is_reversed detection, hard error philosophy"
provides:
  - "Single-source-of-truth carnage_execution.rs shared module with CarnageAccounts + execute_carnage_core() + 7 helpers"
  - "SWAP_EXEMPT_DISCRIMINATOR promoted to constants.rs for cross-module validation"
  - "Both handlers reduced to thin wrappers (~30 line handler bodies)"
affects: [83-vrf-validation, carnage-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CarnageAccounts struct bundles shared accounts with mutable vault refs for reload()"
    - "execute_carnage_core() parameterized by slippage_bps and atomic flag"

key-files:
  created:
    - "programs/epoch-program/src/helpers/carnage_execution.rs"
  modified:
    - "programs/epoch-program/src/instructions/execute_carnage.rs"
    - "programs/epoch-program/src/instructions/execute_carnage_atomic.rs"
    - "programs/epoch-program/src/helpers/mod.rs"
    - "programs/epoch-program/src/constants.rs"

key-decisions:
  - "Vault fields in CarnageAccounts use &mut InterfaceAccount (not immutable &) because reload() requires &mut self"
  - "execute_carnage_core takes &mut CarnageAccounts to propagate vault mutability cleanly without unsafe"
  - "execute_swap_exempt_cpi uses to_account_info() on vault ref instead of borrowing &InterfaceAccount to build account_infos vec"

patterns-established:
  - "Shared CarnageAccounts struct: mutable vault refs, immutable pool/mint/program refs"
  - "Core function parameterized on slippage_bps and atomic flag, guards stay in handlers"

# Metrics
duration: 12min
completed: 2026-03-08
---

# Phase 82 Plan 01: Carnage Execution Deduplication Summary

**Extracted ~1500 lines of duplicated Carnage logic into shared carnage_execution.rs with CarnageAccounts struct, execute_carnage_core(), and 7 helpers -- both handlers shrunk from ~1000 to ~300 lines each**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-08T11:32:31Z
- **Completed:** 2026-03-08T11:44:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Eliminated maintenance hazard: bug fixes now apply once instead of twice
- Created 870-line shared module with all Carnage execution logic
- Both handlers reduced from ~1000 lines to ~300 lines (70% reduction)
- SWAP_EXEMPT_DISCRIMINATOR promoted to constants.rs with validation test (sets up Phase 83 VRF-10)
- All 83 unit tests pass, anchor build succeeds with no new warnings

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared carnage_execution.rs module and promote SWAP_EXEMPT_DISCRIMINATOR** - `082332b` (refactor)
2. **Task 2: Refactor both handlers to call shared core** - `f7aa095` (refactor)

## Files Created/Modified
- `programs/epoch-program/src/helpers/carnage_execution.rs` - New shared module: CarnageAccounts struct + execute_carnage_core() + 7 helpers + partition_hook_accounts()
- `programs/epoch-program/src/instructions/execute_carnage.rs` - Thin fallback handler: deadline+lock guard + core call (1004 -> 304 lines)
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` - Thin atomic handler: no-op guard + core call (1017 -> 299 lines)
- `programs/epoch-program/src/helpers/mod.rs` - Added carnage_execution module export
- `programs/epoch-program/src/constants.rs` - Added SWAP_EXEMPT_DISCRIMINATOR const + validation test

## Decisions Made
- **Vault mutability**: CarnageAccounts uses `&mut InterfaceAccount` for vaults (not `&` as plan suggested) because reload() requires `&mut self`. Clean solution without unsafe code.
- **Core function takes &mut CarnageAccounts**: Natural consequence of vault mutability -- avoids unsafe transmutes while supporting reload() calls within the core function.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CarnageAccounts vault references changed to &mut**
- **Found during:** Task 1 (Creating carnage_execution.rs)
- **Issue:** Plan specified `&InterfaceAccount<TokenAccount>` for vaults, but Anchor's `reload()` method requires `&mut self` to re-deserialize account data after CPI
- **Fix:** Changed vault fields to `&'a mut InterfaceAccount<'info, TokenAccount>` and core function signature to `&mut CarnageAccounts`
- **Files modified:** programs/epoch-program/src/helpers/carnage_execution.rs
- **Verification:** Compiles cleanly, all tests pass, no unsafe code needed
- **Committed in:** 082332b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correct operation. The plan's type suggestion was incompatible with Anchor's reload() API. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Shared module ready for Phase 83 VRF-10 validation test (SWAP_EXEMPT_DISCRIMINATOR in constants.rs)
- Carnage integration tests (CARN-02) should be validated in Phase 82 Plan 02

---
*Phase: 82-carnage-refactor*
*Completed: 2026-03-08*
