# VERIFY-H033: Candle Aggregator Last-Write-Wins Close Price
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
No commits since 2026-03-09 modified `app/db/candle-aggregator.ts`. The upsert still uses `close: update.price` without ORDER BY timestamp verification.

## Assessment
Accepted risk. Helius webhooks deliver transactions in order in practice. Out-of-order delivery is theoretically possible but unlikely, and the impact is limited to a slightly incorrect candle close price on the chart — no financial consequence.
