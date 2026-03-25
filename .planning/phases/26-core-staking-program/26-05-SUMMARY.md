---
phase: 26-core-staking-program
plan: 05
subsystem: staking
tags: [rust, anchor, claim, testing, mocha, chai, solana]

# Dependency graph
requires:
  - phase: 26-01
    provides: State accounts (StakePool, UserStake) and constants
  - phase: 26-02
    provides: Math helpers (update_rewards, add_to_cumulative)
  - phase: 26-03
    provides: initialize_stake_pool instruction
  - phase: 26-04
    provides: stake and unstake instructions
provides:
  - claim instruction for standalone reward collection
  - Comprehensive unit test suite (18 tests)
  - First-depositor attack prevention verified
  - Flash loan prevention verified
affects:
  - 27-staking-cpi (CPI operations need claim pattern)
  - integration-testing (all user-facing operations now testable)

# Tech tracking
tech-stack:
  added: [chai, "@solana/spl-token", "@types/chai"]
  patterns: [CEI pattern for claim, ownership validation via PDA seeds]

key-files:
  created:
    - programs/staking/src/instructions/claim.rs
    - tests/staking.ts
  modified:
    - programs/staking/src/instructions/mod.rs
    - programs/staking/src/lib.rs
    - Anchor.toml
    - package.json

key-decisions:
  - "Claim uses CEI pattern: state updates before SOL transfer"
  - "Ownership enforced via PDA seeds constraint, not explicit checks"
  - "Tests use accountsStrict for explicit account passing"

patterns-established:
  - "Claim instruction: update_rewards -> check NothingToClaim -> transfer"
  - "Test structure: before hook for setup, describe blocks per instruction"
  - "Error validation: expect(err.error.errorCode.code).to.equal('ErrorName')"

# Metrics
duration: 6min
completed: 2026-02-06
---

# Phase 26 Plan 05: Claim Instruction and Unit Tests Summary

**Claim instruction with SOL reward transfer and 18-test suite validating all Phase 26 success criteria**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-06T22:56:58Z
- **Completed:** 2026-02-06T23:02:49Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Claim instruction transfers SOL from escrow to user without touching staked_balance
- NothingToClaim error (ERR-04) when rewards_earned is 0
- Ownership constraint via PDA seeds + explicit check (SEC-05)
- CEI pattern followed for security (SEC-07)
- 18 unit tests covering initialize, stake, claim, unstake, edge cases
- First-depositor attack prevention verified (pool starts with MINIMUM_STAKE)
- Flash loan prevention verified (same-slot stake/unstake earns 0 rewards)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement claim instruction** - `b3edb3d` (feat)
   - claim.rs with Claim accounts struct and handler
   - NothingToClaim and InsufficientEscrowBalance errors
   - Emits Claimed event with user, amount, staked_balance, total_claimed

2. **Task 2: Create comprehensive unit test suite** - `5bb0332` (test)
   - 18 test cases covering all Phase 26 success criteria
   - Tests: initialize, stake, claim, unstake, edge cases, state invariants
   - Flash loan attack prevention verified

## Files Created/Modified

- `programs/staking/src/instructions/claim.rs` - Claim instruction (162 lines)
- `programs/staking/src/instructions/mod.rs` - Added claim module export
- `programs/staking/src/lib.rs` - Added claim function to #[program] block
- `tests/staking.ts` - Comprehensive unit test suite (696 lines, 18 tests)
- `Anchor.toml` - Added staking program, updated test script
- `package.json` - Added chai, @solana/spl-token, @types/chai

## Decisions Made

1. **CEI pattern for claim** - State updates (rewards_earned=0, total_claimed++) before SOL transfer
2. **Ownership via PDA seeds** - constraint `seeds = [USER_STAKE_SEED, user.key().as_ref()]` enforces ownership
3. **Test structure** - Used describe blocks per instruction type for organization
4. **accountsStrict** - Explicit account passing for test clarity and type safety
5. **Test script update** - Changed from yarn to npx ts-mocha for compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **yarn not found** - Anchor.toml used `yarn run ts-mocha` but yarn not in PATH
   - Fixed by changing to `npx ts-mocha`
   - Non-blocking, resolved immediately

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All user-facing staking operations complete: initialize, stake, unstake, claim
- 18 tests pass validating Phase 26 success criteria
- Ready for Phase 27: CPI operations (deposit_rewards, update_cumulative)
- No blockers or concerns

---
*Phase: 26-core-staking-program*
*Completed: 2026-02-06*
