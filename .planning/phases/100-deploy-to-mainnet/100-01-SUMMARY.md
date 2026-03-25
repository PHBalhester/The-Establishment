---
phase: 100-deploy-to-mainnet
plan: 01
subsystem: infra
tags: [squads, multisig, mainnet, deployment, env-config]

# Dependency graph
requires:
  - phase: 98.1-production-infrastructure-staging
    provides: Railway mainnet services, Helius RPC, domain config
  - phase: 97-squads-governance
    provides: setup-squads.ts script, Squads multisig patterns
  - phase: 92-mainnet-credentials
    provides: .env.mainnet template, CHANGE_ME_MAINNET convention
provides:
  - Mainnet-compatible setup-squads.ts with pubkey-based signer support
  - Resolved .env.mainnet with SQUADS_TIMELOCK_SECONDS=900 and signer env vars
  - Phase 98.1 completion gate confirmed
affects: [100-02, 100-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-mode signer architecture: devnet (file keypairs) vs mainnet (pubkey env vars)"
    - "CHANGE_ME_MAINNET placeholder for secrets that differ per deploy"

key-files:
  created: []
  modified:
    - scripts/deploy/setup-squads.ts
    - .env.mainnet

key-decisions:
  - "Phase 98.1 confirmed complete -- all infrastructure provisioned"
  - "setup-squads.ts uses env var detection (SQUADS_SIGNER_2_PUBKEY) to switch between devnet and mainnet modes"
  - "MAINNET_MIN_BALANCE raised from 10 to 32 SOL (25.54 actual + 20% contingency)"
  - "SQUADS_TIMELOCK_SECONDS=900 (15 min initial, per CONTEXT.md)"
  - "TREASURY_PUBKEY resolved: deployer wallet initially, update to Squads vault post-governance"
  - "Pool seed overrides set empty (graduate.ts uses dynamic balance-delta tracking)"

patterns-established:
  - "Mainnet signer architecture: 1 file keypair (proposer) + 1 Phantom pubkey + 1 Ledger pubkey"

# Metrics
duration: ~25min
completed: 2026-03-15
---

# Phase 100 Plan 01: Mainnet Signer Architecture + .env.mainnet Resolution Summary

**setup-squads.ts dual-mode signer support (file keypairs for devnet, env var pubkeys for mainnet) plus .env.mainnet resolved with SQUADS_TIMELOCK_SECONDS=900 and 32 SOL minimum balance**

## Performance

- **Duration:** ~25 min (across checkpoint-gated sessions)
- **Started:** 2026-03-15T18:30:00Z
- **Completed:** 2026-03-15T19:02:00Z
- **Tasks:** 4 (1 decision gate, 2 auto, 1 human-verify)
- **Files modified:** 2

## Accomplishments
- Confirmed Phase 98.1 infrastructure staging is complete (Railway, Helius, Cloudflare, UptimeRobot)
- Modified setup-squads.ts to support mainnet's 1-file + 2-pubkey signer architecture while preserving devnet backward compatibility
- Resolved all .env.mainnet open questions: MAINNET_MIN_BALANCE=32, SQUADS_TIMELOCK_SECONDS=900, treasury chicken-and-egg, pool seed override documentation

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm Phase 98.1 completion** - N/A (decision checkpoint, no code change)
2. **Task 2: Modify setup-squads.ts for mainnet signer architecture** - `2a91971` (feat)
3. **Task 3: Resolve .env.mainnet open questions** - N/A (gitignored file, local only)
4. **Task 4: Human verification** - N/A (approved checkpoint)

## Files Created/Modified
- `scripts/deploy/setup-squads.ts` - Added dual-mode signer support: devnet auto-generates keypairs, mainnet reads SQUADS_SIGNER_2_PUBKEY / SQUADS_SIGNER_3_PUBKEY env vars as PublicKeys
- `.env.mainnet` - Resolved open questions: MAINNET_MIN_BALANCE=32, SQUADS_TIMELOCK_SECONDS=900, pool seed overrides documented, Squads signer pubkey env vars added (local only, gitignored)

## Decisions Made
- Phase 98.1 is confirmed complete -- all 3 plans shipped, infrastructure ready for mainnet
- setup-squads.ts mode detection via SQUADS_SIGNER_2_PUBKEY presence (simple, no extra config flags)
- MAINNET_MIN_BALANCE=32 SOL (25.54 actual deploy cost + 20% contingency, rounded up)
- SQUADS_TIMELOCK_SECONDS=900 per CONTEXT.md (15 minutes initial, increase progressively)
- TREASURY_PUBKEY set to dedicated treasury wallet: 3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv (user-provided, NOT deployer wallet)
- Pool seed overrides left empty -- graduate.ts uses dynamic balance-delta tracking (Phase 94.1-03 decision)
- Signers 2+3 not auto-funded in mainnet mode (they fund themselves via Phantom/Ledger)

## Deviations from Plan

- **TREASURY_PUBKEY**: Plan suggested deployer wallet as initial treasury. This was an assumption — user provided a dedicated treasury wallet (`3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv`) instead. Updated in both `constants.rs` (compile-time) and `.env.mainnet`.

## CRITICAL NOTE FOR REMAINING PLANS

**NO ASSUMPTIONS in Phase 100.** This is mainnet deployment. Any decision not EXPLICITLY pre-decided in the plan MUST be surfaced to the user for discussion before proceeding. Do not infer, default, or resolve ambiguity autonomously. Ask first.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required. (.env.mainnet is already set up locally.)

## Next Phase Readiness
- setup-squads.ts is ready for mainnet Squads multisig creation (Plan 100-04)
- .env.mainnet is ready to source for mainnet deploy (Plan 100-02)
- Only CHANGE_ME_MAINNET values remaining are actual secrets (signer pubkeys, RPC URL) that get filled at deploy time
- Next plan: 100-02 (Execute Stages 0-4 pre-deploy)

---
*Phase: 100-deploy-to-mainnet*
*Completed: 2026-03-15*
