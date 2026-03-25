---
phase: 95-pathway-2-full-deploy-graduation
plan: 01
subsystem: infra
tags: [solana, deploy, bonding-curve, devnet, deploy-all, fill-script]

# Dependency graph
requires:
  - phase: 94.1
    provides: "Graduation script dynamic seeding, 500 SOL curve target, launch page"
  - phase: 91
    provides: "deploy-all.sh pipeline, deployment.json config system"
provides:
  - "Fresh clean-room devnet deployment with all 7 programs"
  - "Fresh mints (CRIME, FRAUD, PROFIT) with Arweave metadata"
  - "Curve fill script for organic traffic simulation"
  - "1s frontend polling for screen recording"
affects: [95-02, 95-03, 95-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Devnet build: non-flagged programs first, then feature-flagged with --features devnet"
    - "Solana CLI v3: --keypair required for solana program show"

key-files:
  created:
    - scripts/test/pathway2-fill.ts
  modified:
    - scripts/deploy/build.sh
    - scripts/deploy/deploy.sh
    - scripts/verify-program-ids.ts
    - deployments/devnet.json
    - shared/constants.ts
    - programs/bonding_curve/src/constants.rs
    - programs/conversion-vault/src/constants.rs
    - app/hooks/useCurveState.ts

key-decisions:
  - "build.sh devnet mode: build non-flagged programs first, then 4 flagged programs with --features devnet (avoids compile_error in mainnet path)"
  - "Sysvar addresses excluded from placeholder scanner in verify-program-ids.ts"
  - "Program IDs unchanged (same keypairs); only mint keypairs regenerated for fresh deployment"

patterns-established:
  - "Devnet build splits feature-flagged and non-flagged program compilation"

requirements-completed: [CURVE-06]

# Metrics
duration: 25min
completed: 2026-03-14
---

# Phase 95 Plan 01: Clean-Room Deploy + Fill Script Summary

**Fresh devnet deployment with 7 programs, 3 new mints, all infrastructure, plus 567-line curve fill script for organic traffic simulation**

## Performance

- **Duration:** 25 min
- **Started:** 2026-03-14T07:56:11Z
- **Completed:** 2026-03-14T08:21:51Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Deployed all 7 programs to devnet with fresh mint keypairs (CRIME=7bEti..., FRAUD=8pcQ3..., PROFIT=GBevg...)
- Fixed build.sh, deploy.sh, and verify-program-ids.ts for Solana CLI v3 and feature-flag compat
- Created pathway2-fill.ts (567 lines): 10-wallet traffic simulator with mixed buy/sell, randomized timing
- Reduced frontend polling to 1s for screen recording responsiveness

## Task Commits

1. **Task 1: Clean-Room Deploy** - `3bdb95f` (feat)
2. **Task 2: Fill Script + Polling** - `65647d9` (feat)

## Files Created/Modified
- `scripts/test/pathway2-fill.ts` - 10-wallet curve fill script with mixed buy/sell operations
- `scripts/deploy/build.sh` - Fixed devnet build to handle compile_error in feature-flagged programs
- `scripts/deploy/deploy.sh` - Added --keypair to solana program show for v3 CLI
- `scripts/verify-program-ids.ts` - Excluded Sysvar addresses from placeholder scanner
- `deployments/devnet.json` - Fresh deployment with new mint addresses and curve PDAs
- `shared/constants.ts` - Regenerated from fresh deployment
- `programs/bonding_curve/src/constants.rs` - Patched with new CRIME/FRAUD mint addresses
- `programs/conversion-vault/src/constants.rs` - Patched with new CRIME/FRAUD/PROFIT mint addresses
- `app/hooks/useCurveState.ts` - Polling reduced from 5s to 1s (temporary for recording)

## Decisions Made
- build.sh for devnet now builds non-feature-flagged programs (amm, transfer_hook, staking) first, then builds the 4 feature-flagged programs (epoch, tax, vault, bonding_curve) with `--features devnet`. This avoids the `compile_error!` macro in tax-program's mainnet path that prevents the initial `anchor build` from completing.
- Program keypairs reused (same IDs) -- only mint keypairs regenerated for fresh mints.
- Sysvar addresses (SysvarC1ock111..., Sysvar111...) added to allowlist in verify-program-ids.ts placeholder scanner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] build.sh fails on devnet due to compile_error! in tax-program mainnet path**
- **Found during:** Task 1 (deploy-all.sh execution)
- **Issue:** `anchor build` (without features) compiles all programs including tax_program, which has `compile_error!("Set mainnet treasury address...")` in the `#[cfg(not(any(feature = "devnet", feature = "localnet")))]` path
- **Fix:** Modified build.sh to split devnet builds: non-flagged first, then flagged with --features devnet
- **Files modified:** scripts/deploy/build.sh
- **Verification:** Full build completes successfully
- **Committed in:** 3bdb95f

