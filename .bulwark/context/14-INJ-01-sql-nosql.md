---
task_id: db-phase1-inj-01
provides: [inj-01-findings, inj-01-invariants]
focus_area: inj-01
files_analyzed:
  - app/db/schema.ts
  - app/db/connection.ts
  - app/db/candle-aggregator.ts
  - app/db/migrate.ts
  - app/drizzle.config.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/candles/route.ts
  - app/app/api/carnage-events/route.ts
  - app/app/api/health/route.ts
  - app/app/api/rpc/route.ts
  - app/app/api/sol-price/route.ts
  - app/lib/event-parser.ts
  - app/lib/rate-limit.ts
  - app/lib/protocol-store.ts
  - app/lib/bigint-json.ts
  - scripts/deploy/upload-metadata.ts
finding_count: 1
severity_breakdown: {critical: 0, high: 0, medium: 0, low: 1}
---
<!-- CONDENSED_SUMMARY_START -->
# SQL & NoSQL Injection (INJ-01) -- Condensed Summary

## Key Findings (Top 5)

1. **No SQL injection vectors identified in production code**: All database access uses Drizzle ORM's parameterized query builder (`.select()`, `.insert()`, `.where(eq(...))`, `.onConflictDoNothing()`). No raw SQL with user input interpolation exists. -- `app/db/*.ts`, `app/app/api/*/route.ts`

2. **No NoSQL database in the stack**: The project uses PostgreSQL exclusively via Drizzle ORM. No MongoDB/Mongoose/Redis query patterns exist. No NoSQL operator injection surface.

3. **`sql` tagged template literals in candle-aggregator use Drizzle's safe parameterization**: The `sql\`GREATEST(${candles.high}, ${update.price})\`` syntax at `app/db/candle-aggregator.ts:121-125` uses Drizzle's `sql` tag function which auto-parameterizes interpolated values. These are NOT raw template literals -- Drizzle generates `$1`, `$2` placeholders. The `update.price` values flow from parsed Anchor events (not user input) through the Helius webhook pipeline.

4. **Health endpoint `db.execute(sql\`SELECT 1\`)` is a static query**: The literal SQL at `app/app/api/health/route.ts:38` contains zero dynamic values. No injection surface.

5. **Candles API passes user query params through Drizzle ORM builder**: `app/app/api/candles/route.ts:216-237` takes user-supplied `pool`, `resolution`, `from`, `to`, and `limit` query parameters. All are passed to Drizzle's `eq()`, `gte()`, `lte()` functions which auto-parameterize. The `resolution` is validated against a `Set` allowlist (line 199). The `limit` is `parseInt`-parsed and clamped between 1-2000 (line 211-213). No injection surface.

## Critical Mechanisms

- **Drizzle ORM (postgres.js driver)**: All DB access goes through `app/db/connection.ts` which creates a `drizzle(client, { schema })` instance. Drizzle's query builder generates parameterized SQL for all operations. No `.raw()` or `.query()` calls with string interpolation exist anywhere in the codebase. -- `app/db/connection.ts:80`

- **Webhook -> DB pipeline**: Helius webhook payloads are parsed by `event-parser.ts` (Anchor BorshCoder deserialization), then stored via Drizzle `.insert().values().onConflictDoNothing()`. No user input is interpolated into queries. The full chain: Helius POST -> auth check -> JSON parse -> Anchor event decode -> typed object -> Drizzle insert. -- `app/app/api/webhooks/helius/route.ts:664-680`

- **Candle query endpoint**: User-supplied query params (`pool`, `resolution`, `from`, `to`, `limit`) flow through validation (allowlist, parseInt) then into Drizzle's builder API (`eq()`, `gte()`, `lte()`, `.limit()`). -- `app/app/api/candles/route.ts:186-237`

## Invariants & Assumptions

