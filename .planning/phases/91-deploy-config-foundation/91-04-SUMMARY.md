---
phase: 91-deploy-config-foundation
plan: 04
subsystem: infra
tags: [typescript, deployment, verification, binary-check, on-chain-validation]

# Dependency graph
requires:
  - phase: 91-deploy-config-foundation
    plan: 01
    provides: DeploymentConfig schema, deployments/devnet.json, deployment-schema.ts
provides:
  - Deep on-chain verification reading from deployments/{cluster}.json
  - Devnet-address-in-mainnet-binary detection in deploy pipeline
  - Enhanced deployment report with category breakdown
affects: [94-deploy-pipeline, 95-verify-upgrade]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-as-verification-source: verify.ts reads deployment.json as primary truth, falls back to pda-manifest derivation"
    - "Binary address cross-check: grep compiled .so files for wrong-cluster addresses before deploy"

key-files:
  created: []
  modified:
    - scripts/deploy/verify.ts
    - scripts/deploy/deploy-all.sh

key-decisions:
  - "verify.ts falls back to pda-manifest derivation when deployment.json doesn't exist, easing migration"
  - "Cross-check pda-manifest.json against deployment.json when both exist (warns on mismatches)"
  - "Upgrade authority verified by parsing BPF Loader Upgradeable program data account structure"
  - "Binary address check uses grep -F for literal string match (not regex) against base58 addresses"
  - "Only 4 feature-flagged programs checked for devnet addresses (conversion_vault, tax_program, epoch_program, bonding_curve)"

patterns-established:
  - "Deep verification pattern: existence + owner + properties for each account type"
  - "Binary safety gate: cross-cluster address contamination check before deploy"

requirements-completed: [INFRA-03, INFRA-04]

# Metrics
duration: 8min
completed: 2026-03-12
---

# Phase 91 Plan 04: Deep Verification and Binary Address Safety Summary

**verify.ts reads deployment.json for deep on-chain validation (programs, mints, PDAs, pools, ALT, authority) plus mainnet binary cross-check against devnet addresses**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-12T21:20:48Z
- **Completed:** 2026-03-12T21:29:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Rewrote verify.ts (663 -> 611 lines) to read deployments/{cluster}.json as primary source with full DeploymentConfig schema validation
- Deep program verification: executable flag, BPF Loader Upgradeable owner, upgrade authority matches deployment.json authority
- PDA ownership verification: each of 19 PDAs checked against expected owning program
- Pool verification: reserves > 0, vault existence, canonical mint ordering (mintA < mintB)
- ALT spot-check: deserializes lookup table and confirms key program addresses present
- Binary address detection in deploy-all.sh Phase 1.5: greps 4 feature-flagged .so files for devnet addresses on mainnet builds

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade verify.ts to read deployment.json and perform deep on-chain checks** - `0556da9` (feat)
2. **Task 2: Add devnet-address-in-mainnet-binary detection to deploy-all.sh** - `bac5217` (feat)

## Files Created/Modified
- `scripts/deploy/verify.ts` - Complete rewrite: reads deployment.json, deep verification of all protocol accounts with ownership/authority/property checks
- `scripts/deploy/deploy-all.sh` - Added Phase 1.5 binary address verification section (mainnet only)

## Decisions Made
- Backward compatibility: when deployment.json doesn't exist, falls back to deriving addresses from mint keypairs + pda-manifest (legacy path)
- Cross-check: when both pda-manifest.json and deployment.json exist, logs mismatches as warnings (not failures) to aid migration
- Upgrade authority parsing: reads BPF Loader Upgradeable program data account at offset 12-45 for Option<Pubkey>
- Binary check scope: only 4 programs that compile-in addresses via feature flags, not all 7 (AMM/Hook/Staking don't embed mint addresses)
- Used jq for address extraction from devnet.json and grep -F for literal matching in .so files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- verify.ts is ready to run against current devnet deployment via `CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/verify.ts`
- Binary address check is passive (only activates on mainnet builds) -- no devnet impact
- deploy-all.sh now has 7.5 phases (0, 1, 1.5, 2, 3, 4, 5, 6) with the safety gate integrated

---
*Phase: 91-deploy-config-foundation*
*Completed: 2026-03-12*
