---
task_id: db-phase1-database-query
provides: [database-query-findings, database-query-invariants]
focus_area: database-query
files_analyzed: [app/db/connection.ts, app/db/schema.ts, app/db/candle-aggregator.ts, app/db/migrate.ts, app/drizzle.config.ts, app/app/api/webhooks/helius/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/app/api/health/route.ts, app/lib/sse-manager.ts, scripts/backfill-candles.ts, app/hooks/useChartData.ts, app/db/migrations/0000_simple_squadron_supreme.sql]
finding_count: 11
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Database & Query Security -- Condensed Summary

## Key Findings (Top 10)

1. **Hardcoded Helius API key in source code**: Devnet API key `[REDACTED-DEVNET-HELIUS-KEY]` is hardcoded as a string literal in the backfill script, committed to git. -- `scripts/backfill-candles.ts:47`
2. **No TLS/SSL configuration on Postgres connection**: `postgres()` client created with only `connectionString` and `max` options, no `ssl` block. Railway Postgres may enforce TLS at the proxy layer, but the client does not verify certificates. -- `app/db/connection.ts:51`
3. **Database connection uses whatever privileges DATABASE_URL provides**: No principle-of-least-privilege separation between app read/write and migration admin. Same DATABASE_URL for both. -- `app/db/connection.ts:40`, `app/db/migrate.ts:42`
4. **Floating-point `real` type used for price data**: Postgres `real` (4-byte float, ~7 decimal digits) stores OHLCV prices. Price values like `0.00000001` SOL per token will lose precision. For display-only data this is low severity, but if prices are ever used for financial decisions, this becomes high. -- `app/db/schema.ts:38,66-69`
5. **Optional webhook authentication**: Helius webhook handler skips auth entirely if `HELIUS_WEBHOOK_SECRET` env var is unset. Any HTTP client can POST fabricated swap/epoch/carnage events. -- `app/app/api/webhooks/helius/route.ts:135-141`
6. **No rate limiting on public API endpoints**: `/api/candles` and `/api/carnage-events` are unauthenticated GET endpoints with no rate limiting. An attacker can exhaust the 10-connection Postgres pool via rapid requests. -- `app/app/api/candles/route.ts:185`, `app/app/api/carnage-events/route.ts:31`
7. **Connection pool limited to 10 (Railway constraint)**: Pool exhaustion risk from concurrent webhook + API + health check requests. A burst of webhook deliveries plus user API calls could saturate all 10 connections. -- `app/db/connection.ts:51`
8. **Candle upsert fires 6 parallel DB writes per swap event**: Each swap triggers `Promise.all` of 6 resolution upserts. A Helius batch webhook with 10 swaps = 60 near-simultaneous DB operations, risking pool exhaustion. -- `app/db/candle-aggregator.ts:102-129`
9. **`bigint` with `mode: "number"` risks precision loss for large lamport values**: JavaScript `number` loses precision above 2^53. Lamport values above ~9 quadrillion SOL (unlikely but possible for aggregate volumes) would silently truncate. -- `app/db/schema.ts:37-39`
10. **Error details logged to console in production**: Webhook handler, candle API, and carnage API all `console.error` full error objects which may contain connection strings or query details in stack traces. -- `app/app/api/webhooks/helius/route.ts:284`, `app/app/api/candles/route.ts:248`

## Critical Mechanisms

- **Webhook -> DB Pipeline**: Helius POST -> JSON parse -> Anchor event parse -> Drizzle insert (swap_events, epoch_events, carnage_events) -> candle upsert (6 resolutions) -> SSE broadcast. All in a single request lifecycle. Failure isolation: per-TX try/catch continues batch, candle errors don't block swap storage. -- `app/app/api/webhooks/helius/route.ts:131-290`
- **Candle Aggregation**: Atomic upsert using `onConflictDoUpdate` with SQL `GREATEST`/`LEAST` for high/low tracking. Uses Drizzle's parameterized `sql` template tag (not string interpolation). Conflict target is composite unique index `(pool, resolution, open_time)`. -- `app/db/candle-aggregator.ts:101-129`
- **Lazy DB Singleton**: Proxy-wrapped Drizzle instance defers connection creation until first property access. globalThis cache prevents HMR connection leaks. -- `app/db/connection.ts:69-79`
- **Migration Runner**: Single-connection client (`max: 1`) runs Drizzle migrations during Railway preDeployCommand. Exit code 1 halts deployment on failure. -- `app/db/migrate.ts:27-57`