- INVARIANT: All SQL queries use Drizzle ORM's parameterized API (no raw SQL with string interpolation) -- enforced across `app/db/*.ts` and all API routes
- INVARIANT: `resolution` query parameter is validated against `VALID_RESOLUTIONS` Set before use in DB query -- enforced at `app/app/api/candles/route.ts:199`
- INVARIANT: Webhook payload data goes through Anchor BorshCoder deserialization before DB insertion (not passed raw) -- enforced at `app/lib/event-parser.ts:244-301`
- ASSUMPTION: Drizzle ORM's `sql` tagged template function correctly parameterizes all interpolated values -- validated by Drizzle ORM library internals (widely audited, production-grade)
- ASSUMPTION: `postgres.js` driver implements parameterized queries correctly at the protocol level -- validated by postgres.js library (industry standard)
- ASSUMPTION: No future code paths will introduce raw SQL queries bypassing the Drizzle ORM layer -- NOT enforced (no lint rule or architectural constraint prevents it)

## Risk Observations (Prioritized)

1. **LOW -- No architectural guard against future raw SQL**: While all current code uses Drizzle's safe API, nothing prevents a future developer from importing `postgres` directly and writing `client.query(\`SELECT * FROM ... WHERE id = '${userInput}'\`)`. A lint rule or code review policy forbidding direct `postgres()` client usage outside `db/connection.ts` would add defense-in-depth. -- `app/db/connection.ts`

## Novel Attack Surface

- **Webhook payload as indirect SQL input vector (second-order injection)**: The Helius webhook delivers transaction data (signatures, wallet addresses, event fields) that gets stored in Postgres. If these values contained SQL-like payloads, they would be harmlessly stored as data (parameterized inserts). However, if any FUTURE code path reads these values and uses them in raw SQL construction (e.g., a reporting dashboard with string interpolation), stored payloads could become second-order injection vectors. Currently mitigated: all reads also use Drizzle's parameterized API. Note as defense-in-depth observation.

## Cross-Focus Handoffs

- -> **DATA-01 (Data Persistence)**: The webhook pipeline stores data in 3 tables (swap_events, epoch_events, carnage_events) and upserts candles in a 4th. DATA-01 should verify schema constraints, data integrity, and idempotency guarantees.
- -> **API-04 (Webhooks)**: The Helius webhook is the sole write path to the database. API-04 should verify authentication (timingSafeEqual), replay protection (H049), and body size limits (H050) are intact.
- -> **ERR-02 (Error Handling)**: Database errors in the webhook handler are caught per-transaction (inner try/catch) to prevent one bad TX from blocking the batch. ERR-02 should verify error isolation is complete.

## Trust Boundaries

The database trust model has two clear zones. **Untrusted zone**: Browser clients supply query parameters to `/api/candles` (pool, resolution, from, to, limit) and JSON-RPC method names to `/api/rpc`. These are validated before any DB interaction. **Trusted zone**: The Helius webhook (authenticated via timingSafeEqual on HELIUS_WEBHOOK_SECRET) is the sole write path to all 4 tables. Data written to the DB comes from Anchor-decoded on-chain events, not directly from user input. All reads and writes use Drizzle ORM's parameterized query builder, establishing a consistent parameterization boundary between application code and the database.
<!-- CONDENSED_SUMMARY_END -->

---

# SQL & NoSQL Injection (INJ-01) -- Full Analysis

## Executive Summary

This codebase has **no SQL injection or NoSQL injection vulnerabilities**. The project uses PostgreSQL exclusively via Drizzle ORM with the postgres.js driver. Every database query uses Drizzle's type-safe query builder API, which auto-parameterizes all values. There are no raw SQL queries with string interpolation, no ORM `.raw()` calls, and no NoSQL databases in the stack.

The single finding is LOW severity: an architectural defense-in-depth recommendation to add a lint rule preventing direct database client usage outside the connection module.

## Scope

**In scope (analyzed):**
- All database-related code: schema, connection, aggregator, migrations, config
- All API routes that interact with the database: webhooks/helius, candles, carnage-events, health
- All API routes that accept user input: rpc proxy, sol-price, candles, webhooks
- Data pipeline from webhook ingestion through event parsing to DB storage
- Deploy scripts that interact with data: upload-metadata.ts

