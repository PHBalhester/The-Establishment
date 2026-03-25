---
phase: 36-end-to-end-devnet-testing
plan: 01
subsystem: testing
tags: [e2e, devnet, swap, tax-distribution, transfer-hook, token-2022, solana]

# Dependency graph
requires:
  - phase: 34-devnet-deployment
    provides: deployed programs, PDA manifest, pool reserves
  - phase: 35-vrf-devnet-validation
    provides: EpochState initialized at epoch 77, VRF validated
provides:
  - E2E infrastructure (logger, user-setup, reporter) for Plans 02-03
  - SOL buy swap flow validated on devnet with tax distribution evidence
  - swap-flow module with exported functions for staking/carnage flows
affects: [36-02, 36-03, mainnet-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Crash-safe JSONL logger with appendFileSync for E2E test evidence"
    - "Runtime PDA derivation for swap_authority (manifest had stale AMM-derived value)"
    - "Treasury tolerance accounting for TX fee deduction in balance verification"

key-files:
  created:
    - scripts/e2e/devnet-e2e-validation.ts
    - scripts/e2e/lib/e2e-logger.ts
    - scripts/e2e/lib/user-setup.ts
    - scripts/e2e/lib/swap-flow.ts
    - scripts/e2e/lib/e2e-reporter.ts
    - scripts/e2e/e2e-run.jsonl
    - Docs/E2E_Devnet_Test_Report.md
  modified: []

key-decisions:
  - "Derive swap_authority PDA at runtime from Tax Program ID, not from manifest (manifest had incorrect AMM-derived value)"
  - "Treasury balance verification uses TX fee headroom tolerance (50k lamports) since wallet pays both swap tax and TX fees"
  - "Local sleep() helper in each module to avoid cross-module import chains"

patterns-established:
  - "E2E JSONL logging: appendFileSync per entry for crash safety"
  - "Runtime PDA derivation over manifest lookup for PDAs with seeds::program"

# Metrics
duration: 15min
completed: 2026-02-13
---

# Phase 36 Plan 01: E2E Infrastructure + SOL Buy Swap Summary

**E2E devnet test infrastructure with JSONL crash-safe logging, fresh user wallet creation via SOL transfer, and SOL buy swap on CRIME/SOL pool verified with 75/24/1 tax distribution on devnet**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-13T10:31:21Z
- **Completed:** 2026-02-13T10:47:14Z
- **Tasks:** 2/2
- **Files created:** 7

## Accomplishments

- Built complete E2E infrastructure: crash-safe JSONL logger, fresh user wallet setup (SOL transfer, not airdrop), markdown report generator, main orchestrator
- SOL buy swap on CRIME/SOL pool completed on devnet through full Tax->AMM CPI chain with Transfer Hook remaining_accounts (TX: `5L6FvwTz7mD87R42VNNNfYZ7eEDNmEgA8T9DToboBdWQrJhK2Wv5xZ9uPwnJkFKQJebVkVHfdzH6seiaRivcLJKB`)
- Tax distribution verified at 75.1% staking / 24.0% carnage / 0.9% treasury (expected 75/24/1)
- EpochState confirmed: epoch=77, cheapSide=FRAUD, crimeBuyTax=1400bps (14%)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build E2E infrastructure** - `803fd74` (feat)
2. **Task 2: Implement swap flow + execute on devnet** - `330a2d2` (feat)

## Files Created/Modified

- `scripts/e2e/devnet-e2e-validation.ts` - Main E2E orchestrator entry point
- `scripts/e2e/lib/e2e-logger.ts` - Incremental crash-safe JSONL logger
- `scripts/e2e/lib/user-setup.ts` - Fresh wallet creation with T22 accounts via SOL transfer
- `scripts/e2e/lib/swap-flow.ts` - SOL buy swap execution with hook resolution and tax verification
- `scripts/e2e/lib/e2e-reporter.ts` - Markdown report generator with Summary + Swap Flow sections
- `scripts/e2e/e2e-run.jsonl` - Test run log (14 entries, all pass)
- `Docs/E2E_Devnet_Test_Report.md` - Human-readable test report with TX links

## Decisions Made

1. **Derive swap_authority PDA at runtime from Tax Program ID** - The PDA manifest (`scripts/deploy/pda-manifest.json`) had `SwapAuthority` derived from the AMM program ID, but the Tax Program's `SwapSolBuy` struct validates `swap_authority` with `seeds = [b"swap_authority"]` against its own program ID. Deriving at runtime avoids this manifest staleness issue.

2. **Treasury tolerance for TX fee deduction** - The treasury is the devnet wallet, which both receives 1% tax and pays TX fees. Balance delta verification uses a 50k lamport headroom to account for TX fees. Staking (75%) and carnage (24%) are verified exactly (2 lamport tolerance).

3. **Local sleep() helper per module** - Rather than importing `sleep` from the VRF flow module (which would create a cross-module dependency chain), each E2E module defines its own local `sleep()` function.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed swap_authority PDA derivation**

- **Found during:** Task 2 (swap execution)
- **Issue:** PDA manifest stored `SwapAuthority` derived from AMM program ID (`G72jCQXEqxtPwLseNQ1xfwHkK7z7RfkMQRy6e1vXSRQg`), but Tax Program derives it from its own ID (`A71kLzmTafim2FZFgUGp728f2yFj54VHattJeVNXdhwo`). Swap failed with `ConstraintSeeds` error.
- **Fix:** Derive `swap_authority` PDA at runtime from `programs.taxProgram.programId` instead of reading from manifest.
- **Files modified:** `scripts/e2e/lib/swap-flow.ts`
- **Verification:** Swap completed successfully after fix
- **Committed in:** `330a2d2` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed txPassed variable name typo**

- **Found during:** Task 2 (swap execution)
- **Issue:** `runSwapFlow()` returned `txPassed` (undefined) instead of `taxPassed` (the actual boolean result)
- **Fix:** Changed `return txPassed` to `return taxPassed`
- **Files modified:** `scripts/e2e/lib/swap-flow.ts`
- **Verification:** Function returns correct boolean after fix
- **Committed in:** `330a2d2` (Task 2 commit)

**3. [Rule 1 - Bug] Fixed treasury balance verification false negative**

- **Found during:** Task 2 (tax verification)
- **Issue:** Treasury (devnet wallet) balance delta was -10,000 lamports below expected because wallet also pays TX fees. Strict 2 lamport tolerance caused false FAIL.
- **Fix:** Added TX fee headroom (50k lamports) to treasury tolerance check. Staking and carnage remain at strict 2 lamport tolerance.
- **Files modified:** `scripts/e2e/lib/swap-flow.ts`
- **Verification:** Tax verification passes with correct 75.1/24.0/0.9 split
- **Committed in:** `330a2d2` (Task 2 commit)

**4. [Rule 1 - Bug] Fixed SC-2 case-insensitive match in reporter**

- **Found during:** Task 2 (report generation)
- **Issue:** Reporter searched for "tax distribution" (lowercase) but log message was "Tax distribution" (Title case). SC-2 showed "NOT TESTED" despite passing.
- **Fix:** Changed to case-insensitive comparison using `toLowerCase()`
- **Files modified:** `scripts/e2e/lib/e2e-reporter.ts`
- **Committed in:** `330a2d2` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (4 bugs)
**Impact on plan:** All fixes necessary for correct operation. No scope creep.

## Issues Encountered

None beyond the deviations documented above. All issues were discovered and fixed during Task 2 execution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- E2E infrastructure is ready for Plans 02 (staking flow) and 03 (Carnage flow)
- Swap flow exports (`executeSolBuySwap`, `resolveHookAccounts`) available for import
- Logger, user setup, and reporter modules are stable
- Note: PDA manifest `SwapAuthority` value is stale (AMM-derived) -- Plans 02-03 should derive PDAs at runtime like this plan does
- Wallet balance: ~73 SOL remaining for Plans 02-03

---
*Phase: 36-end-to-end-devnet-testing*
*Completed: 2026-02-13*
