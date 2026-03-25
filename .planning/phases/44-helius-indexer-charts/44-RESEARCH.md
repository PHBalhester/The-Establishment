# Phase 44: Helius Indexer + Charts - Research

**Researched:** 2026-02-16
**Domain:** Blockchain event indexing, OHLCV aggregation, real-time charting
**Confidence:** HIGH (core stack verified via official docs), MEDIUM (some integration patterns from community sources)

## Summary

This phase requires three distinct technical domains: (1) receiving Solana transaction events via Helius webhooks and parsing custom Anchor program events, (2) aggregating swap events into OHLCV candle data in Postgres via Drizzle ORM, and (3) rendering real-time candlestick charts with TradingView Lightweight Charts v5 + SSE push updates.

The critical finding is that Helius **enhanced** webhooks will NOT parse our custom Tax Program or Epoch Program events -- they will appear as "UNKNOWN" or "UNLABELED" since Helius only recognizes pre-mapped programs (Jupiter, Raydium, etc.). We must use **raw webhooks** (`rawDevnet` type) and parse Anchor `emit!()` events ourselves from the `logMessages` array in the raw transaction payload. This is a well-established pattern in the Solana ecosystem.

The standard stack is: Helius raw webhooks for event ingestion, Drizzle ORM with `postgres` (postgres.js) driver for Postgres access, Next.js App Router route handlers for both the webhook endpoint and SSE streaming, and TradingView Lightweight Charts v5.1 for the charting frontend.

**Primary recommendation:** Use raw webhooks with server-side Anchor event decoding from transaction logs, upsert candles on each swap event arrival, and push updates to connected browsers via SSE from the same webhook handler.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lightweight-charts` | 5.1.x | Candlestick charting | TradingView's official OSS library, 35kB bundle, v5 has multi-pane + ES2020 |
| `drizzle-orm` | 0.45.x | Postgres ORM (already in devDeps) | Already in project, type-safe schema with pgTable, upsert via onConflictDoUpdate |
| `drizzle-kit` | 0.31.x | Migration generation | Already in project, generates SQL from schema.ts changes |
| `postgres` (postgres.js) | 3.x | Postgres driver for Drizzle | Recommended by Drizzle docs for serverless/edge, no native bindings needed |
| `@coral-xyz/anchor` | 0.32.x | Anchor event decoding | Already in project, provides BorshCoder for decoding emit!() events from logs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `helius-sdk` | latest | Webhook creation/management API | One-time setup script to register webhook with Helius |
| `bs58` | 6.x | Base58 encoding/decoding | Decoding Anchor event instruction data if using emit_cpi |
| `buffer` | 6.x | Buffer polyfill (already installed) | Browser-side needs, already in app/package.json |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw webhooks | Enhanced webhooks | Enhanced cannot parse custom Anchor programs -- would miss all our events |
| postgres.js driver | node-postgres (pg) | pg requires native bindings which complicate serverless deployment on Railway |
| SSE | WebSocket | SSE is simpler (unidirectional), works natively with Next.js route handlers, no extra infrastructure. WebSocket would require a separate server or Socket.io setup. |
| SSE | Polling | Polling adds latency (seconds) and wastes bandwidth. SSE gives ~100-500ms push latency. |
| TradingView Lightweight Charts | Recharts / Chart.js | Lightweight Charts is purpose-built for OHLCV financial charts with real-time updates. Recharts/Chart.js are general-purpose and lack candlestick-specific features. |

**Installation:**
```bash
cd app && npm install lightweight-charts postgres
```
Note: `drizzle-orm`, `drizzle-kit`, `@coral-xyz/anchor`, and `buffer` are already installed.

## Architecture Patterns

### Recommended Project Structure
```
app/
  app/
    api/
      webhooks/
        helius/
          route.ts         # POST handler: receives raw webhook, parses events, upserts DB, pushes SSE
      sse/
        candles/
          route.ts         # GET handler: SSE stream for candle updates
      candles/
        route.ts           # GET handler: REST API for historical candle data
  db/
    schema.ts              # Already exists -- swap_events, candles, epoch_events, carnage_events
    connection.ts          # NEW: Drizzle + postgres.js connection singleton
    candle-aggregator.ts   # NEW: Upsert candle logic for all 6 resolutions
  lib/
    event-parser.ts        # NEW: Parse Anchor events from raw webhook logMessages
    sse-manager.ts         # NEW: In-memory pub/sub for SSE client connections
  components/
    chart/
      CandlestickChart.tsx # NEW: Main chart component wrapping Lightweight Charts
      ChartControls.tsx    # NEW: Time range selector (1H, 4H, 1D, 1W) + resolution picker
      useChartSSE.ts       # NEW: Hook for SSE connection + candle state management
