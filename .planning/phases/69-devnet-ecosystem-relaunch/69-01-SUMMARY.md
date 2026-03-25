---
phase: 69-devnet-ecosystem-relaunch
plan: 01
subsystem: infra
tags: [anchor, solana, devnet, build, deploy-pipeline, tax-split]

# Dependency graph
requires:
  - phase: DBS phases 1-7
    provides: Conversion vault program, tax split update, PROFIT pool removal
provides:
  - 6 compiled .so artifacts with devnet feature flags
  - deploy-all.sh auto-detects devnet and passes --devnet to build.sh
  - Clean mint-keypairs directory for fresh mint generation
  - .env with 2.5 SOL/pool seed liquidity
  - Fixed split_distribution() to match DBS Phase 3 tax constants (73.5/24/2.5)
affects: [69-02 deploy, 69-03 frontend, 69-04 validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "deploy-all.sh auto-detects devnet cluster URL and passes --devnet flag"
    - "split_distribution() uses inline BPS constants matching constants.rs"

key-files:
  created: []
  modified:
    - scripts/deploy/deploy-all.sh
    - .env
    - programs/tax-program/src/helpers/tax_math.rs
    - programs/tax-program/src/instructions/swap_sol_buy.rs
    - programs/tax-program/src/instructions/swap_sol_sell.rs
    - programs/tax-program/src/lib.rs

key-decisions:
  - "Reuse program keypairs, delete only mint keypairs for fresh mints"
  - "Auto-detect devnet in CLUSTER_URL rather than requiring explicit --devnet flag"
  - "Fix split_distribution() inline BPS constants rather than importing from constants.rs (preserves no-anchor-dependency design)"

patterns-established:
  - "deploy-all.sh: devnet auto-detection via grep on CLUSTER_URL"

# Metrics
duration: 8min
completed: 2026-02-26
---

# Phase 69 Plan 01: Pre-flight Build Summary

**Fixed deploy-all.sh devnet passthrough, aligned on-chain tax split with DBS Phase 3 (73.5/24/2.5), built all 6 programs with --devnet, 279 tests passing**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-26T20:49:04Z
- **Completed:** 2026-02-26T20:57:00Z
- **Tasks:** 2
- **Files modified:** 6 (+ 2 deleted files)

## Accomplishments
- deploy-all.sh auto-detects devnet cluster and passes --devnet to build.sh (Pitfall 7 fix)
- .env seed liquidity updated from 25 SOL to 2.5 SOL per pool per CONTEXT.md
- Stale mint keypairs, carnage-wsol.json, and ALT cache deleted for fresh generation
- Critical bug fix: split_distribution() aligned with DBS Phase 3 constants (73.5/24/2.5 instead of stale 75/24/1)
- All 6 programs (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault) build with --devnet
- 279 Rust tests pass, 0 failures, 2 ignored
- 29/29 program ID consistency checks pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Pre-flight -- fix deploy-all.sh, update .env, delete stale keypairs** - `ca50aaf` (chore)
2. **Task 2: Build all 6 programs with --devnet and run Rust tests** - `7e34a7d` (fix)

**Plan metadata:** (pending)

## Files Created/Modified
- `scripts/deploy/deploy-all.sh` - Added devnet auto-detection and --devnet flag passthrough to build.sh
- `.env` - Updated SOL_POOL_SEED_SOL_OVERRIDE from 25 SOL to 2.5 SOL (gitignored)
- `programs/tax-program/src/helpers/tax_math.rs` - Fixed split_distribution() to use 7350/2400 BPS
- `programs/tax-program/src/instructions/swap_sol_buy.rs` - Updated doc comments for 73.5/24/2.5 split
- `programs/tax-program/src/instructions/swap_sol_sell.rs` - Updated doc comments for 73.5/24/2.5 split
- `programs/tax-program/src/lib.rs` - Updated doc comments for 73.5/24/2.5 split

## Files Deleted
- `keypairs/carnage-wsol.json` - Stale carnage WSOL keypair (fresh one generated during initialization)
- `scripts/deploy/alt-address.json` - Stale ALT address cache
- `scripts/deploy/mint-keypairs/` - Stale mint keypairs directory (fresh mints generated during initialization)

## Decisions Made
- **Reuse program keypairs:** Same 6 program IDs preserved. Only mint keypairs deleted for fresh generation. Avoids touching declare_id!, Anchor.toml, cross-program references.
- **deploy-all.sh auto-detection:** Grep CLUSTER_URL for "devnet" rather than requiring explicit --devnet argument. Simpler operator experience, impossible to forget.
- **Inline BPS constants in tax_math.rs:** Rather than importing from constants.rs (which pulls in anchor_lang::prelude::Pubkey), defined STAKING_BPS/CARNAGE_BPS/BPS_DENOM inline with comment to keep in sync. Preserves the module's no-anchor-dependency design for fast test compilation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] split_distribution() used stale 75/24/1 ratios instead of DBS Phase 3 constants (73.5/24/2.5)**
- **Found during:** Task 2 (Rust test suite)
- **Issue:** DBS Phase 3 updated constants.rs STAKING_BPS from 7500 to 7350 and TREASURY_BPS from 100 to 250, but the split_distribution() function in tax_math.rs still hardcoded 75/24 in its arithmetic. The on-chain code would distribute tax at 75/24/1 while constants said 73.5/24/2.5.
- **Fix:** Updated split_distribution() to use inline constants matching constants.rs (STAKING_BPS=7350, CARNAGE_BPS=2400, BPS_DENOM=10000). Updated unit tests (split_100_lamports, split_1000_lamports, split_4_lamports_boundary). Updated doc comments in lib.rs, swap_sol_buy.rs, swap_sol_sell.rs.
- **Files modified:** programs/tax-program/src/helpers/tax_math.rs, programs/tax-program/src/instructions/swap_sol_buy.rs, programs/tax-program/src/instructions/swap_sol_sell.rs, programs/tax-program/src/lib.rs
- **Verification:** All 279 Rust tests pass including 3 previously-failing integration tests (test_buy_crime_with_tax, test_buy_fraud_with_tax, test_buy_tax_distribution_rounding)
- **Committed in:** 7e34a7d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Critical bug fix -- without this, the deployed tax program would distribute revenue at wrong ratios (75/24/1 instead of 73.5/24/2.5). The DBS phase updated constants but missed the function that actually computes the split. No scope creep.

## Issues Encountered
None beyond the bug fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 .so artifacts ready for deployment (Plan 02)
- mint-keypairs directory clean -- initialize.ts will generate fresh mints
- ALT cache deleted -- alt-helper.ts will create new ALT
- Program keypairs preserved -- same program IDs will be deployed
- .env has correct 2.5 SOL seed liquidity
- deploy-all.sh will auto-pass --devnet for the actual deployment run

---
*Phase: 69-devnet-ecosystem-relaunch*
*Completed: 2026-02-26*
