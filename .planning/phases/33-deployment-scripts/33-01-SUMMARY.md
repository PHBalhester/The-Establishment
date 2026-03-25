---
phase: 33-deployment-scripts
plan: 01
subsystem: infra
tags: [anchor, solana-cli, typescript, shell, deployment, devops]

# Dependency graph
requires:
  - phase: 30-program-id-fixes
    provides: "Canonical keypairs in keypairs/ directory, verify-program-ids.ts script"
provides:
  - "Standalone Anchor provider + typed program loading (loadProvider, loadPrograms)"
  - "Step-by-step operator logging with tx signature file (createLogger)"
  - "On-chain account existence checking for idempotent init (accountExists, programIsDeployed, mintExists)"
  - "Build script: anchor build + artifact verification + ID consistency check"
  - "Deploy script: solana program deploy for all 5 programs using canonical keypairs"
affects:
  - 33-02 (initialize.ts depends on connection, logger, account-check)
  - 33-03 (verify.ts depends on connection, logger, account-check)
  - 34-devnet-deployment (deploy.sh used for actual deployment)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone Anchor provider: loadProvider() with env var config, no anchor.workspace"
    - "Manual IDL loading: read target/idl/*.json, construct typed Program<T> instances"
    - "Factory logger: createLogger() returns step/info/error/section methods with ANSI colors"
    - "On-chain idempotency: accountExists/programIsDeployed/mintExists for check-before-init"
    - "Shell script env sourcing: source cargo + solana + node PATH before CLI commands"

key-files:
  created:
    - scripts/deploy/lib/connection.ts
    - scripts/deploy/lib/logger.ts
    - scripts/deploy/lib/account-check.ts
    - scripts/deploy/build.sh
    - scripts/deploy/deploy.sh

key-decisions:
  - "Auto-airdrop on localnet/devnet when wallet balance < 5 SOL"
  - "cd to project root in shell scripts via $(dirname $0)/../.. for reliable path resolution"

patterns-established:
  - "loadProvider()/loadPrograms(): standard way to create typed Anchor programs in deployment scripts"
  - "createLogger(): standard logging pattern for all deploy scripts"

# Metrics
duration: 17min
completed: 2026-02-11
---

# Phase 33 Plan 01: Shared Deploy Library + Build/Deploy Scripts Summary

**Standalone Anchor provider, step logger with tx file, account existence checks, and build/deploy shell scripts for all 5 programs**

## Performance

- **Duration:** 17 min
- **Started:** 2026-02-11T00:24:18Z
- **Completed:** 2026-02-11T00:41:56Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments
- Shared TypeScript library with loadProvider, loadPrograms, createLogger, accountExists, programIsDeployed, and mintExists
- Build script that runs anchor build, verifies .so artifacts, and checks program ID consistency via verify-program-ids.ts
- Deploy script that deploys all 5 programs using canonical keypairs with auto-airdrop and post-deploy verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared TypeScript library (connection, logger, account-check)** - `a0fda3a` (feat)
2. **Task 2: Create build.sh and deploy.sh shell scripts** - `71f390e` (feat)

## Files Created/Modified
- `scripts/deploy/lib/connection.ts` - Standalone Anchor provider + typed program loading from IDL files
- `scripts/deploy/lib/logger.ts` - Step-by-step terminal output with ANSI colors + tx signature log file
- `scripts/deploy/lib/account-check.ts` - On-chain account existence checks (accounts, programs, mints)
- `scripts/deploy/build.sh` - anchor build + artifact check + verify-program-ids.ts
- `scripts/deploy/deploy.sh` - solana program deploy for all 5 programs with canonical keypairs

## Decisions Made
- Auto-airdrop on localnet/devnet when balance < 5 SOL (per 33-CONTEXT.md Claude's discretion -- removes manual step for first-time deployment)
- Shell scripts cd to project root via `$(dirname "$0")/../..` so they work regardless of caller's cwd
- connection.ts resolves IDL paths via `__dirname` for cwd-independent operation
- account-check.ts mintExists checks both TOKEN_2022_PROGRAM_ID and TOKEN_PROGRAM_ID ownership (handles WSOL which uses SPL Token)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Shared library ready for Plan 02 (initialize.ts) and Plan 03 (verify.ts)
- loadProvider and loadPrograms provide the Anchor foundation for all TypeScript deployment scripts
- createLogger provides consistent logging across all scripts
- accountExists, programIsDeployed, mintExists enable idempotent initialization
- Build and deploy scripts ready for Phase 34 devnet deployment

---
*Phase: 33-deployment-scripts*
*Completed: 2026-02-11*