```

### Pattern 1: Raw Webhook -> Anchor Event Parsing
**What:** Helius sends raw transaction payloads to our webhook endpoint. We parse Anchor `emit!()` events from the `logMessages` array. Events are base64-encoded after the `Program data:` prefix.
**When to use:** Every webhook delivery. This is the only way to get custom program events.
**Example:**
```typescript
// Source: Anchor docs (https://www.anchor-lang.com/docs/features/events)
// + Solana Stack Exchange verified pattern
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { IDL as TaxIDL } from "@/idl/types/tax_program";
import { IDL as EpochIDL } from "@/idl/types/epoch_program";

const taxCoder = new BorshCoder(TaxIDL);
const epochCoder = new BorshCoder(EpochIDL);
const taxParser = new EventParser(TAX_PROGRAM_ID, taxCoder);
const epochParser = new EventParser(EPOCH_PROGRAM_ID, epochCoder);

function parseEventsFromLogs(logMessages: string[]) {
  const taxEvents = [...taxParser.parseLogs(logMessages)];
  const epochEvents = [...epochParser.parseLogs(logMessages)];
  return { taxEvents, epochEvents };
}
```
The `EventParser.parseLogs()` method scans log lines for `Program data:` entries, decodes the base64 payload, matches the 8-byte discriminator, and deserializes via Borsh.

### Pattern 2: Candle Upsert on Swap Event
**What:** Each swap event upserts candles for ALL 6 resolutions simultaneously. Uses Drizzle `onConflictDoUpdate` with the composite unique index `(pool, resolution, open_time)`.
**When to use:** Every swap event processed from webhook.
**Example:**
```typescript
// Source: Drizzle ORM docs (https://orm.drizzle.team/docs/guides/upsert)
import { db } from "@/db/connection";
import { candles } from "@/db/schema";
import { sql } from "drizzle-orm";

const RESOLUTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

async function upsertCandles(pool: string, price: number, volume: number, timestamp: Date) {
  for (const resolution of RESOLUTIONS) {
    const openTime = truncateToResolution(timestamp, resolution);
    await db.insert(candles).values({
      pool,
      resolution,
      openTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
      tradeCount: 1,
    }).onConflictDoUpdate({
      target: [candles.pool, candles.resolution, candles.openTime],
      set: {
        high: sql`GREATEST(${candles.high}, ${price})`,
        low: sql`LEAST(${candles.low}, ${price})`,
        close: price,
        volume: sql`${candles.volume} + ${volume}`,
        tradeCount: sql`${candles.tradeCount} + 1`,
      },
    });
  }
}
```

### Pattern 3: SSE in Next.js App Router
**What:** A route handler that keeps the connection open, sending `text/event-stream` formatted data. Uses `ReadableStream` API.
**When to use:** The `/api/sse/candles` endpoint that browsers connect to for real-time updates.
**Example:**
```typescript
// Source: Next.js community patterns (verified across multiple sources)
// File: app/api/sse/candles/route.ts
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to candle updates
      const unsubscribe = sseManager.subscribe((candle) => {
        const data = `data: ${JSON.stringify(candle)}\n\n`;
        controller.enqueue(encoder.encode(data));
      });

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);

      // Cleanup on client disconnect
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

