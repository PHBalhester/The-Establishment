---
status: diagnosed
trigger: "Second user who connects to the post-graduation trading interface sees blank/loading data everywhere (routes, market caps, carnage fund, staking info), while the first user sees everything fine. Possible SSE concurrent user issue."
created: 2026-03-23T00:00:00Z
updated: 2026-03-23T01:30:00Z
---

## Current Focus

hypothesis: CONFIRMED -- useProtocolState() is a React hook (not a Context Provider), so every component that calls it creates its own EventSource SSE connection. A single SwapStation modal creates 7 separate SSE connections (6 protocol + 1 candle). Combined with a per-IP connection cap of 10, the second user's connections are rejected after the first user consumes 7 slots.
test: Traced every useProtocolState() call site through the component tree for SwapStation
expecting: Connection amplification that exhausts either server-side per-IP limits or browser per-origin limits
next_action: Write root cause report (investigate-only mode)

## Symptoms

expected: All connected users should see the same protocol data (routes, market caps, carnage fund, staking info) regardless of connection order.
actual: First user to connect sees everything fine. Second user who connects moments later sees blank/loading for route finding, market caps, carnage fund info, staking info. Core data is missing for the second connection.
errors: No specific error messages reported. Data simply shows "loading" or blank.
reproduction: Two users connect to the Railway devnet frontend post-graduation. First user sees data, second user sees loading/blank. Happened immediately after the site mode switch from launch to live.
started: First occurrence after Phase 102 graduation and site mode switch to live. SSE pipeline recently modified (added WebSocket accountSubscribe for protocol PDAs).

## Eliminated

- hypothesis: "globalThis singleton isolation -- protocolStore is a different instance for different users' SSE routes"
  evidence: The NODE_ENV guard fix (commit 40cdc3c) was applied to all 5 singleton files and is verified present in current code. protocolStore.ts lines 122-125 show unconditional globalThis assignment. The previous ws-subscriber-context-isolation debug session confirmed this fix works. protocolStore.getAllAccountStates() returns the same data for all SSE route invocations because they share the same singleton Map.
  timestamp: 2026-03-23

- hypothesis: "batchSeed didn't complete before second user connects"
  evidence: batchSeed runs in instrumentation.ts at server boot, which completes before any HTTP requests are served. The first user sees data correctly, confirming batchSeed populated the store. The protocolStore is a singleton, so the second user reads the same populated Map.
  timestamp: 2026-03-23

- hypothesis: "protocolStore dedup mechanism prevents second user from getting data"
  evidence: The dedup guard (lastSerialized comparison) only affects broadcast() calls in setAccountState(). The initial-state event in the protocol SSE route handler calls getAllAccountStates() which reads directly from the accounts Map, completely bypassing the dedup mechanism. Both users get the same initial-state snapshot.
  timestamp: 2026-03-23

- hypothesis: "EventSource initial-state event fires before client registers listener"
  evidence: JavaScript is single-threaded. EventSource constructor starts HTTP request asynchronously but event listeners are added synchronously in the same microtask. No events fire until the current task completes. Listeners are guaranteed to be registered before any events dispatch.
  timestamp: 2026-03-23

- hypothesis: "BigInt serialization mismatch between server and client"
  evidence: Server uses bigintReplacer in both protocolStore.setAccountState() and the SSE route's JSON.stringify(initialState, bigintReplacer). Client uses bigintReviver in JSON.parse(event.data, bigintReviver). The replacer/reviver pair is symmetric. No data corruption.
  timestamp: 2026-03-23

## Evidence

- timestamp: 2026-03-23
  checked: app/hooks/useProtocolState.ts -- how SSE connections are created
  found: useProtocolState() is a REACT HOOK (not a Context Provider). Line 267 creates `new EventSource("/api/sse/protocol")` on every hook mount. There is NO ProtocolStateProvider or React.createContext wrapping the app. Every component that calls useProtocolState() gets its own independent EventSource connection.
  implication: Connection amplification. N components = N separate SSE connections to the server.

