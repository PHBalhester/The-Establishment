---
phase: 75-launch-page
plan: 02
subsystem: ui
tags: [bonding-curve, transfer-hook, anchor, transaction-builder, token-2022]

# Dependency graph
requires:
  - phase: 75-launch-page
    provides: "Plan 01: IDL sync, Anchor factory, shared constants, curve math, useCurveState hook"
  - phase: 71-curve-foundation
    provides: "Bonding curve program with purchase/sell/claim_refund instructions"
provides:
  - getCurveHookAccounts() for Transfer Hook remaining_accounts derivation
  - buildPurchaseInstruction() for buying tokens with SOL
  - buildSellInstruction() for selling tokens with 15% tax
  - buildClaimRefundInstruction() for refund claims on failed curves
affects: [75-03, 75-04, 75-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [accountsStrict for Anchor instruction building, manual Transfer Hook PDA derivation]

key-files:
  created:
    - app/lib/curve/hook-accounts.ts
    - app/lib/curve/curve-tx-builder.ts
  modified: []

key-decisions:
  - "Used accountsStrict() instead of accounts() to match staking-builders.ts project pattern"
  - "Manual PDA derivation for Transfer Hook accounts (no spl-token browser polyfill issues)"

patterns-established:
  - "Curve hook account resolution: getCurveHookAccounts(mint, source, dest) returns 4 AccountMeta"
  - "Instruction builders accept Program<BondingCurve> and return Promise<TransactionInstruction>"

# Metrics
duration: 14min
completed: 2026-03-07
---

# Phase 75 Plan 02: Curve TX Builders Summary

**Transfer Hook account resolver + 3 bonding curve instruction builders (purchase, sell, claim_refund) using accountsStrict and manual PDA derivation**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-03-07T10:20:33Z
- **Completed:** 2026-03-07T10:34:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Built getCurveHookAccounts() that derives all 4 Transfer Hook remaining_accounts using manual PDA derivation (meta_list, whitelist_source, whitelist_dest, hook_program)
- Created 3 instruction builders: purchase (buy with SOL + hooks), sell (sell for SOL minus tax + hooks), claim_refund (burn for refund, no hooks)
- Hook account direction correctly reversed between purchase (vault->user) and sell (user->vault)

## Task Commits

Each task was committed atomically:

1. **Task 1: Transfer Hook account resolver** - `cf0c3f1` (feat)
2. **Task 2: Bonding curve instruction builders** - `b02751a` (feat)

## Files Created/Modified
- `app/lib/curve/hook-accounts.ts` - getCurveHookAccounts() derives 4 Transfer Hook remaining_accounts for any mint/source/dest combination
- `app/lib/curve/curve-tx-builder.ts` - buildPurchaseInstruction, buildSellInstruction, buildClaimRefundInstruction with PDA derivation and BigInt->BN conversion

## Decisions Made
- **accountsStrict() over accounts()**: Anchor's newer type system with `ResolvedAccounts` rejects PDA accounts passed to `.accounts()`. Using `.accountsStrict()` matches the existing staking-builders.ts pattern and provides explicit account listing.
- **Manual PDA derivation for hooks**: Continues project standard of avoiding spl-token's `createTransferCheckedWithTransferHookInstruction` due to browser Buffer polyfill issues (documented in MEMORY.md).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed .accounts() to .accountsStrict()**
- **Found during:** Task 2 (instruction builders)
- **Issue:** Anchor's `ResolvedAccounts` type rejected PDA accounts passed to `.accounts()` -- TS error "Object literal may only specify known properties"
- **Fix:** Switched all three builders from `.accounts()` to `.accountsStrict()` matching staking-builders.ts pattern
- **Files modified:** app/lib/curve/curve-tx-builder.ts
- **Verification:** TypeScript compilation passes (only pre-existing staking-builders.ts error remains)
- **Committed in:** b02751a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for TypeScript compilation. No scope creep.

## Issues Encountered
- Pre-existing TypeScript error in lib/staking/staking-builders.ts (references removed systemProgram account). Not related to this plan, documented as existing deferred item.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Transaction builders ready for the buy/sell panel (Plan 04) and refund panel (Plan 05) to consume
- Hook accounts correctly derived for both CRIME and FRAUD mints
- All builders return Promise<TransactionInstruction> compatible with useProtocolWallet sign-then-send pattern

---
*Phase: 75-launch-page*
*Completed: 2026-03-07*
