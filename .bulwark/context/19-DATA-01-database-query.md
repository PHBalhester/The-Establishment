---
task_id: db-phase1-DATA-01
provides: [DATA-01-findings, DATA-01-invariants]
focus_area: DATA-01
files_analyzed:
  - app/db/connection.ts
  - app/db/schema.ts
  - app/db/candle-aggregator.ts
  - app/db/migrate.ts
  - app/drizzle.config.ts
  - app/lib/protocol-store.ts
  - app/lib/bigint-json.ts
  - app/lib/protocol-config.ts
  - app/lib/ws-subscriber.ts
  - app/lib/sse-manager.ts
  - app/lib/sse-connections.ts
  - app/lib/credit-counter.ts
  - app/lib/rate-limit.ts
  - app/lib/connection.ts
  - app/lib/anchor.ts
  - app/lib/event-parser.ts
  - app/lib/staking/rewards.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/candles/route.ts
  - app/app/api/carnage-events/route.ts
  - app/app/api/health/route.ts
  - app/app/api/sse/protocol/route.ts
  - app/app/api/sse/candles/route.ts
  - app/hooks/useProtocolState.ts
  - app/hooks/usePoolPrices.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 5, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# DATA-01: Database & Query Security — Condensed Summary

## Key Findings (Top 10)

1. **In-memory protocol store has no size bounds**: Unbounded Map growth if attacker sends account changes for many pubkeys — `app/lib/protocol-store.ts:37-38`
2. **DB TLS only in production mode**: Non-production environments connecting to remote databases transmit credentials in plaintext; Railway preview/staging environments may run with NODE_ENV !== "production" — `app/db/connection.ts:51-52`
3. **bigint mode: "number" truncates u64 values above 2^53**: Schema uses `bigint("sol_amount", { mode: "number" })` which silently truncates values exceeding Number.MAX_SAFE_INTEGER — `app/db/schema.ts:38-39`
4. **Migration script does not enforce TLS**: `app/db/migrate.ts:42` creates a postgres client without any SSL configuration, sending credentials in plaintext even in production
5. **Candle API accepts arbitrary pool address strings without validation**: The `pool` query parameter is passed directly to Drizzle WHERE clause — safe due to parameterization, but no validation that it is a real pool address (allows scanning for non-existent pools) — `app/app/api/candles/route.ts:190-206`
6. **Health endpoint exposes internal state publicly**: wsSubscriber status, credit counter stats, and dependency check details returned to any caller without authentication — `app/app/api/health/route.ts:63-72`
7. **SSE initial-state snapshot broadcasts ALL protocol store data**: New SSE clients receive all cached account states including any data from decode errors with raw account data and error messages — `app/app/api/sse/protocol/route.ts:71-75`
8. **Webhook handler stores decode errors with raw account data in protocol store**: Failed Anchor decodes store rawAccountData and error messages that are then broadcast to all SSE clients — `app/app/api/webhooks/helius/route.ts:607-619`
9. **anchorToJson shallow conversion misses nested objects**: Only iterates top-level keys; nested BN/PublicKey objects pass through unconverted and may break JSON serialization or leak internal structure — `app/lib/bigint-json.ts:102-116`
10. **Connection pool max=10 with no idle timeout configuration**: Pool exhaustion possible if connections leak; no explicit idle_timeout, connect_timeout, or max_lifetime set — `app/db/connection.ts:56-57`

## Critical Mechanisms

- **Postgres via Drizzle ORM**: All SQL is ORM-generated parameterized queries. No raw SQL string construction from user input. Single write path: webhook handler -> Drizzle insert. Two read paths: candle API + carnage API -> Drizzle select. Health check: `db.execute(sql\`SELECT 1\`)`. — `app/db/connection.ts`, `app/db/schema.ts`
- **In-Memory Protocol Store**: globalThis singleton Map<string, AccountState>. Written by webhook handler (Anchor-decoded account changes) and ws-subscriber (batch seed + polls). Read by SSE endpoint (full snapshot + streaming). Dedup via JSON serialization comparison. No TTL, no eviction, no size cap. — `app/lib/protocol-store.ts:36-108`
- **BigInt JSON Round-Trip**: Custom replacer/reviver using `{__bigint: "value"}` tag format. Applied in protocol-store (server serialize), SSE broadcast (wire format), useProtocolState (client deserialize). — `app/lib/bigint-json.ts:35-51`
- **Candle Aggregation**: Atomic upsert via Drizzle `onConflictDoUpdate` with SQL `GREATEST/LEAST` for high/low. 6 parallel upserts per swap event (one per resolution). Idempotent via composite unique index (pool, resolution, open_time). — `app/db/candle-aggregator.ts:101-129`
- **Webhook -> DB Pipeline**: Helius webhook delivers raw TXs -> event-parser extracts Anchor events -> webhook handler stores in 3 tables (swap_events, epoch_events, carnage_events) with onConflictDoNothing. All inserts use ORM parameterized queries. — `app/app/api/webhooks/helius/route.ts:255-508`

