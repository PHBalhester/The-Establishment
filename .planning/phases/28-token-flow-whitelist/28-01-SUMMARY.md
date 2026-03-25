---
phase: 28-token-flow-whitelist
plan: 01
subsystem: testing
tags: [token-2022, transfer-hook, whitelist, staking, remaining-accounts, integration-test, cpi-fix]

# Dependency graph
requires:
  - phase: 26-staking-program
    provides: "StakePool, StakeVault, UserStake accounts and stake/unstake instructions"
  - phase: 14-transfer-hook
    provides: "Transfer Hook whitelist program with addWhitelistEntry, ExtraAccountMetaList"
provides:
  - "tests/token-flow.ts with Transfer Hook integration test infrastructure"
  - "stakeWithHook and unstakeWithHook helper functions"
  - "Proven whitelist enforcement via NoWhitelistedParty negative test"
  - "Manual hook account derivation pattern for pre-init transfers"
  - "transfer_checked_with_hook helper for Token-2022 CPI with Transfer Hook support"
affects: [28-02, 28-03, 29-staking-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "transfer_checked_with_hook: manual CPI bypassing Anchor SPL transfer_checked remaining_accounts bug"
    - "Manual hook account derivation for pre-init transfers (stakeVault not yet created)"
    - "createTransferCheckedWithTransferHookInstruction for dynamic ExtraAccountMeta resolution"
    - "remaining_accounts extraction via .keys.slice(4) for hook passthrough"
    - "StakeVault-only whitelist (source OR dest check eliminates need for user whitelist)"

key-files:
  created:
    - tests/token-flow.ts
    - programs/staking/src/helpers/transfer.rs
  modified:
    - programs/staking/src/helpers/mod.rs
    - programs/staking/src/instructions/stake.rs
    - programs/staking/src/instructions/unstake.rs
    - programs/staking/src/instructions/initialize_stake_pool.rs
    - Anchor.toml

key-decisions:
  - "Created transfer_checked_with_hook to bypass Anchor SPL remaining_accounts bug in CPI"
  - "Manual hook account derivation for dead stake init since stakeVault not yet created"
  - "StakeVault-only whitelisting (no user token account whitelist needed due to source OR dest check)"
  - "Singleton StakePool PDA means token-flow.ts runs in separate validator from staking.ts"

patterns-established:
  - "transfer_checked_with_hook: manually build instruction + append remaining_accounts + invoke_signed"
  - "stakeWithHook: resolve ExtraAccountMetas via createTransferCheckedWithTransferHookInstruction, extract .keys.slice(4), pass as remainingAccounts"
  - "unstakeWithHook: same pattern but stakePool PDA as transfer authority, stakeVault as source"
  - "Dead stake hook accounts: [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]"

# Metrics
duration: 45min
completed: 2026-02-08
---

# Phase 28 Plan 01: Transfer Hook Integration Test Suite Summary

**Token-2022 Transfer Hook integration tests with transfer_checked_with_hook CPI fix, stakeWithHook/unstakeWithHook helpers, manual hook account derivation for dead stake init, and NoWhitelistedParty negative test**

## Performance

- **Duration:** ~45 min (across 2 context resets)
- **Started:** 2026-02-08
- **Completed:** 2026-02-08
- **Tasks:** 3 (test file) + 1 critical bug fix (Rust CPI)
- **Files created:** 2 (tests/token-flow.ts, programs/staking/src/helpers/transfer.rs)
- **Files modified:** 5 (mod.rs, stake.rs, unstake.rs, initialize_stake_pool.rs, Anchor.toml)

## Accomplishments

- Created tests/token-flow.ts with 6 passing integration tests covering full Transfer Hook whitelist flow
- Discovered and fixed critical Anchor SPL bug: transfer_checked does not forward remaining_accounts to invoke_signed
- Created `transfer_checked_with_hook` helper in `programs/staking/src/helpers/transfer.rs` for proper Token-2022 CPI
- Updated all 3 staking instructions (stake, unstake, initialize_stake_pool) to use new CPI helper
- Established stakeWithHook and unstakeWithHook helper functions using ExtraAccountMeta dynamic resolution
- Proved NoWhitelistedParty error (0x1770) fires correctly when neither party is whitelisted
- Discovered and implemented manual hook account derivation for dead stake init (stakeVault pre-creation)
- Eliminated unnecessary user token account whitelisting (stakeVault whitelist is sufficient)
- All 28 existing tests still pass with the Rust CPI changes
- All 6 new token-flow tests pass

## Task Commits

1. **Tasks 1-3: Token-flow integration test suite** - `04d0e0a` (feat)
   - tests/token-flow.ts: whitelist init, stakeWithHook/unstakeWithHook helpers, negative test
   - Anchor.toml: test script updated for token-flow.ts

2. **Critical CPI fix: transfer_checked_with_hook** - `8891246` (fix)
   - programs/staking/src/helpers/transfer.rs (new): manual CPI with remaining_accounts
   - programs/staking/src/helpers/mod.rs: added transfer module
   - programs/staking/src/instructions/stake.rs: use transfer_checked_with_hook
   - programs/staking/src/instructions/unstake.rs: use transfer_checked_with_hook
   - programs/staking/src/instructions/initialize_stake_pool.rs: use transfer_checked_with_hook
   - Anchor.toml: restored test script to include all suites

## Critical Bug Discovery: Anchor SPL transfer_checked

**Root cause:** Anchor SPL's `transfer_checked` in `anchor-spl-0.32.1/src/token_2022.rs` calls `invoke_signed` with only 4 hardcoded accounts: `[from, mint, to, authority]`. It completely ignores `CpiContext.remaining_accounts` even when set via `.with_remaining_accounts()`.

**Impact:** Any Token-2022 transfer using Transfer Hook extension fails with "An account required by the instruction is missing" because Token-2022 cannot find the hook accounts (ExtraAccountMetaList, whitelist PDAs, hook program) during CPI.

**Fix:** Created `transfer_checked_with_hook` in `programs/staking/src/helpers/transfer.rs` that:
1. Builds the base `transfer_checked` instruction via `spl_token_2022::instruction::transfer_checked`
2. Appends all remaining_accounts to the instruction's `accounts` vec
3. Builds complete `account_infos` list (standard 4 + remaining)
4. Calls `invoke_signed` directly with the full account set

**Evidence:** Direct transfers (non-CPI) with the hook succeeded, but CPI transfers through Anchor failed. Tracing to the Anchor SPL source confirmed the remaining_accounts drop.

## Decisions Made

1. **transfer_checked_with_hook helper** - Rather than patching Anchor SPL or waiting for upstream fix, created a self-contained helper that manually constructs the CPI instruction. This is the same pattern used by other Solana projects encountering this limitation.

2. **Manual hook account derivation for dead stake init** - The `createTransferCheckedWithTransferHookInstruction` helper resolves ExtraAccountMetas dynamically. However, during `initializeStakePool`, the stakeVault token account does not exist yet (Anchor creates it in the same instruction). We manually derive the 4 hook accounts: `[extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]` using `PublicKey.findProgramAddressSync`.

3. **No user token account whitelisting needed** - The Transfer Hook checks source OR destination. Since stakeVault is whitelisted: stake (user->vault, dest whitelisted) and unstake (vault->user, source whitelisted) both pass. This eliminates a whitelist entry per user.

4. **Separate validator for token-flow.ts** - StakePool is a singleton PDA (seeds=["stake_pool"]). Both staking.ts and token-flow.ts need to initialize it with different mints (plain Token-2022 vs hooked Token-2022). Running them in the same validator would cause PDA conflicts.

5. **Single commit for all 3 test tasks** - All tasks produce content in the same file (tests/token-flow.ts). Splitting into 3 commits would require artificial partial-file gymnastics with no practical benefit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Anchor SPL transfer_checked does not forward remaining_accounts**
- **Found during:** Task 1 (initializeStakePool failed during test execution)
- **Issue:** Anchor SPL's `transfer_checked` CPI helper ignores `remaining_accounts`, causing Token-2022 Transfer Hook failures
- **Fix:** Created `transfer_checked_with_hook` helper that manually builds CPI with all accounts
- **Files created:** programs/staking/src/helpers/transfer.rs
- **Files modified:** helpers/mod.rs, stake.rs, unstake.rs, initialize_stake_pool.rs
- **Committed in:** 8891246

**2. [Rule 1 - Bug] Fixed dead stake hook account resolution**
- **Found during:** Task 1 (test setup and whitelist initialization)
- **Issue:** Original approach used `createTransferCheckedWithTransferHookInstruction` for dead stake transfer hook accounts, but stakeVault token account does not exist yet during `initializeStakePool` (it is created by the instruction itself)
- **Fix:** Manually derive the 4 hook accounts using `PublicKey.findProgramAddressSync` matching the ExtraAccountMeta seed layout
- **Files modified:** tests/token-flow.ts (Step 8 in before() hook)
- **Verification:** All 6 tests pass, dead stake transfer succeeds with hook validation
- **Committed in:** 04d0e0a

**3. [Rule 2 - Missing Critical] Removed unnecessary user token account whitelisting**
- **Found during:** Task 1 (analyzing Transfer Hook source code)
- **Issue:** Original plan assumed user token accounts need whitelisting, but `transfer_hook.rs` uses `is_whitelisted()` with short-circuit: if source OR dest is whitelisted, transfer passes
- **Fix:** Removed user token account whitelist entry creation; only stakeVault needs whitelisting
- **Files modified:** tests/token-flow.ts (Step 10 in before() hook)
- **Verification:** stake and unstake both succeed with only stakeVault whitelisted
- **Committed in:** 04d0e0a

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 missing critical)
**Impact on plan:** All fixes necessary for correctness. The Rust CPI fix was the critical discovery - without it, no Token-2022 transfer with Transfer Hook would work through CPI.

## Next Phase Readiness

- Transfer Hook integration test infrastructure is established
- stakeWithHook/unstakeWithHook helpers ready for use in subsequent plans
- WhitelistAuthority and StakeVault whitelist patterns proven
- transfer_checked_with_hook CPI helper available for all staking instructions
- Manual hook account derivation pattern documented for any future pre-init transfers
- All 34 tests passing (28 existing + 6 new token-flow)
- Ready for 28-02 (escrow solvency) and 28-03 (multi-user scenarios)

---
*Phase: 28-token-flow-whitelist*
*Completed: 2026-02-08*
