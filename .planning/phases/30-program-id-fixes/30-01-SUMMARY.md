---
phase: 30-program-id-fixes
plan: 01
subsystem: infra
tags: [anchor, keypairs, program-ids, declare-id, cross-program, devnet]

# Dependency graph
requires:
  - phase: 26-29 (v0.6 Staking/Yield)
    provides: All 5 production programs + 3 test helpers built
provides:
  - Reconciled keypairs/ directory (source of truth for all 8 programs)
  - Correct declare_id! macros matching keypairs
  - Fixed Tax Program epoch_program_id() and staking_program_id()
  - Updated all stale test program IDs
  - Anchor.toml [programs.devnet] section with 5 production IDs
affects: [31-anchor-build, 32-cross-program-wiring, 35-devnet-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "keypairs/ directory is single source of truth for program keypairs"
    - "target/deploy/ copied from keypairs/ before anchor keys sync"
    - "[programs.devnet] mirrors [programs.localnet] for production programs"

key-files:
  created:
    - keypairs/amm-keypair.json
    - keypairs/staking-keypair.json
  modified:
    - keypairs/tax-program-keypair.json
    - keypairs/mock-tax-keypair.json
    - keypairs/fake-tax-keypair.json
    - programs/tax-program/src/constants.rs
    - programs/staking/src/lib.rs
    - programs/amm/src/lib.rs
    - programs/mock-tax-program/src/lib.rs
    - programs/fake-tax-program/src/lib.rs
    - programs/amm/tests/test_cpi_access_control.rs
    - programs/amm/tests/test_swap_sol_pool.rs
    - programs/amm/tests/test_swap_profit_pool.rs
    - programs/amm/tests/test_pool_initialization.rs
    - programs/amm/tests/test_transfer_routing.rs
    - programs/tax-program/tests/test_swap_sol_buy.rs
    - programs/tax-program/tests/test_swap_sol_sell.rs
    - programs/tax-program/tests/test_swap_exempt.rs
    - Anchor.toml

key-decisions:
  - "Generated new random Staking keypair (option-b) because vanity StakFwVR... keypair was never saved"
  - "Grind vanity addresses deferred to pre-mainnet (user wants to discuss prefix choices)"

patterns-established:
  - "keypairs/ is canonical source -> copy to target/deploy/ -> anchor keys sync -> declare_id! updated"

# Metrics
duration: 6min
completed: 2026-02-09
---

# Phase 30 Plan 01: Keypair Reconciliation Summary

**Reconciled all 8 program keypairs, fixed epoch_program_id() critical blocker, replaced all stale test IDs, added devnet config**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-09T23:02:54Z
- **Completed:** 2026-02-09T23:08:52Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments

- All 8 program keypair files in keypairs/ match their declare_id! macros and target/deploy/ counterparts
- Tax Program epoch_program_id() now returns real Epoch Program ID (AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod) -- unblocks all Carnage CPI paths
- Tax Program staking_program_id() updated to new Staking ID (Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi)
- Zero stale/placeholder program IDs remain in any program source or test file
- Anchor.toml has [programs.devnet] section with all 5 production program IDs

## Task Commits

Each task was committed atomically:

1. **Task 1: Reconcile all keypairs and sync declare_id! macros** - `1914d28` (feat)
2. **Task 2: Fix cross-program ID references, test IDs, and Anchor.toml** - `7c2ccd6` (fix)

## Files Created/Modified

- `keypairs/amm-keypair.json` - NEW: AMM program keypair (copied from target/deploy)
- `keypairs/staking-keypair.json` - NEW: Staking program keypair (generated, option-b)
- `keypairs/tax-program-keypair.json` - Overwritten with correct keypair from target/deploy
- `keypairs/mock-tax-keypair.json` - Overwritten with correct keypair from target/deploy
- `keypairs/fake-tax-keypair.json` - Overwritten with correct keypair from target/deploy
- `keypairs/taXaejVkdjrcJnnCYnvtMeBBnx5bufGcPAphxpZRTvz.json` - DELETED (stale vanity keypair)
- `programs/tax-program/src/constants.rs` - Fixed epoch_program_id() and staking_program_id()
- `programs/staking/src/lib.rs` - declare_id! updated to new keypair
- `programs/amm/src/lib.rs` - declare_id! synced (was already correct in target/deploy)
- `programs/mock-tax-program/src/lib.rs` - declare_id! synced
- `programs/fake-tax-program/src/lib.rs` - declare_id! synced + stale comment IDs fixed
- `programs/amm/tests/test_cpi_access_control.rs` - AMM, Mock Tax, Fake Tax IDs updated
- `programs/amm/tests/test_swap_sol_pool.rs` - AMM program ID updated
- `programs/amm/tests/test_swap_profit_pool.rs` - AMM program ID updated
- `programs/amm/tests/test_pool_initialization.rs` - AMM program ID updated
- `programs/amm/tests/test_transfer_routing.rs` - AMM program ID updated
- `programs/tax-program/tests/test_swap_sol_buy.rs` - Epoch placeholder replaced
- `programs/tax-program/tests/test_swap_sol_sell.rs` - Epoch placeholder replaced
- `programs/tax-program/tests/test_swap_exempt.rs` - Epoch placeholder replaced
- `Anchor.toml` - Staking ID updated + [programs.devnet] section added

## Program ID Reference (Final State)

| Program | ID | Keypair |
|---------|-----|---------|
| AMM | zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa | keypairs/amm-keypair.json |
| Epoch Program | AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod | keypairs/epoch-program.json |
| Tax Program | FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu | keypairs/tax-program-keypair.json |
| Transfer Hook | 9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ | keypairs/transfer-hook-keypair.json |
| Staking | Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi | keypairs/staking-keypair.json |
| Stub Staking | StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU | keypairs/StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU.json |
| Mock Tax | 9irnHg1ddyLeeDTcuXYMa8Zby7uafL5PpkZ7LPfzzNw9 | keypairs/mock-tax-keypair.json |
| Fake Tax | 7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ | keypairs/fake-tax-keypair.json |

## Decisions Made

1. **Generated new random Staking keypair (option-b)** -- The vanity address StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF was placed in declare_id! but the keypair file was never saved. User chose to generate a new random keypair rather than re-grind. Vanity address grinding deferred to pre-mainnet.

2. **Copied AMM, Mock Tax, Fake Tax keypairs from target/deploy/ to keypairs/** -- These programs had correct keypairs in target/deploy/ that matched their declare_id! macros but were missing or stale in keypairs/. The target/deploy/ versions were already the source of truth for these programs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale comment IDs in fake-tax-program/src/lib.rs**
- **Found during:** Task 1 (keypair reconciliation)
- **Issue:** Comments still referenced old Mock Tax ID (J5CK3BiY...) and old Fake Tax ID (EbN9johT...) while declare_id! was updated to new values
- **Fix:** Updated comment IDs to match current declare_id! values
- **Files modified:** programs/fake-tax-program/src/lib.rs
- **Verification:** Comments now match declare_id! values
- **Committed in:** 1914d28 (Task 1 commit)

**2. [Rule 1 - Bug] Cleaned up stale deployment checklist comments**
- **Found during:** Task 2 (cross-program ID fixes)
- **Issue:** Tax Program constants.rs had deployment checklists saying "TODO: Update with actual program ID" even though IDs were now set
- **Fix:** Replaced deployment checklists with concise comments pointing to source keypair files
- **Files modified:** programs/tax-program/src/constants.rs
- **Committed in:** 7c2ccd6 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2x Rule 1 - Bug)
**Impact on plan:** Both fixes prevent developer confusion from stale comments. No scope creep.

## Issues Encountered

None -- plan executed cleanly. The AMM, Mock Tax, and Fake Tax declare_id! changes were already present in the working tree (from prior work during v0.2/v0.3 milestones) and were committed as part of Task 1.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All program IDs are now consistent and correct
- Ready for `anchor build` (Phase 30 Plan 02) which requires correct declare_id! values
- Tax Program can now correctly reference Epoch Program for Carnage CPI validation
- Devnet deployment config ready in Anchor.toml

---
*Phase: 30-program-id-fixes*
*Completed: 2026-02-09*