## Invariants & Assumptions

- INVARIANT: All Postgres queries use Drizzle ORM parameterized queries (no string interpolation in SQL) — enforced by using only `db.insert().values()`, `db.select().where()`, and `sql\`\`` tagged templates throughout codebase
- INVARIANT: swap_events deduplicated on TX signature (primary key) — enforced at `app/db/schema.ts:33` via `.primaryKey()` + `app/app/api/webhooks/helius/route.ts:680` via `.onConflictDoNothing()`
- INVARIANT: epoch_events and carnage_events deduplicated on epoch_number — enforced at `app/db/schema.ts:106,133` via `uniqueIndex` + webhook handler `onConflictDoNothing`
- INVARIANT: candle data idempotent under replay — enforced at `app/db/schema.ts:74` via composite unique index + `app/db/candle-aggregator.ts:118-127` via `onConflictDoUpdate` with GREATEST/LEAST
- INVARIANT: DATABASE_URL must be set at runtime — enforced at `app/db/connection.ts:41-46` via throw on missing
- ASSUMPTION: `bigint("sol_amount", { mode: "number" })` values will not exceed 2^53 — UNVALIDATED. Token amounts for 1B supply at 6 decimals = 1e15, within safe range. SOL amounts in lamports for protocol-scale trades also within range. But future scale could violate this. No runtime guard exists.
- ASSUMPTION: Railway Postgres enforces TLS when `ssl: "require"` is set — UNVALIDATED at application level. The app trusts the driver/server negotiation.
- ASSUMPTION: In-memory protocol store data is transient and reconstructable from on-chain state — validated by ws-subscriber batch seed on restart
- ASSUMPTION: Single-process deployment (Railway) means in-memory state is consistent — documented at `app/lib/protocol-store.ts:17`, `app/lib/sse-manager.ts:8-9`

## Risk Observations (Prioritized)

1. **Migration script TLS gap (MEDIUM)**: `app/db/migrate.ts:42` — The migration runner creates a raw postgres client without TLS configuration. In production Railway, migrations run as preDeployCommand. If DATABASE_URL does not include `?sslmode=require` in the URL itself, credentials transmit in plaintext. The main app's `connection.ts` adds TLS but migrate.ts bypasses it.

2. **Protocol store unbounded growth (MEDIUM)**: `app/lib/protocol-store.ts:37-38` — The accounts Map has no maximum size. A webhook attacker who passes auth could send account changes for thousands of synthetic pubkeys, growing server memory. Mitigated by: webhook auth (timingSafeEqual), rate limiting (120/min). But if auth is compromised, this becomes a DoS vector.

3. **Schema bigint mode: "number" precision ceiling (MEDIUM)**: `app/db/schema.ts:37-39` — All monetary columns use `mode: "number"` which maps bigint DB columns to JavaScript Number. Individual trade amounts are within safe range today (max ~1e15 for 1B token supply at 6 decimals), but aggregate columns like `volume` accumulate. A pool with 1B+ lamport cumulative volume would silently truncate.

4. **Decode errors broadcast to SSE clients (MEDIUM)**: `app/app/api/webhooks/helius/route.ts:613-619` — When Anchor decode fails, the webhook stores rawAccountData (base64 bytes) and the error message string in the protocol store. This is then broadcast to all SSE clients and included in initial-state snapshots. Error messages could reveal internal program structure.

5. **Health endpoint information disclosure (LOW, RECHECK H028)**: `app/app/api/health/route.ts:63-72` — Returns wsSubscriber status (initialized, connected, latestSlot, fallbackActive), credit counter stats (totalCalls, methodCounts, startedAt), and dependency check details. No authentication required. Provides operational intelligence to attackers.

6. **No connection pool health checks or timeouts (LOW)**: `app/db/connection.ts:56-57` — `postgres(connectionString, { max: 10 })` has no idle_timeout, connect_timeout, or statement_timeout. Stalled queries could hold connections indefinitely.

7. **Candle API limit cap at 2000 with no pagination (LOW)**: `app/app/api/candles/route.ts:210-213` — Max 2000 candles per request with gap-fill enabled. Gap-fill loops from rangeStart to rangeEnd which could be long for small resolutions over large time ranges. No cursor-based pagination.

8. **globalThis singleton assignment pattern inconsistency (LOW)**: `app/db/connection.ts:76-78` — pgClient is only cached in globalThis when `NODE_ENV !== "production"`, but drizzleDb is always cached. This means production creates a new pgClient on each getDb() call if the drizzleDb cache is somehow invalidated, potentially leaking connections.

9. **SSE candles route broadcasts ALL event types (LOW)**: `app/app/api/sse/candles/route.ts:71-78` — The candle SSE subscriber receives all SSE events (candle-update AND protocol-update) without filtering. Only the protocol SSE route filters by event prefix. Extra bandwidth waste but no data leak since protocol updates are already public.

