# VERIFY-H036: Staking Comment
**Status:** NOT_FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

The finding is at `app/lib/staking/rewards.ts:79-82`, NOT in `programs/staking/src/` (previous rounds searched the wrong directory). The misleading comment is still present and unchanged:

```typescript
// Convert to lamports -- safe for Number since max SOL supply is ~5e17 lamports,
// well below Number.MAX_SAFE_INTEGER (2^53 - 1 = ~9e15). Even at maximum
// theoretical reward accumulation, values stay within safe range.
return Number(totalPending);
```

The comment incorrectly states that `~5e17` is "well below" `~9e15`. In fact, 5e17 is approximately 55x LARGER than 9e15. The code is practically safe (individual staking rewards never approach 9,007 SOL), but the comment is factually wrong and could mislead future developers.

Commit `807ba9e` ("stale comment fix") addressed a DIFFERENT comment issue (H035: the 75/24/1 → 71/24/5 tax split comment in `scripts/e2e/lib/swap-flow.ts`). There is also an uncommitted fix in `programs/staking/src/events.rs` changing "75% yield" to "71% yield" — also a different comment, not H036.

## Assessment

Status upgraded from CANNOT_VERIFY to NOT_FIXED. The exact location (`app/lib/staking/rewards.ts:79-82`) was confirmed from the original finding report. The misleading math comparison remains unfixed. Previous rounds could not verify because they searched `programs/staking/src/` rather than `app/lib/staking/`. Fix is straightforward: correct the comment to note that 5e17 > 9e15 but individual rewards are practically safe.
