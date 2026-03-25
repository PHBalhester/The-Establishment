---
phase: 74-protocol-integration
plan: 03
subsystem: infra
tags: [anchor, initialize, bonding-curve, whitelist, transfer-hook, token-2022]

# Dependency graph
requires:
  - phase: 71-curve-foundation
    provides: bonding_curve program with initialize_curve, fund_curve, start_curve instructions
  - phase: 74-protocol-integration
    provides: Plan 02 -- connection.ts loads BondingCurve as 7th program, pda-manifest.ts generates 8 curve PDAs
  - phase: 33-deployment-scripts
    provides: initialize.ts with 17-step protocol bootstrap, helpers/constants.ts canonical PDA seeds
provides:
  - Extended initialize.ts with 26-step protocol bootstrap (9 new steps for curves)
  - Bonding curve PDA seed constants in canonical helpers/constants.ts
  - Both CurveState PDAs created, funded (460M tokens each), and started (Active)
  - 15 whitelist entries complete (13 pre-existing + 2 curve vaults)
  - Irreversible whitelist authority burn as final step
affects: [74-04 (graduation script), 74-05 (lifecycle testing), 75-launch-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Curve lifecycle ordering: init -> whitelist vault -> fund -> start (Transfer Hook requires vault whitelisted before token transfer)"
    - "Whitelist authority burn as absolute final step after all 15 entries verified"
    - "Anchor account.curveState.fetch() for status-based idempotent checks"

key-files:
  created: []
  modified:
    - tests/integration/helpers/constants.ts
    - scripts/deploy/initialize.ts

key-decisions:
  - "Step ordering: init -> whitelist -> fund -> start prevents Transfer Hook WhitelistCheckFailed (0x1770)"
  - "Admin balance assertion before fund_curve catches supply math errors early"
  - "Curve status check via account.curveState.fetch() for start_curve idempotency"
  - "Whitelist authority burn reads WhitelistAuthority.authority field (null = burned) for SKIPPED UX"

patterns-established:
  - "Bonding curve PDA derivation: CURVE_SEED + mint.toBuffer() for all 4 curve PDAs"
  - "Block-scoped fund/start steps to avoid variable shadowing in sequential per-token operations"

# Metrics
duration: 5min
completed: 2026-03-04
---

# Phase 74 Plan 03: Initialize.ts Curve Setup Summary

**Extended initialize.ts from 17 to 26 steps: init/whitelist/fund/start both bonding curves (460M tokens each) + irreversible whitelist authority burn**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-04T21:58:16Z
- **Completed:** 2026-03-04T22:03:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- 4 bonding curve PDA seed constants added to canonical helpers/constants.ts (CURVE_SEED, CURVE_TOKEN_VAULT_SEED, CURVE_SOL_VAULT_SEED, CURVE_TAX_ESCROW_SEED)
- 9 new steps added to initialize.ts covering the complete curve deployment lifecycle
- Correct ordering enforced: init curves -> whitelist vaults -> fund curves -> start curves -> burn authority
- All 15 whitelist entries accounted for before irreversible authority burn (3 admin + 3 vault + 4 pool + 1 stake + 2 carnage + 2 curve)
- PDA manifest generation includes bondingCurve program ID

## Task Commits

Each task was committed atomically:

1. **Task 1: Add bonding curve PDA seed constants** - `351786f` (feat)
2. **Task 2: Extend initialize.ts with 9 new curve steps** - `e73fece` (feat)

## Files Created/Modified
- `tests/integration/helpers/constants.ts` - Added 4 bonding curve PDA seed constants matching on-chain constants.rs
- `scripts/deploy/initialize.ts` - Extended from 17 to 26 steps with curve init, whitelist, fund, start, authority burn, and updated manifest generation

## Decisions Made
- **Step ordering: init -> whitelist -> fund -> start** -- fund_curve transfers 460M tokens via Token-2022 transfer_checked which triggers Transfer Hook. If the curve vault isn't whitelisted first, Transfer Hook rejects with WhitelistCheckFailed (0x1770). This makes whitelist before fund mandatory.
- **Admin balance assertion** -- Explicit check that admin account has >= 460M tokens before calling fund_curve. Catches token supply math errors early with clear error message instead of cryptic on-chain failure.
- **Status-based idempotent check for start_curve** -- Uses `programs.bondingCurve.account.curveState.fetch()` to read curve status. If not Initialized (already Active/Filled/Graduated/Failed), skips. More robust than accountExists since the account always exists after init.
- **WhitelistAuthority.authority null check for burn** -- Reads the on-chain WhitelistAuthority struct and checks if authority is null (burned). Shows "SKIPPED" with info message for operator clarity. The on-chain instruction is already idempotent, but this gives better UX.
- **Block-scoped fund/start steps** -- Each fund and start step is wrapped in a block scope `{ }` to avoid variable name conflicts between CRIME and FRAUD operations that share the same pattern.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- initialize.ts fully supports bonding curve deployment lifecycle (26 steps)
- Ready for Plan 04 (graduation orchestration script -- runs days/weeks later when curves fill)
- All whitelist entries in place, authority burn is the final irreversible step
- Token supply allocation exact: 1B minted -> 290M pools -> 250M vault -> 460M curves = 0 remaining

---
*Phase: 74-protocol-integration*
*Completed: 2026-03-04*
