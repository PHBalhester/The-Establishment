---
status: verifying
trigger: "Charts on the swap page render but show no data (empty/blank). They have never worked with real data."
created: 2026-02-20T00:00:00Z
updated: 2026-02-20T02:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - TWO root causes found and fixed
test: Dry-run backfill confirms event parsing works correctly (31 swaps parsed from 20 TXs)
expecting: After webhook registration + backfill, charts will display price data
next_action: User needs to register webhook and run backfill against Railway Postgres. CHECKPOINT needed.

## Symptoms

expected: Price chart with historical swap data showing token price over time from swap events
actual: The chart component renders but shows no data points (empty/blank chart)
errors: No app-level errors in browser console. Only noise from extensions and CSP.
reproduction: Visit swap page on Railway or localhost
started: Charts have NEVER worked with real data. Built as part of Phase 44.

## Eliminated

- hypothesis: Frontend chart component broken (CandlestickChart.tsx)
  evidence: Component correctly handles empty array (setData([])), renders chart shell. Code is clean TradingView v5 API usage.
  timestamp: 2026-02-20

- hypothesis: REST API /api/candles broken
  evidence: API returns [] correctly when DB is empty. Endpoint responds 200 with valid JSON. No errors.
  timestamp: 2026-02-20

- hypothesis: SSE streaming broken
  evidence: SSE endpoint exists and is correctly wired. But SSE only delivers LIVE updates from webhook events - it cannot populate historical data.
  timestamp: 2026-02-20

- hypothesis: Database connection broken
  evidence: /api/candles endpoint successfully queries DB and returns []. DB connection works. Tables exist (migrations ran). Just no data.
  timestamp: 2026-02-20

- hypothesis: useChartData hook broken
  evidence: Hook correctly fetches from /api/candles, handles empty array response, sets loading=false. Code is clean.
  timestamp: 2026-02-20

## Evidence

- timestamp: 2026-02-20
  checked: Railway candles API (GET /api/candles?pool=CRIME_SOL&resolution=1h&limit=10)
  found: Returns empty array []. No candle data in database for any pool.
  implication: The entire data pipeline has never processed any events.

- timestamp: 2026-02-20
  checked: Railway webhook endpoint (POST /api/webhooks/helius with empty body)
  found: Returns {"error":"Unauthorized"} - HELIUS_WEBHOOK_SECRET is set in Railway env.
  implication: Webhook endpoint is live and auth-protected, but no data has been delivered to it.

- timestamp: 2026-02-20
  checked: Phase 44 USER-SETUP.md webhook registration example
  found: Uses old/placeholder accountAddresses (FV3kW..., AH7ya...) that don't match current program IDs.
  implication: Even if webhook was registered using the example, it monitored wrong accounts.

- timestamp: 2026-02-20
  checked: Anchor BorshCoder event field naming convention (debug-event-parse.ts)
  found: BorshCoder uses SNAKE_CASE field names (pool_type, input_amount, output_amount, tax_amount) and PASCALCASE enum variants (SolCrime, Buy). The event parser was reading CAMELCASE (poolType, inputAmount) which returned undefined for every field. This is a critical bug that would prevent data ingestion even if the webhook was properly configured.
  implication: The event parser has NEVER worked with real data. All parsed fields would be undefined/NaN/0.

- timestamp: 2026-02-20
  checked: Anchor BorshCoder PublicKey deserialization
  found: Pubkey fields (user, authority, triggered_by) are deserialized as objects with {_bn: BN} structure, not as strings. String() on such objects produces "[object Object]", not a base58 address.
  implication: User wallet addresses would be stored as garbage strings in swap_events table.

- timestamp: 2026-02-20
  checked: Dry-run backfill with fixed event parser
  found: Successfully parsed 31 swap events from 20 transactions. All 4 pools represented. Correct prices (e.g., CRIME/SOL ~0.17, FRAUD/SOL ~0.13). Both TaxedSwap and UntaxedSwap events parsed correctly.
  implication: Fix is correct. Event parser now works with real data.

## Resolution

root_cause: TWO root causes combined to produce empty charts:
  1. WEBHOOK NOT CONFIGURED: No Helius webhook was registered (or was registered with stale pre-Phase-51 account addresses). The Phase 44 USER-SETUP.md had placeholder addresses that don't match current program IDs. Without a webhook, no transaction data flows into the pipeline.
  2. EVENT PARSER BUG: Even if a webhook was configured, the event parser (app/lib/event-parser.ts) used camelCase field names (data.poolType, data.inputAmount) but Anchor BorshCoder returns snake_case (data.pool_type, data.input_amount). Every field would be undefined. Additionally, enum variants were PascalCase (SolCrime) but the pool lookup map expected camelCase (solCrime). And PublicKey fields were objects with _bn property, not strings.

fix: |
  1. Fixed app/lib/event-parser.ts:
     - Changed all field references from camelCase to snake_case (pool_type, input_amount, output_amount, etc.)
     - Updated enumVariant() to lowercase first char of PascalCase variants (SolCrime -> solCrime)
     - Added pubkeyToString() helper that converts {_bn: BN} objects to base58 strings
     - Applied same fixes to all three parse functions (swap, epoch, carnage)
  2. Created scripts/webhook-manage.ts: Manages Helius webhooks (list/create/update/delete) with correct current program IDs
  3. Created scripts/backfill-candles.ts: Backfills historical swap data from on-chain TX history into candles + swap_events tables
  4. Updated .planning/phases/44-helius-indexer-charts/44-01-USER-SETUP.md: Fixed stale account addresses

verification: |
  - Dry-run backfill: 31 swap events parsed from 20 TXs, correct prices and pool mappings
  - TypeScript compilation: npx tsc --noEmit --skipLibCheck passes with zero errors
  - PENDING: User needs to run backfill against Railway Postgres + register webhook for live data flow

files_changed:
  - app/lib/event-parser.ts (bug fix: snake_case fields, PascalCase enum handling, pubkey conversion)
  - scripts/webhook-manage.ts (new: Helius webhook management)
  - scripts/backfill-candles.ts (new: historical data backfill)
  - .planning/phases/44-helius-indexer-charts/44-01-USER-SETUP.md (fix: stale account addresses)
