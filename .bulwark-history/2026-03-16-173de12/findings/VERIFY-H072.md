# VERIFY-H072: Additive Price Impact Summation Across Hops
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- `app/hooks/useRoutes.ts` line 160: `totalPriceImpactBps += step.priceImpactBps` — still additive summation.
- useRoutes.ts was modified in phase 89-04 (BigInt quote-engine migration) but the price impact aggregation logic was not changed.
- No commits referencing H072 since 2026-03-09.

## Assessment
Accepted risk. Additive vs multiplicative compounding produces negligible difference at typical swap sizes. Most user swaps are single-hop (SOL to faction token), where the distinction is moot. Multi-hop routes (SOL -> PROFIT via vault) have a zero-impact vault leg, so compounding doesn't apply. No change from Round 2.