**Out of scope:**
- Anchor/Rust on-chain programs (programs/ directory)
- Frontend components that don't interact with databases

## Key Mechanisms

### 1. Database Layer Architecture

The database layer is cleanly separated into 4 files in `app/db/`:

**Schema (`app/db/schema.ts`):**
- 4 tables: `swap_events`, `candles`, `epoch_events`, `carnage_events`
- All defined using Drizzle's `pgTable()` function with explicit column types
- Primary keys: `swap_events` uses TX signature (natural key); others use auto-increment
- Unique indexes enforce idempotency: `candle_unique_idx(pool, resolution, openTime)`, `epoch_number_idx(epochNumber)`, `carnage_epoch_idx(epochNumber)`

**Connection (`app/db/connection.ts`):**
- Singleton Drizzle instance via `globalThis` pattern (survives Next.js HMR)
- Lazy initialization via Proxy -- connection only established on first query
- `DATABASE_URL` validated at runtime with clear error message
- TLS enforced in production (`ssl: "require"`)
- Connection pool capped at 10 (Railway free tier limit)

**Candle Aggregator (`app/db/candle-aggregator.ts`):**
- Upserts candles at 6 resolutions per swap event
- Uses `db.insert(candles).values({...}).onConflictDoUpdate({ target: [...], set: { ... sql\`GREATEST(...)\` ... } })`
- The `sql` tagged template is Drizzle's parameterization wrapper, NOT a raw SQL template literal

**Migrations (`app/db/migrate.ts`):**
- Uses Drizzle's programmatic migrator
- Single-connection client (`max: 1`)
- Migration files are pre-generated SQL, not dynamic

### 2. Webhook -> Database Pipeline

The Helius webhook handler (`app/app/api/webhooks/helius/route.ts`, 851 LOC) is the **sole write path** to the database. The pipeline is:

```
Helius POST -> Rate limit check -> Auth (timingSafeEqual) -> Body size check (1MB) ->
JSON parse -> Array validation -> Payload type detection ->
  Raw TX path: for each TX -> extract signature, logs -> parseSwapEvents()/
    parseEpochEvents()/parseCarnageEvents() -> typed objects -> Drizzle insert
  Enhanced path: for each account change -> lookup in KNOWN_PROTOCOL_ACCOUNTS ->
    Anchor decode -> in-memory store (no DB write)
```

**Key security properties of this pipeline:**

1. **No user input reaches SQL**: The data that gets inserted comes from Anchor event parsing (`event-parser.ts`), which BorshCoder-deserializes binary data from on-chain program logs. The parsed values are typed (number, string) and passed through Drizzle's parameterized API.

2. **Idempotency via conflict handling**: All insert operations use `.onConflictDoNothing()` (swap_events, epoch_events, carnage_events) or `.onConflictDoUpdate()` (candles). This prevents duplicate entries and makes the pipeline replay-safe.

3. **Per-transaction error isolation**: Each transaction in the webhook batch is processed in its own try/catch. One bad transaction doesn't prevent processing of others.

### 3. Candle Query Endpoint

`app/app/api/candles/route.ts` is the primary **read path** where user input reaches the database:

```typescript
// Line 190-193: User input from URL query params
const pool = searchParams.get("pool");           // string, used in eq()
const resolution = searchParams.get("resolution"); // validated against Set
const fromParam = searchParams.get("from");       // parsed to Date, used in gte()
const toParam = searchParams.get("to");           // parsed to Date, used in lte()
const limitStr = searchParams.get("limit");       // parseInt + clamp 1-2000

// Line 199: Resolution allowlist validation
if (!pool || !resolution || !VALID_RESOLUTIONS.has(resolution)) { return 400; }

// Lines 216-237: Drizzle query builder (all parameterized)
const conditions = [eq(candles.pool, pool), eq(candles.resolution, resolution)];
if (fromParam) conditions.push(gte(candles.openTime, fromDate));
if (toParam) conditions.push(lte(candles.openTime, toDate));
const rows = await db.select().from(candles).where(and(...conditions)).orderBy(...).limit(limit);
```

