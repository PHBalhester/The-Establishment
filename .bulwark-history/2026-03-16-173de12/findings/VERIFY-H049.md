# VERIFY-H049: Webhook No Replay Protection
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

File: `app/app/api/webhooks/helius/route.ts`

1. **MAX_TX_AGE_SECONDS constant** (line 314): Set to 300 (5 minutes).

2. **blockTime validation** (lines 333-341): For each raw transaction, if `blockTime` is present, the handler computes `age = Math.floor(Date.now() / 1000) - blockTime`. If `age > MAX_TX_AGE_SECONDS`, the transaction is skipped with a warning log that includes the signature, blockTime, and computed age.

3. **Stale transactions skipped** (line 339): `continue` bypasses the entire transaction processing pipeline (swap storage, candle upsert, epoch/carnage event storage, SSE broadcast).

4. **Defense in depth**: This timestamp check complements the existing guards:
   - **Authentication**: Constant-time `timingSafeEqual` webhook secret comparison (lines 239-254)
   - **Idempotency**: DB `onConflictDoNothing` on tx signature / epoch_number unique indexes
   - **Freshness**: blockTime age check (this fix)

5. **Null blockTime handling**: If `blockTime` is null (line 333 guard), the age check is skipped and the transaction is processed. This is acceptable -- Helius includes blockTime for confirmed transactions, and a missing blockTime would only occur for edge-case in-flight transactions where age rejection would be inappropriate.

## Assessment

The previous round identified that auth and DB idempotency were in place but timestamp validation was missing, leaving a resource-exhaustion vector from replayed webhooks. This fix closes the gap: transactions older than 5 minutes are rejected before any DB writes or SSE broadcasts occur. All three requirements (blockTime validation, MAX_TX_AGE_SECONDS constant, stale skip logic) are satisfied.
