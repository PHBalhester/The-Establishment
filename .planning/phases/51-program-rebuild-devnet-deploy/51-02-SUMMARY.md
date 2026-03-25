---
phase: 51-program-rebuild-devnet-deploy
plan: 02
subsystem: testing
tags: [litesvm, tax-program, pda-validation, wsol-intermediary, native-mint, epoch-state, sec-10]

# Dependency graph
requires:
  - phase: 46-account-validation
    provides: PDA seed constraints on staking_escrow, carnage_vault, treasury, stake_pool, tax_authority
  - phase: 47-carnage-hardening
    provides: carnage_lock_slot field in EpochState (+8 bytes, 100->108 total)
  - phase: 48-sell-tax-wsol-intermediary
    provides: wsol_intermediary PDA account in SwapSolSell struct
  - phase: 49-protocol-safety-events
    provides: SEC-10 minimum output floor (50% of expected output)
  - phase: 50-program-maintenance
    provides: Feature-gated treasury_pubkey(), staking_program address constraint
provides:
  - All 8 test_swap_sol_buy tests passing with Phase 46-50 account requirements
  - All 6 test_swap_sol_sell tests passing with wsol_intermediary + native WSOL mint
  - Reusable safe_minimum_for_buy/sell helpers for SEC-10 floor compliance