**Analysis:**
- `pool` is an arbitrary string but passed to `eq()` which parameterizes it
- `resolution` is validated against a 6-element Set before use
- `from`/`to` are parsed via `parseTimestamp()` (Number() or Date()) and wrapped in `gte()`/`lte()`
- `limit` is `parseInt()`-parsed and `Math.min(Math.max(...))` clamped
- All conditions use Drizzle builder functions that auto-parameterize

### 4. Other API Routes

**Carnage Events (`app/app/api/carnage-events/route.ts`):**
- No user input at all -- always returns last 5 events
- Uses `db.select().from(carnageEvents).orderBy(desc(...)).limit(5)`
- Zero injection surface

**Health (`app/app/api/health/route.ts`):**
- Static query: `db.execute(sql\`SELECT 1\`)`
- No dynamic values, no user input
- Zero injection surface

**RPC Proxy (`app/app/api/rpc/route.ts`):**
- No database interaction at all
- Forwards JSON-RPC to Helius RPC endpoint
- Method allowlist validation
- Zero database injection surface

**SOL Price (`app/app/api/sol-price/route.ts`):**
- No database interaction at all
- Fetches from CoinGecko/Binance, caches in memory
- Zero database injection surface

## Trust Model

```
+-------------------+     +------------------+     +------------------+
| Browser (untrusted|---->| API Routes       |---->| Drizzle ORM      |---->  PostgreSQL
|  pool, resolution,|     | (validation +    |     | (parameterized   |
|  from, to, limit) |     |  builder API)    |     |  queries)        |
+-------------------+     +------------------+     +------------------+

+-------------------+     +------------------+     +------------------+
| Helius (semi-     |---->| Webhook Handler  |---->| Drizzle ORM      |---->  PostgreSQL
|  trusted, authed) |     | (auth + Anchor   |     | (parameterized   |
|                   |     |  event decode)   |     |  inserts)        |
+-------------------+     +------------------+     +------------------+
```

**Trust boundaries:**
1. Browser -> API Routes: Untrusted. User can supply arbitrary strings.
2. API Routes -> Drizzle: Trusted boundary. All values go through ORM parameterization.
3. Helius -> Webhook: Semi-trusted (authenticated via shared secret). Data still goes through Anchor deserialization before DB insertion.
4. Drizzle -> PostgreSQL: Trusted. Parameterized queries prevent injection.

## State Analysis

### Database Tables
| Table | Write Path | Read Path | Injection Risk |
|-------|-----------|-----------|---------------|
| swap_events | Webhook (Anchor events) | None exposed via API | None |
| candles | Webhook (via aggregator) | /api/candles (user params) | None (Drizzle eq/gte/lte) |
| epoch_events | Webhook (Anchor events) | None exposed via API | None |
| carnage_events | Webhook (Anchor events) | /api/carnage-events (no params) | None |

### In-Memory State
| Store | Write Path | Read Path | Injection Risk |
|-------|-----------|-----------|---------------|
| protocol-store | Webhook (enhanced accounts) | SSE broadcast | None (no DB queries) |
| rate-limit entries | Request IP | Rate check | None (no DB queries) |
| credit-counter | RPC method calls | Health endpoint | None (no DB queries) |

## Dependencies

- **drizzle-orm** (v0.39.x): Primary ORM. Generates parameterized SQL.
- **postgres** (postgres.js): Database driver. Implements wire-level parameterization.
- **drizzle-kit**: Dev-time migration tool. Not in production bundle.

No MongoDB, Mongoose, Redis, or other NoSQL dependencies present.

## Focus-Specific Analysis

### SQL Injection Vectors -- Exhaustive Search