## Novel Attack Surface

- **BigInt tag collision**: The `{__bigint: "value"}` tag format used for BigInt serialization could be exploited if an Anchor account happened to contain a field named `__bigint` with a string value. The reviver would convert it to a BigInt, potentially causing type errors in downstream consumers. While unlikely with current program schemas, this is a data integrity concern for any future account type.
- **Candle gap-fill memory amplification**: A malicious client requesting `?resolution=1m&from=0&to=9999999999&gapfill=true` could force the server to generate millions of synthetic candle entries in memory before the limit cap applies. The gap-fill loop runs before any response size limiting. The limit param caps DB rows but not gap-filled output rows.

## Cross-Focus Handoffs

- → **SEC-02 (Secrets)**: Verify that DATABASE_URL in Railway environment uses TLS-enforcing connection string. Verify migrate.ts inherits TLS from URL or needs explicit config.
- → **ERR-01 (Error Handling)**: Investigate whether Anchor decode failures in webhook handler (line 607-619) with raw error messages could reveal sensitive program internals to SSE clients.
- → **INFRA-03 (Infrastructure)**: Verify Railway Postgres TLS enforcement. Verify single-process assumption for in-memory stores (protocol-store, sse-manager, rate-limit). If Railway ever scales to multi-process, all in-memory state breaks.
- → **DATA-04 (Logging)**: Health endpoint exposes credit counter stats and ws-subscriber internal state without auth. Cross-reference with H028 finding.
- → **CHAIN-02 (Account State)**: anchorToJson does shallow-only conversion. Verify no Anchor account types have nested BN/PublicKey fields that would survive unconverted.

## Trust Boundaries

The data layer has three trust boundaries: (1) **Helius webhook -> Postgres**: External data source (Helius) writes to the database through an authenticated webhook endpoint. Authentication uses timingSafeEqual on a shared secret. The webhook is the sole write path for swap/epoch/carnage data. All writes use parameterized ORM queries, preventing SQL injection. (2) **RPC -> Protocol Store**: The ws-subscriber and webhook handler write to an in-memory store using data decoded from on-chain accounts via Anchor. The trust here is in the Solana RPC node and Helius delivering authentic account data. No cryptographic verification of account data integrity is performed at the application level (trusted RPC assumption). (3) **Protocol Store -> SSE Clients**: All cached protocol data is broadcast to any connected SSE client. There is no per-user data segregation (all data is protocol-wide, not user-specific). The SSE connection is capped by IP but not authenticated — any browser can subscribe.
<!-- CONDENSED_SUMMARY_END -->

---

# DATA-01: Database & Query Security — Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain data layer is architecturally sound for its current deployment model (single Railway process, display-only data, no user PII). The codebase uses Drizzle ORM consistently, eliminating SQL injection risk. All database writes flow through a single authenticated webhook endpoint with parameterized queries and idempotency guards. The in-memory protocol store provides an efficient caching layer for real-time SSE streaming.

The primary concerns are:
1. A TLS gap in the migration script that could expose DATABASE_URL credentials
2. Unbounded in-memory growth potential in the protocol store
3. Schema precision limitations that could manifest at scale
4. Information disclosure through the health endpoint and error broadcast patterns

No critical vulnerabilities were identified. The data layer does not store user PII, passwords, or private keys — it exclusively stores protocol event data (swap trades, epoch transitions, candle prices) and caches on-chain account state.

## Scope

**In scope**: All off-chain code related to data persistence, caching, querying, and data pipeline integrity.

**Files analyzed (25)**:
- Database layer: `app/db/connection.ts`, `schema.ts`, `candle-aggregator.ts`, `migrate.ts`, `drizzle.config.ts`
- In-memory stores: `app/lib/protocol-store.ts`, `credit-counter.ts`, `rate-limit.ts`
- Data pipeline: `app/lib/ws-subscriber.ts`, `sse-manager.ts`, `sse-connections.ts`, `bigint-json.ts`
- Configuration: `app/lib/protocol-config.ts`, `connection.ts`, `anchor.ts`
- API routes: `webhooks/helius/route.ts`, `candles/route.ts`, `carnage-events/route.ts`, `health/route.ts`, `sse/protocol/route.ts`, `sse/candles/route.ts`
- Consumers: `useProtocolState.ts`, `usePoolPrices.ts`
- Data processing: `event-parser.ts`, `staking/rewards.ts`

**Out of scope**: Anchor/Rust programs in `programs/` directory, frontend-only UI components.

## Key Mechanisms

### 1. Database Connection (`app/db/connection.ts`)