### Pattern 4: Lightweight Charts v5 React Integration
**What:** Create chart in useEffect, manage series refs, call `series.update()` for real-time data.
**When to use:** The CandlestickChart component.
**Example:**
```typescript
// Source: TradingView Lightweight Charts v5 official docs
// (https://tradingview.github.io/lightweight-charts/docs/5.0)
import { createChart, CandlestickSeries, HistogramSeries } from "lightweight-charts";
import { useEffect, useRef } from "react";

function CandlestickChart({ initialData, pool }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: "solid", color: "#0a0a0a" }, textColor: "#d1d5db" },
      width: containerRef.current.clientWidth,
      height: 400,
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    candleSeries.setData(initialData); // { time: UTCTimestamp, open, high, low, close }[]
    chart.timeScale().fitContent();

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const handleResize = () => chart.applyOptions({ width: containerRef.current!.clientWidth });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [initialData]);

  // Real-time update via SSE
  const updateCandle = (candle: CandleData) => {
    candleSeriesRef.current?.update({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  };

  return <div ref={containerRef} />;
}
```

### Anti-Patterns to Avoid
- **Using enhanced webhooks for custom programs:** Enhanced webhooks only parse known DEX programs. Our Tax/Epoch programs will appear as UNKNOWN. Use raw webhooks.
- **Calling setData() for real-time updates:** `setData()` replaces ALL data and is expensive. Use `update()` for appending/modifying the latest candle.
- **Batch processing candles on a timer:** The context specifies real-time upsert on each event. Don't accumulate events and process in batches.
- **Storing raw webhook payloads:** Context decides parsed fields only + TX signature. Don't blob the entire raw JSON.
- **Using CommonJS imports for lightweight-charts:** v5 dropped CommonJS. Must use ESM imports. Next.js Turbopack handles this natively.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Anchor event parsing | Custom base64 log parser | `EventParser` from `@coral-xyz/anchor` | Handles discriminators, Borsh deserialization, multi-program CPI logs |
| Candle time truncation | Manual date math | `date-fns` or simple Math.floor approach | Off-by-one errors on DST/timezone boundaries; UTC-only simplifies this |
| Financial candlestick charts | Custom Canvas/SVG rendering | `lightweight-charts` v5 | Pan, zoom, crosshair, responsive, volume overlay -- all built-in |
| Webhook registration | Manual HTTP API calls | `helius-sdk` for setup script | Handles auth, validation, error codes |
| SSE reconnection client-side | Custom retry logic | Native `EventSource` with `onerror` handler | Browser auto-reconnects SSE; add exponential backoff only if needed |

**Key insight:** The Anchor `EventParser` is the most critical "don't hand-roll" item. Parsing `Program data:` log lines manually requires matching 8-byte discriminators, handling CPI depth, and Borsh deserialization. The EventParser handles all of this correctly.

## Common Pitfalls

### Pitfall 1: Helius Enhanced Webhooks Don't Parse Custom Programs
**What goes wrong:** Developer sets up an "enhanced" webhook expecting parsed swap events from the Tax Program. Receives UNKNOWN/UNLABELED types or no events at all.
**Why it happens:** Helius enhanced parsing only maps known programs (Jupiter, Raydium, Magic Eden, etc.). Custom Anchor programs are not recognized.
**How to avoid:** Use `rawDevnet` webhook type. Parse events server-side from `meta.logMessages`.
**Warning signs:** Webhook deliveries with `type: "UNKNOWN"` or empty `events` object.

### Pitfall 2: Duplicate Webhook Deliveries
**What goes wrong:** Same swap event inserted twice, corrupting candle volume/tradeCount.
**Why it happens:** Helius retries deliveries on non-200 responses (24-hour retry with exponential backoff). Network issues can cause duplicate delivery even with 200 response.
**How to avoid:** TX signature as primary key / unique constraint (already in schema). Use `onConflictDoUpdate` for swap_events (idempotent), and the unique index on candles prevents double-counting when the upsert uses `GREATEST`/`LEAST`/accumulating logic correctly.
**Warning signs:** tradeCount jumping unexpectedly, volume spikes.