## Invariants & Assumptions

- INVARIANT: Swap events are idempotent via TX signature primary key + `onConflictDoNothing` -- enforced at `app/db/schema.ts:33` and `app/app/api/webhooks/helius/route.ts:337`
- INVARIANT: One epoch event per epoch number via unique index + `onConflictDoNothing` -- enforced at `app/db/schema.ts:106` and `app/app/api/webhooks/helius/route.ts:454`
- INVARIANT: One carnage event per epoch via unique index + `onConflictDoNothing` -- enforced at `app/db/schema.ts:133` and `app/app/api/webhooks/helius/route.ts:507`
- INVARIANT: Candle resolution boundaries are deterministic (floor timestamp to bucket boundary) -- enforced at `app/db/candle-aggregator.ts:76-82`
- ASSUMPTION: DATABASE_URL provides a connection string with sufficient privileges for all operations (reads, writes, DDL via migrations) -- UNVALIDATED, no privilege separation
- ASSUMPTION: Railway Postgres enforces TLS at the proxy layer even though the client doesn't configure it -- UNVALIDATED
- ASSUMPTION: Helius webhook deliveries are authentic (when HELIUS_WEBHOOK_SECRET is unset, this assumption is violated) -- PARTIALLY ENFORCED at `app/app/api/webhooks/helius/route.ts:136`
- ASSUMPTION: Drizzle ORM parameterizes all values in `sql` template tags, preventing SQL injection -- validated by Drizzle's design; the `sql` tagged template uses parameterized queries internally

## Risk Observations (Prioritized)

1. **Webhook auth bypass when secret unset**: If `HELIUS_WEBHOOK_SECRET` is not set in production, anyone can inject arbitrary swap/epoch/carnage data into the database, corrupting price charts and historical records. `app/app/api/webhooks/helius/route.ts:135-141` -- Impact: data integrity corruption, fake price manipulation on charts.
2. **Hardcoded API key in backfill script**: `scripts/backfill-candles.ts:47` -- Even though it's a devnet key, it's committed to the repo and visible in git history forever. Establishes a pattern that could repeat with mainnet keys.
3. **Connection pool exhaustion under load**: 10-connection pool shared across webhook handler (up to 60 concurrent queries per batch), public APIs, and health checks. No query timeout configured. `app/db/connection.ts:51` -- Impact: service degradation, webhook retry storms from Helius.
4. **No TLS certificate validation on DB connection**: `app/db/connection.ts:51` -- If Railway's proxy doesn't enforce TLS, data (including connection credentials) travels in plaintext. Even with proxy TLS, the client can't verify it's talking to the real database.
5. **Public API endpoints without rate limiting or authentication**: `/api/candles` and `/api/carnage-events` are open to the internet. `app/app/api/candles/route.ts:185`, `app/app/api/carnage-events/route.ts:31` -- Impact: DoS via pool exhaustion, potential for scraping all historical data.

## Novel Attack Surface

- **Webhook data injection for chart manipulation**: If webhook auth is disabled, an attacker could POST fabricated swap events with extreme prices, causing the OHLCV candle aggregation to record fake highs/lows. Since the `GREATEST`/`LEAST` logic in `candle-aggregator.ts` is one-directional (high only goes up, low only goes down), a single injected extreme price permanently corrupts that candle's range and cannot be corrected without manual DB intervention.
- **SSE broadcast amplification**: Each injected swap event triggers SSE broadcasts to all connected chart clients across 6 resolutions. An attacker with webhook access could flood all chart UIs with fake price data in real-time via the SSE broadcast at `app/app/api/webhooks/helius/route.ts:222-234`.

## Cross-Focus Handoffs

