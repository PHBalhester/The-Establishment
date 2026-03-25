---
phase: 33-deployment-scripts
plan: 02
subsystem: infra
tags: [typescript, pda, solana, deployment, token-2022, anchor, idempotent]

# Dependency graph
requires:
  - phase: 33-01
    provides: "Shared deploy library (loadProvider, loadPrograms, createLogger, accountExists, mintExists)"
  - phase: 31-integration-test-infrastructure
    provides: "PDA seed constants, derivation helpers, protocol-init.ts blueprint"
provides:
  - "PDA manifest generator deriving all protocol addresses from program IDs + mints"
  - "Idempotent 18-step protocol initialization script with mint keypair persistence"
  - "canonicalOrder helper for pool PDA derivation (exported from pda-manifest.ts)"
affects:
  - 33-03 (verify.ts reads pda-manifest.json to confirm accounts exist)
  - 34-devnet-deployment (initialize.ts runs after deploy.sh)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mint keypair persistence: save/load from scripts/deploy/mint-keypairs/ for deterministic PDAs across runs"
    - "PDA manifest dual output: JSON (machine) + Markdown (human) for deployment review"
    - "Idempotent init: accountExists/mintExists check before every on-chain transaction"
    - "Transfer Hook remaining_accounts: [extraMeta, wlSource, wlDest, hookProgramId] for all T22 transfers"

key-files:
  created:
    - scripts/deploy/lib/pda-manifest.ts
    - scripts/deploy/initialize.ts
  modified:
    - .gitignore

key-decisions:
  - "Mint amount 1B tokens per mint (enough for all pools + staking + future use)"
  - "Create fresh WSOL account each run rather than tracking/reusing existing accounts"
  - "Gitignore mint-keypairs, deploy logs, and generated manifest files as runtime artifacts"

patterns-established:
  - "loadOrCreateMintKeypair(): standard pattern for deterministic mint addresses across deployment runs"
  - "generateManifest() + writeManifest(): standard way to produce PDA address reference for operators"

# Metrics
duration: 5min
completed: 2026-02-11
---

# Phase 33 Plan 02: Protocol Initialization Script Summary

**PDA manifest generator deriving 20+ protocol addresses and 18-step idempotent init script with mint keypair persistence, Transfer Hook remaining_accounts, and canonical pool ordering**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-11T00:45:18Z
- **Completed:** 2026-02-11T00:50:40Z
- **Tasks:** 2
- **Files created:** 2 (+ 1 modified)

## Accomplishments
- PDA manifest generator that derives all protocol PDAs (WhitelistAuthority, AdminConfig, SwapAuthority, TaxAuthority, EpochState, CarnageFund + 3 vaults + signer, StakePool + 2 vaults, StakingAuthority, 3 ExtraAccountMetaLists, 4 pools with vault pairs) from program IDs and mint keys
- 18-step idempotent initialization script following the exact protocol-init.ts sequence with check-before-init for every account
- Mint keypair persistence to scripts/deploy/mint-keypairs/ ensuring pool PDA consistency across deployment runs

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PDA manifest generator** - `06ba4b3` (feat)
2. **Task 2: Create idempotent protocol initialization script** - `4428025` (feat)

## Files Created/Modified
- `scripts/deploy/lib/pda-manifest.ts` - Derives all protocol PDAs, outputs JSON + Markdown manifest
- `scripts/deploy/initialize.ts` - 18-step idempotent protocol init with mint keypair persistence (989 lines)
- `.gitignore` - Added mint-keypairs, deploy logs, and manifest outputs to gitignore

## Decisions Made
- Admin mint amount set to 1 billion tokens per mint (1,000,000,000 at 6 decimals) -- enough for all 4 pools, staking dead stake, and future use without requiring additional minting
- Create fresh WSOL account each run -- cheaper and simpler than tracking/validating existing WSOL accounts from previous runs
- Gitignore deployment artifacts (mint-keypairs contain secret keys, deploy logs and manifests are runtime-generated)
- canonicalOrder helper defined in pda-manifest.ts (not imported from protocol-init.ts) to avoid importing test helpers in deployment scripts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Initialize script ready for Plan 03 (verify.ts will read pda-manifest.json)
- Both files compile successfully (verified with tsx)
- Mint keypair persistence ensures reproducibility across deployment attempts
- Full deployment pipeline: build.sh -> deploy.sh -> initialize.ts -> verify.ts (Plan 03)

---
*Phase: 33-deployment-scripts*
*Completed: 2026-02-11*