I searched the entire codebase for:
1. `\`SELECT|INSERT|UPDATE|DELETE.*\$\{` -- Raw SQL template literals with interpolation: **None found** (except Drizzle's `sql` tag in candle-aggregator, which is safe)
2. `.query(` with string arguments -- Direct query execution: **None found**
3. `.raw(` -- ORM raw query bypass: **None found**
4. `db.execute(` -- Direct SQL execution: **1 instance** (`SELECT 1` in health check, static)
5. `sql\`` with `${` -- Drizzle tagged templates: **5 instances** in candle-aggregator (all safe -- `${candles.high}` references column objects, `${update.price}` is parameterized)
6. MongoDB/Mongoose/NoSQL operators ($gt, $regex, $where, findOne): **None found**
7. `eval()` / `new Function()`: **None found** in app code
8. `new RegExp()` with user input: **None found** in app code (deploy scripts use it with hardcoded keys only)

### Drizzle sql Tag Template Safety Verification

The 5 `sql\`...\`` usages in `app/db/candle-aggregator.ts:121-125`:

```typescript
high: sql`GREATEST(${candles.high}, ${update.price})`,
low: sql`LEAST(${candles.low}, ${update.price})`,
close: sql`${update.price}`,
volume: sql`${candles.volume} + ${update.volume}`,
tradeCount: sql`${candles.tradeCount} + 1`,
```

Drizzle's `sql` tag function does NOT produce raw SQL via string interpolation. Instead:
- `${candles.high}` -> resolves to the column reference (`"candles"."high"`)
- `${update.price}` -> becomes a parameterized placeholder (`$1`)
- The generated SQL is: `GREATEST("candles"."high", $1)` with `update.price` as a bind parameter

This is the documented safe pattern for Drizzle ORM. See: FP-007 in the common false positives guide.

### Second-Order Injection Analysis

Data stored in the database includes:
- `tx_signature` (Solana TX signature, base58): Could contain arbitrary characters if webhook is compromised
- `pool` (PDA address, base58): Comes from hardcoded `POOL_TYPE_TO_ADDRESS` map, not user input
- `user_wallet` (wallet address, base58): From Anchor event data
- `cheap_side` ("crime" or "fraud"): Derived from integer (0 or 1), not user input

All reads from the database also use Drizzle's parameterized API. Even if malicious data were stored, it would be safely handled on retrieval. No second-order injection path exists in the current code.

### Upload-Metadata Script Analysis

`scripts/deploy/upload-metadata.ts` was tagged with INJ-01 in the index. Analysis:
- Reads a keypair JSON file from a CLI-specified path (line 125): File path is validated with `fs.existsSync()`, not used in SQL
- Uses `new RegExp(\`^${key}=.*$\`, "m")` at line 240: The `key` variable comes from a hardcoded object (`CRIME_METADATA_URI`, `FRAUD_METADATA_URI`, `PROFIT_METADATA_URI`), not user input
- Writes to `deployments/{cluster}.json` and `.env.{cluster}`: `cluster` is validated against `["devnet", "mainnet"]` allowlist (line 78)
- No database interaction whatsoever
- **Verdict: No injection vectors**

## Cross-Focus Intersections

### INJ-01 x DATA-01 (Data Persistence)
The database schema and query patterns are the intersection. DATA-01 should verify:
- Schema constraints match business logic (e.g., varchar(128) for TX signatures)
- Idempotency guarantees (onConflictDoNothing) work correctly under concurrent webhook deliveries
- Data types match Anchor event field ranges (bigint mode:"number" could overflow for values > 2^53)

### INJ-01 x API-04 (Webhooks)
The webhook is the sole write path. API-04 should verify:
- Authentication is enforced (timingSafeEqual)
- Body size limit (1MB) prevents resource exhaustion
- Replay protection (5-minute blockTime check) is intact
- Rate limiting (120/min per IP) is enforced

### INJ-01 x ERR-02 (Error Handling)
Database errors should not leak schema information. The webhook handler catches per-TX errors and logs them server-side, returning only `{ error: "Internal server error" }` to clients. The candles API does the same (line 250-254).

## Cross-Reference Handoffs

- -> **DATA-01**: Verify bigint mode:"number" safety for all schema columns. Several columns use `bigint({ mode: "number" })` which converts to JavaScript number (precision loss > 2^53). Most values (lamports, base units) are safe, but need to verify no edge cases.
- -> **API-04**: Re-verify H001 (webhook auth), H049 (replay protection), H050 (body size limit) in the modified webhook route.
- -> **ERR-02**: Verify database error messages are not leaked to clients in any API route.
- -> **LOGIC-01**: The candle aggregator's price derivation logic (`derivePrice()` in webhook route) should be verified for correctness, as incorrect prices stored in DB could mislead users.

## Risk Observations

### LOW: No Architectural Guard Against Future Raw SQL

**Location:** `app/db/connection.ts`
**Observation:** The `postgres` client is exposed via `globalThis.pgClient` (line 77). While currently only accessed through the Drizzle wrapper, a future developer could import the raw client and write non-parameterized queries. No ESLint rule, no TypeScript module boundary, and no code review checklist prevents this.
**Recommendation:** Add an ESLint rule or team convention that all database queries must go through `db` from `@/db/connection` and never import `postgres` directly. Consider not exposing `pgClient` on globalThis (only expose `drizzleDb`).
**Impact:** Informational / defense-in-depth. Current code is safe.

## Novel Attack Surface Observations

### Webhook-Originated Data as Stored Payloads

The Helius webhook stores user wallet addresses (`swap.user`), TX signatures, pool types, and numeric event data in PostgreSQL. While all current queries parameterize these values on read, the data originates from on-chain events where any Solana user can generate swaps. If a future feature reads these values and uses them in a non-parameterized context (e.g., dynamic SQL for a reporting dashboard, string concatenation in log queries), the stored data becomes a second-order injection vector.

This is not currently exploitable but is a unique characteristic of this codebase's trust model: the database is populated by on-chain events from any public Solana user, making it a semi-untrusted data store from an injection perspective.

### BigInt JSON Reviver as Deserialization Surface

`app/lib/bigint-json.ts` implements a custom JSON reviver that converts `{ __bigint: "value" }` objects to `BigInt(value.__bigint)`. This runs on SSE data received from the server. While `BigInt()` with a string argument is safe (it parses numeric strings only, throwing on non-numeric input), the pattern of custom deserializers is worth monitoring. If additional tagged types are added (e.g., `{ __date: "..." }`, `{ __regex: "..." }`), each would need security review.

## Questions for Other Focus Areas

1. **DATA-01**: Is the `bigint({ mode: "number" })` column type safe for all realistic values? What happens if a Carnage event burns > 2^53 base units?
2. **API-04**: Does the 5-minute staleness check (H049) in the webhook handler correctly handle timezone/clock skew between Helius infrastructure and Railway?
3. **ERR-02**: If the Postgres connection fails during a webhook batch, does the outer catch at line 499 correctly return 500 so Helius retries?
4. **LOGIC-01**: The `parseTimestamp()` function in the candles API (line 172-180) accepts both Unix seconds and ISO strings. Could a crafted timestamp value cause unexpected Date behavior (e.g., `new Date("constructor")` returns Invalid Date)?

## Raw Notes

### Files with zero injection surface (verified, no further analysis needed):
- `app/app/api/carnage-events/route.ts` -- No user input, static query
- `app/app/api/health/route.ts` -- Static `SELECT 1`
- `app/app/api/rpc/route.ts` -- No database interaction
- `app/app/api/sol-price/route.ts` -- No database interaction
- `app/db/migrate.ts` -- Pre-generated migration files
- `app/drizzle.config.ts` -- Build-time config

### Grep search summary:
- `eval(` in app/: 0 matches
- `new Function(` in app/: 0 matches
- `new RegExp(` in app/: 0 matches
- `.raw(` in app/: 0 matches
- `.query(` with string arg in app/: 0 matches
- `mongo|mongodb|mongoose` in project: 0 matches
- SQL template literal injection pattern: 0 matches (Drizzle sql tag is safe)
- `db.execute(` with dynamic content: 0 matches (only static `SELECT 1`)