- -> **SEC-02**: Hardcoded Helius API key in `scripts/backfill-candles.ts:47`. Investigate whether this key or similar patterns exist elsewhere. Verify DATABASE_URL is never logged.
- -> **API-04**: Webhook authentication is optional (`HELIUS_WEBHOOK_SECRET` unset = no auth). Investigate whether this is enforced in production Railway config.
- -> **ERR-01**: Error handling in webhook route logs full error objects to console. Investigate whether these logs could leak DATABASE_URL or other secrets in stack traces.
- -> **INJ-03**: Candle API accepts `pool` and `from`/`to` query parameters. While Drizzle parameterizes them, verify no SQL injection path exists through the `parseTimestamp` function or pool string.

## Trust Boundaries

The database layer trusts two primary data sources: (1) the Helius webhook, which delivers raw Solana transaction data and is the sole write path for all event tables, and (2) the DATABASE_URL environment variable, which provides full connection credentials. The webhook authentication is optional by design (skipped when env var is unset), creating a significant trust gap -- the system assumes all POST requests to the webhook endpoint contain legitimate on-chain data, but enforces this only when configured. The public REST APIs (`/api/candles`, `/api/carnage-events`) are read-only and expose non-sensitive market data, but their lack of authentication or rate limiting means an attacker can use them to exhaust the database connection pool, indirectly affecting the write path. The migration runner trusts whatever DATABASE_URL provides, running with the same privileges as the application -- there is no separation between runtime and administrative database access.
<!-- CONDENSED_SUMMARY_END -->

---

# Database & Query Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth project uses a straightforward database architecture: Postgres on Railway, accessed via Drizzle ORM with the postgres.js driver, managed through a lazy singleton pattern. The database serves as an indexer for on-chain events, storing swap events, epoch transitions, carnage events, and aggregated OHLCV candle data. Data flows in through a single Helius webhook endpoint and is read by two public REST APIs and one health check endpoint.

The architecture is fundamentally sound -- Drizzle ORM's parameterized queries prevent SQL injection, idempotency is enforced via unique constraints and `onConflictDoNothing`, and the candle aggregation logic correctly uses atomic `GREATEST`/`LEAST` SQL functions. However, there are several configuration-level security gaps: no TLS enforcement on the DB connection, optional webhook authentication, no rate limiting on public endpoints, a hardcoded API key in a script, and a connection pool that could be exhausted under concurrent load.

## Scope

All off-chain database-related code was analyzed:
- **Database layer**: `app/db/connection.ts`, `app/db/schema.ts`, `app/db/candle-aggregator.ts`, `app/db/migrate.ts`
- **Configuration**: `app/drizzle.config.ts`
- **API routes with DB access**: `app/app/api/webhooks/helius/route.ts`, `app/app/api/candles/route.ts`, `app/app/api/carnage-events/route.ts`, `app/app/api/health/route.ts`
- **Scripts**: `scripts/backfill-candles.ts`
- **Frontend data consumers**: `app/hooks/useChartData.ts`
- **Supporting infrastructure**: `app/lib/sse-manager.ts`
- **Migration SQL**: `app/db/migrations/0000_simple_squadron_supreme.sql`

On-chain programs (`programs/`) were excluded per scope rules.

## Key Mechanisms

### 1. Database Connection (`app/db/connection.ts`)

The connection is established lazily via a Proxy wrapper. Key characteristics:
- **Driver**: `postgres` (postgres.js) -- no native bindings, serverless-compatible
- **Pool size**: `max: 10` (Railway free tier constraint)
- **Singleton**: `globalThis` cache survives Next.js HMR in development
- **Lazy init**: Proxy defers `getDb()` call until first property access, allowing Next.js builds to succeed without DATABASE_URL
- **No TLS config**: `postgres(connectionString, { max: 10 })` -- no `ssl` option passed
- **No query timeout**: No `idle_timeout`, `connect_timeout`, or `max_lifetime` configured

The Proxy pattern at line 69-79 is well-implemented -- it correctly binds methods to the real db instance, preventing `this` context issues.

### 2. Schema Design (`app/db/schema.ts`)

Four tables with well-defined constraints:

| Table | PK | Unique Constraints | Indexes |
|-------|----|--------------------|---------|
| swap_events | tx_signature (natural key) | -- | pool, epoch_number, timestamp, user_wallet |
| candles | id (auto-increment) | (pool, resolution, open_time) | (pool, resolution), open_time |
| epoch_events | id (auto-increment) | epoch_number | timestamp |
| carnage_events | id (auto-increment) | epoch_number | timestamp |

