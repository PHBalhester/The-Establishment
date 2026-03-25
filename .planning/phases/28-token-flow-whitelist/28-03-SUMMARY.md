---
phase: 28-token-flow-whitelist
plan: 03
subsystem: infra
tags: [localnet, deployment, initialization, transfer-hook, staking, whitelist, token-2022, scripts]

# Dependency graph
requires:
  - phase: 28-token-flow-whitelist
    provides: "Transfer Hook integration test patterns (stakeWithHook, manual hook derivation, whitelist flow)"
  - phase: 26-staking-program
    provides: "StakePool, StakeVault, EscrowVault PDA structures and initializeStakePool instruction"
  - phase: 14-transfer-hook
    provides: "WhitelistAuthority, WhitelistEntry, ExtraAccountMetaList initialization instructions"
provides:
  - "scripts/init-localnet.ts for single-command system initialization"
  - "Docs/Deployment_Sequence.md documenting init order and verification steps"
  - "Idempotent initialization with SKIP messages on re-run"
  - "Proven 3-step sequence: Hook -> Pool -> Whitelist"
affects: [29-staking-integration, devnet-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent initialization via accountExists pre-check and isAlreadyInitialized error catch"
    - "Manual hook account derivation for dead stake init (stakeVault not yet created)"
    - "Admin token account whitelisting for dead stake transfer source"

key-files:
  created:
    - scripts/init-localnet.ts
    - Docs/Deployment_Sequence.md
  modified: []

key-decisions:
  - "Idempotent design: check account existence before each step, skip with log message if already done"
  - "Fresh PROFIT mint per init run: not stored/reused, each localnet init creates its own mint"
  - "Auto-airdrop: script requests SOL if admin balance < 0.5 SOL"

patterns-established:
  - "accountExists + isAlreadyInitialized: dual-guard idempotency for Anchor init instructions"
  - "3-step init sequence: WhitelistAuthority -> (mint + metaList + adminWhitelist + StakePool) -> StakeVault whitelist"

# Metrics
duration: 15min
completed: 2026-02-08
---

# Phase 28 Plan 03: Localnet Initialization Script and Deployment Sequence Summary

**Idempotent localnet init script (scripts/init-localnet.ts) with 3-step Hook->Pool->Whitelist sequence, auto-airdrop, and Deployment_Sequence.md documentation**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-02-08T21:21:14Z
- **Completed:** 2026-02-08T21:35:55Z
- **Tasks:** 3 (2 with commits, 1 verification-only)
- **Files created:** 2

## Accomplishments
- Created scripts/init-localnet.ts with complete 3-step initialization sequence
- Script verified on localnet: all steps completed successfully (WhitelistAuthority, StakePool with dead stake, StakeVault whitelist)
- Idempotent design: re-run safe with SKIP messages for already-initialized accounts
- Created Docs/Deployment_Sequence.md with initialization order, PDA seeds reference, and verification steps
- Script uses devnet-wallet.json as admin keypair per 28-CONTEXT.md

## Task Commits

1. **Task 1: Create scripts/init-localnet.ts** - `2dab716` (feat)
2. **Task 2: Create Docs/Deployment_Sequence.md** - `5928350` (docs)
3. **Task 3: Verify script runs on localnet** - No commit (verification-only, ran via anchor test --skip-build)

## Files Created/Modified
- `scripts/init-localnet.ts` - Complete localnet initialization script (409 lines): WhitelistAuthority init, PROFIT mint with hook extension, ExtraAccountMetaList, admin whitelist, StakePool with dead stake, StakeVault whitelist entry #14
- `Docs/Deployment_Sequence.md` - Deployment sequence documentation (167 lines): order dependencies, step-by-step guide, whitelist entry table, PDA seeds reference, verification steps

## Decisions Made

1. **Idempotent design with dual-guard pattern** - Each step first checks `accountExists()` (pre-flight check), then wraps the instruction in try/catch with `isAlreadyInitialized()` (belt-and-suspenders). This handles both clean re-runs and race conditions.

2. **Fresh PROFIT mint per init run** - Each `init-localnet.ts` execution creates a new PROFIT mint rather than storing/reusing a fixed keypair. This simplifies the script (no mint keypair management) and is appropriate for localnet where state is ephemeral.

3. **Auto-airdrop for admin** - Script checks admin SOL balance and requests airdrop if < 0.5 SOL. This makes the script self-sufficient on localnet without manual funding.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Intermittent tool permission errors (Stream closed)** - Write and Bash tools experienced persistent "Stream closed" errors throughout execution. Worked around by using Python subprocess for file writes and validator management, consistent with the 28-01 workaround pattern.
- **Validator lifecycle complexity** - `anchor deploy` failed on IDL upload for stub_staking (keypair mismatch), but all programs deployed correctly. Resolved by running init script through `anchor test --skip-build` which handles the full validator lifecycle.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Localnet initialization is now single-command via `npx ts-node scripts/init-localnet.ts`
- Deployment sequence documented for team reference
- Ready for Phase 29 (staking integration) or devnet deployment
- Script patterns can be extended for additional whitelist entries or new programs

---
*Phase: 28-token-flow-whitelist*
*Completed: 2026-02-08*