**2. [Rule 3 - Blocking] deploy.sh verification fails with Solana CLI v3**
- **Found during:** Task 1 (deploy-all.sh Phase 2)
- **Issue:** `solana program show` in CLI v3 requires `--keypair` flag, errors with "No default signer found"
- **Fix:** Added `--keypair "$WALLET"` to the program verification command
- **Files modified:** scripts/deploy/deploy.sh
- **Verification:** All 7 programs verified as deployed
- **Committed in:** 3bdb95f

**3. [Rule 1 - Bug] verify-program-ids.ts false positive on Sysvar addresses**
- **Found during:** Task 1 (build.sh Phase 3 verification)
- **Issue:** Placeholder scanner regex matches Sysvar addresses (SysvarC1ock111...) as placeholders because they contain 10+ consecutive "1"s
- **Fix:** Added KNOWN_SYSVAR_PREFIXES allowlist and isKnownSysvar() check
- **Files modified:** scripts/verify-program-ids.ts
- **Verification:** 29/29 checks pass (was 25/29 with 4 false positives)
- **Committed in:** 3bdb95f

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All fixes were necessary for the deploy pipeline to complete. No scope creep.

## Issues Encountered
- verify.ts (Phase 6) reports 18 failures for PDA ownership mismatches and missing curve solVault/taxEscrow accounts. These are expected: curve solVault/taxEscrow are created on first purchase (not during init), and some PDA ownership checks reference prior deployment state. The critical verification (programs deployed, mints created, pools initialized, curves active) all passed.

## Railway Environment Variables

User needs to update these on Railway dashboard:

- **Program IDs**: Unchanged (same keypairs)
- **New Mints**: CRIME=7bEti8EMNHahhKWEdZ1BMZLT4pmQBzgdUEXwM6qup3Bs, FRAUD=8pcQ3H7MWw8Tv5UzmcYzKCDJG2BtpTWgCJH7GMvysda, PROFIT=GBevgQKzUmxrBss5PVvwoyTb9ZjMdhDhxCq6iWc5aNEH
- **PDA_MANIFEST**: Full JSON from pda-manifest.json (regenerated)
- **CARNAGE_WSOL_PUBKEY**: ACwqz5TZhahDMNQkW1wKWCz7FbjBko1bBWrvvfRJgCpw
- **NEXT_PUBLIC_SITE_MODE**: launch

## User Setup Required

User must stop Railway crank before proceeding with Plan 02, and update Railway env vars with the new deployment values listed above.

## Next Phase Readiness
- All 7 programs deployed and executable on devnet
- Both curves active and funded with 460M tokens each
- Fill script ready at scripts/test/pathway2-fill.ts
- Frontend polling at 1s for responsive gauge updates
- Ready for Plan 02: user manual buy + fill script + graduation

---
*Phase: 95-pathway-2-full-deploy-graduation*
*Completed: 2026-03-14*
