---
phase: 75-launch-page
plan: 01
subsystem: ui
tags: [bonding-curve, bigint, anchor, websocket, idl, curve-math]

# Dependency graph
requires:
  - phase: 71-curve-foundation
    provides: Bonding curve program with CurveState, math.rs, constants.rs
  - phase: 74-protocol-integration
    provides: Deployed bonding_curve program on devnet (AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1)
provides:
  - Bonding curve IDL synced to app/idl/ with TypeScript types
  - getBondingCurveProgram() factory function
  - BONDING_CURVE program ID and curve PDA seeds in shared/constants.ts
  - DEVNET_CURVE_PDAS with 8 pre-computed addresses (4 per curve)
  - Client-side BigInt curve math (calculateTokensOut, calculateSolForTokens, calculateSellTax, getCurrentPrice)
  - Curve error map with parseCurveError() for all 24 error variants
  - useCurveState hook with dual-PDA WebSocket subscription
affects: [75-02, 75-03, 75-04, 75-launch-page]

# Tech tracking
tech-stack:
  added: []
  patterns: [BigInt curve arithmetic, dual-PDA WebSocket subscription]

key-files:
  created:
    - app/idl/bonding_curve.json
    - app/idl/types/bonding_curve.ts
    - app/lib/curve/curve-constants.ts
    - app/lib/curve/curve-math.ts
    - app/lib/curve/error-map.ts
    - app/hooks/useCurveState.ts
  modified:
    - app/scripts/sync-idl.mjs
    - app/lib/anchor.ts
    - shared/constants.ts
    - shared/index.ts
    - app/tsconfig.json

key-decisions:
  - "Bumped tsconfig target from ES2017 to ES2020 for BigInt literal support"
  - "Used deriveCurvePdas() helper to pre-compute 8 devnet PDAs from seeds + mints at module load"
  - "Stored u64 math fields as bigint in CurveStateData for precision in curve-math calculations"

patterns-established:
  - "BigInt curve arithmetic: all intermediate values stay as bigint, only convert to Number for display"
  - "Dual-PDA WebSocket: subscribe to multiple accounts in one hook with shared visibility gating"

# Metrics
duration: 20min
completed: 2026-03-07
---

# Phase 75 Plan 01: Curve Data Foundation Summary

**BigInt port of on-chain curve math (quadratic + linear integral), IDL sync, and dual-PDA useCurveState WebSocket hook**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-07T09:49:56Z
- **Completed:** 2026-03-07T10:10:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Synced bonding_curve IDL and TypeScript types to app/idl/ via updated sync-idl.mjs
- Built complete BigInt curve math library matching on-chain math.rs (verified: calculateTokensOut, calculateSolForTokens, calculateSellTax, getCurrentPrice all produce correct values)
- Created useCurveState hook with real-time dual-PDA WebSocket subscription following the established useEpochState pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: IDL sync, Anchor factory, shared constants** - `0c09f23` (feat)
2. **Task 2: Client-side curve math, error map, and useCurveState hook** - `96c3b9d` (feat)

## Files Created/Modified
- `app/scripts/sync-idl.mjs` - Added "bonding_curve" to PROGRAMS array
- `app/idl/bonding_curve.json` - Synced bonding curve IDL from target/idl/
- `app/idl/types/bonding_curve.ts` - Synced TypeScript types from target/types/
- `app/lib/anchor.ts` - Added getBondingCurveProgram() factory function
- `shared/constants.ts` - Added BONDING_CURVE program ID, PDA seeds, pre-computed devnet PDAs, curve constants
- `shared/index.ts` - Exported new curve constants and DEVNET_CURVE_PDAS
- `app/tsconfig.json` - Bumped target from ES2017 to ES2020 for BigInt support
- `app/lib/curve/curve-constants.ts` - BigInt port of on-chain constants.rs
- `app/lib/curve/curve-math.ts` - BigInt port of math.rs (quadratic formula, linear integral, sell tax, spot price)
- `app/lib/curve/error-map.ts` - Maps all 24 CurveError variants (6000-6023) to user messages
- `app/hooks/useCurveState.ts` - Dual-PDA WebSocket subscription with visibility gating

## Decisions Made
- **Bumped tsconfig target to ES2020**: BigInt literals (e.g., `900n`) require ES2020+ target. The `lib` already included `esnext` and Next.js uses SWC for actual compilation, so this is safe and only affects type checking.
- **Pre-computed PDAs via helper function**: `deriveCurvePdas()` uses `PublicKey.findProgramAddressSync` at module load time to derive all 8 curve PDAs (4 per mint). Avoids runtime PDA derivation in hooks.
- **bigint for u64 math fields**: CurveStateData stores tokensSold, solRaised, etc. as bigint (not number) to maintain precision when passed to curve-math functions. Slot numbers remain plain number (safe for centuries).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated shared/index.ts barrel exports**
- **Found during:** Task 2 (useCurveState import)
- **Issue:** DEVNET_CURVE_PDAS and curve constants were defined in shared/constants.ts but not exported from shared/index.ts barrel file
- **Fix:** Added all new exports (DEVNET_CURVE_PDAS, CURVE_TARGET_SOL, CURVE_TARGET_TOKENS, MAX_TOKENS_PER_WALLET, MIN_PURCHASE_SOL, CURVE_SELL_TAX_BPS, CURVE_DEADLINE_SLOTS) to shared/index.ts
- **Files modified:** shared/index.ts
- **Verification:** TypeScript compilation succeeds, import resolves correctly
- **Committed in:** 96c3b9d (Task 2 commit)

**2. [Rule 3 - Blocking] Bumped tsconfig target from ES2017 to ES2020**
- **Found during:** Task 2 (curve-constants.ts BigInt literals)
- **Issue:** BigInt literals (e.g., `900n`) produce TS2737 error when target < ES2020
- **Fix:** Changed tsconfig.json target from "ES2017" to "ES2020"
- **Files modified:** app/tsconfig.json
- **Verification:** All BigInt errors resolved, compilation succeeds
- **Committed in:** 96c3b9d (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes necessary for compilation. No scope creep.

## Issues Encountered
- Pre-existing TypeScript error in lib/staking/staking-builders.ts (references removed systemProgram account). Not related to this plan, does not affect curve code. Listed as existing deferred item.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data foundation complete: all subsequent Phase 75 plans can import curve math, error map, and useCurveState directly
- useCurveState will work on devnet once bonding curves are initialized and started (currently requires deployed CurveState PDAs)
- Curve math verified correct via runtime tests against known values

---
*Phase: 75-launch-page*
*Completed: 2026-03-07*
