---
phase: 91-deploy-config-foundation
plan: 01
subsystem: infra
tags: [typescript, deployment, json-schema, env-config, pda-derivation]

# Dependency graph
requires:
  - phase: 33-deployment-scripts
    provides: pda-manifest.ts, initialize.ts, deploy pipeline
provides:
  - DeploymentConfig TypeScript schema with validation
  - deployments/devnet.json canonical address source
  - generateDeploymentConfig() in pda-manifest.ts
  - generate-deployment-json.ts standalone script
  - .env.devnet and .env.mainnet cluster-specific env files
  - initialize.ts writes deployments/{cluster}.json automatically
affects: [92-generate-constants, 93-metadata-arweave, 94-deploy-pipeline, 95-verify-upgrade]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-as-source-of-truth: deployments/{cluster}.json is canonical for all protocol addresses"
    - "Schema versioning: schemaVersion field for forward compatibility"
    - "Cluster-specific env files: .env.devnet (committed) and .env.mainnet (gitignored)"

key-files:
  created:
    - scripts/deploy/lib/deployment-schema.ts
    - scripts/deploy/generate-deployment-json.ts
    - deployments/devnet.json
    - .env.devnet
    - .env.mainnet
  modified:
    - scripts/deploy/lib/pda-manifest.ts
    - scripts/deploy/initialize.ts
    - .gitignore

key-decisions:
  - "DeploymentConfig uses camelCase field names (programs.amm not programs.AMM) for consistency with TypeScript conventions"
  - "Deployer address sourced from keypairs/devnet-wallet.json over system default solana keypair"
  - "Kept existing pda-manifest.json generation alongside new deployments/{cluster}.json for backward compatibility"
  - "Bonding curve PDAs organized by faction (crime/fraud) in curvePdas section"
  - "Hook ExtraAccountMetaList PDAs in dedicated hookAccounts section separate from pdas"

patterns-established:
  - "Config-as-source-of-truth: all protocol addresses derive from deployments/{cluster}.json"
  - "Schema validation: validateDeploymentConfig() checks all addresses are valid base58"
  - "Cluster env split: .env.devnet committed, .env.mainnet gitignored"

requirements-completed: [INFRA-01, INFRA-13]

# Metrics
duration: 10min
completed: 2026-03-12
---

# Phase 91 Plan 01: Deploy Config Foundation Summary

**DeploymentConfig schema with 19 PDAs, 7 programs, 3 mints in deployments/devnet.json plus cluster-specific .env split**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-12T21:14:07Z
- **Completed:** 2026-03-12T21:24:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created TypeScript DeploymentConfig interface with schemaVersion, programs, mints, pdas, pools, curvePdas, hookAccounts, alt, treasury, authority sections
- Generated deployments/devnet.json from existing Anchor.toml + mint-keypairs with all addresses verified against pda-manifest.json
- Split .env into cluster-specific .env.devnet (committed) and .env.mainnet (gitignored) to prevent wrong-cluster secrets
- Extended initialize.ts to auto-write deployments/{cluster}.json after initialization

## Task Commits

Each task was committed atomically:

1. **Task 1: Create deployment.json schema and generate devnet config** - `245bced` (feat)
2. **Task 2: Split .env into cluster files, extend initialize.ts** - `a75ee70` (feat)

## Files Created/Modified
- `scripts/deploy/lib/deployment-schema.ts` - DeploymentConfig interface + validateDeploymentConfig()
- `scripts/deploy/lib/pda-manifest.ts` - Added generateDeploymentConfig() function
- `scripts/deploy/generate-deployment-json.ts` - Standalone script to generate deployment JSON from Anchor.toml + mint keypairs
- `deployments/devnet.json` - Canonical devnet deployment config (schemaVersion: 1, 7 programs, 3 mints, 19 PDAs, 2 pools, 2 curve sets, 3 hook accounts, ALT, treasury, authority)
- `.env.devnet` - Devnet environment variables (committed to git)
- `.env.mainnet` - Mainnet environment template with placeholders (gitignored)
- `.gitignore` - Added .env.mainnet
- `scripts/deploy/initialize.ts` - Step 26b writes deployments/{cluster}.json

## Decisions Made
- Used camelCase for deployment.json field names (e.g., `crimeSol` not `CRIME/SOL`) for TypeScript convention alignment
- Preferred devnet-wallet.json over system Solana CLI keypair for deployer/treasury address
- Kept pda-manifest.json generation in initialize.ts for backward compatibility until downstream consumers migrate
- Put bonding curve PDAs in a separate `curvePdas` section rather than flattening into `pdas` for clearer structure
- Hook ExtraAccountMetaList PDAs get their own `hookAccounts` section since they're per-mint, not singleton

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in initialize.ts (BcAdminConfig missing from bonding curve instructions, DEPLOY-GAP-01) are unrelated to this plan's changes. The new deployment-schema.ts and pda-manifest.ts compile cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- deployments/devnet.json is ready for generate-constants.ts (Plan 02) to consume
- .env.devnet and .env.mainnet ready for deploy-all.sh cluster argument support (Plan 03)
- Schema validation function ready for verify.ts deep verification (Plan 04)

---
*Phase: 91-deploy-config-foundation*
*Completed: 2026-03-12*