The Postgres connection uses a Proxy-based lazy singleton pattern:
- Connection is deferred until first query (not at import time), allowing Next.js builds to succeed without DATABASE_URL
- globalThis pattern survives HMR in dev
- Pool max is 10 connections (Railway free tier limit)
- TLS enforced via `ssl: "require"` only when `NODE_ENV === "production"` (line 51-52)
- Non-production remote connections trigger a console warning (VH-L002 fix from Audit #1)

**Observation**: Line 76-78 only caches `pgClient` in globalThis when NOT in production. This is intentional (prevents HMR connection leaks in dev), but the drizzleDb reference is always cached. If drizzleDb were somehow invalidated while pgClient wasn't cached, a new pgClient would be created, potentially leaking the old one. This is an edge case but worth noting.

### 2. Database Schema (`app/db/schema.ts`)

Four tables, all event-sourced (append-only with idempotency):

| Table | PK/Unique | Write Path | Idempotency |
|-------|-----------|------------|-------------|
| swap_events | txSignature (PK) | webhook | onConflictDoNothing |
| candles | id (auto) + unique(pool,res,time) | webhook->aggregator | onConflictDoUpdate |
| epoch_events | id (auto) + unique(epochNumber) | webhook | onConflictDoNothing |
| carnage_events | id (auto) + unique(epochNumber) | webhook | onConflictDoNothing |

**Precision concern**: All bigint columns use `mode: "number"` which maps PostgreSQL bigint to JavaScript Number. Current values are safe:
- Token amounts: max 1B tokens * 10^6 decimals = 1e15 (well within 2^53 ≈ 9e15)
- SOL amounts: max protocol-scale trades ~1000 SOL = 1e12 lamports
- Volume accumulation: Candle volume sums could theoretically exceed 2^53 for high-frequency pools over long periods

### 3. Candle Aggregator (`app/db/candle-aggregator.ts`)

Atomic OHLCV upsert pattern:
- `open` column: Only set on INSERT (never overwritten on conflict)
- `high`/`low`: SQL `GREATEST`/`LEAST` ensures correctness even with out-of-order events
- `close`: Always overwritten with latest price
- `volume`/`tradeCount`: Accumulated additively
- All 6 resolutions upserted in parallel via Promise.all

**Why safe**: Drizzle's `sql\`\`` tagged template generates parameterized SQL. The `update.price` and `update.volume` values flow through Drizzle's parameter binding, not string interpolation. Example generated SQL: `GREATEST("high", $1)` where $1 is the price value.

### 4. Webhook Handler (`app/app/api/webhooks/helius/route.ts`)

Dual-mode handler for raw transactions and enhanced account changes:

**Write path security**:
- Rate limited: 120 requests/min per IP (WEBHOOK_RATE_LIMIT)
- Authenticated: timingSafeEqual on HELIUS_WEBHOOK_SECRET
- Fail-closed: Production without secret returns 500
- Body size limited: 1MB max (H050)
- Replay protected: Stale TX skipped if blockTime > 5 min (H049)
- Idempotent: All inserts use onConflictDoNothing

**Account change handling**:
- Enhanced webhooks decoded via Anchor coder
- Decoded data stored in protocol store (in-memory)
- Decode failures store raw data with error flag
- Unknown accounts logged as warnings

### 5. In-Memory Protocol Store (`app/lib/protocol-store.ts`)

Simple Map<string, AccountState> with dedup on serialized JSON comparison:
- Written by: webhook handler (account changes), ws-subscriber (batch seed + polls)
- Read by: SSE endpoint (initial snapshot + streaming), health endpoint
- No TTL, no eviction, no size cap
- globalThis singleton survives HMR

**Growth analysis**: The Map is keyed by pubkey string. Known keys are ~10 protocol PDAs + ~5 synthetic keys (__slot, __supply:CRIME, __supply:FRAUD, __staking:globalStats). Webhook handler only updates known accounts (KNOWN_PROTOCOL_ACCOUNTS whitelist at line 217-226). Unknown accounts are logged and skipped (line 542-548). This effectively bounds the Map to ~15 entries under normal operation.

**However**: If the KNOWN_PROTOCOL_ACCOUNTS mapping were to grow (e.g., adding per-user state), the lack of eviction could become problematic.

### 6. BigInt JSON Round-Trip (`app/lib/bigint-json.ts`)

Custom serialization for Solana u64/u128 values:
- Replacer: `bigint -> { __bigint: "value" }`
- Reviver: `{ __bigint: "value" } -> BigInt(value)`
- Used in: protocol-store serialization, SSE broadcast, useProtocolState deserialization

**Security analysis**:
- `BigInt(value.__bigint)` will throw on non-numeric strings (e.g., `BigInt("abc")` throws SyntaxError). This is caught by the calling code's try/catch.
- No validation that the `__bigint` value is within expected bounds.
- The `isBigIntTag` type guard checks for string type on `__bigint` field.

**anchorToJson shallow conversion** (line 93-117):
- Only iterates top-level keys of the decoded object
- Nested objects with BN/PublicKey fields would pass through unconverted
- Current Anchor accounts (EpochState, PoolState, etc.) have flat structures, so this is safe today
- Future account types with nested structs (e.g., arrays of BN) would need recursive conversion

## Trust Model

### Data Sources (Ordered by Trust Level)

1. **Solana RPC (Helius)** — Fully trusted. ws-subscriber and webhook handler use RPC responses without cryptographic verification. Anchor decoding validates data structure but not authenticity.

2. **Helius Webhook** — Authenticated via shared secret (timingSafeEqual). The webhook is the sole external data input to the database. If webhook auth is compromised, attacker can inject arbitrary swap/epoch/carnage events into Postgres and protocol-store.

3. **Browser SSE Clients** — Untrusted consumers. Read-only access to protocol store via SSE. Cannot write to database or protocol store. Connection rate-limited (10/IP, 5000 global).

4. **Admin/Deploy Scripts** — Trusted (local execution). migrate.ts, generate-constants.ts run on admin machines or Railway preDeployCommand.

### Data Flow Diagram

```
Solana Blockchain
    │
    ├─ WebSocket (onSlotChange) ─────────── ws-subscriber ──┐
    ├─ HTTP (getTokenSupply) ────────────── ws-subscriber ──┤
    ├─ HTTP (getProgramAccounts) ────────── ws-subscriber ──┤
    ├─ HTTP (getMultipleAccountsInfo) ───── ws-subscriber ──┤
    │                                                        │
    │     ┌─ protocol-store (in-memory Map) ◀───────────────┘
    │     │       │
    │     │       └──── SSE broadcast ────── Browser clients
    │     │
    └─ Helius webhook ─── event-parser ─── Drizzle ORM ─── PostgreSQL
                │                                              │
                └── account decode ── protocol-store           │
                                                               │
                Browser (candle API) ◀─── Drizzle SELECT ──────┘
                Browser (carnage API) ◀── Drizzle SELECT ──────┘
```

## State Analysis

### PostgreSQL (Persistent Storage)

**Tables**: 4 tables, ~26 columns total. No user PII. No passwords. No private keys. Data is exclusively protocol event records.

**Indexing**: Appropriate indices on time, pool, epoch_number, user_wallet. Performance concern: swap_events grows linearly with protocol activity. No partitioning or retention policy.

**Connection Security**:
- Production: TLS enforced via `ssl: "require"` in connection.ts
- Migration: NO TLS configuration in migrate.ts
- drizzle.config.ts: No TLS (dev tool, acceptable)

### In-Memory State (Transient)

| Store | Location | Size | TTL | Eviction |
|-------|----------|------|-----|----------|
| Protocol Store | protocol-store.ts | ~15 entries | None | None |
| Rate Limit | rate-limit.ts | Per-IP entries | 5 min sweep | 60s periodic |
| SSE Connections | sse-connections.ts | Per-IP counters | 30 min auto-release | Explicit release |
| Credit Counter | credit-counter.ts | 1 singleton | None (resets on restart) | None |
| SSE Manager | sse-manager.ts | Set of callbacks | None | Auto on disconnect |

**Memory safety**: All in-memory stores except rate-limit have bounded growth (fixed protocol accounts). Rate-limit entries are swept every 60s, removing stale IPs.

## Dependencies

### External
- **PostgreSQL** (Railway-hosted): Connection via postgres.js driver
- **Helius RPC** (WebSocket + HTTP): Account data, slot info, token supply
- **Helius Webhook**: Transaction and account change notifications

### Internal Packages
- **drizzle-orm** + **postgres**: ORM and driver (no raw SQL)
- **@coral-xyz/anchor**: Borsh deserialization for account data
- **@solana/web3.js**: RPC connection, PublicKey utilities

## Focus-Specific Analysis

### SQL Injection Assessment

**Verdict: NOT VULNERABLE**

Every database interaction uses Drizzle ORM's parameterized query API:

1. `db.insert(table).values({...}).onConflictDoNothing()` — ORM-generated INSERT with parameterized values
2. `db.select().from(table).where(and(...conditions))` — ORM-generated SELECT with parameterized WHERE
3. `db.execute(sql\`SELECT 1\`)` — Tagged template (parameterized)
4. `sql\`GREATEST(${candles.high}, ${update.price})\`` — Tagged template, update.price is a parameter

No instances of:
- String concatenation in SQL
- `.raw()` or `.query()` with user input
- Template literals constructing SQL strings
- `eval()` or `Function()` on database results

**False positive check (FP-007)**: Drizzle ORM's object syntax is inherently parameterized. The `sql\`\`` tagged template also generates parameterized queries. This codebase correctly uses the safe API throughout.

### Database Connection Security

**TLS Configuration**:
- `connection.ts` line 51-52: `ssl: "require"` when `NODE_ENV === "production"` — GOOD
- `migrate.ts` line 42: `postgres(databaseUrl, { max: 1 })` — NO SSL — CONCERN
- `drizzle.config.ts`: No SSL (dev tool, acceptable per FP-012)

**Credentials**:
- DATABASE_URL loaded from environment, never hardcoded — matches SP-001
- Throws immediately if missing — fail-closed pattern
- Not logged (warning message uses hostname only, not full URL)

**Connection Pool**:
- Max 10 connections — appropriate for Railway free tier
- No explicit idle_timeout, connect_timeout, or statement_timeout
- globalThis singleton prevents HMR connection leaks

### In-Memory Cache Security

**Protocol Store**:
- No user-controlled keys: Only pubkeys from KNOWN_PROTOCOL_ACCOUNTS and synthetic keys
- No PII: Only protocol state data (reserves, balances, slot numbers)
- Dedup prevents broadcast amplification
- No encryption needed: Data is public on-chain state

**Rate Limit Store**:
- Keys are IP addresses (from x-forwarded-for or x-real-ip)
- IP spoofing via header injection possible if reverse proxy doesn't override x-forwarded-for
- Periodic cleanup prevents unbounded growth

### Data Integrity

**Webhook -> DB Pipeline**:
- Event parser uses Anchor BorshCoder for structured deserialization
- Parsed values are type-checked by TypeScript at compile time
- Runtime validation is implicit in Borsh decode (malformed data throws)
- Idempotency via unique constraints + onConflictDoNothing
- Stale TX rejection (5 min max age)

**Account Change -> Protocol Store**:
- Anchor coder validates data structure during decode
- Decode failures are handled gracefully (store raw data + error flag)
- anchorToJson normalizes BN/PublicKey to JSON-safe types

**SSE Serialization**:
- bigintReplacer/bigintReviver provide lossless BigInt round-trip
- Protocol store dedup prevents redundant broadcasts
- SSE payload format: `event: <name>\ndata: <json>\n\n`

### Migration Security

- `migrate.ts` uses drizzle-orm's programmatic migrator
- Migrations run sequentially from `db/migrations/` directory
- Single connection (max: 1) for migrations
- **No TLS**: Migration client created without SSL config
- Exit code 1 halts Railway deployment on failure

## Cross-Focus Intersections

### SEC-01 (Access Control)
- Webhook handler requires HELIUS_WEBHOOK_SECRET (timingSafeEqual)
- SSE endpoints check connection cap but not authentication
- Health endpoint has no authentication

### SEC-02 (Secrets)
- DATABASE_URL is a sensitive credential loaded from environment
- HELIUS_WEBHOOK_SECRET loaded from environment, compared with timingSafeEqual
- No secrets in DB schema or cached data

### CHAIN-02 (Account State)
- Protocol store caches on-chain account state
- Anchor decode validates data structure but not account ownership
- anchorToJson shallow conversion — verify no nested BN/PublicKey fields

### ERR-01 (Error Handling)
- Webhook handler wraps per-TX processing in try/catch — batch continues on failure
- Candle upsert failure doesn't block swap storage
- Anchor decode failure stores raw data with error flag (potential info disclosure)

### LOGIC-01 (Business Logic)
- Price derivation excludes tax to prevent fake price jumps on epoch transitions
- Staking reward calculation mirrors on-chain math with BigInt precision
- Candle gap-fill carries forward last known price

### DATA-04 (Logging)
- Health endpoint exposes operational stats publicly (H028)
- Console warnings include hostname but not full DATABASE_URL
- Error logs may include Anchor decode error messages

## Cross-Reference Handoffs

| Target Auditor | Item | Why |
|---|---|---|
| SEC-02 | Verify migrate.ts TLS in Railway preDeployCommand | Credentials may transmit in plaintext |
| ERR-01 | Review decode error broadcasting via SSE | Error messages may reveal internal program structure |
| INFRA-03 | Verify Railway Postgres TLS enforcement | App-level TLS config depends on Railway side |
| INFRA-03 | Assess single-process assumption for in-memory stores | Multi-process would break all state |
| DATA-04 | Health endpoint info disclosure (H028 recheck) | wsSubscriber status + credit stats exposed |
| CHAIN-02 | anchorToJson nested object handling | Shallow conversion may miss nested BN/PublicKey |
| LOGIC-02 | BigInt tag collision in data pipeline | `{__bigint: "value"}` could conflict with account field names |

## Risk Observations

### R1: Migration Script TLS Gap (MEDIUM)

**File**: `app/db/migrate.ts:42`
**What**: `postgres(databaseUrl, { max: 1 })` — no SSL configuration
**Why risky**: Railway's preDeployCommand runs this before each deploy. If DATABASE_URL doesn't include `?sslmode=require` parameter, credentials and migration SQL transmit in plaintext. The main app's connection.ts adds TLS explicitly, but migrate.ts bypasses this.
**Impact**: Credential interception on network path between Railway compute and Railway Postgres
**Likelihood**: Low (Railway internal network, TLS may be enforced at infrastructure level)
**Mitigation**: Add `ssl: "require"` to migrate.ts postgres client, or ensure DATABASE_URL includes SSL parameter

### R2: Protocol Store Unbounded Growth (MEDIUM)

**File**: `app/lib/protocol-store.ts:37-38`
**What**: Map has no size limit or eviction policy
**Why risky**: If webhook auth is compromised, attacker could inject account changes for thousands of pubkeys. Each entry is stored and broadcast.
**Impact**: Memory exhaustion, SSE broadcast amplification
**Likelihood**: Low (requires webhook auth bypass, which is rate-limited and timingSafeEqual-protected)
**Current bound**: ~15 entries under normal operation (KNOWN_PROTOCOL_ACCOUNTS whitelist limits webhook writes)

### R3: Schema BigInt Precision Ceiling (MEDIUM)

**File**: `app/db/schema.ts:37-39`
**What**: `bigint("sol_amount", { mode: "number" })` silently truncates values > 2^53
**Why risky**: While current values are within safe range, candle volume accumulation could theoretically overflow for high-frequency trading over long periods.
**Impact**: Silent data corruption in candle volume tracking
**Likelihood**: Very low (would require sustained trading volume exceeding 9 quadrillion lamports per candle period)
**Note**: This is informational for current scale. Would become medium if protocol scales significantly.

### R4: Decode Error SSE Broadcast (MEDIUM)

**File**: `app/app/api/webhooks/helius/route.ts:613-619`
**What**: Failed Anchor decodes store raw base64 account data and error messages in protocol store, which is then broadcast to all SSE clients
**Why risky**: Error messages from Anchor coder may reveal internal IDL structure, account type names, or byte offsets. Raw account data exposes on-chain bytes.
**Impact**: Information disclosure to any connected SSE client
**Likelihood**: Moderate (decode failures can occur when programs are upgraded mid-webhook)
**Note**: On-chain data is already public, so raw bytes don't reveal secrets. Error messages are the primary concern.

### R5: Health Endpoint Information Disclosure (LOW)

**File**: `app/app/api/health/route.ts:63-72`
**What**: Returns wsSubscriber status, credit counter stats, dependency check results without auth
**Why risky**: Operational intelligence: slot subscription status, RPC call counts, fallback activation, initialization state. Attackers can infer system load, RPC provider, and degraded states.
**Impact**: Reconnaissance value for targeted attacks
**This is a RECHECK of H028** from Audit #1.

### R6: Connection Pool Without Health Checks (LOW)

**File**: `app/db/connection.ts:56-57`
**What**: `postgres(connectionString, { max: 10 })` with no idle_timeout, connect_timeout, or statement_timeout
**Why risky**: Stalled queries or leaked connections could exhaust the 10-connection pool. postgres.js has some defaults, but they're not explicitly configured.
**Impact**: Service degradation (no new DB queries until connections free up)
**Mitigation**: postgres.js has built-in connection timeout (30s default) and idle timeout (0 = no limit). Consider setting explicit `idle_timeout: 20` and `connect_timeout: 10`.

### R7: Candle Gap-Fill Memory Amplification (LOW)

**File**: `app/app/api/candles/route.ts:139-166`
**What**: Gap-fill loop iterates from rangeStart to rangeEnd at resolution step size. For `resolution=1m` over a long time range, this generates millions of in-memory objects.
**Why risky**: A malicious client requesting `?resolution=1m&from=0&to=9999999999&gapfill=true` forces the server to allocate massive arrays.
**Impact**: Memory spike, potential OOM on Railway container
**Mitigation**: The `limit` parameter caps DB rows (2000 max), and gap-fill only runs between first and last returned row. So the amplification is bounded by `limit * (max_gap_between_consecutive_candles / resolution_seconds)`. In practice, this is bounded because the DB LIMIT restricts the time range.
**Re-evaluation**: After re-reading the code, gap-fill range is bounded by `rows[0].openTime` to `rows[rows.length-1].openTime` (or query params if provided). With limit=2000 DB rows, the gap-fill is bounded. However, if `from`/`to` params are provided without limit, and there are very few DB rows, the gap-fill could still be large. This warrants further investigation.

## Novel Attack Surface Observations

### BigInt Tag Injection via Anchor Account Fields

If a future Anchor program account type includes a field called `__bigint` with a string value, the `bigintReviver` would convert it to a BigInt during SSE deserialization on the client. This could cause:
- Type errors in React components expecting a string
- Denial of service in components that render the value
- Logic errors if the value is used in comparisons

Current mitigation: None. Current Anchor programs don't have such fields.

### Candle Close Price Ordering Under Concurrent Webhooks (H033 Recheck)

The candle aggregator's `close` column always takes the latest price. If two webhook requests arrive out of order (TX A at time 100 processed after TX B at time 200), the candle's close price would be TX A's price (incorrect — should be TX B's). The `onConflictDoUpdate` doesn't check timestamps:
```typescript
close: sql`${update.price}`, // Last-write-wins, not latest-timestamp-wins
```
This is H033 from Audit #1 (NOT_FIXED status). The webhook processes transactions sequentially within a batch, but Helius may deliver separate batches out of order.

