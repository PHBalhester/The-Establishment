# Verification: H125
**Status:** NOT_FIXED
**Evidence:** `app/hooks/useCurveState.ts` lines 191-199: Demo mode uses `BigInt(Math.floor(Number(TOTAL_FOR_SALE) * progress))`. Same pattern as H124 — Number intermediate for BigInt construction. Demo mode only; no financial impact.
