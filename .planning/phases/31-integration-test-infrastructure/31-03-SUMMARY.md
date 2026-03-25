---
phase: 31-integration-test-infrastructure
plan: 03
subsystem: testing
tags: [anchor, token-2022, transfer-hook, amm, staking, tax-program, integration-test, invoke-signed, cpi]

# Dependency graph
requires:
  - phase: 31-02
    provides: initializeProtocol() function and ProtocolState interface
  - phase: 31-01
    provides: constants.ts (PDA seeds, helpers) and test-wallets.ts (role-based wallets)
  - phase: 30
    provides: Correct program IDs across all 5 programs
provides:
  - Integration smoke tests proving both major CPI paths (Tax->AMM->T22->Hook, Staking->T22->Hook)
  - Custom test runner script for upgradeable program deployment
  - Fixed AMM transfer_t22_checked using manual invoke_signed (was broken with Anchor CPI)
  - Satisfies INTEG-01: All 5 programs load into single local validator and pass smoke test
affects: [32, 33, 34, 35, 36]

# Tech tracking
tech-stack:
  added:
    - "scripts/run-integration-tests.sh (custom validator with --upgradeable-program)"
  patterns:
    - "Manual invoke_signed for Token-2022 Transfer Hook CPI (Anchor SPL bug workaround)"
    - "resolveHookAccounts() using createTransferCheckedWithTransferHookInstruction + keys.slice(4)"
    - "Carnage SOL vault requires rent-exempt funding before first tax deposit"
    - "anchor test --bpf-program makes programs non-upgradeable; use --upgradeable-program for ProgramData verification"

key-files:
  created:
    - tests/integration/smoke.test.ts
    - scripts/run-integration-tests.sh
  modified:
    - programs/amm/src/helpers/transfers.rs
    - programs/amm/src/instructions/initialize_pool.rs
    - programs/amm/src/lib.rs
    - tests/integration/helpers/protocol-init.ts

key-decisions:
  - "AMM transfer_t22_checked uses manual invoke_signed (not Anchor CPI) to properly forward Transfer Hook accounts"
  - "Custom run-integration-tests.sh bypasses anchor test to deploy programs as upgradeable"
  - "Carnage SOL vault funded with rent-exempt minimum during protocol init"
  - "Admin T22 token accounts whitelisted in Step 6b before pool seed liquidity transfers"

patterns-established:
  - "Manual invoke_signed for all T22 Transfer Hook CPI (both AMM and Staking programs)"
  - "Hook account resolution pattern: createTransferCheckedWithTransferHookInstruction -> keys.slice(4)"
  - "canonicalOrder() helper for determining mint A/B from arbitrary mint pair"

# Metrics
duration: ~50min
completed: 2026-02-10
---

# Phase 31 Plan 03: Integration Test Suites Summary

**2 smoke tests proving Tax->AMM->Token-2022->TransferHook and Staking->Token-2022->TransferHook CPI paths, with critical AMM transfer hook bug fix via manual invoke_signed**

## Performance

- **Duration:** ~50 min (across context boundary)
- **Started:** 2026-02-10
- **Completed:** 2026-02-10
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Both smoke tests pass (2/2) proving the full integration test infrastructure works end-to-end
- Fixed critical AMM bug: Anchor's `token_interface::transfer_checked` with `with_remaining_accounts` does NOT forward hook accounts through nested CPI (AMM -> Token-2022 -> Transfer Hook). Replaced with manual `invoke_signed` matching staking program's working pattern.
- Created custom test runner (`scripts/run-integration-tests.sh`) that deploys programs as upgradeable, solving the `anchor test` limitation of non-upgradeable deployment
- SOL buy swap test proves the full 4-program CPI chain: Tax Program -> AMM -> Token-2022 -> Transfer Hook
- Stake PROFIT test proves Staking -> Token-2022 -> Transfer Hook path in shared environment

## Task Commits

Each task was committed atomically:

1. **Task 1: Create smoke.test.ts** - `cafe2c0` (feat)
2. **Task 2: Fix integration test failures** - `5a14b14` (fix)