### Pitfall 3: Lightweight Charts v5 API Changes from v4
**What goes wrong:** Code examples from v4 (addCandlestickSeries) fail. Import errors.
**Why it happens:** v5 changed the series creation API. `chart.addCandlestickSeries(opts)` became `chart.addSeries(CandlestickSeries, opts)`. Series markers and watermarks moved to plugins.
**How to avoid:** Always import series types: `import { CandlestickSeries, HistogramSeries, createChart } from "lightweight-charts"`. Use `chart.addSeries(CandlestickSeries, opts)`.
**Warning signs:** TypeScript errors on `addCandlestickSeries`, missing exports.

### Pitfall 4: SSE Connection Timeout on Serverless Platforms
**What goes wrong:** SSE stream closes after 30 seconds on Vercel/some Railway configs.
**Why it happens:** Serverless function timeout. Next.js route handlers on Vercel have execution time limits.
**How to avoid:** Railway runs Next.js as a persistent Node.js server (not serverless), so connections can stay open. Add heartbeat comments every 15 seconds (`": heartbeat\n\n"`) to prevent proxy timeouts. Use `export const dynamic = "force-dynamic"` to prevent caching.
**Warning signs:** Clients constantly reconnecting, amber/red connection indicator.

### Pitfall 5: Time Format for Lightweight Charts
**What goes wrong:** Chart shows no data or data in wrong order.
**Why it happens:** Lightweight Charts expects `time` as UTCTimestamp (Unix seconds as number) or `{ year, month, day }` BusinessDay. Passing milliseconds or Date objects fails silently.
**How to avoid:** Convert candle `openTime` to Unix seconds: `Math.floor(date.getTime() / 1000)`. Data must be sorted by time ascending.
**Warning signs:** Empty chart, console warnings about unsorted data.

### Pitfall 6: Candle Gap-Fill Complexity
**What goes wrong:** Charts have gaps during low-activity periods, causing visual discontinuities.
**Why it happens:** No trades = no candle row in database.
**How to avoid:** Context decision: "carry forward last price (O=H=L=C=last, volume=0)". Two approaches: (A) Fill gaps on query time in the API, or (B) generate empty candles proactively. Recommend (A) -- fill on read -- because it avoids writing millions of empty candle rows and is simpler. The API fills gaps between the last candle and current time.
**Warning signs:** Jagged chart with missing time periods.

### Pitfall 7: authHeader Webhook Security
**What goes wrong:** Anyone who discovers the webhook URL can send fake events, corrupting the database.
**Why it happens:** Webhook URL is a public-facing POST endpoint. Without authentication, it accepts any POST.
**How to avoid:** Set `authHeader` when creating the webhook (e.g., `"Bearer <random-secret>"`). Validate this header in the route handler. Reject requests without valid auth.
**Warning signs:** Unexpected entries in swap_events, events from unknown programs.

## Code Examples

### Webhook Handler (Full Pattern)
```typescript
// Source: Helius docs + Anchor docs + Drizzle docs (synthesized)
// File: app/api/webhooks/helius/route.ts
import { NextRequest, NextResponse } from "next/server";
import { EventParser, BorshCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import taxIdl from "@/idl/tax_program.json";
import epochIdl from "@/idl/epoch_program.json";

const WEBHOOK_AUTH = process.env.HELIUS_WEBHOOK_SECRET;
const TAX_PROGRAM_ID = new PublicKey("FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu");
const EPOCH_PROGRAM_ID = new PublicKey("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod");

export async function POST(req: NextRequest) {
  // 1. Verify auth header
  const auth = req.headers.get("authorization");
  if (auth !== WEBHOOK_AUTH) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body -- Helius sends array of transactions
  const transactions = await req.json();

  // 3. Process each transaction
  for (const tx of transactions) {
    const signature = tx.transaction?.signatures?.[0];
    const logMessages = tx.meta?.logMessages ?? [];
    const blockTime = tx.blockTime; // Unix seconds

    // 4. Parse Anchor events from logs
    const taxParser = new EventParser(TAX_PROGRAM_ID, new BorshCoder(taxIdl));
    const epochParser = new EventParser(EPOCH_PROGRAM_ID, new BorshCoder(epochIdl));

    const taxEvents = [...taxParser.parseLogs(logMessages)];
    const epochEvents = [...epochParser.parseLogs(logMessages)];

    // 5. Process each event type
    for (const event of taxEvents) {
      if (event.name === "TaxedSwap" || event.name === "UntaxedSwap") {
        await processSwapEvent(signature, event, blockTime);
      }
    }
    for (const event of epochEvents) {
      if (event.name === "EpochTransitionTriggered" || event.name === "TaxesUpdated") {
        await processEpochEvent(signature, event, blockTime);
      }
      if (event.name === "CarnageExecuted") {
        await processCarnageEvent(signature, event, blockTime);
      }
    }
  }

  // 6. Return 200 immediately (Helius expects fast response)
  return NextResponse.json({ ok: true });
}
```

