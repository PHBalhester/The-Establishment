---
phase: 106-vault-convert-all
plan: 02
subsystem: client-swap
tags: [anchor, typescript, swap-builders, multi-hop, error-map, convert-v2, token-2022]

# Dependency graph
requires:
  - phase: 106-vault-convert-all
    plan: 01
    provides: "convert_v2 on-chain instruction with sentinel balance reading and slippage guard"
  - phase: 53-swap-builders
    provides: "buildVaultConvertTransaction, multi-hop-builder, error-map infrastructure"
provides:
  - "All client swap paths use convertV2 instead of convert"
  - "Multi-hop vault steps pass amount_in=0 for convert-all mode"
  - "Vault error map (8 entries: 6000-6007) with SlippageExceeded and InvalidOwner"
  - "parseSwapError detects vault program errors"
affects: [106-03-devnet-upgrade, 106-04-mainnet-upgrade, 107-jupiter-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isMultiHopStep flag to differentiate vault convert-all (0) vs exact-amount modes"
    - "Program ID detection in parseSwapError for vault vs AMM vs tax error routing"

key-files:
  created: []
  modified:
    - "app/lib/swap/swap-builders.ts"
    - "app/lib/swap/multi-hop-builder.ts"
    - "app/lib/swap/error-map.ts"
    - "app/idl/conversion_vault.json"
    - "app/idl/types/conversion_vault.ts"

key-decisions:
  - "IDL synced from target/ to app/idl/ as prerequisite (no sync-idl.mjs script exists)"
  - "isMultiHopStep defaulted to false in buildStepTransaction signature for backwards compatibility"
  - "useSwap.ts required zero changes — already passed minimumOutput correctly"

patterns-established:
  - "Multi-hop vault convert-all: isMultiHopStep=true triggers amount_in=0 for on-chain balance reading"
  - "Error map program ID detection order: vault first, then AMM, then tax (fallback)"

requirements-completed: [VAULT-04, VAULT-06]

# Metrics
duration: 7min
completed: 2026-03-26
---

# Phase 106 Plan 02: Client Integration for convertV2 Summary

**All client swap paths wired to convertV2 with multi-hop convert-all mode (amount_in=0) and 8-entry vault error map for SlippageExceeded/InvalidOwner**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-26T10:03:04Z
- **Completed:** 2026-03-26T10:10:22Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- buildVaultConvertTransaction now calls `.convertV2(amountIn, minimumOutput)` instead of `.convert(amountIn)`, forwarding the previously-unused minimumOutput param to the on-chain slippage guard
- Multi-hop vault steps pass `amount_in=0` (convert-all mode) via `isMultiHopStep` flag, eliminating intermediate token leakage that caused Blowfish wallet warnings
- Vault error map covers all 8 error codes (6000-6007) with user-friendly messages, and parseSwapError routes vault program errors correctly
- IDL synced from target/ with the new convertV2 method so the Anchor program instance recognizes the instruction

## Task Commits

Each task was committed atomically:

1. **Task 1: Update swap-builders.ts and useSwap.ts to use convertV2** - `07e491b` (feat)
2. **Task 2: Update multi-hop builder for convert-all mode + vault error map** - `ebbcee1` (feat)

## Files Created/Modified
- `app/idl/conversion_vault.json` - Synced from target/ to include convertV2 instruction definition
- `app/idl/types/conversion_vault.ts` - Synced TypeScript types for convertV2 method
- `app/lib/swap/swap-builders.ts` - buildVaultConvertTransaction calls .convertV2() with minimumOutput
- `app/lib/swap/multi-hop-builder.ts` - isMultiHopStep flag triggers convert-all mode for vault steps in multi-hop routes
- `app/lib/swap/error-map.ts` - VAULT_ERRORS map (8 entries), SWAP_ERROR_MAP includes vault, parseSwapError detects vault program ID

## Decisions Made
- IDL synced manually via `cp` because `scripts/sync-idl.mjs` does not exist in this project. Copied both JSON and types.
- `isMultiHopStep` parameter defaults to `false` in `buildStepTransaction` signature so callers that don't pass it (none currently, but defensive) get exact-amount behavior.
- useSwap.ts needed zero code changes -- it already passed `minimumOutput: quote.minimumOutput` to buildVaultConvertTransaction. The value was simply not being forwarded to the on-chain instruction before this change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] IDL sync prerequisite**
- **Found during:** Task 1 (before any client changes)
- **Issue:** `scripts/sync-idl.mjs` does not exist. The app IDL at `app/idl/conversion_vault.json` lacked the `convert_v2` instruction added in 106-01. The Anchor program instance would throw "method not found" without it.
- **Fix:** Manually copied `target/idl/conversion_vault.json` and `target/types/conversion_vault.ts` to `app/idl/`.
- **Files modified:** app/idl/conversion_vault.json, app/idl/types/conversion_vault.ts
- **Verification:** `grep -c "convert_v2" app/idl/conversion_vault.json` returns 1
- **Committed in:** 07e491b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** IDL sync was a prerequisite the plan already anticipated (it mentioned running sync-idl.mjs or manually copying). No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All client swap paths use convertV2 -- ready for devnet upgrade testing (106-03)
- Error map covers all vault error codes for UI display
- No on-chain files were modified (those were complete in 106-01)
- Devnet upgrade can proceed: deploy updated vault program, then test all 6 multi-hop routes

---
*Phase: 106-vault-convert-all*
*Completed: 2026-03-26*
