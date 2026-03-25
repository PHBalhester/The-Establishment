# VERIFY-H096: BN.toNumber() Calls in Frontend Hooks
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- Phase 89-04 (commits 2cf66c9, 9378168) converted `quote-engine.ts` to full BigInt arithmetic and updated callers in `useRoutes.ts` to pass BigInt values.
- However, `.toNumber()` calls remain in Anchor deserialization across multiple hooks:
  - `useStaking.ts` (lines 261, 264, 311, 313-315, 327, 329-331)
  - `useEpochState.ts` (line 63)
  - `usePoolPrices.ts` (line 95)
  - `useCarnageData.ts` (line 72)
  - `useCurveState.ts` (line 96)
- These convert Anchor BN u64 values to JS numbers at the deserialization boundary.

## Assessment
Accepted risk, partially mitigated. The quote-engine BigInt migration (phase 89) addresses the arithmetic precision concern — all swap calculations now use BigInt. The remaining `.toNumber()` calls are at the Anchor deserialization boundary for display purposes. As documented in useStaking.ts line 308: max PROFIT supply is ~1e15 and max SOL is ~5e17, both within `Number.MAX_SAFE_INTEGER` (9e15). These values would need to exceed 9 quadrillion to overflow, which is not possible with current token supplies. No change from Round 2 status.
