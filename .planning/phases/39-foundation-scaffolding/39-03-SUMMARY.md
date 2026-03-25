---
phase: 39-foundation-scaffolding
plan: 03
subsystem: database
tags: [drizzle-orm, postgres, schema, indexer, ohlcv, swap-events, epoch-events, carnage-events]

# Dependency graph
requires:
  - phase: 39-01
    provides: Next.js 16 app scaffold with npm workspaces and Turbopack config
provides:
  - Drizzle ORM schema for 4 indexer tables (swap_events, candles, epoch_events, carnage_events)
  - Type-safe table definitions ready for migration generation in Phase 44
  - Query index patterns for time-range, pool-filter, user-lookup, epoch-lookup
affects: [44-deployment, 43-data-layer]

# Tech tracking
tech-stack:
  added: [drizzle-orm@0.45.1 (already installed by 39-02), drizzle-kit@0.31.9 (already installed by 39-02)]
  patterns: [pgTable schema-only definition, bigint mode:number for lamports, identity columns over serial, unique indexes for idempotency]

key-files:
  created:
    - app/db/schema.ts
  modified: []

key-decisions:
  - "bigint mode:number for all lamport/token amounts -- safe up to 2^53 which covers all practical Solana amounts"
  - "tx_signature as natural primary key for swap_events -- provides built-in idempotency for webhook re-delivery"
  - "identity columns (generatedAlwaysAsIdentity) instead of serial for auto-increment IDs -- modern PostgreSQL best practice"
  - "Schema-only definition with no DB connection -- Phase 44 provisions Postgres and generates migrations"

patterns-established:
  - "Pattern: Drizzle pgTable definitions in app/db/schema.ts as single source of truth for DB schema"
  - "Pattern: varchar for Solana public keys (64 chars), bigint mode:number for lamports/token amounts, real for prices"
  - "Pattern: Unique indexes on natural keys (epoch_number, tx_signature) for idempotent webhook processing"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 39 Plan 03: Drizzle Schema Summary

**4 Drizzle ORM table definitions for indexer data: swap_events (12-column rich swap data), candles (OHLCV with composite unique), epoch_events (tax rate snapshots), carnage_events (full execution trace)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T19:25:54Z
- **Completed:** 2026-02-15T19:28:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Defined 4 Drizzle pgTable schemas with 45 total columns across all tables
- swap_events captures rich trade data: TX signature (PK), pool, direction, SOL/token amounts, price, tax, LP fee, slippage, wallet, epoch, timestamp
- candles table supports OHLCV for all 4 pools at 6 resolutions (1m/5m/15m/1h/4h/1d) with composite unique constraint
- epoch_events captures full tax rate snapshot (all 4 rates + cheap side + staking reward + carnage balance)
- carnage_events captures complete execution trace (burns, buys, SOL before/after, path, target token)
- All tables have appropriate indexes for query patterns (11 indexes total)
- Schema compiles clean with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Drizzle ORM and create schema with all 4 indexer tables** - `baaca26` (feat)

## Files Created/Modified
- `app/db/schema.ts` - 4 Drizzle pgTable definitions (swap_events, candles, epoch_events, carnage_events) with indexes and constraints

## Decisions Made
- Used `bigint("col_name", { mode: "number" })` for all lamport and token amounts. JavaScript `number` is safe up to 2^53 (~9 quadrillion lamports = ~9M SOL), which covers all practical Solana amounts.
- Used TX signature as natural primary key for swap_events, providing built-in idempotency when Helius webhooks redeliver the same transaction.
- Used `integer().generatedAlwaysAsIdentity()` for auto-increment IDs (candles, epoch_events, carnage_events) instead of the deprecated `serial` type.
- Schema is purely declarative -- no DB connection, no runtime side effects. Phase 44 will use drizzle-kit to generate migrations from these definitions.

## Deviations from Plan

None -- plan executed exactly as written. Drizzle ORM was already installed by 39-02, so the `npm install` was a no-op.

## Issues Encountered
- Running `tsc --noEmit db/schema.ts` directly (without project tsconfig) produces errors from drizzle-orm's internal MySQL/SQLite/Gel type declarations. This is expected -- those modules reference optional peer dependencies (mysql2, gel). Using `tsc --noEmit --project tsconfig.json` succeeds because `skipLibCheck: true` is set. This is the standard approach for Drizzle ORM projects.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Schema ready for Phase 44 to generate migrations and connect to Postgres on Railway
- Schema ready for Phase 43 data layer to build queries against these table definitions
- No blockers or concerns

---
*Phase: 39-foundation-scaffolding*
*Completed: 2026-02-15*
