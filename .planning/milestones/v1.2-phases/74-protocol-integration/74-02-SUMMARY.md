---
phase: 74-protocol-integration
plan: 02
subsystem: infra
tags: [anchor, deploy-pipeline, bonding-curve, pda-manifest, alt]

# Dependency graph
requires:
  - phase: 71-curve-foundation
    provides: bonding_curve program with declare_id, constants.rs, feature-gated mints
  - phase: 33-deployment-scripts
    provides: build.sh, deploy.sh, patch-mint-addresses.ts, connection.ts, pda-manifest.ts
provides:
  - 7th program (bonding_curve) integrated into build/deploy/patch pipeline
  - BondingCurve program loading via connection.ts
  - 8 bonding curve PDA addresses in pda-manifest.ts
  - 9 bonding curve addresses in protocol ALT
affects: [74-03 (initialize.ts), 74-04 (graduation script), 75-launch-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Feature-gated devnet rebuild: anchor build -p bonding_curve -- --features devnet"
    - "PDA manifest pattern extended for bonding curve (4 PDAs per mint x 2 mints)"

key-files:
  created: [keypairs/bonding-curve-keypair.json]
  modified:
    - scripts/deploy/build.sh
    - scripts/deploy/deploy.sh
    - scripts/deploy/patch-mint-addresses.ts
    - scripts/deploy/lib/connection.ts
    - scripts/deploy/lib/pda-manifest.ts
    - scripts/e2e/lib/alt-helper.ts
    - scripts/e2e/devnet-e2e-validation.ts

key-decisions:
  - "BondingCurve optional in PDAManifest type for backward compat with pre-curve manifests"

patterns-established:
  - "7th program pipeline pattern: same build/deploy/patch/load/manifest/ALT integration"

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 74 Plan 02: Deploy Pipeline Extension Summary

**Bonding curve wired as 7th program into build.sh, deploy.sh, patch-mint-addresses.ts, connection.ts, pda-manifest.ts, and alt-helper.ts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T21:51:02Z
- **Completed:** 2026-03-04T21:54:43Z
- **Tasks:** 2
- **Files modified:** 8 (7 modified + 1 created)

## Accomplishments
- Build pipeline compiles bonding_curve with devnet feature and verifies .so artifact
- Deploy pipeline deploys bonding_curve via keypairs/bonding-curve-keypair.json
- Address patching covers all 3 feature-gated functions (crime_mint, fraud_mint, epoch_program_id) in bonding_curve/src/constants.rs
- connection.ts loads BondingCurve as typed 7th program (verified: program ID AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1)
- PDA manifest generates 8 bonding curve PDAs (CurveState, CurveTokenVault, CurveSolVault, CurveTaxEscrow for CRIME + FRAUD)
- ALT helper collects up to 9 bonding curve addresses (1 program + 8 PDAs), total ALT ~55 addresses

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend build.sh, deploy.sh, and patch-mint-addresses.ts** - `03d002a` (feat)
2. **Task 2: Extend connection.ts, pda-manifest.ts, and alt-helper.ts** - `809c5f1` (feat)

## Files Created/Modified
- `keypairs/bonding-curve-keypair.json` - Copied from target/deploy, pubkey AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1
- `scripts/deploy/build.sh` - Added bonding_curve to devnet rebuild + artifact verification (6->7 programs)
- `scripts/deploy/deploy.sh` - Added bonding_curve:keypairs/bonding-curve-keypair.json to PROGRAMS array (6->7)
- `scripts/deploy/patch-mint-addresses.ts` - Added Category 4: 3 PatchSpec entries for bonding_curve/src/constants.rs
- `scripts/deploy/lib/connection.ts` - Added BondingCurve import, Programs interface field, loadPrograms entry (6->7)
- `scripts/deploy/lib/pda-manifest.ts` - Added bondingCurve to ProgramIds, 8 PDA derivations, 8 pdaProgram mappings
- `scripts/e2e/lib/alt-helper.ts` - Added bonding curve program + 8 PDA addresses to collectProtocolAddresses
- `scripts/e2e/devnet-e2e-validation.ts` - Added optional BondingCurve field to PDAManifest.programs type

## Decisions Made
- Made BondingCurve optional (`BondingCurve?: string`) in PDAManifest type to maintain backward compatibility with existing manifests that predate the bonding curve addition

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated PDAManifest type in devnet-e2e-validation.ts**
- **Found during:** Task 2 (alt-helper.ts imports PDAManifest from devnet-e2e-validation.ts)
- **Issue:** PDAManifest.programs uses specific typed fields (not Record<string, string>), so accessing `manifest.programs.BondingCurve` would be a TypeScript error without updating the type
- **Fix:** Added `BondingCurve?: string` to the PDAManifest.programs interface
- **Files modified:** scripts/e2e/devnet-e2e-validation.ts
- **Verification:** TypeScript compilation succeeds, alt-helper.ts can access BondingCurve field
- **Committed in:** 809c5f1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Type update was necessary for correct TypeScript compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Deploy pipeline fully supports bonding curve as 7th program
- Ready for Plan 03 (initialize.ts: curve initialization, funding, starting, whitelist entries)
- Keypair confirmed: AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1

---
*Phase: 74-protocol-integration*
*Completed: 2026-03-04*