### In-Memory State Loss on Railway Restart

All in-memory stores (protocol-store, rate-limit, sse-connections, credit-counter) reset on Railway container restart. This means:
- Rate limit counters reset (brief window of unlimited requests)
- SSE connection counters reset (zombie connections from before restart aren't tracked)
- Protocol store empties (SSE clients get empty initial state until ws-subscriber re-seeds)

The ws-subscriber's batch seed on init mitigates protocol store loss, but there's a window between restart and seed completion where SSE clients receive incomplete data.

## Questions for Other Focus Areas

1. **For SEC-02**: Does Railway's Postgres service enforce TLS at the infrastructure level, independent of the client configuration? If so, the migrate.ts TLS gap is mitigated at infra level.

2. **For INFRA-03**: Is Railway configured with health-check-based restarts? If so, the health endpoint always returning 200 (H085, ACCEPTED_RISK) could mask degraded state and prevent auto-healing.

3. **For ERR-02**: What happens when Drizzle ORM encounters a connection error mid-query? Does postgres.js automatically reconnect and retry, or does the query fail? The webhook handler catches errors per-TX, but database connection failures could affect multiple operations.

4. **For CHAIN-01**: The ws-subscriber uses `connection.onSlotChange()` which opens a WebSocket. If the WebSocket disconnects silently (no error event, just stops receiving), the staleness monitor (15s threshold) will activate fallback. Is 15s too long for financial operations?

5. **For LOGIC-01**: The candle price derivation excludes tax (`netInput = inputAmount - taxAmount`). If taxAmount is ever larger than inputAmount (bug or edge case), netInput becomes negative. The derivePrice function would return a negative price, but the `if (price <= 0) return` guard in `upsertCandlesForSwap` would skip it. Is this the correct behavior, or should it be logged?

## Raw Notes

### Files Searched But Not Deeply Analyzed

- `shared/constants.ts` — Program IDs and static configuration. DATA-01 tagged but no database/query concerns. Contains cluster-specific address mappings.
- `app/hooks/useRoutes.ts` — Route discovery with cached quotes. DATA-01 tagged for cached quote state, but the caching is React useState (client-side, ephemeral). No database interaction.
- `app/hooks/useCurveState.ts` — Bonding curve state. DATA-01 tagged for curve state caching, now uses SSE via useProtocolState.
- `app/hooks/useEpochState.ts` — Epoch state. Same pattern as useCurveState.
- `app/hooks/useTokenBalances.ts` — Token balance polling. Client-side RPC, no database.
- `app/hooks/useCurrentSlot.ts` — Current slot from protocol store. No database.
- `app/hooks/useTokenSupply.ts` — Token supply from protocol store. No database.
- `app/hooks/useCarnageData.ts` — Carnage fund state. No database.
- `scripts/deploy/generate-constants.ts` — Program ID generation. DATA-01 tagged, no DB interaction.

### Previous Audit Findings Relevant to DATA-01

| ID | Title | Relevance | Status |
|---|---|---|---|
| H011 | DB Without TLS | Direct | FIXED (ssl: "require" in production) — verified at connection.ts:52. BUT migrate.ts still lacks TLS. |
| H033 | Candle Close Ordering | Direct | NOT_FIXED — last-write-wins on close price, no timestamp comparison. |
| H028 | Health Info Disclosure | Direct | NOT_FIXED — health endpoint still exposes internal state without auth. Now WORSE with wsSubscriber and creditCounter stats. |
| H035 | DB Connection Pool Exhaustion | Cleared FP | Was cleared in Audit #1 (Drizzle pool defaults reasonable). Still reasonable with max:10. |
| H073 | DB Connection Singleton Race | Cleared FP | Was cleared in Audit #1 (Node.js module cache). Still valid with Proxy pattern. |
| H049 | Webhook No Replay Protection | RECHECK | FIXED — 5 min max age on blockTime. Still present and functional. |
| H050 | Webhook No Body Size Limit | RECHECK | FIXED — 1MB content-length check. Still present and functional. |
| H085 | Health Always 200 | RECHECK | ACCEPTED_RISK — still returns 200 with degraded body. |
| H092 | SSE Single-Process Only | RECHECK | FIXED — documented as single-process design. Still accurate. |

### Drizzle ORM Security Properties Verified

1. All `.insert().values()` calls generate parameterized INSERT statements
2. All `.select().where()` calls generate parameterized SELECT statements
3. `sql\`\`` tagged templates generate parameterized expressions (not string interpolation)
4. `onConflictDoNothing()` generates proper ON CONFLICT DO NOTHING clauses
5. `onConflictDoUpdate()` generates parameterized SET expressions
6. No `.raw()`, `.query()`, or string-concatenated SQL found anywhere in codebase