### Raw Webhook Payload Structure (Helius rawDevnet)
```json
[
  {
    "blockTime": 1708100000,
    "indexWithinBlock": 42,
    "meta": {
      "err": null,
      "fee": 5000,
      "innerInstructions": [...],
      "logMessages": [
        "Program FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu invoke [1]",
        "Program log: Instruction: SwapSolBuy",
        "Program data: <base64-encoded-TaxedSwap-event>",
        "Program FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu success"
      ],
      "preBalances": [...],
      "postBalances": [...]
    },
    "slot": 123456,
    "transaction": {
      "message": { "accountKeys": [...], ... },
      "signatures": ["5u62i53R1Hdc4thm..."]
    }
  }
]
```

### Candle API (REST for Historical Data)
```typescript
// File: app/api/candles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/connection";
import { candles } from "@/db/schema";
import { and, eq, gte, lte, asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pool = searchParams.get("pool")!;
  const resolution = searchParams.get("resolution") ?? "15m";
  const from = searchParams.get("from"); // ISO string
  const to = searchParams.get("to");     // ISO string

  const rows = await db
    .select()
    .from(candles)
    .where(
      and(
        eq(candles.pool, pool),
        eq(candles.resolution, resolution),
        from ? gte(candles.openTime, new Date(from)) : undefined,
        to ? lte(candles.openTime, new Date(to)) : undefined,
      )
    )
    .orderBy(asc(candles.openTime));

  // Fill gaps with carry-forward candles
  const filled = fillCandleGaps(rows, resolution);

  return NextResponse.json(filled);
}
```

### SSE Manager (In-Memory Pub/Sub)
```typescript
// File: app/lib/sse-manager.ts
type Listener = (data: CandleUpdate) => void;

class SSEManager {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(data: CandleUpdate): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}

// Singleton -- shared across route handlers in the same Node.js process
export const sseManager = new SSEManager();
```

