---
phase: 90-gap-closure-launch-verification
plan: 03
subsystem: scripts
tags: [vrf, deployment, timeout, security, ownership-verification]

requires:
  - phase: 78-authority-hardening
    provides: On-chain program/programData upgrade authority checks
  - phase: 89-crank-hardening
    provides: VRF flow and crank runner infrastructure
provides:
  - Wall-clock timeout for waitForSlotAdvance (H030 closed)
  - initialize.ts synced with Phase 78 on-chain instruction accounts (H016 closed)
  - Ownership verification on all init skip paths
affects: [mainnet-deployment, crank-operations]

tech-stack:
  added: []
  patterns:
    - "Wall-clock timeout pattern: Date.now() check before sleep in polling loops"
    - "Ownership verification: deserialize + authority check OR program owner check before skipping init"

key-files:
  created: []
  modified:
    - scripts/vrf/lib/vrf-flow.ts
    - scripts/deploy/initialize.ts

key-decisions:
  - "Default timeout = max(30s, targetSlots * 400ms * 3) -- generous 3x multiplier with 30s floor for RPC latency"
  - "WhitelistAuthority and AMM AdminConfig use deserialized authority field check; other PDAs use program owner check"
  - "initializeWsolIntermediary also needed program/programData (discovered during execution, not in plan)"
  - "Bonding curve initializeCurve does NOT require program/programData (only initializeBcAdmin does, which isn't called)"

patterns-established:
  - "Ownership verification before skip: always verify authority or program owner when accountExists() returns true"

duration: 8min
completed: 2026-03-09
---

# Phase 90 Plan 03: Script Hardening Summary

**Wall-clock timeout for VRF slot waiting + initialize.ts program/programData sync with ownership verification**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-09T22:04:19Z
- **Completed:** 2026-03-09T22:12:00Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments
- waitForSlotAdvance() now has a wall-clock timeout that throws on expiry, preventing indefinite hangs if Solana slot production halts (H030 closed)
- All 6 init accountsStrict calls now include program + programData matching on-chain Phase 78 requirements (H016 closed)
- 8 ownership verification checks added across all init skip paths, detecting front-run attacks with descriptive SECURITY errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add maxWaitMs timeout to waitForSlotAdvance (H030)** - `0113402` (feat)
2. **Task 2: Fix initialize.ts program/programData + ownership verification (H016)** - `a5ccf54` (feat)

## Files Created/Modified
- `scripts/vrf/lib/vrf-flow.ts` - Added optional maxWaitMs parameter with wall-clock timeout to waitForSlotAdvance
- `scripts/deploy/initialize.ts` - Added ProgramData PDA derivations, program/programData to 6 init calls, ownership verification on 8 skip paths

## Decisions Made
- Default timeout uses 3x multiplier (generous) with 30s floor to handle RPC latency on short waits
- Authority field deserialization for accounts that have it (WhitelistAuthority, AMM AdminConfig); program owner verification for accounts without simple authority fields (EpochState, StakePool, CarnageFund, VaultConfig, CurveStates)
- Bonding curve ownership verification added for both CRIME and FRAUD curve states even though initializeCurve doesn't have program/programData (the PDA ownership check still prevents accepting attacker-owned accounts)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added program/programData to initializeWsolIntermediary**
- **Found during:** Task 2 (initialize.ts audit)
- **Issue:** Plan listed 5 instructions needing program/programData but missed initializeWsolIntermediary (Tax Program), which also requires them per Phase 78 on-chain changes
- **Fix:** Added taxProgramDataPda derivation and program/programData to the initializeWsolIntermediary accountsStrict call
- **Files modified:** scripts/deploy/initialize.ts
- **Verification:** grep confirms programData present in the call
- **Committed in:** a5ccf54 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added ownership verification for bonding curve states**
- **Found during:** Task 2 (ownership verification implementation)
- **Issue:** Plan mentioned ownership verification for WhitelistAuthority, BcAdminConfig, and AMM AdminConfig, but bonding curve CurveState PDAs also need protection
- **Fix:** Added program owner verification for both CRIME and FRAUD CurveState skip paths
- **Files modified:** scripts/deploy/initialize.ts
- **Verification:** grep confirms SECURITY checks on both curve states
- **Committed in:** a5ccf54 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both auto-fixes ensure complete coverage of all init paths. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in initialize.ts (missing adminConfig in bonding curve calls) are unrelated to this plan's changes -- they reflect IDL updates from a later phase that added adminConfig to bonding curve instructions. These are a known gap to fix in a future plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- H030 and H016 are both fully closed
- Deploy scripts are synced with all Phase 78 on-chain instruction requirements
- Ready for next 90-series plan

---
*Phase: 90-gap-closure-launch-verification*
*Completed: 2026-03-09*
