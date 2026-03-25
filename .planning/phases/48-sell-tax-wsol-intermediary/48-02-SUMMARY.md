---
phase: 48-sell-tax-wsol-intermediary
plan: 02
subsystem: client-side
tags: [typescript, anchor-idl, pda, wsol, alt, deploy-scripts, swap-builders]

# Dependency graph
requires:
  - phase: 48-01-on-chain-wsol-intermediary
    provides: "Rewritten swap_sol_sell with wsolIntermediary account, initializeWsolIntermediary instruction, regenerated IDL"
  - phase: 42-swap-interface
    provides: "swap-builders.ts transaction builder architecture"
  - phase: 33-deployment-scripts
    provides: "initialize.ts protocol deployment, pda-manifest generator, alt-helper.ts"
provides:
  - "buildSolSellTransaction passes wsolIntermediary account in every sell TX"
  - "Sell transactions use 250k compute units (up from 200k) for transfer-close-distribute-reinit"
  - "initialize.ts Step 19 creates WSOL intermediary PDA on devnet before first sell"
  - "Protocol ALT includes WsolIntermediary address for 1232-byte TX compression"
  - "IDL types synced between anchor build output and app/"
  - "PDA manifest generator derives WsolIntermediary address"
affects:
  - "51-test-hardening (integration tests need updated account structs)"
  - "Any future sell flow changes (wsolIntermediary is now in every sell TX)"
  - "Devnet redeployment (re-run initialize.ts to create intermediary account)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WSOL_INTERMEDIARY_SEED exported from canonical test constants for manifest generator"

key-files:
  created: []
  modified:
    - "shared/constants.ts"
    - "app/lib/swap/swap-builders.ts"
    - "app/idl/types/tax_program.ts"
    - "app/idl/tax_program.json"
    - "scripts/deploy/initialize.ts"
    - "scripts/e2e/lib/alt-helper.ts"
    - "scripts/deploy/lib/pda-manifest.ts"
    - "tests/integration/helpers/constants.ts"
    - "scripts/deploy/pda-manifest.json"

key-decisions:
  - "Compute units bumped to 250k for sell (not 300k) -- research estimated 169k, 250k provides safe margin"
  - "WSOL_INTERMEDIARY_SEED added to test constants (canonical seed source) rather than inline in manifest generator"
  - "PDA manifest generator updated to derive WsolIntermediary -- regeneration on next deploy will include it"
  - "IDL types copied from Plan 01 build output (not rebuilt) -- build was fresh from same session"

patterns-established:
  - "New PDAs require: shared/constants.ts + pda-manifest generator + alt-helper.ts + test constants (4-point sync)"

# Metrics
duration: 4min
completed: 2026-02-19
---

# Phase 48 Plan 02: Client-Side WSOL Intermediary Wiring Summary

**Frontend swap-builders, deploy scripts, ALT, and IDL all updated for 21-account sell transactions with wsolIntermediary PDA**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-19T23:03:08Z
- **Completed:** 2026-02-19T23:07:06Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- buildSolSellTransaction now passes `wsolIntermediary: DEVNET_PDAS_EXTENDED.WsolIntermediary` in every sell TX
- Protocol deployment script has Step 19 calling `initializeWsolIntermediary` to create the WSOL intermediary PDA before first sell
- Protocol-wide ALT includes WsolIntermediary address (47 addresses total) for 1232-byte TX compression
- IDL types and JSON synced from Plan 01 build output to app/ directory

## Task Commits

Each task was committed atomically:

1. **Task 1: Derive WSOL intermediary PDA address and add to shared constants + ALT** - `e00193d` (feat)
2. **Task 2: Update swap-builders.ts, IDL types, and initialize.ts for WSOL intermediary** - `0c79591` (feat)

## Files Created/Modified

- `shared/constants.ts` - Added WsolIntermediary PDA to DEVNET_PDAS_EXTENDED
- `app/lib/swap/swap-builders.ts` - Added wsolIntermediary to sell accountsStrict, bumped CU to 250k, updated comments
- `app/idl/types/tax_program.ts` - Synced from anchor build output (includes initializeWsolIntermediary + 21-account SwapSolSell)
- `app/idl/tax_program.json` - Synced from anchor build output
- `scripts/deploy/initialize.ts` - Step 19 WSOL Intermediary init, TOTAL_STEPS = 20, PDA Manifest renumbered to Step 20
- `scripts/e2e/lib/alt-helper.ts` - WsolIntermediary included in protocol ALT with backward-compat guard
- `scripts/deploy/lib/pda-manifest.ts` - Import WSOL_INTERMEDIARY_SEED, derive and include WsolIntermediary in manifest
- `tests/integration/helpers/constants.ts` - Exported WSOL_INTERMEDIARY_SEED for canonical seed source
- `scripts/deploy/pda-manifest.json` - WsolIntermediary address added (gitignored, regenerated on deploy)

## Decisions Made

1. **250k compute units for sell** - Research estimated ~169k CU for the full transfer-close-distribute-reinit flow. 250k provides a comfortable safety margin without being wasteful. The previous 200k would have been too tight.

2. **WSOL_INTERMEDIARY_SEED in test constants** - Added the seed to `tests/integration/helpers/constants.ts` (the canonical seed source) rather than hardcoding it in the manifest generator. This maintains the single-source-of-truth pattern established for all other PDA seeds.

3. **IDL copy rather than rebuild** - Plan 01 ran `anchor build -p tax_program` in the same session, so the build output was fresh. Copied directly rather than re-running the 2-minute build.

4. **taxProgramId from programs object** - In initialize.ts, used `programs.taxProgram.programId` (already loaded from IDL) rather than hardcoding the program ID string. More maintainable if program IDs change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added WSOL_INTERMEDIARY_SEED to test constants**
- **Found during:** Task 2 (pda-manifest.ts update)
- **Issue:** The PDA manifest generator imports all seeds from `tests/integration/helpers/constants.ts`, but WSOL_INTERMEDIARY_SEED was not exported there (only exists in Rust constants.rs)
- **Fix:** Added `export const WSOL_INTERMEDIARY_SEED = Buffer.from("wsol_intermediary")` to the Tax Program PDA Seeds section
- **Files modified:** tests/integration/helpers/constants.ts
- **Verification:** pda-manifest.ts compiles with the import
- **Committed in:** 0c79591 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to maintain canonical seed source pattern. No scope creep.

## Issues Encountered

None -- all changes applied cleanly. IDL build output from Plan 01 was fresh and available.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 48 is now feature-complete (both plans done)
- On-chain Tax Program has the WSOL intermediary flow (Plan 01)
- Client-side code can build valid sell transactions (Plan 02)
- Devnet deployment: re-run `initialize.ts` to create the intermediary account (Step 19)
- Devnet ALT: re-run ALT helper to extend with the new address
- Integration tests need updating in Phase 51 (old 20-account struct references)

---
*Phase: 48-sell-tax-wsol-intermediary*
*Completed: 2026-02-19*
