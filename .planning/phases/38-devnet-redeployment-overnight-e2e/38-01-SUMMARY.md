---
phase: 38-devnet-redeployment-overnight-e2e
plan: 01
subsystem: infra
tags: [solana, devnet, deployment, anchor, smoke-test, wsol, carnage]

# Dependency graph
requires:
  - phase: 37-e2e-bug-fixes
    provides: "Phase 37 security fixes, independent tax rolls, BPF stack overflow fix"
  - phase: 34-devnet-deployment
    provides: "Initial devnet deployment, deploy.sh, verify.ts, initialize.ts"
provides:
  - "All 5 programs upgraded on devnet with Phase 37 code"
  - "Carnage WSOL account created with CarnageSigner PDA ownership"
  - "Smoke test confirms full CPI chain on devnet"
  - "Idempotent initialize.ts Step 5 (skips admin account creation when pools exist)"
  - "smoke-test.ts reusable script"
affects: [38-02, 38-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent Step 5: pre-check all 4 pool PDAs before creating admin token accounts"
    - "Smoke test pattern: create fresh user, execute single swap, verify TX sig"

key-files:
  created:
    - "scripts/e2e/smoke-test.ts"
    - "keypairs/carnage-wsol.json"
    - "scripts/deploy/deployment-report.md"
  modified:
    - "scripts/deploy/initialize.ts"

key-decisions:
  - "Skip admin token account creation when all 4 pools already exist (saves ~55 SOL on re-runs)"
  - "Auto-approved checkpoint: all verification criteria met (yolo mode, user sleeping)"

patterns-established:
  - "Idempotent pool-existence check before expensive Step 5 admin account creation"

# Metrics
duration: 7min
completed: 2026-02-13
---

# Phase 38 Plan 01: Devnet Redeployment Summary

**All 5 programs upgraded on devnet with Phase 37 fixes; 34/34 verification checks pass; smoke test swap confirms full CPI chain**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-13T23:52:26Z
- **Completed:** 2026-02-13T23:59:32Z
- **Tasks:** 3 (2 auto + 1 auto-approved checkpoint)
- **Files modified:** 3

## Accomplishments

- Built all 5 programs with `anchor build` (26/26 program ID consistency checks pass)
- Deployed/upgraded all 5 programs on devnet (AMM, Transfer Hook, Tax, Epoch, Staking) with Phase 37 code
- Post-deployment verification: 34/34 checks passed (programs, mints, hooks, pools, epoch, staking, whitelist)
- Carnage WSOL account created: `BgAWNukQqvJyQGjiyxWo1S8iXJrJmukHhj1hYQosaA22` with CarnageSigner PDA owner
- Smoke test: 0.1 SOL buy swap on CRIME/SOL succeeded (TX: `5UA4dKNpyb8xLG44185Le1Gmdd6AEKjgmtZ786rzQVoHW7JLP2oC54z6HEFwkQWKEZSUNLbEi7CNNwGVa4nTvwAU`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build and deploy all 5 programs to devnet** - `5672100` (feat)
2. **Task 2: Verify Carnage WSOL and smoke test swap** - `0ed72e8` (feat)
3. **Task 3: Auto-approved checkpoint** - no commit (verification-only)

## Files Created/Modified

- `scripts/deploy/initialize.ts` - Added idempotent Step 5 (skip admin accounts when pools exist)
- `scripts/e2e/smoke-test.ts` - New smoke test script for quick CPI chain validation
- `keypairs/carnage-wsol.json` - Carnage WSOL keypair (PDA-owned, SPL Token)
- `scripts/deploy/deployment-report.md` - Updated deployment report

## Decisions Made

- **Skip admin token accounts when pools exist:** initialize.ts Step 5 tried to wrap 55 SOL for admin WSOL even when all 4 pools were already initialized. Added pool-existence pre-check to skip the entire step, saving ~55 SOL on re-runs. The admin accounts are only needed for seed liquidity transfers during pool initialization.
- **Auto-approved checkpoint:** All 4 verification criteria met (5/5 programs deployed, 34/34 checks, Carnage WSOL exists, smoke test PASS). User authorized yolo mode for overnight execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed initialize.ts Step 5 insufficient balance on re-run**

- **Found during:** Task 2 (initialization script run)
- **Issue:** Step 5 unconditionally created fresh admin WSOL + T22 accounts (55+ SOL), but wallet only had ~54.9 SOL after deployment. All 4 pools were already initialized from Phase 34, so admin accounts were not needed.
- **Fix:** Added pool-existence pre-check: if all 4 pool PDAs exist on-chain, skip Step 5 entirely and use dummy PublicKeys (which are never dereferenced since Steps 7-10 also SKIP).
- **Files modified:** `scripts/deploy/initialize.ts`
- **Verification:** initialize.ts completed successfully with 2 new steps + 28 skipped
- **Committed in:** `0ed72e8` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix to unblock initialization. No scope creep.

## Issues Encountered

None -- all steps completed successfully after the Step 5 fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Devnet environment fully operational with Phase 37 code
- All 5 programs deployed and verified (34/34 checks)
- Carnage WSOL account ready for execute_carnage_atomic
- Smoke test confirms full CPI chain works
- Ready for Plan 38-02: Gateway rotation + overnight runner implementation

## Deployment Details

| Program | Address | Status |
|---------|---------|--------|
| AMM | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | Upgraded OK |
| Transfer Hook | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | Upgraded OK |
| Tax Program | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | Upgraded OK |
| Epoch Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | Upgraded OK |
| Staking | `Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi` | Upgraded OK |

Wallet balance after deployment: ~54.9 SOL (started at ~55 SOL, spent ~0.1 SOL on upgrades + smoke test)

---
*Phase: 38-devnet-redeployment-overnight-e2e*
*Completed: 2026-02-13*