### Helius Webhook Registration Script
```typescript
// File: scripts/setup-webhook.ts (one-time setup)
import Helius from "helius-sdk";

const helius = new Helius("YOUR_API_KEY");

// Monitor Tax Program and Epoch Program addresses
const webhook = await helius.createWebhook({
  webhookURL: "https://your-app.railway.app/api/webhooks/helius",
  webhookType: "rawDevnet",
  accountAddresses: [
    "FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu", // Tax Program
    "AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod", // Epoch Program
  ],
  authHeader: "Bearer <generate-a-random-secret>",
});
console.log("Webhook created:", webhook.webhookID);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lightweight Charts v4: `chart.addCandlestickSeries()` | v5: `chart.addSeries(CandlestickSeries, opts)` | Jan 2025 (v5.0.0) | Must import series types separately, new unified API |
| Lightweight Charts v4: CommonJS support | v5: ESM-only, ES2020 target | Jan 2025 (v5.0.0) | Next.js Turbopack handles ESM natively, no issue |
| Lightweight Charts: `series.setMarkers()` | v5: `createSeriesMarkers(series, [...])` plugin | Jan 2025 (v5.0.0) | Epoch/Carnage chart markers use new plugin API |
| Drizzle: separate migration commands | drizzle-kit 0.31.x: `drizzle-kit generate` + `drizzle-kit migrate` | 2025 | Schema push or migration-based workflow |
| Helius: docs at docs.helius.dev | Helius: docs at www.helius.dev/docs | 2025 | Old URLs redirect, .md suffix for LLM-ready docs |

**Deprecated/outdated:**
- `chart.addCandlestickSeries()` (v4 API) -- replaced by `chart.addSeries(CandlestickSeries, opts)`
- `series.setMarkers()` -- replaced by `createSeriesMarkers()` plugin
- Helius webhook `transactionTypes` filtering -- only works with enhanced webhooks, not raw

## Codebase-Specific Findings

### Existing Schema (Ready to Use)
The Drizzle schema at `app/db/schema.ts` already defines all 4 tables needed:
- `swapEvents` -- TX signature PK, pool, direction, amounts, price, tax, LP fee, epoch, timestamp
- `candles` -- Composite unique on (pool, resolution, openTime), OHLCV fields
- `epochEvents` -- Unique on epoch_number, tax rates, cheap side
- `carnageEvents` -- Unique on epoch_number, burn/buy amounts, path

The schema comment says "Phase 44 will provision Postgres on Railway and generate migrations from these table definitions." This means:
1. Provision Postgres on Railway
2. Configure `DATABASE_URL` env var
3. Create `drizzle.config.ts`
4. Run `drizzle-kit generate` then `drizzle-kit migrate`

### Existing IDL Files
The app already has Anchor IDL JSON files at `app/idl/`:
- `tax_program.json` -- Contains TaxedSwap, UntaxedSwap, ExemptSwap event definitions
- `epoch_program.json` -- Contains CarnageExecuted, EpochTransitionTriggered, TaxesUpdated event definitions

These IDLs are required for `BorshCoder` / `EventParser` to decode events.

### Existing Helius API Key
The project already has a Helius devnet API key in `shared/programs.ts`:
`https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]-...`
This same key is used for webhook API calls.

### Program IDs for Webhook Monitoring
From `shared/constants.ts`:
- Tax Program: `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu`
- Epoch Program: `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod`

### Event Structures to Parse
**TaxedSwap** (from Tax Program, emitted on SOL pool swaps):
- user, pool_type, direction, input_amount, output_amount, tax_amount, tax_rate_bps, staking_portion, carnage_portion, treasury_portion, epoch, slot

**UntaxedSwap** (from Tax Program, emitted on PROFIT pool swaps):
- user, pool_type, direction, input_amount, output_amount, lp_fee, slot

**ExemptSwap** (from Tax Program, emitted on Carnage swaps):
- authority, pool, amount_a, direction, slot

**CarnageExecuted** (from Epoch Program):
- epoch, action, target, sol_spent, tokens_bought, tokens_burned, sol_from_sale, atomic

**EpochTransitionTriggered** (from Epoch Program):
- epoch, triggered_by, slot, bounty_paid

**TaxesUpdated** (from Epoch Program):
- epoch, cheap_side, low_tax_bps, high_tax_bps, flipped

### Price Derivation from Swap Events
For candle price computation (Claude's Discretion area):
**Recommendation: Use output/input ratio from the swap event.**
- Buy (SOL -> CRIME): price = sol_amount / token_amount (SOL per token)
- Sell (CRIME -> SOL): price = sol_amount / token_amount (SOL per token)
- This gives price in SOL. Multiply by SOL/USD (from CoinGecko, already polled) for USD display.
- For PROFIT pools: price = crime_amount / profit_amount (CRIME per PROFIT), chain through CRIME/SOL * SOL/USD for USD.

### Existing Swap Page Layout
Current `app/app/swap/page.tsx` has a two-column layout: SwapForm + StakingForm. The chart needs to be added above or alongside these. Given the context says "charts embedded in /swap page," a natural layout is chart spanning full width above the two forms.

### Existing SOL/USD Price Feed
`useSolPrice` hook (in `app/hooks/useSolPrice.ts`) already polls Jupiter API every 30s. This is available for USD price conversion on charts. The hook returns `{ solPrice: number | null, loading, error }`.

## Open Questions

1. **Railway Postgres provisioning details**
   - What we know: Schema exists, drizzle-kit is installed
   - What's unclear: Railway Postgres provisioning steps, connection string format, SSL requirements
   - Recommendation: Document in plan step 1. Railway provides `DATABASE_URL` automatically when you add a Postgres plugin.

2. **Helius webhook monitoring scope: account addresses vs program IDs**
   - What we know: Helius `accountAddresses` field monitors addresses that appear in transactions. For programs, passing the program ID captures all transactions that invoke that program.
   - What's unclear: Whether passing the Tax Program ID captures ALL swap transactions (since the Tax Program is the outer caller) or if we also need pool addresses
   - Recommendation: Start with just the two program IDs. If events are missed, add pool addresses. The program ID should be sufficient since every swap invokes the Tax Program.

3. **SSE singleton across Next.js hot reloads**
   - What we know: SSE manager needs to be a singleton. In dev mode, Next.js hot reloads modules.
   - What's unclear: Whether the globalThis pattern is needed to preserve the singleton across HMR
   - Recommendation: Use `globalThis` caching pattern (same as Drizzle connection) to prevent creating new SSE managers on hot reload.

4. **Volume bars below candlestick chart**
   - What we know: Lightweight Charts v5 supports HistogramSeries which can overlay on the same pane
   - What's unclear: Whether to use a separate pane (v5 multi-pane) or overlay on the price pane
   - Recommendation: Use a separate pane below the candlestick pane for volume -- this is the standard TradingView pattern and v5 multi-pane makes it straightforward.

5. **Candle gap-fill strategy performance**
   - What we know: Decision is carry-forward last price for no-trade gaps
   - What's unclear: Whether to fill on write (create empty candles) or fill on read (API fills gaps at query time)
   - Recommendation: Fill on read. Avoids creating millions of empty rows. The API scans the result set and inserts synthetic candles where time gaps exceed the resolution.

## Sources

### Primary (HIGH confidence)
- Helius webhook API docs -- https://www.helius.dev/docs/api-reference/webhooks/llms.txt (webhook types, payload format, authHeader, retry behavior, accountAddresses)
- TradingView Lightweight Charts v5 official docs -- https://tradingview.github.io/lightweight-charts/docs/5.0 (createChart, addSeries API, CandlestickSeries, update(), setData(), time format)
- TradingView Lightweight Charts v5 migration guide -- https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5 (API changes from v4)
- Drizzle ORM upsert guide -- https://orm.drizzle.team/docs/guides/upsert (onConflictDoUpdate, composite targets, excluded values)
- Anchor events documentation -- https://www.anchor-lang.com/docs/features/events (emit!(), EventParser, base64 encoding in Program data)
- Drizzle Postgres getting started -- https://orm.drizzle.team/docs/get-started/postgresql-new (postgres.js driver, connection setup)

### Secondary (MEDIUM confidence)
- Solana Stack Exchange: Program logs as source of truth -- https://solana.stackexchange.com/questions/22723 (confirms raw webhook + log parsing is standard practice)
- Crypto Data Bytes: Solana Events guide -- https://read.cryptodatabytes.com/p/solana-analytics-starter-guide-part (Anchor log base64 format, discriminator matching)
- Next.js SSE patterns -- https://damianhodgkiss.com/tutorials/real-time-updates-sse-nextjs (ReadableStream API, force-dynamic, heartbeat pattern)
- helius-webhooks-tutorial GitHub -- https://github.com/wkennedy/helius-webhooks-tutorial (raw webhook payload structure, Express handler pattern)

### Tertiary (LOW confidence)
- Reddit r/nextjs: SSE in App Router -- https://www.reddit.com/r/nextjs/comments/1hl7y6f/ (confirms SSE works in Railway persistent Node.js, not on Vercel serverless)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official documentation, versions confirmed
- Architecture: HIGH - Patterns sourced from official docs (Anchor EventParser, Drizzle upsert, LWC v5 API, SSE ReadableStream)
- Pitfalls: HIGH - Custom program parsing limitation confirmed across Helius docs + Stack Exchange; LWC v5 API changes confirmed in migration guide
- Codebase integration: HIGH - Schema, IDLs, program IDs, API key all verified directly in codebase

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (30 days -- stable domain, libraries well-established)
