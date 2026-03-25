---
phase: 44-helius-indexer-charts
plan: 01
subsystem: database, api
tags: [helius, webhooks, anchor, drizzle, postgres, event-parsing, indexer]

# Dependency graph
requires:
  - phase: 39-app-bootstrap
    provides: "Next.js App Router, Drizzle schema.ts, IDL sync, Anchor lib"
  - phase: 41-dashboard
    provides: "DEVNET_POOLS/DEVNET_PDAS in shared/constants.ts"
provides:
  - "Drizzle ORM client singleton (app/db/connection.ts)"
  - "Drizzle Kit migration config (app/drizzle.config.ts)"
  - "Anchor event parser for 6 event types (app/lib/event-parser.ts)"
  - "Helius webhook POST handler with idempotent storage (app/app/api/webhooks/helius/route.ts)"
  - "HELIUS_API_KEY export (shared/constants.ts)"
  - "db:generate, db:migrate, db:studio npm scripts"
affects: [44-02-candle-aggregation, 44-03-chart-frontend, future-analytics]

# Tech tracking
tech-stack:
  added: ["postgres@3.4.8 (postgres.js driver)"]
  patterns: ["globalThis singleton for DB connection across HMR", "Anchor EventParser for raw log decoding", "onConflictDoNothing for webhook idempotency"]

key-files:
  created:
    - app/db/connection.ts
    - app/drizzle.config.ts
    - app/lib/event-parser.ts
    - app/app/api/webhooks/helius/route.ts
  modified:
    - app/package.json
    - shared/constants.ts

key-decisions:
  - "Used postgres.js (not node-postgres/pg) as Drizzle driver -- no native bindings, serverless-compatible"
  - "Moved drizzle-orm from devDependencies to dependencies (runtime import in API routes)"
  - "Fresh EventParser per call (stateful parser, avoids cross-call pollution)"
  - "ExemptSwap events excluded from swap_events (Carnage-internal, would create false price data)"
  - "Per-transaction error isolation in webhook handler (one bad TX doesn't fail the batch)"
  - "Price derived from input/output ratio, direction-aware (consistent for charts)"

patterns-established:
  - "globalThis DB singleton: app/db/connection.ts pattern for surviving Next.js HMR"
  - "Anchor event BN-to-number: bnToNumber() helper for safe u64 conversion"
  - "Anchor enum variant extraction: enumVariant() for { solCrime: {} } -> 'solCrime'"
  - "Webhook idempotency: TX signature PK + onConflictDoNothing on all tables"

# Metrics
duration: 6min
completed: 2026-02-16
---

# Phase 44 Plan 01: Webhook Ingestion Summary

**Helius raw webhook receiver with Anchor event parsing for 6 event types (TaxedSwap, UntaxedSwap, ExemptSwap, EpochTransitionTriggered, TaxesUpdated, CarnageExecuted) stored idempotently in Postgres via Drizzle ORM**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-16T22:21:16Z
- **Completed:** 2026-02-16T22:27:25Z
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 2

## Accomplishments
- Drizzle ORM connected to Postgres via postgres.js with globalThis singleton for dev HMR
- Anchor event parser decodes all 6 on-chain event types from raw transaction logMessages
- Webhook POST handler at /api/webhooks/helius receives batch deliveries, parses events, stores with TX-signature idempotency
- All TypeScript files compile clean with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, create Drizzle DB connection and config** - `f53032b` (chore)
2. **Task 2: Create Anchor event parser for Tax and Epoch program events** - `fceea19` (feat)
3. **Task 3: Create Helius webhook route handler with idempotent Postgres storage** - `3f7262b` (feat)

## Files Created/Modified
- `app/db/connection.ts` - Drizzle ORM client singleton with postgres.js driver and globalThis caching
- `app/drizzle.config.ts` - Drizzle Kit migration config pointing at existing schema.ts
- `app/lib/event-parser.ts` - Anchor event parser: parseSwapEvents, parseEpochEvents, parseCarnageEvents
- `app/app/api/webhooks/helius/route.ts` - POST handler: auth check, batch processing, idempotent DB storage
- `app/package.json` - Added postgres dep, moved drizzle-orm to deps, added db:* scripts
- `shared/constants.ts` - Added HELIUS_API_KEY export

## Decisions Made
- **postgres.js over node-postgres**: No native bindings needed, works in serverless/Railway, Drizzle-recommended
- **drizzle-orm moved to dependencies**: Was in devDependencies but imported at runtime in API routes
- **Fresh EventParser per invocation**: EventParser is stateful (tracks CPI depth), reusing across calls could misparse
- **ExemptSwap excluded from storage**: Carnage-internal swaps would pollute user trade data and create false prices
- **Per-TX error isolation**: Single bad transaction in a batch won't fail the entire webhook delivery
- **Direction-aware price derivation**: Buy = input/output, Sell = output/input -- consistent "base per target" ratio

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Moved drizzle-orm from devDependencies to dependencies**
- **Found during:** Task 1 (DB connection setup)
- **Issue:** drizzle-orm was in devDependencies but connection.ts imports it at runtime. Production builds on Railway would fail.
- **Fix:** Moved drizzle-orm to dependencies in package.json
- **Files modified:** app/package.json
- **Verification:** npm ls drizzle-orm confirms production dependency
- **Committed in:** f53032b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for production correctness. No scope creep.

## User Setup Required

**External services require manual configuration.** See [44-01-USER-SETUP.md](./44-01-USER-SETUP.md) for:
- DATABASE_URL environment variable (local Postgres or Railway)
- HELIUS_WEBHOOK_SECRET for webhook authorization
- Migration generation and application steps
- Helius webhook registration after deployment

## Next Phase Readiness
- Event ingestion infrastructure complete -- webhook handler stores parsed events in Postgres
- Plan 02 (candle aggregation) can build upsertCandles() that runs on each swap event arrival
- Plan 03 (chart frontend) needs the candle data populated by Plan 02
- No blockers: all code compiles, no DB required at build time

---
*Phase: 44-helius-indexer-charts*
*Completed: 2026-02-16*
