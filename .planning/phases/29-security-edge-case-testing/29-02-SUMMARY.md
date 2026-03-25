---
phase: 29-security-edge-case-testing
plan: 02
subsystem: testing
tags: [security, attack-simulation, escrow-solvency, transfer-hook, staking, stress-test]

# Dependency graph
requires:
  - phase: 26-core-staking-program
    provides: "StakePool, UserStake, stake/unstake/claim instructions"
  - phase: 28-token-flow-whitelist
    provides: "Transfer Hook integration, stakeWithHook/unstakeWithHook helpers, assertEscrowSolvency"
provides:
  - "Security attack simulation test suite (tests/security.ts)"
  - "First-depositor, flash loan, CPI forgery, and escrow solvency tests"
  - "100+ operation stress test validating escrow solvency invariant"
  - "test-security script in Anchor.toml for isolated validator execution"
affects: [29-03-PLAN, 29-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Attack narrative comment blocks (ATTACK/SCENARIO/MITIGATION/PROPERTY VALIDATED)"
    - "createStakerWithTokens factory for Transfer Hook-enabled multi-user tests"
    - "Separate test-security script in Anchor.toml avoiding StakePool PDA singleton conflicts"

key-files:
  created:
    - tests/security.ts
  modified:
    - Anchor.toml

key-decisions:
  - "Security tests run in isolated validator via test-security script (StakePool singleton PDA conflict avoidance)"
  - "100+ operation stress test uses 50 stake/unstake cycles at 100 PROFIT per cycle"
  - "Multi-user test uses 5 stakers with interleaved operations across 3 rounds (20+ ops)"
  - "CPI forgery tests use unauthorized keypair pattern (same as cross-program-integration.ts)"
  - "Dead stake irrecoverability validated by checking admin and stakePool PDA have no UserStake"

patterns-established:
  - "Attack narrative pattern: JSDoc with ATTACK/SCENARIO/MITIGATION/PROPERTY VALIDATED"
  - "createStakerWithTokens: reusable factory for Transfer Hook-enabled test users"
  - "Escrow solvency check after every state-modifying operation (15 call sites)"

# Metrics
duration: 12min
completed: 2026-02-09
---

# Phase 29 Plan 02: Security Attack Simulation & Escrow Solvency Summary

**12-test security suite validating first-depositor, flash loan, CPI forgery attack resistance and escrow solvency invariant across 100+ operations with Transfer Hook integration**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-09T17:46:00Z
- **Completed:** 2026-02-09T17:58:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created 1335-line security test suite with full Transfer Hook initialization
- All 12 security tests pass: 3 first-depositor, 3 flash loan, 3 CPI forgery, 3 solvency
- 100+ operation stress test validates escrow solvency invariant under adversarial cycling
- Multi-user test with 5 stakers and 20+ interleaved operations confirms solvency
- Each attack vector documented with narrative explaining scenario, mitigation, and validated property

## Task Commits

Each task was committed atomically:

1. **Task 1: Create security.ts with initialization and attack simulation tests** - `adf1a44` (test)

## Files Created/Modified
- `tests/security.ts` - Security attack simulation and escrow solvency test suite (1335 lines)
- `Anchor.toml` - Added test-security script for isolated validator execution

## Decisions Made
- Security tests run in their own validator via `test-security` Anchor.toml script to avoid StakePool PDA singleton conflicts with staking.ts and token-flow.ts
- Dead stake irrecoverability proven by checking both admin pubkey and stakePool PDA have no UserStake accounts (not just checking balance)
- Attacker share validation uses BigInt scaled arithmetic (1e12 multiplier) to avoid JavaScript floating-point precision loss
- Multi-user stress test creates 5 stakers with escalating initial amounts (2K-10K PROFIT) and interleaves stake/unstake across 3 rounds with 5 operations per round
- Escrow funding simulation uses SystemProgram.transfer to escrowVault (mimicking Tax Program flow) since deposit_rewards is CPI-gated

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed attacker share assertion threshold**
- **Found during:** Task 1 (first-depositor attack test)
- **Issue:** Initial assertion `expect(shareScaled).to.be.lt(1_000)` was too strict -- 1/(1,000,001) * 1e12 = 999,999, which is < 1,000,000 but not < 1,000
- **Fix:** Adjusted to use the correct threshold (< 1,000,000) which validates the attacker gets < 0.0001% share
- **Files modified:** tests/security.ts
- **Verification:** Test passes with correct assertion
- **Committed in:** adf1a44

**2. [Rule 1 - Bug] Fixed multi-user operation count undercount**
- **Found during:** Task 1 (escrow solvency multi-user test)
- **Issue:** Initial implementation had 4 operations per round (A, B, D, E) x3 + 5 initial = 17, below the 20 minimum
- **Fix:** Added User C operations (stake 150 PROFIT) to each round, bringing total to 5 initial + 5 per round x3 = 20 operations
- **Files modified:** tests/security.ts
- **Verification:** Test passes with operationCount >= 20
- **Committed in:** adf1a44

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both were test logic fixes needed for correctness. No scope creep.

## Issues Encountered
- `npx ts-mocha` cannot run security.ts directly (no validator running) -- must use `anchor test` which starts the localnet validator automatically. The `test-security` script in Anchor.toml is the intended runner. During development, temporarily swapping the `test` script allowed validation via `anchor test --skip-build`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Security test foundation established for Plans 03 (proptest math fuzzing) and 04 (edge case/multi-user tests)
- createStakerWithTokens factory available for reuse in subsequent test plans
- assertEscrowSolvency pattern validated at scale (100+ operations)

---
*Phase: 29-security-edge-case-testing*
*Completed: 2026-02-09*
