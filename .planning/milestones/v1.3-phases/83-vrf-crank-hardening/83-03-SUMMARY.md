---
phase: 83-vrf-crank-hardening
plan: 03
subsystem: infra
tags: [crank, vrf, security, railway, env-config]

# Dependency graph
requires:
  - phase: 82-carnage-refactor
    provides: Refactored carnage execution with atomic bundling
provides:
  - Production-hardened crank runner with configurable settings
  - Pubkey-only WSOL loading (no secret key in production)
  - RPC URL masking for API key safety
  - Configurable epoch timing and balance alerting
affects: [89-mainnet-deploy, crank-runner, railway-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-var-with-auto-detect config pattern (override > cluster-based auto-detect)"
    - "URL masking for safe logging of RPC endpoints"

key-files:
  created: []
  modified:
    - scripts/crank/crank-runner.ts
    - scripts/e2e/lib/carnage-flow.ts

key-decisions:
  - "CARNAGE_WSOL_PUBKEY env var is now mandatory (no keypair file fallback)"
  - "Epoch slots auto-detect: devnet=750, mainnet=4500, overridable via MIN_EPOCH_SLOTS_OVERRIDE"
  - "Balance threshold auto-detect: devnet=0.5 SOL, mainnet=1.0 SOL, overridable via CRANK_LOW_BALANCE_SOL"

patterns-established:
  - "Config pattern: env override > cluster-URL-based auto-detect > conservative default"

# Metrics
duration: 3min
completed: 2026-03-08
---

# Phase 83 Plan 03: Crank Runner Hardening Summary

**Production-hardened crank runner: pubkey-only WSOL, configurable epoch/balance settings, RPC URL masking, epoch skip detection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-08T11:57:36Z
- **Completed:** 2026-03-08T12:00:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed secret key loading from crank runner -- WSOL now pubkey-only via env var (VRF-11)
- Eliminated PublicKey.default placeholders in carnage-flow.ts E2E tests (VRF-07)
- Added RPC URL masking to prevent API key leakage in logs
- Made epoch slot count configurable with devnet/mainnet auto-detection (VRF-08)
- Made balance alert threshold configurable with auto-detection (VRF-12)
- Added epoch skip detection warning in main loop

## Task Commits

Each task was committed atomically:

1. **Task 1: Pubkey-only WSOL loading + PublicKey.default removal + RPC masking** - `872bf6f` (feat)
2. **Task 2: Configurable epoch slots + balance alerting + skip detection** - `755a01c` (feat)

## Files Created/Modified
- `scripts/crank/crank-runner.ts` - Removed keypair fallback, added maskRpcUrl(), getMinEpochSlots(), getLowBalanceThreshold(), epoch skip detection
- `scripts/e2e/lib/carnage-flow.ts` - Replaced PublicKey.default with loadCarnageWsolPubkeyFromEnv() helper

## Decisions Made
- CARNAGE_WSOL_PUBKEY env var is now required (no fallback to keypair file) -- simpler, no secret key exposure risk
- Removed fs/path/Keypair imports from crank-runner.ts (no longer needed after keypair fallback removal)
- Auto-detect pattern: check CLUSTER_URL for "devnet" substring to determine defaults

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Removed unused imports (fs, path, Keypair)**
- **Found during:** Task 1
- **Issue:** After removing keypair file fallback, fs/path/Keypair imports were dead code
- **Fix:** Removed all three unused imports
- **Files modified:** scripts/crank/crank-runner.ts
- **Verification:** grep confirms no remaining usage
- **Committed in:** 872bf6f (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical -- dead import cleanup)
**Impact on plan:** Cleanup of dead code after planned changes. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Existing CARNAGE_WSOL_PUBKEY env var on Railway is already set.

## Next Phase Readiness
- Crank runner is production-hardened for mainnet deployment
- All VRF-07, VRF-08, VRF-11, VRF-12 requirements satisfied
- Ready for next plan in Phase 83

---
*Phase: 83-vrf-crank-hardening*
*Completed: 2026-03-08*