affects: [51-03, 51-04, 51-05, 51-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Native WSOL mint in LiteSVM sell tests for correct close-and-reinit cycle behavior"
    - "fund_native_wsol() helper: SOL transfer + SyncNative for native token accounts"
    - "Mock StakePool PDA with correct discriminator for deposit_rewards CPI validation"

key-files:
  created: []
  modified:
    - programs/tax-program/tests/test_swap_sol_buy.rs
    - programs/tax-program/tests/test_swap_sol_sell.rs

key-decisions:
  - "Use real native WSOL mint (So111...2) in sell tests instead of synthetic SPL mint -- required for InitializeAccount3 to set is_native=Some(rent) during intermediary recreation"
  - "Add safe_minimum_for_buy/sell helpers that compute 51% of expected output (above 50% SEC-10 floor) instead of passing 0"
  - "Set mock EpochState to 108 bytes (was 100) to match Phase 47 carnage_lock_slot addition"
  - "Deploy staking program in test setup for deposit_rewards CPI target validation"

patterns-established:
  - "PDA mock accounts at correct addresses with proper discriminators for cross-program validation"
  - "Native WSOL token accounts with is_native=Some(rent) for close_account unwrap behavior"
  - "All Tax Program test contexts include tax_authority + stake_pool + staking_program (Phase 46)"

# Metrics
duration: 18min
completed: 2026-02-20
---

# Phase 51 Plan 02: Fix Tax Program SOL Swap Tests Summary

**14 Tax Program swap tests fixed by aligning test harness with Phase 46-50 on-chain account changes**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-02-20
- **Completed:** 2026-02-20
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Fixed all 8 test_swap_sol_buy tests (InvalidAccountData on pool_vault_b -> passing)
- Fixed all 6 test_swap_sol_sell tests (InvalidAccountData + missing wsol_intermediary -> passing)
- Zero on-chain code modifications -- only test harness files changed
- Tax Program test suite: buy (8/8) + sell (6/6) = 14/14 passing

## Root Cause Analysis

The plan hypothesized Token-2022 InterfaceAccount vaults as the root cause. Investigation revealed the actual root causes were:

1. **Missing accounts (Phase 46):** Three new accounts -- tax_authority, stake_pool, staking_program -- were added to SwapSolBuy/SwapSolSell structs but not the test instruction builders. This shifted all subsequent account positions, causing pool_vault_b to receive mint_a data (InvalidAccountData).

2. **EpochState layout mismatch (Phase 47):** EpochState gained carnage_lock_slot (u64, +8 bytes), making it 108 bytes instead of 100. Mock data at 100 bytes caused InvalidEpochState deserialization failure.

3. **SEC-10 output floor (Phase 49):** Tests passed minimum_output=0, violating the new 50% floor requirement. Added safe_minimum_for_buy/sell helpers computing 51% of expected output.

4. **PDA address validation (Phase 46):** staking_escrow, carnage_vault, and treasury now use PDA seeds constraints. Tests used random keypair addresses instead of correct PDA-derived addresses.

5. **Sell WSOL close-and-reinit (Phase 48):** wsol_intermediary must be a native WSOL token account (is_native=Some(rent)) for close_account to unwrap WSOL. Using real native mint (So111...2) ensures InitializeAccount3 recreates it correctly.

## Task Details

### Task 1: Fix test_swap_sol_buy.rs (8 failures)
- **Commit:** `6a48a6d`
- Added TAX_AUTHORITY_SEED, STAKE_POOL_SEED, ESCROW_VAULT_SEED, CARNAGE_SOL_VAULT_SEED constants
- Added staking_program_id(), treasury_pubkey() functions
- Added PDA derivation helpers and create_mock_stake_pool()
- Updated build_swap_sol_buy_ix: 17 -> 20 accounts (added tax_authority, stake_pool, staking_program)
- Fixed EpochState mock: 100 -> 108 bytes (added carnage_lock_slot)
- Deployed staking program in setup for deposit_rewards CPI
- Replaced random keypairs with correct PDA addresses for all distribution targets
- Added safe_minimum_for_buy() helper for SEC-10 floor compliance

### Task 2: Fix test_swap_sol_sell.rs (6 failures)
- **Commit:** `ba77b72`
- Same account additions as buy PLUS wsol_intermediary PDA
- Updated build_swap_sol_sell_ix: 17 -> 21 accounts
- Used real native WSOL mint (So111...2) instead of synthetic SPL mint
- Added fund_native_wsol() helper (SOL transfer + SyncNative)
- Created wsol_intermediary as native WSOL token account with is_native=Some(rent)
- Added safe_minimum_for_sell() helper for SEC-10 floor compliance

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan hypothesis was incorrect: root cause was missing accounts, not Token-2022 vaults**
- **Found during:** Task 1 investigation
- **Issue:** Plan identified Token-2022 InterfaceAccount vaults as the root cause. Actual root cause was 3 missing accounts shifting all positions after swap_authority.
- **Fix:** Added tax_authority, stake_pool, staking_program to instruction builder and test setup
- **Files modified:** test_swap_sol_buy.rs, test_swap_sol_sell.rs
- **Impact:** Same files, different approach than planned

**2. [Rule 2 - Missing Critical] EpochState layout mismatch (Phase 47)**
- **Found during:** Task 1, after fixing account positions
- **Issue:** Mock EpochState was 100 bytes but on-chain struct is 108 bytes (Phase 47 added carnage_lock_slot)
- **Fix:** Added carnage_lock_slot (u64, 8 bytes) to mock, changed assertion to 108
- **Commits:** 6a48a6d, ba77b72

**3. [Rule 2 - Missing Critical] SEC-10 minimum output floor violation**
- **Found during:** Task 1, after fixing EpochState
- **Issue:** Tests passed minimum_output=0, violating Phase 49's 50% floor requirement
- **Fix:** Added safe_minimum_for_buy/sell helpers computing 51% of expected output
- **Commits:** 6a48a6d, ba77b72

**4. [Rule 3 - Blocking] Consecutive sell test required native WSOL mint**
- **Found during:** Task 2
- **Issue:** Synthetic SPL mint caused InitializeAccount3 to create non-native intermediary, failing close_account with "Non-native account can only be closed if its balance is zero"
- **Fix:** Replaced synthetic SPL mint with real native WSOL mint (So111...2), added fund_native_wsol helper
- **Commit:** ba77b72

## Verification

```
$ cargo test -p tax-program --test test_swap_sol_buy --test test_swap_sol_sell

running 8 tests
test result: ok. 8 passed; 0 failed

running 6 tests
test result: ok. 6 passed; 0 failed
```

## Next Phase Readiness

Plan 51-02 complete. No blockers for subsequent plans.

Note: 3 test_swap_profit_buy tests also fail with MinimumOutputFloorViolation (SEC-10). These are not in the 51-02 scope but should be addressed in a future plan.