- timestamp: 2026-03-23
  checked: Counted useProtocolState() call sites through the SwapStation component tree
  found: |
    SwapStation.tsx calls useSwap() which internally calls:
      - usePoolPrices() -> useProtocolState() [ES #1]
      - useEpochState() -> useProtocolState() [ES #2]
    SwapStation.tsx also calls:
      - useTokenSupply() -> useProtocolState() [ES #3]
      - useChartData() -> useChartSSE() [ES #4 to /api/sse/candles]
    SwapStatsBar.tsx (child of SwapStation) calls:
      - usePoolPrices() -> useProtocolState() [ES #5]
      - useEpochState() -> useProtocolState() [ES #6]
      - useTokenSupply() -> useProtocolState() [ES #7]
  implication: SwapStation alone creates 7 SSE connections per user tab (6 to /api/sse/protocol + 1 to /api/sse/candles). This is the PRIMARY driver of the bug.

- timestamp: 2026-03-23
  checked: app/lib/sse-connections.ts -- server-side per-IP connection limits
  found: MAX_PER_IP = 10, MAX_GLOBAL = 5000. Connection tracking uses IP from getClientIp() which reads x-forwarded-for (rightmost) or x-real-ip. acquireConnection() returns false (triggering 429) when limit exceeded.
  implication: With 7 connections per user tab, the per-IP budget of 10 only accommodates ~1.4 users. A second user sharing the same IP bucket would have their last 4 connections rejected with 429.

- timestamp: 2026-03-23
  checked: app/lib/rate-limit.ts getClientIp() -- IP extraction for Railway
  found: Takes rightmost IP from x-forwarded-for, falls back to x-real-ip, falls back to "unknown". Railway community guidance says rightmost x-forwarded-for is the client IP when no additional reverse proxy is involved. However, Railway also provides X-Envoy-External-Address header (not checked by this code). If Railway's proxy chain results in the rightmost value being the proxy IP (not client IP), ALL users would share the same IP bucket.
  implication: If IP extraction fails (all users -> same IP or "unknown"), the per-IP cap of 10 is shared among ALL users, making the connection amplification issue catastrophic.

- timestamp: 2026-03-23
  checked: What happens when EventSource receives 429 from server
  found: EventSource treats any non-200 response as an error. The onerror handler fires (line 306). The hook sets exponential backoff reconnection (1s, 2s, 4s...30s). The accounts state remains {} (empty). Derived hooks (usePoolPrices, useEpochState, etc.) return loading:true and null data. UI shows "loading" or blank.
  implication: The 429 response is SILENT from the user's perspective -- no error message, just perpetual loading state. This matches the reported symptom exactly.

- timestamp: 2026-03-23
  checked: Browser EventSource connection limits
  found: For HTTP/1.1, browsers enforce 6 EventSource connections per origin (across ALL tabs). Railway serves HTTP/2 (verified via curl), so this limit doesn't apply for different users on different devices. However, if "second user" means "second tab in the same browser," Chrome/Firefox may still enforce limits depending on how they handle SSE over HTTP/2.
  implication: If testing with two tabs in the same browser, the browser's own connection limit (6 for HTTP/1.1) would block 1-2 of the second tab's connections. HTTP/2 should resolve this but some browsers have quirks with SSE connection limits.

- timestamp: 2026-03-23
  checked: ModalContent.tsx -- how many stations mount simultaneously
  found: Only ONE station renders at a time (React short-circuit: `{station === 'swap' && <SwapStation />}`). Stations are React.lazy loaded. When the modal closes, the station unmounts, calling the useProtocolState cleanup which closes EventSource connections.
  implication: At any given moment, a user has at most 7 SSE connections (from one station). Connection cleanup on unmount should release slots. But if there's a delay in the abort signal reaching the server, slots may temporarily remain occupied.

- timestamp: 2026-03-23
  checked: Release mechanism for SSE connections on client disconnect
  found: Protocol route uses req.signal.addEventListener("abort") + stream cancel() to call release(). Both call releaseConnection(ip). However, there may be a delay between the client closing EventSource and the server receiving the abort signal, especially through Railway's proxy. During this delay, the connection counter is inflated (ghost connections).
  implication: Rapid modal open/close cycles could temporarily inflate the connection counter beyond the actual active count, causing legitimate new connections to be rejected.

## Resolution

root_cause: |
  **PRIMARY: useProtocolState() creates a new EventSource per hook instance (no shared Context Provider)**

  `useProtocolState()` is implemented as a standalone React hook, not as a Context Provider. Every component that calls it (directly or through derived hooks like usePoolPrices, useEpochState, useTokenSupply) creates its own `new EventSource("/api/sse/protocol")` SSE connection.

  For SwapStation alone, this creates 7 SSE connections per user tab:
  - useSwap -> usePoolPrices -> useProtocolState [#1]
  - useSwap -> useEpochState -> useProtocolState [#2]
  - useTokenSupply -> useProtocolState [#3]
  - useChartData -> useChartSSE [#4, candles route]
  - SwapStatsBar: usePoolPrices -> useProtocolState [#5]
  - SwapStatsBar: useEpochState -> useProtocolState [#6]
  - SwapStatsBar: useTokenSupply -> useProtocolState [#7]

  **CONTRIBUTING: Per-IP connection cap (MAX_PER_IP=10) is exhausted by 2 users**

  The server-side SSE connection limiter allows 10 connections per IP. With 7 connections per user, the budget only supports ~1.4 users sharing an IP. When the second user's connections attempt to acquire slots beyond 10, acquireConnection() returns false, the server returns 429, EventSource fires onerror, and the hook stays in loading state with empty data.

  **MECHANISM (why second user sees blank):**
  1. User 1 opens SwapStation -> 7 SSE connections acquired (7/10 IP budget)
  2. User 2 opens any station -> first 3 connections succeed (10/10), remaining 4 get 429
  3. EventSource onerror triggers exponential backoff reconnection (never succeeds because user 1's connections keep the count at 7)
  4. Hooks with failed connections have empty state -> UI shows loading/blank

  **WHY FIRST USER WORKS:** First user's 7 connections all succeed (7 < 10). They get initial-state events with full protocolStore data.

  **IP COLLISION FACTOR:** If Railway's proxy causes all users to share the same IP bucket (possible if x-forwarded-for rightmost gives the proxy IP, or if x-envoy-external-address isn't checked), the problem is guaranteed. Even with correct per-user IPs, two users from the same network/VPN would share a bucket.

fix: |
  **FIX 1 (Required): Create a ProtocolStateProvider Context**
  
  Convert useProtocolState from a hook into a Context Provider that wraps the app. 
  A single EventSource connection shared by ALL components via React Context:
  
  1. Create ProtocolStateContext with createContext()
  2. Create ProtocolStateProvider that:
     a. Creates ONE EventSource to /api/sse/protocol
     b. Manages reconnection, visibility, polling fallback
     c. Stores accounts state in the context value
  3. Add ProtocolStateProvider to app/providers/providers.tsx
  4. Convert useProtocolState() to useContext(ProtocolStateContext)
  5. All derived hooks (usePoolPrices, useEpochState, etc.) continue calling 
     useProtocolState() -- no changes needed in derived hooks or components
  
  Result: 1 protocol SSE connection per tab (not 6). Total per user: 2 (1 protocol + 1 candle).
  Two users = 4 connections. Well within MAX_PER_IP=10.

  **FIX 2 (Recommended): Lower MAX_PER_IP or make it configurable**
  
  After Fix 1, MAX_PER_IP=10 is generous (5 tabs * 2 SSE routes). Consider adding
  a WS_MAX_SSE_PER_IP env var for Railway configuration.

  **FIX 3 (Recommended): Check x-envoy-external-address header**
  
  Railway uses Envoy as its edge proxy. The x-envoy-external-address header provides
  the real client IP. Add this to getClientIp() before the x-forwarded-for check to
  ensure correct IP extraction on Railway.

  **FIX 4 (Nice-to-have): Add connection diagnostics logging**
  
  Log acquireConnection failures (429 returns) with the IP and current count so the 
  issue is visible in Railway logs rather than being completely silent.

verification: |
  After Fix 1:
  1. Open DevTools Network tab -> filter by EventSource -> confirm only 2 SSE connections 
     per tab (1 protocol + 1 candle) regardless of which station is open
  2. Open two browser tabs (or two browsers) to the live trading page
  3. Open SwapStation on both -> verify both see pool data, market caps, epoch state
  4. Switch to CarnageStation on one tab -> verify carnage fund data appears
  5. Check Railway logs for no 429 responses on /api/sse/protocol
  6. Monitor /api/health or sse-connections diagnostics for connection counts

files_changed: []