**Observations:**
- TX signature as natural primary key for swap_events is excellent for idempotency
- `bigint` with `mode: "number"` used for lamport values -- this maps to JavaScript `number`, which loses precision above 2^53 (~9,007 trillion lamports = ~9M SOL). For individual swap amounts this is safe, but aggregate volume fields could theoretically overflow in high-activity scenarios
- `real` (4-byte float) used for price columns -- provides ~7 significant digits. For memecoin prices that might be 0.000000001 SOL/token, this could lose significant precision. Impact is display-only (prices aren't used for on-chain operations), so severity is LOW for now
- `varchar(4)` for direction column accommodates "buy" and "sell" exactly
- No `created_at` or `updated_at` audit columns

### 3. Candle Aggregation (`app/db/candle-aggregator.ts`)

The candle upsert logic uses Drizzle's `onConflictDoUpdate` with SQL template tags:

```typescript
set: {
  high: sql`GREATEST(${candles.high}, ${update.price})`,
  low: sql`LEAST(${candles.low}, ${update.price})`,
  close: sql`${update.price}`,
  volume: sql`${candles.volume} + ${update.volume}`,
  tradeCount: sql`${candles.tradeCount} + 1`,
},
```

**Injection analysis**: The `sql` tagged template literal from `drizzle-orm` parameterizes all interpolated values. The `candles.high`, `candles.low`, etc. references resolve to column identifiers (not user input). The `update.price` and `update.volume` values come from parsed event data (numbers), not from raw user input. This is safe from SQL injection.

**Correctness concern**: `Promise.all` fires all 6 resolution upserts in parallel. If the DB connection pool has only 10 connections, a webhook batch with multiple swaps could saturate it (10 swaps x 6 resolutions = 60 concurrent queries competing for 10 connections). postgres.js will queue excess requests, but this increases latency.

### 4. Webhook Handler (`app/app/api/webhooks/helius/route.ts`)

This is the most critical database write path. Analysis:

**Authentication (lines 132-141)**:
```typescript
const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
if (webhookSecret) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```
- Auth is completely skipped when env var is unset
- Comparison is NOT timing-safe (uses `!==`). However, since this is a webhook secret (not a cryptographic operation where timing leaks matter in the same way), and the alternative would be to just not set it, this is LOW severity
- The secret is compared directly against the full Authorization header value, not extracted from a "Bearer" prefix -- need to verify Helius sends it in the expected format

**Data flow**:
1. `req.json()` parses untrusted JSON body -- only validated as `Array.isArray`
2. Each transaction's `logMessages` are parsed by Anchor EventParser (which does schema validation via Borsh deserialization)
3. Parsed events are inserted via Drizzle ORM (parameterized)
4. Candle upserts are fire-and-forget with try/catch (candle failure doesn't block swap storage)

**Per-transaction error isolation (lines 258-267)**: Good pattern -- a malformed transaction in the batch doesn't fail the entire webhook delivery. This prevents Helius retry storms.

### 5. Candle REST API (`app/app/api/candles/route.ts`)

**Input validation**:
- `pool`: Required string, passed directly to Drizzle `eq()` (parameterized)
- `resolution`: Validated against `VALID_RESOLUTIONS` Set
- `limit`: Parsed with `parseInt`, clamped to [1, 2000]
- `from`/`to`: Parsed by `parseTimestamp()` which accepts Unix seconds or ISO strings

**`parseTimestamp` analysis (lines 171-179)**:
```typescript
function parseTimestamp(value: string): number {
  const asNum = Number(value);
  if (!isNaN(asNum)) return asNum * 1000;
  return new Date(value).getTime();
}
```
- `Number(value)` on arbitrary string input: could produce `Infinity` for "Infinity" string, or unexpected results for hex strings. The resulting Date would be invalid but wouldn't cause injection
- `new Date(value)` on arbitrary string: could produce `Invalid Date` (NaN getTime), which would make the `gte`/`lte` query condition effectively a no-op. Not a security issue but a data integrity edge case

**No authentication**: Anyone can query all candle data. This is intentional (public market data) but should be rate-limited.

### 6. Carnage Events API (`app/app/api/carnage-events/route.ts`)

Minimal endpoint: `SELECT * FROM carnage_events ORDER BY timestamp DESC LIMIT 5`. No parameters, no injection surface. Exposes all columns including `id` (though the code comment says it's excluded, the `select()` call has no column filter -- all columns are returned, then mapped to exclude `id` in the response transformation).

### 7. Backfill Script (`scripts/backfill-candles.ts`)

**Critical finding**: Hardcoded Helius devnet API key at line 47:
```typescript
const HELIUS_API_KEY = "[REDACTED-DEVNET-HELIUS-KEY]";
```
This is committed to git and visible in repository history. While it's a devnet key, this establishes a dangerous pattern.

**SQL usage**: The script uses postgres.js tagged template literals directly:
```typescript
await sql!`INSERT INTO swap_events (...) VALUES (${signature}, ${poolAddress}, ...) ON CONFLICT (tx_signature) DO NOTHING`;
```
These are parameterized via postgres.js's template tag -- safe from injection.

### 8. Migration Runner (`app/db/migrate.ts`)

Clean implementation:
- Single-connection client (`max: 1`) for sequential migration execution
- Properly closes connection in `finally` block
- Exit code 1 on failure halts Railway deployment
- Uses Drizzle's programmatic migrator (works without devDependencies)

### 9. Health Check (`app/app/api/health/route.ts`)

Executes `SELECT 1` to verify Postgres connectivity. Always returns HTTP 200 (container liveness) with body indicating degraded state. This is correct -- the health check should not fail the container for downstream issues.

## Trust Model

```
                    ┌──────────────┐
                    │ Helius Cloud │ (Webhook Source)
                    └──────┬───────┘
                           │ POST (optionally authenticated)
                    ┌──────▼───────┐
                    │   Next.js    │
                    │  API Routes  │
                    └──────┬───────┘
                           │ Drizzle ORM (parameterized queries)
                    ┌──────▼───────┐
                    │  Railway     │
                    │  Postgres    │
                    └──────────────┘
                           ▲
                    ┌──────┴───────┐
                    │  Backfill    │ (one-time script, direct postgres.js)
                    │  Script      │
                    └──────────────┘
```

**Trust boundaries**:
1. Helius -> Webhook: PARTIALLY TRUSTED (auth is optional)
2. Webhook -> DB: TRUSTED (Drizzle parameterization, schema constraints)
3. Public API -> DB: TRUSTED (read-only, parameterized)
4. Backfill -> DB: TRUSTED (parameterized, admin-run)
5. App -> Railway Postgres: ASSUMED TRUSTED (no TLS verification)

## State Analysis

### Database State
- **4 tables**: swap_events, candles, epoch_events, carnage_events
- **Write path**: Single (webhook handler + backfill script)
- **Read paths**: 3 API endpoints + health check
- **Idempotency**: All writes use `onConflictDoNothing` or composite upsert
- **No transactions**: Individual inserts/upserts, no multi-table transaction boundaries. This is acceptable because each table is independent and idempotent.

### Connection Pool State
- **Size**: 10 connections (Railway limit)
- **Singleton**: globalThis cache prevents HMR leaks
- **No monitoring**: No connection pool metrics or alerts
- **No timeouts**: No idle_timeout or connect_timeout configured

### In-Memory State
- **SSE Manager**: In-memory Set of subscriber callbacks. Not persisted. Lost on process restart. Acceptable for real-time streaming use case.

## Dependencies

| Dependency | Version | Purpose | Risk |
|-----------|---------|---------|------|
| drizzle-orm | (from package.json) | ORM, query builder, migration runner | Well-maintained, parameterized by design |
| postgres (postgres.js) | (from package.json) | Postgres driver | No native bindings, serverless-compatible |
| drizzle-kit | (devDep) | Migration generation | Dev-only, not in production |

## Focus-Specific Analysis

### SQL Injection Assessment

**All database queries were analyzed for injection vectors:**

1. **Drizzle ORM queries** (webhook handler, candle API, carnage API, health check): All use Drizzle's type-safe query builder or `sql` tagged template literals. Both mechanisms produce parameterized queries. **No injection risk.**

2. **Raw postgres.js queries** (backfill script, line 371-375): Use postgres.js tagged template literals (`sql\`...\``), which are parameterized. **No injection risk.**

3. **`sql` template in candle-aggregator.ts** (lines 121-125): Uses `sql\`GREATEST(${candles.high}, ${update.price})\``. The `candles.high` is a column reference (resolved by Drizzle to a safe identifier), and `update.price` is a number from parsed event data. **No injection risk.**

4. **Candle API `parseTimestamp`** (line 171-179): User input from query parameters flows through `Number()` or `new Date()` before being used in Drizzle `gte()`/`lte()` conditions. Drizzle parameterizes these. **No injection risk.**

**Verdict: No SQL injection vulnerabilities found.** The codebase consistently uses parameterized queries through both Drizzle ORM and postgres.js.

### Connection Security

- **No TLS**: `postgres(connectionString, { max: 10 })` at `app/db/connection.ts:51`. The DATABASE_URL connection string *may* include `?sslmode=require` but this isn't enforced in code.
- **No certificate pinning**: Even if TLS is used, no CA certificate is verified.
- **Mitigation**: Railway's internal network likely provides transport security between the Next.js process and the Postgres instance on the same Railway project. However, this is an infrastructure assumption, not a code-level guarantee.

### Data Integrity

- **Idempotency**: Well-implemented across all tables via unique constraints + `onConflictDoNothing`/`onConflictDoUpdate`. Duplicate webhook deliveries are harmless.
- **Candle correctness**: The `GREATEST`/`LEAST` approach means candle highs/lows are monotonically one-directional within a period -- a once-set high can only go higher, a once-set low can only go lower. This is correct for price tracking but means a single bad data point (from a fabricated webhook) permanently corrupts the candle.
- **No soft deletes or audit trail**: Data is never deleted or updated outside of candle upserts. No audit columns track when rows were created or modified.

### Connection Pool Exhaustion

**Worst case analysis**:
- Helius webhook delivers a batch of 10 transactions, each containing 1 swap event
- Each swap triggers 6 candle upserts via `Promise.all` = 60 concurrent queries
- Plus 10 swap_events inserts = 10 more queries
- Plus any epoch/carnage events
- Plus concurrent API requests from users
- Total: 70+ queries competing for 10 connections

postgres.js will queue excess requests, but latency spikes could cause the webhook handler to exceed Helius's timeout, triggering retries that compound the load.

## Cross-Focus Intersections

| Other Focus | Intersection Point | Concern |
|-------------|-------------------|---------|
| SEC-02 | `scripts/backfill-candles.ts:47` | Hardcoded Helius API key |
| SEC-02 | `app/db/connection.ts:40` | DATABASE_URL in env var |
| API-04 | `app/app/api/webhooks/helius/route.ts:135-141` | Optional webhook authentication |
| ERR-01 | Error logging across all API routes | Potential credential leakage in stack traces |
| INJ-03 | `app/app/api/candles/route.ts:189-193` | User-supplied query params in DB queries |
| LOGIC-01 | `app/db/schema.ts:38,66-69` | Float precision for price data |
| ERR-02 | `app/db/candle-aggregator.ts:102` | 6 parallel DB writes per event |
| DATA-04 | All `console.error` calls | Error objects may contain sensitive DB info |
| INFRA-03 | `app/db/connection.ts:51` | No TLS configuration |

## Cross-Reference Handoffs

1. **SEC-02**: Verify DATABASE_URL is never logged anywhere. Check Railway environment variable configuration for the webhook secret.
2. **API-04**: Determine if HELIUS_WEBHOOK_SECRET is set in production Railway config. Assess timing-safe comparison requirement.
3. **ERR-01**: Review all `console.error` calls for potential credential leakage in error stack traces.
4. **INFRA-03**: Verify Railway Postgres connection uses TLS at the infrastructure level. Check if DATABASE_URL includes `sslmode=require`.
5. **ERR-02**: Assess connection pool exhaustion risk under realistic webhook delivery patterns (batch sizes, frequency).

## Risk Observations

| # | Concern | Location | Severity | Impact |
|---|---------|----------|----------|--------|
| 1 | Optional webhook auth allows data injection | `route.ts:135-141` | HIGH | Fake price data, chart manipulation |
| 2 | Hardcoded API key in source | `backfill-candles.ts:47` | HIGH | Key exposure in git history |
| 3 | No TLS on DB connection | `connection.ts:51` | MEDIUM | Data-in-transit exposure |
| 4 | No rate limiting on public APIs | `candles/route.ts`, `carnage-events/route.ts` | MEDIUM | DoS via pool exhaustion |
| 5 | Connection pool exhaustion risk | `connection.ts:51`, `candle-aggregator.ts:102` | MEDIUM | Service degradation under load |
| 6 | Same DB credentials for app + migrations | `connection.ts:40`, `migrate.ts:42` | MEDIUM | No privilege separation |
| 7 | Float precision for prices | `schema.ts:38,66-69` | LOW | Display inaccuracy for small prices |
| 8 | `bigint` mode "number" precision | `schema.ts:37-39` | LOW | Theoretical overflow for extreme values |
| 9 | Non-timing-safe webhook secret comparison | `route.ts:138` | LOW | Timing side-channel (unlikely exploitable) |
| 10 | No query timeouts configured | `connection.ts:51` | LOW | Hung queries consume pool connections |
| 11 | Error objects logged to console | Multiple files | LOW | Potential info disclosure in logs |

## Novel Attack Surface Observations

1. **Permanent candle corruption via webhook injection**: The `GREATEST`/`LEAST` upsert pattern means a single injected extreme price value (e.g., price=999999999) permanently sets the candle high to that value. The only fix is manual SQL UPDATE. If webhook auth is disabled, this is trivially exploitable.

2. **SSE broadcast as amplification vector**: An attacker injecting webhook data gets free SSE broadcast to all connected chart clients. One POST to the webhook spawns broadcasts to potentially hundreds of browser tabs, each receiving 6 resolution updates per injected swap event.

3. **Gap-fill oracle for trading signals**: The gap-fill logic in `/api/candles` carries forward the last known price for periods with no trades. An attacker monitoring the gap-fill output could infer trading activity patterns (gap-filled candles = no trades, real candles = activity) to front-run low-liquidity periods.

## Questions for Other Focus Areas

1. **For SEC-02**: Is `HELIUS_WEBHOOK_SECRET` set in the production Railway environment? Is DATABASE_URL using `sslmode=require`?
2. **For INFRA-03**: Does Railway's internal networking provide TLS between the Next.js process and the Postgres instance? What are the network isolation guarantees?
3. **For ERR-01**: Are Railway logs accessible to unauthorized parties? If so, the `console.error` calls that log full error objects could leak database connection details.
4. **For API-04**: Does Helius support HMAC-based webhook verification (not just a static secret)? If so, upgrading to HMAC would be more robust.
5. **For LOGIC-01**: Are the float-precision prices in the candles table ever used for on-chain financial decisions (e.g., oracle price feeds)? If so, the `real` type is insufficient.

## Raw Notes

- The codebase has exactly one migration file (`0000_simple_squadron_supreme.sql`), indicating the schema has been stable since initial creation. No destructive migrations observed.
- `drizzle.config.ts` uses non-null assertion on `process.env.DATABASE_URL!` -- this will throw at drizzle-kit CLI time if unset, which is acceptable for a dev tool.
- The `globalForDb.pgClient` is only cached in non-production (`NODE_ENV !== "production"`) for HMR survival. In production, the client is still stored in `globalForDb.drizzleDb` (via the `getDb()` function), so the singleton pattern works correctly in both environments.
- The backfill script creates its own postgres client (not using the app's singleton), which is correct for a standalone script context.
- `useChartData.ts` is a frontend hook that fetches from `/api/candles` via `fetch()`. It properly encodes the pool parameter with `encodeURIComponent()` and handles cancelled requests via a `cancelled` flag. No direct database access from the frontend.
- The SSE manager is purely in-memory with no persistence. This is appropriate for real-time chart updates where historical data comes from the REST API.