## Files Created/Modified

- `tests/integration/smoke.test.ts` - 2 smoke tests with resolveHookAccounts() and canonicalOrder() helpers
- `scripts/run-integration-tests.sh` - Custom test runner with --upgradeable-program flags
- `programs/amm/src/helpers/transfers.rs` - transfer_t22_checked rewritten to use manual invoke_signed
- `programs/amm/src/instructions/initialize_pool.rs` - Hook-aware transfers for pool seed liquidity
- `programs/amm/src/lib.rs` - Updated initialize_pool signature for remaining_accounts
- `tests/integration/helpers/protocol-init.ts` - Admin whitelist Step 6b, hook accounts for initPool, carnage vault funding

## Decisions Made

1. **AMM transfer_t22_checked uses manual invoke_signed** -- Anchor's `token_interface::transfer_checked` with `with_remaining_accounts()` does not properly forward remaining_accounts through nested CPI chains. The Token-2022 program needs hook accounts in both the instruction's `ix.accounts` AND the `account_infos` passed to `invoke_signed`. The manual approach (identical to staking program's `transfer_checked_with_hook`) builds the raw SPL Token 2022 instruction, appends hook accounts to both vectors, then calls `invoke_signed` directly. This is a known Anchor SPL limitation.

2. **Custom test runner instead of anchor test** -- `anchor test` deploys programs via `--bpf-program` which makes them non-upgradeable (no `upgrade_authority_address` in ProgramData). The AMM's `InitializeAdmin` instruction verifies the deployer via ProgramData, which requires `--upgradeable-program` deployment. Anchor 0.32.1 doesn't properly support `[[test.validator.upgradeable_program]]` in Anchor.toml.

3. **Carnage SOL vault requires rent-exempt funding** -- The Epoch Program's `initializeCarnageFund` creates the SOL vault as a SystemAccount PDA (not `init`), so it starts with 0 lamports. Tax distribution sends 24% of tax (~720,000 lamports on small swaps) which is below rent-exempt minimum (~890,880 lamports for 0-byte accounts). Protocol init now funds it.

4. **Admin T22 accounts need whitelisting before pool init** -- Pool seed liquidity transfers use Token-2022 `transfer_checked` with Transfer Hook. The hook's whitelist requires at least one party (source or dest) to be whitelisted. Admin token accounts are the source, so they need whitelist entries before pool initialization.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AMM transfer_t22_checked broken for Transfer Hook CPI**
- **Found during:** Task 2 (running integration tests)
- **Issue:** Anchor's `token_interface::transfer_checked` with `with_remaining_accounts()` does not forward hook accounts through the nested CPI chain (AMM -> Token-2022 -> Transfer Hook). Token-2022 logs "Unknown program" for the hook and fails with "An account required by the instruction is missing."
- **Fix:** Rewrote `transfer_t22_checked` to use manual `spl_token_2022::instruction::transfer_checked` + `invoke_signed`, appending hook accounts to both `ix.accounts` and `account_infos`. Same approach as staking program's working `transfer_checked_with_hook`.
- **Files modified:** `programs/amm/src/helpers/transfers.rs`
- **Verification:** Integration tests pass with CRIME token transfer succeeding through full CPI chain
- **Committed in:** `5a14b14`

**2. [Rule 1 - Bug] AMM initialize_pool doesn't support Transfer Hook tokens**
- **Found during:** Task 2 (pool initialization failing)
- **Issue:** `initialize_pool` handler used Anchor's built-in `transfer_checked` which doesn't forward `remaining_accounts` for Transfer Hook. Pool seed liquidity transfers for CRIME/FRAUD/PROFIT tokens (all Token-2022 with hooks) would fail.
- **Fix:** Changed handler to accept `remaining_accounts` via `Context<'_, '_, 'info, 'info, InitializePool<'info>>`, branch on token program type (T22 vs SPL), and use hook-aware `transfer_t22_checked` for T22 mints.
- **Files modified:** `programs/amm/src/instructions/initialize_pool.rs`, `programs/amm/src/lib.rs`
- **Verification:** All 4 pools (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT) initialize successfully
- **Committed in:** `5a14b14`

**3. [Rule 3 - Blocking] anchor test deploys non-upgradeable programs**
- **Found during:** Task 2 (AdminConfig initialization failing)
- **Issue:** `anchor test` uses `--bpf-program` flag which makes programs non-upgradeable, causing AMM's `InitializeAdmin` to fail with ConstraintRaw error (ProgramData has no upgrade authority).
- **Fix:** Created `scripts/run-integration-tests.sh` that starts `solana-test-validator` manually with `--upgradeable-program` flags, sets NODE_OPTIONS for Node 24 ESM, and configures ANCHOR_PROVIDER_URL/ANCHOR_WALLET env vars.
- **Files modified:** `scripts/run-integration-tests.sh` (new)
- **Verification:** AdminConfig initializes successfully, all 5 programs deploy as upgradeable
- **Committed in:** `5a14b14`

**4. [Rule 2 - Missing Critical] Admin T22 accounts not whitelisted for pool init**
- **Found during:** Task 2 (pool initialization failing with NoWhitelistedParty)
- **Issue:** Pool seed liquidity transfers from admin token accounts to pool vaults require Transfer Hook whitelist. Admin CRIME, FRAUD, PROFIT accounts were not whitelisted.
- **Fix:** Added Step 6b in protocol-init.ts to whitelist admin T22 token accounts before pool initialization. Also built and passed hook remaining_accounts to initPool helper.
- **Files modified:** `tests/integration/helpers/protocol-init.ts`
- **Verification:** All 4 pools initialize with seed liquidity transfers through Transfer Hook
- **Committed in:** `5a14b14`

**5. [Rule 1 - Bug] Carnage SOL vault has 0 lamports (rent check failure)**
- **Found during:** Task 2 (swap simulation failing with "insufficient funds for rent")
- **Issue:** Epoch Program's `initializeCarnageFund` creates SOL vault as SystemAccount PDA (not `init`), starting with 0 lamports. Tax distribution sends ~720,000 lamports (24% of 3% tax on 0.1 SOL) which is below rent-exempt minimum (~890,880 lamports).
- **Fix:** Added SOL transfer to fund carnage SOL vault with `getMinimumBalanceForRentExemption(0)` lamports during protocol init.
- **Files modified:** `tests/integration/helpers/protocol-init.ts`
- **Verification:** Swap succeeds, carnage vault receives tax without rent failure
- **Committed in:** `5a14b14`

---

**Total deviations:** 5 auto-fixed (2 bugs, 1 missing critical, 1 blocking, 1 bug)
**Impact on plan:** All auto-fixes were necessary for correct operation. The AMM transfer hook bug (deviation 1) is the most significant -- it was a latent bug in the AMM program that would have caused all T22 token swaps to fail in production. No scope creep.

## Issues Encountered

- **Node 24 ESM resolution**: Node 24 defaults to ESM module resolution, causing TypeScript imports without `.ts` extensions to fail. Fixed with `NODE_OPTIONS="--loader ts-node/esm --no-warnings"` in the test runner script.
- **Anchor 0.32.1 `[[test.validator.upgradeable_program]]` ignored**: Despite documentation, this config section doesn't work in Anchor 0.32.1. Custom test runner was the workaround.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 31 (Integration Test Infrastructure) is COMPLETE:
- All 3 plans shipped: constants + test-wallets, protocol-init, smoke tests
- 2/2 smoke tests pass proving both major CPI paths
- Full integration test infrastructure ready for Phase 32+ test authoring
- Custom test runner handles upgradeable program deployment

Concerns for future phases:
- AMM's existing unit tests (19 failures) still need swap_authority PDA updates (Phase 32)
- Tax Program's existing SOL swap tests (10 failures) need AMM pool vault setup (Phase 32)
- The `anchor test` vs custom script divergence should be documented for contributors

---
*Phase: 31-integration-test-infrastructure*
*Completed: 2026-02-10*
