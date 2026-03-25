---
phase: 34-devnet-deployment
plan: 01
subsystem: infra
tags: [helius, devnet, rpc, commitment, env-vars, deployment-pipeline]

# Dependency graph
requires:
  - phase: 33-deployment-scripts
    provides: deploy-all.sh, initialize.ts, verify.ts, connection.ts deployment pipeline
provides:
  - Helius devnet RPC endpoint configuration in .env
  - Configurable commitment level (finalized for devnet) in connection.ts
  - Environment variable overrides for seed liquidity amounts in constants.ts
  - .env sourcing in deploy-all.sh for child process env propagation
  - Fresh mint keypair generation (localnet keypairs cleared)
affects: [34-02-devnet-deployment, 35-vrf-integration, 36-mainnet-preparation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Environment variable overrides with _OVERRIDE suffix for deployment-time configuration"
    - "set -a / source .env / set +a pattern for shell env propagation to child processes"
    - "Configurable commitment level via COMMITMENT env var (confirmed default, finalized for devnet)"

key-files:
  created: []
  modified:
    - ".env"
    - "scripts/deploy/lib/connection.ts"
    - "tests/integration/helpers/constants.ts"
    - "scripts/deploy/deploy-all.sh"

key-decisions:
  - "COMMITMENT env var with confirmed default -- backward compatible with localnet"
  - "_OVERRIDE suffix on env var names to distinguish from constant names"
  - "set -a / source .env pattern over export $(cat .env) for special character safety"
  - "Fresh mint keypairs for devnet (deleted localnet keypairs)"

patterns-established:
  - "Env var overrides with _OVERRIDE suffix: explicit, non-colliding, test-safe"
  - "Shell .env loading with set -a/+a for child process propagation"

# Metrics
duration: 3min
completed: 2026-02-11
---

# Phase 34 Plan 01: Devnet Pipeline Configuration Summary

**Helius devnet RPC, finalized commitment, mainnet-accurate seed liquidity overrides, and .env auto-sourcing in deploy-all.sh**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-11T16:28:03Z
- **Completed:** 2026-02-11T16:30:49Z
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments

- Deployment pipeline now targets Helius devnet RPC with finalized commitment for transaction permanence
- Seed liquidity amounts are configurable via env vars, with test defaults preserved for existing integration tests
- deploy-all.sh auto-sources .env on startup, propagating all config to child processes (initialize.ts, verify.ts)
- Localnet mint keypairs cleared so devnet gets fresh, independent mint addresses

## Task Commits

Each task was committed atomically:

1. **Task 1: Create .env with Helius devnet RPC and update connection.ts commitment** - `31071d7` (feat)
2. **Task 2: Add environment variable overrides for seed liquidity constants** - `de615a9` (feat)
3. **Task 3: Clear localnet mint keypairs and update deploy-all.sh to source .env** - `7497861` (feat)

## Files Created/Modified

- `.env` - Added HELIUS_API_KEY, CLUSTER_URL, COMMITMENT, and 4 seed liquidity overrides (gitignored)
- `scripts/deploy/lib/connection.ts` - COMMITMENT env var with confirmed fallback, updated JSDoc
- `tests/integration/helpers/constants.ts` - 4 seed liquidity constants now read _OVERRIDE env vars
- `scripts/deploy/deploy-all.sh` - Added .env sourcing with set -a/+a for child process propagation
- `scripts/deploy/mint-keypairs/` - Deleted (gitignored, devnet gets fresh keypairs)

## Decisions Made

- **COMMITMENT env var with confirmed default:** Preserves backward compatibility for localnet/test usage while allowing devnet to use finalized. No code changes needed to switch back.
- **_OVERRIDE suffix on env var names:** Prevents collision with constant names and makes it explicit these are non-default values. Tests don't set these vars, so defaults apply automatically.
- **set -a / source .env / set +a pattern:** Safer than `export $(cat .env)` which breaks on URLs with `?` and `=` characters (like the Helius URL). The set -a approach handles all value formats.
- **Fresh mint keypairs for devnet:** Localnet and devnet are separate clusters. Reusing localnet addresses would create confusion in PDA manifests.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- TypeScript bare `tsc --noEmit` (without tsconfig) reports pre-existing Anchor eventemitter3 esModuleInterop errors. This is unrelated to our changes -- compilation passes correctly with project tsconfig settings.

## User Setup Required

None - .env was already configured as part of this plan. The Helius API key and all configuration values are in place.

## Next Phase Readiness

- deploy-all.sh is fully configured to execute against devnet
- Next plan (34-02) can run `./scripts/deploy/deploy-all.sh` for the actual devnet deployment
- Devnet wallet (8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4) will need SOL airdrop before deployment (auto-airdrop is built into initialize.ts)

---
*Phase: 34-devnet-deployment*
*Completed: 2026-02-11*
