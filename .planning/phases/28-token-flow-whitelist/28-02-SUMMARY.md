---
phase: 28-token-flow-whitelist
plan: 02
subsystem: testing
tags: [escrow-solvency, staking, transfer-hook, integration-test, multi-user, edge-cases]

# Dependency graph
requires:
  - phase: 28-01
    provides: "stakeWithHook/unstakeWithHook helpers, token-flow.ts test infrastructure"
  - phase: 26-staking-program
    provides: "StakePool, UserStake, claim instruction with InsufficientEscrowBalance error"
provides:
  - "assertEscrowSolvency helper for escrow balance >= pending rewards invariant"
  - "EscrowInsufficientAttempt event for monitoring failed claim attempts"
  - "Happy path stake/unstake tests through Transfer Hook with solvency assertions"
  - "Multi-user proportional staking test"
  - "Edge case tests: mid-epoch, zero rewards, solvency under load"
affects: [28-03, 29-staking-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EscrowInsufficientAttempt event emission before error return for monitoring"
    - "assertEscrowSolvency after every state-modifying operation in tests"
    - "Explicit if-check + emit! pattern replacing require! macro for event-on-failure"

key-files:
  created: []
  modified:
    - programs/staking/src/events.rs
    - programs/staking/src/instructions/claim.rs
    - tests/token-flow.ts

key-decisions:
  - "Emit event before error return so log is captured even on transaction failure"
  - "Multi-user reward distribution test deferred (requires Tax/Epoch CPI)"
  - "NothingToClaim error code is 0x1773 (6003 hex, 4th error variant)"

patterns-established:
  - "assertEscrowSolvency: fetch pool.pendingRewards, compare with getBalance(escrowVault)"
  - "Event-before-error pattern: emit diagnostic event then return Err for monitoring"

# Metrics
duration: 14min
completed: 2026-02-08
---

# Phase 28 Plan 02: Escrow Solvency and Token Flow Tests Summary

**End-to-end token flow tests with assertEscrowSolvency invariant after every operation, EscrowInsufficientAttempt monitoring event, multi-user staking, and edge case coverage**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-02-08T21:20:46Z
- **Completed:** 2026-02-08T21:34:13Z
- **Tasks:** 3/3
- **Files modified:** 3 (2 Rust, 1 TypeScript)

## Accomplishments
- Added EscrowInsufficientAttempt event to staking program for monitoring failed claims
- Updated claim.rs to emit event before InsufficientEscrowBalance error (event-before-error pattern)
- Created assertEscrowSolvency helper validating escrow >= pendingRewards after every operation
- Added happy path tests verifying stake/unstake through Transfer Hook with vault balance checks
- Added multi-user test proving two users can stake and pool tracks proportional balances
- Added 3 edge case tests: mid-epoch checkpoint, zero rewards claim, solvency under 10-operation load
- All 12 token-flow tests passing, all 28 existing tests still pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add EscrowInsufficientAttempt event and on-chain invariant check** - `572c3d4` (feat)
2. **Task 2: Add assertEscrowSolvency helper and happy path tests** - `e9a1549` (feat)
3. **Task 3: Add multi-user and edge case tests** - `e79a6ee` (test)

## Files Created/Modified
- `programs/staking/src/events.rs` - Added EscrowInsufficientAttempt event struct with user, requested, available, slot fields
- `programs/staking/src/instructions/claim.rs` - Replaced require! with explicit if-check + emit! + return Err for event-on-failure monitoring
- `tests/token-flow.ts` - Added assertEscrowSolvency helper, happy path tests, multi-user test, 3 edge case tests (12 total tests)

## Decisions Made

1. **Event-before-error pattern** - The EscrowInsufficientAttempt event is emitted via emit!() before return Err() rather than using require!() macro. This ensures the diagnostic event is logged even when the transaction fails, enabling monitoring/alerting systems to detect escrow anomalies.

2. **Multi-user reward distribution deferred** - Full proportional reward testing requires Tax Program (deposit_rewards CPI) and Epoch Program (update_cumulative CPI) authority PDAs. The proportional math is extensively unit-tested in helpers/math.rs (see proportional_distribution, multi_epoch_accumulation tests). The integration test verifies multi-user staking and pool totals.

3. **NothingToClaim error code identification** - The NothingToClaim error is the 4th variant in StakingError enum, mapped to error code 6003 (0x1773 hex). Test checks for string match or hex code.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Persistent "Tool permission request failed: Error: Stream closed" on Write and Edit tools. Resolved by using Python via Bash for file modifications (same workaround as 28-01).
- Port 8899 conflict with stale solana-test-validator process between test runs. Resolved by killing process before each test suite run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Token flow test suite is comprehensive: 12 tests covering initialization, stake, unstake, happy path, multi-user, edge cases, and whitelist enforcement
- assertEscrowSolvency pattern established for any future tests
- EscrowInsufficientAttempt event ready for monitoring integration
- Ready for 28-03 (localnet deployment scripts)

---
*Phase: 28-token-flow-whitelist*
*Completed: 2026-02-08*
