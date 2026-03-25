# Phase 44: Helius Indexer + Charts - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Capture historical swap, epoch, and Carnage events via Helius webhooks, aggregate into OHLCV candles in Postgres, and render TradingView Lightweight Charts with real-time updates via SSE. Charts are embedded in the /swap page. This phase does NOT include an activity feed, transaction history table, or separate analytics page.

</domain>

<decisions>
## Implementation Decisions

### Chart presentation & layout
- Charts embedded in /swap page (no separate /charts route)
- All 4 pools get charts: CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT
- Chart auto-follows the currently selected swap pair, with manual override to view other pools
- Y-axis shows market cap in USD (default) with toggle to price-per-token in USD
- For PROFIT pools: MCAP in USD derived through SOL price chain (PROFIT/CRIME × CRIME/SOL × SOL/USD), toggle to price in paired token (CRIME or FRAUD per PROFIT)

### Candle resolution & gaps
- Default resolution: 15-minute candles
- Full resolution range: 1m, 5m, 15m, 1h, 4h, 1d
- No-trade gaps: Carry forward last price (O=H=L=C=last traded price, volume=0) — continuous chart, no visual gaps
- Real-time aggregation: Each incoming swap event upserts the current candle immediately (no batch jobs)

### Event scope & storage
- Helius webhook captures 3 event types: swap events (Tax Program), epoch transitions (Epoch Program), Carnage executions (Tax Program)
- Parsed fields stored in Postgres + TX signature for Explorer lookup (no raw payload blobs)
- TX signature as unique key for idempotent webhook handling

### Real-time behavior
- SSE (Server-Sent Events) pushes updated candle data from server to connected clients
- Webhook arrival → process → candle upsert → SSE push to browsers (~100-500ms latency)
- Live connection indicator: green dot (streaming), amber (reconnecting), red (disconnected), with auto-reconnect
- Resolution switch fetches full historical candles from Postgres (not rolling window)
- Pan + lazy load: user can scroll left to explore older candles, chart lazy-loads additional history

### Claude's Discretion
- Chart overlays (volume bars, epoch markers, Carnage markers) — pick what's practical with TradingView Lightweight Charts
- Price derivation method from swap events (output/input ratio vs post-swap reserves)
- SSE implementation details (edge vs node runtime, reconnect backoff)
- Storage approach for parsed fields (TX signature as unique key already decided)
- Chart styling, colors, candlestick theme

</decisions>

<specifics>
## Specific Ideas

- Market cap as default Y-axis mirrors existing dashboard PoolCard pattern (Phase 41) — consistent mental model
- CoinGecko SOL/USD price already available from Phase 41's 30s polling — reuse for chart USD conversion
- "As real-time as possible" — SSE chosen over polling/WebSocket for optimal latency with zero extra infrastructure on Railway

</specifics>

<deferred>
## Deferred Ideas

- Activity feed / transaction history table — future phase (indexed data could power it, but UI is out of scope)
- Staking event indexing — not needed for charts, staking UI reads from RPC

</deferred>

---

*Phase: 44-helius-indexer-charts*
*Context gathered: 2026-02-16*
